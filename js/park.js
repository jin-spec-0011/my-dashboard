/**
 * GOGO 스마트 매니저 - 주차 입력 전용 페이지 (js/park.js)
 * - park.html?car=X1 | park.html?car=엑센트 로 진입 (단축어 "URL 열기")
 * - 인증: js/gauth.js 재사용 (Google/이메일 로그인 → members/{uid} = jinse | jihye)
 * - 저장: parking_logs 트랜잭션, 앱(app.js / parking.js)과 동일 스키마 · 차량별 최신 2개 유지
 * - 지하 주차장 통신 불량 대비: localStorage 대기열 → 재연결/재진입 시 자동 재전송
 * - 사진 미지원 (속도 우선), 야외 주차는 GPS 좌표 저장
 */
window.App = window.App || {};

/* gauth.js 가 참조하는 전역 (app.js 를 불러오지 않는 단독 페이지용) */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus',
  authDomain: 'gogo-manager-f0a68.firebaseapp.com',
  databaseURL: 'https://gogo-manager-f0a68-default-rtdb.firebaseio.com',
  projectId: 'gogo-manager-f0a68',
  storageBucket: 'gogo-manager-f0a68.firebasestorage.app',
  messagingSenderId: '1016084163074',
  appId: '1:1016084163074:web:836b8517d023638e12551b'
};

(function () {
  const memoryStorage = {};

  if (typeof window.safeGet !== 'function') {
    window.safeGet = function (key) {
      try {
        const v = localStorage.getItem(key);
        if (v !== null) return v;
      } catch (e) { /* 프라이빗 모드 등 */ }
      return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : '';
    };
  }

  if (typeof window.safeSet !== 'function') {
    window.safeSet = function (key, val) {
      memoryStorage[key] = String(val);
      try {
        localStorage.setItem(key, String(val));
      } catch (e) {
        console.warn('[Park] localStorage 저장 실패, 메모리 보관:', key);
      }
    };
  }

  if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function (str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };
  }
})();

/* ── 앱(app.js)과 동일한 주차 헬퍼 ───────────────────────── */
function parkTimeOf(item) {
  if (!item) return 0;
  const idStr = item.id !== undefined && item.id !== null ? String(item.id).trim() : '';
  if (/^\d{14}$/.test(idStr) && idStr.startsWith('20')) {
    const y = parseInt(idStr.substring(0, 4), 10);
    const mo = parseInt(idStr.substring(4, 6), 10) - 1;
    const d = parseInt(idStr.substring(6, 8), 10);
    const h = parseInt(idStr.substring(8, 10), 10);
    const mi = parseInt(idStr.substring(10, 12), 10);
    const s = parseInt(idStr.substring(12, 14), 10);
    return Date.UTC(y, mo, d, h, mi, s) - 9 * 3600000;
  }
  if (/^\d{13}$/.test(idStr)) return Number(idStr);
  if (/^\d{10}$/.test(idStr)) return Number(idStr) * 1000;
  if (item.time) {
    const m = String(item.time).match(/(\d+)월\s*(\d+)일\s*(\d+):(\d+)/);
    if (m) {
      const nowKst = new Date(Date.now() + 9 * 3600000);
      let year = nowKst.getUTCFullYear();
      let t = Date.UTC(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)) - 9 * 3600000;
      if (t > Date.now() + 86400000) {
        year -= 1;
        t = Date.UTC(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)) - 9 * 3600000;
      }
      return t;
    }
  }
  return Number(idStr) || 0;
}

function parkCarKeyOf(item) {
  const c = String((item && (item.car || item.text)) || '').toLowerCase();
  return c.includes('x1') ? 'x1' : 'accent';
}

function parkSanitize(items) {
  if (!Array.isArray(items)) return [];
  const sorted = [...items].sort((a, b) => parkTimeOf(b) - parkTimeOf(a));
  const kept = { x1: [], accent: [] };
  sorted.forEach((it) => {
    const key = parkCarKeyOf(it);
    if (kept[key].length < 2) kept[key].push(it);
  });
  return [...kept.x1, ...kept.accent].sort((a, b) => parkTimeOf(b) - parkTimeOf(a));
}

function parkNormalize(raw) {
  if (!raw) return [];
  const arr = (Array.isArray(raw) ? raw : Object.values(raw)).filter((it) => it && typeof it === 'object');
  arr.forEach((it) => {
    if (it.id === undefined || it.id === null || it.id === '') {
      it.id = Date.now() + Math.floor(Math.random() * 1000);
    }
  });
  return arr.sort((a, b) => parkTimeOf(b) - parkTimeOf(a));
}

function parkToRemote(list) {
  const obj = {};
  list.forEach((it) => { obj[String(it.id)] = it; });
  return Object.keys(obj).length ? obj : null;
}

function kstParts(ms) {
  const kst = new Date(ms + 9 * 3600000);
  return {
    y: kst.getUTCFullYear(),
    mo: kst.getUTCMonth() + 1,
    d: kst.getUTCDate(),
    h: kst.getUTCHours(),
    mi: kst.getUTCMinutes(),
    s: kst.getUTCSeconds()
  };
}

function kstIdFrom(ms) {
  const p = kstParts(ms);
  const z = (n) => String(n).padStart(2, '0');
  return Number(`${p.y}${z(p.mo)}${z(p.d)}${z(p.h)}${z(p.mi)}${z(p.s)}`);
}

function kstTimeText(ms) {
  const p = kstParts(ms);
  return `${p.mo}월 ${p.d}일 ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

/* ── 토스트 (gauth.js 가 App.ui.toast 사용) ─────────────── */
App.ui = App.ui || {
  _timer: null,
  toast(msg) {
    const t = document.getElementById('parkToast');
    if (!t) return;
    t.textContent = String(msg || '');
    t.classList.add('show');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }
};

/* ── 주차 입력 페이지 ───────────────────────────────────── */
App.park = {
  QUEUE_KEY: 'park_queue_v1',
  COMMIT_TIMEOUT_MS: 10000,
  CARS: ['X1', '엑센트'],
  FLOORS: ['B1', 'B2', 'B3'],

  db: null,
  ready: false,
  flushing: false,
  state: {
    car: '',
    kind: 'indoor',
    floor: 'B1',
    slotNum: '18',
    slotCol: 'A',
    lat: null,
    lng: null,
    acc: null
  },

  /* Phase 1 멀티테넌트 전환 시 이 함수만 families/{fid}/parking_logs 로 변경 */
  parkingPath() {
    return 'parking_logs';
  },

  el(id) {
    return document.getElementById(id);
  },

  boot() {
    this.buildSlotSelects();
    this.bindEvents();

    const params = new URLSearchParams(window.location.search);
    const carParam = this.normalizeCar(params.get('car'));
    this.selectCar(carParam || safeGet('park_last_car') || 'X1');
    this.selectKind(params.get('type') === 'outdoor' ? 'outdoor' : 'indoor');
    this.renderPending();

    window.addEventListener('online', () => this.flushQueue(false));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.flushQueue(false);
    });

    if (!App.gauth || typeof App.gauth.start !== 'function') {
      this.showResult('err', '⚠️ 로그인 모듈을 불러오지 못했습니다. 새로고침해주세요.');
      this.el('parkApp').hidden = false;
      return;
    }
    App.gauth.start(() => this.onReady());
  },

  onReady() {
    try {
      this.db = firebase.database();
      this.ready = true;
    } catch (e) {
      console.error('[Park] DB 초기화 실패', e);
      this.showResult('err', '⚠️ 서버 연결에 실패했습니다. 새로고침해주세요.');
      return;
    }
    this.el('parkApp').hidden = false;
    const name = this.authorName();
    this.el('parkUser').textContent = name ? `👤 ${name}` : '';
    this.loadRemoteHints();
    this.flushQueue(false);
  },

  authorName() {
    const p = App.gauth ? App.gauth.profile : null;
    if (p === 'jihye') return '지혜';
    if (p === 'jinse') return '진세';
    return '';
  },

  normalizeCar(v) {
    const s = String(v || '').trim().toLowerCase();
    if (!s) return '';
    if (s === 'x1') return 'X1';
    if (s === '엑센트' || s === 'accent') return '엑센트';
    return '';
  },

  buildSlotSelects() {
    const num = this.el('slotNum');
    const col = this.el('slotCol');
    if (num && !num.options.length) {
      for (let i = 1; i <= 50; i++) num.add(new Option(String(i), String(i)));
    }
    if (col && !col.options.length) {
      for (let c = 65; c <= 90; c++) {
        const ch = String.fromCharCode(c);
        col.add(new Option(ch, ch));
      }
    }
  },

  bindEvents() {
    const onGroup = (groupId, fn) => {
      const g = this.el(groupId);
      if (!g) return;
      g.addEventListener('click', (ev) => {
        const btn = ev.target.closest('.btn-opt');
        if (btn && g.contains(btn)) fn(btn.getAttribute('data-value'));
      });
    };
    onGroup('carGroup', (v) => this.selectCar(v));
    onGroup('typeGroup', (v) => this.selectKind(v));
    onGroup('floorGroup', (v) => this.selectFloor(v));

    this.el('slotNum').addEventListener('change', (e) => { this.state.slotNum = e.target.value; this.renderSlot(); });
    this.el('slotCol').addEventListener('change', (e) => { this.state.slotCol = e.target.value; this.renderSlot(); });

    this.el('recentChips').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      const m = /^(\d{1,2})([A-Z])$/.exec(chip.getAttribute('data-slot') || '');
      if (!m) return;
      this.setSlot(m[1], m[2]);
    });

    this.el('btnGps').addEventListener('click', () => this.requestGps());
    this.el('btnSave').addEventListener('click', () => this.save());
  },

  setActive(groupId, value) {
    document.querySelectorAll(`#${groupId} .btn-opt`).forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-value') === value);
    });
  },

  carKey(car) {
    return car === 'X1' ? 'x1' : 'accent';
  },

  selectCar(car) {
    const c = this.normalizeCar(car) || 'X1';
    this.state.car = c;
    this.setActive('carGroup', c);
    const key = this.carKey(c);
    const lastFloor = safeGet(`park_last_floor_${key}`);
    this.selectFloor(this.FLOORS.includes(lastFloor) ? lastFloor : 'B1');
    const recent = this.getRecent(key);
    if (recent.length) {
      const m = /^(\d{1,2})([A-Z])$/.exec(recent[0]);
      if (m) this.setSlot(m[1], m[2]);
    }
    this.renderChips();
  },

  selectKind(kind) {
    const k = kind === 'outdoor' ? 'outdoor' : 'indoor';
    this.state.kind = k;
    this.setActive('typeGroup', k);
    this.el('indoorSection').hidden = k !== 'indoor';
    this.el('outdoorSection').hidden = k !== 'outdoor';
    if (k === 'outdoor' && (this.state.lat === null || this.state.lng === null)) this.requestGps();
  },

  selectFloor(floor) {
    const f = this.FLOORS.includes(floor) ? floor : 'B1';
    this.state.floor = f;
    this.setActive('floorGroup', f);
    this.renderSlot();
  },

  setSlot(num, col) {
    const n = parseInt(num, 10);
    if (!(n >= 1 && n <= 50) || !/^[A-Z]$/.test(col)) return;
    this.state.slotNum = String(n);
    this.state.slotCol = col;
    this.el('slotNum').value = String(n);
    this.el('slotCol').value = col;
    this.renderSlot();
  },

  slotText() {
    return `${this.state.slotNum}${this.state.slotCol}`;
  },

  renderSlot() {
    const pv = this.el('slotPreview');
    if (pv) pv.textContent = `${this.state.floor}-${this.slotText()}`;
    document.querySelectorAll('#recentChips .chip').forEach((c) => {
      c.classList.toggle('active', c.getAttribute('data-slot') === this.slotText());
    });
  },

  getRecent(key) {
    try {
      const arr = JSON.parse(safeGet(`park_recent_${key}`) || '[]');
      return Array.isArray(arr) ? arr.filter((s) => /^\d{1,2}[A-Z]$/.test(String(s))).slice(0, 3) : [];
    } catch (e) {
      return [];
    }
  },

  pushRecent(key, slot) {
    if (!/^\d{1,2}[A-Z]$/.test(slot)) return;
    const list = [slot, ...this.getRecent(key).filter((s) => s !== slot)].slice(0, 3);
    safeSet(`park_recent_${key}`, JSON.stringify(list));
  },

  renderChips() {
    const box = this.el('recentChips');
    if (!box) return;
    const recent = this.getRecent(this.carKey(this.state.car));
    box.innerHTML = recent.map((s) => `<button type="button" class="chip" data-slot="${escapeHtml(s)}">🕘 ${escapeHtml(s)}</button>`).join('');
    this.renderSlot();
  },

  /* 서버 최신 기록으로 차량별 직전 층·구역 보강 (기기에 기록이 없을 때) */
  loadRemoteHints() {
    if (!this.db) return;
    this.db.ref(this.parkingPath()).once('value').then((snap) => {
      const items = parkNormalize(snap.val());
      ['x1', 'accent'].forEach((key) => {
        const indoor = items.filter((it) => parkCarKeyOf(it) === key && !it.isOutdoor && it.type !== '야외');
        if (!safeGet(`park_last_floor_${key}`) && indoor[0] && this.FLOORS.includes(String(indoor[0].floor))) {
          safeSet(`park_last_floor_${key}`, String(indoor[0].floor));
        }
        if (!this.getRecent(key).length) {
          indoor.slice().reverse().forEach((it) => {
            const s = String(it.slot || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
            if (/^\d{1,2}[A-Z]$/.test(s)) this.pushRecent(key, s);
          });
        }
      });
      this.selectCar(this.state.car);
    }).catch((e) => console.warn('[Park] 최근 기록 조회 실패', e));
  },

  requestGps() {
    const status = this.el('gpsStatus');
    if (!navigator.geolocation) {
      status.textContent = '❌ 이 기기는 GPS를 지원하지 않습니다.';
      return;
    }
    status.textContent = '🔄 GPS 좌표 수신 중...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!isFinite(latitude) || !isFinite(longitude)) {
          status.textContent = '⚠️ 좌표 값이 올바르지 않습니다. 다시 받아주세요.';
          return;
        }
        this.state.lat = Number(latitude.toFixed(6));
        this.state.lng = Number(longitude.toFixed(6));
        this.state.acc = Math.round(accuracy || 0);
        status.textContent = `📍 ${this.state.lat}, ${this.state.lng} (±${this.state.acc}m)`;
      },
      (err) => {
        console.warn('[Park] GPS 실패', err);
        const msg = err && err.code === 1
          ? '⚠️ 위치 권한이 거부되었습니다.\n설정 → 개인정보 보호 → 위치 서비스 → Safari 웹 사이트 → "앱을 사용하는 동안"'
          : '⚠️ GPS 수신 실패. 하늘이 보이는 곳에서 다시 받아주세요.';
        status.textContent = msg;
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  },

  sanitizeMemo(v) {
    return String(v || '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/[<>]/g, '')
      .trim()
      .slice(0, 20);
  },

  buildRecord() {
    const car = this.normalizeCar(this.state.car);
    if (!car) throw new Error('차량을 선택하세요.');
    const author = this.authorName();
    if (!author) throw new Error('로그인 정보를 확인할 수 없습니다. 새로고침해주세요.');

    const now = Date.now();
    let id = kstIdFrom(now);
    const queued = this.readQueue();
    while (queued.some((q) => Number(q.id) === id)) id += 1;

    const base = {
      id,
      car,
      author,
      time: kstTimeText(now),
      photoBase64: ''
    };

    if (this.state.kind === 'outdoor') {
      if (typeof this.state.lat !== 'number' || typeof this.state.lng !== 'number') {
        throw new Error('GPS 좌표가 없습니다. [위치 다시 받기]를 눌러주세요.');
      }
      const slot = this.sanitizeMemo(this.el('outdoorMemo').value) || 'GPS';
      return Object.assign(base, {
        floor: '야외',
        slot,
        text: `${car} - 야외-${slot}`,
        type: '야외',
        isOutdoor: true,
        lat: this.state.lat,
        lng: this.state.lng
      });
    }

    const floor = this.FLOORS.includes(this.state.floor) ? this.state.floor : '';
    const slot = this.slotText();
    if (!floor) throw new Error('층을 선택하세요.');
    if (!/^([1-9]|[1-4]\d|50)[A-Z]$/.test(slot)) throw new Error('구역 값이 올바르지 않습니다.');
    return Object.assign(base, {
      floor,
      slot,
      text: `${car} - ${floor}-${slot}`,
      type: '지하 주차장',
      isOutdoor: false
    });
  },

  readQueue() {
    try {
      const arr = JSON.parse(safeGet(this.QUEUE_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter((r) => r && typeof r === 'object' && r.id) : [];
    } catch (e) {
      return [];
    }
  },

  writeQueue(list) {
    safeSet(this.QUEUE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    this.renderPending();
  },

  renderPending() {
    const box = this.el('parkPending');
    if (!box) return;
    const n = this.readQueue().length;
    box.hidden = n === 0;
    box.textContent = n ? `⏳ 전송 대기 ${n}건 — 연결되면 자동으로 저장됩니다.` : '';
  },

  save() {
    const btn = this.el('btnSave');
    if (btn.disabled) return;
    let record;
    try {
      record = this.buildRecord();
    } catch (e) {
      this.showResult('err', `⚠️ ${e.message}`);
      return;
    }

    this.writeQueue([...this.readQueue(), record]);
    safeSet('park_last_car', record.car);
    if (!record.isOutdoor) {
      const key = this.carKey(record.car);
      safeSet(`park_last_floor_${key}`, record.floor);
      this.pushRecent(key, record.slot);
      this.renderChips();
    }

    btn.disabled = true;
    btn.textContent = '⏳ 저장 중...';
    this.flushQueue(true).finally(() => {
      btn.disabled = false;
      btn.textContent = '📌 저장';
    });
  },

  /* 대기열 전체를 트랜잭션 1회로 반영 (앱 commit 과 같은 방식 → 다른 기기 기록 보존) */
  flushQueue(fromSave) {
    const batch = this.readQueue();
    if (!batch.length) return Promise.resolve();
    if (!this.ready || !this.db) {
      if (fromSave) this.showResult('wait', '⏳ 로그인 확인 후 자동 저장됩니다.');
      return Promise.resolve();
    }
    if (this.flushing) return Promise.resolve();
    this.flushing = true;

    const ids = new Set(batch.map((r) => String(r.id)));
    const last = batch[batch.length - 1];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      this.showResult('wait', `⏳ 신호가 약해 전송 대기 중입니다.\n${escapeHtml(last.text)}\n연결되면 자동 저장됩니다. 이 화면을 닫아도 다음에 열 때 다시 보냅니다.`);
    }, this.COMMIT_TIMEOUT_MS);

    return this.db.ref(this.parkingPath()).transaction((current) => {
      const list = parkNormalize(current).filter((it) => !ids.has(String(it.id)));
      return parkToRemote(parkSanitize(list.concat(batch.map((r) => Object.assign({}, r)))));
    }, null, false).then((res) => {
      settled = true;
      clearTimeout(timer);
      if (!res || !res.committed) throw new Error('저장이 확정되지 않았습니다.');
      const remaining = this.readQueue().filter((r) => !ids.has(String(r.id)));
      this.writeQueue(remaining);
      const emoji = last.car === 'X1' ? '⚪' : '⚫';
      const where = last.isOutdoor ? `야외-${last.slot}` : `${last.floor}-${last.slot}`;
      const extra = batch.length > 1 ? `\n(대기 중이던 ${batch.length - 1}건 포함)` : '';
      this.showResult('ok', `✅ ${emoji} ${escapeHtml(last.car)} ${escapeHtml(where)} 저장 완료${extra}`);
      try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* 미지원 */ }
    }).catch((err) => {
      settled = true;
      clearTimeout(timer);
      console.error('[Park] 저장 실패', err);
      const code = String((err && (err.code || err.message)) || '');
      if (/permission/i.test(code)) {
        this.showResult('err', '⛔ 저장 권한이 없습니다.\n가족 계정으로 로그인했는지 확인해주세요.\n(기록은 기기에 보관 중)');
      } else {
        this.showResult('wait', '⏳ 서버 저장 실패 — 기기에 보관했습니다.\n연결되면 자동으로 다시 보냅니다.');
      }
    }).finally(() => {
      this.flushing = false;
      this.renderPending();
    });
  },

  showResult(kind, message) {
    const box = this.el('parkResult');
    if (!box) return;
    box.hidden = false;
    box.className = `park-result ${kind}`;
    box.innerHTML = String(message || '').split('\n').map((line) => line).join('<br>');
  }
};
