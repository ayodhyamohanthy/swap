/* Design 15's right-hand User timeline (backlog 4).
 *
 * The panel is the one part of design 15 that is derivable from what the log
 * already holds: the table's User *column* needs a name the rows do not carry,
 * but a panel grouped by who acted needs only `actor_id`. These tests pin the
 * grouping, and specifically the one property that would be a real defect in an
 * audit panel — automation filed under a person's id.
 */
import { describe, expect, it } from 'vitest'
import { activityTrain, filterActivity, userTimelines } from '@/lib/admin'
import type { ActivityRow } from '@/lib/store'

function row(over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'a1',
    actor_id: 'u_riya',
    actor_role: 'user',
    action: 'request_sent',
    entity: 'swap_request',
    entity_id: 'req_1',
    meta: { train_no: '12752', class: '3A' },
    created_at: '2026-09-29T17:00:00.000Z',
    ...over,
  }
}

/* The ordering bug the capture found: a log table that is not sorted is still a
 * log table. This sits next to the timeline tests because the fix and the
 * timeline share one ordering contract, and the table is what made the defect
 * visible in the first place. */
describe('filterActivity — the audit table reads newest first', () => {
  it('orders by created_at descending, not by insertion', () => {
    /* A nightly job's rows are appended to the array whatever time they claim,
       so a 23:14 row used to render under a 22:45 one. */
    const rows = [
      row({ id: 'a1', created_at: '2026-09-29T17:00:00.000Z' }),
      row({ id: 'j1', action: 'credit_expired', created_at: '2026-09-29T17:14:00.000Z' }),
      row({ id: 'a2', created_at: '2026-09-29T17:05:00.000Z' }),
    ]
    expect(filterActivity(rows, { action: null, category: 'all', query: '' }).map((r) => r.id)).toEqual(['j1', 'a2', 'a1'])
  })

  it('breaks a timestamp tie by id, so the order cannot flicker between renders', () => {
    const same = '2026-09-29T17:00:00.000Z'
    const rows = [
      row({ id: 'z1', created_at: same }),
      row({ id: 'a1', created_at: same }),
    ]
    const once = filterActivity(rows, { action: null, category: 'all', query: '' }).map((r) => r.id)
    const again = filterActivity([...rows].reverse(), { action: null, category: 'all', query: '' }).map((r) => r.id)
    expect(once).toEqual(again)
    expect(once).toEqual(['a1', 'z1'])
  })

  it('still filters, and still returns everything for an empty filter', () => {
    const rows = [
      row({ id: 'a1', action: 'request_sent', created_at: '2026-09-29T17:00:00.000Z' }),
      row({ id: 'a2', action: 'payment_paid', created_at: '2026-09-29T17:10:00.000Z' }),
    ]
    expect(filterActivity(rows, { action: null, category: 'all', query: '' })).toHaveLength(2)
    expect(filterActivity(rows, { action: null, category: 'payments', query: '' }).map((r) => r.id)).toEqual(['a2'])
    expect(filterActivity(rows, { action: null, category: 'all', query: '12752' })).toHaveLength(2)
    expect(filterActivity(rows, { action: null, category: 'all', query: 'nope' })).toHaveLength(0)
  })

  it('agrees with the panel: within a group, the same order as the table', () => {
    /* The table and the panel are two views of one log, so they must not
       disagree about which of a user's rows is newest. They are NOT equal as
       flat lists, and asserting that was this test's own first mistake: the
       panel is GROUPED, so flattening it gives one user's rows before the next
       user's, while the table interleaves them by time. The contract is that
       each group's entries keep the table's relative order. */
    const rows = [
      row({ id: 'a1', actor_id: 'u_riya', created_at: '2026-09-29T17:00:00.000Z' }),
      row({ id: 'a2', actor_id: 'u_riya', created_at: '2026-09-29T17:10:00.000Z' }),
      row({ id: 'j1', actor_id: null, action: 'credit_expired', created_at: '2026-09-29T17:05:00.000Z' }),
    ]
    const table = filterActivity(rows, { action: null, category: 'all', query: '' })
    for (const group of userTimelines(rows)) {
      const positions = group.entries.map((entry) => table.findIndex((r) => r.id === entry.id))
      expect(positions.every((p) => p !== -1), `${group.actorId} has a row the table dropped`).toBe(true)
      /* Ascending positions == the panel's order is the table's order. */
      expect(positions).toEqual([...positions].sort((x, y) => x - y))
    }
  })
})

describe('userTimelines', () => {
  it('groups rows by actor and returns each group newest first', () => {
    const groups = userTimelines([
      row({ id: 'a1', actor_id: 'u_riya', created_at: '2026-09-29T17:00:00.000Z' }),
      row({ id: 'a2', actor_id: 'u_riya', created_at: '2026-09-29T17:05:00.000Z' }),
      row({ id: 'b1', actor_id: 'u_arjun', created_at: '2026-09-29T17:02:00.000Z' }),
    ])

    expect(groups.map((g) => g.actorId)).toEqual(['u_riya', 'u_arjun'])
    expect(groups[0].entries.map((e) => e.id)).toEqual(['a2', 'a1'])
  })

  it('keeps automation in its own group, never merged into a person', () => {
    /* `server/jobs.ts` writes `support` with `actor_id: 'system'` and
       `server/admin.ts` writes `admin`; a null actor_id must never be filed
       under a passenger, or a scheduled job reads as something a person did. */
    const groups = userTimelines([
      row({ id: 'a1', actor_id: 'u_riya', created_at: '2026-09-29T17:05:00.000Z' }),
      row({
        id: 'j1',
        actor_id: null,
        actor_role: 'support',
        action: 'credit_expired',
        created_at: '2026-09-29T17:09:00.000Z',
      }),
    ])

    const automation = groups.find((g) => g.actorId === null)
    expect(automation).toBeDefined()
    expect(automation?.entries.map((e) => e.id)).toEqual(['j1'])
    expect(automation?.role).toBe('support')
    /* The passenger's group must not have swallowed the job. */
    expect(groups.find((g) => g.actorId === 'u_riya')?.entries).toHaveLength(1)
  })

  it('does not let a null actor collapse onto a literal "null" id', () => {
    /* A Map keyed on the raw value would put a null-actor row and a row whose
       actor_id is the four characters "null" in the same bucket. Compared as a
       set, because `[null, 'null'].sort()` is not stable in the way one wants
       here — the two must be told apart, not merely counted. */
    const groups = userTimelines([
      row({ id: 'a1', actor_id: null, created_at: '2026-09-29T17:00:00.000Z' }),
      row({ id: 'b1', actor_id: 'null', created_at: '2026-09-29T17:01:00.000Z' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.filter((g) => g.actorId === null)).toHaveLength(1)
    expect(groups.filter((g) => g.actorId === 'null')).toHaveLength(1)
    /* And each group holds only its own row, which is the actual bug this
       guards: a merged bucket would have two entries under one id. */
    expect(groups.every((g) => g.entries.length === 1)).toBe(true)
  })

  it("orders the panel by each actor's most recent row, automation first on a tie", () => {
    const same = '2026-09-29T17:00:00.000Z'
    const groups = userTimelines([
      row({ id: 'a1', actor_id: 'u_riya', created_at: same }),
      row({ id: 'a2', actor_id: 'u_arjun', created_at: same }),
      row({ id: 'j1', actor_id: null, actor_role: 'admin', created_at: same }),
    ])
    expect(groups.map((g) => g.actorId)).toEqual([null, 'u_arjun', 'u_riya'])
  })

  it('breaks a timestamp tie by id, so the order never depends on input order', () => {
    const same = '2026-09-29T17:00:00.000Z'
    const rows = [
      row({ id: 'z1', actor_id: 'u_z', created_at: same }),
      row({ id: 'a1', actor_id: 'u_a', created_at: same }),
    ]
    const forwards = userTimelines(rows).map((g) => g.actorId)
    const backwards = userTimelines([...rows].reverse()).map((g) => g.actorId)
    expect(forwards).toEqual(backwards)
    expect(forwards).toEqual(['u_a', 'u_z'])
  })

  it('caps each panel at the newest entries, not the first ones encountered', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      row({ id: `a${i}`, created_at: `2026-09-29T17:${String(i).padStart(2, '0')}:00.000Z` }),
    )
    const groups = userTimelines(many, { limitPerUser: 3 })
    expect(groups[0].entries).toHaveLength(3)
    expect(groups[0].entries.map((e) => e.id)).toEqual(['a11', 'a10', 'a9'])
  })

  it('carries the train on its own field and keeps it out of the details', () => {
    /* Same split as the table: the number is its own column, so repeating it in
       the details would read as two different facts about the same row. */
    const groups = userTimelines([row({ meta: { train_no: '12752', class: '3A' } })])
    expect(groups[0].entries[0].train).toBe('12752')
    expect(groups[0].entries[0].detail).not.toContain('12752')
    expect(groups[0].entries[0].detail).toContain('3A')
  })

  it('takes the group role from the newest row', () => {
    const groups = userTimelines([
      row({ id: 'a1', actor_id: 'u_riya', actor_role: 'admin', created_at: '2026-09-29T17:00:00.000Z' }),
      row({ id: 'a2', actor_id: 'u_riya', actor_role: 'user', created_at: '2026-09-29T17:05:00.000Z' }),
    ])
    expect(groups[0].role).toBe('user')
  })

  it('can be narrowed to one actor, including the automation group', () => {
    const rows = [
      row({ id: 'a1', actor_id: 'u_riya' }),
      row({ id: 'b1', actor_id: 'u_arjun' }),
      row({ id: 'j1', actor_id: null, actor_role: 'support' }),
    ]
    expect(userTimelines(rows, { onlyActor: 'u_riya' })).toHaveLength(1)
    const automation = userTimelines(rows, { onlyActor: null })
    expect(automation).toHaveLength(1)
    expect(automation[0].actorId).toBeNull()
  })

  it('returns nothing for an empty log rather than throwing', () => {
    expect(userTimelines([])).toEqual([])
  })

  it('leaves activityTrain alone — the panel reads it, it does not redefine it', () => {
    /* Guards the temptation to "improve" the shared reader while adding a
       second consumer. `detailToken` accepts a finite number as well as a
       string, so a numeric train_no renders identically in the panel and the
       table rather than becoming null in one and text in the other. */
    expect(activityTrain(row({ meta: { train_no: '12752' } }))).toBe('12752')
    expect(activityTrain(row({ meta: { train_no: 12752 } }))).toBe('12752')
    /* Still null for what it has always rejected: absent, and non-finite. */
    expect(activityTrain(row({ meta: {} }))).toBeNull()
    expect(activityTrain(row({ meta: { train_no: Number.NaN } }))).toBeNull()
  })
})
