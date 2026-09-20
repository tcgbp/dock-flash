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
