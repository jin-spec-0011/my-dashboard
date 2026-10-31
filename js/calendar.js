window.App = window.App || {};

App.calendar = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1,
  currentDeviceView: 'web',

  holidays: {
    "2024-01-01": "신정", "2024-02-09": "설연휴", "2024-02-10": "설날", "2024-02-11": "설연휴", "2024-02-12": "대체공휴일",
    "2024-03-01": "삼일절", "2024-04-10": "총선", "2024-05-05": "어린이날", "2024-05-06": "대체공휴일", "2024-05-15": "부처님오신날",
    "2024-06-06": "현충일", "2024-08-15": "광복절", "2024-09-16": "추석연휴", "2024-09-17": "추석", "2024-09-18": "추석연휴",
    "2024-10-01": "국군의날", "2024-10-03": "개천절", "2024-10-09": "한글날", "2024-12-25": "성탄절",

    "2025-01-01": "신정", "2025-01-28": "설연휴", "2025-01-29": "설날", "2025-01-30": "설연휴",
    "2025-03-01": "삼일절", "2025-03-03": "대체공휴일", "2025-05-05": "어린이날", "2025-05-06": "대체공휴일",
    "2025-06-06": "현충일", "2025-08-15": "광복절", "2025-10-03": "개천절", "2025-10-05": "추석연휴", "2025-10-06": "추석",
    "2025-10-07": "추석연휴", "2025-10-08": "대체공휴일", "2025-10-09": "한글날", "2025-12-25": "성탄절",

    "2026-01-01": "신정", "2026-02-16": "설연휴", "2026-02-17": "설날", "2026-02-18": "설연휴",
    "2026-03-01": "삼일절", "2026-03-02": "대체공휴일", "2026-05-05": "어린이날", "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일",
    "2026-06-03": "지방선거", "2026-06-06": "현충일", "2026-08-15": "광복절", "2026-08-17": "대체공휴일",
    "2026-09-24": "추석연휴", "2026-09-25": "추석", "2026-09-26": "추석연휴", "2026-09-28": "대체공휴일",
    "2026-10-03": "개천절", "2026-10-05": "대체공휴일", "2026-10-09": "한글날", "2026-12-25": "성탄절",

    "2027-01-01": "신정", "2027-02-06": "설연휴", "2027-02-07": "설날", "2027-02-08": "설연휴", "2027-02-09": "대체공휴일",
    "2027-03-01": "삼일절", "2027-05-05": "어린이날", "2027-05-13": "부처님오신날", "2027-06-06": "현충일", "2027-06-07": "대체공휴일",
    "2027-08-15": "광복절", "2027-08-16": "대체공휴일", "2027-09-14": "추석연휴", "2027-09-15": "추석", "2027-09-16": "추석연휴",
    "2027-10-03": "개천절", "2027-10-04": "대체공휴일", "2027-10-09": "한글날", "2027-10-11": "대체공휴일", "2027-12-25": "성탄절"
  },

  getHoliday(dateStr, month, day) {
    if (this.holidays[dateStr]) return this.holidays[dateStr];
    const mmdd = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const fixedHolidays = {
      "01-01": "신정", "03-01": "삼일절", "05-05": "어린이날", "06-06": "현충일",
      "08-15": "광복절", "10-03": "개천절", "10-09": "한글날", "12-25": "성탄절"
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

  /* iOS/iPadOS 판별 (iPadOS 13+ 데스크톱 UA: MacIntel + 터치 포인트 포함) */
  _isIOS() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1;
  },

  /* 홈 화면 PWA(standalone) 실행 여부 — iOS standalone은 window.print()가 무시됨 */
  _isStandalone() {
    try {
      if (window.navigator.standalone === true) return true;
      return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) {
      return false;
    }
  },

  /* 목표/메모 공란 박스 숨김 클래스 동기화 */
  _syncEmptyBoxes() {
    const goalInp = document.getElementById('calendarGoalInput');
    const memoInp = document.getElementById('calendarMemoInput');
    const goalBox = document.getElementById('calGoalBox');
    const footerBox = document.getElementById('calFooterBox');
    if (goalBox) goalBox.classList.toggle('is-empty', !(goalInp && goalInp.value.trim()));
    if (footerBox) footerBox.classList.toggle('is-empty', !(memoInp && memoInp.value.trim()));
  },

  _pdfFilename() {
    return `GOGO캘린더_${this.currentYear}년_${this.currentMonth}월.pdf`;
  },

  /* .pdf-export-mode(794 x 1120px) 주입 후 html2pdf 워커 실행 → 즉시 복원 */
  async _runPdf(handler) {
    const element = document.getElementById('printCalendarSheet');
    if (!element) throw new Error('printCalendarSheet 요소 없음');
    if (typeof window.html2pdf !== 'function') throw new Error('html2pdf 미로딩');

    this._syncEmptyBoxes();

    /* textarea는 html2canvas에서 줄바꿈이 잘리므로 캡처 동안 div로 치환 */
    const memoInp = document.getElementById('calendarMemoInput');
    let memoClone = null;
    if (memoInp && memoInp.parentNode) {
      memoClone = document.createElement('div');
      memoClone.className = 'memo-textarea';
      memoClone.style.whiteSpace = 'pre-wrap';
      memoClone.textContent = memoInp.value;
      memoInp.style.display = 'none';
      memoInp.parentNode.insertBefore(memoClone, memoInp.nextSibling);
    }

    /* 뷰어 모드(폰/패드 축소 스케일) 영향 제거 */
    const wrapper = document.getElementById('calendarViewportWrapper');
    const prevWrapperClass = wrapper ? wrapper.className : '';
    if (wrapper) wrapper.className = 'calendar-viewport-wrapper view-web';

    element.classList.add('pdf-export-mode');
    const restore = () => {
      element.classList.remove('pdf-export-mode');
      if (wrapper) wrapper.className = prevWrapperClass;
      if (memoClone && memoClone.parentNode) memoClone.parentNode.removeChild(memoClone);
      if (memoInp) memoInp.style.display = '';
    };

    const opt = {
      margin: [0, 0, 0, 0],
      filename: this._pdfFilename(),
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true, width: 794, height: 1120, windowWidth: 794, scrollX: 0, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const worker = window.html2pdf().set(opt).from(element);
      return await handler(worker);
    } finally {
      restore();
    }
  },

  /* A4 PDF 내보내기 (다운로드) */
  async exportPDF() {
    if (this._exporting) return;
    if (typeof window.html2pdf !== 'function') {
      App.ui.toast('⚠️ PDF 라이브러리 로딩 전입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    this._exporting = true;
    App.ui.toast('📄 PDF 생성 중입니다. 잠시만 기다려주세요...');
    try {
      await this._runPdf((worker) => worker.save());
      App.ui.toast('✅ PDF 다운로드가 완료되었습니다!');
    } catch (err) {
      console.warn('[Calendar] html2pdf 오류:', err);
      App.ui.toast('⚠️ PDF 생성에 실패했습니다.');
    } finally {
      this._exporting = false;
    }
  },

  /* 인쇄 버튼 진입점
     - PC/일반 브라우저: 사용자 제스처 내 동기 window.print() (A4 @media print)
     - iOS/iPadOS 홈 화면 PWA: print() 무시됨 → A4 PDF 생성 → 공유 시트 '프린트'
     - 그 외 print() 무반응(beforeprint 미발생) 시 동일 PDF 경로로 폴백 */
  print() {
    if (App.router) App.router.go('calendar');
    this._syncEmptyBoxes();

    if (this._isIOS() && this._isStandalone()) {
      this.printViaPdf();
      return;
    }

    let fired = false;
    const onBefore = () => { fired = true; };
    window.addEventListener('beforeprint', onBefore, { once: true });

    try {
      window.print();
    } catch (err) {
      console.warn('[Calendar] window.print 오류:', err);
    }

    setTimeout(() => {
      window.removeEventListener('beforeprint', onBefore);
      if (!fired && typeof window.onbeforeprint !== 'undefined') {
        console.warn('[Calendar] 인쇄 창 미표시 → PDF 인쇄 경로로 전환');
        this.printViaPdf();
      }
    }, 1500);
  },

  /* PDF Blob 생성 후 '인쇄 / 공유' 시트 표시 (공유 호출은 새 탭 제스처에서 수행) */
  async printViaPdf() {
    if (this._exporting) return;
    if (typeof window.html2pdf !== 'function') {
      App.ui.toast('⚠️ PDF 라이브러리 로딩 전입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    this._exporting = true;
    App.ui.toast('🖨️ 인쇄용 A4 PDF 생성 중...');
    try {
      const blob = await this._runPdf((worker) => worker.outputPdf('blob'));
      if (!(blob instanceof Blob) || blob.size === 0) throw new Error('PDF Blob 생성 실패');
      this._openPrintSheet(blob);
    } catch (err) {
      console.warn('[Calendar] 인쇄용 PDF 생성 오류:', err);
      App.ui.toast('⚠️ 인쇄용 PDF 생성에 실패했습니다.');
    } finally {
      this._exporting = false;
    }
  },

  _closePrintSheet() {
    const sheet = document.getElementById('calPrintSheetModal');
    if (sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
    if (this._printBlobUrl) {
      try { URL.revokeObjectURL(this._printBlobUrl); } catch (e) { /* noop */ }
      this._printBlobUrl = null;
    }
    this._printFile = null;
  },

  _openPrintSheet(blob) {
    this._closePrintSheet();
    const filename = this._pdfFilename();
    let file = null;
    try {
      file = new File([blob], filename, { type: 'application/pdf' });
    } catch (e) {
      file = null;
    }
    this._printFile = file;
    this._printBlobUrl = URL.createObjectURL(blob);

    const canShareFile = !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));

    const overlay = document.createElement('div');
    overlay.id = 'calPrintSheetModal';
    overlay.className = 'modal-overlay no-print';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal-card">
        <button type="button" class="modal-close-icon-btn" data-act="close" title="닫기">✕</button>
        <div class="modal-header"><h3>🖨️ A4 인쇄 준비 완료</h3></div>
        <div class="modal-body">
          <p class="modal-desc">${canShareFile
            ? '아래 버튼 → 공유 시트에서 <b>프린트</b>를 선택하세요.'
            : 'PDF를 연 뒤 공유(⬆️) → <b>프린트</b>를 선택하세요.'}</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-modal-save" data-act="${canShareFile ? 'share' : 'open'}">
            ${canShareFile ? '🖨️ 인쇄 / 공유 열기' : '📄 PDF 열기'}
          </button>
          ${canShareFile ? '<button type="button" class="btn-modal-secondary" data-act="open">📄 PDF 미리보기</button>' : ''}
          <button type="button" class="btn-modal-cancel" data-act="close">닫기</button>
        </div>
      </div>`;

    overlay.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) {
        if (e.target === overlay) this._closePrintSheet();
        return;
      }
      const act = btn.getAttribute('data-act');
      if (act === 'close') {
        this._closePrintSheet();
      } else if (act === 'share') {
        try {
          await navigator.share({ files: [this._printFile], title: filename });
          this._closePrintSheet();
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          console.warn('[Calendar] 공유 시트 오류:', err);
          App.ui.toast('⚠️ 공유 시트를 열 수 없어 PDF를 엽니다.');
          this._openPdfUrl(filename);
        }
      } else if (act === 'open') {
        this._openPdfUrl(filename);
      }
    });

    document.body.appendChild(overlay);
  },

  _openPdfUrl(filename) {
    if (!this._printBlobUrl) return;
    const a = document.createElement('a');
    a.href = this._printBlobUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    if (!this._isIOS()) a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
    const [y, m] = monthKey.split('-').map(Number);
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    const thisMonthSchedules = allSchedules
      .filter((s) => s && s.date && s.date <= monthEnd && scheduleEnd(s) >= monthStart)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    if (thisMonthSchedules.length === 0) return '';

    return thisMonthSchedules.map((s) => {
      const lockBadge = s.isPrivate ? '🔒' : '';
      const author = s.isPrivate ? '비공개' : (s.author || '가족');
      const title = s.title || s.text || '일정';
      const end = scheduleEnd(s);
      const when = end !== s.date ? `${s.date.substring(5)}~${end.substring(5)}` : s.date.substring(5);
      return `• ${when} ${lockBadge}[${author}] ${title}`;
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
    const yVal = yInp ? parseInt(yInp.value, 10) : NaN;
    const mVal = mInp ? parseInt(mInp.value, 10) : NaN;
    if (!isNaN(yVal) && yVal >= 1900 && yVal <= 2200) this.currentYear = yVal;
    if (!isNaN(mVal) && mVal >= 1 && mVal <= 12) this.currentMonth = mVal;
    this.updateInputs();

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
    const todayDate = todayStr();
    const monthStart = `${monthKey}-01`;
    const monthEnd = `${monthKey}-${String(lastDate).padStart(2, '0')}`;

    /* 1) 날짜 셀 (모두 먼저 출력 → :nth-child 테두리 규칙 유지) */
    let cellsHtml = '';
    const totalCells = totalWeeks * 7;
    for (let i = 0; i < totalCells; i++) {
      const col = i % 7;
      const row = Math.floor(i / 7) + 1;
      const day = i - firstDay + 1;
      const pos = `grid-row:${row};grid-column:${col + 1};`;
      if (day < 1 || day > lastDate) {
        cellsHtml += `<div class="cal-grid-cell cell-empty" style="${pos}"></div>`;
        continue;
      }
      const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;
      const holidayName = this.getHoliday(dateStr, month, day);
      const numClass = (col === 0 || holidayName) ? 'sun' : (col === 6 ? 'sat' : '');
      cellsHtml += `
        <div class="cal-grid-cell ${dateStr === todayDate ? 'cell-today' : ''}" style="${pos}">
          <div class="cell-date-row">
            <span class="cell-date-num ${numClass}">${day}</span>
            ${holidayName ? `<span class="cell-holiday-tag">${escapeHtml(holidayName)}</span>` : ''}
          </div>
        </div>`;
    }

    /* 2) 일정 막대: 이번 달과 겹치는 일정 → 주(row) 단위 구간으로 분할 → 레인 배정 */
    const events = allSchedules
      .filter((s) => s && s.date && s.date <= monthEnd && scheduleEnd(s) >= monthStart)
      .map((s) => {
        const end = scheduleEnd(s);
        const clipStart = s.date < monthStart ? monthStart : s.date;
        const clipEnd = end > monthEnd ? monthEnd : end;
        return {
          s,
          startIdx: firstDay + daysBetween(monthStart, clipStart),
          endIdx: firstDay + daysBetween(monthStart, clipEnd),
          beforeMonth: s.date < monthStart,
          afterMonth: end > monthEnd,
          span: daysBetween(s.date, end) + 1
        };
      })
      .sort((a, b) => a.startIdx - b.startIdx || b.span - a.span || String(a.s.id).localeCompare(String(b.s.id)));

    let barsHtml = '';
    for (let w = 0; w < totalWeeks; w++) {
      const wStart = w * 7;
      const wEnd = wStart + 6;
      const lanes = []; /* lanes[n] = 해당 레인에서 마지막으로 사용된 열 index */
      events.forEach((ev) => {
        if (ev.endIdx < wStart || ev.startIdx > wEnd) return;
        const segStart = Math.max(ev.startIdx, wStart);
        const segEnd = Math.min(ev.endIdx, wEnd);
        let lane = lanes.findIndex((lastCol) => lastCol < segStart);
        if (lane === -1) {
          lane = lanes.length;
          lanes.push(segEnd);
        } else {
          lanes[lane] = segEnd;
        }

        const s = ev.s;
        const isStart = segStart === ev.startIdx && !ev.beforeMonth;
        const isEnd = segEnd === ev.endIdx && !ev.afterMonth;
        const titleText = s.title || s.text || '일정';
        const colorClass = s.isPrivate ? 'bar-private'
          : (s.author === '진세' ? 'bar-jinse' : (s.author === '지혜' ? 'bar-jihye' : 'bar-family'));
        const prefix = s.isPrivate ? '🔒' : (s.author ? `[${s.author}] ` : '');
        const label = `${isStart ? '' : '◀ '}${prefix}${titleText}`;
        const range = ev.span > 1 ? ` (${s.date.substring(5)}~${scheduleEnd(s).substring(5)})` : '';

        barsHtml += `
          <div class="cal-bar ${colorClass} ${isStart ? 'bar-start' : ''} ${isEnd ? 'bar-end' : ''} ${ev.span > 1 ? 'bar-multi' : ''}"
               style="grid-row:${w + 1};grid-column:${(segStart % 7) + 1} / ${(segEnd % 7) + 2};--lane:${lane};"
               title="${escapeHtml(prefix + titleText + range)}">${escapeHtml(label)}</div>`;
      });
    }

    cellsHtml += barsHtml;

    gridBody.innerHTML = cellsHtml;
  }
};
