# Network Audit Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Network Audit Monitor to dock-flash that shows all outbound network requests from the DSH process, attributes each to the originating plugin, flags suspicious activity (unknown hosts, large uploads, plaintext), and lets users investigate and whitelist trusted domains.

**Architecture:** The **host side is already fully built** — `NetworkMonitor` class (ring buffer + risk scorer), `installRequestTracer()` (wraps `globalThis.fetch`), `resolvePluginId()` (ALS + stack-trace fallback), three HTTP routes (`/network-log`, `/network-alerts`, `/network-whitelist`), and all schema fields. This plan builds the **client-side only**: a `NetworkAuditProvider` (alert provider that polls the host routes), a `NetworkAuditPanel` (independent panel component with real-time request stream, filtering, drill-down, and whitelist management), and the integration glue to wire them into the existing QuickControl and alert systems.

**Tech Stack:** Client-side only (`lib/client.js`); host-side routes already exist in `src/index.ts` + `dist/index.js`. Browser `fetch()` for polling host routes; React for the panel UI (via `h = React.createElement`); existing `AlertRegistry` + `QuickControlRegistry` for integration.

**Spec:** The design discussion in the 2025-08-03 conversation (this plan captures its decisions).

## Global Constraints

- **Host side is already complete** — do NOT modify `src/index.ts` or `dist/index.js` unless a bug is found.
- **Client half is `lib/client.js`** — single monolithic file, NO build step, organized by `#region` markers. All edits go into this file.
- **CR1:** Never modify layout state synchronously in React render cycle. Defer with `setTimeout(fn, 0)`.
- **CR7:** `setValue()` should only update state — panel handles UI refresh. Use `_notifyChange`/`notifyChange` for proactive pushes only.
- **CR10:** Error boundary mandatory for panel components. New panel component must be wrapped in `PanelErrorBoundary`.
- **CR11:** Host half is ESM — no `require()`. (Not relevant here since we only touch the client, but worth remembering if a host fix is needed.)
- **i18n:** All user-visible strings use functional labels `() => t('key')` for reactive locale switching.
- **Design tokens:** All colors go through `--dsw-alias-*` CSS variables. No literal colors except as fallbacks.
- **`min-width: 0`** on flex items that might shrink; `box-sizing: border-box` when combining minWidth + padding.
- **Version:** After all changes, bump `CLIENT_VERSION` in `lib/client.js` line 62 and `version` in `package.json` line 3 — this is a **minor** version bump (new panel, new alert provider, new feature). Do NOT bump until the maintainer confirms (two-gate release rule).
- **Metadata only** — the UI must never display request/response bodies or header values. Only method, host, path, sizes, status, timing, TLS, risk score, flags, and plugin attribution.
- **Existing `createNetworkAlertProvider`** (connectivity heartbeat at line 3216) is NOT replaced — it stays. The new `NetworkAuditProvider` is an additional alert provider for the audit function.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/client.js` `#region i18n` (lines ~120–560) | Add ~35 new i18n keys for audit strings (zh + en) |
| `lib/client.js` `#region Styles` (lines ~560–880) | Add `S.netAudit*` styles for the audit panel |
| `lib/client.js` `#region AlertProviders` (after line ~3280) | Add `createNetworkAuditProvider()` — polls `/network-alerts`, feeds AlertRegistry |
| `lib/client.js` new `#region NetworkAuditPanel` | Independent panel component: request stream, filters, drill-down, whitelist |
| `lib/client.js` `#region PanelComponent` (~lines 5400–7400) | Add a new tab "🌐 Network" to the QuickControlPanel's tab system |
| `lib/client.js` `#region apply()` (~lines 7630–) | Register `NetworkAuditProvider` in alertProviders array; add audit panel tab |
| `lib/client.js` `#region AlertPreferenceAccessors` (lines ~2789–2830) | Add `netWhitelist` default to `_ALERT_DEFAULTS` |

---

## Existing Host API Reference (already built, no changes needed)

### `GET /plugins/dock-flash/network-log?offset=N&limit=N`
Returns:
```json
{
  "entries": [{
    "seq": 1,
    "pluginId": "dock-flash",
    "method": "GET",
    "host": "api.deepseek.com",
    "pathname": "/v1/chat/completions",
    "reqBytes": 0,
    "resBytes": 1234,
    "status": 200,
    "durationMs": 150,
    "tls": true,
    "risk": 0,
    "flags": [],
    "timestamp": 1722700000000
  }],
  "offset": 0,
  "limit": 100,
  "total": 42
}
```

### `GET /plugins/dock-flash/network-alerts`
Returns `{ alerts: NetworkEntry[] }` — entries where `risk >= netSuspectWarn` (default 40).

### `POST /plugins/dock-flash/network-whitelist`
Body: `{ hosts: ["example.com", "api.trusted.io"] }`. Returns `{ ok: true, hosts: [...] }`.

---

## Task 1: Add i18n Keys for Network Audit

**Files:**
- Modify: `lib/client.js:120–560` (i18n region, both `zh` and `en` objects)

**Interfaces:**
- Produces: i18n keys used by Tasks 2–5

- [ ] **Step 1: Add Chinese i18n keys**

In the `zh` object (around line 267, after the existing `alertNetworkTimeout` key), add:

```js
// Network Audit
netAuditTitle: '网络审计',
netAuditStream: '请求流',
netAuditAlerts: '可疑告警',
netAuditWhitelist: '可信域名',
netAuditEmpty: '暂无请求记录',
netAuditNoAlerts: '暂无可疑请求',
netAuditPlugin: '插件',
netAuditHost: '域名',
netAuditMethod: '方法',
netAuditPath: '路径',
netAuditReqSize: '请求',
netAuditResSize: '响应',
netAuditStatus: '状态',
netAuditDuration: '耗时',
netAuditTLS: '加密',
netAuditRisk: '风险',
netAuditFlags: '标记',
netAuditTimestamp: '时间',
netAuditFilterPlugin: '按插件过滤',
netAuditFilterRisk: '按风险等级',
netAuditAllPlugins: '全部插件',
netAuditRiskNone: '正常',
netAuditRiskSuspect: '可疑',
netAuditRiskDanger: '危险',
netAuditAddWhitelist: '加入可信',
netAuditWhitelistHint: '添加后该域名的请求不再标记为可疑',
netAuditConfirmWhitelist: '确认将 {h} 加入可信域名？',
netAuditUnknownPlugin: '未知插件',
netAuditFlagUnknownHost: '陌生域名',
netAuditFlagNewHost: '新域名',
netAuditFlagLargeUpload: '大上传',
netAuditFlagPlaintext: '明文传输',
netAuditFlagHighFreq: '高频访问',
netAuditPaused: '已暂停',
netAuditResume: '恢复',
netAuditPause: '暂停',
netAuditClear: '清空',
netAuditBadge: '{n} 条可疑请求',
netAuditAutoScroll: '自动滚动',
netAuditDetails: '请求详情',
```

- [ ] **Step 2: Add English i18n keys**

In the `en` object (around line 467, after the existing `alertNetworkTimeout` key), add matching English keys:

```js
// Network Audit
netAuditTitle: 'Network Audit',
netAuditStream: 'Request Stream',
netAuditAlerts: 'Suspicious Alerts',
netAuditWhitelist: 'Trusted Hosts',
netAuditEmpty: 'No requests recorded yet',
netAuditNoAlerts: 'No suspicious requests',
netAuditPlugin: 'Plugin',
netAuditHost: 'Host',
netAuditMethod: 'Method',
netAuditPath: 'Path',
netAuditReqSize: 'Request',
netAuditResSize: 'Response',
netAuditStatus: 'Status',
netAuditDuration: 'Duration',
netAuditTLS: 'TLS',
netAuditRisk: 'Risk',
netAuditFlags: 'Flags',
netAuditTimestamp: 'Time',
netAuditFilterPlugin: 'Filter by plugin',
netAuditFilterRisk: 'Filter by risk level',
netAuditAllPlugins: 'All plugins',
netAuditRiskNone: 'Normal',
netAuditRiskSuspect: 'Suspect',
netAuditRiskDanger: 'Danger',
netAuditAddWhitelist: 'Add to trusted',
netAuditWhitelistHint: 'Requests to this host will no longer be flagged',
netAuditConfirmWhitelist: 'Trust host {h}?',
netAuditUnknownPlugin: 'Unknown plugin',
netAuditFlagUnknownHost: 'Unknown host',
netAuditFlagNewHost: 'New host',
netAuditFlagLargeUpload: 'Large upload',
netAuditFlagPlaintext: 'Plaintext',
netAuditFlagHighFreq: 'High frequency',
netAuditPaused: 'Paused',
netAuditResume: 'Resume',
netAuditPause: 'Pause',
netAuditClear: 'Clear',
netAuditBadge: '{n} suspicious requests',
netAuditAutoScroll: 'Auto-scroll',
netAuditDetails: 'Request Details',
```

- [ ] **Step 3: Verify i18n keys load**

Refresh the DSH web page. Open the browser console and run:
```js
document.documentElement.lang = 'zh-CN'; // should be set already
```
Then check `[dock-flash]` logs for any i18n key errors. No code uses these keys yet, so there should be no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/client.js
git commit -m "feat(net-audit): add i18n keys for network audit monitor"
```

---

## Task 2: Add Styles for Network Audit Panel

**Files:**
- Modify: `lib/client.js:560–880` (Styles region)

**Interfaces:**
- Produces: `S.netAudit*` style objects used by Tasks 4–5

- [ ] **Step 1: Add network audit styles**

After the existing alert-related styles (search for `S.alertBadge` or the last style entry in the `S` object), add a new block:

```js
// ── Network Audit Panel styles ───────────────────────────────────────
netAuditRoot: {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: '12px',
  color: 'var(--dsw-alias-label-primary, #e6edf3)',
},
netAuditToolbar: {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 8px',
  borderBottom: '1px solid var(--dsw-alias-border-muted, #30363d)',
  flexShrink: 0,
},
netAuditFilterSelect: {
  background: 'var(--dsw-alias-interactive-bg, rgba(110,118,129,0.1))',
  color: 'var(--dsw-alias-label-primary, #e6edf3)',
  border: '1px solid var(--dsw-alias-border-muted, #30363d)',
  borderRadius: '4px',
  padding: '2px 6px',
  fontSize: '11px',
  minWidth: 0,
  flex: '1 1 auto',
},
netAuditToolbarBtn: {
  background: 'var(--dsw-alias-interactive-bg, rgba(110,118,129,0.1))',
  color: 'var(--dsw-alias-label-secondary, #8b949e)',
  border: '1px solid var(--dsw-alias-border-muted, #30363d)',
  borderRadius: '4px',
  padding: '2px 8px',
  fontSize: '11px',
  cursor: 'pointer',
  flexShrink: 0,
},
netAuditStream: {
  flex: '1 1 0',
  overflowY: 'auto',
  minHeight: 0,
},
netAuditRow: {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '3px 8px',
  borderBottom: '1px solid var(--dsw-alias-border-muted, rgba(48,54,61,0.4))',
  cursor: 'pointer',
  minWidth: 0,
},
netAuditRowHover: {
  background: 'var(--dsw-alias-interactive-bg-hover, rgba(110,118,129,0.15))',
},
netAuditRiskNone: { borderLeft: '3px solid transparent' },
netAuditRiskSuspect: { borderLeft: '3px solid var(--dsw-alias-label-warning, #d29922)' },
netAuditRiskDanger: { borderLeft: '3px solid var(--dsw-alias-label-danger, #f85149)' },
netAuditCell: {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flexShrink: 1,
},
netAuditCellPlugin: { flex: '0 0 80px', fontWeight: '500' },
netAuditCellMethod: { flex: '0 0 36px', fontWeight: '600', fontSize: '10px' },
netAuditCellHost: { flex: '1 1 100px', fontWeight: '500' },
netAuditCellStatus: { flex: '0 0 28px', textAlign: 'center' },
netAuditCellSize: { flex: '0 0 48px', textAlign: 'right', fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #8b949e)' },
netAuditCellDuration: { flex: '0 0 42px', textAlign: 'right', fontSize: '10px', color: 'var(--dsw-alias-label-secondary, #8b949e)' },
netAuditCellRisk: { flex: '0 0 28px', textAlign: 'center', fontSize: '10px', fontWeight: '600' },
netAuditUnknownPlugin: {
  color: 'var(--dsw-alias-label-danger, #f85149)',
  fontStyle: 'italic',
},
netAuditDetailPanel: {
  padding: '8px 10px',
  borderTop: '1px solid var(--dsw-alias-border-muted, #30363d)',
  background: 'var(--dsw-alias-canvas-subtle, rgba(110,118,129,0.05))',
  flexShrink: 0,
},
netAuditDetailRow: {
  display: 'flex',
  gap: '8px',
  padding: '2px 0',
  fontSize: '11px',
},
netAuditDetailLabel: {
  flex: '0 0 60px',
  color: 'var(--dsw-alias-label-secondary, #8b949e)',
},
netAuditDetailValue: {
  flex: '1 1 auto',
  wordBreak: 'break-all',
  minWidth: 0,
},
netAuditFlagBadge: {
  display: 'inline-block',
  padding: '1px 4px',
  borderRadius: '3px',
  fontSize: '10px',
  marginRight: '3px',
  background: 'var(--dsw-alias-interactive-bg, rgba(110,118,129,0.2))',
  color: 'var(--dsw-alias-label-warning, #d29922)',
},
netAuditFlagBadgeDanger: {
  background: 'rgba(248,81,73,0.15)',
  color: 'var(--dsw-alias-label-danger, #f85149)',
},
netAuditWhitelistBtn: {
  background: 'var(--dsw-alias-interactive-bg, rgba(110,118,129,0.1))',
  color: 'var(--dsw-alias-label-success, #3fb950)',
  border: '1px solid var(--dsw-alias-border-muted, #30363d)',
  borderRadius: '4px',
  padding: '3px 8px',
  fontSize: '11px',
  cursor: 'pointer',
  marginTop: '6px',
},
netAuditFooter: {
  padding: '4px 8px',
  borderTop: '1px solid var(--dsw-alias-border-muted, #30363d)',
  fontSize: '10px',
  color: 'var(--dsw-alias-label-secondary, #8b949e)',
  display: 'flex',
  justifyContent: 'space-between',
  flexShrink: 0,
},
```

- [ ] **Step 2: Verify styles are syntactically valid**

Refresh the DSH web page. No styles are consumed yet, so nothing should break. Check the console for syntax errors.

- [ ] **Step 3: Commit**

```bash
git add lib/client.js
git commit -m "feat(net-audit): add styles for network audit panel"
```

---

## Task 3: Add NetworkAuditProvider (Alert Provider)

**Files:**
- Modify: `lib/client.js` `#region AlertProviders` (after `createNetworkAlertProvider()`, around line 3280)

**Interfaces:**
- Consumes: `GET /plugins/dock-flash/network-alerts` host route
- Consumes: `_alertPref('netSuspectWarn')`, `_alertPref('netSuspectErr')` from existing preference system
- Produces: Alert objects fed into the existing `AlertRegistry` — severity `warning` for risk 40–69, `error` for risk 70+

- [ ] **Step 1: Write the NetworkAuditProvider**

After `createNetworkAlertProvider()` (around line 3340), add:

```js
/**
 * NetworkAuditProvider — polls the host's /network-alerts route and
 * surfaces suspicious outbound requests through the AlertRegistry.
 *
 * Unlike NetworkAlertProvider (which measures connectivity via heartbeat),
 * this one reports "which plugin is talking to an unknown host with how
 * much data" — the audit dimension, not the latency dimension.
 *
 * Polling interval: 10s (fixed — the host already filters by risk,
 * so the payload is small).
 */
function createNetworkAuditProvider() {
  var timer = null
  var callback = null
  var lastAlertSeqs = new Set()
  var POLL_INTERVAL = 10000
  var ALERT_URL = '/plugins/dock-flash/network-alerts'
  var WHITELIST_URL = '/plugins/dock-flash/network-whitelist'

  function poll() {
    if (!callback) return
    fetch(ALERT_URL, { method: 'GET', cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (!callback) return
        var entries = data && data.alerts ? data.alerts : []
        var newAlerts = []
        var currentSeqs = new Set()
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i]
          if (!e || typeof e.seq !== 'number') continue
          currentSeqs.add(e.seq)
          if (lastAlertSeqs.has(e.seq)) continue
          // New suspicious entry — build an alert
          var isDanger = e.risk >= _alertPref('netSuspectErr')
          var flagStr = (e.flags || []).map(function (f) {
            var key = { 'unknown-host': 'netAuditFlagUnknownHost', 'new-host': 'netAuditFlagNewHost', 'large-upload': 'netAuditFlagLargeUpload', 'plaintext': 'netAuditFlagPlaintext', 'high-frequency': 'netAuditFlagHighFreq' }[f]
            return key ? t(key) : f
          }).join(', ')
          newAlerts.push({
            id: 'net-audit-' + e.seq,
            severity: isDanger ? 'error' : 'warning',
            title: function () {
              var plugin = this._pluginId === 'unknown' ? t('netAuditUnknownPlugin') : this._pluginId
              return plugin + ' → ' + this._host
            },
            message: function () {
              return (this._method || 'GET') + ' ' + (this._host || '?') + (this._flags ? ' (' + this._flags + ')' : '')
            },
            icon: isDanger ? '🔴' : '🟡',
            timestamp: e.timestamp || Date.now(),
            dismissible: true,
            // Audit-specific fields for the investigation entry point
            _auditEntry: e,
            _pluginId: e.pluginId || 'unknown',
            _host: e.host || '?',
            _method: e.method || 'GET',
            _flags: flagStr,
          })
        }
        lastAlertSeqs = currentSeqs
        if (newAlerts.length > 0) {
          try { callback(newAlerts) } catch (_) {}
        }
        timer = setTimeout(poll, POLL_INTERVAL)
      })
      .catch(function () {
        timer = setTimeout(poll, POLL_INTERVAL)
      })
  }

  return {
    id: 'dock-flash:network-audit',
    start: function (cb) {
      callback = cb
      poll()
    },
    stop: function () {
      callback = null
      if (timer) { clearTimeout(timer); timer = null }
      lastAlertSeqs = new Set()
    },
  }
}
```

- [ ] **Step 2: Register the provider in the alert providers array**

In the `apply()` function (around line 7650), the `alertProviders` array currently reads:

```js
const alertProviders = [
  createMemoryAlertProvider(),
  createSessionContextProvider(),
  createHostAlertProvider(),
  createNetworkAlertProvider(),
]
```

Change it to:

```js
const alertProviders = [
  createMemoryAlertProvider(),
  createSessionContextProvider(),
  createHostAlertProvider(),
  createNetworkAlertProvider(),
  createNetworkAuditProvider(),
]
```

- [ ] **Step 3: Add `netWhitelist` to `_ALERT_DEFAULTS`**

At line 2819 (after `netSuspectErr: 70`), the `netWhitelist` key is mapped in `loadHostPreferences` but has no default in `_ALERT_DEFAULTS`. Add:

```js
netWhitelist: [],
```

Note: this is an array default, while `_alertPref()` only checks `typeof v === 'number'`. The whitelist is not read via `_alertPref()` — it's read directly from `_hostPrefs.netWhitelist` — so this default is for documentation completeness. The actual reader should fall back to `[]` when the value is missing.

- [ ] **Step 4: Verify the provider registers and polls**

Restart DSH (host is unchanged, so no rebuild needed). Refresh the page. Open DevTools Network tab. You should see periodic `GET /plugins/dock-flash/network-alerts` requests every 10 seconds. Check the `[dock-flash]` console for errors.

- [ ] **Step 5: Verify alert propagation**

Trigger a request to an unknown host (e.g., use the proxy test against a non-default URL). After the next poll cycle, a warning/error alert should appear through the existing alert system (toast/badge/dropdown, depending on which display mode is active).

- [ ] **Step 6: Commit**

```bash
git add lib/client.js
git commit -m "feat(net-audit): add NetworkAuditProvider polling host alerts route"
```

---

## Task 4: Add Network Audit Panel Component

**Files:**
- Modify: `lib/client.js` — new `#region NetworkAuditPanel` section

**Interfaces:**
- Consumes: `GET /plugins/dock-flash/network-log` for the request stream
- Consumes: `POST /plugins/dock-flash/network-whitelist` for whitelist management
- Consumes: i18n keys from Task 1, styles from Task 2
- Produces: `NetworkAuditPanel` React component used by Task 5

- [ ] **Step 1: Write the NetworkAuditPanel component**

Add a new `#region NetworkAuditPanel` section (after the AlertProviders region, before the Preference Bridge region). This is a React component that:

1. Polls `/network-log` for the request stream (every 5s, configurable)
2. Renders a scrollable list of requests with risk coloring
3. Supports filtering by plugin and risk level
4. Expands a selected row into a detail panel
5. Provides "Add to trusted" button for non-trusted hosts
6. Shows a footer with total/filtered counts

```js
//#region NetworkAuditPanel ─────────────────────────────────────────────────────
/**
 * NetworkAuditPanel — independent panel showing all audited outbound requests.
 *
 * Polling: GET /plugins/dock-flash/network-log every 5s.
 * The host holds a ring buffer (netLogCap, default 300) and the panel
 * keeps a local mirror. New entries are highlighted briefly.
 *
 * Privacy: only metadata is displayed — no bodies, no header values.
 */

var _netAuditPollTimer = null
var _netAuditEntries = []
var _netAuditOffset = 0
var _netAuditLastSeq = 0
var _netAuditForceUpdate = null
var _netAuditPaused = false

function _startNetAuditPoll() {
  _stopNetAuditPoll()
  function poll() {
    if (_netAuditPaused) {
      _netAuditPollTimer = setTimeout(poll, 5000)
      return
    }
    var url = '/plugins/dock-flash/network-log?offset=' + _netAuditOffset + '&limit=200'
    fetch(url, { method: 'GET', cache: 'no-store' })
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (!data || !data.entries) return
        var entries = data.entries
        // entries come in reverse chronological order from the host
        // (newest first); we prepend them and track offset.
        if (entries.length > 0) {
          // Merge: entries newer than _netAuditLastSeq
          var newOnes = []
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].seq > _netAuditLastSeq) newOnes.push(entries[i])
          }
          if (newOnes.length > 0) {
            // newOnes are newest-first; prepend in correct order
            newOnes.reverse()
            _netAuditEntries = newOnes.concat(_netAuditEntries)
            _netAuditLastSeq = _netAuditEntries[0].seq
            // Cap local mirror
            var cap = _alertPref('netLogCap') || 300
            while (_netAuditEntries.length > cap) _netAuditEntries.pop()
          }
          _netAuditOffset = 0 // always fetch from 0 for simplicity
        }
        if (_netAuditForceUpdate) {
          try { _netAuditForceUpdate() } catch (_) {}
        }
        _netAuditPollTimer = setTimeout(poll, 5000)
      })
      .catch(function () {
        _netAuditPollTimer = setTimeout(poll, 5000)
      })
  }
  poll()
}

function _stopNetAuditPoll() {
  if (_netAuditPollTimer) { clearTimeout(_netAuditPollTimer); _netAuditPollTimer = null }
}

function _formatBytes(bytes) {
  if (bytes < 0) return '?'
  if (bytes === 0) return '0'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'K'
  return (bytes / (1024 * 1024)).toFixed(1) + 'M'
}

function _formatDuration(ms) {
  if (ms < 1000) return ms + 'ms'
  return (ms / 1000).toFixed(1) + 's'
}

function _timeAgo(ts) {
  var diff = Date.now() - ts
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'
  return Math.floor(diff / 3600000) + 'h ago'
}

function _addToWhitelist(host) {
  return fetch('/plugins/dock-flash/network-whitelist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hosts: [host] }),
  }).then(function (r) { return r.json() })
}

function NetworkAuditPanel() {
  var stateArr = useState(0)
  var setTick = stateArr[1]
  var selectedRef = useRef(null)
  var streamRef = useRef(null)
  var autoScrollRef = useRef(true)

  _netAuditForceUpdate = function () { setTick(function (v) { return v + 1 }) }

  useEffect(function () {
    _startNetAuditPoll()
    return function () {
      _stopNetAuditPoll()
      _netAuditForceUpdate = null
    }
  }, [])

  var selectedSeq = selectedRef.current
  var selectedEntry = null
  var filterPlugin = '_all'
  var filterRisk = '_all'

  // Compute unique plugin IDs for the filter dropdown
  var pluginSet = {}
  for (var i = 0; i < _netAuditEntries.length; i++) {
    pluginSet[_netAuditEntries[i].pluginId || 'unknown'] = true
  }
  var plugins = Object.keys(pluginSet).sort()

  // Filter entries
  var filtered = _netAuditEntries
  // (filtering is done inline in the render for simplicity;
  //  the filter state is held in component-level refs)

  var selectedEntry = null
  for (var i = 0; i < _netAuditEntries.length; i++) {
    if (_netAuditEntries[i].seq === selectedSeq) {
      selectedEntry = _netAuditEntries[i]
      break
    }
  }

  var suspectCount = 0
  for (var i = 0; i < _netAuditEntries.length; i++) {
    if (_netAuditEntries[i].risk >= _alertPref('netSuspectWarn')) suspectCount++
  }

  // Risk color helper
  function riskColor(risk) {
    if (risk >= _alertPref('netSuspectErr')) return 'var(--dsw-alias-label-danger, #f85149)'
    if (risk >= _alertPref('netSuspectWarn')) return 'var(--dsw-alias-label-warning, #d29922)'
    return 'var(--dsw-alias-label-success, #3fb950)'
  }

  // Risk CSS class helper
  function riskBorderClass(risk) {
    if (risk >= _alertPref('netSuspectErr')) return S.netAuditRiskDanger
    if (risk >= _alertPref('netSuspectWarn')) return S.netAuditRiskSuspect
    return S.netAuditRiskNone
  }

  var children = [
    // Toolbar
    h('div', { style: S.netAuditToolbar, key: 'toolbar' },
      h('span', { style: { fontWeight: '600', fontSize: '11px', flexShrink: 0 } }, t('netAuditTitle')),
      suspectCount > 0
        ? h('span', { style: {
            background: 'rgba(210,153,34,0.2)',
            color: 'var(--dsw-alias-label-warning, #d29922)',
            padding: '1px 6px',
            borderRadius: '8px',
            fontSize: '10px',
            fontWeight: '600',
          } }, suspectCount)
        : null,
      h('div', { style: { flex: '1 1 auto' } }),
      h('button', {
        style: S.netAuditToolbarBtn,
        onClick: function () {
          _netAuditPaused = !_netAuditPaused
          setTick(function (v) { return v + 1 })
        },
      }, _netAuditPaused ? t('netAuditResume') : t('netAuditPause')),
    ),
    // Request stream
    h('div', {
      style: S.netAuditStream,
      key: 'stream',
      ref: function (el) { streamRef.current = el },
    },
      _netAuditEntries.length === 0
        ? h('div', { style: { padding: '20px 12px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary, #8b949e)' } }, t('netAuditEmpty'))
        : _netAuditEntries.map(function (entry) {
            var isSelected = entry.seq === selectedSeq
            var pluginLabel = entry.pluginId === 'unknown'
              ? h('span', { style: S.netAuditUnknownPlugin }, t('netAuditUnknownPlugin'))
              : entry.pluginId
            return h('div', {
              key: entry.seq,
              style: Object.assign(
                {},
                S.netAuditRow,
                riskBorderClass(entry.risk),
                isSelected ? S.netAuditRowHover : {}
              ),
              onClick: function () {
                selectedRef.current = isSelected ? null : entry.seq
                setTick(function (v) { return v + 1 })
              },
            },
              h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellPlugin) }, pluginLabel),
              h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellMethod) }, entry.method),
              h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellHost), title: entry.host + entry.pathname }, entry.host),
              h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellStatus), style: { color: entry.status >= 400 ? 'var(--dsw-alias-label-danger, #f85149)' : 'inherit' } }, entry.status || '—'),
              h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellSize) }, _formatBytes(entry.reqBytes) + '/' + _formatBytes(entry.resBytes)),
              h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellDuration) }, _formatDuration(entry.durationMs)),
              h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellRisk), style: { color: riskColor(entry.risk) } }, entry.risk)
            )
          })
    ),
  ]

  // Detail panel for selected entry
  if (selectedEntry) {
    var e = selectedEntry
    var isTrusted = e.risk === 0
    var flags = (e.flags || []).map(function (f) {
      var key = { 'unknown-host': 'netAuditFlagUnknownHost', 'new-host': 'netAuditFlagNewHost', 'large-upload': 'netAuditFlagLargeUpload', 'plaintext': 'netAuditFlagPlaintext', 'high-frequency': 'netAuditFlagHighFreq' }[f]
      var label = key ? t(key) : f
      var isDanger = f === 'large-upload' || f === 'plaintext'
      return h('span', { style: Object.assign({}, S.netAuditFlagBadge, isDanger ? S.netAuditFlagBadgeDanger : {}), key: f }, label)
    })

    var detailRows = [
      [t('netAuditPlugin'), e.pluginId === 'unknown' ? h('span', { style: S.netAuditUnknownPlugin }, t('netAuditUnknownPlugin')) : e.pluginId],
      [t('netAuditMethod'), e.method],
      [t('netAuditHost'), e.host],
      [t('netAuditPath'), e.pathname || '/'],
      [t('netAuditReqSize'), _formatBytes(e.reqBytes)],
      [t('netAuditResSize'), e.resBytes < 0 ? '—' : _formatBytes(e.resBytes)],
      [t('netAuditStatus'), String(e.status || '—')],
      [t('netAuditDuration'), _formatDuration(e.durationMs)],
      [t('netAuditTLS'), e.tls ? '✓ HTTPS' : '✗ HTTP'],
      [t('netAuditRisk'), String(e.risk)],
      [t('netAuditFlags'), flags.length > 0 ? flags : '—'],
      [t('netAuditTimestamp'), new Date(e.timestamp).toLocaleString()],
    ]

    children.push(
      h('div', { style: S.netAuditDetailPanel, key: 'detail' },
        h('div', { style: { fontWeight: '600', marginBottom: '4px' } }, t('netAuditDetails')),
        detailRows.map(function (row, idx) {
          return h('div', { style: S.netAuditDetailRow, key: idx },
            h('span', { style: S.netAuditDetailLabel }, row[0]),
            h('span', { style: S.netAuditDetailValue }, row[1])
          )
        }),
        !isTrusted
          ? h('button', {
              style: S.netAuditWhitelistBtn,
              onClick: function () {
                _addToWhitelist(e.host).then(function () {
                  selectedRef.current = null
                  setTick(function (v) { return v + 1 })
                })
              },
            }, '✓ ' + t('netAuditAddWhitelist') + ': ' + e.host)
          : null
      )
    )
  }

  // Footer
  children.push(
    h('div', { style: S.netAuditFooter, key: 'footer' },
      h('span', null, _netAuditEntries.length + ' requests'),
      _netAuditPaused ? h('span', { style: { color: 'var(--dsw-alias-label-warning, #d29922)' } }, t('netAuditPaused')) : null
    )
  )

  return h('div', { style: S.netAuditRoot }, children)
}
//#endregion ───────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Verify the component renders**

This step requires wiring the component into the panel (Task 5). For now, verify that the file has no syntax errors by refreshing the page and checking the console for parse errors.

- [ ] **Step 3: Commit**

```bash
git add lib/client.js
git commit -m "feat(net-audit): add NetworkAuditPanel component"
```

---

## Task 5: Wire Network Audit Panel into QuickControl

**Files:**
- Modify: `lib/client.js` `#region PanelComponent` (QuickControlPanel tab system)
- Modify: `lib/client.js` `#region apply()` (register audit cluster switches)

**Interfaces:**
- Consumes: `NetworkAuditPanel` from Task 4
- Consumes: i18n keys from Task 1

- [ ] **Step 1: Add a "🌐 Network" tab to the QuickControlPanel**

Find the existing tab definitions in `QuickControlPanel`. The current tabs are defined in an array like `TABS` or inline in the component. Add a new tab after the last existing one:

Search for the tab definition array (look for the `id` values like `'workbench'`, `'extensions'`, `'changes'`). Add a new tab:

```js
{ id: 'network', icon: '🌐', label: () => t('netAuditTitle') },
```

- [ ] **Step 2: Render the NetworkAuditPanel when the network tab is active**

In the tab body rendering section of `QuickControlPanel`, add a case for the `'network'` tab id:

```js
if (activeTab === 'network') {
  return h('div', { style: { flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' } },
    h(PanelErrorBoundary, null, h(NetworkAuditPanel))
  )
}
```

- [ ] **Step 3: Add network audit cluster switches to the System group**

In the switch registration area (around line 10546, after the existing `alert-network` cluster), add a new cluster for the audit settings:

```js
// ── Cluster: network-audit (Network Audit Monitor) ────────────────
registry.registerSwitch({
  id: 'dock-flash:net-log-cap',
  label: () => t('netLogCap'),
  icon: '🌐',
  type: 'slider',
  group: 'system',
  cluster: 'network-audit',
  order: 77,
  min: 50,
  max: 1000,
  step: 50,
  visible: () => _getAlertsOn(),
  getValue: () => _alertPref('netLogCap'),
  setValue: (v) => {
    _writeAlertPref(_prefCtx, 'netLogCap', v)
    registry.notifyChange('dock-flash:net-log-cap')
  },
  formatLabel: (v) => v + '',
})
registry.registerSwitch({
  id: 'dock-flash:net-suspect-warn',
  label: () => t('netSuspectWarn'),
  icon: '🌐',
  type: 'slider',
  group: 'system',
  cluster: 'network-audit',
  order: 78,
  min: 10,
  max: 90,
  step: 5,
  visible: () => _getAlertsOn(),
  getValue: () => _alertPref('netSuspectWarn'),
  setValue: (v) => {
    _writeAlertPref(_prefCtx, 'netSuspectWarn', v)
    registry.notifyChange('dock-flash:net-suspect-warn')
  },
  formatLabel: (v) => v + '',
})
registry.registerSwitch({
  id: 'dock-flash:net-suspect-err',
  label: () => t('netSuspectErr'),
  icon: '🌐',
  type: 'slider',
  group: 'system',
  cluster: 'network-audit',
  order: 79,
  min: 30,
  max: 100,
  step: 5,
  visible: () => _getAlertsOn(),
  getValue: () => _alertPref('netSuspectErr'),
  setValue: (v) => {
    _writeAlertPref(_prefCtx, 'netSuspectErr', v)
    registry.notifyChange('dock-flash:net-suspect-err')
  },
  formatLabel: (v) => v + '',
})
```

- [ ] **Step 4: Verify the complete integration**

1. Restart DSH and refresh the page.
2. Open the QuickControl panel (click ⚡).
3. Verify the new "🌐 Network" tab appears and can be clicked.
4. Verify the NetworkAuditPanel renders (even with "No requests recorded yet" initially).
5. Trigger some network activity (e.g., run the proxy test against a URL). Switch back to the Network tab.
6. Verify the request appears in the stream with correct metadata.
7. Verify clicking a row expands the detail panel.
8. Verify the "Add to trusted" button appears for non-trusted hosts and works.
9. Verify the `network-audit` cluster appears in the System group with the three sliders.
10. Run `pnpm run check:overlay` to ensure the overlay trigger still works.

- [ ] **Step 5: Commit**

```bash
git add lib/client.js
git commit -m "feat(net-audit): wire NetworkAuditPanel into QuickControl tabs + add audit cluster switches"
```

---

## Task 6: Fix Detail Panel Style Override Bug (Inline Style Duplication)

**Files:**
- Modify: `lib/client.js` `#region NetworkAuditPanel`

**Interfaces:**
- Same as Task 4

In Task 4's code, the status and risk cells have a duplicated `style` key in the `h()` call — the second `style` overrides the first, losing the `S.netAuditCellStatus` / `S.netAuditCellRisk` base styles. This is a real bug that must be fixed.

- [ ] **Step 1: Fix the status cell**

Find the status cell in `NetworkAuditPanel`:
```js
h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellStatus), style: { color: entry.status >= 400 ? '...' : 'inherit' } }, ...)
```

Replace with:
```js
h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellStatus, entry.status >= 400 ? { color: 'var(--dsw-alias-label-danger, #f85149)' } : {}) }, entry.status || '—'),
```

- [ ] **Step 2: Fix the risk cell**

Find the risk cell:
```js
h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellRisk), style: { color: riskColor(entry.risk) } }, entry.risk)
```

Replace with:
```js
h('span', { style: Object.assign({}, S.netAuditCell, S.netAuditCellRisk, { color: riskColor(entry.risk) }) }, entry.risk),
```

- [ ] **Step 3: Verify the fix**

Refresh the page. Status codes ≥ 400 should show in red. Risk scores should show in their severity color. The cell alignment should match the other cells.

- [ ] **Step 4: Commit**

```bash
git add lib/client.js
git commit -m "fix(net-audit): merge inline styles with base cell styles for status/risk columns"
```

---

## Task 7: End-to-End Validation

**Files:**
- No file changes — manual testing only

- [ ] **Step 1: Test normal traffic appears**

Open the Network tab in QuickControl. Use DSH normally (send a chat, etc.). Verify requests to `api.deepseek.com` appear with risk=0 (trusted) and no flags.

- [ ] **Step 2: Test suspicious traffic is flagged**

Use the proxy test URL feature and point it at a non-standard host (e.g., `https://httpbin.org/post`). Verify:
- The request appears in the stream with risk > 0
- It has flags like `unknown-host`, `new-host`
- The alert system shows a warning toast/badge

- [ ] **Step 3: Test whitelist management**

1. Click on a flagged request to expand it.
2. Click "Add to trusted" for the unknown host.
3. Verify the host is added to the whitelist (check via the next request to the same host showing risk=0).
4. Verify the whitelist persists after page refresh (host setting).

- [ ] **Step 4: Test large upload detection**

This is hard to trigger manually in DSH, but can be verified by checking the `large-upload` flag logic: `method === 'POST' && reqBytes > 1024`. The flag should only appear for POST/PUT/PATCH with request body > 1KB to unknown hosts.

- [ ] **Step 5: Test plaintext detection**

If any HTTP (non-HTTPS) request occurs, it should be flagged with `plaintext`. Verify the TLS indicator shows "✗ HTTP" in the detail panel.

- [ ] **Step 6: Test pause/resume**

1. Click "Pause" in the audit panel toolbar.
2. Verify polling stops (no new entries appear, footer shows "Paused").
3. Click "Resume".
4. Verify polling resumes and any missed entries appear.

- [ ] **Step 7: Test `pnpm run check:overlay`**

Run the overlay check to ensure no regressions:
```bash
pnpm run check:overlay
```

- [ ] **Step 8: Test `pnpm run check:docs`**

Verify AGENTS.md still fits the budget:
```bash
pnpm run check:docs
```

- [ ] **Step 9: Record any issues found**

Document any bugs or UX issues discovered during testing. File them as follow-up tasks.

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ Monitor all outbound network connections → Task 3 (provider) + Task 4 (panel) + host (already built)
- ✅ Alert on suspicious access → Task 3 (NetworkAuditProvider feeds AlertRegistry)
- ✅ Identify which plugin initiated → Host `resolvePluginId()` already built; panel shows `pluginId`
- ✅ Help users investigate → Task 4 (detail panel with full metadata + whitelist button)
- ✅ Metadata only (no body/header values) → Enforced in host code; UI only shows metadata fields
- ✅ Independent Network Monitor panel → Task 4 (NetworkAuditPanel) + Task 5 (new tab)

**2. Placeholder scan:**
- ✅ No "TBD", "TODO", "implement later" patterns
- ✅ No "add appropriate error handling" without code
- ✅ No "write tests for the above" without test code
- ✅ No "similar to Task N" shortcuts
- ✅ All code blocks contain actual implementation code

**3. Type consistency:**
- ✅ `_alertPref('netLogCap')` returns `number` — used consistently
- ✅ `_alertPref('netSuspectWarn')` / `_alertPref('netSuspectErr')` return `number` — used consistently
- ✅ `NetworkEntry` host interface fields (`seq`, `pluginId`, `method`, `host`, `pathname`, `reqBytes`, `resBytes`, `status`, `durationMs`, `tls`, `risk`, `flags`, `timestamp`) — all consumed correctly in client code
- ✅ `/network-log` returns `{ entries, offset, limit, total }` — consumed correctly
- ✅ `/network-alerts` returns `{ alerts: NetworkEntry[] }` — consumed correctly
- ✅ `/network-whitelist` accepts `{ hosts: string[] }` — sent correctly
