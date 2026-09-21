# dock-flash — the skin system

Moved out of `AGENTS.md` because it is a REFERENCE rather than a rule: the scan phases, the
categories, and the preference bridge are needed when working on the skin system, not while writing
unrelated code — and at ~6 KB it was crowding a budget that `AGENTS.md` pays on every request
(`pnpm run check:docs` reports the headroom).

`AGENTS.md` keeps the rules that must be in mind while editing. This file keeps the shape they
operate on, the measurements behind them, and the reference tables.

---

## 5-Layer Scan

| Phase | Source | What It Finds |
|---|---|---|
| 0 | Managed skin registry | Skins with own lifecycle (Mineradio) — detected via config/DOM |
| 1a | `<style data-plugin>` / `<link data-plugin>` | DSH runner-injected styles, deduplicated by package name |
| 1b | `<style data-skin-chrome>` | Styles created by plugins inside `ctx.effect()` |
| 2 | Body/HTML attributes | Attribute-only skins (`data-dsh-*`) |
| 3 | _(removed)_ | Old manual list deleted |
| 4 | `__DSH_BOOT__` / `graphRows` + dsh-market API | Installed-but-inactive plugins |

**Every one of these five is an entry path into the same list**, which is why the filters are stated
as one predicate (`_skinExclude`, and then `_skinAllowed`) rather than repeated per phase. A filter
applied to four of the five leaks through the fifth — that is not hypothetical: 1.4.2 gated only the
market-`installed` merge and `dsh-client-liang-intensity-skin` kept appearing, because phase 1a found
its own `<style data-plugin>` tag and phase 4 found it in the boot manifest.

## Skin Categories

| Category | Example | Toggle Mechanism |
|---|---|---|
| **Managed** | Mineradio | iframe → `storage` event → `onStorage` → `sync()` → `mount()`/`unmount()` |
| **CSS** | maid-atelier, official-homepage | `el.remove()` deactivation + `mod.import()` / `<script>` reactivation |
| **Excluded** | bloom-theme, black-hole, theme-manager, any `timeline` plugin | Filtered by `_skinExclude`, never appear in dropdown |

> **A timeline plugin is not a skin, and `_skinExclude` is what keeps it out.** `dsh-codex-timeline` matches `_skinHint` through its `codex` token — a token that exists for a real Codex-style skin — and injects `<style data-plugin="dsh-codex-timeline">`, i.e. it looks exactly like a CSS skin to the DOM scan. It must not be listed: the switcher deactivates a skin by **removing** its style element (Critical Rule 2), which would strip that plugin's own stylesheet. `_skinExclude`'s `timeline` entry and `_timelineOwner()`'s `/timeline/i` are the same notion — "another plugin owns the turn rail" — and the turn-rail switch stands down when either reports it.

> **Without dsh-market**: the skin switcher is not registered at all — `_registerSkinSwitch()` is only called from `_refreshMarketThemes()` on success. Without market, disabled themes are invisible to DOM scan and the list would be incomplete.

## Managed Skin Configuration

| Skin | localStorage Key | Activation Attribute |
|---|---|---|
| Mineradio | `dsh.ui-mineradio.enabled` | `data-dsh-aqua` |

A managed skin is one whose own lifecycle gates it, so dock-flash cannot toggle it by touching style
tags; `_toggleManagedSkin()` writes the plugin's private key and drives the cross-tab `storage` event
(Critical Rule 3). Adding one means adding a `_managedSkins` entry — `label`, `enabledKey`,
`pluginId`, `activeAttr`, `installedSelector`.

---

## User preferences live in the host, not the browser

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
> [architecture-notes.md](architecture-notes.md).

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

**Push a new preference through every layer, in this order**: add the field to
`src/index.ts`'s `SettingsSchema` with a `.default()`, map it in the client's `loadHostPreferences()`,
read it from `_hostPrefs` (never from localStorage first), and write it through `savePrefs()`. The
mapping list is the contract — `triggerOverlayOffset` shipped declared-and-read but **never mapped**,
so a host-held value was silently ignored on load and only the browser cache answered.

> Migration rules, and the 1.1.0 defect that produced the two habits above:
> [architecture-notes.md](architecture-notes.md).

## Preference Persistence

The market's `live` theme is written through to both layers on read, but only when it disagrees with
the host, so an unchanged value costs no round trip, and a `MutationObserver` on `<head>` re-applies
the preference when late-loading skins appear.

---

## See also

- The rules that must hold while editing: `_skinExclude` in every phase, `_skinAllowed`, the
  `skin`-token trap, and the failed-activation release — in `AGENTS.md`, Critical Rule 8.
- Why each rule exists, with measurements: [architecture-notes.md](architecture-notes.md).
- The per-change verification procedure: [testing-checklist.md](testing-checklist.md).
