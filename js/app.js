/**
 * GOGO 스마트 매니저 - 메인 오케스트레이터 및 대시보드 동기화 엔진
 * - 하단 잔류 알림 로그 완전 차단
 * - 대시보드 주차 카드: 정규화 타임스탬프 기준 최신 위치 실시간 동기화
 * - 모드 전환(공용, 진세, 지혜) 및 서브 뷰 라우팅
 */

const AppManager = (() => {
  let currentUserMode = localStorage.getItem('GOGO_CURRENT_USER') || '진세';

  function init() {
    setupDateDisplay();
    setupModeSelector();
    setupNavigation();
    bindDashboardListeners();
  }

  // 상단 날짜 출력
  function setupDateDisplay() {
    const dateEl = document.getElementById('header-display-date');
    if (!dateEl) return;
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const day = days[now.getDay()];
    dateEl.textContent = `${y}년 ${m}월 ${d}일 (${day})`;
  }

  // 모드 전환 바 (공용, 진세, 지혜)
  function setupModeSelector() {
    const buttons = document.querySelectorAll('.mode-btn');
    const modeLabel = document.getElementById('current-mode-label');

    buttons.forEach((btn) => {
      const mode = btn.getAttribute('data-mode');
      if (mode === currentUserMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }

      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentUserMode = mode;
        localStorage.setItem('GOGO_CURRENT_USER', mode);
        if (modeLabel) {
          modeLabel.textContent = mode === '공용' ? '가족 공용 모드' : `${mode} 전용 모드`;
        }
      });
    });

    if (modeLabel) {
      modeLabel.textContent = currentUserMode === '공용' ? '가족 공용 모드' : `${currentUserMode} 전용 모드`;
    }
  }

  // 뷰 라우터 (대시보드 <-> 서브페이지)
  function setupNavigation() {
    const views = document.querySelectorAll('.app-view');
    const cards = document.querySelectorAll('.dashboard-nav-card');
    const backButtons = document.querySelectorAll('.btn-nav-back');

    cards.forEach((card) => {
      card.addEventListener('click', () => {
        const targetViewId = card.getAttribute('data-target-view');
        if (!targetViewId) return;

        views.forEach((v) => (v.style.display = 'none'));
        const target = document.getElementById(targetViewId);
        if (target) {
          target.style.display = 'block';
          window.scrollTo(0, 0);
        }
      });
    });

    backButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        views.forEach((v) => (v.style.display = 'none'));
        const dashboard = document.getElementById('view-dashboard');
        if (dashboard) {
          dashboard.style.display = 'block';
          window.scrollTo(0, 0);
        }
      });
    });
  }

  // 대시보드 실시간 Firebase 위젯 리스너
  function bindDashboardListeners() {
    bindParkingWidget();
    bindScheduleWidget();
    bindShoppingWidget();
    bindLedgerWidget();
  }

  // 대시보드 주차 카드 최신 위치 정밀 바인딩
  function bindParkingWidget() {
    const x1Pill = document.getElementById('dash-parking-x1');
    const accentPill = document.getElementById('dash-parking-accent');

    try {
      const dbRef = firebase.database().ref('parking_logs');
      dbRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          if (x1Pill) x1Pill.textContent = '⚪ 미등록';
          if (accentPill) accentPill.textContent = '⚫ 미등록';
          return;
        }

        const list = Object.keys(data).map((k) => ({
          ...data[k],
          firebaseKey: k
        }));

        // ParkingModule의 타임스탬프 정규화 함수를 적용하여 정렬
        list.sort((a, b) => {
          const tA = ParkingModule ? ParkingModule.normalizeParkingTimestamp(a) : Number(a.id);
          const tB = ParkingModule ? ParkingModule.normalizeParkingTimestamp(b) : Number(b.id);
          return tB - tA;
        });

        // X1 최신 추출
        const latestX1 = list.find((item) => item.car === 'X1');
        if (latestX1 && x1Pill) {
          const slotText = latestX1.floor && latestX1.slot ? `${latestX1.floor}-${latestX1.slot}` : latestX1.text;
          x1Pill.textContent = `⚪ ${slotText}`;
        } else if (x1Pill) {
          x1Pill.textContent = '⚪ 미등록';
        }

        // 엑센트 최신 추출
        const latestAccent = list.find((item) => item.car === '엑센트');
        if (latestAccent && accentPill) {
          const slotText = latestAccent.floor && latestAccent.slot ? `${latestAccent.floor}-${latestAccent.slot}` : latestAccent.text;
          accentPill.textContent = `⚫ ${slotText}`;
        } else if (accentPill) {
          accentPill.textContent = '⚫ 미등록';
        }
      });
    } catch (err) {
      console.warn('대시보드 주차 연동 대기 중:', err);
    }
  }

  // 일정 위젯 바인딩
  function bindScheduleWidget() {
    const scheduleSummary = document.getElementById('dash-schedule-summary');
    if (!scheduleSummary) return;

    try {
      firebase.database().ref('schedules').limitToLast(5).on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          scheduleSummary.textContent = '등록된 일정 없음';
          return;
        }

        const items = Object.values(data);
        const latest = items[items.length - 1];
        if (latest) {
          scheduleSummary.textContent = `[${latest.author || '가족'}] ${latest.title || latest.text || '일정'}`;
        }
      });
    } catch (e) {}
  }

  // 장보기 위젯 바인딩
  function bindShoppingWidget() {
    const shoppingSummary = document.getElementById('dash-shopping-summary');
    if (!shoppingSummary) return;

    try {
      firebase.database().ref('shopping').on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          shoppingSummary.textContent = '장보기 품목 없음';
          return;
        }
        const items = Object.values(data).filter((item) => !item.checked);
        if (items.length === 0) {
          shoppingSummary.textContent = '모두 구매 완료';
        } else {
          const first = items[0].name || items[0].text;
          const count = items.length;
          shoppingSummary.textContent = count > 1 ? `${first} 외 ${count - 1}개` : first;
        }
      });
    } catch (e) {}
  }

  // 가계부 위젯 바인딩
  function bindLedgerWidget() {
    const ledgerSummary = document.getElementById('dash-ledger-summary');
    if (!ledgerSummary) return;

    try {
      const currentMonth = new Date().getMonth() + 1;
      firebase.database().ref('ledger').on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          ledgerSummary.textContent = `${currentMonth}월 0원 지출`;
          return;
        }
        let total = 0;
        Object.values(data).forEach((item) => {
          if (item.amount && !isNaN(item.amount)) {
            total += Number(item.amount);
          }
        });
        ledgerSummary.textContent = `${currentMonth}월 ${total.toLocaleString()}원 지출`;
      });
    } catch (e) {}
  }

  return {
    init
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  AppManager.init();
});
