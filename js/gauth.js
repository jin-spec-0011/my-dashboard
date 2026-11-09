/**
 * GOGO 스마트 매니저 - Google 로그인 게이트 (js/gauth.js)
 * - Firebase Auth(Google) 로그인 → members/{uid} 값으로 프로필(jinse | jihye) 판정
 * - 미등록 계정은 UID/이메일 표시 후 차단 (Firebase 콘솔에서 members 등록)
 * - 로그인 + 멤버 확인 완료 후에만 App.initFirebase() 실행 → 비인증 DB 접근 0건
 * - iOS 단축어용 refresh token 복사 기능 포함
 */
window.App = window.App || {};

App.gauth = {
  user: null,
  profile: null,
  _started: false,
  _readyFired: false,
  _onReady: null,
  _overlay: null,

  start(onReady) {
    if (this._started) return;
    this._started = true;
    this._onReady = typeof onReady === 'function' ? onReady : null;

    if (typeof firebase === 'undefined' || !firebase.auth) {
      console.warn('[GAuth] Firebase Auth SDK 미로드');
      this.showOverlay('error', '⚠️ 로그인 모듈을 불러오지 못했습니다.\n네트워크 확인 후 새로고침해주세요.');
      return;
    }

    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    } catch (e) {
      console.error('[GAuth] Firebase 초기화 실패', e);
      this.showOverlay('error', '⚠️ 서버 초기화에 실패했습니다.\n새로고침해주세요.');
      return;
    }

    const auth = firebase.auth();
    try { auth.useDeviceLanguage(); } catch (e) { console.warn('[GAuth] 언어 설정 실패', e); }

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch((e) => console.warn('[GAuth] LOCAL 세션 유지 설정 실패', e));

    auth.getRedirectResult().catch((e) => {
      console.warn('[GAuth] 리다이렉트 로그인 실패', e);
      this.showOverlay('login', this.describeError(e));
    });

    auth.onAuthStateChanged((user) => {
      this.handleAuthState(user).catch((e) => {
        console.error('[GAuth] 인증 상태 처리 오류', e);
        this.showOverlay('error', '⚠️ 인증 확인 중 오류가 발생했습니다.\n새로고침해주세요.');
      });
    });

    this.showOverlay('loading', '🔐 로그인 상태 확인 중...');
  },

  async handleAuthState(user) {
    if (!user) {
      this.user = null;
      this.profile = null;
      safeSet('gogo_auth_pass', 'false');
      this.showOverlay('login', '');
      return;
    }

    this.user = user;
    this.showOverlay('loading', '👤 가족 구성원 확인 중...');

    let profile = null;
    try {
      const snap = await firebase.database().ref(`members/${user.uid}`).once('value');
      profile = snap.val();
    } catch (e) {
      console.warn('[GAuth] members 조회 실패', e);
    }

    if (profile !== 'jinse' && profile !== 'jihye') {
      this.profile = null;
      safeSet('gogo_auth_pass', 'false');
      this.showOverlay('denied', user.uid, user.email || '');
      return;
    }

    this.profile = profile;
    safeSet('gogo_auth_pass', 'true');
    safeSet('remembered_device_user', profile);

    try {
      if (App.auth && App.auth.setUserProfile) App.auth.setUserProfile(profile, false);
    } catch (e) {
      console.warn('[GAuth] 프로필 반영 실패', e);
    }

    this.hideOverlay();

    if (!this._readyFired && this._onReady) {
      this._readyFired = true;
      try {
        this._onReady();
      } catch (e) {
        console.error('[GAuth] onReady 실행 오류', e);
      }
    }

    try {
      if (!App.router) return;
      const hash = window.location.hash.replace('#', '');
      const screens = App.router.screens || [];
      let target = screens.includes(hash) && hash !== 'lock' ? hash : 'home';
      if (App.state && App.state.pendingRedirect) {
        target = App.state.pendingRedirect;
        App.state.pendingRedirect = null;
      }
      App.router.go(target);
    } catch (e) {
      console.warn('[GAuth] 라우팅 실패', e);
    }
  },

  async signIn() {
    if (typeof firebase === 'undefined' || !firebase.auth) {
      alert('로그인 모듈이 아직 로드되지 않았습니다. 새로고침해주세요.');
      return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    this.showOverlay('loading', '🔑 Google 로그인 창을 여는 중...');

    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (e) {
      const fallbackCodes = [
        'auth/popup-blocked',
        'auth/operation-not-supported-in-this-environment',
        'auth/web-storage-unsupported'
      ];
      if (e && fallbackCodes.includes(e.code)) {
        try {
          await firebase.auth().signInWithRedirect(provider);
          return;
        } catch (e2) {
          console.error('[GAuth] 리다이렉트 로그인 실패', e2);
          this.showOverlay('login', this.describeError(e2));
          return;
        }
      }
      console.warn('[GAuth] 팝업 로그인 실패', e);
      this.showOverlay('login', this.describeError(e));
    }
  },

  async signOut() {
    if (!confirm('로그아웃하시겠습니까?\n이 기기에서 다시 Google 로그인이 필요합니다.')) return;
    try {
      if (typeof firebase !== 'undefined' && firebase.auth) await firebase.auth().signOut();
    } catch (e) {
      console.warn('[GAuth] 로그아웃 오류', e);
    }
    safeSet('gogo_auth_pass', 'false');
    safeSet('remembered_device_user', '');
    window.location.reload();
  },

  /* iOS 단축어용 장기 토큰: 해당 Google 계정의 DB 권한과 동일 → 단축어 외 저장 금지 */
  async copyShortcutToken() {
    const user = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    if (!user || !user.refreshToken || !this.profile) {
      alert('가족 계정으로 로그인된 상태에서만 발급할 수 있습니다.');
      return;
    }
    const ok = confirm('⚠️ iOS 단축어 전용 토큰을 복사합니다.\n이 값이 유출되면 DB 전체 접근이 가능합니다.\n단축어 외에는 절대 붙여넣지 마세요.\n\n계속할까요?');
    if (!ok) return;
    const token = user.refreshToken;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(token);
        if (App.ui) App.ui.toast('📋 단축어 토큰이 복사되었습니다.');
        return;
      }
      throw new Error('clipboard API 미지원');
    } catch (e) {
      console.warn('[GAuth] 클립보드 복사 실패, 수동 복사 전환', e);
      prompt('아래 토큰을 길게 눌러 복사하세요:', token);
    }
  },

  describeError(e) {
    const code = e && e.code ? e.code : '';
    const map = {
      'auth/popup-closed-by-user': '로그인 창이 닫혔습니다. 다시 시도해주세요.',
      'auth/cancelled-popup-request': '로그인 요청이 취소되었습니다.',
      'auth/unauthorized-domain': '⚠️ 승인되지 않은 도메인입니다.\nFirebase 콘솔 → Authentication → 설정 → 승인된 도메인에 현재 주소를 추가하세요.',
      'auth/operation-not-allowed': '⚠️ Google 로그인이 비활성화 상태입니다.\nFirebase 콘솔 → Authentication → 로그인 방법에서 Google을 사용 설정하세요.',
      'auth/network-request-failed': '⚠️ 네트워크 오류입니다. 연결 상태를 확인해주세요.',
      'auth/user-disabled': '⚠️ 사용 중지된 계정입니다.'
    };
    return map[code] || `⚠️ 로그인 실패 (${code || '알 수 없는 오류'})`;
  },

  ensureOverlay() {
    if (this._overlay && document.body.contains(this._overlay)) return this._overlay;
    const el = document.createElement('div');
    el.id = 'gauth-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:24px',
      'background:#f1f5f9', 'box-sizing:border-box'
    ].join(';');
    document.body.appendChild(el);
    this._overlay = el;
    return el;
  },

  showOverlay(mode, message, extra) {
    const el = this.ensureOverlay();
    el.style.display = 'flex';
    el.innerHTML = '';

    const card = document.createElement('div');
    card.style.cssText = 'width:100%;max-width:360px;background:#ffffff;border-radius:16px;padding:28px 22px;text-align:center;box-shadow:0 10px 30px rgba(15,23,42,0.12);box-sizing:border-box;';

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:40px;margin-bottom:8px;';
    icon.textContent = mode === 'denied' ? '⛔' : (mode === 'error' ? '⚠️' : '🔐');

    const title = document.createElement('h2');
    title.style.cssText = 'margin:0 0 10px;font-size:18px;color:#0f172a;';
    title.textContent = mode === 'denied' ? '등록되지 않은 계정' : 'GOGO 스마트 포털';

    const desc = document.createElement('p');
    desc.style.cssText = 'margin:0 0 18px;font-size:13px;line-height:1.6;color:#475569;white-space:pre-wrap;word-break:break-all;';

    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);

    const makeBtn = (text, bg, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = `width:100%;padding:13px;border:0;border-radius:10px;font-size:15px;font-weight:700;color:#ffffff;background:${bg};cursor:pointer;margin-top:8px;`;
      b.addEventListener('click', onClick);
      return b;
    };

    if (mode === 'loading') {
      desc.textContent = message || '확인 중...';
    } else if (mode === 'login') {
      desc.textContent = message || '가족 Google 계정으로 로그인하세요.';
      card.appendChild(makeBtn('G  Google 계정으로 로그인', '#2563eb', () => this.signIn()));
    } else if (mode === 'denied') {
      desc.textContent = `이 계정은 가족 구성원으로 등록되지 않았습니다.\n\n계정: ${extra || '-'}\nUID: ${message}\n\n관리자가 Firebase 콘솔 → Realtime Database → members 에\n이 UID를 등록한 뒤 새로고침하세요.`;
      card.appendChild(makeBtn('📋 UID 복사', '#0f766e', async () => {
        try {
          await navigator.clipboard.writeText(String(message));
          if (App.ui) App.ui.toast('📋 UID가 복사되었습니다.');
        } catch (e) {
          prompt('UID를 복사하세요:', String(message));
        }
      }));
      card.appendChild(makeBtn('🔄 등록 후 새로고침', '#2563eb', () => window.location.reload()));
      card.appendChild(makeBtn('다른 계정으로 로그인', '#64748b', async () => {
        try { await firebase.auth().signOut(); } catch (e) { console.warn('[GAuth] signOut 실패', e); }
      }));
    } else {
      desc.textContent = message || '오류가 발생했습니다.';
      card.appendChild(makeBtn('🔄 새로고침', '#64748b', () => window.location.reload()));
    }

    el.appendChild(card);
  },

  hideOverlay() {
    if (this._overlay) this._overlay.style.display = 'none';
  }
};
