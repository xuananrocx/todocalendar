const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
  const nodes=new Map(),events={},calls=[],frames=new Map();let clock=0,frameId=0,holdResolve;
  function node(id){if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:'',style:{setProperty(){}},listeners:{},querySelector(){return node(id+'-span');},addEventListener(e,fn){this.listeners[e]=fn;},setPointerCapture(){}});return nodes.get(id);}
  let state={phase:'rest',remaining:300,generation:1,quote:3,config:{mode:'forced',durationMinutes:5},theme:'dark',error:''};
  const document={getElementById:node,body:{classList:{toggle(){}}},documentElement:{dataset:{}},addEventListener(e,fn){events[e]=fn;}};
  const window={addEventListener(e,fn){events[e]=fn;},__TAURI__:{event:{listen:async(e,fn)=>events[e]=fn},core:{invoke:(name,args)=>{calls.push({name,args});if(name==='rest_snapshot')return Promise.resolve(structuredClone(state));if(args?.action==='hold')return new Promise(resolve=>holdResolve=resolve);return Promise.resolve();}}}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/js/rest-window.js'),'utf8'),{window,document,matchMedia:()=>({matches:false,addEventListener(){}}),setInterval(){},performance:{now:()=>clock},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
  return {node,events,calls,document,frames,setState:s=>state={...state,...s},ack:()=>holdResolve(),advance:ms=>{clock+=ms;const batch=[...frames.values()];frames.clear();batch.forEach(f=>f());}};
}
test('rest renders generic text and warning offers separate skip and dismiss controls',async()=>{
  const s=setup();await flush();assert.equal(s.node('quote').textContent,'事情忙不完，休息不能欠。');assert.equal(s.node('clock').textContent,'05:00');assert.equal(s.document.documentElement.dataset.theme,'dark');
  s.setState({phase:'warning',remaining:30,generation:2});await s.events['rest-changed']();assert.equal(s.node('actions').hidden,false);assert.equal(s.node('start').hidden,true);assert.equal(s.node('skip').hidden,true);assert.match(s.node('noticeTitle').textContent,/30 秒/);
  s.node('later').onclick();await flush();assert.ok(s.calls.some(c=>c.args?.action==='later'));
  assert.equal(s.node('skipWarning').hidden,false);assert.equal(s.node('dismissWarning').hidden,false);
  s.node('dismissWarning').onclick();await flush();assert.ok(s.calls.some(c=>c.args?.action==='dismissWarning'));
  s.node('skipWarning').onclick();await flush();assert.ok(s.calls.some(c=>c.args?.action==='skip'));
});
test('release before hold acknowledgement never schedules an exit',async()=>{
  const s=setup();await flush();s.node('exit').onpointerdown({button:0,pointerId:1});s.node('exit').listeners.pointerup();s.ack();await flush();s.advance(4000);
  assert.ok(s.calls.some(c=>c.args?.action==='cancelHold'));assert.ok(!s.calls.some(c=>c.args?.action==='exit'));assert.equal(s.frames.size,0);
});
test('continuous hold exits once and window blur cancels it',async()=>{
  const s=setup();await flush();s.node('exit').onpointerdown({button:0,pointerId:1});s.ack();await flush();s.advance(1900);assert.ok(!s.calls.some(c=>c.args?.action==='exit'));s.advance(100);await flush();assert.equal(s.calls.filter(c=>c.args?.action==='exit').length,1);
  s.node('exit').onpointerdown({button:0,pointerId:2});s.ack();await flush();s.events.blur();s.advance(4000);assert.equal(s.calls.filter(c=>c.args?.action==='exit').length,1);
});
test('new session invalidates a pending hold and renders normal actions',async()=>{
  const s=setup();await flush();s.node('exit').onpointerdown({button:0,pointerId:1});s.ack();await flush();s.setState({phase:'prompt',generation:2});await s.events['rest-changed']();s.advance(4000);assert.ok(!s.calls.some(c=>c.args?.action==='exit'));assert.equal(s.node('actions').hidden,false);assert.equal(s.node('restScreen').hidden,true);
});

test('normal preview is marked as an independent test and does not offer snoozing',async()=>{
  const s=setup();await flush();s.setState({phase:'prompt',preview:true});await s.events['rest-changed']();
  assert.equal(s.node('mode').textContent,'休息效果体验');assert.equal(s.node('skip').textContent,'结束体验 →');assert.equal(s.node('later').hidden,true);
  s.setState({preview:false});await s.events['rest-changed']();assert.equal(s.node('later').hidden,false);assert.equal(s.node('skip').textContent,'跳过本次 →');
});
