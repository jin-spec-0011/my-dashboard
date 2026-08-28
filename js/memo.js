window.App = window.App || {};

App.memo = {
  currentTab: 'todo',

  switchTab(tab) {
    this.currentTab = tab;
    const todoBtn = document.getElementById('tab-todo');
    const stickyBtn = document.getElementById('tab-sticky');
    const todoSec = document.getElementById('memoTodoSection');
    const stickySec = document.getElementById('memoStickySection');

    if (todoBtn) todoBtn.classList.toggle('active', tab === 'todo');
    if (stickyBtn) stickyBtn.classList.toggle('active', tab === 'sticky');
    if (todoSec) todoSec.style.display = tab === 'todo' ? 'block' : 'none';
    if (stickySec) stickySec.style.display = tab === 'sticky' ? 'block' : 'none';
    this.render();
  },

  addTodo() {
    const input = document.getElementById('todoInput');
    const text = input ? input.value.trim() : '';
    if (!text) return alert("장보기 품목 또는 할 일을 입력하세요.");

    const author = (App.auth && App.auth.currentUser !== 'public') 
      ? (App.auth.currentUser === 'jinse' ? '진세' : '지혜') 
      : '가족';

    const newTodo = {
      id: Date.now(),
      text: text,
      author: author,
      completed: false,
      date: new Date().toISOString().split('T')[0]
    };

    if (App.stores?.todos) {
      App.stores.todos.add(newTodo);
    }
    if (input) input.value = '';
    App.ui.toast("🛒 장보기 항목이 추가되었습니다.");
  },

  toggleTodo(id) {
    const items = App.stores?.todos ? App.stores.todos.getItems() : [];
    const item = items.find(i => String(i.id) === String(id));
    if (item && App.stores?.todos) {
      App.stores.todos.update(id, { completed: !item.completed });
    }
  },

  deleteTodo(id) {
    if (App.stores?.todos) {
      App.stores.todos.remove(id);
      App.ui.toast("🗑️ 항목이 삭제되었습니다.");
    }
  },

  renderTodos(items = []) {
    const listEl = document.getElementById('todoList');
    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">장보기 목록이 비어있습니다. 🛒</div>`;
      return;
    }

    listEl.innerHTML = items.map(item => {
      const itemText = item.text || item.title || '품목';
      return `
        <div class="log-item" style="${item.completed ? 'opacity:0.6;' : ''}">
          <div class="log-content" onclick="App.memo.toggleTodo('${item.id}')" style="cursor:pointer; display:flex; flex-direction:row; align-items:center; gap:8px;">
            <span style="font-size: 16px;">${item.completed ? '☑️' : '⬜'}</span>
            <span class="log-text" style="${item.completed ? 'text-decoration:line-through; color:#94a3b8;' : ''}">${escapeHtml(itemText)}</span>
            <span style="font-size:11px; color:#64748b;">[${escapeHtml(item.author || '가족')}]</span>
          </div>
          <button type="button" class="delete-item-btn" onclick="App.memo.deleteTodo('${item.id}')">✕</button>
        </div>
      `;
    }).join('');
  },

  addSticky() {
    const input = document.getElementById('stickyInput');
    const text = input ? input.value.trim() : '';
    if (!text) return alert("메모 내용을 입력하세요.");

    const newSticky = {
      id: Date.now(),
      text: text,
      date: new Date().toISOString().split('T')[0]
    };

    if (App.stores?.stickies) {
      App.stores.stickies.add(newSticky);
    }
    if (input) input.value = '';
    App.ui.toast("📌 고정 메모가 저장되었습니다.");
  },

  deleteSticky(id) {
    if (confirm("해당 메모를 삭제하시겠습니까?")) {
      if (App.stores?.stickies) {
        App.stores.stickies.remove(id);
        App.ui.toast("🗑️ 메모가 삭제되었습니다.");
      }
    }
  },

  renderStickies(items = []) {
    const listEl = document.getElementById('stickyList');
    if (!listEl) return;

    if (items.length === 0) {
      listEl.innerHTML = `<div style="color:var(--text-sub);font-size:13px;text-align:center;padding:24px 0;">등록된 고정 메모가 없습니다. 📌</div>`;
      return;
    }

    listEl.innerHTML = items.map(item => {
      const memoText = item.text || item.memo || '';
      return `
        <div class="log-item" style="background:#fef9c3; border-color:#fde047;">
          <div class="log-content">
            <div class="log-text" style="white-space:pre-wrap;">${escapeHtml(memoText)}</div>
            <div class="log-time">🕒 ${escapeHtml(item.date || '')}</div>
          </div>
          <button type="button" class="delete-item-btn" onclick="App.memo.deleteSticky('${item.id}')">✕</button>
        </div>
      `;
    }).join('');
  },

  render() {
    this.renderTodos(App.stores?.todos ? App.stores.todos.getItems() : []);
    this.renderStickies(App.stores?.stickies ? App.stores.stickies.getItems() : []);
  }
};
