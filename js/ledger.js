window.App = window.App || {};

App.ledger = {
  init() {
    const dateInp = document.getElementById('ledgerDateInput');
    if (dateInp) {
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      dateInp.value = new Date(now.getTime() - offset).toISOString().split('T')[0];
    }
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
    const listEl = document.getElementById('ledgerList');
    const titleEl = document.getElementById('ledgerSummaryTitle');
    if (!listEl) return;

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const thisMonthItems = items.filter(i => (i.month || (i.date && i.date.substring(0, 7))) === currentMonthKey);

    const totalSpend = thisMonthItems.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);

    if (titleEl) {
      titleEl.innerHTML = `📊 ${now.getMonth() + 1}월 지출 합계: <span style="color:#ef4444; font-weight:800;">${totalSpend.toLocaleString()}원</span>`;
    }

    if (items.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">지출 내역이 없습니다. 💰</div>`;
      return;
    }

    listEl.innerHTML = items.map(item => {
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
