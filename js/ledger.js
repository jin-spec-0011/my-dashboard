window.App = window.App || {};

App.ledger = {
  currentYearMonth: '',
  category: '식비/마트',
  author: '나',
  editingId: null,

  init() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    this.currentYearMonth = `${y}-${m}`;

    const dateInput = document.getElementById('ledgerDateInput');
    if (dateInput) {
      const offset = now.getTimezoneOffset() * 60000;
      dateInput.value = new Date(now.getTime() - offset).toISOString().split('T')[0];
    }
  },

  selectCategory(cat) {
    this.category = cat;
    document.querySelectorAll('.memo-input-card .category-selector-group .cat-chip').forEach(el => {
      el.classList.toggle('active', el.innerText.includes(cat));
    });
  },

  selectAuthor(a) {
    this.author = a;
    document.querySelectorAll('.memo-tag-selector .tag-chip').forEach(el => {
      if (el.id && el.id.startsWith('ledger-tag-')) el.classList.remove('active');
    });
    const map = { '나': 'ledger-tag-me', '배우자': 'ledger-tag-spouse', '가족': 'ledger-tag-family' };
    if (map[a]) {
      const target = document.getElementById(map[a]);
      if (target) target.classList.add('active');
    }
  },

  changeMonth(delta) {
    if (!this.currentYearMonth) this.init();
    const [yStr, mStr] = this.currentYearMonth.split('-');
    let y = parseInt(yStr, 10);
    let m = parseInt(mStr, 10) + delta;

    if (m < 1) { m = 12; y--; }
    else if (m > 12) { m = 1; y++; }

    this.currentYearMonth = `${y}-${String(m).padStart(2, '0')}`;
    this.render(App.stores.ledger ? App.stores.ledger.getItems() : []);
  },

  formatAmountInput(input) {
    let val = input.value.replace(/[^0-9]/g, '');
    if (!val) { input.value = ''; return; }
    input.value = Number(val).toLocaleString();
  },

  setBudget() {
    if (!this.currentYearMonth) this.init();
    const key = `budget_${this.currentYearMonth}`;
    const current = Number(safeGet(key)) || 0;
    const input = prompt(`[${this.currentYearMonth}] 한 달 목표 생활비 예산을 입력하세요 (원 단위):`, current ? current.toLocaleString() : '1500000');
    if (input === null) return;

    const num = parseInt(input.replace(/[^0-9]/g, ''), 10);
    if (!isNaN(num) && num >= 0) {
      safeSet(key, num);
      if (App.isFirebaseActive) {
        App.db.ref('family_budget/' + this.currentYearMonth).set(num);
      }
      App.ui.toast(`🎯 ${this.currentYearMonth} 예산이 ${num.toLocaleString()}원으로 설정되었습니다.`);
      this.render(App.stores.ledger.getItems());
      if (App.ticker) App.ticker.refresh();
    }
  },

  addEntry({ date, title, amount, category = '식비/마트', author = '나', source = '장보기', todoId = null }) {
    if (!title || isNaN(amount) || amount <= 0) return;
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const cleanDate = date || new Date(now.getTime() - offset).toISOString().split('T')[0];
    const month = cleanDate.substring(0, 7);

    if (App.stores.ledger) {
      App.stores.ledger.add({
        id: Date.now(),
        date: cleanDate,
        month: month,
        title: title.trim(),
        amount: parseInt(amount, 10),
        category: category,
        author: author,
        source: source,
        todoId: todoId ? String(todoId) : null
      });
    }
  },

  addManual() {
    const dateInput = document.getElementById('ledgerDateInput');
    const titleInput = document.getElementById('ledgerTitleInput');
    const amountInput = document.getElementById('ledgerAmountInput');

    const date = dateInput ? dateInput.value : '';
    const title = titleInput ? titleInput.value.trim() : '';
    const amountStr = amountInput ? amountInput.value.replace(/[^0-9]/g, '') : '0';
    const amount = parseInt(amountStr, 10);

    if (!title) return alert('지출 항목명을 입력해주세요.');
    if (!amount || isNaN(amount) || amount <= 0) return alert('올바른 지출 금액을 입력해주세요.');

    this.addEntry({
      date: date,
      title: title,
      amount: amount,
      category: this.category,
      author: this.author,
      source: '직접등록'
    });

    if (titleInput) titleInput.value = '';
    if (amountInput) amountInput.value = '';

    App.ui.toast('💰 가계부 지출이 등록되었습니다!');
  },

  openEditModal(id) {
    const item = App.stores.ledger.getItems().find(i => String(i.id) === String(id));
    if (!item) return;

    this.editingId = id;
    document.getElementById('editLedgerDate').value = item.date;
    document.getElementById('editLedgerTitle').value = item.title;
    document.getElementById('editLedgerAmount').value = Number(item.amount).toLocaleString();
    document.getElementById('editLedgerCategory').value = item.category || '식비/마트';

    const modal = document.getElementById('ledger-edit-modal');
    if (modal) modal.style.display = 'flex';
  },

  closeEditModal() {
    const modal = document.getElementById('ledger-edit-modal');
    if (modal) modal.style.display = 'none';
    this.editingId = null;
  },

  saveEdit() {
    if (!this.editingId) return;
    const date = document.getElementById('editLedgerDate').value;
    const title = document.getElementById('editLedgerTitle').value.trim();
    const amountStr = document.getElementById('editLedgerAmount').value.replace(/[^0-9]/g, '');
    const category = document.getElementById('editLedgerCategory').value;
    const amount = parseInt(amountStr, 10);

    if (!title) return alert('항목명을 입력해주세요.');
    if (isNaN(amount) || amount <= 0) return alert('금액을 올바르게 입력해주세요.');

    App.stores.ledger.update(this.editingId, {
      date: date,
      month: date.substring(0, 7),
      title: title,
      amount: amount,
      category: category
    });

    this.closeEditModal();
    App.ui.toast('✅ 지출 내역이 수정되었습니다.');
  },

  deleteEntry(id) {
    const item = App.stores.ledger.getItems().find(i => String(i.id) === String(id));
    if (!item) return;

    if (confirm(`[${item.title}] 지출 내역을 삭제하시겠습니까?`)) {
      App.stores.ledger.remove(id);
      App.ui.toast('🗑️ 지출 내역이 삭제되었습니다.');
    }
  },

  exportCSV() {
    const items = App.stores.ledger.getItems().filter(i => (i.month || i.date?.substring(0, 7)) === this.currentYearMonth);
    if (items.length === 0) return alert('내보낼 지출 내역이 없습니다.');

    let csvContent = '\uFEFF';
    csvContent += '날짜,카테고리,구분,항목명,금액(원),결제자\n';

    items.forEach(i => {
      const row = [
        `"${i.date}"`,
        `"${i.category || '식비/마트'}"`,
        `"${i.source || '장보기'}"`,
        `"${i.title.replace(/"/g, '""')}"`,
        i.amount,
        `"${i.author || '가족'}"`
      ];
      csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${this.currentYearMonth}_가계부_지출내역.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    App.ui.toast('📥 엑셀(CSV) 파일이 다운로드되었습니다!');
  },

  render(items) {
    if (!this.currentYearMonth) this.init();

    const [y, m] = this.currentYearMonth.split('-');
    const monthText = document.getElementById('ledgerCurrentMonthText');
    if (monthText) monthText.innerText = `${y}년 ${parseInt(m, 10)}월`;

    const filtered = (items || []).filter(i => (i.month || i.date?.substring(0, 7)) === this.currentYearMonth);
    const totalAmount = filtered.reduce((acc, cur) => acc + (Number(cur.amount) || 0), 0);

    const totalEl = document.getElementById('ledgerTotalAmount');
    const countEl = document.getElementById('ledgerCountLabel');
    const listEl = document.getElementById('ledgerListContainer');

    if (totalEl) totalEl.innerText = `${totalAmount.toLocaleString()}원`;
    if (countEl) countEl.innerText = `총 ${filtered.length}건`;

    const budgetKey = `budget_${this.currentYearMonth}`;
    const targetBudget = Number(safeGet(budgetKey)) || 0;
    const progressBox = document.getElementById('budgetProgressBox');

    if (targetBudget > 0) {
      if (progressBox) progressBox.style.display = 'flex';
      const remaining = targetBudget - totalAmount;
      const percent = Math.min(100, Math.round((totalAmount / targetBudget) * 100));

      const remainLabel = document.getElementById('budgetRemainingLabel');
      const percentLabel = document.getElementById('budgetPercentLabel');
      const bar = document.getElementById('budgetProgressBar');

      if (remainLabel) {
        remainLabel.innerText = remaining >= 0 
          ? `남은 예산: ${remaining.toLocaleString()}원` 
          : `예산 초과: +${Math.abs(remaining).toLocaleString()}원`;
      }
      if (percentLabel) percentLabel.innerText = `${percent}%`;
      if (bar) {
        bar.style.width = `${percent}%`;
        bar.className = 'progress-fill';
        if (percent >= 100) bar.classList.add('danger');
        else if (percent >= 80) bar.classList.add('warning');
      }
    } else {
      if (progressBox) progressBox.style.display = 'none';
    }

    if (!listEl) return;

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:30px 0;">${parseInt(m, 10)}월 등록된 지출 내역이 없습니다. ✨</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(item => `
      <div class="ledger-item" onclick="App.ledger.openEditModal('${item.id}')">
        <div class="ledger-item-left">
          <div class="ledger-item-top">
            <span class="ledger-cat-badge">${escapeHtml(item.category || '식비/마트')}</span>
            <span class="ledger-source-tag">${escapeHtml(item.source || '장보기')}</span>
            <span class="ledger-item-title">${escapeHtml(item.title)}</span>
          </div>
          <span class="ledger-item-date">${escapeHtml(item.date)} · ${escapeHtml(item.author || '가족')}</span>
        </div>
        <div class="ledger-item-right">
          <span class="ledger-item-amount">-${(Number(item.amount) || 0).toLocaleString()}원</span>
          <button type="button" class="delete-item-btn" onclick="event.stopPropagation(); App.ledger.deleteEntry('${item.id}')">✕</button>
        </div>
      </div>
    `).join('');
  }
};
