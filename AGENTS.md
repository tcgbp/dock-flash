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
dock-flash/
├── src/index.ts          HOST half — settings namespace + proxy toggle (tsc → dist/)
├── dist/index.js         Compiled host half
├── lib/client.js         BROWSER half — quickControl registry + panel + skin system + i18n (single file, NO build step, organized by #region markers)
├── cordis.patch.yml      Bundle layer — inserts host rows into profile
├── package.json          Plugin manifest + dsh.client.inject
├── README.md             English docs (canonical)
├── README.zh-CN.md       Chinese docs (mirrors README.md)
├── INTEGRATION.md        Third-party integration guide (English)
├── INTEGRATION.zh-CN.md  Third-party integration guide (Chinese)
├── CHANGELOG.md          Release-by-release history (narrative; not rules)
├── AGENTS.md             This file — rules, contracts, invariants
├── docs/                 Long-form notes and procedures — NOT injected, read on demand
│   ├── architecture-notes.md   the "why" behind rules, and measurements
│   ├── testing-checklist.md    the per-change verification procedure
│   └── releasing.md            the release and mirror-sync procedure
└── scripts/              Repo tooling (not published — see `files` in package.json)
    ├── check-docs-size.mjs     `pnpm run check:docs`
    └── check-overlay-mount.mjs `pnpm run check:overlay`
```

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
takes the overlay path instead of registering into a slot. A slot is a place in DSH's layout, and
this position exists precisely to sit *over* the conversation rather than be laid out by it, so
`conversation.session.header.corner` — the nearest thing DSH offers — is not usable even though it
looks right: it is `kind: "single"` (the renderer keeps only `entriesOfSlot[0]`), so a second
occupant does not queue, it **disappears**, and `@deepseek-ai/dsh-client-ui-sidebar-right` already
ships there with its expand button.

Six things must hold together:

- **The anchor is found structurally, never by class name.** `conversationViewport()` matches
  `div[class*="_scrollBody"]` whose computed `overflow-y` is auto/scroll, then requires a non-zero
  box inside the viewport and prefers the largest. `wSkVaW_scrollBody` is a CSS-module hash that
  changes on any DSH rebuild, so matching it would break silently on an unrelated upgrade — the same
  reasoning as the turn rail, and it carries the same "in the DOM is not on screen" trap.
- **The scrollbar is cleared by arithmetic, not by a guessed width.** That element declares
  `scrollbar-gutter: stable`, so the gutter is reserved whether or not a scrollbar is showing, and
  `rect.width - el.clientWidth` reads it exactly. A guessed constant would be wrong on any platform
  with a different scrollbar, and would make the button jump when content crossed the scroll
  threshold.
- **The turn rail is cleared through `turnRailProbe()`,** not by measuring `nav[class*="_frame"]`
  again — that function already owns "is the rail visible", "has another plugin taken the surface
  over", and "which of several candidates is the on-screen one". **Class tests use `*=` and never
  `$=`**, because DSH joins class lists: the rail's scroller is
  `[scroller, fadeTop?, fadeBottom?].join(' ')`, so a rail that merely grew stopped matching a
  suffix test — which hid the `turn-rail-left` switch from the panel and stopped this button giving
  way to the rail. `_preview` is the one token that must stay `$=`, since `_previewPrompt` and
  `_previewResponse` are its siblings. Only a rail on the RIGHT competes with this corner; the
  `turn-rail-left` switch moves it away from the same place, so a left-side rail must not shift the
  button.
- **The offset is relative to the conversation corner, and the button is clamped, not the offset.**
  Storing `{dx, dy}` inward from that corner is what makes the button follow the corner when the
  right sidebar opens, the sash moves or the window resizes — which is why a `ResizeObserver` on the
  viewport (not a window `resize` listener) is what keeps it in place, since two of those three never
  fire one. A drag adjusts the offset; the clamp then holds the RESULT inside the viewport, so a
  stored offset survives a shrink that the position does not.
- **The button's size is `effectiveTriggerSize()`; no size literal may reappear in the positioning
  arithmetic.** The clamp, the scrollbar clearance and the turn-rail give-way all measure the BUTTON,
  so a constant that disagrees with the drawn box parks the entry point over the rail or outside the
  conversation — the same silent failure as the two that once hid it entirely. Icon size
  (`triggerIconSize()`, 2/3) and radius (`triggerRadius()`, 1/4) derive from it and reproduce the
  historical 16px/6px exactly at the default 24. **The ceiling follows the selected position** — 48px
  in a slot (it shares that row), 64px at the draggable overlay (it competes with nothing) — and it
  clamps what is drawn, never what is stored, so the host schema carries no min/max. The positioning
  reads the stored value, not the rendered box, which is a frame stale after a resize.
- **The glyph is real DOM, not a React element.** `LightningIcon()` returns `h('svg', …)` — a React
  element *descriptor*, a plain object — and the hand-built button's `appendChild` needs a `Node`, so
  it threw `TypeError: parameter 1 is not of type 'Node'` before `overlayEl = el`: the button was
  never in the DOM, and because the mount precedes `ctx.inject(['slots'], …)`, **no** trigger position
  worked at all. `LightningIconNode()` builds the same `svg`/`path` via `createElementNS`.
- **Acquisition is retried, never attempted once.** `apply()` runs before any conversation exists, so
  positioning at mount finds no anchor, leaves the button hidden, and attaches no `ResizeObserver` —
  it is attached to an element that does not exist yet. A subtree `MutationObserver` (armed while no
  anchor is adopted, and **not** disconnected once one is found, because a new session builds a new
  scroller) plus a bounded retry for a viewport that exists but is not yet laid out. The mount is
  wrapped in a named, non-fatal catch, because it precedes `ctx.inject(['slots'])`.

> The defects in full, with the measurements and the harness that proves them:
> [docs/architecture-notes.md](docs/architecture-notes.md).

**Drag reuses the panel's machinery rather than adding a second one.** `beginOverlayDrag()` sets the
shared `dragging`/`dragSource`/`dragMoved` state, so `ensureGlobalListeners()`'s existing move and
end handlers apply unchanged — including the ±3px threshold that `dragMoved` records, which the
overlay's own click handler reads to swallow the click ending a drag. Without that, releasing a drag
would toggle the panel. The offset is written on release, not per move: a drag is one intent, and a
host round trip per pixel is not.

**Swallowing the drag's click is the FIRST half of that handler, not the whole of it.**
`QuickTriggerIconButton` is a React button and gets its toggle from its own `onClick`; a hand-built
element has to call `openPanel()`/`closePanel()` itself. A handler that stopped at the swallow left a
button that mounted, positioned itself correctly and did nothing when pressed — so if you touch this
handler, keep the toggle in it. `handleOutsideClick` already exempts `[data-dock-flash-trigger]`, so
the closing half is not racing it, and `dragMoved` is cleared by the next `mousedown` rather than by
the drag's own end — which is why a click straight after a drag still works.


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

Four rules, or the mode switch changes nothing: load it through the **one cached handle**
(`loadProxyModule()`, resolving DSH's own copy) and make sure it is **the instance DSH booted with**
(a second copy answers `DIRECT_ROUTE` forever); pass a **`URL`**, never a string (handed a string it
does not throw, it silently reports "direct"); **keep and release the returned disposer** — ignoring
it leaks one `ProxyAgent` and its socket pool per mode change; and resolve the policy from the
**`launchEnvironment`** service, not `process.env`, overriding only `NO_PROXY`/`no_proxy`. This plugin
owns the **bypass list**, not the proxy address, and installing replaces the process-global dispatcher
for the whole DSH process.

`custom` values are **validated on the way in** against the grammar the matcher actually implements;
a rejection changes neither the mode nor the stored list, and a blank value makes `resolveNoProxy()`
return `undefined` so `NO_PROXY` is removed rather than published empty (the host enforces that blank
rule too, since a value edited into `settings.yaml` never passes through the prompt).

> The four defects that made the proxy a silent no-op for the life of the feature, the exact
> accept/reject grammar, and the reasoning behind each rule above:
> [docs/architecture-notes.md](docs/architecture-notes.md).

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
- **Two layers of "not shown", ANDed — but only in the normal view.** A switch's `visible()` is the
  PLUGIN saying "I do not apply right now"; `panelOrder.hidden` is the USER saying "I do not want
  it". Neither can override the other: a user cannot force back a row the plugin has stood down, and
  a plugin cannot drag back one the user put away. **Both editing modes are INVENTORIES and list
  every registered unit**, stood-down and user-hidden ones included, because a row that is not drawn
  cannot be ordered or hidden — a stood-down switch used to be unreachable in every mode at once,
  which is how the turn-rail switch was lost. A row the normal view would filter is dimmed in the
  editing modes and its tooltip names the layer that removed it.
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

**Exclude the market itself, and never narrow the `skin` token.** `dsh-skin-market` supplies the
installed-skin list and was also offered as one of the skins, labelled `Market` by `_labelFromId()`
(strip `dsh-`, strip trailing `-skin`). The bare `skin` token in `_skinHint` is what makes every
`<name>-skin` package discoverable, so the market is excluded **by name** — narrowing the token would
put every real skin at risk. A derived label makes such an entry look deliberate, so the list is
asserted rather than eyeballed: `check:overlay` section 15 drives the real scan and pins the dropdown.

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

**`describe()` answers `{ ok, value }`, and the namespace list is one level down at
`value.namespaces`** — each entry `{ ns, value, base, user, applies, revision, secrets }`, with both
spellings accepted (`ns || namespace`, `value || resolved`). Getting that nesting wrong is the
characteristic failure here: it looks right and silently finds nothing, so the failure message prints
the response keys *and* the `value` keys.

**`settings.update(ns, patch, expectedRevision)` takes THREE arguments, and the runtime enforces the
count** — calling it with two throws `client api: settings/update expected 3 argument(s), got 2`,
even though the wire schema marks the third optional. The revision is a compare-and-set token: it
arrives as `ns.revision` and **changes on every successful write**, so it is cached in
`_hostRevision`, sent on every write, and refreshed from `response.value.revision`. A stale revision
fails exactly like a missing one.

> The three attempts that nesting took, the authoritative source for each shape above, and the
> regression check pinning the two wrong expressions:
> [docs/architecture-notes.md](docs/architecture-notes.md).

Two habits follow, and they are the general lesson:

- **Never let a load path return a bare `false`.** Every exit records a *named* reason, logs it, and
  `__dockFlashPrefs()` reports the host's view beside localStorage's. This is Critical Rule 11's
  silent `require` in a new place.
- **Print the shape you did not recognise** — the failure message lists the descriptor's keys and the
  namespaces actually seen, so the next mismatch is a copy-paste rather than a bisect.

The Schema types the client's values **loosely on purpose** — an `enum` in the host would make a
stored preference un-writable the moment the client's lists change. Three schemastery traps:
**`dict` takes `(value, key)`** (the reverse of how it reads, and wrong only at first resolve);
**every level of a nested object needs `.default()`**, or the resolve fails with `unsupported type
"undefined"`; and `Schema.resolve(schema, options)` takes **options**, not a value — call
`Schema(value)`. A validation failure rejects **before** anything is persisted.

> Migration rules, and the 1.1.0 defect that produced the two habits above:
> [docs/architecture-notes.md](docs/architecture-notes.md).

### Preference Persistence

The market's `live` theme is written through to both layers on read, but only when it disagrees with
the host, so an unchanged value costs no round trip, and a `MutationObserver` on `<head>` re-applies
the preference when late-loading skins appear.

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
needed. It is applied at the **row** level and **only in the normal view**: both editing modes list
every registered control, because one that is not drawn cannot be ordered or hidden (see "Panel
ordering and visibility"). The normal view also drops a group that would draw no rows, so a title
never floats above nothing, and `renderSwitch` re-checks the predicate as a backstop for any other
caller unless it is passed `force` — which is what the editing modes do. The predicate is
re-evaluated on every render and the panel re-renders on any
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

- Update version in **both** `package.json` (line 3) and the single `const CLIENT_VERSION` near the top of `lib/client.js`'s factory — the startup log and `__dockFlashOverlay()` both report it. One constant rather than a literal in the log line, because **a build that cannot name itself cannot be told apart from the previous one**: several rounds of overlay fixes were all labelled `v1.3.0`, so a reload that silently served a stale bundle was indistinguishable from a fix that had not worked. `pnpm run check:docs` asserts the two agree.
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

### Where the history lives

The release-by-release narrative is in **`CHANGELOG.md`**. It used to live here as a
table, and by 1.0.10 that table was 18 KB — 28% of this file, and past the point
where it earned its place next to the rules. Add new rows there, not here.
