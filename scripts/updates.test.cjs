const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/updates.js'), 'utf8');
const release = (version, body = version) => ({ tag_name: 'v' + version, body, published_at: '2026-11-11T02:00:00Z', html_url: 'https://github.com/xuananrocx/todocalendar/releases/tag/v' + version });
const response = data => ({ ok: true, json: async () => data });
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(storage = new Map()) {
  let now = Date.parse('2026-11-12T12:00:00Z'), focus = true, phase = 'waiting', overlays = [];
  const nodes = new Map(), calls = [], events = {}, windowEvents = {};
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, hidden: true, className: '', textContent: '', innerHTML: '', isConnected: true, matches: () => false,
      getClientRects() { return this.hidden ? [] : [{}]; }, focus() { document.activeElement = this; }, querySelectorAll: () => [], setAttribute() {} });
    return nodes.get(id);
  };
  const document = { body: { classList: { add() {}, remove() {} } }, visibilityState: 'visible', activeElement: node('original'), hasFocus: () => focus, getElementById: node,
    querySelectorAll: () => overlays, addEventListener: (event, fn) => { (events[event] ||= []).push(fn); } };
  document.activeElement.hidden = false;
  for (const id of ['btnDownloadUpdate', 'btnLaterUpdate', 'btnCloseUpdate', 'updateScroll']) node(id).hidden = false;
  const main = { _cachedVersion: '0.4.51', editingId: null, state: { settings: { appAutoUpdate: false }, bulkMode: false }, _attachMaskClose() {}, closeHelp() { node('helpMask').hidden = true; }, notify() {} };
  const context = { document, URL, AbortController, setTimeout, clearTimeout, setInterval() {},
    Date: class extends Date { static now() { return now; } }, console: { warn() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    window: { addEventListener: (event, fn) => { windowEvents[event] = fn; }, __TAURI__: { core: { invoke: async name => { calls.push(name); return { phase }; } } } },
    API: { appVersion: async () => main._cachedVersion, openExternal: async url => calls.push(url) }, Icon: { externalLink: () => '<svg></svg>' },
    fetch: async () => { throw new Error('offline'); },
  };
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.releases = UpdateReleases; globalThis.checker = UpdateChecker;', context);
  return { context, releases: context.releases, checker: context.checker, main, storage, node, calls, events, windowEvents,
    advance: ms => now += ms, focus: value => focus = value, phase: value => phase = value,
    overlay: id => { const item = node(id); item.hidden = false; overlays = [item]; }, clearOverlays: () => overlays = [],
  };
}

test('versions compare numerically, preserve prerelease ordering and reject invalid tags', () => {
  const { releases: r } = setup();
  assert.ok(r.compare('v0.4.10', '0.4.9') > 0);
  assert.ok(r.compare('0.4.55', '0.4.55-beta.2') > 0);
  assert.ok(r.compare('0.4.55-beta.11', '0.4.55-beta.2') > 0);
  assert.equal(r.compare('0.4.55+build.1', 'v0.4.55'), 0);
  for (const value of ['', 'latest', '0.4', '<script>', '0.4.55oops']) assert.equal(r.parseVersion(value), null);
});

test('fetches all pages despite backfilled older releases and filters the current-to-latest range', async () => {
  const s = setup(), urls = [];
  const first = [release('0.4.49'), release('0.4.54'), release('0.4.56'), { ...release('0.4.53'), draft: true }, ...Array.from({ length: 96 }, () => release('0.4.50'))];
  s.context.fetch = async url => { urls.push(url); return response(url.endsWith('/latest') ? release('0.4.55') : url.endsWith('page=1') ? first : [release('0.4.53'), release('0.4.54'), release('0.4.55-beta.1'), release('0.4.51')]); };
  const result = await s.releases.load('0.4.51');
  assert.deepEqual(Array.from(result.releases, r => r.version), ['0.4.55', '0.4.54', '0.4.53']);
  assert.equal(urls.length, 3);
  assert.equal(result.warning, '');
});

test('already current or a newer development version needs only the latest endpoint', async () => {
  const s = setup(); let requests = 0;
  s.context.fetch = async () => { requests++; return response(release('0.4.55')); };
  assert.equal((await s.releases.load('0.4.55')).releases.length, 0);
  assert.equal((await s.releases.load('0.4.56')).releases.length, 0);
  assert.equal(requests, 2);
});

test('partial history failure retains the latest notes and marks the history incomplete', async () => {
  const s = setup();
  s.context.fetch = async url => { if (!url.endsWith('/latest')) throw new Error('offline'); return response(release('0.4.55', '新增提醒')); };
  const result = await s.releases.load('0.4.51');
  assert.equal(result.releases[0].body, '新增提醒');
  assert.match(result.warning, /未能获取完整/);
  assert.equal(result.releases.length, 1);
});

test('notes escape HTML and unsafe links while keeping headings, lists, links and code', () => {
  const { releases: r } = setup();
  const html = r.markdown('# 新功能\n- **提醒**\n- [说明](https://example.com/a?x=1&y=2)\n\n<script>alert(1)</script>\n[坏链接](javascript:alert)\n![远程图](https://example.com/a.png)\n\n```html\n<img onerror=x>\n```');
  assert.match(html, /<h5>新功能<\/h5>/);
  assert.match(html, /<ul><li><strong>提醒<\/strong>/);
  assert.match(html, /href="https:\/\/example.com\/a\?x=1&amp;y=2"/);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<pre><code>&lt;img onerror=x&gt;<\/code><\/pre>/);
  assert.match(r.markdown(''), /未填写更新说明/);
  assert.equal(r.release({ ...release('0.4.55'), html_url: 'https://evil.example/download' }).url, r.releasesUrl);
});

test('help checks bypass disabled automation and a recent successful check', async () => {
  const s = setup(); await s.checker.init(s.main);
  let requests = 0;
  s.checker.store.checkedAt = s.context.Date.now();
  s.context.fetch = async () => { requests++; return response(release('0.4.51')); };
  s.checker.tick(); assert.equal(requests, 0);
  await s.checker.check('help');
  assert.equal(requests, 1);
  assert.match(s.node('helpUpdateText').textContent, /已是最新版本/);
});

test('seven-day scheduling and failures use different clocks, and failures retry after an hour', async () => {
  const s = setup(); await s.checker.init(s.main);
  s.main.state.settings.appAutoUpdate = true;
  s.checker.store.checkedAt = s.context.Date.now();
  s.advance(s.releases.interval - 1); assert.equal(s.checker.due(), false);
  s.advance(1); assert.equal(s.checker.due(), true);
  const before = s.checker.store.checkedAt;
  await s.checker.check('auto');
  assert.equal(s.checker.store.checkedAt, before);
  assert.equal(s.checker.due(), false);
  s.advance(60 * 60 * 1000); assert.equal(s.checker.due(), true);
});

test('concurrent automatic and help checks share one request and retain help presentation', async () => {
  const s = setup(); await s.checker.init(s.main); s.focus(false);
  let resolve, requests = 0;
  s.context.fetch = async url => { requests++; if (url.endsWith('/latest')) return new Promise(done => resolve = done); return response([]); };
  s.main.state.settings.appAutoUpdate = true;
  const automatic = s.checker.check('auto'), help = s.checker.check('help');
  assert.equal(automatic, help);
  resolve(response(release('0.4.55'))); await help;
  assert.equal(requests, 2);
  assert.equal(s.checker.pending.source, 'help');
  assert.match(s.node('helpUpdateText').textContent, /发现新版本/);
});

test('pending updates survive restart and wait for focus, editing, overlays, quiet time and rest', async () => {
  const s = setup(); await s.checker.init(s.main); s.focus(false);
  s.main.state.settings.appAutoUpdate = true;
  s.context.fetch = async url => response(url.endsWith('/latest') ? release('0.4.55') : []);
  await s.checker.check('auto');
  assert.ok(s.checker.pending);
  const next = setup(s.storage); next.main.state.settings.appAutoUpdate = true; next.focus(false);
  await next.checker.init(next.main);
  assert.equal(next.checker.pending.result.latest, '0.4.55');
  assert.equal(next.checker.inFlight, null);
  next.focus(true); await next.checker.tryPresent(); assert.equal(next.checker.shown, null);
  next.advance(2001); next.main.editingId = 'todo'; await next.checker.tryPresent(); assert.equal(next.checker.shown, null);
  next.main.editingId = null; next.overlay('settingsMask'); await next.checker.tryPresent(); assert.equal(next.checker.shown, null);
  next.clearOverlays(); next.phase('rest'); await next.checker.tryPresent(); assert.equal(next.checker.shown, null);
  next.phase('waiting'); await next.checker.tryPresent();
  assert.equal(next.node('updateMask').hidden, false);
  assert.equal(next.checker.shown.latest, '0.4.55');
  assert.equal(next.checker.store.pending, undefined);
});

test('same-version automatic prompts are suppressed for seven days, but help still opens them', async () => {
  const s = setup(); await s.checker.init(s.main); s.focus(false);
  s.main.state.settings.appAutoUpdate = true;
  s.context.fetch = async url => response(url.endsWith('/latest') ? release('0.4.55') : []);
  s.checker.store.promptedVersion = '0.4.55'; s.checker.store.promptedAt = s.context.Date.now();
  await s.checker.check('auto'); assert.equal(s.checker.pending, null);
  await s.checker.check('help'); assert.equal(s.checker.pending.source, 'help');
  s.focus(true); s.overlay('helpMask'); await s.checker.tryPresent();
  assert.equal(s.node('updateMask').hidden, false);
  s.checker.close(); assert.equal(s.node('helpMask').hidden, false);
});

test('turning automation off cancels queued automatic presentation and stale versions are discarded', async () => {
  const s = setup(); await s.checker.init(s.main); s.focus(false);
  s.main.state.settings.appAutoUpdate = true;
  s.context.fetch = async url => response(url.endsWith('/latest') ? release('0.4.55') : []);
  await s.checker.check('auto'); assert.ok(s.checker.pending);
  s.main.state.settings.appAutoUpdate = false; s.checker.settingsChanged();
  assert.equal(s.checker.pending, null);
  assert.equal(s.checker.store.pending, undefined);
  assert.equal(s.checker.readStore('0.4.55').checkedAt, undefined);
});

test('focus or settings changing during the rest snapshot cannot display a stale pending dialog', async () => {
  const s = setup(); await s.checker.init(s.main); s.focus(false);
  s.main.state.settings.appAutoUpdate = true;
  s.context.fetch = async url => response(url.endsWith('/latest') ? release('0.4.55') : []);
  await s.checker.check('auto'); s.focus(true); s.advance(3000);
  let resolve;
  s.context.window.__TAURI__.core.invoke = () => new Promise(done => resolve = done);
  const pending = s.checker.tryPresent();
  s.main.state.settings.appAutoUpdate = false; s.checker.settingsChanged();
  resolve({ phase: 'waiting' }); await pending; await flush();
  assert.equal(s.checker.shown, null);
});

test('closing a dialog while retrying cannot reopen it when the request finishes', async () => {
  const s = setup(); await s.checker.init(s.main);
  s.checker.shown = { latest: '0.4.55' };
  s.node('updateMask').hidden = false;
  let resolve;
  s.context.fetch = async url => url.endsWith('/latest') ? new Promise(done => resolve = done) : response([]);
  const retry = s.checker.check('help');
  s.checker.close(); resolve(response(release('0.4.55'))); await retry; await flush();
  assert.equal(s.checker.pending, null);
  assert.equal(s.node('updateMask').hidden, true);
});

test('text editing defers automatic presentation but a focused checkbox does not', async () => {
  const s = setup(); await s.checker.init(s.main); s.advance(3000);
  const active = s.context.document.activeElement;
  active.tagName = 'INPUT'; active.type = 'text';
  assert.equal(s.checker.busy('auto'), true);
  active.type = 'checkbox'; assert.equal(s.checker.busy('auto'), false);
  active.isContentEditable = true; assert.equal(s.checker.busy('auto'), true);
});
