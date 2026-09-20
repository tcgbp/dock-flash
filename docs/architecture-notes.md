# dock-flash — architecture notes

The reasoning behind decisions that AGENTS.md states as rules. Moved out of AGENTS.md
because it had grown past the workspace instruction budget, and a rules file that is
truncated is worse than no rules file: the rules stay there, the long "why" lives here.

Read this when you are about to change one of these areas and want to know what was
already tried, and why the current shape is not arbitrary. **AGENTS.md remains the
authoritative form for every rule** — if the two ever disagree, AGENTS.md wins and this
file is what needs fixing.

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

---

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
