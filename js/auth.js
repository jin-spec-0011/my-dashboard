window.App = window.App || {};

App.auth = {
  // 포털 기본 진입 비밀번호 (1234)
  portalPINHash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
  
  // 개인별 기본 PIN 해시 (진세: 1111, 지혜: 2222)
  defaultPINHashes: {
    jinse: "0ffe1abd1a08215353c233d6e009613e95eec4253832a761af28ff37ac5ab67e", // 1111
    jihye: "edee29f882543b956620b26d0ee0e7e950399b1c4222f5de05e06425b4c995e9"  // 2222
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
    if (!safeGet('remembered_device_user')) {
      this.switchToPublic();
    }
    App.router.go('lock');
  },

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

  /* 🔒 개인 PIN 검증 */
  async verifyProfilePIN() {
    const pinInput = document.getElementById('profilePinInput');
    const pin = pinInput ? pinInput.value.trim() : '';
    const target = this.pendingTargetUser;

    if (!target) return;
    if (!pin) return alert("PIN 4자리를 입력하세요.");

    const inputHash = await sha256(pin);
    const savedHash = safeGet(`pin_hash_${target}`) || this.defaultPINHashes[target];

    if (inputHash === savedHash || pin === "1234") {
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

    const authModal = document.getElementById('profile-pin-modal');
    if (authModal) authModal.style.display = 'none';

    const changeModal = document.getElementById('profile-pin-change-modal');
    if (changeModal) changeModal.style.display = 'flex';
  },

  closeChangePinModal() {
    const changeModal = document.getElementById('profile-pin-change-modal');
    if (changeModal) changeModal.style.display = 'none';
  },

  /* 🔑 새 PIN 저장 (Firebase 클라우드 동기화) */
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

    // 현재 PIN 확인
    const curHash = await sha256(curPin);
    const savedHash = safeGet(`pin_hash_${target}`) || this.defaultPINHashes[target];

    if (curHash !== savedHash && curPin !== "1234") {
      return alert("현재 PIN 번호가 일치하지 않습니다.");
    }

    // 새 PIN 암호화 후 Firebase 저장
    const newHash = await sha256(newPin);
    safeSet(`pin_hash_${target}`, newHash);

    if (App.isFirebaseActive && App.db) {
      App.db.ref(`auth_pins/${target}`).set(newHash);
    }

    const nameMap = { jinse: '진세', jihye: '지혜' };
    alert(`[${nameMap[target]}] 새 비밀번호가 성공적으로 저장되었습니다!\n모든 기기에 즉시 동기화됩니다.`);
    this.closeChangePinModal();
  },

  /* 🔄 비밀번호 분실 시 마스터 키(1234)로 초기화 */
  async resetPersonalPIN(targetUser) {
    const target = targetUser || this.pendingTargetUser || (this.currentUser !== 'public' ? this.currentUser : 'jinse');
    const nameMap = { jinse: '진세', jihye: '지혜' };
    const defaultPinMap = { jinse: '1111', jihye: '2222' };

    const masterKey = prompt(`[${nameMap[target]}] 비밀번호 초기화를 위해 포털 마스터 비밀번호(4자리)를 입력하세요:`);
    if (masterKey === null) return;

    const masterHash = await sha256(masterKey.trim());
    if (masterHash === this.portalPINHash || masterKey.trim() === "1234") {
      // 1. Firebase에서 개인 PIN 삭제 -> 기본값으로 복원
      if (App.isFirebaseActive && App.db) {
        App.db.ref(`auth_pins/${target}`).remove();
      }
      safeSet(`pin_hash_${target}`, '');

      alert(`✅ [${nameMap[target]}] 비밀번호가 초기값(${defaultPinMap[target]})으로 초기화되었습니다.\n초기 번호로 로그인 후 새 번호로 변경해주세요.`);
      
      const pinInput = document.getElementById('profilePinInput');
      if (pinInput) {
        pinInput.value = defaultPinMap[target];
        pinInput.focus();
      }
    } else {
      alert("❌ 마스터 비밀번호가 일치하지 않습니다.");
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
      if (App.syncPrivateChannel) App.syncPrivateChannel();
      if (App.schedule?.render) App.schedule.render();
      if (App.calendar?.generate) App.calendar.generate();
      if (App.ticker) App.ticker.refresh();
    }
  }
};
