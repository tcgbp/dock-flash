# dock-flash — architecture notes

The reasoning behind decisions that AGENTS.md states as rules. Moved out of AGENTS.md
because it had grown past the workspace instruction budget, and a rules file that is
truncated is worse than no rules file: the rules stay there, the long "why" lives here.

Read this when you are about to change one of these areas and want to know what was
already tried, and why the current shape is not arbitrary. **AGENTS.md remains the
authoritative form for every rule** — if the two ever disagree, AGENTS.md wins and this
file is what needs fixing.

---

### Market → Plugin Manager migration (v1.5.x)

The skin system originally used dsh-market (`dsh-skin-market`) for two things:
(1) theme classification (`category: theme` in the market's `/dsh-market/registry`), and
(2) activation (`POST /dsh-market/use-skin`). Both have been replaced by DSH's native
plugin manager APIs (`ctx.remote.pluginManager` and `ctx.remote.pluginInventory`).

**Why.** The market was an optional plugin that dock-flash depended on for core functionality.
When it was absent, disabled skins were invisible and the skin switcher did not register.
The plugin manager is built into DSH itself, so discovery and activation work on any install.

**Trade-off: less precise classification.** The market's registry carried a `category` field
that could distinguish a theme from an interactive plugin (e.g. `dsh-client-liang-intensity-skin`
was classified as `interactive`, not `theme`). The plugin manager has no category field, so
`_skinAllowed()` is now a pure name heuristic (`_skinHint` + `_skinExclude`). A non-theme
package whose name matches `_skinHint` may appear in the dropdown; this is accepted because
the name heuristic is the same one the DOM scan already uses, and the market's registry data
is no longer available.

**What changed.**

| Before (market-based) | After (plugin-manager-based) |
|---|---|
| `_refreshMarketThemes()` → `GET /dsh-market/installed` | `_refreshPluginEntries()` → `_fetchPluginEntries()` → `listPlugins()` + `listBundles()` |
| `_marketThemeExtras(seenIds)` | `_pluginManagerSkinExtras(seenIds)` |
| `_isMarketLiveTheme(id)` | `_isPluginManagerLiveTheme(id)` |
| `_invalidateMarketThemes()` | `_invalidatePluginEntries()` |
| `_activateThemeViaMarket(name, gen)` → `POST /dsh-market/use-skin` | `_activateThemeViaPluginManager(name, gen)` → `setPluginEnabled(entryId, bool)` |
| `_skinAllowed(id)` checked market registry (`_isMarketThemePackage`) | `_skinAllowed(id)` is pure `_skinHint.test(id) && !_skinExclude.test(id)` |
| `_marketApiBase`, `_marketThemes`, `_marketFetchInFlight`, `_marketAvailable()` | Deleted — no HTTP dependency on dsh-market |
| Skin objects: `marketOnly: true` | Skin objects: `pmOnly: true` |
| `inject: ['remote', 'remote.settings', 'remote.pluginManager']` | `inject: ['remote', 'remote.settings', 'remote.pluginManager', 'remote.pluginInventory']` |
| Skin switch registered only after `_refreshMarketThemes()` succeeded | Skin switch registered unconditionally in `ctx.effect` |

The diagnostic `__dockFlashSkinSwitch()` now shows `pluginManagerState:` (enabled/disabled entries
matching `_skinHint`) instead of `market:`. The skin trace ring still records activation events,
but `press.path` is now `'pluginManager'` instead of `'market'`.

The historical sections below retain their original wording (including references to the market)
because they document the reasoning behind rules that still hold. The rules themselves — in
AGENTS.md and in the sections below — are unchanged by the migration; the mechanism changed,
not the invariants.

---

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

---

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

---

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

---

### Panel ordering: units, one key, one writer

Users can reorder the panel's groups and switches. The mode is entered from an icon in the
header of every page that has something to rearrange (`page.order`, set where the pages are
declared — the Changes page has nothing to order and deliberately has no icon), immediately
left of the collapse chevron, icon-only with the wording in tooltips. Its handler **must**
`stopPropagation()`, because that header is itself the collapse control.

Five invariants hold this together:

- **One key, one writer — and the writer is now the preference bridge.** The order lives in the
  host settings namespace (`panelOrder`), with localStorage demoted to a cache;
  `writePanelOrder()` and `clearPanelOrder()` remain its only writers and both go through
  `savePrefs()`. That function writes all three layers in one call — memory (so the panel
  updates now), localStorage (so a reload shows the right thing before the host answers) and the
  host (so the order survives a different browser, which is the entire reason it moved). Group
  keys are scope-qualified — `builtin:<group>` for the Workbench tab, `ext:<source>` for an
  Extensions group — because the two tabs name groups from different namespaces, and a
  third-party plugin may legitimately call itself `appearance`.
- **A unit, not a switch, is what moves.** `groupUnits()` splits a group into units: a plain
  switch is a unit of one keyed by its id, and switches sharing a `cluster` label are ONE unit
  keyed by `\0cluster:<label>` — the label rather than the head's id, because `visible()` can
  hide any member, and a head-keyed unit would change key the instant the head was hidden while
  another member stayed on screen, losing the saved slot.
- **Only deviations are stored.** The default order still comes from each switch's `order`
  field, so a newly installed plugin or a new built-in switch appends to its group. Stale keys
  are retained when a move writes the list back, so a group or unit that is merely hidden right
  now keeps its slot; `applyOrder` filters them out for display.
- **One function decides display order.** `displayUnits()` feeds both the normal view and edit
  mode — that is the only reason the arrows can be trusted to agree with the result. An
  untouched built-in group keeps the historical toggles-grid-then-rest look; a customized one
  renders strictly in the saved order and therefore flattens, because a strict order and a
  two-bucket split cannot both hold.
- **A cluster is drawn as one card, and its members are folded — never dropped.** The card
  (border plus tinted background) carries the head, the members hang off a left rail beneath it,
  and the same card is drawn in and out of edit mode so the block the ▲▼ moves is the block the
  user sees. The fold control is the card's **last row, centred**, its arrow pointing the way
  the click will move the content (`▼` reveals, `▲` tucks away) — keep it there rather than
  beside the head, where it read as an ornament instead of as the block's edge, and keep it
  count-free, since a number beside a triangle reads as a badge rather than as a control.
  `renderCluster()` reads the fold from `clusterIsOpen()`: the user's session toggle,
  defaulting to FOLDED — the head row alone, with the card's last row as the way back.
  Reordering forces it open and
  omits the fold button, because the body is click-through there and a dead control is worse than
  a long block. The point of the fold over a `visible` gate is that membership never changes
  shape: the panel's structure and the saved order survive a proxy being configured or removed,
  and nothing leaves the screen unless the user folds it.

`__dockFlashPanelOrder()` prints the order the last render resolved next to what is persisted.

---

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

### The overlay trigger: three reasons the button did not work

The overlay (1.3.0) shipped with a defect that made it invisible in **every** build, and a second one
that would have survived the first fix.

**1. `appendChild` was handed a React element.** `mountOverlayTrigger()` built the ⚡ glyph with
`LightningIcon(16)`, which is `h('svg', …)` — a React element *descriptor*, a plain object carrying
`$$typeof`/`type`/`props`. `el.appendChild()` requires a real `Node`, so it threw `TypeError: Failed
to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'` on the line **before**
`overlayEl = el`. The consequences chained: the button was never appended to `<body>`, so
`__dockFlashOverlay()` reported `overlayElMounted: false` *with the position correctly selected and
the anchor correctly found* — and because `applyTrigger()` runs before `ctx.inject(['slots'], …)` in
`apply()`, that throw propagated into `apply()`'s own catch, so the slots callback never ran: **no**
trigger position worked, and the trigger-position switch was never registered either. One position's
failure was able to remove the other four.

`LightningIcon()` is unchanged — it is correct everywhere React renders it (the panel's floating
title bar). The hand-built button got `LightningIconNode()`, which builds the same `svg`/`path` via
`createElementNS`. The rule worth keeping: **a React element is a child only for a React renderer.**

**2. Acquisition was attempted exactly once.** `positionOverlayTrigger()` hides the button when
`conversationViewport()` returns null, and that is right — with no session there is no corner to sit
in. But `apply()` runs during app bootstrap, so at mount time there is *never* a conversation, and
the old code then did two things nothing could undo: it left the button at its `display:none`
default, and it attached the `ResizeObserver` only `if (vp)` — that is, only if it had already found
the element. A geometry observer that was never attached fires nothing, so nothing was left to
revisit the button. It sat mounted, in the DOM, and permanently invisible until an unrelated window
resize happened to call `positionOverlayTrigger()` again.

Acquisition is now separate from geometry:

- A subtree `MutationObserver` on `document.body` re-attempts positioning **only while no anchor has
  been adopted**, so its callback is two property reads (`!overlayAnchor ||
  !overlayAnchor.isConnected`) and a stream of mutations cannot become a stream of layout reads.
  `isConnected` is the test on purpose: a new session *replaces* the scroller, and the old node
  disconnecting is invisible to a `resize` listener.
- A **bounded** retry (~1.4s, backoff) covers what layout settling does not mutate anything for: a
  conversation that is in the DOM with a zero box. A zero-size element is not an anchor, and
  `conversationViewport()` rejects it.
- The watcher is **not** disconnected once an anchor is found, for the reason above.
- `applyTrigger()` wraps `mountOverlayTrigger()` in a named, **non-fatal** catch, so a failure is
  attributed ("overlay trigger failed to mount") rather than swallowed, and cannot take down the slot
  positions that come after it.

**3. Once it appeared, clicking it did nothing.** The overlay's click handler existed only to swallow
the click that ends a drag:

```js
el.addEventListener('click', function (e) {
  if (dragMoved) { e.preventDefault(); e.stopPropagation() }
})
```

It never called `openPanel()`. `QuickTriggerIconButton` is a React button and gets its toggle from its
own `onClick`; a hand-built element has to ask for it, and this one never did. So the button mounted,
positioned itself perfectly — the probe printed `ok — element flex at 1236px,84px` — and was inert.
`handleOutsideClick` already exempts `[data-dock-flash-trigger]`, so the closing half is not racing
it, and `dragMoved` is cleared by the next `mousedown` rather than by the drag's own end, which is why
a click straight after a drag still works.

This one is worth noting for *why it was found late*: the first version of the harness asserted the
end state of the mount and the position arithmetic, both of which were correct, so it passed on a
button nobody could use. It now drives the gestures — two clicks open then close, a drag is swallowed
and moves the offset instead, a click after a drag still toggles.

**4. Every one of those fixes was labelled `1.3.0`, which is why they took several rounds to find.** A
build that cannot name itself cannot be told from the previous one: the browser was being served a
bundle older than every fix being tested, and "the fix did not work" and "the browser has the old
code" produced identical symptoms. The decisive measurement is not in the browser at all — compare
`lib/client.js`'s mtime against the DSH server's `StartTime`; when the file is newer than the server,
the served snapshot predates it. `CLIENT_VERSION` is now a single constant, it is the **first** field
`__dockFlashOverlay()` prints, and `pnpm run check:docs` fails when it disagrees with `package.json`.

Verified by evaluating the real `lib/client.js` in a V8 sandbox against a minimal DOM, with the
`slots` service deliberately never arriving: 18 checks pass on the fixed build — the button mounts
anyway, becomes visible with no window resize once a conversation appears, clears a 10px
`scrollbar-gutter` (content-right 1250 → left 1218, not 1226) and gives way to a right-hand turn rail
(1168). The same harness against the pre-fix line fails 14 of them, with exactly that `appendChild`
TypeError.

### The trigger button's size: one number, stated once

1.4.0 made the entry point's edge length a preference, and the interesting part is not the control —
it is that the number used to be written down **nine times**. `OVERLAY_SIZE = 24` was read in six
places by the positioning arithmetic, and three glyph sizes had been chosen independently (16 for the
overlay, 14 for a header slot, 16 for an input slot). Nothing tied any of them to the box that was
actually drawn.

That matters because of what those six sites DO. `positionOverlayTrigger()` measures the button: the
clamp is `contentRight - SIZE`, the scrollbar clearance is arithmetic on `contentRight`, and the
turn-rail give-way is `railLeft - SIZE - 8`. A constant that disagrees with the rendered box does not
produce a slightly-too-small button — it computes a position for a button of a different size, which
is how the entry point ends up over the rail or outside the conversation. This is the same class of
failure as the two that had already made the button invisible (the React-descriptor `appendChild`,
and positioning being attempted once before an anchor existed), and it is why the size went into a
single accessor rather than being threaded around as a parameter.

`effectiveTriggerSize()` is the only reader. `triggerIconSize()` is `round(size * 2/3)` and
`triggerRadius()` is `round(size / 4)`, chosen so that the default 24 reproduces the old 16px glyph
and 6px radius **exactly** — the derivation had to be a no-op at the historical value, or the
"cosmetic" control would have shipped a visual change nobody asked for.

**Why the ceiling depends on the position.** A slot button shares its row with DSH's own controls, so
it stops at 48px. `conversation.overlay` competes with nothing: it floats over the conversation and is
clamped into it, and its only real constraints — never cover the scrollbar, never cover the turn rail
— are already enforced by `positionOverlayTrigger()` for *any* size. So the draggable position is
allowed 64px, which is the point of offering it. This is why the host schema carries
`triggerSize: Schema.number().default(24)` with **no min/max**: the range is a client rule that moves
with the selected position, and pinning it in the schema would make a stored value un-writable the
moment the client's range changed — precisely the 1.1.0 lesson, already recorded for `activeSkin` and
`triggerPosition`.

The clamp is applied to what is **displayed and drawn**, never to what is stored: set 64 on the
overlay, switch to a slot position, and the row reads 48 while `settings.yaml` still holds 64 — switch
back and it is 64 again. `__dockFlashOverlay()` therefore reports three separate facts
(`triggerSize`, `triggerSizeStored`, `triggerSizeRange`), because a user seeing 48 after setting 64
should be able to read why rather than guess.

Two smaller decisions worth keeping:

- **The positioning reads the stored value, not `getBoundingClientRect()`.** The function runs from
  the `ResizeObserver` and from the drag loop, and right after a style write the rendered box is one
  frame stale — measuring it would clamp against the previous size. Reading the preference is the
  same number the element was just drawn with.
- **Resizing reuses the existing `<svg>` node** (`setAttribute('width'|'height', …)`) instead of
  rebuilding the button. The element carries its own `mousedown`/`click`/`mouseenter` listeners, so
  replacing its child would be an avoidable rebuild of a live element — and the click handler is
  where this button was once found to be inert.

`check:overlay` proves the coupling rather than the arithmetic in isolation: it resizes the real
bundle's button and asserts the geometry follows. At 36px the expected `left` is **1156**, not 1214 —
the rail's `Math.min` side wins — and that is exactly the property worth pinning, because it only
holds if the give-way arithmetic and the box read the same size.

#### Why the read-back needed two halves, and a test for each ordering

Writing the test for the host-backed size is what exposed the second defect, and it is a shape that
would have shipped invisibly: **`apply()` starts the `describe()` round trip at the TOP and installs
the standalone trigger at the BOTTOM.** So `loadHostPreferences()` resolves *after*
`mountStandaloneSlotTrigger()` has already captured its values — which means

- a host that answers **late** needs a `_subscribePrefs()` handler, or the value arrives after
  everything that reads it has run, and
- a host that answers **early** needs the same handler **called once at install**, because
  `_emitPrefs()` has already fired for the last listener and the subscription would never hear
  anything.

`triggerPosition` had survived this ordering by accident, because its reader is a *function* called
later; a value captured into a closure variable has no such luck. Both halves are now present for
`triggerSize` and `triggerOverlayOffset`, and section 12 of the harness drives the late case with a
`describe()` held open until the button is mounted — the only way to reach it deterministically.

The same work turned up a smaller reporting bug: `_overlayState.sizeStored` was clamped with the
**minimum** as its ceiling, so it read 24 for every stored value above the minimum and could not
answer "is my 64 being held back, or lost?" — the one question the field exists for.

### "The size only applies after I close the panel"

This was reported from use, and the honest answer is that it always applied — the panel was covering
the proof. Three things had to be untangled, and the first two were my own wrong guesses, which is
why they are recorded here.

**The stacking is deliberate.** The standalone panel is `z-index: 99998` and the overlay button
`99997`, so the panel draws over the trigger it was opened from. At the original fixed 24px nobody
could see this; the moment the size became settable it read as a delayed effect, because the only
element whose appearance changes is the one underneath.

**The obvious fix was a no-op, and measuring is what showed it.** `positionPanel()`'s overlay branch
anchors at `rect.bottom + 6` — the button's *bottom* edge — so the panel never overlapped the button
in the first place. Rewriting the clearance as "the button's own height" produced
`rect.bottom + rect.height + 6`, **double-counting the height** and pushing the panel a full
button-height too far down. The harness caught that immediately (panel top 218 where 154 was
expected), which is the entire argument for asserting geometry instead of eyeballing it. The change
was reverted to the original arithmetic with a comment recording why it is already correct.

**What actually fixes it** is `raiseOverlayAbovePanel()`: the button is lifted to `z-index: 99999`
for exactly as long as the panel it owns is open, and lowered to `99997` on close. That keeps the
panel's relationship to its anchor untouched, keeps the button out of the panel's way the rest of the
time (a permanently-raised button would sit over the panel's own header), and makes the one control
that must be watchable while the panel is up actually watchable. It is called *after* the panel's
`display` is set, and `applyTriggerSize()` already re-runs `positionPanel()` while open so a live
resize carries the panel with the button.

Only the overlay needs the lift: a slot button lives in DSH's own layout and this panel never covers
it.

#### The same report had a second cause, in the four slot positions

The lift above fixed the overlay only. The other four positions were broken for an unrelated reason —
and it is the more instructive of the two, because the code read as correct and its own comment
claimed the mechanism was in place.

`QuickTriggerIconButton` computes its size during render, so it needs a re-render when the size
changes. It subscribed to `_subscribePrefs`, which fires when the HOST answers or when a migration
lands — while the comment above the switch said "the slot button repaints when the registry version
bumps". **It did not subscribe to the registry at all.** Those are two different events: the slider's
`setValue` calls `registry.notifyChange`, the panel listens for that, and the button did not. The
result was precisely the reported asymmetry — the overlay (imperative, same closure) resized at once,
while the four slot positions kept their old size until something unrelated repainted them.

Both subscriptions are present now, and neither implies the other: the registry covers a slider move,
`_subscribePrefs` covers a host value arriving late.

**The harness could not have caught this, and that mattered more than the bug.** Its React stub was
`useEffect: () => {}` — a no-op — so nothing a component registered inside an effect was observable,
and no assertion over rendered output would ever have noticed a missing subscription. The stub now runs
effects, keeps their cleanups (so a re-render genuinely re-subscribes instead of stacking), and routes
a state-setter call back to the test; the assertion fires the registry event and requires the slot
button to have ASKED to re-render.

That last word is load-bearing. The first version of this test re-rendered the component by hand and
**passed on a build with the subscription deleted** — measured, by pointing `DOCK_FLASH_BUNDLE` at a
patched copy. A test that supplies the very mechanism it is meant to be checking proves nothing, so the
assertion was rewritten to depend on the component's own subscription; the negative control now fails
that one check and nothing else.

The same test surfaced a third defect in passing: `setValue` stored the value clamped to the **current
position's** ceiling, so nudging the slider at a slot position permanently destroyed a larger value the
overlay was entitled to (set 64 on the overlay, switch to a slot, touch the slider, and the 64 was
gone). The store is bounded by the absolute ceiling alone; the per-position clamp belongs to
`getValue()`, which is what draws and displays.

---

### The skin list offered the market as a skin

> **Note (v1.5.x):** The market plugin (`dsh-skin-market`) is still excluded by `_skinExclude`, but the
> reason has shifted: it was originally excluded because it "supplies the list and is not a skin", and is
> now excluded because it is "a market/catalog plugin, not a skin". The exclusion itself is unchanged.

`dsh-skin-market` is the plugin that SUPPLIES the installed-skin list, and for a while it was also
offered as an entry IN it — labelled **"Market"**, and disabled, so picking it did nothing. The
mechanism is worth recording because the filter that let it through is load-bearing and must not be
narrowed.

`_isThemeName()` is `_skinHint.test(name) && !_skinExclude.test(name)`. `_skinHint` contains a bare
`skin` token, which is what makes every `<name>-skin` package discoverable — it is the token doing
the most work in that regex. `dsh-skin-market` matches it, so the market qualified as a theme. The
label then came from `_labelFromId()`, which strips a `dsh-` prefix and a trailing `-skin`:
`dsh-skin-market` → **`Market`**. That transformation is correct for its real job (it turns
`dsh-theme-mineradio` into something readable) and is exactly what made the bug hard to place: the
entry looked like a deliberately-named third skin rather than the market wearing a derived label.

**The fix is by NAME, not by narrowing `skin`.** Adding the market to `_skinExclude` — the existing
mechanism, already consulted by all five scan phases and by `_isThemeName()` — removes it from every
path at once, while touching the `skin` token would risk every real skin package. The `timeline`
entry set this precedent for the same reason.

Both `dsh-skin-market` and its `/client` form are listed, because the DOM scan canonicalises some
ids and not others, and an exclusion that only covers one spelling is the kind of half-measure that
looks fixed until a specific scan phase reaches it.

#### Two harness gaps this exposed, both of the silent kind

Neither is in the plugin — both are in `check:overlay` — but the second is the same failure SHAPE
the codebase warns about elsewhere, so it belongs here.

- **The sandbox had no `URL`.** The bundle builds every request URL with
  `new URL(path, document.baseURI)` **inside a try/catch**, because a request must never break
  `apply()`. A sandbox missing `URL` therefore does not error: the throw is swallowed and the request
  is never made, so the market never answered and the skin switch never registered.
- **`document.baseURI` was missing too**, which fails identically and for the same reason. Both are
  now provided, as the browser provides them.

The lesson generalises past this plugin: **a deliberately non-fatal try/catch around a request makes a
missing sandbox global indistinguishable from a server that said no.** Assert the request happened, not
just its absence of errors.

### The skin list now follows the market's classification, not a name guess

> **Note (v1.5.x):** The market classification gate described below has been removed.
> `_skinAllowed()` is now a pure name heuristic (`_skinHint` + `_skinExclude`). The trade-off
> — that a non-theme package matching `_skinHint` may appear — is accepted. The historical
> reasoning below explains why the gate existed and why the name heuristic is the fallback.

`dsh-client-liang-intensity-skin` was offered as a skin, and selecting it made every LATER selection
appear not to work. Two separate defects, one root cause: dock-flash and the market disagree about
what counts as a theme.

**The market decides, and it said no.** `/dsh-market/use-skin` admits a name only from its own theme
set (`dshmarket/lib/routes.js:2060`), built by name-or-repo from the registry
(`dshmarket/lib/themes.js:49-68`). Measured on this machine, this package fails both rules: the
catalog's entry for its repository is named **`dsh-liang-skin`**, which is not the installed package
name, and the installed spec is the bare version `"0.1.6"` rather than `github:owner/repo`. So the
request was answered **400 `not an installed theme`** and nothing on the market side was activated or
deactivated. (The skin-market catalog separately classifies the package as `interactive`.)

**The market also installed it that way**, which is the corroboration that settles it: its install path
branches on the category and hot-mounts anything that is not a theme (`routes.js:4530`), and
`<profile>/.dsh-market/hot-3.yml` carries this plugin. It arrived from the Themes tab but as a
non-theme install — the two are not the same thing, and only the second one governs `use-skin`.

**Defect 1 — the list.** `_isThemeName()` is `_skinHint.test(name) && !_skinExclude.test(name)`: a
NAME heuristic, so a package the market classifies otherwise still looked like a skin. The fix is not
another name rule but delegation — `_isMarketThemePackage(name, spec)` reimplements the market's two
rules against `/dsh-market/registry`, and `_marketThemeExtras()` drops only what that call
positively rejects.

Two details of that gate are load-bearing:

- **Applied to market-`installed` candidates only, never inside `_isThemeName()`.** A plugin skin
  found by the DOM scan has no catalog entry to classify against; subjecting it to this would hide
  every skin the market does not know about.
- **`'unknown'` PASSES.** When the index is missing (never fetched) or failed, the answer is "keep
  it". A registry we could not read tells us nothing about any package, and "nothing is a theme" would
  empty the switcher over a transient network error. The harness asserts this explicitly by running a
  bundle whose registry request always rejects.

**Defect 2 — the wedge, which is the symptom people actually reported.** `setValue()` sets
`_pendingSkinId` optimistically so the click shows immediately, and `_getActiveSkinId()` returns it
while set. Success reloads the page and rebuilds the value from the market; **failure used to clear
nothing**, so the dropdown stayed pinned to a theme that was never activated and echoed it back over
every later selection. `_activateThemeViaMarket()` now releases the selection on every failure path
(clear pending, notify, warn with the market's own wording), and a `_skinActivationGen` counter stops
a superseded request from releasing a NEWER selection. It is deliberately separate from
`_applySkinGen`: that one guards the in-page CSS path, and sharing a counter would let one mechanism
cancel the other.

Note the shape of this defect, because it is the recurring one in this codebase: a value that is
**fetched, recorded, and then never read** (as `triggerOverlayOffset` was), and a **failure path that
reports but does not restore state** (as `_activateThemeViaMarket` did). Both look correct at the
line where the work happens.

#### Why the plugin cannot simply be made to yield

The tempting fix — "keep offering it, but deactivate it when another skin is chosen" — is not
available. Measured against the installed 0.1.6:

- It boots `enabled: true` and **deletes its own** `dsh-liang-intensity-skin.enabled` key at
  startup, so writing that key does nothing.
- Its `storage` listener ignores every key except `BIND_EFFORT_KEY`.
- It re-asserts the host theme through `theme.setTheme()` on every frame update.
- `_deactivateCssSkin()` removes `style[data-plugin]` and `[data-plugin]:not(style)` nodes, but its
  presenter re-adds them.

There is no writable external switch. It belongs to the market's non-theme lifecycle, so the correct
behaviour is to stop listing it — its own toggle is where it always was.

#### The cost of delegating, and how it was bounded (historical — market classification removed in v1.5.x)

`/dsh-market/registry` was the HTTP source for the classification
(`/dsh-market/installed` carried no category field; `/dsh-skin-market/*` was 404 in this profile
because `dshmarket` is what was mounted). It was **~1.1 MB / 0.46 s and served
`cache-control: no-store`**, so the browser would not cache it. Three things kept that from being a
megabyte per page load:

- **Lazy**: started from `options()` (the first read of the skin list), never from `apply()`.
- **Per-session cache** in `sessionStorage`, 6 h TTL. `no-store` constrained HTTP caches; it did not
  stop us keeping our own copy for the tab, and `check:overlay` asserted exactly one fetch.
- **Non-blocking**: the list rendered immediately and was refined when the index landed. That left a
  brief window where a would-be-rejected entry could still be shown — accepted as the cheaper error,
  because the alternative was a switcher that is empty until a megabyte arrives.

The market registry has been removed entirely. `_skinAllowed()` is now a pure name heuristic, so
there is no network request at all — the cost is zero, but the classification is coarser.

### One filter, every phase — and a harness that could not see the phase it was testing

1.4.2 added the market-classification gate to `_marketThemeExtras()` and stopped there. It shipped,
and the user could still see `Liang Intensity` in the dropdown. The gate was correct; it was applied
to **one of five** entry paths.

The five, in `_scanInstalledSkins()`: managed skins (phase 0), `style[data-plugin]` (1a),
`style[data-skin-chrome]` (1b), known body attributes (2), and the boot manifest / graph rows (4).
1.4.2 covered none of them — it covered the market-`installed` merge that sits *beside* the scan. The
package in question injects `<style data-plugin="dsh-client-liang-intensity-skin">` from its own
`apply()` and is in the boot manifest, so phases 1a and 4 found it with only `_skinHint` in front of
them.

`_skinAllowed(id)` is now the single predicate all five call. This is Critical Rule 8's discipline
applied to a second filter: `_skinExclude` already had to be checked in every phase for exactly this
reason, and the lesson did not transfer on its own. Since the market migration, `_skinAllowed()` is
a pure name heuristic (`_skinHint.test(id) && !_skinExclude.test(id)`) — it no longer consults any
external registry. A package matching `_skinHint` passes unless explicitly excluded by `_skinExclude`.

#### The harness was the real defect

Three independent blind spots meant `check:overlay` **could not have caught this**, and the first one
is the reason a green suite was meaningless here:

- **`matches()` understood a single selector only.** The bundle's DOM scan asks for
  `'head style[data-plugin], head link[data-plugin]'`, so the stub returned **nothing** and phase 1a
  never ran in the harness at all. Every "which skins are listed" assertion was silently testing the
  market-extra path — the one path that *was* gated.
- **`dataset` was not implemented.** Once phase 1a did run, it threw immediately on
  `el.dataset.plugin` — the property the scan actually reads. A stub with only `getAttribute()` is
  not a DOM for code that uses property accessors.
- **`head style[data-plugin]` is a descendant selector**, not a tag-plus-attribute test. The leading
  `head` is satisfied by construction (the receiver IS the ancestor), so it has to be stripped;
  treating it as the element's own tag made it match nothing.

The evidence that this is fixed is not that the suite is green — it was green before, too. It is the
**negative control**: with all five `_skinAllowed` calls removed (byte-for-byte the 1.4.2 shape),
`DOCK_FLASH_BUNDLE` pointing at that copy now fails *"a package the market does NOT classify as a
theme is dropped"*, and the pair of assertions that place a real `<style data-plugin>` tag in the DOM
fails with it. Before the stub fixes, that same control passed.

Two habits generalise, and both are cheap:

- **A filter is only as wide as the narrowest place it is applied.** When a check has to hold for
  something with several entry paths into a list, put it in ONE predicate and call it from every path,
  rather than repeating it and hoping.
- **A stub that returns nothing is indistinguishable from a feature with nothing to find.** Assert
  that the harness's own scaffolding did its job — that the tag is really in the DOM, that the selector
  really matched — before trusting any assertion about the result.

### The skin list showed Mineradio on a machine that had uninstalled it

The report was blunt: *"Mineradio is in the skin list and I uninstalled it."* It was right, and the
plugin was not installed — not a dependency, not in `node_modules`. The entry came from dock-flash
having **manufactured the evidence it then accepted**.

`dsh-theme-mineradio` is the one *managed* skin: a plugin with its own `mount()`/`unmount()` lifecycle
(canvas, WebGL, particles), which therefore cannot be switched by creating or removing a `<style>` tag.
It has to be driven through its own private enable key. That part is legitimate and stays — the DSH
plugin contract exposes no way to discover a plugin's private key, its "active" attribute or its loader
id, so a curated table is the only mechanism available.

The defect was the installation test. Phase 0 accepted **four** signals, and the fourth was:

```js
// Check 4: localStorage
if (localStorage.getItem(cfg.enabledKey) !== null) { isInstalled = true }
```

`cfg.enabledKey` is `dsh.ui-mineradio.enabled` — a *preference*, and one dock-flash writes itself.
`_syncManagedEnableFlags()` runs on **every plugin-manager fetch** and, for each managed skin, compares the
stored flag against the one it wants. Mineradio is not the live theme, so it wants `false`; the key is
absent, so `current` is `null` and `String(false)` is `'false'` — they differ, so it calls
`_toggleManagedSkin(id, false)`, which **stores the key**. The loop closed on the next list build:

1. plugin manager answers → dock-flash writes `dsh.ui-mineradio.enabled = 'false'` on a machine that has never
   had Mineradio;
2. the scan reads that key back and concludes Mineradio is **installed**;
3. Mineradio is offered in the dropdown, permanently — uninstalling the plugin does not remove a
   localStorage key, and nothing else ever clears it.

Two things were wrong, and fixing only one would not have helped. The key must not be *written* for an
absent plugin, and it must not be *read* as proof of installation. The second is the load-bearing one:
on the reporting machine the key already existed, so the read guard is what makes the entry disappear.

**`_managedInstallReason()` is now the single predicate** and both callers use it — the scan (phase 0)
and the flag sync. Installation is proven by the boot manifest, the module graph, or the plugin's own
style tag, and by nothing else. This is the same discipline as `_skinAllowed` and `_skinExclude`
(Critical Rule 8): one rule, stated once, called from every path.

It also settles a case the old comment had noticed but could not express — the plugin manager's own *disable*
leaves the plugin's preference key behind, so check 4 could not tell "installed but switched off" from
"not here". Phase 0 now stands down for a theme the plugin manager reports as disabled, and `_pluginManagerSkinExtras()` supplies
it labelled `(未启用)`; that division only works once the preference stops masquerading as an install
signal.

> **The generalisable lesson: never accept, as evidence, a value you write yourself.** A check whose
> input the same code produces is not a check — it is a mirror. The tell is that the "installed" state
> was self-perpetuating and could never go back to false, which is exactly what a circular test looks
> like from the outside.

The harness could not have caught it, and that is worth recording: section 15 deliberately injects a
`<style data-plugin="dsh-theme-mineradio">` tag to exercise the phase-0 path, and that **is** a real
install signal — so the section passed both before and after the bug. The new 15b asserts both halves:
applying must not plant the key, a leftover key alone must not list the skin, and a real style tag still
must (the positive control, which is what stops the fix from becoming "delete the feature"). The
negative control — restoring check 4 and dropping the write guard — reproduces the report exactly:
`store has dsh.ui-mineradio.enabled="false"` and the dropdown showing `dsh-theme-mineradio`.

### 默认 did nothing, because a whole class of skin identifies nothing in the DOM

> **Note (v1.5.x):** The market-specific details below (`/dsh-market/toggle`, `/use-skin`) describe
> the historical path that was replaced by `_activateThemeViaPluginManager()`. The rule — use the
> **entry-level** switch (`setPluginEnabled`), not `setBundleEnabled` or install-layer edits — is
> unchanged. `_switchSkinBundle()` now uses `setPluginEnabled(entryId, enabled)` for all skins,
> not just handle-less ones.

The report was *"switching to default seems to change nothing"*, and it arrived alongside a DSH
upgrade — so the upgrade looked like the cause. It was not. The profile had been rebuilt in the same
sitting, and the installed skins had changed from `data-plugin`-style skins to two that manage
themselves:

| | how it injects | where its on/off state lives | `data-plugin` | `data-skin-chrome` |
|---|---|---|---|---|
| `dsh-dream-skin` | `<style>` tags with their own **ids** | `data-dsh-material` on `<html>` + `localStorage["dsh-dream-skin:skin"]` (+ a host-side `~/.dsh/dream-skin.json`) | no | no |
| `dsh-theme-macintosh` | `<style data-mc-root>` / `data-mc-menuskin` / `data-mc-dlgskin` | its own `data-mc-*` attributes on `<html>`, plus many classes | no | no |

Neither appears in `_skinBodyAttrs`. So the scan reached them only through the boot manifest
(phase 4), recording **no selectors and no activation attribute** — and `_deactivateCssSkin()` removes
exactly those three things (selectors, `style[data-plugin="<id>"]`, one mapped attribute). It found
nothing, every time. 默认 was structurally a no-op for them, not intermittently broken.

**Why switching TO them worked while switching away did not.** The two directions do not share a code
path. Activation has a fallback — when no selector matches, `_reactivateCssSkin()` re-imports the
module and re-runs the plugin's `apply()`, which re-asserts its styles and attributes. Deactivation
has no inverse. That asymmetry is the whole bug, and it is why "the other skins switch fine" was
evidence *for* this diagnosis rather than against it.

Two dead ends were checked before settling on the fix, and both are worth recording because each
looked like the obvious answer:

- **`removeOwnedStyles(id)`** — DSH's own "remove the styles this package owns" helper. It does not
  track ownership; it is `querySelectorAll("style[data-plugin]")` filtered by id, i.e. the *same*
  `data-plugin` limitation. No help.
- **`tearDownEntryFiber(entry)`** — real, exported, and it does run the plugin's effect cleanups
  (both skins' teardown functions do remove their `<style>` nodes). But its documented purpose is
  **code replacement**: *"so Loader refresh can import new code"*, and *"Registry deletion prevents
  Loader from treating replacement as a user disable"*. The manifest reconciler then re-imports and
  refreshes entries, so using it as a user-level off switch fights the loader.

**The first attempt, and why it was worse than the bug.** The obvious answer — and the one that
shipped for a few hours — is the market's user patch layer: `POST /dsh-market/toggle {name,
enabled:false}`. It *looks* right, because it writes `disabled: true` for the package's bundle rows,
which HMR applies in ~1s **and the loader re-applies on every boot** — a durability an in-page style
removal can never have. But that route is the market's **PLUGIN** switch, not a skin switch, and it
edits the **install layers**. One call does all three of:

1. `setPluginEnabled(name, false)` — the market's own disabled set, hot unmount or
   `setEntryDisabled`, then `writeMarketState`;
2. `disableRow(patchPath, rowId)` — a `- id: <pkg>` / `disabled: true` row appended to
   `~/.dsh/profiles/web/cordis.patch.yml`;
3. **removal of the package from `dsh.profile.bundles`** in the profile's `package.json`.

The road back does not exist. Selecting a theme goes through `/use-skin` →
`themes.ts activateTheme(name)`, which only does live-loader work: disable every other theme (hot
unmount or `setEntryDisabled(other, true)`), clear its own `disabledThemes` entry, write that set,
then `setEntryDisabled(name, false)` / hot mount. It **never clears a patch row and never restores a
bundle row.** So the moment a user picked 默认, both installed themes were uninstalled as far as the
loader was concerned, and **no UI in the product could bring them back** — *"switching to another
theme no longer works"*, which is exactly what came back. Two files then had to be repaired by hand:
the `disabled: true` rows deleted from `cordis.patch.yml`, and both packages re-added to
`dsh.profile.bundles`.

**The second attempt reached the right layer through the wrong switch.** DSH does ship a switch with the
durability the patch layer had and the symmetry it lacked — but there are TWO of them, and they are not
interchangeable:

| | keyed by | acts on | where the state lives |
|---|---|---|---|
| `setPluginEnabled(entryId, enabled)` | loader **entry** | the RUNNING loader (`reload([patchId])`) | the entry's `disabled:` row in the profile patch layer |
| `setBundleEnabled(package, enabled)` | **package** | nothing until boot | `dsh.profile.bundles` |

The entry switch is the one that satisfies both requirements at once: it changes what the user is looking
at, and `true` clears the very row `false` wrote. `setBundleEnabled()` merely edits a list DSH composes at
**boot**, so it cannot change the running page at all — it is now only the fallback for a package with no
addressable row, and it says so on the console instead of looking like a dead control.

**And a remote resolves only for a plugin that DECLARES it — twice, and the second half is the one that
bites.** There are two independent declarations, and each one was shipped alone as if it were the fix.
`dsh.client.inject` must name `@deepseek-ai/dsh-api-remotes` — the package that owns
`ctx.remote.$mount()`, and what the official `dsh-client-ui-plugin-manager` declares — but that entry
buys **load order only; it does not grant access**. Access is the plugin object's own `inject`, and a
typert namespace is **one service per namespace**: `dsh-api-gateway`'s
`remoteServiceKey(namespace)` is `` `remote.${namespace}` ``, and each namespace is registered as its own
Cordis Service (`RemoteNamespaceService extends Service`, `super(ctx, remoteServiceKey(name))`), so the
guard proxy refuses `ctx.remote.pluginManager` unless the plugin declares the literal
`"remote.pluginManager"` — exactly as `"remote.settings"` was already required for the settings
namespace. The official plugin-manager declares all three at once:
`["slots","locale","remote","remote.pluginManager","remote.pluginInventory", …]`.

So the sequence was: the first version called `ctx.get('remote')` with **no package entry** and got
`undefined` on every page; the second declared the package but only `"remote"`/`"remote.settings"`, so
`ctx.remote.pluginManager` was still refused. Either way `_pluginManagerRemote()` returned null, every
默认 press fell straight through to `_warnSkinNotControllable()`, and 默认 stayed a silent no-op that
looked exactly like the bug it was meant to cure — with no trace in any file, which is what made it so
hard to see. Section 20 asserts **both** declarations, because no assertion about call sites can catch a
switch that is unreachable.

`_skinNotControllable()` stays the ONE predicate for the handle-less shape, but its consequence is now
`_switchSkinBundle()` instead of a warning. 默认 issues it with `false`; picking a skin issues it with
`true` **before** handing over to `/use-skin`, so the plugin layer and the market's own live layer agree
instead of fighting. Two details make it safe to call from a dropdown: the state is **read first**
(`listPlugins()` / `listBundles()`), so an already-default page writes nothing and cannot reload itself in
a loop — `_applySkin()` also runs at boot, so an unconditional write there would be an endless reload; and
the writes are collected, with the reload happening only when one of them actually changed something
(`pending` → `Promise.all` → `_fadeBeforeReload()`). When neither switch is reachable,
`_warnSkinNotControllable()` still names the skin and points at the plugins page — reporting, never
dismantling. `__dockFlashSkinSwitch()` prints what the page can actually see — whether the remote is
mounted, which rows are addressable, what the bundle list says — because "the press did nothing" and "the
press wrote to a layer that only boot reads" are indistinguishable from the outside.

### The dropdown said 默认 while the theme was still painted

> **Note (v1.5.x):** The market-specific details below (`/dsh-market/installed`, `live: []`) describe
> the historical state that was replaced by `_isPluginManagerLiveTheme()` and the plugin manager's entry
> list. The rule — detect live marks and reload even when bookkeeping says "off" — is unchanged.

The third round on this feature came from a report that names the failure exactly: *"after selecting
dsh-dream-skin you cannot go back to default — because it shows default selected instead of Dream"*. The
skin was VISIBLY on, and the one control that could turn it off already displayed the value that would turn
it off, so the press could not be made.

The state, measured. `~/.dsh/dream-skin.json` had just been rewritten
(`{"dsh-dream-skin:skin":"ivory","dsh-dream-skin:builtin-last":"dark"}`, mtime inside the user's test), so
the plugin had applied a preset. The same page's `/dsh-market/installed` answered `state:"disabled"` with
*"已停用(市场开关或补丁层),重启后保持关闭"* for **both** installed themes, `bundle:false`, `hot:false`, and
`"live": []`. `~/.dsh/profiles/web/cordis.patch.yml:89-90` still carried `- id: dream-skin` /
`disabled: true`, the row the aborted market-toggle experiment had written. Every bookkeeping layer said
"off" while the styles were on screen — a mounted instance, or styles an earlier load left behind.

That combination is unrecoverable from the user's side, and the two halves are separate mechanisms:

- **`_getActiveSkinId()` believed the bookkeeping.** With `live` empty it fell through to the stored
  preference, and the rule that suppresses a stored id whose market state is `disabled` returned `default`.
  The `<select>` then rendered `default` — and a select fires no `change` event for the value it already
  shows, so the click that would have run `_applySkin('default')` could not happen. That is why the report
  reads as a *selection* bug rather than a switch bug.
- **`_applySkin('default')` had nothing to write.** `_switchSkinBundle()` reads the state first, found the
  loader row already `disabled`, returned `false`, and the collected `changed` was all-false — so by the
  deliberate rule (*"an already-satisfied press writes nothing and cannot reload in a loop"*) **no reload
  happened**. With the theme disabled in both layers there was no switch to flip, and a reload was the only
  thing left that could clear styles already in the document.

The fix keeps both rules and adds the missing observation. `_skinLiveMarks` + `_skinInEffect()` read the
plugins' own marks — `html[data-dsh-material]` and `style#dsh-dream-skin-nav-icon` /
`style[id="dsh-dream-skin:material:liquid-glass"]` for dream-skin, `style[data-mc-root]` and the
`html[data-mc-*]` family for macintosh — and are **detection only**: both plugins re-inject themselves from
their own observers, so removal is not on the table and the switch stays `_switchSkinBundle()`. What the
marks buy is honesty at both ends: `_getActiveSkinId()` now names the skin that is actually RENDERING, and
`_applySkin('default')` knows its press wrote nothing *although a skin is on screen* — the one case that
reloads anyway, because in that state the reload IS the switch.

Section 21 pins the whole sequence: a bundle whose stored preference is `default`, whose plugin manager reports no
enabled skin entry and whose loader row already reads `disabled`, with one mark present. The dropdown must report
`dsh-dream-skin`, the id must be offerable, and pressing 默认 must reload exactly once **with no plugin,
bundle or market call** — then, with the mark removed, the same press must not reload and must write
nothing. Forcing `_skinInEffect()` to `false` (the pre-fix behaviour) reproduces exactly two failures:
`the dropdown reports the skin that is RENDERING, not the stored default → default` and
`默认 still RELOADS when a marked skin is on screen and no write was possible → []`.

Two harness details are part of the lesson. The selector stub had to learn `#id`, because the marks are
id-based: an unparsed selector matches nothing, so the assertion would have passed while the mark was never
seen. And the sandbox now **records** `location.reload` instead of lacking it: the reload is scheduled in a
160 ms timer, so a missing function throws inside a *later* section's await and kills the run with
`TypeError: location.reload is not a function` at `lib/client.js:8246` — a crash that points at the bundle
and explains nothing.

### The dropdown and the activator disagreed about which skins exist

Found while fixing the above, and a defect in its own right: `options()` built its list from the DOM
scan **plus** the plugin manager's installed-but-not-loaded entries, while `_applySkin()` iterated the
scan **alone**. Any skin reachable only through the plugin manager half could therefore be selected
from the dropdown and then do nothing at all — not activated, and not switched off by 默认.
`_knownSkins()` is now the one list, read by both callers.

The harness had never noticed because it only ever exercised skins that the scan could see; section 20
adds a plugin-manager-only skin with no `data-plugin` tag and no boot entry, which is the shape that
used to fall through the gap.

> Both fixes are pinned by `check:overlay` section 20, which now has to hold **four** facts at once:
> 默认 issues **no market write at all**, it *does* call `setPluginEnabled(<entryId>, false)` — matched by
> PACKAGE, because that package's row id is `dream-skin`, not `dsh-dream-skin` — selecting a skin calls the
> same switch with `true`, and the manifest declares the remotes package the remote
> needs. Three negative controls reproduce the three real failures. Re-adding a `POST /dsh-market/toggle`
> call to the 默认 path takes section 20 red with `["dsh-repo-installed-skin:false","dsh-dream-skin:false"]`
> — the very writes that edited the install layers — and nothing else moves. Deleting the
> `_switchSkinBundle()` call sites, by contrast, returns it to the ORIGINAL report: 默认 writes nothing
> anywhere, and the row that asserts the call goes red while the market-write assertions stay green.
> Emptying `pluginState` pins the fallback — the bundle switch, plus the "restart DSH" warning instead of a
> dead control. The honest-reporting check (`...and it does NOT fall back to "you have to do it
> yourself"`) is what keeps the guard from degenerating into "never do anything".

### A loader write without a reload is a silent half-switch

Reported as *"只能从默认切一次Dream   第二次再从默认切Dream就没有效果了  需要刷新页面之后才可以"*: the first
default→Dream switch worked, and every later one did nothing until the page was refreshed by hand.

`_applySkin()`'s non-default branch called `_switchSkinBundle(target, true)` for a handle-less target
**without collecting the promise**. Every other call site pushes it into `pending` — the 默认 branch and
the deactivate-every-other-skin loop — and the tail reloads only when one of those promises reports a
real change. Dropping it left `Promise.all(pending)` resolving with nothing to report even though the
plugin manager had just written. Enabling a handle-less skin only changes what the NEXT page load
boots (`setPluginEnabled` writes the entry's `disabled` row), so the write alone is invisible: the
loader had the plugin on, this page still painted the old skin, no warning was printed anywhere, and
the theme appeared only after a manual refresh.

**Why "only once".** The two presses took different routes. The first found the theme via the
plugin manager path, so it used `_activateThemeViaPluginManager()` — which reloads on success.
The second press fell through to `_applySkin()`, and died in the dropped promise. From outside
the page the two are indistinguishable — which is the reason the trace exists.

The datum that pinned it: `~/.dsh/profiles/web/package.json` was rewritten with no plugin-manager
log line at that time, meaning the write came from the in-page plugin-manager switch — a write
that changed the loader and nothing else.

Fix: `pending.push(_switchSkinBundle(target, true))` in the non-default branch, so a handle-less
activation that really changed something reloads exactly like the 默认 branch. `_switchSkinBundle()`
returns `false` when the entry row already matches the wanted state, so an already-enabled skin
resolves without a write and without a reload — the guard that keeps this safe even though
`_applySkin()` also runs at boot (an unconditional reload there would be an endless reload loop).

> `check:overlay` section 22 pins it: a skin that exists only as a `__DSH_BOOT__` entry (handle-less,
> so `_skinNotControllable()` is true) offered while the plugin manager reports it as installed, then a press of
> that skin. Seven checks: it is selectable, it writes `dream-skin:true`, it never touches any market API, it
> **reloads**, the trace records `press.path = pluginManager` + `bundle.wrote = true` + a `reload` event, that
> trace **survives the reload** (it is in `sessionStorage`), and an already-enabled entry reloads nothing.
> Restoring the dropped promise (the negative control) turns exactly three of them red — `...and RELOADS`
> with `[]`, the trace check with `wrote: true` and no `reload` event, and the persistence check — which is
> the reported symptom in one line.

### `__dockFlashSkinTrace()`: naming the route, the write, and the reload

A skin press that does nothing leaves no trace in any file, and the two possible causes have opposite
fixes: either no write happened (no lever, the remote did not resolve, the market refused) or a write
happened and nothing reloaded. The second is invisible by construction, because the reload is the only
thing that would have shown it. So every decision on the way is appended to a 40-entry ring:

| event | when | fields |
|---|---|---|
| `boot` | module load, before anything else | `version`, `page` |
| `switch` | `_registerSkinSwitch()` first registers the dropdown | `id` |
| `press` | the dropdown's `setValue` | `value`, `path` (`pluginManager` \| `applySkin`) |
| `bundle` | each `_switchSkinBundle()` attempt | `name`, `want`, `wrote`, plus `why` / `error` when no lever was available |
| `pluginManager` | `_activateThemeViaPluginManager()`'s result | `name`, `status` (`ok` \| `refused`), `why` |
| `reload` | every `_fadeBeforeReload()` | `why` — `pluginManager:<name>` or `applySkin:<id>` |
| `render` | 2.5s after load | `inEffect` (the marked skins on screen), `stored` (`_getActiveSkinId()`) |

`window.__dockFlashSkinTrace()` in the console; `window.__dockFlashSkinSwitch()` remains the
point-in-time snapshot of services and rows.

**The ring lives in `sessionStorage`, and that is not an optimisation.** Every event it records is a
step towards a page reload, so a memory-only ring is wiped by the very event it exists to explain —
the first report of this bug came back with `__dockFlashSkinTrace()` printing `[]` after the user had
pressed 默认 → Dream → 默认 → Dream, which is exactly as consistent with "every press reloaded" as
with "no press ever reached `setValue`". An empty trace therefore has to be impossible to confuse with
a broken one; `boot`/`switch` are written before any user action for that reason, and a **bare `[]` is
now itself evidence that the bundle is stale**, not that nothing happened. The two closing questions
the ring answers: did a `reload` follow the press at all, and — if it did — was the marked skin still
`inEffect` on the other side (`render`).



The standalone button and its panel carried `z-index: 99997` to `99999` since they were written. Nothing
chose those numbers; they are "high enough that nothing will beat it", which is a different claim from
"the right level", and it stopped being true the moment the panel had to coexist with host UI.

**The bands, measured.** Everything that matters here is a direct child of `<body>`, so the values
compare directly and no stacking-context reasoning is required:

- **1000 — DSH's modal.** `._root_w1urq_2` is `position:fixed; inset:0; z-index:1000` and is mounted
  through `createPortal(…, document.body)`, carrying the mask (`._mask_w1urq_14`, `position:absolute;
  inset:0`, and **no z-index of its own**) and the dialog (`._dialog_w1urq_22`, `z-index:1`). The root
  holds the 1000 and the mask spans it, so "the mask is at 1000" is the correct reading, and the mask
  itself needs no z-index to be there.
- **1100 — the other overlays.** `._portal_1nxmc_44` (menus and portalled cards), `dsh-client-ui-chat`'s
  `.bRhRbq_panel`, and dock-base's `.dsh-wb-settings-overlay`. **dock-base is not under `@deepseek-ai`**,
  and measuring only DSH is how the first wrong preset shipped.
- **1000 — dock-base's `.dsh-wb-menu`** and DSH's own menus.

So a preset meant to sit *under* the host must be strictly below the host's LOWEST band, **1000** — which
is where the "stay out of the way" preset belongs — and it is **9**, not a value near the band: the gap below 1000 is wide, and nothing is gained by sitting in it. The default is **1150**, above all of it. The old literals were ~90x higher.

> **A correction kept on purpose.** An earlier version of this file argued that the mask was trapped
> inside the stacking context created by `._portal_1nxmc_44` (1100), so that 1100 was "the only number a
> `document.body` sibling competes with". That is true of elements inside that portal and **false for
> this modal**, which portals to `<body>` and therefore competes at 1000 like any sibling. A z-index read
> off an element means nothing until you know which stacking context it participates in, and the way to
> settle that is to **check the mount**, not to reason from the stylesheet.

The setting deliberately covers the **standalone pair only**. The workbench panel's own `z-index: 10` is
bounded on purpose (below dock-base's floating layer at 70), and raising it from a client preference would
invert dock-base's precedence — a rule this file already records under "Stacking".

**One value, three derived levels.** The button must sit above the panel or the one control whose effect is
only visible on the button (its size) appears to do nothing — the 1.4.0 defect. That release fixed it by
toggling the button's z-index on open/close; the two values are now `triggerLayer` and `triggerLayer + 1`,
derived from the single setting (`panelLayer()`, `triggerLayerOfButton()`, `layerOfMenu()`). The toggle is
gone, so there is no second piece of state to get out of step when the user changes the layer.

#### Why the low preset did nothing at all: the host value was never read

The presets were right and the arithmetic was right, and the setting still did nothing, because
**`triggerLayer` never received the value the host was storing.** It was read exactly once, at factory
init, by `_loadNumberPref` — and at that moment `_hostPrefs` is `null`, because
`loadHostPreferences()` is an async round trip started later in `apply()`. So the call fell through to
`localStorage` and then to the built-in default, and the host's authoritative copy was never read again
for the life of the page. The pair sat at 1150/1151 — **above** the 1000 modal — which is precisely the
reported symptom: a mask at 1000 failing to cover a panel the user believed was set below it.

The user's own `settings.yaml` proved it in one line: the low value on disk, while the icon floated
over the mask on screen. Right in the file, wrong on the glass.

`adoptHostOffset()` and `adoptHostSize()` already existed, and each carries a comment describing this exact
two-ordering trap — offset and size were both fixed this way in earlier releases. **The handler was simply
never written for the two settings added in 1.5.0**, and nothing failed loudly, because "the value is
ignored" looks identical to "the value is the default". The fix is `adoptHostLayer()` and
`adoptHostOpacity()`, each subscribed to `_subscribePrefs` (covers a host that answers LATE) and called
once (covers one that answered EARLY).

The harness assertion that was missing is the one that now catches it: the "host answers early" fixture
supplies the low preset and asserts the probe reports `resolved: 9` and the button `10`. Deleting
`adoptHostLayer()` fails it with `resolved: null` — the negative control, and the exact shape of the bug.

#### What the migration is allowed to overwrite

`_migrateLocalToHost()` adopts a `localStorage` value over the host's. That is right for a value the
**user** chose in this browser and the host has not heard about yet, and wrong in two distinct ways:

- **A value from a removed preset list.** 1.5.1 replaced the low preset 1050 with 900; a browser still
  holding 1050 wrote it straight back. A value absent from the current presets cannot have come from the
  current menu, so it is stale by construction and yields to the host.
- **A host value the user deliberately chose.** The migration fires whenever the two disagree, which let a
  stale cache overwrite an authoritative host value. It is now gated on the host still sitting at its
  **default** — the one state that genuinely means "never configured". A host value that is not the
  default is a decision, and a cache does not get to reverse it.

Both guards are asserted in both directions, because each is one operator away from being a blanket
refusal that breaks the migration it exists to protect: `1150+1050 → no write`,
`1150+2000 → writes 2000`, `9+2000 → no write`.

#### The same change broke the whole preference load, and the harness caught it

Adding the preset comparison to `_migrateLocalToHost` made it reference `LAYER_PRESETS`,
`OPACITY_PRESETS`, `_layerStoreKey` and `_opacityStoreKey` — all of which were declared **inside the
standalone closure**, next to the menu that renders them, two scopes away from the migration. The
reference threw `ReferenceError`, and `_migrateLocalToHost` is called from inside
`loadHostPreferences().then(...).catch(...)`, so **the catch swallowed it**: the entire host-preference
load failed silently and every host-stored setting reverted to its default.

Nine assertions went red at once, all about host-stored size and offset — settings the change never
touched. That is the signature: *a fix that breaks an unrelated feature is usually a throw, not a
logic error*. `pnpm run check:overlay` on the unmodified tree passed, which localised it immediately.

This is the same shape as two traps already recorded in this file — `_exposeHook` and `overlayProbe`
were each declared one scope too deep, and each failed as a silently missing global. **A shared constant
belongs at the widest scope that reads it, not the nearest scope that defines it.**

#### The context menu, and the scope it keeps

Right-click on the overlay offers reset position, the current offset, the version, and the layer/opacity
presets. The scope rule is what makes it a menu rather than a second panel:

- **Panel-reachable settings stay out.** `trigger-size`, `trigger-position` and `close-on-blur` all exist in
  the panel; a second control for one setting is how two surfaces begin to disagree (Critical Rule 7). The
  `close-on-blur` case is worse than duplication — it would be a THIRD control for that value, which is the
  shape Critical Rule 5 already warns about.
- **`trigger-position` is unreachable from here by construction.** The overlay is not one of its options, so
  picking a position from the overlay's own menu makes the button vanish from under the pointer.
- **What is in it is what only this surface can answer**: the offset (visible nowhere but
  `__dockFlashOverlay()`), the version (a stale bundle and a failed fix are indistinguishable without it), and
  the layer — a property of this floating button, not of any switch.
- **It is not a registry.** A third party contributing entries would justify an extension seam; one consumer
  does not, and this codebase's rule is not to build the seam before the second caller exists.

The menu is appended to `<body>`, never to the button: that element carries `opacity` (children inherit it,
so the menu would go translucent) and a fixed box with a border radius (the menu would be clipped). It is
positioned with the same clamp shape as `positionPanel()`, because the button can be dragged into any of the
four corners and a menu anchored to it would otherwise open off-screen.

#### Two harness defects, one of which had been corrupting drag assertions all along

Writing the opacity assertions exposed both, and they are the same lesson as the `URL`/`baseURI` pair
recorded elsewhere in this file — a stub that cannot do something is indistinguishable from a feature that
does not work.

- **The panel helpers never released the mouse.** They fired `mousedown` + `click`, and `beginOverlayDrag`
  sets the shared `dragging` singleton on every mousedown while only `handleDragEnd` clears it. So
  `dragging` stayed TRUE for the rest of the run, and because that flag forces the overlay solid, the new
  opacity setting looked completely inert. The helper is now a real `tap()` (press, release, click), and
  `dragging` is mirrored into `__dockFlashOverlay()` so a stuck flag is reportable rather than inferred.
- **`El` had no `contains()`.** The outside-click handler calls `menu.contains(ev.target)`, so it threw
  partway through — and everything after the throw silently did not run, which is how a `dragging` flag stays
  set. Ancestry is what the DOM answers here (`contains` is not "is a child"), and the bundle now also
  tolerates its absence rather than aborting the rest of the handler.

The general shape, worth keeping: **a handler that throws in the middle leaves the state it was about to
clear still set**, and the symptom appears somewhere else entirely.

### The turn rail: a class test that stopped recognising DSH

`turn-rail-left` (1.0.13) moves DSH's turn navigator to the left gutter. It is gated on
`turnRailProbe()`, which finds the rail by structural signature rather than by the `eGxaPq_`
CSS-module hash — hash-based selectors break on every DSH rebuild. The signature it settled on was
`nav[class$="_frame"]` containing `div[class$="_scroller"]` and at least one `button[class*="_mark"]`.

The two `$=` (ends-with) tests were the mistake, and only in one direction. DSH builds these class
attributes by **joining** a list:

```js
const fadeClasses = [styles.scroller]
if (scrollState.canScrollUp)   fadeClasses.push(styles.fadeTop)
if (scrollState.canScrollDown) fadeClasses.push(styles.fadeBottom)
jsx('div', { ref: scrollerRef, className: fadeClasses.join(' '), … })
```

So a rail that fits carries `"eGxaPq_scroller"` and matches, while a rail long enough to scroll —
exactly when it is worth moving — carries `"eGxaPq_scroller eGxaPq_fadeBottom"` and does **not**.
`scroller` read false, `usable` went empty, `reason` became `no-usable-rail`, and `visible` went
false. That hid the `turn-rail-left` switch and stopped the overlay trigger giving way to the rail,
and it did so *progressively*: the feature worked in a short conversation and vanished in a long one,
which is why it was reported as "the feature has been lost" rather than as a bug. It also produced a
diagnosis that pointed the wrong way — the panel showed the switch as simply absent, with nothing
saying the rail had not been recognised.

Two lessons, and they pull in opposite directions, so the token has to be chosen per case:

- **`$=` is unsafe on any class attribute DSH may join.** `*=` (contains) is the resilient form.
- **`*=` is unsafe when the token is a prefix of a sibling class.** `_preview` has exactly that
  problem — `_previewPrompt` and `_previewResponse` are divs inside the preview card — so the
  stylesheet keeps `div[class$="_preview"]`; switching it to `*=` would have moved the preview's own
  text blocks to the left edge alongside the card.

Verified against the running build rather than assumed: the DSH checkout's own
`@deepseek-ai/dsh-client-ui-chat/lib/client.js` was read to confirm which classes are joined, that
the mark really is a `<button>`, that the scroller really is a `<div>`, and that `nav[…="_frame"]`
still matches only the chat nav (the other `<nav>`s carry `_crumbs`, `_nav` and `_panelList`) even
though eight DSH modules define some `frame` class. The harness's simulated rail now uses that exact
markup, including the joined fade class, so the suffix version fails three checks there.

---

### The left-placed rail: a formula that outlived the layout it described

*"The timeline moved to the left stops working — it is visible on the right, invisible after moving
it left."* The rail was present, correct and off-screen. The injected mirror was reusing **DSH 0.1.5's
own expression**, which was correct only for the slot layout of that version:

```css
/* 0.1.5 — where the switch was written */
._slot  { position: sticky; height: 0 }                        /* in flow: inset by the parent's padding */
._frame { right: calc(12px - (var(--…clearance) + 16px)) }     /* cancels that inset */

/* 0.1.7 */
._slot  { position: absolute; left: 0; right: 0; padding-inline: calc(…clearance + 16px) }
._frame { right: 12px }                                        /* plain: the slot is no longer inset */
```

An absolutely positioned child is placed against its containing block's **padding box**, which the
slot's own `padding-inline` does not inset — so DSH had to drop the compensation from its own `right`.
The mirror kept it. With `--dsh-composer-side-clearance` measured at **16px**, `calc(12px - (16px +
16px))` evaluates to **-20px**: the 28px rail spans -20px…+8px, and because every dash is drawn from
`left:0`, the dashes sat entirely outside the left edge.

**The fix mirrors DSH instead of restating it.** `_railNativeRight()` reads whatever `right` the rail
is currently authored with and reuses it as `left`, so the same code is correct on 0.1.5 (a `calc`
that cancels a real inset), on 0.1.7 (a plain `12px`), on the `[data-conversation-scroll]` variant
(same declaration) and on the next restructure. Two further mirror defects that the same restructure
introduced were fixed alongside it:

- the mark button is now `left:0; right:0` in DSH's own sheet — horizontally symmetric, needing no
  override. The old `inset:0 auto 0 0` mirror collapsed its width to zero on 0.1.7 and took the click
  target with it, so the dashes were visible but unclickable. Pinning **both** edges is a no-op on
  0.1.7 and still mirrors correctly on 0.1.5, where `width:20px` and `left:0` win over the retained
  `right:0`.
- 0.1.7 sizes the dash with `transform:scaleX()` about `transform-origin:100%`, so a mirrored dash that
  kept that origin grows the wrong way; the mirror now sets `transform-origin:0` (inert on 0.1.5, whose
  dash has no transform at all).

**The harness could not have caught it**, and that is the reusable lesson: no check had ever looked at
this stylesheet. Section 4 only asserted that `__dockFlashTurnRail()` exists. Two stub gaps made the
mirror untestable in principle — `getElementById` searched `body` only, so the bundle could not find a
`<style>` tag it had itself appended to `head`; and the sandbox exposed no `styleSheets`, so
`_railNativeRight()` always fell back to a constant. Section 19 now authors a **distinctive** offset
(`13px`, equal to no fallback in the bundle) and asserts the mirror follows it, which is what makes the
assertion about derivation rather than about a literal.

---

### The bypass list's grammar, and why each proxy rule exists

Moved here from `AGENTS.md`, which keeps the rules and points here for the detail.

**The accepted grammar** — the one `dsh-http-proxy`'s matcher actually implements, which is what the
client validator is written against:

- entries split on commas or whitespace;
- `*` means everything;
- an optional leading `.` or `*.` means "this host and every subdomain under it";
- an optional `:port` must equal the URL's port exactly.

**Rejected**, with a message naming the offending entry: a blank or whitespace-only value (the two
things it could have meant already have their own options — `all-proxy` and `all-bypass` — and an
empty list is how `all-proxy` is spelled); anything containing `/ ? # @ \`, which catches both a
pasted proxy URL (`http://…`, a dead entry here, since this switch owns the *bypass* list) and CIDR
(the matcher has no CIDR support, so `10.0.0.0/8` would sit there as a dead entry); malformed hosts;
IPv4 octets above 255; and ports outside 1-65535. Accepted values are normalized to a trimmed,
comma-joined list, and **a rejection changes neither the mode nor the stored list**.

`resolveNoProxy()` returns `undefined` for a **blank** custom value, removing `NO_PROXY` the way
`all-proxy` does rather than publishing `NO_PROXY=''`. The host enforces that blank rule itself, since
a value edited straight into `settings.yaml` never passes through the prompt.

**Why the four rules are rules.** They are the residue of four independent defects that had combined
into a silent total failure of the whole feature — each invisible because a `try/catch` or a
"returns direct" path swallowed it:

1. `require` does not exist in the ESM host half, so every `require('@deepseek-ai/dsh-http-proxy')`
   threw — `installProxyFromEnvironment` was **never called**, so changing the mode never affected
   actual traffic, only the `NO_PROXY` string.
2. The same throw in `require('@deepseek-ai/schemastery')` happened *inside* the
   `ctx.inject(['settings'], …)` callback, so `installSection` was never reached and **the
   `dock-flash` settings namespace was never registered at all**.
3. `proxyRouteFor(url)` was passed a **string** where it wants a `URL`, and it does not throw on a
   string — it just answers "direct". Strings are rejected silently; that is why the rule is
   "pass a `URL`".
4. `installProxyFromEnvironment`'s disposer was dropped, leaking one `ProxyAgent` per mode change —
   hence "keep and release the returned disposer".

The cached handle must also be **the same module instance DSH booted with**: `loadProxyModule()`
resolves DSH's own copy via `createRequire(process.argv[1])`, and a second copy answers
`DIRECT_ROUTE` forever because the policy state is module-level.

---

### User preferences live in the host, not the browser

Three preferences — the panel order, the active skin and the standalone trigger position — are
**user** preferences, not browser ones. They used to sit only in localStorage, so a second
browser, a cleared cache or another machine lost them while `proxyMode` right beside them
survived; a panel where half the settings travel and half do not is the bug, not the storage
choice. They now live in the `dock-flash` settings namespace (`panelOrder`, `activeSkin`,
`triggerPosition`) with localStorage demoted to a **cache**.

The layer that does this (`#region Preferences`) is shaped by one constraint: **every reader is
synchronous and runs on a render path** (`readPanelOrder()` is called while painting the panel),
while the host is only reachable through an async `remote.settings` call. So:

- **Reads come from memory.** `_hostPrefs` caches what the host last said; readers consult it
  first and fall back to localStorage until it has answered (and when there is no settings
  service at all — a profile without one still works, browser-local).
- **The host is consulted once, in `apply()`**, via `loadHostPreferences()`. It resolves, the
  listeners fire, and the panel re-renders with the authoritative values. Nothing blocks the
  first paint on it.
- **Writes go to all three layers in one call** — `savePrefs()` updates memory (so the UI is
  right immediately), localStorage (so a reload is right before the host answers) and the host
  (so it outlives the browser). The host write is fire-and-forget: the UI must not wait on a
  round trip, and a failure only means the value stays browser-local.
- **The host wins once it has answered.** localStorage is a cache, never the authority — that is
  the whole point of the move.

`_prefCtx` holds the plugin context for these writers, because they are called from render paths
and switch handlers that never receive `ctx`. It is null before `apply()`, which `savePrefs()`
tolerates (the write then lands in memory and localStorage only).

**The Schema types the client's values loosely on purpose.** `activeSkin` may name a skin that is
not installed on this machine and `triggerPosition` names a slot the client validates against its
own `TRIGGER_POSITIONS`; pinning either to an `enum` in the host would make a stored preference
un-writable the moment the client's lists change. Validation stays on the side that owns the
list.

Two schemastery details cost real time and are worth not rediscovering:

- **`dict`'s arguments are `(value, key)`** — value schema first, which is the opposite of how
  `dict(string(), array(string()))` reads. The wrong order does not throw at definition time; it
  throws on the first resolve, as `expected array but got <first key>`.
- **Every level of a nested object needs `.default()`.** A property whose schema resolves to
  `undefined` fails the whole resolve with `unsupported type "undefined"` — including the outer
  object. (Unrelated trap, same session: `Schema.resolve(schema, options)` takes **options** as
  its second argument, not a value; call the schema — `Schema(value)` — to validate.)

A validation failure **rejects before anything is persisted**, so a bad write cannot corrupt
`settings.yaml`; it also means a client bug that sends the wrong shape fails loudly instead of
silently storing garbage.

**The descriptor's fields are `ns` and `value` — not `namespace` and `resolved`.** 1.1.0 read
`n.namespace === 'dock-flash'` and `ns.resolved`; both were wrong, so the lookup returned
undefined for every namespace, every host value read as absent, and the loader failed down a path
that logged nothing. One wrong field name produced three separate-looking symptoms at once — no
migration log, the order not saving, the trigger position not saving — because they were one
silent miss. **The same spelling sat in the proxy sync path**, where `describe()` was consulted on
every startup and never matched, so the proxy switches never picked up the host's `proxyMode`/`testUrl`
after a refresh; local and host values agreed in the common case, which is why it survived
unnoticed. Both spellings are accepted now (`n.ns || n.namespace`, `ns.value || ns.resolved`),
and the descriptor is echoed in the failure message so a future rename arrives as data.

Two habits follow from that, and they are the general lesson rather than a note about this API:

- **Never let a load path return a bare `false`.** The first version of `loadHostPreferences()`
  did, on four different branches, and the failure was indistinguishable from "there was nothing
  to load". Every exit now records a *named* reason, logs it, and `__dockFlashPrefs()` reports the
  host's view beside localStorage's. This is Critical Rule 11's silent `require` in a new place.
- **Print the shape you did not recognise.** The failure message lists the descriptor's own keys
  and the namespaces actually seen, so the next mismatch is a copy-paste rather than a bisect.

---

**`describe()` answers `{ ok, value }`, and the namespace list is one level down: `value.namespaces`.**

Each entry is `{ ns, value, base, user, applies, revision, secrets }`, and both spellings are
accepted (`ns || namespace`, `value || resolved`). **This took three attempts, and the two wrong ones
both looked right**: reading `desc.value` as the array (it is the view object), then reading
`desc.namespaces` (one level too high). Both silently found nothing.

The authority is `@deepseek-ai/dsh-client-ui-settings`, which unpacks it as
`response.ok ? { view: response.value } : …` and then `view.namespaces.find((c) => c.ns === ns)`;
the generated `typert.remote-client.js` is the other half of that contract. 1.1.3 keeps a regression
check that runs the two old expressions against a real response and shows them returning `null`, and
the failure message prints the response keys *and* the `value` keys so a third nesting mistake would
be visible rather than inferred.

**`settings.update(ns, patch, expectedRevision)` takes three arguments, and the runtime enforces the
count** even though the wire schema marks the third optional
(`z.union([z.undefined(), z.number()])`). Calling it with two throws
`client api: settings/update expected 3 argument(s), got 2`.

The revision is a compare-and-set token: it arrives as `ns.revision` in `describe()` and **changes on
every successful write**, so it is cached in `_hostRevision`, sent on every write, and refreshed from
`response.value.revision`. A stale revision fails exactly like a missing one, which is why the refresh
is not optional. The authority for the pattern is `@deepseek-ai/dsh-client-ui-settings`:
`expectedRevision ?? pendingRevision ?? snapshot.revision`.

---

### Glyph metrics: why every icon here declares an explicit box

`AGENTS.md` states the rule ("a glyph wider than its font box"); this is the measurement behind it.

An inline element reserves roughly `font-size` of advance width for the text it contains, regardless
of what the glyph actually needs. Every glyph this panel uses exceeds that reservation, so every icon
box is declared in pixels instead of being left to font metrics.

Measured with .NET `MeasureString` at 11px (the header’s size) — the offline half of checklist item 14,
usable without a browser:

| Glyph | Segoe UI | Segoe UI Symbol | Yu Gothic UI | reserved |
|---|---|---|---|---|
| `⇅` reorder | 14.62 | 18.17 | 19.99 | ~11 |
| `◉` visibility | 13.19 | 17.90 | 19.99 | ~11 |
| `✓` done | 21.50 | 16.20 | 19.99 | ~11 |
| `↺` reset | 15.92 | 17.72 | 17.71 | ~11 |
| `▶` chevron | 13.19 | 17.90 | 19.99 | ~11 |
| `●` box on | 14.01 | 17.90 | 19.99 | ~11 |
| `○` box off | 17.90 | 17.90 | 19.99 | ~11 |

**The pixel value cannot be derived from a single font, and that is the whole point.** The stack is the
user’s, and the spread across the fonts a Windows browser may pick is about 1.4x: `⇅` is 14.6px in
Segoe UI but 20.0px in Yu Gothic UI, and `✓` runs the other way — widest in Segoe UI and Consolas at
21.5px, narrower in Segoe UI Symbol at 16.2px. So the box is sized for the WIDEST glyph of each set
that swaps (22px covers `✓` on the header buttons, 18px covers `○` on the visibility boxes), and both
states of a control get the same box. Otherwise the control resizes at the moment it is clicked and
slides its neighbour sideways under the pointer that just pressed it.

The header’s two `orderIconBtn` states were the last to get this treatment. 1.1.10 measured the header,
found `overX: 3` on the button group, and fixed the *title* (ellipsis + `minWidth: 0`) and the *chevron*
(a 14px box) while leaving the buttons themselves on font metrics — so the reported group was only
half fixed, and 1.2.0 added a third button carrying the widest glyph of the set.

An earlier guess in this file’s history put `▶`’s ink at "about 13px at a 10px font size" from the
rendered look rather than from a measurement. The number happened to be close, but the method is why
the header shipped half-fixed for two releases: `MeasureString` is one command and settles it.

### Peer ranges: why every tuple needs its own prerelease branch

`AGENTS.md` keeps the rule — "peer ranges must carry an explicit prerelease branch, one per tuple
whose prereleases must resolve" — and points here for the measurement behind it.

node-semver admits a prerelease only when some comparator in the range sits on the **same**
`major.minor.patch` tuple and itself carries a prerelease tag. A range that merely *looks* broad
therefore excludes the harness's prerelease builds silently, with no error to notice.

Measured with semver 7.8.5:

| Range | `4.0.0-rc.10` | `0.2.0-rc.1` |
|---|---|---|
| `>=4.0.1 <5` (no prerelease branch) | rejected | — |
| `>=4.0.1-0 <5.0.0-0` | **rejected** — the cordis this machine's dock-base runs on | — |
| `>=0.1.2-0 <1.0.0-0` | — | **rejected** |
| the tables' `>=4.0.1-0 <5.0.0-0 \|\| >=4.0.0-rc.1 <5.0.0-0` form | accepted | accepted |

The `>=4.0.1-0` line is the surprising one: it *carries* a prerelease tag and looks like the fix, but
the tuple is `4.0.1`, so `4.0.0-rc.10` is still out. A branch written for one tuple never covers
another, which is why the tables use `||` branches per tuple while keeping the previous branch so
nothing already accepted is lost.

**A first attempt at this very fix proved the point the hard way:** `^4.0.1 || >=4.0.0-rc.1 <5.0.0-0`
accepts `4.0.0-rc.10` and silently **drops `4.0.1-0`** — a version the old range accepted. That is why
any change here needs a probe matrix asserting **both** directions: the prerelease is accepted, AND no
version the old range accepted became rejected. A one-directional test passes on a regression.

> The upstream requirement is awesome-dsh-plugin's contributing guide. Without this shape, users on a
> prerelease harness hit `ERESOLVE` at install time — a failure that names the resolver, not the range.

---

## Common pitfalls, in full

`AGENTS.md` keeps a short index of these; the full table lives here because it had grown to
4.8 KB of war stories whose rules are stated as Critical Rules or architecture sections elsewhere.
Read this when a symptom looks familiar and you want the case that produced the rule.

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
| A glyph wider than its font box | A 2-4px overflow that survives every structural fix | **Every glyph in this panel is wider than the ~`font-size` an inline element reserves for it.** Give each a pixel `inline-flex` box, sized for the WIDEST glyph of any set that swaps, with the same box in both states. **Do not derive the number from one font** — the spread across a user’s stack is ~1.4x. Measure with .NET `MeasureString`: the offline half of checklist item 14 — the measured table is above, in this file. |
| `minWidth: 0` applied to a `flex: none` element | Looks like a shrink fix, is a no-op | `flex: none` means `flex-shrink: 0`, so the box can never shrink and `minWidth` has nothing to act on. Check the flex shorthand before adding the property; a no-op fix is worse than none, because it reads as solved |
| An emoji-capable glyph chosen for a small icon | A full-colour glyph, at a size the colour-emoji font picks, sitting beside monochrome `⇅`/`↺`/`▶` | `☑`/`☐`/`👁` are emoji-presentation code points and render through Segoe UI Emoji on Windows. Prefer plain geometric shapes from the family already in use (`●`/`○`/`◉`), which carry no emoji presentation |
| Diagnosing from the shape of the DOM tree | Fixing the wrong element confidently | The live element carries its own evidence — `__dockFlashOverflow()` prints each overflow's `text`, which is how a `⇅▶` button group was told apart from the title the tree depth suggested. Read the text before forming the hypothesis |
