// dock-flash — HOST half of the dock-base adapter.
//
// This package is almost entirely client-side. The dock workbench runs in the
// browser and every registration this adapter makes happens through
// `ctx.workbench` in `lib/client.js`; there is no host-side service, no
// settings namespace and no HTTP route here. Those belong to the panel core
// (`dsh-flash`), which owns the `dock-flash` entry id and therefore the
// `dock-flash` settings namespace and the `/plugins/dock-flash/…` routes, so
// every preference a user already has keeps working across the split.
//
// The host half exists for exactly one reason: a client bundle is attached to
// the profile row that composes it. DSH discovers `lib/client.js` from
// `exports["./client"]` + `dsh.client` for a *composed row*, so a package with
// no host entry point has no row to hang its browser half on. `apply` is
// therefore deliberately empty — the adapter's entire behaviour is the client
// bundle — and this file must stay published in `package.json` (`main`) and in
// the patch row, or the adapter silently stops being loaded at all.

// NOT `dock-flash`: that name belongs to the core's host plugin, which owns the
// settings namespace. This half is identified by its own row id
// (`cordis.patch.yml` inserts it as `dock-flash-adapter`) so the two are
// distinguishable in cordis logs and in a plugin registry keyed by name.
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dock-flash-adapter'

// No host-side service dependencies. The adapter's only dependencies are
// client-side and are declared in `dsh.client.inject` and resolved in the
// browser.
export const inject: string[] = []

export function apply(_ctx: Context): void {
  // Intentionally empty. Everything this package does is in `lib/client.js`.
}
