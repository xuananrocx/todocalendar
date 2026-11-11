const RestSettings = {
  help: {
    '开启休息提醒':'定时提醒起身走走、喝水和放松，不关联待办。仅在软件运行时计时；休息期间暂缓待办提醒，结束后汇总，系统中已有通知不会被删除。',
    '提醒间隔':'从进入提醒时段、开启功能或一次休息结束后重新计时，各时段独立计算。锁屏、休眠或重新打开软件后重新计算间隔，不补提醒；修改配置后也会重新计时。',
    '仅在指定时段提醒':'开启后仅在所选日期和时段内计时。时段结束时收起未处理的普通提醒和强制预告，取消稍后提醒；已开始的休息继续到结束。下一时段重新计时，不累计午休前的剩余时间。关闭后全天计时。',
    '提醒日期':'工作日跟随软件的法定节假日和调休数据：法定假日不提醒，调休上班日提醒；未覆盖的日期按周一至周五判断。每天和自定义星期不受节假日影响。',
    '时段':'可设置 1–8 段，开始时间须早于结束时间，时段不能重叠。不支持单段跨午夜。时间支持滚动选择或输入。',
    '休息时长':'休息结束后自动返回，可持续长按 2 秒紧急退出。文案自动随机轮换，5 分钟休息约每 18 秒换一句，随时长在 10–30 秒内自适应；全部展示后再重新随机。',
    '提醒模式':'普通模式先弹窗，可开始休息、稍后 5 分钟或跳过。强制模式在预告倒计时结束后自动进入全屏；预告可稍后 5 分钟或跳过本次，稍后到期会重新预告。全屏不锁定 Windows。',
    '提前提示时间':'进入强制休息前的预告时长，默认 10 秒，可设置 1–300 秒。「关闭弹窗」仅隐藏预告，到点仍休息；「跳过此次休息」重新计算下次提醒间隔。',
    '休息时覆盖全部显示器':'默认覆盖全部显示器；关闭后只覆盖主显示器。多屏的倒计时和文案同步，任意屏幕长按 2 秒退出会同时结束本次休息。',
    '提示音':'无表示关闭声音。选择提示音后，在提醒时播放一次，使用下方配置的音量，并遵守 Windows 勿扰状态。',
    '自带提示音音量':'仅调整休息提醒的自带提示音，范围 0–100%，默认 50%。试听使用当前配置，遵守 Windows 勿扰状态，不影响下次提醒时间。',
    '休息效果立即体验':'单独测试当前模式和休息时长，无需开启总开关。正式提醒倒计时继续，不因体验开始或结束而重置；体验期间到点的正式提醒将在体验结束后展示。强制模式直接进入全屏，可持续长按 2 秒退出。'
  },
  helpButton(name) {
    return `<button type="button" class="rest-help-button" data-rest-help="${name}" aria-label="${name}说明" aria-expanded="false">?</button>`;
  },
  schedule(value = {}) {
    return { enabled:true, dayMode:'workday', weekdays:[1,2,3,4,5], periods:[{start:'09:00',end:'11:35'},{start:'13:30',end:'18:00'}], ...value };
  },
  scheduleError(s) {
    if (!['workday','everyday','custom'].includes(s.dayMode)) return '请选择有效的提醒日期';
    if (s.dayMode === 'custom' && !s.weekdays.length) return '请至少选择一个提醒日期';
    if (!s.periods.length || s.periods.length > 8) return '提醒时段须为 1–8 段';
    const ranges=[];
    for (const p of s.periods) {
      if (![p.start,p.end].every(t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return '请输入完整有效的时段时间';
      if (p.start >= p.end) return '提醒时段的结束时间须晚于开始时间';
      ranges.push(p);
    }
    ranges.sort((a,b)=>a.start.localeCompare(b.start));
    if(ranges.some((p,i)=>i>0 && ranges[i-1].end>p.start))return '提醒时段不能重叠';
    return '';
  },
  addedPeriod(periods) {
    const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
    const time=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    const ranges=periods.map(p=>[minute(p.start),minute(p.end)]).sort((a,b)=>a[0]-b[0]);
    const last=ranges.at(-1)?.[1]||0;
    if(last+60<=1439)return {start:time(last),end:time(last+60)};
    let start=0;
    for(const [from,to] of [...ranges,[1439,1439]]){
      if(from-start>=30)return {start:time(start),end:time(Math.min(from,start+60))};
      start=Math.max(start,to);
    }
    return null;
  },
  scheduleHtml(value) {
    const s=this.schedule(value),esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return '<div class="settings-group rest-schedule"><div class="settings-section-title">提醒时段</div>'
      + `<div class="settings-row reminder-setting-row"><div class="rest-setting-label">仅在指定时段提醒${this.helpButton('仅在指定时段提醒')}</div><button type="button" class="app-switch ${s.enabled?'on':''}" role="switch" aria-checked="${s.enabled}" aria-label="仅在指定时段提醒" data-rest-schedule-toggle><span></span></button></div>`
      + (s.enabled ? `<div class="settings-row reminder-setting-row"><div class="rest-setting-label">提醒日期${this.helpButton('提醒日期')}</div><select aria-label="提醒日期" id="rest-dayMode" data-rest-day-mode>${[['workday','工作日'],['everyday','每天'],['custom','自定义']].map(([v,l])=>`<option value="${v}" ${s.dayMode===v?'selected':''}>${l}</option>`).join('')}</select></div>`
        + (s.dayMode==='custom'?`<div class="settings-row rest-weekdays" role="group" aria-label="自定义提醒日期">${['一','二','三','四','五','六','日'].map((d,i)=>`<button type="button" data-rest-weekday="${i+1}" aria-label="周${d}" aria-pressed="${s.weekdays.includes(i+1)}">周${d}</button>`).join('')}</div>`:'')
        + `<div class="settings-row rest-period-heading"><div class="rest-setting-label">时段${this.helpButton('时段')}</div></div>`
        + s.periods.map((p,i)=>`<div class="settings-row rest-period-row"><span class="rest-period-name">时段 ${i+1}</span><div class="rest-period-times"><input type="time" required aria-label="时段 ${i+1}开始" id="rest-period-${i}-start" data-rest-period="${i}" data-side="start" value="${esc(p.start)}"><span aria-hidden="true">—</span><input type="time" required aria-label="时段 ${i+1}结束" id="rest-period-${i}-end" data-rest-period="${i}" data-side="end" value="${esc(p.end)}"></div><button type="button" class="btn ghost" data-rest-delete-period="${i}" aria-label="删除时段 ${i+1}" ${s.periods.length===1?'disabled':''}>删除</button></div>`).join('')
        + `<div class="settings-row"><button type="button" class="btn-secondary" id="restAddPeriod" ${s.periods.length>=8?'disabled':''}>＋ 添加时段</button></div>`:'')
      + '</div>';
  },
  html(value = {}, embedded = false) {
    const r = { enabled:false, intervalMinutes:45, durationMinutes:5, warningSeconds:10, mode:'normal', allScreens:true, sound:'none', volume:50, ...value };
    const row = (name, field) => `<div class="settings-row reminder-setting-row"><div class="rest-setting-label">${name}${this.helpButton(name)}</div>${field}</div>`;
    const toggle = (key, title) => row(title, `<button type="button" class="app-switch ${r[key]?'on':''}" role="switch" aria-checked="${!!r[key]}" aria-label="${title}" data-rest-switch="${key}"><span></span></button>`);
    const number = (key, title, max, unit = '分钟', min = 1) => row(title, `<span class="reminder-setting-field"><input aria-label="${title}" data-rest="${key}" type="number" min="${min}" max="${max}" step="1" required value="${Number(r[key])}"><span>${unit}</span></span>`);
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
      + this.scheduleHtml(r.schedule)
      + '<div class="settings-group"><div class="settings-section-title">声音与体验</div>'
      + select('sound','提示音',[['none','无（关闭）'],['knock','轻敲提示'],['notes','清亮三音']])
      + number('volume','自带提示音音量',100,'%',0)
      + `<div class="settings-row"><button type="button" class="btn-secondary" id="restSoundPreview" ${r.sound==='none'?'disabled':''}>试听</button></div>`
      + `<div class="settings-row rest-preview-row"><div class="rest-setting-label"><button type="button" class="btn-secondary" id="restPreview">休息效果立即体验</button>${this.helpButton('休息效果立即体验')}</div></div><div class="settings-row settings-data-copy" id="restStatus" role="status"></div></div>`;
  },
  bind(main) {
    const content = document.getElementById('settingsContent');
    this.bindSchedule(main,content);
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
    const update=async()=>{try{const s=await window.__TAURI__.core.invoke('rest_snapshot',{scheduled:true});if(!status.isConnected)return;status.textContent=s.error||({disabled:'当前未开启',outside:s.nextStart?`当前不在提醒时段，下次 ${s.nextStart} 开始计时`:'当前不在提醒时段',waiting:`距下次提醒约 ${Math.ceil(s.remaining/60)} 分钟`,warning:'即将开始强制休息',prompt:'等待处理休息提醒',rest:'正在休息'})[s.phase];}catch(e){if(status.isConnected)status.textContent=window.__tauriErrMsg(e);}};
    void update();
    const timer=setInterval(()=>{if(!status.isConnected){clearInterval(timer);return;}void update();},2000);
    content.querySelector('#restSoundPreview').onclick=async()=>{
      try{await window.__TAURI__.core.invoke('rest_sound_preview');}
      catch(e){await main.alertAction({title:'试听失败',message:window.__tauriErrMsg(e)});}
    };
    content.querySelector('#restPreview').onclick=async()=>{
      try{await window.__TAURI__.core.invoke('rest_action',{action:'preview',generation:0});await update();}
      catch(e){await main.alertAction({title:'体验失败',message:window.__tauriErrMsg(e)});}
    };
  },
  bindSchedule(main,content) {
    const current=()=>structuredClone(this.schedule(main.state.settings.rest?.schedule));
    let busy=false;
    const save=async(s,focus)=>{
      if(busy)return;
      const error=this.scheduleError(s);
      if(error){await main.alertAction({title:'时段设置有误',message:error,focusTarget:focus});return;}
      busy=true;
      try{await main.patchSettings({rest:{schedule:s}});main.renderSettingsModal();
        const next=focus&&document.getElementById(focus);if(next)AppUI.focus(next);
      }finally{busy=false;}
    };
    content.querySelector('[data-rest-schedule-toggle]').onclick=()=>{const s=current();s.enabled=!s.enabled;return save(s);};
    const mode=content.querySelector('[data-rest-day-mode]');
    if(mode)mode.onchange=()=>{const s=current();s.dayMode=mode.value;return save(s,mode.id);};
    content.querySelectorAll('[data-rest-weekday]').forEach(button=>button.onclick=()=>{
      const s=current(),day=Number(button.dataset.restWeekday);
      s.weekdays=s.weekdays.includes(day)?s.weekdays.filter(d=>d!==day):[...s.weekdays,day].sort((a,b)=>a-b);
      return save(s);
    });
    content.querySelectorAll('[data-rest-period]').forEach(input=>input.onchange=()=>{
      const s=current();
      content.querySelectorAll('[data-rest-period]').forEach(field=>s.periods[Number(field.dataset.restPeriod)][field.dataset.side]=field.value);
      return save(s,input.id);
    });
    content.querySelectorAll('[data-rest-delete-period]').forEach(button=>button.onclick=()=>{
      const s=current();s.periods.splice(Number(button.dataset.restDeletePeriod),1);return save(s);
    });
    const add=content.querySelector('#restAddPeriod');
    if(add)add.onclick=()=>{const s=current(),period=this.addedPeriod(s.periods);
      if(!period)return main.alertAction({title:'无法添加时段',message:'没有可用的连续 30 分钟时段，请先调整现有时段。'});
      s.periods.push(period);return save(s);
    };
  }
};
