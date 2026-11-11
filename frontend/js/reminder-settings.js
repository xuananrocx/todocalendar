const ReminderSettings = {
  html(r = {}) {
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const row = (label, control) => `<div class="settings-row reminder-setting-row"><label>${label}</label>${control}</div>`;
    const check = (key, label) => row(label, `<button type="button" class="app-switch ${r[key] ? 'on' : ''}" role="switch" aria-checked="${!!r[key]}" aria-label="${label}" data-reminder-switch="${key}"><span></span></button>`);
    const select = (key, label, options) => row(label, `<select aria-label="${label}" data-reminder="${key}">${options.map(([v,l])=>`<option value="${v}" ${r[key]===v?'selected':''}>${l}</option>`).join('')}</select>`);
    const number = (key, label, min, max, unit) => row(label, `<span class="reminder-setting-field"><input aria-label="${label}" data-reminder="${key}" type="number" min="${min}" max="${max}" step="1" value="${esc(r[key])}"><span>${unit}</span></span>`);
    const time = (key, label) => row(label, `<input aria-label="${label}" data-reminder="${key}" type="time" required value="${esc(r[key] || '09:30')}">`);
    const group = (title, body) => `<div class="settings-group"><div class="settings-section-title">${title}</div>${body}</div>`;
    return `<div class="settings-content-title">提醒</div><div class="settings-content-desc">仅在应用运行时提醒；启动后汇总未处理的过期事项，搁置待办不参与。</div>`
      + group('提醒方式', check('enabled','启用待办提醒') + select('scope','提醒范围',[['both','开始与截止'],['start','仅开始'],['end','仅截止']]) + check('popup','倒计时弹窗') + check('system','Windows 系统通知') + check('topmost','提醒弹窗置顶'))
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
    content.querySelector('#reminderSoundPreview').onclick = async () => {
      try { await window.__TAURI__.core.invoke('reminder_sound_preview'); }
      catch(e) { await main.alertAction({ title: '试听失败', message: window.__tauriErrMsg(e) }); }
    };
  }
};
