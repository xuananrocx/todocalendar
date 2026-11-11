const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const ctx=vm.createContext({getComputedStyle:el=>el.style});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../frontend/js/reminder-layout.js'),'utf8')+';this.layout=ReminderLayout;',ctx);
const element=(height,style={},hidden=false)=>({hidden,style,getBoundingClientRect:()=>({height})});
function documentFor(heights,errorHeight=0){
 const cards=heights.map(h=>element(h,{marginBottom:'8px'}));
 const header=element(40),footer=element(44),error=element(errorHeight,{marginTop:'12px'},!errorHeight),list=element(500,{paddingTop:'10px',paddingBottom:'10px'});
 return {querySelectorAll:()=>cards,querySelector:s=>s.includes('header')?header:footer,getElementById:id=>id==='reminderList'?list:error};
}
test('one/two/three cards grow naturally; extra cards do not enlarge the window',()=>{
 assert.equal(ctx.layout.height(documentFor([120])),232);
 assert.equal(ctx.layout.height(documentFor([120,120])),360);
 assert.equal(ctx.layout.height(documentFor([120,120,120])),488);
 assert.equal(ctx.layout.height(documentFor([120,120,120,300,300])),488);
});
test('long cards cap height while errors and margins are included',()=>{
 assert.equal(ctx.layout.height(documentFor([700])),520);
 assert.equal(ctx.layout.height(documentFor([120],20)),264);
 assert.equal(ctx.layout.height(documentFor([1])),160);
});
test('removing cards shrinks height; zero cards leaves hiding to the service',()=>{
 assert.equal(ctx.layout.height(documentFor([120,120,120])),488);
 assert.equal(ctx.layout.height(documentFor([120])),232);
 assert.equal(ctx.layout.height(documentFor([])),null);
});
