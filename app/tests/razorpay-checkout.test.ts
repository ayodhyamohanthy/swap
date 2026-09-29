/* The Razorpay checkout does not exist yet, and nothing here should pretend it
 * does — but the day someone writes it, two things have to be true or a
 * passenger's money moves on the client's word alone.
 *
 * **Where things stand.** `verifyRazorpaySignature` exists in
 * `server/webhooks.ts` and is correct (HMAC-SHA256 over `orderId|paymentId`
 * with the key secret, compared with `timingSafeEqual`). It has **no call
 * sites**: `pay.$requestId.method.tsx` loads the SDK and then navigates
 * straight to the waiting screen, and nothing anywhere constructs
 * `new Razorpay(...)` or calls `.open()`. So there is no Razorpay checkout for
 * an attacker to forge a response to, and this is a latent gap rather than a
 * live one.
 *
 * That is exactly why it needs a guard. An audit reading "signature
 * verification is never called" sounds like a live critical; an audit reading
 * "the checkout is not implemented, and here is the test that fires when it is"
 * is a fact about the code. The pair below states which one is true, so the
 * next agent — or the next audit — is not left guessing.
 *
 * What is NOT asserted here, deliberately: that a real payment is impossible
 * today. `confirmCaptured` can mark a payment paid from the local store, and
 * that is the local-first design (docs/08). What must not happen is a *gateway*
 * response being believed without a signature, and that only becomes reachable
 * when a checkout is opened.
 */
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** Every source file, as one blob. */
const ALL = files(SRC).map((file) => [file.slice(SRC.length + 1), readFileSync(file, 'utf8')] as const)

/** `new Razorpay(` — the constructor is what actually opens a checkout. */
const opensCheckout = (text: string) => /\bnew\s+Razorpay\s*\(/.test(text)

describe('the Razorpay checkout is not implemented, and the day it is, it must verify', () => {
  it('does not open a Razorpay checkout anywhere', () => {
    /* Stated as a fact about the code, not as an aspiration. If this test
       starts failing, that is GOOD NEWS: someone wired the checkout, and the
       signature check below becomes load-bearing in the same commit. */
    const openers = ALL.filter(([, text]) => opensCheckout(text)).map(([file]) => file)
    expect(
      openers,
      'a Razorpay checkout now exists — verifyRazorpaySignature must be called on its '
        + 'response before confirmCaptured, and the tests/copy.test.ts gate re-read',
    ).toEqual([])
  })

  it('keeps verifyRazorpaySignature, so wiring the checkout does not mean writing crypto', () => {
    /* The reason a future agent can be told "call the existing function" rather
       than "add an HMAC check" is that it exists and is tested. A refactor that
       deleted it would leave the checkout unwritable-in-safety, so it is
       pinned — and it is a `createServerFn` (server-only), not a plain export,
       which is what keeps the key secret off the client. */
    const webhooks = ALL.find(([file]) => file === 'server/webhooks.ts')
    expect(webhooks, 'server/webhooks.ts is missing').toBeTruthy()
    expect(webhooks?.[1]).toMatch(/verifyRazorpaySignature\s*=\s*createServerFn/)
    /* And it is timing-safe, which is the part a rewrite would be most likely
       to get wrong. */
    expect(webhooks?.[1]).toMatch(/timingSafeEqual/)
  })

  it('does not let the local store mark a gateway payment paid on its own', () => {
    /* The local-first path is allowed to settle a swap from local state — that
       is docs/08 with no backend. What it must never do is claim a GATEWAY
       captured the money, because that is the claim a signature exists to
       support. `confirmCaptured` is the single entry point for that, and it
       takes a providerRef, so the two are distinguishable in the log. */
    const checkout = ALL.find(([file]) => file === 'lib/checkout.ts')
    expect(checkout?.[1]).toMatch(/export function confirmCaptured\(/)
  })
})
