// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: green; icon-glyph: road;
/**
 * GOGO 스마트 매니저 — 주행 기록 (Scriptable)
 * - iOS 단축어 블루투스 자동화 → "Run Script"(Run In App 끔)로 백그라운드 실행
 * - 입력(단축어 사전, Parameter 또는 Texts): { car: "X1"|"accent"|"엑센트", phase: "start"|"end" }
 * - 출발: 로컬 우선 저장 → trip_pending/{x1|accent} PUT (앱 "운행 중" 표시)
 * - 도착: 카카오 길찾기 거리 → trip_logs/{TID} PUT → trip_pending DELETE
 * - 지하 주차장 대응: 출발 GPS 실패 → 직전 도착 좌표 사용, 도착 처리 통신 실패 → 대기열 재처리
 * - 판정: 1km 미만 & 10분 미만 폐기 / 1km 미만 → roundtrip_suspect / 그 외 ok (기존 규칙 동일)
 * - 알림: 실패·확인 필요(왕복 의심) 때만. 정상 처리는 조용히 단축어 출력만
 * - 앱(js/mileage.js)·보안 규칙과 동일 규격, 변경 없음
 */

const API_KEY = 'AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus';
const DB_URL = 'https://gogo-manager-f0a68-default-rtdb.firebaseio.com';
const KAKAO_URL = 'https://apis-navi.kakaomobility.com/v1/directions';
const KC_TOKEN = 'gogo_refresh_token';
const KC_PROFILE = 'gogo_profile';
const KC_KAKAO = 'gogo_kakao_key';
const STATE_FILE = 'gogo-trip-state.json';
const GPS_TIMEOUT_MS = 12000;
const RECONNECT_KEEP_MS = 30 * 60 * 1000;      // 30분 이내 재연결은 같은 운행
const STALE_PENDING_MS = 18 * 3600 * 1000;      // 18시간 지난 출발 정보는 무효
const QUEUE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;  // 대기열 7일 보관

/* Phase 1 멀티테넌트 전환 시 여기만 'families/{fid}/...' 로 변경 */
const PATHS = { pending: 'trip_pending', trips: 'trip_logs' };

/* ── 공통 ─────────────────────────────────────────── */
function kstParts(ms) {
  const k = new Date(ms + 9 * 3600000);
  return { y: k.getUTCFullYear(), mo: k.getUTCMonth() + 1, d: k.getUTCDate(), h: k.getUTCHours(), mi: k.getUTCMinutes(), s: k.getUTCSeconds() };
}
function z2(n) { return String(n).padStart(2, '0'); }
function kstId(ms) {
  const p = kstParts(ms);
  return Number(`${p.y}${z2(p.mo)}${z2(p.d)}${z2(p.h)}${z2(p.mi)}${z2(p.s)}`);
}
function kstTimeText(ms) {
  const p = kstParts(ms);
  return `${p.mo}월 ${p.d}일 ${z2(p.h)}:${z2(p.mi)}`;
}
function msFromKstId(id) {
  const s = String(id || '');
  if (!/^\d{14}$/.test(s)) return NaN;
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)) - 9 * 3600000;
}
function isNum(v) { return typeof v === 'number' && isFinite(v); }
function validPoint(p) {
  return p && isNum(p.lat) && isNum(p.lng) && p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180;
}

function carInfo(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'x1') return { key: 'x1', name: 'X1' };
  if (s === 'accent' || s === '엑센트') return { key: 'accent', name: '엑센트' };
  return null;
}

/* ── 입력 ─────────────────────────────────────────── */
function toObject(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t.startsWith('{')) return null;
    try {
      const o = JSON.parse(t);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    } catch (e) {
      return null;
    }
  }
  return null;
}
function readInput() {
  const candidates = [args.shortcutParameter];
  if (Array.isArray(args.plainTexts)) candidates.push(...args.plainTexts);
  for (const c of candidates) {
    const o = toObject(c);
    if (o && (o.car !== undefined || o.phase !== undefined)) return o;
  }
  return null;
}

/* ── 로컬 상태 파일 ────────────────────────────────── */
function statePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), STATE_FILE);
}
function loadState() {
  const empty = { pending: {}, lastEnd: {}, queue: [] };
  try {
    const fm = FileManager.local();
    const p = statePath();
    if (!fm.fileExists(p)) return empty;
    const s = JSON.parse(fm.readString(p) || '{}');
    return {
      pending: s.pending && typeof s.pending === 'object' ? s.pending : {},
      lastEnd: s.lastEnd && typeof s.lastEnd === 'object' ? s.lastEnd : {},
      queue: Array.isArray(s.queue) ? s.queue : []
    };
  } catch (e) {
    console.warn(`상태 파일 읽기 실패: ${e.message}`);
    return empty;
  }
}
function saveState(state) {
  try {
    FileManager.local().writeString(statePath(), JSON.stringify(state));
  } catch (e) {
    console.warn(`상태 파일 저장 실패: ${e.message}`);
  }
}

/* ── GPS ──────────────────────────────────────────── */
async function currentPoint() {
  try {
    Location.setAccuracyToBest();
    const timeout = new Promise((_, reject) => Timer.schedule(GPS_TIMEOUT_MS, false, () => reject(new Error('GPS 시간 초과'))));
    const loc = await Promise.race([Location.current(), timeout]);
    const p = { lat: Number(Number(loc.latitude).toFixed(6)), lng: Number(Number(loc.longitude).toFixed(6)) };
    return validPoint(p) ? p : null;
  } catch (e) {
    console.warn(`GPS 실패: ${e.message}`);
    return null;
  }
}

/* ── 인증 · DB ────────────────────────────────────── */
function netError(msg) {
  const e = new Error(msg);
  e.network = true;
  return e;
}

async function askSecret(title, message, placeholder, check) {
  if (!config.runsInApp) {
    const err = new Error(`${title} 필요 — Scriptable 앱에서 이 스크립트를 1회 실행해 등록하세요.`);
    err.needSetup = true;
    throw err;
  }
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addSecureTextField(placeholder, '');
  a.addAction('저장');
  a.addCancelAction('취소');
  if (await a.present() === -1) throw new Error(`${title} 취소`);
  const v = a.textFieldValue(0).trim();
  if (!check(v)) throw new Error(`${title}: 형식이 올바르지 않습니다`);
  return v;
}

async function getAuth() {
  let refresh;
  if (Keychain.contains(KC_TOKEN)) {
    refresh = Keychain.get(KC_TOKEN);
  } else {
    refresh = await askSecret('GOGO 토큰 등록', 'GOGO 앱 🔑 단축어 토큰을 붙여넣으세요.\n(iOS 키체인에만 저장)', 'refresh token', (v) => v.startsWith('AMf-'));
    Keychain.set(KC_TOKEN, refresh);
    if (Keychain.contains(KC_PROFILE)) Keychain.remove(KC_PROFILE);
  }
  const req = new Request(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`);
  req.method = 'POST';
  req.timeoutInterval = 15;
  req.headers = { 'Content-Type': 'application/json' };
  req.body = JSON.stringify({ grant_type: 'refresh_token', refresh_token: refresh });
  let res;
  try {
    res = await req.loadJSON();
  } catch (e) {
    throw netError('네트워크 오류 (토큰 교환)');
  }
  if (!res || !res.id_token) {
    const code = res && res.error ? res.error.message : '응답 없음';
    if (/TOKEN|INVALID|USER_DISABLED|USER_NOT_FOUND/.test(code)) {
      Keychain.remove(KC_TOKEN);
      throw new Error(`토큰 만료/폐기 (${code}) → Scriptable 앱에서 다시 실행해 새 토큰 등록`);
    }
    throw new Error(`토큰 교환 실패: ${code}`);
  }
  return { idToken: res.id_token, uid: res.user_id };
}

async function db(method, path, auth, body) {
  const req = new Request(`${DB_URL}/${path}.json?auth=${encodeURIComponent(auth.idToken)}`);
  req.method = method;
  req.timeoutInterval = 15;
  if (body !== undefined) {
    req.headers = { 'Content-Type': 'application/json' };
    req.body = JSON.stringify(body);
  }
  let text;
  try {
    text = await req.loadString();
  } catch (e) {
    throw netError(`네트워크 오류 (${method} ${path})`);
  }
  const status = req.response ? req.response.statusCode : 0;
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  if (status < 200 || status >= 300) {
    const msg = json && json.error ? json.error : `HTTP ${status}`;
    throw new Error(`${method} ${path} 실패: ${msg}`);
  }
  return json;
}

async function getAuthor(auth) {
  if (Keychain.contains(KC_PROFILE)) {
    const cached = Keychain.get(KC_PROFILE);
    if (cached === 'jinse' || cached === 'jihye') return cached === 'jihye' ? '지혜' : '진세';
  }
  const profile = await db('GET', `members/${auth.uid}`, auth);
  if (profile !== 'jinse' && profile !== 'jihye') throw new Error('가족 계정으로 등록되지 않은 토큰입니다 (members 확인)');
  Keychain.set(KC_PROFILE, profile);
  return profile === 'jihye' ? '지혜' : '진세';
}

/* ── 카카오 길찾기 ─────────────────────────────────── */
async function kakaoRoute(key, from, to) {
  const url = `${KAKAO_URL}?origin=${from.lng},${from.lat}&destination=${to.lng},${to.lat}&priority=RECOMMEND`;
  const req = new Request(url);
  req.method = 'GET';
  req.timeoutInterval = 15;
  req.headers = { Authorization: `KakaoAK ${key}` };
  let res;
  try {
    res = await req.loadJSON();
  } catch (e) {
    throw netError('네트워크 오류 (카카오 길찾기)');
  }
  const status = req.response ? req.response.statusCode : 0;
  if (status === 401 || status === 403) {
    const err = new Error(`카카오 키 오류 (HTTP ${status}) — REST API 키·길찾기 사용 설정 확인`);
    err.kakaoKey = true;
    throw err;
  }
  if (status < 200 || status >= 300) throw netError(`카카오 HTTP ${status}`);
  const r = res && Array.isArray(res.routes) ? res.routes[0] : null;
  if (!r) throw new Error('카카오 응답에 경로가 없습니다');
  if (r.result_code !== 0 || !r.summary) return { ok: false, code: r.result_code, msg: r.result_msg || '' };
  return { ok: true, distanceM: Number(r.summary.distance) || 0, durationS: Number(r.summary.duration) || 0 };
}

async function getKakaoKey() {
  if (Keychain.contains(KC_KAKAO)) return Keychain.get(KC_KAKAO);
  const v = await askSecret('카카오 REST 키 등록', '카카오 디벨로퍼스 → 내 애플리케이션 → 앱 키 → REST API 키', 'REST API 키', (s) => /^[0-9a-f]{32}$/i.test(s));
  const test = await kakaoRoute(v, { lat: 36.642434, lng: 127.489031 }, { lat: 36.628, lng: 127.43 });
  if (!test.ok && test.code === undefined) throw new Error('카카오 키 시험 호출 실패');
  Keychain.set(KC_KAKAO, v);
  return v;
}

/* ── 대기열 처리 (도착 건 → trip_logs) ─────────────── */
async function processQueue(state, auth, author, notes) {
  if (!state.queue.length) return;
  const now = Date.now();
  const kept = [];
  let kakaoKey = null;
  let stop = false;

  for (const item of state.queue) {
    if (stop) { kept.push(item); continue; }
    if (!item || !validPoint(item.from) || !validPoint(item.to) || !item.startId || !item.endMs) continue;
    if (now - item.endMs > QUEUE_MAX_AGE_MS) {
      notes.push(`🗑 ${item.carName} ${kstTimeText(item.endMs)} 미전송 운행 7일 경과로 폐기`);
      continue;
    }
    try {
      if (!kakaoKey) kakaoKey = await getKakaoKey();
      const route = await kakaoRoute(kakaoKey, item.from, item.to);
      const startMs = msFromKstId(item.startId);
      const elapsedMin = Math.max(0, Math.round((item.endMs - startMs) / 60000));

      let saved = null;
      if (route.ok) {
        const km = Math.round(route.distanceM / 100) / 10;
        const routeMin = Math.round(route.durationS / 60);
        if (!(km < 1 && elapsedMin < 10)) {
          const tid = kstId(item.endMs);
          const flag = km < 1 ? 'roundtrip_suspect' : 'ok';
          const rec = {
            id: tid,
            startId: Number(item.startId),
            car: item.carName,
            from: { lat: item.from.lat, lng: item.from.lng },
            to: { lat: item.to.lat, lng: item.to.lng },
            distance_km: Math.min(km, 1000),
            route_min: routeMin,
            elapsed_min: elapsedMin,
            flag,
            source: 'kakao_est',
            author: item.author || author,
            time: kstTimeText(item.endMs)
          };
          await db('PUT', `${PATHS.trips}/${tid}`, auth, rec);
          saved = rec;
          if (flag === 'roundtrip_suspect') notes.push(`⚠️ ${item.carName} 왕복 의심 (${elapsedMin}분, ${km}km) → 앱에서 실제 거리 입력`);
        }
      } else if (route.code !== 104) {
        notes.push(`⚠️ ${item.carName} 경로 계산 불가 (카카오 ${route.code} ${route.msg}) — 기록 생략`);
      }

      /* 같은 출발 건의 pending 만 삭제 (새 운행 pending 보호) */
      try {
        const remote = await db('GET', `${PATHS.pending}/${item.carKey}`, auth);
        if (remote && String(remote.startId) === String(item.startId)) await db('DELETE', `${PATHS.pending}/${item.carKey}`, auth);
      } catch (e) {
        if (e.network) throw e;
        console.warn(`pending 정리 실패: ${e.message}`);
      }
      if (saved) console.log(`저장: ${saved.car} ${saved.distance_km}km`);
    } catch (e) {
      if (e.network || e.kakaoKey || e.needSetup) {
        kept.push(item);
        stop = true;
        if (e.kakaoKey || e.needSetup) notes.push(`⚠️ ${e.message} (미전송 ${state.queue.length}건 보관 중)`);
      } else {
        notes.push(`⚠️ ${item.carName} 운행 저장 실패: ${e.message}`);
      }
    }
  }
  state.queue = kept;
}

/* ── 출발 ─────────────────────────────────────────── */
async function onStart(car, notes) {
  const state = loadState();
  const now = Date.now();
  const prev = state.pending[car.key];

  if (prev && now - prev.startMs < RECONNECT_KEEP_MS) {
    console.log('30분 이내 재연결 — 기존 출발 정보 유지');
  } else {
    let point = await currentPoint();
    let src = 'gps';
    if (!point && validPoint(state.lastEnd[car.key])) {
      point = { lat: state.lastEnd[car.key].lat, lng: state.lastEnd[car.key].lng };
      src = 'last_end';
    }
    if (!point) {
      notes.push(`⚠️ ${car.name} 출발 위치를 알 수 없어 이번 운행은 기록하지 않습니다 (GPS 실패·이전 도착 좌표 없음)`);
      delete state.pending[car.key];
      saveState(state);
      return `⚠️ ${car.name} 출발 위치 없음`;
    }
    state.pending[car.key] = {
      startId: kstId(now),
      startMs: now,
      startIso: new Date(now).toISOString(),
      lat: point.lat,
      lng: point.lng,
      src,
      synced: false
    };
  }
  saveState(state);

  try {
    const auth = await getAuth();
    const author = await getAuthor(auth);
    const p = state.pending[car.key];
    if (!p.synced) {
      await db('PUT', `${PATHS.pending}/${car.key}`, auth, { startId: p.startId, startIso: p.startIso, lat: p.lat, lng: p.lng });
      p.synced = true;
    }
    await processQueue(state, auth, author, notes);
    saveState(state);
    return `🟢 ${car.name} 운행 시작 (${p.src === 'gps' ? 'GPS' : '직전 도착 위치'})`;
  } catch (e) {
    if (e.network) return `🟢 ${car.name} 운행 시작 (기기 저장, 서버 반영 대기)`;
    notes.push(`⚠️ ${e.message}`);
    return `⚠️ ${car.name} 출발 서버 반영 실패`;
  }
}

/* ── 도착 ─────────────────────────────────────────── */
async function onEnd(car, notes) {
  const state = loadState();
  const now = Date.now();
  let start = state.pending[car.key];
  let auth = null;
  let author = '진세';

  try {
    auth = await getAuth();
    author = await getAuthor(auth);
  } catch (e) {
    if (!e.network) notes.push(`⚠️ ${e.message}`);
  }

  if (!start && auth) {
    try {
      const remote = await db('GET', `${PATHS.pending}/${car.key}`, auth);
      if (remote && remote.startId && isNum(remote.lat) && isNum(remote.lng)) {
        start = { startId: remote.startId, startMs: msFromKstId(remote.startId), lat: remote.lat, lng: remote.lng };
      }
    } catch (e) {
      console.warn(`원격 pending 조회 실패: ${e.message}`);
    }
  }

  if (!start || !isNum(start.startMs) || now - start.startMs > STALE_PENDING_MS) {
    delete state.pending[car.key];
    if (auth) {
      try { await processQueue(state, auth, author, notes); } catch (e) { console.warn(e.message); }
    }
    saveState(state);
    return `⏹ ${car.name} 진행 중인 운행 없음`;
  }

  const to = await currentPoint();
  delete state.pending[car.key];

  if (!to) {
    saveState(state);
    notes.push(`⚠️ ${car.name} 도착 GPS 실패 — 이번 운행 기록 생략 (월 1회 계기판 입력으로 보정)`);
    if (auth) {
      try {
        const remote = await db('GET', `${PATHS.pending}/${car.key}`, auth);
        if (remote && String(remote.startId) === String(start.startId)) await db('DELETE', `${PATHS.pending}/${car.key}`, auth);
      } catch (e) {
        console.warn(`pending 정리 실패: ${e.message}`);
      }
    }
    return `⚠️ ${car.name} 도착 위치 없음`;
  }

  state.lastEnd[car.key] = { lat: to.lat, lng: to.lng, at: now };
  state.queue.push({
    carKey: car.key,
    carName: car.name,
    startId: Number(start.startId),
    from: { lat: start.lat, lng: start.lng },
    to,
    endMs: now,
    author
  });
  saveState(state);

  if (!auth) return `⏳ ${car.name} 도착 — 기기 보관 (다음 실행 때 저장)`;
  try {
    await processQueue(state, auth, author, notes);
  } catch (e) {
    console.warn(e.message);
  }
  saveState(state);
  return state.queue.length
    ? `⏳ ${car.name} 도착 — 미전송 ${state.queue.length}건 기기 보관`
    : `🏁 ${car.name} 운행 기록 완료`;
}

/* ── 앱 안 수동 실행 메뉴 ──────────────────────────── */
async function inAppMenu() {
  const a = new Alert();
  a.title = 'GOGO 주행 기록';
  const st = loadState();
  const pend = Object.keys(st.pending).map((k) => `${k === 'x1' ? 'X1' : '엑센트'} 운행 중`).join(', ');
  a.message = `대기열 ${st.queue.length}건${pend ? ` · ${pend}` : ''}`;
  const actions = [
    ['X1 출발', { car: 'X1', phase: 'start' }],
    ['X1 도착', { car: 'X1', phase: 'end' }],
    ['엑센트 출발', { car: 'accent', phase: 'start' }],
    ['엑센트 도착', { car: 'accent', phase: 'end' }],
    ['카카오 키 다시 등록', { reset: 'kakao' }],
    ['토큰 다시 등록', { reset: 'token' }]
  ];
  actions.forEach(([label]) => a.addAction(label));
  a.addCancelAction('닫기');
  const idx = await a.present();
  if (idx === -1) return null;
  return actions[idx][1];
}

async function main() {
  let input = readInput();
  if (!input && config.runsInApp) input = await inAppMenu();
  if (!input) return { text: '⏹ 입력이 없어 종료했습니다.', notes: [] };

  if (input.reset === 'kakao') {
    if (Keychain.contains(KC_KAKAO)) Keychain.remove(KC_KAKAO);
    await getKakaoKey();
    return { text: '✅ 카카오 키 등록 완료', notes: [] };
  }
  if (input.reset === 'token') {
    if (Keychain.contains(KC_TOKEN)) Keychain.remove(KC_TOKEN);
    if (Keychain.contains(KC_PROFILE)) Keychain.remove(KC_PROFILE);
    await getAuth();
    return { text: '✅ 토큰 등록 완료', notes: [] };
  }

  const car = carInfo(input.car);
  if (!car) throw new Error(`차량 값 오류: "${input.car}" (X1 또는 accent)`);
  const phase = String(input.phase || '').trim().toLowerCase();
  const notes = [];
  if (phase === 'start') return { text: await onStart(car, notes), notes };
  if (phase === 'end') return { text: await onEnd(car, notes), notes };
  throw new Error(`phase 값 오류: "${input.phase}" (start 또는 end)`);
}

let out;
try {
  out = await main();
} catch (e) {
  out = { text: `⚠️ 주행 기록 실패: ${e.message}`, notes: [`⚠️ ${e.message}`] };
}
const summary = [out.text].concat(out.notes || []).join('\n');
console.log(summary);

if (config.runsInApp) {
  const a = new Alert();
  a.title = 'GOGO 주행 기록';
  a.message = summary;
  a.addAction('확인');
  await a.present();
} else if (out.notes && out.notes.length) {
  try {
    const n = new Notification();
    n.title = 'GOGO 주행 기록';
    n.body = out.notes.join('\n');
    await n.schedule();
  } catch (e) {
    console.warn(`알림 실패: ${e.message}`);
  }
}
Script.setShortcutOutput(summary);
Script.complete();
