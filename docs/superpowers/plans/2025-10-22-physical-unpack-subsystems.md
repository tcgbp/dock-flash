# dock-flash 四子系统物理拆包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `dock-flash` 单仓内的「快捷控制面板(A)/系统代理(B)/网络审计(C)/系统告警(D)」四套子系统,从单一 `dock-flash` 插件物理拆为四个可独立启停、独立分发的插件包,同时保持 A(面板)框架与 D(告警)框架在同一 `apply()` 生命周期内共享。

**Architecture:** 采用「一个主机插件 + 三个监控插件」的拓扑。`dock-flash` 保留 A(面板/quickControl registry)+ B(系统代理)+ D 的告警**框架**(`dockFlashAlerts` alertRegistry 与 `/push-alert` `/host-alerts` `/health` 队列路由);D 的三个告警 **provider** 实现(内存/上下文/网络心跳)各自拆为独立插件 `dsh-flash-mem-mon` / `dsh-flash-ctx-mon` / `dsh-flash-net-mon`,其中网络审计(C)并入 `dsh-flash-net-mon`,且每个监控插件另立自己的 settings 命名空间与 `/mem-*` `/ctx-*` `/net-*` 配置弹窗。各监控插件通过 `ctx.get('dockFlashAlerts')` 调 `registerProvider()` 注册自己的 provider、通过 `ctx.get('quickControl')` 注册开关注册表条目,不共享 dock-flash 的 `apply()` 生命周期(K8 由此自然解耦)。

> **范围判定(覆盖文档内部张力):** 源文档 §7 决策为「A+D 不可再拆、只拆 B/C」,但 §3/§8 的理想拓扑把 D 的三个 provider 也拆成独立插件。**本计划按用户明确选择执行 §3/§8 的完整四包拓扑**,即把 D 的三个 provider 一并拆出且不保留于 dock-flash —— 这是对 §7 的**主动覆盖**,因为把 provider 实现搬出 dock-flash 本身并不会打断 A↔D 的框架级引用环(面板对自己包内 UI 的坏点订阅、provider 对外通过 registry 注册),「封装」而非「改动」A/D 内部纠缠。§5 验收项按拆后状态改写,不再套用「仅约束 B/C」的旧口径。

**Tech Stack:** TypeScript(host,tsc ESM)+ 无构建浏览器端 `lib/client.js`(单文件直接编辑)、Cordis 插件契约(`name`/`inject`/`apply(ctx, config)`/`export const Config`)、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-http-proxy`(经 `loadProxyModule()` 惰性加载)、`dsh plugin --profile web add <path>` 安装分发。

**Spec:** [`docs/refactor-coupling-map.md`](../refactor-coupling-map.md) — 本计划自该耦合图展开;执行者应同时阅读两文档。耦合点沿用源文档 K1–K8 编号。

## Global Constraints

- **Host 端 ESM,无 `require`**:`src/index.ts` 经 tsc 输出 ESM;新插件任何新增宿主依赖必须静态 `import` 并在 `package.json` 声明(`@deepseek-ai/schemastery` 仅默认导出;`@deepseek-ai/dsh-http-proxy` 是 DSH 的包、**不要声明为依赖**,只能经 `loadProxyModule()` 解析 DSH 自己的副本)。
- **`dist/` 必须入库并随构建提交**;不要添加 `prepare` 脚本(会触发 pnpm ≥10 的 build allowance,破坏 `add` 无构建安装)。每次 `src/index.ts` 改动后必须 `pnpm run build` 并在同一提交内提交 `dist/index.js`。
- **`dsh.client.inject` 用基础包名**,绝不写 `<pkg>/client`(`arriveGraphRow` 对 inject 不做 `/client` 剥离)。
- **客户端是单文件、无构建、无 TS**:所有客户端改动直接编辑 `lib/client.js`,`require('react')`(非 import)、`h = React.createElement`、经 `window.__ModuleLoader__.load({ id, factory })` 加载。
- **每插件一个 settings 命名空间**:`dock-flash`(面板+代理+告警框架)、`mem-mon`、`ctx-mon`、`net-mon`。字段从单一 `_hostPrefs` 映射拆到各插件自己的偏好映射(K7 解耦)。
- **i18n**:用户可见文本一律用函数式 `label: () => t('key')`,`t()` 依据 `document.documentElement.lang` 实时切换。
- **每包自查**:`pnpm run typecheck`(host)与 `pnpm run check:overlay`/`check:docs` 通过后再提交。

---

### Task 1: 建立 `dsh-flash-net-mon` 插件骨架(含网络审计 C)

**Files:**
- Create: `dsh-flash-net-mon/package.json`
- Create: `dsh-flash-net-mon/cordis.patch.yml`
- Create: `dsh-flash-net-mon/tsconfig.json`
- Create: `dsh-flash-net-mon/src/index.ts`
- Create: `dsh-flash-net-mon/lib/client.js`
- Create: `dsh-flash-net-mon/.gitignore`(若仓库内建在 dock-flash 的 git 之外则以子目录形式创建)

**Interfaces:**
- Consumes: 运行期 `ctx.get('quickControl')`(注册开关)与 `ctx.get('dockFlashAlerts')`(注册 provider)——两者由 dock-flash 在 Task 2 清理时提供;`ctx.remote.settings` 读写 `net-mon` 命名空间。
- Produces: 可安装插件 `dsh-flash-net-mon`,含 host 入口 `src/index.ts`(经 tsc→dist)、浏览器入口 `lib/client.js`,以及 settings 命名空间 `net-mon`。
- 目标边界:本包承载 **C(网络审计:installRequestTracer、NetworkMonitor、resolvePluginId、reconfigureAudit、`/network-log`、`/network-alerts`、`/network-whitelist`、`/network-plugin-whitelist`、`netAuditEnabled` 主开关)+ 网络心跳 provider(`createNetworkAlertProvider`)+ `/net-*` 配置弹窗**。**不含**面板、代理、告警队列框架。

- [ ] **Step 1: 创建包清单**

复制 dock-flash 的打包约定。`package.json`:

```json
{
  "name": "dsh-flash-net-mon",
  "version": "0.1.0",
  "description": "Network monitor & outbound audit provider for dock-flash — registers a network-alert provider and the opt-in network audit (fetch tracer) via ctx.get('dockFlashAlerts').",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["dist", "lib", "cordis.patch.yml", "README.md"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-api-remotes",
        "dock-flash",
        "dock-base"
      ],
      "platform": "web"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "@deepseek-ai/schemastery": "^3.18.4" },
  "peerDependencies": {
    "@deepseek-ai/cordis": ">=4.0.0-rc.1 <5.0.0-0 || >=4.0.1-0 <5.0.0-0",
    "dock-base": ">=0.1.2-0 <1.0.0-0 || >=0.2.0-0 <1.0.0-0",
    "dock-flash": ">=1.6.0-0 <2.0.0-0"
  },
  "peerDependenciesMeta": {
    "dock-base": { "optional": true }
  }
}
```

> `dock-flash` 进 `dsh.client.inject` 是**加载顺序提示**(非硬依赖):保证 monitor 的 `apply()` 晚于 dock-flash,`ctx.get('dockFlashAlerts')` 时才找得到 registry。`cordis.patch.yml` 插入 host 行(照抄 dock-flash 的格式,profile 名与插件 id 改成本包)。

- [ ] **Step 2: 建 tsconfig 与 host 骨架**

`tsconfig.json` 照 dock-flash 的(module esnext,target es2022,declaration false,outDir dist)。`src/index.ts` 骨架只保留 settings 命名空间(C 的网络审计字段组)并导出 `Config`,apply 先只做 settings.configure + 路由注册占位(网络审计逻辑在 Task 2 迁移):

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type { Volatile } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-flash-net-mon'
export const inject: string[] = []

export interface NetMonConfig {
  netAuditEnabled: Volatile<boolean>
  netLogCap: Volatile<number>
  netSuspectWarn: Volatile<number>
  netSuspectErr: Volatile<number>
  netWhitelist: Volatile<string[]>
  netPluginWhitelist: Volatile<string[]>
  netSlowThreshold: Volatile<number>
  netPollBase: Volatile<number>
  netPollMin: Volatile<number>
}

export const Config = Schema.object({ /* 字段见 Task 2,先留空对象占位 */ })

export function apply(ctx: Context, config: NetMonConfig) {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
```

- [ ] **Step 3: 建浏览器客户端骨架**

`lib/client.js` 骨架为工厂,`system` 组的网络审计开关与 `network-audit` provider 轮询逻辑在 Task 2 迁入。先建立可加载的空工厂:

```js
const client = {
  async apply(ctx) {
    // Task 2 迁入:注册 network-audit 开关、createNetworkAlertProvider、
    // createNetworkAuditProvider、/net-* 配置弹窗入口
  },
  dispose() {},
}
let _exports = null
try { _exports = (globalThis.__ModuleLoader__ || {}).load ? globalThis.__ModuleLoader__.load({ id: 'dsh-flash-net-mon/client', factory: () => client }) : client } catch (_) { _exports = client }
export default _exports
```

- [ ] **Step 4: 验证骨架可被类型检查**

Run: `cd /d/codes/learn/dsh-plugin/dock-flash && pnpm --filter dsh-flash-net-mon run typecheck`
Expected: PASS(骨架空壳无类型错误)。

- [ ] **Step 5: 提交**

```bash
git add dsh-flash-net-mon
git commit -m "chore(net-mon): scaffold dsh-flash-net-mon plugin package"
```

---

### Task 2: 迁移网络审计(C)宿主逻辑到 dsh-flash-net-mon

**Files:**
- Modify: `dsh-flash-net-mon/src/index.ts`(填入网络审计逻辑)
- Modify: `dsh-flash-net-mon/lib/client.js`(迁入网络审计客户端)
- (在 dock-flash 侧删除 C 的路由/审计逻辑在 Task 4 统一执行,本任务先在 net-mon 建齐,保证两步之间主仓库仍可回退)

**Interfaces:**
- Consumes: Task 1 的 `NetMonConfig` 命名空间;运行期 `ctx.get('dockFlashAlerts')` 提供的 `alertRegistry.registerProvider()`。
- Produces: net-mon 自承载的 `installRequestTracer()`、`NetworkMonitor`、`resolvePluginId()`(作为包内私有实现,**不导出**)、`reconfigureAudit()`、路由 `/network-log` `/network-alerts` `/network-whitelist` `/network-plugin-whitelist`;对应 host 端 `netAuditEnabled` 默认 **false**。

- [ ] **Step 1: 迁入宿主网络审计实现**

从 `dock-flash/src/index.ts` 原样迁移以下实到 `dsh-flash-net-mon/src/index.ts`(保留注释与行号参考):
- `NetworkMonitor` 类(原 :620)、`installRequestTracer()`(原 :765)、`resolvePluginId()`(原 :554)作为**模块私有**(去掉 `export`,文档标注其脆弱启发式)。
- `reconfigureAudit()`(原 :858-879,含 `netAuditEnabled` 默认 OFF 的安装/卸载分支)。
- `Config` 填入 Task 1 声明的 9 个字段,带各自 `Schema.…().default(…)`(netAuditEnabled 默认 `false`)。
- C 的 4 条路由 `/network-log` `/network-alerts` `/network-whitelist` `/network-plugin-whitelist`,注册进独立 `ctx.inject(['webServer'])` 块,自带 `net-ws: …` 日志前缀。

将原文里对 `config`(dock-flash 的 ProxyConfig)的依赖改为对本包 `NetMonConfig` 的字段;`netWhitelist`/`netPluginWhitelist` 详情来自宿主配置或自身命名空间,统一收敛到本包 `config`。

- [ ] **Step 2: 建宿主 volatile-update 订阅**

dsh-flash-net-mon 自行监听自己的 7 条审计路径,不再经由任何共享 handler:

```ts
ctx.on('loader/volatile-update' as any, (paths: string[][]) => {
  const auditPaths = ['netAuditEnabled', 'netLogCap', 'netSuspectWarn',
    'netSuspectErr', 'netWhitelist', 'netPluginWhitelist']
  if (!paths.some((pp) => pp.length && auditPaths.includes(pp[pp.length - 1]))) return
  reconfigureAudit()
})
```

- [ ] **Step 3: 迁入网络审计客户端开关与 provider**

从 dock-flash `lib/client.js` 迁移到 `dsh-flash-net-mon/lib/client.js` 的 apply() 内:
- `createNetworkAlertProvider()`(原 :4779,网络心跳 provider,轮询 **`/plugins/dock-flash/health`** —— 注意仍指向 dock-flash 的 `/health`,K6 口径)。
- `createNetworkAuditProvider()`(原 :4885 段),连同网络审计面板(原 :2459)与 `netAuditEnabled` 主开关。
- 经 `ctx.get('quickControl')` 的 `registerSwitch` 注册 `dsh-flash:network-audit` 与相关 net 开关到 System 组;经 `ctx.get('dockFlashAlerts').registerProvider(provider)` 注册两个 provider。
- 双击开关回写通过 `ctx.remote.settings.update('net-mon', patch, expectedRevision)`,**不再触碰 dock-flash 命名空间**。

- [ ] **Step 4: 客户端偏好收敛为本包 `_netPrefs`**

原来读 `_hostPrefs.netSlowThreshold` 等字段处,改为读本包自己的偏好(经 `loadNetPrefs()` 从 `ctx.remote.settings` 读 `net-mon` 命名空间,localStorage 兜底),字段组:`netSlowThreshold` / `netPollBase` / `netPollMin` / `netLogCap` / `netSuspectWarn` / `netSuspectErr` / `netWhitelist` / `netPluginWhitelist` / `netAuditEnabled`。

- [ ] **Step 5: 构建并验证**

Run: `cd dsh-flash-net-mon && pnpm install && pnpm run build && pnpm run typecheck`
Expected: 构建产出 `dist/index.js`(入库),无类型错误。再在本机 profile 安装:`dsh plugin --profile web add ./dsh-flash-net-mon`(仓库内以相对路径),刷新页面确认网络审计开关与 provider 正常。(调试提示:浏览器控制台 `[dock-flash]` 前缀网络日志须仍出现。)

- [ ] **Step 6: 提交**

```bash
git add dsh-flash-net-mon
git commit -m "feat(net-mon): migrate network audit and net heartbeat provider off dock-flash"
```

---

### Task 3: 建立并迁移 dsh-flash-mem-mon 与 dsh-flash-ctx-mon

**Files:**
- Create: `dsh-flash-mem-mon/package.json`, `dsh-flash-mem-mon/cordis.patch.yml`, `dsh-flash-mem-mon/tsconfig.json`, `dsh-flash-mem-mon/src/index.ts`, `dsh-flash-mem-mon/lib/client.js`
- Create: `dsh-flash-ctx-mon/package.json`, `dsh-flash-ctx-mon/cordis.patch.yml`, `dsh-flash-ctx-mon/tsconfig.json`, `dsh-flash-ctx-mon/src/index.ts`, `dsh-flash-ctx-mon/lib/client.js`

**Interfaces:**
- Consumes: 同 Task 1/2 —— `ctx.get('quickControl')` 与 `ctx.get('dockFlashAlerts')`。
- Produces: `dsh-flash-mem-mon`:`createMemoryAlertProvider()`(:4407)及其 `/mem-*` 配置弹窗、settings 命名空间 `mem-mon`(字段:`memThresholdInfo`/`memThresholdWarning`/`memThresholdError`/`memPollBase`/`memPollMin`);`dsh-flash-ctx-mon`:`createSessionContextProvider()`(:4527)与 `/ctx-*` 配置弹窗、settings 命名空间 `ctx-mon`(字段:`ctxApproxWindow`/`ctxTokensPerMsg`/`ctxThresholdInfo`/`ctxThresholdWarning`/`ctxThresholdError`/`ctxPollBase`/`ctxPollMin`)。

- [ ] **Step 1: 搭 mem-mon 骨架**

照 Task 1 Step 1–3 复制清单骨架,包名/命名空间/注入改 `dsh-flash-mem-mon`。`peerDependencies` 加入 `"dock-flash": ">=1.6.0-0 <2.0.0-0"`(加载顺序)。

> **开关/provider 的 id 前缀随拆分切换**:QuickControl 注册表按 id 前缀分组(`dock-flash:*` → ⚡ Workbench 内建页,`dsh-flash-*:*` → 🧩 Extensions 页)。provider 移出 dock-flash 后,其 provider id 与开关 id 从 `dock-flash:*` 改成本包前缀(`dsh-flash-mem-mon:memory-alert`、`dsh-flash-ctx-mon:context-alert`、`dsh-flash-net-mon:network-alert`、`dsh-flash-net-mon:network-audit`),这些监视项因此进入 Extensions 分组;`_MONITOR_TOGGLES` 的 localStorage gate key(`dock-flash:monitor-memory` 等)同步改为各自包前缀。这是一次有意的可见变化,移入后旧 `dock-flash:monitor-*` 的 localStorage 值不再生效(干净迁移即可)。

- [ ] **Step 2: 迁移内存 provider 到 mem-mon**

`src/index.ts` 声明 mem 字段组 Config(object 全 presets,host 端为纯存储、不解释)。`lib/client.js` apply() 迁入 `createMemoryAlertProvider()`(原 :4407 全段,provider id 改为 `dsh-flash-mem-mon:memory-alert`)+「Memory Monitor」cluster 开关与 `/mem-*` 配置弹窗,经 `registerSwitch` + `registerProvider` 注册,偏好读 `mem-mon` 命名空间(`_memPrefs`)。

- [ ] **Step 3: 搭 ctx-mon 骨架并迁移**

重复 Step 1–2 于 `dsh-flash-ctx-mon`,迁入 `createSessionContextProvider()`(原 :4527 全段,provider id 改为 `dsh-flash-ctx-mon:context-alert`)+「Context Monitor」cluster 开关与 `/ctx-*` 配置弹窗,偏好读 `ctx-mon` 命名空间(`_ctxPrefs`)。

- [ ] **Step 4: 构建验证**

Run: `cd dsh-flash-mem-mon && pnpm install && pnpm run build && pnpm run typecheck`(ctx-mon 同理)
Expected: 各自产出 `dist/index.js`,无类型错误。安装后刷新确认 Memory / Context 监视器开关与弹窗可用。

- [ ] **Step 5: 提交**

```bash
git add dsh-flash-mem-mon dsh-flash-ctx-mon
git commit -m "feat(monitors): split memory and context alert providers into own packages"
```

---

### Task 4: 从 dock-flash 移除已拆走的 C 与 D provider 宿主逻辑

**Files:**
- Modify: `dock-flash/src/index.ts`(删 C 路由 + 审计宿主逻辑 + D 三 provider 对应的 host 只读消费;保留 B 代理与 A 面板、D 告警队列框架 `/push-alert` `/host-alerts` `/health`)
- Modify: `dock-flash/lib/client.js`(删 `createNetworkAlertProvider`/`createNetworkAuditProvider`/`createMemoryAlertProvider`/`createSessionContextProvider` 及其开关注册、`_MONITOR_TOGGLES` 中对应项、`_hostPrefs` 中 net/mem/ctx 字段组)
- Modify: `dock-flash/cordis.patch.yml`(如需清理 host 行)

**Interfaces:**
- Consumes: Task 2/3 已建的三个 monitor 插件(它们自行注册 provider 与开关)。
- Produces: dock-flash 只保留:settings 命名空间 `dock-flash`(面板字段 + 代理字段 `proxyMode`/`customNoProxy`/`testUrl` + 告警**框架**字段 `hostAlertQueueCap`/`hostAlertMaxAge`)、`applyProxyEnv`/`resolveNoProxy`/`loadProxyModule`/`proxyRouteForUrl`、`ctx.provide('quickControl')`、`ctx.provide('dockFlashAlerts', alertRegistry)`(空的 registrar + 队列路由)。

- [ ] **Step 1: 删除 host 端 C 网络审计**

在 `dock-flash/src/index.ts`:
- 删除 `NetworkMonitor`、`installRequestTracer()`、`resolvePluginId()`、`reconfigureAudit()` 及其宿主调用。
- 删除 C 的 4 条路由 `/network-log` `/network-alerts` `/network-whitelist` `/network-plugin-whitelist` 及其 `ctx.inject(['webServer'])` 块。
- 从 `Config` 删除 net 字段组(9 个字段)。
- 删除 C 的 volatile-update handler(:1216)。**保留 B 的 :1204 与 D 的 :1233 handler**。

- [ ] **Step 2: 精简 D 侧为纯框架**

`dock-flash` 不再内嵌任何 provider 实现;`alertRegistry` 仅作为 registrar(`registerProvider`/`setProviderEnabled` 等 API 保留),供 monitor 插件经 `ctx.get('dockFlashAlerts')` 调用。`/push-alert` `/host-alerts` `/health` + `_alertQueue` + `hostAlertQueueCap`/`hostAlertMaxAge` 字段**保留不动**。确认 K8 现状(quickControl 与 dockFlashAlerts 同一 apply 注册)保持 —— 本任务不断框架环。

- [ ] **Step 3: 重建客户端 provider 注册面**

`dock-flash/lib/client.js`:
- 删除 `createMemoryAlertProvider()`/`createSessionContextProvider()`/`createNetworkAlertProvider()`/`createNetworkAuditProvider()` 四段及 `alertProviders` 数组里对应项(:10353-10359 收敛为空的 `alertProviders = []`)。
- 删除 `_MONITOR_TOGGLES` 中 memory/context/network 三项与 `_getMonitorOn` 相关 gate(这些开关现在由各 monitor 插件自己注册)。
- 从 `_hostPrefs` 映射删除 net/mem/ctx 字段组(k7),保留面板 `panelOrder`/`activeSkin`/`triggerPosition`/`triggerOverlayOffset`/`triggerSize`/`triggerLayer`/`overlayOpacity`、代理字段、`hostAlertQueueCap`/`hostAlertMaxAge`。
- 删除网络审计面板(:2459)与 `netAuditEnabled` 主开关注册。

- [ ] **Step 4: 构建、安装、联调**

Run: `cd dock-flash && pnpm run build && pnpm run typecheck && pnpm run check:docs && pnpm run check:overlay`
Expected: dock-flash 自身构建通过;`check:overlay` 通过(注意该检查只针对 overlay 触发器,审计相关断言在本任务前已分拆校验)。
联调:本机 profile 同时启用 dock-flash + 三个 monitor 插件,刷新页面。验证:
1. 面板/快速开关/皮肤/代理 cluster 正常;`/proxy-status`、`/test-connection` 正常。
2. Memory / Context / Network 监视器开关、provider 告警、配置弹窗均由三包提供。
3. `/push-alert``/host-alerts` 队列与 `/health` 心跳仍由 dock-flash 应答。
4. 禁用 `dsh-flash-net-mon` → 全局 `fetch` 不再被包装(schema 默认 OFF + 不安装 tracer)。

- [ ] **Step 5: 提交**

```bash
git add dock-flash/src dock-flash/lib dock-flash/cordis.patch.yml
git commit -m "refactor(dock-flash): drop network audit and alert provider impls (now in child monitors)"
```

---

### Task 5: 路由隔离与跨包 HTTP 依赖复核

**Files:**
- Modify: `dock-flash/docs/superpowers/plans/2025-10-22-physical-unpack-subsystems.md`(验收记录,如需要)
- Modify: `dock-flash/docs/refactor-coupling-map.md`(标记拆包交付状态)

**Interfaces:**
- Consumes: Task 1–4 的全部产物。
- Produces: 满足 §5 全部验收项的最终状态确认。

- [ ] **Step 1: 路由隔离 grep**

Run:
```bash
grep -rl "proxy-status" dock-flash/lib dsh-flash-net-mon/lib dsh-flash-mem-mon/lib dsh-flash-ctx-mon/lib
grep -l "network-log" dsh-flash-net-mon/lib dock-flash/lib
```
Expected: `proxy-status` 仅出现在 dock-flash(且有 `test-connection`),`network-log`/`network-alerts`/`network-whitelist` 仅出现在 dsh-flash-net-mon。每包各自出现、互不引对方路由字符串。确认没有任何包引用 `createNetworkAlertProvider` 轮询 `/proxy-status`。

- [ ] **Step 2: 设置命名空间隔离**

Run: `grep -n "settings.update('" dock-flash/lib/client.js dsh-flash-net-mon/lib/client.js dsh-flash-mem-mon/lib/client.js dsh-flash-ctx-mon/lib/client.js`
Expected: dock-flash 只写 `dock-flash` 命名空间;monitor 各自只写 `mem-mon`/`ctx-mon`/`net-mon`。确认新增任一子系统字段不再触碰别包 `_hostPrefs` 映射。

- [ ] **Step 3: 生命周期独立复验**

禁用 `dsh-flash-net-mon` → 面板+告警+代理不受影响;`fetch` 不被包装。禁用 `dsh-flash-mem-mon` → 面板与其余 monitor 不受影响。确认 A/D 框架(quickControl + alertRegistry 队列)不依赖任一 monitor 存在。

- [ ] **Step 4: 提交(文档更新,非发布)**

```bash
git add docs/refactor-coupling-map.md
git commit -m "docs: record physical unpack delivery (mem/ctx/net monitors) in coupling map"
```

---

## 验收汇总(对应 §5)

| # | 验收项 | 状态(拆包后) | 落点 |
|---|---|---|---|
| 1 | 路由隔离 | 各包只含自己路由字符串 | Task 5 Step 1 |
| 2 | 设置隔离 | 四包各自命名空间与自己偏好映射 | Task 4 Step 3 / Task 5 Step 2 |
| 3 | 生命周期独立 | monitor 独立 apply/dispose;禁任一包不影响其余 | Task 4 Step 4 / Task 5 Step 3 |
| 4 | 无跨包 HTTP 依赖 | 唯一跨包 HTTP 为 monitor→`/health`(属 dock-flash 自身路由),无反向 | Task 2 Step 3 / Task 5 Step 1 |
| 5 | 默认攻击面收敛 | 新装默认启用 dock-flash(面板+代理+告警框架);网络审计 `netAuditEnabled` 默认 OFF | Task 2 Step 1 / Task 4 Step 1 |

## 未纳入本次范围(记录留待后续)

- **K8 框架级纠缠不舍**:quickControl 与 dockFlashAlerts 共享 dock-flash 同一 `apply()`,系「封装即保留」的主动接受 —— 本计划通过把 provider 移走使该环不再承载第三方实现,但 dock-flash 内部两个 service 的注册仍同生命周期。
- **K5 stack 归因导出**:resolvePluginId() 已移入 dsh-flash-net-mon 且保持私有,不做公开导出。
- 各 monitor 包的 README 与 CHANGELOG(随版本行加入,遵循 dock-flash 的发布门禁——**未经维护者确认不切版本不发版**)。
