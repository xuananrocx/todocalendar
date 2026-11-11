const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function load(extra={}) {
  const context={structuredClone,...extra};vm.createContext(context);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/js/rest-settings.js'),'utf8')+'\nglobalThis.subject=RestSettings;',context);
  return context.subject;
}
test('legacy rest settings default to workdays and the two approved windows',()=>{
  const r=load(),s=r.schedule();
  assert.equal(s.enabled,true);assert.equal(s.dayMode,'workday');
  assert.deepEqual(JSON.parse(JSON.stringify(s.periods)),[{start:'09:00',end:'11:35'},{start:'13:30',end:'18:00'}]);
  assert.equal(r.scheduleError(s),'');
});
test('window validation rejects invalid, reversed, overlapping and empty custom choices',()=>{
  const r=load();
  for(const periods of [[],[{start:'9:00',end:'11:00'}],[{start:'12:00',end:'11:00'}],[{start:'09:00',end:'11:35'},{start:'11:00',end:'18:00'}]])assert.ok(r.scheduleError(r.schedule({periods})));
  assert.ok(r.scheduleError(r.schedule({dayMode:'custom',weekdays:[]})));
  assert.equal(r.scheduleError(r.schedule({periods:[{start:'09:00',end:'11:35'},{start:'11:35',end:'18:00'}]})),'');
});
test('adding a period finds a free interval rather than overlapping existing periods',()=>{
  const r=load();let periods=r.schedule().periods;
  for(let i=0;i<6;i++){const p=r.addedPeriod(periods);assert.ok(p);periods=[...periods,p];assert.equal(r.scheduleError(r.schedule({periods})),'');}
  assert.equal(r.addedPeriod([{start:'00:00',end:'23:59'}]),null);
});
test('schedule controls keep theme adapters and escape saved time values',()=>{
  const r=load();
  const html=r.scheduleHtml({dayMode:'custom',weekdays:[1,7],periods:[{start:'"><img src=x>',end:'11:35'}]});
  assert.doesNotMatch(html,/<img/);assert.match(html,/&quot;&gt;&lt;img/);
  assert.match(html,/type="time"/);assert.match(html,/data-rest-weekday="7" aria-label="周日" aria-pressed="true"/);
  assert.doesNotMatch(r.scheduleHtml({enabled:false}),/data-rest-period=/);
});
test('invalid time drafts stay visible without saving and a corrected pair saves together',async()=>{
  const nodes={toggle:{},mode:{value:'workday',id:'mode'},add:{}};
  const start={value:'12:00',id:'start',dataset:{restPeriod:'0',side:'start'}},end={value:'11:35',id:'end',dataset:{restPeriod:'0',side:'end'}};
  const fields=[start,end],saved=[],alerts=[];
  const content={querySelector:s=>s==='[data-rest-schedule-toggle]'?nodes.toggle:s==='[data-rest-day-mode]'?nodes.mode:nodes.add,querySelectorAll:s=>s==='[data-rest-period]'?fields:[]};
  const document={getElementById:()=>null};
  const r=load({document,AppUI:{focus(){}}});
  const main={state:{settings:{rest:{schedule:r.schedule({periods:[{start:'09:00',end:'11:35'}]})}}},patchSettings:async p=>saved.push(p),renderSettingsModal(){},alertAction:async a=>alerts.push(a)};
  r.bindSchedule(main,content);
  await start.onchange();assert.equal(saved.length,0);assert.equal(alerts.length,1);assert.equal(start.value,'12:00');
  end.value='13:00';await end.onchange();assert.equal(saved.length,1);
  assert.equal(saved[0].rest.schedule.periods[0].start,'12:00');assert.equal(saved[0].rest.schedule.periods[0].end,'13:00');
});

test('settings read the real timer and sound audition uses its independent command',async()=>{
  const nodes={restStatus:{isConnected:true},restSoundPreview:{},restPreview:{}},calls=[];
  const content={querySelector:s=>nodes[s.slice(1)],querySelectorAll:()=>[]};
  const document={getElementById:()=>content};
  const window={__TAURI__:{core:{invoke:async(name,args)=>{calls.push({name,args});return {phase:'waiting',remaining:2880,error:''};}}}};
  const r=load({document,window,setInterval(){}});r.bindSchedule=()=>{};
  r.bind({});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.restStatus.textContent,'距下次提醒约 48 分钟');
  assert.equal(calls[0].args.scheduled,true);
  await nodes.restSoundPreview.onclick();assert.equal(calls.at(-1).name,'rest_sound_preview');
  assert.ok(!calls.some(c=>c.name==='rest_action'));
  await nodes.restPreview.onclick();assert.ok(calls.some(c=>c.args?.action==='preview'));
  assert.equal(nodes.restStatus.textContent,'距下次提醒约 48 分钟');
});
