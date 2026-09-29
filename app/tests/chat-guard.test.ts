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

  it('flags Hindi cash/UPI/buy/sell words (docs/09: Hindi first)', () => {
    for (const text of [
      'मुझे नकद दे दो बर्थ के लिए',
      'यूपीआई पर पैसे भेज दो',
      'लोअर बर्थ के लिए पैसे लगेंगे',
      'मेरी सीट खरीद लो',
      'फोन पे कर दो जल्दी',
      'बर्थ बेच दोगे क्या',
    ]) {
      expect(guardMessage(text).flagged, text).toBe(true)
    }
  })

  it('flags Hinglish transliterations of the same verbs', () => {
    for (const text of [
      'meri seat khareed lo',
      'bech de berth sasti',
      'paise de do jaldi',
      'phone pe kar do',
      'bhej do upi id',
    ]) {
      expect(guardMessage(text).flagged, text).toBe(true)
    }
  })

  it('sees through spaced-out and leet evasion', () => {
    for (const text of [
      'p a y m e 200',
      'U P I par bhej do',
      's-e-l-l my berth cheap',
      'c@sh for berth',
      'pay me $200 now',
    ]) {
      expect(guardMessage(text).flagged, text).toBe(true)
    }
  })

  it('reads phone numbers spelled out as words', () => {
    expect(guardMessage('nine eight two zero zero one two three four five').flagged).toBe(true)
  })

  it('reads a number that is PART words, PART digits', () => {
    /* This line used to assert `false`. `digitsFromWords` dropped the literal
       digit groups and reconstructed only `'8'`, so `nine eight 200 12345`
       reached `PHONE` as both `'9 8 200 12345'` and `'8'` — neither ten
       digits long. That is not a trade-off, it is a bypass, and the test
       recorded it as expected behaviour so it would survive review. */
    expect(guardMessage('call nine eight 200 12345').flagged).toBe(true)
    expect(guardMessage('my number is nine eight 200 12345').flagged).toBe(true)
    /* Letters, not words-with-digits, still evade — see the next test for why
       the reconstruction cannot simply be widened further. */
  })

  it('does not glue unrelated numbers into phantom phones', () => {
    /* Train + date digits must never form a phone number. */
    expect(guardMessage('12951 Rajdhani DOJ 12-11-2026 coach B3 berth 27').flagged).toBe(false)
    expect(guardMessage('PNR 4512789630 confirmed').flagged).toBe(false)
  })

  it('keeps spaced letters in ordinary chat intact', () => {
    for (const text of ['Meet me near the coach door', 'A2 · 36', 'I am at my berth']) {
      expect(guardMessage(text).flagged, text).toBe(false)
    }
  })
})
describe('isRateLimited', () => {
  it('allows a calm chat and slows a flood', () => {
    const now = Date.now()
    expect(isRateLimited([now - 61000, now - 5000])).toBe(false)
    expect(isRateLimited(Array.from({ length: 12 }, () => now - 1000))).toBe(true)
  })
})
describe('guard edge cases', () => {
  it('never flags ordinary meet-up chat', () => {
    for (const text of ["I'm at my berth now", 'Meet me near the coach door', 'Coming in 5 min', 'A2 · 36']) {
      const g = guardMessage(text)
      expect(g.flagged).toBe(false)
      expect(g.hidden).toBe(false)
      expect(g.warningKey).toBeNull()
    }
  })
  it('handles empty and non-string input without throwing', () => {
    expect(guardMessage('').flagged).toBe(false)
    expect(guardMessage(null).flagged).toBe(false)
    expect(guardMessage(undefined).flagged).toBe(false)
  })
  it('rate-limits on the 12th message inside the window, not before', () => {
    const now = Date.now()
    const eleven = Array.from({ length: 11 }, () => now - 1000)
    expect(isRateLimited(eleven)).toBe(false)
    expect(isRateLimited([...eleven, now - 500])).toBe(true)
    expect(isRateLimited(Array.from({ length: 30 }, () => now - 61000))).toBe(false)
  })
})
