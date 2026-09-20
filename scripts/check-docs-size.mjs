// Guard the one failure mode that is silent: AGENTS.md being truncated.
//
// `dsh-base` mounts @deepseek-ai/dsh-agent-instructions with maxBytes: 65536, and the budget applies
// to the COMPLETE rendered baseline. Going over does not error — it cuts the file mid-sentence, so
// the failure mode is losing rules rather than seeing a warning. This check makes that loud.
//
// Only AGENTS.md, CLAUDE.md and their `.local` overlays are discovered as candidates, so a second
// project file would share this budget; docs/ is not a candidate and is free. That is why relocation
// works and splitting does not.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Mirrors dsh-base/cordis.patch.yml. Overridable per profile, so it is a fact, not a law. */
const BUDGET = 65536
/** Warn with room to act, rather than at the cliff edge. */
const WARN_AT = 0.85

/** Every candidate file that shares the budget, in the order the loader renders them. */
const CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'AGENTS.local.md', 'CLAUDE.local.md']

let fail = false
const rel = (p) => path.relative(root, p).replaceAll('\\', '/')

// ── 1. Budget across all discovered candidates ──────────────────────────
let total = 0
const present = []
for (const name of CANDIDATES) {
  const p = path.join(root, name)
  if (!fs.existsSync(p)) continue
  const bytes = fs.statSync(p).size
  present.push({ name, bytes })
  total += bytes
}

const pct = total / BUDGET
if (present.length === 0) {
  console.log('check:docs — no instruction candidate files present')
} else {
  for (const f of present) console.log(`  ${f.name.padEnd(18)} ${String(f.bytes).padStart(6)} bytes`)
  const headroom = BUDGET - total
  const state = total > BUDGET ? 'OVER BUDGET' : pct >= WARN_AT ? 'NEAR LIMIT' : 'ok'
  console.log(`  ${'total'.padEnd(18)} ${String(total).padStart(6)} / ${BUDGET}  (${headroom >= 0 ? headroom + ' headroom' : -headroom + ' OVER'})  ${state}`)

  if (total > BUDGET) {
    console.error(`\n❌ The instruction baseline exceeds the ${BUDGET}-byte budget and WILL be truncated mid-sentence.`)
    console.error('   Move a procedure or reference section into docs/ — see "What belongs in this file" in AGENTS.md.')
    fail = true
  } else if (pct >= WARN_AT) {
    console.warn(`\n⚠️  Within ${(BUDGET * (1 - WARN_AT) / 1024).toFixed(0)} KB of the budget. Plan a relocation before it becomes urgent.`)
  }
}

// ── 2. Every docs/ pointer in AGENTS.md must resolve ────────────────────
// Relocation is only safe while the pointers are real; a rename would silently orphan a rule.
const agents = path.join(root, 'AGENTS.md')
if (fs.existsSync(agents)) {
  const text = fs.readFileSync(agents, 'utf8')
  const targets = new Set()
  for (const m of text.matchAll(/\]\((docs\/[^)\s]+|[A-Z][A-Za-z.-]*\.md)\)/g)) targets.add(m[1])
  const missing = [...targets].filter((t) => !fs.existsSync(path.join(root, t)))
  if (missing.length > 0) {
    console.error(`\n❌ AGENTS.md points at ${missing.length} file(s) that do not exist: ${missing.join(', ')}`)
    fail = true
  } else {
    console.log(`  pointers           ${targets.size} checked, all resolve`)
  }
}

process.exit(fail ? 1 : 0)
