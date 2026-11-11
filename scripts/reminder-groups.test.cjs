const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../frontend/js/reminder-settings.js'), 'utf8') + '\nthis.settingsUI = ReminderSettings;', context);
const ui = context.settingsUI;
test('legacy reminder settings include default and all groups in display order', () => {
  const groups = [{id:'b',name:'B',order:2},{id:'a',name:'A',order:1}];
  const result = ui.groupOptions({}, groups, {defaultGroupName:'Inbox'});
  assert.deepEqual(Array.from(result, g => g.name), ['Inbox','A','B']);
  assert.ok(result.every(g => g.enabled));
  assert.equal(groups[0].id, 'b');
});
test('explicit group choices survive renaming and override new group preference', () => {
  const r = {defaultGroupEnabled:false,newGroupEnabled:false,groupEnabled:{work:true,muted:false}};
  const result = ui.groupOptions(r, [{id:'work',name:'Renamed'},{id:'muted',name:'Muted'},{id:'new',name:'New'}]);
  assert.deepEqual(Array.from(result, g => g.enabled), [false,true,false,false]);
  assert.equal(ui.groupSummary(result), '已选择 1 / 4 个分组');
});
test('deleted groups do not affect count and all-off remains explicit', () => {
  const result = ui.groupOptions({defaultGroupEnabled:false,groupEnabled:{deleted:true}}, []);
  assert.equal(ui.groupSummary(result), '未选择分组');
  assert.equal(ui.groupSummary(ui.groupOptions({}, [])), '全部分组（1）');
});
test('settings panel does not inject group names as HTML', () => {
  const html = ui.html({}, [{id:'a',name:'<img src=x onerror=alert(1)>'}]);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('aria-haspopup="dialog"'));
});
