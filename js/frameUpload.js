/**
 * GOGO 스마트 매니저 - 디지털 액자 관리 (js/frameUpload.js)
 * - 사진 업로드: EXIF 회전 반영 → 긴 변 1600px → JPEG 재압축(EXIF 제거) → AES-GCM 암호화 → /frame/{fid}
 * - 암호화 키: 진세 폰에서 1회 생성(내보내기 가능) → QR/텍스트로 지혜 폰에 등록(내보내기 불가)
 * - 액자 기기: 등록 요청(pending) 승인, 기기별 설정(장소·야간·정보 줄·감시·QR 카드), 연결 상태 표시
 * - 리스너: 액자 화면 첫 진입 시 1회만 부착 (단일 인스턴스), 사진 본체(blobs)는 구독하지 않음
 */
window.App = window.App || {};

App.frameAdmin = (function () {
  'use strict';

  const CFG = window.FRAME_CONFIG;
  const IDB_NAME = 'gogo-frame';
  const IDB_STORE = 'keys';
  const KEY_RECORD = 'current';
  const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  const JSQR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  const LIST_LIMIT = 30;
  const UID_RE = /^[A-Za-z0-9_-]{6,128}$/;
  const DEV_RE = /^dev_[a-z0-9]{8}$/;
  const PHOTO_RE = /^[0-9]{16}$/;
  const TIME_RE = /^[0-2][0-9]:[0-5][0-9]$/;

  const state = {
    attached: false,
    refs: [],
    index: {},
    settings: null,
    devices: {},
    viewers: {},
    pending: {},
    heartbeat: {},
    key: null,
    keyLoaded: false,
    uploading: false,
    progress: '',
    lastStamp: '',
    seq: 0,
    scanStream: null,
    scanTimer: null
  };

  /* ── 공용 ── */
  const esc = (v) => (window.escapeHtml ? window.escapeHtml(v) : String(v == null ? '' : v));
  const toast = (msg) => { try { if (App.ui) App.ui.toast(msg); } catch (e) { console.warn(e); } };
  const db = () => (App.isFirebaseActive && App.db ? App.db : null);
  const ref = (sub) => {
    const d = db();
    if (!d) throw new Error('Firebase 미연결');
    return d.ref(CFG.path(sub));
  };
  const myName = () => {
    const u = App.auth ? App.auth.currentUser : 'public';
    return u === 'jinse' ? '진세' : (u === 'jihye' ? '지혜' : '');
  };
  const isOwner = () => App.auth && App.auth.currentUser === 'jinse';

  function b64urlFromBytes(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

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
      el.onerror = () => reject(new Error(`${src} 로드 실패`));
      document.head.appendChild(el);
    });
  }

  function kstStamp() {
    const k = new Date(Date.now() + 9 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}${p(k.getUTCSeconds())}`;
  }

  function newPhotoId() {
    const stamp = kstStamp();
    if (stamp !== state.lastStamp) {
      state.lastStamp = stamp;
      state.seq = Math.floor(Math.random() * 50);
    }
    for (let i = 0; i < 100; i++) {
      const id = stamp + String(state.seq % 100).padStart(2, '0');
      state.seq += 1;
      if (!state.index[id]) return id;
    }
    throw new Error('사진 id 생성 실패 (1초에 100장 초과)');
  }

  function randomId(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    return Array.from(buf).map((b) => chars[b % chars.length]).join('');
  }

  function photoDateText(id) {
    const s = String(id);
    return `${Number(s.slice(4, 6))}월 ${Number(s.slice(6, 8))}일 ${s.slice(8, 10)}:${s.slice(10, 12)}`;
  }

  /* ── IndexedDB 키 저장소 ── */
  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB 미지원')); return; }
      /* frame.js 와 같은 DB · 같은 버전 (버전 불일치 시 VersionError) */
      const req = indexedDB.open(IDB_NAME, 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 열기 실패'));
    });
  }

  async function idbGet(k) {
    const d = await idbOpen();
    try {
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(IDB_STORE, 'readonly');
        const r = tx.objectStore(IDB_STORE).get(k);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
      });
    } finally {
      d.close();
    }
  }

  async function idbPut(k, v) {
    const d = await idbOpen();
    try {
      await new Promise((resolve, reject) => {
        const tx = d.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(v, k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      d.close();
    }
  }

  async function idbDelete(k) {
    const d = await idbOpen();
    try {
      await new Promise((resolve, reject) => {
        const tx = d.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      d.close();
    }
  }

  async function loadKey() {
    try {
      const rec = await idbGet(KEY_RECORD);
      state.key = rec && rec.fid === CFG.familyId && rec.key ? rec : null;
    } catch (e) {
      console.warn('[Frame] 키 로드 실패', e);
      state.key = null;
    }
    state.keyLoaded = true;
  }

  /* ── 리스너 (최초 1회) ── */
  function attach() {
    if (state.attached || !db()) return;
    state.attached = true;
    const bind = (sub, field) => {
      const r = ref(sub);
      r.on('value', (snap) => {
        state[field] = snap.val() || (field === 'settings' ? null : {});
        render();
      }, (err) => {
        console.warn(`[Frame] ${sub} 읽기 실패`, err);
        toast('⚠️ 액자 데이터를 불러오지 못했습니다.');
      });
      state.refs.push(r);
    };
    bind('index', 'index');
    bind('settings', 'settings');
    bind('devices', 'devices');
    bind('viewers', 'viewers');
    bind('pending', 'pending');
    bind('heartbeat', 'heartbeat');
  }

  /* ── 키 생성·내보내기·가져오기 ── */
  async function createKey() {
    if (!isOwner()) { toast('⚠️ 키 생성은 진세 계정에서만 할 수 있습니다.'); return; }
    if (state.settings && state.settings.keyCheck) { toast('⚠️ 이미 가족 키가 있습니다. QR로 등록하세요.'); return; }
    if (!confirm('액자 암호화 키를 새로 만듭니다.\n만든 직후 OPL 모음에 키를 백업해야 합니다.\n계속할까요?')) return;
    try {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
      const check = await sha256Hex16(raw);
      const keyId = 'k1';
      const res = await ref('settings').transaction((cur) => {
        if (cur && cur.keyCheck) return undefined;
        return Object.assign({ offlineText: CFG.defaultOfflineText, showWeather: false }, cur || {}, { keyId, keyCheck: check });
      });
      if (!res.committed) { toast('⚠️ 다른 기기에서 먼저 키를 만들었습니다. QR로 등록하세요.'); return; }
      await idbPut(KEY_RECORD, { fid: CFG.familyId, keyId, check, key, exportable: true, savedAt: Date.now() });
      await loadKey();
      toast('🔑 키를 만들었습니다. 바로 백업하세요.');
      render();
      showKeyQr(true);
    } catch (e) {
      console.error('[Frame] 키 생성 실패', e);
      toast('⚠️ 키 생성 실패: ' + (e && e.message ? e.message : '알 수 없는 오류'));
    }
  }

  async function keyPayload() {
    if (!state.key || !state.key.exportable) throw new Error('이 기기의 키는 내보낼 수 없습니다.');
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', state.key.key));
    return JSON.stringify({ t: 'gogo-frame-key', v: 1, fid: CFG.familyId, keyId: state.key.keyId, k: b64urlFromBytes(raw) });
  }

  async function showKeyQr(skipConfirm) {
    if (!skipConfirm && !confirm('⚠️ 키 QR을 화면에 표시합니다.\n이 키가 있으면 액자 사진을 풀 수 있습니다.\n주변에 다른 사람이 없을 때만 여세요.')) return;
    let payload = '';
    try {
      payload = await keyPayload();
    } catch (e) {
      toast('⚠️ ' + e.message);
      return;
    }
    const body = document.getElementById('frameModalBody');
    if (!body) return;
    body.innerHTML = `
      <h3>🔑 액자 암호화 키</h3>
      <p class="frame-note">지혜 폰 GOGO 앱 → 가족 액자 → <b>키 등록</b>에서 스캔하거나, 아래 텍스트를 복사해 붙여넣으세요.<br>OPL 모음에도 텍스트를 백업하세요.</p>
      <div id="frameQrBox" class="frame-qr-box">QR 생성 중...</div>
      <textarea class="memo-text-input frame-key-text" readonly rows="4">${esc(payload)}</textarea>
      <div class="frame-btn-row">
        <button type="button" class="btn-save" onclick="App.frameAdmin.copyKey()">📋 텍스트 복사</button>
        <button type="button" class="btn-prof" onclick="App.frameAdmin.closeModal()">닫기</button>
      </div>`;
    openModal();
    try {
      const qrcode = await loadScript(QR_LIB, 'qrcode');
      const qr = qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      const box = document.getElementById('frameQrBox');
      if (box) box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) {
      const box = document.getElementById('frameQrBox');
      if (box) box.textContent = 'QR을 만들지 못했습니다. 텍스트 복사를 사용하세요.';
    }
  }

  async function copyKey() {
    try {
      const payload = await keyPayload();
      await navigator.clipboard.writeText(payload);
      toast('📋 키를 복사했습니다. 붙여넣은 뒤 클립보드를 비우세요.');
    } catch (e) {
      toast('⚠️ 복사 실패 — 텍스트를 길게 눌러 복사하세요.');
    }
  }

  async function importKeyFromText(text) {
    let obj = null;
    try {
      obj = JSON.parse(String(text || '').trim());
    } catch (e) {
      throw new Error('키 형식이 아닙니다.');
    }
    if (!obj || obj.t !== 'gogo-frame-key' || obj.fid !== CFG.familyId || typeof obj.k !== 'string' || typeof obj.keyId !== 'string') {
      throw new Error('이 가족의 액자 키가 아닙니다.');
    }
    const raw = bytesFromB64url(obj.k);
    if (raw.length !== 32) throw new Error('키 길이가 올바르지 않습니다.');
    const check = await sha256Hex16(raw);
    if (!state.settings || state.settings.keyCheck !== check || state.settings.keyId !== obj.keyId) {
      throw new Error('서버에 등록된 키와 다릅니다. 최신 키 QR을 다시 받으세요.');
    }
    const exportable = isOwner();
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, exportable, ['encrypt', 'decrypt']);
    raw.fill(0);
    await idbPut(KEY_RECORD, { fid: CFG.familyId, keyId: obj.keyId, check, key, exportable, savedAt: Date.now() });
    await loadKey();
  }

  function openImport() {
    const body = document.getElementById('frameModalBody');
    if (!body) return;
    body.innerHTML = `
      <h3>🔑 액자 키 등록</h3>
      <p class="frame-note">진세 폰의 <b>키 QR 보기</b> 화면을 스캔하거나, 키 텍스트를 붙여넣으세요.</p>
      <div class="frame-btn-row">
        <button type="button" class="btn-save" onclick="App.frameAdmin.startScan()">📷 QR 스캔</button>
      </div>
      <div id="frameScanBox" class="frame-scan-box" style="display:none;">
        <video id="frameScanVideo" playsinline muted></video>
        <p class="frame-note">QR을 화면 가운데에 맞추세요.</p>
      </div>
      <textarea id="frameKeyInput" class="memo-text-input frame-key-text" rows="4" placeholder='{"t":"gogo-frame-key",...}'></textarea>
      <div class="frame-btn-row">
        <button type="button" class="btn-save" onclick="App.frameAdmin.submitImport()">등록</button>
        <button type="button" class="btn-prof" onclick="App.frameAdmin.closeModal()">취소</button>
      </div>`;
    openModal();
  }

  async function submitImport() {
    const el = document.getElementById('frameKeyInput');
    const text = el ? el.value : '';
    try {
      await importKeyFromText(text);
      if (el) el.value = '';
      closeModal();
      toast('🔑 키를 등록했습니다.');
      render();
    } catch (e) {
      toast('⚠️ ' + (e && e.message ? e.message : '키 등록 실패'));
    }
  }

  async function startScan() {
    const box = document.getElementById('frameScanBox');
    const video = document.getElementById('frameScanVideo');
    if (!box || !video) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('⚠️ 이 브라우저는 카메라를 지원하지 않습니다. 텍스트를 붙여넣으세요.');
      return;
    }
    stopScan();
    try {
      const jsQR = await loadScript(JSQR_LIB, 'jsQR');
      state.scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = state.scanStream;
      box.style.display = 'block';
      await video.play();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (!state.scanStream) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          const w = Math.min(640, video.videoWidth);
          const h = Math.round(video.videoHeight * (w / video.videoWidth));
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
          if (code && code.data) {
            stopScan();
            const input = document.getElementById('frameKeyInput');
            if (input) input.value = code.data;
            await submitImport();
            return;
          }
        }
        state.scanTimer = setTimeout(tick, 250);
      };
      tick();
    } catch (e) {
      stopScan();
      console.warn('[Frame] 스캔 실패', e);
      toast('⚠️ 카메라를 열지 못했습니다. 텍스트를 붙여넣으세요.');
    }
  }

  function stopScan() {
    clearTimeout(state.scanTimer);
    state.scanTimer = null;
    if (state.scanStream) {
      state.scanStream.getTracks().forEach((t) => { try { t.stop(); } catch (e) { /* 무시 */ } });
      state.scanStream = null;
    }
    const box = document.getElementById('frameScanBox');
    if (box) box.style.display = 'none';
  }

  async function forgetKey() {
    if (!confirm('이 기기에 저장된 액자 키를 지웁니다.\n(서버 사진은 그대로이며, 키 QR로 다시 등록할 수 있습니다)\n계속할까요?')) return;
    try {
      await idbDelete(KEY_RECORD);
      await loadKey();
      toast('🧹 이 기기의 키를 지웠습니다.');
      render();
    } catch (e) {
      toast('⚠️ 키 삭제 실패');
    }
  }

  /* ── 사진 처리 ── */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      const done = (err) => {
        if (err) { URL.revokeObjectURL(url); reject(err); return; }
        resolve({ img, release: () => URL.revokeObjectURL(url) });
      };
      img.onload = () => done(null);
      img.onerror = () => done(new Error('이미지를 열 수 없습니다 (지원하지 않는 형식)'));
      img.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 변환 실패'))), 'image/jpeg', quality);
    });
  }

  /* 브라우저가 EXIF 회전을 반영해 그린 뒤 다시 인코딩 → EXIF(GPS 포함) 제거 */
  async function encodePhoto(file) {
    const { img, release } = await loadImage(file);
    try {
      const sw = img.naturalWidth;
      const sh = img.naturalHeight;
      if (!sw || !sh) throw new Error('이미지 크기를 읽지 못했습니다.');
      const scale = Math.min(1, CFG.longEdgePx / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      const qualities = [CFG.jpegQuality, 0.7, 0.6];
      for (let i = 0; i < qualities.length; i++) {
        const blob = await canvasToBlob(canvas, qualities[i]);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const estimated = Math.ceil((bytes.length + 16) / 3) * 4;
        if (estimated <= CFG.maxCipherChars || i === qualities.length - 1) {
          canvas.width = 0;
          canvas.height = 0;
          return { bytes, w, h, orient: h > w ? 'p' : 'l' };
        }
      }
      throw new Error('사진 용량을 줄이지 못했습니다.');
    } finally {
      release();
    }
  }

  async function encryptBytes(bytes) {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, state.key.key, bytes));
    return { iv: b64urlFromBytes(iv), ct: b64urlFromBytes(ct) };
  }

  async function uploadFiles(fileList) {
    if (state.uploading) return;
    if (!state.key) { toast('⚠️ 먼저 액자 키를 만들거나 등록하세요.'); return; }
    const by = myName();
    if (!by) { toast('⚠️ 가족 계정으로 로그인해야 합니다.'); return; }
    const files = Array.from(fileList || []).filter((f) => f && /^image\//.test(f.type || 'image/'));
    if (!files.length) return;
    if (files.length > CFG.maxUploadBatch) toast(`ℹ️ 한 번에 ${CFG.maxUploadBatch}장까지만 올립니다.`);
    const batch = files.slice(0, CFG.maxUploadBatch);

    state.uploading = true;
    let ok = 0;
    let fail = 0;
    try {
      for (let i = 0; i < batch.length; i++) {
        state.progress = `${i + 1} / ${batch.length} 처리 중...`;
        renderProgress();
        try {
          const enc = await encodePhoto(batch[i]);
          const sealed = await encryptBytes(enc.bytes);
          if (sealed.ct.length > CFG.maxCipherChars) throw new Error('암호문이 1MB를 넘습니다.');
          const id = newPhotoId();
          const updates = {};
          updates[CFG.path(`blobs/${id}`)] = { iv: sealed.iv, ct: sealed.ct, keyId: state.key.keyId };
          updates[CFG.path(`index/${id}`)] = {
            createdAt: Number(id), bytes: enc.bytes.length, keyId: state.key.keyId,
            orient: enc.orient, w: enc.w, h: enc.h, by
          };
          await db().ref().update(updates);
          state.index[id] = updates[CFG.path(`index/${id}`)];
          ok += 1;
        } catch (e) {
          fail += 1;
          console.warn('[Frame] 사진 업로드 실패', e);
        }
      }
      await enforceLimit();
    } finally {
      state.uploading = false;
      state.progress = '';
      const input = document.getElementById('framePhotoInput');
      if (input) input.value = '';
      render();
      toast(fail ? `🖼️ ${ok}장 업로드 · ⚠️ ${fail}장 실패` : `🖼️ ${ok}장 업로드 완료`);
    }
  }

  async function enforceLimit() {
    const ids = Object.keys(state.index || {}).filter((id) => PHOTO_RE.test(id)).sort();
    const over = ids.length - CFG.maxPhotos;
    if (over <= 0) return;
    const updates = {};
    ids.slice(0, over).forEach((id) => {
      updates[CFG.path(`index/${id}`)] = null;
      updates[CFG.path(`blobs/${id}`)] = null;
    });
    try {
      await db().ref().update(updates);
      toast(`🧹 오래된 사진 ${over}장을 정리했습니다 (최대 ${CFG.maxPhotos}장).`);
    } catch (e) {
      console.warn('[Frame] 오래된 사진 정리 실패', e);
    }
  }

  async function deletePhoto(id) {
    if (!PHOTO_RE.test(String(id))) return;
    if (!confirm(`${photoDateText(id)} 사진을 액자에서 삭제할까요?`)) return;
    const updates = {};
    updates[CFG.path(`index/${id}`)] = null;
    updates[CFG.path(`blobs/${id}`)] = null;
    try {
      await db().ref().update(updates);
      toast('🗑️ 삭제했습니다.');
    } catch (e) {
      toast('⚠️ 삭제 실패');
    }
  }

  async function previewPhoto(id) {
    if (!PHOTO_RE.test(String(id))) return;
    if (!state.key) { toast('⚠️ 키가 없어 미리 볼 수 없습니다.'); return; }
    const body = document.getElementById('frameModalBody');
    if (!body) return;
    body.innerHTML = `<h3>🖼️ ${esc(photoDateText(id))}</h3><div class="frame-preview">불러오는 중...</div>
      <div class="frame-btn-row"><button type="button" class="btn-prof" onclick="App.frameAdmin.closeModal()">닫기</button></div>`;
    openModal();
    try {
      const snap = await ref(`blobs/${id}`).once('value');
      const v = snap.val();
      if (!v || !v.iv || !v.ct) throw new Error('사진 데이터 없음');
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytesFromB64url(v.iv) }, state.key.key, bytesFromB64url(v.ct));
      const url = URL.createObjectURL(new Blob([plain], { type: 'image/jpeg' }));
      const box = body.querySelector('.frame-preview');
      if (box) {
        box.innerHTML = '';
        const img = new Image();
        img.alt = '액자 사진';
        img.onload = () => URL.revokeObjectURL(url);
        img.src = url;
        box.appendChild(img);
      }
    } catch (e) {
      const box = body.querySelector('.frame-preview');
      if (box) box.textContent = '⚠️ 복호화 실패 (키가 다르거나 데이터 손상)';
    }
  }

  /* ── 기기 관리 ── */
  async function approveDevice(uid) {
    if (!UID_RE.test(String(uid))) return;
    const req = state.pending[uid] || {};
    const name = String(req.name || '액자 기기').slice(0, 40);
    if (!confirm(`'${name}' 기기를 액자로 승인할까요?\n승인하면 이 기기에서 가족 액자 사진을 볼 수 있습니다.`)) return;
    const deviceId = `dev_${randomId(8)}`;
    const updates = {};
    updates[CFG.path(`viewers/${uid}`)] = { deviceId, approvedAt: Date.now(), approvedBy: myName() };
    updates[CFG.path(`devices/${deviceId}`)] = {
      name, placement: '미정', infoBar: true,
      nightStart: CFG.defaultNightStart, nightEnd: CFG.defaultNightEnd, watch: true, qrCard: true
    };
    updates[CFG.path(`pending/${uid}`)] = null;
    try {
      await db().ref().update(updates);
      toast('✅ 승인했습니다. 액자 기기에서 키를 등록하세요.');
    } catch (e) {
      console.warn('[Frame] 승인 실패', e);
      toast('⚠️ 승인 실패');
    }
  }

  async function rejectDevice(uid) {
    if (!UID_RE.test(String(uid))) return;
    if (!confirm('이 등록 요청을 거절할까요?')) return;
    try {
      await ref(`pending/${uid}`).remove();
      toast('🗑️ 요청을 삭제했습니다.');
    } catch (e) {
      toast('⚠️ 삭제 실패');
    }
  }

  function readDeviceForm(deviceId) {
    const get = (f) => document.getElementById(`fd-${f}-${deviceId}`);
    const name = String((get('name') || {}).value || '').trim().slice(0, 40);
    const placement = String((get('placement') || {}).value || '미정');
    const nightStart = String((get('ns') || {}).value || CFG.defaultNightStart);
    const nightEnd = String((get('ne') || {}).value || CFG.defaultNightEnd);
    if (!name) throw new Error('기기 이름을 입력하세요.');
    if (!['미정', '본가', '집'].includes(placement)) throw new Error('장소 값이 올바르지 않습니다.');
    if (!TIME_RE.test(nightStart) || !TIME_RE.test(nightEnd)) throw new Error('야간 시간 형식은 HH:MM 입니다.');
    return {
      name, placement, nightStart, nightEnd,
      infoBar: Boolean((get('info') || {}).checked),
      watch: Boolean((get('watch') || {}).checked),
      qrCard: Boolean((get('qr') || {}).checked)
    };
  }

  async function saveDevice(deviceId) {
    if (!DEV_RE.test(String(deviceId))) return;
    try {
      const data = readDeviceForm(deviceId);
      await ref(`devices/${deviceId}`).set(data);
      toast('💾 기기 설정을 저장했습니다.');
    } catch (e) {
      toast('⚠️ ' + (e && e.message ? e.message : '저장 실패'));
    }
  }

  async function removeDevice(deviceId) {
    if (!DEV_RE.test(String(deviceId))) return;
    const uid = Object.keys(state.viewers || {}).find((u) => (state.viewers[u] || {}).deviceId === deviceId);
    const name = (state.devices[deviceId] || {}).name || deviceId;
    if (!confirm(`'${name}' 기기 등록을 해제할까요?\n해제하면 이 기기에서 사진을 더 볼 수 없습니다.`)) return;
    const updates = {};
    if (uid && UID_RE.test(uid)) updates[CFG.path(`viewers/${uid}`)] = null;
    updates[CFG.path(`devices/${deviceId}`)] = null;
    try {
      await db().ref().update(updates);
      toast('🗑️ 기기 등록을 해제했습니다.');
    } catch (e) {
      toast('⚠️ 해제 실패');
    }
  }

  async function saveOfflineText() {
    const el = document.getElementById('frameOfflineText');
    const text = String(el ? el.value : '').trim().slice(0, 80);
    try {
      await ref('settings').transaction((cur) => Object.assign({ showWeather: false }, cur || {}, { offlineText: text }));
      toast('💾 끊김 문구를 저장했습니다.');
    } catch (e) {
      toast('⚠️ 저장 실패');
    }
  }

  /* ── QR 복구 카드 (액자 계정 + 키) ── */
  function openCard(deviceId) {
    if (!DEV_RE.test(String(deviceId))) return;
    if (!state.key || !state.key.exportable) { toast('⚠️ QR 카드는 키를 만든 진세 폰에서만 만들 수 있습니다.'); return; }
    const name = (state.devices[deviceId] || {}).name || deviceId;
    const body = document.getElementById('frameModalBody');
    if (!body) return;
    body.innerHTML = `
      <h3>🪪 QR 복구 카드 — ${esc(name)}</h3>
      <p class="frame-note">이 기기의 <b>액자 전용 계정</b> 이메일·비밀번호를 입력하세요. 입력값은 저장하지 않고 QR에만 담깁니다.</p>
      <input type="email" id="frameCardEmail" class="memo-text-input" placeholder="frame 계정 이메일" autocapitalize="none">
      <input type="password" id="frameCardPass" class="memo-text-input" placeholder="비밀번호">
      <div class="frame-btn-row">
        <button type="button" class="btn-save" onclick="App.frameAdmin.makeCard('${deviceId}')">카드 만들기</button>
        <button type="button" class="btn-prof" onclick="App.frameAdmin.closeModal()">닫기</button>
      </div>
      <div id="frameCardOut"></div>`;
    openModal();
  }

  async function makeCard(deviceId) {
    if (!DEV_RE.test(String(deviceId))) return;
    const email = String((document.getElementById('frameCardEmail') || {}).value || '').trim();
    const pass = String((document.getElementById('frameCardPass') || {}).value || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || pass.length < 6) { toast('⚠️ 이메일과 비밀번호(6자 이상)를 확인하세요.'); return; }
    if (!confirm('⚠️ 이 QR에는 액자 계정 비밀번호와 사진 암호화 키가 들어갑니다.\n인쇄 후 화면 캡처는 바로 지우고, 카드는 액자 거치대 뒷면에만 보관하세요.\n계속할까요?')) return;
    const out = document.getElementById('frameCardOut');
    try {
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', state.key.key));
      const payload = JSON.stringify({ t: 'gogo-frame-card', v: 1, fid: CFG.familyId, e: email, p: pass, keyId: state.key.keyId, k: b64urlFromBytes(raw) });
      raw.fill(0);
      const qrcode = await loadScript(QR_LIB, 'qrcode');
      const qr = qrcode(0, 'M');
      qr.addData(payload);
      qr.make();
      const name = (state.devices[deviceId] || {}).name || deviceId;
      if (out) {
        out.innerHTML = `<div class="frame-card-print">
          <div class="frame-qr-box">${qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })}</div>
          <div class="frame-card-caption">GOGO 액자 복구 카드 · ${esc(name)}</div>
          <div class="frame-card-caption">액자 화면 [QR 카드 대기] → 이 카드를 화면 위 카메라에</div>
        </div>
        <p class="frame-note">이 화면을 캡처해 명함 크기로 인쇄·라미네이팅하세요. 인쇄 후 캡처 파일은 삭제하세요.</p>`;
      }
      const passEl = document.getElementById('frameCardPass');
      if (passEl) passEl.value = '';
    } catch (e) {
      console.warn('[Frame] 카드 생성 실패', e);
      if (out) out.innerHTML = '<p class="frame-note">⚠️ QR을 만들지 못했습니다 (네트워크 확인).</p>';
    }
  }

  /* ── 모달 ── */
  function openModal() {
    const m = document.getElementById('frame-modal');
    if (m) m.style.display = 'flex';
  }

  function closeModal() {
    stopScan();
    const m = document.getElementById('frame-modal');
    if (m) m.style.display = 'none';
    const body = document.getElementById('frameModalBody');
    if (body) body.innerHTML = '';
  }

  /* ── 렌더링 ── */
  function connText(deviceId) {
    const hb = (state.heartbeat || {})[deviceId];
    const last = hb && Number(hb.lastSeen);
    if (!last) return '<span class="frame-st frame-st-none">⚪ 연결 기록 없음</span>';
    const min = Math.floor((Date.now() - last) / 60000);
    const t = new Date(last);
    const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    if (min <= 10) return `<span class="frame-st frame-st-ok">🟢 연결됨 (${hm})</span>`;
    if (min <= CFG.staleAlertMin) return `<span class="frame-st frame-st-warn">🟠 ${min}분 전 (${hm})</span>`;
    return `<span class="frame-st frame-st-bad">🔴 끊김 ${min}분 (${hm})</span>`;
  }

  function renderKeyCard() {
    const s = state.settings || {};
    if (!state.keyLoaded) return '<div class="card form-card"><div class="empty-msg">키 확인 중...</div></div>';
    if (!s.keyCheck) {
      return `<div class="card form-card">
        <div class="frame-card-title">🔑 암호화 키</div>
        <p class="frame-note">아직 가족 키가 없습니다. ${isOwner() ? '키를 만든 뒤 바로 백업하세요.' : '진세 계정에서 먼저 키를 만들어야 합니다.'}</p>
        ${isOwner() ? '<button type="button" class="btn-save" onclick="App.frameAdmin.createKey()">🔑 가족 키 만들기</button>' : ''}
      </div>`;
    }
    if (!state.key) {
      return `<div class="card form-card">
        <div class="frame-card-title">🔑 암호화 키 <span class="frame-st frame-st-bad">이 기기 미등록</span></div>
        <p class="frame-note">진세 폰의 키 QR을 스캔하거나 키 텍스트를 붙여넣어야 사진을 올릴 수 있습니다.</p>
        <button type="button" class="btn-save" onclick="App.frameAdmin.openImport()">🔑 키 등록</button>
      </div>`;
    }
    const mismatch = state.key.check !== s.keyCheck;
    return `<div class="card form-card">
      <div class="frame-card-title">🔑 암호화 키 ${mismatch ? '<span class="frame-st frame-st-bad">서버 키와 다름</span>' : '<span class="frame-st frame-st-ok">등록됨</span>'}</div>
      <p class="frame-note">키 ${esc(state.key.keyId)} · 확인값 ${esc(state.key.check.slice(0, 8))}</p>
      <div class="frame-btn-row">
        ${state.key.exportable ? '<button type="button" class="btn-prof" onclick="App.frameAdmin.showKeyQr()">📱 키 QR 보기</button>' : ''}
        ${mismatch ? '<button type="button" class="btn-save" onclick="App.frameAdmin.openImport()">🔑 키 다시 등록</button>' : ''}
        <button type="button" class="btn-prof" onclick="App.frameAdmin.forgetKey()">🧹 이 기기 키 지우기</button>
      </div>
    </div>`;
  }

  function renderUploadCard() {
    const ids = Object.keys(state.index || {}).filter((id) => PHOTO_RE.test(id)).sort().reverse();
    const canUpload = Boolean(state.key && state.settings && state.key.check === state.settings.keyCheck);
    const rows = ids.slice(0, LIST_LIMIT).map((id) => {
      const it = state.index[id] || {};
      return `<div class="log-item">
        <div class="log-content" onclick="App.frameAdmin.previewPhoto('${id}')">
          <span class="log-text">${it.orient === 'p' ? '▯ 세로' : '▭ 가로'} · ${esc(photoDateText(id))}</span>
          <span class="log-time">${esc(it.by || '')} · ${Math.round((Number(it.bytes) || 0) / 1024)}KB · 탭하면 미리보기</span>
        </div>
        <button type="button" class="delete-item-btn" onclick="App.frameAdmin.deletePhoto('${id}')" title="삭제">✕</button>
      </div>`;
    }).join('');
    return `<div class="card form-card">
      <div class="frame-card-title">🖼️ 액자 사진 <span class="frame-count">${ids.length} / ${CFG.maxPhotos}장</span></div>
      <p class="frame-note">한 번에 최대 ${CFG.maxUploadBatch}장 · 사진만 가능 · 위치 정보는 자동 제거됩니다.</p>
      <label class="btn-save frame-upload-btn ${canUpload && !state.uploading ? '' : 'frame-disabled'}">
        ${state.uploading ? '⏳ 업로드 중' : '📤 사진 올리기'}
        <input type="file" id="framePhotoInput" accept="image/jpeg,image/png,image/heic,image/heif" multiple
          ${canUpload && !state.uploading ? '' : 'disabled'} onchange="App.frameAdmin.uploadFiles(this.files)">
      </label>
      <div id="frameProgress" class="frame-note">${esc(state.progress)}</div>
      <div class="log-list">${rows || '<div class="empty-msg">아직 올린 사진이 없습니다.</div>'}</div>
      ${ids.length > LIST_LIMIT ? `<p class="frame-note">최근 ${LIST_LIMIT}장만 표시합니다.</p>` : ''}
    </div>`;
  }

  function renderDevicesCard() {
    const pendingRows = Object.keys(state.pending || {}).filter((u) => UID_RE.test(u)).map((uid) => {
      const p = state.pending[uid] || {};
      const t = p.requestedAt ? new Date(Number(p.requestedAt)).toLocaleString('ko-KR') : '';
      return `<div class="log-item frame-pending">
        <div class="log-content"><span class="log-text">🆕 ${esc(p.name || '액자 기기')}</span><span class="log-time">요청 ${esc(t)}</span></div>
        <button type="button" class="btn-save frame-mini-btn" onclick="App.frameAdmin.approveDevice('${uid}')">승인</button>
        <button type="button" class="delete-item-btn" onclick="App.frameAdmin.rejectDevice('${uid}')" title="거절">✕</button>
      </div>`;
    }).join('');

    const deviceRows = Object.keys(state.devices || {}).filter((d) => DEV_RE.test(d)).map((id) => {
      const d = state.devices[id] || {};
      const opt = (v) => `<option value="${v}" ${d.placement === v ? 'selected' : ''}>${v}</option>`;
      return `<div class="frame-device">
        <div class="frame-device-head"><b>${esc(d.name || id)}</b> ${connText(id)}</div>
        <div class="frame-grid">
          <label>이름<input type="text" id="fd-name-${id}" class="memo-text-input" maxlength="40" value="${esc(d.name || '')}"></label>
          <label>장소<select id="fd-placement-${id}" class="memo-text-input">${opt('미정')}${opt('본가')}${opt('집')}</select></label>
          <label>야간 시작<input type="time" id="fd-ns-${id}" class="memo-text-input" value="${esc(d.nightStart || CFG.defaultNightStart)}"></label>
          <label>야간 종료<input type="time" id="fd-ne-${id}" class="memo-text-input" value="${esc(d.nightEnd || CFG.defaultNightEnd)}"></label>
        </div>
        <div class="frame-checks">
          <label><input type="checkbox" id="fd-info-${id}" ${d.infoBar !== false ? 'checked' : ''}> 날짜·시각</label>
          <label><input type="checkbox" id="fd-watch-${id}" ${d.watch !== false ? 'checked' : ''}> 끊김 알림</label>
          <label><input type="checkbox" id="fd-qr-${id}" ${d.qrCard !== false ? 'checked' : ''}> QR 복구</label>
        </div>
        <div class="frame-btn-row">
          <button type="button" class="btn-save" onclick="App.frameAdmin.saveDevice('${id}')">💾 저장</button>
          ${state.key && state.key.exportable ? `<button type="button" class="btn-prof" onclick="App.frameAdmin.openCard('${id}')">🪪 QR 카드</button>` : ''}
          <button type="button" class="btn-prof" onclick="App.frameAdmin.removeDevice('${id}')">등록 해제</button>
        </div>
      </div>`;
    }).join('');

    return `<div class="card form-card">
      <div class="frame-card-title">📺 액자 기기</div>
      ${pendingRows ? `<div class="log-list">${pendingRows}</div>` : ''}
      ${deviceRows || '<div class="empty-msg">등록된 액자 기기가 없습니다. 액자 기기 Safari에서 …/my-dashboard/frame.html 을 열어 로그인한 뒤 여기서 승인하세요.</div>'}
    </div>`;
  }

  function renderSettingsCard() {
    const s = state.settings || {};
    return `<div class="card form-card">
      <div class="frame-card-title">💬 끊김 화면 문구</div>
      <p class="frame-note">액자 연결이 끊겼을 때 크게 표시됩니다 (최대 80자). 비우면 "${esc(CFG.defaultOfflineText)}"</p>
      <div class="input-with-btn-row">
        <input type="text" id="frameOfflineText" class="memo-text-input" maxlength="80" value="${esc(s.offlineText || '')}" placeholder="${esc(CFG.defaultOfflineText)}">
        <button type="button" class="btn-save btn-inline-action" onclick="App.frameAdmin.saveOfflineText()">저장</button>
      </div>
    </div>`;
  }

  function renderProgress() {
    const el = document.getElementById('frameProgress');
    if (el) el.textContent = state.progress;
  }

  function render() {
    const root = document.getElementById('frameRoot');
    if (!root) return;
    const screen = document.getElementById('screen-frame');
    if (!screen || !screen.classList.contains('active')) return;
    if (!CFG) {
      root.innerHTML = '<div class="empty-msg">⚠️ 액자 설정 파일(frame-config.js)을 불러오지 못했습니다.</div>';
      return;
    }
    if (!db()) {
      root.innerHTML = '<div class="empty-msg">서버 연결을 기다리는 중...</div>';
      return;
    }
    if (!window.crypto || !crypto.subtle) {
      root.innerHTML = '<div class="empty-msg">⚠️ 이 브라우저는 암호화를 지원하지 않습니다 (https 접속 필요).</div>';
      return;
    }
    const active = document.activeElement;
    if (active && root.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName) && active.type !== 'file') return;
    root.innerHTML = renderKeyCard() + renderUploadCard() + renderDevicesCard() + renderSettingsCard();
  }

  async function show() {
    try {
      attach();
      if (!state.keyLoaded) await loadKey();
    } catch (e) {
      console.warn('[Frame] 초기화 실패', e);
    }
    render();
  }

  return {
    show, render, createKey, showKeyQr, copyKey, openImport, submitImport, startScan, forgetKey,
    uploadFiles, deletePhoto, previewPhoto, approveDevice, rejectDevice, saveDevice, removeDevice,
    saveOfflineText, closeModal, openCard, makeCard
  };
})();
