/* SeatSwap matching tests (docs/08 Matching, docs/03 limits, docs/04-B).
   Score = rank (50/35/20) + same coach 10 + keep-together 10 + rating 0-10.
   Candidates must share train/date/class + overlap + CNF + open + inside
   limits + filters respected + berth in choices; quota berths only qualify. */

import { describe, expect, it } from 'vitest'

import {
  MAX_OUTGOING_PER_DAY,
  rankMatches,
  segmentsOverlap,
  type CandidateSpec,
  type RequesterSpec,
} from '@/lib/matching'

const baseRequest: RequesterSpec = {
  train_no: '12951',
  journey_date: '2026-11-12',
  class: '3A',
  from_code: 'MMCT',
  to_code: 'NDLS',
  choices: ['LB', 'MB', 'UB'],
  same_coach: false,
  keep_together: false,
  coach: 'B3',
  quota: 'GN',
}

function candidate(patch: Partial<CandidateSpec> = {}): CandidateSpec {
  return {
    id: 'cand-1',
    user_id: 'user-2',
    train_no: '12951',
    journey_date: '2026-11-12',
    class: '3A',
    from_code: 'BRC',
    to_code: 'NDLS',
    coach: 'B4',
    berth_no: '32',
    berth_type: 'LB',
    status: 'CNF',
    quota: 'GN',
    open_to_swap: true,
    rating: 4.5,
    paused: false,
    women_only: false,
    families_only: false,
    same_coach_only: false,
    ...patch,
  }
}

describe('rankMatches scoring order', () => {
  it('ranks 1st choice above 2nd and 3rd', () => {
    const ranked = rankMatches(baseRequest, [
      candidate({ id: 'third', berth_type: 'UB', rating: 0, coach: 'B9' }),
      candidate({ id: 'second', berth_type: 'MB', rating: 0, coach: 'B9' }),
      candidate({ id: 'first', berth_type: 'LB', rating: 0, coach: 'B9' }),
    ])
    expect(ranked.map((r) => r.id)).toEqual(['first', 'second', 'third'])
    expect(ranked[0].choice_rank).toBe(1)
    expect(ranked[0].score).toBe(50)
    expect(ranked[1].score).toBe(35)
    expect(ranked[2].score).toBe(20)
  })

  it('adds same-coach, keep-together and rating bonuses', () => {
    const req: RequesterSpec = { ...baseRequest, keep_together: true, group_size: 2 }
    const ranked = rankMatches(req, [
      candidate({ id: 'plain', coach: 'B9', rating: 0, together_seats: 1 }),
      candidate({ id: 'bonus', coach: 'B3', rating: 8, together_seats: 2 }),
    ])
    expect(ranked[0].id).toBe('bonus')
    // 50 rank + 10 coach + 10 together + 8 rating
    expect(ranked[0].score).toBe(78)
    expect(ranked[1].score).toBe(50)
  })

  it('clamps rating into 0-10', () => {
    const ranked = rankMatches(baseRequest, [
      candidate({ id: 'high', rating: 99, coach: 'B9' }),
      candidate({ id: 'low', rating: -5, coach: 'B9' }),
    ])
    expect(ranked.find((r) => r.id === 'high')?.score).toBe(60)
    expect(ranked.find((r) => r.id === 'low')?.score).toBe(50)
  })
})

describe('rankMatches hard filters', () => {
  it('requires same train, date and class', () => {
    expect(rankMatches(baseRequest, [candidate({ train_no: '12952' })])).toEqual([])
    expect(rankMatches(baseRequest, [candidate({ journey_date: '2026-11-13' })])).toEqual([])
    expect(rankMatches(baseRequest, [candidate({ class: 'SL' })])).toEqual([])
  })

  it('requires overlapping segments', () => {
    expect(segmentsOverlap({ from_code: 'MMCT', to_code: 'NDLS' }, { from_code: 'BRC', to_code: 'NDLS' })).toBe(true)
    const ranked = rankMatches(baseRequest, [candidate({ from_code: 'MAS', to_code: 'SBC' })])
    expect(ranked).toEqual([])
  })

  it('does not count a connecting journey as an overlap', () => {
    /* I alight at NDLS exactly where the other traveller boards: we share a
       platform, never a leg. Offering a swap here is the false positive that
       matters most — they leave as I arrive. */
    expect(segmentsOverlap({ from_code: 'MMCT', to_code: 'NDLS' }, { from_code: 'NDLS', to_code: 'MAS' })).toBe(false)
    /* Same rule the other way round: they alight at BRC where I board. */
    expect(segmentsOverlap({ from_code: 'BRC', to_code: 'NDLS' }, { from_code: 'MMCT', to_code: 'BRC' })).toBe(false)
    /* Sharing a boarding point or an alighting point IS a shared leg. */
    expect(segmentsOverlap({ from_code: 'MMCT', to_code: 'NDLS' }, { from_code: 'MMCT', to_code: 'BRC' })).toBe(true)
    expect(segmentsOverlap({ from_code: 'BRC', to_code: 'NDLS' }, { from_code: 'MMCT', to_code: 'NDLS' })).toBe(true)
  })

  it('drops a connecting-only traveller from the matches', () => {
    expect(rankMatches(baseRequest, [candidate({ from_code: 'NDLS', to_code: 'MAS' })])).toEqual([])
  })

  it('needs CNF status and an open trip', () => {
    expect(rankMatches(baseRequest, [candidate({ status: 'WL' })])).toEqual([])
    expect(rankMatches(baseRequest, [candidate({ status: 'RAC' })])).toEqual([])
    expect(rankMatches(baseRequest, [candidate({ open_to_swap: false })])).toEqual([])
  })

  it('excludes blocked, paused and abuse-hidden travellers', () => {
    expect(rankMatches(baseRequest, [candidate({ blocked: true })])).toEqual([])
    expect(rankMatches(baseRequest, [candidate({ paused: true })])).toEqual([])
    expect(rankMatches(baseRequest, [candidate({ hidden_for_abuse: true })])).toEqual([])
  })

  it('enforces daily limits (outgoing 10, inbound default 3)', () => {
    const capped: RequesterSpec = { ...baseRequest, sent_today: MAX_OUTGOING_PER_DAY }
    expect(rankMatches(capped, [candidate()])).toEqual([])
    expect(rankMatches(baseRequest, [candidate({ received_today: 3 })])).toEqual([])
    expect(rankMatches(baseRequest, [candidate({ received_today: 2 })]).length).toBe(1)
  })

  it('respects women-only, families-only and same-coach filters', () => {
    expect(rankMatches(baseRequest, [candidate({ women_only: true })])).toEqual([])
    expect(rankMatches({ ...baseRequest, requester_is_woman: true }, [candidate({ women_only: true })]).length).toBe(1)
    expect(rankMatches(baseRequest, [candidate({ families_only: true })])).toEqual([])
    expect(rankMatches({ ...baseRequest, requester_is_family: true }, [candidate({ families_only: true })]).length).toBe(1)
    expect(rankMatches({ ...baseRequest, same_coach: true }, [candidate({ coach: 'B4' })])).toEqual([])
    expect(rankMatches({ ...baseRequest, same_coach: true }, [candidate({ coach: 'B3' })]).length).toBe(1)
    expect(rankMatches(baseRequest, [candidate({ same_coach_only: true, coach: 'B4' })])).toEqual([])
  })

  it('keeps quota berths for qualifying travellers only', () => {
    // Senior-quota berth hidden from a general traveller ...
    expect(rankMatches(baseRequest, [candidate({ quota: 'SS' })])).toEqual([])
    // ... but open to a traveller with the same quota.
    const qualified: RequesterSpec = { ...baseRequest, quota: 'SS' }
    expect(rankMatches(qualified, [candidate({ quota: 'SS' })]).length).toBe(1)
    expect(rankMatches(qualified, [candidate({ quota: 'LD' })])).toEqual([])
  })

  it('needs the berth inside the ranked choices', () => {
    expect(rankMatches({ ...baseRequest, choices: ['LB'] }, [candidate({ berth_type: 'UB' })])).toEqual([])
    expect(rankMatches({ ...baseRequest, choices: [] }, [candidate()])).toEqual([])
  })
})
