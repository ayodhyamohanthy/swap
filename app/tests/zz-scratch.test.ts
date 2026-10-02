import { describe, expect, it } from 'vitest'
import { expireRequestsAfterJourneyEnd } from '@/server/jobs'

describe('scratch: can a createServerFn be called in vitest?', () => {
  it('returns a plan keyless', async () => {
    const out = await expireRequestsAfterJourneyEnd({
      nowMs: 10,
      journeys: [{ id: '00000000-0000-4000-8000-000000000001', journeyEndMs: 5 }],
    })
    console.log('OUT', JSON.stringify(out))
    expect(out).toBeTruthy()
  })
})
