// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: car;
/**
 * GOGO 스마트 매니저 — 주차 기록 (Scriptable)
 * - iOS 단축어 "스크립트 실행"(앱에서 실행 끔)으로 백그라운드 저장, Safari 불필요
 * - 입력(단축어 사전): { car: "X1"|"accent"|"엑센트", floor: "B1"~"B3", slot: "18A" }
 *                    { car: "X1"|"accent", type: "outdoor", memo: "정문 옆"(선택) }
 * - 저장: parking_logs/{yyyyMMddHHmmss} PUT (앱 parking.js 규격과 동일) → 차량별 최신 2개만 유지
 * - 인증: refresh token(키체인) → id_token → ?auth=
 * - 통신 실패: 대기열 파일 보관 → 다음 실행 때 자동 재전송
 * - 단축어 출력: 결과 문구 (알림 표시 동작에 연결 가능)
 */

const API_KEY = 'AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus';
const DB_URL = 'https://gogo-manager-f0a68-default-rtdb.firebaseio.com';
const KC_TOKEN = 'gogo_refresh_token';
const KC_PROFILE = 'gogo_profile';
const FLOORS = ['B1', 'B2', 'B3'];
const GPS_TIMEOUT_MS = 12000;
const QUEUE_FILE = 'gogo-park-queue.json';

/* Phase 1 멀티테넌트 전환 시 여기만 'families/{fid}/parking_logs' 로 변경 */
const PARKING_PATH = 'parking_logs';

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

/* 앱 app.js parkingTime 과 동일 */
function parkTimeOf(item) {
  if (!item) return 0;
  const idStr = item.id !== undefined && item.id !== null ? String(item.id).trim() : '';
  if (/^\d{14}$/.test(idStr) && idStr.startsWith('20')) {
    return Date.UTC(+idStr.slice(0, 4), +idStr.slice(4, 6) - 1, +idStr.slice(6, 8), +idStr.slice(8, 10), +idStr.slice(10, 12), +idStr.slice(12, 14)) - 9 * 3600000;
  }
  if (/^\d{13}$/.test(idStr)) return Number(idStr);
  if (/^\d{10}$/.test(idStr)) return Number(idStr) * 1000;
  if (item.time) {
    const m = String(item.time).match(/(\d+)월\s*(\d+)일\s*(\d+):(\d+)/);
    if (m) {
      let year = kstParts(Date.now()).y;
      let t = Date.UTC(year, +m[1] - 1, +m[2], +m[3], +m[4]) - 9 * 3600000;
      if (t > Date.now() + 86400000) t = Date.UTC(year - 1, +m[1] - 1, +m[2], +m[3], +m[4]) - 9 * 3600000;
      return t;
    }
  }
  return Number(idStr) || 0;
}
function carKeyOf(item) {
  const c = String((item && (item.car || item.text)) || '').toLowerCase();
  return c.includes('x1') ? 'x1' : 'accent';
}

function normalizeCar(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'x1') return 'X1';
  if (s === 'accent' || s === '엑센트') return '엑센트';
  return '';
}
function cleanMemo(v) {
  return String(v || '').replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, 20);
}

/* ── 입력 → 레코드 ──────────────────────────────────── */
/* 단축어 입력: Parameter(사전) 우선, 없으면 Texts(사전이 JSON 텍스트로 전달됨)에서 찾음 */
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
    if (o && (o.car !== undefined || o.floor !== undefined || o.slot !== undefined || o.type !== undefined)) return o;
  }
  return null;
}

async function askInputInApp() {
  const a = new Alert();
  a.title = 'GOGO 주차 (수동 시험)';
  a.message = '차량: X1 또는 accent\n층: B1~B3, 구역: 예) 18A';
  a.addTextField('car', 'X1');
  a.addTextField('floor', 'B1');
  a.addTextField('slot', '18A');
  a.addAction('저장');
  a.addCancelAction('취소');
  const idx = await a.present();
  if (idx === -1) return null;
  return { car: a.textFieldValue(0), floor: a.textFieldValue(1), slot: a.textFieldValue(2) };
}

async function currentLocation() {
  Location.setAccuracyToBest();
  const timeout = new Promise((_, reject) => Timer.schedule(GPS_TIMEOUT_MS, false, () => reject(new Error('GPS 응답 시간 초과'))));
  const loc = await Promise.race([Location.current(), timeout]);
  if (!loc || !isFinite(loc.latitude) || !isFinite(loc.longitude)) throw new Error('GPS 좌표가 올바르지 않습니다');
  return { lat: Number(loc.latitude.toFixed(6)), lng: Number(loc.longitude.toFixed(6)) };
}

async function buildRecord(input, author) {
  const car = normalizeCar(input.car);
  if (!car) throw new Error(`차량 값 오류: "${input.car}" (X1 또는 accent)`);
  const now = Date.now();
  const base = { id: kstId(now), car, author, time: kstTimeText(now), photoBase64: '' };

  if (String(input.type || '').toLowerCase() === 'outdoor') {
    const pos = await currentLocation();
    const slot = cleanMemo(input.memo) || 'GPS';
    return Object.assign(base, { floor: '야외', slot, text: `${car} - 야외-${slot}`, type: '야외', isOutdoor: true, lat: pos.lat, lng: pos.lng });
  }

  const floor = String(input.floor || '').trim().toUpperCase();
  if (!FLOORS.includes(floor)) throw new Error(`층 값 오류: "${input.floor}" (B1~B3)`);
  const slot = String(input.slot || '').replace(/\s+/g, '').toUpperCase();
  if (!/^([1-9]|[1-4]\d|50)[A-Z]$/.test(slot)) throw new Error(`구역 값 오류: "${input.slot}" (1~50 + A~Z)`);
  return Object.assign(base, { floor, slot, text: `${car} - ${floor}-${slot}`, type: '지하 주차장', isOutdoor: false });
}

/* ── 인증 ─────────────────────────────────────────── */
async function askToken() {
  if (!config.runsInApp) throw new Error('토큰이 없습니다. Scriptable 앱에서 이 스크립트를 1회 실행해 토큰을 등록하세요.');
  const a = new Alert();
  a.title = 'GOGO 토큰 등록';
  a.message = 'GOGO 앱 🔑 단축어 토큰을 붙여넣으세요.\n(iOS 키체인에만 저장)';
  a.addSecureTextField('refresh token', '');
  a.addAction('저장');
  a.addCancelAction('취소');
  if (await a.present() === -1) throw new Error('토큰 입력 취소');
  const v = a.textFieldValue(0).trim();
  if (!v.startsWith('AMf-')) throw new Error('토큰 형식 오류 (AMf- 로 시작)');
  Keychain.set(KC_TOKEN, v);
  if (Keychain.contains(KC_PROFILE)) Keychain.remove(KC_PROFILE);
  return v;
}

async function getAuth() {
  const refresh = Keychain.contains(KC_TOKEN) ? Keychain.get(KC_TOKEN) : await askToken();
  const req = new Request(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`);
  req.method = 'POST';
  req.timeoutInterval = 15;
  req.headers = { 'Content-Type': 'application/json' };
  req.body = JSON.stringify({ grant_type: 'refresh_token', refresh_token: refresh });
  let res;
  try {
    res = await req.loadJSON();
  } catch (e) {
    const err = new Error('네트워크 오류 (토큰 교환)');
    err.network = true;
    throw err;
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

async function db(method, path, idToken, body) {
  const req = new Request(`${DB_URL}/${path}.json?auth=${encodeURIComponent(idToken)}`);
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
    const err = new Error(`네트워크 오류 (${method} ${path})`);
    err.network = true;
    throw err;
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
  const profile = await db('GET', `members/${auth.uid}`, auth.idToken);
  if (profile !== 'jinse' && profile !== 'jihye') throw new Error('가족 계정으로 등록되지 않은 토큰입니다 (members 확인)');
  Keychain.set(KC_PROFILE, profile);
  return profile === 'jihye' ? '지혜' : '진세';
}

/* ── 대기열 ───────────────────────────────────────── */
function queuePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), QUEUE_FILE);
}
function readQueue() {
  try {
    const fm = FileManager.local();
    const p = queuePath();
    if (!fm.fileExists(p)) return [];
    const arr = JSON.parse(fm.readString(p) || '[]');
    return Array.isArray(arr) ? arr.filter((r) => r && r.id) : [];
  } catch (e) {
    return [];
  }
}
function writeQueue(list) {
  try {
    FileManager.local().writeString(queuePath(), JSON.stringify(list || []));
  } catch (e) {
    console.warn(`대기열 저장 실패: ${e.message}`);
  }
}

/* ── 저장 + 차량별 최신 2개 정리 ─────────────────────── */
async function pushRecords(auth, records) {
  for (const r of records) {
    await db('PUT', `${PARKING_PATH}/${r.id}`, auth.idToken, r);
  }
  try {
    const all = await db('GET', PARKING_PATH, auth.idToken);
    if (!all || typeof all !== 'object') return;
    const items = Object.keys(all).map((k) => ({ key: k, item: all[k] })).filter((e) => e.item && typeof e.item === 'object');
    items.sort((a, b) => parkTimeOf(b.item) - parkTimeOf(a.item));
    const seen = { x1: 0, accent: 0 };
    const patch = {};
    items.forEach((e) => {
      const k = carKeyOf(e.item);
      seen[k] += 1;
      if (seen[k] > 2) patch[e.key] = null;
    });
    if (Object.keys(patch).length) await db('PATCH', PARKING_PATH, auth.idToken, patch);
  } catch (e) {
    console.warn(`정리 단계 실패(저장은 완료): ${e.message}`);
  }
}

async function notify(title, body) {
  try {
    const n = new Notification();
    n.title = title;
    n.body = body;
    await n.schedule();
  } catch (e) {
    console.warn(`알림 실패: ${e.message}`);
  }
}

/* ── 실행 ─────────────────────────────────────────── */
async function main() {
  let input = readInput();
  if (!input && config.runsInApp) input = await askInputInApp();
  if (!input) return '⏹ 입력이 없어 종료했습니다.';

  let auth;
  let record;
  try {
    auth = await getAuth();
    const author = await getAuthor(auth);
    record = await buildRecord(input, author);
  } catch (e) {
    if (e.network) {
      return `⏳ 네트워크 오류로 저장하지 못했습니다. 신호가 잡히는 곳에서 다시 실행해 주세요.`;
    }
    throw e;
  }

  const queued = readQueue();
  while (queued.some((q) => Number(q.id) === record.id)) record.id += 1;
  const batch = queued.concat([record]);

  try {
    await pushRecords(auth, batch);
    writeQueue([]);
  } catch (e) {
    if (e.network) {
      writeQueue(batch);
      return `⏳ 신호 약함 — ${record.text} 기기에 보관 (대기 ${batch.length}건, 다음 실행 때 자동 저장)`;
    }
    throw e;
  }

  const emoji = record.car === 'X1' ? '⚪' : '⚫';
  const extra = queued.length ? ` (대기 ${queued.length}건 포함)` : '';
  return `✅ ${emoji} ${record.text} 저장${extra}`;
}

let result;
try {
  result = await main();
} catch (e) {
  result = `⚠️ 주차 저장 실패: ${e.message}`;
}
console.log(result);
if (!config.runsInApp) await notify('GOGO 주차', result);
else {
  const a = new Alert();
  a.title = 'GOGO 주차';
  a.message = result;
  a.addAction('확인');
  await a.present();
}
Script.setShortcutOutput(result);
Script.complete();
