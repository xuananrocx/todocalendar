const ReminderSettings = {
  groupOptions(r = {}, groups = [], settings = {}) {
    return [{ id: null, name: settings.defaultGroupName || 'Default', color: settings.defaultGroupColor,
      enabled: r.defaultGroupEnabled !== false },
    ...[...groups].sort((a, b) => (a.order || 0) - (b.order || 0)).map(g => ({
      id: g.id, name: g.name, color: g.color,
      enabled: r.groupEnabled?.[g.id] ?? (r.newGroupEnabled !== false),
    }))];
  },
  groupSummary(options) {
    const count = options.filter(g => g.enabled).length;
    return count === options.length ? `全部分组（${count}）` : count ? `已选择 ${count} / ${options.length} 个分组` : '未选择分组';
  },
  html(r = {}, groups = [], settings = {}, embedded = false) {
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const row = (label, control) => `<div class="settings-row reminder-setting-row"><label>${label}</label>${control}</div>`;
    const check = (key, label) => row(label, `<button type="button" class="app-switch ${(key === 'newGroupEnabled' ? r[key] !== false : r[key]) ? 'on' : ''}" role="switch" aria-checked="${key === 'newGroupEnabled' ? r[key] !== false : !!r[key]}" aria-label="${label}" data-reminder-switch="${key}"><span></span></button>`);
    const select = (key, label, options) => row(label, `<select aria-label="${label}" data-reminder="${key}">${options.map(([v,l])=>`<option value="${v}" ${r[key]===v?'selected':''}>${l}</option>`).join('')}</select>`);
    const number = (key, label, min, max, unit) => row(label, `<span class="reminder-setting-field"><input aria-label="${label}" data-reminder="${key}" type="number" min="${min}" max="${max}" step="1" value="${esc(r[key])}"><span>${unit}</span></span>`);
    const time = (key, label) => row(label, `<input aria-label="${label}" data-reminder="${key}" type="time" required value="${esc(r[key] || '09:30')}">`);
    const group = (title, body) => `<div class="settings-group"><div class="settings-section-title">${title}</div>${body}</div>`;
    return (embedded ? '' : '<div class="settings-content-title">提醒</div>') + `<div class="settings-content-desc">仅在应用运行时提醒；启动后汇总未处理的过期事项，搁置待办不参与。</div>`
      + group('提醒方式', check('enabled','启用待办提醒') + select('scope','提醒范围',[['both','开始与截止'],['start','仅开始'],['end','仅截止']]) + check('popup','倒计时弹窗') + check('system','Windows 系统通知') + check('topmost','提醒弹窗置顶'))
      + group('参与提醒的分组', row('提醒分组', `<button type="button" class="cs-toggle reminder-group-toggle" id="reminderGroups" aria-haspopup="dialog" aria-expanded="false"><span>${esc(this.groupSummary(this.groupOptions(r, groups, settings)))}</span><span aria-hidden="true">⌄</span></button>`)
        + check('newGroupEnabled','新建分组默认提醒')
        + '<div class="settings-row settings-data-copy">新建分组默认值只影响以后新增的分组。关闭分组会暂停该组的开始、截止、弹窗、系统通知及声音；重新开启后补提醒尚未处理的到期事项。</div>'
        + `<div class="settings-row settings-data-copy" id="reminderGroupStatus" role="status">${!r.enabled ? '总开关已关闭，分组选择仍会保留。' : this.groupOptions(r, groups, settings).some(g => g.enabled) ? '' : '当前没有分组参与提醒。'}</div>`)
      + group('仅日期待办', time('dateStart','开始提醒时间') + time('dateEnd','截止提醒时间') + number('count','提醒次数（含首次）',1,12,'次') + number('intervalMinutes','提醒间隔',1,1440,'分钟') + '<div class="settings-row settings-data-copy">提醒限于当天。已知晓后结束对应开始或截止事项的本轮提醒；错过多个批次时合并补提醒。</div>')
      + group('具体时间待办', number('startMinutes','开始前',0,10080,'分钟') + number('endMinutes','截止前',0,10080,'分钟') + '<div class="settings-row settings-data-copy">提前量为 0 时到点提醒。已知晓后，到点不再重复提示。</div>')
      + group('处理方式', select('policy','何时算已提醒',[['ack','关闭或点击已知晓后'],['shown','成功显示后']]) + number('snoozeMinutes','稍后提醒时间',1,1440,'分钟') + '<div class="settings-row settings-data-copy">成功显示仅结束当前批次；已知晓结束本轮。系统通知只能确认系统接受发送，无法保证用户已看到。划掉系统通知不等同于已知晓。</div>')
      + group('声音', select('sound','提示音',[['none','无（关闭）'],['system','系统默认'],['knock','轻敲提示'],['notes','清亮三音']]) + number('volume','自带提示音音量',0,100,'%') + `<div class="settings-row"><button type="button" class="btn-secondary" id="reminderSoundPreview" ${r.sound==='none'?'disabled':''}>试听</button></div><div class="settings-row settings-data-copy">每批只响一次。系统默认音量跟随 Windows；系统不允许打扰时暂停播放，试听也遵守此规则。</div>`);
  },
  bind(main) {
    const content = document.getElementById('settingsContent');
    content.querySelectorAll('[data-reminder]').forEach(input => {
      input.id = 'reminder-' + input.dataset.reminder;
      input.onchange = async () => {
        if (input.value === '' || !input.checkValidity()) { await main.alertAction({ title: '输入有误', message: AppUI.validationMessage(input), focusTarget: input.id }); return; }
        const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
        input.disabled = true;
        await main.patchSettings({ reminders: { [input.dataset.reminder]: value } });
        main.renderSettingsModal();
        const replacement = document.getElementById(input.id);
        if (replacement) AppUI.focus(replacement);
      };
    });
    content.querySelectorAll('[data-reminder-switch]').forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        await main.patchSettings({ reminders: { [button.dataset.reminderSwitch]: button.getAttribute('aria-checked') !== 'true' } });
        main.renderSettingsModal();
        content.querySelector(`[data-reminder-switch="${button.dataset.reminderSwitch}"]`)?.focus({ preventScroll: true });
      };
    });
    this.bindGroups(main, content);
    content.querySelector('#reminderSoundPreview').onclick = async () => {
      try { await window.__TAURI__.core.invoke('reminder_sound_preview'); }
      catch(e) { await main.alertAction({ title: '试听失败', message: window.__tauriErrMsg(e) }); }
    };
  },
  bindGroups(main, content) {
    const trigger = content.querySelector('#reminderGroups');
    const options = () => this.groupOptions(main.state.settings.reminders, main.state.groups, main.state.settings);
    let busy = false;
    const sync = () => {
      const items = options();
      trigger.querySelector('span').textContent = this.groupSummary(items);
      content.querySelector('#reminderGroupStatus').textContent = !main.state.settings.reminders.enabled
        ? '总开关已关闭，分组选择仍会保留。' : items.some(g => g.enabled) ? '' : '当前没有分组参与提醒。';
      return items;
    };
    const open = () => {
      if (AppPopover.current?.owner === trigger) { AppPopover.close(true); return; }
      const panel = document.createElement('div');
      panel.className = 'app-popover reminder-group-menu'; panel.id = 'reminderGroupMenu';
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '选择提醒分组');
      panel.innerHTML = '<div class="reminder-group-tools"><input type="search" placeholder="搜索分组" aria-label="搜索提醒分组"><div><button type="button" class="btn ghost" data-all="true">全选</button><button type="button" class="btn ghost" data-all="false">清空</button></div></div><div class="reminder-group-options"></div><div class="reminder-group-empty" hidden>没有匹配的分组</div><div class="reminder-group-menu-footer"><span role="status"></span><button type="button" class="btn" data-close>完成</button></div>';
      trigger.setAttribute('aria-controls', panel.id);
      const list = panel.querySelector('.reminder-group-options');
      const search = panel.querySelector('input[type="search"]');
      const summary = panel.querySelector('[role="status"]');
      const filter = () => {
        const query = search.value.trim().toLocaleLowerCase(); let found = false;
        list.querySelectorAll('label').forEach(row => { row.hidden = !row.textContent.toLocaleLowerCase().includes(query); found ||= !row.hidden; });
        panel.querySelector('.reminder-group-empty').hidden = found;
        AppPopover.position();
      };
      const refresh = () => {
        const items = sync();
        list.replaceChildren();
        items.forEach((item, index) => {
          const row = document.createElement('label'); row.className = 'reminder-group-option';
          const dot = document.createElement('span'); dot.className = 'reminder-group-dot'; if (item.color) dot.style.background = item.color;
          const name = document.createElement('span'); name.className = 'reminder-group-name'; name.textContent = item.name;
          const input = document.createElement('input'); input.type = 'checkbox'; input.checked = item.enabled;
          input.dataset.index = index; input.setAttribute('aria-label', item.name + '提醒');
          input.onchange = () => save(item.id === null ? { defaultGroupEnabled: input.checked } : { groupEnabled: { [item.id]: input.checked } }, index);
          row.append(dot, name, input); list.append(row);
        });
        summary.textContent = this.groupSummary(items); filter();
      };
      const save = async (patch, focusIndex) => {
        if (busy) return; busy = true;
        panel.setAttribute('aria-busy', 'true');
        panel.querySelectorAll('input,button').forEach(el => el.disabled = true);
        try { await main.patchSettings({ reminders: patch }); }
        finally {
          busy = false;
          if (trigger.isConnected) sync();
          if (AppPopover.current?.panel === panel) {
            const scroll = list.scrollTop;
            refresh(); list.scrollTop = scroll;
            panel.querySelectorAll('input,button').forEach(el => el.disabled = false);
            panel.setAttribute('aria-busy', 'false');
            const focus = typeof focusIndex === 'number' ? list.querySelector(`[data-index="${focusIndex}"]`) : panel.querySelector(`[data-all="${focusIndex}"]`);
            focus?.focus({ preventScroll: true });
          }
        }
      };
      panel.querySelectorAll('[data-all]').forEach(button => button.onclick = () => {
        const value = button.dataset.all === 'true';
        save({ defaultGroupEnabled: value, groupEnabled: Object.fromEntries(options().filter(g => g.id !== null).map(g => [g.id, value])) }, button.dataset.all);
      });
      search.oninput = filter;
      panel.querySelector('[data-close]').onclick = () => AppPopover.close(true);
      list.onkeydown = e => {
        if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return;
        const inputs = [...list.querySelectorAll('label:not([hidden]) input:not(:disabled)')];
        if (!inputs.length) return;
        e.preventDefault(); const current = inputs.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? inputs.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + inputs.length) % inputs.length;
        inputs[next].focus();
      };
      refresh();
      AppPopover.show(trigger, panel, trigger, () => trigger.setAttribute('aria-expanded', 'false'));
      trigger.setAttribute('aria-expanded', 'true'); search.focus({ preventScroll: true });
    };
    trigger.onclick = open;
    trigger.onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); open(); } };
  }
};
