/**
 * GOGO 스마트 매니저 - 가족 일정 관리 (js/schedule.js)
 * - 단일 / 연속(기간) 일정: { id, title, date(시작일), endDate(종료일, 선택), author, isPrivate }
 * - endDate가 없거나 date와 같으면 하루 일정 (기존 데이터 100% 호환)
 * - 저장소: /family_schedules (공개), /private_schedules/{jinse|jihye} (비공개)
 */
window.App = window.App || {};

App.schedule = {
  currentAuthor: '진세',
  editingId: null,
  editingIsPrivate: false,

  init() {
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');
    const today = todayStr();
    if (startInp && !startInp.value) startInp.value = today;
    if (endInp && !endInp.value) endInp.value = startInp ? startInp.value : today;
    this.syncEndMin();
    this.updateRangeHint();
  },

  /* 시작일 변경 시 기존 기간(일수)을 유지한 채 종료일도 함께 이동 */
  onStartDateChange() {
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');
    if (startInp && endInp && startInp.value) {
      const prevStart = this._lastStart || startInp.value;
      const prevEnd = endInp.value || prevStart;
      const duration = Math.max(0, daysBetween(prevStart, prevEnd));
      endInp.value = addDays(startInp.value, duration);
    }
    this.syncEndMin();
    this.updateRangeHint();
  },

  onEndDateChange() {
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');
    if (startInp && endInp && endInp.value && startInp.value && endInp.value < startInp.value) {
      App.ui.toast('⚠️ 종료일은 시작일보다 빠를 수 없습니다.');
      endInp.value = startInp.value;
    }
    this.updateRangeHint();
  },

  /* 기간 빠른 선택: 당일/1박2일/2박3일/1주 */
  setDuration(days) {
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');
    if (!startInp || !endInp) return;
    if (!startInp.value) startInp.value = todayStr();
    endInp.value = addDays(startInp.value, Math.max(0, days - 1));
    this.syncEndMin();
    this.updateRangeHint();
  },

  syncEndMin() {
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');
    if (startInp && endInp) endInp.min = startInp.value || '';
    this._lastStart = startInp ? startInp.value : '';
  },

  updateRangeHint() {
    const hint = document.getElementById('scheduleRangeHint');
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');
    if (!hint || !startInp || !endInp) return;
    const start = startInp.value;
    const end = endInp.value || start;
    if (!start) {
      hint.innerText = '';
      return;
    }
    const days = daysBetween(start, end) + 1;
    hint.innerText = days <= 1 ? '📍 하루 일정' : `🗓️ ${days - 1}박 ${days}일 연속 일정`;
  },

  selectAuthor(author) {
    this.currentAuthor = author;
    const map = { 'btn-author-jinse': '진세', 'btn-author-jihye': '지혜', 'btn-author-fam': '가족' };
    Object.keys(map).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', map[id] === author);
    });
  },

  getAllSchedules() {
    const publicList = App.stores && App.stores.schedules ? App.stores.schedules.getItems() : [];
    let privateList = [];
    const user = App.auth ? App.auth.currentUser : 'public';
    if (user === 'jinse' && App.stores && App.stores.privateJinse) {
      privateList = App.stores.privateJinse.getItems().map((i) => Object.assign({}, i, { isPrivate: true }));
    } else if (user === 'jihye' && App.stores && App.stores.privateJihye) {
      privateList = App.stores.privateJihye.getItems().map((i) => Object.assign({}, i, { isPrivate: true }));
    }
    const merged = [...publicList, ...privateList];
    merged.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (Number(b.id) || 0) - (Number(a.id) || 0));
    return merged;
  },

  /* "10-28 ~ 10-31 (4일)" / "2026-10-28" */
  formatRange(item) {
    const start = item.date || '';
    const end = scheduleEnd(item);
    if (!start) return '';
    if (end === start) return start;
    const days = daysBetween(start, end) + 1;
    const endLabel = end.substring(0, 4) === start.substring(0, 4) ? end.substring(5) : end;
    return `${start} ~ ${endLabel} (${days}일)`;
  },

  startEdit(id, isPrivate) {
    const target = this.getAllSchedules().find((s) => String(s.id) === String(id));
    if (!target) return;

    this.editingId = target.id;
    this.editingIsPrivate = Boolean(isPrivate);

    const titleInput = document.getElementById('scheduleTitleInput');
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');
    const privateCheck = document.getElementById('schedulePrivateCheck');
    const saveBtn = document.getElementById('btnSaveSchedule');
    const banner = document.getElementById('scheduleEditBanner');

    if (titleInput) titleInput.value = target.title || target.text || '';
    if (startInp) startInp.value = target.date || '';
    if (endInp) endInp.value = scheduleEnd(target) || target.date || '';
    if (privateCheck) privateCheck.checked = Boolean(target.isPrivate);
    this.selectAuthor(target.author || '진세');
    this.syncEndMin();
    this.updateRangeHint();

    if (saveBtn) {
      saveBtn.innerText = '💾 일정 수정 완료';
      saveBtn.style.background = '#059669';
    }
    if (banner) banner.style.display = 'flex';

    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (titleInput) titleInput.focus();
    this.render();
    App.ui.toast('✏️ 일정을 수정할 수 있습니다.');
  },

  cancelEdit() {
    this.editingId = null;
    this.editingIsPrivate = false;

    const titleInput = document.getElementById('scheduleTitleInput');
    const privateCheck = document.getElementById('schedulePrivateCheck');
    const saveBtn = document.getElementById('btnSaveSchedule');
    const banner = document.getElementById('scheduleEditBanner');
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');

    if (titleInput) titleInput.value = '';
    if (privateCheck) privateCheck.checked = false;
    if (startInp && endInp) endInp.value = startInp.value;
    if (saveBtn) {
      saveBtn.innerText = '일정 등록';
      saveBtn.style.background = 'var(--primary-color)';
    }
    if (banner) banner.style.display = 'none';
    this.syncEndMin();
    this.updateRangeHint();
    this.render();
  },

  getPrivateStore() {
    const user = App.auth ? App.auth.currentUser : 'public';
    if (user === 'jinse') return App.stores.privateJinse;
    if (user === 'jihye') return App.stores.privateJihye;
    return null;
  },

  saveOrUpdate() {
    const titleInput = document.getElementById('scheduleTitleInput');
    const startInp = document.getElementById('scheduleDateInput');
    const endInp = document.getElementById('scheduleEndDateInput');
    const privateCheck = document.getElementById('schedulePrivateCheck');

    const title = titleInput ? titleInput.value.trim() : '';
    const date = startInp ? startInp.value : '';
    let endDate = endInp && endInp.value ? endInp.value : date;
    const isPrivate = privateCheck ? privateCheck.checked : false;

    if (!title) {
      alert('일정 제목을 입력해주세요.');
      if (titleInput) titleInput.focus();
      return;
    }
    if (!date) return alert('시작일을 선택해주세요.');
    if (endDate < date) return alert('종료일은 시작일보다 빠를 수 없습니다.');
    if (daysBetween(date, endDate) > 365) return alert('연속 일정은 최대 366일까지 등록할 수 있습니다.');
    if (endDate === date) endDate = null;

    if (isPrivate && !this.getPrivateStore()) {
      return alert('비공개 일정은 개인 프로필(진세/지혜) 모드에서만 등록할 수 있습니다.');
    }

    const user = App.auth ? App.auth.currentUser : 'public';
    const author = user === 'jinse' ? '진세' : (user === 'jihye' ? '지혜' : this.currentAuthor);
    const fields = { title, date, endDate, author, isPrivate };

    if (this.editingId !== null) {
      const oldId = this.editingId;
      const oldIsPrivate = this.editingIsPrivate;
      if (oldIsPrivate !== isPrivate) {
        this.deleteSilently(oldId, oldIsPrivate);
        this.insertSchedule(Object.assign({ id: Date.now() }, fields), isPrivate);
      } else if (isPrivate) {
        this.getPrivateStore().update(oldId, fields);
      } else {
        App.stores.schedules.update(oldId, fields);
      }
      App.ui.toast(`✅ [${author}] 일정이 수정되었습니다.`);
      this.cancelEdit();
    } else {
      this.insertSchedule(Object.assign({ id: Date.now() }, fields), isPrivate);
      if (titleInput) titleInput.value = '';
      if (privateCheck) privateCheck.checked = false;
      if (endInp && startInp) endInp.value = startInp.value;
      this.updateRangeHint();
      App.ui.toast(`🗓️ [${author}] ${endDate ? '연속 ' : ''}일정이 등록되었습니다.`);
    }

    this.render();
    if (App.calendar) App.calendar.generate();
    if (App.summary) App.summary.refresh();
  },

  insertSchedule(item, isPrivate) {
    if (isPrivate) {
      const store = this.getPrivateStore();
      if (store) store.add(item);
    } else if (App.stores && App.stores.schedules) {
      App.stores.schedules.add(item);
    }
  },

  deleteSilently(id, isPrivate) {
    if (isPrivate) {
      const store = this.getPrivateStore();
      if (store) store.remove(id);
    } else if (App.stores && App.stores.schedules) {
      App.stores.schedules.remove(id);
    }
  },

  delete(id, isPrivate) {
    if (!confirm('해당 일정을 삭제하시겠습니까?')) return;
    this.deleteSilently(id, isPrivate);
    if (this.editingId !== null && String(this.editingId) === String(id)) this.cancelEdit();
    App.ui.toast('🗑️ 일정이 삭제되었습니다.');
    this.render();
    if (App.calendar) App.calendar.generate();
    if (App.summary) App.summary.refresh();
  },

  render() {
    const listEl = document.getElementById('scheduleList');
    if (!listEl) return;
    const schedules = this.getAllSchedules();
    if (schedules.length === 0) {
      listEl.innerHTML = '<div class="empty-msg">등록된 일정이 없습니다. 🗓️</div>';
      return;
    }
    listEl.innerHTML = schedules.map((item) => {
      const id = escapeHtml(String(item.id));
      const titleText = item.title || item.text || '일정';
      const isRange = scheduleEnd(item) !== item.date;
      const lockBadge = item.isPrivate ? '<span class="schedule-tag tag-private">🔒 나만보기</span>' : '';
      const rangeBadge = isRange ? '<span class="schedule-tag tag-range">연속</span>' : '';
      const isEditingThis = this.editingId !== null && String(this.editingId) === String(item.id);
      return `
        <div class="log-item ${isEditingThis ? 'schedule-editing-item' : ''}">
          <div class="log-content" onclick="App.schedule.startEdit('${id}', ${Boolean(item.isPrivate)})" style="cursor:pointer;" title="클릭하여 수정">
            <div class="log-text">
              ${escapeHtml(titleText)} ${rangeBadge}${lockBadge}
              <span class="click-edit-tag">✏️ 수정</span>
            </div>
            <div class="log-time">📅 ${escapeHtml(this.formatRange(item))} · 작성자: ${escapeHtml(item.author || '가족')}</div>
          </div>
          <button type="button" class="delete-item-btn" onclick="App.schedule.delete('${id}', ${Boolean(item.isPrivate)})" title="삭제">✕</button>
        </div>`;
    }).join('');
  }
};
