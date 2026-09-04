window.App = window.App || {};

App.push = {
  swRegistration: null,
  isSupported: false,

  async init() {
    if ('serviceWorker' in navigator) {
      try {
        this.swRegistration = await navigator.serviceWorker.register('sw.js');
        this.isSupported = true;
      } catch (error) {
        console.warn('서비스 워커 등록 실패:', error);
      }
    }
    this.updatePushUI();
  },

  /* 1번 요구사항: 알람 켜짐 상태 유지 및 알람 요청 */
  async requestPermission() {
    if (!('Notification' in window)) {
      alert("이 기기 브라우저는 웹 푸시를 지원하지 않습니다.\n아이폰은 Safari 하단 공유 버튼 > '홈 화면에 추가' 후 앱으로 실행해주세요.");
      return;
    }

    // 이미 권한이 켜져 있는 경우 안내만 제공하고 끄지 않음
    if (Notification.permission === 'granted') {
      App.ui.toast("🔔 알림이 정상 작동 중입니다.");
      this.sendLocalNotification("🚗 GOGO 매니저", "실시간 알림이 켜져 있습니다.");
      this.updatePushUI();
      return;
    }

    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS && !isStandalone) {
      alert("📱 아이폰 알림 설정 안내\n\nSafari 하단 공유 버튼(네모+화살표)을 눌러 '홈 화면에 추가'한 후, 홈 화면의 GOGO 매니저 앱을 실행하여 알림을 켜주세요.");
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        App.ui.toast("🔔 실시간 푸시 알림이 켜졌습니다!");
        this.sendLocalNotification(
          "🚗 GOGO 매니저 알림 연동 완료",
          "가족의 새로운 일정, 주차 위치, 장보기 소식이 실시간으로 전달됩니다."
        );
      } else {
        alert("알림 권한이 차단되었습니다. 기기 설정에서 알림을 허용해주세요.");
      }
      this.updatePushUI();
    } catch (e) {
      console.error("알림 권한 요청 오류:", e);
    }
  },

  /* 📲 기기 상단 배너 알림 발송 */
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
      try {
        new Notification(title, {
          body: body,
          icon: 'https://cdn-icons-png.flaticon.com/512/854/854878.png'
        });
      } catch (e) {
        console.warn("표준 Notification 실행 실패:", e);
      }
    }
  },

  /* 1번 요구사항: 알람 켜짐 영구 고정 UI */
  updatePushUI() {
    const btn = document.getElementById('btnPushToggle');
    if (!btn) return;

    if ('Notification' in window && Notification.permission === 'granted') {
      btn.innerText = '🔔 알림 ON';
      btn.classList.add('push-active');
    } else {
      btn.innerText = '🔔 알림 켜기';
      btn.classList.remove('push-active');
    }
  }
};
