import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
// Default export only (`export default Schema`); there is no named `Schema`.
import Schema from '@deepseek-ai/schemastery';
export const name = 'dock-flash';
// No host-side service dependencies; all services are injected lazily.
export const inject = [];
const DEFAULT_MODE = 'all-proxy';
const DEFAULT_CUSTOM = '';
/** A cluster folded state is deliberately *not* here: it is a session toggle. */
const DEFAULT_PANEL_ORDER = { builtin: [], ext: [], switches: {}, hidden: {} };
const DEFAULT_ACTIVE_SKIN = '';
const DEFAULT_TRIGGER_POSITION = 'input.right';
/** Matches the client's OVERLAY_EDGE: 8px inside the conversation's corner. */
const DEFAULT_TRIGGER_OVERLAY_OFFSET = { dx: 8, dy: 8 };
/**
 * Matches the client's TRIGGER_SIZE_MIN — which is also its default and the
 * size every release up to 1.3.x shipped. The minimum and the default being the
 * same number is deliberate: the control can only make the button LARGER, so an
 * upgrade changes nothing until the user asks, and there is no way to shrink
 * the entry point down to something hard to hit.
 */
const DEFAULT_TRIGGER_SIZE = 24;
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
const DEFAULT_TRIGGER_LAYER = 1150;
/** Matches the client's DEFAULT_OVERLAY_OPACITY — what 0.55 always was. */
const DEFAULT_OVERLAY_OPACITY = 0.55;
// ── Alert threshold defaults ──────────────────────────────────────────────
// Stored as percentages (0–100) for user-friendliness; providers divide by
// 100 internally to obtain the ratio used in comparisons.
/** Memory alert thresholds (% of V8 heap). */
const DEFAULT_MEM_THRESHOLD_INFO = 80;
const DEFAULT_MEM_THRESHOLD_WARNING = 90;
const DEFAULT_MEM_THRESHOLD_ERROR = 95;
/** Memory polling: base interval and minimum (ms). */
const DEFAULT_MEM_POLL_BASE = 30000;
const DEFAULT_MEM_POLL_MIN = 2000;
/** Context window approximation (tokens). */
const DEFAULT_CTX_APPROX_WINDOW = 128000;
/** Estimated tokens per conversation message. */
const DEFAULT_CTX_TOKENS_PER_MSG = 200;
/** Context alert thresholds (% of estimated window). */
const DEFAULT_CTX_THRESHOLD_INFO = 70;
const DEFAULT_CTX_THRESHOLD_WARNING = 85;
const DEFAULT_CTX_THRESHOLD_ERROR = 95;
/** Context polling: base interval and minimum (ms). */
const DEFAULT_CTX_POLL_BASE = 20000;
const DEFAULT_CTX_POLL_MIN = 2000;
/** Network heartbeat slow threshold (ms). */
const DEFAULT_NET_SLOW_THRESHOLD = 5000;
/** Network polling: base interval and minimum (ms). */
const DEFAULT_NET_POLL_BASE = 60000;
const DEFAULT_NET_POLL_MIN = 10000;
/** Network Monitor: ring-buffer log capacity, suspicious/dangerous thresholds. */
const DEFAULT_NET_LOG_CAP = 300;
const DEFAULT_NET_SUSPECT_WARN = 40;
const DEFAULT_NET_SUSPECT_ERR = 70;
/** Host alert queue capacity (max entries). */
const DEFAULT_HOST_ALERT_QUEUE_CAP = 50;
/** Host alert maximum retention time (hours). */
const DEFAULT_HOST_ALERT_MAX_AGE = 24;
/**
 * Default test target: the canonical "is there a working network path"
 * endpoint. Returns an empty 204, so it measures the path and nothing else —
 * and it is unreachable without a working proxy on networks that need one,
 * which is exactly the signal the test is meant to produce.
 */
const DEFAULT_TEST_URL = 'https://www.google.com/generate_204';
/** Hard ceiling on a single test; also reported in the diagnostics payload. */
const TEST_TIMEOUT_MS = 10000;
/** Redirect hops followed before giving up (the chain is reported either way). */
const MAX_REDIRECTS = 5;
/** Bytes of response body echoed back for inspection. */
const BODY_SNIPPET_LIMIT = 200;
const entry = {
    proxyMode: DEFAULT_MODE,
    customNoProxy: DEFAULT_CUSTOM,
    testUrl: DEFAULT_TEST_URL,
    panelOrder: DEFAULT_PANEL_ORDER,
    activeSkin: DEFAULT_ACTIVE_SKIN,
    triggerPosition: DEFAULT_TRIGGER_POSITION,
    triggerOverlayOffset: DEFAULT_TRIGGER_OVERLAY_OFFSET,
    triggerSize: DEFAULT_TRIGGER_SIZE,
    triggerLayer: DEFAULT_TRIGGER_LAYER,
    overlayOpacity: DEFAULT_OVERLAY_OPACITY,
    // Alert thresholds
    memThresholdInfo: DEFAULT_MEM_THRESHOLD_INFO,
    memThresholdWarning: DEFAULT_MEM_THRESHOLD_WARNING,
    memThresholdError: DEFAULT_MEM_THRESHOLD_ERROR,
    memPollBase: DEFAULT_MEM_POLL_BASE,
    memPollMin: DEFAULT_MEM_POLL_MIN,
    ctxApproxWindow: DEFAULT_CTX_APPROX_WINDOW,
    ctxTokensPerMsg: DEFAULT_CTX_TOKENS_PER_MSG,
    ctxThresholdInfo: DEFAULT_CTX_THRESHOLD_INFO,
    ctxThresholdWarning: DEFAULT_CTX_THRESHOLD_WARNING,
    ctxThresholdError: DEFAULT_CTX_THRESHOLD_ERROR,
    ctxPollBase: DEFAULT_CTX_POLL_BASE,
    ctxPollMin: DEFAULT_CTX_POLL_MIN,
    netSlowThreshold: DEFAULT_NET_SLOW_THRESHOLD,
    netPollBase: DEFAULT_NET_POLL_BASE,
    netPollMin: DEFAULT_NET_POLL_MIN,
    netLogCap: DEFAULT_NET_LOG_CAP,
    netSuspectWarn: DEFAULT_NET_SUSPECT_WARN,
    netSuspectErr: DEFAULT_NET_SUSPECT_ERR,
    netWhitelist: [],
    hostAlertQueueCap: DEFAULT_HOST_ALERT_QUEUE_CAP,
    hostAlertMaxAge: DEFAULT_HOST_ALERT_MAX_AGE,
};
/** Domains that bypass the proxy when proxyMode is 'api-bypass'. */
const API_BYPASS_DOMAINS = 'api.deepseek.com,chat.deepseek.com';
/** Map a proxyMode (+ optional customNoProxy) to the actual NO_PROXY value. */
function resolveNoProxy(mode, custom) {
    switch (mode) {
        case 'all-proxy': return undefined; // no bypass → all traffic proxied
        case 'api-bypass': return API_BYPASS_DOMAINS;
        case 'all-bypass': return '*';
        case 'custom': {
            // The only user-supplied value here. A blank one means "no bypass
            // entries", i.e. the same routing as `all-proxy` — so clear the variable
            // rather than publishing `NO_PROXY=''`, which would leave a set-but-empty
            // variable in the environment for spawned children to read. (Routing is
            // identical either way: dsh-http-proxy's parser drops empty entries.)
            const value = (custom || '').trim();
            return value === '' ? undefined : value;
        }
        default: return undefined;
    }
}
/**
 * The ctx service DSH publishes with the launch-environment snapshot it
 * resolved the boot-time proxy policy from. That snapshot merges three layers
 * (`process` | `project-env` | `user-env`) and structurally satisfies the
 * `EnvLookup` this plugin hands back to dsh-http-proxy.
 */
const LAUNCH_ENVIRONMENT_SERVICE = 'launchEnvironment';
/**
 * Disposer for the dispatcher this plugin installed.
 *
 * `installProxyFromEnvironment` returns one and restores both the global
 * dispatcher and the module's policy state. Dropping it — as this code used to
 * — leaks one ProxyAgent and its whole socket pool per mode change.
 */
let _disposeProxyPolicy = null;
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
let _appliedProxyKey = null;
let _proxyModulePromise = null;
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
function loadProxyModule() {
    if (_proxyModulePromise)
        return _proxyModulePromise;
    _proxyModulePromise = (async () => {
        // Widened to `string` on purpose: a literal would make TypeScript try to
        // resolve a package that is deliberately not a dependency of this plugin.
        const specifier = '@deepseek-ai/dsh-http-proxy';
        // Preferred: an ordinary resolution, for any setup that installs it for us.
        try {
            return (await import(specifier));
        }
        catch (_) { /* fall through to DSH's own copy */ }
        const entry = process.argv[1];
        if (!entry) {
            console.warn('[dock-flash] cannot locate the DSH entry point; proxy control unavailable');
            return null;
        }
        try {
            const resolved = createRequire(entry).resolve(specifier);
            console.log('[dock-flash] dsh-http-proxy resolved to ' + resolved);
            return (await import(pathToFileURL(resolved).href));
        }
        catch (e) {
            console.warn('[dock-flash] could not load ' + specifier + ': ' + (e?.message || e));
            return null;
        }
    })();
    return _proxyModulePromise;
}
// ───────────────────────────────────────────────────────────────────────────
// Network Monitor — outbound request auditor.
//
// The connectivity provider answers "can DSH reach the network"; THIS answers
// "who is reaching out, to whom, and with how much data". It records per-request
// METADATA ONLY — method, host, path, body size, status, response size, timing,
// TLS, and the plugin (or `unknown`) that initiated the call. Request/response
// bodies and header VALUES are never captured: the auditor must not itself
// become a data-exfiltration channel.
// ───────────────────────────────────────────────────────────────────────────
/**
 * AsyncLocalStorage is reserved for carrying "which plugin context is active
 * right now" across async boundaries IF Cordis exposes a reliable hook to wrap
 * every plugin fork's `apply()`. It is not guaranteed today, so the working
 * attribution path lives in `_pluginIdFromStack()` (stack-trace fallback) —
 * see `resolvePluginId()` for the real priority. Keeping the ALS here means a
 * future fork-hook can adopt it without restructuring.
 */
const _requestContext = new AsyncLocalStorage();
const _UNKNOWN_PLUGIN = 'unknown';
/**
 * Resolve which plugin initiated a request.
 *
 * Priority: AsyncLocalStorage context (populated only if a future fork-hook
 * calls `_requestContext.run(...)`) → stack-trace hint → `unknown`. `unknown`
 * is itself a meaningful, alarming signal ("something anonymous is sending
 * data"), never a silent discard.
 */
function resolvePluginId() {
    const store = _requestContext.getStore();
    if (store && store.pluginId)
        return store.pluginId;
    const hint = _pluginIdFromStack();
    return hint || _UNKNOWN_PLUGIN;
}
/** Extract `<pkg>` from the first `node_modules/<pkg>/` stack frame, if any. */
function _pluginIdFromStack() {
    let stack;
    try {
        stack = new Error().stack || '';
    }
    catch (_) {
        return null;
    }
    const re = /node_modules[\\/]+([^\\/]+)/g;
    let m;
    // Walk every frame, preferring the outermost (caller-most) plugin path, i.e.
    // the last match that is a real package rather than a loader shim.
    let candidate = null;
    while ((m = re.exec(stack)) !== null) {
        const pkg = m[1];
        // Skip the common well-known loader/runtime names that sit between the real
        // caller and us, so we attribute to the plugin that actually issued the call.
        if (/^(@deepseek-ai|cordis|undici|node:|internal)/i.test(pkg))
            continue;
        candidate = pkg;
    }
    return candidate;
}
/** Built-in hosts considered trustworthy — anything else starts suspect. */
const BUILTIN_TRUSTED_HOSTS = new Set([
    'www.google.com', // default connectivity test target
    'api.deepseek.com', // DSH API
    'chat.deepseek.com', // DSH API
]);
/** Default guard: without an explicit override every host is suspect. */
const HOST_ALLOW_UNKNOWN = false;
/**
 * The in-memory auditor. A ring buffer capped at `cap` entries (oldest dropped
 * on overflow) plus a suspicion scorer. Lost on restart — intentional: network
 * audit history is session-scoped, not durable user data.
 */
class NetworkMonitor {
    _cap;
    _entries = [];
    _seq = 0;
    /** Resolved once; the mutable set of user-trusted hosts. */
    _userTrusted = new Set();
    _seenHosts = new Map();
    constructor(_cap) {
        this._cap = _cap;
    }
    setCap(cap) {
        this._cap = Math.max(1, Math.floor(cap) || 1);
        while (this._entries.length > this._cap)
            this._entries.shift();
    }
    setUserTrusted(hosts) {
        this._userTrusted = new Set((hosts || []).map((h) => String(h).toLowerCase()));
    }
    isTrusted(host) {
        const h = host.toLowerCase();
        if (BUILTIN_TRUSTED_HOSTS.has(h) || HOST_ALLOW_UNKNOWN)
            return true;
        if (this._userTrusted.has(h))
            return true;
        // A user trust on an apex domain covers bare subdomains (api.example.com
        // under an added example.com), matching the NO_PROXY semantics elsewhere.
        for (const t of this._userTrusted) {
            if (h.endsWith('.' + t))
                return true;
        }
        return false;
    }
    _score(host, method, reqBytes, tls, isNew) {
        if (this.isTrusted(host))
            return { risk: 0, flags: [] };
        let risk = 30; // unknown host
        const flags = ['unknown-host'];
        if (isNew) {
            risk += 15;
            flags.push('new-host');
        }
        if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && reqBytes > 1024) {
            risk += 25;
            flags.push('large-upload');
        }
        if (!tls) {
            risk += 20;
            flags.push('plaintext');
        }
        // Touch-and-go heuristic: repeated calls to the same unknown host raise it.
        const seen = this._seenHosts.get(host) || 0;
        if (seen >= 3) {
            risk += 15;
            flags.push('high-frequency');
        }
        return { risk: Math.min(100, risk), flags };
    }
    record(input) {
        let host = '?';
        let pathname = '';
        try {
            const u = new URL(input.url);
            host = u.host || '?';
            pathname = u.pathname || '';
        }
        catch (_) {
            // Non-URL input; keep whatever we have.
        }
        const firstSeen = !this._seenHosts.has(host);
        this._seenHosts.set(host, (this._seenHosts.get(host) || 0) + 1);
        const { risk, flags } = this._score(host, input.method, input.reqBytes, input.tls, firstSeen);
        const entry = {
            seq: ++this._seq,
            pluginId: resolvePluginId(),
            method: input.method,
            host,
            pathname,
            reqBytes: input.reqBytes,
            resBytes: input.resBytes,
            status: input.status,
            durationMs: input.durationMs,
            tls: input.tls,
            risk,
            flags,
            timestamp: Date.now(),
        };
        this._entries.push(entry);
        if (this._entries.length > this._cap)
            this._entries.shift();
        return entry;
    }
    snapshot() {
        return this._entries.slice();
    }
    alerts(threshold) {
        return this._entries.filter((e) => e.risk >= threshold);
    }
}
/** Module-level so the tracer and routes share one instance per process. */
let _networkMonitor = null;
/** The wrapper we installed, saved so dispose can restore the original fetch. */
let _restoreFetch = null;
/**
 * Estimate the byte size of a fetch RequestInit body WITHOUT reading its
 * content — sizing only, never capturing data.
 */
function _estimateReqBytes(body) {
    if (body == null)
        return 0;
    if (typeof body === 'string')
        return Buffer.byteLength(body, 'utf8');
    if (Buffer.isBuffer(body))
        return body.byteLength;
    if (body instanceof URLSearchParams)
        return Buffer.byteLength(body.toString(), 'utf8');
    if (body instanceof Blob)
        return typeof body.size === 'number' ? body.size : 0;
    if (body instanceof ArrayBuffer)
        return body.byteLength;
    if (ArrayBuffer.isView(body))
        return body.byteLength;
    // Streams / other: unknowable without consuming — report 0 rather than swallow.
    return 0;
}
/**
 * Install a global outbound-request tracer by wrapping `globalThis.fetch`.
 *
 * Node.js 18+/undici fetch is the shared entry point for `ctx.http` and raw
 * `fetch()` calls alike, so a single wrapper captures both. We record metadata
 * around the promise; the body is only NEVER read (the Response is returned
 * untouched to the caller).
 *
 * Returns a disposer that restores the original fetch and stops capture.
 */
function installRequestTracer() {
    const origFetch = globalThis.fetch;
    // Guard against double-install on hot reload / re-apply.
    if (!origFetch || origFetch.__dockFlashTraced)
        return () => { };
    const wrap = async (input, init) => {
        const method = (init && init.method) || (typeof input === 'string' ? 'GET' : (input && input.method) || 'GET');
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const reqBytes = _estimateReqBytes(init && init.body);
        const started = Date.now();
        let status = 0;
        let resBytes = -1;
        let tls = false;
        try {
            tls = typeof url === 'string' && /^https:/i.test(url);
        }
        catch (_) { }
        try {
            const res = await origFetch.call(globalThis, input, init);
            status = res.status;
            const cl = res.headers && res.headers.get && res.headers.get('content-length');
            resBytes = cl ? (parseInt(cl, 10) || 0) : -1;
            const end = Date.now();
            if (_networkMonitor) {
                try {
                    _networkMonitor.record({ method, url, reqBytes, resBytes, status, durationMs: end - started, tls });
                }
                catch (_) { }
            }
            return res;
        }
        catch (e) {
            const end = Date.now();
            if (_networkMonitor) {
                try {
                    _networkMonitor.record({ method, url, reqBytes, resBytes: -1, status: 0, durationMs: end - started, tls });
                }
                catch (_) { }
            }
            throw e;
        }
    };
    wrap.__dockFlashTraced = true;
    globalThis.fetch = wrap;
    _restoreFetch = () => {
        if (globalThis.fetch === wrap)
            globalThis.fetch = origFetch;
        _restoreFetch = null;
    };
    return _restoreFetch;
}
/** An EnvLookup over process.env — the fallback when no snapshot is provided. */
function processEnvLookup() {
    return {
        get(name) {
            const value = process.env[name];
            return value !== undefined && value !== '' ? { value } : undefined;
        },
    };
}
/** Send a JSON response with no-store cache control. */
function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
}
/**
 * Read an optional JSON request body, bounded so a client cannot feed the
 * host an unbounded buffer. Returns null for an empty, oversized, or
 * unparseable body — callers treat that as "no override supplied".
 */
async function readJsonBody(req, limit = 4096) {
    try {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > limit)
                return null;
            chunks.push(chunk);
        }
        if (chunks.length === 0)
            return null;
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch (_) {
        return null;
    }
}
export function apply(ctx) {
    // The authoritative config: the settings section while one is attached,
    // the composition entry otherwise.
    let source = () => entry;
    // ── Network Monitor bootstrap ──────────────────────────────────────────
    // One bounded monitor per process. Config is (re)read from `source()` so a
    // late settings reply or an unrelated field edit refreshes thresholds and
    // whitelist. The tracer wrapper is installed once and restored on dispose.
    if (!_networkMonitor)
        _networkMonitor = new NetworkMonitor(entry.netLogCap || DEFAULT_NET_LOG_CAP);
    const reconfigure = () => {
        const cfg = source();
        if (_networkMonitor) {
            _networkMonitor.setCap(cfg.netLogCap);
            _networkMonitor.setUserTrusted(Array.isArray(cfg.netWhitelist) ? cfg.netWhitelist : []);
        }
    };
    reconfigure();
    if (_restoreFetch === null)
        installRequestTracer();
    ctx.effect(() => {
        // Return the cleanup function — Cordis calls it when the context is disposed.
        const restore = _restoreFetch;
        return () => {
            if (restore)
                restore();
            _networkMonitor = null;
        };
    });
    /** The launch-environment snapshot DSH resolved the boot-time policy from. */
    function launchEnvironment() {
        try {
            const svc = ctx.get ? ctx.get(LAUNCH_ENVIRONMENT_SERVICE) : undefined;
            return svc && typeof svc.get === 'function' ? svc : null;
        }
        catch (_) {
            return null;
        }
    }
    /**
     * Read a proxy variable the way the policy resolved it: the launch snapshot
     * first (it merges process / project-env / user-env), process.env as fallback.
     */
    function readProxyEnv(names) {
        const snapshot = launchEnvironment();
        for (const name of names) {
            const fromSnapshot = snapshot ? snapshot.get(name) : undefined;
            if (fromSnapshot && fromSnapshot.value)
                return fromSnapshot.value;
            const raw = process.env[name];
            if (raw)
                return raw;
        }
        return null;
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
    async function applyProxyEnv(mode, custom) {
        // Idempotence guard — see _appliedProxyKey. Set before any await so the
        // duplicate startup caller is a no-op rather than a racing second install.
        const key = mode + '\u0000' + custom;
        if (key === _appliedProxyKey)
            return;
        _appliedProxyKey = key;
        const noProxy = resolveNoProxy(mode, custom);
        if (noProxy === undefined) {
            delete process.env.NO_PROXY;
            delete process.env.no_proxy;
        }
        else {
            process.env.NO_PROXY = noProxy;
            process.env.no_proxy = noProxy;
        }
        console.log('[dock-flash] proxy mode=' + mode + ' (NO_PROXY=' + (noProxy ?? '<removed>') + ')');
        const mod = await loadProxyModule();
        if (!mod) {
            _appliedProxyKey = null;
            console.warn('[dock-flash] proxy module unavailable — routing is unchanged (the mode now affects child processes only)');
            return;
        }
        // Base the policy on DSH's own snapshot so that nothing but the bypass list
        // changes. Resolving from process.env would silently disagree with the
        // policy DSH installed: its snapshot also merges the project-env and
        // user-env layers, which process.env knows nothing about.
        const snapshot = launchEnvironment();
        const base = snapshot || processEnvLookup();
        const envLookup = {
            get(name) {
                // undici reads the lowercase spelling first, so both are owned here.
                if (name === 'NO_PROXY' || name === 'no_proxy') {
                    return noProxy === undefined ? undefined : { value: noProxy };
                }
                return base.get(name);
            },
        };
        try {
            // Release the previous install before taking a new one, otherwise every
            // mode change stacks another dispatcher on top of the last.
            if (_disposeProxyPolicy) {
                try {
                    await _disposeProxyPolicy();
                }
                catch (_) { /* already released */ }
                _disposeProxyPolicy = null;
            }
            _disposeProxyPolicy = await mod.installProxyFromEnvironment(envLookup, (message) => {
                console.warn('[dock-flash] proxy install warning: ' + message);
            });
            console.log('[dock-flash] undici global dispatcher re-installed (env source=' +
                (snapshot ? 'launchEnvironment' : 'process.env') + ')');
        }
        catch (e) {
            // Let the next change retry: nothing was installed, so nothing is in force.
            _appliedProxyKey = null;
            console.warn('[dock-flash] could not re-install proxy dispatcher:', e?.message || e);
        }
    }
    /**
     * Ask dsh-http-proxy how it would route `url`.
     *
     * `proxyRouteFor` takes a `URL` object. Handed a string it does not throw — it
     * quietly answers "direct", which is how this plugin came to report 直连 for
     * every request it ever tested.
     */
    async function proxyRouteForUrl(url) {
        const mod = await loadProxyModule();
        if (!mod)
            return { proxied: false, error: 'dsh-http-proxy is not loadable from this plugin' };
        try {
            return { proxied: mod.proxyRouteFor(new URL(url))?.proxied === true, error: null };
        }
        catch (e) {
            return { proxied: false, error: e?.message || String(e) };
        }
    }
    /**
     * Resolve the test target.
     *
     * An explicit `override` (from the request body) wins over the stored
     * setting, so the URL the client is displaying is exactly the URL probed —
     * no dependency on the settings write having landed first.
     */
    function resolveTestUrl(override) {
        const fromOverride = typeof override === 'string' ? override.trim() : '';
        const raw = fromOverride || String(source().testUrl || '').trim();
        return raw || DEFAULT_TEST_URL;
    }
    /**
     * How dsh-http-proxy would route `url`, plus the env it decides from.
     *
     * `probeRoute: false` is for callers that already rejected the URL: routing is
     * moot then, and reporting `routeError: "Invalid URL"` alongside the caller's
     * own `InvalidTestUrl` only prints the same message twice.
     */
    async function describeProxyRoute(url, probeRoute = true) {
        const cfg = source();
        let mode = cfg.proxyMode || DEFAULT_MODE;
        if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
            mode = cfg.useProxy ? 'all-proxy' : 'all-bypass';
        }
        const custom = cfg.customNoProxy || '';
        const route = probeRoute
            ? await proxyRouteForUrl(url)
            : { proxied: false, error: null };
        return {
            mode,
            // What this plugin published for the current mode: the value that governs
            // routing once the dispatcher has been re-installed.
            noProxy: resolveNoProxy(mode, custom) ?? null,
            httpProxy: readProxyEnv(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
            proxied: route.proxied,
            routeError: route.error,
        };
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
    async function runConnectionTest(url) {
        const started = Date.now();
        const proxy = await describeProxyRoute(url);
        const redirects = [];
        /** Assemble the payload so every exit path reports the same shape. */
        const report = (extra) => ({
            url,
            proxy,
            timeoutMs: TEST_TIMEOUT_MS,
            redirects,
            elapsedMs: Date.now() - started,
            ...extra,
        });
        let current = url;
        let resp = null;
        let redirectLimitHit = false;
        try {
            for (let hop = 0;; hop++) {
                resp = await fetch(current, {
                    method: 'GET',
                    redirect: 'manual',
                    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
                });
                const location = resp.headers.get('location');
                if (!(resp.status >= 300 && resp.status < 400 && location))
                    break;
                let next = String(location);
                try {
                    next = new URL(next, current).href;
                }
                catch (_) { /* keep raw value */ }
                redirects.push({ hop: hop + 1, from: current, status: resp.status, to: next });
                if (hop >= MAX_REDIRECTS) {
                    redirectLimitHit = true;
                    break;
                }
                current = next;
            }
        }
        catch (e) {
            const cause = e?.cause;
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
            });
        }
        const headersMs = Date.now() - started;
        const contentType = resp.headers.get('content-type') || '';
        const contentLength = resp.headers.get('content-length') || null;
        // Read the body too, so the timing covers the whole exchange and a proxy's
        // own "blocked" page can be inspected rather than guessed at.
        let bodyBytes = 0;
        let bodySnippet = null;
        const bodyStart = Date.now();
        try {
            const buf = Buffer.from(await resp.arrayBuffer());
            bodyBytes = buf.byteLength;
            const textual = !contentType || /text|json|xml|javascript|html/i.test(contentType);
            if (buf.byteLength > 0 && textual) {
                bodySnippet = buf.toString('utf8', 0, Math.min(buf.byteLength, BODY_SNIPPET_LIMIT));
            }
        }
        catch (_) { /* body is optional — headers already prove the path */ }
        const bodyMs = Date.now() - bodyStart;
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
        });
    }
    // When the settings service is available, register the dock-flash
    // namespace: the proxy preference the host acts on, plus the user
    // preferences the client previously kept in localStorage.
    ctx.inject(['settings'], (settingsCtx) => {
        /**
         * `dict`'s arguments are (value, key) — value schema first, contrary to how
         * the call reads. Nested objects need `.default()` at every level: a
         * property whose schema resolves to `undefined` fails the whole thing with
         * `unsupported type "undefined"`, which surfaced while building this.
         */
        const PanelOrderSchema = Schema.object({
            builtin: Schema.array(Schema.string()).default([]),
            ext: Schema.array(Schema.string()).default([]),
            switches: Schema.dict(Schema.array(Schema.string()), Schema.string()).default({}),
            hidden: Schema.dict(Schema.array(Schema.string()), Schema.string()).default({}),
        }).default(DEFAULT_PANEL_ORDER);
        const SettingsSchema = Schema.object({
            proxyMode: Schema.string().default(DEFAULT_MODE),
            customNoProxy: Schema.string().default(DEFAULT_CUSTOM),
            testUrl: Schema.string().default(DEFAULT_TEST_URL),
            // Keep the old field so legacy clients don't break; migrated on read.
            useProxy: Schema.boolean().default(true),
            // Client-owned preferences. The host stores them and never interprets
            // them, so they are typed loosely on purpose: `activeSkin` names a skin
            // that may not be installed on this machine, and `triggerPosition` names
            // a slot the client validates against its own TRIGGER_POSITIONS list.
            // Pinning either to an enum here would make a stored preference
            // un-writable the moment the client's lists change.
            panelOrder: PanelOrderSchema,
            activeSkin: Schema.string().default(DEFAULT_ACTIVE_SKIN),
            triggerPosition: Schema.string().default(DEFAULT_TRIGGER_POSITION),
            // Every level of a nested object needs `.default()`, or the whole resolve
            // fails with `unsupported type "undefined"` — both the object and each
            // number, which is the trap that cost a round in 1.1.0.
            triggerOverlayOffset: Schema.object({
                dx: Schema.number().default(DEFAULT_TRIGGER_OVERLAY_OFFSET.dx),
                dy: Schema.number().default(DEFAULT_TRIGGER_OVERLAY_OFFSET.dy),
            }).default(DEFAULT_TRIGGER_OVERLAY_OFFSET),
            // No min/max on purpose — see the field's comment: the range belongs to
            // the client, and it moves with the selected trigger position.
            triggerSize: Schema.number().default(DEFAULT_TRIGGER_SIZE),
            // Both are client-owned presets the host never interprets: the sensible
            // range depends on the host UI they sit among, and clamping them here
            // would make a stored value un-writable the moment the client's preset
            // list changes (the 1.1.0 lesson this namespace already records).
            triggerLayer: Schema.number().default(DEFAULT_TRIGGER_LAYER),
            overlayOpacity: Schema.number().default(DEFAULT_OVERLAY_OPACITY),
            // Alert thresholds — percentages (0–100) for thresholds, ms for intervals
            memThresholdInfo: Schema.number().default(DEFAULT_MEM_THRESHOLD_INFO),
            memThresholdWarning: Schema.number().default(DEFAULT_MEM_THRESHOLD_WARNING),
            memThresholdError: Schema.number().default(DEFAULT_MEM_THRESHOLD_ERROR),
            memPollBase: Schema.number().default(DEFAULT_MEM_POLL_BASE),
            memPollMin: Schema.number().default(DEFAULT_MEM_POLL_MIN),
            ctxApproxWindow: Schema.number().default(DEFAULT_CTX_APPROX_WINDOW),
            ctxTokensPerMsg: Schema.number().default(DEFAULT_CTX_TOKENS_PER_MSG),
            ctxThresholdInfo: Schema.number().default(DEFAULT_CTX_THRESHOLD_INFO),
            ctxThresholdWarning: Schema.number().default(DEFAULT_CTX_THRESHOLD_WARNING),
            ctxThresholdError: Schema.number().default(DEFAULT_CTX_THRESHOLD_ERROR),
            ctxPollBase: Schema.number().default(DEFAULT_CTX_POLL_BASE),
            ctxPollMin: Schema.number().default(DEFAULT_CTX_POLL_MIN),
            netSlowThreshold: Schema.number().default(DEFAULT_NET_SLOW_THRESHOLD),
            netPollBase: Schema.number().default(DEFAULT_NET_POLL_BASE),
            netPollMin: Schema.number().default(DEFAULT_NET_POLL_MIN),
            hostAlertQueueCap: Schema.number().default(DEFAULT_HOST_ALERT_QUEUE_CAP),
            hostAlertMaxAge: Schema.number().default(DEFAULT_HOST_ALERT_MAX_AGE),
            // Network Monitor (outbound request auditor)
            netLogCap: Schema.number().default(DEFAULT_NET_LOG_CAP),
            netSuspectWarn: Schema.number().default(DEFAULT_NET_SUSPECT_WARN),
            netSuspectErr: Schema.number().default(DEFAULT_NET_SUSPECT_ERR),
            netWhitelist: Schema.array(Schema.string()).default([]),
        });
        settingsCtx.settings.installSection(ctx, 'dock-flash', SettingsSchema, entry, {
            setSource: (current) => {
                source = current;
            },
            onChange: () => {
                try {
                    const cfg = source();
                    // Keep the Network Monitor thresholds/whitelist in step with any
                    // settings write (a whitelist edit flows through this path).
                    reconfigure();
                    // Migrate legacy useProxy → proxyMode on first change
                    let mode = cfg.proxyMode || DEFAULT_MODE;
                    if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
                        mode = cfg.useProxy ? 'all-proxy' : 'all-bypass';
                        cfg.proxyMode = mode;
                    }
                    applyProxyEnv(mode, cfg.customNoProxy || '');
                }
                catch (e) {
                    console.error('[dock-flash] failed to update proxy setting:', e);
                }
            },
        });
        // Apply the initial state immediately
        try {
            const cfg = source();
            let mode = cfg.proxyMode || DEFAULT_MODE;
            if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
                mode = cfg.useProxy ? 'all-proxy' : 'all-bypass';
                cfg.proxyMode = mode;
            }
            applyProxyEnv(mode, cfg.customNoProxy || '');
        }
        catch (_) { }
    });
    // ── HTTP API routes for client-side features ──────────────────────────
    // The webServer type augmentation lives in @deepseek-ai/dsh-host-webserver
    // which is not a direct dependency; cast through `any` for the register calls.
    ctx.inject(['webServer'], (wsCtx) => {
        // #4/#6: Proxy status — returns the current proxyMode, customNoProxy,
        // the test target, and the actual NO_PROXY env var value so the client
        // can show the real state.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/proxy-status',
            handler: async (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET');
                    res.end();
                    return;
                }
                const cfg = source();
                let mode = cfg.proxyMode || DEFAULT_MODE;
                if (!cfg.proxyMode && typeof cfg.useProxy === 'boolean') {
                    mode = cfg.useProxy ? 'all-proxy' : 'all-bypass';
                }
                const custom = cfg.customNoProxy || '';
                const testUrl = resolveTestUrl();
                const route = await proxyRouteForUrl(testUrl);
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
                });
            },
        }), 'dock-flash: GET /plugins/dock-flash/proxy-status');
        // #5 (v1.0.7): Connection test with diagnostics — walks the redirect chain
        // manually, measures headers vs body separately, and reports the proxy
        // route decision plus the underlying socket error code.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/test-connection',
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'POST');
                    res.end();
                    return;
                }
                // Optional `{ url }` override; falls back to the stored setting.
                const body = await readJsonBody(req);
                const testUrl = resolveTestUrl(body && body.url);
                let target;
                try {
                    target = new URL(testUrl);
                    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
                        throw new Error('unsupported protocol: ' + target.protocol);
                    }
                }
                catch (e) {
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
                    });
                    return;
                }
                try {
                    sendJson(res, 200, await runConnectionTest(testUrl));
                }
                catch (e) {
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
                    });
                }
            },
        }), 'dock-flash: POST /plugins/dock-flash/test-connection');
        // ── Host-side alert queue for server-push alerts ───────────────────
        // External tools or the host process itself can push alerts that the
        // client will pick up on the next poll.  The queue is in-memory only
        // (lost on restart), capped and pruned from settings the sliders control.
        const _alertQueue = [];
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/push-alert',
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'POST');
                    res.end();
                    return;
                }
                const body = await readJsonBody(req);
                if (!body || !body.id || !body.title) {
                    sendJson(res, 400, { error: 'Missing required fields: id, title' });
                    return;
                }
                const cfg = source();
                const cap = cfg.hostAlertQueueCap || DEFAULT_HOST_ALERT_QUEUE_CAP;
                const maxAgeHours = cfg.hostAlertMaxAge ?? DEFAULT_HOST_ALERT_MAX_AGE;
                const maxAgeMs = (maxAgeHours > 0 ? maxAgeHours : DEFAULT_HOST_ALERT_MAX_AGE) * 3600_000;
                const cutoff = Date.now() - maxAgeMs;
                // Prune expired entries first, then cap the queue
                for (let i = _alertQueue.length - 1; i >= 0; i--) {
                    if (_alertQueue[i].timestamp && _alertQueue[i].timestamp < cutoff) {
                        _alertQueue.splice(i, 1);
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
                };
                _alertQueue.push(alert);
                // Cap the queue — drop the oldest entries
                while (_alertQueue.length > cap)
                    _alertQueue.shift();
                sendJson(res, 200, { ok: true, queued: _alertQueue.length });
            },
        }), 'dock-flash: POST /plugins/dock-flash/push-alert');
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/host-alerts',
            handler: async (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET');
                    res.end();
                    return;
                }
                const cfg = source();
                const maxAgeHours = cfg.hostAlertMaxAge ?? DEFAULT_HOST_ALERT_MAX_AGE;
                const maxAgeMs = (maxAgeHours > 0 ? maxAgeHours : DEFAULT_HOST_ALERT_MAX_AGE) * 3600_000;
                const cutoff = Date.now() - maxAgeMs;
                // Prune expired entries before draining
                for (let i = _alertQueue.length - 1; i >= 0; i--) {
                    if (_alertQueue[i].timestamp && _alertQueue[i].timestamp < cutoff) {
                        _alertQueue.splice(i, 1);
                    }
                }
                // Drain the queue — splice out everything and return it
                const alerts = _alertQueue.splice(0, _alertQueue.length);
                sendJson(res, 200, { alerts });
            },
        }), 'dock-flash: GET /plugins/dock-flash/host-alerts');
        // ── Network Monitor routes (outbound request auditor) ─────────────
        // Paged snapshot of the audited-request ring buffer, newest first.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/network-log',
            handler: async (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET');
                    res.end();
                    return;
                }
                if (!_networkMonitor) {
                    sendJson(res, 200, { entries: [], offset: 0 });
                    return;
                }
                const u = new URL(req.url || '/', 'http://localhost');
                const offset = Math.max(0, parseInt(u.searchParams.get('offset') || '0', 10) || 0);
                let limit = parseInt(u.searchParams.get('limit') || '100', 10) || 100;
                limit = Math.max(1, Math.min(limit, 500));
                const all = _networkMonitor.snapshot().reverse();
                const entries = all.slice(offset, offset + limit);
                sendJson(res, 200, { entries, offset, limit, total: all.length });
            },
        }), 'dock-flash: GET /plugins/dock-flash/network-log');
        // Suspicious/dangerous requests (risk >= warn threshold).
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/network-alerts',
            handler: async (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET');
                    res.end();
                    return;
                }
                if (!_networkMonitor) {
                    sendJson(res, 200, { alerts: [] });
                    return;
                }
                const cfg = source();
                const threshold = cfg.netSuspectWarn ?? DEFAULT_NET_SUSPECT_WARN;
                sendJson(res, 200, { alerts: _networkMonitor.alerts(threshold).reverse() });
            },
        }), 'dock-flash: GET /plugins/dock-flash/network-alerts');
        // Whitelist management — persist trusted hosts via the settings service.
        // The client writes through the same `ctx.remote.settings` path as the
        // proxies; this route is a convenience for tools that cannot reach the
        // settings service. We re-resolve and call reconfigure() ourselves so the
        // monitor picks up the change immediately regardless of which writer used.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/network-whitelist',
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'POST');
                    res.end();
                    return;
                }
                const body = await readJsonBody(req);
                if (!body || !Array.isArray(body.hosts)) {
                    sendJson(res, 400, { error: 'Missing or invalid hosts array' });
                    return;
                }
                const hosts = [];
                for (const h of body.hosts) {
                    if (typeof h !== 'string') {
                        sendJson(res, 400, { error: 'hosts must be strings' });
                        return;
                    }
                    try {
                        // Validate: each entry must parse as a valid host (optionally :port).
                        const s = h.trim();
                        if (!s)
                            continue;
                        new URL('http://' + s.replace(/^https?:\/\//i, ''));
                        hosts.push(s.toLowerCase());
                    }
                    catch (_) {
                        sendJson(res, 400, { error: 'Invalid host: ' + h });
                        return;
                    }
                }
                if (_networkMonitor)
                    _networkMonitor.setUserTrusted(hosts);
                // Persist so the setting survives restart. If the remote settings
                // service is unavailable we still apply the in-memory override above.
                let rs = null;
                try {
                    rs = ctx.get ? ctx.get('remote.settings') ?? ctx.remote?.settings ?? null : null;
                }
                catch (_) {
                    rs = null;
                }
                if (rs && typeof rs.update === 'function') {
                    try {
                        await rs.update('dock-flash', { netWhitelist: hosts });
                    }
                    catch (_) { /* memory override already in force */ }
                }
                sendJson(res, 200, { ok: true, hosts });
            },
        }), 'dock-flash: POST /plugins/dock-flash/network-whitelist');
    });
}
