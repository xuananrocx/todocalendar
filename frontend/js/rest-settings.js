const RestSettings = {
  help: {
    '开启休息提醒':'定时提醒起身走走、喝水和放松，不关联待办。仅在软件运行时计时；休息期间暂缓待办提醒，结束后汇总，系统中已有通知不会被删除。',
    '提醒间隔':'从开启功能或一次休息结束后重新计时。锁屏、休眠或重新打开软件后重新计算间隔，不补提醒；修改配置后也会重新计时。',
    '休息时长':'休息结束后自动返回，可持续长按 2 秒紧急退出。文案自动随机轮换，5 分钟休息约每 12 秒换一句，随时长在 8–30 秒内自适应；全部展示后再重新随机。',
    '提醒模式':'普通模式先弹窗，可开始休息、稍后 5 分钟或跳过。强制模式在预告倒计时结束后自动进入全屏；预告可稍后 5 分钟或跳过本次，稍后到期会重新预告。全屏不锁定 Windows。',
    '提前提示时间':'进入强制休息前的预告时长，默认 10 秒，可设置 1–300 秒。「关闭弹窗」仅隐藏预告，到点仍休息；「跳过此次休息」重新计算下次提醒间隔。',
    '休息时覆盖全部显示器':'默认覆盖全部显示器；关闭后只覆盖主显示器。多屏的倒计时和文案同步，任意屏幕长按 2 秒退出会同时结束本次休息。',
    '提示音':'无表示关闭声音。选择提示音后，在提醒时播放一次，音量为 50%，并遵守 Windows 勿扰状态。',
    '立即体验':'使用当前模式和休息时长，无需开启总开关。强制模式的体验直接进入全屏，可持续长按 2 秒退出。'
  },
  helpButton(name) {
    return `<button type="button" class="rest-help-button" data-rest-help="${name}" aria-label="${name}说明" aria-expanded="false">?</button>`;
  },
  html(value = {}, embedded = false) {
    const r = { enabled:false, intervalMinutes:45, durationMinutes:5, warningSeconds:10, mode:'normal', allScreens:true, sound:'none', ...value };
    const row = (name, field) => `<div class="settings-row reminder-setting-row"><div class="rest-setting-label">${name}${this.helpButton(name)}</div>${field}</div>`;
    const toggle = (key, title) => row(title, `<button type="button" class="app-switch ${r[key]?'on':''}" role="switch" aria-checked="${!!r[key]}" aria-label="${title}" data-rest-switch="${key}"><span></span></button>`);
    const number = (key, title, max, unit = '分钟') => row(title, `<span class="reminder-setting-field"><input aria-label="${title}" data-rest="${key}" type="number" min="1" max="${max}" step="1" required value="${Number(r[key])}"><span>${unit}</span></span>`);
    const select = (key, title, options) => row(title, `<select aria-label="${title}" data-rest="${key}">${options.map(([v,t])=>`<option value="${v}" ${v===r[key]?'selected':''}>${t}</option>`).join('')}</select>`);
    return (embedded ? '' : '<div class="settings-content-title">休息提醒</div>')
      + '<div class="settings-group"><div class="settings-section-title">休息节奏</div>'
      + toggle('enabled','开启休息提醒') + number('intervalMinutes','提醒间隔',240) + number('durationMinutes','休息时长',60)
      + '</div>'
      + '<div class="settings-group"><div class="settings-section-title">提醒方式</div>'
      + select('mode','提醒模式',[['normal','普通提醒'],['forced','强制休息']])
      + (r.mode === 'forced' ? number('warningSeconds','提前提示时间',300,'秒') : '')
      + toggle('allScreens','休息时覆盖全部显示器')
      + '</div>'
      + '<div class="settings-group"><div class="settings-section-title">声音与体验</div>'
      + select('sound','提示音',[['none','无（关闭）'],['knock','轻敲提示'],['notes','清亮三音']])
      + `<div class="settings-row"><div class="rest-setting-label"><button type="button" class="btn-secondary" id="restPreview">立即体验</button>${this.helpButton('立即体验')}</div></div><div class="settings-row settings-data-copy" id="restStatus" role="status"></div></div>`;
  },
  bind(main) {
    const content = document.getElementById('settingsContent');
    content.querySelectorAll('[data-rest-help]').forEach(button => {
      let pinned = false, closeTimer;
      const close = () => { clearTimeout(closeTimer); if(AppPopover.current?.owner === button)AppPopover.close(); };
      const deferClose = () => { clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!pinned && document.activeElement!==button)close();},150); };
      const show = () => {
        clearTimeout(closeTimer);
        if(AppPopover.current?.owner === button)return;
        const panel=document.createElement('div');panel.className='app-popover app-help-popover';panel.id='restHelpTip';panel.setAttribute('role','tooltip');
        panel.textContent=this.help[button.dataset.restHelp];
        panel.onmouseenter=()=>clearTimeout(closeTimer);panel.onmouseleave=deferClose;
        AppPopover.show(button,panel,button,()=>{pinned=false;button.setAttribute('aria-expanded','false');button.removeAttribute('aria-describedby');});
        button.setAttribute('aria-expanded','true');button.setAttribute('aria-describedby',panel.id);
      };
      button.onmouseenter=show;button.onmouseleave=deferClose;button.onfocus=show;button.onblur=close;
      button.onclick=()=>{if(pinned)close();else{show();pinned=true;}};
      button.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}};
    });
    content.querySelectorAll('[data-rest]').forEach(input => {
      input.id = 'rest-' + input.dataset.rest;
      input.onchange = async () => {
        if (!input.checkValidity()) { await main.alertAction({title:'输入有误',message:AppUI.validationMessage(input),focusTarget:input.id}); return; }
        input.disabled=true;
        await main.patchSettings({rest:{[input.dataset.rest]:input.type==='number'?Number(input.value):input.value}});
        main.renderSettingsModal();
        const next=document.getElementById(input.id); if(next)AppUI.focus(next);
      };
    });
    content.querySelectorAll('[data-rest-switch]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      await main.patchSettings({rest:{[button.dataset.restSwitch]:button.getAttribute('aria-checked')!=='true'}});
      main.renderSettingsModal();content.querySelector(`[data-rest-switch="${button.dataset.restSwitch}"]`)?.focus();
    });
    const status=content.querySelector('#restStatus');
    const update=async()=>{try{const s=await window.__TAURI__.core.invoke('rest_snapshot');if(!status.isConnected)return;status.textContent=s.error||({disabled:'当前未开启',waiting:`距下次提醒约 ${Math.ceil(s.remaining/60)} 分钟`,warning:'即将开始强制休息',prompt:'等待处理休息提醒',rest:'正在休息'})[s.phase];}catch(e){if(status.isConnected)status.textContent=window.__tauriErrMsg(e);}};
    void update();
    const timer=setInterval(()=>{if(!status.isConnected){clearInterval(timer);return;}void update();},2000);
    content.querySelector('#restPreview').onclick=async()=>{
      try{await window.__TAURI__.core.invoke('rest_action',{action:'preview',generation:0});await update();}
      catch(e){await main.alertAction({title:'体验失败',message:window.__tauriErrMsg(e)});}
    };
  }
};
