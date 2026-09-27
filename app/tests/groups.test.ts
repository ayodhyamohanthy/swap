/* Family trips: organiser links PNRs, ₹199 covers up to 3 swaps (docs/04 C). */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createGroup,
  getGroup,
  groupTogetherCount,
  linkTrip,
  listGroups,
  markGroupPaid,
  resetGroups,
} from '@/lib/groups'
import { GROUP_PRICE_PAISE } from '@/lib/money'
import { buildQuote } from '@/lib/payments'

describe('family groups', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetGroups()
  })

  it('creates, links and pays a group at ₹199', () => {
    expect(GROUP_PRICE_PAISE).toBe(19900)
    const group = createGroup('Sharma family', ['t1'])
    expect(group.id.startsWith('grp_')).toBe(true)
    expect(group.paid).toBe(false)
    expect(linkTrip(group.id, 't2')?.trip_ids).toEqual(['t1', 't2'])
    expect(linkTrip(group.id, 't2')).toBeUndefined()
    expect(markGroupPaid(group.id)?.paid).toBe(true)
    expect(getGroup(group.id)?.paid).toBe(true)
    expect(listGroups()).toHaveLength(1)
  })

  it('quotes the group price once for the whole trip', () => {
    const quote = buildQuote(0, true)
    expect(quote.total).toBe(19900)
    expect(quote.due).toBe(19900)
    const covered = buildQuote(19900, true)
    expect(covered.provider).toBe('credit')
    expect(covered.due).toBe(0)
  })

  it('counts togetherness off missing trips', () => {
    const group = createGroup('Nobody here', ['ghost1', 'ghost2'])
    expect(groupTogetherCount(group)).toEqual({ done: 0, total: 0 })
    expect(markGroupPaid('nope')).toBeUndefined()
  })
})
