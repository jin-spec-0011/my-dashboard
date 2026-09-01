window.App = window.App || {};

App.schedule = {
  currentAuthor: '진세',
  editingId: null,
  editingIsPrivate: false,

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
    const btnJinse = document.getElementById('btn-author-jinse');
    const btnJihye = document.getElementById('btn-author-jihye');
    const btnFam = document.getElementById('btn-author-fam');

    if (btnJinse) btnJinse.classList.toggle('active', author === '진세');
    if (btnJihye) btnJihye.classList.toggle('active', author === '지혜');
    if (btnFam) btnFam.classList.toggle('active', author === '가족');
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

  /* 4번 요구사항: 일정 항목 클릭 시 수정 모드로 전환 */
  startEdit(id, isPrivate) {
    const schedules = this.getAllSchedules();
    const target = schedules.find(s => String(s.id) === String(id));
    if (!target) return;

    this.editingId = id;
    this.editingIsPrivate = Boolean(isPrivate);

    const titleInput = document.getElementById('scheduleTitleInput');
    const dateInput = document.getElementById('scheduleDateInput');
    const privateCheck = document.getElementById('schedulePrivateCheck');
    const saveBtn = document.getElementById('btnSaveSchedule');
    const banner = document.getElementById('scheduleEditBanner');

    if (titleInput) titleInput.value = target.title || target.text || '';
    if (dateInput) dateInput.value = target.date || '';
    if (privateCheck) privateCheck.checked = Boolean(target.isPrivate);
    this.selectAuthor(target.author || '진세');

    if (saveBtn) {
      saveBtn.innerText = "💾 일정 수정 완료";
      saveBtn.style.background = "#059669";
    }
    if (banner) banner.style.display = 'flex';

    // 폼으로 스크롤 이동
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (titleInput) titleInput.focus();
    App.ui.toast("✏️ 일정을 수정할 수 있습니다.");
  },

  cancelEdit() {
    this.editingId = null;
    this.editingIsPrivate = false;

    const titleInput = document.getElementById('scheduleTitleInput');
    const privateCheck = document.getElementById('schedulePrivateCheck');
    const saveBtn = document.getElementById('btnSaveSchedule');
    const banner = document.getElementById('scheduleEditBanner');

    if (titleInput) titleInput.value = '';
    if (privateCheck) privateCheck.checked = false;
    if (saveBtn) {
      saveBtn.innerText = "일정 등록";
      saveBtn.style.background = "var(--primary-color)";
    }
    if (banner) banner.style.display = 'none';
  },

  /* 신규 등록 또는 기존 일정 수정 저장 */
  saveOrUpdate() {
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

    // 1. 기존 일정 수정 모드일 때
    if (this.editingId) {
      const oldId = this.editingId;
      const oldIsPrivate = this.editingIsPrivate;

      // 비공개 상태가 변경되었을 경우 기존 위치 삭제 후 새 위치에 추가
      if (oldIsPrivate !== isPrivate) {
        this.deleteSilently(oldId, oldIsPrivate);
        const newSched = { id: Date.now(), title, date, author, isPrivate };
        this.insertSchedule(newSched, isPrivate);
      } else {
        const updates = { title, date, author, isPrivate };
        if (isPrivate) {
          const user = App.auth?.currentUser;
          if (user === 'jinse') App.stores?.privateJinse?.update(oldId, updates);
          else if (user === 'jihye') App.stores?.privateJihye?.update(oldId, updates);
        } else {
          App.stores?.schedules?.update(oldId, updates);
        }
      }

      App.ui.toast(`✅ [${author}] 일정이 수정되었습니다.`);
      this.cancelEdit();
    } 
    // 2. 신규 등록 모드일 때
    else {
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
    }

    this.render();
    if (App.calendar) App.calendar.generate();
    if (App.ticker) App.ticker.refresh();
  },

  insertSchedule(item, isPrivate) {
    if (isPrivate) {
      const user = App.auth?.currentUser;
      if (user === 'jinse') App.stores?.privateJinse?.add(item);
      else if (user === 'jihye') App.stores?.privateJihye?.add(item);
    } else {
      App.stores?.schedules?.add(item);
    }
  },

  deleteSilently(id, isPrivate) {
    if (isPrivate) {
      const user = App.auth?.currentUser;
      if (user === 'jinse') App.stores?.privateJinse?.remove(id);
      else if (user === 'jihye') App.stores?.privateJihye?.remove(id);
    } else {
      App.stores?.schedules?.remove(id);
    }
  },

  /* 0번 요구사항: 삭제 시 팝업 확인 */
  delete(id, isPrivate) {
    if (confirm("해당 일정을 삭제하시겠습니까?")) {
      this.deleteSilently(id, isPrivate);
      if (this.editingId === id) this.cancelEdit();
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
      const isEditingThis = (this.editingId === item.id);

      return `
        <div class="log-item ${isEditingThis ? 'schedule-editing-item' : ''}">
          <div class="log-content" onclick="App.schedule.startEdit('${item.id}', ${Boolean(item.isPrivate)})" style="cursor:pointer;" title="클릭하여 수정">
            <div class="log-text">
              ${escapeHtml(titleText)} ${lockBadge}
              <span class="click-edit-tag">✏️ 클릭 시 수정</span>
            </div>
            <div class="log-time">📅 ${escapeHtml(item.date || '')} · 작성자: ${escapeHtml(item.author || '가족')}</div>
          </div>
          <button type="button" class="delete-item-btn" onclick="App.schedule.delete('${item.id}', ${Boolean(item.isPrivate)})">✕</button>
        </div>
      `;
    }).join('');
  }
};
