/**
 * 📱 GOGO 스마트 매니저 - 코어 엔진 (app.js)
 * Firebase 실시간 동기화, 라우터, 전광판 롤링, 뱃지 관리
 */

window.App = window.App || {};

// 1. ⚠️ 본인의 Firebase 프로젝트 설정값으로 교체해주세요!
const firebaseConfig = {
  apiKey: "AIzaSyBGYhPPlYfPnnEnqa--Sl_OYDw8VmX1fus",
  authDomain: "gogo-manager-f0a68.firebaseapp.com",
  databaseURL: "https://gogo-manager-f0a68-default-rtdb.firebaseio.com",
  projectId: "gogo-manager-f0a68",
  storageBucket: "gogo-manager-f0a68.firebasestorage.app",
  messagingSenderId: "1016084163074",
  appId: "1:1016084163074:web:836b8517d023638e12551b"
};


// 2. Firebase 초기화 & 실시간 DB 인스턴스
let db = null;
let isFirebaseReady = false;

try {
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();
    isFirebaseReady = true;
  }
} catch (e) {
  console.warn("Firebase 초기화 대기 (로컬 모드로 작동):", e);
}

// 3. 전역 상태 관리
App.state = {
  currentScreen: 'home',
  tickerItems: ['환영합니다! GOGO 스마트 매니저입니다.'],
  tickerIndex: 0,
  tickerTimer: null
};

// 4. 화면 전환 라우터
App.router = {
  go(screenName) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`screen-${screenName}`);
    if (target) {
      target.classList.add('active');
      App.state.currentScreen = screenName;
      window.scrollTo(0, 0);

      // 각 모듈 화면 진입 시 초기화/새로고침
      if (screenName === 'parking' && App.parking?.refresh) App.parking.refresh();
      if (screenName === 'calendar' && App.calendar?.generate) App.calendar.generate();
      if (screenName === 'memo' && App.memo?.render) App.memo.render();
      if (screenName === 'trip' && App.trip?.render) App.trip.render();
    }
  }
};

// 5. 공통 UI 유틸
App.ui = {
  toast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  },
  alertReady(featureName) {
    alert(`🚧 '${featureName}' 기능은 현재 준비 중입니다.`);
  }
};

// 6. 실시간 전광판 & 연결 상태 감지 엔진
function initNetworkAndTicker() {
  const statusBadge = document.getElementById('cloudStatusBadge');

  // Firebase 실시간 온라인/오프라인 상태 감지
  if (isFirebaseReady && db) {
    db.ref('.info/connected').on('value', (snap) => {
      if (snap.val() === true) {
        if (statusBadge) {
          statusBadge.innerText = '☁️ 클라우드 연동';
          statusBadge.classList.add('cloud-active');
        }
        listenRealtimeUpdates(); // 실시간 데이터 수신 시작
      } else {
        if (statusBadge) {
          statusBadge.innerText = '📱 로컬 모드';
          statusBadge.classList.remove('cloud-active');
        }
        loadLocalFallbackData();
      }
    });
  } else {
    loadLocalFallbackData();
  }

  startTickerRolling();
}

// Firebase 실시간 데이터 구독 (주차 위치, 장보기 미완료, 여행 등)
function listenRealtimeUpdates() {
  if (!db) return;

  // 1) 주차 정보 실시간 갱신
  db.ref('parking_logs').on('value', (snap) => {
    const data = snap.val() || {};
    if (data.x1) localStorage.setItem('parking_x1', JSON.stringify(data.x1));
    if (data.accent) localStorage.setItem('parking_accent', JSON.stringify(data.accent));
    updateTickerData();
  });

  // 2) 할 일/장보기 실시간 갱신
  db.ref('family_todos').on('value', (snap) => {
    const todos = snap.val() || [];
    localStorage.setItem('family_todos', JSON.stringify(todos));
    updateTickerData();
  });
}

function loadLocalFallbackData() {
  updateTickerData();
}

// 전광판 문구 생성
function updateTickerData() {
  const items = [];
  
  // 주차 위치 정보
  const pX1 = localStorage.getItem('parking_x1');
  const pAcc = localStorage.getItem('parking_accent');
  
  if (pX1) {
    try { items.push(`🚗 [X1] ${JSON.parse(pX1).display_text}`); } catch(e){}
  }
  if (pAcc) {
    try { items.push(`🚙 [엑센트] ${JSON.parse(pAcc).display_text}`); } catch(e){}
  }

  // 장보기 미완료 목록
  const todosRaw = localStorage.getItem('family_todos');
  if (todosRaw) {
    try {
      const list = JSON.parse(todosRaw);
      const pending = list.filter(t => !t.completed);
      if (pending.length > 0) {
        items.push(`🛒 장보기 남은 항목: ${pending.map(p => p.text).slice(0, 3).join(', ')} (${pending.length}건)`);
      }
    } catch(e){}
  }

  // 기본 문구
  if (items.length === 0) {
    items.push('오늘도 좋은 하루 되세요! 🌟');
  }

  App.state.tickerItems = items;
  renderTickerText();
}

// 3.5초 간격 세로 롤링 전광판 애니메이션
function startTickerRolling() {
  if (App.state.tickerTimer) clearInterval(App.state.tickerTimer);

  App.state.tickerTimer = setInterval(() => {
    const tickerEl = document.getElementById('tickerVerticalText');
    if (!tickerEl || App.state.tickerItems.length <= 1) return;

    // 슬라이드 다운 아웃
    tickerEl.classList.add('slide-down-out');

    setTimeout(() => {
      App.state.tickerIndex = (App.state.tickerIndex + 1) % App.state.tickerItems.length;
      tickerEl.innerText = App.state.tickerItems[App.state.tickerIndex];
      
      tickerEl.classList.remove('slide-down-out');
      tickerEl.classList.add('slide-down-in');

      setTimeout(() => {
        tickerEl.classList.remove('slide-down-in');
      }, 50);
    }, 450);
  }, 3500);
}

function renderTickerText() {
  const tickerEl = document.getElementById('tickerVerticalText');
  if (tickerEl && App.state.tickerItems.length > 0) {
    tickerEl.innerText = App.state.tickerItems[App.state.tickerIndex % App.state.tickerItems.length];
  }
}

// 오늘 날짜 상단 표기 갱신
function updateHomeDate() {
  const dateEl = document.getElementById('homeTodayDate');
  if (!dateEl) return;
  const now = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  dateEl.innerText = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
}

// DOM 준비 완료 시 실행
document.addEventListener('DOMContentLoaded', () => {
  updateHomeDate();
  initNetworkAndTicker();
});
