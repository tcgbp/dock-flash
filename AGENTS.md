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

**Always commit and push to Gitee.** No `github` remote is configured locally, deliberately: github.com is **intermittently** unreachable from the maintainer machine (TCP 443 resets, or 21 s timeouts, no proxy available), so a dual-push succeeds unpredictably — one repository can take the commit while the other rejects it — and the two then sit silently divergent until the mirror runs. The intermittency is the problem, not a permanent block; see the measured asymmetry below.

GitHub is updated by `.github/workflows/sync-from-gitee.yml`, which runs on GitHub's own runners (hourly, plus `workflow_dispatch`). It needs no local machine and no stored secret, because both repositories are public and the built-in `GITHUB_TOKEN` performs the push. Trigger it from the Actions tab — or from the command line, which is the route that still works while the maintainer machine cannot reach `github.com` at all.

**The blocking is host-specific, not total.** Measured in one sitting: eight consecutive `git push` attempts to `github.com:443` failed (connection resets, or 21 s connect timeouts), while `api.github.com` answered `HTTP 200` in 0.55 s at the same moment. So `git` is not the tool to reach for when the mirror looks stale — the API is. No new token is needed: the credential Git Credential Manager already holds for `github.com` carries the `workflow` scope (`gist, repo, workflow`).

```sh
tok=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $tok" \
  https://api.github.com/repos/tcgbp/dock-flash/actions/workflows/sync-from-gitee.yml/dispatches \
  -d '{"ref":"master"}'
```

`204` means the run is queued, and it settles in well under a minute. Verify through the API too, because `git ls-remote` needs the blocked host: compare `commit.tree.sha` from `/repos/tcgbp/dock-flash/commits/master` against the local `git rev-parse master^{tree}`. Matching **tree** hashes prove the two repositories hold identical content; identical *commit* hashes already imply that, so the tree comparison is what settles the question when the hashes differ — after a commit is re-created through the Git Data API, for instance, where the same tree gets a new sha. Keep the token in a shell variable for the single call, as above: never echo it, and never let it reach a log or a file.

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

### System proxy

`testUrl` is a **setting**, never a constant in `src/index.ts` (default
`https://www.google.com/generate_204`; the presets are deliberately generic public endpoints). Three
properties must survive refactoring: **`redirect: 'manual'` with a hand-rolled hop loop**
(`MAX_REDIRECTS`) — following redirects conflates "302 to somewhere unreachable" with "connection
refused"; **failures are returned as data, never thrown** — the route cannot 500; and **the nested
undici `cause` is unpacked** into `causeName`/`causeMessage`/`causeCode`/`causeErrno`, because
`fetch()` alone only ever says `TypeError: fetch failed`.

`proxyRouteForUrl()` probes the **configured** test target, not a hardcoded host, and the client
sends the URL it is displaying in the request body — so the probe targets exactly what the user sees
and cannot lag an async `settings.update`. Every client-side field passes through `_oneLine()` before
entering the log: error messages are not single-line in general, and one injected newline destroys
the one-fact-per-line layout. The log holds the **latest run only** and hides itself entirely until
the first test.

The proxy controls are one `cluster`; see "Panel ordering" above and the QuickControl API section.

#### Talking to `@deepseek-ai/dsh-http-proxy`

Four things must hold together, or the mode switch changes nothing: **load it through one cached
handle** (`loadProxyModule()`, resolving DSH's own copy via `createRequire(process.argv[1])`); **that
handle must be the same module instance DSH booted with** (a second copy answers `DIRECT_ROUTE`
forever); **pass a `URL`, not a string** (handed a string it does not throw, it silently reports
"direct"); and **keep the returned disposer** (ignoring it leaks one `ProxyAgent` and its socket pool
per mode change — release the previous install before taking a new one). Resolve the policy from the
ctx service **`launchEnvironment`**, not `process.env`; override only `NO_PROXY`/`no_proxy`. The
narrow claim to keep honest: this plugin owns the **bypass list**, not the proxy address, and
installing replaces the process-global dispatcher for everything in the DSH process.

**The bypass list is validated on the way in** (`custom` mode), against the grammar the package
actually matches with: entries split on commas or whitespace, `*` means everything, an optional
leading `.`/`*.` means the host and every subdomain under it, an optional `:port` must equal the URL's
port. Rejected: blank (the two things it could mean have their own options), anything containing
`/ ? # @ \` — which covers both a pasted proxy URL and CIDR (the matcher has no CIDR support, so
`10.0.0.0/8` would sit there as a dead entry) — malformed hosts, IPv4 octets above 255, and ports
outside 1-65535. Accepted values are normalized to a trimmed, comma-joined list; a rejection changes
neither the mode nor the stored list. `resolveNoProxy()` returns `undefined` for a **blank** custom
value, removing `NO_PROXY` the way `all-proxy` does rather than publishing `NO_PROXY=''`; the host
enforces that blank rule itself, since a value edited straight into `settings.yaml` never passes
through the prompt.

> The four defects that made the proxy a silent no-op for the entire life of the feature, and the
> measured detail behind each rule above: [docs/architecture-notes.md](docs/architecture-notes.md).

### Module Loading

Client plugin is loaded via `window.__ModuleLoader__.load({ id, factory })`. The factory receives `require` and must use `require('react')` (not import). All React usage goes through `h = React.createElement`.

### Close-on-blur: one key, one writer, two controls

Exposed twice — the panel-header toggle (workbench `headerComponent` and the standalone title bar)
and, in **standalone mode only**, a `buttongroup` switch in the Layout subgroup. Everything goes
through the module-level helpers next to `LIGHTNING_ICON`: `readCloseOnBlur()`, the single writer
`writeCloseOnBlur(on, registry)`, and `subscribeCloseOnBlur(fn)`. The writer repaints every
subscriber (that is how a switch change reaches the imperatively-painted header toggles) and calls
`registry.notifyChange` (that is how a header toggle reaches the switch — the registry `version` bump
is what re-renders the panel).

**Never write `localStorage` for this key directly, and never add a third control without routing it
through `writeCloseOnBlur`** — otherwise one of the others silently stops tracking. Workbench mode
registers no such switch, so it renders no Layout category at all; the workbench header button paints
its state imperatively rather than with `useState`, because dock-base may call `headerComponent` as a
plain render function, which would make hooks illegal. Do not "tidy this up" into a hook.

> The full linkage chain, and why the Layout group disappears in workbench mode:
> [docs/architecture-notes.md](docs/architecture-notes.md).

### Panel ordering and visibility: two modes, one writer

Users can reorder the panel's groups and switches, and hide individual rows, from icons in the
header of every page that has something to rearrange (not the Changes page), immediately left of the
collapse chevron, icon-only, each handler calling `stopPropagation()` because that header is itself
the collapse control.

**Entering either mode opens its tab.** The header is reachable while a tab is folded (`isOpen` gates the body only), so both mode buttons call `ensureTabOpen(page.id)` — open if collapsed, no-op if open, never closing — and do so AFTER `stopPropagation()`, or the header’s own `toggleTab` re-collapses it in the same click.

**Two modes, mutually exclusive by construction, not by a guard**: `◉` opens visibility, `⇅`
reordering, and while either is open **the other's entry button is not rendered** — header `◉ ⇅ ▶`
idle, `✓ ↺ ▶` in either mode, no state where a row has both a ▲▼ pair and a hide box. Do not merge them: two adjacent small controls, one of
which makes a row vanish, is a mis-click that removes the row you were about to move. `↺` is a single button whose
action follows the open mode, and **each mode resets only its own half** — order and visibility are
independent intents, so there is deliberately no combined "restore everything".

Seven invariants:

- **One key, one writer, and the writer is the preference bridge.** Order AND visibility both live
  in the host settings namespace (`panelOrder`, as `switches` and `hidden`); `writePanelOrder()`,
  `clearPanelOrder()` and `clearPanelHidden()` are the only writers and all go through `savePrefs()`
  — memory + localStorage + host in one call. Group keys are scope-qualified: `builtin:<group>` for
  the Workbench tab, `ext:<source>` for an Extensions group, because the two tabs name groups from
  different namespaces. Each clear carries the OTHER field through untouched, and neither
  `localStorage.removeItem`s the key: removing it would drop the half it preserves.
- **Two layers of "not shown", ANDed, never merged.** A switch's `visible()` is the PLUGIN saying "I
  do not apply right now"; `panelOrder.hidden` is the USER saying "I do not want it". So a user
  cannot force back a row the plugin has stood down, and a plugin cannot drag back one the user put
  away. Hidden rows are listed **only** in visibility mode (un-hiding needs them on screen) and
  filtered on every other surface, which is what keeps the normal view and reorder mode agreeing
  about what exists.
- **A unit, not a switch, is what moves.** `groupUnits()` splits a group into units: a plain switch
  is a unit of one, and switches sharing a `cluster` label are ONE unit keyed by `\0cluster:<label>`
  — the label, not the head's id, because `visible()` can hide any member, so a head-keyed unit would
  change key the moment the head was hidden while another member stayed on screen.
- **Only deviations are stored.** Defaults still come from each switch's `order`, so a newly
  installed plugin or switch appends to its group. Stale keys are RETAINED when a move writes the
  list back, so a merely-hidden group or unit keeps its slot; `applyOrder` filters them for display.
- **One function decides display order.** `displayUnits()` feeds the normal view AND edit mode — the
  only reason the arrows can be trusted to agree with the result. An untouched group keeps the
  historical toggles-grid-then-rest look; a customized one renders strictly in the saved order and
  therefore flattens, because a strict order and a two-bucket split cannot both hold.
- **A cluster is one card, its members folded — never dropped.** The card carries the head, members
  hang off a left rail, and the same card is drawn in and out of edit mode. The fold control is the
  card's **last row, centred**, arrow pointing the way the click moves the content (`▼` reveals,
  `▲` tucks away) — keep it there rather than beside the head, where it reads as an ornament, and
  keep it **count-free** (a number beside a triangle reads as a badge). It defaults to **FOLDED**.
  Reordering forces it open and omits the fold button, because the body is click-through there and a
  dead control is worse than a long block. Membership never changes shape — that is the point of a
  fold over a `visible` gate: the panel's structure and the saved order survive a proxy being
  configured or removed.
- **A destructive or non-obvious action gets a receipt, and the receipt names the tab.** `↺` and the
  `⇅` **exit** both replace the tab title with a sentence for ~1.6s. The notice holds the tab id and
  a `kind`, never a boolean, so only the pressed tab renames. Only `⇅`'s exit direction reports —
  entering already shows feedback (the arrows appear, the glyph flips), and it reads `orderEdit`
  *before* toggling to tell the two directions apart. `↺`'s tooltip is per tab because the
  disabled-plugin records live under `ext:*` alone, so the warning belongs to the Extensions tab and
  would be a false claim on Workbench.

`__dockFlashPanelOrder()` prints the order the last render resolved next to what is persisted.

> The reasoning, the two-bucket-split trade-off and the fold's history:
> [docs/architecture-notes.md](docs/architecture-notes.md).

### Stacking

`S.root` sets `position: relative; z-index: 10` — chosen, not guessed: **> 2** so it beats
in-content escapees such as dock-git's `.dg-graph` (z-index 2), and **< 70** so dock-base's own
precedence (floating above docked) is preserved. Raising it further cannot help against elements
outside `.dsh-wb-root`'s stacking context, and ≥ 70 would invert dock-base's order. The standalone
panel is unaffected (appended to `<body>` at z-index 99998).

> Why a static element loses to every positioned sibling:
> [docs/architecture-notes.md](docs/architecture-notes.md).

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
| **Excluded** | bloom-theme, black-hole, theme-manager, any `timeline` plugin | Filtered by `_skinExclude`, never appear in dropdown |

> **A timeline plugin is not a skin, and `_skinExclude` is what keeps it out.** `dsh-codex-timeline` matches `_skinHint` through its `codex` token — a token that exists for a real Codex-style skin — and injects `<style data-plugin="dsh-codex-timeline">`, i.e. it looks exactly like a CSS skin to the DOM scan. It must not be listed: the switcher deactivates a skin by **removing** its style element (Critical Rule 2), which would strip that plugin's own stylesheet. `_skinExclude`'s `timeline` entry and `_timelineOwner()`'s `/timeline/i` are the same notion — "another plugin owns the turn rail" — and the turn-rail switch stands down when either reports it.

> **Without dsh-market**: the skin switcher is not registered at all — `_registerSkinSwitch()` is only called from `_refreshMarketThemes()` on success. Without market, disabled themes are invisible to DOM scan and the list would be incomplete.

### Managed Skin Configuration

| Skin | localStorage Key | Activation Attribute |
|---|---|---|
| Mineradio | `dsh.ui-mineradio.enabled` | `data-dsh-aqua` |

### User preferences live in the host, not the browser

`panelOrder`, `activeSkin` and `triggerPosition` are **host settings**, not localStorage keys —
localStorage is a **cache**, never the authority. The layer (`#region Preferences`) is shaped by one
constraint: every reader is synchronous and on a render path, while the host is only reachable
through an async `remote.settings` call. So reads come from `_hostPrefs` (memory), the host is
consulted **once** in `apply()`, and `savePrefs()` writes memory + localStorage + host in one call.
The host wins once it has answered. `_prefCtx` holds the context for writers called from render
paths; it is null before `apply()`, which `savePrefs()` tolerates.

**`remote` is a typert namespace: it resolves only if the plugin declares it in `inject`.** A client plugin that merely `ctx.get('remote')`s it gets `undefined` — and a typert namespace is not a service, so there is no service lookup to fall back on. This plugin shipped with `inject: []` and therefore never reached the host settings at all; `@deepseek-ai/dsh-client-ui-settings`, which does the same job, declares `inject = ["remote", "remote.settings"]`. **Both names are required** — `remote` alone is not enough. One accessor, `_remoteSettings(ctx)`, is the only reader: it prefers `ctx.remote.settings`, keeps `ctx.get('remote')` as a fallback for an older surface, and every call site (the preference bridge, the proxy read-back, the two proxy writes, the black-hole hand-off) goes through it.

**`describe()` answers `{ ok, value }`, and the view is one level down: `value.namespaces`.** Each entry is `{ ns, value, base, user, applies, revision, secrets }`. The authority is `@deepseek-ai/dsh-client-ui-settings`, which unpacks it as `response.ok ? { view: response.value } : …` and then `view.namespaces.find((c) => c.ns === ns)`; the generated `typert.remote-client.js` is the other half of that contract. **This took three attempts, and the two wrong ones both looked right**: reading `desc.value` as the array (it is the view object), then reading `desc.namespaces` (one level too high). Both silently found nothing. The failure message reports the response keys *and* the `value` keys, so the next nesting mistake is visible instead of inferred, and 1.1.3 keeps a regression check that runs the two old expressions against a real response and shows them returning `null`.

**`settings.update(ns, patch, expectedRevision)` takes three arguments, and the runtime enforces the count** even though the wire schema marks the third optional (`z.union([z.undefined(), z.number()])`). Calling it with two throws `client api: settings/update expected 3 argument(s), got 2`. The revision is a compare-and-set token: it arrives as `ns.revision` in `describe()` and **changes on every successful write**, so it is cached in `_hostRevision`, sent on every write, and refreshed from `response.value.revision`. A stale revision fails exactly like a missing one, which is why the refresh is not optional. The authority for the pattern is `@deepseek-ai/dsh-client-ui-settings`: `expectedRevision ?? pendingRevision ?? snapshot.revision`.

**The descriptor's fields are `ns` and `value` — not `namespace` and `resolved`.** Both spellings
are accepted (`n.ns || n.namespace`, `ns.value || ns.resolved`) and the descriptor is echoed on
failure. Two habits follow, and they are the general lesson:

- **Never let a load path return a bare `false`.** Every exit records a *named* reason, logs it, and
  `__dockFlashPrefs()` reports the host's view beside localStorage's. This is Critical Rule 11's
  silent `require` in a new place.
- **Print the shape you did not recognise** — the failure message lists the descriptor's keys and the
  namespaces actually seen, so the next mismatch is a copy-paste rather than a bisect.

The Schema types the client's values **loosely on purpose**: `activeSkin` may name a skin absent
from this machine and `triggerPosition` names a slot the client validates against its own list, so an
`enum` in the host would make a stored preference un-writable the moment the client's lists change.
Two schemastery details: **`dict` takes `(value, key)`** (the reverse of how it reads, and wrong only
at first resolve), and **every level of a nested object needs `.default()`**, or the whole resolve
fails with `unsupported type "undefined"`. (Unrelated: `Schema.resolve(schema, options)` takes
**options**, not a value — call `Schema(value)`.) A validation failure rejects **before** anything is
persisted.

> Migration rules, and the 1.1.0 defect that produced the two habits above:
> [docs/architecture-notes.md](docs/architecture-notes.md).

### Preference Persistence

- Active skin is stored in the host settings namespace (`activeSkin`), with `localStorage`
  (`dock-flash:active-skin`) kept only as a cache — see "User preferences live in the host, not
  the browser" below
- The market's `live` theme is written through to both layers on read, but only when it
  disagrees with the host, so an unchanged value costs no round trip
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
| `log` | `getLines()` | Read-only multi-line output block. Optional `hideWhenEmpty` (render nothing while there are no lines), `getMeta()` (right-aligned header status), `emptyText()`, `onClear()` + `clearTitle` (renders a ✕ button). See "System proxy" in Architecture |

### Optional switch fields

Common to every type: `icon`, `order`, `group`, `label` (string, or `() => string` for i18n),
`visible`, and `cluster`.

`cluster: '<label>'` makes switches sharing a label **one unit** — one card in the panel, one
▲▼ pair while reordering, a fixed internal order (their `order` field). Use it for controls
whose meaning depends on staying together: the System proxy controls are the case that motivated
it (a mode select, the URL, the test button, the log). **A cluster opens folded — head row only
— and unfolds when the user asks.** Its members are kept registered and rendered, only *folded*:
never gated out by `visible`, and never removed, because a block that changes shape is exactly
the problem the fold exists to solve. Folding by default is what keeps such a block from
dominating a panel this short; it is not the hidden state it replaced, because the fold's own
control is on screen. A cluster's unit key is its **label**,
not its first member's id: `visible()` can still hide a member, so a head-keyed unit would change
key the moment the head was hidden while another member stayed on screen, and the saved slot
would be lost. A cluster is never a grid item (`isGridToggle()`) — a compact grid cell holds
exactly one control. See "Panel ordering and visibility: two modes, one writer" under Architecture.

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
| `hideLabel` | `action` | Drop the title column and let the button take the whole row. For an action whose button already carries its wording — Test Connection read "测试连接" twice, once as a title and once on the button. The definition keeps `label` either way: that is what the changelog and the panel name the entry with |
| `getMeta`, `hideWhenEmpty`, `emptyText`, `onClear`, `clearTitle` | `log` | See the `log` row above. `hideWhenEmpty` renders nothing at all while `getLines()` is empty, instead of an empty box; `emptyText` is the placeholder used when it is *not* set |

> **Don't hide a switch's own value behind `tooltip`.** The test URL was once both a subtitle *and* a tooltip of the same string: the tooltip added a hover target and no information, while the subtitle truncated the URL at exactly the part worth reading. If a value matters, give it `subtitleBlock`. `dock-flash:test-url` went further in 1.0.11 and dropped the line entirely — one step too far: with `custom` selected the select says only "Custom", so the address actually in force was the one thing the row did not show. It is back now (`subtitleBlock` + `subtitle: () => _resolveTestUrl()`), inside the proxy cluster's card.

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
8. **Test URL**: a permanent member of the proxy **cluster**, which **opens folded — the head
   row only — and unfolds when the user asks**, the fold being theirs to set from then on for
   the session. Check that switching the mode inside a folded cluster does **not** spring it
   open, and that entering reorder mode unfolds it. The row is a label + select **plus the
   effective
   address on its own wrapping line** (`subtitleBlock` + `subtitle: () => _resolveTestUrl()`),
   which 1.0.11 removed and this release restored: with `custom` selected the select alone says
   only "Custom", so the one value the control configures was the one thing it did not show.
   Presets apply on selection and survive a refresh; `custom` prompts, rejects anything not
   starting `http(s)://` with an alert, and reverts the select. **Test Connection** below it is
   `hideLabel`: the button already reads "Test Connection" / "Testing…", so the row is the button
   alone, full width.
   The cluster must read as ONE unit: a card (border + tinted background) with the head on it
   and the members hanging off a left rail beneath, and a single ▲▼ beside the whole card in
   reorder mode. It is never a grid item — `isGridToggle()` keeps a cluster out of the compact
   toggle grid, whose cells hold exactly one control.
9. **Diagnostics log**: **absent entirely before the first test** — no header, no placeholder
   box. Press Test Connection → it appears **immediately**, with the in-flight report: a
   `[stamp] ▶ <url>` line naming the address being tried plus a "Testing…" line, and `⏳` as the
   header meta, because the probe can take seconds and the log used to stay absent for the whole
   wait. When the answer lands, that report is **replaced** by the full one (route, response
   status, header/body timings, body size) in the same shape, so the block does not jump. Run
   again → replaced again, never appended. ✕ clears it, which hides the block again. Unlike
   Recent Changes it does not expire after 30s.
10. **Diagnostics on failure**: A closed port names `ECONNREFUSED` rather than "fetch failed"; a
    redirecting URL lists the chain hop by hop with a final URL; garbage yields `InvalidTestUrl`
    while the route still answers 200 rather than 500.
11. **Probe targets what is displayed**: Change the Test URL and immediately test → the logged
    `▶ <url>` is the new one, not the previous (the URL rides in the request body, so it cannot
    lag the UI).
12. **Panel ordering**: the ⇅ icon sits in the Workbench *and* Extensions headers, immediately
    left of the chevron, with no visible text (tooltips only), and clicking it does **not**
    collapse the tab. Move a group, and a switch inside a group → the normal view matches what
    edit mode showed, and a refresh keeps it. `↺` restores the default look (toggles grid
    first). The System proxy controls move as ONE block with a single ▲▼, keeping
    mode → URL → test → log, and configuring a proxy afterwards puts the newly visible rows
    back inside that block rather than at the end of the group.
    **Collapsed tab**: fold a tab, press either mode button — it opens AND turns the mode
    on in one click, without re-collapsing.
    **Visibility mode**: the idle header reads `◉ ⇅ ▶`; opening EITHER mode turns it into
    `✓ ↺ ▶` with the other mode’s entry gone — confirm there is no state with both a ▲▼
    pair and a hide box on one row. Untick a row → it leaves the normal view AND reorder
    mode, but stays listed here so it can come back. Hide a whole CLUSTER → ONE box hides
    the entire card, not its members one at a time. Then the two resets, which must not
    overlap: with both a customized order and a hidden row, `↺` in reorder mode restores the
    ORDER and leaves the row hidden, while `↺` in visibility mode shows every row and leaves
    the order alone. Both survive a refresh AND a different browser, and appear in
    `settings.yaml` as `panelOrder.hidden`.
13. **Preferences survive the browser, not just the reload** — the point of the host-backed move,
    and the one check that cannot be done from a single tab:
    - Move a group, hide a row, pick a skin, and (standalone) change the trigger position. Then open the
      **same profile in a different browser**, or clear this browser's localStorage and reload →
      all three come back. That is the whole feature; a reload alone proves nothing, because
      localStorage would have answered it too.
    - `settings.yaml` in the profile now carries `panelOrder`, `activeSkin` and
      `triggerPosition` under the `dock-flash` namespace.
    - **Upgrade path**: with localStorage holding values the host has never seen, reload → the
      host console logs `migrating browser-local preferences to host settings: …` once, and the
      values appear in `settings.yaml`. Reload again → no second log (idempotent, because by then
      the host is no longer empty).
    - With no settings service at all, the panel still renders and everything stays in
      localStorage — no crash, no empty panel.
    - A bad value typed straight into `settings.yaml` (say `panelOrder` as a list) is refused at
      load rather than corrupting the namespace, and the panel falls back to its defaults.

14. **Layout overflow — measure it, do not eyeball it.** The panel has no committed
    test suite and no headless browser, so "it looks fine" was the only check a UI change
    ever got — and that is how a horizontal scrollbar survived several releases without
    anyone writing it down as a defect. Run `__dockFlashOverflow()` in the browser console
    (panel open) after any change that touches sizing, padding, flex or a fixed width:
    - It reports **only dock-flash's own subtree** by default and returns
      `{ ok: true, overflowing: 0 }` when clean. `ok: false` lists the offending elements
      with `overX`/`overY` and their computed `overflowX`/`minWidth`, sorted by severity.
    - **Measure at two window widths, one of them narrow.** Overflow is a function of
      container width, so a single size proves nothing: the same markup that fits at
      1600px can overflow at 1100px. The narrow pass is the one that finds the bug.
    - `__dockFlashOverflow(true)` scans the whole page instead. Use it to answer "is this
      scrollbar even mine?" before hunting inside the plugin — the answer has been no
      before, and the container that overflowed belonged to DSH (`pI_x6G_rightbarCol` at
      `clientWidth: 0` holding 577px of content).
    - **A flex item's default `min-width: auto` means "never narrower than my content".**
      That single rule is behind every overflow this plugin has actually had; `minWidth: 0`
      on the shrinking box is the fix, and `box-sizing: border-box` is required whenever a
      `minWidth` floor and padding are combined.

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
| `React.createRoot` instead of `require('react-dom/client').createRoot` | Standalone panel renders nothing — no React root | `createRoot` is not on the `react` package; standalone mode must create its own |
| `registerActivityBarItem()` without `pluginId` | Listed in Settings but no "Open" button | `pluginEntryItem()` matches `pluginId ?? id`, whose fallback never equals `'dock-flash'`. Add `pluginId: 'dock-flash'` |
| `L('key')` (a function) for `registerPlugin` title/description | Blank name and description on the plugin card | `createPluginCard` renders those as React children and never calls `resolveSettingText()`. `registerPlugin` needs **static strings** |
| `"<pkg>/client"` in `dsh.client.inject` | Load-order hint silently ignored; a third-party switch never appears | `arriveGraphRow()` does not strip `/client` for inject lookups. Use base names — `"dock-base"`, `"dock-flash"` |
| `minWidth: 0` on a `flex: none` element | Looks like a shrink fix, is a no-op | `flex: none` is `flex-shrink: 0`, so there is nothing to act on. A no-op fix is worse than none — it reads as solved |
| A glyph wider than its font box | A 2-4px overflow that survives every structural fix | Size a pixel `inline-flex` box for the WIDEST glyph of any set that swaps, same box in both states, never derived from one font. See [notes](docs/architecture-notes.md) |
| An emoji-capable glyph as a small icon | A full-colour glyph beside monochrome `⇅`/`↺`/`▶` | `☑`/`☐` and an eye are emoji-presentation code points and render through the colour-emoji font on Windows. Prefer plain geometric shapes: `●`, `○`, `◉` |
| Diagnosing from the shape of the DOM tree | Fixing the wrong element confidently | The live element carries its own evidence — `__dockFlashOverflow()` prints each overflow's `text`. Read it before forming the hypothesis |
| Running the GraphFlow installer in this repo | `AGENTS.md` replaced by GraphFlow's own notes | It writes `AGENTS.md` unconditionally. `git checkout -- AGENTS.md`, keep those notes in `CLAUDE.md`, verify `grep -c dock-flash AGENTS.md` |

The rest — skin-scan duplicates, hardcoded endpoints, log-line injection, the diagnostic-target
mismatch, and the `_skinBodyAttrs` cases — are in **[docs/architecture-notes.md](docs/architecture-notes.md)**.

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

### Which number moves

The version is **this package's own** — it says nothing about a sibling's, and nothing compares
the two (npm, pnpm, the ModuleLoader and dsh-market all treat a plugin's version as private).
What declares compatibility with dock-base is the `peerDependencies` range, not a major number,
so `dock-flash 1.x` alongside `dock-base 0.2.2` is a supported pair by construction — and the
family is uneven anyway (dock-git 0.3.4, dock-files 0.3.0, dock-images 0.1.2, dock-base 0.2.2).
**Never renumber a released version:** a published tag and Release cannot be recalled, and
stepping back from `1.x` to `0.x` is not expressible as a non-breaking change for anyone holding a
range (`^1.0.0` accepts all of 1.x; `^0.2.2` accepts only `0.2.x`).

Increment by what a third party can observe, not by how large the change felt:

| Change | Number |
|---|---|
| Bug fix, internal refactor, docs, metadata | **patch** — `1.0.15` → `1.0.16` |
| A new switch; a new field on `QuickSwitchDefinition` (as `subtitleBlock`, `visible`, `cluster` and `hideLabel` each were); a new switch type (as `log` was); a new service or event | **minor** — `1.0.15` → `1.1.0` |
| Removing or renaming a published field, switch type, or a switch id other plugins may read; changing a route's response shape | **major** — `1.0.15` → `2.0.0` |

Additive is what makes a minor safe to take: no downstream range needs rewriting for a field that
did not exist before. The rule counts what **shipped**, not what a branch contained — dropping
`clusterOpen` in 1.0.15 did not make it a major, because that field never appeared in a published
version. Note that `1.0.1`–`1.0.15` shipped features as patches (`log`, `subtitleBlock`,
`visible`, `cluster`, `hideLabel`), and `1.0.0` was declared for a packaging milestone — history
squashed, `prepare` dropped — rather than for a frozen contract: those numbers are published and
stand, and this table governs the next one.

A change confined to files outside `files` in `package.json` — `AGENTS.md`, `CHANGELOG.md`,
`docs/` — is not a release, needs no bump, and commits as `docs:`.

### Where the history lives

The release-by-release narrative is in **`CHANGELOG.md`**. It used to live here as a
table, and by 1.0.10 that table was 18 KB — 28% of this file, and past the point
where it earned its place next to the rules. Add new rows there, not here.
