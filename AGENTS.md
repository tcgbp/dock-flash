# AGENTS.md — dock-flash Development Rules

> This file documents known requirements, development constraints, testing conventions, and hard-won lessons for the dock-flash plugin. Read it before modifying `lib/client.js` or `src/index.ts`.

---

## Project Structure

```
dock-flash/
├── src/index.ts          HOST half — settings namespace + proxy toggle (tsc → dist/)
├── dist/index.js         Compiled host half
├── lib/client.js         BROWSER half — quickControl registry + panel + skin system + i18n (~3841 lines, single file, NO build step, organized by #region markers)
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
  // Register the dock-flash-owned switches — but NOT close-on-blur, which in
  // this mode exists only as the panel-header toggle
} else {
  // Standalone mode: inject the trigger button into the configured slot, and
  // register trigger-position + close-on-blur as Layout switches
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
│  - Owns testUrl (never hardcoded)       │
│  - HTTP API routes (webServer):         │
│    GET /proxy-status → proxy mode/state │
│    POST /test-connection → diagnostics  │
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

### System proxy: the test target is a setting, and diagnostics are structured

`testUrl` (default `https://www.google.com/generate_204`) is the address `POST /test-connection` probes. It lives in the settings namespace — **never** as a constant in `src/index.ts`.

It started life as a constant pointing at an internal host, and that address — private IP plus path naming — got published in this public repository, in both `src/index.ts` and the tracked `dist/` build output. So: no environment-specific endpoint here, default or otherwise. The presets on the `dock-flash:test-url` switch are deliberately generic public endpoints; the user's own target is entered through the `custom` option and persisted to their DSH profile on disk.

Three properties of the probe are deliberate and must survive refactoring:

- **`redirect: 'manual'` with a hand-rolled hop loop** (bounded by `MAX_REDIRECTS`). Following redirects silently conflates "302 to somewhere unreachable" with "connection refused"; recording the chain keeps them distinguishable.
- **Failures are returned as data, never thrown.** The route cannot 500, because the client has to render the outcome either way.
- **The nested undici `cause` is unpacked** into `causeName` / `causeMessage` / `causeCode` / `causeErrno`. `fetch()` on its own only ever says `TypeError: fetch failed`; the actionable part (`ENOTFOUND`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `bad port`, …) lives on `error.cause`.

`proxyRouteForUrl()` probes the **configured** test target, not a hardcoded host. It used to check `https://github.com` while the test used a different address, so "is a proxy active" and "what did the test actually do" could legitimately disagree — a confusing pair of answers with no way to tell which was lying.

The client sends the URL it is displaying in the request body, so the probe targets exactly what the user sees. This also removes a race: without it, clicking Test immediately after changing Test URL could probe the previous address, because `settings.update` is asynchronous and the host may not have applied it yet.

On the client the report is rendered by `_describeTest()` into the `dock-flash:proxy-log` switch. Every field must pass through `_oneLine()` first: error messages are not single-line in general — a module-resolution failure carries a whole "Require stack" — and one injected newline destroys the block's one-fact-per-line alignment.

The `log` switch type exists because the registry changelog cannot serve this purpose: it stores one line per entry and expires after 30 seconds, so it cannot present a multi-line report. The proxy log shows the **latest run only**, replacing it on every test, and hides itself entirely until the first test — the panel is short, and an empty titled box (or a wall of history) costs height without answering the question you just asked.

#### Talking to `@deepseek-ai/dsh-http-proxy` (read this before touching proxy code)

The package is **not a dependency of this plugin** and **`require` does not exist in this half**. Both of those were true for the whole life of the feature and combined into a silent total failure — see Critical Rule 11.

Four things must hold together, or the proxy mode switch changes nothing:

1. **Load it through one cached handle.** `loadProxyModule()` tries a bare `await import('@deepseek-ai/dsh-http-proxy')` first (for a setup that installs it for us) and otherwise resolves it with `createRequire(process.argv[1]).resolve(...)` and imports that path. `process.argv[1]` is the running DSH entry, so this lands on `<dsh>/node_modules/@deepseek-ai/dsh-http-proxy/lib/index.js`.
2. **That handle must be the *same module instance* DSH booted with.** The module keeps the resolved policy in module-level `active`/`installed` state, written only by `installProxyFromEnvironment` and read by `proxyRouteFor`. A second copy answers `DIRECT_ROUTE` forever, and installs a dispatcher DSH's own `proxyRouteFor` cannot see. Verified: resolving through `createRequire` from the same tree yields the identical instance, so the state is genuinely shared.
3. **Pass a `URL`, not a string.** `proxyRouteFor(new URL(u))` — the signature is `(url: URL)`. Handed a string it does not throw, it silently reports "direct", which is how this plugin spent its life printing 直连 for everything.
4. **Keep the returned disposer.** `installProxyFromEnvironment` returns `() => Promise<void>` that restores both the dispatcher and the module state. Ignoring it leaks one `ProxyAgent` and its socket pool per mode change. Release the previous install before taking a new one.

And resolve the policy from DSH's own environment: the ctx service **`launchEnvironment`** (`DSH_LAUNCH_ENVIRONMENT_KEY`) is the snapshot DSH resolved the boot-time policy from — it merges `process` | `project-env` | `user-env`, so reading `process.env` instead can disagree with the policy actually in force. `applyProxyEnv()` uses it as the base and overrides only `NO_PROXY`/`no_proxy`, which is the single field this plugin owns.

The narrow claim to keep honest: this plugin owns the **bypass list**, not the proxy address, and installing replaces the process-global dispatcher for everything in the DSH process.

### Module Loading

Client plugin is loaded via `window.__ModuleLoader__.load({ id, factory })`. The factory receives `require` and must use `require('react')` (not import). All React usage goes through `h = React.createElement`.

### Close-on-blur: one key, one writer, two controls

`close-on-blur` is exposed twice, and the two must never drift apart:

| Control | Where |
|---|---|
| Panel-header toggle | immediately left of the close (×) button — in the workbench `headerComponent` **and** in the standalone floating title bar |
| `buttongroup` switch | the **standalone** Layout subgroup, registered inside `mountStandaloneSlotTrigger` |

Workbench mode deliberately registers **no** such switch, which is why it renders no Layout category at all (see below).

Linkage is not automatic — the header toggle is painted imperatively, so React never re-renders it when the switch changes. Everything goes through the module-level helpers declared next to `LIGHTNING_ICON`:

- `readCloseOnBlur()` / `writeCloseOnBlur(on, registry)` — the **only** writer of `dock-flash:close-on-blur` (`'off'` | `'floating'`; anything that is not `'off'` counts as on).
- `subscribeCloseOnBlur(fn)` — `writeCloseOnBlur` repaints every subscriber. That is how a switch change reaches the header toggles.
- `writeCloseOnBlur` also calls `registry.notifyChange('dock-flash:close-on-blur')`. That is how a header toggle reaches the switch: `notifyChange` does `sw._v++; notify()`, `notify()` bumps the registry `version`, and the panel's `registry.subscribe` does `setRegVersion(registry.version)` — that **new** value is what re-renders the panel (an unchanged value would make React bail out). In workbench mode no switch with that id exists, so `notifyChange` no-ops via its `if (sw)` guard.

Never write `localStorage` for this key directly, and never add a third control without routing it through `writeCloseOnBlur` — otherwise one of the others silently stops tracking.

Two consequences worth knowing:

- Because no built-in switch carries `group: 'layout'` in **workbench** mode, the Layout subgroup is not rendered there and needs no special-casing: `groupOrder.filter((g) => builtInGroups.has(g))` already skips groups with no switches. In **standalone** mode the group exists and holds `trigger-position` plus `close-on-blur`.
- The workbench header button paints its own active state imperatively instead of using `useState`, because dock-base may invoke `headerComponent` as a plain render function rather than mounting it as a component — hooks would then be illegal. Do not "tidy this up" into a hook. Its repaint subscription is disposed inside the `ref` callback, which React calls with `null` on unmount.

### Stacking: why this panel needs its own context

In workbench mode dock-base renders the panel inside `.dsh-wb-root`, which is `position: fixed; z-index: 49` and therefore **establishes a stacking context**. Two consequences, pointing in opposite directions:

- **Raising our z-index cannot beat anything that lives outside that context.** dock-git and dock-files portal their menus/dialogs to `<body>` (z-index 200 / 300 / 1001), which is *outside* `.dsh-wb-root`. A large z-index on our panel is evaluated *inside* the root's context, i.e. at level 49 relative to those portals, so it changes nothing. If someone reports "our panel is under another plugin's menu/dialog", that is not fixable here — it needs a shared z-index scale, and dock-base's own `.dsh-wb-settings-overlay` (1100, but inside the root) has the same problem.
- **A static element loses to every positioned sibling, however small its z-index.** `S.root` used to set neither `position` nor `z-index`, so dock-git's `.dg-graph` — merely `position: absolute; z-index: 2` — painted over the whole panel.

`S.root` therefore sets `position: relative; z-index: 10`. That value is chosen, not guessed:

- **> 2**, so it beats in-content escapees such as `.dg-graph`;
- **< 70** (`.dsh-wb-floating`), so dock-base's own precedence — floating windows above docked panels — is preserved rather than inverted.

Do not raise it "to be safe": anything ≥ 70 would put the docked panel above dock-base's floating windows, and anything past the root's own 49 is meaningless at body level anyway. It also creates a stacking context, so if this panel ever gains a portalled child it will need its own escape hatch.

The standalone panel is unaffected — it is appended to `document.body` at z-index 99998, outside the root entirely, which is exactly why this bug only ever appeared in workbench mode.

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

### 11. `require` Does Not Exist in the Host Half — It Is ESM

`src/index.ts` compiles to ESM (`"type": "module"`, tsc `module: "esnext"`), and DSH's own entry is ESM too (`dsh` is `type: module`, `lib/bin.js` uses `import`). So inside the host half:

```ts
// ❌ ReferenceError: require is not defined
const { Schema } = require('@deepseek-ai/schemastery')
const { proxyRouteFor } = require('@deepseek-ai/dsh-http-proxy')

// ✅ a declared dependency: import it
import Schema from '@deepseek-ai/schemastery'   // default export only

// ✅ not a dependency, must resolve DSH's own copy: dynamic import
const mod = await loadProxyModule()
```

**The trap is that a `require` inside `try/catch` fails silently.** That is not hypothetical: it disabled the entire proxy feature for the whole life of the feature, because `installProxyFromEnvironment` was never reached and the failure only ever surfaced as a stray `routeError` string in the client's diagnostics log. Worse, `require('@deepseek-ai/schemastery')` sat in the `ctx.inject(['settings'], …)` callback, so the throw meant **`installSection` never ran and the `dock-flash` settings namespace was never registered at all** — every proxy setting silently reverted to its composition default.

When adding a host-side dependency, import it statically and declare it in `package.json`. When the module is DSH's rather than yours, see the dsh-http-proxy notes in the System proxy section — resolution alone is not enough there.

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
| `log` | `getLines()` | Read-only multi-line output block. Optional `hideWhenEmpty` (render nothing while there are no lines), `getMeta()` (right-aligned header status), `emptyText()`, `onClear()` + `clearTitle` (renders a ✕ button). See "System proxy: the test target is a setting" in Architecture |

### Optional switch fields

Common to every type: `icon`, `order`, `group`, `label` (string, or `() => string` for i18n).

Per renderer:

| Field | Types | Effect |
|---|---|---|
| `subtitle` | `toggle`, `select` | Secondary line in the label column |
| `subtitleBlock` | `select` | Render `subtitle` as its own full-width, **wrapping** line below the row instead of inside the label column. Use it whenever the value is long enough that the inline variant's ellipsis hides the point — a URL, a path, a command. `S.switchSubtitle` (inline) sets `nowrap` + `text-overflow: ellipsis` because it shares the row with the control; `S.switchSubtitleBlock` drops both and adds `word-break: break-all`. |
| `tooltip` | `select` | `ⓘ` icon carrying a native `title` attribute |
| `actionLabel` | `action` | Button text (string, or `() => string`) |
| `getMeta`, `hideWhenEmpty`, `emptyText`, `onClear`, `clearTitle` | `log` | See the `log` row above. `hideWhenEmpty` renders nothing at all while `getLines()` is empty, instead of an empty box; `emptyText` is the placeholder used when it is *not* set |

> **Don't hide a switch's own value behind `tooltip`.** The test URL was once both a subtitle *and* a tooltip of the same string: the tooltip added a hover target and no information, while the subtitle truncated the URL at exactly the part worth reading. If a value matters, give it `subtitleBlock`.

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
9. **Proxy Select**: Switch proxy mode (all-proxy / api-bypass / all-bypass / custom) → the **host console** logs `proxy mode=…` followed by `undici global dispatcher re-installed (env source=launchEnvironment)` and `dsh-http-proxy resolved to …`; `GET /plugins/dock-flash/proxy-status` then reports the matching `noProxy`, and its `proxyAvailable` **changes** between `all-proxy` (true) and `all-bypass` (false). If `proxyAvailable` never changes, the install is not reaching the dispatcher — see Critical Rule 11. Custom mode prompts for NO_PROXY value, cancel reverts
10. **Preference Restore**: Set skin, refresh page → saved skin auto-restores after 300ms
11. **Sidebar Sash Drag**: With dock-flash enabled, drag sidebar sash → width resizes correctly (no residual `style.zoom` on `<html>` interfering with coordinate system)
12. **No Duplicate Skin Entries**: Switch to Claude Style skin → dropdown shows exactly one entry; switch away → still exactly one entry for Claude Style (no phantom duplicate from `data-skin-chrome` vs boot manifest ID mismatch)
13. **Optional Integration (dock-flash present)**: Install `dock-flash-qc-demo` (Pattern B, `USE_HARD_DEPENDENCY = false`) → demo switches appear in 🧩 Extensions tab; plugin loads fine
14. **Optional Integration (dock-flash absent)**: Uninstall dock-flash → `dock-flash-qc-demo` still loads without error (console shows "dock-flash not detected" message); no switches registered (graceful)
15. **dock-flash:ready Event**: Install a test plugin that only uses `ctx.on('dock-flash:ready', ...)` (no `ctx.get`) → switches appear when dock-flash loads after the test plugin
16. **Dual-Discovery No Duplicate**: Install `dock-flash-qc-demo` (Pattern B) → each demo switch appears exactly once in Extensions tab (not duplicated)
17. **Test URL**: The effective URL is shown in full on its own line directly above the **Test Connection** button — it must not be truncated, and there must be no `ⓘ` hover on this row. Switch between presets → the line updates immediately and the choice survives a page refresh; pick `custom` → prompt appears, a value not starting with `http://`/`https://` is rejected with an alert and the select reverts; the host console logs `test-url sync` and `GET /proxy-status` reports the same `testUrl`
18. **Diagnostics Log**: **before the first test the block is absent entirely** — no header, no placeholder box. Run Test Connection → it appears with that run's lines (route, response status, header/body timings, body size). Run it again → the block is **replaced**, not appended: only the new run's lines are present. ✕ clears it, which hides the block again. The report does not expire after 30s, unlike Recent Changes
19. **Diagnostics on Failure**: Point Test URL at a closed port → the log names `ECONNREFUSED` (not just "fetch failed"); point it at a redirecting URL → the chain is listed hop by hop with a final URL; enter garbage → `InvalidTestUrl`, and the route still answers 200 rather than 500
20. **Probe Targets What Is Displayed**: Change Test URL and immediately click Test Connection → the logged `▶ <url>` is the new URL, not the previous one (the URL rides in the request body, so the probe cannot lag the UI)

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
| Hardcoding an environment-specific endpoint as a default | An internal address (private IP + path naming) is published in a public repository — it was in both `src/index.ts` and the tracked `dist/` | Make it a setting (`testUrl`), keep any built-in presets generic, and let the user enter their own target. Recovery needs `git filter-branch` + force-push: editing the file only removes it from the tip, and the old commits stay readable by SHA |
| Injecting raw error text into a single-line log block | One message spills across many lines and destroys the block's one-fact-per-line alignment (`TypeError: fetch failed` is fine, a module-resolution error is not) | Collapse with `_oneLine(v, max)` before pushing a log line — for `err.message`, `err.causeMessage`, `proxy.routeError`, redirect targets and body snippets |
| A diagnostic readout that answers a different question than the test does | "Is a proxy active" and "what did the test do" disagree, with no way to tell which is wrong | Probe the *same* target everywhere: `hasActiveProxy()` takes the resolved `testUrl` rather than a second hardcoded host |
| `require(...)` inside `try/catch` in the ESM host half | `ReferenceError: require is not defined`, swallowed — the feature silently does nothing while looking implemented | Import statically (declared deps) or go through `loadProxyModule()` (DSH's deps). See Critical Rule 11 |
| `require('@deepseek-ai/schemastery')` in the `ctx.inject(['settings'], …)` callback | The throw happens **before** `installSection`, so the settings namespace is never registered and every setting silently reverts to its composition default | The import is the one-liner: `import Schema from '@deepseek-ai/schemastery'` |
| Loading DSH's own package through a *second* module copy | `proxyRouteFor` answers "direct" forever, because the resolved policy lives in that package's module-level state | Resolve and import the exact instance DSH has: `createRequire(process.argv[1]).resolve(...)` + `import(pathToFileURL(...))` |
| Passing a string where `proxyRouteFor` wants a `URL` | Silently reports "direct" instead of throwing, so every test prints 直连 | `proxyRouteFor(new URL(u))` |
| Dropping the disposer returned by `installProxyFromEnvironment` | One `ProxyAgent` and its socket pool leak per proxy-mode change | Keep it and release the previous install before taking a new one |

---

## Known Dependencies

| Package | Type | Purpose | Notes |
|---|---|---|---|
| `dock-base` ^0.1.2 | peer (optional) | `ctx.workbench` registry services | Optional — plugin runs in standalone mode without it |
| `@deepseek-ai/cordis` ^4.0.1 | peer | Plugin framework | Required |
| `@deepseek-ai/dsh-settings` | devDep | Settings service types (host half) | |
| `@deepseek-ai/schemastery` | dep | Schema definition for settings | Required at runtime — the host half **statically imports** it (default export; there is no named `Schema`). It must stay a real dependency: an ESM import of a missing package fails at load, unlike the old silent `require` in a try/catch |
| `@deepseek-ai/dsh-http-proxy` | **not declared** | Re-installs the undici global dispatcher; answers `proxyRouteFor` | Ships nested inside the DSH install and is deliberately *not* a dependency of this plugin. Loaded through `loadProxyModule()`, which resolves DSH's own copy — see the System proxy section |

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
| 1.0.5 | Put the `close-on-blur` switch back into the **standalone** Layout subgroup while keeping the panel-header toggle, and made the two genuinely linked. All three readers/writers now go through one module-level channel next to `LIGHTNING_ICON`: `readCloseOnBlur()`, the single writer `writeCloseOnBlur(on, registry)`, and `subscribeCloseOnBlur(fn)`. `writeCloseOnBlur` repaints every subscriber (that is how the switch reaches the imperatively-painted header toggles) and calls `registry.notifyChange('dock-flash:close-on-blur')` (that is how a header toggle reaches the switch — the registry `version` bump is what re-renders the panel). This replaced four separate copies of the key/reader/writer that had accumulated across the panel component, the standalone title bar and `apply`, so drift between them is no longer possible. Workbench mode still registers no such switch and therefore still renders no Layout category. Docs: the README switch table regained the Close on Blur row (Standalone ✅), gained a missing Trigger Position row, and the mode/grouping notes were corrected. |
| 1.0.6 | Fixed the workbench panel being painted over by dock-git. `S.root` had neither `position` nor `z-index`, so the panel was a plain static block and **any** positioned sibling in dock-base's `.dsh-wb-root` won over it — dock-git's `.dg-graph` is only `position: absolute; z-index: 2` and still covered the whole panel. `S.root` now sets `position: relative; z-index: 10`: above in-content escapees like `.dg-graph` (2), below `.dsh-wb-floating` (70) so dock-base's own floating-above-docked precedence is preserved. The value is bounded on purpose — see the "Stacking: why this panel needs its own context" section for why raising it further cannot help against elements that live outside `.dsh-wb-root` and would invert dock-base's precedence above 70. |
| 1.0.7 | System-proxy refactor — **the test target became a setting, and the probe became diagnostic**. `TEST_URL` was a hardcoded internal host, which had published a private IP and its path naming in this public repository, in both `src/index.ts` and the tracked `dist/`; it is now `testUrl` in the settings namespace (default `https://www.google.com/generate_204`) and exposed as the `dock-flash:test-url` select (Google 204 / GitHub / DeepSeek API / a `custom` prompt, written through to the host and mirrored in localStorage like `proxyMode`). That address was also purged from history. `POST /test-connection` returns a structured report instead of `{ ok, latencyMs }`: the proxy route decision (`proxied`, `noProxy`, `httpProxy`, `mode`, `routeError`), the redirect chain walked hop-by-hop via `redirect: 'manual'` and bounded by `MAX_REDIRECTS` (following it silently conflated "302 to somewhere unreachable" with "connection refused"), split header/body timings, body size plus a 200-byte snippet of textual bodies (where a proxy's own block page shows up), and the unpacked undici `cause` as `causeCode`/`causeErrno`/`causeMessage` — `fetch()` alone only ever says `TypeError: fetch failed`. The probe accepts an optional `{ url }` body override, so it always targets what the UI is displaying and cannot lag an async `settings.update`. `hasActiveProxy()` now probes the configured target instead of a second hardcoded `https://github.com`, which had let "is a proxy active" and "what did the test do" disagree. New `log` switch type (`getLines` / `getMeta` / `emptyText` / `onClear` + `clearTitle`) renders a read-only multi-line block — the changelog could not serve this, being single-line with a 30s TTL — used by the new `dock-flash:proxy-log` switch, where every field passes through `_oneLine()` so a multi-line error cannot break the one-fact-per-line layout. |
| 1.0.8 | System-proxy UI cleanup. The `dock-flash:test-url` switch lost its `tooltip`: it was an `ⓘ` hover carrying the exact same string as its subtitle, so it added a hover target and no information. The subtitle moved out of the label column onto its own full-width line via the new `subtitleBlock` option on `select` switches — the inline variant sets `nowrap` + `text-overflow: ellipsis` because it shares the row with the control, which truncated the URL at precisely the part worth reading (host and path). The effective URL now occupies a whole line directly above the **Test Connection** button, and the row above it is a bare label + select with nothing explanatory in between. Because the URL line is the `test-url` switch's own subtitle rather than a separate element, no new switch type was needed and the value stays next to the control that changes it. `renderSelectSwitch` was restructured around that (also dropping a dead `currentOpt`/`currentLabel` pair that was computed and never read). Client-half only — takes effect on page refresh, no DSH restart. |
| 1.0.9 | **The proxy feature never worked, and now it does.** Four independent defects had combined into a silent total failure, all of them invisible because each was swallowed by a `try/catch` or by a "returns direct" code path: (1) `require` does not exist in the ESM host half, so every `require('@deepseek-ai/dsh-http-proxy')` threw `ReferenceError` — `installProxyFromEnvironment` was therefore **never called**, meaning changing the proxy mode never affected actual traffic, only the `NO_PROXY` string; (2) the same throw in `require('@deepseek-ai/schemastery')` happened *inside* the `ctx.inject(['settings'], …)` callback, so `installSection` was never reached and **the `dock-flash` settings namespace was never registered at all** — `proxyMode`, `customNoProxy` and `testUrl` all silently reverted to their composition defaults; (3) `proxyRouteFor(url)` was passed a **string** where it wants a `URL`, and it does not throw on a string, it just answers "direct" — which is why every diagnostics run printed 直连; (4) `installProxyFromEnvironment`'s disposer was dropped, leaking one `ProxyAgent` per mode change. Fixes: `Schema` is now a static default import (schemastery has no named export); the proxy package is loaded once through `loadProxyModule()`, which resolves **DSH's own copy** via `createRequire(process.argv[1]).resolve(...)` so the module-level policy state is shared with the install DSH performed at boot (a second copy would answer "direct" forever — verified that `createRequire` + `pathToFileURL` yields the identical instance); the policy is now based on the `launchEnvironment` ctx service rather than `process.env`, since that snapshot merges the `process`/`project-env`/`user-env` layers DSH actually resolved from; only `NO_PROXY`/`no_proxy` are overridden; `proxyRouteFor(new URL(u))`; and the previous install is released before a new one. `/proxy-status` gained `httpProxy` because `proxyAvailable` alone cannot distinguish "no proxy configured" from "configured, and this URL is deliberately bypassed" — the client's ⓘ tooltip was keyed off the wrong one and called a deliberate bypass a misconfiguration. The invalid-URL branch no longer probes the route, so the log stops printing "Invalid URL" twice. Verified with a host-harness run (17/17) that drives the real routes with `process.argv[1]` pointed at the DSH entry. |
| 1.0.10 | Diagnostics-log presentation, from use rather than from theory. `renderLogSwitch` gained `hideWhenEmpty` and `dock-flash:proxy-log` sets it: **before the first test the block is absent entirely** — previously it rendered a titled, empty box that took panel height and pushed the controls below it down. The log also now holds the **latest run only**, replacing its contents on every test, instead of the capped 200-line append-only ring buffer (one report is self-contained at ~15 lines, since the host caps the redirect chain, so the cap and the `_PROXY_LOG_MAX` shift loop are gone). The now-dead `proxyLogEmpty` i18n key was removed from both locales. Rationale: the panel is short, and both an empty box and a wall of history cost height without answering the question just asked. Client-half only — takes effect on page refresh. |
