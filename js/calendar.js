window.App = window.App || {};

App.calendar = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  currentDeviceView: 'web', // 'iphone' | 'ipad' | 'web'

  /* 🇰🇷 대한민국 주요 공휴일 및 대체공휴일 데이터 (2024~2030) */
  holidays: {
    // 2024년
    "2024-01-01": "신정",
    "2024-02-09": "설연휴", "2024-02-10": "설날", "2024-02-11": "설연휴", "2024-02-12": "대체공휴일",
    "2024-03-01": "삼일절",
    "2024-04-10": "총선",
    "2024-05-05": "어린이날", "2024-05-06": "대체공휴일",
    "2024-05-15": "부처님오신날",
    "2024-06-06": "현충일",
    "2024-08-15": "광복절",
    "2024-09-16": "추석연휴", "2024-09-17": "추석", "2024-09-18": "추석연휴",
    "2024-10-01": "국군의날", "2024-10-03": "개천절", "2024-10-09": "한글날",
    "2024-12-25": "성탄절",

    // 2025년
    "2025-01-01": "신정",
    "2025-01-28": "설연휴", "2025-01-29": "설날", "2025-01-30": "설연휴",
    "2025-03-01": "삼일절", "2025-03-03": "대체공휴일",
    "2025-05-05": "어린이날", "2025-05-06": "대체공휴일",
    "2025-06-06": "현충일",
    "2025-08-15": "광복절",
    "2025-10-03": "개천절",
    "2025-10-05": "추석연휴", "2025-10-06": "추석", "2025-10-07": "추석연휴", "2025-10-08": "대체공휴일",
    "2025-10-09": "한글날",
    "2025-12-25": "성탄절",

    // 2026년
    "2026-01-01": "신정",
    "2026-02-16": "설연휴", "2026-02-17": "설날", "2026-02-18": "설연휴",
    "2026-03-01": "삼일절", "2026-03-02": "대체공휴일",
    "2026-05-05": "어린이날",
    "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일",
    "2026-06-03": "지방선거",
    "2026-06-06": "현충일",
    "2026-08-15": "광복절", "2026-08-17": "대체공휴일",
    "2026-09-24": "추석연휴", "2026-09-25": "추석", "2026-09-26": "추석연휴", "2026-09-28": "대체공휴일",
    "2026-10-03": "개천절", "2026-10-05": "대체공휴일",
    "2026-10-09": "한글날",
    "2026-12-25": "성탄절",

    // 2027년
    "2027-01-01": "신정",
    "2027-02-06": "설연휴", "2027-02-07": "설날", "2027-02-08": "설연휴", "2027-02-09": "대체공휴일",
    "2027-03-01": "삼일절",
    "2027-05-05": "어린이날",
    "2027-05-13": "부처님오신날",
    "2027-06-06": "현충일", "2027-06-07": "대체공휴일",
    "2027-08-15": "광복절", "2027-08-16": "대체공휴일",
    "2027-09-14": "추석연휴", "2027-09-15": "추석", "2027-09-16": "추석연휴",
    "2027-10-03": "개천절", "2027-10-04": "대체공휴일",
    "2027-10-09": "한글날", "2027-10-11": "대체공휴일",
    "2027-12-25": "성탄절"
  },

  /* 📅 공휴일 확인 함수 */
  getHoliday(dateStr, month, day) {
    if (this.holidays[dateStr]) return this.holidays[dateStr];

    // 기본 양력 고정 공휴일 (미등록 연도 대비 fallback)
    const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const fixedHolidays = {
      "01-01": "신정",
      "03-01": "삼일절",
      "05-05": "어린이날",
      "06-06": "현충일",
      "08-15": "광복절",
      "10-03": "개천절",
      "10-09": "한글날",
      "12-25": "성탄절"
    };
    return fixedHolidays[mmdd] || "";
  },

  init() {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth() + 1;
    this.updateInputs();
    this.generate();
  },

  setDeviceView(mode) {
    this.currentDeviceView = mode;
    const wrapper = document.getElementById('calendarViewportWrapper');
    if (wrapper) {
      wrapper.className = `calendar-viewport-wrapper view-${mode}`;
    }

    const btnIphone = document.getElementById('btn-view-iphone');
    const btnIpad = document.getElementById('btn-view-ipad');
    const btnWeb = document.getElementById('btn-view-web');

    if (btnIphone) btnIphone.classList.toggle('active', mode === 'iphone');
    if (btnIpad) btnIpad.classList.toggle('active', mode === 'ipad');
    if (btnWeb) btnWeb.classList.toggle('active', mode === 'web');

    const nameMap = { iphone: '📱 아이폰', ipad: '📟 아이패드', web: '💻 PC/웹' };
    App.ui.toast(`${nameMap[mode]} 뷰로 전환되었습니다.`);
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

    const goalBox = document.getElementById('calGoalBox');
    if (goalBox) {
      goalBox.classList.toggle('is-empty', !val.trim());
    }

    if (App.isFirebaseActive && App.db) {
      App.db.ref(`calendar_data/${key}`).set(val);
    }
  },

  saveMemo(val) {
    const key = `calendar_memo_${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}`;
    safeSet(key, val);

    const footerBox = document.getElementById('calFooterBox');
    if (footerBox) {
      footerBox.classList.toggle('is-empty', !val.trim());
    }

    if (App.isFirebaseActive && App.db) {
      App.db.ref(`calendar_data/${key}`).set(val);
    }
  },

  getFormattedScheduleMemos(monthKey) {
    const allSchedules = App.schedule ? App.schedule.getAllSchedules() : [];
    const thisMonthSchedules = allSchedules
      .filter(s => s && s.date && s.date.startsWith(monthKey))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (thisMonthSchedules.length === 0) return '';

    return thisMonthSchedules.map(s => {
      const lockBadge = s.isPrivate ? '🔒' : '';
      const author = s.isPrivate ? '비공개' : (s.author || '가족');
      const title = s.title || s.text || '일정';
      return `• ${s.date.substring(5)} ${lockBadge}[${author}] ${title}`;
    }).join('\n');
  },

  importSchedulesToMemo() {
    const monthKey = `${this.currentYear}-${String(this.currentMonth).padStart(2, '0')}`;
    const generatedMemo = this.getFormattedScheduleMemos(monthKey);

    const memoInp = document.getElementById('calendarMemoInput');
    const footerBox = document.getElementById('calFooterBox');

    if (memoInp) {
      memoInp.value = generatedMemo;
      this.saveMemo(generatedMemo);
    }
    if (footerBox) {
      footerBox.classList.toggle('is-empty', !generatedMemo.trim());
    }

    if (generatedMemo) {
      App.ui.toast(`🗓️ ${this.currentMonth}월 일정을 메모로 불러왔습니다.`);
    } else {
      App.ui.toast(`ℹ️ ${this.currentMonth}월에 등록된 일정이 없습니다.`);
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

    const printTitleEl = document.getElementById('calPrintTitle');
    if (printTitleEl) {
      printTitleEl.innerText = `${year}년 ${month}월`;
    }

    const goalVal = safeGet(`calendar_goal_${monthKey}`) || '';
    const goalInp = document.getElementById('calendarGoalInput');
    const goalBox = document.getElementById('calGoalBox');

    if (goalInp) goalInp.value = goalVal;
    if (goalBox) goalBox.classList.toggle('is-empty', !goalVal.trim());

    let memoVal = safeGet(`calendar_memo_${monthKey}`);
    if (memoVal === null || memoVal === undefined || memoVal === '') {
      memoVal = this.getFormattedScheduleMemos(monthKey);
    }

    const memoInp = document.getElementById('calendarMemoInput');
    const footerBox = document.getElementById('calFooterBox');

    if (memoInp) memoInp.value = memoVal;
    if (footerBox) footerBox.classList.toggle('is-empty', !memoVal.trim());

    const gridBody = document.getElementById('calendarGridBody');
    if (!gridBody) return;

    const firstDay = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();

    const totalDaysNeeded = firstDay + lastDate;
    const totalWeeks = Math.ceil(totalDaysNeeded / 7);
    gridBody.className = `cal-sheet-grid-body cal-rows-${totalWeeks}`;

    const allSchedules = App.schedule ? App.schedule.getAllSchedules() : [];
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];

    let cellsHtml = '';
    const totalCells = totalWeeks * 7;
    let currentDay = 1;

    for (let i = 0; i < totalCells; i++) {
      const col = i % 7;

      if (i < firstDay) {
        cellsHtml += `<div class="cal-grid-cell cell-empty"></div>`;
      } else if (currentDay > lastDate) {
        cellsHtml += `<div class="cal-grid-cell cell-empty"></div>`;
      } else {
        const dateStr = `${monthKey}-${String(currentDay).padStart(2, '0')}`;
        const isToday = (dateStr === todayStr);

        // 🇰🇷 공휴일 확인
        const holidayName = this.getHoliday(dateStr, month, currentDay);
        const isHoliday = Boolean(holidayName);

        const daySchedules = allSchedules.filter(s => s && s.date === dateStr);

        let eventsHtml = '';
        daySchedules.forEach(s => {
          const titleText = s.title || s.text || '일정';
          const lockIcon = s.isPrivate ? '🔒' : '';
          const authorBadge = s.isPrivate ? '' : (s.author ? `[${s.author}]` : '');
          const isPriv = Boolean(s.isPrivate);

          eventsHtml += `
            <div class="td-event-badge ${isPriv ? 'private' : ''}" title="${escapeHtml(titleText)}">
              ${lockIcon}${authorBadge} ${escapeHtml(titleText)}
            </div>
          `;
        });

        // 일요일이거나 공휴일이면 빨간색 강조
        const isRed = (col === 0 || isHoliday);
        const numClass = isRed ? 'sun' : (col === 6 ? 'sat' : '');

        cellsHtml += `
          <div class="cal-grid-cell ${isToday ? 'cell-today' : ''}">
            <div class="cell-date-row">
              <span class="cell-date-num ${numClass}">${currentDay}</span>
              ${isHoliday ? `<span class="cell-holiday-tag">${escapeHtml(holidayName)}</span>` : ''}
            </div>
            <div class="cell-events-wrap">${eventsHtml}</div>
          </div>
        `;

        currentDay++;
      }
    }

    gridBody.innerHTML = cellsHtml;
  }
};
