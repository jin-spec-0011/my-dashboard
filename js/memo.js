window.App = window.App || {};

App.memo = {
  /* 상태 관리 */
  pendingLedgerTodo: null,
  selectedLedgerAuthor: '진세',
  editingStickyId: null,

  /* ══════════════════════════════════════════════════
     🛒 1. 장보기 (Todos) & 가계부 연동 모달 로직
     ══════════════════════════════════════════════════ */
  addTodo() {
    const input = document.getElementById('todoInput');
    const text = input ? input.value.trim() : '';
    if (!text) return;

    const author = (App.auth && App.auth.currentUser !== 'public')
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜')
      : '가족';

    const newTodo = {
      id: Date.now(),
      text: text,
      completed: false,
      author: author,
      time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    };

    if (App.stores?.todos) {
      App.stores.todos.add(newTodo);
    }

    if (input) input.value = '';
    App.ui.toast(`🛒 '${text}' 장보기 품목 추가!`);
    if (App.ticker) App.ticker.refresh();
  },

  toggleTodo(id) {
    const todos = App.stores?.todos ? App.stores.todos.getItems() : [];
    const item = todos.find(t => String(t.id) === String(id));
    if (!item) return;

    // 미완료 상태에서 체크할 때 -> 가계부 지출 연동 팝업 오픈
    if (!item.completed) {
      this.openLedgerModal(item);
    } else {
      // 완료 상태를 다시 풀 때
      item.completed = false;
      this.saveTodos(todos);
      this.renderTodos(todos);
      if (App.ticker) App.ticker.refresh();
    }
  },

  deleteTodo(id) {
    if (confirm("해당 장보기 품목을 삭제하시겠습니까?")) {
      if (App.stores?.todos) {
        App.stores.todos.remove(id);
        App.ui.toast("🗑️ 품목이 삭제되었습니다.");
        if (App.ticker) App.ticker.refresh();
      }
    }
  },

  saveTodos(list) {
    safeSet('family_todos', JSON.stringify(list));
    if (App.isFirebaseActive && App.db) {
      App.db.ref('family_todos').set(list);
    }
  },

  openLedgerModal(todo) {
    this.pendingLedgerTodo = todo;
    const modal = document.getElementById('shopping-ledger-modal');
    const descInput = document.getElementById('shopLedgerDescInput');
    const amtInput = document.getElementById('shopLedgerAmountInput');
    const dateInput = document.getElementById('shopLedgerDateInput');

    if (descInput) descInput.value = todo.text || todo.title || '';
    if (amtInput) amtInput.value = '';

    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    if (dateInput) dateInput.value = new Date(now.getTime() - offset).toISOString().split('T')[0];

    const currentAuthor = (App.auth && App.auth.currentUser !== 'public')
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜')
      : '진세';
    this.selectLedgerAuthor(currentAuthor);

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
    const btnJinse = document.getElementById('btn-shop-author-jinse');
    const btnJihye = document.getElementById('btn-shop-author-jihye');
    const btnFam = document.getElementById('btn-shop-author-family');

    if (btnJinse) btnJinse.classList.toggle('active', author === '진세');
    if (btnJihye) btnJihye.classList.toggle('active', author === '지혜');
    if (btnFam) btnFam.classList.toggle('active', author === '가족');
  },

  submitLedgerAndComplete() {
    if (!this.pendingLedgerTodo) return;

    const descInput = document.getElementById('shopLedgerDescInput');
    const amtInput = document.getElementById('shopLedgerAmountInput');
    const dateInput = document.getElementById('shopLedgerDateInput');

    const desc = descInput ? descInput.value.trim() : (this.pendingLedgerTodo.text || '장보기');
    const amount = amtInput ? Number(amtInput.value) : 0;
    const date = dateInput ? dateInput.value : '';

    if (!amount || amount <= 0) {
      alert("지출 금액을 올바르게 입력해주세요.");
      if (amtInput) amtInput.focus();
      return;
    }

    // 1. 가계부 저장
    const newLedgerItem = {
      id: Date.now(),
      date: date || new Date().toISOString().split('T')[0],
      amount: amount,
      desc: `[장보기] ${desc}`,
      author: this.selectedLedgerAuthor,
      month: (date || '').substring(0, 7)
    };

    if (App.stores?.ledger) {
      App.stores.ledger.add(newLedgerItem);
    }

    // 2. 장보기 체크 완료 처리
    const todos = App.stores?.todos ? App.stores.todos.getItems() : [];
    const item = todos.find(t => String(t.id) === String(this.pendingLedgerTodo.id));
    if (item) {
      item.completed = true;
      this.saveTodos(todos);
      this.renderTodos(todos);
    }

    this.closeLedgerModal();
    App.ui.toast(`💰 ${amount.toLocaleString()}원이 가계부에 기록되었습니다!`);
    if (App.ticker) App.ticker.refresh();
  },

  completeWithoutLedger() {
    if (!this.pendingLedgerTodo) return;
    const todos = App.stores?.todos ? App.stores.todos.getItems() : [];
    const item = todos.find(t => String(t.id) === String(this.pendingLedgerTodo.id));
    if (item) {
      item.completed = true;
      this.saveTodos(todos);
      this.renderTodos(todos);
    }
    this.closeLedgerModal();
    App.ui.toast("체크 완료되었습니다.");
    if (App.ticker) App.ticker.refresh();
  },

  renderTodos(items = []) {
    const listEl = document.getElementById('todoList');
    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">장보기 목록이 비어 있습니다. 🛒</div>`;
      return;
    }

    listEl.innerHTML = items.map(t => `
      <div class="log-item ${t.completed ? 'completed' : ''}" style="${t.completed ? 'opacity:0.6;background:#f1f5f9;' : ''}">
        <div class="log-content" style="display:flex; flex-direction:row; align-items:center; gap:8px; cursor:pointer;" onclick="App.memo.toggleTodo('${t.id}')">
          <span style="font-size:18px;">${t.completed ? '☑️' : '⬜'}</span>
          <span class="log-text" style="${t.completed ? 'text-decoration:line-through;color:#94a3b8;' : ''}">${escapeHtml(t.text || t.title)}</span>
        </div>
        <button type="button" class="delete-item-btn" onclick="App.memo.deleteTodo('${t.id}')">✕</button>
      </div>
    `).join('');
  },


  /* ══════════════════════════════════════════════════
     📌 2. 고정 메모 (Stickies) 신규, 수정 팝업, 검색
     ══════════════════════════════════════════════════ */
  addSticky() {
    const input = document.getElementById('stickyInput');
    const text = input ? input.value.trim() : '';
    if (!text) return alert("메모할 내용을 입력하세요.");

    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const dateStr = new Date(now.getTime() - offset).toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const author = (App.auth && App.auth.currentUser !== 'public')
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜')
      : '가족';

    const newSticky = {
      id: Date.now(),
      text: text,
      completed: false,
      date: dateStr,
      time: timeStr,
      author: author
    };

    if (App.stores?.stickies) {
      App.stores.stickies.add(newSticky);
    }

    if (input) input.value = '';
    App.ui.toast("📌 고정 메모가 저장되었습니다!");
    this.filterStickies();
  },

  toggleSticky(id, event) {
    if (event) event.stopPropagation(); // 카드 수정 팝업 방지

    const stickies = App.stores?.stickies ? App.stores.stickies.getItems() : [];
    const item = stickies.find(s => String(s.id) === String(id));
    if (!item) return;

    item.completed = !item.completed;
    this.saveStickies(stickies);
    this.filterStickies();
  },

  deleteSticky(id, event) {
    if (event) event.stopPropagation(); // 카드 수정 팝업 방지

    if (confirm("해당 고정 메모를 삭제하시겠습니까?")) {
      if (App.stores?.stickies) {
        App.stores.stickies.remove(id);
        App.ui.toast("🗑️ 메모가 삭제되었습니다.");
        this.filterStickies();
      }
    }
  },

  saveStickies(list) {
    safeSet('family_stickies', JSON.stringify(list));
    if (App.isFirebaseActive && App.db) {
      App.db.ref('family_stickies').set(list);
    }
  },

  /* 📌 [요구사항 1, 2] 메모 클릭 시 수정 팝업창 및 우측 상단 닫기 */
  openEditModal(id) {
    const stickies = App.stores?.stickies ? App.stores.stickies.getItems() : [];
    const target = stickies.find(s => String(s.id) === String(id));
    if (!target) return;

    this.editingStickyId = id;

    const modal = document.getElementById('sticky-edit-modal');
    const textarea = document.getElementById('stickyEditTextarea');
    const metaInfo = document.getElementById('stickyEditMetaInfo');

    if (textarea) textarea.value = target.text || '';
    if (metaInfo) {
      metaInfo.innerText = `작성일: ${target.date || target.time || '-'} · 작성자: ${target.author || '가족'}`;
    }

    if (modal) modal.style.display = 'flex';
    setTimeout(() => { if (textarea) textarea.focus(); }, 150);
  },

  closeEditModal() {
    this.editingStickyId = null;
    const modal = document.getElementById('sticky-edit-modal');
    if (modal) modal.style.display = 'none';
  },

  saveEditSticky() {
    if (!this.editingStickyId) return;

    const textarea = document.getElementById('stickyEditTextarea');
    const newText = textarea ? textarea.value.trim() : '';

    if (!newText) {
      alert("메모 내용을 입력해주세요.");
      if (textarea) textarea.focus();
      return;
    }

    const stickies = App.stores?.stickies ? App.stores.stickies.getItems() : [];
    const item = stickies.find(s => String(s.id) === String(this.editingStickyId));

    if (item) {
      item.text = newText;
      this.saveStickies(stickies);
      App.ui.toast("✅ 메모가 성공적으로 수정되었습니다.");
    }

    this.closeEditModal();
    this.filterStickies();
  },

  /* 🔍 [요구사항 3] 날짜 & 내용 실시간 검색 */
  filterStickies() {
    const dateInp = document.getElementById('stickySearchDate');
    const keyInp = document.getElementById('stickySearchKeyword');
    const resultCountEl = document.getElementById('stickySearchResultInfo');

    const searchDate = dateInp ? dateInp.value : '';
    const searchKeyword = keyInp ? keyInp.value.trim().toLowerCase() : '';

    const allStickies = App.stores?.stickies ? App.stores.stickies.getItems() : [];

    // 필터링 적용
    const filtered = allStickies.filter(item => {
      // 1. 날짜 검색
      let matchDate = true;
      if (searchDate) {
        const itemDate = item.date || (item.time && item.time.includes(searchDate) ? searchDate : '');
        matchDate = itemDate === searchDate;
      }

      // 2. 내용 검색
      let matchKeyword = true;
      if (searchKeyword) {
        const text = (item.text || '').toLowerCase();
        matchKeyword = text.includes(searchKeyword);
      }

      return matchDate && matchKeyword;
    });

    // 검색 상태 안내 배너
    if (resultCountEl) {
      if (searchDate || searchKeyword) {
        resultCountEl.style.display = 'block';
        resultCountEl.innerText = `🔍 검색 결과: 총 ${filtered.length}건`;
      } else {
        resultCountEl.style.display = 'none';
      }
    }

    this.renderStickies(filtered);
  },

  resetStickySearch() {
    const dateInp = document.getElementById('stickySearchDate');
    const keyInp = document.getElementById('stickySearchKeyword');
    const resultCountEl = document.getElementById('stickySearchResultInfo');

    if (dateInp) dateInp.value = '';
    if (keyInp) keyInp.value = '';
    if (resultCountEl) resultCountEl.style.display = 'none';

    this.renderStickies(App.stores?.stickies ? App.stores.stickies.getItems() : []);
  },

  renderStickies(items) {
    const listEl = document.getElementById('stickyList');
    if (!listEl) return;

    const source = (Array.isArray(items)) ? items : (App.stores?.stickies ? App.stores.stickies.getItems() : []);

    if (source.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">해당하는 고정 메모가 없습니다. 📌</div>`;
      return;
    }

    listEl.innerHTML = source.map(s => {
      const isDone = Boolean(s.completed);
      const dateText = s.date ? `📅 ${s.date}` : (s.time ? `🕒 ${s.time}` : '');
      const authorText = s.author ? `작성: ${s.author}` : '가족';

      return `
        <div class="sticky-note-card ${isDone ? 'completed' : ''}" onclick="App.memo.openEditModal('${s.id}')" title="클릭하여 수정">
          <button type="button" class="sticky-check-btn" onclick="App.memo.toggleSticky('${s.id}', event)" title="완료 체크">
            ${isDone ? '☑️' : '⬜'}
          </button>
          
          <div style="flex: 1; min-width: 0;">
            <div class="sticky-text">${escapeHtml(s.text)}</div>
            <div class="sticky-meta-row">
              <span>${escapeHtml(dateText)}</span>
              <span>${escapeHtml(authorText)} · <strong style="color:#2563eb;">✏️ 수정</strong></span>
            </div>
          </div>

          <button type="button" class="delete-item-btn" onclick="App.memo.deleteSticky('${s.id}', event)" title="메모 삭제">✕</button>
        </div>
      `;
    }).join('');
  },

  render() {
    if (App.stores?.todos) this.renderTodos(App.stores.todos.getItems());
    this.filterStickies();
  }
};
