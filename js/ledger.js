/**
 * GOGO 스마트 매니저 - 가계부 통합 관리 모듈 (js/ledger.js)
 * 마스터 규격: 고정비(기준 355만) + 생활비(예산 100만) 자동 집계 및 키워드 판정 엔진
 */

window.App = window.App || {};

App.ledger = {
  currentMonthKey: '',

  CONFIG: {
    FIXED_BUDGET: 3550000,
    LIVING_BUDGET: 1000000,
    FIXED_CATEGORIES: [
      { name: "대출 이자", keyword: "이자", target: 1300000 },
      { name: "차량 할부", keyword: "차량", target: 600000 },
      { name: "아파트 관리비", keyword: "관리비", target: 400000 },
      { name: "유류비", keyword: "유류", target: 300000 },
      { name: "보장성 보험", keyword: "보험", target: 300000 },
      { name: "교육비", keyword: "교육", target: 300000 },
      { name: "테니스/운동", keyword: "운동", target: 150000 },
      { name: "통신비", keyword: "통신", target: 120000 },
      { name: "곗돈", keyword: "곗돈", target: 80000 }
    ],
    LIVING_CATEGORIES: [
      { name: "식비", keywords: ["식비", "마트", "장보기", "식자재"], target: 450000 },
      { name: "외식", keywords: ["외식", "배달"], target: 250000 },
      { name: "카페", keywords: ["카페", "커피", "간식", "디저트"], target: 80000 },
      { name: "생필품", keywords: ["생필품", "주방", "욕실", "휴지", "세제"], target: 100000 },
      { name: "패션", keywords: ["패션", "의류", "미용", "헤어"], target: 50000 },
      { name: "의료", keywords: ["의료", "약국", "병원", "영양제"], target: 40000 },
      { name: "취미", keywords: ["취미", "여가", "도서"], target: 20000 },
      { name: "기타", keywords: ["기타", "잡비", "예비비"], target: 10000 }
    ],
    FIXED_KEYWORDS: ["이자", "차량", "관리비", "유류", "보험", "교육", "운동", "통신", "곗돈"],
    LIVING_EXCLUSIONS: ["교육", "운동", "고정", "이자", "보험", "차량", "통신"]
  },

  init() {
    try {
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];
      this.currentMonthKey = todayStr.substring(0, 7);

      const dateInp = document.getElementById('ledgerDateInput');
      const monthPicker = document.getElementById('ledgerMonthPicker');

      if (dateInp) dateInp.value = todayStr;
      if (monthPicker) monthPicker.value = this.currentMonthKey;
    } catch (e) {
      console.error("[Ledger Init Error]", e);
    }
  },

  changeMonth(newMonthKey) {
    if (!newMonthKey) return;
    this.currentMonthKey = newMonthKey;
    const picker = document.getElementById('ledgerMonthPicker');
    if (picker) picker.value = newMonthKey;
    this.render(App.stores?.ledger ? App.stores.ledger.getItems() : []);
  },

  prevMonth() {
    let [y, m] = this.currentMonthKey.split('-').map(Number);
    m--;
    if (m < 1) { m = 12; y--; }
    this.changeMonth(`${y}-${String(m).padStart(2, '0')}`);
  },

  nextMonth() {
    let [y, m] = this.currentMonthKey.split('-').map(Number);
    m++;
    if (m > 12) { m = 1; y++; }
    this.changeMonth(`${y}-${String(m).padStart(2, '0')}`);
  },

  evalFixedStatus(text) {
    if (!text || typeof text !== 'string' || !text.trim()) return "-";
    const t = text.trim();
    return this.CONFIG.FIXED_KEYWORDS.some(k => t.includes(k)) ? "O" : "X";
  },

  evalLivingStatus(text) {
    if (!text || typeof text !== 'string' || !text.trim()) return "-";
    const t = text.trim();
    return this.CONFIG.LIVING_EXCLUSIONS.some(k => t.includes(k)) ? "X" : "O";
  },

  getBudget() {
    return this.CONFIG.LIVING_BUDGET;
  },

  editingId: null,

  getFormEls() {
    return {
      dateInp: document.getElementById('ledgerDateInput'),
      amountInp: document.getElementById('ledgerAmountInput'),
      descInp: document.getElementById('ledgerDescInput'),
      categoryInp: document.getElementById('ledgerCategoryInput'),
      placeInp: document.getElementById('ledgerPlaceInput'),
      methodInp: document.getElementById('ledgerMethodInput'),
      saveBtn: document.getElementById('btnSaveLedger'),
      banner: document.getElementById('ledgerEditBanner'),
      title: document.getElementById('ledgerFormTitle'),
      card: document.getElementById('ledgerFormCard')
    };
  },

  ensureMethodOption(methodInp, value) {
    if (!methodInp || !value) return;
    const exists = Array.from(methodInp.options).some((o) => o.value === value);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      methodInp.appendChild(opt);
    }
    methodInp.value = value;
  },

  resetForm(keepDate = true) {
    const el = this.getFormEls();
    if (el.amountInp) el.amountInp.value = '';
    if (el.descInp) el.descInp.value = '';
    if (el.placeInp) el.placeInp.value = '';
    if (el.categoryInp) el.categoryInp.value = '';
    if (el.methodInp) el.methodInp.value = '삼성카드';
    if (!keepDate && el.dateInp) {
      const now = new Date();
      el.dateInp.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    }
  },

  setEditUI(isEditing) {
    const el = this.getFormEls();
    if (el.saveBtn) {
      el.saveBtn.innerText = isEditing ? '💾 지출 수정 완료' : '지출 내역 저장';
      el.saveBtn.style.background = isEditing ? '#059669' : '';
    }
    if (el.banner) el.banner.style.display = isEditing ? 'flex' : 'none';
    if (el.title) el.title.innerText = isEditing ? '✏️ 지출 내역 수정' : '✏️ 지출 등록 (마스터 자동 판정)';
  },

  startEdit(id) {
    try {
      const items = App.stores?.ledger ? App.stores.ledger.getItems() : [];
      const target = items.find((i) => String(i.id) === String(id));
      if (!target) {
        if (App.ui?.toast) App.ui.toast('⚠️ 해당 내역을 찾을 수 없습니다.');
        return;
      }
      const el = this.getFormEls();
      this.editingId = target.id;

      if (el.dateInp) el.dateInp.value = target.date || '';
      if (el.amountInp) el.amountInp.value = Number(target.amount) || '';
      if (el.categoryInp) el.categoryInp.value = target.category || '';
      if (el.placeInp) el.placeInp.value = target.place || '';
      if (el.descInp) el.descInp.value = target.desc && target.desc !== target.category ? target.desc : '';
      this.ensureMethodOption(el.methodInp, target.method || '삼성카드');

      this.setEditUI(true);
      this.render(items);

      const anchor = el.banner || el.card;
      if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (el.amountInp) setTimeout(() => el.amountInp.focus({ preventScroll: true }), 300);
      if (App.ui?.toast) App.ui.toast('✏️ 지출 내역을 수정할 수 있습니다.');
    } catch (e) {
      console.error('[Ledger Edit Error]', e);
      alert('수정 모드 전환 중 오류가 발생했습니다.');
    }
  },

  cancelEdit() {
    this.editingId = null;
    this.resetForm(true);
    this.setEditUI(false);
    this.render(App.stores?.ledger ? App.stores.ledger.getItems() : []);
  },

  add() {
    try {
      const el = this.getFormEls();

      const date = el.dateInp ? el.dateInp.value : '';
      const amount = el.amountInp ? parseInt(String(el.amountInp.value).replace(/[^0-9]/g, ''), 10) : 0;
      const desc = el.descInp ? el.descInp.value.trim() : '';
      const category = el.categoryInp ? el.categoryInp.value.trim() : '';
      const place = el.placeInp ? el.placeInp.value.trim() : '';
      const method = el.methodInp ? el.methodInp.value : '삼성카드';

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return alert("날짜를 선택하세요.");
      if (isNaN(amount) || amount <= 0) return alert("올바른 금액을 입력하세요.");
      if (amount > 100000000) return alert("금액이 너무 큽니다. 다시 확인해주세요.");
      if (!desc && !category) return alert("세부 분류 또는 상세 내용을 입력하세요.");

      const finalCategory = category || desc || '기타';
      const fields = {
        date: date,
        month: date.substring(0, 7),
        amount: amount,
        desc: desc || finalCategory,
        category: finalCategory,
        place: place,
        method: method,
        statusFixed: this.evalFixedStatus(finalCategory),
        statusLiving: this.evalLivingStatus(finalCategory)
      };

      if (this.editingId !== null) {
        const editId = this.editingId;
        const exists = App.stores?.ledger && App.stores.ledger.getItems().some((i) => String(i.id) === String(editId));
        if (!exists) {
          this.cancelEdit();
          return alert("수정할 내역이 삭제되었거나 존재하지 않습니다.");
        }
        App.stores.ledger.update(editId, Object.assign({}, fields, { confirmed: true, needsReview: false }));
        this.editingId = null;
        this.resetForm(true);
        this.setEditUI(false);
        this.changeMonth(date.substring(0, 7));
        if (App.ui?.toast) App.ui.toast(`✅ ${amount.toLocaleString()}원 내역이 수정되었습니다.`);
        if (App.ticker) App.ticker.refresh();
        return;
      }

      const author = (App.auth && App.auth.currentUser !== 'public')
        ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜')
        : '가족';

      const newEntry = Object.assign({
        id: Date.now(),
        author: author,
        confirmed: false
      }, fields);

      if (App.stores?.ledger) {
        App.stores.ledger.add(newEntry);
      }

      this.resetForm(true);
      this.changeMonth(date.substring(0, 7));
      if (App.ui?.toast) {
        App.ui.toast(`💰 ${amount.toLocaleString()}원 지출이 저장되었습니다.`);
      }
      if (App.ticker) App.ticker.refresh();
    } catch (e) {
      console.error("[Ledger Add Error]", e);
      alert("지출 저장 중 오류가 발생했습니다.");
    }
  },

  delete(id) {
    if (confirm("해당 지출 내역을 삭제하시겠습니까?")) {
      if (App.stores?.ledger) {
        App.stores.ledger.remove(id);
        if (this.editingId !== null && String(this.editingId) === String(id)) this.cancelEdit();
        if (App.ui?.toast) App.ui.toast("🗑️ 내역이 삭제되었습니다.");
        this.render(App.stores.ledger.getItems());
        if (App.ticker) App.ticker.refresh();
      }
    }
  },

  exportExcel() {
    const items = App.stores?.ledger ? App.stores.ledger.getItems() : [];
    const thisMonthItems = items.filter(i => (i.month || (i.date && i.date.substring(0, 7))) === this.currentMonthKey);

    if (thisMonthItems.length === 0) {
      return alert(`${this.currentMonthKey}월에 등록된 지출 내역이 없습니다.`);
    }

    let csvContent = "\uFEFFNo,일자,세부분류,구매처/출금처,상세내용,결제수단,지출금액,반영유무(생활비),반영유무(고정비),작성자\n";
    thisMonthItems.forEach((item, idx) => {
      const cat = item.category || item.desc || '';
      const livingStatus = item.statusLiving || this.evalLivingStatus(cat);
      const fixedStatus = item.statusFixed || this.evalFixedStatus(cat);
      csvContent += `${idx + 1},${item.date || ''},"${cat}","${(item.place || '').replace(/"/g, '""')}","${(item.desc || '').replace(/"/g, '""')}",${item.method || '카드'},${item.amount || 0},${livingStatus},${fixedStatus},${item.author || '가족'}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `GOGO가계부_${this.currentMonthKey}_지출관리.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (App.ui?.toast) App.ui.toast(`📥 ${this.currentMonthKey}월 CSV 파일이 다운로드되었습니다.`);
  },

  /* ══════════════════════════════════════════════════
     📧 네이버 메일 → 가계부 온디맨드 가져오기
     - 버튼 탭 시에만 GitHub Actions(naver-mail-import.yml) workflow_dispatch 호출
     - 토큰: Fine-grained PAT (이 저장소 / Actions: Read and write 만) → 기기 localStorage 에만 저장
     - 중복 방지는 서버 스크립트가 담당 (처리 이력 + srcId + 날짜·금액)
     ══════════════════════════════════════════════════ */
  MAIL_IMPORT: {
    OWNER: 'jin-spec-0011',
    REPO: 'my-dashboard',
    WORKFLOW: 'naver-mail-import.yml',
    REF: 'main',
    TOKEN_KEY: 'gh_mail_import_token',
    POLL_MS: 5000,
    TIMEOUT_MS: 11 * 60 * 1000
  },

  mailImportRunning: false,

  getMailToken() {
    try {
      return String(safeGet(this.MAIL_IMPORT.TOKEN_KEY) || '').trim();
    } catch (e) {
      return '';
    }
  },

  clearMailToken() {
    try { localStorage.removeItem(this.MAIL_IMPORT.TOKEN_KEY); } catch (e) { /* noop */ }
    try { safeSet(this.MAIL_IMPORT.TOKEN_KEY, ''); } catch (e) { /* noop */ }
  },

  askMailToken() {
    const input = window.prompt(
      '📧 메일 가져오기 최초 1회 설정\n\nGitHub Fine-grained 토큰을 붙여넣으세요.\n(저장소: my-dashboard / 권한: Actions → Read and write)\n\n이 기기에만 저장됩니다.',
      ''
    );
    if (input === null) return '';
    const token = String(input).trim();
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) {
      App.ui.toast('⚠️ 토큰 형식이 올바르지 않습니다 (github_pat_ 로 시작).');
      return '';
    }
    safeSet(this.MAIL_IMPORT.TOKEN_KEY, token);
    return token;
  },

  setMailBtn(text, busy) {
    const btn = document.getElementById('btnLedgerMailImport');
    if (!btn) return;
    btn.innerText = text;
    btn.disabled = !!busy;
    btn.classList.toggle('is-busy', !!busy);
  },

  async ghFetch(path, token, options = {}) {
    const url = `https://api.github.com/repos/${this.MAIL_IMPORT.OWNER}/${this.MAIL_IMPORT.REPO}${path}`;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
    try {
      return await fetch(url, Object.assign({}, options, {
        headers: Object.assign({
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }, options.headers || {}),
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      }));
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  countMailItems() {
    try {
      const list = App.stores && App.stores.ledger ? App.stores.ledger.getItems() : [];
      return new Set(list.filter((x) => x && x.source === 'naver-mail').map((x) => String(x.srcId || x.id))).size;
    } catch (e) {
      return 0;
    }
  },

  async importMailNow() {
    if (this.mailImportRunning) {
      App.ui.toast('⏳ 이미 메일을 가져오는 중입니다.');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      App.ui.toast('⚠️ 오프라인 상태입니다. 네트워크 연결 후 다시 시도하세요.');
      return;
    }

    let token = this.getMailToken();
    if (!token) token = this.askMailToken();
    if (!token) return;

    this.mailImportRunning = true;
    const before = this.countMailItems();
    const requestId = `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = Date.now();

    try {
      this.setMailBtn('⏳ 요청 중', true);

      const res = await this.ghFetch(`/actions/workflows/${this.MAIL_IMPORT.WORKFLOW}/dispatches`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: this.MAIL_IMPORT.REF,
          inputs: { dry_run: 'false', since_days: 'auto', reprocess: 'false', request_id: requestId }
        })
      });

      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        App.ui.toast('⚠️ GitHub API 호출 한도 초과 - 잠시 후 다시 시도하세요.');
        return;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        this.clearMailToken();
        App.ui.toast(`⚠️ 토큰 인증 실패(HTTP ${res.status}) - 다시 탭하여 새 토큰을 입력하세요.`);
        return;
      }
      if (res.status === 422) {
        App.ui.toast('⚠️ 워크플로 입력값 오류(HTTP 422) - main 브랜치 배포 상태를 확인하세요.');
        return;
      }
      if (res.status !== 204) {
        App.ui.toast(`⚠️ 실행 요청 실패 (HTTP ${res.status})`);
        return;
      }

      this.setMailBtn('⏳ 대기열', true);
      const run = await this.waitMailRun(token, requestId, startedAt);

      if (!run) {
        App.ui.toast('⌛ 실행 확인 시간 초과 - 백그라운드에서 계속 진행되며 완료 시 자동 반영됩니다.');
        return;
      }
      if (run.conclusion !== 'success') {
        App.ui.toast(`⚠️ 메일 가져오기 실패 (${run.conclusion || 'unknown'}) - GitHub Actions 로그 확인`);
        return;
      }

      await new Promise((r) => setTimeout(r, 1500));
      if (App.forceSyncAll) await App.forceSyncAll(true);
      const added = Math.max(0, this.countMailItems() - before);
      App.ui.toast(added > 0 ? `✅ 메일 결제 ${added}건 추가 (중복 제외)` : '✅ 새 결제 메일 없음 (기존 데이터 유지)');
    } catch (e) {
      console.error('[Ledger MailImport]', e);
      App.ui.toast(e && e.name === 'AbortError' ? '⚠️ GitHub 응답 지연 - 잠시 후 다시 시도하세요.' : '⚠️ 메일 가져오기 중 오류가 발생했습니다.');
    } finally {
      this.mailImportRunning = false;
      this.setMailBtn('📧 메일', false);
    }
  },

  /** request_id 가 run-name 에 포함된 실행을 찾아 완료까지 대기 → 완료 run 반환, 시간 초과 시 null */
  async waitMailRun(token, requestId, startedAt) {
    const sinceIso = new Date(startedAt - 2 * 60 * 1000).toISOString();
    const query = `?event=workflow_dispatch&per_page=10&created=${encodeURIComponent(`>=${sinceIso}`)}`;
    const deadline = startedAt + this.MAIL_IMPORT.TIMEOUT_MS;
    let runId = null;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.MAIL_IMPORT.POLL_MS));
      try {
        let run = null;
        if (!runId) {
          const res = await this.ghFetch(`/actions/workflows/${this.MAIL_IMPORT.WORKFLOW}/runs${query}`, token);
          if (!res.ok) continue;
          const data = await res.json();
          const runs = data && Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
          run = runs.find((r) => String(r.display_title || r.name || '').includes(requestId)) || null;
          if (run) runId = run.id;
        } else {
          const res = await this.ghFetch(`/actions/runs/${runId}`, token);
          if (!res.ok) continue;
          run = await res.json();
        }
        if (!run) continue;
        if (run.status === 'completed') return run;
        this.setMailBtn(run.status === 'in_progress' ? '📡 수집 중' : '⏳ 대기열', true);
      } catch (e) {
        console.warn('[Ledger MailImport] 상태 조회 재시도', e);
      }
    }
    return null;
  },

  render(items = []) {
    const currentMonthKey = this.currentMonthKey || new Date().toISOString().substring(0, 7);
    const [yearNum, monthNumStr] = currentMonthKey.split('-');
    const monthNum = parseInt(monthNumStr, 10);

    const thisMonthItems = items.filter(i => (i.month || (i.date && i.date.substring(0, 7))) === currentMonthKey);

    let fixedTotal = 0;
    this.CONFIG.FIXED_CATEGORIES.forEach(cat => {
      const spent = thisMonthItems.reduce((acc, cur) => {
        const text = cur.category || cur.desc || '';
        const isO = (cur.statusFixed || this.evalFixedStatus(text)) === "O";
        return (isO && text.includes(cat.keyword)) ? acc + (Number(cur.amount) || 0) : acc;
      }, 0);
      fixedTotal += spent;
    });

    let livingTotal = 0;
    this.CONFIG.LIVING_CATEGORIES.forEach(cat => {
      const spent = thisMonthItems.reduce((acc, cur) => {
        const text = cur.category || cur.desc || '';
        const isO = (cur.statusLiving || this.evalLivingStatus(text)) === "O";
        const matched = cat.keywords.some(k => text.includes(k));
        return (isO && matched) ? acc + (Number(cur.amount) || 0) : acc;
      }, 0);
      livingTotal += spent;
    });

    const legacyLivingFallback = thisMonthItems.reduce((acc, cur) => {
      const text = cur.category || cur.desc || '';
      return (this.evalLivingStatus(text) === "O") ? acc + (Number(cur.amount) || 0) : acc;
    }, 0);
    const finalLivingSpend = Math.max(livingTotal, legacyLivingFallback);

    const fixedRemain = this.CONFIG.FIXED_BUDGET - fixedTotal;
    const livingRemain = this.CONFIG.LIVING_BUDGET - finalLivingSpend;

    const fixedActEl = document.getElementById('ledgerFixedActualDisplay');
    const fixedRemEl = document.getElementById('ledgerFixedRemainDisplay');
    const livingActEl = document.getElementById('ledgerLivingActualDisplay');
    const livingRemEl = document.getElementById('ledgerLivingRemainDisplay');

    if (fixedActEl) fixedActEl.innerText = `${fixedTotal.toLocaleString()}원`;
    if (fixedRemEl) fixedRemEl.innerText = `잔여 이체액: ${fixedRemain.toLocaleString()}원`;
    if (livingActEl) livingActEl.innerText = `${finalLivingSpend.toLocaleString()}원`;
    if (livingRemEl) {
      livingRemEl.innerText = livingRemain >= 0 ? `남은 잔액: ${livingRemain.toLocaleString()}원` : `+${Math.abs(livingRemain).toLocaleString()}원 초과`;
      livingRemEl.style.color = livingRemain >= 0 ? '#10b981' : '#ef4444';
    }

    const monthLabelEl = document.getElementById('ledgerMonthLabel');
    const totalSpendEl = document.getElementById('ledgerTotalSpendDisplay');
    const livingSubDisplay = document.getElementById('ledgerLivingSubDisplay');
    const budgetDisplayEl = document.getElementById('ledgerBudgetDisplay');
    const percentDisplayEl = document.getElementById('ledgerPercentDisplay');
    const remainDisplayEl = document.getElementById('ledgerRemainDisplay');
    const progressBarEl = document.getElementById('ledgerProgressBar');
    const summaryTitleEl = document.getElementById('ledgerSummaryTitle');

    if (monthLabelEl) monthLabelEl.innerText = `${yearNum}년 ${monthNum}월 생활비 소진율`;
    if (summaryTitleEl) summaryTitleEl.innerText = `📋 ${monthNum}월 지출 상세 내역 (${thisMonthItems.length}건)`;
    if (totalSpendEl) totalSpendEl.innerText = `${finalLivingSpend.toLocaleString()}원`;
    if (livingSubDisplay) livingSubDisplay.innerText = `${finalLivingSpend.toLocaleString()}원`;
    if (budgetDisplayEl) budgetDisplayEl.innerText = `${this.CONFIG.LIVING_BUDGET.toLocaleString()}원`;

    const percent = Math.round((finalLivingSpend / this.CONFIG.LIVING_BUDGET) * 100);
    if (percentDisplayEl) percentDisplayEl.innerText = `${percent}%`;

    if (remainDisplayEl) {
      remainDisplayEl.innerText = livingRemain >= 0 ? `${livingRemain.toLocaleString()}원 남음` : `+${Math.abs(livingRemain).toLocaleString()}원 초과`;
      remainDisplayEl.className = livingRemain >= 0 ? 'info-val text-green' : 'info-val text-red';
    }

    if (progressBarEl) {
      const fillWidth = Math.min(100, Math.max(0, percent));
      progressBarEl.style.width = `${fillWidth}%`;
      progressBarEl.style.background = percent >= 100 ? '#ef4444' : (percent >= 80 ? '#f59e0b' : '#2563eb');
    }

    const listEl = document.getElementById('ledgerList');
    if (!listEl) return;

    if (thisMonthItems.length === 0) {
      listEl.innerHTML = `<div class="empty-msg">${monthNum}월 등록된 내역이 없습니다. 💰</div>`;
      return;
    }

    listEl.innerHTML = thisMonthItems.map(item => {
      const cat = item.category || item.desc || '미분류';
      const isLivingO = (item.statusLiving || this.evalLivingStatus(cat)) === 'O';
      const badgeColor = isLivingO ? '#10b981' : '#64748b';
      const badgeText = isLivingO ? '생활비' : '고정비';

      const safeId = escapeHtml(String(item.id));
      const isEditingThis = this.editingId !== null && String(this.editingId) === String(item.id);
      const reviewBadge = item.needsReview ? '<span style="font-size: 10px; padding: 2px 4px; border-radius: 4px; background: #fef3c7; color: #b45309; font-weight: 800; margin-left: 4px;">확인필요</span>' : '';

      return `
        <div class="log-item ${isEditingThis ? 'schedule-editing-item' : ''}" style="border-left: 3px solid ${badgeColor}; padding: 8px 10px; margin-bottom: 6px; background: ${isEditingThis ? '#ecfdf5' : '#f8fafc'}; border-radius: 8px; border: 1px solid ${isEditingThis ? '#059669' : 'var(--border-color)'}; display: flex; justify-content: space-between; align-items: center; gap: 6px;">
          <div class="log-content" onclick="App.ledger.startEdit('${safeId}')" style="cursor: pointer; min-width: 0; flex: 1;" title="탭하여 수정">
            <div class="log-text" style="font-size: 13px; font-weight: 700; color: #0f172a;">
              <span style="font-size: 10px; padding: 2px 4px; border-radius: 4px; background: ${badgeColor}20; color: ${badgeColor}; font-weight: 800; margin-right: 4px;">${badgeText}</span>
              ${escapeHtml(cat)} ${item.place ? `<span style="font-size: 11px; color: #64748b; font-weight: normal;">(${escapeHtml(item.place)})</span>` : ''}${reviewBadge}
              <span class="click-edit-tag">✏️ 수정</span>
              ${item.desc && item.desc !== cat ? `<div style="font-size: 11px; color: #64748b; margin-top: 1px; font-weight: normal; word-break: break-all;">${escapeHtml(item.desc)}</div>` : ''}
            </div>
            <div class="log-time" style="font-size: 10.5px; color: #94a3b8; margin-top: 2px;">
              📅 ${escapeHtml(item.date || '')} · ${escapeHtml(item.method || '카드')} · ${escapeHtml(item.author || '가족')}
            </div>
          </div>
          <div style="text-align: right; display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <span style="font-weight: 800; font-size: 14px; color: #ef4444;">${Number(item.amount || 0).toLocaleString()}원</span>
            <button type="button" class="delete-item-btn" onclick="event.stopPropagation(); App.ledger.delete('${safeId}')" title="삭제">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }
};
