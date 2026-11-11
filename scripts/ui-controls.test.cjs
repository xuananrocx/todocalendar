const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadUI(context = {}) {
  context.document ??= { readyState: 'loading', addEventListener() {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/ui.js'), 'utf8')
    + '\nglobalThis.ui = { AppDialog, AppDatePicker, AppUI };', context);
  return context.ui;
}

test('calendar accepts real leap days and rejects normalized invalid dates', () => {
  const { AppDatePicker: picker } = loadUI();
  for (const date of ['2028-02-29', '2000-02-29', '0099-01-31', '0001-01-01', '9999-12-31']) {
    assert.equal(picker.dateString(picker.parseDate(date)), date);
  }
  for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '0000-01-01', '2026-13-01', '2026-2-01', '']) {
    assert.equal(picker.parseDate(date), null, date);
  }
  assert.equal(picker.dateString(picker.monthStart(picker.parseDate('0099-12-31'))), '0099-12-01');
});

test('queued prompts resolve independently and restore the original external focus', async () => {
  const elements = new Map();
  const document = { readyState: 'loading', addEventListener() {}, getElementById: id => elements.get(id) };
  const button = () => ({ hidden: false, isConnected: true, classList: { toggle() {} }, focus() { document.activeElement = this; } });
  const original = button();
  document.activeElement = original;
  const mask = { hidden: true, querySelector: () => ({ classList: { toggle() {} } }) };
  elements.set('confirmMask', mask);
  for (const id of ['confirmTitle', 'confirmMessage', 'confirmIcon', 'btnConfirmAccept', 'btnConfirmCancel']) elements.set(id, button());
  const { AppDialog: dialog } = loadUI({ document, requestAnimationFrame: callback => callback() });
  dialog.ensure = () => mask;
  const first = dialog.alert('First');
  const second = dialog.confirm({ message: 'Second' });
  assert.equal(elements.get('confirmMessage').textContent, 'First');
  assert.equal(elements.get('btnConfirmCancel').hidden, true);
  dialog.close(true);
  assert.equal(await first, true);
  assert.equal(mask.hidden, false);
  assert.equal(elements.get('confirmMessage').textContent, 'Second');
  assert.equal(elements.get('btnConfirmCancel').hidden, false);
  dialog.close(false);
  assert.equal(await second, false);
  assert.equal(mask.hidden, true);
  assert.equal(document.activeElement, original);
});

test('validation message explains numeric limits without browser validation bubbles', () => {
  const { AppUI: ui } = loadUI();
  const field = { value: '13', max: '12', validity: { rangeOverflow: true }, getAttribute: () => '提醒次数' };
  assert.equal(ui.validationMessage(field), '提醒次数不能大于 12');
  field.value = '';
  assert.equal(ui.validationMessage(field), '请输入有效的提醒次数');
});
