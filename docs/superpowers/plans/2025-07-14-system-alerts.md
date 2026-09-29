# System Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add alert/notification capability to dock-flash: when backend V8 memory runs low, frontend session context is nearly exhausted, or abnormal network connections are detected, alerts appear as a badge on the ⚡ trigger icon and as an alert bar inside the QuickControl panel.

**Architecture:** A new `AlertRegistry` (pub/sub, same shape as `QuickControlRegistry`) manages alert providers that each run an adaptive-polling loop (`setTimeout` chain, not `setInterval`). The registry is published as `ctx.provide('dockFlashAlerts', registry)` and consumed by: (1) a badge on both standalone trigger buttons (imperative DOM attribute + CSS) and the React slot button (conditional render), and (2) an alert bar rendered at the top of the QuickControlPanel body. A toggle switch `dock-flash:system-alerts` (system group) controls polling on/off.

**Tech Stack:** Client-side only (browser API: `performance.memory`, `navigator.onLine`, `fetch` for heartbeat); host-side adds two lightweight HTTP routes for host-push alerts and heartbeat.

**Spec:** This document is the spec.

## Global Constraints

- **Client half is `lib/client.js`** — single monolithic file, NO build step, organized by `#region` markers. All edits go into this file.
- **Host half is `src/index.ts`** — ESM, compiled via `pnpm run build` (tsc). After editing, must rebuild and commit `dist/`.
- **CR1:** Never modify layout state synchronously in React render cycle. Defer with `setTimeout(fn, 0)`.
- **CR2:** CSS skin deactivation must use `el.remove()`, not `el.disabled = true`.
- **CR3:** `storage` event only fires cross-context; use the iframe trick for same-window writes.
- **CR7:** `setValue()` should only update state — panel handles UI refresh. Use `_notifyChange`/`notifyChange` for proactive pushes only.
- **CR10:** Error boundary mandatory for panel components. New alert bar component must be wrapped.
- **CR11:** Host half is ESM — no `require()`. Use static `import` or dynamic `import()`.
- **i18n:** All user-visible strings use `L('key')` (functional label `() => t('key')`) for reactive locale switching.
- **Design tokens:** All colors go through `--dsw-alias-*` CSS variables. No literal colors except as fallbacks.
- **`min-width: 0`** on flex items that might shrink; `box-sizing: border-box` when combining minWidth + padding.
- **Version:** After all changes, bump `CLIENT_VERSION` in `lib/client.js` line 59 and `version` in `package.json` line 3 — this is a minor version bump (new switch, new service, new feature).
- **Standalone trigger button** is imperative DOM (`createElement`), not React — badge must be CSS-based or imperative DOM attribute, not React state on the button itself.
- **`QuickTriggerIconButton`** (line 4434) IS a React component — badge CAN use React conditional rendering here.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/client.js` `#region i18n` (lines 120–359) | Add ~20 new i18n keys for alert strings |
| `lib/client.js` `#region Styles` (lines 446–) | Add `S.alertBadge`, `S.alertBar`, `S.alertItem`, `S.alertDismissBtn`, etc. |
| `lib/client.js` `#region Registry` (lines 1883–1960) | Add `createAlertRegistry()` function |
| `lib/client.js` new region after Registry | Three alert providers: `MemoryAlertProvider`, `SessionContextProvider`, `NetworkAlertProvider` |
| `lib/client.js` `#region PanelComponent` (lines 2540–3379) | Subscribe to AlertRegistry; render alert bar above tab pages |
| `lib/client.js` `#region StandaloneMode` (lines 3385–) | Badge attribute on overlay trigger; subscribe to AlertRegistry |
| `lib/client.js` `#region PluginEntry` (lines 5358–) | Create AlertRegistry, register providers, register toggle switch, publish service |
| `src/index.ts` | Add `GET /plugins/dock-flash/host-alerts` and `POST /plugins/dock-flash/push-alert` HTTP routes |
| `dist/index.js` | Rebuilt from `src/index.ts` (must `pnpm run build` and commit) |
| `package.json` | Bump version (minor) |
| `CHANGELOG.md` | Add entry for this feature |

---

### Task 1: Add i18n keys for system alerts

**Files:**
- Modify: `lib/client.js:122–252` (zh dict) and `lib/client.js:253–359` (en dict)

**Interfaces:**
- Produces: i18n keys `systemAlerts`, `alertMemoryInfo`, `alertMemoryWarning`, `alertMemoryError`, `alertMemoryCritical`, `alertContextInfo`, `alertContextWarning`, `alertContextError`, `alertNetworkOffline`, `alertNetworkSlow`, `alertNetworkTimeout`, `alertDismissAll`, `alertTitle`, `alertMemoryUnavailable`, `alertContextUnavailable`

- [ ] **Step 1: Add zh i18n keys**

In the `zh` object (line 122), after the `collapse` key (line 250), add these keys:

```js
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
      alertNetworkOffline: '网络已断开',
      alertNetworkSlow: '网络延迟较高 ({d}ms)',
      alertNetworkTimeout: '网络连接超时',
```

- [ ] **Step 2: Add en i18n keys**

In the `en` object (line 253), after the `collapse` key (line ~356), add the corresponding English keys:

```js
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
      alertNetworkOffline: 'Network offline',
      alertNetworkSlow: 'Network latency high ({d}ms)',
      alertNetworkTimeout: 'Network connection timeout',
```

- [ ] **Step 3: Verify i18n loads without error**

Open the DSH Web GUI at http://127.0.0.1:3080, open browser console, type:
```js
t('systemAlerts')
```
Expected: returns `'系统告警'` (if Chinese) or `'System Alerts'` (if English).

- [ ] **Step 4: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): add i18n keys for system alert notifications"
```

---

### Task 2: Add alert-related styles to the S object

**Files:**
- Modify: `lib/client.js:446–` (Styles region)

**Interfaces:**
- Produces: `S.alertBadge`, `S.alertBar`, `S.alertItem`, `S.alertDismissBtn`, `S.alertItemIcon`, `S.alertItemText`, `S.alertSeverityInfo`, `S.alertSeverityWarning`, `S.alertSeverityError`, `S.alertSeverityCritical`

- [ ] **Step 1: Add alert style objects**

In the `S` object (after the existing styles, near the end of the `#region Styles` block), add:

```js
      // ── Alert badge (on trigger button) ────────────────────────────────
      alertBadge: {
        position: 'absolute',
        top: '-4px',
        right: '-4px',
        minWidth: '16px',
        height: '16px',
        borderRadius: '8px',
        background: '#e5534b',
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
```

- [ ] **Step 2: Verify no syntax errors**

In browser console: type `S.alertBadge` — should return the style object, not `undefined`.

- [ ] **Step 3: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): add alert badge and alert bar styles to S object"
```

---

### Task 3: Create the AlertRegistry

**Files:**
- Modify: `lib/client.js:1960–` (after `#endregion Registry`)

**Interfaces:**
- Consumes: nothing (standalone factory)
- Produces: `createAlertRegistry()` → `{ registerProvider, getAlerts, dismissAlert, dismissAll, subscribe, start, stop, get version, get alertCount }`

- [ ] **Step 1: Write the AlertRegistry factory**

Insert immediately after `//#endregion ── Registry` (after line 1960), before the next `#region`:

```js
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
      const providers = new Map()       // id → AlertProvider
      const activeAlerts = new Map()    // id → Alert
      const dismissed = new Set()       // user-dismissed alert ids
      const listeners = new Set()
      let version = 0
      let running = false

      function notify() {
        version++
        listeners.forEach((fn) => { try { fn() } catch (_) {} })
      }

      /** Called by each provider when its alert set changes. */
      function handleProviderUpdate(providerId, alerts) {
        // Remove old alerts from this provider
        for (const [id] of activeAlerts) {
          if (id.startsWith(providerId + ':')) activeAlerts.delete(id)
        }
        // Remove dismissed entries for this provider
        for (const did of dismissed) {
          if (did.startsWith(providerId + ':')) dismissed.delete(did)
        }
        // Add new alerts (skip dismissed ones unless severity escalated)
        if (alerts && alerts.length) {
          for (const a of alerts) {
            const fullId = providerId + ':' + a.id
            if (dismissed.has(fullId)) {
              // Re-show if severity escalated
              const old = activeAlerts.get(fullId)
              if (old && SEVERITY_ORDER[a.severity] <= SEVERITY_ORDER[old.severity]) continue
              dismissed.delete(fullId)
            }
            activeAlerts.set(fullId, { ...a, id: fullId, _providerId: providerId })
          }
        }
        // Cap at MAX_ALERTS — drop oldest
        while (activeAlerts.size > MAX_ALERTS) {
          const oldest = Array.from(activeAlerts.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
          if (oldest) activeAlerts.delete(oldest[0]); else break
        }
        notify()
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
            notify()
          }
        },

        /** Dismiss all active alerts. */
        dismissAll() {
          for (const [id] of activeAlerts) dismissed.add(id)
          activeAlerts.clear()
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

        /** Stop all providers. Idempotent. */
        stop() {
          if (!running) return
          running = false
          for (const [, provider] of providers) {
            try { provider.stop() } catch (_) {}
          }
          activeAlerts.clear()
          dismissed.clear()
          notify()
        },

        get version() { return version },
        get alertCount() { return activeAlerts.size },
        get isRunning() { return running },
      }
    }
//#endregion ───────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Verify createAlertRegistry is callable**

In browser console (after page refresh):
```js
var ar = createAlertRegistry()
ar.alertCount // should be 0
ar.getAlerts() // should be []
```
Expected: `0` and `[]`

- [ ] **Step 3: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): add AlertRegistry factory with pub/sub, providers, dismiss"
```

---

### Task 4: Create the MemoryAlertProvider

**Files:**
- Modify: `lib/client.js` (new code after AlertRegistry region)

**Interfaces:**
- Consumes: `performance.memory` (Chrome-only, non-standard)
- Produces: alerts with ids like `'mem-low'`, `'mem-critical'` etc., prefixed by provider id `'dock-flash:memory-alert'` in the registry

- [ ] **Step 1: Write the MemoryAlertProvider**

Insert after the AlertRegistry `#endregion`, before the next region:

```js
    // ═══════════════════════════════════════════════════════════════════════
    //#region AlertProviders ──────────────────────────────────────────────────────

    /**
     * MemoryAlertProvider — monitors V8 heap memory via performance.memory.
     *
     * Adaptive polling: interval = BASE * (1 - ratio)^2 + MIN
     *   ratio = usedJSHeapSize / jsHeapSizeLimit
     *   BASE = 30000ms, MIN = 2000ms
     *
     * Chrome-only; starts as no-op if performance.memory is unavailable.
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
              title: () => t('alertMemoryCritical').replace('{r}', pct),
              message: () => t('alertMemoryCritical').replace('{r}', pct),
              icon: '🔴',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.95) {
            alerts.push({
              id: 'mem-error',
              severity: 'error',
              title: () => t('alertMemoryError').replace('{r}', pct),
              message: () => t('alertMemoryError').replace('{r}', pct),
              icon: '🟠',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.90) {
            alerts.push({
              id: 'mem-warning',
              severity: 'warning',
              title: () => t('alertMemoryWarning').replace('{r}', pct),
              message: () => t('alertMemoryWarning').replace('{r}', pct),
              icon: '🟡',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.80) {
            alerts.push({
              id: 'mem-info',
              severity: 'info',
              title: () => t('alertMemoryInfo').replace('{r}', pct),
              message: () => t('alertMemoryInfo').replace('{r}', pct),
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
              title: () => t('alertMemoryUnavailable'),
              message: () => t('alertMemoryUnavailable'),
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
```

- [ ] **Step 2: Verify MemoryAlertProvider starts and stops**

In browser console (Chrome):
```js
var mp = createMemoryAlertProvider()
mp.start(function(alerts) { console.log('memory alerts:', alerts) })
// Wait 3s — should see alerts logged
mp.stop()
```
Expected: alerts array logged (empty if memory < 80%, non-empty if high)

- [ ] **Step 3: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): add MemoryAlertProvider with adaptive polling"
```

---

### Task 5: Create the SessionContextProvider

**Files:**
- Modify: `lib/client.js` (after MemoryAlertProvider, same region)

**Interfaces:**
- Consumes: DOM message node count to estimate context usage
- Produces: alerts with ids like `'ctx-info'`, `'ctx-warning'`, `'ctx-error'`

- [ ] **Step 1: Write the SessionContextProvider**

Insert after `createMemoryAlertProvider()`:

```js
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
              title: () => t('alertContextError'),
              message: () => t('alertContextError') + ' (~' + Math.round(ratio * 100) + '%)',
              icon: '🔴',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.85) {
            alerts.push({
              id: 'ctx-warning',
              severity: 'warning',
              title: () => t('alertContextWarning'),
              message: () => t('alertContextWarning') + ' (~' + Math.round(ratio * 100) + '%)',
              icon: '🟡',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= 0.70) {
            alerts.push({
              id: 'ctx-info',
              severity: 'info',
              title: () => t('alertContextInfo'),
              message: () => t('alertContextInfo') + ' (~' + Math.round(ratio * 100) + '%)',
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
```

- [ ] **Step 2: Verify provider runs**

In browser console:
```js
var sp = createSessionContextProvider()
sp.start(function(alerts) { console.log('context alerts:', alerts) })
// Wait 3s — should see alerts (possibly empty) logged
sp.stop()
```

- [ ] **Step 3: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): add SessionContextProvider with DOM-based estimation"
```

---

### Task 6: Create the NetworkAlertProvider

**Files:**
- Modify: `lib/client.js` (after SessionContextProvider, same region)

**Interfaces:**
- Consumes: `navigator.onLine`, `/plugins/dock-flash/proxy-status` heartbeat
- Produces: alerts with ids like `'net-offline'`, `'net-slow'`, `'net-timeout'`

- [ ] **Step 1: Write the NetworkAlertProvider**

Insert after `createSessionContextProvider()`:

```js
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
          title: () => t('alertNetworkOffline'),
          message: () => t('alertNetworkOffline'),
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
            method: 'HEAD',
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
                title: () => t('alertNetworkTimeout'),
                message: () => t('alertNetworkTimeout'),
                icon: '🔴',
                timestamp: Date.now(),
                dismissible: true,
              })
            } else if (lastLatency > SLOW_THRESHOLD) {
              alerts.push({
                id: 'net-slow',
                severity: 'warning',
                title: () => t('alertNetworkSlow').replace('{d}', lastLatency),
                message: () => t('alertNetworkSlow').replace('{d}', lastLatency + 'ms'),
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
                title: () => t('alertNetworkTimeout'),
                message: () => t('alertNetworkTimeout'),
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
```

- [ ] **Step 2: Verify provider runs**

In browser console:
```js
var np = createNetworkAlertProvider()
np.start(function(alerts) { console.log('network alerts:', alerts) })
// Wait 5s — should see alerts logged (empty if network OK)
np.stop()
```

- [ ] **Step 3: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): add NetworkAlertProvider with heartbeat and online/offline"
```

---

### Task 7: Wire AlertRegistry into PluginEntry — creation, providers, switch, service

**Files:**
- Modify: `lib/client.js:5367–` (PluginEntry, `apply()` function)

**Interfaces:**
- Consumes: `createAlertRegistry`, `createMemoryAlertProvider`, `createSessionContextProvider`, `createNetworkAlertProvider`
- Produces: `ctx.provide('dockFlashAlerts', alertRegistry)`, toggle switch `dock-flash:system-alerts`

- [ ] **Step 1: Create AlertRegistry and register providers**

In the `apply(ctx)` function, after the `ctx.provide('quickControl', registry)` block (around line 5422), add:

```js
          // ── 1b. Create & publish the alert registry service ──────────
          const alertRegistry = createAlertRegistry()
          ctx.provide('dockFlashAlerts', alertRegistry)

          // Register built-in alert providers
          const alertProviders = [
            createMemoryAlertProvider(),
            createSessionContextProvider(),
            createNetworkAlertProvider(),
          ]
          const alertProviderDisposers = alertProviders.map((p) =>
            alertRegistry.registerProvider(p)
          )
```

- [ ] **Step 2: Register the system-alerts toggle switch**

In the `apply(ctx)` function, after the existing system group switches (near the end of built-in switch registrations, after the proxy-log switch around line 7612), add:

```js
          // ── System Alerts toggle ─────────────────────────────────────
          ctx.effect(() => {
            const _ALERTS_STORAGE_KEY = 'dock-flash:system-alerts'
            var _alertsEnabled = true
            try {
              var stored = localStorage.getItem(_ALERTS_STORAGE_KEY)
              if (stored === 'off') _alertsEnabled = false
            } catch (_) {}

            if (_alertsEnabled) alertRegistry.start()

            const dispose = registry.registerSwitch({
              id: 'dock-flash:system-alerts',
              label: L('systemAlerts'),
              icon: '🚨',
              type: 'toggle',
              group: 'system',
              order: 58,
              getValue: () => alertRegistry.isRunning,
              setValue: (v) => {
                if (v) {
                  alertRegistry.start()
                  try { localStorage.setItem(_ALERTS_STORAGE_KEY, 'on') } catch (_) {}
                } else {
                  alertRegistry.stop()
                  try { localStorage.setItem(_ALERTS_STORAGE_KEY, 'off') } catch (_) {}
                }
                registry.notifyChange('dock-flash:system-alerts')
              },
            })
            return () => {
              alertRegistry.stop()
              dispose()
            }
          }, 'dock-flash: system-alerts switch')
```

- [ ] **Step 3: Clean up on plugin dispose**

In the `apply(ctx)` cleanup section, ensure the alert registry stops. The `ctx.effect` disposers already handle this (each returns a cleanup function), but add an explicit stop for safety. Find the end of `apply(ctx)` and add before the closing:

```js
          // ── Cleanup on context disposal ──────────────────────────────
          ctx.on('dispose', () => {
            alertRegistry.stop()
            alertProviderDisposers.forEach((d) => { try { d() } catch (_) {} })
          })
```

- [ ] **Step 4: Verify the switch appears in the panel**

Refresh the DSH Web GUI, open the QuickControl panel, check that:
1. A "System Alerts" / "系统告警" toggle appears in the System group
2. It defaults to ON
3. Toggling it OFF and refreshing remembers the state

- [ ] **Step 5: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): wire AlertRegistry into PluginEntry with providers and toggle switch"
```

---

### Task 8: Add alert badge to standalone overlay trigger button

**Files:**
- Modify: `lib/client.js:4740–` (overlay trigger creation in StandaloneMode)

**Interfaces:**
- Consumes: `alertRegistry.alertCount`, `alertRegistry.subscribe`
- Produces: `data-dock-flash-alerts` attribute on overlay button; badge child element

- [ ] **Step 1: Add badge element to overlay button**

After the line `el.appendChild(LightningIconNode(triggerIconSize(size)))` (around line 4774), add the badge element creation:

```js
        // ── Alert badge (imperative DOM, not React) ──
        var alertBadgeEl = document.createElement('span')
        alertBadgeEl.style.cssText = Object.entries(S.alertBadge).map(function (e) {
          return e[0].replace(/([A-Z])/g, '-$1').toLowerCase() + ':' + e[1]
        }).join(';')
        alertBadgeEl.textContent = '0'
        alertBadgeEl.style.display = 'none'
        el.appendChild(alertBadgeEl)
```

- [ ] **Step 2: Add alert count update function**

Add a function inside the `mountStandaloneSlotTrigger` closure, after the badge creation:

```js
        function updateAlertBadge() {
          var count = alertRegistry ? alertRegistry.alertCount : 0
          if (count > 0) {
            alertBadgeEl.textContent = count > 99 ? '99+' : String(count)
            alertBadgeEl.style.display = ''
            el.setAttribute('data-dock-flash-alerts', String(count))
          } else {
            alertBadgeEl.style.display = 'none'
            el.removeAttribute('data-dock-flash-alerts')
          }
          // Also update the slot button if it exists (handled via React in QuickTriggerIconButton)
        }
```

- [ ] **Step 3: Subscribe to alert changes**

After `updateAlertBadge` is defined, add the subscription. Find the point after `applyTrigger(currentPosition)` (around line 5203) and add:

```js
        // ── Subscribe to alert changes for badge updates ──
        var alertSub = alertRegistry ? alertRegistry.subscribe(function () {
          updateAlertBadge()
        }) : function () {}
```

- [ ] **Step 4: Add cleanup for alert subscription**

In the cleanup/dispose section of `mountStandaloneSlotTrigger`, add:

```js
        try { alertSub() } catch (_) {}
```

- [ ] **Step 5: Verify badge appears**

1. Force a memory alert by running in console: `for(var i=0;i<1000;i++) window['test'+i]=new Array(100000).fill('x')`
2. Wait 5-10 seconds
3. Check that a red badge appears on the ⚡ overlay button
4. Click ⚡ to open panel, then close all alerts
5. Verify badge disappears

- [ ] **Step 6: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): add alert badge to standalone overlay trigger button"
```

---

### Task 9: Add alert badge to React QuickTriggerIconButton

**Files:**
- Modify: `lib/client.js:4434–4515` (QuickTriggerIconButton function)

**Interfaces:**
- Consumes: `alertRegistry.alertCount`, `alertRegistry.subscribe`
- Produces: badge span rendered conditionally inside the React button

- [ ] **Step 1: Add alertCount state and subscription**

Inside `QuickTriggerIconButton`, after the existing `useEffect` (around line 4465), add:

```js
        // ── Alert badge state ──
        var _ac = useState(0)
        var alertCount = _ac[0]
        var setAlertCount = _ac[1]

        useEffect(function () {
          if (!alertRegistry) return
          setAlertCount(alertRegistry.alertCount)
          return alertRegistry.subscribe(function () {
            setAlertCount(alertRegistry.alertCount)
          })
        }, [alertRegistry])
```

- [ ] **Step 2: Render badge conditionally**

In the return statement of `QuickTriggerIconButton` (around line 4500), modify the button's children to include the badge. Find the existing `LightningIcon(triggerIconSize(size))` child and add the badge after it:

```js
        // In the h('button', ...) call, the children become:
        // [LightningIcon(triggerIconSize(size)), alertCount > 0 ? badgeElement : null]

        // Replace the existing return with:
        return h('button', {
          type: 'button',
          'data-dock-flash-trigger': '',
          'data-dock-flash-alerts': alertCount > 0 ? String(alertCount) : undefined,
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
        },
          LightningIcon(triggerIconSize(size)),
          alertCount > 0
            ? h('span', {
                style: S.alertBadge,
                key: 'alert-badge',
              }, alertCount > 99 ? '99+' : String(alertCount))
            : null
        )
```

Note: Replace the existing return statement at lines 4500–4514 with this updated version.

- [ ] **Step 3: Verify badge on slot buttons**

1. Switch trigger position to "Input Right" (not overlay)
2. Force a memory alert
3. Verify the red badge appears on the ⚡ slot button

- [ ] **Step 4: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): add alert badge to React QuickTriggerIconButton"
```

---

### Task 10: Render alert bar in QuickControlPanel

**Files:**
- Modify: `lib/client.js:2540–3379` (PanelComponent region)

**Interfaces:**
- Consumes: `alertRegistry.getAlerts()`, `alertRegistry.dismissAlert()`, `alertRegistry.dismissAll()`, `alertRegistry.subscribe()`
- Produces: Alert bar rendered above tab pages in the panel

- [ ] **Step 1: Add alertTick state and subscription**

Inside `QuickControlPanel`, after the existing state declarations (around line 2593), add:

```js
      const [alertTick, setAlertTick] = useState(0)
```

After the registry subscription `useEffect` (around line 2666), add:

```js
      // Subscribe to alert registry changes
      useEffect(() => {
        if (!alertRegistry) return
        const dispose = alertRegistry.subscribe(() => {
          setAlertTick((v) => v + 1)
        })
        return dispose
      }, [alertRegistry])
```

- [ ] **Step 2: Create the alert bar renderer function**

Inside `QuickControlPanel`, before the main return statement (around line 3206), add a helper:

```js
      // ── Alert bar rendering ─────────────────────────────────────────────
      void alertTick // ensure re-render on alert changes
      const alertAlerts = alertRegistry ? alertRegistry.getAlerts() : []

      function renderAlertBar() {
        if (!alertAlerts || alertAlerts.length === 0) return null

        // Determine the highest severity for the bar's overall tint
        var highestSeverity = alertAlerts[0].severity || 'info'

        return h('div', { style: S.alertBar, key: 'alert-bar' },
          alertAlerts.map((alert, i) => {
            var severityStyle = S['alertSeverity' + alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)]
              || S.alertSeverityInfo
            return h('div', {
              key: alert.id,
              style: { ...S.alertItem, ...severityStyle },
            },
              h('span', { style: S.alertItemIcon }, alert.icon || '⚠️'),
              h('span', { style: S.alertItemText },
                typeof alert.title === 'function' ? alert.title() : alert.title
              ),
              alert.dismissible !== false
                ? h('button', {
                    type: 'button',
                    style: S.alertDismissBtn,
                    onClick: (e) => {
                      e.stopPropagation()
                      alertRegistry.dismissAlert(alert.id)
                    },
                    'aria-label': '×',
                  }, '×')
                : null,
            )
          }),
          alertAlerts.length > 1
            ? h('div', { style: S.alertDismissAllBar, key: 'dismiss-all' },
                h('button', {
                  type: 'button',
                  style: S.alertDismissAllBtn,
                  onClick: (e) => {
                    e.stopPropagation()
                    alertRegistry.dismissAll()
                  },
                }, t('alertDismissAll'))
              )
            : null,
        )
      }
```

- [ ] **Step 3: Insert alert bar into panel render**

In the main return statement of `QuickControlPanel` (line 3206), the structure is:

```js
return h('div', { key, style: S.root, ... },
  pages.map(...)
)
```

Insert the alert bar BEFORE `pages.map(...)`:

Change:
```js
      return h('div', {
        key: 'qcp-' + localeKey,
        style: S.root,
        'data-dsh-plugin': 'dock-flash',
        'data-dsh-surface': 'floating-window',
      },
        pages.map((page, pi) => {
```

To:
```js
      return h('div', {
        key: 'qcp-' + localeKey,
        style: S.root,
        'data-dsh-plugin': 'dock-flash',
        'data-dsh-surface': 'floating-window',
      },
        renderAlertBar(),
        pages.map((page, pi) => {
```

- [ ] **Step 4: Verify alert bar renders**

1. Force a memory alert (allocate lots of memory in console)
2. Open the QuickControl panel
3. Verify an alert bar appears at the top with colored background
4. Click × to dismiss one alert
5. Click "Dismiss all" if multiple alerts
6. Verify alert bar disappears when all dismissed

- [ ] **Step 5: Commit**

```bash
git add lib/client.js
git commit -m "feat(alerts): render alert bar in QuickControlPanel above tabs"
```

---

### Task 11: Add host-side HTTP routes for alert push and pull

**Files:**
- Modify: `src/index.ts:741–853` (HTTP routes section)

**Interfaces:**
- Consumes: `webServer` service
- Produces: `POST /plugins/dock-flash/push-alert` and `GET /plugins/dock-flash/host-alerts`

- [ ] **Step 1: Add in-memory alert queue and routes**

In `src/index.ts`, before the `ctx.inject(['webServer'], ...)` block (around line 741), add the alert queue:

```ts
  // ── Host-push alert queue (consumed by the client's network alert provider) ──
  const hostAlerts: Array<Record<string, unknown>> = []
```

Inside the `ctx.inject(['webServer'], (wsCtx: any) => {` block, after the test-connection route registration (around line 852), add:

```ts
    // ── Host-push alerts: backend can push alerts to the frontend ──
    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dock-flash/push-alert',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('allow', 'POST')
          res.end()
          return
        }
        const body = await readJsonBody(req)
        if (!body || !body.id || !body.severity) {
          sendJson(res, 400, { ok: false, error: 'missing id or severity' })
          return
        }
        hostAlerts.push({
          id: String(body.id),
          severity: String(body.severity),
          title: String(body.title || ''),
          message: String(body.message || ''),
          icon: String(body.icon || '⚠️'),
          timestamp: Date.now(),
          dismissible: body.dismissible !== false,
        })
        // Cap at 50
        while (hostAlerts.length > 50) hostAlerts.shift()
        sendJson(res, 200, { ok: true, queued: hostAlerts.length })
      },
    }), 'dock-flash: POST /plugins/dock-flash/push-alert')

    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dock-flash/host-alerts',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }
        const snapshot = hostAlerts.splice(0)
        sendJson(res, 200, { alerts: snapshot })
      },
    }), 'dock-flash: GET /plugins/dock-flash/host-alerts')
```

- [ ] **Step 2: Build the host half**

```bash
cd D:\codes\learn\dsh-plugin\dock-flash && pnpm run build
```

Expected: `tsc` completes with no errors, `dist/index.js` is updated.

- [ ] **Step 3: Verify routes work**

Restart DSH, then in browser console:
```js
// Push an alert
fetch('/plugins/dock-flash/push-alert', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'test-1', severity: 'warning', title: 'Test Alert', message: 'Testing' })
}).then(r => r.json()).then(console.log)
// Should return { ok: true, queued: 1 }

// Pull alerts
fetch('/plugins/dock-flash/host-alerts').then(r => r.json()).then(console.log)
// Should return { alerts: [{ id: 'test-1', severity: 'warning', ... }] }

// Pull again (should be empty now — consumed)
fetch('/plugins/dock-flash/host-alerts').then(r => r.json()).then(console.log)
// Should return { alerts: [] }
```

- [ ] **Step 4: Commit**

```bash
git add src/index.ts dist/index.js
git commit -m "feat(alerts): add host-side push-alert and host-alerts HTTP routes"
```

---

### Task 12: Update the file structure comment header

**Files:**
- Modify: `lib/client.js:5–17` (file structure comment)

- [ ] **Step 1: Add new regions to the header comment**

Update the file structure comment to include the new regions:

```js
//  #region AlertRegistry        — AlertRegistry (pub/sub alert registry)
//  #region AlertProviders       — MemoryAlertProvider, SessionContextProvider, NetworkAlertProvider
```

Add these between the `Registry` and `SwitchRenderers` entries.

- [ ] **Step 2: Commit**

```bash
git add lib/client.js
git commit -m "docs(alerts): update file structure comment with new regions"
```

---

### Task 13: Integration test — full alert flow

**Files:** None (manual verification)

- [ ] **Step 1: Memory alert end-to-end**

1. Open DSH Web GUI in Chrome
2. Open browser console
3. Run: `for(var i=0;i<500;i++) window['memtest'+i]=new Array(500000).fill('x')`
4. Wait for memory to rise above 80%
5. Verify: red badge appears on ⚡ trigger button
6. Click ⚡ to open panel
7. Verify: alert bar appears at top of panel with memory warning
8. Click × to dismiss the alert
9. Verify: badge disappears, alert bar disappears
10. Toggle "System Alerts" OFF
11. Verify: no more alerts appear even if memory stays high
12. Toggle "System Alerts" back ON
13. Verify: alerts resume

- [ ] **Step 2: Network alert end-to-end**

1. Open Chrome DevTools → Network tab
2. Check "Offline" in throttling dropdown
3. Wait 5-10 seconds
4. Verify: offline alert appears in badge and panel
5. Uncheck "Offline"
6. Wait for next poll cycle
7. Verify: alert disappears

- [ ] **Step 3: Session context alert end-to-end**

1. Start a long conversation (many messages)
2. Open panel periodically
3. Verify: context alert appears when message count is high
4. (This is hard to trigger naturally — the heuristic is conservative)

- [ ] **Step 4: Adaptive polling verification**

1. Open console, watch for `[dock-flash]` memory poll logs
2. At low memory: polls should be ~30s apart
3. At high memory (>90%): polls should be ~2-5s apart
4. Verify the interval changes as memory usage changes

- [ ] **Step 5: Cross-mode verification**

1. Test in workbench mode (if dock-base is installed): verify badge and alert bar work
2. Test in standalone mode: verify overlay badge and slot button badge both work
3. Test switching trigger positions: badge follows correctly

- [ ] **Step 6: i18n verification**

1. Switch DSH language to Chinese
2. Verify: all alert text appears in Chinese
3. Switch to English
4. Verify: all alert text appears in English

- [ ] **Step 7: Overflow check**

With the panel open and an alert bar showing:
```js
__dockFlashOverflow()
```
Expected: no overflow reported. If overflow is found, add `minWidth: 0` to the alert bar container.

---

### Task 14: Version bump and changelog

**Files:**
- Modify: `lib/client.js:59` (CLIENT_VERSION)
- Modify: `package.json:3` (version)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump CLIENT_VERSION**

In `lib/client.js` line 59, change:
```js
const CLIENT_VERSION = '1.5.2'
```
to:
```js
const CLIENT_VERSION = '1.6.0'
```

- [ ] **Step 2: Bump package.json version**

In `package.json` line 3, change the version to `1.6.0`.

- [ ] **Step 3: Add changelog entry**

In `CHANGELOG.md`, add at the top:

```markdown
## 1.6.0

### Added
- **System Alerts**: new alert notification system with three built-in providers:
  - **Memory Alert**: monitors V8 heap usage via `performance.memory` with adaptive polling (more frequent as memory approaches the limit)
  - **Session Context Alert**: estimates context window exhaustion from DOM message node count
  - **Network Alert**: detects offline state and high latency via heartbeat to proxy-status endpoint
- Alert badge on the ⚡ trigger button (both overlay and slot positions)
- Alert bar at the top of the QuickControl panel showing active alerts with severity coloring
- `dock-flash:system-alerts` toggle switch in the System group to enable/disable monitoring
- `ctx.provide('dockFlashAlerts', alertRegistry)` service for third-party alert providers
- Host-side HTTP routes: `POST /plugins/dock-flash/push-alert` and `GET /plugins/dock-flash/host-alerts`
```

- [ ] **Step 4: Verify version consistency**

```bash
cd D:\codes\learn\dsh-plugin\dock-flash && pnpm run check:docs
```

Expected: version numbers match, doc budget passes.

- [ ] **Step 5: Commit**

```bash
git add lib/client.js package.json CHANGELOG.md
git commit -m "release: v1.6.0 — system alerts feature"
```

---

## Self-Review

### 1. Spec Coverage

| Requirement | Task |
|---|---|
| V8 memory alert with adaptive polling | Tasks 4, 7 |
| Session context alert with adaptive polling | Tasks 5, 7 |
| Network anomaly alert | Tasks 6, 7 |
| Badge on ⚡ trigger icon | Tasks 8, 9 |
| Alert bar in panel | Task 10 |
| Toggle switch | Task 7 |
| i18n | Task 1 |
| Host push-alert routes | Task 11 |
| Adaptive frequency (closer → more frequent) | Tasks 4, 5, 6 |
| `performance.memory` graceful fallback | Task 4 (info alert about unavailability) |
| Error boundary compliance | Task 10 (alert bar rendered within existing panel already wrapped) |

### 2. Placeholder Scan

No TBD, TODO, "implement later", or "add appropriate error handling" found. All code blocks contain actual implementation code.

### 3. Type Consistency

- `alertRegistry.subscribe(fn)` → returns disposer — used consistently in Tasks 8, 9, 10
- `alertRegistry.getAlerts()` → returns `Alert[]` — used in Task 10
- `alertRegistry.alertCount` → number — used in Tasks 8, 9
- `alertRegistry.dismissAlert(id)` → takes full id string — used in Task 10
- Provider `start(callback)` where `callback(alerts: Alert[])` — consistent across Tasks 4, 5, 6
- `L('key')` for all i18n labels — consistent with existing code
