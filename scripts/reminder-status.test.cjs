const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
process.env.TZ='America/New_York';
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/js/reminder-status.js'),'utf8')+';this.status=ReminderStatus;',context);
const status=context.status;
const dateItem=(date,kind='end')=>({date,dateOnly:true,kind});

test('date-only deadlines remain today all day and become overdue at local midnight',()=>{
 const item=dateItem('2026-11-10');
 for(const time of ['2026-11-10T00:00:00','2026-11-10T09:31:00','2026-11-10T23:59:59']){
  const value=status.clock(item,new Date(time));
  assert.equal(value.text,'今日截止');assert.equal(value.overdue,false);
 }
 const value=status.clock(item,new Date('2026-11-11T00:00:00'));
 assert.equal(value.text,'已逾期 1 天');assert.equal(value.overdue,true);
 assert.equal(status.meta(item),'2026-11-10 截止 · 仅日期');
});
test('calendar day counts handle month/year boundaries and leap days',()=>{
 for(const [date,now,days] of [['2026-10-31','2026-11-03T12:00:00',3],['2025-12-31','2026-01-01T00:00:00',1],['2024-02-28','2024-03-01T00:00:00',2]]){
  assert.equal(status.clock(dateItem(date),new Date(now)).text,`已逾期 ${days} 天`);
 }
});
test('DST clock changes do not shorten or extend a calendar day count',()=>{
 assert.equal(status.clock(dateItem('2026-03-08'),new Date('2026-03-09T00:00:00')).text,'已逾期 1 天');
 assert.equal(status.clock(dateItem('2026-11-01'),new Date('2026-11-02T23:59:59')).text,'已逾期 1 天');
});
test('past start dates display elapsed days without an overdue warning',()=>{
 const value=status.clock(dateItem('2026-11-08','start'),new Date('2026-11-11T12:00:00'));
 assert.equal(value.text,'已开始 3 天');assert.equal(value.overdue,false);
 assert.equal(status.clock(dateItem('2026-11-11','start'),new Date('2026-11-11T12:00:00')).text,'今日开始');
});
test('future date and timed countdowns retain their original meaning',()=>{
 const now=new Date('2026-11-11T12:00:00');
 assert.equal(status.clock(dateItem('2026-11-12'),now).text,'2026-11-12 截止');
 const item={kind:'end',dateOnly:false,target:now.getTime()/1000+60};
 assert.equal(status.clock(item,now).text,'00:01:00');
 assert.equal(status.clock(item,new Date(now.getTime()+61000)).text,'已逾期 00:00:01');
 assert.equal(status.clock(item,new Date(now.getTime()+61000)).overdue,true);
 item.kind='start';
 assert.equal(status.clock(item,new Date(now.getTime()+61000)).text,'已开始 00:00:01');
 assert.equal(status.clock(item,new Date(now.getTime()+61000)).overdue,false);
});

function orderedFixture() {
 const now=new Date('2026-11-11T12:00:00');
 const timed=(key,seconds,kind='end')=>({key,kind,dateOnly:false,target:now.getTime()/1000+seconds});
 const dated=(key,date)=>({...dateItem(date),key,target:new Date(date+'T00:00:00').getTime()/1000});
 return {now,items:[dated('today','2026-11-11'),timed('start',-86400,'start'),timed('second',-1),timed('future',60),timed('minute',-60),dated('yesterday','2026-11-10')]};
}
test('even a one-second overdue deadline precedes today; older deadlines come first',()=>{
 const {now,items}=orderedFixture(),before=items.map(i=>i.key).join(',');
 assert.equal(status.sort(items,now).map(i=>i.key).join(','),'yesterday,minute,second,future,today,start');
 assert.equal(items.map(i=>i.key).join(','),before);
});
test('crossing a deadline and midnight retains consistent order and changes overdue status',()=>{
 const {now,items}=orderedFixture();
 const later=new Date(now.getTime()+60000),midnight=new Date('2026-11-12T00:00:00');
 assert.equal(status.clock(items.find(i=>i.key==='future'),later).overdue,true);
 assert.equal(status.sort(items,later).map(i=>i.key).join(','),'yesterday,minute,second,future,today,start');
 assert.equal(status.clock(items[0],midnight).overdue,true);
 assert.equal(status.sort(items,midnight).map(i=>i.key).join(','),'yesterday,today,minute,second,future,start');
});
test('mixed precision uses displayed overdue duration and ties remain stable',()=>{
 const now=new Date('2026-11-11T12:00:00');
 const day={...dateItem('2026-11-10'),key:'date',target:new Date('2026-11-10T00:00:00').getTime()/1000};
 const timed={kind:'end',dateOnly:false,target:now.getTime()/1000-17*3600};
 assert.equal(status.sort([day,{...timed,key:'b'},{...timed,key:'a'},{...timed,key:'older',target:now.getTime()/1000-25*3600}],now).map(i=>i.key).join(','),'older,date,a,b');
});
test('a timed reminder moves ahead when its displayed duration exceeds a calendar day',()=>{
 const now=new Date('2026-11-11T12:00:00');
 const items=[{...dateItem('2026-11-10'),key:'day',target:new Date('2026-11-10T00:00:00').getTime()/1000},{kind:'end',dateOnly:false,key:'timed',target:now.getTime()/1000-86399}];
 assert.equal(status.sort(items,now).map(i=>i.key).join(','),'day,timed');
 assert.equal(status.sort(items,new Date(now.getTime()+2000)).map(i=>i.key).join(','),'timed,day');
});
