# dsh-flash-mem-mon: Memory Monitor Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the memory monitoring subsystem from `dock-flash` into a standalone DSH plugin `dsh-flash-mem-mon`, following the identical two-half pattern already proven by `dsh-flash-net-mon`. The new plugin owns: the `MemoryTrendCollector` host-side ring buffer + GC observer + the `/memory-trend` route, and the client-side `createHostMemoryAlertProvider()` + memory-specific i18n + `MONITOR_SLIDER_FIELDS.memory` + the memory branch of `MonitorConfigModal` + the memory enable toggle. After extraction, `dock-flash` retains only the alert framework (registry + queue routes) and its own panel/proxy/skin code; the memory provider id and toggle key change from `dock-flash:*` to `dsh-flash-mem-mon:*` and the settings namespace moves from `dock-flash` to `dsh-flash-mem-mon`.

**Architecture:** Companion plugin pattern (identical to `dsh-flash-net-mon`). The host half (`src/index.ts` → tsc → `dist/index.js`) owns the `MemoryTrendCollector` singleton, 9 volatile config fields (4 RSS thresholds + 2 poll intervals + 3 GC thresholds), and one HTTP route (`GET /plugins/dsh-flash-mem-mon/memory-trend`). The client half (`lib/client.js`, single file, no build) owns its own i18n dictionary (zh/en), the alert provider (`dsh-flash-mem-mon:host-memory-alert`), the enable toggle (`dsh-flash-mem-mon:monitor-memory`), the `MonitorConfigModal` memory branch (live host memory fetch from `/plugins/dock-flash/health`, trend summary, sparkline, alert preview, GC event list), and 9 slider definitions. Registration goes through `ctx.get('quickControl')` (switches) and `ctx.get('dockFlashAlerts')` (alert provider), both provided by dock-flash — exactly like net-mon.

**Tech Stack:** TypeScript (host, tsc ESM) + no-build browser `lib/client.js` (single file, `require('react')`, `h = React.createElement`, loaded via `window.__ModuleLoader__.load()`). Cordis plugin contract (`name`/`inject`/`apply(ctx, config)`). `@deepseek-ai/schemastery` for Config schema. `perf_hooks` dynamic import for GC observer. No `prepare` script. `dist/` tracked in git.

**Spec:** This plan is the spec. Reference implementation: `/d/codes/learn/dsh-plugin/dsh-flash-net-mon/` (cloned, fully read). Source material: `dock-flash/src/index.ts` lines 565–823 + 239–250 + 362–370 + 834–848 + 1873–1910 (host); `dock-flash/lib/client.js` lines 359–435 + 628–704 (i18n), 4985–5148 (provider), 6839–6849 (sliders), 7152+ (modal memory branch), 8364 (companion prefixes), 11533–11552 (monitor toggles), 15363–15486 (system alerts cluster + per-monitor toggles) (client).

## Global Constraints

- **Host half is ESM, no `require`**: `src/index.ts` compiles via tsc to ESM. Any host dependency must be statically `import`-ed and declared in `package.json`. `perf_hooks` is loaded via dynamic `import()` (already proven in the `MemoryTrendCollector._startGcObserver` pattern).
- **`dist/` must be tracked in git**: No `prepare` script (would trigger pnpm ≥10 build allowance). Every `src/index.ts` change must be followed by `pnpm run build` and a commit of `dist/` in the same change.
- **`dsh.client.inject` uses base package names**: Never `<pkg>/client`. Must include `dock-flash` (load-order hint) and `@deepseek-ai/dsh-api-remotes` (for `ctx.remote.settings`).
- **Client half is single file, no build, no TS**: All changes directly to `lib/client.js`. Use `require('react')`, `h = React.createElement`, `window.__ModuleLoader__.load({ id, factory })`.
- **Settings namespace**: `dsh-flash-mem-mon` — own namespace, own `_memPrefs` mapping, never writes `dock-flash` namespace.
- **i18n**: Functional labels `label: () => t('key')`, `t()` reads `document.documentElement.lang`. Own `zh`/`en` dictionaries in the client file.
- **Route paths**: Change from `/plugins/dock-flash/memory-trend` to `/plugins/dsh-flash-mem-mon/memory-trend`.
- **Provider ID**: Changes from `dock-flash:host-memory-alert` to `dsh-flash-mem-mon:host-memory-alert`.
- **Toggle key**: Changes from `dock-flash:monitor-memory` to `dsh-flash-mem-mon:monitor-memory`.
- **Cross-plugin HTTP**: mem-mon's client still fetches `/plugins/dock-flash/health` for live host memory data (same as net-mon does for heartbeat). This is read-only and never changes.
- **`/clear-alerts` route stays in dock-flash**: It clears ALL alerts, not memory-specific.
- **`sendJson()`/`readJsonBody()` helpers**: Duplicated in mem-mon's host half (small utilities, ~20 lines each).
- **Self-check before commit**: `pnpm run build && pnpm run typecheck` (host) in the new plugin.
- **Release gates**: Never bump version or publish without maintainer confirmation (two gates per AGENTS.md).
- **Gitee is authoritative**: Push to Gitee, GitHub is a mirror.

---

### Task 1: Create `dsh-flash-mem-mon` package scaffold

**Files:**
- Create: `package.json`
- Create: `cordis.patch.yml`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts` (skeleton with empty apply)
- Create: `lib/client.js` (skeleton with empty factory)

**Interfaces:**
- Consumes: `ctx.get('quickControl')` and `ctx.get('dockFlashAlerts')` (provided by dock-flash at runtime); `ctx.remote.settings` for own namespace.
- Produces: Installable plugin `dsh-flash-mem-mon` with host entry `src/index.ts` (→ tsc → `dist/index.js`) and browser entry `lib/client.js`.

- [ ] **Step 1: Create `package.json`**

  Mirror `dsh-flash-net-mon/package.json` exactly, with these changes:
  - `name`: `"dsh-flash-mem-mon"`
  - `version`: `"0.1.0"`
  - `description`: `"Memory monitor provider for dock-flash — registers a host-memory-alert provider (RSS absolute, RSS growth rate, Major GC frequency) via ctx.get('dockFlashAlerts') and exposes /memory-trend for trend sparklines."`
  - `files`: `["dist", "lib", "cordis.patch.yml", "README.md", "README.zh-CN.md"]`
  - `dsh.client.inject`: `["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-api-remotes", "dock-flash", "dock-base"]`
  - `peerDependencies`: identical to net-mon (`cordis`, `dock-base` optional, `dock-flash >=1.6.0-0 <2.0.0-0`)
  - `dependencies`: `{ "@deepseek-ai/schemastery": "^3.18.4" }`
  - `devDependencies`: identical to net-mon
  - `scripts`: `"build": "tsc -p tsconfig.json"`, `"typecheck": "tsc -p tsconfig.json --noEmit"` — **no `prepare`**

- [ ] **Step 2: Create `cordis.patch.yml`**

  ```yaml
  # dsh-flash-mem-mon bundle layer — registers the HOST half into a profile.
  #
  # The BROWSER half needs no row here: the module loader auto-discovers the
  # client bundle from package.json `exports["./client"]` + `dsh.client` and
  # serves it at /plugins/<pkg>/client.js.
  - insert:
      - id: dsh-flash-mem-mon
        name: dsh-flash-mem-mon
  ```

- [ ] **Step 3: Create `tsconfig.json`**

  Identical to net-mon's tsconfig: `target: "es2022"`, `module: "esnext"`, `moduleResolution: "bundler"`, `outDir: "dist"`, `rootDir: "src"`, `verbatimModuleSyntax: true`, `noEmitOnError: true`.

- [ ] **Step 4: Create `.gitignore`**

  ```
  node_modules/
  ```

  (Do NOT ignore `dist/` — it must be tracked.)

- [ ] **Step 5: Create `src/index.ts` skeleton**

  ```ts
  import type { Context } from '@deepseek-ai/cordis'
  import type {} from '@deepseek-ai/dsh-settings'
  import type { Volatile } from '@deepseek-ai/cordis'
  import Schema from '@deepseek-ai/schemastery'

  export const name = 'dsh-flash-mem-mon'
  export const inject: string[] = []

  // ── Memory alert thresholds (RSS MB) and GC thresholds (major GC/min) ──
  const DEFAULT_MEM_THRESHOLD_INFO = 256
  const DEFAULT_MEM_THRESHOLD_WARNING = 512
  const DEFAULT_MEM_THRESHOLD_ERROR = 1024
  const DEFAULT_MEM_THRESHOLD_CRITICAL = 1536
  const DEFAULT_MEM_POLL_BASE = 30000
  const DEFAULT_MEM_POLL_MIN = 2000
  const DEFAULT_GC_THRESHOLD_INFO = 2
  const DEFAULT_GC_THRESHOLD_WARNING = 5
  const DEFAULT_GC_THRESHOLD_ERROR = 10

  export interface MemMonConfig {
    memThresholdInfo: Volatile<number>
    memThresholdWarning: Volatile<number>
    memThresholdError: Volatile<number>
    memThresholdCritical: Volatile<number>
    memPollBase: Volatile<number>
    memPollMin: Volatile<number>
    gcThresholdInfo: Volatile<number>
    gcThresholdWarning: Volatile<number>
    gcThresholdError: Volatile<number>
  }

  export const Config = Schema.object({
    memThresholdInfo: Schema.number().default(DEFAULT_MEM_THRESHOLD_INFO).volatile(),
    memThresholdWarning: Schema.number().default(DEFAULT_MEM_THRESHOLD_WARNING).volatile(),
    memThresholdError: Schema.number().default(DEFAULT_MEM_THRESHOLD_ERROR).volatile(),
    memThresholdCritical: Schema.number().default(DEFAULT_MEM_THRESHOLD_CRITICAL).volatile(),
    memPollBase: Schema.number().default(DEFAULT_MEM_POLL_BASE).volatile(),
    memPollMin: Schema.number().default(DEFAULT_MEM_POLL_MIN).volatile(),
    gcThresholdInfo: Schema.number().default(DEFAULT_GC_THRESHOLD_INFO).volatile(),
    gcThresholdWarning: Schema.number().default(DEFAULT_GC_THRESHOLD_WARNING).volatile(),
    gcThresholdError: Schema.number().default(DEFAULT_GC_THRESHOLD_ERROR).volatile(),
  })

  export function apply(ctx: Context, config: MemMonConfig) {
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    })
    // Task 2: MemoryTrendCollector bootstrap + /memory-trend route
  }
  ```

- [ ] **Step 6: Create `lib/client.js` skeleton**

  ```js
  // dsh-flash-mem-mon — Memory monitor client half
  // Single file, no build step. Loaded via window.__ModuleLoader__.
  var client = {
    apply: function (ctx) {
      // Task 3: register memory alert provider, enable toggle,
      // config modal, i18n, slider definitions
    },
    dispose: function () {},
  }
  var _exports = null
  try {
    _exports = (globalThis.__ModuleLoader__ || {}).load
      ? globalThis.__ModuleLoader__.load({ id: 'dsh-flash-mem-mon/client', factory: function () { return client } })
      : client
  } catch (_) { _exports = client }
  export default _exports
  ```

- [ ] **Step 7: Install dependencies and verify typecheck**

  ```bash
  cd /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  pnpm install
  pnpm run typecheck
  ```
  Expected: PASS (skeleton has no type errors).

- [ ] **Step 8: Commit scaffold**

  ```bash
  git add -A
  git commit -m "chore(mem-mon): scaffold dsh-flash-mem-mon plugin package"
  ```

---

### Task 2: Migrate host-side memory logic into `dsh-flash-mem-mon`

**Files:**
- Modify: `dsh-flash-mem-mon/src/index.ts` (fill in MemoryTrendCollector + route + bootstrap)
- Modify: `dsh-flash-mem-mon/dist/index.js` (built output, tracked)

**Interfaces:**
- Consumes: `MemMonConfig` (9 volatile fields from own namespace); `ctx.inject(['webServer'])` for route registration; `ctx.inject(['settings'])` for namespace setup.
- Produces: Self-contained `MemoryTrendCollector` (module-private, not exported), `GET /plugins/dsh-flash-mem-mon/memory-trend` route (mode=summary|full, since param), `sendJson()`/`readJsonBody()` helpers (duplicated from dock-flash).

**Source boundary (dock-flash/src/index.ts):**
- Lines 574–581: `MemorySample` interface → copy
- Lines 583–594: `GcStats` interface → copy
- Lines 596–610: `MemoryTrendSummary` interface → copy
- Lines 612–820: `MemoryTrendCollector` class → copy (make module-private, remove `export`)
- Line 823: `let _memoryTrend: MemoryTrendCollector | null = null` → copy
- Lines 837–848: Bootstrap `_memoryTrend.start(…)` + dispose → adapt into apply()
- Lines ~820–846: `sendJson()`/`readJsonBody()` helpers → copy (small utilities)
- Lines 1873–1910: `GET /plugins/dock-flash/memory-trend` route → adapt path to `/plugins/dsh-flash-mem-mon/memory-trend`

- [ ] **Step 1: Copy interfaces and MemoryTrendCollector**

  Copy `MemorySample`, `GcStats`, `MemoryTrendSummary` interfaces and the full `MemoryTrendCollector` class from dock-flash/src/index.ts lines 574–820 into `dsh-flash-mem-mon/src/index.ts`, placing them above the `apply()` function. Remove any `export` keywords (these are module-private). The `_startGcObserver` method already uses `import('perf_hooks')` which works correctly in ESM.

- [ ] **Step 2: Copy sendJson/readJsonBody helpers**

  Copy the `sendJson()` and `readJsonBody()` utility functions from dock-flash/src/index.ts into mem-mon's src/index.ts. These are small (~20 lines each) and must be duplicated — they are not worth a shared package.

- [ ] **Step 3: Add module-level singleton and bootstrap in apply()**

  Add `let _memoryTrend: MemoryTrendCollector | null = null` at module level. In `apply()`, after the settings configuration block, add the bootstrap:

  ```ts
  // ── Memory trend collector bootstrap ──────────────────────────────────
  if (!_memoryTrend) _memoryTrend = new MemoryTrendCollector()
  _memoryTrend.start(
    (config.memPollBase?.get?.() ?? config.memPollBase) as number || DEFAULT_MEM_POLL_BASE,
    (config.memPollMin?.get?.()  ?? config.memPollMin)  as number || DEFAULT_MEM_POLL_MIN,
  )
  ctx.effect(() => {
    const collector = _memoryTrend
    return () => {
      collector?.stop()
      _memoryTrend = null
    }
  })
  ```

  Also add a `loader/volatile-update` listener to restart the collector when poll intervals change:

  ```ts
  ctx.on('loader/volatile-update' as any, (paths: string[][]) => {
    const memPaths = ['memPollBase', 'memPollMin']
    if (!paths.some((pp) => pp.length && memPaths.includes(pp[pp.length - 1]))) return
    if (_memoryTrend) {
      _memoryTrend.stop()
      _memoryTrend.start(
        (config.memPollBase?.get?.() ?? config.memPollBase) as number || DEFAULT_MEM_POLL_BASE,
        (config.memPollMin?.get?.()  ?? config.memPollMin)  as number || DEFAULT_MEM_POLL_MIN,
      )
    }
  })
  ```

- [ ] **Step 4: Add the /memory-trend route**

  Inside `apply()`, register the route in a `ctx.inject(['webServer'])` block:

  ```ts
  ctx.inject(['webServer'], (wsCtx) => {
    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-flash-mem-mon/memory-trend',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }
        if (!_memoryTrend) {
          sendJson(res, 200, { samples: [], summary: null })
          return
        }
        const u = new URL(req.url || '/', 'http://localhost')
        const since = parseInt(u.searchParams.get('since') || '0', 10) || 0
        const mode = u.searchParams.get('mode') || 'summary'
        if (mode === 'full') {
          const gcSince = since > 0 ? since : 0
          const allGcEvents = _memoryTrend.gcEvents(gcSince)
          const majorGcEvents = allGcEvents.filter(e => e.kind === 2)
          sendJson(res, 200, {
            samples: _memoryTrend.query(since || undefined),
            gcEvents: majorGcEvents,
          })
        } else {
          sendJson(res, 200, _memoryTrend.summary(since || undefined))
        }
      },
    }), 'dsh-flash-mem-mon: GET /plugins/dsh-flash-mem-mon/memory-trend')
  })
  ```

  Add the `IncomingMessage`/`ServerResponse` type imports at the top:

  ```ts
  import type { IncomingMessage, ServerResponse } from 'node:http'
  ```

- [ ] **Step 5: Build and verify**

  ```bash
  cd /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  pnpm run build
  pnpm run typecheck
  ```
  Expected: `dist/index.js` produced (tracked in git), no type errors.

- [ ] **Step 6: Commit**

  ```bash
  git add src/index.ts dist/index.js
  git commit -m "feat(mem-mon): host-side MemoryTrendCollector and /memory-trend route"
  ```

---

### Task 3: Migrate client-side memory logic into `dsh-flash-mem-mon/lib/client.js`

**Files:**
- Modify: `dsh-flash-mem-mon/lib/client.js` (full client implementation)

**Interfaces:**
- Consumes: `ctx.get('quickControl')` (register switch), `ctx.get('dockFlashAlerts')` (register provider), `ctx.remote.settings` (read/write `dsh-flash-mem-mon` namespace), `/plugins/dsh-flash-mem-mon/memory-trend` (own route), `/plugins/dock-flash/health` (cross-plugin, read-only, for live host memory in config modal).
- Produces: Provider `dsh-flash-mem-mon:host-memory-alert`, toggle `dsh-flash-mem-mon:monitor-memory`, memory config modal with sparkline + live data + GC events + alert preview, own i18n (zh/en), own `_memPrefs` preference system.

**Source boundary (dock-flash/lib/client.js):**
- Lines 359–435: zh i18n memory keys → copy (subset of memory keys only)
- Lines 628–704: en i18n memory keys → copy (subset of memory keys only)
- Lines 4985–5148: `createHostMemoryAlertProvider()` → copy, change provider id to `dsh-flash-mem-mon:host-memory-alert`, change route path to `/plugins/dsh-flash-mem-mon/memory-trend`
- Lines 6839–6849: `MONITOR_SLIDER_FIELDS.memory` → copy
- Lines 7152+: `MonitorConfigModal` memory branch → create own `MonitorConfigModal` with memory-only branch
- Lines 11533–11552: `_MONITOR_TOGGLES` memory entry → implement as `dsh-flash-mem-mon:monitor-memory` toggle with provider `dsh-flash-mem-mon:host-memory-alert`

- [ ] **Step 1: Build the i18n dictionaries**

  Extract all memory-related keys from dock-flash's zh/en dictionaries. The keys to copy:

  **Alert cluster / monitor toggles:**
  - `alertMemCluster`, `monitorOn`, `monitorOff`, `monitorConfig`

  **RSS thresholds:**
  - `memConfigGroupRss`, `memConfigGroupGc`
  - `memThresholdInfo`/`memThresholdInfoTip`, `memThresholdWarning`/`memThresholdWarningTip`, `memThresholdError`/`memThresholdErrorTip`, `memThresholdCritical`/`memThresholdCriticalTip`
  - `memPollBase`/`memPollBaseTip`, `memPollMin`/`memPollMinTip`

  **GC thresholds:**
  - `gcThresholdInfo`/`gcThresholdInfoTip`, `gcThresholdWarning`/`gcThresholdWarningTip`, `gcThresholdError`/`gcThresholdErrorTip`

  **Alert preview:**
  - `alertPreviewTitle`, `alertPreviewToggle`, `alertPreviewCollapse`
  - `alertPreviewCriteriaRss`, `alertPreviewCriteriaGrowth`, `alertPreviewCriteriaGc`
  - `alertPreviewTrigger`

  **Live memory data:**
  - `memLiveData`, `memHostSection`, `memHostRSS`, `memHostHeapTotal`, `memHostHeapUsed`, `memHostExternal`, `memHostArrayBuffers`, `memHostHeapRatio`, `memHostUnavailable`

  **GC stats:**
  - `memGcMajorPerMin`, `memGcPausePerMin`, `memGcMinorCount`, `memGcMajorCount`, `memGcUnavailable`
  - `memGcEventList`, `memGcEventDuration`, `memGcEventTime`, `memGcEventClick`, `memGcNoEvents`, `memGcEventRssDrop`

  **Memory trend:**
  - `memTrend`, `memTrendPeak`, `memTrendDirection`, `memTrendUp`, `memTrendStable`, `memTrendDown`
  - `memTrendSamples`, `memTrendSpan`, `memTrendHeapRatio`, `memTrendNoData`
  - `memTrendHoverHeap`, `memTrendHoverRSS`, `memTrendHoverTime`
  - `memTrendGrowthRate`, `memTrendAxisHeap`, `memTrendAxisTime`

  **Alert severity (needed by provider):**
  - `alertHostMemInfo`, `alertHostMemWarning`, `alertHostMemError`, `alertHostMemCritical`, `alertHostMemGrowth`
  - `alertHostGcInfo`, `alertHostGcWarning`, `alertHostGcError`
  - `alertSevInfo`, `alertSevWarning`, `alertSevError`, `alertSevCritical`

  Build the `t()` function reading `document.documentElement.lang` with a `MutationObserver` on `<html lang>` (same pattern as net-mon).

- [ ] **Step 2: Implement `_memPrefs` preference system**

  Create a lightweight preference system mirroring net-mon's `_netPrefs` pattern:

  ```js
  var _MEM_ALERT_DEFAULTS = {
    memThresholdInfo: 256,
    memThresholdWarning: 512,
    memThresholdError: 1024,
    memThresholdCritical: 1536,
    memPollBase: 30000,
    memPollMin: 2000,
    gcThresholdInfo: 2,
    gcThresholdWarning: 5,
    gcThresholdError: 10,
  }
  var _memPrefs = Object.assign({}, _MEM_ALERT_DEFAULTS)

  function _loadMemPrefs(ctx) {
    // Read from ctx.remote.settings('dsh-flash-mem-mon'), fallback to localStorage
    // then to _MEM_ALERT_DEFAULTS. Populate _memPrefs.
  }

  function _saveMemPref(ctx, key, value) {
    _memPrefs[key] = value
    // Write through ctx.remote.settings.update('dsh-flash-mem-mon', { [key]: value })
    // localStorage cache as fallback
  }

  function _alertPref(key) {
    return _memPrefs[key] ?? _MEM_ALERT_DEFAULTS[key]
  }
  ```

- [ ] **Step 3: Implement `createHostMemoryAlertProvider()`**

  Copy from dock-flash/lib/client.js lines 4985–5148 with these changes:
  - Route path: `/plugins/dsh-flash-mem-mon/memory-trend?mode=summary` (instead of `/plugins/dock-flash/memory-trend`)
  - Provider id: `'dsh-flash-mem-mon:host-memory-alert'` (instead of `'dock-flash:host-memory-alert'`)
  - Use `_alertPref()` from the local preference system (same keys)
  - All three alert criteria migrate together: RSS absolute (4 severity levels), RSS growth rate (info), Major GC frequency (3 levels)

- [ ] **Step 4: Implement the memory enable toggle and provider registration**

  Register via `ctx.get('quickControl')` and `ctx.get('dockFlashAlerts')` with retry polling (up to 15 retries × 200ms, same as net-mon):

  ```js
  var TOGGLE_KEY = 'dsh-flash-mem-mon:monitor-memory'
  var PROVIDER_ID = 'dsh-flash-mem-mon:host-memory-alert'
  ```

  Toggle registration:
  - `id`: `TOGGLE_KEY`
  - `label`: `() => t('alertMemCluster')`
  - `icon`: `'chip'`
  - `type`: `'toggle'`
  - `group`: `'system'`
  - `cluster`: `'system-alerts'`
  - `order`: `58` (same as in dock-flash, maintaining position)
  - `visible`: `() => _getAlertsOn()` (read from `dock-flash:system-alerts` localStorage — the master toggle)
  - `config`: `() => openMonitorConfig('memory')`
  - `getValue`/`setValue`: persist to `TOGGLE_KEY` localStorage + `alertRegistry.setProviderEnabled(PROVIDER_ID, on)`

  Apply persisted gate before registry auto-starts (same pattern as dock-flash's `_MONITOR_TOGGLES`).

  Also register `TOGGLE_KEY` in dock-flash's `_alertsDependentIds` list (Task 5 Step 2).

- [ ] **Step 5: Implement MONITOR_SLIDER_FIELDS.memory**

  Copy the 9 slider definitions from dock-flash/lib/client.js lines 6839–6849 exactly:

  ```js
  var MONITOR_SLIDER_FIELDS = {
    memory: [
      { key: 'memThresholdInfo',    labelKey: 'memThresholdInfo',    tooltipKey: 'memThresholdInfoTip',    group: 'rss', min: 64,    max: 1024,  step: 64,   format: function (v) { return v + ' MB' } },
      { key: 'memThresholdWarning', labelKey: 'memThresholdWarning', tooltipKey: 'memThresholdWarningTip', group: 'rss', min: 128,   max: 1536,  step: 64,   format: function (v) { return v + ' MB' } },
      { key: 'memThresholdError',   labelKey: 'memThresholdError',   tooltipKey: 'memThresholdErrorTip',   group: 'rss', min: 256,   max: 1792,  step: 64,   format: function (v) { return v + ' MB' } },
      { key: 'memThresholdCritical',labelKey: 'memThresholdCritical',tooltipKey: 'memThresholdCriticalTip',group: 'rss', min: 512,   max: 2048,  step: 64,   format: function (v) { return v + ' MB' } },
      { key: 'memPollBase',         labelKey: 'memPollBase',         tooltipKey: 'memPollBaseTip',         group: 'rss', min: 5000,  max: 60000, step: 1000, format: function (v) { return v + 'ms' } },
      { key: 'memPollMin',          labelKey: 'memPollMin',          tooltipKey: 'memPollMinTip',          group: 'rss', min: 1000,  max: 10000, step: 500,  format: function (v) { return v + 'ms' } },
      { key: 'gcThresholdInfo',     labelKey: 'gcThresholdInfo',     tooltipKey: 'gcThresholdInfoTip',     group: 'gc',  min: 1,     max: 5,     step: 1,    format: function (v) { return v + '/min' } },
      { key: 'gcThresholdWarning',  labelKey: 'gcThresholdWarning',  tooltipKey: 'gcThresholdWarningTip',  group: 'gc',  min: 2,     max: 8,     step: 1,    format: function (v) { return v + '/min' } },
      { key: 'gcThresholdError',    labelKey: 'gcThresholdError',    tooltipKey: 'gcThresholdErrorTip',    group: 'gc',  min: 4,     max: 15,    step: 1,    format: function (v) { return v + '/min' } },
    ],
  }
  ```

- [ ] **Step 6: Implement MonitorConfigModal (memory-only)**

  Create a standalone `MonitorConfigModal` component that handles only the memory branch. This mirrors what net-mon does for its own config modal. The modal:

  1. **Live host memory section**: Fetches `/plugins/dock-flash/health` (cross-plugin, read-only) to display current RSS, heapTotal, heapUsed, external, arrayBuffers, heapRatio
  2. **Trend summary section**: Fetches `/plugins/dsh-flash-mem-mon/memory-trend?mode=summary` for peak, trend direction, sample count, span, heap ratio, RSS growth rate
  3. **Sparkline**: Renders a mini chart from `/plugins/dsh-flash-mem-mon/memory-trend?mode=full&since=…` data
  4. **GC event list**: From the full-mode response, render major GC events with timestamps and durations
  5. **Alert preview**: Shows sample alert messages for each criterion (RSS absolute, RSS growth, GC frequency) based on current threshold settings
  6. **Threshold sliders**: Renders the 9 sliders from `MONITOR_SLIDER_FIELDS.memory`, each reading/writing through `_memPrefs` / `_saveMemPref()`

  Use `require('react')` + `h = React.createElement` (no JSX). Mount on `document.body` via `require('react-dom/client').createRoot`, same as net-mon's modal.

- [ ] **Step 7: Wire everything in apply()**

  In the `apply(ctx)` function:

  1. Load `_memPrefs` from settings
  2. Retry-poll for `ctx.get('quickControl')` and `ctx.get('dockFlashAlerts')` (up to 15 × 200ms)
  3. Register the alert provider via `alertRegistry.registerProvider(createHostMemoryAlertProvider())`
  4. Register the enable toggle via `registry.registerSwitch(…)`
  5. Apply the persisted toggle gate before registry auto-starts

  Use `ctx.effect()` for disposal: stop provider, unregister switch.

- [ ] **Step 8: Manual verification**

  Install both dock-flash and dsh-flash-mem-mon into a test profile:
  ```bash
  dsh plugin --profile web add /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  ```
  Refresh the page and verify:
  - Memory toggle appears in the ⚡ panel under System > system-alerts cluster
  - Toggling it ON/OFF enables/disables the `dsh-flash-mem-mon:host-memory-alert` provider
  - Config modal opens, shows live host memory data, trend sparkline, GC events, alert preview, and threshold sliders
  - Changing a slider writes to `dsh-flash-mem-mon` settings namespace (not `dock-flash`)
  - Alert provider polls `/plugins/dsh-flash-mem-mon/memory-trend?mode=summary` and emits alerts at correct thresholds

- [ ] **Step 9: Commit**

  ```bash
  git add lib/client.js
  git commit -m "feat(mem-mon): client-side memory alert provider, toggle, config modal, and i18n"
  ```

---

### Task 4: Remove memory code from `dock-flash`

**Files:**
- Modify: `dock-flash/src/index.ts` (remove MemoryTrendCollector, interfaces, route, config fields, defaults, bootstrap, volatile-update handler)
- Modify: `dock-flash/lib/client.js` (remove createHostMemoryAlertProvider, memory i18n keys, MONITOR_SLIDER_FIELDS.memory, MonitorConfigModal memory branch, _MONITOR_TOGGLES memory entry, memory toggle registration)
- Modify: `dock-flash/dist/index.js` (rebuilt after src changes)

**Interfaces:**
- Consumes: Task 2/3 completed; mem-mon plugin self-contained.
- Produces: dock-flash without any memory-specific code; alert framework (registry + queue routes) intact.

- [ ] **Step 1: Remove host-side memory code from `dock-flash/src/index.ts`**

  Delete:
  - Lines 574–581: `MemorySample` interface
  - Lines 583–594: `GcStats` interface
  - Lines 596–610: `MemoryTrendSummary` interface
  - Lines 612–820: `MemoryTrendCollector` class
  - Line 823: `let _memoryTrend: MemoryTrendCollector | null = null`
  - Lines 834–848: Memory trend collector bootstrap + dispose
  - Lines 239–250: `DEFAULT_MEM_THRESHOLD_*` and `DEFAULT_GC_THRESHOLD_*` constants
  - Lines 134–152: Memory/GC fields from `ProxyConfig` interface (`memThresholdInfo` through `gcThresholdError`)
  - Lines 362–370: Memory/GC fields from `Config` Schema
  - Lines 1873–1910: `GET /plugins/dock-flash/memory-trend` route
  - The `loader/volatile-update` handler for mem fields (if it exists as a separate block; verify)

  **Keep:**
  - `sendJson()`/`readJsonBody()` helpers (still used by other routes)
  - `/health` route (used by mem-mon's client for live data)
  - `/push-alert`, `/host-alerts`, `/clear-alerts` routes (alert framework)
  - All proxy, skin, panel code
  - Context monitor code (that's for `dsh-flash-ctx-mon`, not this extraction)

- [ ] **Step 2: Remove client-side memory code from `dock-flash/lib/client.js`**

  Delete:
  - `createHostMemoryAlertProvider()` function (lines ~4985–5148)
  - `MONITOR_SLIDER_FIELDS.memory` array (lines 6839–6849) — keep `.context` array
  - Memory i18n keys from both zh and en dictionaries (lines 359–435 zh, 628–704 en)
  - Memory alert severity i18n keys (`alertHostMem*`, `alertHostGc*`) — but keep `alertSev*` as they may be shared
  - MonitorConfigModal: remove the `if (monitor !== 'memory') return` branch and all memory-specific rendering code. Keep the context branch.
  - `_MONITOR_TOGGLES` memory entry: change from `{ memory: { key: 'dock-flash:monitor-memory', providers: ['dock-flash:host-memory-alert'] }, context: … }` to just `{ context: … }`. Remove `_MONITOR_DEFAULT.memory`.
  - Per-monitor toggles array: remove the `{ monitor: 'memory', … }` entry from `_monitorEntries` (line ~15459)
  - `_alertsDependentIds`: remove `'dock-flash:monitor-memory'` (line ~15365) — will add `'dsh-flash-mem-mon:monitor-memory'` in Task 5
  - `_hostPrefs` mapping: remove all memory threshold fields (`memThresholdInfo` etc., `gcThresholdInfo` etc., `memPollBase`, `memPollMin`)

  **Keep:**
  - `alertMemCluster` i18n key in dock-flash's dictionaries — the companion plugin now owns the label, but dock-flash's `_COMPANION_PREFIXES` routing means the toggle appears in the built-in tab, so dock-flash doesn't need the key itself. However, if any other code references it, keep a stub. Verify by grepping.
  - `_COMPANION_PREFIXES` — will be updated in Task 5
  - Context monitor code (untouched)

- [ ] **Step 3: Rebuild dock-flash**

  ```bash
  cd /d/codes/learn/dsh-plugin/dock-flash
  pnpm run build
  pnpm run typecheck
  ```
  Expected: Build passes with memory code removed. `dist/index.js` updated.

- [ ] **Step 4: Commit**

  ```bash
  git add src/index.ts lib/client.js dist/index.js
  git commit -m "refactor(dock-flash): remove memory monitor code (now in dsh-flash-mem-mon)"
  ```

---

### Task 5: Update `dock-flash` companion integration

**Files:**
- Modify: `dock-flash/lib/client.js` (add `dsh-flash-mem-mon:` to `_COMPANION_PREFIXES`, add `dsh-flash-mem-mon:monitor-memory` to `_alertsDependentIds`)

**Interfaces:**
- Consumes: Task 4 completed; mem-mon plugin registers its own switches and providers.
- Produces: dock-flash recognizes mem-mon switches as "built-in" for tab routing; system-alerts master toggle correctly notifies mem-mon's enable toggle.

- [ ] **Step 1: Add mem-mon to `_COMPANION_PREFIXES`**

  In `dock-flash/lib/client.js`, change:
  ```js
  var _COMPANION_PREFIXES = ['dsh-flash-net-mon:']
  ```
  to:
  ```js
  var _COMPANION_PREFIXES = ['dsh-flash-net-mon:', 'dsh-flash-mem-mon:']
  ```

  This ensures mem-mon's switches (toggle id `dsh-flash-mem-mon:monitor-memory`) appear in the ⚡ Workbench built-in tab alongside dock-flash's own switches, just like net-mon's do.

- [ ] **Step 2: Add mem-mon toggle to `_alertsDependentIds`**

  In the system-alerts toggle's `setValue` handler, add `'dsh-flash-mem-mon:monitor-memory'` to the `_alertsDependentIds` array so that toggling the master system-alerts switch on/off also re-renders mem-mon's memory toggle (which has `visible: () => _getAlertsOn()`):

  ```js
  var _alertsDependentIds = [
    'dock-flash:alert-toast',
    'dsh-flash-mem-mon:monitor-memory',    // ← ADD
    'dock-flash:monitor-context',
    'dsh-flash-net-mon:monitor-network',
    'dock-flash:host-alert-queue-cap',
    'dock-flash:host-alert-max-age',
  ]
  ```

- [ ] **Step 3: Verify build**

  ```bash
  cd /d/codes/learn/dsh-plugin/dock-flash
  pnpm run build
  pnpm run typecheck
  ```
  Expected: PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add lib/client.js
  git commit -m "feat(dock-flash): add dsh-flash-mem-mon to companion prefixes and alerts dependency list"
  ```

---

### Task 6: Cross-plugin integration verification

**Files:**
- No file changes. Verification only.

**Interfaces:**
- Consumes: All prior tasks completed.
- Produces: Verified integration between dock-flash and dsh-flash-mem-mon.

- [ ] **Step 1: Route isolation grep**

  ```bash
  grep -rn "memory-trend" /d/codes/learn/dsh-plugin/dsh-flash-mem-mon/ /d/codes/learn/dsh-plugin/dock-flash/
  ```
  Expected: `/memory-trend` route path appears only in `dsh-flash-mem-mon/src/index.ts` and `dsh-flash-mem-mon/lib/client.js`. NOT in dock-flash (it was removed in Task 4). The client polls `/plugins/dsh-flash-mem-mon/memory-trend`, not `/plugins/dock-flash/memory-trend`.

  ```bash
  grep -rn "/plugins/dock-flash/health" /d/codes/learn/dsh-plugin/dsh-flash-mem-mon/
  ```
  Expected: mem-mon's client fetches `/plugins/dock-flash/health` for live host memory (cross-plugin, read-only). This is the only cross-plugin HTTP dependency, matching net-mon's pattern.

- [ ] **Step 2: Settings namespace isolation**

  ```bash
  grep -n "settings.update" /d/codes/learn/dsh-plugin/dsh-flash-mem-mon/lib/client.js
  ```
  Expected: Only writes to `dsh-flash-mem-mon` namespace, never `dock-flash`.

  ```bash
  grep -n "settings.update" /d/codes/learn/dsh-plugin/dock-flash/lib/client.js
  ```
  Expected: Only writes to `dock-flash` namespace, never `dsh-flash-mem-mon`.

- [ ] **Step 3: Provider/toggle ID isolation**

  ```bash
  grep -rn "dock-flash:host-memory-alert\|dock-flash:monitor-memory" /d/codes/learn/dsh-plugin/dsh-flash-mem-mon/
  grep -rn "dock-flash:host-memory-alert\|dock-flash:monitor-memory" /d/codes/learn/dsh-plugin/dock-flash/
  ```
  Expected: Old IDs (`dock-flash:host-memory-alert`, `dock-flash:monitor-memory`) do NOT appear anywhere. New IDs (`dsh-flash-mem-mon:host-memory-alert`, `dsh-flash-mem-mon:monitor-memory`) appear only in mem-mon.

- [ ] **Step 4: Lifecycle independence**

  Test that disabling `dsh-flash-mem-mon` does not affect dock-flash:
  - Disable mem-mon via plugin manager
  - Verify: dock-flash panel loads, proxy works, skin switcher works, context monitor works, system-alerts toggle works
  - Verify: no `MemoryTrendCollector` timer running (no `/memory-trend` route registered)
  - Re-enable mem-mon
  - Verify: memory toggle appears, provider registers, config modal works

- [ ] **Step 5: Verify `_COMPANION_PREFIXES` routing**

  With both dock-flash and dsh-flash-mem-mon enabled:
  - Open ⚡ panel
  - Verify: `dsh-flash-mem-mon:monitor-memory` toggle appears in the ⚡ Workbench (built-in) tab, NOT the 🧩 Extensions tab
  - This confirms `_COMPANION_PREFIXES` is working correctly

- [ ] **Step 6: Verify master toggle interaction**

  - Toggle system-alerts OFF → memory toggle disappears
  - Toggle system-alerts ON → memory toggle reappears
  - This confirms `_alertsDependentIds` notification is working

---

## Verification Summary

| # | Verification | Where |
|---|---|---|
| 1 | Route isolation: `/memory-trend` only in mem-mon | Task 6 Step 1 |
| 2 | Settings namespace isolation: each plugin writes own namespace only | Task 6 Step 2 |
| 3 | Provider/toggle ID isolation: old IDs removed, new IDs only in mem-mon | Task 6 Step 3 |
| 4 | Lifecycle independence: disabling mem-mon doesn't break dock-flash | Task 6 Step 4 |
| 5 | Companion routing: mem-mon switches appear in built-in tab | Task 6 Step 5 |
| 6 | Master toggle: system-alerts ON/OFF controls mem-mon toggle visibility | Task 6 Step 6 |

## Out of Scope

- **Context monitor extraction** (`dsh-flash-ctx-mon`): Separate effort, same pattern. Not touched by this plan.
- **`_MONITOR_TOGGLES` cleanup in dock-flash**: The `memory` entry is removed in Task 4 Step 2; the `context` entry stays until ctx-mon is extracted.
- **MonitorConfigModal refactoring in dock-flash**: The modal loses its memory branch but retains context. A future ctx-mon extraction would remove it entirely from dock-flash.
- **Version bumps or publishing**: Subject to the two-gate release policy in AGENTS.md.
- **README/CHANGELOG for mem-mon**: Created as part of the repo setup but content is lightweight until first release.
