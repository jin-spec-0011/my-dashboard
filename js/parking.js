/**
 * GOGO 스마트 매니저 - 주차 위치 기록 (js/parking.js)
 * - Firebase /parking_logs : { [id]: { id, car, floor, slot, text, author, time, type, ... } }
 * - id = yyyyMMddHHmmss 14자리 정수 (iOS 단축어 규격과 동일)
 * - 차량별 최신 2개 유지 (App.stores.parking sanitizer)
 */
window.App = window.App || {};

App.parking = {
  currentFilter: 'all',

  getCarKey(car) {
    return String(car || '').toLowerCase().includes('x1') ? 'x1' : 'accent';
  },
  getCarEmoji(car) {
    return this.getCarKey(car) === 'x1' ? '⚪' : '⚫';
  },
  getCarName(car) {
    return this.getCarKey(car) === 'x1' ? 'X1' : '엑센트';
  },

  /* 대시보드 / 외부 모듈 호환: 최신순 정렬 목록 */
  getLogs() {
    const items = App.stores && App.stores.parking ? App.stores.parking.getItems() : [];
    return [...items].sort((a, b) => parkingTime(b) - parkingTime(a));
  },

  init() {
    const rowSelect = document.getElementById('rowSelect');
    const colSelect = document.getElementById('colSelect');
    if (rowSelect && !rowSelect.options.length) {
      for (let i = 1; i <= 50; i++) rowSelect.add(new Option(`${i}번`, String(i), false, i === 18));
    }
    if (colSelect && !colSelect.options.length) {
      for (let c = 65; c <= 90; c++) {
        const ch = String.fromCharCode(c);
        colSelect.add(new Option(ch, ch, false, ch === 'A'));
      }
    }
  },

  selectOption(type, value) {
    App.state.parking[type] = value;
    const groupId = { car: 'carGroup', type: 'typeGroup', floor: 'floorGroup' }[type];
    if (groupId) {
      document.querySelectorAll(`#${groupId} .btn-toggle`).forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-value') === value);
      });
    }
    if (type === 'type') {
      const isOutdoor = value === '야외';
      const floorCont = document.getElementById('floorContainer');
      const mapSec = document.getElementById('outdoorMapSection');
      if (floorCont) floorCont.style.display = isOutdoor ? 'none' : 'flex';
      if (mapSec) mapSec.style.display = isOutdoor ? 'flex' : 'none';
      if (isOutdoor) this.getCurrentLocation();
    }
  },

  getCurrentLocation() {
    const status = document.getElementById('gpsStatus');
    if (!navigator.geolocation) {
      if (status) status.innerText = '❌ GPS 미지원 기기';
      return;
    }
    if (status) status.innerText = '🔄 GPS 좌표 수신 중...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        App.state.parking.lat = pos.coords.latitude;
        App.state.parking.lng = pos.coords.longitude;
        if (status) status.innerText = '📍 좌표 갱신 완료';
        const frame = document.getElementById('mapFrame');
        if (frame) frame.src = `https://maps.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}&z=17&output=embed`;
      },
      (err) => {
        console.warn('[Parking] GPS 실패', err);
        if (status) status.innerText = '⚠️ GPS 수신 실패 (위치 권한 확인)';
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  },

  /* 사진은 800px / JPEG 0.65로 축소 후 Base64 (Firebase 노드 용량 보호) */
  handlePhoto(input) {
    if (!input || !input.files || !input.files[0]) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onerror = () => App.ui.toast('⚠️ 사진을 읽지 못했습니다.');
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => App.ui.toast('⚠️ 지원하지 않는 이미지 형식입니다.');
      img.onload = () => {
        try {
          const MAX_WIDTH = 800;
          let { width, height } = img;
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
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
        } catch (err) {
          console.error('[Parking] 사진 변환 실패', err);
          App.ui.toast('⚠️ 사진 처리 중 오류가 발생했습니다.');
        }
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
    if (previewImg) { previewImg.removeAttribute('src'); previewImg.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    if (btnRemove) btnRemove.style.display = 'none';
  },

  save() {
    if (!App.stores || !App.stores.parking) return;
    const { car, type, floor, lat, lng, photoBase64 } = App.state.parking;
    const rowSelect = document.getElementById('rowSelect');
    const colSelect = document.getElementById('colSelect');
    const rowVal = rowSelect && rowSelect.value ? rowSelect.value : '18';
    const colVal = colSelect && colSelect.value ? colSelect.value : 'A';

    const isOutdoor = type === '야외';
    const slot = `${rowVal}${colVal}`;
    const carName = this.getCarName(car);
    const floorText = isOutdoor ? '야외' : (floor || 'B1');
    const user = App.auth ? App.auth.currentUser : 'public';
    const author = user === 'jihye' ? '지혜' : '진세';
    const now = new Date();
    const time = `${now.getMonth() + 1}월 ${now.getDate()}일 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const newLog = {
      id: generateKstId(),
      car: carName,
      floor: floorText,
      slot,
      text: `${carName} - ${floorText}-${slot}`,
      author,
      time,
      type: isOutdoor ? '야외' : '지하 주차장',
      isOutdoor,
      lat: isOutdoor ? lat : null,
      lng: isOutdoor ? lng : null,
      photoBase64: photoBase64 || ''
    };

    App.stores.parking.add(newLog);
    this.removePhoto();
    App.ui.toast(`${this.getCarEmoji(carName)} [${carName}] ${floorText}-${slot} 저장 완료!`);
  },

  delete(id) {
    if (!confirm('해당 주차 위치 기록을 삭제하시겠습니까?')) return;
    App.stores.parking.remove(id);
    App.ui.toast('🗑️ 주차 기록이 삭제되었습니다.');
  },

  clear() {
    if (!confirm('전체 차량 주차 기록을 모두 삭제하시겠습니까?')) return;
    App.stores.parking.clearAll();
    App.ui.toast('🗑️ 전체 주차 기록이 삭제되었습니다.');
  },

  setFilter(filter) {
    this.currentFilter = filter;
    const key = filter === 'all' ? 'all' : this.getCarKey(filter);
    const map = { 'filter-all': 'all', 'filter-x1': 'x1', 'filter-accent': 'accent' };
    Object.keys(map).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', map[id] === key);
    });
    this.render();
  },

  render() {
    const listEl = document.getElementById('logList');
    if (!listEl) return;
    const all = this.getLogs();
    const filtered = this.currentFilter === 'all'
      ? all
      : all.filter((i) => this.getCarKey(i.car || i.text) === this.getCarKey(this.currentFilter));

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="empty-msg">주차 기록이 없습니다. 🚗</div>';
      return;
    }

    const latestIds = {};
    all.forEach((it) => {
      const k = this.getCarKey(it.car || it.text);
      if (latestIds[k] === undefined) latestIds[k] = String(it.id);
    });

    listEl.innerHTML = filtered.map((item) => {
      const k = this.getCarKey(item.car || item.text);
      const isLatest = latestIds[k] === String(item.id);
      const photo = item.photoBase64 || item.photo || '';
      const safeId = escapeHtml(String(item.id));
      let mapLinks = '';
      if (item.isOutdoor && item.lat && item.lng) {
        const lat = Number(item.lat);
        const lng = Number(item.lng);
        mapLinks = `
          <div class="map-links-group">
            <a href="kakaomap://look?p=${lat},${lng}" class="log-map-link">카카오맵</a>
            <a href="nmap://place?lat=${lat}&lng=${lng}&name=${encodeURIComponent('주차위치')}&appname=gogo" class="log-map-link">네이버지도</a>
            <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener" class="log-map-link">구글지도</a>
          </div>`;
      }
      return `
        <div class="log-item ${isLatest ? 'parking-latest-card' : ''}">
          <div class="log-content">
            <div class="row-between" style="justify-content:flex-start;">
              <span class="log-text">${this.getCarEmoji(item.car || item.text)} ${escapeHtml(item.text || `${item.car} - ${item.floor}-${item.slot}`)}</span>
              ${isLatest ? '<span class="parking-latest-badge">⭐ 최신</span>' : ''}
            </div>
            <div class="log-time">🕒 ${escapeHtml(item.time || '')} · 등록: ${escapeHtml(item.author || '가족')}</div>
            ${mapLinks}
          </div>
          ${photo && /^data:image\//.test(photo) ? `<img src="${photo}" class="parking-log-thumb" alt="주차 사진" onclick="App.parking.openPhoto('${safeId}')">` : ''}
          <button type="button" class="delete-item-btn" onclick="App.parking.delete('${safeId}')" title="삭제">✕</button>
        </div>`;
    }).join('');
  },

  openPhoto(id) {
    const item = this.getLogs().find((i) => String(i.id) === String(id));
    const photo = item ? (item.photoBase64 || item.photo) : '';
    if (!photo) return;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<title>주차 사진</title><body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${photo}" style="max-width:100%;max-height:100vh;"></body>`);
      w.document.close();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  try { App.parking.init(); } catch (e) { console.error('[Parking] init 실패', e); }
});
