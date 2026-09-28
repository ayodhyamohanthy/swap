/* QA gate - build plan step 14, part 1: 360 px layout + offline.
   Runs without a server, a phone, or a gateway (see qa-webhooks.test.ts for
   the replay half and qa-placeholders.test.ts for the punch-list). */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { beforeEach, describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'
import { CATALOGS } from '@/lib/i18n'
import { isAdminRoute } from '@/lib/admin'
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

  it('keeps the phone clamp on passenger screens and lets /admin out (design 23)', () => {
    /* Both halves are load-bearing. The clamp is what keeps a phone design a
       phone design at a 1180px window (measured 544px); the admin console
       opts out because designs/23 is a ~1080px sidebar console and inside a
       544px column it had ~300px of content (L7 → L1 request). Drop the
       `inColumn &&` and every screen goes full-bleed; drop the isAdminRoute
       call and /admin is back to three-line tiles. */
    expect(isAdminRoute('/admin')).toBe(true)
    expect(isAdminRoute('/admin/activity')).toBe(true)
    expect(isAdminRoute('/adminx')).toBe(false)
    expect(isAdminRoute('/')).toBe(false)
    const shell = read('src/components/app-shell.tsx')
    expect(shell).toMatch(/inColumn && 'app-column'/)
    expect(shell).toMatch(/isAdminRoute\(location\.pathname\)/)
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

describe('Home is two designs, not one screen (25a empty vs 1a with trips)', () => {
  it('keeps the empty-state PNR form out of the with-trips home', () => {
    /* Design 1a: with trips, Home IS the list (plus the FAB). Design 25a: with
       no trips, Home is the pitch. One screen rendering both put "Your trips"
       below a PNR form the traveller no longer needs, under the fold on a
       360 px phone. The guard is source-shaped because the branch structure IS
       the behaviour: trips first, form in the else. */
    const src = read('src/routes/index.tsx')
    const branch = src.indexOf('{hasTrips ? (')
    expect(branch).toBeGreaterThan(-1)
    /* The list comes first, inside the hasTrips branch… */
    expect(src.indexOf("t('home.trips')")).toBeGreaterThan(branch)
    /* …and the form is after the `) : (` that opens the else branch. */
    const elseAt = src.indexOf(') : (', branch)
    expect(elseAt).toBeGreaterThan(branch)
    expect(src.indexOf("t('first.title')")).toBeGreaterThan(elseAt)
    /* The FAB is the with-trips way back into PNR entry (design 1a). */
    expect(src.slice(branch).indexOf("t('home.addPnr')")).toBeGreaterThan(-1)
  })

  it('shows the brand strapline on Home only (design 1a)', () => {
    expect(read('src/routes/index.tsx')).toMatch(/tagline: true/)
    expect(read('src/components/app-shell.tsx')).toMatch(/t\('brand\.tagline'\)/)
    for (const file of ['src/routes/swaps.index.tsx', 'src/routes/profile.index.tsx']) {
      expect(read(file), `${file} must not ask for the Home strapline`).not.toMatch(/tagline: true/)
    }
  })
})

describe('Requests are the design\'s three screens (2a matches, 12b manage, 12c no reply)', () => {
  it('sends to every match by default and counts the ones left ticked', () => {
    /* Design 2a: five matches, five green checks, "Send to 5 · free". Sending
       is free (rule 2), so nothing is opt-IN — the state we keep is who was
       ticked OFF, and the button counts the survivors. A regression to an
       opt-in list would read "Send to 5" over five empty boxes. */
    const src = read('src/routes/request.$id.matches.tsx')
    expect(src).toMatch(/const \[deselected, setDeselected\] = useState<string\[\]>\(\[\]\)/)
    expect(src).toMatch(/const checked = !deselected\.includes\(candidate\.id\)/)
    /* …and the real checkbox stays in the DOM (tap/keyboard/screen readers),
       with the design's check drawn next to it. */
    expect(src).toMatch(/type="checkbox"/)
    expect(src).toMatch(/className="sr-only"/)
    expect(src).toMatch(/checked \? 'border-primary bg-primary text-white'/)
    /* No raw accent checkbox any more: the left-hand native one is gone. */
    expect(src).not.toMatch(/accent-\[var\(--color-primary\)\]/)
  })

  it('keeps the row to what the data model knows (rule 13: no invented names)', () => {
    const src = read('src/routes/request.$id.matches.tsx')
    /* The design names every match; the local pool has no name for a stranger,
       so the row leads with the berth type and draws a person glyph. */
    expect(src).toMatch(/matches\.berthLine/)
    expect(src).toMatch(/<User className="size-5" \/>/)
    /* Berths stay masked before payment (rule 13). */
    expect(src).toMatch(/matches\.berthMasked/)
  })

  it('summarises the request, then offers exactly three actions (design 12b)', () => {
    const src = read('src/routes/request.$id.tsx')
    expect(src).toMatch(/manage\.wanted/)
    expect(src).toMatch(/manage\.waiting/)
    for (const key of ['manage.changeWhat', 'manage.pauseRequest', 'manage.withdrawRequest']) {
      expect(src, `design 12b row ${key}`).toContain(key)
    }
    /* The reassurance card, not a slogan: sending is free, money moves after
       a yes (rule 2). */
    expect(src).toMatch(/manage\.payLater/)
    /* Design 12c names the train it is waiting on. */
    expect(src).toMatch(/manage\.noReplyOn/)
  })

  it('leads the share screen with WhatsApp (design 2b) and keeps every channel', () => {
    const src = read('src/routes/share.$trainDate.tsx')
    expect(src.indexOf("open('whatsapp')")).toBeLessThan(src.indexOf("t('share.native')"))
    for (const platform of ['telegram', 'facebook', 'instagram', 'sms']) {
      expect(src, `docs/01 growth loop keeps ${platform}`).toContain(`open('${platform}')`)
    }
    expect(src).toMatch(/share\.heading/)
  })

  it('ships the new copy in both languages (docs/09)', () => {
    for (const catalog of [en, hi]) {
      expect(catalog.matches.title).toBeTruthy()
      expect(catalog.matches.berthLine).toContain('{type}')
      expect(catalog.manage.wanted).toContain('{berth}')
      expect(catalog.manage.payLater).toBeTruthy()
      expect(catalog.share.whatsappCta).toBeTruthy()
    }
  })
})
