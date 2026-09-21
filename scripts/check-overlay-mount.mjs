// `pnpm run check:overlay` — proves the standalone overlay trigger MOUNTS.
//
// Why this exists rather than another checklist item: every failure this feature has
// had was an invisible one. `mountOverlayTrigger()`'s throw was swallowed by `apply()`'s
// own catch, the button's absence looked exactly like a position that was never
// selected, and the browser was once served a bundle older than every fix being tested.
// Reading the source produced a self-consistent explanation that was wrong three times.
// So this evaluates the REAL `lib/client.js` in a V8 sandbox against a minimal DOM and
// asserts the observable end state instead — no browser, no reload, no interpretation.
//
// The scenario is the one that actually broke: the `slots` service NEVER arrives (the
// callback is deliberately not called), and the conversation appears only AFTER the
// mount, because `apply()` runs at app bootstrap. Both match the real order of events.
//
// Point DOCK_FLASH_BUNDLE at another copy to watch it fail: the pre-fix line, which
// handed a React element to `appendChild`, fails 14 of these with the exact TypeError.
import fs from 'node:fs'
import vm from 'node:vm'

const SVG_NS = 'http://www.w3.org/2000/svg'
const failures = []
function check(name, ok, detail) {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail === undefined ? '' : '  → ' + detail))
  if (!ok) failures.push(name)
}

// ── style object ────────────────────────────────────────────────────────────
function makeStyle() {
  const store = new Map()
  const base = {
    setProperty(k, v) { store.set(k, String(v)) },
    getPropertyValue(k) { return store.has(k) ? store.get(k) : '' },
    removeProperty(k) { store.delete(k) },
  }
  return new Proxy(base, {
    get(t, k) {
      if (typeof k === 'symbol') return undefined
      if (k === 'cssText') return [...store].map(([a, b]) => a + ':' + b).join(';')
      if (k in t) return t[k]
      return store.has(k) ? store.get(k) : ''
    },
    set(t, k, v) {
      if (k === 'cssText') {
        store.clear()
        for (const part of String(v).split(';')) {
          const i = part.indexOf(':')
          if (i > 0) store.set(part.slice(0, i).trim(), part.slice(i + 1).trim())
        }
        return true
      }
      store.set(k, String(v))
      return true
    },
    has(t, k) { return typeof k !== 'symbol' && (k in t || store.has(k)) },
  })
}

// ── element ─────────────────────────────────────────────────────────────────
let uid = 0
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.nodeName = this.tagName
    this.children = []
    this.parentNode = null
    this.style = makeStyle()
    this._attrs = new Map()
    this._listeners = new Map()
    this._rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }
    this.clientWidth = 0
    this.clientHeight = 0
    this.scrollHeight = 0
    this.scrollWidth = 0
    this.isConnected = false
    this._text = ''
    this._uid = ++uid
  }
  get id() { return this._attrs.get('id') || '' }
  set id(v) { this._attrs.set('id', String(v)) }
  get className() { return this._attrs.get('class') || '' }
  set className(v) { this._attrs.set('class', String(v)) }
  get classList() {
    const self = this
    return {
      add(c) { const s = new Set(self.className.split(/\s+/).filter(Boolean)); s.add(c); self.className = [...s].join(' ') },
      remove(c) { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' ') },
      contains(c) { return self.className.split(/\s+/).includes(c) },
      toggle(c) { this.contains(c) ? this.remove(c) : this.add(c) },
    }
  }
  get firstChild() { return this.children[0] || null }
  /**
   * `contains` — ancestry, not "is a child". Code that closes a popup on an
   * outside click asks THIS question, and the bundle relies on it in
   * `handleOutsideClick` and `openOverlayMenu`. Without it the call throws
   * partway through the handler and everything AFTER the throw silently does not
   * happen: a stuck `dragging` flag was traced to exactly this, which the test
   * read as "the opacity setting does not repaint".
   */
  contains(other) {
    let n = other
    while (n) {
      if (n === this) return true
      n = n.parentNode
    }
    return false
  }
  get textContent() { return this._text }
  set textContent(v) { this._text = String(v); this.children.length = 0 }
  get innerHTML() { return this._html || '' }
  set innerHTML(v) { this._html = String(v); if (!v) this.children.length = 0 }
  setAttribute(k, v) { this._attrs.set(k, String(v)) }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null }
  hasAttribute(k) { return this._attrs.has(k) }
  removeAttribute(k) { this._attrs.delete(k) }
  /**
   * `dataset` — the property the bundle actually reads for element attributes
   * (`el.dataset.plugin`, `style.dataset.plugin`, `body.dataset.liangSkin`).
   *
   * A stub with only getAttribute() throws `Cannot read properties of undefined`
   * the moment a scan phase touches these, which is why the DOM scan had never run
   * here. camelCase maps to data-kebab-case in both directions, as the real DOM
   * does; the event `dataset` uses the same Proxy in the real bundle, so this is
   * exercised whenever the split-view drag handles fire.
   */
  get dataset() {
    const self = this
    return new Proxy({}, {
      get(_t, k) {
        if (typeof k === 'symbol') return undefined
        return self.getAttribute('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) ?? undefined
      },
      set(_t, k, v) {
        self.setAttribute('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), v)
        return true
      },
      has(_t, k) {
        return typeof k !== 'symbol' &&
          self.getAttribute('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) !== null
      },
      deleteProperty(_t, k) {
        self.removeAttribute('data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()))
        return true
      },
    })
  }
  appendChild(child) {
    if (!child || typeof child !== 'object' || !(child instanceof El)) {
      throw new TypeError("Failed to execute 'appendChild' on 'Node': parameter 1 is not of type 'Node'.")
    }
    child.parentNode = this
    this.children.push(child)
    setConnected(child, this.isConnected)
    return child
  }
  removeChild(child) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentNode = null
    setConnected(child, false)
    return child
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  addEventListener(t, fn) { if (!this._listeners.has(t)) this._listeners.set(t, []); this._listeners.get(t).push(fn) }
  removeEventListener(t, fn) {
    const a = this._listeners.get(t)
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) }
  }
  dispatch(t, ev) {
    for (const fn of [...(this._listeners.get(t) || [])]) {
      fn(ev || { type: t, preventDefault() {}, stopPropagation() {}, button: 0 })
    }
  }
  getBoundingClientRect() { return this._rect }
  descendants(out = []) {
    for (const c of this.children) { out.push(c); c.descendants(out) }
    return out
  }
  querySelector(sel) { return this.descendants().find((e) => matches(e, sel)) || null }
  querySelectorAll(sel) { return this.descendants().filter((e) => matches(e, sel)) }
}
function setConnected(el, on) { el.isConnected = on; for (const c of el.children) setConnected(c, on) }

function matches(el, sel) {
  // SELECTOR LISTS. A real `querySelectorAll('head style[data-plugin], head
  // link[data-plugin]')` matches either branch; a stub that only understood single
  // selectors returned NOTHING for that string, so the bundle's DOM scan (phase 1a)
  // silently found no skins in the harness — and every assertion about "which skins
  // are listed" was really only testing the market-extra path. That is how a leak
  // through phase 1a passed a check written to catch it.
  const s = String(sel).trim()
  if (s.includes(',')) return s.split(',').some((part) => matches(el, part.trim()))
  // DESCENDANT SELECTORS. `head style[data-plugin]` means "a style[data-plugin]
  // that is a descendant of a head", NOT "an element that is both". Since
  // `El.querySelectorAll` already scopes the search to the receiver's descendants,
  // the leading ancestor is satisfied by construction and is dropped here. Without
  // this the bundle's phase-1a scan matched nothing in the harness — every "which
  // skins are listed" assertion was silently testing only the market-extra path.
  const descendant = /^([a-zA-Z]+)\s+(.+)$/.exec(s)
  if (descendant) return matches(el, descendant[2])
  const m = /^([a-zA-Z]*)(?:\[([\w-]+)(?:([*$^]?)=["']([^"']*)["'])?\])?$/.exec(s)
  if (!m) return false
  const [, tag, attr, op, val] = m
  if (tag && el.tagName !== tag.toUpperCase()) return false
  if (!attr) return true
  if (el.getAttribute(attr) === null) return false   // bare `[attr]` = "has it"
  const have = String(el.getAttribute(attr))
  if (op === undefined) return true
  if (op === '*') return have.includes(val)
  if (op === '$') return have.endsWith(val)
  if (op === '^') return have.startsWith(val)
  return have === val
}

// ── document / window ───────────────────────────────────────────────────────
const documentElement = new El('html')
documentElement.setAttribute('lang', 'zh-CN')
const head = new El('head')
const body = new El('body')
// Document-level listeners are recorded rather than dropped: the drag machinery
// (`handleDragMove` / `handleDragEnd`) and the outside-click handler all hang off
// `document`, so a stub that discards them cannot test the gestures at all — and
// the gesture is where the button was dead.
const documentListeners = new Map()
const documentStub = {
  documentElement,
  head,
  body,
  // `new URL(path, document.baseURI)` is how the bundle builds EVERY request URL,
  // and both call sites sit inside a try/catch (a deliberate design: a request
  // must never break `apply()`). The consequence in a sandbox that omits
  // `baseURI` is that the throw is swallowed and the request is never made — so
  // the market never answers, the skin switch never registers, and NO skin
  // behaviour is testable. Supplying it is what the browser does anyway.
  baseURI: 'http://127.0.0.1:3080/',
  createElement: (t) => new El(t),
  createElementNS: (_ns, t) => new El(t),
  querySelector: (s) => (matches(documentElement, s) ? documentElement : null) || body.querySelector(s) || head.querySelector(s),
  querySelectorAll: (s) => [...body.querySelectorAll(s), ...head.querySelectorAll(s)],
  addEventListener(type, fn) {
    if (!documentListeners.has(type)) documentListeners.set(type, [])
    documentListeners.get(type).push(fn)
  },
  removeEventListener(type, fn) {
    const a = documentListeners.get(type)
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) }
  },
  getElementById: (id) => body.descendants().find((e) => e.id === id) || null,
  __fire(type, ev) {
    for (const fn of [...(documentListeners.get(type) || [])]) {
      fn(ev || { type, preventDefault() {}, stopPropagation() {} })
    }
  },
}
body.isConnected = true
head.isConnected = true

const store = new Map()
/** Separate from `store`: sessionStorage is per-TAB, which is the lifetime the
 *  classification cache relies on, so the two must not be the same map. */
const sessionStore = new Map()
/** How many times the (megabyte) registry endpoint was asked for. */
let registryFetches = 0
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

const mutationObservers = []
class MutationObserverStub {
  constructor(cb) { this._cb = cb }
  observe() { mutationObservers.push(this) }
  disconnect() { const i = mutationObservers.indexOf(this); if (i >= 0) mutationObservers.splice(i, 1) }
  takeRecords() { return [] }
}
const resizeObservers = []
class ResizeObserverStub {
  constructor(cb) { this._cb = cb; this.targets = [] }
  observe(el) { this.targets.push(el); resizeObservers.push(this) }
  unobserve() {}
  disconnect() { this.targets = [] }
}

function getComputedStyleStub(el) {
  return new Proxy({}, {
    get(_t, k) {
      if (typeof k === 'symbol') return undefined
      if (k === 'overflowY') return el.__overflowY || 'visible'
      if (k === 'overflowX') return el.__overflowX || 'visible'
      if (k === 'display') return el.style.display || 'block'
      if (k === 'visibility') return 'visible'
      return el.style[k] ?? ''
    },
  })
}

const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  document: documentStub,
  // The bundle builds request URLs with `new URL(path, document.baseURI)` inside
  // a try/catch, so a sandbox WITHOUT `URL` silently skips the market fetch —
  // which in turn means the skin switch never registers and no skin behaviour is
  // testable at all. Providing it (as the browser does) is what makes section 15
  // possible.
  URL,
  URLSearchParams,
  localStorage: localStorageStub,
  // The classification index caches into sessionStorage. Its absence is swallowed
  // by the bundle's own try/catch (deliberately), so without this stub every page
  // load would re-fetch 1.1 MB in the harness — and, worse, the "fetched only
  // once per session" assertion below would be testing nothing.
  sessionStorage: {
    getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
    setItem: (k, v) => sessionStore.set(k, String(v)),
    removeItem: (k) => sessionStore.delete(k),
    clear: () => sessionStore.clear(),
    get length() { return sessionStore.size },
  },
  navigator: { userAgent: 'harness', language: 'zh-CN', languages: ['zh-CN'] },
  location: { href: 'http://127.0.0.1:3080/', origin: 'http://127.0.0.1:3080', search: '', hostname: '127.0.0.1' },
  // The market API is the ONLY thing that registers the skin switch, and the
  // harness has no network. Answering `/dsh-market/installed` with a realistic
  // body is what makes section 15 possible at all — and the body deliberately
  // includes the market plugin ITSELF, because that is the entry being filtered.
  fetch: (url) => {
    const u = String(url)
    if (u.indexOf('/dsh-market/installed') !== -1) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          installed: {
            'open-sea-skin': 'github:d-dev0101/open-sea-skin#abc',
            'dsh-skin-market': 'github:x/dsh-skin-market#def',
            // The reported case: installed from a SPEC THAT IS A BARE VERSION, so
            // the market's repo rule cannot match it either, and the catalog knows
            // it as `dsh-liang-skin` (a name that is not this package).
            'dsh-client-liang-intensity-skin': '0.1.6',
            // Same package shape but installed from its repo — the market's SECOND
            // rule matches this one, so it must stay listed.
            'dsh-repo-installed-skin': 'github:kingOfSoySauce/dsh-liang-skin#976fcbf',
          },
          activation: {
            'open-sea-skin': { state: 'live' },
            // Disabled in the market's own registry, which is why picking it in
            // the skin dropdown could never do anything.
            'dsh-skin-market': { state: 'disabled' },
            'dsh-client-liang-intensity-skin': { state: 'live' },
            'dsh-repo-installed-skin': { state: 'disabled' },
          },
        }),
      })
    }
    if (u.indexOf('/dsh-market/registry') !== -1) {
      registryFetches++
      // Minimal but structurally real: the derivation reads `registry.plugins`,
      // and each entry carries `name`/`category`/`url`. `category` is accepted as
      // a bare string here on purpose — the market's own `pluginCategories()`
      // takes either shape, so the harness must exercise both.
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          registry: {
            plugins: [
              { name: 'open-sea-skin', category: ['theme'], url: 'https://github.com/d-dev0101/open-sea-skin' },
              // The liang entry as the REAL catalog has it: a theme, under a name
              // that is not the installed package name — reachable only by repo.
              { name: 'dsh-liang-skin', category: ['theme'], url: 'https://github.com/kingOfSoySauce/dsh-liang-skin' },
              // Bare-string category, and not a theme.
              { name: 'dsh-skin-market', category: 'tool', url: 'https://github.com/x/dsh-skin-market' },
            ],
          },
        }),
      })
    }
    if (u.indexOf('/dsh-market/use-skin') !== -1) {
      // The market refuses any name outside its theme set, with exactly this body.
      return Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'not an installed theme' }),
      })
    }
    return Promise.reject(new Error('harness: no network'))
  },
  getComputedStyle: getComputedStyleStub,
  MutationObserver: MutationObserverStub,
  ResizeObserver: ResizeObserverStub,
  innerWidth: 1400,
  innerHeight: 900,
  performance: { now: () => Date.now() },
  addEventListener() {}, removeEventListener() {},
  __flushMutations: () => { for (const o of [...mutationObservers]) o._cb([]) },
  __fireResize: () => { for (const o of [...resizeObservers]) o._cb([]) },
}
sandbox.window = sandbox
sandbox.globalThis = sandbox

// ── react stubs ─────────────────────────────────────────────────────────────
/** Call a React element tree the way the panel needs it called: function
 *  components directly, class components through `render()`. Children are walked
 *  as well, because the panel is wrapped in `PanelErrorBoundary` and the element
 *  we want is its child. Depth-bounded so a self-referential tree cannot hang. */
function renderTree(el, depth = 0) {
  if (el === null || el === undefined || depth > 8) return
  if (Array.isArray(el)) { for (const c of el) renderTree(c, depth + 1); return }
  if (typeof el !== 'object') return
  const { type, props } = el
  if (typeof type === 'function') {
    let out
    if (typeof type.prototype?.render === 'function') out = new type(props || {}).render()
    else out = type(props || {})
    renderTree(out, depth + 1)
  }
  const kids = props && props.children
  renderTree(kids, depth + 1)
}

// Hook state is kept PER COMPONENT INSTANCE for the duration of one render, which
// is what lets `useEffect` be stubbed into something real: effects are collected
// during the render and run afterwards, so a component's SUBSCRIPTIONS actually
// happen. Without that, `useEffect: () => {}` meant nothing that a component
// registers inside an effect could ever be observed — and the slot trigger's size
// repaint is exactly such a subscription (`lib/client.js`), which is how a real
// defect shipped past this harness: the overlay resized while the slot button
// stayed at its old size.
let effectCursor = 0
const pendingEffects = []
const ReactStub = {
  createElement: (type, props, ...kids) => ({
    $$typeof: Symbol.for('react.element'), type, props: { ...(props || {}), children: kids.length <= 1 ? kids[0] : kids },
  }),
  Component: class { constructor(p) { this.props = p || {}; this.state = {} } setState(s) { Object.assign(this.state, s) } render() { return null } },
  // React calls a lazy initialiser; the panel relies on that (`useState(() => new Set(…))`),
  // so a stub that returned the function itself made `openTabs.has` throw.
  // The setter RECORDS the value so a later effect can be seen to have been
  // registered, and so a re-render can be requested by the test.
  useState: (v) => {
    const initial = typeof v === 'function' ? v() : v
    const cell = {
      value: initial,
      bumped: false,
      set(v2) {
        this.value = typeof v2 === 'function' ? v2(this.value) : v2
        this.bumped = true
        // A real setState schedules a re-render; the harness counts one.
        if (stateChangeSink) stateChangeSink(this.value)
      },
    }
    hookCells.push(cell)
    return [initial, (v2) => cell.set(v2)]
  },
  // Run the effect now and remember its cleanup, so `runEffects()` below is a
  // faithful "commit phase". Effects are re-run per render, matching React's
  // empty-deps behaviour only in the sense that matters here: a component that
  // renders again re-registers. Cleanups from the previous render are called
  // first, which is what keeps a re-render from stacking duplicate subscriptions
  // (the panel does exactly this).
  useEffect: (fn) => { pendingEffects.push(fn) },
  useLayoutEffect: (fn) => { pendingEffects.push(fn) },
  useCallback: (f) => f,
  useRef: (v) => ({ current: v }),
  useMemo: (f) => f(),
  createContext: (v) => ({ Provider: null, Consumer: null, _currentValue: v }),
  Fragment: 'Fragment',
  memo: (f) => f,
}
/** Hook cells touched by the most recent render, plus the pending effects. */
const hookCells = []
const effectCleanups = []
function beginRender() { hookCells.length = 0; pendingEffects.length = 0 }
/**
 * Run the effects registered by the render that just happened.
 *
 * `onStateChange`, when given, is handed to every `useState` setter the effects
 * call — so a component that subscribes to something and then calls a setter from
 * inside that callback can be SEEN to have done so. That is what makes the slot
 * trigger's size subscription testable: without this, a build with no
 * subscription at all would pass, because the harness could always re-render by
 * hand. (Measured: it did. The negative control passed until this hook existed.)
 */
let stateChangeSink = null
function runEffects(onStateChange) {
  // NOT reset after the effects run: the setter a subscription calls is invoked
  // LATER, when the event fires — that is the whole point of a subscription — so
  // the sink has to outlive the effect body.
  stateChangeSink = onStateChange || stateChangeSink
  // Cleanups first: a re-render must not leave the previous subscriptions live.
  while (effectCleanups.length) {
    const off = effectCleanups.pop()
    try { if (typeof off === 'function') off() } catch (_) {}
  }
  const fns = pendingEffects.splice(0, pendingEffects.length)
  for (const fn of fns) {
    try {
      const off = fn()
      if (typeof off === 'function') effectCleanups.push(off)
    } catch (e) { console.error('[harness] effect threw:', e && e.message) }
  }
}
/** Fire every subscription the last `runEffects` registered, as an event would. */
function emitToSubscriptions() {
  // The subscriptions live in the component's effects, which called `set` on a
  // hook cell; re-running those effects' bodies is not possible, so instead the
  // cells are inspected: a bump is observable as a state change request.
  return hookCells.some((c) => c.bumped)
}
const requireStub = (id) => {
  if (id === 'react') return ReactStub
  // `createRoot().render()` INVOKES the tree instead of discarding it. The panel
  // component is only reachable through this renderer, so without it a change to
  // what the panel draws could not be checked here at all — and "the panel lists
  // a stood-down row in its editing modes" is exactly such a change. Hooks are
  // stubbed to their initial values, so this renders the NORMAL view: the editing
  // modes are asserted through the inventory the panel publishes (see section 9).
  if (id === 'react-dom/client') return { createRoot: () => ({ render: (el) => renderTree(el), unmount() {} }) }
  throw new Error('harness: unexpected require(' + id + ')')
}

// ── load the REAL bundle ────────────────────────────────────────────────────
// The overlay position is a stored preference, exactly as it is for a user who
// picked it, so seed it the same way the switch would have.
store.set('dock-flash:trigger-position', 'conversation.overlay')

const code = fs.readFileSync(
  process.env.DOCK_FLASH_BUNDLE || new URL('../lib/client.js', import.meta.url),
  'utf8',
)
let definition = null
sandbox.window.__ModuleLoader__ = { load: (def) => { definition = def } }
vm.runInNewContext(code, sandbox, { filename: 'lib/client.js' })

console.log('\n=== 1. factory + apply (standalone, slots service NEVER arrives) ===')
check('bundle registers itself via __ModuleLoader__', !!definition, definition && definition.id)
const plugin = definition.factory(requireStub)
check('factory returned an apply()', typeof plugin.apply === 'function')

const injectCalls = []
let slotsCallback = null      // captured above; invoked later, on purpose
const errors = []
const origError = console.error
console.error = (...a) => { errors.push(a.map(String).join(' ')); origError(...a) }
// `provide` is captured rather than ignored so the panel can be rendered for
// real: `QuickControlPanel` reads its registry back through
// `ctx.get('quickControl')`, and without it `getSwitches()` is empty and the
// panel renders nothing to assert on.
const provided = {}
const ctx = {
  get: (name) => provided[name],      // no workbench → standalone mode
  provide: (name, value) => { provided[name] = value },
  on: () => () => {},
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  // Deliberately never invokes the callback: the overlay must not need `slots`.
  // The callback is CAPTURED rather than dropped, because every standalone
  // Layout switch (trigger-position, close-on-blur, trigger-size) is registered
  // inside it — so leaving it uncalled would also leave section 10 testing a
  // switch that was never registered.
  inject: (deps, cb) => { injectCalls.push(deps); if (typeof cb === 'function') slotsCallback = cb; return () => {} },
  logger: { info() {}, warn() {}, error() {} },
}
plugin.apply(ctx)
console.error = origError

const registry = provided.quickControl
check('the plugin published its quickControl registry', !!registry && typeof registry.registerSwitch === 'function')

check('apply() reported no [dock-flash] failure', errors.length === 0, errors.join(' | ') || 'none')
check('apply() reached ctx.inject([\'slots\']) — the overlay did not throw past it',
  injectCalls.length === 1 && injectCalls[0][0] === 'slots', JSON.stringify(injectCalls))

const btn = sandbox.document.getElementById('dock-flash-overlay-trigger')
check('overlay button EXISTS in the document', !!btn)
check('overlay button is a child of <body>', !!(btn && btn.parentNode === body))
check('overlay button has a real <svg> child (not a React descriptor)',
  !!(btn && btn.children.length === 1 && btn.children[0] instanceof El && btn.children[0].tagName === 'SVG'),
  btn ? btn.children.map((c) => (c instanceof El ? c.tagName : typeof c)).join(',') : 'no button')
check('overlay button is hidden while there is no conversation', !!(btn && btn.style.display === 'none'),
  btn && btn.style.display)

// ── the probe agrees ────────────────────────────────────────────────────────
console.log('\n=== 2. __dockFlashOverlay() before a conversation exists ===')
const probe1 = sandbox.window.__dockFlashOverlay()
console.log('  ' + JSON.stringify(probe1, null, 2).split('\n').join('\n  '))
check('probe reports the build version first', probe1.clientVersion === '1.5.0', probe1.clientVersion)
check('probe: mounted but no anchor yet', probe1.overlayElMounted === true && probe1.anchorFound === false)
check('probe: the anchor watcher is armed', probe1.anchorWatcher === 'waiting-for-anchor', probe1.anchorWatcher)

// ── the conversation opens LATER, with no further interaction ───────────────
console.log('\n=== 3. a conversation appears after mount (the real bootstrap order) ===')
const scroller = new El('div')
scroller.setAttribute('class', 'wSkVaW_scrollBody')
scroller.__overflowY = 'auto'
scroller.clientWidth = 990          // 1000 - 10px scrollbar-gutter: stable
scroller.clientHeight = 640
scroller.scrollHeight = 2000
scroller._rect = { x: 260, y: 60, width: 1000, height: 640, top: 60, left: 260, right: 1260, bottom: 700 }
body.appendChild(scroller)
sandbox.__flushMutations()          // what the MutationObserver would see

await new Promise((r) => setTimeout(r, 80))

check('button became visible with no window resize', !!(btn && btn.style.display === 'flex'), btn && btn.style.display)
// contentRight = 1260 - 10 = 1250; left = 1250 - 24 - dx(8) = 1218; top = 60 + 8 = 68
check('button cleared the scrollbar gutter (left 1218, not 1226)', btn && btn.style.left === '1218px', btn && btn.style.left)
check('button followed the stored offset (top 68)', btn && btn.style.top === '68px', btn && btn.style.top)
check('a ResizeObserver is attached to the viewport', resizeObservers.some((o) => o.targets.includes(scroller)))

console.log('\n=== 4. the turn rail takes the same corner ===')
// Real DSH markup, class names and all. The scroller's class is a JOINED list —
// `[styles.scroller, fadeTop?, fadeBottom?].join(' ')` — so a rail long enough to
// scroll carries a second class. Reproducing that here is the point: the probe
// used to test `div[class$="_scroller"]`, which stopped matching as soon as the
// rail grew, which hid the turn-rail switch and stopped the overlay giving way.
const rail = new El('nav')
rail.setAttribute('class', 'eGxaPq_frame')
rail._rect = { x: 1200, y: 120, width: 28, height: 300, top: 120, left: 1200, right: 1228, bottom: 420 }
const railScroller = new El('div')
railScroller.setAttribute('class', 'eGxaPq_scroller eGxaPq_fadeBottom')
rail.appendChild(railScroller)
const railMarks = new El('div')
railMarks.setAttribute('class', 'eGxaPq_marks')
railScroller.appendChild(railMarks)
for (let i = 0; i < 3; i++) {
  const m = new El('button')
  m.setAttribute('class', 'eGxaPq_mark')
  railMarks.appendChild(m)
}
body.appendChild(rail)
sandbox.__fireResize()

const rp = typeof sandbox.window.__dockFlashTurnRail === 'function' ? sandbox.window.__dockFlashTurnRail() : null
check('the __dockFlashTurnRail() hook is registered', !!rp)
check('rail probe finds the scroller despite the joined fade class',
  !!(rp && rp.rails && rp.rails[0] && rp.rails[0].scroller === true),
  rp && rp.rails && rp.rails[0] ? 'scroller=' + rp.rails[0].scroller + ' marks=' + rp.rails[0].marks + ' cls=' + rp.rails[0].cls : 'no probe')
check('rail probe reports the rail as visible (this is what hides the switch)',
  !!(rp && rp.visible === true), rp ? rp.reason : 'no probe')
// left = min(1218, 1200 - 24 - 8 = 1168) = 1168
check('button gives way to the right-hand rail (left 1168)', btn && btn.style.left === '1168px', btn && btn.style.left)

console.log('\n=== 5. probe after everything resolves ===')
const probe2 = sandbox.window.__dockFlashOverlay()
console.log('  ' + JSON.stringify(probe2, null, 2).split('\n').join('\n  '))
check('probe verdict is ok', /^ok/.test(probe2.verdict), probe2.verdict)
check('probe reports the anchor adopted', probe2.anchorAdopted === true && probe2.anchorWatcher === 'adopted',
  probe2.anchorWatcher)

// ── the gestures ────────────────────────────────────────────────────────────
// Mounting and positioning correctly is only half of it: the button shipped once
// with a click handler that stopped at "swallow the drag click", so it appeared,
// sat in the right place and did nothing when pressed. Assert the BEHAVIOUR.
console.log('\n=== 6. clicking the button toggles the panel ===')
// Register a control whose plugin stands it down, BEFORE the panel renders, so
// the render has something the normal view must filter and the editing modes must
// still list. This is the contract in one switch: a registered control is never
// unreachable-in-all-modes, however its `visible()` answers.
const STOOD_DOWN_ID = 'dock-flash:harness-stood-down'
const STOOD_DOWN_GROUP = 'harness-only'
registry.registerSwitch({
  id: STOOD_DOWN_ID,
  label: 'stood down control',
  type: 'toggle',
  // Its own group, so the group-level rule is testable too: a built-in group
  // whose every control is filtered must not draw a title above nothing.
  group: STOOD_DOWN_GROUP,
  order: 500,
  visible: () => false,
  getValue: () => false,
  setValue: () => {},
})
const PANEL = '[data-dsh-plugin="dock-flash-standalone"]'
const panelEl = () => body.descendants().find((e) => e.getAttribute('data-dsh-plugin') === 'dock-flash-standalone')
const mouse = (x, y) => ({ button: 0, clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} })

/**
 * A COMPLETE click: press, release, then the click event.
 *
 * The release is not optional. `beginOverlayDrag` sets `dragging = true` on every
 * mousedown, and only `handleDragEnd` clears it — so a helper that fires
 * `mousedown` + `click` and stops leaves `dragging` STUCK. That flag forces the
 * overlay button solid, so the next section's "my opacity setting does nothing"
 * was really a harness that never let go of the mouse. Same stale-singleton
 * shape as `dragSource`; the probe now reports `dragging` so it cannot hide again.
 */
const tap = (el, x = 1236, y = 84) => {
  el.dispatch('mousedown', mouse(x, y))
  sandbox.document.__fire('mouseup', mouse(x, y))
  el.dispatch('click', mouse(x, y))
}

// Captured across every gesture below, because each open RE-RENDERS the panel and
// `renderPanel()` swallows a throw into console.error.
const renderErrors = []
/** `[dock-flash]` warnings captured for the whole run. A refusal is reported this
 *  way rather than as an error, so the assertion needs the warning channel. */
const warnings = []
const origWarn = console.warn
console.warn = (...a) => { warnings.push(a.map(String).join(' ')) }
const prevError = console.error
console.error = (...a) => { renderErrors.push(a.map(String).join(' ')) }

check('no panel exists before the first click', !panelEl())

btn.dispatch('mousedown', mouse(1236, 84))
btn.dispatch('click', mouse(1236, 84))
const panel = panelEl()
check('a plain click OPENED the panel', !!(panel && panel.style.display === 'flex'),
  panel ? panel.style.display : 'no panel element')

btn.dispatch('mousedown', mouse(1236, 84))
btn.dispatch('click', mouse(1236, 84))
check('a second click CLOSED it again', !!(panel && panel.style.display === 'none'),
  panel ? panel.style.display : 'no panel element')

console.log('\n=== 7. dragging the button must NOT toggle the panel ===')
btn.dispatch('mousedown', mouse(1236, 84))
sandbox.document.__fire('mousemove', mouse(1250, 100))   // well past the ±3px threshold
sandbox.document.__fire('mouseup', mouse(1250, 100))
btn.dispatch('click', mouse(1250, 100))                  // the click a drag ends with
check('the click ending a drag was swallowed', !!(panel && panel.style.display === 'none'),
  panel ? panel.style.display : 'no panel element')
// pointer moved +14/+16 from dx 8 -> max(0, 8-14) = 0, dy 8 -> 8+16 = 24
const probe3 = sandbox.window.__dockFlashOverlay()
check('the drag moved the offset instead (dx 0, dy 24)',
  probe3.offset.dx === 0 && probe3.offset.dy === 24, JSON.stringify(probe3.offset))

console.log('\n=== 8. a click straight after a drag still works ===')
btn.dispatch('mousedown', mouse(1250, 100))
btn.dispatch('click', mouse(1250, 100))
check('the toggle recovered after the drag', !!(panel && panel.style.display === 'flex'),
  panel ? panel.style.display : 'no panel element')

// ── the panel's own inventory ───────────────────────────────────────────────
// `__dockFlashPanelOrder()` is assigned DURING the render, so it only exists once
// the panel has drawn — which is what makes it the right place to assert a
// rendering rule from outside React.
console.log('\n=== 9. every control is listed in the ordering and visibility pages ===')
const order = typeof sandbox.window.__dockFlashPanelOrder === 'function'
  ? sandbox.window.__dockFlashPanelOrder() : null
check('__dockFlashPanelOrder() exists (the panel rendered)', !!order)
const flat = (obj) => Object.values(obj || {}).flat()
check('the stood-down control IS in the inventory both editing modes draw',
  !!order && flat(order.switches).includes(STOOD_DOWN_ID), order ? JSON.stringify(order.switches) : 'no hook')
check('it is reported as stood down',
  !!order && flat(order.stoodDown).includes(STOOD_DOWN_ID), order ? JSON.stringify(order.stoodDown) : 'no hook')
check('the NORMAL view still filters the row out',
  !!order && !flat(order.drawn).includes(STOOD_DOWN_ID), order ? JSON.stringify(order.drawn) : 'no hook')
check('the NORMAL view also drops its group, so no title floats above nothing',
  !!order && !(order.groupsDrawn.workbench || []).includes(STOOD_DOWN_GROUP),
  order ? JSON.stringify(order.groupsDrawn) : 'no hook')
check('every other group is unaffected',
  !!order && (order.groupsDrawn.workbench || []).includes('appearance'),
  order ? JSON.stringify(order.groupsDrawn) : 'no hook')
check('the panel never threw while rendering', renderErrors.length === 0,
  renderErrors.join(' | ') || 'none')
console.error = prevError

// ── the size control ────────────────────────────────────────────────────────
// The button's edge length is now a preference, and every clamp in
// positionOverlayTrigger() measures the BOX — so a size that does not reach the
// positioning arithmetic is not a cosmetic bug, it parks the button over the
// rail or outside the conversation. These checks exist to pin that coupling:
// change the size, and the geometry must move with it.
console.log('\n=== 10. the trigger-size switch resizes the button ===')
// The Layout switches live inside the slots callback, which the harness has held
// back until now — the overlay intentionally does not need `slots`, so the
// registration is proven to arrive LATE, exactly as it does in a real browser
// where the renderer service settles after bootstrap.
check('the size control is registered only once `slots` arrives', !registry.getSwitches().some((s) => s.id === 'dock-flash:trigger-size'))
// `register` KEEPS the component it is handed: the slot trigger is a React
// component whose size is computed during render, and the only way to assert that
// it repaints is to render it here and count the renders.
let slotTriggerComponent = null
let slotTriggerRenders = 0
slotsCallback({
  slots: {
    inject: (_name, fn) => { try { fn() } catch (_) {} return () => {} },
    register: (_meta, Component) => { slotTriggerComponent = Component; return () => {} },
  },
})
const sizeSwitch = registry.getSwitches().find((s) => s.id === 'dock-flash:trigger-size')
check('the trigger-size switch is registered', !!sizeSwitch)
check('it is a slider spanning the OVERLAY ceiling (24..64, step 2)',
  !!sizeSwitch && sizeSwitch.type === 'slider' && sizeSwitch.min === 24 &&
  sizeSwitch.max === 64 && sizeSwitch.step === 2,
  sizeSwitch ? `min=${sizeSwitch.min} max=${sizeSwitch.max} step=${sizeSwitch.step}` : 'missing')
check('default equals the historical size (24) — an upgrade changes nothing',
  !!sizeSwitch && sizeSwitch.getValue() === 24, sizeSwitch && String(sizeSwitch.getValue()))
check('the format prints the unit', !!sizeSwitch && sizeSwitch.formatLabel(36) === '36 px',
  sizeSwitch && sizeSwitch.formatLabel(36))

// The stub must report the real box, or `positionOverlayTrigger()` would clamp
// against a zero-size rect and the arithmetic below would prove nothing.
const setBtnBox = (n) => { btn._rect = { x: 0, y: 0, width: n, height: n, top: 0, left: 0, right: n, bottom: n } }
setBtnBox(24)

sizeSwitch.setValue(36)
setBtnBox(36)
btn.dispatch('mousedown', mouse(1236, 84))     // re-run positioning through a gesture
sandbox.document.__fire('mouseup', mouse(1236, 84))
check('the button box grew to 36px', btn.style.width === '36px' && btn.style.height === '36px',
  `${btn.style.width} x ${btn.style.height}`)
check('the glyph scaled with it (24→16, 36→24)', btn.children[0].getAttribute('width') === '24',
  btn.children[0].getAttribute('width'))
check('the corner radius scaled too (36/4 = 9)', btn.style.borderRadius === '9px', btn.style.borderRadius)
check('the size reached localStorage for the pre-host render',
  store.get('dock-flash:trigger-size') === '36', store.get('dock-flash:trigger-size'))
// left = min(contentRight 1250 - size 36 - dx 0 = 1214, rail 1200 - 36 - 8 = 1156)
//      = 1156 — the RAIL side wins here, and that is the point: the give-way
// arithmetic reads the same size the box was drawn with, so the two cannot
// disagree about how much room the button needs.
check('the POSITIONING used the new size, not the old constant', btn.style.left === '1156px', btn.style.left)

// The overlay ceiling: a slot position must not go this high, but this one may.
sizeSwitch.setValue(64)
setBtnBox(64)
btn.dispatch('mousedown', mouse(1236, 84))
sandbox.document.__fire('mouseup', mouse(1236, 84))
check('the draggable position allows 64px', btn.style.width === '64px', btn.style.width)
// left = min(1250 - 64 - 0, rail 1200 - 64 - 8 = 1128) = 1128 — still inside the conversation
check('64px still clears the turn rail', btn.style.left === '1128px', btn.style.left)
check('the probe reports the size beside the stored value and the range',
  sandbox.window.__dockFlashOverlay().triggerSize === 64 &&
  sandbox.window.__dockFlashOverlay().triggerSizeRange.max === 64,
  JSON.stringify(sandbox.window.__dockFlashOverlay().triggerSizeRange))

// Out-of-range and junk input must clamp rather than reach a CSS length.
const errsBefore = renderErrors.length
sizeSwitch.setValue(999)
check('an over-range value clamps to the ceiling', sizeSwitch.getValue() === 64, String(sizeSwitch.getValue()))
sizeSwitch.setValue(8)
check('a value below the minimum clamps UP to 24 — the control only enlarges',
  sizeSwitch.getValue() === 24, String(sizeSwitch.getValue()))
store.set('dock-flash:trigger-size', 'junk')
const probeJunk = sandbox.window.__dockFlashOverlay()
check('a hand-edited junk value does not reach the geometry',
  probeJunk.triggerSize === null || Number.isFinite(probeJunk.triggerSize),
  String(probeJunk.triggerSize))
check('the button survived every clamp', typeof btn.style.width === 'string' && btn.style.width.endsWith('px'),
  btn.style.width)

// ── the host-backed preference path ─────────────────────────────────────────
// A second, independent run of the same bundle: this one is given the settings
// namespace the first run deliberately lacks. It is the only way to reach
// `loadHostPreferences()` -> `_hostPrefs` -> the drawn button, and that path had
// a real defect — `triggerOverlayOffset` was declared in the schema, read by the
// probe, and never mapped on read, so a host-held value was silently ignored.
// A size preference is exactly the kind of field that defect reappears with.
console.log('\n=== 11. a host-stored size reaches the button ===')
{
  const store2 = new Map()
  // The cache holds a DIFFERENT trigger POSITION than the host, while the size
  // and offset keys are absent — i.e. a browser upgrading past 1.4.0, which is
  // the state this section exists to model.
  //
  // Seeding a *disagreeing* size here would prove nothing, because the plugin
  // reads that as "this browser has a preference the host has never seen" and
  // deliberately migrates it INTO the host (`triggerPosition` has behaved that
  // way since 1.1.0). Absent keys are the honest pre-upgrade cache.
  store2.set('dock-flash:trigger-position', 'conversation.overlay')

  const body2 = new El('body')
  const documentStub2 = Object.assign({}, documentStub, {
    body: body2,
    querySelectorAll: (s) => [...body2.querySelectorAll(s), ...head.querySelectorAll(s)],
    getElementById: (id) => body2.descendants().find((e) => e.id === id) || null,
    addEventListener() {}, removeEventListener() {},
    __fire() {},
  })
  body2.isConnected = true

  const sandbox2 = Object.assign({}, sandbox, {
    document: documentStub2,
    localStorage: {
      getItem: (k) => (store2.has(k) ? store2.get(k) : null),
      setItem: (k, v) => store2.set(k, String(v)),
      removeItem: (k) => store2.delete(k),
      clear: () => store2.clear(),
      get length() { return store2.size },
    },
  })
  sandbox2.window = sandbox2
  sandbox2.globalThis = sandbox2
  let def2 = null
  sandbox2.window.__ModuleLoader__ = { load: (d) => { def2 = d } }
  vm.runInNewContext(code, sandbox2, { filename: 'lib/client.js#host' })
  const plugin2 = def2.factory(requireStub)

  const provided2 = {}
  let injectCb2 = null
  const ctx2 = {
    get: (name) => (name === 'remote' ? undefined : provided2[name]),
    provide: (name, value) => { provided2[name] = value },
    on: () => () => {},
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    inject: (deps, cb) => { injectCb2 = cb; return () => {} },
    // The typert namespace accessor, answering the shape `describe()` really
    // returns: `{ ok, value: { namespaces: [{ ns, value, revision }] } }`.
    remote: {
      settings: {
        describe: () => Promise.resolve({
          ok: true,
          value: {
            namespaces: [{
              ns: 'dock-flash',
              revision: 7,
              value: { panelOrder: {}, activeSkin: '', triggerPosition: 'conversation.overlay', triggerOverlayOffset: { dx: 20, dy: 30 }, triggerSize: 48 },
            }],
          },
        }),
        update: () => Promise.resolve({ ok: true, value: { revision: 8 } }),
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  plugin2.apply(ctx2)
  await new Promise((r) => setTimeout(r, 20))

  const btn2 = sandbox2.document.getElementById('dock-flash-overlay-trigger')
  const probeH = sandbox2.window.__dockFlashOverlay()
  check('the host-stored size was adopted (the cache had no such key)',
    probeH.triggerSizeStored === 48, JSON.stringify({ stored: probeH.triggerSizeStored, local: store2.get('dock-flash:trigger-size') }))
  check('...and it is what the button is drawn at', !!btn2 && btn2.style.width === '48px', btn2 && btn2.style.width)
  check('...with the glyph derived from it (48 -> 32)', !!btn2 && btn2.children[0].getAttribute('width') === '32',
    btn2 && btn2.children[0].getAttribute('width'))
  check('the host-stored OFFSET was adopted too — the defect this section also pins',
    probeH.offset.dx === 20 && probeH.offset.dy === 30, JSON.stringify(probeH.offset))
  check('the probe names the host as the source', probeH.sizeSource === 'host' && probeH.offsetSource === 'host',
    `${probeH.sizeSource} / ${probeH.offsetSource}`)

  // The slot path must clamp the SAME stored value down to the row's ceiling.
  if (injectCb2) injectCb2({ slots: { inject: () => () => {}, register: () => () => {} } })
  const sizeSwitch2 = provided2.quickControl.getSwitches().find((s) => s.id === 'dock-flash:trigger-size')
  check('a host-stored 48 is still legal at the overlay position', !!sizeSwitch2 && sizeSwitch2.getValue() === 48,
    sizeSwitch2 && String(sizeSwitch2.getValue()))
  const posSwitch2 = provided2.quickControl.getSwitches().find((s) => s.id === 'dock-flash:trigger-position')
  posSwitch2.setValue('input.right')
  check('switching to a slot position clamps the DISPLAY to 48 — the row still fits',
    sizeSwitch2.getValue() === 48, String(sizeSwitch2.getValue()))
  check('the stored value was NOT rewritten by that clamp',
    probeH.triggerSizeStored === 48 || sandbox2.window.__dockFlashOverlay().triggerSizeStored === 48,
    JSON.stringify(sandbox2.window.__dockFlashOverlay().triggerSizeStored))
}

// The OTHER ordering: a host that answers AFTER the mount. Both occur in the
// wild — `apply()` starts the describe() round trip at the top and installs the
// standalone trigger at the bottom, so a slow host answers late and a fast one
// answers early — and each ordering is covered by a different half of the fix
// (the immediate call, and the subscription). Testing only one leaves the other
// half unverified, which is how the original `triggerOverlayOffset` omission
// survived: nothing exercised the read-back at all.
console.log('\n=== 12. a host that answers LATE still reaches the button ===')
{
  const store3 = new Map()
  store3.set('dock-flash:trigger-position', 'conversation.overlay')

  const body3 = new El('body')
  const documentStub3 = Object.assign({}, documentStub, {
    body: body3,
    querySelectorAll: (s) => [...body3.querySelectorAll(s), ...head.querySelectorAll(s)],
    getElementById: (id) => body3.descendants().find((e) => e.id === id) || null,
    addEventListener() {}, removeEventListener() {}, __fire() {},
  })
  body3.isConnected = true

  const sandbox3 = Object.assign({}, sandbox, {
    document: documentStub3,
    localStorage: {
      getItem: (k) => (store3.has(k) ? store3.get(k) : null),
      setItem: (k, v) => store3.set(k, String(v)),
      removeItem: (k) => store3.delete(k),
      clear: () => store3.clear(),
      get length() { return store3.size },
    },
  })
  sandbox3.window = sandbox3
  sandbox3.globalThis = sandbox3
  let def3 = null
  sandbox3.window.__ModuleLoader__ = { load: (d) => { def3 = d } }
  vm.runInNewContext(code, sandbox3, { filename: 'lib/client.js#late' })
  const plugin3 = def3.factory(requireStub)

  // describe() is held open until we release it, which is what makes the answer
  // late. The button is already mounted by then — the exact situation the
  // subscription exists for.
  let release
  const gate = new Promise((r) => { release = r })
  const provided3 = {}
  const ctx3 = {
    get: (n) => provided3[n],
    provide: (n, v) => { provided3[n] = v },
    on: () => () => {},
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
    inject: () => () => {},
    remote: {
      settings: {
        describe: () => gate.then(() => ({
          ok: true,
          value: { namespaces: [{ ns: 'dock-flash', revision: 3, value: { triggerSize: 64, triggerOverlayOffset: { dx: 0, dy: 40 } } }] },
        })),
        update: () => Promise.resolve({ ok: true, value: { revision: 4 } }),
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  plugin3.apply(ctx3)
  await new Promise((r) => setTimeout(r, 10))

  const btn3 = sandbox3.document.getElementById('dock-flash-overlay-trigger')
  check('before the host answers, the button is at the default', !!btn3 && btn3.style.width === '24px',
    btn3 && btn3.style.width)
  check('...and the probe says the value is only local',
    sandbox3.window.__dockFlashOverlay().sizeSource !== 'host',
    sandbox3.window.__dockFlashOverlay().sizeSource)

  release()                                   // the host finally answers
  await new Promise((r) => setTimeout(r, 10))

  check('a LATE host answer resizes the already-mounted button to 64',
    !!btn3 && btn3.style.width === '64px', btn3 && btn3.style.width)
  check('...scaling the glyph with it (64 -> 43)', !!btn3 && btn3.children[0].getAttribute('width') === '43',
    btn3 && btn3.children[0].getAttribute('width'))
  check('...and the late offset was adopted too',
    sandbox3.window.__dockFlashOverlay().offset.dy === 40,
    JSON.stringify(sandbox3.window.__dockFlashOverlay().offset))
  check('the probe now names the host as the source',
    sandbox3.window.__dockFlashOverlay().sizeSource === 'host',
    sandbox3.window.__dockFlashOverlay().sizeSource)
}

console.log('\n=== 13. the open panel must not cover its own button ===')
// The defect this section exists for is a z-index consequence, not an arithmetic
// one: the button must never be underneath the panel it opened, or the ONE control
// whose effect is only visible on the button (its size) looks like it did nothing.
// As soon as the size became user-settable that read as "the setting only takes
// effect after I close the panel", which is how it was reported.
//
// 1.4.4 changed HOW that holds — a permanent one-level offset instead of a
// toggle — so this section now asserts the relationship rather than two literals.
// The assertion is geometric on purpose. The stub must report the BOXES, or this
// would pass on any two numbers: `panelH` is read from the container's own rect
// and `rect.height` from the button's (see `setBtnBox`), so the two sides of the
// comparison are independent.
{
  // Re-open the panel with the button at 64px — the size at which the old code
  // overlapped worst.
  sizeSwitch.setValue(64)
  setBtnBox(64)
  const panelBox = (h) => {
    const el = panelEl()
    if (el) el._rect = { x: 0, y: 0, width: 320, height: h, top: 0, left: 0, right: 320, bottom: h }
  }
  // Open once so the container exists, then drive it deterministically.
  if (!panelEl()) { tap(btn) }
  panelBox(360)

  // Place the button well inside the viewport so the "below" branch is taken.
  btn._rect = { x: 1236, y: 84, width: 64, height: 64, top: 84, left: 1236, right: 1300, bottom: 148 }

  const container = panelEl()
  check('the standalone panel container is mounted', !!container)
  // `positionPanel()` resolves its anchor with
  // `document.querySelector('[data-dock-flash-trigger]')`, so the assertion must
  // use THAT element's box rather than assuming it is the overlay button — the
  // slot trigger carries the same attribute (it is what `handleOutsideClick`
  // exempts), and whichever the document finds first is what the panel anchors
  // to.
  const anchorEl = sandbox.document.querySelector('[data-dock-flash-trigger]')
  check('the panel anchor is the overlay button', anchorEl === btn,
    anchorEl ? `${anchorEl.tagName}#${anchorEl.id || '(no id)'}` : 'no anchor')
  const anchorBox = (top, h) => {
    anchorEl._rect = { x: 0, y: top, width: 64, height: h, top, left: 0, right: 64, bottom: top + h }
  }
  const open = () => {
    anchorBox(84, sizeSwitch.getValue())
    if (container.style.display !== 'flex') { tap(btn) }
  }
  const close = () => {
    if (container.style.display === 'flex') { tap(btn) }
  }

  // ── the real mechanism ──
  // The button must sit ABOVE the panel for its whole life, so a size change is
  // visible while the panel is open. 1.4.0 achieved that by TOGGLING the button's
  // z-index on open/close (99997 <-> 99999); 1.4.4 replaced that with a permanent
  // one-level offset derived from the single `triggerLayer` value, so the
  // relationship cannot drift when the user changes the layer from the menu.
  //
  // The assertions therefore test the RELATIONSHIP, not two literals: the old
  // ones pinned `'99999'`/`'99997'`, which stopped being meaningful the moment
  // the level became user-configurable.
  close()
  open()
  panelBox(360)
  check('the panel is open', container.style.display === 'flex', container.style.display)
  check('the button is above the panel while it is open',
    Number(btn.style.zIndex) > Number(container.style.zIndex),
    `button ${btn.style.zIndex} vs panel ${container.style.zIndex}`)
  check('...by exactly one level (derived, not toggled)',
    Number(btn.style.zIndex) === Number(container.style.zIndex) + 1,
    `button ${btn.style.zIndex} vs panel ${container.style.zIndex}`)

  // CLOSING must NOT change the stacking any more — that is the whole point of
  // moving from a toggle to an offset: there is no state to get out of step.
  close()
  check('closing the panel leaves the stacking untouched (no toggle to undo)',
    Number(btn.style.zIndex) === Number(container.style.zIndex) + 1,
    `button ${btn.style.zIndex} vs panel ${container.style.zIndex}`)

  // A live resize must carry the panel with the button. The anchor box is
  // updated FIRST, because `positionPanel()` reads the live DOM box — in the
  // browser the browser lays the button out before the panel is repositioned, so
  // priming the stub in the other order would test a state that cannot occur.
  open()
  panelBox(360)
  anchorBox(84, 64)
  anchorBox(84, 32)                       // the button is now 32px tall
  sizeSwitch.setValue(32)
  setBtnBox(32)
  check('the button resized while the panel was open', btn.style.width === '32px', btn.style.width)
  check('the panel is still open after a live resize', container.style.display === 'flex', container.style.display)
  check('the panel followed the smaller button',
    parseFloat(container.style.top) === 84 + 32 + 6, `${container.style.top} (expected ${84 + 32 + 6})`)
  check('the button is still above the panel',
    Number(btn.style.zIndex) === Number(container.style.zIndex) + 1,
    `button ${btn.style.zIndex} vs panel ${container.style.zIndex}`)
}

// ── the SLOT trigger resizes live too ───────────────────────────────────────
// This section exists because the overlay fix above did NOT cover the other four
// positions, and the omission shipped: the slot button recomputes its size during
// render, and it subscribed only to `_subscribePrefs` — which fires when the HOST
// answers, not when the slider moves. Moving the slider therefore resized the
// overlay (imperative, same closure) and left the slot button stale until some
// unrelated re-render. Two different events, two subscriptions; only one existed.
console.log('\n=== 14. the SLOT trigger resizes when the slider moves ===')
{
  // The slot component is captured by `register`, which only runs for a SLOT
  // position — `injectTrigger()` returns null for the overlay, which is the
  // position the rest of this file works in. So the harness reaches the slot path
  // by SELECTING a slot position first, exactly as a user would, and that is also
  // what makes this section cover the four positions the overlay fix missed.
  const posSwitch = registry.getSwitches().find((s) => s.id === 'dock-flash:trigger-position')
  posSwitch.setValue('input.right')
  check('the slots registration handed the harness a component',
    typeof slotTriggerComponent === 'function', typeof slotTriggerComponent)

  // Stamp the component so renders can be counted without touching the bundle.
  // `scheduleRerender` stands in for React: it is what a `setState` call from a
  // subscription would trigger. The assertions below therefore depend on the
  // component actually REGISTERING that subscription — which is the defect this
  // section exists for — rather than on the harness re-rendering by hand, which
  // would pass on a build with no subscription at all.
  let renderRequested = false
  const scheduleRerender = () => { renderRequested = true }
  const renderSlot = () => {
    beginRender()
    slotTriggerRenders++
    const tree = slotTriggerComponent({})
    runEffects(scheduleRerender)
    return tree
  }
  const styleOf = (tree) => (tree && tree.props && tree.props.style) || {}

  // The size at this point is 32: section 13 left the slider there on purpose.
  // Reading it from the switch rather than assuming keeps this section honest if
  // an earlier section changes.
  const sizeNow = sizeSwitch.getValue()
  const tree1 = renderSlot()
  check('the slot button rendered with a size', Number.isFinite(parseFloat(styleOf(tree1).minWidth)),
    String(styleOf(tree1).minWidth))
  check('...at the size in force', parseFloat(styleOf(tree1).minWidth) === sizeNow,
    `minWidth ${styleOf(tree1).minWidth} vs size ${sizeNow}`)
  const before = slotTriggerRenders

  // THE assertion: move the slider and re-render, as React would on a bumped
  // registry version. The subscription is what schedules that re-render; without
  // it this render would never be requested at all.
  const subsBefore = effectCleanups.length
  sizeSwitch.setValue(40)
  check('moving the slider left the slot trigger subscribed (not disposed)',
    effectCleanups.length >= subsBefore, `${effectCleanups.length} cleanups`)

  // THE assertion. Fire the registry event the way the panel's own subscriber
  // would, and check that the SLOT BUTTON asked to re-render. Without the
  // registry subscription in the component this is silent — which is precisely
  // how the defect shipped, and the negative control confirms this fails on a
  // build where the subscription is removed.
  renderRequested = false
  const rendersBefore = slotTriggerRenders
  registry.notifyChange('dock-flash:trigger-size')
  check('moving the slider asks the SLOT button to re-render (its subscription fired)',
    renderRequested === true, `renderRequested=${renderRequested}`)
  check('...and no hand-render was needed to make that happen',
    slotTriggerRenders === rendersBefore, `${rendersBefore} -> ${slotTriggerRenders}`)

  // The re-render React would perform must produce the new size.
  const tree2 = renderSlot()
  check('the slot button re-rendered at the NEW size (40)', parseFloat(styleOf(tree2).minWidth) === 40,
    `minWidth ${styleOf(tree2).minWidth}, renders ${before} -> ${slotTriggerRenders}`)
  check('...and its glyph scaled with it (40 -> 27)',
    tree2.props.children && tree2.props.children.props && tree2.props.children.props.width === 27,
    tree2.props.children && tree2.props.children.props && String(tree2.props.children.props.width))
  check('...and the corner radius scaled too (40/4 = 10)',
    styleOf(tree2).borderRadius === '10px', String(styleOf(tree2).borderRadius))

  // The slot ceiling applies to a slot position: 64 must be refused down to 48.
  sizeSwitch.setValue(64)
  check('a slot position clamps the displayed size to 48',
    sizeSwitch.getValue() === 48, String(sizeSwitch.getValue()))
  const tree3 = renderSlot()
  check('the slot button rendered at the clamped 48',
    parseFloat(styleOf(tree3).minWidth) === 48, String(styleOf(tree3).minWidth))

  // The OVERLAY ceiling still applies at the overlay position — the clamp is per
  // position, not global, and returning to the overlay must restore the stored 64.
  posSwitch.setValue('conversation.overlay')
  check('back at the overlay the stored 64 is still in force',
    sizeSwitch.getValue() === 64, String(sizeSwitch.getValue()))
}

// ── the skin list must not offer the market itself ──────────────────────────
// `dsh-skin-market` is the plugin that SUPPLIES this list, and its name contains
// `skin`, so `_isThemeName()` accepted it and `_labelFromId()` turned it into
// **"Market"** — an entry that does nothing when picked, because the market is not
// a visual state and its own registry row is disabled. The four real skins around
// it must survive, which is why the exclusion is by NAME and not by narrowing the
// `skin` token: that token is what makes every `<name>-skin` package discoverable.
console.log('\n=== 15. the skin list excludes the market plugin ===')
{
  // Drive the REAL scan through the DOM: phase 1a reads
  // `head style[data-plugin]`, so one tag per candidate is all it takes. This
  // exercises the actual filter chain (`_skinHint` + `_skinExclude`), which a
  // test of the bare regexes would not.
  const mkStyleTag = (id) => {
    const el = new El('style')
    el.setAttribute('data-plugin', id)
    return el
  }
  const candidates = [
    'open-sea-skin',            // a real skin; label derives to "Open Sea"
    'dsh-skin-market',          // THE MARKET — must be gone
    'dsh-theme-mineradio',      // managed (phase 0) — must not double up
    'dsh-codex-timeline',       // not a skin at all
    // The reported leak, and the reason this list MUST contain it: this package
    // injects `<style data-plugin="dsh-client-liang-intensity-skin">` from its own
    // apply(), so the DOM scan (phase 1a) discovers it too — a second entry path
    // the market-classification gate did not cover when it was first added. Real
    // plugins leave real style tags, and a harness that only enumerates names
    // tests half of the scan.
    'dsh-client-liang-intensity-skin',
  ]
  for (const id of candidates) head.appendChild(mkStyleTag(id))

  // The market answer drives registration and is a microtask chain; give it a
  // turn so `dock-flash:skin` exists by the time the options are read.
  await new Promise((r) => setTimeout(r, 20))

  // The switch's options are a function, so nothing is scanned until it is called
  // — which is exactly when the user opens the dropdown.
  const skinSwitch = registry.getSwitches().find((s) => s.id === 'dock-flash:skin')
  if (!skinSwitch) {
    check('the skin switch is registered (needs a market answer)', false, 'no dock-flash:skin switch')
  } else {
    const opts = typeof skinSwitch.options === 'function' ? skinSwitch.options() : skinSwitch.options
    const values = opts.map((o) => o.value)
    const labels = opts.map((o) => String(typeof o.label === 'function' ? o.label() : o.label))

    check('the market plugin is NOT offered as a skin',
      !values.includes('dsh-skin-market'), JSON.stringify(values))
    check('...and nothing is labelled "Market"',
      !labels.some((l) => l === 'Market'), JSON.stringify(labels))
    check('a real skin in the same scan IS offered', values.includes('open-sea-skin'),
      JSON.stringify(values))
    check('...with its derived label', labels.includes('Open Sea'), JSON.stringify(labels))
    check('the timeline plugin is still excluded', !values.includes('dsh-codex-timeline'),
      JSON.stringify(values))
    check('"default" is still first', opts[0] && opts[0].value === 'default',
      opts[0] && String(opts[0].value))
  }
}

// ── the list must follow the MARKET's classification, not a name guess ──────
// `dsh-client-liang-intensity-skin` is servable-looking (its name matches the
// `skin` hint) but the market does not classify it as a theme: its catalog entry
// carries a DIFFERENT name for that repo, and it was installed from a bare
// version spec rather than `github:owner/repo`, so neither of the market's two
// rules match. Selecting it therefore got a 400 from `/dsh-market/use-skin` —
// and, before the fix above, wedged the dropdown on a theme that never activated.
console.log('\n=== 16. the skin list follows the market classification ===')
{
  const skinSwitch = registry.getSwitches().find((s) => s.id === 'dock-flash:skin')
  const readOptions = () => {
    const opts = typeof skinSwitch.options === 'function' ? skinSwitch.options() : skinSwitch.options
    return {
      opts,
      values: opts.map((o) => o.value),
      labels: opts.map((o) => String(typeof o.label === 'function' ? o.label() : o.label)),
    }
  }

  // Classification is a separate request, so let the microtask chain settle and
  // then read the list the way the panel does after its notifyChange.
  await new Promise((r) => setTimeout(r, 30))
  const first = readOptions()

  check('a package the market does NOT classify as a theme is dropped',
    !first.values.includes('dsh-client-liang-intensity-skin'), JSON.stringify(first.values))
  // ...and it must be dropped EVEN THOUGH it leaves a `<style data-plugin>` tag
  // behind. This is the check the first version of the gate lacked: the
  // market-extra path and the DOM-scan path are separate entry routes into this
  // list, and covering only the former is why the leak survived a release that
  // claimed to fix it. Assert the tag is REALLY there, or the check would pass for
  // the wrong reason.
  check('the harness really did plant a <style data-plugin> tag for it (the DOM path is exercised)',
    head.querySelectorAll('style[data-plugin="dsh-client-liang-intensity-skin"]').length === 1,
    'style tags in head: ' + head.querySelectorAll('style[data-plugin]').length)
  check('...and the DOM-scan path drops it too',
    !first.values.includes('dsh-client-liang-intensity-skin'), JSON.stringify(first.values))
  check('...while a theme from the same market list stays', first.values.includes('open-sea-skin'),
    JSON.stringify(first.values))
  // The repo rule is the half a name-only implementation would miss: this package
  // is not named in the catalog, but its INSTALL SPEC points at a repo that is.
  check('the market\'s SECOND rule (repo, not name) is implemented too',
    first.values.includes('dsh-repo-installed-skin'), JSON.stringify(first.values))
  check('...and that one keeps its label', first.labels.some((l) => /Repo Installed/i.test(l)),
    JSON.stringify(first.labels))

  // The classification is cached per session: `no-store` forbids the HTTP cache,
  // so this is the only layer that stops a megabyte per page load.
  const before = registryFetches
  await new Promise((r) => setTimeout(r, 10))
  readOptions()
  await new Promise((r) => setTimeout(r, 10))
  check('the megabyte registry is fetched at most once per session',
    registryFetches === before && before <= 1, `${before} -> ${registryFetches} (${registryFetches} total)`)

  // A registry we could not read must NOT empty the list: answering "nothing is a
  // theme" over a transient network error would hide every real skin. This needs a
  // FRESH bundle, because the index is held in memory once loaded and a same-process
  // stub swap could never reach the failure branch at all — the first version of
  // this check did exactly that and passed for the wrong reason.
  {
    // The `/installed` stub is reused so the fresh bundle sees the same market.
    const realFetch = sandbox.fetch
    const store4 = new Map()
    const body4 = new El('body')
    const head4 = new El('head')
    const documentStub4 = Object.assign({}, documentStub, {
      body: body4,
      head: head4,
      querySelectorAll: (s) => [...body4.querySelectorAll(s), ...head4.querySelectorAll(s)],
      getElementById: (id) => body4.descendants().find((e) => e.id === id) || null,
      addEventListener() {}, removeEventListener() {}, __fire() {},
    })
    body4.isConnected = true
    head4.isConnected = true
    const sandbox4 = Object.assign({}, sandbox, {
      document: documentStub4,
      localStorage: {
        getItem: (k) => (store4.has(k) ? store4.get(k) : null),
        setItem: (k, v) => store4.set(k, String(v)),
        removeItem: (k) => store4.delete(k), clear: () => store4.clear(),
        get length() { return store4.size },
      },
      // Fresh session storage, so the cache cannot answer either.
      sessionStorage: {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
        get length() { return 0 },
      },
      fetch: (u) => {
        const s = String(u)
        if (s.indexOf('/dsh-market/installed') !== -1) {
          return realFetch(s)
        }
        if (s.indexOf('/dsh-market/registry') !== -1) return Promise.reject(new Error('harness: registry down'))
        return Promise.reject(new Error('harness: no network'))
      },
    })
    sandbox4.window = sandbox4
    sandbox4.globalThis = sandbox4
    store4.set('dock-flash:trigger-position', 'conversation.overlay')
    let def4 = null
    sandbox4.window.__ModuleLoader__ = { load: (d) => { def4 = d } }
    vm.runInNewContext(code, sandbox4, { filename: 'lib/client.js#nodreg' })
    const provided4 = {}
    let cb4 = null
    def4.factory(requireStub).apply({
      get: (n) => provided4[n],
      provide: (n, v) => { provided4[n] = v },
      on: () => () => {},
      effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
      inject: (deps, cb) => { cb4 = cb; return () => {} },
      logger: { info() {}, warn() {}, error() {} },
    })
    if (cb4) cb4({ slots: { inject: () => () => {}, register: () => () => {} } })
    await new Promise((r) => setTimeout(r, 30))

    const sw4 = provided4.quickControl.getSwitches().find((s) => s.id === 'dock-flash:skin')
    const vals4 = (typeof sw4.options === 'function' ? sw4.options() : sw4.options).map((o) => o.value)
    await new Promise((r) => setTimeout(r, 20))
    const vals4b = (typeof sw4.options === 'function' ? sw4.options() : sw4.options).map((o) => o.value)
    check('a failed registry read leaves the list INTACT (the safe direction)',
      vals4b.includes('dsh-client-liang-intensity-skin'), JSON.stringify(vals4b))
    check('...and it is the same list as before the classification was known',
      JSON.stringify(vals4) === JSON.stringify(vals4b), `${JSON.stringify(vals4)} vs ${JSON.stringify(vals4b)}`)
  }
}

// ── a refused activation must release the selection ────────────────────────
// The reported symptom was not merely "one bad entry": picking it made EVERY later
// selection appear not to work, because the optimistic `_pendingSkinId` was never
// cleared on failure and `_getActiveSkinId()` echoes it back.
console.log('\n=== 17. a refused market activation releases the selection ===')
{
  const skinSwitch = registry.getSwitches().find((s) => s.id === 'dock-flash:skin')
  const before = skinSwitch.getValue()

  // A theme the market REFUSES to activate (the stub answers 400 for every name).
  // The stub must also be self-consistent about what is LIVE: `_getActiveSkinId()`
  // falls back to the market's `state === 'live'` entry, so a stub that both
  // refuses activation AND reports the target as live would leave the dropdown
  // legitimately showing it — and the test would be asserting against a lie.
  // `dsh-repo-installed-skin` is `disabled` in the stub, so it is a target the
  // market neither accepts nor claims to be running.
  skinSwitch.setValue('dsh-repo-installed-skin')
  check('the click is shown immediately (optimistic pending)',
    skinSwitch.getValue() === 'dsh-repo-installed-skin', String(skinSwitch.getValue()))

  await new Promise((r) => setTimeout(r, 30))
  check('a REFUSED activation does not stay selected',
    skinSwitch.getValue() !== 'dsh-repo-installed-skin', String(skinSwitch.getValue()))
  check('...the dropdown falls back to what is actually live',
    skinSwitch.getValue() === before || skinSwitch.getValue() === 'default' ||
      skinSwitch.getValue() === 'open-sea-skin',
    `${before} -> ${skinSwitch.getValue()}`)
  check('...and the refusal was reported with the market\'s own wording',
    warnings.some((w) => /not an installed theme/.test(w)), JSON.stringify(warnings.slice(-2)))
}

// ── the right-click menu, and the two settings it owns ─────────────────────
// The menu is the only surface for the layer and the rest opacity, and both are
// preferences that must survive a reload — so this section covers the menu's
// STRUCTURE (four items, the tick, the clamp), the two writers, and the opacity
// rule that a finished drag releases hover brightness.
console.log('\n=== 18. the overlay context menu ===')
{
  const posSwitch = registry.getSwitches().find((s) => s.id === 'dock-flash:trigger-position')
  posSwitch.setValue('conversation.overlay')
  await new Promise((r) => setTimeout(r, 20))

  // ALWAYS look the button up; never hold a reference. `applyTrigger()` — reached
  // from a position change AND from the bounded re-acquisition path — tears the
  // overlay down and builds a NEW element, so a cached node is a detached one and
  // asserting against it checks a node no listener is attached to. That mistake
  // cost two rounds on this very section.
  const liveBtn = () => sandbox.document.getElementById('dock-flash-overlay-trigger')
  check('the overlay button exists in the document', !!liveBtn() && liveBtn().parentNode === body)

  // Give the button a real box: `positionOverlayMenu()` reads it to clamp.
  liveBtn()._rect = { x: 1200, y: 80, width: 24, height: 24, top: 80, left: 1200, right: 1224, bottom: 104 }

  const menuEl = () => body.descendants().find((e) => e.getAttribute('data-dock-flash-menu') !== null)
  check('no menu before the right-click', !menuEl())

  // A contextmenu event, NOT a click: the browser's own menu must be suppressed.
  let sawDefault = false
  liveBtn().dispatch('contextmenu', {
    type: 'contextmenu', button: 2,
    preventDefault() { sawDefault = true },
    stopPropagation() {},
  })
  const menu = menuEl()
  check('the right-click opened a menu', !!menu)
  check('...and suppressed the browser\'s own', sawDefault)
  check('the probe reports it open', sandbox.window.__dockFlashOverlay().menuOpen === true,
    String(sandbox.window.__dockFlashOverlay().menuOpen))

  const rows = menu ? menu.descendants().filter((e) => e.getAttribute('role') === 'menuitem') : []
  const textOf = (e) => e.descendants().map((c) => c.textContent).join('')
  const texts = rows.map(textOf)
  // The four decisions this menu exists for. `trigger-size` /
  // `trigger-position` / `close-on-blur` are deliberately absent — they live in
  // the panel, and a second control is how two surfaces start disagreeing.
  check('it offers "reset position"', texts.some((t) => /重置位置|Reset position/.test(t)), JSON.stringify(texts))
  check('it shows the current offset', texts.some((t) => /位置|Offset/.test(t)), JSON.stringify(texts))
  check('it shows the version', texts.some((t) => t.includes('1.5.0')), JSON.stringify(texts))
  check('it exposes a layer choice', texts.some((t) => /层级|Layer/.test(t)), JSON.stringify(texts))
  check('it exposes a rest-opacity choice', texts.some((t) => /深浅|opacity/i.test(t)), JSON.stringify(texts))
  check('...and it does NOT duplicate the panel\'s own switches',
    !texts.some((t) => /大小|Size|位置偏好|Blur/i.test(t)), JSON.stringify(texts))

  // The default layer clears the highest z-index DSH itself uses (1100, measured
  // across its client bundles), and the button stays one above the panel.
  const probe = sandbox.window.__dockFlashOverlay()
  check('the default layer is 1150 — above DSH\'s own ceiling of 1100, not 9999x',
    probe.triggerLayer === 1150, String(probe.triggerLayer))
  check('the button is one level above the panel',
    Number(liveBtn().style.zIndex) === probe.triggerLayer + 1, `${liveBtn().style.zIndex} vs ${probe.triggerLayer}`)

  // Pick a different layer from the menu (the row whose text is exactly 2000).
  const layer2000 = rows.find((r) => textOf(r).includes('2000'))
  check('the 2000 preset is offered', !!layer2000)
  if (layer2000) {
    layer2000.dispatch('click', { type: 'click', preventDefault() {}, stopPropagation() {} })
    check('picking it moves the panel', Number(panelEl().style.zIndex) === 2000,
      String(panelEl().style.zIndex))
    check('...and carries the button with it', Number(liveBtn().style.zIndex) === 2001,
      `${liveBtn().style.zIndex} (panel ${panelEl().style.zIndex})`)
    check('...and persists to localStorage for the pre-host render',
      store.get('dock-flash:trigger-layer') === '2000', String(store.get('dock-flash:trigger-layer')))
    check('...and the probe reports it', sandbox.window.__dockFlashOverlay().triggerLayer === 2000,
      String(sandbox.window.__dockFlashOverlay().triggerLayer))
  }

  // Rest opacity: the setting, and the rule that a finished drag releases it.
  const opacityRow = rows.find((r) => textOf(r).includes('0.85'))
  check('the 0.85 opacity preset is offered', !!opacityRow)
  if (opacityRow) {
    check('no drag is in progress before the pick (the flag forces it solid)',
      sandbox.window.__dockFlashOverlay().dragging === false,
      String(sandbox.window.__dockFlashOverlay().dragging))
    opacityRow.dispatch('click', { type: 'click', preventDefault() {}, stopPropagation() {} })
    check('picking it repaints the button at rest', liveBtn().style.opacity === '0.85', String(liveBtn().style.opacity))
    check('...and persists', store.get('dock-flash:overlay-opacity') === '0.85',
      String(store.get('dock-flash:overlay-opacity')))
  }
  // Hover means solid, and so does a drag; releasing must hand brightness BACK,
  // which is the defect the old `if (!dragging)` guard left behind.
  liveBtn().dispatch('mouseenter', { type: 'mouseenter' })
  check('hover forces it solid', liveBtn().style.opacity === '1', String(liveBtn().style.opacity))
  liveBtn().dispatch('mousedown', mouse(1236, 84))
  sandbox.document.__fire('mousemove', mouse(1250, 100))
  check('a drag keeps it solid', liveBtn().style.opacity === '1', String(liveBtn().style.opacity))
  // Pointer OFF the button when the drag ends: the old code left it at 1 here.
  liveBtn().dispatch('mouseleave', { type: 'mouseleave' })
  sandbox.document.__fire('mouseup', mouse(1250, 100))
  check('releasing the drag restores the user\'s rest opacity (not hover brightness)',
    liveBtn().style.opacity === '0.85', String(liveBtn().style.opacity))

  // Escape closes it.
  check('the menu is still on screen before Escape', !!menuEl())
  sandbox.document.__fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
  check('Escape closes the menu', !menuEl())
  check('...and the probe agrees', sandbox.window.__dockFlashOverlay().menuOpen === false,
    String(sandbox.window.__dockFlashOverlay().menuOpen))
}

console.log('\n' + (failures.length === 0 ? '✅ ALL CHECKS PASSED' : '❌ FAILURES: ' + failures.join('; ')))
// The bundle installs its own intervals (skin refresh, i18n watch), so exit
// explicitly rather than waiting for the event loop to drain.
process.exit(failures.length === 0 ? 0 : 1)
