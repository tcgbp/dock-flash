# dock-flash — architecture notes

The reasoning behind decisions that `AGENTS.md` states as rules. Read this when you are about to
change one of those areas and want to know what was already tried, and why the current shape is not
arbitrary. **`AGENTS.md` remains the authoritative form for every rule** — if the two ever disagree,
`AGENTS.md` wins and this file is what needs fixing.

> **Scope, after the core/adapter split.** This file used to be the whole project's notebook, and for
> a while after the split it stayed that way — which made it the most misleading file in the
> repository. It described the panel core's skin system, the standalone ⚡ trigger's placement, the
> proxy subsystem, the alert surfaces, the quickControl registry and the context monitor. **None of
> that code is in this package.** It is in `dsh-flash`, in another repository, and that repository
> keeps its own `docs/architecture-notes.md` — which is *ahead* of the copies that were left here
> (it has already recorded deletions this file still describes as live code).
>
> What is left below is only what this adapter owns: the peer range in `package.json`, and the
> pitfalls whose mechanism is in `lib/client.js` or in this repository's files. If you came here
> looking for a panel feature, it is not here; go to the core repository.

---

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

**The trap specific to THIS package:** a `@deepseek-ai/dsh*` peer is never matched against the named
package's version at all. `evaluatePluginCompatibility()` compares it to `getDshRuntimeVersion()` —
DSH's own runtime version, read from app-boot's `package.json` — so the range above is the shape for
`@deepseek-ai/cordis` and is useless for a DSH platform package. See the pitfall row below; that
mismatch disabled the whole row on every DSH ≥ 0.2.0-0 and is the single worst defect this package
has shipped.

---

### "The fix did not work" and "the browser has the old code" are the same symptom

`lib/client.js` is symlinked into the profile, so an edit is on disk before the page reloads — but
what the browser runs is the bundle the **server** composed at its own start time. The decisive
measurement is not in the browser at all: compare `lib/client.js`'s mtime against the DSH server's
`StartTime`. When the file is newer than the server, the served snapshot predates every fix you are
testing, and no amount of reloading changes that.

This is also why `CLIENT_VERSION` is a single constant and `check:docs` fails when it disagrees with
`package.json`: a build that cannot name itself cannot be told from the previous one.

**Restart, not refresh, for anything in `package.json`** — see the manifest pitfall below.

---

## Common pitfalls, in full

`AGENTS.md` keeps a short index of these; the full table lives here because the rules there are one
line each and the symptom that produced them is not guessable. Read this when a symptom looks
familiar.

| Pitfall | Symptom | Fix |
|---|---|---|
| Reading a service as a `ctx.<name>` **property** | The mount aborts partway: the ⚡ stays, the sidebar panel and the Flash card never appear, and the console goes **silent** right after `workbench mode — dock-base detected`. No red line. | A cordis context is `Proxy(this, ReflectService.handler)` and its `get` trap `throw`s `cannot get property "x" without inject` for anything the plugin did not declare in `inject`. Resolve with `ctx.get('name')`, which returns `undefined` instead. **`typeof ctx.<name>` does not help** — `typeof` evaluates the getter, so it throws too; `'name' in ctx` is the only safe property form (the `has` trap just does a map lookup). Measured against cordis 4.0.4 with `inject: []`: `ctx.locale`, `typeof ctx.locale` both throw whether or not the service exists; `ctx.get('locale')` never throws. The adapter reads the locale service only through `ctx.get`, inside a `try`. |
| A `@deepseek-ai/dsh*` **peerDependency** on this package | The row is **disabled at boot**: panel gone, GUI banner *"dock-flash is incompatible with DSH 0.2.0-rc.2 (requires … ^0.1.1-rc.2)"*. Every other dock icon is present, so it reads as "one panel broke" rather than "one manifest line is wrong". | Delete the peer; declare the name in `dsh.client.inject` and reach the service with `ctx.get(...)`. `evaluatePluginCompatibility()` runs inside `preflight()`, which sets `row.disabled = true` — so **a browser refresh verifies nothing**: the disabled row survives until the process restarts. That also means a manifest *break* can be tested past for a whole session. Read the banner as "delete this peer", never as "bump this version": no range satisfies a peer compared against DSH's own version. `dock-base` and `@deepseek-ai/cordis` are exempt (neither is `@deepseek-ai/dsh*`) and stay peers. If such a peer is ever unavoidable, verify the candidate with DSH's `evaluatePluginCompatibility()`, not raw `semver.satisfies` — they disagree (bare semver rejects `>=0.1.1-rc.2 <1.0.0-0` against `0.2.0-rc.2`; DSH accepts it). |
| `"<pkg>/client"` in `dsh.client.inject` | Load-order hint silently ignored: wrong load order, or a service that never arrives before the mount | `arriveGraphRow()` does not strip `/client` for inject lookups, while graph-row keys are base names. Use base package names only — `AGENTS.md` keeps the current list, do not restate it here. |
| `registerActivityBarItem()` without `pluginId` | Listed in Settings but no "Open" button | `pluginEntryItem()` matches `pluginId ?? id`, and the fallback is `'dock-flash:quick-control'`, which never equals the plugin id `'dock-flash'`. Pass `pluginId: 'dock-flash'`. |
| `L('key')` (a function) for `registerPlugin` title/description | Plugin card shows a blank name and description | dock-base's `createPluginCard` renders those as React children and never calls `resolveSettingText()`. Unlike `registerPanel` / `registerActivityBarItem`, `registerPlugin` needs **static strings** — so the card's description is read once from the active locale at mount and does not follow a live language switch. |
| A harness fixture whose accessors **throw** | A green run that proved nothing, or a run that dies before the summary | The committed harness must turn a broken bundle into FAILs, never into a `TypeError`: `firstArg`/`prop`/`fire`/`fireSetting`/`timers.fire` all degrade to `undefined`/`false`. A throw partway through skips every later section **and the summary** — a truncated run with no FAIL naming the cause is how the property-read defect above survived a green harness. The `ctx` stub stays a **Proxy** for the opposite reason: a plain object cannot express the property-read defect at all. Both properties are load-bearing. |
| Running the GraphFlow installer in this repo | `AGENTS.md` replaced by GraphFlow's own "for Claude Code" notes | It writes `AGENTS.md` unconditionally. `git checkout -- AGENTS.md`, keep those notes in `CLAUDE.md`, verify with `grep -c dock-flash AGENTS.md` (healthy: dozens, clobbered: 0). |
| Hardcoding an environment-specific endpoint | An internal address published in the public repository | Make it a setting; keep built-in presets generic. Recovery needs `git filter-branch` **and** platform-side repository deletion — force-push only moves refs, and the old commits stay fetchable by SHA. |
