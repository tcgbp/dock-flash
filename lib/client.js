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
//  #region AlertProviders      — HostAlertProvider (monitor providers live in companion plugins)
//  #region AlertDisplayModes   — Toast, Dropdown display modes
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
    const CLIENT_VERSION = '2.1.0'
    console.log('[dock-flash] client v' + CLIENT_VERSION)
    const React = require('react')
    const { useState, useEffect, useCallback, useRef, Component } = React
    const h = React.createElement
    let ReactDOMClient
    try { ReactDOMClient = require('react-dom/client') } catch (_) { ReactDOMClient = null }
    let ReactDOM
    try { ReactDOM = require('react-dom') } catch (_) { ReactDOM = null }   // createPortal lives on 'react-dom'


    // (The former module-level `_inDockPanel` flag lived here. It existed only to
    // hide the alert display-mode switches while the panel was rendered by
    // dock-base — and that gate was WRONG for the one mode left: the Toast mounts
    // on document.body and keeps running in dock mode, so hiding its switch only
    // removed the user's way to turn it off. The switch is now shown in both
    // modes and the flag has no reader.)
//#endregion ───────────────────────────────────────────────────────────────────

    // ── Monochrome switch/page icon set ──────────────────────────────────────
    //    One stroke style (currentColor, round caps, 1.4px on a 16px grid) so
    //    every quick-control switch and tab reads as a single visual family,
    //    regardless of the emoji a third-party definition might otherwise render
    //    in full colour. `_switchIcon()` renders a known name as an inline SVG;
    //    an unknown name falls back to the raw text. Icons here are geometric
    //    lines, never colour emoji — see AGENTS.md "Common Pitfalls".
    const _ICON_PATHS = {
      // The Workbench tab carries the plugin's OWN controls (appearance / layout / system),
      // so it gets a controls glyph rather than a second lightning bolt. The bolt is the
      // PRODUCT mark — `LIGHTNING_ICON`, used by the sidebar panel header, the activity bar,
      // the Settings card and the floating window — and a section label inside the panel
      // should answer "what is this", not "whose is this". The pair used to be two different
      // bolt drawings (this map's filled 16px one vs the stroked 20px mark), which read as a
      // mistake when they appeared together.
      // Line art, like every other entry here: `_switchIcon` draws each subpath with
      // `fill: none; stroke: currentColor; strokeWidth: 1.4`, so a shape built from THIN
      // FILLED rectangles (a 1.6-unit-tall track) strokes into a mush of overlapping edges.
      // Three tracks with a knob each, as strokes.
      sliders: [
        'M2.5 4.2h11', 'M6.4 2.6h2.4v3.2H6.4z',
        'M2.5 8h11', 'M9.2 6.4h2.4v3.2H9.2z',
        'M2.5 11.8h11', 'M4.4 10.2h2.4v3.2H4.4z',
      ],
      blocks:  ['M3 3h4.2v4.2H3zM8.8 3H13v4.2H8.8zM3 8.8h4.2V13H3zM8.8 8.8H13V13H8.8z'],
      doc:     ['M5 2.5h6l3 3V13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z', 'M11 2.5V5.5h3', 'M6 8h5M6 10.5h5'],
      pin:     ['M8 2.4a4.1 4.1 0 0 0-4.1 4.1c0 3 4.1 7.2 4.1 7.2s4.1-4.2 4.1-7.2A4.1 4.1 0 0 0 8 2.4z', 'M8 8.6a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z'],
      ruler:   ['M2.6 8.4h10.8M4.6 8.4V6.2M7.1 8.4V6.2M9.6 8.4V6.2M12.1 8.4V6.2', 'M3.2 5 13 8h0 0l-9.8 3z'],
      eye:     ['M1.8 8S4.2 3.6 8 3.6 14.2 8 14.2 8 11.8 12.4 8 12.4 1.8 8 1.8 8z', 'M8 9.8A1.8 1.8 0 1 0 8 6.2a1.8 1.8 0 0 0 0 3.6z'],
      rail:    ['M12.5 8H4m2.5 3L4 8l2.5-3'],
      theme:   ['M8 2.2a5.8 5.8 0 1 0 5.8 5.8 4.4 4.4 0 0 1-5.8-5.8z', 'M11.4 3.6l.7.7M13.4 6.4l.9.1M12.9 9.4l.8.4'],
      palette: ['M8 2.4a5.8 5.8 0 1 0 0 11.6c1 0 1.4-.7 1.2-1.4-.3-.9-.1-1.6 1-1.6H12a1.9 1.9 0 0 0 1.9-1.9A5.6 5.6 0 0 0 8 2.4z', 'M5.3 8.2a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8zM8 5.3a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8zM10.8 6.2a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z'],
      expand:  ['M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10'],
      more:    ['M4 8.2a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm4 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm4 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
      bell:    ['M5.5 11.5H2.8l1.6-1.3V7.4a3.6 3.6 0 0 1 7.2 0v2.8l1.6 1.3H10.5', 'M6.6 12.8a1.4 1.4 0 0 0 2.8 0'],
      globe:   ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M2.4 8h11.2', 'M8 2.4c1.3 1.4 2 3.4 2 5.6s-.7 4.2-2 5.6c-1.3-1.4-2-3.4-2-5.6s.7-4.2 2-5.6z'],
      link:    ['M6.6 9.4a2.6 2.6 0 0 0 3.7.1l2-2a2.6 2.6 0 0 0-3.7-3.7L7.9 4.5M9.4 6.6a2.6 2.6 0 0 0-3.7-.1l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7'],
      log:     ['M5 2.5H11l2.5 2.5v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z', 'M11 2.5V5h2.5', 'M5.8 8h4.4M5.8 10.6h4.4'],
      chip:    ['M5.2 5.2h5.6v5.6H5.2zM3 8V6.6M3 9.4V8M13 8V6.6M13 9.4V8M8 3V6.6M6.6 3H8M9.4 3H8M8 13V9.4M6.6 13H8M9.4 13H8'],
      message: ['M2.8 3.6h10.4A1.2 1.2 0 0 1 14.4 4.8v5.2a1.2 1.2 0 0 1-1.2 1.2H7.4l-3.6 2.8V11H3.8A1.2 1.2 0 0 1 2.6 9.8V4.8a1.2 1.2 0 0 1 .2-1.2z'],
      signal:  ['M3.2 11.6a6.8 6.8 0 0 1 9.6 0M5.6 9.2a4.2 4.2 0 0 1 4.8 0M8 6.8c.6 0 1.2.2 1.6.5M8 13a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8z'],
      queue:   ['M2.6 4.6h2.8M2.6 8h2.8M2.6 11.4h2.8M7.6 4.6h5.8M7.6 8h5.8M7.6 11.4h4.4'],
      clock:   ['M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4z', 'M8 5.2V8l2 1.4'],
      shield:  ['M8 2 3 3.8v3.5c0 3.7 2.2 6.1 5 6.7 2.8-.6 5-3 5-6.7V3.8z', 'M6.2 8.1l1.2 1.2 2.4-2.6'],
      bot:     ['M5 7.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z', 'M4.5 6c-1.2 0-2.3-.8-2.6-2M11.5 6c1.2 0 2.3-.8 2.6-2', 'M8 7.5V5.8M4 11.2h.01M12 11.2h-.01'],
      play:    ['M5.5 3.5l7 4.5-7 4.5z'],
      pause:   ['M5.5 3.5h2.2v9H5.5zM8.3 3.5h2.2v9H8.3z'],
      scroll:  ['M5 3.2h6M5 8h6M5 12.8h4', 'M12.4 3.6l1.4 1.4-1.4 1.4M12.4 8l1.4 1.4-1.4 1.4'],
      plus:    ['M8 3.5v9M3.5 8h9'],
    }

    // Renders `icon` as a monochrome inline SVG sized to the switchIcon box.
    // Falls back to the raw text for names it does not know (e.g. a third-party
    // plugin's own glyph), which is exactly the behaviour the row expected.
    function _switchIcon(icon, style) {
      const paths = typeof icon === 'string' ? _ICON_PATHS[icon] : null
      if (!paths) return h('span', { style }, icon)
      return h('span', { style, 'aria-hidden': 'true' },
        h('svg', {
          width: 12, height: 12, viewBox: '0 0 16 16',
          fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
          style: { display: 'block', margin: 'auto', color: 'currentColor' },
        }, paths.map((d, i) =>
          h('path', { key: i, d, stroke: 'currentColor', strokeWidth: 1.4,
            strokeLinecap: 'round', strokeLinejoin: 'round' }),
        )),
      )
    }


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
            h('div', { style: { marginBottom: '6px', color: 'var(--dsw-alias-state-warn-label, #dd8629)' } },
              '⚠ dock-flash render error'),
            h('div', null, String(this.state.error?.message || this.state.error || 'Unknown error')),
            h('button', {
              style: {
                marginTop: '8px',
                padding: '2px 10px',
                fontSize: '11px',
                cursor: 'pointer',
                borderRadius: R.xs,
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
      fullscreen: '全屏',
      recentChange: '最近修改',
      appearanceGroup: '外观',
      layoutGroup: '布局',
      systemGroup: '系统',
      sessionLogDownload: '更多按钮',
      skin: '皮肤',
      // Title of the inline "skin-theme" cluster row: the one label its two
      // dropdowns share (see `renderInlineCluster`).
      skinTheme: '皮肤主题',
      skinDefault: '默认',
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
      turnRailLeft: '时间线靠左',
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
      // alertHostMem* / alertHostGc* keys moved to dsh-flash-mem-mon
      alertHostQueue: '主机推送告警',
      alertToast: '弹窗通知',
      alertDropdown: '点击展开',
      alertNoActiveAlerts: '当前无活跃告警',
      alertClickToView: '点击查看详情',
      alertDetailTitle: '告警详情',
      alertDetailSeverity: '严重程度',
      alertDetailTime: '时间',
      alertDetailSource: '监控项',
      alertDetailDismiss: '关闭',
      alertDetailDelete: '删除该告警',
      alertSevInfo: '信息',
      alertSevWarning: '警告',
      alertSevError: '错误',
      alertSevCritical: '严重',
      alertDetailNoMessage: '无详细描述',
      // Alert threshold settings — cluster heads
      alertMemCluster: '内存监控',
      alertCtxCluster: '上下文监控',
      alertNetCluster: '网络监控',
      // Monitor config button (shared with companion monitor plugins)
      monitorConfig: '配置',

      // Host alert thresholds
      hostAlertQueueCap: '队列容量',
      hostAlertMaxAge: '最大保留时间',
      hostAlertQueueCapDesc: '主机端告警队列的最大条目数，超出后旧条目将被丢弃',
      hostAlertMaxAgeDesc: '主机端告警的最大保留时间（小时），超时后自动清除',
      // Units
      unitPercent: '%',
      unitMs: 'ms',
      unitTokens: 'tokens',
      unitHours: '小时',
      // Missing companion plugins (2.0.0 moved the monitors and the proxy controls out)
      companionsProxyLabel: '系统代理控制',
      companionsMissingLabel: '缺少的配套插件',
      companionsMeta: '未运行 {n} 项',
      companionsStateMissing: '未安装',
      companionsStateIdle: '已安装，但未运行',
      companionsStateUnknown: '状态未知',
      companionsInstallHint: '在 profile 中安装（装完请重启 DSH）：',
      companionsDesktopHint: '此 profile 由 DSH Desktop 独占管理，请用应用内的 Plugins 页面安装。',
      companionsIdleHint: '「已安装，但未运行」表示它的开关没有出现：请在 Plugins 页面确认它是否被停用，或查看控制台里 [dsh-flash-…] 前缀的日志。',
      companionsUnknownHint: '「状态未知」表示读不到 profile 的包清单，因此无法确认是否已安装 —— 若上面这条命令没装过，可以直接执行。',
      compactEnter: '切换到精简模式',
      compactExit: '切换回完整面板',
      companionsCopyAction: '复制安装命令',
      companionsDontShow: '不再提示 —— 之后可在标签栏的 ◉ 可见性模式里重新勾选，把这两行找回来',
      companionsCopied: '已复制',
      companionsCopyFailed: '复制失败 —— 请手动选中上面的命令',
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
      fullscreen: 'Fullscreen',
      recentChange: 'Recent Changes',
      appearanceGroup: 'Appearance',
      layoutGroup: 'Layout',
      systemGroup: 'System',
      sessionLogDownload: 'More Button',
      skin: 'Skin',
      // Title of the inline "skin-theme" cluster row: the one label its two
      // dropdowns share (see `renderInlineCluster`). Names the pair in the order
      // the row draws them — theme first, skin second.
      skinTheme: 'Theme & Skin',
      skinDefault: 'Default',
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
      // alertHostMem* / alertHostGc* keys moved to dsh-flash-mem-mon
      alertHostQueue: 'Host pushed alert',
      alertToast: 'Toast Notification',
      alertDropdown: 'Click Dropdown',
      alertNoActiveAlerts: 'No active alerts',
      alertClickToView: 'Click to view details',
      alertDetailTitle: 'Alert Details',
      alertDetailSeverity: 'Severity',
      alertDetailTime: 'Time',
      alertDetailSource: 'Monitor',
      alertDetailDismiss: 'Close',
      alertDetailDelete: 'Delete this alert',
      alertSevInfo: 'Info',
      alertSevWarning: 'Warning',
      alertSevError: 'Error',
      alertSevCritical: 'Critical',
      alertDetailNoMessage: 'No detailed description',
      // Alert threshold settings — cluster heads
      alertMemCluster: 'Memory Monitor',
      alertCtxCluster: 'Context Monitor',
      alertNetCluster: 'Network Monitor',
      // Monitor config button (shared with companion monitor plugins)
      monitorConfig: 'Configure',
      // Host alert thresholds
      hostAlertQueueCap: 'Queue Capacity',
      hostAlertMaxAge: 'Max Retention',
      hostAlertQueueCapDesc: 'Max entries in the host-side alert queue; oldest are dropped when full',
      hostAlertMaxAgeDesc: 'Max age (hours) for host-side alerts; expired entries are pruned automatically',
      // Units
      unitPercent: '%',
      unitMs: 'ms',
      unitTokens: 'tokens',
      unitHours: 'hours',
      // Missing companion plugins (2.0.0 moved the monitors and the proxy controls out)
      companionsProxyLabel: 'System proxy control',
      companionsMissingLabel: 'Missing companion plugins',
      companionsMeta: '{n} not running',
      companionsStateMissing: 'not installed',
      companionsStateIdle: 'installed, not running',
      companionsStateUnknown: 'state unknown',
      companionsInstallHint: 'Install into the profile (restart DSH afterwards):',
      companionsDesktopHint: 'This profile is managed exclusively by DSH Desktop — install from its in-app Plugins page.',
      companionsIdleHint: '"installed, not running" means its switch never appeared: check whether it is switched off on the Plugins page, or look for [dsh-flash-…] lines in the console.',
      companionsUnknownHint: '"state unknown" means the profile\'s package list could not be read, so whether it is installed cannot be confirmed — if you have never installed it, the command above is safe to run.',
      compactEnter: 'Switch to the compact panel',
      compactExit: 'Switch back to the full panel',
      companionsCopyAction: 'Copy install command',
      companionsDontShow: "Don't show again — bring these rows back later with the ◉ visibility mode in the tab header",
      companionsCopied: 'Copied',
      companionsCopyFailed: 'Copy failed — select the command above manually',
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

    // DSH-style dropdown option plumbing — implemented by <team>.
    // `opt` is one entry from a switch's options[]: may be a string label, an
    // object {value,label}, or an object with a `format` renderer.
    // The canonical dock-flash option shape is `{ value, label }` with `label` a
    // string or `() => string` (see renderSelectSwitch / renderButtonGroupSwitch);
    // `format` is switch-level on slider/number types, NOT per-option — so the
    // `format` branch here is best-effort for other callers, and the real
    // switching key is `opt.value` (option object), never a formatted display.
    function optionLabelFor(opt, value) {
      if (opt && typeof opt.format === 'function') return opt.format(value)
      if (opt && typeof opt.label === 'function') return opt.label()
      if (opt && opt.label !== undefined) return opt.label
      if (opt && opt.label === undefined && 'value' in (opt||{})) return opt.value
      return opt == null ? '' : String(opt)
    }
    function optionValueFor(opt) {
      if (opt && typeof opt === 'object' && 'value' in opt) return opt.value
      return String(opt) // string-label options: value is the string itself
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ── Styling contract / 样式契约 ─────────────────────────────────────
//#region Styles ───────────────────────────────────────────────────────────────
    // Aligned with @deepseek-ai/dsh-client-ui-primitives and dsh-client-ui-theme tokens.
    // Radius: R.xs/sm/md/lg/xl/panel → --dsw-radius-*
    // Elevation: E.soft/panel/prominent → --dsw-elevation-*
    // Colors: --dsw-alias-* tokens (theme-aware, no hardcoded fallbacks needed on DSH ≥0.1.7)
    // All colors MUST go through --dsw-alias-* design tokens (official DSH Web
    // styling contract); literal colors only as fallbacks for hosts predating
    // the alias table. Never write [data-theme] selectors.

    const R = {
      xs: 'var(--dsw-radius-xs, 4px)',
      sm: 'var(--dsw-radius-sm, 8px)',
      md: 'var(--dsw-radius-md, 12px)',
      lg: 'var(--dsw-radius-lg, 16px)',
      xl: 'var(--dsw-radius-xl, 20px)',
      panel: 'var(--dsw-radius-panel, 28px)',
    }
    const E = {
      soft: 'var(--dsw-elevation-soft, 0 0 0 0.5px var(--dsw-alias-border-l4, #0003), 0 4px 16px 0 rgba(0,0,0,.03), 0 0 24px 0 rgba(0,0,0,.03))',
      panel: 'var(--dsw-elevation-panel, 0 0 0 0.5px var(--dsw-alias-border-l4, #0003), 0 3px 8px 0 rgba(0,0,0,.03), 0 0 16px 0 rgba(0,0,0,.02))',
      prominent: 'var(--dsw-elevation-prominent, 0 0 0 0.5px var(--dsw-alias-border-l4, #0003), 0 3px 8px 0 rgba(0,0,0,.04), 0 0 20px 0 rgba(0,0,0,.05))',
    }
    const F = {
      ring: 'var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4176e6))',
      offset: 2,
    }

    // The tab cards' hairline, stated ONCE, and declared by EVERY tab-header style.
    //
    // A tab header SWAPS its style object on the same element (`tabPageHeaderOpen` <-> one of the
    // closed ones), and React diffs style objects KEY BY KEY: a key present in the old object and
    // absent from the new one is written as `''`, and that clears the longhands a `border`
    // shorthand had set. `border` itself is byte-identical in both objects, so React SKIPS
    // re-applying it — nothing puts the edge back. The collapsed header therefore lost its bottom
    // border, and only when it had been open first: rendering collapsed from a fresh mount was
    // always fine, which is why reading the declarations or looking at a static render shows
    // nothing wrong.
    //
    // MEASURED (headless Chrome, 2x, identical markup): the fresh card `top=1px bottom=1px`; the
    // same card reached by open -> collapsed `top=1px bottom=0px`, with no `border-bottom` in its
    // inline style at all. The rule that follows: **two style objects that swap on one element
    // must declare the same keys** — which sharing this constant makes structural rather than a
    // comment.
    const TAB_HAIRLINE = '0.5px solid var(--dsw-alias-border-l4, #0003)'

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
        // Flex column layout: the scrollable body contains per-tab
        // (header + body) groups that scroll together. Only the panel
        // title bar (provided by dock-base or standalone floatingHead)
        // stays fixed above.
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        // Fill the parent container (dock-base sidebar panel, floating window,
        // or standalone reactRoot). Both flex:1 and height:100% are declared
        // because the two parent shapes need different mechanisms:
        //   - Standalone mode: the parent is reactRoot (flex:1, no height),
        //     so flex:1 is what constrains this element.
        //   - Workbench mode: dock-base's panel slot may use a block layout
        //     with a definite height, so height:100% is what constrains it.
        // minHeight:0 allows the flex item to shrink below its content height,
        // which is what gives panelBody a constrained height so overflowY:auto
        // engages. Without it the default min-height:auto means "never smaller
        // than my content" and the body never scrolls.
        flex: '1',
        height: '100%',
        minHeight: '0',
        // Padding lives entirely on S.panelBody now (the single scrollable
        // section that holds alert bar + tab headers + tab bodies).
        padding: '0',
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
      // Scrollable body section: alert bar + per-tab (header + body) groups
      // all scroll together. Only the panel title bar (provided by dock-base
      // or the standalone floatingHead) stays fixed above this area.
      panelBody: {
        flex: '1',
        overflowY: 'auto',
        overflowX: 'hidden',
        // minHeight: 0 allows the flex item to shrink below its content height
        minHeight: '0',
        padding: '8px 6px 12px',
        // DSH-native scrollbar tokens (thin, subtle thumb over layering bg).
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--dsw-alias-scrollbar-bg-l1, #ccc) var(--dsw-alias-bg-layer-2, transparent)',
      },
      // An inline cluster in compact mode keeps its ROWS but not its card: the mode is defined by
      // having no borders, and a bordered box around two dropdowns was the one piece of chrome it
      // still drew. The rows are what carry the meaning here, not the box.
      clusterCardMinimal: {
        border: 'none',
        background: 'transparent',
        padding: '2px 0',
        marginBottom: '4px',
      },
      // The compact panel's body: same scroller, but no visible scrollbar and tighter edges.
      // Hiding the scrollbar is NOT disabling scrolling — the wheel still scrolls, and the rule
      // injected beside the number-input style covers WebKit, where `scrollbar-width` is ignored.
      panelBodyMinimal: {
        flex: '1',
        overflowY: 'auto',
        overflowX: 'hidden',
        minHeight: '0',
        padding: '4px 4px 6px',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      },
      // A tab in compact mode: the glyph IS the tab. Sized as a full-width strip so the whole row
      // stays a comfortable target — the label it lost would otherwise be the only hit area.
      tabChip: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '5px 0',
        marginBottom: '3px',
        cursor: 'pointer',
        userSelect: 'none',
        borderRadius: R.sm,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #666)',
        transition: 'background 0.15s, color 0.15s',
      },
      tabChipOpen: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '5px 0',
        marginBottom: '3px',
        cursor: 'pointer',
        userSelect: 'none',
        borderRadius: R.sm,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #111)',
        transition: 'background 0.15s, color 0.15s',
      },
      // The open tab's body in compact mode: no card at all. The rows sit directly on the panel
      // background, which is what "no borders" has to mean for this to look like one surface
      // rather than a bordered card inside a borderless one.
      tabPageBodyMinimal: {
        padding: '2px 2px 6px',
        background: 'transparent',
      },
      panelCloseBtn: {
        border: 0,
        borderRadius: R.sm,
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
        // `space-between` pushes the two apart but guarantees NOTHING when they meet, so a narrow
        // row put the label hard against the dropdown. MEASURED in a docked panel at 200px before
        // this: the label wrapped to two lines and the gap between it and the select was 0px.
        columnGap: '8px',
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
      // The row's own name. It ellipsizes rather than wrapping, for the same reason
      // `switchSubtitle` does: a squeezed label reading "触发位 / 置" looks broken, while "触发…"
      // with the full text in its `title` is still a name. `minWidth: 0` is what lets a flex item
      // go below its content width instead of pushing into the control beside it.
      switchLabelText: {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        minWidth: 0,
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
        borderRadius: R.xs,
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
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--dsw-alias-scrollbar-bg-l1, #ccc) var(--dsw-alias-bg-layer-2, transparent)',
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
        accentColor: 'var(--dsw-alias-brand-primary, #000)',
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
      // DSH SegmentedControl.module.css: track with bg=interactive-bg-hover,
      // indicator slides under the selected tab (bg-layer-1 + elevation-soft).
      btnGroup: {
        position: 'relative',
        display: 'inline-grid',
        gridAutoFlow: 'column',
        gridAutoColumns: '1fr',
        gap: '2px',
        padding: '4px',
        borderRadius: R.md,
        background: 'var(--dsw-alias-interactive-bg-hover, #2631480f)',
        flexShrink: 0,
      },
      btnGroupIndicator: {
        position: 'absolute',
        top: '4px',
        left: '4px',
        height: 'calc(100% - 8px)',
        border: 0,
        borderRadius: R.sm,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        boxShadow: E.soft,
        transition: 'transform 160ms ease',
        pointerEvents: 'none',
      },
      btn: {
        position: 'relative',
        zIndex: 1,
        height: '28px',
        padding: '0 16px',
        fontSize: '12px',
        lineHeight: '18px',
        fontWeight: 500,
        border: 0,
        borderRadius: R.sm,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #cfd3d6)',
        cursor: 'pointer',
        transition: 'color 120ms ease',
        whiteSpace: 'nowrap',
      },
      btnActive: {
        position: 'relative',
        zIndex: 1,
        height: '28px',
        padding: '0 16px',
        fontSize: '12px',
        lineHeight: '18px',
        fontWeight: 500,
        border: 0,
        borderRadius: R.sm,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #f9fafb)',
        cursor: 'pointer',
        transition: 'color 120ms ease',
        whiteSpace: 'nowrap',
      },
      // DSH Input.module.css: 32px height, 0.5px border, radius-md,
      // bg-layer-1, focus→state-business-primary border.
      selectInput: {
        height: '32px',
        padding: '0 28px 0 10px',
        fontSize: '13px',
        lineHeight: '20px',
        border: '0.5px solid var(--dsw-alias-border-l4, #0003)',
        borderRadius: R.md,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #000)',
        cursor: 'pointer',
        // Same reasoning as the slider: shrinkable, but never below a usable
        // width. `minWidth: 0` is what actually permits shrinking — a flex
        // item's default `min-width: auto` keeps it at content width no matter
        // what `flex-shrink` says.
        flex: '0 1 auto',
        minWidth: 0,
        maxWidth: '150px',
        // Focus feedback comes from the injected `:focus-visible` ring
        // (data-dock-flash-focus) — no unconditional `outline: none` here.
        transition: 'border-color 0.15s',
        // DSH-style dropdown arrow via background image + right padding
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 16 16\' fill=\'none\'%3E%3Cpath d=\'M4 6l4 4 4-4\' stroke=\'%238b949e\' stroke-width=\'1.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        backgroundSize: '12px',
      },
      // ── DSH-style custom dropdown (DSHSelectDropdown) ───────────────────
      // Closed control for a regular switch `select` (32px — same surface as
      // S.selectInput). The chevron is a real <svg> child in a fixed flex-none
      // box rather than a background image, and focus feedback comes from the
      // injected `:focus-visible` ring (data-dock-flash-focus).
      selectButton: {
        height: '32px',
        padding: '0 4px 0 10px',
        fontSize: '13px',
        lineHeight: '20px',
        border: '0.5px solid var(--dsw-alias-border-l4, #0003)',
        borderRadius: R.md,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #000)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        flex: '0 1 auto',
        minWidth: 0,
        maxWidth: '150px',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s, background-color 0.15s',
      },
      // Compact variant for inline filter dropdowns (28px height).
      selectButtonCompact: {
        height: '28px',
        padding: '0 2px 0 8px',
        fontSize: '12px',
        lineHeight: '18px',
        border: '0.5px solid var(--dsw-alias-border-l4, #0003)',
        borderRadius: R.md,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #000)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        flex: '0 1 auto',
        minWidth: 0,
        maxWidth: '130px',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s, background-color 0.15s',
      },
      selectValueText: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: '1 1 auto',
        minWidth: 0,
        textAlign: 'left',
      },
      selectChevron: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '22px',
        height: '100%',
        flex: 'none',
      },
      selectChevronCompact: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '100%',
        flex: 'none',
      },
      // Popover option list — a real React-mangled portal, same surface as the
      // existing dock-flash overlay menus (bg-layer-2 + border-l4 + E.soft).
      selectMenuList: {
        position: 'fixed',
        // Static default for the WORKBENCH panel: it clears S.root (z10) and the
        // host modal (1000). Overridden string per render to `_dropdownZIndex`
        // (raised above the STANDALONE panel's own `triggerLayer`) — see the
        // DSHSelectDropdown region.
        zIndex: '1100',
        minWidth: '144px',
        maxWidth: '240px',
        maxHeight: '280px',
        overflowY: 'auto',
        padding: '4px',
        borderRadius: R.md,
        background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        border: '0.5px solid var(--dsw-alias-border-l4, #0003)',
        boxShadow: E.soft,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary, #000)',
        boxSizing: 'border-box',
        listStyle: 'none',
        margin: 0,
      },
      selectOptionRow: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '5px 10px',
        borderRadius: R.sm,
        fontSize: '13px',
        lineHeight: 1.5,
        userSelect: 'none',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary, #000)',
        width: '100%',
        boxSizing: 'border-box',
      },
      selectOptionTick: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        flex: 'none',
      },
      numberInput: {
        height: '32px',
        padding: '0 8px',
        fontSize: '12px',
        border: '0.5px solid var(--dsw-alias-border-l4, #0003)',
        borderRadius: R.md,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #000)',
        width: '64px',
        minWidth: '48px',
        maxWidth: '80px',
        textAlign: 'right',
        // Focus feedback comes from the injected `:focus-visible` ring
        // (data-dock-flash-focus) — no unconditional `outline: none` here.
        transition: 'border-color 0.15s',
        // Hide the native spin buttons for a cleaner look
        MozAppearance: 'textfield',
        // Hide spin buttons in WebKit (Chrome/Safari)
        // These are applied via the inline style; the pseudo-element
        // selectors cannot be set inline, so we use a CSS class trick
        // via the `webkit-spin` class below.
      },
      numberRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '8px',
        minWidth: 0,
      },
      numberHint: {
        color: 'var(--dsw-alias-label-secondary, #8b949e)',
        fontSize: '11px',
        whiteSpace: 'nowrap',
      },
      // DSH Button.module.css: outline variant (0.5px border-l3) for sm size
      // (28px height, radius-sm). Ghost hover=interactive-bg-hover.
      btnAction: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '28px',
        padding: '0 10px',
        fontSize: '12px',
        lineHeight: '18px',
        border: '0.5px solid var(--dsw-alias-border-l3, #0003)',
        borderRadius: R.sm,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #000)',
        cursor: 'pointer',
        transition: 'background 0.15s',
        whiteSpace: 'nowrap',
      },
      // DSH Switch.module.css: 36×20 track, 2px padding, no border,
      // borderRadius 999px (pill), thumb uses transform not left/top.
      toggle: {
        position: 'relative',
        width: '36px',
        height: '20px',
        padding: '2px',
        border: 0,
        borderRadius: '999px',
        background: 'var(--dsw-alias-border-l3, #0000001f)',
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
        boxSizing: 'border-box',
      },
      toggleOn: {
        position: 'relative',
        width: '36px',
        height: '20px',
        padding: '2px',
        border: 0,
        borderRadius: '999px',
        background: 'var(--dsw-alias-brand-primary, #000)',
        cursor: 'pointer',
        transition: 'background 0.2s',
        flexShrink: 0,
        boxSizing: 'border-box',
      },
      toggleThumb: {
        display: 'block',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-label-primary-foreground, #fff)',
        transition: 'transform 120ms ease',
        transform: 'translateX(0)',
      },
      toggleThumbOn: {
        display: 'block',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-label-primary-foreground, #fff)',
        transition: 'transform 120ms ease',
        transform: 'translateX(16px)',
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
        borderRadius: R.sm,
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
      // Compact mode's two-per-row toggle grid — a real grid, unlike `compactToggleGrid` above,
      // whose name promises one and whose `flexDirection: column` delivers a stack. A lone toggle
      // sits in the left half and keeps its half-row, which is what makes an odd run read as a
      // row that happens to be short rather than as a differently shaped control.
      compactToggleGridTight: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        columnGap: '4px',
        rowGap: '1px',
        alignItems: 'center',
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
        borderRadius: R.md,
        border: '0.5px solid var(--dsw-alias-border-l4, #0003)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        overflow: 'hidden',
      },
      tabPageLast: {
        marginBottom: '0',
        borderRadius: R.md,
        border: '0.5px solid var(--dsw-alias-border-l4, #0003)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        overflow: 'hidden',
      },
      // ── Tab styles (header and body rendered as one card) ──
      // Each tab's header and body are adjacent DOM siblings, so an open tab
      // renders as a single visual card: the header has bottom corners rounded
      // away and the body has top corners rounded away, with no border between.
      //
      // Closed tab: standalone card with all corner radii.
      // Open tab:   header (top radii only) + body (bottom radii only) form
      //             one continuous card.
      tabPageHeaderClosed: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 6px',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.15s',
        borderRadius: R.md,
        border: TAB_HAIRLINE,
        // Declared explicitly even though `border` already covers it: the key must EXIST in this
        // object, because the open style declares it too and React turns a vanished key into ''.
        borderBottom: TAB_HAIRLINE,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        marginBottom: '4px',
      },
      tabPageHeaderClosedLast: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 6px',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.15s',
        borderRadius: R.md,
        border: TAB_HAIRLINE,
        borderBottom: TAB_HAIRLINE,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        marginBottom: '0',
      },
      tabPageHeaderOpen: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '7px 6px',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.15s',
        // Top radii only — the body shares the card below.
        borderRadius: R.md + ' ' + R.md + ' 0 0',
        border: TAB_HAIRLINE,
        borderBottom: 'none',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
      },
      tabPageBodyJoined: {
        padding: '6px 6px 10px',
        // Bottom radii only — the header shares the card above.
        borderRadius: '0 0 ' + R.md + ' ' + R.md,
        border: TAB_HAIRLINE,
        borderTop: 'none',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        marginBottom: '4px',
        animation: 'dockFlashFadeIn 0.2s ease',
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
        borderRadius: R.sm,
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
        borderRadius: R.sm,
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
        borderRadius: R.xs,
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
        borderRadius: R.xs,
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
        borderRadius: R.xs,
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
        borderRadius: R.xs,
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
        borderRadius: R.sm,
        background: 'var(--dsw-alias-bg-layer-3, #1c2128)',
        padding: '4px 8px 2px',
        marginBottom: '6px',
      },
      // The fold row closes the card: a full-width, centred strip, so the hit
      // area is the whole bottom edge of the block rather than the glyph itself.
      // The button below is what has to make that true — see its `width`.
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
      //
      // The HIT AREA is the whole row, not the padded glyph. `width: 100%` is what
      // makes that true, and `boxSizing: border-box` is what keeps it honest: with
      // the default content box the button's own horizontal padding would be added
      // on top of 100% and the strip would overflow the card. `flex: none` alone
      // left the target as small as the glyph plus its padding, which is exactly
      // what was reported as too narrow. The glyph stays centred through the
      // button's own `textAlign`, so the DRAWN control is unchanged — only the
      // area that answers a click grew.
      clusterFoldBtn: {
        font: 'inherit',
        fontSize: '10px',
        lineHeight: '1',
        padding: '3px 0',
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'center',
        borderRadius: R.sm,
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
      // ── Inline cluster ──
      //    The second cluster form: the title on ONE row, the members' controls
      //    on the row BELOW it, right-aligned. No rail and no fold row, because
      //    there is nothing to fold — the card border is what still says "this
      //    is one unit" (see `renderInlineCluster`).
      //
      //    The controls get their own row because sharing the title's row does
      //    not fit: two dropdowns plus a label need ~88px of value text alone
      //    (the state that failed on screen). Dropping them to the next row
      //    trades one row of height for BOTH dropdowns showing their full value,
      //    which is the better deal — a dropdown whose value is truncated cannot
      //    do its job, and the extra 22px of panel is cheap.
      //
      //    Nothing here may let a row overflow. The cells HUG their content
      //    (`flex: 0 1 auto`) and cap it (`maxWidth: 150px`, the same cap
      //    S.selectButton applies); a long skin name then shrinks them instead of
      //    pushing the row wide, and every box on the way down carries
      //    `minWidth: 0`, without which a flex item refuses to shrink below its
      //    content. The dropdowns already ellipsize their own value text
      //    (S.selectValueText) once the box is narrow. **Hugging is also what
      //    makes the row's `flex-end` mean anything** — growing cells fill the
      //    row and leave nothing to align.
      clusterInlineRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minHeight: '22px',
        marginBottom: '2px',
      },
      clusterInlineLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        color: 'var(--dsw-alias-label-primary, #c9d1d9)',
        fontSize: '12px',
        flex: '0 1 auto',
        minWidth: 0,
      },
      clusterInlineTitle: {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      //     The controls' own row, right-aligned: two dropdowns read as a pair.
      //
      //     `justifyContent: 'flex-end'` only bites when the children do NOT
      //     already fill the row, so every cell must stay HUGGING: `flex: 0 1
      //     auto` (natural width, may shrink). The first version used
      //     `flex: 1 1 0%`, which grew both cells until the row was full — no free
      //     space left, so nothing to align, and each dropdown stretched instead
      //     of sitting at its own size. The `maxWidth` belongs on the CELL, not
      //     only on the button inside it: the button caps itself at 150px but the
      //     cell around it would keep growing, and the leftover would show up as
      //     a gap on the wrong side of the control.
      clusterInlineControls: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '6px',
        flex: '1 1 auto',
        minWidth: 0,
        // Two dropdowns and a label do not fit everywhere: at the compact panel's 176px the
        // pair cannot share a line, and squeezing them into slivers hides the value each one
        // exists to show. Wrapping is the answer the values deserve — see `clusterInlineCell`
        // for the minimum that decides it. In a 320px panel the pair still fits on one line, so
        // this changes nothing there.
        flexWrap: 'wrap',
        rowGap: '4px',
      },
      clusterInlineCell: {
        display: 'flex',
        flex: '0 1 auto',
        minWidth: 0,
        maxWidth: '150px',
      },
      // Compact mode's version of the cell, and the difference is the whole wrapping rule.
      //
      // `flex: 0 0 auto` sizes the cell to its CONTENT and never shrinks it, so a short value
      // ("浅色", "默认") produces a short cell and the pair still fits on one line — which is what
      // a hard `minWidth` floor got wrong: it made a cell claim its floor whatever the value was,
      // so two cells were always too wide and the row wrapped even when there was room.
      // `maxWidth: 150px` is the other end: a long value tops out there, two of those exceed the
      // panel, and the row's `flexWrap` puts the second on its own line.
      //
      // MEASURED at 176px with these styles (headless Chrome): short values — 1 row, cells 52px,
      // no overlap; long values — 2 rows, cells 130px each, no overlap.
      clusterInlineCellMinimal: {
        display: 'flex',
        flex: '0 0 auto',
        maxWidth: '150px',
      },
      // A child cluster card rendered inside its parent's expanded body.
      // Indented with a slightly different background to convey nesting.
      clusterChildCard: {
        border: '1px solid var(--dsw-alias-border-l2, #21262d)',
        borderRadius: R.md,
        background: 'var(--dsw-alias-bg-base, #fff)',
        padding: '3px 6px 1px',
        marginBottom: '4px',
        marginLeft: '4px',
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
        borderRadius: R.sm,
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
        fontSize: '10px',
        fontWeight: 600,
        lineHeight: '16px',
        textAlign: 'center',
        padding: '0 4px',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 1,
      },
      alertBadgeCritical: { background: 'var(--dsw-alias-state-error-primary, #ec1313)' },
      alertBadgeError: { background: 'var(--dsw-alias-state-error-primary, #ec1313)' },
      alertBadgeWarning: { background: 'var(--dsw-alias-state-warn-label, #dd8629)' },
      alertBadgeInfo: { background: 'var(--dsw-alias-state-business-primary, #4176e6)' },
      // ── Alert bar (inside panel, above tab content) ────────────────────
      alertBar: {
        marginBottom: '6px',
        borderRadius: R.md,
        overflow: 'hidden',
      },
      alertItem: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        padding: '5px 8px',
        fontSize: '11px',
        lineHeight: '1.4',
        color: 'var(--dsw-alias-label-primary, #0f1115)',
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
      alertItemCount: {
        marginLeft: '4px',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        fontWeight: 600,
        flexShrink: 0,
      },
      monitorConfigBtn: {
        border: '1px solid var(--dsw-alias-border-l1, #0000000a)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        borderRadius: R.xs,
        width: '36px',
        height: '20px',
        padding: 0,
        marginRight: '6px',
        fontSize: '16px',
        lineHeight: 1,
        cursor: 'pointer',
        flexShrink: 0,
      },
      // ── Alert detail modal ──────────────────────────────────────────────
      alertDetailMask: {
        position: 'fixed',
        inset: 0,
        // zIndex is NOT set here — it comes from `layerOfAlertDetail()`, derived
        // from the user's `triggerLayer`. See the alert layer band above. A
        // literal here could be overtaken by a high `triggerLayer`.
        background: 'var(--dsw-alias-bg-mask-1, #0000003d)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      alertDetailModal: {
        background: 'var(--dsw-alias-bg-layer-2, #fff)',
        border: 0,
        borderRadius: R.panel,
        width: '90vw',
        maxWidth: '480px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: E.prominent,
      },
      alertDetailHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '22px 14px 12px 24px',
        borderBottom: '0.5px solid var(--dsw-alias-border-l2, #0003)',
      },
      alertDetailHeadIcon: {
        fontSize: '20px',
        flexShrink: 0,
      },
      alertDetailHeadTitle: {
        flex: 1,
        fontWeight: 500,
        fontSize: '16px',
        lineHeight: '24px',
        color: 'var(--dsw-alias-label-primary, #000)',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      alertDetailHeadClose: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        border: 0,
        borderRadius: R.sm,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        cursor: 'pointer',
        fontSize: '16px',
        padding: 0,
        flexShrink: 0,
      },
      alertDetailBody: {
        flex: 1,
        overflowY: 'auto',
        padding: '14px 16px',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--dsw-alias-scrollbar-bg-l1, #ccc) var(--dsw-alias-bg-layer-2, transparent)',
      },
      alertDetailMessage: {
        fontSize: '13px',
        lineHeight: '1.6',
        color: 'var(--dsw-alias-label-primary, #0f1115)',
        marginBottom: '14px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      alertDetailMeta: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      },
      alertDetailMetaRow: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        fontSize: '12px',
        lineHeight: '1.5',
      },
      alertDetailMetaLabel: {
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        flexShrink: 0,
        minWidth: '72px',
      },
      alertDetailMetaValue: {
        color: 'var(--dsw-alias-label-primary, #0f1115)',
        wordBreak: 'break-all',
      },
      alertDetailLink: {
        color: 'var(--dsw-alias-interactive-primary, #4176e6)',
        cursor: 'pointer',
        textDecoration: 'none',
      },
      alertDetailSevBadge: {
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: R.lg,
        fontSize: '11px',
        fontWeight: 500,
        lineHeight: '18px',
      },
      // DSH uses --dsw-alias-state-* tokens for severity colours.
      alertDetailSevInfo: {
        background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 18%, transparent)',
        color: 'var(--dsw-alias-state-business-primary, #4176e6)',
      },
      alertDetailSevWarning: {
        background: 'color-mix(in srgb, var(--dsw-alias-state-warn-label, #dd8629) 18%, transparent)',
        color: 'var(--dsw-alias-state-warn-label, #dd8629)',
      },
      alertDetailSevError: {
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 18%, transparent)',
        color: 'var(--dsw-alias-state-error-primary, #ec1313)',
      },
      alertDetailSevCritical: {
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 25%, transparent)',
        color: 'var(--dsw-alias-state-error-primary, #ec1313)',
      },
      alertDetailDivider: {
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '0.5px solid var(--dsw-alias-border-l2, #0003)',
      },
      alertDetailExtraTitle: {
        display: 'block',
        fontWeight: 600,
        fontSize: '12px',
        marginBottom: '8px',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
      },
      alertDetailFooter: {
        display: 'flex',
        justifyContent: 'center',
        padding: '10px 16px 14px',
        marginTop: '10px',
        borderTop: '0.5px solid var(--dsw-alias-border-l2, #0003)',
      },
      alertDetailDeleteBtn: {
        border: '1px solid var(--dsw-alias-state-error-primary, #ec1313)',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary, #ec1313)',
        cursor: 'pointer',
        fontSize: '12px',
        padding: '4px 12px',
        borderRadius: '4px',
        lineHeight: '20px',
      },
      alertDismissBtn: {
        border: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
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
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        cursor: 'pointer',
        fontSize: '10px',
        padding: '2px 4px',
      },
      // Severity-tinted backgrounds for alertItem
      alertSeverityInfo: {
        background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 12%, transparent)',
      },
      alertSeverityWarning: {
        background: 'color-mix(in srgb, var(--dsw-alias-state-warn-label, #dd8629) 12%, transparent)',
      },
      alertSeverityError: {
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 12%, transparent)',
      },
      alertSeverityCritical: {
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 20%, transparent)',
        // Subtle pulse border for critical
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 40%, transparent)',
      },
      // ── Toast notification ──────────────────────────────────────────────
      toastContainer: {
        position: 'fixed',
        // zIndex is NOT set here — it comes from `layerOfToast()`, derived from
        // the user's `triggerLayer`. See the alert layer band above.
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        pointerEvents: 'none',
        maxWidth: '300px',
        width: '300px',
      },
      // DSH-style toast: follows the active theme (light surface in light
      // mode, dark in dark mode) via the adaptive alias tokens, radius-lg,
      // --dsw-shadow-lv3, fixed top-center positioning.
      toastCard: {
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        padding: '8px 10px',
        borderRadius: R.lg,
        fontSize: '12px',
        lineHeight: '1.4',
        color: 'var(--dsw-alias-label-primary, #0f1115)',
        background: 'var(--dsw-alias-bg-layer-3, #fff)',
        boxShadow: 'var(--dsw-shadow-lv3, 0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014)',
        borderLeft: '3px solid transparent',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'opacity .3s ease, transform .3s ease',
      },
      // Severity accent uses state-* tokens — the left border colour
      // carries the semantic meaning on the toast surface.
      toastCardCritical: { borderLeftColor: 'var(--dsw-alias-state-error-primary, #ec1313)' },
      toastCardError: { borderLeftColor: 'var(--dsw-alias-state-error-primary, #ec1313)' },
      toastCardWarning: { borderLeftColor: 'var(--dsw-alias-state-warn-label, #dd8629)' },
      toastCardInfo: { borderLeftColor: 'var(--dsw-alias-state-business-primary, #4176e6)' },
      toastIcon: {
        fontSize: '14px',
        flexShrink: 0,
        lineHeight: '1.4',
      },
      toastBody: {
        flex: 1,
        minWidth: 0,
      },
      toastTitle: {
        fontWeight: 600,
        marginBottom: '2px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      toastMessage: {
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      },
      // DSH Toast.module.css close: small radius, hover→interactive-bg-hover.
      toastClose: {
        border: 0,
        borderRadius: R.xs,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        cursor: 'pointer',
        fontSize: '14px',
        lineHeight: 1,
        padding: '0 2px',
        flexShrink: 0,
      },
      toastProgress: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        height: '2px',
        borderRadius: '0 0 0 var(--dsw-radius-sm, 8px)',
        transition: 'width linear',
      },
      // ── Badge click dropdown ────────────────────────────────────────────
      alertDropdown: {
        position: 'fixed',
        // zIndex is NOT set here — it comes from `layerOfAlertDropdown()`,
        // derived from the user's `triggerLayer`. See the alert layer band above.
        width: '260px',
        maxHeight: '280px',
        overflowY: 'auto',
        borderRadius: R.sm,
        background: 'var(--dsw-alias-bg-layer-3, #fff)',
        boxShadow: E.soft,
        border: '1px solid var(--dsw-alias-border-l2, #0000001a)',
        padding: '4px 0',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--dsw-alias-scrollbar-bg-l1, #ccc) var(--dsw-alias-bg-layer-2, transparent)',      },
      alertDropdownItem: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        padding: '6px 10px',
        fontSize: '11px',
        lineHeight: '1.4',
        color: 'var(--dsw-alias-label-primary, #0f1115)',
        cursor: 'pointer',
        transition: 'background .1s ease',
      },
      alertDropdownItemIcon: {
        fontSize: '13px',
        flexShrink: 0,
        lineHeight: '1.4',
      },
      alertDropdownItemText: {
        flex: 1,
        minWidth: 0,
      },
      alertDropdownItemTitle: {
        fontWeight: 600,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      alertDropdownItemMsg: {
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      alertDropdownEmpty: {
        padding: '12px 10px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary, #61666b)',
        textAlign: 'center',
      },
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ── Shared DSH-style dropdown (replaces native <select> elements) ────
    // The portaled list (below) is a direct child of <body>, so its z-index
    // competes with every other body-level overlay. The WORKBENCH panel sits
    // at z-index 10 (S.root), so a fixed 1100 clears it and the host modal
    // (also 1100). But the STANDALONE floating panel is itself a body-level
    // `position:fixed` element at the user's `triggerLayer` (default 1150) —
    // a hardcoded 1100 therefore paints the option rows UNDER the very panel
    // that opened them ("下拉选项都到面板后面去了"). `_dropdownZIndex` is a
    // factory-scope value so the standalone path can raise it above itself
    // (to `layerOfMenu()`) whenever `triggerLayer` changes, while workbench
    // keeps the historical 1100.
    var _dropdownZIndex = 1100
//#region DSHSelectDropdown ────────────────────────────────────────────────────
    // A single React component used by every `type:'select'` switch.
    // It renders a native-look closed <button>
    // (surface copied from S.selectInput) and, when
    // open, a REAL React-mangled portal (`createPortal(list, document.body)`)
    // so the option list is part of the panel's React tree, hooks stay legal,
    // and the tree sits under the panel's PanelErrorBoundary.
    //
    // The label shown is DERIVED from the CURRENT value (`props.value`) plus the
    // options at every render — never from the optimistically-clicked option.
    // That is what makes the cancel path on custom-prompt switches revert cleanly:
    // on cancel the switch's setValue() writes nothing, the registry re-renders,
    // and this label falls back to whatever getValue() returns.
    //
    // Props:
    //   value      — current string value (already resolved via safeGetValue)
    //   options    — resolved option array (array or array-of-functions from
    //                safeGetOptions; entries may be strings or {value,label})
    //   onSelect   — (newValue) where newValue is the string value
    //   compact    — true for inline toolbar filters (28px / 130px max)
    function DSHSelectDropdown(props) {
      var options = props.options || []
      var current = props.value !== undefined ? props.value : ''
      var onSelect = props.onSelect
      var compact = !!props.compact

      var openState = useState(false)
      var open = openState[0]
      var setOpen = openState[1]
      var anchorRef = useRef(null)
      var listRef = useRef(null)
      var posState = useState(null)
      var position = posState[0]
      var setPosition = posState[1]

      function optionFor(value) {
        for (var i = 0; i < options.length; i++) {
          if (optionValueFor(options[i]) === value) return options[i]
        }
        return null
      }
      var selectedOpt = optionFor(current)
      var label = optionLabelFor(selectedOpt, current)

      // Guard for hosts without `document` (the plugin already checks this at
      // the top; this component stays defensive for any other entry path).
      if (typeof document === 'undefined' || !document) return h('button', { type: 'button', style: compact ? S.selectButtonCompact : S.selectButton }, label)

      // Close the popover on outside mousedown (capture) + Escape. Listeners are
      // removed on unmount / close via the effect cleanup. Inside the list we
      // preventDefault() on mousedown so the anchor button never blurs, which
      // keeps clicking an option from being swallowed by a blur-close.
      useEffect(function () {
        if (!open) return undefined
        function onDocDown(ev) {
          var list = listRef.current
          var anchor = anchorRef.current
          var inList = !!(list && list.contains && ev.target && list.contains(ev.target))
          var inAnchor = !!(anchor && anchor.contains && ev.target && anchor.contains(ev.target))
          if (inList || inAnchor) return
          setOpen(false)
        }
        function onKey(ev) { if (ev.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDocDown, true)
        document.addEventListener('keydown', onKey, true)
        return function () {
          document.removeEventListener('mousedown', onDocDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [open])

      // Position the (portaled) list under the closed button once open; flip it
      // up when the bottom would overflow and clamp to the viewport — mirroring
      // the existing positionOverlayMenu() arithmetic in the overlay trigger.
      useEffect(function () {
        if (!open || !anchorRef.current) { setPosition(null); return undefined }
        var timer = null
        function apply() {
          var list = listRef.current
          var anchor = anchorRef.current
          if (!list || !anchor) return false
          var anchorRect = anchor.getBoundingClientRect()
          var listRect = list.getBoundingClientRect()
          var maxLeft = window.innerWidth - listRect.width - 8
          var maxTop = window.innerHeight - listRect.height - 8
          var left = Math.max(8, Math.min(anchorRect.left, maxLeft))
          var top = anchorRect.bottom + 4
          if (top + listRect.height > window.innerHeight - 8) top = Math.max(8, anchorRect.top - listRect.height - 4)
          top = Math.max(8, Math.min(top, Math.max(8, maxTop)))
          setPosition({ left: Math.round(left), top: Math.round(top) })
          return true
        }
        if (!apply()) {
          // The portaled list is not mounted yet (position is still null), so it
          // cannot be measured — lay it in a provisional spot from the anchor to
          // trigger the mount, then poll to refine to the real measured position.
          var anchor = anchorRef.current
          if (anchor) {
            var anchorRect = anchor.getBoundingClientRect()
            var left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 160))
            setPosition({ left: Math.round(left), top: Math.round(anchorRect.bottom + 4) })
          }
          var tries = 0
          timer = window.setInterval(function () {
            tries += 1
            if (apply()) { window.clearInterval(timer); timer = null }
            else if (tries >= 6) { window.clearInterval(timer); timer = null }
          }, 30)
        }
        return function () {
          if (timer !== null) window.clearInterval(timer)
        }
      }, [open])

      function choose(opt) {
        var newVal = optionValueFor(opt)
        if (newVal !== current && onSelect) onSelect(newVal)
        setOpen(false)
      }

      var hoverBg = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))'
      var chevronStyle = compact ? S.selectChevronCompact : S.selectChevron
      var chevron = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none' },
        h('path', {
          d: 'M4 6l4 4 4-4',
          // DSH's native select arrow is label-tertiary (#81858c); matching DSH
          // over the old literal #8b949e, per the review's design note.
          stroke: 'var(--dsw-alias-label-tertiary, #81858c)',
          'stroke-width': 1.5,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      )

      var optionRows = options.map(function (opt) {
        var val = optionValueFor(opt)
        var rowLabel = optionLabelFor(opt, val)
        var isSelected = val === current
        return h('li', {
          key: String(val),
          role: 'option',
          'aria-selected': isSelected,
          title: rowLabel,
          style: Object.assign({}, S.selectOptionRow, isSelected ? { background: hoverBg } : {}),
          onClick: function () { choose(opt) },
          onMouseEnter: function (ev) { ev.currentTarget.style.background = hoverBg },
          onMouseLeave: function (ev) { ev.currentTarget.style.background = isSelected ? hoverBg : 'transparent' },
        },
          h('span', { style: S.selectOptionTick }, isSelected ? '✓' : null),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: 0 } }, rowLabel)
        )
      })

      var portal = null
      if (open && position && ReactDOM && ReactDOM.createPortal) {
        portal = ReactDOM.createPortal(
          h('ul', {
            ref: listRef,
            role: 'listbox',
            // Mark this portaled list so the panel's close-on-blur handlers can
            // tell "clicked an open dropdown option" (part of the panel) from
            // "clicked away" — without this the list is a body sibling the
            // standalone outside-click logic does not know about, and choosing
            // an option mousedowns outside the panel, closing the whole panel.
            'data-dock-flash-dropdown': '',
            style: Object.assign({}, S.selectMenuList, { zIndex: String(_dropdownZIndex), left: position.left + 'px', top: position.top + 'px' }),
            onMouseDown: function (ev) { if (ev && ev.preventDefault) ev.preventDefault() },
          }, optionRows),
          document.body
        )
      }

      // `display: flex` + `minWidth: 0`, NOT `inline-block`. MEASURED at the compact panel's
      // 176px with two long values: as an inline-block the wrapper kept its own content width
      // while its cell shrank underneath it, so the two dropdowns drew over each other by
      // 52px (button A 13..143, button B 91..221). An inline-block is shrink-to-fit and does not
      // follow a shrinking parent; a flex box here passes the width down, so the value text
      // ellipsizes inside its own button instead of spilling over the next one.
      return h('div', { style: { display: 'flex', flex: '0 1 auto', minWidth: 0, position: 'relative' } },
        h('button', {
          ref: anchorRef,
          type: 'button',
          'data-dock-flash-focus': '',
          style: compact ? S.selectButtonCompact : S.selectButton,
          // `title` defaults to the selected option, which is all a LONE
          // dropdown needs to say. Two side by side have to name themselves
          // instead — the row's title says what the pair is, never which half is
          // which — so the inline cluster passes its own (see `selectControl`).
          title: props.title !== undefined ? props.title : label,
          'aria-label': props.ariaLabel !== undefined ? props.ariaLabel : undefined,
          onMouseEnter: function (ev) { ev.currentTarget.style.background = hoverBg },
          onMouseLeave: function (ev) { ev.currentTarget.style.background = '' },
          onKeyDown: function (ev) {
            if (ev.key === 'Escape') setOpen(false)
            // Enter/Space toggle open natively on a <button>.
            if ((ev.key === 'Enter' || ev.key === ' ') && !open) { ev.preventDefault(); setOpen(true) }
          },
          onClick: function () { setOpen(!open) },
        },
          h('span', { style: S.selectValueText }, label),
          h('span', { style: chevronStyle }, chevron)
        ),
        portal
      )
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ── SVG icon for the activity bar (lightning bolt ⚡) ────────────────
//#region StaticAssets ─────────────────────────────────────────────────────────
    // Compact-panel geometry, stated once: the React half decides what to draw, the container
    // decides how wide it is, and a literal in each is how the two would disagree.
    const COMPACT_PANEL_WIDTH = '176px'
    const COMPACT_PANEL_SHADOW = '0 4px 16px 0 rgba(0,0,0,.10)'

    const LIGHTNING_ICON = {
      path: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
      stroke: true,
      size: 20,
    }

    // ── Icon for the header close-on-blur toggle ─────────────────────────
    //    A panel outline with a pointer leaving it: "click away → closes".
    //    pointer-events:none so a click's event.target is always the button
    //    itself, which the standalone header's drag guard compares against.
    // ── Icon for the header compact-mode toggle ──────────────────────────
    //    Rows of unequal length: the dense block of controls this mode draws. ONE glyph for both
    //    states, exactly like the close-on-blur toggle beside it — the button's background and
    //    opacity say which state it is in, and its `title` names what pressing it does.
    const COMPACT_ICON_SVG =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;pointer-events:none">' +
      '<path d="M2.5 4.6h11M4.6 8h6.8M2.5 11.4h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
      '</svg>'

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

    // ── Inject focus-visible rings for interactive elements ─────────────
    // Inline styles cannot express `:focus-visible`, so every interactive
    // control carries a `data-dock-flash-focus` attribute and a single,
    // one-time <style> block turns that attribute into DSH's native focus
    // ring (--dsw-focus-ring-width solid --dsw-focus-ring-color). The
    // attribute-only list lives above (toggle, slider, select, buttongroup,
    // action, close buttons); this rule is what actually paints it.
    function injectFocusStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById('dock-flash-focus-styles')) return
      const _s = document.createElement('style')
      _s.id = 'dock-flash-focus-styles'
      _s.textContent = [
        '[data-dock-flash-focus]:focus-visible {',
        '  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4176e6));',
        '  outline-offset: 2px;',
        '}',
      ].join('\n')
      document.head.appendChild(_s)
    }
    injectFocusStyles()

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
    //    mark button inside it is horizontally anchored, the dash is
    //    `::before{right:0}`, and the hover preview opens toward
    //    `right:calc(100% + 10px)`. Flip one and the rail looks lopsided or
    //    the preview card lands off-screen.
    //
    //    **The frame's offset is MIRRORED from DSH, never computed here.** The
    //    old code reused DSH 0.1.5's own expression
    //    (`calc(12px - (var(--dsh-composer-side-clearance) + 16px))`), which was
    //    correct only for the slot layout of that version; 0.1.7 restructured
    //    that slot and the expression became a -20px offset that hid the whole
    //    rail off the left edge. `_railNativeRight()` reads whatever DSH
    //    currently declares, so the mirror survives the restructure and the
    //    next one.
    const TURN_RAIL_LEFT_KEY = 'dock-flash:turn-rail-left'
    const TURN_RAIL_STYLE_ID = 'dock-flash-turn-rail'

    /** DSH's OWN `right` for the rail, read from the stylesheet it ships.
     *
     *  The mirror has to come from here rather than from a formula of our own,
     *  because that declaration encodes the geometry of the slot the rail sits
     *  in — and **DSH restructured that slot in 0.1.7**:
     *
     *    - 0.1.5: `._slot` was `position:sticky`, in flow, so it was inset by
     *      its parent's `padding: 16px calc(var(--dsh-composer-side-clearance) + 16px)`;
     *      the rail's own `right` was `calc(12px - (clearance + 16px))` to cancel
     *      that inset. Mirroring the same expression put `left` 12px from the
     *      real edge, which is why this switch worked.
     *    - 0.1.7: the slot is `position:absolute; left:0; right:0;
     *      padding-inline:calc(clearance + 16px)`. An absolutely positioned
     *      child is placed against its containing block's padding BOX, which the
     *      slot's own padding does NOT inset — so the rail's `right` became a
     *      plain `12px`, and the old compensation evaluated to
     *      `calc(12px - 32px)` = **-20px**. The 28px rail, and every dash on it
     *      (drawn from `left:0`), sat off the left edge: present, correct and
     *      invisible.
     *
     *  Mirroring DSH's own value is right on both layouts, right for the
     *  `[data-conversation-scroll]` variant (same declaration), and right for
     *  the next restructure. Returns the cached value once found, or null while
     *  DSH's sheet has not loaded yet so the caller can fall back. */
    let _railRightCache = null
    function _railNativeRight() {
      if (_railRightCache !== null) return _railRightCache
      try {
        const sheets = document.styleSheets
        for (let s = 0; s < sheets.length; s++) {
          let rules = null
          try { rules = sheets[s].cssRules } catch (_) { continue }
          if (!rules) continue
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r]
            if (!rule || typeof rule.selectorText !== 'string' || !rule.style) continue
            // DSH's own rule is the bare class selector, `.eGxaPq_frame`.
            if (!/^\.[A-Za-z0-9_-]+_frame$/.test(rule.selectorText)) continue
            const right = rule.style.getPropertyValue('right')
            if (right) {
              _railRightCache = String(right).trim()
              return _railRightCache
            }
          }
        }
      } catch (_) {}
      return null
    }

    /** The mirrored declarations, built from DSH's own anchoring. */
    function _turnRailLeftCss() {
      const right = _railNativeRight() || '12px'
      return [
        // The frame — the one declaration that decides whether the rail is on
        // screen at all.
        'nav[class*="_frame"]{right:auto!important;left:' + right + '!important}',
        // Mark button — pins BOTH edges. 0.1.7 already ships `left:0;right:0`,
        // so this is a no-op there. 0.1.5 ships `inset:0 0 0 auto` + width:20px,
        // where `left:0` wins over the still-present `right:0` (an over-constrained
        // box drops `right` in LTR) and mirrors it. The old `inset:0 auto 0 0`
        // instead collapsed this button's width to zero on 0.1.7, taking its
        // click target with it.
        'nav[class*="_frame"] button[class*="_mark"]{left:0!important;right:0!important}',
        // Dash — move the anchor AND the transform origin. 0.1.7 sizes the dash
        // with `transform:scaleX()` about `transform-origin:100%`, so a mirrored
        // dash keeping that origin grows the wrong way. 0.1.5 has no transform
        // here, where the extra declaration is inert.
        'nav[class*="_frame"] button[class*="_mark"]::before{right:auto!important;left:0!important;transform-origin:0!important}',
        // Hover preview — opens away from the rail. `right:calc(100% + 10px)` in
        // BOTH versions, so this half of the mirror is fixed.
        'nav[class*="_frame"] div[class$="_preview"]{right:auto!important;left:calc(100% + 10px)!important}',
      ].join('')
    }

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
     *  (Critical Rule 2). Re-writes the text only when the mirror actually
     *  changed, so the per-second retry below costs no style recalc. */
    function applyTurnRailLeft() {
      try {
        const el = document.getElementById(TURN_RAIL_STYLE_ID)
        if (!readTurnRailLeft()) {
          if (el) el.remove()
          return
        }
        const css = _turnRailLeftCss()
        if (!el) {
          const tag = document.createElement('style')
          tag.id = TURN_RAIL_STYLE_ID
          tag.textContent = css
          document.head.appendChild(tag)
          return
        }
        if (el.textContent !== css) el.textContent = css
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
    // cleared cache or another machine lost them. They now live in the host
    // settings namespace with localStorage demoted to a cache.
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
    /** Reference to the alert registry, set in apply(). */
    var _alertRegistryRef = null

    /** Reference to the Cordis context, set in apply(). Used by _navigateToAlertProvider. */
    var _applyCtx = null

    /** Navigation target: when the panel is not yet mounted, the navigation
     *  signal is stored here and picked up on the component's first render.
     *  When the panel IS already mounted, a DOM CustomEvent carries the signal
     *  immediately.  Both paths are needed because a module-level variable
     *  cannot wake a mounted component (no re-render), and a DOM event cannot
     *  reach an unmounted one (no listener). */
    var _pendingNavTarget = null

    /** Monotonic counter for navigation dedup.  Each call to
     *  _navigateToAlertProvider increments this; both the mount-time check and
     *  the event handler record which seq they last processed, so whichever
     *  fires first consumes the navigation and the second is a no-op. */
    var _navSeq = 0

    /** Standalone-mode panel opener, set by mountStandaloneSlotTrigger.
     *  Unlike triggerEl.click() this is open-only — a no-op when the panel
     *  is already visible, so navigation never accidentally closes it. */
    var _standaloneOpenPanel = null

    /** Provider-id → switch id mapping for navigating from alert detail to panel config. */
    var _PROVIDER_SWITCH_MAP = {
      'dsh-flash-ctx-mon:context-alert': 'dsh-flash-ctx-mon:monitor-context',
      'dock-flash:host-alert': 'dock-flash:host-alert-queue-cap',
      'dsh-flash-mem-mon:host-memory-alert': 'dsh-flash-mem-mon:monitor-memory',
      'dsh-flash-net-mon:network-alert': 'dsh-flash-net-mon:monitor-network',
      'dsh-flash-net-mon:network-audit': 'dsh-flash-net-mon:monitor-network',
    }

    /** Open the QuickControl panel and navigate to the switch associated with the
     *  given alert provider. Works in both workbench and standalone modes.
     *
     *  Navigation uses a dual mechanism to cover both timing windows:
     *   - _pendingNavTarget: stored for the component's mount-time check, when
     *     the panel was not open and the component hasn't mounted yet.
     *   - 'dock-flash:navigate' CustomEvent: dispatched after a short delay for
     *     the case where the component IS already mounted (or mounts fast enough).
     *  Both paths are needed because a module variable cannot wake a mounted
     *  component (no re-render), and a DOM event cannot reach an unmounted one
     *  (no listener). */
    function _navigateToAlertProvider(providerId) {
      var switchId = _PROVIDER_SWITCH_MAP[providerId]
      if (!switchId) return

      // Store for the mount-time check (panel not yet mounted)
      _pendingNavTarget = switchId
      _navSeq++

      // Open the panel (without toggling it closed if already open)
      var wb = _applyCtx && _applyCtx.get ? _applyCtx.get('workbench') : undefined
      if (wb) {
        // Workbench mode — open the dock-flash panel view
        try { wb.openView('dock-flash:quick-control') } catch (_) {}
      } else {
        // Standalone mode — open the panel directly (not via triggerEl.click(),
        // which would TOGGLE and close it if already open)
        if (typeof _standaloneOpenPanel === 'function') {
          _standaloneOpenPanel()
        }
      }

      // Also dispatch a DOM event for the "already mounted" case.  The delay
      // is generous: React 18's createRoot().render() is fully async, and the
      // useEffect that registers the listener is a passive effect that runs
      // after commit + paint.  300 ms covers even slow devices.
      var seq = _navSeq
      setTimeout(function () {
        document.dispatchEvent(new CustomEvent('dock-flash:navigate', {
          detail: { switchId: switchId, seq: seq },
        }))
      }, 300)
    }
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
    /** Serialization tail for host preference writes, plus the fence they share.
     *
     *  Every dock-flash write to the `dock-flash` namespace is a compare-and-set
     *  carrying ONE `expectedRevision` fence (the value z.readThenWrite
     *  validates against). With concurrent writers that fence is only correct if
     *  it is the LATEST revision the host has produced — and our `_hostRevision`
     *  cache is refreshed only from a write's own response. Issuing two writes
     *  while the first is still in flight makes the second reuse the first's
     *  stale fence and get rejected with "expected revision N, now N+1": a race
     *  that is entirely self-inflicted in a single-browser session. The official
     *  DSH settings client (ConfigFormController.enqueue) avoids it by chaining
     *  every write onto ONE promise tail so only one is ever in flight, and by
     *  fencing each queued write on the last known host revision
     *  (`pendingRevision ?? snapshot.revision`). This plugin mirrors that: every
     *  host write goes through `_prefWriteTail` (serialized), and its fence is
     *  `_pendingRevision` — the revision the most recent write reported, which
     *  survives an older `describe()` resolving late with a stale value.
     */
    var _prefWriteTail = Promise.resolve()
    var _pendingRevision = null
    function _fenceRevision() {
      // A pending value outranks the describe/mirror one: the shared mirror only
      // folds the LATEST settlement in, so a write that is still ahead of it must
      // hand its own next revision onward rather than let an older snapshot win.
      if (_pendingRevision !== null) return _pendingRevision
      return _hostRevision === null ? undefined : _hostRevision
    }
    /** The plugin context, set in apply(). The preference writers below are
     *  called from render paths and switch handlers that never receive `ctx`,
     *  so it is held here rather than threaded through every call site. Null
     *  before apply() runs, which `savePrefs` tolerates (the write then lands
     *  in memory and localStorage only). */
    var _prefCtx = null
    /** Callbacks to run when the host's preferences arrive or change. */
    var _prefListeners = []

    // ── Compact panel: the mode, its ONE reader and its ONE writer ────────
    // Double-clicking the ⚡ flips it; the panel asks `_compactPanel()` while rendering. Kept
    // here rather than inside the standalone closure because the PANEL is a different scope from
    // the TRIGGER, and a second copy of this flag is exactly how the two surfaces would start
    // disagreeing about which panel is on screen.
    function _compactPanel() {
      return !!(_hostPrefs && _hostPrefs.compactPanel)
    }

    /** Is the compact panel in force on THIS surface?
     *
     *  A preference alone is not enough: it applies to the panel dock-flash owns — the standalone
     *  floating one, mounted with `standalone: true` — and NOT to the panel dock-base mounts in its
     *  own sidebar or floating window. The first version read the preference unconditionally and
     *  the docked panel then drew icon-only rows, no tab headers and no group titles inside
     *  dock-base's pane: it looked broken, because a mode that strips chrome from a floating strip
     *  was being asked to strip chrome from somebody else's window.
     *
     *  Callable on its own so the answer is inspectable — `window.__dockFlashCompactMode(true)` —
     *  rather than only observable by looking at a rendered panel. */
    /** The DOCKED panel's own switch — see `_compactPanelForSurface`. */
    function _compactPanelDocked() {
      return !!(_hostPrefs && _hostPrefs.compactPanelDocked)
    }

    /** Is the compact panel in force on THIS surface?
     *
     *  TWO preferences, not one, and the split is deliberate. The docked panel is somebody else's
     *  window: dock-base owns its width and its chrome, so a mode turned on for the floating strip
     *  must not silently restyle it — that is the defect that made the workbench panel look broken
     *  the first time. It is not that the docked panel cannot be compact; it is that it has to be
     *  ASKED, and the toggle in its own header is how. Each surface remembers its own answer.
     *
     *  Callable on its own so the answer is inspectable: `window.__dockFlashCompactMode(true)`. */
    function _compactPanelForSurface(props) {
      return !!(props && props.standalone === true) ? _compactPanel() : _compactPanelDocked()
    }

    /** One painter for the compact toggle in EITHER header, so the two cannot disagree about what
     *  "on" looks like. Mirrors the close-on-blur button beside it: the same glyph in both states,
     *  with background + opacity carrying the state and the `title` naming the action. */
    function _paintCompactToggle(btn, docked) {
      if (!btn) return
      var on = docked ? _compactPanelDocked() : _compactPanel()
      btn.setAttribute('aria-pressed', String(on))
      btn.setAttribute('aria-label', t(on ? 'compactExit' : 'compactEnter'))
      btn.setAttribute('title', t(on ? 'compactExit' : 'compactEnter'))
      btn.style.opacity = on ? '1' : '0.55'
      btn.style.background = on ? 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.18))' : 'transparent'
    }

    function _setCompactPanel(on, docked) {
      var next = !!on
      var field = docked ? 'compactPanelDocked' : 'compactPanel'
      var patch = {}
      patch[field] = next
      if (_hostPrefs) _hostPrefs[field] = next
      // Optimistic in memory, persisted through the one writer: the panel re-renders from
      // `_emitPrefs`, not from the host's answer, so the gesture is instant and a rejected write
      // can still roll the flag back through `savePrefs`' own error path.
      try { savePrefs(_prefCtx, patch, null) } catch (_) {}
      // The panel is a React tree that subscribes to the REGISTRY version, not to this flag —
      // `_emitPrefs()` reaches the imperative surfaces (the container skin, the trigger size) and
      // would leave the panel itself showing the previous mode until something else re-rendered.
      try {
        var reg = _applyCtx && _applyCtx.get ? _applyCtx.get('quickControl') : null
        if (reg && typeof reg.notifyChange === 'function') reg.notifyChange('dock-flash:compact-panel')
      } catch (_) {}
      _emitPrefs()
    }

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

    /** Normalize a `describe()` result into a promise. NEVER let this throw.
     *
     *  `settings.describe().then(...)` is not safe, and the reason is that the
     *  SAME method name has two implementations:
     *
     *  - the WIRE form, where the typert gateway wraps the call and hands back a
     *    Promise;
     *  - the DIRECT form, where `ctx.remote.settings` is (or resolves to) the
     *    host controller itself. `SettingsController.describe()` in
     *    `@deepseek-ai/dsh-api-settings-controller` is **synchronous** and returns
     *    `{ writable, hasDocument, namespaces }` — measured there, and the reason
     *    the parser below already accepts both `{ ok, value }` and a bare view.
     *    In that shape `.then` is not a function.
     *
     *  And it can THROW: the same controller's `provider()` raises
     *  "settings service is absent: mount @deepseek-ai/dsh-settings …" when
     *  nothing is mounted. `Promise.resolve()` alone would not contain that,
     *  because the argument is evaluated first — hence the guard around the call.
     *
     *  WHY THIS MATTERS BEYOND A LOG LINE: the throw is SYNCHRONOUS, so it leaves
     *  `loadHostPreferences()` *before* the `.catch` at the end of its chain and
     *  escapes `apply()`. A plugin whose `apply()` throws never activates — its
     *  fiber goes FAILED, so its switches, panel and providers simply never
     *  appear. That is the "registered plugin silently disappeared" symptom, and
     *  the user-visible error is `settings.describe(...).then is not a function`.
     *  Two shapes, one normalization. */
    function _describeAsync(settings) {
      try { return Promise.resolve(settings.describe()) }
      catch (err) { return Promise.reject(err) }
    }

    /** Pull the whole namespace once and adopt it. Never rejects.
     *
     *  Retries up to _PREFS_MAX_RETRIES times when the dock-flash namespace is
     *  absent — the host-side fiber may not have reached state 2 (active) when
     *  the client-side apply() first calls this.  The settings service only
     *  includes namespaces whose fiber.state === 2, so a race between the
     *  client loading and the host initializing produces a list that omits
     *  dock-flash even though the host half is installed and will appear later.
     *
     *  Each retry is delayed by _PREFS_RETRY_DELAY_MS.  The "namespace not
     *  registered" path was the only one observed to race; other failures
     *  (no remote, no describe, bad response shape) are structural and retrying
     *  cannot fix them, so those still return immediately. */
    var _PREFS_MAX_RETRIES = 8
    var _PREFS_RETRY_DELAY_MS = 750

    function loadHostPreferences(ctx, _retryCount) {
      if (typeof _retryCount !== 'number') _retryCount = 0
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
      return _describeAsync(settings).then(function (desc) {
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
          // The host half's fiber may not have reached state 2 yet — retry.
          if (_retryCount < _PREFS_MAX_RETRIES) {
            console.log('[dock-flash] dock-flash namespace not yet visible (attempt ' + (_retryCount + 1) + '/' + _PREFS_MAX_RETRIES + '), retrying in ' + _PREFS_RETRY_DELAY_MS + 'ms')
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(loadHostPreferences(ctx, _retryCount + 1))
              }, _PREFS_RETRY_DELAY_MS)
            })
          }
          return _prefsFail(
            'the dock-flash namespace is not registered',
            'namespaces seen: ' + (list.map(function (n) { return (n && (n.ns || n.namespace)) || '?' }).join(',') || '(none)') +
            ' — the host half may not be loaded, or needs a DSH restart' +
            ' (retried ' + _PREFS_MAX_RETRIES + ' times)')
        }
        var resolved = ns.value || ns.resolved
        if (!resolved) {
          return _prefsFail(
            'the dock-flash namespace carried no value',
            'descriptor keys: ' + Object.keys(ns).join(','))
        }
        // One in-memory object, but kept in per-subsystem blocks so that adding
        // a field to alerts (D) is a localized
        // edit that never has to touch the other blocks' lines (K7 decoupling).
        _hostPrefs = {
          // A · Panel / preference bridge (panel order, trigger, skin)
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
          compactPanel: resolved.compactPanel === true,
          compactPanelDocked: resolved.compactPanelDocked === true,

          // D · System alerts — host-pushed alert queue capacity and
          //      retention. Per-monitor thresholds live in the companion
          //      namespaces (dsh-flash-ctx-mon / -mem-mon / -net-mon).
          hostAlertQueueCap: resolved.hostAlertQueueCap,
          hostAlertMaxAge: resolved.hostAlertMaxAge,
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
                  ' overlayOpacity=' + JSON.stringify(_hostPrefs.overlayOpacity) +
                  ' compactPanel=' + _hostPrefs.compactPanel +
                  ' hostAlertQueueCap=' + _hostPrefs.hostAlertQueueCap +
                  ' hostAlertMaxAge=' + _hostPrefs.hostAlertMaxAge,
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

    /**
     * Console hook: `__dockFlashTheme()` reports the theme service as the `外观`
     * dropdown sees it — the raw `themes` list, plus the KEYS each entry actually
     * exposes.
     *
     * Written because the dropdown's contents could not be established from the
     * outside. Two facts were needed and neither was knowable by reading code:
     * whether a skin's own packs appear in this list at all (Dream registers its
     * skins through `ctx.theme.register()`, but also reads `getTheme().themes` to
     * avoid id collisions — only one of those implies visibility), and, if they
     * do, WHICH FIELD separates them from the base light/dark preferences. Guessing
     * the second one is exactly how a filter ends up hiding the wrong half, or
     * every entry at once.
     *
     * Read-only on purpose: it calls `getTheme()` and nothing else, so it cannot
     * change what the page is wearing. `tokens` is reported as a COUNT rather than
     * a copy, because these objects carry the whole palette and this is a console
     * probe, not a data export. The dropdown's own `system` entry is hardcoded by
     * dock-flash rather than supplied by the service, so it is reported separately
     * as `appendedByDockFlash`.
     */
    function themeProbe(getThemeService) {
      const describe = (th) => {
        if (!th || typeof th !== 'object') return th
        const keys = Object.keys(th)
        let tokens = null
        try {
          tokens = th.tokens && typeof th.tokens === 'object' ? Object.keys(th.tokens).length : null
        } catch (_) { tokens = null }
        try {
          return JSON.parse(JSON.stringify({
            id: th.id === undefined ? null : th.id,
            label: th.label === undefined ? null : th.label,
            name: th.name === undefined ? null : th.name,
            colorScheme: th.colorScheme === undefined ? null : th.colorScheme,
            builtin: th.builtin === undefined ? null : th.builtin,
            keys,
            tokens,
          }))
        } catch (_) {
          return { id: String(th.id), keys, stringifyFailed: true }
        }
      }
      try {
        const svc = getThemeService()
        if (!svc || typeof svc.getTheme !== 'function') {
          return { available: false, reason: 'ctx.get("theme") did not resolve, or it has no getTheme()' }
        }
        const snap = svc.getTheme() || {}
        return {
          available: true,
          snapshotKeys: Object.keys(snap),
          preference: snap.preference === undefined ? null : snap.preference,
          active: describe(snap.active),
          themes: Array.isArray(snap.themes) ? snap.themes.map(describe) : [],
          appendedByDockFlash: [{ label: 'System / 跟随系统', value: 'system' }],
        }
      } catch (e) {
        return { available: false, reason: String((e && e.message) || e) }
      }
    }

    /** Write one or more preference fields to memory + localStorage + host.
     *  The host write is fire-and-forget on purpose: the UI must not wait on a
     *  round trip, and a failure only means the value stays browser-local. The
     *  memory and localStorage layers update synchronously (optimistic), but the
     *  HOST write is enqueued on the shared serialized tail (`_prefWriteTail`) so
     *  it never carries a fence an earlier in-flight write has since advanced.
     *
     *  If a `onError` callback is supplied, it is called with the old values
     *  when the host write fails, so the caller can rollback its UI state.
     *  Signature: onError(patch, saved) where saved is a function that
     *  restores the old values. */
    function savePrefs(ctx, patch, localWrites, onError) {
      // Snapshot current values so we can rollback on failure.
      var saved = {}
      for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) saved[k] = _hostPrefs && _hostPrefs[k]
      if (_hostPrefs) {
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) _hostPrefs[k] = patch[k]
      }
      try { if (localWrites) localWrites() } catch (_) {}
      return _queuePrefWrite(ctx, patch, onError, saved)
    }

    /** Queue one serialized, fenced host write to the `dock-flash` namespace.
     *  Shared by `savePrefs` and other switches that write to the host namespace
     *  so the SAME tail and the SAME fence back every write — a second write can
     *  no longer reuse a fence the first has already advanced. Resolves true on
     *  host accept, false on reject/failure, and on failure invokes
     *  `onError(patch, restore)` with a rollback over the captured `saved`.
     *
     *  Three arguments are always sent to `settings.update`: the runtime rejects
     *  two with "expected 3 argument(s), got 2". A KNOWN fence is preferred so a
     *  genuinely external concurrent writer is detected rather than silently
     *  overwritten; `undefined` (unconditional) is only used when no revision is
     *  known yet.
     *
     *  K7 note: All remaining subsystems (A/D) currently write to the single
     *  `dock-flash` namespace. The FIELD SETS are independent (A sends
     *  {panelOrder, …}, D sends {hostAlertQueueCap, hostAlertMaxAge}), so a
     *  write from one subsystem never touches another's fields. Physical
     *  package splitting has given each monitor its own namespace:
     *  `dsh-flash-ctx-mon` (context), `dsh-flash-mem-mon` (memory),
     *  `dsh-flash-net-mon` (network) and `dsh-flash-proxy` (system proxy).
     *  The field-set isolation remains the structural boundary. */
    function _queuePrefWrite(ctx, patch, onError, saved) {
      var task = _prefWriteTail.then(function () {
        var settings = _remoteSettings(ctx)
        if (!settings || typeof settings.update !== 'function') {
          // No settings service — roll back the in-memory value and invoke
          // the error callback so the UI can revert.
          if (onError) onError(patch, function () {
            for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _hostPrefs[k] = saved[k]
          })
          return false
        }
        return settings.update('dock-flash', patch, _fenceRevision())
          .then(function (res) {
            // Every write bumps the revision; keeping the newest one is what
            // makes the NEXT queued write succeed instead of failing its
            // compare-and-set.
            try {
              if (res && res.ok === false) {
                // Fence was genuinely stale (an external writer advanced the
                // host) — drop the pending fence AND re-read the namespace so
                // the next queued write frontomes a fresh revision instead of
                // replaying the stale one forever (the official controller's
                // `recover()` does the same mirror.load()).
                _pendingRevision = null
                console.warn('[dock-flash] host rejected the preference write:',
                  (res.error && (res.error.message || res.error.code)) || res.error)
                // Roll back on rejection.
                if (onError) onError(patch, function () {
                  for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _hostPrefs[k] = saved[k]
                })
                // Best-effort re-sync of the fence; never rejects. Mirrors the
                // exact access path loadHostPreferences() uses on the describe
                // result (the wrapper `ok` flag, `value || desc`, the namespace
                // matching `ns`/`namespace`, and `ns.revision`).
                try {
                  _describeAsync(settings).then(function (desc) {
                    if (desc && desc.ok !== false) {
                      var view2 = desc.value || desc
                      var list2 = view2 && Array.isArray(view2.namespaces)
                        ? view2.namespaces
                        : (Array.isArray(view2) ? view2 : null)
                      var ns2 = list2 && list2.find(function (n) {
                        return (n && (n.ns || n.namespace)) === 'dock-flash'
                      })
                      if (ns2 && typeof ns2.revision === 'number') _hostRevision = ns2.revision
                    }
                  }).catch(function () {})
                } catch (_) {}
                return false
              }
              var v = res && res.value
              if (v && typeof v.revision === 'number') {
                _pendingRevision = v.revision
                _hostRevision = v.revision
              }
            } catch (_) {}
            return true
          }).catch(function (err) {
            _pendingRevision = null
            console.warn('[dock-flash] failed to persist preference to host:', err)
            // Roll back the in-memory value so the UI does not lie to the user.
            if (onError) onError(patch, function () {
              for (var k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) _hostPrefs[k] = saved[k]
            })
            return false
          })
      })
      // Keep the tail swallow-safe: a rejected link must not poison the queue.
      _prefWriteTail = task.then(function () {}, function () {})
      return task
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

    /** Merge "identical" alerts for panel display. Two alerts are identical
     *  when their RESOLVED title and message strings both match — functions
     *  are evaluated so a fresh provider tick that re-emits the same text is
     *  folded into one row. The merged row keeps the representative (highest
     *  severity, then most recent) and stamps `_groupIds` (every member's full
     *  id) and `_groupCount` so the panel can show a ×N badge and dismiss the
     *  whole group at once. */
    function mergeAlertsForDisplay(alerts) {
      if (!alerts || !alerts.length) return []
      const byKey = new Map()
      const order = []
      for (const a of alerts) {
        const title = _resolveAlertText(a.title)
        const message = _resolveAlertText(a.message)
        const key = title + '\u0000' + message
        let group = byKey.get(key)
        if (!group) {
          group = { _rep: a, _groupIds: [a.id], _groupCount: 0 }
          byKey.set(key, group)
          order.push(group)
        } else {
          group._groupIds.push(a.id)
        }
        // Representative: highest severity, then most recent timestamp
        const prevSev = SEVERITY_ORDER[group._rep.severity] || 0
        const currSev = SEVERITY_ORDER[a.severity] || 0
        if (currSev > prevSev ||
            (currSev === prevSev && (a.timestamp || 0) > (group._rep.timestamp || 0))) {
          group._rep = a
        }
        // Duplicate id within the same provider set shares one key — only
        // count distinct member ids.
      }
      return order.map((g) => Object.assign({}, g._rep, {
        _groupIds: g._groupIds,
        _groupCount: g._groupIds.length,
      }))
    }

    const MAX_ALERTS = 3
    const SEVERITY_ORDER = { info: 0, warning: 1, error: 2, critical: 3 }

    function createAlertRegistry(registryCtx) {
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
      const newAlertListeners = new Set()  // called with (newAlerts[]) on genuinely new alerts
      const startedProviders = new Set()   // ids of providers currently started
      const disabledProviderIds = new Set() // ids the user has individually switched OFF
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
        console.log('[dock-flash] AlertRegistry notify: listeners=' + listeners.size + ', activeAlerts=' + activeAlerts.size)
        listeners.forEach((fn) => { try { fn() } catch (e) { console.warn('[dock-flash] notify listener error:', e) } })
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
        const genuinelyNew = []  // alerts that are truly new (not seen before)
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
            const isNew = !oldAlert
            const alertObj = { ...a, id: fullId, _providerId: providerId }
            activeAlerts.set(fullId, alertObj)
            if (!oldAlert || severityChanged) changed = true
            if (isNew) genuinelyNew.push(alertObj)
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
        // Notify new-alert listeners (for toast etc.)
        if (genuinelyNew.length > 0) {
          newAlertListeners.forEach((fn) => { try { fn(genuinelyNew) } catch (_) {} })
        }
      }

      return {
        /** Register an alert provider; returns a disposer. */
        registerProvider(provider) {
          if (!provider || !provider.id) {
            console.warn('[dockFlashAlerts] registerProvider: missing id')
            return () => {}
          }
          providers.set(provider.id, provider)
          // If already running, start the new provider immediately — unless
          // the user has individually switched it OFF for this session.
          if (running && !disabledProviderIds.has(provider.id)) {
            try {
              provider.start((alerts) => handleProviderUpdate(provider.id, alerts))
              startedProviders.add(provider.id)
            } catch (e) {
              console.warn('[dockFlashAlerts] provider start error:', e)
            }
          }
          return () => {
            try { provider.stop() } catch (_) {}
            startedProviders.delete(provider.id)
            providers.delete(provider.id)
            disabledProviderIds.delete(provider.id)
            handleProviderUpdate(provider.id, [])
          }
        },

        /** Start a single provider, respecting the per-monitor gate and the
         *  registry's overall running state. Idempotent. */
        startProvider(id) {
          const provider = providers.get(id)
          if (!provider || startedProviders.has(id)) return
          if (!running || disabledProviderIds.has(id)) return
          startedProviders.add(id)
          try {
            // Pass registryCtx so providers can call ctx.get()
            provider.start((alerts) => handleProviderUpdate(id, alerts), registryCtx)
          } catch (e) {
            console.warn('[dockFlashAlerts] provider start error:', e)
            startedProviders.delete(id)
          }
        },

        /** Stop a single provider and remove its alerts. Idempotent. */
        stopProvider(id) {
          const provider = providers.get(id)
          if (!provider || !startedProviders.has(id)) return
          startedProviders.delete(id)
          try { provider.stop() } catch (_) {}
          handleProviderUpdate(id, [])
        },

        /** Turn a single monitor on/off. `enabled` is the USER intent (the
         *  master system-alerts toggle is handled separately via stop()/
         *  start()). When disabled, the provider is stopped and its alerts
         *  cleared, even if the registry is otherwise running. */
        setProviderEnabled(id, enabled) {
          if (enabled) {
            disabledProviderIds.delete(id)
            this.startProvider(id)
          } else {
            disabledProviderIds.add(id)
            this.stopProvider(id)
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
            console.log('[dock-flash] dismissAlert: ' + id + ', remaining=' + activeAlerts.size)
            notify()
          }
        },

        /** Dismiss a set of alert ids in one pass (single notify). Used by the
         *  panel's merged-alert groups: closing a merged row clears every
         *  member id it stands for. */
        dismissMany(ids) {
          if (!ids || !ids.length) return
          var changed = false
          for (const id of ids) {
            if (activeAlerts.has(id)) {
              activeAlerts.delete(id)
              dismissed.add(id)
              changed = true
            }
          }
          if (changed) {
            saveDismissed()
            notify()
          }
        },

        /** Dismiss all active alerts. */
        dismissAll() {
          var count = activeAlerts.size
          for (const [id] of activeAlerts) dismissed.add(id)
          activeAlerts.clear()
          saveDismissed()
          console.log('[dock-flash] dismissAll: cleared=' + count)
          notify()
        },

        /** Subscribe to alert changes; returns a disposer. */
        subscribe(fn) {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },

        /** Subscribe to genuinely new alerts; callback receives Alert[].
         *  Unlike subscribe() which fires on any change, this only fires
         *  when alerts that were NOT previously in the registry arrive.
         *  Returns a disposer. */
        onNewAlert(fn) {
          newAlertListeners.add(fn)
          return () => { newAlertListeners.delete(fn) }
        },

        /** Start all providers. Idempotent. Providers the user has
         *  individually switched OFF stay stopped. */
        start() {
          if (running) return
          running = true
          for (const [id] of providers) {
            if (disabledProviderIds.has(id)) continue
            this.startProvider(id)
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
          for (const id of startedProviders) {
            const provider = providers.get(id)
            try { if (provider) provider.stop() } catch (_) {}
          }
          startedProviders.clear()
          activeAlerts.clear()
          // dismissed survives — see NOTE above
          notify()
        },

        /** Clear all alert-related data: dismissed set, host provider
         *  accumulated alerts, and their localStorage keys.  Called when
         *  the master system-alerts toggle is switched OFF so no stale
         *  data lingers. */
        clearAlertData() {
          // Clear dismissed set + localStorage
          dismissed.clear()
          try { localStorage.removeItem(DISMISSED_KEY) } catch (_) {}
          // Clear HostAlertProvider's accumulated data + localStorage
          try { localStorage.removeItem('dock-flash:host-alerts') } catch (_) {}
          // Notify any provider that supports clearData (HostAlertProvider)
          for (const [, provider] of providers) {
            try { if (provider && typeof provider.clearData === 'function') provider.clearData() } catch (_) {}
          }
          console.log('[dock-flash] clearAlertData: dismissed + host accumulated cleared')
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
    //#region Alert Preference Accessors ──────────────────────────────────────────
    //
    // Alert preferences live in the host settings namespace and are read into
    // `_hostPrefs` by `loadHostPreferences()`.  The accessors below read from
    // `_hostPrefs` with built-in fallback defaults so that providers always
    // get a valid value — even before the host has answered, or when a field
    // is absent from an older host build.
    //
    // The remaining fields govern the host-side alert queue (capacity and
    // retention). The per-monitor thresholds moved to the companion
    // namespaces: dsh-flash-ctx-mon (context), dsh-flash-mem-mon (memory),
    // dsh-flash-net-mon (network).

    var _ALERT_DEFAULTS = {
      hostAlertQueueCap: 50,
      hostAlertMaxAge: 24,
    }

    /** Read an alert preference from _hostPrefs, falling back to the built-in default. */
    function _alertPref(key) {
      var v = _hostPrefs && _hostPrefs[key]
      if (typeof v === 'number' && isFinite(v)) return v
      if (v != null && typeof v === 'object') return v   // Record<string,*> values
      return _ALERT_DEFAULTS[key]
    }

    /** Write an alert preference through the preference bridge (host + localStorage cache).
     *  If an `onError` callback is supplied, it is called when the host write fails,
     *  receiving (patch, rollback) where rollback restores the old value. */
    function _writeAlertPref(ctx, key, value, onError) {
      savePrefs(ctx, Object.fromEntries([[key, value]]), null, onError)
    }

    //#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    //#region AlertProviders ──────────────────────────────────────────────────────

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
      var STORE_KEY = 'dock-flash:host-alerts'
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
       *  Prunes entries older than hostAlertMaxAge (hours) and reconstructs
       *  the function wrappers for title/message. */
      function loadAccumulated() {
        try {
          var raw = localStorage.getItem(STORE_KEY)
          if (!raw) return
          var payload = JSON.parse(raw)
          if (!payload || !Array.isArray(payload.alerts)) return
          var now = Date.now()
          var maxAgeHours = _alertPref('hostAlertMaxAge')
          var maxAgeMs = (maxAgeHours > 0 ? maxAgeHours : 24) * 60 * 60 * 1000
          var cutoff = now - maxAgeMs
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
              var queueCap = _alertPref('hostAlertQueueCap')
              var fillRatio = hostAlerts.length / (queueCap > 0 ? queueCap : 50)
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
        /** Clear in-memory + localStorage data.  Called by the registry's
         *  clearAlertData() when the master system-alerts toggle is OFF. */
        clearData: function () {
          accumulated = []
          try { localStorage.removeItem(STORE_KEY) } catch (_) {}
        },
      }
    }
    //#endregion ───────────────────────────────────────────────────────────────────
    // Two independent alert display modes: Toast, Dropdown.
    // Each can be toggled on/off via its own switch in the System group.
    // Default: Toast ON, others OFF.

    // ── Display mode preference keys ───────────────────────────────────────
    var ALERT_DISPLAY_KEYS = {
      toast: 'dock-flash:alert-toast',
      dropdown: 'dock-flash:alert-dropdown',
    }
    var ALERT_DISPLAY_DEFAULTS = { toast: true, dropdown: true }

    function _getAlertDisplayMode(mode) {
      // Dropdown is always on — no longer a user preference
      if (mode === 'dropdown') return true
      try {
        var v = localStorage.getItem(ALERT_DISPLAY_KEYS[mode])
        return v === null ? ALERT_DISPLAY_DEFAULTS[mode] : v === '1'
      } catch (_) { return ALERT_DISPLAY_DEFAULTS[mode] }
    }
    function _setAlertDisplayMode(mode, v) {
      try { localStorage.setItem(ALERT_DISPLAY_KEYS[mode], v ? '1' : '0') } catch (_) {}
    }

    // ── Severity helpers ───────────────────────────────────────────────────
    var SEV_COLORS = {
      critical: 'var(--dsw-alias-state-error-primary, #ec1313)',
      error: 'var(--dsw-alias-state-error-primary, #ec1313)',
      warning: 'var(--dsw-alias-state-warn-label, #dd8629)',
      info: 'var(--dsw-alias-state-business-primary, #4176e6)',
    }
    var SEV_ICONS = { critical: '🔴', error: '🟠', warning: '🟡', info: '🔵' }

    function _resolveAlertText(val) {
      return typeof val === 'function' ? val() : (val || '')
    }

    function _getTriggerRect() {
      var el = document.querySelector('[data-dock-flash-trigger]')
      return el ? el.getBoundingClientRect() : null
    }

    // ════════════════════════════════════════════════════════════════════════
    // 1. TOAST NOTIFICATION
    // ════════════════════════════════════════════════════════════════════════
    var _toastContainer = null
    var _toastUnsub = null
    var _activeToasts = []  // { id, el, timer, severity } — at most ONE on screen at a time
    var _toastQueue = []    // pending alerts waiting to be shown, highest severity first
    var _toastCooldownTimer = null  // 2s gap between consecutive toasts
    var TOAST_COOLDOWN_MS = 2000

    /** `prefers-reduced-motion: reduce`, read from the media query and never
     *  assumed. The toast's EXIT slides the card sideways and its progress bar
     *  animates for 5s; those are the movement this drops. The fade stays — an
     *  opacity change is not motion — which is the same split DSH's own Toast
     *  makes (`@media (prefers-reduced-motion: reduce)` there keeps the delayed
     *  fade and drops the translate). */
    function _prefersReducedMotion() {
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      } catch (_) { return false }
    }

    // ── Toast placement: the CONVERSATION's top-right, not the window's ────
    // The container is a body-level sibling of the conversation — it must be,
    // for the same reason the overlay trigger is (see its region) — so its
    // position is COMPUTED from the conversation viewport's rect instead of
    // being `right: 12px` against the window. Pinned to the window it sat in
    // the far corner of the screen, over the right sidebar and the rail gutter,
    // nowhere near the conversation it is reporting on.
    var _toastAnchor = null      // the viewport element the observer watches
    var _toastObserver = null
    /** Inward from the conversation's content corner, in px. Matches what the
     *  window-pinned version used, so the toast keeps its distance from the
     *  edge — only the EDGE it measures from changed. */
    var TOAST_INSET = 12

    /** Point the ResizeObserver at the conversation scroller, re-pointing when
     *  the conversation is rebuilt — a new session gets a NEW scroller and the
     *  old element disconnects rather than resizes, so a one-shot observer
     *  would stop tracking exactly when the anchor moved. Idempotent, so
     *  calling it from every reposition costs one comparison. Mirrors
     *  `adoptOverlayAnchor()`. */
    function adoptToastAnchor(el) {
      if (_toastAnchor === el) return
      if (_toastObserver) { try { _toastObserver.disconnect() } catch (_) {} }
      _toastAnchor = el
      if (typeof ResizeObserver === 'function') {
        if (!_toastObserver) _toastObserver = new ResizeObserver(function () { positionToastContainer() })
        _toastObserver.observe(el)
      }
    }

    /** Place the toast container in the conversation's top-right corner.
     *
     *  A ResizeObserver on the viewport — not a window `resize` listener — is
     *  what keeps it there: opening the right sidebar and moving the sash both
     *  change the conversation's box without firing a window resize (the same
     *  two-of-three the overlay trigger documents).
     *
     *  With NO conversation on screen this falls back to the window's corner
     *  rather than hiding. The overlay BUTTON hides in that case because a
     *  control with nowhere to go is noise; a notification that is never shown
     *  is a lost alert, and "the conversation's top-right corner" has no meaning
     *  without a conversation. A conversation that appears DURING a toast's few
     *  seconds is not picked up (nothing is observed yet) — it is anchored on
     *  the next toast. */
    function positionToastContainer() {
      if (!_toastContainer) return
      // The container declares a fixed width, so this reads the ONE number the
      // arithmetic needs instead of restating `300px` here and drifting from it.
      var width = _toastContainer.getBoundingClientRect().width
      var vp = conversationViewport()
      if (vp) adoptToastAnchor(vp.el)
      // Fall back to the WINDOW corner when there is no conversation, or when
      // our own box is not laid out yet (a zero width would make the arithmetic
      // below meaningless). Both are transient or expected states, and the
      // window corner is always a valid place to be.
      if (!vp || !width) {
        _toastContainer.style.left = 'auto'
        _toastContainer.style.top = TOAST_INSET + 'px'
        _toastContainer.style.right = TOAST_INSET + 'px'
        return
      }
      // Inward from the CONTENT box's top-right (i.e. inside the scrollbar
      // gutter) — the same arithmetic the overlay trigger uses, and the reason
      // the toast does not sit over the scrollbar.
      var left = vp.contentRight - width - TOAST_INSET
      // Only a RIGHT-side turn rail competes with this corner; give way to it
      // the way the overlay button does.
      var probe = turnRailProbe()
      if (probe.visible && probe.rails && probe.rails.length) {
        var railLeft = Infinity
        for (var i = 0; i < probe.rails.length; i++) {
          var rail = probe.rails[i]
          if (!rail.visible) continue
          if (rail.rect.x > vp.rect.left + vp.rect.width / 2 && rail.rect.x < railLeft) railLeft = rail.rect.x
        }
        if (railLeft !== Infinity) left = Math.min(left, railLeft - width - 8)
      }
      // Clamp into the content box, so a conversation narrower than the toast
      // cannot push it over the scrollbar or off the conversation's left edge.
      var minLeft = vp.rect.left
      var maxLeft = vp.contentRight - width
      if (maxLeft < minLeft) maxLeft = minLeft
      left = Math.max(minLeft, Math.min(left, maxLeft))
      _toastContainer.style.left = Math.round(left) + 'px'
      _toastContainer.style.top = Math.round(Math.max(0, vp.rect.top + TOAST_INSET)) + 'px'
      _toastContainer.style.right = 'auto'
      _toastContainer.style.bottom = 'auto'
    }

    function _getToastContainer() {
      if (!_toastContainer) {
        _toastContainer = document.createElement('div')
        _toastContainer.setAttribute('data-dock-flash-toast-container', '')
        Object.keys(S.toastContainer).forEach(function (k) {
          _toastContainer.style[k] = S.toastContainer[k]
        })
        // Layer: derived from the user's `triggerLayer`, so a high one can never
        // put the panel over the toast. See the alert layer band.
        _toastContainer.style.zIndex = String(layerOfToast())
        document.body.appendChild(_toastContainer)
        // Position AFTER the append: this reads the rendered width.
        positionToastContainer()
      }
      return _toastContainer
    }

    // Remove a toast's DOM + bookkeeping WITHOUT draining the pending queue.
    // Used when a higher-severity alert takes over the single toast slot.
    function _removeToastEntry(toastEntry) {
      if (toastEntry.timer) clearTimeout(toastEntry.timer)
      if (toastEntry.el && toastEntry.el.parentNode) {
        toastEntry.el.style.opacity = '0'
        // The sideways slide is dropped under reduced motion; the fade is what
        // ends the toast either way.
        if (!_prefersReducedMotion()) toastEntry.el.style.transform = 'translateX(20px)'
        setTimeout(function () {
          if (toastEntry.el && toastEntry.el.parentNode) {
            toastEntry.el.parentNode.removeChild(toastEntry.el)
          }
        }, 300)
      }
      var idx = _activeToasts.indexOf(toastEntry)
      if (idx >= 0) _activeToasts.splice(idx, 1)
    }

    function _removeToast(toastEntry) {
      _removeToastEntry(toastEntry)
      // A toast slot just freed — wait for the cooldown before surfacing
      // the next one, so the user gets a brief pause between toasts.
      _scheduleToastDrain()
    }

    // True while a toast occupies the single on-screen slot.
    function _toastShowing() { return _activeToasts.length > 0 }

    // Keep the pending queue ordered by severity (desc) so the higher-level
    // alert is always the next one surfaced.
    function _sortToastQueue() {
      _toastQueue.sort(function (a, b) {
        return (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0)
      })
    }

    /** Enqueue a new batch of alerts and surface them one at a time, higher
     *  severity first. Only one toast is ever on screen; a newly-arrived
     *  alert that outranks the current one replaces it immediately. */
    function _enqueueToasts(newAlerts) {
      if (!_alertDisplayActive.toast) return  // mode may have been stopped
      if (!newAlerts || !newAlerts.length) return
      var sorted = newAlerts.slice().sort(function (a, b) {
        return (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0)
      })
      for (var i = 0; i < sorted.length; i++) {
        var a = sorted[i]
        if (!_toastShowing() && !_toastCooldownTimer) {
          // Nothing on screen and no cooldown — show immediately
          _showToast(a)
        } else if (_toastShowing() && (SEVERITY_ORDER[a.severity] || 0) >
                   (SEVERITY_ORDER[_activeToasts[0].severity] || 0)) {
          // A higher-severity alert arrived mid-display — take the slot now.
          _showToast(a)
        } else {
          _toastQueue.push(a)
        }
      }
      // If nothing is showing and queue has items, schedule the next drain
      _scheduleToastDrain()
    }

    /** Schedule the next toast after the cooldown period.  If a cooldown is
     *  already running, this is a no-op — the pending queue will be drained
     *  when it fires. */
    function _scheduleToastDrain() {
      if (_toastCooldownTimer) return  // already waiting
      if (!_toastQueue.length) return  // nothing to show
      _toastCooldownTimer = setTimeout(function () {
        _toastCooldownTimer = null
        _drainToastQueue()
      }, TOAST_COOLDOWN_MS)
    }

    function _drainToastQueue() {
      if (_toastShowing()) return  // only one toast at a time
      if (!_toastQueue.length) return
      _sortToastQueue()
      _showToast(_toastQueue.shift())
    }

    function _showToast(alert) {
      if (!_alertDisplayActive.toast) return  // mode may have been stopped
      var container = _getToastContainer()
      var sev = alert.severity || 'info'
      var sevStyleKey = 'toastCard' + sev.charAt(0).toUpperCase() + sev.slice(1)

      // Single-toast display: if another toast holds the slot (a higher-severity
      // alert is taking over mid-display), clear it first.
      if (_activeToasts.length) _removeToastEntry(_activeToasts[0])

      var card = document.createElement('div')
      Object.keys(S.toastCard).forEach(function (k) { card.style[k] = S.toastCard[k] })
      if (S[sevStyleKey]) {
        Object.keys(S[sevStyleKey]).forEach(function (k) { card.style[k] = S[sevStyleKey][k] })
      }
      // A toast IS an announcement, so it has to be one in the accessibility
      // tree too. Severity picks the live region: `alert` is assertive and
      // interrupts (critical/error), `status` is polite and waits for a pause
      // (info/warning). Both roles imply `aria-atomic="true"`, so inserting the
      // card reads the whole card rather than only the changed node. Without
      // this the popup was invisible to screen readers.
      card.setAttribute('role', (sev === 'critical' || sev === 'error') ? 'alert' : 'status')

      // Icon
      var iconEl = document.createElement('span')
      Object.keys(S.toastIcon).forEach(function (k) { iconEl.style[k] = S.toastIcon[k] })
      iconEl.textContent = alert.icon || SEV_ICONS[sev] || '⚡'
      card.appendChild(iconEl)

      // Body
      var body = document.createElement('div')
      Object.keys(S.toastBody).forEach(function (k) { body.style[k] = S.toastBody[k] })

      var titleEl = document.createElement('div')
      Object.keys(S.toastTitle).forEach(function (k) { titleEl.style[k] = S.toastTitle[k] })
      titleEl.textContent = _resolveAlertText(alert.title)
      body.appendChild(titleEl)

      var msgEl = document.createElement('div')
      Object.keys(S.toastMessage).forEach(function (k) { msgEl.style[k] = S.toastMessage[k] })
      msgEl.textContent = _resolveAlertText(alert.message)
      body.appendChild(msgEl)

      card.appendChild(body)

      // Close button
      var closeBtn = document.createElement('button')
      closeBtn.setAttribute('data-dock-flash-focus', '')
      Object.keys(S.toastClose).forEach(function (k) { closeBtn.style[k] = S.toastClose[k] })
      closeBtn.textContent = '✕'
      closeBtn.addEventListener('mouseenter', function () { closeBtn.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))' })
      closeBtn.addEventListener('mouseleave', function () { closeBtn.style.background = 'transparent' })
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation()
        _removeToast(entry)
      })
      card.appendChild(closeBtn)

      // Progress bar (auto-dismiss timer). NOT drawn under reduced motion: its
      // only content is the 5s width animation, so a static copy would read as a
      // stuck bar. The auto-dismiss timer itself is unaffected.
      var reduceMotion = _prefersReducedMotion()
      var progress = null
      if (!reduceMotion) {
        progress = document.createElement('div')
        Object.keys(S.toastProgress).forEach(function (k) { progress.style[k] = S.toastProgress[k] })
        progress.style.background = SEV_COLORS[sev] || SEV_COLORS.info
        progress.style.width = '100%'
        card.appendChild(progress)
      }

      // Click to open alert detail
      card.addEventListener('click', function () {
        _removeToast(entry)
        _showAlertDetail(alert)
      })

      container.appendChild(card)

      // Re-anchor per toast, not only when the container was created: the
      // conversation may have been rebuilt (or opened) since the last one, and
      // a ResizeObserver is only armed once an anchor has been found.
      positionToastContainer()

      // Animate progress bar
      if (progress) {
        requestAnimationFrame(function () {
          progress.style.width = '0%'
          progress.style.transitionDuration = '5s'
        })
      }

      var entry = { id: alert.id, el: card, timer: null, severity: sev }
      entry.timer = setTimeout(function () { _removeToast(entry) }, 5200)
      _activeToasts.push(entry)
    }

    function _startToastMode(alertRegistry) {
      // Defensive: never stack a second subscriber on an existing one.  The
      // module-level _toastUnsub can survive an apply() cycle (hot reload,
      // ctx rebuild), so starting again must first drop the old subscription
      // or a single genuinely-new alert would render toasts from every stale
      // subscriber at once — the "I turned it off but toasts still pop" bug.
      if (_toastUnsub) { try { _toastUnsub() } catch (_) {}; _toastUnsub = null }
      _toastUnsub = alertRegistry.onNewAlert(function (newAlerts) {
        if (!_alertDisplayActive.toast) return  // mode may have been stopped
        _enqueueToasts(newAlerts)
      })
    }

    function _stopToastMode() {
      _alertDisplayActive.toast = false
      if (_toastUnsub) { try { _toastUnsub() } catch (_) {}; _toastUnsub = null }
      if (_toastCooldownTimer) { clearTimeout(_toastCooldownTimer); _toastCooldownTimer = null }
      _toastQueue = []
      // Remove all active toasts (without triggering cooldown for each)
      while (_activeToasts.length > 0) {
        _removeToastEntry(_activeToasts[0])
      }
      if (_toastContainer && _toastContainer.parentNode) {
        _toastContainer.parentNode.removeChild(_toastContainer)
        _toastContainer = null
      }
      // Stop watching the old conversation: the next toast re-anchors itself.
      if (_toastObserver) { try { _toastObserver.disconnect() } catch (_) {} }
      _toastAnchor = null
    }

    // ════════════════════════════════════════════════════════════════════════
    // 2. DROPDOWN (click badge to expand alert list)
    // ════════════════════════════════════════════════════════════════════════
    var _dropdownEl = null
    var _dropdownVisible = false
    var _dropdownClickHandler = null
    var _dropdownOutsideHandler = null

    function _createDropdown(alerts) {
      if (_dropdownEl && _dropdownEl.parentNode) {
        _dropdownEl.parentNode.removeChild(_dropdownEl)
      }
      _dropdownEl = document.createElement('div')
      _dropdownEl.setAttribute('data-dock-flash-alert-dropdown', '')
      Object.keys(S.alertDropdown).forEach(function (k) {
        _dropdownEl.style[k] = S.alertDropdown[k]
      })
      // Layer: derived from `triggerLayer` — the dropdown is anchored to the
      // trigger, which itself sits at `triggerLayer + 1`, so a fixed value could
      // end up underneath the button that opens it.
      _dropdownEl.style.zIndex = String(layerOfAlertDropdown())

      if (!alerts || alerts.length === 0) {
        var empty = document.createElement('div')
        Object.keys(S.alertDropdownEmpty).forEach(function (k) { empty.style[k] = S.alertDropdownEmpty[k] })
        empty.textContent = t('alertNoActiveAlerts')
        _dropdownEl.appendChild(empty)
      } else {
        for (var i = 0; i < alerts.length; i++) {
          (function (alert) {
            var sev = alert.severity || 'info'
            var item = document.createElement('div')
            item.setAttribute('data-dock-flash-focus', '')
            Object.keys(S.alertDropdownItem).forEach(function (k) { item.style[k] = S.alertDropdownItem[k] })
            item.addEventListener('mouseenter', function () { item.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.08))' })
            item.addEventListener('mouseleave', function () { item.style.background = 'transparent' })

            var iconSpan = document.createElement('span')
            Object.keys(S.alertDropdownItemIcon).forEach(function (k) { iconSpan.style[k] = S.alertDropdownItemIcon[k] })
            iconSpan.textContent = alert.icon || SEV_ICONS[sev] || '⚡'
            item.appendChild(iconSpan)

            var textDiv = document.createElement('div')
            Object.keys(S.alertDropdownItemText).forEach(function (k) { textDiv.style[k] = S.alertDropdownItemText[k] })

            var titleDiv = document.createElement('div')
            Object.keys(S.alertDropdownItemTitle).forEach(function (k) { titleDiv.style[k] = S.alertDropdownItemTitle[k] })
            titleDiv.textContent = _resolveAlertText(alert.title)
            textDiv.appendChild(titleDiv)

            var msgDiv = document.createElement('div')
            Object.keys(S.alertDropdownItemMsg).forEach(function (k) { msgDiv.style[k] = S.alertDropdownItemMsg[k] })
            msgDiv.textContent = _resolveAlertText(alert.message)
            textDiv.appendChild(msgDiv)

            item.appendChild(textDiv)

            // Severity color left border
            item.style.borderLeft = '2px solid ' + (SEV_COLORS[sev] || SEV_COLORS.info)

            item.addEventListener('click', function () {
              _hideDropdown()
              _showAlertDetail(alert)
            })

            _dropdownEl.appendChild(item)
          })(alerts[i])
        }
      }

      return _dropdownEl
    }

    function _positionDropdown() {
      if (!_dropdownEl) return
      var rect = _getTriggerRect()
      if (!rect) {
        _dropdownEl.style.top = '60px'
        _dropdownEl.style.right = '12px'
      } else {
        _dropdownEl.style.top = (rect.bottom + 4) + 'px'
        _dropdownEl.style.left = Math.max(4, rect.left) + 'px'
        // Adjust if it would overflow the right edge
        var ddWidth = 260
        if (rect.left + ddWidth > window.innerWidth - 8) {
          _dropdownEl.style.left = Math.max(4, window.innerWidth - ddWidth - 8) + 'px'
        }
      }
    }

    function _showDropdown(alertRegistry) {
      if (_dropdownVisible) { _hideDropdown(); return }
      var alerts = alertRegistry.getAlerts()
      _createDropdown(alerts)
      _positionDropdown()
      document.body.appendChild(_dropdownEl)
      _dropdownVisible = true

      // Outside click to close
      _dropdownOutsideHandler = function (e) {
        if (_dropdownEl && !_dropdownEl.contains(e.target)) {
          _hideDropdown()
        }
      }
      setTimeout(function () { document.addEventListener('mousedown', _dropdownOutsideHandler) }, 0)
    }

    function _hideDropdown() {
      _dropdownVisible = false
      if (_dropdownEl && _dropdownEl.parentNode) {
        _dropdownEl.parentNode.removeChild(_dropdownEl)
      }
      if (_dropdownOutsideHandler) {
        document.removeEventListener('mousedown', _dropdownOutsideHandler)
        _dropdownOutsideHandler = null
      }
    }

    function _startDropdownMode(alertRegistry) {
      // Defensive: drop any listener left over from an earlier start before
      // re-arming, or document-level listeners accumulate across apply().
      // _stopDropdownMode() clears the active flag too, so re-assert it after.
      _stopDropdownMode()
      _alertDisplayActive.dropdown = true
      // Intercept clicks on the trigger BADGE to show dropdown.
      // Clicking the trigger itself still toggles the panel normally.
      _dropdownClickHandler = function (e) {
        if (!_alertDisplayActive.dropdown) return  // mode may have been stopped
        // Only intercept clicks on the badge span inside the trigger
        var badge = e.target.closest && e.target.closest('[data-dock-flash-trigger] span')
        var trigger = e.target.closest && e.target.closest('[data-dock-flash-trigger]')
        if (badge && trigger && alertRegistry.alertCount > 0) {
          e.preventDefault()
          e.stopPropagation()
          _showDropdown(alertRegistry)
        }
      }
      // Use capture phase to intercept before the normal click handler
      document.addEventListener('click', _dropdownClickHandler, true)
    }

    function _stopDropdownMode() {
      _alertDisplayActive.dropdown = false
      _hideDropdown()
      if (_dropdownClickHandler) {
        document.removeEventListener('click', _dropdownClickHandler, true)
        _dropdownClickHandler = null
      }
    }

    // ── Open panel to System tab ───────────────────────────────────────────
    function _openPanelToSystem() {
      // Use the open-only path in standalone mode so clicking the alert bar
      // while the panel is already open does not close it.
      if (typeof _standaloneOpenPanel === 'function') {
        _standaloneOpenPanel()
      } else {
        var triggerEl = document.querySelector('[data-dock-flash-trigger]')
        if (triggerEl) triggerEl.click()
      }
    }

    // ── Alert detail modal ────────────────────────────────────────────────
    // A modal popup that shows the full detail of a single alert, including
    // severity, timestamp, source, message, and type-specific extra data
    // (e.g. network entries show host, method, risk, flags).
    var _alertDetailEl = null     // the mask element
    var _alertDetailOutsideHandler = null

    /** Provider-id → human-readable source name */
    var _PROVIDER_LABELS = {
      // Context monitor — owned by dsh-flash-ctx-mon; dock-flash still
      // displays the alert source label in the alert card.
      'dsh-flash-ctx-mon:context-alert': function () { return t('alertCtxCluster') },
      'dock-flash:host-alert':    function () { return t('alertHostQueue') },
      // Memory monitor — owned by dsh-flash-mem-mon.
      'dsh-flash-mem-mon:host-memory-alert': function () { return t('alertMemCluster') },
      // dsh-flash-net-mon providers — registered via ctx.get('dockFlashAlerts')
      'dsh-flash-net-mon:network-alert': function () { return t('alertNetCluster') },
      'dsh-flash-net-mon:network-audit': function () { return t('alertNetCluster') },
    }

    // ── The companion plugin table — ONE source of truth ──────────────────
    // Since 2.0.0 the monitors and the proxy controls live in their own packages, and an
    // upgrade does not bring them along. Three places need to know that list, and they used
    // to spell it out separately: `_COMPANION_PREFIXES` (which decides that a companion's
    // switches are built-in, i.e. they belong in the ⚡ tab rather than Extensions), this
    // table's own labels, and the "missing companions" hint. A new companion means one
    // entry here — see `_isBuiltInSwitch` for the derivation.
    var _COMPANIONS = [
      { prefix: 'dsh-flash-ctx-mon:', pkg: 'dsh-flash-ctx-mon', label: 'alertCtxCluster' },
      { prefix: 'dsh-flash-mem-mon:', pkg: 'dsh-flash-mem-mon', label: 'alertMemCluster' },
      { prefix: 'dsh-flash-net-mon:', pkg: 'dsh-flash-net-mon', label: 'alertNetCluster' },
      { prefix: 'dsh-flash-proxy:', pkg: 'dsh-flash-proxy', label: 'companionsProxyLabel' },
    ]

    // The rows the "missing companions" hint owns, and the group they are addressed under when
    // they are hidden (`<scope><group>`, the panel's own addressing — see `readPanelOrder`).
    var _COMPANION_HINT_IDS = ['dock-flash:companions-missing', 'dock-flash:companions-copy']

    /** Dismissing the hint means HIDING those rows, through the panel's one hidden-set writer.
     *
     * Deliberately not a second "dismissed" flag. The ◉ visibility mode already owns the question
     * "this row is not wanted": it is persisted in the host's `panelOrder.hidden`, its ↺ reset
     * restores it, and the panel re-reads the map on every render. A separate flag would give the
     * same row TWO sources of truth — the visibility page would draw it ticked while the normal
     * view refused to draw it at all — and would need its own undo path nobody could find.
     *
     * So the ✕ on the block is a shortcut to exactly the state a user can reach by hand, and the
     * way back is the one that already exists: ◉ → tick the row again. */
    function _dismissCompanionHint(registry) {
      var order = readPanelOrder()
      if (!order.hidden || typeof order.hidden !== 'object') order.hidden = {}
      var groupKey = 'builtin:system'
      var list = Array.isArray(order.hidden[groupKey]) ? order.hidden[groupKey].slice() : []
      _COMPANION_HINT_IDS.forEach(function (id) {
        if (list.indexOf(id) === -1) list.push(id)
      })
      order.hidden[groupKey] = list
      writePanelOrder(order)
      // The panel re-reads the order during render; this is what asks for that render.
      try { registry.notifyChange(_COMPANION_HINT_IDS[1]) } catch (_) {}
    }

    // ── Is a companion actually RUNNING? ──────────────────────────────────
    // "Present" means a switch with its prefix is registered — deliberately NOT "the package
    // is in the profile". A package can be installed and still be switched off, or have
    // failed during `apply()`; that is exactly how the 2.0.2 `describe()` crash looked, and
    // telling that user to install something they already have is worse than saying nothing.
    function _companionRunning(registry, prefix) {
      try {
        if (!registry || typeof registry.getSwitches !== 'function') return null
        var list = registry.getSwitches() || []
        for (var i = 0; i < list.length; i++) {
          if (String(list[i] && list[i].id).indexOf(prefix) === 0) return true
        }
        return false
      } catch (_) {
        return null   // unable to tell, and "unable to tell" is not "not installed"
      }
    }

    // ── The profile's own package list, for the "installed but not running" case ──
    // The skin system already fetches `/plugins/dock-flash/profile-packages`, but its copy
    // lives inside that closure and is keyed to a skin scan. This is a second, one-shot,
    // cached read of the same stateless route, which is cheaper than restructuring the skin
    // scan to share it. `installed` is the profile manifest's dependencies; `active` is what
    // survives to `dsh.profile.bundles`.
    var _companionProfile = null
    var _companionProfileInFlight = null
    function _fetchCompanionProfile() {
      if (_companionProfile) return Promise.resolve(_companionProfile)
      if (_companionProfileInFlight) return _companionProfileInFlight
      var done = function (snapshot) {
        _companionProfile = snapshot
        _companionProfileInFlight = null
        return snapshot
      }
      try {
        _companionProfileInFlight = fetch('/plugins/dock-flash/profile-packages', {
          headers: { accept: 'application/json' },
        }).then(function (r) {
          return r && r.ok ? r.json() : null
        }, function () { return null }).then(function (body) {
          if (!body) {
            // A FAILED read is not an empty profile: report it as unknown and do not
            // cache it, so the next panel render can try again.
            _companionProfileInFlight = null
            return { installed: null, active: null, error: 'the host route did not answer' }
          }
          return done({
            dir: typeof body.dir === 'string' ? body.dir : null,
            installed: Array.isArray(body.installed) ? body.installed : [],
            active: Array.isArray(body.active) ? body.active : [],
            error: body.error || null,
          })
        }, function (e) {
          _companionProfileInFlight = null
          return { installed: null, active: null, error: String((e && e.message) || e) }
        })
      } catch (e) {
        _companionProfileInFlight = null
        return Promise.resolve({ installed: null, active: null, error: String(e) })
      }
      return _companionProfileInFlight
    }

    function _providerLabel(alert) {
      if (!alert._providerId) return ''
      var fn = _PROVIDER_LABELS[alert._providerId]
      if (fn) return fn()
      // Fallback: strip known prefixes
      return alert._providerId.replace(/^(dock-flash|dsh-flash-ctx-mon|dsh-flash-net-mon|dsh-flash-mem-mon):/, '')
    }

    function _formatTimestamp(ts) {
      if (!ts) return '—'
      var d = new Date(ts)
      var pad = function (n) { return n < 10 ? '0' + n : '' + n }
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
             ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    }

    function _sevBadgeClass(sev) {
      if (sev === 'critical') return S.alertDetailSevCritical
      if (sev === 'error')    return S.alertDetailSevError
      if (sev === 'warning')  return S.alertDetailSevWarning
      return S.alertDetailSevInfo
    }

    function _sevLabel(sev) {
      if (sev === 'critical') return t('alertSevCritical')
      if (sev === 'error')    return t('alertSevError')
      if (sev === 'warning')  return t('alertSevWarning')
      return t('alertSevInfo')
    }

    function _formatBytes(b) {
      if (b < 0) return '—'
      if (b === 0) return '0 B'
      if (b < 1024) return b + ' B'
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
      return (b / 1048576).toFixed(1) + ' MB'
    }

    function _hideAlertDetail() {
      if (_alertDetailOutsideHandler) {
        document.removeEventListener('keydown', _alertDetailOutsideHandler)
        _alertDetailOutsideHandler = null
      }
      if (_alertDetailEl && _alertDetailEl.parentNode) {
        _alertDetailEl.parentNode.removeChild(_alertDetailEl)
      }
      _alertDetailEl = null
    }

    /** Build and show the alert detail modal for a single alert. */
    function _showAlertDetail(alert) {
      // Remove any existing detail modal first
      _hideAlertDetail()

      var sev = alert.severity || 'info'

      // ── Mask ──────────────────────────────────────────────────────────
      var mask = document.createElement('div')
      Object.keys(S.alertDetailMask).forEach(function (k) { mask.style[k] = S.alertDetailMask[k] })
      // Layer: derived from `triggerLayer`, above the whole alert band, so the
      // panel can never cover an open modal. See the alert layer band.
      mask.style.zIndex = String(layerOfAlertDetail())

      // ── Modal card ────────────────────────────────────────────────────
      var modal = document.createElement('div')
      Object.keys(S.alertDetailModal).forEach(function (k) { modal.style[k] = S.alertDetailModal[k] })

      // ── Header ────────────────────────────────────────────────────────
      var head = document.createElement('div')
      Object.keys(S.alertDetailHead).forEach(function (k) { head.style[k] = S.alertDetailHead[k] })

      var iconSpan = document.createElement('span')
      Object.keys(S.alertDetailHeadIcon).forEach(function (k) { iconSpan.style[k] = S.alertDetailHeadIcon[k] })
      iconSpan.textContent = alert.icon || SEV_ICONS[sev] || '⚡'
      head.appendChild(iconSpan)

      var titleSpan = document.createElement('span')
      Object.keys(S.alertDetailHeadTitle).forEach(function (k) { titleSpan.style[k] = S.alertDetailHeadTitle[k] })
      titleSpan.textContent = _resolveAlertText(alert.title)
      head.appendChild(titleSpan)

      var closeBtn = document.createElement('button')
      closeBtn.setAttribute('data-dock-flash-focus', '')
      Object.keys(S.alertDetailHeadClose).forEach(function (k) { closeBtn.style[k] = S.alertDetailHeadClose[k] })
      closeBtn.textContent = '✕'
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation()
        _hideAlertDetail()
      })
      head.appendChild(closeBtn)

      modal.appendChild(head)

      // ── Body ──────────────────────────────────────────────────────────
      var body = document.createElement('div')
      Object.keys(S.alertDetailBody).forEach(function (k) { body.style[k] = S.alertDetailBody[k] })

      // Message
      var msgText = _resolveAlertText(alert.message)
      if (msgText) {
        var msgDiv = document.createElement('div')
        Object.keys(S.alertDetailMessage).forEach(function (k) { msgDiv.style[k] = S.alertDetailMessage[k] })
        msgDiv.textContent = msgText
        body.appendChild(msgDiv)
      }

      // Meta rows
      var metaDiv = document.createElement('div')
      Object.keys(S.alertDetailMeta).forEach(function (k) { metaDiv.style[k] = S.alertDetailMeta[k] })

      // Severity badge
      var sevRow = document.createElement('div')
      Object.keys(S.alertDetailMetaRow).forEach(function (k) { sevRow.style[k] = S.alertDetailMetaRow[k] })
      var sevLabel = document.createElement('span')
      Object.keys(S.alertDetailMetaLabel).forEach(function (k) { sevLabel.style[k] = S.alertDetailMetaLabel[k] })
      sevLabel.textContent = t('alertDetailSeverity')
      sevRow.appendChild(sevLabel)
      var sevBadge = document.createElement('span')
      Object.keys(S.alertDetailSevBadge).forEach(function (k) { sevBadge.style[k] = S.alertDetailSevBadge[k] })
      var sevStyle = _sevBadgeClass(sev)
      Object.keys(sevStyle).forEach(function (k) { sevBadge.style[k] = sevStyle[k] })
      sevBadge.textContent = _sevLabel(sev)
      sevRow.appendChild(sevBadge)
      metaDiv.appendChild(sevRow)

      // Timestamp
      var tsRow = document.createElement('div')
      Object.keys(S.alertDetailMetaRow).forEach(function (k) { tsRow.style[k] = S.alertDetailMetaRow[k] })
      var tsLabel = document.createElement('span')
      Object.keys(S.alertDetailMetaLabel).forEach(function (k) { tsLabel.style[k] = S.alertDetailMetaLabel[k] })
      tsLabel.textContent = t('alertDetailTime')
      tsRow.appendChild(tsLabel)
      var tsValue = document.createElement('span')
      Object.keys(S.alertDetailMetaValue).forEach(function (k) { tsValue.style[k] = S.alertDetailMetaValue[k] })
      tsValue.textContent = _formatTimestamp(alert.timestamp)
      tsRow.appendChild(tsValue)
      metaDiv.appendChild(tsRow)

      // Source (provider) — clickable link to navigate to the monitor config
      var srcLabel = _providerLabel(alert)
      if (srcLabel) {
        var srcRow = document.createElement('div')
        Object.keys(S.alertDetailMetaRow).forEach(function (k) { srcRow.style[k] = S.alertDetailMetaRow[k] })
        var srcKey = document.createElement('span')
        Object.keys(S.alertDetailMetaLabel).forEach(function (k) { srcKey.style[k] = S.alertDetailMetaLabel[k] })
        srcKey.textContent = t('alertDetailSource')
        srcRow.appendChild(srcKey)
        // If this provider has a navigable switch, render as a clickable link
        var canNavigate = !!_PROVIDER_SWITCH_MAP[alert._providerId]
        var srcVal = document.createElement(canNavigate ? 'a' : 'span')
        Object.keys(S.alertDetailMetaValue).forEach(function (k) { srcVal.style[k] = S.alertDetailMetaValue[k] })
        if (canNavigate) {
          Object.keys(S.alertDetailLink).forEach(function (k) { srcVal.style[k] = S.alertDetailLink[k] })
          srcVal.href = '#'
          srcVal.addEventListener('click', function (e) {
            e.preventDefault()
            e.stopPropagation()
            _hideAlertDetail()
            _navigateToAlertProvider(alert._providerId)
          })
        }
        srcVal.textContent = srcLabel
        srcRow.appendChild(srcVal)
        metaDiv.appendChild(srcRow)
      }

      body.appendChild(metaDiv)

      modal.appendChild(body)

      // ── Footer (delete alert) ────────────────────────────────────────
      if (alert.dismissible !== false) {
        var footer = document.createElement('div')
        Object.keys(S.alertDetailFooter).forEach(function (k) { footer.style[k] = S.alertDetailFooter[k] })
        var deleteBtn = document.createElement('button')
        Object.keys(S.alertDetailDeleteBtn).forEach(function (k) { deleteBtn.style[k] = S.alertDetailDeleteBtn[k] })
        deleteBtn.textContent = t('alertDetailDelete')
        deleteBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          var ar = _applyCtx && _applyCtx.get ? _applyCtx.get('dockFlashAlerts') : undefined
          if (ar) {
            // Dismiss merged group if present, otherwise single alert
            if (alert._groupIds && alert._groupIds.length > 1) ar.dismissMany(alert._groupIds)
            else ar.dismissAlert(alert.id)
          }
          _hideAlertDetail()
        })
        footer.appendChild(deleteBtn)
        modal.appendChild(footer)
      }

      // ── Assemble ─────────────────────────────────────────────────────
      mask.appendChild(modal)

      // Close on mask click (outside modal)
      mask.addEventListener('click', function (e) {
        if (e.target === mask) _hideAlertDetail()
      })

      // Close on Escape
      _alertDetailOutsideHandler = function (e) {
        if (e.key === 'Escape') _hideAlertDetail()
      }
      document.addEventListener('keydown', _alertDetailOutsideHandler)

      document.body.appendChild(mask)
      _alertDetailEl = mask

      // Focus the close button for keyboard accessibility
      try { closeBtn.focus() } catch (_) {}
    }

    // ── Master start/stop for all active display modes ─────────────────────
    var _alertDisplayActive = { toast: false, dropdown: false }
    var _alertDisplayRegistry = null

    function _startAlertDisplayMode(mode) {
      if (!_alertDisplayRegistry || _alertDisplayActive[mode]) return
      _alertDisplayActive[mode] = true
      switch (mode) {
        case 'toast': _startToastMode(_alertDisplayRegistry); break
        case 'dropdown': _startDropdownMode(_alertDisplayRegistry); break
      }
    }

    function _stopAlertDisplayMode(mode) {
      if (!_alertDisplayActive[mode]) return
      _alertDisplayActive[mode] = false
      switch (mode) {
        case 'toast': _stopToastMode(); break
        case 'dropdown': _stopDropdownMode(); break
      }
    }

    function _initAlertDisplayModes(alertRegistry) {
      _alertDisplayRegistry = alertRegistry
      // Dropdown is always on — start unconditionally
      _startAlertDisplayMode('dropdown')
      if (_getAlertDisplayMode('toast')) {
        _startAlertDisplayMode('toast')
      }
    }

    function _destroyAlertDisplayModes() {
      var modes = ['toast', 'dropdown']
      for (var i = 0; i < modes.length; i++) {
        _stopAlertDisplayMode(modes[i])
      }
      _alertDisplayRegistry = null
      _hideAlertDetail()
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

    /** Group display-ordered units into ROWS for the compact panel: two consecutive toggle-only
     *  units share a row, everything else keeps a row of its own.
     *
     *  CONSECUTIVE, not bucketed: the panel's full view already sorts an untouched group's toggles
     *  first, so pairing in display order reproduces that look without reordering anything — and a
     *  group the user HAS reordered keeps exactly their order, with its neighbours paired. Taking
     *  the toggles out of the list and pairing them separately would quietly undo that order in
     *  compact mode, which is the one thing the reorder feature exists to prevent.
     *
     *  `isGridToggle` is the existing predicate for "a toggle-only item" (`type === 'toggle'` with
     *  no cluster members), so a cluster headed by a toggle never pairs: it is a block, not a row.
     */
    function _pairToggleUnits(units) {
      var rows = []
      var i = 0
      while (i < units.length) {
        var u = units[i]
        var v = units[i + 1]
        if (isGridToggle(u) && v && isGridToggle(v)) {
          rows.push([u, v])
          i += 2
        } else {
          rows.push([u])
          i += 1
        }
      }
      return rows
    }

    /** The label column of a row: the ICON, then the text.
     *
     *  `minimal` is the compact panel — the icon stays, and every piece of text goes (`label`,
     *  `subtitle`, and the `ⓘ` tooltip that carries a longer description). Stated ONCE because
     *  six renderers draw this column, and "which text survives compact mode" has to have one
     *  answer: a rule re-implemented per renderer is how a panel ends up half-compact.
     *
     *  The ICON is not decoration here — with the text gone it is the only thing naming the row,
     *  which is why a switch without one still draws its (empty) column rather than collapsing
     *  the layout, so every row's control starts at the same place. */
    function _switchLabelColumn(sw, labelStyle, minimal, subtitleText, tooltipText, showBadge) {
      // In compact mode a few rows are better off WITHOUT their glyph, because the control beside
      // it already spells the row out and the icon column is width the control could be using.
      // `dock-flash:language` is the case that prompted it: a `buttongroup` reading 中文 / English
      // needs no globe to be understood. Kept as a list rather than a rule about `buttongroup`s,
      // because the same argument would strip the theme and skin selects, and those DO benefit
      // from a glyph at a glance.
      const iconEl = (sw.icon && !(minimal && COMPACT_ICONLESS_ROWS.indexOf(sw.id) !== -1))
        ? _switchIcon(sw.icon, S.switchIcon)
        : null
      if (minimal) {
        // With the text gone the icon is the row's only name, so the name follows the pointer:
        // `title` on the COLUMN rather than on the glyph, so it is reachable without aiming at a
        // 12px box. This is the whole reason that column is built in one place — an icon-only row
        // that cannot say what it is, is a puzzle.
        const name = typeof sw.label === 'function' ? sw.label() : sw.label
        return h('span', {
          // `flex: none`, NOT the `flex: 1` the column carries elsewhere. A column holding one
          // glyph has nothing to grow or shrink, and `flex: 1 1 0%` makes it shrink to ZERO in a
          // tight row — at which point the glyph, which cannot shrink, spills out of it.
          // MEASURED in a compact row at 140px before this: the column was 0px wide, the 12px icon
          // drew from 4..16, the dropdown began at 12, and they overlapped by 4px. With
          // `flex: none` the column IS the glyph (4..16), the dropdown starts at 24, and the 8px
          // gap survives by shrinking the dropdown to 112px instead.
          style: { ...labelStyle, flex: 'none' },
          ...(name ? { title: String(name) } : {}),
        }, iconEl)
      }
      // `minWidth` keeps the glyph inside its own column in the full panel too: the column
      // shrinks before the control does, and below 12px the icon would spill onto it. 18px is the
      // glyph plus the column's own 6px gap, so the icon is never the thing that gives way.
      return h('span', { style: { ...labelStyle, minWidth: '18px' } },
        iconEl,
        h('div', {
          style: { display: 'flex', flexDirection: 'column', minWidth: 0 },
          ...(tooltipText ? { title: tooltipText } : {}),
        },
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 } },
            h('span', {
              style: S.switchLabelText,
              title: (typeof sw.label === 'function' ? sw.label() : sw.label) || undefined,
            }, typeof sw.label === 'function' ? sw.label() : sw.label),
            // The badge and the hover text are NOT the same decision: `select` shows ⓘ for its
            // `tooltip`, while `number` shows it for `hint` (a range like `10–200`) and uses
            // `tooltip` only as the title. Defaulting to the tooltip keeps the select call sites
            // unchanged, and an explicit flag is what keeps the number row as it was.
            (showBadge === undefined ? !!tooltipText : !!showBadge)
              ? h('span', { style: S.infoIcon }, 'ⓘ') : null,
          ),
          subtitleText ? h('span', { style: S.switchSubtitle }, subtitleText) : null,
        ),
      )
    }

    /** Rows whose CONTROL already names itself in compact mode — see `_switchLabelColumn`. */
    var COMPACT_ICONLESS_ROWS = ['dock-flash:language']

    function renderToggleSwitch(sw, compact, minimal) {
      const on = !!safeGetValue(sw, false)
      const rowStyle = compact ? S.compactToggleRow : S.switchRow
      const labelStyle = compact ? S.compactToggleLabel : S.switchLabel
      // If the switch provides a `subtitle` (string or function), show it
      // as a secondary line below the label.
      const subtitleText = sw.subtitle
        ? (typeof sw.subtitle === 'function' ? sw.subtitle() : sw.subtitle)
        : null
      // `subtitleBlock` lifts the subtitle out of the label column and onto
      // its own full-width line below the row — same as select switches.
      const subtitleBlock = !minimal && !!sw.subtitleBlock && !!subtitleText
      // Config button: shown before the toggle when the switch is ON and
      // provides a `config` callback (used by the companion monitor toggles).
      const configBtn = (on && typeof sw.config === 'function')
        ? h('button', {
            type: 'button',
            style: S.monitorConfigBtn,
            title: t('monitorConfig'),
            onClick: (e) => { e.stopPropagation(); sw.config() },
          }, '⚙')
        : null
      const labelEl = _switchLabelColumn(sw, labelStyle, minimal,
        (!subtitleBlock && subtitleText) ? subtitleText : null, null)
      const toggleEl = h('div', {
        style: on ? S.toggleOn : S.toggle,
        role: 'switch',
        'aria-checked': String(on),
        'data-dock-flash-focus': '',
        tabIndex: 0,
        onClick: () => {
          const oldDisplay = on ? t('on') : t('off')
          const newDisplay = on ? t('off') : t('on')
          sw.setValue(!on)
          sw._notifyChange(oldDisplay, newDisplay)
        },
        onKeyDown: (e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            const oldDisplay = on ? t('on') : t('off')
            const newDisplay = on ? t('off') : t('on')
            sw.setValue(!on)
            sw._notifyChange(oldDisplay, newDisplay)
          }
        },
      },
        h('div', { style: on ? S.toggleThumbOn : S.toggleThumb })
      )
      if (!subtitleBlock) {
        return h('div', { style: rowStyle, key: sw.id, 'data-switch-id': sw.id }, labelEl, configBtn, toggleEl)
      }
      return h('div', { key: sw.id, 'data-switch-id': sw.id },
        h('div', { style: rowStyle }, labelEl, configBtn, toggleEl),
        h('div', { style: S.switchSubtitleBlock }, subtitleText),
      )
    }

    function renderSliderSwitch(sw, minimal) {
      const val = Number(safeGetValue(sw, 0)) || 0
      const min = sw.min ?? 0
      const max = sw.max ?? 100
      const step = sw.step ?? 1
      const pct = max > min ? Math.round(((val - min) / (max - min)) * 100) : 0
      // If the switch provides a `subtitle` (string or function), show it
      // as a secondary line below the label — same as toggle/select.
      const subtitleText = sw.subtitle
        ? (typeof sw.subtitle === 'function' ? sw.subtitle() : sw.subtitle)
        : null
      return h('div', { style: S.switchRow, key: sw.id, 'data-switch-id': sw.id },
        _switchLabelColumn(sw, S.switchLabel, minimal, subtitleText || null, null),
        h('div', { style: S.sliderRow },
          h('input', {
            type: 'range',
            min, max, step,
            value: val,
            style: S.slider,
            'data-dock-flash-focus': '',
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

    // Inject a style rule to hide the native spin buttons on number inputs
    // in WebKit browsers (Chrome/Safari). Firefox uses MozAppearance above.
    ;(function () {
      var id = 'dock-flash-number-input-style'
      if (document.getElementById(id)) return
      var s = document.createElement('style')
      s.id = id
      s.textContent = '.dock-flash-number-input::-webkit-inner-spin-button,.dock-flash-number-input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}'
      document.head.appendChild(s)
    })()
    // The compact panel hides its scrollbar. `scrollbar-width: none` covers Chrome 121+ and
    // Firefox, but WebKit ignores it and would draw a full-width bar in a 176px panel — the one
    // piece of chrome this mode is defined by not having. Scrolling itself stays: the wheel works,
    // and the alternative (clipping the overflow) would make rows unreachable.
    ;(function () {
      var id = 'dock-flash-compact-scroll-style'
      if (document.getElementById(id)) return
      var s = document.createElement('style')
      s.id = id
      s.textContent = '.dock-flash-compact-scroll::-webkit-scrollbar{width:0;height:0;display:none}'
      document.head.appendChild(s)
    })()

    function renderNumberSwitch(sw, minimal) {
      const val = Number(safeGetValue(sw, 0)) || 0
      const min = sw.min ?? 0
      const max = sw.max ?? 9999
      const step = sw.step ?? 1
      const hint = sw.hint ? (typeof sw.hint === 'function' ? sw.hint() : sw.hint) : null
      // If the switch provides a `subtitle` (string or function), show it
      // as a secondary line below the label — same as toggle/select.
      const subtitleText = sw.subtitle
        ? (typeof sw.subtitle === 'function' ? sw.subtitle() : sw.subtitle)
        : null
      // If the switch provides a `tooltip` (string or function), show an ℹ️ icon
      // with a native browser tooltip on hover — same as select switches. The
      // number switch's value is a bare digit, so the description is better
      // surfaced as hover text than as a single-line ellipsized subtitle (the
      // inline subtitle shares the row with the input and truncates the point).
      const tooltipText = sw.tooltip
        ? (typeof sw.tooltip === 'function' ? sw.tooltip() : sw.tooltip)
        : null
      return h('div', { style: S.switchRow, key: sw.id, 'data-switch-id': sw.id },
        // `!!hint` — the number row's ⓘ marks the RANGE, exactly as it did before this column
        // was shared, and `tooltipText` stays its hover text.
        _switchLabelColumn(sw, S.switchLabel, minimal, subtitleText || null, tooltipText || null, !!hint),
        h('div', { style: S.numberRow },
          h('input', {
            type: 'number',
            min, max, step,
            value: val,
            className: 'dock-flash-number-input',
            style: S.numberInput,
            'data-dock-flash-focus': '',
            onChange: (e) => {
              let newVal = Number(e.target.value)
              // Clamp to min/max
              if (newVal < min) newVal = min
              if (newVal > max) newVal = max
              const oldDisplay = sw.formatLabel ? sw.formatLabel(val) : String(val)
              const newDisplay = sw.formatLabel ? sw.formatLabel(newVal) : String(newVal)
              sw.setValue(newVal)
              sw._notifyChange(oldDisplay, newDisplay)
            },
            // Also commit on blur in case the user typed a value without
            // pressing Enter (some browsers don't fire onChange until blur).
            onBlur: (e) => {
              let newVal = Number(e.target.value)
              if (isNaN(newVal)) newVal = min
              if (newVal < min) newVal = min
              if (newVal > max) newVal = max
              // Write the clamped value back so the input shows the real state
              if (newVal !== Number(e.target.value)) {
                e.target.value = newVal
              }
              if (newVal !== val) {
                const oldDisplay = sw.formatLabel ? sw.formatLabel(val) : String(val)
                const newDisplay = sw.formatLabel ? sw.formatLabel(newVal) : String(newVal)
                sw.setValue(newVal)
                sw._notifyChange(oldDisplay, newDisplay)
              }
            },
          }),
          hint ? h('span', { style: S.numberHint }, hint) : null,
        ),
      )
    }

    /** The CONTROL half of a `select` switch — the dropdown itself, plus the ONE
     *  place that resolves the old/new display strings and hands the change to
     *  `setValue` + `_notifyChange`. Extracted from `renderSelectSwitch` so a
     *  member of an INLINE cluster can be drawn without its label column (see
     *  `renderInlineCluster`): the change path below is subtle enough (the
     *  `custom` prompts revert through `setValue` itself) that a second copy of
     *  it would be a second behaviour before long.
     *
     *  `title` names the control for a row that carries several — two dropdowns
     *  in one row are otherwise indistinguishable. It reaches the button's
     *  native tooltip AND its accessible name; `undefined` keeps the default,
     *  where a lone dropdown names itself with its selected option. */
    function selectControl(sw, title) {
      const current = safeGetValue(sw, '')
      const rawOpts = safeGetOptions(sw)
      return h(DSHSelectDropdown, {
        value: current,
        options: rawOpts,
        compact: false,
        title: title,
        ariaLabel: title,
        onSelect: (newVal) => {
          // Mirrors the old native <select> onChange verbatim: resolve the old
          // and new display strings via the option plumbing, then setValue with
          // ONLY the string value and let _notifyChange record the change. For
          // any `custom` prompt switch, setValue itself owns
          // the cancel/revert via registry.notifyChange — which re-renders this
          // component and re-derives the label from the CURRENT value.
          if (current !== newVal) {
            const oldOpt = rawOpts.find((o) => optionValueFor(o) === current)
            const oldDisplay = oldOpt ? optionLabelFor(oldOpt, current) : String(current)
            const newOpt = rawOpts.find((o) => optionValueFor(o) === newVal)
            const newDisplay = newOpt ? optionLabelFor(newOpt, newVal) : newVal
            sw.setValue(newVal)
            sw._notifyChange(oldDisplay, newDisplay)
          }
        },
      })
    }

    function renderSelectSwitch(sw, minimal) {
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
      const subtitleBlock = !minimal && !!sw.subtitleBlock && !!subtitleText
      const labelEl = _switchLabelColumn(sw, S.switchLabel, minimal,
        (!subtitleBlock && subtitleText) ? subtitleText : null, tooltipText || null)
      const selectEl = selectControl(sw)
      if (!subtitleBlock) {
        return h('div', { style: S.switchRow, key: sw.id, 'data-switch-id': sw.id }, labelEl, selectEl)
      }
      return h('div', { key: sw.id, 'data-switch-id': sw.id },
        h('div', { style: S.switchRow }, labelEl, selectEl),
        h('div', { style: S.switchSubtitleBlock }, subtitleText),
      )
    }

    function renderActionSwitch(sw, minimal) {
      // `hideLabel` drops the title column for an action whose button already
      // carries its own wording (`actionLabel`) — without it the same text
      // prints twice, once as a title and once on the button.
      // The definition keeps `label` regardless: that is what the changelog and
      // the panel name the entry with, so hiding it here costs no bookkeeping.
      const actionText = typeof sw.actionLabel === 'function' ? sw.actionLabel() : (sw.actionLabel || t('action'))
      // Compact mode drops the title column AND the button's own wording, so the button shows
      // the switch's icon. An icon-only button has to name itself somehow, so the text it lost
      // becomes its `title` — the same wording, on hover instead of taking a row's width.
      const labelEl = (sw.hideLabel || minimal)
        ? null
        : h('span', { style: S.switchLabel },
            sw.icon ? _switchIcon(sw.icon, S.switchIcon) : null,
            h('span', null, typeof sw.label === 'function' ? sw.label() : sw.label),
          )
      // DSH Button.module.css outline variant: hover→interactive-bg-hover,
      // active→interactive-bg-active, transparent bg at rest.
      const btnStyle = sw.hideLabel
        ? Object.assign({}, S.btnAction, { width: '100%' })
        : S.btnAction
      return h('div', { style: S.switchRow, key: sw.id, 'data-switch-id': sw.id },
        labelEl,
        h('button', {
          style: btnStyle,
          ...(minimal ? { title: actionText, 'aria-label': actionText } : {}),
          'data-dock-flash-focus': '',
          onMouseEnter: function (e) {
            e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, #2631480f)'
          },
          onMouseLeave: function (e) {
            e.currentTarget.style.background = 'transparent'
          },
          onMouseDown: function (e) {
            e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-active, #2631481a)'
          },
          onMouseUp: function (e) {
            e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, #2631480f)'
          },
          onClick: function () {
            if (sw.run) sw.run()
            sw._notifyChange('', t('action'))
          },
        }, (minimal && sw.icon) ? _switchIcon(sw.icon, S.switchIcon) : actionText),
      )
    }

    function renderButtonGroupSwitch(sw, minimal) {
      const current = safeGetValue(sw, '')
      const rawOpts = safeGetOptions(sw)
      const selectedIndex = rawOpts.findIndex((o) => o.value === current)
      const count = rawOpts.length
      // Sliding indicator: positioned absolutely inside the track (S.btnGroup).
      // Width and transform are computed from segment count and selected index,
      // matching DSH SegmentedControl.module.css's grid-based arithmetic.
      const indicatorStyle = count > 0 && selectedIndex >= 0
        ? Object.assign({}, S.btnGroupIndicator, {
            width: 'calc((100% - 8px - 2px * ' + (count - 1) + ') / ' + count + ')',
            transform: 'translateX(calc(' + selectedIndex + ' * (100% + 2px)))',
          })
        : null
      return h('div', { style: S.switchRow, key: sw.id, 'data-switch-id': sw.id },
        _switchLabelColumn(sw, S.switchLabel, minimal, null, null),
        h('div', { style: S.btnGroup },
          indicatorStyle ? h('div', { style: indicatorStyle }) : null,
          rawOpts.map((opt, i) => {
            const isActive = current === opt.value
            return h('button', {
              key: String(opt.value),
              style: isActive ? S.btnActive : S.btn,
              'data-dock-flash-focus': '',
              // Hover lifts an inactive tab's label to primary (DSH
              // SegmentedControl hover behaviour); the slide indicator handles
              // the selected state, so only the label colour moves here.
              onMouseEnter: (e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--dsw-alias-label-primary, #000)'
              },
              onMouseLeave: (e) => {
                if (!isActive) e.currentTarget.style.color = 'var(--dsw-alias-label-secondary, #666)'
              },
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
      return h('div', { key: sw.id, style: S.logBlock, 'data-switch-id': sw.id },
        h('div', { style: S.logHead },
          sw.icon ? _switchIcon(sw.icon, S.switchIcon) : null,
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

    function renderSwitch(sw, force, minimal) {
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
        // The GRID form is the caller's choice — `toggles.map((u) => renderToggleSwitch(u.members[0], true))`
        // — so this dispatch always draws the full-width row; only `minimal` belongs here.
        case 'toggle': return renderToggleSwitch(sw, false, minimal)
        case 'slider': return renderSliderSwitch(sw, minimal)
        case 'number': return renderNumberSwitch(sw, minimal)
        case 'select': return renderSelectSwitch(sw, minimal)
        case 'buttongroup': return renderButtonGroupSwitch(sw, minimal)
        case 'action': return renderActionSwitch(sw, minimal)
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
     *  That is not cosmetic: a typical cluster is a mode select, a dependent
     *  option, a button that runs a test, and a log that reports the result —
     *  and some members may be hidden until their condition is met, with the
     *  log hidden until the first run. Reordered individually they could
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
      // superCluster: a cluster can declare a parent cluster label.
      // Child clusters are rendered inside the parent's expanded body
      // instead of as top-level units.
      const bySuperCluster = new Map()
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
          superCluster: (label !== null && typeof sw.superCluster === 'string' && sw.superCluster)
            ? sw.superCluster : null,
        }
        if (label !== null) {
          byCluster.set(label, unit)
          if (unit.superCluster) {
            if (!bySuperCluster.has(unit.superCluster)) bySuperCluster.set(unit.superCluster, [])
            bySuperCluster.get(unit.superCluster).push(unit)
          }
        }
        units.push(unit)
      }
      // Move child clusters into their parent's `children` array
      // and remove them from top-level units.
      if (bySuperCluster.size > 0) {
        const childKeys = new Set()
        for (const [parentLabel, children] of bySuperCluster) {
          const parent = byCluster.get(parentLabel)
          if (parent) {
            parent.children = children
            for (const child of children) childKeys.add(child.key)
          }
        }
        // Remove children from top-level; they render inside the parent
        return units.filter((u) => !childKeys.has(u.key))
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
    /** Does COMPACT mode drop this whole cluster — head included?
     *
     *  The user's rule, stated once: "when the cluster's switch is off, show none of it". Two
     *  readings of "off" are needed because clusters declare it in two different ways, and the
     *  first is the structural one the fold control already relies on:
     *
     *    - every member after the head is `visible()`-false. That is how a member says "I belong
     *      to the master" (`visible: () => _getAlertsOn()`), so their disappearance IS the master
     *      being off — independent of what type the head is;
     *    - or the head is a toggle that reads OFF, which covers a cluster whose members are gated
     *      on something else entirely.
     *
     *  A cluster with a SINGLE member is never dropped: with no second member, "the rest went
     *  away" cannot mean anything, and hiding the only row would lose a working control. */
    function _compactDropsCluster(unit) {
      var members = (unit.members || []).filter(isSwitchAvailable)
      if (members.length === 0) return true
      if (unit.members.length === 1) return false
      var head = members[0]
      var rest = members.slice(1)
      var children = unit.children || []
      var liveChildren = children.filter(function (ch) {
        return ch.members.filter(isSwitchAvailable).length > 0
      })
      if (rest.length === 0 && liveChildren.length === 0) return true
      return head.type === 'toggle' && !safeGetValue(head, true)
    }

    function isSwitchAvailable(sw) {
      return typeof sw.visible !== 'function' || !!sw.visible()
    }
    function unitAvailable(unit) {
      return unit.members.some(isSwitchAvailable)
    }
//#endregion ───────────────────────────────────────────────────────────────────

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
      // Cluster fold state, keyed by unit key. Absent means folded (the fresh
      // default), so a fold that was never touched stays folded and nothing
      // springs open on its own. Persisted in localStorage so an explicit
      // expand/collapse choice survives a page refresh.
      const CLUSTER_FOLD_KEY = 'dock-flash:cluster-fold'
      const readClusterFold = () => {
        try {
          const raw = JSON.parse(localStorage.getItem(CLUSTER_FOLD_KEY) || 'null')
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
        } catch (_) {}
        return {}
      }
      const [clusterFold, setClusterFold] = useState(readClusterFold)
      const toggleClusterFold = (key) => {
        const wasOpen = typeof clusterFold[key] === 'boolean' ? clusterFold[key] : false
        const next = { ...clusterFold, [key]: !wasOpen }
        setClusterFold(next)
        try { localStorage.setItem(CLUSTER_FOLD_KEY, JSON.stringify(next)) } catch (_) {}
      }
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

          // A portaled dropdown list anchored to a panel select is part of the
          // panel, but lives on <body> — exempt it in BOTH paths below or
          // choosing an option from a floating window or sidebar panel closes
          // the panel behind it.
          if (e.target && e.target.closest && e.target.closest('[data-dock-flash-dropdown]')) return

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
      // down right now (e.g. a cluster's dependent controls while their condition
      // is unmet, or the turn-rail switch while DSH's rail is unrecognised).
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
      // condition changes (e.g. via its own notifyChange call).
      // Companion plugins whose switches should appear in the Workbench tab
      // alongside dock-flash's own (treated as built-in for tab routing).
      // Derived, not restated: a new companion is one entry in `_COMPANIONS`, and the
      // panel's built-in grouping, the source labels and the missing-companion hint all
      // follow from it. Spelling the prefixes out again here is how the lists drift.
      var _COMPANION_PREFIXES = _COMPANIONS.map(function (c) { return c.prefix })
      function _isBuiltInSwitch(sw) {
        var id = String(sw.id)
        return id.startsWith('dock-flash:') || _COMPANION_PREFIXES.some(function (p) { return id.startsWith(p) })
      }
      const builtIn = allSwitches.filter(_isBuiltInSwitch)
      const thirdParty = allSwitches.filter((sw) => !_isBuiltInSwitch(sw))

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
       *  which keeps a cluster — a mode select plus dependent options,
       *  a button and a log — from dominating a panel this short. The
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

      /** An INLINE cluster, as ONE row: the cluster's own title on the left, its
       *  members' controls side by side on the right. Declared by
       *  `clusterInline: true` on EVERY member — and every member a `select`;
       *  `renderCluster` says why anything else drops the unit back to a card.
       *
       *  No fold row here, deliberately: a fold hides members behind the head,
       *  and this form has nowhere to hide them, because the row IS the whole
       *  cluster. So this is the one cluster form that does not end in the fold
       *  control — the exception AGENTS.md records.
       *
       *  The title is read from the first member that declares `clusterLabel`, so
       *  either end of the pair may own it, while the members keep their own
       *  `label` for the changelog and for their tooltip: the row's title says
       *  what the PAIR is, each control's tooltip says which half is which. */
      function renderInlineCluster(unit, force) {
        const members = force ? unit.members : unit.members.filter(isSwitchAvailable)
        if (members.length === 0) return null
        const titleOwner = unit.members.find((m) => m.clusterLabel !== undefined && m.clusterLabel !== null)
        const title = titleOwner
          ? (typeof titleOwner.clusterLabel === 'function' ? titleOwner.clusterLabel() : titleOwner.clusterLabel)
          : ''
        return h('div', { key: unit.key, style: minimal ? S.clusterCardMinimal : S.clusterCard, 'data-switch-id': members[0].id },
          h('div', { style: S.clusterInlineRow },
            h('span', { style: S.clusterInlineLabel },
              // The head's icon anchors the title row the way every other row's
              // icon does; the members' own icons are dropped rather than doubled.
              unit.members[0].icon ? _switchIcon(unit.members[0].icon, S.switchIcon) : null,
              h('span', { style: S.clusterInlineTitle, title: title }, title),
            ),
          ),
          // The controls get their OWN row, right-aligned
          // (S.clusterInlineControls sets justifyContent: 'flex-end'), instead of
          // sharing the title's: two dropdowns plus a label do not fit on one row
          // here, and the values were what got ellipsized away.
          h('div', { style: S.clusterInlineControls },
            members.map((sw) => h('div', { key: sw.id, style: minimal ? S.clusterInlineCellMinimal : S.clusterInlineCell },
              selectControl(sw, typeof sw.label === 'function' ? sw.label() : sw.label),
            )),
          ),
        )
      }

      /** The fold control: the card's LAST row, one full-width hit strip.
       *
       *  `foldable` is the caller's answer to "is there a body to fold?" — it is
       *  what keeps the control from being DEAD. A cluster whose members are all
       *  standing down has nothing behind the fold: that is exactly the case
       *  after the cluster's master switch goes OFF, because every other member is
       *  gated on it (`visible: () => _getAlertsOn()`), so `rest` and the child
       *  clusters both filter away to nothing while the head itself stays. The
       *  same reasoning that drops the control while reordering applies here — a
       *  dead control is worse than a long block.
       *
       *  Static and hover colours are DIFFERENT on purpose. The button is
       *  transparent apart from its glyph, so on a widened, full-row target the
       *  only thing that shows the user where the strip is, is the hover tint.
       *  Both handlers restore the values the style itself declares, so the two
       *  states can never drift from `S.clusterFoldBtn`. */
      function clusterFoldControl(unit, open, foldable) {
        if (editing || !foldable) return null
        return h('div', { style: S.clusterFoldRow },
          h('button', {
            type: 'button',
            style: S.clusterFoldBtn,
            title: t(open ? 'collapse' : 'expand'),
            'aria-label': t(open ? 'collapse' : 'expand'),
            'aria-expanded': open ? 'true' : 'false',
            onMouseEnter: (e) => {
              e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))'
              e.currentTarget.style.color = 'var(--dsw-alias-label-primary, #cfd3d6)'
            },
            onMouseLeave: (e) => {
              e.currentTarget.style.background = S.clusterFoldBtn.background
              e.currentTarget.style.color = S.clusterFoldBtn.color
            },
            onClick: (e) => {
              e.stopPropagation()
              toggleClusterFold(unit.key)
            },
          }, open ? '▲' : '▼'),
        )
      }

      /** A cluster, as ONE card: the head switch always on show, the remaining
       *  members behind a fold. The same card is drawn in and out of edit mode,
       *  so the block the ▲▼ moves is exactly the block the user sees; while
       *  reordering the cluster is forced open and the fold button is not drawn
       *  at all, because the body is click-through there and a dead control is
       *  worse than a long block. */
      function renderCluster(unit, force) {
        // ── Two forms, and the DECLARATION picks one ──────────────────────
        // An inline cluster is one row of side-by-side `select`s. The test reads
        // ALL members — never just the available ones — so a member going
        // unavailable cannot flip the shape under the user; that stability is
        // what the fold buys a stacked cluster. A member that is not a `select`
        // cannot be drawn label-lessly in that row, so it drops the whole unit
        // back to the card rather than being left out of a block it cannot fit.
        if (unit.members.length > 1 &&
            unit.members.every((m) => m.clusterInline === true && m.type === 'select')) {
          return renderInlineCluster(unit, force)
        }
        // Outside an editing mode a cluster draws only its AVAILABLE members, so
        // a `visible()`-false member cannot leave an empty slot on the card.
        // (Editing modes pass `force`, and show the member dimmed instead.)
        const members = force ? unit.members : unit.members.filter(isSwitchAvailable)
        if (members.length === 0 && !(unit.children && unit.children.length)) return null
        const head = members[0]
        const rest = members.slice(1)
        // Forced open while editing, in BOTH modes: reordering has to show the
        // whole block it moves, and hiding has to show what is being hidden.
        const open = editing || clusterIsOpen(unit)
        // Child clusters: sub-clusters declared via superCluster, rendered as
        // nested cards inside this parent's expanded body.
        const children = unit.children || []
        const visibleChildren = force
          ? children
          : children.filter((ch) => {
              const chMembers = ch.members.filter(isSwitchAvailable)
              return chMembers.length > 0
            })
        // ── Compact panel: two rules, one of them asked for by name ────────
        //
        // (1) A cluster whose master switch is OFF contributes nothing to a quick-access strip,
        //     so the WHOLE unit goes, head included. The evidence is the same structural one the
        //     fold control already uses — every member after the head is `visible()`-false, which
        //     is how the members declare "I belong to the master" — plus the direct case of a
        //     toggle head that reads OFF, for a cluster whose members are gated on something else.
        //     A one-member cluster is never dropped this way: with no `rest`, its emptiness could
        //     mean anything. The way back is the double-click, which restores the full panel.
        // (2) Otherwise the card is FLATTENED — no card, no title, no fold row; its members become
        //     plain rows. A fold is chrome, and chrome is what this mode removes.
        if (minimal) {
          if (_compactDropsCluster(unit)) return null
          return h('div', { key: unit.key, 'data-switch-id': head.id },
            members.map((sw) => renderSwitch(sw, force, true)),
            visibleChildren.map((ch) => renderCluster(ch, force)),
          )
        }
        return h('div', { key: unit.key, style: S.clusterCard, 'data-switch-id': head.id },
          renderSwitch(head, force),
          open
            ? h('div', { style: S.clusterBody },
                rest.map((sw) => renderSwitch(sw, force)),
                // Render child clusters as nested cards within the parent body
                visibleChildren.map((child) => renderChildCluster(child, force)),
              )
            : null,
          // The fold control is the card's LAST row and sits in the middle: it
          // reads as the edge of the block rather than as a decoration beside the
          // head, and the arrow points the way the click will move the content —
          // down to reveal it, up to tuck it away. No count: the card's height
          // already says whether anything is folded, and a number beside a
          // triangle reads as a badge rather than as a control. It is dropped
          // when the body is empty — see `clusterFoldControl`.
          clusterFoldControl(unit, open, rest.length > 0 || visibleChildren.length > 0),
        )
      }

      /** A child cluster rendered inside its parent's expanded body.
       *  Visually a nested card with its own fold, indented to show
       *  hierarchy.  The head shows the cluster label, members are
       *  behind the child's own fold. */
      function renderChildCluster(unit, force) {
        const members = force ? unit.members : unit.members.filter(isSwitchAvailable)
        if (members.length === 0) return null
        const head = members[0]
        const rest = members.slice(1)
        const childOpen = editing || clusterIsOpen(unit)
        return h('div', { key: unit.key, style: S.clusterChildCard, 'data-switch-id': head.id },
          renderSwitch(head, force),
          childOpen
            ? h('div', { style: S.clusterBody }, rest.map((sw) => renderSwitch(sw, force)))
            : null,
          clusterFoldControl(unit, childOpen, rest.length > 0),
        )
      }

      /** One unit outside edit mode: a single switch, or a cluster card whose
       *  members keep their fixed internal order. */
      function renderUnit(unit, force) {
        if (unit.members.length === 1) return renderSwitch(unit.members[0], force, minimal)
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
      /** Compact mode's rows for one group: paired toggles in a two-column grid, everything else
       *  as a full-width row. The pairing itself is `_pairToggleUnits`, so the console hook and
       *  the renderer cannot disagree about what shares a row. */
      function renderMinimalRows(units) {
        return _pairToggleUnits(units).map((row, i) => {
          if (row.length === 2) {
            return h('div', { key: 'pair-' + row[0].key, style: S.compactToggleGridTight },
              renderToggleSwitch(row[0].members[0], true, true),
              renderToggleSwitch(row[1].members[0], true, true),
            )
          }
          var u = row[0]
          if (isGridToggle(u)) {
            return h('div', { key: u.key, style: S.compactToggleGridTight },
              renderToggleSwitch(u.members[0], true, true))
          }
          return renderUnit(u, false, true)
        })
      }

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
        // Compact: no group TITLE (it is text) and no editing branches — the entry points for
        // those are not drawn either, so they are unreachable here rather than merely unhandled.
        // The toggle grid is kept: icon-only chips in two columns are exactly what this mode is
        // for, and it is what keeps the strip short.
        if (minimal) return h('div', { key: groupKey }, ...renderMinimalRows(units))
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
        // Compact: the source-plugin heading is text, so it goes, and the rows follow the rest.
        if (minimal) {
          return h('div', { key: source, style: { marginBottom: '6px' } }, ...renderMinimalRows(units))
        }
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

      // ── Compact panel ────────────────────────────────────────────────────
      // The mode is a PREFERENCE (the double-click on the ⚡ is its switch) — but it applies to
      // the panel dock-flash OWNS, and to that one only. `props.standalone` is what says so: the
      // standalone floating panel is mounted by `renderPanel()` with `standalone: true`, while
      // dock-base mounts the very same component in its own sidebar (and in its floating window)
      // and passes none of that.
      //
      // This is not a nicety. The first version read the preference unconditionally, and the
      // docked panel then drew icon-only rows, no tab headers and no group titles inside
      // dock-base's normal-width pane — the workbench panel looked broken, because a mode
      // designed to strip chrome from a floating strip was being asked to strip it from somebody
      // else's window. A preference is not a licence to restyle a surface the plugin does not own.
      const minimal = _compactPanelForSurface(props)

      /** Is this page drawn WITHOUT a tab header in compact mode? Stated once, because the two
       *  halves — "do not draw the header" and "do not let it be collapsed" — have to agree:
       *  drawing no header for a page the user can still fold would hide its rows for good. */
      const compactPageAlwaysOpen = (page) => minimal && page.id === 'workbench'

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
      if (hasWorkbench) pages.push({ id: 'workbench', icon: 'sliders', label: L('builtinGroup'), order: true })
      if (hasExtensions) pages.push({ id: 'extensions', icon: 'blocks', label: L('thirdPartyGroup'), order: true })
      // The Changes page is a text log, so compact mode does not offer it at all.
      if (hasChanges && !minimal) pages.push({ id: 'changes', icon: 'doc', label: L('recentChange') })


      const orderable = builtIn.length + thirdParty.length > 0

      // Console hook: `__dockFlashPanelOrder()` reports the order THIS render
      // resolved next to what is actually persisted, so "why is it displayed
      // like this?" — not customized, customized but looking at another
      // surface, or a stale bundle — is answerable instead of guessed at.
      // Assigned during render deliberately: it is a snapshot of the render it
      // came from, not state.
      try {
        window.__dockFlashCompactMode = (standalone) => _compactPanelForSurface({ standalone })
      } catch (_) {}
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
          // Compact mode, and WHICH clusters it is hiding. The rule drops a whole cluster when
          // its master switch is off, and "why is that block not here?" is otherwise answerable
          // only by reading this file — so it reports its own decision, the same way the two
          // editing modes do.
          compact: {
            on: minimal,
            // The surface: the docked panel is never compact, and this is how that is checked.
            surfaceStandalone: props.standalone === true,
            alertBar: !minimal,
            pages: pages.map((pg) => pg.id),
            headerlessPages: pages.filter(compactPageAlwaysOpen).map((pg) => pg.id),
            // Rows compact mode draws without their glyph — answerable, because "why is there no
            // icon beside 语言?" is otherwise a question for the source.
            // Which toggles share a row — the pairing is otherwise only visible in the layout.
            pairedToggleRows: !minimal ? [] : builtInKeys
              .map((g) => displayUnits(panelOrder.switches['builtin:' + g], builtInGroups.get(g), true))
              .concat(extKeys.map((src) => displayUnits(panelOrder.switches['ext:' + src], thirdPartyGroups.get(src), false)))
              .flatMap((units) => _pairToggleUnits(units).filter((row) => row.length === 2)
                .map((row) => row.map((u) => u.members[0].id))),
            iconless: !minimal ? [] : COMPACT_ICONLESS_ROWS.filter((id) =>
              allSwitches.some((sw) => sw.id === id)),
            droppedClusters: !minimal ? [] : builtInKeys
              .map((g) => displayUnits(panelOrder.switches['builtin:' + g], builtInGroups.get(g), true))
              .concat(extKeys.map((src) => displayUnits(panelOrder.switches['ext:' + src], thirdPartyGroups.get(src), false)))
              .flat()
              .filter((u) => _compactDropsCluster(u))
              .map((u) => u.key),
          },
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
        // Fold identical alerts (same resolved title + message) into one row.
        // The panel is the one surface where a flood of duplicate lines is
        // noise; dropdown keeps the unmerged list.
        const merged = mergeAlertsForDisplay(panelAlerts)
        const dismissGroup = (alert) => {
          if (!ar) return
          if (alert._groupIds && alert._groupIds.length > 1) ar.dismissMany(alert._groupIds)
          else ar.dismissAlert(alert.id)
        }
        return h('div', { key: 'alert-bar', style: S.alertBar },
          ...merged.map((alert) =>
            h('div', {
              key: alert.id,
              style: { ...S.alertItem, ...severityStyle(alert.severity), cursor: 'pointer' },
              onClick: (e) => {
                // Don't open detail when the dismiss button was clicked
                if (e.target.tagName === 'BUTTON') return
                _showAlertDetail(alert)
              },
            },
              h('span', { style: S.alertItemIcon }, alert.icon || '⚠️'),
              h('span', { style: S.alertItemText, flex: 1 },
                typeof alert.title === 'function' ? alert.title() : alert.title,
                alert.message ? ': ' + (typeof alert.message === 'function' ? alert.message() : alert.message) : '',
                alert._groupCount > 1
                  ? h('span', { style: S.alertItemCount }, ' ×' + alert._groupCount)
                  : null,
              ),
              alert.dismissible !== false
                ? h('button', {
                    style: S.alertDismissBtn,
                    onClick: (e) => { e.stopPropagation(); dismissGroup(alert) },
                    title: t('alertDismissAll'),
                  }, '×')
                : null,
            )
          ),
          merged.length > 1
            ? h('div', { style: S.alertDismissAllBar },
                h('button', {
                  style: S.alertDismissAllBtn,
                  onClick: () => { if (ar) ar.dismissAll() },
                }, t('alertDismissAll'))
              )
            : null,
        )
      }

      // ── Render the tab header for a given page ──
      const renderTabHeader = (page, pi) => {
        const isOpen = openTabs.has(page.id)
        const isLast = pi === pages.length - 1
        // Compact: the tab IS its glyph — the same shapes as everywhere else, which is why the
        // page icons are meaningful (`sliders` / `blocks`) rather than decoration. The whole
        // right-hand row is absent, so this mode offers no reordering and no visibility editing;
        // the label survives only as a `title`, so hovering still names the tab.
        // The Workbench page has NO header in compact mode: its controls ARE the panel, so a
        // chip that only collapsed them would be a whole row of chrome for nothing — and with
        // `compactPageAlwaysOpen()` it can no longer be collapsed, which is what makes returning
        // null safe rather than a page the user cannot fold. The other pages keep their chips.
        if (minimal && compactPageAlwaysOpen(page)) return null
        if (minimal) {
          return h('div', {
            key: page.id,
            style: isOpen ? S.tabChipOpen : S.tabChip,
            title: page.label(),
            'data-dock-flash-focus': '',
            onClick: () => toggleTab(page.id),
          }, _switchIcon(page.icon, S.switchIcon))
        }
        // Closed: standalone card. Open: top half of a joined card
        // (header + body share one border, no visual separation).
        const headerStyle = isOpen
          ? S.tabPageHeaderOpen
          : (isLast ? S.tabPageHeaderClosedLast : S.tabPageHeaderClosed)
        return h('div', {
          key: page.id,
          style: headerStyle,
          onClick: () => toggleTab(page.id),
        },
          // While a notice is live for THIS tab, the title becomes the message:
          // same slot, same type scale, so nothing reflows beyond the text
          // itself. Four actions report here, hence the four `kind`s.
          orderNotice && orderNotice.tab === page.id
            ? h('span', { style: S.tabPageHeaderNotice }, _switchIcon(page.icon, S.switchIcon), ' ',
                t(orderNotice.kind === 'reset' ? 'orderResetDone'
                  : orderNotice.kind === 'visReset' ? 'visResetDone'
                  : orderNotice.kind === 'visSaved' ? 'visSaved' : 'orderSaved'))
            : h('span', { style: S.tabPageHeaderTitle }, _switchIcon(page.icon, S.switchIcon), ' ', page.label()),
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
                    ensureTabOpen(page.id)
                    const leaving = visibilityEdit
                    setVisibilityEdit((v) => !v)
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
                    ensureTabOpen(page.id)
                    const leaving = orderEdit
                    setOrderEdit((v) => !v)
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
                  title: t(visibilityEdit ? 'visReset'
                    : page.id === 'extensions' ? 'orderResetExt' : 'orderReset'),
                  'aria-label': t(visibilityEdit ? 'visResetShort' : 'orderResetShort'),
                  onClick: (e) => {
                    e.stopPropagation()
                    if (visibilityEdit) {
                      clearPanelHidden(page.id)
                      setOrderNotice({ tab: page.id, kind: 'visReset' })
                    } else {
                      clearPanelOrder(page.id)
                      setOrderNotice({ tab: page.id, kind: 'reset' })
                    }
                    bumpOrder()
                    setTimeout(() => setOrderNotice(null), 1600)
                  },
                }, '↺')
              : null,
            // Full-size triangle, same family as the cluster's fold control;
            // the open state is this glyph rotated, which keeps the CSS
            // transition and turns `▶` into the same `▼` the card uses.
            h('span', { style: isOpen ? S.tabPageChevronOpen : S.tabPageChevron }, '▶'),
          ),
        )
      }

      // ── Render the tab body for a given page (used in the scrollable body area) ──
      const renderTabBody = (page) => {
        return h('div', { key: page.id, style: minimal ? S.tabPageBodyMinimal : S.tabPageBodyJoined },
          page.id === 'workbench'
            ? builtInDraw.map((g, i) => renderBuiltInGroup(g, builtInGroups.get(g), i === 0))
          : page.id === 'extensions'
            ? extDraw.map((source, i) => renderExtGroup(source, thirdPartyGroups.get(source), i))
            : page.id === 'changes'
              ? registry.getChangelog().slice(-5).reverse().map((entry, i) =>
                  h('div', { key: entry.ts + '-' + i, style: S.changeLogEntry },
                    entry.icon
                      ? _switchIcon(entry.icon, S.changeLogIcon)
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
      }

      // ── Navigate to a target switch — dual mechanism ────────────────────
      // Two paths carry the navigation signal, and both are needed:
      //
      //  1) _pendingNavTarget (module-level variable): read on MOUNT.
      //     Covers the case where the panel was not open and the component
      //     hasn't mounted yet — a DOM event would be lost because no
      //     listener exists.
      //
      //  2) 'dock-flash:navigate' CustomEvent: listened for on document.
      //     Covers the case where the panel IS already mounted — setting a
      //     module variable alone can't wake the component because it causes
      //     no re-render.
      //
      // Both paths converge on _doNavigate() below.

      var _doNavigate = function (targetId) {
        if (!targetId) return

        // Ensure the workbench tab is open (functional update reads latest state)
        setOpenTabs(function (prev) {
          if (prev.has('workbench')) return prev
          var n = new Set(prev); n.add('workbench'); return n
        })

        // Expand the system-alerts cluster if the target belongs to it
        var systemAlertSwitches = [
          'dock-flash:system-alerts',
          'dock-flash:alert-toast',
          'dsh-flash-ctx-mon:monitor-context',
          'dsh-flash-mem-mon:monitor-memory',
          'dsh-flash-net-mon:monitor-network',
          'dock-flash:host-alert-queue-cap',
          'dock-flash:host-alert-max-age',
        ]
        if (systemAlertSwitches.indexOf(targetId) >= 0) {
          setClusterFold(function (prev) {
            var foldKey = '\u0000cluster:system-alerts'
            var wasOpen = typeof prev[foldKey] === 'boolean' ? prev[foldKey] : false
            if (wasOpen) return prev
            var next = Object.assign({}, prev)
            next[foldKey] = true
            try { localStorage.setItem('dock-flash:cluster-fold', JSON.stringify(next)) } catch (_) {}
            return next
          })
        }

        // Scroll to the target element after the tab/cluster state settles.
        // Two rAF frames: one for React to commit the state changes above,
        // one for the browser to paint the new DOM.  A small retry loop
        // handles the case where the panel has not yet finished mounting
        // (e.g. the component was just created by openView).
        var _scrollAttempts = 0
        var _maxScrollAttempts = 5
        function _tryScrollToSwitch() {
          var el = document.querySelector('[data-switch-id="' + targetId + '"]')
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            // Brief highlight
            el.style.transition = 'background 0.3s'
            el.style.background = 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 20%, transparent)'
            setTimeout(function () {
              el.style.background = ''
            }, 1500)
            // If the target switch has a config() callback (monitor toggles),
            // invoke it so the user lands directly on the monitor configuration
            // page rather than just the toggle row.
            if (registry) {
              var sw = registry.getSwitches().find(function (s) { return s.id === targetId })
              if (sw && typeof sw.config === 'function') {
                try { sw.config() } catch (_) {}
              }
            }
          } else if (++_scrollAttempts < _maxScrollAttempts) {
            requestAnimationFrame(_tryScrollToSwitch)
          }
        }
        requestAnimationFrame(function () {
          requestAnimationFrame(_tryScrollToSwitch)
        })
      }

      useEffect(function () {
        // Track the last navigation seq processed by this component instance,
        // so whichever path fires first consumes the navigation and the second
        // is a no-op (preventing double-fire when both paths are active).
        var _lastNavSeq = 0

        // Path 1: check the module-level variable on mount.  This covers the
        // "panel was not open" case — the component just mounted, so the
        // variable is set and no DOM event listener existed to receive it.
        if (_pendingNavTarget) {
          _lastNavSeq = _navSeq
          var targetId = _pendingNavTarget
          _pendingNavTarget = null
          // Defer one frame so the rest of the mount (including layout) can
          // settle before we start flipping tabs and scrolling.
          requestAnimationFrame(function () { _doNavigate(targetId) })
        }

        // Path 2: listen for the CustomEvent.  This covers the "panel is
        // already mounted" case — the variable was set but this effect has
        // already run, so the DOM event is the only way to reach us.
        var handleNavigate = function (e) {
          var seq = e.detail && e.detail.seq
          if (seq && seq <= _lastNavSeq) return   // already processed
          var targetId = e.detail && e.detail.switchId
          if (!targetId) return
          _lastNavSeq = seq || _navSeq
          _pendingNavTarget = null   // consumed — prevent double-fire on remount
          _doNavigate(targetId)
        }

        document.addEventListener('dock-flash:navigate', handleNavigate)
        return function () {
          document.removeEventListener('dock-flash:navigate', handleNavigate)
        }
      }, [])

      return h('div', {
        key: 'qcp-' + localeKey,
        // Compact mode narrows the panel ITSELF, and that is the only width this plugin owns.
        // The docked panel lives in dock-base's sidebar, whose width is dock-base's business —
        // `ViewDefinition` has no width field and `WorkbenchLayout` has no width field, so there is
        // no supported lever to ask for a narrower pane (checked in dock-base's own contract, not
        // assumed). What we CAN do is stop filling it: the root is capped at the compact width and
        // centred, so the compact panel reads as a narrow column wherever it is mounted. In the
        // standalone floating panel this is a no-op (the container is already that wide).
        // `width: 100%` BEFORE the cap, and it is load-bearing: in dock-base's flex COLUMN the
        // root's width comes from the cross axis, and `margin: auto` cancels the stretch — so with
        // only `maxWidth` the root falls back to its content width (MEASURED: 2px, borders alone,
        // in an empty pane). `width: 100%` capped at 176 then gives 176 in a wide pane and the
        // pane's own width in a narrow one (MEASURED: 176 centred in 320, 150 in 150).
        style: minimal
          ? { ...S.root, width: '100%', maxWidth: COMPACT_PANEL_WIDTH, margin: '0 auto' }
          : S.root,
        'data-dsh-plugin': 'dock-flash',
        'data-dsh-surface': 'floating-window',
      },
        // ── Scrollable section: alert bar + per-tab (header + body) ──
        //    Each tab header is immediately followed by its body when open,
        //    forming a single visual card. Only the panel title bar
        //    (dock-base header or standalone floatingHead) stays fixed above.
        h('div', {
          style: minimal ? S.panelBodyMinimal : S.panelBody,
          ...(minimal ? { className: 'dock-flash-compact-scroll' } : {}),
        },
          // No alert bar in compact mode (chosen deliberately): it is a text surface, and the
          // alerts themselves are still one click away in the full panel.
          minimal ? null : renderAlertBar(),
          pages.map((page, pi) => {
            // `compactPageAlwaysOpen` is the other half of the missing header: a page with no
            // header must not be a page that can be collapsed, or its rows would be unreachable.
            var isOpen = openTabs.has(page.id) || compactPageAlwaysOpen(page)
            return h('div', { key: page.id },
              renderTabHeader(page, pi),
              isOpen ? renderTabBody(page) : null,
            )
          }),
        ),
      )
    }
//#endregion ───────────────────────────────────────────────────────────────────

    // ═══════════════════════════════════════════════════════════════════════
    // ── Standalone floating panel (no dock-base required) ───────────────
    // ═══════════════════════════════════════════════════════════════════════
//#region StandaloneMode ───────────────────────────────────────────────────────
    // When dock-base is not installed, dock-flash mounts its own trigger
    // button and floating panel directly into the DOM. This provides access
    // to all non-layout switches (theme, language, fullscreen,
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

    // ── The alert surfaces' layer band ──────────────────────────────────────
    // The toast, the alert dropdown and the alert detail modal are BODY-LEVEL
    // surfaces that float above the standalone panel, and the panel's level is
    // the user's `triggerLayer` — so this band is DERIVED from it, exactly like
    // `panelLayer()` / `triggerLayerOfButton()` / `layerOfMenu()`, one step
    // above that trio. A literal is what broke: a fixed 1200 sat BELOW the
    // shipped 2000 preset, so picking 2000 put the panel on top of the toast
    // and of the dropdown anchored to the trigger.
    //
    // The floor is the host's own notice band. DSH puts its Toast at 1100 for a
    // stated reason — above the 1000 the image-lightbox backdrop uses, so a
    // failure reported while a preview is open stays readable — and a
    // notification the user cannot see is worse than a panel that is covered.
    // The floor only binds at the "stay out of the way" preset (9), where a
    // bare `triggerLayer + 3` would bury every alert under all host chrome.
    var ALERT_LAYER_FLOOR = 1100
    /** Mirrors `triggerLayer` for this band. Its ONE writer is
     *  `applyTriggerLayer()` in the standalone closure; workbench mode never
     *  mounts that closure and keeps this default, where the panel belongs to
     *  dock-base (`z-index: 10`) and cannot reach the band anyway. */
    var _alertLayerSetting = DEFAULT_TRIGGER_LAYER
    function alertLayerBase() { return Math.max(_alertLayerSetting + 3, ALERT_LAYER_FLOOR) }
    function layerOfAlertDropdown() { return alertLayerBase() }
    function layerOfToast() { return alertLayerBase() + 1 }
    /** A modal sits far above the band: it must clear every non-modal surface a
     *  plugin could park in between. */
    function layerOfAlertDetail() { return alertLayerBase() + 1000 }

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
        // The alert surfaces are body-level siblings of this panel too, so they
        // follow the SAME setting — one step above the panel/button/menu trio
        // instead of a literal, or a high `triggerLayer` (the 2000 preset did)
        // puts the panel over the toast and over the dropdown. This is the ONE
        // writer of `_alertLayerSetting`; the surfaces read it at creation and
        // are repainted here when the setting changes.
        _alertLayerSetting = triggerLayer
        if (_toastContainer) _toastContainer.style.zIndex = String(layerOfToast())
        if (_dropdownEl) _dropdownEl.style.zIndex = String(layerOfAlertDropdown())
        if (_alertDetailEl) _alertDetailEl.style.zIndex = String(layerOfAlertDetail())
        // Raise the shared DSHSelectDropdown portal above THIS panel: it is a
        // body-level sibling of panelContainer, so it must clear the same
        // `triggerLayer` instead of the workbench-fixed 1100. `layerOfMenu()`
        // (triggerLayer + 2) is the highest dock-flash overlay level and is
        // never on screen at the same time as a dropdown.
        _dropdownZIndex = layerOfMenu()
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
      /** Watches the panel's OWN box so placement is re-run once React has
       *  committed (the height is 0 at open time) and on every later content
       *  change. See `positionPanel()`. */
      var panelObserver = null
      var reactRoot = null
      var reactRootInstance = null
      var floatingHead = null
      var closeBtn = null
      var cobBtn = null
      // The compact-mode toggle, and the title it makes redundant: compact mode drops the title
      // because at 176px it can only ever be truncated ("快捷…"), which reads as a defect.
      var compactBtn = null
      var floatingTitle = null
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

      /** The compact mode's half that is NOT React.
       *
       *  The panel body decides what to DRAW; this decides what the floating box looks like —
       *  width, border, radius, shadow. One function, called at creation, on every pref change
       *  and right after a double-click, because a mode where one half moved and the other did
       *  not is precisely the bug this shape prevents. `positionPanel()` has to re-run with it:
       *  the panel is placed from its own measured rect, so a width change moves its edges. */
      function applyPanelSkin() {
        if (!panelContainer) return
        var compact = _compactPanel()
        // The title goes in compact mode: at 176px "快捷控制" can only be drawn truncated, and a
        // truncated title is indistinguishable from a layout defect. The grip and the buttons
        // stay — they are what makes the panel movable and closable.
        if (floatingTitle) floatingTitle.style.display = compact ? 'none' : ''
        _paintCompactToggle(compactBtn, false)
        Object.assign(panelContainer.style, {
          width: compact ? COMPACT_PANEL_WIDTH : '320px',
          // No border in compact mode, and a plain drop shadow rather than `E.*` — those tokens
          // carry a 0.5px RING, and a ring is the border this mode removes. Without any shadow
          // the panel would simply dissolve into the conversation it floats over.
          border: compact ? 'none' : '1px solid var(--dsw-alias-border-l2, #0000001a)',
          borderRadius: compact ? R.lg : R.panel,
          boxShadow: compact ? COMPACT_PANEL_SHADOW : E.prominent,
        })
      }
      // A host answer (or a change made in another window) repaints the container. Registered
      // here because this runs once — `ensurePanelContainer` is guarded by `if (panelContainer)`.
      _subscribePrefs(function () { applyPanelSkin() })

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
          // The panel's design ceiling. Placement NEVER touches it: when a
          // vertical side cannot hold this much, `positionPanel()` moves the
          // panel BESIDE the button rather than shrinking it.
          maxHeight: '70vh',
          overflow: 'hidden',
          borderRadius: R.panel,
          zIndex: String(panelLayer()),
          background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
          border: '1px solid var(--dsw-alias-border-l2, #0000001a)',
          boxShadow: E.prominent,
          display: 'none',
          flexDirection: 'column',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '13px',
          color: 'var(--dsw-alias-label-primary, #0f1115)',
          boxSizing: 'border-box',
        })
        applyPanelSkin()

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
        floatingTitle = titleSpan
        // Named for the same reason the trigger button is: a test (and a person in the console)
        // has to be able to find the node whose `display` this mode drives.
        titleSpan.setAttribute('data-dock-flash-title', '')
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
        cobBtn.setAttribute('data-dock-flash-focus', '')
        cobBtn.innerHTML = CLOSE_ON_BLUR_ICON_SVG
        Object.assign(cobBtn.style, {
          border: '0',
          borderRadius: R.sm,
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

        // ── Compact-mode toggle ──────────────────────────────────────────
        //    The same button as the close-on-blur one beside it, on purpose: same size, same
        //    glyph-in-both-states, same painted state. It is the SECOND entry point to this mode
        //    (the double-click on the ⚡ is the first) and the only one that exists in a header
        //    the WORKBENCH panel also renders — which is what lets dock mode turn it on at all.
        compactBtn = document.createElement('button')
        compactBtn.type = 'button'
        compactBtn.setAttribute('data-dock-flash-focus', '')
        compactBtn.setAttribute('data-dock-flash-compact-toggle', '')
        compactBtn.innerHTML = COMPACT_ICON_SVG
        Object.assign(compactBtn.style, {
          border: '0',
          borderRadius: R.sm,
          background: 'transparent',
          cursor: 'pointer',
          color: 'inherit',
          padding: '2px 6px',
          display: 'inline-flex',
          alignItems: 'center',
        })
        compactBtn.addEventListener('mouseenter', function () { compactBtn.style.opacity = '1' })
        compactBtn.addEventListener('mouseleave', function () { _paintCompactToggle(compactBtn, false) })
        compactBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          _setCompactPanel(!_compactPanel(), false)
          applyPanelSkin()
          positionPanel()
        })
        _paintCompactToggle(compactBtn, false)

        closeBtn = document.createElement('button')
        closeBtn.setAttribute('data-dock-flash-focus', '')
        closeBtn.textContent = '×'
        closeBtn.setAttribute('aria-label', 'Close')
        closeBtn.setAttribute('title', 'Close')
        Object.assign(closeBtn.style, {
          border: '0',
          borderRadius: R.sm,
          background: 'transparent',
          cursor: 'pointer',
          color: 'inherit',
          opacity: '0.75',
          padding: '2px 8px',
          fontSize: '13px',
        })
        closeBtn.addEventListener('mouseenter', function () {
          closeBtn.style.opacity = '1'
          closeBtn.style.background = 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 18%, transparent)'
        })
        closeBtn.addEventListener('mouseleave', function () {
          closeBtn.style.opacity = '0.75'
          closeBtn.style.background = 'transparent'
        })
        floatingHead.appendChild(gripSpan)
        floatingHead.appendChild(iconSpan)
        floatingHead.appendChild(titleSpan)
        floatingHead.appendChild(compactBtn)
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
          // Must be a flex column container so that S.root (also flex:1) can
          // correctly fill this element. Without display:flex here, S.root's
          // flex:1 is meaningless (the parent isn't a flex container) and its
          // height:100% can't resolve (no explicit height on this element —
          // the height comes from the outer flex layout, which CSS percentage
          // height does not resolve against). The result was: S.root grew to
          // content height, panelBody was never constrained, overflowY:auto
          // never engaged, and the panel had no scrollbar.
          display: 'flex',
          flexDirection: 'column',
          // BOTH axes. `minHeight: 0` and `minWidth: 0` are the standard flex
          // overflow fixes — without them the flex item's default `min-height:
          // auto` / `min-width: auto` means "never smaller than my content",
          // which prevents the internal scrollable body from ever shrinking and
          // the overflow surfaces as a scrollbar on an ancestor instead.
          minHeight: '0',
          minWidth: '0',
          // overflowY is 'hidden' because scrolling is handled by the
          // S.panelBody div inside the React component (which now includes
          // tab headers + body content). This prevents double scrollbars
          // and ensures only the body scrolls.
          overflowY: 'hidden',
          overflowX: 'hidden',
        })
        panelContainer.appendChild(reactRoot)

        // ── Close button ──
        closeBtn.addEventListener('click', function (e) {
          e.stopPropagation()
          closePanel()
        })

        document.body.appendChild(panelContainer)
        // Re-place and re-cap whenever the panel's OWN box changes: at open time
        // the height is still 0 (React 18's `createRoot().render()` is async, and
        // `positionPanel()` runs before `display: flex`), and the content can
        // change again on a tab switch. Setting an unchanged `max-height` does
        // not change the box, so this cannot feed itself.
        if (typeof ResizeObserver === 'function') {
          panelObserver = new ResizeObserver(function () { positionPanel() })
          panelObserver.observe(panelContainer)
        }
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

      /** The window margin the panel is kept inside, and the gap to the button.
       *  There is deliberately no height constant here: the panel's height is its
       *  own (`max-height: 70vh`) and placement never overrides it. */
      var PANEL_MARGIN = 8
      var PANEL_GAP = 6

      /** Place the panel, turning the corner when it cannot fit above or below.
       *
       *  The panel keeps its OWN height (`max-height: 70vh`, its design
       *  ceiling) — placement never resizes it. What it does instead is give up
       *  on the vertical axis when neither side can hold it: a 630px panel on a
       *  900px window fits neither side of a mid-page button, and the old code
       *  parked it half outside the window. MEASURED at `top: -186px` for both
       *  the default `input` position and the overlay. A clipped panel loses its
       *  HEADER — the drag grip, the title, the × — which is the one part that
       *  cannot be done without, so the header is what the fallbacks protect.
       *
       *  Order of preference: the configured vertical side, then the other
       *  vertical side, then BESIDE the button. Inside each, the panel is clamped
       *  into the window on both axes, and if it cannot fit even beside (a window
       *  shorter than the panel) the TOP is pinned inside the margin so the
       *  overflow, if any, is at the bottom.
       *
       *  Horizontal clamping was wrong in the same shape: `right: innerWidth -
       *  rect.right` keeps only the panel's RIGHT edge inside the window, so a
       *  button near the LEFT edge drove the left edge negative — the opposite of
       *  what its comment claimed. */
      function positionPanel() {
        if (!panelContainer) return
        var vw = window.innerWidth
        var vh = window.innerHeight
        var triggerEl = document.querySelector('[data-dock-flash-trigger]')

        if (!triggerEl) {
          // No anchor: bottom-left.
          panelContainer.style.top = 'auto'
          panelContainer.style.bottom = '64px'
          panelContainer.style.left = PANEL_MARGIN + 'px'
          panelContainer.style.right = 'auto'
          return
        }

        var rect = triggerEl.getBoundingClientRect()
        var posConfig = TRIGGER_POSITIONS.find(function (p) { return p.value === currentPosition })
        var style = posConfig && posConfig.style
        var box = panelContainer.getBoundingClientRect()
        var panelW = box.width || 320
        // 0 while the panel is `display: none`: `positionPanel()` also runs on a
        // window resize while it is closed, and at open time BEFORE React has
        // committed. An unknown height takes the configured side and lets the
        // panel's own ResizeObserver re-place once the real box exists.
        var panelH = box.height
        // Header and overlay open DOWNWARD; both input positions open UP.
        var rightAligned = style === 'header' || style === 'overlay'
        var wantBelow = rightAligned

        var maxLeft = Math.max(PANEL_MARGIN, vw - PANEL_MARGIN - panelW)
        var clampLeft = function (x) { return Math.round(Math.max(PANEL_MARGIN, Math.min(x, maxLeft))) }

        // Room above and below the button, inside the window margins.
        var roomBelow = vh - PANEL_MARGIN - (rect.bottom + PANEL_GAP)
        var roomAbove = (rect.top - PANEL_GAP) - PANEL_MARGIN

        var below = null
        if (!panelH) below = wantBelow                                              // height unknown yet
        else if (panelH <= (wantBelow ? roomBelow : roomAbove)) below = wantBelow    // preferred side
        else if (panelH <= (wantBelow ? roomAbove : roomBelow)) below = !wantBelow   // the other one
        // else `below` stays null: neither side can hold it, so it goes BESIDE.

        if (below !== null) {
          if (below) {
            panelContainer.style.top = Math.round(rect.bottom + PANEL_GAP) + 'px'
            panelContainer.style.bottom = 'auto'
          } else {
            // Anchored by its BOTTOM edge, so the panel hugs the button whatever
            // its rendered height.
            panelContainer.style.top = 'auto'
            panelContainer.style.bottom = Math.round(vh - (rect.top - PANEL_GAP)) + 'px'
          }
          panelContainer.style.left = clampLeft(rightAligned ? rect.right - panelW : rect.left) + 'px'
          panelContainer.style.right = 'auto'
          return
        }

        // ── Beside: turn the corner rather than shrink or clip ──
        panelContainer.style.bottom = 'auto'
        var roomRight = vw - PANEL_MARGIN - (rect.right + PANEL_GAP)
        var roomLeft = (rect.left - PANEL_GAP) - PANEL_MARGIN
        var toRight
        if (roomRight >= panelW) toRight = true          // the right side holds it
        else if (roomLeft >= panelW) toRight = false     // only the left one does
        else toRight = roomRight >= roomLeft             // neither: take the larger
        panelContainer.style.left = clampLeft(
          toRight ? rect.right + PANEL_GAP : rect.left - PANEL_GAP - panelW) + 'px'
        panelContainer.style.right = 'auto'

        // Level with the button, clamped to stay inside — and when the window is
        // shorter than the panel, pin the TOP so the HEADER is what survives.
        var maxTop = vh - PANEL_MARGIN - panelH
        var top = maxTop >= PANEL_MARGIN
          ? Math.min(Math.max(rect.top, PANEL_MARGIN), maxTop)
          : PANEL_MARGIN
        panelContainer.style.top = Math.round(top) + 'px'
      }

      function openPanel() {
        ensurePanelContainer()
        // Before `positionPanel()`: the placement measures the panel, so the mode has to be
        // applied to the box first or the panel opens at the previous mode's geometry once.
        applyPanelSkin()
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

      // Expose a "panel-already-open-safe" opener for _navigateToAlertProvider.
      // Calling this when the panel is already visible is a no-op (it does not
      // close the panel the way triggerEl.click() would).
      _standaloneOpenPanel = function () {
        if (panelVisible) return   // already open — do not toggle closed
        openPanel()
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

        var handleClick = function (e) {
          // Same reading of `MouseEvent.detail` as the overlay trigger: the first press keeps its
          // meaning, the second press of a double-click switches the compact mode instead of
          // closing. See the overlay handler for why `dblclick` itself is the wrong event.
          if (e && e.detail >= 2) {
            _setCompactPanel(!_compactPanel())
            applyPanelSkin()
            if (!panelVisible) openPanel()
            positionPanel()
            return
          }
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
          background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 18%, transparent)' : 'transparent',
          color: 'var(--dsw-alias-label-primary)',
          // The header variant keeps horizontal padding so it still reads as an
          // icon control in that row; its box grows with the icon below.
          padding: isHeader ? '2px 4px' : '0',
          lineHeight: 1,
          transition: 'background 0.15s ease',
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
          'data-dock-flash-focus': '',
          'aria-label': t('title'),
          'aria-expanded': active,
          title: t('title'),
          onClick: handleClick,
          style: btnStyle,
          onMouseEnter: function (e) {
            if (!active) e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.12))'
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
        el.setAttribute('data-dock-flash-focus', '')
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
          el.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14))'
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
          // ── The double-click ──────────────────────────────────────────────
          // `dblclick` fires only AFTER two `click`s, so a `dblclick` listener would open the
          // panel on the first press and close it on the second — a visible flicker, and the
          // second press is exactly the one that toggles. `MouseEvent.detail` names the press
          // instead: 1 for the first, 2 for the second. The FIRST press keeps its meaning
          // (open/close) so a single click stays instant — delaying it to wait for a possible
          // second click would make the panel's most common gesture feel broken — and the
          // second press of a double-click is re-interpreted as "switch the compact mode",
          // never as a close.
          if (e.detail >= 2) {
            e.preventDefault(); e.stopPropagation()
            _setCompactPanel(!_compactPanel())
            applyPanelSkin()
            if (!panelVisible) openPanel()
            // The panel is placed from its own measured rect, so a width change moves its edges:
            // re-run the placement AFTER the skin, or the box keeps the old mode's geometry.
            positionPanel()
            return
          }
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
          borderRadius: R.sm,
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
          row.setAttribute('data-dock-flash-focus', '')
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
          borderRadius: R.sm,
          background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
          border: '0.5px solid var(--dsw-alias-border-l4, rgba(127,127,127,0.3))',
          boxShadow: E.soft,
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
          // A portaled dropdown list anchored to a panel select is part of the
          // panel even though it lives on <body> — clicking an option must
          // CHOOSE it, not close the panel behind it.
          if (e.target && e.target.closest && e.target.closest('[data-dock-flash-dropdown]')) return
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
      // The inject return is a Cordis Fiber. Capturing it makes the standalone
      // mount fully re-entrant: `mountStandaloneSlotTrigger` can be torn down
      // and mounted again on the same ctx (the dock-hidden detach/re-attach
      // cycle) without the slots watcher double-registering. Disposing the
      // fiber unloads the slot injection AND the standalone Layout switches it
      // registers below, so a later remount starts from a clean slate.
      var slotsFiber = ctx.inject(['slots'], function (scope) {
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
            icon: 'pin',
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
            icon: 'ruler',
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
            icon: 'eye',
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
      // When this mount is torn down for a detach/re-attach cycle, dispose the
      // slots watcher fiber explicitly as well — that unloads the slot
      // injection and the standalone Layout switches, so a remount is clean.
      return function () {
        // Tear down BOTH entry points the standalone mount can own: the slot
        // trigger AND the overlay ⚡. `applyTrigger()` mounts the overlay itself
        // (it needs no `slots` service), so disposing the slots fiber below can
        // never reach it — omit this call and the draggable ⚡ with its
        // right-click menu survives a dock-hidden detach/re-attach cycle as a
        // stray overlay, still draggable and still offering its context menu.
        unmountOverlayTrigger()
        unmountPanel()
        _standaloneOpenPanel = null  // clear the module-level reference
        if (slotDispose) {
          try { slotDispose() } catch (_) {}
          slotDispose = null
        }
        if (slotsFiber && slotsFiber.dispose) {
          try { slotsFiber.dispose() } catch (_) {}
          slotsFiber = null
        }
        if (panelObserver) { try { panelObserver.disconnect() } catch (_) {} panelObserver = null }
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
      // A typert namespace is not one service — it is one service PER namespace:
      // `remote` (the mount point) plus a `remote.<namespace>` for each one this
      // plugin uses. @deepseek-ai/dsh-api-gateway registers them through
      // `remoteServiceKey(ns)` = `remote.${ns}`, and Cordis' guard proxy blocks a
      // namespace that is not declared, so a plugin that merely `ctx.get()`s it
      // gets nothing back.
      // Measured against the official consumers: @deepseek-ai/dsh-client-ui-settings
      // declares ["remote", "remote.settings"], and
      // @deepseek-ai/dsh-client-ui-plugin-manager declares ["slots", "locale",
      // "remote", "remote.pluginManager", "remote.pluginInventory",
      // "remote.pluginRegistryProbe", "configForms", "layout"].
      // The failure is silent in both directions: without the entry, every
      // host-backed preference reads as absent, and the 默认 press that has to
      // switch a handle-less skin off finds no lever and writes nothing at all.
      inject: ['remote', 'remote.settings', 'remote.pluginManager', 'remote.pluginInventory', 'remote.session'],
      apply(ctx) {
        try {
          // Use ctx.get() — NOT ctx.workbench — because the DSH guard proxy
          // blocks property access for services not in the provider's inject[].
          // When dock-base is not installed, wb is undefined and dock-flash
          // enters standalone mode (floating panel instead of workbench panel).
          // NOTE: workbench is resolved lazily and NOT committed to below —
          // dock-base may be installed but its `workbench` service not yet
          // registered when apply() runs (a load-order race). The `wb` above
          // is only the "available right now" fast path; the mode decision is
          // made at the bottom of this function by `_dockBaseInstalled()`.
          const wb = ctx.get ? ctx.get('workbench') : undefined

          // Has dock-base been composed into this boot? Read from the two
          // manifest sources the plugin's own skin system trusts (the boot
          // manifest and the module graph), never from localStorage. Presence
          // here means "installed AND enabled" — a disabled plugin is absent
          // from both. This is the reason we can distinguish "workbench will
          // arrive momentarily" from "dock-base is genuinely not here".
          function _dockBaseInstalled() {
            try {
              const boot = window.__DSH_BOOT__
              if (boot && Array.isArray(boot.entries)) {
                for (let i = 0; i < boot.entries.length; i++) {
                  const id = boot.entries[i] && boot.entries[i].id
                  if (id === 'dock-base' || id === 'dock-base/client') return true
                }
              }
            } catch (_) {}
            try {
              const mod = ctx.get('modules')
              if (mod && mod.graphRows) {
                for (const [rawId] of mod.graphRows) {
                  if (rawId === 'dock-base' || rawId === 'dock-base/client') return true
                }
              }
            } catch (_) {}
            return false
          }

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
          _exposeHook('__dockFlashTheme', () => themeProbe(getThemeService))
          _exposeHook('__dockFlashOverlay', overlayProbe)
          // Measuring must be as cheap as looking, or it does not happen.
          _exposeHook('__dockFlashOverflow', overflowProbe)
          loadHostPreferences(ctx).then((ok) => {
            if (!ok) return
            // The values just changed underneath the first render.
            try { registry.notifyChange('dock-flash:skin') } catch (_) {}
            try { registry.notifyChange('dock-flash:trigger-position') } catch (_) {}

            // ── Boot-time skin mutual exclusivity ──
            // The DSH runner calls apply() for every loaded plugin
            // unconditionally — multiple CSS skins may set their activation
            // attributes and inject style tags simultaneously.  The boot
            // enforcement cleans this up: for the stored preference, keep
            // only the matching CSS skin active and deactivate the rest.
            //
            // CRITICAL: we only touch CSS skins here.  Market-managed themes
            // are handled by the loader (at most one is loaded), handle-less
            // skins (dream-skin, macintosh) manage their own DOM and
            // re-inject on removal, and managed skins (Mineradio) own their
            // lifecycle.  Trying to CSS-deactivate a non-CSS skin either
            // strips a market theme's styles or is immediately undone by the
            // skin's own MutationObserver.
            //
            // Also: if the stored skin is NOT a CSS skin (or not found in
            // the DOM), we must NOT deactivate other CSS skins — the stored
            // skin's activation path is not the CSS one, and removing other
            // skins' CSS would leave the page unstyled.
            // ONE pass, run twice — see the delay below for why the second is not redundant.
            const enforceBootSkin = () => {
              try {
                const storedSkin = _hostPrefs.activeSkin
                const isDefault = !storedSkin || storedSkin === 'default'

                const skins = _scanInstalledSkins()
                const activeCss = skins.filter((s) =>
                  s.isActive && !s.managed && !_skinNotControllable(s))
                const activeIds = activeCss.map((s) => s.id)

                if (isDefault) {
                  // Default preferred — deactivate all active CSS skins.
                  // Handle-less / managed / market skins are left alone.
                  if (activeIds.length > 0) {
                    _skinTrace('boot-enforce', { storedSkin: 'default', reason: 'deactivate-css-at-boot', activeIds: activeIds })
                    _applySkin('default', true)
                    // ── ...and switch them off as PLUGINS too, or they simply come back ──
                    // `_applySkin('default', true)` is a BOOT-mode call, and boot mode skips
                    // every bundle write on purpose ("the loader already decided"). So it
                    // removes the skin's STYLE and leaves its loader ENTRY untouched —
                    // MEASURED: with the stored skin at `default` and `claude-style-skin`
                    // active, the sweep traced `deactivate-css-at-boot` and
                    // `- id: ui-skin-claude-style / disabled: false` stayed in the profile,
                    // so the next boot loaded Claude again, its `apply()` re-injected the
                    // body attribute and the style tag, and the user sees it as "默认 does
                    // not switch Claude off". This is the default-skin half of the same
                    // defect the `else` branch below already handles for a non-CSS target;
                    // the two branches needed it for the same reason and only one had it.
                    //
                    // No reload and no `pending` collection: boot mode reloads nothing by
                    // definition, and the write is for the NEXT load — which is exactly the
                    // load that would have re-painted it. `_switchSkinBundle()` keeps its
                    // own already-satisfied guard, so the ladder's repeated passes over an
                    // already-off skin write nothing.
                    for (const s of activeCss) {
                      try { _switchSkinBundle(s, false) } catch (_) {}
                    }
                  }
                } else {
                  // A specific skin is preferred.
                  const target = skins.find((s) => s.id === storedSkin)
                  // Only enforce if:
                  // 1. Multiple CSS skins are active (conflict), AND
                  // 2. The target IS a CSS skin we can activate in-page.
                  // If the target is handle-less / managed / not found,
                  // the CSS-layer enforcement cannot make it active, so
                  // deactivating other CSS skins would only make things worse.
                  const targetIsCss = target &&
                    !target.managed && !_skinNotControllable(target)
                  if (targetIsCss && activeIds.length > 1) {
                    _skinTrace('boot-enforce', { storedSkin: storedSkin, reason: 'multiple-css-conflict', activeIds: activeIds })
                    _applySkin(storedSkin, true)
                  } else if (targetIsCss && activeIds.length === 1 && activeIds[0] !== storedSkin) {
                    _skinTrace('boot-enforce', { storedSkin: storedSkin, reason: 'wrong-css-active', activeIds: activeIds })
                    _applySkin(storedSkin, true)
                  } else if (!targetIsCss && activeIds.length > 0) {
                    // ── the target is NOT a CSS skin, so nobody was switching the CSS ones off ──
                    // The two branches above exist for a CSS target: the CSS layer is what makes
                    // it active, so `_applySkin()` is the right way to enforce it. When the
                    // stored skin is handle-less or managed (Dream, macintosh, Mineradio) that
                    // reasoning does not apply — its own lifecycle activates it — and this
                    // branch used to fall through to "do nothing" on that basis.
                    //
                    // MEASURED defect: "Claude 不会被停用，它的样式会污染别的皮肤". Dream was the
                    // stored skin and `claude-style-skin` was still ACTIVE, so this branch was
                    // skipped, nothing ever switched Claude off, and every boot left it loaded
                    // and painting — `document.body.getAttribute('data-dsh-claude-style')` read
                    // `""` (present) with its `<style data-skin-chrome>` still in `<head>` while
                    // Dream's own `data-dsh-material="frosted"` was set. The page wore both.
                    //
                    // The skin-switch press does not cover this either: `_activateThemeViaPluginManager()`
                    // only writes a bundle for a CSS skin when the MARKET still calls it `live`
                    // (`_isMarketLiveTheme`), which is not the case on DSH Desktop.
                    //
                    // So the extra CSS skins are switched off as PLUGINS here — the ENTRY row plus
                    // `dsh.profile.bundles`, through `_switchSkinBundle()`, whose own guards make
                    // an already-off package a silent no-op (so repeated boot passes write nothing
                    // and cannot reload in a loop). This is deliberately NOT `_applySkin(storedSkin,
                    // true)`: the target must not be "activated" through the CSS layer, because for
                    // a handle-less skin there is nothing there to activate.
                    _skinTrace('boot-enforce', {
                      storedSkin: storedSkin, reason: 'stray-css-skins-vs-non-css-target', activeIds: activeIds,
                    })
                    const stray = activeCss.filter((s) => s.id !== storedSkin)
                    for (const s of stray) {
                      // `pending` is not needed: boot mode triggers no reload of its own, and
                      // the write lands for the NEXT load — which is exactly when it matters,
                      // because that is when the stray skin would have painted again.
                      try { _switchSkinBundle(s, false) } catch (_) {}
                    }
                  }
                }
              } catch (e) {
                try { console.warn('[dock-flash] boot-time skin enforcement failed:', e) } catch (_) {}
              }
            }

            enforceBootSkin()

            // ── ...and once more, late, because a CSS skin can arrive after it ──
            // A plugin's browser half runs its own `apply()` when the module loader
            // reaches it, which is not necessarily before this one: MEASURED with
            // `dsh-client-liang-intensity-skin`, whose `<style data-plugin>` tag was
            // still absent when the pass above ran. The scan then saw no active CSS
            // skin, 默认 had nothing to remove, and the skin stayed painted for the
            // rest of the session — the switch looked like it had no effect while
            // every write it made was correct. The second pass is cheap and
            // idempotent: it re-reads the DOM, and an already-clean page falls
            // through every branch (that is the same guard that makes it safe when
            // the first pass did fire — `_deactivateCssSkin` removed the tag the
            // re-scan is looking for).
            setTimeout(enforceBootSkin, 1500)
          }).catch((err) => {
            // Belt and braces for the whole block: `loadHostPreferences()` can no
            // longer throw synchronously (see `_describeAsync`), but the boot-skin
            // sweep touches the DOM and could. Anything that escapes here would
            // otherwise be an unhandled rejection, and a throw that reached
            // `apply()` would fail this plugin's fiber — which is exactly the
            // "the plugin was registered and then was not there" symptom.
            console.warn('[dock-flash] preference load / boot sweep failed (non-fatal):', err)
          })

          // ── 1. Create & publish the quickControl registry service ──────
          const registry = createQuickControlRegistry()
          ctx.provide('quickControl', registry)

          // ── 1b. Create & publish the alert registry service ──────────
          // Published BEFORE the ready event so listeners can ctx.get() both
          // services immediately inside their handler.
          const alertRegistry = createAlertRegistry(ctx)
          _alertRegistryRef = alertRegistry
          _applyCtx = ctx
          ctx.provide('dockFlashAlerts', alertRegistry)

          // Emit a ready event so other plugins can discover the quickControl
          // and dockFlashAlerts services without declaring a hard inject
          // dependency.  The event payload carries both registries so
          // listeners need not call ctx.get() at all (Cordis service
          // resolution is asynchronous — ctx.get() may return undefined in
          // the same synchronous call stack even after provide()).
          // See INTEGRATION.md for the recommended dual-mode pattern:
          //   ctx.on('dock-flash:ready', cb) + ctx.get('quickControl') fallback.
          // Note: we use try/catch because the cordis context available on the
          // client side may not have a full EventEmitter implementation.
          try { ctx.emit('dock-flash:ready', { quickControl: registry, alerts: alertRegistry }) } catch (_) {}

          // Register built-in alert providers.  Every monitor is now owned by a
          // companion plugin that registers itself through
          // ctx.get('dockFlashAlerts'): context by dsh-flash-ctx-mon, memory by
          // dsh-flash-mem-mon, network by dsh-flash-net-mon. dock-flash keeps
          // only the host-pushed queue provider plus the shared registry.
          const alertProviders = [
            createHostAlertProvider(),
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
              icon: 'rail',
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
              // Keep trying to resolve DSH's own rail offset while the placement
              // is on: its stylesheet loads with the chat plugin and can land
              // after the first apply. `_railNativeRight()` caches on success,
              // so this becomes free once resolved, and `applyTurnRailLeft()`
              // rewrites the tag only when the mirror actually changed.
              if (readTurnRailLeft() && _railRightCache === null) applyTurnRailLeft()
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

          /**
           * ONE list for the 外观 select, read by BOTH `options()` and `getValue()`.
           *
           * The theme service publishes the base colour schemes AND every palette a
           * skin has registered; `tokens` is what tells them apart, and the rationale
           * plus the live measurement sit on `options()` below. What matters here is
           * that the two readers must agree — a value that names no offered option is
           * a BLANK row in a `<select>`, which is exactly how the `system` case broke.
           *
           * `hasSkinPalettes` is what decides the `system` entry, and the distinction
           * is the whole point: it is offered exactly while the BASE schemes are what
           * is on offer. There DSH's own "follow the system" preference is real and
           * supported — resolving light/dark from the OS is what it does.
           *
           * It is withheld only while some theme is publishing a palette of its OWN,
           * because then a fixed `colorScheme` is what paints. That is a property of
           * the THEME, never of "a skin": MEASURED live, Claude is a skin that only
           * restyles the base schemes and registers no palette, so with Claude active
           * the list is still 浅色 / 深色 / 跟随系统 — and the first version of this
           * function deleted it for Claude as well. Removing it in both cases took a
           * working capability away from every non-palette theme.
           */
          function _offeredThemes(svc) {
            let themes = []
            try {
              themes = (svc && typeof svc.getTheme === 'function')
                ? ((svc.getTheme() || {}).themes || [])
                : []
            } catch (_) { themes = [] }
            if (!Array.isArray(themes)) return { list: [], hasSkinPalettes: false }
            const withOwnPalette = themes.filter((th) => {
              const t = th && th.tokens
              return !!t && (Array.isArray(t) ? t.length > 0 : Object.keys(t).length > 0)
            })
            return withOwnPalette.length > 0
              ? { list: withOwnPalette, hasSkinPalettes: true }
              : { list: themes, hasSkinPalettes: false }
          }

          // Theme toggle — controls global DSH color scheme
          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:theme',
              label: L('theme'),
              icon: 'theme',
              type: 'select',
              group: 'appearance',
              order: 20,
              // This switch and the skin select below are ONE unit drawn as ONE
              // row — see `renderInlineCluster`. The cluster string is the unit
              // key (`\0cluster:skin-theme`) and is never printed; the row prints
              // `clusterLabel`. `order` 20 < 25 is what puts the theme dropdown
              // FIRST in that row.
              cluster: 'skin-theme',
              clusterInline: true,
              clusterLabel: () => t('skinTheme'),
              options: () => {
                try {
                  const svc = getThemeService()
                  const labelMap = { light: L('themeLight'), dark: L('themeDark') }
                  // ── only the entries that carry their OWN palette ──────────────
                  // The service hands back the base colour schemes AND every palette a
                  // skin has registered, and they are told apart by `tokens`: MEASURED
                  // with Dream active, `light`/`dark` report `tokens: 0` while all
                  // eight of its palettes (`abyss`, `aurora`, `nebula`, `ember`,
                  // `midnight`, `ivory`, `mist`, `rose`) report `tokens: 33`.
                  //
                  // The token-less pair is not "one more option" while a theme is
                  // publishing palettes: `ctx.theme.overrideTokens()` paints over the
                  // base scheme, so picking 浅色 or 深色 changes nothing on screen — the
                  // reported "Dream 皮肤不支持默认的那三个外观选项".
                  //
                  // That is a property of the THEME, never of "a skin". MEASURED live:
                  // Claude is a skin that restyles the base schemes WITHOUT registering
                  // a palette, so with Claude active this list is unchanged — 浅色 /
                  // 深色 / 跟随系统, exactly as with no skin at all.
                  //
                  // The `system` entry is withheld only in the palette case, and by the
                  // palette's own account: a palette declares a FIXED `colorScheme`, so
                  // "follow the system" has nothing to resolve to there (Dream's own
                  // comment calls a reset to `system` an issue and re-applies "the last
                  // concrete built-in preference" instead). With no palette published —
                  // no skin, or a restyling skin such as Claude — DSH resolves `system`
                  // against the OS, so it is offered.
                  //
                  // The filter itself, and the base-scheme fallback, live in
                  // `_offeredThemes()` — ONE list, because `getValue()` has to answer
                  // from the same one this offers.
                  const offered = _offeredThemes(svc)
                  const opts = offered.list.map((th) => ({ label: labelMap[th.id] || th.id, value: th.id }))
                  if (!offered.hasSkinPalettes) opts.push({ label: L('themeSystem'), value: 'system' })
                  return opts
                } catch (_) {
                  return []
                }
              },
              getValue: () => {
                const svc = getThemeService()
                if (svc && typeof svc.getTheme === 'function') {
                  try {
                    const snap = svc.getTheme() || {}
                    // The preference is USUALLY an offered id, but it can also name one
                    // this row does not offer, in TWO ways: `system` while a SKIN is
                    // painting (a DSH-side reset — Dream's own note records a client
                    // reload / agent-preset change doing exactly that), or a base scheme
                    // such as `dark` that a skin has since painted over. Either one would
                    // leave the `<select>` pointing at a BLANK row. So the value is
                    // answered from the SAME list the options come from —
                    // `_offeredThemes()` — and when the stored preference is not in it,
                    // `active.id` (the palette actually painted) is the honest value.
                    const pref = snap.preference
                    const activeId = snap.active && snap.active.id
                    let offered = []
                    let hasSkinPalettes = false
                    try {
                      const o = _offeredThemes(svc)
                      offered = o.list.map((th) => (th && th.id))
                      hasSkinPalettes = o.hasSkinPalettes
                    } catch (_) { offered = [] }
                    // `system` is offered exactly when the base schemes are, so it counts
                    // as a present option there and as an absent one under a skin.
                    if (!hasSkinPalettes) offered.push('system')
                    if (typeof pref === 'string' && pref && offered.indexOf(pref) !== -1) return pref
                    if (typeof activeId === 'string' && activeId) return activeId
                    if (typeof pref === 'string' && pref) return pref
                    return offered.length ? offered[0] : 'dark'
                  } catch (_) { /* fall through to the computed scheme */ }
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

          /**
           * Is `id` the theme the market currently records as `live`?
           *
           * The market is the only authority that knows a theme's persisted state:
           * a theme activated via /use-skin is recorded `live` there while every
           * other theme is marked `disabled`, and that record outlives any in-page
           * switch (it is what the NEXT boot composes the loader from).  This is
           * also what `_getActiveSkinId()` consults FIRST — even over the stored
           * preference.  So this predicate is how `_applySkin()` tells that the
           * skin it just deactivated in the DOM is still going to be re-echoed
           * (and, worse, re-saved) as the active choice unless the loader write
           * INVALIDATES the market's `live` row.
           */
          function _isMarketLiveTheme(id) {
            if (!_marketThemes || !Array.isArray(_marketThemes.themes)) return false
            const name = _skinBundleName(id)
            return _marketThemes.themes.some(function (th) {
              if (th.state !== 'live') return false
              return th.name === name || th.name === id
            })
          }

          /**
           * Invalidate the market's cached theme states.
           *
           * After `_applySkin()` switches a skin in the DOM (and through the
           * loader) the market's `live` record is stale: a theme it still says is
           * `live` would be echoed back — and actively re-saved over the user's
           * choice — by `_getActiveSkinId()`.  Marking every cached theme
           * `disabled` is the instant-feedback half of the switch: it lets the
           * dropdown (and the stored preference) agree with what the loader was
           * just told, without waiting for the reload's fresh `/installed` fetch.
           * `_applySkin()` only ever leaves NO market theme live (target is
           * `default`, or a plugin-local CSS skin the market does not govern), so
           * marking them all `disabled` is exact, not a sweeping approximation.
           */
          function _invalidateMarketThemes() {
            if (!_marketThemes || !Array.isArray(_marketThemes.themes)) return
            for (const th of _marketThemes.themes) {
              th.state = 'disabled'
            }
          }

          // ── There is deliberately NO "disable the plugin" path here ──────────
          //    A skin that identifies nothing in the DOM (see `_skinNotControllable`)
          //    looks like it needs one, and `/dsh-market/toggle` looks like the
          //    answer. IT IS NOT. That route is the market's PLUGIN switch, not a
          //    skin switch: it writes `disabled: true` into the user patch layer
          //    *and* removes the package from `dsh.profile.bundles` — it edits the
          //    install layers. Driving it from a skin dropdown dismantles the
          //    user's profile: both themes were dropped from `bundles` and could
          //    no longer be enabled from the theme page at all, because
          //    `activateTheme()` (the theme path) only does live loader updates
          //    plus `state.json` and never clears a patch row or restores a bundle
          //    row. One write, no way back. A UI control must never reach for the
          //    install layers; if this comes up again, make the control HONEST
          //    instead (`_warnSkinNotControllable`) or exclude the skin.

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
           * Skins WE switched off on this page. Their marks can linger — a plugin's own
           * dispose does not always take its style tag or its data-* attribute with it — and
           * a lingering mark is then RESIDUE, not evidence of rendering. `_skinInEffect()`
           * cannot tell those apart (its whole limitation), so the dropdown must stop naming
           * a skin once we have switched it off.
           */
          var _skinSwitchedOff = {}

          /**
           * Activation generation for the plugin-manager path (`_activateThemeViaPluginManager`).
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
            // On record, because "the dropdown does not exist" is one of the ways a
            // skin press can do nothing — and it is invisible in every other clue.
            _skinTrace('switch', { id: 'dock-flash:skin' })
            _skinSwitchDispose = registry.registerSwitch({
              id: 'dock-flash:skin',
              label: L('skin'),
              icon: 'palette',
              type: 'select',
              group: 'appearance',
              order: 25,
              // The other half of the inline "skin-theme" cluster. EVERY member
              // must declare `clusterInline` or the unit falls back to the
              // stacked card, and the row's title is declared once, on the head.
              cluster: 'skin-theme',
              clusterInline: true,
              options: () => {
                try {
                  // Kick an async refresh when the cache is empty or stale —
                  // disabled skins are invisible to the DOM/boot scan, so only
                  // the plugin manager can discover them.  The first options()
                  // call may return before the fetch completes; once it does,
                  // registry.notifyChange triggers a re-render that picks up
                  // the newly populated list.
                  if (!_pluginEntriesCache) _refreshPluginEntries()
                  // Same kick for the profile inventory (phase 6). On DSH Desktop
                  // this is the ONLY source for an installed-but-switched-off
                  // skin, because the plugin manager answers nothing there.
                  _refreshProfilePackages()
                  // ONE list, shared with _applySkin() — see _knownSkins(). The
                  // market extras are the installed-but-not-loaded skins: absent
                  // from the DOM and from the boot manifest, so the scan alone
                  // cannot see them.
                  const skins = _knownSkins()
                  const opts = [{ label: _defaultSkinOpt.label, value: _defaultSkinOpt.value }]
                  for (const skin of skins) {
                    opts.push({
                      label: skin.label,
                      value: skin.id,
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
                // Every skin activation now goes through the plugin manager path
                // when the skin has a loader entry.  The distinction between
                // "market theme" and "plugin-local CSS skin" no longer exists —
                // if the plugin manager can address the entry, it is switched there;
                // otherwise _applySkin() handles it in-page.
                _skinTrace('press', { value: v, path: 'pluginManager' })
                if (v !== 'default') {
                  const gen = ++_skinActivationGen
                  const target = _knownSkins().find((s) => s.id === v)
                  if (target && _skinNotControllable(target)) {
                    // Handle-less skins already go through _switchSkinBundle; the
                    // reload that lands the write comes from the activation path
                    // below it (`_activateThemeViaPluginManager` → `_fadeBeforeReload`,
                    // traced as `reload why=pluginManager:<name>`). Do NOT reload
                    // here as well — the harness pins one reload per press, and a
                    // second one is a double page load for no gain.
                    _switchSkinBundle(target, true).then(function () { return _activateThemeViaPluginManager(v, gen) })
                  } else {
                    _activateThemeViaPluginManager(v, gen)
                  }
                  return
                }
                _applySkin(v)
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

          /**
           * Fetch installed plugins/bundles from DSH's native plugin manager;
           * safe to call repeatedly.  Replaces _refreshMarketThemes().
           */
          function _refreshPluginEntries() {
            _fetchPluginEntries().then(function (snapshot) {
              // Sync managed plugins' enable flags with the currently active skin.
              // This runs after every fetch to heal stale state from earlier
              // versions or external changes.
              var activeId = _getActiveSkinId()
              _syncManagedEnableFlags(activeId !== 'default' ? activeId : null)

              if (typeof console !== 'undefined' && console.debug) {
                var skinEntries = snapshot.entries.filter(function (e) { return _skinAllowed(e.moduleName) })
                var skinBundles = snapshot.bundles.filter(function (b) { return _skinAllowed(b.name) })
                console.debug('[dock-flash] plugin entries fetched:',
                  snapshot.entries.length, 'entries (' + skinEntries.length + ' skin-like),',
                  snapshot.bundles.length, 'bundles (' + skinBundles.length + ' skin-like),',
                  'pm:', !!_pluginManagerRemote(), 'pi:', !!_pluginInventoryRemote())
              }

              // Re-render the dropdown with the newly known entries — but ONLY when
              // something actually arrived.  This notify is what closes the retry
              // loop: `options()` kicks a fetch whenever there is no cache, a failed
              // read is deliberately not cached, and an unconditional notify would
              // turn that into render → fetch → notify → render forever.  Notifying
              // only on real data means a failure retries on the next organic
              // render instead.
              if (snapshot.entries.length > 0 || snapshot.bundles.length > 0) {
                try { registry.notifyChange('dock-flash:skin') } catch (_) {}
              }
            })
          }


          /**
           * Gate every scan phase must pass before listing a plugin.
           *
           * Without the market's registry classification, this is a pure name
           * heuristic: the id must match _skinHint and must NOT match _skinExclude.
           * This is the same check the DOM scan already applies, and it is the
           * only option without the market's category data.  A non-theme package
           * whose name contains "skin"/"theme" may appear; this is accepted —
           * the name heuristic is what the DOM scan already uses for its own
           * discovery, so the two paths agree.
           *
           * Returns true = LIST IT.
           */
          function _skinAllowed(id) {
            return _skinHint.test(id) && !_skinExclude.test(id)
          }



          /**
           * Installed skin plugins NOT yet found by the DOM scan, discovered through
           * the plugin manager's entry/bundle lists.  Replaces _marketThemeExtras(),
           * which used /dsh-market/installed.
           *
           * A disabled skin has no DOM evidence (no style tags, no body attributes),
           * so only the plugin manager can discover it.
           */
          function _pluginManagerSkinExtras(seenIds) {
            var snapshot = _pluginEntriesCache
            if (!snapshot) return []
            var out = []
            var bundleMap = {}
            for (var b = 0; b < snapshot.bundles.length; b++) {
              var bundle = snapshot.bundles[b]
              if (bundle && bundle.name) bundleMap[bundle.name] = bundle
            }

            // Discover from entries (listPlugins)
            for (var i = 0; i < snapshot.entries.length; i++) {
              var entry = snapshot.entries[i]
              if (!entry || !entry.moduleName) continue
              var id = _skinBundleName(entry.moduleName)
              if (id.endsWith('/client')) id = id.slice(0, -7)
              if (seenIds.has(id)) continue
              if (!_skinAllowed(id)) continue
              if (_managedSkins[id]) continue
              seenIds.add(id)
              var managed = _managedSkins[id]
              out.push({
                id: id,
                label: (managed && managed.label) || _labelFromId(id),
                state: entry.enabled ? 'live' : 'disabled',
              })
            }

            // Discover from bundles (listBundles) — catches packages with no
            // addressable entry (e.g. disabled bundles not yet composed)
            for (var j = 0; j < snapshot.bundles.length; j++) {
              var bun = snapshot.bundles[j]
              if (!bun || !bun.name) continue
              if (seenIds.has(bun.name)) continue
              if (!_skinAllowed(bun.name)) continue
              if (_managedSkins[bun.name]) continue
              seenIds.add(bun.name)
              out.push({
                id: bun.name,
                label: _labelFromId(bun.name),
                state: bun.enabled ? 'live' : 'disabled',
              })
            }

            return out
          }

          /**
           * Every skin the dropdown can offer, as ONE list.
           *
           * `options()` merges the DOM/boot scan with the plugin manager's
           * installed-but-not-loaded themes, but `_applySkin()` used to iterate
           * the SCAN ALONE — so a skin reachable only through the plugin manager
           * could not be acted on at all: not activated, and not switched off by
           * 默认.  The two lists disagreeing about what exists is the defect; one
           * list serving both callers is the fix.
           *
           * A pm-only entry exposes no DOM handle by construction — its
           * bundle is not loaded, so it has no style tag in this page.
           * `_skinNotControllable()` reads that shape, which is why 默认 can only
           * report such a skin rather than switch it off.
           */
          function _knownSkins() {
            const skins = _scanInstalledSkins()
            const seenIds = new Set(skins.map((s) => s.id))
            for (const extra of _pluginManagerSkinExtras(seenIds)) {
              skins.push({
                id: extra.id,
                label: extra.label,
                state: extra.state,
                sel: null,
                isActive: extra.state === 'live',
                bodyAttr: _skinBodyAttrs[extra.id] || null,
                pmOnly: true,
              })
            }
            return skins
          }

          /**
           * Activate a theme through DSH's native plugin manager.
           *
           * Enables the target skin's loader entry and disables every other skin
           * entry, then reloads the page.  This replaces _activateThemeViaMarket(),
           * which used POST /dsh-market/use-skin.
           *
           * `gen` is the caller's activation generation: a later click supersedes
           * this one, and a superseded call must not clear the NEWER pending value.
           */
          function _activateThemeViaPluginManager(name, gen) {
            var current = function () { return gen === undefined || gen === _skinActivationGen }
            var release = function (why) {
              _skinTrace('pluginManager', { name: name, status: 'refused', why: why })
              if (!current()) return false
              _pendingSkinId = null
              console.warn('[dock-flash] could not activate "' + name + '" through the plugin manager — ' + why +
                ' — selection released; the dropdown shows the theme that is actually live')
              try { registry.notifyChange('dock-flash:skin') } catch (_) {}
              return false
            }

            var pm = _pluginManagerRemote()
            if (!pm) return Promise.resolve(release('the plugin manager remote did not resolve'))

            return Promise.resolve()
              .then(function () { return typeof pm.listPlugins === 'function' ? pm.listPlugins() : [] })
              .then(function (rows) {
                if (!current()) return false
                var allSkins = _knownSkins()
                var bundleName = _skinBundleName(name)
                var targetRow = _skinEntryRow(rows, bundleName)

                if (!targetRow) {
                  // No addressable loader entry — fall back to _applySkin which
                  // handles in-page CSS activation for controllable skins and the
                  // bundle fallback for handle-less skins.  This is the "otherwise
                  // _applySkin() handles it in-page" part described in the setValue
                  // comment that was never implemented.
                  _skinTrace('pluginManager', { name: name, status: 'fallback' })
                  _applySkin(name)
                  _pendingSkinId = null
                  return true
                }

                var pending = []

                // Enable the target — BOTH halves, exactly like the disable path below.
                // The ENTRY row is the RUNNING loader; `dsh.profile.bundles` is the NEXT
                // BOOT, and an entry that reads `disabled: false` while the package is
                // ABSENT from the roster does not load: it stays installed and never comes
                // back. MEASURED live: 默认 switched Claude off in both layers, and
                // selecting Claude again left `bundleCalls` EMPTY — Claude could be
                // switched off but never switched back on. A handle-less target escapes
                // this because `setValue()` writes its bundle BEFORE calling here; a CSS
                // skin WITH a row takes this branch, which wrote the entry and stopped.
                var targetWasOff = (targetRow.enabled !== true)
                if (targetWasOff) {
                  pending.push(
                    Promise.resolve(pm.setPluginEnabled(targetRow.entryId, true))
                      .then(function () { return true }, function (e) {
                        console.warn('[dock-flash] setPluginEnabled(true) failed for "' + bundleName + '": ' + String((e && e.message) || e))
                        return false
                      })
                  )
                }
                // `entryWritten` only when we really wrote the row above: when the row
                // already reads `true` this still has to consult the roster, because an
                // earlier 默认 press is exactly what removed the package from it.
                var targetSkin = null
                for (var ts = 0; ts < allSkins.length; ts++) {
                  if (allSkins[ts].id === name) { targetSkin = allSkins[ts]; break }
                }
                pending.push(_switchSkinBundle(targetSkin || { id: name }, true, {
                  silent: true, entryWritten: targetWasOff,
                }))

                // Disable every other skin
                for (var i = 0; i < allSkins.length; i++) {
                  var skin = allSkins[i]
                  if (skin.id === name) continue
                  var otherName = _skinBundleName(skin.id)
                  var otherRow = _skinEntryRow(rows, otherName)
                  if (otherRow && otherRow.entryId) {
                    // ── the ENTRY row is only half; the roster has to follow ──────────
                    // This branch used to write `setPluginEnabled(entryId, false)` and stop.
                    // That leaves the package inside `dsh.profile.bundles` — off in the
                    // loader, still composed in on the next boot — which is the reported
                    // "从 Claude 切换为 Dream 皮肤后 Claude 没被停用". MEASURED: the entry row
                    // really did go to `false` (`pluginCalls:
                    // ["dream-skin:true","ui-skin-claude-style:false"]`) while `bundleCalls`
                    // stayed EMPTY, and `claude-style-skin` was still in the roster.
                    //
                    // The handle-less branch below has always gone through
                    // `_switchSkinBundle()`, which writes BOTH halves; a skin WITH a row
                    // needs the same, so the row is written here and the roster is handed to
                    // `_switchSkinBundle()` with `entryWritten: true` — that flag tells it the
                    // row is already handled, which is what stops it from re-reading the
                    // freshly-disabled row and concluding there is nothing to do.
                    var rowWritten = (otherRow.enabled !== false)
                    if (rowWritten) {
                      pending.push(
                        Promise.resolve(pm.setPluginEnabled(otherRow.entryId, false))
                          .then(function () { return true }, function () { return false })
                      )
                    }
                    pending.push(_switchSkinBundle(skin, false, {
                      silent: true, entryWritten: rowWritten,
                    }))
                  } else if (_skinNotControllable(skin)) {
                    // Handle-less skin with no loader entry — nothing in the
                    // DOM to remove; must use bundle-level switch.
                    pending.push(_switchSkinBundle(skin, false, { silent: true }))
                  } else if (!skin.managed) {
                    // CSS skin without loader entry — deactivate in-page only
                    // (remove style tags + body attributes).  Do NOT disable
                    // the bundle or the skin becomes unloadable on next boot.
                    // Managed skins are handled by _syncManagedEnableFlags.
                    _deactivateCssSkin(skin)
                    // A controllable skin the market still records as `live`
                    // must also be switched off through the loader so its row
                    // reads `disabled` and the next boot stays on the target
                    // the user just picked — same as _applySkin does.
                    if (_isMarketLiveTheme(skin.id)) {
                      pending.push(_switchSkinBundle(skin, false, { silent: true }))
                    }
                  }
                  // else: managed skin without loader entry —
                  // _syncManagedEnableFlags handles it after the loop.
                }

                // Sync managed skin enable flags before reload
                _syncManagedEnableFlags(name)

                return Promise.all(pending).then(function (results) {
                  if (!current()) return false
                  var anyWrite = results.some(Boolean)
                  _skinTrace('pluginManager', { name: name, status: 'ok', wrote: anyWrite })
                  _skinReloadWhy = 'pluginManager:' + name
                  try { sessionStorage.setItem('dock-flash:activated-theme', name) } catch (_) {}
                  // The reload stays UNCONDITIONAL here, deliberately: an entry switch
                  // that DSH reports as `applied` still lets the plugin mount a moment
                  // later, so "the marks are not back yet" is not evidence that nothing
                  // happened. A page reload is cheap and it settles the mount either
                  // way — what must never be required is a DSH RESTART, and the entry
                  // switch is exactly what removes that requirement.
                  _fadeBeforeReload()
                  return true
                })
              })
              .catch(function (e) { return release(String((e && e.message) || e)) })
          }

          /**
           * Create a smooth fade-out overlay before a page reload.
           * The overlay fades in over 150ms, then triggers location.reload().
           * This replaces the jarring "white flash" of a bare reload with
           * a brief dim-out that feels like a deliberate transition.
           */
          function _fadeBeforeReload() {
            // Recorded before the overlay is even built: a scheduled reload is the
            // only way a loader write becomes visible in this page, so its presence
            // (or absence) is the decisive line in `__dockFlashSkinTrace()`.
            _skinTrace('reload', { why: _skinReloadWhy || 'unspecified' })
            _skinReloadWhy = null
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
              // rather than their package name, which lists the SAME skin twice:
              // once here, once under its body attribute in phase 2.
              //
              // A decorative suffix is stripped only when the stripped name is a
              // name we can CONFIRM — never blindly, because a package may
              // genuinely be called `foo-style`.  The set of confirming sources is
              // what this fix widens.  It used to be the boot manifest alone,
              // behind a `_bootIds.size &&` gate, and that gate was the bug: with
              // no manifest the whole block was skipped, so `claude-style-skin-style`
              // (chrome) and `claude-style-skin` (its own `_skinBodyAttrs` key, and
              // therefore provably the real package) were both listed.  The
              // curated tables and the ids earlier phases already saw are just as
              // authoritative as the manifest, and are available more often.
              const _chromeKnown = (candidate) =>
                _bootIds.has(candidate) ||
                _bootIds.has(candidate + '/client') ||
                Object.prototype.hasOwnProperty.call(_skinBodyAttrs, candidate) ||
                Object.prototype.hasOwnProperty.call(_managedSkins, candidate) ||
                seen.has(candidate)
              if (!_chromeKnown(id)) {
                const _chromeSuffixes = ['-style', '-chrome', '-css']
                for (var _csi = 0; _csi < _chromeSuffixes.length; _csi++) {
                  if (id.endsWith(_chromeSuffixes[_csi])) {
                    const candidate = id.slice(0, -_chromeSuffixes[_csi].length)
                    if (_chromeKnown(candidate)) {
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
            //    phases 1a, 1b, and 2 all miss it.  Managed skins are already handled
            //    in phase 0.
            //
            //    `__DSH_BOOT__.entries` is a USEFUL source, NOT a complete install
            //    list — measured on a real profile, its 73 rows contained neither
            //    `dsh-dream-skin` nor `dock-flash`, though both are in
            //    `dsh.profile.bundles` and both were running.  Do not treat "absent
            //    from the manifest" as "not installed"; that is why phase 5 exists.
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

            // 5. Skins whose own marks are IN THIS PAGE but which no other phase can
            //    see.  `dsh-dream-skin` is the case: it is handle-less (no
            //    data-plugin, no data-skin-chrome, absent from `_skinBodyAttrs`) and
            //    it can also be absent from `__DSH_BOOT__` and from the plugin
            //    manager's rows — measured on a real profile: 73 boot entries
            //    containing neither it nor dock-flash itself, and `listPlugins()`
            //    reading `[]`.  With every other phase blind to it, nothing ever
            //    tried to switch it off: the deactivate-others loop iterates THIS
            //    list, so choosing another skin left it rendering and
            //    `_getActiveSkinId()` kept naming it — "switch to claude, it snaps
            //    back to Dream".
            //
            //    `_skinLiveMarks` is a CURATED table (detection only, never removal),
            //    and a mark present in the document proves the plugin is installed
            //    AND on — the same class of evidence as the plugin's own style tag,
            //    which the managed-skin install rule already accepts.  Nothing here
            //    removes a mark; it only makes the skin LISTABLE, so the existing
            //    whole-plugin switch can reach it.
            for (const liveId of Object.keys(_skinLiveMarks)) {
              if (seen.has(liveId)) continue
              if (!_skinInEffect(liveId)) continue
              if (_skinExclude.test(liveId)) continue
              if (!_skinAllowed(liveId)) continue
              if (_managedSkins[liveId]) continue
              seen.add(liveId)
              skins.push({
                id: liveId,
                label: _labelFromId(liveId),
                // No DOM handle and no body attribute: `_skinNotControllable()`
                // reads exactly this shape and routes the switch through
                // `_switchSkinBundle()` — the whole plugin, the only lever that can
                // turn such a skin off.
                sel: null,
                isActive: true,
                bodyAttr: null,
                liveMark: true,
              })
            }

            // 6. INSTALLED but switched off — from the profile's own manifest, read
            //    by the host half. This is the ONLY source that can see a skin in
            //    that state on DSH Desktop: the plugin manager refuses the reserved
            //    desktop profile (so it answers nothing) and a handle-less skin
            //    that is off has no DOM mark either, so phases 0-5 are all blind to
            //    it. Without phase 6 the switcher could turn such a skin OFF but
            //    never back ON — the asymmetry that left `dsh-dream-skin`
            //    unreachable after it was switched off.
            //
            //    Only packages that are installed and NOT in `dsh.profile.bundles`:
            //    the active ones are phases 0-5's job, and listing them here as well
            //    would offer a duplicate of a skin that is already on screen.
            const pkgs = _profilePackages()
            if (pkgs) {
              const active = new Set(pkgs.active)
              for (const id of pkgs.installed) {
                if (active.has(id)) continue
                if (seen.has(id)) continue
                if (_skinExclude.test(id)) continue
                if (!_skinAllowed(id)) continue
                if (_managedSkins[id]) continue
                seen.add(id)
                skins.push({
                  id,
                  label: _labelFromId(id),
                  sel: null,
                  isActive: false,
                  bodyAttr: null,
                  installedOnly: true,
                })
              }
            }

            return skins
          }

          /**
           * Is this skin's OWN evidence in the document — its activation attribute or one
           * of its style tags, i.e. exactly what `_deactivateCssSkin()` would remove?
           *
           * `_skinInEffect()` cannot answer this: it only knows the two curated handle-less
           * marks. That asymmetry is what let a residue mark outrank a CSS skin.
           */
          function _skinEvidencePresent(skin) {
            if (skin.bodyAttr && _hasSkinAttr(skin.bodyAttr)) return true
            var sels = skin.selectors || (skin.sel ? [skin.sel] : [])
            for (var i = 0; i < sels.length; i++) {
              try { if (document.querySelector(sels[i])) return true } catch (_) {}
            }
            return false
          }

          /**
           * Does the PROFILE say this skin is switched off — installed, but absent from
           * `dsh.profile.bundles`? Then a mark of its own is RESIDUE, not evidence that it
           * renders, and the dropdown must not name it. This is the data-driven form of
           * `_skinSwitchedOff`, and it is the one that survives a reload: a page loaded
           * WHILE the plugin was still bundled keeps its browser half painted after the
           * bundle list changes, which is exactly what made 默认 unreachable.
           */
          function _skinOffInProfile(id) {
            var pkgs = _profilePackages()
            if (!pkgs || !pkgs.installed || !pkgs.active) return false
            return pkgs.installed.indexOf(id) !== -1 && pkgs.active.indexOf(id) === -1
          }

          function _getActiveSkinId() {
            // Optimistic: if the user just selected a skin and activation is in
            // progress, report the pending selection immediately so the dropdown
            // reflects the user's choice.
            if (_pendingSkinId) return _pendingSkinId
            // The host preference is checked FIRST: when the user explicitly
            // chose 'default' through dock-flash, the market's `live` record is
            // stale — _switchSkinBundle disabled the loader entry, but the
            // market's own state.json was never updated (no safe API exists to
            // deactivate a theme through the market without activating another).
            // Without this guard the market's stale `live` overwrites the
            // user's choice on every read, making 默认 impossible to stick.
            var _hostSkin = (_hostPrefs && _hostPrefs.activeSkin) || null
            var _hostExplicitDefault = _hostPrefs && _hostPrefs.activeSkin === 'default'
            if (_hostExplicitDefault) {
              // Host explicitly says default — skip the market's `live` echo
              // entirely.  The market's `live` record is stale because
              // _switchSkinBundle disabled the loader entry, but the market's
              // own state.json was never updated (no safe API exists to
              // deactivate a theme without activating another).  Without this
              // guard the market's stale `live` overwrites the user's choice on
              // every read, making 默认 impossible to stick.
              // Fall through to _skinInEffect / localStorage / DOM scan below.
            } else if (_marketThemes) {
              const live = _marketThemes.themes.find((th) => th.state === 'live')
              if (live) {
                // Keep the other layers in step so a later scan-only path
                // agrees. This is the market reporting what the user already
                // selected on this machine, so it is safe to write outward —
                // but only when it disagrees, to avoid a host write on every
                // read of a value that has not changed.
                // ALSO: when _hostPrefs is null (loadHostPreferences has not
                // completed yet), do NOT write to the host — we do not know
                // what value the host currently holds, and an early write
                // could overwrite the user's stored 'default' preference
                // before it has even been read.
                if (_hostPrefs && _hostPrefs.activeSkin !== live.name) {
                  savePrefs(_prefCtx, { activeSkin: live.name }, () => {
                    try { localStorage.setItem(_skinStorageKey, live.name) } catch (_) {}
                  })
                } else if (!_hostPrefs) {
                  // Host preferences not yet loaded — only update localStorage
                  // as a cache. The host write will happen later when
                  // _getActiveSkinId() is called again after loadHostPreferences
                  // completes.
                  try { localStorage.setItem(_skinStorageKey, live.name) } catch (_) {}
                }
                return live.name
              }
            }
            // A handle-less skin can be rendering while every bookkeeping layer
            // says `default`: the market reports it disabled, the stored
            // preference still holds `default`, and yet the page is visibly
            // wearing the theme.  The dropdown would then show 默认 — the value it
            // is already showing, so the <select> fires no change event and the
            // user has nothing to click and no way out.  The plugin's own marks
            // are the physical evidence, so they outrank the stored id here.
            // The user's OWN persisted choice outranks a stale mark once its evidence is
            // present too. On DSH Desktop a handle-less skin's marks cannot be cleared
            // without a restart (the patch and bundle layers are both boot-time), so a
            // residue mark otherwise named it FOREVER: every pick applied its styles while
            // the dropdown reported Dream, and the selection looked like it snapped back.
            // Only the chosen skin's own evidence is checked, and only when it is not
            // `default` — the documented case below (everything says default while a
            // handle-less theme is painted) still falls through to the mark.
            var chosenId = (_hostPrefs && _hostPrefs.activeSkin) || null
            if (!chosenId) {
              try { chosenId = localStorage.getItem(_skinStorageKey) } catch (_) {}
            }
            if (chosenId && chosenId !== 'default') {
              const chosen = _knownSkins().find((s) => s.id === chosenId)
              if (chosen && !_skinNotControllable(chosen) && _skinEvidencePresent(chosen)) return chosen.id
            }
            const inEffect = _knownSkins().find((s) => _skinInEffect(s.id) &&
              !_skinSwitchedOff[s.id] && !_skinOffInProfile(s.id))
            if (inEffect) return inEffect.id
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
          /**
           * True when a listed skin exposes NO handle dock-flash can switch off
           * in the DOM: no style selectors, no `<style>` tag, no activation
           * attribute.  `_scanInstalledSkins()` records exactly that shape for a
           * skin it knows only from the boot manifest / module graph (phase 4) —
           * it was never seen injecting anything, so there is nothing to remove.
           *
           * This is a statement about what is REACHABLE in the DOM, not a queue
           * of work: on its own it decides nothing.  A skin that reports true here
           * is switched off as a WHOLE PLUGIN, through DSH's own plugin manager
           * (`_switchSkinBundle`) — never through the market's `/toggle`, which
           * edits the install layers.  See the note beside `_marketThemes`.
           */
          function _skinNotControllable(skin) {
            if (skin.managed) return false
            if (skin.sel) return false
            if (skin.bodyAttr) return false
            return !(Array.isArray(skin.selectors) && skin.selectors.length > 0)
          }

          /**
           * Is a handle-less skin VISIBLY in effect in this page?
           *
           * `_skinNotControllable()` answers "can dock-flash reach it in the DOM?"
           * and for these two themes the answer is no — which is exactly why their
           * own marks have to be read instead.  Both inject a `<style>` element (or
           * an activation attribute) of their own, and those outlive the in-place
           * switches DSH performs: a plugin the loader tears down leaves its
           * stylesheets behind, and an instance dock-flash re-mounted itself keeps
           * re-asserting its own saved skin.  So a mark means "this skin is
           * rendering right now", and that is the only question asked of it.
           *
           * DETECTION ONLY — never removal.  A mark is not a handle: nothing here
           * authorises deleting an element or an attribute, because both plugins
           * re-inject their own and would simply undo it.  The switch stays
           * `_switchSkinBundle()`; what the marks buy is honesty — the dropdown can
           * name the skin that is actually rendering, and 默认 can know that a reload
           * is the only thing that will clear it.
           */
          const _skinLiveMarks = {
            // dream-skin sets `data-dsh-material` on <html> and injects these two
            // style elements (package lib/client.js:1778, :2393-2394, :6414-6415).
            'dsh-dream-skin': ['html[data-dsh-material]', 'style#dsh-dream-skin-nav-icon',
              'style[id="dsh-dream-skin:material:liquid-glass"]'],
            // macintosh: its root stylesheet carries `data-mc-root`, and the dock /
            // menubar / hero gates are <html> attributes it removes on teardown
            // (package client.js:6168, :3325, :1703, :4571).
            'dsh-theme-macintosh': ['style[data-mc-root]', 'html[data-mc-dock-on]',
              'html[data-mc-menubar]', 'html[data-mc-hero]'],
          }

          function _skinInEffect(id) {
            const marks = _skinLiveMarks[id]
            if (!marks) return false
            for (const sel of marks) {
              try {
                if (document.querySelector(sel)) return true
              } catch (_) {}
            }
            return false
          }

          /** Say so, once per skin per session, instead of silently doing nothing.
           *  `默认` cannot switch such a skin off — the honest outcome is to name
           *  it and point at its own settings, which is where its switch lives. */
          const _warnedNotControllable = new Set()
          function _warnSkinNotControllable(skin) {
            if (_warnedNotControllable.has(skin.id)) return
            _warnedNotControllable.add(skin.id)
            console.warn('[dock-flash] "' + skin.id + '" cannot be switched off from here: it ' +
              'injects its styles without a data-plugin marker and drives itself from its own ' +
              'state, so there is nothing for dock-flash to remove. Turn it off in its own ' +
              'settings (or in the plugins page), then pick 默认 again.')
          }

          /**
           * DSH's OWN plugin switch, reached through the client remote.
           *
           * This is the switch the official plugins page uses — its client does
           * `ctx.remote.pluginManager.setBundleEnabled(packageName, enabled)` — and it
           * is the only lever that can switch off a skin that gives dock-flash no
           * handle in the DOM.  `_deactivateCssSkin()` cannot touch one: both
           * installed themes re-inject themselves from a MutationObserver, so
           * removing their tags is undone immediately, and they carry no
           * `data-plugin` marker for dock-flash to match.
           *
           * Why THIS and never the market's `/dsh-market/toggle`: that route writes
           * the INSTALL layers on every disable — `disableRow()` appends a
           * `disabled: true` row to the profile's `cordis.patch.yml` and
           * `removeProfileBundle()` drops the package from `dsh.profile.bundles` —
           * while the market's own enable path (`/use-skin` → `activateTheme`)
           * only does live-loader work and clears neither.  One call there is a
           * one-way door.  The plugin manager's switch is SYMMETRIC (the same call
           * with `true` puts the bundle back) and is the same operation the
           * official plugins page offers, so it is always undoable by hand.
           *
           * @returns the remote namespace, or null when the remote service or the
           *          pluginManager namespace is unavailable in this page.
           */
          function _pluginManagerRemote() {
            try {
              const remote = (ctx && typeof ctx.get === 'function' && ctx.get('remote')) ||
                (ctx && ctx.remote)
              const pm = remote && remote.pluginManager
              return pm && (typeof pm.setBundleEnabled === 'function' || typeof pm.setPluginEnabled === 'function') ? pm : null
            } catch (_) {
              return null
            }
          }

          /** Accessor for the plugin inventory remote, mirroring _pluginManagerRemote(). */
          function _pluginInventoryRemote() {
            try {
              const remote = (ctx && typeof ctx.get === 'function' && ctx.get('remote')) ||
                (ctx && ctx.remote)
              const pi = remote && remote.pluginInventory
              return pi && typeof pi.list === 'function' ? pi : null
            } catch (_) {
              return null
            }
          }

          /**
           * Fetch all installed plugin entries and bundles from DSH's native APIs.
           * Returns { entries: PluginInventoryEntry[], bundles: BundleInfo[] }.
           * Either array may be empty if the corresponding remote is unavailable.
           * Never throws — returns empty arrays on failure.
           */
          var _pluginEntriesCache = null
          var _pluginEntriesFetchInFlight = false

          // ── The profile's OWN manifest, read through the HOST half ───────────
          // `dependencies` says what is INSTALLED, `dsh.profile.bundles` says what
          // this DSH composes at boot. On DSH Desktop the plugin manager refuses
          // the reserved desktop profile (`manageDesktopProfile` /
          // `rejectElectronProfile`), so `listPlugins()` / `listBundles()` answer
          // nothing — and a handle-less skin that is switched OFF has no DOM mark
          // either. This route is then the ONLY proof that it is installed, and
          // without it the switcher could turn such a skin off but never back on.
          //
          // Same caching discipline as _fetchPluginEntries(): cache only a read
          // that brought something, so a failure stays retryable; and notify when
          // rows arrive (never unconditionally, which would make render → fetch →
          // notify a loop).
          var _profilePackagesCache = null
          var _profilePackagesInFlight = null
          var _profilePackagesLastError = null
          var _profilePackagesNextTry = 0

          /** The cached manifest, or null when it has not been read yet. */
          function _profilePackages() {
            return _profilePackagesCache
          }

          function _fetchProfilePackages() {
            try {
              return fetch('/plugins/dock-flash/profile-packages', {
                headers: { accept: 'application/json' },
              }).then(function (r) {
                return r && r.ok ? r.json() : null
              }, function (e) {
                return { error: String((e && e.message) || e) }
              }).then(function (body) {
                if (!body) {
                  return { installed: [], active: [], error: 'the host route did not answer', at: Date.now() }
                }
                var snapshot = {
                  dir: body.dir || null,
                  installed: Array.isArray(body.installed) ? body.installed : [],
                  active: Array.isArray(body.active) ? body.active : [],
                  error: body.error || null,
                  at: Date.now(),
                }
                if (snapshot.installed.length > 0 || snapshot.active.length > 0) {
                  _profilePackagesCache = snapshot
                }
                return snapshot
              })
            } catch (e) {
              return Promise.resolve({
                installed: [], active: [], error: String((e && e.message) || e), at: Date.now(),
              })
            }
          }

          /**
           * Warm the manifest cache. A failure is not cached, but it must not turn
           * every render into a request either — hence the bounded retry.
           */
          function _refreshProfilePackages() {
            if (_profilePackagesCache || _profilePackagesInFlight) return _profilePackagesInFlight
            if (Date.now() < _profilePackagesNextTry) return null
            _profilePackagesInFlight = _fetchProfilePackages().then(function (snapshot) {
              _profilePackagesInFlight = null
              _profilePackagesLastError = snapshot.error || null
              if (snapshot.installed.length > 0 || snapshot.active.length > 0) {
                // Rows arrived: the dropdown now has more to show.
                try { registry.notifyChange('dock-flash:skin') } catch (_) {}
              } else {
                _profilePackagesNextTry = Date.now() + 5000
                if (typeof console !== 'undefined' && console.debug) {
                  console.debug('[dock-flash] profile inventory unavailable:', _profilePackagesLastError)
                }
              }
              return snapshot
            })
            return _profilePackagesInFlight
          }

          function _fetchPluginEntries() {
            if (_pluginEntriesCache) return Promise.resolve(_pluginEntriesCache)
            if (_pluginEntriesFetchInFlight) return _pluginEntriesFetchInFlight

            _pluginEntriesFetchInFlight = Promise.all([
              (function () {
                var pm = _pluginManagerRemote()
                if (pm && typeof pm.listPlugins === 'function') {
                  // `ok` means "this read CONCLUDED", and it is what the cache
                  // decision below reads.  A rejection used to be reported as
                  // `data: []` with `pmAvailable: true` — which looks exactly like
                  // "this profile has no plugins", so the empty snapshot was cached
                  // and ONE transient failure made every skin unaddressable
                  // (`NO ADDRESSABLE ROW`) until a page reload.  Measured on a
                  // profile with 73 client packages whose dropdown read `[]`.
                  return Promise.resolve(pm.listPlugins()).then(
                    function (r) { return { data: Array.isArray(r) ? r : [], pmAvailable: true, ok: true } },
                    function () { return { data: [], pmAvailable: true, ok: false } }
                  )
                }
                // Fallback: use the plugin inventory remote when the plugin
                // manager is unavailable.  The inventory's list() returns
                // { entries: [...] } with the same entry shape (entryId,
                // moduleName, enabled) — enough for skin discovery, though
                // without the management fields (readOnlyReason, patchId)
                // that only the plugin manager provides.
                var pi = _pluginInventoryRemote()
                if (pi && typeof pi.list === 'function') {
                  return Promise.resolve(pi.list()).then(
                    function (r) {
                      var entries = (r && Array.isArray(r.entries)) ? r.entries : []
                      return { data: entries, piAvailable: true, ok: true }
                    },
                    function () { return { data: [], piAvailable: true, ok: false } }
                  )
                }
                // No remote at all: NOT a concluded read.  The remotes namespace
                // can arrive late at boot, so caching this emptiness would block
                // discovery for good.
                return Promise.resolve({ data: [], pmAvailable: false, ok: false })
              })(),
              (function () {
                var pm = _pluginManagerRemote()
                if (!pm || typeof pm.listBundles !== 'function') return Promise.resolve({ data: [], pmAvailable: false, ok: false })
                return Promise.resolve(pm.listBundles()).then(
                  function (r) { return { data: Array.isArray(r) ? r : [], pmAvailable: true, ok: true } },
                  function () { return { data: [], pmAvailable: true, ok: false } }
                )
              })(),
            ]).then(function (results) {
              var snapshot = { entries: results[0].data, bundles: results[1].data, at: Date.now() }
              // Cache only a read that CONCLUDED.  `pmAvailable` answers "does the
              // remote exist", which is a different question, and keying the cache
              // off it is what let one rejection masquerade as "no skins installed".
              // The entries read decides: it is what discovery and addressability
              // need.  NOT caching means the next render retries — the loop that
              // would otherwise cause is closed in _refreshPluginEntries(), which
              // only notifies when rows actually arrived.
              if (results[0].ok) {
                _pluginEntriesCache = snapshot
              }
              _pluginEntriesFetchInFlight = false
              return snapshot
            }).catch(function (err) {
              _pluginEntriesFetchInFlight = false
              console.warn('[dock-flash] _fetchPluginEntries failed:', err)
              return { entries: [], bundles: [], at: Date.now() }
            })

            return _pluginEntriesFetchInFlight
          }

          /** Invalidate the plugin entries cache so the next read re-fetches. */
          function _invalidatePluginEntries() {
            _pluginEntriesCache = null
          }

          /** `listBundles()`/`setBundleEnabled()` are keyed by PACKAGE name, while
           *  a skin id may carry a loader entry suffix. */
          function _skinBundleName(id) {
            return String(id).replace(/\/client$/, '')
          }

          /**
           * The composition entry the plugin manager can address for one skin, or
           * null when there is none.
           *
           * Two switches exist and they are NOT interchangeable:
           * `setPluginEnabled(entryId, enabled)` acts on the RUNNING loader, and
           * `setBundleEnabled(package, enabled)` only edits `dsh.profile.bundles`,
           * which DSH composes at BOOT.  Only the entry switch can change what the
           * user is looking at, and it is also the one that writes AND clears the
           * entry's `disabled:` row in the profile patch layer.  A row the manager
           * refuses to touch carries `readOnlyReason` and is skipped.
           */
          function _skinEntryRow(rows, name) {
            if (!Array.isArray(rows)) return null
            const cands = [name, name.replace(/^@[^/]+\//, ''), name.replace(/^dsh-/, '')]
              .filter((v, i, a) => v && a.indexOf(v) === i)
            let best = null
            let bestScore = 0
            for (const r of rows) {
              if (!r || !r.entryId || r.readOnlyReason) continue
              const keys = [[String(r.moduleName || ''), 3], [String(r.entryId), 2]]
              for (const [k, weigh] of keys) {
                if (!k) continue
                for (const c of cands) {
                  const score = k === c ? weigh * 2
                    : (k.indexOf(c + '/') === 0 || k === c + '/client') ? weigh : 0
                  if (score > bestScore) { bestScore = score; best = r }
                }
              }
            }
            return best
          }

          /**
           * Switch a handle-less theme plugin on or off through DSH's own plugin
           * manager, and report whether the profile actually CHANGED.
           *
           * The ENTRY switch is tried first — it applies to the running loader, and
           * it is symmetric: `false` writes the entry's `disabled:` row, `true`
           * clears it again.  `setBundleEnabled()` is only the fallback for a
           * package with no addressable row; that one is composed at boot, so it
           * says a DSH restart is needed instead of looking like a dead control.
           *
           * The state is read FIRST, so pressing 默认 on an already-default page
           * writes nothing and cannot reload in a loop — `_applySkin()` also runs at
           * boot, and an unconditional write there would be an endless reload.
           *
           * When no lever is available, a disable falls back to
           * `_warnSkinNotControllable()`: the honest "do it in its own settings"
           * message.  Never a silent no-op, and never a market write.
           */
          const _bundleReported = new Set()

          // ── Skin-switch trace ─────────────────────────────────────────────
          // A press that does nothing leaves no trace in any file: either no write
          // happened, or a write happened and no reload followed it.  Those two have
          // completely different fixes and look identical from the outside, so every
          // decision on the way is recorded in a small ring.
          // `__dockFlashSkinTrace()` in the console.
          const _skinTraceKey = 'dock-flash:skin-trace'
          const _skinTraceMem = []
          var _skinReloadWhy = null
          // The ring lives in sessionStorage, NOT just in memory: the switches this
          // trace explains CAUSE the reloades they would be read after, and an
          // in-memory ring is wiped by exactly the event it is meant to record —
          // which makes "no entries" look like "nothing was pressed".  40 entries
          // hold several press/reload cycles.  The in-memory copy is the fallback
          // for a context where sessionStorage does not round-trip (the harness
          // stubs it), so a no-op stub degrades to memory instead of losing data.
          function _skinTraceRead() {
            try {
              const raw = sessionStorage.getItem(_skinTraceKey)
              if (raw) {
                const parsed = JSON.parse(raw)
                if (Array.isArray(parsed)) return parsed
              }
            } catch (_) {}
            return _skinTraceMem
          }
          function _skinTraceWrite(ring) {
            try {
              _skinTraceMem.length = 0
              for (let i = 0; i < ring.length; i++) _skinTraceMem.push(ring[i])
            } catch (_) {}
            try { sessionStorage.setItem(_skinTraceKey, JSON.stringify(ring)) } catch (_) {}
          }
          function _skinTrace(label, detail) {
            try {
              const ring = _skinTraceRead()
              ring.push({ at: new Date().toISOString(), event: label, detail: detail || null })
              while (ring.length > 40) ring.shift()
              _skinTraceWrite(ring)
            } catch (_) {}
          }
          window.__dockFlashSkinTrace = function () {
            try { return JSON.parse(JSON.stringify(_skinTraceRead())) } catch (_) { return [] }
          }
          // Seed the ring immediately, because an empty answer is otherwise
          // ambiguous between the two opposite conclusions: the bundle never ran,
          // or nothing was pressed.  With a `boot` line in it, empty can only mean
          // this code did not load.
          try { _skinTrace('boot', { version: CLIENT_VERSION, page: String(location && location.href) }) } catch (_) {}
          // And what is actually PAINTED a few seconds later — the reload's own
          // outcome, which no write can report.
          try {
            setTimeout(function () {
              try {
                _skinTrace('render', {
                  inEffect: Object.keys(_skinLiveMarks).filter(function (id) { return _skinInEffect(id) }),
                  stored: _getActiveSkinId(),
                })
              } catch (_) {}
            }, 2500)
          } catch (_) {}
          /**
           * The loader entry ids a client plugin can be addressed by, WITHOUT
           * `listPlugins()`.
           *
           * That call is not the only source of an entry id, and on DSH Desktop it
           * is an EMPTY one: the plugin manager refuses the reserved desktop profile,
           * so no row ever arrives and every switch fell through to the bundle layer
           * — which only the next DSH boot can apply.  MEASURED: DSH's OWN Plugins
           * page toggles the very same plugin **live** on that profile, so the entry
           * switch is reachable; what its rows provide is the id, and the boot
           * manifest carries the same ids for every client plugin this page loaded.
           *
           * Candidates are restricted to strings that name THIS package (or its
           * `/client` half) — never a fuzzy match — because a wrong id would toggle
           * somebody else's plugin.
           */
          function _entryIdCandidates(name) {
            var out = []
            var add = function (v) {
              if (typeof v === 'string' && v && out.indexOf(v) === -1) out.push(v)
            }
            add(name)
            try {
              var boot = window.__DSH_BOOT__
              if (boot && Array.isArray(boot.entries)) {
                for (var i = 0; i < boot.entries.length; i++) {
                  var id = boot.entries[i] && boot.entries[i].id
                  if (typeof id !== 'string') continue
                  if (id === name || id === name + '/client' || id.indexOf(name + '/') === 0) add(id)
                }
              }
            } catch (_) {}
            add(name + '/client')
            return out
          }

          /** Is this package loaded in the page right now, per the boot manifest? */
          function _isBootLoaded(name) {
            var signals = _managedInstallSignals()
            var variants = [name, name + '/client']
            var has = function (set) {
              if (!set) return false
              for (var i = 0; i < variants.length; i++) if (set.has(variants[i])) return true
              return false
            }
            if (has(signals.bootIds)) return true
            try {
              if (signals.graphRows && typeof signals.graphRows.has === 'function') {
                for (var j = 0; j < variants.length; j++) if (signals.graphRows.has(variants[j])) return true
              }
            } catch (_) {}
            return false
          }

          /**
           * Ask the HOST half to flip this plugin's loader entry.
           *
           * It performs the same edit DSH's own plugin manager performs — the
           * `disabled:` row in the profile's patch document — and the running loader
           * watches that document. This is the live switch the client remote cannot
           * provide on DSH Desktop, where EVERY id answers `unknown-plugin` because
           * its inventory does not manage the reserved profile.
           *
           * Returns true only when the host reports `applied`.
           */
          function _setEntryViaHost(name, enabled) {
            try {
              return fetch('/plugins/dock-flash/set-plugin-entry', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: name, enabled: !!enabled }),
              }).then(function (r) {
                return r && r.ok ? r.json() : null
              }, function () { return null }).then(function (body) {
                var value = (body && body.value) || {}
                _skinTrace('host', {
                  name: name,
                  want: !!enabled,
                  ok: !!(body && body.ok),
                  application: String(value.application || 'unknown'),
                  changed: value.changed === undefined ? undefined : !!value.changed,
                  error: value.error
                    ? String(value.error.code || value.error.message || value.error)
                    : undefined,
                })
                // The caller decides, because the host reports DSH's own vocabulary:
                // `applied` (live), `restart-required` (the patch layer decides the NEXT
                // boot — MEASURED on DSH Desktop), or a failure. `null` means the route
                // did not answer at all, which is the caller's cue to fall back.
                if (!body || !body.ok) return null
                return String(value.application || 'unknown')
              })
            } catch (e) {
              return Promise.resolve(null)
            }
          }

          /**
           * Remove a handle-less skin's own marks AFTER it has been unloaded through the
           * loader. Safe only at that point: while the plugin is alive it re-injects them,
           * which is why the marks are DETECTION-ONLY everywhere else. Its dispose does not
           * always take them with it, and a stale mark then names a skin that is no longer
           * running — MEASURED: after the loader unloaded Dream, the dropdown still
           * reported Dream while 默认 was the real state.
           */
          function _clearLiveMarks(id) {
            // Intent first: even with no mark left to remove, this skin must not be named again.
            _skinSwitchedOff[id] = true
            var marks = _skinLiveMarks[id]
            if (!marks) return
            for (var i = 0; i < marks.length; i++) {
              try {
                var sel = marks[i]
                var attr = /\[([^\]=]+)/.exec(sel)
                if (attr) {
                  // An activation attribute (e.g. `html[data-dsh-material]`): drop the
                  // attribute itself, whatever value it carries.
                  var nodes = document.querySelectorAll(sel.replace(/\[[^\]]*\]/, '[' + attr[1] + ']'))
                  for (var j = 0; j < nodes.length; j++) nodes[j].removeAttribute(attr[1])
                } else {
                  var els = document.querySelectorAll(sel)
                  for (var k = 0; k < els.length; k++) els[k].remove()
                }
              } catch (_) {}
            }
          }

          function _switchSkinBundle(skin, enabled, opts) {
            // `opts.silent` suppresses the user-facing "switch it off yourself"
            // fallbacks.  It is for the deactivation of a CONTROLLABLE skin the
            // market still records as `live`: dock-flash already removed it from
            // the DOM (`_deactivateCssSkin`), so the switch visibly worked, and
            // telling the user there is nothing to remove would be both wrong and
            // noise.  The loader write is still ATTEMPTED — it is what makes the
            // dirty/boot-time layers persist — but its absence is traced, not
            // shouted.  Handle-less skins keep the loud default.
            const silent = !!(opts && opts.silent)
            const name = _skinBundleName(skin.id)
            const pm = _pluginManagerRemote()
            const give = (why) => {
              _skinTrace('bundle', { name: name, want: !!enabled, wrote: false, why: (why || 'no lever available') })
              if (silent) return false
              if (why && !_bundleReported.has('give:' + name)) {
                _bundleReported.add('give:' + name)
                console.warn('[dock-flash] no plugin-manager switch available for "' + name + '": ' + why)
              } else if (!enabled && !_bundleReported.has(name)) {
                _bundleReported.add(name)
                _warnSkinNotControllable(skin)
              }
              return false
            }
            if (!pm) return Promise.resolve(give(
              'the client remote did not resolve — "remote.pluginManager" must be declared in ' +
              'this plugin\'s inject[] (each typert namespace is its own service) and ' +
              'dsh.client.inject must name @deepseek-ai/dsh-api-remotes'))
            const fail = (e) => {
              _skinTrace('bundle', { name: name, want: !!enabled, wrote: false, error: String((e && e.message) || e) })
              if (!_bundleReported.has(name)) {
                _bundleReported.add(name)
                console.warn('[dock-flash] could not switch "' + name + '" ' +
                  (enabled ? 'on' : 'off') + ' through DSH’s plugin manager — ' +
                  String((e && e.message) || e) + ' — use the plugins page instead.')
              }
              return false
            }
            const byBundle = () => {
              // The write SUCCEEDED — this runs as the success handler of
              // setBundleEnabled(). It used to be traced as `wrote: false`, which
              // conflated two different facts: "did a write happen" and "does this
              // call request a reload". MEASURED on DSH 0.2.0-rc.2: a profile whose
              // bundle row was switched this way lost the plugin on the NEXT PAGE
              // LOAD with no DSH restart, so the reload `_applySkin()` performs is
              // what applies this write — and a trace that said `wrote: false` made
              // that impossible to see.
              _skinTrace('bundle', {
                name: name,
                want: !!enabled,
                wrote: true,
                path: 'bundle',
                reloadRequested: false,
                why: 'dsh.profile.bundles — the ON path reloads via the plugin-manager activation',
              })
              if (!_bundleReported.has('bundle:' + name)) {
                _bundleReported.add('bundle:' + name)
                console.warn('[dock-flash] "' + name + '" was switched in ' +
                  'dsh.profile.bundles; the page reloads to apply it — restart DSH ' +
                  'if it does not.')
              }
              // false = "this call does not ask for a reload of its own". The reload
              // that applies this write comes from the caller: `_applySkin()`'s
              // `inEffect` rule (OFF) or `_activateThemeViaPluginManager()` (ON).
              // Asking for one here as well produced TWO page loads per press —
              // `check:overlay` pins one, and it was right to.
              return false
            }
            return Promise.resolve()
              .then(() => (typeof pm.listPlugins === 'function' ? pm.listPlugins() : null))
              .then((rows) => _skinEntryRow(rows, name), () => null)
              .then((row) => {
                var byBundlePath = () => {
                  return Promise.resolve()
                    .then(() => (typeof pm.listBundles === 'function' ? pm.listBundles() : null))
                    .then((rows) => {
                      const bundleRow = Array.isArray(rows) ? rows.find((x) => x && x.name === name) : null
                      // The plugin manager's row is authoritative when it exists.
                      // When it does NOT — DSH Desktop answers nothing for its
                      // reserved profile — the profile's own manifest is: `installed`
                      // proves the name is real, `active` is the state. That is what
                      // lifts the `give()` below for an installed-but-off skin, and it
                      // is also the state read that keeps an already-satisfied press
                      // from writing (and reloading) in a loop.
                      const pkgs = _profilePackages()
                      const hostKnows = !!(pkgs && pkgs.installed.indexOf(name) !== -1)
                      if (bundleRow) {
                        if ((bundleRow.enabled !== false) === !!enabled) return false
                      } else if (hostKnows) {
                        if ((pkgs.active.indexOf(name) !== -1) === !!enabled) return false
                      } else if (Array.isArray(rows)) {
                        return give()
                      }
                      return Promise.resolve(pm.setBundleEnabled(name, enabled)).then(byBundle, fail)
                    }, fail)
                }

                // An addressable ENTRY is authoritative: it is the live lever, and a
                // plugin the loader can already address must never have its install
                // layer edited instead.
                if (row) {
                  if (typeof pm.setPluginEnabled !== 'function') {
                    return give('setPluginEnabled is not on the plugin-manager remote')
                  }
                  // ── "the row already reads the wanted state" has TWO causes ──────
                  // The row governs the HOST half; `dsh.profile.bundles` governs the VISIBLE
                  // one, and neither implies the other.
                  //
                  // The plain case: the row already read that state BEFORE this call, so
                  // nothing was written and the roster has nothing to follow.
                  //
                  // The case the caller reports with `opts.entryWritten`: the CALLER wrote the
                  // row itself. The deactivation loops do exactly that — they call
                  // `setPluginEnabled(entryId, false)` and THEN ask for the package to go — so
                  // by the time this branch reads `row` it already says `false`, equal to the
                  // wanted `false`, and the roster write was skipped. MEASURED on a Claude →
                  // Dream switch: the entry really was disabled
                  // (`pluginCalls: ["dream-skin:true","ui-skin-claude-style:false"]`) while
                  // `bundleCalls` stayed EMPTY, leaving `claude-style-skin` inside
                  // `dsh.profile.bundles` — off in the loader and still composed in on the next
                  // boot, i.e. the reported "切换后 Claude 没被停用". The flag was already being
                  // passed by both loops and never read here.
                  //
                  // So: the row work is skipped (either it is already done, or the caller did
                  // it) and the roster is consulted. `byBundlePath()` keeps its own
                  // already-satisfied guard and reports whether it really wrote, and only a
                  // real write asks for a reload — an ON press that changes nothing therefore
                  // stays silent, which is the guard that stops a boot loop.
                  if (row.enabled === enabled || (opts && opts.entryWritten)) {
                    return byBundlePath().then(function (wrote) { return wrote === true })
                  }
                  return Promise.resolve(pm.setPluginEnabled(row.entryId, enabled)).then(function (result) {
                    var application = (result && result.value && result.value.application) || 'unknown'
                    _skinTrace('entry', {
                      name: name, want: !!enabled, entryId: row.entryId, application: String(application),
                    })
                    // ── the entry is the RUNNING loader; the roster is the NEXT BOOT ──
                    // Writing the entry and stopping here leaves the package inside
                    // `dsh.profile.bundles`, so the next load composes it straight back
                    // in. MEASURED in the harness with an entry that was ENABLED:
                    // `switchSkinBundle name=dsh-repo-installed-skin want=false
                    // row=dsh-repo-installed-skin:true` was followed by NO
                    // `byBundlePath()` call at all, so the roster still read `true` while
                    // the loader row read `false` — which is precisely the reported
                    // "停不掉 Claude": the entry switches off, the page looks right, and
                    // the skin is back after the next load. The already-satisfied branch
                    // above consults the roster; this one has to as well, or the two
                    // layers disagree for exactly one boot — the boot after the press.
                    //
                    // The two reasons to reload are OR-ed rather than replaced:
                    // `application === 'unknown'` keeps the meaning it had ("cannot tell
                    // what the loader did, assume a reload is needed"), and a roster write
                    // is its own reason — a bundle row only takes effect on a load.
                    return byBundlePath().then(function (wrote) {
                      return wrote === true || application === 'unknown'
                    })
                  }, fail)
                }

                // NO row. On DSH Desktop there never is one — the plugin manager
                // refuses the reserved desktop profile — while DSH's OWN Plugins page
                // toggles the very same plugin LIVE there (MEASURED). What those rows
                // provide is the entry ID, and the boot manifest carries the same ids
                // for every client plugin this page loaded, so the LIVE switch is
                // reachable without them — which is the difference between a skin
                // toggle that works and one that demands a DSH restart.
                var candidates = []
                if (typeof pm.setPluginEnabled === 'function') {
                  // Only attempted when the known state DISAGREES with the wanted one,
                  // so a switch never rewrites the patch row of a plugin that is
                  // already where the user wants it (and cannot reload in a loop).
                  var pkgsNow = _profilePackages()
                  var enabledNow = _isBootLoaded(name) || !!(pkgsNow && pkgsNow.active.indexOf(name) !== -1)
                  if (enabledNow !== !!enabled) candidates = _entryIdCandidates(name)
                }
                // ── no remote candidates is NOT "nothing to do" ──────────────────────
                // `candidates` comes from `_entryIdCandidates()` — a GUESS built from the
                // package name — and it is empty in the two states that matter most:
                //   * `_profilePackages()` has not answered yet, so `enabledNow` reads
                //     `false`, and for a DISABLE that happens to equal the wanted `false`.
                //     That is exactly the FIRST press of 默认: MEASURED, the press fell
                //     straight through to `byBundlePath()`, which has no lever on DSH
                //     Desktop, wrote nothing, and the page reloaded on `inEffect` alone —
                //     the trace carried `press` + `reload` and no `entry`/`host` line at
                //     all. The NEXT press worked, because the reload had populated the
                //     manifest cache by then: "从 Dream 切回默认需要切两次".
                //   * the plugin's real entry id is not derivable from its package name
                //     (`dsh-dream-skin` → `dream-skin`), so the guess cannot be right.
                // The HOST is the authority on both: it reads the package's own
                // `cordis.patch.yml` (`entryIdFor()`), writes the patch row the running
                // loader watches, and answers `changed`.
                //
                // BOTH layers are written, and that is the whole point — they are not
                // interchangeable and neither may replace the other: the ENTRY row is what
                // the running loader acts on, while `dsh.profile.bundles` is what the NEXT
                // boot composes from. Writing only the entry is how a re-enable left
                // `dsh-dream-skin` installed but absent from the roster, so the plugin could
                // not come back ("选了 Dream 还是停用"); writing only the bundle is the
                // two-press bug above. MEASURED both ways.
                if (!candidates.length) {
                  return _setEntryViaHost(name, enabled).then(function (application) {
                    // `null` = the route did not answer (a host half without it). Fall back
                    // to the bundle path, which is what such a build has — without this the
                    // press went silent instead of at least recording the wanted state and
                    // saying a DSH restart is needed.
                    if (application === null) return byBundlePath()
                    // 'applied' means the entry really moved, and the roster still has to
                    // follow; 'failed'/'restart-required' leaves the bundle write to record
                    // the wanted state. Either way a real change asks for the reload, and an
                    // already-satisfied entry (`changed: false`) reports the same 'applied',
                    // so the press stays silent and cannot reload in a loop.
                    return byBundlePath().then(function (wrote) {
                      return wrote === true || application === 'applied'
                    })
                  })
                }

                var attempt = function (i) {
                  if (i >= candidates.length) return Promise.resolve(null)
                  return Promise.resolve(pm.setPluginEnabled(candidates[i], enabled)).then(function (result) {
                    if (result && result.ok === true) {
                      // Only an EXPLICIT `applied` counts as live. A result with no
                      // `value.application` (an older host) stays unknown and keeps the
                      // old reload, because assuming "live" from silence would leave
                      // the user looking at a page that never changes.
                      var value = result.value || {}
                      var application = value.application || 'unknown'
                      // `application: "failed"` names no reason. `ChangeResult` carries
                      // DSH's own diagnostic beside it, and that is the only thing that
                      // says WHY — record it, or the next reader ends up guessing among
                      // permission, id shape and loader state all at once.
                      var failure
                      if (value.error) {
                        failure = typeof value.error === 'string'
                          ? value.error
                          : String(value.error.code || value.error.message || JSON.stringify(value.error))
                      }
                      _skinTrace('entry', {
                        name: name, want: !!enabled, entryId: candidates[i], application: String(application),
                        error: failure,
                        resultKeys: Object.keys(value).join(','),
                      })
                      if (application === 'applied' || application === 'restart-required') {
                        if (application === 'restart-required' && !_bundleReported.has('restart:' + name)) {
                          _bundleReported.add('restart:' + name)
                          console.warn('[dock-flash] "' + name + '" was switched in the loader, but DSH ' +
                            'reports restart-required for it — restart DSH to see the change.')
                        }
                        return application
                      }
                      // `ok: true` with any OTHER application (MEASURED: "failed" on
                      // DSH Desktop) means this id did not work. The call shape is
                      // right — `pluginEntryId()` is a pass-through brand for "the
                      // entry id as the Loader tree spells it" — so try the next
                      // candidate before giving up: the same plugin is addressable as
                      // the package or as its `/client` half, and stopping at the
                      // first answer is what made the `/client` spelling unreachable.
                      return attempt(i + 1)
                    }
                    return attempt(i + 1)
                  }, function () { return attempt(i + 1) })
                }
                return attempt(0).then(function (application) {
                  if (application === null || application === 'failed') {
                    // The remote could not address this profile — DSH Desktop answers
                    // `unknown-plugin` for every id — so ask the HOST half, which
                    // performs the plugin manager's own edit on the patch document the
                    // running loader watches. Only if THAT fails do we touch install
                    // layers, which shape the next boot instead of this page.
                    return _setEntryViaHost(name, enabled).then(function (application) {
                      // A disable that reached the layer means the plugin is going away,
                      // whatever application it reports — so its marks are residue from here
                      // on. Recording that BEFORE the branches decide is what makes the
                      // dropdown follow reality; doing it in one branch only is exactly how
                      // the residue survived and kept naming Dream.
                      if (!enabled && application !== null) {
                        // Tear down what we can immediately, then RELOAD. The cleanup is a
                        // courtesy, not the mechanism: MEASURED and already in AGENTS.md, the
                        // page's desired roster is fixed at boot (`start(loader, manifest)` →
                        // `this.desired = manifest`, with no setDesired/onManifest), so nothing
                        // in the RUNNING page unmounts a plugin's browser half — "in that state
                        // the reload IS the switch". `application: 'applied'` speaks only for the
                        // HOST loader entry, which was never the half that was painting.
                        _clearLiveMarks(name)
                        _skinReloadWhy = 'entryDisable:' + name
                        // BOTH layers. The ENTRY row governs only the host half; the VISIBLE
                        // half follows membership in `dsh.profile.bundles` — MEASURED across
                        // this whole investigation (the plugin kept painting while its entry
                        // read `disabled: true`, and vanished only once it was out of the
                        // bundle list). Returning on the entry route's `applied` is exactly why
                        // selecting another skin stopped switching the previous handle-less
                        // plugin off, so the bundle write must still run — then reload.
                        return byBundlePath().then(function () {
                          // BOTH branches of this route invalidate the manifest snapshot; only
                          // the enable one used to. The bundle list just changed, so the cached
                          // snapshot still describes the state BEFORE it — which made
                          // `_skinOffInProfile()` answer "active" for a package that is no
                          // longer bundled, and the marks rule then kept naming a skin that is
                          // on its way out. A residue that outlives its cause is exactly the
                          // class of bug this whole route exists to end.
                          _profilePackagesCache = null
                          _profilePackagesNextTry = 0
                          _fadeBeforeReload()
                          return false
                        })
                      }
                      if (application === 'applied' || application === 'restart-required') {
                        // The patch row was WRITTEN either way, and MEASURED with the correct
                        // shape (`id` + `name` + `disabled`) the running loader drops the
                        // plugin at once. Its own marks can linger, and those stale marks then
                        // name a skin that is no longer running. Cleaning them is safe even if
                        // this build of the host only reports `restart-required`: a plugin that
                        // is still alive simply re-injects its marks.
                        if (!enabled) _clearLiveMarks(name)
                        else {
                          // The two directions are NOT symmetric. OFF: the host unloads the
                          // fiber and the page stops painting it, so nothing more is needed
                          // (lingering marks are cleaned above). ON: the host mounts the
                          // fiber, but the CLIENT half must be fetched into the page — the
                          // browser's module graph is built at page load. Without a reload
                          // the selection looks inert, which is what was reported.
                          // And ONE patch row is not enough for this direction either: an
                          // entry missing from `dsh.profile.bundles` is ABSENT from the
                          // composition, so the row has nothing to un-disable — MEASURED: the
                          // plugin stayed 停用 and never came back while only the row was
                          // written. Record the wanted state in the bundle layer too (it keeps
                          // its own already-satisfied guard), THEN reload so the client half
                          // is fetched into the page.
                          _skinReloadWhy = 'entryEnable:' + name
                          return byBundlePath().then(function () {
                            // The bundle list just changed and the cached snapshot still
                            // describes the state BEFORE it — which made
                            // `_skinOffInProfile()` answer "active" and the marks rule name a
                            // plugin that is no longer bundled. Drop the cache so the next
                            // read is fresh.
                            _profilePackagesCache = null
                            _profilePackagesNextTry = 0
                            _fadeBeforeReload()
                            return false
                          })
                        }
                        if (application === 'applied') return false
                      }
                      if (application === 'restart-required') {
                        // MEASURED: the patch layer decides what the NEXT boot loads and
                        // does not unload a running entry here, so this is the same answer
                        // DSH's own dialog gives — a page reload cannot help either. Say it
                        // once, and STILL let the bundle layer record the wanted state:
                        // that list is what actually adds or removes a plugin at boot, so
                        // stopping here is what made "select Dream" do nothing at all.
                        // `byBundlePath()` keeps its own already-satisfied guard.
                        if (!_bundleReported.has('restart:' + name)) {
                          _bundleReported.add('restart:' + name)
                          console.warn('[dock-flash] "' + name + '" was switched in the profile patch ' +
                            'layer; restart DSH (not just this page) for it to take effect.')
                        }
                        return byBundlePath()
                      }
                      return byBundlePath()
                    })
                  }
                  if (application === 'applied' || application === 'restart-required') {
                    // `applied` needs no reload (the loader and the page already agree)
                    // and `restart-required` cannot be helped by one — asking for it is
                    // what turned every switch into a page load.
                    return false
                  }
                  return true
                })
              })
              .then((wrote) => {
                // The one fact that separates "the switch is broken" from "the switch
                // worked and this page never reloaded": did a write actually happen?
                _skinTrace('bundle', { name: name, want: !!enabled, wrote: wrote === true })
                return wrote
              })
          }

          /**
           * One line of evidence for the skin switch, for when a press does nothing:
           * whether the remote resolved at all, which rows the plugin manager can
           * address for the skin packages, and what the bundle list says.
           * `__dockFlashSkinSwitch()` in the console.
           */
          window.__dockFlashSkinSwitch = function () {
            // Every fact needed to explain a 默认 press that did nothing: whether the
            // remote resolved at all (and through which accessor), which skins the
            // dropdown actually knows about, and what the plugin manager can address
            // for each of them.  Read-only: it writes nothing.
            const probe = (fn) => { try { return fn() } catch (e) { return "threw: " + String((e && e.message) || e) } }
            const asKeys = (v) => v === undefined ? "undefined"
              : (v && typeof v === "object" ? Object.keys(v) : String(v))
            const ctxRemote = probe(() => ctx && ctx.remote)
            const viaGet = probe(() => (ctx && typeof ctx.get === "function") ? ctx.get("remote") : undefined)
            const pm = _pluginManagerRemote()
            const out = {
              remote: pm ? "available" : "MISSING — dsh.client.inject must name the remotes package",
              ctxRemote: asKeys(ctxRemote),
              ctxGetRemote: asKeys(viaGet),
              pluginManager: pm ? Object.keys(pm) : "MISSING",
              market: _marketAvailable() && _marketThemes && Array.isArray(_marketThemes.themes)
                ? _marketThemes.themes.map((th) => String(th.name) + ":" + String(th.state)).join(", ")
                : "unavailable",
              skins: _knownSkins().map((s) => String(s.id) +
                " | handle-less=" + String(_skinNotControllable(s)) +
                " | managed=" + String(!!s.managed) +
                " | pmOnly=" + String(!!s.pmOnly) +
                // `liveMark=true` means this row came from PHASE 5 — i.e. the skin was
                // listed because its own marks are in the document right now. It is also
                // the only way to tell a fresh bundle from a cached one from the outside:
                // CLIENT_VERSION does not move for a code change that was never released.
                " | liveMark=" + String(!!s.liveMark) +
                " | sel=" + String(s.sel) +
                " | bodyAttr=" + String(s.bodyAttr) +
                " | selectors=" + String((s.selectors || []).length)),
              entries: null,
              plugins: null,
              bundles: null,
              // The profile's OWN manifest — phase 6's source, and the only one
              // that survives when the plugin manager answers nothing. Computed
              // here, BEFORE the `if (!pm) return out` below, because that is
              // exactly the case it exists for.
              profilePackages: (function () {
                _refreshProfilePackages()
                var p = _profilePackages()
                if (!p) {
                  return "not read yet — call again (" +
                    String(_profilePackagesLastError || "first read in flight") + ")"
                }
                var off = p.installed.filter(function (n) { return p.active.indexOf(n) === -1 })
                return String(p.installed.length) + " installed, " + String(p.active.length) + " active" +
                  " | installed-but-off: " + (off.join(", ") || "(none)") +
                  " | dir: " + String(p.dir || "?") +
                  (p.error ? " | error: " + String(p.error) : "")
              })()
            }
            if (!pm) return out
            const skinnish = (v) => /skin|macintosh|theme/i.test(String(v))
            return Promise.resolve()
              .then(() => (typeof pm.listPlugins === "function" ? pm.listPlugins() : []))
              .then((rows) => {
                const list = Array.isArray(rows) ? rows : []
                out.entries = _knownSkins().map((s) => {
                  const name = _skinBundleName(s.id)
                  const row = _skinEntryRow(list, name)
                  return name + " -> " + (row
                    ? String(row.entryId) + " | enabled=" + String(row.enabled) +
                      (row.readOnlyReason ? " | READ-ONLY " + row.readOnlyReason : "") +
                      (row.patchId ? " | patch=" + row.patchId : "")
                    : "NO ADDRESSABLE ROW")
                })
                out.plugins = list.filter((r) => r && (skinnish(r.moduleName) || skinnish(r.entryId)))
                  .map((r) => String(r.entryId) + " | " + String(r.moduleName) +
                    " | enabled=" + String(r.enabled) +
                    (r.readOnlyReason ? " | READ-ONLY " + r.readOnlyReason : "") +
                    (r.patchId ? " | patch=" + r.patchId : ""))
                // RAW, UNFILTERED evidence. `plugins` above drops every row whose
                // `moduleName`/`entryId` reads as undefined, so if DSH spells those fields
                // differently on this profile the filter empties the list AND
                // `_skinEntryRow()` finds no row to address — the exact pair of symptoms we
                // have. The entry id is what the plugin manager's own UI hands to
                // `setPluginEnabled()`, so a row naming Dream here IS the accepted id.
                out.pluginRowCount = list.length
                out.pluginRowKeys = list.length ? Object.keys(list[0]).join(",") : "(no rows)"
                out.pluginsRawSample = list.slice(0, 2).map((r) => JSON.stringify(r).slice(0, 400))
                out.rowsMentioningDream = list
                  .filter((r) => JSON.stringify(r).toLowerCase().indexOf("dream") !== -1)
                  .map((r) => JSON.stringify(r).slice(0, 400))
                return typeof pm.listBundles === "function" ? pm.listBundles() : []
              })
              .then((rows) => {
                out.bundles = (Array.isArray(rows) ? rows : []).filter((b) => b && skinnish(b.name))
                  .map((b) => String(b.name) + " | enabled=" + String(b.enabled))
                return out
              }, (e) => { out.error = String((e && e.message) || e); return out })
          }

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

          var _applySkinInFlight = false

          /**
           * Apply a skin selection, enforcing mutual exclusivity.
           *
           * @param {string} targetId  Skin id or 'default'.
           * @param {boolean} bootMode  True when called at boot to reconcile
           *   CSS-skin state.  In boot mode: (1) preferences are NOT re-persisted
           *   (they were just loaded from the host), (2) bundle writes
           *   (_switchSkinBundle) are skipped (the loader already decided which
           *   bundles to load), (3) no page reload is triggered (the running
           *   page already reflects the loader's decisions).  Only the
           *   CSS-level enforcement runs: body attributes and style-tag removal.
           */
          function _applySkin(targetId, bootMode) {
            if (_applySkinInFlight) return
            _applySkinInFlight = true
            try {

            const canonicalId = targetId
            const gen = ++_applySkinGen  // invalidate any in-flight async activations

            // ── Persist selection immediately (skip in boot mode) ──
            // At boot the preference was just loaded from the host; re-persisting
            // is a no-op that costs a host round trip for nothing.
            if (!bootMode) {
              savePrefs(_prefCtx, { activeSkin: canonicalId }, () => {
                try { localStorage.setItem(_skinStorageKey, canonicalId) } catch (_) {}
              })
            }
            if (canonicalId !== 'default') {
              document.body.setAttribute('data-switch-skin', canonicalId)
            } else {
              document.body.removeAttribute('data-switch-skin')
            }

            // ONE list, shared with the dropdown's options() — see _knownSkins().
            // Iterating the scan alone would leave every market-only skin (an
            // installed skin whose bundle is not loaded) un-actionable.
            const skins = _knownSkins()

            // ── Activate the NEW skin first, then deactivate the OLD one ──
            // This avoids the "naked DOM" flash where old styles are removed
            // before new ones are ready.  The brief overlap is harmless:
            // CSS skins use body attributes as activation switches, and only
            // one attribute is set at a time (the new one).

            // Bundle writes are asynchronous and only take effect at boot, so
            // they are collected here and the page reloads once, after all of
            // them settle — and only if one of them changed something.
            const pending = []

            // Handle-less skins VISIBLY in effect right now, read before anything
            // is switched.  Their loader row can already say `disabled` (and the
            // package not even be in the bundle list) while their styles are still
            // in this document, so `_switchSkinBundle()` has nothing to change — and
            // "no call changed anything" does NOT mean "nothing to do": the reload
            // itself is the only switch left.  See _skinLiveMarks.
            const inEffect = Object.keys(_skinLiveMarks).filter((id) => _skinInEffect(id))

            if (canonicalId === 'default') {
              // Going to default: deactivate all skins, no activation needed
              for (const skin of skins) {
                if (skin.managed) {
                  if (!bootMode) _toggleManagedSkin(skin.id, false)
                } else if (_skinNotControllable(skin)) {
                  // Nothing in the DOM to remove: switch the whole plugin off
                  // through DSH's own plugin manager.  NEVER reach for the
                  // market's /toggle here — it edits the install layers.
                  // In boot mode the loader already decided which bundles to
                  // load, so a bundle write here is pointless.
                  if (!bootMode) pending.push(_switchSkinBundle(skin, false))
                } else {
                  _deactivateCssSkin(skin)
                  // ── the DOM removal is not enough: the package must leave the roster ──
                  // Removing the styles takes the skin off THIS page, but
                  // `dsh.profile.bundles` is what the next boot composes from, so leaving
                  // it there brings the skin straight back and `_getActiveSkinId()` keeps
                  // echoing its name over the user's 默认.
                  //
                  // This write used to be gated on `_isMarketLiveTheme(skin.id)`, and that
                  // predicate can NEVER be true here: it opens with
                  // `if (!_marketThemes || ...) return false`, and nothing in this tree ever
                  // assigns `_marketThemes` (the market's loader and activation functions
                  // were replaced by the plugin manager). MEASURED with `claude-style-skin`
                  // active and 默认 pressed: `bundleCalls` stayed empty and the skin came
                  // back on the next load. A dead predicate is not a guard.
                  //
                  // Boot mode still writes nothing — there the loader has already decided
                  // the page's bundles, and that path is covered by `enforceBootSkin()`'s
                  // own sweep.
                  if (!bootMode) {
                    pending.push(_switchSkinBundle(skin, false, { silent: true }))
                  }
                }
              }
            } else {
              // Activate the target skin FIRST
              const target = skins.find((s) => s.id === canonicalId)
              if (target) {
                if (target.managed) {
                  if (!bootMode) _toggleManagedSkin(target.id, true)
                } else if (_skinNotControllable(target)) {
                  // A handle-less theme is a whole plugin, so switching it back on
                  // means enabling the plugin, not re-enabling a style tag.
                  // This write MUST be collected like the 默认 branch's.  Enabling
                  // the entry only changes what the NEXT page load boots, so a
                  // dropped promise is a silent half-switch: the loader turns the
                  // plugin on, this page keeps the old skin, and the theme only
                  // appears after a manual refresh — i.e. "switching to Dream works
                  // once, then nothing until I reload the page".
                  // In boot mode the loader already decided; skip bundle writes.
                  if (!bootMode) pending.push(_switchSkinBundle(target, true))
                } else {
                  // CSS skin — re-enable or re-inject its styles.
                  // ...AND the plugin half: re-injecting in-page is only this page.
                  // `dsh.profile.bundles` is what the next boot composes from, so a CSS
                  // skin brought back by DOM work alone disappears on the next load —
                  // "启用不了，一刷新就没了". Symmetric with the 默认 branch above, which
                  // already writes BOTH halves on the way out; a CSS skin is a whole
                  // plugin in both directions (Critical Rule in the skin section: the
                  // switch has three call sites and every one needs both halves).
                  if (!bootMode) pending.push(_switchSkinBundle(target, true))
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
                  if (!bootMode) _toggleManagedSkin(skin.id, false)
                } else if (_skinNotControllable(skin)) {
                  // A handle-less theme has to be switched off as a plugin: the
                  // DOM removal would be a silent no-op.
                  // In boot mode the loader state is already determined.
                  if (!bootMode) pending.push(_switchSkinBundle(skin, false))
                } else {
                  _deactivateCssSkin(skin)
                  // Same as the 默认 branch: a controllable skin the market still
                  // records as `live` is switched off through the loader too, so
                  // its row (and the market's cache) read `disabled` and the
                  // next boot stays on the target the user just picked.
                  if (!bootMode && _isMarketLiveTheme(skin.id)) {
                    pending.push(_switchSkinBundle(skin, false, { silent: true }))
                  }
                }
              }
            }

            // The market's cached `live` row is now stale: _applySkin() only ever
            // leaves NO market theme live (the target is `default`, or a
            // plugin-local CSS skin the market does not govern).  Invalidate it so
            // _getActiveSkinId() immediately falls back to the stored preference
            // instead of echoing — and actively re-saving — the just-deactivated
            // theme's name.  This is the instant-feedback half of the switch; the
            // loader writes above are the persistence half, and the reload below
            // is what hands one to the next boot.
            _invalidateMarketThemes()

            // Only a reload makes a loader write visible, so name the reason here:
            // the trace then shows "wrote: true" with (or without) a reload.
            // In boot mode: skip the reload entirely.  The running page already
            // reflects the loader's bundle decisions, and a boot-time reload
            // would either be a no-op or an infinite loop.
            if (!bootMode) {
              _skinReloadWhy = 'applySkin:' + canonicalId
              if (pending.length > 0 || inEffect.length > 0) {
                Promise.all(pending).then((changed) => {
                  if (changed.some(Boolean) || inEffect.length > 0) {
                    // A bundle is composed at boot, so the switch only becomes
                    // visible after a reload — the same hand-off theme activation
                    // uses.  Only when something actually changed: pressing 默认 on a
                    // page that is already default must not reload anything.
                    // `inEffect` is the case that proves the rule: when a handle-less
                    // skin is still on screen although its row already reads
                    // `disabled`, no write can change anything and the reload is the
                    // switch itself.
                    _fadeBeforeReload()
                  }
                })
              }
            }

            // Also remove any leftover data-dsh-font attribute
            document.body.removeAttribute('data-dsh-font')

            } finally {  // _applySkinInFlight guard
              _applySkinInFlight = false
            }
          }

          ctx.effect(() => {
            // Register the skin switch unconditionally — the plugin manager
            // (not the market) provides disabled-skin discovery.
            _registerSkinSwitch()
            // Fetch the current plugin state for the dropdown.
            _refreshPluginEntries()
            return () => { _unregisterSkinSwitch() }
          }, 'dock-flash: skin switch')

          // Language selector — controls global DSH UI language.
          //   In the APPEARANCE group, not System: this row is the one place in
          //   this panel that speaks to what the UI looks like as text, and it
          //   sits beside the theme dropdown it pairs with in every user's head
          //   ("light or dark" / "Chinese or English"). System is left to the
          //   controls that act on process health — the alert cluster.
          //   `order` 15 keeps it immediately above the
          //   theme row (20), so the panel reads: language, then skin/theme,
          //   then the toggles.
          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:language',
              label: L('language'),
              icon: 'globe',
              type: 'buttongroup',
              group: 'appearance',
              order: 15,
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

          // Fullscreen toggle — uses the browser Fullscreen API
          ctx.effect(() => {
            const dispose = registry.registerSwitch({
              id: 'dock-flash:fullscreen',
              label: L('fullscreen'),
              icon: 'expand',
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
                // menu button in the session header; earlier builds rendered a dedicated
                // "Session log" capsule instead.  The class was renamed over time
                // (sessionLogButton -> moreButton) AND carries a CSS-module build HASH
                // that changes on any DSH rebuild: `nL4_yW_` held from 0.0.1-rc.5
                // through 0.1.7-rc.2 and became `_4Nnt6q_` by 0.2.0-rc.2, which killed
                // this switch silently — the injected rule matched nothing while the
                // toggle kept flipping and persisting its state.
                //   Match the stable SUFFIX, never the hash: `[class*="…"]` is a strict
                // SUPERSET of the literal selectors it replaces, so every DSH build in
                // which this switch ever worked still matches.
                tag.textContent = '[class*="_moreButton"], [class*="_sessionLogButton"] { display: none !important; }'
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
              icon: 'more',
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
              icon: 'bell',
              type: 'toggle',
              group: 'system',
              cluster: 'system-alerts',
              order: 57,
              getValue: () => _getAlertsOn(),
              setValue: (v) => {
                _setAlertsOn(v)
                if (v) {
                  alertRegistry.start()
                  _initAlertDisplayModes(alertRegistry)
                } else {
                  _destroyAlertDisplayModes()
                  alertRegistry.stop()
                  // Clear all alert data: dismissed set, host provider
                  // accumulated alerts, localStorage keys, and the
                  // host-side alert queue — nothing should linger.
                  alertRegistry.clearAlertData()
                  try {
                    fetch('/plugins/dock-flash/clear-alerts', { method: 'POST' }).catch(function () {})
                  } catch (_) {}
                }
                // Notify the panel so the switch re-renders
                registry.notifyChange('dock-flash:system-alerts')
                // Notify all switches whose visible() depends on _getAlertsOn(),
                // so they appear/disappear immediately instead of waiting for the
                // next unrelated render.  Includes both dock-flash-owned switches
                // and companion toggles (dsh-flash-ctx-mon, dsh-flash-net-mon,
                // dsh-flash-mem-mon).
                const _alertsDependentIds = [
                  'dock-flash:alert-toast',
                  'dsh-flash-ctx-mon:monitor-context',
                  'dsh-flash-mem-mon:monitor-memory',
                  'dsh-flash-net-mon:monitor-network',
                  'dock-flash:host-alert-queue-cap',
                  'dock-flash:host-alert-max-age',
                ]
                _alertsDependentIds.forEach(function (sid) {
                  try { registry.notifyChange(sid) } catch (_) {}
                })
              },
            })
            return dispose
          }, 'dock-flash: system-alerts switch')

          // Auto-start alert registry if the toggle is ON (default)
          if (_getAlertsOn()) {
            alertRegistry.start()
          }

          // ── Alert display-mode toggles ───────────────────────────────
          //    An independent toggle controlling how alerts are shown: Toast.
          //    Default: Toast ON. Dropdown is always on.
          //
          //    NOTE: the Toast switch is NOT gated on the dock-panel mode any
          //    more. It used to be (`&& !_inDockPanel`), on the theory that the
          //    display modes only matter around the standalone ⚡ — but the Toast
          //    mounts on `document.body` and keeps running in BOTH modes, so
          //    hiding the switch there left the user with a popup they could not
          //    turn off. Only the Dropdown is dock-mode-inert (dock-base's own
          //    render has no badge to drop it from), and it has no switch.
          const _alertDisplayModes = [
            { mode: 'toast', labelKey: 'alertToast', icon: 'bell', order: 61 },
          ]
          _alertDisplayModes.forEach(({ mode, labelKey, icon, order }) => {
            ctx.effect(() => {
              const dispose = registry.registerSwitch({
                id: 'dock-flash:alert-' + mode,
                label: L(labelKey),
                icon: icon,
                type: 'toggle',
                group: 'system',
                cluster: 'system-alerts',
                order: order,
                // Shown in BOTH modes: the Toast runs in both, so its switch
                // must be reachable in both. See the note above this list.
                visible: () => _getAlertsOn(),
                getValue: () => _getAlertDisplayMode(mode),
                setValue: (v) => {
                  _setAlertDisplayMode(mode, v)
                  if (v) {
                    _startAlertDisplayMode(mode)
                  } else {
                    _stopAlertDisplayMode(mode)
                  }
                  registry.notifyChange('dock-flash:alert-' + mode)
                },
              })
              return dispose
            }, 'dock-flash: alert-' + mode + ' switch')
          })

          // ── Per-monitor threshold/polling sliders live in each monitor's own
          //    config popup, owned by its companion plugin (dsh-flash-ctx-mon /
          //    -mem-mon / -net-mon).  dock-flash no longer owns a monitor
          //    config modal; the host-side _alertPref / _writeAlertPref helpers
          //    below remain for the host alert sliders.

          // ── Host alert sliders (direct members of system-alerts cluster) ─
          //    These control the host-side alert queue behaviour and sit at
          //    the same level as the system-alerts toggle and display-mode
          //    switches, not inside a sub-cluster.
          ctx.effect(() => {
            var _pendingQueueCap = null  // old value while an async write is pending
            var _capTimer = null        // debounce timer to avoid thrashing notifyChange
            var debounceNotify = function () {
              clearTimeout(_capTimer)
              _capTimer = setTimeout(function () {
                _capTimer = null
                registry.notifyChange('dock-flash:host-alert-queue-cap')
              }, 150)
            }
            const dispose = registry.registerSwitch({
              id: 'dock-flash:host-alert-queue-cap',
              label: L('hostAlertQueueCap'),
              icon: 'queue',
              type: 'number',
              group: 'system',
              cluster: 'system-alerts',
              order: 80,
              min: 10, max: 200, step: 1,
              hint: '10–200',
              tooltip: L('hostAlertQueueCapDesc'),
              visible: () => _getAlertsOn(),
              getValue: () => _alertPref('hostAlertQueueCap'),
              setValue: (v) => {
                var oldVal = _alertPref('hostAlertQueueCap')
                _writeAlertPref(_prefCtx, 'hostAlertQueueCap', v, function (patch, rollback) {
                  // Called on failure — restore the old value and re-render.
                  if (_hostPrefs) _hostPrefs.hostAlertQueueCap = oldVal
                  rollback()
                  registry.notifyChange('dock-flash:host-alert-queue-cap')
                })
                debounceNotify()
              },
            })
            return dispose
          }, 'dock-flash: host-alert-queue-cap number')

          ctx.effect(() => {
            var _pendingMaxAge = null
            var _ageTimer = null
            var debounceNotify = function () {
              clearTimeout(_ageTimer)
              _ageTimer = setTimeout(function () {
                _ageTimer = null
                registry.notifyChange('dock-flash:host-alert-max-age')
              }, 150)
            }
            const dispose = registry.registerSwitch({
              id: 'dock-flash:host-alert-max-age',
              label: L('hostAlertMaxAge'),
              icon: 'clock',
              type: 'number',
              group: 'system',
              cluster: 'system-alerts',
              order: 81,
              min: 1, max: 168, step: 1,
              hint: '1–168h',
              tooltip: L('hostAlertMaxAgeDesc'),
              visible: () => _getAlertsOn(),
              getValue: () => _alertPref('hostAlertMaxAge'),
              setValue: (v) => {
                var oldVal = _alertPref('hostAlertMaxAge')
                _writeAlertPref(_prefCtx, 'hostAlertMaxAge', v, function (patch, rollback) {
                  if (_hostPrefs) _hostPrefs.hostAlertMaxAge = oldVal
                  rollback()
                  registry.notifyChange('dock-flash:host-alert-max-age')
                })
                debounceNotify()
              },
            })
            return dispose
          }, 'dock-flash: host-alert-max-age number')

          // ── Missing companion plugins ─────────────────────────────────────
          // Since 2.0.0 the monitors and the proxy controls are separate packages, and
          // upgrading does NOT bring them along: the panel simply has no such rows, and
          // nothing said so. This names what is absent and hands over the one command.
          //
          // READ-ONLY by design — it installs nothing, writes no profile, and makes no
          // request beyond DSH's own host route. A switch that could install a package is a
          // supply-chain-shaped feature; DSH's own Plugins page is the install surface, and
          // this only points at it.
          //
          // A companion counts as present when a switch with its prefix is REGISTERED — not
          // when its package appears in the profile. "installed but off" and "failed during
          // apply()" are different problems from "not installed", and they get different
          // words. See `_companionRunning` and `_fetchCompanionProfile`.
          var _companionReport = { missing: [], idle: [], unknown: [], at: 0 }
          /** Transient action label after a copy press; cleared by a timer. */
          var _companionCopyState = ''

          function _companionStatus() {
            var qc = ctx.get && ctx.get('quickControl')
            var profile = _companionProfile
            var known = !!(profile && Array.isArray(profile.installed))
            var rows = { missing: [], idle: [], unknown: [] }
            _COMPANIONS.forEach(function (c) {
              var running = _companionRunning(qc, c.prefix)
              if (running === true) return
              var row = { pkg: c.pkg, label: t(c.label) }
              if (running === null || !known) rows.unknown.push(row)
              else if (profile.installed.indexOf(c.pkg) !== -1) rows.idle.push(row)
              else rows.missing.push(row)
            })
            return rows
          }

          /** The profile NAME the CLI wants, from the route's resolved directory
           *  (`…/profiles/web` → `web`). Null when either is unknown. */
          function _companionProfileName() {
            var dir = _companionProfile && _companionProfile.dir
            if (!dir || typeof dir !== 'string') return null
            var parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/)
            return parts[parts.length - 1] || null
          }

          /** The install command for the genuinely missing ones, or '' when there is
           *  nothing to install — or when it must not be printed. `desktop` is a RESERVED
           *  profile that a normal `dsh` refuses ("managed exclusively by the Electron
           *  application"), so that case gets the Plugins-page wording instead. */
          function _companionInstallCommand() {
            var pkgs = _companionReport.missing.map(function (r) { return r.pkg })
            if (pkgs.length === 0) return ''
            var name = _companionProfileName()
            if (name === 'desktop') return ''
            return 'dsh plugin --profile ' + (name || '<profile>') + ' add ' + pkgs.join(' ')
          }

          function _companionLines() {
            var rows = _companionStatus()
            _companionReport = {
              missing: rows.missing, idle: rows.idle, unknown: rows.unknown, at: Date.now(),
            }
            var out = []
            var push = function (list, stateKey) {
              list.forEach(function (r) {
                out.push(r.pkg + '  ' + r.label + ' — ' + t(stateKey))
              })
            }
            push(rows.missing, 'companionsStateMissing')
            push(rows.idle, 'companionsStateIdle')
            push(rows.unknown, 'companionsStateUnknown')
            if (rows.missing.length > 0) {
              out.push('')
              var cmd = _companionInstallCommand()
              if (cmd) {
                out.push(t('companionsInstallHint'))
                out.push(cmd)
              } else {
                out.push(t('companionsDesktopHint'))
              }
            }
            if (rows.idle.length > 0) out.push(t('companionsIdleHint'))
            if (rows.unknown.length > 0) out.push(t('companionsUnknownHint'))
            return out
          }

          function _companionsPending() {
            var r = _companionReport
            return (r.missing.length + r.idle.length + r.unknown.length) > 0
          }

          ctx.effect(function () {
            var dispose = registry.registerSwitch({
              id: 'dock-flash:companions-missing',
              label: L('companionsMissingLabel'),
              icon: 'message',
              type: 'log',
              group: 'system',
              order: 90,
              hideWhenEmpty: true,
              // The ✕ is "stop telling me", not "clear the lines": this block is not a log, it is
              // a nag, and a user who has decided not to install the monitors is entitled to make
              // it stop. It routes to the SAME hidden-set state the ◉ mode writes (see
              // `_dismissCompanionHint`), so the tooltip can honestly name the way back.
              onClear: function () { _dismissCompanionHint(registry) },
              clearTitle: L('companionsDontShow'),
              // Recomputed on every render, so it is right once every plugin has applied —
              // and it disappears by itself the moment the last companion registers.
              getLines: _companionLines,
              getMeta: function () {
                var r = _companionReport
                var n = r.missing.length + r.idle.length + r.unknown.length
                return n > 0 ? t('companionsMeta').replace('{n}', String(n)) : ''
              },
            })
            // The profile list is a second, asynchronous fact: until it lands, a companion
            // is reported as UNKNOWN rather than as missing, and this is what re-renders
            // the panel when it does.
            _fetchCompanionProfile().then(function () {
              try { registry.notifyChange('dock-flash:companions-missing') } catch (_) {}
            })
            return dispose
          }, 'dock-flash: companions-missing log')

          ctx.effect(function () {
            var dispose = registry.registerSwitch({
              id: 'dock-flash:companions-copy',
              label: L('companionsCopyAction'),
              icon: 'doc',
              type: 'action',
              group: 'system',
              order: 91,
              hideLabel: true,
              visible: function () {
                return _companionsPending() && !!_companionInstallCommand()
              },
              actionLabel: function () {
                return _companionCopyState || t('companionsCopyAction')
              },
              run: function () {
                var cmd = _companionInstallCommand()
                if (!cmd) return
                var ok = function () {
                  _companionCopyState = t('companionsCopied')
                  try { registry.notifyChange('dock-flash:companions-copy') } catch (_) {}
                  setTimeout(function () {
                    _companionCopyState = ''
                    try { registry.notifyChange('dock-flash:companions-copy') } catch (_) {}
                  }, 2000)
                }
                try {
                  navigator.clipboard.writeText(cmd).then(ok, function () {
                    _companionCopyState = t('companionsCopyFailed')
                    try { registry.notifyChange('dock-flash:companions-copy') } catch (_) {}
                  })
                } catch (_) {
                  _companionCopyState = t('companionsCopyFailed')
                  try { registry.notifyChange('dock-flash:companions-copy') } catch (_) {}
                }
              },
            })
            return dispose
          }, 'dock-flash: companions-copy action')

          // ── Adopt handler for alert threshold preferences ──────────────
          //    Per the two-ordering trap (AGENTS.md Critical Rule):
          //    subscribe covers a host that answers LATE; calling once
          //    covers a host that answered EARLY.  When _hostPrefs
          //    refreshes, each slider's getValue() reads _alertPref()
          //    which reads from _hostPrefs, so a notifyChange forces
          //    the panel to re-render with the new values.  (Per-monitor
          //    sliders now live in the companion plugins' config popups; this
          //    list covers only the host-alert queue sliders that remain in
          //    the panel.)
          var _alertSliderIds = [
            'dock-flash:host-alert-queue-cap', 'dock-flash:host-alert-max-age',
          ]
          function adoptHostAlertPrefs() {
            if (!_hostPrefs) return
            _alertSliderIds.forEach(function (id) {
              try { registry.notifyChange(id) } catch (_) {}
            })
          }
          _subscribePrefs(adoptHostAlertPrefs)
          adoptHostAlertPrefs()

          // Initialize alert display modes (starts each enabled mode)
          // Only if system alerts are turned ON; when OFF the modes are stopped
          // and should not be started until the user re-enables alerts.
          if (_getAlertsOn()) {
            _initAlertDisplayModes(alertRegistry)
          }

          // Clean up alert providers on context teardown
          ctx.on('dispose', () => {
            _destroyAlertDisplayModes()
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
          /** Disposer for the workbench header's compact-toggle pref subscription. */
          let _compactHeaderDispose = null

          // ── 3. Register a sidebar panel (renders QuickControlPanel in the sidebar) ──
          //    Wrapped in PanelErrorBoundary to prevent render errors from
          //    crashing the entire dock-base WorkbenchRoot (which has no
          //    error boundary of its own).
          const SafeQuickControlPanel = (props) =>
            h(PanelErrorBoundary, null, h(QuickControlPanel, props))

          // ── Workbench registrations (panel, activity bar, editor view, command) ──
          //    Only available when dock-base is installed.
          const mountWorkbench = (wb) => {
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
                    // The compact-mode toggle, FIRST so it sits beside the title it acts on. This
                    // header is dock-base's, so this button is the only way the DOCKED panel can
                    // enter compact mode — and it drives its own preference (`docked: true`), so
                    // turning it on here never restyles the floating panel and vice versa.
                    h('button', {
                      type: 'button',
                      ref: (el) => {
                        if (_compactHeaderDispose) { _compactHeaderDispose(); _compactHeaderDispose = null }
                        if (el) {
                          _paintCompactToggle(el, true)
                          _compactHeaderDispose = _subscribePrefs(() => _paintCompactToggle(el, true))
                        }
                      },
                      style: { ...S.panelCloseBtn, fontSize: '14px', display: 'inline-flex', alignItems: 'center' },
                      onClick: (e) => {
                        _setCompactPanel(!_compactPanelDocked(), true)
                        _paintCompactToggle(e.currentTarget, true)
                      },
                      onMouseEnter: (e) => { e.currentTarget.style.opacity = '1' },
                      onMouseLeave: (e) => _paintCompactToggle(e.currentTarget, true),
                      dangerouslySetInnerHTML: { __html: COMPACT_ICON_SVG },
                    }),
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

            // ── Dock-hidden → independent fallback ───────────────────────
            // dock-base's own settings let a user hide a plugin (the Flash
            // entry/activity-bar item; persisted as `dock-base:hidden-plugins`
            // and read through `getHiddenPluginIds()`). Hiding dock-flash would
            // otherwise leave NO entry point to the quick control panel while
            // dock-base is installed — this plugin would simply vanish.
            //
            // Instead, when the dock reports dock-flash as hidden we *detach*:
            // we mount the very same standalone machinery the no-dock-base path
            // uses (the floating ⚡ trigger + standalone panel, with its Layout
            // switches), and when the user restores the plugin in the dock we
            // *re-attach* by tearing that mount down — a clean, reload-free
            // workbench ↔ standalone cycle. The workbench entries themselves
            // stay registered; the dock suppresses their UI while hidden, and
            // the standalone ⚡ takes over as the single entry point.
            //
            // Re-entrancy is what makes toggling safe: unlike the one-shot
            // no-dock-base path, `mountStandaloneSlotTrigger` here can be
            // disposed and remounted on this same ctx because its returned
            // cleanup now disposes the slots watcher fiber (see that function).
            let _dockHiddenStandaloneDispose = null
            // Close any dock-flash workbench instances before the standalone
            // panel takes over, so detaching never leaves two panels for one
            // plugin on screen. Runs from the settings-changed handler — not
            // from OUR render path — so it cannot trip Critical Rule 1.
            const _closeDockFlashWorkbenchViews = () => {
              try {
                const layout = wb.getLayout()
                const ours = (e) => e && e.viewId === 'dock-flash:quick-control'
                ;(layout.floatingWindows || Object.create(null)).forEach ? null : null
              } catch (_) {}
              try {
                const layout = wb.getLayout()
                const floats = layout.floatingWindows || {}
                for (const instanceId of Object.keys(floats)) {
                  if (floats[instanceId].viewId === 'dock-flash:quick-control') {
                    try { wb.closeViewInstance(instanceId) } catch (_) {}
                  }
                }
                ;(layout.editorTabs || []).slice().forEach((tab) => {
                  if (tab.viewId === 'dock-flash:quick-control') {
                    try { wb.closeViewInstance(tab.instanceId) } catch (_) {}
                  }
                })
              } catch (_) {}
            }
            const _syncDockHiddenStandalone = () => {
              let hidden = false
              try { hidden = wb.getHiddenPluginIds().includes('dock-flash') } catch (_) {}
              if (hidden && !_dockHiddenStandaloneDispose) {
                console.log('[dock-flash] dock-hidden — detaching into standalone mode')
                _closeDockFlashWorkbenchViews()
                _dockHiddenStandaloneDispose = mountStandaloneSlotTrigger(ctx, registry)
              } else if (!hidden && _dockHiddenStandaloneDispose) {
                console.log('[dock-flash] dock-visible — restoring workbench mode')
                try { _dockHiddenStandaloneDispose() } catch (_) {}
                _dockHiddenStandaloneDispose = null
              }
            }
            // Apply immediately: a page that boots with dock-flash already
            // hidden must show the floating ⚡ without waiting for a toggle.
            _syncDockHiddenStandalone()
            // Follow the live setting. `onDidChangeSetting` fires for every
            // persisted dock setting, including the hidden-plugins list, so
            // toggling in the dock detaches/reattaches live. It is a store
            // event, not OUR render path, so it never trips Critical Rule 1.
            ctx.effect(() => wb.onDidChangeSetting(_syncDockHiddenStandalone),
              'dock-flash: dock-hidden ↔ standalone sync')
          }

          const mountStandalone = () => {
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

          // ── Choose workbench vs standalone ─────────────────────────────
          // The mode is NOT decided by reading `wb` once. dock-base may be
          // installed but its `workbench` service not registered yet when
          // apply() runs — the load order is not guaranteed to have dock-base
          // ahead, and a single `ctx.get('workbench')` returning undefined used
          // to lock dock-flash into standalone permanently even with dock-base
          // on the page. Resolve it the same way mountStandaloneSlotTrigger
          // resolves `slots` (L8435 — the comment that names this pattern):
          //   - service available now        → workbench branch immediately;
          //   - dock-base installed (boot manifest / module graph) but not
          //     ready yet                    → ctx.inject(['workbench'], …)
          //     subscribes for the service and mounts the branch when it lands;
          //   - dock-base confirmed absent   → standalone branch.
          // The absence path carries no hard inject dependency (dsh.client.inject
          // stays a load-order hint), so the no-dock-base contract is unchanged:
          // apply() still runs and the floating ⚡ still works.
          const wbNow = ctx.get ? ctx.get('workbench') : undefined
          if (wbNow) {
            mountWorkbench(wbNow)
          } else if (_dockBaseInstalled()) {
            console.log('[dock-flash] dock-base installed — waiting for workbench service')
            ctx.inject(['workbench'], (scope) => {
              mountWorkbench(scope.workbench)
            })
          } else {
            mountStandalone()
          }
        } catch (e) {
          console.error('[dock-flash] apply failed:', e)
        }
      },
    }
//#endregion ───────────────────────────────────────────────────────────────────
  },
})
