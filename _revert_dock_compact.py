import io
import re

p = 'lib/client.js'
s = io.open(p, encoding='utf-8', newline='').read()
eol = '\r\n' if '\r\n' in s else '\n'


def rep(old, new, n=1):
    global s
    o = old.replace('\n', eol)
    nw = new.replace('\n', eol)
    assert s.count(o) == n, 'anchor x%d: %r' % (s.count(o), o[:80])
    s = s.replace(o, nw)


# ── 1 · the gate goes back to standalone-only ─────────────────────────────────────
rep("""    /** The DOCKED panel's own switch — see `_compactPanelForSurface`. */
    function _compactPanelDocked() {
      return !!(_hostPrefs && _hostPrefs.compactPanelDocked)
    }

    /** Is the compact panel in force on THIS surface?
     *
     *  TWO preferences, not one, and the split is deliberate. The docked panel is somebody else's
     *  window: dock-base owns its width and its chrome, so a mode turned on for the floating strip
     *  must not silently restyle it — that is the defect that made the workbench panel look broken
     *  the first time. It is not that the docked panel cannot be compact; it is that it has to be
     *  ASKED, and the toggle in its own header is how. Each surface remembers its own answer.
     *
     *  Callable on its own so the answer is inspectable: `window.__dockFlashCompactMode(true)`. */
    function _compactPanelForSurface(props) {
      return !!(props && props.standalone === true) ? _compactPanel() : _compactPanelDocked()
    }

    /** One painter for the compact toggle in EITHER header, so the two cannot disagree about what
     *  "on" looks like. Mirrors the close-on-blur button beside it: the same glyph in both states,
     *  with background + opacity carrying the state and the `title` naming the action. */
    function _paintCompactToggle(btn, docked) {
      if (!btn) return
      var on = docked ? _compactPanelDocked() : _compactPanel()
      btn.setAttribute('aria-pressed', String(on))
      btn.setAttribute('aria-label', t(on ? 'compactExit' : 'compactEnter'))
      btn.setAttribute('title', t(on ? 'compactExit' : 'compactEnter'))
      btn.style.opacity = on ? '1' : '0.55'
      btn.style.background = on ? 'var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.18))' : 'transparent'
    }""",
"""    /** Is the compact panel in force on THIS surface?
     *
     *  STANDALONE ONLY, and that is a deliberate retreat rather than the original design. The mode
     *  was briefly offered in the docked panel too, through a toggle in its header and a second
     *  preference — and it did not earn its place there: the docked panel's width belongs to
     *  dock-base (its contract has no width field in `ViewDefinition` or `WorkbenchLayout`), so the
     *  mode could never make that panel narrower, only strip chrome from somebody else's window.
     *  The double-click on the floating ⚡ remains the single entry point.
     *
     *  Callable on its own so the answer is inspectable: `window.__dockFlashCompactMode(true)`. */
    function _compactPanelForSurface(props) {
      return !!(props && props.standalone === true) && _compactPanel()
    }""")

rep("""    function _setCompactPanel(on, docked) {
      var next = !!on
      var field = docked ? 'compactPanelDocked' : 'compactPanel'
      var patch = {}
      patch[field] = next
      if (_hostPrefs) _hostPrefs[field] = next""",
"""    function _setCompactPanel(on) {
      var next = !!on
      var patch = { compactPanel: next }
      if (_hostPrefs) _hostPrefs.compactPanel = next""")

# ── 2 · the glyph and its strings ─────────────────────────────────────────────────
rep("""    // ── Icon for the header compact-mode toggle ──────────────────────────
    //    Rows of unequal length: the dense block of controls this mode draws. ONE glyph for both
    //    states, exactly like the close-on-blur toggle beside it — the button's background and
    //    opacity say which state it is in, and its `title` names what pressing it does.
    const COMPACT_ICON_SVG =
      '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;pointer-events:none">' +
      '<path d="M2.5 4.6h11M4.6 8h6.8M2.5 11.4h11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
      '</svg>'

    const CLOSE_ON_BLUR_ICON_SVG =""", """    const CLOSE_ON_BLUR_ICON_SVG =""")
rep("""      compactEnter: '切换到精简模式',
      compactExit: '切换回完整面板',
""", "")
rep("""      compactEnter: 'Switch to the compact panel',
      compactExit: 'Switch back to the full panel',
""", "")

# ── 3 · the standalone head's toggle ──────────────────────────────────────────────
rep("""      // The compact-mode toggle, and the title it makes redundant: compact mode drops the title
      // because at 176px it can only ever be truncated ("快捷…"), which reads as a defect.
      var compactBtn = null
      var floatingTitle = null""",
"""      // The compact mode drops the panel title, so the skin that hides it needs a handle on it.
      var floatingTitle = null""")

s = re.sub(r'\n *// ── Compact-mode toggle ──+[\s\S]*?\n *compactBtn\.addEventListener\(.click.[\s\S]*?\n *\}\)\n', eol, s, count=1)
assert 'compactBtn' not in s.split('floatingHead.appendChild(cobBtn)')[0], 'compactBtn block left behind'

rep("""        floatingHead.appendChild(titleSpan)
        floatingHead.appendChild(compactBtn)
        floatingHead.appendChild(cobBtn)""",
"""        floatingHead.appendChild(titleSpan)
        floatingHead.appendChild(cobBtn)""")
rep("""        if (floatingTitle) floatingTitle.style.display = compact ? 'none' : ''
        _paintCompactToggle(compactBtn, false)""",
"""        if (floatingTitle) floatingTitle.style.display = compact ? 'none' : ''""")

# ── 4 · the workbench header's toggle ────────────────────────────────────────────
rep("""          /** Disposer for the workbench header's compact-toggle pref subscription. */
          let _compactHeaderDispose = null
""", "")
rep("""                    // The compact-mode toggle, FIRST so it sits beside the title it acts on. This
                    // header is dock-base's, so this button is the only way the DOCKED panel can
                    // enter compact mode — and it drives its own preference (`docked: true`), so
                    // turning it on here never restyles the floating panel and vice versa.
                    h('button', {
                      type: 'button',
                      ref: (el) => {
                        if (_compactHeaderDispose) { _compactHeaderDispose(); _compactHeaderDispose = null }
                        if (el) {
                          _paintCompactToggle(el, true)
                          _compactHeaderDispose = _subscribePrefs(() => _paintCompactToggle(el, true))
                        }
                      },
                      style: { ...S.panelCloseBtn, fontSize: '14px', display: 'inline-flex', alignItems: 'center' },
                      onClick: (e) => {
                        _setCompactPanel(!_compactPanelDocked(), true)
                        _paintCompactToggle(e.currentTarget, true)
                      },
                      onMouseEnter: (e) => { e.currentTarget.style.opacity = '1' },
                      onMouseLeave: (e) => _paintCompactToggle(e.currentTarget, true),
                      dangerouslySetInnerHTML: { __html: COMPACT_ICON_SVG },
                    }),
""", "")

# ── 5 · the second preference, everywhere it was read ────────────────────────────
rep("""          compactPanel: resolved.compactPanel === true,
          compactPanelDocked: resolved.compactPanelDocked === true,""",
"""          compactPanel: resolved.compactPanel === true,""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('client reverted')

# ── 6 · the host schema field ────────────────────────────────────────────────────
p2 = 'src/index.ts'
t = io.open(p2, encoding='utf-8', newline='').read()
eol2 = '\r\n' if '\r\n' in t else '\n'
old = """  // The DOCKED panel's own compact switch, kept apart from the floating panel's so enabling one
  // never silently restyles the other's window — see `_compactPanelForSurface` client-side. The
  // docked panel is somebody else's window: dock-base owns its width and its chrome.
  compactPanelDocked: Schema.boolean().default(false).volatile(),
""".replace('\n', eol2)
assert t.count(old) == 1
io.open(p2, 'w', encoding='utf-8', newline='').write(t.replace(old, ''))
print('host schema field removed')
