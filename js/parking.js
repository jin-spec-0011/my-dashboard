/**
 * GOGO 스마트 매니저 - 주차 위치 로거 엔진
 * - 스키마 준수: /parking_logs.json
 * - 14자리 KST 타임스탬프 규격 및 이기종(13자리 ms) 타임스탬프 통합 파서 적용
 * - 차량별 최신 2개 유지 및 실시간 최신 상태 산출
 */

const ParkingModule = (() => {
  let parkingLogs = [];
  let currentFilter = 'ALL'; // ALL, X1, ACCENT
  let selectedCar = 'X1';
  let selectedType = '지하 주차장';
  let selectedFloor = 'B1';

  // 타임스탬프 완전 정규화 (14자리 yyyyMMddHHmmss vs 13자리 Epoch ms 통합)
  function normalizeParkingTimestamp(item) {
    if (!item) return 0;

    // 1. item.id가 14자리 정수 규격인 경우 (예: 20261024215500)
    if (item.id) {
      const idStr = String(item.id).trim();
      if (idStr.length === 14 && idStr.startsWith('20')) {
        const y = parseInt(idStr.substring(0, 4), 10);
        const m = parseInt(idStr.substring(4, 6), 10) - 1;
        const d = parseInt(idStr.substring(6, 8), 10);
        const h = parseInt(idStr.substring(8, 10), 10);
        const min = parseInt(idStr.substring(10, 12), 10);
        const s = parseInt(idStr.substring(12, 14), 10);
        return new Date(y, m, d, h, min, s).getTime();
      }
      // 2. item.id가 13자리 ms인 경우 (예: Date.now())
      if (idStr.length === 13 && !isNaN(Number(idStr))) {
        return Number(idStr);
      }
    }

    // 3. time 문자열 파싱 (예: "10월 27일 16:43")
    if (item.time) {
      const match = item.time.match(/(\d+)월\s*(\d+)일\s*(\d+):(\d+)/);
      if (match) {
        const now = new Date();
        const year = now.getFullYear();
        const m = parseInt(match[1], 10) - 1;
        const d = parseInt(match[2], 10);
        const h = parseInt(match[3], 10);
        const min = parseInt(match[4], 10);
        return new Date(year, m, d, h, min, 0).getTime();
      }
    }

    return Number(item.id) || 0;
  }

  // 규격 준수: KST 기준 14자리 숫자 생성 (yyyyMMddHHmmss)
  function generate14DigitKstId() {
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kstTime = new Date(utcTime + (9 * 60 * 60000));

    const yyyy = kstTime.getFullYear();
    const MM = String(kstTime.getMonth() + 1).padStart(2, '0');
    const dd = String(kstTime.getDate()).padStart(2, '0');
    const HH = String(kstTime.getHours()).padStart(2, '0');
    const mm = String(kstTime.getMinutes()).padStart(2, '0');
    const ss = String(kstTime.getSeconds()).padStart(2, '0');

    return Number(`${yyyy}${MM}${dd}${HH}${mm}${ss}`);
  }

  // 한국어 표시 시간 포맷 (M월 d일 HH:mm)
  function formatKoreanTime() {
    const now = new Date();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${m}월 ${d}일 ${h}:${min}`;
  }

  // 초기화 및 실시간 리스너 연결
  function init() {
    bindEvents();
    subscribeParkingData();
  }

  function subscribeParkingData() {
    try {
      const dbRef = firebase.database().ref('parking_logs');
      dbRef.on('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
          parkingLogs = [];
          renderList();
          return;
        }

        // Object to Array 변환
        const list = Object.keys(data).map((key) => {
          const item = data[key];
          return {
            firebaseKey: key,
            id: item.id || key,
            car: item.car || '',
            floor: item.floor || '',
            slot: item.slot || '',
            text: item.text || '',
            author: item.author || '진세',
            time: item.time || '',
            type: item.type || '지하 주차장',
            photo: item.photo || null
          };
        });

        // 정규화된 타임스탬프 기준 완전 내림차순 정렬
        list.sort((a, b) => normalizeParkingTimestamp(b) - normalizeParkingTimestamp(a));
        parkingLogs = list;

        // 차량별 최신 2개 초과 기록 자동 정리 로직 (정책 유지)
        pruneOldRecords(list);

        renderList();
      }, (error) => {
        console.error('Firebase 주차 데이터 동기화 에러:', error);
      });
    } catch (e) {
      console.error('Firebase 연결 실패:', e);
    }
  }

  // 차량별 최신 2건 초과 데이터 자동 삭제
  function pruneOldRecords(sortedList) {
    const cars = ['X1', '엑센트'];
    cars.forEach((carName) => {
      const carItems = sortedList.filter((item) => item.car === carName);
      if (carItems.length > 2) {
        for (let i = 2; i < carItems.length; i++) {
          const target = carItems[i];
          if (target.firebaseKey) {
            firebase.database().ref(`parking_logs/${target.firebaseKey}`).remove().catch((err) => {
              console.warn('초과 주차 데이터 정리 실패:', err);
            });
          }
        }
      }
    });
  }

  function renderList() {
    const container = document.getElementById('parking-record-list');
    if (!container) return;

    // 필터링 적용
    let filtered = parkingLogs;
    if (currentFilter === 'X1') {
      filtered = parkingLogs.filter((item) => item.car === 'X1');
    } else if (currentFilter === 'ACCENT') {
      filtered = parkingLogs.filter((item) => item.car === '엑센트');
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding: 24px; color: #94a3b8; font-size: 13px;">기록된 주차 정보가 없습니다.</div>';
      return;
    }

    // 각 차량별 최신 항목 식별 (정규화 타임스탬프 기준 1위)
    let latestX1Key = null;
    let latestAccentKey = null;

    const x1First = parkingLogs.find((item) => item.car === 'X1');
    if (x1First) latestX1Key = x1First.firebaseKey;

    const accentFirst = parkingLogs.find((item) => item.car === '엑센트');
    if (accentFirst) latestAccentKey = accentFirst.firebaseKey;

    let html = '';
    filtered.forEach((item) => {
      const isX1 = item.car === 'X1';
      const carBullet = isX1 ? '⚪' : '⚫';
      const isLatest = (isX1 && item.firebaseKey === latestX1Key) || (!isX1 && item.firebaseKey === latestAccentKey);

      html += `
        <div class="record-item">
          <div class="record-info">
            <div class="record-main-text">
              <span>${carBullet} ${escapeHtml(item.text)}</span>
              ${isLatest ? '<span class="badge-latest">⭐ 최신 주차</span>' : ''}
            </div>
            <div class="record-sub-text">
              🕒 ${escapeHtml(item.time)} · 등록: ${escapeHtml(item.author)}
            </div>
          </div>
          <button class="btn-item-delete" onclick="ParkingModule.deleteRecord('${item.firebaseKey}')" title="삭제">✕</button>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  function saveParkingLocation() {
    const slotInput = document.getElementById('input-parking-slot');
    const slotValue = slotInput ? slotInput.value.trim().toUpperCase() : '';

    if (!slotValue) {
      alert('기둥 번호와 구역을 정확히 입력하세요.');
      return;
    }

    const newId = generate14DigitKstId();
    const formattedTime = formatKoreanTime();
    const currentModeAuthor = localStorage.getItem('GOGO_CURRENT_USER') || '진세';
    const locationText = `${selectedCar} - ${selectedFloor}-${slotValue}`;

    const newPayload = {
      id: newId,
      car: selectedCar,
      floor: selectedFloor,
      slot: slotValue,
      text: locationText,
      author: currentModeAuthor,
      time: formattedTime,
      type: selectedType
    };

    const targetRef = firebase.database().ref(`parking_logs/${newId}`);
    targetRef.set(newPayload).then(() => {
      if (slotInput) slotInput.value = '';
      alert(`${locationText} 위치가 정상 등록되었습니다.`);
    }).catch((err) => {
      console.error('주차 위치 저장 실패:', err);
      alert('저장 중 오류가 발생했습니다.');
    });
  }

  function deleteRecord(key) {
    if (!confirm('해당 주차 기록을 삭제하시겠습니까?')) return;
    firebase.database().ref(`parking_logs/${key}`).remove().catch((err) => {
      console.error('주차 기록 삭제 오류:', err);
    });
  }

  function deleteAllRecords() {
    if (!confirm('차량별 모든 주차 기록을 영구 삭제하시겠습니까?')) return;
    firebase.database().ref('parking_logs').remove().then(() => {
      alert('모든 주차 기록이 초기화되었습니다.');
    }).catch((err) => {
      console.error('전체 삭제 실패:', err);
    });
  }

  function bindEvents() {
    // 차량 토글
    document.querySelectorAll('.car-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.car-select-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        selectedCar = e.currentTarget.getAttribute('data-car');
      });
    });

    // 층수 토글
    document.querySelectorAll('.floor-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.floor-select-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        selectedFloor = e.currentTarget.getAttribute('data-floor');
      });
    });

    // 필터 버튼
    document.querySelectorAll('.parking-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.parking-filter-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentFilter = e.currentTarget.getAttribute('data-filter');
        renderList();
      });
    });

    // 저장 버튼
    const saveBtn = document.getElementById('btn-save-parking');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveParkingLocation);
    }

    // 전체 삭제 버튼
    const deleteAllBtn = document.getElementById('btn-delete-all-parking');
    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', deleteAllRecords);
    }
  }

  function escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    init,
    deleteRecord,
    normalizeParkingTimestamp
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  ParkingModule.init();
});
