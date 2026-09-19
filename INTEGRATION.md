# dock-flash Third-Party Integration Guide

> How to register quick-control switches from your DSH plugin **without a hard dependency** on dock-flash.

---

## Overview

dock-flash exposes a `quickControl` Cordis service — a pub/sub registry that any plugin can use to register switches (toggles, sliders, selects, action buttons, button groups). Registered switches appear in the dock-flash **🧩 Extensions** tab, grouped by source plugin.

**Key principle**: Your plugin must work whether or not dock-flash is installed. Never declare a hard dependency on `quickControl`.

---

## Two Integration Modes

### Mode A — Hard Dependency (NOT recommended)

```js
// ⚠️ Your plugin will NOT load if dock-flash is absent
exports.inject = ['quickControl']
```

Use this **only** if your plugin is meaningless without dock-flash. For most plugins, this is wrong — it breaks the "graceful degradation" principle.

### Mode B — Optional Integration (recommended)

```js
// ✅ Your plugin loads regardless; registers switches only when dock-flash is present
exports.inject = []
```

Your plugin discovers dock-flash at runtime via two mechanisms:

1. **Passive**: Listen for the `dock-flash:ready` event
2. **Active**: Call `ctx.get('quickControl')` to check immediately

---

## The Dual-Discovery Pattern

Because load order between plugins is not guaranteed, use **both** mechanisms together:

```js
exports.inject = []
exports.apply = function (ctx) {
  let registered = false

  function registerMySwitches(registry) {
    if (registered) return
    registered = true

    ctx.effect(() => {
      const dispose = registry.registerSwitch({
        id: 'my-plugin:my-toggle',
        label: '🔔 My Toggle',
        icon: '🔔',
        type: 'toggle',
        order: 100,
        getValue: () => myState,
        setValue: (v) => { myState = v },
      })
      return dispose
    }, 'my-plugin: cleanup')
  }

  // 1. Passive: listen for dock-flash:ready (covers case where we load first)
  const off = ctx.on('dock-flash:ready', registerMySwitches)

  // 2. Active: check if dock-flash already loaded (covers case where it loaded before us)
  const registry = ctx.get('quickControl')
  if (registry) registerMySwitches(registry)

  return off
}
```

### Why both?

| Scenario | Mechanism that catches it |
|---|---|
| dock-flash loads **before** your plugin | Active check (`ctx.get`) |
| dock-flash loads **after** your plugin | Passive listener (`ctx.on`) |
| dock-flash is **not installed** | Neither fires — your plugin runs without switches |

---

## Load-Order Hint (package.json)

Add a load-order hint so that, when dock-flash IS installed, it loads before your plugin:

```json
{
  "dsh": {
    "client": {
      "inject": ["dock-flash"]
    }
  }
}
```

**Important**: Use `"dock-flash"`, NOT `"dock-flash/client"`. The DSH ModuleLoader's `arriveGraphRow()` does NOT strip the `/client` suffix for inject lookups — using `"dock-flash/client"` silently fails.

This hint does NOT create a hard dependency. When dock-flash is absent, the entry is silently skipped and your plugin loads normally.

---

## Switch ID Convention

- Format: `plugin-name:switch-name` (e.g., `dock-git:show-stash`)
- The prefix before `:` determines grouping in the Extensions tab
- Built-in dock-flash switches use `dock-flash:*` and appear in the ⚡ Workbench tab
- Your switches use `your-plugin:*` and appear in the 🧩 Extensions tab

---

## Switch Types

| Type | Required Fields | Description |
|---|---|---|
| `toggle` | `getValue()`, `setValue(boolean)` | Boolean on/off switch |
| `slider` | `getValue()`, `setValue(number)`, `min`, `max`, `step` | Numeric slider |
| `select` | `getValue()`, `setValue(any)`, `options` | Dropdown select |
| `buttongroup` | `getValue()`, `setValue(any)`, `options` | Button group |
| `action` | `run()` | Action button |

### Full Switch Definition

```js
registry.registerSwitch({
  id: 'my-plugin:my-switch',       // Required. Format: plugin:switch-name
  label: 'My Switch',              // Required. Use () => t('key') for i18n
  icon: '🔔',                      // Optional. Emoji shown beside label
  type: 'toggle',                  // Required. One of: toggle, slider, select, buttongroup, action
  order: 100,                      // Optional. Sort order (built-in uses 10–60; start at 100)
  group: 'appearance',             // Optional. Only meaningful for built-in; ignored for third-party

  // Common
  getValue: () => myState,         // Required for toggle/slider/select/buttongroup
  setValue: (v) => { myState = v }, // Required for toggle/slider/select/buttongroup
  formatLabel: (v) => `${v}%`,     // Optional. Display formatting for current value

  // Slider-specific
  min: 0, max: 100, step: 5,      // Required for slider type

  // Select / ButtonGroup-specific
  options: [                        // Required for select/buttongroup types
    { label: 'Option A', value: 'a' },
    { label: 'Option B', value: 'b' },
  ],

  // Action-specific
  run: () => { /* do something */ }, // Required for action type
  actionLabel: 'Run',               // Optional. Custom button label
})
```

---

## Cleanup

Always wrap `registerSwitch()` in `ctx.effect()` for automatic cleanup on plugin unload / HMR:

```js
ctx.effect(() => {
  const dispose = registry.registerSwitch({ /* ... */ })
  return dispose   // ctx.effect() calls this when the plugin unloads
}, 'my-plugin: cleanup label')
```

If you register switches inside an event listener, either:
- Use `ctx.effect()` inside the listener (as shown in the dual-discovery pattern), or
- Return a disposer from the listener that removes the event listener and unregisters switches

---

## setValue Rules

**`setValue()` should only update state** — the panel handles UI refresh and changelog recording automatically.

```js
// ✅ Correct — pure state setter
setValue: (v) => { myState = v }

// ❌ Wrong — causes duplicate changelog entries
setValue: (v) => { myState = v; sw._notifyChange?.('old', 'new') }
```

Use `_notifyChange()` only for **proactive** state changes (timers, server push, etc.) — never for user-initiated changes.

---

## i18n Labels

Use a function for `label` to support real-time language switching:

```js
label: () => document.documentElement.lang === 'zh' ? '我的开关' : 'My Switch'
```

Static string labels won't update when the user changes the UI language.

---

## Standalone Mode

When dock-base is not installed, dock-flash runs in **standalone mode** — a floating ⚡ button with a popup panel. Third-party switches appear in the Extensions tab just like in workbench mode. No changes are needed in your integration code.

---

## TypeScript Support

Install the type-only package for compile-time safety (zero runtime cost):

```sh
pnpm add -D dock-flash-qc-types
```

```ts
import type { QuickControlRegistry, QuickSwitchDefinition } from 'dock-flash-qc-types'
```

For `ctx.get()` type augmentation:

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

## Complete Example

```js
// my-plugin/lib/client.js
window.__ModuleLoader__.load({
  id: "my-plugin",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    exports.inject = []  // No hard dependency!

    exports.apply = function (ctx) {
      console.log('[my-plugin] client half loaded')

      // ── Plugin state ──
      var notificationsEnabled = true
      var refreshInterval = 30

      // ── Register switches when dock-flash is available ──
      var registered = false

      function registerSwitches(registry) {
        if (registered) return
        registered = true

        // Toggle switch
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

        // Slider switch
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

        console.log('[my-plugin] registered 2 switches in dock-flash ✓')
      }

      // Dual-discovery: passive (event) + active (ctx.get)
      var off = ctx.on('dock-flash:ready', registerSwitches)
      var registry = ctx.get('quickControl')
      if (registry) registerSwitches(registry)

      return off
    }

    return module.exports
  },
})
```

Corresponding `package.json`:

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

## Event Reference

| Event | Payload | When |
|---|---|---|
| `dock-flash:ready` | `QuickControlRegistry` | Fired once after dock-flash creates and publishes the `quickControl` service |

---

## Migration from Hard Dependency

If your plugin currently uses `exports.inject = ['quickControl']`:

1. Change `exports.inject = []`
2. Add the dual-discovery pattern (passive listener + active check)
3. Add `"dock-flash"` to `dsh.client.inject` in `package.json`
4. Test with dock-flash both present and absent

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Switch doesn't appear | `ctx.get('quickControl')` returns `undefined` | Use dual-discovery pattern (event + active check) |
| Switch appears twice | `registered` guard missing | Add `if (registered) return` at the top of your registration function |
| Duplicate changelog entries | `setValue()` calls `_notifyChange()` | Remove `_notifyChange()` from `setValue()` — panel handles it |
| Switch not removed on plugin reload | Not using `ctx.effect()` | Wrap `registerSwitch()` in `ctx.effect()` and return the disposer |
| Load-order hint ignored | Using `"dock-flash/client"` in `dsh.client.inject` | Use `"dock-flash"` (base package name) |
