import { describe, expect, it } from 'vitest'
import { resolveStaffAccess } from '@/lib/admin'
import en from '../locales/en.json'
import hi from '../locales/hi.json'

describe('which admin screen is drawn', () => {
  it('no backend: demo console, and the check is never asked', async () => {
    let asked = false
    expect(await resolveStaffAccess(false, async () => ((asked = true), { ok: true, uid: 'u1' }))).toBe('demo')
    expect(asked).toBe(false)
  })
  it('backend + server says ok: staff', async () => {
    expect(await resolveStaffAccess(true, async () => ({ ok: true, uid: 'u1' }))).toBe('staff')
  })
  it('backend + refusal, error or odd answer: denied (fails closed)', async () => {
    expect(await resolveStaffAccess(true, async () => { throw new Error('forbidden') })).toBe('denied')
    expect(await resolveStaffAccess(true, async () => { throw new Error('not_signed_in') })).toBe('denied')
    expect(await resolveStaffAccess(true, async () => ({ ok: 'yes' }))).toBe('denied')
    expect(await resolveStaffAccess(true, async () => null)).toBe('denied')
  })
  it('a bare 200 web response is not staff', async () => {
    const page = new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    expect(page.ok).toBe(true)
    expect(await resolveStaffAccess(true, async () => page)).toBe('denied')
    expect(await resolveStaffAccess(true, async () => ({ ok: true }))).toBe('denied')
  })
  it('copy exists in both languages and no longer promises a server replay', () => {
    for (const a of [en.admin, hi.admin]) {
      expect(a.staffOnly).toBeTruthy()
      expect(a.staffOnlyBody).toBeTruthy()
      expect(a.demoBanner).toBeTruthy()
    }
    expect(en.admin.actedDemo).not.toMatch(/server applies/i)
  })
})
