import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
// Default export only (`export default Schema`); there is no named `Schema`.
import Schema from '@deepseek-ai/schemastery';
export const name = 'dock-flash';
// No host-side service dependencies; all services are injected lazily.
export const inject = [];
const DEFAULT_MODE = 'all-proxy';
const DEFAULT_CUSTOM = '';
const DEFAULT_USE_SYSTEM_PROXY = false;
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
    useSystemProxy: DEFAULT_USE_SYSTEM_PROXY,
};
/** Domains that bypass the proxy when proxyMode is 'api-bypass'. */
const API_BYPASS_DOMAINS = 'api.deepseek.com,chat.deepseek.com';
/** Map a proxyMode (+ optional customNoProxy) to the actual NO_PROXY value. */
function resolveNoProxy(mode, custom) {
    switch (mode) {
        case 'all-proxy': return undefined; // no bypass → all traffic proxied
        case 'api-bypass': return API_BYPASS_DOMAINS;
        case 'all-bypass': return '*';
        case 'custom': return custom || '';
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
/** An EnvLookup over process.env — the fallback when no snapshot is provided. */
function processEnvLookup() {
    return {
        get(name) {
            const value = process.env[name];
            return value !== undefined && value !== '' ? { value } : undefined;
        },
    };
}
// ── Windows "Manual proxy setup" ──────────────────────────────────────────
//
// Settings → Network & Internet → Proxy writes this registry key. It is a
// completely separate store from the proxy *environment variables* everything
// else here is built on, and Node never consults it: undici has no OS-proxy
// integration, so a Windows manual proxy does NOT affect DSH's outbound
// requests. That is why reading it is opt-in — it is a proxy the user has
// configured for WinINET apps, not one anything in this process is using.
const WIN_PROXY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
/** `reg query` spawns a process, so keep the answer briefly. */
const WIN_PROXY_TTL_MS = 10_000;
const EMPTY_WIN_PROXY = (platform, error) => ({
    platform, readable: error === null, enabled: false, server: null,
    httpProxy: null, httpsProxy: null, socksProxy: null,
    override: null, noProxy: null, pacUrl: null, error,
});
let _winProxyCache = null;
/** One value out of the proxy key, or null when it is absent. */
function readRegistryValue(name) {
    try {
        const out = execFileSync('reg', ['query', WIN_PROXY_KEY, '/v', name], {
            encoding: 'utf8',
            windowsHide: true,
        });
        // `    Name    REG_TYPE    value` — the type token is stable in English even
        // on a localized Windows, which the leading columns are not.
        for (const line of String(out).split(/\r?\n/)) {
            const m = line.match(/^\s+(\S+)\s+(REG_[A-Z_]+)\s*(.*)$/);
            if (m && m[1].toLowerCase() === name.toLowerCase())
                return m[3].trim();
        }
        return null;
    }
    catch (_) {
        // Absent value or unreadable key — `reg` exits non-zero for both.
        return null;
    }
}
/** `host:port` → `http://host:port`, or null when it is not usable. */
function normalizeProxyUrl(raw) {
    if (!raw)
        return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'http://' + raw;
    try {
        const u = new URL(withScheme);
        if (!u.hostname || !u.port)
            return null;
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return null;
        return u.origin;
    }
    catch (_) {
        return null;
    }
}
/**
 * WinINET stores either one `host:port` for everything, or a per-scheme list
 * (`http=…;https=…;socks=…`).
 */
function parseProxyServer(raw) {
    const out = { http: null, https: null, socks: null };
    if (!raw)
        return out;
    if (!raw.includes('=')) {
        out.http = normalizeProxyUrl(raw);
        out.https = out.http;
        return out;
    }
    const seen = {};
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i < 0)
            continue;
        seen[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    out.http = normalizeProxyUrl(seen.http || null);
    out.https = normalizeProxyUrl(seen.https || seen.http || null);
    // Kept as the raw `host:port` on purpose: normalizing it to `http://` would
    // present a SOCKS proxy as an HTTP one, and this field exists only so the UI
    // can say "a SOCKS proxy is configured and cannot be applied".
    out.socks = seen.socks || null;
    return out;
}
/**
 * ProxyOverride → NO_PROXY. An approximation, deliberately: these are WinINET
 * patterns, and undici's matcher is not WinINET.
 *
 * - `local` and `<local>` are dropped. Windows writes either spelling for
 *   "bypass local addresses", and neither is a host name — keeping `local`
 *   would put a bogus entry in the bypass list. The package merges
 *   `LOOPBACK_NO_PROXY` into every policy anyway, so loopback is covered.
 * - `*` means bypass everything, which NO_PROXY spells the same way.
 * - everything else is passed through; `*.example.com`-style wildcards happen
 *   to line up, bare host and host:port entries do too.
 */
function mapProxyOverride(raw) {
    if (!raw)
        return null;
    const out = [];
    for (const entry of raw.split(';')) {
        const v = entry.trim();
        if (!v)
            continue;
        const lower = v.toLowerCase();
        if (lower === 'local' || lower === '<local>')
            continue;
        if (v === '*')
            return '*';
        out.push(v);
    }
    return out.length ? out.join(',') : null;
}
/** Read the Windows manual proxy setting, cached for WIN_PROXY_TTL_MS. */
function readWindowsProxy(force = false) {
    const now = Date.now();
    if (!force && _winProxyCache && now - _winProxyCache.at < WIN_PROXY_TTL_MS) {
        return _winProxyCache.value;
    }
    const platform = process.platform;
    let value;
    if (platform !== 'win32') {
        value = EMPTY_WIN_PROXY(platform, null);
    }
    else {
        try {
            const enabledRaw = readRegistryValue('ProxyEnable');
            // ProxyEnable is a REG_DWORD; "0x1" means on. Absent means off.
            const enabled = !!enabledRaw && parseInt(enabledRaw, 16) !== 0;
            const server = readRegistryValue('ProxyServer');
            const override = readRegistryValue('ProxyOverride');
            const pacUrl = readRegistryValue('AutoConfigURL');
            const parsed = parseProxyServer(server);
            value = {
                platform,
                readable: true,
                enabled,
                server,
                httpProxy: parsed.http,
                httpsProxy: parsed.https,
                socksProxy: parsed.socks,
                override,
                noProxy: mapProxyOverride(override),
                pacUrl,
                error: null,
            };
        }
        catch (e) {
            value = EMPTY_WIN_PROXY(platform, e?.message || String(e));
        }
    }
    _winProxyCache = { at: now, value };
    return value;
}
/** The registry proxy is usable as a policy source. */
function windowsProxyUsable(p) {
    return p.platform === 'win32' && p.readable && p.enabled && !!(p.httpProxy || p.httpsProxy);
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
     * The proxy variables the *user* supplied — frozen on first read, and read
     * from the launch snapshot in preference to process.env.
     *
     * This must never be re-read live. Installing a policy makes
     * `dsh-http-proxy` publish the resolved values into `process.env` (that is
     * how spawned children and `node:http` are meant to see them), so a live read
     * would report this plugin's own publication back as a user-provided
     * variable. The failure would be silent and self-locking: `proxySource` flips
     * from `windows-registry` to `env`, and the Windows opt-in toggle disappears
     * the instant it is switched on, with no way to switch it back off.
     */
    let _userEnvProxy = null;
    function userEnvProxy() {
        if (_userEnvProxy)
            return _userEnvProxy;
        const snapshot = launchEnvironment();
        const read = (names) => {
            for (const name of names) {
                const fromSnapshot = snapshot ? snapshot.get(name) : undefined;
                if (fromSnapshot && fromSnapshot.value)
                    return fromSnapshot.value;
                // process.env only when no snapshot exists at all: once an install has
                // run, values there may be ours rather than the user's.
                if (!snapshot) {
                    const raw = process.env[name];
                    if (raw)
                        return raw;
                }
            }
            return null;
        };
        const http = read(['http_proxy', 'HTTP_PROXY']);
        const https = read(['https_proxy', 'HTTPS_PROXY']);
        _userEnvProxy = { http, https, any: http || https || read(['all_proxy', 'ALL_PROXY']) };
        return _userEnvProxy;
    }
    /**
     * The proxy addresses in effect, and where they came from.
     *
     * Environment variables always win. The Windows setting is only ever a
     * fallback, only when the user opted in, and only when *no* proxy variable
     * exists at all — including `ALL_PROXY`, which would otherwise be silently
     * overridden. That setting is written for WinINET apps, so preferring it over
     * an explicit environment variable would overrule a deliberate choice.
     */
    function proxyAddresses() {
        const env = userEnvProxy();
        const envAny = env.any;
        const win = readWindowsProxy();
        if (envAny) {
            return { source: 'env', httpProxy: env.http, httpsProxy: env.https, envProxy: envAny, win, warning: null };
        }
        if (!source().useSystemProxy) {
            return { source: 'none', httpProxy: null, httpsProxy: null, envProxy: null, win, warning: null };
        }
        if (!windowsProxyUsable(win)) {
            return {
                source: 'none', httpProxy: null, httpsProxy: null, envProxy: null, win,
                warning: win.pacUrl ? 'pac-only' : 'windows-proxy-unavailable',
            };
        }
        // SOCKS is reported but never applied: the environment policy rejects it,
        // and inventing a tunnel here would be a different feature.
        const warning = win.httpProxy || win.httpsProxy ? null : 'socks-only';
        if (warning) {
            return { source: 'none', httpProxy: null, httpsProxy: null, envProxy: null, win, warning };
        }
        return {
            source: 'windows-registry',
            httpProxy: win.httpProxy,
            httpsProxy: win.httpsProxy,
            envProxy: null,
            win,
            warning: null,
        };
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
            console.warn('[dock-flash] proxy module unavailable — routing is unchanged (the mode now affects child processes only)');
            return;
        }
        // Base the policy on DSH's own snapshot so that nothing but the bypass list
        // changes. Resolving from process.env would silently disagree with the
        // policy DSH installed: its snapshot also merges the project-env and
        // user-env layers, which process.env knows nothing about.
        const snapshot = launchEnvironment();
        const base = snapshot || processEnvLookup();
        const addresses = proxyAddresses();
        const useRegistry = addresses.source === 'windows-registry';
        const envLookup = {
            get(name) {
                // undici reads the lowercase spelling first, so both are owned here.
                if (name === 'NO_PROXY' || name === 'no_proxy') {
                    return noProxy === undefined ? undefined : { value: noProxy };
                }
                if (useRegistry && (name === 'http_proxy' || name === 'HTTP_PROXY')) {
                    return addresses.httpProxy ? { value: addresses.httpProxy } : undefined;
                }
                if (useRegistry && (name === 'https_proxy' || name === 'HTTPS_PROXY')) {
                    return addresses.httpsProxy ? { value: addresses.httpsProxy } : undefined;
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
                (snapshot ? 'launchEnvironment' : 'process.env') +
                ', proxy source=' + addresses.source + ')');
            // Deliberately NOT written into process.env. Publishing it there would
            // make `proxyAddresses()` see it as a user-provided environment variable
            // on the very next read — which would silently disable the opt-in and
            // leave the toggle stuck on with no way to turn it off. Children therefore
            // do not inherit the registry proxy; the dispatcher policy is what governs
            // this process's own requests, which is the whole point.
        }
        catch (e) {
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
        const addresses = proxyAddresses();
        return {
            mode,
            // What this plugin published for the current mode: the value that governs
            // routing once the dispatcher has been re-installed.
            noProxy: resolveNoProxy(mode, custom) ?? null,
            // The address actually in force, whichever source supplied it, so the log
            // line means "what this process would use" rather than "what the
            // environment happens to say".
            httpProxy: addresses.httpsProxy || addresses.httpProxy,
            proxySource: addresses.source,
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
    // namespace and watch for proxy preference changes.
    ctx.inject(['settings'], (settingsCtx) => {
        const ProxySchema = Schema.object({
            proxyMode: Schema.string().default(DEFAULT_MODE),
            customNoProxy: Schema.string().default(DEFAULT_CUSTOM),
            testUrl: Schema.string().default(DEFAULT_TEST_URL),
            useSystemProxy: Schema.boolean().default(DEFAULT_USE_SYSTEM_PROXY),
            // Keep the old field so legacy clients don't break; migrated on read.
            useProxy: Schema.boolean().default(true),
        });
        settingsCtx.settings.installSection(ctx, 'dock-flash', ProxySchema, entry, {
            setSource: (current) => {
                source = current;
            },
            onChange: () => {
                try {
                    const cfg = source();
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
                const addresses = proxyAddresses();
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
                    // The address in force, whichever source supplied it. `proxyAvailable`
                    // alone cannot distinguish "no proxy configured" from "configured, and
                    // this URL is deliberately bypassed", and the client needs to know a
                    // proxy is in play at all to decide what to show.
                    httpProxy: addresses.httpsProxy || addresses.httpProxy,
                    // Environment-derived address *only*. Kept separate from `httpProxy`
                    // because it is what decides whether the Windows opt-in is offered:
                    // folding the registry value in would hide the toggle the moment it
                    // was switched on, leaving no way back.
                    envProxy: addresses.envProxy,
                    proxySource: addresses.source,
                    proxyWarning: addresses.warning,
                    useSystemProxy: !!cfg.useSystemProxy,
                    // Enough for the client to decide whether to offer the opt-in, and to
                    // explain itself when the registry cannot be honoured.
                    systemProxy: {
                        platform: addresses.win.platform,
                        readable: addresses.win.readable,
                        enabled: addresses.win.enabled,
                        server: addresses.win.server,
                        httpProxy: addresses.win.httpProxy,
                        httpsProxy: addresses.win.httpsProxy,
                        socksProxy: addresses.win.socksProxy,
                        override: addresses.win.override,
                        noProxy: addresses.win.noProxy,
                        pacUrl: addresses.win.pacUrl,
                        error: addresses.win.error,
                    },
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
    });
}
