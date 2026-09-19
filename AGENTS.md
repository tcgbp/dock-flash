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
├── CHANGELOG.md          Release-by-release history (narrative; not rules)
└── AGENTS.md             This file — rules, contracts, invariants
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

**The bypass list is validated on the way in.** `custom` mode's value comes from a `prompt()`, and the grammar enforced there is exactly what this package matches with (`bypassesProxy`): entries split on commas or whitespace, `*` meaning everything, an optional leading `.`/`*.` meaning "this host and every subdomain under it", and an optional `:port` that must equal the URL's port. Blank is rejected — "bypass nothing" and "bypass everything" already have their own options — as is anything containing `/ ? # @ \`, which covers both a pasted proxy URL and CIDR. CIDR deserves its own mention: the matcher deliberately has no CIDR support, so `10.0.0.0/8` would sit in the list as a dead entry that bypasses nothing, and the message asks for a suffix instead. Malformed host names, IPv4 octets above 255 and ports outside 1-65535 are rejected too. Accepted values are normalized to a trimmed, comma-joined list, so a paste like `"a.com, b.com  c.com"` is stored as `a.com,b.com,c.com`; a rejection changes neither the mode nor the stored list.

`resolveNoProxy()` returns `undefined` for a **blank** custom value, i.e. it removes `NO_PROXY` the way `all-proxy` does rather than publishing `NO_PROXY=''`. Routing is identical either way — the parser drops empty entries — but the environment is not left carrying a set-but-empty variable for spawned children to read. Only the interactive path is validated: a value edited straight into `settings.yaml` reaches the host unchecked, and the blank rule above is the one piece of that the host enforces itself.

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

Common to every type: `icon`, `order`, `group`, `label` (string, or `() => string` for i18n), and
`visible`.

`visible: () => boolean` drops the switch from the panel while it stays registered — its state,
its changelog entries and every other reader keep working, so no dispose/re-register dance is
needed. The panel filters **before grouping**, so a group whose every switch is hidden does not
render its title above nothing, and `renderSwitch` checks it again as a backstop for other
callers. The predicate is re-evaluated on every render and the panel re-renders on any
`notifyChange`, which means a switch driven by `visible` **must** notify when its condition
changes, or it flips only on the next unrelated render. `_fetchProxyStatus()` does this for the
proxy controls via `notifyChange('dock-flash:system-proxy')`.

Per renderer:

| Field | Types | Effect |
|---|---|---|
| `subtitle` | `toggle`, `select` | Secondary line in the label column |
| `subtitleBlock` | `select` | Render `subtitle` as its own full-width, **wrapping** line below the row instead of inside the label column. Use it whenever the value is long enough that the inline variant's ellipsis hides the point — a URL, a path, a command. `S.switchSubtitle` (inline) sets `nowrap` + `text-overflow: ellipsis` because it shares the row with the control; `S.switchSubtitleBlock` drops both and adds `word-break: break-all`. |
| `tooltip` | `select` | `ⓘ` icon carrying a native `title` attribute |
| `actionLabel` | `action` | Button text (string, or `() => string`) |
| `getMeta`, `hideWhenEmpty`, `emptyText`, `onClear`, `clearTitle` | `log` | See the `log` row above. `hideWhenEmpty` renders nothing at all while `getLines()` is empty, instead of an empty box; `emptyText` is the placeholder used when it is *not* set |

> **Don't hide a switch's own value behind `tooltip`.** The test URL was once both a subtitle *and* a tooltip of the same string: the tooltip added a hover target and no information, while the subtitle truncated the URL at exactly the part worth reading. If a value matters, give it `subtitleBlock`. `dock-flash:test-url` has since dropped its subtitle line too — it is a bare label + select now, and hides itself while no proxy is configured.

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

dock-flash has no committed test suite — verify by eye after changes. Items are grouped where
one pass covers several concerns, and the proxy block is the most detailed because it is the
easiest to break invisibly.

1. **Panel renders**: Click ⚡ → the panel opens without crashing, and the dock survives a
   render error thrown on purpose inside a switch component (error-boundary UI replaces the
   whole dock disappearing).
2. **Skins**: Switch between CSS skins and back → styles change and are restored. Toggle
   Mineradio → the canvas mounts and unmounts. With `wxj-black-hole` installed, a theme change
   persists after the retry loop. `bloom-theme` / `black-hole` / `theme-manager` never appear in
   the dropdown. Claude Style appears exactly once while active *and* exactly once after
   switching away (no `data-skin-chrome` phantom).
3. **Skin preference**: Set a skin, refresh → it restores after ~300ms.
4. **Language**: Toggle → every label updates immediately, including inside the log block.
5. **Sidebar sash**: Drag it with dock-flash enabled → the width resizes correctly (nothing has
   left `style.zoom` on `<html>`).
6. **Third-party integration** — all four cases in one pass with `dock-flash-qc-demo`:
   installed alongside dock-flash (Pattern B) → its switches appear **once each** in 🧩
   Extensions, not twice; a plugin that only uses `ctx.on('dock-flash:ready')` with no `ctx.get`
   → still appears; with dock-flash uninstalled → the demo loads cleanly, registers nothing, and
   logs "dock-flash not detected".
7. **Proxy mode**: Switching mode must log, in the **host console**, `proxy mode=…` then
   `undici global dispatcher re-installed (env source=launchEnvironment)`, and once at startup
   `dsh-http-proxy resolved to …`. `GET /plugins/dock-flash/proxy-status` then reports the
   matching `noProxy`, and `proxyAvailable` **flips** between `all-proxy` (true) and `all-bypass`
   (false). If it never flips, the install is not reaching the dispatcher — see Critical Rule 11.
   Custom mode prompts for a NO_PROXY value, and cancel reverts.
   Custom's value is validated before it is stored: a blank value, CIDR, a pasted proxy URL, a bad
   host or a port outside 1-65535 raises an alert naming the entry and leaves both the mode and the
   stored list unchanged, while a valid list is normalized to comma-separated form. With a blank
   value written straight into `settings.yaml` instead, the host removes `NO_PROXY` (as `all-proxy`
   does) rather than publishing `NO_PROXY=''` — the host console then logs `NO_PROXY=<removed>`.
8. **Test URL**: hidden — together with **Test Connection** — whenever no proxy variable is
   configured (`_httpProxyValue` falsy, i.e. the host reports `httpProxy: null`); both appear as
   soon as one is. The row itself is a bare label + select: no icon, and no URL line above the
   Test Connection button. Presets apply on selection and survive a refresh; `custom` prompts,
   rejects anything not starting `http(s)://` with an alert, and reverts the select.
9. **Diagnostics log**: **absent entirely before the first test** — no header, no placeholder
   box. Run Test Connection → it appears with that run's lines (route, response status,
   header/body timings, body size). Run again → the block is **replaced**, not appended. ✕
   clears it, which hides the block again. Unlike Recent Changes it does not expire after 30s.
10. **Diagnostics on failure**: A closed port names `ECONNREFUSED` rather than "fetch failed"; a
    redirecting URL lists the chain hop by hop with a final URL; garbage yields `InvalidTestUrl`
    while the route still answers 200 rather than 500.
11. **Probe targets what is displayed**: Change the Test URL and immediately test → the logged
    `▶ <url>` is the new one, not the previous (the URL rides in the request body, so it cannot
    lag the UI).

### Key Observation Points

- **Browser DevTools console**: `[dock-flash]` prefixed logs for client-side events
- **Host process console**: `[dock-flash]` prefixed logs for proxy settings
- **localStorage**: Check `dock-flash:active-skin` key for skin persistence
- **DOM**: Inspect `<style data-plugin>`, `<style data-skin-chrome>`, and `data-dsh-*` attributes for skin state

---

## Common Pitfalls

Gotchas **not** already stated as a numbered Critical Rule. Those rules are the authoritative
form and each carries its own example, so they are not repeated here — check them first.

| Pitfall | Symptom | Fix |
|---|---|---|
| Two plugin IDs mapping to same `_skinBodyAttrs` key | Phantom duplicate entries in skin dropdown | Each attribute must map to exactly one plugin ID |
| `data-skin-chrome` value ≠ package name | Duplicate entries while that skin is active | Phase 1b uses the raw attribute as the plugin ID; if a skin sets its style-element id (`claude-style-skin-style`) rather than its package name, Phase 4 rediscovers it under a different ID. Cross-reference `_bootIds` and strip `-style`/`-chrome`/`-css`; also add the skin to `_skinBodyAttrs` |
| `React.createRoot` instead of `require('react-dom/client').createRoot` | Standalone panel renders nothing — no React root | `createRoot` is not on the `react` package. Workbench mode gets a root from dock-base; standalone mode must create its own |
| `registerActivityBarItem()` without `pluginId` | Listed in Settings but no "Open" button | `pluginEntryItem()` matches `pluginId ?? id`, and the fallback is `'dock-flash:quick-control'`, which never equals `'dock-flash'`. Add `pluginId: 'dock-flash'` |
| `L('key')` (a function) for `registerPlugin` title/description | Plugin card shows a blank name and description | `createPluginCard` renders those as React children and never calls `resolveSettingText()`. Unlike `registerPanel` / `registerActivityBarItem`, `registerPlugin` needs **static strings** |
| `"<pkg>/client"` in `dsh.client.inject` | Load-order hint silently ignored: wrong load order, or a third-party switch that never appears | `arriveGraphRow()` does not strip `/client` for inject lookups. Use the base names — `"dock-base"`, `"dock-flash"` |
| `exports.inject = ['quickControl']` for third-party integration | Plugin fails to load when dock-flash is absent | Pattern B: `exports.inject = []` + dual discovery |
| Half-implemented dual discovery | The switch registers twice, or never appears when the third party loads first | Both halves are required — the `registered` guard, and `ctx.on('dock-flash:ready')` alongside `ctx.get('quickControl')` |
| Running the GraphFlow installer in this repo | `AGENTS.md` replaced by GraphFlow's own "for Claude Code" notes | It writes `AGENTS.md` unconditionally. `git checkout -- AGENTS.md`, keep those notes in `CLAUDE.md`, verify with `grep -c dock-flash AGENTS.md` (healthy: dozens, clobbered: 0) |
| Hardcoding an environment-specific endpoint | An internal address published in the public repository | Make it a setting; keep built-in presets generic. Recovery needs `git filter-branch` **and** platform-side repository deletion — force-push only moves refs, and the old commits stay fetchable by SHA |
| Injecting raw error text into a single-line log block | One message spills over many lines and destroys the alignment | Collapse with `_oneLine(v, max)` before pushing the line |
| A diagnostic readout that answers a different question than the test | "Is a proxy active" and "what did the test do" disagree | Probe the same target in both: `proxyRouteForUrl()` takes the resolved `testUrl` |

---

## Known Dependencies

| Package | Type | Purpose | Notes |
|---|---|---|---|
| `dock-base` >=0.1.2-0 <1.0.0-0 \|\| >=0.2.0-0 <1.0.0-0 | peer (optional) | `ctx.workbench` registry services | Optional — plugin runs in standalone mode without it |
| `@deepseek-ai/cordis` >=4.0.0-rc.1 <5.0.0-0 \|\| >=4.0.1-0 <5.0.0-0 | peer | Plugin framework | Required |
| `@deepseek-ai/dsh-settings` | devDep | Settings service types (host half) | |
| `@deepseek-ai/schemastery` | dep | Schema definition for settings | Required at runtime — the host half **statically imports** it (default export; there is no named `Schema`). It must stay a real dependency: an ESM import of a missing package fails at load, unlike the old silent `require` in a try/catch |
| `@deepseek-ai/dsh-http-proxy` | **not declared** | Re-installs the undici global dispatcher; answers `proxyRouteFor` | Ships nested inside the DSH install and is deliberately *not* a dependency of this plugin. Loaded through `loadProxyModule()`, which resolves DSH's own copy — see the System proxy section |

> **Peer ranges must carry an explicit prerelease branch — one per tuple whose prereleases must resolve.** node-semver admits a prerelease only when some comparator in the range sits on the *same* `major.minor.patch` tuple and itself carries a prerelease tag, so a range that merely looks broad excludes the harness's prerelease builds silently, and a branch written for one tuple never covers another. Measured with semver 7.8.5: `>=4.0.1-0 <5.0.0-0` rejects `4.0.0-rc.10` — the cordis this machine's dock-base actually runs on — and `>=0.1.2-0 <1.0.0-0` rejects `0.2.0-rc.1`; the tables' `||` forms accept both, while keeping the previous branch so nothing already accepted is lost. Check any change here with a probe matrix that asserts *both* directions: the prerelease must be accepted **and** no version the old range accepted may become rejected (a first attempt at this very fix used `^4.0.1 || >=4.0.0-rc.1 <5.0.0-0` and silently dropped `4.0.1-0`). awesome-dsh-plugin's contributing guide requires this shape; without it users on a prerelease harness hit `ERESOLVE`.

---

## Version History Pattern

- Update version in **both** `package.json` (line 3) and `lib/client.js` (line 53: `console.log('[dock-flash] client v0.X.X')`)
- Both READMEs must stay in sync — same structure, same content, different language
- No changelog in the READMEs — `CHANGELOG.md` and git log are the history records

### Where the history lives

The release-by-release narrative is in **`CHANGELOG.md`**. It used to live here as a
table, and by 1.0.10 that table was 18 KB — 28% of this file, and past the point
where it earned its place next to the rules. Add new rows there, not here.
