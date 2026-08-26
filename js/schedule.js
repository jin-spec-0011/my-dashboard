window.App = window.App || {};

App.schedule = {
  currentYearMonth: '',
  category: '가족행사',
  author: '진세',
  editingId: null,

  init() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    this.currentYearMonth = `${y}-${m}`;

    const dateInput = document.getElementById('scheduleDateInput');
    if (dateInput) {
      const offset = now.getTimezoneOffset() * 60000;
      dateInput.value = new Date(now.getTime() - offset).toISOString().split('T')[0];
    }
  },

  selectCategory(cat) {
    this.category = cat;
    document.querySelectorAll('.memo-input-card .category-selector-group .cat-chip').forEach(el => {
      el.classList.toggle('active', el.innerText.includes(cat));
    });
  },

  selectAuthor(a) {
    this.author = a;
    document.querySelectorAll('.memo-tag-selector .tag-chip').forEach(el => {
      if (el.id && el.id.startsWith('schedule-tag-')) el.classList.remove('active');
    });
    const map = { '진세': 'schedule-tag-jinse', '지혜': 'schedule-tag-jihye', '가족': 'schedule-tag-family' };
    if (map[a]) {
      const target = document.getElementById(map[a]);
      if (target) target.classList.add('active');
    }
  },

  changeMonth(delta) {
    if (!this.currentYearMonth) this.init();
    const [yStr, mStr] = this.currentYearMonth.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10) + delta;

    if (m < 1) { m = 12; y--; }
    else if (m > 12) { m = 1; y++; }

    this.currentYearMonth = `${y}-${String(m).padStart(2, '0')}`;
    this.render();
  },

  /* 🔒 현재 활성 프로필에 따라 공개 + 비공개 일정 안전 병합 */
  getAllSchedules() {
    let publicList = [];
    try {
      publicList = App.stores?.schedules ? App.stores.schedules.getItems() : [];
      if (!Array.isArray(publicList)) publicList = [];
    } catch (e) { publicList = []; }

    let privateList = [];
    const user = App.auth?.currentUser || 'public';

    if (user === 'jinse') {
      privateList = App.stores?.privateJinse ? App.stores.privateJinse.getItems() : [];
    } else if (user === 'jihye') {
      privateList = App.stores?.privateJihye ? App.stores.privateJihye.getItems() : [];
    }

    return [...publicList, ...privateList].filter(Boolean);
  },

  add() {
    const dateInput = document.getElementById('scheduleDateInput');
    const titleInput = document.getElementById('scheduleTitleInput');
    const memoInput = document.getElementById('scheduleMemoInput');
    const isPrivate = document.getElementById('schedulePrivateCheck')?.checked || false;

    const date = dateInput ? dateInput.value : '';
    const title = titleInput ? titleInput.value.trim() : '';
    const memo = memoInput ? memoInput.value.trim() : '';

    if (!date) return alert('날짜를 선택해주세요.');
    if (!title) return alert('일정 제목을 입력해주세요.');

    const activeUser = App.auth?.currentUser || 'public';
    if (isPrivate && activeUser === 'public') {
      alert("비공개 일정을 등록하려면 상단에서 [진세] 또는 [지혜] 프로필로 먼저 인증해주세요.");
      return;
    }

    const newSchedule = {
      id: Date.now(),
      date: date,
      month: date.substring(0, 7),
      title: title,
      category: this.category,
      author: this.author,
      memo: memo,
      isPrivate: isPrivate
    };

    if (isPrivate) {
      if (activeUser === 'jinse' && App.stores?.privateJinse) {
        App.stores.privateJinse.add(newSchedule);
      } else if (activeUser === 'jihye' && App.stores?.privateJihye) {
        App.stores.privateJihye.add(newSchedule);
      }
      App.ui.toast(`🔒 [${title}] 비공개 클라우드 일정이 등록되었습니다.`);
    } else {
      if (App.stores?.schedules) {
        App.stores.schedules.add(newSchedule);
      }
      App.ui.toast(`🗓️ [${title}] 가족 공유 일정이 등록되었습니다!`);
    }

    if (titleInput) titleInput.value = '';
    if (memoInput) memoInput.value = '';
    const checkEl = document.getElementById('schedulePrivateCheck');
    if (checkEl) checkEl.checked = false;

    this.render();
    if (App.calendar?.generate) App.calendar.generate();
    if (App.ticker) App.ticker.refresh();
  },

  openEditModal(id) {
    const all = this.getAllSchedules();
    const item = all.find(i => String(i.id) === String(id));
    if (!item) return;

    this.editingId = id;
    document.getElementById('editScheduleDate').value = item.date;
    document.getElementById('editScheduleTitle').value = item.title;
    document.getElementById('editScheduleCategory').value = item.category || '가족행사';
    document.getElementById('editScheduleAuthor').value = item.author || '진세';
    document.getElementById('editScheduleMemo').value = item.memo || '';
    
    const pCheck = document.getElementById('editSchedulePrivateCheck');
    if (pCheck) pCheck.checked = !!item.isPrivate;

    const modal = document.getElementById('schedule-edit-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeEditModal() {
    const modal = document.getElementById('schedule-edit-modal');
    if (modal) modal.style.display = 'none';
    this.editingId = null;
  },

  saveEdit() {
    if (!this.editingId) return;
    const date = document.getElementById('editScheduleDate').value;
    const title = document.getElementById('editScheduleTitle').value.trim();
    const category = document.getElementById('editScheduleCategory').value;
    const author = document.getElementById('editScheduleAuthor').value;
    const memo = document.getElementById('editScheduleMemo').value.trim();
    const isPrivate = document.getElementById('editSchedulePrivateCheck')?.checked || false;

    if (!date) return alert('날짜를 입력해주세요.');
    if (!title) return alert('일정 제목을 입력해주세요.');

    const all = this.getAllSchedules();
    const existing = all.find(i => String(i.id) === String(this.editingId));
    if (!existing) return;

    const activeUser = App.auth?.currentUser || 'public';
    const targetStore = (activeUser === 'jinse') ? App.stores?.privateJinse : App.stores?.privateJihye;

    const updated = {
      id: Number(this.editingId),
      date: date,
      month: date.substring(0, 7),
      title: title,
      category: category,
      author: author,
      memo: memo,
      isPrivate: isPrivate
    };

    // 기존 저장소에서 제거 후 상태에 따라 재분기 저장
    if (existing.isPrivate && targetStore) {
      targetStore.remove(this.editingId);
    } else if (App.stores?.schedules) {
      App.stores.schedules.remove(this.editingId);
    }

    if (isPrivate && targetStore) {
      targetStore.add(updated);
    } else if (App.stores?.schedules) {
      App.stores.schedules.add(updated);
    }

    this.closeEditModal();
    this.render();
    if (App.calendar?.generate) App.calendar.generate();
    if (App.ticker) App.ticker.refresh();
    App.ui.toast('✅ 일정이 수정되었습니다.');
  },

  delete(id) {
    const all = this.getAllSchedules();
    const item = all.find(i => String(i.id) === String(id));
    if (!item) return;

    if (confirm(`[${item.title}] 일정을 삭제하시겠습니까?`)) {
      const activeUser = App.auth?.currentUser || 'public';
      const targetStore = (activeUser === 'jinse') ? App.stores?.privateJinse : App.stores?.privateJihye;

      if (item.isPrivate && targetStore) {
        targetStore.remove(id);
      } else if (App.stores?.schedules) {
        App.stores.schedules.remove(id);
      }

      this.render();
      if (App.calendar?.generate) App.calendar.generate();
      if (App.ticker) App.ticker.refresh();
      App.ui.toast('🗑️ 일정이 삭제되었습니다.');
    }
  },

  exportCSV() {
    const items = this.getAllSchedules()
      .filter(i => (i.month || i.date?.substring(0, 7)) === this.currentYearMonth);
    
    if (items.length === 0) return alert('내보낼 일정이 없습니다.');

    items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    let csvContent = '\uFEFF';
    csvContent += '날짜,카테고리,작성자,공개여부,일정제목,상세메모\n';

    items.forEach(i => {
      const row = [
        `"${i.date}"`,
        `"${i.category || '가족행사'}"`,
        `"${i.author || '진세'}"`,
        `"${i.isPrivate ? '비공개(나만보기)' : '가족공유'}"`,
        `"${(i.title || '').replace(/"/g, '""')}"`,
        `"${(i.memo || '').replace(/"/g, '""')}"`
      ];
      csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${this.currentYearMonth}_일정목록.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    App.ui.toast('📥 일정 엑셀(CSV) 파일이 다운로드되었습니다!');
  },

  render() {
    if (!this.currentYearMonth) this.init();

    const [y, m] = this.currentYearMonth.split('-');
    const monthText = document.getElementById('scheduleCurrentMonthText');
    if (monthText) monthText.innerText = `${y}년 ${parseInt(m, 10)}월`;

    const all = this.getAllSchedules();
    const filtered = all.filter(i => (i.month || i.date?.substring(0, 7)) === this.currentYearMonth);
    filtered.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const countEl = document.getElementById('scheduleCountLabel');
    const listEl = document.getElementById('scheduleListContainer');

    if (countEl) countEl.innerText = `총 ${filtered.length}건`;
    if (!listEl) return;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:30px 0;">${parseInt(m, 10)}월 등록된 일정이 없습니다. ✨</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(item => {
      const authorClass = item.isPrivate ? 'author-private' : (item.author === '진세' ? 'author-jinse' : (item.author === '지혜' ? 'author-jihye' : 'author-family'));
      const authorLabel = item.isPrivate ? `🔒 ${item.author}(나만보기)` : escapeHtml(item.author || '진세');

      return `
        <div class="schedule-item ${item.isPrivate ? 'is-private' : ''}" onclick="App.schedule.openEditModal('${item.id}')">
          <div class="schedule-item-left">
            <div class="schedule-item-top">
              <span class="schedule-cat-badge">${escapeHtml(item.category || '가족행사')}</span>
              <span class="schedule-author-badge ${authorClass}">${authorLabel}</span>
              <span class="schedule-item-title">${escapeHtml(item.title)}</span>
            </div>
            <span class="schedule-item-date">📅 ${escapeHtml(item.date)}</span>
            ${item.memo ? `<span class="schedule-item-memo">📝 ${escapeHtml(item.memo)}</span>` : ''}
          </div>
          <button type="button" class="delete-item-btn" onclick="event.stopPropagation(); App.schedule.delete('${item.id}')">✕</button>
        </div>
      `;
    }).join('');
  }
};
