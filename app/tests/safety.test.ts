/* Report/block persistence (docs/04 A12): incidents are never lost — every
   call lands in activity_log (the admin Reports feed) and mirrors into the
   reports/blocks tables when a Supabase client is available. A block mirrors
   onto this device too, because the local matcher is what the traveller who
   pressed "Report & block" then runs into. */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  blockUser,
  fileReport,
  isBlocked,
  resetBlocks,
  tripHandle,
  type SafetyClient,
} from '@/lib/safety'
import { activityLog, resetStore } from '@/lib/store'

interface FakeCall {
  table: string
  op: 'insert' | 'upsert'
  payload: Record<string, unknown>
  opts?: Record<string, unknown>
}

function fakeClient(error: unknown = null): { client: SafetyClient; calls: FakeCall[] } {
  const calls: FakeCall[] = []
  const client = {
    from(table: string) {
      return {
        insert(values: Record<string, unknown>) {
          calls.push({ table, op: 'insert', payload: values })
          return Promise.resolve({ error })
        },
        upsert(values: Record<string, unknown>, opts?: Record<string, unknown>) {
          calls.push({ table, op: 'upsert', payload: values, opts })
          return Promise.resolve({ error })
        },
      }
    },
  }
  return { client: client as unknown as SafetyClient, calls }
}

describe('fileReport', () => {
  beforeEach(() => resetStore())

  it('logs the incident locally even with no Supabase client (admin feed)', async () => {
    const result = await fileReport(
      { reporterId: 'u_me', reportedId: 'u_them', requestId: 'req_1', reason: 'cash offer' },
      null,
    )
    expect(result.persisted).toBe(false)
    const row = activityLog().find((r) => r.action === 'report_filed')
    expect(row, 'report_filed must reach activity_log').toBeDefined()
    expect(row?.meta).toMatchObject({ request_id: 'req_1', reason: 'cash offer' })
  })

  it('mirrors the row into reports when a client is available', async () => {
    const { client, calls } = fakeClient()
    const result = await fileReport(
      { reporterId: 'u_me', reportedId: 'u_them', requestId: 'req_2' },
      client,
    )
    expect(result.persisted).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      table: 'reports',
      op: 'insert',
      payload: {
        reporter_id: 'u_me',
        reported_id: 'u_them',
        request_id: 'req_2',
        reason: '',
      },
    })
    expect(activityLog().some((r) => r.action === 'report_filed')).toBe(true)
  })

  it('refuses self-reports before writing anything (reports_no_self)', async () => {
    const { client, calls } = fakeClient()
    const result = await fileReport({ reporterId: 'u_me', reportedId: 'u_me' }, client)
    expect(result.persisted).toBe(false)
    expect(calls).toHaveLength(0)
    expect(activityLog().some((r) => r.action === 'report_filed')).toBe(false)
  })

  it('keeps the local incident when the database write fails', async () => {
    const { client } = fakeClient({ message: 'rls' })
    const result = await fileReport({ reporterId: 'u_me', reportedId: 'u_them' }, client)
    expect(result.persisted).toBe(false)
    expect(activityLog().some((r) => r.action === 'report_filed')).toBe(true)
  })

  it('treats a throwing client like an offline device', async () => {
    const throwing = {
      from() {
        return {
          insert() {
            return Promise.reject(new Error('network'))
          },
          upsert() {
            return Promise.reject(new Error('network'))
          },
        }
      },
    } as unknown as SafetyClient
    const result = await fileReport({ reporterId: 'u_me', reportedId: 'u_them' }, throwing)
    expect(result.persisted).toBe(false)
    expect(activityLog().some((r) => r.action === 'report_filed')).toBe(true)
  })
})

describe('blockUser', () => {
  beforeEach(() => resetStore())

  it('upserts the composite key so repeat blocks are no-ops', async () => {
    const { client, calls } = fakeClient()
    const result = await blockUser({ blockerId: 'u_me', blockedId: 'u_them' }, client)
    expect(result.persisted).toBe(true)
    expect(calls[0]).toMatchObject({
      table: 'blocks',
      op: 'upsert',
      payload: { blocker_id: 'u_me', blocked_id: 'u_them' },
      opts: { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
    })
    expect(activityLog().some((r) => r.action === 'block')).toBe(true)
  })

  it('logs the block locally with no client', async () => {
    const result = await blockUser({ blockerId: 'u_me', blockedId: 'u_them' }, null)
    expect(result.persisted).toBe(false)
    const row = activityLog().find((r) => r.action === 'block')
    expect(row?.entity).toBe('user')
    expect(row?.entity_id).toBe('u_them')
  })

  it('refuses self-blocks', async () => {
    const { client, calls } = fakeClient()
    const result = await blockUser({ blockerId: 'u_me', blockedId: 'u_me' }, client)
    expect(result.persisted).toBe(false)
    expect(calls).toHaveLength(0)
    expect(activityLog().some((r) => r.action === 'block')).toBe(false)
  })
})

/* The device-side half of a block. `rankMatches` has dropped `blocked`
   candidates since it was written, and nothing on the device could ever set
   the field — so the chat button filed an incident and then kept offering the
   same traveller back. These tests pin that a block is recorded here, offline
   and on a failed sync, exactly like the activity row beside it. */
describe('block mirror on this device', () => {
  beforeEach(() => {
    resetStore()
    resetBlocks()
  })

  it('records the block with no Supabase client', async () => {
    await blockUser({ blockerId: 'u_me', blockedId: 'u_them' }, null)
    expect(isBlocked('u_them')).toBe(true)
    expect(isBlocked('u_me')).toBe(false)
  })

  it('records the block when the database write fails', async () => {
    const { client } = fakeClient({ message: 'rls' })
    const result = await blockUser({ blockerId: 'u_me', blockedId: 'u_them' }, client)
    expect(result.persisted).toBe(false)
    expect(isBlocked('u_them')).toBe(true)
  })

  it('records nothing for a self-block', async () => {
    const { client } = fakeClient()
    await blockUser({ blockerId: 'u_me', blockedId: 'u_me' }, client)
    expect(isBlocked('u_me')).toBe(false)
  })

  it('survives a repeat block without doubling the row', async () => {
    await blockUser({ blockerId: 'u_me', blockedId: 'u_them' }, null)
    await blockUser({ blockerId: 'u_me', blockedId: 'u_them' }, null)
    expect(isBlocked('u_them')).toBe(true)
    expect(activityLog().filter((r) => r.action === 'block')).toHaveLength(2)
  })

  it('clears with resetBlocks (account deletion)', async () => {
    await blockUser({ blockerId: 'u_me', blockedId: 'u_them' }, null)
    resetBlocks()
    expect(isBlocked('u_them')).toBe(false)
  })

  it('names a booking the way the matcher reads it', () => {
    /* The chat button writes `trip:<id>`; candidateFor() reads it back. If one
       side changed the prefix the block would stop biting in silence. */
    expect(tripHandle('tr_9f2')).toBe('trip:tr_9f2')
  })
})