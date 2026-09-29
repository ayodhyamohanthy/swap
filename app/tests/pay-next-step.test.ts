/* The pay screen's last button, and the one place a payment state can tell a
   traveller something false. Read by source rather than by render: the branch
   is a single ternary over `paid.status`, and a render test would have to fake
   a whole store to assert one string. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src', 'routes', 'pay.$requestId.tsx')
const raw = readFileSync(SRC, 'utf8')

/** The source with comments stripped, so an assertion cannot pass or fail on
 * prose. The first version of these guards quoted the old expression in the
 * explanatory comment above the fix — which is exactly how a "not to match"
 * assertion starts failing on its own documentation. */
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe("the pay screen's next step follows the payment state, not merely its existence", () => {
  it('sends only a genuinely pending payment to the status screen', () => {
    /* `startPayment` writes a `created` row the moment checkout opens — before
       a byte reaches Razorpay. Branching on "a payment exists and is not
       failed" therefore put a traveller who had merely *opened* checkout (or
       whose gateway handoff died) on "Your bank is still confirming ₹99 /
       Please don't pay again", for a payment the bank had never heard of. The
       instruction is right for `pending` and wrong for `created`. */
    expect(src).toMatch(/paid\?\.status === 'pending'/)
    expect(src).not.toMatch(/paid && paid\.status !== 'failed'/)
  })

  it('offers the pay action with its amount, not a bare "Continue"', () => {
    /* Design 03c ends on "Pay with UPI". `pay.payNow` is reused rather than a
       new key: it names the amount the screen just recomputed after the credit
       toggle, which is the more useful of the two facts at that moment.

       Scoped to the payment branch, not the whole file: `PayBlocked` uses
       `common.continue` for its "keep looking" link and always should, so a
       file-wide "no common.continue" assertion would forbid a correct string
       somewhere else. */
    const branch = src.slice(src.indexOf("paid?.status === 'pending'"))
    expect(branch).toMatch(/pay\.payNow/)
    expect(branch).not.toMatch(/\{t\('common\.continue'\)\}/)
  })

  it('keeps the status screen reachable for the state that earns it', () => {
    /* Asserting the negative alone would pass on a screen with no way to check
       a payment at all, which is the opposite defect. */
    expect(src).toMatch(/to="\/pay\/\$requestId\/status"/)
    expect(src).toMatch(/pay\.checkStatus/)
  })
})
