# dock-flash

> Quick Control dock plugin for DSH — works standalone or with [dock-base](https://github.com/AKS1st/dock). Click the ⚡ icon to open a floating quick-control panel with an **extensible switch registry** that other plugins can use to register their own switches.

**[中文文档](./README.zh-CN.md)**

## Modes

| Mode | Condition | UI | Available Switches |
| --- | --- | --- | --- |
| **Workbench** | dock-base installed | ⚡ icon in activity bar → sidebar/floating panel | Appearance + System switches |
| **Standalone** | no dock-base | ⚡ trigger button in the configured conversation slot (default: input right) → floating panel | Appearance + Layout + System |

## Features

### Built-in Switches

Built-in switches are grouped into Appearance / Layout / System (compact two-column layout). The Layout group appears in standalone mode only:

| Group | Switch | Type | Description | Standalone |
| --- | --- | --- | --- | --- |
| 🎨 Appearance | Theme | select | Lists what the theme service publishes, minus the dead options. While a theme publishes its **own palette** (Dream: Abyss / Aurora / …), those palettes are the list and Light / Dark / System are withheld — the palette paints over the base scheme and fixes its own colour scheme, so none of the three could do anything. With no palette published — no skin installed, **or a restyling skin such as Claude** — the list is Light / Dark / System, and Follow-system really does resolve against the OS. The wxj-black-hole conflict retry is unchanged | ✅ |
| 🎨 Appearance | Skin | select | Dynamically discovers installed skin plugins and switches between them, through DSH's **own plugin manager** — dsh-market is neither needed nor consulted. Every switch writes BOTH layers: the loader ENTRY row (what the running page acts on) and `dsh.profile.bundles` (what the next boot composes), because writing only one of them is how a skin came back after a reload, or could never be switched on again | ✅ |
| 🎨 Appearance | Turn Rail | toggle | Moves DSH's built-in turn navigator from the right gutter to the left. Hidden unless DSH's own rail is on screen and no other timeline plugin owns it | ✅ |
| 🎨 Appearance | Fullscreen | toggle | Browser Fullscreen API — enter/exit fullscreen | ✅ |
| 🎨 Appearance | Log Download | toggle | Show/hide the session log download button | ✅ |
| 📐 Layout | Close on Blur | buttongroup | Off / On — auto-close the panel when clicking outside. Also a toggle in the panel header (both modes) | ✅ |
| 📐 Layout | Trigger Position | select | Input Left / Input Right / Session Header / Header Utils — where the standalone ⚡ trigger goes — or **Conversation top-right**, a floating button inside the conversation you can drag anywhere within it | ✅ |
| 📐 Layout | Trigger Button Size | slider | 24–64 px — how big the standalone ⚡ entry point is drawn, glyph and corner radius included. The draggable **Conversation top-right** position allows the full range; the slot positions cap at **48px** so the button still fits the input row, and the row shows the size actually in force. The minimum is the previous fixed size, so the control only ever enlarges it | ✅ |
| 🖱️ Right-click | *(the draggable ⚡ itself)* | menu | **Reset position** / current offset / version (click to copy a diagnostic) / **layer** and **rest opacity** presets. Not a switch in the panel: the layer and the opacity only apply to the floating button, and the menu deliberately does not repeat `trigger-size`, `trigger-position` or `close-on-blur` | ✅ |
| ⚙️ System | Language | buttongroup | 中文 / English — switches DSH global UI language | ✅ |
| ⚙️ System | Missing Companions | log | Names every companion plugin that is not **running**, splitting `installed, not running` from `not installed` — a package that is present but silent is a different problem from one that is absent, and it is how the 2.0.2 crash looked. Read-only: it prints the `dsh plugin --profile <name> add …` command for the ones genuinely missing (and points at the DSH Plugins page on the reserved `desktop` profile, which the CLI refuses), plus a copy button. It disappears by itself once every companion registers, and reports `state unknown` rather than guessing when the profile's package list cannot be read | ✅ |

> **The Layout group only renders in standalone mode.** In workbench mode `close-on-blur` exists solely as the panel-header toggle, so no built-in switch carries `group: 'layout'` and the category is skipped entirely.

> **Dock layout is not configured here.** Dock edge, auto-hide, reserve space and icon scaling are dock-base's own settings — dock-flash deliberately does not duplicate them. In the Layout group dock-flash owns only `trigger-position`, `trigger-size` and `close-on-blur`, all standalone-only.

> **Turn Rail only offers itself while DSH's own rail is what you see.** It stays hidden with no session open, in a session without turns, while DSH's own `@container (width<=900px)` rule hides the rail, and when another timeline plugin owns it — `dsh-codex-timeline` enhances the native rail in place, so the rail on screen is its surface and dock-flash must not fight it for the same edge. Type `__dockFlashTurnRail()` in the browser console to print the decision and its reason.

### Core Capabilities

- 🧩 **Dynamic Discovery** — Other plugins register their own switches through the `quickControl` service; the panel auto-renders them
- 🌐 **Internationalization** — Full Chinese/English localization, auto-follows DSH language setting (via `<html lang>` MutationObserver)
- 🎨 **Skin System** — Multi-layer discovery + categorized switching (CSS / Managed / Excluded)
- 🛡️ **Error Boundaries** — All panel components are wrapped in `PanelErrorBoundary` to prevent render errors from crashing the entire dock-base WorkbenchRoot
- 🔌 **Standalone Mode** — Works without dock-base: a ⚡ trigger injected into the configured conversation slot opens a floating popup panel
- 📝 **Recent Changes** — Auto-records switch operations (30s TTL), displayed in "old value → new value" format
- 🩺 **Connection Diagnostics** — *(moved to the `dsh-flash-proxy` plugin)* — NO_PROXY policy, connection test, and diagnostics log
- 🧮 **Reorderable and hideable Panel** — A ⇅ icon in the Workbench and Extensions tab headers opens a reorder mode: ▲▼ move groups and switches, and the result is saved in your DSH profile, so it follows you to another browser or machine. Beside it, a ◉ icon opens a **visibility mode** with a ●/○ box on every row: untick a switch you never use and it disappears from the panel, while staying listed here so you can bring it back. **Both configuration pages list every registered control**, including any a plugin is standing down right now — and those rows are dimmed with the reason on hover, so a control that does not apply at the moment can still be ordered or hidden. The two modes are mutually exclusive — entering one hides the other’s button — and each has its own ↺ reset, so restoring your order never un-hides a row and showing everything never reshuffles your order. Switches that declare a `cluster` move as one unit with a fixed internal order and are drawn as one card whose members fold

### Host-side Features

`src/index.ts` (host half) provides:

- Registers the `dock-flash` settings namespace (panel preferences, trigger preferences, host alert queue settings)
- Exposes HTTP routes:
  - `GET /plugins/dock-flash/host-alerts` — drains the server-push alert queue
  - `POST /plugins/dock-flash/push-alert` — pushes an alert into the queue
  - `POST /plugins/dock-flash/clear-alerts` — clears the alert queue
  - `GET /plugins/dock-flash/health` — lightweight heartbeat + Node.js memory stats
  - `GET /plugins/dock-flash/profile-packages` — profile inventory for skin discovery
  - `POST /plugins/dock-flash/set-plugin-entry` — live plugin enable/disable via patch edit

> **System proxy features have moved** to the [`dsh-flash-proxy`](https://github.com/tcgbp/dsh-flash-proxy) plugin — proxy mode, NO_PROXY policy, `testUrl`, connection diagnostics, and the five `dsh-flash-proxy:*` QuickControl switches now live there.

> **The monitors are companion plugins.** dock-flash owns no monitor of its own: the context monitor
> lives in `dsh-flash-ctx-mon`, the memory/GC monitor in `dsh-flash-mem-mon`, and the network audit in
> `dsh-flash-net-mon`. Each keeps its own settings namespace, registers its alert provider through the
> `dockFlashAlerts` service and its switch through `quickControl`, so it appears in this panel with its
> own ⚙ config page. dock-flash keeps the shared alert registry, the host-pushed alert queue, and the
> label/link mappings that surface those companion alerts. **They are separate installs — see
> [Installation](#installation).**

## Structure

```
src/index.ts      HOST half — settings namespace + alert routes + profile inventory (tsc → dist/)
lib/client.js     BROWSER half — quickControl registry + dynamic panel + skin system + i18n
cordis.patch.yml  bundle layer — inserts host rows into profile
```

## Plugin Contract

When dock-base is installed, this plugin follows the [dock-base plugin contract](https://github.com/AKS1st/dock/blob/main/src/client/contract.ts), interacting through `ctx.workbench` methods:

| Registration | API | Description |
| --- | --- | --- |
| Sidebar Panel | `ctx.workbench.registerPanel()` | Quick control panel (sideBar area) |
| Activity Bar Item | `ctx.workbench.registerActivityBarItem()` | Lightning icon ⚡, click to open sidebar |
| Editor View | `ctx.workbench.registerEditorView()` | Quick control panel (draggable to floating window) |
| Command | `ctx.workbench.registerCommand()` | `dock-flash:openQuickControl` command |
| **Quick Control Registry** | `ctx.provide('quickControl', registry)` | For other plugins to register switches |

When dock-base is **not** installed, dock-flash automatically enters standalone mode: it mounts a floating ⚡ trigger button and popup panel directly in the DOM, providing access to all non-layout switches.

---

## 🧩 Dynamic Discovery API

This plugin publishes the `quickControl` service to `WorkbenchContext`. Other plugins obtain the registry via `ctx.get('quickControl')` and register their own switches.

### Switch Types

| Type | Description | Required Fields |
| --- | --- | --- |
| `toggle` | Boolean switch | `getValue()`, `setValue(boolean)` |
| `slider` | Numeric slider | `getValue()`, `setValue(number)`, `min`, `max`, `step` |
| `select` | Dropdown select | `getValue()`, `setValue(any)`, `options` |
| `buttongroup` | Button group | `getValue()`, `setValue(any)`, `options` |
| `action` | Action button | `run()` |

### QuickSwitchDefinition

```ts
interface QuickSwitchOption {
  label: string | (() => string)
  value: any
}

interface QuickSwitchDefinition {
  /** Globally unique id; use "plugin:switch" format, e.g. "dock-git:show-stash" */
  id: string
  /** Display label (supports functional i18n) */
  label: string | (() => string)
  /** Icon (emoji or text) */
  icon?: string
  /** Switch type */
  type: 'toggle' | 'slider' | 'select' | 'buttongroup' | 'action'
  /** Sort weight (ascending); built-in items use 10-60, start from 100 */
  order?: number
  /** Built-in group: 'appearance' | 'layout' | 'system' (only for dock-flash:* items; ignored by third-party switches) */
  group?: string
  /**
   * Optional cluster label. Switches sharing a label are drawn as ONE card and
   * reordered as one unit (a single ▲▼ pair), keeping a fixed internal order —
   * their `order` field. The card opens folded to its head row and its members
   * can be revealed behind a centred ▼/▲ toggle on the card's bottom edge: a cluster never disappears on its own, so
   * the panel's structure and the saved order survive a condition coming or going.
   */
  cluster?: string

  // ── Common to toggle / slider / select / buttongroup ──
  getValue?: () => any
  setValue?: (value: any) => void

  // ── Slider-specific ──
  min?: number
  max?: number
  step?: number
  formatLabel?: (value: number) => string

  // ── Select / buttongroup-specific ──
  options?: QuickSwitchOption[] | (() => QuickSwitchOption[])

  // ── Action-specific ──
  run?: () => void | Promise<void>
  actionLabel?: string
  /** Drop the title column and let the button fill the row (button carries the wording) */
  hideLabel?: boolean
}
```

### Registration Example

```js
// In another plugin's client.js factory:
exports.inject = ['quickControl']   // ← declare service dependency

exports.apply = function (ctx) {
  const registry = ctx.get('quickControl')

  ctx.effect(() => {
    const dispose = registry.registerSwitch({
      id: 'dock-git:show-stash',
      label: 'Show Stash',
      icon: '📦',
      type: 'toggle',
      order: 100,
      getValue: () => myGitState.showStash,
      setValue: (v) => { myGitState.showStash = v },  // only update state; panel handles UI
    })
    return dispose  // auto-unregister on dispose
  }, 'dock-git: quick-control switch')
}
```

### Service Dependency Declaration

Third-party plugins must declare a dependency on the `quickControl` service so dock-flash finishes registration before `apply()` is called. Add `exports.inject` in the client half:

```js
// client.js — inside factory
exports.inject = ['quickControl']   // ← must declare, otherwise service may not be ready
exports.apply = function (ctx) {
  const registry = ctx.get('quickControl')  // service is ready, no null check needed
  // …
}
```

Also declare the module-level dependency in `package.json`'s `dsh.client.inject` to ensure dock-flash's client script loads before your plugin:

```json
{
  "dsh": {
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "dock-flash/client"]
    }
  }
}
```

### Dynamic Value Updates

If a switch's value changes outside the panel (e.g. timers, server push, other UI actions), call `registry.notifyChange(id)` to trigger a panel refresh:

```js
const registry = ctx.get('quickControl')
// Some async event changed the value
myGitState.showStash = true
registry?.notifyChange('dock-git:show-stash')
```

> **Note**: When the user operates a switch in the panel, dock-flash automatically refreshes that switch's UI — no need to call `notifyChange` manually. Only use this method for value changes that the panel cannot detect.

### Changelog

The panel automatically logs every user interaction (toggle click, slider drag, option select, buttongroup/action click) in the "Recent Changes" tab (auto-expires after 30s).

**Plugins should NOT manually call `_notifyChange`**. The panel injects `_notifyChange` into each switch during rendering and calls it automatically on user interaction. `setValue()` only needs to update internal state:

```js
// ✅ Correct: setValue only updates state
setValue: (v) => { myState = v }

// ❌ Wrong: don't call _notifyChange in setValue (causes duplicate entries)
setValue: (v) => { myState = v; sw._notifyChange?.('old', 'new') }
```

`_notifyChange(oldDisplay, newDisplay)` should only be used when a plugin **proactively** changes state (not from user panel interaction) and needs to record it in the changelog, e.g.:

```js
// Timer auto-switches to dark mode
setTimeout(() => {
  state.darkMode = true
  const sw = registry.getSwitches().find(s => s.id === 'my-plugin:auto-dark')
  sw?._notifyChange('Light', 'Dark')
}, 3600000)
```

### Grouping Rules

The panel uses a collapsible tab layout:

- **Workbench** *(sliders icon)* — Built-in switches (ids starting with `dock-flash:`), grouped by `group` field into Appearance / Layout / System subgroups. In workbench mode the Layout subgroup is empty and is not rendered, because dock-base's own settings already own every dock layout property.
- **Extensions** *(blocks icon)* — Third-party switches (ids not starting with `dock-flash:`), automatically grouped by id colon prefix (plugin name)
- **Recent Changes** *(document icon)* — Switch change records from the last 30 seconds

Rule: `id.startsWith('dock-flash:')` is built-in, otherwise third-party. The `group` field on third-party switches is currently ignored; they are all placed in the Extensions tab grouped by source plugin.

The three tab glyphs are `sliders` / `blocks` / `doc` from the panel's own `_ICON_PATHS`. **The ⚡ lightning bolt is not a tab icon — it is the product mark** (`LIGHTNING_ICON`), shared by the sidebar panel header, the activity bar, the Settings card and the floating window.

Within the same group, switches are sorted by `order` ascending.

### quickControl Service API

| Method | Description |
| --- | --- |
| `registerSwitch(def)` | Register a switch, returns a dispose function |
| `unregisterSwitch(id)` | Unregister by id |
| `getSwitches()` | Get all switches (sorted by order ascending) |
| `notifyChange(id)` | Notify that a switch's value changed, triggers panel refresh |
| `recordChange(entry)` | Record a changelog entry `{ id, label, icon, oldDisplay, newDisplay }` |
| `getChangelog()` | Get change records from the last 30 seconds |
| `subscribe(fn)` | Subscribe to registry/value changes, returns a dispose function |
| `version` | Current registry version number (incremented on every change) |

---

## 🎨 Skin System

The skin switcher requires [dsh-market](https://github.com/AKS1st/dsh-market) to be installed — without it the switcher is not shown (disabled themes are invisible to DOM scan and the list would be incomplete).

### Skin Categories

| Category | Description | Examples |
| --- | --- | --- |
| **CSS** | Activated via `<style>` / `<link>` tags + body attributes | maid-atelier, official-homepage |
| **Managed** | Own lifecycle with canvas/WebGL/particles; toggled through `mount()` / `unmount()` | Mineradio |
| **Excluded** | Matched by discovery but hidden from the dropdown (conflicting or unreliable for external control) | bloom-theme, black-hole, theme-manager |

### dsh-market Integration

- Fetches the full list of installed/disabled themes (`/dsh-market/installed` API)
- Market-managed themes are activated via the `/dsh-market/use-skin` API (triggers a page refresh)
- Market-disabled themes are labeled "Not Enabled" in the dropdown

### Preference Persistence

Skin selection, panel order, the standalone trigger position, the trigger button size and the dragged overlay position are saved to the **host settings namespace** (`dock-flash` in your profile's `settings.yaml`), and restored on load. `localStorage` is kept only as a cache, so these preferences follow you to another browser or machine rather than staying behind with the browser profile. Values that predate this (still in `localStorage` only) are migrated into the profile once, on first load.

> For implementation details, switching mechanisms, exclusion rationale, and technical constraints, see [AGENTS.md](./AGENTS.md).

---

## 🌐 Internationalization

The panel includes built-in Chinese/English localization that auto-follows the DSH language setting. Third-party switches can use functional labels (`label: () => t('xxx')`) for dynamic refresh on language change.

---

## Installation

Requires a DSH Web environment. The plugin is on npm, so the **package name is the whole
spec** — no checkout needed:

```sh
# Install this plugin
dsh plugin --profile my-profile add dock-flash

# (Optional) Install dock-base for full workbench integration
dsh plugin --profile my-profile add dock-base

# Start — or restart, after installing anything new
dsh --profile my-profile
```

### Companion plugins — install these too (2.0.0 and later)

Since 2.0.0 dock-flash owns **no monitor at all**. The context, memory and network monitors and the
system-proxy controls each live in their own package now, and **upgrading from 1.6.x does not bring
them along**: without them the panel simply has no such rows, and nothing says so.

```sh
dsh plugin --profile my-profile add \
  dsh-flash-ctx-mon dsh-flash-mem-mon dsh-flash-net-mon dsh-flash-proxy
```

| Package | What it adds |
|---|---|
| `dsh-flash-ctx-mon` | **Context monitor** — precise token usage read from DSH session events, with three rising thresholds and the model-window map, plus the session skills chip |
| `dsh-flash-mem-mon` | **Memory / GC monitor** — RSS, growth rate and Major GC frequency |
| `dsh-flash-net-mon` | **Network monitor and outbound audit** — a connectivity heartbeat, plus an opt-in fetch tracer with a per-request risk score |
| `dsh-flash-proxy` | **System proxy control** — proxy mode, `NO_PROXY` policy, `testUrl` and connection diagnostics |

Each registers its own switch through this panel's services and keeps its own settings namespace, so
they show up as ordinary rows — the three monitors in the **System Alerts** cluster, proxy as its own
cluster. They need dock-flash **≥ 1.5** (`≥ 1.6` for mem-mon and net-mon, `≥ 1.0.15` for proxy), which
any 2.x satisfies.

**Other ways to install**, if npm is not what you want: a GitHub Release tarball
(`… add https://github.com/tcgbp/dock-flash/releases/latest/download/dock-flash.tgz`), git
(`… add github:tcgbp/dock-flash`), or a local checkout (`… add ./dock-flash` — for development, where
`lib/client.js` is live on refresh). The DSH **Plugins** page accepts the same package name and adds
one step: press **Enable now** after installing.

**Without dock-base**: dock-flash runs in standalone mode — a ⚡ trigger button is injected into the conversation slot picked by the `trigger-position` switch (default: input right), drawn at the size set by `trigger-size` (default 24px, up to 48px in a slot or 64px at the draggable **Conversation top-right** position). Click it to open the quick control popup panel (Appearance, Layout — trigger position and size — and System switches). The shared `sidebar.footer.action` slot is deliberately not offered, because other plugins occupy it too.

**With dock-base**: dock-flash integrates into the workbench — the ⚡ icon appears in the activity bar, and the panel can be opened as a sidebar or floating window with the Appearance and System switches. Dock layout properties (dock edge, auto-hide, reserve space, icon scaling) are configured in dock-base's own settings, not here.

## Development

```sh
pnpm install
pnpm run build      # tsc → dist/index.js
pnpm run typecheck  # type check only
```

For development rules, critical constraints, and testing conventions, see [AGENTS.md](./AGENTS.md). For what changed in each release and why, see [CHANGELOG.md](./CHANGELOG.md).

## Style Contract

This plugin follows the DSH Web style contract: all colors reference `--dsw-alias-*` design tokens (literals only as fallback), no theme-branching CSS selectors.

## Dependencies

| Dependency | Type | Description |
| --- | --- | --- |
| `dock-base` >=0.1.2-0 <1.0.0-0 \|\| >=0.2.0-0 <1.0.0-0 | peer (optional) | Provides `ctx.workbench` registry services for full workbench integration |
| `@deepseek-ai/cordis` >=4.0.0-rc.1 <5.0.0-0 \|\| >=4.0.1-0 <5.0.0-0 | peer | Plugin framework (bundled with DSH) |

## License

[Apache License 2.0](./LICENSE)
