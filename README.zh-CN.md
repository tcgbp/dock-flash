# dock-flash

> DSH 快捷控制面板的 **dock-base 适配器** —— 通过 `ctx.workbench` 把面板挂载进 DSH 工作台。
> 面板本身（组件树、`quickControl` 开关注册表、皮肤系统、中英文国际化、告警表面、宿主路由与
> 独立模式的 ⚡）是另一个独立包 **[`dsh-flash`](https://github.com/tcgbp/dsh-flash)**。

**[English](./README.md)**

## 核心 + 适配器

| 包 | 角色 | 依赖 dock-base？ |
| --- | --- | --- |
| [`dsh-flash`](https://github.com/tcgbp/dsh-flash) **v1** | 面板**核心**。拥有 React 面板、`quickControl` 注册表、皮肤系统、告警表面、独立模式 ⚡，以及整个 Host 半（设置命名空间、`/plugins/dock-flash/…` 路由）。 | 否 —— 可单独运行 |
| **`dock-flash` v3**（本包） | 很薄的**适配器**。把面板注册进 dock-base 工作台，并向核心认领它。自身不发布任何服务。 | 是 —— `dock-base` 是**非可选** peer |

两半只在一个对象上会合：核心的 `dockFlashPanel` 服务。适配器只通过该服务上的 `panel.*`
读取面板，从不触及核心内部，因此边界是一个封闭集合。

| 你想要什么 | 安装 | 你得到什么 |
| --- | --- | --- |
| 工作台（dock-base）集成 | `dock-flash@^3`（会把 `dsh-flash` 一并拉入），外加 `dock-base` | 侧边栏/浮窗面板、设置卡片、活动栏 ⚡、编辑器视图、`dock-flash:openQuickControl` 命令 |
| 只要独立的悬浮 ⚡ | 单独安装 `dsh-flash` | 在所选会话槽位注入 ⚡ 触发按钮 → 浮动面板 |

> **本包不是面板。** 开关注册表、皮肤、国际化、告警路由与独立模式触发按钮都在 `dsh-flash`
> 里 —— 这些内容请看[核心 README](https://github.com/tcgbp/dsh-flash#readme)。本文只讲适配器
> 与这次拆分。

### 从 `dock-flash` v2 升级

1. **`^2.x` 依赖范围会让你继续留在旧的一体包上 —— 默认什么都不会坏。** 这次拆分新增了一个
   大版本（`dock-flash@^3`），而不是替换 v2。要迁移，安装 `dock-flash@^3`；它依赖
   `dsh-flash`，npm 会替你装好。
2. **有一处 profile 编辑是必须的，而且很容易漏掉。** profile 的 `cordis.patch.yml` 里承载
   面板设置的那条是 `- id: dock-flash` 配 `name: dock-flash` —— 一个非 insert 补丁，它的
   `name:` 是对目标行**当前 specifier 的断言**。拆分后 `id: dock-flash` 解析到核心行，而核心行
   的 specifier 是 `dsh-flash`，断言因此不匹配，DSH 会打印
   `patch: name mismatch for "dock-flash" (expected "dsh-flash", got "dock-flash"), skipping`，
   整个 `config:` 块被**丢弃** —— 面板顺序、皮肤与触发位置/大小会被静默还原。**修法：** 把该条
   的 `name: dock-flash` 改成 `name: dsh-flash`，并**保留 `id: dock-flash`**。不要删除该条目。
3. **不要手动把核心行写进 profile。** 安装 `dock-flash@^3` 才是受支持的路径，它的 bundle patch
   会替你插入核心行。

## 这个适配器做什么

`lib/client.js`（470 行）就是整个浏览器半：原来的 `//#region DockAdapter` 区块被提升为一个包。
它消费核心的 `dockFlashPanel` 服务，并且恰好做 **五** 个 `ctx.workbench` 注册：

| 注册项 | API | Id | 细节 |
| --- | --- | --- | --- |
| 侧边栏面板 | `ctx.workbench.registerPanel()` | `dock-flash:quick-control` | 区域 `sideBar`，order 50 |
| 插件入口 | `ctx.workbench.registerPlugin()` | `dock-flash` | 设置卡片；可见性开关 + 打开按钮 |
| 活动栏图标 | `ctx.workbench.registerActivityBarItem()` | `dock-flash:quick-control` | paneId `dock-flash:quick-control` |
| 编辑器视图 | `ctx.workbench.registerEditorView()` | `dock-flash:quick-control` | 可拖出为浮动窗口 |
| 命令 | `ctx.workbench.registerCommand()` | `dock-flash:openQuickControl` | 以浮动方式打开该视图 |

**它不发布任何东西** —— 没有 `quickControl`，也没有 `dockFlashPanel`。它渲染的面板被包在核心的
`ErrorBoundary` 里，并使用核心的 `panel.Header` 与 `panel.icon`；用户设置只通过 `panel.i18n` /
面板服务读取。

### 认领握手

挂载时适配器调用 `panel.host.claim()`，然后 `lease.confirm()`。每次挂载的 disposer **只**调用
`panel.host.releaseOne()` —— **绝不调用 `release()`**。整宿主级的 `panel.host.release()` 只在
dock 隐藏路径上调用（当 `wb.getHiddenPluginIds()` 含 `dock-flash` 时），它把面板交还核心，让核心
重新挂出自己的独立 ⚡。

这条理由很关键：早先的版本在每次挂载的 disposer 里也调用了 `release()`，结果**弄坏了两处挂载的
情形** —— dock-base 可能同时挂载面板两次（侧边栏与浮动窗口）。`release()` 是整宿主级的释放，于是
第一处挂载的拆卸把面板从仍持有它的第二处挂载手里抽走了。每次挂载的 disposer 只释放一次认领。

如果 `workbench` 服务还没到达，适配器用 `ctx.inject(['workbench'], …)` 订阅，并在它到达时挂载，
而不是假设加载顺序；「服务稍后到」和「没装 dock-base」被区分开来。适配器还会拒绝
`version !== 1` 的 `dockFlashPanel`，宁可保留核心的 ⚡，也不画出半个面板。

## Host 半

`src/index.ts`（34 行）是一个**有意为空**的宿主插件：

```ts
export const name = 'dock-flash-adapter'
export const inject: string[] = []

export function apply(_ctx: Context): void {
  // Intentionally empty. Everything this package does is in `lib/client.js`.
}
```

它的 `name = 'dock-flash-adapter'`，**不是 `dock-flash`** —— 那个名字属于核心的宿主插件，设置
命名空间归它所有。这个文件只为一个原因存在：client bundle 会挂在一条以裸包名为 specifier 的
profile 行上，因此没有宿主入口点的包就没有可挂载其浏览器半的行。

**`inject: []` 是有意为之。** 在其中声明 `dockFlashPanel` 会让 cordis 在服务缺席时静默跳过
`apply()`，于是「装坏了」看起来就和「没装」一模一样。因此 `apply` 改用
`ctx.inject(['dockFlashPanel'], …)` 解析服务，并装上 **2000 ms 看门狗**，让它在失效时大声报错、
而不是静默无操作：

```
[dock-flash] the core panel service (dockFlashPanel) never arrived — the dsh-flash core is not installed, or its client half did not load. The panel will not be mounted into the workbench. Install or reinstall it with `dsh plugin install dsh-flash`, then reload.
```

## 两行如何被组装

`cordis.patch.yml` 插入**两**行：

```yaml
- insert:
    - id: dock-flash
      name: dsh-flash          # 核心
    - id: dock-flash-adapter
      name: dock-flash         # 本包
```

**为什么核心行在这里。** 被提升（hoisted）的包不是被组装的行。DSH 组装 profile 点名的行，加上
被组装包自身 bundle patch 插入的行；仅仅因为某个依赖存在，并不会有任何东西去走它的
`dsh.bundle.patch`。`dsh-flash` 是真正的 `dependencies` 条目，所以它会落到磁盘上 —— 但若没有
第一行，一次「只装适配器」的安装会加载不了任何核心插件、发布不了 `dockFlashPanel`，适配器的
看门狗只能空等到超时。

**为什么 id 保留 `dock-flash`。** 条目 id **就是**设置命名空间。因此设置命名空间、
`dock-flash:*` 开关 id、`dock-flash:…` 的 localStorage 键以及 `/plugins/dock-flash/…` 宿主路由
全都合理地保留 `dock-flash`。**这不是 bug —— 不要在任何地方「纠正」这些字符串。** 保留该 id 正是
这次拆分无需迁移的原因。

客户端模块 id 是 `dock-flash`，核心的是 `dsh-flash` —— 两个客户端模块不能共用同一个 require 键。

## 环境要求

| 依赖 | 版本 / 值 | 说明 |
| --- | --- | --- |
| `dock-base` | `>=0.1.2-0 <1.0.0-0 \|\| >=0.2.0-0 <1.0.0-0` | **peer，非可选。** 提供 `ctx.workbench` 服务 |
| `@deepseek-ai/cordis` | `>=4.0.0-rc.1 <5.0.0-0 \|\| >=4.0.1-0 <5.0.0-0` | peer（DSH 自带） |
| `dsh-flash` | `^1.0.0` | 普通 `dependency` —— 面板核心 |

`dsh.client.inject` 为
`["dsh-flash", "dock-base", "@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-api-session-controller"]`，
`dsh.bundle.patch` 指向 `./cordis.patch.yml`。

## 疑难排查

- **以链接方式接入的核心需要有它自己的 `pnpm install`。** 如果你对着本地的 `dsh-flash` 检出
  开发（软链进 profile），那个检出必须自己装好依赖。否则核心的宿主半会以
  `Cannot find package '@deepseek-ai/schemastery'` 导入失败，DSH 则报告
  `dock-flash (dsh-flash): failed to import`。
- **面板始终不出现，控制台里是看门狗那条消息。** 核心的客户端半没有加载。重装它：
  `dsh plugin install dsh-flash`，然后刷新。
- **升级后面板顺序、皮肤或触发位置被还原了。** profile 补丁的 `name:` 断言不匹配，`config:`
  块被丢弃 —— 按 [从 `dock-flash` v2 升级](#从-dock-flash-v2-升级) 一节修好它。发生这种情况时
  DSH 会打印 `patch: name mismatch for "dock-flash" …`。

## 开发

```sh
pnpm install
pnpm run build          # tsc → dist/index.js
pnpm run typecheck      # 仅类型检查
pnpm run check:docs     # 指令文件体积预算 + 链接解析
pnpm run check:overlay  # 适配器挂载行为检查
```

开发规则与关键约束见 [AGENTS.md](./AGENTS.md)；各版本的改动内容见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

[Apache License 2.0](./LICENSE)
