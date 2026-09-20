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

const ReactStub = {
  createElement: (type, props, ...kids) => ({
    $$typeof: Symbol.for('react.element'), type, props: { ...(props || {}), children: kids.length <= 1 ? kids[0] : kids },
  }),
  Component: class { constructor(p) { this.props = p || {}; this.state = {} } setState(s) { Object.assign(this.state, s) } render() { return null } },
  // React calls a lazy initialiser; the panel relies on that (`useState(() => new Set(…))`),
  // so a stub that returned the function itself made `openTabs.has` throw.
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (f) => f,
  useRef: (v) => ({ current: v }),
  useMemo: (f) => f(),
  createContext: (v) => ({ Provider: null, Consumer: null, _currentValue: v }),
  Fragment: 'Fragment',
  memo: (f) => f,
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
  inject: (deps) => { injectCalls.push(deps); return () => {} },
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
check('probe reports the build version first', probe1.clientVersion === '1.3.1', probe1.clientVersion)
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

console.log('\n' + (failures.length === 0 ? '✅ ALL CHECKS PASSED' : '❌ FAILURES: ' + failures.join('; ')))
// The bundle installs its own intervals (skin refresh, i18n watch), so exit
// explicitly rather than waiting for the event loop to drain.
process.exit(failures.length === 0 ? 0 : 1)
