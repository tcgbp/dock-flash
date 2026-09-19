// dock-flash — BROWSER half: a dock feature plugin that opens a quick-control
// floating window when the activity-bar icon is clicked.
//
// ═══════════════════════════════════════════════════════════════════════════════
// === FILE STRUCTURE / 文件结构 ===
// ═══════════════════════════════════════════════════════════════════════════════
//  #region Module Entry        — window.__ModuleLoader__.load() + imports
//  #region ErrorBoundary       — PanelErrorBoundary class
//  #region i18n                — Locale system (zh/en, MutationObserver, t())
//  #region Styles              — S object (design-token-based inline styles)
//  #region StaticAssets        — LIGHTNING_ICON, CSS keyframes
//  #region Registry            — QuickControlRegistry (pub/sub switch registry)
//  #region SwitchRenderers     — Toggle / Slider / Select / ButtonGroup / Action
//  #region PanelComponent      — QuickControlPanel (main React panel)
//  #region StandaloneMode      — mountStandaloneSlotTrigger (slots + floating panel)
//  #region PluginEntry         — exports.apply(ctx) — switch registrations + workbench
// ═══════════════════════════════════════════════════════════════════════════════
//
// === Dynamic Discovery Architecture / 动态发现架构 ===
//
// This plugin publishes a `quickControl` service on the WorkbenchContext.
// Other plugins can register their own quick switches via:
//
//   const registry = ctx.get('quickControl')
//   const dispose = registry.registerSwitch({
//     id: 'other-plugin:my-toggle',
//     label: 'My Feature',
//     icon: '🔔',
//     type: 'toggle',            // 'toggle' | 'slider' | 'select' | 'action'
//     order: 100,                // sort order (ascending); built-in items use 10-50
//     getValue: () => ...,       // read current value
//     setValue: (v) => ...,      // write new value
//     // for type='select':
//     options: [{ label: 'A', value: 'a' }, ...],
//     // for type='slider':
//     min: 0, max: 100, step: 1,
//     // for type='action':
//     run: () => ...,
//   })
//   // call dispose() to unregister (or wrap in ctx.effect for auto-cleanup)
//
// The quick-control panel subscribes to registry changes and renders
// all registered switches dynamically, grouped by source plugin.
//
// Built-in switches (theme, dock position, etc.) are also registered
// through the same registry — they just happen to be registered by
// this plugin itself.
//
//#region Module Entry ────────────────────────────────────────────────────────
window.__ModuleLoader__.load({
  id: 'dock-flash',
  factory: (require) => {
    console.log('[dock-flash] client v1.0.7')
    const React = require('react')
    const { useState, useEffect, useCallback, useRef, Component } = React
    const h = React.createElement
    let ReactDOMClient
    try { ReactDOMClient = require('react-dom/client') } catch (_) { ReactDOMClient = null }
//#endregion ───────────────────────────────────────────────────────────────────

    // ── Error Boundary ──────────────────────────────────────────────────
//#region ErrorBoundary ────────────────────────────────────────────────────────
    // dock-base's WorkbenchRoot has NO error boundary — any uncaught render
    // error in a panel component will crash the entire React root, causing
    // the whole dock (activity bar + panels) to disappear.  We wrap every
    // dock-flash panel component in this boundary so a bug inside our render
    // path is caught gracefully instead of taking down the entire workbench.
    class PanelErrorBoundary extends Component {
      constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error }
      }
      componentDidCatch(error, info) {
        console.error('[dock-flash] Panel render error (caught by boundary):', error, info)
      }
      render() {
        if (this.state.hasError) {
          return h('div', {
            style: {
              padding: '12px 16px',
              color: 'var(--dsw-alias-label-secondary, #8b949e)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              fontSize: '12px',
            },
          },
            h('div', { style: { marginBottom: '6px', color: 'var(--dsw-alias-label-warning, #d29922)' } },
              '⚠ dock-flash render error'),
            h('div', null, String(this.state.error?.message || this.state.error || 'Unknown error')),
            h('button', {
              style: {
                marginTop: '8px',
                padding: '2px 10px',
                fontSize: '11px',
                cursor: 'pointer',
                borderRadius: '4px',
                border: '1px solid var(--dsw-alias-border-l2, #21262d)',
                background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.85))',
                color: 'var(--dsw-alias-label-primary, #c9d1d9)',
              },
              onClick: () => this.setState({ hasError: false, error: null }),
            }, 'Retry'),
          )
        }
        return this.props.children
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ── Locale ───────────────────────────────────────────────────────────
//#region i18n ─────────────────────────────────────────────────────────────────
    const NS = 'dock-flash'
    const zh = {
      title: '快捷控制',
      builtinGroup: '工作台',
      thirdPartyGroup: '扩展',
      theme: '外观',
      themeLight: '浅色',
      themeDark: '深色',
      themeSystem: '跟随系统',
      on: '开',
      off: '关',
      emptyHint: '暂无扩展开关',
      action: '执行',
      language: '语言',
      langZh: '中文',
      langEn: 'English',
      systemProxy: '系统代理',
      noProxyHint: 'NO_PROXY',
      noProxyNotSet: '未设置',
      proxyAllProxy: '全部代理',
      proxyApiBypass: '仅 API 绕过',
      proxyAllBypass: '全部绕过',
      proxyCustom: '自定义',
      proxyCustomPrompt: '输入自定义 NO_PROXY 值',
      proxyScopeHint: '仅影响 DSH 进程内的 fetch 请求',
      proxyNoProxyEnv: '未检测到 HTTP_PROXY，代理设置暂无效果',
      testConnection: '测试连接',
      testRunning: '测试中…',
      testSuccess: '连接成功',
      testFailed: '连接失败',
      fullscreen: '全屏',
      recentChange: '最近修改',
      appearanceGroup: '外观',
      layoutGroup: '布局',
      systemGroup: '系统',
      sessionLogDownload: '日志下载按钮',
      skin: '皮肤',
      skinDefault: '默认',
      skinInactive: '未启用',
      closeOnBlur: '失焦关闭',
      closeOnBlurOff: '已关闭',
      closeOnBlurOn: '已开启',
      triggerPosition: '触发位置',
      triggerInputLeft: '输入框左侧',
      triggerInputRight: '输入框右侧',
      triggerSessionHeader: '会话标题栏操作',
      triggerSessionHeaderUtils: '会话标题栏工具',
      description: '工作台快捷控制面板，含皮肤切换与布局开关',
    }
    const en = {
      title: 'Quick Control',
      builtinGroup: 'Workbench',
      thirdPartyGroup: 'Extensions',
      theme: 'Appearance',
      themeLight: 'Light',
      themeDark: 'Dark',
      themeSystem: 'System',
      on: 'On',
      off: 'Off',
      emptyHint: 'No extension switches yet',
      action: 'Run',
      language: 'Language',
      langZh: '中文',
      langEn: 'English',
      systemProxy: 'System Proxy',
      noProxyHint: 'NO_PROXY',
      noProxyNotSet: 'not set',
      proxyAllProxy: 'All Proxy',
      proxyApiBypass: 'API Bypass',
      proxyAllBypass: 'All Bypass',
      proxyCustom: 'Custom',
      proxyCustomPrompt: 'Enter custom NO_PROXY value',
      proxyScopeHint: 'Only affects fetch() requests within DSH process',
      proxyNoProxyEnv: 'No HTTP_PROXY detected — proxy setting has no effect',
      testConnection: 'Test Connection',
      testRunning: 'Testing…',
      testSuccess: 'Connected',
      testFailed: 'Failed',
      fullscreen: 'Fullscreen',
      recentChange: 'Recent Changes',
      appearanceGroup: 'Appearance',
      layoutGroup: 'Layout',
      systemGroup: 'System',
      sessionLogDownload: 'Log Download Button',
      skin: 'Skin',
      skinDefault: 'Default',
      skinInactive: 'not enabled',
      closeOnBlur: 'Close on Blur',
      closeOnBlurOff: 'Off',
      closeOnBlurOn: 'On',
      triggerPosition: 'Trigger Position',
      triggerInputLeft: 'Input Left',
      triggerInputRight: 'Input Right',
      triggerSessionHeader: 'Session Header Actions',
      triggerSessionHeaderUtils: 'Session Header Utils',
      description: 'Workbench quick-control panel with skin switcher and layout toggles',
    }

    // ── i18n: reactive locale system ──────────────────────────────────────
    // Detects language from document.documentElement.lang (maintained by DSH's
    // locale plugin: 'en' for English, 'zh-CN' for Chinese).  Falls back to
    // navigator.language.  A MutationObserver watches for live language switches.
    const LOCALES = { zh, en }
    const localeListeners = new Set()

    /** Read the current BCP-47 tag from <html lang> (or navigator fallback). */
    function detectLocaleTag() {
      try {
        const tag = document.documentElement.lang
        if (tag) return tag
      } catch (_) {}
      try { return navigator.language || 'en' } catch (_) { return 'en' }
    }

    /** Map a BCP-47 tag to one of our locale keys ('zh' | 'en'). */
    function resolveLocaleKey(tag) {
      const lower = (tag || '').toLowerCase()
      if (lower.startsWith('zh')) return 'zh'
      return 'en'
    }

    /** Current locale key, reactive. */
    let _currentLocaleKey = resolveLocaleKey(detectLocaleTag())

    /** Observe <html lang> changes so the UI updates when the user switches
     *  the DSH language in Settings. */
    if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
      const _observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.attributeName === 'lang') {
            const newKey = resolveLocaleKey(detectLocaleTag())
            if (newKey !== _currentLocaleKey) {
              _currentLocaleKey = newKey
              localeListeners.forEach((fn) => { try { fn() } catch (_) {} })
            }
            return
          }
        }
      })
      _observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    }

    /** Translate a key using the current locale. */
    function t(k) {
      const dict = LOCALES[_currentLocaleKey] || LOCALES.en
      return dict[k] || LOCALES.en[k] || k
    }

    /** Get the current locale key ('zh' | 'en'). */
    t.getLocale = () => _currentLocaleKey

    /** Set the locale and notify all listeners (triggers re-render). */
    t.setLocale = (key) => {
      if (key !== _currentLocaleKey && LOCALES[key]) {
        _currentLocaleKey = key
        // Do NOT write document.documentElement.lang here — the DSH locale
        // service owns that attribute. Our MutationObserver will pick up
        // its change and keep _currentLocaleKey in sync.
        localeListeners.forEach((fn) => { try { fn() } catch (_) {} })
      }
    }

    /** Subscribe to locale changes; returns a disposer. */
    t.onLocaleChange = (fn) => {
      localeListeners.add(fn)
      return () => { localeListeners.delete(fn) }
    }

    /** Functional i18n label — guarantees a reactive () => t(key) wrapper.
     *  Use for every user-visible label (switch label, option label, title).
     *  Never write `() => t('key')` directly — L() makes the intent explicit
     *  and eliminates the risk of accidentally using a static `t('key')`. */
    function L(key) { return () => t(key) }

    /** Build an option array from [i18nKey, value] pairs.
     *  Each option gets a functional label via L(), ensuring language
     *  switches propagate to select/buttongroup options. */
    function i18nOptions(pairs) {
      return pairs.map(function (pair) { return { label: L(pair[0]), value: pair[1] } })
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ── Styling contract / 样式契约 ─────────────────────────────────────
//#region Styles ───────────────────────────────────────────────────────────────
    // All colors MUST go through --dsw-alias-* design tokens (official DSH Web
    // styling contract); literal colors only as fallbacks for hosts predating
    // the alias table. Never write [data-theme] selectors.
    const S = {
      root: {
        // Establish our own stacking context. Without this the panel is a plain
        // static block, so ANY positioned sibling inside dock-base's
        // `.dsh-wb-root` paints over it — dock-git's `.dg-graph` is only
        // `position:absolute; z-index:2` yet was still covering the panel
        // (see AGENTS.md, "Stacking: why this panel needs its own context").
        //
        // 10 is deliberate, not arbitrary: it beats in-content escapees like
        // `.dg-graph` (2) while staying BELOW dock-base's floating windows
        // (`--dsh-wb-floating`, z-index 70), so dock-base's own precedence
        // (floating above docked panels) is preserved rather than inverted.
        position: 'relative',
        zIndex: 10,
        padding: '8px 12px 12px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '12px',
        lineHeight: '1.5',
        minWidth: '240px',
      },
      panelCloseBtn: {
        border: 0,
        borderRadius: '5px',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: '18px',
        lineHeight: 1,
        padding: '3px 8px',
      },
      switchRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '6px',
        minHeight: '22px',
      },
      switchLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontSize: '12px',
        flex: 1,
        minWidth: 0,
      },
      switchIcon: {
        fontSize: '13px',
        width: '18px',
        textAlign: 'center',
        flexShrink: 0,
      },
      switchSubtitle: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '10px',
        marginTop: '1px',
        lineHeight: 1.3,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      infoIcon: {
        fontSize: '11px',
        opacity: 0.5,
        flexShrink: 0,
        lineHeight: 1,
      },
      value: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '11px',
      },
      slider: {
        width: '100px',
        accentColor: 'var(--dsw-alias-button-primary-fill, #58a6ff)',
        cursor: 'pointer',
        flexShrink: 0,
      },
      sliderRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
      },
      btnGroup: {
        display: 'flex',
        gap: '0',
        flexWrap: 'wrap',
        flexShrink: 0,
      },
      btn: {
        padding: '2px 8px',
        fontSize: '11px',
        border: '1px solid var(--dsw-alias-border-l1, #30363d)',
        borderRadius: '4px',
        background: 'var(--dsw-alias-bg-layer-1, #0d1117)',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      },
      btnActive: {
        padding: '2px 8px',
        fontSize: '11px',
        border: '1px solid var(--dsw-alias-button-primary-fill, #58a6ff)',
        borderRadius: '4px',
        background: 'var(--dsw-alias-button-primary-fill, #58a6ff)',
        color: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
        cursor: 'pointer',
      },
      selectInput: {
        padding: '3px 6px',
        fontSize: '12px',
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
        borderRadius: '5px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.85))',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        cursor: 'pointer',
        flexShrink: 0,
        maxWidth: '130px',
        outline: 'none',
        transition: 'border-color 0.15s',
        colorScheme: 'dark',
      },
      btnAction: {
        padding: '5px 16px',
        fontSize: '13px',
        lineHeight: '20px',
        border: '1px solid var(--dsw-alias-border-l1, #30363d)',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-layer-2, #161b22)',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        whiteSpace: 'nowrap',
        minHeight: '30px',
      },
      toggle: {
        position: 'relative',
        width: '36px',
        height: '20px',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-3, #21262d)',
        border: '1px solid var(--dsw-alias-border-l1, #30363d)',
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
      },
      toggleOn: {
        position: 'relative',
        width: '36px',
        height: '20px',
        borderRadius: '10px',
        background: 'var(--dsw-alias-button-primary-fill, #58a6ff)',
        border: '1px solid var(--dsw-alias-button-primary-fill, #58a6ff)',
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
      },
      toggleThumb: {
        position: 'absolute',
        top: '2px',
        left: '2px',
        width: '14px',
        height: '14px',
        borderRadius: '7px',
        background: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
        transition: 'left 0.2s',
      },
      toggleThumbOn: {
        position: 'absolute',
        top: '2px',
        left: '18px',
        width: '14px',
        height: '14px',
        borderRadius: '7px',
        background: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
        transition: 'left 0.2s',
      },
      emptyHint: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '12px',
        fontStyle: 'italic',
        padding: '4px 0',
      },
      sourceTag: {
        fontSize: '10px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        background: 'var(--dsw-alias-bg-layer-2, #161b22)',
        padding: '1px 5px',
        borderRadius: '3px',
        marginLeft: '6px',
      },
      changeLogEntry: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        marginBottom: '2px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        lineHeight: '1.4',
        animation: 'dockFlashFadeIn 0.3s ease',
      },
      changeLogIcon: {
        fontSize: '11px',
        width: '14px',
        textAlign: 'center',
        flexShrink: 0,
      },
      changeLogLabel: {
        fontWeight: '500',
        flexShrink: 0,
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      changeLogArrow: {
        color: 'var(--dsw-alias-button-primary-fill, #58a6ff)',
        margin: '0 3px',
        fontWeight: '600',
        flexShrink: 0,
      },
      changeLogOld: {
        textDecoration: 'line-through',
        opacity: '0.6',
      },
      changeLogNew: {
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontWeight: '500',
      },
      subGroupTitle: {
        fontSize: '11px',
        fontWeight: '600',
        letterSpacing: '0.3px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        marginTop: '8px',
        marginBottom: '5px',
        paddingBottom: '2px',
        textAlign: 'center',
        opacity: '0.7',
      },
      subGroupTitleFirst: {
        fontSize: '11px',
        fontWeight: '600',
        letterSpacing: '0.3px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        marginTop: '0',
        marginBottom: '5px',
        paddingBottom: '2px',
        textAlign: 'center',
        opacity: '0.7',
      },
      compactToggleGrid: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        marginBottom: '6px',
      },
      compactToggleRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: '22px',
      },
      compactToggleLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontSize: '12px',
        flex: 1,
        minWidth: 0,
      },
      tabPage: {
        marginBottom: '4px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
        background: 'var(--dsw-alias-bg-layer-2, #161b22)',
        overflow: 'hidden',
      },
      tabPageLast: {
        marginBottom: '0',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
        background: 'var(--dsw-alias-bg-layer-2, #161b22)',
        overflow: 'hidden',
      },
      tabPageHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 12px',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.15s',
      },
      tabPageHeaderTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '11px',
        fontWeight: '600',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      tabPageChevron: {
        fontSize: '10px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        transition: 'transform 0.2s',
      },
      tabPageChevronOpen: {
        fontSize: '10px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        transform: 'rotate(90deg)',
        transition: 'transform 0.2s',
      },
      tabPageBody: {
        padding: '6px 12px 10px',
        borderTop: '1px solid var(--dsw-alias-border-l2, #21262d)',
        animation: 'dockFlashFadeIn 0.2s ease',
      },
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ── SVG icon for the activity bar (lightning bolt ⚡) ────────────────
//#region StaticAssets ─────────────────────────────────────────────────────────
    const LIGHTNING_ICON = {
      path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
      stroke: true,
      size: 20,
    }

    // ── Icon for the header close-on-blur toggle ─────────────────────────
    //    A panel outline with a pointer leaving it: "click away → closes".
    //    pointer-events:none so a click's event.target is always the button
    //    itself, which the standalone header's drag guard compares against.
    const CLOSE_ON_BLUR_ICON_SVG =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;pointer-events:none">' +
      '<rect x="2.25" y="3.25" width="7.5" height="9.5" rx="1.4" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M11 6.4 13.8 8 11 9.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>'

    // ── close-on-blur: one key, one writer, one change channel ───────────
    //    The panel-header toggle is painted imperatively, so it cannot rely on
    //    React to re-render when the value changes elsewhere — in standalone
    //    mode the Layout switch writes the same setting. Every write therefore
    //    goes through writeCloseOnBlur(), which repaints every mounted header
    //    toggle AND pokes the registry so the switch UI re-renders too. That is
    //    what keeps the two controls in step in both directions.
    const CLOSE_ON_BLUR_KEY = 'dock-flash:close-on-blur'
    const _closeOnBlurListeners = new Set()

    function readCloseOnBlur() {
      try { return localStorage.getItem(CLOSE_ON_BLUR_KEY) !== 'off' } catch (_) { return false }
    }

    /** Repaint `fn` whenever the setting changes; returns a disposer. */
    function subscribeCloseOnBlur(fn) {
      _closeOnBlurListeners.add(fn)
      return () => { _closeOnBlurListeners.delete(fn) }
    }

    /** The ONLY writer of the setting. `registry` may be undefined. */
    function writeCloseOnBlur(on, registry) {
      try { localStorage.setItem(CLOSE_ON_BLUR_KEY, on ? 'floating' : 'off') } catch (_) {}
      for (const fn of Array.from(_closeOnBlurListeners)) {
        try { fn() } catch (_) {}
      }
      // The standalone Layout switch lives inside the panel, which re-renders
      // only when the registry version changes. In workbench mode no such
      // switch is registered and notifyChange() is a no-op.
      if (registry) {
        try { registry.notifyChange('dock-flash:close-on-blur') } catch (_) {}
      }
    }

    function closeOnBlurLabel(on) {
      return `${t('closeOnBlur')}: ${t(on ? 'closeOnBlurOn' : 'closeOnBlurOff')}`
    }

    // ── Inject CSS keyframe animation for changelog entries ──────────────
    if (typeof document !== 'undefined') {
      const _styleId = 'dock-flash-changelog-styles'
      if (!document.getElementById(_styleId)) {
        const _style = document.createElement('style')
        _style.id = _styleId
        _style.textContent = '@keyframes dockFlashFadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}'
        document.head.appendChild(_style)
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    // ── QuickControlRegistry ─────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════
//#region Registry ─────────────────────────────────────────────────────────────
    // A lightweight pub/sub registry that other plugins use to register
    // their quick switches. Published as ctx.provide('quickControl', ...).
    //
    // Switch types:
    //   'toggle'  — boolean on/off with a toggle switch
    //   'slider'  — numeric range with a slider
    //   'select'  — choose one from options with buttons
    //   'action'  — a button that fires a callback
    //
    function createQuickControlRegistry() {
      const switches = new Map()          // id → QuickSwitchDefinition
      const listeners = new Set()         // onChange callbacks
      const changelog = []                // recent change records
      let version = 0                     // bump on every mutation

      function notify() {
        version++
        listeners.forEach((fn) => { try { fn() } catch (_) {} })
      }

      return {
        /** Register a quick switch; returns a disposer. */
        registerSwitch(def) {
          if (!def || !def.id) {
            console.warn('[quickControl] registerSwitch: missing id')
            return () => {}
          }
          switches.set(def.id, { ...def, _v: 0 })
          notify()
          return () => {
            if (switches.delete(def.id)) notify()
          }
        },

        /** Unregister by id. */
        unregisterSwitch(id) {
          if (switches.delete(id)) notify()
        },

        /** Get all registered switches, sorted by order then id. */
        getSwitches() {
          return Array.from(switches.values()).sort((a, b) =>
            (a.order ?? 100) - (b.order ?? 100) || String(a.id).localeCompare(String(b.id))
          )
        },

        /** Signal that a switch's value has changed (triggers re-render). */
        notifyChange(id) {
          const sw = switches.get(id)
          if (sw) { sw._v++; notify() }
        },

        /** Record a change with old/new display values for the changelog. */
        recordChange(entry) {
          changelog.push({ ...entry, ts: Date.now() })
          // Keep only last 20 entries
          while (changelog.length > 20) changelog.shift()
          notify()
        },

        /** Get recent changes (within the last 30 seconds). */
        getChangelog() {
          const now = Date.now()
          return changelog.filter((e) => now - e.ts < 30000)
        },

        /** Subscribe to registry/value changes; returns disposer. */
        subscribe(fn) {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },

        /** Current registry version (for shallow equality checks). */
        get version() { return version },
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    // ── Generic switch renderer ──────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════
//#region SwitchRenderers ──────────────────────────────────────────────────────

    // Safe wrappers for switch getValue()/options() — these are called during
    // React render, so any throw would crash the entire dock-base WorkbenchRoot
    // (which has no error boundary).  We wrap them to return safe fallbacks.
    function safeGetValue(sw, fallback) {
      try { return sw.getValue() } catch (e) {
        console.warn('[dock-flash] switch getValue() threw:', sw.id, e)
        return fallback
      }
    }
    function safeGetOptions(sw) {
      try {
        return typeof sw.options === 'function' ? sw.options() : (sw.options || [])
      } catch (e) {
        console.warn('[dock-flash] switch options() threw:', sw.id, e)
        return []
      }
    }

    function renderToggleSwitch(sw, compact) {
      const on = !!safeGetValue(sw, false)
      const rowStyle = compact ? S.compactToggleRow : S.switchRow
      const labelStyle = compact ? S.compactToggleLabel : S.switchLabel
      // If the switch provides a `subtitle` (string or function), show it
      // as a secondary line below the label.
      const subtitleText = sw.subtitle
        ? (typeof sw.subtitle === 'function' ? sw.subtitle() : sw.subtitle)
        : null
      return h('div', { style: rowStyle, key: sw.id },
        h('span', { style: labelStyle },
          sw.icon ? h('span', { style: S.switchIcon }, sw.icon) : null,
          h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
            h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
            subtitleText ? h('span', { style: S.switchSubtitle }, subtitleText) : null,
          ),
        ),
        h('div', {
          style: on ? S.toggleOn : S.toggle,
          onClick: () => {
            const oldDisplay = on ? t('on') : t('off')
            const newDisplay = on ? t('off') : t('on')
            sw.setValue(!on)
            sw._notifyChange(oldDisplay, newDisplay)
          },
        },
          h('div', { style: on ? S.toggleThumbOn : S.toggleThumb })
        ),
      )
    }

    function renderSliderSwitch(sw) {
      const val = Number(safeGetValue(sw, 0)) || 0
      const min = sw.min ?? 0
      const max = sw.max ?? 100
      const step = sw.step ?? 1
      const pct = max > min ? Math.round(((val - min) / (max - min)) * 100) : 0
      return h('div', { style: S.switchRow, key: sw.id },
        h('span', { style: S.switchLabel },
          sw.icon ? h('span', { style: S.switchIcon }, sw.icon) : null,
          h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
        ),
        h('div', { style: S.sliderRow },
          h('input', {
            type: 'range',
            min, max, step,
            value: val,
            style: S.slider,
            onChange: (e) => {
              const newVal = Number(e.target.value)
              const oldDisplay = sw.formatLabel ? sw.formatLabel(val) : (val + '%')
              const newDisplay = sw.formatLabel ? sw.formatLabel(newVal) : (newVal + '%')
              sw.setValue(newVal)
              sw._notifyChange(oldDisplay, newDisplay)
            },
          }),
          h('span', { style: S.value }, sw.formatLabel ? sw.formatLabel(val) : (pct + '%')),
        ),
      )
    }

    function renderSelectSwitch(sw) {
      const current = safeGetValue(sw, '')
      const rawOpts = safeGetOptions(sw)
      // Find the display label for the current value
      const currentOpt = rawOpts.find((o) => o.value === current)
      const currentLabel = currentOpt ? (typeof currentOpt.label === 'function' ? currentOpt.label() : currentOpt.label) : String(current)
      // If the switch provides a `subtitle` (string or function), show it
      // as a secondary line below the label (same as toggle switches).
      const subtitleText = sw.subtitle
        ? (typeof sw.subtitle === 'function' ? sw.subtitle() : sw.subtitle)
        : null
      // If the switch provides a `tooltip` (string or function), show an ℹ️ icon
      // with a native browser tooltip on hover — avoids subtitle truncation.
      const tooltipText = sw.tooltip
        ? (typeof sw.tooltip === 'function' ? sw.tooltip() : sw.tooltip)
        : null
      return h('div', { style: S.switchRow, key: sw.id },
        h('span', { style: S.switchLabel },
          sw.icon ? h('span', { style: S.switchIcon }, sw.icon) : null,
          h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 }, ...(tooltipText ? { title: tooltipText } : {}) },
            h('span', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
              h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
              tooltipText ? h('span', { style: S.infoIcon }, 'ⓘ') : null,
            ),
            subtitleText ? h('span', { style: S.switchSubtitle }, subtitleText) : null,
          ),
        ),
        h('select', {
          value: String(current),
          style: S.selectInput,
          onChange: (e) => {
            const newVal = e.target.value
            if (current !== newVal) {
              const oldOpt = rawOpts.find((o) => o.value === current)
              const oldDisplay = oldOpt ? (typeof oldOpt.label === 'function' ? oldOpt.label() : oldOpt.label) : String(current)
              const newOpt = rawOpts.find((o) => o.value === newVal)
              const newDisplay = newOpt ? (typeof newOpt.label === 'function' ? newOpt.label() : newOpt.label) : newVal
              sw.setValue(newVal)
              sw._notifyChange(oldDisplay, newDisplay)
            }
          },
        },
          rawOpts.map((opt) =>
            h('option', { key: String(opt.value), value: String(opt.value) },
              typeof opt.label === 'function' ? opt.label() : opt.label
            )
          )
        ),
      )
    }

    function renderActionSwitch(sw) {
      return h('div', { style: S.switchRow, key: sw.id },
        h('span', { style: S.switchLabel },
          sw.icon ? h('span', { style: S.switchIcon }, sw.icon) : null,
          h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
        ),
        h('button', {
          style: S.btnAction,
          onMouseEnter: function (e) {
            e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-3, #21262d)'
            e.currentTarget.style.borderColor = 'var(--dsw-alias-border-l2, #484f58)'
          },
          onMouseLeave: function (e) {
            e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2, #161b22)'
            e.currentTarget.style.borderColor = 'var(--dsw-alias-border-l1, #30363d)'
          },
          onMouseDown: function (e) {
            e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-4, #30363d)'
          },
          onMouseUp: function (e) {
            e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-3, #21262d)'
          },
          onClick: function () {
            if (sw.run) sw.run()
            sw._notifyChange('', t('action'))
          },
        }, typeof sw.actionLabel === 'function' ? sw.actionLabel() : (sw.actionLabel || t('action'))),
      )
    }

    function renderButtonGroupSwitch(sw) {
      const current = safeGetValue(sw, '')
      const rawOpts = safeGetOptions(sw)
      return h('div', { style: S.switchRow, key: sw.id },
        h('span', { style: S.switchLabel },
          sw.icon ? h('span', { style: S.switchIcon }, sw.icon) : null,
          h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
        ),
        h('div', { style: S.btnGroup },
          rawOpts.map((opt, i) => {
            const isFirst = i === 0
            const isLast = i === rawOpts.length - 1
            const base = current === opt.value ? { ...S.btnActive } : { ...S.btn }
            if (isFirst) {
              base.borderRadius = '4px 0 0 4px'
            } else if (isLast) {
              base.borderRadius = '0 4px 4px 0'
              base.borderLeft = 'none'
            } else {
              base.borderRadius = '0'
              base.borderLeft = 'none'
            }
            return h('button', {
              key: String(opt.value),
              style: base,
              onClick: () => {
                if (current !== opt.value) {
                  const oldOpt = rawOpts.find((o) => o.value === current)
                  const oldDisplay = oldOpt ? (typeof oldOpt.label === 'function' ? oldOpt.label() : oldOpt.label) : String(current)
                  const newDisplay = typeof opt.label === 'function' ? opt.label() : opt.label
                  sw.setValue(opt.value)
                  sw._notifyChange(oldDisplay, newDisplay)
                }
              },
            }, typeof opt.label === 'function' ? opt.label() : opt.label)
          })
        ),
      )
    }

    function renderSwitch(sw) {
      // Inject _notifyChange helper so switch implementations can
      // trigger a re-render after async state changes.
      // Signature: _notifyChange(oldDisplay?, newDisplay?)
      if (!sw._notifyChange) {
        sw._notifyChange = (oldDisplay, newDisplay) => { /* filled by panel on subscribe */ }
      }
      switch (sw.type) {
        case 'toggle': return renderToggleSwitch(sw)
        case 'slider': return renderSliderSwitch(sw)
        case 'select': return renderSelectSwitch(sw)
        case 'buttongroup': return renderButtonGroupSwitch(sw)
        case 'action': return renderActionSwitch(sw)
        default: return null
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    // ── Quick Control Panel component ────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════
//#region PanelComponent ───────────────────────────────────────────────────────
    // Receives ViewProps: { ctx, viewId, sessionId, active, seed }
    //
    // IMPORTANT: `ctx` comes from dock-base's WorkbenchRoot, which may be a
    // DSH guarded proxy.  The guard blocks property-style service access
    // (ctx.workbench) when the service isn't declared in the plugin's inject.
    // Always use ctx.get('serviceName') instead — it bypasses the declaration
    // requirement.
    function QuickControlPanel(props) {
      const { ctx, active } = props
      // Use ctx.get() — NOT ctx.workbench — because the DSH guard proxy
      // blocks property access for services not in the provider's inject[].
      const wb = ctx.get ? ctx.get('workbench') : undefined
      const registry = ctx.get ? ctx.get('quickControl') : undefined


      const [layout, setLayout] = useState(() => wb ? wb.getLayout() : null)
      const [regVersion, setRegVersion] = useState(0)
      const [localeKey, setLocaleKey] = useState(() => t.getLocale())
      const [, setChangelogTick] = useState(0)
      const [themeTick, setThemeTick] = useState(0)
      const [openTabs, setOpenTabs] = useState(() => new Set(['workbench', 'extensions', 'changes']))
      const [skinTick, setSkinTick] = useState(0)

      // ── Close-on-blur: auto-close when clicking outside the panel ──
      // Works in two modes:
      //   - Sidebar mode: if our panel is active in the sidebar, clicking
      //     outside the workbench root collapses the sidebar.
      //   - Floating mode: if our panel is open as a floating window,
      //     clicking outside any floating window closes it.
      // The value is read through the shared module-level helper so the header
      // toggle and the standalone Layout switch cannot drift apart.
      useEffect(() => {
        if (!wb) return

        const handleMouseDown = (e) => {
          if (!readCloseOnBlur()) return

          const layout = wb.getLayout()

          // ── Floating window path ──
          const myFloat = Object.entries(layout.floatingWindows || {})
            .find(([, fw]) => fw.viewId === 'dock-flash:quick-control')
          if (myFloat) {
            // Is the click inside any .dsh-wb-floating? If so, don't close.
            let el = e.target
            while (el) {
              if (el.classList && el.classList.contains('dsh-wb-floating')) return
              el = el.parentElement
            }
            try { wb.closeViewInstance(myFloat[0]) } catch (_) {}
            return
          }

          // ── Sidebar path ──
          // Our panel is in the sidebar if layout.activity matches our id
          // AND the sidebar is showing our pane.
          const ourActivityId = 'dock-flash:quick-control'
          if (layout.activity === ourActivityId && layout.sideBarOpen) {
            // Is the click inside the workbench root (.dsh-wb-root)?
            // If so, the user is interacting with the dock — don't close.
            let el = e.target
            let hitWorkbench = false
            while (el) {
              if (el.classList && el.classList.contains('dsh-wb-root')) {
                hitWorkbench = true
                break
              }
              el = el.parentElement
            }
            if (hitWorkbench) return
            // Click is outside the workbench — collapse the sidebar
            try { wb.updateLayout({ activity: null }) } catch (_) {}
          }
        }

        document.addEventListener('mousedown', handleMouseDown, true)
        return () => document.removeEventListener('mousedown', handleMouseDown, true)
      }, [wb])

      // Re-evaluate skin options when panel becomes active (so newly loaded
      // skin plugins are discovered without needing a MutationObserver).
      useEffect(() => {
        if (active) setSkinTick((v) => v + 1)
      }, [active])

      // ── Promote our own floating window ──
      //    dock-base renders floating windows in `Object.values(floatingWindows)`
      //    order and gives every `.dsh-wb-floating` the SAME CSS z-index (70) —
      //    its inline style only carries left/top/width/height, and there is no
      //    focus-based promotion. So whichever entry is LAST in that object
      //    paints on top, and clicking ours never raises it: another plugin's
      //    floating window (e.g. dock-git's graph) covers the panel for good.
      //
      //    Re-inserting our own entry at the end is the only lever available from
      //    inside the panel. `store.update()` is a shallow merge of arbitrary
      //    keys that re-renders and persists, so `updateLayout` accepts the
      //    reordered object. No-op when our view is docked or closed, so it is
      //    safe to call unconditionally.
      const promoteFloatingWindow = useCallback(() => {
        if (!wb) return
        try {
          const fw = wb.getLayout().floatingWindows || {}
          const keys = Object.keys(fw)
          const mine = keys.filter((k) => fw[k] && fw[k].viewId === 'dock-flash:quick-control')
          if (mine.length === 0) return
          // Already last ⇒ already on top. Bail out, otherwise this would loop:
          // updateLayout() notifies layout listeners, which re-render the panel.
          if (mine.indexOf(keys[keys.length - 1]) !== -1) return
          const next = {}
          for (const k of keys) if (mine.indexOf(k) === -1) next[k] = fw[k]
          for (const k of keys) if (mine.indexOf(k) !== -1) next[k] = fw[k]
          wb.updateLayout({ floatingWindows: next })
        } catch (_) {}
      }, [wb])

      // Raise when we become active (i.e. the floating window is opened) …
      useEffect(() => {
        if (active) promoteFloatingWindow()
      }, [active, promoteFloatingWindow])

      // Subscribe to registry changes (new switches registered / removed / value changed)
      useEffect(() => {
        if (!registry) return
        const dispose = registry.subscribe(() => {
          setRegVersion(registry.version)
        })
        // Also trigger initial render
        setRegVersion(registry.version)
        return dispose
      }, [registry])

      // Subscribe to layout changes
      useEffect(() => {
        if (!wb) return
        const dispose = wb.onDidChangeLayout(() => {
          setLayout(wb.getLayout())
        })
        return dispose
      }, [wb])

      // Subscribe to locale changes (re-render when language switches)
      useEffect(() => {
        return t.onLocaleChange(() => {
          setLocaleKey(t.getLocale())
        })
      }, [])

      // Wire _notifyChange for all registered switches so they can
      // trigger re-renders after setValue calls and record changes.
      // Signature: _notifyChange(oldDisplay?, newDisplay?)
      useEffect(() => {
        if (!registry) return
        const allSwitches = registry.getSwitches()
        allSwitches.forEach((sw) => {
          sw._notifyChange = (oldDisplay, newDisplay) => {
            // Record the change for the changelog display
            if (oldDisplay !== undefined || newDisplay !== undefined) {
              registry.recordChange({
                id: sw.id,
                label: typeof sw.label === 'function' ? sw.label() : sw.label,
                icon: sw.icon || '',
                oldDisplay: String(oldDisplay || ''),
                newDisplay: String(newDisplay || ''),
              })
            }
            registry.notifyChange(sw.id)
          }
        })
      }, [registry, regVersion])

      // Auto-refresh to dismiss expired changelog entries (30s TTL)
      useEffect(() => {
        const timer = setInterval(() => {
          setChangelogTick((v) => v + 1)
        }, 5000)
        return () => clearInterval(timer)
      }, [])

      // Re-render when theme changes (available themes may change)
      // NOTE: We use ctx.on() to subscribe but store the disposer returned
      // by ctx.on() rather than calling ctx.off() on cleanup, because
      // ctx.off is NOT in the DSH guard's CTX_VERBS and would throw through
      // the guarded proxy.
      useEffect(() => {
        const svc = ctx.get ? ctx.get('theme') : undefined
        if (!svc) return
        const handler = () => setThemeTick((v) => v + 1)
        const dispose = ctx.on('theme/change', handler)
        return () => { if (typeof dispose === 'function') dispose() }
      }, [ctx])

      // Listen for fullscreen changes (e.g. user presses Esc to exit)
      useEffect(() => {
        if (!registry) return
        const handler = () => registry.notifyChange('dock-flash:fullscreen')
        document.addEventListener('fullscreenchange', handler)
        document.addEventListener('webkitfullscreenchange', handler)
        return () => {
          document.removeEventListener('fullscreenchange', handler)
          document.removeEventListener('webkitfullscreenchange', handler)
        }
      }, [registry])

      if (!active) {
        return h('div', { style: S.root })
      }

      // Categorize switches: built-in (dock-flash:*) vs third-party
      // skinTick/themeTick ensure re-render when panel becomes active or theme changes
      void skinTick; void themeTick
      const allSwitches = registry ? registry.getSwitches() : []
      const builtIn = allSwitches.filter((sw) => String(sw.id).startsWith('dock-flash:'))
      const thirdParty = allSwitches.filter((sw) => !String(sw.id).startsWith('dock-flash:'))

      // Group built-in switches by their `group` field, preserving order
      const groupOrder = ['appearance', 'layout', 'system']
      const groupI18n = { appearance: 'appearanceGroup', layout: 'layoutGroup', system: 'systemGroup' }
      const builtInGroups = new Map()
      builtIn.forEach((sw) => {
        const g = sw.group || 'other'
        if (!builtInGroups.has(g)) builtInGroups.set(g, [])
        builtInGroups.get(g).push(sw)
      })

      // Group third-party by source (extracted from id prefix before ':')
      const thirdPartyGroups = new Map()
      thirdParty.forEach((sw) => {
        const source = String(sw.id).split(':')[0] || 'unknown'
        if (!thirdPartyGroups.has(source)) thirdPartyGroups.set(source, [])
        thirdPartyGroups.get(source).push(sw)
      })

      // Render a built-in sub-group: toggles in compact 2-col grid, others full-width
      function renderBuiltInGroup(groupKey, switches, isFirst) {
        const toggles = switches.filter((sw) => sw.type === 'toggle')
        const others = switches.filter((sw) => sw.type !== 'toggle')
        return h('div', { key: groupKey },
          h('div', { style: isFirst ? S.subGroupTitleFirst : S.subGroupTitle },
            t(groupI18n[groupKey] || groupKey)
          ),
          toggles.length > 0
            ? h('div', { style: S.compactToggleGrid },
                toggles.map((sw) => renderToggleSwitch(sw, true))
              )
            : null,
          others.map((sw) => renderSwitch(sw)),
        )
      }

      // ── Determine which tabs are available ──
      const hasWorkbench = builtIn.length > 0
      const hasExtensions = thirdPartyGroups.size > 0
      const hasChanges = registry && registry.getChangelog().length > 0

      const toggleTab = (id) => {
        setOpenTabs((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      // Build list of visible tab pages
      const pages = []
      if (hasWorkbench) pages.push({ id: 'workbench', icon: '⚡', label: L('builtinGroup') })
      if (hasExtensions) pages.push({ id: 'extensions', icon: '🧩', label: L('thirdPartyGroup') })
      if (hasChanges) pages.push({ id: 'changes', icon: '📝', label: L('recentChange') })


      return h('div', {
        key: 'qcp-' + localeKey,
        style: S.root,
        'data-dsh-plugin': 'dock-flash',
        'data-dsh-surface': 'floating-window',
        // Hovering the panel raises it above other dock-base floating windows,
        // which all share one z-index (see promoteFloatingWindow above).
        onMouseEnter: promoteFloatingWindow,
      },
        pages.map((page, pi) => {
          const isOpen = openTabs.has(page.id)
          const isLast = pi === pages.length - 1
          return h('div', { key: page.id, style: isLast ? S.tabPageLast : S.tabPage },
            // ── Tab header (always visible, click to toggle) ──
            h('div', {
              style: S.tabPageHeader,
              onClick: () => toggleTab(page.id),
            },
              h('span', { style: S.tabPageHeaderTitle }, page.icon, ' ', page.label()),
              h('span', { style: isOpen ? S.tabPageChevronOpen : S.tabPageChevron }, '▸'),
            ),
            // ── Tab body (only when open) ──
            isOpen
              ? h('div', { style: S.tabPageBody },
                  page.id === 'workbench'
                    ? groupOrder
                        .filter((g) => builtInGroups.has(g))
                        .map((g, i) => renderBuiltInGroup(g, builtInGroups.get(g), i === 0))
                  : page.id === 'extensions'
                    ? Array.from(thirdPartyGroups.entries()).map(([source, switches]) =>
                        h('div', { key: source, style: { marginBottom: '10px' } },
                          h('div', { style: { ...S.switchLabel, fontSize: '11px', marginBottom: '4px' } },
                            h('span', { style: { fontWeight: '500' } }, source),
                          ),
                          switches.map((sw) => renderSwitch(sw)),
                        )
                      )
                    : page.id === 'changes'
                      ? registry.getChangelog().slice(-5).reverse().map((entry, i) =>
                          h('div', { key: entry.ts + '-' + i, style: S.changeLogEntry },
                            entry.icon
                              ? h('span', { style: S.changeLogIcon }, entry.icon)
                              : null,
                            h('span', { style: S.changeLogLabel }, entry.label),
                            entry.oldDisplay
                              ? h('span', null,
                                  h('span', { style: S.changeLogOld }, entry.oldDisplay),
                                  h('span', { style: S.changeLogArrow }, ' → '),
                                  h('span', { style: S.changeLogNew }, entry.newDisplay),
                                )
                              : h('span', { style: S.changeLogNew }, entry.newDisplay),
                          )
                        )
                      : null,
                )
              : null,
          )
        }),
      )
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    // ── Standalone floating panel (no dock-base required) ───────────────
    // ═══════════════════════════════════════════════════════════════════════
//#region StandaloneMode ───────────────────────────────────────────────────────
    // When dock-base is not installed, dock-flash mounts its own trigger
    // button and floating panel directly into the DOM. This provides access
    // to all non-layout switches (theme, language, proxy, fullscreen,
    // session-log-download, skin) without the workbench infrastructure.

    function mountStandaloneSlotTrigger(ctx, registry) {
      // ═══════════════════════════════════════════════════════════════════════
      // ── Standalone floating panel (no dock-base required) ───────────────
      // ═══════════════════════════════════════════════════════════════════════
      // The ⚡ trigger button is injected into one of several DSH UI slots.
      // The user can switch positions via the "trigger-position" switch.
      // Clicking the trigger opens a floating QuickControlPanel.

      // ── Trigger position configuration ──
      var _posStoreKey = 'dock-flash:trigger-position'
      var TRIGGER_POSITIONS = [
        { value: 'input.left',        slot: 'conversation.input.left',                   label: L('triggerInputLeft'),          style: 'input' },
        { value: 'input.right',       slot: 'conversation.input.right',                  label: L('triggerInputRight'),         style: 'input' },
        { value: 'session.header',    slot: 'conversation.session.header.actions',       label: L('triggerSessionHeader'),      style: 'header' },
        { value: 'header.utils',      slot: 'conversation.session.header.utilities',     label: L('triggerSessionHeaderUtils'), style: 'header' },
      ]

      function loadTriggerPosition() {
        try {
          var raw = localStorage.getItem(_posStoreKey)
          if (raw && TRIGGER_POSITIONS.some(function (p) { return p.value === raw })) return raw
        } catch (_) {}
        return 'input.right'
      }
      function saveTriggerPosition(pos) {
        try { localStorage.setItem(_posStoreKey, pos) } catch (_) {}
      }

      var currentPosition = loadTriggerPosition()

      // ── Shared panel state ──
      var panelVisible = false
      var panelContainer = null
      var reactRoot = null
      var reactRootInstance = null
      var floatingHead = null
      var closeBtn = null
      var cobBtn = null
      var cobDispose = null
      var dragging = false
      var dragSource = null
      var dragStartX = 0
      var dragStartY = 0
      var dragMoved = false
      var handleDragMove = null
      var handleDragEnd = null
      var handleOutsideClick = null
      var handleEscape = null
      var onPanelStateChange = null
      var slotDispose = null   // dispose function for current slot injection

      // ── Panel container (created lazily on first open) ──
      function ensurePanelContainer() {
        if (panelContainer) return
        panelContainer = document.createElement('div')
        panelContainer.setAttribute('data-dsh-plugin', 'dock-flash-standalone')
        Object.assign(panelContainer.style, {
          position: 'fixed',
          width: '320px',
          maxHeight: '70vh',
          overflow: 'hidden',
          borderRadius: '10px',
          zIndex: '99998',
          background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
          border: '1px solid var(--dsw-alias-border-l2, #21262d)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
          display: 'none',
          flexDirection: 'column',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '13px',
          color: 'var(--dsw-alias-label-primary, #c9d1d9)',
          boxSizing: 'border-box',
        })

        // ── Floating head ──
        floatingHead = document.createElement('div')
        Object.assign(floatingHead.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          height: '34px',
          flex: 'none',
          padding: '0 6px',
          cursor: 'move',
          userSelect: 'none',
          fontSize: '12px',
          fontWeight: '600',
          color: 'var(--dsw-alias-label-primary, #1f2328)',
          background: 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12))',
          borderBottom: '1px solid var(--dsw-alias-border-l2, #d8dbe0)',
        })
        var gripSpan = document.createElement('span')
        gripSpan.textContent = '⠿'
        Object.assign(gripSpan.style, {
          color: 'var(--dsw-alias-label-secondary, #656d76)',
          fontSize: '11px',
          marginRight: '2px',
        })
        var iconSpan = document.createElement('span')
        iconSpan.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block"><path d="M9.22 1.35a.75.75 0 0 1 .43.68v4.72h3.1a.75.75 0 0 1 .59 1.22l-5.4 6.72a.75.75 0 0 1-1.34-.46V9.49H3.25a.75.75 0 0 1-.59-1.22l5.4-6.72a.75.75 0 0 1 1.16-.2Z" fill="currentColor"/></svg>'
        Object.assign(iconSpan.style, { fontSize: '13px', display: 'inline-flex', alignItems: 'center', lineHeight: 1 })
        var titleSpan = document.createElement('span')
        titleSpan.textContent = t('title')
        Object.assign(titleSpan.style, {
          flex: '1',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        })
        // ── Close-on-blur toggle, left of the close button ──
        //    Reads/writes through the module-level channel, so it stays in step
        //    with the outside-click handler, the standalone Layout switch and the
        //    workbench header button.
        var _cobPaint = function () {
          var on = readCloseOnBlur()
          cobBtn.setAttribute('aria-pressed', String(on))
          cobBtn.setAttribute('aria-label', closeOnBlurLabel(on))
          cobBtn.setAttribute('title', closeOnBlurLabel(on))
          cobBtn.style.opacity = on ? '1' : '0.55'
          cobBtn.style.background = on ? 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.18))' : 'transparent'
        }
        cobBtn = document.createElement('button')
        cobBtn.type = 'button'
        cobBtn.innerHTML = CLOSE_ON_BLUR_ICON_SVG
        Object.assign(cobBtn.style, {
          border: '0',
          borderRadius: '5px',
          background: 'transparent',
          cursor: 'pointer',
          color: 'inherit',
          padding: '2px 6px',
          display: 'inline-flex',
          alignItems: 'center',
        })
        cobBtn.addEventListener('mouseenter', function () { cobBtn.style.opacity = '1' })
        cobBtn.addEventListener('mouseleave', _cobPaint)
        cobBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          writeCloseOnBlur(!readCloseOnBlur(), registry)
        })
        _cobPaint()
        // Repaint when the Layout switch (or anything else) changes the value.
        cobDispose = subscribeCloseOnBlur(_cobPaint)

        closeBtn = document.createElement('button')
        closeBtn.textContent = '×'
        closeBtn.setAttribute('aria-label', 'Close')
        closeBtn.setAttribute('title', 'Close')
        Object.assign(closeBtn.style, {
          border: '0',
          borderRadius: '5px',
          background: 'transparent',
          cursor: 'pointer',
          color: 'inherit',
          opacity: '0.75',
          padding: '2px 8px',
          fontSize: '13px',
        })
        closeBtn.addEventListener('mouseenter', function () {
          closeBtn.style.opacity = '1'
          closeBtn.style.background = 'rgba(209, 36, 47, 0.18)'
        })
        closeBtn.addEventListener('mouseleave', function () {
          closeBtn.style.opacity = '0.75'
          closeBtn.style.background = 'transparent'
        })
        floatingHead.appendChild(gripSpan)
        floatingHead.appendChild(iconSpan)
        floatingHead.appendChild(titleSpan)
        floatingHead.appendChild(cobBtn)
        floatingHead.appendChild(closeBtn)
        panelContainer.appendChild(floatingHead)

        // ── Head drag support ──
        floatingHead.addEventListener('mousedown', function (e) {
          if (e.target === closeBtn || e.target === cobBtn) return
          e.preventDefault()
          dragging = true
          dragSource = 'head'
          dragMoved = false
          dragStartX = e.clientX
          dragStartY = e.clientY
        })

        // ── React rendering root ──
        reactRoot = document.createElement('div')
        Object.assign(reactRoot.style, {
          flex: '1',
          minHeight: '0',
          overflowY: 'auto',
        })
        panelContainer.appendChild(reactRoot)

        // ── Close button ──
        closeBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          closePanel()
        })

        document.body.appendChild(panelContainer)
      }

      function renderPanel() {
        var props = {
          ctx: ctx,
          active: true,
          viewId: 'dock-flash:standalone',
          sessionId: 'standalone',
          seed: Date.now(),
          standalone: true,
        }
        try {
          if (ReactDOMClient && ReactDOMClient.createRoot && !reactRootInstance) {
            reactRootInstance = ReactDOMClient.createRoot(reactRoot)
          }
          var element = h(PanelErrorBoundary, null, h(QuickControlPanel, props))
          if (reactRootInstance) {
            reactRootInstance.render(element)
          } else {
            console.warn('[dock-flash] renderPanel: no createRoot available')
            reactRoot.innerHTML = '<div style="padding:12px;color:#d29922;">⚠ React renderer not available</div>'
          }
        } catch (e) {
          console.error('[dock-flash] standalone panel render error:', e)
          reactRoot.innerHTML = '<div style="padding:12px;color:#d29922;">⚠ render error</div>'
        }
      }

      function unmountPanel() {
        try {
          if (reactRootInstance) {
            reactRootInstance.unmount()
            reactRootInstance = null
          }
        } catch (_) {}
        if (reactRoot) reactRoot.innerHTML = ''
      }

      function closePanel() {
        panelVisible = false
        if (panelContainer) panelContainer.style.display = 'none'
        unmountPanel()
        if (onPanelStateChange) onPanelStateChange(false)
      }

      // ── Position the floating panel relative to the trigger element ──
      function positionPanel() {
        if (!panelContainer) return
        var triggerEl = document.querySelector('[data-dock-flash-trigger]')
        if (!triggerEl) {
          // Fallback: bottom-left
          panelContainer.style.bottom = '64px'
          panelContainer.style.top = 'auto'
          panelContainer.style.left = '12px'
          panelContainer.style.right = 'auto'
          return
        }
        var rect = triggerEl.getBoundingClientRect()
        var posConfig = TRIGGER_POSITIONS.find(function (p) { return p.value === currentPosition })

        if (posConfig && posConfig.style === 'input') {
          // Input area: panel above the trigger button, aligned to its left edge
          panelContainer.style.bottom = (window.innerHeight - rect.top + 6) + 'px'
          panelContainer.style.top = 'auto'
          panelContainer.style.left = Math.max(8, rect.left) + 'px'
          panelContainer.style.right = 'auto'
        } else if (posConfig && posConfig.style === 'header') {
          // Session header: panel below the trigger, right-aligned
          panelContainer.style.top = (rect.bottom + 6) + 'px'
          panelContainer.style.bottom = 'auto'
          panelContainer.style.right = (window.innerWidth - rect.right) + 'px'
          panelContainer.style.left = 'auto'
        } else {
          panelContainer.style.bottom = '64px'
          panelContainer.style.top = 'auto'
          panelContainer.style.left = '12px'
          panelContainer.style.right = 'auto'
        }
      }

      function openPanel() {
        ensurePanelContainer()
        positionPanel()
        panelVisible = true
        panelContainer.style.display = 'flex'
        renderPanel()
        if (onPanelStateChange) onPanelStateChange(true)
      }

      // ── SVG lightning icon — uses currentColor to follow theme ──
      function LightningIcon(size) {
        return h('svg', {
          width: size, height: size, viewBox: '0 0 16 16',
          fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
          style: { display: 'block' },
        },
          h('path', {
            d: 'M9.22 1.35a.75.75 0 0 1 .43.68v4.72h3.1a.75.75 0 0 1 .59 1.22l-5.4 6.72a.75.75 0 0 1-1.34-.46V9.49H3.25a.75.75 0 0 1-.59-1.22l5.4-6.72a.75.75 0 0 1 1.16-.2Z',
            fill: 'currentColor',
          })
        )
      }

      // ── QuickTriggerIconButton — compact icon button for input/header slots ──
      function QuickTriggerIconButton(props) {
        var _s = useState(false)
        var active = _s[0]
        var setActive = _s[1]

        useEffect(function () {
          onPanelStateChange = function (visible) { setActive(visible) }
          return function () { onPanelStateChange = null }
        }, [])

        var handleClick = function () {
          if (panelVisible) closePanel(); else openPanel()
        }

        var posConfig = TRIGGER_POSITIONS.find(function (p) { return p.value === currentPosition })
        var isHeader = posConfig && posConfig.style === 'header'

        var btnStyle = {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          background: active ? 'rgba(90, 120, 255, 0.18)' : 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          padding: isHeader ? '2px 4px' : '2px',
          fontSize: isHeader ? '14px' : '16px',
          lineHeight: 1,
          transition: 'background 0.15s ease',
          outline: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          minWidth: isHeader ? undefined : '24px',
          height: isHeader ? undefined : '24px',
        }

        return h('button', {
          type: 'button',
          'data-dock-flash-trigger': '',
          'aria-label': t('title'),
          'aria-expanded': active,
          title: t('title'),
          onClick: handleClick,
          style: btnStyle,
          onMouseEnter: function (e) {
            if (!active) e.currentTarget.style.background = 'rgba(127, 127, 127, 0.12)'
          },
          onMouseLeave: function (e) {
            if (!active) e.currentTarget.style.background = 'transparent'
          },
        }, LightningIcon(isHeader ? 14 : 16))
      }

      // ── Register drag and outside-click handlers lazily ──
      function ensureGlobalListeners() {
        if (handleDragMove) return

        handleDragMove = function (e) {
          if (!dragging) return
          var dx = e.clientX - dragStartX
          var dy = e.clientY - dragStartY
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true
          if (dragSource === 'head' && panelContainer) {
            var panelRect = panelContainer.getBoundingClientRect()
            var newLeft = panelRect.left + dx
            var newTop = panelRect.top + dy
            newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - panelRect.width))
            newTop = Math.max(0, Math.min(newTop, window.innerHeight - panelRect.height))
            panelContainer.style.left = newLeft + 'px'
            panelContainer.style.right = 'auto'
            panelContainer.style.top = newTop + 'px'
            panelContainer.style.bottom = 'auto'
            dragStartX = e.clientX
            dragStartY = e.clientY
          }
        }
        handleDragEnd = function () {
          if (!dragging) return
          dragging = false
          dragSource = null
        }
        handleOutsideClick = function (e) {
          if (!panelVisible) return
          // Respect close-on-blur setting (shared key with workbench mode)
          try {
            var cobMode = localStorage.getItem('dock-flash:close-on-blur')
            if (cobMode === 'off') return  // disabled — don't close on outside click
          } catch (_) {}
          if (panelContainer && panelContainer.contains(e.target)) return
          var badgeEl = e.target.closest && e.target.closest('[data-dock-flash-trigger]')
          if (badgeEl) return
          closePanel()
        }
        handleEscape = function (e) {
          if (e.key === 'Escape' && panelVisible) closePanel()
        }
        document.addEventListener('mousemove', handleDragMove)
        document.addEventListener('mouseup', handleDragEnd)
        document.addEventListener('mousedown', handleOutsideClick, true)
        document.addEventListener('keydown', handleEscape, true)
      }

      // ── Wait for the slots service via ctx.inject ──
      // ctx.inject(['slots'], callback) creates a sub-plugin that waits until
      // the 'slots' service is available, then runs the callback. This works
      // even though dock-flash has inject:[] (no hard dependency on slots).
      ctx.inject(['slots'], function (scope) {
        var slots = scope.slots
        console.log('[dock-flash] standalone mode: slots service available, mounting trigger')

        // ── Inject trigger into a slot by position value ──
        function injectTrigger(posValue) {
          var posConfig = TRIGGER_POSITIONS.find(function (p) { return p.value === posValue })
          if (!posConfig) return null

          var Component = QuickTriggerIconButton

          return ctx.effect(function () {
            ensureGlobalListeners()
            return slots.inject(posConfig.slot, function () {
              return slots.register({
                name: posConfig.slot,
                id: 'dock-flash-trigger',
                locale: NS,
              }, Component)
            })
          }, 'dock-flash: standalone trigger (' + posValue + ')')
        }

        // ── Inject the initial trigger ──
        slotDispose = injectTrigger(currentPosition)

        // ── Register trigger-position switch ──
        if (registry) {
          registry.registerSwitch({
            id: 'dock-flash:trigger-position',
            label: L('triggerPosition'),
            icon: '📍',
            type: 'select',
            group: 'layout',
            order: 25,
            options: TRIGGER_POSITIONS.map(function (p) {
              return { label: p.label, value: p.value }
            }),
            getValue: function () { return currentPosition },
            setValue: function (v) {
              if (v === currentPosition) return
              // Close panel if open
              if (panelVisible) closePanel()
              // Dispose old slot injection
              if (slotDispose) {
                try { slotDispose() } catch (_) {}
                slotDispose = null
              }
              // Switch position
              currentPosition = v
              saveTriggerPosition(v)
              // Inject into new slot
              slotDispose = injectTrigger(v)
            },
          })
        }

        // ── Register close-on-blur switch (standalone Layout group) ──
        //    Same setting as the panel-header toggle, and the same control
        //    surface users had before it moved to the header. writeCloseOnBlur()
        //    is the only writer, so this switch and the header toggle stay in
        //    step in both directions. Standalone mode only: in workbench mode no
        //    built-in switch carries group 'layout', which is exactly why that
        //    category is absent there.
        if (registry) {
          registry.registerSwitch({
            id: 'dock-flash:close-on-blur',
            label: L('closeOnBlur'),
            icon: '👁️‍🗨️',
            type: 'buttongroup',
            group: 'layout',
            order: 42,
            options: i18nOptions([['closeOnBlurOff', 'off'], ['closeOnBlurOn', 'floating']]),
            getValue: function () { return readCloseOnBlur() ? 'floating' : 'off' },
            setValue: function (v) { writeCloseOnBlur(v !== 'off', registry) },
          })
        }
      })

      // ── Return cleanup function ──
      // Note: ctx.inject creates a sub-plugin that is automatically disposed
      // when the parent (dock-flash) is disposed, so slot injection cleanup
      // is handled by Cordis lifecycle. We only need to clean up DOM resources.
      return function () {
        unmountPanel()
        if (slotDispose) {
          try { slotDispose() } catch (_) {}
          slotDispose = null
        }
        if (panelContainer) panelContainer.remove()
        if (cobDispose) { try { cobDispose() } catch (_) {} cobDispose = null }
        if (handleDragMove) document.removeEventListener('mousemove', handleDragMove)
        if (handleDragEnd) document.removeEventListener('mouseup', handleDragEnd)
        if (handleOutsideClick) document.removeEventListener('mousedown', handleOutsideClick, true)
        if (handleEscape) document.removeEventListener('keydown', handleEscape, true)
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    // ── Plugin entry point ───────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════
//#region PluginEntry ──────────────────────────────────────────────────────────
    return {
      inject: [],
      apply(ctx) {
        try {
          // Use ctx.get() — NOT ctx.workbench — because the DSH guard proxy
          // blocks property access for services not in the provider's inject[].
          // When dock-base is not installed, wb is undefined and dock-flash
          // enters standalone mode (floating panel instead of workbench panel).
          const wb = ctx.get ? ctx.get('workbench') : undefined

          // DSH locale service (from @deepseek-ai/dsh-client-locale).
          // Provides setLocale(id) to change global UI language and
          // getSnapshot().active to read the current locale.
          // Resolved lazily — locale may not be available at apply() time.
          const getLocaleService = () => {
            try { return ctx.get('locale') } catch (_) { return undefined }
          }

          // DSH theme service (from @deepseek-ai/dsh-client-ui-theme).
          // Provides setTheme(id) to change global color scheme and
          // getTheme() to read the current preference/snapshot.
          // Resolved lazily — theme may not be available at apply() time.
          const getThemeService = () => {
            try { return ctx.get('theme') } catch (_) { return undefined }
          }

          // ── 1. Create & publish the quickControl registry service ──────
          const registry = createQuickControlRegistry()
          ctx.provide('quickControl', registry)

          // Emit a ready event so other plugins can discover the quickControl
          // service without declaring a hard inject dependency.  This enables
          // optional integration: a plugin can listen for 'dock-flash:ready'
          // via ctx.on() and still function normally when dock-flash is absent.
          // See INTEGRATION.md for the recommended dual-mode pattern:
          //   ctx.on('dock-flash:ready', cb) + ctx.get('quickControl') fallback.
          // Note: we use try/catch because the cordis context available on the
          // client side may not have a full EventEmitter implementation.
          try { ctx.emit('dock-flash:ready', registry) } catch (_) {}

          // ── 2. Register built-in switches through the same registry ────
          //    (other plugins use the exact same API)

          // Clean up legacy zoom state (removed in v0.15.1)
          // If the user had set a non-100% zoom before upgrading,
          // the style.zoom property would still be on <html> and
          // the localStorage key would remain — remove both.
          try {
            document.documentElement.style.removeProperty('zoom')
            localStorage.removeItem('dock-flash:zoom')
          } catch (_) {}

          // Theme toggle — controls global DSH color scheme
          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:theme',
              label: L('theme'),
              icon: '🌡️',
              type: 'select',
              group: 'appearance',
              order: 20,
              options: () => {
                try {
                  const svc = getThemeService()
                  const themes = svc ? (svc.getTheme()?.themes || []) : []
                  const labelMap = { light: L('themeLight'), dark: L('themeDark') }
                  const opts = themes.map((th) => ({ label: labelMap[th.id] || th.id, value: th.id }))
                  opts.push({ label: L('themeSystem'), value: 'system' })
                  return opts
                } catch (_) {
                  return [{ label: L('themeSystem'), value: 'system' }]
                }
              },
              getValue: () => {
                const svc = getThemeService()
                if (svc) {
                  try { return svc.getTheme().preference } catch (_) {}
                }
                try {
                  const cs = getComputedStyle(document.documentElement).colorScheme
                  return cs === 'light' ? 'light' : 'dark'
                } catch (_) { return 'dark' }
              },
              setValue: (v) => {
                const svc = getThemeService()
                const _BH_ID = 'wxj-black-hole'

                // Special handling when switching AWAY from wxj-black-hole:
                // That plugin has a synchronous theme/change listener that
                // reverts to wxj-black-hole if its own settings still say
                // "wxj-black-hole".  We must update those settings first,
                // then retry setTheme until the client-side mirror catches up.
                if (v !== _BH_ID && svc && svc.getTheme().preference === _BH_ID) {
                  // Fire-and-forget: tell the host to set black-hole setting to "off"
                  try {
                    const remote = ctx.get('remote')
                    if (remote && remote.settings && typeof remote.settings.update === 'function') {
                      remote.settings.update('wxj-theme-black-hole', { theme: 'off' }).catch(() => {})
                    }
                  } catch (_) {}

                  // Retry setTheme with short delays until the settings mirror
                  // on the client side has updated and the plugin stops reverting.
                  let attempts = 0
                  const retry = () => {
                    if (attempts++ > 15) return   // give up after ~2.4 s
                    try {
                      svc.setTheme(v)
                      if (svc.getTheme().preference === v) {
                        // Theme stuck — success
                        try { registry.notifyChange() } catch (_) {}
                        return
                      }
                    } catch (_) {}
                    setTimeout(retry, 150)
                  }
                  retry()
                  return
                }

                // Normal path: set theme synchronously
                if (svc) {
                  try { svc.setTheme(v) } catch (_) {}
                }
                // Deactivate dock-flash skin so it stops overriding the theme
                try {
                  const currentSkin = _getActiveSkinId()
                  if (currentSkin && currentSkin !== 'default') {
                    _applySkin('default')
                  }
                } catch (_) {}
                try { registry.notifyChange() } catch (_) {}
              },
            })
            return dispose
          }, 'dock-flash: theme switch')

          // ── Skin plugin switcher ────────────────────────────────────────
          // Detects installed skin plugins by scanning the DOM for <style> and
          // <link> tags with data-plugin attributes containing skin-related
          // keywords, plus body data-dsh-* attributes.  Supports switching
          // between installed skins and "default" (no skin) by toggling the
          // `disabled` property on style/link tags and body attributes.
          //
          // NOTE: We intentionally do NOT use a MutationObserver to watch for
          // new skin plugins being loaded. A previous MutationObserver on
          // <head> fired on every DOM change (including DSH's own style
          // mutations during sidebar transitions), which called
          // registry.notifyChange() and triggered React re-renders that
          // corrupted the sidebar state, causing the entire sidebar to
          // collapse on any activity bar click. Instead, we re-scan the DOM
          // each time the panel becomes active (via the skinTick state).
          const _skinStorageKey = 'dock-flash:active-skin'
          const _skinHint = /skin|theme(?!-manager)|maid|whale|aqua|endfield|claude|galgame|glass|neon|cyber|pixel|anime|game|transparent|ocean|sea|wallpaper|pastel|nocturne|day-night|visual|vtuber|waifu|dream|codex|qingxiao|kafka|verdandi|blue-whale|whalegirl|neo|bloom/i
          // Theme-only plugins that match _skinHint but should NOT appear in the
          // skin switcher — they work through the theme service, not CSS/body-attr.
          const _skinExclude = /black-hole|theme-manager|dsh-bloom-theme/i
          // Known activation attributes: mapping from pluginId → attribute name.
          // DSH skins mark themselves active either on <body> or on <html>, so
          // every check below looks at BOTH elements.  Only list skins that may
          // NOT have a <style data-plugin="…"> tag discoverable by DOM scan; if a
          // skin IS found via DOM scan its attribute is looked up from this same
          // map, so every entry here serves double duty.
          // IMPORTANT: never map two plugin IDs to the same attribute — that
          // creates phantom entries in the skin switcher.
          const _skinBodyAttrs = {
            '@dsh-external/dsh-client-ui-skin-maid-atelier': 'data-dsh-maid-atelier',
            // Marks itself on <html>, not <body> (lib/client.js: setAttribute on
            // document.documentElement inside ctx.effect).
            'dsh-official-homepage-theme': 'data-dsh-harness-official-theme',
            // Sets data-dsh-claude-style on <body> via body.setAttribute inside
            // ctx.effect().  The <style data-skin-chrome> tag uses the style-element
            // ID ("claude-style-skin-style") rather than the package name, so the
            // body-attr mapping is essential for Phase 1b/4 activation detection.
            'claude-style-skin': 'data-dsh-claude-style',
          }

          // ── dshmarket theme integration ────────────────────────────────────
          // A DISABLED theme plugin is removed from the loader tree, so the host
          // never composes a client bundle for it: it is absent from
          // window.__DSH_BOOT__ and from the module graph, and no browser-side
          // scan can ever see it.  The only authority on installed-but-disabled
          // themes is dshmarket's own HTTP API, which also owns activation
          // (activating one theme disables every other, persisted for the next
          // boot).  We therefore merge two sources:
          //   - the DOM/graph scan above  → themes that are currently loaded
          //   - /dsh-market/installed     → every installed theme + its state
          // and route activation through /dsh-market/use-skin.
          const _marketApiBase = '/dsh-market'
          /** Last known market view: { themes: [{name,label,state}], at: number }. */
          let _marketThemes = null
          let _marketFetchInFlight = false

          /** True when a market endpoint answered (so the market is installed). */
          function _marketAvailable() {
            return _marketThemes !== null
          }

          /** Human label from a package name, mirroring the DOM-scan rules. */
          function _labelFromId(id) {
            let label = String(id).split('/').pop() || String(id)
            label = label.replace(/^dsh-(client-)?(ui-)?(skin-)?/, '')
            label = label.replace(/[_-]?(ui|skin|theme|plugin)$/i, '')
            if (!label) label = String(id).split('/').pop() || String(id)
            label = label.replace(/[-_]+/g, ' ')
            label = label.replace(/\b\w/g, (c) => c.toUpperCase())
            return label
          }

          /**
           * The market's own theme classification is registry-backed, so we do
           * not re-implement it: we take every installed package the market
           * reports and keep it when the name looks like a skin/theme.  That is
           * deliberately broader than the DOM scan's hint because a disabled
           * theme has no DOM evidence to lean on.
           */
          function _isThemeName(name) {
            return _skinHint.test(name) && !_skinExclude.test(name)
          }

          /** Dispose handle for the skin switch (null when not registered). */
          var _skinSwitchDispose = null

          /**
           * Optimistic skin selection — set immediately in setValue() so that
           * getValue() returns the user's choice before the async activation
           * completes.  Cleared when the activation finishes or the page reloads.
           * This prevents the dropdown from snapping back to the old value while
           * the new skin is loading.
           */
          var _pendingSkinId = null

          /** Shared "Default" option for the skin switch. */
          var _defaultSkinOpt = { label: L('skinDefault'), value: 'default' }

          /** Register the skin switch; idempotent — skips if already registered. */
          function _registerSkinSwitch() {
            if (_skinSwitchDispose) return
            _skinSwitchDispose = registry.registerSwitch({
              id: 'dock-flash:skin',
              label: L('skin'),
              icon: '🎨',
              type: 'select',
              group: 'appearance',
              order: 25,
              options: () => {
                try {
                  const skins = _scanInstalledSkins()
                  const opts = [{ label: _defaultSkinOpt.label, value: _defaultSkinOpt.value }]
                  const seenIds = new Set()
                  for (const skin of skins) {
                    const lbl = skin.label
                    opts.push({ label: lbl, value: skin.id })
                    seenIds.add(skin.id)
                  }

                  // Merge installed-but-not-loaded themes from the market.  These
                  // are the disabled ones: absent from the DOM and from the boot
                  // manifest, so the scan cannot see them (see _marketThemeExtras).
                  // The cache is filled by the eager fetch in ctx.effect above and
                  // refreshes itself through registry.notifyChange.
                  for (const extra of _marketThemeExtras(seenIds)) {
                    const off = extra.state === 'disabled'
                    opts.push({
                      label: off ? extra.label + ' (' + t('skinInactive') + ')' : extra.label,
                      value: extra.id,
                    })
                  }
                  return opts
                } catch (e) {
                  console.error('[dock-flash] skin options() threw:', e)
                  return [_defaultSkinOpt]
                }
              },
              getValue: () => {
                try { return _getActiveSkinId() } catch (_) { return 'default' }
              },
              setValue: (v) => {
                // Set optimistic selection immediately so the dropdown updates
                // before the async skin activation completes.
                _pendingSkinId = (v === 'default') ? null : v
                // A market-managed theme must ALWAYS go through the market, even
                // when the DOM scan can see it.  Seeing it only means its bundle
                // is loaded in this page; switching between two loaded themes is
                // still a loader-tree change (the market keeps exactly one theme
                // enabled and persists that choice), and no amount of style-tag /
                // attribute fiddling can reproduce it — the next page load would
                // revert to whatever the market has recorded.
                //
                // Themes the market does not know about are plugin-local CSS
                // skins, which _applySkin can toggle in place.
                const isMarketTheme = _marketThemes
                  ? _marketThemes.themes.some((th) => th.name === v)
                  : false
                if (v !== 'default' && _marketAvailable() && isMarketTheme) {
                  _activateThemeViaMarket(v)
                  return
                }
                _applySkin(v)
                // Clear pending after synchronous activation is done.
                // (For async paths like _reactivateCssSkin, the generation
                // counter handles staleness; the pending flag just ensures
                // the dropdown shows the right value during the brief delay.)
                _pendingSkinId = null
              },
            })
          }

          /** Unregister the skin switch; idempotent. */
          function _unregisterSkinSwitch() {
            if (_skinSwitchDispose) {
              _skinSwitchDispose()
              _skinSwitchDispose = null
            }
          }

          /** Fetch installed themes from the market; safe to call repeatedly. */
          function _refreshMarketThemes() {
            if (_marketFetchInFlight) return
            _marketFetchInFlight = true
            try {
              const url = new URL(_marketApiBase + '/installed', document.baseURI).pathname
              fetch(url, { headers: { accept: 'application/json' } })
                .then((res) => (res.ok ? res.json() : null))
                .then((body) => {
                  if (!body || typeof body !== 'object') { _marketFetchInFlight = false; return }
                  const installed = body.installed || {}
                  const activation = body.activation || {}
                  const themes = []
                  for (const name of Object.keys(installed)) {
                    if (!_isThemeName(name)) continue
                    const state = (activation[name] && activation[name].state) || 'unknown'
                    themes.push({ name, label: _labelFromId(name), state })
                  }
                  _marketThemes = { themes, at: Date.now() }
                  _marketFetchInFlight = false

                  // Reconcile managed plugins' private enable flags with the
                  // market's live theme.  A theme activated from the market's own
                  // UI (or left active from a previous session) never passed
                  // through _activateThemeViaMarket, so its flag can still say
                  // "off" while its bundle is loaded — the plugin then boots and
                  // renders nothing.  Doing this on every fetch also heals the
                  // state left by earlier dock-flash versions.
                  const liveTheme = themes.find((th) => th.state === 'live')
                  _syncManagedEnableFlags(liveTheme ? liveTheme.name : null)

                  // Market is available — register the skin switch (idempotent).
                  // Without dsh-market the skin switcher is not shown because
                  // disabled themes are invisible to the DOM scan and the list
                  // would be incomplete.
                  _registerSkinSwitch()

                  // Nudge the registry so the dropdown re-renders with the
                  // newly known themes from the market.
                  if (themes.length > 0) {
                    try { registry.notifyChange('dock-flash:skin') } catch (_) {}
                  }
                })
                .catch(() => { _marketFetchInFlight = false })
            } catch (_) {
              _marketFetchInFlight = false
            }
          }

          /**
           * Installed market themes, with the ones the DOM scan already found
           * removed (the caller owns merging).  Returns [] when no market fetch
           * has succeeded yet — the scan alone remains the fallback.
           */
          function _marketThemeExtras(seenIds) {
            if (!_marketThemes) return []
            const out = []
            for (const th of _marketThemes.themes) {
              if (seenIds.has(th.name)) continue
              // A managed skin carries a curated label (its own settings row
              // uses it); prefer that over the derived one.
              const managed = _managedSkins[th.name]
              out.push({
                id: th.name,
                label: (managed && managed.label) || th.label,
                state: th.state,
              })
            }
            return out
          }

          /**
           * Activate a theme through the market, which also disables every other
           * theme and persists the choice.  Returns a Promise<boolean>.
           *
           * The page is reloaded on success: activation changes the loader tree,
           * hence the boot manifest and the served bundles, so the running page
           * cannot pick the new theme up in place.
           */
          function _activateThemeViaMarket(name) {
            const url = new URL(_marketApiBase + '/use-skin', document.baseURI).pathname
            return fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name: name }),
            })
              .then((res) => res.json().then((body) => ({ ok: res.ok, body })).catch(() => ({ ok: res.ok, body: null })))
              .then((r) => {
                if (r.ok && r.body && r.body.ok) {
                  // The market confirmed the switch: now mirror it into the
                  // managed plugins' own enable flags.  This runs BEFORE the
                  // reload so the bundle about to load reads the new value, and
                  // it happens only on success so a failed activation cannot
                  // leave a flag flipped.
                  _syncManagedEnableFlags(name)
                  try { sessionStorage.setItem('dock-flash:activated-theme', name) } catch (_) {}
                  // Smooth page transition: fade out before reload so the
                  // white flash is replaced by a brief dim-out.
                  _fadeBeforeReload()
                  return true
                }
                console.warn('[dock-flash] use-skin failed:', r.body && r.body.error)
                return false
              })
              .catch((e) => { console.warn('[dock-flash] use-skin threw:', e); return false })
          }

          /**
           * Create a smooth fade-out overlay before a page reload.
           * The overlay fades in over 150ms, then triggers location.reload().
           * This replaces the jarring "white flash" of a bare reload with
           * a brief dim-out that feels like a deliberate transition.
           */
          function _fadeBeforeReload() {
            try {
              var overlay = document.createElement('div')
              overlay.setAttribute('data-dock-flash-fade', '')
              Object.assign(overlay.style, {
                position: 'fixed',
                top: '0', left: '0', right: '0', bottom: '0',
                zIndex: '999999',
                background: 'var(--dsw-alias-bg-base, #fff)',
                opacity: '0',
                transition: 'opacity 150ms ease-in',
                pointerEvents: 'none',
              })
              document.body.appendChild(overlay)
              // Force layout then trigger transition
              overlay.offsetWidth // force reflow
              overlay.style.opacity = '1'
              // Reload after the transition completes
              setTimeout(function () { location.reload() }, 160)
            } catch (_) {
              // Fallback: just reload immediately
              location.reload()
            }
          }

          /**
           * Does `attr` appear on either root element?  Skin plugins are
           * inconsistent about which one they mark, and a skin is active if
           * either carries the attribute.
           */
          function _hasSkinAttr(attr) {
            if (!attr) return false
            try {
              return document.documentElement.hasAttribute(attr) ||
                document.body.hasAttribute(attr)
            } catch (_) { return false }
          }

          /**
           * Set or clear a skin's activation attribute on BOTH root elements.
           * dock-flash cannot know which element a plugin marks (they differ),
           * and the CSS these plugins ship targets its own element, so writing
           * both is safe and keeps the switcher's state readable by
           * `_hasSkinAttr` regardless of which one the plugin later touches.
           */
          function _setSkinAttr(attr, on) {
            if (!attr) return
            try {
              if (on) {
                document.documentElement.setAttribute(attr, '')
                document.body.setAttribute(attr, '')
              } else {
                document.documentElement.removeAttribute(attr)
                document.body.removeAttribute(attr)
              }
            } catch (_) {}
          }

          // Skins that manage their own enable/disable lifecycle via
          // localStorage + JS.  We toggle these through the plugin's own
          // mechanism (write localStorage from a same-origin iframe to trigger
          // the storage event) instead of blindly disabling their style tags,
          // because they create DOM elements, run WebGL shaders, etc. that
          // must be properly cleaned up.
          const _managedSkins = {
            'dsh-theme-mineradio': {
              label: 'Mineradio',
              enabledKey: 'dsh.ui-mineradio.enabled',
              // The cordis plugin ID (from cordis.patch.yml half.pluginId).
              // The client runner registers the loader entry as 'dyn/' + pluginId,
              // so the entry name is 'dyn/ui-mineradio', NOT 'dyn/dsh-theme-mineradio'.
              pluginId: 'ui-mineradio',
              // Attribute on <html> that indicates the skin is active
              activeAttr: 'data-dsh-aqua',
              // Selector that proves the plugin is loaded (any of its style tags)
              installedSelector: 'style[data-plugin="dsh-theme-mineradio"]',
            },
          }

          /**
           * Mirror a market activation into the plugin's OWN enable flag.
           *
           * A managed skin keeps a private localStorage switch that gates its
           * own mount()/unmount() (Mineradio: `dsh.ui-mineradio.enabled`, read
           * once at construction and re-read on a `storage` event).  The market
           * knows nothing about that flag — it only adds/removes the loader
           * entry — so activating the theme through the market loads its bundle
           * while the bundle boots itself DISABLED and renders nothing.
           *
           * Writing the key here fixes both the current page (the plugin's
           * `storage` listener re-syncs live) and the next boot (it reads the
           * key at construction).  Web storage events do not fire in the tab
           * that made the write, so we use the iframe cross-tab trick to
           * trigger the skin's onStorage handler.
           */
          function _syncManagedEnableFlags(activeName) {
            for (const [id, cfg] of Object.entries(_managedSkins)) {
              if (!cfg.enabledKey) continue
              const want = id === activeName
              let current = null
              try { current = localStorage.getItem(cfg.enabledKey) } catch (_) { continue }
              if (current === String(want)) continue
              // Use the iframe cross-tab trick so the skin's onStorage handler fires
              _toggleManagedSkin(id, want)
            }
          }

          /**
           * Collapse a plugin-tagged id to the package that owns it.
           *
           * DSH plugin bundles span two id spaces: the boot manifest and module
           * graph key a plugin by its PACKAGE name ("dsh-qq-skin"), while the
           * `<style data-plugin>` tags a plugin injects may carry a SUBPATH of
           * that package ("dsh-qq-skin/layout").  Left alone, the same plugin is
           * discovered twice under two labels.  A scoped package keeps its scope
           * ("@scope/name"); everything after the first bare "/" is a subpath.
           */
          function _canonicalSkinId(id) {
            const s = String(id)
            if (s.startsWith('@')) {
              const parts = s.split('/')
              return parts.length > 2 ? parts[0] + '/' + parts[1] : s
            }
            return s.split('/')[0]
          }

          function _scanInstalledSkins() {
            const skins = []
            const seen = new Set()
            // Track which body attributes are already claimed by DOM-scanned skins
            const claimedAttrs = new Set()

            // Gather all available detection sources upfront.
            // Priority: __DSH_BOOT__ > graphRows > DOM > localStorage.
            // Both manifest sources are optional and independently useful, so a
            // missing one never disables the other.
            var _bootEntries = null
            try {
              var _boot = window.__DSH_BOOT__
              if (_boot && Array.isArray(_boot.entries)) _bootEntries = _boot.entries
            } catch (_) {}
            var _graphRows = null
            try {
              var _mod = ctx.get('modules')
              if (_mod && _mod.graphRows) _graphRows = _mod.graphRows
            } catch (e) {
              // ctx.get('modules') may not be available in this plugin's context
            }

            // Build a fast lookup set of ALL installed plugin IDs from the boot
            // manifest.  The manifest is served before any script runs and lists
            // every installed client plugin regardless of fiber state, so it is
            // the most reliable install signal.  Entries are keyed by package
            // name; the "/client" suffix appears on some rows, so normalize both
            // forms into the set.
            var _bootIds = new Set()
            if (_bootEntries) {
              for (var _bi = 0; _bi < _bootEntries.length; _bi++) {
                var _bid = _bootEntries[_bi] && _bootEntries[_bi].id
                if (typeof _bid !== 'string' || !_bid) continue
                _bootIds.add(_bid)
                if (_bid.endsWith('/client')) _bootIds.add(_bid.slice(0, -7))
              }
            }

            // 0. Managed skins — plugins with their own enable/disable lifecycle.
            //    These cannot be toggled by simply disabling style tags; they
            //    must be toggled through their own mechanism.
            //    We include a managed skin if ANY of these checks pass:
            //    (a) the plugin is in window.__DSH_BOOT__ entries (most reliable)
            //    (b) the plugin is a row in the module graph
            //    (c) its installedSelector matches a DOM element
            //    (d) its enabledKey exists in localStorage (persisted config)
            //    (a)/(b) also accept the "<id>/client" form, because the boot
            //    manifest and graph key some entries with that suffix.
            for (const [id, cfg] of Object.entries(_managedSkins)) {
              // When the market is answering and reports this theme as disabled,
              // the market owns its presentation: skip it here so phase 4's
              // market-extra path supplies the entry WITH its "not enabled"
              // state.  Claiming it here would add it to `seen` and suppress
              // that label, because none of the checks below can tell "installed
              // but unloaded" from "switched off" — check 4 in particular still
              // matches, since the market's disable leaves the plugin's own
              // localStorage key behind.
              if (_marketThemes && _marketThemes.themes.some(
                (th) => th.name === id && th.state === 'disabled')) {
                continue
              }
              var isInstalled = false
              var detectedBy = ''
              const _idVariants = [id, id + '/client']
              const _hasId = (set) => {
                if (!set) return false
                for (var _vi = 0; _vi < _idVariants.length; _vi++) {
                  if (set.has(_idVariants[_vi])) return true
                }
                return false
              }
              // Check 1: boot manifest (most reliable — always available)
              if (_hasId(_bootIds)) { isInstalled = true; detectedBy = 'boot' }
              // Check 2: module graph rows
              if (!isInstalled && _hasId(_graphRows)) { isInstalled = true; detectedBy = 'graphRows' }
              // Check 3: DOM selector
              if (!isInstalled && cfg.installedSelector && document.querySelector(cfg.installedSelector)) { isInstalled = true; detectedBy = 'dom' }
              // Check 4: localStorage
              if (!isInstalled) {
                try {
                  if (localStorage.getItem(cfg.enabledKey) !== null) { isInstalled = true; detectedBy = 'localStorage' }
                } catch (_) {}
              }
              if (!isInstalled) continue
              seen.add(id)
              const isActive = _hasSkinAttr(cfg.activeAttr)
              skins.push({ id, label: cfg.label, sel: null, isActive, bodyAttr: null, managed: true })
            }

            // 1a. Scan <head> for style[data-plugin] / link[data-plugin]
            //     (DSH runner-injected styles — e.g. dock-base, other plugins)
            //
            //     A plugin may tag these with a SUBPATH of its package id, while
            //     the boot manifest/graph knows it by the bare package name; see
            //     _canonicalSkinId.  We key the entry by the package and collect
            //     every tag's selector, so one plugin yields one entry that can
            //     still toggle all of its tags.
            const els1 = document.querySelectorAll('head style[data-plugin], head link[data-plugin]')
            for (const el of els1) {
              const rawId = el.dataset.plugin
              if (!rawId || rawId.startsWith('@deepseek-ai/')) continue
              const id = _canonicalSkinId(rawId)
              if (_managedSkins[id]) continue  // skip — handled in phase 0
              if (!_skinHint.test(id)) continue
              if (_skinExclude.test(id)) continue
              const sel = el.tagName === 'LINK'
                ? 'link[data-plugin="' + rawId + '"]'
                : 'style[data-plugin="' + rawId + '"]'
              // Already listed (another subpath tag of the same package, or an
              // earlier phase): keep one entry, widen its selector set.
              const existing = skins.find((s) => s.id === id)
              if (existing) {
                if (existing.selectors.indexOf(sel) === -1) existing.selectors.push(sel)
                if (!existing.sel) existing.sel = sel
                if (!existing.isActive && !el.disabled) existing.isActive = true
                continue
              }
              if (seen.has(id)) continue
              seen.add(id)
              const label = _labelFromId(id)
              const bodyAttr = _skinBodyAttrs[id] || null
              const isActive = !el.disabled && (!bodyAttr || _hasSkinAttr(bodyAttr))
              if (bodyAttr) claimedAttrs.add(bodyAttr)
              skins.push({ id, label, sel, selectors: [sel], isActive, bodyAttr })
            }

            // 1b. Scan <head> for style[data-skin-chrome]
            //     Some skin plugins create their own <style> element inside
            //     ctx.effect() with data-skin-chrome instead of data-plugin.
            //     We discover these by the chrome attribute and use the chrome
            //     value itself as the plugin id.  However, some skins set
            //     data-skin-chrome to their style-element ID rather than their
            //     package name (e.g., "claude-style-skin-style" for package
            //     "claude-style-skin"), which would cause duplicates when Phase 4
            //     also discovers the same skin from the boot manifest.  We resolve
            //     the canonical package ID by cross-referencing with the boot
            //     manifest when available.
            const els2 = document.querySelectorAll('head style[data-skin-chrome]')
            for (const el of els2) {
              const chrome = el.dataset.skinChrome
              var id = chrome
              // Resolve the canonical package ID.  Skin plugins often set
              // data-skin-chrome to a derived value (style-element ID, etc.)
              // rather than their package name, causing duplicates with Phase 4.
              if (_bootIds.size && !_bootIds.has(id) && !_bootIds.has(id + '/client')) {
                const _chromeSuffixes = ['-style', '-chrome', '-css']
                for (var _csi = 0; _csi < _chromeSuffixes.length; _csi++) {
                  if (id.endsWith(_chromeSuffixes[_csi])) {
                    const candidate = id.slice(0, -_chromeSuffixes[_csi].length)
                    if (_bootIds.has(candidate) || _bootIds.has(candidate + '/client')) {
                      id = candidate
                      break
                    }
                  }
                }
              }
              if (seen.has(id)) continue
              if (_skinExclude.test(id)) continue
              seen.add(id)
              const label = _labelFromId(id)
              const bodyAttr = _skinBodyAttrs[id] || null
              const isActive = !el.disabled && (!bodyAttr || _hasSkinAttr(bodyAttr))
              const sel = 'style[data-skin-chrome="' + chrome + '"]'
              if (bodyAttr) claimedAttrs.add(bodyAttr)
              skins.push({ id, label, sel, isActive, bodyAttr })
            }

            // 2. Check <html>/<body> for known data-dsh-* attributes not yet found.
            //    Skip entries whose attribute was already claimed by a
            //    DOM-scanned skin (prevents phantom duplicate entries).
            for (const [pluginId, bodyAttr] of Object.entries(_skinBodyAttrs)) {
              if (seen.has(pluginId)) continue
              if (claimedAttrs.has(bodyAttr)) continue
              if (_skinExclude.test(pluginId)) continue
              if (_hasSkinAttr(bodyAttr)) {
                seen.add(pluginId)
                skins.push({
                  id: pluginId,
                  label: _labelFromId(pluginId),
                  sel: null, // no style element selector — attribute-only skin
                  isActive: true,
                  bodyAttr,
                })
              }
            }

            // 3. (removed — skins are discovered from real evidence only)

            // 4. Discover installed-but-inactive skin plugins from the boot manifest
            //    and module graph.  When a skin plugin's fiber is unloaded, its
            //    <style> tags and body attributes are removed from the DOM — so
            //    phases 1a, 1b, and 2 all miss it.  The boot manifest lists every
            //    installed client plugin regardless of fiber state, so we discover
            //    inactive skins here.  Managed skins are already handled in phase 0.
            // Collect candidate IDs from both graphRows and boot manifest
            var _candidateIds = new Set()
            if (_graphRows) {
              for (const [rawId, row] of _graphRows) {
                var id = rawId
                if (id.endsWith('/client')) id = id.slice(0, -7)
                _candidateIds.add(id)
              }
            }
            for (var _bid2 of _bootIds) {
              var _bnid = _bid2
              if (_bnid.endsWith('/client')) _bnid = _bnid.slice(0, -7)
              _candidateIds.add(_bnid)
            }
            for (var id of _candidateIds) {
              if (seen.has(id)) continue
              if (id.startsWith('@deepseek-ai/')) continue
              if (!_skinHint.test(id)) continue
              if (_skinExclude.test(id)) continue
              if (_managedSkins[id]) continue
              seen.add(id)
              const label = _labelFromId(id)
              const bodyAttr = _skinBodyAttrs[id] || null
              const isActive = _hasSkinAttr(bodyAttr)
              skins.push({
                id,
                label,
                sel: null,
                isActive,
                bodyAttr,
                graphRow: true,
              })
            }

            return skins
          }

          function _getActiveSkinId() {
            // Optimistic: if the user just selected a skin and activation is in
            // progress, report the pending selection immediately so the dropdown
            // reflects the user's choice.
            if (_pendingSkinId) return _pendingSkinId
            // The market is the authoritative source when we have its state: a
            // theme activated through /use-skin is recorded there (and every
            // other theme is marked disabled), while the localStorage key below
            // only tracks switches made in-page by _applySkin.  Consulting
            // localStorage first would report a theme the market has since
            // disabled — e.g. after activating another theme, which reloads the
            // page but leaves the old key behind.
            if (_marketThemes) {
              const live = _marketThemes.themes.find((th) => th.state === 'live')
              if (live) {
                // Keep localStorage in step so a later scan-only path agrees.
                try { localStorage.setItem(_skinStorageKey, live.name) } catch (_) {}
                return live.name
              }
            }
            // First check localStorage for explicit preference
            try {
              const saved = localStorage.getItem(_skinStorageKey)
              if (saved !== null) {
                // A stored id naming a theme the market reports as disabled must
                // not be echoed back as the current selection.
                if (_marketThemes && _marketThemes.themes.some(
                  (th) => th.name === saved && th.state === 'disabled')) {
                  return 'default'
                }
                return saved
              }
            } catch (_) {}
            // Otherwise detect from DOM
            const skins = _scanInstalledSkins()
            const active = skins.find((s) => s.isActive)
            return active ? active.id : 'default'
          }

          var _applySkinGen = 0  // generation counter to cancel stale async activations

          /**
           * Deactivate a CSS skin plugin: remove its style tags, body attributes,
           * and injected DOM elements.  Tags are removed (not just disabled)
           * because some skins check for tag existence before re-injecting.
           */
          function _deactivateCssSkin(skin) {
            // 1. Remove style/link tags (not just disabled — disabled tags
            //    still exist and some skins check for existence before
            //    re-injecting, so disabled tags would block re-activation).
            for (const s of (skin.selectors || (skin.sel ? [skin.sel] : []))) {
              const el = document.querySelector(s)
              if (el) el.remove()
            }
            // Fallback: remove any style/link tags whose data-plugin matches.
            const pluginEls = document.querySelectorAll(
              'style[data-plugin="' + skin.id + '"], link[data-plugin="' + skin.id + '"],' +
              'style[data-plugin^="' + skin.id + '/"], link[data-plugin^="' + skin.id + '/"]'
            )
            for (const el of pluginEls) { el.remove() }

            // 2. Remove activation body/html attribute
            if (skin.bodyAttr) {
              _setSkinAttr(skin.bodyAttr, false)
            }

            // 3. Remove plugin-injected DOM elements (switcher UIs, etc.)
            //    that use data-plugin on non-style tags.
            const domEls = document.querySelectorAll(
              '[data-plugin="' + skin.id + '"]:not(style):not(link)'
            )
            for (const el of domEls) { el.remove() }
          }

          /**
           * Reactivate a CSS skin whose style tags were removed by
           * _deactivateCssSkin().  Strategy:
           *   1. mod.import() → ctx.plugin(exports.apply)  (preferred)
           *   2. <script> tag reload of the plugin's client.js  (fallback)
           *
           * The first approach reuses the already-loaded module and only runs
           * the plugin's apply() (which is idempotent — it checks for missing
           * style tags and re-injects them).  The second approach re-runs the
           * entire client.js IIFE, which unconditionally injects CSS; this is
           * heavier (may create a duplicate hot-reload interval) but guarantees
           * the skin is fully restored even if the module graph is corrupted.
           */
          function _reactivateCssSkin(skinId, gen) {
            // Strategy 1: mod.import() → ctx.plugin(exports.apply)
            try {
              var mod = ctx.get('modules')
              if (mod && mod.import) {
                mod.import(skinId).then(function(exports) {
                  if (gen !== _applySkinGen) return  // stale
                  if (exports && typeof exports.apply === 'function') {
                    try { ctx.plugin(exports.apply) } catch(e) {}
                  }
                }).catch(function() {
                  // Strategy 2: fallback — reload the plugin's client.js via
                  // a <script> tag.  This re-runs the entire IIFE which
                  // unconditionally injects CSS, sets body attributes, and
                  // re-registers observers.
                  if (gen !== _applySkinGen) return  // stale
                  _reloadSkinScript(skinId)
                })
                return  // async path started
              }
            } catch (_) {}
            // mod.get('modules') unavailable — try script fallback immediately
            _reloadSkinScript(skinId)
          }

          /**
           * Fallback skin reactivation: load the plugin's client.js bundle
           * via a <script> tag.  The DSH web server serves each plugin's
           * client bundle at /plugins/<id>/client.js.
           */
          function _reloadSkinScript(skinId) {
            try {
              var existing = document.querySelector('script[data-skin-reload="' + skinId + '"]')
              if (existing) existing.remove()
              var script = document.createElement('script')
              script.setAttribute('data-skin-reload', skinId)
              script.src = '/plugins/' + skinId + '/client.js'
              script.onerror = function() { script.remove() }
              document.head.appendChild(script)
            } catch (_) {}
          }

          /**
           * Toggle a managed skin by writing localStorage and restarting its
           * cordis fiber.  The client runner wraps each plugin's apply() in a
           * guard surface, so the original exports.apply is NOT the callback
           * registered in ctx.registry.  Instead, we locate the fiber through
           * ctx.loader (EntryTree), which tracks entries by module name.
           */
          function _toggleManagedSkin(skinId, enabled) {
            var cfg = _managedSkins[skinId]
            if (!cfg) return
            var value = String(enabled)
            var key = cfg.enabledKey

            // Cross-tab storage trick: managed skins (like Mineradio) listen for
            // the `storage` event on window to detect enable/disable changes.
            // Per spec, `storage` only fires in OTHER browsing contexts — not the
            // same window.  By writing localStorage from a same-origin iframe,
            // the parent window receives the `storage` event, which triggers the
            // skin's onStorage handler → sync() → mount()/unmount().
            var iframeDone = false
            try {
              var iframe = document.createElement('iframe')
              iframe.style.cssText = 'width:0;height:0;border:none;position:fixed;left:-9999px'
              document.body.appendChild(iframe)
              // about:blank inherits the parent's origin → same localStorage
              iframe.contentWindow.localStorage.setItem(key, value)
              iframe.remove()
              iframeDone = true
            } catch (_) {}

            // Fallback: if the iframe trick failed, write directly and do a
            // best-effort DOM cleanup/mount so the user sees the change even
            // if the skin's own handler never fired.
            if (!iframeDone) {
              try { localStorage.setItem(key, value) } catch (_) {}
              if (enabled) {
                // Re-enable: the skin's mount() is complex (canvas, particles,
                // etc.) — we can't reconstruct it from outside.  The localStorage
                // key is now set to "true", so a page reload will restore it.
                // Hint the user with the attribute.
                if (cfg.activeAttr) {
                  document.documentElement.setAttribute(cfg.activeAttr, '')
                }
              } else {
                // Disable: strip the activation attribute and remove known
                // DOM elements that the skin's unmount() would clean up.
                if (cfg.activeAttr) {
                  document.documentElement.removeAttribute(cfg.activeAttr)
                }
              }
            }
          }

          function _applySkin(targetId) {
            const canonicalId = targetId
            const gen = ++_applySkinGen  // invalidate any in-flight async activations

            // ── Persist selection immediately ──
            // Write localStorage + activation markers FIRST so that getValue()
            // returns the new value right away, even during async reactivation.
            try { localStorage.setItem(_skinStorageKey, canonicalId) } catch (_) {}
            if (canonicalId !== 'default') {
              document.body.setAttribute('data-switch-skin', canonicalId)
            } else {
              document.body.removeAttribute('data-switch-skin')
            }

            const skins = _scanInstalledSkins()

            // ── Activate the NEW skin first, then deactivate the OLD one ──
            // This avoids the "naked DOM" flash where old styles are removed
            // before new ones are ready.  The brief overlap is harmless:
            // CSS skins use body attributes as activation switches, and only
            // one attribute is set at a time (the new one).

            if (canonicalId === 'default') {
              // Going to default: deactivate all skins, no activation needed
              for (const skin of skins) {
                if (skin.managed) {
                  _toggleManagedSkin(skin.id, false)
                } else {
                  _deactivateCssSkin(skin)
                }
              }
            } else {
              // Activate the target skin FIRST
              const target = skins.find((s) => s.id === canonicalId)
              if (target) {
                if (target.managed) {
                  _toggleManagedSkin(target.id, true)
                } else {
                  // CSS skin — re-enable or re-inject its styles.
                  const sels = target.selectors || (target.sel ? [target.sel] : [])
                  let anyFound = false
                  for (const s of sels) {
                    const el = document.querySelector(s)
                    if (el) { el.disabled = false; anyFound = true }
                  }
                  if (!anyFound) {
                    // Style tags were removed (deactivation removes them rather
                    // than disabling).  Re-import the plugin's own client bundle
                    // and re-create its fiber so its apply() re-injects the
                    // style tags / DOM elements.
                    _reactivateCssSkin(target.id, gen)
                  }
                  // Set the activation attribute — this turns the CSS rules on
                  if (target.bodyAttr) {
                    _setSkinAttr(target.bodyAttr, true)
                  }
                }
              }

              // NOW deactivate all OTHER skins (skip the one we just activated)
              for (const skin of skins) {
                if (skin.id === canonicalId) continue
                if (skin.managed) {
                  _toggleManagedSkin(skin.id, false)
                } else {
                  _deactivateCssSkin(skin)
                }
              }
            }

            // Also remove any leftover data-dsh-font attribute
            document.body.removeAttribute('data-dsh-font')
          }

          ctx.effect(() => {
            // Fetch the market's installed-theme view once, up front.  If the
            // market is available, the callback registers the skin switch;
            // without dsh-market the skin switcher is not shown at all because
            // disabled themes are invisible to the DOM scan and the list would
            // be incomplete.
            _refreshMarketThemes()

            return () => { _unregisterSkinSwitch() }
          }, 'dock-flash: skin switch')

          // Language selector — controls global DSH UI language
          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:language',
              label: L('language'),
              icon: '🌐',
              type: 'buttongroup',
              group: 'system',
              order: 45,
              options: i18nOptions([['langZh', 'zh'], ['langEn', 'en']]),
              getValue: () => {
                // Prefer the DSH locale service (global truth)
                const svc = getLocaleService()
                if (svc) {
                  try { return svc.getSnapshot().active } catch (_) {}
                }
                return t.getLocale()
              },
              setValue: (v) => {
                // Use DSH locale service to change the global UI language
                const svc = getLocaleService()
                if (svc) {
                  try { svc.setLocale(v) } catch (_) {}
                }
                // Also update our local t() so dock-flash labels update immediately
                t.setLocale(v)
              },
            })
            return dispose
          }, 'dock-flash: language switch')

          // System proxy select — fine-grained control over proxy behavior.
          // #6: Replaces the old on/off toggle with a select offering 4 modes:
          //   all-proxy  → NO_PROXY cleared, all traffic uses proxy
          //   api-bypass → NO_PROXY=api.deepseek.com,..., API calls bypass proxy
          //   all-bypass → NO_PROXY=*, all traffic bypasses proxy
          //   custom     → user-defined NO_PROXY value (prompted on selection)
          const _proxyModeKey = 'dock-flash:proxy-mode'
          const _customNoProxyKey = 'dock-flash:custom-no-proxy'
          const _PROXY_MODES = ['all-proxy', 'api-bypass', 'all-bypass', 'custom']
          const _DEFAULT_MODE = 'all-proxy'

          const _getProxyMode = () => {
            try {
              var v = localStorage.getItem(_proxyModeKey)
              if (v && _PROXY_MODES.indexOf(v) >= 0) return v
              // Migrate legacy use-proxy key
              var old = localStorage.getItem('dock-flash:use-proxy')
              if (old !== null) {
                var mode = old === 'true' ? 'all-proxy' : 'all-bypass'
                localStorage.setItem(_proxyModeKey, mode)
                localStorage.removeItem('dock-flash:use-proxy')
                return mode
              }
              return _DEFAULT_MODE
            } catch (_) { return _DEFAULT_MODE }
          }
          const _setProxyMode = (v) => {
            try { localStorage.setItem(_proxyModeKey, String(v)) } catch (_) {}
          }
          const _getCustomNoProxy = () => {
            try { return localStorage.getItem(_customNoProxyKey) || '' } catch (_) { return '' }
          }
          const _setCustomNoProxy = (v) => {
            try { localStorage.setItem(_customNoProxyKey, String(v)) } catch (_) {}
          }

          // #4: Track the actual NO_PROXY value and proxyMode from the host
          // so we can display them as a subtitle.  null = not yet fetched.
          var _noProxyValue = null
          var _hostProxyMode = null
          var _proxyAvailable = null
          // Guard: after a local setValue, suppress _fetchProxyStatus from
          // overwriting localStorage until the host has caught up.
          var _suppressHostSync = false

          /** Fetch the real proxy state from the host-side HTTP API. */
          function _fetchProxyStatus() {
            try {
              fetch('/plugins/dock-flash/proxy-status')
                .then(function (r) { return r.json() })
                .then(function (data) {
                  if (data) {
                    var changed = false
                    if (typeof data.noProxy !== 'undefined' && data.noProxy !== _noProxyValue) {
                      _noProxyValue = data.noProxy
                      changed = true
                    }
                    if (data.proxyMode && data.proxyMode !== _hostProxyMode) {
                      _hostProxyMode = data.proxyMode
                      changed = true
                    }
                    // If host has a mode that differs from local, sync it
                    // (unless suppressed — e.g. right after a local setValue
                    // before the host has processed the update)
                    if (data.proxyMode && data.proxyMode !== _getProxyMode() && !_suppressHostSync) {
                      _setProxyMode(data.proxyMode)
                      changed = true
                    }
                    if (typeof data.proxyAvailable === 'boolean' && data.proxyAvailable !== _proxyAvailable) {
                      _proxyAvailable = data.proxyAvailable
                      changed = true
                    }
                    if (data.customNoProxy !== undefined && data.customNoProxy !== _getCustomNoProxy()) {
                      _setCustomNoProxy(data.customNoProxy)
                      changed = true
                    }
                    if (changed) registry.notifyChange('dock-flash:system-proxy')
                  }
                })
                .catch(function () {})
            } catch (_) {}
          }

          // 1. On startup, read the authoritative value from the host-side settings
          //    and override localStorage if they disagree. This ensures the client
          //    switch reflects the actual host state (e.g. after a page refresh where
          //    the host persisted the setting but localStorage was cleared).
          //    Also fetch the proxy status for the subtitle (#4/#6).
          try {
            const remote = ctx.get('remote')
            if (remote && remote.settings && typeof remote.settings.describe === 'function') {
              remote.settings.describe().then(function (desc) {
                if (!desc || !desc.ok || !desc.value) return
                var nsList = Array.isArray(desc.value) ? desc.value : []
                var ns = nsList.find(function (n) { return n.namespace === 'dock-flash' })
                if (ns && ns.resolved) {
                  var res = ns.resolved
                  // Migrate legacy useProxy → proxyMode
                  if (res.proxyMode) {
                    var hostMode = res.proxyMode
                    var localMode = _getProxyMode()
                    if (hostMode !== localMode) {
                      _setProxyMode(hostMode)
                      registry.notifyChange('dock-flash:system-proxy')
                      console.log('[dock-flash] proxy-mode sync: host=' + hostMode + ', local was=' + localMode + ' → synced')
                    }
                    if (res.customNoProxy !== undefined && res.customNoProxy !== _getCustomNoProxy()) {
                      _setCustomNoProxy(res.customNoProxy)
                    }
                  } else if (typeof res.useProxy === 'boolean') {
                    // Legacy: migrate useProxy → proxyMode
                    var mode = res.useProxy ? 'all-proxy' : 'all-bypass'
                    _setProxyMode(mode)
                    registry.notifyChange('dock-flash:system-proxy')
                    console.log('[dock-flash] proxy legacy sync: useProxy=' + res.useProxy + ' → mode=' + mode)
                  }
                }
              }).catch(function () {})
            }
          } catch (_) {}
          // Fetch the actual NO_PROXY env var value from the host
          _fetchProxyStatus()

          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:system-proxy',
              label: L('systemProxy'),
              // #4/#6: Show the actual NO_PROXY value as a subtitle beneath the label
              subtitle: () => {
                var v = _noProxyValue
                return v === null ? '' : (t('noProxyHint') + ': ' + (v || '(' + t('noProxyNotSet') + ')'))
              },
              // Scope/availability hint shown as tooltip on ⓘ icon
              tooltip: () => {
                if (_proxyAvailable === false) return t('proxyNoProxyEnv')
                return t('proxyScopeHint')
              },
              icon: '🔗',
              type: 'select',
              group: 'system',
              order: 50,
              options: [
                { value: 'all-proxy',  label: () => t('proxyAllProxy') },
                { value: 'api-bypass', label: () => t('proxyApiBypass') },
                { value: 'all-bypass', label: () => t('proxyAllBypass') },
                { value: 'custom',     label: () => t('proxyCustom') + (_getCustomNoProxy() ? ': ' + _getCustomNoProxy() : '') },
              ],
              getValue: _getProxyMode,
              setValue: (mode) => {
                // When "custom" is selected, prompt for the custom NO_PROXY value
                if (mode === 'custom') {
                  var current = _getCustomNoProxy()
                  var custom = prompt(t('proxyCustomPrompt'), current)
                  if (custom === null) {
                    // User cancelled — revert the <select> back to current mode
                    registry.notifyChange('dock-flash:system-proxy')
                    return
                  }
                  _setCustomNoProxy(custom)
                }
                _setProxyMode(mode)
                console.log('[dock-flash] proxy mode changed: ' + mode + (_getCustomNoProxy() ? ' (NO_PROXY=' + _getCustomNoProxy() + ')' : ''))
                // Suppress host→local sync until the host confirms the change
                _suppressHostSync = true
                // Communicate proxy preference to the host side.
                try {
                  const settings = ctx.get('remote')
                  if (settings && settings.settings) {
                    settings.settings.update('dock-flash', {
                      proxyMode: mode,
                      customNoProxy: _getCustomNoProxy(),
                    }).then(function () {
                      // Host accepted the change — allow sync again and refresh subtitle
                      _suppressHostSync = false
                      _fetchProxyStatus()
                    }).catch(function (err) {
                      console.warn('[dock-flash] failed to sync proxy setting to host:', err)
                      _suppressHostSync = false
                      var swLabel = L('systemProxy')
                      registry.recordChange({
                        id: 'dock-flash:system-proxy',
                        label: swLabel,
                        icon: '⚠️',
                        oldDisplay: '',
                        newDisplay: mode + ' ⚠',
                      })
                    })
                  } else {
                    console.warn('[dock-flash] remote settings unavailable, proxy change may not persist to host')
                    _suppressHostSync = false
                  }
                } catch (_) { _suppressHostSync = false }
              },
            })
            return dispose
          }, 'dock-flash: system-proxy switch')

          // 2. Listen for settings/updated events so the switch stays in sync
          //    when the setting is changed externally (e.g. from the DSH Settings page).
          ctx.effect(function () {
            var off = ctx.on('settings/updated', function (ns, next) {
              if (ns !== 'dock-flash') return
              if (next) {
                var newMode = next.proxyMode
                var newCustom = next.customNoProxy
                // Migrate legacy useProxy
                if (!newMode && typeof next.useProxy === 'boolean') {
                  newMode = next.useProxy ? 'all-proxy' : 'all-bypass'
                }
                if (newMode && newMode !== _getProxyMode()) {
                  _setProxyMode(newMode)
                  registry.notifyChange('dock-flash:system-proxy')
                  console.log('[dock-flash] proxy sync from settings/updated: mode=' + newMode)
                }
                if (newCustom !== undefined && newCustom !== _getCustomNoProxy()) {
                  _setCustomNoProxy(newCustom)
                }
              }
              // Re-fetch proxy status so the subtitle stays current
              _fetchProxyStatus()
            })
            return off
          }, 'dock-flash: proxy settings sync')

          // #5: Connection test — an action switch that asks the host to fetch
          // a well-known URL and reports success/failure + latency.
          ctx.effect(() => {
            var _testing = false
            const dispose = registry.registerSwitch({
              id: 'dock-flash:test-connection',
              label: L('testConnection'),
              icon: '🌐',
              type: 'action',
              group: 'system',
              order: 51,
              actionLabel: () => _testing ? t('testRunning') : t('testConnection'),
              run: () => {
                if (_testing) return
                _testing = true
                registry.notifyChange('dock-flash:test-connection')
                fetch('/plugins/dock-flash/test-connection', { method: 'POST' })
                  .then(function (r) { return r.json() })
                  .then(function (data) {
                    _testing = false
                    if (data && data.ok) {
                      registry.recordChange({
                        id: 'dock-flash:test-connection',
                        label: t('testConnection'),
                        icon: '✅',
                        oldDisplay: '',
                        newDisplay: t('testSuccess') + ' (' + data.latencyMs + 'ms)',
                      })
                    } else {
                      var errMsg = (data && data.error) ? data.error : 'unknown'
                      registry.recordChange({
                        id: 'dock-flash:test-connection',
                        label: t('testConnection'),
                        icon: '❌',
                        oldDisplay: '',
                        newDisplay: t('testFailed') + ': ' + errMsg,
                      })
                    }
                  })
                  .catch(function (e) {
                    _testing = false
                    registry.recordChange({
                      id: 'dock-flash:test-connection',
                      label: t('testConnection'),
                      icon: '❌',
                      oldDisplay: '',
                      newDisplay: t('testFailed') + ': ' + (e.message || String(e)),
                    })
                  })
              },
            })
            return dispose
          }, 'dock-flash: test-connection switch')

          // Fullscreen toggle — uses the browser Fullscreen API
          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:fullscreen',
              label: L('fullscreen'),
              icon: '⛶',
              type: 'toggle',
              group: 'appearance',
              order: 55,
              getValue: () => {
                try { return !!(document.fullscreenElement || document.webkitFullscreenElement) } catch (_) { return false }
              },
              setValue: (v) => {
                try {
                  if (v) {
                    const el = document.documentElement
                    const rq = el.requestFullscreen || el.webkitRequestFullscreen
                    if (rq) rq.call(el)
                  } else {
                    const ex = document.exitFullscreen || document.webkitExitFullscreen
                    if (ex) ex.call(document)
                  }
                } catch (_) {}
              },
            })
            return dispose
          }, 'dock-flash: fullscreen switch')

          // Session log download button visibility toggle
          const _logBtnKey = 'dock-flash:hide-session-log-download'
          const _getLogBtnHidden = () => {
            try { return localStorage.getItem(_logBtnKey) === '1' } catch (_) { return false }
          }
          const _setLogBtnHidden = (v) => {
            try { localStorage.setItem(_logBtnKey, v ? '1' : '0') } catch (_) {}
          }
          const _applyLogBtnHidden = (v) => {
            try {
              let tag = document.getElementById('dock-flash-hide-session-log')
              if (v) {
                if (!tag) {
                  tag = document.createElement('style')
                  tag.id = 'dock-flash-hide-session-log'
                  document.head.appendChild(tag)
                }
                // DSH v0.1.5+: the session log download is inside a "more actions" (⋯)
                // menu button in the session header.  The button class changed from
                // nL4_yW_sessionLogButton to nL4_yW_moreButton.  Target both for
                // compatibility across DSH versions.
                tag.textContent = '.nL4_yW_sessionLogButton, .nL4_yW_moreButton { display: none !important; }'
              } else if (tag) {
                tag.remove()
              }
            } catch (_) {}
          }

          // Apply on startup
          _applyLogBtnHidden(_getLogBtnHidden())

          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:session-log-download',
              label: L('sessionLogDownload'),
              icon: '📥',
              type: 'toggle',
              group: 'appearance',
              order: 60,
              getValue: () => !_getLogBtnHidden(),
              setValue: (v) => {
                _setLogBtnHidden(!v)
                _applyLogBtnHidden(!v)
              },
            })
            return dispose
          }, 'dock-flash: session-log-download switch')

          // Close-on-blur — in workbench mode the panel-header toggle is its only
          // control (see the headerComponent below). It is NOT a registry switch
          // here, so no built-in switch carries `group: 'layout'` and the Layout
          // category is not rendered at all — every layout property it could have
          // offered already lives in dock-base's own settings.
          // In standalone mode `mountStandaloneSlotTrigger` additionally registers
          // it as a Layout switch; both read and write through the shared
          // module-level helpers, so the two stay in step.
          // ONE mounted workbench header at a time, so a single disposer slot is
          // enough to keep the repaint subscription from leaking across renders.
          let _cobHeaderDispose = null

          // ── 3. Register a sidebar panel (renders QuickControlPanel in the sidebar) ──
          //    Wrapped in PanelErrorBoundary to prevent render errors from
          //    crashing the entire dock-base WorkbenchRoot (which has no
          //    error boundary of its own).
          const SafeQuickControlPanel = (props) =>
            h(PanelErrorBoundary, null, h(QuickControlPanel, props))

          // ── Workbench registrations (panel, activity bar, editor view, command) ──
          //    Only available when dock-base is installed.
          if (wb) {
            console.log('[dock-flash] workbench mode — dock-base detected')
            ctx.effect(() => {
              const dispose = wb.registerPanel({
                id: 'dock-flash:quick-control',
                region: 'sideBar',
                title: L('title'),
                icon: LIGHTNING_ICON,
                order: 50,
                component: SafeQuickControlPanel,
                headerComponent: (props) => {
                  const w = props.ctx?.get ? props.ctx.get('workbench') : undefined
                  const close = () => {
                    if (!w) return
                    const layout = w.getLayout()
                    const myFloat = Object.entries(layout.floatingWindows || {})
                      .find(([, fw]) => fw.viewId === 'dock-flash:quick-control')
                    if (myFloat) {
                      try { w.closeViewInstance(myFloat[0]) } catch (_) {}
                      return
                    }
                    try { w.updateLayout({ activity: null }) } catch (_) {}
                  }
                  // Close-on-blur toggle, left of the close button. Painted
                  // imperatively rather than via useState: dock-base may call
                  // headerComponent as a plain render function rather than
                  // mounting it as a component, which would make hooks illegal.
                  const cobPaint = (el) => {
                    if (!el) return
                    const on = readCloseOnBlur()
                    el.style.opacity = on ? '1' : '0.55'
                    el.style.background = on
                      ? 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.18))'
                      : 'transparent'
                    el.setAttribute('aria-pressed', String(on))
                    el.setAttribute('aria-label', closeOnBlurLabel(on))
                    el.setAttribute('title', closeOnBlurLabel(on))
                  }
                  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
                    h('button', {
                      type: 'button',
                      ref: (el) => {
                        // React calls this with null on unmount — dispose first,
                        // then re-subscribe for the newly mounted node.
                        if (_cobHeaderDispose) { _cobHeaderDispose(); _cobHeaderDispose = null }
                        if (el) {
                          cobPaint(el)
                          _cobHeaderDispose = subscribeCloseOnBlur(() => cobPaint(el))
                        }
                      },
                      style: { ...S.panelCloseBtn, fontSize: '14px', display: 'inline-flex', alignItems: 'center' },
                      onClick: (e) => {
                        writeCloseOnBlur(!readCloseOnBlur(), wb)
                        cobPaint(e.currentTarget)
                      },
                      onMouseEnter: (e) => { e.currentTarget.style.opacity = '1' },
                      onMouseLeave: (e) => cobPaint(e.currentTarget),
                      dangerouslySetInnerHTML: { __html: CLOSE_ON_BLUR_ICON_SVG },
                    }),
                    h('button', {
                      type: 'button',
                      style: S.panelCloseBtn,
                      'aria-label': 'Close',
                      title: 'Close',
                      onClick: close,
                      onMouseEnter: (e) => {
                        e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12))'
                      },
                      onMouseLeave: (e) => {
                        e.currentTarget.style.background = 'transparent'
                      },
                    }, '×')
                  )
                },
              })
              return dispose
            }, 'dock-flash: sidebar panel')

            // ── 3.4b. Patch sidebar title on locale change ──
            //    dock-base's WorkbenchRoot does not subscribe to locale changes,
            //    so titleOf(activePane) is only called when layout state mutates.
            //    We patch the .dsh-wb-sidebar-title textContent directly when
            //    our panel is active and the language switches.
            ctx.effect(() => {
              var off = t.onLocaleChange(function () {
                try {
                  var layout = wb.getLayout()
                  if (!layout.activity) return
                  var item = wb.getActivityItem(layout.activity)
                  if (!item || item.paneId !== 'dock-flash:quick-control') return
                  var titleEl = document.querySelector('.dsh-wb-sidebar-title')
                  if (titleEl) titleEl.textContent = t('title')
                } catch (_) {}
              })
              return off
            }, 'dock-flash: sidebar title i18n patch')

            // ── 3.5. Register as a workbench plugin (Settings panel entry) ──
            //    Appears in dock-base Settings → Plugins "entry" tab.
            //    hasEntry: true → visibility toggle + "Open" button.
            //    The "Open" button works because the activity bar item below
            //    carries pluginId: 'dock-flash', which pluginEntryItem() matches.
            //    NOTE: title/description must be static strings (not functions).
            //    Unlike registerPanel/registerActivityBarItem which accept
            //    () => string for i18n, dock-base's createPluginCard renders
            //    plugin.title and plugin.description directly as React children
            //    — it does NOT call resolveSettingText().  A function child
            //    renders as blank in React.
            ctx.effect(() => {
              const dispose = wb.registerPlugin({
                id: 'dock-flash',
                title: 'Flash',
                description: 'Workbench quick-control panel with skin switcher and layout toggles',
                icon: LIGHTNING_ICON,
                hasEntry: true,
                order: 30,
              })
              return dispose
            }, 'dock-flash: plugin entry')

            // ── 4. Register the activity bar item (lightning icon) ─────────
            ctx.effect(() => {
              const dispose = wb.registerActivityBarItem({
                id: 'dock-flash:quick-control',
                pluginId: 'dock-flash',
                title: L('title'),
                icon: LIGHTNING_ICON,
                order: 50,
                paneId: 'dock-flash:quick-control',
              })
              return dispose
            }, 'dock-flash: activity-bar item')

            // ── 5. Register the editor view (can also open as floating window) ──
            ctx.effect(() => {
              const dispose = wb.registerEditorView({
                id: 'dock-flash:quick-control',
                title: L('title'),
                icon: LIGHTNING_ICON,
                order: 50,
                component: SafeQuickControlPanel,
              })
              return dispose
            }, 'dock-flash: editor view')

            // ── 6. Register a command to open the floating window ──────────
            ctx.effect(() => {
              const dispose = wb.registerCommand({
                id: 'dock-flash:openQuickControl',
                title: L('title'),
                run: () => {
                  wb.openView('dock-flash:quick-control', undefined, { floating: true })
                },
              })
              return dispose
            }, 'dock-flash: open command')
          } else {
            // ── Standalone mode: no dock-base available ──
            // Inject the trigger button into the configured conversation slot
            // (input.right by default) plus the floating panel.
            // mountStandaloneSlotTrigger uses ctx.inject(['slots'], ...) to wait
            // for the slots service (provided by dsh-client-ui-renderer) rather
            // than declaring a hard dependency in exports.inject.
            console.log('[dock-flash] standalone mode — no workbench, injecting trigger via slots')
            // Clean up legacy position key from old floating-button implementation
            try { localStorage.removeItem('dock-flash:standalone-position') } catch (_) {}
            const standaloneDispose = mountStandaloneSlotTrigger(ctx, registry)
            // Register DOM cleanup; slot injection cleanup is handled by ctx.inject sub-plugin lifecycle
            ctx.effect(() => standaloneDispose, 'dock-flash: standalone panel')
          }
        } catch (e) {
          console.error('[dock-flash] apply failed:', e)
        }
      },
    }
//#endregion ───────────────────────────────────────────────────────────────────
  },
})
