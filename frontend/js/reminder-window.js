(() => {
  const invoke = window.__TAURI__.core.invoke;
  let items = [], config = {}, busy = false, refreshPromise = null, refreshPending = false, lastSignature = "";
  const list = document.getElementById('reminderList');
  const error = document.getElementById('reminderError');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let lastHeight = null, sizePending = false, sizing = false;
  async function fitWindow() {
    sizePending = true;
    if (sizing) return;
    sizing = true;
    try {
      while (sizePending) {
        sizePending = false;
        // Hidden WebViews can throttle animation frames; layout reads also flush styles.
        const height = ReminderLayout.height(document);
        if (height === null || height === lastHeight) continue;
        await invoke('reminder_resize', { height });
        lastHeight = height;
      }
    } catch (e) {
      lastHeight = null;
      invoke('diag_log', { msg: 'reminder-resize: ' + String(e) }).catch(() => {});
    } finally { sizing = false; }
  }
  function fail(e) { error.hidden=false;error.textContent=String(e);void fitWindow(); }
  function clocks() {
    const now=new Date();
    const sorted=ReminderStatus.sort(items,now);
    if(sorted.some((item,index)=>item.key!==items[index].key)) {
      items=sorted;
      // Move existing cards only when their order changes; keep buttons and scroll position.
      const scrollTop=list.scrollTop, focused=document.activeElement;
      const cards=new Map(Array.from(list.querySelectorAll('[data-reminder-key]'),el=>[el.dataset.reminderKey,el]));
      for(const item of items) { const card=cards.get(item.key);if(card)list.appendChild(card); }
      if(focused&&list.contains(focused)&&document.activeElement!==focused)focused.focus({preventScroll:true});
      list.scrollTop=scrollTop;
      void fitWindow();
    }
    list.querySelectorAll('[data-clock]').forEach(el => {
      const item=items.find(i=>i.key===el.dataset.clock);if(!item)return;
      const state=ReminderStatus.clock(item,now);
      el.textContent=state.text;
      el.classList.toggle('overdue',state.overdue);
      el.closest('.reminder-top').querySelector('.reminder-kind').classList.toggle('overdue',state.overdue);
    });
  }
  function render() {
    const scrollTop = list.scrollTop;
    items=ReminderStatus.sort(items);
    document.getElementById('reminderCount').textContent=`${items.length} 项`;
    document.getElementById('reminderLater').textContent=`稍后 ${config.snoozeMinutes || 10} 分钟`;
    list.innerHTML=items.length?items.map(i=>`<article class="reminder-item" data-reminder-key="${esc(i.key)}">
      <div class="reminder-top"><span class="reminder-kind ${i.kind==='end'?'end':''}">${i.kind==='end'?'◷ 截止提醒':'▷ 开始提醒'}</span><div class="reminder-clock ${i.kind==='end'?'':'start'}" data-clock="${esc(i.key)}"></div></div>
      <h2>${esc(i.title)}</h2><div class="reminder-path">${esc(i.path)}</div>
      <div class="reminder-meta"><span class="reminder-time">${esc(ReminderStatus.meta(i))}</span>${i.dateOnly?`<span class="reminder-batch">第 ${i.batch} / ${i.count} 次</span>`:''}</div>
      <div class="reminder-bottom"><button class="reminder-view" data-view="${esc(i.todoId)}">查看待办</button><div class="reminder-item-actions"><button class="btn" data-key="${esc(i.key)}" data-action="snooze">稍后提醒</button><button class="btn" data-key="${esc(i.key)}" data-action="ack">已知晓</button></div></div>
    </article>`).join(''):'<p class="reminder-empty">暂无待处理提醒</p>';
    document.querySelectorAll('button').forEach(b=>b.disabled=busy||!items.length);
    clocks();
    list.scrollTop = scrollTop;
    return fitWindow();
  }
  function refresh() {
    refreshPending = true;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        do {
          refreshPending = false;
          const data=await invoke('reminder_snapshot');
          // An event arrived while the snapshot was loading: fetch the latest first.
          if (refreshPending) continue;
          items=data.items;config=data.config;
          const dark=data.theme==='dark'||data.theme==='glass-dark'||data.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;
          document.documentElement.dataset.theme=dark?'dark':'light';
          error.hidden=!data.error;error.textContent=data.error;
          await render();
          const signature=items.map(i=>i.key+':'+i.batch).join('|');
          if(signature!==lastSignature){lastSignature=signature;invoke('diag_log',{msg:'reminder-rendered items='+items.length}).catch(()=>{});}
        } while (refreshPending);
      } catch(e){fail(e);} finally{refreshPromise=null;}
    })();
    return refreshPromise;
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
    // Only width or DPI changes alter wrapping. Countdown ticks never resize the window.
    let width = innerWidth, scale = devicePixelRatio;
    window.addEventListener('resize', () => {
      if (innerWidth !== width || devicePixelRatio !== scale) {
        width = innerWidth; scale = devicePixelRatio; lastHeight = null; void fitWindow();
      }
    });
    document.fonts?.ready.then(() => fitWindow());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change',refresh);
  }catch(e){fail(e);}})();
})();
