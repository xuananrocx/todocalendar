(() => {
  const invoke=window.__TAURI__.core.invoke, $=id=>document.getElementById(id);
  const phrases=[
    ['工位没有封印，起来走两步。','接杯水，伸个懒腰。事情等会儿再忙。'],
    ['你的眼睛申请五分钟带薪休假。','看一看远处，给肩膀也放个假。'],
    ['肩膀快和耳朵团建了，放松一下。','慢慢放松肩颈，换个舒服的姿势。'],
    ['事情忙不完，休息不能欠。','给自己几分钟，回来再从容地忙。'],
    ['进度条先停一停，给自己充点电。','你已经忙了一阵，接下来轮到休息。'],
    ['屏幕看够你了，换远处看看。','窗外的风景，不需要点击刷新。'],
    ['水杯：你是不是把我忘了？','起来喝口水，顺便活动一下。'],
    ['别卷了，椅子都替你累了。','让它独处几分钟，你也轻松一下。'],
    ['站起来巡视一下你的领地。','从工位走到窗边，也算一次小出发。'],
    ['脑内风扇有点响，该散散热了。','先歇一会儿，再回来继续。'],
    ['鼠标放下，肩膀也放下。','放松双手，给自己一个深呼吸。'],
    ['任务可以排队，休息别总插到最后。','这几分钟，优先照顾自己。'],
    ['世界不止眼前这几个窗口。','抬起头，看看更远的地方。'],
    ['今日限定任务：伸个懒腰。','无需审批，立即生效。'],
    ['你不是服务器，不用一直在线。','短暂离线，状态更佳。'],
    ['暂停营业，正在给人类充电。','稍后回来，继续从容地忙。']
  ];
  let snapshot=null,refreshing=false,pending=false,holding=false,holdToken=0,holdFrame=0,holdAt=0;
  const fail=e=>{$('error').hidden=false;$('error').textContent=String(e);};
  function render(s) {
    if(snapshot?.generation!==s.generation)cancelHold();
    snapshot=s;
    const dark=s.theme==='dark'||s.theme==='glass-dark'||s.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme=dark?'dark':'light';
    const rest=s.phase==='rest',notice=['prompt','warning'].includes(s.phase);
    document.body.classList.toggle('notice',!rest);
    $('restScreen').hidden=!rest;$('footer').hidden=!rest;$('noticeScreen').hidden=!notice;
    $('mode').textContent=s.config.mode==='forced'?'强制休息':'休息时间';
    const phrase=phrases[s.quote]||phrases[0];$('quote').textContent=phrase[0];$('subtitle').textContent=phrase[1];
    $('clock').textContent=String(Math.floor(s.remaining/60)).padStart(2,'0')+':'+String(s.remaining%60).padStart(2,'0');
    $('progress').style.width=Math.min(100,s.remaining/(s.config.durationMinutes*60)*100)+'%';
    $('noticeTitle').textContent=s.phase==='warning'?`${s.remaining} 秒后，休息一下` :phrase[0];
    $('noticeText').textContent=s.phase==='warning'?'先把手头的事情收个尾，即将进入全屏休息。':phrase[1];
    $('start').textContent=`开始休息 · ${s.config.durationMinutes} 分钟`;
    $('actions').hidden=!notice;$('start').hidden=s.phase!=='prompt';$('skip').hidden=s.phase!=='prompt';
    $('dismissWarning').hidden=s.phase!=='warning';$('skipWarning').hidden=s.phase!=='warning';
    $('error').hidden=!s.error;$('error').textContent=s.error;
  }
  async function refresh(){pending=true;if(refreshing)return;refreshing=true;try{do{pending=false;const s=await invoke('rest_snapshot');if(!pending)render(s);}while(pending);}catch(e){fail(e);}finally{refreshing=false;}}
  async function action(action,generation=snapshot?.generation){try{await invoke('rest_action',{action,generation});await refresh();}catch(e){fail(e);}}
  for(const id of ['start','later','skip','dismissWarning'])$(id).onclick=()=>action(id);
  $('skipWarning').onclick=()=>action('skip');
  function cancelHold(){const wasHolding=holding;holding=false;holdToken++;cancelAnimationFrame(holdFrame);$('exit').style.setProperty('--hold','0%');$('exit').querySelector('span').textContent='长按 2 秒紧急退出';if(wasHolding&&snapshot)void invoke('rest_action',{action:'cancelHold',generation:snapshot.generation}).catch(()=>{});}
  async function beginHold(){
    if(holding||snapshot?.phase!=='rest')return;holding=true;const token=++holdToken,generation=snapshot.generation;
    try{await invoke('rest_action',{action:'hold',generation});if(!holding||token!==holdToken)return;holdAt=performance.now();
      const frame=()=>{if(!holding||token!==holdToken)return;const elapsed=performance.now()-holdAt;
        $('exit').style.setProperty('--hold',Math.min(100,elapsed/20)+'%');$('exit').querySelector('span').textContent=`继续按住 · ${Math.max(1,Math.ceil((2000-elapsed)/1000))} 秒`;
        if(elapsed>=2000){holding=false;void action('exit',generation);return;}holdFrame=requestAnimationFrame(frame);};frame();
    }catch(e){cancelHold();fail(e);}
  }
  $('exit').onpointerdown=e=>{if(e.button!==0)return;$('exit').setPointerCapture(e.pointerId);void beginHold();};
  for(const event of ['pointerup','pointercancel','lostpointercapture','blur'])$('exit').addEventListener(event,cancelHold);
  $('exit').onkeydown=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();void beginHold();}};$('exit').onkeyup=cancelHold;
  window.addEventListener('blur',cancelHold);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelHold();});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(snapshot)render(snapshot);});
  (async()=>{try{await window.__TAURI__.event.listen('rest-changed',refresh);await window.__TAURI__.event.listen('settings-changed',refresh);await refresh();await invoke('rest_ready');setInterval(refresh,5000);}catch(e){fail(e);}})();
})();
