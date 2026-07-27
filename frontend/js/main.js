const Main = {
  state: {
    todos: [],
    groups: [],
    activeGroup: '__all__',
    calMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    dayViewDate: null,
    hideDone: false,
    highlightId: null,
    settings: null,
    settingsTab: 'appearance',
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
      alert('恢复失败:' + window.__tauriErrMsg(e));
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
      alert('归档失败:' + window.__tauriErrMsg(e));
    }
  },

  // 把 settings 应用到 <html> 根元素 (data-theme / data-font-size / data-compact / data-show-icons)
  startClock() {
    const dateEl = document.querySelector('.time-clock-date');
    const hmEl = document.querySelector('.time-clock-hm');
    if (!dateEl || !hmEl) return;
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const update = () => {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      dateEl.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
      hmEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    update();
    if (this._clockTimer) clearInterval(this._clockTimer);
    this._clockTimer = setInterval(update, 60000);
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
    this.state.bulkSelected = new Set(this.state.todos.map(t => t.id));
    this._renderBulkState();
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
    const canArchive = todos.filter(t => t.done);
    const skipped = todos.filter(t => !t.done);
    if (!canArchive.length) {
      await this.confirmAction({
        title: '无法归档',
        messageHtml: `<div class="confirm-message-bulk">所选 <strong style="color:var(--overdue)">${ids.length}</strong> 项都未完成。<br>只能归档<strong>已完成</strong>的待办。</div>`,
        confirmText: '知道了',
        hideCancel: true,
      });
      return;
    }
    const summaryHtml = `
      <div class="confirm-message-bulk">
        ${skipped.length
          ? `已选 <strong>${ids.length}</strong> 项,分类如下:`
          : `确认归档 <strong style="color:#10b981">${canArchive.length}</strong> 项已完成待办?`}
        ${skipped.length || canArchive.length !== ids.length ? `
        <div class="bulk-summary">
          <span class="label">✓ 已完成</span><span></span><span class="num ok">${canArchive.length}</span>
          ${skipped.length ? `<span class="label">○ 未完成</span><span class="label">跳过</span><span class="num skip">${skipped.length}</span>` : ''}
        </div>` : ''}
      </div>`;
    const confirmed = await this.confirmAction({
      title: '批量归档',
      messageHtml: summaryHtml,
      confirmText: skipped.length ? `归档 ${canArchive.length} 项` : '归档',
    });
    if (!confirmed) return;
    try {
      for (const t of canArchive) {
        await API.archiveNow(t.id);
      }
      await this.reload();
      this.exitBulkMode();
    } catch (e) {
      alert('批量归档失败:' + window.__tauriErrMsg(e));
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
    tabs.push(`<div class="group-tab ${active === '__all__' ? 'active' : ''}" data-id="__all__" title="全部">全部</div>`);
    tabs.push(`<div class="group-tab ${active === '__default__' ? 'active' : ''}" data-id="__default__" title="Default">Default</div>`);
    for (const g of groups) {
      tabs.push(`<div class="group-tab ${active === g.id ? 'active' : ''}" data-id="${g.id}" title="${g.name}">${g.name}<span class="group-tab-menu" data-id="${g.id}">⋯</span></div>`);
    }
    bar.innerHTML = tabs.join('');
    bar.querySelectorAll('.group-tab').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('group-tab-menu')) return;
        this.state.activeGroup = el.dataset.id;
        this.renderGroupBar();
        Render.renderList(this.state);
      });
    });
    bar.querySelectorAll('.group-tab-menu').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openGroupMenu(el.dataset.id);
      });
    });
  },

  async openGroupMenu(id) {
    const group = (this.state.groups || []).find(g => g.id === id);
    if (!group) return;
    const result = await this.promptAction({
      title: '编辑分组',
      value: group.name,
      confirmText: '保存',
      showDelete: true,
      deleteText: '删除分组',
    });
    if (result.type === 'cancel') return;
    if (result.type === 'delete') {
      const confirmed = await this.confirmAction({
        title: '删除分组',
        message: `确定删除分组 "${group.name}"?组内待办将移到 Default。`,
        confirmText: '删除',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await API.deleteGroup(id);
        await this.reload();
      } catch (e) { alert('删除分组失败:' + window.__tauriErrMsg(e)); }
      return;
    }
    const name = (result.value || '').trim();
    if (!name || name === group.name) return;
    try {
      await API.renameGroup(id, name);
      await this.reload();
    } catch (e) { alert('重命名失败:' + window.__tauriErrMsg(e)); }
  },

  async openGroupCreate() {
    const result = await this.promptAction({
      title: '新建分组',
      placeholder: '输入分组名称',
      confirmText: '创建',
    });
    const name = (result.value || '').trim();
    if (result.type !== 'submit' || !name) return;
    try {
      await API.createGroup(name);
      this.state.activeGroup = '__all__';
      await this.reload();
    } catch (e) { alert('新建分组失败:' + window.__tauriErrMsg(e)); }
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
    html.setAttribute('data-show-icons', s.showIcons === false ? 'false' : 'true');
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
    this.renderGroupBar();
  },

  // 乐观更新:立即改本地状态 + 重渲染,再异步发 API
  // 注:autoCollapseDone 的 expanded=false 由调用方放进 patch,这样后端也会保存
  applyLocalUpdate(id, patch) {
    const t = this.state.todos.find(x => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
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
    const parents = this.parentTodos();
    const shouldCollapse = parents.some(todo => todo.expanded !== false);
    const label = shouldCollapse ? '折叠全部' : '展开全部';
    button.innerHTML = shouldCollapse ? Icon.chevronsUp() : Icon.chevronsDown();
    button.title = label;
    button.setAttribute('aria-label', label);
    button.disabled = this.state.bulkExpandPending || parents.length === 0;
  },

  async toggleAllExpanded() {
    if (this.state.bulkExpandPending) return;
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

  async moveTodo(id, parentId, index) {
    const before = JSON.parse(JSON.stringify(this.state.todos));
    const moving = this.state.todos.find(t => t.id === id);
    if (!moving) return;

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
      const data = await API.moveTodo(id, parentId, index);
      this.state.todos = data.todos || [];
      Render.renderAll(this.state);
    } catch (e) {
      this.state.todos = before;
      Render.renderAll(this.state);
      alert('移动失败:' + window.__tauriErrMsg(e));
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
      if (did === rootId) Object.assign(patch, parentPatch);
      Object.assign(t, patch);
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
    this.renderSettingsModal();
    document.getElementById('settingsMask').hidden = false;
  },

  closeSettingsModal() {
    document.getElementById('settingsMask').hidden = true;
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
    this.renderSettingsModal();
  },

  renderSettingsModal() {
    const s = this.state.settings;
    const tab = this.state.settingsTab;
    document.querySelectorAll('.settings-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.tab === tab);
    });
    const content = document.getElementById('settingsContent');
    content.innerHTML = this._settingsTabHtml(tab, s);
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
      morandi: ['#6366f1', '#10b981', '#a855f7', '#dc2626', '#d97706', '#0891b2'],
      ocean: ['#0284c7', '#0891b2', '#0d9488', '#2563eb', '#4f46e5', '#7c3aed'],
    };
    const colors = palettes[name] || palettes.classic;
    const labels = { classic: '经典', morandi: '莫兰迪', ocean: '海洋' };
    return `<div class="palette-swatch ${name === currentValue ? 'active' : ''}" data-value="${name}" title="${labels[name] || name}">
      ${colors.map(c => `<span class="palette-dot" style="background:${c}"></span>`).join('')}
      <span class="palette-name">${labels[name] || name}</span>
    </div>`;
  },

  _iconSwatch(name, currentValue, label) {
    const url = `icons/icon_${name}.png`;
    return `<div class="icon-swatch ${name === currentValue ? 'active' : ''}" data-value="${name}" title="${label}">
      <img src="${url}" alt="${label}">
    </div>`;
  },

  _colorSwatch(value, label, from, to, currentValue) {
    const active = value === currentValue;
    const bg = to ? `linear-gradient(135deg, ${from}, ${to})` : from;
    return `<div class="color-swatch ${active ? 'active' : ''}" data-value="${value}" title="${label}">
      <span class="color-dot" style="background:${bg}"></span>
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

  _toggle(checked, onChange, title, desc) {
    return `<div class="switch-row">
      <div class="meta"><div class="title">${title}</div>${desc ? `<div class="desc">${desc}</div>` : ''}</div>
      <div class="toggle ${checked ? 'on' : ''}" data-onchange="${onChange}"></div>
    </div>`;
  },

  _settingsTabHtml(tab, s) {
    if (tab === 'appearance') {
      return `
        <div class="settings-content-title">外观</div>
        <div class="settings-content-desc">调整界面显示风格</div>
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
        <div class="settings-row">${this._toggle(s.compact, 'compact', '紧凑模式', '缩小行距显示更多内容')}</div>
        <div class="settings-row">${this._toggle(s.showIcons !== false, 'showIcons', '显示分类图标', '待办条目左侧显示图标')}</div>
        <div class="settings-row">${this._toggle(!!s.showNumbering, 'showNumbering', '显示任务编号', '按当前顺序编号,父待办显示子任务数')}</div>
        <div class="settings-row">${this._toggle(s.showTimePrecision === true, 'showTimePrecision', '显示具体时间', '开启后所有时间显示精确到分钟,关闭则只显示日期')}</div>
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
          </div>
        </div>
        <div class="settings-row">
          <label class="settings-row-label">应用图标</label>
          <div class="icon-picker" data-onchange="appIcon">
            ${this._iconSwatch('bf', s.appIcon, '日历带勾')}
            ${this._iconSwatch('b', s.appIcon, '纯对勾')}
          </div>
        </div>
      `;
    }
    if (tab === 'calendar') {
      return `
        <div class="settings-content-title">日历</div>
        <div class="settings-content-desc">日历视图相关选项</div>
        <div class="settings-row">
          <div class="settings-row-label">每周第一天</div>
          ${this._seg([
            {value:'monday',label:'周一'},{value:'sunday',label:'周日'}
          ], s.weekStart || 'monday', 'weekStart')}
        </div>
        <div class="settings-row">${this._toggle(!!s.showWeekNumber, 'showWeekNumber', '显示周数', '左侧显示当年第几周')}</div>
        <div class="settings-row">${this._toggle(s.showStartInCalendar !== false, 'showStartInCalendar', '显示开始任务', '在月历中显示任务的开始日期(同一天的开始/结束时间相同时也会显示)')}</div>
        <div class="settings-row">${this._toggle(s.showOngoingInCalendar !== false, 'showOngoingInCalendar', '显示进行中任务', '仅在跨天任务的中间日期显示(开始与截止同一天的任务不显示进行中)')}</div>
        <div class="settings-row">${this._toggle(s.showEndInCalendar !== false, 'showEndInCalendar', '显示截止任务', '在月历中显示任务的截止日期(同一天的开始/结束时间相同时也会显示)')}</div>
        <div class="settings-row">${this._toggle(s.showCalendarDone === true, 'showCalendarDone', '显示已完成任务', '在月历中显示已完成的待办(日详情页不受影响)')}</div>
        <div class="settings-row">${this._toggle(!!s.showLunar, 'showLunar', '显示农历', '日期格内显示农历日(简化版)')}</div>
        <div class="settings-row">
          <div class="settings-row-label">当天开始事件条颜色</div>
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
          <div class="settings-row-desc">自定义模式下,当天开始事件条使用白底+左色条+灰字(与进行中/截止风格一致)</div>
        </div>
      `;
    }
    if (tab === 'behavior') {
      return `
        <div class="settings-content-title">行为</div>
        <div class="settings-content-desc">日常操作行为偏好</div>
        <div class="settings-row">
          <div class="settings-row-label">新建待办默认时间</div>
          ${this._seg([
            {value:'none',label:'无'},{value:'09:00',label:'当天 09:00'},{value:'now',label:'当前时刻'}
          ], s.defaultStartTime || 'none', 'defaultStartTime')}
          <div class="settings-row-desc">新建时的默认开始时间(可在编辑时改)</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">排序方式</div>
          ${this._seg([
            {value:'auto',label:'自动排序'},{value:'manual',label:'手动排序'}
          ], s.sortMode || 'auto', 'sortMode')}
          <div class="settings-row-desc">自动排序按结束日期由近到远排列；手动排序可拖动调整顺序。自动模式下仅允许同截止日期内拖动微调</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">拖动模式</div>
          ${this._seg([
            {value:'sibling',label:'仅同级'},{value:'tree',label:'跨层移动'}
          ], s.dragMode || 'sibling', 'dragMode')}
          <div class="settings-row-desc">跨层模式下拖到条目中部可将其设为子待办。自动模式下跨层也要求同截止日期</div>
        </div>
        <div class="settings-row">${this._toggle(!!s.autoCollapseDone, 'autoCollapseDone', '勾选后折叠', '勾选完成时自动折叠该待办')}</div>
        <div class="settings-row">
          <div class="settings-row-label">待办点击行为</div>
          ${this._seg([
            {value:'edit',label:'编辑'},{value:'expand',label:'展开/折叠'}
          ], s.clickAction || 'edit', 'clickAction')}
          <div class="settings-row-desc">展开模式下父代办点击切换展开,叶子代办点击进入编辑,hover 显示铅笔图标</div>
        </div>
        <div class="settings-row">${this._toggle(!!s.showBulkAdd, 'showBulkAdd', '批量添加子代办', '在父待办行显示批量入口,共享开始与结束时间')}</div>
        <div class="settings-row">${this._toggle(s.showSingleAdd !== false, 'showSingleAdd', '单个添加子代办', '在父待办行显示 + 按钮,关闭后仅保留批量入口')}</div>
        <div class="settings-row">${this._toggle(s.enableGroups === true, 'enableGroups', '启用分组', '开启后顶部出现分组栏,可创建自定义分组(Default 为系统内置,不可删除)')}</div>
        <div class="settings-row">${this._toggle(s.deleteConfirm !== false, 'deleteConfirm', '删除前确认', '默认已开启,关闭后直接删除')}</div>
        <div class="settings-row">${this._toggle(!!s.autoSyncStart, 'autoSyncStart', '父代办开始随子代办更新', '新建/修改子代办时间时,父代办的开始时间自动取所有子代办中最早的')}</div>
        <div class="settings-row">${this._toggle(!!s.autoSyncEnd, 'autoSyncEnd', '父代办结束随子代办更新', '新建/修改子代办时间时,父代办的结束时间自动取所有子代办中最晚的')}</div>
        <div class="settings-row" style="padding:6px 10px;background:var(--hover-bg);border-radius:6px;font-size:11px;color:var(--muted);line-height:1.5">开启后,父代办时间会被强制覆盖;想保留独立时间请关闭开关。被同步过的父代办在编辑器里显示 ↺ 自动同步 标记。</div>
        <div class="settings-row">${this._toggle(s.autoArchive !== false, 'autoArchive', '自动归档', '完成指定天数后从活动视图移入归档记录')}</div>
        <div class="settings-row archive-days-row ${s.autoArchive === false ? 'disabled' : ''}">
          <label class="settings-row-label" for="archiveAfterDays">完成后归档</label>
          <div class="number-setting">
            <input id="archiveAfterDays" type="number" min="1" step="1" value="${Math.max(1, Number(s.archiveAfterDays) || 7)}" ${s.autoArchive === false ? 'disabled' : ''}>
            <span>天</span>
          </div>
          <div class="settings-row-desc">已完成分支的全部待办到期后统一归档</div>
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
        const patch = {};
        patch[onChange] = !s[onChange];
        Object.assign(s, patch);
        this.patchSettings(patch);
        this.renderSettingsModal();
      };
    });

    const archiveAfterDays = content.querySelector('#archiveAfterDays');
    if (archiveAfterDays) {
      archiveAfterDays.onchange = async () => {
        const days = Math.max(1, Math.trunc(Number(archiveAfterDays.value) || 7));
        archiveAfterDays.value = String(days);
        await this.patchSettings({ archiveAfterDays: days });
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
    document.getElementById('dayToggleExpand').onclick = () => this.toggleAllExpanded();
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
    if (btnGroupAdd) btnGroupAdd.onclick = () => this.openGroupCreate();
    document.getElementById('btnRangeCancel').onclick = () => this.closeRangeDeleteModal();
    document.getElementById('btnRangeConfirm').onclick = () => this.confirmRangeDelete();
    document.getElementById('rangeStart').oninput = () => this._refreshRangeCount();
    document.getElementById('rangeEnd').oninput = () => this._refreshRangeCount();
    document.getElementById('rangeField').onchange = () => this._refreshRangeCount();
    document.getElementById('rangeDeleteMask').onclick = (e) => {
      if (e.target.id === 'rangeDeleteMask') this.closeRangeDeleteModal();
    };
    document.getElementById('btnDeleteAllCancel').onclick = () => this.closeDeleteAllModal();
    document.getElementById('btnDeleteAllConfirm').onclick = () => this.confirmDeleteAll();
    document.getElementById('deleteAllMask').onclick = (e) => {
      if (e.target.id === 'deleteAllMask') this.closeDeleteAllModal();
    };

    // 弹窗
    document.getElementById('btnCancel').onclick = () => this.closeModal();
    document.getElementById('btnSave').onclick = () => this.saveModal();
    document.getElementById('btnDelete').onclick = () => this.deleteCurrent();
    document.getElementById('btnArchive').onclick = () => this.archiveCurrent();
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
    document.getElementById('modalMask').onclick = (e) => {
      if (e.target.id === 'modalMask') this.closeModal();
    };

    // 批量弹窗
    document.getElementById('btnBulkCancel').onclick = () => this.closeBulkModal();
    document.getElementById('btnBulkSave').onclick = () => this.saveBulkModal();
    document.getElementById('bulkMask').onclick = (e) => {
      if (e.target.id === 'bulkMask') this.closeBulkModal();
    };
    const fBulkTitles = document.getElementById('fBulkTitles');
    if (fBulkTitles) {
      fBulkTitles.oninput = () => this._refreshBulkCount();
    }

    // 批量新建树
    document.getElementById('btnTreeCancel').onclick = () => this.closeBulkTreeModal();
    document.getElementById('btnTreeSave').onclick = () => this.saveBulkTreeModal();
    document.getElementById('bulkTreeMask').onclick = (e) => {
      if (e.target.id === 'bulkTreeMask') this.closeBulkTreeModal();
    };
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
    document.getElementById('helpMask').onclick = (e) => { if (e.target.id === 'helpMask') this.closeHelp(); };
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
    document.getElementById('settingsMask').onclick = (e) => {
      if (e.target.id === 'settingsMask') this.closeSettingsModal();
    };

    document.getElementById('btnConfirmCancel').onclick = () => this.closeConfirm(false);
    document.getElementById('btnConfirmAccept').onclick = () => this.closeConfirm(true);
    document.getElementById('confirmMask').onclick = (e) => {
      if (e.target.id === 'confirmMask') this.closeConfirm(false);
    };

    const promptInput = document.getElementById('promptInput');
    document.getElementById('btnPromptCancel').onclick = () => this.closePrompt({ type: 'cancel', value: '' });
    document.getElementById('btnPromptAccept').onclick = () => this.closePrompt({ type: 'submit', value: promptInput.value });
    document.getElementById('btnPromptDelete').onclick = () => this.closePrompt({ type: 'delete', value: promptInput.value });
    document.getElementById('promptMask').onclick = (e) => {
      if (e.target.id === 'promptMask') this.closePrompt({ type: 'cancel', value: '' });
    };
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
    Render.renderAll(this.state);
  },

  closeDayView() {
    this.state.dayViewDate = null;
    Render.renderAll(this.state);
  },

  refreshParentSelect(excludeId) {
    const sel = document.getElementById('fParent');
    sel.innerHTML = '<option value="">(顶层)</option>';
    const byParent = Render.buildTree(this.state.todos);

    const indentStr = (depth) => '— '.repeat(depth);
    const walk = (parentId, depth) => {
      const kids = Render.getChildren(byParent, parentId);
      for (const k of kids) {
        if (k.id === excludeId) continue;
        const opt = document.createElement('option');
        opt.value = k.id;
        opt.textContent = indentStr(depth) + k.title;
        sel.appendChild(opt);
        walk(k.id, depth + 1);
      }
    };
    walk(null, 0);
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
    const startBadge = document.getElementById('fStartAutoBadge');
    const endBadge = document.getElementById('fEndAutoBadge');
    if (startBadge) startBadge.hidden = true;
    if (endBadge) endBadge.hidden = true;
    this.refreshParentSelect(null);
    if (opts.parentId) document.getElementById('fParent').value = opts.parentId;
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
    if (t.parentId) document.getElementById('fParent').value = t.parentId;
    document.getElementById('btnDelete').hidden = false;
    const btnArchive = document.getElementById('btnArchive');
    btnArchive.hidden = false;
    btnArchive.disabled = !t.done;
    btnArchive.title = t.done ? '' : '未完成的待办不允许归档';
    this.openModal();
  },

  openModal() {
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
  },

  async saveModal() {
    const title = document.getElementById('fTitle').value.trim();
    if (!title) { alert('请输入标题'); return; }
    const startRaw = document.getElementById('fStart').value;
    const endRaw = document.getElementById('fEnd').value;
    const parentId = document.getElementById('fParent').value || null;

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

    try {
      if (this.editingId) await API.update(this.editingId, body);
      else await API.create(body);
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
