import { execFileSync } from 'node:child_process';
import { platform, homedir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
// Memory thresholds are now in MB (RSS absolute value).
// GC thresholds: majorPerMin = major GC cycles per minute.
/** Memory alert thresholds (RSS MB). */
const DEFAULT_MEM_THRESHOLD_INFO = 256;
const DEFAULT_MEM_THRESHOLD_WARNING = 512;
const DEFAULT_MEM_THRESHOLD_ERROR = 1024;
const DEFAULT_MEM_THRESHOLD_CRITICAL = 1536;
/** Memory polling: base interval and minimum (ms). */
const DEFAULT_MEM_POLL_BASE = 30000;
const DEFAULT_MEM_POLL_MIN = 2000;
/** GC alert thresholds (major GC cycles per minute). */
const DEFAULT_GC_THRESHOLD_INFO = 2;
const DEFAULT_GC_THRESHOLD_WARNING = 5;
const DEFAULT_GC_THRESHOLD_ERROR = 10;
/** Context window approximation (tokens). Used as default when the model
 *  is not in the built-in or user-configured window table. */
const DEFAULT_CTX_APPROX_WINDOW = 128000;
/** Context alert thresholds (% of estimated window). */
const DEFAULT_CTX_THRESHOLD_INFO = 70;
const DEFAULT_CTX_THRESHOLD_WARNING = 85;
const DEFAULT_CTX_THRESHOLD_ERROR = 95;
/** Context polling: base interval and minimum (ms). */
const DEFAULT_CTX_POLL_BASE = 20000;
const DEFAULT_CTX_POLL_MIN = 2000;
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
    // Memory thresholds: RSS absolute value (MB). GC thresholds: major GC/min.
    // When physical splitting occurs, these stay in dock-flash alongside A.
    memThresholdInfo: Schema.number().default(DEFAULT_MEM_THRESHOLD_INFO).volatile(),
    memThresholdWarning: Schema.number().default(DEFAULT_MEM_THRESHOLD_WARNING).volatile(),
    memThresholdError: Schema.number().default(DEFAULT_MEM_THRESHOLD_ERROR).volatile(),
    memThresholdCritical: Schema.number().default(DEFAULT_MEM_THRESHOLD_CRITICAL).volatile(),
    memPollBase: Schema.number().default(DEFAULT_MEM_POLL_BASE).volatile(),
    memPollMin: Schema.number().default(DEFAULT_MEM_POLL_MIN).volatile(),
    gcThresholdInfo: Schema.number().default(DEFAULT_GC_THRESHOLD_INFO).volatile(),
    gcThresholdWarning: Schema.number().default(DEFAULT_GC_THRESHOLD_WARNING).volatile(),
    gcThresholdError: Schema.number().default(DEFAULT_GC_THRESHOLD_ERROR).volatile(),
    ctxApproxWindow: Schema.number().default(DEFAULT_CTX_APPROX_WINDOW).volatile(),
    ctxThresholdInfo: Schema.number().default(DEFAULT_CTX_THRESHOLD_INFO).volatile(),
    ctxThresholdWarning: Schema.number().default(DEFAULT_CTX_THRESHOLD_WARNING).volatile(),
    ctxThresholdError: Schema.number().default(DEFAULT_CTX_THRESHOLD_ERROR).volatile(),
    ctxPollBase: Schema.number().default(DEFAULT_CTX_POLL_BASE).volatile(),
    ctxPollMin: Schema.number().default(DEFAULT_CTX_POLL_MIN).volatile(),
    modelContextWindows: Schema.dict(Schema.number()).default({}).volatile(),
    modelContextWindowSources: Schema.dict(Schema.string()).default({}).volatile(),
    hostAlertQueueCap: Schema.number().default(DEFAULT_HOST_ALERT_QUEUE_CAP).volatile(),
    hostAlertMaxAge: Schema.number().default(DEFAULT_HOST_ALERT_MAX_AGE).volatile(),
});
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
 * The ctx service DSH's profile launcher publishes with the facts of the profile
 * it booted: `{ name, dir, patchPath, installAnchor, startedBundles, cwd, home }`
 * (`@deepseek-ai/dsh-app-boot` → `ProfileContext`). It is provided from the boot
 * callback in `dsh`'s `runProfile()` *before* any profile plugin is mounted, so a
 * host plugin sees it during `apply()` — DSH's own `dsh-app-boot`,
 * `dsh-shell-env`, `dsh-plugin-manager`, `dsh-settings` and `dsh-config-editor`
 * all read it. DSH Desktop ships the identical `runProfile()` and provides the
 * same service, so this is the one profile signal correct in BOTH environments.
 *
 * `dsh-shell-env` builds `DSH_PROFILE` / `DSH_PROFILE_DIR` from this context per
 * shell execution — which is why those variables reach a model shell call and
 * never this process, and why they cannot be used to find the profile from here.
 */
const PROFILE_CONTEXT_SERVICE = 'profileContext';
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
class MemoryTrendCollector {
    _samples = [];
    _timer = null;
    _cap;
    // GC monitoring via PerformanceObserver
    _gcObserver = null; // PerformanceObserver | null
    _gcEvents = [];
    _gcEventsCap = 2000; // ~5 min at worst-case GC frequency
    /** Separate cap for major GC events only — they are rare and valuable for diagnostics. */
    _gcMajorEvents = [];
    _gcMajorEventsCap = 500; // Full GC events are rare; keep up to 500 (~hours)
    constructor(cap = 720) {
        this._cap = Math.max(10, cap);
    }
    start(baseInterval = 30_000, minInterval = 5_000) {
        this.stop();
        // Fire-and-forget: GC observer can start asynchronously; the poll loop
        // below begins immediately regardless, since it does not depend on GC.
        this._startGcObserver().catch(() => { });
        const poll = () => {
            const mu = process.memoryUsage();
            this._push({
                ts: Date.now(),
                rss: mu.rss,
                heapTotal: mu.heapTotal,
                heapUsed: mu.heapUsed,
                external: mu.external,
                arrayBuffers: mu.arrayBuffers,
            });
            // Adaptive: higher heap usage → shorter interval (sample more densely).
            const ratio = mu.heapUsed / mu.heapTotal;
            const next = Math.max(minInterval, Math.round(baseInterval * Math.pow(1 - Math.min(ratio, 1), 2) + minInterval));
            this._timer = setTimeout(poll, next);
            // Unref so the timer never keeps the process alive on its own.
            if (this._timer && typeof this._timer === 'object' && 'unref' in this._timer) {
                this._timer.unref();
            }
        };
        // First sample immediately.
        poll();
    }
    stop() {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
        this._stopGcObserver();
    }
    setCap(cap) {
        this._cap = Math.max(10, Math.floor(cap) || 10);
        while (this._samples.length > this._cap)
            this._samples.shift();
    }
    query(since) {
        if (!since)
            return this._samples.slice();
        return this._samples.filter(s => s.ts >= since);
    }
    /** Return recent GC events (last ~5 min) for chart rendering.
     *  Pass since=0 to return ALL stored events (for full-mode fetches). */
    gcEvents(since) {
        if (this._gcEvents.length === 0 && this._gcMajorEvents.length === 0)
            return [];
        const cutoff = since ?? (Date.now() - 5 * 60 * 1000);
        // Merge the general ring buffer with the dedicated major-GC buffer
        const all = this._gcEvents.concat(this._gcMajorEvents);
        // Deduplicate by (ts, kind) — major events that also appear in the general buffer
        const seen = new Set();
        const result = [];
        for (const e of all) {
            if (e.ts < cutoff)
                continue;
            const key = e.ts + '|' + e.kind + '|' + e.duration;
            if (seen.has(key))
                continue;
            seen.add(key);
            result.push(e);
        }
        // Sort by timestamp for consistent rendering
        result.sort((a, b) => a.ts - b.ts);
        return result;
    }
    summary(since) {
        const data = this.query(since);
        if (data.length === 0) {
            return { current: null, peak: null, trend: 'stable', sampleCount: 0, heapRatio: 0, spanSeconds: 0, rssSlopePerMin: 0, gc: null };
        }
        const current = data[data.length - 1];
        let peak = { heapUsed: 0, rss: 0, ts: 0 };
        for (const s of data) {
            if (s.heapUsed > peak.heapUsed)
                peak = { heapUsed: s.heapUsed, rss: s.rss, ts: s.ts };
        }
        // Simple linear regression on heapUsed over the last 20 samples (or fewer).
        const tail = data.slice(-20);
        let trend = 'stable';
        if (tail.length >= 3) {
            const n = tail.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            for (let i = 0; i < n; i++) {
                sumX += i;
                sumY += tail[i].heapUsed;
                sumXY += i * tail[i].heapUsed;
                sumXX += i * i;
            }
            const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            // Threshold: ±0.5% of current heapUsed per sample-index step.
            const threshold = current.heapUsed * 0.005;
            if (slope > threshold)
                trend = 'up';
            else if (slope < -threshold)
                trend = 'down';
        }
        const heapRatio = current.heapTotal > 0 ? current.heapUsed / current.heapTotal : 0;
        const spanSeconds = data.length >= 2 ? Math.round((data[data.length - 1].ts - data[0].ts) / 1000) : 0;
        // RSS linear regression over the last 20 samples → slope per minute (MB/min).
        let rssSlopePerMin = 0;
        if (tail.length >= 3) {
            const n = tail.length;
            let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
            for (let i = 0; i < n; i++) {
                sumX += i;
                sumY += tail[i].rss;
                sumXY += i * tail[i].rss;
                sumXX += i * i;
            }
            const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
            // slope = bytes per sample-index step.  Convert to MB/min.
            // Average interval between tail samples ≈ spanSeconds / (n-1).
            const avgIntervalSec = tail.length >= 2 ? spanSeconds / (tail.length - 1) : 30;
            const samplesPerMin = avgIntervalSec > 0 ? 60 / avgIntervalSec : 2;
            rssSlopePerMin = Math.round((slope * samplesPerMin / 1048576) * 100) / 100;
        }
        // GC stats over the last ~5 minutes.
        const gc = this._gcSummary(5 * 60 * 1000);
        return { current, peak, trend, sampleCount: data.length, heapRatio, spanSeconds, rssSlopePerMin, gc };
    }
    /** Aggregate GC events in the last `windowMs` milliseconds. */
    _gcSummary(windowMs) {
        if (this._gcEvents.length === 0)
            return null;
        const cutoff = Date.now() - windowMs;
        const recent = this._gcEvents.filter(e => e.ts >= cutoff);
        if (recent.length === 0)
            return null;
        let minorCount = 0, majorCount = 0, gcPauseMs = 0;
        for (const e of recent) {
            gcPauseMs += e.duration;
            if (e.kind === 2)
                majorCount++; // kind=2 → major (MarkSweep/MarkCompact)
            else if (e.kind === 1)
                minorCount++; // kind=1 → minor (Scavenge)
            // kind=4 (incremental marking), kind=8 (weak callbacks) — counted in pause but not as cycles
        }
        const windowMin = windowMs / 60000;
        return {
            minorCount,
            majorCount,
            majorPerMin: Math.round((majorCount / windowMin) * 100) / 100,
            gcPauseMs: Math.round(gcPauseMs * 100) / 100,
            gcPausePerMin: Math.round((gcPauseMs / windowMin) * 100) / 100,
        };
    }
    async _startGcObserver() {
        try {
            // Dynamic import — perf_hooks may not be available in all environments.
            // MUST use import(), not require(): this half is ESM, so require() throws
            // ReferenceError into the catch — silently disabling GC monitoring forever.
            const { PerformanceObserver } = await import('perf_hooks');
            this._gcObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    // GC entry kinds: 1=minor, 2=major, 4=incremental, 8=weak callbacks
                    const kind = entry.kind ?? 0;
                    const event = { ts: Date.now(), kind, duration: entry.duration };
                    this._gcEvents.push(event);
                    // Also store major (Full) GC events in a separate long-lived buffer,
                    // because they are rare and the general ring buffer may evict them.
                    if (kind === 2) {
                        this._gcMajorEvents.push(event);
                        while (this._gcMajorEvents.length > this._gcMajorEventsCap)
                            this._gcMajorEvents.shift();
                    }
                }
                // Cap the ring buffer.
                while (this._gcEvents.length > this._gcEventsCap)
                    this._gcEvents.shift();
            });
            this._gcObserver.observe({ type: 'gc', buffered: true });
        }
        catch (_) {
            // GC observation not available — gc will remain null in summaries.
            this._gcObserver = null;
        }
    }
    _stopGcObserver() {
        if (this._gcObserver) {
            try {
                this._gcObserver.disconnect();
            }
            catch (_) { }
            this._gcObserver = null;
        }
        this._gcEvents = [];
        this._gcMajorEvents = [];
    }
    _push(s) {
        this._samples.push(s);
        if (this._samples.length > this._cap)
            this._samples.shift();
    }
}
/** Module-level singleton — one collector per process. */
let _memoryTrend = null;
export function apply(ctx, config) {
    /**
     * This plugin's own package name. A profile's `package.json` lists what is
     * installed in it, so the profile whose dependencies name THIS plugin is the
     * one we are running in — see `profileDirCandidates()`.
     */
    const PLUGIN_NAME = name;
    // ── Memory trend collector bootstrap ──────────────────────────────────
    // One bounded ring buffer per process. Starts on first apply and stops on
    // dispose. The timer uses .unref() so it never keeps the process alive.
    if (!_memoryTrend)
        _memoryTrend = new MemoryTrendCollector();
    _memoryTrend.start((config.memPollBase?.get?.() ?? config.memPollBase) || DEFAULT_MEM_POLL_BASE, (config.memPollMin?.get?.() ?? config.memPollMin) || DEFAULT_MEM_POLL_MIN);
    ctx.effect(() => {
        const collector = _memoryTrend;
        return () => {
            collector?.stop();
            _memoryTrend = null;
        };
    });
    /**
     * The profile's PATCH document — the `disabled:` row DSH's own plugin manager
     * writes, and the LIVE switch. `@deepseek-ai/dsh-plugin-manager`'s patch module
     * sets `disabled: !enabled` on the matching item and writes the file atomically;
     * the loader watches that document, which is why its `setPluginEnabled()` can
     * answer `applied` instead of `restart-required`.
     *
     * A plugin cannot reach that call on DSH Desktop: the client remote answers
     * `unknown-plugin` for EVERY id, because its inventory does not manage this
     * reserved profile (`listPlugins()` is empty there). That left the bundle layer
     * as the only lever — and that one shapes the NEXT boot only, which is exactly
     * why every handle-less-skin switch demanded a DSH restart. The HOST half needs
     * no remote: it has the profile directory and the filesystem.
     *
     * Edits are textual and targeted rather than a YAML round trip, so the rest of
     * the document keeps its formatting, ordering and comments.
     */
    const PATCH_FILENAME = 'cordis.patch.yml';
    /** Same-directory temp + rename, so a reader never sees a partial document. */
    async function writePatchDocument(file, dir, text) {
        const temp = join(dir, '.' + PATCH_FILENAME + '.dock-flash-' + String(process.pid) + '.tmp');
        try {
            await writeFile(temp, text, { mode: 0o600 });
            await rename(temp, file);
            return {};
        }
        catch (error) {
            try {
                await unlink(temp);
            }
            catch (_) { /* nothing to clean up */ }
            return { error: String(error.message || error) };
        }
    }
    /**
     * One log line for a patch edit that actually CHANGED the document: which file,
     * what changed, and when. This is the host's `[dock-flash]` console, which is
     * where a DSH plugin's host half can report at all — there is no log surface in
     * the panel for it (the panel's `log` switches are client-side).
     *
     * A no-op call is deliberately NOT logged: an entry that reports "I wrote this"
     * when the document is byte-identical turns a change history into a click
     * history, and the two are read for different questions.
     *
     * The stamp is local time with its UTC offset (`…+08:00`), because the reader is
     * a person looking at a clock, and the ISO form is what makes a pasted line
     * unambiguous. Nothing here may carry a newline: a path — or a diff summary —
     * with an embedded line break would split one record into two.
     */
    function logPatchWrite(file, id, disabled, summary) {
        const at = new Date();
        const pad = (n, w = 2) => String(n).padStart(w, '0');
        const local = at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) +
            ' ' + pad(at.getHours()) + ':' + pad(at.getMinutes()) + ':' + pad(at.getSeconds());
        const offsetMin = -at.getTimezoneOffset();
        const sign = offsetMin < 0 ? '-' : '+';
        const abs = Math.abs(offsetMin);
        const zone = sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
        const oneLine = (v) => v.replace(/[\r\n]+/g, ' ');
        console.log('[dock-flash] patch ' + at.toISOString() + ' (' + local + ' ' + zone + ') ' +
            (disabled ? 'disable' : 'enable') + ' entry=' + id + ' file=' + oneLine(file));
        for (const line of summary)
            console.log('[dock-flash] patch   ' + oneLine(line));
    }
    /**
     * The LOADER ENTRY ID for a package — which is what a patch row must key on, and it is
     * NOT the package name. MEASURED, and it cost the whole feature: the profile's patch
     * carried `- id: dream-skin / disabled: false` (written by DSH's OWN plugin page) beside
     * my `- id: dsh-dream-skin / name: dsh-dream-skin / disabled: true`, and Dream kept
     * running — two different entries, and only the first is the loaded plugin. The remote
     * answered `unknown-plugin` for the package name for exactly the same reason.
     *
     * The package's OWN patch layer declares the id it inserts, so read
     * `node_modules/<pkg>/cordis.patch.yml` and take the `- id:` of the row whose
     * `name:` is this package (the indent matters: a plugin CONFIG may carry a
     * nested `name:` too). Falls back to the package name, which is only right when
     * a plugin's entry id happens to equal it.
     */
    async function entryIdFor(dir, pkg) {
        try {
            // The package's OWN patch layer declares the entry id it inserts, and that is the id
            // DSH's own plugin page switches. MEASURED on `dsh-dream-skin`: its cordis.patch.yml
            // carries `- insert: [ - id: dream-skin / name: 'dsh-dream-skin' ]`, which is also why
            // the plugin detail lists TWO rows — the package/bundle row and this loader entry — and
            // why addressing the PACKAGE name switched nothing. The profile's own layer is only a
            // fallback: the composed graph does not even carry a row for such a plugin.
            const text = await readFile(join(dir, 'node_modules', pkg, 'cordis.patch.yml'), 'utf8');
            const lines = text.split(/\r?\n/);
            const unquote = (v) => v.trim().replace(/^['"]|['"]$/g, '');
            let id = null;
            for (let i = 0; i < lines.length; i++) {
                const mi = /^\s*-?\s*id:\s*(.*)$/.exec(lines[i]);
                if (mi) {
                    id = unquote(mi[1]);
                    continue;
                }
                const mn = /^\s*name:\s*(.*)$/.exec(lines[i]);
                if (mn && id && unquote(mn[1]) === pkg)
                    return id;
            }
        }
        catch (_) { /* no graph on disk — the caller keeps the package name */ }
        return pkg;
    }
    /**
     * Set or clear one plugin's `disabled:` row. Mirrors the plugin manager's own
     * behaviour, including its two short-circuits: an item already in the wanted
     * state is left alone, and clearing a row that does not exist changes nothing.
     */
    async function setPatchDisabled(dir, id, disabled) {
        const file = join(dir, PATCH_FILENAME);
        let text;
        try {
            text = await readFile(file, 'utf8');
        }
        catch (error) {
            return { changed: false, error: PATCH_FILENAME + ' unreadable: ' + String(error.message || error) };
        }
        const eol = text.indexOf('\r\n') === -1 ? '\n' : '\r\n';
        const lines = text.split(/\r?\n/);
        const wanted = disabled ? 'true' : 'false';
        // Item boundaries: a top-level sequence entry begins at column 0 with `- `.
        const starts = [];
        for (let i = 0; i < lines.length; i++)
            if (/^-(\s|$)/.test(lines[i]))
                starts.push(i);
        const unquote = (v) => v.trim().replace(/^['"]|['"]$/g, '');
        // `-?\s*` is REQUIRED: a top-level item's id sits on its own `- id: X` line, so
        // a pattern demanding leading whitespace before `id:` matches NOTHING and every
        // call treats the plugin as absent. MEASURED: three identical
        // `- id: dsh-dream-skin` rows accumulated that way, and the duplicate rows then
        // left the disable ineffectual.
        const idOf = (line) => {
            const m = /^\s*-?\s*id:\s*(.*)$/.exec(line);
            return m ? unquote(m[1]) : null;
        };
        const found = starts.find((start, k) => {
            const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
            for (let i = start; i < end; i++) {
                if (idOf(lines[i]) === id)
                    return true;
            }
            return false;
        });
        if (found === undefined) {
            if (!disabled)
                return { changed: false }; // no row, and nothing to clear
            const body = lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
            // NO `name:`. MEASURED against DSH's own writer (`dsh-plugin-manager`'s
            // `writePluginEnabled`): when it has to append a row it writes exactly
            // `{ id, disabled }`. `dsh-app-boot`'s `applyEntryPatches` — the one algorithm that
            // composes this layer, the live loader included — SKIPS a row whose `name` differs
            // from the target entry's own name:
            //   warn("patch: name mismatch for %C (expected %C, got %C), skipping")
            // An earlier version of this writer echoed the ENTRY ID into `name:`, which could
            // never switch a skin whose entry id differs from its package name: `dsh-dream-skin`
            // inserts `- id: dream-skin / name: 'dsh-dream-skin'`, so every row written as
            // `id: dream-skin / name: dream-skin` was a name mismatch and was ignored. The
            // opposite mistake is just as fatal: keying the row by the PACKAGE name
            // (`- id: dsh-dream-skin`) matches no entry at all and is dropped with
            // "patch: entry … not found" — which is how three duplicate rows accumulated in a
            // profile before this was understood. `name` is optional here; the id is not.
            const next = body.concat(['- id: ' + id, '  disabled: ' + wanted, '']).join(eol);
            const wrote = await writePatchDocument(file, dir, next);
            if (wrote.error)
                return { changed: false, error: wrote.error };
            logPatchWrite(file, id, disabled, [
                '  reason: no row for this entry — appended one',
                '  added: "- id: ' + id + '" / "disabled: ' + wanted + '"',
            ]);
            return { changed: true };
        }
        const k = starts.indexOf(found);
        const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
        let at = -1;
        let indent = '  ';
        let before = null;
        for (let i = found + 1; i < end; i++) {
            const m = /^(\s+)disabled:\s*(.*)$/.exec(lines[i]);
            if (m) {
                at = i;
                indent = m[1];
                before = m[2].trim();
                break;
            }
        }
        // The change records WHICH row was edited and WHAT changed, not only the wanted
        // value: a log that says "disabled: true" cannot tell an appended row from a
        // flipped one, and that is the first thing the reader of this log asks.
        let summary;
        if (at >= 0) {
            if (lines[at] === indent + 'disabled: ' + wanted)
                return { changed: false };
            summary = [
                '  reason: existing row updated',
                '  line ' + (at + 1) + ': "disabled: ' + before + '" -> "disabled: ' + wanted + '"',
            ];
            lines[at] = indent + 'disabled: ' + wanted;
        }
        else {
            if (!disabled)
                return { changed: false };
            summary = [
                '  reason: row had no disabled field — inserted one',
                '  line ' + (found + 2) + ': added "disabled: ' + wanted + '"',
            ];
            lines.splice(found + 1, 0, '  disabled: ' + wanted);
        }
        const wrote = await writePatchDocument(file, dir, lines.join(eol));
        if (wrote.error)
            return { changed: false, error: wrote.error };
        logPatchWrite(file, id, disabled, summary);
        return { changed: true };
    }
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
     * Read a launch-environment variable the way the policy resolved it: the
     * launch snapshot first (it merges process / project-env / user-env),
     * process.env as fallback. The proxy variables are the main caller; the
     * profile inventory reads DSH_PROFILE_DIR / DSH_HOME through it too.
     */
    function readLaunchEnv(names) {
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
     * The profile facts the launcher published for THIS process, when there are
     * any. This is the only signal that NAMES the running profile; everything else
     * in `profileDirCandidates()` is inference. Absent when DSH was booted without
     * a profile launcher (an explicit `--config`, a test harness).
     */
    function profileContext() {
        try {
            const svc = ctx.get ? ctx.get(PROFILE_CONTEXT_SERVICE) : undefined;
            return svc && typeof svc === 'object'
                ? svc
                : null;
        }
        catch (_) {
            return null;
        }
    }
    /** The config directory cordis booted from — the profile dir in a profile boot. */
    function bootBaseDir() {
        try {
            const base = ctx.baseUrl;
            return typeof base === 'string' && base.startsWith('file:') ? dirname(fileURLToPath(base)) : null;
        }
        catch (_) {
            return null;
        }
    }
    /**
     * Candidate directories for the profile this host boots plugins for, best
     * first.
     *
     * **Do not assume `DSH_PROFILE_DIR` is set here.** MEASURED: the harness
     * exports `DSH_PROFILE` / `DSH_PROFILE_DIR` into every *model shell call* of a
     * profile-launched session and omits both when it was booted without a
     * profile — they are shell facts, not facts of the Electron host process, so a
     * host plugin sees neither. The first version of this function trusted them and
     * answered "the launch environment names no profile directory" from the
     * running Desktop app.
     *
     * The launcher does publish the answer, though: every profile boot provides
     * `profileContext` (`name`, `dir`, `patchPath`, …) before any plugin mounts, so
     * that is the first candidate, with `ctx.baseUrl` (the boot config's directory)
     * behind it as an independent second.
     *
     * The rest is a FOUND profile rather than a declared one, kept for a boot with
     * no profile launcher behind it. The old best signal — "a profile's
     * `package.json` lists the plugins installed in it, so the profile that lists
     * THIS plugin is the one we are running in" — is NOT sufficient:
     * MEASURED, `~/.dsh/profiles` held BOTH `desktop` and `web`, both installed
     * dock-flash, `readdirSync` returns `desktop` first, and a `dsh web` process
     * therefore resolved the DESKTOP profile: `/plugins/dock-flash/profile-packages`
     * answered `dir: …\profiles\desktop` and every skin toggle wrote
     * `profiles/desktop/cordis.patch.yml` while the running loader watched
     * `profiles/web/cordis.patch.yml`. Each write honestly reported
     * `application: "applied"`, the page reloaded, and no skin ever came up —
     * because the document being edited was not the one being watched.
     */
    function profileDirCandidates() {
        const out = [];
        const push = (dir) => {
            if (dir && out.indexOf(dir) === -1)
                out.push(dir);
        };
        const facts = profileContext();
        if (facts) {
            push(facts.dir);
            // `patchPath` is the document the running loader actually watches, so its
            // directory is the profile even if `dir` were missing or ever renamed.
            if (facts.patchPath)
                push(dirname(facts.patchPath));
        }
        push(bootBaseDir());
        push(readLaunchEnv(['DSH_PROFILE_DIR']));
        const home = readLaunchEnv(['DSH_HOME']) || join(homedir(), '.dsh');
        const named = readLaunchEnv(['DSH_PROFILE']) || (facts && facts.name);
        if (named)
            push(join(home, 'profiles', named));
        const argv = process.argv;
        for (let i = 0; i < argv.length - 1; i++) {
            if (argv[i] === '--profile')
                push(join(home, 'profiles', argv[i + 1]));
            else if (argv[i] === '--profile-dir')
                push(argv[i + 1]);
        }
        try {
            for (const entry of readdirSync(join(home, 'profiles')))
                push(join(home, 'profiles', entry));
        }
        catch (_) { /* no profiles directory — the other candidates still stand */ }
        push(process.cwd());
        return out;
    }
    /**
     * What the profile's OWN manifest says: `dependencies` is what is installed,
     * `dsh.profile.bundles` is what this DSH actually composes at boot. The gap
     * between the two is "installed but switched off" — and on DSH Desktop that
     * gap is the only place the fact exists at all: the plugin manager refuses
     * the reserved desktop profile (`manageDesktopProfile` / `rejectElectronProfile`),
     * so its `listPlugins()` / `listBundles()` answer nothing there, and a skin
     * that is switched off becomes invisible (listed nowhere, so it can never be
     * switched back on).
     *
     * Failures are returned as data, never thrown — this route cannot 500.
     */
    async function readProfilePackages() {
        const candidates = profileDirCandidates();
        const tried = [];
        let fallback = null;
        for (const dir of candidates) {
            tried.push(dir);
            try {
                const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
                const raw = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles;
                if (!Array.isArray(raw))
                    continue; // not a profile manifest
                const installed = Object.keys((pkg && pkg.dependencies) || {}).sort();
                // A package can sit in `bundles` and still be switched OFF at the ENTRY level:
                // DSH's own switch writes `- id: <entry>` + `disabled: true` into the profile patch,
                // and that entry id comes from the PACKAGE's own patch layer (`dsh-dream-skin`
                // declares `dream-skin`). Reporting such a package as ACTIVE is what made it vanish
                // from the skin list: it is neither an active skin (no marks, not loaded) nor
                // "installed but off" (`installed - active` was empty), so no discovery phase could
                // see it. Excluding it here fixes BOTH readers at once — phase 6 lists it again, and
                // `_switchSkinBundle()` reads its state as off.
                const disabledByEntry = await (async () => {
                    const off = new Set();
                    const unquote = (v) => v.trim().replace(/^['"]|['"]$/g, '');
                    try {
                        const ids = new Set();
                        const patch = await readFile(join(dir, 'cordis.patch.yml'), 'utf8');
                        let pending = null;
                        for (const line of patch.split(/\r?\n/)) {
                            const mi = /^\s*-?\s*id:\s*(.*)$/.exec(line);
                            if (mi) {
                                pending = unquote(mi[1]);
                                continue;
                            }
                            if (pending && /^\s*disabled:\s*true\s*$/.test(line))
                                ids.add(pending);
                        }
                        for (const name of installed) {
                            try {
                                const own = await readFile(join(dir, 'node_modules', name, 'cordis.patch.yml'), 'utf8');
                                for (const line of own.split(/\r?\n/)) {
                                    const mi = /^\s*-?\s*id:\s*(.*)$/.exec(line);
                                    if (mi && ids.has(unquote(mi[1]))) {
                                        off.add(name);
                                        break;
                                    }
                                }
                            }
                            catch (_) { /* this package ships no patch layer of its own */ }
                        }
                    }
                    catch (_) { /* no profile patch — nothing is switched off there */ }
                    return off;
                })();
                let active = raw
                    .filter((name) => typeof name === 'string')
                    .sort();
                active = active.filter((name) => !disabledByEntry.has(name));
                const claimsUs = installed.some((name) => name === PLUGIN_NAME || name.endsWith('/' + PLUGIN_NAME));
                // The profile that lists this plugin is the one we run in; a profile
                // that merely looks like one is only kept in case nothing claims us.
                if (claimsUs)
                    return { dir, installed, active, tried };
                if (!fallback)
                    fallback = { dir, installed, active };
            }
            catch (_) { /* not a readable profile manifest — try the next candidate */ }
        }
        if (fallback)
            return { ...fallback, tried };
        return {
            dir: null,
            installed: [],
            active: [],
            tried,
            error: 'no profile manifest found (none of these had a readable package.json ' +
                'with dsh.profile.bundles): ' + tried.join(', '),
        };
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
    function proxyEnvSummary() {
        return {
            // HTTPS falls back to the HTTP proxy when no HTTPS_PROXY is set — that is
            // an undici behaviour (https uses https_proxy, else http_proxy) and the
            // display should mirror what routing actually does.
            https: readLaunchEnv(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
            http: readLaunchEnv(['HTTP_PROXY', 'http_proxy']),
            all: readLaunchEnv(['ALL_PROXY', 'all_proxy']),
        };
    }
    /**
     * Resolve the effective proxy mode, accounting for the legacy `useProxy`
     * migration: if `proxyMode` sits at its default but `useProxy` was explicitly
     * set, the old boolean takes over.
     */
    function resolveMode() {
        let mode = config.proxyMode.get() || DEFAULT_MODE;
        if (!config.proxyMode.get() && typeof config.useProxy?.get() === 'boolean') {
            mode = config.useProxy.get() ? 'all-proxy' : 'all-bypass';
        }
        return mode;
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
        const raw = fromOverride || String(config.testUrl.get() || '').trim();
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
        const mode = resolveMode();
        const custom = config.customNoProxy.get() || '';
        const route = probeRoute
            ? await proxyRouteForUrl(url)
            : { proxied: false, error: null };
        return {
            mode,
            // What this plugin published for the current mode: the value that governs
            // routing once the dispatcher has been re-installed.
            noProxy: resolveNoProxy(mode, custom) ?? null,
            httpProxy: readLaunchEnv(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
            proxyEnv: proxyEnvSummary(),
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
    // namespace's page policy. Volatile fields in the exported `Config` schema
    // are what make this plugin's settings editable without restart —
    // `settings.configure` tells the settings UI to show a form for this
    // instance; it does not register a schema (that is `Config`'s job).
    ctx.inject(['settings'], (settingsCtx) => {
        settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber));
    });
    // React to volatile config updates in-place. The loader's `_commitVolatile()`
    // updates the `Volatile<T>` references in `config` and then emits
    // `loader/volatile-update` with the paths that changed. Each subsystem
    // subscribes to ITS OWN paths only, so a change in one never walks another's
    // code path — this is the host-side decoupling of proxy (B) and
    // alerts (D): there is no one shared handler that drives both.
    // B · System proxy — re-apply the NO_PROXY policy + undici dispatcher.
    const relevant = (p) => p.length === 1;
    ctx.on('loader/volatile-update', (paths) => {
        const proxyPaths = ['proxyMode', 'customNoProxy', 'useProxy'];
        if (!paths.some((p) => relevant(p) && proxyPaths.includes(p[0])))
            return;
        try {
            const mode = resolveMode();
            applyProxyEnv(mode, config.customNoProxy.get() || '');
        }
        catch (e) {
            console.error('[dock-flash] failed to update proxy setting:', e);
        }
    });
    // D · System alerts — no reconfigure needed. Alert routes read
    // config.hostAlertQueueCap / hostAlertMaxAge via .get() at request time,
    // and client-side alert providers read _alertPref() at poll time, so a
    // volatile-update on these paths needs no host-side action.
    // Apply the initial proxy state immediately
    try {
        const mode = resolveMode();
        applyProxyEnv(mode, config.customNoProxy.get() || '');
    }
    catch (_) { }
    // ── HTTP API routes for client-side features ──────────────────────────
    // The webServer type augmentation lives in @deepseek-ai/dsh-host-webserver
    // which is not a direct dependency; cast through `any` for the register calls.
    // One independent ctx.inject(['webServer']) block per subsystem (B proxy, D
    // alerts), so each subsystem's route set has its own effect lifetime
    // and can be removed/enabled without touching the others (K2 decoupling).
    ctx.inject(['webServer'], (wsCtx) => {
        // B · System proxy ──────────────────────────────────────────────────
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
                const mode = resolveMode();
                const custom = config.customNoProxy.get() || '';
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
                    httpProxy: readLaunchEnv(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
                    // Per-class proxy variables, each verbatim — lets the client render a
                    // complete read-only inventory (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY).
                    proxyEnv: proxyEnvSummary(),
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
    ctx.inject(['webServer'], (wsCtx) => {
        // D · System alerts ─────────────────────────────────────────────────
        // Host-side alert queue for server-push alerts. External tools or the host
        // process itself can push alerts that the client will pick up on the next
        // poll. The queue is in-memory only (lost on restart), capped and pruned
        // from settings the sliders control.
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
                const cap = config.hostAlertQueueCap.get() || DEFAULT_HOST_ALERT_QUEUE_CAP;
                const maxAgeHours = config.hostAlertMaxAge.get() ?? DEFAULT_HOST_ALERT_MAX_AGE;
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
                const maxAgeHours = config.hostAlertMaxAge.get() ?? DEFAULT_HOST_ALERT_MAX_AGE;
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
        // Clear the host-side alert queue — called when the client's master
        // system-alerts toggle is switched OFF so no stale data survives.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/clear-alerts',
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'POST');
                    res.end();
                    return;
                }
                const count = _alertQueue.length;
                _alertQueue.splice(0, _alertQueue.length);
                sendJson(res, 200, { ok: true, cleared: count });
            },
        }), 'dock-flash: POST /plugins/dock-flash/clear-alerts');
        // D-owned connectivity heartbeat — the client's network-alert provider
        // polls THIS route to gauge latency, not B's /proxy-status (K6 dropped).
        // A probe that answers quickly regardless of proxy state is exactly what a
        // latency alarm wants: it isolates the local host reachability signal from
        // whether a proxy is configured, so the two subsystems share no route.
        // Also returns Node.js process.memoryUsage() so the client's memory config
        // popup can display host-side memory metrics.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/health',
            handler: async (_req, res) => {
                const mem = process.memoryUsage();
                sendJson(res, 200, {
                    ok: true,
                    ts: Date.now(),
                    memory: {
                        rss: mem.rss,
                        heapTotal: mem.heapTotal,
                        heapUsed: mem.heapUsed,
                        external: mem.external,
                        arrayBuffers: mem.arrayBuffers,
                    },
                });
            },
        }), 'dock-flash: GET /plugins/dock-flash/health');
        // E · Profile inventory — the profile's own manifest, which on DSH Desktop
        // is the ONLY source that can see an INSTALLED-BUT-SWITCHED-OFF plugin: the
        // plugin manager refuses the reserved desktop profile, so the client's
        // `listPlugins()` / `listBundles()` answer nothing there. Without this the
        // skin switcher could turn such a skin OFF but never back ON, because a
        // switched-off handle-less skin has no DOM mark either — nothing could prove
        // it was installed, so it was listed nowhere.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/profile-packages',
            handler: async (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET');
                    res.end();
                    return;
                }
                sendJson(res, 200, await readProfilePackages());
            },
        }), 'dock-flash: GET /plugins/dock-flash/profile-packages');
        // F · The LIVE plugin switch. The client remote cannot address anything on DSH
        // Desktop — `unknown-plugin` for every id, because its inventory does not
        // manage this reserved profile — and the bundle layer only shapes the NEXT
        // boot. So this route performs the edit DSH's OWN plugin manager performs:
        // set/clear `disabled:` in the profile's patch document, atomically. The
        // loader watches that document, which is what makes the change land on the
        // RUNNING page rather than at the next restart.
        //
        // The reply deliberately mirrors the remote's `ChangeResult` shape
        // (`{ ok, value: { stage, target, enabled, changed, application, error } }`)
        // so the client can drive both levers through one code path.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/set-plugin-entry',
            handler: async (req, res) => {
                if (req.method !== 'POST') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'POST');
                    res.end();
                    return;
                }
                const body = await readJsonBody(req);
                const target = body && typeof body.name === 'string' ? body.name : '';
                const enabled = !!(body && body.enabled);
                const value = { stage: 'enable', target, enabled };
                const fail = (code, message) => {
                    value.application = 'failed';
                    value.error = { code, message };
                    sendJson(res, 200, { ok: false, value });
                };
                if (!target)
                    return fail('invalid-spec', 'name is required');
                if (!/^[@a-z0-9][\w@./-]*$/i.test(target))
                    return fail('invalid-spec', 'name is not a package id');
                const dir = (await readProfilePackages()).dir;
                if (!dir)
                    return fail('unaddressable', 'the profile directory could not be resolved');
                const entryId = await entryIdFor(dir, target);
                const outcome = await setPatchDisabled(dir, entryId, !enabled);
                if (outcome.error)
                    return fail('operation-error', outcome.error);
                value.changed = outcome.changed;
                // `applied`, MEASURED — the earlier `restart-required` here was MY error, not
                // DSH's: the row this route first wrote omitted the required `name:`, so the loader
                // ignored it and the plugin kept running. With the correct shape
                // (`- id: X` / `name: X` / `disabled: true`) the running loader drops the plugin at
                // once, with no restart — exactly how the peer plugin `dshmarket` behaves.
                value.application = 'applied';
                sendJson(res, 200, { ok: true, value });
            },
        }), 'dock-flash: POST /plugins/dock-flash/set-plugin-entry');
        // G · Memory trend — host-side ring buffer of process.memoryUsage() samples.
        //    The client polls this for trend sparklines / text summaries in the
        //    memory config popup. `mode=summary` returns a lightweight snapshot
        //    (current, peak, trend direction); `mode=full` returns the raw samples
        //    for rendering a chart. Optional `since` (unix ms) limits the range.
        wsCtx.effect(() => wsCtx.webServer.register({
            kind: 'exact',
            path: '/plugins/dock-flash/memory-trend',
            handler: async (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.setHeader('allow', 'GET');
                    res.end();
                    return;
                }
                if (!_memoryTrend) {
                    sendJson(res, 200, { samples: [], summary: null });
                    return;
                }
                const u = new URL(req.url || '/', 'http://localhost');
                const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;
                const mode = u.searchParams.get('mode') || 'summary';
                if (mode === 'full') {
                    // For gcEvents: when no explicit `since` is requested (since=0),
                    // pass 0 so ALL stored events are returned — not just the last 5 min.
                    // gcEvents(0) → cutoff=0 → returns everything.
                    // gcEvents(undefined) → cutoff=now-5min → only recent events.
                    // The sparkline may span hours, so we need the full range.
                    const gcSince = since > 0 ? since : 0;
                    // Only return major (Full) GC events to the client — minor GC
                    // is too frequent and clutters the chart.  Minor GC stats are
                    // still available via mode=summary (majorPerMin, gcPausePerMin).
                    const allGcEvents = _memoryTrend.gcEvents(gcSince);
                    const majorGcEvents = allGcEvents.filter(e => e.kind === 2);
                    sendJson(res, 200, {
                        samples: _memoryTrend.query(since || undefined),
                        gcEvents: majorGcEvents,
                    });
                }
                else {
                    sendJson(res, 200, _memoryTrend.summary(since || undefined));
                }
            },
        }), 'dock-flash: GET /plugins/dock-flash/memory-trend');
    });
}
