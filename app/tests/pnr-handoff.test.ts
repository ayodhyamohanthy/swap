/* Rule 13 in one line: the app never holds a PNR in plain text — the store
   keeps `pnr_hash` + `pnr_last4` and nothing else. Home's quick-entry box used
   to break that by handing its digits to /trips/add as a URL query, which the
   browser keeps in history, shows in the tab switcher and forwards as a
   referrer. The hop now goes through sessionStorage. */
import { beforeEach, describe, expect, it } from 'vitest'

import { clearStagedPnr, readStagedPnr, stagePnr } from '@/lib/pnr'

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path')
const APP = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8')

describe('the Home → Add PNR hop', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    clearStagedPnr()
  })

  it('carries the digits to the next screen', () => {
    stagePnr('4512789648')
    expect(readStagedPnr()).toBe('4512789648')
  })

  it('reads the same twice, because StrictMode runs the initialiser twice', () => {
    stagePnr('4512789648')
    expect(readStagedPnr()).toBe('4512789648')
    expect(readStagedPnr()).toBe('4512789648')
  })

  it('is gone once the screen has taken it', () => {
    stagePnr('4512789648')
    clearStagedPnr()
    expect(readStagedPnr()).toBe('')
    expect(window.sessionStorage.getItem('seatswap.pnr.handoff')).toBeNull()
  })

  it('starts blank on a reload, like any other empty form', () => {
    expect(readStagedPnr()).toBe('')
  })
})

describe('no PNR in a URL', () => {
  it('stops sending it as a query param', () => {
    expect(read('src/routes/index.tsx')).not.toMatch(/search:\s*\{\s*pnr/)
    const add = read('src/routes/trips.add.tsx')
    expect(add).not.toMatch(/pnr\?:\s*string/)
    expect(add).toMatch(/useState\(\(\) => readStagedPnr\(\)\)/)
    expect(add).toMatch(/clearStagedPnr\(\)/)
  })

  it('is not smuggled in from any other screen either', () => {
    for (const file of ['src/routes/check.tsx', 'src/routes/train.$number.tsx', 'src/routes/share.$trainDate.tsx']) {
      expect(read(file), `${file} puts a PNR in the address bar`).not.toMatch(/search[^\n]*\bpnr:/)
    }
  })
})
