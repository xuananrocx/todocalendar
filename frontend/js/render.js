const Render = {
  showTimePrecision: false,

  _hhmm(d) {
    const h = String(d.getHours()).padStart(2,'0');
    const m = String(d.getMinutes()).padStart(2,'0');
    return `${h}:${m}`;
  },

  _hasTime(d) {
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  },

  // 构建树:{ id -> children[] }
  buildTree(todos, sortMode = 'manual') {
    const byParent = new Map();
    const positions = new Map();
    for (const [position, t] of todos.entries()) {
      const k = t.parentId || '__root__';
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k).push(t);
      positions.set(t.id, position);
    }

    const manualCompare = (a, b) =>
      (a.order ?? 0) - (b.order ?? 0)
      || (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0);

    if (sortMode === 'auto') {
      const now = Date.now();
      const parseDeadline = (todo) => {
        const refIso = todo.endTime || todo.startTime;
        if (!refIso) return null;
        const date = new Date(refIso);
        if (Number.isNaN(date.getTime())) return null;
        const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
        return hasTime
          ? date.getTime()
          : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 0).getTime();
      };
      const deadlineRank = (todo, deadline) => {
        if (todo.done) return 5;
        if (deadline === null) return 4;
        const remaining = deadline - now;
        if (remaining < 0) return 0;
        if (remaining <= 24 * 60 * 60 * 1000) return 1;
        if (remaining <= 48 * 60 * 60 * 1000) return 2;
        return 3;
      };
      const autoCompare = (a, b) => {
        const aDeadline = parseDeadline(a);
        const bDeadline = parseDeadline(b);
        const rankDiff = deadlineRank(a, aDeadline) - deadlineRank(b, bDeadline);
        if (rankDiff !== 0) return rankDiff;
        if (aDeadline !== null && bDeadline !== null && aDeadline !== bDeadline) {
          return aDeadline - bDeadline;
        }
        if (aDeadline === null && bDeadline !== null) return 1;
        if (aDeadline !== null && bDeadline === null) return -1;
        return manualCompare(a, b);
      };
      for (const arr of byParent.values()) arr.sort(autoCompare);
    } else {
      for (const arr of byParent.values()) arr.sort(manualCompare);
    }
    return byParent;
  },

  getChildren(byParent, parentId) {
    return byParent.get(parentId || '__root__') || [];
  },

  // 找 todo 的根祖先 id
  getRootId(todos, todoId, byId = new Map(todos.map(t => [t.id, t]))) {
    let cur = byId.get(todoId);
    if (!cur) return todoId;
    const seen = new Set([todoId]);
    while (cur && cur.parentId) {
      if (seen.has(cur.parentId)) break;
      seen.add(cur.parentId);
      const next = byId.get(cur.parentId);
      if (!next) break;
      cur = next;
    }
    return cur.id;
  },

  startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  },

  makeLunarLabel(date) {
    try {
      const solar = Solar.fromDate(date);
      const lunar = solar.getLunar();
      const lunarFestivals = lunar.getFestivals() || [];
      const solarFestivals = solar.getFestivals() || [];
      const allFestivals = lunarFestivals.concat(solarFestivals);
      const jieqi = lunar.getJieQi();
      const isMonthStart = lunar.getDayInChinese() === '初一';

      const whitelist = new Set([
        '元旦', '春节', '元宵节', '清明节', '劳动节', '端午节',
        '儿童节', '母亲节', '父亲节', '建军节', '七夕节', '七夕',
        '教师节', '中秋节', '国庆节', '重阳节', '腊八节', '除夕',
        '情人节', '圣诞节', '护士节', '植树节', '青年节',
      ]);
      const blacklistPrefixes = ['世界', '国际', '全国', '全民', '全球', '第三世界'];
      const filtered = allFestivals.filter(name =>
        whitelist.has(name) || !blacklistPrefixes.some(p => name.startsWith(p))
      );

      const el = document.createElement('div');
      el.className = 'cal-lunar';
      let text = '';
      if (filtered.length > 0) {
        text = filtered[0];
        el.classList.add('festival');
      } else if (jieqi) {
        text = jieqi;
        el.classList.add('term');
      } else if (isMonthStart) {
        text = lunar.getMonthInChinese() + '月';
      } else {
        text = lunar.getDayInChinese();
      }
      el.textContent = text;
      return el;
    } catch (e) {
      return null;
    }
  },

  getTodoDayHit(todo, date) {
    const hits = Render.getTodoDayHits(todo, date);
    return hits[0] || null;
  },

  getTodoDayHits(todo, date) {
    if (!todo.startTime) return [];
    const start = new Date(todo.startTime);
    if (Number.isNaN(start.getTime())) return [];

    let end = null;
    if (todo.endTime) {
      const parsedEnd = new Date(todo.endTime);
      if (!Number.isNaN(parsedEnd.getTime()) && parsedEnd >= start) end = parsedEnd;
    }

    const targetDay = Render.startOfDay(date).getTime();
    const startDay = Render.startOfDay(start).getTime();
    const endDay = end ? Render.startOfDay(end).getTime() : startDay;
    if (targetDay < startDay || targetDay > endDay) return [];

    const hits = [];
    if (targetDay === startDay) {
      hits.push({ todo, kind: 'start', sortTime: start.getTime(), start, end });
    }
    if (end && targetDay === endDay) {
      hits.push({ todo, kind: 'end', sortTime: end.getTime(), start, end });
    }
    if (end && targetDay > startDay && targetDay < endDay) {
      hits.push({ todo, kind: 'ongoing', sortTime: end.getTime(), start, end });
    }
    if (hits.length === 0) {
      hits.push({ todo, kind: 'ongoing', sortTime: start.getTime(), start, end });
    }
    return hits;
  },

  compareDayHits(a, b) {
    const rank = { start: 0, end: 1, ongoing: 2 };
    return rank[a.kind] - rank[b.kind]
      || a.sortTime - b.sortTime
      || String(a.todo.id).localeCompare(String(b.todo.id));
  },

  getRootDayEntries(state, date) {
    const byId = new Map(state.todos.map(todo => [todo.id, todo]));
    const entries = new Map();

    for (const todo of state.todos) {
      const hits = Render.getTodoDayHits(todo, date);
      if (!hits.length) continue;
      const rootId = Render.getRootId(state.todos, todo.id, byId);
      const root = byId.get(rootId);
      if (!root) continue;
      if (!entries.has(rootId)) entries.set(rootId, { root, hits: [] });
      for (const hit of hits) {
        entries.get(rootId).hits.push(hit);
      }
    }

    return Array.from(entries.values()).map(entry => {
      entry.hits.sort(Render.compareDayHits);
      entry.hit = entry.hits[0];
      return entry;
    });
  },

  // 整棵子树(含自己)是否全部完成
  allDescendantsDone(byParent, todo) {
    if (!todo.done) return false;
    for (const k of Render.getChildren(byParent, todo.id)) {
      if (!Render.allDescendantsDone(byParent, k)) return false;
    }
    return true;
  },

  getDeadline(t) {
    const refIso = t.endTime || t.startTime;
    if (!refIso) return null;
    const ref = new Date(refIso);
    if (isNaN(ref.getTime())) return null;
    const hasTime = ref.getHours() !== 0 || ref.getMinutes() !== 0;
    return hasTime
      ? ref
      : new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 0);
  },

  isOverdue(t, now = new Date()) {
    if (t.done) return false;
    const deadline = Render.getDeadline(t);
    return deadline ? deadline < now : false;
  },

  deadlineClass(t, now = new Date()) {
    if (t.done) return '';
    const deadline = Render.getDeadline(t);
    if (!deadline) return '';
    const remaining = deadline.getTime() - now.getTime();
    if (remaining < 0) return 'deadline-overdue';
    if (remaining <= 24 * 60 * 60 * 1000) return 'deadline-urgent';
    if (remaining <= 48 * 60 * 60 * 1000) return 'deadline-warning';
    return 'deadline-safe';
  },

  hasTime(t) {
    if (!t.startTime) return false;
    const d = new Date(t.startTime);
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  },

  sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  },

  // 当年第几周(ISO-like,以 weekStart 决定起始)
  weekNumber(date, weekStart) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const jan1Day = jan1.getDay();
    const offset = weekStart === 'sunday' ? jan1Day : (jan1Day + 6) % 7;
    const firstMonday = new Date(jan1);
    firstMonday.setDate(jan1.getDate() - offset);
    const diff = Math.floor((d - firstMonday) / 86400000);
    return Math.floor(diff / 7) + 1;
  },

  // 把 ISO 时间转成 datetime-local 输入框的值(本地时区)
  isoToLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // date input (YYYY-MM-DD)
  isoToLocalDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  localDateToISO(val) {
    if (!val) return null;
    const d = new Date(val + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d.toISOString();
  },

  localInputToISO(val) {
    if (!val) return null;
    const d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  },

  // 显示标签(列表用)。优先 endTime(加"截止"前缀),没有则用 startTime
  formatTimeTag(t, now = new Date()) {
    const isEnd = !!t.endTime;
    const refIso = t.endTime || t.startTime;
    if (!refIso) return '';
    const d = new Date(refIso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`;

    const hasTime = this._hasTime(d) && this.showTimePrecision;
    const hhmm = hasTime ? ` ${this._hhmm(d)}` : '';
    const isOverdue = !t.done && Render.isOverdue(t, now);
    let prefix = '';
    if (isOverdue) {
      prefix = '过期 ';
    } else if (isEnd) {
      prefix = '截止 ';
    }
    return prefix + day + hhmm;
  },

  // 渲染列表(无筛选)
  renderGroupedList(state) {
    const tree = document.getElementById('tree');
    tree.innerHTML = '';
    const active = state.activeGroup || '__all__';
    const groups = [...(state.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

    const filterTodos = (key) => state.todos.filter((t) => {
      if (key === '__default__') return !t.groupId;
      return t.groupId === key;
    });

    if (active !== '__all__') {
      const filtered = filterTodos(active);
      this._renderTodosIntoContainer(state, tree, filtered);
      if (!tree.children.length) {
        const empty = document.createElement('div');
        empty.className = 'tree-empty';
        empty.textContent = '该分组暂无待办';
        tree.appendChild(empty);
      }
      Main.refreshExpandButton();
      return;
    }

    const renderOneGroup = (key, name) => {
      const todos = filterTodos(key);
      const card = document.createElement('div');
      card.className = 'group-card';
      if (!todos.length) card.classList.add('empty');
      const header = document.createElement('div');
      header.className = 'group-card-header';
      const titleEl = document.createElement('span');
      titleEl.className = 'group-card-title';
      titleEl.textContent = name;
      const countEl = document.createElement('span');
      countEl.className = 'group-card-count';
      const rootCount = todos.filter((t) => !t.parentId).length;
      countEl.textContent = `${rootCount} 项`;
      header.append(titleEl, countEl);
      const body = document.createElement('div');
      body.className = 'group-card-body';
      card.append(header, body);
      tree.appendChild(card);
      if (todos.length) {
        this._renderTodosIntoContainer(state, body, todos);
        if (!body.children.length) {
          const empty = document.createElement('div');
          empty.className = 'group-card-empty';
          empty.textContent = state.hideDone ? '该分组无可见待办' : '暂无待办';
          body.appendChild(empty);
        }
      } else {
        const empty = document.createElement('div');
        empty.className = 'group-card-empty';
        empty.textContent = '暂无待办';
        body.appendChild(empty);
      }
    };

    renderOneGroup('__default__', 'Default');
    for (const g of groups) renderOneGroup(g.id, g.name);
    if (!tree.children.length) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = '还没有任何分组';
      tree.appendChild(empty);
    }
    Main.refreshExpandButton();
  },

  // 内部:把 todos 渲染到 container(不清空 container, 不加 tree-empty, 不调 refreshExpandButton)
  _renderTodosIntoContainer(state, container, allTodos) {
    const todos = allTodos || state.todos;
    const sortMode = state.settings?.sortMode || 'auto';
    const dragDisabled = state.hideDone;
    const byParent = Render.buildTree(todos, sortMode);
    const today = new Date();
    let dragId = null;
    let blockedDropIds = new Set();

    const clearDropState = () => {
      container.querySelectorAll('.drop-before, .drop-after, .drop-inside').forEach(el => {
        el.classList.remove('drop-before', 'drop-after', 'drop-inside');
      });
    };

    const getDropPlacement = (target, row, event) => {
      if (!dragId || target.id === dragId || blockedDropIds.has(target.id)) return null;
      const dragged = state.todos.find(t => t.id === dragId);
      if (!dragged) return null;

      // 自动模式:跨 deadline 禁止拖动
      const getDeadlineMs = (todo) => {
        if (!todo) return null;
        const refIso = todo.endTime || todo.startTime;
        if (!refIso) return null;
        const date = new Date(refIso);
        if (Number.isNaN(date.getTime())) return null;
        const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
        return hasTime ? date.getTime() : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 0).getTime();
      };
      if (sortMode === 'auto') {
        const draggedDeadline = getDeadlineMs(dragged);
        const targetDeadline = getDeadlineMs(target);
        if (draggedDeadline !== targetDeadline) return null;
      }

      const rect = row.getBoundingClientRect();
      const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
      const mode = state.settings?.dragMode || 'sibling';
      let position;
      if (mode === 'tree' && ratio >= 0.25 && ratio <= 0.75) {
        position = 'inside';
      } else {
        position = ratio < 0.5 ? 'before' : 'after';
      }

      if (position === 'inside') {
        const children = Render.getChildren(byParent, target.id).filter(t => t.id !== dragId);
        return { parentId: target.id, index: children.length, position };
      }

      const parentId = target.parentId || null;
      if (mode === 'sibling' && (dragged.parentId || null) !== parentId) return null;
      const siblings = Render.getChildren(byParent, parentId).filter(t => t.id !== dragId);
      const targetIndex = siblings.findIndex(t => t.id === target.id);
      if (targetIndex < 0) return null;
      return {
        parentId,
        index: targetIndex + (position === 'after' ? 1 : 0),
        position,
      };
    };

    container.classList.toggle('drag-disabled', dragDisabled);
    container.ondragleave = (event) => {
      if (!container.contains(event.relatedTarget)) clearDropState();
    };

    function walk(parentId, depth, path = []) {
      const kids = Render.getChildren(byParent, parentId);
      let idx = 0;
      for (const node of kids) {
        if (state.hideDone && node.done) continue;
        idx++;
        const nodePath = [...path, idx];
        container.appendChild(makeRow(node, depth, nodePath));
        if (node.expanded !== false) {
          walk(node.id, depth + 1, nodePath);
        }
      }
    }

    function makeRow(node, depth, path = []) {
      const row = document.createElement('div');
      row.className = 'node';
      row.dataset.id = node.id;
      const children = Render.getChildren(byParent, node.id);
      const hasChildren = children.length > 0;
      if (hasChildren) row.classList.add('has-children');
      if (depth === 0) row.classList.add('is-root-parent');
      if (state.highlightId === node.id) row.classList.add('highlight');

      const indent = document.createElement('span');
      indent.className = 'indent';
      indent.style.width = (depth * 16) + 'px';

      const dragHandle = document.createElement('span');
      dragHandle.className = 'drag-handle';
      dragHandle.innerHTML = Icon.gripVertical();
      dragHandle.draggable = !dragDisabled;
      dragHandle.title = state.hideDone
        ? '显示已完成后可拖动排序'
        : sortMode === 'auto'
          ? '自动模式下仅允许同 deadline 内拖动'
          : '拖动排序';
      dragHandle.ondragstart = (event) => {
        if (dragDisabled) {
          event.preventDefault();
          return;
        }
        dragId = node.id;
        blockedDropIds = new Set(Main.collectDescendants(node.id));
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', node.id);

        const rect = row.getBoundingClientRect();
        const preview = row.cloneNode(true);
        preview.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-inside');
        preview.classList.add('drag-preview');
        preview.style.width = `${rect.width}px`;
        document.body.appendChild(preview);
        event.dataTransfer.setDragImage(
          preview,
          Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
          Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
        );
        setTimeout(() => preview.remove(), 0);
        row.classList.add('dragging');
      };
      dragHandle.ondragend = () => {
        dragId = null;
        blockedDropIds.clear();
        row.classList.remove('dragging');
        clearDropState();
      };
      // 批量模式:selection cb 放在最左(不跟随 indent 缩进)
      if (state.bulkMode) {
        const selCb = document.createElement('span');
        selCb.className = 'selection-cb' + (state.bulkSelected && state.bulkSelected.has(node.id) ? ' checked' : '');
        selCb.title = '选中此项';
        selCb.onclick = (e) => {
          e.stopPropagation();
          Main.toggleBulkSelect(node.id);
        };
        row.appendChild(selCb);
        row.onclick = () => Main.toggleBulkSelect(node.id);
        row.style.cursor = 'pointer';
      }

      row.appendChild(dragHandle);
      row.appendChild(indent);

      row.ondragover = (event) => {
        const placement = getDropPlacement(node, row, event);
        clearDropState();
        if (!placement) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add(`drop-${placement.position}`);
      };
      row.ondrop = (event) => {
        const placement = getDropPlacement(node, row, event);
        clearDropState();
        if (!placement) return;
        event.preventDefault();
        const movingId = dragId;
        dragId = null;
        blockedDropIds.clear();
        Main.moveTodo(movingId, placement.parentId, placement.index);
      };

      const arrow = document.createElement('span');
      arrow.className = 'arrow' + (hasChildren ? '' : ' empty');
      if (hasChildren) {
        arrow.innerHTML = node.expanded === false ? Icon.chevronRight() : Icon.chevronDown();
        arrow.onclick = (e) => {
          e.stopPropagation();
          const newExpanded = node.expanded === false;
          Main.applyLocalUpdate(node.id, { expanded: newExpanded });
          Main.sendUpdate(node.id, { expanded: newExpanded });
        };
      }
      row.appendChild(arrow);

      const cb = document.createElement('span');
      cb.className = 'checkbox' + (node.done ? ' checked' : '');
      cb.onclick = (e) => {
        e.stopPropagation();
        const newDone = !node.done;
        const patch = { done: newDone };
        if (newDone && Main.state.settings && Main.state.settings.autoCollapseDone) {
          patch.expanded = false;
        }
        // 父代办勾选 → 联动所有后代;叶子代办 → 单条更新
        if (hasChildren) {
          Main.cascadeDone(node.id, newDone, patch);
        } else {
          Main.applyLocalUpdate(node.id, patch);
          Main.sendUpdate(node.id, patch);
        }
      };
      row.appendChild(cb);

      const settings = state.settings || {};
      if (settings.showNumbering && path.length > 0) {
        const pill = document.createElement('span');
        const wbsStyle = settings.numberingStyle === 'wbs';
        pill.className = 'num-pill depth-' + ((depth % 6) + 1) + (node.done ? ' done' : '');
        pill.textContent = wbsStyle ? path.join('.') : String(path[path.length - 1]);
        pill.title = wbsStyle ? '' : path.join('.');
        row.appendChild(pill);
      }

      const title = document.createElement('span');
      title.className = 'title' + (node.done ? ' done' : '');
      if (Render.isOverdue(node, today)) title.classList.add('overdue');
      title.textContent = node.title;
      const expandMode = (settings.clickAction || 'edit') === 'expand';
      if (expandMode && hasChildren) {
        row.onclick = () => {
          const newExpanded = node.expanded === false;
          Main.applyLocalUpdate(node.id, { expanded: newExpanded });
          Main.sendUpdate(node.id, { expanded: newExpanded });
        };
        row.style.cursor = 'pointer';
      } else {
        row.onclick = () => Main.openEdit(node.id);
        row.style.cursor = 'pointer';
      }
      row.appendChild(title);

      const notesMode = settings.notesDisplay || 'none';
      const hasNotes = !!(node.notes && node.notes.trim());
      if (hasNotes && notesMode !== 'none') {
        if (notesMode === 'hover') {
          const ic = document.createElement('span');
          ic.className = 'notes-icon';
          ic.innerHTML = window.Icon.messageSquare();
          row.appendChild(ic);
          let hoverTimer = null;
          let tipEl = null;
          const showTip = () => {
            hideTip();
            const rect = title.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            tipEl = document.createElement('div');
            tipEl.className = 'notes-tooltip';
            const head = document.createElement('div');
            head.className = 'notes-tooltip-head';
            head.textContent = '备注';
            const body = document.createElement('div');
            body.className = 'notes-tooltip-body';
            body.textContent = node.notes;
            tipEl.appendChild(head);
            tipEl.appendChild(body);
            document.body.appendChild(tipEl);
            tipEl.style.top = (rect.bottom + 6 + window.scrollY) + 'px';
            tipEl.style.left = (rect.left + window.scrollX) + 'px';
          };
          const hideTip = () => {
            if (tipEl) { tipEl.remove(); tipEl = null; }
          };
          title.addEventListener('mouseenter', () => {
            hoverTimer = setTimeout(showTip, 500);
          });
          title.addEventListener('mouseleave', () => {
            if (hoverTimer) clearTimeout(hoverTimer);
            hoverTimer = null;
            hideTip();
          });
          title.addEventListener('click', () => {
            if (hoverTimer) clearTimeout(hoverTimer);
            hoverTimer = null;
            hideTip();
          }, true);
          ic.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(node.notes);
            } catch (err) {}
            hideTip();
            if (hoverTimer) clearTimeout(hoverTimer);
            hoverTimer = null;
            const toast = document.createElement('div');
            toast.className = 'notes-copy-toast';
            toast.textContent = '已复制备注信息';
            document.body.appendChild(toast);
            const r = ic.getBoundingClientRect();
            toast.style.top = (r.bottom + 6 + window.scrollY) + 'px';
            toast.style.left = (r.left + r.width / 2 + window.scrollX) + 'px';
            setTimeout(() => toast.remove(), 1500);
          });
        } else if (notesMode === 'inline' || notesMode === 'inline-plain') {
          const wrap = document.createElement('span');
          wrap.className = 'notes-inline-wrap';
          const plain = (node.notes || '').replace(/[#*`>_\-\[\]\(\)!]/g, '').replace(/\s+/g, ' ').trim();
          if (notesMode === 'inline') {
            const badge = document.createElement('span');
            badge.className = 'notes-inline-badge';
            badge.textContent = '备注';
            wrap.appendChild(badge);
          }
          const text = document.createElement('span');
          text.className = 'notes-inline-text';
          text.textContent = plain.length > 30 ? plain.slice(0, 30) + '…' : plain;
          wrap.appendChild(text);
          wrap.title = node.notes;
          row.appendChild(wrap);
        }
      }

      if (settings.showNumbering && hasChildren) {
        const visibleKids = Render.getChildren(byParent, node.id)
          .filter(k => !(state.hideDone && k.done));
        const badge = document.createElement('span');
        badge.className = 'child-count' + (node.done ? ' done' : '');
        badge.textContent = visibleKids.length + '项';
        row.appendChild(badge);
      }

      const tag = Render.formatTimeTag(node, today);
      if (tag) {
        const t = document.createElement('span');
        t.className = 'time-tag';
        if (node.done) {
          t.classList.add('done');
        } else {
          const deadlineClass = Render.deadlineClass(node, today);
          if (deadlineClass) t.classList.add(deadlineClass);
        }
        t.textContent = tag;
        row.appendChild(t);
      }

      const addSub = document.createElement('span');
      addSub.className = 'add-sub';
      addSub.title = '添加子代办';
      addSub.setAttribute('role', 'button');
      addSub.setAttribute('aria-label', '添加子代办');
      addSub.innerHTML = window.Icon.plus();
      addSub.onclick = (e) => {
        e.stopPropagation();
        Main.openCreate({ parentId: node.id });
      };

      if (expandMode) {
        const editBtn = document.createElement('span');
        editBtn.className = 'add-sub edit-btn';
        editBtn.title = '编辑';
        editBtn.setAttribute('role', 'button');
        editBtn.setAttribute('aria-label', '编辑');
        editBtn.innerHTML = window.Icon.pencil();
        editBtn.onclick = (e) => {
          e.stopPropagation();
          Main.openEdit(node.id);
        };
        row.appendChild(editBtn);
      }

      if (Main.state.settings?.showBulkAdd) {
        const bulk = document.createElement('span');
        bulk.className = 'add-sub add-bulk';
        bulk.title = '批量添加子代办';
        bulk.setAttribute('role', 'button');
        bulk.setAttribute('aria-label', '批量添加子代办');
        bulk.innerHTML = window.Icon.listPlus();
        bulk.onclick = (e) => {
          e.stopPropagation();
          Main.openBulkCreate({ parentId: node.id });
        };
        row.appendChild(bulk);
      }

      if (Main.state.settings?.showSingleAdd !== false) {
        row.appendChild(addSub);
      }

      return row;
    }

    walk(null, 0);
  },

  renderList(state) {
    if (state.settings?.enableGroups) {
      this.renderGroupedList(state);
      return;
    }
    const tree = document.getElementById('tree');
    tree.innerHTML = '';
    this._renderTodosIntoContainer(state, tree, state.todos);
    if (!tree.children.length) {
      const empty = document.createElement('div');
      empty.className = 'tree-empty';
      empty.textContent = '还没有待办,点右上角 "+ 新建待办" 开始';
      tree.appendChild(empty);
    }
    Main.refreshExpandButton();
  },

  renderStats(state) {
    const stats = document.getElementById('stats');
    const total = state.todos.length;
    const done = state.todos.filter(t => t.done).length;
    const overdue = state.todos.filter(t => Render.isOverdue(t)).length;
    const inProgress = total - done - overdue;
    const style = (state.settings && state.settings.statsStyle) || 'text';
    stats.className = `stats stats-${style}`;
    stats.textContent = '';
    if (style === 'chip') {
      const chip = (label, num, cls) => {
        const el = document.createElement('span');
        el.className = `stats-chip ${cls}`;
        el.innerHTML = `<span class="stats-chip-label">${label}</span><span class="stats-chip-num">${num}</span>`;
        return el;
      };
      stats.appendChild(chip('待办', total, 'stats-chip-total'));
      stats.appendChild(chip('完成', done, 'stats-chip-done'));
      if (inProgress > 0) stats.appendChild(chip('进行中', inProgress, 'stats-chip-doing'));
      if (overdue > 0) stats.appendChild(chip('过期', overdue, 'stats-chip-over'));
      return;
    }
    if (style === 'bar') {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const doingPct = total > 0 ? Math.round((inProgress / total) * 100) : 0;
      const overPct = total > 0 ? Math.round((overdue / total) * 100) : 0;
      const bar = document.createElement('div');
      bar.className = 'stats-bar';
      bar.innerHTML = `
        <div class="stats-bar-track"></div>
        <div class="stats-bar-text">
          <span class="stats-bar-pct">${pct}%</span>
          <span class="stats-bar-legend">
            <span><i style="background:var(--stats-done)"></i>完成 ${done}</span>
            <span><i style="background:var(--stats-doing)"></i>进行 ${inProgress}</span>
            ${overdue ? `<span><i style="background:var(--stats-over)"></i>过期 ${overdue}</span>` : ''}
          </span>
        </div>
      `;
      bar.title = `待办共 ${total} 项\n✓ 完成 ${done}\n◐ 进行中 ${inProgress}${overdue ? `\n⚠ 过期 ${overdue}` : ''}`;
      stats.appendChild(bar);
      return;
    }
    stats.textContent = `${total} 待办 · ${done} 完成${inProgress > 0 ? ` · ${inProgress} 进行中` : ''}${overdue ? ` · ${overdue} 过期` : ''}`;
  },

  renderCalendar(state) {
    const grid = document.getElementById('calGrid');
    grid.innerHTML = '';
    const weekStart = (state.settings && state.settings.weekStart) || 'monday';
    const showWeekNum = !!(state.settings && state.settings.showWeekNumber);
    const weekdaysCN = ['日','一','二','三','四','五','六'];
    const ordered = weekStart === 'sunday'
      ? weekdaysCN
      : weekdaysCN.slice(1).concat(weekdaysCN[0]);
    const weekendSet = new Set(weekStart === 'sunday' ? ['六','日'] : ['六','日']);
    for (const w of ordered) {
      const el = document.createElement('div');
      el.className = 'dw' + (weekendSet.has(w) ? ' weekend' : '');
      el.textContent = w;
      grid.appendChild(el);
    }

    const view = state.calMonth;
    const year = view.getFullYear();
    const month = view.getMonth();
    const firstDay = new Date(year, month, 1);
    const sundayIdx = firstDay.getDay();
    const firstWeekday = weekStart === 'sunday'
      ? sundayIdx
      : (sundayIdx + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const prevDays = new Date(year, month, 0).getDate();
    const cells = [];
    for (let i = firstWeekday - 1; i >= 0; i--) {
      cells.push({ date: new Date(year, month - 1, prevDays - i), other: true });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), other: false });
    }
    while (cells.length % 7 !== 0 || cells.length < 42) {
      const last = cells[cells.length - 1].date;
      cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), other: true });
      if (cells.length >= 42) break;
    }

    const today = new Date();
    const byParent = Render.buildTree(
      state.todos,
      state.settings?.sortMode || 'auto'
    );

    for (let idx = 0; idx < cells.length; idx++) {
      const c = cells[idx];
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      if (c.other) cell.classList.add('other-month');
      if (Render.sameDay(c.date, today)) cell.classList.add('today');
      if (state.dayViewDate && Render.sameDay(c.date, state.dayViewDate)) cell.classList.add('selected');
      const wc = state.settings?.weekendColor;
      const hc = state.settings?.holidayColor;
      const holidays = state.holidays || {};
      const dateStr = `${c.date.getFullYear()}-${String(c.date.getMonth() + 1).padStart(2, '0')}-${String(c.date.getDate()).padStart(2, '0')}`;
      const holiday = holidays[dateStr];
      const isWorkingdayOverride = holiday && !holiday.isOffDay; // 调休上班日
      const isOffHoliday = holiday && holiday.isOffDay; // 法定假日
      if (hc && hc !== 'none' && isOffHoliday) {
        cell.classList.add('holiday', hc);
      } else if (wc && wc !== 'none' && !isWorkingdayOverride) {
        const dow = c.date.getDay();
        if (dow === 0 || dow === 6) cell.classList.add('weekend', wc);
      }

      // 周数角标(每行第一个)
      if (showWeekNum && idx % 7 === 0) {
        const wn = document.createElement('div');
        wn.className = 'cal-week-num';
        wn.textContent = 'W' + Render.weekNumber(c.date, weekStart);
        cell.appendChild(wn);
      }

      const dateEl = document.createElement('div');
      dateEl.className = 'cal-date';
      dateEl.textContent = c.date.getDate();
      cell.appendChild(dateEl);

      if (state.settings?.showLunar && typeof Solar !== 'undefined' && Solar && Solar.fromDate) {
        const lunarEl = Render.makeLunarLabel(c.date);
        if (lunarEl) cell.appendChild(lunarEl);
      }

      const dayEntries = Render.getRootDayEntries(state, c.date);
      const childMode = state.settings?.calendarChildDisplay || 'main-only';
      const visibleHits = [];
      const dedupMap = new Map();
      for (const entry of dayEntries) {
        if (state.settings?.showCalendarDone === false && Render.allDescendantsDone(byParent, entry.root)) {
          continue;
        }
        for (const hit of entry.hits) {
          if (hit.kind === 'start' && state.settings?.showStartInCalendar === false) continue;
          if (hit.kind === 'ongoing' && state.settings?.showOngoingInCalendar === false) continue;
          if (hit.kind === 'end' && state.settings?.showEndInCalendar === false) continue;
          if (hit.todo.id !== entry.root.id && hit.todo.done) continue;
          if (childMode === 'main-only') {
            if (hit.todo.id !== entry.root.id) continue;
            visibleHits.push({ root: entry.root, hit });
          } else if (childMode === 'current') {
            const key = `${entry.root.id}-${hit.kind}`;
            const isRootTodo = hit.todo.id === entry.root.id;
            const existing = dedupMap.get(key);
            if (!existing || (!existing.isRootTodo && isRootTodo)) {
              dedupMap.set(key, { root: entry.root, hit, isRootTodo });
            }
          } else {
            visibleHits.push({ root: entry.root, hit });
          }
        }
      }
      if (childMode === 'current') {
        for (const v of dedupMap.values()) {
          visibleHits.push({ root: v.root, hit: v.hit });
        }
      }
      visibleHits.sort((a, b) =>
        Render.compareDayHits(a.hit, b.hit)
        || String(a.root.id).localeCompare(String(b.root.id))
      );
      const gridWidth = grid.clientWidth;
      const showMax = gridWidth <= 560 ? 1 : gridWidth <= 760 ? 2 : 3;
      const maxRows = showMax + 1;
      const ordinary = visibleHits.filter(v => v.hit.kind === 'start');
      const interval = visibleHits.filter(v => v.hit.kind !== 'start');
      const visible = ordinary.slice(0, showMax);
      for (const v of interval) {
        if (visible.length >= maxRows) break;
        visible.push(v);
      }
      visible.sort((a, b) =>
        Render.compareDayHits(a.hit, b.hit)
        || String(a.root.id).localeCompare(String(b.root.id))
      );
      if (visible.length < visibleHits.length && visible.length === maxRows) {
        visible.pop();
      }

      const pad = value => String(value).padStart(2, '0');
      for (const entry of visible) {
        const { root, hit } = entry;
        const ev = document.createElement('div');
        ev.className = `cal-event interval-${hit.kind}`;
        if (root.done) ev.classList.add('done');
        const isOverdue = Render.isOverdue(root, today);

        const isRootHit = hit.todo.id === root.id;
        let displayTitle = root.title;
        if (!isRootHit) {
          if (childMode === 'main-child') displayTitle = `${root.title}--${hit.todo.title}`;
          else if (childMode === 'child-main') displayTitle = `${hit.todo.title}--${root.title}`;
        }

        let prefix = '进行中 ';
        if (hit.kind === 'start') {
          const showTime = Render.showTimePrecision && (hit.start.getHours() !== 0 || hit.start.getMinutes() !== 0);
          prefix = showTime ? `开始 ${pad(hit.start.getHours())}:${pad(hit.start.getMinutes())} ` : '开始 ';
        } else if (hit.kind === 'end') {
          const showTime = Render.showTimePrecision && (hit.end.getHours() !== 0 || hit.end.getMinutes() !== 0);
          prefix = showTime ? `截止 ${pad(hit.end.getHours())}:${pad(hit.end.getMinutes())} ` : '截止 ';
        }
        if (isOverdue) {
          const tag = document.createElement('span');
          tag.className = 'cal-event-overdue-tag';
          tag.textContent = '⚠ 已过期 ';
          ev.appendChild(tag);
          const title = document.createElement('span');
          title.textContent = prefix + displayTitle;
          ev.appendChild(title);
          ev.title = `⚠ 已过期 ${prefix}${displayTitle}`;
        } else {
          ev.textContent = prefix + displayTitle;
          ev.title = `${prefix}${displayTitle}`;
        }
        cell.appendChild(ev);
      }

      const hiddenCount = visibleHits.length - visible.length;
      if (hiddenCount > 0) {
        const more = document.createElement('div');
        more.className = 'cal-more';
        more.textContent = `还有 ${hiddenCount} 项`;
        more.onclick = (e) => {
          e.stopPropagation();
          Main.openDayView(c.date);
        };
        cell.appendChild(more);
      }

      cell.onclick = () => Main.openDayView(c.date);
      grid.appendChild(cell);
    }

    document.getElementById('monthLabel').textContent =
      `${year} 年 ${month + 1} 月`;
  },

  // 渲染日视图
  renderDayView(state) {
    const view = document.getElementById('dayView');
    if (!state.dayViewDate) {
      view.hidden = true;
      return;
    }
    view.hidden = false;

    const d = state.dayViewDate;
    const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
    const byParent = Render.buildTree(
      state.todos,
      state.settings?.sortMode || 'auto'
    );
    const dayEntries = Render.getRootDayEntries(state, d);
    dayEntries.sort((a, b) =>
      Render.compareDayHits(a.hit, b.hit)
      || String(a.root.id).localeCompare(String(b.root.id))
    );

    const total = dayEntries.length;
    const done = dayEntries.filter(entry => Render.allDescendantsDone(byParent, entry.root)).length;
    const overdue = dayEntries.filter(entry => Render.isOverdue(entry.hit.todo)).length;

    document.getElementById('dayTitle').textContent =
      `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
    document.getElementById('dayMeta').textContent =
      `${total} 组待办 · ${done} 完成${(total - done - overdue) > 0 ? ` · ${total - done - overdue} 进行中` : ''}${overdue ? ` · ${overdue} 过期` : ''}`;

    const body = document.getElementById('dayBody');
    body.innerHTML = '';

    if (!total) {
      const empty = document.createElement('div');
      empty.className = 'day-empty';
      empty.textContent = '当天没有安排';
      body.appendChild(empty);
      return;
    }

    const today = new Date();
    const parseTime = (iso) => (iso ? new Date(iso).getTime() : 0);
    const byRootStart = (a, b) =>
      parseTime(a.root.startTime) - parseTime(b.root.startTime)
      || String(a.root.id).localeCompare(String(b.root.id));
    const byRootEnd = (a, b) =>
      parseTime(a.root.endTime || a.root.startTime) - parseTime(b.root.endTime || b.root.startTime)
      || String(a.root.id).localeCompare(String(b.root.id));

    const groups = {
      start: dayEntries.filter(entry => entry.hit.kind === 'start').sort(byRootStart),
      end: dayEntries.filter(entry => entry.hit.kind === 'end').sort(byRootEnd),
      ongoing: dayEntries.filter(entry => entry.hit.kind === 'ongoing' && !entry.root.done).sort(byRootEnd),
    };

    function makeCb(todo) {
      const cb = document.createElement('span');
      cb.className = 'day-cb' + (todo.done ? ' checked' : '');
      cb.onclick = (e) => {
        e.stopPropagation();
        const newDone = !todo.done;
        const patch = { done: newDone };
        if (newDone && Main.state.settings && Main.state.settings.autoCollapseDone) {
          patch.expanded = false;
        }
        // 父代办勾选 → 联动后代
        const hasKids = Render.getChildren(byParent, todo.id).length > 0;
        if (hasKids) {
          Main.cascadeDone(todo.id, newDone, patch);
        } else {
          Main.applyLocalUpdate(todo.id, patch);
          Main.sendUpdate(todo.id, patch);
        }
      };
      return cb;
    }

    function makeLabel(todo) {
      const label = document.createElement('span');
      label.className = 'day-label' + (todo.done ? ' done' : '');
      if (Render.isOverdue(todo, today)) label.classList.add('overdue');
      label.textContent = todo.title;
      return label;
    }

    function makeOverdueTag(todo) {
      if (!Render.isOverdue(todo, today)) return null;
      const tag = document.createElement('span');
      tag.className = 'day-tag';
      tag.textContent = '过期';
      return tag;
    }

    function formatNodeRange(todo) {
      if (!todo.startTime) return '未安排';
      const start = new Date(todo.startTime);
      if (Number.isNaN(start.getTime())) return '未安排';

      const pad = value => String(value).padStart(2, '0');
      const showTime = Render.showTimePrecision;
      const format = (date) => {
        const year = date.getFullYear() === d.getFullYear() ? '' : `${date.getFullYear()}年`;
        const day = `${year}${date.getMonth() + 1}月${date.getDate()}日`;
        if (!showTime) return day;
        const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
        return hasTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
      };

      if (!todo.endTime) return format(start);
      const end = new Date(todo.endTime);
      if (Number.isNaN(end.getTime()) || end < start) return format(start);
      return `${format(start)} - ${format(end)}`;
    }

    function makeNodeDate(todo, hit) {
      const date = document.createElement('span');
      date.className = 'day-node-date' + (hit ? ' current' : '');
      date.textContent = formatNodeRange(todo);
      return date;
    }

    function makeHitTag(hit) {
      if (!hit) return null;
      const labels = { start: '开始', ongoing: '进行中', end: '截止' };
      const tag = document.createElement('span');
      tag.className = `day-hit-tag interval-${hit.kind}`;
      tag.textContent = labels[hit.kind];
      return tag;
    }

    function decorateRow(row, todo) {
      const hit = Render.getTodoDayHit(todo, d);
      if (hit) row.classList.add('day-match', `interval-${hit.kind}`);
      if (Render.isOverdue(todo, today)) row.classList.add('overdue-now');
      // 折叠箭头(有子才显示)
      const hasChildren = Render.getChildren(byParent, todo.id).length > 0;
      const arrow = document.createElement('span');
      arrow.className = 'day-arrow' + (hasChildren ? '' : ' empty');
      if (hasChildren) {
        arrow.innerHTML = todo.expanded === false ? Icon.chevronRight() : Icon.chevronDown();
        arrow.onclick = (e) => {
          e.stopPropagation();
          const newExpanded = todo.expanded === false;
          Main.applyLocalUpdate(todo.id, { expanded: newExpanded });
          Main.sendUpdate(todo.id, { expanded: newExpanded });
        };
      }
      row.appendChild(arrow);
      row.appendChild(makeCb(todo));
      row.appendChild(makeLabel(todo));
      row.appendChild(makeNodeDate(todo, hit));
      const hitTag = todo.done ? null : makeHitTag(hit);
      if (hitTag) row.appendChild(hitTag);
      const overdueTag = makeOverdueTag(todo);
      if (overdueTag) row.appendChild(overdueTag);

      // 整行点击 + 双击编辑(和列表 clickAction 一致)
      const settings = state.settings || {};
      const expandMode = (settings.clickAction || 'edit') === 'expand';
      row.style.cursor = 'pointer';
      row.onclick = () => {
        if (expandMode && hasChildren) {
          if (row._clickTimer) {
            clearTimeout(row._clickTimer);
            row._clickTimer = null;
            Main.openEdit(todo.id);
          } else {
            row._clickTimer = setTimeout(() => {
              row._clickTimer = null;
              const newExpanded = todo.expanded === false;
              Main.applyLocalUpdate(todo.id, { expanded: newExpanded });
              Main.sendUpdate(todo.id, { expanded: newExpanded });
            }, 150);
          }
        } else {
          Main.openEdit(todo.id);
        }
      };
      row.ondblclick = () => Main.openEdit(todo.id);
      row.style.cursor = 'pointer';
    }

    function renderSubtree(parentId, container, depth = 1) {
      const kids = Render.getChildren(byParent, parentId)
        .slice()
        .sort((a, b) => {
          const ta = new Date(a.endTime || a.startTime || 0).getTime();
          const tb = new Date(b.endTime || b.startTime || 0).getTime();
          return ta - tb;
        });
      for (const k of kids) {
        const sub = document.createElement('div');
        sub.className = 'day-sub';
        sub.style.marginLeft = `${36 + (depth - 1) * 24}px`;
        decorateRow(sub, k);
        container.appendChild(sub);
        if (k.expanded !== false) {
          renderSubtree(k.id, container, depth + 1);
        }
      }
    }

    function makeItem(todo) {
      const item = document.createElement('div');
      item.className = 'day-item';
      decorateRow(item, todo);
      return item;
    }

    const sections = [
      { kind: 'end', label: '当天截止', icon: Icon.clock() },
      { kind: 'ongoing', label: '进行中', icon: Icon.refresh() },
      { kind: 'start', label: '当天开始', icon: Icon.calendar() },
    ];

    for (const section of sections) {
      const entries = groups[section.kind];
      if (!entries.length) continue;

      const sec = document.createElement('div');
      sec.className = `day-section interval-${section.kind}`;
      const title = document.createElement('div');
      title.className = 'day-section-title';
      title.innerHTML = `${section.icon} ${section.label} · ${entries.length}`;
      sec.appendChild(title);

      for (const entry of entries) {
        sec.appendChild(makeItem(entry.root));
        if (entry.root.expanded !== false) {
          renderSubtree(entry.root.id, sec);
        }
      }
      body.appendChild(sec);
    }

    // 更新一键折叠按钮状态
    const dayToggleBtn = document.getElementById('dayToggleExpand');
    if (dayToggleBtn) {
      const parents = Main.parentTodos();
      const anyExpanded = parents.some(todo => todo.expanded !== false);
      dayToggleBtn.innerHTML = anyExpanded ? Icon.chevronsUp() : Icon.chevronsDown();
      dayToggleBtn.title = anyExpanded ? '折叠全部' : '展开全部';
    }
  },

  renderHistory(state) {
    const body = document.getElementById('historyBody');
    const meta = document.getElementById('historyMeta');
    if (!body || !meta) return;
    body.innerHTML = '';

    const allTodos = state.historyAllTodos || [];
    const archivedTodos = state.archivedTodos || [];
    const byId = new Map(allTodos.map(todo => [todo.id, todo]));
    const archivedSet = new Set(archivedTodos.map(todo => todo.id));

    // 向上找 root:遇到未归档祖先则返回它(保持层级关系)
    const findRoot = (todo) => {
      const seen = new Set();
      let current = todo;
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (!current.parentId) return current;
        const parent = byId.get(current.parentId);
        if (!parent) return current;
        if (!archivedSet.has(parent.id)) return parent;
        current = parent;
      }
      return todo;
    };

    const parseTime = (iso) => {
      if (!iso) return null;
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const pad = (value) => String(value).padStart(2, '0');
    const formatDateTime = (date) => {
      if (!date) return '未知';
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const groupLabel = (date) => date
      ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`
      : '归档时间未知';

    const query = (state.historyQuery || '').trim().toLocaleLowerCase();
    const matches = (todo) => {
      if (!query) return true;
      return (todo.title || '').toLocaleLowerCase().includes(query);
    };
    const filtered = archivedTodos.filter(matches);

    meta.textContent = query
      ? `${filtered.length} / ${archivedTodos.length} 项`
      : `${archivedTodos.length} 项归档`;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = archivedTodos.length ? '没有匹配的归档' : '还没有归档记录';
      body.appendChild(empty);
      return;
    }

    const childrenOf = new Map();
    for (const todo of archivedTodos) {
      if (!todo.parentId) continue;
      if (!childrenOf.has(todo.parentId)) childrenOf.set(todo.parentId, []);
      childrenOf.get(todo.parentId).push(todo);
    };
    const sortByArchivedTime = (a, b) => {
      const at = parseTime(a.archivedAt)?.getTime() ?? parseTime(a.completedAt)?.getTime() ?? 0;
      const bt = parseTime(b.archivedAt)?.getTime() ?? parseTime(b.completedAt)?.getTime() ?? 0;
      return bt - at;
    };
    for (const arr of childrenOf.values()) arr.sort(sortByArchivedTime);

    const filteredSet = new Set(filtered.map(t => t.id));
    const rootHasMatch = (root) => {
      const stack = [root];
      const seen = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || seen.has(cur.id)) continue;
        seen.add(cur.id);
        if (filteredSet.has(cur.id)) return true;
        const kids = childrenOf.get(cur.id) || [];
        for (const k of kids) stack.push(k);
      }
      return false;
    };

    const roots = [];
    const visitedRoot = new Set();
    for (const todo of archivedTodos) {
      const root = findRoot(todo);
      if (visitedRoot.has(root.id)) continue;
      if (!rootHasMatch(root)) continue;
      visitedRoot.add(root.id);
      roots.push(root);
    }
    const rootArchivedTime = (root) => {
      if (root.archivedAt) return parseTime(root.archivedAt)?.getTime() ?? 0;
      const stack = [root];
      const seen = new Set();
      let latest = 0;
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || seen.has(cur.id)) continue;
        seen.add(cur.id);
        const t = parseTime(cur.archivedAt)?.getTime() ?? 0;
        if (t > latest) latest = t;
        const kids = childrenOf.get(cur.id) || [];
        for (const k of kids) stack.push(k);
      }
      return latest;
    };
    roots.sort((a, b) => rootArchivedTime(b) - rootArchivedTime(a));

    const collectSubtree = (root) => {
      const result = [];
      const stack = [root];
      const seen = new Set();
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || seen.has(cur.id)) continue;
        seen.add(cur.id);
        result.push(cur);
        const kids = childrenOf.get(cur.id) || [];
        for (const k of kids) stack.push(k);
      }
      return result;
    };

    const allCollapsed = state.historyCollapsed !== false;

    const renderNode = (todo, depth, container) => {
      const node = document.createElement('div');
      node.className = 'history-node';
      node.style.paddingLeft = `${12 + depth * 18}px`;

      const dot = document.createElement('span');
      dot.className = 'history-node-dot';
      const title = document.createElement('span');
      title.className = 'history-node-title';
      title.textContent = todo.title || '(无标题)';
      const time = document.createElement('span');
      time.className = 'history-node-time';
      const completed = parseTime(todo.completedAt);
      const archived = parseTime(todo.archivedAt);
      time.textContent = `完成 ${formatDateTime(completed)} · 归档 ${formatDateTime(archived)}`;
      const nodeNotesMode = (state.settings && state.settings.notesDisplay) || 'none';
      const todoNotes = (todo.notes && todo.notes.trim()) ? todo.notes : null;
      let notesIcon = null;
      if (todoNotes && nodeNotesMode !== 'none') {
        notesIcon = document.createElement('span');
        notesIcon.className = 'notes-icon history-node-notes-icon';
        notesIcon.innerHTML = window.Icon.messageSquare();
        let hoverTimer = null;
        let tipEl = null;
        const showTip = () => {
          hideTip();
          const rect = title.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          tipEl = document.createElement('div');
          tipEl.className = 'notes-tooltip';
          const head = document.createElement('div');
          head.className = 'notes-tooltip-head';
          head.textContent = '备注';
          const tipBody = document.createElement('div');
          tipBody.className = 'notes-tooltip-body';
          tipBody.textContent = todoNotes;
          tipEl.appendChild(head);
          tipEl.appendChild(tipBody);
          document.body.appendChild(tipEl);
          tipEl.style.top = (rect.bottom + 6 + window.scrollY) + 'px';
          tipEl.style.left = (rect.left + window.scrollX) + 'px';
        };
        const hideTip = () => {
          if (tipEl) { tipEl.remove(); tipEl = null; }
        };
        title.addEventListener('mouseenter', () => {
          hoverTimer = setTimeout(showTip, 500);
        });
        title.addEventListener('mouseleave', () => {
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = null;
          hideTip();
        });
        title.addEventListener('click', () => {
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = null;
          hideTip();
        }, true);
        notesIcon.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(todoNotes);
          } catch (err) {}
          hideTip();
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = null;
          const toast = document.createElement('div');
          toast.className = 'notes-copy-toast';
          toast.textContent = '已复制备注信息';
          document.body.appendChild(toast);
          const r = notesIcon.getBoundingClientRect();
          toast.style.top = (r.bottom + 6 + window.scrollY) + 'px';
          toast.style.left = (r.left + r.width / 2 + window.scrollX) + 'px';
          setTimeout(() => toast.remove(), 1500);
        });
      }
      const actions = document.createElement('span');
      actions.className = 'history-node-actions';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'btn ghost history-action';
      restore.innerHTML = `${Icon.rotateCcw()}<span>恢复</span>`;
      restore.onclick = () => Main.restoreArchived(todo.id);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn danger history-action';
      remove.innerHTML = `${Icon.trash()}<span>永久删除</span>`;
      remove.onclick = () => Main.deleteArchived(todo.id);
      actions.append(restore, remove);

      node.append(dot, title, ...(notesIcon ? [notesIcon] : []), time, actions);
      container.appendChild(node);

      const kids = childrenOf.get(todo.id) || [];
      for (const k of kids) renderNode(k, depth + 1, container);
    };

    const limit = state.historyLimit || 50;
    const visibleRoots = roots.slice(0, limit);

    let lastKey = null;
    for (const root of visibleRoots) {
      const subtree = collectSubtree(root);
      const rootTimeMs = rootArchivedTime(root);
      const rootTime = rootTimeMs ? new Date(rootTimeMs) : null;
      const key = rootTime
        ? `${rootTime.getFullYear()}-${pad(rootTime.getMonth() + 1)}-${pad(rootTime.getDate())}`
        : '__unknown__';
      if (lastKey !== key) {
        const groupTitle = document.createElement('div');
        groupTitle.className = 'history-group-title';
        const labelEl = document.createElement('span');
        labelEl.textContent = groupLabel(rootTime);
        groupTitle.appendChild(labelEl);
        body.appendChild(groupTitle);
        lastKey = key;
      }

      const isRootArchived = !!root.archivedAt;
      const card = document.createElement('article');
      card.className = 'history-card' + (isRootArchived ? '' : ' unarchived-context');

      const header = document.createElement('div');
      header.className = 'history-card-header';
      const headLeft = document.createElement('div');
      headLeft.className = 'history-card-head-left';
      const rootDot = document.createElement('span');
      rootDot.className = 'history-node-dot root';
      const headTitle = document.createElement('div');
      headTitle.className = 'history-card-title';
      headTitle.textContent = root.title || '(无标题)';
      if (!isRootArchived) {
        const tag = document.createElement('span');
        tag.className = 'unarchived-tag';
        tag.textContent = '未归档';
        headTitle.appendChild(tag);
      }
      const notesMode = (state.settings && state.settings.notesDisplay) || 'none';
      const rootNotes = (root.notes && root.notes.trim()) ? root.notes : null;
      if (rootNotes && notesMode !== 'none') {
        const ic = document.createElement('span');
        ic.className = 'notes-icon history-card-notes-icon';
        ic.innerHTML = window.Icon.messageSquare();
        let hoverTimer = null;
        let tipEl = null;
        const showTip = () => {
          hideTip();
          const rect = headTitle.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          tipEl = document.createElement('div');
          tipEl.className = 'notes-tooltip';
          const head = document.createElement('div');
          head.className = 'notes-tooltip-head';
          head.textContent = '备注';
          const tipBody = document.createElement('div');
          tipBody.className = 'notes-tooltip-body';
          tipBody.textContent = rootNotes;
          tipEl.appendChild(head);
          tipEl.appendChild(tipBody);
          document.body.appendChild(tipEl);
          tipEl.style.top = (rect.bottom + 6 + window.scrollY) + 'px';
          tipEl.style.left = (rect.left + window.scrollX) + 'px';
        };
        const hideTip = () => {
          if (tipEl) { tipEl.remove(); tipEl = null; }
        };
        headTitle.addEventListener('mouseenter', () => {
          hoverTimer = setTimeout(showTip, 500);
        });
        headTitle.addEventListener('mouseleave', () => {
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = null;
          hideTip();
        });
        headTitle.addEventListener('click', () => {
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = null;
          hideTip();
        }, true);
        ic.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(rootNotes);
          } catch (err) {}
          hideTip();
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = null;
          const toast = document.createElement('div');
          toast.className = 'notes-copy-toast';
          toast.textContent = '已复制备注信息';
          document.body.appendChild(toast);
          const r = ic.getBoundingClientRect();
          toast.style.top = (r.bottom + 6 + window.scrollY) + 'px';
          toast.style.left = (r.left + r.width / 2 + window.scrollX) + 'px';
          setTimeout(() => toast.remove(), 1500);
        });
        headTitle.appendChild(ic);
      }
      const headMeta = document.createElement('div');
      headMeta.className = 'history-card-meta';
      const archivedCount = subtree.filter(t => t.archivedAt).length;
      const rootCompleted = parseTime(root.completedAt);
      if (isRootArchived) {
        headMeta.textContent = `${subtree.length} 个节点 · 完成 ${formatDateTime(rootCompleted)} · 归档 ${formatDateTime(rootTime)}`;
      } else {
        headMeta.textContent = `${archivedCount} 个归档节点 · 最新归档 ${formatDateTime(rootTime)}`;
      }

      const collapseBtn = document.createElement('button');
      collapseBtn.type = 'button';
      collapseBtn.className = 'btn ghost history-card-collapse-btn';
      collapseBtn.title = allCollapsed ? '展开' : '折叠';
      collapseBtn.innerHTML = allCollapsed ? Icon.chevronRight() : Icon.chevronDown();
      collapseBtn.onclick = (e) => {
        e.stopPropagation();
        const body2 = card.querySelector('.history-card-body');
        const isCollapsed = body2.classList.toggle('collapsed');
        collapseBtn.innerHTML = isCollapsed ? Icon.chevronRight() : Icon.chevronDown();
        collapseBtn.title = isCollapsed ? '展开' : '折叠';
      };

      headLeft.append(rootDot, headTitle);
      header.append(headLeft, headMeta, collapseBtn);
      card.appendChild(header);

      const body2 = document.createElement('div');
      body2.className = 'history-card-body' + (allCollapsed ? ' collapsed' : '');
      const kids = childrenOf.get(root.id) || [];
      for (const k of kids) renderNode(k, 0, body2);
      if (!kids.length) {
        const empty = document.createElement('div');
        empty.className = 'history-card-empty';
        empty.textContent = '无子节点';
        body2.appendChild(empty);
      }
      card.appendChild(body2);

      const footer = document.createElement('div');
      footer.className = 'history-card-footer';
      const restoreAll = document.createElement('button');
      restoreAll.type = 'button';
      restoreAll.className = 'btn ghost history-action';
      if (isRootArchived) {
        restoreAll.innerHTML = `${Icon.rotateCcw()}<span>恢复整棵</span>`;
        restoreAll.onclick = () => Main.restoreArchived(root.id);
        const removeAll = document.createElement('button');
        removeAll.type = 'button';
        removeAll.className = 'btn danger history-action';
        removeAll.innerHTML = `${Icon.trash()}<span>永久删除整棵</span>`;
        removeAll.onclick = () => Main.deleteArchived(root.id);
        footer.append(restoreAll, removeAll);
      } else {
        restoreAll.innerHTML = `${Icon.rotateCcw()}<span>恢复全部归档子节点</span>`;
        restoreAll.onclick = () => {
          subtree.filter(t => t.id !== root.id && t.archivedAt).forEach(t => Main.restoreArchived(t.id));
        };
        const removeAll = document.createElement('button');
        removeAll.type = 'button';
        removeAll.className = 'btn danger history-action';
        removeAll.innerHTML = `${Icon.trash()}<span>永久删除全部归档子节点</span>`;
        removeAll.onclick = () => {
          subtree.filter(t => t.id !== root.id && t.archivedAt).forEach(t => Main.deleteArchived(t.id));
        };
        footer.append(restoreAll, removeAll);
      }
      card.appendChild(footer);

      body.appendChild(card);
    }

    if (roots.length > visibleRoots.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn ghost history-load-more';
      more.textContent = `加载更多 (剩余 ${roots.length - visibleRoots.length} 项)`;
      more.onclick = () => {
        state.historyLimit = (state.historyLimit || 50) + 50;
        Render.renderHistory(state);
      };
      body.appendChild(more);
    }

    const toggleAllBtn = document.getElementById('btnHistoryCollapseAll');
    if (toggleAllBtn) {
      toggleAllBtn.textContent = allCollapsed ? '全部展开' : '全部折叠';
      toggleAllBtn.onclick = () => {
        state.historyCollapsed = !allCollapsed;
        Render.renderHistory(state);
      };
    }
  },

  renderAll(state) {
    Render.renderStats(state);
    Render.renderCalendar(state);
    Render.renderList(state);
    Render.renderDayView(state);
  },
};
