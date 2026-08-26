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
    this.render(App.stores.schedules ? App.stores.schedules.getItems() : []);
  },

  /* 일정 등록 -> 캘린더 자동 동기화 */
  add() {
    const dateInput = document.getElementById('scheduleDateInput');
    const titleInput = document.getElementById('scheduleTitleInput');
    const memoInput = document.getElementById('scheduleMemoInput');

    const date = dateInput ? dateInput.value : '';
    const title = titleInput ? titleInput.value.trim() : '';
    const memo = memoInput ? memoInput.value.trim() : '';

    if (!date) return alert('날짜를 선택해주세요.');
    if (!title) return alert('일정 제목을 입력해주세요.');

    const newSchedule = {
      id: Date.now(),
      date: date,
      month: date.substring(0, 7),
      title: title,
      category: this.category,
      author: this.author,
      memo: memo
    };

    App.stores.schedules.add(newSchedule);

    if (titleInput) titleInput.value = '';
    if (memoInput) memoInput.value = '';

    // 만년 캘린더 동기화 재생성
    if (App.calendar && App.calendar.generate) {
      App.calendar.generate();
    }

    App.ui.toast(`🗓️ [${title}] 일정이 등록되었습니다!`);
  },

  openEditModal(id) {
    const item = App.stores.schedules.getItems().find(i => String(i.id) === String(id));
    if (!item) return;

    this.editingId = id;
    document.getElementById('editScheduleDate').value = item.date;
    document.getElementById('editScheduleTitle').value = item.title;
    document.getElementById('editScheduleCategory').value = item.category || '가족행사';
    document.getElementById('editScheduleAuthor').value = item.author || '진세';
    document.getElementById('editScheduleMemo').value = item.memo || '';

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

    if (!date) return alert('날짜를 입력해주세요.');
    if (!title) return alert('일정 제목을 입력해주세요.');

    App.stores.schedules.update(this.editingId, {
      date: date,
      month: date.substring(0, 7),
      title: title,
      category: category,
      author: author,
      memo: memo
    });

    this.closeEditModal();

    if (App.calendar && App.calendar.generate) {
      App.calendar.generate();
    }

    App.ui.toast('✅ 일정이 수정되었습니다.');
  },

  delete(id) {
    const item = App.stores.schedules.getItems().find(i => String(i.id) === String(id));
    if (!item) return;

    if (confirm(`[${item.title}] 일정을 삭제하시겠습니까?`)) {
      App.stores.schedules.remove(id);
      if (App.calendar && App.calendar.generate) {
        App.calendar.generate();
      }
      App.ui.toast('🗑️ 일정이 삭제되었습니다.');
    }
  },

  /* 📥 월별 일정 엑셀(CSV) 다운로드 */
  exportCSV() {
    const items = (App.stores.schedules ? App.stores.schedules.getItems() : [])
      .filter(i => (i.month || i.date?.substring(0, 7)) === this.currentYearMonth);
    
    if (items.length === 0) return alert('내보낼 일정이 없습니다.');

    items.sort((a, b) => a.date.localeCompare(b.date));

    let csvContent = '\uFEFF'; // UTF-8 BOM
    csvContent += '날짜,카테고리,작성자,일정제목,상세메모\n';

    items.forEach(i => {
      const row = [
        `"${i.date}"`,
        `"${i.category || '가족행사'}"`,
        `"${i.author || '가족'}"`,
        `"${i.title.replace(/"/g, '""')}"`,
        `"${(i.memo || '').replace(/"/g, '""')}"`
      ];
      csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${this.currentYearMonth}_가족일정목록.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    App.ui.toast('📥 일정 엑셀(CSV) 파일이 다운로드되었습니다!');
  },

  render(items) {
    if (!this.currentYearMonth) this.init();

    const [y, m] = this.currentYearMonth.split('-');
    const monthText = document.getElementById('scheduleCurrentMonthText');
    if (monthText) monthText.innerText = `${y}년 ${parseInt(m, 10)}월`;

    const filtered = (items || []).filter(i => (i.month || i.date?.substring(0, 7)) === this.currentYearMonth);
    filtered.sort((a, b) => a.date.localeCompare(b.date));

    const countEl = document.getElementById('scheduleCountLabel');
    const listEl = document.getElementById('scheduleListContainer');

    if (countEl) countEl.innerText = `총 ${filtered.length}건`;
    if (!listEl) return;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:30px 0;">${parseInt(m, 10)}월 등록된 일정이 없습니다. ✨</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(item => {
      const authorClass = item.author === '진세' ? 'author-jinse' : (item.author === '지혜' ? 'author-jihye' : 'author-family');
      return `
        <div class="schedule-item" onclick="App.schedule.openEditModal('${item.id}')">
          <div class="schedule-item-left">
            <div class="schedule-item-top">
              <span class="schedule-cat-badge">${escapeHtml(item.category || '가족행사')}</span>
              <span class="schedule-author-badge ${authorClass}">${escapeHtml(item.author || '진세')}</span>
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