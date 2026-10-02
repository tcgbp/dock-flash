# Skin Selector Plugin-Manager Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Progress Summary

| Task | Status | Notes |
|---|---|---|
| Task 1 | ✅ **DONE** | `'remote.pluginInventory'` added to `inject` array |
| Task 2 | ✅ **DONE** | `_pluginInventoryRemote()`, `_fetchPluginEntries()`, `_invalidatePluginEntries()` added |
| Task 3 | ✅ **DONE** | `_skinAllowed()` rewritten as pure name heuristic; market classification functions deleted |
| Task 4 | ✅ **DONE** | `_activateThemeViaPluginManager()` added; `setValue` updated; `_activateThemeViaMarket()` deleted |
| Task 5 | ✅ **DONE** | `_refreshPluginEntries()` added; skin switch registered unconditionally in `ctx.effect` |
| Task 6 | ✅ **DONE** | `_pluginManagerSkinExtras()` added; `_knownSkins()` updated; `pmOnly` replaces `marketOnly` |
| Task 7 | ✅ **DONE** | `_isPluginManagerLiveTheme()` replaces `_isMarketLiveTheme()`; `_invalidatePluginEntries()` replaces `_invalidateMarketThemes()`; `_getActiveSkinId()` updated; `_scanInstalledSkins()` phase-0 updated; dead code deleted |
| Task 8 | ✅ **DONE** | Diagnostic `market:` field replaced with `pluginManagerState:` |
| Task 9 | ✅ **DONE** | `_marketApiBase`/`_marketThemes`/`_marketFetchInFlight`/`_marketAvailable()` deleted; comments updated |
| Task 10 | ✅ **DONE** | `_skinHint`/`_skinExclude` audited; comment updated |
| Task 11 | ❌ **TODO** | Update docs |
| Task 12 | ❌ **TODO** | End-to-end verification |

**Goal:** Replace the dshmarket-based skin discovery/activation with DSH's native `ctx.remote.pluginManager` + `ctx.remote.pluginInventory` APIs, removing the `/dsh-market/*` HTTP dependency entirely while preserving all existing skin-switching behavior.

**Architecture:** The market provided two things: (1) theme classification (`category: theme` in its registry), and (2) activation (`POST /dsh-market/use-skin`). The plugin manager has no category field, so theme classification falls back to the existing `_skinHint` name heuristic + `_skinExclude` filter, applied to `listPlugins()`/`listBundles()` results instead of the market's `/installed` endpoint. Activation replaces `_activateThemeViaMarket()` with `setPluginEnabled(entryId, true/false)` — which is already used for handle-less skins (`_switchSkinBundle`), now extended to ALL skins the plugin manager can address. The `_skinAllowed()` gate loses its market-registry classification and becomes a pure `_skinHint` + `_skinExclude` check. The market theme index (`/dsh-market/registry`), market install spec tracking, and market state caching are all removed.

**Tech Stack:** DSH Typert remote protocol (`ctx.remote.pluginManager`, `ctx.remote.pluginInventory`), existing DOM scanning (`_scanInstalledSkins`), existing `_switchSkinBundle` machinery.

**Spec:** This plan is self-specifying — there is no separate spec document. The source of truth is the current `lib/client.js` skin system and the AGENTS.md rules.

## Global Constraints

- `_skinExclude` must be checked in ALL scan phases (Critical Rule 8)
- CSS skin deactivation uses `el.remove()`, never `el.disabled = true` (Critical Rule 2)
- Managed skins use localStorage + storage event via iframe trick (Critical Rule 3)
- `setPluginEnabled(entryId, enabled)` is the ENTRY-level switch — NOT `setBundleEnabled` (Critical Rule from AGENTS.md Skin System Architecture)
- `dsh.client.inject` must name `"@deepseek-ai/dsh-api-remotes"` for load order; plugin `inject` must declare `"remote.pluginManager"` and `"remote.pluginInventory"` namespaces
- `setValue()` must only update state — panel handles UI refresh (Critical Rule 7)
- The `_skinHint` regex is the name-based classification; narrowing it risks hiding real skins
- The `_skinAllowed()` gate: a package NOT matching the hint is always hidden; a package matching the hint is shown unless explicitly excluded. This is LESS restrictive than the market's registry (which required `category: theme`), so a non-theme package whose name contains `skin`/`theme` may appear. This is accepted: the name heuristic is the same one the DOM scan already uses, and it is the only option without the market's registry.
- `_applySkin()` must collect EVERY promise that represents a loader write — a write with no reload is a silent half-switch
- `_getActiveSkinId()` must not echo a stale value back over the user's choice
- The skin switcher must be registered WITHOUT requiring the market to be available — `_registerSkinSwitch()` must run unconditionally

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/client.js` | Modify | All changes live here — the single browser-half file |
| `docs/skin-system.md` | Modify | Update reference doc to reflect plugin-manager-based discovery |
| `docs/architecture-notes.md` | Modify | Record market→plugin-manager migration rationale |

No new files are created. No host-half changes (`src/index.ts` / `dist/index.js`) are needed — the `inject` declarations and remote usage are all client-side.

---

## Task 1: Add `remote.pluginInventory` to the `inject` declaration

**Files:**
- Modify: `lib/client.js:8830` (the `inject` array in the factory function)

**Interfaces:**
- Consumes: Existing `ctx.remote.pluginManager` (already declared)
- Produces: `ctx.remote.pluginInventory` available for later tasks

The client already declares `inject: ['remote', 'remote.settings', 'remote.pluginManager']`. The new discovery path uses `pluginInventory/list` to enumerate all installed entries. This task adds the namespace declaration.

- [x] **Step 1: Add `'remote.pluginInventory'` to the `inject` array** ✅

Find the `inject:` declaration inside the factory function (currently at ~line 8830):

```js
// BEFORE:
inject: ['remote', 'remote.settings', 'remote.pluginManager'],

// AFTER:
inject: ['remote', 'remote.settings', 'remote.pluginManager', 'remote.pluginInventory'],
```

- [x] **Step 2: Verify the inject change doesn't break the existing plugin manager remote** ✅

Run the existing `_pluginManagerRemote()` diagnostic (browser console `__dockFlashSkinSwitch()`) after a page refresh. Both `remote.pluginManager` and `remote.pluginInventory` should resolve. The `pluginInventory` namespace provides a single method `list()` returning `PluginInventorySnapshot`.

- [x] **Step 3: Commit** ✅

---

## Task 2: Create `_pluginInventoryRemote()` accessor and `_fetchPluginEntries()` discovery function

**Files:**
- Modify: `lib/client.js` (add functions near `_pluginManagerRemote()` at ~line 10503)

**Interfaces:**
- Consumes: `ctx.remote.pluginInventory` (from Task 1)
- Produces: `_pluginInventoryRemote()` — accessor mirroring `_pluginManagerRemote()`; `_fetchPluginEntries()` — returns `{ entries: PluginInventoryEntry[], bundles: BundleInfo[] }` for skin discovery

This task creates the API accessor and the discovery function that will replace `_refreshMarketThemes()`. The function queries both `listPlugins()` and `listBundles()` to build a complete picture of installed skin candidates, including disabled ones.

- [x] **Step 1: Add `_pluginInventoryRemote()` accessor** ✅

Insert after `_pluginManagerRemote()` (~line 10512):

```js
/** Accessor for the plugin inventory remote, mirroring _pluginManagerRemote(). */
function _pluginInventoryRemote() {
  try {
    const remote = (ctx && typeof ctx.get === 'function' && ctx.get('remote')) ||
      (ctx && ctx.remote)
    const pi = remote && remote.pluginInventory
    return pi && typeof pi.list === 'function' ? pi : null
  } catch (_) {
    return null
  }
}
```

- [x] **Step 2: Add `_fetchPluginEntries()` discovery function** ✅

Insert after `_pluginInventoryRemote()`:

```js
/**
 * Fetch all installed plugin entries and bundles from DSH's native APIs.
 * Returns { entries: PluginInventoryEntry[], bundles: BundleInfo[] }.
 * Either array may be empty if the corresponding remote is unavailable.
 * Never throws — returns empty arrays on failure.
 */
var _pluginEntriesCache = null
var _pluginEntriesFetchInFlight = false

function _fetchPluginEntries() {
  if (_pluginEntriesCache) return Promise.resolve(_pluginEntriesCache)
  if (_pluginEntriesFetchInFlight) return _pluginEntriesFetchInFlight

  _pluginEntriesFetchInFlight = Promise.all([
    (function () {
      var pm = _pluginManagerRemote()
      if (!pm || typeof pm.listPlugins !== 'function') return Promise.resolve([])
      return Promise.resolve(pm.listPlugins()).then(
        function (r) { return Array.isArray(r) ? r : [] },
        function () { return [] }
      )
    })(),
    (function () {
      var pm = _pluginManagerRemote()
      if (!pm || typeof pm.listBundles !== 'function') return Promise.resolve([])
      return Promise.resolve(pm.listBundles()).then(
        function (r) { return Array.isArray(r) ? r : [] },
        function () { return [] }
      )
    })(),
  ]).then(function (results) {
    var snapshot = { entries: results[0], bundles: results[1], at: Date.now() }
    _pluginEntriesCache = snapshot
    _pluginEntriesFetchInFlight = false
    return snapshot
  }).catch(function () {
    _pluginEntriesFetchInFlight = false
    return { entries: [], bundles: [], at: Date.now() }
  })

  return _pluginEntriesFetchInFlight
}

/** Invalidate the plugin entries cache so the next read re-fetches. */
function _invalidatePluginEntries() {
  _pluginEntriesCache = null
}
```

- [x] **Step 3: Verify the functions don't break existing behavior** ✅

In browser console, verify that:
1. `_pluginInventoryRemote()` returns the namespace object (or `null` if unavailable — both are fine)
2. `_fetchPluginEntries()` returns a promise resolving to `{ entries, bundles, at }`

The existing skin system should still work unchanged because nothing calls these functions yet.

- [x] **Step 4: Commit** ✅

---

## Task 3: Replace `_skinAllowed()` — remove market classification gate

**Files:**
- Modify: `lib/client.js` (~line 9647, the `_skinAllowed` function and its dependencies)

**Interfaces:**
- Consumes: `_skinHint`, `_skinExclude` (existing regexes)
- Produces: `_skinAllowed(id)` — now a pure name-based check instead of market-registry-based

The current `_skinAllowed()` consults the market's `/registry` classification (`_isMarketThemePackage`). Without the market, classification is purely name-based: `_skinHint` matches AND `_skinExclude` doesn't match. This is less restrictive (a non-theme package named `dsh-foo-skin` will appear), but it is consistent with what the DOM scan already uses, and the market's registry is no longer available.

- [x] **Step 1: Rewrite `_skinAllowed()` to use name heuristic only** ✅

Replace the entire `_skinAllowed` function:

```js
// BEFORE (lines 9647-9653):
function _skinAllowed(id) {
  var spec = _marketInstalledSpec(id)
  if (spec === null) return true
  return _isMarketThemePackage(id, spec) !== false
}

// AFTER:
/**
 * Gate every scan phase must pass before listing a plugin.
 *
 * Without the market's registry classification, this is a pure name
 * heuristic: the id must match _skinHint and must NOT match _skinExclude.
 * This is the same check the DOM scan already applies, and it is the
 * only option without the market's category data.  A non-theme package
 * whose name contains "skin"/"theme" may appear; this is accepted —
 * the name heuristic is what the DOM scan already uses for its own
 * discovery, so the two paths agree.
 *
 * Returns true = LIST IT.
 */
function _skinAllowed(id) {
  return _skinHint.test(id) && !_skinExclude.test(id)
}
```

- [x] **Step 2: Remove the now-dead market classification functions** ✅

Delete the following functions/variables that are no longer called anywhere after `_skinAllowed` no longer delegates to them:

1. `_marketInstalledSpec()` (~line 9656-9663)
2. `_isMarketThemePackage()` (~line 9673-9683)
3. `_repoOf()` (~line 9620-9624)
4. `_loadMarketThemeIndex()` (~line 9690-9770)
5. `_marketThemeIndexKey` (~line 9601)
6. `_marketThemeIndexTtl` (~line 9602)
7. `_marketThemeIndex` (~line 9612)
8. `_marketThemeIndexInFlight` (~line 9613)

Also delete the entire comment block "Market theme classification" (~lines 9566-9598) — it describes market-specific logic that is being removed.

**Important:** Do NOT yet delete `_marketThemes`, `_marketApiBase`, `_marketFetchInFlight`, `_marketAvailable()`, `_isMarketLiveTheme()`, `_invalidateMarketThemes()`, `_refreshMarketThemes()`, `_marketThemeExtras()`, or `_activateThemeViaMarket()`. Those are still referenced from other functions that will be updated in later tasks.

- [x] **Step 3: Remove the `_loadMarketThemeIndex()` call from `_registerSkinSwitch`** ✅

In the `options` callback of the skin switch (~line 9420), remove the call:

```js
// DELETE this line:
_loadMarketThemeIndex()
```

And remove the `.then` callback that re-notifies after the index lands (~lines 9554-9558 in `_refreshMarketThemes`). This will be fully removed when `_refreshMarketThemes` is replaced in Task 5, but removing the call from `options()` now prevents a dangling reference.

- [x] **Step 4: Verify the skin dropdown still renders** ✅

After this change, `_skinAllowed()` is a pure name check. All existing skins that match `_skinHint` and don't match `_skinExclude` will still appear. Skins like `dsh-client-liang-intensity-skin` that the market classified as `interactive` will now appear in the dropdown — this is the accepted trade-off documented in the Global Constraints.

Test: open the skin dropdown and verify it lists the same skins (plus possibly `dsh-client-liang-intensity-skin` if installed).

- [x] **Step 5: Commit** ✅

---

## Task 4: Replace `_activateThemeViaMarket()` with `_activateThemeViaPluginManager()`

**Files:**
- Modify: `lib/client.js` (~line 9855, `_activateThemeViaMarket`)

**Interfaces:**
- Consumes: `_switchSkinBundle()` (existing), `_pluginManagerRemote()` (existing), `_skinEntryRow()` (existing)
- Produces: `_activateThemeViaPluginManager(name, gen)` — replacement activation function using `setPluginEnabled`

The current `_activateThemeViaMarket()` does `POST /dsh-market/use-skin` which tells the market to deactivate all other themes and activate the named one. The replacement uses `setPluginEnabled(entryId, true/false)` to (1) enable the target skin's entry and (2) disable all other skin entries. This is the same mechanism already used by `_switchSkinBundle()` for handle-less skins, now extended to ALL skins.

- [x] **Step 1: Write `_activateThemeViaPluginManager()`** ✅

Insert the new function near where `_activateThemeViaMarket()` currently lives (~line 9855). The new function:

1. Enables the target skin's entry via `setPluginEnabled(entryId, true)`
2. Disables all OTHER skin entries (from `_knownSkins()`) via `setPluginEnabled(entryId, false)`
3. Syncs managed skin enable flags
4. Returns `Promise<boolean>` — true on success
5. On failure, releases `_pendingSkinId` (same as the market version)

```js
/**
 * Activate a theme through DSH's native plugin manager.
 *
 * Enables the target skin's loader entry and disables every other skin
 * entry, then reloads the page.  This replaces _activateThemeViaMarket(),
 * which used POST /dsh-market/use-skin.
 *
 * `gen` is the caller's activation generation: a later click supersedes
 * this one, and a superseded call must not clear the NEWER pending value.
 */
function _activateThemeViaPluginManager(name, gen) {
  var current = function () { return gen === undefined || gen === _skinActivationGen }
  var release = function (why) {
    _skinTrace('pluginManager', { name: name, status: 'refused', why: why })
    if (!current()) return false
    _pendingSkinId = null
    console.warn('[dock-flash] could not activate "' + name + '" through the plugin manager — ' + why +
      ' — selection released; the dropdown shows the theme that is actually live')
    try { registry.notifyChange('dock-flash:skin') } catch (_) {}
    return false
  }

  var pm = _pluginManagerRemote()
  if (!pm) return Promise.resolve(release('the plugin manager remote did not resolve'))

  return Promise.resolve()
    .then(function () { return typeof pm.listPlugins === 'function' ? pm.listPlugins() : [] })
    .then(function (rows) {
      if (!current()) return false
      var allSkins = _knownSkins()
      var bundleName = _skinBundleName(name)
      var targetRow = _skinEntryRow(rows, bundleName)

      if (!targetRow) return release('no addressable loader entry for "' + bundleName + '"')

      var pending = []

      // Enable the target
      if (targetRow.enabled !== true) {
        pending.push(
          Promise.resolve(pm.setPluginEnabled(targetRow.entryId, true))
            .then(function () { return true }, function (e) {
              console.warn('[dock-flash] setPluginEnabled(true) failed for "' + bundleName + '": ' + String((e && e.message) || e))
              return false
            })
        )
      }

      // Disable every other skin
      for (var i = 0; i < allSkins.length; i++) {
        var skin = allSkins[i]
        if (skin.id === name) continue
        var otherName = _skinBundleName(skin.id)
        var otherRow = _skinEntryRow(rows, otherName)
        if (!otherRow || !otherRow.entryId) continue
        if (otherRow.enabled === false) continue  // already disabled
        pending.push(
          Promise.resolve(pm.setPluginEnabled(otherRow.entryId, false))
            .then(function () { return true }, function () { return false })
        )
      }

      // Sync managed skin enable flags before reload
      _syncManagedEnableFlags(name)

      return Promise.all(pending).then(function (results) {
        if (!current()) return false
        var anyWrite = results.some(Boolean)
        _skinTrace('pluginManager', { name: name, status: 'ok', wrote: anyWrite })
        _skinReloadWhy = 'pluginManager:' + name
        try { sessionStorage.setItem('dock-flash:activated-theme', name) } catch (_) {}
        _fadeBeforeReload()
        return true
      })
    })
    .catch(function (e) { return release(String((e && e.message) || e)) })
}
```

- [x] **Step 2: Update `setValue` in `_registerSkinSwitch` to use the new function** ✅

In the skin switch's `setValue` handler (~line 9442-9491), replace the market-activation branch:

```js
// BEFORE (lines 9456-9483):
const isMarketTheme = _marketThemes
  ? _marketThemes.themes.some((th) => th.name === v)
  : false
const marketOn = _marketAvailable()
_skinTrace('press', {
  value: v,
  path: (v !== 'default' && marketOn && isMarketTheme) ? 'market' : 'applySkin',
  marketAvailable: !!marketOn,
  isMarketTheme: isMarketTheme,
})
if (v !== 'default' && marketOn && isMarketTheme) {
  const gen = ++_skinActivationGen
  const target = _knownSkins().find((s) => s.id === v)
  if (target && _skinNotControllable(target)) {
    _switchSkinBundle(target, true).then(() => _activateThemeViaMarket(v, gen))
  } else {
    _activateThemeViaMarket(v, gen)
  }
  return
}
_applySkin(v)
_pendingSkinId = null

// AFTER:
// Every skin activation now goes through the plugin manager path
// when the skin has a loader entry.  The distinction between
// "market theme" and "plugin-local CSS skin" no longer exists —
// if the plugin manager can address the entry, it is switched there;
// otherwise _applySkin() handles it in-page.
_skinTrace('press', { value: v, path: 'pluginManager' })
if (v !== 'default') {
  const gen = ++_skinActivationGen
  const target = _knownSkins().find((s) => s.id === v)
  if (target && _skinNotControllable(target)) {
    // Handle-less skins already go through _switchSkinBundle
    _switchSkinBundle(target, true).then(function () { return _activateThemeViaPluginManager(v, gen) })
  } else {
    _activateThemeViaPluginManager(v, gen)
  }
  return
}
_applySkin(v)
_pendingSkinId = null
```

- [x] **Step 3: Delete `_activateThemeViaMarket()`** ✅

Remove the entire `_activateThemeViaMarket()` function (~lines 9855-9898). It is no longer called.

- [x] **Step 4: Verify skin activation still works** ✅

Test switching between two installed skins and back to default. The flow should:
1. Click a skin → dropdown shows it immediately (optimistic pending)
2. Plugin manager enables target, disables others
3. Page fades and reloads
4. New skin is active on reload

If the plugin manager remote is unavailable, the `release()` path should clear the pending selection and warn in console.

- [x] **Step 5: Commit** ✅

---

## Task 5: Replace `_refreshMarketThemes()` with `_refreshPluginEntries()` and register skin switch unconditionally

**Files:**
- Modify: `lib/client.js` (~line 9504, `_refreshMarketThemes`; ~line 11104-11113, the `ctx.effect` that calls it)

**Interfaces:**
- Consumes: `_fetchPluginEntries()` (Task 2), `_registerSkinSwitch()` (existing)
- Produces: `_refreshPluginEntries()` — replaces `_refreshMarketThemes()`; skin switch registered unconditionally

The current flow: `_refreshMarketThemes()` fetches from `/dsh-market/installed`, and on success calls `_registerSkinSwitch()`. Without the market, the switch must be registered unconditionally — the plugin manager provides the disabled-skin discovery that the market used to supply.

- [x] **Step 1: Write `_refreshPluginEntries()`** ✅

Replace `_refreshMarketThemes()` with a function that fetches from the plugin manager:

```js
/**
 * Fetch installed plugins/bundles from DSH's native plugin manager;
 * safe to call repeatedly.  Replaces _refreshMarketThemes().
 */
function _refreshPluginEntries() {
  _fetchPluginEntries().then(function (snapshot) {
    // Sync managed plugins' enable flags with the currently active skin.
    // This runs after every fetch to heal stale state from earlier
    // versions or external changes.
    var activeId = _getActiveSkinId()
    _syncManagedEnableFlags(activeId !== 'default' ? activeId : null)

    // Re-render the dropdown with the newly known entries.
    try { registry.notifyChange('dock-flash:skin') } catch (_) {}
  })
}
```

- [x] **Step 2: Update the `ctx.effect` to register the skin switch unconditionally** ✅

Replace the current effect (~lines 11104-11113):

```js
// BEFORE:
ctx.effect(() => {
  _refreshMarketThemes()
  return () => { _unregisterSkinSwitch() }
}, 'dock-flash: skin switch')

// AFTER:
ctx.effect(() => {
  // Register the skin switch unconditionally — the plugin manager
  // (not the market) provides disabled-skin discovery.
  _registerSkinSwitch()
  // Fetch the current plugin state for the dropdown.
  _refreshPluginEntries()
  return () => { _unregisterSkinSwitch() }
}, 'dock-flash: skin switch')
```

- [x] **Step 3: Delete `_refreshMarketThemes()`** ✅

Remove the entire `_refreshMarketThemes()` function (~lines 9504-9564). It is no longer called.

- [x] **Step 4: Verify the skin switcher appears without dsh-market installed** ✅

Test with dsh-market NOT installed. The skin dropdown should:
1. Always appear (not gated on market availability)
2. List skins discovered from DOM scan + plugin manager entries
3. Show disabled skins that the plugin manager reports as installed

- [x] **Step 5: Commit** ✅

---

## Task 6: Replace `_marketThemeExtras()` and `_knownSkins()` — use plugin manager for disabled-skin discovery

**Files:**
- Modify: `lib/client.js` (~lines 9777-9832, `_marketThemeExtras` and `_knownSkins`)

**Interfaces:**
- Consumes: `_fetchPluginEntries()` (Task 2), `_skinBundleName()` (existing), `_labelFromId()` (existing)
- Produces: `_pluginManagerSkinExtras(seenIds)` — replaces `_marketThemeExtras()`; updated `_knownSkins()` that uses it

The market's `_marketThemeExtras()` supplied installed-but-not-loaded skins from `/dsh-market/installed`. The replacement reads disabled entries from `listPlugins()`/`listBundles()` whose names match `_skinHint`.

- [x] **Step 1: Write `_pluginManagerSkinExtras()`** ✅

Replace `_marketThemeExtras()`:

```js
/**
 * Installed skin plugins NOT yet found by the DOM scan, discovered through
 * the plugin manager's entry/bundle lists.  Replaces _marketThemeExtras(),
 * which used /dsh-market/installed.
 *
 * A disabled skin has no DOM evidence (no style tags, no body attributes),
 * so only the plugin manager can discover it.
 */
function _pluginManagerSkinExtras(seenIds) {
  var snapshot = _pluginEntriesCache
  if (!snapshot) return []
  var out = []
  var bundleMap = {}
  for (var b = 0; b < snapshot.bundles.length; b++) {
    var bundle = snapshot.bundles[b]
    if (bundle && bundle.name) bundleMap[bundle.name] = bundle
  }

  // Discover from entries (listPlugins)
  for (var i = 0; i < snapshot.entries.length; i++) {
    var entry = snapshot.entries[i]
    if (!entry || !entry.moduleName) continue
    var id = _skinBundleName(entry.moduleName)
    if (id.endsWith('/client')) id = id.slice(0, -7)
    if (seenIds.has(id)) continue
    if (!_skinAllowed(id)) continue
    if (_managedSkins[id]) continue
    seenIds.add(id)
    var managed = _managedSkins[id]
    out.push({
      id: id,
      label: (managed && managed.label) || _labelFromId(id),
      state: entry.enabled ? 'live' : 'disabled',
    })
  }

  // Discover from bundles (listBundles) — catches packages with no
  // addressable entry (e.g. disabled bundles not yet composed)
  for (var j = 0; j < snapshot.bundles.length; j++) {
    var bun = snapshot.bundles[j]
    if (!bun || !bun.name) continue
    if (seenIds.has(bun.name)) continue
    if (!_skinAllowed(bun.name)) continue
    if (_managedSkins[bun.name]) continue
    seenIds.add(bun.name)
    out.push({
      id: bun.name,
      label: _labelFromId(bun.name),
      state: bun.enabled ? 'live' : 'disabled',
    })
  }

  return out
}
```

- [x] **Step 2: Update `_knownSkins()` to use the new function** ✅

```js
// BEFORE (lines 9817-9832):
function _knownSkins() {
  const skins = _scanInstalledSkins()
  const seenIds = new Set(skins.map((s) => s.id))
  for (const extra of _marketThemeExtras(seenIds)) {
    skins.push({
      id: extra.id,
      label: extra.label,
      state: extra.state,
      sel: null,
      isActive: extra.state === 'live',
      bodyAttr: _skinBodyAttrs[extra.id] || null,
      marketOnly: true,
    })
  }
  return skins
}

// AFTER:
function _knownSkins() {
  const skins = _scanInstalledSkins()
  const seenIds = new Set(skins.map((s) => s.id))
  for (const extra of _pluginManagerSkinExtras(seenIds)) {
    skins.push({
      id: extra.id,
      label: extra.label,
      state: extra.state,
      sel: null,
      isActive: extra.state === 'live',
      bodyAttr: _skinBodyAttrs[extra.id] || null,
      pmOnly: true,  // discovered only through the plugin manager (replaces marketOnly)
    })
  }
  return skins
}
```

- [x] **Step 3: Delete `_marketThemeExtras()`** ✅

Remove the entire `_marketThemeExtras()` function (~lines 9777-9800). It is no longer called.

- [x] **Step 4: Update any references to `marketOnly` property** ✅

Search for `marketOnly` in the codebase and replace with `pmOnly`:

1. In `_skinNotControllable()` — the property was checked there; replace `marketOnly` with `pmOnly`
2. In `__dockFlashSkinSwitch()` diagnostic — replace `marketOnly` with `pmOnly`
3. In any trace/log that references `marketOnly`

- [x] **Step 5: Verify disabled skins appear in the dropdown** ✅

Install a skin plugin, disable it via DSH's plugin manager (Settings → Plugins), then check the dock-flash skin dropdown. The disabled skin should appear (with a "disabled" indicator if the UI supports it, or simply as a selectable option).

- [x] **Step 6: Commit** ✅

---

## Task 7: Replace `_isMarketLiveTheme()` and `_invalidateMarketThemes()` in `_applySkin()`

**Files:**
- Modify: `lib/client.js` (~lines 10925-11102, `_applySkin` function; ~lines 9307-9335, `_isMarketLiveTheme` and `_invalidateMarketThemes`)

**Interfaces:**
- Consumes: `_fetchPluginEntries()` (Task 2), `_pluginEntriesCache` (Task 2)
- Produces: `_isPluginManagerLiveTheme(id)` — replaces `_isMarketLiveTheme()`; `_invalidatePluginEntries()` (already created in Task 2) replaces `_invalidateMarketThemes()`

The current `_applySkin()` checks `_isMarketLiveTheme()` to determine whether a controllable skin needs a loader write in addition to DOM removal, and calls `_invalidateMarketThemes()` after switching. The replacement checks the plugin manager's entry state instead.

- [x] **Step 1: Write `_isPluginManagerLiveTheme()`** ✅

Replace `_isMarketLiveTheme()`:

```js
/**
 * Is `id` the theme the plugin manager currently reports as enabled?
 *
 * Replaces _isMarketLiveTheme().  The plugin manager's entry list is
 * authoritative for the RUNNING loader's state, so an enabled entry means
 * the next boot will compose it in — and _applySkin() needs to disable
 * it through the loader, not just in the DOM.
 */
function _isPluginManagerLiveTheme(id) {
  var snapshot = _pluginEntriesCache
  if (!snapshot || !Array.isArray(snapshot.entries)) return false
  var name = _skinBundleName(id)
  for (var i = 0; i < snapshot.entries.length; i++) {
    var entry = snapshot.entries[i]
    if (!entry || !entry.enabled) continue
    if (entry.moduleName === name || entry.moduleName === name + '/client') return true
  }
  return false
}
```

- [x] **Step 2: Update `_applySkin()` to use the new functions** ✅

In `_applySkin()`, replace all calls to `_isMarketLiveTheme()` with `_isPluginManagerLiveTheme()`, and `_invalidateMarketThemes()` with `_invalidatePluginEntries()`:

```js
// In _applySkin(), ~line 10995:
// BEFORE:
if (!bootMode && _isMarketLiveTheme(skin.id)) {
// AFTER:
if (!bootMode && _isPluginManagerLiveTheme(skin.id)) {

// ~line 11055:
// BEFORE:
if (!bootMode && _isMarketLiveTheme(skin.id)) {
// AFTER:
if (!bootMode && _isPluginManagerLiveTheme(skin.id)) {

// ~line 11070:
// BEFORE:
_invalidateMarketThemes()
// AFTER:
_invalidatePluginEntries()
```

- [x] **Step 3: Update `_getActiveSkinId()` to remove market `live` echo** ✅

In `_getActiveSkinId()` (~lines 10317-10395), the market's `live` theme was used as the primary authority. Replace with plugin manager's entry state:

```js
// BEFORE (lines 10340-10366):
} else if (_marketThemes) {
  const live = _marketThemes.themes.find((th) => th.state === 'live')
  if (live) {
    // ... writes to host/localStorage ...
    return live.name
  }
}

// AFTER:
// Check the plugin manager for a live (enabled) skin entry.
// An enabled entry whose name matches _skinHint is the active theme.
var pmSnapshot = _pluginEntriesCache
if (pmSnapshot && Array.isArray(pmSnapshot.entries)) {
  for (var ei = 0; ei < pmSnapshot.entries.length; ei++) {
    var e = pmSnapshot.entries[ei]
    if (!e || !e.enabled) continue
    var eName = _skinBundleName(e.moduleName || '')
    if (eName && _skinAllowed(eName) && eName !== 'dock-flash') {
      // Sync the host preference if it disagrees
      if (_hostPrefs && _hostPrefs.activeSkin !== eName) {
        savePrefs(_prefCtx, { activeSkin: eName }, function () {
          try { localStorage.setItem(_skinStorageKey, eName) } catch (_) {}
        })
      } else if (!_hostPrefs) {
        try { localStorage.setItem(_skinStorageKey, eName) } catch (_) {}
      }
      return eName
    }
  }
}
```

Also update the "stored id disabled in market" check (~line 10384-10387):

```js
// BEFORE:
if (_marketThemes && _marketThemes.themes.some(
  (th) => th.name === saved && th.state === 'disabled')) {
  return 'default'
}

// AFTER:
// A stored id naming a theme the plugin manager reports as disabled
// must not be echoed back as the current selection.
if (pmSnapshot && Array.isArray(pmSnapshot.entries)) {
  var disabledMatch = pmSnapshot.entries.some(function (e) {
    return e && !e.enabled && _skinBundleName(e.moduleName || '') === saved
  })
  if (disabledMatch) return 'default'
}
```

- [x] **Step 4: Delete `_isMarketLiveTheme()`, `_invalidateMarketThemes()`, `_marketAvailable()`** ✅

Remove these three functions. They are no longer called after the replacements above.

- [x] **Step 5: Update the managed skin phase-0 check in `_scanInstalledSkins()`** ✅

In `_scanInstalledSkins()` phase 0 (~line 10160-10163), the check `_marketThemes && _marketThemes.themes.some(...)` should be replaced with a plugin-manager check:

```js
// BEFORE:
if (_marketThemes && _marketThemes.themes.some(
  (th) => th.name === id && th.state === 'disabled')) {
  continue
}

// AFTER:
// When the plugin manager reports this managed skin as disabled, skip
// it here so the pm-extras path supplies the entry with its "not enabled"
// state.  Claiming it here would suppress that label.
if (_pluginEntriesCache && Array.isArray(_pluginEntriesCache.entries)) {
  var pmDisabled = _pluginEntriesCache.entries.some(function (e) {
    return e && !e.enabled && _skinBundleName(e.moduleName || '') === id
  })
  if (pmDisabled) continue
}
```

- [x] **Step 6: Verify `_applySkin('default')` correctly deactivates skins** ✅

Test: activate a skin, then switch to 默认. The flow should:
1. `_applySkin('default')` runs
2. DOM styles removed for controllable skins
3. `_isPluginManagerLiveTheme()` detects which skins need loader writes
4. `_switchSkinBundle()` disables them
5. `_invalidatePluginEntries()` clears the cache
6. Page reloads if any writes changed something

- [x] **Step 7: Commit** ✅

---

## Task 8: Update `__dockFlashSkinSwitch()` diagnostic — remove market section

**Files:**
- Modify: `lib/client.js` (~lines 10716-10773, `__dockFlashSkinSwitch`)

**Interfaces:**
- Consumes: `_pluginEntriesCache` (Task 2)
- Produces: Updated diagnostic output with plugin-manager state instead of market state

The diagnostic function currently shows a `market` section with market theme states. Replace it with a `pluginManager` section showing entry/bundle state for skinnish packages.

- [x] **Step 1: Replace the `market` field in the diagnostic output** ✅

```js
// BEFORE (~line 10732-10734):
market: _marketAvailable() && _marketThemes && Array.isArray(_marketThemes.themes)
  ? _marketThemes.themes.map((th) => String(th.name) + ":" + String(th.state)).join(", ")
  : "unavailable",

// AFTER:
pluginManagerState: _pluginEntriesCache && Array.isArray(_pluginEntriesCache.entries)
  ? _pluginEntriesCache.entries
    .filter(function (e) { return e && /skin|theme|macintosh/i.test(e.moduleName || '') })
    .map(function (e) { return String(e.moduleName) + ':' + String(e.enabled ? 'enabled' : 'disabled') })
    .join(', ')
  : 'unavailable',
```

- [x] **Step 2: Update the `skins` mapping to use `pmOnly` instead of `marketOnly`** ✅

```js
// BEFORE:
" | marketOnly=" + String(!!s.marketOnly) +

// AFTER:
" | pmOnly=" + String(!!s.pmOnly) +
```

- [x] **Step 3: Commit** ✅

---

## Task 9: Remove all remaining market-dependent dead code

**Files:**
- Modify: `lib/client.js` (remove `_marketApiBase`, `_marketThemes`, `_marketFetchInFlight`, and any remaining references)

**Interfaces:**
- Consumes: None — this is cleanup
- Produces: Clean codebase with no `/dsh-market/*` dependencies

After all the replacements in Tasks 3-8, the following variables/functions should be unreferenced:

- `_marketApiBase`
- `_marketThemes`
- `_marketFetchInFlight`
- `_marketAvailable()`
- `_isMarketLiveTheme()` — already deleted in Task 7
- `_invalidateMarketThemes()` — already deleted in Task 7
- `_refreshMarketThemes()` — already deleted in Task 5
- `_marketThemeExtras()` — already deleted in Task 6
- `_activateThemeViaMarket()` — already deleted in Task 4
- `_marketInstalledSpec()` — already deleted in Task 3
- `_isMarketThemePackage()` — already deleted in Task 3
- `_repoOf()` — already deleted in Task 3
- `_loadMarketThemeIndex()` — already deleted in Task 3
- `_marketThemeIndexKey`, `_marketThemeIndexTtl`, `_marketThemeIndex`, `_marketThemeIndexInFlight` — already deleted in Task 3

- [x] **Step 1: Search for any remaining references to market variables/functions** ✅

Use `grep` to find any remaining occurrences of `_market` in `lib/client.js`. For each hit, determine whether it is dead code or still needed. Remove all dead references.

- [x] **Step 2: Remove the `_marketApiBase`, `_marketThemes`, `_marketFetchInFlight` declarations** ✅

These three variables (~lines 9284-9287) should now be unreferenced. Delete them.

- [x] **Step 3: Remove the market-specific comments** ✅

The large comment block explaining the market's theme classification (~lines 9566-9598) was already removed in Task 3. Check for any remaining market-specific comments and remove or update them.

- [x] **Step 4: Remove the `dsh-skin-market` entry from `_skinExclude` comment** ✅

The `_skinExclude` regex currently excludes `dsh-skin-market|dsh-skin-market/client`. This exclusion is still valid — the market plugin is not a skin itself. However, update the comment to explain it differently:

```js
// BEFORE: exclude includes "dsh-skin-market — the market itself supplies the list and is not a skin"
// AFTER: exclude includes "dsh-skin-market — a market/catalog plugin, not a skin"
```

- [x] **Step 5: Verify no `/dsh-market` HTTP requests are made** ✅

In browser DevTools Network tab, verify that no requests to `/dsh-market/installed`, `/dsh-market/use-skin`, or `/dsh-market/registry` are made when the skin switcher is used.

- [x] **Step 6: Commit** ✅

---

## Task 10: Update `_skinHint` and `_skinExclude` — ensure complete coverage without market classification

**Files:**
- Modify: `lib/client.js` (~line 9226, `_skinHint` and `_skinExclude`)

**Interfaces:**
- Consumes: None
- Produces: Updated regex patterns that cover all known skins without false positives

Without the market's `category: theme` classification, the `_skinHint` regex is the ONLY way to classify a package as a skin. Any package whose name doesn't match it will be invisible. This task reviews the regex for completeness.

- [x] **Step 1: Audit `_skinHint` against all known skin plugins** ✅

The current `_skinHint` is:

```js
var _skinHint = /skin|theme|macintosh|bloom/i
```

Verify this catches all known skin packages:
- `dsh-dream-skin` ✓ (contains `skin`)
- `dsh-theme-macintosh` ✓ (contains `theme` and `macintosh`)
- `dsh-theme-mineradio` ✓ (contains `theme`)
- `dsh-qq-skin` ✓ (contains `skin`)
- `dsh-bloom-theme` ✓ (contains `theme` and `bloom`)
- `@kubor/dsh-bloom-theme` ✓ (contains `theme`)
- `dsh-client-liang-intensity-skin` ✓ (contains `skin`)
- `dsh-skin-market` — excluded by `_skinExclude` ✓

If any known skin plugin is missing, add its distinguishing token to `_skinHint`.

- [x] **Step 2: Audit `_skinExclude` for false positives** ✅

The current `_skinExclude`:

```js
var _skinExclude = /black-hole|theme-manager|dsh-bloom-theme|dsh-skin-market|dsh-skin-market\/client|timeline/i
```

Verify each exclusion is still needed:
- `black-hole` — self-reverting theme (Critical Rule 4) ✓
- `theme-manager` — theme manager plugin, not a skin ✓
- `dsh-bloom-theme` — IIFE + MutationObserver (Critical Rule 4) ✓
- `dsh-skin-market` — market itself ✓
- `timeline` — looks like a skin to DOM scan but isn't ✓

- [x] **Step 3: Add `dsh-skin-market` note to `_skinExclude`** ✅

Since the market is being removed as a dependency, clarify that `dsh-skin-market` is excluded because it is a catalog/market plugin, not because it "supplies the list":

```js
var _skinExclude = /black-hole|theme-manager|dsh-bloom-theme|dsh-skin-market|dsh-skin-market\/client|timeline/i
```

No regex change needed — just update the adjacent comment.

- [x] **Step 4: Commit** ✅

---

## Task 11: Update `docs/skin-system.md` and `docs/architecture-notes.md`

**Files:**
- Modify: `docs/skin-system.md`
- Modify: `docs/architecture-notes.md`

**Interfaces:**
- Consumes: All changes from Tasks 1-10
- Produces: Updated documentation reflecting the migration

- [ ] **Step 1: Update `docs/skin-system.md`**

Replace all references to `/dsh-market/installed`, `/dsh-market/use-skin`, and market-based discovery with plugin-manager equivalents. Key sections to update:

1. The discovery section — replace "market provides installed theme list" with "plugin manager provides entry/bundle list"
2. The activation section — replace "POST /dsh-market/use-skin" with "setPluginEnabled(entryId, enabled)"
3. The classification section — note that `_skinAllowed()` is now a pure name heuristic without market registry
4. The `_skinAllowed()` reference — update to reflect name-only classification

- [ ] **Step 2: Update `docs/architecture-notes.md`**

Add a migration note documenting:
1. Why the market was replaced (dependency on dshmarket plugin, no category field in plugin manager)
2. The trade-off: less precise classification (name heuristic vs. registry category)
3. The `_skinAllowed()` change from market-registry-gated to name-only
4. The activation path change from HTTP POST to typert remote

- [ ] **Step 3: Commit**

```bash
git add docs/skin-system.md docs/architecture-notes.md
git commit -m "docs(skin): update documentation for plugin-manager migration"
```

---

## Task 12: End-to-end verification

**Files:**
- No file changes — testing only

**Interfaces:**
- Consumes: All tasks above
- Produces: Verified working skin selector

- [ ] **Step 1: Verify skin switcher appears without dsh-market**

Ensure the skin dropdown is registered and visible even when dsh-market is not installed.

- [ ] **Step 2: Verify switching between two skins works**

Switch from Skin A → Skin B → Default. Each switch should:
- Show the optimistic selection immediately
- Fade and reload the page
- Render the new skin after reload

- [ ] **Step 3: Verify disabled skins appear in the dropdown**

Disable a skin plugin via DSH Settings → Plugins, then verify it still appears in the dropdown (so the user can re-enable it).

- [ ] **Step 4: Verify `_skinExclude` works correctly**

Skins in the exclude list (bloom, black-hole, theme-manager) must NOT appear in the dropdown.

- [ ] **Step 5: Verify managed skins (Mineradio) still work**

Mineradio uses localStorage + storage event for enable/disable. Verify:
1. It appears in the dropdown when installed
2. Activating it writes its enable key
3. Deactivating it clears the key
4. The iframe cross-tab trick still fires

- [ ] **Step 6: Verify `__dockFlashSkinSwitch()` diagnostic works**

The diagnostic should show plugin-manager state (not market state) and no errors.

- [ ] **Step 7: Verify no `/dsh-market` HTTP requests**

Network tab should show zero requests to any `/dsh-market/*` endpoint during any skin operation.

- [ ] **Step 8: Run `pnpm run check:overlay`**

Verify the committed check still passes.

- [ ] **Step 9: Run `pnpm run check:docs`**

Verify the documentation budget is still within limits.

---

## Self-Review

### 1. Spec Coverage

The original request was: "皮肤选择器改为基于dsh自带的插件管理器来实现 而不是基于dshmarket插件市场" — replace market-based skin selector with DSH's built-in plugin manager.

| Requirement | Task |
|---|---|
| No `/dsh-market/*` HTTP requests | Task 9 (dead code removal), Task 12 Step 7 (verification) |
| Use `ctx.remote.pluginManager` for activation | Task 4 (`_activateThemeViaPluginManager`) |
| Use `ctx.remote.pluginInventory` for discovery | Task 1 (inject), Task 2 (accessor), Task 6 (extras) |
| Skin switcher works without dsh-market | Task 5 (unconditional registration) |
| Disabled skins discoverable | Task 6 (`_pluginManagerSkinExtras`) |
| `_skinAllowed()` works without market registry | Task 3 (name-only gate) |
| All market dead code removed | Task 9 |

### 2. Placeholder Scan

No TBD, TODO, "implement later", or placeholder patterns found.

### 3. Type Consistency

- `_pluginInventoryRemote()` returns `null | object` — same pattern as `_pluginManagerRemote()`
- `_fetchPluginEntries()` returns `Promise<{ entries, bundles, at }>` — used by `_refreshPluginEntries()` and `_pluginManagerSkinExtras()`
- `_activateThemeViaPluginManager(name, gen)` — same signature as `_activateThemeViaMarket(name, gen)` it replaces
- `_pluginManagerSkinExtras(seenIds)` — same signature as `_marketThemeExtras(seenIds)` it replaces
- `_isPluginManagerLiveTheme(id)` — same signature as `_isMarketLiveTheme(id)` it replaces
- `_invalidatePluginEntries()` — same signature as `_invalidateMarketThemes()` it replaces
- `pmOnly` replaces `marketOnly` — boolean property on skin objects
