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
// Default export only (`export default Schema`); there is no named `Schema`.
import Schema from '@deepseek-ai/schemastery'

export const name = 'dock-flash'

// No host-side service dependencies; all services are injected lazily.
export const inject: string[] = []

/** Composition default for the dock-flash settings namespace. */
export interface ProxyConfig {
  /**
   * Proxy mode — determines how NO_PROXY is set:
   * - 'all-proxy':  NO_PROXY cleared → all traffic uses proxy
   * - 'api-bypass': NO_PROXY = API_BYPASS_DOMAINS → API calls bypass proxy
   * - 'all-bypass': NO_PROXY = '*' → all traffic bypasses proxy
   * - 'custom':     NO_PROXY = customNoProxy value
   */
  proxyMode: string
  /** Custom NO_PROXY value, used only when proxyMode is 'custom'. */
  customNoProxy: string
  /**
   * URL the connection test fetches from the host side.
   *
   * Deliberately a setting and not a constant: the maintainer's real target is
   * an internal host, and hardcoding it published internal infrastructure
   * details in this public repository. Users point this at whatever address
   * actually proves their proxy works.
   */
  testUrl: string
  /** @deprecated Legacy boolean — migrated to proxyMode on first load. */
  useProxy?: boolean
}

const DEFAULT_MODE = 'all-proxy'
const DEFAULT_CUSTOM = ''

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

const entry: ProxyConfig = {
  proxyMode: DEFAULT_MODE,
  customNoProxy: DEFAULT_CUSTOM,
  testUrl: DEFAULT_TEST_URL,
}

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
 * Two paths reach `applyProxyEnv` at startup: `installSection` invokes its
 * `onChange` synchronously while installing (dsh-settings does — see
 * `installSection` in `@deepseek-ai/dsh-settings`), and the composition then
 * applies the initial state explicitly. Both ran, and because `applyProxyEnv`
 * suspends on `await loadProxyModule()` *before* it touches
 * `_disposeProxyPolicy`, neither install could see the other: the second
 * overwrote the field and the first disposer was dropped — one leaked
 * ProxyAgent and socket pool per startup, which is exactly the leak the
 * release-before-install step exists to prevent. The duplicate also meant the
 * pair was logged twice, so the proxy log could no longer distinguish a real
 * mode switch from startup noise, and every unrelated edit in this namespace
 * (changing `testUrl`, say) re-installed the dispatcher as well.
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

export function apply(ctx: Context) {

  // The authoritative config: the settings section while one is attached,
  // the composition entry otherwise.
  let source: () => ProxyConfig = () => entry

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
    const raw = fromOverride || String(source().testUrl || '').trim()
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
    const cfg = source()
    let mode = cfg.proxyMode || DEFAULT_MODE
    if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
      mode = cfg.useProxy ? 'all-proxy' : 'all-bypass'
    }
    const custom = cfg.customNoProxy || ''
    const route = probeRoute
      ? await proxyRouteForUrl(url)
      : { proxied: false, error: null }

    return {
      mode,
      // What this plugin published for the current mode: the value that governs
      // routing once the dispatcher has been re-installed.
      noProxy: resolveNoProxy(mode, custom) ?? null,
      httpProxy: readProxyEnv(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
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
  // namespace and watch for proxy preference changes.
  ctx.inject(['settings'], (settingsCtx) => {
    const ProxySchema = Schema.object({
      proxyMode: Schema.string().default(DEFAULT_MODE),
      customNoProxy: Schema.string().default(DEFAULT_CUSTOM),
      testUrl: Schema.string().default(DEFAULT_TEST_URL),
      // Keep the old field so legacy clients don't break; migrated on read.
      useProxy: Schema.boolean().default(true),
    })

    settingsCtx.settings.installSection(ctx, 'dock-flash', ProxySchema, entry, {
      setSource: (current: () => ProxyConfig) => {
        source = current
      },
      onChange: () => {
        try {
          const cfg = source()
          // Migrate legacy useProxy → proxyMode on first change
          let mode = cfg.proxyMode || DEFAULT_MODE
          if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
            mode = cfg.useProxy ? 'all-proxy' : 'all-bypass'
            cfg.proxyMode = mode
          }
          applyProxyEnv(mode, cfg.customNoProxy || '')
        } catch (e) {
          console.error('[dock-flash] failed to update proxy setting:', e)
        }
      },
    })

    // Apply the initial state immediately
    try {
      const cfg = source()
      let mode = cfg.proxyMode || DEFAULT_MODE
      if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
        mode = cfg.useProxy ? 'all-proxy' : 'all-bypass'
        cfg.proxyMode = mode
      }
      applyProxyEnv(mode, cfg.customNoProxy || '')
    } catch (_) {}
  })

  // ── HTTP API routes for client-side features ──────────────────────────
  // The webServer type augmentation lives in @deepseek-ai/dsh-host-webserver
  // which is not a direct dependency; cast through `any` for the register calls.
  ctx.inject(['webServer'], (wsCtx: any) => {
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
        const cfg = source()
        let mode = cfg.proxyMode || DEFAULT_MODE
        if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
          mode = cfg.useProxy ? 'all-proxy' : 'all-bypass'
        }
        const custom = cfg.customNoProxy || ''
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
}
