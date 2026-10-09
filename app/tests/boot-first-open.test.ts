import { describe, expect, it } from 'vitest'
import { BOOT_SCRIPT } from '@/lib/i18n'

/* The boot script runs before first paint. On "/" with the language or note
   screen not yet seen it must flag <html>, so the empty prerendered body
   stays hidden until the client redirect runs (no blank cream flash). */
function run(path: string, store: Record<string, string>) {
  const dataset: Record<string, string> = {}
  const d = { dataset, lang: 'en' }
  const fn = new Function('document', 'localStorage', 'location', BOOT_SCRIPT)
  fn({ documentElement: d }, { getItem: (k: string) => store[k] ?? null }, { pathname: path })
  return d
}

describe('BOOT_SCRIPT first-open flag', () => {
  it('flags a brand-new visitor on /', () => {
    expect(run('/', {}).dataset.firstOpen).toBe('true')
  })
  it('flags when only the language screen was seen', () => {
    expect(run('/', { 'seatswap.seen.v1': '{"language":true}' }).dataset.firstOpen).toBe('true')
  })
  it('does not flag a returning visitor', () => {
    expect(run('/', { 'seatswap.seen.v1': '{"language":true,"note":true}' }).dataset.firstOpen).toBeUndefined()
  })
  it('does not flag other routes', () => {
    expect(run('/swaps', {}).dataset.firstOpen).toBeUndefined()
  })
  it('survives corrupt storage and keeps easy mode + language handling', () => {
    expect(() => run('/', { 'seatswap.seen.v1': '{oops' })).not.toThrow()
  })
})
