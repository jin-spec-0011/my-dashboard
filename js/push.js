window.App = window.App || {};

App.push = {
  swRegistration: null,
  isSupported: false,

  async init() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      this.isSupported = true;
      try {
        this.swRegistration = await navigator.serviceWorker.register('sw.js');
        this.updatePushUI();
      } catch (error) {
        console.warn('서비스 워커 등록 실패:', error);
      }
    } else {
      this.updatePushUI();
    }
  },

  /* 🔔 알림 권한 요청 (iOS 홈화면 추가 여부 자동 체크) */
  async requestPermission() {
    if (!('Notification' in window)) {
      alert("이 브라우저는 푸시 알림을 지원하지 않습니다.\n아이폰은 '홈 화면에 추가' 후 앱으로 실행해주세요.");
      return;
    }

    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS && !isStandalone) {
      alert("📱 아이폰 푸시 알림 안내\n\nSafari 하단 공유 버튼(네모+화살표)을 눌러 '홈 화면에 추가'하신 후, 홈 화면의 앱 아이콘으로 접속해야 푸시 알림을 받을 수 있습니다.");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        App.ui.toast("🔔 푸시 알림이 활성화되었습니다!");
        this.sendLocalNotification(
          "🚗 GOGO 매니저 알림 연동 완료",
          "가족의 새로운 일정, 주차 위치, 장보기 소식이 스마트폰 상단 팝업으로 전달됩니다."
        );
      } else if (permission === 'denied') {
        alert("알림 권한이 차단되었습니다. 기기 설정 > 브라우저/앱 설정에서 알림을 허용해주세요.");
      }
      this.updatePushUI();
    } catch (e) {
      console.error("알림 권한 요청 에러:", e);
    }
  },

  /* 📲 기기 상단 배너 푸시 알림 띄우기 */
  async sendLocalNotification(title, body, url = './index.html') {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    if (this.swRegistration && this.swRegistration.showNotification) {
      this.swRegistration.showNotification(title, {
        body: body,
        icon: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
        vibrate: [200, 100, 200],
        data: { url: url }
      });
    } else {
      new Notification(title, {
        body: body,
        icon: 'https://cdn-icons-png.flaticon.com/512/854/854878.png'
      });
    }
  },

  /* 🔔 상단 알림 버튼 UI 상태 동기화 */
  updatePushUI() {
    const btn = document.getElementById('btnPushToggle');
    if (!btn) return;

    if (!('Notification' in window)) {
      btn.innerText = '🔔 알림';
      return;
    }

    if (Notification.permission === 'granted') {
      btn.innerText = '🔔 알림 켜짐';
      btn.classList.add('push-active');
    } else {
      btn.innerText = '🔔 알림 켜기';
      btn.classList.remove('push-active');
    }
  }
};
