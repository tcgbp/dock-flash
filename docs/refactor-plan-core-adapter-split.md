# 拆分计划：核心 `dsh-flash` + dock 适配器 `dock-flash`（v3）

> **状态**：方案已定（用户已批准 Plan A），本文是**执行蓝图**，不含代码改动。
> **依据**：全部行号与接口均为对本仓库 / DSH 0.2.0-rc.2 运行时的**实测读取**，不是推测。
> **前置文档**：`docs/refactor-coupling-map.md`（上一轮四套子系统拆包，已完成）。

---

## 0. 决策摘要

| 项 | 决定 |
|---|---|
| 拆分方向 | **反转**：核心依赖零 dock；适配器 `dock-flash` 依赖核心 + dock-base |
| 核心包名 | `dsh-flash`（新 npm 名，当前 404 可用） |
| 适配器包名 | `dock-flash`（**沿用已发布的 npm 名**，升 major 到 3.0.0） |
| 依赖声明 | `dock-flash` → `dsh-flash` 用**普通 dependencies**；`dock-base` 用 **peer 且不可选** |
| 核心对 dock 的依赖 | **零**。不 import、不 `ctx.get('workbench')` |
| 模式判定 | 唯一的**归属握手**（§1.2），不再用环境探测选模式 |
| 跨插件传组件 | 走 cordis service（`ctx.provide`/`ctx.get`），不走 import |
| 装载前提（实测） | 核心仅作为传递依赖**不会被组合**，适配器的 patch 必须**同时插入核心那一行**（§1.4 修正 1）；`insert` 不按 id 去重，故核心**保留**自己的 `dsh.bundle` 且两半侧都做**幂等守卫**（§1.4 修正 3） |
| 设置命名空间 | **已定 M1**（§4）：核心 entry 保留 `id: dock-flash`，零迁移；`id:` 必须显式写死 |
| 仓库布局 | **已定 L2**（§5）：核心进新仓库 `tcgbp/dsh-flash`，本仓库瘦身为纯适配器；Phase 1–3 仍在本仓库单包验证握手 |
| Phase 1 发版 | **已定发** `dock-flash@2.3.0`（对用户零变化：先让归属握手在真实环境跑一轮） |
| 适配器对 dock-base | **已定不可选 peer**（§6 / D4） |
| 预发策略 | 先发 `--tag next` 验证，再 `dist-tag` 提升为 latest（**npm 发布不可撤销**，见 §9 R7） |

---

## 1. 目标架构

### 1.1 包图与依赖方向

```
                  ┌─────────────────────────────┐
                  │  dsh-flash  (核心)           │
                  │  · QuickControlPanel         │
                  │  · QuickControlRegistry      │
                  │  · 皮肤 / 告警三层 / 排序      │
                  │  · i18n / 偏好桥 / 紧凑模式    │
                  │  · 独立 ⚡ 浮动面板（默认挂载）  │
                  │  依赖：无 dock 任何东西        │
                  └──────────────┬──────────────┘
                                 │ ctx.provide('dockFlashPanel', …)
                                 │ dependencies（普通依赖）
                  ┌──────────────▼──────────────┐
                  │  dock-flash@3  (适配器)      │
                  │  5 个 dock-base 注册 + 头部   │
                  │  + 隐藏时交还独立模式         │
                  └──────────────┬──────────────┘
                                 │ peerDependency（不可选）
                  ┌──────────────▼──────────────┐
                  │  dock-base  (工作台宿主)      │
                  └─────────────────────────────┘
```

四个同伴 `dsh-flash-ctx-mon` / `-mem-mon` / `-net-mon` / `-proxy` 的 peer 从 `dock-flash` **改指 `dsh-flash`**（提供 `quickControl` / `dockFlashAlerts` 的是核心，不是适配器）。

### 1.2 归属握手 —— 唯一的模式判定机制

**核心默认永远挂载独立 ⚡**；只有宿主显式 `claim()` 时才卸载。核心**不认识** `workbench` 这个概念。

| 阶段 | 谁 | 动作 |
|---|---|---|
| 启动 | 核心 | 注册所有开关；准备挂载独立 ⚡（经 `ctx.inject(['slots'])`，本身就是异步的） |
| 挂载前 | 核心 | 检查 `isClaimed()`，已认领就不挂 |
| 启动 | 适配器 | `apply()` 里若 `ctx.get('workbench')` 可用（或 `_dockBaseInstalled()` 且 `ctx.inject(['workbench'])` 成功）→ 立即 `claim()`，随后注册 5 个入口 |
| 隐藏 | 适配器 | dock-base 报告 `dock-flash` 被隐藏 → `release()` → 核心重新挂载 ⚡（等价于今天的 detach） |
| 恢复 | 适配器 | 取消隐藏 → `claim()` → 核心再次卸载（等价于今天的 reattach） |
| 卸载 | 适配器 | dispose 时 `release()`，防止认领泄漏 |

**为什么不能用 `ctx.get('workbench')` 决定模式（致命失败模式）**：
> 装了 dock-base + 核心 `dsh-flash`，但**没装适配器** → 核心一看"有 workbench"就退回不挂载，而适配器不在、没人把面板注册进 dock-base → **界面上什么都没有**。

握手把这个组合变成"核心照常提供独立 ⚡"，永远不会瞎。

### 1.3 行为真值表（必须逐行断言）

| # | 核心 | 适配器 | dock-base | 隐藏 | 期望结果 |
|---|---|---|---|---|---|
| 1 | ✓ | ✗ | ✗ | — | 独立 ⚡ + 浮动面板（今天的行为） |
| 2 | ✓ | ✗ | ✓ | — | **独立 ⚡**（新组合；核心不认识 workbench） |
| 3 | ✓ | ✓ | ✗ | — | 适配器 `claim()` 失败/不注册 → 独立 ⚡ + 一条 warn 日志 |
| 4 | ✓ | ✓ | ✓ | 否 | 侧栏面板 + 活动栏 + 编辑器视图 + 命令 + 设置卡片；**无 ⚡**（今天的行为） |
| 5 | ✓ | ✓ | ✓ | 是 | 独立 ⚡ 接管（今天 detach 行为的等价物） |

### 1.4 装载前提：核心光"装上"不够，必须被"组合"（实测，决定架构）

DSH 0.2.0-rc.2 的四条实测事实：

| 事实 | 证据 |
|---|---|
| profile 的 `node_modules` 是 **hoisted** 布局，**传递依赖也会被提升到顶层** | `~/.dsh/profiles/{web,desktop}/pnpm-workspace.yaml` 都有 `nodeLinker: hoisted`；`@deepseek-ai/schemastery` 不在 profile 的 `dependencies` 里，却实实在在出现在 `node_modules` 顶层 |
| 只有 profile `dependencies` 里、**且自己声明了 `dsh.bundle`** 的包才会进入 `dsh.profile.bundles` | `@deepseek-ai/dsh-app-boot` 的 `readProfilePlugins`（"dependency records **in package.json order**"）+ `reconcileProfilePlugins`（"New bundle dependencies activate automatically"，普通依赖单独归入 `addedPlainDependencies`） |
| **只有进了 `dsh.profile.bundles` 的包才贡献 patch 层** | `dsh-app-boot/lib/types/profile.d.ts`：树 = 各 bundle 的 patch 列表按 `dsh.profile.bundles` 顺序叠出来，再叠 profile 自己的 `cordis.patch.yml` |
| 客户端半侧只挂在**说明符恰为裸包名**的那一行 entry 上 | `dsh-plugin-guide/guide/plugin-dev-guide.md` §7 |
| profile 设了 `autoInstallPeers: false` → **peer 不会被装上** | 同一份 `pnpm-workspace.yaml` ⇒ 核心必须走普通 `dependencies`，不能走 peer |

**由此得到的失败模式（必须避免）**：若适配器的 patch 只插入自己那一行，核心仅作为普通依赖被 hoist 上来 → 核心**没有 entry 行** → patch 层没有它 → **客户端半侧不会被提供** → 适配器 `ctx.get('dockFlashPanel')` 得到 `undefined` → 适配器无事可做（它全部内容就是 5 个注册调用 + 头部，而头部还要核心的 `Header`）→ **界面上什么都没有，也没有任何报错**。这是最糟的失败形态：静默。

**修正 1（强制）**：适配器的 `cordis.patch.yml` 必须把核心那一行也插进去 —— 用户仍然只装一个名字：

```yaml
# dock-flash bundle layer —— 适配器是用户安装的那个包，所以它同时为核心作保：
# 核心作为 hoisted 传递依赖进来，必须靠这一行才会被组合。
# id 取法由 D1=M1 决定：核心保留旧 id `dock-flash` ⇒ 设置命名空间零迁移；
# 适配器另取一个 id，避免与核心重复（`insert` 不去重，见下方修正 3）。
- insert:
    - id: dock-flash          # 核心（包名 dsh-flash）
      name: dsh-flash
    - id: dock-flash-adapter  # 适配器（包名 dock-flash）
      name: dock-flash
```

**修正 2（强制）**：拿不到 `dockFlashPanel` 时**必须吵**（§2.3 最后一行），绝不静默空白。

**修正 3（已实测 → 必须幂等）**：若用户**既装核心又装适配器**，两层 patch 会各插一行 `id: dsh-flash`。实测（DSH 0.2.0-rc.2；临时 profile + `dsh --profile <scratch> --dump-config`，第二层用 `--patch` 叠加；`--dump-config` 只打印不上线、不碰用户数据）：

| 实验 | 结果 |
|---|---|
| 只有 profile 自己那一层（插 `- id: core-probe, name: probe-core`） | 1 行 |
| 第二层再插同一 `id: core-probe` + 同一 `name: probe-core` | **2 行**（同 id 同名并存，dump 里紧邻两行） |
| 第二层插同一 `id: core-probe` 但 `name: probe-else` | **2 行**：`probe-core` 与 `probe-else` 都在，后一层**不替换**前一层 |
| 同一个 patch 列表里连插两条同 `id` | **2 行** |

即 **`insert` 按字面追加，不按 `id` 去重**。"按 id 整段替换"只适用于用 `id:` **定位已存在的行**并给 `config` 的 patch，不适用于 `insert`。

再实测 cordis 4.0.4 对"同一插件被挂两次"（`ctx.plugin(p); ctx.plugin(p)`）：
- `apply` 执行 **两次**，不报错、不去重；
- 第二次 `ctx.provide('dockFlashPanel', …)` 会**抛错** `service "dockFlashPanel" has been registered at <第一次的 fiber>`（首次注册保留，第二次失败）；
- 两个不同对象但 `name` 相同 → 同样执行两次，不报错。

**结论：选 (b)** —— 核心**保留**自己的 `dsh.bundle`（继续可单独安装），同时核心**必须幂等**：宿主半侧模块级单例守卫（`if (applied) return`，或 `ctx.get('dockFlashPanel')` 已存在就直接返回），客户端半侧以 `window` 标记守卫。重复装载于是退化为 no-op，而不是"双 ⚡ + 双面板 + 抛错"。这一条从"待实测"升级为**实现强制项**。

---

## 2. 服务契约 `dockFlashPanel`（草案）

命名沿用已有的 `quickControl` / `dockFlashAlerts` 家族。

### 2.1 关键设计：把头部**组件化**，7 个导出收敛为 1

适配器现在的头部（`lib/client.js:13387–13450`）直接用了 7 个核心内部符号：

`S.panelCloseBtn`(2) · `readCloseOnBlur`(2) · `writeCloseOnBlur`(1) · `subscribeCloseOnBlur`(1) · `closeOnBlurLabel`(2) · `CLOSE_ON_BLUR_ICON_SVG`(1) · `_cobHeaderDispose`(4)

**不要把样式对象和控制开关的实现暴露出去**。核心直接提供一个 `Header` 组件，把这 7 项全部留在核心内部，适配器只负责把它交给 `registerPanel({ headerComponent })`。

顺带修一个既有小瑕疵：适配器现在调用 `writeCloseOnBlur(!readCloseOnBlur(), wb)`，而函数签名是 `writeCloseOnBlur(on, registry)` —— 传进去的是 `wb`，`wb.notifyChange` 不存在，异常被 `try/catch` 吞掉（注释里说的"workbench 模式没有该开关，notifyChange 是 no-op"其实就是这个）。改成由核心内部处理，或明确传真正的 `registry`。

### 2.2 字段表

```js
// 核心：apply() 内
ctx.provide('dockFlashPanel', {
  version: 1,                        // 契约版本，用于适配器做兼容判定

  Panel,                             // QuickControlPanel（React 组件；核心 :6104）
  ErrorBoundary,                     // PanelErrorBoundary（核心 :161）
  Header,                            // ({ wb }) => React element；失焦关闭 + 关闭按钮，命令式绘制安全
  icon: LIGHTNING_ICON,              // SVG 字符串（活动栏 / 侧栏面板图标）

  registry,                          // QuickControlRegistry 实例（所有开关都在核心注册）
  i18n: { t, L },                    // t 另带 t.onLocaleChange（适配器要用它补侧栏标题）

  host: {
    claim(),                         // 适配器：我来承载 → 核心卸载独立 ⚡（幂等，返回 lease）
    release(),                       // 适配器：我不承载了 → 核心重新挂载 ⚡（幂等）
    isClaimed(),
  },
})
```

### 2.3 时序与失败模式

| 场景 | 处理 |
|---|---|
| 核心先启动，⚡ 已挂载，适配器随后 `claim()` | 核心立即卸载 ⚡。`mountStandaloneSlotTrigger` 本身要等 `ctx.inject(['slots'])`，通常晚于适配器的同步 `claim()`，所以正常启动看不到闪烁；仍要实测 |
| 适配器 `claim()` 后注册抛错 | **看门狗**：`claim()` 后 N ms 内没有任何面板注册，核心自动 `release()` 并挂载 ⚡ |
| 适配器未安装（真值表 #2） | 核心永远走默认路径，不需要任何补偿 |
| `ctx.get('dockFlashPanel')` 拿到旧版契约 | 适配器检查 `version`，不匹配则 warn + 不 claim（核心继续提供 ⚡） |
| 适配器被卸载但没 `release()` | `claim()` 返回的 lease 绑定在适配器的 fiber 上，随插件 dispose 自动释放 |
| **React 双实例**（若 loader 不共享） | 见 §9 R3 的应变方案 |

---

## 3. 拆分清单（逐行，`lib/client.js` 共 13,653 行）

### 3.1 迁出到适配器（→ `dock-flash` 的 `lib/client.js`）

| 行号 | 内容 |
|---|---|
| 13372–13373 | `SafeQuickControlPanel = (props) => h(PanelErrorBoundary, null, h(QuickControlPanel, props))` |
| 13375–13453 | `registerPanel`（`dock-flash:quick-control`、`sideBar`、`order: 50`、`headerComponent` 全体） |
| 13455–13472 | 侧栏标题 i18n 补丁（`.dsh-wb-sidebar-title`） |
| 13474–13495 | `registerPlugin`（设置里的 "Flash" 卡片，`hasEntry: true`、`order: 30`） |
| 13497–13508 | `registerActivityBarItem`（⚡、`pluginId: 'dock-flash'`） |
| 13510–13520 | `registerEditorView` |
| 13522–13532 | `registerCommand` → `dock-flash:openQuickControl` |
| 13534–13601 | dock 隐藏 ↔ 独立模式同步（改为调用 `host.claim()/release()`，`_closeDockFlashWorkbenchViews` 原样保留） |
| 9745–9765 | `_dockBaseInstalled()`（扫 `__DSH_BOOT__.entries` + 模块图，找 `dock-base` / `dock-base/client`） |
| **合计** | 去注释 **128 行**；加注释与包装 ≈ 250–300 行 |

`pluginId: 'dock-flash'`（13487、13501）与 `getHiddenPluginIds()` 里的 `'dock-flash'`（13582）**保持不变**：dock-base 用这个 id 存 `dock-base:hidden-plugins`，老用户的隐藏状态继续有效。

### 3.2 保留在核心（不进适配器）

- `QuickControlPanel` 全体（:6104 起）、`PanelErrorBoundary`（:161）、样式契约 `S`（:596）
- `QuickControlRegistry`（:3663）、宿主偏好桥（:2859）、i18n（:212）
- 皮肤扫描/切换（`_scanInstalledSkins` :11042 等）、告警三层（:4371 起）、面板排序（:5764）
- 主开关组（:5186）、同伴集成表（:4869–:5186）
- 紧凑模式（:3006）、**独立浮动机器**：`renderPanel`(:8389) / `applyPanelSkin`(:8163) / `positionPanel`(:8491) / `mountStandaloneSlotTrigger`(:9552 起)
- close-on-blur 三件套（:2484/:2489/:2495/:2508）—— 反之要**新增** `Header` 组件封装它们
- 宿主半边 `src/index.ts` **整体保留**（`inject: string[] = []`，:38；无任何 dock 引用）

### 3.3 核心侧需要新增/改动

1. `ctx.provide('dockFlashPanel', …)`（放在现有 :9952 / :9960 两个 provide 旁边）
2. 新增 `Header` 组件（把 §2.1 那 7 个符号封进去）
3. `mountStandalone{SlotTrigger}` 前后加 `isClaimed()` 判断 + 看门狗
4. **删除**模式判定块（:13619–13645）与 `mountWorkbench`/`mountStandalone` 的选择逻辑
5. `src/index.ts` 的 `name`（:35）→ `dsh-flash`（若选 M2，客户端 :54/:214/:3199/:3302/:3476/:3507/:7378 与宿主 :8/:205 共 **9 处**字符串同步改）

---

## 4. 设置命名空间 —— **决策点 D1**

**实测**：命名空间 = **profile patch 的 entry id**，不是包名。
`@deepseek-ai/dsh-settings/lib/types/index.d.ts:96-102` 写明 `update(ns)` 的 `@param ns Profile entry id`；本仓库 `cordis.patch.yml` 是 `id: dock-flash, name: dock-flash`（两者恰好同名，所以一直被当成包名）。
客户端侧靠 `view.namespaces.find((c) => c.ns === ns)` 定位（`lib/client.js` ≈:3300）。

| 选项 | 做法 | 成本 | 风险 |
|---|---|---|---|
| **M1（推荐）** | 核心的 patch entry 保留 `id: dock-flash`，包名/插件名改为 `dsh-flash` | 0 代码改动；适配器用 `id: dock-flash-adapter` | 设置页里会出现一个叫 `dock-flash` 的段落，而它属于 `dsh-flash`（文档写清即可） |
| **M2** | 核心 entry 改 `id: dsh-flash`，并做一次性迁移 | 9 处字符串 + 迁移例程 + 测试 | 迁移写权限未验证；漏掉就从"用户偏好全丢"变成"用户偏好全丢但代码更干净" |

**M2 的迁移为什么技术上可行**：`SettingsDescriptor` 带 `value`（`index.d.ts:8-19`），宿主侧 `settings.describe()` 不脱敏 → 核心可读到旧 `dock-flash` 段的值，再 `update('dsh-flash', values)` 写回自己的段。
**未验证点**：跨 entry 写入是否被拒（错误类型 `SettingsConflictError` 只覆盖并发冲突，但运行时是否另有授权检查需实测）。

**顺带实测到的硬约束（M1/M2 都躲不开）**：entry `id` 在 loader 里是**可以省略**的，省略就自动生成 —— `@deepseek-ai/cordis-plugin-loader/lib/index.js:162-165`：`if (!options.id) do options.id = Math.random().toString(16).slice(2, 10); while (this.store[options.id])`（8 位十六进制随机串）。既然设置命名空间就是 entry id，**核心那一行的 `id:` 必须显式写死**；否则用户的偏好会挂在一个每次重建 profile 都可能变化的随机串上，等于静默全丢。M1/M2 的差别只是"写死成哪个字符串"。另注：树内部有按 id 建的映射（同文件 `:82` `Object.fromEntries(config.map((o) => [o.id ?? Symbol("anonymous"), o]))`），重复 id 在那些映射里会互相覆盖 —— 与 §1.4 修正 3 的"必须幂等"是同一件事的两面。

> **建议**：Phase 1–3 走 **M1**（零迁移、零风险），把 M2 记为 Phase 5 的可选清理项 —— 等拆分稳定、且我们能实测跨 entry 写入之后再动。

---

## 5. 仓库与包布局（D2 已定 **L2**）

| 选项 | 布局 | 优点 | 代价 |
|---|---|---|---|
| **L2（修订后推荐）** | 新建仓库 `tcgbp/dsh-flash`（从当前仓库派生/复制历史），当前仓库 `tcgbp/dock-flash` 瘦身为纯适配器 | ①与四个同伴"一包一仓"完全一致（实测：`gitee.com/lenin.guo/dsh-flash-ctx-mon` / `-mem-mon` / `-net-mon` / `-proxy` 各自都是独立仓库，`origin` 指向 Gitee）；②**已发布的一切原封不动** —— `dock-flash` 的 npm `repository` 字段、市场条目 `docs/tcgbp__dock-flash.yml`、4 张截图的 raw URL、Release tarball URL 全都不动；③核心拿到干净仓库名 ⇒ 干净的 `repository` ⇒ 干净的市场 npm 映射 | 两套 CI / 镜像 / 发布流程（新仓库要重建 `sync-from-gitee.yml`，并新建同款 Gitee 仓库）；核心与适配器**不能原子发版**，服务契约的破坏性变更要走"先发核心、再发适配器"两步；本地 `desktop` profile 要多一条 `link:`；`AGENTS.md`(866 行) / `docs/releasing.md`(422 行) / `scripts/check-overlay-mount.mjs`(3387 行) 这套开发机具要跟着核心搬到新仓库 |
| **L1** | 当前仓库保持 `dock-flash` 不改名；根包 = `dsh-flash`（核心），`packages/dock-flash/` = 适配器 | 一次 CI / 一次镜像 / 核心与适配器**可原子发版**；`check:docs` / `check:overlay` 脚本不用搬家 | 注册表规则决定**一仓一条目**：条目文件名必须等于 `slugFor(url)` = `<owner>__<repo>.yml`（见 `docs/tcgbp__dock-flash.yml` 头部注释，已对 `scripts/lib/entries.mjs::validateEntries` 本地验证），而 **npm 名 → 条目的映射由已发布包自己的 `repository` 字段解析** ⇒ 一个仓库只能承载一条条目 ⇒ `dsh-flash` 与 `dock-flash` 会共用 `tcgbp__dock-flash.yml`，核心在市场上只能以 `dock-flash` 的身份出现；且该字段属已发布元数据，"改起来要再发一次版本" |

**为什么从 L1 改推 L2（证据）**：先前推 L1 时只看仓库自身。把同伴布局与注册表规则一起量完之后天平偏向 L2 —— (a) 家族既有的"一包一仓"是**现状**而非新决定；(b) L1 会让两个 npm 名映射到同一条市场条目，而修正这个映射要动已发布元数据（该仓库自己的 `docs/tcgbp__dock-flash.yml` 注释里就写着这条教训："a WRONG `repository` maps the package to somebody else's entry — and since it is published metadata, fixing it later costs a release"）；(c) L1 原本的卖点"后期可改名"恰好踩在**未验证**的 raw 重定向风险上（本机无法访问 raw）。L2 的真实代价是两套发布流程与一次性仓库搭建，且**绝大部分落在 Phase 4**，Phase 1–3 两种布局完全相同 ⇒ **D2 已定：L2**（用户拍板）。Phase 1–3 即按 L2 的形状执行：**适配器代码留在本仓库根**（不建 `packages/`），核心先就地抽出、继续以 `dock-flash@2.3.0` 单包发布以验证握手；到 Phase 2/4 才把核心那棵树整体搬进新仓库 `tcgbp/dsh-flash`。

---

## 6. 版本与发布策略

| 包 | 阶段 | 版本 | 理由 |
|---|---|---|---|
| `dock-flash` | Phase 1 | **2.3.0** | 纯内部重构 + 新增一个对外 service（additive = minor） |
| `dsh-flash` | Phase 2 | **1.0.0** | 新包，首个正式版 |
| `dock-flash` | Phase 2 | **3.0.0** | 同一 npm 名变成完全不同的东西 = major |
| 四个同伴 | Phase 3 | 0.1.7 / 0.1.5 / 0.1.4 / 0.1.5 | peer 目标改名（patch 级语义，但 peer 变更是 hard gate，需实测） |

**`^2.x` 用户会被范围锁死在旧单体**（pnpm 默认存 `^`）。旧单体自带全部功能、继续可用，但拿不到更新。必须在三个地方说清：README、`dock-flash@3.0.0` 的 Release notes、市场条目的描述。

**预发纪律（重要）**：npm 上 `dock-flash` 的 bypass-2FA GAT **不允许 unpublish**（实测 403）。因此：
1. 先 `npm publish --tag next`；
2. 在隔离目录 `npm install dock-flash@next` + 真机验证（存在 dock-base 的 `desktop` profile / 不存在的 profile / 隐藏态）；
3. 通过后 `npm dist-tag add dock-flash@3.0.0 latest`；
4. 最后才补 CHANGELOG / Release / 镜像。

两条 gate 纪律（AGENTS.md）不变：**gate 1 = 版本号，gate 2 = tag/push/发布**，两次都要维护者确认。

---

## 7. 分阶段执行计划

### Phase 0 — 准备（无发布）
- [ ] 重跑基线：`pnpm run check:docs`（记录 headroom）、`pnpm run check:overlay`（当前 272 PASS / 0 FAIL）
- [ ] 在 `docs/` 定稿本文；**D1–D5 已全部定案**（M1 / L2 / 发 2.3.0 / 不可选 peer / 保留+幂等）
- [ ] 干活分支 `refactor/core-adapter-split`
- **验收**：基线数字记录在案，决策点全部有结论

### Phase 1 — 就地抽出（单包，不改名，不发新包）
- [ ] 新增 `Header` 组件，把 §2.1 的 7 个符号封进去
- [ ] `ctx.provide('dockFlashPanel', …)`（§2.2）
- [ ] 把 §3.1 的代码搬到 `lib/dock-adapter.js`（本仓库内独立文件）
- [ ] 核心改为"默认挂载 ⚡ + `isClaimed()` 判断 + 看门狗"
- [ ] 适配器侧改为 `ctx.get('dockFlashPanel')` + `claim()/release()`
- [ ] `check:overlay` 新增一节：真值表 5 行 + 契约字段 + 认领看门狗
- **验收**：Check 全绿；`desktop` profile（有 dock-base）与无 dock 的 profile 两种真机验证；隐藏/恢复循环无刷新无重复面板
- **产出**：`dock-flash@2.3.0`（**此时用户侧零变化**，是纯粹的内部重构）

### Phase 2 — 拆包（L2：核心进新仓库，本仓库瘦身为适配器）
- [ ] 新建 `tcgbp/dsh-flash`：Gitee 仓库 + GitHub 镜像仓库 + `sync-from-gitee.yml`，树从本仓库复制（保留历史）
- [ ] 新仓库侧：`name: dsh-flash`、`repository: github.com/tcgbp/dsh-flash`、`cordis.patch.yml` 只插自己那一行且 **`id: dock-flash`**（D1=M1）、机具随迁（`AGENTS.md` / `docs/releasing.md` / `scripts/`）并改路径
- [ ] 本仓库侧：删掉核心代码，只留 §3.1 适配器 + 最小宿主；`name: dock-flash`；`dependencies: { "dsh-flash": "^1.0.0" }`；`peerDependencies: { "dock-base": "…" }`（不可选）+ cordis；`dsh.client.inject: ["dsh-flash", "dock-base", …]`
- [ ] 适配器 `cordis.patch.yml` **同时插核心那一行**（§1.4 修正 1，id 取法同上）+ 拿不到 `dockFlashPanel` 时大声报错（修正 2）
- [ ] 发布顺序：**先** `dsh-flash@1.0.0 --tag next` 跑通 → **再** `dock-flash@3.0.0 --tag next`
- [ ] 两包各自 `check` / `pack --dry-run` 文件清单核对（互不包含对方代码）
- **验收**：`dsh-flash` + `dock-flash@3 --tag next` 装进隔离 profile，真值表 5 行全部实测通过
- **产出**：`dsh-flash@1.0.0`、`dock-flash@3.0.0`（均先 `next`，验证后提升 latest）

### Phase 3 — 同伴重指
- [ ] 四个仓库 peerDeps：`dock-flash: …` → `dsh-flash: ">=1.0.0-0 <2.0.0-0"`（描述 / keywords 同步）
- [ ] 各自发布 + tag + Release + 市场条目
- **验收**：五包同装无 ERESOLVE；同伴开关在两种模式下都出现
- **产出**：0.1.7 / 0.1.5 / 0.1.4 / 0.1.5

### Phase 4 — 身份整理
- [ ] 两个仓库的 README（中英）："核心 + 适配器"架构图与升级指引（`^2` 用户怎么办）
- [ ] `dsh-flash` 仓库的 `AGENTS.md`：新增 `dockFlashPanel` 契约与归属握手；**注意 headroom**（上次约 2.5 KB，动手前重测）。本仓库（适配器）的 AGENTS.md 同步改成"适配器仓库"口径
- [ ] 市场：新增 `dsh-flash` 条目（`tcgbp__dsh-flash.yml`，tarball 指向新仓库 Release）；`dock-flash` 条目保留，描述里点明"dock 适配器"
- [ ] **没有仓库改名步骤**：L2 下两个仓库名本来就正确 ⇒ §9 里那条 raw 重定向未知项随之消失
- **验收**：`check:docs` 通过；市场两条目都能装

### Phase 5 — 可选
- [ ] D1=M2 的命名空间改名与迁移
- [ ] 适配器 / 核心的接口版本升级流程（`version` 字段的兼容矩阵）

---

## 8. 测试计划

**自动（`scripts/check-overlay-mount.mjs`，现有 272 PASS / 0 FAIL）**
- 真值表 5 行（用假 `workbench` service：`registerPanel` / `registerActivityBarItem` / `registerEditorView` / `registerCommand` / `registerPlugin` / `getHiddenPluginIds` / `onDidChangeSetting` 全是 stub）
- 契约形状：`dockFlashPanel` 的字段、`version`、`claim()` 幂等、lease 随 dispose 释放
- 看门狗：`claim()` 后无注册 → 自动 `release()` 并挂载 ⚡
- 隐藏/恢复：`onDidChangeSetting` 触发 → `release()` → `claim()`，且不残留两个面板

**已知限制（不要假装覆盖）**：该 harness 的 `renderTree()` 只**调用**组件、不落 DOM，所以 React 行的像素级断言仍然只能靠源级 pin；只有手写/命令式 DOM（独立头、⚡ 触发按钮）能做行为断言。

**人工（必须真机，两种 profile）**
- `desktop`（含 dock-base）：面板、活动栏、编辑器视图、命令、设置卡片、dock 隐藏/恢复循环
- 无 dock-base 的 profile：独立 ⚡、紧凑模式、双击切换、拖拽定位、失焦关闭
- 组合：核心 + dock-base 但**不装适配器**（真值表 #2，必须能看到 ⚡）

---

## 9. 风险与回滚

| # | 风险 | 缓解 | 回滚 |
|---|---|---|---|
| **R1** | 启动瞬间 ⚡ 闪现 | 适配器在同步注册成功后立即 `claim()`（早于核心的异步 `slots` 注入）；实测确认 | — |
| **R2** | `claim()` 成功但注册失败 → 界面空 | 看门狗（§2.3） | 卸载适配器 |
| **R3** | 两个插件拿到**不同 React 实例** → 跨插件组件 hooks 崩溃 | 已确认两边都是加载器提供的 `require('react')`（`lib/client.js:64`），应当共享；**Phase 1 立刻做一次 spike 验证**。若失败，应变：适配器只给一个空 `<div ref>`，核心用自己的 `createRoot` 画进去（纯 DOM 交接，不传组件） | 应变方案 B |
| **R4** | 设置命名空间迁移失败 → 用户偏好丢 | 选 M1 则不存在；选 M2 必须先做跨 entry 写入的实测 | M1 |
| **R5** | dock-base 的 `dock-base:hidden-plugins` 状态失效 | `pluginId: 'dock-flash'` 三处保持不变 | — |
| **R6** | 适配器误打包核心副本 → 两份面板 / 两份注册表 | `dsh-flash` 必须声明为 dependency（**不可** bundle）；`pack --dry-run` 核对文件清单 | — |
| **R7** | **npm 发布不可撤销**（GAT 禁止 unpublish，实测 403） | 强制 `--tag next` 预发 + 验证后再提升 latest；CHANGELOG 与 Release 最后写 | 只能 `deprecate`，不能删 |
| **R8** | ~~仓库改名导致市场 4 张截图 URL 失效~~ —— **L2 下已消失**：两个仓库名本来就正确，全流程不动任何名字 | — | — |
| **R9** | `^2.x` 用户拿不到更新 | README + Release notes + 市场描述三处说明 | 旧单体继续可用 |
| **R10** | **L2 特有**：契约漂移（核心改了契约、适配器没跟上）与"核心已发、适配器未发"的半发状态 | 契约冻结为 §2 的字段表 + `version: 1` 启动校验（不符即吵，同修正 2）；适配器对 `dsh-flash` 声明 `^1`，让不兼容组合**装不上**；发布顺序固定"先核心、后适配器"，两步都走 `--tag next` | 核心可独立运行（真值表 #1/#2 就是为此保留的） |

**Phase 1 的回滚成本极低**（单次 revert 即回到今天的行为），这是把重构与拆包分成两个阶段的主要理由。

---

## 10. 不在本次范围

- 四个同伴的内部实现（只改 peer 目标与文案）
- `dock-base` 自身（本方案不改 dock-base 一行）
- 皮肤系统 / 告警系统 / 面板排序的内部重构
- `dock-flash-qc-types` / `-qc-demo` 的补发布（CHANGELOG 0.16.0 声称存在但 npm 404，另开一项处理）
- `0.0.0-stage` 占位版本的 npm 清理（需要你在 npm 网页端操作）

---

## 11. 决策（D1–D5 全部定案）

| 编号 | 问题 | 建议 |
|---|---|---|
| **D1 ✅ 已定** | 设置命名空间：M1 保号零迁移 / M2 改名 + 迁移 | **M1**（用户已拍板）：核心 entry 保留 `id: dock-flash`，零迁移零风险；M2 仅作为 Phase 5 的可选清理项，届时要先实测"跨 entry 写入是否被允许" |
| **D2 ✅ 已定** | 仓库布局：L1 monorepo / L2 双仓库 | **L2**（用户拍板）：核心进新仓库 `tcgbp/dsh-flash`，本仓库瘦身为适配器；已发布包、市场条目、截图 URL 与 Release tarball 全部不动（§5） |
| **D3 ✅ 已定** | Phase 1 是否真的发 `dock-flash@2.3.0`（对用户零变化） | **发**（用户已拍板）：让归属握手在真实用户环境里先跑一轮，再把代码搬进新包 |
| **D4 ✅ 已定** | 适配器对 `dock-base` 是"不可选 peer"还是"可选 peer + 运行时提示" | **不可选 peer**（用户已拍板）：它对适配器就是全部意义 |
| **D5 ✅ 已定** | 重复装载（§1.4 修正 3）：核心是否保留自己的 `dsh.bundle` 声明 | **保留 + 幂等**（已实测：`insert` 不去重，同 id 会挂两次，第二次 `provide` 抛错；故核心两半侧都要单例守卫） |

**D1–D5 全部定案**（M1 / L2 / 发 2.3.0 / 不可选 peer / 保留+幂等），可据此开始 Phase 0。
