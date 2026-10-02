/* e2e/support.ts — shared fixtures for the Playwright suite.
 *
 * WHY SEEDING GOES THROUGH `addInitScript`. `lib/store.ts` runs `loadState()`
 * at MODULE scope and caches the snapshot, and `lib/requests.ts` hydrates the
 * same way on first use — so state written after the page has loaded is never
 * seen by the code under test. The only reliable injection point is before any
 * page script runs, which is exactly what `addInitScript` does. This is the
 * browser-side equivalent of what `tests/qa-layout-offline.test.ts` does through
 * the store API, and the shapes below mirror `addTrip()` field for field.
 *
 * WHY THE SEED IS EXPLICIT RATHER THAN A SNAPSHOT FIXTURE. Every field these
 * tests need is one the app itself decides (`open_to_swap`, `status`,
 * `journey_date`); a copied localStorage blob would silently start lying the day
 * a migration changes the key or the shape, and a fixture that lies is worse
 * than no fixture. The rows are built here from the interfaces in
 * `lib/store.ts` / `lib/requests.ts`, so a type change fails `npm run typecheck`
 * before it can fail a run.
 *
 * ERROR WATCH. Deep links on the BUILT app are a known, documented case: only
 * `/` is prerendered, so loading any other route hydrates the home shell and
 * reports exactly ONE React hydration error (docs/14, L1 row; the smoke scripts
 * assert the same count). "Tolerate it" without a budget would be the failure
 * mode this repo keeps recording, so the budget is explicit and every OTHER
 * console error fails the test. */

import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/** Default language + the onboarding/sign-in flags the app marks as seen. */
export const SEEN_ALL = {
  language: true,
  note: true,
  privacy: true,
  alerts: true,
  signin_asked: true,
} as const

/** `YYYY-MM-DD` for `days` from now — keeps seeded trips in the future, which
 *  is what makes Home render the "Your trips" branch (`store.ts` compares the
 *  journey day against today). Computed at run time so the suite does not rot
 *  into past-dated fixtures. */
export function journeyDate(days = 30): string {
  const date = new Date(Date.now() + days * 86_400_000)
  return date.toISOString().slice(0, 10)
}

interface PassengerSeed {
  id: string
  label: string
  coach: string | null
  berth_no: string | null
  berth_type: string
  status: string
  quota: string
  is_child_no_berth: boolean
  board_code: string | null
  drop_code: string | null
}

export interface TripSeed {
  id: string
  user_id: string | null
  pnr_hash: string
  pnr_last4: string
  train_no: string
  train_name: string
  journey_date: string | null
  from_code: string
  to_code: string
  class: string
  is_chair_car: boolean
  source: string
  chart_prepared: boolean
  open_to_swap: boolean
  quota_note_seen: boolean
  reminder_on: boolean
  passengers: PassengerSeed[]
  created_at: string
}

export interface RequestSeed {
  id: string
  trip_id: string
  requester_id: string | null
  group_id: string | null
  choices: string[]
  same_coach: boolean
  keep_together: boolean
  reason_key: string | null
  status: string
  paused: boolean
  locked_offer_id: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

export interface OfferSeed {
  id: string
  request_id: string
  acceptor_trip_id: string
  acceptor_name: string
  acceptor_berth_type: string
  acceptor_coach: string | null
  acceptor_berth_no: string | null
  matched_choice_rank: 1 | 2 | 3
  status: string
  created_at: string
  responded_at: string | null
}

/** A confirmed trip shaped exactly like `addTrip()` writes it. */
export function trip(overrides: Partial<TripSeed> & { id: string; pnr_last4: string }): TripSeed {
  const coach = overrides.passengers?.[0]?.coach ?? 'B3'
  const berthNo = overrides.passengers?.[0]?.berth_no ?? '27'
  const berthType = overrides.passengers?.[0]?.berth_type ?? 'LB'
  const created = new Date().toISOString()
  return {
    user_id: null,
    pnr_hash: `hash-${overrides.id}`,
    train_no: '12951',
    train_name: '',
    journey_date: journeyDate(),
    from_code: 'MMCT',
    to_code: 'NDLS',
    class: '3A',
    is_chair_car: false,
    source: 'typed',
    chart_prepared: false,
    open_to_swap: false,
    quota_note_seen: true,
    reminder_on: false,
    created_at: created,
    ...overrides,
    passengers: [
      {
        id: `p_${overrides.id}`,
        label: 'Passenger 1',
        coach,
        berth_no: berthNo,
        berth_type: berthType,
        status: 'CNF',
        quota: 'GN',
        is_child_no_berth: false,
        board_code: null,
        drop_code: null,
        ...(overrides.passengers?.[0] ?? {}),
      },
    ],
  }
}

export function requestRow(overrides: Partial<RequestSeed> & { id: string; trip_id: string }): RequestSeed {
  const stamp = new Date(Date.now() - 3_600_000).toISOString()
  return {
    requester_id: null,
    group_id: null,
    choices: ['UB'],
    same_coach: false,
    keep_together: false,
    reason_key: null,
    status: 'accepted_awaiting_payment',
    paused: false,
    locked_offer_id: null,
    sent_at: stamp,
    created_at: stamp,
    updated_at: stamp,
    ...overrides,
  }
}

export function offerRow(
  overrides: Partial<OfferSeed> & { id: string; request_id: string; acceptor_trip_id: string },
): OfferSeed {
  const stamp = new Date(Date.now() - 1_800_000).toISOString()
  return {
    acceptor_name: 'Traveller',
    acceptor_berth_type: 'UB',
    acceptor_coach: 'B6',
    acceptor_berth_no: '41',
    matched_choice_rank: 1,
    status: 'accepted',
    created_at: stamp,
    responded_at: stamp,
    ...overrides,
  }
}

export interface SeedOptions {
  trips?: TripSeed[]
  requests?: RequestSeed[]
  offers?: OfferSeed[]
  /** Overrides for the `seatswap.seen.v1` flags — e.g. dropping
   *  `signin_asked` to assert the first-send sign-in hop (agents.md rule 8). */
  seen?: Partial<Record<string, boolean>>
  /** Skip the onboarding flags entirely (default is: everything seen). */
  fresh?: boolean
}

/**
 * Install the seeded state before any app script runs.
 * Must be awaited BEFORE the first `page.goto` of the test.
 */
export async function seed(page: Page, options: SeedOptions = {}): Promise<void> {
  const seen = options.fresh ? (options.seen ?? {}) : { ...SEEN_ALL, ...(options.seen ?? {}) }
  const payload = {
    seen,
    trips: options.trips ?? [],
    requests: options.requests ?? [],
    offers: options.offers ?? [],
  }
  await page.addInitScript((data) => {
    const write = (key: string, value: unknown) => window.localStorage.setItem(key, JSON.stringify(value))
    window.localStorage.setItem('seatswap.lang.v1', 'en')
    write('seatswap.seen.v1', data.seen)
    write('seatswap.trips.v1', data.trips)
    write('seatswap.requests.v1', {
      requests: data.requests,
      offers: data.offers,
      incoming: {},
    })
  }, payload)
}

/** Console + page errors, in order, prefixed so the source is obvious. */
export interface ErrorWatch {
  errors: string[]
}

export function watchPage(page: Page): ErrorWatch {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message.split('\n')[0]}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().split('\n')[0]}`)
  })
  return { errors }
}

/* The documented deep-link case: React reports a minified hydration error in a
   production build. 418/423/425 are React's hydration codes; the literal
   "hydrat" covers dev builds and the attribute-mismatch wording. */
const HYDRATION = /hydrat|minified react error #(418|423|425)/i

/**
 * Fail on any console error that is not the documented deep-link hydration
 * failure, and fail if even THAT exceeds `budget`.
 *
 * `budget: 0` is for `/`, which is prerendered: the client renders what the
 * server wrote, so there is nothing to hydrate against and zero is the honest
 * expectation (docs/14 L1 row: "`/` 0 console errors, every deep link exactly 1").
 */
export function assertOnlyHydration(watch: ErrorWatch, budget: number): void {
  const hydration = watch.errors.filter((line) => HYDRATION.test(line))
  const other = watch.errors.filter((line) => !HYDRATION.test(line))
  expect(other, 'console/page errors other than the documented deep-link hydration failure').toEqual([])
  expect(hydration.length, 'hydration errors').toBeLessThanOrEqual(budget)
}
