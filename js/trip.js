window.App = window.App || {};

App.trip = {
  init() {
    const dateInp = document.getElementById('tripDateInput');
    if (dateInp) {
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      dateInp.value = new Date(now.getTime() - offset).toISOString().split('T')[0];
    }
  },

  save() {
    const placeInp = document.getElementById('tripPlaceInput');
    const dateInp = document.getElementById('tripDateInput');
    const memoInp = document.getElementById('tripMemoInput');

    const place = placeInp ? placeInp.value.trim() : '';
    const date = dateInp ? dateInp.value : '';
    const memo = memoInp ? memoInp.value.trim() : '';

    if (!place) return alert("여행지 이름을 입력하세요.");
    if (!date) return alert("여행 날짜를 선택하세요.");

    const author = (App.auth && App.auth.currentUser !== 'public') 
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜') 
      : '가족';

    const newTrip = {
      id: Date.now(),
      place: place,
      date: date,
      memo: memo,
      author: author
    };

    if (App.stores?.trips) {
      App.stores.trips.add(newTrip);
    }

    if (placeInp) placeInp.value = '';
    if (memoInp) memoInp.value = '';

    App.ui.toast(`✈️ '${place}' 여행 기록이 저장되었습니다!`);
    this.renderList(App.stores?.trips ? App.stores.trips.getItems() : []);
  },

  delete(id) {
    if (confirm("해당 여행 기록을 삭제하시겠습니까?")) {
      if (App.stores?.trips) {
        App.stores.trips.remove(id);
        App.ui.toast("🗑️ 여행 기록이 삭제되었습니다.");
        this.renderList(App.stores.trips.getItems());
      }
    }
  },

  renderList(items = []) {
    const listEl = document.getElementById('tripList');
    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">등록된 여행 기록이 없습니다. ✈️</div>`;
      return;
    }

    listEl.innerHTML = items.map(item => {
      const placeText = item.place || item.title || item.text || '여행지';
      const memoText = item.memo || item.desc || '';
      return `
        <div class="log-item">
          <div class="log-content">
            <div class="log-text">📍 ${escapeHtml(placeText)}</div>
            <div class="log-time">📅 ${escapeHtml(item.date || '')} ${memoText ? '· ' + escapeHtml(memoText) : ''}</div>
          </div>
          <button type="button" class="delete-item-btn" onclick="App.trip.delete('${item.id}')">✕</button>
        </div>
      `;
    }).join('');
  }
};
