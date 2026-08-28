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

  /* 📱 아이폰 / 아이패드 / 웹 3단 뷰어 전환 */
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

  /* 🗓️ 7열 표(Table) 기반 캘린더 생성 */
  generate() {
    const yInp = document.getElementById('yearInput');
    const mInp = document.getElementById('monthInput');
    if (yInp && yInp.value) this.currentYear = parseInt(yInp.value, 10);
    if (mInp && mInp.value) this.currentMonth = parseInt(mInp.value, 10);

    const year = this.currentYear;
    const month = this.currentMonth;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    // 인쇄 시트 상단 타이틀 반영
    const printTitleEl = document.getElementById('calPrintTitle');
    if (printTitleEl) {
      printTitleEl.innerText = `${year}년 ${month}월`;
    }

    // 목표 & 메모 로드
    const goalInp = document.getElementById('calendarGoalInput');
    const memoInp = document.getElementById('calendarMemoInput');
    if (goalInp) goalInp.value = safeGet(`calendar_goal_${monthKey}`) || '';
    if (memoInp) memoInp.value = safeGet(`calendar_memo_${monthKey}`) || '';

    const tbody = document.getElementById('calendarTableBody');
    if (!tbody) return;

    // 1일 요일 및 총 일수 계산
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0(일) ~ 6(토)
    const lastDate = new Date(year, month, 0).getDate();

    const allSchedules = App.schedule ? App.schedule.getAllSchedules() : [];
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];

    let rowsHtml = '';
    let currentDay = 1;
    let isMonthFinished = false;

    // 최대 6주차 행 생성
    for (let row = 0; row < 6; row++) {
      if (isMonthFinished) break;
      let rowCells = '';

      for (let col = 0; col < 7; col++) {
        if (row === 0 && col < firstDay) {
          // 1일 이전 빈 칸
          rowCells += `<td class="cal-table-td td-empty"></td>`;
        } else if (currentDay > lastDate) {
          // 월말 이후 빈 칸
          rowCells += `<td class="cal-table-td td-empty"></td>`;
          isMonthFinished = true;
        } else {
          const dateStr = `${monthKey}-${String(currentDay).padStart(2, '0')}`;
          const isToday = (dateStr === todayStr);
          const dayOfWeek = col; // 0: 일, 6: 토

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

          const numClass = dayOfWeek === 0 ? 'sun' : (dayOfWeek === 6 ? 'sat' : '');

          rowCells += `
            <td class="cal-table-td ${isToday ? 'td-today' : ''}">
              <div class="td-date-num ${numClass}">${currentDay}</div>
              <div class="td-events-list">${eventsHtml}</div>
            </td>
          `;

          currentDay++;
          if (currentDay > lastDate) {
            isMonthFinished = true;
          }
        }
      }

      rowsHtml += `<tr>${rowCells}</tr>`;
    }

    tbody.innerHTML = rowsHtml;
  }
};
