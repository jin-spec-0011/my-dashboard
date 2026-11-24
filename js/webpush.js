/**
 * GOGO 스마트 매니저 - Web Push 구독 (js/webpush.js)
 * - 서버(GitHub Actions)가 보내는 알림을 받기 위한 구독 관리 (액자 끊김 알림 등)
 * - iOS: 홈 화면에 추가한 GOGO 앱(iOS 16.4+)에서만 동작, 버튼 탭으로만 권한 요청
 * - 구독 정보: /push_subscriptions/{uid}/{subId} (본인만 쓰기), 공개키: /push_config/vapidPublic
 */
window.App = window.App || {};

App.webpush = (function () {
  'use strict';

  const LS_SUB = 'gogo_webpush_sub_id';

  function bytesFromB64url(str) {
    const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const bin = atob(s + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function b64urlFromBuffer(buf) {
    if (!buf) return '';
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function subIdOf(endpoint) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(endpoint)));
    return 'sub_' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }

  function isStandalone() {
    return Boolean(window.navigator.standalone) || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  }

  function supportState() {
    if (!('serviceWorker' in navigator)) return 'no-sw';
    if (isIOS() && !isStandalone()) return 'need-home-screen';
    if (!('PushManager' in window) || !('Notification' in window)) return 'no-push';
    if (Notification.permission === 'denied') return 'denied';
    return 'ok';
  }

  function uid() {
    return App.gauth && App.gauth.user ? App.gauth.user.uid : '';
  }

  async function registration() {
    let reg = null;
    try { reg = await navigator.serviceWorker.getRegistration(); } catch (e) { reg = null; }
    if (!reg) reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    return navigator.serviceWorker.ready.then(() => reg);
  }

  /* 반환: 'on' | 'off' | 지원 불가 상태 문자열 */
  async function status() {
    const sup = supportState();
    if (sup !== 'ok') return sup;
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      return sub && Notification.permission === 'granted' ? 'on' : 'off';
    } catch (e) {
      return 'off';
    }
  }

  async function enable() {
    const sup = supportState();
    if (sup === 'need-home-screen') throw new Error('Safari 공유 버튼 → 홈 화면에 추가 → 홈 화면의 GOGO 앱에서 다시 눌러 주세요.');
    if (sup === 'denied') throw new Error('알림이 차단되어 있습니다. 설정 → 알림 → GOGO매니저에서 허용하세요.');
    if (sup !== 'ok') throw new Error('이 기기는 웹 푸시를 지원하지 않습니다 (iOS 16.4 이상 필요).');
    if (!uid() || !App.db) throw new Error('가족 계정으로 로그인해야 합니다.');

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다.');

    const snap = await App.db.ref('push_config/vapidPublic').once('value');
    const publicKey = snap.val();
    if (!publicKey || typeof publicKey !== 'string') throw new Error('서버 알림 키가 아직 없습니다.');

    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const cur = sub.options && sub.options.applicationServerKey ? b64urlFromBuffer(sub.options.applicationServerKey) : '';
      if (cur && cur !== publicKey) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
    }
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesFromB64url(publicKey) });
    }

    const json = sub.toJSON();
    if (!json || !json.endpoint || !json.keys || !json.keys.p256dh || !json.keys.auth) throw new Error('구독 정보를 만들지 못했습니다.');
    const subId = await subIdOf(json.endpoint);
    await App.db.ref(`push_subscriptions/${uid()}/${subId}`).set({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      ua: isIOS() ? 'ios' : 'other',
      createdAt: Date.now()
    });
    try { localStorage.setItem(LS_SUB, subId); } catch (e) { /* 무시 */ }
    return 'on';
  }

  async function disable() {
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const subId = await subIdOf(sub.endpoint);
        if (uid() && App.db) await App.db.ref(`push_subscriptions/${uid()}/${subId}`).remove().catch(() => {});
        await sub.unsubscribe();
      }
    } finally {
      try { localStorage.removeItem(LS_SUB); } catch (e) { /* 무시 */ }
    }
    return 'off';
  }

  return { status, enable, disable, supportState };
})();
