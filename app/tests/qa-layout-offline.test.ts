/* QA gate - build plan step 14, part 1: 360 px layout + offline.
   Runs without a server, a phone, or a gateway (see qa-webhooks.test.ts for
   the replay half and qa-placeholders.test.ts for the punch-list). */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { beforeEach, describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'
import { CATALOGS } from '@/lib/i18n'
import { enqueue, flush } from '@/lib/outbox'
import { acceptOffer, createRequest, getRequest, lockRequest } from '@/lib/requests'
import { offersFor, resetRequests, sendRequest } from '@/lib/requests'
import { addTrip, getTrip, listTrips, resetStore, setOpenToSwap } from '@/lib/store'

const APP = join(import.meta.dirname, '..')
const DAY = '2026-11-12'

function read(rel: string): string {
  return readFileSync(join(APP, rel), 'utf8')
}

function templateVars(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
}

function catalogValue(catalog: typeof en, key: string): string | undefined {
  let current: unknown = catalog
  for (const part of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : undefined
}

async function seedLocked() {
  const mine = await addTrip({
    pnr: '4512789630', train_no: '12951', journey_date: DAY, class: '3A',
    from_code: 'MMCT', to_code: 'NDLS',
    passengers: [{ coach: 'B3', berth_no: '27', berth_type: 'LB' }],
  })
  const theirs = await addTrip({
    pnr: '4512789648', train_no: '12951', journey_date: DAY, class: '3A',
    from_code: 'MMCT', to_code: 'NDLS',
    passengers: [{ coach: 'B6', berth_no: '12', berth_type: 'UB' }],
  })
  setOpenToSwap(theirs.id, true)
  const request = createRequest({ trip_id: mine.id, choices: ['UB'] })
  sendRequest(request.id)
  const offer = offersFor(request.id)[0]
  acceptOffer(offer.id)
  lockRequest(request.id, offer.id)
  return { mine, theirs, request }
}

describe('360 px layout (step 14: every flow on a 360 px Android phone)', () => {
  it('constrains the tab bar to a phone column', () => {
    expect(read('src/components/app-shell.tsx')).toMatch(/max-w-\[34rem\]/)
  })

  it('ships a device-width viewport with the install theme colour', () => {
    const root = read('src/routes/__root.tsx')
    expect(root).toMatch(/width=device-width/)
    expect(root).toMatch(/viewport-fit=cover/)
    expect(root).toMatch(/#1F6B45/)
  })

  it('renders no raw status enum on the 360 px status surfaces', () => {
    for (const file of ['src/routes/request.$id.tsx', 'src/routes/swaps.$id.index.tsx']) {
      const src = read(file)
      expect(src, `${file} prints a raw enum`).not.toMatch(/\{offer\.status\}|\{request\.status\}/)
      expect(src).toMatch(/requestStatusLabel|statuses/)
    }
  })

  it('fills every interpolation the key 360 px screens render', () => {
    const cases: Array<{ file: string; key: string }> = [
      { file: 'src/routes/index.tsx', key: 'home.empty' },
      { file: 'src/routes/pay.$requestId.method.tsx', key: 'pay.paypalNote' },
      { file: 'src/routes/pay.$requestId.paypal.tsx', key: 'pay.paypalDue' },
      { file: 'src/routes/swaps.$id.summary.tsx', key: 'summary.train' },
      { file: 'src/routes/swaps.$id.summary.tsx', key: 'summary.youGive' },
      { file: 'src/routes/share.$trainDate.tsx', key: 'share.qrOffline' },
    ]
    for (const { file, key } of cases) {
      const src = read(file)
      for (const catalog of [en, hi]) {
        expect(catalogValue(catalog, key), `${key} missing`).toBeDefined()
      }
      for (const variable of templateVars(catalogValue(en, key) as string)) {
        expect(src, `${file} renders ${key} without {${variable}}`).toContain(variable)
      }
    }
    expect(CATALOGS.en.pay.paypalDue).toContain('{usd}')
    expect(CATALOGS.hi.pay.paypalDue).toContain('{usd}')
  })
})

describe('offline (step 14: trips + summary readable, chat queued, shell cached)', () => {
  beforeEach(() => {
    resetStore()
    resetRequests()
    window.localStorage.clear()
  })

  it('reads trips and the locked swap summary from the on-device store', async () => {
    const { mine, request } = await seedLocked()
    expect(getTrip(mine.id)?.train_no).toBe('12951')
    expect(listTrips().length).toBeGreaterThan(0)
    expect(read('src/routes/swaps.$id.summary.tsx')).not.toMatch(/fetch\(|getSupabase\(\)/)
    expect(getRequest(request.id)?.status).toBe('locked')
  })

  it('queues chat drafts offline and flushes oldest-first on reconnect', () => {
    expect(enqueue('c1', '   ')).toBe(0)
    enqueue('c1', 'I am at my berth now')
    enqueue('c1', 'Meet me near the coach door')
    expect(flush('c1')).toEqual(['I am at my berth now', 'Meet me near the coach door'])
    expect(flush('c1')).toEqual([])
  })

  it('shows the coach link for typing when the QR image cannot load', () => {
    const src = read('src/routes/share.$trainDate.tsx')
    expect(src).toContain('share.qrOffline')
    expect(src).not.toMatch(/disabled=\{!online\}/)
  })

  it('keeps the worker offline contract: pages first-network, payments never cached', () => {
    const src = readFileSync(join(APP, 'pwa.workbox.mjs'), 'utf8')
    expect(src).toContain("handler: 'NetworkFirst'")
    expect(src).toContain("handler: 'NetworkOnly'")
    expect(src).toContain("navigateFallback: '/index.html'")
    expect(src).toContain('razorpay')
    expect(src).toContain('paypal')
    expect(src).toContain('api')
  })
})
