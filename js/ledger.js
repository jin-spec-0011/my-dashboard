window.App = window.App || {};

App.ledger = {
  currentMonthKey: '',

  init() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];
    this.currentMonthKey = todayStr.substring(0, 7);

    const dateInp = document.getElementById('ledgerDateInput');
    const monthPicker = document.getElementById('ledgerMonthPicker');

    if (dateInp) dateInp.value = todayStr;
    if (monthPicker) monthPicker.value = this.currentMonthKey;
  },

  /* 2번 요구사항: 월별 이동 및 변경 */
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

  /* 2번 요구사항: 해당 월 지출 내역 엑셀(.CSV) 내보내기 */
  exportExcel() {
    const items = App.stores?.ledger ? App.stores.ledger.getItems() : [];
    const thisMonthItems = items.filter(i => (i.month || (i.date && i.date.substring(0, 7))) === this.currentMonthKey);

    if (thisMonthItems.length === 0) {
      return alert(`${this.currentMonthKey}월에 등록된 지출 내역이 없습니다.`);
    }

    // CSV 헤더 및 데이터 생성 (UTF-8 BOM 추가로 엑셀 한글 깨짐 방지)
    let csvContent = "\uFEFF날짜,사용처/내역,결제자,지출금액(원)\n";
    thisMonthItems.forEach(item => {
      const desc = `"${(item.desc || '').replace(/"/g, '""')}"`;
      const date = item.date || '';
      const author = item.author || '가족';
      const amount = item.amount || 0;
      csvContent += `${date},${desc},${author},${amount}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `GOGO가계부_${this.currentMonthKey}_지출내역.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    App.ui.toast(`📥 ${this.currentMonthKey}월 지출 엑셀 파일이 다운로드되었습니다.`);
  },

  getBudget() {
    const key = `budget_${this.currentMonthKey}`;
    const val = safeGet(key);
    if (val && !isNaN(Number(val)) && Number(val) > 0) {
      return Number(val);
    }
    return 1500000;
  },

  setBudget(newAmount) {
    if (isNaN(newAmount) || newAmount <= 0) {
      return alert("올바른 예산 금액을 입력해주세요.");
    }
    const key = `budget_${this.currentMonthKey}`;
    safeSet(key, String(newAmount));

    if (App.isFirebaseActive && App.db) {
      App.db.ref(`family_budget/${this.currentMonthKey}`).set(Number(newAmount));
    }

    const monthNum = parseInt(this.currentMonthKey.substring(5), 10);
    App.ui.toast(`💰 ${monthNum}월 예산이 ${Number(newAmount).toLocaleString()}원으로 설정되었습니다.`);
    this.render(App.stores?.ledger ? App.stores.ledger.getItems() : []);
    if (App.ticker) App.ticker.refresh();
  },

  promptBudgetChange() {
    const current = this.getBudget();
    const monthNum = parseInt(this.currentMonthKey.substring(5), 10);
    const input = prompt(`[${monthNum}월 가계부] 월간 예산 상한선을 설정하세요 (원 단위):`, current);
    if (input === null) return;
    const cleanNum = Number(String(input).replace(/[^0-9]/g, ''));
    if (!cleanNum || cleanNum <= 0) {
      return alert("올바른 숫자를 입력해주세요.");
    }
    this.setBudget(cleanNum);
  },

  add() {
    const dateInp = document.getElementById('ledgerDateInput');
    const amountInp = document.getElementById('ledgerAmountInput');
    const descInp = document.getElementById('ledgerDescInput');

    const date = dateInp ? dateInp.value : '';
    const amount = amountInp ? parseInt(amountInp.value, 10) : 0;
    const desc = descInp ? descInp.value.trim() : '';

    if (!date) return alert("날짜를 선택하세요.");
    if (!amount || amount <= 0) return alert("올바른 금액을 입력하세요.");
    if (!desc) return alert("지출 내역을 입력하세요.");

    const author = (App.auth && App.auth.currentUser !== 'public')
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜')
      : '가족';

    const newEntry = {
      id: Date.now(),
      date: date,
      month: date.substring(0, 7),
      amount: amount,
      desc: desc,
      author: author
    };

    if (App.stores?.ledger) {
      App.stores.ledger.add(newEntry);
    }

    if (amountInp) amountInp.value = '';
    if (descInp) descInp.value = '';

    // 입력한 날짜의 월로 자동 뷰어 전환
    this.changeMonth(date.substring(0, 7));

    App.ui.toast(`💰 ${amount.toLocaleString()}원 지출이 저장되었습니다.`);
    if (App.ticker) App.ticker.refresh();
  },

  /* 0번 요구사항: 삭제 팝업 확인 */
  delete(id) {
    if (confirm("해당 지출 내역을 삭제하시겠습니까?")) {
      if (App.stores?.ledger) {
        App.stores.ledger.remove(id);
        App.ui.toast("🗑️ 내역이 삭제되었습니다.");
        this.render(App.stores.ledger.getItems());
        if (App.ticker) App.ticker.refresh();
      }
    }
  },

  render(items = []) {
    const currentMonthKey = this.currentMonthKey || new Date().toISOString().substring(0, 7);
    const [yearNum, monthNumStr] = currentMonthKey.split('-');
    const monthNum = parseInt(monthNumStr, 10);

    const thisMonthItems = items.filter(i => (i.month || (i.date && i.date.substring(0, 7))) === currentMonthKey);
    const totalSpend = thisMonthItems.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);

    const budgetAmount = this.getBudget();
    const percent = budgetAmount > 0 ? Math.round((totalSpend / budgetAmount) * 100) : 0;
    const remain = budgetAmount - totalSpend;

    const monthLabelEl = document.getElementById('ledgerMonthLabel');
    const totalSpendEl = document.getElementById('ledgerTotalSpendDisplay');
    const budgetDisplayEl = document.getElementById('ledgerBudgetDisplay');
    const percentDisplayEl = document.getElementById('ledgerPercentDisplay');
    const remainDisplayEl = document.getElementById('ledgerRemainDisplay');
    const progressBarEl = document.getElementById('ledgerProgressBar');
    const summaryTitleEl = document.getElementById('ledgerSummaryTitle');

    if (monthLabelEl) monthLabelEl.innerText = `${yearNum}년 ${monthNum}월 총 지출`;
    if (summaryTitleEl) summaryTitleEl.innerText = `📋 ${monthNum}월 지출 상세 내역 (${thisMonthItems.length}건)`;
    if (totalSpendEl) totalSpendEl.innerText = `${totalSpend.toLocaleString()}원`;
    if (budgetDisplayEl) budgetDisplayEl.innerText = `${budgetAmount.toLocaleString()}원`;
    if (percentDisplayEl) percentDisplayEl.innerText = `${percent}%`;

    if (remainDisplayEl) {
      if (remain >= 0) {
        remainDisplayEl.innerText = `${remain.toLocaleString()}원`;
        remainDisplayEl.className = 'info-val text-green';
      } else {
        remainDisplayEl.innerText = `+${Math.abs(remain).toLocaleString()}원 초과`;
        remainDisplayEl.className = 'info-val text-red';
      }
    }

    if (progressBarEl) {
      const fillWidth = Math.min(100, Math.max(0, percent));
      progressBarEl.style.width = `${fillWidth}%`;

      if (percent >= 100) {
        progressBarEl.style.background = '#ef4444';
      } else if (percent >= 80) {
        progressBarEl.style.background = '#f59e0b';
      } else {
        progressBarEl.style.background = '#2563eb';
      }
    }

    const listEl = document.getElementById('ledgerList');
    if (!listEl) return;

    if (thisMonthItems.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">${monthNum}월 지출 내역이 없습니다. 💰</div>`;
      return;
    }

    listEl.innerHTML = thisMonthItems.map(item => {
      const descText = item.desc || item.title || item.text || '지출 내역';
      return `
        <div class="log-item">
          <div class="log-content">
            <div class="log-text">${escapeHtml(descText)}</div>
            <div class="log-time">📅 ${escapeHtml(item.date || '')} · 결제자: ${escapeHtml(item.author || '가족')}</div>
          </div>
          <div style="text-align: right; display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 800; font-size: 14px; color: #ef4444;">${Number(item.amount || 0).toLocaleString()}원</span>
            <button type="button" class="delete-item-btn" onclick="App.ledger.delete('${item.id}')">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }
};
