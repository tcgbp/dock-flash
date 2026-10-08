# AGENTS.md — dock-flash (the dock-base adapter) Development Rules

> The panel core — the QuickControl registry, the React panel UI, skins, i18n, alerts, the standalone
> ⚡ trigger, the `dock-flash` settings namespace and the host HTTP routes — is the **separate package**
> `dsh-flash` (v1.0.0), in **another repository**. This repository (`dock-flash`, v3.0.0) is **only the
> dock-base Workbench adapter**: it composes the core into a profile and mounts the core's panel into
> dock-base. Nothing else. Read this before editing `lib/client.js`, `src/index.ts` or `cordis.patch.yml`.

## What belongs in this file — and the budget

`AGENTS.md` is injected into **every request**, so every line is a cost paid on every turn. The budget is
**65536 bytes**, enforced by `pnpm run check:docs` (`node scripts/check-docs-size.mjs`). The same script
also checks that every relative Markdown link in `AGENTS.md` and `docs/*.md` resolves, and that the
version in `package.json` and `const CLIENT_VERSION` in `lib/client.js` agree.

- **Rules here.** Contracts, invariants, and the traps that cost a real defect.
- **Procedures in `docs/`.** Release steps, test checklists, the narrative "why". `docs/` is not injected;
  it is read on demand.

Exceeding the budget does not error — the file is **truncated mid-sentence**, silently losing rules.

## Project structure

```
src/index.ts      HOST half — deliberately empty
lib/client.js     BROWSER half — single file, NO build step, edited directly
dist/index.js     compiled host half — TRACKED on purpose
cordis.patch.yml  bundle layer: inserts TWO profile rows (see below)
package.json      manifest + dsh.client.inject
docs/             long-form notes — NOT injected, read on demand
scripts/          repo tooling (check-docs-size.mjs, check-adapter-mount.mjs)
```

- `src/index.ts` — ESM. Exports `inject: []` and an intentionally empty `apply()`. Its only job is to be a
  host entry point: DSH discovers `lib/client.js` from `exports["./client"]` + `dsh.client` **for a composed
  row**, and a package with no host entry point has no row. No service, no settings, no HTTP routes.
- `lib/client.js` — the whole browser half, one file, no build, no TypeScript. Symlinked in the profile, so
  edits appear on refresh. Contains the module entry, the mount, the claim handshake and the watchdog.
- `dist/index.js` — compiled from `src/index.ts` by `pnpm run build`.
- `cordis.patch.yml` — the `dsh.bundle.patch` layer; the contract below is the most important thing here.
- `docs/` — `architecture-notes.md` (the "why" and the measurements), `releasing.md`,
  `testing-checklist.md`, `refactor-plan-core-adapter-split.md`, and the `superpowers/plans/` archive.
- `scripts/` — `check-docs-size.mjs` (`pnpm run check:docs`), `check-adapter-mount.mjs`
  (`pnpm run check:overlay`).

## Build & install

```sh
pnpm install
pnpm run build          # tsc → dist/index.js (host half only)
pnpm run typecheck      # type check with no emit
```

**`dist/` is tracked on purpose — never add it back to `.gitignore`.** A git install fetches *sources*, not
artifacts, and nothing runs `build`, so a repo without `dist/` arrives missing its host entry point
(`package.json` `main` and `exports["."]` both point at `./dist/index.js`) and fails to load. Shipping the
compiled file lets a git install work with no build step and no `allowBuilds` permission. **Do not add a
`prepare` script**: declaring one makes pnpm ≥10 demand an explicit build allowance before the first `add`
succeeds, which defeats the purpose. Consequence: every `src/index.ts` change needs `pnpm run build` and a
commit of `dist/` **in the same change**.

**Known gotcha right now:** `pnpm run <script>` fails in this repo, because pnpm's verify-deps-before-run
tries to install the not-yet-published `dsh-flash@^1.0.0`. Until `dsh-flash` is on npm, run the binaries
directly:

```sh
./node_modules/.bin/tsc -p tsconfig.json
node scripts/check-adapter-mount.mjs
```

## The two-row bundle patch (the core contract)

`cordis.patch.yml` must insert **two** rows:

```yaml
- id: dock-flash
  name: dsh-flash
- id: dock-flash-adapter
  name: dock-flash
```

Rules:

- **A HOISTED package is not a COMPOSED row.** DSH composes the rows a profile names plus the rows a
  composed package's own bundle patch inserts. Nothing walks a dependency's `dsh.bundle.patch` merely
  because the dependency is on disk. So without row 1, an adapter-only install puts the core on disk, loads
  no core plugin and publishes no `dockFlashPanel` — and the adapter just waits out its watchdog.
- **`insert` appends literally and does NOT dedupe by id.** A second patch layer inserting `id: dock-flash`
  would compose the core twice. The core defends itself with an idempotent `apply()` that returns early when
  `ctx.get('dockFlashPanel')` already exists.
- **The core's row id stays `dock-flash`, not `dsh-flash`.** An entry id **is** the settings namespace, so
  `dock-flash` is what every already-published preference and every `/plugins/dock-flash/…` route lives
  under; keeping it means an upgrade migrates nothing. Only the row's `name` is `dsh-flash`.
- **A client bundle attaches only to a composed row whose specifier is the bare package name** — which is
  also why this package needs its own host row at all.
- **A non-`insert` patch's `name:` is an ASSERTION about the target row's current `name`, not a rename.** A
  mismatch makes DSH skip the whole patch (see the upgrade hazard below).

## `dsh.client.inject` must list BASE package names

`arriveGraphRow()` looks `inject` entries up with `graphRows.get(packageName)` and never strips a `/client`
suffix, while graph-row keys are base names — so a suffixed entry is **silently ignored**. The current list is:

```json
["dsh-flash","dock-base","@deepseek-ai/dsh-client-runtime","@deepseek-ai/dsh-api-remotes","@deepseek-ai/dsh-api-session-controller"]
```

- `dock-base` is a **NON-optional** `peerDependencies` entry (there is no `peerDependenciesMeta` opt-out).
- `dsh-flash` is a plain `dependencies` entry (`^1.0.0`).

## The client half's contract

**Module loading.** The entry is `window.__ModuleLoader__.load({ id: 'dock-flash', factory: (require) => … })`.
`const CLIENT_VERSION = '3.0.0'` must equal the `package.json` version (`check:docs` asserts it). React comes
from `require('react')` — never `import` — and all elements are built with `h = React.createElement`.

**The host plugin's `inject` is `[]` deliberately.** Declaring `dockFlashPanel` there would make cordis
silently skip `apply()`, so a broken install would look exactly like "not installed". The plan requires the
failure to be **LOUD**, so `apply()` instead:

- awaits the service with `ctx.inject(['dockFlashPanel'], …)`, and
- arms `setTimeout(…, ADAPTER_SERVICE_WATCHDOG_MS)` — **2000 ms**, deliberately the same number as the core's
  `CLAIM_WATCHDOG_MS` — whose expiry `console.error`s the install/reload message.

**`mountDockPanelAdapter(ctx, panelArg)` takes the service as an EXPLICIT first argument.** Cordis service
resolution is asynchronous: `ctx.get('dockFlashPanel')` in the same tick as the `provide` returns
`undefined`. The `ctx.get()` fallback still exists so the "service is missing" branch stays reachable. Any
consumer must check `panel.version === 1`.

**`mountWorkbench(ctx, wb, panel)` makes five `wb.register*` calls**, each inside a `ctx.effect`:

| Registration | id | Notes |
|---|---|---|
| Panel | `dock-flash:quick-control` | region `sideBar`, order 50 |
| Plugin | `dock-flash` | settings card |
| Activity bar item | `dock-flash:quick-control` | `pluginId: 'dock-flash'` |
| Editor view | `dock-flash:quick-control` | |
| Command | `dock-flash:openQuickControl` | |

The panel is wrapped as `h(panel.ErrorBoundary, null, h(panel.Panel, props))`, because dock-base's
`WorkbenchRoot` has **no error boundary** of its own.

**The claim handshake is per-mount and asymmetric.** `panel.host.claim()` is called once per mount and its
lease `confirm()`ed. The per-mount disposer (`mountWorkbench`'s return value) calls `panel.host.releaseOne()`
and must **NEVER** call `panel.host.release()`: `release()` is the WHOLE-host release, reserved for the
dock-hidden detach path (`_syncDockHidden`), and calling it from a per-mount disposer broke the two-mount
case by pulling the panel out from under the second mount.

**Behaviour when dock-base is absent.** `_dockBaseInstalled(ctx)` checks `window.__DSH_BOOT__.entries` (ids
`dock-base` / `dock-base/client`) and then `ctx.get('modules').graphRows`. If the base is installed but
`ctx.get('workbench')` is not up yet, wait for it via `ctx.inject(['workbench'], scope => …)` instead of
bailing out.

**What the core publishes** — the adapter consumes it and registers nothing for the core:

```js
dockFlashPanel = {
  version: 1, Panel, ErrorBoundary, Header, icon, registry,
  i18n: { t, L },
  host: { claim, release, releaseOne, isClaimed },
}
```

## Upgrade hazard: the `^2` profile's panel row

After the split the core's specifier changed from `dock-flash` to `dsh-flash`, but a `^2` profile's
`cordis.patch.yml` panel entry is still `- id: dock-flash` / `name: dock-flash`. Because a patch `name:` is
an **assertion**, DSH prints:

```
patch: name mismatch for "dock-flash" (expected "dsh-flash", got "dock-flash"), skipping
```

and DROPS the entire `config:` block — silently reverting panel order, skin and trigger settings. **The fix
is to change that entry's `name:` to `dsh-flash` and KEEP `id: dock-flash`.**

Related: DSH applies layers in the order **bundle, profile, home, CLI**. For a non-`insert` patch the profile
layer is applied last, so it wins.

## Verification

```sh
pnpm run check:docs                     # node scripts/check-docs-size.mjs
node scripts/check-adapter-mount.mjs    # aka pnpm run check:overlay
```

`check-adapter-mount.mjs` reads the **REAL** `lib/client.js`, evaluates it in a `node:vm` sandbox with a tiny
fake DOM and a fake cordis `ctx`, and asserts **41 things across 8 groups**:

1. module id/name;
2. the loud watchdog naming both `dockFlashPanel` and `dsh-flash` at exactly 2000 ms;
3. the happy path's five exact registration ids;
4. the per-mount teardown calling `releaseOne` once and `release` **ZERO** times;
5. dock-base absent;
6. a late `workbench`;
7. `version !== 1` refusal;
8. the dock-hidden detach.

**Its limits, honestly:** the `Panel` / `ErrorBoundary` / `Header` / `registry` stubs are inert, so rendering
is untested; `document.querySelector` returns `null`, so the sidebar-title patch body does not run; and the
`effect` stub never auto-runs cleanups.

**Prove the harness can fail:** flip `mountWorkbench`'s final `return releaseOne` to `return panel.host.release`,
watch group 4 fail, restore.

## Publishing & repository sync

- **Gitee is authoritative** — `https://gitee.com/lenin.guo/dock-flash.git`. **GitHub (`tcgbp/dock-flash`) is a
  mirror**, driven by `.github/workflows/sync-from-gitee.yml` (hourly cron + `workflow_dispatch`). No `github`
  remote is configured.
- **Never re-enable Gitee's push mirror.**
- **`github.com` being unreachable is not the mirror being broken.** API dispatch on `api.github.com` works
  when `github.com` git does not.
- **npm is a SECOND, independent channel that nothing keeps in step.** dsh-market prefers a package's npm name
  over its Release tarball. npm 11.16 **STAGES** a bypass-2FA publish rather than publishing it, and its
  packument is CDN-cached, so both "it failed" and "it worked" are easy to misread.

The procedure — remotes, the mirror workflow, the staging symptoms, and how to verify a publish landed — is in
**[docs/releasing.md](docs/releasing.md)**.

### Releasing needs the maintainer's confirmation — twice

**Never cut a release on your own initiative.** Two gates, each the maintainer's decision:

1. **Before bumping the version** — stop and ask. A finished change with passing checks is **not** approval.
   State the version you would choose and why, then wait.
2. **Before tagging, pushing, or publishing** — ask again. Gate 1's approval does not carry over.

Until gate 1 is answered, `package.json` and `CLIENT_VERSION` keep the **LAST RELEASED** version and no new
`CHANGELOG.md` row is written. **Never edit a version string opportunistically.**

### Which number moves

Increment by what a third party can observe: **patch** for a bug fix, refactor, docs or metadata; **minor**
for a new switch, field, type, service or event; **major** for removing or renaming anything published.
**Never renumber a released version** — a published tag cannot be recalled. For THIS package the number that
moved was **3.0.0**, the split.

### Commit as you go

**Commit each finished change on its own — never batch a verified change with the next one.** Commits, not
releases: the two gates above still stand.

## Known Dependencies

| Package | Type | Purpose | Notes |
|---|---|---|---|
| `dsh-flash` `^1.0.0` | dependency | The panel core (another repository) | Plain dependency; supplies `dockFlashPanel` |
| `dock-base` | peer | `ctx.workbench` registry services | **NON-optional** — no `peerDependenciesMeta` |
| `@deepseek-ai/cordis` `>=4.0.0-rc.1 <5.0.0-0 \|\| >=4.0.1-0 <5.0.0-0` | peer | Plugin framework | Required |

> The peer range carries an explicit prerelease branch **on purpose**, so prerelease harness builds resolve.
> See [docs/architecture-notes.md](docs/architecture-notes.md).

## Common Pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| `"<pkg>/client"` in `dsh.client.inject` | Load-order hint silently ignored | Use base package names only |
| `inject: ['dockFlashPanel']` on the host plugin | A broken install looks like "not installed" (cordis skips `apply()`) | Keep `inject: []`; use `ctx.inject([...])` |
| Calling `panel.host.release()` from a per-mount disposer | A second mount loses its panel | Use `releaseOne()`; `release()` is the whole-host path |
| Reading `ctx.get('dockFlashPanel')` in the same tick as the `provide` | `undefined` from an asynchronous service | Pass the service explicitly to `mountDockPanelAdapter` |
| A non-`insert` patch with a stale `name:` | DSH drops the whole `config:` block | Update `name:` to the real package name, keep `id:` |
| `pnpm run <script>` | verify-deps-before-run tries to install the not-yet-published `dsh-flash` | Run `./node_modules/.bin/tsc -p tsconfig.json` / `node scripts/…` directly |

## Where else to read

- **[README.md](README.md)** / **[README.zh-CN.md](README.zh-CN.md)** — English is canonical; both must stay
  in sync; no changelog in them.
- **[CHANGELOG.md](CHANGELOG.md)** — the release-by-release history.
- **[docs/releasing.md](docs/releasing.md)** — the release runbook.
- **[docs/architecture-notes.md](docs/architecture-notes.md)** — the "why" and the measurements.
- **[INTEGRATION.md](INTEGRATION.md)** / **[INTEGRATION.zh-CN.md](INTEGRATION.zh-CN.md)** — the third-party
  integration guide.
