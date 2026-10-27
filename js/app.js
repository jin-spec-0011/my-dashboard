/**
 * GOGO 스마트 매니저 - 코어 (js/app.js)
 * - 공용 헬퍼(escapeHtml, sha256, safeGet/safeSet, parkingTime)
 * - Firebase 초기화 + 경로별 단일 실시간 리스너
 * - 로컬스토리지 캐시 + Firebase 트랜잭션 저장 데이터 스토어
 * - 라우터 / 토스트 / 대시보드 라이브 요약 / N 뱃지
 */

/* ══════════════════════════════════════════════════
   1. 공용 헬퍼
   ══════════════════════════════════════════════════ */
window.escapeHtml = function (str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/* crypto.subtle 미지원 환경(webOS 구형 런타임, http 접속)용 순수 JS SHA-256 */
function sha256Fallback(ascii) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const utf8 = unescape(encodeURIComponent(ascii));
  const words = [];
  const bitLength = utf8.length * 8;
  const hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (Math.pow(candidate, 0.5) * 4294967296) | 0;
      k[primeCounter++] = (Math.pow(candidate, 1 / 3) * 4294967296) | 0;
    }
  }
  let str = utf8 + '\x80';
  while ((str.length % 64) - 56) str += '\x00';
  for (let i = 0; i < str.length; i++) {
    const j = str.charCodeAt(i);
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (bitLength / 4294967296) | 0;
  words[words.length] = bitLength;
  let h = hash.slice(0, 8);
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, (j += 16));
    const oldHash = h;
    h = h.slice(0, 8);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = h[0];
      const e = h[4];
      const temp1 = h[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & h[5]) ^ (~e & h[6]))
        + k[i]
        + (w[i] = i < 16 ? w[i] : (
          w[i - 16]
          + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & h[1]) ^ (a & h[2]) ^ (h[1] & h[2]));
      h = [(temp1 + temp2) | 0].concat(h);
      h[4] = (h[4] + temp1) | 0;
      h.length = 8;
    }
    for (let i = 0; i < 8; i++) h[i] = (h[i] + oldHash[i]) | 0;
  }
  let result = '';
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (h[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

window.sha256 = async function (str) {
  try {
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {
    console.warn('[sha256] subtle 실패, JS 폴백 사용:', e);
  }
  return sha256Fallback(String(str));
};

const memoryStorage = {};
window.safeGet = function (key) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) { /* 프라이빗 모드 등 */ }
  return Object.prototype.hasOwnProperty.call(memoryStorage, key) ? memoryStorage[key] : '';
};

window.safeSet = function (key, val) {
  memoryStorage[key] = String(val);
  try {
    localStorage.setItem(key, String(val));
  } catch (e) {
    console.warn('[safeSet] localStorage 저장 실패(용량/권한), 메모리 보관:', key);
  }
};

window.todayStr = function () {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split('T')[0];
};

/**
 * 주차 기록 타임스탬프 정규화 (ms)
 * - 14자리 yyyyMMddHHmmss (iOS 단축어 / 신규 앱 저장) → KST 기준 해석
 * - 13자리 epoch ms (구버전 앱 저장)
 * - 10자리 epoch sec
 * - 그 외 "M월 d일 HH:mm" time 문자열
 * 14자리(2.0e13)와 13자리(1.7e12)를 Number(id)로 직접 비교하면 항상 14자리가 최신으로 판정되는 버그를 차단한다.
 */
window.parkingTime = function (item) {
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
};

/* yyyyMMddHHmmss (KST) 14자리 정수 id - iOS 단축어 규격과 동일 */
window.generateKstId = function () {
  const kst = new Date(Date.now() + 9 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return Number(`${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}${p(kst.getUTCSeconds())}`);
};

window.carKeyOf = function (item) {
  const c = String((item && (item.car || item.text)) || '').toLowerCase();
  return c.includes('x1') ? 'x1' : 'accent';
};

/* 🚗 차량별 최신 2개 보장 */
function sanitizeParking(items) {
  if (!Array.isArray(items)) return [];
  const sorted = [...items].sort((a, b) => parkingTime(b) - parkingTime(a));
  const kept = { x1: [], accent: [] };
  sorted.forEach((it) => {
    const key = carKeyOf(it);
    if (kept[key].length < 2) kept[key].push(it);
  });
  return [...kept.x1, ...kept.accent].sort((a, b) => parkingTime(b) - parkingTime(a));
}

/* ══════════════════════════════════════════════════
   2. 데이터 스토어 (로컬 캐시 + Firebase)
   ══════════════════════════════════════════════════ */
function createDataStore({ key, firebasePath, maxItems = 500, onRender, sanitizer, timeOf, keyed = false }) {
  let items = [];
  let synced = false;
  const getTime = timeOf || ((it) => Number(it && it.id) || 0);
  const sortList = (list) => list.sort((a, b) => getTime(b) - getTime(a));

  const normalizeItems = (raw) => {
    if (!raw) return [];
    const arr = (Array.isArray(raw) ? raw : Object.values(raw))
      .filter((it) => it && typeof it === 'object');
    arr.forEach((it) => {
      if (it.id === undefined || it.id === null || it.id === '') {
        it.id = Date.now() + Math.floor(Math.random() * 1000);
      }
    });
    let out = sortList(arr);
    if (sanitizer) out = sanitizer(out);
    else if (maxItems) out = out.slice(0, maxItems);
    return out;
  };

  const toRemote = (list) => {
    if (!keyed) return list.length ? list : null;
    const obj = {};
    list.forEach((it) => { obj[String(it.id)] = it; });
    return Object.keys(obj).length ? obj : null;
  };

  const refreshUI = () => {
    try { if (onRender) onRender(items); } catch (e) { console.error(`[Store:${key}] render 오류`, e); }
    try { if (App.summary) App.summary.refresh(); } catch (e) { console.error(e); }
    try { if (App.badge) App.badge.refresh(); } catch (e) { console.error(e); }
  };

  const persistLocal = () => {
    try {
      safeSet(key, JSON.stringify(items));
    } catch (e) {
      console.warn(`[Store:${key}] 로컬 저장 실패`, e);
    }
  };

  /* 원격 최신값 기준으로 변경 적용 → 다른 기기 데이터 덮어쓰기 방지 */
  const commit = (mutator) => {
    items = normalizeItems(mutator(items.slice()));
    persistLocal();
    refreshUI();

    if (!(App.isFirebaseActive && App.db && firebasePath)) return Promise.resolve();
    return App.db.ref(firebasePath).transaction((current) => {
      return toRemote(normalizeItems(mutator(normalizeItems(current))));
    }, null, false).then((res) => {
      if (res && res.snapshot) {
        items = normalizeItems(res.snapshot.val());
        persistLocal();
        refreshUI();
      }
    }).catch((err) => {
      console.error(`[Store:${key}] Firebase 저장 실패`, err);
      if (App.ui) App.ui.toast('⚠️ 서버 저장 실패 - 네트워크를 확인해주세요.');
    });
  };

  const load = () => {
    try {
      items = normalizeItems(JSON.parse(safeGet(key) || '[]'));
    } catch (e) {
      items = [];
    }
    refreshUI();
  };

  const add = (item) => commit((list) => [item, ...list.filter((i) => String(i.id) !== String(item.id))]);

  const remove = (id) => commit((list) => list.filter((i) => String(i.id) !== String(id)));

  const update = (id, patch) => commit((list) => list.map((i) => (
    String(i.id) === String(id) ? Object.assign({}, i, patch) : i
  )));

  const clearAll = () => commit(() => []);

  const syncFromFirebase = (data, notifyConfig) => {
    const oldLatest = items.length ? getTime(items[0]) : 0;
    const wasSynced = synced;
    items = normalizeItems(data);
    synced = true;
    persistLocal();

    if (wasSynced && notifyConfig && items.length && getTime(items[0]) > oldLatest && oldLatest > 0) {
      const latest = items[0];
      const user = App.auth ? App.auth.currentUser : 'public';
      const isMine = (user === 'jinse' && latest.author === '진세') || (user === 'jihye' && latest.author === '지혜');
      if (!isMine) {
        try {
          const title = notifyConfig.title(latest);
          const body = notifyConfig.body(latest);
          if (App.push && App.push.sendLocalNotification) App.push.sendLocalNotification(title, body);
          if (App.ui) App.ui.toast(`🔔 ${title}`);
        } catch (e) { console.warn(e); }
      }
    }
    refreshUI();
  };

  return {
    getItems: () => (Array.isArray(items) ? items : []),
    timeOf: getTime,
    load,
    add,
    remove,
    update,
    clearAll,
    syncFromFirebase
  };
}

/* ══════════════════════════════════════════════════
   3. App 코어
   ══════════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus',
  authDomain: 'gogo-manager-f0a68.firebaseapp.com',
  databaseURL: 'https://gogo-manager-f0a68-default-rtdb.firebaseio.com',
  projectId: 'gogo-manager-f0a68',
  storageBucket: 'gogo-manager-f0a68.firebasestorage.app',
  messagingSenderId: '1016084163074',
  appId: '1:1016084163074:web:836b8517d023638e12551b'
};

window.App = Object.assign(window.App || {}, {
  db: null,
  isFirebaseActive: false,
  stores: {},
  _privateRef: null,

  state: {
    pendingRedirect: null,
    parking: { car: 'X1', type: '지하 주차장', floor: 'B1', lat: 37.5665, lng: 126.978, photoBase64: '' }
  },

  ui: {
    _timer: null,
    toast(msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      if (msg) t.innerText = msg;
      t.classList.add('show');
      clearTimeout(this._timer);
      this._timer = setTimeout(() => t.classList.remove('show'), 2600);
    }
  },

  router: {
    screens: ['lock', 'home', 'parking', 'schedule', 'calendar', 'shopping', 'sticky', 'ledger', 'trip'],
    go(screenName) {
      const name = this.screens.includes(screenName) ? screenName : 'home';
      if (name !== 'lock' && safeGet('gogo_auth_pass') !== 'true') {
        App.state.pendingRedirect = name === 'home' ? null : name;
        return this.go('lock');
      }
      document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
      const target = document.getElementById(`screen-${name}`);
      if (!target) return;
      target.classList.add('active');
      window.scrollTo(0, 0);

      try {
        if (['parking', 'shopping', 'sticky', 'trip', 'ledger', 'schedule'].includes(name)) {
          safeSet(`last_view_${name}`, Date.now());
          if (App.badge) App.badge.refresh();
        }
        if (name === 'parking' && App.parking) App.parking.render();
        if (name === 'schedule' && App.schedule) App.schedule.render();
        if (name === 'calendar' && App.calendar) App.calendar.generate();
        if (name === 'shopping' && App.memo) App.memo.renderTodos(App.stores.todos.getItems());
        if (name === 'sticky' && App.memo) App.memo.filterStickies();
        if (name === 'ledger' && App.ledger) App.ledger.render(App.stores.ledger.getItems());
        if (name === 'trip' && App.trip) App.trip.renderList(App.stores.trips.getItems());
        if (name === 'lock') {
          const pin = document.getElementById('pinInput');
          if (pin) setTimeout(() => pin.focus(), 150);
        }
      } catch (e) {
        console.error(`[Router] ${name} 렌더 오류`, e);
      }
    }
  },

  /* 대시보드 카드 라이브 요약 */
  summary: {
    refresh() {
      ['renderParking', 'renderSchedule', 'renderShopping', 'renderLedger', 'renderSticky', 'renderTrip'].forEach((fn) => {
        try { this[fn](); } catch (e) { console.error(`[Summary] ${fn}`, e); }
      });
    },

    renderParking() {
      const el = document.getElementById('summary-parking');
      if (!el || !App.stores.parking) return;
      const items = [...App.stores.parking.getItems()].sort((a, b) => parkingTime(b) - parkingTime(a));
      if (items.length === 0) {
        el.innerHTML = '<span class="summary-loading">등록된 주차 없음</span>';
        return;
      }
      const x1 = items.find((p) => carKeyOf(p) === 'x1');
      const accent = items.find((p) => carKeyOf(p) === 'accent');
      el.innerHTML = `
        <div class="live-parking-row">
          <span>⚪ <strong class="live-parking-slot-x1">${escapeHtml(App.summary.formatParkingCode(x1))}</strong></span>
          <span class="live-parking-divider">│</span>
          <span>⚫ <strong class="live-parking-slot-accent">${escapeHtml(App.summary.formatParkingCode(accent))}</strong></span>
        </div>`;
    },

    formatParkingCode(item) {
      if (!item) return '미등록';
      if (item.floor && item.slot) {
        const f = String(item.floor).trim().toUpperCase();
        const s = String(item.slot).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (f && s) return `${f}-${s}`;
      }
      const clean = String(item.text || '')
        .replace(/[⚪⚫⭐🚗]/g, '')
        .replace(/X1|엑센트|accent/gi, '')
        .replace(/지하\s*주차장/g, '')
        .replace(/번/g, '')
        .replace(/^\s*-\s*/, '')
        .trim();
      const m = clean.match(/(B\d+|\d+F|\d+층|야외)\s*[-:]?\s*([A-Za-z]?\d+[A-Za-z]?)/i);
      if (m) return `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
      return clean || '미등록';
    },

    renderSchedule() {
      const el = document.getElementById('summary-schedule');
      if (!el) return;
      const all = App.schedule ? App.schedule.getAllSchedules() : [];
      const today = todayStr();
      const upcoming = all.filter((s) => s && s.date && s.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
      if (upcoming.length === 0) {
        el.innerHTML = '<span class="summary-loading">예정된 일정 없음 ✨</span>';
        return;
      }
      const next = upcoming[0];
      const diff = Math.round((new Date(`${next.date}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000);
      const dday = diff === 0 ? 'D-Day' : `D-${diff}`;
      const authorText = next.isPrivate ? '🔒' : `[${next.author || '가족'}]`;
      el.innerHTML = `
        <div class="live-schedule-text">
          <span class="live-schedule-badge ${diff <= 1 ? 'dday' : 'soon'}">${dday}</span>
          ${escapeHtml(authorText)} ${escapeHtml(next.title || next.text || '일정')}
        </div>`;
    },

    renderShopping() {
      const el = document.getElementById('summary-shopping');
      if (!el || !App.stores.todos) return;
      const pending = App.stores.todos.getItems().filter((t) => !t.completed);
      if (pending.length === 0) {
        el.innerHTML = '<span class="live-shopping-done">모두 완료됨! 😊</span>';
        return;
      }
      const first = pending[0].text || pending[0].title || '품목';
      const more = pending.length > 1 ? ` 외 ${pending.length - 1}개` : '';
      el.innerHTML = `<div class="live-shopping-pending">${escapeHtml(first)}${more} (<span class="live-shopping-count-badge">${pending.length}개 남음</span>)</div>`;
    },

    renderLedger() {
      const el = document.getElementById('summary-ledger');
      if (!el || !App.stores.ledger) return;
      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const total = App.stores.ledger.getItems()
        .filter((i) => (i.month || (i.date || '').substring(0, 7)) === monthKey)
        .reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);
      el.innerHTML = `<div><span class="live-ledger-spend">${now.getMonth() + 1}월 ${total.toLocaleString()}원</span> 지출</div>`;
    },

    renderSticky() {
      const el = document.getElementById('summary-sticky');
      if (!el || !App.stores.stickies) return;
      const list = App.stores.stickies.getItems();
      if (list.length === 0) {
        el.innerHTML = '<span class="summary-loading">계좌, 와이파이, 완료 체크</span>';
        return;
      }
      el.innerHTML = `<span class="live-sticky-text">${escapeHtml(list[0].text || '')}</span>`;
    },

    renderTrip() {
      const el = document.getElementById('summary-trip');
      if (!el || !App.stores.trips) return;
      const list = App.stores.trips.getItems();
      if (list.length === 0) {
        el.innerHTML = '<span class="summary-loading">추억 기록 & 여행지 목록</span>';
        return;
      }
      const first = list[0];
      const date = (first.date || '').substring(5);
      el.innerHTML = `<span class="live-trip-text">📍 ${escapeHtml(first.place || first.title || '여행지')} ${date ? `(${escapeHtml(date)})` : ''}</span>`;
    }
  },

  /* 구버전 모듈 호환 브릿지 */
  ticker: {
    refresh() { if (App.summary) App.summary.refresh(); },
    start() { if (App.summary) App.summary.refresh(); },
    next() {}
  },

  badge: {
    refresh() {
      const check = (viewKey, storeKey, badgeId) => {
        const el = document.getElementById(badgeId);
        const store = App.stores[storeKey];
        if (!el || !store) return;
        const lastView = Number(safeGet(viewKey) || 0);
        const hasNew = lastView > 0 && store.getItems().some((i) => store.timeOf(i) > lastView);
        el.style.display = hasNew ? 'inline-block' : 'none';
      };
      check('last_view_parking', 'parking', 'badge-parking');
      check('last_view_shopping', 'todos', 'badge-shopping');
      check('last_view_sticky', 'stickies', 'badge-sticky');
      check('last_view_trip', 'trips', 'badge-trip');
      check('last_view_ledger', 'ledger', 'badge-ledger');
      check('last_view_schedule', 'schedules', 'badge-schedule');
    }
  },

  /* 개인 비공개 일정 채널 - 단일 리스너 유지 */
  syncPrivateChannel() {
    if (!this.isFirebaseActive || !this.db) return;
    if (this._privateRef) {
      this._privateRef.off('value');
      this._privateRef = null;
    }
    const user = this.auth ? this.auth.currentUser : 'public';
    const map = { jinse: 'privateJinse', jihye: 'privateJihye' };
    if (!map[user]) return;
    const store = this.stores[map[user]];
    this._privateRef = this.db.ref(`private_schedules/${user}`);
    this._privateRef.on('value', (snap) => {
      store.syncFromFirebase(snap.val());
    }, (err) => console.warn('[Private] 리스너 오류', err));
  },

  async forceSyncAll(silent = false) {
    if (!silent) this.ui.toast('🔄 최신 데이터를 동기화하는 중...');
    if (!this.db) {
      if (!silent) this.ui.toast('⚠️ 서버에 연결되지 않았습니다.');
      return;
    }
    const endpoints = [
      ['parking_logs', 'parking'],
      ['family_todos', 'todos'],
      ['family_stickies', 'stickies'],
      ['family_ledger', 'ledger'],
      ['family_schedules', 'schedules'],
      ['family_trips', 'trips']
    ];
    try {
      await Promise.all(endpoints.map(async ([path, storeKey]) => {
        try {
          const snap = await this.db.ref(path).once('value');
          this.stores[storeKey].syncFromFirebase(snap.val());
        } catch (err) {
          console.warn(`[ForceSync] ${path} 실패`, err);
        }
      }));
      if (!silent) this.ui.toast('☁️ 실시간 최신 동기화 완료!');
    } catch (e) {
      console.warn('[ForceSync] 전체 실패', e);
    }
  },

  attachLifecycleHandlers() {
    let wakeTimer = null;
    const handleWake = () => {
      clearTimeout(wakeTimer);
      wakeTimer = setTimeout(() => {
        if (!this.db) return;
        try {
          this.db.goOnline();
          this.forceSyncAll(true);
        } catch (e) { console.warn('[Wake]', e); }
      }, 300);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleWake();
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted) handleWake(); });
    window.addEventListener('online', handleWake);
  },

  initFirebase() {
    if (typeof firebase === 'undefined') {
      console.warn('[Firebase] SDK 로드 실패 - 오프라인 캐시로 동작');
      this.setCloudBadge(false, '⚠️ 오프라인');
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      this.db = firebase.database();
      this.isFirebaseActive = true;
    } catch (e) {
      console.error('[Firebase] 초기화 실패', e);
      this.setCloudBadge(false, '⚠️ 연결 실패');
      return;
    }

    const db = this.db;
    const onErr = (path) => (err) => console.error(`[Firebase] ${path} 읽기 실패`, err);

    db.ref('.info/connected').on('value', (snap) => {
      const ok = snap.val() === true;
      this.setCloudBadge(ok, ok ? '☁️ 동기화됨' : '⚡ 연결 중...');
    });

    db.ref('parking_logs').on('value', (snap) => {
      this.stores.parking.syncFromFirebase(snap.val(), {
        title: (p) => `🚗 [${carKeyOf(p) === 'x1' ? '⚪ X1' : '⚫ 엑센트'}] 주차 위치 등록`,
        body: (p) => `${p.text || ''} 에 주차되었습니다.`
      });
    }, onErr('parking_logs'));

    db.ref('family_todos').on('value', (snap) => {
      this.stores.todos.syncFromFirebase(snap.val(), {
        title: () => '🛒 새로운 장보기 품목',
        body: (t) => `[${t.author || '가족'}] ${t.text || t.title || ''}`
      });
    }, onErr('family_todos'));

    db.ref('family_stickies').on('value', (snap) => {
      this.stores.stickies.syncFromFirebase(snap.val(), {
        title: () => '📌 새로운 고정 메모 등록',
        body: (m) => m.text || '새로운 메모가 등록되었습니다.'
      });
    }, onErr('family_stickies'));

    db.ref('family_ledger').on('value', (snap) => {
      this.stores.ledger.syncFromFirebase(snap.val(), {
        title: () => '💰 새로운 가계부 지출 내역',
        body: (l) => `[${l.author || '가족'}] ${l.desc || '지출'}: ${Number(l.amount || 0).toLocaleString()}원`
      });
    }, onErr('family_ledger'));

    db.ref('family_schedules').on('value', (snap) => {
      this.stores.schedules.syncFromFirebase(snap.val(), {
        title: () => '🗓️ 새로운 가족 일정 등록',
        body: (s) => `[${s.author || '가족'}] ${s.title || s.text || ''} (${s.date || ''})`
      });
    }, onErr('family_schedules'));

    db.ref('family_trips').on('value', (snap) => {
      this.stores.trips.syncFromFirebase(snap.val(), {
        title: () => '✈️ 새로운 가족 여행지 등록',
        body: (tr) => `[${tr.author || '가족'}] ${tr.place || tr.title || '새 여행지'} (${tr.date || ''})`
      });
    }, onErr('family_trips'));

    db.ref('auth_pins').on('value', (snap) => {
      const data = snap.val() || {};
      safeSet('pin_hash_jinse', data.jinse || '');
      safeSet('pin_hash_jihye', data.jihye || '');
    }, onErr('auth_pins'));

    db.ref('calendar_data').on('value', (snap) => {
      const data = snap.val() || {};
      let changed = false;
      Object.keys(data).forEach((k) => {
        const v = data[k] === null || data[k] === undefined ? '' : String(data[k]);
        if (safeGet(k) !== v) {
          safeSet(k, v);
          changed = true;
        }
      });
      const active = document.activeElement;
      const typing = active && (active.id === 'calendarGoalInput' || active.id === 'calendarMemoInput');
      if (changed && !typing && this.calendar) this.calendar.generate();
    }, onErr('calendar_data'));

    this.syncPrivateChannel();
  },

  setCloudBadge(active, text) {
    const badge = document.getElementById('cloudStatusBadge');
    if (!badge) return;
    badge.innerText = text;
    badge.classList.toggle('cloud-active', Boolean(active));
  },

  init() {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const now = new Date();
    const dateEl = document.getElementById('homeTodayDate');
    if (dateEl) dateEl.innerText = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;

    const renderSchedules = () => {
      if (this.schedule) this.schedule.render();
      if (this.calendar) this.calendar.generate();
    };

    this.stores.parking = createDataStore({
      key: 'parking_logs',
      firebasePath: 'parking_logs',
      sanitizer: sanitizeParking,
      timeOf: parkingTime,
      keyed: true,
      onRender: () => this.parking && this.parking.render()
    });
    this.stores.todos = createDataStore({ key: 'family_todos', firebasePath: 'family_todos', maxItems: 100, onRender: (items) => this.memo && this.memo.renderTodos(items) });
    this.stores.stickies = createDataStore({ key: 'family_stickies', firebasePath: 'family_stickies', maxItems: 100, onRender: () => this.memo && this.memo.filterStickies() });
    this.stores.trips = createDataStore({ key: 'family_trips', firebasePath: 'family_trips', maxItems: 200, onRender: (items) => this.trip && this.trip.renderList(items) });
    this.stores.ledger = createDataStore({ key: 'family_ledger', firebasePath: 'family_ledger', maxItems: 2000, onRender: (items) => this.ledger && this.ledger.render(items) });
    this.stores.schedules = createDataStore({ key: 'family_schedules', firebasePath: 'family_schedules', maxItems: 1000, onRender: renderSchedules });
    this.stores.privateJinse = createDataStore({ key: 'private_jinse', firebasePath: 'private_schedules/jinse', maxItems: 1000, onRender: renderSchedules });
    this.stores.privateJihye = createDataStore({ key: 'private_jihye', firebasePath: 'private_schedules/jihye', maxItems: 1000, onRender: renderSchedules });

    const safeInit = (name) => {
      try {
        if (this[name] && typeof this[name].init === 'function') this[name].init();
      } catch (e) {
        console.error(`[Init] ${name} 초기화 실패`, e);
      }
    };
    ['schedule', 'calendar', 'ledger', 'trip'].forEach(safeInit);

    Object.values(this.stores).forEach((s) => s.load());

    safeInit('auth');
    safeInit('push');

    this.initFirebase();
    this.attachLifecycleHandlers();
    this.summary.refresh();
    this.badge.refresh();

    const hash = window.location.hash.replace('#', '');
    if (safeGet('gogo_auth_pass') === 'true') {
      this.router.go(this.router.screens.includes(hash) && hash !== 'lock' ? hash : 'home');
    } else {
      if (this.router.screens.includes(hash) && hash !== 'lock' && hash !== 'home') this.state.pendingRedirect = hash;
      this.router.go('lock');
    }
  }
});

window.addEventListener('load', () => {
  try {
    App.init();
  } catch (e) {
    console.error('[App] 초기화 치명 오류', e);
  }
});
