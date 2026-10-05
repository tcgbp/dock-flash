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

- [x] **Step 1: Create `package.json`**

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

- [x] **Step 2: Create `cordis.patch.yml`**

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

- [x] **Step 3: Create `tsconfig.json`**

  Identical to net-mon's tsconfig: `target: "es2022"`, `module: "esnext"`, `moduleResolution: "bundler"`, `outDir: "dist"`, `rootDir: "src"`, `verbatimModuleSyntax: true`, `noEmitOnError: true`.

- [x] **Step 4: Create `.gitignore`**

  ```
  node_modules/
  ```

  (Do NOT ignore `dist/` — it must be tracked.)

- [x] **Step 5: Create `src/index.ts` skeleton**

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

- [x] **Step 6: Create `lib/client.js` skeleton**

  ```js
  // dsh-flash-mem-mon — Memory monitor client half
  // Single file, no build step. Loaded via window.__ModuleLoader__.
  var client = {
    apply: function (ctx) {
      // Task 3a: i18n, preference system, CSS, sliders
      // Task 3b: alert provider, enable toggle, apply() wiring
      // Task 3c: MonitorConfigModal (sparkline, GC events, alert preview)
      // Task 3d: integration verification
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

- [x] **Step 7: Install dependencies and verify typecheck**

  ```bash
  cd /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  pnpm install
  pnpm run typecheck
  ```
  Expected: PASS (skeleton has no type errors).

- [x] **Step 8: Commit scaffold**

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

- [x] **Step 1: Copy interfaces and MemoryTrendCollector**

  Copy `MemorySample`, `GcStats`, `MemoryTrendSummary` interfaces and the full `MemoryTrendCollector` class from dock-flash/src/index.ts lines 574–820 into `dsh-flash-mem-mon/src/index.ts`, placing them above the `apply()` function. Remove any `export` keywords (these are module-private). The `_startGcObserver` method already uses `import('perf_hooks')` which works correctly in ESM.

- [x] **Step 2: Copy sendJson/readJsonBody helpers**

  Copy the `sendJson()` and `readJsonBody()` utility functions from dock-flash/src/index.ts into mem-mon's src/index.ts. These are small (~20 lines each) and must be duplicated — they are not worth a shared package.

- [x] **Step 3: Add module-level singleton and bootstrap in apply()**

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

- [x] **Step 4: Add the /memory-trend route**

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

- [x] **Step 5: Build and verify**

  ```bash
  cd /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  pnpm run build
  pnpm run typecheck
  ```
  Expected: `dist/index.js` produced (tracked in git), no type errors.

- [x] **Step 6: Commit**

  ```bash
  git add src/index.ts dist/index.js
  git commit -m "feat(mem-mon): host-side MemoryTrendCollector and /memory-trend route"
  ```

---

### Task 3: Migrate client-side memory logic into `dsh-flash-mem-mon/lib/client.js`

> **Context-window budget note.** The original 9-step monolith required reading
> ~74 KB of source from `dock-flash/lib/client.js` (12+ scattered sections)
> plus ~84 KB of the net-mon reference, then writing ~84 KB of new code —
> peak ~95 K tokens, which overflows a 128 K window by turn 3–4. The fix: split
> into four sub-tasks (3a–3d), each with its own commit and bounded reads.
> Each sub-task peaks at ≤60 K tokens, leaving ≥65 K headroom.

**Overall interfaces (unchanged from original plan):**
- Consumes: `ctx.get('quickControl')` (register switch), `ctx.get('dockFlashAlerts')` (register provider), `ctx.remote.settings` (read/write `dsh-flash-mem-mon` namespace), `/plugins/dsh-flash-mem-mon/memory-trend` (own route), `/plugins/dock-flash/health` (cross-plugin, read-only, for live host memory in config modal).
- Produces: Provider `dsh-flash-mem-mon:host-memory-alert`, toggle `dsh-flash-mem-mon:monitor-memory`, memory config modal with sparkline + live data + GC events + alert preview, own i18n (zh/en), own `_memPrefs` preference system.

**Source boundary (dock-flash/lib/client.js) — all sections, for reference:**
- Lines 359–435: zh i18n memory keys → copy (subset of memory keys only)
- Lines 628–704: en i18n memory keys → copy (subset of memory keys only)
- Lines 2002–2293: Memory CSS style objects → copy
- Lines 4396–4435: `_alertPref()` / `_writeAlertPref()` → adapt to `_memPrefs`
- Lines 4985–5148: `createHostMemoryAlertProvider()` → copy, re-id
- Lines 6839–6849: `MONITOR_SLIDER_FIELDS.memory` → copy
- Lines 7152–7962: `MonitorConfigModal` memory branch → own modal
- Lines 11533–11552: `_MONITOR_TOGGLES` memory entry → own toggle

---

#### Task 3a: i18n + preference system + CSS styles + slider definitions

**Files:**
- Modify: `dsh-flash-mem-mon/lib/client.js`

**Read budget:** Only `dsh-flash-net-mon/lib/client.js` (full file, ~84 KB) as the
structural template. Extract i18n keys, preference system, CSS styles, and slider
definitions by **adapting the net-mon pattern** — swap network keys/values for
memory equivalents. Do NOT read `dock-flash/lib/client.js` in this sub-task; the
net-mon file already encodes every structural decision.

**Interfaces:**
- Produces: `t()` function, zh/en dictionaries, `_MEM_ALERT_DEFAULTS`, `_memPrefs`,
  `_loadMemPrefs()`, `_saveMemPref()`, `_alertPref()`, CSS `S` object (memory-specific
  keys), `MONITOR_SLIDER_FIELDS.memory`.

- [ ] **Step 1: Generate i18n + preference + CSS + slider skeleton from net-mon template**

  Read `dsh-flash-net-mon/lib/client.js` in full. Using it as the structural
  template, write the corresponding sections of `dsh-flash-mem-mon/lib/client.js`:

  1. **Module wrapper** — identical pattern (`window.__ModuleLoader__.load({ id, factory })`),
     same React/dotenv imports.

  2. **i18n dictionaries** — Replace net-mon's keys with memory equivalents.
     The keys to write (extract these from the net-mon pattern, not from dock-flash):

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

     **Alert severity (needed by provider in Task 3b):**
     - `alertHostMemInfo`, `alertHostMemWarning`, `alertHostMemError`, `alertHostMemCritical`, `alertHostMemGrowth`
     - `alertHostGcInfo`, `alertHostGcWarning`, `alertHostGcError`
     - `alertSevInfo`, `alertSevWarning`, `alertSevError`, `alertSevCritical`

     Build the `t()` function reading `document.documentElement.lang` with a `MutationObserver` on `<html lang>` (same pattern as net-mon).

  3. **Preference system** — mirror net-mon's `_netPrefs` / `_loadNetPrefs` / `_saveNetPref`:

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

  4. **CSS `S` object** — copy the memory-specific style keys from net-mon's `S`
     object and adapt. The keys needed (net-mon has the same structural pattern;
     memory adds sparkline, GC-event, and usage-bar styles):

     ```
     monitorConfigBtn, monitorModalMask, monitorModal, monitorModalHead,
     monitorModalTitle, monitorModalClose, monitorModalBody,
     monitorConfigTwoCol, monitorConfigGroupTitle, monitorModalDivider,
     monitorModalSectionTitle, memColumnCard, memLiveDataGrid,
     memLiveDataLabel, memLiveDataValue, memUsageBarTrack, memUsageBarFill,
     memSubSectionLabel, alertPreviewToggle, alertPreviewCard,
     alertPreviewGroup, alertPreviewGroupLabel, alertPreviewRow,
     alertPreviewIcon, alertPreviewMsg, alertPreviewCond,
     memSparkline, memSparklinePlaceholder, memSparklineWrap, memTooltip,
     gcEventListWrap, gcEventRow, gcEventRowHighlight, gcEventTimeCol,
     gcEventDurationCol, gcEventKindCol, gcEventEmpty, sliderRow, slider,
     switchRow, switchLabel, switchIcon, value
     ```

  5. **Slider definitions** — 9 memory sliders:

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

  Leave `apply()` as a stub. The file compiles but does nothing visible yet.

- [ ] **Step 2: Commit Task 3a**

  ```bash
  cd /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  git add lib/client.js
  git commit -m "feat(mem-mon): i18n, preference system, CSS styles, and slider definitions"
  ```

---

#### Task 3b: Alert provider + enable toggle + registration wiring

**Files:**
- Modify: `dsh-flash-mem-mon/lib/client.js`

**Read budget:** Only `dock-flash/lib/client.js` lines 4985–5148
(`createHostMemoryAlertProvider`) and lines 11533–11552 (`_MONITOR_TOGGLES`
memory entry). Total ~8 KB, not the full 800 KB file. Read these sections with
`read` using `offset`/`limit` — never load the whole file.

**Interfaces:**
- Consumes: `ctx.get('quickControl')`, `ctx.get('dockFlashAlerts')`,
  `/plugins/dsh-flash-mem-mon/memory-trend` (own route).
- Produces: Provider `dsh-flash-mem-mon:host-memory-alert`, toggle
  `dsh-flash-mem-mon:monitor-memory`, wired `apply()`.

- [ ] **Step 1: Implement `createHostMemoryAlertProvider()`**

  Copy from dock-flash/lib/client.js lines 4985–5148 with these changes:
  - Route path: `/plugins/dsh-flash-mem-mon/memory-trend?mode=summary` (instead of `/plugins/dock-flash/memory-trend`)
  - Provider id: `'dsh-flash-mem-mon:host-memory-alert'` (instead of `'dock-flash:host-memory-alert'`)
  - Use `_alertPref()` from the local preference system (same keys)
  - All three alert criteria migrate together: RSS absolute (4 severity levels), RSS growth rate (info), Major GC frequency (3 levels)

- [ ] **Step 2: Implement the memory enable toggle and provider registration**

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
  - `config`: `() => openMonitorConfig('memory')`  (placeholder for now — Task 3c fills it in)
  - `getValue`/`setValue`: persist to `TOGGLE_KEY` localStorage + `alertRegistry.setProviderEnabled(PROVIDER_ID, on)`

  Apply persisted gate before registry auto-starts (same pattern as dock-flash's `_MONITOR_TOGGLES`).

  Also register `TOGGLE_KEY` in dock-flash's `_alertsDependentIds` list (Task 4 Step 2g).

- [ ] **Step 3: Wire `apply()` with provider + toggle registration**

  Fill in the `apply(ctx)` function:

  1. Load `_memPrefs` from settings
  2. Retry-poll for `ctx.get('quickControl')` and `ctx.get('dockFlashAlerts')` (up to 15 × 200ms)
  3. Register the alert provider via `alertRegistry.registerProvider(createHostMemoryAlertProvider())`
  4. Register the enable toggle via `registry.registerSwitch(…)`
  5. Apply the persisted toggle gate before registry auto-starts

  Use `ctx.effect()` for disposal: stop provider, unregister switch.

  Leave `openMonitorConfig()` as a no-op stub (`function openMonitorConfig() {}`);
  Task 3c replaces it with the real modal.

- [ ] **Step 4: Commit Task 3b**

  ```bash
  cd /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  git add lib/client.js
  git commit -m "feat(mem-mon): memory alert provider, enable toggle, and apply() wiring"
  ```

---

#### Task 3c: MonitorConfigModal (memory-only)

**Files:**
- Modify: `dsh-flash-mem-mon/lib/client.js`

**Read budget:** Only `dock-flash/lib/client.js` lines 7152–7962
(MonitorConfigModal memory branch, 811 lines / ~41 KB). This is the heaviest
single section. Read it in **two passes** (lines 7152–7560, then 7560–7962)
to keep each read under 25 KB. Do NOT read any other section of dock-flash.

**Interfaces:**
- Consumes: `/plugins/dock-flash/health` (cross-plugin, read-only),
  `/plugins/dsh-flash-mem-mon/memory-trend` (own route),
  `_alertPref()` / `_saveMemPref()` from Task 3a,
  `MONITOR_SLIDER_FIELDS.memory` from Task 3a.
- Produces: `MonitorConfigModal` component, `openMonitorConfig()` function,
  `_monitorConfigRoot` / `_monitorConfigHost` globals.

- [ ] **Step 1: Generate the extraction summary**

  Before reading the source, produce a lightweight extraction summary that
  lists the sub-structures to port (this takes almost no context but makes
  the subsequent read targeted):

  ```
  MonitorConfigModal memory branch (lines 7152–7962):
  ├── useState hooks: hostMem, trendData, trendSamples, gcEvents, hoverIdx, gcHighlightIdx
  ├── useEffect: fetchHost (2s interval), fetchTrend (5s), fetchSamples (5s)
  ├── renderSliderField() — shared row renderer for threshold sliders
  ├── Two-column layout (RSS + GC groups) via MONITOR_SLIDER_FIELDS.memory
  ├── Alert preview section (RSS absolute, growth, GC frequency)
  ├── Live memory data section
  │   ├── Host process: RSS/heap bars + colour thresholds
  │   └── Trend section: sparkline SVG + trend stats + GC event list
  ├── Sparkline SVG (largest sub-component ~300 lines)
  │   ├── Polyline with real-time X axis
  │   ├── Hover: vertical line + dot + tooltip + binary-search hit test
  │   ├── GC event markers (merge + dedup gcEvents + sample-detected RSS drops)
  │   └── Axis labels (Y: RSS MB, X: timestamps)
  ├── GC event list (right column)
  │   ├── RSS drop detection from samples
  │   ├── Merge with gcEvents, dedup by timestamp proximity (5s)
  │   └── Click-to-locate: setHoverIdx + setGcHighlightIdx
  └── Modal shell: Escape handler, overlay mask, close button
  ```

- [ ] **Step 2: Read MonitorConfigModal source (pass 1: lines 7152–7560)**

  Read `dock-flash/lib/client.js` lines 7152–7560 (hooks + effects + slider
  renderer + alert preview + host-section layout). Port to mem-mon's
  `MonitorConfigModal`, adapting:
  - Route: `/plugins/dsh-flash-mem-mon/memory-trend` instead of `/plugins/dock-flash/memory-trend`
  - Remove all `if (monitor !== 'memory') return` guards — this modal is memory-only
  - Use `_alertPref()` / `_saveMemPref()` instead of dock-flash's `_alertPref` / `_writeAlertPref`

- [ ] **Step 3: Read MonitorConfigModal source (pass 2: lines 7560–7962)**

  Read `dock-flash/lib/client.js` lines 7560–7962 (sparkline SVG + GC event
  list + trend stats + modal shell). Port the same way.

  The sparkline is the most complex sub-component (~300 lines). Key details:
  - SVG viewBox `520×80`, padding for axis labels
  - Real-time X axis (timestamp → pixel), not equal-spaced indices
  - Hover hit-test: binary search for nearest sample
  - GC markers: merge gcEvents (kind=2, has duration) with RSS-drop detection
    from samples, dedup within 5s, render as vertical lines
  - GC event list: click sets `hoverIdx` + `gcHighlightIdx` for cross-highlight

- [ ] **Step 4: Implement `openMonitorConfig()` and modal mount plumbing**

  Replace the stub from Task 3b with the real function. Use the same
  `createRoot` / unmount pattern as net-mon's modal:

  ```js
  var _monitorConfigRoot = null
  var _monitorConfigHost = null

  function openMonitorConfig() {
    if (_monitorConfigRoot) { /* unmount first */ }
    // Create host div, append to document.body
    // createRoot, render MonitorConfigModal
  }
  ```

  Update the toggle's `config` field (from Task 3b Step 2) to call the
  real `openMonitorConfig()`.

- [ ] **Step 5: Commit Task 3c**

  ```bash
  cd /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  git add lib/client.js
  git commit -m "feat(mem-mon): MonitorConfigModal with sparkline, GC events, alert preview, and sliders"
  ```

---

#### Task 3d: Integration verification

**Files:**
- No file changes. Verification only.

**Read budget:** None — all code is written; this step only runs runtime checks.

- [ ] **Step 1: Syntax validation**

  Open the DSH Web GUI with both dock-flash and dsh-flash-mem-mon enabled.
  Check the browser console for syntax errors or module-load failures from
  `dsh-flash-mem-mon/client`.

- [ ] **Step 2: Functional verification**

  Refresh the page and verify:
  - Memory toggle appears in the ⚡ panel under System > system-alerts cluster
  - Toggling it ON/OFF enables/disables the `dsh-flash-mem-mon:host-memory-alert` provider
  - Config modal opens, shows live host memory data, trend sparkline, GC events, alert preview, and threshold sliders
  - Changing a slider writes to `dsh-flash-mem-mon` settings namespace (not `dock-flash`)
  - Alert provider polls `/plugins/dsh-flash-mem-mon/memory-trend?mode=summary` and emits alerts at correct thresholds

- [ ] **Step 3: Commit any fixups**

  If verification reveals issues, fix and commit with:
  ```bash
  cd /d/codes/learn/dsh-plugin/dsh-flash-mem-mon
  git add lib/client.js
  git commit -m "fix(mem-mon): address integration verification findings"
  ```

  If no issues, skip this step.

---

### Task 4: Remove memory code from `dock-flash` + companion integration

> **Context-window budget note.** When this Task is reached after executing Tasks 1–3
> in the same session, the conversation history already holds ~80–100 K tokens
> (plan text, prior reads of `dock-flash/lib/client.js` scattered sections, the
> full `dsh-flash-net-mon/lib/client.js` reference, and AGENTS.md injection).
> `dock-flash/lib/client.js` is **14772 lines / 728 KB** — too large for any
> whole-file read. A single Step that touches 12+ scattered locations (lines
> 331–14298) via multiple `grep` + `read` cycles will overflow a 128 K window.
>
> **Mitigation (three layers):**
> 1. **Execute in a fresh sub-agent** — the sub-agent starts with no prior
>    conversation, so peak context stays ≤60 K tokens. Pass only the task
>    description and the specific line-number targets.
> 2. **Split by file region** — each sub-step reads and edits one contiguous
>    region (≤50 lines of context), commits, and clears the edit buffer.
> 3. **Merge companion integration** — Task 5 (updating `_COMPANION_PREFIXES`
>    and `_alertsDependentIds`) modifies the same file in adjacent areas, so
>    it is folded into this Task to avoid a second full pass over the same
>    728 KB file.

**Files:**
- Modify: `dock-flash/src/index.ts` (remove MemoryTrendCollector, interfaces, route, config fields, defaults, bootstrap, volatile-update handler)
- Modify: `dock-flash/lib/client.js` (remove/verify memory code removal; add mem-mon companion routing)
- Modify: `dock-flash/dist/index.js` (rebuilt after src changes)

**Interfaces:**
- Consumes: Task 2 and Task 3a–3d completed; mem-mon plugin self-contained.
- Produces: dock-flash without any memory-specific code; alert framework (registry + queue routes) intact; mem-mon recognised as a companion plugin.

**Execution strategy:** Run Steps 2b–2g in a **fresh sub-agent** (via `subagent` or `subagent_fork`), passing only the step description and the exact line numbers. The sub-agent has no prior context, so it stays well within the 128 K window.

---

- [x] **Step 1: Remove host-side memory code from `dock-flash/src/index.ts`** ✅ Done

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

---

#### Step 2: Remove client-side memory code + add companion integration

> **Read budget per sub-step:** ≤50 lines of `dock-flash/lib/client.js`, accessed
> by `grep` for exact line numbers first, then `read(offset, limit)` for the
> surrounding 30–50 lines. **Never read the full file.**

**Current state (verified by grep):**
The following items were already removed or replaced by comments in earlier work:
- `createHostMemoryAlertProvider()` → replaced by comment at line 4697
- `MONITOR_SLIDER_FIELDS.memory` → comment at line 6390, only `context` remains
- `MONITOR_TITLE_KEY.memory` → comment at line 6402, only `context` remains
- `MonitorConfigModal` memory branch → comments at lines 6704, 6713; context-only modal remains
- `_MONITOR_TOGGLES.memory` → comment at line 10374, only `context` remains
- `_monitorEntries` memory entry → comment at line 14298, only `context` entry remains
- `_hostPrefs` memory fields → already removed, only context + alert fields remain
- `alertHostMem*` / `alertHostGc*` i18n keys → comments at lines 331, 528

**Remaining work** is small and surgical — cleaning up placeholder comments and adding two companion entries:

- [x] **Step 2a**: Removed 8 memory alert i18n keys (`alertHostMem*`, `alertHostGc*`) from both zh (was lines 331–338) and en (was lines 531–538) dictionaries. Replaced with single-line comments. ✅ Done

- [x] **Step 2b**: Verify `createHostMemoryAlertProvider()` extraction and clean up residual comments ✅ Done

  **Read budget:** `grep 'createHostMemoryAlertProvider'` then `read(offset=4695, limit=5)`.

  Verify line 4697 contains the extraction comment. If the function body is still present (unlikely), delete it and replace with the comment. Also check for any remaining call-sites:
  ```bash
  grep -n 'createHostMemoryAlertProvider' dock-flash/lib/client.js
  ```
  Expected: Only the comment at line 4697. No function body, no call-sites.

  Clean up the `MonitorConfigModal` memory-state comments (lines ~6704, 6713) — replace verbose comments with minimal ones or remove them if they add no information beyond what the surrounding code already conveys.

- [x] **Step 2c**: Clean up `MONITOR_SLIDER_FIELDS` / `MONITOR_TITLE_KEY` comments ✅ Done — comments kept, no dead code found

  **Read budget:** `grep -n 'MONITOR_SLIDER_FIELDS\|MONITOR_TITLE_KEY'` then `read(offset=6387, limit=20)`.

  The placeholder comments `// memory: extracted to dsh-flash-mem-mon` at lines 6390 and 6402 are fine to keep — they document why only `context` remains. Verify no dead code is hiding behind them.

- [x] **Step 2d**: Clean up `_MONITOR_TOGGLES` / `_monitorEntries` comments ✅ Done — comments kept, no dead code found

  **Read budget:** `grep -n '_MONITOR_TOGGLES\|_monitorEntries'` then `read(offset=10371, limit=10)` and `read(offset=14295, limit=10)`.

  Same as 2c — the comments at lines 10374 and 14298 are documentation, not dead code. Verify and move on.

- [x] **Step 2e**: Update stale comment referencing `memThreshold*` ✅ Done — updated K7 comment to reflect mem/net field namespace split

  **Read budget:** `grep -n 'memThreshold\|gcThreshold\|memPoll'` then `read(offset=3435, limit=10)`.

  Line 3439 mentions `D sends {memThreshold*, …}` in a K7 comment block about namespace field-set isolation. Now that memory fields have moved to `dsh-flash-mem-mon`, update this comment to reflect the current state (remove the `memThreshold*` reference, or note the split).

- [x] **Step 2f**: Add mem-mon to `_COMPANION_PREFIXES` ✅ Done

  **Read budget:** `grep -n '_COMPANION_PREFIXES'` then `read(offset=7200, limit=8)`.

  Change:
  ```js
  var _COMPANION_PREFIXES = ['dsh-flash-net-mon:']
  ```
  to:
  ```js
  var _COMPANION_PREFIXES = ['dsh-flash-net-mon:', 'dsh-flash-mem-mon:']
  ```

  This ensures mem-mon's switches (toggle id `dsh-flash-mem-mon:monitor-memory`) appear in the ⚡ Workbench built-in tab alongside dock-flash's own switches, just like net-mon's do.

- [x] **Step 2g**: Add mem-mon toggle to `_alertsDependentIds` ✅ Done

  **Read budget:** `grep -n '_alertsDependentIds'` then `read(offset=14200, limit=15)`.

  Add `'dsh-flash-mem-mon:monitor-memory'` to the `_alertsDependentIds` array so that toggling the master system-alerts switch on/off also re-renders mem-mon's memory toggle (which has `visible: () => _getAlertsOn()`):

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

**Keep (do NOT remove):**
- `alertMemCluster` i18n key in both zh/en dicts — used by companion routing at `_PROVIDER_LABELS['dsh-flash-mem-mon:host-memory-alert']` (line 5402). The memory plugin owns the provider, but dock-flash displays the alert source label.
- Context monitor code (untouched)

---

- [x] **Step 3: Rebuild dock-flash** ✅ Done — build + typecheck pass

  ```bash
  cd /d/codes/learn/dsh-plugin/dock-flash
  pnpm run build
  pnpm run typecheck
  ```
  Expected: Build passes with memory code removed. `dist/index.js` updated.

- [x] **Step 4: Global grep verification** ✅ Done — old IDs removed, 4 code references to dsh-flash-mem-mon as expected

  Run these greps to confirm no stale memory references remain:

  ```bash
  grep -n 'dock-flash:monitor-memory\|dock-flash:host-memory-alert' dock-flash/lib/client.js
  ```
  Expected: No matches (old IDs fully removed).

  ```bash
  grep -n 'memory-trend' dock-flash/lib/client.js
  ```
  Expected: No matches (route path fully removed).

  ```bash
  grep -n 'dsh-flash-mem-mon' dock-flash/lib/client.js
  ```
  Expected: Exactly 4 matches — `_COMPANION_PREFIXES` (Step 2f), `_alertsDependentIds` (Step 2g), `_PROVIDER_LABELS` (existing line 5402), and `_providerLabel` fallback regex (existing line 5413).

- [x] **Step 5: Commit** ✅ Done — 97578b0

  ```bash
  git add src/index.ts lib/client.js dist/index.js
  git commit -m "refactor(dock-flash): remove memory monitor code (now in dsh-flash-mem-mon) and add mem-mon companion integration"
  ```

---

### Task 5: (Merged into Task 4 Steps 2f–2g)

> The original Task 5 (adding mem-mon to `_COMPANION_PREFIXES` and
> `_alertsDependentIds`) has been merged into Task 4 Steps 2f and 2g.
> Both modifications target the same file (`dock-flash/lib/client.js`) in
> adjacent areas, and executing them in the same pass avoids a second
> full read of the 728 KB file.

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
| 7 | No stale memory references in dock-flash client | Task 4 Step 4 |

## Out of Scope

- **Context monitor extraction** (`dsh-flash-ctx-mon`): Separate effort, same pattern. Not touched by this plan.
- **`_MONITOR_TOGGLES` cleanup in dock-flash**: The `memory` entry is already commented out in Task 4 Step 2d; the `context` entry stays until ctx-mon is extracted.
- **MonitorConfigModal refactoring in dock-flash**: The modal already lost its memory branch (commented out); it retains context. A future ctx-mon extraction would remove it entirely from dock-flash.
- **Version bumps or publishing**: Subject to the two-gate release policy in AGENTS.md.
- **README/CHANGELOG for mem-mon**: Created as part of the repo setup but content is lightweight until first release.
