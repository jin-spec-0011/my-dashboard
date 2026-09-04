window.App = window.App || {};

App.parking = {
  currentFilter: 'all',

  /* 🚗 차종 및 이모지 판별 */
  getCarKey(car) {
    if (!car) return 'x1';
    const str = String(car).toLowerCase().trim();
    if (str.includes('x1')) return 'x1';
    return 'accent';
  },

  getCarEmoji(car) {
    return this.getCarKey(car) === 'x1' ? '⚪' : '⚫';
  },

  getCarName(car) {
    return this.getCarKey(car) === 'x1' ? 'X1' : '엑센트';
  },

  /* 💾 데이터 유실 방지: 저장소에서 직접 안전하게 읽기 */
  getLogs() {
    try {
      const raw = safeGet('parking_logs');
      const list = JSON.parse(raw || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  },

  /* 💾 로컬 스토리지 + 스토어 캐시 + Firebase 동시 영구 보존 */
  saveLogs(list) {
    safeSet('parking_logs', JSON.stringify(list));
    if (App.stores && App.stores.parking && typeof App.stores.parking.load === 'function') {
      App.stores.parking.load();
    }
    if (App.isFirebaseActive && App.db) {
      App.db.ref('parking_logs').set(list);
    }
  },

  selectOption(type, value) {
    App.state.parking[type] = value;

    if (type === 'car') {
      const targetKey = this.getCarKey(value);
      document.querySelectorAll('#carGroup .btn-toggle').forEach(btn => {
        const btnKey = this.getCarKey(btn.innerText);
        btn.classList.toggle('active', btnKey === targetKey);
      });
    } else if (type === 'type') {
      document.querySelectorAll('#typeGroup .btn-toggle').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.trim() === value);
      });
      const isOutdoor = (value === '야외');
      const floorCont = document.getElementById('floorContainer');
      const mapSec = document.getElementById('outdoorMapSection');
      if (floorCont) floorCont.style.display = isOutdoor ? 'none' : 'flex';
      if (mapSec) mapSec.style.display = isOutdoor ? 'flex' : 'none';
      if (isOutdoor) this.getCurrentLocation();
    } else if (type === 'floor') {
      document.querySelectorAll('#floorGroup .btn-toggle').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.trim() === value);
      });
    }
  },

  getCurrentLocation() {
    const status = document.getElementById('gpsStatus');
    if (!navigator.geolocation) {
      if (status) status.innerText = "❌ GPS 미지원 기기";
      return;
    }
    if (status) status.innerText = "🔄 GPS 좌표 수신 중...";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        App.state.parking.lat = pos.coords.latitude;
        App.state.parking.lng = pos.coords.longitude;
        if (status) status.innerText = `📍 좌표 갱신 완료`;
        const frame = document.getElementById('mapFrame');
        if (frame) {
          frame.src = `https://maps.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}&z=17&output=embed`;
        }
      },
      () => {
        if (status) status.innerText = "⚠️ GPS 수신 실패 (기본 위치)";
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  },

  handlePhoto(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        App.state.parking.photoBase64 = canvas.toDataURL('image/jpeg', 0.65);

        const previewImg = document.getElementById('parkingPhotoPreviewImg');
        const placeholder = document.getElementById('parkingPhotoPlaceholder');
        const btnRemove = document.getElementById('btnRemoveParkingPhoto');

        if (previewImg) {
          previewImg.src = App.state.parking.photoBase64;
          previewImg.style.display = 'block';
        }
        if (placeholder) placeholder.style.display = 'none';
        if (btnRemove) btnRemove.style.display = 'inline-block';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  },

  removePhoto() {
    App.state.parking.photoBase64 = '';
    const input = document.getElementById('parkingPhotoInput');
    const previewImg = document.getElementById('parkingPhotoPreviewImg');
    const placeholder = document.getElementById('parkingPhotoPlaceholder');
    const btnRemove = document.getElementById('btnRemoveParkingPhoto');

    if (input) input.value = '';
    if (previewImg) { previewImg.src = ''; previewImg.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    if (btnRemove) btnRemove.style.display = 'none';
  },

  /* 🚗 주차 저장: B1-25A 규격 적용 */
  save() {
    const { car, type, floor, lat, lng, photoBase64 } = App.state.parking;
    const colSelect = document.getElementById('colSelect');
    const rowSelect = document.getElementById('rowSelect');

    const colVal = colSelect ? colSelect.value : 'A';
    const rowVal = rowSelect ? rowSelect.value : '25';
    const isOutdoor = (type === '야외');
    const slotCode = `${rowVal}${colVal}`; // 👈 하이픈 없이 25A로 결합

    const carKey = this.getCarKey(car);
    const carName = this.getCarName(car);
    const carEmoji = this.getCarEmoji(car);

    const author = (App.auth && App.auth.currentUser !== 'public')
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜')
      : '가족';

    const floorText = isOutdoor ? '야외' : (floor || 'B1');
    const locationText = `${carName} - ${floorText}-${slotCode}`; // 👈 X1 - B1-25A

    const now = new Date();
    const timeStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const newLog = {
      id: Date.now(),
      car: carName,
      author: author,
      floor: floorText,
      slot: slotCode,
      type: type,
      text: locationText,
      time: timeStr,
      isOutdoor: isOutdoor,
      lat: isOutdoor ? lat : null,
      lng: isOutdoor ? lng : null,
      photoBase64: photoBase64 || ''
    };

    const allLogs = this.getLogs();
    const sameCarLogs = allLogs.filter(i => this.getCarKey(i.car) === carKey);
    const keptSameCar = sameCarLogs.slice(0, 1);
    const otherCarLogs = allLogs.filter(i => this.getCarKey(i.car) !== carKey);
    const keptOtherCar = otherCarLogs.slice(0, 2);

    const finalCleanList = [newLog, ...keptSameCar, ...keptOtherCar];

    this.saveLogs(finalCleanList);
    this.render(finalCleanList);

    this.removePhoto();
    App.ui.toast(`${carEmoji} [${carName}] ${floorText}-${slotCode} 저장 완료!`);
    if (App.ticker) App.ticker.refresh();
  },
  delete(id) {
    if (confirm("해당 주차 위치 기록을 삭제하시겠습니까?")) {
      const allLogs = this.getLogs().filter(i => String(i.id) !== String(id));
      this.saveLogs(allLogs);
      this.render(allLogs);
      App.ui.toast("🗑️ 주차 기록이 삭제되었습니다.");
      if (App.ticker) App.ticker.refresh();
    }
  },

  clear() {
    if (confirm("전체 차량 주차 기록을 모두 초기화(삭제)하시겠습니까?")) {
      this.saveLogs([]);
      this.render([]);
      App.ui.toast("🗑️ 전체 주차 기록이 초기화되었습니다.");
      if (App.ticker) App.ticker.refresh();
    }
  },

  setFilter(filter) {
    this.currentFilter = filter;
    const targetKey = filter === 'all' ? 'all' : this.getCarKey(filter);
    document.querySelectorAll('.log-filter-bar .filter-btn').forEach(b => {
      if (b.id === 'filter-all') {
        b.classList.toggle('active', targetKey === 'all');
      } else if (b.id === 'filter-x1') {
        b.classList.toggle('active', targetKey === 'x1');
      } else if (b.id === 'filter-accent') {
        b.classList.toggle('active', targetKey === 'accent');
      }
    });
    this.render();
  },

  render(items) {
    const listEl = document.getElementById('logList');
    if (!listEl) return;

    const sourceItems = (Array.isArray(items) && items.length > 0) ? items : this.getLogs();

    let filtered = sourceItems;
    if (this.currentFilter !== 'all') {
      const filterKey = this.getCarKey(this.currentFilter);
      filtered = sourceItems.filter(i => this.getCarKey(i.car) === filterKey);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">주차 기록이 없습니다. 🚗</div>`;
      return;
    }

    // 각 차종별 가장 최신 1개 아이템 식별
    const latestIds = {};
    sourceItems.forEach(it => {
      const carKey = this.getCarKey(it.car);
      if (!latestIds[carKey]) {
        latestIds[carKey] = it.id;
      }
    });

    listEl.innerHTML = filtered.map(item => {
      const carKey = this.getCarKey(item.car);
      const isCarLatest = (latestIds[carKey] === item.id);
      const carEmoji = this.getCarEmoji(item.car);

      let mapLinks = '';
      if (item.isOutdoor && item.lat && item.lng) {
        const kmap = `kakaomap://look?p=${item.lat},${item.lng}`;
        const nmap = `nmap://action/path?dlat=${item.lat}&dlng=${item.lng}&dname=주차위치&appname=gogo`;
        const gmap = `https://www.google.com/maps?q=${item.lat},${item.lng}`;
        mapLinks = `
          <div class="map-links-group" style="display:flex; gap:6px; margin-top:4px;">
            <a href="${kmap}" class="log-map-link" style="font-size:11px; color:#2563eb; font-weight:700;">카카오맵</a>
            <a href="${nmap}" class="log-map-link" style="font-size:11px; color:#2563eb; font-weight:700;">네이버지도</a>
            <a href="${gmap}" target="_blank" class="log-map-link" style="font-size:11px; color:#2563eb; font-weight:700;">구글지도</a>
          </div>
        `;
      }

      let photoHtml = '';
      if (item.photoBase64) {
        photoHtml = `<img src="${item.photoBase64}" class="parking-log-thumb" onclick="window.open('${item.photoBase64}')" title="사진 확대보기">`;
      }

      return `
        <div class="log-item ${isCarLatest ? 'parking-latest-card' : ''}">
          <div class="log-content">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="log-text">${carEmoji} ${escapeHtml(item.text)}</span>
              ${isCarLatest ? '<span class="parking-latest-badge">⭐ 최신 주차</span>' : ''}
            </div>
            <div class="log-time">🕒 ${escapeHtml(item.time)} · 등록: ${escapeHtml(item.author || '가족')}</div>
            ${mapLinks}
          </div>
          ${photoHtml}
          <button type="button" class="delete-item-btn" onclick="App.parking.delete('${item.id}')">✕</button>
        </div>
      `;
    }).join('');
  }
};
