import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import en from '../locales/en.json'
import hi from '../locales/hi.json'

describe('incoming screen with a booking but no open request (e.g. at the daily cap)', () => {
  it('has its own wording and does not say "No trips yet"', () => {
    expect(en.incoming.none).toBeTruthy()
    expect(hi.incoming.none).toBeTruthy()
    expect(en.incoming.none).not.toMatch(/no trips yet/i)
    const src = readFileSync('src/routes/incoming.$id.tsx', 'utf8')
    expect(src).toMatch(/trip \? t\('incoming\.none'\) : t\('swaps\.empty'\)/)
  })
})
