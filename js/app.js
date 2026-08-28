window.escapeHtml = function(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

window.sha256 = async function(str) {
  try {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) {}
  return String(str);
};

const memoryStorage = {};
window.safeGet = function(key) {
  try { return localStorage.getItem(key) || memoryStorage[key] || ''; } 
  catch (e) { return memoryStorage[key] || ''; }
};

window.safeSet = function(key, val) {
  try { localStorage.setItem(key, val); } 
  catch (e) { memoryStorage[key] = val; }
};

/* ── 🛡️ 데이터 스토어 팩토리 ── */
function createDataStore({ key, firebasePath, maxItems = 500, onRender }) {
  let items = [];

  const normalizeItems = (list) => {
    if (!list) return [];
    const arr = Array.isArray(list) ? list.filter(Boolean) : Object.values(list).filter(Boolean);
    return arr.map(it => {
      if (typeof it === 'object' && it !== null) {
        it.id = it.id || Date.now() + Math.floor(Math.random() * 1000);
      }
      return it;
    });
  };

  const load = () => {
    try { 
      const raw = safeGet(key);
      items = normalizeItems(JSON.parse(raw || '[]'));
    } catch(e) { 
      items = []; 
    }

    items.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    if (onRender) onRender(items);
    if (App.ticker) App.ticker.refresh();
    if (App.badge) App.badge.refresh();
  };

  const add = (item) => {
    if (!Array.isArray(items)) items = [];
    items = items.filter(i => String(i.id) !== String(item.id));
    items.unshift(item);
    if (maxItems) items = items.slice(0, maxItems);
    safeSet(key, JSON.stringify(items));
    if (App.isFirebaseActive && firebasePath) {
      App.db.ref(firebasePath + '/' + item.id).set(item);
    }
    if (onRender) onRender(items);
    if (App.ticker) App.ticker.refresh();
    if (App.badge) App.badge.refresh();
  };

  const remove = (id) => {
    if (!Array.isArray(items)) items = [];
    items = items.filter(i => String(i.id) !== String(id));
    safeSet(key, JSON.stringify(items));
    if (App.isFirebaseActive && firebasePath) {
      App.db.ref(firebasePath + '/' + id).remove();
    }
    if (onRender) onRender(items);
    if (App.ticker) App.ticker.refresh();
    if (App.badge) App.badge.refresh();
  };

  const update = (id, updates) => {
    if (!Array.isArray(items)) items = [];
    const target = items.find(i => String(i.id) === String(id));
    if (target) {
      Object.assign(target, updates);
      safeSet(key, JSON.stringify(items));
      if (App.isFirebaseActive && firebasePath) {
        App.db.ref(firebasePath + '/' + id).update(updates);
      }
      if (onRender) onRender(items);
      if (App.ticker) App.ticker.refresh();
      if (App.badge) App.badge.refresh();
    }
  };

  const clear = () => {
    items = [];
    safeSet(key, JSON.stringify([]));
    if (App.isFirebaseActive && firebasePath) {
      App.db.ref(firebasePath).remove();
    }
    if (onRender) onRender(items);
    if (App.ticker) App.ticker.refresh();
    if (App.badge) App.badge.refresh();
  };

  const syncFromFirebase = (data) => {
    if (data) {
      items = normalizeItems(data);
      items.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
      safeSet(key, JSON.stringify(items));
    }
    if (onRender) onRender(items);
    if (App.ticker) App.ticker.refresh();
    if (App.badge) App.badge.refresh();
  };

  return { getItems: () => (Array.isArray(items) ? items : []), load, add, remove, update, clear, syncFromFirebase };
}

/* ── App 메인 ── */
window.App = Object.assign(window.App || {}, {
  db: null,
  isFirebaseActive: false,
  
  state: {
    pendingRedirect: null,
    parking: { car: 'x1', type: '지하 주차장', floor: 'B1', lat: 37.5665, lng: 126.9780, filter: 'all', photoBase64: '' }
  },

  stores: {},

  ui: {
    toast(msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      if (msg) t.innerText = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    }
  },

  router: {
    go(screenName) {
      document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('screen-' + screenName);
      if (target) {
        target.classList.add('active');
        window.scrollTo(0, 0);

        if (['parking', 'memo', 'trip', 'ledger', 'schedule'].includes(screenName)) {
          safeSet('last_view_' + screenName, Date.now());
          if (App.badge) App.badge.refresh();
        }

        if (screenName === 'parking' && App.parking?.render) {
          App.parking.render(App.stores.parking ? App.stores.parking.getItems() : []);
        }
        if (screenName === 'schedule' && App.schedule?.render) {
          App.schedule.render();
        }
        if (screenName === 'calendar' && App.calendar?.generate) {
          App.calendar.generate();
        }
        if (screenName === 'memo' && App.memo?.render) {
          App.memo.render();
        }
        if (screenName === 'ledger' && App.ledger?.render) {
          App.ledger.render(App.stores.ledger ? App.stores.ledger.getItems() : []);
        }
        if (screenName === 'trip' && App.trip?.renderList) {
          App.trip.renderList(App.stores.trips ? App.stores.trips.getItems() : []);
        }
      }
    }
  },

  ticker: {
    messages: [],
    currentIndex: 0,
    timer: null,

    refresh() {
      const lines = [];

      const allSchedules = App.schedule ? App.schedule.getAllSchedules() : [];
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];
      const upcoming = allSchedules.filter(s => s && s.date >= todayStr).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      if (upcoming.length > 0) {
        const nextEvt = upcoming[0];
        const prefix = nextEvt.isPrivate ? '🔒' : `[${nextEvt.author || '가족'}]`;
        lines.push(`🗓️ ${prefix} ${nextEvt.title || nextEvt.text} (${(nextEvt.date || '').substring(5)})`);
      }

      const parkingItems = App.stores.parking ? App.stores.parking.getItems() : [];
      if (parkingItems.length > 0) {
        const pTexts = [];
        parkingItems.forEach(p => {
          const carName = (p.car || '').trim();
          let loc = p.text || '';
          if (loc.includes(' - ')) {
            const parts = loc.split(' - ');
            loc = parts[parts.length - 1];
            if (p.isOutdoor || (p.text && p.text.includes('야외'))) {
              loc = '야외 ' + loc;
            }
          }
          pTexts.push(`${carName} · ${loc.trim()}`);
        });
        if (pTexts.length > 0) lines.push(pTexts.join(' │ '));
      }

      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const ledgerItems = App.stores.ledger ? App.stores.ledger.getItems() : [];
      const thisMonthLedger = ledgerItems.filter(i => (i.month || i.date?.substring(0, 7)) === currentMonthKey);
      const totalMonthSpend = thisMonthLedger.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);

      if (totalMonthSpend > 0) {
        lines.push(`💰 ${now.getMonth() + 1}월 총 지출: ${totalMonthSpend.toLocaleString()}원`);
      }

      const todos = App.stores.todos ? App.stores.todos.getItems() : [];
      const pending = todos.filter(t => !t.completed);
      if (pending.length > 0) {
        const preview = pending.slice(0, 3).map(t => t.text || t.title).join(', ');
        lines.push(`장보기 : ${preview}${pending.length > 3 ? ' 외' : ''} (${pending.length}개 남음)`);
      }

      if (lines.length === 0) {
        lines.push('진세 & 지혜 스마트 포털에 오신 것을 환영합니다 ✨');
      }

      this.messages = lines;
      this.showCurrent();
    },

    showCurrent() {
      const el = document.getElementById('tickerVerticalText');
      if (!el || this.messages.length === 0) return;
      if (this.currentIndex >= this.messages.length) this.currentIndex = 0;
      el.innerText = this.messages[this.currentIndex];
    },

    next() {
      if (this.messages.length <= 1) return;
      const el = document.getElementById('tickerVerticalText');
      if (!el) return;

      el.classList.add('slide-down-out');

      setTimeout(() => {
        this.currentIndex = (this.currentIndex + 1) % this.messages.length;
        el.innerText = this.messages[this.currentIndex];
        el.classList.remove('slide-down-out');
        el.classList.add('slide-down-in');

        void el.offsetHeight;
        el.classList.remove('slide-down-in');
      }, 450);
    },

    start() {
      this.refresh();
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.next();
      }, 3500);
    }
  },

  badge: {
    refresh() {
      const checkBadge = (key, storeKey, badgeId) => {
        const lastView = Number(safeGet(key) || 0);
        const items = App.stores[storeKey] ? App.stores[storeKey].getItems() : [];
        const hasNew = items.some(i => (Number(i.id) || 0) > lastView);
        const el = document.getElementById(badgeId);
        if (el) el.style.display = hasNew ? 'inline-block' : 'none';
      };

      checkBadge('last_view_parking', 'parking', 'badge-parking');
      checkBadge('last_view_memo', 'todos', 'badge-memo');
      checkBadge('last_view_trip', 'trips', 'badge-trip');
      checkBadge('last_view_ledger', 'ledger', 'badge-ledger');
      checkBadge('last_view_schedule', 'schedules', 'badge-schedule');
    }
  },

  syncPrivateChannel() {
    if (!this.isFirebaseActive || !this.db) return;

    const user = this.auth?.currentUser || 'public';

    if (user === 'jinse') {
      this.db.ref('private_schedules/jinse').off();
      this.db.ref('private_schedules/jinse').on('value', snap => {
        this.stores.privateJinse.syncFromFirebase(snap.val());
        if (this.schedule) this.schedule.render();
        if (this.calendar) this.calendar.generate();
      });
    } else if (user === 'jihye') {
      this.db.ref('private_schedules/jihye').off();
      this.db.ref('private_schedules/jihye').on('value', snap => {
        this.stores.privateJihye.syncFromFirebase(snap.val());
        if (this.schedule) this.schedule.render();
        if (this.calendar) this.calendar.generate();
      });
    }
  },

  init() {
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
    const dateEl = document.getElementById('homeTodayDate');
    if (dateEl) dateEl.innerText = dateStr;

    // 통합 스토어 초기화
    this.stores.parking = createDataStore({ key: 'parking_logs', firebasePath: 'parking_logs', maxItems: 10, onRender: (items) => this.parking?.render && this.parking.render(items) });
    this.stores.todos = createDataStore({ key: 'family_todos', firebasePath: 'family_todos', maxItems: 100, onRender: () => this.memo?.render && this.memo.render() });
    this.stores.stickies = createDataStore({ key: 'family_stickies', firebasePath: 'family_stickies', maxItems: 50, onRender: () => this.memo?.render && this.memo.render() });
    this.stores.trips = createDataStore({ key: 'family_trips', firebasePath: 'family_trips', maxItems: 100, onRender: (items) => this.trip?.renderList && this.trip.renderList(items) });
    this.stores.ledger = createDataStore({ key: 'family_ledger', firebasePath: 'family_ledger', maxItems: 500, onRender: (items) => this.ledger?.render && this.ledger.render(items) });
    this.stores.schedules = createDataStore({ key: 'family_schedules', firebasePath: 'family_schedules', maxItems: 500, onRender: () => { 
      if (this.schedule) this.schedule.render(); 
      if (this.calendar) this.calendar.generate();
    } });

    this.stores.privateJinse = createDataStore({ key: 'private_jinse', firebasePath: 'private_schedules/jinse', maxItems: 500, onRender: () => {
      if (this.schedule) this.schedule.render();
      if (this.calendar) this.calendar.generate();
    } });

    this.stores.privateJihye = createDataStore({ key: 'private_jihye', firebasePath: 'private_schedules/jihye', maxItems: 500, onRender: () => {
      if (this.schedule) this.schedule.render();
      if (this.calendar) this.calendar.generate();
    } });

    Object.values(this.stores).forEach(s => s.load());

    if (this.auth) this.auth.init();
    if (this.schedule) this.schedule.init();
    if (this.calendar) this.calendar.init();
    if (this.ledger) this.ledger.init();
    if (this.trip) this.trip.init();

    this.ticker.start();
    this.badge.refresh();

    // Firebase 초기화
    const firebaseConfig = {
      apiKey: "AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus",
      authDomain: "gogo-manager-f0a68.firebaseapp.com",
      databaseURL: "https://gogo-manager-f0a68-default-rtdb.firebaseio.com",
      projectId: "gogo-manager-f0a68",
      storageBucket: "gogo-manager-f0a68.firebasestorage.app",
      messagingSenderId: "1016084163074",
      appId: "1:1016084163074:web:836b8517d023638e12551b"
    };

    try {
      if (typeof firebase !== 'undefined' && firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        this.db = firebase.database();
        this.isFirebaseActive = true;

        const badge = document.getElementById('cloudStatusBadge');
        if (badge) {
          badge.innerText = '☁️ 가족 실시간 동기화 중';
          badge.classList.add('cloud-active');
        }

        this.db.ref('parking_logs').on('value', snap => this.stores.parking.syncFromFirebase(snap.val()));
        this.db.ref('family_todos').on('value', snap => this.stores.todos.syncFromFirebase(snap.val()));
        this.db.ref('family_stickies').on('value', snap => this.stores.stickies.syncFromFirebase(snap.val()));
        this.db.ref('family_ledger').on('value', snap => this.stores.ledger.syncFromFirebase(snap.val()));
        this.db.ref('family_schedules').on('value', snap => {
          this.stores.schedules.syncFromFirebase(snap.val());
          if (this.calendar) this.calendar.generate();
        });

        this.db.ref('auth_pins').on('value', snap => {
          const data = snap.val() || {};
          if (data.jinse) safeSet('pin_hash_jinse', data.jinse);
          if (data.jihye) safeSet('pin_hash_jihye', data.jihye);
        });

        this.syncPrivateChannel();

        this.db.ref('family_budget').on('value', snap => {
          const data = snap.val() || {};
          Object.keys(data).forEach(k => safeSet(`budget_${k}`, data[k]));
          if (this.ledger) this.ledger.render(this.stores.ledger.getItems());
          this.ticker.refresh();
        });

        this.db.ref('family_trips').on('value', snap => {
          this.stores.trips.syncFromFirebase(snap.val());
          if (this.trip) this.trip.renderList(this.stores.trips.getItems());
        });

        this.db.ref('calendar_data').on('value', snap => {
          const data = snap.val() || {};
          let hasChange = false;
          Object.keys(data).forEach(k => {
            if (safeGet(k) !== data[k]) {
              safeSet(k, data[k]);
              hasChange = true;
            }
          });

          const activeEl = document.activeElement;
          const isTyping = activeEl && (
            activeEl.classList.contains('editable-goal') ||
            activeEl.classList.contains('editable-bottom-memo')
          );

          if (!isTyping && hasChange && this.calendar) {
            this.calendar.generate();
          }
          App.ticker.refresh();
        });
      }
    } catch (e) {
      console.warn("Firebase 연결 대기:", e);
    }

    // 각 화면 최초 1회 렌더링 강제 실행
    if (this.parking) this.parking.render(this.stores.parking.getItems());
    if (this.schedule) this.schedule.render();
    if (this.memo) this.memo.render();
    if (this.ledger) this.ledger.render(this.stores.ledger.getItems());
    if (this.trip) this.trip.renderList(this.stores.trips.getItems());

    // 직행 분기
    const targetHash = window.location.hash.replace('#', '');
    const validScreens = ['parking', 'memo', 'trip', 'ledger', 'schedule', 'calendar'];

    if (safeGet('gogo_auth_pass') === 'true') {
      if (validScreens.includes(targetHash)) {
        this.router.go(targetHash);
      } else {
        this.router.go('home');
      }
    } else {
      if (validScreens.includes(targetHash)) {
        this.state.pendingRedirect = targetHash;
      }
      this.router.go('lock');
    }
  }
});

window.onload = () => App.init();
