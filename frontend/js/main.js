// 自定义下拉框:替代弹窗里系统默认的 <select>(父级/分组)
// items: [{value, label, depth}] ;value 为 '' 表示"无/顶层"
class CustomSelect {
  constructor(rootEl, { onchange = null } = {}) {
    this.root = rootEl;
    this.onchange = onchange;
    this.items = [];
    this.value = '';
    this.disabled = false;
    this.title = '';
    rootEl.classList.add('cs-select');
    rootEl.innerHTML = `
      <button type="button" class="cs-toggle">
        <span class="cs-label"></span>
        <span class="cs-chevron"></span>
      </button>
      <div class="cs-menu" hidden></div>`;
    this.toggleBtn = rootEl.querySelector('.cs-toggle');
    this.labelEl = rootEl.querySelector('.cs-label');
    this.chevronEl = rootEl.querySelector('.cs-chevron');
    this.menuEl = rootEl.querySelector('.cs-menu');
    this.chevronEl.innerHTML = Icon.chevronDown();
    this.toggleBtn.onclick = () => {
      if (this.disabled) return;
      this.menuEl.hidden ? this.open() : this.close();
    };
    document.addEventListener('click', (e) => {
      if (!this.root.contains(e.target)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.menuEl.hidden) {
        e.stopPropagation();
        this.close();
      }
    }, true);
  }

  _labelOf(value) {
    const item = this.items.find(i => i.value === value);
    return item ? item.label : (this.items[0] ? this.items[0].label : '');
  }

  _renderToggle() {
    this.labelEl.textContent = this._labelOf(this.value);
    this.toggleBtn.disabled = this.disabled;
    this.toggleBtn.title = this.disabled ? this.title : '';
    this.root.classList.toggle('cs-disabled', this.disabled);
  }

  _renderMenu() {
    this.menuEl.innerHTML = '';
    for (const item of this.items) {
      const el = document.createElement('div');
      el.className = 'dropdown-item cs-option' + (item.value === this.value ? ' active' : '');
      el.style.paddingLeft = (10 + (item.depth || 0) * 14) + 'px';
      const label = document.createElement('span');
      label.className = 'cs-option-label';
      label.textContent = item.label;
      el.appendChild(label);
      if (item.value === this.value) {
        const check = document.createElement('span');
        check.className = 'cs-check';
        check.innerHTML = Icon.check();
        el.appendChild(check);
      }
      el.onclick = () => {
        this.value = item.value;
        this.close();
        this._renderToggle();
        this._renderMenu();
        if (this.onchange) this.onchange(this.value);
      };
      this.menuEl.appendChild(el);
    }
  }

  // 重设选项(选中值重置为 selected 或第一项),不触发 onchange
  setOptions(items, selected) {
    this.items = items || [];
    const valid = selected !== undefined && this.items.some(i => i.value === selected);
    this.value = valid ? selected : (this.items[0] ? this.items[0].value : '');
    this._renderToggle();
    this._renderMenu();
    this.close();
  }

  // 程序赋值(不触发 onchange,同原生 select.value)
  setValue(value) {
    this.value = value;
    this._renderToggle();
    this._renderMenu();
  }

  getValue() { return this.value; }

  setDisabled(disabled, title = '') {
    this.disabled = disabled;
    this.title = title;
    if (disabled) this.close();
    this._renderToggle();
  }

  open() {
    this._renderMenu();
    this.menuEl.hidden = false;
    this.root.classList.add('cs-open');
    const activeEl = this.menuEl.querySelector('.cs-option.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  close() {
    this.menuEl.hidden = true;
    this.root.classList.remove('cs-open');
  }
}

const Main = {
  state: {
    todos: [],
    groups: [],
    activeGroup: '__all__',
    calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    dayViewDate: null,
    dayExpanded: null,
    groupExpanded: new Map(), // 分组 tab 独立展开状态(会话级):tabKey -> Map<todoId,bool>
    hideDone: false,
    highlightId: null,
    settings: null,
    settingsTab: 'general',
    bulkExpandPending: false,
    archivedTodos: [],
    historyAllTodos: [],
    historyOpen: false,
    historyQuery: '',
    historyLimit: 50,
    historyCollapsed: true,
    archiveCheckPending: false,
    bulkMode: false,
    bulkSelected: new Set(),
  },
  editingId: null,
  confirmResolver: null,
  confirmPreviousFocus: null,
  promptResolver: null,
  promptPreviousFocus: null,

  async init() {
    Icon.render(document);
    try {
      this._cachedVersion = await API.appVersion();
    } catch (e) { console.warn('appVersion failed:', e); }
    const ddVer = document.getElementById('ddVersionValue');
    if (ddVer && this._cachedVersion) ddVer.textContent = `v${this._cachedVersion}`;
    try {
      this.state.settings = await API.getSettings();
    } catch (e) {
      console.error('load settings failed:', e);
      this.state.settings = await API.resetSettings();
    }
    // 拉数据目录路径(独立 command,不持久化)
    try { this.state.dataDir = await API.getDataDir(); } catch (e) { console.warn('getDataDir failed:', e); }
    // 从 localStorage 恢复 hideDone
    this.state.hideDone = localStorage.getItem('hideDone') === '1';
    this.applySettingsToDom();
    this.refreshDropdownValues();
    await this.reload();
    this.bindEvents();
    await this.checkArchiveDue();
    this.watchSystemTheme();
    this.startClock();
  },

  async reload() {
    try {
      const data = await API.list();
      this.state.todos = data.todos || [];
      try {
        this.state.groups = await API.listGroups();
      } catch (e) { console.warn('listGroups failed:', e); this.state.groups = []; }
      try {
        this.state.holidays = await window.__TAURI__.core.invoke('list_holidays');
      } catch (e) { console.warn('list_holidays failed:', e); this.state.holidays = {}; }
      Render.renderAll(this.state);
      this.renderGroupBar();
    } catch (e) {
      console.error(e);
      alert('加载失败:' + window.__tauriErrMsg(e));
    }
  },

  async checkArchiveDue() {
    if (this.state.archiveCheckPending || !this.state.settings?.autoArchive) return;
    this.state.archiveCheckPending = true;
    try {
      const archivedIds = await API.archiveDue();
      if (archivedIds.length) {
        await this.reload();
        if (this.state.historyOpen) await this.loadHistory();
      }
    } catch (e) {
      console.error('auto archive failed:', e);
    } finally {
      this.state.archiveCheckPending = false;
    }
  },

  async loadHistory() {
    try {
      const data = await API.listAll();
      this.state.historyAllTodos = data.todos || [];
      this.state.archivedTodos = this.state.historyAllTodos.filter(todo => todo.archivedAt);
      Render.renderHistory(this.state);
    } catch (e) {
      alert('加载归档记录失败:' + window.__tauriErrMsg(e));
    }
  },

  async openHistory() {
    this.toggleDropdown(false);
    this.closeModal();
    this.closeSettingsModal();
    if (this.state.dayViewDate) this.closeDayView();
    this.state.historyOpen = true;
    this.state.historyQuery = '';
    const search = document.getElementById('historySearch');
    search.value = '';
    document.getElementById('historyView').hidden = false;
    await this.loadHistory();
    search.focus();
  },

  closeHistory() {
    this.state.historyOpen = false;
    document.getElementById('historyView').hidden = true;
  },

  async restoreArchived(id) {
    try {
      await API.restoreArchived(id);
      await Promise.all([this.reload(), this.loadHistory()]);
    } catch (e) {
      await this.confirmAction({
        title: '恢复失败',
        messageHtml: `<div class="confirm-message-bulk">${window.__tauriErrMsg(e)}</div>`,
        confirmText: '知道了',
        hideCancel: true,
        danger: true,
      });
    }
  },

  async deleteArchived(id) {
    const todo = this.state.archivedTodos.find(item => item.id === id);
    if (!todo) return;
    const confirmed = await this.confirmAction({
      title: '永久删除',
      message: `永久删除 "${todo.title}" 及其归档子待办?此操作无法撤销。`,
      confirmText: '永久删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await API.deleteArchived(id);
      await this.loadHistory();
    } catch (e) {
      alert('永久删除失败:' + window.__tauriErrMsg(e));
    }
  },

  _findArchivedRoots() {
    const archived = this.state.archivedTodos || [];
    const all = this.state.historyAllTodos || [];
    const byId = new Map(all.map(t => [t.id, t]));
    const archivedSet = new Set(archived.map(t => t.id));
    const findRoot = (todo) => {
      const seen = new Set();
      let cur = todo;
      while (cur) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        if (!cur.parentId) return cur;
        const parent = byId.get(cur.parentId);
        if (!parent || !archivedSet.has(parent.id)) return cur;
        cur = parent;
      }
      return todo;
    };
    const roots = [];
    const seen = new Set();
    for (const t of archived) {
      const root = findRoot(t);
      if (seen.has(root.id)) continue;
      seen.add(root.id);
      roots.push(root);
    }
    return roots;
  },

  openRangeDeleteModal() {
    document.getElementById('rangeDeleteMask').hidden = false;
    document.getElementById('rangeField').value = 'completed';
    document.getElementById('rangeStart').value = '';
    document.getElementById('rangeEnd').value = '';
    this._refreshRangeCount();
  },

  closeRangeDeleteModal() {
    document.getElementById('rangeDeleteMask').hidden = true;
  },

  _refreshRangeCount() {
    const field = document.getElementById('rangeField').value;
    const startRaw = document.getElementById('rangeStart').value;
    const endRaw = document.getElementById('rangeEnd').value;
    const parseDay = (str) => {
      if (!str) return null;
      const [y, m, d] = str.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const start = parseDay(startRaw);
    const startBoundary = start ? start.getTime() : null;
    const end = parseDay(endRaw);
    const endBoundary = end ? end.getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const matchRootIds = new Set();
    for (const t of this.state.archivedTodos || []) {
      const iso = field === 'archived' ? t.archivedAt : t.completedAt;
      if (!iso) continue;
      const tTime = new Date(iso).getTime();
      if (Number.isNaN(tTime)) continue;
      if (startBoundary !== null && tTime < startBoundary) continue;
      if (endBoundary !== null && tTime > endBoundary) continue;
      matchRootIds.add(t.id);
    }
    const roots = this._findArchivedRoots().filter(r =>
      this._subtreeHasMatchRoot(r.id, matchRootIds)
    );
    const el = document.getElementById('rangeCount');
    if (el) {
      const total = this._countSubtree(roots);
      el.textContent = `符合条件的归档:${total} 项(${roots.length} 棵树)`;
    }
  },

  _subtreeHasMatchRoot(rootId, matchIds) {
    const all = this.state.historyAllTodos || [];
    const archived = this.state.archivedTodos || [];
    const archivedByParent = new Map();
    for (const t of archived) {
      const k = t.parentId || '__root__';
      if (!archivedByParent.has(k)) archivedByParent.set(k, []);
      archivedByParent.get(k).push(t);
    }
    const stack = [archived.find(t => t.id === rootId)];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      if (matchIds.has(cur.id)) return true;
      const kids = archivedByParent.get(cur.id) || [];
      for (const k of kids) stack.push(k);
    }
    return false;
  },

  _countSubtree(roots) {
    const archived = this.state.archivedTodos || [];
    const byParent = new Map();
    for (const t of archived) {
      const k = t.parentId || '__root__';
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(t);
    }
    let total = 0;
    const stack = [...roots];
    const seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      total++;
      const kids = byParent.get(cur.id) || [];
      for (const k of kids) stack.push(k);
    }
    return total;
  },

  async confirmRangeDelete() {
    const field = document.getElementById('rangeField').value;
    const fieldLabel = field === 'archived' ? '归档时间' : '完成时间';
    const startRaw = document.getElementById('rangeStart').value;
    const endRaw = document.getElementById('rangeEnd').value;
    const parseDay = (str) => {
      if (!str) return null;
      const [y, m, d] = str.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const start = parseDay(startRaw);
    const startBoundary = start ? start.getTime() : null;
    const end = parseDay(endRaw);
    const endBoundary = end ? end.getTime() + 24 * 60 * 60 * 1000 - 1 : null;
    const matchRootIds = new Set();
    for (const t of this.state.archivedTodos || []) {
      const iso = field === 'archived' ? t.archivedAt : t.completedAt;
      if (!iso) continue;
      const tTime = new Date(iso).getTime();
      if (Number.isNaN(tTime)) continue;
      if (startBoundary !== null && tTime < startBoundary) continue;
      if (endBoundary !== null && tTime > endBoundary) continue;
      matchRootIds.add(t.id);
    }
    const roots = this._findArchivedRoots().filter(r =>
      this._subtreeHasMatchRoot(r.id, matchRootIds)
    );
    if (!roots.length) {
      alert('没有符合条件的归档');
      return;
    }
    const total = this._countSubtree(roots);
    const rangeDesc = [startRaw || '不限', endRaw || '不限'].join(' ~ ');
    const confirmed = await this.confirmAction({
      title: '按时间永久删除',
      message: `将永久删除 ${fieldLabel} 在 ${rangeDesc} 区间内的归档,共 ${total} 项(${roots.length} 棵树)。此操作无法撤销。`,
      confirmText: '永久删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      for (const r of roots) {
        await API.deleteArchived(r.id);
      }
      this.closeRangeDeleteModal();
      await this.loadHistory();
    } catch (e) {
      alert('永久删除失败:' + window.__tauriErrMsg(e));
    }
  },

  openDeleteAllModal() {
    const total = (this.state.archivedTodos || []).length;
    const roots = this._findArchivedRoots();
    const msg = document.getElementById('deleteAllMessage');
    if (msg) {
      msg.textContent = `将永久删除所有归档,共 ${total} 项(${roots.length} 棵树)。此操作无法撤销。`;
    }
    document.getElementById('deleteAllMask').hidden = false;
  },

  closeDeleteAllModal() {
    document.getElementById('deleteAllMask').hidden = true;
  },

  async confirmDeleteAll() {
    const roots = this._findArchivedRoots();
    if (!roots.length) {
      this.closeDeleteAllModal();
      return;
    }
    const btn = document.getElementById('btnDeleteAllConfirm');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '删除中...';
    try {
      for (const r of roots) {
        await API.deleteArchived(r.id);
      }
      this.closeDeleteAllModal();
      await this.loadHistory();
    } catch (e) {
      alert('永久删除失败:' + window.__tauriErrMsg(e));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  },

  async archiveCurrent() {
    if (!this.editingId) return;
    const todo = this.state.todos.find(item => item.id === this.editingId);
    if (!todo || !todo.done) return;
    const confirmed = await this.confirmAction({
      title: '立即归档',
      message: `立即归档 "${todo.title}" 及其已完成子待办?`,
      confirmText: '归档',
    });
    if (!confirmed) return;
    try {
      await API.archiveNow(todo.id);
      this.closeModal();
      await this.reload();
    } catch (e) {
      await this.confirmAction({
        title: '归档失败',
        messageHtml: `<div class="confirm-message-bulk">${window.__tauriErrMsg(e)}</div>`,
        confirmText: '知道了',
        hideCancel: true,
        danger: true,
      });
    }
  },

  // 把 settings 应用到 <html> 根元素 (data-theme / data-font-size / data-compact)
  startClock() {
    const clockEl = document.getElementById('timeClock');
    if (!clockEl) return;
    const showSec = !!this.state?.settings?.clockShowSeconds;
    const showTime = this.state?.settings?.clockShowTime !== false;
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    if (showSec) {
      clockEl.classList.add('time-clock-seconds');
      clockEl.innerHTML = `
        <div class="time-clock-hm"></div>
        <div class="time-clock-bar"><div class="time-clock-bar-fill"></div></div>
      `;
      const hmEl = clockEl.querySelector('.time-clock-hm');
      const fillEl = clockEl.querySelector('.time-clock-bar-fill');
      const update = () => {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        hmEl.innerHTML = `${pad(d.getHours())}:${pad(d.getMinutes())}<span class="time-clock-sec">:${pad(d.getSeconds())}</span>`;
        fillEl.style.width = `${(d.getSeconds() / 60) * 100}%`;
      };
      update();
      if (this._clockTimer) clearInterval(this._clockTimer);
      this._clockTimer = setInterval(update, 1000);
    } else {
      clockEl.classList.remove('time-clock-seconds');
      clockEl.innerHTML = `
        <span class="time-clock-date"></span>
        ${showTime ? '<span class="time-clock-sep"></span>\n        <span class="time-clock-hm"></span>' : ''}
      `;
      const dateEl = clockEl.querySelector('.time-clock-date');
      const hmEl = clockEl.querySelector('.time-clock-hm');
      const update = () => {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        dateEl.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
        if (hmEl) hmEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      update();
      if (this._clockTimer) clearInterval(this._clockTimer);
      this._clockTimer = setInterval(update, 60000);
    }
  },

  // ===== 批量模式 =====
  toggleBulkMode() {
    if (this.state.bulkMode) this.exitBulkMode();
    else this.enterBulkMode();
  },

  enterBulkMode() {
    this.state.bulkMode = true;
    this.state.bulkSelected = new Set();
    document.body.classList.add('bulk-mode');
    document.getElementById('bulkActionBar').hidden = false;
    this._renderBulkState();
    Render.renderList(this.state);
  },

  exitBulkMode() {
    this.state.bulkMode = false;
    this.state.bulkSelected = new Set();
    document.body.classList.remove('bulk-mode');
    document.getElementById('bulkActionBar').hidden = true;
    Render.renderList(this.state);
  },

  toggleBulkSelect(id) {
    if (!this.state.bulkSelected) this.state.bulkSelected = new Set();
    if (this.state.bulkSelected.has(id)) this.state.bulkSelected.delete(id);
    else this.state.bulkSelected.add(id);
    this._renderBulkState();
    Render.renderList(this.state);
  },

  async bulkSelectAll() {
    // 只选当前视图(分组 tab 过滤);hideDone 时隐藏的已完成不选
    const active = this.state.activeGroup || '__all__';
    const hideDone = this.state.hideDone;
    const inView = this.state.todos.filter(t => {
      if (active === '__default__') { if (t.groupId) return false; }
      else if (active !== '__all__' && t.groupId !== active) return false;
      if (hideDone && t.done) return false;
      return true;
    });
    this.state.bulkSelected = new Set(inView.map(t => t.id));
    this._renderBulkState();
    // 分组 tab:自动展开走本 tab 会话 Map,不全局写库
    if (this.groupTabKey()) {
      const m = this._groupExpandedMap();
      for (const t of inView) m.set(t.id, true);
      Render.renderList(this.state);
      this.refreshExpandButton();
      return;
    }
    try {
      await API.setAllExpanded(true);
      await this.reload();
      // reload 后 bulkSelected 保留,重新渲染
      this._renderBulkState();
      Render.renderList(this.state);
    } catch (e) {
      console.error('bulkSelectAll failed:', e);
      Render.renderList(this.state);
    }
  },

  async bulkSelectDone() {
    const hideDone = this.state.hideDone;
    const doneTodos = this.state.todos.filter(t => t.done);
    this.state.bulkSelected = new Set(
      doneTodos.filter(t => !hideDone).map(t => t.id)
    );
    // 展开所有"包含已完成后代"的祖先链
    const byId = new Map(this.state.todos.map(t => [t.id, t]));
    const expandIds = new Set();
    for (const t of doneTodos) {
      let pid = t.parentId;
      const seen = new Set();
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        const parent = byId.get(pid);
        if (!parent) break;
        if (parent.expanded === false) expandIds.add(parent.id);
        pid = parent.parentId;
      }
    }
    this._renderBulkState();
    if (expandIds.size > 0) {
      try {
        for (const id of expandIds) {
          await API.update(id, { expanded: true });
        }
        await this.reload();
        this._renderBulkState();
        Render.renderList(this.state);
        return;
      } catch (e) {
        console.error('bulkSelectDone expand failed:', e);
      }
    }
    Render.renderList(this.state);
  },

  bulkSelectNone() {
    this.state.bulkSelected = new Set();
    this._renderBulkState();
    Render.renderList(this.state);
  },

  _renderBulkState() {
    const count = this.state.bulkSelected.size;
    document.getElementById('bulkSelectedCount').textContent = count;
    const hasSel = count > 0;
    document.getElementById('btnBulkEdit').disabled = !hasSel;
    document.getElementById('btnBulkArchive').disabled = !hasSel;
    document.getElementById('btnBulkDelete').disabled = !hasSel;
    // 全选已完成:hideDone=true 时无可见已完成,禁用
    const hasVisibleDone = this.state.todos.some(t => t.done && !this.state.hideDone);
    const btnSelDone = document.getElementById('btnBulkSelectDone');
    if (btnSelDone) btnSelDone.disabled = !hasVisibleDone;
  },

  async bulkArchive() {
    const ids = Array.from(this.state.bulkSelected);
    if (!ids.length) return;
    const todos = this.state.todos.filter(t => ids.includes(t.id));
    const selectedDone = todos.filter(t => t.done);
    const selectedUndone = todos.filter(t => !t.done);

    // 顶层去重:仅当祖先也在 selectedDone(会归档)里才跳过
    // (未完成的祖先不会触发归档,不能去重它的后代)
    const doneIdSet = new Set(selectedDone.map(t => t.id));
    const topLevel = selectedDone.filter(t => {
      let pid = t.parentId;
      while (pid) {
        if (doneIdSet.has(pid)) return false;
        const p = this.state.todos.find(x => x.id === pid);
        pid = p?.parentId || null;
      }
      return true;
    });

    // 对每个顶层 root,展开子树,按状态分类
    const archiveRoots = [];        // 可归档(整棵子树 done)
    const skipUnfinishedRoots = []; // 跳过(子代办含未完成)
    let totalArchiveCount = 0;       // 实际归档条数(含子代办)
    let totalChildCount = 0;         // 子待办总数

    for (const root of topLevel) {
      const subtreeIds = this.collectDescendants(root.id);
      const subtreeTodos = subtreeIds
        .map(id => this.state.todos.find(t => t.id === id))
        .filter(Boolean);
      // 只看未归档的(已归档的不再重复)
      const active = subtreeTodos.filter(t => !t.archivedAt);
      const hasUnfinished = active.some(t => !t.done);
      if (hasUnfinished) {
        skipUnfinishedRoots.push(root);
      } else {
        archiveRoots.push(root);
        totalArchiveCount += active.length;
        totalChildCount += Math.max(0, active.length - 1);
      }
    }

    // 全部无法归档的提示
    if (!archiveRoots.length) {
      const reason = selectedUndone.length === ids.length
        ? `所选 <strong style="color:var(--overdue)">${ids.length}</strong> 项都未完成。<br>只能归档<strong>已完成</strong>的待办。`
        : `所选 <strong style="color:var(--overdue)">${topLevel.length}</strong> 项的子树中含未完成子待办,无法归档。`;
      await this.confirmAction({
        title: '无法归档',
        messageHtml: `<div class="confirm-message-bulk">${reason}</div>`,
        confirmText: '知道了',
        hideCancel: true,
      });
      return;
    }

    // 分类汇总表格
    const coveredCount = selectedDone.length - topLevel.length;
    const skipRows = [];
    if (selectedUndone.length) {
      skipRows.push(`<span class="label">○ 自身未完成</span><span class="label">跳过</span><span class="num skip">${selectedUndone.length}</span>`);
    }
    if (skipUnfinishedRoots.length) {
      skipRows.push(`<span class="label">○ 子代办未完成</span><span class="label">跳过</span><span class="num skip">${skipUnfinishedRoots.length}</span>`);
    }
    if (coveredCount > 0) {
      skipRows.push(`<span class="label">↪ 随父待办归档</span><span class="label">合并</span><span class="num">${coveredCount}</span>`);
    }
    const showTable = skipRows.length || archiveRoots.length !== topLevel.length || totalChildCount > 0;

    const summaryHtml = `
      <div class="confirm-message-bulk">
        ${skipRows.length || selectedUndone.length
          ? `已选 <strong>${ids.length}</strong> 项,分类如下:`
          : `将归档 <strong style="color:#10b981">${totalArchiveCount}</strong> 项${totalChildCount ? ` <span style="color:var(--muted);font-size:11px">(${archiveRoots.length} 个父代办 + ${totalChildCount} 个子待办)</span>` : ''}`}
        ${showTable ? `
        <div class="bulk-summary">
          <span class="label">✓ 可归档</span><span></span><span class="num ok">${totalArchiveCount}</span>
          ${skipRows.join('')}
        </div>` : ''}
      </div>`;
    const confirmed = await this.confirmAction({
      title: '批量归档',
      messageHtml: summaryHtml,
      confirmText: `归档 ${totalArchiveCount} 项`,
    });
    if (!confirmed) return;
    try {
      for (const t of archiveRoots) {
        await API.archiveNow(t.id);
      }
      await this.reload();
      this.exitBulkMode();
    } catch (e) {
      await this.confirmAction({
        title: '批量归档失败',
        messageHtml: `<div class="confirm-message-bulk">${window.__tauriErrMsg(e)}</div>`,
        confirmText: '知道了',
        hideCancel: true,
        danger: true,
      });
    }
  },

  async bulkDelete() {
    const ids = Array.from(this.state.bulkSelected);
    if (!ids.length) return;
    const confirmed = await this.confirmAction({
      title: '批量删除',
      messageHtml: `<div class="confirm-message-bulk">确认永久删除 <strong style="color:var(--overdue)">${ids.length}</strong> 项?<br><span style="color:var(--muted);font-size:11px">包含其后代待办,不可恢复</span></div>`,
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      for (const id of ids) {
        await API.remove(id);
      }
      await this.reload();
      this.exitBulkMode();
    } catch (e) {
      alert('批量删除失败:' + window.__tauriErrMsg(e));
    }
  },

  openBulkEdit() {
    const ids = Array.from(this.state.bulkSelected);
    if (!ids.length) return;
    this._bulkEditIds = ids;
    document.getElementById('bulkEditCount').textContent = ids.length;
    document.getElementById('bulkEditMask').hidden = false;
    // 重置字段
    ['beChkStart', 'beChkEnd', 'beChkDone'].forEach((id) => {
      document.getElementById(id).checked = false;
    });
    document.getElementById('beFStart').value = '';
    document.getElementById('beFEnd').value = '';
    document.getElementById('beFDone').value = 'false';
    document.getElementById('beFStart').type = 'date';
    document.getElementById('beFEnd').type = 'date';
    document.getElementById('beBtnStartClock').textContent = '+ 时间';
    document.getElementById('beBtnEndClock').textContent = '+ 时间';
    this._syncBulkEditFields();
    this._renderDateDisplay('beFStart');
    this._renderDateDisplay('beFEnd');
    // 重新安装 date-display(首次)
    this._installAllDateDisplays();
  },

  closeBulkEdit() {
    document.getElementById('bulkEditMask').hidden = true;
    this._bulkEditIds = null;
  },

  _syncBulkEditFields() {
    ['Start', 'End', 'Done'].forEach((key) => {
      const chk = document.getElementById('beChk' + key);
      const field = chk.closest('.bulk-edit-field');
      if (field) field.classList.toggle('unchecked', !chk.checked);
    });
  },

  async saveBulkEdit() {
    if (!this._bulkEditIds || !this._bulkEditIds.length) return;
    const patch = {};
    if (document.getElementById('beChkStart').checked) {
      const val = document.getElementById('beFStart').value;
      if (val) {
        const inputType = document.getElementById('beFStart').type;
        patch.startTime = inputType === 'datetime-local'
          ? Render.localInputToISO(val)
          : Render.localDateToISO(val);
      } else {
        patch.startTime = null;
      }
    }
    if (document.getElementById('beChkEnd').checked) {
      const val = document.getElementById('beFEnd').value;
      if (val) {
        const inputType = document.getElementById('beFEnd').type;
        patch.endTime = inputType === 'datetime-local'
          ? Render.localInputToISO(val)
          : Render.localDateToISO(val);
      } else {
        patch.endTime = null;
      }
    }
    if (document.getElementById('beChkDone').checked) {
      patch.done = document.getElementById('beFDone').value === 'true';
      // 完成切换时,同步 completedAt
      if (patch.done) patch.completedAt = new Date().toISOString();
      else patch.completedAt = null;
    }
    if (!Object.keys(patch).length) {
      alert('请至少勾选一个要修改的字段');
      return;
    }
    try {
      for (const id of this._bulkEditIds) {
        await API.update(id, patch);
      }
      this.closeBulkEdit();
      await this.reload();
      this.exitBulkMode();
    } catch (e) {
      alert('批量修改失败:' + window.__tauriErrMsg(e));
    }
  },

  renderGroupBar() {
    const bar = document.getElementById('groupTabs');
    if (!bar) return;
    if (!this.state.settings?.enableGroups) { bar.innerHTML = ''; return; }
    const groups = this.state.groups || [];
    groups.sort((a, b) => (a.order || 0) - (b.order || 0));
    const active = this.state.activeGroup || '__all__';
    const tabs = [];
    tabs.push(`<div class="group-tab ${active === '__all__' ? 'active' : ''}" data-id="__all__" title="全部"><span class="group-tab-label">全部</span></div>`);
    const defName = this.defaultGroupName();
    tabs.push(`<div class="group-tab ${active === '__default__' ? 'active' : ''}" data-id="__default__" title="${defName}"><span class="group-tab-label">${defName}</span></div>`);
    for (const g of groups) {
      tabs.push(`<div class="group-tab ${active === g.id ? 'active' : ''}" data-id="${g.id}" title="${g.name}"><span class="group-tab-label">${g.name}</span></div>`);
    }
    bar.innerHTML = tabs.join('');
    let dragTabId = null;
    bar.querySelectorAll('.group-tab').forEach((el) => {
      el.addEventListener('click', () => {
        const changed = el.dataset.id !== (this.state.activeGroup || '__all__');
        this.state.activeGroup = el.dataset.id;
        // 批量模式下切分组:清空已选,防止误操作看不见的项
        if (changed && this.state.bulkMode && this.state.bulkSelected?.size) {
          this.state.bulkSelected = new Set();
          this._renderBulkState();
        }
        this.renderGroupBar();
        Render.renderAll(this.state);
      });
      // 具体分组 tab 可拖拽排序(全部/Default 固定)
      const tabId = el.dataset.id;
      if (tabId !== '__all__' && tabId !== '__default__') {
        el.draggable = true;
        el.ondragstart = (e) => {
          dragTabId = tabId;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', 'group:' + tabId);
        };
        el.ondragend = () => {
          dragTabId = null;
          el.classList.remove('drop-hint');
        };
        el.ondragover = (e) => {
          if (!dragTabId || dragTabId === tabId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          el.classList.add('drop-hint');
        };
        el.ondragleave = () => el.classList.remove('drop-hint');
        el.ondrop = (e) => {
          e.preventDefault();
          e.stopPropagation();
          el.classList.remove('drop-hint');
          const raw = dragTabId || e.dataTransfer.getData('text/plain').replace(/^group:/, '');
          dragTabId = null;
          if (!raw || raw === tabId) return;
          const rect = el.getBoundingClientRect();
          const after = (e.clientX - rect.left) > rect.width / 2;
          this.reorderGroups(raw, tabId, after);
        };
      }
    });
  },

  closeGroupManage() {
    document.getElementById('groupManagePop')?.remove();
    if (this._gmCleanup) { this._gmCleanup(); this._gmCleanup = null; }
  },

  toggleGroupManage() {
    if (document.getElementById('groupManagePop')) { this.closeGroupManage(); return; }
    const groups = [...(this.state.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const row = (id, name, color, tag) => {
      const dot = color
        ? `<span class="gm-dot" style="background:${color}"></span>`
        : `<span class="gm-dot none"></span>`;
      return `<div class="gm-row" data-id="${id}">${dot}<span class="gm-name">${name}</span>${tag ? '<span class="gm-tag">内置</span>' : ''}<svg class="gm-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></div>`;
    };
    const pop = document.createElement('div');
    pop.id = 'groupManagePop';
    pop.className = 'group-manage';
    pop.innerHTML = '<div class="gm-new"><span class="gm-txt"><span class="gm-plus">＋</span>新建分组</span></div>'
      + row('__default__', this.defaultGroupName(), this.defaultGroupColor(), true)
      + groups.map(g => row(g.id, g.name, g.color || null, false)).join('');
    document.getElementById('groupBar').appendChild(pop);
    pop.querySelector('.gm-new').onclick = () => { this.closeGroupManage(); this.openGroupCreate(); };
    pop.querySelectorAll('.gm-row').forEach(r => {
      r.onclick = () => { this.closeGroupManage(); this.openGroupEdit(r.dataset.id); };
    });
    this._gmOutside = (e) => {
      if (!pop.contains(e.target) && !e.target.closest('#btnGroupAdd')) this.closeGroupManage();
    };
    this._gmEsc = (e) => { if (e.key === 'Escape') this.closeGroupManage(); };
    document.addEventListener('mousedown', this._gmOutside);
    document.addEventListener('keydown', this._gmEsc);
    this._gmCleanup = () => {
      document.removeEventListener('mousedown', this._gmOutside);
      document.removeEventListener('keydown', this._gmEsc);
    };
  },

  _GROUP_COLORS: ['#D97757', '#3B82F6', '#06B6D4', '#10B981', '#F97316', '#EF4444', '#14B8A6', '#6B7280'],

  defaultGroupName() {
    return this.state.settings?.defaultGroupName || 'Default';
  },

  defaultGroupColor() {
    return this.state.settings?.defaultGroupColor || null;
  },

  _renderGroupColorPicker() {
    const box = document.getElementById('groupColorPicker');
    box.innerHTML = '';
    const mk = (color) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gc-swatch' + (color ? '' : ' gc-swatch-none');
      b.title = color || '无色';
      if (color) b.style.background = color;
      if ((this._pendingGroupColor || null) === color) b.classList.add('selected');
      b.onclick = () => {
        this._pendingGroupColor = color;
        this._renderGroupColorPicker();
      };
      box.appendChild(b);
    };
    mk(null);
    for (const c of this._GROUP_COLORS) mk(c);
  },

  openGroupEdit(id) {
    if (id === '__default__') {
      this._editingGroupId = '__default__';
      document.getElementById('groupModalTitle').textContent = '编辑分组';
      document.getElementById('fGroupEditName').value = this.defaultGroupName();
      document.getElementById('btnGroupDelete').hidden = true;
      this._pendingGroupColor = this.defaultGroupColor();
      this._renderGroupColorPicker();
      document.getElementById('groupMask').hidden = false;
      document.getElementById('fGroupEditName').focus();
      return;
    }
    const group = (this.state.groups || []).find(g => g.id === id);
    if (!group) return;
    this._editingGroupId = id;
    document.getElementById('groupModalTitle').textContent = '编辑分组';
    document.getElementById('fGroupEditName').value = group.name;
    document.getElementById('btnGroupDelete').hidden = false;
    this._pendingGroupColor = group.color || null;
    this._renderGroupColorPicker();
    document.getElementById('groupMask').hidden = false;
    document.getElementById('fGroupEditName').focus();
  },

  openGroupCreate() {
    this._editingGroupId = null;
    document.getElementById('groupModalTitle').textContent = '新建分组';
    document.getElementById('fGroupEditName').value = '';
    document.getElementById('btnGroupDelete').hidden = true;
    this._pendingGroupColor = null;
    this._renderGroupColorPicker();
    document.getElementById('groupMask').hidden = false;
    document.getElementById('fGroupEditName').focus();
  },

  closeGroupModal() {
    document.getElementById('groupMask').hidden = true;
    this._editingGroupId = null;
  },

  async saveGroupModal() {
    const id = this._editingGroupId;
    const name = document.getElementById('fGroupEditName').value.trim();
    const color = this._pendingGroupColor || null;
    if (!name) { alert('请输入分组名称'); return; }
    try {
      if (id === '__default__') {
        await this.patchSettings({ defaultGroupName: name, defaultGroupColor: color });
        this.closeGroupModal();
        this.renderGroupBar();
        return;
      }
      if (!id) {
        await API.createGroup(name, color);
        this.state.activeGroup = '__all__';
      } else {
        const group = (this.state.groups || []).find(g => g.id === id);
        if (name !== group.name) await API.renameGroup(id, name);
        if ((group.color || null) !== color) await API.setGroupColor(id, color);
      }
      this.closeGroupModal();
      await this.reload();
    } catch (e) { alert('保存分组失败:' + window.__tauriErrMsg(e)); }
  },

  async deleteGroupFromModal() {
    const id = this._editingGroupId;
    const group = (this.state.groups || []).find(g => g.id === id);
    if (!group) return;
    const confirmed = await this.confirmAction({
      title: '删除分组',
      message: `确定删除分组 "${group.name}"?组内待办将移到 ${this.defaultGroupName()}。`,
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await API.deleteGroup(id);
      if (this.state.activeGroup === id) this.state.activeGroup = '__all__';
      this.closeGroupModal();
      await this.reload();
    } catch (e) { alert('删除分组失败:' + window.__tauriErrMsg(e)); }
  },

  applySettingsToDom() {
    const s = this.state.settings || {};
    const html = document.documentElement;
    // theme=system 时解析成实际 light/dark
    let theme = s.theme || 'light';
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    html.setAttribute('data-theme', theme);
    html.setAttribute('data-font-size', s.fontSize || 'medium');
    html.setAttribute('data-compact', s.compact ? 'true' : 'false');
    html.setAttribute('data-numbering-palette', s.numberingPalette || 'classic');
    html.setAttribute('data-theme-color', s.themeColor || 'blue');
    html.setAttribute('data-font-color', s.fontColor || 'default');
    html.setAttribute('data-day-item-mode', s.dayItemColorMode || 'theme');
    html.setAttribute('data-day-item-custom', s.dayItemCustomColor || 'sunset');
    html.setAttribute('data-todo-item-mode', s.todoItemColorMode || 'none');
    html.setAttribute('data-todo-item-custom', s.todoItemCustomColor || 'sunset');
    html.setAttribute('data-start-event-mode', s.startEventColorMode || 'theme');
    html.setAttribute('data-start-event-custom', s.startEventCustomColor || 'amber');
    Render.showTimePrecision = s.showTimePrecision === true;
    const groupBar = document.getElementById('groupBar');
    if (groupBar) groupBar.hidden = !s.enableGroups;
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.classList.toggle('gb-solo', s.groupBarMerged !== true);
    this.renderGroupBar();
  },

  // 乐观更新:立即改本地状态 + 重渲染,再异步发 API
  // 注:autoCollapseDone 的 expanded=false 由调用方放进 patch,这样后端也会保存
  applyLocalUpdate(id, patch) {
    const t = this.state.todos.find(x => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if (this.state.dayExpanded && 'expanded' in patch) this.state.dayExpanded.set(id, patch.expanded !== false);
    if ('expanded' in patch) this.syncGroupExpand(id, patch.expanded);
    Render.renderAll(this.state);
  },

  async sendUpdate(id, patch) {
    try {
      const updated = await API.update(id, patch);
      if (updated) {
        const t = this.state.todos.find(x => x.id === id);
        if (t) Object.assign(t, updated);
        Render.renderAll(this.state);
      }
      if ('done' in patch) await this.checkArchiveDue();
    } catch (e) {
      alert('保存失败:' + window.__tauriErrMsg(e));
      this.reload();
    }
  },

  parentTodos() {
    const parentIds = new Set(
      this.state.todos.map(todo => todo.parentId).filter(Boolean)
    );
    return this.state.todos.filter(todo => parentIds.has(todo.id));
  },

  refreshExpandButton() {
    const button = document.getElementById('btnToggleExpand');
    if (!button) return;
    let shouldCollapse;
    let parentCount;
    if (this.groupTabKey()) {
      // 分组 tab:读该 tab 会话 Map(缺省=折叠)
      const m = this.state.groupExpanded.get(this.groupTabKey());
      const parents = this._groupTabParents();
      parentCount = parents.length;
      shouldCollapse = parents.some(t => m ? m.get(t.id) === true : false);
    } else {
      const parents = this.parentTodos();
      parentCount = parents.length;
      shouldCollapse = parents.some(todo => todo.expanded !== false);
    }
    const label = shouldCollapse ? '折叠全部' : '展开全部';
    button.innerHTML = shouldCollapse ? Icon.chevronsUp() : Icon.chevronsDown();
    button.title = label;
    button.setAttribute('aria-label', label);
    button.disabled = this.state.bulkExpandPending || parentCount === 0;
  },

  async toggleAllExpanded() {
    if (this.state.bulkExpandPending) return;
    // 分组 tab:一键只改本 tab 会话 Map,不写库
    if (this.groupTabKey()) {
      const parents = this._groupTabParents();
      if (parents.length === 0) return;
      const m = this._groupExpandedMap();
      const expanded = !parents.some(t => m.get(t.id) === true);
      for (const t of parents) m.set(t.id, expanded);
      Render.renderList(this.state);
      this.refreshExpandButton();
      return;
    }
    const parents = this.parentTodos();
    if (parents.length === 0) return;

    const before = parents.map(todo => ({ todo, expanded: todo.expanded }));
    const expanded = !parents.some(todo => todo.expanded !== false);
    this.state.bulkExpandPending = true;
    for (const todo of parents) todo.expanded = expanded;
    Render.renderList(this.state);
    this.refreshExpandButton();

    try {
      const data = await API.setAllExpanded(expanded);
      this.state.todos = data.todos || [];
    } catch (e) {
      for (const item of before) item.todo.expanded = item.expanded;
      alert('保存失败:' + window.__tauriErrMsg(e));
    } finally {
      this.state.bulkExpandPending = false;
      Render.renderAll(this.state);
      this.refreshExpandButton();
    }
  },

  // ===== 日详情独立展开状态(临时,退出即弃,不写库) =====
  dayIsExpanded(id) {
    const m = this.state.dayExpanded;
    if (!m) return true;
    return m.get(id) !== false;
  },

  toggleDayExpand(id) {
    if (!this.state.dayExpanded) return;
    this.state.dayExpanded.set(id, !this.dayIsExpanded(id));
    Render.renderDayView(this.state);
  },

  // 当天视图里可见的父待办 id(一键展开只作用于这个范围)
  _dayVisibleParentIds() {
    const d = this.state.dayViewDate;
    if (!d) return [];
    const ids = new Set();
    for (const e of Render.getRootDayEntries(this.state, d)) {
      this.collectDescendants(e.root.id).forEach(id => ids.add(id));
    }
    return this.state.todos
      .filter(t => ids.has(t.id) && this.state.todos.some(c => c.parentId === t.id))
      .map(t => t.id);
  },

  dayAnyExpanded() {
    return this._dayVisibleParentIds().some(id => this.dayIsExpanded(id));
  },

  toggleDayAllExpanded() {
    if (!this.state.dayExpanded) return;
    const ids = this._dayVisibleParentIds();
    if (!ids.length) return;
    const expand = !this.dayAnyExpanded();
    for (const id of ids) this.state.dayExpanded.set(id, expand);
    Render.renderDayView(this.state);
  },

  // ===== 分组 tab 独立展开状态(会话级,切走保留,退出即弃,不写库;缺省=折叠) =====
  // 当前是否处于具体分组 tab(全部视图/未启用分组返回 null,走持久化 expanded 字段)
  groupTabKey() {
    if (!this.state.settings?.enableGroups) return null;
    const a = this.state.activeGroup || '__all__';
    return a === '__all__' ? null : a;
  },

  _groupExpandedMap() {
    const key = this.groupTabKey();
    if (!key) return null;
    let m = this.state.groupExpanded.get(key);
    if (!m) { m = new Map(); this.state.groupExpanded.set(key, m); }
    return m;
  },

  groupIsExpanded(id) {
    const key = this.groupTabKey();
    if (!key) return undefined;
    const m = this.state.groupExpanded.get(key);
    return m ? m.get(id) === true : false;
  },

  toggleGroupExpand(id) {
    const m = this._groupExpandedMap();
    if (!m) return;
    m.set(id, !(m.get(id) === true));
  },

  // 写库的 expanded 变更(如勾选完成自动折叠)同步进当前分组 tab 的 Map
  syncGroupExpand(id, expanded) {
    const m = this._groupExpandedMap();
    if (!m) return;
    m.set(id, expanded !== false);
  },

  // 当前分组 tab 内的父待办(一键展开/按钮状态只作用于这个范围)
  _groupTabParents() {
    const active = this.state.activeGroup;
    return this.parentTodos().filter(t =>
      active === '__default__' ? !t.groupId : t.groupId === active);
  },

  // targetGroupId: undefined=不变更分组;null/组id=行拖拽落点所在分组(子树跟随)
  async moveTodo(id, parentId, index, targetGroupId) {
    const before = JSON.parse(JSON.stringify(this.state.todos));
    const moving = this.state.todos.find(t => t.id === id);
    if (!moving) return;

    const groupChanged = targetGroupId !== undefined && (moving.groupId || null) !== targetGroupId;
    if (groupChanged) {
      this.collectDescendants(id).forEach((did) => {
        const t = this.state.todos.find(x => x.id === did);
        if (t) t.groupId = targetGroupId;
      });
    }

    const oldParentId = moving.parentId || null;
    const sortedSiblings = (targetParentId) => this.state.todos
      .map((todo, position) => ({ todo, position }))
      .filter(({ todo }) => (todo.parentId || null) === targetParentId && todo.id !== id)
      .sort((a, b) => (a.todo.order ?? 0) - (b.todo.order ?? 0) || a.position - b.position)
      .map(({ todo }) => todo);

    const targetSiblings = sortedSiblings(parentId);
    targetSiblings.splice(Math.min(Math.max(index, 0), targetSiblings.length), 0, moving);
    moving.parentId = parentId;
    targetSiblings.forEach((todo, order) => { todo.order = order; });
    if (parentId) {
      const parent = this.state.todos.find(t => t.id === parentId);
      if (parent) parent.expanded = true;
    }
    if (oldParentId !== parentId) {
      sortedSiblings(oldParentId).forEach((todo, order) => { todo.order = order; });
    }
    Render.renderAll(this.state);

    try {
      if (groupChanged) await API.setTodoGroup(id, targetGroupId);
      const data = await API.moveTodo(id, parentId, index);
      this.state.todos = data.todos || [];
      Render.renderAll(this.state);
    } catch (e) {
      this.state.todos = before;
      Render.renderAll(this.state);
      await this.confirmAction({
        title: '移动失败',
        messageHtml: `<div class="confirm-message-bulk">${window.__tauriErrMsg(e)}</div>`,
        confirmText: '知道了',
        hideCancel: true,
        danger: true,
      });
    }
  },

  // 拖到分组卡片:整个子树换组并成为该组顶层(追加末尾)
  async moveToGroup(id, groupId) {
    const before = JSON.parse(JSON.stringify(this.state.todos));
    const moving = this.state.todos.find(t => t.id === id);
    if (!moving || (moving.groupId || null) === groupId) return;

    this.collectDescendants(id).forEach((did) => {
      const t = this.state.todos.find(x => x.id === did);
      if (t) t.groupId = groupId;
    });
    moving.parentId = null;
    const maxTopOrder = this.state.todos
      .filter(t => !t.parentId)
      .reduce((max, t) => Math.max(max, t.order ?? 0), -1);
    moving.order = maxTopOrder + 1;
    Render.renderAll(this.state);

    try {
      const data = await API.moveToGroup(id, groupId);
      this.state.todos = data.todos || [];
      Render.renderAll(this.state);
    } catch (e) {
      this.state.todos = before;
      Render.renderAll(this.state);
      alert('移动分组失败:' + window.__tauriErrMsg(e));
    }
  },

  async reorderGroups(dragId, targetId, insertAfter) {
    const groups = [...(this.state.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const from = groups.findIndex(g => g.id === dragId);
    if (from < 0 || dragId === targetId) return;
    const [moved] = groups.splice(from, 1);
    let insertAt = groups.findIndex(g => g.id === targetId);
    if (insertAt < 0) return;
    if (insertAfter) insertAt += 1;
    groups.splice(insertAt, 0, moved);
    groups.forEach((g, i) => { g.order = i + 1; });
    this.renderGroupBar();
    try {
      await API.reorderGroups(groups.map(g => g.id));
    } catch (e) {
      alert('分组排序失败:' + window.__tauriErrMsg(e));
      await this.reload();
    }
  },

  // 收集 rootId 及所有后代 id(递归)
  collectDescendants(rootId, todos = this.state.todos) {
    const result = [rootId];
    const stack = [rootId];
    const byParent = Render.buildTree(todos);
    while (stack.length) {
      const cur = stack.pop();
      const kids = Render.getChildren(byParent, cur);
      for (const k of kids) {
        if (!result.includes(k.id)) {
          result.push(k.id);
          stack.push(k.id);
        }
      }
    }
    return result;
  },

  // 联动勾选:父代办 done 改变 → 所有后代 done 同步
  // parentPatch 是父代办额外的 patch(可能含 expanded=false)
  async cascadeDone(rootId, done, parentPatch = {}) {
    // 1. 本地:递归更新所有后代
    const ids = this.collectDescendants(rootId);
    for (const did of ids) {
      const t = this.state.todos.find(x => x.id === did);
      if (!t) continue;
      const patch = { done };
      if (done) patch.suspendedAt = null;
      if (did === rootId) Object.assign(patch, parentPatch);
      Object.assign(t, patch);
      if (this.state.dayExpanded && patch.expanded !== undefined) this.state.dayExpanded.set(did, patch.expanded !== false);
      if (patch.expanded !== undefined) this.syncGroupExpand(did, patch.expanded);
    }
    Render.renderAll(this.state);
    // 2. 后端:批量递归 done
    try {
      await API.setDoneRecursive(rootId, done);
      // 父代办可能还有 expanded 改动,单独 update
      if (parentPatch.expanded !== undefined || parentPatch.done === undefined) {
        // done 已被 set_todo_done_recursive 处理,这里只发 expanded 之类
        const { done: _drop, ...rest } = parentPatch;
        if (Object.keys(rest).length > 0) {
          await API.update(rootId, rest);
        }
      }
      await this.checkArchiveDue();
    } catch (e) {
      alert('保存失败:' + window.__tauriErrMsg(e));
      this.reload();
    }
  },

  // ===== Settings 保存 =====
  async patchSettings(patch) {
    const before = JSON.parse(JSON.stringify(this.state.settings));
    const groupsToggled = 'enableGroups' in patch && patch.enableGroups !== !!before.enableGroups;
    Object.assign(this.state.settings, patch);
    this.applySettingsToDom();
    this.refreshDropdownValues();
    Render.renderAll(this.state);
    try {
      await API.saveSettings(this.state.settings);
      if (groupsToggled) {
        await this.reload();
        return;
      }
      if ('autoArchive' in patch || 'archiveAfterDays' in patch) {
        await this.checkArchiveDue();
      }
      if ('clockShowSeconds' in patch || 'clockShowTime' in patch) {
        this.startClock();
      }
    } catch (e) {
      // 回滚
      this.state.settings = before;
      this.applySettingsToDom();
      this.refreshDropdownValues();
      Render.renderAll(this.state);
      alert('保存设置失败:' + window.__tauriErrMsg(e));
    }
  },

  async resetSettings() {
    const confirmed = await this.confirmAction({
      title: '重置设置',
      message: '确定恢复默认设置?所有偏好都会丢失。',
      confirmText: '重置',
      danger: true,
    });
    if (!confirmed) return;
    try {
      this.state.settings = await API.resetSettings();
      this.applySettingsToDom();
      this.refreshDropdownValues();
      this.renderSettingsModal();
      Render.renderAll(this.state);
      await this.checkArchiveDue();
    } catch (e) {
      alert('重置失败:' + window.__tauriErrMsg(e));
    }
  },

  // ===== Dropdown 开关 =====
  toggleDropdown(force) {
    const dd = document.getElementById('dropdown');
    const btn = document.getElementById('btnMenu');
    const shouldOpen = force !== undefined ? force : dd.hidden;
    if (shouldOpen) this.toggleSortDropdown(false);
    dd.hidden = !shouldOpen;
    btn.classList.toggle('active', shouldOpen);
  },

  async openHelp() {
    document.getElementById('helpMask').hidden = false;
    document.getElementById('helpLogo').innerHTML = Icon.check();
    try {
      const v = this._cachedVersion || await API.appVersion();
      document.getElementById('helpVersion').textContent = `v${v} · MIT`;
    } catch (e) { /* 用默认值 */ }
    const platform = navigator.platform || 'Unknown';
    const isWin = /Win/i.test(platform);
    const isMac = /Mac/i.test(platform);
    const osLabel = isWin ? 'Windows' : (isMac ? 'macOS' : 'Linux');
    document.getElementById('helpEnv').textContent = `Tauri · ${osLabel}`;
    this.checkUpdate();
  },
  closeHelp() {
    document.getElementById('helpMask').hidden = true;
  },
  openMonthPicker() {
    this._mpYear = this.state.calMonth.getFullYear();
    this._renderMonthPicker();
    const pop = document.getElementById('monthPickerPopover');
    pop.hidden = false;
    const label = document.getElementById('monthLabel');
    const r = label.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let top = r.top - popRect.height - 18;
    if (top < 8) top = r.bottom + 12;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - popRect.width - 8));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    setTimeout(() => {
      document.addEventListener('click', this._mpOutsideHandler);
      window.addEventListener('scroll', this._mpCloseOnScroll, true);
      window.addEventListener('resize', this._mpCloseOnScroll);
    }, 0);
  },
  closeMonthPicker() {
    document.getElementById('monthPickerPopover').hidden = true;
    document.removeEventListener('click', this._mpOutsideHandler);
    window.removeEventListener('scroll', this._mpCloseOnScroll, true);
    window.removeEventListener('resize', this._mpCloseOnScroll);
  },
  _renderMonthPicker() {
    const y = this._mpYear;
    document.getElementById('mpYearLabel').textContent = `${y} 年`;
    const grid = document.getElementById('mpMonthGrid');
    grid.innerHTML = '';
    const curYear = this.state.calMonth.getFullYear();
    const curMonth = this.state.calMonth.getMonth();
    const today = new Date();
    const isThisYearToday = today.getFullYear() === y;
    for (let m = 0; m < 12; m++) {
      const el = document.createElement('div');
      el.className = 'mp-month';
      if (y === curYear && m === curMonth) el.classList.add('current');
      if (isThisYearToday && m === today.getMonth()) el.classList.add('today-month');
      el.textContent = `${m + 1}月`;
      el.onclick = () => {
        this.state.calMonth = new Date(y, m, 1);
        const savedY = window.scrollY;
        const savedX = window.scrollX;
        Render.renderCalendar(this.state);
        window.scrollTo(savedX, savedY);
        this.closeMonthPicker();
      };
      grid.appendChild(el);
    }
  },
  _mpShiftYear(delta) {
    this._mpYear += delta;
    this._renderMonthPicker();
  },
  async checkUpdate() {
    const box = document.getElementById('helpUpdateBox');
    const text = document.getElementById('helpUpdateText');
    box.className = 'help-update checking';
    text.textContent = '正在检查...';
    try {
      const current = (await API.appVersion()).trim();
      const res = await fetch('https://api.github.com/repos/xuananrocx/todocalendar/releases/latest', {
        cache: 'no-store',
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const latestTag = (data.tag_name || '').replace(/^v/, '').trim();
      const releaseUrl = data.html_url || 'https://github.com/xuananrocx/todocalendar/releases';
      if (!latestTag) throw new Error('未找到最新版本');
      const isNewer = this._compareVersion(latestTag, current) > 0;
      if (isNewer) {
        box.className = 'help-update warn';
        text.textContent = `发现新版本 v${latestTag}`;
        const confirmed = await this.confirmAction({
          title: '发现新版本',
          message: `检测到最新版本 v${latestTag}(当前 v${current}),是否前往下载?`,
          confirmText: '前往下载',
        });
        if (confirmed) {
          this.closeHelp();
          API.openExternal(releaseUrl).catch(err => alert('打开失败: ' + err));
        }
      } else {
        box.className = 'help-update ok';
        text.textContent = `✓ 已是最新版本 (v${current})`;
      }
    } catch (e) {
      box.className = 'help-update warn';
      text.textContent = `检查失败: ${e.message || '网络错误'}`;
    }
  },
  _compareVersion(a, b) {
    const pa = String(a).split('.');
    const pb = String(b).split('.');
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const na = parseInt(pa[i] || '0', 10);
      const nb = parseInt(pb[i] || '0', 10);
      if (na !== nb) return na - nb;
    }
    return 0;
  },

  toggleSortDropdown(force) {
    const dd = document.getElementById('sortDropdown');
    const btn = document.getElementById('btnSort');
    if (!dd || !btn) return;
    const shouldOpen = force !== undefined ? force : dd.hidden;
    if (shouldOpen) this.toggleDropdown(false);
    dd.hidden = !shouldOpen;
    btn.classList.toggle('active', shouldOpen);
    btn.setAttribute('aria-expanded', String(shouldOpen));
  },

  // ===== Settings Modal =====
  openSettingsModal(tab) {
    if (tab) this.state.settingsTab = tab;
    this.toggleDropdown(false);
    this.closeModal();  // 避免和编辑弹窗重叠
    document.getElementById('settingsMask').hidden = false;
    document.body.classList.add('modal-open');
    this.renderSettingsModal(true);
  },

  closeSettingsModal() {
    document.getElementById('settingsMask').hidden = true;
    document.body.classList.remove('modal-open');
  },

  confirmAction({ title = '确认操作', message, messageHtml, confirmText = '确认', danger = false, hideCancel = false }) {
    if (this.confirmResolver) this.closeConfirm(false);

    const mask = document.getElementById('confirmMask');
    const modal = mask.querySelector('.confirm-modal');
    const accept = document.getElementById('btnConfirmAccept');
    const cancel = document.getElementById('btnConfirmCancel');
    this.confirmPreviousFocus = document.activeElement;
    document.getElementById('confirmTitle').textContent = title;
    const msgEl = document.getElementById('confirmMessage');
    if (messageHtml != null) {
      msgEl.innerHTML = messageHtml;
    } else {
      msgEl.textContent = message;
    }
    if (cancel) cancel.hidden = hideCancel;
    document.getElementById('confirmIcon').innerHTML = danger ? Icon.trash() : Icon.info();
    accept.textContent = confirmText;
    accept.className = danger ? 'btn confirm-danger' : 'btn primary';
    modal.classList.toggle('danger', danger);
    mask.hidden = false;

    return new Promise(resolve => {
      this.confirmResolver = resolve;
      requestAnimationFrame(() => accept.focus());
    });
  },

  closeConfirm(confirmed = false) {
    const resolver = this.confirmResolver;
    if (!resolver) return;

    this.confirmResolver = null;
    document.getElementById('confirmMask').hidden = true;
    resolver(confirmed);

    const previousFocus = this.confirmPreviousFocus;
    this.confirmPreviousFocus = null;
    if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus());
  },

  runHolidayUpdateWithProgress() {
    if (this._holidayUpdating) return Promise.resolve();
    this._holidayUpdating = true;

    const mask = document.getElementById('holidayProgressMask');
    const body = document.getElementById('holidayProgressBody');
    const closeBtn = document.getElementById('btnHolidayProgressClose');
    const titleEl = document.getElementById('holidayProgressTitle');
    const previousFocus = document.activeElement;

    body.innerHTML = '';
    closeBtn.disabled = true;
    titleEl.textContent = '正在检查节假日更新';
    mask.hidden = false;

    const ICONS = { connecting: '⋯', ok: '✓', warning: '⚠', failed: '✗' };
    const rows = new Map(); // key -> { div, iconEl, textEl }
    const yearSections = new Map(); // year -> container div

    const getYearSection = (year) => {
      if (yearSections.has(year)) return yearSections.get(year);
      const section = document.createElement('div');
      section.className = 'holiday-year';
      const head = document.createElement('div');
      head.className = 'holiday-year-head';
      head.innerHTML = `<span class="holiday-year-name">${year} 年</span><span class="holiday-year-status">⋯</span>`;
      section.appendChild(head);
      const list = document.createElement('div');
      list.className = 'holiday-year-list';
      section.appendChild(list);
      section._list = list;
      section._status = head.querySelector('.holiday-year-status');
      body.appendChild(section);
      yearSections.set(year, section);
      return section;
    };

    const setYearStatus = (year, status, text) => {
      const section = getYearSection(year);
      section._status.className = `holiday-year-status ${status}`;
      section._status.textContent = text;
    };

    const upsertRow = (year, sourceIdx, status, html) => {
      const section = getYearSection(year);
      const key = `${year}-${sourceIdx}`;
      let row = rows.get(key);
      if (!row) {
        const div = document.createElement('div');
        div.className = `holiday-log ${status}`;
        div.innerHTML = `<span class="holiday-log-icon"></span><span class="holiday-log-text"></span>`;
        section._list.appendChild(div);
        row = { div, iconEl: div.querySelector('.holiday-log-icon'), textEl: div.querySelector('.holiday-log-text') };
        rows.set(key, row);
      }
      row.div.className = `holiday-log ${status}`;
      row.iconEl.textContent = ICONS[status] || '';
      row.textEl.innerHTML = html;
      body.scrollTop = body.scrollHeight;
    };

    const appendStandalone = (status, html) => {
      const div = document.createElement('div');
      div.className = `holiday-log ${status} standalone`;
      div.innerHTML = `<span class="holiday-log-icon">${ICONS[status] || ''}</span><span class="holiday-log-text">${html}</span>`;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    };

    let unlisten = null;
    const cleanup = () => {
      if (unlisten) { unlisten(); unlisten = null; }
      this._holidayUpdating = false;
    };
    const close = () => {
      mask.hidden = true;
      cleanup();
      if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus());
    };

    const yearFinalStatus = {};

    return window.__TAURI__.event.listen('holiday-progress', (e) => {
      const p = e.payload;
      if (p.status === 'saving') {
        if (p.yearResults) {
          for (const r of p.yearResults) {
            const label = { ok: '✓ 成功', warning: '⚠ 未发布', failed: '✗ 失败' }[r.status] || r.status;
            setYearStatus(r.year, r.status === 'ok' ? 'ok' : r.status, `${label} · ${r.msg}`);
          }
        }
        return;
      }
      const sec = p.elapsedMs ? `${(p.elapsedMs / 1000).toFixed(1)}s` : '';
      if (p.status === 'connecting') {
        upsertRow(p.year, p.sourceIdx, 'connecting', `<b>${p.sourceName}</b><br><span class="holiday-log-detail">${p.url}</span><br><span class="holiday-log-detail">连接中...</span>`);
      } else if (p.status === 'ok') {
        const kb = p.bytes ? `${(p.bytes / 1024).toFixed(1)} KB` : '';
        const cnt = p.count != null ? `${p.count} 条` : '';
        upsertRow(p.year, p.sourceIdx, 'ok', `<b>${p.sourceName}</b> · ${[sec, kb, cnt].filter(Boolean).join(' · ')}`);
        yearFinalStatus[p.year] = 'ok';
        setYearStatus(p.year, 'ok', '✓ 成功');
      } else if (p.status === 'warning') {
        upsertRow(p.year, p.sourceIdx, 'warning', `<b>${p.sourceName}</b>${sec ? ' · ' + sec : ''}<br><span class="holiday-log-detail">${p.warning || ''}</span>`);
        if (yearFinalStatus[p.year] !== 'ok') {
          yearFinalStatus[p.year] = 'warning';
          setYearStatus(p.year, 'warning', '⚠ 未发布');
        }
      } else if (p.status === 'failed') {
        upsertRow(p.year, p.sourceIdx, 'failed', `<b>${p.sourceName}</b>${sec ? ' · ' + sec : ''}<br><span class="holiday-log-detail">${p.error || '未知错误'}</span>`);
        if (yearFinalStatus[p.year] !== 'ok' && yearFinalStatus[p.year] !== 'warning') {
          yearFinalStatus[p.year] = 'failed';
          setYearStatus(p.year, 'failed', '✗ 失败');
        }
      }
    }).then(un => { unlisten = un; })
      .then(() => window.__TAURI__.core.invoke('check_holiday_updates'))
      .then(async (msg) => {
        const now = new Date().toISOString();
        await this.patchSettings({ holidayLastUpdate: now });
        this.state.holidays = await window.__TAURI__.core.invoke('list_holidays');
        Render.renderAll(this.state);
        const descEl = document.getElementById('holidayLastUpdateDesc');
        if (descEl) descEl.textContent = `上次更新:${new Date(now).toLocaleString('zh-CN')}`;
        titleEl.textContent = '更新完成';
        appendStandalone('ok', `<b>${msg}</b>`);
        closeBtn.disabled = true;
        setTimeout(() => {
          close();
          this.confirmAction({ title: '更新成功', message: msg, confirmText: '知道了', hideCancel: true });
        }, 800);
      })
      .catch((err) => {
        titleEl.textContent = '更新失败';
        const errText = (typeof err === 'string' && err.startsWith('更新进行中'))
          ? err
          : (window.__tauriErrMsg ? window.__tauriErrMsg(err) : String(err));
        appendStandalone('failed', `<b>${errText}</b>`);
        closeBtn.disabled = false;
        closeBtn.onclick = close;
        requestAnimationFrame(() => closeBtn.focus());
      });
  },

  promptAction({ title = '输入', value = '', placeholder = '', confirmText = '确认', showDelete = false, deleteText = '删除分组' } = {}) {
    if (this.promptResolver) this.closePrompt({ type: 'cancel', value: '' });

    const mask = document.getElementById('promptMask');
    const input = document.getElementById('promptInput');
    const accept = document.getElementById('btnPromptAccept');
    const deleteBtn = document.getElementById('btnPromptDelete');
    this.promptPreviousFocus = document.activeElement;
    document.getElementById('promptTitle').textContent = title;
    input.value = value;
    input.placeholder = placeholder;
    accept.textContent = confirmText;
    deleteBtn.hidden = !showDelete;
    deleteBtn.textContent = deleteText;
    mask.hidden = false;

    return new Promise(resolve => {
      this.promptResolver = resolve;
      requestAnimationFrame(() => input.focus());
    });
  },

  closePrompt(result = { type: 'cancel', value: '' }) {
    const resolver = this.promptResolver;
    if (!resolver) return;

    this.promptResolver = null;
    document.getElementById('promptMask').hidden = true;
    resolver(result);

    const previousFocus = this.promptPreviousFocus;
    this.promptPreviousFocus = null;
    if (previousFocus?.isConnected) requestAnimationFrame(() => previousFocus.focus());
  },

  setSettingsTab(tab) {
    this.state.settingsTab = tab;
    this.renderSettingsModal(true);
  },

  renderSettingsModal(resetScroll = false) {
    const s = this.state.settings;
    const tab = this.state.settingsTab;
    document.querySelectorAll('.settings-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    const content = document.getElementById('settingsContent');
    const scrollTop = content.scrollTop;
    content.innerHTML = this._settingsTabHtml(tab, s);
    // 改设置项触发的重渲染保持滚动位置;重开/切页签才回顶部(需容器可见,否则 scrollTop 赋值无效)
    content.scrollTop = resetScroll ? 0 : scrollTop;
    Icon.render(content);
    this._bindSettingsContent(tab, s);
  },

  _seg(opts, currentValue, onChange) {
    return `<div class="segmented" data-onchange="${onChange}">` +
      opts.map(o =>
        `<span class="segmented-opt ${o.value === currentValue ? 'active' : ''}" data-value="${o.value}">${o.label}</span>`
      ).join('') +
      `</div>`;
  },

  _paletteSwatch(name, currentValue) {
    const palettes = {
      classic: ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899', '#06b6d4'],
      morandi: ['#5b6f8f', '#63756a', '#7c7057', '#8f5a5a', '#8a6d54', '#557575'],
      ocean: ['#0284c7', '#0891b2', '#0d9488', '#2563eb', '#4f46e5', '#7c3aed'],
    };
    const labels = { classic: '经典', morandi: '莫兰迪', ocean: '海洋', theme: '主题色' };
    const dots = name === 'theme'
      ? [
        'linear-gradient(135deg, var(--primary-from), var(--primary-to))',
        'color-mix(in srgb, var(--primary) 26%, var(--panel))',
        'color-mix(in srgb, var(--primary) 18%, var(--panel))',
        'color-mix(in srgb, var(--primary) 12%, var(--panel))',
        'color-mix(in srgb, var(--primary) 7%, var(--panel))',
        'color-mix(in srgb, var(--primary) 4%, var(--panel))',
      ].map(c => `<span class="palette-dot" style="background:${c}"></span>`).join('')
      : (palettes[name] || palettes.classic).map(c => `<span class="palette-dot" style="background:${c}"></span>`).join('');
    return `<div class="palette-swatch ${name === currentValue ? 'active' : ''}" data-value="${name}" title="${labels[name] || name}">
      ${dots}
      <span class="palette-name">${labels[name] || name}</span>
    </div>`;
  },

  _iconSwatch(name, currentValue, label) {
    const url = `icons/icon_${name}.png`;
    return `<div class="icon-swatch ${name === currentValue ? 'active' : ''}" data-value="${name}" title="${label}">
      <img src="${url}" alt="${label}">
    </div>`;
  },

  _colorSwatch(value, label, from, to, currentValue, pattern) {
    const active = value === currentValue;
    const bg = to ? `linear-gradient(135deg, ${from}, ${to})` : from;
    return `<div class="color-swatch ${active ? 'active' : ''}" data-value="${value}" title="${label}">
      <span class="color-dot" style="background:${bg};position:relative;overflow:hidden">${pattern || ''}</span>
      <span class="color-name">${label}</span>
    </div>`;
  },

  _fontColorSwatch(value, label, lightColor, darkColor, currentValue) {
    const active = value === currentValue;
    return `<div class="color-swatch font-color-swatch ${active ? 'active' : ''}" data-value="${value}" title="${label}">
      <span class="font-color-dots">
        <span class="dot-light" style="background:${lightColor}"></span>
        <span class="dot-dark" style="background:${darkColor}"></span>
      </span>
      <span class="color-name">${label}</span>
    </div>`;
  },

  _toggle(checked, onChange, title, desc, disabled = false) {
    return `<div class="switch-row ${disabled ? 'disabled' : ''}">
      <div class="meta"><div class="title">${title}${desc ? this._hint(desc) : ''}</div></div>
      <div class="toggle ${checked ? 'on' : ''}" data-onchange="${onChange}"></div>
    </div>`;
  },

  _hint(text) {
    return `<span class="hint-icon">?<span class="hint-tip">${text}</span></span>`;
  },

  _attachMaskClose(maskId, closeCallback) {
    const mask = document.getElementById(maskId);
    if (!mask) return;
    let mouseDownOnMask = false;
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) mouseDownOnMask = true;
    });
    mask.addEventListener('mouseup', (e) => {
      const onMask = e.target === mask && mouseDownOnMask;
      mouseDownOnMask = false;
      if (onMask && this.state?.settings?.closeOnOutsideClick !== false) {
        closeCallback();
      }
    });
  },

  _settingsTabHtml(tab, s) {
    if (tab === 'general') {
      return `
        <div class="settings-content-title">通用</div>
        <div class="settings-content-desc">全局界面与交互偏好</div>
        <div class="settings-group">
        <div class="settings-section-title">主题与界面</div>
        <div class="settings-row">
          <div class="settings-row-label">主题</div>
          ${this._seg([
            {value:'light',label:'浅色'},{value:'dark',label:'深色'},{value:'system',label:'跟随系统'}
          ], s.theme, 'theme')}
        </div>
        <div class="settings-row">
          <div class="settings-row-label">主题色</div>
          <div class="color-picker" data-onchange="themeColor">
            ${this._colorSwatch('clay', '陶土', '#D97757', null, s.themeColor)}
            ${this._colorSwatch('blue', '蓝', '#3b82f6', null, s.themeColor)}
            ${this._colorSwatch('cyan', '青', '#06b6d4', null, s.themeColor)}
            ${this._colorSwatch('red', '红', '#ef4444', null, s.themeColor)}
            ${this._colorSwatch('ink', '墨', '#1f2937', null, s.themeColor)}
            ${this._colorSwatch('sunset', '日落', '#f97316', '#ec4899', s.themeColor)}
            ${this._colorSwatch('deep', '深海', '#3b82f6', '#06b6d4', s.themeColor)}
            ${this._colorSwatch('aurora', '极光', '#10b981', '#06b6d4', s.themeColor)}
            ${this._colorSwatch('flame', '火焰', '#ef4444', '#f97316', s.themeColor)}
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">字体颜色</div>
          <div class="color-picker" data-onchange="fontColor">
            ${this._fontColorSwatch('default', '默认', '#1f2937', '#f1e9d8', s.fontColor)}
            ${this._fontColorSwatch('warm1', '暖墨/米黄', '#2a2520', '#ede0c8', s.fontColor)}
            ${this._fontColorSwatch('warm2', '暖褐/浅杏', '#3d2f1f', '#e8d4b8', s.fontColor)}
            ${this._fontColorSwatch('warm3', '暖棕/暖灰', '#4a3520', '#d4c5b0', s.fontColor)}
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">字体大小</div>
          ${this._seg([
            {value:'small',label:'小'},{value:'medium',label:'中'},{value:'medium-large',label:'较大'},{value:'large',label:'大'}
          ], s.fontSize, 'fontSize')}
        </div>
        <div class="settings-row">
          <div class="settings-row-label">统计样式${this._hint('顶部统计的显示样式:文字横排紧凑朴素;彩色块每个状态独立色块;进度条细条+下方百分比与图例;不显示则完全隐藏顶部统计')}</div>
          ${this._seg([
            {value:'none',label:'不显示'},{value:'text',label:'文字横排'},{value:'chip',label:'彩色块'},{value:'bar',label:'进度条'}
          ], s.statsStyle || 'text', 'statsStyle')}
        </div>
        <div class="settings-row">${this._toggle(s.compact, 'compact', '紧凑模式', '缩小行距显示更多内容')}</div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">分组</div>
        <div class="settings-row">${this._toggle(s.enableGroups === true, 'enableGroups', '启用分组', '开启后顶部出现分组栏,可创建自定义分组(Default 为系统内置,可改名改色,不可删除)')}</div>
        <div class="settings-row">${this._toggle(s.enableGroups === true && s.groupBarMerged === true, 'groupBarMerged', '分组栏合并到顶部卡片', '开启后分组栏与顶部时钟/按钮区合并为一张卡片,以横线分隔;关闭则分组栏单独成卡显示(默认独立卡片)', s.enableGroups !== true)}</div>
        <div class="settings-row">${this._toggle(s.enableGroups === true && s.calendarFollowGroup !== false, 'calendarFollowGroup', '日历跟随分组筛选', '切到具体分组时,日历与日详情只显示该分组的待办;在"全部"tab 或关闭本开关时不过滤', s.enableGroups !== true)}</div>
        <div class="settings-row">${this._toggle(s.enableGroups === true && s.statsFollowGroup === true, 'statsFollowGroup', '统计条跟随分组筛选', '开启后统计条只统计当前分组的待办;默认关闭,始终统计全部', s.enableGroups !== true)}</div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">时间与时钟</div>
        <div class="settings-row">${this._toggle(s.showTimePrecision === true, 'showTimePrecision', '显示具体时间', '开启后所有时间显示精确到分钟,关闭则只显示日期')}</div>
        <div class="settings-row">${this._toggle(s.clockShowTime !== false, 'clockShowTime', '时钟显示时间', '关闭后顶部只显示"xx月xx日 周几",分隔符与具体时分不再显示(时钟显示秒数为独立的纯时间模式,不受此开关影响)')}</div>
        <div class="settings-row">${this._toggle(!!s.clockShowSeconds, 'clockShowSeconds', '时钟显示秒数', '顶部时钟显示 HH:MM:SS,下方秒进度条(隐藏月日周几)')}</div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">通用交互</div>
        <div class="settings-row">${this._toggle(s.deleteConfirm !== false, 'deleteConfirm', '删除前确认', '默认已开启,关闭后直接删除')}</div>
        <div class="settings-row">${this._toggle(s.closeOnOutsideClick !== false, 'closeOnOutsideClick', '点击外部关闭弹窗', '点击遮罩空白处关闭弹窗;仅在按下和松开都在外部时触发(防止从内部拖到外部误触)')}</div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">应用图标</div>
        <div class="settings-row">
          <div class="icon-picker" data-onchange="appIcon">
            ${this._iconSwatch('b', ['b','a1','a2'].includes(s.appIcon) ? s.appIcon : 'b', '纯对勾')}
            ${this._iconSwatch('a1', ['b','a1','a2'].includes(s.appIcon) ? s.appIcon : 'b', '日历兽·奶油')}
            ${this._iconSwatch('a2', ['b','a1','a2'].includes(s.appIcon) ? s.appIcon : 'b', '日历兽·丹宁')}
          </div>
        </div>
        </div>
      `;
    }
    if (tab === 'calendar') {
      return `
        <div class="settings-content-title">日历</div>
        <div class="settings-content-desc">日历视图相关选项</div>
        <div class="settings-group">
        <div class="settings-section-title">基础视图</div>
        <div class="settings-row">
          <div class="settings-row-label">每周第一天</div>
          ${this._seg([
            {value:'monday',label:'周一'},{value:'sunday',label:'周日'}
          ], s.weekStart || 'monday', 'weekStart')}
        </div>
        <div class="settings-row">${this._toggle(!!s.showWeekNumber, 'showWeekNumber', '显示周数', '左侧显示当年第几周')}</div>
        <div class="settings-row">${this._toggle(!!s.showLunar, 'showLunar', '显示农历', '日期格内显示农历日(简化版)')}</div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">事件显示</div>
        <div class="settings-row">${this._toggle(s.showStartInCalendar !== false, 'showStartInCalendar', '显示开始任务', '在月历中显示任务的开始日期(同一天的开始/结束时间相同时也会显示)')}</div>
        <div class="settings-row">${this._toggle(s.showOngoingInCalendar !== false, 'showOngoingInCalendar', '显示进行中任务', '仅在跨天任务的中间日期显示(开始与截止同一天的任务不显示进行中)')}</div>
        <div class="settings-row">${this._toggle(s.showEndInCalendar !== false, 'showEndInCalendar', '显示截止任务', '在月历中显示任务的截止日期(同一天的开始/结束时间相同时也会显示)')}</div>
        <div class="settings-row">${this._toggle(s.showCalendarDone === true, 'showCalendarDone', '显示已完成任务', '在月历中显示已完成的待办(日详情页不受影响)')}</div>
        <div class="settings-row">
          <div class="settings-row-label">子节点展示方式${this._hint('子代办在日历中的展示方式:显示主名将子代办合并到主代办名下(不展示子代办自己的事件条);不展示子完全隐藏子代办事件;名拼接主-子/子-主格式显示每个子代办自己的事件条并附带主代办名')}</div>
          ${this._seg([
            {value:'current',label:'显示主名'},
            {value:'main-only',label:'不展示子'},
            {value:'main-child',label:'名拼接主-子'},
            {value:'child-main',label:'名拼接子-主'}
          ], s.calendarChildDisplay || 'main-only', 'calendarChildDisplay')}
        </div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">窗格与颜色</div>
        <div class="settings-row">
          <div class="settings-row-label">周末窗格颜色${this._hint('给周六周日的窗格添加柔和颜色标识(仅日期格底色变化,不影响 today/选中态)')}</div>
          <div class="color-picker" data-onchange="weekendColor">
            ${this._colorSwatch('none', '无', '#ffffff', null, s.weekendColor || 'none')}
            ${this._colorSwatch('green', '浅绿', '#d1fae5', null, s.weekendColor || 'none')}
            ${this._colorSwatch('pink', '浅粉', '#fce7f3', null, s.weekendColor || 'none')}
            ${this._colorSwatch('blue', '鱼肚白', '#fafaf9', '#e2e8f0', s.weekendColor || 'none')}
            ${this._colorSwatch('yellow', '茶白', '#fafaf9', '#e7e5e4', s.weekendColor || 'none')}
            ${this._colorSwatch('beige', '米白', '#fafaf9', null, s.weekendColor || 'none')}
            ${this._colorSwatch('peach', '浅橙', '#ffedd5', null, s.weekendColor || 'none')}
            ${this._colorSwatch('dawn', '黎明', '#fef3c7', '#fce7f3', s.weekendColor || 'none')}
            ${this._colorSwatch('aurora', '极光', '#f0fdf4', '#ecfeff', s.weekendColor || 'none')}
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">法定假日窗格颜色${this._hint('给法定假日窗格添加颜色标识(优先级高于周末色;调休上班日不应用周末色)')}</div>
          <div class="color-picker" data-onchange="holidayColor">
            ${this._colorSwatch('none', '无', '#ffffff', null, s.holidayColor || 'none')}
            ${this._colorSwatch('flag', '国旗', '#de2910', null, s.holidayColor || 'none', '<svg style="position:absolute;inset:0;width:100%;height:100%" viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice"><polygon fill="#ffde00" points="5,2 5.67,4.07 7.85,4.07 6.09,5.35 6.76,7.43 5,6.15 3.24,7.43 3.91,5.35 2.15,4.07 4.33,4.07"/><polygon fill="#ffde00" transform="rotate(-120.96 10 2)" points="10,1 10.23,1.69 10.95,1.69 10.36,2.12 10.59,2.81 10,2.38 9.41,2.81 9.64,2.12 9.05,1.69 9.78,1.69"/><polygon fill="#ffde00" transform="rotate(-98.13 12 4)" points="12,3 12.23,3.69 12.95,3.69 12.36,4.12 12.59,4.81 12,4.38 11.41,4.81 11.64,4.12 11.05,3.69 11.78,3.69"/><polygon fill="#ffde00" transform="rotate(-74.05 12 7)" points="12,6 12.23,6.69 12.95,6.69 12.36,7.12 12.59,7.81 12,7.38 11.41,7.81 11.64,7.12 11.05,6.69 11.78,6.69"/><polygon fill="#ffde00" transform="rotate(-51.34 10 9)" points="10,8 10.23,8.69 10.95,8.69 10.36,9.12 10.59,9.81 10,9.38 9.41,9.81 9.64,9.12 9.05,8.69 9.78,8.69"/></svg>')}
            ${this._colorSwatch('china', '中国红', '#de2910', null, s.holidayColor || 'none')}
            ${this._colorSwatch('brocade', '锦绣', '#fca5a5', '#fbbf24', s.holidayColor || 'none')}
            ${this._colorSwatch('firework', '烟花', '#fef3c7', '#fb7185', s.holidayColor || 'none')}
            ${this._colorSwatch('beige', '米白', '#fafaf9', null, s.holidayColor || 'none')}
            ${this._colorSwatch('glow', '霞光', '#fed7aa', '#fb7185', s.holidayColor || 'none')}
            ${this._colorSwatch('dawn', '黎明', '#fef3c7', '#fce7f3', s.holidayColor || 'none')}
            ${this._colorSwatch('aurora', '极光', '#f0fdf4', '#ecfeff', s.holidayColor || 'none')}
          </div>
        </div>
        <div class="settings-row">${this._toggle(s.showRestBadge === true, 'showRestBadge', '显示"休"字角标', '在周六周日与法定假日的窗格右上角显示浅底主题色"休"角标(跟随当前主题色);调休上班日仍显示"班"角标,不受此开关影响')}</div>
        <div class="settings-row">
          <div class="settings-row-label">当天开始事件条颜色${this._hint('自定义模式下,当天开始事件条使用白底+左色条+灰字(与进行中/截止风格一致)')}</div>
          ${this._seg([
            {value:'theme',label:'跟随主题'},{value:'custom',label:'自定义'}
          ], s.startEventColorMode || 'theme', 'startEventColorMode')}
          ${s.startEventColorMode === 'custom' ? `
          <div class="color-picker" data-onchange="startEventCustomColor" style="margin-top: 6px;">
            ${this._colorSwatch('amber', '琥珀', '#f59e0b', null, s.startEventCustomColor)}
            ${this._colorSwatch('blue', '蓝', '#3b82f6', null, s.startEventCustomColor)}
            ${this._colorSwatch('indigo', '靛', '#6366f1', null, s.startEventCustomColor)}
            ${this._colorSwatch('violet', '紫', '#8b5cf6', null, s.startEventCustomColor)}
            ${this._colorSwatch('cyan', '青', '#06b6d4', null, s.startEventCustomColor)}
            ${this._colorSwatch('slate', '灰', '#64748b', null, s.startEventCustomColor)}
          </div>` : ''}
        </div>
        <div class="settings-row">
          <div class="settings-row-label">日详情父待办背景</div>
          ${this._seg([
            {value:'theme',label:'跟随主题'},{value:'none',label:'无背景'},{value:'custom',label:'自定义'}
          ], s.dayItemColorMode || 'theme', 'dayItemColorMode')}
          ${s.dayItemColorMode === 'custom' ? `
          <div class="color-picker" data-onchange="dayItemCustomColor" style="margin-top: 6px;">
            ${this._colorSwatch('clay', '陶土', '#D97757', null, s.dayItemCustomColor)}
            ${this._colorSwatch('blue', '蓝', '#3b82f6', null, s.dayItemCustomColor)}
            ${this._colorSwatch('cyan', '青', '#06b6d4', null, s.dayItemCustomColor)}
            ${this._colorSwatch('red', '红', '#ef4444', null, s.dayItemCustomColor)}
            ${this._colorSwatch('ink', '墨', '#1f2937', null, s.dayItemCustomColor)}
            ${this._colorSwatch('sunset', '日落', '#f97316', '#ec4899', s.dayItemCustomColor)}
            ${this._colorSwatch('deep', '深海', '#3b82f6', '#06b6d4', s.dayItemCustomColor)}
            ${this._colorSwatch('aurora', '极光', '#10b981', '#06b6d4', s.dayItemCustomColor)}
            ${this._colorSwatch('flame', '火焰', '#ef4444', '#f97316', s.dayItemCustomColor)}
          </div>` : ''}
        </div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">日详情</div>
        <div class="settings-row">
          <div class="settings-row-label">默认展开${this._hint('全折叠:进入日详情全部折叠;跟随列表:按列表当前展开状态快照;智能折叠:默认折叠,仅自动展开当天命中任务的祖先链(三种模式下的展开/折叠都不写库,退出即弃)')}</div>
          ${this._seg([
            {value:'all-collapsed',label:'全折叠'},{value:'follow-list',label:'跟随列表'},{value:'smart',label:'智能折叠'}
          ], s.dayExpandDefault || 'all-collapsed', 'dayExpandDefault')}
        </div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">节假日数据</div>
        <div class="settings-row">
          <div class="settings-row-label">节假日数据更新</div>
          <div>${this._toggle(s.holidayAutoUpdate !== false, 'holidayAutoUpdate', '自动检查更新', '启动时若距上次超过30天,后台拉取最新数据')}</div>
          <div style="margin-top:6px">
            <button class="btn ghost" id="btnCheckHolidayUpdates" style="padding:4px 10px;font-size:12px"><i data-icon="refresh"></i> 立即检查更新</button>
          </div>
          <div class="settings-row-desc" id="holidayLastUpdateDesc" style="margin-top:4px">${s.holidayLastUpdate ? `上次更新:${new Date(s.holidayLastUpdate).toLocaleString('zh-CN')}` : '尚未更新(使用内置数据)'}</div>
        </div>
        </div>
      `;
    }
    if (tab === 'list') {
      return `
        <div class="settings-content-title">列表</div>
        <div class="settings-content-desc">待办列表显示与操作</div>
        <div class="settings-group">
        <div class="settings-section-title">列表样式</div>
        <div class="settings-row">
          <div class="settings-row-label">列表父待办背景</div>
          ${this._seg([
            {value:'theme',label:'跟随主题'},{value:'none',label:'无背景'},{value:'custom',label:'自定义'}
          ], s.todoItemColorMode || 'none', 'todoItemColorMode')}
          ${s.todoItemColorMode === 'custom' ? `
          <div class="color-picker" data-onchange="todoItemCustomColor" style="margin-top: 6px;">
            ${this._colorSwatch('clay', '陶土', '#D97757', null, s.todoItemCustomColor)}
            ${this._colorSwatch('blue', '蓝', '#3b82f6', null, s.todoItemCustomColor)}
            ${this._colorSwatch('cyan', '青', '#06b6d4', null, s.todoItemCustomColor)}
            ${this._colorSwatch('red', '红', '#ef4444', null, s.todoItemCustomColor)}
            ${this._colorSwatch('ink', '墨', '#1f2937', null, s.todoItemCustomColor)}
            ${this._colorSwatch('sunset', '日落', '#f97316', '#ec4899', s.todoItemCustomColor)}
            ${this._colorSwatch('deep', '深海', '#3b82f6', '#06b6d4', s.todoItemCustomColor)}
            ${this._colorSwatch('aurora', '极光', '#10b981', '#06b6d4', s.todoItemCustomColor)}
            ${this._colorSwatch('flame', '火焰', '#ef4444', '#f97316', s.todoItemCustomColor)}
          </div>` : ''}
        </div>
        <div class="settings-row">
          <div class="settings-row-label">备注展示方式${this._hint('悬浮:鼠标移到标题上显示完整备注;内联摘要:带"备注"标签+前 30 字;内联简化:无标签的前 30 字')}</div>
          ${this._seg([
            {value:'none',label:'不展示'},{value:'hover',label:'悬浮预览'},{value:'inline',label:'内联摘要'},{value:'inline-plain',label:'内联简化'}
          ], s.notesDisplay || 'none', 'notesDisplay')}
        </div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">编号</div>
        <div class="settings-row">${this._toggle(!!s.showNumbering, 'showNumbering', '显示任务编号', '按当前顺序编号,父待办显示子任务数')}</div>
        <div class="settings-row numbering-style-row ${s.showNumbering ? '' : 'disabled'}">
          <label class="settings-row-label">编号样式</label>
          ${this._seg([
            { value: 'simple', label: '简化 1, 1, 1' },
            { value: 'wbs', label: 'WBS 1.1.1' },
          ], s.numberingStyle || 'simple', 'numberingStyle')}
        </div>
        <div class="settings-row numbering-palette-row ${s.showNumbering ? '' : 'disabled'}">
          <label class="settings-row-label">配色方案</label>
          <div class="palette-picker" data-onchange="numberingPalette">
            ${this._paletteSwatch('classic', s.numberingPalette)}
            ${this._paletteSwatch('morandi', s.numberingPalette)}
            ${this._paletteSwatch('ocean', s.numberingPalette)}
            ${this._paletteSwatch('theme', s.numberingPalette)}
          </div>
        </div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">优先待办</div>
        <div class="settings-row">
          <div class="settings-row-label">优先待办高亮${this._hint('优先待办的视觉强调方式:图标=橙色线性火焰;动态=Canvas 粒子火焰动画(悬停火势变大);标签=实心橙"优先"标签;背景=标题日落渐变底+白字')}</div>
          ${this._seg([
            {value:'none',label:'不高亮'},{value:'icon',label:'图标'},{value:'animate',label:'动态'},{value:'tag',label:'标签'},{value:'bg',label:'背景'}
          ], s.priorityHighlight || 'tag', 'priorityHighlight')}
        </div>
        <div class="settings-row">${this._toggle(s.priorityAutoTop !== false, 'priorityAutoTop', '优先待办自动置顶', '自动排序模式下,优先待办置顶;搁置待办下沉到已完成之上')}</div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">添加</div>
        <div class="settings-row">
          <div class="settings-row-label">新建待办默认时间${this._hint('新建时的默认开始时间(可在编辑时改)')}</div>
          ${this._seg([
            {value:'none',label:'无'},{value:'09:00',label:'当天 09:00'},{value:'now',label:'当前时刻'}
          ], s.defaultStartTime || 'none', 'defaultStartTime')}
        </div>
        <div class="settings-row">${this._toggle(!!s.showBulkAdd, 'showBulkAdd', '批量添加子代办', '在父待办行显示批量入口,共享开始与结束时间')}</div>
        <div class="settings-row">${this._toggle(s.showSingleAdd !== false, 'showSingleAdd', '单个添加子代办', '在父待办行显示 + 按钮,关闭后仅保留批量入口')}</div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">排序与拖动</div>
        <div class="settings-row">
          <div class="settings-row-label">排序方式${this._hint('自动排序按结束日期由近到远排列；手动排序可拖动调整顺序。自动模式下仅允许同截止日期内拖动微调')}</div>
          ${this._seg([
            {value:'auto',label:'自动排序'},{value:'manual',label:'手动排序'}
          ], s.sortMode || 'auto', 'sortMode')}
        </div>
        <div class="settings-row">
          <div class="settings-row-label">拖动模式${this._hint('跨层模式下拖到条目中部可将其设为子待办。自动模式下跨层也要求同截止日期')}</div>
          ${this._seg([
            {value:'sibling',label:'仅同级'},{value:'tree',label:'跨层移动'}
          ], s.dragMode || 'sibling', 'dragMode')}
        </div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">父子联动</div>
        <div class="settings-row">${this._toggle(!!s.autoSyncStart, 'autoSyncStart', '父代办开始随子代办更新', '新建/修改子代办时间时,父代办的开始时间自动取所有子代办中最早的。开启后父代办时间会被强制覆盖,想保留独立时间请关闭开关;被同步过的父代办在编辑器里显示 ↺ 自动同步 标记')}</div>
        <div class="settings-row">${this._toggle(!!s.autoSyncEnd, 'autoSyncEnd', '父代办结束随子代办更新', '新建/修改子代办时间时,父代办的结束时间自动取所有子代办中最晚的。开启后父代办时间会被强制覆盖,想保留独立时间请关闭开关;被同步过的父代办在编辑器里显示 ↺ 自动同步 标记')}</div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">完成与归档</div>
        <div class="settings-row">${this._toggle(!!s.autoCollapseDone, 'autoCollapseDone', '勾选后折叠', '勾选完成时自动折叠该待办')}</div>
        <div class="settings-row">${this._toggle(s.autoArchive !== false, 'autoArchive', '自动归档', '完成指定天数后从活动视图移入归档记录')}</div>
        <div class="settings-row archive-days-row ${s.autoArchive === false ? 'disabled' : ''}">
          <label class="settings-row-label" for="archiveAfterDays">完成后归档${this._hint('已完成分支的全部待办到期后统一归档')}</label>
          <div class="number-setting">
            <input id="archiveAfterDays" type="number" min="1" step="1" value="${Math.max(1, Number(s.archiveAfterDays) || 7)}" ${s.autoArchive === false ? 'disabled' : ''}>
            <span>天</span>
          </div>
        </div>
        </div>
        <div class="settings-group">
        <div class="settings-section-title">点击</div>
        <div class="settings-row">
          <div class="settings-row-label">待办点击行为${this._hint('展开模式下父代办点击切换展开,叶子代办点击进入编辑,hover 显示铅笔图标')}</div>
          ${this._seg([
            {value:'edit',label:'编辑'},{value:'expand',label:'展开/折叠'}
          ], s.clickAction || 'edit', 'clickAction')}
        </div>
        </div>
      `;
    }
    if (tab === 'data') {
      return `
        <div class="settings-content-title">数据</div>
        <div class="settings-content-desc">数据备份与维护</div>
        <div class="settings-row">
          <div class="settings-row-label">数据文件位置</div>
          <div class="settings-row-desc" style="word-break:break-all">${this.state.dataDir || '(未知)'}</div>
        </div>
        <div class="settings-row">
          <button class="btn-secondary" data-action="openDataDir"><i data-icon="folderOpen"></i> 打开数据目录</button>
        </div>
        <div class="settings-row">
          <button class="btn-secondary" data-action="exportJson"><i data-icon="download"></i> 导出 JSON 备份</button>
        </div>
        <div class="settings-row">
          <button class="btn-secondary" data-action="importJson"><i data-icon="upload"></i> 导入 JSON</button>
          <input type="file" id="importFile" accept=".json" hidden>
        </div>
        <div class="settings-row" style="margin-top:20px">
          <button class="btn-secondary" data-action="reloadData" style="color:var(--primary)"><i data-icon="refresh"></i> 重新加载(不修改文件)</button>
        </div>
      `;
    }
    if (tab === 'about') {
      const ver = this._cachedVersion || '—';
      return `
        <div class="settings-content-title">关于</div>
        <div class="settings-content-desc">TodoCalendar — 极简待办日历</div>
        <div class="settings-row">
          <div class="settings-row-label">版本</div>
          <div>v${ver} (Tauri)</div>
        </div>
        <div class="settings-row" style="margin-top:20px">
          <div class="settings-row-label">数据</div>
          <div style="font-size:11px;color:var(--muted);word-break:break-all">${this.state.todos.length} 条待办,存储于本地文件</div>
        </div>
      `;
    }
    return '';
  },

  _bindSettingsContent(tab, s) {
    const content = document.getElementById('settingsContent');

    // segmented
    content.querySelectorAll('.segmented').forEach(seg => {
      const onChange = seg.dataset.onchange;
      seg.querySelectorAll('.segmented-opt').forEach(opt => {
        opt.onclick = () => {
          const patch = {};
          patch[onChange] = opt.dataset.value;
          Object.assign(s, patch);
          this.patchSettings(patch);
          this.renderSettingsModal();
        };
      });
    });

    // palette picker
    content.querySelectorAll('.palette-swatch').forEach(sw => {
      sw.onclick = () => {
        const picker = sw.closest('.palette-picker');
        const onChange = picker.dataset.onchange;
        const patch = {};
        patch[onChange] = sw.dataset.value;
        Object.assign(s, patch);
        this.patchSettings(patch);
        this.renderSettingsModal();
      };
    });

    // color picker (theme color)
    content.querySelectorAll('.color-swatch').forEach(sw => {
      sw.onclick = () => {
        const picker = sw.closest('.color-picker');
        const onChange = picker.dataset.onchange;
        const patch = {};
        patch[onChange] = sw.dataset.value;
        Object.assign(s, patch);
        this.patchSettings(patch);
        this.renderSettingsModal();
      };
    });

    // icon picker (app icon)
    content.querySelectorAll('.icon-swatch').forEach(sw => {
      sw.onclick = async () => {
        const picker = sw.closest('.icon-picker');
        const onChange = picker.dataset.onchange;
        const value = sw.dataset.value;
        const patch = {};
        patch[onChange] = value;
        Object.assign(s, patch);
        this.patchSettings(patch);
        try { await API.setAppIcon(value); } catch (e) { console.warn('set icon failed:', e); }
        this.renderSettingsModal();
      };
    });

    // toggle
    content.querySelectorAll('.toggle').forEach(tg => {
      const onChange = tg.dataset.onchange;
      tg.onclick = () => {
        if (tg.closest('.switch-row')?.classList.contains('disabled')) return;
        const patch = {};
        patch[onChange] = !s[onChange];
        Object.assign(s, patch);
        this.patchSettings(patch);
        this.renderSettingsModal();
      };
    });

    // hint tooltips (JS-driven in addition to CSS :hover; also flips side to avoid clipping)
    content.onmouseover = (e) => {
      const icon = e.target.closest && e.target.closest('.hint-icon');
      if (!icon) return;
      const tip = icon.querySelector('.hint-tip');
      if (!tip) return;
      icon.classList.add('show');
      tip.style.left = ''; tip.style.right = '';
      requestAnimationFrame(() => {
        const cRect = content.getBoundingClientRect();
        const tRect = tip.getBoundingClientRect();
        if (tRect.right > cRect.right - 8) { tip.style.left = 'auto'; tip.style.right = '0'; }
      });
    };
    content.onmouseout = (e) => {
      const icon = e.target.closest && e.target.closest('.hint-icon');
      if (icon && !icon.contains(e.relatedTarget)) icon.classList.remove('show');
    };

    const archiveAfterDays = content.querySelector('#archiveAfterDays');
    if (archiveAfterDays) {
      archiveAfterDays.onchange = async () => {
        const days = Math.max(1, Math.trunc(Number(archiveAfterDays.value) || 7));
        archiveAfterDays.value = String(days);
        await this.patchSettings({ archiveAfterDays: days });
      };
    }

    const btnCheckHoliday = content.querySelector('#btnCheckHolidayUpdates');
    if (btnCheckHoliday) {
      btnCheckHoliday.onclick = async () => {
        await this.runHolidayUpdateWithProgress();
      };
    }

    // buttons (data tab)
    content.querySelectorAll('button[data-action]').forEach(btn => {
      btn.onclick = () => this.handleDataAction(btn.dataset.action);
    });
  },

  async handleDataAction(action) {
    try {
      if (action === 'openDataDir') {
        await API.openDataDir();
      } else if (action === 'exportJson') {
        const date = new Date().toISOString().slice(0, 10);
        const path = await API.pickSavePath(`todocalendar-${date}.json`);
        if (!path) return;
        await API.exportDataToPath(path);
        alert(`导出成功: ${path}`);
      } else if (action === 'importJson') {
        const path = await API.pickOpenPath();
        if (!path) return;
        const confirmed = await this.confirmAction({
          title: '导入数据',
          message: '导入会覆盖当前所有数据,确定继续?建议先导出备份。',
          confirmText: '导入并覆盖',
          danger: true,
        });
        if (!confirmed) return;
        await API.importDataFromPath(path);
        await this.reload();
        alert('导入成功');
      } else if (action === 'reloadData') {
        await this.reload();
        alert('已重新加载');
      }
    } catch (e) {
      alert('操作失败:' + window.__tauriErrMsg(e));
    }
  },

  // ===== 主题跟随系统 =====
  watchSystemTheme() {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', () => {
      if ((this.state.settings || {}).theme === 'system') this.applySettingsToDom();
    });
  },

  bindEvents() {
    // 同步 hideDone checkbox 到恢复值
    const hideDoneCb = document.getElementById('hideDone');
    if (hideDoneCb) hideDoneCb.checked = !!this.state.hideDone;

    // 安装中文日期显示(6 处 input)
    this._installAllDateDisplays();
    // 已存在的 picker-overlay 也要绑定点击
    document.querySelectorAll('.picker-overlay').forEach((el) => {
      if (el.dataset.bound === '1') return;
      el.dataset.bound = '1';
      el.addEventListener('click', (e) => {
        const target = document.getElementById(el.dataset.target);
        if (!target) return;
        e.preventDefault();
        if (typeof target.showPicker === 'function') {
          try { target.showPicker(); } catch (err) { target.focus(); }
        } else {
          target.focus();
        }
      });
    });

    document.getElementById('btnNew').onclick = () => this.openCreate();
    const btnNewTree = document.getElementById('btnNewTree');
    if (btnNewTree) btnNewTree.onclick = () => this.openBulkTreeCreate();
    const btnBulkMode = document.getElementById('btnBulkMode');
    if (btnBulkMode) btnBulkMode.onclick = () => this.toggleBulkMode();
    const btnBulkExit = document.getElementById('btnBulkExit');
    if (btnBulkExit) btnBulkExit.onclick = () => this.exitBulkMode();
    const btnBulkSelectAll = document.getElementById('btnBulkSelectAll');
    if (btnBulkSelectAll) btnBulkSelectAll.onclick = () => this.bulkSelectAll();
    const btnBulkSelectDone = document.getElementById('btnBulkSelectDone');
    if (btnBulkSelectDone) btnBulkSelectDone.onclick = () => this.bulkSelectDone();
    const btnBulkSelectNone = document.getElementById('btnBulkSelectNone');
    if (btnBulkSelectNone) btnBulkSelectNone.onclick = () => this.bulkSelectNone();
    const btnBulkArchive = document.getElementById('btnBulkArchive');
    if (btnBulkArchive) btnBulkArchive.onclick = () => this.bulkArchive();
    const btnBulkDelete = document.getElementById('btnBulkDelete');
    if (btnBulkDelete) btnBulkDelete.onclick = () => this.bulkDelete();
    const btnBulkEdit = document.getElementById('btnBulkEdit');
    if (btnBulkEdit) btnBulkEdit.onclick = () => this.openBulkEdit();
    // 批量修改 modal 绑定
    const btnBulkEditCancel = document.getElementById('btnBulkEditCancel');
    if (btnBulkEditCancel) btnBulkEditCancel.onclick = () => this.closeBulkEdit();
    const btnBulkEditSave = document.getElementById('btnBulkEditSave');
    if (btnBulkEditSave) btnBulkEditSave.onclick = () => this.saveBulkEdit();
    ['beChkStart', 'beChkEnd', 'beChkDone'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.onchange = () => this._syncBulkEditFields();
    });
    const beBtnStartClock = document.getElementById('beBtnStartClock');
    if (beBtnStartClock) beBtnStartClock.onclick = () => {
      const input = document.getElementById('beFStart');
      this._setInputPrecision('beFStart', input.type !== 'datetime-local');
    };
    const beBtnEndClock = document.getElementById('beBtnEndClock');
    if (beBtnEndClock) beBtnEndClock.onclick = () => {
      const input = document.getElementById('beFEnd');
      this._setInputPrecision('beFEnd', input.type !== 'datetime-local');
    };
    document.getElementById('prevMonth').onclick = () => this.shiftMonth(-1);
    document.getElementById('nextMonth').onclick = () => this.shiftMonth(1);
    document.getElementById('monthLabel').onclick = () => this.openMonthPicker();
    document.getElementById('mpPrevYear').onclick = () => this._mpShiftYear(-1);
    document.getElementById('mpNextYear').onclick = () => this._mpShiftYear(1);
    document.getElementById('mpClose').onclick = () => this.closeMonthPicker();
    document.getElementById('mpToday').onclick = () => {
      this.state.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const savedY = window.scrollY;
      const savedX = window.scrollX;
      Render.renderCalendar(this.state);
      window.scrollTo(savedX, savedY);
      this.closeMonthPicker();
    };
    this._mpOutsideHandler = (e) => {
      const pop = document.getElementById('monthPickerPopover');
      if (pop.hidden) return;
      if (pop.contains(e.target)) return;
      if (e.target.id === 'monthLabel' || document.getElementById('monthLabel').contains(e.target)) return;
      this.closeMonthPicker();
    };
    this._mpCloseOnScroll = () => this.closeMonthPicker();
    document.getElementById('todayBtn').onclick = () => {
      this.state.calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const savedY = window.scrollY;
      const savedX = window.scrollX;
      Render.renderCalendar(this.state);
      window.scrollTo(savedX, savedY);
    };
    document.getElementById('hideDone').onchange = (e) => {
      this.state.hideDone = e.target.checked;
      localStorage.setItem('hideDone', e.target.checked ? '1' : '0');
      Render.renderList(this.state);
    };

    let calendarResizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(calendarResizeTimer);
      calendarResizeTimer = setTimeout(() => Render.renderCalendar(this.state), 100);
    });

    window.addEventListener('focus', () => this.checkArchiveDue());

    // 日视图
    document.getElementById('dayBack').onclick = () => this.closeDayView();
    document.getElementById('dayToggleExpand').onclick = () => this.toggleDayAllExpanded();
    document.getElementById('dayAdd').onclick = () => {
      if (!this.state.dayViewDate) return;
      const d = this.state.dayViewDate;
      const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0);
      this.openCreate({ startTime: dt.toISOString() });
    };

    // 归档记录
    document.getElementById('historyBack').onclick = () => this.closeHistory();
    document.getElementById('historySearch').oninput = (e) => {
      this.state.historyQuery = e.target.value;
      Render.renderHistory(this.state);
    };
    const btnHistoryRangeDelete = document.getElementById('btnHistoryRangeDelete');
    if (btnHistoryRangeDelete) btnHistoryRangeDelete.onclick = () => this.openRangeDeleteModal();
    const btnHistoryDeleteAll = document.getElementById('btnHistoryDeleteAll');
    if (btnHistoryDeleteAll) btnHistoryDeleteAll.onclick = () => this.openDeleteAllModal();
    const btnGroupAdd = document.getElementById('btnGroupAdd');
    if (btnGroupAdd) btnGroupAdd.onclick = () => this.toggleGroupManage();
    document.getElementById('btnRangeCancel').onclick = () => this.closeRangeDeleteModal();
    document.getElementById('btnRangeConfirm').onclick = () => this.confirmRangeDelete();
    document.getElementById('rangeStart').oninput = () => this._refreshRangeCount();
    document.getElementById('rangeEnd').oninput = () => this._refreshRangeCount();
    document.getElementById('rangeField').onchange = () => this._refreshRangeCount();
    document.getElementById('btnDeleteAllCancel').onclick = () => this.closeDeleteAllModal();
    document.getElementById('btnDeleteAllConfirm').onclick = () => this.confirmDeleteAll();
    this._attachMaskClose('rangeDeleteMask', () => this.closeRangeDeleteModal());
    this._attachMaskClose('deleteAllMask', () => this.closeDeleteAllModal());

    // 弹窗
    document.getElementById('btnCancel').onclick = () => this.closeModal();
    document.getElementById('btnSave').onclick = () => this.saveModal();
    this.parentSelect = new CustomSelect(document.getElementById('fParent'), {
      onchange: () => this._syncGroupSelectToParent(),
    });
    this.groupSelect = new CustomSelect(document.getElementById('fGroup'));
    this.treeGroupSelect = new CustomSelect(document.getElementById('fTreeGroup'));
    document.getElementById('btnDelete').onclick = () => this.deleteCurrent();
    document.getElementById('btnArchive').onclick = () => this.archiveCurrent();
    document.getElementById('btnNotes').onclick = () => this.toggleNotesAside();
    document.getElementById('btnNotesClose').onclick = () => this.toggleNotesAside();
    const fSuspended = document.getElementById('fSuspended');
    const fPriority = document.getElementById('fPriority');
    fSuspended.addEventListener('change', () => {
      if (fSuspended.checked && fPriority.checked) fPriority.checked = false;
    });
    fPriority.addEventListener('change', () => {
      if (fSuspended.checked && fPriority.checked) fSuspended.checked = false;
    });
    document.getElementById('btnStartClock').onclick = () => {
      const input = document.getElementById('fStart');
      const hasTime = input.type === 'datetime-local';
      this._setInputPrecision('fStart', !hasTime);
    };
    document.getElementById('btnEndClock').onclick = () => {
      const input = document.getElementById('fEnd');
      const hasTime = input.type === 'datetime-local';
      this._setInputPrecision('fEnd', !hasTime);
    };
    const clockBindings = [
      ['btnBulkStartClock', 'fBulkStart'],
      ['btnBulkEndClock', 'fBulkEnd'],
      ['btnTreeStartClock', 'fTreeStart'],
      ['btnTreeEndClock', 'fTreeEnd'],
    ];
    clockBindings.forEach(([btnId, inputId]) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.onclick = () => {
        const input = document.getElementById(inputId);
        const hasTime = input.type === 'datetime-local';
        this._setInputPrecision(inputId, !hasTime);
      };
    });
    document.querySelectorAll('.picker-overlay').forEach((el) => {
      if (el.dataset.bound === '1') return;
      el.dataset.bound = '1';
      el.addEventListener('click', (e) => {
        const target = document.getElementById(el.dataset.target);
        if (!target) return;
        e.preventDefault();
        if (typeof target.showPicker === 'function') {
          try { target.showPicker(); } catch (err) { target.focus(); }
        } else {
          target.focus();
        }
      });
    });
    this._installAllDateDisplays();
    this._attachMaskClose('modalMask', () => this.closeModal());

    // 批量弹窗
    document.getElementById('btnBulkCancel').onclick = () => this.closeBulkModal();
    document.getElementById('btnBulkSave').onclick = () => this.saveBulkModal();
    this._attachMaskClose('bulkMask', () => this.closeBulkModal());
    const fBulkTitles = document.getElementById('fBulkTitles');
    if (fBulkTitles) {
      fBulkTitles.oninput = () => this._refreshBulkCount();
    }

    // 批量新建树
    document.getElementById('btnTreeCancel').onclick = () => this.closeBulkTreeModal();
    document.getElementById('btnTreeSave').onclick = () => this.saveBulkTreeModal();
    this._attachMaskClose('bulkTreeMask', () => this.closeBulkTreeModal());

    // 分组编辑弹窗
    document.getElementById('btnGroupCancel').onclick = () => this.closeGroupModal();
    document.getElementById('btnGroupSave').onclick = () => this.saveGroupModal();
    document.getElementById('btnGroupDelete').onclick = () => this.deleteGroupFromModal();
    const fGroupEditName = document.getElementById('fGroupEditName');
    fGroupEditName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.saveGroupModal(); }
    });
    this._attachMaskClose('groupMask', () => this.closeGroupModal());
    const fTreeTitles = document.getElementById('fTreeTitles');
    if (fTreeTitles) {
      fTreeTitles.oninput = () => this._refreshTreeCount();
      fTreeTitles.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const start = fTreeTitles.selectionStart;
        const end = fTreeTitles.selectionEnd;
        const value = fTreeTitles.value;
        const insert = '  ';
        if (e.shiftKey) {
          const lineStart = value.lastIndexOf('\n', start - 1) + 1;
          const linePrefix = value.slice(lineStart, start);
          const stripped = linePrefix.replace(/^ {1,2}/, '');
          fTreeTitles.value = value.slice(0, lineStart) + stripped + value.slice(start);
          const delta = linePrefix.length - stripped.length;
          fTreeTitles.selectionStart = fTreeTitles.selectionEnd = Math.max(lineStart, start - delta);
        } else {
          fTreeTitles.value = value.slice(0, start) + insert + value.slice(end);
          fTreeTitles.selectionStart = fTreeTitles.selectionEnd = start + insert.length;
        }
        this._refreshTreeCount();
      });
    }

    // Dropdown
    const btnMenu = document.getElementById('btnMenu');
    btnMenu.onclick = (e) => { e.stopPropagation(); this.toggleDropdown(); };
    document.getElementById('dropdown').onclick = (e) => e.stopPropagation();

    // Help modal
    const btnHelp = document.getElementById('btnHelp');
    btnHelp.onclick = (e) => { e.stopPropagation(); this.openHelp(); };
    document.getElementById('btnCloseHelp').onclick = () => this.closeHelp();
    this._attachMaskClose('helpMask', () => this.closeHelp());
    const repo = 'xuananrocx/todocalendar';
    const helpLinks = [
      { id: 'helpLinkIssue',      icon: Icon.bug(),  label: '新建 Issue',  url: `https://github.com/${repo}/issues/new`, external: true },
      { id: 'helpLinkStar',       icon: Icon.star(), label: '给个 Star',  url: `https://github.com/${repo}`, external: true },
      { id: 'helpLinkReadme',     icon: Icon.bookOpen(), label: 'README', url: `https://github.com/${repo}#readme`, external: true },
    ];
    for (const item of helpLinks) {
      const el = document.getElementById(item.id);
      el.innerHTML = `${item.icon}<span>${item.label}</span>`;
      if (item.external) {
        el.onclick = (e) => { e.preventDefault(); API.openExternal(item.url).catch(err => alert('打开失败: ' + err)); };
      } else {
        el.onclick = (e) => { e.preventDefault(); this.openAppreciate(); };
      }
    }

    const btnToggleExpand = document.getElementById('btnToggleExpand');
    btnToggleExpand.onclick = () => this.toggleAllExpanded();

    const btnSort = document.getElementById('btnSort');
    const sortDropdown = document.getElementById('sortDropdown');
    btnSort.onclick = (e) => { e.stopPropagation(); this.toggleSortDropdown(); };
    sortDropdown.onclick = (e) => e.stopPropagation();
    sortDropdown.querySelectorAll('[data-sort-mode]').forEach(el => {
      el.onclick = async (e) => {
        e.stopPropagation();
        this.toggleSortDropdown(false);
        await this.patchSettings({ sortMode: el.dataset.sortMode });
      };
    });
    document.addEventListener('click', () => {
      this.toggleDropdown(false);
      this.toggleSortDropdown(false);
    });

    // dropdown items
    document.querySelectorAll('[data-action]').forEach(el => {
      if (el.closest('#settingsContent')) return;
      el.onclick = (e) => {
        e.stopPropagation();
        const a = el.dataset.action;
        this.handleDropdownAction(a);
      };
    });

    // settings nav
    document.querySelectorAll('.settings-nav-item').forEach(el => {
      el.onclick = () => this.setSettingsTab(el.dataset.tab);
    });
    document.getElementById('btnCloseSettings').onclick = () => this.closeSettingsModal();
    document.getElementById('btnDoneSettings').onclick = () => this.closeSettingsModal();
    document.getElementById('btnResetSettings').onclick = () => this.resetSettings();
    this._attachMaskClose('settingsMask', () => this.closeSettingsModal());

    document.getElementById('btnConfirmCancel').onclick = () => this.closeConfirm(false);
    document.getElementById('btnConfirmAccept').onclick = () => this.closeConfirm(true);
    this._attachMaskClose('confirmMask', () => this.closeConfirm(false));

    const promptInput = document.getElementById('promptInput');
    document.getElementById('btnPromptCancel').onclick = () => this.closePrompt({ type: 'cancel', value: '' });
    document.getElementById('btnPromptAccept').onclick = () => this.closePrompt({ type: 'submit', value: promptInput.value });
    document.getElementById('btnPromptDelete').onclick = () => this.closePrompt({ type: 'delete', value: promptInput.value });
    this._attachMaskClose('promptMask', () => this.closePrompt({ type: 'cancel', value: '' }));
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.closePrompt({ type: 'submit', value: promptInput.value });
      }
    });

    // ESC: confirm > modal > settings > history > dayView
    document.addEventListener('keydown', (e) => {
      const confirmMask = document.getElementById('confirmMask');
      if (!confirmMask.hidden && e.key === 'Tab') {
        const buttons = [
          document.getElementById('btnConfirmCancel'),
          document.getElementById('btnConfirmAccept'),
        ];
        const current = buttons.indexOf(document.activeElement);
        const next = e.shiftKey
          ? (current <= 0 ? buttons.length - 1 : current - 1)
          : (current < 0 || current === buttons.length - 1 ? 0 : current + 1);
        e.preventDefault();
        buttons[next].focus();
        return;
      }
      if (e.key !== 'Escape') return;
      if (!confirmMask.hidden) { this.closeConfirm(false); return; }
      const promptMask = document.getElementById('promptMask');
      if (!promptMask.hidden) { this.closePrompt({ type: 'cancel', value: '' }); return; }
      const modal = document.getElementById('modalMask');
      if (!modal.hidden) { this.closeModal(); return; }
      const settings = document.getElementById('settingsMask');
      if (!settings.hidden) { this.closeSettingsModal(); return; }
      if (this.state.historyOpen) { this.closeHistory(); return; }
      if (this.state.dayViewDate) this.closeDayView();
    });

    // 系统主题跟随
  },

  handleDropdownAction(action) {
    const s = this.state.settings;
    switch (action) {
      case 'openHistory': this.openHistory(); break;
      case 'exportJson': this.handleDataAction('exportJson'); break;
      case 'importJson': this.handleDataAction('importJson'); break;
      case 'openDataDir': this.handleDataAction('openDataDir'); break;
      case 'theme_light': this.patchSettings({ theme: 'light' }); this.refreshDropdownValues(); break;
      case 'theme_dark': this.patchSettings({ theme: 'dark' }); this.refreshDropdownValues(); break;
      case 'theme_system': this.patchSettings({ theme: 'system' }); this.refreshDropdownValues(); break;
      case 'font_small': this.patchSettings({ fontSize: 'small' }); this.refreshDropdownValues(); break;
      case 'font_medium': this.patchSettings({ fontSize: 'medium' }); this.refreshDropdownValues(); break;
      case 'font_medium_large': this.patchSettings({ fontSize: 'medium-large' }); this.refreshDropdownValues(); break;
      case 'font_large': this.patchSettings({ fontSize: 'large' }); this.refreshDropdownValues(); break;
      case 'week_monday': this.patchSettings({ weekStart: 'monday' }); this.refreshDropdownValues(); break;
      case 'week_sunday': this.patchSettings({ weekStart: 'sunday' }); this.refreshDropdownValues(); break;
      case 'openSettings': this.openSettingsModal(); break;
      case 'about': this.openSettingsModal('about'); break;
    }
    if (action !== 'openHistory' && action !== 'openSettings' && action !== 'about') this.toggleDropdown(false);
  },

  refreshDropdownValues() {
    const s = this.state.settings || {};
    const labels = {
      light: '浅色', dark: '深色', system: '跟随系统',
      small: '小', medium: '中', large: '大',
      monday: '周一', sunday: '周日',
    };
    const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = labels[v] || v; };
    setText('ddThemeValue', s.theme);
    const fontLabel = { small:'小', medium:'中', 'medium-large':'较大', large:'大' }[s.fontSize] || s.fontSize;
    setText('ddFontValue', fontLabel);
    setText('ddWeekValue', s.weekStart);

    const sortMode = s.sortMode || 'auto';
    const sortButton = document.getElementById('btnSort');
    if (sortButton) {
      sortButton.title = sortMode === 'auto'
        ? '自动排序：截止日期由近到远'
        : '手动排序：可拖动调整顺序';
      sortButton.setAttribute('aria-label', sortButton.title);
    }
    document.querySelectorAll('#sortDropdown [data-sort-mode]').forEach(el => {
      const selected = el.dataset.sortMode === sortMode;
      el.setAttribute('aria-checked', String(selected));
    });
  },

  shiftMonth(delta) {
    const m = this.state.calMonth;
    this.state.calMonth = new Date(m.getFullYear(), m.getMonth() + delta, 1);
    const savedY = window.scrollY;
    const savedX = window.scrollX;
    Render.renderCalendar(this.state);
    window.scrollTo(savedX, savedY);
  },

  openDayView(date) {
    this.state.dayViewDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    this.state.calMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    // 日详情独立展开状态,退出即弃,不写库
    const mode = this.state.settings?.dayExpandDefault || 'all-collapsed';
    if (mode === 'follow-list') {
      // 跟随列表:进入时按当前列表展开状态快照
      this.state.dayExpanded = new Map(this.state.todos.map(t => [t.id, t.expanded !== false]));
    } else if (mode === 'smart') {
      // 智能折叠:默认折叠,仅自动展开"当天命中任务"的祖先链
      this.state.dayExpanded = new Map(this.state.todos.map(t => [t.id, false]));
      const byId = new Map(this.state.todos.map(t => [t.id, t]));
      for (const t of this.state.todos) {
        if (!Render.getTodoDayHits(t, this.state.dayViewDate).length) continue;
        let pid = t.parentId;
        const seen = new Set();
        while (pid && !seen.has(pid)) {
          seen.add(pid);
          const p = byId.get(pid);
          if (!p) break;
          this.state.dayExpanded.set(pid, true);
          pid = p.parentId;
        }
      }
    } else {
      // 全折叠
      this.state.dayExpanded = new Map(this.state.todos.map(t => [t.id, false]));
    }
    Render.renderAll(this.state);
  },

  closeDayView() {
    this.state.dayViewDate = null;
    this.state.dayExpanded = null;
    Render.renderAll(this.state);
  },

  refreshParentSelect(excludeId) {
    const items = [{ value: '', label: '(顶层)', depth: 0 }];
    const byParent = Render.buildTree(this.state.todos);
    const walk = (parentId, depth) => {
      const kids = Render.getChildren(byParent, parentId);
      for (const k of kids) {
        if (k.id === excludeId) continue;
        items.push({ value: k.id, label: k.title, depth });
        walk(k.id, depth + 1);
      }
    };
    walk(null, 0);
    this.parentSelect.setOptions(items);
  },

  _populateGroupSelect(cs, selected = '') {
    if (!cs) return;
    const groups = [...(this.state.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const items = [{ value: '', label: this.defaultGroupName(), depth: 0 }]
      .concat(groups.map(g => ({ value: g.id, label: g.name, depth: 0 })));
    cs.setOptions(items, selected);
  },

  // 新建默认分组:当前在具体分组 tab → 该分组;全部/Default → Default
  _defaultGroupIdForCreate() {
    const a = this.state.activeGroup;
    return (a && a !== '__all__' && a !== '__default__'
      && (this.state.groups || []).some(g => g.id === a)) ? a : '';
  },

  // 父级选择联动:挂到父待办下时分组跟随父(禁止改),顶层时可自由选择
  _syncGroupSelectToParent() {
    const row = document.getElementById('fldGroupRow');
    if (!row || row.hidden || !this.groupSelect || !this.parentSelect) return;
    const pid = this.parentSelect.getValue() || null;
    if (pid) {
      const parent = this.state.todos.find(t => t.id === pid);
      const gid = parent && parent.groupId
        && (this.state.groups || []).some(g => g.id === parent.groupId) ? parent.groupId : '';
      this.groupSelect.setValue(gid);
      this.groupSelect.setDisabled(true, '子待办跟随父待办的分组');
    } else {
      this.groupSelect.setDisabled(false);
    }
  },

  // 根据 settings.defaultStartTime 预填 startTime
  _defaultStartTime() {
    const s = this.state.settings;
    const cfg = s?.defaultStartTime;
    if (!cfg || cfg === 'none') return null;
    const d = new Date();
    if (!Render.showTimePrecision) {
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0).toISOString();
    }
    if (cfg === 'now') return d.toISOString();
    // "HH:MM"
    const [hh, mm] = cfg.split(':').map(Number);
    const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 9, mm || 0);
    return dt.toISOString();
  },

  openCreate(opts = {}) {
    this.editingId = null;
    document.getElementById('modalTitle').textContent = '新建待办';
    document.getElementById('fTitle').value = '';
    this._writeInput('fStart', null);
    this._writeInput('fEnd', null);
    document.getElementById('fSuspended').checked = false;
    document.getElementById('fPriority').checked = false;
    document.querySelector('.fld-flags').hidden = true;
    const startBadge = document.getElementById('fStartAutoBadge');
    const endBadge = document.getElementById('fEndAutoBadge');
    if (startBadge) startBadge.hidden = true;
    if (endBadge) endBadge.hidden = true;
    this.refreshParentSelect(null);
    if (opts.parentId) this.parentSelect.setValue(opts.parentId);
    const groupRow = document.getElementById('fldGroupRow');
    if (this.state.settings?.enableGroups) {
      groupRow.hidden = false;
      this._populateGroupSelect(this.groupSelect, opts.groupId ?? this._defaultGroupIdForCreate());
    } else {
      groupRow.hidden = true;
    }
    this._syncGroupSelectToParent();
    const start = opts.startTime
      || (opts.parentId ? this._inheritedStartTime(opts.parentId) : null)
      || this._defaultStartTime();
    if (start) this._writeInput('fStart', start);
    if (opts.parentId) {
      const inheritedEnd = this._inheritedEndTime(opts.parentId);
      if (inheritedEnd) this._writeInput('fEnd', inheritedEnd);
    }
    document.getElementById('btnDelete').hidden = true;
    document.getElementById('btnArchive').hidden = true;
    this._resetNotes('');
    this.openModal();
  },

  _btnForInput(inputId) {
    const map = {
      fStart: 'btnStartClock',
      fEnd: 'btnEndClock',
      fBulkStart: 'btnBulkStartClock',
      fBulkEnd: 'btnBulkEndClock',
      fTreeStart: 'btnTreeStartClock',
      fTreeEnd: 'btnTreeEndClock',
      beFStart: 'beBtnStartClock',
      beFEnd: 'beBtnEndClock',
    };
    return document.getElementById(map[inputId]);
  },

  _setInputPrecision(inputId, hasTime) {
    const input = document.getElementById(inputId);
    const btn = this._btnForInput(inputId);
    const oldRaw = input.value || '';
    if (hasTime) {
      input.type = 'datetime-local';
      if (oldRaw.length === 10) {
        input.value = `${oldRaw}T09:00`;
      } else if (oldRaw === '') {
        const today = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        input.value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}T09:00`;
      }
      if (btn) btn.textContent = '去时间';
    } else {
      input.type = 'date';
      if (oldRaw.length >= 10) input.value = oldRaw.substring(0, 10);
      if (btn) btn.textContent = '+ 时间';
    }
    this._renderDateDisplay(inputId);
  },

  _readInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input.value) return null;
    return input.type === 'datetime-local'
      ? Render.localInputToISO(input.value)
      : Render.localDateToISO(input.value);
  },

  _writeInput(inputId, iso) {
    const input = document.getElementById(inputId);
    if (!iso) {
      this._setInputPrecision(inputId, false);
      input.value = '';
      this._renderDateDisplay(inputId);
      return;
    }
    const d = new Date(iso);
    if (isNaN(d.getTime())) {
      this._setInputPrecision(inputId, false);
      input.value = '';
      this._renderDateDisplay(inputId);
      return;
    }
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    this._setInputPrecision(inputId, hasTime);
    input.value = hasTime ? Render.isoToLocalInput(iso) : Render.isoToLocalDate(iso);
    this._renderDateDisplay(inputId);
  },

  // ===== 中文日期显示(伪装原生 input) =====
  _formatDateDisplay(value, hasTime) {
    if (!value) return '';
    // value: 'yyyy-MM-dd' or 'yyyy-MM-ddTHH:mm'
    const [datePart, timePart] = value.split('T');
    const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    const [, y, mo, d] = m;
    let str = `${y}年${parseInt(mo, 10)}月${parseInt(d, 10)}日`;
    if (hasTime && timePart) {
      const [hh, mm] = timePart.split(':');
      str += ` ${hh}:${mm}`;
    }
    return str;
  },

  _renderDateDisplay(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const display = document.querySelector(`[data-display-for="${inputId}"]`);
    if (!display) return;
    const hasTime = input.type === 'datetime-local';
    const text = this._formatDateDisplay(input.value, hasTime);
    if (text) {
      display.textContent = text;
      display.classList.remove('placeholder');
    } else {
      display.textContent = '选择日期';
      display.classList.add('placeholder');
    }
    // 加日历图标
    const icon = document.createElement('span');
    icon.className = 'cal-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>';
    display.appendChild(icon);
  },

  _refreshAllDateDisplays() {
    ['fStart', 'fEnd', 'fBulkStart', 'fBulkEnd', 'fTreeStart', 'fTreeEnd', 'beFStart', 'beFEnd'].forEach((id) => {
      this._renderDateDisplay(id);
    });
  },

  _installDateDisplay(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (document.querySelector(`[data-display-for="${inputId}"]`)) return; // 已安装
    // 包装到 input-wrap(如果没有)
    let wrap = input.parentElement;
    if (!wrap.classList.contains('input-wrap')) {
      wrap = document.createElement('div');
      wrap.className = 'input-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    // 加 picker-overlay(如果没)
    if (!wrap.querySelector('.picker-overlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'picker-overlay';
      overlay.dataset.target = inputId;
      wrap.appendChild(overlay);
    }
    // 加 display
    const display = document.createElement('div');
    display.className = 'date-display placeholder';
    display.dataset.displayFor = inputId;
    wrap.appendChild(display);
    // input 变化 → 重渲染
    input.addEventListener('input', () => this._renderDateDisplay(inputId));
    input.addEventListener('change', () => this._renderDateDisplay(inputId));
    // 初始渲染
    this._renderDateDisplay(inputId);
  },

  _installAllDateDisplays() {
    ['fStart', 'fEnd', 'fBulkStart', 'fBulkEnd', 'fTreeStart', 'fTreeEnd', 'beFStart', 'beFEnd'].forEach((id) => {
      this._installDateDisplay(id);
    });
  },

  _inheritedEndTime(parentId) {
    const visited = new Set();
    let pid = parentId;
    let depth = 0;
    while (pid && !visited.has(pid) && depth < 20) {
      const parent = this.state.todos.find(t => t.id === pid);
      if (!parent) break;
      if (parent.endTime) return parent.endTime;
      visited.add(pid);
      pid = parent.parentId || null;
      depth++;
    }
    return null;
  },

  _inheritedStartTime(parentId) {
    const visited = new Set();
    let pid = parentId;
    let depth = 0;
    while (pid && !visited.has(pid) && depth < 20) {
      const parent = this.state.todos.find(t => t.id === pid);
      if (!parent) break;
      if (parent.startTime) return parent.startTime;
      visited.add(pid);
      pid = parent.parentId || null;
      depth++;
    }
    return null;
  },

  openBulkCreate(opts = {}) {
    this.bulkParentId = opts.parentId || null;
    document.getElementById('bulkMask').hidden = false;
    document.getElementById('fBulkTitles').value = '';
    const bulkPrecision = !!Render.showTimePrecision;
    const startInput = document.getElementById('fBulkStart');
    const endInput = document.getElementById('fBulkEnd');
    startInput.type = bulkPrecision ? 'datetime-local' : 'date';
    endInput.type = bulkPrecision ? 'datetime-local' : 'date';
    const start = opts.startTime
      || (opts.parentId ? this._inheritedStartTime(opts.parentId) : null)
      || this._defaultStartTime();
    const writeBulk = (input, iso) => {
      if (!iso) { input.value = ''; this._renderDateDisplay(input.id); return; }
      input.value = bulkPrecision ? Render.isoToLocalInput(iso) : Render.isoToLocalDate(iso);
      this._renderDateDisplay(input.id);
    };
    writeBulk(startInput, start);
    let endIso = null;
    if (opts.parentId) endIso = this._inheritedEndTime(opts.parentId);
    writeBulk(endInput, endIso);
    this._refreshBulkCount();
    setTimeout(() => document.getElementById('fBulkTitles').focus(), 50);
  },

  closeBulkModal() {
    document.getElementById('bulkMask').hidden = true;
    this.bulkParentId = null;
  },

  openBulkTreeCreate() {
    document.getElementById('bulkTreeMask').hidden = false;
    document.getElementById('fTreeTitles').value = '';
    const precision = !!Render.showTimePrecision;
    const startInput = document.getElementById('fTreeStart');
    const endInput = document.getElementById('fTreeEnd');
    startInput.type = precision ? 'datetime-local' : 'date';
    endInput.type = precision ? 'datetime-local' : 'date';
    const defaultStart = this._defaultStartTime();
    startInput.value = defaultStart
      ? (precision ? Render.isoToLocalInput(defaultStart) : Render.isoToLocalDate(defaultStart))
      : '';
    this._renderDateDisplay('fTreeStart');
    endInput.value = '';
    this._renderDateDisplay('fTreeEnd');
    const treeGroupRow = document.getElementById('treeGroupRow');
    if (treeGroupRow) {
      treeGroupRow.hidden = !this.state.settings?.enableGroups;
      if (!treeGroupRow.hidden) {
        this._populateGroupSelect(this.treeGroupSelect, this._defaultGroupIdForCreate());
      }
    }
    this._refreshTreeCount();
    setTimeout(() => document.getElementById('fTreeTitles').focus(), 50);
  },

  closeBulkTreeModal() {
    document.getElementById('bulkTreeMask').hidden = true;
  },

  _parseTreeTitles() {
    const raw = document.getElementById('fTreeTitles').value || '';
    const lines = raw.split('\n');
    const result = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let indent = 0;
      for (const ch of line) {
        if (ch === ' ') indent += 1;
        else if (ch === '\t') indent += 2;
        else break;
      }
      const depth = Math.floor(indent / 2);
      const title = line.trim();
      if (title) result.push({ depth, title });
    }
    return result;
  },

  _refreshTreeCount() {
    const parsed = this._parseTreeTitles();
    const roots = parsed.filter(item => item.depth === 0).length;
    const el = document.getElementById('treeCount');
    if (el) el.textContent = `将创建 ${parsed.length} 个待办 · ${roots} 棵树`;
  },

  async saveBulkTreeModal() {
    const parsed = this._parseTreeTitles();
    if (parsed.length === 0) {
      alert('请至少输入一个标题');
      return;
    }
    if (parsed[0].depth !== 0) {
      alert('第一行必须是顶层待办(无缩进)');
      return;
    }
    const startInput = document.getElementById('fTreeStart');
    const endInput = document.getElementById('fTreeEnd');
    const readField = (input) => {
      if (!input.value) return null;
      return input.type === 'datetime-local'
        ? Render.localInputToISO(input.value)
        : Render.localDateToISO(input.value);
    };
    const startTime = readField(startInput);
    const endTime = readField(endInput);
    if (endTime && !startTime) {
      alert('请先设置开始时间');
      return;
    }
    if (startTime && endTime && new Date(endTime) < new Date(startTime)) {
      alert('截止时间不能早于开始时间');
      return;
    }

    const btn = document.getElementById('btnTreeSave');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '创建中...';
    try {
      const treeGroupRow = document.getElementById('treeGroupRow');
      const rootGroupId = (treeGroupRow && !treeGroupRow.hidden)
        ? (this.treeGroupSelect.getValue() || null)
        : null;
      const stack = [];
      const rootIds = [];
      for (const item of parsed) {
        while (stack.length > item.depth) stack.pop();
        const parentId = stack.length ? stack[stack.length - 1] : null;
        const created = await API.create({
          title: item.title,
          startTime,
          endTime,
          parentId,
          groupId: parentId ? null : rootGroupId,
        });
        if (!parentId) rootIds.push(created.id);
        stack.push(created.id);
      }
      for (const rid of rootIds) {
        await API.update(rid, { expanded: true }).catch(() => {});
      }
      this.closeBulkTreeModal();
      await this.reload();
    } catch (e) {
      alert('创建失败:' + window.__tauriErrMsg(e));
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  },

  _refreshBulkCount() {
    const titles = this._parseBulkTitles();
    const el = document.getElementById('bulkCount');
    if (el) el.textContent = `将创建 ${titles.length} 个待办`;
  },

  _parseBulkTitles() {
    const raw = document.getElementById('fBulkTitles').value || '';
    return raw.split('\n').map(s => s.trim()).filter(Boolean);
  },

  async saveBulkModal() {
    const titles = this._parseBulkTitles();
    if (titles.length === 0) {
      alert('请至少输入一个标题');
      return;
    }
    const startInput = document.getElementById('fBulkStart');
    const endInput = document.getElementById('fBulkEnd');
    const startRaw = startInput.value;
    const endRaw = endInput.value;
    if (endRaw && !startRaw) {
      alert('请先设置开始时间');
      return;
    }
    if (startRaw && endRaw && new Date(endRaw) < new Date(startRaw)) {
      alert('截止时间不能早于开始时间');
      return;
    }
    const readBulk = (input) => {
      if (!input.value) return null;
      return input.type === 'datetime-local'
        ? Render.localInputToISO(input.value)
        : Render.localDateToISO(input.value);
    };
    const startTime = readBulk(startInput);
    const endTime = readBulk(endInput);
    const parentId = this.bulkParentId || null;

    const btn = document.getElementById('btnBulkSave');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '创建中...';
    try {
      for (const title of titles) {
        await API.create({ title, startTime, endTime, parentId });
      }
      this.closeBulkModal();
      if (parentId) {
        const parent = this.state.todos.find(t => t.id === parentId);
        if (parent && !parent.done) {
          await API.update(parentId, { expanded: true }).catch(() => {});
        }
      }
      await this.reload();
    } catch (e) {
      alert('批量创建失败:' + window.__tauriErrMsg(e));
      await this.reload();
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  },

  openEdit(id) {
    const t = this.state.todos.find(x => x.id === id);
    if (!t) return;
    this.editingId = id;
    document.getElementById('modalTitle').textContent = '编辑待办';
    document.getElementById('fTitle').value = t.title || '';
    this._writeInput('fStart', t.startTime);
    this._writeInput('fEnd', t.endTime);
    // badge 仅父代办显示,且对应全局开关开启 + 时间匹配所有子代办的 min/max
    const children = this.state.todos.filter(x => x.parentId === id);
    const startBadge = document.getElementById('fStartAutoBadge');
    const endBadge = document.getElementById('fEndAutoBadge');
    const startSyncOn = !!this.state.settings?.autoSyncStart;
    const endSyncOn = !!this.state.settings?.autoSyncEnd;
    if (children.length > 0) {
      const childStarts = children.map(c => c.startTime).filter(Boolean).sort();
      const childEnds = children.map(c => c.endTime).filter(Boolean).sort();
      const minStart = childStarts[0];
      const maxEnd = childEnds[childEnds.length - 1];
      if (startBadge) startBadge.hidden = !(startSyncOn && minStart && t.startTime && t.startTime === minStart);
      if (endBadge) endBadge.hidden = !(endSyncOn && maxEnd && t.endTime && t.endTime === maxEnd);
    } else {
      if (startBadge) startBadge.hidden = true;
      if (endBadge) endBadge.hidden = true;
    }
    this.refreshParentSelect(id);
    if (t.parentId) this.parentSelect.setValue(t.parentId);
    const groupRow = document.getElementById('fldGroupRow');
    if (this.state.settings?.enableGroups) {
      groupRow.hidden = false;
      this._populateGroupSelect(this.groupSelect, t.groupId || '');
    } else {
      groupRow.hidden = true;
    }
    this._syncGroupSelectToParent();
    document.getElementById('fSuspended').checked = !!t.suspendedAt;
    document.getElementById('fPriority').checked = !!t.isPriority;
    document.querySelector('.fld-flags').hidden = false;
    document.getElementById('btnDelete').hidden = false;
    const btnArchive = document.getElementById('btnArchive');
    btnArchive.hidden = false;
    btnArchive.disabled = !t.done;
    btnArchive.title = t.done ? '' : '未完成的待办不允许归档';
    this._resetNotes(t.notes || '');
    this.openModal();
  },

  _notesEditor: null,
  _notesEditorReady: false,
  _pendingNotesValue: '',

  _ensureNotesEditor() {
    if (this._notesEditor) return this._notesEditor;
    if (typeof Vditor === 'undefined') {
      console.warn('Vditor not loaded');
      return null;
    }
    const initial = this._pendingNotesValue || '';
    this._notesEditorReady = false;
    this._notesEditor = new Vditor('fNotesEditor', {
      mode: 'wysiwyg',
      height: 220,
      minHeight: 160,
      toolbar: ['bold', 'list', 'ordered-list'],
      toolbarConfig: { pin: true },
      cache: { enable: false },
      counter: { enable: false },
      outline: { enable: false },
      placeholder: '支持 Markdown',
      value: initial,
      after: () => {
        this._notesEditorReady = true;
        if (initial) this._notesEditor.setValue(initial);
      },
      input: () => this._updateNotesButton(),
    });
    return this._notesEditor;
  },

  _destroyNotesEditor() {
    if (this._notesEditor) {
      try { this._notesEditor.destroy(); } catch (e) {}
      this._notesEditor = null;
      this._notesEditorReady = false;
    }
  },

  _resetNotes(initialValue) {
    const btn = document.getElementById('btnNotes');
    const aside = document.getElementById('todoNotesAside');
    const modal = document.getElementById('todoModal');
    this._destroyNotesEditor();
    this._pendingNotesValue = initialValue || '';
    const hasContent = initialValue && initialValue.trim().length > 0;
    btn.hidden = false;
    if (hasContent) {
      aside.hidden = false;
      modal.classList.add('notes-open');
      btn.textContent = '编辑备注';
      btn.classList.add('has-notes');
      this._ensureNotesEditor();
    } else {
      aside.hidden = true;
      modal.classList.remove('notes-open');
      btn.textContent = '添加备注';
      btn.classList.remove('has-notes');
    }
  },

  _updateNotesButton() {
    const btn = document.getElementById('btnNotes');
    const value = this._notesEditor
      ? this._notesEditor.getValue()
      : (this._pendingNotesValue || '');
    const hasContent = value && value.trim().length > 0;
    if (hasContent) {
      btn.textContent = '编辑备注';
      btn.classList.add('has-notes');
    } else {
      btn.textContent = '添加备注';
      btn.classList.remove('has-notes');
    }
  },

  toggleNotesAside() {
    const aside = document.getElementById('todoNotesAside');
    const modal = document.getElementById('todoModal');
    const btn = document.getElementById('btnNotes');
    if (aside.hidden) {
      aside.hidden = false;
      modal.classList.add('notes-open');
      btn.textContent = '编辑备注';
      this._ensureNotesEditor();
    } else {
      if (this._notesEditor) this._pendingNotesValue = this._notesEditor.getValue();
      aside.hidden = true;
      modal.classList.remove('notes-open');
      this._destroyNotesEditor();
      this._updateNotesButton();
    }
  },

  openModal(state) {
    document.getElementById('modalMask').hidden = false;
    setTimeout(() => {
      if (document.getElementById('confirmMask').hidden) {
        document.getElementById('fTitle').focus();
      }
    }, 50);
  },

  closeModal() {
    document.getElementById('modalMask').hidden = true;
    this.editingId = null;
    this._destroyNotesEditor();
    this._pendingNotesValue = '';
    const aside = document.getElementById('todoNotesAside');
    const modal = document.getElementById('todoModal');
    if (aside) aside.hidden = true;
    if (modal) modal.classList.remove('notes-open');
  },

  async saveModal() {
    const title = document.getElementById('fTitle').value.trim();
    if (!title) { alert('请输入标题'); return; }
    const startRaw = document.getElementById('fStart').value;
    const endRaw = document.getElementById('fEnd').value;
    const parentId = this.parentSelect.getValue() || null;

    if (endRaw && !startRaw) {
      alert('请先设置开始时间');
      return;
    }
    if (startRaw && endRaw && new Date(endRaw) < new Date(startRaw)) {
      alert('截止时间不能早于开始时间');
      return;
    }

    if (parentId && this.editingId) {
      if (parentId === this.editingId) { alert('不能把待办设成自己的子级'); return; }
      let p = this.state.todos.find(x => x.id === parentId);
      while (p) {
        if (p.parentId === this.editingId) { alert('不能把待办挂到自己的子级下面(会成环)'); return; }
        p = p.parentId ? this.state.todos.find(x => x.id === p.parentId) : null;
      }
    }

    const body = {
      title,
      startTime: this._readInput('fStart'),
      endTime: this._readInput('fEnd'),
      parentId,
    };
    const notesRaw = this._notesEditor ? this._notesEditor.getValue() : (this._pendingNotesValue || '');
    body.notes = notesRaw && notesRaw.trim() ? notesRaw : null;

    const groupRow = document.getElementById('fldGroupRow');
    const groupVisible = groupRow && !groupRow.hidden;
    if (!this.editingId && groupVisible) {
      body.groupId = this.groupSelect.getValue() || null;
    }

    try {
      if (this.editingId) await API.update(this.editingId, body);
      else await API.create(body);
      if (this.editingId) {
        const wantSuspended = document.getElementById('fSuspended').checked;
        const wantPriority = document.getElementById('fPriority').checked;
        const cur = this.state.todos.find(x => x.id === this.editingId);
        if (cur && !!cur.suspendedAt !== wantSuspended) {
          await window.__TAURI__.core.invoke('set_suspended', { id: this.editingId, suspended: wantSuspended });
        }
        if (cur && !!cur.isPriority !== wantPriority) {
          await window.__TAURI__.core.invoke('set_priority', { id: this.editingId, priority: wantPriority });
        }
        // 分组同步:有父级→跟随父;顶层→按下拉选择(整个子树跟随)
        if (groupVisible) {
          const newGroup = parentId
            ? ((this.state.todos.find(x => x.id === parentId) || {}).groupId || null)
            : (this.groupSelect.getValue() || null);
          if (cur && (cur.groupId || null) !== newGroup) {
            await API.setTodoGroup(this.editingId, newGroup);
          }
        }
      }
      this.closeModal();
      await this.reload();
    } catch (e) {
      alert('保存失败:' + window.__tauriErrMsg(e));
    }
  },

  async deleteCurrent() {
    const id = this.editingId;
    if (!id) return;
    const todo = this.state.todos.find(item => item.id === id);
    if (!todo) return;

    if (this.state.settings?.deleteConfirm !== false) {
      const descendantCount = this.collectDescendants(id).length - 1;
      const message = descendantCount
        ? `确定删除 "${todo.title}" 吗?它有 ${descendantCount} 个子待办,会一并删除。`
        : `确定删除 "${todo.title}" 吗?`;
      const confirmed = await this.confirmAction({
        title: '删除待办',
        message,
        confirmText: '删除',
        danger: true,
      });
      if (!confirmed) return;
    }

    try {
      await API.remove(id);
      this.closeModal();
      await this.reload();
    } catch (e) {
      alert('删除失败:' + window.__tauriErrMsg(e));
    }
  },
};

Main.init();
