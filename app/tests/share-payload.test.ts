import { describe, expect, it } from 'vitest'
import { CATALOGS } from '@/lib/i18n'
import { INSTAGRAM_INBOX_URL, instagramClipboardText, inviteLink, shareDateLabel } from '@/lib/share'

describe('share payload', () => {
  it('formats the journey date for strangers, never a broken one', () => {
    expect(shareDateLabel('2026-11-12')).toBe('12 Nov 2026')
    expect(shareDateLabel('')).toBe('')
    expect(shareDateLabel(null)).toBe('')
    expect(shareDateLabel('2026-13-40')).toBe('')
    expect(shareDateLabel('12/11/2026')).toBe('')
  })
  it('instagram carries message AND link, and opens a real https target', () => {
    const link = inviteLink('https://x.test', '12752-2026-11-12')
    const text = instagramClipboardText('Swap with me on 12752', link)
    expect(text).toContain('12752')
    expect(text).toContain(link)
    expect(link).toContain('date=2026-11-12')
    expect(INSTAGRAM_INBOX_URL.startsWith('https://')).toBe(true)
  })
  it('dated and QR copy exist in both languages with the placeholders they need', () => {
    for (const lang of ['en', 'hi'] as const) {
      const s = CATALOGS[lang].share
      expect(s.messageDated).toContain('{train}')
      expect(s.messageDated).toContain('{date}')
      expect(s.qrScan).toContain('{date}')
      expect(s.qrHeading.length).toBeGreaterThan(0)
      expect(s.instagramCopied.length).toBeGreaterThan(0)
      expect(CATALOGS[lang].shareCard.bodyDated).toContain('{date}')
    }
  })
})
