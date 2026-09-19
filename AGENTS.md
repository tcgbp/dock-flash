# AGENTS.md — dock-flash Development Rules

> This file documents known requirements, development constraints, testing conventions, and hard-won lessons for the dock-flash plugin. Read it before modifying `lib/client.js` or `src/index.ts`.

---

## Project Structure

```
dock-flash/
├── src/index.ts          HOST half — settings namespace + proxy toggle (tsc → dist/)
├── dist/index.js         Compiled host half
├── lib/client.js         BROWSER half — quickControl registry + panel + skin system + i18n (~3386 lines, single file, NO build step, organized by #region markers)
├── cordis.patch.yml      Bundle layer — inserts host rows into profile
├── package.json          Plugin manifest + dsh.client.inject
├── README.md             English docs (canonical)
├── README.zh-CN.md       Chinese docs (mirrors README.md)
├── INTEGRATION.md        Third-party integration guide (English)
├── INTEGRATION.zh-CN.md  Third-party integration guide (Chinese)
└── AGENTS.md             This file
```

- **Host half** (`src/index.ts`): compiled via `pnpm run build` (tsc). Touch only this file for host-side changes.
- **Client half** (`lib/client.js`): single monolithic file, edited directly — no build, no bundler, no TypeScript. Changes take effect on page refresh (symlinked in profile).

---

## Build & Install

```sh
pnpm install
pnpm run build          # tsc → dist/index.js (host half only)
pnpm run typecheck      # type check without emitting
```

- Install into profile: `dsh plugin --profile web add ./dock-flash`
- dock-flash is **symlinked** in the profile — edits to `lib/client.js` appear on refresh without reinstalling
- Host half changes require `pnpm run build` then restart DSH

**`dist/` is tracked on purpose — never add it back to `.gitignore`.** A git install fetches sources, not built artifacts: nothing runs the `build` script, so a repo without `dist/` arrives missing the host-half entry point (`package.json` `main` and `exports["."]` both point at `./dist/index.js`) and fails to load. Shipping the compiled file lets `dsh plugin --profile <p> add github:tcgbp/dock-flash` work with no build step and **no `allowBuilds` permission**. Do **not** add a `prepare` script alongside it: declaring one makes pnpm ≥10 demand an explicit build allowance before the first `add` succeeds, which would defeat the purpose. Consequence: every `src/index.ts` change must be followed by `pnpm run build` and a commit of `dist/` in the same change.

---

## Publishing & Repository Sync

**Gitee is authoritative; GitHub is a mirror of it.**

| Repository | Role | How it receives commits |
|---|---|---|
| `gitee.com/lenin.guo/dock-flash` | **Authoritative** | `git push` — the only remote configured (`origin`) |
| `github.com/tcgbp/dock-flash` | Mirror | `.github/workflows/sync-from-gitee.yml` |

**Always commit and push to Gitee.** No `github` remote is configured locally, deliberately: github.com is unreachable from the maintainer machine (TCP 443 resets, no proxy available), so a dual-push fails half-way and leaves the two repositories silently divergent.

GitHub is updated by `.github/workflows/sync-from-gitee.yml`, which runs on GitHub's own runners (hourly, plus `workflow_dispatch`). It needs no local machine and no stored secret, because both repositories are public and the built-in `GITHUB_TOKEN` performs the push. Trigger it from the Actions tab.

Gitee's built-in **仓库镜像管理** push mirror was tried first and **never delivered a single commit**; it is not the mechanism in use. Do not re-enable it — a second, unverified mirror racing the workflow is how the two repositories drift apart again.

Two details of that workflow must not be "simplified":

- It uses explicit refspecs (`refs/heads/*:refs/heads/*`), **not** `git push --mirror`. `--mirror` deletes refs the source lacks, which would delete the workflow file itself from the default branch and silently stop every future scheduled run. Trade-off: branches and tags deleted on Gitee are not deleted on GitHub.
- The workflow file is committed **to Gitee as well**, for the same reason: after a mirror push GitHub's default branch is exactly Gitee's tree, so anything living only on GitHub is wiped.

GitHub disables scheduled workflows after roughly 60 days without repository activity — if the mirror looks stale, check the Actions tab first.

---

## Architecture

### Plugin Contract

dock-flash can run in two modes:

**Workbench mode** (dock-base installed) — follows the [dock-base plugin contract](https://github.com/AKS1st/dock/blob/main/src/client/contract.ts). All workbench interaction goes through `ctx.workbench`:

| Registration | API | Purpose |
|---|---|---|
| Sidebar Panel | `ctx.workbench.registerPanel()` | Quick control panel (sideBar area) |
| Plugin Entry | `ctx.workbench.registerPlugin()` | Settings panel card — title "Flash" (visibility toggle + Open button) |
| Activity Bar Item | `ctx.workbench.registerActivityBarItem()` | ⚡ icon |
| Editor View | `ctx.workbench.registerEditorView()` | Quick control panel (draggable to floating) |
| Command | `ctx.workbench.registerCommand()` | `dock-flash:openQuickControl` |
| Service | `ctx.provide('quickControl', registry)` | Pub/sub switch registry for other plugins |

**Standalone mode** (no dock-base) — injects a ⚡ trigger button through `ctx.slots.inject(<slot>, ...)`, where the slot is chosen by the `trigger-position` switch (`dock-flash:trigger-position`, default `conversation.input.right`). Clicking the trigger toggles a floating QuickControlPanel anchored to the button. The floating panel has a drag-to-move title bar (⠿ grip + ⚡ + the localized `title` string + close-on-blur toggle + × close) and uses `react-dom/client`'s `createRoot`. That toggle and the outside-click handler read the same `localStorage` key, so close-on-blur here behaves exactly as it does in workbench mode.

**`sidebar.footer.action` is deliberately not offered as a trigger position.** It is a shared slot that CordisPanel and other plugins also occupy, and a second occupant produces visual conflicts with them. Do not re-add it to `TRIGGER_POSITIONS`, and keep the fallback in `loadTriggerPosition()` pointing at a conversation slot. Note the trade-off: every remaining position lives inside the conversation UI, so with no session open the trigger is not rendered at all — that is accepted.

### Mode Detection

```js
// In apply(ctx):
const wb = ctx.get ? ctx.get('workbench') : undefined

if (wb) {
  // Workbench mode: register panel, activity bar, editor view, command
  // Register the dock-flash-owned switches (close-on-blur is NOT one of them —
  // it lives in the panel header; see "Close-on-blur is a header toggle" below)
} else {
  // Standalone mode: inject the trigger button into the configured conversation slot
}
```

The `inject` array is empty (`inject: []`) — workbench is resolved lazily via `ctx.get('workbench')` rather than declared as a hard dependency. This ensures `apply()` runs even when dock-base is not installed.

**Critical**: `dsh.client.inject` in `package.json` MUST include `"dock-base"` (the base package name, NOT `"dock-base/client"`). This is NOT a hard dependency — it's a **load-order hint** for the DSH ModuleLoader. When dock-base is installed, `arriveGraphRow()` ensures it loads before dock-flash, so `ctx.get('workbench')` finds the service already registered at `apply()` time. When dock-base is absent, the entry is silently skipped (`graphRows.get('dock-base')` returns `undefined`), and dock-flash enters standalone mode. Without this load-order hint, dock-flash may load before dock-base, causing `ctx.get('workbench')` to return `undefined` even when dock-base IS installed.

**Why `"dock-base"` not `"dock-base/client"`**: The client-side `arriveGraphRow()` (dsh-client-modules/lib/client.js line 265-268) looks up `inject` entries via `this.graphRows.get(packageName)` WITHOUT stripping the `/client` suffix. Graph row keys are base package names (e.g., `"dock-base"`). So `graphRows.get("dock-base/client")` returns `undefined` — the load-order hint is silently ignored. The `external` path (line 259-263) correctly calls `stripClientSuffix()` before lookup, but `inject` does not. Always use the base package name in `dsh.client.inject`.

### Two-Half Model

```
┌─────────────────────────────────────────┐
│  HOST (src/index.ts → dist/index.js)    │
│  - Register 'dock-flash' settings       │
│  - Fine-grained proxy mode + NO_PROXY   │
│  - HTTP API routes (webServer):         │
│    GET /proxy-status → proxy mode/state │
│    POST /test-connection → fetch test   │
│  - Runs in Node.js via Cordis           │
└──────────────────┬──────────────────────┘
                   │ cordis.patch.yml (bundle layer)
┌──────────────────▼──────────────────────┐
│  CLIENT (lib/client.js)                 │
│  - QuickControlRegistry (pub/sub)       │
│  - React panel UI                       │
│  - Skin system (5-layer scan)           │
│  - i18n (zh/en)                         │
│  - Runs in browser via ModuleLoader     │
└─────────────────────────────────────────┘
```

### Module Loading

Client plugin is loaded via `window.__ModuleLoader__.load({ id, factory })`. The factory receives `require` and must use `require('react')` (not import). All React usage goes through `h = React.createElement`.

### Close-on-blur is a header toggle, not a switch

`close-on-blur` deliberately has **no entry in the switch registry**. It is a small icon button rendered immediately left of the close (×) button, in two places:

- the workbench `headerComponent` of the sidebar panel (`wb.registerPanel({ headerComponent })`), and
- the standalone floating panel's own title bar, built imperatively with `document.createElement`.

All three readers — the panel component's outside-click `useEffect`, the workbench header button, and the standalone header button — share the single `localStorage` key `dock-flash:close-on-blur` (`'off'` | `'floating'`; anything that is not `'off'` counts as on).

Two consequences worth knowing:

- Because no built-in switch carries `group: 'layout'` in workbench mode, the **Layout subgroup is simply not rendered there** and needs no special-casing: `groupOrder.filter((g) => builtInGroups.has(g))` already skips groups that have no switches. `trigger-position` is the only remaining layout switch, and it is registered inside `mountStandaloneSlotTrigger`, i.e. standalone only.
- The workbench header button paints its own active state imperatively instead of using `useState`, because dock-base may invoke `headerComponent` as a plain render function rather than mounting it as a component — hooks would then be illegal. Do not "tidy this up" into a hook.

---

## Critical Rules (MUST follow)

### 1. Never Modify Layout State Synchronously in React Render Cycle

Calling `ctx.workbench.updateLayout()` or `ctx.workbench.openView()` synchronously during a React render causes the dock bar to vanish. Always defer:

```js
// ✅ Correct — defer to next tick
const handleClick = () => {
  setTimeout(() => ctx.workbench.openView('dock-flash:quickControl'), 0)
}

// ❌ Wrong — synchronous layout mutation in render path
return h('div', { onClick: () => ctx.workbench.openView('...') })
```

### 2. CSS Skin Deactivation Must Use `el.remove()`, Not `el.disabled = true`

Some skins (e.g. those using `exports.apply()`) check for `style[data-plugin-css]` tag existence before injecting. A disabled tag still exists in the DOM, causing the skin to skip re-injection on reactivation.

```js
// ✅ Correct — remove from DOM
el.remove()

// ❌ Wrong — tag still exists, blocks re-injection
el.disabled = true
```

### 3. `storage` Event Only Fires in Other Browsing Contexts

`window.addEventListener('storage', handler)` does NOT fire when `localStorage.setItem()` is called in the same window. This is a browser spec requirement.

**Workaround**: Create a same-origin `<iframe>` (`about:blank` inherits parent origin), write from `iframe.contentWindow.localStorage` → parent receives the `storage` event.

```js
// ✅ Correct — iframe trick triggers storage event in parent
function writeViaIframe(key, value) {
  try {
    const iframe = document.createElement('iframe')
    iframe.src = 'about:blank'
    document.body.appendChild(iframe)
    iframe.contentWindow.localStorage.setItem(key, value)
    iframe.remove()
  } catch (_) {
    // Fallback: direct write + DOM manipulation; next refresh reads correct state
    localStorage.setItem(key, value)
  }
}

// ❌ Wrong — storage event never fires in same window
localStorage.setItem(key, value)  // onStorage handler won't trigger
```

### 4. Plugins with MutationObservers or IIFE Injection Cannot Be Reliably Externally Toggled

Example: `@kubor/dsh-bloom-theme` — IIFE immediately injects CSS, MutationObservers auto-restore removed DOM, hot-reload `setInterval` re-checks every 3s. External deactivation is futile.

**Solution**: Exclude such plugins via `_skinExclude` instead of trying to handle them:

```js
const _skinExclude = /black-hole|theme-manager|dsh-bloom-theme/i
```

When adding new skin plugins that exhibit similar behavior (self-restoring observers, IIFE injection, hot-reload), add them to `_skinExclude` — do NOT attempt to write deactivation logic for them.

### 5. `mod.import()` May Fail for Plugins Not in the Module Graph

Some installed-but-deactivated plugins (like Mineradio) may not be resolvable via `ctx.get('modules').import(id)`. Always provide a fallback:

```js
// Dual-strategy reactivation
try {
  mod.import(skinId).then(exports => {
    ctx.plugin(exports.apply)  // Strategy 1: reuse module
  }).catch(() => {
    _reloadSkinScript(skinId)  // Strategy 2: <script> tag fallback
  })
} catch (_) {
  _reloadSkinScript(skinId)    // Strategy 2 immediately if mod unavailable
}
```

Script tag fallback: `<script src="/plugins/<id>/client.js">` — re-runs the entire IIFE which unconditionally injects CSS.

### 6. Theme Plugins with `theme/change` Listeners Need Retry Mechanism

`wxj-black-hole` listens for `theme/change` events and forcibly reverts theme changes. The theme switcher must retry:

```js
// Retry setTheme() every 150ms, up to 15 times
let retries = 0
const timer = setInterval(() => {
  ctx.workbench.setTheme(targetTheme)
  if (++retries >= 15) clearInterval(timer)
}, 150)
```

### 7. `setValue()` Should Only Update State — Panel Handles UI Refresh

The panel automatically refreshes switch UI and records changelog on user interaction. `setValue()` should be a pure state setter:

```js
// ✅ Correct
setValue: (v) => { myState = v }

// ❌ Wrong — causes duplicate changelog entries
setValue: (v) => { myState = v; sw._notifyChange?.('old', 'new') }
```

`_notifyChange()` is for proactive state changes (timers, server push), NOT user-initiated changes.

### 8. `_skinExclude` Must Be Checked in ALL Scan Phases

Every skin discovery phase (1a, 1b, 2, 4) must filter excluded plugins. Missing a phase causes excluded skins to appear in the dropdown:

```js
// Every scan loop must include:
if (_skinExclude.test(id)) continue
```

### 9. Never Use CSS `zoom` on `<html>` Element

Setting `style.zoom` on `document.documentElement` — even at 100% (`zoom: 1`) — distorts the browser coordinate system. `getBoundingClientRect()` and `clientX`/`clientY` in mouse events no longer map 1:1 to screen pixels, silently breaking DSH Web's sidebar sash drag and other pointer-based interactions.

**The page zoom feature was removed in v0.15.2** because there is no safe way to use CSS `zoom` on `<html>` without breaking DSH Web's coordinate-dependent interactions. Even `removeProperty('zoom')` at 100% proved insufficient in practice.

```js
// ❌ NEVER do this — breaks coordinate system regardless of value
document.documentElement.style.zoom = '1'   // even 100% is harmful
document.documentElement.style.zoom = '0.9'  // any non-default value

// ✅ If cleanup is needed (legacy state from older versions):
document.documentElement.style.removeProperty('zoom')
localStorage.removeItem('dock-flash:zoom')
```

**Why it matters**: The CSS `zoom` property, even at its default visual value, changes how the browser reports element positions and event coordinates. DSH Web's sidebar sash relies on precise `clientX` deltas — a `zoom` property on `<html>` introduces a scaling factor that makes the drag calculation wrong.

### 10. Error Boundary Is Mandatory for Panel Components

dock-base's `WorkbenchRoot` has NO error boundary. An uncaught render error in any panel component crashes the entire dock (activity bar + all panels disappear). Wrap every dock-flash panel component in `PanelErrorBoundary`.

---

## Skin System Architecture

### 5-Layer Scan

| Phase | Source | What It Finds |
|---|---|---|
| 0 | Managed skin registry | Skins with own lifecycle (Mineradio) — detected via config/DOM |
| 1a | `<style data-plugin>` / `<link data-plugin>` | DSH runner-injected styles, deduplicated by package name |
| 1b | `<style data-skin-chrome>` | Styles created by plugins inside `ctx.effect()` |
| 2 | Body/HTML attributes | Attribute-only skins (`data-dsh-*`) |
| 3 | _(removed)_ | Old manual list deleted |
| 4 | `__DSH_BOOT__` / `graphRows` + dsh-market API | Installed-but-inactive plugins |

### Skin Categories

| Category | Example | Toggle Mechanism |
|---|---|---|
| **Managed** | Mineradio | iframe → `storage` event → `onStorage` → `sync()` → `mount()`/`unmount()` |
| **CSS** | maid-atelier, official-homepage | `el.remove()` deactivation + `mod.import()` / `<script>` reactivation |
| **Excluded** | bloom-theme, black-hole, theme-manager | Filtered by `_skinExclude`, never appear in dropdown |

> **Without dsh-market**: the skin switcher is not registered at all — `_registerSkinSwitch()` is only called from `_refreshMarketThemes()` on success. Without market, disabled themes are invisible to DOM scan and the list would be incomplete.

### Managed Skin Configuration

| Skin | localStorage Key | Activation Attribute |
|---|---|---|
| Mineradio | `dsh.ui-mineradio.enabled` | `data-dsh-aqua` |

### Preference Persistence

- Active skin saved to `localStorage` (`dock-flash:active-skin`)
- Restored 300ms after page load (`_scheduleSkinRestore`)
- `MutationObserver` on `<head>` re-applies preference when late-loading skins appear

---

## QuickControl Registry API

### Switch Types

| Type | Required Fields | Notes |
|---|---|---|
| `toggle` | `getValue()`, `setValue(boolean)` | Boolean switch |
| `slider` | `getValue()`, `setValue(number)`, `min`, `max`, `step` | Numeric slider |
| `select` | `getValue()`, `setValue(any)`, `options` | Dropdown select |
| `buttongroup` | `getValue()`, `setValue(any)`, `options` | Button group |
| `action` | `run()` | Action button |

### Registration Rules

- **id format**: `plugin:switch-name` (e.g. `dock-flash:theme`, `dock-git:show-stash`)
- **id prefix determines grouping**: `dock-flash:*` → built-in (⚡ Workbench tab), others → 🧩 Extensions tab
- **order**: Built-in items use 10–60; third-party should start from 100
- **group field**: Only meaningful for built-in switches (`appearance`, `layout`, `system`); ignored for third-party

### Third-Party Plugin Integration

Two integration patterns:

#### Pattern A — Hard Dependency (NOT recommended)

```js
// Client-side (client.js):
exports.inject = ['quickControl']
// Plugin will NOT load if dock-flash is absent.
```

Only use this if your plugin is meaningless without dock-flash.

#### Pattern B — Optional Integration (recommended)

```js
// Client-side (client.js):
exports.inject = []  // No hard dependency — plugin loads regardless

exports.apply = function (ctx) {
  var registered = false

  function registerMySwitches(registry) {
    if (registered) return
    registered = true
    ctx.effect(() => {
      var dispose = registry.registerSwitch({ /* ... */ })
      return dispose
    }, 'my-plugin: cleanup')
  }

  // Dual-discovery: passive (event) + active (ctx.get)
  var off = ctx.on('dock-flash:ready', registerMySwitches)
  var registry = ctx.get('quickControl')
  if (registry) registerMySwitches(registry)

  return off
}
```

#### Load-Order Hint (package.json)

Add a load-order hint in `package.json` so dock-flash loads before your plugin (when both are installed):

```json
"dsh": { "client": { "inject": ["dock-flash"] } }
```

**Must use base package name `"dock-flash"`, NOT `"dock-flash/client"`** — the same `arriveGraphRow()` limitation applies: inject lookups do NOT strip the `/client` suffix. This is NOT a hard dependency; when dock-flash is absent, the entry is silently skipped.

#### Event Bridge: `dock-flash:ready`

Starting from v0.16.0, dock-flash emits `ctx.emit('dock-flash:ready', registry)` after publishing the `quickControl` service. This allows other plugins to discover dock-flash without declaring a hard dependency.

The event fires once per dock-flash `apply()` call. Listeners should use a `registered` guard to prevent duplicate registration when both the event and `ctx.get()` trigger.

#### TypeScript Types

Install `dock-flash-qc-types` for zero-runtime-cost type definitions:

```sh
pnpm add -D dock-flash-qc-types
```

See `INTEGRATION.md` / `INTEGRATION.zh-CN.md` for the full integration guide.

---

## i18n Conventions

- Translation function `t(key)` returns Chinese or English based on `document.documentElement.lang`
- `MutationObserver` watches `<html lang>` for real-time switching
- Functional labels (`label: () => t('xxx')`) ensure dynamic refresh on language change
- Static string labels won't update on language change — always use functions for user-visible text

---

## Testing Conventions

### Manual Testing Checklist

Since dock-flash has no automated test suite, verify manually after changes:

1. **Panel Render**: Click ⚡ icon → panel opens without crash
2. **Error Boundary**: Intentionally throw in a switch component → panel shows error boundary UI, dock survives
3. **Skin Switcher**: Switch between CSS skins → styles change correctly; switch back → styles restored
4. **Managed Skin**: Toggle Mineradio → canvas appears/disappears via full lifecycle
5. **Excluded Skins**: Verify bloom-theme, black-hole, theme-manager do NOT appear in skin dropdown
6. **Theme Retry**: With wxj-black-hole installed, switch theme → change persists after retry
7. **Language Switch**: Toggle language → all labels update immediately
8. **Third-Party Switch**: Register a test switch via `quickControl` service → appears in Extensions tab
9. **Proxy Select**: Switch proxy mode (all-proxy / api-bypass / all-bypass / custom) → check `process.env.NO_PROXY` in host console matches the selected mode; custom mode prompts for NO_PROXY value, cancel reverts
10. **Preference Restore**: Set skin, refresh page → saved skin auto-restores after 300ms
11. **Sidebar Sash Drag**: With dock-flash enabled, drag sidebar sash → width resizes correctly (no residual `style.zoom` on `<html>` interfering with coordinate system)
12. **No Duplicate Skin Entries**: Switch to Claude Style skin → dropdown shows exactly one entry; switch away → still exactly one entry for Claude Style (no phantom duplicate from `data-skin-chrome` vs boot manifest ID mismatch)
13. **Optional Integration (dock-flash present)**: Install `dock-flash-qc-demo` (Pattern B, `USE_HARD_DEPENDENCY = false`) → demo switches appear in 🧩 Extensions tab; plugin loads fine
14. **Optional Integration (dock-flash absent)**: Uninstall dock-flash → `dock-flash-qc-demo` still loads without error (console shows "dock-flash not detected" message); no switches registered (graceful)
15. **dock-flash:ready Event**: Install a test plugin that only uses `ctx.on('dock-flash:ready', ...)` (no `ctx.get`) → switches appear when dock-flash loads after the test plugin
16. **Dual-Discovery No Duplicate**: Install `dock-flash-qc-demo` (Pattern B) → each demo switch appears exactly once in Extensions tab (not duplicated)

### Key Observation Points

- **Browser DevTools console**: `[dock-flash]` prefixed logs for client-side events
- **Host process console**: `[dock-flash]` prefixed logs for proxy settings
- **localStorage**: Check `dock-flash:active-skin` key for skin persistence
- **DOM**: Inspect `<style data-plugin>`, `<style data-skin-chrome>`, and `data-dsh-*` attributes for skin state

---

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Layout mutation in React render | Dock bar vanishes entirely | Defer with `setTimeout(..., 0)` |
| `el.disabled = true` instead of `el.remove()` | Skin fails to reactivate (skips re-injection) | Always use `el.remove()` |
| `localStorage.setItem()` in same window | `storage` event doesn't fire; managed skin doesn't toggle | Use iframe trick |
| Missing `_skinExclude` check in a scan phase | Excluded skin appears in dropdown | Add `if (_skinExclude.test(id)) continue` to every phase |
| Attempting to externally toggle self-protecting plugins | Deactivation appears to work then auto-reverts | Add to `_skinExclude` instead |
| `setValue()` calling `_notifyChange()` | Duplicate changelog entries | `setValue()` should only update state |
| Static string labels | Labels don't update on language change | Use functional labels: `label: () => t('key')` |
| No error boundary on panel component | Entire dock disappears on render error | Wrap in `PanelErrorBoundary` |
| Two plugin IDs mapping to same `_skinBodyAttrs` key | Phantom duplicate entries in skin dropdown | Each attribute must map to exactly one plugin ID |
| Using `"dock-base/client"` instead of `"dock-base"` in `dsh.client.inject` | dock-flash loads before dock-base → `ctx.get('workbench')` returns `undefined` → always enters standalone mode | Use `"dock-base"` (base package name) in `dsh.client.inject`; client-side `arriveGraphRow()` does NOT strip `/client` suffix for inject lookups, so `"dock-base/client"` silently fails to match the `"dock-base"` graph row key |
| Using `React.createRoot` instead of `require('react-dom/client').createRoot` | Standalone panel renders nothing — no React root created | `createRoot` lives in `react-dom/client`, not on the `react` package. In workbench mode dock-base provides the React root; in standalone mode you must create your own via `require('react-dom/client')` |
| Setting `style.zoom` on `<html>` at any value | Sidebar sash drag breaks — mouse coordinates misaligned, cannot resize sidebar width | CSS `zoom` on `<html>` distorts the browser coordinate system at ANY value, including `zoom:1`. Page zoom feature removed entirely in v0.15.2; legacy cleanup calls `removeProperty('zoom')` + `localStorage.removeItem('dock-flash:zoom')` on startup |
| `data-skin-chrome` value ≠ package name | Duplicate entries in skin dropdown when skin is active | Phase 1b uses the raw `data-skin-chrome` attribute value as the plugin ID. If a skin sets this to its style-element ID (e.g., `claude-style-skin-style`) instead of its package name (`claude-style-skin`), Phase 4 rediscovers it from the boot manifest under a different ID → duplicate. Fix: cross-reference with `_bootIds` and strip decorative suffixes (`-style`, `-chrome`, `-css`) to resolve the canonical package name. Also add the skin to `_skinBodyAttrs` so activation detection works. |
| Missing `pluginId` on `registerActivityBarItem()` | Plugin appears in Settings panel but "Open" button is missing | dock-base's `pluginEntryItem()` matches via `(item.pluginId ?? item.id) === pluginId`. Without `pluginId`, the fallback `item.id` is `'dock-flash:quick-control'` which doesn't equal `'dock-flash'` → no match → no "Open" button. Fix: add `pluginId: 'dock-flash'` to the activity bar item registration (must match the `id` passed to `registerPlugin()`). |
| Using `L('key')` (function) for `registerPlugin` title/description | Plugin card shows blank name and description | dock-base's `createPluginCard` renders `plugin.title` and `plugin.description` directly as React children — it does NOT call `resolveSettingText()`. A function child renders as blank. Unlike `registerPanel`/`registerActivityBarItem` which accept `() => string` for i18n, `registerPlugin` requires **static strings**. |
| Using `exports.inject = ['quickControl']` for third-party integration | Plugin fails to load when dock-flash is absent | Use Pattern B (optional integration): `exports.inject = []` + dual-discovery (`ctx.on('dock-flash:ready')` + `ctx.get('quickControl')`). Only use hard dependency if your plugin is meaningless without dock-flash. |
| Missing `registered` guard in dual-discovery | Switches registered twice (once from event, once from `ctx.get`) | Add `if (registered) return` guard at the top of the registration function. Both the event and active check can fire for the same plugin. |
| Only using `ctx.get('quickControl')` without `ctx.on('dock-flash:ready')` | Switches never appear when third-party plugin loads before dock-flash | Must use dual-discovery: passive (event listener) covers the "we load first" case, active (`ctx.get`) covers the "dock-flash already loaded" case. |
| Using `"dock-flash/client"` in third-party `dsh.client.inject` | Load-order hint silently ignored; third-party plugin may load before dock-flash | Same `arriveGraphRow()` limitation as `"dock-base/client"`: use `"dock-flash"` (base package name), NOT `"dock-flash/client"`. |
| Running the GraphFlow installer (`npx @roarpeng/graphflow install`) inside this repo | **`AGENTS.md` is overwritten** — the 500+ lines of dock-flash rules are replaced by GraphFlow's own "for Claude Code" setup notes, and `CLAUDE.md`, `GEMINI.md`, `.windsurfrules`, `.claude/`, `.graphflow-cache/`, `graphflow-out/` appear beside it | The installer writes `AGENTS.md` unconditionally. All six paths are `.gitignore`d, but the overwrite is the real damage — recover with `git checkout -- AGENTS.md` and keep GraphFlow's notes in `CLAUDE.md`. Verify with `grep -c dock-flash AGENTS.md` (a healthy file reports dozens, a clobbered one reports 0). |

---

## Known Dependencies

| Package | Type | Purpose | Notes |
|---|---|---|---|
| `dock-base` ^0.1.2 | peer (optional) | `ctx.workbench` registry services | Optional — plugin runs in standalone mode without it |
| `@deepseek-ai/cordis` ^4.0.1 | peer | Plugin framework | Required |
| `@deepseek-ai/dsh-settings` | devDep | Settings service types (host half) | |
| `@deepseek-ai/schemastery` | dep | Schema definition for settings | Required at runtime — host half `require()`s it inside `ctx.inject(['settings'], …)` |

---

## Version History Pattern

- Update version in **both** `package.json` (line 3) and `lib/client.js` (line 53: `console.log('[dock-flash] client v0.X.X')`)
- Both READMEs must stay in sync — same structure, same content, different language
- No changelog in READMEs — AGENTS.md and git log are the history records

### Notable versions

| Version | Change |
|---|---|
| 0.14.0 | Standalone mode: removed `inject: ['workbench']` hard dependency; `mountStandalonePanel()` for no-dock-base scenarios; dock-base marked optional peer dep |
| 0.15.0 | Fixed `dsh.client.inject` (must use `"dock-base"` not `"dock-base/client"` — inject path doesn't strip `/client` suffix); fixed standalone panel rendering (`require('react-dom/client')` for `createRoot`); standalone button draggable + four-corner position preset switch |
| 0.15.1 | Fixed sidebar sash drag broken by `style.zoom` on `<html>`: even `zoom:1` distorts browser coordinate system; `_applyZoom(100)` now calls `removeProperty('zoom')` instead of setting `zoom:1` |
| 0.15.2 | Removed page zoom feature entirely — CSS `zoom` on `<html>` breaks browser coordinate system at any value; added legacy cleanup (`removeProperty('zoom')` + `localStorage.removeItem`) on startup |
| 0.15.3 | Fixed duplicate Claude Style skin entries in dropdown: Phase 1b used raw `data-skin-chrome` value as plugin ID (`claude-style-skin-style`) instead of canonical package name (`claude-style-skin`), so Phase 4 added a second entry from the boot manifest; now cross-references chrome value with boot manifest and strips decorative suffixes (`-style`, `-chrome`, `-css`) to resolve the real package ID; added `claude-style-skin` → `data-dsh-claude-style` body-attr mapping |
| 0.16.0 | Optional third-party integration: added `dock-flash:ready` event emission after `ctx.provide('quickControl', registry)` so plugins can discover dock-flash without hard dependency; dual-discovery pattern (event + `ctx.get()`); standalone mode already renders third-party switches in Extensions tab (no code change needed); `dock-flash-qc-types` package for zero-runtime TypeScript definitions; `INTEGRATION.md` / `INTEGRATION.zh-CN.md` integration guides; `dock-flash-qc-demo` updated with both hard-dep and optional patterns |
| 0.17.0 | Standalone mode visual consistency with dock-base: trigger button changed from 44px circle to 36px rounded-rect matching `.dsh-wb-activity button` style (transparent bg, hover tint, active blue tint); panel container aligned with `.dsh-wb-floating` style (borderRadius 10px, bg-layer-2, deeper shadow, overflow hidden, flex column); added floating title bar mimicking `.dsh-wb-floating-head` (⠿ grip + ⚡ icon + "Quick" title + × close button); title bar supports drag-to-move; close button closes panel and deactivates trigger |
| 0.18.0 | Standalone mode trigger moved from floating `position:fixed` button to `sidebar.footer.action` slot injection (same slot as CordisPanel badge); badge shows ⚡ icon + label when sidebar wide, icon-only when rail; removed four-corner position presets (`POS_PRESETS`, `PRESET_STYLES`, etc.), `dock-flash:standalone-position` buttongroup switch, trigger drag support, and related i18n keys; floating panel positioned above the badge via `getBoundingClientRect()`; legacy `localStorage.removeItem('dock-flash:standalone-position')` cleanup on startup; added trigger-position switch with 4 options: `sidebar.footer.action` (badge style, ⚡+label wide / ⚡ rail), `conversation.input.left` (icon button), `conversation.input.right` (icon button), `conversation.session.header.actions` (small icon button); position persisted in `dock-flash:trigger-position`; switching position disposes old slot injection and injects into new slot |
| 0.19.0 | Proxy improvements #4 and #5: (#4) Host-side `GET /plugins/dock-flash/proxy-status` route returns current `NO_PROXY` env var + `useProxy` setting; client fetches on startup and after changes, shows actual `NO_PROXY` value as a subtitle beneath the proxy toggle via new `subtitle` field on toggle switches; (#5) Host-side `POST /plugins/dock-flash/test-connection` route fetches `https://www.google.com/generate_204` and returns success/failure + latency; client registers a `dock-flash:test-connection` action switch that calls this endpoint and records results (✅ success + latency / ❌ failure + error) in the changelog; host half now lazily injects `webServer` service for HTTP routes |
| 0.20.0 | Proxy improvement #6 — fine-grained proxy rules: replaced on/off toggle with `select` switch offering 4 modes: `all-proxy` (NO_PROXY cleared, all traffic proxied), `api-bypass` (NO_PROXY=`api.deepseek.com,chat.deepseek.com`), `all-bypass` (NO_PROXY=`*`), `custom` (user-defined NO_PROXY via `prompt()`); host schema adds `proxyMode` (string) + `customNoProxy` (string) alongside legacy `useProxy`; `applyProxyEnv()` now calls `@deepseek-ai/dsh-http-proxy`'s `installProxyFromEnvironment()` to re-install the undici global dispatcher (writing `process.env.NO_PROXY` alone is insufficient — the dispatcher freezes its policy at startup); `/proxy-status` route returns `proxyMode` + `customNoProxy` + `noProxy`; `/test-connection` uses `https://github.com` and treats any HTTP response as success; client migrates legacy `dock-flash:use-proxy` localStorage key → `dock-flash:proxy-mode` on first read; startup sync and `settings/updated` listener handle both `proxyMode` and legacy `useProxy`; `renderSelectSwitch` supports `subtitle` field; selecting "custom" prompts for NO_PROXY value (cancel reverts select to previous mode); proxy scope documented (only affects `fetch()` within DSH Node.js process — `node:http`, self-built transports, OS apps are unaffected); action button (`renderActionSwitch`) bugfix: `actionLabel` is typically a function but was passed as-is to `h('button', ...)` — React silently ignores function children; added `typeof === 'function'` check; button styling enlarged (`S.btnAction` padding/fontSize/minHeight increased); host→local sync race condition fix: `_suppressHostSync` flag prevents `_fetchProxyStatus()` from overwriting a just-set mode before the host confirms it |
| 1.0.0 | First stable release. All prior development history squashed into a single commit. `prepare` script removed: with `dist/` tracked, a git install needs no build at all, so declaring `prepare` only forced pnpm ≥10 users to grant an `allowBuilds` permission before their first `dsh plugin add` could succeed. Version bumped from 0.20.0 in both `package.json` and `lib/client.js`. |
| 1.0.1 | Settings plugin entry renamed from "Quick" to **"Flash"**. Every other dock-family plugin titles its settings card with the package name minus the `dock-` prefix (Dock, Git, Files, Editor, Images, Markdown), so "Quick" was the sole outlier — and being merely a fragment of the panel's own "Quick Control" name, it gave users nothing to connect to the `dock-flash` package they installed. The floating title bar's hardcoded "Quick" now goes through `t('title')`, closing the only user-visible string that bypassed i18n. The activity-bar and panel name stays "Quick Control", which already matches how siblings name those (dock-git → "Git History", dock-base → "Dock settings"). |
| 1.0.2 | Removed the `dock-flash:dock-position` and `dock-flash:auto-hide` switches from workbench mode — both were pure duplicates of dock-base's own settings. dock-base already registers `DOCK_POSITION_SETTING` (a radiogroup over the same `left/right/top/bottom` values) and `DOCK_AUTO_HIDE_SETTING` (`off`/`edge`), and both wrote through the very same call dock-flash used, `wb.updateLayout({ dock })` / `{ autoHide }`, so one store had two entry points. There is nothing to replace them with: dock-base's layout store exposes only `dock` and `autoHide` to users, and its settings registry already covers `reserveSpace`, `hoverScale` and `nearScale`, so any new layout control would duplicate it too. Workbench layout group is now just `close-on-blur`, which dock-flash actually owns. Also dropped the 8 i18n keys the two switches used (`dockPosition`, `dockLeft/Right/Top/Bottom`, `autoHide`, `autoHideOff`, `autoHideEdge`; the latter two were already dead). Docs: removed the stale `Zoom` row (the feature was deleted in 0.15.2 but the READMEs still advertised it) and corrected `Close on Blur`'s Standalone column from ❌ to ✅ — it is registered in both modes and the standalone panel's `handleOutsideClick` reads the shared localStorage key. |
| 1.0.3 | Moved `close-on-blur` out of the switch registry and into the panel header: it is now a small icon toggle immediately left of the close (×) button, in **both** the workbench `headerComponent` and the standalone floating title bar. The `off`/`on` buttongroup that used to live in the Layout subgroup is gone, so **workbench mode no longer renders a Layout category at all** — no built-in switch carries `group: 'layout'` there any more, and `groupOrder.filter((g) => builtInGroups.has(g))` drops the empty group with no extra code. `trigger-position` (standalone only) is the sole remaining layout switch. The workbench header button paints its own state imperatively rather than with `useState`, because dock-base may call `headerComponent` as a plain render function, which would make hooks illegal. i18n: `closeOnBlurFloating` renamed to `closeOnBlurOn`, and both state labels reworded (`关闭/开启` → `已关闭/已开启`) since they now read as a tooltip ("失焦关闭: 已开启") instead of as option labels. Docs: the READMEs' mode table, switch table, grouping rules and mode notes were corrected — they still claimed standalone had no Layout switches and workbench had all three groups. |
| 1.0.4 | Dropped `sidebar.footer` from `TRIGGER_POSITIONS` — it injected the standalone trigger into `sidebar.footer.action`, a shared slot that CordisPanel and other plugins also occupy, so the badges visually collided. The default in `loadTriggerPosition()` moved from `'sidebar.footer'` to `'input.right'`; since that function validates the stored value against `TRIGGER_POSITIONS`, users who had `sidebar.footer` stored migrate to the new default automatically, with no explicit migration step. Dead code removed with it: the `badge` branch of the panel-positioning code (byte-identical to the `input` branch, so it had always been redundant), the `QuickTriggerBadge` component, the `style === 'badge'` ternary in `injectTrigger()`, and the `triggerSidebarFooter` i18n key. Trade-off accepted: every remaining position lives inside the conversation UI, so with no session open the standalone trigger is not rendered at all — `sidebar.footer.action` was the only always-present slot. |
