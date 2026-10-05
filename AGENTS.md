# AGENTS.md — dock-flash Development Rules

> This file documents known requirements, development constraints, testing conventions, and hard-won lessons for the dock-flash plugin. Read it before modifying `lib/client.js` or `src/index.ts`.


## What belongs in this file, and what does not

`AGENTS.md` is injected into **every request**, so its length is a cost paid on every turn. It holds
the **rules** — contracts, invariants, and the traps that cost real defects. Everything else belongs
in `docs/` and is read when it is relevant:

| Content | Where | Why |
|---|---|---|
| Contracts, invariants, Critical Rules | here | needed while writing code |
| Procedures (release steps, the test checklist) | `docs/` | needed when performing that task |
| The full integration guide | `INTEGRATION.md` | already published — must not drift |
| The "why" behind a rule, and measurements | `docs/architecture-notes.md` | read when the rule is questioned |

**The budget is 65536 bytes, and it is not advisory.** `dsh-base` mounts
`@deepseek-ai/dsh-agent-instructions` with `maxBytes: 65536`, and the cap applies to the complete
rendered baseline. Exceeding it does not error — it **truncates this file mid-sentence**, so the
failure mode is silently losing rules. `pnpm run check:docs` reports the headroom and fails when the
budget is exceeded or a link here stops resolving.

**Splitting into another project file does not help.** Only `AGENTS.md`, `CLAUDE.md` and their
`.local` overlays are discovered as candidates, and every candidate shares the one budget — a second
file buys nothing. `docs/` is not a candidate name, which is why relocation works.

---

## Project Structure

```
src/index.ts      HOST half      → tsc → dist/index.js
lib/client.js     BROWSER half   → single file, NO build step, edited directly
dist/index.js     compiled host half — TRACKED on purpose (see Build & Install)
cordis.patch.yml  bundle layer: inserts the host rows into the profile
package.json      manifest + dsh.client.inject
docs/             long-form notes — NOT injected, read on demand
scripts/          repo tooling — NOT published (see `files` in package.json)
```

Docs: `README.md` / `README.zh-CN.md` (English is canonical), `INTEGRATION.md` /
`INTEGRATION.zh-CN.md` (third-party guide), `CHANGELOG.md` (history), `AGENTS.md` (this file).
`docs/`: `architecture-notes.md` (the "why" and the measurements), `testing-checklist.md`,
`releasing.md`, `skin-system.md`, `panel-ordering.md`. `scripts/`: `check-docs-size.mjs`
(`pnpm run check:docs`), `check-overlay-mount.mjs` (`pnpm run check:overlay`).

- **Host half** (`src/index.ts`): compiled via `pnpm run build` (tsc). Touch only this file for host-side changes.
- **Client half** (`lib/client.js`): single monolithic file, edited directly — no build, no bundler, no TypeScript. Changes take effect on page refresh (symlinked in profile).
- **`pnpm run check:docs`**: verifies this file still fits its budget and that every link below resolves. Run it before committing a change to `AGENTS.md` or `docs/`.

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

**Gitee is authoritative; GitHub is a mirror.** The full procedure — remotes, the mirror workflow,
and the API route that still works while `github.com` is unreachable — is in
**[docs/releasing.md](docs/releasing.md)**. Three things must not be got wrong, so they stay here:

- **Always commit and push to Gitee.** No `github` remote is configured, deliberately: github.com is
  intermittently unreachable, so a dual-push succeeds unpredictably and the two repositories then sit
  silently divergent. `.github/workflows/sync-from-gitee.yml` is what updates GitHub.
- **Do not re-enable Gitee's 仓库镜像管理 push mirror.** It was tried and never delivered a single
  commit; a second, unverified mirror racing the workflow is how the two drift apart again.
- **`github.com` being unreachable is not the mirror being broken.** Measured in one sitting: eight
  consecutive `git push` attempts to `github.com:443` failed while `api.github.com` answered HTTP 200
  in 0.55 s. Reach for the API, not `git`.


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

**`sidebar.footer.action` is deliberately not offered as a trigger position.** It is a shared slot that CordisPanel and other plugins also occupy, and a second occupant produces visual conflicts with them. Do not re-add it to `TRIGGER_POSITIONS`, and keep the fallback in `loadTriggerPosition()` pointing at a conversation slot. Note the trade-off: every slot-based position lives inside the conversation UI, so with no session open the trigger is not rendered at all — that is accepted.

### The overlay trigger: the one position that is not a slot

`conversation.overlay` floats a draggable ⚡ inside the conversation's top-right corner. **Its
`TRIGGER_POSITIONS` entry carries no `slot`, and that absence is the mechanism** — `injectTrigger()`
takes the overlay path instead of registering into a slot. `conversation.session.header.corner` looks
right but is not usable: it is `kind: "single"` (the renderer keeps only `entriesOfSlot[0]`), so a
second occupant does not queue, it **disappears**, and `@deepseek-ai/dsh-client-ui-sidebar-right`
already ships there with its expand button.

The rules that must hold together — each one cost a defect:

- **The anchor is found structurally, never by class name.** `conversationViewport()` matches
  `div[class*="_scrollBody"]` whose computed `overflow-y` is auto/scroll, requires a non-zero box
  inside the viewport, and prefers the largest. The class is a CSS-module hash that changes on any DSH
  rebuild.
- **The scrollbar is cleared by arithmetic, not by a guessed width.** The element declares
  `scrollbar-gutter: stable`, so `rect.width - el.clientWidth` reads the reserved gutter exactly; a
  constant would be wrong on another platform and would make the button jump at the scroll threshold.
- **The turn rail is cleared through `turnRailProbe()`**, never by re-measuring
  `nav[class*="_frame"]` — that function already owns "is the rail visible", "has another plugin taken
  the surface", and "which candidate is the on-screen one". **Class tests use `*=` and never `$=`**,
  because DSH joins class lists; `_preview` is the one token that stays `$=`. Only a RIGHT-side rail
  competes with this corner, so `turn-rail-left` must not shift the button. **The left placement MIRRORS
  the rail's own `right`** (`_railNativeRight()`), never a formula of ours: that declaration encodes the
  slot geometry, which DSH restructured in 0.1.7, where the old `calc(12px - (clearance + 16px))` became
  a `-20px` offset that put the whole rail off the left edge.
- **The offset is `{dx, dy}` inward from the conversation corner, and the BUTTON is clamped, not the
  offset.** That is what makes it follow the corner when the right sidebar opens, the sash moves or the
  window resizes — which is why the observer is a `ResizeObserver` on the viewport and not a window
  `resize` listener (two of those three never fire one). A stored offset then survives a shrink that
  the position does not.
- **The button's size is `effectiveTriggerSize()`; no size literal may reappear in the positioning
  arithmetic.** The clamp, the scrollbar clearance and the rail give-way all measure the BUTTON, so a
  constant that disagrees with the drawn box parks the entry point over the rail or outside the
  conversation. `triggerIconSize()` (2/3) and `triggerRadius()` (1/4) derive from it. **The ceiling
  follows the selected position** — 48px in a slot, 64px at the overlay — and clamps what is DRAWN,
  never what is stored, so the host schema carries no min/max.
- **The glyph is real DOM, not a React element.** `LightningIcon()` returns a React element
  *descriptor* — a plain object — and `appendChild` needs a `Node`. Use `LightningIconNode()`, which
  builds the same `svg`/`path` via `createElementNS`.
- **Acquisition is retried, never attempted once.** `apply()` runs before any conversation exists. A
  subtree `MutationObserver` armed while no anchor is adopted — and **not** disconnected once one is
  found, because a new session builds a new scroller — plus a bounded retry for a viewport that exists
  but is not yet laid out. The mount is wrapped in a named, non-fatal catch.
- **Three user-settable properties, one writer each.** `triggerSize` (panel), `triggerLayer` and
  `overlayOpacity` (right-click menu). `panelLayer()` / `triggerLayerOfButton()` / `layerOfMenu()` are
  all DERIVED from the one setting, or the two drift and the size control looks inert. **Every
  host-owned numeric needs its own `adoptHost*` handler — subscribe AND call once**, because the host
  may answer before or after the mount; without it the value is read into `_hostPrefs` and never
  reaches anything.
- **Under the host means strictly below 1000.** DSH's modal is portaled to `document.body` at
  `z-index:1000`, so it compares as a plain SIBLING and its mask needs no z-index of its own; other
  overlays are 1100, host menus 1000. The "stay out of the way" preset is **9** and the default is
  **1150**. This affects the **standalone pair only** — the workbench panel's `z-index: 10` is bounded
  so dock-base's floating-above-docked precedence survives.
- **The menu holds ONLY what the panel cannot reach**, i.e. what this button alone can answer: reset
  position, offset, version, layer, opacity. **Never add `trigger-size`, `trigger-position` or
  `close-on-blur`** — a second control for a setting that already has one is how two surfaces start
  disagreeing (Critical Rule 7).
- **A preset list is read by TWO scopes, so it lives in the factory closure.** Declaring it beside the
  menu that renders it (inside the standalone closure) makes `_migrateLocalToHost` throw
  `ReferenceError`, and its own `.catch` swallows it — the entire host-preference load fails silently
  and every host setting reverts to a default.
- **"localStorage disagrees with the host" is NOT sufficient to migrate.** A removed preset's value and
  a user's own choice are both bare numbers, so the CURRENT preset list is what tells them apart, and
  the host is only overridden while it still sits at its default. Assert BOTH directions or the guard
  reads as a blanket refusal.

**Drag reuses the panel's machinery rather than adding a second one.** `beginOverlayDrag()` sets the
shared `dragging`/`dragSource`/`dragMoved` state, so `ensureGlobalListeners()`'s existing handlers
apply unchanged — including the ±3px threshold that `dragMoved` records, which the overlay's own click
handler reads to swallow the click ending a drag. Without that, releasing a drag would toggle the
panel. The offset is written on release, not per move: a drag is one intent, and a host round trip per
pixel is not.

**Swallowing the drag's click is the FIRST half of that handler, not the whole of it.** A hand-built
element has to call `openPanel()`/`closePanel()` itself; a handler that stopped at the swallow left a
button that mounted, positioned itself correctly and did nothing when pressed. `handleOutsideClick`
already exempts `[data-dock-flash-trigger]`, and `dragMoved` is cleared by the next `mousedown` rather
than by the drag's own end — which is why a click straight after a drag still works.

> Every rule above is the residue of a defect. The defects in full, with the measurements and the
> harness that proves them: [docs/architecture-notes.md](docs/architecture-notes.md).

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

**Why the base name**: `arriveGraphRow()` looks up `inject` entries with
`graphRows.get(packageName)` and never strips the `/client` suffix, while graph-row keys are base
package names — so `graphRows.get("dock-base/client")` returns `undefined` and the hint is silently
ignored. (The `external` path *does* strip it first; `inject` does not.)

### Two-Half Model

`cordis.patch.yml` is the bundle layer that inserts the host rows into the profile.

- **HOST** (`src/index.ts` → `dist/index.js`; Node.js via Cordis) owns the `dock-flash` settings
  namespace, panel/trigger/alert configuration, and the HTTP routes
  (`GET /host-alerts`, `POST /push-alert`, `POST /clear-alerts`, `GET /health`, etc.).
- **CLIENT** (`lib/client.js`; browser via `__ModuleLoader__`) owns the QuickControl registry
  (pub/sub), the React panel UI, the skin system, and i18n (zh/en).

> **The system proxy subsystem (B) has been extracted** into the `dsh-flash-proxy` plugin.
> Proxy mode, `NO_PROXY` policy, `testUrl`, connection diagnostics, and the five
> `dsh-flash-proxy:*` QuickControl switches now live in that separate package.
> See [docs/refactor-coupling-map.md](docs/refactor-coupling-map.md) for the extraction status.

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

Users reorder the panel's groups and switches, and hide individual rows, from header icons on every
page that has something to rearrange (not the Changes page); each handler calls `stopPropagation()`,
because that header is itself the collapse control. **One key, one writer**: order and visibility both
live in the host namespace (`panelOrder` as `switches` and `hidden`), and every write goes through
`writePanelOrder()` / `clearPanelOrder()` / `clearPanelHidden()` → `savePrefs()`. **A cluster is one
card with its members FOLDED by default, never dropped**, and a `visible()` gate is never how it is
folded.

> The two modes and their mutual exclusion, the tab-opening rule, the unit model, the inline
> (fold-free) cluster form, the receipt rule and the two-bucket-split trade-off:
> **[docs/panel-ordering.md](docs/panel-ordering.md)**.

### Stacking

`S.root` sets `position: relative; z-index: 10` — chosen, not guessed: **> 2** so it beats
in-content escapees such as dock-git's `.dg-graph` (z-index 2), and **< 70** so dock-base's own
precedence (floating above docked) is preserved. Raising it further cannot help against elements
outside `.dsh-wb-root`'s stacking context, and ≥ 70 would invert dock-base's order. The standalone
panel is a separate case: appended to `<body>`, it sits at the user's `triggerLayer` (default 1150),
which is above the host's overlays; the low preset 9 sits far *under* them. **That value only reaches
the DOM because `adoptHostLayer()` runs after the async host reply** — see "The overlay trigger"
above for why a host-owned numeric needs both a subscribe and an immediate call.

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

Every skin discovery phase (1a, 1b, 2, 4, 5, 6) must filter excluded plugins. Missing a phase causes excluded skins to appear in the dropdown:

```js
// Every scan loop must include:
if (_skinExclude.test(id)) continue
```

**Exclude the market itself, and never narrow the `skin` token.** `dsh-skin-market` supplies the
installed-skin list and was also offered as one of the skins, labelled `Market` by `_labelFromId()`
(strip `dsh-`, strip trailing `-skin`). The bare `skin` token in `_skinHint` is what makes every
`<name>-skin` package discoverable, so the market is excluded **by name** — narrowing the token would
put every real skin at risk. A derived label makes such an entry look deliberate, so the list is
asserted rather than eyeballed: `check:overlay` section 15 drives the real scan and pins the dropdown.

**A candidate must pass the ONE name predicate — in EVERY phase.** `_skinAllowed(id)` is stated once
and called from **all seven** entry paths into `_scanInstalledSkins()`: managed (0),
`style[data-plugin]` (1a), `style[data-skin-chrome]` (1b), body attributes (2), boot manifest / graph
rows (4), live marks (5), the profile manifest (6). It is a **pure name predicate** now, and
**both halves are inside it** — `_skinHint.test(id) && !_skinExclude.test(id)`. The market's registry
classification it once consulted is gone, along with the `/use-skin` path; see the skin section's
note. Phases 0 and 4 call `_skinAllowed` ALONE (the redundant standalone `_skinExclude.test` above is
the shape of the other five, not of those two) — anything that narrows the exclusion must go inside
`_skinAllowed`, because an id that skips it is listed. **A package nothing recognises PASSES** (a
plugin-local CSS skin must stay; only a KNOWN non-skin is dropped).
`dsh-client-liang-intensity-skin` is the worked example —
[docs/architecture-notes.md](docs/architecture-notes.md) has the measurements.

**ONE skin must yield ONE id, and that id is the PACKAGE name.** Filtering has one predicate;
identity had no single spelling, and that is the same defect twice: the dedup is exact string equality
while the phases and the plugin-manager merge each spell an id differently, so one skin enters the list
twice — and only ONE of those ids is addressable, so picking the other refuses silently. **The
canonicalization lives in phases 1a and 1b, because those are the two that read a RAW DOM string**:
`_canonicalSkinId()` strips a subpath and a scope, and 1b additionally strips a decorative suffix
(`-style`, `-chrome`, `-css`) **only when the stripped name is CONFIRMED by a known source, never
blindly** (a package may genuinely be called `foo-style`). The confirming set is the boot manifest /
graphRows, `_managedSkins`, **`_skinBodyAttrs`** — the strongest for a skin it lists, being this
plugin's own curated canonical-id table — and the ids earlier phases already saw. Phases 0, 2, 4, 5 and
6 need no canonicalization step: their ids come from a table or a manifest that already spells the
package name. **A new phase that reads a raw string must canonicalize before `seen.has()`/`seen.add()`**
— the plugin-manager path did not, which is how the 0.15.3 duplicate came back. The worked case and its
dump: [docs/skin-system.md](docs/skin-system.md).

> **`check:overlay` is green — 189 assertions, 0 FAIL.** The ten market-era assertions this note
> used to excuse as a "known, accepted red" are realigned, so a red assertion is a REAL regression
> now, never a baseline. Do not restore the market to explain one away; read the assertion.

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

// ✅ a declared dependency: import it
import Schema from '@deepseek-ai/schemastery'   // default export only
```

**The trap is that a `require` inside `try/catch` fails silently.** That is not hypothetical: `require('@deepseek-ai/schemastery')` sat in the `ctx.inject(['settings'], …)` callback, so the throw meant **`installSection` never ran and the `dock-flash` settings namespace was never registered at all** — every setting silently reverted to its composition default.

When adding a host-side dependency, import it statically and declare it in `package.json`. When the module is DSH's rather than yours (e.g. `@deepseek-ai/dsh-http-proxy` for the extracted `dsh-flash-proxy` plugin), resolve it through a dynamic-import helper that finds DSH's own copy — see [docs/architecture-notes.md](docs/architecture-notes.md).

### 12. Session Event Token Source Must Subscribe to Session List Unconditionally

`SessionEventTokenSource` subscribes to `sessions.binding(sessionId).eventSource` for the current session. When the user switches conversations, `scopeOf(ctx)` returns a new session id — the old subscription and accumulated totals are stale. The session-list subscription that detects switches must start **unconditionally** in `start()`, not only when no initial session exists, or switches from an already-active session are invisible.

```js
// ✅ Correct — session list subscription always active
_sessions.list.subscribe(() => { /* check scopeOf(ctx) for changes */ })

// ❌ Wrong — only subscribes when no session exists at startup
if (!_sessionId) {
  _sessions.list.subscribe(() => { /* never fires for existing sessions */ })
}
```

---

## Skin System Architecture

**Seven entry paths, one predicate per filter.** A skin reaches the dropdown through phase 0 (managed),
1a (`style[data-plugin]`), 1b (`style[data-skin-chrome]`), 2 (body attributes), 4 (`__DSH_BOOT__` /
`graphRows`), 5 (**a live mark from `_skinLiveMarks`**) or 6 (**installed but switched off, from the
profile's own manifest — host route `/plugins/dock-flash/profile-packages`**). `_skinAllowed` states
BOTH filters (`_skinHint` AND `_skinExclude`) and is called from all seven — see **Critical Rule 8**,
which also carries the two rules that keep the market from being offered as a skin.

**Phases 5 and 6 are the last-resort sources, and each exists because the usual ones can be blind.**
Phase 5: a mark in the document IS proof of installation, so a handle-less skin that is still
rendering can be listed at all. Phase 6: **DSH Desktop lets no client plugin enumerate installed
plugins** (its plugin manager refuses the reserved desktop profile, so `listPlugins()` /
`listBundles()` answer nothing) and a switched-off handle-less skin has no mark either — so the
profile's own `package.json`, read by the HOST half, is the only proof left. Without them such a
case could be turned OFF but never back ON. Details: [docs/skin-system.md](docs/skin-system.md).

> **`__DSH_BOOT__.entries` is not a complete install list**, and **a REJECTED `listPlugins()` is not
> an empty one** — the second was cached for the session as "no plugins", making every skin read
> `NO ADDRESSABLE ROW` until a reload. The cache now keys on a read that CONCLUDED (`ok`), and
> `_refreshPluginEntries()` notifies only when rows arrived, which is what stops "do not cache a
> failure" from becoming a render → fetch → notify loop.

- **Excluded, never listed**: bloom-theme, black-hole, theme-manager, `dsh-skin-market` (the market
  itself — supplies the list and is not a skin) and any `timeline` plugin, which looks exactly like a
  CSS skin to the DOM scan while not being one. `_skinExclude` also protects THEM: deactivation
  REMOVES a style element (Critical Rule 2), which would strip their own stylesheet.
- **Managed skins** (Mineradio) cannot be toggled by touching style tags — they own a canvas/WebGL
  lifecycle — so `_toggleManagedSkin()` writes the plugin's private key and drives the cross-tab
  `storage` event (Critical Rule 3). The table is **curated**, because the DSH plugin contract offers
  no way to discover a plugin's private enable key, its "active" attribute or its loader id. **Such a
  skin's installation must be proven by the boot manifest, the module graph, or the plugin's own style
  tag — NEVER by `enabledKey` in localStorage**, which dock-flash writes itself; and that key must not
  be written for a skin that is not installed. `_managedInstallReason()` is the ONE predicate for that,
  called by the scan AND by the flag sync.
- **Switch a handle-less skin off as a WHOLE PLUGIN, through DSH's own plugin manager.** Some skins
  (`dsh-dream-skin`, `dsh-theme-macintosh`) inject `<style>` tags carrying no `data-plugin` /
  `data-skin-chrome`, drive themselves from their own `<html>` attributes and re-insert themselves from
  a `MutationObserver`, so there is no selector, no tag and no activation attribute to act on; DSH ships
  no remove-by-owner API either (`removeOwnedStyles()` keys on `data-plugin` too).
  `_skinNotControllable()` is the ONE predicate for that shape, and its consequence is
  `_switchSkinBundle()` → `ctx.remote.pluginManager`. **Two switches exist there and they are NOT
  interchangeable: use the ENTRY one.** `setPluginEnabled(entryId, enabled)` acts on the RUNNING loader
  and writes or clears that entry's `disabled:` row — live AND symmetric, which is what 默认 needs.
  `setBundleEnabled(package, enabled)` only edits `dsh.profile.bundles`, so it is only the fallback for a
  package with no addressable row. **The entry id need not come from `listPlugins()`: when that yields no
  row, take it from the BOOT MANIFEST** — that is what makes the LIVE entry switch reachable on DSH
  Desktop, where the manager refuses the reserved profile while DSH's own Plugins page toggles the same
  plugin live. `setPluginEnabled()` answers `application: "applied" | "restart-required"`, DSH's own words
  for "live" vs "needs a restart". The bundle fallback is composed at the running host's OWN boot, so a
  page reload cannot apply it (MEASURED) — that path is the one that must say so.
  **A remote resolves only for a client plugin that DECLARES it — twice over, and the second half is the
  one that bites.** `dsh.client.inject` must name `@deepseek-ai/dsh-api-remotes` (load order — the package
  that owns `ctx.remote.$mount()`), AND the plugin object's own `inject` must name the NAMESPACE SERVICE
  `"remote.pluginManager"`: every namespace is a service of its own (`remoteServiceKey(ns)` is
  `remote.${ns}`) and Cordis' guard proxy refuses an undeclared one, exactly as it does for
  `"remote.settings"`. The official `dsh-client-ui-plugin-manager` declares all three. Either entry
  missing makes every 默认 press a silent no-op that writes nothing — which is how it shipped, twice:
  first with no package entry, then again with the package entry but only `"remote"`/`"remote.settings"`.
  The state is
  read first in every case, so an already-satisfied press writes nothing and cannot reload in a loop.
  **A UI control never edits the install layers: it must use a switch that has an inverse.**
- **Collect EVERY promise that represents a loader write — a write with no reload is a silent half-switch.**
  Switching a handle-less skin ON is the same kind of write as switching it off, and both only change what the
  NEXT page load boots, so `_applySkin()` pushes `_switchSkinBundle()` into `pending` in BOTH directions and
  reloads when any of them reports a real change. The activation side once dropped that promise, which is
  how "from 默认 I can switch to Dream once, then nothing until I reload the page" shipped; the full case
  history is in [docs/architecture-notes.md](docs/architecture-notes.md). The state is read first, so an
  already-satisfied switch resolves `false` and reloads nothing; that guard is what makes collecting the
  promise safe even though `_applySkin()` also runs at boot. When a press still does nothing,
  `window.__dockFlashSkinTrace()` (a 40-entry ring) is what tells the two causes apart — it names the route
  that ran (`press.path`), whether the plugin manager actually wrote (`bundle.wrote`) and whether a reload
  was scheduled (`reload`). **The ring lives in `sessionStorage` for that reason**: the switches it records
  are the ones that reload the page, so a memory-only trace is wiped by the very event it exists to explain.
- **A handle-less skin that is still RENDERING has to be reported, or 默认 becomes unreachable.** Every
  record — the plugin manager's rows included — is bookkeeping: a theme can read `disabled` there and
  still be painted in the page (a mounted instance, or styles left behind by an earlier load) while the
  stored preference says `default`. The `<select>` then SHOWS `default`, and a select fires no event for the
  value it already shows — so the user has no control left to press. `_skinLiveMarks` + `_skinInEffect()`
  read the plugins' own marks (`html[data-dsh-material]`, `style#dsh-dream-skin-nav-icon`,
  `style[data-mc-root]`, `html[data-mc-dock-on]` …) and are **DETECTION ONLY — never removal**, because
  both plugins re-inject themselves. `_getActiveSkinId()` returns the marked id, so the dropdown names what
  actually renders; and `_applySkin('default')` knows that press wrote nothing (`changed` is all-false,
  the row already read `disabled`) and **reloads anyway** — in that state the reload IS the switch.
- **默认 is not a package name, and the switch to it must go through `_applySkin()`.**
  `_activateThemeViaPluginManager()` short-circuits `'default'` to `_applySkin('default')`, which is
  the only route that reaches the branch switching EVERY skin off. Every other branch there is about
  ONE package (`_skinEntryRow(rows, _skinBundleName(name))`, "enable the target, disable the others")
  and no row exists for `default`, so that route used to stop in the `!targetRow` fallback: 默认
  switched a handle-less skin off (its path IS `_switchSkinBundle()`) and left a CSS skin bundled and
  repainting. The measurement: [docs/architecture-notes.md](docs/architecture-notes.md).
- **A CSS skin is a WHOLE PLUGIN, and the switch has THREE call sites plus TWO halves — all five
  must agree.** A press runs `_activateThemeViaPluginManager()`, which has its OWN "enable the
  target, disable the others" loop; `_applySkin()`'s two loops (默认 and deactivate-others) and
  `_switchSkinBundle()` are the others. Every one needs both halves: the entry row
  (`setPluginEnabled`, HOST half) and `dsh.profile.bundles` (`_switchSkinBundle()` →
  `byBundlePath()`, VISIBLE half). The five measured defects, one per call site — the row path that
  returned before `byBundlePath()`, the loop that treated its target as "already done" and hard-coded
  `false` for every other skin, the row path that resolved `false` for an `applied` switch (so a press
  wrote the rosters and never reloaded, since `_applySkin()` reloads on `pending.some(Boolean)`),
  `byBundle()`'s `undefined`, and `byBundlePath()`'s guard inverted for ON:
  [docs/architecture-notes.md](docs/architecture-notes.md). **`_isMarketLiveTheme()` gates nothing
  here — nothing ever assigns `_marketThemes`, so it is always `false`. See [docs/skin-system.md].**
- **The entry id is NOT derivable, and an EMPTY candidate list is not "nothing to do".**
  `_entryIdCandidates()` only GUESSES, and every wrong guess answers `unknown-plugin` (MEASURED:
  `dsh-dream-skin`'s real id is `dream-skin`); `POST /plugins/dock-flash/set-plugin-entry` is the
  authority, because the HOST reads the package's own `cordis.patch.yml`. **Resolve the profile from
  `profileContext`, never `readdirSync` order** (two profiles listing dock-flash sent every write to
  the other one), and write the row with NO `name:` — DSH skips a name mismatch, so the id alone
  addresses the entry. The list is ALSO empty before `/plugins/dock-flash/profile-packages` answers —
  `enabledNow` then reads `false`, which for
  a DISABLE equals the wanted `false`. That is the first press of 默认 after a cold load ("需要切两次"),
  so that branch must drive the HOST route instead of falling through to `byBundlePath()`. **Write
  BOTH halves** — the ENTRY row (running loader) and `dsh.profile.bundles` (next boot); writing only
  the entry left `dsh-dream-skin` installed but out of the roster, so it could not come back.
  Measurements: [docs/skin-system.md](docs/skin-system.md).
- **A CSS skin that is active while the stored skin is NOT a CSS skin is a stray, and the boot sweep
  must switch it off as a PLUGIN.** Both CSS branches of `enforceBootSkin()` are gated on
  `targetIsCss`, so a handle-less target (Dream) fell through to "do nothing" — MEASURED:
  `claude-style-skin` stayed loaded and painting on every boot. The `else` branch now runs
  `_switchSkinBundle(s, false)` over
  `activeCss.filter((s) => s.id !== storedSkin)`, deliberately NOT `_applySkin(storedSkin, true)`.
- **A skin with a CSS handle is switched off by REMOVING its style tag — so the boot check is a
  LADDER plus an observer, never one pass.** This is the SECOND line of defence, for a profile whose
  stored preference is `default` while the skin is still bundled (an older version's press, or a
  write that never landed). It reads the DOM, and it runs when this plugin's `apply()` does, which is
  not necessarily after the skin's own — a pass that sees no active CSS skin leaves it painted for the
  whole session although every write it made was correct. The measured cases:
  [docs/architecture-notes.md](docs/architecture-notes.md). `enforceBootSkin()` is therefore
  a NAMED function run at 0 / 1.2 / 3 / 6 / 10 s **and** on a `MutationObserver` watching
  documentElement + head for the announcements a skin makes (`data-plugin` / `data-skin-chrome` /
  `data-dsh-material`, or a `<style>`/`<link>` landing) — that observer is what turns "within
  1.2 s" into "at once", and its RECORD TEST is what keeps it affordable, because one enforcement is a
  full five-query scan. **Every pass must be idempotent** (an already-clean page falls through every
  branch), the observer disconnects at 12 s, and each pass re-reads `_hostPrefs.activeSkin` so a
  selection made in between wins. A skin that survives even the ladder means a longer ladder — never a
  bigger first delay.
- **`options()` and `_applySkin()` must read ONE list.** The dropdown merges the DOM/boot scan with the
  skins the scan cannot see, while `_applySkin()` once iterated the SCAN ALONE — so a skin reachable
  only through the merge could be selected but not acted on: not activated, and not switched off by
  默认. `_knownSkins()` is that one list, for both callers.
- **The switcher no longer needs dsh-market, and the market is not what it reads.** Discovery and
  switching go through DSH's own plugin manager (`_pluginManagerSkinExtras()` over the entry and bundle
  lists; `_activateThemeViaPluginManager()` for activation — its own comment records the replacement of
  `_activateThemeViaMarket()`), and `_skinAllowed()` is a **pure name heuristic**, as its comment says.
  **`_registerSkinSwitch()` is called unconditionally**, not from a market callback; the
  market-classification history it replaced: [docs/architecture-notes.md](docs/architecture-notes.md).

> **Preferences and the `remote`/`inject` contract live in one place** —
> [docs/skin-system.md](docs/skin-system.md): the four-layer preference bridge, why localStorage is a
> cache and never the authority, the `describe()` nesting, the three-argument `settings.update`, the
> schemastery traps, and the migration rules. Read it before adding a preference. The one line that must
> stay in mind while editing: **a new preference means `SettingsSchema` + the `loadHostPreferences()`
> mapping + a read from `_hostPrefs` + a write through `savePrefs()` — the mapping list IS the contract**
> (`triggerOverlayOffset` shipped declared-and-read but unmapped, so the host value was silently ignored).

> The phase/category tables, the managed-skin configuration, the `/use-skin` one-way-door history, and
> the diagnostics hooks: [docs/skin-system.md](docs/skin-system.md).

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
| `log` | `getLines()` | Read-only multi-line output block. Optional `hideWhenEmpty` (render nothing while there are no lines), `getMeta()` (right-aligned header status), `emptyText()`, `onClear()` + `clearTitle` (renders a ✕ button) |

### Optional switch fields

Common to every type: `icon`, `order`, `group`, `label` (string, or `() => string` for i18n),
`visible`, and `cluster`.

`cluster: '<label>'` makes switches sharing a label **one unit** — one card, one ▲▼ pair while
reordering, a fixed internal order (their `order`). Use it for controls whose meaning depends on
staying together; co-dependent selects are the case that motivated it. Its members stay
registered and are only *folded* — never gated out by `visible`, never removed — because a block that
changes shape is the problem the fold exists to solve. A cluster is never a grid item
(`isGridToggle()`). **The mechanics live in one place**:
[docs/panel-ordering.md](docs/panel-ordering.md) — the fold's position, the label-keyed unit, the
default-folded rule and the editing-mode inventory.

`clusterInline: true` + `clusterLabel` turn a `select`-only cluster into the **inline form**: the
cluster's title on one row, the members' dropdowns right-aligned on the row below it, each naming
itself through its own `label`, and no fold. Declare `clusterInline` on **every** member or the unit
falls back to the card; declare the title once, on any member. A member that is not a `select` also
falls back — the inline row draws controls, not label columns.

`visible: () => boolean` drops the switch from the panel while it stays registered, so its state, its
changelog entries and every other reader keep working — no dispose/re-register dance. It applies at
the **row** level and **only in the normal view**; both editing modes list every registered control,
because one that is not drawn cannot be ordered or hidden. The normal view also drops a group that
would draw no rows, and `renderSwitch` re-checks unless passed `force` (what the editing modes do).
**A switch driven by `visible` must notify when its condition changes**, or it flips only on the next
unrelated render — `notifyChange` is the mechanism (e.g. a fetch completing, a timer firing).

Per renderer:

| Field | Types | Effect |
|---|---|---|
| `subtitle` | `toggle`, `select` | Secondary line in the label column |
| `subtitleBlock` | `select` | Render `subtitle` as its own full-width, **wrapping** line below the row instead of inside the label column. Use it whenever the value is long enough that the inline variant's ellipsis hides the point — a URL, a path, a command. `S.switchSubtitle` (inline) sets `nowrap` + `text-overflow: ellipsis` because it shares the row with the control; `S.switchSubtitleBlock` drops both and adds `word-break: break-all`. |
| `tooltip` | `select`, `number` | `ⓘ` icon carrying a native `title` attribute. On `number` switches the description belongs here rather than in `subtitle`: the inline subtitle shares the row with the input and ellipsizes the point, while the value is a bare digit that needs no accompanying line. The host-alert sliders (`host-alert-queue-cap`, `host-alert-max-age`) are the worked example |
| `actionLabel` | `action` | Button text (string, or `() => string`) |
| `hideLabel` | `action` | Drop the title column and let the button take the whole row. For an action whose button already carries its wording — Test Connection read "测试连接" twice, once as a title and once on the button. The definition keeps `label` either way: that is what the changelog and the panel name the entry with |
| `getMeta`, `hideWhenEmpty`, `emptyText`, `onClear`, `clearTitle` | `log` | See the `log` row above. `hideWhenEmpty` renders nothing at all while `getLines()` is empty, instead of an empty box; `emptyText` is the placeholder used when it is *not* set |

> **Don't hide a switch's own value behind `tooltip`.** A URL was once both a subtitle *and* a tooltip of the same string: the tooltip added a hover target and no information, while the subtitle truncated the URL at exactly the part worth reading. If a value matters, give it `subtitleBlock`. The `dsh-flash-proxy:test-url` switch (now in the extracted `dsh-flash-proxy` plugin) once dropped the line entirely — one step too far: with `custom` selected the select says only "Custom", so the address actually in force was the one thing the row did not show. It is back now (`subtitleBlock` + a resolver function), inside the proxy cluster's card.

### Registration Rules

- **id format**: `plugin:switch-name` (e.g. `dock-flash:theme`, `dock-git:show-stash`)
- **id prefix determines grouping**: `dock-flash:*` → built-in (⚡ Workbench tab), others → 🧩 Extensions tab
- **order**: Built-in items use 10–60; third-party should start from 100
- **group field**: Only meaningful for built-in switches (`appearance`, `layout`, `system`); ignored for third-party

### Third-Party Plugin Integration

The integration guide is **[INTEGRATION.md](INTEGRATION.md)** (English) /
**[INTEGRATION.zh-CN.md](INTEGRATION.zh-CN.md)** (Chinese): both patterns, the dual-discovery
snippet, the full switch definition, cleanup, and the `setValue` rules. It is deliberately **not**
duplicated here — one copy that cannot drift beats two that can, and 2.2 KB of this section was
repeating that file almost verbatim.

The one thing to hold in mind while reading it: `dsh.client.inject` needs the **base** package name,
never `<pkg>/client` — see "Mode Detection" above for why.


---

## i18n Conventions

- Translation function `t(key)` returns Chinese or English based on `document.documentElement.lang`
- `MutationObserver` watches `<html lang>` for real-time switching
- Functional labels (`label: () => t('xxx')`) ensure dynamic refresh on language change
- Static string labels won't update on language change — always use functions for user-visible text

---

## Testing Conventions

### Manual Testing Checklist

The per-change verification checklist is **[docs/testing-checklist.md](docs/testing-checklist.md)**.
It is a procedure rather than a rule, so it lives beside the long-form notes and is loaded when you
are verifying — **read it before claiming a change is tested**, because "it looks fine" is the check
that let three real defects ship. One item in it is a rule, not a step, so it stays here:

- **Layout overflow — measure it, do not eyeball it.** With the panel open, `__dockFlashOverflow()`
  reports dock-flash's own subtree (`true` scans the whole page, which is how "is this scrollbar even
  mine?" gets answered). **Measure at two widths, one of them narrow** — overflow is a function of
  container width, so one size proves nothing. **A flex item's default `min-width: auto` means
  "never narrower than my content"**, the single mechanism behind every overflow this plugin has
  had; `minWidth: 0` on the shrinking box is the fix, and `box-sizing: border-box` is required
  whenever a `minWidth` floor and padding are combined.

### `pnpm run check:overlay`

The **one committed check**: it evaluates the real `lib/client.js` in a V8 sandbox and asserts the
overlay trigger's **behaviour** — that it mounts with the `slots` service never arriving and the
conversation appearing only after the mount, and that the gestures work. **Assert the gesture, not
only the end state**: the first version checked the mount and the position arithmetic, both correct,
and passed on a button nobody could click. Full procedure:
[docs/testing-checklist.md](docs/testing-checklist.md).


### Key Observation Points

- **Browser DevTools console**: `[dock-flash]` prefixed logs for client-side events
- **Host process console**: `[dock-flash]` prefixed logs for host-side events
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

> **Peer ranges must carry an explicit prerelease branch — one per tuple whose prereleases must
> resolve**, or a range that merely looks broad silently excludes the harness's prerelease builds and
> users hit `ERESOLVE`; a branch written for one tuple never covers another. awesome-dsh-plugin's
> contributing guide requires it. **Any change here needs a probe matrix asserting BOTH directions.**
> The semver mechanics and the attempt that dropped `4.0.1-0`:
> [docs/architecture-notes.md](docs/architecture-notes.md).

---

## Version History Pattern

- Update version in **both** `package.json` (line 3) and the single `const CLIENT_VERSION` near the top of `lib/client.js`'s factory — the startup log and `__dockFlashOverlay()` both report it. One constant rather than a literal in the log line, because **a build that cannot name itself cannot be told apart from the previous one**. `pnpm run check:docs` asserts the two agree.
- Both READMEs must stay in sync — same structure, same content, different language
- No changelog in the READMEs — `CHANGELOG.md` and git log are the history records

### Releasing needs the maintainer's confirmation — twice

**Never cut a release on your own initiative.** Two gates, each the maintainer's decision:

1. **Before bumping the version** — stop and ask. A finished change, passing checks and a clean diff
   are **not** approval to version it. State the version you would choose and why, then wait.
2. **Before tagging, pushing, or publishing** — ask again. Gate 1's approval does not carry over.

Until gate 1 is answered, `package.json` and `CLIENT_VERSION` keep the **last released** version and
no new `CHANGELOG.md` row is written. **Never edit a version string opportunistically** — "I was in
the file anyway" is the exact move this rule exists to stop. The reason it is a rule: a published
version cannot be recalled, so revision is free before the number exists and impossible after.

> The rationale and the runbook step it gates: [docs/releasing.md](docs/releasing.md).

### Which number moves

Increment by what a third party can observe, not by how large the change felt: **patch** for a bug
fix, refactor, docs or metadata; **minor** for a new switch, a new field on `QuickSwitchDefinition`,
a new switch type, or a new service or event; **major** for removing or renaming anything published
(a field, a switch type, a switch id other plugins may read, a route's response shape). Additive is
what makes a minor safe to take. **Never renumber a released version** — a published tag and Release
cannot be recalled. The version is this package's own; what declares dock-base compatibility is the
`peerDependencies` range, not a major number. The full table, the prerelease reasoning and the
`1.0.x` history: **[docs/releasing.md](docs/releasing.md)**.

A change confined to files outside `files` in `package.json` — `AGENTS.md`, `CHANGELOG.md`,
`docs/` — is not a release, needs no bump, and commits as `docs:`.

### Commit as you go

**Commit each finished change on its own — never batch a verified change with the next one.** An
uncommitted change is one stray `git checkout` away from gone, and that has already cost this repo a
full re-derivation of the skin fix. Commits, not releases: the two gates above still stand.

### Where the history lives

The release-by-release narrative is in **`CHANGELOG.md`**. It used to live here as a
table, and by 1.0.10 that table was 18 KB — 28% of this file, and past the point
where it earned its place next to the rules. Add new rows there, not here.
