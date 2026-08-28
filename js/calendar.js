window.App = window.App || {};

App.calendar = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  currentDeviceView: 'web', // 'iphone' | 'ipad' | 'web'

  init() {
    const now = new Date();
    this.currentYear = now.getFullYear();
    this.currentMonth = now.getMonth() + 1;
    this.updateInputs();
    this.generate();
  },

  /* 📱 아이폰 / 아이패드 / PC(웹) 뷰어 모드 전환 */
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

  /* 🎯 목표 입력 저장 및 빈 값 감지 */
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

  /* 📌 메모 입력 저장 및 빈 값 감지 */
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

  /* 🔄 일정 데이터로부터 해당 월의 일정 메모 자동 생성 */
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

  /* 🔄 사용자가 수동으로 일정 다시 동기화할 때 호출 */
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

  /* 🗓️ 7열 CSS Grid 정밀 균등 생성 */
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

    // 1. 목표 로드 및 빈 값 체크
    const goalVal = safeGet(`calendar_goal_${monthKey}`) || '';
    const goalInp = document.getElementById('calendarGoalInput');
    const goalBox = document.getElementById('calGoalBox');

    if (goalInp) goalInp.value = goalVal;
    if (goalBox) goalBox.classList.toggle('is-empty', !goalVal.trim());

    // 2. 메모 로드: 저장된 수동 메모가 없으면 해당 월의 일정을 자동으로 가져옴
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

    // 3. 1일 요일 및 총 주차 계산
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0(일) ~ 6(토)
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

    // 4. 7열 균등 셀 생성
    for (let i = 0; i < totalCells; i++) {
      const col = i % 7;

      if (i < firstDay) {
        cellsHtml += `<div class="cal-grid-cell cell-empty"></div>`;
      } else if (currentDay > lastDate) {
        cellsHtml += `<div class="cal-grid-cell cell-empty"></div>`;
      } else {
        const dateStr = `${monthKey}-${String(currentDay).padStart(2, '0')}`;
        const isToday = (dateStr === todayStr);

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

        const numClass = col === 0 ? 'sun' : (col === 6 ? 'sat' : '');

        cellsHtml += `
          <div class="cal-grid-cell ${isToday ? 'cell-today' : ''}">
            <div class="cell-date-num ${numClass}">${currentDay}</div>
            <div class="cell-events-wrap">${eventsHtml}</div>
          </div>
        `;

        currentDay++;
      }
    }

    gridBody.innerHTML = cellsHtml;
  }
};