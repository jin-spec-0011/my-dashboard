window.App = window.App || {};

App.calendar = {
  monthNamesEng: ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"],
  holidayCache: {},
  fixedHolidays: { "1-1": "신정", "3-1": "3·1절", "5-5": "어린이날", "6-6": "현충일", "8-15": "광복절", "10-3": "개천절", "10-9": "한글날", "12-25": "성탄절" },

  // 공휴일 비동기 패칭
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
      const timeoutId = setTimeout(() => controller.abort(), 2500);
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
    } catch (err) {
      console.warn(`[Holiday API] ${year}년 공휴일 통신 지연. 기본 공휴일로 표시합니다.`);
    }
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

  updateGridStyle(density) {
    const root = document.documentElement;
    const config = {
      light: { c: '#cbd5e1', w: '1px' },
      medium: { c: '#94a3b8', w: '1.2px' },
      dark: { c: '#475569', w: '1.5px' },
      black: { c: '#0f172a', w: '2px' }
    }[density] || { c: '#475569', w: '1.5px' };
    root.style.setProperty('--grid-color', config.c);
    root.style.setProperty('--grid-width', config.w);
  },

  // 폰트 크기 실시간 동기화
  syncFontSize(val, fromInput = false) {
    const rangeEl = document.getElementById('fontSizeRange');
    const inputEl = document.getElementById('fontSizeInput');
    const displayEl = document.getElementById('fontSizeDisplay');

    if (val === '') return;
    let num = parseInt(val, 10);
    if (isNaN(num)) return;

    if (displayEl) displayEl.innerText = num;
    if (rangeEl && fromInput) rangeEl.value = Math.max(10, Math.min(50, num));
    if (inputEl && !fromInput) inputEl.value = num;

    document.querySelectorAll('.day-num').forEach(el => el.style.fontSize = num + 'px');
  },

  clampFontSize() {
    const inputEl = document.getElementById('fontSizeInput');
    const rangeEl = document.getElementById('fontSizeRange');
    let num = parseInt(inputEl.value, 10);
    if (isNaN(num) || num < 10) num = 10;
    if (num > 50) num = 50;
    
    inputEl.value = num;
    if (rangeEl) rangeEl.value = num;
    this.syncFontSize(num);
  },

  saveCellMemo(key, text) {
    safeSet(key, text);
    clearTimeout(App.state.calendar.syncTimeout);
    App.state.calendar.syncTimeout = setTimeout(() => {
      if (App.isFirebaseActive) App.db.ref('calendar_data/' + key).set(text);
    }, 600);
  },

  saveGoal() {
    const y = document.getElementById('yearInput').value, m = document.getElementById('monthInput').value;
    const text = document.getElementById('monthGoal').value;
    const key = `planner_goal_${y}_${m}`;
    safeSet(key, text);
    clearTimeout(App.state.calendar.syncTimeout);
    App.state.calendar.syncTimeout = setTimeout(() => {
      if (App.isFirebaseActive) App.db.ref(`calendar_data/${key}`).set(text);
      App.ticker.refresh();
    }, 600);
  },

  saveBottomMemo(type) {
    const y = document.getElementById('yearInput').value, m = document.getElementById('monthInput').value;
    const elem = document.getElementById(type === 'todo' ? 'bottomTodo' : 'bottomNotes');
    const text = elem.value;
    const key = `planner_bottom_${type}_${y}_${m}`;
    safeSet(key, text);
    clearTimeout(App.state.calendar.syncTimeout);
    App.state.calendar.syncTimeout = setTimeout(() => {
      if (App.isFirebaseActive) App.db.ref(`calendar_data/${key}`).set(text);
    }, 600);
  },

  clearCurrentMonth() {
    if (confirm("현재 달의 작성된 메모를 모두 지우시겠습니까?")) {
      const y = document.getElementById('yearInput').value, m = document.getElementById('monthInput').value;
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith(`planner_memo_${y}_${m}_`) || k === `planner_goal_${y}_${m}` || (k.startsWith(`planner_bottom_`) && k.endsWith(`_${y}_${m}`))) {
            localStorage.removeItem(k);
            if (App.isFirebaseActive) App.db.ref('calendar_data/' + k).remove();
          }
        });
      } catch(e){}
      this.generate();
    }
  },

  async generate() {
    const yearInput = document.getElementById('yearInput');
    const monthInput = document.getElementById('monthInput');
    const fontSizeInput = document.getElementById('fontSizeInput');

    const year = parseInt(yearInput?.value) || new Date().getFullYear();
    const month = parseInt(monthInput?.value) || (new Date().getMonth() + 1);
    const fontSize = parseInt(fontSizeInput?.value) || 16;

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return;

    // 공휴일 캐시 없으면 비동기 패칭
    if (!this.holidayCache[year]) await this.fetchHolidays(year);

    const monthStr = String(month).padStart(2, '0');
    const subHeader = document.getElementById('headerYearSub');
    const numHeader = document.getElementById('headerMonthNum');
    const textHeader = document.getElementById('headerMonthText');

    if (subHeader) subHeader.innerText = `${year} ${this.monthNamesEng[month - 1]}`;
    if (numHeader) numHeader.innerText = monthStr;
    if (textHeader) textHeader.innerText = `${year}년 ${month}월`;

    const goalInput = document.getElementById('monthGoal');
    const todoInput = document.getElementById('bottomTodo');
    const notesInput = document.getElementById('bottomNotes');

    if (goalInput) goalInput.value = safeGet(`planner_goal_${year}_${month}`);
    if (todoInput) todoInput.value = safeGet(`planner_bottom_todo_${year}_${month}`);
    if (notesInput) notesInput.value = safeGet(`planner_bottom_notes_${year}_${month}`);

    const tbody = document.getElementById('calendarBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const firstDayIndex = new Date(year, month - 1, 1).getDay();
    const lastDayDate = new Date(year, month, 0).getDate();
    const prevLastDayDate = new Date(year, month - 1, 0).getDate();

    let nextMonthDateCount = 1;
    let currentDay = 1 - firstDayIndex;
    let html = '';

    for (let week = 0; week < 6; week++) {
      if (week === 5 && currentDay > lastDayDate) break;
      html += '<tr>';
      for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        let isOtherMonth = false, dYear = year, dMonth = month, dText = '', memoKey = '';

        if (currentDay < 1) {
          dText = prevLastDayDate + currentDay;
          isOtherMonth = true;
          dMonth = month - 1;
          if (dMonth < 1) { dMonth = 12; dYear = year - 1; }
          memoKey = `planner_memo_${dYear}_${dMonth}_${dText}`;
        } else if (currentDay > lastDayDate) {
          dText = nextMonthDateCount++;
          isOtherMonth = true;
          dMonth = month + 1;
          if (dMonth > 12) { dMonth = 1; dYear = year + 1; }
          memoKey = `planner_memo_${dYear}_${dMonth}_${dText}`;
        } else {
          dText = currentDay;
          memoKey = `planner_memo_${year}_${month}_${dText}`;
        }

        const holiday = this.getHoliday(dYear, dMonth, dText);
        let colorClass = (dayOfWeek === 0 || holiday) ? 'sun-num' : (dayOfWeek === 6 ? 'sat-num' : 'weekday-num');
        let otherClass = isOtherMonth ? 'other-month' : '';
        let savedMemo = safeGet(memoKey);
        let holidayHtml = holiday ? `<span class="holiday-tag">${escapeHtml(holiday)}</span>` : '';

        html += `
          <td>
            <div class="cell-inner ${otherClass}">
              <div class="date-header-row">
                <span class="day-num ${colorClass}" style="font-size: ${fontSize}px;">${dText}</span>
                ${holidayHtml}
              </div>
              <textarea class="cell-memo" oninput="App.calendar.saveCellMemo('${memoKey}', this.value)">${escapeHtml(savedMemo)}</textarea>
            </div>
          </td>`;
        currentDay++;
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  }
};
