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
//  #region AlertRegistry       — AlertRegistry (pub/sub alert service + providers)
//  #region AlertProviders      — MemoryAlertProvider, SessionContextProvider, NetworkAlertProvider
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
    // ONE source of truth for the client version. It is logged at startup and
    // reported by `__dockFlashOverlay()`, because a build that cannot name itself
    // cannot be distinguished from the previous one: several rounds of fixes were
    // once all labelled `v1.3.0`, so neither the maintainer nor the console could
    // say which build the browser actually had — and a reload that silently
    // served the old bundle looked exactly like a fix that did not work.
    const CLIENT_VERSION = '1.6.0'
    console.log('[dock-flash] client v' + CLIENT_VERSION)
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
      proxyCustomEmpty: '自定义 NO_PROXY 不能为空：要全部走代理请选「全部代理」，要全部绕过请选「全部绕过」或填 *。',
      proxyCustomInvalid: '自定义 NO_PROXY 中有无效条目：',
      proxyCustomSyntax: '只接受主机名、域名后缀、IP 或「主机:端口」，用逗号或空格分隔；域名条目同时匹配其子域（example.com 也匹配 api.example.com）；端口需在 1-65535。不支持 CIDR（10.0.0.0/8 请改写成 10.0.0.0），也不要填代理地址本身（http://…）。',
      proxyScopeHint: '仅影响 DSH 进程内的 fetch 请求',
      proxyNoProxyEnv: '未检测到 HTTP_PROXY，代理设置暂无效果',
      testConnection: '测试连接',
      testRunning: '测试中…',
      testSuccess: '连接成功',
      testFailed: '连接失败',
      testUrl: '测试 URL',
      testUrlPrompt: '输入用于测试连接的 URL（http:// 或 https://）',
      testUrlInvalid: 'URL 无效：必须以 http:// 或 https:// 开头',
      proxyLog: '连接诊断日志',
      proxyLogClear: '清空日志',
      logRoute: '链路',
      logProxied: '经代理',
      logDirect: '直连',
      logNoHttpProxy: '未设置 HTTP_PROXY',
      logRedirects: '重定向',
      logRedirectLimit: '已达重定向上限，未继续跟随',
      logFinalUrl: '最终 URL',
      logResponse: '响应',
      logHeaders: '响应头',
      logBody: '主体',
      logTotal: '总计',
      logCause: '原因',
      logFailed: '失败',
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
      // A floating button inside the conversation viewport, draggable. Named
      // for where it sits rather than for what it is, because the other four
      // entries in the list are also "where".
      triggerConversationOverlay: '对话区右上角（可拖动）',
      triggerSize: '入口按钮大小',
      triggerSizeHint: '仅标准模式；可拖动位置可调更大（24–64px），槽位位置最大 48px',
      // ── Right-click menu on the draggable trigger ──
      menuResetPosition: '重置位置',
      menuOffset: '当前位置',
      menuLayer: '层级',
      menuOpacity: '静止时深浅',
      menuCopy: '点击复制',
      menuCopied: '已复制',
      triggerOverlayDragHint: '拖动可调整位置',
      turnRailLeft: '时间线移到左侧',
      orderEdit: '排序',
      orderDone: '完成',
      // Two keys, not one, because the two tabs have DIFFERENT consequences.
      // The split is by id prefix and is absolute: the Workbench tab holds only
      // `dock-flash:*` switches, so nothing third-party can ever be in its
      // slice — warning about disabled plugins there would describe something
      // that cannot happen, and imply this plugin's ordering reaches other
      // plugins' switches. The Extensions tab is entirely third-party, so the
      // warning is exactly right there.
      orderReset: '恢复本页签的默认顺序',
      orderResetExt: '恢复本页签的默认顺序（同时清除各插件的记录，包括已禁用的）',
      orderResetShort: '恢复默认顺序',
      // Shown in place of the tab title for ~1.6s after a reset. Phrased as a
      // completed action ("已恢复"), not as a question or a label, because it
      // is a receipt: the click already happened.
      orderResetDone: '本页签顺序已恢复默认',
      // Shown when reorder mode is LEFT, not entered. Ordering is saved on
      // every move, so this states a fact the user cannot otherwise confirm.
      orderSaved: '排序已保存',
      orderHint: '用 ▲▼ 调整分组与开关的先后；排序会自动保存，重装插件后位置仍会恢复',
      // ── Visibility mode ──────────────────────────────────────────────
      // A second mode beside reordering: the same header control area, the same
      // per-tab scope, but it shows/hides rows instead of moving them. It gets
      // its own reset because the two are independent intents — see
      // clearPanelHidden.
      visEdit: '显示/隐藏控件',
      visDone: '完成',
      visHint: '勾选要显示的控件，取消勾选即隐藏；此设置会保存，换浏览器也生效',
      hideRow: '隐藏此项',
      showRow: '显示此项',
      // Editing modes list EVERY registered control, including ones that are not
      // in the normal view. Each such row says which of the two layers removed
      // it, so "I can see it here but not there" is answered on the row itself.
      rowStoodDown: '插件当前未提供此项（仍可排序或隐藏）',
      rowHiddenByUser: '已被你隐藏（在显示/隐藏中恢复）',
      // Names its own scope, like the order reset does: only the hidden rows of
      // THIS tab come back, and the saved ordering is left alone.
      visReset: '恢复本页签的全部控件显示',
      visResetShort: '恢复全部显示',
      visResetDone: '本页签控件已全部显示',
      // Shown when visibility mode is LEFT. Symmetric with `orderSaved`, which
      // is what the reorder toggle says on its way out.
      visSaved: '显示设置已保存',
      moveUp: '上移',
      moveDown: '下移',
      expand: '展开',
      collapse: '收起',
      systemAlerts: '系统告警',
      alertTitle: '告警',
      alertDismissAll: '清除全部',
      alertMemoryInfo: '内存使用率较高 ({r}%)',
      alertMemoryWarning: '内存接近上限 ({r}%)',
      alertMemoryError: '内存严重不足 ({r}%)',
      alertMemoryCritical: '内存即将耗尽 ({r}%)',
      alertMemoryUnavailable: '当前浏览器不支持内存监测',
      alertContextInfo: '会话上下文较长',
      alertContextWarning: '会话上下文即将用尽',
      alertContextError: '会话上下文几乎用尽',
      alertContextUnavailable: '无法检测会话上下文长度',
      alertHostQueue: '主机推送告警',
      alertNetworkOffline: '网络已断开',
      alertNetworkSlow: '网络延迟较高 ({d}ms)',
      alertNetworkTimeout: '网络连接超时',
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
      proxyCustomEmpty: 'Custom NO_PROXY cannot be empty — choose "All Proxy" to bypass nothing, or "All Bypass" / * to bypass everything.',
      proxyCustomInvalid: 'Invalid entry in custom NO_PROXY:',
      proxyCustomSyntax: 'Accepted: host names, domain suffixes, IPs, or host:port, separated by commas or spaces. A domain also matches its subdomains (example.com also matches api.example.com); ports must be 1-65535. CIDR is not supported (rewrite 10.0.0.0/8 as 10.0.0.0), and the proxy address itself (http://…) does not belong here.',
      proxyScopeHint: 'Only affects fetch() requests within DSH process',
      proxyNoProxyEnv: 'No HTTP_PROXY detected — proxy setting has no effect',
      testConnection: 'Test Connection',
      testRunning: 'Testing…',
      testSuccess: 'Connected',
      testFailed: 'Failed',
      testUrl: 'Test URL',
      testUrlPrompt: 'URL to test connectivity against (http:// or https://)',
      testUrlInvalid: 'Invalid URL: must start with http:// or https://',
      proxyLog: 'Diagnostics Log',
      proxyLogClear: 'Clear log',
      logRoute: 'Route',
      logProxied: 'proxied',
      logDirect: 'direct',
      logNoHttpProxy: 'no HTTP_PROXY',
      logRedirects: 'Redirects',
      logRedirectLimit: 'redirect limit reached, stopped following',
      logFinalUrl: 'Final URL',
      logResponse: 'Response',
      logHeaders: 'headers',
      logBody: 'Body',
      logTotal: 'Total',
      logCause: 'Cause',
      logFailed: 'Failed',
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
      triggerConversationOverlay: 'Conversation top-right (draggable)',
      triggerSize: 'Trigger button size',
      triggerSizeHint: 'Standalone mode only; the draggable position allows more (24–64px), a slot position at most 48px',
      // ── Right-click menu on the draggable trigger ──
      menuResetPosition: 'Reset position',
      menuOffset: 'Offset',
      menuLayer: 'Layer',
      menuOpacity: 'Rest opacity',
      menuCopy: 'click to copy',
      menuCopied: 'copied',
      triggerOverlayDragHint: 'drag to reposition',
      turnRailLeft: 'Timeline on the Left',
      orderEdit: 'Reorder',
      orderDone: 'Done',
      orderReset: 'Reset this tab\'s order',
      orderResetExt: 'Reset this tab\'s order (also forgets each plugin\'s saved position, including disabled ones)',
      orderResetShort: 'Reset order',
      orderResetDone: 'This tab\'s order was reset',
      orderSaved: 'Order saved',
      orderHint: 'Use ▲▼ to order groups and switches; the order is saved automatically and plugins keep their place across reinstalls',
      visEdit: 'Show/hide controls',
      visDone: 'Done',
      visHint: 'Tick the controls to show, untick to hide; this is saved and follows you to another browser',
      hideRow: 'Hide this control',
      showRow: 'Show this control',
      // Editing modes list EVERY registered control, including ones that are not
      // in the normal view. Each such row says which of the two layers removed
      // it, so "I can see it here but not there" is answered on the row itself.
      rowStoodDown: 'Not offered right now by its plugin (still orderable and hideable)',
      rowHiddenByUser: 'Hidden by you (restore it in Show/hide)',
      visReset: 'Show every control in this tab again',
      visResetShort: 'Show all',
      visResetDone: 'Every control in this tab is shown',
      visSaved: 'Visibility saved',
      moveUp: 'Move up',
      moveDown: 'Move down',
      expand: 'Expand',
      collapse: 'Collapse',
      systemAlerts: 'System Alerts',
      alertTitle: 'Alerts',
      alertDismissAll: 'Dismiss all',
      alertMemoryInfo: 'Memory usage high ({r}%)',
      alertMemoryWarning: 'Memory nearing limit ({r}%)',
      alertMemoryError: 'Memory critically low ({r}%)',
      alertMemoryCritical: 'Memory exhaustion imminent ({r}%)',
      alertMemoryUnavailable: 'Memory monitoring not supported in this browser',
      alertContextInfo: 'Session context getting long',
      alertContextWarning: 'Session context nearly exhausted',
      alertContextError: 'Session context almost exhausted',
      alertContextUnavailable: 'Cannot detect session context length',
      alertHostQueue: 'Host pushed alert',
      alertNetworkOffline: 'Network offline',
      alertNetworkSlow: 'Network latency high ({d}ms)',
      alertNetworkTimeout: 'Network connection timeout',
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
        // Horizontal 12px -> 6px, the axis that actually matters here: a
        // narrow docked sidebar and a 320px floating panel both run out of
        // WIDTH before height. Vertical is untouched so rows keep their rhythm.
        padding: '8px 6px 12px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '12px',
        lineHeight: '1.5',
        // `box-sizing: border-box` is load-bearing: without it the 12px side
        // padding sits OUTSIDE minWidth, so the box could never be narrower than
        // 240 + 24 = 264px — and in workbench mode the sidebar is dock-base's,
        // which the user can drag narrower than that. The panel then refused to
        // shrink and the overflow surfaced as a horizontal scrollbar.
        boxSizing: 'border-box',
        // `min-width: 0` rather than a pixel floor: the floor's job is done by
        // the CONTENT, and any fixed floor re-creates the same overflow as soon
        // as the container is narrower than it.
        minWidth: '0',
        maxWidth: '100%',
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
      // Full-width variant of switchSubtitle, used when a switch sets
      // `subtitleBlock: true`. The inline variant must ellipsize to share the row
      // with the control, which silently hides the tail of a long value — for a
      // URL that meant the informative part was exactly what got cut off. This
      // variant gets its own line and wraps instead.
      // `paddingLeft` aligns it under the label text (icon column 18px + 6px gap).
      switchSubtitleBlock: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '10px',
        lineHeight: 1.5,
        marginTop: '-3px',
        marginBottom: '7px',
        paddingLeft: '24px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      },
      infoIcon: {
        fontSize: '11px',
        opacity: 0.5,
        flexShrink: 0,
        lineHeight: 1,
        // `display: inline-flex` + `justifyContent/alignItems` turns the glyph
        // into a box the line can actually size. As a bare inline span with
        // `line-height: 1` the line box was 11px tall while the glyph needed
        // 13px, so it overflowed its own row by 2px — invisible to the eye and
        // exactly the kind of thing the overflow probe exists to catch.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '13px',
      },
      // Read-only multi-line output block (`log` switch type). Unlike the
      // changelog it does not expire after 30s, so a report stays on screen
      // until it is replaced by the next run.
      logBlock: {
        marginBottom: '8px',
        border: '1px solid var(--dsw-alias-border-l1, #30363d)',
        borderRadius: '4px',
        background: 'var(--dsw-alias-bg-layer-1, #0d1117)',
        overflow: 'hidden',
      },
      logHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        borderBottom: '1px solid var(--dsw-alias-border-l1, #30363d)',
      },
      logMeta: {
        marginLeft: 'auto',
        fontSize: '10px',
        opacity: 0.8,
        whiteSpace: 'nowrap',
      },
      logClearBtn: {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: '11px',
        lineHeight: 1,
        padding: '0 2px',
        opacity: 0.7,
      },
      logBody: {
        margin: 0,
        padding: '6px 8px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '10px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        maxHeight: '190px',
        overflowY: 'auto',
      },
      value: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '11px',
      },
      slider: {
        // `flex: 0 1 auto` rather than `flexShrink: 0`: the control may narrow
        // when the container is too small, and `minWidth` stops it collapsing
        // into an unusable sliver — which is what `flexShrink: 0` was
        // protecting against, at the cost of making the panel unable to fit a
        // narrow sidebar.
        width: '100px',
        minWidth: '56px',
        flex: '0 1 auto',
        accentColor: 'var(--dsw-alias-button-primary-fill, #58a6ff)',
        cursor: 'pointer',
      },
      sliderRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
        // A flex ITEM's default `min-width: auto` means "never narrower than
        // my content", so without this the row refuses to shrink and pushes
        // the panel wider than dock-base's sidebar. The controls inside keep
        // their own sizing; this only lets the BOX give way.
        minWidth: 0,
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
        // Same reasoning as the slider: shrinkable, but never below a usable
        // width. `minWidth: 0` is what actually permits shrinking — a flex
        // item's default `min-width: auto` keeps it at content width no matter
        // what `flex-shrink` says.
        flex: '0 1 auto',
        minWidth: 0,
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
        padding: '7px 6px',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.15s',
      },
      // The reset receipt, shown in place of the tab's own name. Same metrics as
      // tabPageHeaderTitle so the header keeps its height and nothing jumps
      // when the text swaps; only the accent colour differs, to read as a
      // transient message rather than as the tab having been renamed.
      tabPageHeaderNotice: {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '11px',
        fontWeight: '600',
        color: 'var(--dsw-alias-state-business-primary, #4a9eff)',
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      },
      tabPageHeaderTitle: {
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '11px',
        fontWeight: '600',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        // The header is `justify-content: space-between` with two children and
        // NEITHER could shrink, so a title wide enough to meet the button group
        // pushed past the container — a 3px overflow, small but real, and the
        // same flex `min-width: auto` rule that caused every other one. The
        // label ellipsizes rather than wrapping, because the header is a
        // single fixed-height row.
        minWidth: 0,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      },
      tabPageChevron: {
        fontSize: '10px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        transition: 'transform 0.2s',
        // U+25B6 is a WIDE glyph: at 10px its ink is about 13px, while an
        // inline box reserves roughly the font size — a 3px shortfall that
        // showed up as the header's `overX: 3`. An explicit flex box the
        // glyph is centred in removes the guesswork, and rotating it for the
        // open state stays inside the same square.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        lineHeight: 1,
      },
      tabPageChevronOpen: {
        fontSize: '10px',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        transform: 'rotate(90deg)',
        transition: 'transform 0.2s',
        // Same box as the closed state, so the header does not shift by a
        // pixel when a tab opens.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '14px',
        height: '14px',
        lineHeight: 1,
      },
      // The reorder toggle lives in the tab header, immediately left of the
      // collapse chevron: icon-only, no label, with the wording carried by the
      // tooltip. It is a sibling of the chevron inside a clickable header, so
      // every handler here stops propagation — otherwise toggling the mode
      // would also collapse the tab.
      tabPageHeaderRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        // `flex: none` means this side NEVER shrinks, so the title is what
        // gives way (it ellipsizes). A `minWidth: 0` was added here once and
        // removed again: with `flex-shrink: 0` it can have no effect, so it
        // only looked like a fix. The real constraint is the opposite one —
        // this group must be given enough width for its buttons, which is why
        // the chevron now declares a box instead of relying on font metrics.
        flex: 'none',
      },
      orderIconBtn: {
        font: 'inherit',
        fontSize: '11px',
        lineHeight: '1',
        padding: '3px 5px',
        borderRadius: '5px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        background: 'transparent',
        border: 'none',
        // Same treatment the chevron got in 1.1.10, applied to the buttons that
        // were reported in the SAME measurement and left alone: that release
        // fixed the header's `overX: 3` on the *title* and the *chevron*, and the
        // buttons in between kept relying on font metrics.
        //
        // Measured with .NET's MeasureString at 11px, every glyph these buttons
        // carry is wider than the 11px an inline box reserves for it — and the
        // spread across the fonts a Windows browser may pick is what makes the
        // guess unworkable: `⇅` is 14.6px in Segoe UI but 20.0px in Yu Gothic UI;
        // `◉` is 13.2px against 20.0px; `✓` is 21.5px in Segoe UI and Consolas
        // but 16.2px in Segoe UI Symbol. A hard pixel box is the only form that
        // holds whatever the user's font stack resolves to.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Wide enough for the widest of the four glyphs (`✓` at 21.5px) so the
        // button does not change width as the mode toggles between `◉`/`⇅` and
        // `✓`, which would slide its neighbour sideways under the pointer that
        // just clicked it.
        width: '22px',
        height: '17px',
        boxSizing: 'border-box',
        padding: 0,
      },
      orderIconBtnOn: {
        font: 'inherit',
        fontSize: '11px',
        lineHeight: '1',
        padding: '3px 5px',
        borderRadius: '5px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-state-business-primary, #4a9eff)',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,0.06))',
        border: 'none',
        // Identical box to the off state — the pair must not resize when a mode
        // opens, or the row reflows at the exact moment the user is aiming at it.
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '22px',
        height: '17px',
        boxSizing: 'border-box',
        padding: 0,
      },
      orderHead: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
      },
      orderMoves: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        flex: 'none',
      },
      orderMoveBtn: {
        font: 'inherit',
        fontSize: '9px',
        lineHeight: '1',
        padding: '2px 4px',
        borderRadius: '4px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        background: 'var(--dsw-alias-bg-layer-3, #21262d)',
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
      },
      orderMoveBtnOff: {
        font: 'inherit',
        fontSize: '9px',
        lineHeight: '1',
        padding: '2px 4px',
        borderRadius: '4px',
        cursor: 'default',
        opacity: '0.3',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        background: 'var(--dsw-alias-bg-layer-3, #21262d)',
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
      },
      orderRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '4px',
      },
      // The visibility mode's check box. Deliberately the same box as
      // `orderMoveBtn` — same font size, padding and radius — so the row's
      // control area looks identical whichever mode is open; only the glyph
      // differs. The two states differ by colour and opacity rather than by a
      // different glyph family, so a shown row and a hidden row are told apart at
      // a glance while both stay legible.
      //
      // `●`/`○` (U+25CF/U+25CB) rather than `☑`/`☐`, and `◉` rather than an eye:
      // those are EMOJI-CAPABLE code points, so on Windows they render through
      // the colour-emoji font — a full-colour glyph beside the monochrome `⇅`,
      // `↺` and `▶`, at whatever size that font decides. The plain geometric
      // shapes belong to the same family as the `▶▼▲` the panel already uses and
      // carry no emoji presentation at all.
      //
      // Both states declare the same explicit box, for the reason the pair above
      // does: these two glyphs are not the same width (`○` measures 17.9px in
      // Segoe UI against `●`'s 14.0px), so without a fixed box the box would jump
      // the moment a row is hidden.
      visBoxOn: {
        font: 'inherit',
        fontSize: '9px',
        lineHeight: '1',
        borderRadius: '4px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-state-business-primary, #4a9eff)',
        background: 'var(--dsw-alias-bg-layer-3, #21262d)',
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '16px',
        boxSizing: 'border-box',
        padding: 0,
      },
      visBoxOff: {
        font: 'inherit',
        fontSize: '9px',
        lineHeight: '1',
        borderRadius: '4px',
        cursor: 'pointer',
        opacity: '0.45',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        background: 'var(--dsw-alias-bg-layer-3, #21262d)',
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '16px',
        boxSizing: 'border-box',
        padding: 0,
      },
      // The switch itself is inert while reordering: a mis-click on a toggle
      // during a reorder would flip a real setting, so the body is click-through
      // and only the arrows respond.
      orderRowBody: {
        flex: '1 1 auto',
        minWidth: 0,
        pointerEvents: 'none',
      },
      // Editing modes list every registered control, so they also list the ones
      // the normal view drops. Those rows are dimmed rather than omitted —
      // dimming is the whole point of the change, since a row that is not
      // rendered cannot be arranged or hidden. The row's own title names which
      // layer removed it (see `editRowOffKey`).
      orderRowBodyOff: {
        flex: '1 1 auto',
        minWidth: 0,
        pointerEvents: 'none',
        opacity: 0.42,
      },
      // ── Cluster card ──
      //    A cluster has to read as ONE unit at a glance, because that is also
      //    what the ▲▼ moves while reordering. The card's border plus the left
      //    rail on the folded body are what carry that: the head sits on the
      //    card, the members hang off the rail beneath it.
      clusterCard: {
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-3, #1c2128)',
        padding: '4px 8px 2px',
        marginBottom: '6px',
      },
      // The fold row closes the card: a full-width, centred strip, so the hit
      // area is the whole bottom edge of the block rather than the glyph itself.
      clusterFoldRow: {
        display: 'flex',
        justifyContent: 'center',
        marginTop: '1px',
        marginBottom: '1px',
      },
      // The glyph is a FULL-SIZE triangle (`▼`/`▲`, U+25BC/U+25B2), not the small
      // variant (`▾`/`▴`): the small one's ink is only ~60% of the em box, which is
      // what made the control hard to see. Swapping the GLYPH is the fix, not the
      // font size — at the original 10px these already read clearly, and raising
      // the size as well overshot.
      clusterFoldBtn: {
        font: 'inherit',
        fontSize: '10px',
        lineHeight: '1',
        padding: '2px 22px',
        borderRadius: '5px',
        cursor: 'pointer',
        flex: 'none',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        background: 'transparent',
        border: 'none',
      },
      clusterBody: {
        marginLeft: '14px',
        paddingLeft: '8px',
        marginTop: '2px',
        paddingBottom: '2px',
        borderLeft: '2px solid var(--dsw-alias-border-l2, #21262d)',
      },
      tabPageBody: {
        padding: '6px 6px 10px',
        borderTop: '1px solid var(--dsw-alias-border-l2, #21262d)',
        animation: 'dockFlashFadeIn 0.2s ease',
      },
      // ── Alert badge (on trigger button) ────────────────────────────────
      alertBadge: {
        position: 'absolute',
        top: '-4px',
        right: '-4px',
        minWidth: '16px',
        height: '16px',
        borderRadius: '8px',
        color: '#fff',
        fontSize: '10px',
        fontWeight: 600,
        lineHeight: '16px',
        textAlign: 'center',
        padding: '0 4px',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 1,
      },
      alertBadgeCritical: { background: '#e5534b' },
      alertBadgeError: { background: '#d4764e' },
      alertBadgeWarning: { background: '#c69026' },
      alertBadgeInfo: { background: '#3884ff' },
      // ── Alert bar (inside panel, above tab content) ────────────────────
      alertBar: {
        marginBottom: '6px',
        borderRadius: '6px',
        overflow: 'hidden',
      },
      alertItem: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        padding: '5px 8px',
        fontSize: '11px',
        lineHeight: '1.4',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
      },
      alertItemIcon: {
        fontSize: '13px',
        flexShrink: 0,
        lineHeight: '1.4',
      },
      alertItemText: {
        flex: 1,
        minWidth: 0,
      },
      alertDismissBtn: {
        border: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        cursor: 'pointer',
        fontSize: '14px',
        lineHeight: 1,
        padding: '0 2px',
        flexShrink: 0,
      },
      alertDismissAllBar: {
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '2px 8px 4px',
      },
      alertDismissAllBtn: {
        border: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        cursor: 'pointer',
        fontSize: '10px',
        padding: '2px 4px',
      },
      // Severity-tinted backgrounds for alertItem
      alertSeverityInfo: {
        background: 'rgba(56, 132, 255, 0.12)',
      },
      alertSeverityWarning: {
        background: 'rgba(210, 153, 34, 0.12)',
      },
      alertSeverityError: {
        background: 'rgba(229, 83, 75, 0.12)',
      },
      alertSeverityCritical: {
        background: 'rgba(229, 83, 75, 0.20)',
        // Subtle pulse border for critical
        boxShadow: 'inset 0 0 0 1px rgba(229, 83, 75, 0.4)',
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

    // ── DSH turn rail (右侧「轮次导航」时间线): optional left-side placement ──
    //    DSH renders that rail as hardcoded, right-anchored JSX inside
    //    @deepseek-ai/dsh-client-ui-chat (TurnNavigator) and exposes no
    //    setting, slot or service for it — it is not in the slot tree, so
    //    ctx.slots.* cannot touch it. The only lever is an injected CSS
    //    override, which is why this switch is a DOM override and not a
    //    workbench call.
    //
    //    Selector contract: anchor on the stable class SUFFIX plus the element
    //    type — never on the `eGxaPq` CSS-module hash, which is a build hash
    //    that changes whenever DSH rebuilds that stylesheet. `nav[class*=
    //    "_frame"]` is unique in DSH today (the other <nav>s carry
    //    `_crumbs` / `_nav` / `_panelList`); the bare `[class*="_frame"]`
    //    is NOT — eight DSH modules use a `frame` class. `*=` rather than `$=`
    //    because DSH joins class lists (`[styles.scroller, fadeBottom?].join('
    //    ')`), so a suffix test can stop matching on a rail that merely grew;
    //    `_preview` is the one token that must stay `$=`, since `_previewPrompt`
    //    and `_previewResponse` are its siblings inside the same card.
    //
    //    All four rules are load-bearing: the frame is right-anchored, the
    //    mark button inside it is right-anchored (`inset:0 0 0 auto`), the
    //    dash is `::before{right:0}`, and the hover preview opens toward
    //    `right:calc(100% + 10px)`. Flip one and the rail looks lopsided or
    //    the preview card lands off-screen.
    const TURN_RAIL_LEFT_KEY = 'dock-flash:turn-rail-left'
    const TURN_RAIL_STYLE_ID = 'dock-flash-turn-rail'
    const TURN_RAIL_LEFT_CSS = [
      'nav[class*="_frame"]{right:auto!important;left:calc(12px - (var(--dsh-composer-side-clearance) + 16px))!important}',
      'nav[class*="_frame"] button[class*="_mark"]{inset:0 auto 0 0!important}',
      'nav[class*="_frame"] button[class*="_mark"]::before{right:auto!important;left:0!important}',
      'nav[class*="_frame"] div[class$="_preview"]{right:auto!important;left:calc(100% + 10px)!important}',
    ].join('')

    function readTurnRailLeft() {
      try { return localStorage.getItem(TURN_RAIL_LEFT_KEY) === 'on' } catch (_) { return false }
    }

    /** The ONLY writer of the placement: one key, one injected rule. */
    function writeTurnRailLeft(on) {
      try { localStorage.setItem(TURN_RAIL_LEFT_KEY, on ? 'on' : 'off') } catch (_) {}
      applyTurnRailLeft()
    }

    /** Idempotent. Keeps the tag in <head> while enabled so it also applies to
     *  a rail that mounts later (the rail exists only while a session with
     *  turns is open), and removes it — never `disabled` — when switched off
     *  (Critical Rule 2). */
    function applyTurnRailLeft() {
      try {
        const el = document.getElementById(TURN_RAIL_STYLE_ID)
        if (!readTurnRailLeft()) {
          if (el) el.remove()
          return
        }
        if (!el) {
          const tag = document.createElement('style')
          tag.id = TURN_RAIL_STYLE_ID
          tag.textContent = TURN_RAIL_LEFT_CSS
          document.head.appendChild(tag)
        }
      } catch (_) {}
    }
    // ── Another plugin owning the timeline surface ────────────────────────
    //    When a plugin whose job is the turn timeline is loaded, the rail on
    //    screen is THAT plugin's surface — dock-flash must withdraw its
    //    placement switch rather than compete for the same edge. This is a
    //    policy question ("whose timeline is this?"), not a geometry one, so
    //    it cannot be answered by inspecting the rail's box.
    //
    //    dsh-codex-timeline (>=0.6.0) is the concrete case: it enhances DSH's
    //    native rail in place rather than rendering a second timeline, tags it
    //    with data-dsh-nav* (including dshNavxOriginalDisplay and
    //    dshNavigationSide — it moves and can hide the rail itself), watches
    //    those attributes with its own MutationObserver, and ships a
    //    `<style data-plugin="dsh-codex-timeline">`.
    //
    //    A DISABLED plugin is absent from both the boot manifest and the
    //    module graph, so "loaded" here really means "installed and switched
    //    on" — exactly the state in which the native rail stops being DSH's.
    const _timelineOwnerHint = /timeline/i
    function _timelineOwner() {
      try {
        // (a) The rail carries another plugin's ownership markers. DSH sets no
        //     data-* of its own on this element, so any nav/timeline-shaped one
        //     means someone else decorated the rail we are about to move.
        const rail = document.querySelector('nav[class*="_frame"]')
        if (rail !== null) {
          for (const key in rail.dataset) {
            if (/nav|timeline/i.test(key)) return 'rail:' + key
          }
        }
        // (b) A timeline plugin's stylesheet is in the document.
        const styled = document.querySelector('style[data-plugin*="timeline" i], link[data-plugin*="timeline" i]')
        if (styled !== null) return 'style:' + String(styled.getAttribute('data-plugin') || '')
        // (c) Boot manifest: every client plugin the host composed.
        const entries = window.__DSH_BOOT__ && window.__DSH_BOOT__.entries
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            const id = entry && entry.id
            if (typeof id === 'string' && _timelineOwnerHint.test(id) && !/^dock-flash/.test(id)) {
              return 'boot:' + id
            }
          }
        }
      } catch (_) {}
      return null
    }

    /** Diagnose DSH's turn rail in one shot: `visible` is what the switch's
     *  predicate consumes, `rails[]` says what every candidate looked like,
     *  `owner` names the plugin that has taken the surface over.
     *  Exposed on window as `__dockFlashTurnRail()`.
     *
     *  Scans ALL candidates, not the first: more than one rail can be mounted
     *  at once (a sub-session panel, the right sidebar, a retained view of the
     *  previous session), and `querySelector` would happily answer for a hidden
     *  one while the visible rail is further down the document. */
    function turnRailProbe() {
      try {
        const owner = _timelineOwner()
        // Class tests use `*=` (contains), not `$=` (ends with), because DSH
        // BUILDS these class attributes by JOINING a list: the scroller is
        // `[styles.scroller, fadeTop?, fadeBottom?].join(' ')`, so any rail long
        // enough to scroll carries `"…_scroller …_fadeBottom"`. A suffix test
        // then silently stopped matching, `usable` went empty and the turn-rail
        // switch hid itself — vanishing exactly when there were enough turns to
        // be worth moving, which is why it read as a feature that had been lost.
        // `*=` is safe for both tokens: neither `_frame` nor `_scroller` is a
        // prefix of a sibling class in that module. `_preview` is the exception
        // — its siblings `_previewPrompt`/`_previewResponse` mean the stylesheet
        // must keep `$=` there.
        const rails = Array.from(document.querySelectorAll('nav[class*="_frame"]'))
        const parts = rails.map((el) => {
          const rect = el.getBoundingClientRect()
          // Structural signature, so a future `_frame` class on an unrelated
          // <nav> cannot be mistaken for the rail.
          const scroller = el.querySelector('div[class*="_scroller"]') !== null
          const marks = el.querySelectorAll('button[class*="_mark"]').length
          // "In the DOM" is not "on screen". `display:none` (DSH's own
          // `@container (width<=900px)` hide) reports a zero rect, but so does
          // the ordinary case of a rail whose height collapses to 0 in a short
          // conversation viewport (`height: min(--turn-natural-height, max(0px,
          // --turn-rail-band - 64px), 420px)`) — and a 28x0 box is exactly what
          // a rect-COUNT test accepts. Hence the explicit box + viewport test.
          return {
            cls: el.className,
            scroller,
            marks,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            visible: rect.width > 0 && rect.height > 0 &&
              rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
          }
        })
        const usable = parts.filter((p) => p.scroller && p.marks > 0)
        const onScreen = usable.some((p) => p.visible)
        // Ownership outranks geometry: a rail that another plugin owns must
        // never enable dock-flash's placement switch, however visible it is.
        const visible = onScreen && owner === null
        return {
          visible,
          reason: owner !== null ? 'owned-by:' + owner
            : rails.length === 0 ? 'no-rail'
            : usable.length === 0 ? 'no-usable-rail'
            : !onScreen ? 'all-hidden'
            : 'ok',
          owner,
          count: rails.length,
          viewport: { w: innerWidth, h: innerHeight },
          rails: parts,
        }
      } catch (e) { return { visible: false, reason: 'throw: ' + e, owner: null, count: 0, rails: [] } }
    }

    /** The conversation's scrollable viewport, or null when no session is open.
     *
     *  This is the anchor for the standalone overlay trigger. It is found by
     *  STRUCTURAL SIGNATURE rather than by class name, for the same reason the
     *  turn rail is: `wSkVaW_scrollBody` is a CSS-module hash that changes
     *  whenever DSH rebuilds that stylesheet, so matching it would break
     *  silently on an unrelated DSH upgrade. What identifies the element is
     *  what it DOES — it is the scrolling column the messages live in.
     *
     *  Two properties make it the right anchor beyond being the scroller:
     *  it carries `scrollbar-gutter: stable`, so the scrollbar's width is
     *  reserved whether or not one is showing (the offset therefore does not
     *  jump as content grows), and `clientWidth` reports that content box
     *  directly, so the gutter is subtracted without guessing its width.
     *
     *  Scans every candidate and prefers the largest visible one: a retained
     *  view of a previous session, or a sub-session panel, can leave a second
     *  scroller mounted, and `querySelector` would happily answer with a
     *  hidden one. */
    function conversationViewport() {
      try {
        var best = null
        var candidates = document.querySelectorAll('div[class*="_scrollBody"]')
        for (var i = 0; i < candidates.length; i++) {
          var el = candidates[i]
          var cs = getComputedStyle(el)
          if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue
          var rect = el.getBoundingClientRect()
          // "In the DOM" is not "on screen" — the same trap the turn-rail probe
          // documents at length. A zero box, or one fully outside the viewport,
          // is not an anchor.
          if (rect.width <= 0 || rect.height <= 0) continue
          if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue
          if (best === null || rect.width * rect.height > best.rect.width * best.rect.height) {
            best = { el: el, rect: rect, cs: cs }
          }
        }
        if (!best) return null
        var rect = best.rect
        // The gutter: `scrollbar-gutter: stable` reserves it permanently, so
        // this is a constant for the session rather than a value that changes
        // when the content crosses the scroll threshold.
        var gutter = Math.max(0, rect.width - best.el.clientWidth)
        return {
          el: best.el,
          rect: rect,
          gutter: gutter,
          // Right edge of the CONTENT box — i.e. inside the scrollbar, which is
          // what "do not cover the scrollbar" means in coordinates.
          contentRight: rect.right - gutter,
          scrollable: best.el.scrollHeight > best.el.clientHeight,
        }
      } catch (_) { return null }
    }

    /** The switch's `visible` predicate. */
    function dshTurnRailVisible() { return turnRailProbe().visible }
//#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    // ── Host-backed user preferences ──────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════
//#region Preferences ──────────────────────────────────────────────────────────
    // Three preferences used to live only in localStorage, which made them
    // browser preferences rather than user preferences: a second browser, a
    // cleared cache or another machine lost them, while proxyMode right beside
    // them survived. They now live in the host settings namespace with
    // localStorage demoted to a cache.
    //
    // The shape of this layer is forced by one constraint: every reader is
    // SYNCHRONOUS and runs on render paths (`readPanelOrder` is called while
    // painting the panel), while the host is only reachable through an async
    // `remote.settings` call. So reads come from an in-memory value, the host
    // is consulted once at startup, and every write goes to all three layers —
    // memory (so the UI updates now), localStorage (so a reload shows the right
    // thing before the host answers) and the host (so it outlives the browser).
    //
    // localStorage is a cache, never the authority: after the host answers at
    // startup, the host's value wins, because it is the one that survives.

    /** Cache of what the host last told us; null until it has answered. */
    var _hostPrefs = null
    /**
     * The dock-flash namespace's current revision.
     *
     * `settings.update` takes THREE arguments — `(ns, patch, expectedRevision)` —
     * and the RUNTIME enforces all three even though the wire schema marks the
     * third optional (`z.union([z.undefined(), z.number()])`); calling it with
     * two throws `expected 3 argument(s), got 2`. The revision is a
     * compare-and-set token: it arrives as `ns.revision` in describe(), and
     * every successful write returns a new one, so it is refreshed per response.
     * Measured against @deepseek-ai/dsh-client-ui-settings, which threads it as
     * `expectedRevision ?? pendingRevision ?? snapshot.revision`.
     */
    var _hostRevision = null
    /** The plugin context, set in apply(). The preference writers below are
     *  called from render paths and switch handlers that never receive `ctx`,
     *  so it is held here rather than threaded through every call site. Null
     *  before apply() runs, which `savePrefs` tolerates (the write then lands
     *  in memory and localStorage only). */
    var _prefCtx = null
    /** Callbacks to run when the host's preferences arrive or change. */
    var _prefListeners = []

    function _subscribePrefs(fn) {
      _prefListeners.push(fn)
      return function () {
        var i = _prefListeners.indexOf(fn)
        if (i >= 0) _prefListeners.splice(i, 1)
      }
    }

    function _emitPrefs() {
      _prefListeners.slice().forEach(function (fn) {
        try { fn() } catch (e) { console.warn('[dock-flash] pref listener threw:', e) }
      })
    }

    /** The host's settings handle, or undefined when unavailable. */
    function _remoteSettings(ctx) {
      // `ctx.remote` is the declared-namespace accessor and is the form that
      // works; `ctx.get('remote')` returns undefined for a typert namespace.
      // `ctx.get` is kept as a fallback only so a harness exposing the
      // namespace the older way still resolves.
      try {
        if (ctx && ctx.remote && ctx.remote.settings) return ctx.remote.settings
      } catch (_) {}
      try {
        var remote = ctx && ctx.get ? ctx.get('remote') : undefined
        return remote && remote.settings ? remote.settings : undefined
      } catch (_) { return undefined }
    }

    /** Why the last load ended as it did. Reported by `__dockFlashPrefs()`.
     *
     *  This exists because the first version of this loader returned `false` on
     *  every failure path and logged nothing, so "the preferences did not save"
     *  arrived with no way to tell which of the four steps had failed — the same
     *  silent-failure shape as the `require` in a try/catch that Critical Rule 11
     *  is about. Every exit now records a named reason. */
    var _prefsLoadState = { ok: false, reason: 'not attempted yet', detail: null, at: null }

    function _prefsFail(reason, detail) {
      _prefsLoadState = { ok: false, reason: reason, detail: detail || null, at: new Date().toISOString() }
      console.warn('[dock-flash] host preferences NOT loaded — ' + reason + (detail ? ': ' + detail : ''))
      return false
    }

    /** Pull the whole namespace once and adopt it. Never rejects. */
    function loadHostPreferences(ctx) {
      // Report WHY each step failed, because the first version of this loader
      // returned a bare `false` on four different branches and the failure was
      // indistinguishable from "there was nothing to load".
      var hasRemote = false
      try { hasRemote = !!(ctx && ctx.remote) } catch (_) {}
      var settings = _remoteSettings(ctx)
      if (!settings) {
        return Promise.resolve(_prefsFail(
          'the settings namespace did not resolve',
          'ctx.remote=' + (hasRemote ? 'present' : 'absent') +
          ' — "remote" and "remote.settings" must BOTH be declared in inject[], because a typert ' +
          'namespace is not available to a plugin that only ctx.get()s it'))
      }
      if (typeof settings.describe !== 'function') {
        return Promise.resolve(_prefsFail(
          'settings.describe is not a function',
          'keys=' + Object.keys(settings).join(',')))
      }
      return settings.describe().then(function (desc) {
        if (!desc) return _prefsFail('describe() resolved to nothing')
        // The response is { ok, value } and the view is ONE LEVEL DOWN:
        // `value.namespaces`. Measured against @deepseek-ai/dsh-client-ui-settings,
        // which does exactly `response.ok ? { view: response.value } : ...` and
        // then `view.namespaces.find((c) => c.ns === ns)`. Two earlier attempts
        // read `desc.value` as the array (it is an object) and `desc.namespaces`
        // (one level too high), and both found nothing while looking correct.
        if (desc.ok === false) {
          return _prefsFail(
            'describe() answered ok=false',
            (desc.error && (desc.error.message || desc.error.code)) || JSON.stringify(desc.error))
        }
        var view = desc.value || desc
        var list = view && Array.isArray(view.namespaces)
          ? view.namespaces
          : (Array.isArray(view) ? view : null)
        if (!list) {
          return _prefsFail(
            'describe() carried no namespace list',
            'response keys: ' + Object.keys(desc).join(',') +
            ' | value keys: ' + (view && typeof view === 'object' ? Object.keys(view).join(',') : typeof view))
        }
        // The descriptor's fields are `ns` and `value` — NOT `namespace` and
        // `resolved`. Getting this wrong is silent: the lookup returns
        // undefined, every value reads as absent, and nothing is logged. Both
        // spellings are accepted here, and the descriptor is reported verbatim
        // on failure, so a future rename shows up as data instead of as a
        // preference that quietly stops saving.
        var ns = list.find(function (n) {
          return (n && (n.ns || n.namespace)) === 'dock-flash'
        })
        if (!ns) {
          return _prefsFail(
            'the dock-flash namespace is not registered',
            'namespaces seen: ' + (list.map(function (n) { return (n && (n.ns || n.namespace)) || '?' }).join(',') || '(none)') +
            ' — the host half may not be loaded, or needs a DSH restart')
        }
        var resolved = ns.value || ns.resolved
        if (!resolved) {
          return _prefsFail(
            'the dock-flash namespace carried no value',
            'descriptor keys: ' + Object.keys(ns).join(','))
        }
        _hostPrefs = {
          panelOrder: resolved.panelOrder,
          activeSkin: resolved.activeSkin,
          triggerPosition: resolved.triggerPosition,
          // Both of these were MISSING until 1.4.0, and the omission was
          // invisible: `loadOverlayOffset()` and `overlayProbe()` already read
          // `_hostPrefs.triggerOverlayOffset`, but nothing ever put it there, so
          // the drag position reported `offsetSource: 'localStorage/default'`
          // forever and a host-held offset was silently ignored on load. A new
          // host-owned field is exactly how this class of bug gets reintroduced,
          // so every field of the namespace is mapped here — this list IS the
          // contract, and it is short enough to keep complete.
          triggerOverlayOffset: resolved.triggerOverlayOffset,
          triggerSize: resolved.triggerSize,
          triggerLayer: resolved.triggerLayer,
          overlayOpacity: resolved.overlayOpacity,
        }
        if (typeof ns.revision === 'number') _hostRevision = ns.revision
        _prefsLoadState = {
          ok: true,
          reason: 'loaded',
          detail: 'panelOrder=' + JSON.stringify(_hostPrefs.panelOrder) +
                  ' activeSkin=' + JSON.stringify(_hostPrefs.activeSkin) +
                  ' triggerPosition=' + JSON.stringify(_hostPrefs.triggerPosition) +
                  ' triggerOverlayOffset=' + JSON.stringify(_hostPrefs.triggerOverlayOffset) +
                  ' triggerSize=' + JSON.stringify(_hostPrefs.triggerSize) +
                  ' triggerLayer=' + JSON.stringify(_hostPrefs.triggerLayer) +
                  ' overlayOpacity=' + JSON.stringify(_hostPrefs.overlayOpacity),
          at: new Date().toISOString(),
        }
        console.log('[dock-flash] host preferences loaded:', _prefsLoadState.detail)
        _migrateLocalToHost(ctx)
        _emitPrefs()
        return true
      }).catch(function (err) {
        return _prefsFail('describe() threw', String(err && err.message || err))
      })
    }

    /** Console hook: `__dockFlashOverflow()` measures layout overflow on screen.
     *
     *  It exists because a scrollbar was reported on the panel and every
     *  attempt to explain it from the source came up with a plausible answer
     *  that was not the actual one — flex arithmetic that was self-consistent
     *  but measured the wrong element. Reading code tells you what SHOULD be
     *  wide; only the live DOM tells you what IS. The cost of measuring used to
     *  be "write a throwaway snippet and paste it correctly", which is exactly
     *  the kind of friction that turns into not measuring at all, so this makes
     *  it one word in the console.
     *
     *  Reports ONLY dock-flash's own subtree by default, because that is the
     *  part this plugin can fix; pass `true` to scan the whole page and see
     *  whether a suspected scrollbar belongs to DSH or dock-base instead.
     */
    function overflowProbe(wholePage) {
      var root = wholePage
        ? document.body
        : (document.querySelector('[data-dsh-plugin="dock-flash"]') ||
           document.querySelector('[data-dsh-plugin="dock-flash-standalone"]'))
      if (!root) {
        return {
          ok: false,
          reason: 'the panel is not mounted — open it first (the measurement needs real geometry)',
        }
      }
      var scope = wholePage ? 'page' : 'dock-flash'
      var rows = []
      var seen = new Set()
      ;(function walk(el, depth) {
        if (depth > 20 || seen.has(el) || typeof el.getBoundingClientRect !== 'function') return
        seen.add(el)
        var overX = el.scrollWidth - el.clientWidth
        var overY = el.scrollHeight - el.clientHeight
        if (overX > 1 || overY > 1) {
          var cs = getComputedStyle(el)
          rows.push({
            depth: depth,
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 30) || '(inline styles)',
            w: el.clientWidth,
            h: el.clientHeight,
            overX: overX > 1 ? overX : 0,
            overY: overY > 1 ? overY : 0,
            overflowX: cs.overflowX,
            minWidth: cs.minWidth,
          })
        }
        for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1)
      })(root, 0)
      rows.sort(function (a, b) { return (b.overX + b.overY) - (a.overX + a.overY) })
      var worst = rows[0]
      return {
        ok: rows.length === 0,
        scope: scope,
        viewport: window.innerWidth + 'x' + window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        overflowing: rows.length,
        rows: rows.slice(0, 12),
        verdict: rows.length === 0
          ? (wholePage
              ? 'no overflow anywhere on the page'
              : 'clean — nothing overflows inside dock-flash (run with true to scan the page)')
          : 'largest: ' + worst.tag + ' .' + worst.cls + ' overX=' + worst.overX + ' overY=' + worst.overY,
      }
    }

    /** Console hook: `__dockFlashPrefs()` reports what the host gave us and why. */
    function prefsProbe() {
      return {
        load: _prefsLoadState,
        host: _hostPrefs,
        local: {
          panelOrder: _readLocalPanelOrder(),
          activeSkin: _readLocalRaw('dock-flash:active-skin') || null,
          triggerPosition: _readLocalRaw('dock-flash:trigger-position') || null,
          // Listed here so "the host has this" and "only this browser has this"
          // can be told apart without opening settings.yaml.
          triggerSize: _readLocalRaw('dock-flash:trigger-size') || null,
          overlayOffset: _readLocalRaw('dock-flash:overlay-offset') || null,
        },
      }
    }

    /** Write one or more preference fields to memory + localStorage + host.
     *  The host write is fire-and-forget on purpose: the UI must not wait on a
     *  round trip, and a failure only means the value stays browser-local. */
    function savePrefs(ctx, patch, localWrites) {
      if (_hostPrefs) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) _hostPrefs[k] = patch[k]
      }
      try { if (localWrites) localWrites() } catch (_) {}
      var settings = _remoteSettings(ctx)
      if (!settings || typeof settings.update !== 'function') return Promise.resolve(false)
      // Three arguments, always: the runtime rejects two with
      // "expected 3 argument(s), got 2". `undefined` is accepted as the
      // revision, but a KNOWN one is passed so a concurrent writer is detected
      // rather than silently overwritten.
      return settings.update('dock-flash', patch, _hostRevision === null ? undefined : _hostRevision)
        .then(function (res) {
          // Every write bumps the revision; keeping the new one is what makes
          // the NEXT write succeed instead of failing its compare-and-set.
          try {
            if (res && res.ok === false) {
              console.warn('[dock-flash] host rejected the preference write:',
                (res.error && (res.error.message || res.error.code)) || res.error)
              return false
            }
            var v = res && res.value
            if (v && typeof v.revision === 'number') _hostRevision = v.revision
          } catch (_) {}
          return true
        }).catch(function (err) {
          console.warn('[dock-flash] failed to persist preference to host:', err)
          return false
        })
    }

    /** One-time push of a pre-existing localStorage value into the host.
     *
     *  Users who configured the plugin before this release have their order,
     *  skin and trigger position in localStorage only. Adopt each one that the
     *  host does not already have, so the move is invisible in both directions:
     *  an untouched host accepts what the browser had, and a host that already
     *  carries a value (a second browser reaching it first) is not overwritten.
     */
    function _migrateLocalToHost(ctx) {
      if (!_hostPrefs) return
      var patch = {}
      // panelOrder: an empty host order means "never customized", which is the
      // only case where the local value should win — the reader normalizes a
      // missing value to empty arrays, so emptiness is unambiguous here.
      var hostOrder = _hostPrefs.panelOrder
      var hostHasOrder = hostOrder && (
        (Array.isArray(hostOrder.builtin) && hostOrder.builtin.length > 0) ||
        (Array.isArray(hostOrder.ext) && hostOrder.ext.length > 0) ||
        (hostOrder.switches && Object.keys(hostOrder.switches).length > 0)
      )
      if (!hostHasOrder) {
        var localOrder = _readLocalPanelOrder()
        if (localOrder) patch.panelOrder = localOrder
      }
      if (!_hostPrefs.activeSkin) {
        var localSkin = _readLocalRaw('dock-flash:active-skin')
        if (localSkin) patch.activeSkin = localSkin
      }
      // triggerPosition's default is a real position, not an empty string, so
      // "the host is at its default" and "the user chose the default" are
      // indistinguishable. Only migrate when the local value differs from the
      // host's — overwriting an explicit host choice with a stale local one
      // would be worse than skipping the migration.
      var localPos = _readLocalRaw('dock-flash:trigger-position')
      if (localPos && localPos !== _hostPrefs.triggerPosition) patch.triggerPosition = localPos

      // triggerSize: same shape of rule as triggerPosition, for the same reason
      // — the default is a real value (24), so "the host is at its default" and
      // "the user chose the default" are indistinguishable. Only a local value
      // that DISAGREES with the host is migrated.
      var localSize = _readLocalRaw('dock-flash:trigger-size')
      if (localSize && localSize !== String(_hostPrefs.triggerSize)) {
        var parsedSize = Number(localSize)
        if (isFinite(parsedSize) && parsedSize > 0) patch.triggerSize = parsedSize
      }

      // triggerOverlayOffset: an object, and the host's default is non-empty
      // ({dx:8,dy:8}) for the same reason. Migrate only on a real disagreement,
      // so a user who dragged the overlay does not lose their offset to the
      // default the host was already carrying.
      var hostOffset = _hostPrefs.triggerOverlayOffset
      try {
        var localOffset = JSON.parse(_readLocalRaw('dock-flash:overlay-offset') || 'null')
        var offsetOk = localOffset && typeof localOffset.dx === 'number' &&
          typeof localOffset.dy === 'number' && isFinite(localOffset.dx) && isFinite(localOffset.dy)
        var same = offsetOk && hostOffset &&
          hostOffset.dx === localOffset.dx && hostOffset.dy === localOffset.dy
        if (offsetOk && !same) patch.triggerOverlayOffset = { dx: localOffset.dx, dy: localOffset.dy }
      } catch (_) {}

      // triggerLayer / overlayOpacity: these exist in the host schema from the
      // moment the client could write them, so there is no pre-host history to
      // adopt — and the migration is dangerous here rather than merely useless.
      // It fires whenever the two disagree, which lets a STALE CACHE overwrite
      // an authoritative host value: a browser holding an old 1150 would push it
      // back over a deliberately chosen 9 on every load. So the host is only
      // overridden while it is still sitting at its DEFAULT, which is the one
      // state that genuinely means "never configured". A host value that is not
      // the default is a decision, and a decision is not something a cache gets
      // to reverse.
      var layerIsCurrent = function (n) {
        return LAYER_PRESETS.some(function (p) { return p.value === n })
      }
      var opacityIsCurrent = function (n) {
        return OPACITY_PRESETS.some(function (p) { return p.value === n })
      }
      var hostAtDefaultLayer = _hostPrefs.triggerLayer === DEFAULT_TRIGGER_LAYER
      var localLayer = _readLocalRaw(_layerStoreKey)
      if (hostAtDefaultLayer && localLayer) {
        var parsedLayer = Number(localLayer)
        if (isFinite(parsedLayer) && parsedLayer > 0 &&
            parsedLayer !== _hostPrefs.triggerLayer && layerIsCurrent(parsedLayer)) {
          patch.triggerLayer = parsedLayer
        }
      }
      var hostAtDefaultOpacity = _hostPrefs.overlayOpacity === DEFAULT_OVERLAY_OPACITY
      var localOpacity = _readLocalRaw(_opacityStoreKey)
      if (hostAtDefaultOpacity && localOpacity) {
        var parsedOpacity = Number(localOpacity)
        if (isFinite(parsedOpacity) && parsedOpacity > 0 && parsedOpacity <= 1 &&
            parsedOpacity !== _hostPrefs.overlayOpacity && opacityIsCurrent(parsedOpacity)) {
          patch.overlayOpacity = parsedOpacity
        }
      }

      if (Object.keys(patch).length === 0) return
      console.log('[dock-flash] migrating browser-local preferences to host settings:', Object.keys(patch).join(', '))
      savePrefs(ctx, patch, null)
    }

    function _readLocalRaw(key) {
      try { return localStorage.getItem(key) || '' } catch (_) { return '' }
    }

    /** The pre-migration localStorage order, or null when there is none. */
    function _readLocalPanelOrder() {
      try {
        var parsed = JSON.parse(localStorage.getItem('dock-flash:panel-order') || 'null')
        if (!parsed || typeof parsed !== 'object') return null
        var builtin = Array.isArray(parsed.builtin) ? parsed.builtin.filter(function (k) { return typeof k === 'string' }) : []
        var ext = Array.isArray(parsed.ext) ? parsed.ext.filter(function (k) { return typeof k === 'string' }) : []
        var switches = {}
        if (parsed.switches && typeof parsed.switches === 'object') {
          for (var key of Object.keys(parsed.switches)) {
            if (Array.isArray(parsed.switches[key])) {
              switches[key] = parsed.switches[key].filter(function (id) { return typeof id === 'string' })
            }
          }
        }
        if (builtin.length === 0 && ext.length === 0 && Object.keys(switches).length === 0) return null
        return { builtin: builtin, ext: ext, switches: switches }
      } catch (_) { return null }
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
    //#region AlertRegistry ────────────────────────────────────────────────────────
    // A lightweight pub/sub registry for system alert notifications.
    // Published as ctx.provide('dockFlashAlerts', registry).
    //
    // Alert shape:
    //   { id, severity, title, message, icon, timestamp, dismissible, action }
    //
    // AlertProvider interface:
    //   { id, start(callback), stop() }
    //   callback receives Alert[] — provider pushes its current alert set.

    const MAX_ALERTS = 30
    const SEVERITY_ORDER = { info: 0, warning: 1, error: 2, critical: 3 }

    function createAlertRegistry() {
      const DISMISSED_KEY = 'dock-flash:dismissed-alerts'
      // Dismissed IDs older than 7 days are pruned on load to prevent
      // unbounded growth.  Host-pushed alerts older than 24h are already
      // pruned by HostAlertProvider, so a 7-day window on dismissed IDs
      // covers the useful lifetime without accumulating stale entries.
      const DISMISSED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
      const providers = new Map()       // id → AlertProvider
      const activeAlerts = new Map()    // id → Alert
      const dismissed = new Set()       // user-dismissed alert ids
      const listeners = new Set()
      let version = 0
      let running = false

      // ── Dismissed-set persistence ──────────────────────────────────────
      // The dismissed set is saved to localStorage on every mutation so
      // it survives the `location.reload()` triggered by market-managed
      // theme switches (which wipe all in-memory state).

      function saveDismissed() {
        try {
          if (dismissed.size === 0) {
            localStorage.removeItem(DISMISSED_KEY)
          } else {
            const payload = { ids: Array.from(dismissed), savedAt: Date.now() }
            localStorage.setItem(DISMISSED_KEY, JSON.stringify(payload))
          }
        } catch (_) {}
      }

      function loadDismissed() {
        try {
          const raw = localStorage.getItem(DISMISSED_KEY)
          if (!raw) return
          const payload = JSON.parse(raw)
          if (!payload || !Array.isArray(payload.ids)) return
          // If the entire payload is older than the TTL, discard it.
          // Individual IDs don't carry their own timestamps, so we
          // can only prune the whole set, not individual entries.
          if (payload.savedAt && (Date.now() - payload.savedAt) > DISMISSED_MAX_AGE_MS) {
            try { localStorage.removeItem(DISMISSED_KEY) } catch (_) {}
            return
          }
          for (const id of payload.ids) {
            if (typeof id !== 'string') continue
            dismissed.add(id)
          }
          // If nothing survived, clean up the store
          if (dismissed.size === 0) {
            try { localStorage.removeItem(DISMISSED_KEY) } catch (_) {}
          } else {
            saveDismissed() // rewrite with pruned set
          }
        } catch (_) {}
      }

      // Restore dismissed set on creation (before any provider starts)
      loadDismissed()

      function notify() {
        version++
        listeners.forEach((fn) => { try { fn() } catch (_) {} })
      }

      /** Called by each provider when its alert set changes. */
      function handleProviderUpdate(providerId, alerts) {
        // Save old alerts from this provider BEFORE removing (needed for
        // severity escalation check on dismissed alerts)
        const oldAlerts = new Map()
        for (const [id, a] of activeAlerts) {
          if (id.startsWith(providerId + ':')) oldAlerts.set(id, a)
        }
        // Remove old alerts from this provider
        for (const [id] of oldAlerts) {
          activeAlerts.delete(id)
        }
        // Track whether anything actually changes to skip unnecessary
        // notify() calls (avoids re-renders when a stateless provider
        // reports the same alerts it did last time).
        let changed = false
        const newIds = new Set()
        // Add new alerts (skip dismissed ones unless severity escalated)
        if (alerts && alerts.length) {
          for (const a of alerts) {
            const fullId = providerId + ':' + a.id
            newIds.add(fullId)
            if (dismissed.has(fullId)) {
              // Re-show if severity escalated beyond the dismissed version
              const old = oldAlerts.get(fullId)
              if (old && SEVERITY_ORDER[a.severity] <= SEVERITY_ORDER[old.severity]) continue
              dismissed.delete(fullId)
              saveDismissed()
            }
            const oldAlert = oldAlerts.get(fullId)
            const severityChanged = oldAlert && oldAlert.severity !== a.severity
            activeAlerts.set(fullId, { ...a, id: fullId, _providerId: providerId })
            if (!oldAlert || severityChanged) changed = true
          }
        }
        // If any old alerts were removed (not in new set), that's a change
        for (const [id] of oldAlerts) {
          if (!newIds.has(id)) { changed = true; break }
        }
        // Cap at MAX_ALERTS — drop oldest
        while (activeAlerts.size > MAX_ALERTS) {
          const oldest = Array.from(activeAlerts.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
          if (oldest) activeAlerts.delete(oldest[0]); else break
          changed = true
        }
        if (changed) notify()
      }

      return {
        /** Register an alert provider; returns a disposer. */
        registerProvider(provider) {
          if (!provider || !provider.id) {
            console.warn('[dockFlashAlerts] registerProvider: missing id')
            return () => {}
          }
          providers.set(provider.id, provider)
          // If already running, start the new provider immediately
          if (running) {
            try {
              provider.start((alerts) => handleProviderUpdate(provider.id, alerts))
            } catch (e) {
              console.warn('[dockFlashAlerts] provider start error:', e)
            }
          }
          return () => {
            try { provider.stop() } catch (_) {}
            providers.delete(provider.id)
            handleProviderUpdate(provider.id, [])
          }
        },

        /** Get all active alerts, sorted by severity (desc) then time (desc). */
        getAlerts() {
          return Array.from(activeAlerts.values()).sort((a, b) =>
            (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0)
            || b.timestamp - a.timestamp
          )
        },

        /** Dismiss a single alert by full id. */
        dismissAlert(id) {
          if (activeAlerts.has(id)) {
            activeAlerts.delete(id)
            dismissed.add(id)
            saveDismissed()
            notify()
          }
        },

        /** Dismiss all active alerts. */
        dismissAll() {
          for (const [id] of activeAlerts) dismissed.add(id)
          activeAlerts.clear()
          saveDismissed()
          notify()
        },

        /** Subscribe to alert changes; returns a disposer. */
        subscribe(fn) {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },

        /** Start all providers. Idempotent. */
        start() {
          if (running) return
          running = true
          for (const [id, provider] of providers) {
            try {
              provider.start((alerts) => handleProviderUpdate(id, alerts))
            } catch (e) {
              console.warn('[dockFlashAlerts] provider start error:', e)
            }
          }
          notify()
        },

        /** Stop all providers. Idempotent.
         *  NOTE: `dismissed` is intentionally NOT cleared here.  It represents
         *  user intent (which alerts to suppress) and must survive stop/start
         *  cycles — including the `location.reload()` triggered by market-
         *  managed theme switches, which calls `stop()` via ctx.on('dispose').
         *  Without this, all dismissed alerts would reappear after a skin
         *  switch.  The dismissed set is pruned on load (7-day TTL) and
         *  entries are removed when a host alert ages out of the 24h window,
         *  so it does not grow unboundedly. */
        stop() {
          if (!running) return
          running = false
          for (const [, provider] of providers) {
            try { provider.stop() } catch (_) {}
          }
          activeAlerts.clear()
          // dismissed survives — see NOTE above
          notify()
        },

        get version() { return version },
        get alertCount() { return activeAlerts.size },
        get isRunning() { return running },
        /** Count of active alerts grouped by severity. */
        get alertCountsBySeverity() {
          const counts = { critical: 0, error: 0, warning: 0, info: 0 }
          for (const [, a] of activeAlerts) {
            if (counts[a.severity] !== undefined) counts[a.severity]++
          }
          return counts
        },
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region AlertProviders ──────────────────────────────────────────────────────

    /**
     * MemoryAlertProvider — monitors V8 heap memory via performance.memory.
     *
     * Adaptive polling: interval = BASE * (1 - ratio)^2 + MIN
     *   ratio = usedJSHeapSize / jsHeapSizeLimit
     *   BASE = 30000ms, MIN = 2000ms
     *
     * Chrome-only; fires an info alert about unavailability if
     * performance.memory is absent, then stops polling.
     */
    function createMemoryAlertProvider() {
      var timer = null
      var callback = null

      function hasMemoryAPI() {
        try { return !!(performance && performance.memory && performance.memory.jsHeapSizeLimit) } catch (_) { return false }
      }

      function poll() {
        if (!callback) return
        var alerts = []
        try {
          var m = performance.memory
          var ratio = m.usedJSHeapSize / m.jsHeapSizeLimit
          var pct = Math.round(ratio * 100)

          // Thresholds: 0.80 info, 0.90 warning, 0.95 error, 0.99 critical
          if (ratio >= 0.99) {
            alerts.push({
              id: 'mem-critical',
              severity: 'critical',
              title: function () { return t('alertMemoryCritical').replace('{r}', pct) },
              message: function () { return t('alertMemoryCritical').replace('{r}', pct) },
              icon: '🔴',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.95) {
            alerts.push({
              id: 'mem-error',
              severity: 'error',
              title: function () { return t('alertMemoryError').replace('{r}', pct) },
              message: function () { return t('alertMemoryError').replace('{r}', pct) },
              icon: '🟠',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.90) {
            alerts.push({
              id: 'mem-warning',
              severity: 'warning',
              title: function () { return t('alertMemoryWarning').replace('{r}', pct) },
              message: function () { return t('alertMemoryWarning').replace('{r}', pct) },
              icon: '🟡',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.80) {
            alerts.push({
              id: 'mem-info',
              severity: 'info',
              title: function () { return t('alertMemoryInfo').replace('{r}', pct) },
              message: function () { return t('alertMemoryInfo').replace('{r}', pct) },
              icon: '🔵',
              timestamp: Date.now(),
              dismissible: true,
            })
          }
        } catch (_) {}

        try { callback(alerts) } catch (_) {}

        // Schedule next poll with adaptive interval
        var nextInterval = 30000 // default
        try {
          var m2 = performance.memory
          var r = m2.usedJSHeapSize / m2.jsHeapSizeLimit
          nextInterval = Math.max(2000, Math.round(30000 * Math.pow(1 - Math.min(r, 1), 2) + 2000))
        } catch (_) {}
        timer = setTimeout(poll, nextInterval)
      }

      return {
        id: 'dock-flash:memory-alert',
        start: function (cb) {
          callback = cb
          if (!hasMemoryAPI()) {
            // Fire once with info alert about unavailability, then stop polling
            try { cb([{
              id: 'mem-unavailable',
              severity: 'info',
              title: function () { return t('alertMemoryUnavailable') },
              message: function () { return t('alertMemoryUnavailable') },
              icon: '⚠️',
              timestamp: Date.now(),
              dismissible: true,
            }]) } catch (_) {}
            return
          }
          poll()
        },
        stop: function () {
          callback = null
          if (timer) { clearTimeout(timer); timer = null }
        },
      }
    }

    /**
     * SessionContextProvider — estimates session context exhaustion by counting
     * conversation message nodes in the DOM.
     *
     * Heuristic: count [class*="_message"] nodes × ~200 tokens/msg,
     * compare against a rough model window of 128K tokens.
     * This is an approximation — the goal is early warning, not precision.
     *
     * Adaptive polling: interval = BASE * (1 - ratio)^2 + MIN
     *   BASE = 20000ms, MIN = 2000ms
     */
    function createSessionContextProvider() {
      var timer = null
      var callback = null
      // Rough token window — deliberately conservative
      var APPROX_WINDOW = 128000
      var TOKENS_PER_MSG = 200

      function estimateContextRatio() {
        try {
          // Count elements whose class contains "_message" — DSH's conversation nodes
          var nodes = document.querySelectorAll('[class*="_message"]')
          var count = nodes ? nodes.length : 0
          var estTokens = count * TOKENS_PER_MSG
          return { ratio: estTokens / APPROX_WINDOW, msgCount: count, estTokens: estTokens }
        } catch (_) {
          return null
        }
      }

      function poll() {
        if (!callback) return
        var alerts = []
        var est = estimateContextRatio()
        if (est) {
          var ratio = est.ratio
          if (ratio >= 0.95) {
            alerts.push({
              id: 'ctx-error',
              severity: 'error',
              title: function () { return t('alertContextError') },
              message: function () { return t('alertContextError') + ' (~' + Math.round(ratio * 100) + '%)' },
              icon: '🔴',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.85) {
            alerts.push({
              id: 'ctx-warning',
              severity: 'warning',
              title: function () { return t('alertContextWarning') },
              message: function () { return t('alertContextWarning') + ' (~' + Math.round(ratio * 100) + '%)' },
              icon: '🟡',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.70) {
            alerts.push({
              id: 'ctx-info',
              severity: 'info',
              title: function () { return t('alertContextInfo') },
              message: function () { return t('alertContextInfo') + ' (~' + Math.round(ratio * 100) + '%)' },
              icon: '🔵',
              timestamp: Date.now(),
              dismissible: true,
            })
          }
        }
        try { callback(alerts) } catch (_) {}

        // Adaptive interval
        var nextInterval = 20000
        if (est) {
          var r = Math.min(est.ratio, 1)
          nextInterval = Math.max(2000, Math.round(20000 * Math.pow(1 - r, 2) + 2000))
        }
        timer = setTimeout(poll, nextInterval)
      }

      return {
        id: 'dock-flash:context-alert',
        start: function (cb) {
          callback = cb
          poll()
        },
        stop: function () {
          callback = null
          if (timer) { clearTimeout(timer); timer = null }
        },
      }
    }

    /**
     * HostAlertProvider — polls the host-side /host-alerts queue for alerts
     * pushed by external tools via POST /push-alert.
     *
     * The host drains the queue on each GET, so every alert is delivered once.
     * Because handleProviderUpdate replaces the provider's ENTIRE alert set,
     * we must accumulate internally: only push the full list when new alerts
     * arrive, so existing (not-yet-dismissed) alerts survive between polls.
     * The registry's `dismissed` set prevents re-added alerts from reappearing
     * after the user dismisses them.
     */
    function createHostAlertProvider() {
      var timer = null
      var callback = null
      var POLL_URL = '/plugins/dock-flash/host-alerts'
      var ALERT_QUEUE_CAP = 50
      var STORE_KEY = 'dock-flash:host-alerts'
      // Max age for persisted alerts: 24 hours. Stale entries are pruned
      // on load so the store does not grow unboundedly across sessions.
      var MAX_AGE_MS = 24 * 60 * 60 * 1000
      // Accumulated alerts — appended on each poll that returns new items,
      // re-pushed in full so the registry can apply dismissal logic.
      var accumulated = []

      /** Serialize accumulated alerts for localStorage.
       *  Functions (title/message) are stored as their return values. */
      function saveAccumulated() {
        try {
          var serializable = accumulated.map(function (a) {
            return {
              id: a.id,
              severity: a.severity,
              _title: typeof a.title === 'function' ? a.title() : a.title,
              _message: typeof a.message === 'function' ? a.message() : (a.message || ''),
              icon: a.icon,
              timestamp: a.timestamp,
              dismissible: a.dismissible,
            }
          })
          var payload = { alerts: serializable, savedAt: Date.now() }
          localStorage.setItem(STORE_KEY, JSON.stringify(payload))
        } catch (_) {}
      }

      /** Restore accumulated alerts from localStorage.
       *  Prunes entries older than MAX_AGE_MS and reconstructs
       *  the function wrappers for title/message. */
      function loadAccumulated() {
        try {
          var raw = localStorage.getItem(STORE_KEY)
          if (!raw) return
          var payload = JSON.parse(raw)
          if (!payload || !Array.isArray(payload.alerts)) return
          var now = Date.now()
          var cutoff = now - MAX_AGE_MS
          accumulated = payload.alerts
            .filter(function (a) { return a.timestamp && a.timestamp > cutoff })
            .map(function (a) {
              var titleText = a._title || ''
              var messageText = a._message || ''
              return {
                id: a.id,
                severity: a.severity || 'info',
                title: function () { return titleText },
                message: function () { return messageText },
                icon: a.icon || '🔔',
                timestamp: a.timestamp,
                dismissible: a.dismissible !== false,
              }
            })
          // If all were pruned, clear the store
          if (accumulated.length === 0) {
            try { localStorage.removeItem(STORE_KEY) } catch (_) {}
          }
        } catch (_) {}
      }

      function poll() {
        if (!callback) return
        try {
          fetch(POLL_URL, { method: 'GET', cache: 'no-store' })
            .then(function (r) { return r.json() })
            .then(function (data) {
              var hostAlerts = (data && data.alerts) ? data.alerts : []
              if (hostAlerts.length > 0) {
                // Map new host alerts to the standard Alert shape
                var mapped = hostAlerts.map(function (a) {
                  return {
                    id: 'host:' + a.id,
                    severity: a.severity || 'info',
                    title: typeof a.title === 'function' ? a.title : function () { return a.title },
                    message: typeof a.message === 'function' ? a.message : function () { return a.message || '' },
                    icon: a.icon || '🔔',
                    timestamp: a.timestamp || Date.now(),
                    dismissible: a.dismissible !== false,
                  }
                })
                accumulated = accumulated.concat(mapped)
                // Persist the new state so alerts survive page reloads
                saveAccumulated()
                // Re-push the full accumulated list; the registry will
                // skip any that are in its `dismissed` set.
                try { callback(accumulated) } catch (_) {}
              }
              // If no new alerts, do NOT call callback — that would
              // replace the provider's alert set with [] and erase
              // everything the user hasn't dismissed yet.

              // Adaptive: more alerts → poll more frequently
              var fillRatio = hostAlerts.length / ALERT_QUEUE_CAP
              var nextInterval = Math.max(2000, Math.round(20000 * Math.pow(1 - Math.min(fillRatio, 1), 2) + 2000))
              timer = setTimeout(poll, nextInterval)
            })
            .catch(function () {
              // On failure, retry with default interval
              timer = setTimeout(poll, 20000)
            })
        } catch (_) {
          timer = setTimeout(poll, 20000)
        }
      }

      return {
        id: 'dock-flash:host-alert',
        start: function (cb) {
          callback = cb
          accumulated = []
          // Restore persisted alerts before the first poll so they are
          // immediately available in the registry.
          loadAccumulated()
          if (accumulated.length > 0) {
            try { callback(accumulated) } catch (_) {}
          }
          poll()
        },
        stop: function () {
          callback = null
          // Do NOT clear accumulated — the persisted copy in localStorage
          // is what survives the page reload.  Clearing in-memory here
          // only affects the current (dying) session.
          accumulated = []
          if (timer) { clearTimeout(timer); timer = null }
        },
      }
    }

    /**
     * NetworkAlertProvider — monitors network connectivity via navigator.onLine
     * and heartbeat latency to /plugins/dock-flash/proxy-status.
     *
     * Adaptive polling: interval = BASE * (1 - delayRatio)^1.5 + MIN
     *   BASE = 60000ms, MIN = 10000ms
     *   delayRatio = measuredLatency / timeoutThreshold (10s)
     *
     * Offline is reported immediately via online/offline events.
     */
    function createNetworkAlertProvider() {
      var timer = null
      var callback = null
      var offlineHandler = null
      var onlineHandler = null
      var consecutiveFailures = 0
      var lastLatency = 0
      var wasOffline = false

      var HEARTBEAT_URL = '/plugins/dock-flash/proxy-status'
      var TIMEOUT_MS = 10000
      var SLOW_THRESHOLD = 5000

      function handleOffline() {
        wasOffline = true
        if (!callback) return
        try { callback([{
          id: 'net-offline',
          severity: 'critical',
          title: function () { return t('alertNetworkOffline') },
          message: function () { return t('alertNetworkOffline') },
          icon: '🔴',
          timestamp: Date.now(),
          dismissible: false,
        }]) } catch (_) {}
      }

      function handleOnline() {
        wasOffline = false
        // Next poll will re-evaluate
        if (callback) {
          try { callback([]) } catch (_) {}
        }
      }

      function poll() {
        if (!callback) return

        // Check navigator.onLine first
        var isOnline = true
        try { isOnline = navigator.onLine } catch (_) {}

        if (!isOnline) {
          handleOffline()
          timer = setTimeout(poll, 10000)
          return
        }

        // Heartbeat
        var start = Date.now()
        var timeoutId = null
        try {
          var controller = typeof AbortController !== 'undefined' ? new AbortController() : null
          if (controller) timeoutId = setTimeout(function () { controller.abort() }, TIMEOUT_MS)

          fetch(HEARTBEAT_URL, {
            method: 'GET',
            cache: 'no-store',
            signal: controller ? controller.signal : undefined,
          }).then(function (r) {
            if (timeoutId) clearTimeout(timeoutId)
            lastLatency = Date.now() - start
            consecutiveFailures = 0
            var alerts = []
            var delayRatio = lastLatency / TIMEOUT_MS
            if (lastLatency > TIMEOUT_MS * 0.9) {
              alerts.push({
                id: 'net-timeout',
                severity: 'error',
                title: function () { return t('alertNetworkTimeout') },
                message: function () { return t('alertNetworkTimeout') },
                icon: '🔴',
                timestamp: Date.now(),
                dismissible: true,
              })
            } else if (lastLatency > SLOW_THRESHOLD) {
              alerts.push({
                id: 'net-slow',
                severity: 'warning',
                title: function () { return t('alertNetworkSlow').replace('{d}', lastLatency) },
                message: function () { return t('alertNetworkSlow').replace('{d}', lastLatency) },
                icon: '🟡',
                timestamp: Date.now(),
                dismissible: true,
              })
            }
            try { callback(alerts) } catch (_) {}
            scheduleNext(delayRatio)
          }).catch(function () {
            if (timeoutId) clearTimeout(timeoutId)
            consecutiveFailures++
            var alerts = []
            // Only report after 3 consecutive failures to avoid false positives
            if (consecutiveFailures >= 3) {
              alerts.push({
                id: 'net-timeout',
                severity: 'error',
                title: function () { return t('alertNetworkTimeout') },
                message: function () { return t('alertNetworkTimeout') },
                icon: '🔴',
                timestamp: Date.now(),
                dismissible: true,
              })
            }
            try { callback(alerts) } catch (_) {}
            scheduleNext(1)
          })
        } catch (_) {
          consecutiveFailures++
          scheduleNext(1)
        }
      }

      function scheduleNext(delayRatio) {
        var r = Math.min(Math.max(delayRatio || 0, 0), 1)
        var nextInterval = Math.max(10000, Math.round(60000 * Math.pow(1 - r, 1.5) + 10000))
        timer = setTimeout(poll, nextInterval)
      }

      return {
        id: 'dock-flash:network-alert',
        start: function (cb) {
          callback = cb
          // Listen for browser online/offline events
          try {
            offlineHandler = handleOffline
            onlineHandler = handleOnline
            window.addEventListener('offline', offlineHandler)
            window.addEventListener('online', onlineHandler)
          } catch (_) {}
          // Initial check
          var isOnline = true
          try { isOnline = navigator.onLine } catch (_) {}
          if (!isOnline) {
            handleOffline()
            timer = setTimeout(poll, 10000)
          } else {
            poll()
          }
        },
        stop: function () {
          callback = null
          if (timer) { clearTimeout(timer); timer = null }
          if (offlineHandler) { try { window.removeEventListener('offline', offlineHandler) } catch (_) {} }
          if (onlineHandler) { try { window.removeEventListener('online', onlineHandler) } catch (_) {} }
          offlineHandler = null
          onlineHandler = null
          consecutiveFailures = 0
          wasOffline = false
        },
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────
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
      // If the switch provides a `subtitle` (string or function), show it as a
      // secondary line (same as toggle switches).
      const subtitleText = sw.subtitle
        ? (typeof sw.subtitle === 'function' ? sw.subtitle() : sw.subtitle)
        : null
      // If the switch provides a `tooltip` (string or function), show an ℹ️ icon
      // with a native browser tooltip on hover.
      const tooltipText = sw.tooltip
        ? (typeof sw.tooltip === 'function' ? sw.tooltip() : sw.tooltip)
        : null
      // `subtitleBlock` lifts the subtitle out of the label column and onto its
      // own full-width line below the row — see S.switchSubtitleBlock for why a
      // long value must not use the inline variant.
      const subtitleBlock = !!sw.subtitleBlock && !!subtitleText
      const labelEl = h('span', { style: S.switchLabel },
        sw.icon ? h('span', { style: S.switchIcon }, sw.icon) : null,
        h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 }, ...(tooltipText ? { title: tooltipText } : {}) },
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
            h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
            tooltipText ? h('span', { style: S.infoIcon }, 'ⓘ') : null,
          ),
          (!subtitleBlock && subtitleText) ? h('span', { style: S.switchSubtitle }, subtitleText) : null,
        ),
      )
      const selectEl = h('select', {
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
      )
      if (!subtitleBlock) {
        return h('div', { style: S.switchRow, key: sw.id }, labelEl, selectEl)
      }
      return h('div', { key: sw.id },
        h('div', { style: S.switchRow }, labelEl, selectEl),
        h('div', { style: S.switchSubtitleBlock }, subtitleText),
      )
    }

    function renderActionSwitch(sw) {
      // `hideLabel` drops the title column for an action whose button already
      // carries its own wording (`actionLabel`) — the proxy's Test Connection row
      // printed the same two words twice, once as a title and once on the button.
      // The definition keeps `label` regardless: that is what the changelog and
      // the panel name the entry with, so hiding it here costs no bookkeeping.
      const labelEl = sw.hideLabel
        ? null
        : h('span', { style: S.switchLabel },
            sw.icon ? h('span', { style: S.switchIcon }, sw.icon) : null,
            h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
          )
      return h('div', { style: S.switchRow, key: sw.id },
        labelEl,
        h('button', {
          // Alone in the row, the button takes the whole width instead of
          // floating against an empty label column.
          style: sw.hideLabel ? Object.assign({}, S.btnAction, { width: '100%' }) : S.btnAction,
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

    /**
     * Read-only multi-line output block.
     *
     * Switch contract:
     *   type: 'log'
     *   getLines()     -> string[]  (required) lines rendered verbatim
     *   hideWhenEmpty  -> boolean   (optional) render nothing at all until there
     *                               is a line, instead of an empty box
     *   emptyText()    -> string    (optional) placeholder while there are no
     *                               lines; ignored when hideWhenEmpty is set
     *   getMeta()      -> string    (optional) right-aligned status in the header
     *   onClear()                   (optional) when present, shows a ✕ button
     *   clearTitle     -> string    (optional) tooltip for that button
     *
     * Exists because the changelog is single-line and expires after 30s, which is
     * the wrong shape for a multi-line diagnostic report.
     */
    function renderLogSwitch(sw) {
      const lines = typeof sw.getLines === 'function' ? (sw.getLines() || []) : []
      // An empty block is pure cost: before the first run it would be a titled,
      // empty box occupying panel height and pushing the controls below it down.
      if (lines.length === 0 && sw.hideWhenEmpty) return null
      const metaText = typeof sw.getMeta === 'function' ? (sw.getMeta() || '') : ''
      const emptyText = typeof sw.emptyText === 'function' ? sw.emptyText() : (sw.emptyText || '')
      const clearTitle = typeof sw.clearTitle === 'function' ? sw.clearTitle() : (sw.clearTitle || '')
      return h('div', { key: sw.id, style: S.logBlock },
        h('div', { style: S.logHead },
          sw.icon ? h('span', { style: S.switchIcon }, sw.icon) : null,
          h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
          // Always rendered so `marginLeft: auto` keeps the ✕ pinned right
          // even when there is no status text yet.
          h('span', { style: S.logMeta }, metaText),
          (sw.onClear && lines.length > 0)
            ? h('button', {
                style: S.logClearBtn,
                title: clearTitle,
                onClick: () => { sw.onClear() },
              }, '✕')
            : null,
        ),
        h('pre', { style: S.logBody },
          lines.length > 0 ? lines.join('\n') : emptyText
        ),
      )
    }

    function renderSwitch(sw, force) {
      // `visible` is the panel-level way to drop a switch from the UI while
      // keeping it registered (so its state, changelog entries and callers are
      // unaffected).  The panel filters before grouping for the NORMAL view —
      // this is the backstop for any other caller of renderSwitch.
      //
      // `force` is what the two editing modes pass: they are INVENTORY views, so
      // they draw a stood-down switch rather than dropping it. Without that, a
      // row whose `visible()` is false could never be arranged or hidden, and the
      // turn-rail switch proved how bad that is — it stands itself down whenever
      // the rail is unrecognised, so the two configuration pages were the only
      // places that could have shown it, and both hid it.
      if (!force && typeof sw.visible === 'function' && !sw.visible()) return null
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
        case 'log': return renderLogSwitch(sw)
        default: return null
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────
//#region PanelOrder ───────────────────────────────────────────────────────────
    // ── User-adjustable panel ordering ───────────────────────────────────
    //    Two levels are orderable, and both live in ONE key written by ONE
    //    writer (the same discipline as close-on-blur): the order of the groups,
    //    and the order of the switches inside each group.
    //
    //    Groups are addressed by a scope-qualified key, because the two tabs
    //    name their groups from different namespaces — and a third-party plugin
    //    may legitimately call itself "appearance":
    //      builtin:<group>   — the Workbench tab's appearance/layout/system
    //      ext:<source>      — an Extensions group (the id prefix before ':')
    //    Switch order is stored per group under the same key, in `switches`.
    //
    //    Nothing derived is stored: the DEFAULT order still comes from each
    //    switch's `order` field (registry.getSwitches() already sorts by order
    //    then id). Storage records only the user's deviations from it, so a
    //    newly installed plugin or a new built-in switch joins at the end of
    //    its group rather than at some remembered index.
    const PANEL_ORDER_KEY = 'dock-flash:panel-order'

    /** Read + normalize the persisted order. Never throws, never returns null:
     *  a corrupt or partial value degrades to "nothing customized yet".
     *
     *  Reads the host's value once it has arrived; localStorage only until then
     *  (and as the fallback when no host settings service exists, e.g. a
     *  standalone profile without one). Both are normalized the same way, so a
     *  partially-written value from either source cannot break the panel. */
    function readPanelOrder() {
      const out = { builtin: [], ext: [], switches: {}, hidden: {} }
      const normalize = (parsed) => {
        if (!parsed || typeof parsed !== 'object') return out
        for (const scope of ['builtin', 'ext']) {
          if (Array.isArray(parsed[scope])) {
            out[scope] = parsed[scope].filter((k) => typeof k === 'string')
          }
        }
        // `switches` (order) and `hidden` (visibility) share their addressing
        // exactly — scope-qualified group key → array of unit keys — so they are
        // normalized by the same loop. They stay separate fields because they are
        // separate user intents: resetting one must not disturb the other.
        for (const field of ['switches', 'hidden']) {
          if (parsed[field] && typeof parsed[field] === 'object') {
            for (const key of Object.keys(parsed[field])) {
              const ids = parsed[field][key]
              if (Array.isArray(ids)) out[field][key] = ids.filter((id) => typeof id === 'string')
            }
          }
        }
        return out
      }
      if (_hostPrefs && _hostPrefs.panelOrder) return normalize(_hostPrefs.panelOrder)
      try {
        return normalize(JSON.parse(localStorage.getItem(PANEL_ORDER_KEY) || 'null'))
      } catch (_) {}
      return out
    }

    /** The ONLY writers of the order — set and clear, declared side by side.
     *  Both go through the preference bridge (memory + cache + host), so the
     *  order survives a different browser, not just a reload. */
    function writePanelOrder(next) {
      savePrefs(_prefCtx, { panelOrder: next }, () => {
        try { localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(next)) } catch (_) {}
      })
    }
    /**
     * Clear saved ordering — for ONE tab, or for everything.
     *
     * `scope` is a TAB ID ('workbench' | 'extensions'), not a storage key
     * name. The mapping is 1:1 and worth stating because the two vocabularies
     * do not match: the Workbench tab owns `panelOrder.builtin` plus every
     * `builtin:*` entry in `switches`, and the Extensions tab owns
     * `panelOrder.ext` plus every `ext:*` entry. Resetting one tab therefore
     * has to touch BOTH halves of its slice, and must leave the other tab's
     * slice byte-for-byte intact — a group's saved position and the positions
     * inside it are the same user intent and should not survive each other.
     *
     * Called with no argument it clears everything, which is what a caller
     * that does not know its tab (or wants a hard reset) should do.
     */
    function clearPanelOrder(scope) {
      const current = readPanelOrder()
      const next = {
        builtin: scope === 'extensions' ? current.builtin : [],
        ext: scope === 'workbench' ? current.ext : [],
        switches: {},
        // The order reset restores ORDER only. Visibility is its own intent with
        // its own reset button, so it is carried through untouched — a user who
        // tidied up their order has not asked to see their hidden rows again.
        hidden: current.hidden,
      }
      // Keep the untouched tab's per-group lists; drop only this tab's.
      const dropPrefix = scope === 'workbench' ? 'builtin:' : (scope === 'extensions' ? 'ext:' : null)
      for (const key of Object.keys(current.switches)) {
        // `undefined` scope means "everything", so nothing is kept. Writing the
        // condition the other way round (`!keep`) rather than `drop || ...`
        // is what makes that case correct: a null prefix has to drop
        // EVERYTHING, and the inverse reads as the opposite.
        const keep = dropPrefix !== null && !key.startsWith(dropPrefix)
        if (keep) next.switches[key] = current.switches[key]
      }
      // The localStorage mirror is WRITTEN, never removed — even for a full
      // order clear. `next` now carries `hidden` through, so removing the key
      // would drop that half from the cache until the host answered, and an
      // empty order already normalizes to "nothing customized" on read.
      savePrefs(_prefCtx, { panelOrder: next }, () => {
        try { localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(next)) } catch (_) {}
      })
    }

    /**
     * Clear the user's hidden rows — for ONE tab, or for everything.
     *
     * Deliberately the mirror of `clearPanelOrder` and deliberately NOT merged
     * with it: order and visibility are two independent things a user can
     * arrange, so they get two buttons and two resets. Folding them into one
     * "restore everything" would make either button silently undo work done
     * with the other.
     *
     * `scope` is a TAB ID ('workbench' | 'extensions'), same mapping as
     * `clearPanelOrder` — the Workbench tab owns `hidden['builtin:*']`, the
     * Extensions tab owns `hidden['ext:*']`.
     */
    function clearPanelHidden(scope) {
      const current = readPanelOrder()
      const next = {
        // Order is untouched here, symmetrically.
        builtin: current.builtin,
        ext: current.ext,
        switches: current.switches,
        hidden: {},
      }
      const dropPrefix = scope === 'workbench' ? 'builtin:' : (scope === 'extensions' ? 'ext:' : null)
      for (const key of Object.keys(current.hidden)) {
        // Same inversion as clearPanelOrder, and for the same reason: an
        // `undefined` scope has to drop EVERYTHING, so the surviving case is the
        // one that has a prefix AND does not match it.
        const keep = dropPrefix !== null && !key.startsWith(dropPrefix)
        if (keep) next.hidden[key] = current.hidden[key]
      }
      savePrefs(_prefCtx, { panelOrder: next }, () => {
        try { localStorage.setItem(PANEL_ORDER_KEY, JSON.stringify(next)) } catch (_) {}
      })
    }

    /** `persisted` first, then every live key not yet listed, in the order the
     *  caller supplied (the registry's own order-then-id default).
     *
     *  Stale entries are RETAINED on purpose: a group or switch that is merely
     *  hidden right now (its `visible()` predicate is false) must not lose its
     *  slot when a neighbouring move writes this list back. Display callers go
     *  through `applyOrder`, which drops the stale ones for rendering. */
    function orderedKeys(persisted, live) {
      const out = []
      for (const key of persisted || []) if (!out.includes(key)) out.push(key)
      for (const key of live || []) if (!out.includes(key)) out.push(key)
      return out
    }

    /** `live` keys in persisted order, unknown keys appended. */
    function applyOrder(persisted, live) {
      const present = new Set(live || [])
      return orderedKeys(persisted, live).filter((key) => present.has(key))
    }

    /** One step up (`delta` -1) or down (+1). Returns the SAME array when the
     *  move is a no-op, so callers can skip writing storage. */
    function moveInList(list, key, delta) {
      const from = list.indexOf(key)
      const to = from + delta
      if (from < 0 || to < 0 || to >= list.length) return list
      const next = list.slice()
      next.splice(from, 1)
      next.splice(to, 0, key)
      return next
    }

    /** Split one group's switches into the units the user actually reorders.
     *
     *  A switch may declare `cluster: '<label>'`; the members of one cluster are
     *  a SINGLE unit and keep a fixed internal order (their own `order` field).
     *  That is not cosmetic: the System proxy controls are a mode select, the URL
     *  the probe targets, the button that runs it, and the log that reports the
     *  result — and three of the four are hidden until a proxy is configured,
     *  with the log hidden until the first run. Reordered individually they could
     *  end up with the log above the button that fills it, or with a half-hidden
     *  set torn apart, and a per-switch move would silently migrate only the
     *  visible member.
     *
     *  A unit is keyed by its own id, except a cluster, which is keyed by its
     *  LABEL (`\0cluster:<label>`) rather than by whichever member happens to be
     *  first. That matters because `visible()` can hide any member: keying on the
     *  head would move the unit's key the moment the head was hidden while
     *  another member stayed on screen, and the saved slot would be silently
     *  lost. The NUL prefix keeps the key out of the switch-id namespace (ids are
     *  `plugin:switch`), so the two can never collide; `JSON.stringify` escapes it
     *  in storage. A cluster-free switch is simply a unit of one, keyed by id. */
    function groupUnits(switches) {
      const units = []
      const byCluster = new Map()
      for (const sw of switches) {
        const label = typeof sw.cluster === 'string' && sw.cluster ? sw.cluster : null
        if (label !== null && byCluster.has(label)) {
          byCluster.get(label).members.push(sw)
          continue
        }
        const unit = {
          key: label === null ? sw.id : '\u0000cluster:' + label,
          type: sw.type,
          members: [sw],
        }
        if (label !== null) byCluster.set(label, unit)
        units.push(unit)
      }
      return units
    }

    /** Units in the user's order, unknown keys appended in the order given. */
    function applyUnitOrder(persistedIds, units) {
      const byKey = new Map(units.map((u) => [u.key, u]))
      return applyOrder(persistedIds, units.map((u) => u.key))
        .map((key) => byKey.get(key))
        .filter(Boolean)
    }

    /** Whether a unit belongs in the compact toggle grid. A single toggle does;
     *  a cluster never does, whatever its head's type is — a grid cell has room
     *  for exactly one control, so a cluster placed there would silently lose
     *  every member but its head. Both the display order and the renderer ask
     *  this same question, so they cannot disagree about which bucket a unit is
     *  in. */
    function isGridToggle(unit) {
      return unit.type === 'toggle' && unit.members.length === 1
    }

    /** The units of one group in DISPLAY order.
     *
     *  For a built-in group this is not the registry order by default: the panel
     *  has always drawn `toggle`s first, in the compact grid, with every other
     *  control below them. That split is an ordering of its own, so "the order
     *  the user sees" and "the order the arrows produce" can only agree if both
     *  come from here:
     *    - not customized → toggles first, then the rest (the historical look);
     *    - customized     → strictly the saved order, because a strict order and
     *                       a two-bucket split cannot both hold. Taking control
     *                       of a group therefore also flattens it, which is the
     *                       visible price of the order being exact.
     *  Bucketing goes through `isGridToggle`, so a cluster is never a grid item.
     *  The Extensions tab passes `builtIn = false`: it has no such split, so its
     *  order is already exact with or without a customization.
     *
     *  Edit mode renders THIS list, so the arrows can never disagree with the
     *  result they produce. */
    function displayUnits(persistedIds, switches, builtIn) {
      const ordered = applyUnitOrder(persistedIds, groupUnits(switches))
      if (!builtIn || Array.isArray(persistedIds)) return ordered
      const grid = ordered.filter(isGridToggle)
      const rest = ordered.filter((u) => !isGridToggle(u))
      return grid.concat(rest)
    }

    /** Is this switch on offer right now? `visible()` is the PLUGIN's opinion —
     *  "I do not apply in this state" — and is one of the two layers the normal
     *  view ANDs. The editing modes ignore it on purpose: they are inventories,
     *  and a row that is not drawn cannot be arranged or hidden.
     *
     *  A unit answers the same question through `unitAvailable`, and a cluster
     *  counts as available when ANY member is — which is exactly what the old
     *  pre-grouping filter produced, since it dropped unavailable members before
     *  the unit was ever built. */
    function isSwitchAvailable(sw) {
      return typeof sw.visible !== 'function' || !!sw.visible()
    }
    function unitAvailable(unit) {
      return unit.members.some(isSwitchAvailable)
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
      // Panel ordering. `orderEdit` is deliberately NOT persisted: it is a
      // transient editing surface, not a preference. `orderTick` exists only to
      // re-render after a move — the arrows mutate localStorage, which React
      // cannot see, so without it a click would appear to do nothing.
      const [orderEdit, setOrderEdit] = useState(false)
      // The SECOND mode. It is kept mutually exclusive with `orderEdit` not by a
      // guard but by what each mode draws: while one is on, the other's entry
      // button is not rendered at all, so there is no way to have both open —
      // and therefore no state where a row carries a ▲▼ pair and a hide box at
      // once. That combination was the reason to reject a permanently-placed
      // toggle: two small adjacent controls, one of which makes a row vanish,
      // is a mis-click that removes the thing you were about to move.
      const [visibilityEdit, setVisibilityEdit] = useState(false)
      const [, setOrderTick] = useState(0)
      // The in-header receipt: `null` when nothing is showing, else
      // `{ tab, kind }`. It REPLACES THE TAB TITLE for ~1.6s, because the header
      // is already the tab's most prominent line and the message costs no new
      // chrome. Holding the TAB ID means only the tab whose button was pressed
      // reports it.
      //
      // `kind` distinguishes the four actions that report here — the two modes
      // reporting their own exit, and the two resets reporting their own
      // restore: 'reset' (order reset), 'saved' (left reorder mode), 'visReset'
      // (hidden rows restored), 'visSaved' (left visibility mode). Four kinds
      // rather than two is what keeps the message honest: each button undoes
      // only its own mode, so each one has to say what it actually did.
      const [orderNotice, setOrderNotice] = useState(null)
      // Cluster fold state, keyed by unit key. Ephemeral on purpose: absent
      // means open, so a fresh mount shows everything until the user folds it —
      // a fold that started closed would just reproduce the old hidden state.
      const [clusterFold, setClusterFold] = useState({})
      // Active alerts for the alert bar at the top of the panel
      const [panelAlerts, setPanelAlerts] = useState([])

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

      // Subscribe to alert registry for the alert bar
      useEffect(() => {
        let off = () => {}
        try {
          const ar = ctx.get ? ctx.get('dockFlashAlerts') : undefined
          if (ar) {
            setPanelAlerts(ar.getAlerts())
            off = ar.subscribe(() => {
              setPanelAlerts(ar.getAlerts())
            })
          }
        } catch (_) {}
        return off
      }, [ctx])

      if (!active) {
        return h('div', { style: S.root })
      }

      // Categorize switches: built-in (dock-flash:*) vs third-party
      // skinTick/themeTick ensure re-render when panel becomes active or theme changes
      void skinTick; void themeTick
      const allSwitches = registry ? registry.getSwitches() : []
      // EVERY registered switch is grouped, including the ones `visible()` stands
      // down right now (e.g. the proxy test controls while no proxy is
      // configured, or the turn-rail switch while DSH's rail is unrecognised).
      //
      // The `visible()` layer is applied at the ROW level instead, and only by
      // the normal view — because the two editing modes are INVENTORY views: they
      // exist so a control can be ordered or hidden, and a control that is not
      // drawn cannot be either. Filtering before grouping was what made a
      // stood-down switch unreachable in every mode at once; the turn-rail switch
      // disappearing on a long conversation is how that was found.
      //
      // The normal view still ANDs both layers, so neither can override the
      // other: a user cannot force back a row the plugin has stood down, and the
      // plugin cannot drag back one the user put away. The predicate is
      // re-evaluated on every render and the panel re-renders on any
      // notifyChange, so a switch driven by `visible` must notify when its
      // condition changes (see _fetchProxyStatus).
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

      // ── Ordering (persisted; see the PanelOrder region) ────────────────────
      // The DEFAULT group order stays `groupOrder`, not Map insertion order:
      // in standalone mode the two Layout switches are registered before the
      // Appearance ones, so trusting insertion order would silently reorder the
      // panel the moment this feature landed.
      const panelOrder = readPanelOrder()
      const builtInPresent = Array.from(builtInGroups.keys())
      const builtInDefault = groupOrder
        .filter((g) => builtInPresent.includes(g))
        .concat(builtInPresent.filter((g) => !groupOrder.includes(g)))
      const builtInKeys = applyOrder(panelOrder.builtin, builtInDefault)
      const extKeys = applyOrder(panelOrder.ext, Array.from(thirdPartyGroups.keys()))

      const bumpOrder = () => setOrderTick((v) => v + 1)

      // "An editing mode is open" — the two modes differ in WHAT they edit, not
      // in whether the panel is currently in an editing posture. Several render
      // decisions are about the posture rather than the mode: the switch bodies
      // go click-through, and a cluster is forced open. Asking once here is what
      // keeps those from having to enumerate the modes and drift apart.
      const editing = orderEdit || visibilityEdit

      // Both moves write through orderedKeys(), never through the display list:
      // that is what keeps the slot of a group or unit which is merely hidden
      // right now (its `visible()` predicate is false) instead of dropping it.
      function moveGroup(scope, displayKeys, key, delta) {
        const current = orderedKeys(panelOrder[scope], displayKeys)
        const next = moveInList(current, key, delta)
        if (next === current) return
        panelOrder[scope] = next
        writePanelOrder(panelOrder)
        bumpOrder()
      }

      /** Move one UNIT. Keys are unit keys, so a cluster travels as a whole and
       *  its members can never be separated by a move. */
      function moveUnit(groupKey, units, key, delta) {
        const current = orderedKeys(panelOrder.switches[groupKey], units.map((u) => u.key))
        const next = moveInList(current, key, delta)
        if (next === current) return
        panelOrder.switches[groupKey] = next
        writePanelOrder(panelOrder)
        bumpOrder()
      }

      /** Is this unit hidden by the USER? Only ever the user's own choice —
       *  never a switch's `visible()` predicate, which is the plugin saying "I do
       *  not apply right now". The two are deliberately separate and are ANDed at
       *  the call site, so neither can override the other: a user cannot force a
       *  row back that the plugin has stood down, and the plugin cannot drag back
       *  a row the user tucked away. */
      function isUnitHidden(groupKey, unitKey) {
        const list = panelOrder.hidden ? panelOrder.hidden[groupKey] : null
        return Array.isArray(list) && list.includes(unitKey)
      }

      /** Which layer keeps this unit out of the NORMAL view — or null when it is
       *  in it. Both editing modes draw the full inventory, so every row they
       *  draw that the normal view would filter has to say WHY: "its plugin has
       *  stood it down" and "you hid it" are different facts, and only the second
       *  is the user's to undo. Visibility mode marks only the plugin's layer,
       *  because its ○/● box already reports the user's own hide. */
      function editRowOffKey(unit, groupKey, mode) {
        if (!unitAvailable(unit)) return 'rowStoodDown'
        if (mode === 'order' && isUnitHidden(groupKey, unit.key)) return 'rowHiddenByUser'
        return null
      }

      /** The units the CURRENT mode draws for one group. This is the ONE
       *  expression both group renderers and `__dockFlashPanelOrder()` use, so
       *  the hook cannot claim something different from what is on screen.
       *
       *  Both editing modes draw everything; the normal view ANDs the two layers.
       *  Filtering here rather than inside `displayUnits` keeps the persisted
       *  ordering and the hook's inventory view looking at the full list. */
      function drawnUnits(scoped, switches, builtIn) {
        const all = displayUnits(panelOrder.switches[scoped], switches, builtIn)
        return editing ? all : all.filter((u) => unitAvailable(u) && !isUnitHidden(scoped, u.key))
      }

      /** The groups THIS mode should draw, in order. Both editing modes draw
       *  every group — they are inventories, and a group whose rows are all
       *  filtered has to stay reachable so its rows can be brought back. The
       *  normal view drops a group that would draw no rows at all.
       *
       *  That filter is new here, and it is the price of moving the two layers
       *  down to the row level: while the `visible()` filter ran BEFORE grouping,
       *  a group with nothing left in it disappeared on its own, so its title
       *  could never float above nothing. */
      function drawableGroups(keys, groups, scope, builtIn) {
        if (editing) return keys
        return keys.filter((key) => drawnUnits(scope + key, groups.get(key), builtIn).length > 0)
      }
      const builtInDraw = drawableGroups(builtInKeys, builtInGroups, 'builtin:', true)
      const extDraw = drawableGroups(extKeys, thirdPartyGroups, 'ext:', false)


      /** Show/hide one unit, and write it through. Addressed exactly like a move
       *  (scope-qualified group key + unit key), so a hidden cluster stays one
       *  hidden thing rather than becoming its members' ids. */
      function toggleUnitHidden(groupKey, unitKey) {
        const current = Array.isArray(panelOrder.hidden[groupKey]) ? panelOrder.hidden[groupKey] : []
        const next = current.includes(unitKey)
          ? current.filter((k) => k !== unitKey)
          : current.concat([unitKey])
        // Drop the key entirely when nothing is hidden in this group, so the
        // stored object carries only real choices and an empty world is `{}`
        // rather than a map of empty arrays.
        if (next.length > 0) panelOrder.hidden[groupKey] = next
        else delete panelOrder.hidden[groupKey]
        writePanelOrder(panelOrder)
        bumpOrder()
      }

      /** ▲▼ pair. The unreachable direction renders disabled rather than
       *  disappearing, so a row does not shift sideways as it reaches an end. */
      function renderMoves(onUp, onDown, canUp, canDown) {
        const mk = (glyph, onClick, enabled, label) => h('button', {
          type: 'button',
          style: enabled ? S.orderMoveBtn : S.orderMoveBtnOff,
          disabled: !enabled,
          title: t(label),
          'aria-label': t(label),
          onClick,
        }, glyph)
        return h('div', { style: S.orderMoves },
          mk('▲', onUp, canUp, 'moveUp'),
          mk('▼', onDown, canDown, 'moveDown'),
        )
      }

      /** A cluster's effective fold state: the user's toggle if they have
       *  touched it, otherwise FOLDED. Only the head row is then on screen,
       *  which keeps a cluster — the System proxy controls, a mode select plus
       *  a URL, a button and a log — from dominating a panel this short. The
       *  arrow on the card's last row is the way back, and it is drawn either
       *  way. The explicit entry the toggle writes is what keeps a fold from
       *  springing open on its own: a switch flipped inside a folded cluster
       *  re-renders the card, but nothing assigns `clusterFold`, so the state
       *  the user chose survives. 1.0.15 shipped the opposite default (open)
       *  on the reasoning that a fold starting closed reproduces the hidden
       *  state it replaces; that is true of a `visible()` gate, which has no
       *  way back, and not of a fold, whose control is on screen. */
      function clusterIsOpen(unit) {
        const chosen = clusterFold[unit.key]
        if (typeof chosen === 'boolean') return chosen
        return false
      }

      /** A cluster, as ONE card: the head switch always on show, the remaining
       *  members behind a fold. The same card is drawn in and out of edit mode,
       *  so the block the ▲▼ moves is exactly the block the user sees; while
       *  reordering the cluster is forced open and the fold button is not drawn
       *  at all, because the body is click-through there and a dead control is
       *  worse than a long block. */
      function renderCluster(unit, force) {
        // Outside an editing mode a cluster draws only its AVAILABLE members, so
        // a `visible()`-false member cannot leave an empty slot on the card.
        // (Editing modes pass `force`, and show the member dimmed instead.)
        const members = force ? unit.members : unit.members.filter(isSwitchAvailable)
        if (members.length === 0) return null
        const head = members[0]
        const rest = members.slice(1)
        // Forced open while editing, in BOTH modes: reordering has to show the
        // whole block it moves, and hiding has to show what is being hidden.
        const open = editing || clusterIsOpen(unit)
        return h('div', { key: unit.key, style: S.clusterCard },
          renderSwitch(head, force),
          open
            ? h('div', { style: S.clusterBody }, rest.map((sw) => renderSwitch(sw, force)))
            : null,
          // The fold control is the card's LAST row and sits in the middle: it
          // reads as the edge of the block rather than as a decoration beside the
          // head, and the arrow points the way the click will move the content —
          // down to reveal it, up to tuck it away. No count: the card's height
          // already says whether anything is folded, and a number beside a
          // triangle reads as a badge rather than as a control.
          editing
            ? null
            : h('div', { style: S.clusterFoldRow },
                h('button', {
                  type: 'button',
                  style: S.clusterFoldBtn,
                  title: t(open ? 'collapse' : 'expand'),
                  'aria-label': t(open ? 'collapse' : 'expand'),
                  'aria-expanded': open ? 'true' : 'false',
                  onClick: (e) => {
                    e.stopPropagation()
                    setClusterFold((prev) => ({ ...prev, [unit.key]: !open }))
                  },
                }, open ? '▲' : '▼'),
              ),
        )
      }

      /** One unit outside edit mode: a single switch, or a cluster card whose
       *  members keep their fixed internal order. */
      function renderUnit(unit, force) {
        if (unit.members.length === 1) return renderSwitch(unit.members[0], force)
        return renderCluster(unit, force)
      }

      /** One unit inside an editing group. A cluster gets a SINGLE ▲▼ pair beside
       *  the whole card — the unit moves, its members never do. The block's
       *  controls are click-through while reordering (S.orderRowBody), so a
       *  mis-click cannot flip a setting mid-reorder. */
      function renderOrderUnit(unit, groupKey, units, index) {
        const off = editRowOffKey(unit, groupKey, 'order')
        return h('div', { key: unit.key, style: S.orderRow },
          renderMoves(
            () => moveUnit(groupKey, units, unit.key, -1),
            () => moveUnit(groupKey, units, unit.key, 1),
            index > 0,
            index < units.length - 1,
          ),
          h('div', {
            style: off ? S.orderRowBodyOff : S.orderRowBody,
            title: off ? t(off) : undefined,
          }, renderUnit(unit, true)),
        )
      }

      /** One unit inside visibility mode: a check box instead of the ▲▼ pair.
       *
       *  Same slot, same row shell as `renderOrderUnit`, because the two modes
       *  are never open together — one control area per row, never two. The box
       *  reports its CHECKED state as "shown", which is the direction the user
       *  thinks in: unticking a row makes it go away, so a tick means visible.
       *
       *  A row the user hid stays in the list here (that is the entire point — it
       *  is the only place it can be brought back), and so does a row the plugin
       *  has stood down, which is what `editRowOffKey` marks. Only the NORMAL
       *  view applies the two layers; both editing modes are inventories. */
      function renderVisibilityUnit(unit, groupKey) {
        const hidden = isUnitHidden(groupKey, unit.key)
        const off = editRowOffKey(unit, groupKey, 'visibility')
        return h('div', { key: unit.key, style: S.orderRow },
          h('button', {
            type: 'button',
            style: hidden ? S.visBoxOff : S.visBoxOn,
            title: t(hidden ? 'showRow' : 'hideRow'),
            'aria-label': t(hidden ? 'showRow' : 'hideRow'),
            'aria-pressed': hidden ? 'false' : 'true',
            onClick: (e) => {
              e.stopPropagation()
              toggleUnitHidden(groupKey, unit.key)
            },
          }, hidden ? '○' : '●'),
          h('div', {
            style: off ? S.orderRowBodyOff : S.orderRowBody,
            title: off ? t(off) : undefined,
          }, renderUnit(unit, true)),
        )
      }

      // Render a built-in sub-group. `displayUnits` decides the order — the same
      // function feeds edit mode, so what the arrows arrange is what the normal
      // view shows.
      function renderBuiltInGroup(groupKey, switches, isFirst) {
        const scoped = 'builtin:' + groupKey
        const persistedIds = panelOrder.switches[scoped]
        const custom = Array.isArray(persistedIds)
        // What this mode draws (see `drawnUnits`). The order still comes from
        // `displayUnits`, the same function the arrows move against.
        const units = drawnUnits(scoped, switches, true)
        const toggles = units.filter(isGridToggle)
        const others = units.filter((u) => !isGridToggle(u))
        const gi = builtInKeys.indexOf(groupKey)
        const title = t(groupI18n[groupKey] || groupKey)
        return h('div', { key: groupKey },
          h('div', { style: isFirst ? S.subGroupTitleFirst : S.subGroupTitle },
            orderEdit
              ? h('div', { style: S.orderHead },
                  h('span', null, title),
                  renderMoves(
                    () => moveGroup('builtin', builtInKeys, groupKey, -1),
                    () => moveGroup('builtin', builtInKeys, groupKey, 1),
                    gi > 0,
                    gi < builtInKeys.length - 1,
                  ),
                )
              : title
          ),
          orderEdit
            ? units.map((u, i) => renderOrderUnit(u, scoped, units, i))
            : visibilityEdit
              ? units.map((u) => renderVisibilityUnit(u, scoped))
              // A customized group renders strictly in the saved order; an
              // untouched one keeps the historical grid-then-rest presentation.
              : custom
                ? units.map((u) => renderUnit(u))
                : [
                    toggles.length > 0
                      ? h('div', { key: 'grid', style: S.compactToggleGrid },
                          toggles.map((u) => renderToggleSwitch(u.members[0], true))
                        )
                      : null,
                    ...others.map((u) => renderUnit(u)),
                  ],
        )
      }

      /** One Extensions group (all switches sharing an id prefix). */
      function renderExtGroup(source, switches, gi) {
        const scoped = 'ext:' + source
        // Same rule as the built-in groups: both editing modes are inventories.
        const units = drawnUnits(scoped, switches, false)
        return h('div', { key: source, style: { marginBottom: '10px' } },
          h('div', { style: { ...S.switchLabel, fontSize: '11px', marginBottom: '4px' } },
            h('span', { style: { fontWeight: '500' } }, source),
            orderEdit
              ? renderMoves(
                  () => moveGroup('ext', extKeys, source, -1),
                  () => moveGroup('ext', extKeys, source, 1),
                  gi > 0,
                  gi < extKeys.length - 1,
                )
              : null,
          ),
          orderEdit
            ? units.map((u, i) => renderOrderUnit(u, scoped, units, i))
            : visibilityEdit
              ? units.map((u) => renderVisibilityUnit(u, scoped))
              : units.map((u) => renderUnit(u)),
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

      /** Open a tab if it is collapsed, and do nothing if it is already open.
       *
       *  For the header's mode buttons, which live INSIDE the header and are
       *  therefore reachable while the tab is folded. Both modes edit the rows
       *  in the body, so entering one on a collapsed tab would otherwise show a
       *  mode indicator and no rows to act on — the controls would be in a part
       *  of the panel the user cannot see. Opening is the whole effect: this
       *  never closes, so pressing a mode button on an open tab leaves it open
       *  as it was. */
      const ensureTabOpen = (id) => {
        setOpenTabs((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      }

      // Build list of visible tab pages. `order` marks the pages whose content
      // the reorder mode can actually rearrange — that is what decides where the
      // header's reorder icon is offered, so the Changes page (nothing to order)
      // stays clean.
      const pages = []
      if (hasWorkbench) pages.push({ id: 'workbench', icon: '⚡', label: L('builtinGroup'), order: true })
      if (hasExtensions) pages.push({ id: 'extensions', icon: '🧩', label: L('thirdPartyGroup'), order: true })
      if (hasChanges) pages.push({ id: 'changes', icon: '📝', label: L('recentChange') })


      const orderable = builtIn.length + thirdParty.length > 0

      // Console hook: `__dockFlashPanelOrder()` reports the order THIS render
      // resolved next to what is actually persisted, so "why is it displayed
      // like this?" — not customized, customized but looking at another
      // surface, or a stale bundle — is answerable instead of guessed at.
      // Assigned during render deliberately: it is a snapshot of the render it
      // came from, not state.
      try {
        window.__dockFlashPanelOrder = () => ({
          persisted: readPanelOrder(),
          editing: orderEdit,
          visibilityEditing: visibilityEdit,
          groups: builtInKeys,
          ext: extKeys,
          // Unit keys, not switch ids: a cluster reports one key, which is what
          // the arrows move and what the persisted list holds.
          switches: Object.fromEntries(
            builtInKeys
              .map((g) => [g, displayUnits(panelOrder.switches['builtin:' + g], builtInGroups.get(g), true)
                .map((u) => u.key)])
              .concat(extKeys.map((s) => ['ext:' + s, displayUnits(panelOrder.switches['ext:' + s], thirdPartyGroups.get(s), false)
                .map((u) => u.key)])),
          ),
          // Resolved per unit, so "why is this row missing?" is answerable: the
          // hidden list alone would not say whether the key still matches a live
          // unit, which is the difference between a stale record and a real hide.
          hidden: Object.fromEntries(
            builtInKeys
              .map((g) => [g, displayUnits(panelOrder.switches['builtin:' + g], builtInGroups.get(g), true)
                .filter((u) => isUnitHidden('builtin:' + g, u.key)).map((u) => u.key)])
              .concat(extKeys.map((s) => ['ext:' + s, displayUnits(panelOrder.switches['ext:' + s], thirdPartyGroups.get(s), false)
                .filter((u) => isUnitHidden('ext:' + s, u.key)).map((u) => u.key)])),
          ),
          // What the CURRENT mode draws, and which registered controls its plugin
          // is standing down right now. Both matter for the same question — "the
          // row is here in one mode and not the other, why?" — and they are the
          // two modes' whole difference: an editing mode's `drawn` is the full
          // inventory, while the normal view's is the ANDed subset. `groupsDrawn`
          // is the tab-level counterpart (a group drawing no rows is skipped).
          drawn: Object.fromEntries(
            builtInKeys
              .map((g) => ['builtin:' + g, drawnUnits('builtin:' + g, builtInGroups.get(g), true).map((u) => u.key)])
              .concat(extKeys.map((s) => ['ext:' + s, drawnUnits('ext:' + s, thirdPartyGroups.get(s), false).map((u) => u.key)])),
          ),
          stoodDown: Object.fromEntries(
            builtInKeys
              .map((g) => ['builtin:' + g, displayUnits(panelOrder.switches['builtin:' + g], builtInGroups.get(g), true)
                .filter((u) => !unitAvailable(u)).map((u) => u.key)])
              .concat(extKeys.map((s) => ['ext:' + s, displayUnits(panelOrder.switches['ext:' + s], thirdPartyGroups.get(s), false)
                .filter((u) => !unitAvailable(u)).map((u) => u.key)])),
          ),
          groupsDrawn: { workbench: builtInDraw, extensions: extDraw },
        })
      } catch (_) {}

      // ── Alert bar (above tab content) ──
      const renderAlertBar = () => {
        if (panelAlerts.length === 0) return null
        const ar = ctx.get ? ctx.get('dockFlashAlerts') : undefined
        const severityStyle = (s) => {
          if (s === 'critical') return S.alertSeverityCritical
          if (s === 'error') return S.alertSeverityError
          if (s === 'warning') return S.alertSeverityWarning
          return S.alertSeverityInfo
        }
        return h('div', { key: 'alert-bar', style: S.alertBar },
          ...panelAlerts.map((alert) =>
            h('div', { key: alert.id, style: { ...S.alertItem, ...severityStyle(alert.severity) } },
              h('span', { style: S.alertItemIcon }, alert.icon || '⚠️'),
              h('span', { style: S.alertItemText }, typeof alert.title === 'function' ? alert.title() : alert.title, alert.message ? ': ' + (typeof alert.message === 'function' ? alert.message() : alert.message) : ''),
              alert.dismissible !== false
                ? h('button', {
                    style: S.alertDismissBtn,
                    onClick: () => { if (ar) ar.dismissAlert(alert.id) },
                    title: t('alertDismissAll'),
                  }, '×')
                : null,
            )
          ),
          panelAlerts.length > 1
            ? h('div', { style: S.alertDismissAllBar },
                h('button', {
                  style: S.alertDismissAllBtn,
                  onClick: () => { if (ar) ar.dismissAll() },
                }, t('alertDismissAll'))
              )
            : null,
        )
      }

      return h('div', {
        key: 'qcp-' + localeKey,
        style: S.root,
        'data-dsh-plugin': 'dock-flash',
        'data-dsh-surface': 'floating-window',
      },
        renderAlertBar(),
        pages.map((page, pi) => {
          const isOpen = openTabs.has(page.id)
          const isLast = pi === pages.length - 1
          return h('div', { key: page.id, style: isLast ? S.tabPageLast : S.tabPage },
            // ── Tab header (always visible, click to toggle) ──
            h('div', {
              style: S.tabPageHeader,
              onClick: () => toggleTab(page.id),
            },
              // While a notice is live for THIS tab, the title becomes the message:
              // same slot, same type scale, so nothing reflows beyond the text
              // itself. Four actions report here, hence the four `kind`s.
              orderNotice && orderNotice.tab === page.id
                ? h('span', { style: S.tabPageHeaderNotice }, page.icon, ' ',
                    t(orderNotice.kind === 'reset' ? 'orderResetDone'
                      : orderNotice.kind === 'visReset' ? 'visResetDone'
                      : orderNotice.kind === 'visSaved' ? 'visSaved' : 'orderSaved'))
                : h('span', { style: S.tabPageHeaderTitle }, page.icon, ' ', page.label()),
              h('div', { style: S.tabPageHeaderRight },
                // ── Two modes, one control area ──────────────────────────────
                // Plan A: the two entry buttons sit side by side in the idle
                // state, and entering EITHER mode replaces the pair with
                // `✓ ↺`. The other mode's entry is simply not rendered — so the
                // modes are mutually exclusive by construction rather than by a
                // guard, and no state exists in which a row carries both a ▲▼ pair
                // and a hide box.
                //
                // Both modes therefore look identical in the header (`✓ ↺ ▶`);
                // what distinguishes them is the row body, which is unmistakable
                // (arrows vs check boxes) and also carried by each button's
                // tooltip.
                //
                // Visibility entry is on the LEFT, leaving `⇅` where it has been
                // since 1.0.14 — immediately left of the collapse chevron — so the
                // existing button does not move for users who never open the new
                // mode.
                page.order && orderable && !orderEdit
                  ? h('button', {
                      type: 'button',
                      style: visibilityEdit ? S.orderIconBtnOn : S.orderIconBtn,
                      title: t(visibilityEdit ? 'visHint' : 'visEdit'),
                      'aria-label': t(visibilityEdit ? 'visDone' : 'visEdit'),
                      'aria-pressed': visibilityEdit ? 'true' : 'false',
                      onClick: (e) => {
                        e.stopPropagation()
                        // A folded tab has no rows on screen, so a mode entered
                        // here would have nothing to act on — the header is
                        // reachable while the body is not.
                        ensureTabOpen(page.id)
                        const leaving = visibilityEdit
                        setVisibilityEdit((v) => !v)
                        // Same asymmetry as the reorder toggle: entering needs no
                        // message because the check boxes appearing IS the change.
                        if (leaving) {
                          setOrderNotice({ tab: page.id, kind: 'visSaved' })
                          setTimeout(() => setOrderNotice(null), 1600)
                        } else {
                          setOrderNotice(null)
                        }
                      },
                    }, visibilityEdit ? '✓' : '◉')
                  : null,
                // Reorder toggle — hidden while the visibility mode is open, which
                // is what makes the two mutually exclusive.
                page.order && orderable && !visibilityEdit
                  ? h('button', {
                      type: 'button',
                      style: orderEdit ? S.orderIconBtnOn : S.orderIconBtn,
                      title: t(orderEdit ? 'orderHint' : 'orderEdit'),
                      'aria-label': t(orderEdit ? 'orderDone' : 'orderEdit'),
                      'aria-pressed': orderEdit ? 'true' : 'false',
                      onClick: (e) => {
                        e.stopPropagation()
                        // Same reason as the visibility toggle above: opening a
                        // collapsed tab is a precondition for the mode being
                        // usable, not a side effect.
                        ensureTabOpen(page.id)
                        const leaving = orderEdit
                        setOrderEdit((v) => !v)
                        // Report on the way OUT only. Entering edit mode needs no message:
                        // the arrows appear, every row grows a ▲▼ pair and the glyph turns
                        // into a check mark — the change IS the feedback. Leaving is where a
                        // user may wonder whether their moves were kept. They always were.
                        if (leaving) {
                          setOrderNotice({ tab: page.id, kind: 'saved' })
                          setTimeout(() => setOrderNotice(null), 1600)
                        } else {
                          setOrderNotice(null)
                        }
                      },
                    }, orderEdit ? '✓' : '⇅')
                  : null,
                // Reset — ONE button, whose action depends on the mode that is
                // open, because each mode owns its own reset and neither may undo
                // the other's work. There is deliberately no combined "restore
                // everything": a user who tidied their order has not asked to see
                // their hidden rows again, and vice versa.
                page.order && orderable && editing
                  ? h('button', {
                      type: 'button',
                      style: orderNotice && orderNotice.tab === page.id ? S.orderIconBtnOn : S.orderIconBtn,
                      // The title names the consequence, and the consequence
                      // differs per tab AND per mode — see the locale keys. The
                      // disabled-plugin clause belongs to the Extensions tab's
                      // ORDER reset alone: those records live under `ext:*`, so
                      // the Workbench reset cannot touch them, and the visibility
                      // reset never touches order at all.
                      title: t(visibilityEdit ? 'visReset'
                        : page.id === 'extensions' ? 'orderResetExt' : 'orderReset'),
                      // aria-label stays short because a screen reader reads it on
                      // every focus.
                      'aria-label': t(visibilityEdit ? 'visResetShort' : 'orderResetShort'),
                      onClick: (e) => {
                        e.stopPropagation()
                        // Scoped to THIS tab in both branches: `page.id` is the tab
                        // id, which the clear functions map onto the matching halves
                        // of panelOrder.
                        if (visibilityEdit) {
                          clearPanelHidden(page.id)
                          setOrderNotice({ tab: page.id, kind: 'visReset' })
                        } else {
                          clearPanelOrder(page.id)
                          setOrderNotice({ tab: page.id, kind: 'reset' })
                        }
                        bumpOrder()
                        // Report even when nothing was stored: the user asked for a reset,
                        // and "there was nothing to reset" is not something they can tell
                        // apart from a dead button.
                        setTimeout(() => setOrderNotice(null), 1600)
                      },
                    }, '↺')
                  : null,
                // Full-size triangle, same family as the cluster's fold control;
                // the open state is this glyph rotated, which keeps the CSS
                // transition and turns `▶` into the same `▼` the card uses.
                h('span', { style: isOpen ? S.tabPageChevronOpen : S.tabPageChevron }, '▶'),
              ),
            ),
            // ── Tab body (only when open) ──
            isOpen
              ? h('div', { style: S.tabPageBody },
                  page.id === 'workbench'
                    ? builtInDraw.map((g, i) => renderBuiltInGroup(g, builtInGroups.get(g), i === 0))
                  : page.id === 'extensions'
                    ? extDraw.map((source, i) => renderExtGroup(source, thirdPartyGroups.get(source), i))
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

    /** Publish a console hook, loudly if it cannot be published.
     *
     *  A hook exists so a failure can be NAMED instead of guessed at, so one
     *  that silently fails to register defeats its own purpose. `overlayProbe`
     *  was once declared inside another function by mistake: the assignment
     *  threw `ReferenceError`, a bare `catch (_) {}` ate it, and the only
     *  symptom was a missing global with nothing in the console — a detour a
     *  single warning would have cut short. */
    function _exposeHook(name, fn) {
      try {
        window[name] = fn
      } catch (e) {
        console.warn('[dock-flash] console hook ' + name + ' could not be registered:', e)
      }
    }
    /** Live overlay state, published for the console hook.
     *
     *  The probe and the overlay itself live in different scopes on purpose:
     *  the overlay's DOM and offset belong to `mountStandaloneSlotTrigger`'s
     *  closure, while the probe must be reachable from `apply()` so it can be
     *  registered at startup. Rather than hoist the overlay's state (which the
     *  drag handlers read on every mousemove) this single object crosses the
     *  boundary, and the inner scope updates it in place.
     *
     *  It exists because reading these through the DOM is not possible: the
     *  probe has to report WHY nothing is showing, and the element's absence
     *  from the DOM is the very thing being diagnosed. */
    var _overlayState = {
      position: null,        // currentPosition, as the trigger switch reports it
      el: null,              // the mounted button, or null
      offset: null,          // { dx, dy }
      offsetSource: null,    // 'host' | 'localStorage/default'
      anchorAdopted: false,  // the ResizeObserver is attached to a live viewport
      anchorWatcher: 'none', // 'none' | 'waiting-for-anchor' | 'adopted'
      size: null,            // the size actually in effect (clamped for the position)
      sizeStored: null,      // what the user stored, before clamping
      sizeRange: null,       // { min, max } for the selected position
      layer: null,           // stacking level of the PANEL; the button is this + 1
      opacity: null,         // rest opacity of the overlay button
      opacityHovered: false, // whether the pointer is over it right now
      menuOpen: false,       // the right-click menu is on screen
      dragging: false,       // mirrored from the closure: forces the button solid
    }

    /** Overlay layer and rest-opacity presets.
     *
     *  Declared HERE, in the factory's own closure, and deliberately not beside
     *  the menu that renders them. Two consumers need them and they live in
     *  different scopes: `mountStandaloneSlotTrigger` draws the rows, while
     *  `_migrateLocalToHost` needs the list to tell a value the user chose from
     *  one a previous build's presets produced. Declaring them inside the
     *  standalone function made the migration throw `ReferenceError`, which its
     *  own `.catch` swallowed — so the entire host-preference load silently
     *  failed and every host-stored setting reverted to its default. That is the
     *  same shape as the `_exposeHook` trap documented above, which is why the
     *  lists sit at the widest scope that needs them rather than the nearest.
     *
     *  The presets are ordered by the MEASURED host UI, and what matters is a
     *  STACKING CONTEXT, not a list of numbers. Two earlier passes got this wrong
     *  by reading z-index values off elements that never compete:
     *
     *    - DSH's modal UI is mounted into `._portal_1nxmc_44`, which is
     *      `position: fixed; z-index: 1100`. That declaration CREATES a stacking
     *      context, so its children paint as one group. The mask
     *      (`._mask_w1urq_14`) has **no z-index at all** and the dialog
     *      (`._dialog_w1urq_22`) has `z-index: 1` — both are meaningless against
     *      anything outside the portal, and neither can be outranked separately.
     *      The ONLY host number a sibling button competes with here is **1100**.
     *      An earlier pass modelled this as "two host bands, 1100 and 1000, with
     *      no gap between them": that was reasoning about the wrong elements. 1050
     *      does clear 1000, but still loses to the portal's 1100 — which is why it
     *      covered the settings mask.
     *    - Overlays that are NOT in the portal declare their own z-index:
     *      `dsh-client-ui-chat`'s stat panel (`.bRhRbq_panel`, 1100) and
     *      `dock-base`'s `.dsh-wb-settings-overlay` (1100; dock-base is not under
     *      `@deepseek-ai` and was missed on the first pass). Its
     *      `.dsh-wb-menu` is 1000.
     *
     *  The ceiling to stay under is therefore **1100**, with the host's menus at
     *  1000 as the next band down. A preset meant to go under all of it must be
     *  strictly below 1000, not merely below 1100. */
    var LAYER_PRESETS = [
      // Under EVERY host layer (portal 1100, chat panel 1100, dock-base settings
      // 1100, host menus 1000), and below DSH's own in-content chrome as well.
      // The "stay out of the way" choice. 9 rather than ~900 because the gap
      // between "above page content" and 1000 is wide and the low end is where a
      // value cannot surprise anything: DSH's z-index census tops out at single
      // digits for ordinary chrome, so 9 still clears the panel's own
      // `z-index: 10` sibling case while staying far below every host overlay.
      { value: 9, label: '9' },
      { value: 1150, label: '1150' },   // DEFAULT: clear of DSH and dock-base
      { value: 2000, label: '2000' },   // clear with headroom
    ]
    var OPACITY_PRESETS = [
      { value: 0.55, label: '0.55' },   // what the hardcoded value always was
      { value: 0.7, label: '0.70' },
      { value: 0.85, label: '0.85' },
      { value: 1, label: '1.00' },
    ]
    /** The localStorage keys behind those two lists, hoisted with them for the
     *  same reason: `_migrateLocalToHost` compares a stored value against the
     *  presets, and a key declared in the standalone scope threw there. */
    var _layerStoreKey = 'dock-flash:trigger-layer'
    var _opacityStoreKey = 'dock-flash:overlay-opacity'
    /** The defaults those two lists ship with, hoisted for a third reason: the
     *  preference migration must know whether the host is still sitting at its
     *  DEFAULT before it may let a cached value override it. Without that test it
     *  cannot tell "the host has never been configured" from "the host holds a
     *  value the user deliberately chose", and it would overwrite the latter with
     *  whatever a stale cache happened to contain. */
    var DEFAULT_TRIGGER_LAYER = 1150
    var DEFAULT_OVERLAY_OPACITY = 0.55

    /** Console hook: `__dockFlashOverlay()` answers "why is the floating
     *  trigger not showing?" in one line, instead of leaving it to be
     *  inferred from the DOM. Every failure this feature can have is a
     *  silent one — not selected, no anchor, no element — so each is named. */
    function overlayProbe() {
      var currentPosition = _overlayState.position
      var overlayEl = _overlayState.el
      var overlayOffset = _overlayState.offset
      var candidates = []
      try {
        var found = document.querySelectorAll('div[class*="_scrollBody"]')
        for (var i = 0; i < found.length; i++) {
          var el = found[i]
          var rect = el.getBoundingClientRect()
          candidates.push({
            cls: String(el.className).slice(0, 40),
            overflowY: getComputedStyle(el).overflowY,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            clientWidth: el.clientWidth,
            gutter: Math.round(rect.width - el.clientWidth),
            scrollable: el.scrollHeight > el.clientHeight,
          })
        }
      } catch (_) {}
      var vp = conversationViewport()
      return {
        // First field on purpose: before reading any diagnosis, confirm WHICH
        // build produced it. A stale bundle is the one failure that makes every
        // other reading here meaningless.
        clientVersion: CLIENT_VERSION,
        selectedPosition: currentPosition,
        isOverlaySelected: currentPosition === 'conversation.overlay',
        overlayElMounted: !!overlayEl,
        overlayElInDom: !!(overlayEl && overlayEl.parentNode),
        overlayElDisplay: overlayEl ? overlayEl.style.display : null,
        overlayElRect: overlayEl ? (function () {
          var r = overlayEl.getBoundingClientRect()
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
        })() : null,
        offset: overlayOffset,
        offsetSource: (_hostPrefs && (_hostPrefs.triggerOverlayOffset || _hostPrefs.triggerSize))
          ? 'host' : 'localStorage/default',
        // Size is reported as THREE facts, because they can legitimately
        // disagree: what is stored, what the selected position allows, and what
        // is actually on screen. A user who set 64 on the overlay and then
        // switched to a slot position sees 48 here and should be able to read
        // why rather than guess.
        triggerSize: _overlayState.size,
        triggerSizeStored: _overlayState.sizeStored,
        triggerSizeRange: _overlayState.sizeRange,
        sizeSource: (_hostPrefs && _hostPrefs.triggerSize) ? 'host' : 'localStorage/default',
        // The right-click menu's two settings, plus whether it is open — the
        // menu is imperative DOM, so "why is it not there" needs an answer that
        // does not require reproducing the right-click.
        triggerLayer: _overlayState.layer,
        overlayOpacity: _overlayState.opacity,
        overlayOpacityHovered: _overlayState.opacityHovered,
        /** The shared drag flag. Exposed because `dragging` is a SINGLETON that
         *  forces the button solid — if it is ever left stuck true, the symptom
         *  is "my opacity setting does nothing", and nothing else would say so.
         *  (Same class of bug as `dragSource`, a stale singleton for the same
         *  reason: a throw in one handler left the state set.) Mirrored into
         *  `_overlayState` because this probe is at module scope and cannot see
         *  the closure's locals — the split that caused three separate
         *  "it says it is not mounted" defects. */
        dragging: _overlayState.dragging,
        menuOpen: _overlayState.menuOpen,
        opacitySource: (_hostPrefs && _hostPrefs.overlayOpacity) ? 'host' : 'localStorage/default',
        /** Where the layer value came from, side by side. The three can
         *  legitimately disagree, and a disagreement IS the defect: the host is
         *  read FIRST, so a host value the user never chose silently beats the
         *  pick still sitting in the cache. Reporting only the resolved number
         *  would hide exactly that. */
        triggerLayerSources: {
          host: (_hostPrefs && typeof _hostPrefs.triggerLayer === 'number') ? _hostPrefs.triggerLayer : null,
          cache: (function () { try { return localStorage.getItem('dock-flash:trigger-layer') } catch (_) { return null } })(),
          resolved: _overlayState.layer,
        },
        /** The panel's OWN DOM z-index. "The menu says 9" and "the element
         *  carries 9" are different facts, and only the second one stacks. */
        panelLayer: (function () {
          try {
            var p = document.querySelector('[data-dsh-plugin="dock-flash-standalone"]')
            if (!p) return null
            var pcs = null
            try { pcs = getComputedStyle(p) } catch (_) {}
            return { style: p.style.zIndex, computed: pcs ? pcs.zIndex : null, display: p.style.display }
          } catch (_) { return null }
        })(),
        /** What a CLICK at the button's centre actually hits.
         *
         *  An element's z-index only competes INSIDE its own stacking context, so
         *  "the mask is 1000 and the panel is 9, why is the mask not on top" is
         *  not answerable from those two numbers alone. Siblings in one context
         *  compare directly; an element nested in a context compares only against
         *  that context. `elementFromPoint` asks the browser the question that
         *  actually matters, and the top few candidates are returned so the answer
         *  is a reading rather than a hypothesis. */
        hitTest: (function () {
          var el = _overlayState.el
          if (!el || typeof document.elementFromPoint !== 'function') return null
          var r = null
          try { r = el.getBoundingClientRect() } catch (_) { return null }
          if (!r || !r.width) return null
          var cx = Math.round(r.left + r.width / 2)
          var cy = Math.round(r.top + r.height / 2)
          var describe = function (n) {
            if (!n) return null
            var cs = null
            try { cs = getComputedStyle(n) } catch (_) {}
            return {
              tag: String(n.tagName || '').toLowerCase(),
              id: n.id || '',
              cls: String(n.className || '').slice(0, 60),
              zIndex: cs ? cs.zIndex : null,
              position: cs ? cs.position : null,
              pointerEvents: cs ? cs.pointerEvents : null,
            }
          }
          var list = []
          try {
            list = (typeof document.elementsFromPoint === 'function')
              ? document.elementsFromPoint(cx, cy)
              : [document.elementFromPoint(cx, cy)]
          } catch (_) { list = [] }
          var stack = []
          for (var i = 0; i < list.length && i < 4; i++) stack.push(describe(list[i]))
          return {
            at: { x: cx, y: cy },
            buttonZIndex: el.style ? el.style.zIndex : null,
            buttonIsOnTop: !!(list[0] && (list[0] === el || (el.contains && el.contains(list[0])))),
            top: stack[0] || null,
            stack: stack,
          }
        })(),
        anchorFound: !!vp,
        anchorRect: vp ? { x: Math.round(vp.rect.x), y: Math.round(vp.rect.y), w: Math.round(vp.rect.width), h: Math.round(vp.rect.height) } : null,
        anchorGutter: vp ? Math.round(vp.gutter) : null,
        // Acquisition is reported separately from the anchor, because "the
        // anchor exists" and "the button is watching the anchor" are different
        // facts and only the second one keeps the button in place.
        anchorAdopted: _overlayState.anchorAdopted,
        anchorWatcher: _overlayState.anchorWatcher,
        rail: (function () { var p = turnRailProbe(); return { visible: p.visible, reason: p.reason, count: p.count } })(),
        candidates: candidates,
        verdict: currentPosition !== 'conversation.overlay'
          ? 'this position is NOT selected — pick "Conversation top-right" in the trigger-position switch'
          : !overlayEl ? 'selected but NOT mounted — applyTrigger() did not run or mountOverlayTrigger() threw; check the console for a [dock-flash] error'
          : !vp ? 'mounted, but NO ANCHOR yet: no visible div[class*="_scrollBody"] with overflow-y auto/scroll. The watcher is retrying — open a conversation, then re-run this.'
          : overlayEl.style.display !== 'flex' ? 'anchor found but the button is still ' + overlayEl.style.display + ' — positionOverlayTrigger() did not run after the anchor appeared'
          : 'ok — element ' + overlayEl.style.display + ' at ' + overlayEl.style.left + ',' + overlayEl.style.top,
      }
    }

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
        // No `slot`: this one is a floating overlay anchored to the conversation
        // viewport, not a slot injection. Absence of `slot` is what selects the
        // overlay path in applyTrigger(), and what makes injectTrigger() refuse
        // it — so the position has exactly one mount path.
        { value: 'conversation.overlay', label: L('triggerConversationOverlay'), style: 'overlay' },
      ]

      /** Host first once it has answered, localStorage until then — same rule
       *  as the panel order. Either source is validated against the list, so a
       *  stored value naming a slot that no longer exists falls back rather
       *  than injecting into nothing. */
      function loadTriggerPosition() {
        var valid = function (raw) {
          return raw && TRIGGER_POSITIONS.some(function (p) { return p.value === raw }) ? raw : null
        }
        var fromHost = valid(_hostPrefs && _hostPrefs.triggerPosition)
        if (fromHost) return fromHost
        try {
          var local = valid(localStorage.getItem(_posStoreKey))
          if (local) return local
        } catch (_) {}
        return 'input.right'
      }
      function saveTriggerPosition(pos) {
        savePrefs(_prefCtx, { triggerPosition: pos }, function () {
          try { localStorage.setItem(_posStoreKey, pos) } catch (_) {}
        })
      }

      // ── Overlay trigger: where the user dragged it to ──────────────────
      // Stored as an OFFSET from the conversation viewport's top-right corner,
      // not as absolute coordinates. That is the whole point of anchoring to
      // the conversation: opening the right sidebar, dragging the sash or
      // resizing the window moves the corner, and the trigger follows it
      // instead of being left behind in whatever empty space the layout
      // change created.
      //
      // Both components measure INWARD from that corner, so the default sits
      // 8px inside it and a larger value moves the button further in.
      var OVERLAY_EDGE = 8
      var OVERLAY_POS_KEY = 'dock-flash:overlay-offset'
      var overlayOffset = null

      function loadOverlayOffset() {
        var fromHost = _hostPrefs && _hostPrefs.triggerOverlayOffset
        var raw = (fromHost && typeof fromHost === 'object') ? fromHost : null
        if (!raw) {
          try { raw = JSON.parse(localStorage.getItem(OVERLAY_POS_KEY) || 'null') } catch (_) { raw = null }
        }
        var ok = function (v) { return typeof v === 'number' && isFinite(v) && v >= 0 }
        if (raw && ok(raw.dx) && ok(raw.dy)) return { dx: raw.dx, dy: raw.dy }
        return { dx: OVERLAY_EDGE, dy: OVERLAY_EDGE }
      }
      function saveOverlayOffset(next) {
        overlayOffset = next
        _overlayState.offset = next
        savePrefs(_prefCtx, { triggerOverlayOffset: next }, function () {
          try { localStorage.setItem(OVERLAY_POS_KEY, JSON.stringify(next)) } catch (_) {}
        })
      }

      overlayOffset = loadOverlayOffset()
      _overlayState.offset = overlayOffset

      /** Same ordering problem as the size, and the same two-part fix: the host
       *  round trip starts before this closure exists, so the immediate call is
       *  what actually adopts an already-answered host value, and the
       *  subscription covers one that answers later. This one is a user-made
       *  POSITION, so losing it silently relocates the button rather than merely
       *  resizing it. */
      function adoptHostOffset() {
        var hostOffset = _hostPrefs && _hostPrefs.triggerOverlayOffset
        if (!hostOffset || typeof hostOffset !== 'object') return
        var ok = typeof hostOffset.dx === 'number' && typeof hostOffset.dy === 'number' &&
          isFinite(hostOffset.dx) && isFinite(hostOffset.dy)
        if (!ok) return
        if (overlayOffset && overlayOffset.dx === hostOffset.dx && overlayOffset.dy === hostOffset.dy) return
        overlayOffset = { dx: hostOffset.dx, dy: hostOffset.dy }
        _overlayState.offset = overlayOffset
        positionOverlayTrigger()
      }
      _subscribePrefs(adoptHostOffset)
      adoptHostOffset()

      // ── Trigger button SIZE ────────────────────────────────────────────
      // ONE source of truth for a number that used to be scattered: 1.3.x had a
      // literal `OVERLAY_SIZE = 24` read in six places by the positioning
      // arithmetic, plus three independently chosen icon sizes (16 here, 14/16
      // for the slot button). Any of those drifting from the element's real
      // width is not a cosmetic bug — the clamp, the scrollbar clearance and the
      // turn-rail give-way all measure the BUTTON, so a stale constant parks the
      // button over the rail or off the conversation.
      //
      // The minimum IS the default IS the historical size, so the control can
      // only make the button larger: an upgrade changes nothing, and there is no
      // way to shrink the entry point until it is hard to hit.
      var TRIGGER_SIZE_MIN = 24
      // A slot button shares its row with DSH's own controls — the input's send
      // button, the session header's actions. Past roughly twice their height it
      // stops being an icon in a row and starts deforming the row.
      var TRIGGER_SIZE_SLOT_MAX = 48
      // The overlay is a sibling of nothing: it floats over the conversation and
      // is clamped into it, so its only real constraints are "never cover the
      // scrollbar" and "never cover the turn rail" — both of which
      // positionOverlayTrigger() already enforces for any size. Hence the larger
      // ceiling, which is the whole point of offering the draggable position.
      var TRIGGER_SIZE_OVERLAY_MAX = 64
      var DEFAULT_TRIGGER_SIZE = TRIGGER_SIZE_MIN
      var _sizeStoreKey = 'dock-flash:trigger-size'
      var triggerSize = DEFAULT_TRIGGER_SIZE       // stored, unclamped
      var triggerSizeMax = TRIGGER_SIZE_SLOT_MAX   // ceiling for the CURRENT position

      /** Clamp a candidate to the range the current position allows.
       *  A non-numeric value (a hand-edited settings.yaml, a stale string in
       *  localStorage) falls back to the default rather than propagating NaN
       *  into a CSS length. */
      function clampTriggerSize(v, max) {
        var n = Number(v)
        if (!isFinite(n)) return DEFAULT_TRIGGER_SIZE
        var hi = isFinite(max) ? max : TRIGGER_SIZE_SLOT_MAX
        if (hi < TRIGGER_SIZE_MIN) hi = TRIGGER_SIZE_MIN
        return Math.max(TRIGGER_SIZE_MIN, Math.min(Math.round(n), hi))
      }
      /** The ceiling for a position: the draggable overlay may be larger. */
      function sizeRangeFor(pos) {
        return isOverlayPosition(pos) ? TRIGGER_SIZE_OVERLAY_MAX : TRIGGER_SIZE_SLOT_MAX
      }
      /** The ONE value the render paths and the positioning arithmetic read.
       *  Stored value first, then clamped — never the rendered box, whose
       *  getBoundingClientRect() still reports the OLD size for a frame after a
       *  style write, which would leave the clamp measuring last week's button. */
      function effectiveTriggerSize() {
        return clampTriggerSize(triggerSize, triggerSizeMax)
      }
      /** Icon edge for a button of `size`. Two thirds keeps the glyph inside its
       *  box with a visible margin: 24→16 (exactly what 1.3.x used), 48→32,
       *  64→43. Rounded, so the svg attribute is never fractional. */
      function triggerIconSize(size) {
        return Math.max(8, Math.round(size * 2 / 3))
      }
      /** Corner radius for a button of `size`: 24→6 (unchanged), 64→16. */
      function triggerRadius(size) {
        return Math.round(size / 4)
      }

      function loadTriggerSize() {
        var fromHost = _hostPrefs && _hostPrefs.triggerSize
        if (typeof fromHost === 'number' && isFinite(fromHost)) return fromHost
        try {
          var raw = localStorage.getItem(_sizeStoreKey)
          if (raw !== null && raw !== '') {
            var n = Number(raw)
            if (isFinite(n)) return n
          }
        } catch (_) {}
        return DEFAULT_TRIGGER_SIZE
      }
      function saveTriggerSize(next) {
        triggerSize = next
        savePrefs(_prefCtx, { triggerSize: next }, function () {
          try { localStorage.setItem(_sizeStoreKey, String(next)) } catch (_) {}
        })
      }
      triggerSize = loadTriggerSize()

      // ── Overlay layer and rest opacity (right-click menu) ──────────────
      // Both are ONLY meaningful for the draggable overlay: it is the one
      // element that floats over host UI rather than inside it, so it is the
      // only one whose stacking and translucency are the user's business.
      //
      // `LAYER_PRESETS` / `OPACITY_PRESETS` are NOT declared here — they live in
      // the factory closure above, because the preference migration needs the
      // same list to recognise a stale preset. See the comment there.
      var triggerLayer = DEFAULT_TRIGGER_LAYER
      var overlayOpacity = DEFAULT_OVERLAY_OPACITY

      /** Read a host-first numeric preference, then localStorage, then default.
       *
       *  `validate` guards the SHAPE of a value wherever it comes from; `cacheOk`
       *  guards the CACHE only, and deliberately not the host. The asymmetry is
       *  the point: a host value is authoritative even when it is not one of this
       *  build's presets — a user may have set it by editing `settings.yaml`, and
       *  refusing it would discard a deliberate choice. localStorage is a cache of
       *  things past builds wrote, so it is trusted only when the current build
       *  could have written it (see `_isCurrentPreset`). */
      function _loadNumberPref(hostKey, localKey, fallback, validate, cacheOk) {
        var fromHost = _hostPrefs && _hostPrefs[hostKey]
        if (typeof fromHost === 'number' && isFinite(fromHost) && validate(fromHost)) return fromHost
        try {
          var raw = localStorage.getItem(localKey)
          if (raw !== null && raw !== '') {
            var n = Number(raw)
            if (isFinite(n) && validate(n) && (!cacheOk || cacheOk(n))) return n
          }
        } catch (_) {}
        return fallback
      }
      var _layerOk = function (n) { return isFinite(n) && n > 0 }
      var _opacityOk = function (n) { return isFinite(n) && n > 0 && n <= 1 }
      /** Is this value one of the presets the CURRENT build offers?
       *
       *  The cache is only trustworthy when it holds something this build could
       *  have written. A value left behind by a REMOVED preset (1050, retired in
       *  1.5.1) is not a user's choice any more — it is the previous build's
       *  default, and honouring it makes the new preset list look inert until the
       *  host answers. That is the same distinction `_migrateLocalToHost` draws,
       *  and it has to be drawn in BOTH readers or the slower one wins by
       *  accident: this function runs at mount, before the host reply lands, so a
       *  poisoned cache would otherwise take effect on every cold load. */
      function _isCurrentPreset(list, value) {
        for (var i = 0; i < list.length; i++) if (list[i].value === value) return true
        return false
      }
      triggerLayer = _loadNumberPref('triggerLayer', _layerStoreKey, DEFAULT_TRIGGER_LAYER, _layerOk, function (n) {
        return _isCurrentPreset(LAYER_PRESETS, n)
      })
      overlayOpacity = _loadNumberPref('overlayOpacity', _opacityStoreKey, DEFAULT_OVERLAY_OPACITY, _opacityOk, function (n) {
        return _isCurrentPreset(OPACITY_PRESETS, n)
      })
      /** Written on activation change, and reported by the menu. Note the
       *  asymmetry with `_loadNumberPref` above: a WRITE accepts any positive
       *  value (there is nothing to validate against — the user just picked it),
       *  while a READ of the CACHE requires it to be a current preset. Only the
       *  read path can be holding a value a build the user is no longer running
       *  produced. */
      function saveTriggerLayer(next) {
        triggerLayer = next
        savePrefs(_prefCtx, { triggerLayer: next }, function () {
          try { localStorage.setItem(_layerStoreKey, String(next)) } catch (_) {}
        })
        applyTriggerLayer()
      }
      function saveOverlayOpacity(next) {
        overlayOpacity = next
        savePrefs(_prefCtx, { overlayOpacity: next }, function () {
          try { localStorage.setItem(_opacityStoreKey, String(next)) } catch (_) {}
        })
        applyOverlayOpacity()
      }

      /** The panel's level, and the button one above it so an open panel can
       *  never hide the control that opened it (the 1.4.0 defect). Always
       *  DERIVED from one setting rather than stored twice, or the two drift and
       *  reproduce exactly that bug. */
      function panelLayer() { return triggerLayer }
      function triggerLayerOfButton() { return triggerLayer + 1 }
      function layerOfMenu() { return triggerLayer + 2 }

      /** Push the layer onto whatever exists right now. Safe when unmounted. */
      function applyTriggerLayer() {
        if (panelContainer) panelContainer.style.zIndex = String(panelLayer())
        if (overlayEl) overlayEl.style.zIndex = String(triggerLayerOfButton())
        if (overlayMenuEl) overlayMenuEl.style.zIndex = String(layerOfMenu())
        _overlayState.layer = triggerLayer
      }

      /** Is the pointer over the overlay button? Read from a flag rather than
       *  `:hover` because the drag path needs to force solid regardless. */
      var overlayHovered = false
      /** Paint the button's rest/hover opacity from STATE.
       *
       *  The rule is one place on purpose. The previous version wrote literals
       *  from three separate listeners, and its `mouseleave` guard was
       *  `if (!dragging) … = '0.55'` — so a drag that ENDED with the pointer off
       *  the button left it at hover brightness, making the same button look
       *  different depending on how the user last touched it. Hover and
       *  in-progress drag mean solid; everything else means the user's chosen
       *  rest value. Safe when unmounted. */
      function paintOverlayOpacity() {
        if (!overlayEl) return
        overlayEl.style.opacity = String((overlayHovered || dragging) ? 1 : overlayOpacity)
        _overlayState.opacity = overlayOpacity
        _overlayState.opacityHovered = overlayHovered
      }
      /** Re-paint after the setting changes, so a menu pick is visible at once. */
      function applyOverlayOpacity() { paintOverlayOpacity() }

      /** Adopt the size the host holds, if it disagrees with what we have.
       *
       *  CALLED IMMEDIATELY, and that first call is the load-bearing one: this
       *  function is installed by `mountStandaloneSlotTrigger()`, which runs at
       *  the END of `apply()`, while `loadHostPreferences()` is started at the
       *  TOP of it. In a browser the host's answer almost always lands BEFORE
       *  this code exists, so `_emitPrefs()` has already fired and a
       *  subscribe-only listener would never hear about the stored value — the
       *  host would be read into `_hostPrefs` and then ignored for the life of
       *  the page. That is the same shape as the `triggerOverlayOffset` defect
       *  this release also fixes: fetched, stored, never read. Subscribing
       *  covers a host that answers LATE; calling it once covers a host that
       *  answered EARLY, and both orderings occur. */
      function adoptHostSize() {
        var hostSize = _hostPrefs && _hostPrefs.triggerSize
        if (typeof hostSize !== 'number' || !isFinite(hostSize)) return
        if (hostSize === triggerSize) return
        triggerSize = hostSize
        applyTriggerSize()
        if (registry) { try { registry.notifyChange('dock-flash:trigger-size') } catch (_) {} }
      }
      _subscribePrefs(adoptHostSize)
      adoptHostSize()

      /** Adopt the LAYER and the rest OPACITY the host holds.
       *
       *  These two had no such handler until now, and that omission is the whole
       *  bug: `triggerLayer` and `overlayOpacity` are read ONCE at factory init
       *  by `_loadNumberPref`, and at that moment `_hostPrefs` is still `null`
       *  because `loadHostPreferences()` is an async round trip started later in
       *  `apply()`. So the host's stored copy — the authoritative one, the one
       *  the user sees in `settings.yaml` — was never read into the variables
       *  that position anything, and both the panel and the button kept whatever
       *  localStorage or the built-in default supplied.
       *
       *  The symptom is precisely "the layer setting does nothing": a user with
       *  `triggerLayer: 9` on disk still watched the icon float above DSH's
       *  modal mask, because on screen the pair was really at the default
       *  1150/1151. Right in the file, wrong on the glass. `adoptHostSize` above
       *  documents this exact two-ordering trap and `adoptHostOffset` before it
       *  does too — the same handler simply was not written for the two settings
       *  added in 1.5.0. Subscribing covers a host that answers LATE; calling it
       *  once covers a host that answered EARLY, and both orderings occur. */
      function adoptHostLayer() {
        var hostLayer = _hostPrefs && _hostPrefs.triggerLayer
        if (typeof hostLayer !== 'number' || !isFinite(hostLayer) || hostLayer <= 0) return
        if (hostLayer === triggerLayer) return
        triggerLayer = hostLayer
        applyTriggerLayer()
        if (registry) { try { registry.notifyChange('dock-flash:trigger-layer') } catch (_) {} }
      }
      _subscribePrefs(adoptHostLayer)
      adoptHostLayer()

      function adoptHostOpacity() {
        var hostOpacity = _hostPrefs && _hostPrefs.overlayOpacity
        if (typeof hostOpacity !== 'number' || !isFinite(hostOpacity) || hostOpacity <= 0 || hostOpacity > 1) return
        if (hostOpacity === overlayOpacity) return
        overlayOpacity = hostOpacity
        applyOverlayOpacity()
        if (registry) { try { registry.notifyChange('dock-flash:overlay-opacity') } catch (_) {} }
      }
      _subscribePrefs(adoptHostOpacity)
      adoptHostOpacity()

      var currentPosition = loadTriggerPosition()
      _overlayState.position = currentPosition

      /** Is this position the floating overlay (i.e. carries no `slot`)? */
      function isOverlayPosition(v) {
        var cfg = TRIGGER_POSITIONS.find(function (p) { return p.value === v })
        return !!(cfg && !cfg.slot)
      }

      /** Bring the trigger for `v` into being, replacing whatever was there.
       *
       *  The overlay is mounted HERE, not inside the `ctx.inject(['slots'], …)`
       *  callback below, and that is the whole point: the overlay reads no slot
       *  service, so gating it on one meant that when the slots callback did not
       *  run the button simply never appeared — with the position correctly
       *  selected and the anchor correctly found, and nothing to explain it. A
       *  position that needs no service must not wait for one.
       *
       *  This is also the ONE writer of `_overlayState.position`: the initial
       *  load and the switch both route through here, so the probe can never
       *  report a position the mount path was not told about. */
      function applyTrigger(v) {
        if (slotDispose) { try { slotDispose() } catch (_) {} slotDispose = null }
        unmountOverlayTrigger()
        currentPosition = v
        _overlayState.position = v
        // The size ceiling FOLLOWS the position: leaving the overlay for a slot
        // position must shrink a 64px button back to what the row can hold. The
        // stored value is left alone, so returning to the overlay restores it —
        // clamping here is a display rule, not a destructive write.
        triggerSizeMax = sizeRangeFor(v)
        if (isOverlayPosition(v)) {
          ensureGlobalListeners()
          try {
            mountOverlayTrigger()
          } catch (e) {
            // Named, and non-fatal. This call sits before `ctx.inject(['slots'])`
            // in apply(), so an unguarded throw would take out every SLOT
            // position too — one position failing must not remove the other
            // four. Swallowing it instead is what made "the button never
            // appeared" unattributable in the first place.
            console.error('[dock-flash] overlay trigger failed to mount:', e)
          }
        }
      }

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
          // A viewport narrower than the panel would otherwise push it off
          // screen with no way back.
          maxWidth: 'calc(100vw - 24px)',
          maxHeight: '70vh',
          overflow: 'hidden',
          borderRadius: '10px',
          zIndex: String(panelLayer()),
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
          // BOTH axes. `minHeight: 0` was already here — the standard fix for
          // vertical flex overflow — but the horizontal half was missing, and a
          // flex item's default `min-width: auto` means "never narrower than my
          // content": one long row widens this box past the panel's fixed 320px,
          // and the overflow surfaces as a scrollbar on an ancestor.
          minWidth: '0',
          overflowY: 'auto',
          overflowX: 'hidden',
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
        raiseOverlayAbovePanel(false)
        unmountPanel()
        if (onPanelStateChange) onPanelStateChange(false)
      }

      /** Keep the overlay button visible while the panel it opened is on screen.
       *
       *  The panel is z-index 99998 and the overlay button 99997 — deliberately,
       *  so the panel is drawn over the trigger. That is fine for every control
       *  EXCEPT one: the size. Changing the size while the panel covers the
       *  button makes the change invisible until the panel closes, which reads
       *  exactly like "the setting only applies after I close the panel" and was
       *  reported as such.
       *
       *  Rather than moving the panel away from its anchor (which weakens the
       *  relationship between the two) or raising the button permanently (which
       *  would put it over the panel's own header at all times), the button is
       *  lifted ABOVE the panel only while that panel is open, and lowered again
       *  on close. Only the overlay needs this: a slot button lives in DSH's own
       *  layout and is never covered by this panel. */
      /** Retired in favour of a permanent offset.
       *
       *  1.4.0 made the button visible while its panel was open by TOGGLING the
       *  button's z-index on open/close. That worked, but it was a second piece
       *  of state to keep in step with the panel's own level, and it only held
       *  because every caller remembered to call it.
       *
       *  The button now simply sits at `triggerLayer + 1` for its whole life —
       *  one level above the panel, always — so the property holds by
       *  construction. See `panelLayer()` / `triggerLayerOfButton()`: both are
       *  DERIVED from the single `triggerLayer` value, so the relationship
       *  cannot drift when the user changes the layer from the context menu. */
      function raiseOverlayAbovePanel() { applyTriggerLayer() }

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
        } else if (posConfig && posConfig.style === 'overlay') {
          // Overlay trigger: open the panel BELOW the button, aligned to its
          // right edge, and fall back to ABOVE when there is not room underneath.
          // Without that fallback a button dragged toward the bottom of the
          // conversation would open the panel off-screen.
          //
          // `rect.bottom` is the button's BOTTOM edge, so this gap already starts
          // the panel clear of the button — measured, not assumed. It was briefly
          // "fixed" to add `rect.height` on top, which double-counted the height
          // (the panel landed a whole button-height too low) on the theory that
          // this gap was what hid the button while the panel was open. It was
          // not: the panel is z-index 99998 and the button 99997, so the panel
          // legitimately covers the button's corner, and the fix for that is
          // `raiseOverlayAbovePanel()` — the button is lifted while the panel it
          // owns is open, rather than the panel being pushed away from its anchor.
          var panelH = (panelContainer.getBoundingClientRect().height) || 320
          var GAP = 6
          var below = rect.bottom + GAP
          if (below + panelH > window.innerHeight - 8) {
            panelContainer.style.bottom = (window.innerHeight - rect.top + GAP) + 'px'
            panelContainer.style.top = 'auto'
          } else {
            panelContainer.style.top = below + 'px'
            panelContainer.style.bottom = 'auto'
          }
          // Right-aligned to the button, clamped so the panel cannot hang off
          // the window when the button sits near the left edge.
          panelContainer.style.right = Math.max(8, window.innerWidth - rect.right) + 'px'
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
        // After `display`, not before: this must win over the panel it just
        // opened, and the button is the one thing on screen that says how big the
        // trigger is while the panel is up.
        raiseOverlayAbovePanel(true)
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

      /** The same ⚡ glyph, built as REAL DOM instead of a React element.
       *
       *  The overlay button is a plain `document.createElement('button')`, so
       *  `LightningIcon()`'s `h('svg', …)` cannot be its child: that call
       *  returns a React element DESCRIPTOR — a plain object — and
       *  `appendChild` requires a Node, so it threw
       *  `TypeError: parameter 1 is not of type 'Node'` before `overlayEl` was
       *  ever assigned. The result was a button that reported `mounted: false`
       *  and was never in the DOM, and because the overlay mounts before
       *  `ctx.inject(['slots'])`, the throw also stopped every SLOT position
       *  from registering. A React element is only a child for a React
       *  renderer; a hand-built element needs hand-built children. */
      function LightningIconNode(size) {
        var NS = 'http://www.w3.org/2000/svg'
        var svg = document.createElementNS(NS, 'svg')
        svg.setAttribute('width', String(size))
        svg.setAttribute('height', String(size))
        svg.setAttribute('viewBox', '0 0 16 16')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('xmlns', NS)
        svg.style.display = 'block'
        var path = document.createElementNS(NS, 'path')
        path.setAttribute('d', 'M9.22 1.35a.75.75 0 0 1 .43.68v4.72h3.1a.75.75 0 0 1 .59 1.22l-5.4 6.72a.75.75 0 0 1-1.34-.46V9.49H3.25a.75.75 0 0 1-.59-1.22l5.4-6.72a.75.75 0 0 1 1.16-.2Z')
        path.setAttribute('fill', 'currentColor')
        svg.appendChild(path)
        return svg
      }

      // ── QuickTriggerIconButton — compact icon button for input/header slots ──
      function QuickTriggerIconButton(props) {
        var _s = useState(false)
        var active = _s[0]
        var setActive = _s[1]
        // A second state cell purely as a re-render trigger. The button's style —
        // including its size — is computed DURING RENDER, so it must be told when
        // to repaint. TWO sources can change the size, and they are different
        // events, which is what an earlier version of this got wrong:
        //   - the registry, when the user moves the slider. `setValue` bumps the
        //     registry version and the panel subscribes to it, but this button did
        //     NOT — so a slider move resized the overlay (which lives in the same
        //     closure and is resized imperatively) and left the slot button at its
        //     old size until something unrelated re-rendered it.
        //   - `_subscribePrefs`, when the HOST answers with a stored value or a
        //     migration lands. That path does not touch the registry.
        // Both are needed; neither implies the other.
        var _sz = useState(0)
        var bumpSize = _sz[1]
        // Alert count for the badge on this button
        var _ac = useState(0)
        var alertCount = _ac[0]
        var setAlertCount = _ac[1]

        // Per-severity alert counts for colored badges
        var _sc = useState({ critical: 0, error: 0, warning: 0, info: 0 })
        var severityCounts = _sc[0]
        var setSeverityCounts = _sc[1]

        useEffect(function () {
          onPanelStateChange = function (visible) { setActive(visible) }
          var offPrefs = _subscribePrefs(function () { bumpSize(function (n) { return n + 1 }) })
          var offRegistry = registry && registry.subscribe
            ? registry.subscribe(function () { bumpSize(function (n) { return n + 1 }) })
            : function () {}
          // Subscribe to alert registry for badge updates
          var offAlerts = function () {}
          try {
            var _ar = ctx.get('dockFlashAlerts')
            if (_ar) {
              setAlertCount(_ar.alertCount)
              setSeverityCounts(_ar.alertCountsBySeverity)
              offAlerts = _ar.subscribe(function () {
                setAlertCount(_ar.alertCount)
                setSeverityCounts(_ar.alertCountsBySeverity)
              })
            }
          } catch (_) {}
          return function () {
            onPanelStateChange = null
            offPrefs()
            offRegistry()
            offAlerts()
          }
        }, [])

        var handleClick = function () {
          if (panelVisible) closePanel(); else openPanel()
        }

        var posConfig = TRIGGER_POSITIONS.find(function (p) { return p.value === currentPosition })
        var isHeader = posConfig && posConfig.style === 'header'
        // The SAME number the overlay uses, clamped to this position's ceiling —
        // one source for both entry points, so the panel's slider cannot mean two
        // different sizes depending on where the button happens to live.
        var size = effectiveTriggerSize()

        var btnStyle = {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: triggerRadius(size) + 'px',
          cursor: 'pointer',
          background: active ? 'rgba(90, 120, 255, 0.18)' : 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          // The header variant keeps horizontal padding so it still reads as an
          // icon control in that row; its box grows with the icon below.
          padding: isHeader ? '2px 4px' : '0',
          lineHeight: 1,
          transition: 'background 0.15s ease',
          outline: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          minWidth: size + 'px',
          height: size + 'px',
          boxSizing: 'border-box',
          position: 'relative',  // anchor for the alert badge
        }

        // Alert badge — single badge colored by highest severity, shows total count
        var _severityStyleKey = { critical: 'alertBadgeCritical', error: 'alertBadgeError', warning: 'alertBadgeWarning', info: 'alertBadgeInfo' }
        var badgeEl = null
        if (alertCount > 0) {
          // Find highest severity
          var highestSev = 'info'
          var _sevOrder = ['info', 'warning', 'error', 'critical']
          for (var si = _sevOrder.length - 1; si >= 0; si--) {
            if ((severityCounts[_sevOrder[si]] || 0) > 0) { highestSev = _sevOrder[si]; break }
          }
          badgeEl = h('span', {
            style: Object.assign({}, S.alertBadge, S[_severityStyleKey[highestSev]]),
          }, alertCount > 99 ? '99+' : String(alertCount))
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
        }, LightningIcon(triggerIconSize(size)), badgeEl)
      }

      // ── Overlay trigger: a floating button pinned inside the conversation ──
      //
      // Deliberately NOT a slot. A slot is a place in DSH's own layout, and the
      // whole point of this position is to sit *over* the conversation rather
      // than be laid out by it. So the button is appended to <body> at
      // `position: fixed`, exactly like the standalone panel, and positioned
      // from the conversation viewport's own rect.
      //
      // Two clearances, both measured rather than assumed:
      //   - the scrollbar, via `clientWidth` (the viewport reserves it with
      //     `scrollbar-gutter: stable`, so the value does not change when
      //     content crosses the scroll threshold)
      //   - the turn rail, via the existing turnRailProbe(), which already
      //     handles "another plugin owns it" and "the rail is off-screen"
      // No size constant here: the button's edge length comes from
      // `effectiveTriggerSize()`, which is the same number the element is drawn
      // with. A literal here would silently disagree with the box the moment the
      // user resized it, and every clamp below measures that box.
      var overlayEl = null
      var _overlayAlertUnsub = null
      /** The right-click menu, appended to <body> like the panel and the button.
       *  Deliberately NOT a child of the button: that element carries
       *  `opacity` (children inherit it, so the menu would go translucent too)
       *  and a fixed box with a border radius (the menu would be clipped). */
      var overlayMenuEl = null
      /** Outside-click / Escape wiring, installed once with the menu. */
      var overlayMenuDispose = null
      var overlayObserver = null
      // The element the ResizeObserver is attached to, plus the machinery that
      // ACQUIRES one. All three exist because the button is mounted during
      // `apply()`, which runs at app bootstrap — before any conversation exists.
      // Positioning once at mount therefore found no anchor, left the button at
      // its `display:none` default, and attached no observer, so nothing was
      // left to revisit it: the button was mounted, in the DOM, and permanently
      // invisible until an unrelated window resize happened. Geometry after
      // acquisition is the ResizeObserver's job; these only answer "which
      // element, and has it appeared yet".
      var overlayAnchor = null
      var overlayAnchorWatch = null
      var overlayRetryTimer = null
      var overlayReanchorScheduled = false

      /** Mirror this closure's live locals into the module-scope probe state.
       *  `overlayProbe()` lives at module scope and cannot see `overlayEl`,
       *  `overlayAnchor` or `overlayAnchorWatch` — that scope split is what
       *  produced three separate "it says it is not mounted" defects, so the
       *  answer is not to read them again from the probe but to copy them here,
       *  at every point where one of them changes. */
      function syncOverlayState() {
        _overlayState.el = overlayEl
        _overlayState.position = currentPosition
        _overlayState.offset = overlayOffset
        _overlayState.size = effectiveTriggerSize()
        // The STORED value, bounded only by the absolute OVERLAY ceiling — not
        // by the current position's. Reporting it clamped to the slot ceiling
        // made the field useless: it read 24 for every stored value above the
        // minimum, so the probe could not show that 64 was being held back by a
        // slot position, which is the one question it exists to answer.
        _overlayState.sizeStored = clampTriggerSize(triggerSize, TRIGGER_SIZE_OVERLAY_MAX)
        _overlayState.sizeRange = { min: TRIGGER_SIZE_MIN, max: triggerSizeMax }
        _overlayState.anchorAdopted = !!overlayAnchor
        _overlayState.anchorWatcher = overlayAnchorWatch
          ? (overlayAnchorMissing() ? 'waiting-for-anchor' : 'adopted')
          : 'none'
      }

      /** Point the ResizeObserver at `el`, re-pointing when the conversation is
       *  rebuilt (a new session gets a new scroller, and the old element
       *  disconnects rather than resizes). Idempotent, so calling it from every
       *  reposition costs one comparison. */
      function adoptOverlayAnchor(el) {
        if (overlayAnchor === el) return
        if (overlayObserver) { try { overlayObserver.disconnect() } catch (_) {} }
        overlayAnchor = el
        if (typeof ResizeObserver === 'function') {
          if (!overlayObserver) overlayObserver = new ResizeObserver(function () { positionOverlayTrigger() })
          overlayObserver.observe(el)
        }
        syncOverlayState()
      }

      /** Is there still no usable anchor? Deliberately O(1): this runs from a
       *  subtree MutationObserver, which fires continuously while a reply
       *  streams, so it must not search the DOM. `isConnected` is also what
       *  catches a conversation that was replaced rather than resized. */
      function overlayAnchorMissing() {
        return !overlayAnchor || !overlayAnchor.isConnected
      }

      /** Re-attempt acquisition at most once per frame, so a burst of mutations
       *  cannot turn into a burst of layout reads. */
      function scheduleOverlayReanchor() {
        if (overlayReanchorScheduled) return
        overlayReanchorScheduled = true
        var run = function () {
          overlayReanchorScheduled = false
          if (overlayEl) positionOverlayTrigger()
        }
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
        else setTimeout(run, 16)
      }

      /** Bounded re-attempts for the layout-settles case: the conversation can
       *  be in the DOM with no box yet — a zero-size element is not an anchor —
       *  and layout settling mutates nothing, so the watcher stays silent. Gives
       *  up after ~1.4s; the MutationObserver is what covers every later
       *  appearance. */
      function startOverlayAcquisition() {
        if (overlayRetryTimer) { clearTimeout(overlayRetryTimer); overlayRetryTimer = null }
        var tries = 0
        var tick = function () {
          overlayRetryTimer = null
          if (!overlayEl || !overlayAnchorMissing()) return
          positionOverlayTrigger()
          if (overlayAnchorMissing() && ++tries < 8) {
            overlayRetryTimer = setTimeout(tick, 50 * tries)
          }
        }
        tick()
      }

      /** Compute and apply the overlay button's position. Safe to call when
       *  unmounted or when no session is open — it hides instead of throwing,
       *  so every caller can stay unconditional. */
      function positionOverlayTrigger() {
        if (!overlayEl) return
        var vp = conversationViewport()
        if (!vp) {
          // No conversation, no anchor. The other three positions are equally
          // absent with no session open; this one must not invent a fallback,
          // because "the conversation's top-right corner" has no meaning
          // without a conversation.
          overlayEl.style.display = 'none'
          return
        }
        overlayEl.style.display = 'flex'
        adoptOverlayAnchor(vp.el)

        // The button's CURRENT edge length, read from the stored preference
        // rather than from `getBoundingClientRect()`. The rendered box is one
        // frame stale right after a resize style write, and this function runs
        // from the ResizeObserver and from the drag loop, so measuring the DOM
        // here would clamp against the previous size.
        var size = effectiveTriggerSize()

        // Where the button would like to be: inward from the content box's
        // top-right corner by the stored offset.
        var left = vp.contentRight - size - overlayOffset.dx
        var top = vp.rect.top + overlayOffset.dy

        // Give way to the turn rail when it is on screen and on the right: the
        // rail is ~28px wide and sits in the same corner, so without this the
        // two would overlap. `turnRailProbe()` scans every candidate and
        // reports visibility, so a hidden rail (DSH hides the whole slot under
        // a container query, and its height collapses in a short viewport)
        // correctly does not push the button.
        var probe = turnRailProbe()
        if (probe.visible && probe.rails && probe.rails.length) {
          var railLeft = Infinity
          for (var i = 0; i < probe.rails.length; i++) {
            var r = probe.rails[i]
            if (!r.visible) continue
            // Only a rail on the RIGHT competes with this corner.
            if (r.rect.x > vp.rect.left + vp.rect.width / 2 && r.rect.x < railLeft) railLeft = r.rect.x
          }
          if (railLeft !== Infinity) left = Math.min(left, railLeft - size - 8)
        }

        // Clamp inside the viewport's content box, so a drag to (or past) an
        // edge cannot park the button over the scrollbar, under the rail, or
        // off the conversation entirely. Also what saves a stored offset when
        // the viewport later shrinks: the offset is kept, the position is not.
        var minLeft = vp.rect.left
        var maxLeft = vp.contentRight - size
        var minTop = vp.rect.top
        var maxTop = vp.rect.bottom - size
        if (maxLeft < minLeft) maxLeft = minLeft
        if (maxTop < minTop) maxTop = minTop
        left = Math.max(minLeft, Math.min(left, maxLeft))
        top = Math.max(minTop, Math.min(top, maxTop))

        overlayEl.style.left = Math.round(left) + 'px'
        overlayEl.style.top = Math.round(top) + 'px'
        overlayEl.style.right = 'auto'
        overlayEl.style.bottom = 'auto'
      }

      /** Apply the CURRENT size to the mounted overlay button.
       *
       *  The glyph node is REUSED — `width`/`height` are re-set on the existing
       *  <svg> rather than a new icon being built and swapped in, because the
       *  button carries its mousedown/click/mouseenter listeners and replacing
       *  its child would be an unnecessary rebuild of a live element. Resizing
       *  then repositions, since every clamp in positionOverlayTrigger() measures
       *  this box: a 24→64 jump against stale coordinates would leave the button
       *  hanging out of the conversation until the next resize.
       *
       *  Safe to call unmounted or with no session — both are no-ops, matching
       *  positionOverlayTrigger()'s contract so callers stay unconditional. */
      function applyTriggerSize() {
        var size = effectiveTriggerSize()
        _overlayState.size = size
        _overlayState.sizeStored = clampTriggerSize(triggerSize, TRIGGER_SIZE_OVERLAY_MAX)
        _overlayState.sizeRange = { min: TRIGGER_SIZE_MIN, max: triggerSizeMax }
        if (!overlayEl) return
        overlayEl.style.width = size + 'px'
        overlayEl.style.height = size + 'px'
        overlayEl.style.borderRadius = triggerRadius(size) + 'px'
        var icon = overlayEl.firstChild
        if (icon && icon.setAttribute) {
          icon.setAttribute('width', String(triggerIconSize(size)))
          icon.setAttribute('height', String(triggerIconSize(size)))
        }
        positionOverlayTrigger()
        // The panel is anchored to the button (its top is the button's bottom
        // plus a gap), so a growing button must carry the panel with it —
        // otherwise the resize leaves the panel overlapping the larger button.
        if (panelVisible) positionPanel()
      }

      function mountOverlayTrigger() {
        if (overlayEl) return
        var size = effectiveTriggerSize()
        var el = document.createElement('button')
        el.type = 'button'
        el.id = 'dock-flash-overlay-trigger'
        el.setAttribute('data-dock-flash-trigger', '')
        el.setAttribute('aria-label', t('title'))
        el.title = t('title') + ' — ' + t('triggerOverlayDragHint')
        el.style.cssText = [
          'position:fixed',
          'display:none',                    // shown only once an anchor exists
          'align-items:center',
          'justify-content:center',
          'width:' + size + 'px',
          'height:' + size + 'px',
          'padding:0',
          'border:none',
          'border-radius:' + triggerRadius(size) + 'px',
          'cursor:grab',
          'background:transparent',
          'color:var(--dsw-alias-label-primary)',
          'transition:opacity .15s ease, background .15s ease',
          'user-select:none',
          '-webkit-user-select:none',
          'outline:none',
        ].join(';')
        // Layer and opacity go through PROPERTIES, after `cssText`, not inside it.
        // Two reasons: `applyTriggerLayer()` and `paintOverlayOpacity()` are the
        // single writers of these two, and routing the initial value through the
        // same path is what keeps a mount and a later change indistinguishable.
        // (`cssText` also puts them out of reach of the camelCase readers:
        // `style.zIndex` does not see a `z-index:` declaration in some hosts,
        // which made "is the button above the panel?" unanswerable.)
        el.style.zIndex = String(triggerLayerOfButton())
        el.style.opacity = String(overlayOpacity)
        // Real DOM, not `LightningIcon()`: this button is not rendered by React,
        // so a React element here throws and takes `overlayEl` down with it.
        el.appendChild(LightningIconNode(triggerIconSize(size)))
        // Alert badge — imperative DOM, not React. Shows a single badge with
        // total count, colored by the highest active severity level.
        var _severityStyleKey = { critical: 'alertBadgeCritical', error: 'alertBadgeError', warning: 'alertBadgeWarning', info: 'alertBadgeInfo' }
        var _overlayBadge = document.createElement('span')
        // Default style; background will be updated by _paintBadge
        _overlayBadge.style.cssText = Object.entries(S.alertBadge).map(function (pair) {
          return pair[0].replace(/([A-Z])/g, '-$1').toLowerCase() + ':' + pair[1]
        }).join(';')
        _overlayBadge.style.display = 'none'
        el.appendChild(_overlayBadge)
        // Subscribe to the alert registry for badge updates.
        // NOTE: ctx.provide('dockFlashAlerts') runs before mountOverlayTrigger()
        // in apply(), but Cordis service resolution is asynchronous — ctx.get()
        // returns undefined in the same synchronous call stack. Defer the
        // subscription to give Cordis time to resolve the service.
        var _paintBadge = function () {
          var total = _ar ? _ar.alertCount : 0
          if (total > 0) {
            // Find highest severity with active alerts
            var counts = _ar.alertCountsBySeverity
            var highestSev = 'info'
            var _sevOrder = ['info', 'warning', 'error', 'critical']
            for (var i = _sevOrder.length - 1; i >= 0; i--) {
              if ((counts[_sevOrder[i]] || 0) > 0) { highestSev = _sevOrder[i]; break }
            }
            _overlayBadge.style.display = ''
            _overlayBadge.textContent = total > 99 ? '99+' : String(total)
            // Set background color based on highest severity
            var bgStyle = S[_severityStyleKey[highestSev]]
            if (bgStyle && bgStyle.background) {
              _overlayBadge.style.background = bgStyle.background
            }
          } else {
            _overlayBadge.style.display = 'none'
          }
        }
        var _ar = null
        var _badgeRetryCount = 0
        function _trySubscribeBadge() {
          try {
            _ar = ctx.get('dockFlashAlerts')
          } catch (_) {}
          if (_ar) {
            _overlayAlertUnsub = _ar.subscribe(_paintBadge)
            _paintBadge()
          } else if (++_badgeRetryCount < 30) {
            // Retry every 200ms for up to 6 seconds — the service WILL
            // become available once Cordis resolves it.
            setTimeout(_trySubscribeBadge, 200)
          }
        }
        setTimeout(_trySubscribeBadge, 0)
        // Subdued while at rest and solid on approach, because this one floats
        // over the conversation text rather than sitting in a toolbar. How
        // subdued is the user's call (context menu); the SHAPE of the rule is
        // not: hover or an in-progress drag always means solid, and everything
        // else asks `paintOverlayOpacity()` so a drag that ends with the pointer
        // elsewhere cannot strand the button at hover brightness.
        el.addEventListener('mouseenter', function () {
          overlayHovered = true
          el.style.background = 'rgba(127,127,127,0.14)'
          paintOverlayOpacity()
        })
        el.addEventListener('mouseleave', function () {
          overlayHovered = false
          el.style.background = 'transparent'
          paintOverlayOpacity()
        })
        el.addEventListener('mousedown', beginOverlayDrag)
        el.addEventListener('click', function (e) {
          // A drag ends with a click event; swallow that one so dragging the
          // button never toggles the panel. `dragMoved` is the same ±3px test
          // the panel header uses, so the two cannot disagree about what a
          // drag was.
          if (dragMoved) { e.preventDefault(); e.stopPropagation(); return }
          // A plain click toggles the panel, which is the entire point of the
          // button — and the handler used to stop at the line above, so the
          // overlay mounted, positioned itself correctly and did nothing when
          // clicked. `QuickTriggerIconButton` is a React button and gets this
          // from its own onClick; a hand-built element has to do it here.
          // `handleOutsideClick` already exempts `[data-dock-flash-trigger]`,
          // so the closing half of this toggle is not fighting it.
          if (panelVisible) closePanel(); else openPanel()
        })
        document.body.appendChild(el)
        overlayEl = el
        _overlayState.el = el

        positionOverlayTrigger()

        // A1 means the offset is relative to the conversation corner, so the
        // corner moving must move the button. The viewport changes size when
        // the right sidebar opens, the sash is dragged, or the window resizes,
        // and the ResizeObserver `adoptOverlayAnchor()` installs catches all
        // three where a window `resize` listener would miss the two in-app ones.
        //
        // What the observer cannot do is find the corner in the first place,
        // because it is attached to an element that does not exist yet. So
        // acquisition is driven separately, and the watcher is kept for the life
        // of the button rather than disconnected once an anchor is found: a new
        // session builds a NEW scroller, and the old one disconnecting is
        // invisible to a `resize` listener. Only `isConnected` is read per
        // mutation, so the steady-state cost is a property access.
        if (typeof MutationObserver === 'function') {
          overlayAnchorWatch = new MutationObserver(function () {
            if (overlayAnchorMissing()) scheduleOverlayReanchor()
          })
          overlayAnchorWatch.observe(document.body, { childList: true, subtree: true })
        }
        startOverlayAcquisition()
        syncOverlayState()

        window.addEventListener('resize', positionOverlayTrigger)
        el.addEventListener('contextmenu', openOverlayMenu)
      }

      // ═══════════════════════════════════════════════════════════════════════
      // ── Overlay trigger: right-click menu ────────────────────────────────
      // ═══════════════════════════════════════════════════════════════════════
      // Why this menu exists at all, and why it holds only these items:
      //
      //  - **Reset position** is the one real GAP. A draggable element with no
      //    way back has no undo: the only escapes today are editing
      //    `settings.yaml` by hand or clearing localStorage.
      //  - **The offset, the version and the layer** are things no OTHER surface
      //    in the app can answer. The offset is visible nowhere but
      //    `__dockFlashOverlay()`; the version is the first thing to check when
      //    "the fix did not work" (a stale bundle has happened here); the layer
      //    is a property of this floating button alone.
      //  - **Opacity** is the reading preference for an element that sits ON the
      //    text, so it belongs where the element is.
      //
      // What is deliberately NOT here: `trigger-size`, `trigger-position` and
      // `close-on-blur` all live in the panel, and a second control for one
      // setting is how two surfaces start disagreeing (Critical Rule 7). The
      // `trigger-position` item was rejected outright for a second reason: the
      // overlay is not among its options, so choosing one from the overlay's own
      // menu makes the button vanish from under the pointer.
      //
      // The menu is NOT a registry. A third party contributing entries would
      // justify an extension seam; one consumer does not, and this codebase's
      // rule is not to build the seam before the second caller exists.

      /** Diagonal grip glyph, drawn rather than typed: `⠿`-style braille and
       *  emoji-capable dots render at wildly different metrics per font. */
      function menuLabel(text, opts) {
        var row = document.createElement('div')
        row.setAttribute('role', 'menuitem')
        if (opts && opts.disabled) row.setAttribute('aria-disabled', 'true')
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '5px 10px',
          borderRadius: '5px',
          fontSize: '12px',
          lineHeight: '1.4',
          userSelect: 'none',
          cursor: (opts && opts.disabled) ? 'default' : 'pointer',
          color: 'var(--dsw-alias-label-primary, #c9d1d9)',
          opacity: (opts && opts.disabled) ? '0.7' : '1',
          whiteSpace: 'nowrap',
        })
        if (opts && opts.checked !== undefined) {
          var tick = document.createElement('span')
          tick.textContent = opts.checked ? '✓' : ''
          Object.assign(tick.style, {
            width: '12px',
            flex: 'none',
            display: 'inline-flex',
            justifyContent: 'center',
            // A pixel box, not a font-derived one: the tick must not resize the
            // row when it appears (see the glyph-metrics rule).
            fontSize: '11px',
            color: 'var(--dsw-alias-brand-primary, #4a7dff)',
          })
          row.appendChild(tick)
        }
        var label = document.createElement('span')
        label.textContent = text
        Object.assign(label.style, { flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' })
        row.appendChild(label)
        if (opts && opts.hint) {
          var hint = document.createElement('span')
          hint.textContent = opts.hint
          Object.assign(hint.style, {
            flex: 'none',
            fontSize: '11px',
            color: 'var(--dsw-alias-label-secondary, #8b949e)',
          })
          row.appendChild(hint)
        }
        if (!(opts && opts.disabled)) {
          row.addEventListener('mouseenter', function () {
            row.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))'
          })
          row.addEventListener('mouseleave', function () { row.style.background = 'transparent' })
        }
        return row
      }

      function menuSeparator() {
        var sep = document.createElement('div')
        Object.assign(sep.style, {
          height: '1px',
          margin: '4px 6px',
          background: 'var(--dsw-alias-border-l2, rgba(127,127,127,0.25))',
        })
        return sep
      }

      /** Where the menu is allowed to be: inside the viewport, and off the
       *  pointer. The band runs left→right from the trigger, flipped up when the
       *  bottom would overflow — the same shape as `positionPanel()`, because
       *  the button can be dragged into any of the four corners. */
      function positionOverlayMenu(menu, anchorRect) {
        var rect = menu.getBoundingClientRect()
        var maxLeft = window.innerWidth - rect.width - 8
        var maxTop = window.innerHeight - rect.height - 8
        var left = Math.max(8, Math.min(anchorRect.right - rect.width, maxLeft))
        var top = anchorRect.bottom + 4
        if (top + rect.height > window.innerHeight - 8) top = Math.max(8, anchorRect.top - rect.height - 4)
        top = Math.max(8, Math.min(top, Math.max(8, maxTop)))
        menu.style.left = Math.round(left) + 'px'
        menu.style.top = Math.round(top) + 'px'
      }

      function closeOverlayMenu() {
        if (overlayMenuDispose) { try { overlayMenuDispose() } catch (_) {} overlayMenuDispose = null }
        if (overlayMenuEl && overlayMenuEl.parentNode) overlayMenuEl.parentNode.removeChild(overlayMenuEl)
        overlayMenuEl = null
        _overlayState.menuOpen = false
      }

      function openOverlayMenu(e) {
        // Suppress the browser's own menu, and do not let this reach the panel's
        // close-on-blur handler (`[data-dock-flash-trigger]` is already exempt,
        // but stopping here keeps that from depending on the exemption).
        if (e && e.preventDefault) e.preventDefault()
        if (e && e.stopPropagation) e.stopPropagation()
        closeOverlayMenu()

        var anchorRect = overlayEl.getBoundingClientRect()
        var menu = document.createElement('div')
        menu.setAttribute('data-dock-flash-menu', '')
        menu.setAttribute('role', 'menu')
        Object.assign(menu.style, {
          position: 'fixed',
          zIndex: String(layerOfMenu()),
          minWidth: '190px',
          padding: '4px',
          borderRadius: '8px',
          background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
          border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.3))',
          boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '12px',
          color: 'var(--dsw-alias-label-primary, #c9d1d9)',
          boxSizing: 'border-box',
        })

        // 1. Reset position — the gap this menu exists for.
        var reset = menuLabel(t('menuResetPosition'), { hint: String(OVERLAY_EDGE) + ',' + String(OVERLAY_EDGE) })
        reset.addEventListener('click', function () {
          saveOverlayOffset({ dx: OVERLAY_EDGE, dy: OVERLAY_EDGE })
          positionOverlayTrigger()
          closeOverlayMenu()
        })
        menu.appendChild(reset)

        // 2. Current offset — read-only, and the thing item 1 resets.
        menu.appendChild(menuLabel(t('menuOffset') + ': ' + overlayOffset.dx + ', ' + overlayOffset.dy, { disabled: true }))

        menu.appendChild(menuSeparator())

        // 3. Layer — presets measured against DSH's own stacking, not guessed.
        menu.appendChild(menuLabel(t('menuLayer'), { disabled: true }))
        for (var i = 0; i < LAYER_PRESETS.length; i++) {
          ;(function (preset) {
            var row = menuLabel(preset.label, { checked: Math.round(triggerLayer) === preset.value })
            row.style.paddingLeft = '22px'
            row.addEventListener('click', function () {
              saveTriggerLayer(preset.value)
              // Re-open rather than close: this is a multi-choice control, so the
              // tick has to be visible after the click or the choice is blind.
              openOverlayMenu()
            })
            menu.appendChild(row)
          })(LAYER_PRESETS[i])
        }

        // 4. Rest opacity — the reading preference for an element over text.
        menu.appendChild(menuLabel(t('menuOpacity'), { disabled: true }))
        for (var j = 0; j < OPACITY_PRESETS.length; j++) {
          ;(function (preset) {
            var row = menuLabel(preset.label, { checked: Math.abs(overlayOpacity - preset.value) < 0.001 })
            row.style.paddingLeft = '22px'
            row.addEventListener('click', function () {
              saveOverlayOpacity(preset.value)
              openOverlayMenu()
            })
            menu.appendChild(row)
          })(OPACITY_PRESETS[j])
        }

        menu.appendChild(menuSeparator())

        // 5. Version + a copyable diagnostic. A stale bundle and a fix that did
        //    not work look identical from the outside, so this is the one line
        //    worth being able to paste.
        var versionRow = menuLabel(CLIENT_VERSION, { hint: t('menuCopy') })
        versionRow.addEventListener('click', function () {
          var diag = 'dock-flash ' + CLIENT_VERSION +
            ' position=' + currentPosition +
            ' offset=' + overlayOffset.dx + ',' + overlayOffset.dy +
            ' size=' + effectiveTriggerSize() +
            ' layer=' + triggerLayer +
            ' opacity=' + overlayOpacity
          try { navigator.clipboard.writeText(diag) } catch (_) {}
          versionRow.lastChild.textContent = t('menuCopied')
          setTimeout(closeOverlayMenu, 400)
        })
        menu.appendChild(versionRow)

        document.body.appendChild(menu)
        overlayMenuEl = menu
        _overlayState.menuOpen = true
        positionOverlayMenu(menu, anchorRect)

        // Dismissal. Capture phase for the pointer so a click INSIDE the menu is
        // seen before anything closes it, and the button itself is exempt (its
        // own contextmenu handler re-opens, and a left click toggles the panel).
        var onDown = function (ev) {
          // `contains` may be absent in exotic hosts (and in test stubs), and a
          // throw HERE would abort the rest of the handler — which is how a
          // missing `contains` once left `dragging` stuck true and made an
          // unrelated setting look broken. Tolerate its absence.
          var insideMenu = !!(menu.contains && ev.target && menu.contains(ev.target))
          if (insideMenu) return
          if (ev.target === overlayEl) return
          closeOverlayMenu()
        }
        var onKey = function (ev) { if (ev.key === 'Escape') closeOverlayMenu() }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        overlayMenuDispose = function () {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }

      function unmountOverlayTrigger() {
        window.removeEventListener('resize', positionOverlayTrigger)
        closeOverlayMenu()
        if (overlayEl) overlayEl.removeEventListener('contextmenu', openOverlayMenu)
        if (_overlayAlertUnsub) { try { _overlayAlertUnsub() } catch (_) {} _overlayAlertUnsub = null }
        if (overlayAnchorWatch) {
          try { overlayAnchorWatch.disconnect() } catch (_) {}
          overlayAnchorWatch = null
        }
        if (overlayRetryTimer) { clearTimeout(overlayRetryTimer); overlayRetryTimer = null }
        overlayReanchorScheduled = false
        if (overlayObserver) { try { overlayObserver.disconnect() } catch (_) {} overlayObserver = null }
        overlayAnchor = null
        if (overlayEl) {
          overlayEl.removeEventListener('mousedown', beginOverlayDrag)
          if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl)
          overlayEl = null
          _overlayState.el = null
        }
        syncOverlayState()
      }

      /** Start a drag of the overlay button. Uses the shared `dragging` /
       *  `dragSource` / `dragMoved` state so `ensureGlobalListeners()`'s move
       *  and end handlers apply unchanged — that machinery already clamps to
       *  the window and already distinguishes a click from a drag. */
      function beginOverlayDrag(e) {
        if (e.button !== 0) return
        e.preventDefault()               // no text selection while dragging
        ensureGlobalListeners()
        dragging = true
        _overlayState.dragging = true
        dragSource = 'trigger'
        dragMoved = false
        dragStartX = e.clientX
        dragStartY = e.clientY
        if (overlayEl) {
          overlayEl.style.cursor = 'grabbing'
          // A drag is an interaction: solid for its duration, whatever the rest
          // setting says, so the button stays trackable while it moves.
          paintOverlayOpacity()
        }
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
          } else if (dragSource === 'trigger' && overlayEl) {
            // Translate the pointer movement back into the stored offset, which
            // is what makes A1 work: the button is placed from the conversation
            // corner, so dragging it must adjust that relationship, not a pair
            // of absolute coordinates. `positionOverlayTrigger()` then does the
            // clamping and the scrollbar/rail clearance, so a drag that runs
            // past an edge simply stops there instead of needing its own rules.
            var vp = conversationViewport()
            if (vp) {
              var nextDx = overlayOffset.dx - dx
              var nextDy = overlayOffset.dy + dy
              // `dx` is floored at 0 because a negative one would place the
              // button past the right edge, over the scrollbar. `dy` is NOT
              // floored here: dragging above the corner is a legitimate
              // gesture that the clamp below turns into "rest against the top
              // edge", and flooring it here would silently eat the pointer's
              // travel so that dragging back down felt detached.
              overlayOffset = { dx: Math.max(0, nextDx), dy: nextDy }
              positionOverlayTrigger()
            }
            dragStartX = e.clientX
            dragStartY = e.clientY
          }
        }
        handleDragEnd = function () {
          if (!dragging) return
          dragging = false
          _overlayState.dragging = false
          if (dragSource === 'trigger') {
            if (overlayEl) overlayEl.style.cursor = 'grab'
            // Persist only on release, not on every move — a drag is one
            // intent, and writing through the preference bridge per mousemove
            // would be a host round trip per pixel.
            if (dragMoved) saveOverlayOffset(overlayOffset)
            // The drag FORCED solid; releasing must hand brightness back to the
            // rest/hover rule. Without this the button stays at hover brightness
            // whenever the pointer is not over it when the drag ends.
            paintOverlayOpacity()
          }
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

      // ── Mount the trigger if it needs no service ──
      // The overlay reads only the DOM, so it mounts now. Slot-based positions
      // wait for `slots` below.
      applyTrigger(currentPosition)

      // ── Wait for the slots service via ctx.inject ──
      // ctx.inject(['slots'], callback) creates a sub-plugin that waits until
      // the 'slots' service is available, then runs the callback. This works
      // even though dock-flash has inject:[] (no hard dependency on slots).
      ctx.inject(['slots'], function (scope) {
        var slots = scope.slots
        console.log('[dock-flash] standalone mode: slots service available, mounting trigger')

        // ── Inject trigger into a slot by position value ──
        // SLOT POSITIONS ONLY. The overlay is mounted by `applyTrigger()` before
        // this callback runs, so it must not be mounted here as well — one
        // position with two mount paths is how "it mounted twice" and "it never
        // mounted" both become possible.
        function injectTrigger(posValue) {
          var posConfig = TRIGGER_POSITIONS.find(function (p) { return p.value === posValue })
          if (!posConfig || !posConfig.slot) return null

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
        // Skipped when the selected position is the overlay: it was mounted
        // before this callback ran, because it does not need this service.
        slotDispose = isOverlayPosition(currentPosition) ? null : injectTrigger(currentPosition)

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
              // Switch position. `currentPosition` and `_overlayState.position`
              // are both written by applyTrigger(), the single writer.
              saveTriggerPosition(v)
              // Tear down whatever was mounted and bring up the new one. For an
              // overlay target this mounts immediately; for a slot target it
              // clears the overlay and lets the injection below register.
              applyTrigger(v)
              if (!isOverlayPosition(v)) slotDispose = injectTrigger(v)
              // The size ceiling moved with the position, so the new button must
              // be repainted at its clamped size and the slider re-labelled.
              applyTriggerSize()
              registry.notifyChange('dock-flash:trigger-size')
            },
          })

          // ── Register trigger-size switch (standalone Layout group) ──────
          //    Sits beside trigger-position on purpose: the two together say
          //    "where the entry point is, and how big". The slider spans the
          //    OVERLAY ceiling (64) so its track and its printed value always
          //    agree; the ceiling actually in force is applied by getValue and
          //    by setValue's clamp, which is what makes a slot position show 48
          //    and the overlay position show the larger stored value.
          registry.registerSwitch({
            id: 'dock-flash:trigger-size',
            label: L('triggerSize'),
            icon: '📏',
            type: 'slider',
            group: 'layout',
            order: 26,
            min: TRIGGER_SIZE_MIN,
            max: TRIGGER_SIZE_OVERLAY_MAX,
            step: 2,
            formatLabel: function (px) { return px + ' px' },
            getValue: function () { return effectiveTriggerSize() },
            setValue: function (v) {
              // Bounded by the ABSOLUTE ceiling, never by the current position's.
              // Clamping the stored value to `triggerSizeMax` would let a slot
              // position overwrite a larger value the overlay is entitled to: set
              // 64 on the overlay, switch to a slot position, nudge the slider,
              // and the 64 would be permanently replaced by 48. The per-position
              // ceiling belongs to `getValue()` — what is DRAWN and DISPLAYED —
              // which is the whole reason the two are separate readers.
              saveTriggerSize(clampTriggerSize(v, TRIGGER_SIZE_OVERLAY_MAX))
              // Two entry points, two mechanisms. The overlay is a plain DOM
              // element owned by this closure, so it is resized imperatively.
              // The slot button is a React component that recomputes its style
              // during render, so it needs a re-render — and it gets one from the
              // registry subscription below, because `notifyChange` is what the
              // panel and that button both listen to.
              applyTriggerSize()
              registry.notifyChange('dock-flash:trigger-size')
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
      // `remote` and `remote.settings` are typert namespaces, not services:
      // declaring the namespace is what makes it resolve at all, and a plugin
      // that merely `ctx.get()`s it gets nothing back. Measured against
      // @deepseek-ai/dsh-client-ui-settings, which declares exactly this pair
      // (`const inject = ["remote", "remote.settings"]`).
      // Without them, every host-backed preference silently reads as absent.
      inject: ['remote', 'remote.settings'],
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

          // ── 0. Host-backed user preferences ────────────────────────────
          // Remember the context so the module-level writers (panel order,
          // skin, trigger position) can reach the host without threading `ctx`
          // through every render path, then pull the host's values once. Until
          // that promise settles every reader falls back to localStorage, so
          // the panel renders immediately and simply re-renders when the
          // authoritative values arrive.
          _prefCtx = ctx
          // Registering a console hook must never break `apply()`, so these stay
          // wrapped — but they WARN rather than swallowing, because a hook that
          // is silently absent is indistinguishable from a feature that does not
          // work. That is not hypothetical: `overlayProbe` was declared inside
          // another function by mistake, so this line threw `ReferenceError`
          // and the only symptom was a missing global with nothing in the
          // console to explain it. Same shape as Critical Rule 11.
          _exposeHook('__dockFlashPrefs', prefsProbe)
          _exposeHook('__dockFlashOverlay', overlayProbe)
          // Measuring must be as cheap as looking, or it does not happen.
          _exposeHook('__dockFlashOverflow', overflowProbe)
          loadHostPreferences(ctx).then((ok) => {
            if (!ok) return
            // The values just changed underneath the first render. The skin
            // needs no re-apply here: `_getActiveSkinId()` is read while the
            // panel renders, so a notify is enough to re-read it.
            try { registry.notifyChange('dock-flash:system-proxy') } catch (_) {}
            try { registry.notifyChange('dock-flash:skin') } catch (_) {}
            try { registry.notifyChange('dock-flash:trigger-position') } catch (_) {}
          })

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

          // ── 1b. Create & publish the alert registry service ──────────
          const alertRegistry = createAlertRegistry()
          ctx.provide('dockFlashAlerts', alertRegistry)

          // Register built-in alert providers
          const alertProviders = [
            createMemoryAlertProvider(),
            createSessionContextProvider(),
            createHostAlertProvider(),
            createNetworkAlertProvider(),
          ]
          const alertProviderDisposers = alertProviders.map((p) =>
            alertRegistry.registerProvider(p)
          )

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

          // ── DSH turn rail placement (Appearance group) ─────────────────
          //    Moves DSH's right-side 「轮次导航」 timeline to the left gutter.
          //    'appearance' — NOT 'layout': in this plugin `layout` means
          //    dock-flash's own layout (trigger position, close-on-blur), while
          //    this switch rearranges DSH's UI. It is registered here in the
          //    shared path rather than inside mountStandaloneSlotTrigger, so it
          //    exists in both modes.
          //    applyTurnRailLeft() runs at apply() time, i.e. the saved
          //    placement is restored on load rather than on first panel open.
          ctx.effect(() => {
            applyTurnRailLeft()
            // Console hook for the predicate: `__dockFlashTurnRail()` reports
            // {visible, reason, marks, rect, viewport}. The difference between
            // "the rail is gone" and "the rail is there but has no box" is not
            // observable from the panel, and that difference is the whole bug.
            try { window.__dockFlashTurnRail = turnRailProbe } catch (_) {}
            const dispose = registry.registerSwitch({
              id: 'dock-flash:turn-rail-left',
              label: L('turnRailLeft'),
              icon: '↔️',
              type: 'toggle',
              group: 'appearance',
              order: 30,
              // Only offered while DSH's OWN rail is what the user sees: no
              // session / no turns / hidden by the ≤900px container query all
              // mean nothing to move, and a loaded timeline plugin (e.g.
              // dsh-codex-timeline) means the rail on screen is that plugin's
              // surface, which dock-flash must not fight for the same edge.
              visible: () => dshTurnRailVisible(),
              getValue: () => readTurnRailLeft(),
              // Pure state setter: the toggle renderer records the changelog
              // entry and re-renders through _notifyChange() itself
              // (Critical Rule 7).
              setValue: (v) => writeTurnRailLeft(!!v),
            })

            // `visible` is re-evaluated on every render, but DSH changes that
            // DOM without telling us — a session opens or closes, the ≤900px
            // container query flips, a sidebar drag resizes the column — so
            // the condition has to be watched and pushed, or the switch only
            // flips on the next unrelated render.
            //
            // Edge-triggered on purpose: notify only when the boolean changes.
            // A level-triggered notify on every DOM mutation is exactly what
            // once corrupted the dock-base sidebar (see the skin-scan note),
            // and polling cannot inherit that failure mode.
            let railShown = dshTurnRailVisible()
            const railWatch = setInterval(() => {
              const next = dshTurnRailVisible()
              if (next === railShown) return
              railShown = next
              try { registry.notifyChange('dock-flash:turn-rail-left') } catch (_) {}
            }, 1000)

            return () => {
              clearInterval(railWatch)
              dispose()
              try { delete window.__dockFlashTurnRail } catch (_) {}
              try {
                const el = document.getElementById(TURN_RAIL_STYLE_ID)
                if (el) el.remove()
              } catch (_) {}
            }
          }, 'dock-flash: turn-rail-left switch')

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
                    const bhSettings = _remoteSettings(ctx)
                    if (bhSettings && typeof bhSettings.update === 'function') {
                      // A foreign namespace: this plugin has no revision for
                      // it, so `undefined` is passed explicitly to satisfy the
                      // runtime's three-argument check (last write wins).
                      bhSettings.update('wxj-theme-black-hole', { theme: 'off' }, undefined).catch(() => {})
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
          //
          // `timeline` belongs here for a different reason: dsh-codex-timeline
          // matches _skinHint through its `codex` token — a token that exists
          // for an actual Codex-style skin — while it is not a skin at all. It
          // enhances DSH's turn rail in place and injects a
          // `<style data-plugin="dsh-codex-timeline">`, i.e. it looks exactly
          // like a CSS skin to the DOM scan. Keeping it out also protects IT:
          // the switcher deactivates a skin by REMOVING its style element
          // (Critical Rule 2), which would strip the plugin's own stylesheet.
          // Same "another plugin owns the timeline" notion as _timelineOwner().
          //
          // `dsh-skin-market` is the MARKET ITSELF, and it is the reason this
          // entry exists rather than the `skin` token being narrowed: the plugin
          // that reports the installed-skin list was being offered as one of the
          // skins. Its name contains `skin`, so `_isThemeName()` kept it, and
          // `_labelFromId('dsh-skin-market')` strips the `dsh-` prefix and the
          // trailing `-skin` → **"Market"**, which is the entry users saw and
          // nothing happened when they picked it: activating the market is not a
          // visual state, and its own row is `disabled` in the market's registry
          // anyway. Narrowing the `skin` token is NOT the fix — it is what makes
          // every real `<name>-skin` package discoverable — so the market is
          // excluded by name, the same way the timeline plugin is.
          const _skinExclude = /black-hole|theme-manager|dsh-bloom-theme|timeline|dsh-skin-market|dsh-skin-market\/client/i
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

          /**
           * Activation generation for the MARKET path (`_activateThemeViaMarket`).
           *
           * Distinct from `_applySkinGen`, which guards the in-page CSS path: the
           * two are independent mechanisms and sharing one counter would let a CSS
           * activation cancel a market one (or the reverse). Bumped per request so
           * a superseded call can tell that its result no longer describes what the
           * user asked for — it must then neither release the NEWER pending value
           * nor repaint the dropdown with a stale one.
           */
          var _skinActivationGen = 0

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
                  // Reading the list is when classification becomes necessary, so
                  // this is where the (lazily started) fetch is kicked off. Not
                  // awaited: the list renders now, and the fetch's own
                  // `notifyChange` re-runs this function once it has an answer.
                  _loadMarketThemeIndex()
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
                  // The generation is bumped here, at the moment of the click, so
                  // that a SECOND click supersedes this one even if this request is
                  // still in flight — and so a failure arriving late cannot release
                  // a selection the user has since made.
                  _activateThemeViaMarket(v, ++_skinActivationGen)
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
                    // `spec` rides along because the market's second classification
                    // rule is repo-based (`github:owner/repo`), and that can only be
                    // evaluated against the install spec — see
                    // `_isMarketThemePackage`.
                    themes.push({ name, label: _labelFromId(name), state, spec: installed[name] })
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

                  // Start the classification fetch (lazily, from here rather than
                  // from apply()) and re-render once it lands, so the list can drop
                  // packages the market would refuse. Deliberately NOT awaited: the
                  // list is usable immediately and this only refines it.
                  _loadMarketThemeIndex().then(function (idx) {
                    if (idx && !idx.error) {
                      try { registry.notifyChange('dock-flash:skin') } catch (_) {}
                    }
                  })
                })
                .catch(() => { _marketFetchInFlight = false })
            } catch (_) {
              _marketFetchInFlight = false
            }
          }

          // ═══════════════════════════════════════════════════════════════
          // ── Market theme classification ───────────────────────────────
          // ═══════════════════════════════════════════════════════════════
          // The market does NOT accept every installed package as a theme.
          // `/dsh-market/use-skin` refuses anything outside its own theme set:
          //
          //     if (installed[name] === undefined || !themeNames.has(name)) 400
          //                                                 (dshmarket/lib/routes.js:2060)
          //
          // and that set is built from the registry by name or by repo
          // (dshmarket/lib/themes.js:49-68). dock-flash used to decide on its own,
          // with the `_skinHint` NAME heuristic, so a package the market classifies
          // as something else was still offered as a skin — and selecting it got a
          // 400 that nothing handled, leaving the dropdown wedged on a theme that
          // was never activated.
          //
          // `dsh-client-liang-intensity-skin` is that case, measured: the market's
          // own catalog entry for its repo is `name: dsh-liang-skin`, which is not
          // the installed package name, and the installed spec is a plain version
          // (`"0.1.6"`) rather than `github:owner/repo` — so neither rule matches and
          // the market treats it as not-a-theme. (The skin-market catalog separately
          // classifies its package as `interactive`.) The market also INSTALLED it
          // that way: its install path branches on the category and hot-mounts
          // anything that is not a theme (routes.js:4530), which is why
          // `.dsh-market/hot-3.yml` carries this plugin.
          //
          // So classification is delegated to the market rather than guessed from
          // names. That needs `/dsh-market/registry`, which is ~1.1 MB and served
          // with `cache-control: no-store` — the browser will not cache it, so the
          // per-SESSION cache below is what keeps this from costing a megabyte per
          // page load. It is fetched LAZILY (only once a skin list is actually
          // read) and never blocks a render: the list is drawn first and re-drawn
          // when the index lands.

          /** Session-lifetime cache of the derived classification. */
          var _marketThemeIndexKey = 'dock-flash:market-theme-index'
          var _marketThemeIndexTtl = 6 * 60 * 60 * 1000
          /**
           * `null` = never attempted, `{ error }` = attempted and failed,
           * otherwise `{ at, themeNames:Set, themeRepos:Set }`.
           *
           * The failure case is a DELIBERATE pass-through, not a hidden list: see
           * `_isMarketThemePackage`. A registry we could not read tells us nothing
           * about any package, and answering "nothing is a theme" would empty the
           * switcher over a transient network error.
           */
          var _marketThemeIndex = null
          var _marketThemeIndexInFlight = null

          /** `owner/repo` from a GitHub URL, lowercased, or null.
           *
           *  Mirrors the market's own `repoOf()` so the two agree on what "the
           *  same repository" means. Sub-paths (`/tree/main/packages/x`) are
           *  dropped, because the market compares the repository, not the folder. */
          function _repoOf(url) {
            var m = /github\.com\/([^\/#?\s]+)\/([^\/#?\s]+)/i.exec(String(url || ''))
            if (!m) return null
            return (m[1] + '/' + m[2]).replace(/\.git$/i, '').toLowerCase()
          }

          /**
           * The gate every scan phase must pass before listing a plugin.
           *
           * A package that the market KNOWS and classifies as something other than a
           * theme must not be listed, no matter WHICH phase found it. That qualifier
           * matters: this is deliberately NOT "hide anything the market does not
           * list", because a plugin-local CSS skin the market has never heard of must
           * still appear.
           *
           * Why a shared helper rather than one check per phase: the list has FIVE
           * entry paths (managed, `style[data-plugin]`, `style[data-skin-chrome]`,
           * body attributes, and the boot manifest / graph rows). The first version
           * of this fix gated only the market-extra path, so
           * `dsh-client-liang-intensity-skin` — which injects its OWN
           * `<style data-plugin="dsh-client-liang-intensity-skin">` from `apply()`,
           * and is in the boot manifest — kept appearing through the other four.
           * One predicate, called from every phase, is what makes that class of
           * omission impossible; it is the same discipline as Critical Rule 8.
           *
           * Returns true = LIST IT.
           */
          function _skinAllowed(id) {
            var spec = _marketInstalledSpec(id)
            // Not a market-installed package (or the market list never arrived): the
            // market has no opinion, so the phase's own filters decide.
            if (spec === null) return true
            return _isMarketThemePackage(id, spec) !== false
          }

          /** The market's install spec for `id`, or null when it is not installed. */
          function _marketInstalledSpec(id) {
            if (!_marketThemes || !Array.isArray(_marketThemes.themes)) return null
            for (var i = 0; i < _marketThemes.themes.length; i++) {
              var th = _marketThemes.themes[i]
              if (th && th.name === id) return (th.spec === undefined ? '' : th.spec)
            }
            return null
          }

          /**
           * Is `name` a theme by the market's own judgement?
           *
           * Returns `true`/`false` when the index is known, and `'unknown'` when it
           * is not (never fetched, or the fetch failed). Callers must treat
           * `'unknown'` as "keep it": showing a package the market would refuse is a
           * far smaller problem than hiding a real skin because a request timed out.
           */
          function _isMarketThemePackage(name, spec) {
            var idx = _marketThemeIndex
            if (!idx || idx.error || !idx.themeNames) return 'unknown'
            if (idx.themeNames.has(name)) return true
            // The repo rule: an install spec written as `github:owner/repo`, whose
            // repository carries a theme entry under a DIFFERENT name. This is the
            // half that a name-only implementation would silently miss.
            var m = /github:([^#\s]+)/.exec(String(spec || '').toLowerCase())
            if (m && idx.themeRepos && idx.themeRepos.has(m[1])) return true
            return false
          }

          /** Load and derive the market's theme classification; idempotent.
           *
           *  Never rejects and never throws: every exit records a named reason on
           *  `_marketThemeIndex`, so "the list still shows X" can be answered from
           *  the console instead of by guessing. */
          function _loadMarketThemeIndex() {
            if (_marketThemeIndex && !_marketThemeIndex.error) return Promise.resolve(_marketThemeIndex)
            if (_marketThemeIndexInFlight) return _marketThemeIndexInFlight

            // Session cache first: the HTTP response is `no-store`, so this is the
            // only layer that can spare us the megabyte on a later page load.
            try {
              var raw = sessionStorage.getItem(_marketThemeIndexKey)
              if (raw) {
                var cached = JSON.parse(raw)
                if (cached && typeof cached.at === 'number' && Date.now() - cached.at < _marketThemeIndexTtl &&
                    Array.isArray(cached.themeNames) && Array.isArray(cached.themeRepos)) {
                  _marketThemeIndex = {
                    at: cached.at,
                    error: null,
                    themeNames: new Set(cached.themeNames),
                    themeRepos: new Set(cached.themeRepos),
                  }
                  return Promise.resolve(_marketThemeIndex)
                }
              }
            } catch (_) { /* no sessionStorage, or junk in it — just fetch */ }

            var fail = function (reason, detail) {
              _marketThemeIndex = { at: Date.now(), error: reason, detail: detail || null }
              _marketThemeIndexInFlight = null
              console.warn('[dock-flash] market theme classification unavailable — ' + reason +
                (detail ? ': ' + detail : '') +
                ' — every installed package stays listed, which is the safe direction')
              return _marketThemeIndex
            }

            _marketThemeIndexInFlight = (function () {
              try {
                var url = new URL('/dsh-market/registry', document.baseURI).pathname
                return fetch(url, { headers: { accept: 'application/json' } })
                  .then(function (res) {
                    if (!res || !res.ok) return fail('the registry answered ' + (res ? res.status : 'nothing'))
                    return res.json().then(function (body) {
                      var plugins = body && body.registry && body.registry.plugins
                      if (!Array.isArray(plugins)) {
                        return fail('the registry carried no plugin list',
                          'body keys: ' + (body && typeof body === 'object' ? Object.keys(body).join(',') : typeof body))
                      }
                      // Replicates dshmarket/lib/themes.js:49-68. `category` is
                      // declared as a string or an array — pluginCategories() accepts
                      // both, and so must this.
                      var themeEntries = plugins.filter(function (p) {
                        var c = p && (Array.isArray(p.category) ? p.category : [p.category])
                        return c && c.indexOf('theme') !== -1
                      })
                      var themeNames = new Set()
                      var themeRepos = new Set()
                      for (var i = 0; i < themeEntries.length; i++) {
                        var p = themeEntries[i]
                        if (p && typeof p.name === 'string' && p.name) themeNames.add(p.name)
                        var repo = _repoOf(p && (p.url || p.repo))
                        if (repo) themeRepos.add(repo)
                      }
                      _marketThemeIndex = { at: Date.now(), error: null, themeNames: themeNames, themeRepos: themeRepos }
                      _marketThemeIndexInFlight = null
                      try {
                        sessionStorage.setItem(_marketThemeIndexKey, JSON.stringify({
                          at: _marketThemeIndex.at,
                          themeNames: Array.from(themeNames),
                          themeRepos: Array.from(themeRepos),
                        }))
                      } catch (_) { /* quota or disabled — the in-memory copy still serves this page */ }
                      return _marketThemeIndex
                    })
                  })
                  .catch(function (e) { return fail('the registry request failed', String(e && e.message || e)) })
              } catch (e) {
                // `new URL` with no document.baseURI lands here, exactly as it does
                // for the market fetch above — a swallowed throw that used to make
                // "the request never happened" look like "the market said no".
                return Promise.resolve(fail('the registry URL could not be built', String(e && e.message || e)))
              }
            })()
            return _marketThemeIndexInFlight
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
              // The market's own classification is the gate. It is applied HERE,
              // on the market-`installed` candidates only, and NOT inside
              // `_isThemeName()`: a DOM-scanned plugin skin has no catalog entry
              // to classify against, so subjecting it to this would hide it.
              //
              // `'unknown'` (index missing or failed) deliberately falls through,
              // so a registry we could not read costs nothing but the filtering.
              if (_isMarketThemePackage(th.name, th.spec) === false) continue
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
           *
           * FAILURE MUST RELEASE THE SELECTION. The caller sets `_pendingSkinId`
           * optimistically so the dropdown shows the user's click immediately, and
           * `_getActiveSkinId()` returns that pending value while it is set. On the
           * SUCCESS path the page reloads and the pending value is rebuilt from the
           * market; on the FAILURE path nothing used to clear it, so the dropdown
           * stayed wedged on a theme that was never activated — and every later
           * selection appeared not to work, because the wedged value was echoed
           * back over it. That is the whole reported symptom.
           *
           * `gen` is the caller's activation generation: a later click supersedes
           * this one, and a superseded call must not clear the NEWER pending value
           * or repaint the dropdown with a stale one.
           */
          function _activateThemeViaMarket(name, gen) {
            const url = new URL(_marketApiBase + '/use-skin', document.baseURI).pathname
            /** Still the current activation? */
            const current = () => gen === undefined || gen === _skinActivationGen
            /** Give the selection back, so the dropdown shows what is really live. */
            const release = (why) => {
              if (!current()) return false
              _pendingSkinId = null
              console.warn('[dock-flash] the market refused to activate "' + name + '" — ' + why +
                ' — selection released; the dropdown shows the theme that is actually live')
              try { registry.notifyChange('dock-flash:skin') } catch (_) {}
              return false
            }
            return fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name: name }),
            })
              .then((res) => res.json().then((body) => ({ ok: res.ok, body })).catch(() => ({ ok: res.ok, body: null })))
              .then((r) => {
                if (!current()) return false
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
                // The market's own wording is the useful part ("not an installed
                // theme" is precisely the diagnostic for a misclassified package),
                // so it is carried through rather than replaced.
                return release((r.body && r.body.error) || ('HTTP ' + (r.ok ? 200 : 'error')))
              })
              .catch((e) => release(String(e && e.message || e)))
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
           * The install signals a MANAGED skin can be recognised by.
           *
           * Returns the reason string, or null when there is none. THREE things
           * prove installation: the boot manifest, the module graph, or a style
           * tag the plugin itself injected.
           *
           * **`cfg.enabledKey` in localStorage is deliberately NOT on that list,
           * and removing it is the fix for a real report.** That key is a
           * PREFERENCE, and it is one this plugin writes itself
           * (`_syncManagedEnableFlags` → `_toggleManagedSkin`). Treating it as an
           * install signal was therefore circular: dock-flash planted
           * `dsh.ui-mineradio.enabled='false'` on the first market fetch, then
           * read that same key back as proof Mineradio was installed, and offered
           * it in the dropdown on every later load — including on a machine where
           * the plugin had been uninstalled, or had never been installed at all.
           * Nothing can tell "installed but switched off" from "not here" by
           * looking at a leftover preference.
           *
           * `bootIds`/`graphRows` may be passed in by a caller that already built
           * them (the scan does, for its later phases); otherwise they are
           * gathered here, so the rule is stated ONCE for both callers. */
          function _managedInstallSignals() {
            var bootIds = null
            try {
              var boot = window.__DSH_BOOT__
              if (boot && Array.isArray(boot.entries)) {
                bootIds = new Set()
                for (var i = 0; i < boot.entries.length; i++) {
                  var bid = boot.entries[i] && boot.entries[i].id
                  if (typeof bid !== 'string' || !bid) continue
                  bootIds.add(bid)
                  if (bid.endsWith('/client')) bootIds.add(bid.slice(0, -7))
                }
              }
            } catch (_) {}
            var graphRows = null
            try {
              var mod = ctx.get('modules')
              if (mod && mod.graphRows) graphRows = mod.graphRows
            } catch (_) {}
            return { bootIds: bootIds, graphRows: graphRows }
          }

          function _managedInstallReason(id, cfg, signals) {
            var s = signals || _managedInstallSignals()
            var variants = [id, id + '/client']
            var has = function (set) {
              if (!set) return false
              for (var i = 0; i < variants.length; i++) {
                if (set.has(variants[i])) return true
              }
              return false
            }
            if (has(s.bootIds)) return 'boot'
            if (has(s.graphRows)) return 'graphRows'
            try {
              if (cfg.installedSelector && document.querySelector(cfg.installedSelector)) return 'dom'
            } catch (_) {}
            return null
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
              // NEVER write the key for a skin that is not installed. This is the
              // other half of the same bug: writing it planted
              // `dsh.ui-mineradio.enabled` on machines that never had the plugin,
              // and the scan used to read that key back as proof of installation.
              // It is also meaningless on its own — with no plugin loaded, nothing
              // is listening for the flag.
              if (!_managedInstallReason(id, cfg)) continue
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
            //    INSTALLATION is decided by `_managedInstallReason`: the boot
            //    manifest, the module graph, or the plugin's own style tag.
            //    A leftover `enabledKey` in localStorage is deliberately NOT an
            //    install signal any more — that key is a preference dock-flash
            //    writes itself, so trusting it was circular and listed managed
            //    skins that were not installed.
            for (const [id, cfg] of Object.entries(_managedSkins)) {
              // When the market is answering and reports this theme as disabled,
              // the market owns its presentation: skip it here so phase 4's
              // market-extra path supplies the entry WITH its "not enabled"
              // state.  Claiming it here would add it to `seen` and suppress
              // that label.
              if (_marketThemes && _marketThemes.themes.some(
                (th) => th.name === id && th.state === 'disabled')) {
                continue
              }
              if (!_managedInstallReason(id, cfg, { bootIds: _bootIds, graphRows: _graphRows })) continue
              if (!_skinAllowed(id)) continue
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
              if (!_skinAllowed(id)) continue
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
              if (!_skinAllowed(id)) continue
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
              if (!_skinAllowed(pluginId)) continue
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
              if (!_skinAllowed(id)) continue
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
                // Keep the other layers in step so a later scan-only path
                // agrees. This is the market reporting what the user already
                // selected on this machine, so it is safe to write outward —
                // but only when it disagrees, to avoid a host write on every
                // read of a value that has not changed.
                if (!(_hostPrefs && _hostPrefs.activeSkin === live.name)) {
                  savePrefs(_prefCtx, { activeSkin: live.name }, () => {
                    try { localStorage.setItem(_skinStorageKey, live.name) } catch (_) {}
                  })
                }
                return live.name
              }
            }
            // First check the host's stored preference, then localStorage.
            // The host wins once it has answered: it is the copy that survives
            // a different browser, which is the whole point of moving it.
            try {
              const saved = (_hostPrefs && _hostPrefs.activeSkin) || localStorage.getItem(_skinStorageKey)
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
            // Write every layer FIRST so that getValue() returns the new value
            // right away, even during async reactivation: memory and the
            // localStorage cache update synchronously, the host write follows.
            savePrefs(_prefCtx, { activeSkin: canonicalId }, () => {
              try { localStorage.setItem(_skinStorageKey, canonicalId) } catch (_) {}
            })
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

          // ── Custom NO_PROXY validation ─────────────────────────────────
          // The grammar checked here is the one @deepseek-ai/dsh-http-proxy
          // actually matches with (`bypassesProxy`): entries separated by
          // commas or whitespace, `*` bypassing everything, an optional leading
          // `.`/`*.` meaning "this host and every subdomain under it", and an
          // optional `:port` that must equal the URL's port exactly.
          //
          // Two shapes are rejected on purpose instead of being stored:
          //   * CIDR (`10.0.0.0/8`) — the matcher has no CIDR support, so the
          //     entry would sit in the list bypassing nothing at all; the
          //     package's own docs say to rewrite it as a suffix.
          //   * a proxy URL (`http://127.0.0.1:7890`) — this switch owns the
          //     bypass list, not the proxy address, so a pasted URL could only
          //     ever be a dead entry.
          const _NO_PROXY_HOST_RE = /^[a-z0-9]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9_-]*[a-z0-9])?)*\.?$/i
          const _NO_PROXY_IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
          const _NO_PROXY_IPV6_RE = /^[0-9a-f:]+$/i

          /**
           * Validate and normalize a user-entered NO_PROXY list.
           * Returns { ok: true, value } with the normalized comma-separated
           * list, or { ok: false, entry, reason } naming the first bad entry.
           */
          function _normalizeNoProxyList(raw) {
            var entries = String(raw == null ? '' : raw).split(/[,\s]+/).filter(function (e) { return e !== '' })
            if (entries.length === 0) return { ok: false, entry: '', reason: 'empty' }
            var out = []
            for (var i = 0; i < entries.length; i++) {
              var entry = entries[i]
              if (entry === '*') { out.push('*'); continue }
              // A slash means a scheme, a path or CIDR — none of which is a host.
              if (/[/?#@\\]/.test(entry)) return { ok: false, entry: entry, reason: 'chars' }
              var body = entry.replace(/^\*\./, '').replace(/^\./, '')
              var host = body
              var port = null
              if (body.charAt(0) === '[') {
                var bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(body)
                if (!bracketed) return { ok: false, entry: entry, reason: 'host' }
                host = bracketed[1]
                port = bracketed[2] === undefined ? null : bracketed[2]
              } else {
                var first = body.indexOf(':')
                // Exactly one colon → host:port. Two or more → a bare IPv6 address.
                if (first !== -1 && first === body.lastIndexOf(':')) {
                  host = body.slice(0, first)
                  port = body.slice(first + 1)
                }
              }
              if (port !== null) {
                var portNum = /^\d+$/.test(port) ? Number(port) : NaN
                if (!(portNum >= 1 && portNum <= 65535)) return { ok: false, entry: entry, reason: 'port' }
              }
              if (host === '') return { ok: false, entry: entry, reason: 'host' }
              if (host.indexOf(':') !== -1) {
                if (!_NO_PROXY_IPV6_RE.test(host)) return { ok: false, entry: entry, reason: 'host' }
              } else if (_NO_PROXY_IPV4_RE.test(host)) {
                var octets = host.split('.')
                for (var o = 0; o < octets.length; o++) {
                  if (Number(octets[o]) > 255) return { ok: false, entry: entry, reason: 'host' }
                }
              } else if (!_NO_PROXY_HOST_RE.test(host)) {
                return { ok: false, entry: entry, reason: 'host' }
              }
              out.push(entry)
            }
            return { ok: true, value: out.join(',') }
          }

          /** One message shape for every rejection, so the syntax hint is never missed. */
          function _noProxyErrorText(result) {
            if (result.reason === 'empty') return t('proxyCustomEmpty')
            return t('proxyCustomInvalid') + ' "' + result.entry + '"\n' + t('proxyCustomSyntax')
          }

          // ── Test target (v1.0.7) ───────────────────────────────────────
          // The URL used to prove the proxy path works. The presets are generic
          // public endpoints on purpose: the maintainer's real target is an
          // internal host, and shipping that address in this repository leaked
          // internal infrastructure details (private IP + path naming). Users
          // point this at whatever address actually proves their own proxy works.
          const _testUrlKey = 'dock-flash:test-url'
          const TEST_URL_PRESETS = [
            { value: 'google',   url: 'https://www.google.com/generate_204', label: 'Google 204' },
            { value: 'github',   url: 'https://github.com',                  label: 'GitHub' },
            { value: 'deepseek', url: 'https://api.deepseek.com',            label: 'DeepSeek API' },
          ]
          const _getTestUrl = () => {
            try { return localStorage.getItem(_testUrlKey) || '' } catch (_) { return '' }
          }
          const _setTestUrl = (v) => {
            try {
              if (v) localStorage.setItem(_testUrlKey, String(v))
              else localStorage.removeItem(_testUrlKey)
            } catch (_) {}
          }
          /** The URL actually probed: the stored one, else the first preset. */
          const _resolveTestUrl = () => _getTestUrl() || TEST_URL_PRESETS[0].url
          /** Which <select> option represents a stored URL. */
          const _testUrlPresetValue = (url) => {
            for (var i = 0; i < TEST_URL_PRESETS.length; i++) {
              if (TEST_URL_PRESETS[i].url === url) return TEST_URL_PRESETS[i].value
            }
            return url ? 'custom' : TEST_URL_PRESETS[0].value
          }

          // ── Diagnostics log (v1.0.7) ───────────────────────────────────
          // Holds the latest run only, replaced on every test. An append-only
          // buffer was tried first and dropped: the panel is short, and a wall
          // of history buries the run you just asked for. One report is
          // self-contained — at most ~15 lines, since the host caps the redirect
          // chain — so no size cap is needed either. The registry's changelog
          // cannot serve this purpose: it is single-line and expires after 30s.
          var _proxyLog = []
          var _proxyLogMeta = ''
          function _setLog(lines) {
            _proxyLog = lines.slice()
          }
          function _logStamp() {
            var d = new Date()
            var p = function (n) { return (n < 10 ? '0' : '') + n }
            return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
          }
          function _fmtBytes(n) {
            if (typeof n !== 'number') return '?'
            if (n < 1024) return n + ' B'
            if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
            return (n / 1048576).toFixed(2) + ' MB'
          }
          /**
           * Collapse a value onto one line, so one fact is always one log line.
           * Error messages are not single-line in general — a module-resolution
           * failure carries a whole "Require stack" — and letting that through
           * would wreck the block's alignment.
           */
          function _oneLine(v, max) {
            var s = (v === null || v === undefined) ? '' : String(v)
            s = s.replace(/\s+/g, ' ').trim()
            return (max && s.length > max) ? s.slice(0, max) + '…' : s
          }
          /**
           * Turn one /test-connection payload into log lines. Everything the
           * host measured gets a line — the whole point of the refactor is that
           * a failure states *why* (route taken, redirect chain, socket error
           * code) instead of just "failed".
           */
          function _describeTest(data) {
            var out = []
            var proxy = (data && data.proxy) || {}
            out.push('[' + _logStamp() + '] ▶ ' + _oneLine((data && data.url) || '?', 300))
            var bits = [proxy.proxied ? t('logProxied') : t('logDirect')]
            bits.push(proxy.httpProxy
              ? 'HTTP_PROXY=' + _oneLine(proxy.httpProxy, 120)
              : t('logNoHttpProxy'))
            bits.push(t('noProxyHint') + '=' + _oneLine(proxy.noProxy || '(' + t('noProxyNotSet') + ')', 200))
            if (proxy.mode) bits.push(t('systemProxy') + '=' + _oneLine(proxy.mode, 40))
            out.push('  ' + t('logRoute') + ': ' + bits.join(' · '))
            if (proxy.routeError) {
              out.push('  ' + t('logCause') + ': proxyRouteFor — ' + _oneLine(proxy.routeError, 300))
            }

            var hops = (data && data.redirects) || []
            if (hops.length) {
              out.push('  ' + t('logRedirects') + ': ' + hops.length)
              for (var i = 0; i < hops.length; i++) {
                out.push('    ↳ ' + hops[i].hop + ') ' + hops[i].status + ' → ' + _oneLine(hops[i].to, 300))
              }
              if (data.redirectLimitHit) out.push('    ↳ ' + t('logRedirectLimit'))
            }

            if (data && data.ok) {
              out.push('  ' + t('logResponse') + ': ' + data.status +
                (data.statusText ? ' ' + _oneLine(data.statusText, 60) : '') +
                ' · ' + t('logHeaders') + ' ' + data.headersMs + 'ms')
              if (data.contentType) out.push('    content-type: ' + _oneLine(data.contentType, 120))
              if (data.contentLength) out.push('    content-length: ' + _oneLine(data.contentLength, 40))
              out.push('  ' + t('logBody') + ': ' + _fmtBytes(data.bodyBytes) + ' · ' + data.bodyMs + 'ms')
              // Textual bodies are echoed because that is exactly where a
              // corporate proxy's own "blocked" page shows up.
              if (data.bodySnippet) {
                out.push('    ⤷ ' + _oneLine(data.bodySnippet, 200))
              }
              out.push('  ' + t('logTotal') + ': ' + data.elapsedMs + 'ms · ' + t('testSuccess'))
            } else {
              var err = (data && data.error) || {}
              out.push('  ' + t('logFailed') + ': ' + _oneLine(err.name || 'Error', 60) +
                ' — ' + _oneLine(err.message || 'unknown', 300))
              var cause = [err.causeCode, err.causeMessage].filter(Boolean).join(' — ')
              if (cause) out.push('  ' + t('logCause') + ': ' + _oneLine(cause, 300))
              else if (err.causeName) out.push('  ' + t('logCause') + ': ' + _oneLine(err.causeName, 120))
              if (err.code) out.push('  code: ' + _oneLine(err.code, 80))
              if (data && data.finalUrl && data.finalUrl !== data.url) {
                out.push('  ' + t('logFinalUrl') + ': ' + _oneLine(data.finalUrl, 300))
              }
              out.push('  ' + t('logTotal') + ': ' + ((data && data.elapsedMs) || 0) + 'ms · ' + t('testFailed'))
            }
            return out
          }

          // #4: Track the actual NO_PROXY value and proxyMode from the host
          // so we can display them as a subtitle.  null = not yet fetched.
          var _noProxyValue = null
          var _hostProxyMode = null
          var _proxyAvailable = null
          // Whether any proxy variable exists at all. A different question from
          // `_proxyAvailable` ("is the test target routed through a proxy"):
          // "no proxy configured" and "configured, but this URL is deliberately
          // bypassed" must not produce the same hint.
          var _httpProxyValue = null
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
                    if (data.httpProxy !== undefined && data.httpProxy !== _httpProxyValue) {
                      _httpProxyValue = data.httpProxy
                      changed = true
                    }
                    if (data.customNoProxy !== undefined && data.customNoProxy !== _getCustomNoProxy()) {
                      _setCustomNoProxy(data.customNoProxy)
                      changed = true
                    }
                    // The host owns the test target; adopt its value unless we
                    // just wrote one ourselves and it has not processed it yet.
                    var testUrlChanged = false
                    if (typeof data.testUrl === 'string' && data.testUrl &&
                        data.testUrl !== _getTestUrl() && !_suppressHostSync) {
                      _setTestUrl(data.testUrl)
                      changed = true
                      testUrlChanged = true
                    }
                    if (changed) {
                      registry.notifyChange('dock-flash:system-proxy')
                      if (testUrlChanged) registry.notifyChange('dock-flash:test-url')
                    }
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
            // Same accessor the preference bridge uses: `ctx.remote.settings`
            // is the declared-namespace form. This block previously used
            // `ctx.get('remote')` and read `desc.value`, and both were wrong
            // for a typert namespace — so the host's proxyMode/testUrl were
            // never picked up after a refresh.
            const settingsSvc = _remoteSettings(ctx)
            if (settingsSvc && typeof settingsSvc.describe === 'function') {
              settingsSvc.describe().then(function (desc) {
                if (!desc || desc.ok === false) return
                // Same nesting as the preference bridge: the view is
                // desc.value, and the list is view.namespaces.
                var view = desc.value || desc
                var nsList = view && Array.isArray(view.namespaces)
                  ? view.namespaces
                  : (Array.isArray(view) ? view : [])
                if (!nsList.length) return
                var ns = nsList.find(function (n) {
                  // `ns` + `value` are the descriptor's real field names; the
                  // old `namespace`/`resolved` spelling matched nothing, so the
                  // host's values were read as absent and never applied.
                  return (n && (n.ns || n.namespace)) === 'dock-flash'
                })
                var resolvedNs = ns && (ns.value || ns.resolved)
                if (resolvedNs) {
                  var res = resolvedNs
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
                  // Test target is host-owned; adopt it on startup.
                  if (typeof res.testUrl === 'string' && res.testUrl && res.testUrl !== _getTestUrl()) {
                    _setTestUrl(res.testUrl)
                    registry.notifyChange('dock-flash:test-url')
                    console.log('[dock-flash] test-url sync: ' + res.testUrl)
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
                // Only claim the setting has no effect when no proxy variable
                // exists at all. Keying this off `_proxyAvailable` reported a
                // deliberate bypass as a misconfiguration.
                if (!_httpProxyValue) return t('proxyNoProxyEnv')
                return t('proxyScopeHint')
              },
              icon: '🔗',
              type: 'select',
              group: 'system',
              cluster: 'system-proxy',
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
                  var entered = prompt(t('proxyCustomPrompt'), current)
                  if (entered === null) {
                    // User cancelled — revert the <select> back to current mode
                    registry.notifyChange('dock-flash:system-proxy')
                    return
                  }
                  // Validate BEFORE storing: a rejected value must leave both the
                  // mode and the stored list exactly as they were.  What gets
                  // stored is the normalized list, so a paste like
                  // "a.com, b.com  c.com" is written back as "a.com,b.com,c.com".
                  var checked = _normalizeNoProxyList(entered)
                  if (!checked.ok) {
                    alert(_noProxyErrorText(checked))
                    registry.notifyChange('dock-flash:system-proxy')
                    return
                  }
                  var typed = String(entered).trim()
                  if (checked.value !== typed) {
                    console.log('[dock-flash] custom NO_PROXY normalised: "' + typed + '" → "' + checked.value + '"')
                  }
                  _setCustomNoProxy(checked.value)
                }
                _setProxyMode(mode)
                console.log('[dock-flash] proxy mode changed: ' + mode + (_getCustomNoProxy() ? ' (NO_PROXY=' + _getCustomNoProxy() + ')' : ''))
                // Suppress host→local sync until the host confirms the change
                _suppressHostSync = true
                // Communicate proxy preference to the host side.
                try {
                  const proxySettings = _remoteSettings(ctx)
                  if (proxySettings && typeof proxySettings.update === 'function') {
                    // Three arguments, like every other write: the runtime
                    // rejects two with "expected 3 argument(s), got 2".
                    proxySettings.update('dock-flash', {
                      proxyMode: mode,
                      customNoProxy: _getCustomNoProxy(),
                    }, _hostRevision === null ? undefined : _hostRevision).then(function (res) {
                      try { if (res && res.value && typeof res.value.revision === 'number') _hostRevision = res.value.revision } catch (_) {}
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
                if (typeof next.testUrl === 'string' && next.testUrl && next.testUrl !== _getTestUrl()) {
                  _setTestUrl(next.testUrl)
                  registry.notifyChange('dock-flash:test-url')
                  console.log('[dock-flash] test-url sync from settings/updated: ' + next.testUrl)
                }
              }
              // Re-fetch proxy status so the subtitle stays current
              _fetchProxyStatus()
            })
            return off
          }, 'dock-flash: proxy settings sync')

          // v1.0.7: Test target — which URL the connection test probes.
          // Presets keep the common cases one click away; "custom" prompts for
          // the user's own address — typically an internal endpoint, which is
          // precisely the value that must not live in this repository.
          // The preset labels are deliberately static brand names: they read
          // identically in both languages, so they need no i18n function.
          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:test-url',
              label: L('testUrl'),
              // label + select, with the effective address on its own wrapping
              // line beneath (subtitleBlock). That line was removed in 1.0.11 to
              // save height, and its absence was felt exactly where it matters:
              // with `custom` selected the row says only "Custom", so the URL in
              // force — which is the one thing this control configures — was
              // invisible. Inline `subtitle` is not an option here: it shares the
              // row with the select and ellipsizes the address at the part worth
              // reading (the host and path).
              //
              // No `visible` gate and no default fold either: this row is a
              // PERMANENT member of the proxy cluster, shown unless the user folds
              // the cluster away. Gating the membership made the block change shape
              // as a proxy came and went, which is what made it hard to read as one
              // unit and left its saved order unstable.
              type: 'select',
              group: 'system',
              cluster: 'system-proxy',
              order: 51,
              subtitleBlock: true,
              subtitle: () => _resolveTestUrl(),
              options: TEST_URL_PRESETS.map(function (p) {
                return { value: p.value, label: p.label }
              }).concat([{ value: 'custom', label: () => t('proxyCustom') }]),
              getValue: () => _testUrlPresetValue(_getTestUrl()),
              setValue: (v) => {
                var url = null
                if (v === 'custom') {
                  var entered = prompt(t('testUrlPrompt'), _resolveTestUrl())
                  if (entered === null) {
                    // Cancelled — revert the <select> to the stored value
                    registry.notifyChange('dock-flash:test-url')
                    return
                  }
                  url = String(entered).trim()
                  if (!/^https?:\/\//i.test(url)) {
                    alert(t('testUrlInvalid'))
                    registry.notifyChange('dock-flash:test-url')
                    return
                  }
                } else {
                  for (var i = 0; i < TEST_URL_PRESETS.length; i++) {
                    if (TEST_URL_PRESETS[i].value === v) url = TEST_URL_PRESETS[i].url
                  }
                  if (!url) {
                    registry.notifyChange('dock-flash:test-url')
                    return
                  }
                }
                _setTestUrl(url)
                console.log('[dock-flash] test url changed: ' + url)
                // Suppress host→local sync until the host confirms the write
                _suppressHostSync = true
                try {
                  const urlSettings = _remoteSettings(ctx)
                  if (urlSettings && typeof urlSettings.update === 'function') {
                    urlSettings.update('dock-flash', { testUrl: url },
                      _hostRevision === null ? undefined : _hostRevision)
                      .then(function (res) {
                        try { if (res && res.value && typeof res.value.revision === 'number') _hostRevision = res.value.revision } catch (_) {}
                        _suppressHostSync = false
                        _fetchProxyStatus()
                      })
                      .catch(function (err) {
                        console.warn('[dock-flash] failed to sync test url to host:', err)
                        _suppressHostSync = false
                      })
                  } else {
                    _suppressHostSync = false
                  }
                } catch (_) { _suppressHostSync = false }
              },
            })
            return dispose
          }, 'dock-flash: test-url switch')

          // #5 (v1.0.7): Connection test with a persisted diagnostics log.
          // The URL travels in the request body, so the probe always targets
          // what the Test URL switch is currently displaying — no dependency on
          // the settings write having reached the host yet.
          ctx.effect(() => {
            var _testing = false
            const dispose = registry.registerSwitch({
              id: 'dock-flash:test-connection',
              label: L('testConnection'),
              // No icon and no title column: the button carries the wording, so
              // this row is nothing but the button. (The globe was also a
              // near-duplicate of the language row's, one row above in the same
              // group — the same glyph carrying two unrelated meanings.)
              //
              // Permanent cluster member like test-url: the fold, not a
              // visibility gate, is what keeps it out of the way.
              //
              // hideLabel: the button already reads "Test Connection" (and
              // "Testing…" while it runs), so the title column beside it was the
              // same words twice.
              hideLabel: true,
              type: 'action',
              group: 'system',
              cluster: 'system-proxy',
              order: 52,
              actionLabel: () => _testing ? t('testRunning') : t('testConnection'),
              run: () => {
                if (_testing) return
                _testing = true
                var url = _resolveTestUrl()
                // Publish an in-flight report BEFORE the request goes out. The
                // block is `hideWhenEmpty`, so until now it did not exist at all
                // until the response arrived — during the wait (seconds, on a slow
                // or blocked route) the one thing worth seeing, the address being
                // tried, was the one thing missing. The shape matches the line
                // `_describeTest()` opens with, so the final report replaces this
                // without the block appearing to jump.
                _setLog([
                  '[' + _logStamp() + '] ▶ ' + _oneLine(url, 300),
                  '  ' + t('testRunning'),
                ])
                _proxyLogMeta = '⏳ ' + t('testRunning')
                registry.notifyChange('dock-flash:proxy-log')
                registry.notifyChange('dock-flash:test-connection')
                fetch('/plugins/dock-flash/test-connection', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ url: url }),
                })
                  .then(function (r) { return r.json() })
                  .then(function (data) {
                    _testing = false
                    _setLog(_describeTest(data))
                    if (data && data.ok) {
                      _proxyLogMeta = '✅ ' + data.status + ' · ' + data.elapsedMs + 'ms'
                      registry.recordChange({
                        id: 'dock-flash:test-connection',
                        label: t('testConnection'),
                        icon: '✅',
                        oldDisplay: '',
                        newDisplay: t('testSuccess') + ' (' + data.elapsedMs + 'ms)',
                      })
                    } else {
                      var err = (data && data.error) || {}
                      var errMsg = err.causeCode || err.causeMessage || err.message || 'unknown'
                      _proxyLogMeta = '❌ ' + ((data && data.elapsedMs) || 0) + 'ms'
                      registry.recordChange({
                        id: 'dock-flash:test-connection',
                        label: t('testConnection'),
                        icon: '❌',
                        oldDisplay: '',
                        newDisplay: t('testFailed') + ': ' + errMsg,
                      })
                    }
                    registry.notifyChange('dock-flash:proxy-log')
                    registry.notifyChange('dock-flash:test-connection')
                  })
                  .catch(function (e) {
                    _testing = false
                    var msg = _oneLine(e && e.message ? e.message : String(e), 300)
                    // The request never reached the host — log it anyway, so the
                    // log is never silently empty after a failed test.
                    _setLog([
                      '[' + _logStamp() + '] ▶ ' + _oneLine(url, 300),
                      '  ' + t('logFailed') + ': ' + msg,
                    ])
                    _proxyLogMeta = '❌ ' + msg.slice(0, 40)
                    registry.recordChange({
                      id: 'dock-flash:test-connection',
                      label: t('testConnection'),
                      icon: '❌',
                      oldDisplay: '',
                      newDisplay: t('testFailed') + ': ' + msg,
                    })
                    registry.notifyChange('dock-flash:proxy-log')
                    registry.notifyChange('dock-flash:test-connection')
                  })
              },
            })
            return dispose
          }, 'dock-flash: test-connection switch')

          // v1.0.7, reshaped in v1.0.10: Diagnostics log — a read-only
          // multi-line block showing the latest run. Hidden while empty, so the
          // System group stays compact until there is something to report; the
          // test's in-flight report counts as something (see the run() above),
          // so the block appears the moment the button is pressed rather than
          // only once the answer comes back. The registry changelog cannot do
          // this job: it is single-line and expires after 30s.
          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:proxy-log',
              label: L('proxyLog'),
              icon: '📋',
              type: 'log',
              group: 'system',
              cluster: 'system-proxy',
              order: 53,
              getLines: () => _proxyLog,
              getMeta: () => _proxyLogMeta,
              hideWhenEmpty: true,
              clearTitle: () => t('proxyLogClear'),
              onClear: () => {
                _proxyLog.length = 0
                _proxyLogMeta = ''
                registry.notifyChange('dock-flash:proxy-log')
              },
            })
            return dispose
          }, 'dock-flash: proxy-log switch')

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

          // ── System alerts toggle ────────────────────────────────────
          //    Controls whether the alert registry actively polls for
          //    memory / context / network warnings.  Persists the ON/OFF
          //    choice in localStorage so it survives a page refresh.
          const _alertToggleKey = 'dock-flash:system-alerts'
          const _getAlertsOn = () => {
            try { return localStorage.getItem(_alertToggleKey) !== '0' } catch (_) { return true }
          }
          const _setAlertsOn = (v) => {
            try { localStorage.setItem(_alertToggleKey, v ? '1' : '0') } catch (_) {}
          }

          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:system-alerts',
              label: L('systemAlerts'),
              icon: '🔔',
              type: 'toggle',
              group: 'system',
              order: 57,
              getValue: () => _getAlertsOn(),
              setValue: (v) => {
                _setAlertsOn(v)
                if (v) {
                  alertRegistry.start()
                } else {
                  alertRegistry.stop()
                }
                // Notify the panel so the switch re-renders
                registry.notifyChange('dock-flash:system-alerts')
              },
            })
            return dispose
          }, 'dock-flash: system-alerts switch')

          // Auto-start alert registry if the toggle is ON (default)
          if (_getAlertsOn()) {
            alertRegistry.start()
          }

          // Clean up alert providers on context teardown
          ctx.on('dispose', () => {
            alertRegistry.stop()
            alertProviderDisposers.forEach((d) => { if (d) d() })
          })

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
