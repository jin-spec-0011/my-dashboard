window.App = window.App || {};

App.auth = {
  // 핀번호 설정 (기본값: 1019)
  PIN: "1019",

  checkPIN() {
    const inputEl = document.getElementById('pinInput');
    const input = inputEl ? inputEl.value.trim() : '';

    // 1019 일치 여부 즉시 검사
    if (input === this.PIN) {
      if (typeof safeSet === 'function') {
        safeSet('gogo_auth_pass', 'true');
      } else {
        localStorage.setItem('gogo_auth_pass', 'true');
      }
      
      if (inputEl) inputEl.value = '';
      
      // 홈 화면으로 즉시 이동
      if (App.router && App.router.go) {
        App.router.go('home');
      }
    } else {
      alert('비밀번호가 올바르지 않습니다.');
      if (inputEl) {
        inputEl.value = '';
        inputEl.focus();
      }
    }
  },

  lock() {
    if (confirm('화면을 잠그시겠습니까?')) {
      if (typeof safeSet === 'function') {
        safeSet('gogo_auth_pass', 'false');
      } else {
        localStorage.setItem('gogo_auth_pass', 'false');
      }
      if (App.router && App.router.go) {
        App.router.go('lock');
      }
    }
  }
};
