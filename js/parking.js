window.App = window.App || {};

App.parking = {
  currentFilter: 'all',

  /* 🚗 차종 정규화 헬퍼 */
  getCarKey(car) {
    if (!car) return 'x1';
    const str = String(car).toLowerCase();
    if (str.includes('x1')) return 'x1';
    if (str.includes('엑센트') || str.includes('accent')) return 'accent';
    return 'x1';
  },

  getCarEmoji(car) {
    return this.getCarKey(car) === 'x1' ? '⚪' : '⚫';
  },

  getCarName(car) {
    return this.getCarKey(car) === 'x1' ? 'X1' : '엑센트';
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

  /* 🚗 주차 저장: 데이터 유실 방지 표준 스토어 연동 & 차종별 2개 보관 */
  save() {
    const { car, type, floor, lat, lng, photoBase64 } = App.state.parking;
    const colSelect = document.getElementById('colSelect');
    const rowSelect = document.getElementById('rowSelect');

    const colVal = colSelect ? colSelect.value : 'A';
    const rowVal = rowSelect ? rowSelect.value : '18';
    const isOutdoor = (type === '야외');
    const slotCode = `${rowVal}-${colVal}`;

    const carKey = this.getCarKey(car);
    const carName = this.getCarName(car);
    const carEmoji = this.getCarEmoji(car);

    const author = (App.auth && App.auth.currentUser !== 'public')
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜')
      : '가족';

    const floorText = isOutdoor ? '야외' : (floor || 'B1');
    const locationText = `${carName} - ${floorText} - ${slotCode}`;

    const now = new Date();
    const timeStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const newLog = {
      id: Date.now(),
      car: carName,
      carKey: carKey,
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

    if (App.stores?.parking) {
      // 1. 기존 동일 차종의 기록 중 최신 1개만 남기고 이전 초과분은 스토어에서 정식 제거
      const allItems = App.stores.parking.getItems();
      const sameCarItems = allItems.filter(i => this.getCarKey(i.car) === carKey);

      if (sameCarItems.length >= 2) {
        for (let idx = 1; idx < sameCarItems.length; idx++) {
          App.stores.parking.remove(sameCarItems[idx].id);
        }
      }

      // 2. 표준 스토어 add 파이프라인으로 등록 (로컬스토리지 + 메모리 + Firebase 동시 반영)
      App.stores.parking.add(newLog);
    }

    this.removePhoto();
    App.ui.toast(`${carEmoji} [${carName}] ${floorText} - ${slotCode} 저장 완료!`);
    if (App.ticker) App.ticker.refresh();
  },

  delete(id) {
    if (confirm("해당 주차 위치 기록을 삭제하시겠습니까?")) {
      if (App.stores?.parking) {
        App.stores.parking.remove(id);
      }
      App.ui.toast("🗑️ 주차 기록이 삭제되었습니다.");
      if (App.ticker) App.ticker.refresh();
    }
  },

  clear() {
    if (confirm("전체 차량 주차 기록을 모두 초기화(삭제)하시겠습니까?")) {
      if (App.stores?.parking) {
        App.stores.parking.clear();
      }
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
    this.render(App.stores?.parking ? App.stores.parking.getItems() : []);
  },

  render(items = []) {
    const listEl = document.getElementById('logList');
    if (!listEl) return;

    let filtered = items;
    if (this.currentFilter !== 'all') {
      const filterKey = this.getCarKey(this.currentFilter);
      filtered = items.filter(i => this.getCarKey(i.car) === filterKey);
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">주차 기록이 없습니다. 🚗</div>`;
      return;
    }

    const latestIds = {};
    items.forEach(it => {
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
