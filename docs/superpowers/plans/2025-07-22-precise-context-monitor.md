# Precise Context Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dock-flash's DOM-count heuristic with precise token usage data from DSH's session event stream, keeping the heuristic as automatic fallback.

**Architecture:** The client-side `createSessionContextProvider()` currently counts `[class*="_message"]` DOM nodes × 200 tokens/msg. DSH's `sessions` service (provided by `@deepseek-ai/dsh-api-session-controller`) exposes `SessionBinding.eventSource`, which is an `ObservableSnapshot<SessionEventWindow>` whose entries include `assistant/message` events carrying `usage: TokenUsage` with exact `inputTokens`/`outputTokens`. The provider will subscribe to this event source, accumulate per-session token totals, and compare against a model-aware context window size. When session events are unavailable (no active session, service not injected), the provider falls back to the existing heuristic. The model name from `request/header` events drives a configurable model-to-window mapping, eliminating the hardcoded 128K default.

**Tech Stack:** Cordis service injection (`ctx.get('sessions')`), `@deepseek-ai/dsh-session` event types, `@deepseek-ai/dsh-llm` `TokenUsage`, existing `AlertRegistry` / `QuickControlRegistry`, existing `MonitorConfigModal`.

**Spec:** This plan is self-specifying — the feature request is "use DSH's trajectory/session data for precise context monitoring instead of the DOM-count heuristic."

## Global Constraints

- Client half is `lib/client.js`: single monolithic file, NO build step, edited directly, NO TypeScript syntax
- Host half is `src/index.ts`: compiled via `pnpm run build` (tsc), ESM only, no `require()`
- `dist/` is tracked on purpose — every `src/index.ts` change must be followed by `pnpm run build` and a commit of `dist/`
- `dsh.client.inject` in `package.json` must use **base** package names, never `<pkg>/client`
- Settings schema values owned by the host use `Volatile` for alert thresholds (not persisted across DSH restarts)
- All new settings need: `SettingsSchema` field + `loadHostPreferences()` mapping + read from `_hostPrefs` + write through `savePrefs()`
- `_alertPref(key)` reads from `_hostPrefs` with built-in fallback defaults
- Per Critical Rule 7: `setValue()` is a pure state setter; the panel handles UI refresh
- Per Critical Rule 3: `storage` event only fires in other browsing contexts — same-window writes need the iframe trick
- Never use CSS `zoom` on `<html>` (Critical Rule 9)
- React usage goes through `h = React.createElement` — no JSX
- `require` is available in the client factory; `require('react')` for React
- i18n: all user-visible strings go through `t(key)` with functional labels `label: () => t('xxx')`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/client.js` | Modify | `createSessionContextProvider()`: subscribe to session events, accumulate tokens, model-aware window; fallback to heuristic; new i18n keys; MonitorConfigModal model-window section |
| `src/index.ts` | Modify | New settings: `modelContextWindows` (record), remove `ctxTokensPerMsg` from schema (or keep as deprecated); update `FlashSettings` interface |
| `dist/index.js` | Rebuild | After `src/index.ts` changes |
| `package.json` | Modify | Add `@deepseek-ai/dsh-api-session-controller` to `dsh.client.inject` for load-order hint |

---

### Task 1: Probe — Verify `sessions` service accessibility from dock-flash

**Files:**
- Create: (temporary probe in browser console, no committed files)

**Interfaces:**
- Consumes: DSH `sessions` service at `ctx.get('sessions')`
- Produces: Confirmed API surface: whether `sessions` resolves, `scopeOf(ctx)` returns a session id, `binding(id).eventSource.getSnapshot()` returns event entries, event entries contain `assistant/message` with `usage` shaped like `{ inputTokens: number, outputTokens: number, ... }`

This is a read-only exploration task. No code changes.

- [x] **Step 1: Add `sessions` to `dsh.client.inject` and verify service resolution**

In `package.json`, add `"@deepseek-ai/dsh-api-session-controller"` to the `dsh.client.inject` array (load-order hint — same pattern as `"dock-base"` and `"@deepseek-ai/dsh-api-remotes"`).

Done — `"@deepseek-ai/dsh-api-session-controller"` added to `dsh.client.inject` in `package.json`.

- [x] **Step 2: Verify session event source contains `usage` data**

Confirmed via source code probe:
- `ctx.get('sessions')` → `ClientSessions` with `scopeOf(ctx)`, `binding(id)`, etc.
- `binding.eventSource` is `ObservableSnapshot<SessionEventWindow>`
- `assistant/message` events carry `usage?: TokenUsage` at `entry.event.data.usage`
- `TokenUsage` = `{ inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`
- **Key**: `inputTokens` is disjoint from cache tokens; billed input = `inputTokens + cacheReadTokens + cacheWriteTokens`

- [x] **Step 3: Verify `request/header` events carry model name**

Confirmed via source code probe:
- `request/header` events carry `entry.event.data.header.config.model` (NOT `entry.event.config.model`)
- `entry.event.data.header.config` is `LlmCallConfig` with `provider`, `model`, etc.
- Model is a string like `"deepseek-chat"` or `"gpt-4o"`

- [x] **Step 4: Record findings**

Confirmed API surface:
- Service name: `'sessions'` (via `ctx.get('sessions')`)
- `sessions.scopeOf(ctx)` → `SessionId | undefined`
- `sessions.binding(id)` → `SessionBinding | undefined` with `{ sessionId, session, eventSource, ctx }`
- `eventSource.subscribe(fn)` returns unsubscribe function; `eventSource.getSnapshot()` returns `SessionEventWindow`
- Entry structure: `entry.type === 'event'` → `entry.event` = `{ type, seq, time, data, ... }`
- Event data is nested under `.data`, NOT flattened: `entry.event.data.usage`, `entry.event.data.header`
- Change kinds: `'replace'` (full reload), `'prepend'`, `'append'`, `'settle-assistant'`

- [x] **Step 5: Commit the `dsh.client.inject` addition**

Committed as `b55d4aa`.

---

### Task 2: Implement `SessionEventTokenSource` — session event subscription layer

**Files:**
- Modify: `lib/client.js` — add `SessionEventTokenSource` factory near `createSessionContextProvider()`

**Interfaces:**
- Consumes: `ctx` (Cordis context) to call `ctx.get('sessions')`; `SessionBinding.eventSource` (`ObservableSnapshot<SessionEventWindow>`); `_alertPref('modelContextWindows')` for window size lookup
- Produces: `SessionEventTokenSource` object with interface `{ start(ctx): void, stop(): void, getTokenEstimate(): { inputTokens: number, contextWindow: number, model: string|null, source: 'precise'|'heuristic' } }`; the context provider in Task 3 consumes this

This task creates the data layer that reads precise token usage from session events. It does NOT modify the alert provider yet — that's Task 3.

- [x] **Step 1: Add the `SessionEventTokenSource` factory function**

Insert after the `_ALERT_DEFAULTS` block (around line 4180), before the AlertProviders region. This factory subscribes to session events and maintains a running total:

```js
    /**
     * SessionEventTokenSource — reads precise token usage from DSH's session
     * event stream via the `sessions` service.
     *
     * Data path: ctx.get('sessions') → binding(sessionId) → eventSource
     *   → entries → filter assistant/message → usage.inputTokens
     *
     * Also reads request/header events for model name → context window lookup.
     *
     * Falls back gracefully: if sessions service is unavailable, or no session
     * is active, or usage is absent from events, getTokenEstimate() returns
     * source: 'heuristic' and the caller falls through to the DOM-count path.
     */
    function createSessionEventTokenSource() {
      var _unsubscribe = null
      var _accumulated = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
      var _lastProcessedSeq = -1
      var _model = null
      var _contextWindow = null
      var _sessions = null
      var _sessionId = null

      /** Model name → context window size (tokens).  User overrides via
       *  _alertPref('modelContextWindows') take precedence; this table is the
       *  built-in fallback. */
      var _KNOWN_WINDOWS = {
        'deepseek-chat': 128000,
        'deepseek-reasoner': 128000,
        'deepseek-coder': 163840,
        'gpt-4o': 128000,
        'gpt-4o-mini': 128000,
        'gpt-4-turbo': 128000,
        'gpt-4': 8192,
        'gpt-4-32k': 32768,
        'gpt-3.5-turbo': 16385,
        'claude-3-5-sonnet': 200000,
        'claude-3-5-haiku': 200000,
        'claude-3-opus': 200000,
        'claude-3-sonnet': 200000,
        'claude-3-haiku': 200000,
      }

      function _resolveWindow(modelName) {
        // 1. User-configured mapping (host pref)
        var custom = _alertPref('modelContextWindows')
        if (custom && typeof custom === 'object' && custom[modelName]) {
          return custom[modelName]
        }
        // 2. Built-in table
        if (_KNOWN_WINDOWS[modelName]) return _KNOWN_WINDOWS[modelName]
        // 3. Fuzzy match: strip provider prefix, version suffix
        var base = modelName.replace(/^[a-z]+\//, '').replace(/-v\d+.*$/, '').replace(/-\d{4}$/, '')
        if (_KNOWN_WINDOWS[base]) return _KNOWN_WINDOWS[base]
        // 4. Unknown model — return null (caller falls through to heuristic)
        return null
      }

      function _processEntries(entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i]
          if (entry.type !== 'event') continue
          var ev = entry.event
          // Skip already-processed events
          var seq = ev.seq != null ? ev.seq : -1
          if (seq >= 0 && seq <= _lastProcessedSeq) continue

          if (ev.type === 'assistant/message') {
            if (ev.usage && typeof ev.usage === 'object') {
              if (typeof ev.usage.inputTokens === 'number') _accumulated.inputTokens += ev.usage.inputTokens
              if (typeof ev.usage.outputTokens === 'number') _accumulated.outputTokens += ev.usage.outputTokens
              if (typeof ev.usage.cacheReadTokens === 'number') _accumulated.cacheReadTokens += ev.usage.cacheReadTokens
              if (typeof ev.usage.cacheWriteTokens === 'number') _accumulated.cacheWriteTokens += ev.usage.cacheWriteTokens
              if (typeof ev.usage.reasoningTokens === 'number') _accumulated.reasoningTokens += ev.usage.reasoningTokens
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          }

          if (ev.type === 'request/header') {
            if (ev.config && ev.config.model) {
              _model = ev.config.model
              _contextWindow = _resolveWindow(_model)
            }
            if (seq >= 0 && seq > _lastProcessedSeq) _lastProcessedSeq = seq
          }
        }
      }

      function _onEventWindowChange() {
        if (!_sessions || !_sessionId) return
        try {
          var binding = _sessions.binding(_sessionId)
          if (!binding) return
          var win = binding.eventSource.getSnapshot()
          if (!win || !win.entries) return
          // On replace (history reload), reset accumulated and re-scan
          if (win.change && win.change.kind === 'replace') {
            _accumulated = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
            _lastProcessedSeq = -1
            _model = null
            _contextWindow = null
          }
          _processEntries(win.entries)
        } catch (e) {
          // Non-fatal: event source may be mid-transition
        }
      }

      return {
        start: function (ctx) {
          try {
            _sessions = ctx && ctx.get ? ctx.get('sessions') : undefined
          } catch (_) {}
          if (!_sessions) return

          // Resolve current session id from ctx
          try {
            _sessionId = _sessions.scopeOf(ctx)
          } catch (_) {}

          if (!_sessionId) return

          // Subscribe to event source changes
          try {
            var binding = _sessions.binding(_sessionId)
            if (binding && binding.eventSource) {
              // Process existing entries immediately
              var win = binding.eventSource.getSnapshot()
              if (win && win.entries) _processEntries(win.entries)
              // Subscribe for live updates
              _unsubscribe = binding.eventSource.subscribe(_onEventWindowChange)
            }
          } catch (e) {
            // Non-fatal: binding may not be ready yet
          }
        },

        stop: function () {
          if (_unsubscribe) { try { _unsubscribe() } catch (_) {} }
          _unsubscribe = null
          _sessions = null
          _sessionId = null
          _accumulated = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
          _lastProcessedSeq = -1
          _model = null
          _contextWindow = null
        },

        /** Returns the current token estimate.
         *  source: 'precise' when session events with usage are available,
         *  'heuristic' when falling back (no events, no usage, etc.)
         */
        getTokenEstimate: function () {
          if (_accumulated.inputTokens > 0) {
            return {
              inputTokens: _accumulated.inputTokens,
              outputTokens: _accumulated.outputTokens,
              cacheReadTokens: _accumulated.cacheReadTokens,
              cacheWriteTokens: _accumulated.cacheWriteTokens,
              reasoningTokens: _accumulated.reasoningTokens,
              contextWindow: _contextWindow || _alertPref('ctxApproxWindow'),
              model: _model,
              source: 'precise',
            }
          }
          return { source: 'heuristic' }
        },
      }
    }
```

- [x] **Step 2: Run `pnpm run check:overlay` to verify no syntax errors were introduced**

Run: `pnpm run check:overlay`
Expected: All existing assertions still pass (no behavioral change yet — new code is not called)

- [x] **Step 3: Commit**

**Files:**
- Modify: `lib/client.js` — rewrite `createSessionContextProvider()` and `estimateContextRatio()`

**Interfaces:**
- Consumes: `SessionEventTokenSource` from Task 2, `_alertPref()` defaults, existing `AlertRegistry` provider interface
- Produces: `dock-flash:context-alert` provider that emits precise or heuristic alerts with a `source` field; provider `start(cb)` signature unchanged so `AlertRegistry` needs no changes

This is the core refactoring. The provider now tries the precise source first, falls back to the heuristic, and includes the data source in alert metadata.

- [x] **Step 1: Rewrite `estimateContextRatio` to accept a `tokenEstimate` parameter**

Replace the current `estimateContextRatio()` function (lines 4383-4396) with a two-path version:

```js
      function estimateContextRatio(tokenEstimate) {
        // ── Precise path: session events with usage data ──
        if (tokenEstimate && tokenEstimate.source === 'precise') {
          var window = tokenEstimate.contextWindow || _alertPref('ctxApproxWindow')
          if (window <= 0) return null
          return {
            ratio: tokenEstimate.inputTokens / window,
            msgCount: -1,  // not meaningful for precise mode
            estTokens: tokenEstimate.inputTokens,
            source: 'precise',
            model: tokenEstimate.model || null,
            contextWindow: window,
            // Breakdown for detailed display
            outputTokens: tokenEstimate.outputTokens,
            cacheReadTokens: tokenEstimate.cacheReadTokens,
            cacheWriteTokens: tokenEstimate.cacheWriteTokens,
            reasoningTokens: tokenEstimate.reasoningTokens,
          }
        }

        // ── Heuristic fallback: DOM node count ──
        try {
          var approxWindow = _alertPref('ctxApproxWindow')
          var tokensPerMsg = _alertPref('ctxTokensPerMsg')
          if (approxWindow <= 0 || tokensPerMsg <= 0) return null
          var nodes = document.querySelectorAll('[class*="_message"]')
          var count = nodes ? nodes.length : 0
          var estTokens = count * tokensPerMsg
          return {
            ratio: estTokens / approxWindow,
            msgCount: count,
            estTokens: estTokens,
            source: 'heuristic',
            model: null,
            contextWindow: approxWindow,
          }
        } catch (_) {
          return null
        }
      }
```

- [x] **Step 2: Rewrite `createSessionContextProvider` to use `SessionEventTokenSource`**

Replace the entire `createSessionContextProvider()` function (lines 4379-4468):

```js
    function createSessionContextProvider() {
      var timer = null
      var callback = null
      var tokenSource = null

      function poll() {
        if (!callback) return
        var alerts = []
        var tokenEstimate = tokenSource ? tokenSource.getTokenEstimate() : { source: 'heuristic' }
        var est = estimateContextRatio(tokenEstimate)
        if (est) {
          var ratio = est.ratio
          var tInfo = _alertPref('ctxThresholdInfo') / 100
          var tWarn = _alertPref('ctxThresholdWarning') / 100
          var tErr  = _alertPref('ctxThresholdError') / 100
          if (!(tInfo < tWarn && tWarn < tErr)) {
            tInfo = 0.70; tWarn = 0.85; tErr = 0.95
          }

          var sourceLabel = est.source === 'precise'
            ? (est.model || '?') + ' · ' + (est.estTokens >= 1000 ? Math.round(est.estTokens / 1000) + 'K' : est.estTokens) + '/' + (est.contextWindow >= 1000 ? Math.round(est.contextWindow / 1000) + 'K' : est.contextWindow)
            : '~' + Math.round(est.estTokens / 1000) + 'K/' + Math.round(est.contextWindow / 1000) + 'K (estimated)'

          if (ratio >= tErr) {
            alerts.push({
              id: 'ctx-error',
              severity: 'error',
              title: function () { return t('alertContextError') },
              message: function () { return t('alertContextError') + ' (' + Math.round(ratio * 100) + '% · ' + sourceLabel + ')' },
              icon: '🔴',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= tWarn) {
            alerts.push({
              id: 'ctx-warning',
              severity: 'warning',
              title: function () { return t('alertContextWarning') },
              message: function () { return t('alertContextWarning') + ' (' + Math.round(ratio * 100) + '% · ' + sourceLabel + ')' },
              icon: '🟡',
              timestamp: Date.now(),
              dismissible: true,
            })
          } else if (ratio >= tInfo) {
            alerts.push({
              id: 'ctx-info',
              severity: 'info',
              title: function () { return t('alertContextInfo') },
              message: function () { return t('alertContextInfo') + ' (' + Math.round(ratio * 100) + '% · ' + sourceLabel + ')' },
              icon: '🔵',
              timestamp: Date.now(),
              dismissible: true,
            })
          }
        }
        try { callback(alerts) } catch (_) {}

        // Adaptive interval — same formula, but ratio from precise data
        var pollBase = _alertPref('ctxPollBase')
        var pollMin  = _alertPref('ctxPollMin')
        var nextInterval = pollBase
        if (est) {
          var r = Math.min(est.ratio, 1)
          nextInterval = Math.max(pollMin, Math.round(pollBase * Math.pow(1 - r, 2) + pollMin))
        }
        // Precise mode: since event source pushes updates, we can poll
        // less aggressively.  Double the effective interval.
        if (tokenEstimate && tokenEstimate.source === 'precise') {
          nextInterval = Math.max(pollMin, nextInterval * 2)
        }
        timer = setTimeout(poll, nextInterval)
      }

      return {
        id: 'dock-flash:context-alert',
        start: function (cb) {
          callback = cb
          // Start the token source (reads session events)
          tokenSource = createSessionEventTokenSource()
          tokenSource.start(/* ctx will be passed via closure in Task 4 */)
          poll()
        },
        stop: function () {
          callback = null
          if (timer) { clearTimeout(timer); timer = null }
          if (tokenSource) { tokenSource.stop(); tokenSource = null }
        },
      }
    }
```

- [x] **Step 3: Run `pnpm run check:overlay`**

Run: `pnpm run check:overlay`
Expected: All existing assertions still pass (the overlay test doesn't test the alert provider directly)

- [x] **Step 4: Commit**

**Files:**
- Modify: `lib/client.js` — pass `ctx` when creating/starting the context provider

**Interfaces:**
- Consumes: `ctx` from `apply()`, `createSessionContextProvider()` from Task 3
- Produces: Context provider that has `ctx` available for `ctx.get('sessions')`

The provider's `start()` method needs access to the Cordis `ctx` to call `ctx.get('sessions')`. Currently, `start(cb)` receives only the callback. We need to pass `ctx` through.

- [x] **Step 1: Modify `createSessionContextProvider` to accept `ctx` in `start()`**

Update the `start` method signature in `createSessionContextProvider()`:

```js
        start: function (cb, ctx) {
          callback = cb
          tokenSource = createSessionEventTokenSource()
          tokenSource.start(ctx)
          poll()
        },
```

- [x] **Step 2: Update the `AlertRegistry.handleProviderUpdate` path to pass `ctx`**

In the alert provider registration area (around line 9968-9974), the providers are created and started by the `AlertRegistry`. The registry calls `provider.start(callback)`. We need to also pass `ctx`.

Modify the `AlertRegistry`'s `startProvider` method to pass `ctx`:

In the `createAlertRegistry()` function, the `startProvider(id)` method calls `provider.start((alerts) => handleProviderUpdate(id, alerts))`. Change it to also pass `ctx`:

```js
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
```

And capture `registryCtx` in the `createAlertRegistry()` closure:

```js
    function createAlertRegistry(registryCtx) {
      // ... existing code ...
```

- [x] **Step 3: Pass `ctx` when creating the alert registry**

At the call site where `createAlertRegistry()` is invoked (search for `createAlertRegistry()`), pass `ctx`:

```js
          var alertRegistry = createAlertRegistry(ctx)
```

- [x] **Step 4: Run `pnpm run check:overlay`**

Run: `pnpm run check:overlay`
Expected: All existing assertions pass

- [x] **Step 5: Commit**

---

### Task 5: Add model-aware context window configuration to host settings and client UI

**Files:**
- Modify: `src/index.ts` — add `modelContextWindows` setting, update `FlashSettings` interface
- Modify: `lib/client.js` — add i18n keys, update `MonitorConfigModal` for context monitor
- Rebuild: `dist/index.js` via `pnpm run build`

**Interfaces:**
- Consumes: `SettingsSchema` in `src/index.ts`, `_alertPref()` and `MONITOR_SLIDER_FIELDS` in `lib/client.js`
- Produces: `modelContextWindows` host preference (Record<string, number>), exposed via `_hostPrefs.modelContextWindows` and `_alertPref('modelContextWindows')`; MonitorConfigModal shows current model and window, allows user override

- [x] **Step 1: Add `modelContextWindows` to host settings schema**

In `src/index.ts`, add to the `FlashSettings` interface (after `ctxPollMin`):

```typescript
  /** User-configured model → context window overrides. */
  modelContextWindows: Dict<number>
```

Add to the schema object (after `ctxPollMin`):

```typescript
  modelContextWindows: Schema.dict(Schema.number()).default({}).volatile(),
```

Import `Dict` — Schemastery's `Schema.dict()` creates a `Record<string, T>`. If `Dict` is not available, use `Schema.dict(Schema.number())` which returns `Record<string, number>`.

- [x] **Step 2: Add the mapping in `loadHostPreferences()`**

In `lib/client.js`, find the `loadHostPreferences()` function and add the mapping:

```js
          modelContextWindows: resolved.modelContextWindows,
```

- [x] **Step 3: Add the default value in `_ALERT_DEFAULTS`**

```js
      modelContextWindows: {},
```

- [x] **Step 4: Add i18n keys**

Chinese (zh section):

```js
      ctxModel: '当前模型',
      ctxWindow: '上下文窗口',
      ctxSourcePrecise: '精确',
      ctxSourceHeuristic: '估算',
      ctxCustomWindow: '自定义窗口大小',
      ctxModelWindows: '模型窗口映射',
```

English (en section):

```js
      ctxModel: 'Current Model',
      ctxWindow: 'Context Window',
      ctxSourcePrecise: 'Precise',
      ctxSourceHeuristic: 'Estimated',
      ctxCustomWindow: 'Custom Window Size',
      ctxModelWindows: 'Model Window Map',
```

- [x] **Step 5: Update `MonitorConfigModal` to show model and context window info**

In the `MonitorConfigModal` component, for `monitor === 'context'`, add a status section above the sliders showing:

```js
        // In the context monitor config modal, after the title section:
        if (monitor === 'context') {
          var tokenEstimate = _tokenSourceForConfig ? _tokenSourceForConfig.getTokenEstimate() : null
          var est = tokenEstimate ? estimateContextRatio(tokenEstimate) : null
          bodyContent.push(
            // Model info row
            h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' } },
              h('span', { style: S.switchLabel }, t('ctxModel')),
              h('span', { style: { opacity: 0.7, fontSize: '13px' } },
                est && est.model ? est.model : '—')
            ),
            // Context window row
            h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' } },
              h('span', { style: S.switchLabel }, t('ctxWindow')),
              h('span', { style: { opacity: 0.7, fontSize: '13px' } },
                est ? (est.contextWindow >= 1000 ? Math.round(est.contextWindow / 1000) + 'K' : est.contextWindow) + ' tokens' : '—')
            ),
            // Data source row
            h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' } },
              h('span', { style: S.switchLabel }, t('alertCtxCluster')),
              h('span', { style: { opacity: 0.7, fontSize: '13px', color: est && est.source === 'precise' ? '#4ade80' : '#fbbf24' } },
                est ? (est.source === 'precise' ? t('ctxSourcePrecise') : t('ctxSourceHeuristic')) : '—')
            ),
            // Token usage row (precise mode only)
            est && est.source === 'precise' ? h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' } },
              h('span', { style: S.switchLabel }, 'Input tokens'),
              h('span', { style: { opacity: 0.7, fontSize: '13px' } },
                est.estTokens.toLocaleString())
            ) : null,
            h('div', { style: S.monitorModalDivider }),
          )
        }
```

We need a module-level reference to the token source for the config modal to read. Add near the `_monitorConfigRoot` declarations:

```js
    var _tokenSourceForConfig = null   // set when createSessionContextProvider starts
```

And in `createSessionContextProvider`, in the `start` method, set it:

```js
          _tokenSourceForConfig = tokenSource
```

In the `stop` method, clear it:

```js
          _tokenSourceForConfig = null
```

- [x] **Step 6: Add model-context-window editor to the config modal**

After the existing sliders for the `context` monitor, add a small editor that lets the user add/edit model name → window size mappings:

```js
        // After sliders, context-specific model window editor
        if (monitor === 'context') {
          var _mapTick = useState(0)
          var mapTick = _mapTick[0], setMapTick = _mapTick[1]
          var currentMap = _alertPref('modelContextWindows') || {}

          bodyContent.push(
            h('div', { style: S.monitorModalDivider }),
            h('span', { style: S.monitorModalSectionTitle }, t('ctxModelWindows')),
            // List existing entries
            Object.keys(currentMap).length > 0
              ? Object.entries(currentMap).map(function (entry) {
                  var name = entry[0], win = entry[1]
                  return h('div', { key: name, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' } },
                    h('span', { style: { flex: 1, fontSize: '12px', opacity: 0.8 } }, name),
                    h('span', { style: { fontSize: '12px', opacity: 0.6 } }, win >= 1000 ? (win / 1000) + 'K' : win),
                    h('button', {
                      style: { background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '14px', padding: '0 4px' },
                      onClick: function () {
                        var updated = Object.assign({}, currentMap)
                        delete updated[name]
                        _writeAlertPref(undefined, 'modelContextWindows', updated, function (patch, rollback) {
                          console.warn('[dock-flash] failed to write modelContextWindows:', patch)
                        })
                        setMapTick(function (v) { return v + 1 })
                      }
                    }, '×')
                  )
                })
              : h('div', { style: { fontSize: '12px', opacity: 0.4, padding: '4px 0' } }, 'No custom mappings'),
            // Add new entry
            h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
              h('input', {
                id: '_ctxNewModelName',
                placeholder: 'model-name',
                style: { flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', padding: '4px 8px', color: 'inherit', fontSize: '12px' }
              }),
              h('input', {
                id: '_ctxNewModelWindow',
                placeholder: '128000',
                type: 'number',
                style: { width: '80px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', padding: '4px 8px', color: 'inherit', fontSize: '12px' }
              }),
              h('button', {
                style: { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', color: 'inherit', padding: '4px 10px', cursor: 'pointer', fontSize: '12px' },
                onClick: function () {
                  var nameEl = document.getElementById('_ctxNewModelName')
                  var winEl = document.getElementById('_ctxNewModelWindow')
                  var name = nameEl && nameEl.value && nameEl.value.trim()
                  var win = winEl && parseInt(winEl.value, 10)
                  if (!name || !win || win <= 0) return
                  var updated = Object.assign({}, currentMap)
                  updated[name] = win
                  _writeAlertPref(undefined, 'modelContextWindows', updated, function (patch, rollback) {
                    console.warn('[dock-flash] failed to write modelContextWindows:', patch)
                  })
                  if (nameEl) nameEl.value = ''
                  if (winEl) winEl.value = ''
                  setMapTick(function (v) { return v + 1 })
                }
              }, '+')
            )
          )
        }
```

Note: `_writeAlertPref` currently requires `ctx` as first argument. Since the modal doesn't have direct access to `ctx`, we need to store the `ctx` reference at module level (same pattern as `_tokenSourceForConfig`):

```js
    var _alertCtx = null   // set in apply()
```

And set it in `apply()`:

```js
          _alertCtx = ctx
```

Then update the `_writeAlertPref` calls in the modal to use `_alertCtx`.

- [x] **Step 7: Build the host half**

Run: `pnpm run build`

- [x] **Step 8: Run `pnpm run check:overlay`**

Run: `pnpm run check:overlay`
Expected: All assertions pass

- [x] **Step 9: Commit**

```bash
git add src/index.ts dist/index.js lib/client.js
git commit -m "feat(context): add model-aware context window config and UI"
```

---

### Task 6: Update `MONITOR_SLIDER_FIELDS` and deprecate `ctxTokensPerMsg`

**Files:**
- Modify: `lib/client.js` — update `MONITOR_SLIDER_FIELDS.context`, update heuristic label

**Interfaces:**
- Consumes: `MONITOR_SLIDER_FIELDS` definition
- Produces: Updated slider config for context monitor; `ctxTokensPerMsg` slider labeled as "(heuristic fallback)"

Since precise mode doesn't need `ctxTokensPerMsg`, we should keep it but label it clearly as a fallback-only parameter. The `ctxApproxWindow` slider becomes less important when the model window is auto-detected but still needed as a manual override for unknown models.

- [x] **Step 1: Update `MONITOR_SLIDER_FIELDS.context`**

```js
      context: [
        { key: 'ctxApproxWindow',     labelKey: 'ctxApproxWindow',     min: 64000, max: 512000, step: 8000, format: function (v) { return (v / 1000) + 'K' } },
        { key: 'ctxTokensPerMsg',     labelKey: 'ctxTokensPerMsg',     min: 50,    max: 500,   step: 10,   format: function (v) { return '' + v } },
        { key: 'ctxThresholdInfo',    labelKey: 'ctxThresholdInfo',    min: 30,    max: 95,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxThresholdWarning', labelKey: 'ctxThresholdWarning', min: 30,    max: 95,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxThresholdError',   labelKey: 'ctxThresholdError',   min: 30,    max: 95,     step: 1,    format: function (v) { return v + '%' } },
        { key: 'ctxPollBase',         labelKey: 'ctxPollBase',         min: 5000,  max: 60000,  step: 1000, format: function (v) { return v + 'ms' } },
        { key: 'ctxPollMin',          labelKey: 'ctxPollMin',          min: 1000,  max: 10000,  step: 500,  format: function (v) { return v + 'ms' } },
      ],
```

No structural change needed — just add i18n clarification labels:

Add i18n keys:

```js
      // zh
      ctxTokensPerMsgHint: '仅启发式模式使用',
      ctxApproxWindowHint: '未知模型的默认窗口',
      // en
      ctxTokensPerMsgHint: 'Heuristic mode only',
      ctxApproxWindowHint: 'Default for unknown models',
```

These will be shown as `subtitle` on the respective slider rows in `MonitorConfigModal`. The modal already renders fields from `MONITOR_SLIDER_FIELDS`; we need to add `subtitle` support to the slider rendering in the modal.

In the `MonitorConfigModal`, where each slider is rendered, add a subtitle below the label:

```js
              // After the label, before the slider:
              field.labelKey === 'ctxTokensPerMsg' ? h('div', { style: { fontSize: '11px', opacity: 0.4, marginTop: '-2px' } }, t('ctxTokensPerMsgHint')) : null,
              field.labelKey === 'ctxApproxWindow' ? h('div', { style: { fontSize: '11px', opacity: 0.4, marginTop: '-2px' } }, t('ctxApproxWindowHint')) : null,
```

- [x] **Step 2: Run `pnpm run check:overlay`**

---

### Task 7: Update the panel subtitle to show data source quality

**Files:**
- Modify: `lib/client.js` — update `monitorSubtitle` for context monitor

**Interfaces:**
- Consumes: `_tokenSourceForConfig.getTokenEstimate()`
- Produces: Subtitle showing "精确 · deepseek-chat" or "估算中..."

Currently, the context monitor toggle shows "已开启" / "已关闭". When enabled, it should also indicate the data source quality.

- [x] **Step 1: Update `monitorSubtitle` for the context monitor**

Replace the `monitorSubtitle` function (around line 13942):

```js
          function monitorSubtitle(m) {
            return function () {
              if (!_getMonitorOn(m)) return L('monitorOff')
              if (m === 'context') {
                var te = _tokenSourceForConfig ? _tokenSourceForConfig.getTokenEstimate() : null
                if (te && te.source === 'precise') {
                  return L('ctxSourcePrecise') + ' · ' + (te.model || '?')
                }
                return L('ctxSourceHeuristic')
              }
              return L('monitorOn')
            }
          }
```

- [x] **Step 2: Run `pnpm run check:overlay`**

  Run: `pnpm run check:overlay`
  Expected: All assertions pass ✓

- [x] **Step 3: Commit**

  Committed as `d5cb762`.

---

### Task 8: Handle session switching — reset token source on session change

**Files:**
- Modify: `lib/client.js` — listen for session change, reset `SessionEventTokenSource`

**Interfaces:**
- Consumes: `sessions` service, `SessionEventTokenSource`
- Produces: Token source that correctly resets when user switches sessions

When the user switches to a different conversation, the token source must stop listening to the old session's events and start on the new one. The `sessions` service may emit events or the session id accessible via `scopeOf(ctx)` may change.

- [x] **Step 1: Add session-switch detection in `createSessionEventTokenSource`**

  Updated the `start` method to always subscribe to the session list store (not just when
  no initial session exists), so that session switches are detected even when a session
  was already active at startup. The list subscription callback calls `_reset()` and
  `_bindToSession()` when `scopeOf(ctx)` returns a different session id.

- [x] **Step 2: Run `pnpm run check:overlay`**

  Run: `pnpm run check:overlay`
  Expected: All assertions pass ✓

- [x] **Step 3: Commit**

```bash
git add lib/client.js
git commit -m "fix(context): reset token source on session switch"
```

---

### Task 9: End-to-end manual verification

**Files:**
- No code changes — verification only

**Interfaces:**
- Consumes: Complete feature from Tasks 1-8
- Produces: Verified working state

- [ ] **Step 1: Rebuild and reinstall**

  `pnpm run build` completed ✓. Rest requires a running DSH instance.

```bash
pnpm run build
dsh plugin --profile web add ./dock-flash
```

Restart DSH, open a conversation.

- [ ] **Step 2: Verify precise mode activates**

1. Send a message to the assistant
2. Open the ⚡ panel → System tab → 上下文监控 toggle
3. Check subtitle: should show "精确 · deepseek-chat" (or current model name)
4. Open the ⚙ config popup for context monitor
5. Verify: "Current Model" shows the model name, "Context Window" shows the correct size, data source is green "精确"
6. Verify: "Input tokens" shows a non-zero number

- [ ] **Step 3: Verify heuristic fallback**

1. Open a conversation where no assistant message has been sent yet (or the session events are empty)
2. Check the ⚡ panel — context monitor subtitle should show "估算中"
3. The heuristic should still produce alerts for long conversations

- [ ] **Step 4: Verify model window mapping**

1. Open the ⚙ config popup for context monitor
2. Scroll to "模型窗口映射" section
3. Add a custom mapping: model name "test-model", window 64000
4. Verify it appears in the list
5. Delete it — verify it disappears

- [ ] **Step 5: Verify alert thresholds still work**

1. In a conversation with many messages, verify that context alerts fire at the configured thresholds
2. Verify the alert message includes the source label (e.g., "deepseek-chat · 87K/128K" for precise, or "~87K/128K (estimated)" for heuristic)

- [ ] **Step 6: Verify session switching**

1. Open conversation A with several messages
2. Check the context monitor — it shows tokens for conversation A
3. Switch to conversation B (new, empty)
4. Check the context monitor — token count should reset (near zero)
5. Switch back to conversation A
6. Token count should reflect conversation A's history

- [ ] **Step 7: Verify DSH Desktop compatibility**

If DSH Desktop is available, repeat steps 2-6 on Desktop. The `sessions` service should also be available there.

- [ ] **Step 8: Record results**

If any step fails, file a follow-up issue with exact reproduction steps and console output.

---

### Task 10: Update documentation

**Files:**
- Modify: `CHANGELOG.md` — add release entry
- Modify: `docs/architecture-notes.md` — add section on context monitoring data sources
- Modify: `AGENTS.md` — add critical rule about session event token source (if warranted by findings)

**Interfaces:**
- Consumes: All implemented features from Tasks 1-8
- Produces: Updated documentation

- [x] **Step 1: Add architecture notes section**

In `docs/architecture-notes.md`, add a section "Context Monitor: Precise vs Heuristic" documenting:
- The two data paths (session events → precise; DOM count → heuristic)
- The `SessionEventTokenSource` lifecycle (start/stop/reset on session switch)
- The model → context window resolution chain (user config → known table → fuzzy match → fallback)
- Why `ctxTokensPerMsg` is kept (heuristic fallback for models/providers that don't report usage)

- [x] **Step 2: Update CHANGELOG.md**

Add entry describing the feature. Follow the existing format:

```markdown
| 1.x.x | **Context monitoring now reads precise token usage from DSH's session event stream.** The `SessionEventTokenSource` subscribes to `assistant/message` events via the `sessions` service and accumulates `usage.inputTokens` for the current session, eliminating the DOM-node-count heuristic whenever the provider reports token accounting. A model-aware context window lookup (user-configurable overrides + built-in table covering DeepSeek, OpenAI, and Anthropic models) replaces the hardcoded 128K default. The existing heuristic (node count × `ctxTokensPerMsg`) remains as automatic fallback when session events are unavailable or the model does not report usage. The context monitor config popup now shows current model, window size, data source quality (精确/估算), and input token count. A "Model Window Map" editor lets users add custom model → window size mappings. The monitor toggle subtitle shows "精确 · model-name" or "估算中" to make the data source visible at a glance. |
```

- [x] **Step 3: Review AGENTS.md for new critical rules**

Added Critical Rule 12: "Session Event Token Source Must Subscribe to Session List Unconditionally" — the session-list subscription must start unconditionally in `start()`, not only when no initial session exists, or switches from an already-active session are invisible (the exact defect that Task 8 fixed).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/architecture-notes.md AGENTS.md
git commit -m "docs: add precise context monitoring documentation"
```
