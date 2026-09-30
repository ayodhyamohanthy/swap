/* The Swaps tab is the only place a traveller can come back to their own
   requests. Before this screen listed them, `/pay/$requestId` — the screen rule
   2 makes you reach after someone accepts — existed only as a link on the
   screen that created the request, so any navigation away lost the ₹99. These
   tests pin the row model: where each state taps to, and which states are
   listed at all. */
import { describe, expect, it } from 'vitest'

import { liveRequests, requestDest } from '@/routes/swaps'
import type { SwapRequest } from '@/lib/requests'

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path')

const routeSource = readFileSync(
  join(import.meta.dirname, '..', 'src', 'routes', 'swaps.tsx'),
  'utf8',
)

function row(status: SwapRequest['status'], updatedAt: string): SwapRequest {
  return { id: 'req_1', status, updated_at: updatedAt } as SwapRequest
}

describe('every live state taps through to its screen', () => {
  it('sends an accepted request to the pay screen (rule 2)', () => {
    expect(requestDest(row('accepted_awaiting_payment', ''))).toEqual({
      to: '/pay/$requestId',
      params: { requestId: 'req_1' },
    })
  })

  it('sends a locked or settled swap to the swap screens', () => {
    for (const status of ['locked', 'confirmed', 'voided', 'disputed'] as const) {
      expect(requestDest(row(status, '')).to).toBe('/swaps/$id')
    }
  })

  it('sends an unsent or searching request back to manage', () => {
    for (const status of ['draft', 'searching'] as const) {
      expect(requestDest(row(status, '')).to).toBe('/request/$id')
    }
  })
})

describe('the list holds actions, not history', () => {
  it('drops withdrawn and ended requests, keeps the ones with money in them', () => {
    const statuses = liveRequests([
      row('withdrawn', '2026-09-01T10:00:00.000Z'),
      row('expired', '2026-09-02T10:00:00.000Z'),
      row('voided', '2026-09-03T10:00:00.000Z'),
      row('disputed', '2026-09-04T10:00:00.000Z'),
    ]).map((request) => request.status)
    /* voided/disputed stay: rule 6's ₹99-to-credit lives behind them. */
    expect(statuses).toEqual(['disputed', 'voided'])
  })

  it('lists the most recently moved request first', () => {
    const ids = liveRequests([
      { id: 'old', status: 'searching', updated_at: '2026-09-01T10:00:00.000Z' },
      { id: 'new', status: 'searching', updated_at: '2026-09-05T10:00:00.000Z' },
      { id: 'mid', status: 'searching', updated_at: '2026-09-03T10:00:00.000Z' },
    ] as SwapRequest[]).map((request) => request.id)
    expect(ids).toEqual(['new', 'mid', 'old'])
  })
})

describe('the screen is wired to the rest of the app', () => {
  it('links out to new request, the acceptor board and Updates', () => {
    expect(routeSource).toContain('to="/request/new"')
    expect(routeSource).toContain('to="/incoming/$id"')
    expect(routeSource).toContain('to="/updates"')
    /* The badge is the unread count itself, not a second copy of it. */
    expect(routeSource).toContain('useUnreadUpdates')
  })

  it('never puts an exact berth or a raw status enum on the row (rules 13, 12b)', () => {
    expect(routeSource).not.toMatch(/acceptor_berth_no|berth_no/)
    expect(routeSource).not.toMatch(/\{request\.status\}|\{offer\.status\}/)
  })
})
