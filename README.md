# dock-flash

> The **dock-base adapter** for the DSH Quick Control panel — it mounts the panel
> into the DSH Workbench through `ctx.workbench`. The panel itself (its component
> tree, the `quickControl` switch registry, the skin system, the zh/en i18n, the
> alert surfaces, the host routes and the standalone ⚡) is the separate package
> **[`dsh-flash`](https://github.com/tcgbp/dsh-flash)**.

**[中文文档](./README.zh-CN.md)**

## Core + adapter

| Package | Role | Depends on dock-base? |
| --- | --- | --- |
| [`dsh-flash`](https://github.com/tcgbp/dsh-flash) **v1** | The panel **core**. Owns the React panel, the `quickControl` registry, the skin system, the alert surfaces, the standalone ⚡ and the whole host half (settings namespace, `/plugins/dock-flash/…` routes). | No — runs on its own |
| **`dock-flash` v3** (this package) | The thin **adapter**. Registers the panel into a dock-base Workbench and claims it from the core. Publishes no service of its own. | Yes — `dock-base` is a **non-optional** peer |

The two halves meet at exactly one object: the core's `dockFlashPanel` service. The
adapter reads the panel through `panel.*` on that service and never reaches into the
core's internals, so the boundary is a closed set.

| What you want | Install | You get |
| --- | --- | --- |
| Workbench (dock-base) integration | `dock-flash@^3`, which pulls `dsh-flash` in — plus `dock-base` | Sidebar/floating panel, settings card, activity-bar ⚡, editor view, the `dock-flash:openQuickControl` command |
| Only the standalone floating ⚡ | `dsh-flash` alone | A ⚡ trigger in the configured conversation slot → floating panel |

> **This package is not the panel.** The switch registry, skins, i18n, alert routes
> and the standalone trigger all live in `dsh-flash` — see the
> [core README](https://github.com/tcgbp/dsh-flash#readme) for all of that. This
> document covers the adapter and the split only.

### Upgrading from `dock-flash` v2

1. **A `^2.x` range keeps you on the old single package — nothing breaks by
   default.** The split added a new major (`dock-flash@^3`) rather than replacing
   v2. To move, install `dock-flash@^3`; it depends on `dsh-flash`, which npm
   installs for you.
2. **One profile edit is required and easy to miss.** In the profile's
   `cordis.patch.yml` the entry carrying the panel settings is `- id: dock-flash`
   with `name: dock-flash` — a non-insert patch whose `name:` is an **assertion**
   about the target row's current specifier. After the split `id: dock-flash`
   resolves to the core row, whose specifier is `dsh-flash`, so the assertion
   mismatches, DSH prints
   `patch: name mismatch for "dock-flash" (expected "dsh-flash", got "dock-flash"), skipping`,
   and the whole `config:` block is **dropped** — silently reverting panel order,
   skin and trigger position/size. **Fix:** change that entry's `name: dock-flash`
   to `name: dsh-flash` and **keep `id: dock-flash`**. Do not delete the entry.
3. **Do not hand-write the core row into the profile.** Installing `dock-flash@^3`
   is the supported path; its bundle patch inserts the core row for you.

## What this adapter does

`lib/client.js` (470 lines) is the whole browser half: the former
`//#region DockAdapter` block promoted to a package. It consumes the core's
`dockFlashPanel` service and makes exactly **five** `ctx.workbench` registrations:

| Registration | API | Id | Details |
| --- | --- | --- | --- |
| Sidebar panel | `ctx.workbench.registerPanel()` | `dock-flash:quick-control` | region `sideBar`, order 50 |
| Plugin entry | `ctx.workbench.registerPlugin()` | `dock-flash` | Settings card; visibility toggle + Open |
| Activity bar item | `ctx.workbench.registerActivityBarItem()` | `dock-flash:quick-control` | paneId `dock-flash:quick-control` |
| Editor view | `ctx.workbench.registerEditorView()` | `dock-flash:quick-control` | draggable to a floating window |
| Command | `ctx.workbench.registerCommand()` | `dock-flash:openQuickControl` | opens the view floating |

**It publishes nothing** — no `quickControl`, no `dockFlashPanel`. The panel it
renders is wrapped in the core's `ErrorBoundary` and uses the core's `panel.Header`
and `panel.icon`; user settings are read through `panel.i18n` / the panel service
only.

### The claim handshake

On mount the adapter calls `panel.host.claim()`, then `lease.confirm()`. The
per-mount disposer calls `panel.host.releaseOne()` **only — never `release()`**. The
whole-host `panel.host.release()` is called only on the dock-hidden path (when
`wb.getHiddenPluginIds()` contains `dock-flash`), which hands the panel back so the
core can put its standalone ⚡ back up.

The rationale matters: an earlier version also called `release()` in the per-mount
disposer, and that **broke the two-mount case** — dock-base can mount the panel
twice at once (the sidebar pane and a floating window). `release()` is the
whole-host release, so the first mount's teardown pulled the panel out from under
the second one that still held it. A per-mount disposer releases exactly one claim.

If the `workbench` service has not arrived yet, the adapter subscribes with
`ctx.inject(['workbench'], …)` and mounts when it does, rather than assuming a load
order; "the service is coming" and "dock-base is not installed" stay distinct. The
adapter also refuses a `dockFlashPanel` whose `version !== 1`, leaving the core's ⚡
in place rather than drawing half a panel.

## The host half

`src/index.ts` (34 lines) is a **deliberately empty** host plugin:

```ts
export const name = 'dock-flash-adapter'
export const inject: string[] = []

export function apply(_ctx: Context): void {
  // Intentionally empty. Everything this package does is in `lib/client.js`.
}
```

It exports `name = 'dock-flash-adapter'`, **not `dock-flash`** — that name belongs
to the core's host plugin, which owns the settings namespace. It exists for exactly
one reason: a client bundle attaches to a profile row whose specifier is the bare
package name, so a package with no host entry point has no row to hang its browser
half on.

**`inject: []` is deliberate.** Declaring `dockFlashPanel` there would make cordis
silently skip `apply()` while the service is absent, so a broken install would look
identical to "not installed". Instead `apply` resolves the service with
`ctx.inject(['dockFlashPanel'], …)` and arms a **2000 ms watchdog** that logs this
loud error instead of no-opping:

```
[dock-flash] the core panel service (dockFlashPanel) never arrived — the dsh-flash core is not installed, or its client half did not load. The panel will not be mounted into the workbench. Install or reinstall it with `dsh plugin install dsh-flash`, then reload.
```

## How the two rows are composed

`cordis.patch.yml` inserts **two** rows:

```yaml
- insert:
    - id: dock-flash
      name: dsh-flash          # the CORE
    - id: dock-flash-adapter
      name: dock-flash         # this package
```

**Why the core row is here.** A hoisted package is not a composed row. DSH composes
the rows a profile names, plus the rows a composed package's own bundle patch
inserts; nothing walks a dependency's `dsh.bundle.patch` merely because the
dependency is present. `dsh-flash` is a real `dependencies` entry, so it lands on
disk — but without the first row an adapter-only install would load no core plugin
and publish no `dockFlashPanel`, and the adapter's watchdog would simply run out.

**Why the id stays `dock-flash`.** The entry id **is** the settings namespace.
Consequently the settings namespace, the `dock-flash:*` switch ids, the
`dock-flash:…` localStorage keys and the `/plugins/dock-flash/…` host routes all
legitimately stay `dock-flash`. **That is not a bug — do not "correct" those
strings anywhere.** Keeping the id is what makes the split migration-free.

The client module id is `dock-flash`; the core's is `dsh-flash` — two client
modules cannot share one require key.

## Requirements

| Requirement | Version / value | Notes |
| --- | --- | --- |
| `dock-base` | `>=0.1.2-0 <1.0.0-0 \|\| >=0.2.0-0 <1.0.0-0` | **peer, non-optional.** Provides the `ctx.workbench` service |
| `@deepseek-ai/cordis` | `>=4.0.0-rc.1 <5.0.0-0 \|\| >=4.0.1-0 <5.0.0-0` | peer (bundled with DSH) |
| `dsh-flash` | `^1.0.0` | regular `dependency` — the panel core |

`dsh.client.inject` is
`["dsh-flash", "dock-base", "@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-api-session-controller"]`,
and `dsh.bundle.patch` points at `./cordis.patch.yml`.

## Troubleshooting

- **A linked core needs its own `pnpm install`.** If you develop against a local
  `dsh-flash` checkout (symlinked into the profile), that checkout must have its own
  dependencies installed. Otherwise the core's host half fails to import with
  `Cannot find package '@deepseek-ai/schemastery'`, and DSH reports
  `dock-flash (dsh-flash): failed to import`.
- **The panel never appears and the console shows the watchdog message.** The core's
  client half did not load. Reinstall it: `dsh plugin install dsh-flash`, then
  reload.
- **Panel order, skin or trigger position reverted after the upgrade.** The profile
  patch's `name:` assertion mismatched and the `config:` block was dropped — fix it
  as described in [Upgrading from `dock-flash` v2](#upgrading-from-dock-flash-v2).
  DSH prints `patch: name mismatch for "dock-flash" …` when this happens.

## Development

```sh
pnpm install
pnpm run build          # tsc → dist/index.js
pnpm run typecheck      # type check only
pnpm run check:docs     # instruction-file budget + link resolution
pnpm run check:overlay  # adapter mount behavioural checks
```

For development rules and constraints, see [AGENTS.md](./AGENTS.md). For what
changed in each release, see [CHANGELOG.md](./CHANGELOG.md).

## dsh-market listing screenshot (optional)

If you want a screenshot on the plugin-market card, add a `screenshots.json` at the
repository root (next to `package.json`) and put the images in a `screenshots/`
directory. This is optional and needs **no extra pull request** to the registry —
the market reads `screenshots.json` from your own repository. Example and enabling
steps: [docs/screenshots.md](./docs/screenshots.md).

## License

[Apache License 2.0](./LICENSE)
