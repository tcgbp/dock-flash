// `pnpm run check:adapter` — proves the dock-base ADAPTER half mounts.
//
// WHY THIS EXISTS, and not another checklist item: the core/adapter split
// (`docs/refactor-plan-core-adapter-split.md`) created a failure mode that has no
// runtime symptom. The adapter is a SEPARATE plugin now, and it consumes the panel
// through a cordis service (`dockFlashPanel`) that the `dsh-flash` core publishes.
// When that service never arrives — the core's host row composed but its client half
// never loaded — `apply()` used to do nothing observable: the page looked exactly like
// "dock-flash is not installed", the panel was simply absent, and no error was thrown.
// A silent no-op is indistinguishable from a configuration choice, and the plan's §2
// correction 2 is that this state must be LOUD. So this harness evaluates the REAL
// `lib/client.js` in a `node:vm` sandbox and asserts the observable behaviour of the
// mount, its loud failure, and its release path — no browser, no reload, no reading.
//
// Point DOCK_FLASH_BUNDLE at another copy to watch it fail; the release-path check
// (section 4) is the one that catches the two-mount regression where a per-mount
// disposer called the whole-host `release()`.
import fs from 'node:fs'
import vm from 'node:vm'

// ── check helper — same output contract as scripts/check-overlay-mount.mjs ──
const failures = []
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail === undefined ? '' : '  → ' + detail))
  if (!ok) failures.push(name)
}
function section(title) { console.log('\n' + title) }

const BUNDLE = process.env.DOCK_FLASH_BUNDLE || new URL('../lib/client.js', import.meta.url)
const source = fs.readFileSync(BUNDLE, 'utf8')
// Comments stripped once, up front: several sections grep the CODE, and the
// explanatory prose in lib/client.js legitimately names the things the code is
// forbidden to do.
const codeOnly = source.replace(/^\s*\/\/.*$/gm, '')

// The manifest's inject list drives arriveGraphRow load order. The adapter reads
// its strings from `panel.i18n`, which is the CORE's proxy over the official
// @deepseek-ai/dsh-client-locale runtime — so the locale row arriving early still
// decides the language of the very first paint of adapter-owned chrome, and the
// name stays here (as a BASE name, per AGENTS.md) to record that ordering.
// It is a load-order hint only: the adapter resolves NOTHING off the `locale`
// service itself, and must not start doing so — the core already claims the
// `dock-flash` namespace, and `LocaleRuntime.register()` refuses a repeat locale.
// See section 9.
const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const injectedNames = manifest.dsh?.client?.inject || []

// ── sandbox pieces ──────────────────────────────────────────────────────────
const fakeReact = {
  createElement(type, props, ...children) { return { type, props, children } },
}
const requireStub = (spec) => {
  if (spec === 'react') return fakeReact
  throw new Error('unexpected require: ' + spec)
}

function makeConsole() {
  const lines = { log: [], warn: [], error: [] }
  const make = (level) => (...args) => {
    const line = args.map((a) => String(a)).join(' ')
    lines[level].push(line)
    console.log('      [' + level + '] ' + line)
  }
  return { consoleStub: { log: make('log'), warn: make('warn'), error: make('error') }, lines }
}

// Timers are captured, never run: the adapter arms a 2000 ms watchdog for a core
// that never arrives, and a real timer would fire after this process exits.
function makeTimers() {
  const timers = []
  let nextId = 1
  return {
    timers,
    setTimeoutStub(fn, ms) { const id = nextId++; timers.push({ id, fn, ms, cleared: false }); return id },
    clearTimeoutStub(id) { const t = timers.find((x) => x.id === id); if (t) t.cleared = true },
    fire(ms) {
      // No throw when the timer is absent: the check above already records that
      // the watchdog was never armed. Throwing here would abort the run and hide
      // every later section, which is the failure mode this file must not have.
      const t = timers.find((x) => x.ms === ms)
      if (!t) return false
      t.fn()
      return true
    },
  }
}

// The fake cordis ctx. `effect` CALLS fn() immediately and keeps its return value as
// the cleanup without running it — which is exactly how the real bundle expects to be
// driven (its own comment: the harness's effect stub returns the cleanup without
// invoking it), and it is how section 4 tears the mount down by hand.
//
// The ctx is a PROXY, and that is load-bearing. A real cordis context is a Proxy
// whose get trap (cordis 4.0.4, ReflectService.handler) THROWS
// `cannot get property "x" without inject` for any service the plugin did not
// declare in its `inject` array — MEASURED, see section 10. A plain object stub
// silently returns `undefined` for those reads, so it structurally cannot express
// the defect that made the adapter vanish: `typeof ctx.locale` is not a safe
// existence check, `typeof` evaluates the getter and the throw escapes. Anything
// the adapter may read is either a framework member below or a name it declared.
function makeCtx(services, inject = []) {
  const gets = []
  const injections = []
  const effects = []
  const events = []
  const base = {
    get(name) { gets.push(name); return services[name] },
    inject(deps, cb) {
      const rec = { deps, cb, invoked: false }
      injections.push(rec)
      return { dispose() { rec.disposed = true } }
    },
    effect(fn, label) {
      const rec = { label, cleanup: fn() }
      effects.push(rec)
      return rec.cleanup
    },
    on(event, fn) { events.push({ event, fn }); return () => {} },
    provide() {},
  }
  const declared = new Set(inject)
  const ctx = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop in target) return target[prop]
      if (declared.has(prop)) return services[prop]
      throw new Error(`cannot get property "${prop}" without inject`)
    },
    has(target, prop) {
      if (typeof prop === 'symbol' || prop in target) return true
      return declared.has(prop)
    },
  })
  return { ctx, gets, injections, effects, events }
}

// A faithful stub of the OFFICIAL @deepseek-ai/dsh-client-locale LocaleRuntime,
// reachable as the `locale` SERVICE (via ctx.get('locale') — never as a ctx
// property, see section 10). The adapter must NOT touch it: it translates
// through the core's `panel.i18n`, which proxies this same service. The stub
// exists so that is provable rather than merely intended — a boot with the
// service present must leave `registrations` empty.
//
// It is deliberately as hostile as the real runtime. `register()` REFUSES a
// locale that namespace already has, and `dock-flash` arrives PRE-CLAIMED
// because in production the CORE claims it, on its own plugin fiber, before the
// adapter ever runs. So a regression that re-adds a registration throws here
// with the production message instead of quietly succeeding against a stub too
// polite to refuse.
function makeLocale() {
  const registrations = []
  const claimed = new Map([['dock-flash', { zh: { title: '快捷控制' }, en: { title: 'Quick Control' } }]])
  const port = {
    register(ns, dicts) {
      if (claimed.has(ns)) {
        throw new Error(`locale namespace "${ns}" already has locale "zh"`)
      }
      claimed.set(ns, dicts)
      registrations.push({ ns, dicts })
      return () => { port._disposed = true }
    },
    bind(ns) {
      port._boundNs = ns
      return (key) => 'T:' + key
    },
    getSnapshot: () => ({ active: 'en', locales: [], revision: 0 }),
    _disposed: false,
    _boundNs: undefined,
  }
  return { locale: port, registrations }
}

// The `dockFlashPanel` service, built to the exact shape lib/client.js consumes.
function makePanel() {
  const hostCalls = []
  const i18nListeners = []
  // The core's `t` is a translator plus the frozen `getLocale` / `setLocale` /
  // `onLocaleChange` surface. It is modelled as REACTIVE on purpose: the adapter's
  // sidebar-title patch is only meaningful if a locale switch actually notifies it,
  // so `setLocale` must notify the very listeners `onLocaleChange` registered.
  let locale = 'en'
  const t = (k) => t.prefix + k
  t.prefix = 'T:'
  t.getLocale = () => locale
  t.setLocale = (key) => {
    if (key !== 'zh' && key !== 'en') return
    if (key === locale) return
    locale = key
    i18nListeners.slice().forEach((fn) => { try { fn() } catch (_) {} })
  }
  t.onLocaleChange = (cb) => {
    i18nListeners.push(cb)
    return () => { const i = i18nListeners.indexOf(cb); if (i >= 0) i18nListeners.splice(i, 1) }
  }
  const panel = {
    version: 1,
    Panel: function Panel() {},
    ErrorBoundary: function ErrorBoundary() {},
    Header: function Header() {},
    icon: 'ICON',
    registry: {},
    i18n: {
      // Fidelity matters here. The core's `L(key)` returns a DEFERRED getter
      // (`() => t(key)`), because dock-base's registerPanel /
      // registerActivityBarItem / registerEditorView take `() => string` for live
      // i18n. A stub returning a plain string would let a bundle that hands the
      // registration a bare string pass — and that renders BLANK on the plugin
      // card, the exact defect AGENTS.md records for `registerPlugin`.
      t,
      L: (k) => () => t(k),
    },
    host: {
      // `claim()` returns a lease with confirm()/release(), so the adapter's
      // `lease.confirm()` path is exercised rather than skipped.
      claim() {
        hostCalls.push('claim')
        return {
          confirm() { hostCalls.push('lease.confirm') },
          release() { hostCalls.push('lease.release') },
        }
      },
      releaseOne() { hostCalls.push('releaseOne') },
      release() { hostCalls.push('release') },
      isClaimed() { return false },
    },
  }
  return { panel, hostCalls, i18nListeners }
}

// The `workbench` service: every method lib/client.js calls, each recording its
// arguments; each register* returns a disposer.
function makeWb() {
  const calls = []
  let hidden = []
  let settingCb = null
  // The active pane the adapter's title patch checks before it dares to write.
  // Null by default, so every existing scenario keeps walking the same early
  // return it always did; section 9 turns it on to drive the patch.
  let activePane = null
  const rec = (name, arg) => { calls.push({ name, arg }); return () => {} }
  const wb = {
    registerPanel: (a) => rec('registerPanel', a),
    registerPlugin: (a) => rec('registerPlugin', a),
    registerActivityBarItem: (a) => rec('registerActivityBarItem', a),
    registerEditorView: (a) => rec('registerEditorView', a),
    registerCommand: (a) => rec('registerCommand', a),
    openView: (...a) => { calls.push({ name: 'openView', args: a }) },
    closeViewInstance: (...a) => { calls.push({ name: 'closeViewInstance', args: a }) },
    getLayout: () => { calls.push({ name: 'getLayout' }); return { activity: activePane, floatingWindows: {}, editorTabs: [] } },
    getActivityItem: (id) => { calls.push({ name: 'getActivityItem', arg: id }); return activePane ? { id, paneId: activePane } : null },
    getHiddenPluginIds: () => { calls.push({ name: 'getHiddenPluginIds' }); return hidden },
    onDidChangeSetting: (cb) => { settingCb = cb; calls.push({ name: 'onDidChangeSetting' }); return () => {} },
  }
  return {
    wb, calls,
    callsOf: (n) => calls.filter((c) => c.name === n),
    setHidden: (h) => { hidden = h },
    setActivePane: (p) => { activePane = p },
    // Returns false rather than throwing when the mount never subscribed: a
    // broken bundle must produce FAILs, not a crash that truncates the run.
    fireSetting: () => { if (!settingCb) return false; settingCb(); return true },
  }
}

// ── one full sandbox + one apply-ready module ───────────────────────────────
function scenario(opts = {}) {
  const { consoleStub, lines } = makeConsole()
  const timers = makeTimers()
  const { panel, hostCalls, i18nListeners } = makePanel()
  if (opts.panelVersion !== undefined) panel.version = opts.panelVersion
  const wbH = makeWb()

  const services = {}
  if (opts.workbench) services.workbench = wbH.wb
  if (opts.graphRows) services.modules = { graphRows: opts.graphRows }
  const localeH = opts.locale ? makeLocale() : null
  if (opts.locale) services.locale = localeH.locale
  const { ctx, gets, injections, effects, events } = makeCtx(services)

  const captured = {}
  const fakeEl = { style: {}, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {} }
  const windowObj = {
    __ModuleLoader__: { load(o) { captured.opts = o } },
    __DSH_BOOT__: opts.boot !== undefined ? opts.boot : { entries: [] },
    addEventListener() {}, removeEventListener() {},
  }
  // The sidebar title element is answered for, rather than left null, so the
  // adapter's locale-change patch has a real target and its write can be
  // ASSERTED. Every other selector stays null, which is what the other scenarios
  // (and the production boot this models) expect.
  const titleEl = { textContent: '' }
  const documentStub = {
    querySelector: (sel) => (sel === '.dsh-wb-sidebar-title' ? titleEl : null),
    createElement: () => fakeEl,
    createElementNS: () => fakeEl,
    head: fakeEl, body: fakeEl, documentElement: fakeEl,
    addEventListener() {}, removeEventListener() {},
  }
  const sandbox = {
    window: windowObj,
    document: documentStub,
    console: consoleStub,
    setTimeout: timers.setTimeoutStub,
    clearTimeout: timers.clearTimeoutStub,
  }
  sandbox.globalThis = sandbox
  vm.runInContext(source, vm.createContext(sandbox), { filename: 'lib/client.js' })
  const mod = captured.opts.factory(requireStub)

  return {
    captured, mod, ctx, gets, injections, effects, events, panel, hostCalls, i18nListeners,
    wb: wbH.wb, wbCalls: wbH.calls, callsOf: wbH.callsOf, setHidden: wbH.setHidden,
    setActivePane: wbH.setActivePane,
    fireSetting: wbH.fireSetting, timers, lines, windowObj, documentStub, titleEl,
    locale: localeH && localeH.locale, localeRegistrations: localeH && localeH.registrations,
  }
}

const count = (arr, v) => arr.filter((x) => x === v).length
const depsEq = (deps, want) => JSON.stringify(deps) === JSON.stringify(want)
const anyLine = (lines, re) => lines.some((l) => re.test(l))
// The FIRST recorded argument of a wb.register* call, or undefined. Never index
// `[0].arg` directly: when the mount is broken that throws a TypeError halfway
// through this file, which skips every later section AND the summary — so a
// bundle that mounts nothing at all produced a truncated, exit-code-1 run with
// no FAIL line naming the cause. A harness must degrade to FAILs, not to a crash.
const firstArg = (h, n) => { const c = h.callsOf(n)[0]; return c ? c.arg : undefined }
// Deref guard for the assertions below: `undefined.id` would crash for the same
// reason the missing registration would.
const prop = (o, k) => (o ? o[k] : undefined)
// Invoke a recorded ctx.inject callback by dependency list, tolerating its
// absence. Same reasoning as firstArg: a bundle that never subscribes must
// produce FAILs downstream, not a TypeError that truncates the run.
const fire = (h, deps, payload) => {
  const rec = h.injections.find((i) => depsEq(i.deps, deps))
  if (!rec) { h.missedInject = (h.missedInject || []).concat([JSON.stringify(deps)]); return false }
  rec.invoked = true
  rec.cb(payload)
  return true
}

// ═══════════════════════════════════════════════════════════════════════════
section('1. Module entry shape')
const h1 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true })
check("captured id is 'dock-flash'", h1.captured.opts.id === 'dock-flash', h1.captured.opts.id)
check("factory return has name === 'dock-flash'", h1.mod.name === 'dock-flash', h1.mod.name)
check('factory return has inject as an array', Array.isArray(h1.mod.inject))

// ═══════════════════════════════════════════════════════════════════════════
section('2. Service absent — the loud failure (the split\'s silent no-op)')
const h2 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true })
let threw2 = null
try { h2.mod.apply(h2.ctx) } catch (e) { threw2 = e }
check('apply() does not throw when the dockFlashPanel service never arrives', !threw2, threw2 && threw2.message)
check("ctx.inject was called with deps exactly ['dockFlashPanel']",
  h2.injections.length === 1 && depsEq(h2.injections[0].deps, ['dockFlashPanel']),
  JSON.stringify(h2.injections.map((i) => i.deps)))
check('the watchdog timer was armed with delay exactly 2000',
  h2.timers.timers.length === 1 && h2.timers.timers[0].ms === 2000,
  JSON.stringify(h2.timers.timers.map((t) => t.ms)))
h2.timers.fire(2000)
check('firing the watchdog emits console.error naming dockFlashPanel',
  anyLine(h2.lines.error, /dockFlashPanel/), JSON.stringify(h2.lines.error))
check('firing the watchdog emits console.error naming dsh-flash',
  anyLine(h2.lines.error, /dsh-flash/))

// ═══════════════════════════════════════════════════════════════════════════
section('3. Happy path — workbench present, panel service arrives')
const h3 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true })
let threw3 = null
try { h3.mod.apply(h3.ctx) } catch (e) { threw3 = e }
check('apply() does not throw', !threw3, threw3 && threw3.message)
const inj3 = h3.injections[0]
check("ctx.inject was called with deps exactly ['dockFlashPanel']",
  !!inj3 && depsEq(inj3.deps, ['dockFlashPanel']), inj3 && JSON.stringify(inj3.deps))
fire(h3, ['dockFlashPanel'], { dockFlashPanel: h3.panel })
check('panel.host.claim called exactly once', count(h3.hostCalls, 'claim') === 1, JSON.stringify(h3.hostCalls))
check('the returned lease\'s confirm called exactly once', count(h3.hostCalls, 'lease.confirm') === 1)
check('registerPanel called exactly once', h3.callsOf('registerPanel').length === 1)
check('registerPlugin called exactly once', h3.callsOf('registerPlugin').length === 1)
check('registerActivityBarItem called exactly once', h3.callsOf('registerActivityBarItem').length === 1)
check('registerEditorView called exactly once', h3.callsOf('registerEditorView').length === 1)
check('registerCommand called exactly once', h3.callsOf('registerCommand').length === 1)

const rp = firstArg(h3, 'registerPanel')
const rg = firstArg(h3, 'registerPlugin')
const ab = firstArg(h3, 'registerActivityBarItem')
const ev = firstArg(h3, 'registerEditorView')
const cm = firstArg(h3, 'registerCommand')
check("registerPanel id is 'dock-flash:quick-control'", prop(rp, 'id') === 'dock-flash:quick-control', prop(rp, 'id'))
check('registerPanel region is sideBar', prop(rp, 'region') === 'sideBar', prop(rp, 'region'))
check('registerPanel component and headerComponent are both functions',
  typeof prop(rp, 'component') === 'function' && typeof prop(rp, 'headerComponent') === 'function',
  typeof prop(rp, 'component') + '/' + typeof prop(rp, 'headerComponent'))
check("registerPlugin id is 'dock-flash'", prop(rg, 'id') === 'dock-flash', prop(rg, 'id'))
check("registerActivityBarItem id is 'dock-flash:quick-control'", prop(ab, 'id') === 'dock-flash:quick-control', prop(ab, 'id'))
check("registerEditorView id is 'dock-flash:quick-control'", prop(ev, 'id') === 'dock-flash:quick-control', prop(ev, 'id'))
check("registerCommand id is 'dock-flash:openQuickControl'", prop(cm, 'id') === 'dock-flash:openQuickControl', prop(cm, 'id'))

// ═══════════════════════════════════════════════════════════════════════════
section('4. Teardown uses releaseOne, NOT release (two-mount regression)')
const eff4 = h3.effects.find((e) => e.label === 'dock-flash: dock adapter mount')
check("effect 'dock-flash: dock adapter mount' exists and carries the mount disposer", !!eff4)
if (eff4) {
  const before = h3.hostCalls.length
  eff4.cleanup()
  const after = h3.hostCalls.slice(before)
  check('per-mount disposer calls host.releaseOne exactly once (NOT a whole-host release)',
    count(after, 'releaseOne') === 1, JSON.stringify(after))
  check('per-mount disposer calls host.release ZERO times (it would pull the panel from a second mount)',
    count(after, 'release') === 0, JSON.stringify(after))
}

// ═══════════════════════════════════════════════════════════════════════════
section('5. dock-base absent')
const h5 = scenario({ boot: { entries: [] }, workbench: false })
let threw5 = null
try { h5.mod.apply(h5.ctx) } catch (e) { threw5 = e }
fire(h5, ['dockFlashPanel'], { dockFlashPanel: h5.panel })
check('apply() does not throw', !threw5, threw5 && threw5.message)
check('panel.host.claim is NOT called', count(h5.hostCalls, 'claim') === 0, JSON.stringify(h5.hostCalls))
check('a console.warn mentions dock-base', anyLine(h5.lines.warn, /dock-base/), JSON.stringify(h5.lines.warn))

// ═══════════════════════════════════════════════════════════════════════════
section('6. Workbench late — dock-base installed but its service not yet here')
const h6 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: false })
h6.mod.apply(h6.ctx)
fire(h6, ['dockFlashPanel'], { dockFlashPanel: h6.panel })
check('a console.log mentions waiting for the workbench service',
  anyLine(h6.lines.log, /waiting for the workbench/i), JSON.stringify(h6.lines.log))
const injWb = h6.injections.find((i) => depsEq(i.deps, ['workbench']))
check("ctx.inject was called with deps exactly ['workbench']", !!injWb,
  JSON.stringify(h6.injections.map((i) => i.deps)))
fire(h6, ['workbench'], { workbench: h6.wb })
check('workbench arrival performs the same registrations as the happy path',
  ['registerPanel', 'registerPlugin', 'registerActivityBarItem', 'registerEditorView', 'registerCommand']
    .every((n) => h6.callsOf(n).length === 1),
  JSON.stringify(['registerPanel', 'registerPlugin', 'registerActivityBarItem', 'registerEditorView', 'registerCommand'].map((n) => n + ':' + h6.callsOf(n).length)))
check('workbench arrival also claims the panel exactly once', count(h6.hostCalls, 'claim') === 1)

// The manifest fallback: boot entries say nothing, but the module graph does.
const h6b = scenario({ boot: { entries: [] }, graphRows: new Map([['dock-base', {}]]), workbench: false })
h6b.mod.apply(h6b.ctx)
fire(h6b, ['dockFlashPanel'], { dockFlashPanel: h6b.panel })
check('the ctx.get("modules").graphRows fallback also detects dock-base',
  h6b.injections.some((i) => depsEq(i.deps, ['workbench'])),
  JSON.stringify(h6b.injections.map((i) => i.deps)))

// ═══════════════════════════════════════════════════════════════════════════
section('7. Version mismatch — panel speaks 2, adapter speaks 1')
const h7 = scenario({ panelVersion: 2, boot: { entries: [{ id: 'dock-base' }] }, workbench: true })
let threw7 = null
try { h7.mod.apply(h7.ctx) } catch (e) { threw7 = e }
fire(h7, ['dockFlashPanel'], { dockFlashPanel: h7.panel })
check('apply() does not throw', !threw7, threw7 && threw7.message)
check('a console.warn complains about the version', anyLine(h7.lines.warn, /version/i), JSON.stringify(h7.lines.warn))
check('panel.host.claim is NOT called', count(h7.hostCalls, 'claim') === 0, JSON.stringify(h7.hostCalls))
check('nothing was registered with wb',
  ['registerPanel', 'registerPlugin', 'registerActivityBarItem', 'registerEditorView', 'registerCommand']
    .every((n) => h7.callsOf(n).length === 0))

// ═══════════════════════════════════════════════════════════════════════════
section('8. Dock-hidden detach — the whole-host release IS correct here')
const h8 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true })
h8.mod.apply(h8.ctx)
fire(h8, ['dockFlashPanel'], { dockFlashPanel: h8.panel })
const before8 = h8.hostCalls.length
h8.setHidden(['dock-flash'])
h8.fireSetting()
const after8 = h8.hostCalls.slice(before8)
check('dock-hidden calls panel.host.release exactly once', count(after8, 'release') === 1, JSON.stringify(after8))
check('a console.log mentions dock-hidden', anyLine(h8.lines.log, /dock-hidden/), JSON.stringify(h8.lines.log))

// ═══════════════════════════════════════════════════════════════════════════
section('9. I18n goes through the core panel.i18n and claims NO locale namespace')
// The core registers `dock-flash` with DSH's official `locale` service on ITS
// plugin fiber, and `LocaleRuntime.register()` REFUSES a repeat locale. So the
// adapter must not attempt a second registration of the same namespace: until
// 3.0.3 it did, the attempt threw on every boot, and the catch logged
// `official locale registration failed; falling back to core panel.i18n` before
// running the fallback anyway. The locale stub below is built to REJECT a
// duplicate exactly like the real runtime, so a regression reproduces the real
// symptom here instead of passing against a permissive fake.
const h9 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true, locale: true })
let threw9 = null
try { h9.mod.apply(h9.ctx) } catch (e) { threw9 = e }
check('apply() does not throw with the official locale service present', !threw9, threw9 && threw9.message)
fire(h9, ['dockFlashPanel'], { dockFlashPanel: h9.panel })
check('the adapter registers NOTHING with the official locale service',
  h9.localeRegistrations.length === 0, JSON.stringify(h9.localeRegistrations))
check('the adapter never resolves the locale service at all',
  !h9.gets.includes('locale'), JSON.stringify(h9.gets))
check('the mount logs no locale-registration failure',
  !anyLine(h9.lines.warn, /official locale registration failed/i), JSON.stringify(h9.lines.warn))

// Every string comes from the core's frozen `panel.i18n` surface.
const rp9 = firstArg(h9, 'registerPanel')
const rg9 = firstArg(h9, 'registerPlugin')
const ab9 = firstArg(h9, 'registerActivityBarItem')
const ev9 = firstArg(h9, 'registerEditorView')
check('registerPanel.title is a deferred () => string from panel.i18n.L',
  !!rp9 && typeof rp9.title === 'function' && rp9.title() === 'T:title',
  rp9 ? String(typeof rp9.title) + ' ' + String(rp9.title && rp9.title()) : 'registerPanel never called')
check('registerActivityBarItem.title is a deferred () => string from panel.i18n.L',
  typeof prop(ab9, 'title') === 'function' && prop(ab9, 'title')() === 'T:title',
  String(prop(ab9, 'title') && prop(ab9, 'title')()))
check('registerEditorView.title is a deferred () => string from panel.i18n.L',
  typeof prop(ev9, 'title') === 'function' && prop(ev9, 'title')() === 'T:title',
  String(prop(ev9, 'title') && prop(ev9, 'title')()))
// registerPlugin's card renders its children statically, so it MUST get strings
// (AGENTS.md: a function child renders blank).
check('registerPlugin.description is a STATIC string, not a getter',
  typeof prop(rg9, 'description') === 'string' && rg9.description === 'T:description',
  String(prop(rg9, 'description')))

// The sidebar-title patch: dock-base does not re-resolve titleOf() on a language
// switch, so the adapter patches the text itself. That patch must be driven by
// `t.onLocaleChange` — and it must actually WRITE, through the pane guard.
check('the mount subscribed to locale changes through panel.i18n.t.onLocaleChange',
  h9.i18nListeners.length >= 1, String(h9.i18nListeners.length))
h9.setActivePane('dock-flash:quick-control')
h9.panel.i18n.t.setLocale('zh')
check('a locale switch while our pane is active rewrites the sidebar title',
  h9.titleEl.textContent === 'T:title', JSON.stringify(h9.titleEl.textContent))
h9.titleEl.textContent = 'untouched'
h9.setActivePane('someone-else')
h9.panel.i18n.t.setLocale('en')
check('a locale switch on ANOTHER pane leaves that pane\'s title alone',
  h9.titleEl.textContent === 'untouched', JSON.stringify(h9.titleEl.textContent))

// The manifest keeps the locale row as a LOAD-ORDER hint: the core's proxy reads
// the service, so an early arrival sets the language of the first paint.
check("manifest dsh.client.inject lists '@deepseek-ai/dsh-client-locale' as a base name",
  injectedNames.includes('@deepseek-ai/dsh-client-locale'),
  JSON.stringify(injectedNames))
check('lib/client.js contains no locale-namespace registration of its own',
  !/\.register\(\s*['"]dock-flash['"]/.test(codeOnly))

// ═══════════════════════════════════════════════════════════════════════════
section('10. The cordis ctx contract — reading an undeclared service THROWS')
// THE defect this section exists to keep dead. A cordis context is a Proxy whose
// get trap throws `cannot get property "x" without inject` for any service the
// plugin did not declare in `inject`. `typeof ctx.locale` does NOT dodge it —
// typeof evaluates the getter — so the idiomatic-looking existence check at the
// heart of the adapter's i18n aborted `mountWorkbench` on EVERY boot, before the
// claim and before all five wb.register* calls. The user-visible symptom was the
// core's standalone ⚡ with no sidebar panel and no Flash settings card, and the
// console went silent right after `workbench mode` because the throw escaped
// through cordis's own inject callback, outside every try/catch in the file.
// MEASURED against cordis 4.0.4 (see the note on makeCtx): the read throws both
// when the locale service is provided and when it is absent, because this
// plugin's `inject` is []. Only ctx.get() is a safe existence check.

const REG = ['registerPanel', 'registerPlugin', 'registerActivityBarItem', 'registerEditorView', 'registerCommand']
const regCounts = (h) => JSON.stringify(REG.map((n) => n + ':' + h.callsOf(n).length))
const allRegistered = (h) => REG.every((n) => h.callsOf(n).length === 1)

// First: the harness itself must actually enforce the contract, or every
// assertion below is theatre.
let proxyThrew = null
try { h1.ctx.someUndeclaredService } catch (e) { proxyThrew = e }
check('the ctx stub is a cordis-shaped Proxy: an undeclared read throws', !!proxyThrew,
  proxyThrew && proxyThrew.message)

// Static guard: the bundle must resolve services through ctx.get, never by
// reading the property. Comments are already stripped (see `codeOnly`), so the
// explanatory prose in lib/client.js can keep naming ctx.locale without tripping this.
const banned = [/ctx\.locale\b/, /typeof\s+ctx\.[a-z]/].filter((re) => re.test(codeOnly))
check('lib/client.js never reads a service off ctx by property access',
  banned.length === 0, banned.join(', '))

// The live behaviour: a boot with NO official locale service must still come up
// fully. This is the exact production shape — the locale package is not in the
// boot batch — and it used to mount nothing.
const h10 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true, locale: false })
let threw10 = null
try { h10.mod.apply(h10.ctx); fire(h10, ['dockFlashPanel'], { dockFlashPanel: h10.panel }) } catch (e) { threw10 = e }
check('a boot without the official locale service does not throw', !threw10, threw10 && threw10.message)
check('a boot without the official locale service still claims the panel once',
  count(h10.hostCalls, 'claim') === 1, JSON.stringify(h10.hostCalls))
check('a boot without the official locale service still performs all five registrations',
  allRegistered(h10), regCounts(h10))
check('that mount reports no error', h10.lines.error.length === 0, JSON.stringify(h10.lines.error))

// And the same must hold when the service IS there — the throw was unconditional.
const h10b = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true, locale: true })
let threw10b = null
try { h10b.mod.apply(h10b.ctx); fire(h10b, ['dockFlashPanel'], { dockFlashPanel: h10b.panel }) } catch (e) { threw10b = e }
check('a boot WITH the official locale service does not throw', !threw10b, threw10b && threw10b.message)
check('a boot with the official locale service still performs all five registrations',
  allRegistered(h10b), regCounts(h10b))

// A locale service that refuses every registration must not affect the mount at
// all — because the adapter never reaches for it. This is the guard that keeps
// the 3.0.2 defect from coming back: re-add a `register` call and the hostile
// stub makes the mount noisy again, exactly as it did in production.
const h10c = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true, locale: true })
h10c.locale.register = () => { throw new Error('locale namespace "dock-flash" already has locale "zh"') }
let threw10c = null
try { h10c.mod.apply(h10c.ctx); fire(h10c, ['dockFlashPanel'], { dockFlashPanel: h10c.panel }) } catch (e) { threw10c = e }
check('a locale service that refuses registration does not abort the mount',
  allRegistered(h10c), regCounts(h10c))
check('a refusing locale service produces no warning, because it is never called',
  h10c.lines.warn.length === 0 && h10c.localeRegistrations.length === 0,
  JSON.stringify(h10c.lines.warn))

// ── The manifest must not declare a @deepseek-ai/dsh* peerDependency. ───────
// evaluatePluginCompatibility() (dsh-app-boot) compares every such peer against
// the DSH RUNTIME version — getDshRuntimeVersion(), read from app-boot's own
// package.json — never against the named package's installed version. The two
// move together only by coincidence, so ANY pin on such a peer eventually
// disables the whole row: preflight() sets row.disabled, nothing mounts, and
// the GUI blames a version range. That is how 3.0.2 shipped broken.
const dshPeers = Object.keys(manifest.peerDependencies || {})
  .filter((n) => n.startsWith('@deepseek-ai/dsh'))
check('package.json declares no @deepseek-ai/dsh* peerDependency',
  dshPeers.length === 0, JSON.stringify(dshPeers))
check('dock-base and cordis are still peers (DSH does not check these)',
  Object.keys(manifest.peerDependencies || {}).includes('dock-base') &&
  Object.keys(manifest.peerDependencies || {}).includes('@deepseek-ai/cordis'),
  JSON.stringify(Object.keys(manifest.peerDependencies || {})))
// Every inject entry must name a package that the manifest or DSH can resolve,
// and must be a BASE name (arriveGraphRow never strips a `/client` suffix).
check('no dsh.client.inject entry carries a `/client` suffix',
  !injectedNames.some((n) => n.endsWith('/client')), JSON.stringify(injectedNames))
check('no dsh.client.inject entry names a package the manifest does not know',
  injectedNames.every((n) =>
    n in (manifest.dependencies || {}) || n in (manifest.peerDependencies || {}) ||
    // platform rows: composed by DSH itself, never declared here
    ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-api-session-controller'].includes(n)),
  JSON.stringify(injectedNames))

// ═══════════════════════════════════════════════════════════════════════════
console.log('')
if (failures.length) {
  console.log('  ' + failures.length + ' FAILED:')
  for (const f of failures) console.log('    - ' + f)
} else {
  console.log('  ALL CHECKS PASSED')
}
process.exitCode = failures.length ? 1 : 0
