/**
 * 🚗 GOGO 스마트 매니저 - 주차 모듈 (AI 인식 + 수동 완벽 수정 지원)
 */

// 1. 실사 기반 확정 층별 색상 테이블
const FLOOR_COLOR_MAP = [
  { floor: 'B1', name: '스카이블루', hMin: 175, hMax: 215, sMin: 0.25, vMin: 0.40 },
  { floor: 'B2', name: '웜옐로우',   hMin: 35,  hMax: 58,  sMin: 0.35, vMin: 0.45 },
  { floor: 'B3', name: '라임그린',   hMin: 65,  hMax: 105, sMin: 0.30, vMin: 0.40 }
];

// 임시 인식 결과 저장 객체
let pendingDetection = {
  type: 'underground',
  car: 'x1',
  floor: 'B1',
  column: 'A',
  number: 1,
  memo: ''
};

// 현재 선택된 GPS 좌표 저장용
let currentGPS = null;

/**
 * 주차 모듈 초기화 (app.js에서 호출)
 */
export function initParkingModule() {
  bindUIEvents();
  loadLatestParkingLogs();
}

/**
 * 모든 UI 이벤트 리스너 바인딩
 */
function bindUIEvents() {
  const scanBtn = document.getElementById('btn-scan-parking');
  const fileInput = document.getElementById('parking-photo-input');
  const formUnderground = document.getElementById('form-underground');
  const formOutdoor = document.getElementById('form-outdoor');
  const btnModalSave = document.getElementById('btn-modal-save');
  const btnModalEdit = document.getElementById('btn-modal-edit');
  const btnGetGPS = document.getElementById('btn-get-gps');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const carRadios = document.querySelectorAll('input[name="target-car"]');

  // 1. 카메라 사진 업로드
  if (scanBtn && fileInput) {
    scanBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleParkingPhotoUpload);
  }

  // 2. 모달 버튼
  if (btnModalSave) {
    btnModalSave.addEventListener('click', async () => {
      closeParkingModal();
      await saveParkingToBackend(pendingDetection);
    });
  }

  // 💡 [수동 수정하기 클릭 시]: 모달만 닫고 폼으로 부드럽게 스크롤 포커스
  if (btnModalEdit) {
    btnModalEdit.addEventListener('click', () => {
      closeParkingModal();
      applyDataToForm(pendingDetection);
      
      const numInput = document.getElementById('parking-number-input');
      if (numInput) {
        numInput.focus();
        numInput.select();
      }
    });
  }

  // 3. 지하 주차장 수동 저장 폼 제출
  if (formUnderground) {
    formUnderground.addEventListener('submit', async (e) => {
      e.preventDefault();
      const car = getSelectedCar();
      const floor = document.getElementById('parking-floor-select').value;
      const column = document.getElementById('parking-column-select').value;
      const number = parseInt(document.getElementById('parking-number-input').value, 10);
      const memo = document.getElementById('parking-memo-input').value.trim();

      const record = {
        type: 'underground',
        car,
        floor,
        column,
        number,
        memo,
        display_text: `${floor} ${column}열 ${number}번${memo ? ` (${memo})` : ''}`,
        updated_at: new Date().toISOString()
      };

      await saveParkingToBackend(record);
    });
  }

  // 4. 야외 주차장 폼 제출
  if (formOutdoor) {
    formOutdoor.addEventListener('submit', async (e) => {
      e.preventDefault();
      const car = getSelectedCar();
      const locationDesc = document.getElementById('outdoor-location-input').value.trim();

      const record = {
        type: 'outdoor',
        car,
        floor: '야외',
        column: '',
        number: '',
        location_desc: locationDesc,
        gps: currentGPS,
        display_text: `야외 (${locationDesc})`,
        updated_at: new Date().toISOString()
      };

      await saveParkingToBackend(record);
    });
  }

  // 5. 야외 GPS 위치 획득
  if (btnGetGPS) {
    btnGetGPS.addEventListener('click', getCurrentGPSLocation);
  }

  // 6. 지하/야외 탭 전환
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const isUnderground = btn.dataset.type === 'underground';
      document.getElementById('form-underground').style.display = isUnderground ? 'block' : 'none';
      document.getElementById('form-outdoor').style.display = isUnderground ? 'none' : 'block';
    });
  });

  // 7. 차종 변경 시 최신 상태 갱신
  carRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      updateCurrentBadge(radio.value);
    });
  });
}

/**
 * 📷 AI 사진 분석 파이프라인
 */
async function handleParkingPhotoUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const statusBox = document.getElementById('ocr-status-box');
  const statusText = document.getElementById('ocr-status-text');

  if (statusBox) statusBox.style.display = 'flex';
  if (statusText) statusText.innerText = '이미지 최적화 중...';

  try {
    // 1단계: Canvas 가로 800px 리사이징
    const canvas = await resizeImageToCanvas(file, 800);

    // 2단계: 기둥 상단 HSV 분석으로 층수 판별
    if (statusText) statusText.innerText = '기둥 색상(층수) 분석 중...';
    const detectedFloor = analyzePillarColor(canvas) || 'B1';

    // 3단계: Tesseract OCR로 숫자와 알파벳 판독
    if (statusText) statusText.innerText = '구역 번호 판독 중... (0%)';
    const ocrResult = await recognizePillarText(canvas, (progress) => {
      if (statusText) statusText.innerText = `구역 번호 판독 중... (${Math.round(progress * 100)}%)`;
    });

    const targetCar = getSelectedCar();

    // 4단계: 감지 데이터 조합
    pendingDetection = {
      type: 'underground',
      car: targetCar,
      floor: ocrResult.floor || detectedFloor,
      column: ocrResult.column || 'A',
      number: ocrResult.number || 1,
      memo: ''
    };

    // 💡 [핵심]: 모달이 뜨는 동시에 기존 수동 입력 폼에도 감지된 값을 즉시 동기화!
    applyDataToForm(pendingDetection);

    if (statusBox) statusBox.style.display = 'none';

    // 5단계: 결과 확인 모달 표시
    openParkingModal(pendingDetection);

  } catch (error) {
    console.error('사진 분석 실패:', error);
    if (statusText) statusText.innerText = '인식에 실패했습니다. 수동 입력을 이용해주세요.';
    setTimeout(() => {
      if (statusBox) statusBox.style.display = 'none';
    }, 2500);
  } finally {
    event.target.value = '';
  }
}

/**
 * 폼 요소에 데이터 즉시 반영 (Pre-fill)
 */
function applyDataToForm(data) {
  // 지하 탭 활성화
  const undergroundTab = document.querySelector('.tab-btn[data-type="underground"]');
  if (undergroundTab) undergroundTab.click();

  const floorEl = document.getElementById('parking-floor-select');
  const colEl = document.getElementById('parking-column-select');
  const numEl = document.getElementById('parking-number-input');

  if (floorEl && data.floor) floorEl.value = data.floor;
  if (colEl && data.column) colEl.value = data.column;
  if (numEl && data.number) numEl.value = data.number;
}

/**
 * Canvas 리사이징
 */
function resizeImageToCanvas(file, maxWidth = 800) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas);
    };
    img.onerror = reject;
  });
}

/**
 * 기둥 상단 HSV 분석
 */
function analyzePillarColor(canvas) {
  const ctx = canvas.getContext('2d');
  const startX = Math.floor(canvas.width * 0.30);
  const startY = Math.floor(canvas.height * 0.15);
  const sampleW = Math.floor(canvas.width * 0.40);
  const sampleH = Math.floor(canvas.height * 0.30);

  const imgData = ctx.getImageData(startX, startY, sampleW, sampleH).data;
  let totalH = 0, totalS = 0, totalV = 0, validPixelCount = 0;

  for (let i = 0; i < imgData.length; i += 16) {
    const [h, s, v] = rgbToHsv(imgData[i], imgData[i + 1], imgData[i + 2]);
    if (s > 0.20 && v > 0.30 && v < 0.88) {
      totalH += h;
      totalS += s;
      totalV += v;
      validPixelCount++;
    }
  }

  if (validPixelCount === 0) return null;

  const avgH = totalH / validPixelCount;
  const avgS = totalS / validPixelCount;
  const avgV = totalV / validPixelCount;

  const matched = FLOOR_COLOR_MAP.find(cfg => 
    avgH >= cfg.hMin && avgH <= cfg.hMax && avgS >= cfg.sMin && avgV >= cfg.vMin
  );

  return matched ? matched.floor : null;
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, v];
}

/**
 * Tesseract OCR 판독
 */
async function recognizePillarText(canvas, onProgress) {
  if (typeof Tesseract === 'undefined') {
    throw new Error('Tesseract CDN 미로드');
  }

  const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    }
  });

  const cleanText = text.replace(/[^A-Za-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

  // 상단 숫자 + 하단 알파벳 ("16 B", "45 B", "23 A")
  const numThenAlpha = cleanText.match(/([0-9]{1,2})\s+([A-Z])/);
  if (numThenAlpha) {
    return { floor: null, column: numThenAlpha[2], number: parseInt(numThenAlpha[1], 10) };
  }

  // 알파벳 + 숫자 ("A 23", "B16")
  const alphaThenNum = cleanText.match(/([A-Z])\s*([0-9]{1,2})/);
  if (alphaThenNum) {
    return { floor: null, column: alphaThenNum[1], number: parseInt(alphaThenNum[2], 10) };
  }

  return { floor: null, column: null, number: null };
}

/**
 * GPS 위치 획득 함수
 */
function getCurrentGPSLocation() {
  const gpsStatus = document.getElementById('gps-status-text');
  if (!navigator.geolocation) {
    if (gpsStatus) gpsStatus.innerText = '이 브라우저는 GPS를 지원하지 않습니다.';
    return;
  }

  if (gpsStatus) gpsStatus.innerText = '위치 탐색 중...';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentGPS = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      if (gpsStatus) gpsStatus.innerText = `📍 GPS 획득 완료 (정확도: ±${Math.round(pos.coords.accuracy)}m)`;
    },
    (err) => {
      console.warn('GPS 오류:', err);
      if (gpsStatus) gpsStatus.innerText = 'GPS 위치를 가져올 수 없습니다 (권한 확인 필요).';
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/**
 * 모달 제어
 */
function openParkingModal(data) {
  const modal = document.getElementById('parking-modal');
  const badge = document.getElementById('modal-detected-badge');
  const loc = document.getElementById('modal-detected-location');
  const carInfo = document.getElementById('modal-detected-car');

  if (badge) badge.innerText = `지하 ${data.floor.replace('B', '')}층 (${data.floor})`;
  if (loc) loc.innerText = `${data.column}열 ${data.number}번`;
  if (carInfo) carInfo.innerText = `차량: ${data.car === 'x1' ? 'BMW X1' : '엑센트'}`;

  if (modal) modal.style.display = 'flex';
}

function closeParkingModal() {
  const modal = document.getElementById('parking-modal');
  if (modal) modal.style.display = 'none';
}

function getSelectedCar() {
  return document.querySelector('input[name="target-car"]:checked')?.value || 'x1';
}

/**
 * Firebase Realtime Database 저장 및 캐싱
 */
async function saveParkingToBackend(record) {
  const { car } = record;
  const payload = {
    ...record,
    display_text: record.display_text || `${record.floor} ${record.column}열 ${record.number}번`,
    updated_at: new Date().toISOString()
  };

  try {
    const dbUrl = `https://YOUR-FIREBASE-PROJECT-ID.firebaseio.com/parking_logs/${car}.json`;
    const res = await fetch(dbUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('서버 저장 응답 오류');

    localStorage.setItem(`parking_${car}`, JSON.stringify(payload));
    alert(`✅ [${car.toUpperCase()}] ${payload.display_text} 저장 완료!`);
    updateCurrentBadge(car);

  } catch (error) {
    console.error('Firebase 통신 오류:', error);
    localStorage.setItem(`parking_${car}`, JSON.stringify(payload));
    alert(`⚠️ 오프라인 저장: [${car.toUpperCase()}] ${payload.display_text}`);
    updateCurrentBadge(car);
  }
}

/**
 * 상단 현재 주차 상태 뱃지 갱신
 */
function updateCurrentBadge(car) {
  const badgeEl = document.getElementById('parking-current-badge');
  if (!badgeEl) return;

  const cached = localStorage.getItem(`parking_${car}`);
  if (cached) {
    try {
      const data = JSON.parse(cached);
      badgeEl.innerText = `${car.toUpperCase()}: ${data.display_text}`;
    } catch {
      badgeEl.innerText = `${car.toUpperCase()}: 기록 없음`;
    }
  } else {
    badgeEl.innerText = `${car.toUpperCase()}: 기록 없음`;
  }
}

function loadLatestParkingLogs() {
  updateCurrentBadge(getSelectedCar());
}
