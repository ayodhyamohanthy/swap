/* L5's design-parity pass (backlog 3) — the four structural decisions that
   typecheck, the build and the copy tests all walk past:

   1. The summary screen stopped rendering AppFooter, because design 9c's
      ticket stub ALREADY prints both mandated footer lines verbatim. Rule 11
      survives only if the stub keeps carrying them — drop one of those props
      and this screen is suddenly silent on "not an official railway service",
      with nothing else in the suite noticing.
   2. The accept card must keep both halves of the trade (docs/09's "Accept
      card" row: give/get AND the ₹50 line) inside the card. Moving give/get
      back under the title, or dropping the earn line, is invisible to every
      functional test.
   3. Chat's identity line (coach · berth) may only be built from
      revealedBerths(), which is null until payment — the rule-13 gate.
   4. Design 13c draws Done AND Submit as buttons; a grey caption under the
      primary reads as a disabled control.

   Source-scanned on purpose: these are layout/structure invariants, and the
   routes are not rendered anywhere but the browser. */

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const read = (file: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'src', 'routes', file), 'utf8')

describe('swap summary: the ticket is its own footer (rule 11, design 9c)', () => {
  const src = read('swaps.$id.summary.tsx')

  it('prints both mandated lines in the stub', () => {
    expect(src).toContain("stubTitle={t('footer.line1')}")
    expect(src).toContain("stubBody={t('footer.line2')}")
  })

  it('does not repeat them in a second footer block', () => {
    expect(src).not.toMatch(/<AppFooter/)
    expect(src).not.toMatch(/import \{[^}]*AppFooter/)
  })
})

describe('accept card: both halves of the trade (docs/09, design 4a)', () => {
  const src = read('incoming.$id.tsx')
  /* Anchor on the page title: the "someone was faster" state card also uses
     `<Card className="mt-4">` and sits earlier in the file. */
  const titleAt = src.indexOf("t('incoming.title')")
  const start = titleAt >= 0 ? src.indexOf('<Card', titleAt) : -1
  const card = start >= 0 ? src.slice(start, src.indexOf('</Card>', start)) : ''

  it('keeps give/get and the ₹50 line inside the identity card', () => {
    expect(card, 'identity card not found').not.toBe('')
    expect(card).toContain("t('incoming.giveGet'")
    expect(card).toContain("t('incoming.earn'")
  })

  it('leads the name with the requester coach', () => {
    expect(card).toContain('incoming.requester_coach')
    expect(card).toContain("t('trip.coach'")
  })
})

describe('chat: identity after payment, stamped bubbles (rule 13, design 4b)', () => {
  const src = read('chat.$id.tsx')

  it('builds the coach · berth line from revealedBerths only', () => {
    expect(src).toContain('revealedBerths(id)')
    expect(src).toContain("t('trip.coach'")
    expect(src).toContain("t('trip.berth'")
  })

  it('stamps bubbles and keeps Send as an accessible label', () => {
    expect(src).toContain('CheckCheck')
    expect(src).toContain("aria-label={t('chat.send')}")
    expect(src).toContain("t('chat.report')")
  })

  it('sets the send time in BOTH send paths (online and queued)', () => {
    expect(src).toMatch(/id: localId, mine: true, text: clean, hidden: g\.flagged, at: localId/)
    expect(src).toMatch(/queued: true, at: Date\.now\(\)/)
  })
})

describe('rating: design 13c draws two real buttons', () => {
  const src = read('swaps.$id.rate.tsx')

  it('renders Submit as a button, not as caption text under Done', () => {
    expect(src).toMatch(/<Button[^>]*onClick=\{save\}[^>]*>\s*\{t\('rating\.submit'\)\}/)
    expect(src).not.toContain('<CardBody')
    expect(src).toContain("t('rating.done')")
  })
})
