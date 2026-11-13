/**
 * GOGO 스마트 매니저 - 차량 관리 (js/mileage.js)
 * - X1   : iOS 단축어(블루투스 연결/해제) + 카카오 길찾기 API 추정 거리 → /trip_logs, 월 1회 계기판 보정
 * - 엑센트: 계기판 주행거리 수기 입력 → /odometer_logs
 * - 정비 알림: /maintenance_rules (기준표) + /maintenance_logs (이력) → 남은 km / 남은 일수 판정
 *
 * Firebase 경로
 *   /trip_pending/x1            { startId, lat, lng }                         (단축어 A가 기록, B가 삭제)
 *   /trip_logs/{id}             { id, startId, car, from, to, distance_km, route_min, elapsed_min, flag, manual_km, source, author, time }
 *   /odometer_logs/{id}         { id, car, odometer_km, author, time }
 *   /maintenance_rules/{car}/{itemKey} { name, interval_km, interval_months, warn_km, warn_days, enabled, base_km, base_date, order, custom }
 *   /maintenance_logs/{id}      { id, car, itemKey, done_km, done_date, memo, author, time }
 *
 * 카카오 REST 키 · 단축어 토큰은 이 파일에 절대 넣지 않는다 (공개 저장소).
 */
window.App = window.App || {};

(function () {
  'use strict';

  const PATHS = {
    pending: 'trip_pending',
    trips: 'trip_logs',
    odo: 'odometer_logs',
    rules: 'maintenance_rules',
    mlogs: 'maintenance_logs'
  };

  const CARS = {
    x1: { key: 'x1', name: 'X1', emoji: '⚪', auto: true },
    accent: { key: 'accent', name: '엑센트', emoji: '⚫', auto: false }
  };

  const CACHE_KEY = 'vehicle_cache_v1';
  const TAB_KEY = 'vehicle_tab';
  const K_MIN = 0.8;
  const K_MAX = 1.5;
  const K_MIN_BASE_KM = 50;         // 보정 구간 추정 합계가 이보다 작으면 k 계산 안 함
  const ACCENT_STALE_DAYS = 30;     // 엑센트 계기판 미입력 경고 기준
  const PENDING_STALE_HOURS = 12;   // 미종료 운행 경고 기준
  const ODO_JUMP_CONFIRM_KM = 20000;
  const TRIP_QUERY_LIMIT = 500;     // trip_logs 다운로드량 제한 (보정 주기 1개월 ≈ 120건)
  const ODO_QUERY_LIMIT = 200;

  /* 정비 기준표 기본값 (계획서 v2 · 4장) — 최초 1회만 시드, 이후 앱에서 수정 */
  const DEFAULT_RULES = {
    x1: {
      engine_oil: { name: '엔진오일 · 필터', interval_km: 16000, interval_months: 12, order: 1 },
      tire_rotation: { name: '타이어 위치 교환', interval_km: 10000, interval_months: 12, order: 2 },
      cabin_filter: { name: '실내 마이크로필터', interval_km: 16000, interval_months: 12, order: 3 },
      brake_check: { name: '브레이크 패드 · 디스크 점검', interval_km: 20000, interval_months: 24, order: 4 },
      brake_fluid: { name: '브레이크액 교환', interval_km: 0, interval_months: 24, order: 5 },
      air_filter: { name: '엔진 에어필터', interval_km: 48000, interval_months: 48, order: 6 },
      spark_plug: { name: '점화플러그', interval_km: 96000, interval_months: 72, order: 7 },
      wiper: { name: '와이퍼 블레이드', interval_km: 0, interval_months: 12, order: 8 }
    },
    accent: {
      engine_oil: { name: '엔진오일 · 필터', interval_km: 7500, interval_months: 6, order: 1 },
      tire_rotation: { name: '타이어 위치 교환', interval_km: 10000, interval_months: 12, order: 2 },
      cabin_filter: { name: '공조 에어필터', interval_km: 15000, interval_months: 12, order: 3 },
      air_filter: { name: '엔진 에어클리너', interval_km: 20000, interval_months: 24, order: 4 },
      brake_check: { name: '브레이크 패드 · 디스크 점검', interval_km: 10000, interval_months: 12, order: 5 },
      brake_fluid: { name: '브레이크액 교환', interval_km: 40000, interval_months: 24, order: 6 },
      coolant: { name: '냉각수 교환', interval_km: 40000, interval_months: 24, order: 7 },
      atf: { name: '자동변속기 오일', interval_km: 100000, interval_months: 0, order: 8 },
      battery: { name: '배터리 상태 점검', interval_km: 0, interval_months: 12, order: 9 }
    }
  };

  /* ────────── 헬퍼 ────────── */
  const esc = (s) => (typeof window.escapeHtml === 'function' ? window.escapeHtml(s) : String(s === null || s === undefined ? '' : s));

  const num = (v) => {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  const posInt = (v) => {
    const n = num(v);
    return n !== null && n > 0 ? Math.round(n) : 0;
  };

  const toList = (raw) => {
    if (!raw || typeof raw !== 'object') return [];
    return Object.keys(raw).map((k) => raw[k]).filter((v) => v && typeof v === 'object');
  };

  const timeOf = (item) => (typeof window.parkingTime === 'function' ? window.parkingTime(item) : (num(item && item.id) || 0));

  const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  const fmtKm = (n) => (n === null || n === undefined || !isFinite(n) ? '-' : `${Math.round(n).toLocaleString()}km`);

  const today = () => (typeof window.todayStr === 'function' ? window.todayStr() : new Date().toISOString().split('T')[0]);

  /* 'YYYY-MM-DD' + n개월 (말일 보정: 1/31 + 1개월 → 2/28) */
  const addMonths = (ymd, months) => {
    if (!isYmd(ymd)) return '';
    const p = ymd.split('-').map(Number);
    const total = p[0] * 12 + (p[1] - 1) + months;
    const y = Math.floor(total / 12);
    const m = total % 12;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = Math.min(p[2], lastDay);
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };

  const kstId = () => (typeof window.generateKstId === 'function' ? window.generateKstId() : Date.now());

  const kstMonthKey = () => String(kstId()).substring(0, 6); // yyyyMM

  const idMonthKey = (item) => {
    const s = String(item && item.id !== undefined ? item.id : '');
    return /^\d{14}$/.test(s) ? s.substring(0, 6) : '';
  };

  const timeText = () => {
    const now = new Date();
    return `${now.getMonth() + 1}월 ${now.getDate()}일 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

  const authorName = () => {
    const user = App.auth ? App.auth.currentUser : 'public';
    return user === 'jihye' ? '지혜' : '진세';
  };

  const carKeyOfItem = (item) => {
    const c = String((item && item.car) || '').toLowerCase();
    return c.indexOf('x1') !== -1 ? 'x1' : 'accent';
  };

  const toast = (msg) => { if (App.ui && typeof App.ui.toast === 'function') App.ui.toast(msg); };

  /* ────────── 모듈 ────────── */
  App.mileage = {
    data: { pending: {}, trips: [], odo: [], rules: {}, mlogs: [] },
    currentCar: 'x1',
    _refs: [],
    _attached: false,
    _seeding: {},
    _modalAction: null,

    init() {
      const tab = safeGet(TAB_KEY);
      this.currentCar = CARS[tab] ? tab : 'x1';
      try {
        const cached = JSON.parse(safeGet(CACHE_KEY) || 'null');
        if (cached && typeof cached === 'object') {
          this.data = {
            pending: cached.pending && typeof cached.pending === 'object' ? cached.pending : {},
            trips: Array.isArray(cached.trips) ? cached.trips : [],
            odo: Array.isArray(cached.odo) ? cached.odo : [],
            rules: cached.rules && typeof cached.rules === 'object' ? cached.rules : {},
            mlogs: Array.isArray(cached.mlogs) ? cached.mlogs : []
          };
        }
      } catch (e) {
        console.warn('[Mileage] 캐시 복원 실패', e);
      }
    },

    /* App.initFirebase 에서 1회 호출 — 경로별 단일 리스너 */
    attach(db) {
      if (this._attached || !db) return;
      this._attached = true;

      const listen = (ref, path, handler) => {
        ref.on('value', (snap) => {
          try {
            handler(snap.val());
            this.persist();
            this.refresh();
          } catch (e) {
            console.error(`[Mileage] ${path} 처리 오류`, e);
          }
        }, (err) => console.error(`[Mileage] ${path} 읽기 실패`, err));
        this._refs.push(ref);
      };

      listen(db.ref(PATHS.pending), PATHS.pending, (val) => {
        this.data.pending = val && typeof val === 'object' ? val : {};
      });
      listen(db.ref(PATHS.trips).limitToLast(TRIP_QUERY_LIMIT), PATHS.trips, (val) => {
        this.data.trips = toList(val).sort((a, b) => timeOf(b) - timeOf(a));
      });
      listen(db.ref(PATHS.odo).limitToLast(ODO_QUERY_LIMIT), PATHS.odo, (val) => {
        this.data.odo = toList(val).filter((o) => num(o.odometer_km) !== null).sort((a, b) => timeOf(b) - timeOf(a));
      });
      listen(db.ref(PATHS.rules), PATHS.rules, (val) => {
        this.data.rules = val && typeof val === 'object' ? val : {};
        Object.keys(CARS).forEach((car) => {
          if (!this.data.rules[car]) this.seedRules(db, car);
        });
      });
      listen(db.ref(PATHS.mlogs), PATHS.mlogs, (val) => {
        this.data.mlogs = toList(val).sort((a, b) => timeOf(b) - timeOf(a));
      });
    },

    detach() {
      this._refs.forEach((ref) => { try { ref.off('value'); } catch (e) { console.warn(e); } });
      this._refs = [];
      this._attached = false;
    },

    /* 기준표가 비어 있을 때만 기본값 기록 (트랜잭션 → 다중 기기 중복 시드 방지) */
    seedRules(db, car) {
      if (this._seeding[car]) return;
      this._seeding[car] = true;
      const defaults = {};
      Object.keys(DEFAULT_RULES[car]).forEach((k) => {
        defaults[k] = Object.assign({ warn_km: 1000, warn_days: 30, enabled: true, base_km: 0, base_date: '', custom: false }, DEFAULT_RULES[car][k]);
      });
      db.ref(`${PATHS.rules}/${car}`).transaction((cur) => (cur === null ? defaults : undefined))
        .catch((err) => console.error('[Mileage] 기준표 시드 실패', err))
        .then(() => { this._seeding[car] = false; });
    },

    persist() {
      try {
        safeSet(CACHE_KEY, JSON.stringify(this.data));
      } catch (e) {
        console.warn('[Mileage] 캐시 저장 실패', e);
      }
    },

    refresh() {
      try { if (App.summary && typeof App.summary.renderVehicle === 'function') App.summary.renderVehicle(); } catch (e) { console.error(e); }
      try { if (App.badge && typeof App.badge.refresh === 'function') App.badge.refresh(); } catch (e) { console.error(e); }
      const screen = document.getElementById('screen-vehicle');
      if (screen && screen.classList.contains('active')) this.render();
    },

    write(path, value) {
      if (!App.isFirebaseActive || !App.db) {
        toast('⚠️ 로그인 후 저장할 수 있습니다.');
        return Promise.reject(new Error('firebase inactive'));
      }
      return App.db.ref(path).set(value).catch((err) => {
        console.error(`[Mileage] ${path} 저장 실패`, err);
        toast('⚠️ 서버 저장 실패 - 로그인/네트워크를 확인해주세요.');
        throw err;
      });
    },

    /* ────────── 계산 ────────── */
    tripKm(t) {
      if (!t) return 0;
      const manual = num(t.manual_km);
      if (manual !== null && manual >= 0) return manual;
      if (t.flag === 'roundtrip_suspect') return 0;
      const d = num(t.distance_km);
      return d !== null && d > 0 ? d : 0;
    },

    odoList(car) {
      return this.data.odo.filter((o) => carKeyOfItem(o) === car).sort((a, b) => timeOf(b) - timeOf(a));
    },

    calcCar(car) {
      const odos = this.odoList(car);
      const last = odos[0] || null;
      const prev = odos[1] || null;
      const res = {
        current: null, estimated: false, lastOdo: last, k: 1, kWarn: '',
        sinceKm: 0, monthKm: null, staleDays: null, tripsMonth: 0
      };

      if (last) res.staleDays = Math.floor((Date.now() - timeOf(last)) / 86400000);

      if (car === 'x1') {
        const trips = this.data.trips.filter((t) => carKeyOfItem(t) === 'x1');
        if (last && prev) {
          const tPrev = timeOf(prev);
          const tLast = timeOf(last);
          const est = trips.filter((t) => timeOf(t) > tPrev && timeOf(t) <= tLast).reduce((s, t) => s + this.tripKm(t), 0);
          const actual = num(last.odometer_km) - num(prev.odometer_km);
          if (est >= K_MIN_BASE_KM && actual > 0) {
            const r = actual / est;
            if (r >= K_MIN && r <= K_MAX) res.k = r;
            else res.kWarn = `보정 계수 ${r.toFixed(2)} 범위(${K_MIN}~${K_MAX}) 밖 — 미적용`;
          }
        }
        const tLastOdo = last ? timeOf(last) : 0;
        res.sinceKm = trips.filter((t) => timeOf(t) > tLastOdo).reduce((s, t) => s + this.tripKm(t), 0) * res.k;
        if (last) {
          res.current = num(last.odometer_km) + res.sinceKm;
          res.estimated = res.sinceKm > 0;
        }
        const mk = kstMonthKey();
        const monthTrips = trips.filter((t) => idMonthKey(t) === mk);
        res.tripsMonth = monthTrips.length;
        res.monthKm = monthTrips.reduce((s, t) => s + this.tripKm(t), 0) * res.k;
      } else {
        if (last) res.current = num(last.odometer_km);
        const mk = kstMonthKey();
        const startId = Number(`${mk}01000000`);
        const before = odos.find((o) => Number(o.id) < startId);
        if (last && before && idMonthKey(last) === mk) {
          res.monthKm = Math.max(0, num(last.odometer_km) - num(before.odometer_km));
        }
      }
      return res;
    },

    rulesOf(car) {
      const raw = this.data.rules[car] || {};
      return Object.keys(raw)
        .filter((k) => raw[k] && typeof raw[k] === 'object')
        .map((k) => Object.assign({ itemKey: k }, raw[k]))
        .sort((a, b) => (num(a.order) || 999) - (num(b.order) || 999));
    },

    itemStatus(car, rule, current) {
      const logs = this.data.mlogs
        .filter((l) => carKeyOfItem(l) === car && l.itemKey === rule.itemKey)
        .sort((a, b) => {
          const da = String(a.done_date || '');
          const dbs = String(b.done_date || '');
          if (da !== dbs) return da < dbs ? 1 : -1;
          return (num(b.done_km) || 0) - (num(a.done_km) || 0);
        });
      const lastLog = logs[0] || null;
      /* 기준 km 0은 "마지막 정비 날짜"가 함께 입력된 경우에만 유효 (신차 출고 기준) */
      const ruleBaseKm = posInt(rule.base_km) || (isYmd(rule.base_date) ? 0 : null);
      const baseKm = lastLog ? num(lastLog.done_km) : ruleBaseKm;
      const baseDate = lastLog ? String(lastLog.done_date || '') : String(rule.base_date || '');
      const intKm = posInt(rule.interval_km);
      const intMo = posInt(rule.interval_months);
      const warnKm = num(rule.warn_km) !== null ? num(rule.warn_km) : 1000;
      const warnDays = num(rule.warn_days) !== null ? num(rule.warn_days) : 30;

      const out = {
        rule, lastLog, baseKm, baseDate, intKm, intMo,
        remainKm: null, remainDays: null, dueKm: null, dueDate: '',
        ratio: 0, status: 'unset', needOdo: false
      };

      if (intKm && baseKm !== null) {
        out.dueKm = baseKm + intKm;
        if (current !== null) {
          out.remainKm = out.dueKm - current;
          out.ratio = Math.max(out.ratio, (current - baseKm) / intKm);
        } else {
          out.needOdo = true;
        }
      }
      if (intMo && isYmd(baseDate)) {
        out.dueDate = addMonths(baseDate, intMo);
        out.remainDays = daysBetween(today(), out.dueDate);
        const span = daysBetween(baseDate, out.dueDate);
        if (span > 0) out.ratio = Math.max(out.ratio, daysBetween(baseDate, today()) / span);
      }

      if (out.remainKm === null && out.remainDays === null) {
        out.status = 'unset';
      } else if ((out.remainKm !== null && out.remainKm <= 0) || (out.remainDays !== null && out.remainDays <= 0)) {
        out.status = 'over';
      } else if ((out.remainKm !== null && out.remainKm <= warnKm) || (out.remainDays !== null && out.remainDays <= warnDays)) {
        out.status = 'soon';
      } else {
        out.status = 'ok';
      }
      out.ratio = Math.min(Math.max(out.ratio, 0), 1);
      return out;
    },

    statusList(car) {
      const calc = this.calcCar(car);
      return this.rulesOf(car)
        .filter((r) => r.enabled !== false)
        .map((r) => this.itemStatus(car, r, calc.current));
    },

    alerts() {
      const rank = { over: 0, soon: 1 };
      const list = [];
      Object.keys(CARS).forEach((car) => {
        this.statusList(car).forEach((s) => {
          if (s.status === 'over' || s.status === 'soon') list.push(Object.assign({ car }, s));
        });
      });
      return list.sort((a, b) => {
        if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
        const ra = a.remainKm !== null ? a.remainKm : (a.remainDays !== null ? a.remainDays * 50 : 0);
        const rb = b.remainKm !== null ? b.remainKm : (b.remainDays !== null ? b.remainDays * 50 : 0);
        return ra - rb;
      });
    },

    remainText(s) {
      const parts = [];
      if (s.remainKm !== null) parts.push(s.remainKm <= 0 ? `${fmtKm(-s.remainKm)} 초과` : `${fmtKm(s.remainKm)} 남음`);
      if (s.remainDays !== null) parts.push(s.remainDays <= 0 ? `${-s.remainDays}일 지남` : `${s.remainDays}일 남음`);
      if (s.needOdo) parts.push('계기판 입력 필요');
      return parts.join(' · ') || '기준값 미입력';
    },

    /* ────────── 홈 카드 요약 ────────── */
    summaryHtml() {
      const x1 = this.calcCar('x1');
      const ac = this.calcCar('accent');
      const alerts = this.alerts();
      let alertLine = '<span class="vehicle-alert-ok">정비 임박 항목 없음 ✅</span>';
      if (alerts.length) {
        const a = alerts[0];
        const more = alerts.length > 1 ? ` 외 ${alerts.length - 1}건` : '';
        alertLine = `<span class="vehicle-alert-${a.status}">${a.status === 'over' ? '🔴' : '🟠'} ${esc(CARS[a.car].name)} · ${esc(a.rule.name)} · ${esc(this.remainText(a))}${more}</span>`;
      }
      return `
        <div class="vehicle-summary-row">
          <span>⚪ <strong>${esc(fmtKm(x1.current))}</strong></span>
          <span class="live-parking-divider">│</span>
          <span>⚫ <strong>${esc(fmtKm(ac.current))}</strong></span>
        </div>
        <div class="vehicle-summary-alert">${alertLine}</div>`;
    },

    /* ────────── 화면 렌더 ────────── */
    setCar(car) {
      if (!CARS[car]) return;
      this.currentCar = car;
      safeSet(TAB_KEY, car);
      this.render();
    },

    render() {
      const root = document.getElementById('vehicleRoot');
      if (!root) return;
      const car = this.currentCar;
      const info = CARS[car];
      const calc = this.calcCar(car);

      const tabs = Object.keys(CARS).map((k) => `
        <button type="button" class="btn-toggle ${k === car ? 'active' : ''}" onclick="App.mileage.setCar('${k}')">${CARS[k].emoji} ${esc(CARS[k].name)}</button>`).join('');

      root.innerHTML = `
        <div class="card form-card">
          <div class="toggle-group">${tabs}</div>
        </div>
        ${this.renderOverview(car, info, calc)}
        ${this.renderOdoForm(car, info, calc)}
        ${this.renderMaintenance(car)}
        ${info.auto ? this.renderTrips() : ''}
        ${this.renderHistory(car)}`;
    },

    renderOverview(car, info, calc) {
      const rows = [];
      const lastOdo = calc.lastOdo;
      rows.push(`<div class="vehicle-big-km">${esc(fmtKm(calc.current))}${calc.estimated ? '<span class="vehicle-est-tag">추정</span>' : ''}</div>`);

      if (!lastOdo) {
        rows.push('<div class="vehicle-warn">⚠️ 계기판 주행거리를 먼저 1회 입력하세요.</div>');
      } else {
        rows.push(`<div class="vehicle-meta">마지막 계기판: ${esc(fmtKm(num(lastOdo.odometer_km)))} (${esc(lastOdo.time || '')})</div>`);
      }

      if (info.auto) {
        rows.push(`<div class="vehicle-meta">이번 달 운행: ${esc(fmtKm(calc.monthKm))} · ${calc.tripsMonth}회 · 보정 계수 k=${calc.k.toFixed(3)}</div>`);
        if (lastOdo) rows.push(`<div class="vehicle-meta">보정 이후 추정 누적: ${esc(fmtKm(calc.sinceKm))}</div>`);
        if (calc.kWarn) rows.push(`<div class="vehicle-warn">⚠️ ${esc(calc.kWarn)}</div>`);
        if (calc.staleDays !== null && calc.staleDays > 31) rows.push('<div class="vehicle-warn">⚠️ 월 1회 계기판 보정 시기가 지났습니다.</div>');
        const p = this.data.pending && this.data.pending.x1;
        if (p && num(p.startId) !== null) {
          const ageH = (Date.now() - timeOf({ id: p.startId })) / 3600000;
          if (ageH > PENDING_STALE_HOURS) {
            rows.push(`<div class="vehicle-warn">⚠️ 종료되지 않은 운행 기록이 있습니다 (${Math.floor(ageH)}시간 전 출발). <button type="button" class="btn-prof" onclick="App.mileage.clearPending()">정리</button></div>`);
          } else {
            rows.push(`<div class="vehicle-live">🟢 운행 중 (${esc(String(p.startId).substring(8, 10))}:${esc(String(p.startId).substring(10, 12))} 출발)</div>`);
          }
        }
      } else {
        rows.push(`<div class="vehicle-meta">이번 달 운행: ${esc(fmtKm(calc.monthKm))}</div>`);
        if (calc.staleDays !== null && calc.staleDays >= ACCENT_STALE_DAYS) {
          rows.push(`<div class="vehicle-warn">⚠️ ${calc.staleDays}일째 미입력 — 주유 시 계기판 값을 입력하세요.</div>`);
        }
      }

      return `
        <div class="card list-card">
          <div class="list-header"><h3>${info.emoji} ${esc(info.name)} 현재 주행거리</h3></div>
          ${rows.join('')}
        </div>`;
    },

    renderOdoForm(car, info) {
      return `
        <div class="card form-card">
          <div class="form-group">
            <label>📟 계기판 주행거리 입력 ${info.auto ? '(월 1회 보정)' : '(주유 시 권장)'}</label>
            <div class="input-with-btn-row">
              <input type="number" id="vehicleOdoInput" class="memo-text-input" inputmode="numeric" placeholder="예: 12345" onkeydown="if(event.key==='Enter') App.mileage.saveOdo()">
              <button type="button" class="btn-save btn-inline-action" onclick="App.mileage.saveOdo()">저장</button>
            </div>
          </div>
        </div>`;
    },

    renderMaintenance(car) {
      const list = this.statusList(car);
      const rank = { over: 0, soon: 1, ok: 2, unset: 3 };
      const sorted = list.slice().sort((a, b) => rank[a.status] - rank[b.status]);
      const icon = { over: '🔴', soon: '🟠', ok: '🟢', unset: '⚪' };
      const disabled = this.rulesOf(car).filter((r) => r.enabled === false);

      const items = sorted.length ? sorted.map((s) => {
        const key = esc(s.rule.itemKey);
        const cycle = [s.intKm ? `${s.intKm.toLocaleString()}km` : '', s.intMo ? `${s.intMo}개월` : ''].filter(Boolean).join(' / ');
        const due = [s.dueKm !== null ? `${fmtKm(s.dueKm)}` : '', s.dueDate || ''].filter(Boolean).join(' · ');
        return `
          <div class="log-item vehicle-mt-item vehicle-mt-${s.status}">
            <div class="log-content">
              <div class="log-text">${icon[s.status]} ${esc(s.rule.name)}</div>
              <div class="log-time">${esc(this.remainText(s))}</div>
              <div class="vehicle-mt-sub">주기 ${esc(cycle || '-')}${due ? ` · 다음 ${esc(due)}` : ''}</div>
              ${s.status !== 'unset' ? `<div class="vehicle-bar"><div class="vehicle-bar-fill vehicle-bar-${s.status}" style="width:${Math.round(s.ratio * 100)}%"></div></div>` : ''}
            </div>
            <div class="vehicle-mt-actions">
              <button type="button" class="btn-prof" onclick="App.mileage.openDone('${car}','${key}')">완료</button>
              <button type="button" class="btn-prof" onclick="App.mileage.openRule('${car}','${key}')">설정</button>
            </div>
          </div>`;
      }).join('') : '<div class="empty-msg">정비 기준표를 불러오는 중입니다.</div>';

      const disabledHtml = disabled.length
        ? `<div class="vehicle-mt-sub">꺼진 항목: ${disabled.map((r) => `<a href="javascript:void(0)" onclick="App.mileage.openRule('${car}','${esc(r.itemKey)}')">${esc(r.name)}</a>`).join(', ')}</div>`
        : '';

      return `
        <div class="card list-card">
          <div class="list-header">
            <div>
              <h3>🔧 정비 현황</h3>
              <span class="list-sub">km · 기간 중 먼저 오는 쪽 기준${car === 'x1' ? ' · 계기판 CBS 표시 우선' : ''}</span>
            </div>
            <button type="button" class="btn-prof" onclick="App.mileage.openRule('${car}','')">+ 항목</button>
          </div>
          <div class="log-list">${items}</div>
          ${disabledHtml}
        </div>`;
    },

    renderTrips() {
      const trips = this.data.trips.filter((t) => carKeyOfItem(t) === 'x1').slice(0, 10);
      const body = trips.length ? trips.map((t) => {
        const id = esc(String(t.id));
        const km = this.tripKm(t);
        const routeMin = num(t.route_min);
        const elapsed = num(t.elapsed_min);
        const detour = routeMin !== null && elapsed !== null && elapsed > routeMin * 2 + 15;
        let badge = '';
        if (t.flag === 'roundtrip_suspect') {
          badge = num(t.manual_km) !== null ? '<span class="vehicle-badge">✏️ 수동</span>' : '<span class="vehicle-badge vehicle-badge-warn">⚠️ 왕복 의심</span>';
        } else if (detour) {
          badge = '<span class="vehicle-badge vehicle-badge-warn">⚠️ 경유 의심</span>';
        }
        return `
          <div class="log-item">
            <div class="log-content">
              <div class="log-text">🚗 ${esc(fmtKm(km))} ${badge}</div>
              <div class="log-time">🕒 ${esc(t.time || '')} · 예상 ${routeMin !== null ? routeMin : '-'}분 / 실제 ${elapsed !== null ? elapsed : '-'}분</div>
              ${t.flag === 'roundtrip_suspect' ? `<button type="button" class="btn-prof" onclick="App.mileage.setManualKm('${id}')">실제 거리 입력</button>` : ''}
            </div>
            <button type="button" class="delete-item-btn" onclick="App.mileage.deleteTrip('${id}')" title="삭제">✕</button>
          </div>`;
      }).join('') : '<div class="empty-msg">운행 기록이 없습니다. 단축어 자동화를 설정하세요. 🚗</div>';

      return `
        <div class="card list-card">
          <div class="list-header"><div><h3>🛣️ 최근 운행 (카카오 추정)</h3><span class="list-sub">최근 10건</span></div></div>
          <div class="log-list">${body}</div>
        </div>`;
    },

    renderHistory(car) {
      const rules = this.data.rules[car] || {};
      const logs = this.data.mlogs.filter((l) => carKeyOfItem(l) === car).slice(0, 20);
      const odos = this.odoList(car).slice(0, 5);

      const mt = logs.length ? logs.map((l) => {
        const name = rules[l.itemKey] && rules[l.itemKey].name ? rules[l.itemKey].name : l.itemKey;
        return `
          <div class="log-item">
            <div class="log-content">
              <div class="log-text">🔧 ${esc(name)} · ${esc(fmtKm(num(l.done_km)))}</div>
              <div class="log-time">📅 ${esc(l.done_date || '')}${l.memo ? ` · ${esc(l.memo)}` : ''} · ${esc(l.author || '')}</div>
            </div>
            <button type="button" class="delete-item-btn" onclick="App.mileage.deleteLog('${esc(String(l.id))}')" title="삭제">✕</button>
          </div>`;
      }).join('') : '<div class="empty-msg">정비 이력이 없습니다.</div>';

      const od = odos.length ? odos.map((o) => `
          <div class="log-item">
            <div class="log-content">
              <div class="log-text">📟 ${esc(fmtKm(num(o.odometer_km)))}</div>
              <div class="log-time">🕒 ${esc(o.time || '')} · ${esc(o.author || '')}</div>
            </div>
            <button type="button" class="delete-item-btn" onclick="App.mileage.deleteOdo('${esc(String(o.id))}')" title="삭제">✕</button>
          </div>`).join('') : '<div class="empty-msg">계기판 입력 기록이 없습니다.</div>';

      return `
        <div class="card list-card">
          <div class="list-header"><h3>📋 정비 이력</h3></div>
          <div class="log-list">${mt}</div>
        </div>
        <div class="card list-card">
          <div class="list-header"><div><h3>📟 계기판 입력 기록</h3><span class="list-sub">최근 5건</span></div></div>
          <div class="log-list">${od}</div>
        </div>`;
    },

    /* ────────── 쓰기 동작 ────────── */
    saveOdo() {
      const input = document.getElementById('vehicleOdoInput');
      if (!input) return;
      const km = num(input.value);
      if (km === null || km < 0 || km > 999999 || Math.round(km) !== km) {
        toast('⚠️ 0~999,999 사이 정수 km를 입력하세요.');
        return;
      }
      const car = this.currentCar;
      const last = this.odoList(car)[0];
      if (last) {
        const lastKm = num(last.odometer_km);
        if (km < lastKm) {
          toast(`⚠️ 직전 값(${fmtKm(lastKm)})보다 작을 수 없습니다.`);
          return;
        }
        if (km - lastKm > ODO_JUMP_CONFIRM_KM && !confirm(`직전 값보다 ${fmtKm(km - lastKm)} 증가했습니다. 맞습니까?`)) return;
      }
      const id = kstId();
      const rec = { id, car: CARS[car].name, odometer_km: km, author: authorName(), time: timeText() };
      this.write(`${PATHS.odo}/${id}`, rec).then(() => {
        input.value = '';
        toast(`📟 ${CARS[car].name} ${fmtKm(km)} 저장 완료`);
      }).catch(() => {});
    },

    deleteOdo(id) {
      if (!confirm('이 계기판 기록을 삭제하시겠습니까?')) return;
      this.write(`${PATHS.odo}/${id}`, null).then(() => toast('🗑️ 삭제되었습니다.')).catch(() => {});
    },

    setManualKm(id) {
      const t = this.data.trips.find((x) => String(x.id) === String(id));
      if (!t) return;
      const v = prompt('실제 운행 거리(km)를 입력하세요. (예: 12.5)', num(t.manual_km) !== null ? String(t.manual_km) : '');
      if (v === null) return;
      const km = num(v);
      if (km === null || km < 0 || km > 1000) {
        toast('⚠️ 0~1000 사이 숫자를 입력하세요.');
        return;
      }
      this.write(`${PATHS.trips}/${id}/manual_km`, Math.round(km * 10) / 10).then(() => toast('✏️ 거리 보정 완료')).catch(() => {});
    },

    deleteTrip(id) {
      if (!confirm('이 운행 기록을 삭제하시겠습니까?')) return;
      this.write(`${PATHS.trips}/${id}`, null).then(() => toast('🗑️ 삭제되었습니다.')).catch(() => {});
    },

    clearPending() {
      if (!confirm('종료되지 않은 운행 기록을 정리하시겠습니까? (거리는 기록되지 않습니다)')) return;
      this.write(`${PATHS.pending}/x1`, null).then(() => toast('🧹 정리되었습니다.')).catch(() => {});
    },

    deleteLog(id) {
      if (!confirm('이 정비 이력을 삭제하시겠습니까?')) return;
      this.write(`${PATHS.mlogs}/${id}`, null).then(() => toast('🗑️ 삭제되었습니다.')).catch(() => {});
    },

    /* ────────── 모달 ────────── */
    ensureModal() {
      let el = document.getElementById('vehicle-modal');
      if (el) return el;
      el = document.createElement('div');
      el.id = 'vehicle-modal';
      el.className = 'modal-overlay';
      el.style.display = 'none';
      el.innerHTML = `
        <div class="modal-card">
          <button type="button" class="modal-close-icon-btn" onclick="App.mileage.closeModal()" title="닫기">✕</button>
          <div class="modal-header"><h3 id="vehicleModalTitle"></h3><p class="modal-desc" id="vehicleModalDesc"></p></div>
          <div class="modal-body modal-body-left" id="vehicleModalBody"></div>
          <div class="modal-actions" id="vehicleModalActions"></div>
        </div>`;
      document.body.appendChild(el);
      return el;
    },

    showModal(title, desc, bodyHtml, actionsHtml, action) {
      const el = this.ensureModal();
      document.getElementById('vehicleModalTitle').textContent = title;
      document.getElementById('vehicleModalDesc').textContent = desc;
      document.getElementById('vehicleModalBody').innerHTML = bodyHtml;
      document.getElementById('vehicleModalActions').innerHTML = actionsHtml;
      this._modalAction = action;
      el.style.display = 'flex';
    },

    closeModal() {
      const el = document.getElementById('vehicle-modal');
      if (el) el.style.display = 'none';
      this._modalAction = null;
    },

    submitModal() {
      if (typeof this._modalAction === 'function') this._modalAction();
    },

    val(id) {
      const el = document.getElementById(id);
      return el ? el.value : '';
    },

    openDone(car, itemKey) {
      const rules = this.data.rules[car] || {};
      const rule = rules[itemKey];
      if (!rule) return;
      const calc = this.calcCar(car);
      const defKm = calc.current !== null ? Math.round(calc.current) : '';
      const body = `
        <div class="grid-2">
          <div class="form-group"><label>정비 시 주행거리 (km)</label><input type="number" id="vmDoneKm" class="memo-text-input" inputmode="numeric" value="${esc(defKm)}"></div>
          <div class="form-group"><label>정비 날짜</label><input type="date" id="vmDoneDate" class="memo-text-input" value="${esc(today())}"></div>
        </div>
        <div class="form-group"><label>메모 (정비소, 비용 등)</label><input type="text" id="vmDoneMemo" class="memo-text-input" maxlength="100" placeholder="예: BMW 청주 서비스센터 / 85,000원"></div>`;
      const actions = `
        <button type="button" class="btn-modal-save" onclick="App.mileage.submitModal()">✅ 완료 기록</button>
        <button type="button" class="btn-modal-cancel" onclick="App.mileage.closeModal()">취소</button>`;
      this.showModal(`🔧 ${rule.name} 완료`, `${CARS[car].emoji} ${CARS[car].name}${car === 'x1' ? ' · 추정값이면 계기판 값으로 수정하세요' : ''}`, body, actions, () => {
        const km = num(this.val('vmDoneKm'));
        const date = this.val('vmDoneDate');
        const memo = String(this.val('vmDoneMemo') || '').trim().substring(0, 100);
        if (km === null || km < 0 || km > 999999) { toast('⚠️ 주행거리를 확인하세요.'); return; }
        if (!isYmd(date)) { toast('⚠️ 날짜를 확인하세요.'); return; }
        if (date > today()) { toast('⚠️ 미래 날짜는 입력할 수 없습니다.'); return; }
        const id = kstId();
        const rec = { id, car: CARS[car].name, itemKey, done_km: Math.round(km), done_date: date, memo, author: authorName(), time: timeText() };
        this.write(`${PATHS.mlogs}/${id}`, rec).then(() => {
          this.closeModal();
          toast(`✅ ${rule.name} 완료 기록`);
        }).catch(() => {});
      });
    },

    openRule(car, itemKey) {
      const rules = this.data.rules[car] || {};
      const isNew = !itemKey;
      const rule = isNew
        ? { name: '', interval_km: 0, interval_months: 0, warn_km: 1000, warn_days: 30, enabled: true, base_km: 0, base_date: '', custom: true }
        : rules[itemKey];
      if (!rule) return;
      const v = (x) => (posInt(x) ? posInt(x) : '');
      const body = `
        <div class="form-group"><label>항목 이름</label><input type="text" id="vmName" class="memo-text-input" maxlength="40" value="${esc(rule.name || '')}" placeholder="예: 타이어 위치 교환"></div>
        <div class="grid-2">
          <div class="form-group"><label>주기 (km, 0=미사용)</label><input type="number" id="vmIntKm" class="memo-text-input" inputmode="numeric" value="${esc(v(rule.interval_km))}" placeholder="예: 4000"></div>
          <div class="form-group"><label>주기 (개월, 0=미사용)</label><input type="number" id="vmIntMo" class="memo-text-input" inputmode="numeric" value="${esc(v(rule.interval_months))}" placeholder="예: 6"></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label>임박 알림 (남은 km)</label><input type="number" id="vmWarnKm" class="memo-text-input" inputmode="numeric" value="${esc(num(rule.warn_km) !== null ? num(rule.warn_km) : 1000)}"></div>
          <div class="form-group"><label>임박 알림 (남은 일)</label><input type="number" id="vmWarnDays" class="memo-text-input" inputmode="numeric" value="${esc(num(rule.warn_days) !== null ? num(rule.warn_days) : 30)}"></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label>마지막 정비 km (이력 없을 때)</label><input type="number" id="vmBaseKm" class="memo-text-input" inputmode="numeric" value="${esc(v(rule.base_km))}" placeholder="모르면 비워두기"></div>
          <div class="form-group"><label>마지막 정비 날짜</label><input type="date" id="vmBaseDate" class="memo-text-input" value="${esc(isYmd(rule.base_date) ? rule.base_date : '')}"></div>
        </div>
        <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="vmEnabled" class="custom-checkbox" ${rule.enabled === false ? '' : 'checked'}><span>알림 사용</span></label></div>`;
      const actions = `
        <button type="button" class="btn-modal-save" onclick="App.mileage.submitModal()">💾 저장</button>
        ${!isNew && rule.custom ? `<button type="button" class="btn-modal-secondary" onclick="App.mileage.deleteRule('${car}','${esc(itemKey)}')">🗑️ 항목 삭제</button>` : ''}
        <button type="button" class="btn-modal-cancel" onclick="App.mileage.closeModal()">취소</button>`;

      this.showModal(isNew ? '➕ 정비 항목 추가' : '⚙️ 정비 기준 설정', `${CARS[car].emoji} ${CARS[car].name} · 정비 이력이 있으면 이력이 기준값보다 우선`, body, actions, () => {
        const name = String(this.val('vmName') || '').trim().substring(0, 40);
        const intKm = num(this.val('vmIntKm')) || 0;
        const intMo = num(this.val('vmIntMo')) || 0;
        const warnKm = num(this.val('vmWarnKm'));
        const warnDays = num(this.val('vmWarnDays'));
        const baseKm = num(this.val('vmBaseKm'));
        const baseDate = this.val('vmBaseDate');
        const enabledEl = document.getElementById('vmEnabled');
        if (!name) { toast('⚠️ 항목 이름을 입력하세요.'); return; }
        if (intKm < 0 || intKm > 300000 || intMo < 0 || intMo > 240) { toast('⚠️ 주기 값을 확인하세요.'); return; }
        if (!intKm && !intMo) { toast('⚠️ km 또는 개월 주기 중 하나는 입력하세요.'); return; }
        if (baseDate && !isYmd(baseDate)) { toast('⚠️ 날짜를 확인하세요.'); return; }
        const key = isNew ? `custom_${kstId()}` : itemKey;
        const orders = Object.keys(rules).map((k) => num(rules[k] && rules[k].order) || 0);
        const rec = {
          name,
          interval_km: Math.round(intKm),
          interval_months: Math.round(intMo),
          warn_km: warnKm !== null && warnKm >= 0 ? Math.round(warnKm) : 1000,
          warn_days: warnDays !== null && warnDays >= 0 ? Math.round(warnDays) : 30,
          enabled: enabledEl ? enabledEl.checked : true,
          base_km: baseKm !== null && baseKm >= 0 ? Math.round(baseKm) : 0,
          base_date: baseDate || '',
          order: isNew ? (orders.length ? Math.max.apply(null, orders) + 1 : 1) : (num(rule.order) || 99),
          custom: Boolean(isNew || rule.custom)
        };
        this.write(`${PATHS.rules}/${car}/${key}`, rec).then(() => {
          this.closeModal();
          toast(`💾 ${name} 저장 완료`);
        }).catch(() => {});
      });
    },

    deleteRule(car, itemKey) {
      if (!confirm('이 정비 항목을 삭제하시겠습니까? (정비 이력은 유지됩니다)')) return;
      this.write(`${PATHS.rules}/${car}/${itemKey}`, null).then(() => {
        this.closeModal();
        toast('🗑️ 항목이 삭제되었습니다.');
      }).catch(() => {});
    }
  };

  /* 테스트 / 디버그용 노출 */
  App.mileage._helpers = { addMonths, num, posInt, DEFAULT_RULES };

  document.addEventListener('DOMContentLoaded', () => {
    try { App.mileage.init(); } catch (e) { console.error('[Mileage] init 실패', e); }
  });
})();
