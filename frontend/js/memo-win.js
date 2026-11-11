// 备忘小窗引导页(独立窗口模式):复用 memo.js 的列表渲染与编辑弹窗。
// 职责:主题/玻璃变量应用、Main 桩(confirmAction/patchSettings/mask 关闭)、
// 置顶按钮、跨窗口事件同步(memos-changed / settings-changed)。

(function () {
  const state = { settings: {} };

  // TEMP 诊断通道:JS 状态直通 dev 日志
  function diag(msg) {
    try { window.__TAURI__.core.invoke('diag_log', { msg }); } catch {}
  }

  function applyTheme() {
    const s = state.settings || {};
    const html = document.documentElement;
    let theme = s.theme || 'light';
    let glass = null;
    if (theme === 'glass-light') { theme = 'light'; glass = 'light'; }
    else if (theme === 'glass-dark') { theme = 'dark'; glass = 'dark'; }
    else if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    html.setAttribute('data-theme', theme);
    if (glass) html.setAttribute('data-glass', glass); else html.removeAttribute('data-glass');
    html.setAttribute('data-font-size', s.fontSize || 'medium');
    html.setAttribute('data-theme-color', s.themeColor || 'blue');
    if (glass) {
      let v = Number(s.glassStrength);
      if (!Number.isFinite(v)) v = 60;
      v = Math.min(100, Math.max(0, v));
      const tint = glass === 'light' ? '255,255,255' : '20,24,38';
      html.style.setProperty('--glass-bg', `rgba(${tint},${(0.95 - v / 100 * 0.5).toFixed(3)})`);
      html.style.setProperty('--glass-blur', (4 + v / 100 * 24).toFixed(1) + 'px');
      html.style.setProperty('--glass-sat', Math.round(110 + v / 100 * 40) + '%');
    } else {
      html.style.removeProperty('--glass-bg');
    }
  }

  const memoWinConfirm = options => AppDialog.confirm(options);

  window.Main = {
    state,
    async patchSettings(patch) {
      const saved = await API.updateSettings(patch);
      state.settings = saved;
      applyTheme();
      return saved;
    },
    confirmAction(opt) { return memoWinConfirm(opt); },
    alertAction(opt) { return memoWinConfirm({ confirmText: '已知晓', hideCancel: true, title: '提示', ...opt }); },
    _attachMaskClose(maskId, closeCallback) {
      const mask = document.getElementById(maskId);
      if (!mask) return;
      let down = false;
      mask.addEventListener('mousedown', (e) => { if (e.target === mask) down = true; });
      mask.addEventListener('mouseup', (e) => {
        const onMask = e.target === mask && down;
        down = false;
        if (onMask && state.settings?.closeOnOutsideClick !== false) closeCallback();
      });
    },
  };

  // 隐藏小窗:invoke 带 2.5s 超时,超时/报错降级为 JS 原生 hide(),保证 X 永远能关
  async function hideMemoWin() {
    const { getCurrentWindow } = window.__TAURI__.window;
    try {
      const r = await Promise.race([
        API.memoWinHideWindow(),
        new Promise(res => setTimeout(() => res('timeout'), 2500)),
      ]);
      if (r === 'timeout') {
        await getCurrentWindow().hide();
        return 'invoke-timeout';
      }
      return 'ok';
    } catch (e) {
      try { await getCurrentWindow().hide(); } catch {}
      return 'err:' + String(e);
    }
  }

  async function boot() {
    // boot 任何一步崩了/卡了都写进窗口标题,外部可读,便于排查"页面假死"
    let syncPin = () => {};
    // 全局错误探针:任何未捕获异常/未处理 rejection 写进标题(外部可读)
    window.addEventListener('error', (ev) => {
      const m = '[js-err] ' + String(ev.message || '').slice(0, 60) + ' @' + (ev.filename || '').split('/').pop() + ':' + (ev.lineno || 0);
      document.title = m;
      diag(m);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      const r = ev.reason;
      const m = '[js-rej] ' + String((r && r.message) || r || '').slice(0, 60);
      document.title = m;
      diag(m);
    });
    diag('js-boot begin v5');
    try {
      // X 关闭接管必须最先注册:后面任何一步卡死都不能挡住关窗
      const { getCurrentWindow } = window.__TAURI__.window;
      await getCurrentWindow().onCloseRequested(async (e) => {
        e.preventDefault();
        const r = await hideMemoWin();
        diag('close x-hide r=' + r);
        if (r !== 'ok') document.title = '[memo-err] x-hide ' + r;
      });
      Memo.windowMode = true;
      Icon.render(document.body);
      try { state.settings = await API.getSettings(); }
      catch (e) { window.showStorageStartupError(e); return; }
      applyTheme();

      const pinBtn = document.getElementById('btnMemoWinPin');
      syncPin = () => pinBtn.classList.toggle('active', state.settings.memoWinTop === true);
      syncPin();
      pinBtn.onclick = async () => {
        try {
          await Main.patchSettings({ memoWinTop: state.settings.memoWinTop !== true });
          syncPin();
        } catch (e) {
          await Main.alertAction({ title: '操作失败', message: '切换置顶失败:' + window.__tauriErrMsg(e) });
        }
      };

      await Memo.init();
      diag('Memo.init ok');
    } catch (e) {
      document.title = '[memo-err] boot: ' + String(e);
      diag('boot CATCH: ' + String(e && e.message || e).slice(0, 80) + ' || ' + String(e && e.stack || '').replace(/\n/g, ' <= ').slice(0, 300));
      return;
    }
    try {
      const { listen } = window.__TAURI__.event;
      await listen('storage-error', (event) => Main.alertAction({ title: '数据操作失败', message: event.payload }));
      await listen('memos-changed', () => Memo.load());
      await listen('settings-changed', async () => {
        try { state.settings = await API.getSettings(); } catch { return; }
        applyTheme();
        syncPin();
      });
      diag('listen ok');
    } catch (e) {
      document.title = '[memo-err] listen: ' + String(e);
      diag('listen CATCH: ' + String(e && e.message || e).slice(0, 80));
      return;
    }
    document.title = '备忘录';
  }
  boot();
})();
