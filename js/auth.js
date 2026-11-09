/**
 * GOGO 스마트 매니저 - 프로필 상태 (js/auth.js)
 * - 인증은 js/gauth.js (Google 로그인 + members/{uid}) 가 전담
 * - 이 모듈은 현재 프로필(jinse | jihye | public) 표시와 화면 갱신만 담당
 * - 구 PIN 인증(포털 PIN / 개인 PIN / 마스터 PIN) 전면 폐기
 */
window.App = window.App || {};

App.auth = {
  currentUser: 'public',
  nameMap: { jinse: '진세', jihye: '지혜', public: '가족 공용' },

  init() {
    /* 구 PIN 시스템 잔여 데이터 정리 */
    ['pin_hash_jinse', 'pin_hash_jihye'].forEach((k) => {
      try { localStorage.removeItem(k); } catch (e) { /* 프라이빗 모드 등 */ }
    });

    const remembered = safeGet('remembered_device_user');
    const user = (remembered === 'jinse' || remembered === 'jihye') ? remembered : 'public';
    this.setUserProfile(user, false);
  },

  /* 홈 헤더 잠금 버튼 호환: 로그아웃으로 동작 */
  lock() {
    if (App.gauth && typeof App.gauth.signOut === 'function') {
      App.gauth.signOut();
    }
  },

  setUserProfile(user, shouldRefresh = true) {
    const valid = (user === 'jinse' || user === 'jihye') ? user : 'public';
    this.currentUser = valid;

    const badge = document.getElementById('currentProfileBadge');
    if (badge) {
      const email = (App.gauth && App.gauth.user && App.gauth.user.email) ? App.gauth.user.email : '';
      badge.textContent = valid === 'public'
        ? '👥 로그인 확인 중'
        : `👤 ${this.nameMap[valid]}${email ? ` · ${email}` : ''}`;
    }

    try {
      if (App.schedule && valid !== 'public') App.schedule.selectAuthor(this.nameMap[valid]);
    } catch (e) {
      console.warn('[Auth] 작성자 동기화 실패', e);
    }

    if (shouldRefresh) {
      try { if (App.syncPrivateChannel) App.syncPrivateChannel(); } catch (e) { console.warn(e); }
      try { if (App.schedule && App.schedule.render) App.schedule.render(); } catch (e) { console.warn(e); }
      try { if (App.calendar && App.calendar.generate) App.calendar.generate(); } catch (e) { console.warn(e); }
      try { if (App.ticker) App.ticker.refresh(); } catch (e) { console.warn(e); }
    }
  }
};
