/* ── 공통 유틸리티 ── */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const memoryStorage = {};
function safeGet(key) {
  try { return localStorage.getItem(key) || memoryStorage[key] || ''; } 
  catch (e) { return memoryStorage[key] || ''; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } 
  catch (e) { memoryStorage[key] = val; }
}

/* ── 🛡️ 데이터 유실 방지 공통 CRUD 팩토리 ── */
function createDataStore({ key, firebasePath, maxItems = 100, onRender }) {
  let items = [];

  const load = () => {
    try { items = JSON.parse(safeGet(key) || '[]'); } catch(e){ items = []; }
    items.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    if (onRender) onRender(items);
    if (App.ticker) App.ticker.refresh();
    if (App.badge) App.badge.refresh();
  };

  const add = (item) => {
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
      items = Object.values(data);
      items.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
      safeSet(key, JSON.stringify(items));
    } else {
      const localData = safeGet(key);
      if (localData && localData !== '[]') {
        try {
          const parsed = JSON.parse(localData);
          if (Array.isArray(parsed) && parsed.length > 0 && App.isFirebaseActive && firebasePath) {
            parsed.forEach(item => {
              App.db.ref(firebasePath + '/' + item.id).set(item);
            });
          }
        } catch(e) {}
      }
    }
    if (onRender) onRender(items);
    if (App.ticker) App.ticker.refresh();
    if (App.badge) App.badge.refresh();
  };

  return { getItems: () => items, load, add, remove, update, clear, syncFromFirebase };
}

/* ── App 메인 코어 ── */
window.App = Object.assign(window.App || {}, {
  db: null,
  isFirebaseActive: false,
  
  state: {
    parking: { car: 'x1', type: '지하 주차장', floor: 'B1', lat: 37.5665, lng: 126.9780, filter: 'all', photoBase64: '' },
    memo: { author: '나', stickyColor: 'yellow', tab: 'todo', isAddingTodo: false, isAddingSticky: false },
    trip: { coords: { lat: 37.5665, lng: 126.9780 }, photoBase64: '', map: null, markers: [], tempMarker: null },
    calendar: { syncTimeout: null }
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

        if (['parking', 'memo', 'trip', 'ledger'].includes(screenName)) {
          safeSet('last_view_' + screenName, Date.now());
          App.badge.refresh();
        }

        if (screenName === 'calendar' && App.calendar?.generate) {
          App.calendar.generate();
        }
        if (screenName === 'ledger' && App.ledger?.render) {
          App.ledger.render(App.stores.ledger ? App.stores.ledger.getItems() : []);
        }
        if (screenName === 'trip' && App.trip?.initMap) {
          App.trip.initMap();
        }
      }
    }
  },

  /* 📢 세로 롤링 전광판 (가계부 지출 & 남은 예산 자동 반영) */
  ticker: {
    messages: [],
    currentIndex: 0,
    timer: null,

    refresh() {
      const lines = [];

      // 1. 주차 현황
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

      // 2. 가계부 이달의 지출 및 예산 현황
      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const ledgerItems = App.stores.ledger ? App.stores.ledger.getItems() : [];
      const thisMonthLedger = ledgerItems.filter(i => (i.month || i.date?.substring(0, 7)) === currentMonthKey);
      const totalMonthSpend = thisMonthLedger.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);
      const budgetKey = `budget_${currentMonthKey}`;
      const targetBudget = Number(safeGet(budgetKey)) || 0;

      if (totalMonthSpend > 0 || targetBudget > 0) {
        if (targetBudget > 0) {
          const remain = targetBudget - totalMonthSpend;
          lines.push(`💰 ${now.getMonth() + 1}월 지출: ${totalMonthSpend.toLocaleString()}원 (남은 예산: ${remain.toLocaleString()}원)`);
        } else {
          lines.push(`💰 ${now.getMonth() + 1}월 총 지출: ${totalMonthSpend.toLocaleString()}원 (${thisMonthLedger.length}건)`);
        }
      }

      // 3. 장보기 미완료
      const todos = App.stores.todos ? App.stores.todos.getItems() : [];
      const pending = todos.filter(t => !t.completed);
      if (pending.length > 0) {
        const preview = pending.slice(0, 3).map(t => t.text).join(', ');
        lines.push(`장보기 : ${preview}${pending.length > 3 ? ' 외' : ''} (남은 ${pending.length}개)`);
      }

      // 4. 고정 메모
      const stickies = App.stores.stickies ? App.stores.stickies.getItems() : [];
      if (stickies.length > 0) {
        lines.push(`메모 : ${stickies[0].text.replace(/\n/g, ' ').trim()}`);
      }

      // 5. 여행
      const trips = App.stores.trips ? App.stores.trips.getItems() : [];
      if (trips.length > 0) {
        lines.push(`여행 : ${trips[0].place} (${trips[0].date})`);
      }

      // 6. 이달의 목표
      const currentGoal = safeGet(`planner_goal_${now.getFullYear()}_${now.getMonth() + 1}`);
      if (currentGoal && currentGoal.trim()) {
        lines.push(`목표 : ${currentGoal.trim()}`);
      }

      if (lines.length === 0) {
        lines.push('우리 가족 스마트 포털에 오신 것을 환영합니다 ✨');
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

  /* NEW 뱃지 관리 */
  badge: {
    refresh() {
      const lastParkingView = Number(safeGet('last_view_parking') || 0);
      const parkingItems = App.stores.parking ? App.stores.parking.getItems() : [];
      const hasNewParking = parkingItems.some(i => (Number(i.id) || 0) > lastParkingView);
      const pBadge = document.getElementById('badge-parking');
      if (pBadge) pBadge.style.display = hasNewParking ? 'inline-block' : 'none';

      const lastMemoView = Number(safeGet('last_view_memo') || 0);
      const todos = App.stores.todos ? App.stores.todos.getItems() : [];
      const stickies = App.stores.stickies ? App.stores.stickies.getItems() : [];
      const hasNewMemo = todos.some(i => (Number(i.id) || 0) > lastMemoView) || stickies.some(i => (Number(i.id) || 0) > lastMemoView);
      const mBadge = document.getElementById('badge-memo');
      if (mBadge) mBadge.style.display = hasNewMemo ? 'inline-block' : 'none';

      const lastTripView = Number(safeGet('last_view_trip') || 0);
      const trips = App.stores.trips ? App.stores.trips.getItems() : [];
      const hasNewTrip = trips.some(i => (Number(i.id) || 0) > lastTripView);
      const tBadge = document.getElementById('badge-trip');
      if (tBadge) tBadge.style.display = hasNewTrip ? 'inline-block' : 'none';

      const lastLedgerView = Number(safeGet('last_view_ledger') || 0);
      const ledgerItems = App.stores.ledger ? App.stores.ledger.getItems() : [];
      const hasNewLedger = ledgerItems.some(i => (Number(i.id) || 0) > lastLedgerView);
      const lBadge = document.getElementById('badge-ledger');
      if (lBadge) lBadge.style.display = hasNewLedger ? 'inline-block' : 'none';
    }
  },

  init() {
    // 1. 주차 드롭다운 세팅
    const colSelect = document.getElementById('colSelect');
    if (colSelect) {
      colSelect.innerHTML = '';
      for (let i = 65; i <= 90; i++) colSelect.innerHTML += `<option value="${String.fromCharCode(i)}">${String.fromCharCode(i)}열</option>`;
    }
    const rowSelect = document.getElementById('rowSelect');
    if (rowSelect) {
      rowSelect.innerHTML = '';
      for (let i = 1; i <= 50; i++) rowSelect.innerHTML += `<option value="${i}">${i}번</option>`;
    }

    // 2. 상단 오늘 날짜
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
    const dateEl = document.getElementById('homeTodayDate');
    if (dateEl) dateEl.innerText = dateStr;

    // 3. 통합 스토어 초기화
    this.stores.parking = createDataStore({ key: 'parking_logs', firebasePath: 'parking_logs', maxItems: 10, onRender: (items) => this.parking.render(items) });
    this.stores.todos = createDataStore({ key: 'family_todos', firebasePath: 'family_todos', maxItems: 100, onRender: (items) => this.memo.renderTodos(items) });
    this.stores.stickies = createDataStore({ key: 'family_stickies', firebasePath: 'family_stickies', maxItems: 50, onRender: (items) => this.memo.renderStickies(items) });
    this.stores.trips = createDataStore({ key: 'family_trips', firebasePath: 'family_trips', maxItems: 100, onRender: (items) => this.trip.renderList(items) });
    this.stores.ledger = createDataStore({ key: 'family_ledger', firebasePath: 'family_ledger', maxItems: 500, onRender: (items) => { if (this.ledger) this.ledger.render(items); } });

    Object.values(this.stores).forEach(s => s.load());

    // 4. 모듈 초기화
    if (this.ledger) this.ledger.init();

    if (this.calendar) {
      this.calendar.updateGridStyle('dark');
      const yearInput = document.getElementById('yearInput');
      const monthInput = document.getElementById('monthInput');
      const tripDateInput = document.getElementById('tripDateInput');
      if (yearInput) yearInput.value = now.getFullYear();
      if (monthInput) monthInput.value = now.getMonth() + 1;
      if (tripDateInput) tripDateInput.value = now.toISOString().split('T')[0];
      this.calendar.generate();
    }

    // 5. 전광판 & 뱃지 시작
    this.ticker.start();
    this.badge.refresh();

    // 6. Firebase 초기화
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
        this.db.ref('family_budget').on('value', snap => {
          const data = snap.val() || {};
          Object.keys(data).forEach(k => safeSet(`budget_${k}`, data[k]));
          if (this.ledger) this.ledger.render(this.stores.ledger.getItems());
          this.ticker.refresh();
        });
        this.db.ref('family_trips').on('value', snap => {
          this.stores.trips.syncFromFirebase(snap.val());
          if (this.trip) this.trip.renderMarkers(this.stores.trips.getItems());
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
            activeEl.classList.contains('cell-memo') ||
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
      console.warn("Firebase 연결 대기 (로컬 모드 실행):", e);
    }

    if (safeGet('gogo_auth_pass') === 'true') {
      this.router.go('home');
    } else {
      this.router.go('lock');
    }
  }
});

window.onload = () => App.init();
