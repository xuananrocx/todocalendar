// Release data is untrusted. Render a small Markdown subset after escaping all text.
const UpdateReleases = {
  api: 'https://api.github.com/repos/xuananrocx/todocalendar/releases',
  releasesUrl: 'https://github.com/xuananrocx/todocalendar/releases',
  interval: 7 * 24 * 60 * 60 * 1000,
  parseVersion(value) {
    const match = String(value).trim().match(/^v?(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i);
    if (!match) return null;
    const parts = match[1].split('.').map(Number);
    if (!parts.every(Number.isSafeInteger)) return null;
    return { parts, pre: match[2] || '', version: match[1] + (match[2] ? '-' + match[2] : '') };
  },
  compare(a, b) {
    const aa = this.parseVersion(a), bb = this.parseVersion(b);
    if (!aa || !bb) throw new Error('版本号格式无效');
    for (let i = 0; i < 3; i++) if (aa.parts[i] !== bb.parts[i]) return aa.parts[i] - bb.parts[i];
    if (aa.pre === bb.pre) return 0;
    if (!aa.pre || !bb.pre) return aa.pre ? -1 : 1;
    const ap = aa.pre.split('.'), bp = bb.pre.split('.');
    for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
      if (ap[i] == null || bp[i] == null) return ap[i] == null ? -1 : 1;
      if (ap[i] === bp[i]) continue;
      const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
      if (an && bn) return Number(ap[i]) - Number(bp[i]);
      if (an !== bn) return an ? -1 : 1;
      return ap[i] < bp[i] ? -1 : 1;
    }
    return 0;
  },
  escape(text) {
    return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  },
  safeUrl(raw) {
    try {
      const url = new URL(raw);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  },
  inline(text) {
    const tokens = /`([^`]+)`|!?\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_/g;
    let html = '', offset = 0;
    for (const m of text.matchAll(tokens)) {
      html += this.escape(text.slice(offset, m.index));
      if (m[1] != null) html += `<code>${this.escape(m[1])}</code>`;
      else if (m[2] != null) {
        const url = this.safeUrl(m[3]);
        html += url && !m[0].startsWith('!') ? `<a href="${this.escape(url)}">${this.escape(m[2])}</a>` : this.escape(m[0]);
      } else if (m[4] != null || m[5] != null) html += `<strong>${this.escape(m[4] ?? m[5])}</strong>`;
      else html += `<em>${this.escape(m[6] ?? m[7])}</em>`;
      offset = m.index + m[0].length;
    }
    return html + this.escape(text.slice(offset));
  },
  markdown(body) {
    if (!String(body || '').trim()) return '<p class="update-empty">此版本未填写更新说明</p>';
    let html = '', list = '', paragraph = [], code = null;
    const flush = () => { if (paragraph.length) { html += `<p>${paragraph.join('<br>')}</p>`; paragraph = []; } };
    const closeList = () => { if (list) { html += `</${list}>`; list = ''; } };
    for (const line of String(body).replace(/\r\n?/g, '\n').split('\n')) {
      if (/^\s*```/.test(line)) {
        flush(); closeList();
        if (code !== null) { html += `<pre><code>${this.escape(code.join('\n'))}</code></pre>`; code = null; }
        else code = [];
        continue;
      }
      if (code !== null) { code.push(line); continue; }
      if (!line.trim()) { flush(); closeList(); continue; }
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/);
      const item = line.match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/);
      if (heading) { flush(); closeList(); html += `<h5>${this.inline(heading[1])}</h5>`; }
      else if (item) {
        flush(); const kind = item[1] ? 'ul' : 'ol';
        if (list !== kind) { closeList(); html += `<${kind}>`; list = kind; }
        html += `<li>${this.inline(item[2])}</li>`;
      } else if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flush(); closeList(); html += '<hr>'; }
      else if (/^\s*>/.test(line)) { flush(); closeList(); html += `<blockquote>${this.inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`; }
      else { closeList(); paragraph.push(this.inline(line)); }
    }
    flush(); closeList();
    if (code !== null) html += `<pre><code>${this.escape(code.join('\n'))}</code></pre>`;
    return html;
  },
  release(data) {
    const parsed = this.parseVersion(data?.tag_name);
    if (!parsed || parsed.pre || data.draft || data.prerelease) return null;
    const rawUrl = this.safeUrl(data.html_url);
    const url = rawUrl && new URL(rawUrl);
    return {
      version: parsed.version,
      body: typeof data.body === 'string' ? data.body : '',
      date: typeof data.published_at === 'string' ? data.published_at : '',
      url: url?.origin === 'https://github.com' && url.pathname.startsWith('/xuananrocx/todocalendar/releases/') ? url.href : this.releasesUrl,
    };
  },
  async request(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? '请求过于频繁，请稍后重试' : `服务返回 HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('网络请求超时，请稍后重试');
      throw error;
    } finally { clearTimeout(timeout); }
  },
  async load(current) {
    if (!this.parseVersion(current)) throw new Error('无法识别当前版本');
    const latest = this.release(await this.request(this.api + '/latest'));
    if (!latest) throw new Error('未找到有效的最新正式版本');
    const result = { current, latest: latest.version, url: latest.url, releases: [], warning: '' };
    if (this.compare(latest.version, current) <= 0) return result;
    const versions = new Map([[latest.version, latest]]);
    try {
      // Releases are ordered by publication time, not by version. Backfilled older
      // releases must not stop pagination before a newer version on a later page.
      for (let page = 1; ; page++) {
        if (page > 20) throw new Error('历史版本较多，尚未获取完整');
        const batch = await this.request(`${this.api}?per_page=100&page=${page}`);
        if (!Array.isArray(batch)) throw new Error('版本列表格式异常');
        for (const raw of batch) {
          const release = this.release(raw);
          if (release && this.compare(release.version, current) > 0 && this.compare(release.version, latest.version) <= 0 && !versions.has(release.version)) versions.set(release.version, release);
        }
        if (batch.length < 100) break;
      }
    } catch (error) { result.warning = '部分版本说明未能获取完整：' + (error.message || '网络连接失败'); }
    result.releases = [...versions.values()].sort((a, b) => this.compare(b.version, a.version));
    return result;
  },
};

const UpdateChecker = {
  storageKey: 'todocalendar.updates.v1',
  pending: null, shown: null, inFlight: null, presenting: false,
  readStore(current) {
    try {
      const raw = JSON.parse(localStorage.getItem(this.storageKey));
      if (raw?.current !== current) return { current };
      const timestamp = value => Number.isFinite(value) && value > 0 && value <= Date.now() ? value : 0;
      const store = { current, checkedAt: timestamp(raw.checkedAt), promptedAt: timestamp(raw.promptedAt), promptedVersion: typeof raw.promptedVersion === 'string' ? raw.promptedVersion : '' };
      if (raw.pending && Array.isArray(raw.pending.releases) && raw.pending.current === current && UpdateReleases.compare(raw.pending.latest, current) > 0) {
        const result = raw.pending;
        const releases = result.releases.map(item => UpdateReleases.release({ tag_name: item.version, body: item.body, published_at: item.date, html_url: item.url })).filter(item => item && UpdateReleases.compare(item.version, current) > 0 && UpdateReleases.compare(item.version, result.latest) <= 0);
        if (releases.some(item => item.version === result.latest)) store.pending = { current, latest: result.latest, url: releases.find(item => item.version === result.latest).url, releases, warning: typeof result.warning === 'string' ? result.warning : '' };
      }
      return store;
    } catch { return { current }; }
  },
  save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.store)); }
    catch (error) { console.warn('保存更新检查记录失败:', error); }
  },
  async init(main) {
    this.main = main;
    this.current = (main._cachedVersion || await API.appVersion()).trim();
    this.store = this.readStore(this.current);
    this.pending = this.store.pending ? { result: this.store.pending, source: 'auto' } : null;
    this.lastInteraction = Date.now();
    this.bind();
    document.addEventListener('pointerdown', () => { this.lastInteraction = Date.now(); }, true);
    document.addEventListener('keydown', () => { this.lastInteraction = Date.now(); }, true);
    document.addEventListener('input', () => { this.lastInteraction = Date.now(); }, true);
    window.addEventListener('focus', () => this.tick());
    document.addEventListener('visibilitychange', () => this.tick());
    this.timer = setInterval(() => this.tick(), 60000);
    this.presentationTimer = setInterval(() => this.tryPresent(), 3000);
    this.tick();
  },
  settingsChanged() {
    if (!this.main || !this.store) return;
    if (this.main.state.settings.appAutoUpdate === false && this.pending?.source === 'auto') {
      this.pending = null; delete this.store.pending; this.save();
    }
    this.tick();
  },
  due(now = Date.now()) {
    const last = this.store.checkedAt || 0;
    return (!last || now < last || now - last >= UpdateReleases.interval) && now >= (this.retryAt || 0);
  },
  tick() {
    if (this.main.state.settings.appAutoUpdate !== false) {
      if (this.due() && !this.inFlight) this.check('auto');
    } else if (this.pending?.source === 'auto') {
      this.pending = null; delete this.store.pending; this.save();
    }
    this.tryPresent();
  },
  helpStatus(kind, message) {
    document.getElementById('helpUpdateBox').className = 'help-update ' + kind;
    document.getElementById('helpUpdateText').textContent = message;
  },
  check(source = 'help') {
    if (this.inFlight) {
      if (source === 'help') { this.inFlight.help = true; this.inFlight.dismissal = this.dismissal || 0; this.helpStatus('checking', '正在检查...'); }
      return this.inFlight.promise;
    }
    const task = { help: source === 'help', dismissal: this.dismissal || 0 };
    this.inFlight = task;
    if (task.help) this.helpStatus('checking', '正在检查...');
    task.promise = (async () => {
      try {
        const result = await UpdateReleases.load(this.current);
        const now = Date.now();
        if (!result.warning) { this.store.checkedAt = now; this.retryAt = 0; }
        else this.retryAt = now + 60 * 60 * 1000;
        if (result.releases.length) {
          if (task.help) this.helpStatus('warn', `发现新版本 v${result.latest}`);
          const notify = this.store.promptedVersion !== result.latest || !this.store.promptedAt || now - this.store.promptedAt >= UpdateReleases.interval;
          if (task.dismissal === (this.dismissal || 0) && (task.help || (this.main.state.settings.appAutoUpdate !== false && notify))) {
            this.pending = { result, source: task.help ? 'help' : 'auto' };
            this.store.pending = result;
          }
        } else {
          if (task.help) this.helpStatus('ok', `✓ 已是最新版本 (v${this.current})`);
          this.pending = null; delete this.store.pending;
        }
        this.save();
        // A retry updates the existing dialog without resetting its focus or scroll.
        if (this.shown && result.releases.length) { this.shown = result; this.render(result); this.consumePending(result); }
      } catch (error) {
        this.retryAt = Date.now() + 60 * 60 * 1000;
        if (task.help) this.helpStatus('warn', '检查失败：' + (error.message || '网络连接失败'));
        if (this.shown) this.showWarning('重新获取失败：' + (error.message || '网络连接失败'));
        console.warn('检查软件更新失败:', error);
      } finally {
        this.inFlight = null;
        this.tryPresent();
      }
    })();
    return task.promise;
  },
  busy(source) {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return true;
    if (this.main.editingId || this.main.state.bulkMode) return true;
    const active = document.activeElement;
    const typing = active?.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week'].includes(active.type);
    if (active?.isContentEditable || typing || active?.matches('textarea,select')) return true;
    if (source === 'auto' && Date.now() - this.lastInteraction < 2000) return true;
    if (typeof AppPopover !== 'undefined' && AppPopover.current) return true;
    return [...document.querySelectorAll('.modal-mask:not([hidden]),.dropdown:not([hidden]),.group-manage:not([hidden])')]
      .some(el => el.id !== 'updateMask' && !(el.id === 'helpMask' && source === 'help') && el.getClientRects().length > 0);
  },
  async tryPresent() {
    if (!this.pending || this.shown || this.presenting || this.busy(this.pending.source)) return;
    if (this.pending.source === 'auto' && this.main.state.settings.appAutoUpdate === false) return;
    this.presenting = true;
    const pending = this.pending;
    try {
      const rest = await window.__TAURI__.core.invoke('rest_snapshot');
      if (['warning', 'prompt', 'rest'].includes(rest.phase) || this.pending !== pending || this.shown || this.busy(pending.source)) return;
      if (pending.source === 'auto' && this.main.state.settings.appAutoUpdate === false) return;
      this.previousFocus = document.activeElement;
      this.shown = pending.result;
      this.render(this.shown);
      document.getElementById('updateMask').hidden = false;
      document.body.classList.add('update-open');
      document.getElementById('updateScroll').scrollTop = 0;
      this.consumePending(this.shown);
      document.getElementById('btnDownloadUpdate').focus({ preventScroll: true });
    } catch (error) { console.warn('等待合适的更新提示时机:', error); }
    finally { this.presenting = false; }
  },
  consumePending(result) {
    this.pending = null; delete this.store.pending;
    this.store.promptedVersion = result.latest; this.store.promptedAt = Date.now(); this.save();
  },
  showWarning(message) {
    document.getElementById('updateWarning').hidden = !message;
    document.getElementById('updateWarningText').textContent = message;
  },
  render(result) {
    const esc = value => UpdateReleases.escape(value);
    document.getElementById('updateSummary').innerHTML = `<span>当前 <strong>v${esc(result.current)}</strong></span><span aria-hidden="true">→</span><span>最新 <strong>v${esc(result.latest)}</strong></span><span class="update-count">包含 ${result.releases.length} 个版本更新${result.warning ? '（已获取）' : ''}</span>`;
    document.getElementById('updateReleases').innerHTML = result.releases.map(release => {
      const date = new Date(release.date);
      const dateHtml = Number.isNaN(date.getTime()) ? '' : `<time datetime="${esc(date.toISOString())}">${esc(date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('/', '-'))}</time>`;
      return `<article class="update-release"><div class="update-release-head"><h4>v${esc(release.version)}</h4>${release.version === result.latest ? '<span class="update-latest">最新版本</span>' : ''}${dateHtml}</div><div class="update-notes">${UpdateReleases.markdown(release.body)}</div></article>`;
    }).join('');
    this.showWarning(result.warning);
    document.getElementById('btnDownloadUpdate').innerHTML = Icon.externalLink() + ' 前往下载 v' + esc(result.latest);
  },
  close() {
    if (!this.shown) return;
    this.dismissal = (this.dismissal || 0) + 1;
    this.shown = null;
    document.getElementById('updateMask').hidden = true;
    document.body.classList.remove('update-open');
    if (this.previousFocus?.isConnected && this.previousFocus.getClientRects().length) this.previousFocus.focus({ preventScroll: true });
  },
  bind() {
    const mask = document.getElementById('updateMask');
    document.getElementById('btnCloseUpdate').onclick = () => this.close();
    document.getElementById('btnLaterUpdate').onclick = () => this.close();
    document.getElementById('btnDownloadUpdate').onclick = () => {
      const url = this.shown?.url;
      if (!url) return;
      this.close(); this.main.closeHelp();
      API.openExternal(url).catch(error => this.main.notify('打开失败：' + window.__tauriErrMsg(error)));
    };
    document.getElementById('btnRetryUpdate').onclick = async () => {
      const button = document.getElementById('btnRetryUpdate');
      button.disabled = true; button.textContent = '正在获取...';
      try { await this.check('help'); } finally { button.disabled = false; button.textContent = '重新获取'; }
    };
    document.getElementById('updateReleases').onclick = event => {
      const link = event.target.closest('a');
      if (!link) return;
      event.preventDefault();
      const url = UpdateReleases.safeUrl(link.getAttribute('href'));
      if (url) API.openExternal(url).catch(error => this.main.notify('打开失败：' + window.__tauriErrMsg(error)));
    };
    this.main._attachMaskClose('updateMask', () => this.close());
    document.addEventListener('keydown', event => {
      if (!this.shown || !document.getElementById('confirmMask').hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.close(); }
      else if (event.key === 'Tab') {
        const controls = [...mask.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')].filter(el => el.getClientRects().length);
        const index = controls.indexOf(document.activeElement);
        if (!controls.length) return;
        event.preventDefault(); event.stopImmediatePropagation();
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
      }
    }, true);
  },
};
