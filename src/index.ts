// dock-flash — HOST half of a dock feature plugin.
//
// This plugin is primarily client-side: the dock workbench runs in the
// browser and all UI interaction happens through ctx.workbench. The host
// half therefore only needs minimal plumbing.
//
// Host-side responsibilities:
// - Registers the 'dock-flash' settings namespace so the client can
//   persist the proxy-mode and test-URL selections via ctx.remote.settings.
// - Watches the 'proxyMode' setting and re-installs the undici global
//   dispatcher via @deepseek-ai/dsh-http-proxy so outbound requests respect
//   the user's NO_PROXY choice.
// - Exposes HTTP routes for the client to query proxy status and test
//   the connection (improvements #4, #5, #6).
// - Owns the *test target* (testUrl) and runs the diagnostic connectivity
//   probe: redirect chain, response headers, body size/snippet, proxy route
//   decision, and the underlying socket error code (cause.code).
//
// This half is ESM (`"type": "module"`, and DSH's own entry is ESM too), so
// `require` does not exist here. Everything that used to be a lazy `require()`
// in a try/catch now either imports statically or goes through
// `loadProxyModule()` — see that function for why the second case is subtle.
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-settings'

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Volatile } from '@deepseek-ai/cordis'
// Default export only (`export default Schema`); there is no named `Schema`.
import Schema from '@deepseek-ai/schemastery'

export const name = 'dock-flash'

// No host-side service dependencies; all services are injected lazily.
export const inject: string[] = []

/** Resolved volatile config — each field is a live reference read with .get(). */
export interface ProxyConfig {
  /**
   * Proxy mode — determines how NO_PROXY is set:
   * - 'all-proxy':  NO_PROXY cleared → all traffic uses proxy
   * - 'api-bypass': NO_PROXY = API_BYPASS_DOMAINS → API calls bypass proxy
   * - 'all-bypass': NO_PROXY = '*' → all traffic bypasses proxy
   * - 'custom':     NO_PROXY = customNoProxy value
   */
  proxyMode: Volatile<string>
  /** Custom NO_PROXY value, used only when proxyMode is 'custom'. */
  customNoProxy: Volatile<string>
  /**
   * URL the connection test fetches from the host side.
   *
   * Deliberately a setting and not a constant: the maintainer's real target is
   * an internal host, and hardcoding it published internal infrastructure
   * details in this public repository. Users point this at whatever address
   * actually proves their proxy works.
   */
  testUrl: Volatile<string>
  /** @deprecated Legacy boolean — migrated to proxyMode on first load. */
  useProxy?: Volatile<boolean>
  /**
   * The panel's group and switch order, as the client persists it.
   *
   * A user preference, not a browser preference: it survives a different
   * browser, a cleared cache and a second machine, because it lives in
   * settings.yaml next to proxyMode rather than in localStorage. Shape mirrors
   * the client's `dock-flash:panel-order` value exactly — `builtin` and `ext`
   * hold group keys, `switches` maps a scope-qualified group key to its unit
   * keys.
   */
  panelOrder: Volatile<PanelOrder>
  /** Selected skin id, or '' for none. */
  activeSkin: Volatile<string>
  /** ⚡ trigger slot for standalone mode; validated against the client's list. */
  triggerPosition: Volatile<string>
  /**
   * Where the draggable overlay trigger sits, as an OFFSET from the
   * conversation viewport's top-right corner rather than absolute screen
   * coordinates — so opening the right sidebar, dragging the sash or resizing
   * the window carries the button along with the corner instead of leaving it
   * behind. Both components measure inward, so a larger value moves it further
   * from that corner.
   *
   * Only meaningful while `triggerPosition` names the overlay entry, but never
   * cleared when it does not: switching away and back must not lose the place
   * the user chose.
   */
  triggerOverlayOffset: Volatile<TriggerOverlayOffset>
  /**
   * Edge length of the standalone trigger button, in px.
   *
   * Client-owned, like the three preferences above: the host stores it and
   * never interprets it, because the legal RANGE is the client's — it depends
   * on which trigger position is selected (a slot button must fit the input
   * row, the draggable overlay may be larger). Pinning it to a min/max here
   * would make a stored preference un-writable the moment the client's range
   * changes, which is the 1.1.0 lesson this namespace already records for
   * `activeSkin` and `triggerPosition`.
   */
  triggerSize: Volatile<number>
  /**
   * Stacking level for the standalone trigger button and its floating panel.
   *
   * Client-owned and deliberately just a number: the SENSIBLE range is a
   * property of the host UI it sits among, not of this plugin, so the client
   * offers presets and the host neither clamps nor interprets. See
   * `DEFAULT_TRIGGER_LAYER` in the client for why the default is not the
   * 9999x this used to hardcode.
   *
   * Only the standalone pair is affected. The workbench panel's own
   * `z-index: 10` is bounded on purpose (below dock-base's floating layer), and
   * raising it from here would invert dock-base's precedence.
   */
  triggerLayer: Volatile<number>
  /**
   * Opacity of the draggable overlay trigger at rest (1 = fully solid).
   *
   * The overlay floats over the conversation rather than in a toolbar, so it
   * starts faint and goes solid on approach; this is how faint. Stored rather
   * than fixed because how much it competes with the text behind it is a
   * reading preference.
   */
  overlayOpacity: Volatile<number>

  // ── Alert thresholds and intervals ────────────────────────────────────────
  // All thresholds are stored as percentages (0–100); the client divides by
  // 100 to obtain the ratio used in comparisons. Poll intervals are in ms.

  /** Memory alert: info threshold (% of V8 heap). */
  memThresholdInfo: Volatile<number>
  /** Memory alert: warning threshold (% of V8 heap). */
  memThresholdWarning: Volatile<number>
  /** Memory alert: error threshold (% of V8 heap). */
  memThresholdError: Volatile<number>
  /** Memory polling: base interval (ms). */
  memPollBase: Volatile<number>
  /** Memory polling: minimum interval (ms). */
  memPollMin: Volatile<number>

  /** Context estimate: approximate token window. */
  ctxApproxWindow: Volatile<number>
  /** Context estimate: tokens per conversation message. */
  ctxTokensPerMsg: Volatile<number>
  /** Context alert: info threshold (% of estimated window). */
  ctxThresholdInfo: Volatile<number>
  /** Context alert: warning threshold (% of estimated window). */
  ctxThresholdWarning: Volatile<number>
  /** Context alert: error threshold (% of estimated window). */
  ctxThresholdError: Volatile<number>
  /** Context polling: base interval (ms). */
  ctxPollBase: Volatile<number>
  /** Context polling: minimum interval (ms). */
  ctxPollMin: Volatile<number>

  /** Host alert queue: maximum entries. */
  hostAlertQueueCap: Volatile<number>
  /** Host alert queue: maximum retention (hours). */
  hostAlertMaxAge: Volatile<number>
}

/** Offset of the draggable overlay trigger from the conversation's top-right corner. */
export interface TriggerOverlayOffset {
  dx: number
  dy: number
}

/** Ordered keys the client reorders groups and switches with. */
export interface PanelOrder {
  builtin: string[]
  ext: string[]
  switches: Record<string, string[]>
  /**
   * Unit keys the user has hidden, per scope-qualified group key — the same
   * addressing as `switches`, because a hidden thing is still an ORDERED thing
   * that merely is not drawn.
   *
   * Kept separate from the order on purpose: the two are independent user
   * intents, so the reorder reset must not restore visibility and the
   * visibility reset must not restore order. An empty list is the default, so
   * a newly installed plugin is visible without any action.
   */
  hidden: Record<string, string[]>
}

const DEFAULT_MODE = 'all-proxy'
const DEFAULT_CUSTOM = ''

/** A cluster folded state is deliberately *not* here: it is a session toggle. */
const DEFAULT_PANEL_ORDER: PanelOrder = { builtin: [], ext: [], switches: {}, hidden: {} }
const DEFAULT_ACTIVE_SKIN = ''
const DEFAULT_TRIGGER_POSITION = 'input.right'
/** Matches the client's OVERLAY_EDGE: 8px inside the conversation's corner. */
const DEFAULT_TRIGGER_OVERLAY_OFFSET: TriggerOverlayOffset = { dx: 8, dy: 8 }
/**
 * Matches the client's TRIGGER_SIZE_MIN — which is also its default and the
 * size every release up to 1.3.x shipped. The minimum and the default being the
 * same number is deliberate: the control can only make the button LARGER, so an
 * upgrade changes nothing until the user asks, and there is no way to shrink
 * the entry point down to something hard to hit.
 */
const DEFAULT_TRIGGER_SIZE = 24
/**
 * Matches the client's DEFAULT_TRIGGER_LAYER.
 *
 * The client used to hardcode 99997-99999 for the standalone button and panel.
 * Measured against DSH's own client bundles, the HIGHEST z-index DSH uses
 * anywhere is 1100 (`dsh-client-ui-chat`, `dsh-client-ui-model-selection`), with
 * settings and attachment popovers at 1000 — so those values sat ~90x above the
 * host UI and covered every popover in it. 1150 clears DSH's ceiling while
 * staying in the same order of magnitude, which is the whole point.
 */
const DEFAULT_TRIGGER_LAYER = 1150
/** Matches the client's DEFAULT_OVERLAY_OPACITY — what 0.55 always was. */
const DEFAULT_OVERLAY_OPACITY = 0.55

// ── Alert threshold defaults ──────────────────────────────────────────────
// Stored as percentages (0–100) for user-friendliness; providers divide by
// 100 internally to obtain the ratio used in comparisons.

/** Memory alert thresholds (% of V8 heap). */
const DEFAULT_MEM_THRESHOLD_INFO = 80
const DEFAULT_MEM_THRESHOLD_WARNING = 90
const DEFAULT_MEM_THRESHOLD_ERROR = 95
/** Memory polling: base interval and minimum (ms). */
const DEFAULT_MEM_POLL_BASE = 30000
const DEFAULT_MEM_POLL_MIN = 2000

/** Context window approximation (tokens). */
const DEFAULT_CTX_APPROX_WINDOW = 128000
/** Estimated tokens per conversation message. */
const DEFAULT_CTX_TOKENS_PER_MSG = 200
/** Context alert thresholds (% of estimated window). */
const DEFAULT_CTX_THRESHOLD_INFO = 70
const DEFAULT_CTX_THRESHOLD_WARNING = 85
const DEFAULT_CTX_THRESHOLD_ERROR = 95
/** Context polling: base interval and minimum (ms). */
const DEFAULT_CTX_POLL_BASE = 20000
const DEFAULT_CTX_POLL_MIN = 2000

/** Host alert queue capacity (max entries). */
const DEFAULT_HOST_ALERT_QUEUE_CAP = 50
/** Host alert maximum retention time (hours). */
const DEFAULT_HOST_ALERT_MAX_AGE = 24

/**
 * Default test target: the canonical "is there a working network path"
 * endpoint. Returns an empty 204, so it measures the path and nothing else —
 * and it is unreachable without a working proxy on networks that need one,
 * which is exactly the signal the test is meant to produce.
 */
const DEFAULT_TEST_URL = 'https://www.google.com/generate_204'

/** Hard ceiling on a single test; also reported in the diagnostics payload. */
const TEST_TIMEOUT_MS = 10000

/** Redirect hops followed before giving up (the chain is reported either way). */
const MAX_REDIRECTS = 5

/** Bytes of response body echoed back for inspection. */
const BODY_SNIPPET_LIMIT = 200

/**
 * `dict`'s arguments are (value, key) — value schema first, contrary to how
 * the call reads. Nested objects need `.default()` at every level: a
 * property whose schema resolves to `undefined` fails the whole thing with
 * `unsupported type "undefined"`, which surfaced while building this.
 */
const PanelOrderSchema = Schema.object({
  builtin: Schema.array(Schema.string()).default([]),
  ext: Schema.array(Schema.string()).default([]),
  switches: Schema.dict(
    Schema.array(Schema.string()),
    Schema.string(),
  ).default({}),
  hidden: Schema.dict(
    Schema.array(Schema.string()),
    Schema.string(),
  ).default({}),
}).default(DEFAULT_PANEL_ORDER)

/**
 * The plugin's `Config` schema — the host's composition defaults, exported so
 * the Cordis loader publishes it as `runtime.Config`.
 *
 * This is not a cosmetic nicety. dsh-settings resolves a namespace's editable
 * form from `entry.fiber.runtime.Config` (its `schema(entry)` reads exactly
 * that), so a plugin without an exported `Config` is NOT configurable by the
 * native configuration editor — and a client preference write through
 * `settings.update('dock-flash', …)` is refused with `No configurable plugin
 * entry "dock-flash"`.
 *
 * Every field is marked `.volatile()`: live-editable without plugin restart.
 * The settings configuration editor only shows volatile fields; ordinary
 * (non-volatile) config requires a Cordis configuration file edit and a
 * restart. Since all dock-flash settings are user preferences the client
 * writes through `ctx.remote.settings`, they must all be volatile.
 */
export const Config = Schema.object({
  // ── B · System proxy ──────────────────────────────────────────────────
  // Proxy fields are read by the client via GET /proxy-status (not through
  // _hostPrefs), and written via _queuePrefWrite with B-specific field sets.
  // Physical package splitting would move these into dsh-proxy's own namespace.
  proxyMode: Schema.string().default(DEFAULT_MODE).volatile(),
  customNoProxy: Schema.string().default(DEFAULT_CUSTOM).volatile(),
  testUrl: Schema.string().default(DEFAULT_TEST_URL).volatile(),
  // Keep the old field so legacy clients don't break; migrated on read.
  useProxy: Schema.boolean().default(true).volatile(),

  // ── A · QuickControl panel / preference bridge ────────────────────────
  // Client-owned preferences. The host stores them and never interprets
  // them, so they are typed loosely on purpose: `activeSkin` names a skin
  // that may not be installed on this machine, and `triggerPosition` names
  // a slot the client validates against its own TRIGGER_POSITIONS list.
  // Pinning either to an enum here would make a stored preference
  // un-writable the moment the client's lists change.
  panelOrder: PanelOrderSchema.volatile(),
  activeSkin: Schema.string().default(DEFAULT_ACTIVE_SKIN).volatile(),
  triggerPosition: Schema.string().default(DEFAULT_TRIGGER_POSITION).volatile(),
  // Every level of a nested object needs `.default()`, or the whole resolve
  // fails with `unsupported type "undefined"` — both the object and each
  // number, which is the trap that cost a round in 1.1.0.
  triggerOverlayOffset: Schema.object({
    dx: Schema.number().default(DEFAULT_TRIGGER_OVERLAY_OFFSET.dx),
    dy: Schema.number().default(DEFAULT_TRIGGER_OVERLAY_OFFSET.dy),
  }).default(DEFAULT_TRIGGER_OVERLAY_OFFSET).volatile(),
  // No min/max on purpose — see the field's comment: the range belongs to
  // the client, and it moves with the selected trigger position.
  triggerSize: Schema.number().default(DEFAULT_TRIGGER_SIZE).volatile(),
  // Both are client-owned presets the host never interprets: the sensible
  // range depends on the host UI they sit among, and clamping them here
  // would make a stored value un-writable the moment the client's preset
  // list changes (the 1.1.0 lesson this namespace already records).
  triggerLayer: Schema.number().default(DEFAULT_TRIGGER_LAYER).volatile(),
  overlayOpacity: Schema.number().default(DEFAULT_OVERLAY_OPACITY).volatile(),

  // ── D · System alerts (merged with A per §7 decision) ────────────────
  // Alert thresholds — percentages (0–100) for thresholds, ms for intervals.
  // When physical splitting occurs, these stay in dock-flash alongside A.
  memThresholdInfo: Schema.number().default(DEFAULT_MEM_THRESHOLD_INFO).volatile(),
  memThresholdWarning: Schema.number().default(DEFAULT_MEM_THRESHOLD_WARNING).volatile(),
  memThresholdError: Schema.number().default(DEFAULT_MEM_THRESHOLD_ERROR).volatile(),
  memPollBase: Schema.number().default(DEFAULT_MEM_POLL_BASE).volatile(),
  memPollMin: Schema.number().default(DEFAULT_MEM_POLL_MIN).volatile(),
  ctxApproxWindow: Schema.number().default(DEFAULT_CTX_APPROX_WINDOW).volatile(),
  ctxTokensPerMsg: Schema.number().default(DEFAULT_CTX_TOKENS_PER_MSG).volatile(),
  ctxThresholdInfo: Schema.number().default(DEFAULT_CTX_THRESHOLD_INFO).volatile(),
  ctxThresholdWarning: Schema.number().default(DEFAULT_CTX_THRESHOLD_WARNING).volatile(),
  ctxThresholdError: Schema.number().default(DEFAULT_CTX_THRESHOLD_ERROR).volatile(),
  ctxPollBase: Schema.number().default(DEFAULT_CTX_POLL_BASE).volatile(),
  ctxPollMin: Schema.number().default(DEFAULT_CTX_POLL_MIN).volatile(),
  hostAlertQueueCap: Schema.number().default(DEFAULT_HOST_ALERT_QUEUE_CAP).volatile(),
  hostAlertMaxAge: Schema.number().default(DEFAULT_HOST_ALERT_MAX_AGE).volatile(),


})

/** Domains that bypass the proxy when proxyMode is 'api-bypass'. */
const API_BYPASS_DOMAINS = 'api.deepseek.com,chat.deepseek.com'

/** Map a proxyMode (+ optional customNoProxy) to the actual NO_PROXY value. */
function resolveNoProxy(mode: string, custom: string): string | undefined {
  switch (mode) {
    case 'all-proxy':  return undefined   // no bypass → all traffic proxied
    case 'api-bypass': return API_BYPASS_DOMAINS
    case 'all-bypass': return '*'
    case 'custom': {
      // The only user-supplied value here. A blank one means "no bypass
      // entries", i.e. the same routing as `all-proxy` — so clear the variable
      // rather than publishing `NO_PROXY=''`, which would leave a set-but-empty
      // variable in the environment for spawned children to read. (Routing is
      // identical either way: dsh-http-proxy's parser drops empty entries.)
      const value = (custom || '').trim()
      return value === '' ? undefined : value
    }
    default:           return undefined
  }
}

/**
 * The ctx service DSH publishes with the launch-environment snapshot it
 * resolved the boot-time proxy policy from. That snapshot merges three layers
 * (`process` | `project-env` | `user-env`) and structurally satisfies the
 * `EnvLookup` this plugin hands back to dsh-http-proxy.
 */
const LAUNCH_ENVIRONMENT_SERVICE = 'launchEnvironment'

/** The slice of @deepseek-ai/dsh-http-proxy this plugin uses. */
interface ProxyModule {
  installProxyFromEnvironment(
    env: EnvLookup,
    report: (message: string) => void,
  ): Promise<() => Promise<void>>
  proxyRouteFor(url: URL): { proxied?: boolean; proxy?: string } | undefined
}

/** The one thing policy resolution needs from an environment. */
interface EnvLookup {
  get(name: string): { readonly value: string } | undefined
}

/**
 * Disposer for the dispatcher this plugin installed.
 *
 * `installProxyFromEnvironment` returns one and restores both the global
 * dispatcher and the module's policy state. Dropping it — as this code used to
 * — leaks one ProxyAgent and its whole socket pool per mode change.
 */
let _disposeProxyPolicy: (() => Promise<void>) | null = null

/**
 * The last `(mode, custom)` pair this plugin actually applied, joined by a NUL
 * so `("a","b\0c")` cannot collide with `("a\0b","c")`.
 *
 * Two paths can reach `applyProxyEnv`: the initial startup apply below and the
 * `loader/volatile-update` handler after a settings edit. Both are async — each
 * suspends on `await loadProxyModule()` *before* it touches
 * `_disposeProxyPolicy` — so without a guard the later caller would overwrite
 * the field and the earlier disposer would be dropped, leaking one ProxyAgent
 * and its socket pool. The duplicate would also log the pair twice, so the
 * proxy log could no longer distinguish a real mode switch from startup noise.
 *
 * The guard is assigned before the first `await` on purpose — that is what
 * makes the second caller in the same tick a no-op — and cleared again on the
 * paths that do not end in an install, so a transient failure still retries.
 */
let _appliedProxyKey: string | null = null

let _proxyModulePromise: Promise<ProxyModule | null> | null = null

/**
 * Load @deepseek-ai/dsh-http-proxy, once, from the instance DSH itself uses.
 *
 * Two traps live here, and both previously made the entire proxy feature a
 * silent no-op:
 *
 * 1. `require` does not exist. This half is ESM, so every `require(...)` threw
 *    `ReferenceError: require is not defined` into a surrounding try/catch —
 *    which is why the failure only ever surfaced as a stray string in the
 *    client's diagnostics.
 * 2. The package is not resolvable from here at all. It ships nested inside the
 *    DSH installation (`<dsh>/node_modules/@deepseek-ai/dsh-http-proxy`) and is
 *    not a dependency of this plugin.
 *
 * Resolving it is not merely convenience. The module keeps the resolved policy
 * in *module-level* state (`active`/`installed`) that only
 * `installProxyFromEnvironment` writes, and `proxyRouteFor` reads. A second
 * copy of the module would therefore answer "direct" for every URL forever,
 * while also installing a dispatcher that DSH's own `proxyRouteFor` cannot see.
 * So: one cached handle, resolved through DSH's own entry point, which is the
 * exact module instance DSH booted with.
 */
function loadProxyModule(): Promise<ProxyModule | null> {
  if (_proxyModulePromise) return _proxyModulePromise
  _proxyModulePromise = (async () => {
    // Widened to `string` on purpose: a literal would make TypeScript try to
    // resolve a package that is deliberately not a dependency of this plugin.
    const specifier: string = '@deepseek-ai/dsh-http-proxy'

    // Preferred: an ordinary resolution, for any setup that installs it for us.
    try {
      return (await import(specifier)) as unknown as ProxyModule
    } catch (_) { /* fall through to DSH's own copy */ }

    const entry = process.argv[1]
    if (!entry) {
      console.warn('[dock-flash] cannot locate the DSH entry point; proxy control unavailable')
      return null
    }
    try {
      const resolved = createRequire(entry).resolve(specifier)
      console.log('[dock-flash] dsh-http-proxy resolved to ' + resolved)
      return (await import(pathToFileURL(resolved).href)) as unknown as ProxyModule
    } catch (e: any) {
      console.warn('[dock-flash] could not load ' + specifier + ': ' + (e?.message || e))
      return null
    }
  })()
  return _proxyModulePromise
}


/** An EnvLookup over process.env — the fallback when no snapshot is provided. */
function processEnvLookup(): EnvLookup {
  return {
    get(name: string) {
      const value = process.env[name]
      return value !== undefined && value !== '' ? { value } : undefined
    },
  }
}

/** Send a JSON response with no-store cache control. */
function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Read an optional JSON request body, bounded so a client cannot feed the
 * host an unbounded buffer. Returns null for an empty, oversized, or
 * unparseable body — callers treat that as "no override supplied".
 */
async function readJsonBody(req: IncomingMessage, limit = 4096): Promise<any> {
  try {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req as any) {
      size += (chunk as Buffer).length
      if (size > limit) return null
      chunks.push(chunk as Buffer)
    }
    if (chunks.length === 0) return null
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (_) {
    return null
  }
}

export function apply(ctx: Context, config: ProxyConfig) {


  /** The launch-environment snapshot DSH resolved the boot-time policy from. */
  function launchEnvironment(): EnvLookup | null {
    try {
      const svc = ctx.get ? ctx.get(LAUNCH_ENVIRONMENT_SERVICE) : undefined
      return svc && typeof (svc as any).get === 'function' ? (svc as EnvLookup) : null
    } catch (_) {
      return null
    }
  }

  /**
   * Read a proxy variable the way the policy resolved it: the launch snapshot
   * first (it merges process / project-env / user-env), process.env as fallback.
   */
  function readProxyEnv(names: string[]): string | null {
    const snapshot = launchEnvironment()
    for (const name of names) {
      const fromSnapshot = snapshot ? snapshot.get(name) : undefined
      if (fromSnapshot && fromSnapshot.value) return fromSnapshot.value
      const raw = process.env[name]
      if (raw) return raw
    }
    return null
  }

  /**
   * The per-class proxy variables currently in force, read the same way the
   * policy does (launch snapshot first, process.env as fallback). Unlike the
   * single `httpProxy` field — which reports the *first* value found, mirroring
   * how undici falls back https→http — this keeps each family's value distinct,
   * so a UI can list HTTP_PROXY / HTTPS_PROXY / ALL_PROXY verbatim. `https`
   * checks HTTPS_PROXY first, then HTTP, matching dsh-http-proxy's fallback;
   * `http` and `all` are reported exactly as found.
   */
  function proxyEnvSummary(): {
    http: string | null
    https: string | null
    all: string | null
  } {
    return {
      // HTTPS falls back to the HTTP proxy when no HTTPS_PROXY is set — that is
      // an undici behaviour (https uses https_proxy, else http_proxy) and the
      // display should mirror what routing actually does.
      https: readProxyEnv(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
      http: readProxyEnv(['HTTP_PROXY', 'http_proxy']),
      all: readProxyEnv(['ALL_PROXY', 'all_proxy']),
    }
  }

  /**
   * Resolve the effective proxy mode, accounting for the legacy `useProxy`
   * migration: if `proxyMode` sits at its default but `useProxy` was explicitly
   * set, the old boolean takes over.
   */
  function resolveMode(): string {
    let mode = config.proxyMode.get() || DEFAULT_MODE
    if (!config.proxyMode.get() && typeof config.useProxy?.get() === 'boolean') {
      mode = config.useProxy!.get() ? 'all-proxy' : 'all-bypass'
    }
    return mode
  }

  /**
   * Publish the chosen bypass list and re-install the process-wide dispatcher.
   *
   * Writing `process.env.NO_PROXY` is necessary but nowhere near sufficient:
   * undici's global dispatcher routes by the `ProxyPolicy` object it was handed
   * at install time and never re-reads the environment, so only a re-install
   * changes actual routing. The environment write exists for the consumers that
   * *do* read it — spawned children, and `node:http`'s proxyEnv.
   */
  async function applyProxyEnv(mode: string, custom: string) {
    // Idempotence guard — see _appliedProxyKey. Set before any await so the
    // duplicate startup caller is a no-op rather than a racing second install.
    const key = mode + '\u0000' + custom
    if (key === _appliedProxyKey) return
    _appliedProxyKey = key

    const noProxy = resolveNoProxy(mode, custom)
    if (noProxy === undefined) {
      delete process.env.NO_PROXY
      delete process.env.no_proxy
    } else {
      process.env.NO_PROXY = noProxy
      process.env.no_proxy = noProxy
    }
    console.log('[dock-flash] proxy mode=' + mode + ' (NO_PROXY=' + (noProxy ?? '<removed>') + ')')

    const mod = await loadProxyModule()
    if (!mod) {
      _appliedProxyKey = null
      console.warn('[dock-flash] proxy module unavailable — routing is unchanged (the mode now affects child processes only)')
      return
    }

    // Base the policy on DSH's own snapshot so that nothing but the bypass list
    // changes. Resolving from process.env would silently disagree with the
    // policy DSH installed: its snapshot also merges the project-env and
    // user-env layers, which process.env knows nothing about.
    const snapshot = launchEnvironment()
    const base: EnvLookup = snapshot || processEnvLookup()
    const envLookup: EnvLookup = {
      get(name: string) {
        // undici reads the lowercase spelling first, so both are owned here.
        if (name === 'NO_PROXY' || name === 'no_proxy') {
          return noProxy === undefined ? undefined : { value: noProxy }
        }
        return base.get(name)
      },
    }

    try {
      // Release the previous install before taking a new one, otherwise every
      // mode change stacks another dispatcher on top of the last.
      if (_disposeProxyPolicy) {
        try { await _disposeProxyPolicy() } catch (_) { /* already released */ }
        _disposeProxyPolicy = null
      }
      _disposeProxyPolicy = await mod.installProxyFromEnvironment(envLookup, (message: string) => {
        console.warn('[dock-flash] proxy install warning: ' + message)
      })
      console.log('[dock-flash] undici global dispatcher re-installed (env source=' +
        (snapshot ? 'launchEnvironment' : 'process.env') + ')')
    } catch (e: any) {
      // Let the next change retry: nothing was installed, so nothing is in force.
      _appliedProxyKey = null
      console.warn('[dock-flash] could not re-install proxy dispatcher:', e?.message || e)
    }
  }

  /**
   * Ask dsh-http-proxy how it would route `url`.
   *
   * `proxyRouteFor` takes a `URL` object. Handed a string it does not throw — it
   * quietly answers "direct", which is how this plugin came to report 直连 for
   * every request it ever tested.
   */
  async function proxyRouteForUrl(url: string): Promise<{ proxied: boolean; error: string | null }> {
    const mod = await loadProxyModule()
    if (!mod) return { proxied: false, error: 'dsh-http-proxy is not loadable from this plugin' }
    try {
      return { proxied: mod.proxyRouteFor(new URL(url))?.proxied === true, error: null }
    } catch (e: any) {
      return { proxied: false, error: e?.message || String(e) }
    }
  }

  /**
   * Resolve the test target.
   *
   * An explicit `override` (from the request body) wins over the stored
   * setting, so the URL the client is displaying is exactly the URL probed —
   * no dependency on the settings write having landed first.
   */
  function resolveTestUrl(override?: unknown): string {
    const fromOverride = typeof override === 'string' ? override.trim() : ''
    const raw = fromOverride || String(config.testUrl.get() || '').trim()
    return raw || DEFAULT_TEST_URL
  }

  /**
   * How dsh-http-proxy would route `url`, plus the env it decides from.
   *
   * `probeRoute: false` is for callers that already rejected the URL: routing is
   * moot then, and reporting `routeError: "Invalid URL"` alongside the caller's
   * own `InvalidTestUrl` only prints the same message twice.
   */
  async function describeProxyRoute(url: string, probeRoute = true) {
    const mode = resolveMode()
    const custom = config.customNoProxy.get() || ''
    const route = probeRoute
      ? await proxyRouteForUrl(url)
      : { proxied: false, error: null }

    return {
      mode,
      // What this plugin published for the current mode: the value that governs
      // routing once the dispatcher has been re-installed.
      noProxy: resolveNoProxy(mode, custom) ?? null,
      httpProxy: readProxyEnv(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
      proxyEnv: proxyEnvSummary(),
      proxied: route.proxied,
      routeError: route.error,
    }
  }

  /**
   * Diagnose outbound connectivity to `url`.
   *
   * Two deliberate choices, both about *diagnosis* rather than connectivity:
   *
   * - `redirect: 'manual'` with a hand-rolled hop loop, so the redirect chain is
   *   recorded instead of silently followed. "302 to somewhere unreachable" is
   *   a different failure from "connection refused", and the old single-shot
   *   `redirect: 'follow'` made them indistinguishable.
   * - Never throws. Every failure is returned as data, because the caller has
   *   to render it either way, and the interesting part (`cause.code` — e.g.
   *   `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`, `DEPTH_ZERO_SELF_SIGNED_CERT`)
   *   only exists on the nested cause of undici's `TypeError: fetch failed`.
   */
  async function runConnectionTest(url: string) {
    const started = Date.now()
    const proxy = await describeProxyRoute(url)
    const redirects: Array<{ hop: number; from: string; status: number; to: string }> = []

    /** Assemble the payload so every exit path reports the same shape. */
    const report = (extra: Record<string, unknown>) => ({
      url,
      proxy,
      timeoutMs: TEST_TIMEOUT_MS,
      redirects,
      elapsedMs: Date.now() - started,
      ...extra,
    })

    let current = url
    let resp: any = null
    let redirectLimitHit = false

    try {
      for (let hop = 0; ; hop++) {
        resp = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        })
        const location = resp.headers.get('location')
        if (!(resp.status >= 300 && resp.status < 400 && location)) break
        let next = String(location)
        try { next = new URL(next, current).href } catch (_) { /* keep raw value */ }
        redirects.push({ hop: hop + 1, from: current, status: resp.status, to: next })
        if (hop >= MAX_REDIRECTS) { redirectLimitHit = true; break }
        current = next
      }
    } catch (e: any) {
      const cause = e?.cause
      return report({
        ok: false,
        finalUrl: current,
        headersMs: Date.now() - started,
        status: 0,
        statusText: '',
        contentType: '',
        contentLength: null,
        bodyMs: 0,
        bodyBytes: 0,
        bodySnippet: null,
        redirectLimitHit,
        error: {
          name: e?.name || 'Error',
          message: e?.message || String(e),
          code: e?.code || null,
          causeName: cause?.name || null,
          causeMessage: cause?.message || null,
          causeCode: cause?.code || null,
          causeErrno: cause?.errno ?? null,
        },
      })
    }

    const headersMs = Date.now() - started
    const contentType = resp.headers.get('content-type') || ''
    const contentLength = resp.headers.get('content-length') || null

    // Read the body too, so the timing covers the whole exchange and a proxy's
    // own "blocked" page can be inspected rather than guessed at.
    let bodyBytes = 0
    let bodySnippet: string | null = null
    const bodyStart = Date.now()
    try {
      const buf = Buffer.from(await resp.arrayBuffer())
      bodyBytes = buf.byteLength
      const textual = !contentType || /text|json|xml|javascript|html/i.test(contentType)
      if (buf.byteLength > 0 && textual) {
        bodySnippet = buf.toString('utf8', 0, Math.min(buf.byteLength, BODY_SNIPPET_LIMIT))
      }
    } catch (_) { /* body is optional — headers already prove the path */ }
    const bodyMs = Date.now() - bodyStart

    // Any HTTP response means the network path works — 401/404 included. The
    // status is reported verbatim so the caller can judge it.
    return report({
      ok: true,
      finalUrl: current,
      headersMs,
      status: resp.status,
      statusText: resp.statusText || '',
      contentType,
      contentLength,
      bodyMs,
      bodyBytes,
      bodySnippet,
      redirectLimitHit,
      error: null,
    })
  }

  // When the settings service is available, register the dock-flash
  // namespace's page policy. Volatile fields in the exported `Config` schema
  // are what make this plugin's settings editable without restart —
  // `settings.configure` tells the settings UI to show a form for this
  // instance; it does not register a schema (that is `Config`'s job).
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })

  // React to volatile config updates in-place. The loader's `_commitVolatile()`
  // updates the `Volatile<T>` references in `config` and then emits
  // `loader/volatile-update` with the paths that changed. Each subsystem
  // subscribes to ITS OWN paths only, so a change in one never walks another's
  // code path — this is the host-side decoupling of proxy (B) and
  // alerts (D): there is no one shared handler that drives both.

  // B · System proxy — re-apply the NO_PROXY policy + undici dispatcher.
  const relevant = (p: string[]) => p.length === 1
  ctx.on('loader/volatile-update' as any, (paths: string[][]) => {
    const proxyPaths = ['proxyMode', 'customNoProxy', 'useProxy']
    if (!paths.some((p) => relevant(p) && proxyPaths.includes(p[0]))) return
    try {
      const mode = resolveMode()
      applyProxyEnv(mode, config.customNoProxy.get() || '')
    } catch (e) {
      console.error('[dock-flash] failed to update proxy setting:', e)
    }
  })


  // D · System alerts — no reconfigure needed. Alert routes read
  // config.hostAlertQueueCap / hostAlertMaxAge via .get() at request time,
  // and client-side alert providers read _alertPref() at poll time, so a
  // volatile-update on these paths needs no host-side action.

  // Apply the initial proxy state immediately
  try {
    const mode = resolveMode()
    applyProxyEnv(mode, config.customNoProxy.get() || '')
  } catch (_) {}

  // ── HTTP API routes for client-side features ──────────────────────────
  // The webServer type augmentation lives in @deepseek-ai/dsh-host-webserver
  // which is not a direct dependency; cast through `any` for the register calls.
  // One independent ctx.inject(['webServer']) block per subsystem (B proxy, D
  // alerts), so each subsystem's route set has its own effect lifetime
  // and can be removed/enabled without touching the others (K2 decoupling).
  ctx.inject(['webServer'], (wsCtx: any) => {
    // B · System proxy ──────────────────────────────────────────────────
    // #4/#6: Proxy status — returns the current proxyMode, customNoProxy,
    // the test target, and the actual NO_PROXY env var value so the client
    // can show the real state.
    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dock-flash/proxy-status',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }
        const mode = resolveMode()
        const custom = config.customNoProxy.get() || ''
        const testUrl = resolveTestUrl()
        const route = await proxyRouteForUrl(testUrl)
        sendJson(res, 200, {
          proxyMode: mode,
          customNoProxy: custom,
          testUrl,
          // What this plugin published for the current mode (null = cleared).
          noProxy: resolveNoProxy(mode, custom) ?? null,
          testDefault: DEFAULT_TEST_URL,
          // Probed against the configured test target, not a hardcoded host —
          // "is a proxy active" and "did the test use one" must not disagree.
          proxyAvailable: route.proxied,
          // Whether any proxy variable exists at all. `proxyAvailable` alone
          // cannot distinguish "no proxy configured" from "configured, and this
          // URL is deliberately bypassed" — the client needs both to avoid
          // telling the user their proxy has no effect when they asked for a
          // bypass.
          httpProxy: readProxyEnv(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
          // Per-class proxy variables, each verbatim — lets the client render a
          // complete read-only inventory (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY).
          proxyEnv: proxyEnvSummary(),
          routeError: route.error,
        })
      },
    }), 'dock-flash: GET /plugins/dock-flash/proxy-status')

    // #5 (v1.0.7): Connection test with diagnostics — walks the redirect chain
    // manually, measures headers vs body separately, and reports the proxy
    // route decision plus the underlying socket error code.
    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dock-flash/test-connection',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('allow', 'POST')
          res.end()
          return
        }
        // Optional `{ url }` override; falls back to the stored setting.
        const body = await readJsonBody(req)
        const testUrl = resolveTestUrl(body && body.url)
        let target: URL
        try {
          target = new URL(testUrl)
          if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            throw new Error('unsupported protocol: ' + target.protocol)
          }
        } catch (e: any) {
          sendJson(res, 200, {
            ok: false,
            url: testUrl,
            finalUrl: testUrl,
            elapsedMs: 0,
            headersMs: 0,
            bodyMs: 0,
            bodyBytes: 0,
            bodySnippet: null,
            status: 0,
            statusText: '',
            contentType: '',
            contentLength: null,
            redirects: [],
            redirectLimitHit: false,
            timeoutMs: TEST_TIMEOUT_MS,
            proxy: await describeProxyRoute(testUrl, false),
            error: {
              name: 'InvalidTestUrl',
              message: e?.message || String(e),
              code: null,
              causeName: null,
              causeMessage: null,
              causeCode: null,
              causeErrno: null,
            },
          })
          return
        }
        try {
          sendJson(res, 200, await runConnectionTest(testUrl))
        } catch (e: any) {
          // runConnectionTest already reports failures as data; this is a
          // belt-and-braces guard so the route can never 500.
          sendJson(res, 200, {
            ok: false,
            url: testUrl,
            finalUrl: testUrl,
            elapsedMs: 0,
            redirects: [],
            proxy: await describeProxyRoute(testUrl),
            error: { name: 'InternalError', message: e?.message || String(e) },
          })
        }
      },
    }), 'dock-flash: POST /plugins/dock-flash/test-connection')
  })

  ctx.inject(['webServer'], (wsCtx: any) => {
    // D · System alerts ─────────────────────────────────────────────────
    // Host-side alert queue for server-push alerts. External tools or the host
    // process itself can push alerts that the client will pick up on the next
    // poll. The queue is in-memory only (lost on restart), capped and pruned
    // from settings the sliders control.
    const _alertQueue: any[] = []

    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dock-flash/push-alert',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('allow', 'POST')
          res.end()
          return
        }
        const body = await readJsonBody(req)
        if (!body || !body.id || !body.title) {
          sendJson(res, 400, { error: 'Missing required fields: id, title' })
          return
        }
        const cap = config.hostAlertQueueCap.get() || DEFAULT_HOST_ALERT_QUEUE_CAP
        const maxAgeHours = config.hostAlertMaxAge.get() ?? DEFAULT_HOST_ALERT_MAX_AGE
        const maxAgeMs = (maxAgeHours > 0 ? maxAgeHours : DEFAULT_HOST_ALERT_MAX_AGE) * 3600_000
        const cutoff = Date.now() - maxAgeMs
        // Prune expired entries first, then cap the queue
        for (let i = _alertQueue.length - 1; i >= 0; i--) {
          if (_alertQueue[i].timestamp && _alertQueue[i].timestamp < cutoff) {
            _alertQueue.splice(i, 1)
          }
        }
        const alert = {
          id: String(body.id),
          severity: body.severity || 'info',
          title: String(body.title),
          message: body.message ? String(body.message) : '',
          icon: body.icon || '🔔',
          timestamp: Date.now(),
          dismissible: body.dismissible !== false,
          source: 'host',
        }
        _alertQueue.push(alert)
        // Cap the queue — drop the oldest entries
        while (_alertQueue.length > cap) _alertQueue.shift()
        sendJson(res, 200, { ok: true, queued: _alertQueue.length })
      },
    }), 'dock-flash: POST /plugins/dock-flash/push-alert')

    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dock-flash/host-alerts',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('allow', 'GET')
          res.end()
          return
        }
        const maxAgeHours = config.hostAlertMaxAge.get() ?? DEFAULT_HOST_ALERT_MAX_AGE
        const maxAgeMs = (maxAgeHours > 0 ? maxAgeHours : DEFAULT_HOST_ALERT_MAX_AGE) * 3600_000
        const cutoff = Date.now() - maxAgeMs
        // Prune expired entries before draining
        for (let i = _alertQueue.length - 1; i >= 0; i--) {
          if (_alertQueue[i].timestamp && _alertQueue[i].timestamp < cutoff) {
            _alertQueue.splice(i, 1)
          }
        }
        // Drain the queue — splice out everything and return it
        const alerts = _alertQueue.splice(0, _alertQueue.length)
        sendJson(res, 200, { alerts })
      },
    }), 'dock-flash: GET /plugins/dock-flash/host-alerts')

    // Clear the host-side alert queue — called when the client's master
    // system-alerts toggle is switched OFF so no stale data survives.
    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dock-flash/clear-alerts',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('allow', 'POST')
          res.end()
          return
        }
        const count = _alertQueue.length
        _alertQueue.splice(0, _alertQueue.length)
        sendJson(res, 200, { ok: true, cleared: count })
      },
    }), 'dock-flash: POST /plugins/dock-flash/clear-alerts')

    // D-owned connectivity heartbeat — the client's network-alert provider
    // polls THIS route to gauge latency, not B's /proxy-status (K6 dropped).
    // A probe that answers quickly regardless of proxy state is exactly what a
    // latency alarm wants: it isolates the local host reachability signal from
    // whether a proxy is configured, so the two subsystems share no route.
    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dock-flash/health',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        sendJson(res, 200, { ok: true, ts: Date.now() })
      },
    }), 'dock-flash: GET /plugins/dock-flash/health')
  })


}
