# dock-flash — manual testing checklist

The per-change verification checklist. It lives here rather than in `AGENTS.md` because it is a
PROCEDURE you run while verifying, not a rule you need in mind while writing code — and at 9.7 KB
it was the single largest block in a file that is injected on every request.

**Read it before claiming any change is verified.** `AGENTS.md` keeps the one item in it that is a
rule rather than a step (layout overflow) and points here for the rest.

---


**`pnpm run check:overlay` is the one committed check**, and it replaces no item below — it proves
what is otherwise invisible. It evaluates the real `lib/client.js` in a V8 sandbox against a minimal
DOM and asserts the standalone overlay trigger's behaviour: the `slots` service **never arrives** (so
the overlay must mount without it), the conversation appears only **after** the mount (the real
bootstrap order), and the **gestures** work — two clicks open then close, the click ending a drag is
swallowed and moves the offset instead, and a click straight after a drag still toggles. Run it after
touching `applyTrigger()`, `mountOverlayTrigger()`, `positionOverlayTrigger()` or
`conversationViewport()`; point `DOCK_FLASH_BUNDLE` at another copy to confirm it still fails on a
broken one. It exists because every failure this trigger has had was invisible — a throw swallowed by
`apply()`'s catch, an absent element indistinguishable from a position that was never selected, once
a browser served a bundle older than every fix being tested, and a click handler that only swallowed
the drag's click, which left the button inert while the probe still reported `ok`. That last one is
why it asserts the gestures and not only the end state: the mount and the position arithmetic were
both already correct.

Everything else is verified by eye. Items are grouped where
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

15. **The overlay trigger** (standalone, position = Conversation top-right). Open a session first —
    with no conversation there is no anchor and the button is hidden, which is correct rather than a
    bug:
    - It appears 8px inside the conversation's top-right corner, **clear of the scrollbar**. Make the
      conversation long enough to scroll and confirm the button does not move or overlap it — that
      is the `scrollbar-gutter: stable` arithmetic, and a guessed width would fail here.
    - With DSH's turn rail on the right, the button sits left of it. Flip the **Timeline on the
      Left** switch → the rail moves to the other side and the button returns to the corner.
    - **Drag it**: the pointer becomes a grab hand, the button follows, and it stops at the
      conversation's edges — never over the scrollbar, never outside the conversation.
    - **A drag must not toggle the panel**: press, move more than a few pixels, release → the panel
      stays as it was. Then click without moving → it opens. That ±3px boundary is the whole
      difference between the two gestures.
    - **It follows the layout**: with the button dragged somewhere distinctive, open the right
      sidebar, drag the left sash, and resize the window. The button keeps its place relative to the
      conversation corner in all three (this is what the `ResizeObserver` is for; a window `resize`
      listener would miss the first two).
    - **It appears on its own, with no interaction.** Reload with the position already set, then open
      a session — the button must show up without resizing the window. Mounting happens at bootstrap,
      before any conversation exists, so this is the acquisition path (the `MutationObserver` plus the
      bounded retry); with a single positioning attempt at mount you get a mounted, in-the-DOM,
      permanently invisible button.
    - **Read `__dockFlashOverlay()` and check `clientVersion` FIRST.** It must equal `package.json`'s
      version. A browser served a stale bundle and a fix that did not work look identical in every
      other field, and did for several rounds. Then `overlayElMounted: true`, `anchorAdopted: true`,
      and a verdict starting with `ok`.
    - **The offset survives a refresh and a different browser**, and appears in `settings.yaml` as
      `triggerOverlayOffset`.


16. **Preferences survive the browser, not just the reload** — the point of the host-backed move,
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

17. **DSH-drift check: does `dock-flash` still recognise DSH's own markup?** Run this after any DSH
    upgrade, and whenever a feature that used to work "disappears" — because that is what this class
    of breakage looks like. Nothing is deleted; a selector simply stops matching.
    - `__dockFlashTurnRail()` with a **long** conversation must report `visible: true`. A short
      conversation is the wrong test: the rail's scroller is `[scroller, fadeTop?, fadeBottom?]
      .join(' ')`, so the extra classes only appear once the rail is long enough to scroll — which
      is exactly when the feature matters. `reason: "no-usable-rail"` while the rail is plainly on
      screen means a class test has gone stale, and its first consequence is that the **Timeline on
      the Left** switch is not in the panel at all.
    - Confirm every class test is `*=` and not `$=`. `$=` (ends-with) breaks the moment DSH joins a
      second class onto the attribute; `*=` (contains) breaks if the token is a prefix of a sibling
      class, which is why `div[class$="_preview"]` is the one deliberate exception.
    - Re-read the markup in DSH's own bundle rather than guessing — the class map and the JSX are
      both readable in `@deepseek-ai/dsh-client-ui-chat/lib/client.js`, which is how the
      `nav[…="_frame"]` question ("is it still unique among `<nav>`s?") gets a real answer instead
      of an assumption.
    - `pnpm run check:overlay` reproduces DSH's rail markup including the joined fade class, so it
      catches this one; it cannot catch a token that is renamed outright, which is what this item is
      for.

18. **A registered control is reachable from BOTH configuration pages, whatever its `visible()`
    answers.** This is the rule that makes a stood-down switch orderable and hideable at all, and it
    is easy to regress by moving the `visible()` filter back up into the grouping:
    - Pick a switch you know is stood down right now (no proxy configured → the proxy probe; no
      session → the turn-navigation switch). Open `⇅` **and** `◉`: the row must be listed in both,
      dimmed, with a tooltip saying its plugin is standing it down.
    - In `◉`, tick it — the choice is remembered even though the row still is not in the normal view.
      Then untick a *shown* row: it must stay listed in `⇅` too, dimmed with "hidden by you".
    - `__dockFlashPanelOrder()` is the mechanical form of the same question: a stood-down unit appears
      in `switches` (the inventory) and in `stoodDown`, and not in `drawn`; its group is absent from
      `groupsDrawn` while every other group is present. `pnpm run check:overlay` asserts exactly
      that, including that the normal view still drops a group whose every control is filtered.
    - The normal view must be **unchanged** by any of this: a stood-down or user-hidden row is
      invisible there, and no group title floats above nothing.