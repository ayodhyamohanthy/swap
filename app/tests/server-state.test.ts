import { describe, expect, it } from 'vitest'
import { groupCoverage, refetchRow, type SupaClient } from '@/server/functions'

type Reply = { data: unknown; error: unknown }
function clientFor(replies: Record<string, Reply | Error>): SupaClient {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const method of ['select', 'eq', 'single', 'limit', 'or']) {
        chain[method] = () => chain
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const reply = replies[table] ?? { data: null, error: null }
        return (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)).then(resolve, reject)
      }
      return chain
    },
  } as unknown as SupaClient
}

describe('authoritative backend rows', () => {
  const forged = { id: 'request-1', requester_id: 'attacker', status: 'draft' }
  it('keeps offline fallback, but returns the stored row online', async () => {
    expect(await refetchRow(null, 'swap_requests', forged.id, forged)).toBe(forged)
    const stored = { ...forged, requester_id: 'owner', status: 'locked' }
    expect(await refetchRow(clientFor({ swap_requests: { data: stored, error: null } }), 'swap_requests', forged.id, forged)).toBe(stored)
  })
  it('never substitutes client state for a missing online row', async () => {
    expect(await refetchRow(clientFor({}), 'swap_requests', forged.id, forged)).toBeNull()
  })
  it('refuses query errors even if a payload is present', async () => {
    await expect(refetchRow(clientFor({ swap_requests: { data: forged, error: { message: 'denied' } } }), 'swap_requests', forged.id, forged)).rejects.toThrow('state_unreadable')
  })
})

describe('authoritative group coverage', () => {
  const forged = { paid: true, lockedCount: 0 }
  const good = {
    group_trips: { data: { id: 'group-1' }, error: null },
    payments: { data: [], error: null },
    swap_requests: { data: [{ id: 'locked-1' }], error: null },
  }
  it('preserves offline mode and uses only backend counts online', async () => {
    expect(await groupCoverage(null, null, forged)).toBeNull()
    expect(await groupCoverage(null, 'group-1', forged)).toBe(forged)
    expect(await groupCoverage(clientFor(good), 'group-1', forged)).toEqual({ paid: false, lockedCount: 1 })
    expect(await groupCoverage(clientFor({}), 'group-1', forged)).toBeNull()
  })
  for (const table of ['group_trips', 'payments', 'swap_requests']) {
    it(`refuses a ${table} read error instead of trusting a paid snapshot`, async () => {
      await expect(groupCoverage(clientFor({ ...good, [table]: { data: null, error: { message: 'unavailable' } } }), 'group-1', forged)).rejects.toThrow('state_unreadable')
    })
  }
  it('refuses thrown transport failures', async () => {
    await expect(groupCoverage(clientFor({ ...good, payments: new Error('network down') }), 'group-1', forged)).rejects.toThrow('state_unreadable')
  })
})
