window.App = window.App || {};

App.parking = {
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

  /* 📸 사진 업로드 및 경량화(Canvas 압축) */
  handlePhoto(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 600; // Firebase 저장 용량을 고려한 600px 최적화
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else if (h > maxDim) {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        App.state.parking.photoBase64 = canvas.toDataURL('image/jpeg', 0.7);
        
        const preview = document.getElementById('parkingPhotoPreviewImg');
        const placeholder = document.getElementById('parkingPhotoPlaceholder');
        const btnRemove = document.getElementById('btnRemoveParkingPhoto');

        if (preview) {
          preview.src = App.state.parking.photoBase64;
          preview.style.display = 'block';
        }
        if (placeholder) placeholder.style.display = 'none';
        if (btnRemove) btnRemove.style.display = 'inline-block';
        
        App.ui.toast("📸 사진이 첨부되었습니다!");
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  },

  /* 첨부된 사진 삭제 */
  removePhoto() {
    App.state.parking.photoBase64 = '';
    const input = document.getElementById('parkingPhotoInput');
    const preview = document.getElementById('parkingPhotoPreviewImg');
    const placeholder = document.getElementById('parkingPhotoPlaceholder');
    const btnRemove = document.getElementById('btnRemoveParkingPhoto');

    if (input) input.value = '';
    if (preview) {
      preview.src = '';
      preview.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'inline-block';
    if (btnRemove) btnRemove.style.display = 'none';
  },

  setFilter(filter) {
    App.state.parking.filter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    const btn = document.getElementById('filter-' + filter);
    if (btn) btn.classList.add('active');
    this.render(App.stores.parking.getItems());
  },

  /* 주차 위치 및 사진 저장 */
  save() {
    const col = document.getElementById('colSelect').value;
    const row = document.getElementById('rowSelect').value;
    const slot = `${col}${row}`;
    const p = App.state.parking;
    const logString = (p.type === '야외') ? `${p.car}-야외 주차 - ${slot}` : `${p.car}-${p.type} - ${p.floor}-${slot}`;

    const now = new Date();
    const timeString = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    const currentLogs = App.stores.parking.getItems();

    // 기존 동일 차종 기록 정리 (최신 1건 유지)
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
      photo: p.photoBase64 || '', // 👈 리사이징된 기둥 사진 포함
      isOutdoor: p.type === '야외',
      lat: p.type === '야외' ? p.lat : null,
      lng: p.type === '야외' ? p.lng : null
    };

    otherCarLogs.unshift(newLog);
    safeSet('parking_logs', JSON.stringify(otherCarLogs));

    if (App.isFirebaseActive) App.db.ref('parking_logs/' + newLog.id).set(newLog);

    this.removePhoto(); // 폼 초기화
    App.stores.parking.load();
    App.ui.toast(`✅ ${p.car} 주차 위치와 사진이 저장되었습니다!`);
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

  /* 사진 확대 팝업 보기 */
  viewPhoto(photoUrl) {
    if (!photoUrl) return;
    const w = window.open("");
    w.document.write(`<img src="${photoUrl}" style="max-width:100%; height:auto; display:block; margin:20px auto; border-radius:10px;">`);
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
      
      const photoHtml = item.photo ? `
        <img src="${item.photo}" class="parking-log-thumb" onclick="App.parking.viewPhoto('${item.photo}')" alt="기둥 사진" title="클릭 시 사진 확인">
      ` : '';

      return `
        <div class="log-item">
          ${photoHtml}
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
