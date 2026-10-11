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

// The manifest's inject list drives arriveGraphRow load order. The adapter reuses
// the official @deepseek-ai/dsh-client-locale runtime, so that package name must
// be present here (as a BASE name, per AGENTS.md) for its locale service to arrive
// before the adapter mounts.
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
      const t = timers.find((x) => x.ms === ms)
      if (!t) throw new Error('no captured timer with delay ' + ms)
      t.fn()
    },
  }
}

// The fake cordis ctx. `effect` CALLS fn() immediately and keeps its return value as
// the cleanup without running it — which is exactly how the real bundle expects to be
// driven (its own comment: the harness's effect stub returns the cleanup without
// invoking it), and it is how section 4 tears the mount down by hand.
function makeCtx(services) {
  const gets = []
  const injections = []
  const effects = []
  const events = []
  const ctx = {
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
  return { ctx, gets, injections, effects, events }
}

// A faithful stub of the OFFICIAL @deepseek-ai/dsh-client-locale LocaleRuntime,
// so the adapter's reuse of ctx.locale (register + bind + locale/change) can be
// asserted without a real browser. Mirrors the typed surface the adapter uses:
// register(ns, {zh,en}) -> disposer, bind(ns) -> (key):string, plus the cordis
// `locale/change` event the adapter subscribes to via ctx.on.
function makeLocale() {
  const registrations = []
  const port = {
    register(ns, dicts) {
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
  const panel = {
    version: 1,
    Panel: function Panel() {},
    ErrorBoundary: function ErrorBoundary() {},
    Header: function Header() {},
    icon: 'ICON',
    registry: {},
    i18n: {
      L: (k) => 'L:' + k,
      t: Object.assign((k) => 'T:' + k, {
        onLocaleChange(cb) {
          i18nListeners.push(cb)
          return () => { const i = i18nListeners.indexOf(cb); if (i >= 0) i18nListeners.splice(i, 1) }
        },
      }),
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
  const rec = (name, arg) => { calls.push({ name, arg }); return () => {} }
  const wb = {
    registerPanel: (a) => rec('registerPanel', a),
    registerPlugin: (a) => rec('registerPlugin', a),
    registerActivityBarItem: (a) => rec('registerActivityBarItem', a),
    registerEditorView: (a) => rec('registerEditorView', a),
    registerCommand: (a) => rec('registerCommand', a),
    openView: (...a) => { calls.push({ name: 'openView', args: a }) },
    closeViewInstance: (...a) => { calls.push({ name: 'closeViewInstance', args: a }) },
    getLayout: () => { calls.push({ name: 'getLayout' }); return { activity: null, floatingWindows: {}, editorTabs: [] } },
    getActivityItem: (id) => { calls.push({ name: 'getActivityItem', arg: id }); return null },
    getHiddenPluginIds: () => { calls.push({ name: 'getHiddenPluginIds' }); return hidden },
    onDidChangeSetting: (cb) => { settingCb = cb; calls.push({ name: 'onDidChangeSetting' }); return () => {} },
  }
  return {
    wb, calls,
    callsOf: (n) => calls.filter((c) => c.name === n),
    setHidden: (h) => { hidden = h },
    fireSetting: () => { if (!settingCb) throw new Error('onDidChangeSetting callback was never registered'); settingCb() },
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
  const documentStub = {
    querySelector: () => null,
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
    fireSetting: wbH.fireSetting, timers, lines, windowObj, documentStub,
    locale: localeH && localeH.locale, localeRegistrations: localeH && localeH.registrations,
  }
}

const count = (arr, v) => arr.filter((x) => x === v).length
const depsEq = (deps, want) => JSON.stringify(deps) === JSON.stringify(want)
const anyLine = (lines, re) => lines.some((l) => re.test(l))

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
inj3.cb({ dockFlashPanel: h3.panel })
check('panel.host.claim called exactly once', count(h3.hostCalls, 'claim') === 1, JSON.stringify(h3.hostCalls))
check('the returned lease\'s confirm called exactly once', count(h3.hostCalls, 'lease.confirm') === 1)
check('registerPanel called exactly once', h3.callsOf('registerPanel').length === 1)
check('registerPlugin called exactly once', h3.callsOf('registerPlugin').length === 1)
check('registerActivityBarItem called exactly once', h3.callsOf('registerActivityBarItem').length === 1)
check('registerEditorView called exactly once', h3.callsOf('registerEditorView').length === 1)
check('registerCommand called exactly once', h3.callsOf('registerCommand').length === 1)

const rp = h3.callsOf('registerPanel')[0].arg
const rg = h3.callsOf('registerPlugin')[0].arg
const ab = h3.callsOf('registerActivityBarItem')[0].arg
const ev = h3.callsOf('registerEditorView')[0].arg
const cm = h3.callsOf('registerCommand')[0].arg
check("registerPanel id is 'dock-flash:quick-control'", rp.id === 'dock-flash:quick-control', rp.id)
check('registerPanel region is sideBar', rp.region === 'sideBar', rp.region)
check('registerPanel component and headerComponent are both functions',
  typeof rp.component === 'function' && typeof rp.headerComponent === 'function',
  typeof rp.component + '/' + typeof rp.headerComponent)
check("registerPlugin id is 'dock-flash'", rg.id === 'dock-flash', rg.id)
check("registerActivityBarItem id is 'dock-flash:quick-control'", ab.id === 'dock-flash:quick-control', ab.id)
check("registerEditorView id is 'dock-flash:quick-control'", ev.id === 'dock-flash:quick-control', ev.id)
check("registerCommand id is 'dock-flash:openQuickControl'", cm.id === 'dock-flash:openQuickControl', cm.id)

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
h5.injections[0].cb({ dockFlashPanel: h5.panel })
check('apply() does not throw', !threw5, threw5 && threw5.message)
check('panel.host.claim is NOT called', count(h5.hostCalls, 'claim') === 0, JSON.stringify(h5.hostCalls))
check('a console.warn mentions dock-base', anyLine(h5.lines.warn, /dock-base/), JSON.stringify(h5.lines.warn))

// ═══════════════════════════════════════════════════════════════════════════
section('6. Workbench late — dock-base installed but its service not yet here')
const h6 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: false })
h6.mod.apply(h6.ctx)
h6.injections[0].cb({ dockFlashPanel: h6.panel })
check('a console.log mentions waiting for the workbench service',
  anyLine(h6.lines.log, /waiting for the workbench/i), JSON.stringify(h6.lines.log))
const injWb = h6.injections.find((i) => depsEq(i.deps, ['workbench']))
check("ctx.inject was called with deps exactly ['workbench']", !!injWb,
  JSON.stringify(h6.injections.map((i) => i.deps)))
injWb.cb({ workbench: h6.wb })
check('workbench arrival performs the same registrations as the happy path',
  ['registerPanel', 'registerPlugin', 'registerActivityBarItem', 'registerEditorView', 'registerCommand']
    .every((n) => h6.callsOf(n).length === 1),
  JSON.stringify(['registerPanel', 'registerPlugin', 'registerActivityBarItem', 'registerEditorView', 'registerCommand'].map((n) => n + ':' + h6.callsOf(n).length)))
check('workbench arrival also claims the panel exactly once', count(h6.hostCalls, 'claim') === 1)

// The manifest fallback: boot entries say nothing, but the module graph does.
const h6b = scenario({ boot: { entries: [] }, graphRows: new Map([['dock-base', {}]]), workbench: false })
h6b.mod.apply(h6b.ctx)
h6b.injections[0].cb({ dockFlashPanel: h6b.panel })
check('the ctx.get("modules").graphRows fallback also detects dock-base',
  h6b.injections.some((i) => depsEq(i.deps, ['workbench'])),
  JSON.stringify(h6b.injections.map((i) => i.deps)))

// ═══════════════════════════════════════════════════════════════════════════
section('7. Version mismatch — panel speaks 2, adapter speaks 1')
const h7 = scenario({ panelVersion: 2, boot: { entries: [{ id: 'dock-base' }] }, workbench: true })
let threw7 = null
try { h7.mod.apply(h7.ctx) } catch (e) { threw7 = e }
h7.injections[0].cb({ dockFlashPanel: h7.panel })
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
h8.injections[0].cb({ dockFlashPanel: h8.panel })
const before8 = h8.hostCalls.length
h8.setHidden(['dock-flash'])
h8.fireSetting()
const after8 = h8.hostCalls.slice(before8)
check('dock-hidden calls panel.host.release exactly once', count(after8, 'release') === 1, JSON.stringify(after8))
check('a console.log mentions dock-hidden', anyLine(h8.lines.log, /dock-hidden/), JSON.stringify(h8.lines.log))

// ═══════════════════════════════════════════════════════════════════════════
section('9. I18n reuses the official @deepseek-ai/dsh-client-locale when present')
// When the official LocaleRuntime is resolvable on ctx (via ctx.get('locale')),
// the adapter must register its own 'dock-flash' namespace and bind it, then
// refresh the sidebar title through the official `locale/change` event — NOT the
// core's hand-rolled `panel.i18n.t.onLocaleChange`.
const h9 = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true, locale: true })
let threw9 = null
try { h9.mod.apply(h9.ctx) } catch (e) { threw9 = e }
check('apply() does not throw with the official locale service', !threw9, threw9 && threw9.message)
h9.injections[0].cb({ dockFlashPanel: h9.panel })
check("ctx requested the 'locale' service", h9.gets.includes('locale'), JSON.stringify(h9.gets))
check("the adapter registered its own namespace 'dock-flash'",
  h9.localeRegistrations.length === 1 && h9.localeRegistrations[0].ns === 'dock-flash',
  JSON.stringify(h9.localeRegistrations))
const reg9 = h9.localeRegistrations[0]
check('the registered namespace ships bilingual zh and en dictionaries',
  !!reg9 && reg9.dicts && reg9.dicts.zh && reg9.dicts.en
    && typeof reg9.dicts.zh.title === 'string' && typeof reg9.dicts.en.title === 'string',
  reg9 && JSON.stringify(reg9.dicts))
check('the adapter bound the dock-flash namespace', h9.locale._boundNs === 'dock-flash',
  String(h9.locale._boundNs))
check('the sidebar title patch subscribes via the official locale/change event',
  h9.events.some((e) => e.event === 'locale/change'),
  JSON.stringify(h9.events.map((e) => e.event)))
// The bound translator drives the deferred title getters dock-base consumes.
const rp9 = h9.callsOf('registerPanel')[0].arg
check('registerPanel.title is a deferred () => string backed by the bound translator',
  typeof rp9.title === 'function' && /^T:/.test(rp9.title()), String(rp9.title && rp9.title()))
check('a console.log mentions reusing @deepseek-ai/dsh-client-locale',
  anyLine(h9.lines.log, /dsh-client-locale/), JSON.stringify(h9.lines.log))
check("manifest dsh.client.inject lists '@deepseek-ai/dsh-client-locale' as a base name",
  injectedNames.includes('@deepseek-ai/dsh-client-locale'),
  JSON.stringify(injectedNames))

// The fallback still works when the official service is absent (no `locale`).
const h9b = scenario({ boot: { entries: [{ id: 'dock-base' }] }, workbench: true, locale: false })
h9b.mod.apply(h9b.ctx)
h9b.injections[0].cb({ dockFlashPanel: h9b.panel })
check('with the official locale absent, it falls back to panel.i18n without throwing',
  h9b.callsOf('registerPanel').length === 1, JSON.stringify(h9b.callsOf('registerPanel').length))
check('a console.log does NOT claim dsh-client-locale reuse on the fallback path',
  !anyLine(h9b.lines.log, /dsh-client-locale/))

// ═══════════════════════════════════════════════════════════════════════════
console.log('')
if (failures.length) {
  console.log('  ' + failures.length + ' FAILED:')
  for (const f of failures) console.log('    - ' + f)
} else {
  console.log('  ALL CHECKS PASSED')
}
process.exitCode = failures.length ? 1 : 0
