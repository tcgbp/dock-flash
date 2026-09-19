# dock-flash 第三方集成指南

> 如何从你的 DSH 插件注册快捷控制开关，**无需对 dock-flash 强依赖**。

---

## 概述

dock-flash 通过 `quickControl` Cordis 服务暴露了一个发布/订阅注册表——任何插件都可以用它来注册开关（切换、滑块、下拉选择、动作按钮、按钮组）。注册的开关会出现在 dock-flash 的 **🧩 扩展** 标签页中，按来源插件分组。

**核心原则**：你的插件无论 dock-flash 是否安装都必须能正常工作。永远不要对 `quickControl` 声明硬依赖。

---

## 两种集成模式

### 模式 A — 硬依赖（不推荐）

```js
// ⚠️ 如果 dock-flash 不存在，你的插件将无法加载
exports.inject = ['quickControl']
```

仅在你的插件离开 dock-flash 就完全没意义时使用。对大多数插件来说这是错误的做法——它违背了"优雅降级"原则。

### 模式 B — 可选集成（推荐）

```js
// ✅ 你的插件始终加载；仅在 dock-flash 存在时注册开关
exports.inject = []
```

你的插件通过两种机制在运行时发现 dock-flash：

1. **被动方式**：监听 `dock-flash:ready` 事件
2. **主动方式**：调用 `ctx.get('quickControl')` 立即检查

---

## 双重发现模式

由于插件之间的加载顺序不保证，需要**同时使用**两种机制：

```js
exports.inject = []
exports.apply = function (ctx) {
  var registered = false

  function registerMySwitches(registry) {
    if (registered) return
    registered = true

    ctx.effect(() => {
      var dispose = registry.registerSwitch({
        id: 'my-plugin:my-toggle',
        label: '🔔 我的开关',
        icon: '🔔',
        type: 'toggle',
        order: 100,
        getValue: () => myState,
        setValue: (v) => { myState = v },
      })
      return dispose
    }, 'my-plugin: cleanup')
  }

  // 1. 被动：监听 dock-flash:ready 事件（覆盖我们先加载的情况）
  var off = ctx.on('dock-flash:ready', registerMySwitches)

  // 2. 主动：检查 dock-flash 是否已经加载（覆盖它先加载的情况）
  var registry = ctx.get('quickControl')
  if (registry) registerMySwitches(registry)

  return off
}
```

### 为什么两者都需要？

| 场景 | 捕获机制 |
|---|---|
| dock-flash 在你的插件**之前**加载 | 主动检查（`ctx.get`） |
| dock-flash 在你的插件**之后**加载 | 被动监听（`ctx.on`） |
| dock-flash **未安装** | 两者都不触发——你的插件正常运行，只是没有开关 |

---

## 加载顺序提示（package.json）

添加加载顺序提示，使得 dock-flash 存在时能在你的插件之前加载：

```json
{
  "dsh": {
    "client": {
      "inject": ["dock-flash"]
    }
  }
}
```

**重要**：使用 `"dock-flash"`，而不是 `"dock-flash/client"`。DSH ModuleLoader 的 `arriveGraphRow()` 在查找 inject 条目时不会去掉 `/client` 后缀——使用 `"dock-flash/client"` 会静默失败。

此提示不会创建硬依赖。当 dock-flash 不存在时，该条目会被静默跳过，你的插件正常加载。

---

## 开关 ID 约定

- 格式：`plugin-name:switch-name`（例如 `dock-git:show-stash`）
- `:` 前的前缀决定了在扩展标签页中的分组
- dock-flash 内置开关使用 `dock-flash:*` 前缀，出现在 ⚡ 工作台 标签页
- 你的开关使用 `your-plugin:*` 前缀，出现在 🧩 扩展 标签页

---

## 开关类型

| 类型 | 必填字段 | 说明 |
|---|---|---|
| `toggle` | `getValue()`, `setValue(boolean)` | 布尔开关 |
| `slider` | `getValue()`, `setValue(number)`, `min`, `max`, `step` | 数值滑块 |
| `select` | `getValue()`, `setValue(any)`, `options` | 下拉选择 |
| `buttongroup` | `getValue()`, `setValue(any)`, `options` | 按钮组 |
| `action` | `run()` | 动作按钮 |

### 完整开关定义

```js
registry.registerSwitch({
  id: 'my-plugin:my-switch',       // 必填。格式：plugin:switch-name
  label: '我的开关',                // 必填。使用 () => t('key') 支持 i18n
  icon: '🔔',                      // 可选。标签旁的 emoji 图标
  type: 'toggle',                  // 必填。可选：toggle, slider, select, buttongroup, action
  order: 100,                      // 可选。排序（内置使用 10–60；第三方从 100 开始）
  group: 'appearance',             // 可选。仅对内置有意义；第三方忽略

  // 通用字段
  getValue: () => myState,         // toggle/slider/select/buttongroup 必填
  setValue: (v) => { myState = v }, // toggle/slider/select/buttongroup 必填
  formatLabel: (v) => `${v}%`,     // 可选。当前值的显示格式化

  // 滑块特有
  min: 0, max: 100, step: 5,      // slider 类型必填

  // 下拉选择 / 按钮组特有
  options: [                        // select/buttongroup 类型必填
    { label: '选项 A', value: 'a' },
    { label: '选项 B', value: 'b' },
  ],

  // 动作特有
  run: () => { /* 执行操作 */ },    // action 类型必填
  actionLabel: '执行',              // 可选。自定义按钮标签
})
```

---

## 清理

始终将 `registerSwitch()` 包裹在 `ctx.effect()` 中，以确保在插件卸载/HMR 时自动清理：

```js
ctx.effect(() => {
  var dispose = registry.registerSwitch({ /* ... */ })
  return dispose   // ctx.effect() 在插件卸载时调用此函数
}, 'my-plugin: cleanup label')
```

如果你在事件监听器中注册开关，要么：
- 在监听器内部使用 `ctx.effect()`（如双重发现模式所示），或
- 从监听器返回一个清理函数来移除事件监听器并注销开关

---

## setValue 规则

**`setValue()` 应该只更新状态**——面板会自动处理 UI 刷新和变更日志记录。

```js
// ✅ 正确 — 纯状态设置
setValue: (v) => { myState = v }

// ❌ 错误 — 导致重复的变更日志条目
setValue: (v) => { myState = v; sw._notifyChange?.('old', 'new') }
```

`_notifyChange()` 仅用于**主动**状态变更（定时器、服务端推送等）——绝不能用于用户发起的变更。

---

## 国际化标签

使用函数形式的 `label` 以支持实时语言切换：

```js
label: () => document.documentElement.lang === 'zh' ? '我的开关' : 'My Switch'
```

静态字符串标签在用户切换 UI 语言时不会更新。

---

## 独立模式

当 dock-base 未安装时，dock-flash 以**独立模式**运行——一个浮动的 ⚡ 按钮和弹出面板。第三方开关同样会出现在扩展标签页中，与工作台模式完全一致。你的集成代码无需任何更改。

---

## TypeScript 支持

安装纯类型包以获得编译时类型安全（零运行时成本）：

```sh
pnpm add -D dock-flash-qc-types
```

```ts
import type { QuickControlRegistry, QuickSwitchDefinition } from 'dock-flash-qc-types'
```

为 `ctx.get()` 添加类型增强：

```ts
// types/quickcontrol.d.ts
import type { QuickControlRegistry } from 'dock-flash-qc-types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    get<T = unknown>(name: 'quickControl'): QuickControlRegistry | undefined
  }
}
```

---

## 完整示例

```js
// my-plugin/lib/client.js
window.__ModuleLoader__.load({
  id: "my-plugin",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    exports.inject = []  // 无硬依赖！

    exports.apply = function (ctx) {
      console.log('[my-plugin] client half loaded')

      // ── 插件状态 ──
      var notificationsEnabled = true
      var refreshInterval = 30

      // ── dock-flash 可用时注册开关 ──
      var registered = false

      function registerSwitches(registry) {
        if (registered) return
        registered = true

        // 切换开关
        ctx.effect(() => {
          var dispose = registry.registerSwitch({
            id: 'my-plugin:notifications',
            label: () => document.documentElement.lang === 'zh' ? '🔔 通知' : '🔔 Notifications',
            icon: '🔔',
            type: 'toggle',
            order: 100,
            getValue: () => notificationsEnabled,
            setValue: (v) => { notificationsEnabled = v },
          })
          return dispose
        }, 'my-plugin: notifications toggle')

        // 滑块开关
        ctx.effect(() => {
          var dispose = registry.registerSwitch({
            id: 'my-plugin:refresh-interval',
            label: () => document.documentElement.lang === 'zh' ? '🔄 刷新间隔' : '🔄 Refresh Interval',
            icon: '🔄',
            type: 'slider',
            order: 110,
            min: 5,
            max: 120,
            step: 5,
            getValue: () => refreshInterval,
            setValue: (v) => { refreshInterval = v },
            formatLabel: function (v) { return v + 's' },
          })
          return dispose
        }, 'my-plugin: refresh slider')

        console.log('[my-plugin] 在 dock-flash 中注册了 2 个开关 ✓')
      }

      // 双重发现：被动（事件）+ 主动（ctx.get）
      var off = ctx.on('dock-flash:ready', registerSwitches)
      var registry = ctx.get('quickControl')
      if (registry) registerSwitches(registry)

      return off
    }

    return module.exports
  },
})
```

对应的 `package.json`：

```json
{
  "name": "my-plugin",
  "dsh": {
    "client": {
      "inject": ["dock-flash"]
    }
  }
}
```

---

## 事件参考

| 事件 | 载荷 | 触发时机 |
|---|---|---|
| `dock-flash:ready` | `QuickControlRegistry` | dock-flash 创建并发布 `quickControl` 服务后触发一次 |

---

## 从硬依赖迁移

如果你的插件当前使用 `exports.inject = ['quickControl']`：

1. 将 `exports.inject` 改为 `[]`
2. 添加双重发现模式（被动监听 + 主动检查）
3. 在 `package.json` 的 `dsh.client.inject` 中添加 `"dock-flash"`
4. 测试 dock-flash 存在和不存在两种情况

---

## 故障排除

| 症状 | 原因 | 修复 |
|---|---|---|
| 开关未出现 | `ctx.get('quickControl')` 返回 `undefined` | 使用双重发现模式（事件 + 主动检查） |
| 开关出现两次 | 缺少 `registered` 守卫 | 在注册函数顶部添加 `if (registered) return` |
| 重复的变更日志条目 | `setValue()` 调用了 `_notifyChange()` | 从 `setValue()` 中移除 `_notifyChange()`——面板会自动处理 |
| 插件重载后开关未移除 | 未使用 `ctx.effect()` | 将 `registerSwitch()` 包裹在 `ctx.effect()` 中并返回清理函数 |
| 加载顺序提示无效 | `dsh.client.inject` 使用了 `"dock-flash/client"` | 使用 `"dock-flash"`（基础包名） |
