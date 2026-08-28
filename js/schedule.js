window.App = window.App || {};

App.schedule = {
  currentAuthor: '진세',

  init() {
    const dateInp = document.getElementById('scheduleDateInput');
    if (dateInp) {
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      dateInp.value = new Date(now.getTime() - offset).toISOString().split('T')[0];
    }
  },

  selectAuthor(author) {
    this.currentAuthor = author;
    document.querySelectorAll('#scheduleAuthorGroup .btn-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.innerText.trim() === author);
    });
  },

  getAllSchedules() {
    const publicList = App.stores?.schedules ? App.stores.schedules.getItems() : [];
    let privateList = [];

    const user = App.auth?.currentUser || 'public';
    if (user === 'jinse' && App.stores?.privateJinse) {
      privateList = App.stores.privateJinse.getItems().map(i => ({ ...i, isPrivate: true }));
    } else if (user === 'jihye' && App.stores?.privateJihye) {
      privateList = App.stores.privateJihye.getItems().map(i => ({ ...i, isPrivate: true }));
    }

    const merged = [...publicList, ...privateList];
    merged.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.id) || 0) - (Number(a.id) || 0));
    return merged;
  },

  add() {
    const titleInput = document.getElementById('scheduleTitleInput');
    const dateInput = document.getElementById('scheduleDateInput');
    const privateCheck = document.getElementById('schedulePrivateCheck');

    const title = titleInput ? titleInput.value.trim() : '';
    const date = dateInput ? dateInput.value : '';
    const isPrivate = privateCheck ? privateCheck.checked : false;

    if (!title) return alert("일정 제목을 입력해주세요.");
    if (!date) return alert("날짜를 선택해주세요.");

    const author = (App.auth && App.auth.currentUser !== 'public')
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜')
      : this.currentAuthor;

    const newSchedule = {
      id: Date.now(),
      title: title,
      date: date,
      author: author,
      isPrivate: isPrivate
    };

    if (isPrivate) {
      const user = App.auth?.currentUser;
      if (user === 'jinse' && App.stores?.privateJinse) {
        App.stores.privateJinse.add(newSchedule);
      } else if (user === 'jihye' && App.stores?.privateJihye) {
        App.stores.privateJihye.add(newSchedule);
      } else {
        alert("비공개 일정은 개인 프로필(진세/지혜) 모드에서만 등록할 수 있습니다.");
        return;
      }
    } else {
      if (App.stores?.schedules) {
        App.stores.schedules.add(newSchedule);
      }
    }

    if (titleInput) titleInput.value = '';
    if (privateCheck) privateCheck.checked = false;

    App.ui.toast(`🗓️ [${author}] 일정이 등록되었습니다.`);
    this.render();
    if (App.calendar) App.calendar.generate();
    if (App.ticker) App.ticker.refresh();
  },

  delete(id, isPrivate) {
    if (confirm("해당 일정을 삭제하시겠습니까?")) {
      if (isPrivate) {
        const user = App.auth?.currentUser;
        if (user === 'jinse' && App.stores?.privateJinse) {
          App.stores.privateJinse.remove(id);
        } else if (user === 'jihye' && App.stores?.privateJihye) {
          App.stores.privateJihye.remove(id);
        }
      } else {
        if (App.stores?.schedules) {
          App.stores.schedules.remove(id);
        }
      }
      App.ui.toast("🗑️ 일정이 삭제되었습니다.");
      this.render();
      if (App.calendar) App.calendar.generate();
      if (App.ticker) App.ticker.refresh();
    }
  },

  render() {
    const listEl = document.getElementById('scheduleList');
    if (!listEl) return;

    const schedules = this.getAllSchedules();

    if (schedules.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">등록된 일정이 없습니다. 🗓️</div>`;
      return;
    }

    listEl.innerHTML = schedules.map(item => {
      const titleText = item.title || item.text || '일정';
      const lockBadge = item.isPrivate ? `<span style="color:#be185d;font-size:11px;font-weight:700;">🔒 나만보기</span>` : '';
      return `
        <div class="log-item">
          <div class="log-content">
            <div class="log-text">${escapeHtml(titleText)} ${lockBadge}</div>
            <div class="log-time">📅 ${escapeHtml(item.date || '')} · 작성자: ${escapeHtml(item.author || '가족')}</div>
          </div>
          <button type="button" class="delete-item-btn" onclick="App.schedule.delete('${item.id}', ${Boolean(item.isPrivate)})">✕</button>
        </div>
      `;
    }).join('');
  }
};