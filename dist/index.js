import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
export const name = 'dock-flash';
// No host-side service dependencies; all services are injected lazily.
export const inject = [];
const DEFAULT_MODE = 'all-proxy';
const DEFAULT_CUSTOM = '';
const entry = { proxyMode: DEFAULT_MODE, customNoProxy: DEFAULT_CUSTOM };
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
    // Re-install the undici global dispatcher so it picks up the new NO_PROXY.
    try {
        const { installProxyFromEnvironment } = require('@deepseek-ai/dsh-http-proxy');
        // Build a simple EnvLookup from process.env
        const envLookup = {
            get(name) {
                const value = process.env[name];
                return value !== undefined && value !== '' ? { value } : undefined;
            },
        };
        await installProxyFromEnvironment(envLookup, (msg) => {
            console.warn('[dock-flash] proxy install warning: ' + msg);
        });
        console.log('[dock-flash] undici global dispatcher re-installed');
    }
    catch (e) {
        // dsh-http-proxy may not be available in all environments
        console.warn('[dock-flash] could not re-install proxy dispatcher:', e.message || e);
    }
}
/** Send a JSON response with no-store cache control. */
function sendJson(res, status, payload) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
}
/** URL used to test outbound connectivity. */
const TEST_URL = 'https://www.google.com/generate_204';
export function apply(ctx) {
    /** Check whether a proxy is actively routing requests. */
    function hasActiveProxy() {
        try {
            const { proxyRouteFor } = require('@deepseek-ai/dsh-http-proxy');
            const route = proxyRouteFor('https://github.com');
            return route?.proxied === true;
        }
        catch (_) {
            return false;
        }
    }
    // The authoritative config: the settings section while one is attached,
    // the composition entry otherwise.
    let source = () => entry;
    // When the settings service is available, register the dock-flash
    // namespace and watch for proxy preference changes.
    ctx.inject(['settings'], (settingsCtx) => {
        const { Schema } = require('@deepseek-ai/schemastery');
        const ProxySchema = Schema.object({
            proxyMode: Schema.string().default(DEFAULT_MODE),
            customNoProxy: Schema.string().default(DEFAULT_CUSTOM),
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
        // and the actual NO_PROXY env var value so the client can show the real state.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/proxy-status',
            handler: (req, res) => {
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
                const noProxy = process.env.NO_PROXY || process.env.no_proxy || null;
                sendJson(res, 200, {
                    proxyMode: mode,
                    customNoProxy: cfg.customNoProxy || '',
                    noProxy,
                    proxyAvailable: hasActiveProxy(),
                });
            },
        }), 'dock-flash: GET /plugins/dock-flash/proxy-status');
        // #5: Connection test — fetches a well-known URL from the host side
        // and reports success/failure + latency back to the client.
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
                const t0 = Date.now();
                try {
                    const resp = await fetch(TEST_URL, {
                        method: 'GET',
                        signal: AbortSignal.timeout(10000),
                        redirect: 'follow',
                    });
                    const latencyMs = Date.now() - t0;
                    // Any HTTP response means the network path is working
                    sendJson(res, 200, { ok: true, latencyMs, url: TEST_URL, status: resp.status });
                }
                catch (e) {
                    const latencyMs = Date.now() - t0;
                    sendJson(res, 200, {
                        ok: false,
                        latencyMs,
                        url: TEST_URL,
                        error: e.message || String(e),
                    });
                }
            },
        }), 'dock-flash: POST /plugins/dock-flash/test-connection');
    });
}
