/* L5's analytics-name fix — one event name, one shape, one producer.

   `routes/swaps.$id.done.tsx` fired `trackEvent('payment_paid', { state })`
   on every done-screen view while `lib/store.ts` fired the same name with
   `{ amount_paise, credit_used_paise }` at pay time: every paid swap logged
   TWO `payment_paid` rows, and any dashboard grouping by event name silently
   mixed `{state}` rows with money rows (L7's filing). The done screen now
   fires `swap_done_viewed` — an analytics-only name like `share_clicked`
   and `first_screen_viewed`, which likewise match no activity_log action —
   so `payment_paid` again means exactly one thing, from exactly one site.

   Source-scanned on purpose: the route fires inside a useEffect the suite
   never renders, and the invariant is about call sites, not behaviour. */

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync, readdirSync, statSync } = process.getBuiltinModule(
  'node:fs',
) as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'
import { ANALYTICS_EVENTS } from '../src/lib/analytics'

const SRC = join(import.meta.dirname, '..', 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

function paymentPaidCallSites(): string[] {
  /* The call site passes the name through a ternary
     (`status === 'paid' ? 'payment_paid' : 'payment_failed'`), so match the
     string inside the call's parens, not the literal `trackEvent('…'` form.
     Bare mentions (label maps, activity-action comparisons, comments) sit
     outside any trackEvent parens and do not match. */
  return walk(SRC).filter((file) =>
    /trackEvent\([^)]*['"]payment_paid['"]/.test(readFileSync(file, 'utf8')),
  )
}

describe('payment_paid has one producer and one shape', () => {
  it('is fired only from lib/store.ts', () => {
    const sites = paymentPaidCallSites()
    expect(sites).toEqual([join(SRC, 'lib', 'store.ts')])
  })

  it('carries the money shape at its one call site', () => {
    const src = readFileSync(join(SRC, 'lib', 'store.ts'), 'utf8')
    expect(src).toContain('amount_paise: next.amount_paise')
    expect(src).toContain('credit_used_paise: next.credit_used_paise')
  })
})

describe('the done screen logs the outcome view, not a payment', () => {
  const done = readFileSync(join(SRC, 'routes', 'swaps.$id.done.tsx'), 'utf8')

  it('fires swap_done_viewed with the outcome state', () => {
    expect(done).toContain("trackEvent('swap_done_viewed', { state })")
  })

  it('never fires payment_paid (the name is mentioned in a comment only)', () => {
    expect(done).not.toMatch(/trackEvent\([^)]*['"]payment_paid['"]/)
  })

  it('swap_done_viewed is a real AnalyticsEvent', () => {
    expect((ANALYTICS_EVENTS as readonly string[])).toContain('swap_done_viewed')
  })
})
