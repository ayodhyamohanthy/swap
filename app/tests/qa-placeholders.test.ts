/* QA gate — placeholders punch-list (docs/10: nothing ships as an example).
   Domain: the CNAME already ships toyoufromme.website, so the check pins that
   the app builds its links from the device origin — never a hard-coded
   planned domain that rots after launch. */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'
import { DEMO_FALLBACK_NAME, DEMO_FALLBACK_NAME_KEY } from '@/lib/demo-swap'
import { CATALOGS } from '@/lib/i18n'

const APP = join(import.meta.dirname, '..')

function read(rel: string): string {
  return readFileSync(join(APP, rel), 'utf8')
}

function catalogValue(catalog: typeof en, key: string): string | undefined {
  let current: unknown = catalog
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

describe('placeholders punch-list (docs/10: nothing ships as an example)', () => {
  it('builds share links from the device origin, never a hard-coded domain', () => {
    for (const file of [
      'src/routes/share.$trainDate.tsx',
      'src/routes/swaps.$id.share.tsx',
      'src/routes/s.$code.tsx',
      'src/lib/invites.ts',
      'src/components/app-shell.tsx',
    ]) {
      expect(read(file)).not.toMatch(/toyoufromme/i)
    }
    expect(JSON.stringify(en)).not.toMatch(/toyoufromme/i)
    expect(JSON.stringify(hi)).not.toMatch(/toyoufromme/i)
  })

  it('uses no made-up person as copy or as a fixture fallback', () => {
    expect(DEMO_FALLBACK_NAME_KEY).toBe('common.traveller')
    expect(DEMO_FALLBACK_NAME).toBe('Traveller')
    expect(catalogValue(en, DEMO_FALLBACK_NAME_KEY)).toBe('Traveller')
    expect(catalogValue(hi, DEMO_FALLBACK_NAME_KEY)).toBeDefined()
    for (const name of ['Arjun', 'Priya', 'Riya']) {
      expect(JSON.stringify(en), `en copy names ${name}`).not.toContain(name)
      expect(JSON.stringify(hi), `hi copy names ${name}`).not.toContain(name)
      expect(read('src/lib/demo-swap.ts'), `demo fallback names ${name}`).not.toContain(`'${name}'`)
    }
  })

  it('computes the PayPal estimate from the charge instead of a frozen US$1.20', () => {
    expect(JSON.stringify(en)).not.toContain('US$1.20')
    expect(JSON.stringify(hi)).not.toContain('US$1.20')
    expect(CATALOGS.en.pay.paypalDue).toContain('{usd}')
    expect(CATALOGS.en.pay.paypalNote).toContain('{usd}')
    expect(CATALOGS.hi.pay.paypalDue).toContain('{usd}')
  })
})
