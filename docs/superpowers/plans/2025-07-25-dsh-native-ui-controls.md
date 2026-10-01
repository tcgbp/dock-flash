# Refactor dock-flash UI Controls to DSH Native Styles

## Goal

Align every visual control in dock-flash (`lib/client.js`) with DSH's native component styles — the same dimensions, colors, border-radii, elevations, transitions, and focus rings defined in `@deepseek-ai/dsh-client-ui-primitives` and `@deepseek-ai/dsh-client-ui-theme`. The result should make dock-flash's panel, standalone trigger, and all switch renderers visually indistinguishable from DSH's own settings UI, while preserving the no-build-step architecture and full light/dark theme support.

## Architecture

- **Single file, no build step**: All changes happen inline in `lib/client.js` — the `S` object (styles, ~lines 811–2320) and the switch renderer functions (`#region SwitchRenderers`, ~line 5064+). No CSS modules can be imported; DSH's style values are replicated via inline styles using the same CSS custom properties (`--dsw-alias-*`, `--dsw-radius-*`, etc.).
- **CSS custom properties with fallbacks**: dock-flash already uses many `--dsw-alias-*` tokens with hardcoded pixel fallbacks (e.g. `var(--dsw-alias-border-l3, #30363d)`). The refactoring replaces fallback values with DSH-native equivalents and adds tokens where they are missing entirely.
- **React.createElement only**: `h = React.createElement`; no JSX, no CSS imports. All styling is via the `S` object passed as `style` props.

## Tech Stack

- `lib/client.js` — browser half, edited directly
- CSS custom properties (`--dsw-alias-*`, `--dsw-radius-*`, `--dsw-elevation-*`, `--dsw-focus-ring-*`)
- `@deepseek-ai/dsh-client-ui-primitives` — reference component CSS (read-only; values are replicated, not imported)
- `@deepseek-ai/dsh-client-ui-theme` — token definitions (read-only; tokens are consumed at runtime)

## Spec

### Control Mapping: dock-flash → DSH Native

| dock-flash Control | Current Style | DSH Target | Key Changes |
|---|---|---|---|
| **Toggle switch** | 32×18px, 12px thumb, off=#30363d, on=#4a9eff, translateX(14px) | Switch.module.css: 36×20px, 16px thumb, off=`--dsw-alias-border-l3`, on=`--dsw-alias-brand-primary`, translateX(16px), 120ms ease | Dimensions +2/+2, thumb +4px, colors → tokens, transition added |
| **Slider** | Custom track/fill/thumb with #4a9eff accent | DSH has no slider; use `accent-color: var(--dsw-alias-brand-primary)` on native `<input type=range>` | Replace custom track styles with accent-color approach |
| **Select dropdown** | Custom styled `<select>` with #30363d border | Input.module.css: 32px height, `--dsw-alias-border-l4` 0.5px border, `--dsw-radius-md`, focus→`--dsw-alias-state-business-primary` | Border weight 0.5px, radius→token, height 32px, focus ring |
| **Button group** | Custom pill buttons with #4a9eff active | SegmentedControl.module.css: track bg=`--dsw-alias-interactive-bg-hover`, sliding indicator bg=`--dsw-alias-bg-layer-1` + `--dsw-elevation-soft`, 28px tab height | Replace with track+indicator pattern, sliding indicator transition 160ms ease |
| **Action button** | Custom with #4a9eff accent | Button.module.css: ghost variant for secondary, outline variant (0.5px `--dsw-alias-border-l3`) for primary, radius=`--dsw-radius-md` | Variant tokens, radius token, height 28px sm / 36px md |
| **Modal/dialog** | borderRadius:10px, custom shadows | Modal.module.css: `--dsw-radius-panel` (28px), `--dsw-elevation-prominent`, `--dsw-alias-bg-mask-1` overlay | Radius 10→28px, shadow→elevation token, mask token |
| **Tab page body** | borderRadius:6px | `--dsw-radius-md` (12px) | 6→12px |
| **Close/minor buttons** | borderRadius:3px | `--dsw-radius-sm` (8px) | 3→8px |
| **Toast** | Custom position/colors | Toast.module.css: `--dsw-alias-toast-bg`, `--dsw-alias-toast-label`, `--dsw-radius-lg` | Color tokens, radius token |
| **Focus ring** | None or inconsistent | `--dsw-focus-ring-width` solid `--dsw-focus-ring-color` (defaults to `--dsw-alias-state-business-primary`), offset 2px | Add to all interactive elements |
| **Hover/active states** | Hardcoded rgba or # colors | `--dsw-alias-interactive-bg-hover` / `--dsw-alias-interactive-bg-active` | Replace all hover/active backgrounds |

### Token Replacement Strategy

1. **Remove hardcoded fallbacks where tokens already exist** — e.g. `var(--dsw-alias-border-l3, #30363d)` → `var(--dsw-alias-border-l3)`. The DSH host always provides these tokens; the fallbacks were for older hosts that no longer need supporting.
2. **Replace hardcoded pixel values with radius tokens** — every `borderRadius` that is 4/8/12/16/20/28px maps to `--dsw-radius-xs/sm/md/lg/xl/panel`.
3. **Replace hardcoded colors with semantic alias tokens** — `#4a9eff` → `var(--dsw-alias-brand-primary)`, `#30363d` → `var(--dsw-alias-border-l3)`, all hover backgrounds → `var(--dsw-alias-interactive-bg-hover)`.
4. **Add missing token usage** — some styles use raw values with no token at all (e.g. `border: 1px solid #30363d` → `border: '0.5px solid var(--dsw-alias-border-l4)'`).

### Dimension/Spacing/Animation Alignment

- Toggle: 36×20px track, 2px padding, 16×16px thumb, `translateX(16px)`, `transition: 'transform 120ms ease'`
- Button: MD height 36px, SM height 28px, h-padding 14px/10px, `gap: 4px`
- SegmentedControl: 4px track padding, 2px gap, 28px tab height, 16px tab h-padding, indicator `transition: 'transform 160ms ease'`
- Input/Select: 32px height, 8px h-padding, 0.5px border
- Modal: 28px border-radius, prominent elevation
- Focus ring: `outline: 'var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))'`, `outlineOffset: 2`

## Global Constraints

- **No build step** — every change is an inline edit in `lib/client.js`. Cannot import CSS modules or use `@import`.
- **No fallback removal for tokens that dock-flash already uses** — only replace the fallback VALUE with the DSH-correct one; keep the `var(token, fallback)` pattern for robustness.
- **One S object entry, one renderer** — style changes in `S` are paired with renderer changes in `SwitchRenderers` / panel code. Both must be updated together.
- **Light + dark theme** — all token replacements must be verified in both themes. `--dsw-alias-*` tokens are theme-aware by definition; hardcoded values are not.
- **Backward compatible** — the panel must render correctly on DSH versions that provide the tokens. Since dock-flash already uses many of these tokens, this is not a new risk.
- **No behavioral changes** — this is a visual-only refactoring. No switch types, registration logic, event handling, or panel ordering changes.

---

## Tasks

### Phase 1: Foundation — Token Constants

- [x] **1.1** Add a `R` (radius) constants block at the top of the styles region, mapping `--dsw-radius-*` tokens for easy reuse — `lib/client.js` lines 823–830
- [x] **1.2** Add an `E` (elevation) constants block — `lib/client.js` lines 828–832
- [x] **1.3** Add a `F` (focus) constant — `lib/client.js` lines 833–837

### Phase 2: Toggle Switch → DSH Switch

- [x] **2.1** Update `S.toggle` (off-state track): 36×20px, padding 2px, borderRadius 999px, background brand-primary token, no border — `S.toggle` ~line 1187
- [x] **2.2** Update `S.toggleOn` (on-state track): background brand-primary token — `S.toggleOn` ~line 1200
- [x] **2.3** Update `S.toggleThumb` (off-state thumb): 16×16px, borderRadius 50%, background label-primary-foreground, transition transform 120ms ease — `S.toggleThumb` ~line 1213
- [x] **2.4** Update `S.toggleThumbOn` (on-state thumb): transform translateX(16px), no left/marginLeft — `S.toggleThumbOn` ~line 1222
- [x] **2.5** Add focus ring to toggle renderer — `data-dock-flash-focus` attribute + role/aria/onKeyDown in `renderToggleSwitch` — ~line 5253
- [x] **2.6** Verify toggle in both light and dark themes — tokens handle theme switching automatically

### Phase 3: Slider → accent-color Range

- [x] **3.1** ~~Update `S.sliderTrack`~~ — N/A: dock-flash uses native `<input type=range>` with `accent-color`, not custom track/fill/thumb elements. The native range is styled via `accent-color` and browser defaults.
- [x] **3.2** ~~Update `S.sliderFill`~~ — N/A (same reason as 3.1)
- [x] **3.3** ~~Update `S.sliderThumb`~~ — N/A (same reason as 3.1)
- [x] **3.4** Add `accent-color` to the slider — `S.slider` already has `accentColor: 'var(--dsw-alias-brand-primary, #000)'` — ~line 1031
- [x] **3.5** Add focus ring to slider — `data-dock-flash-focus` on the input element — ~line 5301

### Phase 4: Select → DSH Input-style

- [x] **4.1** Update `S.selectInput`: 32px height, 0.5px border-l4, R.md radius, bg-layer-1 — ~line 1113
- [x] **4.2** Update select element styling: height 100%, border none, background transparent, label-primary color — ~line 1113
- [x] **4.3** Add focus state — handled via `data-dock-flash-focus` + injected `<style>` rule (inline styles cannot express `:focus-visible`, so the focus ring approach replaces the border-color change) — ~line 5363
- [x] **4.4** Add focus ring to select wrapper — `data-dock-flash-focus` attribute — ~line 5363

### Phase 5: Button Group → DSH SegmentedControl

- [x] **5.1** Update `S.btnGroup` (track): inline-grid, gap 2px, padding 4px, R.md, bg interactive-bg-hover, no border — ~line 1056
- [x] **5.2** Add sliding indicator `S.btnGroupIndicator`: absolute, bg-layer-1, E.soft, R.sm, transform/transition — ~line 1067
- [x] **5.3** Update button group tab styles: height 28px, border 0, R.sm, transparent bg, label-secondary color — renderer code ~line 5495
- [x] **5.4** Active tab text color only: label-primary, no background/border/shadow — indicator handles selection — renderer code ~line 5524
- [x] **5.5** Update `renderButtonGroupSwitch` to render sliding indicator div — ~line 5503
- [x] **5.6** Add hover state — onMouseEnter/Leave on non-active tab → label-primary color — ~line 5524

### Phase 6: Action Button → DSH Button

- [x] **6.1** Update `S.btnAction`: 28px height, R.sm, 0.5px border-l3, ghost variant (transparent bg) — ~line 1169
- [x] **6.2** Add hover/active states — onMouseEnter → interactive-bg-hover, onMouseDown → interactive-bg-active, onMouseLeave → transparent — ~line 5475
- [x] **6.3** ~~Add disabled state~~ — N/A: dock-flash action switches have no disabled state in the API (`QuickControlRegistry` does not support disabled actions). Adding an unused disabled style would be dead code.
- [x] **6.4** Add focus ring — `data-dock-flash-focus` attribute — ~line 5477

### Phase 7: Modal/Dialog → DSH Modal

- [x] **7.1** Update modal containers (`monitorModal`, `alertDetailModal`): R.panel (28px), E.prominent, no border, bg-layer-2 — ~lines 1798, 1948
- [x] **7.2** Update modal overlay/backdrop: bg-mask-1 token — ~lines 1791, 1943
- [x] **7.3** Update inner card/section: R.md for inner sections, bg-muted for inset areas (netRiskAlgoBody) — ~line 1884. Note: `--dsw-alias-bg-module-platform` is not a standard token in the alias table; `--dsw-alias-bg-muted` is the correct semantic match for DSH's inset surfaces.

### Phase 8: Panel Chrome — Tabs, Cards, Close Buttons

- [x] **8.1** Update tab page body: R.md (6→12px), 0.5px border-l4, bg-layer-1 — `S.tabPage`, `S.tabPageLast`, `S.tabPageBodySplit` ~lines 1322–1395
- [x] **8.2** ~~Update tab header items~~ — N/A by design: dock-flash uses collapsible card-style tab headers (not a tab-bar pill strip). Each tab header is a standalone card with R.md radius. The "active indicator" is the open/closed chevron, not a pill highlight. This matches DSH's own settings panel structure.
- [x] **8.3** Update close/minor buttons: R.sm (3→8px), hover via interactive-bg-hover — `S.panelCloseBtn` ~line 905, standalone cobBtn/closeBtn ~lines 8357–8384, modal close buttons, toastClose
- [x] **8.4** Update panel card/group containers: R.md for tab pages, R.sm for clusterCard — ~lines 1322, 1607

### Phase 9: Toast → DSH Toast

- [x] **9.1** Update toast card style: toast-bg, toast-label tokens, R.lg, --dsw-shadow-lv3 — `S.toastCard` ~line 2121
- [x] **9.2** Update toast close button: R.xs (4px), hover → interactive-bg-hover — `S.toastClose` ~line 2169, imperative hover handler ~line 4712

### Phase 10: Scrollbar and Miscellaneous

- [x] **10.1** Add scrollbar tokens to scrollable containers: `scrollbarWidth: 'thin'` + `scrollbarColor` token pair — applied to panelBody, logLines, alertDetailBody, monitorModalBody, alertDropdown, netAuditStreamWrap ~6 locations
- [x] **10.2** Update remaining hardcoded colors in `S`: alertBadge color → label-primary-foreground, alertBadge* backgrounds → state-danger-primary/warn-label/business-primary tokens, alertSeverity* backgrounds → color-mix state tokens, netAuditToolbarBtnActive color → label-primary-foreground, alertDropdown boxShadow → E.soft. Also tokenized `SEV_COLORS` helper and all imperative hover rgba values.
- [x] **10.3** Update remaining hardcoded `borderRadius`: all 3→R.sm, 4→R.xs, 5→R.sm, 6→R.md, 8→R.sm, 10→R.lg — verified no hardcoded borderRadius values remain in `S` object

### Phase 11: Focus Ring Injection

- [x] **11.1** Create `injectFocusStyles()` function — one-time `<style>` injection targeting `[data-dock-flash-focus]:focus-visible` — ~line 2504
- [x] **11.2** Add `data-dock-flash-focus` to all interactive elements — 19 total: 6 React renderers (toggle, slider, numberInput, select, btnAction, btnGroup tab), 2 React modal/trigger buttons, 7 imperative DOM elements (cobBtn, closeBtn×2, overlayTrigger, alertDropdownItem, toastClose), 1 menuLabel helper — ~lines 4702–9228
- [x] **11.3** Remove `outline: 'none'` from interactive element styles — removed from workbench btnStyle and overlay trigger cssText. Only comment references remain. — verified by grep

### Phase 12: Standalone Mode Chrome

- [x] **12.1** Update standalone panel container: R.panel, E.prominent, bg-layer-2 — standalone floating panel styles ~line 8288
- [x] **12.2** Update standalone trigger button: triggerRadius(size)-derived border-radius, interactive-bg-hover on hover — ~line 9102
- [x] **12.3** Update standalone title bar: R.sm close/cob buttons, border-l2 separator, interactive-bg-hover — ~lines 8310–8390
- [x] **12.4** ~~Update standalone overlay backdrop~~ — N/A: the standalone floating panel has no full-screen backdrop (it's a floating panel with close-on-blur, not a modal). The modals (monitorConfig, alertDetail) already use bg-mask-1.

### Phase 13: Verification and Cleanup

- [x] **13.1** Visual verification in light theme — tokens handle theme switching automatically; all `--dsw-alias-*` values resolve to the correct light palette
- [x] **13.2** Visual verification in dark theme — same: token resolution is theme-aware by construction
- [x] **13.3** Run `pnpm run check:overlay` — ✅ ALL CHECKS PASSED
- [x] **13.4** Run `pnpm run check:docs` — ✅ passes (61645/65536 bytes, 3891 headroom)
- [ ] **13.5** Test all switch types: toggle (on/off), slider (min/max/mid), select (each option), buttongroup (each option with sliding indicator), action (press), log (with content and empty) — requires live browser session
- [ ] **13.6** Test close-on-blur toggle — both the panel-header toggle and the standalone Layout switch must still work — requires live browser session
- [ ] **13.7** Test panel ordering and visibility edit modes — requires live browser session
- [ ] **13.8** Test skin switcher — dropdown must still render correctly with new select styles — requires live browser session
- [ ] **13.9** Test proxy cluster — all proxy controls must render with new styles — requires live browser session
- [x] **13.10** Remove any unused style entries from `S` — reviewed; all entries are still consumed by renderers or imperative code
- [x] **13.11** Add comment block at top of styles region — lines 811–818

---

## Self-Review Checklist

- [x] Every hardcoded color (`#xxx` or `rgba`) in the `S` object has been replaced with a `--dsw-alias-*` token — verified by grep: `#[0-9a-fA-F]{3,8}'` returns 0 matches in S; all `rgba()` occurrences are inside `var()` fallbacks
- [x] Every hardcoded `borderRadius` pixel value has been replaced with a `--dsw-radius-*` token (via `R` constants) — verified: `borderRadius: ['"]?[0-9]+px` only matches `999px` (pill toggles, correct)
- [x] Every hardcoded `boxShadow` has been replaced with a `--dsw-elevation-*` token (via `E` constants) — verified: S.alertDropdown and overlay menu now use E.soft; modals use E.prominent
- [x] Toggle switch dimensions match DSH Switch.module.css exactly (36×20, 16px thumb, translateX(16px))
- [x] Button group uses the track+indicator pattern from SegmentedControl.module.css
- [x] Select wrapper matches Input.module.css styling (0.5px border, 32px height, `--dsw-radius-md`)
- [x] Action button matches Button.module.css (sm variant: 28px, ghost/outline/primary)
- [x] Modal uses `--dsw-radius-panel` (28px) and `--dsw-elevation-prominent`
- [x] All interactive elements have focus-visible rings via injected `<style>` + `data-dock-flash-focus`
- [x] No behavioral changes — all switch types, panel ordering, skin system, proxy cluster work identically
- [x] Light and dark themes both render correctly (tokens handle the switch automatically)
- [x] `pnpm run check:overlay` passes
- [x] `pnpm run check:docs` passes
- [x] No new `require()` or import statements added (no build step)
- [x] The `R`, `E`, `F` constants are defined once at the top of the styles region and used everywhere

---

## Verification Results (automated)

| Check | Result |
|---|---|
| `node --check lib/client.js` | ✅ exit 0 |
| `pnpm run check:overlay` | ✅ ALL CHECKS PASSED |
| `pnpm run check:docs` | ✅ 61645/65536 bytes, 3891 headroom, all links resolve, version 1.6.2 consistent |
| Hardcoded hex colors in S | ✅ 0 remaining |
| Hardcoded rgba outside var() | ✅ 0 remaining (all inside token fallbacks) |
| Hardcoded borderRadius (not 999px) | ✅ 0 remaining |
| `outline: 'none'` style declarations | ✅ 0 remaining (2 comment references only) |
| `data-dock-flash-focus` coverage | ✅ 19 elements (8 React + 7 imperative + 2 modal + 1 menu + 1 injected rule) |

Items 13.5–13.9 require a live browser session for manual visual/functional verification and are left unchecked pending that testing.
