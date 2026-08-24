window.App = window.App || {};

App.parking = {
  // 실사 기반 층별 고유 색상 HSV 테이블
  FLOOR_COLOR_MAP: [
    { floor: 'B1', name: '지하 1층 (스카이블루)', hMin: 175, hMax: 215, sMin: 0.25, vMin: 0.40 },
    { floor: 'B2', name: '지하 2층 (웜옐로우)',   hMin: 35,  hMax: 58,  sMin: 0.35, vMin: 0.45 },
    { floor: 'B3', name: '지하 3층 (라임그린)',   hMin: 65,  hMax: 105, sMin: 0.30, vMin: 0.40 }
  ],

  // 인식 결과 임시 보관 객체
  pendingDetection: {
    car: 'x1',
    floor: 'B1',
    col: 'A',
    row: '1'
  },

  selectOption(cat, val) {
    App.state.parking[cat] = val;
    const groupMap = { car: 'carGroup', type: 'typeGroup', floor: 'floorGroup' };
    const group = document.getElementById(groupMap[cat]);
    if (group) {
      group.querySelectorAll('.btn-toggle').forEach(btn => {
        btn.classList.toggle('active', btn.innerText === val);
      });
    }

    if (cat === 'type') {
      const isOutdoor = (val === '야외');
      const floorCont = document.getElementById('floorContainer');
      const outdoorMap = document.getElementById('outdoorMapSection');
      if (floorCont) floorCont.style.display = isOutdoor ? 'none' : 'flex';
      if (outdoorMap) outdoorMap.style.display = isOutdoor ? 'flex' : 'none';
      if (isOutdoor) this.getCurrentLocation();
    }
  },

  getCurrentLocation() {
    const status = document.getElementById('gpsStatus');
    if (status) status.innerText = "⏳ 위치 찾는 중...";
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        App.state.parking.lat = pos.coords.latitude;
        App.state.parking.lng = pos.coords.longitude;
        const frame = document.getElementById('mapFrame');
        if (frame) frame.src = `https://maps.google.com/maps?q=${App.state.parking.lat},${App.state.parking.lng}&z=17&output=embed`;
        if (status) status.innerText = "✅ 위치 갱신 완료";
      },
      () => { if (status) status.innerText = "📍 기본 위치"; },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  },

  /* 📷 사진 업로드 및 자동 분석 파이프라인 */
  async handlePhoto(input) {
    const file = input.files?.[0];
    if (!file) return;

    const statusBox = document.getElementById('ocrStatusBox');
    const statusText = document.getElementById('ocrStatusText');
    if (statusBox) statusBox.style.display = 'flex';
    if (statusText) statusText.innerText = '이미지 최적화 중...';

    try {
      // 1) Canvas 리사이징 (800px 제한)
      const canvas = await this.resizeImageToCanvas(file, 800);

      // 2) 기둥 상단 HSV 분석 -> 층수 판별
      if (statusText) statusText.innerText = '기둥 색상(층수) 분석 중...';
      const detectedFloor = this.analyzePillarColor(canvas) || App.state.parking.floor || 'B1';

      // 3) OCR 판독 -> 숫자/알파벳 추출
      if (statusText) statusText.innerText = '구역 번호 판독 중... (0%)';
      const ocrResult = await this.recognizePillarText(canvas, (progress) => {
        if (statusText) statusText.innerText = `구역 번호 판독 중... (${Math.round(progress * 100)}%)`;
      });

      // 4) 임시 데이터 세팅
      this.pendingDetection = {
        car: App.state.parking.car || 'x1',
        floor: detectedFloor,
        col: ocrResult.col || 'A',
        row: String(ocrResult.row || 1)
      };

      if (statusBox) statusBox.style.display = 'none';

      // 5) 확인 모달 표시
      this.openModal(this.pendingDetection);

    } catch (err) {
      console.error('사진 분석 실패:', err);
      if (statusText) statusText.innerText = '인식에 실패했습니다. 수동 입력을 이용해주세요.';
      setTimeout(() => {
        if (statusBox) statusBox.style.display = 'none';
      }, 2500);
    } finally {
      input.value = '';
    }
  },

  resizeImageToCanvas(file, maxWidth = 800) {
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
  },

  analyzePillarColor(canvas) {
    const ctx = canvas.getContext('2d');
    const startX = Math.floor(canvas.width * 0.30);
    const startY = Math.floor(canvas.height * 0.15);
    const sampleW = Math.floor(canvas.width * 0.40);
    const sampleH = Math.floor(canvas.height * 0.30);

    const imgData = ctx.getImageData(startX, startY, sampleW, sampleH).data;
    let totalH = 0, totalS = 0, totalV = 0, validPixelCount = 0;

    for (let i = 0; i < imgData.length; i += 16) {
      const [h, s, v] = this.rgbToHsv(imgData[i], imgData[i + 1], imgData[i + 2]);
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

    const matched = this.FLOOR_COLOR_MAP.find(cfg =>
      avgH >= cfg.hMin && avgH <= cfg.hMax && avgS >= cfg.sMin && avgV >= cfg.vMin
    );

    return matched ? matched.floor : null;
  },

  rgbToHsv(r, g, b) {
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
  },

  async recognizePillarText(canvas, onProgress) {
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

    // 상단 숫자 + 하단 알파벳 (예: "45 B", "16 B", "23 A", "20 A")
    const numThenAlpha = cleanText.match(/([0-9]{1,2})\s+([A-Z])/);
    if (numThenAlpha) {
      return { col: numThenAlpha[2], row: parseInt(numThenAlpha[1], 10) };
    }

    // 알파벳 + 숫자 (예: "A 23", "B16")
    const alphaThenNum = cleanText.match(/([A-Z])\s*([0-9]{1,2})/);
    if (alphaThenNum) {
      return { col: alphaThenNum[1], row: parseInt(alphaThenNum[2], 10) };
    }

    return { col: null, row: null };
  },

  openModal(data) {
    const modal = document.getElementById('parking-modal');
    const badge = document.getElementById('modalDetectedBadge');
    const loc = document.getElementById('modalDetectedLocation');
    const carInfo = document.getElementById('modalDetectedCar');

    if (badge) badge.innerText = `지하 ${data.floor.replace('B', '')}층 (${data.floor})`;
    if (loc) loc.innerText = `${data.col}열 ${data.row}번`;
    if (carInfo) carInfo.innerText = `차량: ${data.car}`;

    if (modal) modal.style.display = 'flex';
  },

  closeModal() {
    const modal = document.getElementById('parking-modal');
    if (modal) modal.style.display = 'none';
  },

  /* ⚡ 모달: 원터치 바로 저장 */
  saveDetected() {
    this.closeModal();
    this.applyDetectedToUI(this.pendingDetection);
    this.save();
  },

  /* ✏️ 모달: 수동 수정하기 */
  editDetected() {
    this.closeModal();
    this.applyDetectedToUI(this.pendingDetection);
    App.ui.toast("✏️ 폼에서 수정 후 [위치 기록 및 저장]을 눌러주세요.");
    const rowSelect = document.getElementById('rowSelect');
    if (rowSelect) rowSelect.focus();
  },

  applyDetectedToUI(data) {
    this.selectOption('type', '지하 주차장');
    this.selectOption('floor', data.floor);

    const colSelect = document.getElementById('colSelect');
    const rowSelect = document.getElementById('rowSelect');
    if (colSelect && data.col) colSelect.value = data.col;
    if (rowSelect && data.row) rowSelect.value = data.row;
  },

  setFilter(filter) {
    App.state.parking.filter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById('filter-' + filter);
    if (btn) btn.classList.add('active');
    this.render(App.stores.parking.getItems());
  },

  save() {
    const col = document.getElementById('colSelect').value;
    const row = document.getElementById('rowSelect').value;
    const slot = `${col}${row}`;
    const p = App.state.parking;
    const logString = (p.type === '야외') ? `${p.car}-야외 주차 - ${slot}` : `${p.car}-${p.type} - ${p.floor}-${slot}`;

    const now = new Date();
    const timeString = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const currentLogs = App.stores.parking.getItems();

    // 동일 차량의 과거 기록 Firebase에서 정리 (최신 1건만 유지)
    currentLogs.forEach(item => {
      if (item.car === p.car || (item.text && item.text.startsWith(p.car))) {
        if (App.isFirebaseActive) App.db.ref('parking_logs/' + item.id).remove();
      }
    });

    const otherCarLogs = currentLogs.filter(item => item.car !== p.car && (!item.text || !item.text.startsWith(p.car)));

    const newLog = {
      id: Date.now(),
      car: p.car,
      text: logString,
      time: timeString,
      isOutdoor: p.type === '야외',
      lat: p.type === '야외' ? p.lat : null,
      lng: p.type === '야외' ? p.lng : null
    };

    otherCarLogs.unshift(newLog);
    safeSet('parking_logs', JSON.stringify(otherCarLogs));

    if (App.isFirebaseActive) App.db.ref('parking_logs/' + newLog.id).set(newLog);

    App.stores.parking.load();
    App.ui.toast(`✅ ${p.car} 주차 위치가 갱신되었습니다!`);
    if (navigator.vibrate) navigator.vibrate(40);
  },

  delete(id) {
    App.stores.parking.remove(id);
  },

  clear() {
    const f = App.state.parking.filter;
    if (confirm(`${f === 'all' ? '모든' : '[' + f + ']'} 차량의 주차 기록을 삭제하시겠습니까?`)) {
      if (f === 'all') {
        App.stores.parking.clear();
      } else {
        const currentLogs = App.stores.parking.getItems();
        const keepItems = currentLogs.filter(i => i.car !== f && (!i.text || !i.text.startsWith(f)));
        safeSet('parking_logs', JSON.stringify(keepItems));
        if (App.isFirebaseActive) {
          currentLogs.forEach(i => {
            if (i.car === f || (i.text && i.text.startsWith(f))) {
              App.db.ref('parking_logs/' + i.id).remove();
            }
          });
        }
        App.stores.parking.load();
      }
    }
  },

  render(items) {
    const logList = document.getElementById('logList');
    if (!logList) return;
    const filter = App.state.parking.filter;

    const latestPerCar = [];
    const seenCars = new Set();
    items.forEach(item => {
      const carKey = item.car || (item.text ? item.text.split('-')[0] : '기타');
      if (!seenCars.has(carKey)) {
        seenCars.add(carKey);
        latestPerCar.push(item);
      }
    });

    let filtered = (filter === 'all') ? latestPerCar : latestPerCar.filter(i => i.car === filter || (i.text && i.text.startsWith(filter)));

    if (!filtered || filtered.length === 0) {
      logList.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">주차 기록이 없습니다.</div>`;
      return;
    }

    logList.innerHTML = filtered.map((item) => {
      let mapLinks = '';
      if (item.isOutdoor && item.lat && item.lng) {
        mapLinks = `
          <div class="map-links-group">
            <a href="https://www.google.com/maps?q=${item.lat},${item.lng}" target="_blank" class="log-map-link">🗺️ 구글 지도</a>
            <a href="https://map.kakao.com/link/map/주차위치,${item.lat},${item.lng}" target="_blank" class="log-map-link">📍 카카오맵</a>
          </div>`;
      }
      return `
        <div class="log-item">
          <div class="log-content">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="log-text">${escapeHtml(item.text)}</span>
              <span style="font-size:10px; font-weight:800; background:#dcfce7; color:#15803d; padding:2px 6px; border-radius:4px; border:1px solid #86efac;">현재 위치</span>
            </div>
            <span class="log-time">${escapeHtml(item.time)} 갱신</span>
            ${mapLinks}
          </div>
          <button type="button" class="delete-item-btn" onclick="App.parking.delete('${item.id}')">✕</button>
        </div>`;
    }).join('');
  }
};
