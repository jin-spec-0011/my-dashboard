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

/* 🚗 차량별 최대 2개 보장 정제 함수 */
function sanitizeParking(items) {
  if (!Array.isArray(items)) return [];
  const x1 = [];
  const accent = [];
  const sorted = [...items].sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

  for (const it of sorted) {
    const c = String(it.car || it.text || '').toLowerCase();
    if (c.includes('x1')) {
      if (x1.length < 2) x1.push(it);
    } else {
      if (accent.length < 2) accent.push(it);
    }
  }
  return [...x1, ...accent];
}

function createDataStore({ key, firebasePath, maxItems = 500, onRender, sanitizer }) {
  let items = [];

  const normalizeItems = (list) => {
    if (!list) return [];
    const arr = Array.isArray(list) ? list.filter(Boolean) : Object.values(list).filter(Boolean);
    const cleaned = arr.map(it => {
      if (typeof it === 'object' && it !== null) {
        it.id = it.id || Date.now() + Math.floor(Math.random() * 1000);
      }
      return it;
    });
    return sanitizer ? sanitizer(cleaned) : cleaned;
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
    if (App.summary) App.summary.refresh();
    if (App.badge) App.badge.refresh();
  };

  const add = (item) => {
    if (!Array.isArray(items)) items = [];
    items = items.filter(i => String(i.id) !== String(item.id));
    items.unshift(item);
    if (sanitizer) {
      items = sanitizer(items);
    } else if (maxItems) {
      items = items.slice(0, maxItems);
    }
    safeSet(key, JSON.stringify(items));
    if (App.isFirebaseActive && firebasePath && App.db) {
      App.db.ref(firebasePath).set(items);
    }
    if (onRender) onRender(items);
    if (App.summary) App.summary.refresh();
    if (App.badge) App.badge.refresh();
  };

  const remove = (id) => {
    if (!Array.isArray(items)) items = [];
    items = items.filter(i => String(i.id) !== String(id));
    safeSet(key, JSON.stringify(items));
    if (App.isFirebaseActive && firebasePath && App.db) {
      App.db.ref(firebasePath).set(items);
    }
    if (onRender) onRender(items);
    if (App.summary) App.summary.refresh();
    if (App.badge) App.badge.refresh();
  };

  const syncFromFirebase = (data, notifyConfig) => {
    if (data !== undefined && data !== null) {
      const oldLatestId = items.length > 0 ? Number(items[0].id) : 0;
      items = normalizeItems(data);
      items.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
      safeSet(key, JSON.stringify(items));

      if (oldLatestId > 0 && items.length > 0 && Number(items[0].id) > oldLatestId && notifyConfig) {
        const latest = items[0];
        const isMine = (App.auth && App.auth.currentUser !== 'public') && 
          ((App.auth.currentUser === 'jinse' && latest.author === '진세') || 
           (App.auth.currentUser === 'jihye' && latest.author === '지혜'));

        if (!isMine) {
          const title = notifyConfig.title(latest);
          const body = notifyConfig.body(latest);

          if (App.push?.sendLocalNotification) {
            App.push.sendLocalNotification(title, body);
          }
          if (App.ui?.toast) {
            App.ui.toast(`🔔 ${title}\n${body}`);
          }
        }
      }
    }
    if (onRender) onRender(items);
    if (App.summary) App.summary.refresh();
    if (App.badge) App.badge.refresh();
  };

  return { getItems: () => (Array.isArray(items) ? items : []), load, add, remove, syncFromFirebase };
}

window.App = Object.assign(window.App || {}, {
  db: null,
  isFirebaseActive: false,
  
  state: {
    pendingRedirect: null,
    parking: { car: 'X1', type: '지하 주차장', floor: 'B1', lat: 37.5665, lng: 126.9780, filter: 'all', photoBase64: '' }
  },

  stores: {},

  ui: {
    toast(msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      if (msg) t.innerText = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2600);
    }
  },

  router: {
    go(screenName) {
      document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('screen-' + screenName);
      if (target) {
        target.classList.add('active');
        window.scrollTo(0, 0);

        if (['parking', 'shopping', 'sticky', 'trip', 'ledger', 'schedule'].includes(screenName)) {
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
        if (screenName === 'shopping' && App.memo?.renderTodos) {
          App.memo.renderTodos(App.stores.todos ? App.stores.todos.getItems() : []);
        }
        if (screenName === 'sticky' && App.memo?.renderStickies) {
          App.memo.filterStickies ? App.memo.filterStickies() : App.memo.renderStickies(App.stores.stickies ? App.stores.stickies.getItems() : []);
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

  /* 🌟 [대안 1] 메뉴 카드 '라이브 서머리' 렌더링 엔진 */
  summary: {
    refresh() {
      this.renderParking();
      this.renderSchedule();
      this.renderShopping();
      this.renderLedger();
      this.renderSticky();
      this.renderTrip();
    },

    // 1. 🚗 주차 위치 요약 (⚪ B2-30A │ ⚫ B3-19A)
    renderParking() {
      const el = document.getElementById('summary-parking');
      if (!el) return;

      const rawParking = (App.parking && typeof App.parking.getLogs === 'function') 
        ? App.parking.getLogs() 
        : (App.stores.parking ? App.stores.parking.getItems() : []);

      const parkingItems = [...rawParking].sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));

      if (parkingItems.length === 0) {
        el.innerHTML = '<span class="summary-loading">등록된 주차 없음</span>';
        return;
      }

      let x1Item = null;
      let accentItem = null;

      for (const p of parkingItems) {
        const rawCar = String(p.car || p.text || '').toLowerCase();
        if (rawCar.includes('x1') && !x1Item) {
          x1Item = p;
        } else if ((rawCar.includes('엑센트') || rawCar.includes('accent')) && !accentItem) {
          accentItem = p;
        }
        if (x1Item && accentItem) break;
      }

      const formatCode = (item) => {
        if (!item) return '미등록';
        if (item.floor && item.slot) {
          const f = String(item.floor).trim().toUpperCase();
          const s = String(item.slot).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          if (f && s && s.length >= 2) return `${f}-${s}`;
        }
        let clean = String(item.text || '')
          .replace(/[⚪⚫⭐🚗]/g, '')
          .replace(/X1|엑센트|accent/gi, '')
          .replace(/지하\s*주차장/g, '')
          .replace(/번/g, '')
          .trim();
        const directMatch = clean.match(/(B\d+|\d+F|\d+층|야외)\s*[-:]?\s*([A-Za-z]?\d+[A-Za-z]?)/i);
        if (directMatch) return `${directMatch[1].toUpperCase()}-${directMatch[2].toUpperCase()}`;
        return clean || '미등록';
      };

      const x1Code = formatCode(x1Item);
      const accentCode = formatCode(accentItem);

      el.innerHTML = `
        <div class="live-parking-row">
          <span>⚪ <strong class="live-parking-slot-x1">${escapeHtml(x1Code)}</strong></span>
          <span class="live-parking-divider">│</span>
          <span>⚫ <strong class="live-parking-slot-accent">${escapeHtml(accentCode)}</strong></span>
        </div>
      `;
    },

    // 2. 🗓️ 다가오는 일정 요약 (D-Day 및 최근 일정)
    renderSchedule() {
      const el = document.getElementById('summary-schedule');
      if (!el) return;

      const allSchedules = App.schedule ? App.schedule.getAllSchedules() : [];
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];
      const upcoming = allSchedules.filter(s => s && s.date >= todayStr).sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      if (upcoming.length === 0) {
        el.innerHTML = '<span class="summary-loading">예정된 일정 없음 ✨</span>';
        return;
      }

      const nextEvt = upcoming[0];
      const d1 = new Date(todayStr).getTime();
      const d2 = new Date(nextEvt.date).getTime();
      const diff = Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
      const ddayText = diff === 0 ? 'D-Day' : `D-${diff}`;
      const badgeClass = diff <= 1 ? 'dday' : 'soon';
      const authorText = nextEvt.isPrivate ? '🔒' : `[${nextEvt.author || '가족'}]`;
      const titleText = nextEvt.title || nextEvt.text || '일정';

      el.innerHTML = `
        <div class="live-schedule-text">
          <span class="live-schedule-badge ${badgeClass}">${ddayText}</span>
          ${escapeHtml(authorText)} ${escapeHtml(titleText)}
        </div>
      `;
    },

    // 3. 🛒 장보기 잔여 품목 요약
    renderShopping() {
      const el = document.getElementById('summary-shopping');
      if (!el) return;

      const todos = App.stores.todos ? App.stores.todos.getItems() : [];
      const pending = todos.filter(t => !t.completed);

      if (pending.length === 0) {
        el.innerHTML = '<span class="live-shopping-done">모두 완료됨! 😊</span>';
      } else {
        const first = pending[0].text || pending[0].title || '품목';
        const moreCount = pending.length - 1;
        const extraText = moreCount > 0 ? ` 외 ${moreCount}개` : '';
        el.innerHTML = `
          <div class="live-shopping-pending">
            ${escapeHtml(first)}${extraText} (<span class="live-shopping-count-badge">${pending.length}개 남음</span>)
          </div>
        `;
      }
    },

    // 4. 💰 가계부 당월 지출 및 잔여 예산 요약
    renderLedger() {
      const el = document.getElementById('summary-ledger');
      if (!el) return;

      const now = new Date();
      const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const ledgerItems = App.stores.ledger ? App.stores.ledger.getItems() : [];
      const thisMonthLedger = ledgerItems.filter(i => (i.month || i.date?.substring(0, 7)) === currentMonthKey);
      const totalMonthSpend = thisMonthLedger.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);

      const budgetAmount = Number(safeGet(`budget_${currentMonthKey}`) || 0);

      if (budgetAmount > 0) {
        const remain = budgetAmount - totalMonthSpend;
        const remainClass = remain >= 0 ? 'live-ledger-remain' : 'live-ledger-over';
        const remainText = remain >= 0 ? `잔여 ${remain.toLocaleString()}원` : `초과 +${Math.abs(remain).toLocaleString()}원`;
        el.innerHTML = `
          <div><span class="live-ledger-spend">${totalMonthSpend.toLocaleString()}원</span> <span class="${remainClass}">(${remainText})</span></div>
        `;
      } else {
        el.innerHTML = `
          <div><span class="live-ledger-spend">${now.getMonth() + 1}월 ${totalMonthSpend.toLocaleString()}원</span> 지출</div>
        `;
      }
    },

    // 5. 📌 고정 메모 최신 1건 요약
    renderSticky() {
      const el = document.getElementById('summary-sticky');
      if (!el) return;

      const stickies = App.stores.stickies ? App.stores.stickies.getItems() : [];
      if (stickies.length === 0) {
        el.innerHTML = '<span class="summary-loading">계좌, 와이파이, 완료 체크</span>';
        return;
      }
      const first = stickies[0].text || '';
      el.innerHTML = `<span class="live-sticky-text">${escapeHtml(first)}</span>`;
    },

    // 6. ✈️ 가족 여행 지도 최근 여행지 요약
    renderTrip() {
      const el = document.getElementById('summary-trip');
      if (!el) return;

      const trips = App.stores.trips ? App.stores.trips.getItems() : [];
      if (trips.length === 0) {
        el.innerHTML = '<span class="summary-loading">추억 기록 & 여행지 목록</span>';
        return;
      }
      const first = trips[0];
      const place = first.place || first.title || '여행지';
      const date = (first.date || '').substring(5);
      el.innerHTML = `<span class="live-trip-text">📍 ${escapeHtml(place)} ${date ? '(' + escapeHtml(date) + ')' : ''}</span>`;
    }
  },

  // 호환성 브릿지 (다른 모듈에서 App.ticker.refresh() 호출 시 에러 방지)
  ticker: {
    refresh() { if (App.summary) App.summary.refresh(); },
    start() { if (App.summary) App.summary.refresh(); },
    next() {}
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
      checkBadge('last_view_shopping', 'todos', 'badge-shopping');
      checkBadge('last_view_sticky', 'stickies', 'badge-sticky');
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
        if (this.summary) this.summary.refresh();
      });
    } else if (user === 'jihye') {
      this.db.ref('private_schedules/jihye').off();
      this.db.ref('private_schedules/jihye').on('value', snap => {
        this.stores.privateJihye.syncFromFirebase(snap.val());
        if (this.schedule) this.schedule.render();
        if (this.calendar) this.calendar.generate();
        if (this.summary) this.summary.refresh();
      });
    }
  },

  async forceSyncAll(silent = false) {
    if (!silent && App.ui?.toast) {
      App.ui.toast("🔄 최신 데이터를 동기화하는 중...");
    }

    if (this.isFirebaseActive && typeof firebase !== 'undefined' && firebase.database) {
      try {
        firebase.database().goOnline();
      } catch (e) {}
    }

    if (!this.db) return;

    try {
      const endpoints = [
        { path: 'parking_logs', store: this.stores.parking },
        { path: 'family_todos', store: this.stores.todos },
        { path: 'family_stickies', store: this.stores.stickies },
        { path: 'family_ledger', store: this.stores.ledger },
        { path: 'family_schedules', store: this.stores.schedules },
        { path: 'family_trips', store: this.stores.trips }
      ];

      await Promise.all(endpoints.map(async ep => {
        try {
          const snap = await this.db.ref(ep.path).once('value');
          if (ep.store && snap.exists()) {
            ep.store.syncFromFirebase(snap.val());
          }
        } catch (err) {
          console.warn(`[ForceSync] ${ep.path} fetch failed:`, err);
        }
      }));

      if (this.summary) this.summary.refresh();

      if (!silent && App.ui?.toast) {
        App.ui.toast("☁️ 실시간 최신 동기화 완료!");
      }
    } catch (e) {
      console.warn("전체 강제 동기화 실패:", e);
    }
  },

  attachLifecycleHandlers() {
    const handleWake = () => {
      console.log('[PWA Wake] Reconnecting Firebase WebSocket & Syncing...');
      if (typeof firebase !== 'undefined' && firebase.database) {
        try {
          firebase.database().goOffline();
          setTimeout(() => {
            try {
              firebase.database().goOnline();
              this.forceSyncAll(true);
            } catch(e) {}
          }, 200);
        } catch(e) {}
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        handleWake();
      }
    });

    window.addEventListener('pageshow', () => {
      handleWake();
    });

    window.addEventListener('online', () => {
      handleWake();
    });
  },

  init() {
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
    const dateEl = document.getElementById('homeTodayDate');
    if (dateEl) dateEl.innerText = dateStr;

    // 🚗 주차 스토어 (차량별 최신 2개 강제 보장)
    this.stores.parking = createDataStore({ 
      key: 'parking_logs', 
      firebasePath: 'parking_logs', 
      sanitizer: sanitizeParking,
      onRender: (items) => this.parking?.render && this.parking.render(items) 
    });

    this.stores.todos = createDataStore({ key: 'family_todos', firebasePath: 'family_todos', maxItems: 100, onRender: (items) => this.memo?.renderTodos && this.memo.renderTodos(items) });
    this.stores.stickies = createDataStore({ key: 'family_stickies', firebasePath: 'family_stickies', maxItems: 50, onRender: (items) => {
      if (this.memo?.filterStickies) this.memo.filterStickies();
      else if (this.memo?.renderStickies) this.memo.renderStickies(items);
    } });
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
    if (this.push) this.push.init();
    if (this.schedule) this.schedule.init();
    if (this.calendar) this.calendar.init();
    if (this.ledger) this.ledger.init();
    if (this.trip) this.trip.init();

    if (this.summary) this.summary.refresh();
    this.badge.refresh();
    this.attachLifecycleHandlers();

    // Firebase 연동
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

        this.db.ref('.info/connected').on('value', snap => {
          const connected = snap.val() === true;
          const badge = document.getElementById('cloudStatusBadge');
          if (badge) {
            if (connected) {
              badge.innerText = '☁️ 동기화됨';
              badge.classList.add('cloud-active');
            } else {
              badge.innerText = '⚡ 연결 중...';
              badge.classList.remove('cloud-active');
            }
          }
        });

        // 실시간 리스너 바인딩
        this.db.ref('parking_logs').on('value', snap => {
          this.stores.parking.syncFromFirebase(snap.val(), {
            title: (p) => `🚗 [${String(p.car||p.text||'').toLowerCase().includes('x1') ? '⚪ X1' : '⚫ 엑센트'}] 주차 위치 등록`,
            body: (p) => `${p.text} 에 주차되었습니다.`
          });
          if (this.summary) this.summary.refresh();
        });

        this.db.ref('family_todos').on('value', snap => {
          this.stores.todos.syncFromFirebase(snap.val(), {
            title: () => `🛒 새로운 장보기 품목`,
            body: (t) => `[${t.author || '가족'}] ${t.text || t.title}`
          });
          if (this.summary) this.summary.refresh();
        });

        this.db.ref('family_stickies').on('value', snap => {
          this.stores.stickies.syncFromFirebase(snap.val(), {
            title: () => `📌 새로운 고정 메모 등록`,
            body: (m) => `${m.text || '새로운 메모가 등록되었습니다.'}`
          });
          if (this.summary) this.summary.refresh();
        });

        this.db.ref('family_ledger').on('value', snap => {
          this.stores.ledger.syncFromFirebase(snap.val(), {
            title: () => `💰 새로운 가계부 지출 내역`,
            body: (l) => `[${l.author || '가족'}] ${l.desc || '지출'}: ${Number(l.amount||0).toLocaleString()}원`
          });
          if (this.summary) this.summary.refresh();
        });
        
        this.db.ref('family_schedules').on('value', snap => {
          this.stores.schedules.syncFromFirebase(snap.val(), {
            title: () => `🗓️ 새로운 가족 일정 등록`,
            body: (s) => `[${s.author || '가족'}] ${s.title || s.text} (${s.date})`
          });
          if (this.calendar) this.calendar.generate();
          if (this.summary) this.summary.refresh();
        });

        this.db.ref('family_trips').on('value', snap => {
          this.stores.trips.syncFromFirebase(snap.val(), {
            title: () => `✈️ 새로운 가족 여행지 등록`,
            body: (tr) => `[${tr.author || '가족'}] ${tr.place || tr.title || '새 여행지'} (${tr.date || ''})`
          });
          if (this.trip) this.trip.renderList(this.stores.trips.getItems());
          if (this.summary) this.summary.refresh();
        });

        this.db.ref('auth_pins').on('value', snap => {
          const data = snap.val() || {};
          if (data.jinse) safeSet('pin_hash_jinse', data.jinse);
          if (data.jihye) safeSet('pin_hash_jihye', data.jihye);
        });

        this.syncPrivateChannel();

        this.db.ref('family_budget').on('value', snap => {
          const data = snap.val() || {};
          Object.keys(data).forEach(k => safeSet(`budget_${k}`, String(data[k])));
          if (this.ledger) this.ledger.render(this.stores.ledger.getItems());
          if (this.summary) this.summary.refresh();
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
            activeEl.classList.contains('goal-input') ||
            activeEl.classList.contains('memo-textarea')
          );

          if (!isTyping && hasChange && this.calendar) {
            this.calendar.generate();
          }
          if (this.summary) this.summary.refresh();
        });
      }
    } catch (e) {
      console.warn("Firebase 연결 대기:", e);
    }

    if (this.parking) this.parking.render(this.stores.parking.getItems());
    if (this.schedule) this.schedule.render();
    if (this.memo) this.memo.render();
    if (this.ledger) this.ledger.render(this.stores.ledger.getItems());
    if (this.trip) this.trip.renderList(this.stores.trips.getItems());

    const targetHash = window.location.hash.replace('#', '');
    const validScreens = ['parking', 'shopping', 'sticky', 'trip', 'ledger', 'schedule', 'calendar'];

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
