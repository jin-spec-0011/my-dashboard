window.App = window.App || {};

App.calendar = {
  monthNamesEng: ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"],
  holidayCache: {},
  fixedHolidays: { "1-1": "신정", "3-1": "3·1절", "5-5": "어린이날", "6-6": "현충일", "8-15": "광복절", "10-3": "개천절", "10-9": "한글날", "12-25": "성탄절" },
  isMobileView: true,
  showPrivate: true,

  /* 📱 모바일 뷰 ↔ 🖥️ A4 원본 뷰 전환 */
  toggleViewMode() {
    this.isMobileView = !this.isMobileView;
    const page = document.getElementById('plannerPage');
    const btn = document.getElementById('btnToggleViewMode');

    if (page) {
      page.classList.toggle('cal-view-mobile', this.isMobileView);
      page.classList.toggle('cal-view-full', !this.isMobileView);
    }
    if (btn) {
      btn.innerText = this.isMobileView ? '📱 모바일 뷰' : '🖥️ A4 원본 뷰';
    }
    if (App.ui?.toast) {
      App.ui.toast(this.isMobileView ? '📱 모바일 맞춤 화면으로 변경되었습니다.' : '🖥️ A4 원본(40px) 뷰로 변경되었습니다.');
    }
  },

  /* 🔒 비공개 일정 표시/숨김 토글 */
  togglePrivate() {
    this.showPrivate = !this.showPrivate;
    const btn = document.getElementById('btnTogglePrivate');

    if (btn) {
      btn.innerText = this.showPrivate ? '🔒 비공개: 표시' : '🔒 비공개: 숨김';
      btn.classList.toggle('off', !this.showPrivate);
    }

    this.generate();
    if (App.ui?.toast) {
      App.ui.toast(this.showPrivate ? '🔒 비공개 일정이 표시됩니다.' : '🔒 비공개 일정이 캘린더에서 제외되었습니다.');
    }
  },

  async fetchHolidays(year) {
    if (this.holidayCache[year]) return this.holidayCache[year];

    const localSaved = safeGet(`holiday_api_${year}`);
    if (localSaved) {
      try {
        this.holidayCache[year] = JSON.parse(localSaved);
        return this.holidayCache[year];
      } catch (e) {}
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const map = {};
        data.forEach(item => {
          const parts = item.date.split('-');
          const m = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          let name = item.localName || item.name;
          if (name === '기독탄신일') name = '성탄절';
          map[`${m}-${d}`] = name;
        });
        this.holidayCache[year] = map;
        safeSet(`holiday_api_${year}`, JSON.stringify(map));
        return map;
      }
    } catch (err) {}
    return null;
  },

  getHoliday(y, m, d) {
    if (this.holidayCache[y] && this.holidayCache[y][`${m}-${d}`]) {
      return this.holidayCache[y][`${m}-${d}`];
    }
    if (this.fixedHolidays[`${m}-${d}`]) {
      return this.fixedHolidays[`${m}-${d}`];
    }
    return null;
  },

  saveGoal() {
    const y = document.getElementById('yearInput')?.value || 2026;
    const m = document.getElementById('monthInput')?.value || 8;
    const text = document.getElementById('monthGoal')?.value || '';
    const key = `planner_goal_${y}_${m}`;
    safeSet(key, text);
    clearTimeout(App.state?.calendar?.syncTimeout);
    if (App.state?.calendar) {
      App.state.calendar.syncTimeout = setTimeout(() => {
        if (App.isFirebaseActive) App.db.ref(`calendar_data/${key}`).set(text);
        if (App.ticker) App.ticker.refresh();
      }, 600);
    }
  },

  saveBottomMemo(type) {
    const y = document.getElementById('yearInput')?.value || 2026;
    const m = document.getElementById('monthInput')?.value || 8;
    const elem = document.getElementById('bottomNotes');
    const text = elem ? elem.value : '';
    const key = `planner_bottom_${type}_${y}_${m}`;
    safeSet(key, text);
    clearTimeout(App.state?.calendar?.syncTimeout);
    if (App.state?.calendar) {
      App.state.calendar.syncTimeout = setTimeout(() => {
        if (App.isFirebaseActive) App.db.ref(`calendar_data/${key}`).set(text);
      }, 600);
    }
  },

  async generate() {
    const yearInput = document.getElementById('yearInput');
    const monthInput = document.getElementById('monthInput');

    const year = parseInt(yearInput?.value, 10) || new Date().getFullYear();
    const month = parseInt(monthInput?.value, 10) || (new Date().getMonth() + 1);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return;

    if (!this.holidayCache[year]) {
      await this.fetchHolidays(year);
    }

    const monthStr = String(month).padStart(2, '0');
    const subHeader = document.getElementById('headerYearSub');
    const numHeader = document.getElementById('headerMonthNum');
    const textHeader = document.getElementById('headerMonthText');

    if (subHeader) subHeader.innerText = `${year} ${this.monthNamesEng[month - 1]}`;
    if (numHeader) numHeader.innerText = monthStr;
    if (textHeader) textHeader.innerText = `${year}년 ${month}월`;

    const goalInput = document.getElementById('monthGoal');
    const notesInput = document.getElementById('bottomNotes');

    if (goalInput) goalInput.value = safeGet(`planner_goal_${year}_${month}`);
    if (notesInput) notesInput.value = safeGet(`planner_bottom_notes_${year}_${month}`);

    // 안전한 일정 취합 로직
    let allSchedules = [];
    try {
      if (App.schedule && typeof App.schedule.getAllSchedules === 'function') {
        allSchedules = App.schedule.getAllSchedules();
      } else if (App.stores?.schedules) {
        allSchedules = App.stores.schedules.getItems();
      }
    } catch (e) {
      allSchedules = [];
    }

    if (!Array.isArray(allSchedules)) allSchedules = [];
    if (!this.showPrivate) {
      allSchedules = allSchedules.filter(s => s && !s.isPrivate);
    }

    const tbody = document.getElementById('calendarBody');
    if (!tbody) return;

    const firstDayIndex = new Date(year, month - 1, 1).getDay();
    const lastDayDate = new Date(year, month, 0).getDate();
    const prevLastDayDate = new Date(year, month - 1, 0).getDate();

    let nextMonthDateCount = 1;
    let currentDay = 1 - firstDayIndex;
    let html = '';
    const monthEventsSummary = [];

    for (let week = 0; week < 6; week++) {
      if (week === 5 && currentDay > lastDayDate) break;
      html += '<tr>';
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        let isOtherMonth = false, dYear = year, dMonth = month, dText = 1;

        if (currentDay < 1) {
          dText = prevLastDayDate + currentDay;
          isOtherMonth = true;
          dMonth = month - 1;
          if (dMonth < 1) { dMonth = 12; dYear = year - 1; }
        } else if (currentDay > lastDayDate) {
          dText = nextMonthDateCount++;
          isOtherMonth = true;
          dMonth = month + 1;
          if (dMonth > 12) { dMonth = 1; dYear = year + 1; }
        } else {
          dText = currentDay;
        }

        const dateKey = `${dYear}-${String(dMonth).padStart(2, '0')}-${String(dText).padStart(2, '0')}`;
        const holiday = this.getHoliday(dYear, dMonth, dText);
        const colorClass = (dayOfWeek === 0 || holiday) ? 'sun-num' : (dayOfWeek === 6 ? 'sat-num' : 'weekday-num');
        const otherClass = isOtherMonth ? 'other-month' : '';
        const holidayHtml = holiday ? `<span class="holiday-tag">${escapeHtml(holiday)}</span>` : '';

        // 일정 태그 생성
        const dayEvents = allSchedules.filter(s => s && s.date === dateKey);
        let eventsHtml = '';
        if (dayEvents.length > 0) {
          eventsHtml = `<div class="cell-event-list">` + dayEvents.map(e => {
            if (!e) return '';
            const tagClass = e.isPrivate ? 'event-tag-private' : (e.author === '진세' ? 'event-tag-jinse' : (e.author === '지혜' ? 'event-tag-jihye' : 'event-tag-family'));
            const prefix = e.isPrivate ? '🔒' : `[${escapeHtml(e.author || '진세')}]`;
            if (!isOtherMonth) monthEventsSummary.push(`${dMonth}/${dText} ${prefix} ${e.title || ''}`);
            return `<div class="cell-event-item ${tagClass}"><span>${prefix}</span> ${escapeHtml(e.title || '')}</div>`;
          }).join('') + `</div>`;
        }

        html += `
          <td>
            <div class="cell-inner ${otherClass}">
              <div class="date-header-row">
                <span class="day-num ${colorClass}">${dText}</span>
                ${holidayHtml}
              </div>
              ${eventsHtml}
            </div>
          </td>`;
        currentDay++;
      }
      html += '</tr>';
    }

    tbody.innerHTML = html;

    const summaryEl = document.getElementById('bottomTodoSummary');
    if (summaryEl) {
      summaryEl.innerHTML = monthEventsSummary.length > 0
        ? monthEventsSummary.slice(0, 6).map(s => `• ${escapeHtml(s)}`).join('<br>')
        : '이달에 등록된 일정이 없습니다.';
    }
  }
};
