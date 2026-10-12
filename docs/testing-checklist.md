# dock-flash (adapter) — manual testing checklist

The per-change verification checklist **for the dock-base adapter**, which is all this repository is
since 3.0.0. It lives here rather than in `AGENTS.md` because it is a PROCEDURE you run while
verifying, not a rule you need in mind while writing code.

**Everything about the panel itself is verified in the core's repository.** The skins, the trigger
positions, the overlay drag and its `__dockFlashOverlay()` probe, the proxy cluster and its test URL,
the diagnostics log, panel reorder/visibility and `__dockFlashPanelOrder()`, the turn-rail selector
drift check, host-backed preference migration — none of those identifiers exist in this package's
`lib/client.js` any more. They belong to `dsh-flash`. If you find yourself adding an item about them
here, it goes in the other repo.

**Read it before claiming any change is verified.**

---

## What the committed check actually covers

`node scripts/check-adapter-mount.mjs` (`pnpm run check:overlay`) is the one committed check. It
evaluates the **real** `lib/client.js` in a `node:vm` sandbox against a minimal DOM and a cordis-shaped
`ctx`, and asserts the mount contract across **10 groups** — see `AGENTS.md` § Verification for the list. Point
`DOCK_FLASH_BUNDLE` at another copy to confirm it still fails on a broken one:

```sh
DOCK_FLASH_BUNDLE=/path/to/suspect/client.js node scripts/check-adapter-mount.mjs
```

It replaces **no** item below. It cannot: the `Panel` / `ErrorBoundary` / `registry` stubs are inert,
so nothing about rendering is covered, and `document.querySelector` returns `null`, so item 6 does not
run there.

---

0. **After any `package.json` change, restart DSH — a browser refresh verifies nothing.**
   `evaluatePluginCompatibility()` runs once, at boot, inside `preflight()`. When it rejects a
   `@deepseek-ai/dsh*` peer it sets `row.disabled = true`, and that decision is not recomputed on
   reload. So a manifest fix looks like it did not work, and — worse — a manifest *break* can be
   tested past for a whole session. Restart means quit the process and start it again, not reload.
   The symptom of the row being disabled is the GUI banner
   *"dock-flash is incompatible with DSH x.y.z (requires …)"* plus a sidebar with every other icon
   and no Flash. Read the banner as **"delete this peer"**, never as **"bump this version"**: DSH
   compares such a peer against its own runtime version, so no range satisfies it.

1. **The five registrations are all present.** With dock-base installed, the sidebar panel
   (`dock-flash:quick-control`, region `sideBar`, order 50), the plugin card (`dock-flash`), the
   activity-bar item (`dock-flash:quick-control`), the editor view (`dock-flash:quick-control`) and
   the command (`dock-flash:openQuickControl`) must each exist exactly once. Half a set is the
   signature of a mount that threw partway — check item 2's console rule before assuming a
   registration bug.

2. **A failed mount says so; it does not go silent.** After `[dock-flash] workbench mode — dock-base
   detected` the console must show either the successful registrations' effects or a **red**
   `[dock-flash] mounting into the workbench failed …` / `[dock-flash] the core panel service arrived
   but mounting it threw …`. Silence after `workbench mode` is itself the defect: it means an
   exception escaped into cordis, which is exactly how the panel vanished for every user of every
   release up to the fix. Both `ctx.inject` callbacks are wrapped precisely so this line exists.

3. **A missing core is loud, at 2000 ms, and names both things.** Uninstall/rename `dsh-flash` and
   reload: after ~2 s the console must print `[dock-flash] the core panel service (dockFlashPanel)
   never arrived …` including the `dsh plugin install dsh-flash` instruction. It must **not** look
   like "the adapter is not installed" — the host plugin's `inject` stays `[]` so cordis never skips
   `apply()`.

4. **A version this adapter does not know degrades, it does not blank.** With a core publishing
   `version !== 1`, expect `[dock-flash] core panel service speaks version N, this adapter speaks 1 —
   leaving the standalone ⚡ in place`. The ⚡ must still work. A silent no-op here would be
   indistinguishable from a broken install.

5. **No dock-base = standalone, with one warning.** Uninstall dock-base: `[dock-flash] dock adapter is
   installed but dock-base is not — staying in standalone mode (the ⚡ stays)` once, no error, and the
   ⚡ still opens the panel. This is a supported configuration, not a failure.

6. **The sidebar title follows a language switch.** Switch DSH's language while the Flash pane is the
   active activity item → `.dsh-wb-sidebar-title` changes. This is the **only selector this package
   reaches into DSH's markup for**, and it exists because dock-base's `WorkbenchRoot` does not
   subscribe to locale changes, so `titleOf(activePane)` is only recomputed on a layout mutation. It
   is also the item the harness cannot cover (`querySelector` is stubbed to `null`), so it is purely
   a by-eye check. If the title goes stale after a dock-base upgrade, that class name moved.

7. **The plugin card's title and description are static strings.** In dock-base Settings → Plugins,
   the Flash card must render text, not `[object Object]` or a function's source. `createPluginCard`
   puts `plugin.title` / `plugin.description` straight into React children and does **not** call
   `resolveSettingText`, so a `() => string` — correct for `registerPanel` — is a bug here. The
   description is read once from the active locale and does not follow a later live switch; that is
   accepted, not a defect.

8. **Two mounts must not steal each other's panel.** With the panel mounted in two places (e.g. the
   sidebar panel and the editor view both open), tear one down → the other must keep working. The
   per-mount disposer calls `releaseOne()`; only the dock-hidden path and a whole-host teardown may
   call `release()`. A second mount that loses its panel means a disposer was "simplified" to
   `release()`.

9. **dock-hidden ↔ standalone round-trips.** Hide the dock → `[dock-flash] dock-hidden — releasing the
   panel to standalone mode`, and the ⚡ takes over. Show it again → `[dock-flash] dock-visible —
   reclaiming the panel` and the sidebar panel is back. Toggling repeatedly must not leak holders or
   strand the panel in neither mode; the sync also re-runs on `wb.onDidChangeSetting`, so changing any
   dock-base setting re-evaluates it.

10. **i18n comes from the core, and claims nothing.** Switch the DSH language with the panel open. The
    sidebar title, the activity-bar tooltip and the editor-view title all follow; the Flash settings-card
    description does **not** (dock-base renders that card statically — expected, not a defect). Expect **no
    locale warning at all**: the adapter registers no namespace of its own, so a line like
    `official locale registration failed; falling back to core panel.i18n` means someone re-added a
    `LocaleRuntime.register()` call, which can only throw because the core already owns `dock-flash`. Also
    confirm the negative case — switch language while a DIFFERENT pane is active and that pane's title must
    be untouched. A missing locale must never be a mount failure: that rule exists because a property read
    on the locale service once took the whole mount down.

11. **The upgrade hazard, if the profile is on `^2`.** Its `cordis.patch.yml` panel entry may still
    assert `name: dock-flash` while the core's package is `dsh-flash`. DSH then prints
    `patch: name mismatch for "dock-flash" (expected "dsh-flash", got "dock-flash"), skipping` and
    **drops the whole `config:` block** — panel order, skin and trigger settings silently revert. Fix
    by changing that entry's `name:` to `dsh-flash` and keeping `id: dock-flash`.
