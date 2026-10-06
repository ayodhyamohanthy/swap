import { describe, expect, it } from 'vitest'

import {
  persistRequestTransition,
  type ActivityWrite,
  type SupaClient,
} from '@/server/functions'

const activity: ActivityWrite = {
  actor_id: 'user-1',
  actor_role: 'user',
  action: 'request_sent',
  entity: 'swap_request',
  entity_id: 'request-1',
  meta: { booking_id: 'booking-1' },
}

function fakeClient(rpcError: unknown = null, logError: unknown = null) {
  const calls: Array<Record<string, unknown>> = []
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ type: 'rpc', name, args })
      return { error: rpcError }
    },
    from: (table: string) => {
      calls.push({ type: 'from', table })
      return {
        insert: async (row: unknown) => {
          calls.push({ type: 'insert', row })
          return { error: logError }
        },
      }
    },
  } as unknown as SupaClient
  return { client, calls }
}

describe('persistRequestTransition', () => {
  it('uses the guarded request RPC before writing its activity row', async () => {
    const { client, calls } = fakeClient()

    await expect(
      persistRequestTransition(client, 'request-1', 'searching', activity),
    ).resolves.toEqual({ persisted: true })

    expect(calls).toEqual([
      {
        type: 'rpc',
        name: 'apply_request_transition',
        args: { p_req: 'request-1', p_status: 'searching', p_locked_offer: null },
      },
      { type: 'from', table: 'activity_log' },
      {
        type: 'insert',
        row: {
          actor_id: 'user-1',
          actor_role: 'user',
          action: 'request_sent',
          entity: 'swap_request',
          entity_id: 'request-1',
          meta: { booking_id: 'booking-1' },
        },
      },
    ])
  })

  it('does not log a transition rejected by the database', async () => {
    const { client, calls } = fakeClient(new Error('forbidden'))

    await expect(
      persistRequestTransition(client, 'request-1', 'withdrawn', activity),
    ).resolves.toEqual({ persisted: false })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ type: 'rpc', name: 'apply_request_transition' })
  })

  it('stays local-first when no backend is configured', async () => {
    await expect(
      persistRequestTransition(null, 'request-1', 'searching', activity),
    ).resolves.toEqual({ persisted: false })
  })
})
