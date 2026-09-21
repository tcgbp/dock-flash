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
  get textContent() { return this._text }
  set textContent(v) { this._text = String(v); this.children.length = 0 }
  get innerHTML() { return this._html || '' }
  set innerHTML(v) { this._html = String(v); if (!v) this.children.length = 0 }
  setAttribute(k, v) { this._attrs.set(k, String(v)) }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null }
  hasAttribute(k) { return this._attrs.has(k) }
  removeAttribute(k) { this._attrs.delete(k) }
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
  const m = /^([a-zA-Z]*)(?:\[([\w-]+)(?:([*$^]?)=["']([^"']*)["'])?\])?$/.exec(sel.trim())
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
  localStorage: localStorageStub,
  navigator: { userAgent: 'harness', language: 'zh-CN', languages: ['zh-CN'] },
  location: { href: 'http://127.0.0.1:3080/', origin: 'http://127.0.0.1:3080', search: '', hostname: '127.0.0.1' },
  fetch: () => Promise.reject(new Error('harness: no network')),
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
check('probe reports the build version first', probe1.clientVersion === '1.4.0', probe1.clientVersion)
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

// Captured across every gesture below, because each open RE-RENDERS the panel and
// `renderPanel()` swallows a throw into console.error.
const renderErrors = []
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
// one: the panel is 99998 and the button 99997, so ANY overlap hides the button —
// and the button is what toggled the panel open. At the old fixed 6px gap the
// panel's top edge sat inside the 24px button and the overlap was easy to miss;
// as soon as the size became user-settable it read as "the size only takes effect
// after I close the panel", which is exactly how it was reported.
//
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
  if (!panelEl()) { btn.dispatch('mousedown', mouse(1236, 84)); btn.dispatch('click', mouse(1236, 84)) }
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
    if (container.style.display !== 'flex') { btn.dispatch('mousedown', mouse(1236, 84)); btn.dispatch('click', mouse(1236, 84)) }
  }
  const close = () => {
    if (container.style.display === 'flex') { btn.dispatch('mousedown', mouse(1236, 84)); btn.dispatch('click', mouse(1236, 84)) }
  }

  // ── the real mechanism ──
  // The panel is 99998 and the button 99997, so the panel DOES sit over the
  // button's corner — that is by design, and it is why the new size looked like
  // it only took effect after closing the panel. The fix is not to move the panel
  // (`rect.bottom + 6` already cleared the button) but to lift the button above
  // the panel for as long as the panel is open.
  close()
  open()
  panelBox(360)
  check('the panel is open', container.style.display === 'flex', container.style.display)
  check('while OPEN the button is lifted above the panel',
    String(btn.style.zIndex) === '99999', String(btn.style.zIndex))
  check('...so a size change is visible immediately, not after closing',
    btn.style.zIndex > (container.style.zIndex || 99998), `${btn.style.zIndex} vs ${container.style.zIndex || 99998}`)

  // The lift is scoped to "open": leaving it raised would put the button over the
  // panel's own header permanently.
  close()
  check('closing the panel lowers the button again',
    String(btn.style.zIndex) === '99997', String(btn.style.zIndex))

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
  check('the button is still above the panel', String(btn.style.zIndex) === '99999', String(btn.style.zIndex))
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

console.log('\n' + (failures.length === 0 ? '✅ ALL CHECKS PASSED' : '❌ FAILURES: ' + failures.join('; ')))
// The bundle installs its own intervals (skin refresh, i18n watch), so exit
// explicitly rather than waiting for the event loop to drain.
process.exit(failures.length === 0 ? 0 : 1)
