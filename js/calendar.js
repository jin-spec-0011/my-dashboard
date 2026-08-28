window.App = window.App || {};

App.calendar = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,

  init() {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth() + 1;
    this.updateInputs();
    this.generate();
  },

  prevMonth() {
    this.currentMonth--;
    if (this.currentMonth < 1) {
      this.currentMonth = 12;
      this.currentYear--;
    }
    this.updateInputs();
    this.generate();
  },

  nextMonth() {
    this.currentMonth++;
    if (this.currentMonth > 12) {
      this.currentMonth = 1;
      this.currentYear++;
    }
    this.updateInputs();
    this.generate();
  },

  updateInputs() {
    const yInp = document.getElementById('yearInput');
    const mInp = document.getElementById('monthInput');
    if (yInp) yInp.value = this.currentYear;
    if (mInp) mInp.value = this.currentMonth;
  },

  saveGoal(val) {
    const key = `calendar_goal_${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}`;
    safeSet(key, val);
    if (App.isFirebaseActive && App.db) {
      App.db.ref(`calendar_data/${key}`).set(val);
    }
  },

  saveMemo(val) {
    const key = `calendar_memo_${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}`;
    safeSet(key, val);
    if (App.isFirebaseActive && App.db) {
      App.db.ref(`calendar_data/${key}`).set(val);
    }
  },

  generate() {
    const yInp = document.getElementById('yearInput');
    const mInp = document.getElementById('monthInput');
    if (yInp && yInp.value) this.currentYear = parseInt(yInp.value, 10);
    if (mInp && mInp.value) this.currentMonth = parseInt(mInp.value, 10);

    const year = this.currentYear;
    const month = this.currentMonth;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    const goalInp = document.getElementById('calendarGoalInput');
    const memoInp = document.getElementById('calendarMemoInput');
    if (goalInp) goalInp.value = safeGet(`calendar_goal_${monthKey}`) || '';
    if (memoInp) memoInp.value = safeGet(`calendar_memo_${monthKey}`) || '';

    const gridEl = document.getElementById('calendarGrid');
    if (!gridEl) return;

    const firstDay = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();

    const allSchedules = App.schedule ? App.schedule.getAllSchedules() : [];
    let cellsHtml = '';

    for (let i = 0; i < firstDay; i++) {
      cellsHtml += `<div class="cal-cell empty"></div>`;
    }

    const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

    for (let day = 1; day <= lastDate; day++) {
      const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
      const isToday = (dateStr === todayStr);

      const daySchedules = allSchedules.filter(s => s && s.date === dateStr);

      let eventsHtml = '';
      daySchedules.forEach(s => {
        const titleText = s.title || s.text || '일정';
        const lockIcon = s.isPrivate ? '🔒' : '';
        const authorBadge = s.isPrivate ? '' : `[${s.author || '가족'}]`;
        eventsHtml += `
          <div class="cal-event-tag ${s.isPrivate ? 'private' : ''}" title="${escapeHtml(titleText)}">
            ${lockIcon}${authorBadge} ${escapeHtml(titleText)}
          </div>
        `;
      });

      cellsHtml += `
        <div class="cal-cell ${isToday ? 'today' : ''}">
          <div class="cal-date-num">${day}</div>
          <div class="cal-events-wrap">${eventsHtml}</div>
        </div>
      `;
    }

    gridEl.innerHTML = cellsHtml;
  }
};
