(() => {
  const invoke = window.__TAURI__.core.invoke;
  let items = [], config = {}, busy = false, refreshing = false, lastSignature = "";
  const list = document.getElementById('reminderList');
  const error = document.getElementById('reminderError');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function fail(e) { error.hidden=false;error.textContent=String(e); }
  function clocks() {
    const now=Date.now()/1000;
    list.querySelectorAll('[data-clock]').forEach(el => {
      const item=items.find(i=>i.key===el.dataset.clock);if(!item)return;
      const kind=item.kind==='end'?'截止':'开始';
      if(item.dateOnly) {
        const today=new Date();const date=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
        el.textContent=item.date===date?`今日${kind}`:`${item.date} ${kind}`;
        el.classList.toggle('overdue',item.kind==='end'&&item.date<date);return;
      }
      const seconds=Math.ceil(item.target-now),n=Math.abs(seconds);
      const days=Math.floor(n/86400),h=Math.floor(n%86400/3600),m=Math.floor(n%3600/60),s=n%60;
      const duration=`${days?days+'天 ':''}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      el.textContent=seconds>0?duration:(item.kind==='end'?'已逾期 ':'已开始 ')+duration;
      el.classList.toggle('overdue',seconds<=0&&item.kind==='end');
    });
  }
  function render() {
    document.getElementById('reminderCount').textContent=`${items.length} 项`;
    document.getElementById('reminderLater').textContent=`稍后 ${config.snoozeMinutes || 10} 分钟`;
    list.innerHTML=items.length?items.map(i=>`<article class="reminder-item">
      <div class="reminder-top"><span class="reminder-kind ${i.kind==='end'?'end':''}">${i.kind==='end'?'◷ 截止提醒':'▷ 开始提醒'}</span><div class="reminder-clock ${i.kind==='end'?'':'start'}" data-clock="${esc(i.key)}"></div></div>
      <h2>${esc(i.title)}</h2><div class="reminder-path">${esc(i.path)}</div>
      <div class="reminder-meta"><span class="reminder-time">${i.dateOnly?'未指定具体时间':new Date(i.target*1000).toLocaleString('zh-CN')+' · '+(i.kind==='end'?'截止':'开始')}</span>${i.dateOnly?`<span class="reminder-batch">第 ${i.batch} / ${i.count} 次</span>`:''}</div>
      <div class="reminder-bottom"><button class="reminder-view" data-view="${esc(i.todoId)}">查看待办</button><div class="reminder-item-actions"><button class="btn" data-key="${esc(i.key)}" data-action="snooze">稍后提醒</button><button class="btn" data-key="${esc(i.key)}" data-action="ack">已知晓</button></div></div>
    </article>`).join(''):'<p class="reminder-empty">暂无待处理提醒</p>';
    document.querySelectorAll('button').forEach(b=>b.disabled=busy||!items.length);
    clocks();
  }
  async function refresh() {
    if(refreshing)return;refreshing=true;
    try {
      const data=await invoke('reminder_snapshot');
      items=data.items;config=data.config;
      const dark=data.theme==='dark'||data.theme==='glass-dark'||data.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme=dark?'dark':'light';
      error.hidden=!data.error;error.textContent=data.error;
      render();
      const signature=items.map(i=>i.key+':'+i.batch).join('|');
      if(signature!==lastSignature){lastSignature=signature;invoke('diag_log',{msg:'reminder-rendered items='+items.length}).catch(()=>{});}
    } catch(e){fail(e);} finally{refreshing=false;}
  }
  async function act(action,keys) {
    if(busy||!keys.length)return;busy=true;render();
    try {await invoke('reminder_action',{action,keys});await refresh();}catch(e){fail(e);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=!items.length);}
  }
  list.onclick=e=>{const view=e.target.closest('[data-view]');if(view){invoke('reminder_open_todo',{id:view.dataset.view}).catch(fail);return;}const b=e.target.closest('[data-action]');if(b)act(b.dataset.action,[b.dataset.key]);};
  document.getElementById('reminderAck').onclick=()=>act('ack',items.map(i=>i.key));
  document.getElementById('reminderLater').onclick=()=>act('snooze',items.map(i=>i.key));
  (async()=>{try {
    await window.__TAURI__.event.listen('reminders-changed',refresh);
    await window.__TAURI__.event.listen('settings-changed',refresh);
    await window.__TAURI__.event.listen('reminder-error',e=>fail(e.payload));
    await refresh();await invoke('reminder_ready');await invoke('diag_log',{msg:'reminder-ready'});
    setInterval(clocks,1000);setInterval(refresh,15000);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change',refresh);
  }catch(e){fail(e);}})();
})();
