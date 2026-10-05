# dock-flash 四套子系统的耦合图与重构方案

> 目标：为把「快捷控制面板 / 系统代理 / 网络审计 / 系统告警」四套子系统解耦为独立插件提供依据。
> 本文是**现状测绘 + 重构蓝图**，不含代码改动。
>
> **2025-08 状态更新**：B（系统代理）已完成物理拆包，独立为 `dsh-flash-proxy` 插件。下方标注已拆分。

---

## 0. 四套子系统的边界

| 编号 | 子系统 | 宿主（`src/index.ts`）职责 | 客户端（`lib/client.js`）职责 |
|---|---|---|---|
| **A** | QuickControl 面板 | 注册 `dock-flash` settings 命名空间占位（`Config` / `settings.configure`） | `ctx.provide('quickControl', registry)`、面板 UI、排序/隐藏状态机、皮肤系统、i18n |
| **B** | ~~系统代理~~ **已拆分→dsh-flash-proxy** | ~~`applyProxyEnv()` / `resolveNoProxy()` / `loadProxyModule()` / `proxyRouteForUrl()`；路由 `/proxy-status`、`/test-connection`~~ → 迁入 `dsh-flash-proxy` | ~~System 组「系统代理」cluster（select/slider/log）、启动时读回宿主值并回写~~ → 迁入 `dsh-flash-proxy` |
| **C** | 网络审计（outbound 审计） | `NetworkMonitor` 类、`installRequestTracer()`（包装 `globalThis.fetch`）、`resolvePluginId()`（stack 解析）、`reconfigure()`；路由 `/network-log`、`/network-alerts`、`/network-whitelist`、`/network-plugin-whitelist` | System 组网络审计开关、`network-audit` provider 轮询 `/network-alerts` |
| **D** | 系统告警 | 宿主侧内存队列 `_alertQueue`；路由 `/push-alert`、`/host-alerts` | `ctx.provide('dockFlashAlerts', alertRegistry)`、memory/context/network 三 provider、Toast/Dropdown 展示、`system-alerts` cluster |

---

## 1. 宿主 `apply()` 的耦合全景

```
                         ┌──────────────────────────────────────────────┐
                         │            src/index.ts :: apply(ctx)        │
                         └──────────────────────────────────────────────┘
                                      │            │            │
              ┌───────────────────────┼────────────┼────────────┼────────────────────┐
              ▼                       ▼            ▼            ▼                    ▼
   ┌───────────────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
   │ ① settings.inject  │   │ ② volatile-update │   │ ③ webServer.inject │   │ ③' 初次代理应用        │
   │ settings.configure │   │ on(...) 事件      │   │ register ×8 路由   │   │ applyProxyEnv(...)    │
   │  (A)               │   │  (A→B, A→C)      │   │  (B+C+D 共享)     │   │  (B)                 │
   └───────────────────┘   └──────────────────┘   └──────────────────┘   └─────────────────────┘
                                   │                      │
                 ┌─────────────────┼──────────────────────┼──────────────────┐
                 │                 ▼                      ▼                  │
                 │      ┌─────────────────────┐   ┌─────────────────────┐    │
                 │      │     reconfigure()   │   │  B 代理 /test-connection  │
                 │      │  (C: netCap/whitelist)│   │  → describeProxyRoute     │
                 │      │  (D: alertQueueCap) │   │  → loadProxyModule          │
                 │      └─────────────────────┘   └─────────────────────┘    │
                 │                 │                      │                  │
                 ▼                 ▼                      ▼                  ▼
   ┌─────────────────────┐   ┌─────────────────────────────────────────────────────┐
   │  B: applyProxyEnv    │   │            宿主级共享可变状态 (module scope)         │
   │  _appliedProxyKey /  │   │  _networkMonitor · _restoreFetch · _requestContext  │
   │  _disposeProxyPolicy │   │  _alertQueue · resolvePluginId() · _pluginIdFromStack()│
   └─────────────────────┘   └─────────────────────────────────────────────────────┘
```

### 1.1 关键耦合点

| # | 耦合位置 | 涉及子系统 | 说明（含行号） |
|---|---|---|---|
| **K1** | `loader/volatile-update` handler（[src/index.ts:1174-1191](../src/index.ts#L1174-L1191)） | A→B、A→C、A→D | 一个事件处理器按路径前缀同时驱动代理重装与审计 reconfigure，是**三套子系统的公共入口**。 |
| **K2** | 单一 `ctx.inject(['webServer'], …)` 块（[src/index.ts:1202-1516](../src/index.ts#L1202-L1516)） | B+C+D | 8 条路由全部注册在同一个官方长函数里，无法单独启用/卸载任一子系统。 |
| **K3** | `reconfigure()`（[src/index.ts:858-878](../src/index.ts#L858-L878)） | A→C、A→D | 从同一个 config 同时刷新「审计容量/白名单」(C) 与「告警队列容量」(D)。 |
| **K4** | 全局 `fetch` 包装（`installRequestTracer()`，[src/index.ts:765-807](../src/index.ts#L765-L807)） | C + 宿主全局 | 网络审计**默认安装**，影响整个 DSH 进程的所有 outbound 请求。 |
| **K5** | `resolvePluginId()` / `_pluginIdFromStack()`（[src/index.ts:554-569](../src/index.ts#L554-L569)） | C | 用 `new Error().stack` 归因请求来源，脆弱的启发式。 |
| **K6** | **代理路由被告警用**：`createNetworkAlertProvider` 轮询 `/proxy-status` 测网速（[lib/client.js:4753-4870](../lib/client.js#L4753-L4870)） | D→B（反向） | 告警子系统依赖代理子系统的 HTTP 路由来估网络延迟——跨子系统硬依赖。 |
| **K7** | 客户端 `loadHostPreferences()` 单一映射（[lib/client.js:3409-3470](../lib/client.js#L3409-L3470)） | A+B+C+D | 34 个设置项在**一个对象**里映射到宿主命名空间，被注释明示「this list IS the contract」。任一子系统新增设置都耦合到这个清单。 |
| **K8** | 客户端 `apply()` 内 `ctx.provide('quickControl')` 与 `ctx.provide('dockFlashAlerts')` 并行（[lib/client.js:10310-10324](../lib/client.js#L10310-L10324)） | A+D | 两个 service 在同一个 apply 生命周期里注册，dispose 相互纠缠（`alertRegistry.start()/stop()` 与面板状态机同生命周期）。 |

---

## 2. 按依赖方向的耦合图（谁依赖谁）

```
   ┌─────────────┐   K7(设置映射)   ┌─────────────┐
   │   A 面板     │ ──────────────▶ │ 宿主 settings │   ← A/B/C/D 全部写同一命名空间
   └─────┬───────┘                 │  命名空间    │
         │ produce quickControl      └─────────────┘
         ▼
   ┌─────────────┐
   │   D 系统告警  │ ── K6 ──────────▶  B 代理 /proxy-status 路由
   └─────┬───────┘                       (D 依赖 B 测网速)
         │ produce dockFlashAlerts
         ▼
   ┌─────────────┐   K4(全局重写 fetch)  ┌─────────────┐
   │  C 网络审计   │ ───────────────────▶ │ 宿主全局      │
   └─────────────┘                      │ 所有 outbound │
                                        └─────────────┘
   （A→B：面板 System 组渲染代理 cluster，但宿主逻辑自闭环，只经 settings 交互）
```

### 依赖矩阵

| 从\到 | A 面板 | B 代理 | C 审计 | D 告警 |
|---|---|---|---|---|
| **A 面板** | — | 渲染 cluster（经 settings） | 渲染开关 | 渲染开关/徽标 |
| **B 代理** | — | — | — | 被 D 用作测速源 |
| **C 审计** | — | — | — | 供给审计告警 |
| **D 告警** | badge 订阅 | 测速（K6） | 聚合审计 | — |

---

## 3. 重构目标拓扑（拆分后）

把 A 留作 dock-flash 本体，B/C/D 抽成三个独立插件，各自拥有私有 settings 命名空间与 HTTP 路由，A 通过公开 service 只读消费。

```
                 ┌────────────────────────────────────────────┐
                 │  dock-flash (A)  —— 仅面板 + 注册表          │
                 │  · settings: dock-flash                    │
                 │  · ctx.provide('quickControl', registry)   │
                 └───────────────┬────────────────────────────┘
                                 │ 只读订阅
              ┌──────────────────┼───────────────────┐
              ▼                  ▼                   ▼
   ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
   │ dsh-proxy (B)   │  │ dsh-net-audit  │  │ dsh-alerts (D) │
   │ settings:B      │  │ (C)            │  │ settings:D     │
   │ /proxy-status   │  │ /network-log   │  │ /push-alert    │
   │ /test-connection│  │ /network-alerts│  │ /host-alerts   │
   └────────────────┘  └────────────────┘  └────────────────┘
         │ 私有                          │ 私有
         ▼                               ▼
   ┌────────────────────────────────────────────┐
   │ 宿主全局 fetch 包装只存在于 C（默认关闭）       │
   └────────────────────────────────────────────┘
```

拆分后 K6 断掉：告警测宿主连接性，不再依赖代理路由，改为 D 自己的 `/health` 或直接复用 DSH 的 `dsh-client-connection`（AGENTS.md 已注明该子系统已被 DSH 自带覆盖）。

---

## 4. 拆分迁移清单（按 K 编号）

| 耦合点 | 迁移动作 | 涉及文件 |
|---|---|---|
| **K1** `volatile-update` | 各插件自监听自己的设置路径，不再共用一个 handler | 拆到 B/C/D 的各自 `apply()` | **B 已拆分**：`dsh-flash-proxy` 自监听 `proxyMode`/`customNoProxy`/`useProxy` 路径 |
| **K2** 单一 webServer 块 | 每条路由/每组路由拆到所属插件，各插件独立 `ctx.inject(['webServer'])` | 拆到 B/C/D |
| **K3** `reconfigure()` | 审计 reconfigure 归 C；告警队列容量 reconfigure 归 D | C/D |
| **K4** 全局 fetch 包装 | 只留在 C，且改默认关闭（需显式开启审计）；卸载彻底 restore | C |
| **K5** stack 归因 | 作为 C 内部实现，不暴露；文档标注其脆弱性 | C |
| **K6** 代理路由被告警复用 | D 改用自身/DSH 连接服务，去掉对 `/proxy-status` 的依赖 | D lib/client.js |
| **K7** 单一设置映射 | 每个插件维护自有命名空间映射，A 的映射只保留面板本体字段 | A/B/C/D 各自 ts + client |
| **K8** 双 provide 纠缠生命周期 | D 独立 `apply()`、独立 dispose；badge 经 A 公开的消费接口订阅，不共享生命周期 | A/D |

---

## 5. 仪表盘式验收（拆分是否成功）

1. **路由隔离**：`grep -l "proxy-status" lib/client.js` 在拆分包中各自出现，互相不引对方路由字符串。
2. **设置隔离**：任一子系统的 settings 新增字段，不再需要触碰另三套的 `_hostPrefs` 映射。
3. **生命周期独立**：禁用 dsh-alerts，面板、代理、审计仍各自工作；禁用 dsh-net-audit，全局 `fetch` 不再被包装。
4. **无跨包 HTTP 依赖**：不存在「D 调 B 的 `/proxy-status`」这类耦合（K6 消除）。
5. **默认攻击面收敛**：新装用户默认只启用 A；C 的全局审计默认 OFF。
