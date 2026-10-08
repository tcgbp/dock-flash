# Handoff — 核心/适配器拆分 Phase 1 之后（供新会话接手）

> 写于 2026-10-08。本文是**交接文件**：新会话读它即可继续，不必依赖上一会话的对话历史。
> 计划与决策全文在 [refactor-plan-core-adapter-split.md](refactor-plan-core-adapter-split.md)。

## 0. 一句话状态

分支 `refactor/core-adapter-split`，**6 个本地提交、一行未推送**；全部自检绿（`check:overlay` **295 PASS / 0 FAIL**、`check:docs` 版本一致、`typecheck`/`build` 通过）。等待**用户界面复验** → 然后 gate 2 发布 `dock-flash@2.3.0` → 再进 Phase 2 拆包。

## 1. 目标与已定方案

**反转拆分**：核心 `dsh-flash`（对 dock 零依赖，永远提供独立 ⚡ 与面板）+ 适配器 `dock-flash`（依赖核心；`dock-base` 为**不可选 peer**）。原方向（把独立模式拆出去）是把依赖方向搞反了，用户提出的反转才是对的——理由与实测见计划文档。

决策（D1–D5，全部定案）：

- **D1 = M1**：设置命名空间 = profile patch 的 **entry id** ⇒ 核心 entry 保留 `id: dock-flash`，零迁移；且 entry id **必须显式写死**（loader 省略时用 `Math.random().toString(16).slice(2,10)` 生成，用户偏好会挂到随机串上）。
- **D2 = L2**：核心进**新仓库** `tcgbp/dsh-flash`，本仓库瘦身为适配器。因为注册表**一仓一条目**（文件名必须 = `slugFor(url)` = `<owner>__<repo>.yml`），且 npm 名→条目映射取自**已发布包自己的 `repository` 字段**；L2 下已发布物（npm `repository`、市场条目、4 张截图 raw URL、Release tarball URL）全不动。
- **D3**：Phase 1 照发 `dock-flash@2.3.0`（对用户零可见变化），让归属握手先在真实环境跑一轮。
- **D4**：适配器对 `dock-base` 用**不可选 peer**。
- **D5 = 核心保留自己的 `dsh.bundle` + 两半侧幂等**（实测：`insert` 不按 id 去重；同一插件挂两次会 `apply` 两次，第二次 `ctx.provide` 抛 `service "…" has been registered at …`）。

## 2. 提交（本地，未推送）

| Commit | 内容 |
|---|---|
| `87fa265` | docs: 计划文档（D1–D5、装载机制实测、Phase 0–5） |
| `1319551` | refactor: Phase 1 —— `dockFlashPanel` 服务、`createPanelHeader`、归属握手、`//#region DockAdapter` |
| `f7b4378` | release: v2.3.0（`package.json` + `CLIENT_VERSION` + CHANGELOG 行） |
| `83cd0dc` | docs(plan): 真机 boot 验证记录（两个副本 profile 的证据） |
| `2bc6cff` | fix(adapter): claim 持有计数（多挂载不再互相抽走面板） |
| `4b1b409` | fix(adapter): 同栈服务解析（用户报障根因，见 §5） |

## 3. 已验证 / 待验证

**自动**：`pnpm run check:overlay` 295 PASS / 0 FAIL（第 28 节覆盖真值表、契约字段、看门狗、晚到 workbench、两种拒绝、region pin、多挂载计数、无法解析面板的 ctx）；`pnpm run check:docs`（AGENTS.md 62958/65536，headroom 2578，39 links，版本 2.3.0 与 `CLIENT_VERSION` 一致）；`pnpm run typecheck` / `build` 通过。

**真机（两个副本 profile，`dock-flash` 以 `link:` 接入本工作树）**：

- `probe-desktop`（`desktop` 完整副本，含 dock-base）：boot 图含 dock-flash entry；服务器下发的 bundle 确为重构版（717,117 字节，`CLIENT_VERSION='2.3.0'`、`dockFlashPanel`×10、`createPanelHeader`、`CLAIM_WATCHDOG_MS`、`//#region DockAdapter`）；宿主半侧 `/plugins/dock-flash/health` 与 `/profile-packages` 均 200；日志无 `ReferenceError`。
- `probe-nodock`（`--from-default-profile web` 新建、只加 dock-flash）：boot 图含 dock-flash、**完全不含** dock-base 包（页面唯一 "dock-base" 字样是 `dsh.client.inject` 的加载顺序提示）；`/profile-packages` 回 `{"installed":["dock-flash"],"active":[…,"dock-flash"],…}`。
- 用户原三个 profile（`desktop` / `web` / `web-desktop`）**均未被改动**（已逐项核对）。`desktop` 的 `dock-flash` 原本就是 `link:C:/codes/ai-test/dock-flash`。

**待用户**：见 §6。

## 4. 关键技术约束（勿重新推导）

- **cordis 服务解析是异步的**：`ctx.provide('dockFlashPanel', …)` 之后**同一同步调用栈**里 `ctx.get('dockFlashPanel')` 返回 `undefined`（对真实 cordis 4.0.4 实测：同栈 `undefined`、下一 tick 才有值）。因此服务必须**显式传参**：`mountDockPanelAdapter(ctx, panelArg)`（`lib/client.js:9876`），解析式为 `panelArg || (ctx.get ? ctx.get('dockFlashPanel') : undefined)`（`lib/client.js:9893`）；apply 调用点 `lib/client.js:13967` 传 `panelService`；测试缝 `lib/client.js:10569`。
- **客户端 bundle 的同步 `require` 不支持相对路径**（`@deepseek-ai/dsh-client-modules/lib/client.js:698-706` 只认 seed 词/已 materialize 模块/已注册工厂，否则抛 `require("…") missed the module table`；只有 `require.async('./client.<name>.js')`，文件名须匹配同文件 `:470` 的正则）。故 Phase 1 的适配器是 `//#region DockAdapter` **区域**（`lib/client.js:9815` 起），Phase 2 才获得文件/包边界。
- **装载机制**：profile 的 `node_modules` 是 `nodeLinker: hoisted`（传递依赖也会被提升到顶层）；只有 profile `dependencies` 里且自己声明 `dsh.bundle` 的包才进 `dsh.profile.bundles`，也只有它们贡献 patch 层；**客户端半侧只挂在"说明符恰为裸包名"的那一行 entry 上** ⇒ 适配器的 `cordis.patch.yml` 必须**同时插入核心那一行**（`- id: dock-flash / name: dsh-flash` 与 `- id: dock-flash-adapter / name: dock-flash`），否则核心"装上但没被组合"、客户端半侧不提供 ⇒ 一片空白且无报错。拿不到服务时**必须大声报错**。
- `autoInstallPeers: false` ⇒ 核心不能走 peer，必须普通 `dependencies`。
- dock-base 契约（`~/.dsh/profiles/desktop/node_modules/dock-base/lib/types/client/contract.d.ts`）：`ViewDefinition` 与 `WorkbenchLayout` **都没有宽度字段**（dock 面板宽度不是插件能改的）；`ViewProps = { ctx, viewId, sessionId?, active, seed? }`，**headerComponent 收到的是 `ctx` 而非 `wb`**；`pluginId` 与 profile entry id 是两回事。

## 5. 实施中修掉的缺陷（都值得记住）

1. `mountWorkbench` 变成模块级后仍闭包引用 apply 的 `ctx` ⇒ 真实 boot 首启抛 `ReferenceError: ctx is not defined`（被第 28 节断言先抓到）⇒ 加 `ctx` 形参。
2. 失焦关闭 toggle 自 2.2.0 起把 preference 写给 **workbench 服务**（应为 registry）⇒ `notifyChange` 抛进 try/catch 被吞、工作台标题栏从不重绘 ⇒ 改写核心 registry。
3. header props 形状：dock-base 传 `{ctx,…}`，核心 header 改为两种形状都接受；适配器改为 `headerComponent: (props) => panel.Header({ ...props, wb })`。
4. **claim 持有计数**（`2bc6cff`）：dock-base 两条路都会挂面板（侧栏 pane + 浮动窗），旧 lease 单例 ⇒ 先卸载者把面板从另一个仍挂载的实例底下抽走。最终：`_claimHolders` 与 lease 同放 host，**唯一不变量 = 计数非零 ⇔ lease 活着**，统一 `releaseAll(reason)`，每挂载 disposer **只** `releaseOne()`，只有 dock-hidden/整宿主拆卸可 `release()`。两处错误尝试（disposer 兼调 `release()`；`release()` 自行清零）都被新断言先抓到。
5. **同栈服务解析**（`4b1b409`，用户报障的直接根因）：见 §4 第一条。**用户报障原文**（User said (m01803)）："dock-flash 没有出现在dock-base配置里"；环境由用户确认为 `3199/probe-desktop`（User said (m01847): "3199/probe-desktop"）⇒ 即**本分支**而非 npm 2.2.0。**harness 抓不到的原因**：沙箱 ctx 的 `get()` 从普通对象同步取值，把这个机制桩掉了；新断言改为复现生产条件（无法解析面板的 ctx + 显式传服务仍须五次注册）+ 源级 pin 断言调用点确实传了服务。

## 6. 用户界面复验清单（gate 2 之前必须过）

在 3199（或重开 `dsh probe-desktop --no-open --port 3199`）**硬刷新**后确认：

1. dock-base 配置/侧栏里**出现 dock-flash（Flash）**——这是本次修复的直接目标；
2. 面板外观与 2.2.0 一致（用户侧零变化）；
3. 标题栏的失焦关闭开关能带动面板内「布局 → 失焦关闭」行同步变化；
4. **隐藏 ↔ 恢复循环**：在 dock-base 插件可见性里隐藏 Flash → 面板消失、⚡ 立刻回来；恢复 → ⚡ 消失、面板回来；全程不刷新、不重影；
5. 控制台出现 `[dock-flash] client v2.3.0` 与 `workbench mode — dock-base detected`，**不应**出现 `dock-base is present but the core panel service (dockFlashPanel) is missing`。

## 7. 后续步骤（均需维护者批准）

- **gate 2**：推 Gitee → 镜像 GitHub（校验 tree）→ annotated tag `v2.3.0` → GitHub Release + `dock-flash.tgz` 资产（逐字节校验）→ `npm publish`（bypass-2FA 会**暂存**，先 `--tag next` 验证再 `dist-tag` 提升 latest；GAT **不能 unpublish**）。
- **Phase 2（L2）**：新建 `tcgbp/dsh-flash`（Gitee + GitHub 镜像 + `sync-from-gitee.yml`）；核心树复制过去（`name: dsh-flash`、`repository` 指新仓库、`cordis.patch.yml` 保留 `id: dock-flash`、开发机具随迁）；本仓库瘦身为适配器（`dependencies: { "dsh-flash": "^1.0.0" }`、peer `dock-base` 不可选、patch 插两行、`dsh.client.inject` 加 `dsh-flash`）；发布顺序**先核心后适配器**，两步都先 `--tag next`。
- **Phase 3**：四个同伴（`dsh-flash-ctx-mon` / `-mem-mon` / `-net-mon` / `-proxy`，各自独立仓库）peer 由 `dock-flash` 改指 `dsh-flash`，再各自发版。
- 挂着的其他事项：四个同伴的**市场条目 PR**（需用户 GitHub 账号）；`0.0.0-stage` 占位版本的 npm 清理（需用户在 npm 网页端操作，窗口至 **2026-10-09T14:11Z**，已全部 deprecate）；探针 profile `probe-desktop` / `probe-nodock` 用户表示先留着，用完可删。

## 8. 环境与工具配方（省得重新踩）

- 启动 profile：`node "C:/Users/ThinkPad/.dsh-versions/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/dsh/lib/bin.js" <profile> --no-open --port <N>`。`dsh web --profile X` 与 `dsh --profile desktop …` 都会报错（desktop profile 由 Electron 独占管理）。
- DSH web 需要 token：先 `curl -L -c jar "http://127.0.0.1:<port>/?token=<token>"`，再 `curl -b jar` 取 `/plugins/...`；页面 HTML 里的 `&amp;` 要还原成 `&`，否则 bundle URL 会 404。
- GitHub API 凭据：`git credential fill`（`protocol=https` / `host=github.com`）取 token，**勿回显**；镜像 dispatch 用 `api.github.com/repos/tcgbp/dock-flash/actions/workflows/sync-from-gitee.yml/dispatches`（body `{"ref":"master"}`，期望 HTTP 204）。
- 校验镜像：比较 API `/repos/tcgbp/dock-flash/commits/master` 的 `commit.tree.sha` 与本地 `git rev-parse master^{tree}`。
- Windows Python 读 curl 落的 JSON 必须 `encoding='utf-8'`（默认 GBK 会 `UnicodeDecodeError`）；MSYS 的 `/tmp` **不是** Windows 路径，落盘请用仓库内 `_*.json`（已被 `.gitignore` 覆盖）。
- **上一会话的 `compress` 工具 20 次失败**（工具侧 ref 上限 m01564，而可见 ref 已到 m01981 —— 两套 ref 代际不一致，任何区间都无法解析）。这就是本交接文件存在的原因：**新会话请直接读本文 + 计划文档续做，不要依赖旧对话历史。**

Open objectives: 用户在 3199 复验修复后的界面（第 6 节五项）；gate 2 发布 `dock-flash@2.3.0`；Phase 2 拆包（第 7 节）。
