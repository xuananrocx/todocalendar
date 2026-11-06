// 备忘录:独立于待办的长期速查信息(左侧分栏形态)。
// 渲染规则:正文 URL 匹配到链接列表 → 内联显示命名链接;未匹配 → 原样蓝链;
// 链接未出现在正文 → 正文下方芯片。保存时正文新 URL 自动收入链接列表。

function memoEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 裸 URL 识别(仅 http/https 前缀),排除中文括号引号等包裹符
const MEMO_URL_RE = /(https?:\/\/[^\s"'<>（）【】[{}]+)/g;
const MEMO_URL_TAIL_RE = /[)\]>.,;:!?。，、；：！？…）】》]+$/;

const Memo = {
  entries: [],
  editingId: null, // null = 新建
  _dragId: null,
  _popAllOpen: false, // 全部备忘弹层:一键展开全部条目
  windowMode: false, // true = 备忘小窗(独立窗口)运行环境

  async init() {
    this.bindEvents();
    await this.load();
  },

  async load() {
    try {
      const data = await API.listMemos();
      this.entries = data.entries || [];
    } catch (e) {
      console.warn('list_memos failed:', e);
      this.entries = [];
    }
    this.render();
  },

  // 设置驱动:侧栏/迷你卡片/分隔条/顶栏按钮/菜单项可见性 + 侧栏宽度
  applySettings(s) {
    const enabled = s.memoEnabled === true;
    const mode = ['mini', 'window'].includes(s.memoDisplayMode) ? s.memoDisplayMode : 'sidebar';
    const show = enabled && mode === 'sidebar' && s.memoSidebarOpen !== false;
    const showMini = enabled && mode === 'mini' && s.memoMiniOpen !== false;
    const side = document.getElementById('memoSide');
    const divider = document.getElementById('memoDivider');
    const mini = document.getElementById('memoMini');
    const btn = document.getElementById('btnMemo');
    const ddItem = document.getElementById('ddMemoItem');
    const layout = document.getElementById('memoLayout');
    if (layout) layout.classList.toggle('side-right', s.memoSidePosition === 'right');
    if (side) side.hidden = !show;
    if (divider) divider.hidden = !show;
    if (side && show) side.style.width = this._clampWidth(s.memoSidebarWidth) + 'px';
    if (mini) mini.hidden = !showMini;
    if (showMini) this.renderMini();
    else this.closeMiniPop();
    if (btn) btn.hidden = !(enabled && s.memoEntry === 'topbar');
    if (ddItem) ddItem.hidden = !(enabled && s.memoEntry !== 'topbar');
  },

  _clampWidth(w) {
    return Math.max(170, Math.min(420, Math.round(Number(w) || 230)));
  },

  render() {
    const list = document.getElementById('memoList');
    if (!list) return;
    const count = document.getElementById('memoCount');
    if (count) count.textContent = String(this.entries.length);
    if (!this.entries.length) {
      list.innerHTML = '<div class="memo-empty">还没有备忘<br>点右上角 + 新建一条</div>';
      return;
    }
    list.innerHTML = this.entries.map(e => this._itemHtml(e)).join('');
    Icon.render(list);
    this.renderMini();
  },

  // ===== 迷你卡片(右下角浮动,常显内容 memoMiniShow: none/pinned/all) =====
  renderMini() {
    const mini = document.getElementById('memoMini');
    if (!mini || mini.hidden) return;
    const s = Main.state.settings || {};
    const showMode = ['none', 'all'].includes(s.memoMiniShow) ? s.memoMiniShow : 'pinned';
    const barHidden = s.memoMiniBarHidden === true;
    const shown = showMode === 'all'
      ? [...this.entries].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
      : (showMode === 'pinned' ? this.entries.filter(e => e.pinned) : []);
    const stack = document.getElementById('memoMiniStack');
    stack.innerHTML = shown.length
      ? shown.map(e => this._miniCardHtml(e, showMode === 'all')).join('')
      : '';
    Icon.render(stack);
    const bar = document.getElementById('memoMiniBar');
    if (bar) bar.hidden = !shown.length || barHidden;
    const barToggle = document.getElementById('btnMemoMiniBarToggle');
    if (barToggle) {
      barToggle.hidden = shown.length === 0;
      barToggle.innerHTML = barHidden ? Icon.chevronsUp() : Icon.minimize();
      barToggle.title = barHidden ? '展开常显卡片栏' : '收起常显卡片栏';
    }
    const badge = document.getElementById('memoMiniBadge');
    badge.textContent = String(this.entries.length);
    badge.hidden = !this.entries.length;
    this.renderMiniPop();
  },

  _miniCardHtml(e, showPin = false) {
    return `<div class="memo-mini-card" data-id="${memoEsc(e.id)}">
      <div class="memo-item-head">
        ${showPin && e.pinned ? '<span class="memo-pin">置顶</span>' : ''}
        <span class="memo-item-title" title="${memoEsc(e.title)}">${memoEsc(e.title)}</span>
        <button class="memo-item-edit icon-btn" data-edit="${memoEsc(e.id)}" title="编辑">${Icon.pencil()}</button>
      </div>
      ${e.body || (e.links || []).length ? `<div class="memo-mini-card-body">${this._renderBody(e)}${this._chipsHtml(e)}</div>` : ''}
    </div>`;
  },

  renderMiniPop() {
    const popList = document.getElementById('memoMiniList');
    if (!popList) return;
    const open = this._popAllOpen === true;
    const colBtn = document.getElementById('btnMemoMiniCollapse');
    if (colBtn) {
      colBtn.innerHTML = open ? Icon.chevronsDownUp() : Icon.chevronsUpDown();
      colBtn.title = open ? '折叠全部条目' : '展开全部条目';
    }
    if (!this.entries.length) {
      popList.innerHTML = '<div class="memo-empty">还没有备忘<br>点右上角 + 新建一条</div>';
      return;
    }
    popList.innerHTML = this.entries.map(e => `
      <div class="memo-mini-row${open ? ' open' : ''}" data-id="${memoEsc(e.id)}">
        <div class="memo-mini-row-head">
          <i data-icon="chevronRight" class="memo-mini-chev"></i>
          <span class="memo-item-title" title="${memoEsc(e.title)}">${memoEsc(e.title)}</span>
          ${e.pinned ? '<span class="memo-pin">置顶</span>' : ''}
          <button class="memo-item-edit icon-btn" data-edit="${memoEsc(e.id)}" title="编辑">${Icon.pencil()}</button>
        </div>
        <div class="memo-mini-row-body"${open ? '' : ' hidden'}>${this._renderBody(e)}${this._chipsHtml(e)}</div>
      </div>`).join('');
    Icon.render(popList);
  },

  toggleMiniPop(force) {
    const pop = document.getElementById('memoMiniPop');
    if (!pop) return;
    const show = force !== undefined ? force : pop.hidden;
    pop.hidden = !show;
    if (show) this.renderMiniPop();
  },

  closeMiniPop() {
    const pop = document.getElementById('memoMiniPop');
    if (pop && !pop.hidden) pop.hidden = true;
  },

  _itemHtml(e) {
    return `<div class="memo-item" draggable="true" data-id="${memoEsc(e.id)}">
      <div class="memo-item-head">
        ${e.pinned ? '<span class="memo-pin">置顶</span>' : ''}
        <span class="memo-item-title" title="${memoEsc(e.title)}">${memoEsc(e.title)}</span>
        <button class="memo-item-edit icon-btn" data-edit="${memoEsc(e.id)}" title="编辑">${Icon.pencil()}</button>
      </div>
      ${e.body ? `<div class="memo-item-body">${this._renderBody(e)}</div>` : ''}
      ${this._chipsHtml(e)}
    </div>`;
  },

  // 正文渲染:原始文本上分段转义 + linkify,避免转义后的 &amp; 破坏 URL 匹配
  _renderBody(e) {
    const links = e.links || [];
    const used = new Set();
    const body = e.body || '';
    let html = '';
    let last = 0;
    let m;
    MEMO_URL_RE.lastIndex = 0;
    while ((m = MEMO_URL_RE.exec(body)) !== null) {
      let url = m[1];
      let tail = '';
      const t = url.match(MEMO_URL_TAIL_RE);
      if (t) { tail = t[0]; url = url.slice(0, url.length - tail.length); }
      if (!/^https?:\/\/.{2,}/.test(url)) continue;
      html += memoEsc(body.slice(last, m.index));
      const link = links.find(l => l.url === url && !used.has(l.url));
      if (link) {
        used.add(link.url);
        html += `<a class="memo-inline-link" data-url="${memoEsc(url)}" title="${memoEsc(url)}">${memoEsc(link.name || url)}</a>`;
      } else {
        html += `<a class="memo-inline-link raw" data-url="${memoEsc(url)}">${memoEsc(url)}</a>`;
      }
      html += memoEsc(tail);
      last = m.index + m[0].length;
    }
    html += memoEsc(body.slice(last));
    return html.replace(/\n/g, '<br>');
  },

  // 未出现在正文里的链接 → 芯片
  _chipsHtml(e) {
    const body = e.body || '';
    const rest = (e.links || []).filter(l => l.url && !body.includes(l.url));
    if (!rest.length) return '';
    return `<div class="memo-item-links">` + rest.map(l =>
      `<a class="memo-chip" data-url="${memoEsc(l.url)}" title="${memoEsc(l.url)}">${Icon.externalLink()}<span>${memoEsc(l.name || l.url)}</span></a>`
    ).join('') + `</div>`;
  },

  _domainOf(url) {
    try { return new URL(url).hostname; } catch { return url.slice(0, 24); }
  },

  // ===== 编辑弹窗 =====
  openEdit(id) {
    this.closeMiniPop();
    this.editingId = id || null;
    const e = id ? this.entries.find(x => x.id === id) : null;
    document.getElementById('memoEditTitle').textContent = e ? '编辑备忘' : '新建备忘';
    document.getElementById('fMemoTitle').value = e ? e.title : '';
    document.getElementById('fMemoBody').value = e ? (e.body || '') : '';
    document.getElementById('fMemoPinned').checked = e ? !!e.pinned : false;
    document.getElementById('btnMemoEntryDelete').hidden = !e;
    this._renderLinkRows(e ? (e.links || []).map(l => ({ name: l.name, url: l.url })) : []);
    document.getElementById('memoEditMask').hidden = false;
    setTimeout(() => document.getElementById('fMemoTitle').focus(), 0);
  },

  closeEdit() {
    document.getElementById('memoEditMask').hidden = true;
    this.editingId = null;
  },

  _renderLinkRows(links) {
    const box = document.getElementById('memoLinkRows');
    box.innerHTML = (links || []).map(l => `
      <div class="memo-link-row">
        <input type="text" class="memo-link-name" placeholder="名称" value="${memoEsc(l.name)}" maxlength="60">
        <input type="text" class="memo-link-url" placeholder="https:// 地址" value="${memoEsc(l.url)}">
        <button type="button" class="memo-link-del icon-btn" title="删除此链接">${Icon.x()}</button>
      </div>`).join('');
    Icon.render(box);
  },

  _readLinkRows() {
    return [...document.querySelectorAll('#memoLinkRows .memo-link-row')].map(row => ({
      name: row.querySelector('.memo-link-name').value.trim(),
      url: row.querySelector('.memo-link-url').value.trim(),
    })).filter(l => l.url);
  },

  async saveEdit() {
    const title = document.getElementById('fMemoTitle').value.trim();
    const body = document.getElementById('fMemoBody').value;
    if (!title) { await Main.alertAction({ message: '标题不能为空' }); return; }
    const links = this._readLinkRows();
    // 正文里识别到的新 URL 自动收入链接列表(名称默认域名)
    MEMO_URL_RE.lastIndex = 0;
    let m;
    while ((m = MEMO_URL_RE.exec(body)) !== null) {
      let url = m[1].replace(MEMO_URL_TAIL_RE, '');
      if (!/^https?:\/\/.{2,}/.test(url)) continue;
      if (!links.some(l => l.url === url)) links.push({ name: this._domainOf(url), url });
    }
    const cur = this.editingId ? this.entries.find(x => x.id === this.editingId) : null;
    const entry = {
      id: this.editingId || '',
      title,
      body,
      pinned: document.getElementById('fMemoPinned').checked,
      order: cur ? cur.order : 0,
      links,
    };
    try {
      const data = await API.saveMemoEntry(entry);
      this.entries = data.entries || [];
      this.render();
      this.closeEdit();
    } catch (e) {
      await Main.alertAction({ title: '保存失败', message: '保存备忘失败:' + window.__tauriErrMsg(e) });
    }
  },

  async deleteEdit() {
    if (!this.editingId) return;
    if (Main.state.settings?.deleteConfirm !== false) {
      const ok = await Main.confirmAction({
        title: '删除备忘',
        message: '确定删除这条备忘?此操作无法恢复。',
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const data = await API.deleteMemoEntry(this.editingId);
      this.entries = data.entries || [];
      this.render();
      this.closeEdit();
    } catch (e) {
      await Main.alertAction({ title: '删除失败', message: '删除备忘失败:' + window.__tauriErrMsg(e) });
    }
  },

  // ===== 事件绑定 =====
  bindEvents() {
    const list = document.getElementById('memoList');
    list.addEventListener('click', (e) => {
      const link = e.target.closest('a.memo-inline-link, a.memo-chip');
      if (link) {
        e.preventDefault();
        API.openExternal(link.dataset.url).catch(err => Main.alertAction({ title: '打开失败', message: '打开链接失败: ' + err }));
        return;
      }
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) this.openEdit(editBtn.dataset.edit);
    });

    document.getElementById('btnMemoAdd').onclick = () => this.openEdit(null);
    const collapseBtn = document.getElementById('btnMemoCollapse');
    if (collapseBtn) collapseBtn.onclick = () => Main.patchSettings({ memoSidebarOpen: false });
    document.getElementById('btnMemoEntryCancel').onclick = () => this.closeEdit();
    document.getElementById('btnMemoEntrySave').onclick = () => this.saveEdit();
    document.getElementById('btnMemoEntryDelete').onclick = () => this.deleteEdit();
    document.getElementById('btnMemoAddLink').onclick = () => {
      const box = document.getElementById('memoLinkRows');
      box.insertAdjacentHTML('beforeend', `
        <div class="memo-link-row">
          <input type="text" class="memo-link-name" placeholder="名称" maxlength="60">
          <input type="text" class="memo-link-url" placeholder="https:// 地址">
          <button type="button" class="memo-link-del icon-btn" title="删除此链接">${Icon.x()}</button>
        </div>`);
      Icon.render(box);
      box.lastElementChild.querySelector('.memo-link-name').focus();
    };
    document.getElementById('memoLinkRows').addEventListener('click', (e) => {
      const del = e.target.closest('.memo-link-del');
      if (del) del.closest('.memo-link-row').remove();
    });
    document.getElementById('memoEditMask').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.saveEdit();
      }
    });
    Main._attachMaskClose('memoEditMask', () => this.closeEdit());

    // 分隔条拖宽:拖动实时生效,松手落库(备忘小窗内无此元素)
    const divider = document.getElementById('memoDivider');
    const side = document.getElementById('memoSide');
    if (divider && side) {
      divider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      divider.setPointerCapture(e.pointerId);
      divider.classList.add('active');
      const startX = e.clientX;
      const startW = side.getBoundingClientRect().width;
      const dir = document.getElementById('memoLayout')?.classList.contains('side-right') ? -1 : 1;
      const move = (ev) => {
        side.style.width = this._clampWidth(startW + dir * (ev.clientX - startX)) + 'px';
      };
      const up = (ev) => {
        divider.releasePointerCapture(ev.pointerId);
        divider.classList.remove('active');
        divider.removeEventListener('pointermove', move);
        divider.removeEventListener('pointerup', up);
        Main.patchSettings({ memoSidebarWidth: this._clampWidth(startW + dir * (ev.clientX - startX)) });
      };
      divider.addEventListener('pointermove', move);
      divider.addEventListener('pointerup', up);
    });
    }

    // ===== 迷你卡片事件(备忘小窗内无此容器) =====
    const mini = document.getElementById('memoMini');
    if (mini) {
    document.getElementById('btnMemoMiniMore').onclick = (e) => {
      e.stopPropagation();
      this.toggleMiniPop();
    };
    document.getElementById('btnMemoMiniAdd').onclick = (e) => {
      e.stopPropagation();
      this.openEdit(null);
    };
    document.getElementById('btnMemoMiniHide').onclick = (e) => {
      e.stopPropagation();
      this.closeMiniPop();
      Main.patchSettings({ memoMiniOpen: false });
    };
    document.getElementById('btnMemoMiniCollapse').onclick = (e) => {
      e.stopPropagation();
      this._popAllOpen = !(this._popAllOpen === true);
      this.renderMiniPop();
    };
    document.getElementById('btnMemoMiniBarToggle').onclick = (e) => {
      e.stopPropagation();
      Main.patchSettings({ memoMiniBarHidden: !(Main.state.settings?.memoMiniBarHidden === true) });
    };
    document.addEventListener('click', (e) => {
      if (!mini.hidden && !mini.contains(e.target)) this.closeMiniPop();
    });
    const stack = document.getElementById('memoMiniStack');
    stack.addEventListener('click', (e) => {
      const link = e.target.closest('a.memo-inline-link, a.memo-chip');
      if (link) {
        e.preventDefault();
        API.openExternal(link.dataset.url).catch(err => Main.alertAction({ title: '打开失败', message: '打开链接失败: ' + err }));
        return;
      }
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) this.openEdit(editBtn.dataset.edit);
    });
    const popList = document.getElementById('memoMiniList');
    popList.addEventListener('click', (e) => {
      const link = e.target.closest('a.memo-inline-link, a.memo-chip');
      if (link) {
        e.preventDefault();
        API.openExternal(link.dataset.url).catch(err => Main.alertAction({ title: '打开失败', message: '打开链接失败: ' + err }));
        return;
      }
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) { e.stopPropagation(); this.openEdit(editBtn.dataset.edit); return; }
      const head = e.target.closest('.memo-mini-row-head');
      if (head) {
        const row = head.closest('.memo-mini-row');
        const body = row.querySelector('.memo-mini-row-body');
        body.hidden = !body.hidden;
        row.classList.toggle('open', !body.hidden);
      }
    });
    }

    // 列表内拖拽排序(置顶项始终压制非置顶,排序后自动归位)
    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.memo-item');
      if (!item) return;
      this._dragId = item.dataset.id;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', this._dragId); } catch {}
    });
    list.addEventListener('dragend', (e) => {
      const item = e.target.closest('.memo-item');
      if (item) item.classList.remove('dragging');
      this._dragId = null;
      list.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    });
    list.addEventListener('dragover', (e) => {
      if (!this._dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const item = e.target.closest('.memo-item');
      list.querySelectorAll('.drop-before,.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
      if (!item || item.dataset.id === this._dragId) return;
      const rect = item.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      item.classList.add(before ? 'drop-before' : 'drop-after');
    });
    list.addEventListener('drop', async (e) => {
      if (!this._dragId) return;
      e.preventDefault();
      const target = e.target.closest('.memo-item');
      const dragIdx = this.entries.findIndex(x => x.id === this._dragId);
      if (!target || dragIdx < 0 || target.dataset.id === this._dragId) return;
      const rect = target.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      let targetIdx = this.entries.findIndex(x => x.id === target.dataset.id);
      if (!before) targetIdx += 1;
      if (targetIdx > dragIdx) targetIdx -= 1;
      const next = this.entries.slice();
      const [moved] = next.splice(dragIdx, 1);
      next.splice(targetIdx, 0, moved);
      this.entries = next;
      this.render();
      try {
        const data = await API.reorderMemos(next.map(x => x.id));
        this.entries = data.entries || [];
      } catch (err) {
        await Main.alertAction({ title: '保存失败', message: '排序保存失败:' + window.__tauriErrMsg(err) });
      }
      this.render();
    });
  },
};
