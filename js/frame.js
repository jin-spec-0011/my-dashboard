/**
 * GOGO 스마트 매니저 - 디지털 액자 (js/frame.js, frame.html 전용)
 * 흐름: 로그인(액자 전용 이메일 계정) → 등록 요청·승인 대기 → 키 입력(QR 카드/키 QR) → 사진 슬라이드
 * - 사진: index 리스너 1개, blob은 사진 1장씩 1회 수신 → IndexedDB에 암호문 그대로 캐시 → 표시 직전 복호화
 * - 배치: 가로 1장 / 세로 2장(면적 비교) / 짝 없는 세로 1장 + 흐림 배경, 자르기 없음
 * - 야간 모드·번인 시프트·화면 켜짐 유지·하트비트(5분)·오프라인 순환
 * - 로그아웃/세션 소실 시: 끊김 문구 + QR 카드 복구
 */
(function () {
  'use strict';

  const CFG = window.FRAME_CONFIG;
  const APP_VERSION = 'f0.3.0';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus',
    authDomain: 'gogo-manager-f0a68.firebaseapp.com',
    databaseURL: 'https://gogo-manager-f0a68-default-rtdb.firebaseio.com',
    projectId: 'gogo-manager-f0a68',
    storageBucket: 'gogo-manager-f0a68.firebasestorage.app',
    messagingSenderId: '1016084163074',
    appId: '1:1016084163074:web:836b8517d023638e12551b'
  };
  const JSQR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  const IDB_NAME = 'gogo-frame';
  const IDB_VERSION = 2;
  const STORE_KEYS = 'keys';
  const STORE_BLOBS = 'blobs';
  const KEY_RECORD = 'current';
  const LS_OFFLINE_TEXT = 'gogo_frame_offline_text';
  const LS_DEVICE = 'gogo_frame_device';
  const PHOTO_RE = /^[0-9]{16}$/;
  const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
  const PAIR_GAIN = 1.15;
  const PAIR_GAP_RATIO = 0.015;

  const S = {
    db: null,
    auth: null,
    user: null,
    deviceId: '',
    device: null,
    settings: null,
    key: null,
    index: {},
    order: [],
    cursor: 0,
    started: false,
    readyForSlides: false,
    listeners: [],
    viewerRef: null,
    online: true,
    night: false,
    activeLayer: 'A',
    slideTimer: null,
    clockTimer: null,
    beatTimer: null,
    shiftTimer: null,
    shiftStep: 0,
    wakeLock: null,
    urls: [],
    scanStream: null,
    scanTimer: null,
    everSignedIn: false,
    syncing: false
  };

  /* ══════════ 공용 ══════════ */
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* 무시 */ } };

  function bytesFromB64url(str) {
    const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256Hex16(bytes) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }

  function loadScript(src, globalName) {
    return new Promise((resolve, reject) => {
      if (window[globalName]) { resolve(window[globalName]); return; }
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(`${globalName} 로드 실패`)));
      el.onerror = () => reject(new Error('QR 모듈 로드 실패 (네트워크 확인)'));
      document.head.appendChild(el);
    });
  }

  function defaultDeviceName() {
    const ua = navigator.userAgent || '';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad mini';
    if (/iPhone/.test(ua)) return 'iPhone XS';
    return '액자 기기';
  }

  /* ══════════ IndexedDB (키 + 암호문 캐시) ══════════ */
  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB 미지원')); return; }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_KEYS)) d.createObjectStore(STORE_KEYS);
        if (!d.objectStoreNames.contains(STORE_BLOBS)) d.createObjectStore(STORE_BLOBS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 열기 실패'));
      req.onblocked = () => reject(new Error('IndexedDB 업그레이드 대기 (다른 탭 닫기)'));
    });
  }

  async function idbTx(store, mode, fn) {
    const d = await idbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const os = tx.objectStore(store);
        let result;
        Promise.resolve(fn(os)).then((r) => { result = r; }).catch(reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('트랜잭션 중단'));
      });
    } finally {
      d.close();
    }
  }

  const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const idbGet = (store, k) => idbTx(store, 'readonly', (os) => reqP(os.get(k)));
  const idbPut = (store, k, v) => idbTx(store, 'readwrite', (os) => reqP(os.put(v, k)));
  const idbDel = (store, k) => idbTx(store, 'readwrite', (os) => reqP(os.delete(k)));
  const idbKeys = (store) => idbTx(store, 'readonly', (os) => reqP(os.getAllKeys()));

  async function loadKey() {
    try {
      const rec = await idbGet(STORE_KEYS, KEY_RECORD);
      S.key = rec && rec.fid === CFG.familyId && rec.key ? rec : null;
    } catch (e) {
      console.warn('[Frame] 키 로드 실패', e);
      S.key = null;
    }
  }

  /* ══════════ 안내 화면 ══════════ */
  function showPanel(html) {
    stopSlides();
    $('panel').style.display = 'flex';
    $('panelCard').innerHTML = html;
  }

  function hidePanel() {
    $('panel').style.display = 'none';
  }

  function panelError(msg) {
    const el = $('panelError');
    if (el) el.textContent = msg || '';
  }

  function showLogin(message) {
    const offline = S.everSignedIn || lsGet(LS_DEVICE);
    const text = lsGet(LS_OFFLINE_TEXT) || CFG.defaultOfflineText;
    const qrAllowed = !S.device || S.device.qrCard !== false;
    if (offline) {
      showPanel(`
        <div class="panel-big">${esc(text)}</div>
        ${qrAllowed ? '<button type="button" class="panel-btn panel-btn-main" id="btnScanCard">📷 QR 카드 대기</button>' : ''}
        <p class="panel-sub">${esc(message || '로그인이 해제되었습니다.')}</p>
        <div id="panelError" class="panel-error"></div>
        <details class="panel-more"><summary>관리자 로그인</summary>${loginForm()}</details>`);
    } else {
      showPanel(`
        <div class="panel-title">🖼️ GOGO 가족 액자 설정</div>
        <p class="panel-sub">액자 전용 계정으로 로그인하거나 QR 카드를 대세요.</p>
        ${loginForm()}
        <button type="button" class="panel-btn" id="btnScanCard">📷 QR 카드로 로그인</button>
        <div id="panelError" class="panel-error">${esc(message || '')}</div>`);
    }
    const scanBtn = $('btnScanCard');
    if (scanBtn) scanBtn.addEventListener('click', () => startScan('card'));
    const form = $('loginForm');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); emailLogin(); });
  }

  function loginForm() {
    return `<form id="loginForm" class="panel-form" autocomplete="off">
      <input type="email" id="loginEmail" placeholder="액자 계정 이메일" autocapitalize="none" required>
      <input type="password" id="loginPass" placeholder="비밀번호" required>
      <button type="submit" class="panel-btn panel-btn-main">로그인</button>
    </form>`;
  }

  function describeAuthError(e) {
    const code = e && e.code ? e.code : '';
    const map = {
      'auth/wrong-password': '비밀번호가 틀렸습니다.',
      'auth/user-not-found': '등록되지 않은 계정입니다.',
      'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
      'auth/too-many-requests': '시도가 너무 많습니다. 잠시 후 다시 시도하세요.',
      'auth/network-request-failed': '네트워크 오류입니다. Wi-Fi를 확인하세요.',
      'auth/operation-not-allowed': 'Firebase 콘솔에서 이메일/비밀번호 로그인을 켜야 합니다.',
      'auth/user-disabled': '사용 중지된 계정입니다.'
    };
    return map[code] || `로그인 실패 (${code || '알 수 없는 오류'})`;
  }

  async function emailLogin(email, pass) {
    const e = email || String(($('loginEmail') || {}).value || '').trim();
    const p = pass || String(($('loginPass') || {}).value || '');
    if (!e || !p) { panelError('이메일과 비밀번호를 입력하세요.'); return false; }
    try {
      await S.auth.signInWithEmailAndPassword(e, p);
      return true;
    } catch (err) {
      console.warn('[Frame] 로그인 실패', err);
      panelError(describeAuthError(err));
      return false;
    }
  }

  function showWaiting(name) {
    showPanel(`
      <div class="panel-title">⏳ 승인 대기</div>
      <p class="panel-sub">GOGO 앱 → 가족 액자 → 액자 기기에서<br><b>${esc(name)}</b> 을(를) 승인하세요.</p>
      <p class="panel-sub">승인되면 자동으로 다음 단계로 넘어갑니다.</p>
      <div id="panelError" class="panel-error"></div>
      <button type="button" class="panel-btn" id="btnLogout">다른 계정으로 로그인</button>`);
    $('btnLogout').addEventListener('click', () => S.auth.signOut().catch(() => {}));
  }

  function showRequest() {
    showPanel(`
      <div class="panel-title">📺 액자 기기 등록</div>
      <p class="panel-sub">이 기기의 이름을 정하고 등록을 요청하세요.</p>
      <form id="reqForm" class="panel-form">
        <input type="text" id="reqName" maxlength="40" value="${esc(defaultDeviceName())}" required>
        <button type="submit" class="panel-btn panel-btn-main">등록 요청</button>
      </form>
      <div id="panelError" class="panel-error"></div>
      <button type="button" class="panel-btn" id="btnLogout">다른 계정으로 로그인</button>`);
    $('reqForm').addEventListener('submit', (e) => { e.preventDefault(); requestRegistration(); });
    $('btnLogout').addEventListener('click', () => S.auth.signOut().catch(() => {}));
  }

  function showKeyEntry(message) {
    showPanel(`
      <div class="panel-title">🔑 액자 키 등록</div>
      <p class="panel-sub">QR 카드(또는 진세 폰의 키 QR)를 전면 카메라에 대세요.</p>
      <button type="button" class="panel-btn panel-btn-main" id="btnScanKey">📷 QR 스캔</button>
      <textarea id="keyText" rows="3" placeholder="또는 키 텍스트 붙여넣기"></textarea>
      <button type="button" class="panel-btn" id="btnKeyText">등록</button>
      <div id="panelError" class="panel-error">${esc(message || '')}</div>`);
    $('btnScanKey').addEventListener('click', () => startScan('key'));
    $('btnKeyText').addEventListener('click', async () => {
      try {
        await applyPayload(String(($('keyText') || {}).value || ''), 'key');
      } catch (e) {
        panelError(e.message);
      }
    });
  }

  /* ══════════ QR 스캔 (전면 카메라) ══════════ */
  async function startScan(mode) {
    stopScan();
    const video = $('scanVideo');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      panelError('이 브라우저는 카메라를 지원하지 않습니다.');
      return;
    }
    try {
      const jsQR = await loadScript(JSQR_LIB, 'jsQR');
      S.scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = S.scanStream;
      video.style.display = 'block';
      await video.play();
      panelError('카드를 화면 위 카메라 앞에 대세요...');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const started = Date.now();
      const tick = async () => {
        if (!S.scanStream) return;
        if (Date.now() - started > 120000) {
          stopScan();
          panelError('시간이 지났습니다. 다시 눌러 주세요.');
          return;
        }
        if (video.readyState >= 2 && video.videoWidth > 0) {
          const w = Math.min(640, video.videoWidth);
          const h = Math.round(video.videoHeight * (w / video.videoWidth));
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
          if (code && code.data) {
            stopScan();
            try {
              await applyPayload(code.data, mode);
            } catch (e) {
              panelError(e.message);
            }
            return;
          }
        }
        S.scanTimer = setTimeout(tick, 250);
      };
      tick();
    } catch (e) {
      stopScan();
      console.warn('[Frame] 스캔 실패', e);
      panelError(e && e.name === 'NotAllowedError' ? '카메라 권한을 허용해 주세요.' : (e.message || '카메라를 열지 못했습니다.'));
    }
  }

  function stopScan() {
    clearTimeout(S.scanTimer);
    S.scanTimer = null;
    if (S.scanStream) {
      S.scanStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* 무시 */ } });
      S.scanStream = null;
    }
    const v = $('scanVideo');
    if (v) { v.style.display = 'none'; v.srcObject = null; }
  }

  /* QR 카드: { t:'gogo-frame-card', v:1, fid, e, p, keyId, k } / 키 QR: { t:'gogo-frame-key', v:1, fid, keyId, k } */
  async function applyPayload(text, mode) {
    let obj = null;
    try {
      obj = JSON.parse(String(text || '').trim());
    } catch (e) {
      throw new Error('GOGO 액자 QR이 아닙니다.');
    }
    if (!obj || obj.fid !== CFG.familyId || (obj.t !== 'gogo-frame-card' && obj.t !== 'gogo-frame-key')) {
      throw new Error('이 가족의 액자 QR이 아닙니다.');
    }
    if (typeof obj.k !== 'string' || typeof obj.keyId !== 'string') throw new Error('QR에 키가 없습니다.');
    const raw = bytesFromB64url(obj.k);
    if (raw.length !== 32) throw new Error('키 길이가 올바르지 않습니다.');
    const check = await sha256Hex16(raw);
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
    raw.fill(0);
    await idbPut(STORE_KEYS, KEY_RECORD, { fid: CFG.familyId, keyId: obj.keyId, check, key, exportable: false, savedAt: Date.now() });
    await loadKey();

    if (obj.t === 'gogo-frame-card' && obj.e && obj.p && (!S.user || mode === 'card')) {
      panelError('로그인 중...');
      if (S.user && S.user.email !== obj.e) await S.auth.signOut().catch(() => {});
      if (!S.user || S.user.email !== obj.e) {
        await emailLogin(String(obj.e), String(obj.p));
        return;
      }
    }
    await proceed();
  }

  /* ══════════ 인증 · 등록 ══════════ */
  async function requestRegistration() {
    const name = String(($('reqName') || {}).value || '').trim().slice(0, 40) || defaultDeviceName();
    try {
      await S.db.ref(CFG.path(`pending/${S.user.uid}`)).set({ name, requestedAt: Date.now() });
      showWaiting(name);
    } catch (e) {
      console.warn('[Frame] 등록 요청 실패', e);
      panelError('등록 요청 실패: 네트워크 또는 권한을 확인하세요.');
    }
  }

  function watchViewer(uid) {
    if (S.viewerRef) S.viewerRef.off('value');
    S.viewerRef = S.db.ref(CFG.path(`viewers/${uid}`));
    S.viewerRef.on('value', async (snap) => {
      const v = snap.val();
      if (v && v.deviceId) {
        if (S.deviceId !== v.deviceId) {
          S.deviceId = v.deviceId;
          lsSet(LS_DEVICE, v.deviceId);
        }
        await proceed();
        return;
      }
      if (S.deviceId) {
        S.deviceId = '';
        lsSet(LS_DEVICE, '');
        S.readyForSlides = false;
        detachData();
        showPanel('<div class="panel-title">⛔ 등록 해제됨</div><p class="panel-sub">GOGO 앱에서 이 기기의 등록이 해제되었습니다.</p>');
        return;
      }
      try {
        const p = await S.db.ref(CFG.path(`pending/${uid}`)).once('value');
        if (p.exists()) showWaiting((p.val() || {}).name || defaultDeviceName());
        else showRequest();
      } catch (e) {
        showRequest();
      }
    }, (err) => {
      console.warn('[Frame] 승인 상태 읽기 실패', err);
      showLogin('권한 확인 실패. 다시 로그인하세요.');
    });
  }

  async function onAuth(user) {
    S.user = user || null;
    if (!user) {
      S.readyForSlides = false;
      detachData();
      if (S.viewerRef) { S.viewerRef.off('value'); S.viewerRef = null; }
      showLogin('');
      return;
    }
    S.everSignedIn = true;
    showPanel('<div class="panel-msg">🔐 기기 확인 중...</div>');
    watchViewer(user.uid);
  }

  async function proceed() {
    if (!S.user || !S.deviceId) return;
    if (!S.key) await loadKey();
    attachData();
    if (!S.settings) return;
    if (!S.key || S.key.check !== S.settings.keyCheck) {
      showKeyEntry(S.key ? '저장된 키가 서버 키와 다릅니다. 새 QR을 대세요.' : '');
      return;
    }
    S.readyForSlides = true;
    hidePanel();
    startSlidesIfReady();
  }

  /* ══════════ 데이터 리스너 (각 1개) ══════════ */
  function attachData() {
    if (S.listeners.length) return;
    const on = (path, cb) => {
      const r = S.db.ref(path);
      r.on('value', cb, (err) => console.warn(`[Frame] ${path} 읽기 실패`, err));
      S.listeners.push(r);
    };
    on(CFG.path('settings'), (snap) => {
      S.settings = snap.val() || {};
      const text = String(S.settings.offlineText || '').trim();
      lsSet(LS_OFFLINE_TEXT, text || CFG.defaultOfflineText);
      proceed();
    });
    on(CFG.path(`devices/${S.deviceId}`), (snap) => {
      S.device = snap.val() || null;
      applyDeviceSettings();
    });
    on(CFG.path('index'), (snap) => {
      S.index = snap.val() || {};
      rebuildOrder();
      syncCache();
      if (S.readyForSlides && !S.slideTimer && S.order.length) startSlidesIfReady();
    });
    on('.info/connected', (snap) => {
      S.online = snap.val() === true;
      updateClock();
    });
  }

  function detachData() {
    S.listeners.forEach((r) => { try { r.off('value'); } catch (e) { /* 무시 */ } });
    S.listeners = [];
    S.settings = null;
    S.device = null;
  }

  /* ══════════ 사진 캐시 ══════════ */
  function rebuildOrder() {
    const ids = Object.keys(S.index || {}).filter((id) => PHOTO_RE.test(id)).sort().reverse();
    const prevId = S.order[S.cursor];
    S.order = ids;
    const keep = prevId ? ids.indexOf(prevId) : -1;
    S.cursor = keep >= 0 ? keep : 0;
  }

  async function syncCache() {
    if (S.syncing) return;
    S.syncing = true;
    try {
      const cached = new Set((await idbKeys(STORE_BLOBS)).map(String));
      const wanted = new Set(S.order);
      for (const id of cached) {
        if (!wanted.has(id)) await idbDel(STORE_BLOBS, id).catch(() => {});
      }
      for (const id of S.order) {
        if (cached.has(id)) continue;
        try {
          const snap = await S.db.ref(CFG.path(`blobs/${id}`)).once('value');
          const v = snap.val();
          if (v && v.iv && v.ct) await idbPut(STORE_BLOBS, id, { iv: v.iv, ct: v.ct, keyId: v.keyId });
        } catch (e) {
          console.warn('[Frame] 사진 수신 실패', id, e);
        }
      }
    } catch (e) {
      console.warn('[Frame] 캐시 동기화 실패', e);
    } finally {
      S.syncing = false;
    }
  }

  async function getBlobRecord(id) {
    let rec = null;
    try { rec = await idbGet(STORE_BLOBS, id); } catch (e) { rec = null; }
    if (rec) return rec;
    if (!S.db || !S.online) return null;
    const snap = await S.db.ref(CFG.path(`blobs/${id}`)).once('value');
    const v = snap.val();
    if (!v || !v.iv || !v.ct) return null;
    idbPut(STORE_BLOBS, id, { iv: v.iv, ct: v.ct, keyId: v.keyId }).catch(() => {});
    return v;
  }

  async function decryptToUrl(id) {
    const rec = await getBlobRecord(id);
    if (!rec) throw new Error('사진 없음');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesFromB64url(rec.iv) }, S.key.key, bytesFromB64url(rec.ct));
    const url = URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }));
    S.urls.push(url);
    return url;
  }

  /* ══════════ 배치 계산 ══════════ */
  function screenSize() {
    return { W: Math.max(1, window.innerWidth), H: Math.max(1, window.innerHeight) };
  }

  function singleArea(meta, W, H) {
    const s = Math.min(W / meta.w, H / meta.h);
    return meta.w * meta.h * s * s;
  }

  function pairArea(a, b, W, H) {
    const usable = W * (1 - PAIR_GAP_RATIO);
    const ratioSum = a.w / a.h + b.w / b.h;
    const h = Math.min(H, usable / ratioSum);
    return h * h * ratioSum;
  }

  function nextSlide() {
    if (!S.order.length) return null;
    if (S.cursor >= S.order.length) S.cursor = 0;
    const id1 = S.order[S.cursor];
    const m1 = S.index[id1] || {};
    const { W, H } = screenSize();
    if (m1.orient === 'p' && S.order.length > 1) {
      const id2 = S.order[(S.cursor + 1) % S.order.length];
      const m2 = S.index[id2] || {};
      if (id2 !== id1 && m2.orient === 'p' && m1.w && m1.h && m2.w && m2.h
        && pairArea(m1, m2, W, H) > singleArea(m1, W, H) * PAIR_GAIN) {
        S.cursor = (S.cursor + 2) % S.order.length;
        return { ids: [id1, id2], sec: CFG.pairSlideSec };
      }
    }
    S.cursor = (S.cursor + 1) % S.order.length;
    return { ids: [id1], sec: CFG.singleSlideSec };
  }

  /* ══════════ 슬라이드 ══════════ */
  async function buildLayer(el, slide) {
    const urls = [];
    for (const id of slide.ids) urls.push(await decryptToUrl(id));
    const html = slide.ids.length === 2
      ? `<div class="pair">${urls.map((u) => `<img src="${u}" alt="">`).join('')}</div>`
      : `<div class="bg" style="background-image:url('${urls[0]}')"></div><img class="single" src="${urls[0]}" alt="">`;
    el.innerHTML = html;
    await Promise.all(Array.from(el.querySelectorAll('img')).map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
    return urls;
  }

  async function showNext() {
    clearTimeout(S.slideTimer);
    S.slideTimer = null;
    if (!S.readyForSlides || S.night) return;
    const slide = nextSlide();
    if (!slide) {
      showPanel('<div class="panel-title">🖼️ 사진 대기 중</div><p class="panel-sub">GOGO 앱에서 사진을 올리면 여기에 표시됩니다.</p>');
      S.readyForSlides = true;
      return;
    }
    hidePanel();
    const nextEl = S.activeLayer === 'A' ? $('layerB') : $('layerA');
    const curEl = S.activeLayer === 'A' ? $('layerA') : $('layerB');
    let urls = [];
    try {
      urls = await buildLayer(nextEl, slide);
    } catch (e) {
      console.warn('[Frame] 슬라이드 준비 실패', slide.ids, e);
      S.slideTimer = setTimeout(showNext, 3000);
      return;
    }
    nextEl.classList.add('show');
    curEl.classList.remove('show');
    S.activeLayer = S.activeLayer === 'A' ? 'B' : 'A';
    const oldUrls = S.urls.filter((u) => urls.indexOf(u) === -1);
    setTimeout(() => {
      curEl.innerHTML = '';
      oldUrls.forEach((u) => URL.revokeObjectURL(u));
      S.urls = S.urls.filter((u) => oldUrls.indexOf(u) === -1);
    }, CFG.fadeMs + 200);
    S.slideTimer = setTimeout(showNext, slide.sec * 1000);
  }

  function startSlidesIfReady() {
    if (!S.readyForSlides || S.slideTimer || S.night) return;
    showNext();
  }

  function stopSlides() {
    clearTimeout(S.slideTimer);
    S.slideTimer = null;
  }

  /* ══════════ 시계 · 야간 · 번인 · 화면 유지 · 하트비트 ══════════ */
  function minutesOf(hm, fallback) {
    const v = TIME_RE.test(String(hm || '')) ? hm : fallback;
    const [h, m] = v.split(':').map(Number);
    return h * 60 + m;
  }

  function isNightNow() {
    const d = S.device || {};
    const start = minutesOf(d.nightStart, CFG.defaultNightStart);
    const end = minutesOf(d.nightEnd, CFG.defaultNightEnd);
    if (start === end) return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
  }

  function updateClock() {
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const h = now.getHours();
    $('infoDate').textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
    $('infoTime').textContent = `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${String(now.getMinutes()).padStart(2, '0')}`;
    $('infoNet').textContent = S.online ? '' : '오프라인';

    const night = isNightNow();
    if (night !== S.night) {
      S.night = night;
      document.body.classList.toggle('is-night', night);
      if (night) stopSlides();
      else startSlidesIfReady();
    }
  }

  function applyDeviceSettings() {
    const d = S.device || {};
    $('infoBar').style.display = d.infoBar === false ? 'none' : 'flex';
    updateClock();
  }

  function shiftBurnIn() {
    const pattern = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
    S.shiftStep = (S.shiftStep + 1) % pattern.length;
    const [x, y] = pattern[S.shiftStep];
    document.documentElement.style.setProperty('--shift-x', `${x * CFG.burnInShiftPx}px`);
    document.documentElement.style.setProperty('--shift-y', `${y * CFG.burnInShiftPx}px`);
  }

  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !S.wakeLock) {
        S.wakeLock = await navigator.wakeLock.request('screen');
        S.wakeLock.addEventListener('release', () => { S.wakeLock = null; });
      }
    } catch (e) {
      console.warn('[Frame] 화면 켜짐 유지 실패 (자동 잠금 \'안 함\' 설정 필요)', e);
    }
  }

  async function heartbeat() {
    if (!S.db || !S.user || !S.deviceId) return;
    try {
      await S.db.ref(CFG.path(`heartbeat/${S.deviceId}`)).set({
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
        appVersion: APP_VERSION
      });
    } catch (e) {
      console.warn('[Frame] 하트비트 실패', e);
    }
  }

  function startTimers() {
    updateClock();
    S.clockTimer = setInterval(updateClock, 20000);
    S.shiftTimer = setInterval(shiftBurnIn, CFG.burnInShiftSec * 1000);
    S.beatTimer = setInterval(heartbeat, CFG.heartbeatMin * 60000);
    setTimeout(heartbeat, 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        keepAwake();
        heartbeat();
        try { if (S.db) S.db.goOnline(); } catch (e) { /* 무시 */ }
      }
    });
    window.addEventListener('online', () => { try { if (S.db) S.db.goOnline(); } catch (e) { /* 무시 */ } });
    keepAwake();
  }

  /* ══════════ 시작 ══════════ */
  function boot() {
    if (!CFG) {
      showPanel('<div class="panel-title">⚠️ 설정 파일 오류</div><p class="panel-sub">frame-config.js를 불러오지 못했습니다.</p>');
      return;
    }
    if (!window.crypto || !crypto.subtle) {
      showPanel('<div class="panel-title">⚠️ 지원하지 않는 브라우저</div><p class="panel-sub">https 주소로 접속하세요.</p>');
      return;
    }
    if (typeof firebase === 'undefined' || !firebase.auth || !firebase.database) {
      showPanel(`<div class="panel-big">${esc(lsGet(LS_OFFLINE_TEXT) || CFG.defaultOfflineText)}</div>
        <p class="panel-sub">서버 모듈을 불러오지 못했습니다. 1분 후 자동으로 다시 시도합니다.</p>`);
      setTimeout(() => window.location.reload(), 60000);
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      S.auth = firebase.auth();
      S.db = firebase.database();
    } catch (e) {
      console.error('[Frame] Firebase 초기화 실패', e);
      showPanel('<div class="panel-title">⚠️ 서버 초기화 실패</div>');
      return;
    }
    S.deviceId = lsGet(LS_DEVICE);
    S.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch((e) => console.warn('[Frame] 세션 유지 설정 실패', e));
    S.auth.onAuthStateChanged((u) => { onAuth(u).catch((e) => console.error('[Frame] 인증 처리 오류', e)); });
    startTimers();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.addEventListener('load', boot);
})();
