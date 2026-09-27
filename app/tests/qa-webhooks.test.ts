/* QA gate — build plan step 14, part 2: webhook replays (docs/06).
   The provider retries until the event is a no-op: apply once, then every
   replay with the same provider ref must change nothing. A different ref is
   a different payment and must never collapse. */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import { applyWebhookEvent } from '@/server/webhooks'

describe('webhook replays (step 14: replay the provider until it is a no-op)', () => {
  it('applies a capture once, then no-ops every retry with no double effects', () => {
    const seen = new Set<string>()
    const first = applyWebhookEvent(seen, { providerRef: 'pay_qa_1', kind: 'captured' })
    expect(first.deduped).toBe(false)
    expect(first.payStatus).toBe('paid')
    for (let i = 0; i < 5; i += 1) {
      const replay = applyWebhookEvent(seen, { providerRef: 'pay_qa_1', kind: 'captured' })
      expect(replay.deduped).toBe(true)
      expect(replay.payStatus).toBeNull()
      expect(replay.effects).toEqual([])
    }
  })

  it('never locks on a failure replay, and keys idempotency on the provider ref', () => {
    const seen = new Set<string>()
    const failed = applyWebhookEvent(seen, { providerRef: 'pay_qa_2', kind: 'failed' })
    expect(failed.payStatus).toBe('failed')
    expect(failed.effects).not.toContain('lock_request')
    expect(applyWebhookEvent(seen, { providerRef: 'pay_qa_2', kind: 'failed' }).deduped).toBe(true)
    expect(applyWebhookEvent(seen, { providerRef: 'pay_qa_3', kind: 'failed' }).deduped).toBe(false)
  })

  it('enforces provider-ref uniqueness at the database', () => {
    const app = join(import.meta.dirname, '..')
    const migration = readFileSync(join(app, 'supabase', 'migrations', '20260925000000_init.sql'), 'utf8')
    expect(migration).toMatch(/CREATE UNIQUE INDEX.*payments_provider_ref_uidx/si)
  })
})
