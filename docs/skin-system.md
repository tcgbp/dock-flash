# dock-flash — the skin system

Moved out of `AGENTS.md` because it is a REFERENCE rather than a rule: the scan phases, the
categories, and the preference bridge are needed when working on the skin system, not while writing
unrelated code — and at ~6 KB it was crowding a budget that `AGENTS.md` pays on every request
(`pnpm run check:docs` reports the headroom).

`AGENTS.md` keeps the rules that must be in mind while editing. This file keeps the shape they
operate on, the measurements behind them, and the reference tables.

---

## The scan

| Phase | Source | What It Finds |
|---|---|---|
| 0 | Managed skin registry | Skins with own lifecycle (Mineradio) — detected via config/DOM |
| 1a | `<style data-plugin>` / `<link data-plugin>` | DSH runner-injected styles, deduplicated by package name |
| 1b | `<style data-skin-chrome>` | Styles created by plugins inside `ctx.effect()` |
| 2 | Body/HTML attributes | Attribute-only skins (`data-dsh-*`) |
| 3 | _(removed)_ | Old manual list deleted |
| 4 | `__DSH_BOOT__` / `graphRows` + plugin manager entries | Installed-but-inactive plugins (discovered via `listPlugins()`/`listBundles()`) |
| 5 | `_skinLiveMarks`, present in the document | Handle-less skins that ARE rendering but that every other phase misses (added 1.6.x) |
| 6 | The profile's own `package.json`, via the host route `/plugins/dock-flash/profile-packages` | Skins that are INSTALLED but switched OFF — the only source that can see them on DSH Desktop, whose plugin manager refuses the reserved desktop profile |

**Every one of these seven is an entry path into the same list**, which is why the filters are stated
as ONE predicate — `_skinAllowed(id)` is `_skinHint.test(id) && !_skinExclude.test(id)`, exclusion
included — rather than repeated per phase. A filter applied to fewer than all of them leaks through
the rest — that is not hypothetical: an earlier version
gated only the plugin-manager merge and `dsh-client-liang-intensity-skin` kept appearing, because
phase 1a found its own `<style data-plugin>` tag and phase 4 found it in the boot manifest.

### Why phase 5 exists, and what it cost to learn

Measured on the maintainer's own profile, with `dsh-dream-skin` installed and rendering:

| Source | What it held |
|---|---|
| `_skinBodyAttrs` | 3 entries — maid-atelier, official-homepage, claude-style-skin. **Not Dream.** |
| `__DSH_BOOT__.entries` | **73 ids, containing neither `dsh-dream-skin` nor `dock-flash`** — though both are in `dsh.profile.bundles` and both were running |
| `listPlugins()` (via the hook) | `[]` |
| `_skinInEffect('dsh-dream-skin')` | **true** — its marks are in the page |

So `_knownSkins()` omitted Dream while `_getActiveSkinId()` — which reads those marks — kept naming
it. The visible symptom was "switch to claude-style and it snaps back to Dream", and the trace proved
why: **not one `bundle` line**, i.e. `_switchSkinBundle()` was never called, because the
deactivate-others loop iterates `_knownSkins()` and Dream was not in it. **Detection read the DOM;
discovery did not.** Phase 5 closes that by treating a curated mark as proof of installation — the
same class of evidence as the plugin's own style tag, which the managed-skin install rule already
accepts. It lists only; it never removes.

**Two assumptions this killed, both now rules in `AGENTS.md`:** `__DSH_BOOT__.entries` is **not** a
complete install list, and a **rejected** `listPlugins()` is not an empty one. The second was a
session-long poison: a rejection was reported as `data: []` with `pmAvailable: true`, the empty
snapshot was cached, and every skin then read `NO ADDRESSABLE ROW` until a reload.
### Phase 6: the state nothing could prove

Phase 5 covers a handle-less skin that is *on*. The mirror case is worse, and it is what DSH Desktop
creates: a skin that is installed but switched **off** has no DOM mark, no `__DSH_BOOT__` row and no
plugin-manager row either — the manager refuses the reserved desktop profile
(`manageDesktopProfile` / `rejectElectronProfile`), so `listPlugins()` and `listBundles()` both
answer nothing. Measured with 7 packages installed: `plugins: []` and `bundles: []`.

Two consequences, both real defects:

1. **The dropdown could not list it**, so it could be switched OFF and never back ON.
2. **`_switchSkinBundle()` could not even READ the state** it was about to change: the bundle path
   looks the package up in `listBundles()` and, finding no row, gives up with "no lever available"
   — so the OFF direction was a silent no-op too.

The profile's own `package.json` is the last source standing: `dependencies` is what is installed and
`dsh.profile.bundles` is what this DSH actually composes at boot. The HOST half reads it
(`readProfilePackages()`) and exposes it on `/plugins/dock-flash/profile-packages`; the client caches
it exactly like the plugin entries (cache only a read that brought something, notify only when rows
arrive) and uses it twice: **phase 6 lists what is installed-but-inactive**, and the bundle path
accepts a write when the manifest proves the package is real — with the same "already in the wanted
state writes nothing" guard, so a press that changes nothing cannot reload in a loop. The diagnostic
hook reports it as `profilePackages: N installed, M active | installed-but-off: ...`.

**`DSH_PROFILE_DIR` is NOT available to the host half — measured, and it cost a defect.** The harness
exports `DSH_PROFILE` / `DSH_PROFILE_DIR` into every *model shell call* of a profile-launched session
and omits both when it booted without a profile: they are **shell facts, not facts of the host
process**. The first version of this route read them and answered "the launch environment names no
profile directory" from the running Desktop app — the feature was inert while looking implemented.
(`dsh-shell-env` builds both variables FROM `profileContext`, which is why a *model shell* knows the
profile while the host process environment does not carry it at all.)

**The profile is DECLARED by the launcher — and guessing it from `readdirSync` order cost the second
defect.** Every profile boot provides the service `profileContext` before any plugin mounts:
`runProfile()` builds `{ name, dir, patchPath, installAnchor, startedBundles, cwd, home, … }` and
`hostCtx.provide("profileContext", …)`; a host plugin reads it with `ctx.get('profileContext')`. So
`readProfilePackages()` now tries, in order: `profileContext().dir`,
`dirname(profileContext().patchPath)`, this boot's own `ctx.baseUrl`, and only then the guesses
(the environment, `$DSH_HOME/profiles/<name>`, `--profile` / `--profile-dir` from `process.argv`,
every directory under `~/.dsh/profiles`, `cwd`) — picking the manifest whose `dependencies` name
**this plugin**, because a profile lists the plugins installed in it. It also returns `tried`, so a
failure names every candidate it examined instead of leaving the next reader to guess.

**MEASURED, and this was the whole reported defect: finding a profile that lists dock-flash is not
enough when TWO of them do.** `~/.dsh/profiles` held `desktop` and `web`, both with dock-flash
installed, and `readdirSync` returns `desktop` first. A `dsh web` process — the RUNNING profile being
`web` — therefore answered `dir: …\profiles\desktop` on `/plugins/dock-flash/profile-packages`, and
every skin toggle wrote `profiles\desktop\cordis.patch.yml` while the running loader watched
`profiles\web\cordis.patch.yml`. Each write honestly reported `application: "applied"` and the page
reloaded; no skin ever came up, and `__dockFlashSkinTrace()` showed `inEffect: []` on every render
while `stored` named the skin. On DSH Desktop the same bug is invisible — the reserved `desktop`
profile is both the running profile and the first `readdirSync` hit — which is exactly why the report
read "在桌面版是生效的呀". The launcher's own answer removes the ambiguity, so the `readdirSync`
branch is now the LAST resort instead of the deciding one.

### The entry id does not have to come from `listPlugins()`

The live, symmetric switch is `setPluginEnabled(entryId, enabled)` — it acts on the RUNNING loader and
writes or clears that entry's `disabled:` row. `setBundleEnabled()` only edits `dsh.profile.bundles`,
which the running host composes **at its own boot**, so a page reload cannot apply it and a DSH restart
is the honest answer — which would make every handle-less-skin switch a restart, i.e. not a usable
control at all.

The code kept falling through to the bundle layer because of one unnecessary dependency: `entryId` was
taken from `listPlugins()` rows, and **on DSH Desktop there are none** (the plugin manager refuses the
reserved desktop profile, so no row ever arrives). But MEASURED: DSH's **own** Plugins page toggles the
very same plugin **live** on that profile. Its rows are not what makes that possible — the entry id is,
and `__DSH_BOOT__.entries` carries the same ids for every client plugin the page loaded.
`_entryIdCandidates()` reads them, restricted to strings that name this package or its `/client` half,
so a wrong id can never toggle somebody else's plugin.

`setPluginEnabled()` also answers the question the UI cares about:

| `value.application` | Meaning | What dock-flash does |
|---|---|---|
| `"applied"` | DSH changed the running loader | nothing more — no reload needed |
| `"restart-required"` | only the next boot can apply it | warns, like DSH's own dialog does |
| absent / unknown | an older host, or a stub | keeps the reload — assuming "live" from silence would leave a page that never changes |

Two guards keep it from becoming a write storm: the entry path is only attempted when the known state
(`__DSH_BOOT__` plus the profile manifest) **disagrees** with the wanted one, and an addressable entry
is authoritative — the bundle layer is reached only when there was no row at all, never after a failed
entry write, because that would edit the install layer for a plugin the loader can already address.

The reload after a switch stays. An entry DSH reports as `applied` still lets the plugin mount a moment
later, so "the marks are not back yet" is not evidence that nothing happened; a page reload is cheap,
and what must never be required is a **DSH restart**.


## One skin, one id — the duplicate that keeps coming back

**Filtering has one predicate. Identity did not, and that is the same defect three releases apart.**
The dedup is exact string equality (`seen.has(id)`), while each source spells an id differently:

| Source | id it produces for `claude-style-skin` |
|---|---|
| 1a `style[data-plugin]` | `_canonicalSkinId` — text before the first `/` → `claude-style-skin` |
| 1b `style[data-skin-chrome]` | **verbatim** unless a suffix strip is confirmed → `claude-style-skin-style` |
| 2 body attribute | the `_skinBodyAttrs` KEY → `claude-style-skin` |
| 4 boot manifest / graphRows | minus `/client` → `claude-style-skin` |
| plugin-manager entries | `_skinBundleName(moduleName)` — only `/client` removed |
| plugin-manager bundles | `name` verbatim (`dsh-`-prefixed names are real: `_skinEntryRow` strips that prefix before matching) |

So one skin enters the dropdown twice, and **only one of the two ids is addressable** — picking the
other refuses silently. `_labelFromId()` hides how bad this looks, because it strips a leading `dsh-`
and a trailing `-skin`: `claude-style-skin` and `dsh-claude-style-skin` BOTH render as **"Claude
Style"** — two identical-looking rows.

**0.15.3** fixed the 1b-vs-4 pair by cross-referencing the boot manifest. **1.6.x** hit it again as
1b-vs-2, because that cross-reference was too narrow in two ways at once:

```js
if (_bootIds.size && !_bootIds.has(id) && !_bootIds.has(id + '/client')) { … strip … }
```

- the `_bootIds.size &&` gate disabled the entire strip whenever no boot manifest was present, and
- the only confirmation source consulted was `_bootIds` — while the canonical id was sitting in
  `_skinBodyAttrs`, this plugin's own curated table, the whole time.

Measured on a real profile (`await window.__dockFlashSkinSwitch()`, `market: unavailable`,
`plugins: []`, `bundles: []` — so neither the market nor the plugin manager was involved):

```
skins:
  claude-style-skin-style | sel=style[data-skin-chrome="claude-style-skin-style"] | bodyAttr=null
  claude-style-skin       | sel=null | bodyAttr=data-dsh-claude-style
```

The second row's `bodyAttr` is what proves `_skinBodyAttrs` already held the canonical id. The fix
widens the confirmation set to `_bootIds` ∪ `_managedSkins` ∪ `_skinBodyAttrs` ∪ the ids earlier phases
saw, and drops the `.size &&` gate — **still never stripping blindly**, because a package may genuinely
be called `foo-style`:

```js
const _chromeKnown = (candidate) =>
  _bootIds.has(candidate) || _bootIds.has(candidate + '/client') ||
  Object.prototype.hasOwnProperty.call(_skinBodyAttrs, candidate) ||
  Object.prototype.hasOwnProperty.call(_managedSkins, candidate) ||
  seen.has(candidate)
```

After canonicalizing, 1b's entry carries BOTH the chrome `sel` (used to remove the CSS on deactivate)
and the `bodyAttr` (it reads the table itself and adds to `claimedAttrs`), so phase 2 is skipped by
`seen` and the pair collapses into one strictly better row.

**The rule for the next source**: canonicalize before `seen.has()`/`seen.add()`, or the duplicate
returns through whatever door was added last. `AGENTS.md` Critical Rule 8.


## Skin Categories

| Category | Example | Toggle Mechanism |
|---|---|---|
| **Managed** | Mineradio | iframe → `storage` event → `onStorage` → `sync()` → `mount()`/`unmount()` |
| **CSS** | maid-atelier, official-homepage | `el.remove()` deactivation + `mod.import()` / `<script>` reactivation |
| **Excluded** | bloom-theme, black-hole, theme-manager, any `timeline` plugin | Filtered by `_skinExclude`, never appear in dropdown |

> **A timeline plugin is not a skin, and `_skinExclude` is what keeps it out.** `dsh-codex-timeline` matches `_skinHint` through its `codex` token — a token that exists for a real Codex-style skin — and injects `<style data-plugin="dsh-codex-timeline">`, i.e. it looks exactly like a CSS skin to the DOM scan. It must not be listed: the switcher deactivates a skin by **removing** its style element (Critical Rule 2), which would strip that plugin's own stylesheet. `_skinExclude`'s `timeline` entry and `_timelineOwner()`'s `/timeline/i` are the same notion — "another plugin owns the turn rail" — and the turn-rail switch stands down when either reports it.

> **The skin switcher is registered unconditionally.** `_registerSkinSwitch()` runs regardless of
> whether any market plugin is installed — DSH's native plugin manager (via
> `ctx.remote.pluginManager` and `ctx.remote.pluginInventory`) provides disabled-skin discovery.
> Without the plugin manager remote, only currently-loaded skins appear; disabled ones are
> invisible until enabled.

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

The plugin manager's enabled skin entry is consulted first in `_getActiveSkinId()`, but only
when the host preference has not been explicitly set to `default` — otherwise the stale enabled
state would overwrite the user's choice. The preference is written through to both layers when
it disagrees with the host, so an unchanged value costs no round trip, and a `MutationObserver`
on `<head>` re-applies the preference when late-loading skins appear.

---

## Skin Discovery and Activation (Plugin-Manager-Based)

Discovery and activation use DSH's native plugin manager (`ctx.remote.pluginManager` and
`ctx.remote.pluginInventory`), not the dsh-market HTTP API. The market plugin (`dsh-skin-market`)
is no longer a dependency.

### Discovery

`_pluginManagerSkinExtras(seenIds)` supplements the DOM scan with skins that have no DOM evidence
(because they are disabled). It reads `_pluginEntriesCache`, which is populated by
`_fetchPluginEntries()` calling `listPlugins()` and `listBundles()` on the plugin manager remote.
A disabled skin has no `<style>` tag, no body attributes, and no boot-manifest evidence, so only
the plugin manager can discover it.

### Classification

`_skinAllowed(id)` is a **pure name heuristic**: `_skinHint.test(id) && !_skinExclude.test(id)`.
The market's `/dsh-market/registry` classification (`category: theme`) is no longer consulted. This
is less restrictive — a non-theme package whose name matches `_skinHint` (e.g. `dsh-client-liang-intensity-skin`)
may appear in the dropdown — but it is consistent with what the DOM scan already uses, and the market's
registry data is no longer available.

### Activation

`_activateThemeViaPluginManager(name, gen)` replaces `_activateThemeViaMarket()`. It uses
`setPluginEnabled(entryId, true/false)` — the same mechanism already used by `_switchSkinBundle()`
for handle-less skins — to (1) enable the target skin's loader entry and (2) disable all other skin
entries. This is the **entry-level** switch (`setPluginEnabled`), not the bundle-level switch
(`setBundleEnabled`), because the entry switch changes the running loader and is symmetric (true
clears the row false wrote).

### `inject` declarations

The plugin must declare both remotes in its `inject` array:
```js
inject: ['remote', 'remote.settings', 'remote.pluginManager', 'remote.pluginInventory']
```
And `dsh.client.inject` must name `"@deepseek-ai/dsh-api-remotes"` for load order.
Both declarations are required — see AGENTS.md "Skin System Architecture" for the full rule.

### Diagnostics

`__dockFlashSkinSwitch()` shows `pluginManagerState:` (entries with `skin`/`theme`/`macintosh` in their
name, with their enabled/disabled state) instead of the old `market:` field. Skin objects carry
`pmOnly: true` (replacing `marketOnly`) when discovered only through the plugin manager.

---

## See also

- The rules that must hold while editing: `_skinExclude` in every phase, `_skinAllowed`, the
  `skin`-token trap, and the failed-activation release — in `AGENTS.md`, Critical Rule 8.
- Why each rule exists, with measurements: [architecture-notes.md](architecture-notes.md).
- The per-change verification procedure: [testing-checklist.md](testing-checklist.md).

---

## Moved out of `AGENTS.md` — the preference bridge and the `remote` contract

Relocated verbatim in substance, because both are REFERENCES read when changing a preference or
touching a typert namespace, not rules needed while writing unrelated code. `AGENTS.md` keeps the one
line that must not be missed: a new preference means `SettingsSchema` + the `loadHostPreferences()`
mapping + a read from `_hostPrefs` + a write through `savePrefs()` — **the mapping list IS the
contract** (`triggerOverlayOffset` shipped declared-and-read but never mapped, so a host-held value was
silently ignored on load).

**User preferences are host settings, not localStorage keys** — localStorage is a cache, never the
authority. `panelOrder`, `activeSkin` and `triggerPosition` all live in the host namespace.

**A typert namespace resolves only if declared in `inject`, ONE ENTRY PER NAMESPACE** — the mount point
`"remote"` plus `"remote.<ns>"` for every namespace actually used (`"remote.settings"`,
`"remote.pluginManager"`, `"remote.pluginInventory"` …). The gateway registers each namespace as its own
service (`remoteServiceKey(ns)` is `remote.${ns}`) and the guard proxy refuses an undeclared one, so a
plugin that merely `ctx.get('remote')`s a namespace gets `undefined`. **`dsh.client.inject` naming the
remotes package is load order, not access** — both declarations are needed.

`describe()` answers `{ ok, value }` with the namespace list at `value.namespaces`, and
`settings.update(ns, patch, expectedRevision)` takes **three** arguments.

### The "one-way door", recorded because it is why the market path was removed

Reaching for `POST /dsh-market/toggle` looked right and was not — **that route was the market's PLUGIN
switch, not a skin switch**: it appended a `disabled: true` row to the profile's `cordis.patch.yml` AND
dropped the package from `dsh.profile.bundles`, while the only path back (`/use-skin` →
`activateTheme()`) did live loader work and cleared neither. Two installed themes became impossible to
re-enable from the theme page. **A UI control never edits the install layers: it must use a switch that
has an inverse.** The plugin-manager entry switch is that inverse; the market route never was.

### Diagnostics hooks

`__dockFlashSkinSwitch()` prints the plugin manager's skin-like entries with their enabled state;
skin objects discovered only through the plugin manager carry `pmOnly: true`. `__dockFlashSkinTrace()`
prints the 40-entry `sessionStorage` ring (route, whether the write landed, whether a reload was
scheduled).

---

## The market integration is inert — do not "fix" a bug by reasoning about it

**Nothing in this tree ever calls dsh-market.** The evidence, all five parts measurable from a
checkout:

- `const _marketApiBase = '/dsh-market'` is declared and **never used** — there is no
  `fetch(_marketApiBase + …)` anywhere.
- The only `fetch()` targets in the client are `/plugins/dock-flash/*`
  (`profile-packages`, `set-plugin-entry`, `proxy-status`, `test-connection`, `clear-alerts`).
- The loader that used `/dsh-market/installed` was replaced by `_pluginManagerSkinExtras()`.
- The activation path that used `POST /dsh-market/use-skin` was replaced by
  `_activateThemeViaPluginManager()`.
- `let _marketThemes = null` is the ONLY assignment to it. Nothing populates it, so
  `_isMarketLiveTheme()` returns `false` unconditionally (it opens with
  `if (!_marketThemes || …) return false`).

**Consequence: the three `_isMarketLiveTheme()` call sites are dead branches.** Each is shaped
`if (!bootMode && _isMarketLiveTheme(skin.id)) { …write the bundle roster… }`, so the roster write
they guard can never run. That is why the OFF direction had to reach `dsh.profile.bundles` by another
route (see the next section) — and it is why "the market still says it is live" is not an explanation
for any symptom in this build, however plausible it sounds. The market can be installed and enabled
(its own plugin does load); it simply is not what this feature reads or writes.

`_skinAllowed(id)` matches: it is `_skinHint.test(id) && !_skinExclude.test(id)` — a pure name
predicate with no registry lookup.

## The switch writes TWO layers, and neither may replace the other

The two halves are not interchangeable:

| Layer | Written by | Governs | Visible |
|---|---|---|---|
| the ENTRY row (`disabled:`) | `setPluginEnabled(entryId, …)`, or the HOST route when the remote cannot address the profile | the RUNNING loader | at once |
| `dsh.profile.bundles` | `_switchSkinBundle()` → `byBundlePath()` → `setBundleEnabled(package, …)` | what the NEXT boot composes | after a reload |

### The entry id is not derivable from the package name

`_entryIdCandidates()` builds guesses from the package name and the boot manifest, and DSH answers
`unknown-plugin` for each wrong one. MEASURED on `dsh-dream-skin`: its real entry id is `dream-skin`,
which lives in the package's own `cordis.patch.yml`, so both guesses (`dsh-dream-skin`,
`dsh-dream-skin/client`) failed. The working lever is `POST /plugins/dock-flash/set-plugin-entry`,
whose host half reads that same file through `entryIdFor()`.

### The row must NOT carry `name:` — DSH skips a name mismatch

`applyEntryPatches()` — the ONE algorithm that composes the profile patch, the live loader included —
indexes the base rows by `id` and, for a non-insert row, skips it when the row's `name` differs from
the target entry's own name:

```
patch: name mismatch for "dream-skin" (expected "dsh-dream-skin", got "dream-skin"), skipping
```

An earlier version of the host writer echoed the ENTRY ID into `name:`, so every row it appended was a
name mismatch: the file changed, DSH ignored the change, and the route still reported `applied`.
MEASURED by composing both shapes through DSH's own `composeEntries()` over the dream-skin bundle
layer (`- insert: [ - id: dream-skin / name: 'dsh-dream-skin' ]`):

| row written | composed entry | warning |
|---|---|---|
| `- id: dream-skin` + `name: dream-skin` | `{id: dream-skin, name: dsh-dream-skin}` — untouched | `patch: name mismatch … skipping` |
| `- id: dsh-dream-skin` (the package name) | — | `patch: entry "dsh-dream-skin" not found` |
| `- id: dream-skin` + `disabled:` | `{…, disabled: false}` | none |

So `name` is optional here and the id is not: DSH's own writer (`writePluginEnabled`) appends exactly
`{ id, disabled }` and never writes a `name:`. The same trap applies to `dsh-claude-style`
(`- insert: [{id: ui-skin-claude-style, name: 'dsh-claude-style'}]`).

### An empty candidate list is not "nothing to do" — it is the cold-load first press

Before `/plugins/dock-flash/profile-packages` answers, `_profilePackages()` is `null`, so this branch
computes:

```js
var enabledNow = _isBootLoaded(name) || !!(pkgsNow && pkgsNow.active.indexOf(name) !== -1)
if (enabledNow !== !!enabled) candidates = _entryIdCandidates(name)
```

For a DISABLE, `enabledNow` reads `false` — which **equals** the wanted `false` — so `candidates`
stays empty. MEASURED trace of the first press of 默认 after a cold load, `setValue('default')`:

```
press   {value: "default", path: "pluginManager"}
reload  {why: "applySkin:default"}
```

No `entry` line and no `host` line: the press fell straight through to `byBundlePath()`, which has no
lever on DSH Desktop, wrote nothing, and reloaded on the `inEffect` rule alone. The **second** press
worked, because the first reload had populated the manifest cache — which is exactly the reported
"从 Dream 切回默认需要切两次".

The fix routes that branch through the HOST first, and then writes the roster as well:

```js
if (!candidates.length) {
  return _setEntryViaHost(name, enabled).then(function (application) {
    if (application === null) return byBundlePath()          // host half without the route
    return byBundlePath().then(function (wrote) {
      return wrote === true || application === 'applied'      // reload only on a real change
    })
  })
}
```

Writing **only** the entry is the regression that followed the first attempt at this fix: it left
`dsh-dream-skin` in `dependencies` but out of `dsh.profile.bundles`, so the plugin was switched ON in
the loader and never loaded ("选了 Dream 还是停用") — the roster is what the next boot composes from.
The negative controls are the other direction: `application === null` (an older host half) still
falls back to the bundle path, and a satisfied switch reports `changed: false`, so a press that
changes nothing writes nothing and cannot reload in a loop.

## A CSS skin active under a non-CSS stored skin is a STRAY

`enforceBootSkin()` has two CSS branches, and both are gated on `targetIsCss`:

```js
const targetIsCss = target && !target.managed && !_skinNotControllable(target)
if (targetIsCss && activeIds.length > 1) { … }
else if (targetIsCss && activeIds.length === 1 && activeIds[0] !== storedSkin) { … }
// else: 什么都不做   ← the bug lived here
```

The gate is right for a CSS target: the CSS layer is what activates it, so `_applySkin(storedSkin,
true)` is the correct enforcement. It is wrong for a handle-less or managed target (Dream, macintosh,
Mineradio), whose own lifecycle activates it — there is nothing in the CSS layer to activate, so
"do nothing" was the reasoning. But the STRAY skins are a separate problem, and nobody was left to
handle them.

MEASURED, with Dream as the stored skin and `claude-style-skin` also active:

```js
{body: document.body.getAttribute('data-dsh-claude-style'),   // "" — still present
 tag: !!document.getElementById('claude-style-skin-style'),    // true — still in <head>
 dream: document.documentElement.getAttribute('data-dsh-material')}  // "frosted"
```

The page wore both, on every boot, and Claude's 52 CSS rules are all gated on that body attribute —
so its styles polluted whatever else was selected ("Claude 不会被停用,它的样式会污染别的皮肤"). The
press path does not cover it either: `_activateThemeViaPluginManager()` writes a CSS skin's bundle
only when the market still calls it `live` (`_isMarketLiveTheme`), which — see the first section — is
never true in this tree.

The `else` branch now switches the strays off **as plugins**, which is what keeps them from loading
at all next time:

```js
} else if (!targetIsCss && activeIds.length > 0) {
  _skinTrace('boot-enforce', { storedSkin, reason: 'stray-css-skins-vs-non-css-target', activeIds })
  const stray = activeCss.filter((s) => s.id !== storedSkin)
  for (const s of stray) { try { _switchSkinBundle(s, false) } catch (_) {} }
}
```

- Deliberately **not** `_applySkin(storedSkin, true)`: the target must not be "activated" through the
  CSS layer.
- No `pending` collection and no reload: boot mode reloads nothing, and the write is for the NEXT
  load — which is precisely when the stray would have painted again.
- Idempotent: `_switchSkinBundle()` keeps its own already-satisfied guard, so repeated ladder passes
  write nothing.

The negative control is the reported behaviour itself: with this branch absent the stray survives
every boot; with it present `claude-style-skin` is switched off as a plugin (entry row + roster) and
Dream is left untouched — verified by a sandbox harness that plants exactly the DOM above.
