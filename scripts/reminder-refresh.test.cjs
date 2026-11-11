const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const nodes=new Map(['reminderList','reminderError','reminderCount','reminderLater','reminderAck'].map(id=>[id,{innerHTML:'',textContent:'',hidden:true,scrollTop:0,querySelectorAll:()=>[]}]));
 const handlers={}, requests=[], sizes=[];
 const document={getElementById:id=>nodes.get(id),querySelectorAll:()=>[],documentElement:{dataset:{}}};
 const window={addEventListener(){},__TAURI__:{event:{listen:async(name,cb)=>handlers[name]=cb},core:{invoke:(name,args)=>name==='reminder_snapshot'?new Promise(resolve=>requests.push(resolve)):Promise.resolve()}}};
 const context=vm.createContext({window,document,ReminderLayout:{height:()=>null},matchMedia:()=>({matches:false,addEventListener(){}}),setInterval(){},innerWidth:400,devicePixelRatio:1});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/js/reminder-status.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/js/reminder-window.js'),'utf8'),context);
 const snapshot=titles=>({items:titles.map((title,i)=>({key:'key'+i,title,kind:'start',target:1800000000,path:'Work'})),config:{snoozeMinutes:10},theme:'light',error:''});
 return {nodes,handlers,requests,snapshot};
}
test('events during an in-flight snapshot trigger a second fetch instead of dropping later reminders',async()=>{
 const s=setup();await flush();assert.equal(s.requests.length,1);
 const update=s.handlers['reminders-changed']();
 s.requests.shift()(s.snapshot(['A']));await flush();
 assert.equal(s.requests.length,1);
 assert.ok(!s.nodes.get('reminderList').innerHTML.includes('<h2>A</h2>'));
 s.requests.shift()(s.snapshot(['A','B']));await update;
 assert.equal(s.nodes.get('reminderCount').textContent,'2 项');
 assert.ok(s.nodes.get('reminderList').innerHTML.includes('<h2>B</h2>'));
});
test('several concurrent events coalesce and later removals update the complete summary',async()=>{
 const s=setup();await flush();s.requests.shift()(s.snapshot(['A','B']));await flush();
 const first=s.handlers['reminders-changed']();
 const second=s.handlers['reminders-changed']();
 const third=s.handlers['settings-changed']();
 assert.equal(s.requests.length,1);
 s.requests.shift()(s.snapshot(['A','B','C']));await flush();
 assert.equal(s.requests.length,1);
 s.requests.shift()(s.snapshot(['B','C']));await Promise.all([first,second,third]);
 assert.equal(s.nodes.get('reminderCount').textContent,'2 项');
 assert.ok(!s.nodes.get('reminderList').innerHTML.includes('<h2>A</h2>'));
 assert.ok(s.nodes.get('reminderList').innerHTML.includes('<h2>C</h2>'));
});
