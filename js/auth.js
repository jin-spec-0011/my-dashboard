window.App = window.App || {};

App.auth = {
  // PIN "1019" SHA-256 해시값
  PIN_HASH: "b67c825a07ddf177c449339eef37b01b606d88f6153723de4a1d4715f21a4f00",

  async checkPIN() {
    const input = document.getElementById('pinInput').value;
    const inputHash = await sha256(input);

    if (inputHash === App.auth.PIN_HASH) {
      safeSet('gogo_auth_pass', 'true');
      document.getElementById('pinInput').value = '';
      App.router.go('home');
    } else {
      alert('비밀번호가 올바르지 않습니다.');
      document.getElementById('pinInput').value = '';
      document.getElementById('pinInput').focus();
    }
  },

  lock() {
    if (confirm('화면을 잠그시겠습니까?')) {
      safeSet('gogo_auth_pass', 'false');
      App.router.go('lock');
    }
  }
};