// dock-flash — HOST half of a dock feature plugin.
//
// This plugin is primarily client-side: the dock workbench runs in the
// browser and all UI interaction happens through ctx.workbench. The host
// half therefore only needs minimal plumbing.
//
// Host-side responsibilities:
// - Registers the 'dock-flash' settings namespace so the client can
//   persist the proxy-mode selection via ctx.remote.settings.
// - Watches the 'proxyMode' setting and re-installs the undici global
//   dispatcher via @deepseek-ai/dsh-http-proxy so outbound requests
//   respect the user's NO_PROXY choice.
// - Exposes HTTP routes for the client to query proxy status and test
//   the connection (improvements #4, #5, #6).
// - Owns the *test target* (testUrl) and runs the diagnostic connectivity
//   probe: redirect chain, response headers, body size/snippet, proxy route
//   decision, and the underlying socket error code (cause.code).
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-settings'

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'
import { existsSync } from 'node:fs'

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
    case 'custom':     return custom || ''
    default:           return undefined
  }
}

/**
 * Re-install the process-wide proxy policy via @deepseek-ai/dsh-http-proxy.
 *
 * Simply writing `process.env.NO_PROXY` does NOT affect outbound requests,
 * because undici's global dispatcher was installed at startup with a frozen
 * policy object.  The dispatcher re-reads neither the environment nor
 * `process.env` — it routes by the `ProxyPolicy` it was given.
 *
 * The fix is to call `installProxyFromEnvironment()` again after mutating
 * `process.env`, which creates a fresh dispatcher with the updated noProxy
 * and installs it as the global one.
 */
async function applyProxyEnv(mode: string, custom: string) {
  const noProxy = resolveNoProxy(mode, custom)
  if (noProxy === undefined) {
    delete process.env.NO_PROXY
    delete process.env.no_proxy
  } else {
    process.env.NO_PROXY = noProxy
    process.env.no_proxy = noProxy
  }
  console.log('[dock-flash] proxy mode=' + mode + ' (NO_PROXY=' + (noProxy ?? '<removed>') + ')')

  // Re-install the undici global dispatcher so it picks up the new NO_PROXY.
  try {
    const { installProxyFromEnvironment } = require('@deepseek-ai/dsh-http-proxy') as any
    // Build a simple EnvLookup from process.env
    const envLookup = {
      get(name: string) {
        const value = process.env[name]
        return value !== undefined && value !== '' ? { value } : undefined
      },
    }
    await installProxyFromEnvironment(envLookup, (msg: string) => {
      console.warn('[dock-flash] proxy install warning: ' + msg)
    })
    console.log('[dock-flash] undici global dispatcher re-installed')
  } catch (e: any) {
    // dsh-http-proxy may not be available in all environments
    console.warn('[dock-flash] could not re-install proxy dispatcher:', e.message || e)
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

  /** Check whether a proxy is actively routing requests to `url`. */
  function hasActiveProxy(url: string): boolean {
    try {
      const { proxyRouteFor } = require('@deepseek-ai/dsh-http-proxy') as any
      return proxyRouteFor(url)?.proxied === true
    } catch (_) {
      return false
    }
  }

  // The authoritative config: the settings section while one is attached,
  // the composition entry otherwise.
  let source: () => ProxyConfig = () => entry

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

  /** How dsh-http-proxy would route `url`, plus the env it decides from. */
  function describeProxyRoute(url: string) {
    let proxied = false
    let routeError: string | null = null
    try {
      const { proxyRouteFor } = require('@deepseek-ai/dsh-http-proxy') as any
      proxied = proxyRouteFor(url)?.proxied === true
    } catch (e: any) {
      routeError = e?.message || String(e)
    }
    const cfg = source()
    let mode = cfg.proxyMode || DEFAULT_MODE
    if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
      mode = cfg.useProxy ? 'all-proxy' : 'all-bypass'
    }
    return {
      mode,
      noProxy: process.env.NO_PROXY || process.env.no_proxy || null,
      httpProxy:
        process.env.HTTPS_PROXY || process.env.https_proxy ||
        process.env.HTTP_PROXY || process.env.http_proxy || null,
      proxied,
      routeError,
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
    const proxy = describeProxyRoute(url)
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
    const { Schema } = require('@deepseek-ai/schemastery') as any

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
      handler: (req: IncomingMessage, res: ServerResponse) => {
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
        const noProxy = process.env.NO_PROXY || process.env.no_proxy || null
        const testUrl = resolveTestUrl()
        sendJson(res, 200, {
          proxyMode: mode,
          customNoProxy: cfg.customNoProxy || '',
          testUrl,
          noProxy,
          testDefault: DEFAULT_TEST_URL,
          // Probed against the configured test target, not a hardcoded host —
          // "is a proxy active" and "did the test use one" must not disagree.
          proxyAvailable: hasActiveProxy(testUrl),
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
            proxy: describeProxyRoute(testUrl),
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
            proxy: describeProxyRoute(testUrl),
            error: { name: 'InternalError', message: e?.message || String(e) },
          })
        }
      },
    }), 'dock-flash: POST /plugins/dock-flash/test-connection')
  })
}
