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

    // 1일의 시작 요일 (0 = 일요일, 6 = 토요일)
    const firstDay = new Date(year, month - 1, 1).getDay();
    // 해당 월의 마지막 날짜
    const lastDate = new Date(year, month, 0).getDate();

    const allSchedules = App.schedule ? App.schedule.getAllSchedules() : [];
    let cellsHtml = '';

    // 1일 이전의 빈 셀 채우기
    for (let i = 0; i < firstDay; i++) {
      cellsHtml += `<div class="cal-cell empty"></div>`;
    }

    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];

    // 1일부터 마지막 날까지 렌더링
    for (let day = 1; day <= lastDate; day++) {
      const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
      const isToday = (dateStr === todayStr);
      const dayOfWeek = (firstDay + day - 1) % 7; // 0 = 일요일, 6 = 토요일

      const daySchedules = allSchedules.filter(s => s && s.date === dateStr);

      let eventsHtml = '';
      daySchedules.forEach(s => {
        const titleText = s.title || s.text || '일정';
        const lockIcon = s.isPrivate ? '🔒' : '';
        const authorBadge = s.isPrivate ? '' : (s.author ? `[${s.author}]` : '');
        const isPriv = Boolean(s.isPrivate);
        eventsHtml += `
          <div class="cal-event-tag ${isPriv ? 'private' : ''}" title="${escapeHtml(titleText)}">
            ${lockIcon}${authorBadge} ${escapeHtml(titleText)}
          </div>
        `;
      });

      const dayClass = dayOfWeek === 0 ? 'sun' : (dayOfWeek === 6 ? 'sat' : '');

      cellsHtml += `
        <div class="cal-cell ${isToday ? 'today' : ''}">
          <div class="cal-date-num ${dayClass}">${day}</div>
          <div class="cal-events-wrap">${eventsHtml}</div>
        </div>
      `;
    }

    gridEl.innerHTML = cellsHtml;
  }
};
