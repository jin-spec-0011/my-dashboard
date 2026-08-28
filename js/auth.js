window.App = window.App || {};

App.auth = {
  // 평시 로그인 코드: 1019 / 마스터 비상 코드: 1234
  validPortalPINs: ["1019", "1234"],

  // 개인별 기본 PIN 해시 (진세: 1111, 지혜: 2222)
  defaultPINHashes: {
    jinse: "0ffe1abd1a08215353c233d6e009613e95eec4253832a761af28ff37ac5ab67e", // 1111
    jihye: "edee29f882543b956620b26d0ee0e7e950399b1c4222f5de05e06425b4c995e9"  // 2222
  },

  currentUser: 'public', // 'public' | 'jinse' | 'jihye'
  pendingTargetUser: null,

  init() {
    const rememberedUser = safeGet('remembered_device_user');
    if (rememberedUser === 'jinse' || rememberedUser === 'jihye') {
      this.setUserProfile(rememberedUser, true);
    } else {
      this.setUserProfile('public', true);
    }
  },

  /* 🔓 포털 메인 로그인 검증 */
  async checkPIN() {
    const input = document.getElementById('pinInput');
    const val = input ? input.value.trim() : '';
    
    if (!val) {
      alert("PIN 번호 4자리를 입력해주세요.");
      if (input) input.focus();
      return;
    }

    const isValid = this.validPortalPINs.includes(val);

    if (isValid) {
      safeSet('gogo_auth_pass', 'true');
      if (input) {
        input.value = '';
        input.blur();
      }

      const targetHash = window.location.hash.replace('#', '');
      const validScreens = ['parking', 'memo', 'trip', 'ledger', 'schedule', 'calendar'];
      
      let destination = 'home';
      if (App.state && App.state.pendingRedirect) {
        destination = App.state.pendingRedirect;
        App.state.pendingRedirect = null;
      } else if (validScreens.includes(targetHash)) {
        destination = targetHash;
      }

      App.router.go(destination);
      App.ui.toast("🔓 포털이 열렸습니다!");
    } else {
      alert("비밀번호가 일치하지 않습니다.\n(평시: 1019 / 마스터: 1234)");
      if (input) {
        input.value = '';
        input.focus();
      }
    }
  },

  lock() {
    safeSet('gogo_auth_pass', 'false');
    if (!safeGet('remembered_device_user')) {
      this.switchToPublic();
    }
    App.router.go('lock');
  },

  /* 👤 프로필 전환 요청 모달 열기 */
  requestProfileSwitch(targetUser) {
    const nameMap = { jinse: '진세', jihye: '지혜', public: '가족 공용' };

    if (this.currentUser === targetUser) {
      const isRemembered = (safeGet('remembered_device_user') === targetUser);
      App.ui.toast(`현재 이미 [${nameMap[targetUser]}] 모드입니다.${isRemembered ? ' (기기 저장됨 📱)' : ''}`);
      return;
    }

    if (targetUser === 'public') {
      this.switchToPublic();
      return;
    }

    this.pendingTargetUser = targetUser;
    const modalTitle = document.getElementById('profileModalTitle');
    const pinInput = document.getElementById('profilePinInput');
    const remCheck = document.getElementById('rememberDeviceCheck');

    if (modalTitle) modalTitle.innerText = `👤 ${nameMap[targetUser]} 개인 인증`;
    if (pinInput) pinInput.value = '';
    if (remCheck) remCheck.checked = true;

    const modal = document.getElementById('profile-pin-modal');
    if (modal) {
      modal.style.removeProperty('display');
      modal.style.display = 'flex';
      setTimeout(() => { if (pinInput) pinInput.focus(); }, 150);
    }
  },

  /* 🚪 모달 창 강제 닫기 */
  closeProfileModal() {
    const modal = document.getElementById('profile-pin-modal');
    if (modal) {
      modal.style.setProperty('display', 'none', 'important');
    }
    const pinInput = document.getElementById('profilePinInput');
    if (pinInput) {
      pinInput.value = '';
      pinInput.blur();
    }
    this.pendingTargetUser = null;
  },

  /* 🔒 1. 개인 PIN 검증 및 즉시 창 닫기 (우선순위 재정렬) */
  async verifyProfilePIN() {
    const pinInput = document.getElementById('profilePinInput');
    const pin = pinInput ? pinInput.value.trim() : '';
    const target = this.pendingTargetUser;

    if (!target) return;
    if (!pin) {
      alert("PIN 4자리를 입력하세요.");
      if (pinInput) pinInput.focus();
      return;
    }

    let inputHash = '';
    try {
      inputHash = await sha256(pin);
    } catch(e) {}

    const savedHash = safeGet(`pin_hash_${target}`) || this.defaultPINHashes[target];

    if (inputHash === savedHash || pin === "1234" || pin === "1019") {
      const remCheck = document.getElementById('rememberDeviceCheck');
      if (remCheck && remCheck.checked) {
        safeSet('remembered_device_user', target);
      } else {
        safeSet('remembered_device_user', '');
      }

      // ★ 1. 모달 창 및 가상 키보드 즉시 강제 종료 (최우선 실행)
      this.closeProfileModal();

      // ★ 2. 프로필 설정 및 화면 갱신 실행
      this.setUserProfile(target, true);
      
      const nameMap = { jinse: '진세', jihye: '지혜' };
      const remText = (remCheck && remCheck.checked) ? ' (📱 기기 기억됨)' : '';
      App.ui.toast(`🔓 [${nameMap[target]}] 모드가 활성화되었습니다.${remText}`);
    } else {
      alert("개인 PIN 번호가 일치하지 않습니다.");
      if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
      }
    }
  },

  /* 🔑 PIN 변경 모달 열기/닫기 */
  openChangePinModal() {
    const target = this.pendingTargetUser || (this.currentUser !== 'public' ? this.currentUser : 'jinse');
    this.pendingTargetUser = target;

    const nameMap = { jinse: '진세', jihye: '지혜' };
    const titleEl = document.getElementById('changePinModalTitle');
    if (titleEl) titleEl.innerText = `🔑 ${nameMap[target]} PIN 변경`;

    document.getElementById('currentPinInput').value = '';
    document.getElementById('newPinInput').value = '';
    document.getElementById('newPinConfirmInput').value = '';

    // 인증 모달 강제 닫기
    const authModal = document.getElementById('profile-pin-modal');
    if (authModal) authModal.style.setProperty('display', 'none', 'important');

    const changeModal = document.getElementById('profile-pin-change-modal');
    if (changeModal) {
      changeModal.style.removeProperty('display');
      changeModal.style.display = 'flex';
      setTimeout(() => {
        const curInp = document.getElementById('currentPinInput');
        if (curInp) curInp.focus();
      }, 150);
    }
  },

  closeChangePinModal() {
    const changeModal = document.getElementById('profile-pin-change-modal');
    if (changeModal) {
      changeModal.style.setProperty('display', 'none', 'important');
    }
    const curInp = document.getElementById('currentPinInput');
    if (curInp) curInp.blur();
  },

  /* 🔑 2. 새 PIN 저장 후 새 비밀번호로 다시 인증 진행 */
  async saveNewPIN() {
    const target = this.pendingTargetUser;
    if (!target) return;

    const curPin = document.getElementById('currentPinInput').value.trim();
    const newPin = document.getElementById('newPinInput').value.trim();
    const confirmPin = document.getElementById('newPinConfirmInput').value.trim();

    if (!curPin || !newPin || !confirmPin) {
      return alert("모든 항목을 입력해주세요.");
    }
    if (newPin.length !== 4 || isNaN(Number(newPin))) {
      return alert("새 PIN은 숫자 4자리로 입력해주세요.");
    }
    if (newPin !== confirmPin) {
      return alert("새 PIN 번호가 서로 일치하지 않습니다.");
    }

    let curHash = '';
    try { curHash = await sha256(curPin); } catch(e) {}
    const savedHash = safeGet(`pin_hash_${target}`) || this.defaultPINHashes[target];

    if (curHash !== savedHash && curPin !== "1234" && curPin !== "1019") {
      return alert("현재 PIN 번호가 일치하지 않습니다.");
    }

    const newHash = await sha256(newPin);
    safeSet(`pin_hash_${target}`, newHash);

    if (App.isFirebaseActive && App.db) {
      App.db.ref(`auth_pins/${target}`).set(newHash);
    }

    const nameMap = { jinse: '진세', jihye: '지혜' };
    alert(`[${nameMap[target]}] 새 비밀번호가 저장되었습니다!\n새 비밀번호로 인증을 진행해주세요.`);

    // PIN 변경 창 닫기
    this.closeChangePinModal();

    // 새 비밀번호 인증 모달 열기
    this.pendingTargetUser = target;
    const modalTitle = document.getElementById('profileModalTitle');
    const pinInput = document.getElementById('profilePinInput');

    if (modalTitle) modalTitle.innerText = `👤 ${nameMap[target]} 개인 인증 (새 PIN 입력)`;
    if (pinInput) pinInput.value = '';

    const authModal = document.getElementById('profile-pin-modal');
    if (authModal) {
      authModal.style.removeProperty('display');
      authModal.style.display = 'flex';
      setTimeout(() => { if (pinInput) pinInput.focus(); }, 150);
    }
  },

  /* 🔄 마스터 코드(1234)로 개인 PIN 초기화 */
  async resetPersonalPIN(targetUser) {
    const target = targetUser || this.pendingTargetUser || (this.currentUser !== 'public' ? this.currentUser : 'jinse');
    const nameMap = { jinse: '진세', jihye: '지혜' };
    const defaultPinMap = { jinse: '1111', jihye: '2222' };

    const masterKey = prompt(`[${nameMap[target]}] 비밀번호 초기화를 위해 마스터 코드(1234)를 입력하세요:`);
    if (masterKey === null) return;

    const key = masterKey.trim();
    if (key === "1234" || key === "1019") {
      if (App.isFirebaseActive && App.db) {
        App.db.ref(`auth_pins/${target}`).remove();
      }
      safeSet(`pin_hash_${target}`, '');
      alert(`✅ [${nameMap[target]}] 비밀번호가 초기값(${defaultPinMap[target]})으로 초기화되었습니다.`);
      
      const pinInput = document.getElementById('profilePinInput');
      if (pinInput) {
        pinInput.value = defaultPinMap[target];
        pinInput.focus();
      }
    } else {
      alert("❌ 코드가 일치하지 않습니다.");
    }
  },

  switchToPublic() {
    safeSet('remembered_device_user', '');
    this.setUserProfile('public', true);
    App.ui.toast("👥 가족 공용 모드로 전환되었습니다.");
  },

  /* 🛡️ 프로필 화면 동기화 (에러 방어 래핑) */
  setUserProfile(user, shouldRefresh = true) {
    this.currentUser = user;
    const badge = document.getElementById('currentProfileBadge');
    const isRemembered = (safeGet('remembered_device_user') === user);

    const btnPublic = document.getElementById('btn-prof-public');
    const btnJinse = document.getElementById('btn-prof-jinse');
    const btnJihye = document.getElementById('btn-prof-jihye');

    if (btnPublic) btnPublic.classList.toggle('active', user === 'public');
    if (btnJinse) btnJinse.classList.toggle('active', user === 'jinse');
    if (btnJihye) btnJihye.classList.toggle('active', user === 'jihye');

    if (badge) {
      if (user === 'jinse') {
        badge.innerHTML = `👤 진세 모드 ${isRemembered ? '<span class="device-tag">📱 자동로그인</span>' : ''}`;
      } else if (user === 'jihye') {
        badge.innerHTML = `👤 지혜 모드 ${isRemembered ? '<span class="device-tag">📱 자동로그인</span>' : ''}`;
      } else {
        badge.innerText = '👥 가족 공용 모드';
      }
    }

    try {
      if (user === 'jinse') {
        if (App.schedule) App.schedule.selectAuthor('진세');
        if (App.memo) App.memo.selectAuthor('진세');
        if (App.ledger) App.ledger.selectAuthor('진세');
      } else if (user === 'jihye') {
        if (App.schedule) App.schedule.selectAuthor('지혜');
        if (App.memo) App.memo.selectAuthor('지혜');
        if (App.ledger) App.ledger.selectAuthor('지혜');
      }
    } catch(e) {}

    if (shouldRefresh) {
      try { if (App.syncPrivateChannel) App.syncPrivateChannel(); } catch(e) {}
      try { if (App.schedule?.render) App.schedule.render(); } catch(e) {}
      try { if (App.calendar?.generate) App.calendar.generate(); } catch(e) {}
      try { if (App.ticker) App.ticker.refresh(); } catch(e) {}
    }
  }
};
