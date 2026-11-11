const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(name, context, exposed) {
  context.AppDialog ??= { alert: (message, options) => context.alert?.(message, options) };
  let source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', name), 'utf8');
  source = source.replace(/Main\.init\(\);\s*$/, '');
  vm.createContext(context);
  vm.runInContext(source + `\nglobalThis.subject = ${exposed};`, context);
  return context.subject;
}

test('settings startup failure stops initialization without resetting data', async () => {
  let resets = 0;
  let shown;
  const context = {
    console: { error() {} }, Icon: { render() {} }, document: { getElementById: () => null },
    API: {
      appVersion: async () => 'test',
      getSettings: async () => { throw 'damaged settings'; },
      resetSettings: async () => { resets++; },
    },
    window: { showStorageStartupError: error => { shown = error; } },
  };
  const main = load('main.js', context, 'Main');
  await main.init();
  assert.equal(resets, 0);
  assert.equal(shown, 'damaged settings');
});

for (const [method, startId, endId, titleId] of [
  ['saveModal', 'fStart', 'fEnd', 'fTitle'],
  ['saveBulkModal', 'fBulkStart', 'fBulkEnd', 'fBulkTitles'],
  ['saveBulkTreeModal', 'fTreeStart', 'fTreeEnd', 'fTreeTitles'],
]) {
  test(`${method} rejects reversed dates with a themed dialog and preserves the draft`, async () => {
    const fields = {
      [titleId]: { value: 'draft title' },
      [startId]: { value: '2026-11-10', type: 'date' },
      [endId]: { value: '2026-11-09', type: 'date' },
    };
    const messages = [];
    let writes = 0;
    const main = load('main.js', {
      document: { getElementById: id => fields[id] },
      Render: { localDateToISO: value => value + 'T00:00:00+08:00' },
      AppDialog: { alert: (message, options) => { messages.push({ message, options }); } },
      API: { create: async () => { writes++; }, update: async () => { writes++; } },
    }, 'Main');
    main.parentSelect = { getValue: () => '' };
    let closed = false;
    main.closeModal = main.closeBulkModal = main.closeBulkTreeModal = () => { closed = true; };
    await main[method]();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].message, '截止时间不能早于开始时间');
    assert.equal(messages[0].options.focusTarget, endId);
    assert.equal(writes, 0);
    assert.equal(closed, false);
    assert.equal(fields[titleId].value, 'draft title');
    assert.equal(fields[endId].value, '2026-11-09');
  });
}

test('failed settings save rolls back displayed preferences', async () => {
  const messages = [];
  const context = {
    Render: { renderAll() {} }, alert: msg => messages.push(msg),
    window: { __tauriErrMsg: String },
    API: { updateSettings: async () => { throw 'disk unavailable'; } },
  };
  const main = load('main.js', context, 'Main');
  main.state.settings = { theme: 'light' };
  main.applySettingsToDom = () => {};
  main.refreshDropdownValues = () => {};
  await main.patchSettings({ theme: 'dark' });
  assert.equal(main.state.settings.theme, 'light');
  assert.ok(messages.some(msg => msg.includes('disk unavailable')));
});

test('settings patches preserve the newer memo position and serialize overlapping saves', async () => {
  const sent = [];
  let active = 0;
  let maxActive = 0;
  const stored = { theme: 'light', compact: false, memoWinRect: [800, 300, 280, 480] };
  const main = load('main.js', {
    Render: { renderAll() {} }, alert: error => { throw Error(error); },
    window: { __tauriErrMsg: String },
    API: { updateSettings: async patch => {
      active++; maxActive = Math.max(maxActive, active);
      sent.push(Object.keys(patch));
      await new Promise(resolve => setImmediate(resolve));
      Object.assign(stored, patch); active--;
      return { ...stored };
    } },
  }, 'Main');
  main.state.settings = { theme: 'light', compact: false, memoWinRect: [100, 100, 280, 480] };
  main.applySettingsToDom = () => {};
  main.refreshDropdownValues = () => {};
  await Promise.all([main.patchSettings({ theme: 'dark' }), main.patchSettings({ compact: true })]);
  assert.deepEqual(sent, [['theme'], ['compact']]);
  assert.equal(maxActive, 1);
  assert.equal(stored.theme, 'dark');
  assert.equal(stored.compact, true);
  assert.equal(stored.memoWinRect[0], 800);
  assert.equal(main.state.settings.memoWinRect[0], 800);
});

test('failed memo load preserves the last loaded entries and reports the error', async () => {
  const messages = [];
  const memo = load('memo.js', {
    console: { warn() {} }, window: { __tauriErrMsg: String },
    API: { listMemos: async () => { throw 'damaged memos'; } },
    Main: { alertAction: async msg => messages.push(msg) },
  }, 'Memo');
  const original = [{ id: 'existing', title: 'keep me' }];
  memo.entries = original;
  memo.render = () => {};
  await memo.load();
  assert.equal(memo.entries, original);
  assert.equal(messages[0].message, 'damaged memos');
});

test('failed memo save keeps the editor open and its input intact', async () => {
  const fields = {
    fMemoTitle: { value: 'unsaved title' }, fMemoBody: { value: 'unsaved body' },
    fMemoPinned: { checked: false },
  };
  let closed = false;
  const messages = [];
  const memo = load('memo.js', {
    document: { getElementById: id => fields[id] }, window: { __tauriErrMsg: String },
    API: { saveMemoEntry: async () => { throw 'replace failed'; } },
    Main: { alertAction: async msg => messages.push(msg) },
  }, 'Memo');
  memo._readLinkRows = () => [];
  memo.closeEdit = () => { closed = true; };
  await memo.saveEdit();
  assert.equal(closed, false);
  assert.equal(fields.fMemoTitle.value, 'unsaved title');
  assert.equal(fields.fMemoBody.value, 'unsaved body');
  assert.ok(messages[0].message.includes('replace failed'));
});

test('failed todo save keeps the editor open for retry', async () => {
  let closed = false;
  const messages = [];
  const fields = { fTitle: { value: 'draft' }, fStart: { value: '' }, fEnd: { value: '' } };
  const main = load('main.js', {
    document: { getElementById: id => fields[id] },
    window: { __tauriErrMsg: String }, alert: msg => messages.push(msg),
    API: { create: async () => { throw 'write failed'; } },
  }, 'Main');
  main.parentSelect = { getValue: () => null };
  main._readInput = () => null;
  main.closeModal = () => { closed = true; };
  await main.saveModal();
  assert.equal(closed, false);
  assert.equal(fields.fTitle.value, 'draft');
  assert.ok(messages[0].includes('write failed'));
});

for (const scope of ['data', 'legacyTasks']) {
  test(`import confirms ${scope} scope and reloads only affected content`, async () => {
    const imported = [];
    let memoLoads = 0;
    let confirmation;
    const main = load('main.js', {
      alert() {}, window: { __tauriErrMsg: String },
      Memo: { load: async () => { memoLoads++; } },
      API: {
        pickOpenPath: async () => 'chosen.json',
        inspectImport: async () => scope,
        importDataFromPath: async (...args) => { imported.push(args); },
      },
    }, 'Main');
    main.confirmAction = async options => { confirmation = options.message; return true; };
    main.reload = async () => {};
    await main.handleDataAction('importJson');
    assert.deepEqual(imported, [['chosen.json', scope]]);
    assert.equal(memoLoads, scope === 'data' ? 1 : 0);
    assert.ok(confirmation.includes(scope === 'data' ? '归档和备忘录，设置不变' : '备忘录及设置不变'));
  });
}

test('cancelled import and invalid preview never invoke replacement', async () => {
  for (const invalid of [false, true]) {
    let writes = 0;
    let confirmations = 0;
    const main = load('main.js', {
      alert() {}, window: { __tauriErrMsg: String },
      API: {
        pickOpenPath: async () => 'chosen.json',
        inspectImport: async () => { if (invalid) throw 'invalid file'; return 'data'; },
        importDataFromPath: async () => { writes++; },
      },
    }, 'Main');
    main.confirmAction = async () => { confirmations++; return false; };
    await main.handleDataAction('importJson');
    assert.equal(writes, 0);
    assert.equal(confirmations, invalid ? 0 : 1);
  }
});


test('editing explicit midnight preserves concrete time precision', () => {
  const input = {value: '', type: 'date'};
  const main = load('main.js', {document: {getElementById: () => input}}, 'Main');
  main._setInputPrecision = (_id, timed) => {input.type = timed ? 'datetime-local' : 'date';};
  main._renderDateDisplay = () => {};
  // Supply the real conversion helpers through the same VM context.
  const context = {document: {getElementById: () => input}, Render: {
    isoToLocalInput: () => '2026-11-09T00:00', isoToLocalDate: () => '2026-11-09'
  }};
  const editor = load('main.js', context, 'Main');
  editor._setInputPrecision = main._setInputPrecision;
  editor._renderDateDisplay = () => {};
  editor._writeInput('fStart', '2026-11-09T00:00:00+08:00', true);
  assert.equal(input.type, 'datetime-local');
  editor._writeInput('fStart', '2026-11-09T00:00:00+08:00', false);
  assert.equal(input.type, 'date');
});
