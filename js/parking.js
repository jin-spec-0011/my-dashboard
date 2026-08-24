/**
 * 🚗 GOGO 스마트 매니저 - 주차 관리 모듈 (AI 기둥 인식 + 수동 완벽 보정)
 * - 지하 1층: 스카이블루 (175~215°)
 * - 지하 2층: 웜 옐로우 (35~58°)
 * - 지하 3층: 라임 그린 (65~105°)
 */

// 전역 App 네임스페이스 초기화
window.App = window.App || {};

(function () {
  // 1. 실사 기반 확정 층별 색상 테이블
  const FLOOR_COLOR_MAP = [
    { floor: 'B1', name: '지하 1층 (스카이블루)', hMin: 175, hMax: 215, sMin: 0.25, vMin: 0.40 },
    { floor: 'B2', name: '지하 2층 (웜옐로우)',   hMin: 35,  hMax: 58,  sMin: 0.35, vMin: 0.45 },
    { floor: 'B3', name: '지하 3층 (라임그린)',   hMin: 65,  hMax: 105, sMin: 0.30, vMin: 0.40 }
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

  // 야외 GPS 임시 좌표
  let currentGPS = null;

  /**
   * 주차 모듈 초기화
   */
  function init() {
    bindUIEvents();
    renderParkingLogs();
  }

  /**
   * 이벤트 리스너 등록
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
      fileInput.addEventListener('change', handlePhotoUpload);
    }

    // 2. 모달 버튼
    if (btnModalSave) {
      btnModalSave.addEventListener('click', async () => {
        closeModal();
        await saveParking(pendingDetection);
      });
    }

    if (btnModalEdit) {
      btnModalEdit.addEventListener('click', () => {
        closeModal();
        applyDataToForm(pendingDetection);
        const numInput = document.getElementById('parking-number-input');
        if (numInput) {
          numInput.focus();
          numInput.select();
        }
      });
    }

    // 3. 지하 주차장 수동 폼 저장
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

        await saveParking(record);
      });
    }

    // 4. 야외 주차장 폼 저장
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

        await saveParking(record);
      });
    }

    // 5. GPS 위치 획득
    if (btnGetGPS) {
      btnGetGPS.addEventListener('click', getGPSLocation);
    }

    // 6. 지하/야외 탭 전환
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const isUnderground = btn.dataset.type === 'underground';
        const undergroundForm = document.getElementById('form-underground');
        const outdoorForm = document.getElementById('form-outdoor');

        if (undergroundForm) undergroundForm.style.display = isUnderground ? 'block' : 'none';
        if (outdoorForm) outdoorForm.style.display = isUnderground ? 'none' : 'block';
      });
    });

    // 7. 차종 라디오 변경
    carRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        renderParkingLogs();
      });
    });
  }

  /**
   * 📷 사진 업로드 및 자동 분석 파이프라인
   */
  async function handlePhotoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const statusBox = document.getElementById('ocr-status-box');
    const statusText = document.getElementById('ocr-status-text');

    if (statusBox) statusBox.style.display = 'flex';
    if (statusText) statusText.innerText = '이미지 최적화 중...';

    try {
      // 1) Canvas 가로 800px 리사이징
      const canvas = await resizeImageToCanvas(file, 800);

      // 2) 기둥 상단 HSV 분석 (층수 감지)
      if (statusText) statusText.innerText = '기둥 색상(층수) 분석 중...';
      const detectedFloor = analyzePillarColor(canvas) || 'B1';

      // 3) Tesseract OCR 판독 (숫자 및 알파벳)
      if (statusText) statusText.innerText = '구역 번호 판독 중... (0%)';
      const ocrResult = await recognizePillarText(canvas, (progress) => {
        if (statusText) statusText.innerText = `구역 번호 판독 중... (${Math.round(progress * 100)}%)`;
      });

      const targetCar = getSelectedCar();

      // 4) 데이터 조합
      pendingDetection = {
        type: 'underground',
        car: targetCar,
        floor: ocrResult.floor || detectedFloor,
        column: ocrResult.column || 'A',
        number: ocrResult.number || 1,
        memo: ''
      };

      // 5) 수동 입력 폼에 즉시 Pre-fill
      applyDataToForm(pendingDetection);

      if (statusBox) statusBox.style.display = 'none';

      // 6) 모달 팝업 열기
      openModal(pendingDetection);

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
   * 폼 값 자동 세팅 (Pre-fill)
   */
  function applyDataToForm(data) {
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
   * 상단 15%~45% 영역 집중 샘플링 (B1/B2/B3 층수 판별)
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
   * Tesseract OCR 판독 (수직 패턴 매칭)
   */
  async function recognizePillarText(canvas, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract CDN이 로드되지 않았습니다.');
    }

    const { data: { text } } = await Tesseract.recognize(canvas, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(m.progress);
        }
      }
    });

    const cleanText = text.replace(/[^A-Za-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

    // 상단 숫자 + 하단 알파벳 ("16 B", "45 B", "23 A", "20 A")
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
   * GPS 위치 획득
   */
  function getGPSLocation() {
    const gpsStatus = document.getElementById('gps-status-text');
    if (!navigator.geolocation) {
      if (gpsStatus) gpsStatus.innerText = 'GPS를 지원하지 않는 브라우저입니다.';
      return;
    }

    if (gpsStatus) gpsStatus.innerText = '위치 수신 중...';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        currentGPS = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        if (gpsStatus) gpsStatus.innerText = `📍 GPS 확인 완료 (오차 ±${Math.round(pos.coords.accuracy)}m)`;
      },
      (err) => {
        console.warn('GPS 오류:', err);
        if (gpsStatus) gpsStatus.innerText = 'GPS 위치를 가져올 수 없습니다.';
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  /**
   * 모달 제어
   */
  function openModal(data) {
    const modal = document.getElementById('parking-modal');
    const badge = document.getElementById('modal-detected-badge');
    const loc = document.getElementById('modal-detected-location');
    const carInfo = document.getElementById('modal-detected-car');

    if (badge) badge.innerText = `지하 ${data.floor.replace('B', '')}층 (${data.floor})`;
    if (loc) loc.innerText = `${data.column}열 ${data.number}번`;
    if (carInfo) carInfo.innerText = `차량: ${data.car === 'x1' ? 'BMW X1' : '엑센트'}`;

    if (modal) modal.style.display = 'flex';
  }

  function closeModal() {
    const modal = document.getElementById('parking-modal');
    if (modal) modal.style.display = 'none';
  }

  function getSelectedCar() {
    return document.querySelector('input[name="target-car"]:checked')?.value || 'x1';
  }

  /**
   * Firebase & LocalStorage 통합 저장
   */
  async function saveParking(record) {
    const car = record.car || getSelectedCar();
    const payload = {
      ...record,
      car,
      display_text: record.display_text || `${record.floor} ${record.column}열 ${record.number}번`,
      updated_at: new Date().toISOString()
    };

    // 1) LocalStorage 즉시 저장
    localStorage.setItem(`parking_${car}`, JSON.stringify(payload));

    // 2) Firebase 실시간 동기화 시도 (설정되어 있는 경우)
    try {
      if (window.firebase && firebase.apps.length > 0) {
        await firebase.database().ref(`parking_logs/${car}`).set(payload);
      }
    } catch (err) {
      console.warn('Firebase 동기화 대기 (로컬 저장 유지):', err);
    }

    showToast(`✅ [${car.toUpperCase()}] ${payload.display_text} 저장 완료!`);
    renderParkingLogs();
  }

  /**
   * 주차 기록 렌더링 & 상단 뱃지 갱신
   */
  function renderParkingLogs() {
    const currentCar = getSelectedCar();
    const badgeEl = document.getElementById('parking-current-badge');
    const listEl = document.getElementById('parkingLogList');

    const cars = ['x1', 'accent'];
    let listHTML = '';

    cars.forEach(c => {
      const cached = localStorage.getItem(`parking_${c}`);
      const carName = c === 'x1' ? 'BMW X1' : '엑센트';

      if (cached) {
        try {
          const item = JSON.parse(cached);
          const timeFormatted = formatTime(item.updated_at);

          // 현재 선택된 차량 뱃지 갱신
          if (c === currentCar && badgeEl) {
            badgeEl.innerText = `${item.display_text}`;
          }

          listHTML += `
            <div class="log-item">
              <div class="log-content">
                <div class="log-text">🚗 [${carName}] ${item.display_text}</div>
                <div class="log-time">🕒 기록 시간: ${timeFormatted}</div>
                ${item.gps ? `
                  <div class="map-links-group">
                    <a class="log-map-link" href="https://maps.google.com/?q=${item.gps.lat},${item.gps.lng}" target="_blank">구글 지도</a>
                    <a class="log-map-link" href="https://map.kakao.com/link/map/주차위치,${item.gps.lat},${item.gps.lng}" target="_blank">카카오맵</a>
                  </div>
                ` : ''}
              </div>
              <button type="button" class="delete-item-btn" onclick="App.parking.remove('${c}')">✕</button>
            </div>
          `;
        } catch (e) {
          console.error(e);
        }
      } else if (c === currentCar && badgeEl) {
        badgeEl.innerText = '기록 없음';
      }
    });

    if (listEl) {
      listEl.innerHTML = listHTML || '<div style="font-size: 13px; color: #94a3b8; text-align: center; padding: 12px;">등록된 주차 기록이 없습니다.</div>';
    }
  }

  /**
   * 주차 기록 삭제
   */
  async function removeParking(car) {
    if (!confirm(`[${car.toUpperCase()}] 주차 기록을 삭제하시겠습니까?`)) return;

    localStorage.removeItem(`parking_${car}`);

    try {
      if (window.firebase && firebase.apps.length > 0) {
        await firebase.database().ref(`parking_logs/${car}`).remove();
      }
    } catch (e) {
      console.warn(e);
    }

    showToast(`🗑️ ${car.toUpperCase()} 주차 기록이 삭제되었습니다.`);
    renderParkingLogs();
  }

  function formatTime(isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${m}/${day} ${h}:${min}`;
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // App 글로벌 객체에 바인딩
  window.App.parking = {
    init,
    save: saveParking,
    remove: removeParking,
    refresh: renderParkingLogs
  };

  // DOM 로드 시 자동 초기화
  document.addEventListener('DOMContentLoaded', init);
})();
