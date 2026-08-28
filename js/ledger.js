window.App = window.App || {};

App.ledger = {
  currentMonthKey: '',

  init() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];
    this.currentMonthKey = todayStr.substring(0, 7);

    const dateInp = document.getElementById('ledgerDateInput');
    if (dateInp) {
      dateInp.value = todayStr;
    }
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

    App.ui.toast(`💰 ${amount.toLocaleString()}원 지출이 저장되었습니다.`);
    this.render(App.stores?.ledger ? App.stores.ledger.getItems() : []);
    if (App.ticker) App.ticker.refresh();
  },

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
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const todayStr = new Date(now.getTime() - offset).toISOString().split('T')[0];
    const currentMonthKey = this.currentMonthKey || todayStr.substring(0, 7);
    this.currentMonthKey = currentMonthKey;

    const monthNum = parseInt(currentMonthKey.substring(5), 10);
    const yearNum = currentMonthKey.substring(0, 4);

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

    if (monthLabelEl) monthLabelEl.innerText = `${yearNum}년 ${monthNum}월 총 지출`;
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
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">이번 달 지출 내역이 없습니다. 💰</div>`;
      return;
    }

    listEl.innerHTML = thisMonthItems.map(item => {
      const descText = item.desc || item.title || item.text || '지출 내역';
      return `
        <div class="log-item">
          <div class="log-content">
            <div class="log-text">${escapeHtml(descText)}</div>
            <div class="log-time">📅 ${escapeHtml(item.date || '')} · 작성자: ${escapeHtml(item.author || '가족')}</div>
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