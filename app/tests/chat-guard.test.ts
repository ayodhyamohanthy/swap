/* Chat guard: cash/UPI/phone/sell words flagged+hidden; rate limit. */
import { describe, expect, it } from 'vitest'
import { guardMessage, isRateLimited } from '@/lib/chat-guard'

describe('guardMessage', () => {
  it('passes friendly on-board chat', () => {
    expect(guardMessage("I'm at my berth now").flagged).toBe(false)
    expect(guardMessage('Meet me near the coach door').flagged).toBe(false)
  })
  it('flags cash and pay-me words', () => {
    expect(guardMessage('pay me 200 cash').flagged).toBe(true)
    expect(guardMessage('send money on gpay').flagged).toBe(true)
    expect(guardMessage('I will sell my berth for extra charge').flagged).toBe(true)
  })
  it('flags UPI ids and phone numbers', () => {
    expect(guardMessage('pay to arjun.k@okhdfc').flagged).toBe(true)
    expect(guardMessage('call me 98200 12345').flagged).toBe(true)
  })
  it('hides flagged messages behind the cash warning key', () => {
    const g = guardMessage('my upi is test@okhdfc')
    expect(g.hidden).toBe(true)
    expect(g.warningKey).toBe('chat.cashWarning')
  })
})
describe('isRateLimited', () => {
  it('allows a calm chat and slows a flood', () => {
    const now = Date.now()
    expect(isRateLimited([now - 61000, now - 5000])).toBe(false)
    expect(isRateLimited(Array.from({ length: 12 }, () => now - 1000))).toBe(true)
  })
})
