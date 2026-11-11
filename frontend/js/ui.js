// Shared application controls. Native form elements retain values and change events;
// visible controls and popovers use the application's theme in every window.
const AppPopover = {
  current: null,
  show(owner, panel, anchor, onclose) {
    this.close();
    document.body.append(panel);
    panel.hidden = false;
    this.current = { owner, panel, anchor, onclose };
    this.position();
  },
  position() {
    const c = this.current;
    if (!c) return;
    if (!c.anchor.isConnected || !c.anchor.getClientRects().length) { this.close(); return; }
    const rect = c.anchor.getBoundingClientRect(), margin = 8;
    const isPicker = c.panel.classList.contains('app-date-picker');
    const preferredWidth = c.panel.classList.contains('app-picker-with-time') ? 335 : isPicker ? (c.panel.querySelector('.app-picker-calendar') ? 212 : 200) : 180;
    const width = Math.min(innerWidth - margin * 2, isPicker ? preferredWidth : Math.max(rect.width, preferredWidth));
    c.panel.style.width = width + 'px';
    const below = innerHeight - rect.bottom - margin, above = rect.top - margin;
    const upward = below < Math.min(c.panel.scrollHeight, 260) && above > below;
    // Date/time panels can extend past their anchor to keep the full controls visible.
    const available = c.panel.classList.contains('app-date-picker') ? innerHeight - margin * 2 : upward ? above : below;
    c.panel.style.maxHeight = Math.max(80, available) + 'px';
    const height = c.panel.getBoundingClientRect().height;
    c.panel.style.left = Math.max(margin, Math.min(rect.left, innerWidth - width - margin)) + 'px';
    c.panel.style.top = Math.max(margin, upward ? rect.top - height - 4 : Math.min(rect.bottom + 4, innerHeight - height - margin)) + 'px';
  },
  close(restore = false) {
    const c = this.current;
    if (!c) return;
    this.current = null;
    c.panel.hidden = true;
    c.panel.remove();
    c.onclose?.();
    if (restore && c.anchor.isConnected) c.anchor.focus({ preventScroll: true });
  }
};

class CustomSelect {
  constructor(rootEl, { onchange = null, label = '' } = {}) {
    this.root = rootEl; this.onchange = onchange; this.items = []; this.value = ''; this.disabled = false; this.title = '';
    this.root.classList.add('cs-select');
    this.root.innerHTML = '<button type="button" class="cs-toggle" aria-haspopup="listbox" aria-expanded="false"><span class="cs-label"></span><span class="cs-chevron" aria-hidden="true">⌄</span></button>';
    if (typeof Icon !== 'undefined') this.root.querySelector('.cs-chevron').innerHTML = Icon.chevronDown();
    this.toggleBtn = this.root.querySelector('button'); this.labelEl = this.root.querySelector('.cs-label');
    if (label) this.toggleBtn.setAttribute('aria-label', label);
    this.menuEl = document.createElement('div'); this.menuEl.className = 'cs-menu app-popover'; this.menuEl.hidden = true;
    this.menuEl.setAttribute('role', 'listbox'); this.menuEl.setAttribute('aria-label', label || '选择选项');
    this.menuEl.id = 'app-select-' + (++CustomSelect.nextId);
    this.toggleBtn.setAttribute('aria-controls', this.menuEl.id);
    this.toggleBtn.onclick = () => AppPopover.current?.owner === this ? this.close() : this.open();
    this.toggleBtn.onkeydown = e => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); this.open(e.key === 'End' || e.key === 'ArrowUp' ? -1 : undefined); }
    };
    this.menuEl.onkeydown = e => this.keydown(e);
  }
  _renderToggle() {
    this.labelEl.textContent = this.items.find(i => i.value === this.value)?.label || this.items[0]?.label || '请选择';
    this.toggleBtn.disabled = this.disabled;
    this.toggleBtn.title = this.disabled ? this.title : '';
    this.root.classList.toggle('cs-disabled', this.disabled);
  }
  _renderMenu() {
    this.menuEl.replaceChildren();
    this.items.forEach((item, index) => {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'dropdown-item cs-option' + (item.value === this.value ? ' active' : '');
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(item.value === this.value));
      button.disabled = !!item.disabled; button.tabIndex = -1;
      button.style.paddingLeft = (10 + (item.depth || 0) * 14) + 'px';
      const text = document.createElement('span'); text.className = 'cs-option-label'; text.textContent = item.label; button.append(text);
      if (item.value === this.value) { const mark = document.createElement('span'); mark.textContent = '✓'; mark.setAttribute('aria-hidden', 'true'); button.append(mark); }
      button.onclick = e => { e.preventDefault(); this.value = item.value; this.close(true); this._renderToggle(); this.onchange?.(this.value); };
      button.dataset.index = index; this.menuEl.append(button);
    });
  }
  setOptions(items, selected) {
    this.close(); this.items = items || [];
    this.value = this.items.some(i => i.value === selected) ? selected : this.items[0]?.value || '';
    this._renderToggle();
  }
  setValue(value) { this.value = value; this._renderToggle(); }
  getValue() { return this.value; }
  setDisabled(disabled, title = '') { this.disabled = disabled; this.title = title; if (disabled) this.close(); this._renderToggle(); }
  open(last) {
    if (this.disabled) return;
    this._renderMenu();
    AppPopover.show(this, this.menuEl, this.toggleBtn, () => { this.root.classList.remove('cs-open'); this.toggleBtn.setAttribute('aria-expanded', 'false'); });
    this.root.classList.add('cs-open'); this.toggleBtn.setAttribute('aria-expanded', 'true');
    const buttons = [...this.menuEl.querySelectorAll('button:not(:disabled)')];
    (last === -1 ? buttons.at(-1) : buttons.find(b => b.getAttribute('aria-selected') === 'true') || buttons[0])?.focus({ preventScroll: true });
  }
  close(restore = false) { if (AppPopover.current?.owner === this) AppPopover.close(restore); }
  keydown(e) {
    const buttons = [...this.menuEl.querySelectorAll('button:not(:disabled)')];
    let index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault(); index = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    } else if (e.key.length === 1 && e.key !== ' ') {
      const match = buttons.find(b => b.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (match) { e.preventDefault(); match.focus(); }
    }
  }
}
CustomSelect.nextId = 0;

const AppDialog = {
  queue: [], active: null,
  alert(message, options = {}) { return this.confirm({ title: '提示', message, confirmText: '已知晓', hideCancel: true, ...options }); },
  confirm(options) {
    const previous = this.active?.previous || document.activeElement;
    return new Promise(resolve => { this.queue.push({ options, resolve, previous }); this.next(); });
  },
  ensure() {
    let mask = document.getElementById('confirmMask');
    if (!mask) {
      mask = document.createElement('div'); mask.id = 'confirmMask'; mask.className = 'modal-mask confirm-mask'; mask.hidden = true;
      mask.innerHTML = '<div class="modal confirm-modal"><div class="confirm-heading"><span class="confirm-icon" id="confirmIcon" aria-hidden="true">ⓘ</span><h3 id="confirmTitle"></h3></div><p id="confirmMessage" class="confirm-message"></p><div class="modal-actions confirm-actions"><span class="spacer"></span><button type="button" id="btnConfirmCancel" class="btn ghost">取消</button><button type="button" id="btnConfirmAccept" class="btn primary">确认</button></div></div>';
    }
    document.body.append(mask); // Avoid transformed ancestors and their stacking contexts.
    mask.classList.add('app-dialog-mask'); mask.setAttribute('role', 'dialog'); mask.setAttribute('aria-modal', 'true');
    mask.setAttribute('aria-labelledby', 'confirmTitle'); mask.setAttribute('aria-describedby', 'confirmMessage');
    document.getElementById('btnConfirmCancel').onclick = () => this.close(false);
    document.getElementById('btnConfirmAccept').onclick = () => this.close(true);
    return mask;
  },
  next() {
    if (this.active || !this.queue.length) return;
    AppPopover.close();
    this.active = this.queue.shift();
    const { options: o } = this.active, mask = this.ensure();
    document.getElementById('confirmTitle').textContent = o.title || '确认操作';
    const message = document.getElementById('confirmMessage');
    message.classList.toggle('has-html', o.messageHtml != null);
    if (o.messageHtml != null) message.innerHTML = o.messageHtml; else message.textContent = o.message || '';
    const accept = document.getElementById('btnConfirmAccept');
    accept.textContent = o.confirmText || '确认'; accept.className = o.danger ? 'btn confirm-danger' : 'btn primary';
    document.getElementById('btnConfirmCancel').hidden = !!o.hideCancel;
    const icon = document.getElementById('confirmIcon');
    if (typeof Icon !== 'undefined') icon.innerHTML = o.danger ? Icon.trash() : Icon.info();
    else icon.textContent = o.danger ? '!' : 'ⓘ';
    mask.querySelector('.confirm-modal').classList.toggle('danger', !!o.danger);
    mask.hidden = false;
    requestAnimationFrame(() => { if (this.active) accept.focus(); });
  },
  close(value = false) {
    if (!this.active) return;
    const item = this.active; this.active = null;
    document.getElementById('confirmMask').hidden = true;
    item.resolve(value);
    if (this.queue.length) this.next();
    else {
      const target = item.options.focusTarget ? document.getElementById(item.options.focusTarget) : item.previous;
      requestAnimationFrame(() => { if (!this.active && target?.isConnected) AppUI.focus(target); });
    }
  }
};

class AppTimeWheel {
  constructor(root, input, max, label) {
    this.root = root; this.input = input; this.max = max; this.value = -1; this.rowHeight = 28;
    root.tabIndex = 0;
    root.setAttribute('role', 'listbox'); root.setAttribute('aria-label', label + '滚动选择');
    const id = 'app-time-wheel-' + (++AppTimeWheel.nextId);
    this.options = Array.from({ length: max + 1 }, (_, value) => {
      const option = document.createElement('div');
      option.className = 'app-time-option'; option.id = id + '-' + value;
      option.dataset.value = value; option.textContent = String(value).padStart(2, '0');
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
      root.append(option); return option;
    });
    root.onscroll = () => {
      const value = this.nearest();
      if (value !== this.value) this.select(value);
    };
    root.onkeydown = e => {
      const steps = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
      if (e.key in steps || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        this.setValue(e.key === 'Home' ? 0 : e.key === 'End' ? max : this.value + steps[e.key]);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); this.snap();
      }
    };
    root.onclick = e => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const option = e.target.closest('.app-time-option');
      if (option) this.setValue(Number(option.dataset.value));
    };
    root.onpointerdown = e => {
      // Touch/pen use native scrolling and inertia; mouse dragging uses pointer capture.
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      e.preventDefault(); root.focus({ preventScroll: true });
      this.suppressClick = false;
      this.drag = { id: e.pointerId, y: e.clientY, top: root.scrollTop, moved: false, option: e.target.closest('.app-time-option') };
      root.setPointerCapture(e.pointerId); root.classList.add('dragging');
    };
    root.onpointermove = e => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const distance = this.drag.y - e.clientY;
      if (Math.abs(distance) > 3) this.drag.moved = true;
      if (this.drag.moved) root.scrollTop = this.drag.top + distance;
    };
    const endDrag = e => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const drag = this.drag; this.drag = null;
      root.classList.remove('dragging'); this.suppressClick = true;
      if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
      if (e.type === 'pointerup' && !drag.moved && drag.option) this.setValue(Number(drag.option.dataset.value));
      else this.snap();
    };
    root.onpointerup = endDrag; root.onpointercancel = endDrag; root.onlostpointercapture = endDrag;
    input.addEventListener('input', () => {
      if (input.value !== '' && input.checkValidity()) this.setValue(Number(input.value), false);
    });
  }
  nearest() { return Math.max(0, Math.min(this.max, Math.round(this.root.scrollTop / this.rowHeight))); }
  select(value, format = true) {
    this.value = Math.max(0, Math.min(this.max, value));
    this.options.forEach((option, index) => {
      option.classList.toggle('selected', index === this.value);
      option.setAttribute('aria-selected', String(index === this.value));
    });
    this.root.setAttribute('aria-activedescendant', this.options[this.value].id);
    if (format) this.input.value = String(this.value).padStart(2, '0');
  }
  setValue(value, format = true) {
    this.select(value, format);
    this.root.scrollTop = this.value * this.rowHeight;
  }
  snap() { this.setValue(this.nearest()); }
  destroy() { this.root.onscroll = null; this.drag = null; }
}
AppTimeWheel.nextId = 0;

const AppDatePicker = {
  pad(n) { return String(n).padStart(2, '0'); },
  monthStart(date) { const result = new Date(date); result.setDate(1); result.setHours(12,0,0,0); return result; },
  dateString(date) { return `${String(date.getFullYear()).padStart(4,'0')}-${this.pad(date.getMonth()+1)}-${this.pad(date.getDate())}`; },
  parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y,m,d] = value.split('-').map(Number), result = new Date(2000,m-1,d,12);
    result.setFullYear(y);
    return result.getFullYear()===y && result.getMonth()===m-1 && result.getDate()===d && y>=1 ? result : null;
  },
  open(input, anchor) {
    if (input.disabled) return;
    AppPopover.close();
    const timed = input.type !== 'date', date = input.type !== 'time';
    let selected = this.parseDate(input.value.slice(0,10)) || new Date();
    let month = this.monthStart(selected);
    const clock = input.type==='time' ? input.value : input.value.split('T')[1];
    const panel = document.createElement('div'); panel.className = 'app-popover app-date-picker';
    panel.setAttribute('role','dialog'); panel.setAttribute('aria-label', input.getAttribute('aria-label') || (date ? '选择日期' : '选择时间'));
    panel.classList.toggle('app-picker-with-time', date && timed);
    const wheelColumn = (key, label, max) => `<div class="app-time-column">
      <label>${label}<input type="number" data-${key} min="0" max="${max}" step="1" aria-label="${label}" inputmode="numeric"></label>
      <div class="app-time-window"><div class="app-time-wheel" data-wheel="${key}"></div></div>
    </div>`;
    panel.innerHTML = `<div class="app-picker-body">
      ${date ? `<div class="app-picker-calendar">
        <div class="app-picker-heading"><button type="button" class="btn ghost" data-prev aria-label="上个月">‹</button><span data-month></span><button type="button" class="btn ghost" data-next aria-label="下个月">›</button></div>
        <div class="app-picker-jump"><label>年份<input type="number" data-year min="1" max="9999" step="1" aria-label="年份"></label><label>月份<input type="number" data-month-input min="1" max="12" step="1" aria-label="月份"></label></div>
        <div class="app-picker-week" aria-hidden="true">${['一','二','三','四','五','六','日'].map(d=>'<span>'+d+'</span>').join('')}</div>
        <div class="app-picker-days" role="group" aria-label="日期"></div>
      </div>` : ''}
      ${timed ? `<div class="app-picker-clock"><div class="app-clock-title">选择时间</div><div class="app-time-columns">${wheelColumn('hour','小时',23)}${wheelColumn('minute','分钟',59)}</div></div>` : ''}
    </div><p class="app-field-error" data-error role="alert" hidden></p>
    <div class="app-picker-actions"><button type="button" class="btn ghost" data-clear ${input.required?'disabled':''}>清空</button><button type="button" class="btn ghost" data-today>${date?'今天':'此刻'}</button><button type="button" class="btn ghost" data-cancel>取消</button><button type="button" class="btn primary" data-apply>确定</button></div>`;
    const q = s => panel.querySelector(s);
    const wheels = timed ? [
      new AppTimeWheel(q('[data-wheel="hour"]'), q('[data-hour]'), 23, '小时'),
      new AppTimeWheel(q('[data-wheel="minute"]'), q('[data-minute]'), 59, '分钟'),
    ] : [];
    const setClock = (hour, minute) => { wheels[0]?.setValue(hour); wheels[1]?.setValue(minute); };
    const error = message => { q('[data-error]').hidden=false;q('[data-error]').textContent=message;AppPopover.position(); };
    const render = () => {
      if (!date) return;
      q('[data-month]').textContent = `${month.getFullYear()} 年 ${month.getMonth()+1} 月`;
      q('[data-year]').value = month.getFullYear(); q('[data-month-input]').value = month.getMonth()+1;
      q('[data-prev]').disabled = month.getFullYear()===1 && month.getMonth()===0;
      q('[data-next]').disabled = month.getFullYear()===9999 && month.getMonth()===11;
      const grid = q('.app-picker-days'); grid.replaceChildren();
      const start = new Date(month); start.setDate(1 - (month.getDay()+6)%7);
      for (let i=0;i<42;i++) {
        const day = new Date(start);day.setDate(start.getDate()+i);
        const button=document.createElement('button');button.type='button';button.textContent=day.getDate();
        button.className='app-picker-day'+(day.getMonth()!==month.getMonth()?' outside':'')+(this.dateString(day)===this.dateString(selected)?' selected':'');
        button.setAttribute('aria-label',this.dateString(day));button.setAttribute('aria-pressed',String(this.dateString(day)===this.dateString(selected)));
        button.disabled=day.getFullYear()<1||day.getFullYear()>9999;
        button.tabIndex=this.dateString(day)===this.dateString(selected)?0:-1;
        button.onclick=()=>{selected=day;month=this.monthStart(day);render();q(`[aria-label="${this.dateString(day)}"]`)?.focus();};
        button.onkeydown=e=>{
          const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key];
          if(delta){e.preventDefault();const next=new Date(day);next.setDate(day.getDate()+delta);if(next.getFullYear()<1||next.getFullYear()>9999)return;selected=next;month=this.monthStart(next);render();q(`[aria-label="${this.dateString(next)}"]`)?.focus();}
        };
        grid.append(button);
      }
      if (!grid.querySelector('[tabindex="0"]')) grid.querySelector('button:not(:disabled):not(.outside)').tabIndex = 0;
      AppPopover.position();
    };
    const commit = value => {
      if (!input.isConnected || input.disabled) {AppPopover.close();return;}
      input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      AppPopover.close(true);
    };
    if (date) {
      q('[data-prev]').onclick=()=>{month.setMonth(month.getMonth()-1);render();};
      q('[data-next]').onclick=()=>{month.setMonth(month.getMonth()+1);render();};
      const jump=()=>{
        const y=Number(q('[data-year]').value),m=Number(q('[data-month-input]').value);
        if(!Number.isInteger(y)||y<1||y>9999||!Number.isInteger(m)||m<1||m>12){error('请输入 1–9999 年、1–12 月');return;}
        q('[data-error]').hidden=true;
        if(month.getFullYear()===y&&month.getMonth()===m-1)return;
        month=new Date(2000,m-1,1,12);month.setFullYear(y);render();
      };
      q('[data-year]').onchange=jump;q('[data-month-input]').onchange=jump;
      // Commit typed year/month when keyboard focus leaves the field.
      q('[data-year]').onblur=jump;q('[data-month-input]').onblur=jump;
      [q('[data-year]'),q('[data-month-input]')].forEach(field=>field.onkeydown=e=>{
        if(e.key==='Enter'){e.preventDefault();e.stopPropagation();jump();q('.app-picker-days [tabindex="0"]')?.focus();}
      });
    }
    q('[data-today]').onclick=()=>{selected=new Date();month=this.monthStart(selected);if(timed)setClock(selected.getHours(),selected.getMinutes());render();};
    q('[data-clear]').onclick=()=>commit('');q('[data-cancel]').onclick=()=>AppPopover.close(true);
    q('[data-apply]').onclick=()=>{
      let clockValue='';
      if(timed){const h=q('[data-hour]'),m=q('[data-minute]');if(h.value===''||m.value===''||!h.checkValidity()||!m.checkValidity()){error('小时应为 0–23，分钟应为 0–59');return;}clockValue=this.pad(Number(h.value))+':'+this.pad(Number(m.value));}
      const value=date?this.dateString(selected)+(timed?'T'+clockValue:''):clockValue;
      if(input.min&&value<input.min||input.max&&value>input.max){error(`请选择${input.min?'不早于 '+input.min:''}${input.max?' 不晚于 '+input.max:''}的时间`);return;}
      commit(value);
    };
    panel.onkeydown=e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();q('[data-apply]').click();}};
    render();AppPopover.show(this,panel,anchor,()=>{
      anchor.setAttribute('aria-expanded','false'); wheels.forEach(wheel=>wheel.destroy());
    });
    if (timed) { const [h,m] = (clock || '09:30').split(':').map(Number); setClock(h,m); }
    anchor.setAttribute('aria-expanded','true');
    (date?q('.app-picker-day.selected'):q('[data-wheel="hour"]'))?.focus({preventScroll:true});
  }
};

const AppUI = {
  selects: new WeakMap(), dates: new WeakMap(),
  watchProperty(element, name, callback) {
    let proto=Object.getPrototypeOf(element),descriptor;
    while(proto&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(proto,name);proto=Object.getPrototypeOf(proto);}
    if(!descriptor?.set)return;
    Object.defineProperty(element,name,{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);callback();}});
  },
  adaptSelect(select) {
    if(this.selects.has(select))return;
    const root=document.createElement('span');select.after(root);
    const label=select.getAttribute('aria-label')||select.closest('label')?.firstChild?.textContent.trim()||'选择选项';
    const control=new CustomSelect(root,{label,onchange:value=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));}});
    this.selects.set(select,control);select.classList.add('app-native-source');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const sync=()=>{control.setOptions([...select.options].map(o=>({value:o.value,label:o.textContent,disabled:o.disabled})),select.value);control.setDisabled(select.disabled);};
    ['value','selectedIndex','disabled'].forEach(p=>this.watchProperty(select,p,sync));select.addEventListener('change',sync);sync();
    new MutationObserver(sync).observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','label','selected','value']});
  },
  adaptDate(input) {
    if(this.dates.has(input))return;
    const trigger=document.createElement('button');trigger.type='button';trigger.className='app-date-trigger';
    trigger.innerHTML='<span class="app-date-value"></span><span class="app-date-icon" aria-hidden="true"></span>';
    const wrap=input.closest('.input-wrap');if(wrap)wrap.append(trigger);else input.after(trigger);
    input.classList.add('app-native-source');input.tabIndex=-1;input.setAttribute('aria-hidden','true');
    const sync=()=>{
      trigger.disabled=input.disabled;
      const value=input.value, type=input.type;
      trigger.querySelector('.app-date-value').textContent=value?(type==='time'?value:value.replace('T',' ').replace(/^(\d+)-(\d+)-(\d+)/,'$1年$2月$3日')):type==='time'?'选择时间':'选择日期';
      const icon=trigger.querySelector('.app-date-icon');
      if(typeof Icon!=='undefined')icon.innerHTML=type==='time'?Icon.clock():Icon.calendar();else icon.textContent='▦';
      trigger.classList.toggle('placeholder',!value);
      const label=input.getAttribute('aria-label')||input.closest('label')?.firstChild?.textContent.trim()||'日期与时间';
      trigger.setAttribute('aria-label',label+'：'+(value||'未设置'));trigger.setAttribute('aria-haspopup','dialog');
    };
    this.dates.set(input,{trigger,sync});['value','type','disabled'].forEach(p=>this.watchProperty(input,p,sync));
    trigger.onclick=()=>AppDatePicker.open(input,trigger);input.addEventListener('input',sync);input.addEventListener('change',sync);sync();
  },
  enhance(root=document) {
    root.querySelectorAll('select:not(.app-native-source)').forEach(e=>this.adaptSelect(e));
    root.querySelectorAll('input[type="date"]:not(.app-native-source),input[type="datetime-local"]:not(.app-native-source),input[type="time"]:not(.app-native-source)').forEach(e=>this.adaptDate(e));
  },
  sync(input) {this.dates.get(input)?.sync();},
  focus(input) {const target=this.dates.get(input)?.trigger||this.selects.get(input)?.toggleBtn||input;target.focus?.({preventScroll:true});},
  validationMessage(input) {
    const label=input.getAttribute('aria-label')||'数值';
    if(input.value===''||input.validity.badInput)return `请输入有效的${label}`;
    if(input.validity.rangeUnderflow)return `${label}不能小于 ${input.min}`;
    if(input.validity.rangeOverflow)return `${label}不能大于 ${input.max}`;
    if(input.validity.stepMismatch)return `${label}请输入整数`;
    return `${label}格式无效，请检查后重试`;
  },
  init() {
    this.enhance();
    let queued=false;
    new MutationObserver(()=>{
      if(queued)return;queued=true;queueMicrotask(()=>{queued=false;this.enhance();const c=AppPopover.current;if(c&&!c.anchor.isConnected)AppPopover.close();});
    }).observe(document.body,{childList:true,subtree:true});
    document.addEventListener('pointerdown',e=>{const c=AppPopover.current;if(c&&!c.panel.contains(e.target)&&!c.anchor.contains(e.target))AppPopover.close();},true);
    document.addEventListener('scroll',e=>{const c=AppPopover.current;if(c&&!c.panel.contains(e.target))AppPopover.close();},true);
    window.addEventListener('resize',()=>AppPopover.close());
    document.addEventListener('keydown',e=>{
      const c=AppPopover.current;
      if(c&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();AppPopover.close(true);return;}
      if(c&&e.key==='Tab'){
        if(c.owner instanceof CustomSelect){const next=c.anchor;AppPopover.close();next.focus();return;}
        const nodes=[...c.panel.querySelectorAll('button:not(:disabled),input:not(:disabled),[role="listbox"]')].filter(n=>n.tabIndex!==-1 && n.getClientRects().length);
        const current=nodes.indexOf(document.activeElement);e.preventDefault();nodes[(current+(e.shiftKey?-1:1)+nodes.length)%nodes.length]?.focus();return;
      }
      if(!AppDialog.active)return;
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();AppDialog.close(false);}
      if(e.key==='Tab'){
        e.preventDefault();e.stopImmediatePropagation();
        const nodes=[...document.getElementById('confirmMask').querySelectorAll('button')].filter(b=>!b.hidden&&!b.disabled);
        const i=nodes.indexOf(document.activeElement);nodes[(i+(e.shiftKey?-1:1)+nodes.length)%nodes.length]?.focus();
      }
    },true);
  }
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>AppUI.init(),{once:true});else AppUI.init();
