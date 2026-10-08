/**
 * dock-flash — the dock-base ADAPTER half.
 *
 * This package is the whole of the dock-base integration and nothing else. The
 * Quick Control panel itself — its component tree, the switch registry, the
 * skin system, the zh/en i18n, the alert surfaces, the settings-driven host
 * routes and the standalone ⚡ — is the separate package `dsh-flash`, which
 * publishes it as the `dockFlashPanel` service.
 *
 * The two halves meet at exactly one object. Everything this file registers
 * with dock-base reads the panel through `panel.*` on that service and never
 * reaches into the core's internals, so the boundary is a closed set: the
 * panel, its error boundary, its header factory, its icon, its registry and its
 * i18n helpers. `docs/refactor-plan-core-adapter-split.md` §3.1.
 *
 * See `cordis.patch.yml` for why this package inserts the core's host row as
 * well as its own.
 */

//#region Module Entry ────────────────────────────────────────────────────────
window.__ModuleLoader__.load({
  id: 'dock-flash',
  factory: (require) => {
    // ONE source of truth for the client version. It is logged at startup,
    // because a build that cannot name itself cannot be distinguished from the
    // previous one: several rounds of fixes were once all labelled `v1.3.0`, so
    // neither the maintainer nor the console could say which build the browser
    // actually had — and a reload that silently served the old bundle looked
    // exactly like a fix that did not work. The adapter's version tracks its
    // own package (`dock-flash@3.x`), NOT the core's.
    const CLIENT_VERSION = '3.0.0'
    console.log('[dock-flash] adapter v' + CLIENT_VERSION)

    // How long to wait for the core's `dockFlashPanel` service before declaring
    // the install broken. Deliberately the same 2000 ms as the core's own claim
    // watchdog (`CLAIM_WATCHDOG_MS`): both answer the question "a service this
    // half depends on has not arrived", and two different numbers for one
    // question would only make the logs harder to read.
    const ADAPTER_SERVICE_WATCHDOG_MS = 2000

    // The only React surface this half needs is `createElement`: it builds one
    // wrapper component (`SafePanel`) and otherwise passes the core's already
    // built components around. No hooks, no portals, no state.
    const React = require('react')
    const h = React.createElement
    // ═══════════════════════════════════════════════════════════════════════
    // ── The adapter ──────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════
    // Everything below talks to dock-base, and nothing here reaches into the
    // core's internals: the panel, its error boundary, its header, the icon,
    // the registry and the i18n helpers all arrive through the
    // `dockFlashPanel` service `dsh-flash` publishes, so the boundary is a
    // closed set. It was a region inside one 14k-line client bundle until
    // Phase 2 of docs/refactor-plan-core-adapter-split.md; the split is what
    // let the two halves become two packages, and the region became this file.

    /**
     * Has dock-base been composed into this boot? Read from the two manifest
     * sources the plugin's own skin system trusts (the boot manifest and the
     * module graph), never from localStorage. Presence here means "installed AND
     * enabled" — a disabled plugin is absent from both. This is the reason we can
     * distinguish "the workbench service will arrive momentarily" from
     * "dock-base is genuinely not here".
     */
    function _dockBaseInstalled(ctx) {
      try {
        const boot = window.__DSH_BOOT__
        if (boot && Array.isArray(boot.entries)) {
          for (let i = 0; i < boot.entries.length; i++) {
            const id = boot.entries[i] && boot.entries[i].id
            if (id === 'dock-base' || id === 'dock-base/client') return true
          }
        }
      } catch (_) {}
      try {
        const mod = ctx.get ? ctx.get('modules') : undefined
        if (mod && mod.graphRows) {
          for (const [rawId] of mod.graphRows) {
            if (rawId === 'dock-base' || rawId === 'dock-base/client') return true
          }
        }
      } catch (_) {}
      return false
    }

    /**
     * Mount the dock integration when a dock host is present, and hand the panel
     * back when it is not. Returns a disposer, or null when there is nothing to
     * mount.
     *
     * The core owns the panel and always offers its own ⚡; this function is what
     * asks the core to stand down (`host.claim()`) and what gives the ⚡ back
     * (`host.release()`, used when dock-base hides the plugin). That ordering is
     * deliberate: the core never inspects the workbench, so the combination
     * "dock-base installed, this adapter NOT installed" leaves a working ⚡
     * rather than an empty page.
     */
    function mountDockPanelAdapter(ctx, panelArg) {
      // `panelArg` FIRST, and that order is the whole reason this parameter exists.
      // The core calls us from inside its own apply(), one statement after
      // `ctx.provide('dockFlashPanel', …)` — and cordis service resolution is
      // ASYNCHRONOUS: a `ctx.get()` in that same synchronous call stack returns
      // undefined even though the service was just provided. MEASURED against
      // cordis 4.0.4 with a minimal probe: right after provide → `undefined`, on the
      // next tick → the service. Resolving through `ctx.get()` here therefore sent
      // every real boot down the "service is missing" branch below: nothing was
      // registered into dock-base, and the user saw dock-flash absent from
      // dock-base's plugin configuration while a stray ⚡ appeared instead. The
      // harness could not catch it, because its ctx stub answers `get()` from a
      // plain object synchronously.
      //
      // The `panelArg` parameter and the `ctx.get()` fallback are both historical
      // and both still load-bearing. In the SHIPPING shape this package is a
      // SEPARATE plugin, resolved by the caller in PluginEntry with
      // `ctx.inject(['dockFlashPanel'], …)` — so `panelArg` is always supplied and
      // the fallback never runs. It is kept because the measurement above is the
      // kind that gets undone by a later "tidy-up": a future caller that reaches
      // for `ctx.get()` on the same tick as the `provide` would silently land in
      // the "service is missing" branch below, and the fallback at least keeps
      // that branch reachable and self-explaining rather than dead.
      const panel = panelArg || (ctx.get ? ctx.get('dockFlashPanel') : undefined)
      if (!panel) {
        // Never blank. If the core was installed but not composed — the silent
        // failure mode measured in the plan's §1.4 — this line is its only
        // symptom, so it names the fix.
        console.error('[dock-flash] dock-base is present but the core panel service ' +
          '(dockFlashPanel) is missing: install/reinstall the core package (dsh-flash), then reload')
        return null
      }
      if (panel.version !== 1) {
        console.warn('[dock-flash] core panel service speaks version ' + String(panel.version) +
          ', this adapter speaks 1 — leaving the standalone ⚡ in place')
        return null
      }
      const wbNow = ctx.get ? ctx.get('workbench') : undefined
      if (wbNow) return mountWorkbench(ctx, wbNow, panel)
      if (_dockBaseInstalled(ctx)) {
        // The load order is not guaranteed to have dock-base ahead: its
        // `workbench` service may land after this plugin's apply(). Resolve it
        // the same way the standalone half resolves `slots` —
        // ctx.inject(['workbench'], …) subscribes for the service and mounts
        // when it arrives. Until then the core's ⚡ is what the user sees, and
        // the claim below unmounts it.
        console.log('[dock-flash] dock-base installed — waiting for the workbench service')
        let mounted = null
        const fiber = ctx.inject(['workbench'], (scope) => {
          mounted = mountWorkbench(ctx, scope.workbench, panel)
        })
        return () => {
          if (mounted) { try { mounted() } catch (_) {} mounted = null }
          if (fiber && fiber.dispose) { try { fiber.dispose() } catch (_) {} }
        }
      }
      console.warn('[dock-flash] dock adapter is installed but dock-base is not — ' +
        'staying in standalone mode (the ⚡ stays)')
      return null
    }

    /**
     * The dock-base registrations: sidebar panel, plugin card, activity-bar item,
     * editor view, command — plus the ownership handshake and the
     * dock-hidden → ⚡ fallback. `wb` is dock-base's workbench service.
     */
    function mountWorkbench(ctx, wb, panel) {
      console.log('[dock-flash] workbench mode — dock-base detected')
      const Lc = panel.i18n.L
      const tc = panel.i18n.t

      // Claim the panel: the core unmounts its own ⚡ and this half becomes the
      // only thing rendering it. The mount does NOT hold a lease of its own — it
      // tells the HOST it is holding the panel (`claim`) and tells it when it stops
      // (`releaseOne`). The count therefore lives in one place and two mounts can
      // share it: dock-base's floating-window route alongside the sidebar pane used
      // to get the same lease object twice, so whichever unmounted first pulled the
      // panel out from under the other.
      let claimed = false
      const claim = () => {
        if (claimed) return
        claimed = true
        const lease = panel.host.claim()
        if (lease && lease.confirm) lease.confirm()
      }
      const releaseOne = () => {
        if (!claimed) return
        claimed = false
        try { panel.host.releaseOne() } catch (_) {}
      }
      // Claim through `ctx.effect` so cordis tears this mount's hold down with its
      // fiber. The SAME `releaseOne` is what the returned disposer calls: in a real
      // boot cordis runs the effect cleanup, while the harness (whose `effect` stub
      // returns the cleanup without invoking it) drives the returned disposer
      // instead. One release path, two callers — never two implementations.
      ctx.effect(() => {
        claim()
        return releaseOne
      }, 'dock-flash: panel claim')

      // ── 3. Register a sidebar panel (renders QuickControlPanel in the sidebar) ──
      //    Wrapped in the core's PanelErrorBoundary to prevent render errors from
      //    crashing the entire dock-base WorkbenchRoot (which has no error
      //    boundary of its own).
      const SafePanel = (props) => h(panel.ErrorBoundary, null, h(panel.Panel, props))

      ctx.effect(() => {
        const dispose = wb.registerPanel({
          id: 'dock-flash:quick-control',
          region: 'sideBar',
          title: Lc('title'),
          icon: panel.icon,
          order: 50,
          component: SafePanel,
          // The core's own header (close-on-blur toggle + close button), so its
          // seven internals stay internal.
          // dock-base calls this with its own ViewProps; spread them through and
          // add the workbench, so the core header sees exactly what it expects.
          headerComponent: (props) => panel.Header({ ...props, wb }),
        })
        return dispose
      }, 'dock-flash: sidebar panel')

      // ── 3.4b. Patch sidebar title on locale change ──
      //    dock-base's WorkbenchRoot does not subscribe to locale changes, so
      //    titleOf(activePane) is only called when layout state mutates. We patch
      //    the .dsh-wb-sidebar-title textContent directly when our panel is
      //    active and the language switches.
      ctx.effect(() => {
        var off = tc.onLocaleChange(function () {
          try {
            var layout = wb.getLayout()
            if (!layout.activity) return
            var item = wb.getActivityItem(layout.activity)
            if (!item || item.paneId !== 'dock-flash:quick-control') return
            var titleEl = document.querySelector('.dsh-wb-sidebar-title')
            if (titleEl) titleEl.textContent = tc('title')
          } catch (_) {}
        })
        return off
      }, 'dock-flash: sidebar title i18n patch')

      // ── 3.5. Register as a workbench plugin (Settings panel entry) ──
      //    Appears in dock-base Settings → Plugins "entry" tab.
      //    hasEntry: true → visibility toggle + "Open" button.
      //    The "Open" button works because the activity bar item below carries
      //    pluginId: 'dock-flash', which pluginEntryItem() matches.
      //    NOTE: title/description must be static strings (not functions).
      //    Unlike registerPanel/registerActivityBarItem which accept
      //    () => string for i18n, dock-base's createPluginCard renders
      //    plugin.title and plugin.description directly as React children
      //    — it does NOT call resolveSettingText().  A function child
      //    renders as blank in React.
      ctx.effect(() => {
        const dispose = wb.registerPlugin({
          id: 'dock-flash',
          title: 'Flash',
          description: 'Workbench quick-control panel with skin switcher and layout toggles',
          icon: panel.icon,
          hasEntry: true,
          order: 30,
        })
        return dispose
      }, 'dock-flash: plugin entry')

      // ── 4. Register the activity bar item (lightning icon) ─────────
      ctx.effect(() => {
        const dispose = wb.registerActivityBarItem({
          id: 'dock-flash:quick-control',
          pluginId: 'dock-flash',
          title: Lc('title'),
          icon: panel.icon,
          order: 50,
          paneId: 'dock-flash:quick-control',
        })
        return dispose
      }, 'dock-flash: activity-bar item')

      // ── 5. Register the editor view (can also open as floating window) ──
      ctx.effect(() => {
        const dispose = wb.registerEditorView({
          id: 'dock-flash:quick-control',
          title: Lc('title'),
          icon: panel.icon,
          order: 50,
          component: SafePanel,
        })
        return dispose
      }, 'dock-flash: editor view')

      // ── 6. Register a command to open the floating window ──────────
      ctx.effect(() => {
        const dispose = wb.registerCommand({
          id: 'dock-flash:openQuickControl',
          title: Lc('title'),
          run: () => {
            wb.openView('dock-flash:quick-control', undefined, { floating: true })
          },
        })
        return dispose
      }, 'dock-flash: open command')

      // ── Dock-hidden → independent fallback ───────────────────────
      // dock-base's own settings let a user hide a plugin (the Flash
      // entry/activity-bar item; persisted as `dock-base:hidden-plugins`
      // and read through `getHiddenPluginIds()`). Hiding dock-flash would
      // otherwise leave NO entry point to the quick control panel while
      // dock-base is installed — this plugin would simply vanish.
      //
      // Instead, when the dock reports dock-flash as hidden we DETACH: we hand
      // the panel back to the core (`host.release()`), which mounts the very same
      // standalone machinery the no-dock-base path uses (the floating ⚡ trigger
      // + standalone panel, with its Layout switches). Restoring the plugin in
      // the dock re-attaches by claiming it again — a clean, reload-free
      // workbench ↔ standalone cycle. The workbench entries themselves stay
      // registered; the dock suppresses their UI while hidden, and the
      // standalone ⚡ takes over as the single entry point.
      //
      // Re-entrancy is what makes toggling safe: release()/claim() are both
      // idempotent, and the core's mount/dispose pair is re-entrant, so a
      // detach/re-attach cycle leaves exactly one panel on screen each time.
      // Close any dock-flash workbench instances before the standalone
      // panel takes over, so detaching never leaves two panels for one
      // plugin on screen. Runs from the settings-changed handler — not
      // from OUR render path — so it cannot trip Critical Rule 1.
      const _closeDockFlashWorkbenchViews = () => {
        try {
          const layout = wb.getLayout()
          const floats = layout.floatingWindows || {}
          for (const instanceId of Object.keys(floats)) {
            if (floats[instanceId].viewId === 'dock-flash:quick-control') {
              try { wb.closeViewInstance(instanceId) } catch (_) {}
            }
          }
          ;(layout.editorTabs || []).slice().forEach((tab) => {
            if (tab.viewId === 'dock-flash:quick-control') {
              try { wb.closeViewInstance(tab.instanceId) } catch (_) {}
            }
          })
        } catch (_) {}
      }
      let detached = false
      const _syncDockHidden = () => {
        let hidden = false
        try { hidden = wb.getHiddenPluginIds().includes('dock-flash') } catch (_) {}
        if (hidden && !detached) {
          console.log('[dock-flash] dock-hidden — releasing the panel to standalone mode')
          detached = true
          _closeDockFlashWorkbenchViews()
          // Drop this half's claim COMPLETELY: the detach is one whole-host
          // decision, so the holder count goes with it. `claim()` re-takes it on
          // the way back. Using releaseOne() here would leave a stale count behind
          // and the re-attach would then never give the ⚡ up again.
          claimed = false
          try { panel.host.release() } catch (_) {}
        } else if (!hidden && detached) {
          console.log('[dock-flash] dock-visible — reclaiming the panel')
          detached = false
          claim()
        }
      }
      // Apply immediately: a page that boots with dock-flash already
      // hidden must show the floating ⚡ without waiting for a toggle.
      _syncDockHidden()
      // Follow the live setting. `onDidChangeSetting` fires for every
      // persisted dock setting, including the hidden-plugins list, so
      // toggling in the dock detaches/reattaches live. It is a store
      // event, not OUR render path, so it never trips Critical Rule 1.
      ctx.effect(() => wb.onDidChangeSetting(_syncDockHidden),
        'dock-flash: dock-hidden ↔ standalone sync')

      // The disposer this half hands back to apply(). Cordis disposes the
      // registrations above through their own `ctx.effect`s, and in a real boot that
      // includes the claim's cleanup; this disposer is the same release reached
      // directly, so a host that tears the mount down by hand — the harness does,
      // because its `effect` stub never runs cleanups — cannot leave the panel
      // suppressed by a holder nobody remembers.
      //
      // ONLY `releaseOne()`. An earlier version also called `panel.host.release()`
      // here as a belt-and-braces sweep, and that is what broke the two-mount case:
      // `release()` is the WHOLE-HOST release (it zeroes the count and gives the
      // panel back), so the first mount's teardown pulled the panel out from under
      // the second one that still held it. A per-mount disposer releases exactly one
      // claim; dropping every holder is `release()`, which only the dock-hidden
      // path and the whole-mount teardown are entitled to call.
      return releaseOne
    }

    //#region PluginEntry ────────────────────────────────────────────────────────
    // `inject` is EMPTY on purpose. This half owns no cordis service and needs
    // none declared to read what it uses: `dockFlashPanel` is resolved
    // explicitly below with `ctx.inject`, and `workbench` is resolved inside
    // `mountDockPanelAdapter` with `ctx.get`/`ctx.inject` exactly as the
    // pre-split plugin did.
    //
    // Declaring `dockFlashPanel` in this array would be the tidier-looking form
    // and is the WRONG one, for two reasons:
    //   1. cordis would simply never run `apply()` while the service is absent,
    //      so a broken install — the core's host row composed but its client
    //      half never loaded — would be indistinguishable from "this plugin is
    //      not installed". The whole point of §2 correction 2 of the plan is
    //      that this failure is LOUD.
    //   2. Ordering still would not be guaranteed. MEASURED against cordis
    //      4.0.4: service resolution is ASYNCHRONOUS. The core calls
    //      `ctx.provide('dockFlashPanel', …)` inside its own `apply()`, and a
    //      `ctx.get()` in that same synchronous stack returns `undefined`; the
    //      next tick returns the service. That measurement is exactly why the
    //      core passes the service to the adapter as an explicit argument when
    //      the two halves share one plugin, and why this package — which is a
    //      SEPARATE plugin, applied on a later tick — subscribes with
    //      `ctx.inject` rather than assuming anything about arrival order.
    return {
      name: 'dock-flash',
      inject: [],
      apply(ctx) {
        try {
          let settled = false

          // Subscribe, do not poll: `ctx.inject` runs the callback on the tick
          // the core publishes the service, and immediately if it is already
          // there.
          const fiber = ctx.inject(['dockFlashPanel'], (scope) => {
            if (settled) return
            settled = true
            const dispose = mountDockPanelAdapter(ctx, scope.dockFlashPanel)
            if (!dispose) {
              // `mountDockPanelAdapter` already said why, loudly, and returned
              // null for a legitimate reason: dock-base is not installed, or
              // the service carries a version this adapter does not know.
              // Neither is an error, so neither is repeated here.
              return
            }
            // Registered through `ctx.effect` so the claim is dropped when this
            // plugin is disposed. The disposer is the PER-MOUNT `releaseOne`,
            // never the whole-host `release` — see the note at the end of
            // `mountWorkbench` for the two-mount regression that distinction
            // fixes.
            ctx.effect(() => dispose, 'dock-flash: dock adapter mount')
          })

          // LOUD FAILURE — docs/refactor-plan-core-adapter-split.md §2
          // correction 2. `dsh-flash` is a HARD dependency of this package
          // (`dependencies`, not `peerDependencies`) and this package's bundle
          // patch re-inserts the core's host row, so a service that never
          // arrives is a BROKEN INSTALL, not a configuration choice. Before the
          // split the panel and its consumer were one module, so this state
          // could not exist; the split creates it, which is why it gets an
          // error naming the fix instead of a silent no-op.
          const watchdog = setTimeout(() => {
            if (settled) return
            settled = true
            console.error(
              '[dock-flash] the core panel service (dockFlashPanel) never arrived — ' +
              'the dsh-flash core is not installed, or its client half did not load. ' +
              'The panel will not be mounted into the workbench. ' +
              'Install or reinstall it with `dsh plugin install dsh-flash`, then reload.'
            )
          }, ADAPTER_SERVICE_WATCHDOG_MS)

          ctx.effect(() => () => {
            settled = true
            clearTimeout(watchdog)
            if (fiber && fiber.dispose) { try { fiber.dispose() } catch (_) {} }
          }, 'dock-flash: adapter teardown')
        } catch (e) {
          console.error('[dock-flash] apply failed:', e)
        }
      },
    }
    //#endregion ─────────────────────────────────────────────────────────────────
  },
})
//#endregion ───────────────────────────────────────────────────────────────────
