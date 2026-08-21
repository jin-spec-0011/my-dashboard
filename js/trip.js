window.App = window.App || {};

App.trip = {
  initMap() {
    const t = App.state.trip;
    if (!t.map) {
      t.map = L.map('travelMap').setView([36.5, 127.8], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(t.map);

      t.map.on('click', (e) => {
        t.coords = { lat: e.latlng.lat, lng: e.latlng.lng };
        App.ui.toast("📍 위치가 선택되었습니다!");
        t.tempMarker.setLatLng(e.latlng);
      });

      t.tempMarker = L.circleMarker([36.5, 127.8], { radius: 8, color: '#ec4899', fillColor: '#f472b6', fillOpacity: 0.8 }).addTo(t.map);
    }

    setTimeout(() => {
      t.map.invalidateSize();
      this.renderMarkers(App.stores.trips.getItems());
    }, 200);
  },

  getCurrentLocation() {
    if (!navigator.geolocation) return alert("GPS 미지원 브라우저입니다.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const t = App.state.trip;
        t.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (t.map && t.tempMarker) {
          t.map.setView([t.coords.lat, t.coords.lng], 14);
          t.tempMarker.setLatLng([t.coords.lat, t.coords.lng]);
        }
        App.ui.toast("📍 현재 위치로 지정되었습니다!");
      },
      () => alert("위치 정보를 가져올 수 없습니다."),
      { enableHighAccuracy: true, timeout: 6000 }
    );
  },

  handlePhoto(input) {
    if (!input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 600;
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
        else if (h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        App.state.trip.photoBase64 = canvas.toDataURL('image/jpeg', 0.7);
        document.getElementById('photoPreviewImg').src = App.state.trip.photoBase64;
        document.getElementById('photoPreviewImg').style.display = 'block';
        document.getElementById('photoPlaceholder').style.display = 'none';
        document.getElementById('btnRemovePhoto').style.display = 'inline-block';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  },

  removePhoto() {
    App.state.trip.photoBase64 = '';
    document.getElementById('tripPhotoInput').value = '';
    document.getElementById('photoPreviewImg').src = '';
    document.getElementById('photoPreviewImg').style.display = 'none';
    document.getElementById('photoPlaceholder').style.display = 'inline-block';
    document.getElementById('btnRemovePhoto').style.display = 'none';
  },

  save() {
    const place = document.getElementById('tripPlaceInput').value.trim();
    const date = document.getElementById('tripDateInput').value;
    const memo = document.getElementById('tripMemoInput').value.trim();
    if (!place) return alert("여행지/장소명을 입력해주세요.");

    const t = App.state.trip;
    App.stores.trips.add({
      id: Date.now(),
      place: place,
      date: date || new Date().toISOString().split('T')[0],
      memo: memo || '즐거운 가족 여행 추억 기록 ✨',
      photo: t.photoBase64 || '',
      lat: t.coords.lat,
      lng: t.coords.lng
    });

    document.getElementById('tripPlaceInput').value = '';
    document.getElementById('tripMemoInput').value = '';
    this.removePhoto();
    this.renderMarkers(App.stores.trips.getItems());
    App.ui.toast("✈️ 여행 기록이 등록되었습니다!");
  },

  delete(id) {
    if (confirm("이 여행 기록을 삭제하시겠습니까?")) {
      App.stores.trips.remove(id);
      this.renderMarkers(App.stores.trips.getItems());
    }
  },

  clear() {
    if (confirm("모든 여행 기록을 삭제하시겠습니까?")) {
      App.stores.trips.clear();
      this.renderMarkers([]);
    }
  },

  focusOnMap(lat, lng) {
    if (!App.state.trip.map) return;
    App.state.trip.map.setView([lat, lng], 14);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  renderMarkers(items) {
    const t = App.state.trip;
    if (!t.map) return;
    t.markers.forEach(m => t.map.removeLayer(m));
    t.markers = [];

    items.forEach(item => {
      if (!item.lat || !item.lng) return;
      const popup = `
        <div style="font-family:sans-serif; text-align:center; min-width:140px;">
          ${item.photo ? `<img src="${item.photo}" style="width:100%; max-height:100px; object-fit:cover; border-radius:8px; margin-bottom:6px;">` : ''}
          <div style="font-weight:800; font-size:14px; color:#0f172a;">${escapeHtml(item.place)}</div>
          <div style="font-size:11px; color:#64748b; margin-top:2px;">📅 ${escapeHtml(item.date)}</div>
          <div style="font-size:12px; color:#334155; margin-top:4px;">${escapeHtml(item.memo)}</div>
        </div>`;
      const marker = L.marker([item.lat, item.lng]).addTo(t.map).bindPopup(popup);
      t.markers.push(marker);
    });
  },

  renderList(items) {
    const container = document.getElementById('tripListContainer');
    document.getElementById('tripCountHeader').innerText = `📸 우리 가족 여행 앨범 (${items.length}곳)`;

    if (!items || items.length === 0) {
      container.innerHTML = '<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:30px 0;">아직 등록된 여행 기록이 없습니다. ✨</div>';
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="trip-card">
        ${item.photo ? `<img src="${item.photo}" class="trip-thumb">` : `<div class="trip-thumb" style="display:flex;align-items:center;justify-content:center;font-size:24px;">🏝️</div>`}
        <div class="trip-info">
          <div>
            <div class="trip-title-row">
              <span class="trip-title">${escapeHtml(item.place)}</span>
              <button type="button" class="delete-item-btn" onclick="App.trip.delete('${item.id}')">✕</button>
            </div>
            <div class="trip-date">📅 ${escapeHtml(item.date)}</div>
            <div class="trip-memo">${escapeHtml(item.memo)}</div>
          </div>
          <div class="trip-action-row">
            <button type="button" class="btn-focus-map" onclick="App.trip.focusOnMap(${item.lat}, ${item.lng})">🗺️ 지도에서 보기</button>
          </div>
        </div>
      </div>`).join('');
  }
};