# dock-flash

> DSH 快捷控制插件 —— 可独立运行或配合 [dock-base](https://github.com/AKS1st/dock) 使用。点击⚡图标打开快捷控制悬浮窗口，**支持其他插件动态注册快捷开关**。

## 运行模式

| 模式 | 条件 | 界面 | 可用开关 |
| --- | --- | --- | --- |
| **工作台模式** | 已安装 dock-base | ⚡ 图标在活动栏 → 侧边栏/浮窗面板 | 外观 + 系统开关 |
| **独立模式** | 未安装 dock-base | ⚡ 触发按钮注入所选会话槽位（默认：输入框右侧）→ 浮动面板 | 外观 + 布局 + 系统 |

## 功能

### 内置开关

内置开关按外观 / 布局 / 系统三组分类显示（紧凑双列布局）。其中「布局」组仅独立模式会出现：

| 分组 | 开关 | 类型 | 说明 | 独立模式 |
| --- | --- | --- | --- | --- |
| 🎨 外观 | 外观 | select | 浅色 / 深色 / 跟随系统，切换 DSH 全局外观（含 wxj-black-hole 主题冲突重试机制） | ✅ |
| 🎨 外观 | 皮肤 | select | 动态扫描已安装皮肤插件并切换（需要 dsh-market） | ✅ |
| 🎨 外观 | 全屏 | toggle | 浏览器 Fullscreen API，全屏/退出全屏 | ✅ |
| 🎨 外观 | 日志下载按钮 | toggle | 显示/隐藏会话日志下载按钮 | ✅ |
| 📐 布局 | 失焦关闭 | buttongroup | 关闭 / 开启，点击面板外部时自动关闭浮窗。标题栏上也有同一开关（两种模式） | ✅ |
| 📐 布局 | 触发位置 | select | 输入框左 / 输入框右 / 会话标题栏操作区 / 会话标题栏工具区 —— 独立模式 ⚡ 触发按钮注入的位置 | ✅ |
| ⚙️ 系统 | 语言 | buttongroup | 中文 / English，切换 DSH 全局 UI 语言 | ✅ |
| ⚙️ 系统 | 系统代理 | select | 全部代理 / 仅 API 绕过 / 全部绕过 / 自定义 — 细粒度 NO_PROXY 控制 | ✅ |
| ⚙️ 系统 | 测试 URL | select | Google 204 / GitHub / DeepSeek API / 自定义 —— 测试连接所探测的地址。生效的 URL 在「测试连接」上方单独占一整行完整显示 | ✅ |
| ⚙️ 系统 | 诊断日志 | log | 只读多行日志，显示**最近一次**测试结果 —— 一行一件事，未测试前隐藏，点 ✕ 清空（不受 30 秒 TTL 限制） | ✅ |

> **「布局」分组只在独立模式出现。** 集成模式下 `close-on-blur` 只以面板标题栏按钮的形式存在，因此没有任何内置开关带 `group: 'layout'`，该分类会被整体跳过。

> **停靠布局不在这里配置。** 停靠边、自动隐藏、保留空间、图标缩放都是 dock-base 自己的设置项 —— dock-flash 有意不重复提供。布局分组里 dock-flash 只拥有 `trigger-position` 与 `close-on-blur`，两者都仅独立模式存在。

### 核心能力

- 🧩 **动态发现** — 其他插件通过 `quickControl` 服务注册自己的快捷开关，面板自动渲染
- 🌐 **国际化** — 完整的中英文本地化，自动跟随 DSH 语言设置（通过 `<html lang>` MutationObserver 实时同步）
- 🎨 **皮肤系统** — 多层发现 + 分类切换（CSS / 托管 / 排除）
- 🛡️ **错误边界** — 所有面板组件包裹在 `PanelErrorBoundary` 中，防止渲染错误崩溃整个 dock-base WorkbenchRoot
- 🔌 **独立运行** — 无需 dock-base 即可运行：⚡ 触发按钮注入到所选会话槽位，点击展开悬浮面板
- 📝 **最近修改** — 自动记录开关操作（30 秒 TTL），以 "旧值 → 新值" 格式展示
- 🩺 **连接诊断** — 只读多行日志，记录最近几次代理测试（链路走向、重定向链、耗时、响应体大小、socket 错误码），跨多次测试保留

### Host 端功能

`src/index.ts`（Host 半）提供：

- 注册 `dock-flash` 设置命名空间（`proxyMode` 字符串 + `customNoProxy` 字符串 + `testUrl` 字符串）
- 监听代理模式变更，通过 `@deepseek-ai/dsh-http-proxy` 重新安装 undici 全局 dispatcher，使出站 `fetch()` 请求遵循用户设定的 NO_PROXY 规则
- 提供 HTTP 路由：
  - `GET /plugins/dock-flash/proxy-status` — 返回当前 `proxyMode`、`customNoProxy`、`testUrl` 及实际 `NO_PROXY` 环境变量值
  - `POST /plugins/dock-flash/test-connection` — 执行诊断式连通性探测；可选用 `{ "url": "..." }` 请求体覆盖已存目标

#### 连接诊断

`POST /plugins/dock-flash/test-connection` 返回的是一份结构化诊断报告，而不是简单的成功/失败：

| 字段 | 含义 |
| --- | --- |
| `proxy` | `{ mode, noProxy, httpProxy, proxied, routeError }` —— `dsh-http-proxy` 会如何路由这个具体 URL |
| `redirects` | 重定向链，逐跳手动跟随（`redirect: 'manual'`）记录；超出上限时 `redirectLimitHit` 为真 |
| `status` / `statusText` | 最终响应状态 —— **只要能拿到 HTTP 响应就算 `ok`**，因为它已经证明网络通路是通的 |
| `headersMs` / `bodyMs` / `elapsedMs` | 响应头耗时、响应体耗时、总耗时 |
| `bodyBytes` / `bodySnippet` | 响应体大小，以及文本型响应体前 200 字节 —— 企业代理自己的「已拦截」页面就出现在这里 |
| `error` | `{ name, message, code, causeName, causeMessage, causeCode, causeErrno }` —— 内层 undici `cause` 才携带 `ENOTFOUND`、`ECONNREFUSED`、`UND_ERR_CONNECT_TIMEOUT`、`DEPTH_ZERO_SELF_SIGNED_CERT` 等真实原因 |

面板把这份报告渲染成 **诊断日志** 区块，一行一件事，并且跨多次测试保留，便于前后对比。

> **测试目标是一个设置项，绝不是一个常量。** `testUrl` 默认 `https://www.google.com/generate_204`，保存在磁盘上的 DSH 配置里，因此内网地址可以配置而不会出现在本仓库中。

#### 代理模式选项

| 模式 | NO_PROXY | 效果 |
| --- | --- | --- |
| 全部代理 | *（移除）* | 所有流量走系统代理 |
| 仅 API 绕过 | `api.deepseek.com,chat.deepseek.com` | DeepSeek API 请求绕过代理 |
| 全部绕过 | `*` | 所有流量绕过代理（直连） |
| 自定义 | *（用户自定义）* | 用户通过输入框指定 NO_PROXY 值 |

#### 代理作用范围

> **此设置仅影响 DSH 进程内的 `fetch()` 请求。**
>
> - ✅ **受影响**：Node.js 内置 `fetch()`（undici）、DSH API 调用、MCP HTTP 传输层、pi-ai provider 及所有经过 `globalThis.fetch` 的 SDK
> - ❌ **不受影响**：通过 `node:http`/`node:https` 模块发出的请求（如 OTLP 遥测）、自建传输层的 SDK（如 E2B）、操作系统的其他应用程序、浏览器或其他终端会话
> - 此设置在 Windows、macOS、Linux 上行为一致 — 修改的是 `process.env` 和 undici 全局 dispatcher，均为 Node.js 抽象层，无操作系统差异

## 结构

```
src/index.ts      HOST 半 — 设置命名空间 + 代理模式 + 连接测试（tsc → dist/）
lib/client.js     BROWSER 半 — quickControl 注册表 + 动态面板 + 皮肤系统 + i18n
cordis.patch.yml  bundle layer — 将宿主行插入 profile
```

## 插件契约

安装 dock-base 时，本插件遵循 [dock-base 插件契约](https://github.com/AKS1st/dock/blob/main/src/client/contract.ts)，通过 `ctx.workbench` 方法调用协作：

| 注册项 | API | 说明 |
| --- | --- | --- |
| 侧边栏面板 | `ctx.workbench.registerPanel()` | 快捷控制面板（sideBar 区域） |
| 活动栏图标 | `ctx.workbench.registerActivityBarItem()` | 闪电图标⚡，点击打开侧边栏 |
| 编辑器视图 | `ctx.workbench.registerEditorView()` | 快捷控制面板（可拖出为浮动窗口） |
| 命令 | `ctx.workbench.registerCommand()` | `dock-flash:openQuickControl` 命令 |
| **快捷开关注册表** | `ctx.provide('quickControl', registry)` | 供其他插件注册开关 |

**未安装 dock-base** 时，dock-flash 自动进入独立模式：直接在 DOM 中注入悬浮⚡触发按钮和弹出面板，提供所有非布局类开关。

---

## 🧩 动态发现 API

本插件发布 `quickControl` 服务到 `WorkbenchContext`。其他插件通过 `ctx.get('quickControl')` 获取注册表并注册自己的快捷开关。

### 开关类型

| 类型 | 说明 | 必需字段 |
| --- | --- | --- |
| `toggle` | 布尔开关 | `getValue()`, `setValue(boolean)` |
| `slider` | 数值滑块 | `getValue()`, `setValue(number)`, `min`, `max`, `step` |
| `select` | 下拉选择 | `getValue()`, `setValue(any)`, `options` |
| `buttongroup` | 按钮组 | `getValue()`, `setValue(any)`, `options` |
| `action` | 操作按钮 | `run()` |

### QuickSwitchDefinition

```ts
interface QuickSwitchOption {
  label: string | (() => string)
  value: any
}

interface QuickSwitchDefinition {
  /** 全局唯一 id，建议用 "插件名:开关名" 格式，如 "dock-git:show-stash" */
  id: string
  /** 显示标签（支持函数式 i18n） */
  label: string | (() => string)
  /** 图标（emoji 或文字） */
  icon?: string
  /** 开关类型 */
  type: 'toggle' | 'slider' | 'select' | 'buttongroup' | 'action'
  /** 排序权重（升序），内置项用 10-60，建议从 100 开始 */
  order?: number
  /** 内置分组：'appearance' | 'layout' | 'system'（仅 dock-flash:* 内置项有效，第三方开关忽略此字段） */
  group?: string

  // ── toggle / slider / select / buttongroup 通用 ──
  getValue?: () => any
  setValue?: (value: any) => void

  // ── slider 专用 ──
  min?: number
  max?: number
  step?: number
  formatLabel?: (value: number) => string

  // ── select / buttongroup 专用 ──
  options?: QuickSwitchOption[] | (() => QuickSwitchOption[])

  // ── action 专用 ──
  run?: () => void | Promise<void>
  actionLabel?: string
}
```

### 注册示例

```js
// 在其他插件的 client.js factory 中：
exports.inject = ['quickControl']   // ← 声明服务依赖

exports.apply = function (ctx) {
  const registry = ctx.get('quickControl')

  ctx.effect(() => {
    const dispose = registry.registerSwitch({
      id: 'dock-git:show-stash',
      label: 'Show Stash',
      icon: '📦',
      type: 'toggle',
      order: 100,
      getValue: () => myGitState.showStash,
      setValue: (v) => { myGitState.showStash = v },  // 只更新状态，面板自动处理 UI
    })
    return dispose  // 卸载时自动反注册
  }, 'dock-git: quick-control switch')
}
```

### 服务依赖声明

第三方插件必须声明对 `quickControl` 服务的依赖，确保 dock-flash 先完成注册再调用 `apply()`。在 client half 中添加 `exports.inject`：

```js
// client.js — factory 内
exports.inject = ['quickControl']   // ← 必须声明，否则服务可能尚未就绪
exports.apply = function (ctx) {
  const registry = ctx.get('quickControl')  // 服务已就绪，无需 null 检查
  // …
}
```

同时在 `package.json` 的 `dsh.client.inject` 中声明模块级依赖，确保 dock-flash 的 client 脚本先于本插件加载：

```json
{
  "dsh": {
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "dock-flash/client"]
    }
  }
}
```

### 动态值更新

如果开关的值在面板外部发生变化（如定时器、服务器推送、其他 UI 操作），调用 `registry.notifyChange(id)` 触发面板刷新：

```js
const registry = ctx.get('quickControl')
// 某个异步事件导致值变了
myGitState.showStash = true
registry?.notifyChange('dock-git:show-stash')
```

> **注意**：用户在面板中操作开关时，dock-flash 会自动刷新该开关的 UI，无需手动调用 `notifyChange`。此方法仅在面板感知不到的外部值变化时使用。

### 变更日志

面板自动为每次用户交互（点击 toggle、拖动 slider、选择 option、点击 buttongroup / action 按钮）记录变更日志，在"最近修改"选项卡中展示（30 秒自动过期）。

**插件不需要手动调用 `_notifyChange`**。面板在渲染每个开关时已注入 `_notifyChange` 方法并在用户交互时自动调用。`setValue()` 只需更新内部状态：

```js
// ✅ 正确：setValue 只更新状态
setValue: (v) => { myState = v }

// ❌ 错误：不要在 setValue 中调用 _notifyChange（会产生重复记录）
setValue: (v) => { myState = v; sw._notifyChange?.('旧', '新') }
```

`_notifyChange(oldDisplay, newDisplay)` 仅在插件**主动**改变状态（非用户面板操作）且需要记录变更日志时使用，例如：

```js
// 定时器自动切换深色模式
setTimeout(() => {
  state.darkMode = true
  const sw = registry.getSwitches().find(s => s.id === 'my-plugin:auto-dark')
  sw?._notifyChange('浅色', '深色')
}, 3600000)
```

### 分组规则

面板采用可折叠选项卡布局：

- **⚡ 工作台** — 内置开关（id 以 `dock-flash:` 开头），按 `group` 字段分为外观 / 布局 / 系统三个子组。集成模式下「布局」子组为空、不渲染 —— 停靠布局属性全部由 dock-base 自己的设置负责。
- **🧩 扩展** — 第三方开关（id 不以 `dock-flash:` 开头），按 id 冒号前缀（即插件名）自动分子组
- **📝 最近修改** — 最近 30 秒内的开关变更记录

判定规则：`id.startsWith('dock-flash:')` 为内置，否则为第三方。第三方开关的 `group` 字段在当前版本中被忽略，统一归入扩展标签页按来源插件分组。

同组内按 `order` 升序排列。

### quickControl 服务 API

| 方法 | 说明 |
| --- | --- |
| `registerSwitch(def)` | 注册开关，返回 dispose 函数 |
| `unregisterSwitch(id)` | 按 id 反注册 |
| `getSwitches()` | 获取所有开关（按 order 升序） |
| `notifyChange(id)` | 通知开关值已变化，触发面板刷新 |
| `recordChange(entry)` | 记录一条变更日志 `{ id, label, icon, oldDisplay, newDisplay }` |
| `getChangelog()` | 获取最近 30 秒内的变更记录 |
| `subscribe(fn)` | 订阅注册表/值变化，返回 dispose 函数 |
| `version` | 当前注册表版本号（每次变更递增） |

---

## 🎨 皮肤系统

皮肤切换器需要 [dsh-market](https://github.com/AKS1st/dsh-market) 插件才能使用 — 没有市场插件时不显示（禁用态皮肤对 DOM 扫描不可见，列表会不完整）。

### 皮肤分类

| 分类 | 说明 | 示例 |
| --- | --- | --- |
| **CSS 皮肤** | 通过 `<style>` / `<link>` 标签 + body 属性激活 | maid-atelier、official-homepage |
| **托管皮肤** | 自带 canvas/WebGL/粒子等生命周期，通过 `mount()` / `unmount()` 切换 | Mineradio |
| **排除项** | 匹配发现规则但从下拉菜单中隐藏（冲突或外部控制不可靠） | bloom-theme、black-hole、theme-manager |

### dsh-market 集成

- 获取已安装/禁用态的完整主题列表（`/dsh-market/installed` API）
- 市场管理的主题通过 `/dsh-market/use-skin` API 激活（会触发页面刷新）
- 市场禁用的主题在下拉菜单中标注「未启用」

### 偏好持久化

皮肤选择保存到 `localStorage`，页面加载后自动恢复。

> 切换机制、排除原因、技术约束等实现细节见 [AGENTS.md](./AGENTS.md)。

---

## 🌐 国际化

面板内置中英文本地化，自动跟随 DSH 语言设置。第三方开关可使用函数式标签（`label: () => t('xxx')`）实现语言切换时动态刷新。

---

## 安装

需要 DSH Web 环境：

```sh
# 安装本插件
dsh plugin --profile my-profile add ./dock-flash

# （可选）安装 dock-base 以获得完整的工作台集成
dsh plugin --profile my-profile add dock-base

# 启动
dsh --profile my-profile
```

**无 dock-base**：dock-flash 以独立模式运行 — ⚡ 触发按钮注入到 `trigger-position` 开关所选中的会话槽位（默认：输入框右侧），点击展开快捷控制浮动面板（外观、布局（触发位置）、系统开关）。共享槽位 `sidebar.footer.action` 有意不提供，因为其他插件也占用它。

**有 dock-base**：dock-flash 集成到工作台 — ⚡图标出现在活动栏，面板可作为侧边栏或浮动窗口打开，包含外观与系统开关。停靠布局属性（停靠边、自动隐藏、保留空间、图标缩放）在 dock-base 自己的设置里配置，不在这里。

## 开发

```sh
pnpm install
pnpm run build      # tsc → dist/index.js
pnpm run typecheck  # 仅类型检查
```

开发规则、关键约束与测试规范见 [AGENTS.md](./AGENTS.md)；各版本的改动内容与原因见 [CHANGELOG.md](./CHANGELOG.md)。

## 样式契约

本插件遵循 DSH Web 样式契约：全部颜色经 `--dsw-alias-*` 设计令牌引用（字面量仅作兜底），无按主题分支的 CSS 选择器。

## 依赖

| 依赖 | 类型 | 说明 |
| --- | --- | --- |
| `dock-base` ^0.1.2 | peer（可选） | 提供 `ctx.workbench` 注册表服务，用于完整工作台集成 |
| `@deepseek-ai/cordis` ^4.0.1 | peer | 插件框架（DSH 自带） |

## 许可证

[Apache License 2.0](./LICENSE)
