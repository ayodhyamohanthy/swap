import { describe, expect, it } from 'vitest'
import { parseShareTrainDate } from '@/routes/share.$trainDate'

describe('parseShareTrainDate', () => {
  it('preserves every component of an ISO journey date', () => {
    expect(parseShareTrainDate('12951-2026-11-12')).toEqual({
      trainNo: '12951',
      journeyDate: '2026-11-12',
    })
  })

  it('keeps the train number and an empty date for an incomplete legacy parameter', () => {
    expect(parseShareTrainDate('12951')).toEqual({
      trainNo: '12951',
      journeyDate: '',
    })
  })
})
