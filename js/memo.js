window.App = window.App || {};

App.memo = {
  pendingTodoId: null,
  modalCategory: '식비/마트',

  switchTab(tab) {
    App.state.memo.tab = tab;
    document.getElementById('tab-btn-todo').classList.toggle('active', tab === 'todo');
    document.getElementById('tab-btn-sticky').classList.toggle('active', tab === 'sticky');
    document.getElementById('memo-todo-view').style.display = tab === 'todo' ? 'flex' : 'none';
    document.getElementById('memo-sticky-view').style.display = tab === 'sticky' ? 'flex' : 'none';
  },

  selectAuthor(a) {
    App.state.memo.author = a;
    document.querySelectorAll('.memo-input-card .memo-tag-selector .tag-chip').forEach(el => {
      if (el.id && el.id.startsWith('tag-')) el.classList.remove('active');
    });
    const map = { '진세': 'tag-jinse', '지혜': 'tag-jihye', '가족': 'tag-family' };
    if (map[a]) document.getElementById(map[a]).classList.add('active');
  },

  selectStickyColor(c) {
    App.state.memo.stickyColor = c;
    document.querySelectorAll('.color-dot').forEach(el => el.classList.remove('active'));
    const dot = document.querySelector('.dot-' + c);
    if (dot) dot.classList.add('active');
  },

  selectModalCategory(cat) {
    this.modalCategory = cat;
    document.querySelectorAll('.modal-cat-group .cat-chip').forEach(el => {
      el.classList.toggle('active', el.innerText.includes(cat));
    });
  },

  addTodo() {
    if (App.state.memo.isAddingTodo) return;
    const input = document.getElementById('todoInput');
    const text = input.value.trim();
    if (!text) return;

    App.state.memo.isAddingTodo = true;
    input.value = '';

    const now = new Date();
    const timeStr = `${now.getMonth()+1}/${now.getDate()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    App.stores.todos.add({
      id: Date.now(),
      text: text,
      completed: false,
      author: App.state.memo.author || '진세',
      time: timeStr
    });

    App.ui.toast("🛒 항목이 추가되었습니다!");
    setTimeout(() => { App.state.memo.isAddingTodo = false; }, 300);
  },

  toggleTodo(id) {
    const item = App.stores.todos.getItems().find(i => String(i.id) === String(id));
    if (!item) return;

    if (!item.completed) {
      this.pendingTodoId = id;
      this.modalCategory = '식비/마트';
      this.selectModalCategory('식비/마트');

      const modal = document.getElementById('todo-amount-modal');
      const itemText = document.getElementById('modalTodoItemText');
      const amountInput = document.getElementById('modalTodoAmountInput');

      if (itemText) itemText.innerText = item.text;
      if (amountInput) {
        amountInput.value = '';
        setTimeout(() => amountInput.focus(), 100);
      }
      if (modal) modal.style.display = 'flex';
    } else {
      const ledgerItems = App.stores.ledger ? App.stores.ledger.getItems() : [];
      const linked = ledgerItems.find(l => String(l.todoId) === String(id));
      if (linked) {
        if (confirm(`가계부에 등록된 [${linked.title} (-${Number(linked.amount).toLocaleString()}원)] 지출도 함께 취소하시겠습니까?`)) {
          App.stores.ledger.remove(linked.id);
          App.ui.toast('💰 가계부 지출 내역이 함께 취소되었습니다.');
        }
      }
      App.stores.todos.update(id, { completed: false });
    }
  },

  confirmTodoWithAmount() {
    const amountInput = document.getElementById('modalTodoAmountInput');
    const amountStr = amountInput ? amountInput.value.replace(/[^0-9]/g, '') : '0';
    const amount = parseInt(amountStr, 10);
    const item = App.stores.todos.getItems().find(i => String(i.id) === String(this.pendingTodoId));

    if (item) {
      if (amount && !isNaN(amount) && amount > 0) {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        const dateStr = new Date(now.getTime() - offset).toISOString().split('T')[0];

        if (App.ledger && typeof App.ledger.addEntry === 'function') {
          App.ledger.addEntry({
            date: dateStr,
            title: item.text,
            amount: amount,
            category: this.modalCategory,
            author: item.author || '진세',
            source: '장보기',
            todoId: item.id
          });
        }
        App.ui.toast(`💰 [${item.text}] ${amount.toLocaleString()}원이 가계부에 등록되었습니다!`);
      }
      App.stores.todos.update(this.pendingTodoId, { completed: true });
    }
    this.closeAmountModal();
  },

  confirmTodoWithoutAmount() {
    if (this.pendingTodoId) {
      App.stores.todos.update(this.pendingTodoId, { completed: true });
      App.ui.toast("✅ 장보기 항목이 완료되었습니다.");
    }
    this.closeAmountModal();
  },

  closeAmountModal() {
    const modal = document.getElementById('todo-amount-modal');
    if (modal) modal.style.display = 'none';
    this.pendingTodoId = null;
  },

  deleteTodo(id) {
    App.stores.todos.remove(id);
  },

  clearCompletedTodos() {
    const completed = App.stores.todos.getItems().filter(i => i.completed);
    if (completed.length === 0) return alert("완료된 항목이 없습니다.");
    if (confirm(`완료된 ${completed.length}개 항목을 삭제하시겠습니까?`)) {
      completed.forEach(i => App.stores.todos.remove(i.id));
    }
  },

  renderTodos(items) {
    const container = document.getElementById('todoListContainer');
    const pending = items.filter(i => !i.completed).length;
    document.getElementById('todoCountLabel').innerText = `남은 항목: ${pending}개`;

    if (!items || items.length === 0) {
      container.innerHTML = '<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:30px 0;">장보기나 할 일이 비어 있습니다. 😊</div>';
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="check-item ${item.completed ? 'completed' : ''}" onclick="App.memo.toggleTodo('${item.id}')">
        <div class="check-left">
          <input type="checkbox" class="custom-checkbox" ${item.completed ? 'checked' : ''} tabindex="-1">
          <span class="check-title">${escapeHtml(item.text)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="check-author">${escapeHtml(item.author || '진세')}</span>
          <button type="button" class="delete-item-btn" onclick="event.stopPropagation(); App.memo.deleteTodo('${item.id}')">✕</button>
        </div>
      </div>`).join('');
  },

  addSticky() {
    if (App.state.memo.isAddingSticky) return;
    const input = document.getElementById('stickyInput');
    const text = input.value.trim();
    if (!text) return;

    App.state.memo.isAddingSticky = true;
    input.value = '';

    const now = new Date();
    App.stores.stickies.add({
      id: Date.now(),
      text: text,
      color: App.state.memo.stickyColor,
      date: `${now.getMonth()+1}/${now.getDate()}`
    });

    App.ui.toast("📌 메모가 등록되었습니다!");
    setTimeout(() => { App.state.memo.isAddingSticky = false; }, 300);
  },

  sendStickyToLedger(id) {
    const item = App.stores.stickies.getItems().find(i => String(i.id) === String(id));
    if (!item) return;

    const input = prompt(`[${item.text}] 항목의 지출 금액을 입력하세요 (원):`, '10000');
    if (input === null) return;

    const amount = parseInt(input.replace(/[^0-9]/g, ''), 10);
    if (isNaN(amount) || amount <= 0) return alert('올바른 금액을 입력해주세요.');

    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const dateStr = new Date(now.getTime() - offset).toISOString().split('T')[0];

    if (App.ledger && typeof App.ledger.addEntry === 'function') {
      App.ledger.addEntry({
        date: dateStr,
        title: item.text,
        amount: amount,
        category: '고정비/기타',
        author: '가족',
        source: '메모'
      });
    }

    App.ui.toast(`💰 가계부에 [${item.text}] ${amount.toLocaleString()}원이 등록되었습니다!`);
  },

  deleteSticky(id) {
    if (confirm('이 메모를 삭제하시겠습니까?')) App.stores.stickies.remove(id);
  },

  copySticky(text) {
    navigator.clipboard.writeText(text).then(() => App.ui.toast("📋 메모가 복사되었습니다!"));
  },

  renderStickies(items) {
    const container = document.getElementById('stickyGridContainer');
    if (!items || items.length === 0) {
      container.innerHTML = '<div style="grid-column: span 2; color:var(--text-sub); font-size:13px; text-align:center; padding:30px 0;">등록된 고정 메모가 없습니다.</div>';
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="sticky-card sticky-${item.color || 'yellow'}">
        <div class="sticky-body">${escapeHtml(item.text)}</div>
        <div class="sticky-footer">
          <span>${escapeHtml(item.date)}</span>
          <div style="display:flex; gap:6px; align-items:center;">
            <button type="button" class="btn-sticky-ledger" onclick="App.memo.sendStickyToLedger('${item.id}')" title="가계부로 등록">💰</button>
            <span style="cursor:pointer;" onclick="App.memo.copySticky('${escapeHtml(item.text).replace(/'/g, "\\'")}')">📋</span>
            <span style="cursor:pointer; margin-left:4px;" onclick="App.memo.deleteSticky('${item.id}')">✕</span>
          </div>
        </div>
      </div>`).join('');
  }
};
