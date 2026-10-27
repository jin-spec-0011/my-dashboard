/**
 * GOGO 스마트 매니저 - 장보기 & 고정 메모 (js/memo.js)
 * - 장보기: Firebase /family_todos, 체크 시 가계부(/family_ledger) 연동 모달
 * - 고정 메모: Firebase /family_stickies, 수정 모달 + 날짜/내용 검색
 * - 모든 쓰기는 App.stores.* (트랜잭션) 경유
 */
window.App = window.App || {};

App.memo = {
  pendingLedgerTodo: null,
  selectedLedgerAuthor: '진세',
  editingStickyId: null,

  currentAuthorName(fallback) {
    const user = App.auth ? App.auth.currentUser : 'public';
    if (user === 'jinse') return '진세';
    if (user === 'jihye') return '지혜';
    return fallback;
  },

  /* ── 🛒 장보기 ── */
  addTodo() {
    const input = document.getElementById('todoInput');
    const text = input ? input.value.trim() : '';
    if (!text) {
      if (input) input.focus();
      return;
    }
    App.stores.todos.add({
      id: Date.now(),
      text,
      completed: false,
      author: this.currentAuthorName('가족'),
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    });
    if (input) {
      input.value = '';
      input.focus();
    }
    App.ui.toast(`🛒 '${text}' 장보기 품목 추가!`);
  },

  findTodo(id) {
    return App.stores.todos.getItems().find((t) => String(t.id) === String(id)) || null;
  },

  toggleTodo(id) {
    const item = this.findTodo(id);
    if (!item) return;
    if (!item.completed) {
      this.openLedgerModal(item);
    } else {
      App.stores.todos.update(item.id, { completed: false });
    }
  },

  deleteTodo(id) {
    if (!confirm('해당 장보기 품목을 삭제하시겠습니까?')) return;
    App.stores.todos.remove(id);
    App.ui.toast('🗑️ 품목이 삭제되었습니다.');
  },

  openLedgerModal(todo) {
    this.pendingLedgerTodo = todo;
    const modal = document.getElementById('shopping-ledger-modal');
    const descInput = document.getElementById('shopLedgerDescInput');
    const amtInput = document.getElementById('shopLedgerAmountInput');
    const dateInput = document.getElementById('shopLedgerDateInput');
    if (descInput) descInput.value = todo.text || todo.title || '';
    if (amtInput) amtInput.value = '';
    if (dateInput) dateInput.value = todayStr();
    this.selectLedgerAuthor(this.currentAuthorName('진세'));
    if (modal) modal.style.display = 'flex';
    setTimeout(() => { if (amtInput) amtInput.focus(); }, 150);
  },

  closeLedgerModal() {
    this.pendingLedgerTodo = null;
    const modal = document.getElementById('shopping-ledger-modal');
    if (modal) modal.style.display = 'none';
  },

  selectLedgerAuthor(author) {
    this.selectedLedgerAuthor = author;
    const map = { 'btn-shop-author-jinse': '진세', 'btn-shop-author-jihye': '지혜', 'btn-shop-author-family': '가족' };
    Object.keys(map).forEach((btnId) => {
      const el = document.getElementById(btnId);
      if (el) el.classList.toggle('active', map[btnId] === author);
    });
  },

  submitLedgerAndComplete() {
    const todo = this.pendingLedgerTodo;
    if (!todo) return;
    const descInput = document.getElementById('shopLedgerDescInput');
    const amtInput = document.getElementById('shopLedgerAmountInput');
    const dateInput = document.getElementById('shopLedgerDateInput');

    const desc = (descInput && descInput.value.trim()) || todo.text || '장보기';
    const amount = amtInput ? parseInt(amtInput.value, 10) : 0;
    const date = (dateInput && dateInput.value) || todayStr();

    if (!amount || amount <= 0) {
      alert('지출 금액을 올바르게 입력해주세요.');
      if (amtInput) amtInput.focus();
      return;
    }

    const category = '장보기';
    App.stores.ledger.add({
      id: Date.now(),
      date,
      month: date.substring(0, 7),
      amount,
      desc: `[장보기] ${desc}`,
      category,
      place: '',
      method: '카드',
      author: this.selectedLedgerAuthor,
      confirmed: false,
      statusFixed: App.ledger ? App.ledger.evalFixedStatus(category) : 'X',
      statusLiving: App.ledger ? App.ledger.evalLivingStatus(category) : 'O'
    });
    App.stores.todos.update(todo.id, { completed: true });

    this.closeLedgerModal();
    App.ui.toast(`💰 ${amount.toLocaleString()}원이 가계부에 기록되었습니다!`);
  },

  completeWithoutLedger() {
    const todo = this.pendingLedgerTodo;
    if (!todo) return;
    App.stores.todos.update(todo.id, { completed: true });
    this.closeLedgerModal();
    App.ui.toast('☑️ 체크 완료되었습니다.');
  },

  renderTodos(items) {
    const listEl = document.getElementById('todoList');
    if (!listEl) return;
    const list = Array.isArray(items) ? items : App.stores.todos.getItems();
    if (list.length === 0) {
      listEl.innerHTML = '<div class="empty-msg">장보기 목록이 비어 있습니다. 🛒</div>';
      return;
    }
    const sorted = [...list].sort((a, b) => Number(Boolean(a.completed)) - Number(Boolean(b.completed)));
    listEl.innerHTML = sorted.map((t) => {
      const id = escapeHtml(String(t.id));
      const done = Boolean(t.completed);
      return `
        <div class="log-item ${done ? 'completed' : ''}">
          <div class="log-content" style="flex-direction:row; align-items:center; gap:8px; cursor:pointer;" onclick="App.memo.toggleTodo('${id}')">
            <span style="font-size:18px;">${done ? '☑️' : '⬜'}</span>
            <span class="log-text" style="${done ? 'text-decoration:line-through;color:#94a3b8;' : ''}">${escapeHtml(t.text || t.title || '')}</span>
          </div>
          <button type="button" class="delete-item-btn" onclick="App.memo.deleteTodo('${id}')" title="삭제">✕</button>
        </div>`;
    }).join('');
  },

  /* ── 📌 고정 메모 ── */
  addSticky() {
    const input = document.getElementById('stickyInput');
    const text = input ? input.value.trim() : '';
    if (!text) {
      alert('메모할 내용을 입력하세요.');
      if (input) input.focus();
      return;
    }
    const now = new Date();
    App.stores.stickies.add({
      id: Date.now(),
      text,
      completed: false,
      date: todayStr(),
      time: `${now.getMonth() + 1}월 ${now.getDate()}일 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      author: this.currentAuthorName('가족')
    });
    if (input) input.value = '';
    App.ui.toast('📌 고정 메모가 저장되었습니다!');
  },

  findSticky(id) {
    return App.stores.stickies.getItems().find((s) => String(s.id) === String(id)) || null;
  },

  toggleSticky(id, event) {
    if (event) event.stopPropagation();
    const item = this.findSticky(id);
    if (!item) return;
    App.stores.stickies.update(item.id, { completed: !item.completed });
  },

  deleteSticky(id, event) {
    if (event) event.stopPropagation();
    if (!confirm('해당 고정 메모를 삭제하시겠습니까?')) return;
    App.stores.stickies.remove(id);
    App.ui.toast('🗑️ 메모가 삭제되었습니다.');
  },

  openEditModal(id) {
    const target = this.findSticky(id);
    if (!target) return;
    this.editingStickyId = target.id;
    const modal = document.getElementById('sticky-edit-modal');
    const textarea = document.getElementById('stickyEditTextarea');
    const metaInfo = document.getElementById('stickyEditMetaInfo');
    if (textarea) textarea.value = target.text || '';
    if (metaInfo) metaInfo.innerText = `작성일: ${target.date || target.time || '-'} · 작성자: ${target.author || '가족'}`;
    if (modal) modal.style.display = 'flex';
    setTimeout(() => { if (textarea) textarea.focus(); }, 150);
  },

  closeEditModal() {
    this.editingStickyId = null;
    const modal = document.getElementById('sticky-edit-modal');
    if (modal) modal.style.display = 'none';
  },

  saveEditSticky() {
    if (this.editingStickyId === null) return;
    const textarea = document.getElementById('stickyEditTextarea');
    const newText = textarea ? textarea.value.trim() : '';
    if (!newText) {
      alert('메모 내용을 입력해주세요.');
      if (textarea) textarea.focus();
      return;
    }
    App.stores.stickies.update(this.editingStickyId, { text: newText });
    App.ui.toast('✅ 메모가 수정되었습니다.');
    this.closeEditModal();
  },

  filterStickies() {
    const dateInp = document.getElementById('stickySearchDate');
    const keyInp = document.getElementById('stickySearchKeyword');
    const infoEl = document.getElementById('stickySearchResultInfo');
    const searchDate = dateInp ? dateInp.value : '';
    const keyword = keyInp ? keyInp.value.trim().toLowerCase() : '';
    const all = App.stores && App.stores.stickies ? App.stores.stickies.getItems() : [];

    const filtered = all.filter((item) => {
      const matchDate = !searchDate || item.date === searchDate;
      const matchKey = !keyword || String(item.text || '').toLowerCase().includes(keyword);
      return matchDate && matchKey;
    });

    if (infoEl) {
      if (searchDate || keyword) {
        infoEl.style.display = 'block';
        infoEl.innerText = `🔍 검색 결과: 총 ${filtered.length}건`;
      } else {
        infoEl.style.display = 'none';
      }
    }
    this.renderStickies(filtered);
  },

  resetStickySearch() {
    const dateInp = document.getElementById('stickySearchDate');
    const keyInp = document.getElementById('stickySearchKeyword');
    if (dateInp) dateInp.value = '';
    if (keyInp) keyInp.value = '';
    this.filterStickies();
  },

  renderStickies(items) {
    const listEl = document.getElementById('stickyList');
    if (!listEl) return;
    const source = Array.isArray(items) ? items : App.stores.stickies.getItems();
    if (source.length === 0) {
      listEl.innerHTML = '<div class="empty-msg">해당하는 고정 메모가 없습니다. 📌</div>';
      return;
    }
    listEl.innerHTML = source.map((s) => {
      const id = escapeHtml(String(s.id));
      const done = Boolean(s.completed);
      const dateText = s.date ? `📅 ${s.date}` : (s.time ? `🕒 ${s.time}` : '');
      return `
        <div class="sticky-note-card ${done ? 'completed' : ''}" onclick="App.memo.openEditModal('${id}')" title="클릭하여 수정">
          <button type="button" class="sticky-check-btn" onclick="App.memo.toggleSticky('${id}', event)" title="완료 체크">${done ? '☑️' : '⬜'}</button>
          <div style="flex:1; min-width:0;">
            <div class="sticky-text">${escapeHtml(s.text || '')}</div>
            <div class="sticky-meta-row">
              <span>${escapeHtml(dateText)}</span>
              <span>작성: ${escapeHtml(s.author || '가족')} · <strong style="color:#2563eb;">✏️ 수정</strong></span>
            </div>
          </div>
          <button type="button" class="delete-item-btn" onclick="App.memo.deleteSticky('${id}', event)" title="메모 삭제">✕</button>
        </div>`;
    }).join('');
  },

  render() {
    this.renderTodos();
    this.filterStickies();
  }
};
