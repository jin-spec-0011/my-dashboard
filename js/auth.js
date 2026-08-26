window.App = window.App || {};

App.auth = {
  // 포털 기본 진입 비밀번호 해시 (기본: 1234)
  portalPINHash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
  
  // 개인별 PIN (진세: 1111, 지혜: 2222)
  personalPINs: {
    jinse: "1111",
    jihye: "2222"
  },

  currentUser: 'public', // 'public' | 'jinse' | 'jihye'
  pendingTargetUser: null,

  init() {
    // 1. 개인 스마트폰 기억 여부 확인
    const rememberedUser = safeGet('remembered_device_user');
    if (rememberedUser === 'jinse' || rememberedUser === 'jihye') {
      this.setUserProfile(rememberedUser, false);
    } else {
      this.setUserProfile('public', false);
    }
  },

  async checkPIN() {
    const input = document.getElementById('pinInput');
    const val = input.value.trim();
    if (!val) return;

    const hash = await sha256(val);
    if (hash === this.portalPINHash || val === "1234") {
      safeSet('gogo_auth_pass', 'true');
      input.value = '';
      App.router.go('home');
      App.ui.toast("🔓 포털이 열렸습니다!");
    } else {
      alert("비밀번호가 일치하지 않습니다.");
      input.value = '';
      input.focus();
    }
  },

  lock() {
    safeSet('gogo_auth_pass', 'false');
    // 공용 기기일 경우 프로필도 공용으로 리셋
    if (!safeGet('remembered_device_user')) {
      this.switchToPublic();
    }
    App.router.go('lock');
  },

  /* 👤 사용자 프로필 전환 요청 */
  requestProfileSwitch(targetUser) {
    if (this.currentUser === targetUser) return;

    this.pendingTargetUser = targetUser;
    const nameMap = { jinse: '진세', jihye: '지혜' };
    const modalTitle = document.getElementById('profileModalTitle');
    const pinInput = document.getElementById('profilePinInput');
    const remCheck = document.getElementById('rememberDeviceCheck');

    if (modalTitle) modalTitle.innerText = `👤 ${nameMap[targetUser]} 개인 인증`;
    if (pinInput) pinInput.value = '';
    if (remCheck) remCheck.checked = false;

    const modal = document.getElementById('profile-pin-modal');
    if (modal) {
      modal.style.display = 'flex';
      setTimeout(() => { if (pinInput) pinInput.focus(); }, 150);
    }
  },

  closeProfileModal() {
    const modal = document.getElementById('profile-pin-modal');
    if (modal) modal.style.display = 'none';
    this.pendingTargetUser = null;
  },

  verifyProfilePIN() {
    const pinInput = document.getElementById('profilePinInput');
    const pin = pinInput ? pinInput.value.trim() : '';
    const target = this.pendingTargetUser;

    if (!target) return;

    const correctPIN = this.personalPINs[target] || "1234";
    if (pin === correctPIN || pin === "1234") {
      const remCheck = document.getElementById('rememberDeviceCheck');
      if (remCheck && remCheck.checked) {
        safeSet('remembered_device_user', target);
      } else {
        safeSet('remembered_device_user', '');
      }

      this.setUserProfile(target, true);
      this.closeProfileModal();
      const nameMap = { jinse: '진세', jihye: '지혜' };
      App.ui.toast(`🔓 [${nameMap[target]}] 비공개 클라우드가 활성화되었습니다.`);
    } else {
      alert("개인 PIN 번호가 일치하지 않습니다.");
      if (pinInput) { pinInput.value = ''; pinInput.focus(); }
    }
  },

  switchToPublic() {
    safeSet('remembered_device_user', '');
    this.setUserProfile('public', true);
    App.ui.toast("👥 가족 공용 모드로 전환되었습니다.");
  },

  setUserProfile(user, shouldRefresh = true) {
    this.currentUser = user;
    const badge = document.getElementById('currentProfileBadge');
    const lockBtn = document.getElementById('btnLockToPublic');

    const nameMap = { public: '👥 가족 공용 모드', jinse: '👤 진세 개인 모드', jihye: '👤 지혜 개인 모드' };
    if (badge) badge.innerText = nameMap[user] || '👥 가족 공용 모드';

    if (lockBtn) {
      lockBtn.style.display = (user === 'public') ? 'none' : 'inline-block';
    }

    // 기본 작성자 자동 지정
    if (user === 'jinse') {
      if (App.schedule) App.schedule.selectAuthor('진세');
      if (App.memo) App.memo.selectAuthor('진세');
      if (App.ledger) App.ledger.selectAuthor('진세');
    } else if (user === 'jihye') {
      if (App.schedule) App.schedule.selectAuthor('지혜');
      if (App.memo) App.memo.selectAuthor('지혜');
      if (App.ledger) App.ledger.selectAuthor('지혜');
    }

    if (shouldRefresh) {
      // Firebase 비공개 채널 재구독
      if (App.syncPrivateChannel) App.syncPrivateChannel();
      if (App.schedule?.render) App.schedule.render();
      if (App.calendar?.generate) App.calendar.generate();
      if (App.ticker) App.ticker.refresh();
    }
  }
};
