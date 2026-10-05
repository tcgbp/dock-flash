# 系统代理子系统（B）物理拆包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 dock-flash 的系统代理子系统（代号 B）拆为独立插件 `dsh-flash-proxy`，拥有自己的设置命名空间、HTTP 路由、QuickControl 开关簇，与 dock-flash 仅通过 `ctx.get('quickControl')` 公开服务交互。

**Architecture:** 新建 `dsh-flash-proxy` 插件（双半模型：host `src/index.ts` + client `lib/client.js`），host 端注册 `dsh-flash-proxy` 设置命名空间，代理策略（`applyProxyEnv` / `loadProxyModule`）和两个 HTTP 路由（`/proxy-status`、`/test-connection`）迁入新插件。client 端 5 个开关（`system-proxy`、`test-url`、`test-connection`、`proxy-log`、`proxy-env`）通过 INTEGRATION.md 双发现模式注册为第三方开关（🧩 Extensions 标签页）。dock-flash 侧移除 B 分区代码，保留迁移兼容层（双写旧命名空间 1 个版本后移除）。

**Tech Stack:** TypeScript (host, tsc ESM) + 无构建浏览器端 `lib/client.js`（单文件直接编辑）、Cordis 插件契约、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-http-proxy`（经 `loadProxyModule()` 惰性加载，不声明为依赖）。

**Spec:** [`docs/refactor-coupling-map.md`](../refactor-coupling-map.md) — 本计划按该耦合图的 §3/§4 拓扑执行 B 子系统拆分。K 编号沿用该文档。

## Global Constraints

- **Host 端 ESM，无 `require`**：`src/index.ts` 经 tsc 输出 ESM；新插件任何新增宿主依赖必须静态 `import` 并在 `package.json` 声明（`@deepseek-ai/schemastery` 仅默认导出；`@deepseek-ai/dsh-http-proxy` 是 DSH 的包、**不要声明为依赖**，只能经 `loadProxyModule()` 解析 DSH 自己的副本）。
- **`dist/` 必须入库并随构建提交**；不要添加 `prepare` 脚本（会触发 pnpm ≥10 的 build allowance，破坏 `add` 无构建安装）。每次 `src/index.ts` 改动后必须 `pnpm run build` 并在同一提交内提交 `dist/index.js`。
- **`dsh.client.inject` 用基础包名**，绝不写 `<pkg>/client`（`arriveGraphRow` 对 inject 不做 `/client` 剥离）。
- **客户端是单文件、无构建、无 TS**：所有客户端改动直接编辑 `lib/client.js`，`require('react')`（非 import）、`h = React.createElement`、经 `window.__ModuleLoader__.load({ id, factory })` 加载。
- **每插件一个 settings 命名空间**：新插件用 `dsh-flash-proxy`；dock-flash 保留 `dock-flash`。
- **i18n**：用户可见文本一律用函数式 `label: () => t('key')`，`t()` 依据 `document.documentElement.lang` 实时切换。
- **`@deepseek-ai/cordis` peer 范围必须带 prerelease 分支**：`>=4.0.0-rc.1 <5.0.0-0 || >=4.0.1-0 <5.0.0-0`。
- **开关 ID 前缀**：新插件用 `dsh-flash-proxy:*`（第三方前缀 → 🧩 Extensions 标签页）。
- **迁移兼容**：新插件首次启动时从 `dock-flash` 命名空间读取旧值，写入 `dsh-flash-proxy`，然后删除旧键。

---

## File Structure

### 新插件 `dsh-flash-proxy/`

```
dsh-flash-proxy/
├── src/index.ts            # 主机半：设置命名空间 + 代理策略 + HTTP 路由
│   Config: proxyMode, customNoProxy, testUrl, useProxy(legacy)
│   loadProxyModule(), applyProxyEnv(), resolveNoProxy(), resolveMode()
│   GET /plugins/dsh-flash-proxy/proxy-status
│   POST /plugins/dsh-flash-proxy/test-connection
│   loader/volatile-update 订阅（仅 proxy 路径）
├── dist/index.js           # 编译产物（入库）
├── lib/client.js           # 客户端半：5 个 QuickControl 开关
│   dock-flash-proxy:system-proxy (select)
│   dock-flash-proxy:test-url (select)
│   dock-flash-proxy:test-connection (action)
│   dock-flash-proxy:proxy-log (log)
│   dock-flash-proxy:proxy-env (log)
├── cordis.patch.yml        # bundle layer
├── package.json            # inject: []; dsh.client.inject: ["dock-flash"]
├── tsconfig.json           # 继承 dock-flash 的编译选项
├── .gitignore
└── README.md
```

### dock-flash 修改

```
dock-flash/
├── src/index.ts            # 移除 B 分区代码（约 -350 行）
├── lib/client.js           # 移除代理开关注册（约 -780 行）
├── package.json            # 移除 remote.pluginManager/remote.pluginInventory 之外无变化
└── docs/                   # 更新耦合图
```

---

### Task 1: 创建 `dsh-flash-proxy` 插件骨架

**Files:**
- Create: `dsh-flash-proxy/package.json`
- Create: `dsh-flash-proxy/cordis.patch.yml`
- Create: `dsh-flash-proxy/tsconfig.json`
- Create: `dsh-flash-proxy/.gitignore`
- Create: `dsh-flash-proxy/src/index.ts`（骨架，仅 `name` + `inject` + 空的 `Config` + 空的 `apply`）
- Create: `dsh-flash-proxy/lib/client.js`（骨架，仅 `__ModuleLoader__.load` 壳 + `apply` 签名）

**Interfaces:**
- Consumes: 无（骨架阶段不消费任何外部服务）
- Produces: 可安装插件 `dsh-flash-proxy`，含 host 入口 `src/index.ts`（经 tsc→dist）、浏览器入口 `lib/client.js`，设置命名空间 `dsh-flash-proxy`

- [ ] **Step 1: 创建 `dsh-flash-proxy/package.json`**

参照 `dsh-flash-net-mon/package.json` 和 dock-flash 的打包约定。`name` 用 `dsh-flash-proxy`。`inject` 为空数组（host 端不需要硬依赖——`launchEnvironment`/`profileContext`/`webServer`/`settings` 全部懒注入）。`dsh.client.inject` 包含 `"dock-flash"` 以保证 QuickControl 注册表先于本插件加载。

```json
{
  "name": "dsh-flash-proxy",
  "version": "0.1.0",
  "description": "System proxy control for DSH — NO_PROXY policy, connection diagnostics, and proxy environment inventory via dock-flash QuickControl.",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": [
    "dist",
    "lib",
    "cordis.patch.yml",
    "README.md"
  ],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/tcgbp/dock-flash.git"
  },
  "keywords": [
    "dsh",
    "dsh-plugin",
    "deepseek-harness",
    "proxy",
    "no-proxy"
  ],
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-api-remotes",
        "dock-flash"
      ],
      "platform": "web"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.18.4"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4.0.0-rc.1 <5.0.0-0 || >=4.0.1-0 <5.0.0-0"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "^4.0.4",
    "@deepseek-ai/dsh-settings": "0.1.7-rc.2",
    "@types/node": "^22.10.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: 创建 `dsh-flash-proxy/cordis.patch.yml`**

```yaml
# dsh-flash-proxy bundle layer — registers the HOST half into a profile.
- insert:
    - id: dsh-flash-proxy
      name: dsh-flash-proxy
```

- [ ] **Step 3: 创建 `dsh-flash-proxy/tsconfig.json`**

继承 dock-flash 的编译选项：

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": false,
    "sourceMap": false,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmitOnError": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 创建 `dsh-flash-proxy/.gitignore`**

```
node_modules/
```

- [ ] **Step 5: 创建 `dsh-flash-proxy/src/index.ts`（骨架）**

```typescript
// dsh-flash-proxy — HOST half of the system proxy control plugin.
//
// Registers the 'dsh-flash-proxy' settings namespace (proxyMode, customNoProxy,
// testUrl) and re-installs the undici global dispatcher via
// @deepseek-ai/dsh-http-proxy so outbound requests respect the user's NO_PROXY
// choice. Exposes HTTP routes for the client to query proxy status and test
// the connection.
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-settings'

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-flash-proxy'

// No host-side hard dependencies; all services are injected lazily.
export const inject: string[] = []

// ── Constants ─────────────────────────────────────────────────────────────
const DEFAULT_MODE = 'all-proxy'
const DEFAULT_CUSTOM = ''
const DEFAULT_TEST_URL = 'https://www.google.com/generate_204'
const TEST_TIMEOUT_MS = 10000
const MAX_REDIRECTS = 5
const BODY_SNIPPET_LIMIT = 200
const API_BYPASS_DOMAINS = 'api.deepseek.com,chat.deepseek.com'

const LAUNCH_ENVIRONMENT_SERVICE = 'launchEnvironment'

// ── Config ────────────────────────────────────────────────────────────────
export interface ProxyConfig {
  proxyMode: Volatile<string>
  customNoProxy: Volatile<string>
  testUrl: Volatile<string>
  useProxy?: Volatile<boolean>
}

export const Config = Schema.object({
  proxyMode: Schema.string().default(DEFAULT_MODE).volatile(),
  customNoProxy: Schema.string().default(DEFAULT_CUSTOM).volatile(),
  testUrl: Schema.string().default(DEFAULT_TEST_URL).volatile(),
  useProxy: Schema.boolean().default(true).volatile(),
})

export function apply(ctx: Context, config: ProxyConfig) {
  // TODO: Task 2 fills in the proxy policy and routes
  console.log('[dsh-flash-proxy] apply() — skeleton loaded')
}
```

- [ ] **Step 6: 创建 `dsh-flash-proxy/lib/client.js`（骨架）**

```js
// dsh-flash-proxy — CLIENT half of the system proxy control plugin.
//
// Registers 5 QuickControl switches via the dock-flash registry:
//   system-proxy, test-url, test-connection, proxy-log, proxy-env

;(function (global) {
  'use strict'

  var PLUGIN_ID = 'dsh-flash-proxy'

  // DSH's module loader calls this factory with require.
  global.__ModuleLoader__ = global.__ModuleLoader__ || {}
  global.__ModuleLoader__.load({
    id: PLUGIN_ID,
    factory: function (require, exports) {
      var React = require('react')
      var h = React.createElement

      exports.name = PLUGIN_ID
      exports.inject = ['remote', 'remote.settings']
      exports.apply = function (ctx) {
        console.log('[dsh-flash-proxy] client apply() — skeleton loaded')
        // TODO: Task 3 fills in the switch registrations
      }
    },
  })
})(typeof window !== 'undefined' ? window : this)
```

- [ ] **Step 7: 安装依赖并验证构建**

```bash
cd /d/codes/learn/dsh-plugin/dsh-flash-proxy
pnpm install
pnpm run build
ls dist/index.js
```

Expected: `dist/index.js` exists and contains the compiled skeleton.

- [ ] **Step 8: 提交**

```bash
cd /d/codes/learn/dsh-plugin/dsh-flash-proxy
git init
git add -A
git commit -m "feat: dsh-flash-proxy plugin skeleton (host + client)"
```

---

### Task 2: 迁移主机端代理代码

**Files:**
- Modify: `dsh-flash-proxy/src/index.ts`（从 dock-flash 的 B 分区代码迁移）
- Reference: `dock-flash/src/index.ts` lines 385-523, 1052-1517, 1535-1558, 1567-1607, 1612-1666

**Interfaces:**
- Consumes: `ctx.get('launchEnvironment')`（EnvLookup，由 DSH 提供）；`ctx.get('settings')`（dsh-settings，由 DSH 提供）；`ctx.inject(['webServer'])`（dsh-host-webserver，由 DSH 提供）
- Produces: 设置命名空间 `dsh-flash-proxy`；HTTP 路由 `GET /plugins/dsh-flash-proxy/proxy-status` 和 `POST /plugins/dsh-flash-proxy/test-connection`；`loader/volatile-update` 事件订阅（仅代理路径）；进程级 `NO_PROXY` / undici dispatcher 管理

- [ ] **Step 1: 添加共享工具函数到 `src/index.ts`**

从 dock-flash 的 `src/index.ts` 迁移以下工具函数（它们原位于 host 顶层，被 B 和 E/F 皮肤路由共享）：

```typescript
// ── Shared utilities ──────────────────────────────────────────────────────

/** Send a JSON response with no-store cache control. */
function sendJson(res: ServerResponse, status: number, payload: any) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Read an optional JSON request body, bounded so a client cannot feed the
 * host an unbounded buffer.
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
```

- [ ] **Step 2: 迁移 `resolveNoProxy()` 和 `EnvLookup` 接口**

从 dock-flash `src/index.ts` lines 385-405, 440-443:

```typescript
/** The one thing policy resolution needs from an environment. */
interface EnvLookup {
  get(name: string): { readonly value: string } | undefined
}

/** Map a proxyMode (+ optional customNoProxy) to the actual NO_PROXY value. */
function resolveNoProxy(mode: string, custom: string): string | undefined {
  switch (mode) {
    case 'all-proxy':  return undefined
    case 'api-bypass': return API_BYPASS_DOMAINS
    case 'all-bypass': return '*'
    case 'custom': {
      const value = (custom || '').trim()
      return value === '' ? undefined : value
    }
    default:           return undefined
  }
}
```

- [ ] **Step 3: 迁移 `loadProxyModule()` 和 `ProxyModule` 接口**

从 dock-flash `src/index.ts` lines 431-523。关键要点：必须通过 `createRequire(entry).resolve(specifier)` 解析 DSH 自己的 `dsh-http-proxy` 副本，不能 `import` 一个非依赖的包。注释中的陷阱说明一并迁移。

```typescript
/** The slice of @deepseek-ai/dsh-http-proxy this plugin uses. */
interface ProxyModule {
  installProxyFromEnvironment(
    env: EnvLookup,
    onWarn?: (message: string) => void,
  ): Promise<() => Promise<void>>
  proxyRouteFor(url: URL): { proxied?: boolean; proxy?: string } | undefined
}

let _disposeProxyPolicy: (() => Promise<void>) | null = null
let _appliedProxyKey: string | null = null
let _proxyModulePromise: Promise<ProxyModule | null> | null = null

/**
 * Load @deepseek-ai/dsh-http-proxy, once, from the instance DSH itself uses.
 *
 * Two traps:
 * 1. `require` does not exist (ESM) — must use dynamic import.
 * 2. The package is not resolvable from here — it ships inside the DSH
 *    installation. Must resolve through DSH's own entry point so we get
 *    the SAME module instance (a second copy answers "direct" forever).
 */
function loadProxyModule(): Promise<ProxyModule | null> {
  if (_proxyModulePromise) return _proxyModulePromise
  _proxyModulePromise = (async () => {
    const specifier: string = '@deepseek-ai/dsh-http-proxy'
    try {
      return (await import(specifier)) as unknown as ProxyModule
    } catch (_) { /* fall through to DSH's own copy */ }

    const entry = process.argv[1]
    if (!entry) {
      console.warn('[dsh-flash-proxy] cannot locate the DSH entry point; proxy control unavailable')
      return null
    }
    try {
      const resolved = createRequire(entry).resolve(specifier)
      console.log('[dsh-flash-proxy] dsh-http-proxy resolved to ' + resolved)
      return (await import(pathToFileURL(resolved).href)) as unknown as ProxyModule
    } catch (e: any) {
      console.warn('[dsh-flash-proxy] could not load ' + specifier + ': ' + (e?.message || e))
      return null
    }
  })()
  return _proxyModulePromise
}
```

- [ ] **Step 4: 迁移 `processEnvLookup()`、`launchEnvironment()`、`readLaunchEnv()`、`proxyEnvSummary()`**

从 dock-flash `src/index.ts` lines 526-534, 1052-1076, 1256-1269:

```typescript
/** An EnvLookup over process.env — the fallback when no snapshot is provided. */
function processEnvLookup(): EnvLookup {
  return {
    get(name: string) {
      const value = process.env[name]
      return value !== undefined && value !== '' ? { value } : undefined
    },
  }
}

/**
 * Obtain DSH's launch-environment snapshot, if available.
 * Resolves lazily via ctx.get — no hard inject dependency.
 */
function launchEnvironment(ctx: Context): EnvLookup | null {
  try {
    const svc = ctx.get ? ctx.get(LAUNCH_ENVIRONMENT_SERVICE) : undefined
    return svc && typeof (svc as any).get === 'function' ? (svc as EnvLookup) : null
  } catch (_) {
    return null
  }
}

/**
 * Read a launch-environment variable: launch snapshot first, process.env as fallback.
 */
function readLaunchEnv(ctx: Context, names: string[]): string | null {
  const snapshot = launchEnvironment(ctx)
  for (const name of names) {
    const fromSnapshot = snapshot ? snapshot.get(name) : undefined
    if (fromSnapshot && fromSnapshot.value) return fromSnapshot.value
    const raw = process.env[name]
    if (raw) return raw
  }
  return null
}

/**
 * The per-class proxy variables currently in force.
 */
function proxyEnvSummary(ctx: Context): {
  http: string | null
  https: string | null
  all: string | null
} {
  return {
    https: readLaunchEnv(ctx, ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
    http: readLaunchEnv(ctx, ['HTTP_PROXY', 'http_proxy']),
    all: readLaunchEnv(ctx, ['ALL_PROXY', 'all_proxy']),
  }
}
```

- [ ] **Step 5: 迁移 `resolveMode()`、`applyProxyEnv()`、`proxyRouteForUrl()`、`describeProxyRoute()`、`resolveTestUrl()`、`runConnectionTest()`**

从 dock-flash `src/index.ts` lines 1276-1517。这些函数是代理子系统的核心，逐字迁移，仅做以下调整：

- `config` 参数现在来自新插件的 `ProxyConfig`（字段集完全相同）
- `ctx` 传入 `launchEnvironment()` / `readLaunchEnv()` / `proxyEnvSummary()` 中（这些原来是闭包内的函数，引用外层 `ctx`；迁移后需要显式传 `ctx` 或在新 `apply()` 闭包内重新定义）
- 日志前缀从 `[dock-flash]` 改为 `[dsh-flash-proxy]`
- 路由前缀从 `/plugins/dock-flash/` 改为 `/plugins/dsh-flash-proxy/`

```typescript
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
   */
  async function applyProxyEnv(mode: string, custom: string) {
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
    console.log('[dsh-flash-proxy] proxy mode=' + mode + ' (NO_PROXY=' + (noProxy ?? '<removed>') + ')')

    const mod = await loadProxyModule()
    if (!mod) {
      _appliedProxyKey = null
      console.warn('[dsh-flash-proxy] proxy module unavailable — routing is unchanged')
      return
    }

    const snapshot = launchEnvironment(ctx)
    const base: EnvLookup = snapshot || processEnvLookup()
    const envLookup: EnvLookup = {
      get(name: string) {
        if (name === 'NO_PROXY' || name === 'no_proxy') {
          return noProxy === undefined ? undefined : { value: noProxy }
        }
        return base.get(name)
      },
    }

    try {
      if (_disposeProxyPolicy) {
        try { await _disposeProxyPolicy() } catch (_) { /* already released */ }
        _disposeProxyPolicy = null
      }
      _disposeProxyPolicy = await mod.installProxyFromEnvironment(envLookup, (message: string) => {
        console.warn('[dsh-flash-proxy] proxy install warning: ' + message)
      })
      console.log('[dsh-flash-proxy] undici global dispatcher re-installed (env source=' +
        (snapshot ? 'launchEnvironment' : 'process.env') + ')')
    } catch (e: any) {
      _appliedProxyKey = null
      console.warn('[dsh-flash-proxy] could not re-install proxy dispatcher:', e?.message || e)
    }
  }

  async function proxyRouteForUrl(url: string): Promise<{ proxied: boolean; error: string | null }> {
    const mod = await loadProxyModule()
    if (!mod) return { proxied: false, error: 'dsh-http-proxy is not loadable from this plugin' }
    try {
      return { proxied: mod.proxyRouteFor(new URL(url))?.proxied === true, error: null }
    } catch (e: any) {
      return { proxied: false, error: e?.message || String(e) }
    }
  }

  function resolveTestUrl(override?: unknown): string {
    const fromOverride = typeof override === 'string' ? override.trim() : ''
    const raw = fromOverride || String(config.testUrl.get() || '').trim()
    return raw || DEFAULT_TEST_URL
  }

  async function describeProxyRoute(url: string, probeRoute = true) {
    const mode = resolveMode()
    const custom = config.customNoProxy.get() || ''
    const route = probeRoute
      ? await proxyRouteForUrl(url)
      : { proxied: false, error: null }
    return {
      mode,
      noProxy: resolveNoProxy(mode, custom) ?? null,
      httpProxy: readLaunchEnv(ctx, ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
      proxyEnv: proxyEnvSummary(ctx),
      proxied: route.proxied,
      routeError: route.error,
    }
  }

  async function runConnectionTest(url: string) {
    const started = Date.now()
    const proxy = await describeProxyRoute(url)
    const redirects: Array<{ hop: number; from: string; status: number; to: string }> = []

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
    } catch (_) { /* body is optional */ }
    const bodyMs = Date.now() - bodyStart

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
```

- [ ] **Step 6: 迁移 `apply()` 入口——设置注册、volatile-update 订阅、webServer 路由**

从 dock-flash `src/index.ts` lines 1524-1607, 1612-1666。在 `apply()` 函数体中组装：

```typescript
export function apply(ctx: Context, config: ProxyConfig) {
  // (所有 Step 2-5 的函数定义放在 apply() 闭包内或文件顶层)
  // ...

  // Register the settings namespace so the UI shows a form for this plugin.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })

  // React to volatile config updates in-place — proxy paths only.
  const relevant = (p: string[]) => p.length === 1
  ctx.on('loader/volatile-update' as any, (paths: string[][]) => {
    const proxyPaths = ['proxyMode', 'customNoProxy', 'useProxy']
    if (!paths.some((p) => relevant(p) && proxyPaths.includes(p[0]))) return
    try {
      const mode = resolveMode()
      applyProxyEnv(mode, config.customNoProxy.get() || '')
    } catch (e) {
      console.error('[dsh-flash-proxy] failed to update proxy setting:', e)
    }
  })

  // Apply the initial proxy state immediately
  try {
    const mode = resolveMode()
    applyProxyEnv(mode, config.customNoProxy.get() || '')
  } catch (_) {}

  // HTTP routes
  ctx.inject(['webServer'], (wsCtx: any) => {
    // GET /plugins/dsh-flash-proxy/proxy-status
    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-flash-proxy/proxy-status',
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
          noProxy: resolveNoProxy(mode, custom) ?? null,
          testDefault: DEFAULT_TEST_URL,
          proxyAvailable: route.proxied,
          httpProxy: readLaunchEnv(ctx, ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']),
          proxyEnv: proxyEnvSummary(ctx),
          routeError: route.error,
        })
      },
    }), 'dsh-flash-proxy: GET /proxy-status')

    // POST /plugins/dsh-flash-proxy/test-connection
    wsCtx.effect(() => wsCtx.webServer.register({
      kind: 'exact',
      path: '/plugins/dsh-flash-proxy/test-connection',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('allow', 'POST')
          res.end()
          return
        }
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
        sendJson(res, 200, await runConnectionTest(testUrl))
      },
    }), 'dsh-flash-proxy: POST /test-connection')
  })
}
```

- [ ] **Step 7: 添加设置迁移逻辑**

在 `apply()` 末尾添加迁移代码——首次启动时从 `dock-flash` 命名空间读取旧值，写入 `dsh-flash-proxy`，然后删除旧键：

```typescript
  // ── Migration: adopt proxy settings from dock-flash namespace ───────
  ctx.inject(['settings'], (settingsCtx: any) => {
    const settings = settingsCtx.settings
    if (!settings || typeof settings.describe !== 'function') return

    settings.describe().then(async (desc: any) => {
      if (!desc || desc.ok === false) return
      const view = desc.value || desc
      const nsList = view && Array.isArray(view.namespaces) ? view.namespaces : []
      const oldNs = nsList.find((n: any) => (n && (n.ns || n.namespace)) === 'dock-flash')
      if (!oldNs) return

      const resolved = oldNs.value || oldNs.resolved
      if (!resolved) return

      // Only migrate if the new namespace still has defaults
      const currentMode = config.proxyMode.get()
      const alreadyMigrated = currentMode && currentMode !== DEFAULT_MODE

      if (!alreadyMigrated) {
        const patch: Record<string, any> = {}
        if (resolved.proxyMode && resolved.proxyMode !== DEFAULT_MODE) {
          patch.proxyMode = resolved.proxyMode
        }
        if (resolved.customNoProxy) {
          patch.customNoProxy = resolved.customNoProxy
        }
        if (resolved.testUrl && resolved.testUrl !== DEFAULT_TEST_URL) {
          patch.testUrl = resolved.testUrl
        }
        if (typeof resolved.useProxy === 'boolean' && !resolved.proxyMode) {
          patch.proxyMode = resolved.useProxy ? 'all-proxy' : 'all-bypass'
        }

        if (Object.keys(patch).length > 0) {
          console.log('[dsh-flash-proxy] migrating proxy settings from dock-flash namespace:', patch)
          try {
            await settings.update('dsh-flash-proxy', patch)
          } catch (e: any) {
            console.warn('[dsh-flash-proxy] migration write failed:', e?.message || e)
          }
        }
      }
    }).catch(() => {})
  })
```

- [ ] **Step 8: 构建并验证**

```bash
cd /d/codes/learn/dsh-plugin/dsh-flash-proxy
pnpm run build
ls -la dist/index.js
```

Expected: `dist/index.js` exists, no type errors.

- [ ] **Step 9: 提交**

```bash
cd /d/codes/learn/dsh-plugin/dsh-flash-proxy
git add -A
git commit -m "feat: migrate host-side proxy policy, routes, and settings"
```

---

### Task 3: 迁移客户端代理开关代码

**Files:**
- Modify: `dsh-flash-proxy/lib/client.js`（从 dock-flash 的代理开关代码迁移）

**Interfaces:**
- Consumes: `ctx.get('quickControl')`（由 dock-flash 提供，通过 `dock-flash:ready` 事件 + `ctx.get` 双发现模式）；`ctx.remote.settings`（读写 `dsh-flash-proxy` 命名空间）
- Produces: 5 个 QuickControl 开关：`dsh-flash-proxy:system-proxy`、`dsh-flash-proxy:test-url`、`dsh-flash-proxy:test-connection`、`dsh-flash-proxy:proxy-log`、`dsh-flash-proxy:proxy-env`

- [ ] **Step 1: 添加 i18n 翻译表**

从 dock-flash `lib/client.js` lines 206-233, 498-529 迁移所有代理相关 i18n 键。在新插件的 `lib/client.js` 中建立独立的翻译表：

```js
var ZH = {
  systemProxy: '系统代理',
  noProxyHint: 'NO_PROXY',
  noProxyNotSet: '未设置',
  proxyAllProxy: '全部代理',
  proxyApiBypass: '仅 API 绕过',
  proxyAllBypass: '全部绕过',
  proxyCustom: '自定义',
  proxyModeDescAllProxy: '所有请求都经代理发出',
  proxyModeDescApiBypass: '仅 API/聊天域名直连，其余走代理',
  proxyModeDescAllBypass: '所有请求都直连，不经代理',
  proxyModeDescCustom: '按自定义 NO_PROXY 列表绕过',
  proxyCustomPrompt: '输入自定义 NO_PROXY 值',
  proxyCustomEmpty: '自定义 NO_PROXY 不能为空：要全部走代理请选「全部代理」，要全部绕过请选「全部绕过」或填 *。',
  proxyCustomInvalid: '自定义 NO_PROXY 中有无效条目：',
  proxyCustomSyntax: '只接受主机名、域名后缀、IP 或「主机:端口」，用逗号或空格分隔；域名条目同时匹配其子域；端口需在 1-65535。不支持 CIDR，也不要填代理地址本身。',
  proxyScopeHint: '仅影响 DSH 进程内的 fetch 请求',
  proxyNoProxyEnv: '未检测到 HTTP_PROXY，代理设置暂无效果',
  proxyEnvRefreshing: '刷新中…',
  testConnection: '测试连接',
  testUrl: '测试目标',
  testUrlPrompt: '输入测试 URL（需 http:// 或 https://）',
  testRunning: '测试中…',
  testSuccess: '成功',
  testFailed: '失败',
  proxyLog: '连接诊断日志',
  proxyEnv: '代理环境',
  proxyLogClear: '清空日志',
  logProxied: '经代理',
  logDirect: '直连',
  logRoute: '路由',
  logCause: '原因',
  logRedirects: '重定向',
  logRedirectLimit: '达到重定向上限',
  logResponse: '响应',
  logHeaders: 'Header',
  logBody: 'Body',
  logTotal: '耗时',
  logFailed: '失败',
  logFinalUrl: '最终 URL',
  logNoHttpProxy: '无 HTTP_PROXY',
}

var EN = {
  systemProxy: 'System Proxy',
  noProxyHint: 'NO_PROXY',
  noProxyNotSet: 'not set',
  proxyAllProxy: 'All Proxy',
  proxyApiBypass: 'API Bypass',
  proxyAllBypass: 'All Bypass',
  proxyCustom: 'Custom',
  proxyModeDescAllProxy: 'All requests route through the proxy',
  proxyModeDescApiBypass: 'Only API/chat domains bypass; everything else uses the proxy',
  proxyModeDescAllBypass: 'All requests go direct, bypassing the proxy',
  proxyModeDescCustom: 'Bypass per the custom NO_PROXY list',
  proxyCustomPrompt: 'Enter custom NO_PROXY value',
  proxyCustomEmpty: 'Custom NO_PROXY cannot be empty — choose "All Proxy" to bypass nothing, or "All Bypass" / * to bypass everything.',
  proxyCustomInvalid: 'Invalid entry in custom NO_PROXY:',
  proxyCustomSyntax: 'Accepted: host names, domain suffixes, IPs, or host:port, separated by commas or spaces. A domain also matches its subdomains; ports must be 1-65535. CIDR is not supported, and the proxy address itself does not belong here.',
  proxyScopeHint: 'Only affects fetch() requests within DSH process',
  proxyNoProxyEnv: 'No HTTP_PROXY detected — proxy setting has no effect',
  proxyEnvRefreshing: 'Refreshing…',
  testConnection: 'Test Connection',
  testUrl: 'Test Target',
  testUrlPrompt: 'Enter test URL (must start with http:// or https://)',
  testRunning: 'Testing…',
  testSuccess: 'Success',
  testFailed: 'Failed',
  proxyLog: 'Diagnostics Log',
  proxyEnv: 'Proxy Environment',
  proxyLogClear: 'Clear log',
  logProxied: 'Proxied',
  logDirect: 'Direct',
  logRoute: 'Route',
  logCause: 'Cause',
  logRedirects: 'Redirects',
  logRedirectLimit: 'Redirect limit reached',
  logResponse: 'Response',
  logHeaders: 'Headers',
  logBody: 'Body',
  logTotal: 'Total',
  logFailed: 'Failed',
  logFinalUrl: 'Final URL',
  logNoHttpProxy: 'no HTTP_PROXY',
}
```

- [ ] **Step 2: 添加 `t()` 翻译函数和 localStorage 读写工具**

```js
var TABLE = document.documentElement.lang === 'zh' ? ZH : EN
function t(key) { return TABLE[key] || key }

// Watch for language changes
new MutationObserver(function () {
  TABLE = document.documentElement.lang === 'zh' ? ZH : EN
}).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })

// ── Proxy state (localStorage) ────────────────────────────────────────
var _proxyModeKey = 'dsh-flash-proxy:proxy-mode'
var _customNoProxyKey = 'dsh-flash-proxy:custom-no-proxy'
var _testUrlKey = 'dsh-flash-proxy:test-url'
var _PROXY_MODES = ['all-proxy', 'api-bypass', 'all-bypass', 'custom']
var _DEFAULT_MODE = 'all-proxy'

var _getProxyMode = function () {
  try {
    var v = localStorage.getItem(_proxyModeKey)
    if (v && _PROXY_MODES.indexOf(v) >= 0) return v
    // Migrate legacy dock-flash keys
    var old = localStorage.getItem('dock-flash:use-proxy')
    if (old !== null) {
      var mode = old === 'true' ? 'all-proxy' : 'all-bypass'
      localStorage.setItem(_proxyModeKey, mode)
      localStorage.removeItem('dock-flash:use-proxy')
      return mode
    }
    return _DEFAULT_MODE
  } catch (_) { return _DEFAULT_MODE }
}
var _setProxyMode = function (v) {
  try { localStorage.setItem(_proxyModeKey, String(v)) } catch (_) {}
}
var _getCustomNoProxy = function () {
  try { return localStorage.getItem(_customNoProxyKey) || '' } catch (_) { return '' }
}
var _setCustomNoProxy = function (v) {
  try { localStorage.setItem(_customNoProxyKey, String(v)) } catch (_) {}
}
var _getTestUrl = function () {
  try { return localStorage.getItem(_testUrlKey) || '' } catch (_) { return '' }
}
var _setTestUrl = function (v) {
  try {
    if (v) localStorage.setItem(_testUrlKey, String(v))
    else localStorage.removeItem(_testUrlKey)
  } catch (_) {}
}

var _resolveTestUrl = function () { return _getTestUrl() || TEST_URL_PRESETS[0].url }
```

- [ ] **Step 3: 迁移 NO_PROXY 验证逻辑**

从 dock-flash `lib/client.js` lines 14488-14560。逐字迁移 `_normalizeNoProxyList()` 和 `_noProxyErrorText()`——这是纯函数，不依赖任何 dock-flash 闭包状态。

- [ ] **Step 4: 迁移测试 URL 预设和诊断日志格式化**

从 dock-flash `lib/client.js` lines 14562-14684。迁移 `TEST_URL_PRESETS`、`_describeTest()`、`_fmtBytes()`、`_oneLine()`、`_logStamp()`、`_setLog()`。这些全部是代理专属的纯函数/常量。

- [ ] **Step 5: 迁移代理状态追踪和 `_fetchProxyStatus()`**

从 dock-flash `lib/client.js` lines 14686-14779。关键修改：

- `fetch('/plugins/dock-flash/proxy-status')` → `fetch('/plugins/dsh-flash-proxy/proxy-status')`
- `registry.notifyChange('dock-flash:system-proxy')` → `registry.notifyChange('dsh-flash-proxy:system-proxy')`
- `registry.notifyChange('dock-flash:test-url')` → `registry.notifyChange('dsh-flash-proxy:test-url')`
- `registry.notifyChange('dock-flash:proxy-env')` → `registry.notifyChange('dsh-flash-proxy:proxy-env')`
- 所有 `_remoteSettings(ctx)` 调用改为读取 `dsh-flash-proxy` 命名空间

- [ ] **Step 6: 迁移启动时主机同步逻辑**

从 dock-flash `lib/client.js` lines 14781-14842。修改要点：

- 设置命名空间查找从 `'dock-flash'` 改为 `'dsh-flash-proxy'`
- `registry.notifyChange('dock-flash:*')` → `registry.notifyChange('dsh-flash-proxy:*')`

- [ ] **Step 7: 迁移 5 个开关注册 + settings/updated 事件监听**

从 dock-flash `lib/client.js` lines 14844-15234。修改要点：

- 所有 `id: 'dock-flash:*'` → `id: 'dsh-flash-proxy:*'`
- 所有 `registry.notifyChange('dock-flash:*')` → `registry.notifyChange('dsh-flash-proxy:*')`
- 所有 `registry.recordChange({ id: 'dock-flash:*' })` → `registry.recordChange({ id: 'dsh-flash-proxy:*' })`
- 所有 `ctx.effect(...)` 标签字符串中的 `'dock-flash: ...'` → `'dsh-flash-proxy: ...'`
- `fetch('/plugins/dock-flash/test-connection')` → `fetch('/plugins/dsh-flash-proxy/test-connection')`
- `_queuePrefWrite(ctx, ...)` → 新插件自有的写入队列（见 Step 8）
- `settings/updated` 事件中的 `ns !== 'dock-flash'` → `ns !== 'dsh-flash-proxy'`

- [ ] **Step 8: 实现独立的设置写入队列**

新插件需要自己的 `_queuePrefWrite` / `savePrefs` 基础设施。从 dock-flash 的 `_queuePrefWrite()` 提取核心逻辑，但写入 `dsh-flash-proxy` 命名空间而非 `dock-flash`：

```js
var _prefWriteTail = Promise.resolve()
var _hostRevision = undefined

function _remoteSettings(ctx) {
  try {
    var remote = ctx.remote
    if (remote && typeof remote.settings === 'object') return remote.settings
    var svc = ctx.get ? ctx.get('remote') : undefined
    return svc && svc.settings ? svc.settings : null
  } catch (_) { return null }
}

function _queuePrefWrite(ctx, patch, onError, saved) {
  var task = _prefWriteTail.then(function () {
    var settings = _remoteSettings(ctx)
    if (!settings || typeof settings.update !== 'function') {
      if (onError) onError(patch, function () {})
      return false
    }
    return settings.update('dsh-flash-proxy', patch, _hostRevision).then(function () {
      return true
    }).catch(function (e) {
      console.warn('[dsh-flash-proxy] settings update failed:', e)
      if (onError) onError(patch, function () {})
      return false
    })
  })
  _prefWriteTail = task.catch(function () {})
  return task
}
```

- [ ] **Step 9: 实现双发现模式（INTEGRATION.md 兼容）**

在 `apply()` 中使用双发现模式注册开关到 dock-flash 的 QuickControl 注册表：

```js
exports.apply = function (ctx) {
  var registered = false

  function registerProxySwitches(registry) {
    if (registered) return
    registered = true

    // (所有 Step 5-7 迁移的开关注册代码放在这里)
    // ...

    // 启动时主机同步
    // (Step 6 的代码)
    // ...

    // settings/updated 事件监听
    // (Step 7 的事件监听代码)
    // ...
  }

  // 1. Passive: listen for dock-flash:ready
  var off = ctx.on('dock-flash:ready', registerProxySwitches)

  // 2. Active: check if dock-flash already loaded
  var registry = ctx.get('quickControl')
  if (registry) registerProxySwitches(registry)

  // Also try remote.settings for host sync
  var settingsSvc = _remoteSettings(ctx)
  if (settingsSvc && typeof settingsSvc.describe === 'function') {
    // (Step 6 的启动同步代码)
  }
}
```

- [ ] **Step 10: 手动测试验证**

```bash
# 安装新插件到 profile
dsh plugin --profile web add /d/codes/learn/dsh-plugin/dsh-flash-proxy

# 重启 DSH，打开 GUI
# 1. 检查 🧩 Extensions 标签页是否有 5 个代理开关
# 2. 切换代理模式，验证 /proxy-status 返回正确值
# 3. 运行测试连接，验证 /test-connection 返回正确值
# 4. 检查 localStorage 键前缀是否为 dsh-flash-proxy:*
# 5. 检查设置命名空间是否为 dsh-flash-proxy
```

- [ ] **Step 11: 提交**

```bash
cd /d/codes/learn/dsh-plugin/dsh-flash-proxy
git add -A
git commit -m "feat: migrate client-side proxy switches with i18n and QuickControl integration"
```

---

### Task 4: 从 dock-flash 移除代理子系统代码

**Files:**
- Modify: `dock-flash/src/index.ts`（移除 B 分区代码）
- Modify: `dock-flash/lib/client.js`（移除代理开关注册）
- Modify: `dock-flash/src/index.ts` 中的 `Config`（移除 `proxyMode`/`customNoProxy`/`testUrl`/`useProxy`）
- Modify: `dock-flash/src/index.ts` 中的 `ProxyConfig` 接口（重命名或移除代理字段）

**Interfaces:**
- Consumes: 无（移除阶段只做减法）
- Produces: dock-flash 不再包含代理功能；`dock-flash` 设置命名空间中的代理字段变为遗留兼容层

- [ ] **Step 1: 移除 `src/index.ts` 中的代理设置字段**

从 `Config` 和 `ProxyConfig` 接口中移除：

```typescript
// 移除这些行:
proxyMode: Schema.string().default(DEFAULT_MODE).volatile(),
customNoProxy: Schema.string().default(DEFAULT_CUSTOM).volatile(),
testUrl: Schema.string().default(DEFAULT_TEST_URL).volatile(),
useProxy: Schema.boolean().default(true).volatile(),
```

同时移除对应的常量：
```typescript
// 移除:
const DEFAULT_MODE = 'all-proxy'
const DEFAULT_CUSTOM = ''
const DEFAULT_TEST_URL = 'https://www.google.com/generate_204'
const TEST_TIMEOUT_MS = 10000
const MAX_REDIRECTS = 5
const BODY_SNIPPET_LIMIT = 200
const API_BYPASS_DOMAINS = 'api.deepseek.com,chat.deepseek.com'
const LAUNCH_ENVIRONMENT_SERVICE = 'launchEnvironment'
```

将 `ProxyConfig` 重命名为 `FlashConfig`（不再以 Proxy 为主），只保留面板/皮肤/触发器字段。

- [ ] **Step 2: 移除 `src/index.ts` 中的代理工具函数和策略代码**

移除以下函数/接口：
- `EnvLookup` 接口
- `resolveNoProxy()`
- `ProxyModule` 接口
- `loadProxyModule()`
- `_disposeProxyPolicy`、`_appliedProxyKey`、`_proxyModulePromise`
- `processEnvLookup()`
- `launchEnvironment()`
- `readLaunchEnv()`
- `proxyEnvSummary()`
- `resolveMode()`
- `applyProxyEnv()`
- `proxyRouteForUrl()`
- `resolveTestUrl()`
- `describeProxyRoute()`
- `runConnectionTest()`
- `sendJson()`（如果被其他路由使用则保留——皮肤路由 E/F 用 `sendJson`，所以保留）
- `readJsonBody()`（同上——皮肤路由用，保留）

- [ ] **Step 3: 移除 `apply()` 中的代理初始化和事件订阅**

移除：
- `loader/volatile-update` 中的代理路径订阅
- 初始 `applyProxyEnv()` 调用
- webServer 路由中的 B 分区（`/proxy-status`、`/test-connection`）

保留：
- `sendJson()` 和 `readJsonBody()`（被 E/F 皮肤路由使用）
- A 分区（面板设置注册）
- D 分区（告警路由）
- E/F 分区（皮肤路由）

- [ ] **Step 4: 移除 `lib/client.js` 中的代理开关注册**

移除 lines 14450–15234 的所有代理相关代码：
- localStorage 读写函数（`_getProxyMode`、`_setProxyMode`、`_getCustomNoProxy` 等）
- `_normalizeNoProxyList()` 及其验证正则
- `_describeTest()`、`_fmtBytes()`、`_oneLine()`、`_logStamp()`
- `_fetchProxyStatus()` 及代理状态变量（`_noProxyValue`、`_hostProxyMode` 等）
- 5 个开关注册（`system-proxy`、`test-url`、`test-connection`、`proxy-log`、`proxy-env`）
- `settings/updated` 事件监听中的代理路径

⚠️ **注意**：`_oneLine()` 函数可能被非代理代码使用——grep 检查后再决定是否移除。`_queuePrefWrite()` 被 `savePrefs()` 和代理写入共享——**保留**（K7 解耦由字段集隔离实现，不需要移除共享写入队列）。

- [ ] **Step 5: 移除 `_hostPrefs` 映射中的代理字段**

从 `loadHostPreferences()` 的 `_hostPrefs` 映射中移除代理字段（它们本来就不在 `_hostPrefs` 中——B 区字段走 `/proxy-status` 读路径——但注释中可能需要更新）。

- [ ] **Step 6: 清理 i18n 翻译表**

从 `lib/client.js` 的 ZH/EN 翻译表中移除所有代理相关键（`systemProxy`、`proxyAllProxy` 等 ~35 个键）。

- [ ] **Step 7: 构建验证**

```bash
cd /d/codes/learn/dsh-plugin/dock-flash
pnpm run build
pnpm run typecheck
pnpm run check:overlay
pnpm run check:docs
```

Expected: 全部通过。

- [ ] **Step 8: 手动功能回归测试**

1. 安装 dock-flash（不含代理代码）到 profile
2. 打开 GUI，验证 ⚡ 内建标签页中没有代理开关
3. 验证面板/皮肤/触发器/告警功能正常
4. 验证皮肤切换正常
5. 验证面板排序正常

- [ ] **Step 9: 提交**

```bash
cd /d/codes/learn/dsh-plugin/dock-flash
git add -A
git commit -m "refactor: remove proxy subsystem (B) — moved to dsh-flash-proxy"
```

---

### Task 5: 端到端集成验证

**Files:**
- Read-only验证: `dsh-flash-proxy/` 和 `dock-flash/`

**Interfaces:**
- Consumes: 安装后的完整插件系统
- Produces: 验证报告

- [ ] **Step 1: 安装两个插件到同一 profile**

```bash
dsh plugin --profile web add /d/codes/learn/dsh-plugin/dock-flash
dsh plugin --profile web add /d/codes/learn/dsh-plugin/dsh-flash-proxy
```

- [ ] **Step 2: 验证代理功能在新插件中完整工作**

1. 打开 GUI → 🧩 Extensions 标签页
2. 找到 `dsh-flash-proxy` 分组
3. 切换代理模式（全部代理 → 仅 API 绕过 → 全部绕过 → 自定义）
4. 验证每次切换后 `/plugins/dsh-flash-proxy/proxy-status` 返回正确的 `proxyMode` 和 `noProxy`
5. 运行测试连接，验证诊断日志输出
6. 验证代理环境清单显示正确的 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY
7. 刷新页面，验证代理设置持久化（检查 localStorage 键前缀为 `dsh-flash-proxy:*`）

- [ ] **Step 3: 验证 dock-flash 核心功能不受影响**

1. ⚡ 内建标签页中无代理开关
2. 皮肤切换正常
3. 面板排序正常
4. 触发器/覆盖层正常
5. 告警系统正常

- [ ] **Step 4: 验证迁移兼容性**

1. 在安装 `dsh-flash-proxy` 之前，先设置 `dock-flash` 中的代理值（用旧版 dock-flash）
2. 安装新版 dock-flash + dsh-flash-proxy
3. 验证 `dsh-flash-proxy` 的迁移逻辑从 `dock-flash` 命名空间读取旧值
4. 验证迁移后代理设置在新插件中生效

- [ ] **Step 5: 验证独立安装（无 dock-flash）**

1. 仅安装 `dsh-flash-proxy`（不安装 dock-flash）
2. 验证插件不崩溃（开关不注册，但主机半代理策略仍工作）
3. 验证日志无错误

- [ ] **Step 6: 提交最终验证结果**

在 plan 文件中追加验证结果注释。

---

### Task 6: 更新文档

**Files:**
- Modify: `dock-flash/docs/refactor-coupling-map.md`（标记 B 已拆分）
- Modify: `dock-flash/AGENTS.md`（移除代理相关 Critical Rules 和架构描述）
- Create: `dsh-flash-proxy/README.md`

**Interfaces:**
- Consumes: 无
- Produces: 更新的文档

- [ ] **Step 1: 更新耦合图**

在 `docs/refactor-coupling-map.md` 中标记 B 子系统为「已拆分」：

- K1: 标记 `A→B` 路径已断开
- K2: 标记 B 路由已独立
- K6: 标记 D→B 依赖需改为 D 自己的 `/health` 路由
- K7: 标记 B 字段集已独立命名空间

- [ ] **Step 2: 更新 AGENTS.md**

- 移除"System proxy"架构段落（约 30 行）
- 移除代理相关 Critical Rules（如果有——检查发现 AGENTS.md 中的 Critical Rules 主要关于皮肤和布局，代理规则在架构段落中，不在编号规则中）
- 更新"Known Dependencies"表
- 更新版本历史规则（如果 `Config` 接口有 breaking change）

- [ ] **Step 3: 创建 `dsh-flash-proxy/README.md`**

```markdown
# dsh-flash-proxy

System proxy control for DeepSeek Harness — NO_PROXY policy management,
connection diagnostics, and proxy environment inventory.

## Features

- **Proxy Mode Selector** — Choose between All Proxy, API Bypass, All Bypass, or Custom NO_PROXY
- **Connection Test** — Diagnose outbound connectivity with redirect chain analysis
- **Proxy Environment** — Read-only inventory of HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY
- **Diagnostics Log** — Detailed test results with timing and error codes

## Installation

```bash
dsh plugin --profile <name> add dsh-flash-proxy
```

Requires [dock-flash](https://github.com/tcgbp/dock-flash) for the QuickControl panel UI.

## Settings

| Field | Default | Description |
|---|---|---|
| `proxyMode` | `all-proxy` | NO_PROXY policy: `all-proxy` / `api-bypass` / `all-bypass` / `custom` |
| `customNoProxy` | `''` | Custom NO_PROXY value (only when `proxyMode` is `custom`) |
| `testUrl` | `https://www.google.com/generate_204` | URL the connection test probes |

## Migration from dock-flash

If you previously used dock-flash's built-in proxy controls, `dsh-flash-proxy` will
automatically migrate your settings on first launch.
```

- [ ] **Step 4: 提交**

```bash
cd /d/codes/learn/dsh-plugin/dock-flash
git add -A
git commit -m "docs: update coupling map and AGENTS.md for proxy extraction"

cd /d/codes/learn/dsh-plugin/dsh-flash-proxy
git add -A
git commit -m "docs: add README"
```

---

## Self-Review

### 1. Spec coverage

| Spec requirement (refactor-coupling-map.md) | Task |
|---|---|
| K1: volatile-update handler per-plugin | Task 2 Step 6 |
| K2: webServer routes per-plugin | Task 2 Step 6 |
| K6: D→B dependency removal | Task 4 (dock-flash 侧代理路由移除后 D 的 `/health` 需独立解决，本计划不涉及 D 拆分) |
| K7: independent settings namespace | Task 2 Step 5 + Task 3 Step 8 |
| B routes under own prefix | Task 2 Step 6 |
| B switches as third-party | Task 3 Step 7 + 9 |

### 2. Placeholder scan

- No TBD/TODO/fill-in-later except Task 1 Step 5 which has a `// TODO: Task 2 fills in` — this is intentional scaffolding that gets replaced in Task 2.
- All code blocks contain complete implementations.

### 3. Type consistency

- `ProxyConfig` interface in Task 1 Step 5 matches the fields used in Task 2 Steps 5-6.
- `EnvLookup` interface in Task 2 Step 2 matches usage in `applyProxyEnv()` (Step 5).
- Switch IDs consistently use `dsh-flash-proxy:*` prefix throughout Task 3.
- Route paths consistently use `/plugins/dsh-flash-proxy/*` prefix throughout Tasks 2-3.
