# dock-flash — panel ordering and visibility

Moved out of `AGENTS.md` because it is a REFERENCE rather than a rule: the editing modes, the unit
model and the preference keys are needed while working on the panel's ordering, not while writing
unrelated code — and at ~4 KB it was crowding a budget `AGENTS.md` pays on every request
(`pnpm run check:docs` reports the headroom).

`AGENTS.md` keeps the one pointer. This file keeps the shape it operates on, the two-bucket-split
trade-off, and the reason each invariant exists. The measurements behind the overlay trigger's own
layout rules stay in [architecture-notes.md](architecture-notes.md).

---

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
  **The hit area is the whole strip, not the glyph**: the button is `width: 100%` plus
  `box-sizing: border-box` inside that row, so a click anywhere along the card's bottom edge toggles
  it — the glyph stays centred, so the drawn control is unchanged and only the target grew.
  `border-box` is load-bearing: under the default content box the button's own padding is added on
  top of `100%` and the strip overflows the card. Because the strip is otherwise invisible, its
  **static and hover states carry different colours** — a muted `label-secondary` glyph that turns
  `label-primary` on an `interactive-bg-hover` tint, which is what shows the user where the widened
  target is — and `onMouseLeave` restores `S.clusterFoldBtn`'s own values instead of repeating them,
  so the two states cannot drift from the style.
  **The control is omitted whenever the body would be empty**, the same "a dead control is worse than
  a long block" rule as reordering. The case that motivates it is the cluster's master switch going
  **OFF**: every other member of `system-alerts` is gated on `_getAlertsOn()` (`alert-toast`, both
  host-alert sliders, and each companion monitor toggle), so `rest` and the child clusters filter
  away to nothing while the head itself stays — leaving a `▼` over an empty body. This does **not**
  contradict "membership never changes shape": members stay registered, in place and in the saved
  order; only the control for an empty body is not drawn, and it returns with the master switch.
  Reordering forces the cluster open and likewise omits the fold button, because the body is
  click-through there.
- **The INLINE form is the one cluster with no fold.** Every member declaring `clusterInline: true`
  (and every member a `select`) draws the cluster as a **title row with the members' dropdowns
  right-aligned on the row BELOW it** — and **no fold row**, because there is nothing to fold. The
  title comes from any member's `clusterLabel`; each dropdown names itself through its own `label`,
  which is also its tooltip. The controls get their own row on purpose: sharing the title's row
  ellipsized the values away, and a dropdown whose value cannot be read does not work. That is the
  deliberate exception to the rule above; do not "restore" the fold or re-merge the rows. The shape
  test reads ALL members, never the available ones, so the form cannot flip under the user.
  `skin-theme` is the case.
- **A destructive or non-obvious action gets a receipt, and the receipt names the tab.** `↺` and the
  `⇅` **exit** both replace the tab title with a sentence for ~1.6s. The notice holds the tab id and
  a `kind`, never a boolean, so only the pressed tab renames. Only `⇅`'s exit direction reports —
  entering already shows feedback (the arrows appear, the glyph flips), and it reads `orderEdit`
  *before* toggling to tell the two directions apart. `↺`'s tooltip is per tab because the
  disabled-plugin records live under `ext:*` alone, so the warning belongs to the Extensions tab and
  would be a false claim on Workbench.

`__dockFlashPanelOrder()` prints the order the last render resolved next to what is persisted.

> The reasoning, the two-bucket-split trade-off and the fold's history:
> [architecture-notes.md](architecture-notes.md).
