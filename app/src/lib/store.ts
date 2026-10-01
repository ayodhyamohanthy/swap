/* SeatSwap local-first store — Build Plan step 2 (Trips).
   The shapes mirror the Postgres tables in docs/02-DATA-MODEL.md
   (`bookings`, `passengers`, `activity_log`, `wallet_tx`) so step 3 can sync
   these rows 1:1 after Google sign-in.

   Rules this file exists to protect:
   - Works signed out: everything lives on the device until sign-in.
   - A full PNR is never stored: only `pnr_hash` + `pnr_last4`.
   - Every state change writes an `activity_log` row.
   - No free rewards: the wallet starts empty and steps 1-2 can only read it. */

import { trackEvent } from './analytics'
import { isGroupRequestId } from './group-id'
import {
  hashPnr,
  isChairCar,
  isValidPnr,
  pnrLast4,
  type BerthType,
  type Quota,
  type TicketStatus,
  type TravelClass,
} from './pnr'
/* Type-only, so the arrow stays one-way at runtime (`requests.ts` imports this
   file's values). Only the shapes are needed, for `tripWasSwapped`. */
import type { SwapOffer, SwapRequest } from './requests'

export interface Passenger {
  id: string
  label: string
  coach: string | null
  berth_no: string | null
  berth_type: BerthType
  status: TicketStatus
  quota: Quota
  /** Counted in the group, never offered for a swap. */
  is_child_no_berth: boolean
  board_code: string | null
  drop_code: string | null
}

export interface Trip {
  id: string
  /** null while the user is signed out (pre-sign-in local trip). */
  user_id: string | null
  pnr_hash: string
  pnr_last4: string
  train_no: string
  train_name: string
  journey_date: string | null
  from_code: string
  to_code: string
  class: TravelClass
  is_chair_car: boolean
  source: 'typed' | 'sms_paste'
  chart_prepared: boolean
  /** Acceptor side: "I'm open to swap". Earns nothing by itself (rule 5). */
  open_to_swap: boolean
  /** Soft quota note has been read (SS / LD / HP). */
  quota_note_seen: boolean
  /** Waitlist/RAC reminder saved for when the berth confirms. */
  reminder_on: boolean
  passengers: Passenger[]
  created_at: string
  /** Acceptor-side details are added by later steps. */
}

export interface ActivityRow {
  id: string
  actor_id: string | null
  actor_role: 'user' | 'admin' | 'support'
  action: string
  entity: string | null
  entity_id: string | null
  meta: Record<string, unknown>
  created_at: string
}

export interface WalletTx {
  id: string
  user_id: string | null
  amount_paise: number
  kind: 'acceptor_credit' | 'swap_to_credit' | 'used' | 'expired' | 'admin_adjust'
  ref_request_id: string | null
  expires_at: string | null
  created_at: string
}

/** Local mirror of `payments` + `receipts` (docs/02, docs/06). Money in paise.
    `request_id` and `group_id` are the schema's two targets and the schema
    admits exactly one of them — `payments_target CHECK ((request_id IS NULL)
    != (group_id IS NULL))` — so exactly one is non-null here too. */
export interface PaymentRow {
  id: string
  /** The swap request this pays, or null when it pays a group trip. */
  request_id: string | null
  /** The group trip this pays, or null when it pays one swap. `beginGroupCheckout`
      used to pass the group id through `request_id`, which is neither a uuid nor a
      row in `swap_requests`: representable locally, unsyncable. */
  group_id: string | null
  payer_id: string | null
  provider: 'razorpay' | 'paypal' | 'credit'
  provider_ref: string | null
  /** Full price charged: 9900 single, 19900 group. */
  amount_paise: number
  credit_used_paise: number
  currency: 'INR'
  status: 'created' | 'pending' | 'paid' | 'failed'
  /** `SS-#####` once paid (docs/06 receipts). */
  receipt_number: string | null
  created_at: string
  updated_at: string
}

/** Local mirror of `confirmations` (docs/02): one row per side per request. */
export interface ConfirmationRow {
  request_id: string
  /** Which side of the swap answered. */
  side: 'requester' | 'acceptor'
  outcome: 'swapped' | 'no_show' | 'not_possible' | 'changed_mind'
  created_at: string
}

/** Star ratings GIVEN to other travellers' trips (1–5 each). Matches the
    server `profiles.rating` average; local matching reads it back doubled
    (docs/08 scores acceptor rating 0–10). Rating never moves money. */
export interface RatingSum {
  sum: number
  count: number
}

export interface LocalSettings {
  user_id: string | null
  language: string
  easy_mode: boolean
  /** Alerts are asked for after the first request (docs/08). */
  alerts_intent: boolean
  privacy_consented_at: string | null
  note_acknowledged_at: string | null
  /** Acceptor filters (docs/04 B2, `settings` table in docs/02). */
  women_only: boolean
  families_only: boolean
  same_coach_only: boolean
  paused: boolean
  max_requests_per_day: number
  notify_push: boolean
}

export interface AppState {
  trips: Trip[]
  activity: ActivityRow[]
  wallet: WalletTx[]
  payments: PaymentRow[]
  confirmations: ConfirmationRow[]
  ratings: Record<string, RatingSum>
  seen: Record<string, boolean>
  settings: LocalSettings
}

export type StoreErrorCode = 'pnr_invalid' | 'pnr_duplicate' | 'payment_target'

export class StoreError extends Error {
  code: StoreErrorCode
  constructor(code: StoreErrorCode) {
    super(code)
    this.name = 'StoreError'
    this.code = code
  }
}

export interface AddTripInput {
  pnr: string
  train_no: string
  train_name?: string
  journey_date: string
  from_code?: string
  to_code?: string
  class: TravelClass
  source?: 'typed' | 'sms_paste'
  passengers: Array<{
    label?: string
    coach?: string | null
    berth_no?: string | null
    berth_type?: BerthType
    status?: TicketStatus
    quota?: Quota
    is_child_no_berth?: boolean
    board_code?: string | null
    drop_code?: string | null
  }>
}

const KEYS = {
  trips: 'seatswap.trips.v1',
  activity: 'seatswap.activity.v1',
  wallet: 'seatswap.wallet.v1',
  payments: 'seatswap.payments.v1',
  confirmations: 'seatswap.confirmations.v1',
  ratings: 'seatswap.ratings.v1',
  seen: 'seatswap.seen.v1',
  settings: 'seatswap.settings.v1',
} as const

const ACTIVITY_LIMIT = 300

export function uid(): string {
  const c = globalThis.crypto
  if (c && 'randomUUID' in c) return c.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function defaultSettings(): LocalSettings {
  return {
    user_id: null,
    language: 'en',
    easy_mode: false,
    alerts_intent: false,
    privacy_consented_at: null,
    note_acknowledged_at: null,
    /* Acceptor filters (docs/04 B2). */
    women_only: false,
    families_only: false,
    same_coach_only: false,
    paused: false,
    max_requests_per_day: 3,
    notify_push: false,
  }
}

function emptyState(): AppState {
  return {
    trips: [],
    activity: [],
    wallet: [],
    payments: [],
    confirmations: [],
    ratings: {},
    seen: {},
    settings: defaultSettings(),
  }
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function readJSON<T>(key: string, fallback: T): T {
  const store = storage()
  if (!store) return fallback
  try {
    const raw = store.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Put a stored payment row into the shape `payments_target` allows.
 *
 * Rows written before `group_id` existed — and every row the pre-fix
 * `beginGroupCheckout` wrote, because it passed the group id as `request_id` —
 * carry a `grp_…` where the schema has a uuid foreign key to `swap_requests`.
 * The XOR alone would accept those rows; the FK never would, so a paid ₹199
 * family trip on a device could not sync. Moving the value into the column it
 * means is what makes them syncable.
 *
 * This runs on LOAD rather than only on write, and that is the whole reason it
 * is here: a traveller who has already paid must not lose the payment row to a
 * shape change in the code. Losing it would read as "you have not paid", and
 * `beginGroupCheckout` would mint a second ₹199.
 */
function normalisePayment(row: PaymentRow): PaymentRow {
  const requestId = row.request_id ?? null
  const groupId = row.group_id ?? null
  if (requestId !== null) {
    return { ...row, request_id: null, group_id: requestId }
  }
  /* `payments_target` admits exactly one target, so a row carrying both is not
     one the database could hold. The request wins: it is the column every other
     table joins to, and a group payment with no group row behind it is not
     readable anyway. */
  if (requestId !== null && groupId !== null) return { ...row, request_id: requestId, group_id: null }
  return { ...row, request_id: requestId, group_id: groupId }
}

function loadState(): AppState {
  const base = emptyState()
  if (!storage()) return base
  return {
    trips: readJSON<Trip[]>(KEYS.trips, base.trips),
    activity: readJSON<ActivityRow[]>(KEYS.activity, base.activity),
    wallet: readJSON<WalletTx[]>(KEYS.wallet, base.wallet),
    payments: readJSON<PaymentRow[]>(KEYS.payments, base.payments).map(normalisePayment),
    confirmations: readJSON<ConfirmationRow[]>(KEYS.confirmations, base.confirmations),
    ratings: readJSON<Record<string, RatingSum>>(KEYS.ratings, base.ratings),
    seen: readJSON<Record<string, boolean>>(KEYS.seen, base.seen),
    settings: { ...base.settings, ...readJSON<Partial<LocalSettings>>(KEYS.settings, {}) },
  }
}

let snapshot: AppState = loadState()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function commit(next: AppState) {
  snapshot = next
  const store = storage()
  if (store) {
    try {
      store.setItem(KEYS.trips, JSON.stringify(next.trips))
      store.setItem(KEYS.activity, JSON.stringify(next.activity.slice(0, ACTIVITY_LIMIT)))
      store.setItem(KEYS.wallet, JSON.stringify(next.wallet))
      store.setItem(KEYS.payments, JSON.stringify(next.payments))
      store.setItem(KEYS.confirmations, JSON.stringify(next.confirmations))
      store.setItem(KEYS.ratings, JSON.stringify(next.ratings))
      store.setItem(KEYS.seen, JSON.stringify(next.seen))
      store.setItem(KEYS.settings, JSON.stringify(next.settings))
    } catch {
      /* Storage blocked or full: the app keeps working in memory. */
    }
  }
  emit()
}

/* Cross-tab sync: a write in another tab reloads this one. */
const WATCHED_KEYS: readonly string[] = Object.values(KEYS)
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key && WATCHED_KEYS.includes(event.key)) {
      snapshot = loadState()
      emit()
    }
  })
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): AppState {
  return snapshot
}

const SERVER_SNAPSHOT: AppState = emptyState()

export function getServerSnapshot(): AppState {
  return SERVER_SNAPSHOT
}

/** Reset for tests and for "delete my data" (step 13 screen). */
export function resetStore(): void {
  commit(emptyState())
}

/* ------------------------------------------------------------------ *
 * activity_log — every state change writes a row (AGENTS.md)          *
 * ------------------------------------------------------------------ */

export function logActivity(
  action: string,
  meta: Record<string, unknown> = {},
  entity?: { type: string; id: string | null },
): ActivityRow {
  const row: ActivityRow = {
    id: uid(),
    actor_id: snapshot.settings.user_id,
    actor_role: 'user',
    action,
    entity: entity?.type ?? null,
    entity_id: entity?.id ?? null,
    meta,
    created_at: new Date().toISOString(),
  }
  commit({ ...snapshot, activity: [row, ...snapshot.activity].slice(0, ACTIVITY_LIMIT) })
  return row
}

/* ------------------------------------------------------------------ *
 * Trips                                                               *
 * ------------------------------------------------------------------ */

export function trips(): Trip[] {
  return snapshot.trips
}

/** Alias for trips() */
export const listTrips = trips

export function getTrip(id: string | undefined): Trip | undefined {
  if (!id) return undefined
  return snapshot.trips.find((trip) => trip.id === id)
}

/* ------------------------------------------------------------------ *
 * Trip history (design 11a — Home once every journey is in the past). *
 * Pure helpers, so the screen's three states are testable without a   *
 * browser: which trips are past, which swapped, and in what order.    *
 * ------------------------------------------------------------------ */

/** Local calendar day as `YYYY-MM-DD` — the same shape `journey_date` uses,
    so "is this trip past?" is a string compare that a time zone cannot skew.
    Local, not UTC: a journey date is a calendar date where the traveller is.
    Deliberately duplicated from `localDayKey` in lib/admin.ts rather than
    shared — the admin console and the trip list are different lanes' questions
    and a shared helper would couple them. */
export function localDateKey(at: Date = new Date()): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/** A trip is past when its journey date is strictly before today. Today counts
    as upcoming (the traveller is on that train today), and a trip whose date is
    unknown is never guessed into history. */
export function isPastTrip(trip: Trip, todayKey: string): boolean {
  if (!trip.journey_date) return false
  return trip.journey_date < todayKey
}

/** Newest journey first (design 11a lists 12 Jun above 3 May above 18 Apr).
    Copies before sorting; trips with equal dates keep their stored order. */
export function tripsNewestFirst(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => (b.journey_date ?? '').localeCompare(a.journey_date ?? ''))
}

/** Design 11a's "Swapped" pill: did this trip's berth actually change hands?
    `confirmed` is written once, on the locked→confirmed edge (docs/03), and is
    the only honest "the swap happened" signal — `locked` means paid, not done.
    The trip can be on either side: the requester's (`request.trip_id`) or the
    acceptor's (`offer.acceptor_trip_id`). On the acceptor's side only the
    accepted offer counts — `lockRequest` supersedes every other offer, so a
    superseded one must never mark its trip as swapped. */
export function tripWasSwapped(
  tripId: string,
  requests: SwapRequest[],
  offers: SwapOffer[],
): boolean {
  const confirmedIds = new Set(
    requests.filter((row) => row.status === 'confirmed').map((row) => row.id),
  )
  if (requests.some((row) => row.status === 'confirmed' && row.trip_id === tripId)) return true
  return offers.some(
    (offer) =>
      offer.acceptor_trip_id === tripId &&
      offer.status === 'accepted' &&
      confirmedIds.has(offer.request_id),
  )
}

export async function addTrip(input: AddTripInput): Promise<Trip> {
  if (!isValidPnr(input.pnr)) throw new StoreError('pnr_invalid')

  const pnrHash = await hashPnr(input.pnr)
  if (snapshot.trips.some((trip) => trip.pnr_hash === pnrHash)) {
    throw new StoreError('pnr_duplicate')
  }

  const travelClass: TravelClass = input.class
  const chair = isChairCar(travelClass)
  const passengers: Passenger[] = input.passengers.map((passenger, index) => ({
    id: uid(),
    label: passenger.label?.trim() || `Passenger ${index + 1}`,
    coach: passenger.coach?.trim().toUpperCase() || null,
    berth_no: passenger.berth_no?.trim() || null,
    berth_type: passenger.berth_type ?? (chair ? 'WINDOW' : 'LB'),
    status: passenger.status ?? 'CNF',
    quota: passenger.quota ?? 'GN',
    is_child_no_berth: passenger.is_child_no_berth === true,
    board_code: passenger.board_code ?? null,
    drop_code: passenger.drop_code ?? null,
  }))

  const trip: Trip = {
    id: uid(),
    user_id: snapshot.settings.user_id,
    pnr_hash: pnrHash,
    pnr_last4: pnrLast4(input.pnr),
    train_no: input.train_no.trim(),
    train_name: (input.train_name ?? '').trim(),
    journey_date: input.journey_date || null,
    from_code: (input.from_code ?? '').trim().toUpperCase(),
    to_code: (input.to_code ?? '').trim().toUpperCase(),
    class: travelClass,
    is_chair_car: chair,
    source: input.source === 'sms_paste' ? 'sms_paste' : 'typed',
    chart_prepared: false,
    open_to_swap: false,
    quota_note_seen: false,
    reminder_on: false,
    passengers: passengers.length ? passengers : [emptyPassenger(chair)],
    created_at: new Date().toISOString(),
  }

  commit({ ...snapshot, trips: [trip, ...snapshot.trips] })
  logActivity(
    'pnr_added',
    {
      train_no: trip.train_no,
      class: trip.class,
      last4: trip.pnr_last4,
      passengers: trip.passengers.length,
      source: trip.source,
    },
    { type: 'booking', id: trip.id },
  )
  trackEvent('pnr_added', { train_no: trip.train_no, class: trip.class })
  return trip
}

function emptyPassenger(chair: boolean): Passenger {
  return {
    id: uid(),
    label: 'Passenger 1',
    coach: null,
    berth_no: null,
    berth_type: chair ? 'WINDOW' : 'LB',
    status: 'CNF',
    quota: 'GN',
    is_child_no_berth: false,
    board_code: null,
    drop_code: null,
  }
}

export function removeTrip(id: string): void {
  const trip = getTrip(id)
  if (!trip) return
  commit({ ...snapshot, trips: snapshot.trips.filter((row) => row.id !== id) })
  logActivity('trip_removed', { last4: trip.pnr_last4 }, { type: 'booking', id })
}

function patchTrip(id: string, patch: Partial<Trip>): Trip | undefined {
  const current = getTrip(id)
  if (!current) return undefined
  const next = { ...current, ...patch }
  commit({
    ...snapshot,
    trips: snapshot.trips.map((trip) => (trip.id === id ? next : trip)),
  })
  return next
}

/** "I'm open to swap". Earns nothing by itself (rule 5) — a done swap earns ₹50. */
export function setOpenToSwap(id: string, open: boolean): Trip | undefined {
  const trip = patchTrip(id, { open_to_swap: open })
  if (!trip) return undefined
  logActivity(
    open ? 'open_to_swap_on' : 'open_to_swap_off',
    { last4: trip.pnr_last4 },
    { type: 'booking', id },
  )
  return trip
}

export function markQuotaNoteSeen(id: string): Trip | undefined {
  const trip = patchTrip(id, { quota_note_seen: true })
  if (!trip) return undefined
  logActivity(
    'quota_note_seen',
    { quota: trip.passengers[0]?.quota ?? null },
    { type: 'booking', id },
  )
  return trip
}

/** Waitlist/RAC "Remind me" — the update shows in Updates once the berth confirms (step 4+). */
export function setReminder(id: string, on: boolean): Trip | undefined {
  const trip = patchTrip(id, { reminder_on: on })
  if (!trip) return undefined
  logActivity(
    on ? 'reminder_on' : 'reminder_off',
    { status: trip.passengers[0]?.status ?? null },
    { type: 'booking', id },
  )
  return trip
}

/** Chart-is-out flip (docs/08 growth loop 4, design 7c, screen 19). The real
    trigger is the chart-time job or its push; this is the device-side write so
    the push target `/trips/$id` can actually render the state its copy was
    written for — `growth.chartTitle` existed with nothing to render it. */
export function setChartPrepared(id: string, prepared: boolean): Trip | undefined {
  const trip = patchTrip(id, { chart_prepared: prepared })
  if (!trip) return undefined
  logActivity(
    prepared ? 'chart_out' : 'chart_reset',
    { train_no: trip.train_no, journey_date: trip.journey_date },
    { type: 'booking', id },
  )
  return trip
}

/* ------------------------------------------------------------------ *
 * Small flags, settings and the credit ledger (read-only in steps 1-2) *
 * ------------------------------------------------------------------ */

export function seen(key: string): boolean {
  return snapshot.seen[key] === true
}

/** Same check, read as a predicate in screens. */
export const isSeen = seen

export function markSeen(key: string): void {
  if (snapshot.seen[key] === true) return
  commit({ ...snapshot, seen: { ...snapshot.seen, [key]: true } })
}

export function settings(): LocalSettings {
  return snapshot.settings
}

export function updateSettings(patch: Partial<LocalSettings>): LocalSettings {
  const next = { ...snapshot.settings, ...patch }
  commit({ ...snapshot, settings: next })
  return next
}

export function activityLog(): ActivityRow[] {
  return snapshot.activity
}

/** Balance in paise. Credit is never cash and cannot be withdrawn (rule 4). */
export function creditPaise(): number {
  const now = Date.now()
  return snapshot.wallet.reduce((total, tx) => {
    if (tx.expires_at && Date.parse(tx.expires_at) < now) return total
    return total + tx.amount_paise
  }, 0)
}

export interface CreditInput {
  to: 'requester' | 'acceptor'
  /** Always positive paise. Credit is a balance, never a payout. */
  amountPaise: number
  kind: 'acceptor_credit' | 'swap_to_credit'
  ref_request_id?: string | null
  /**
   * Accepted only so `outcomes.CreditWrite` is assignable. The stored expiry is
   * always recomputed as 12 months out (rule 4) — callers cannot shorten or
   * extend credit life by passing this.
   */
  expiresMonths?: number
  /** Defaults to 12 months out — credit expires and is never cash (rule 4). */
  expires_at?: string | null
}

/** Fixed credit values per kind (rules 3, 6) — anything else is rejected so the
    local ledger can never mint arbitrary credit that the database would refuse. */
const CREDIT_AMOUNTS: Record<CreditInput['kind'], number> = {
  acceptor_credit: 5000,
  swap_to_credit: 9900,
}

/**
 * The ONLY way credit enters the ledger (`wallet_tx`, docs/02).
 *
 * Two callers, and nothing else:
 * - the acceptor earns ₹50 when a swap is confirmed as done (rules 3, 5)
 * - a swap that did not happen moves the requester's ₹99 in here, which is
 *   never a bank refund (rule 6)
 *
 * The shape matches `CreditWrite` from `@/lib/outcomes`, so a resolved swap can
 * be applied directly: `resolveConfirmations(...).credits.forEach(credit)`.
 * There is deliberately no "withdraw" or "refund" counterpart. Every write also
 * appends an activity_log row.
 */
export function credit(input: CreditInput): WalletTx {
  if (input.amountPaise !== CREDIT_AMOUNTS[input.kind]) {
    throw new Error('credit_amount_must_match_kind')
  }
  const expires = new Date()
  expires.setMonth(expires.getMonth() + 12)
  const row: WalletTx = {
    id: uid(),
    user_id: snapshot.settings.user_id,
    amount_paise: input.amountPaise,
    kind: input.kind,
    ref_request_id: input.ref_request_id ?? null,
    expires_at: expires.toISOString(),
    created_at: new Date().toISOString(),
  }
  commit({ ...snapshot, wallet: [...snapshot.wallet, row] })
  logActivity(
    'credit_added',
    { to: input.to, amount_paise: input.amountPaise, kind: input.kind },
    { type: 'wallet_tx', id: row.id },
  )
  trackEvent('credit_added', { kind: input.kind, amount_paise: input.amountPaise })
  return row
}

/* ------------------------------------------------------------------ *
 * Payments ledger — local mirror of `payments` + `receipts` (docs/06)  *
 * ------------------------------------------------------------------ */

export function listPayments(): PaymentRow[] {
  return snapshot.payments
}

export function getPayment(id: string | undefined): PaymentRow | undefined {
  if (!id) return undefined
  return snapshot.payments.find((row) => row.id === id)
}

/** The id a payment pays for: one swap request, or one group trip, never both.
 *  Null only on a row that arrived corrupt from storage — `startPayment` cannot
 *  write one, and `normalisePayment` will not invent a target. */
export function paymentTargetId(payment: PaymentRow): string | null {
  return payment.request_id ?? payment.group_id
}

/**
 * Does this payment pay for `targetId`?
 *
 * A payment targets exactly one thing, and that thing may be a swap request OR a
 * group trip — the ₹199 family plan has no `swap_requests` row to hang off
 * (docs/01). Comparing one column is how a paid group trip reads as unpaid:
 * `beginGroupCheckout` looks its payment up by group id, and `paymentFor` is the
 * lookup that makes the idempotency load-bearing.
 */
export function paymentTargets(payment: PaymentRow, targetId: string): boolean {
  return payment.request_id === targetId || payment.group_id === targetId
}

/**
 * The paid payment, else the live one, else the newest.
 *
 * One rule, exported, because the imperative `paymentFor()` and the
 * `usePaymentFor()` hook are the same question asked twice — the two reads of
 * one store — and they were written as two copies of this filter. A copy is
 * where they drift, and a hook that disagrees with the function deciding whether
 * money was taken is a screen that shows the wrong thing with real money behind
 * it.
 */
export function pickPaymentFor(
  rows: readonly PaymentRow[],
  targetId: string,
): PaymentRow | undefined {
  const mine = rows.filter((row) => paymentTargets(row, targetId))
  return mine.find((row) => row.status === 'paid')
    ?? mine.find((row) => row.status === 'pending')
    ?? mine.find((row) => row.status === 'created')
    ?? mine[mine.length - 1]
}

/** The payment that matters for a target: the paid one, else the live one. */
export function paymentFor(targetId: string): PaymentRow | undefined {
  return pickPaymentFor(snapshot.payments, targetId)
}

/**
 * A payment targets exactly one thing (schema `payments_target`): either one
 * swap request, or one group trip. Typed as a union so the two illegal shapes —
 * both, or neither — do not compile. This is the type-level half of a constraint
 * the database already enforces.
 */
export type PaymentTarget =
  | { request_id: string; group_id?: never }
  | { group_id: string; request_id?: never }

/** An intersection, not `interface … extends`: an interface cannot extend a
    union, and losing the union would put back the exact defect this fixes. */
export type StartPaymentInput = PaymentTarget & {
  provider: 'razorpay' | 'paypal' | 'credit'
  amount_paise: number
  credit_used_paise: number
  status?: 'created' | 'pending' | 'paid'
  provider_ref?: string | null
}

/**
 * The two columns, checked at runtime.
 *
 * The union above already refuses both-or-neither at compile time; this is the
 * same XOR for anything that arrived from `localStorage` rather than from
 * TypeScript. The database would reject such an insert, so the local mirror
 * refuses it here instead of storing a row that can never sync.
 */
function paymentTargetOf(target: PaymentTarget): {
  request_id: string | null
  group_id: string | null
} {
  const requestId = target.request_id ?? null
  const groupId = target.group_id ?? null
  /* The XOR, spelled out: both null and both set fail `IS NULL` on one side and
     pass on the other. */
  if ((requestId === null) === (groupId === null)) throw new StoreError('payment_target')
  return { request_id: requestId, group_id: groupId }
}

/**
 * Open (or reuse) the payment for a target. Idempotent: a request that is
 * already paid or still pending never gets a second charge — rule 2 says money
 * moves once, and docs/09 tells the user "please don't pay again".
 */
export function startPayment(input: StartPaymentInput): PaymentRow {
  const target = paymentTargetOf(input)
  /* Non-null by construction: `paymentTargetOf` threw unless exactly one is set. */
  const targetId: string = target.request_id ?? (target.group_id as string)
  const existing = pickPaymentFor(snapshot.payments, targetId)
  if (existing && (existing.status === 'paid' || existing.status === 'pending')) return existing
  const stamp = new Date().toISOString()
  const row: PaymentRow = {
    id: uid(),
    request_id: target.request_id,
    group_id: target.group_id,
    payer_id: snapshot.settings.user_id,
    provider: input.provider,
    provider_ref: input.provider_ref ?? null,
    amount_paise: input.amount_paise,
    credit_used_paise: input.credit_used_paise,
    currency: 'INR',
    status: input.status ?? 'created',
    receipt_number: null,
    created_at: stamp,
    updated_at: stamp,
  }
  commit({ ...snapshot, payments: [...snapshot.payments, row] })
  logActivity(
    'payment_created',
    { provider: row.provider, amount_paise: row.amount_paise, credit_used_paise: row.credit_used_paise },
    { type: 'payment', id: row.id },
  )
  return row
}

/** Receipt numbers look like SS-10482 (docs/06) and never renumber. */
function receiptNumberFrom(paymentId: string): string {
  let hash = 0
  for (const char of paymentId) hash = (hash * 31 + char.charCodeAt(0)) % 90000
  return `SS-${10000 + hash}`
}

/** Move a payment along `created -> pending -> paid | failed` (docs/03). */
export function setPaymentStatus(
  id: string,
  status: PaymentRow['status'],
  providerRef?: string,
): PaymentRow | undefined {
  const current = getPayment(id)
  if (!current) return undefined
  /* A paid payment is final: the webhook is the source of truth and a late
     "pending" from a re-render must never undo a lock. */
  if (current.status === 'paid' && status !== 'paid') return current
  if (current.status === status) return current
  const next: PaymentRow = {
    ...current,
    status,
    provider_ref: providerRef ?? current.provider_ref,
    receipt_number: status === 'paid' && !current.receipt_number
      ? receiptNumberFrom(current.id)
      : current.receipt_number,
    updated_at: new Date().toISOString(),
  }
  commit({
    ...snapshot,
    payments: snapshot.payments.map((row) => (row.id === id ? next : row)),
  })
  /* `amount_paise` is the GROSS price. The gateway only ever captured
     `amount_paise - credit_used_paise`, so an audit row carrying the gross
     alone overstates money received by every rupee of credit spent — and the
     activity log is the system of record (docs/08), which is exactly what a
     later money metric reads. Log the credit alongside it. */
  logActivity(
    status === 'paid' ? 'payment_paid' : status === 'failed' ? 'payment_failed' : 'payment_pending',
    { provider: next.provider, amount_paise: next.amount_paise, credit_used_paise: next.credit_used_paise },
    { type: 'payment', id: next.id },
  )
  /* docs/08 names only created/paid/failed as metrics; pending stays a log row. */
  if (status === 'paid' || status === 'failed') {
    trackEvent(status === 'paid' ? 'payment_paid' : 'payment_failed', {
      amount_paise: next.amount_paise,
      credit_used_paise: next.credit_used_paise,
    })
  }
  return next
}

/**
 * Spend credit against a payment: one negative `wallet_tx` row. There is no
 * refund counterpart — a swap that did not happen goes through
 * `credit(kind='swap_to_credit')` instead (rule 6).
 *
 * `requestId` is nullable and a group payment passes null. `wallet_tx` has no
 * `group_id` of its own — `ref_request_id` is a uuid FK to `swap_requests` — so
 * there is genuinely no swap request to point a group payment's credit spend at,
 * and pointing it at the group id would fail the cast the same way the payment
 * row did. A null reference means "spent, not against one swap", which is what
 * it was.
 */
export function useCredit(amountPaise: number, requestId: string | null): WalletTx | undefined {
  const amount = Math.floor(amountPaise)
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  if (amount > creditPaise()) return undefined
  const row: WalletTx = {
    id: uid(),
    user_id: snapshot.settings.user_id,
    amount_paise: -amount,
    kind: 'used',
    ref_request_id: requestId,
    expires_at: null,
    created_at: new Date().toISOString(),
  }
  commit({ ...snapshot, wallet: [...snapshot.wallet, row] })
  logActivity('credit_used', { amount_paise: amount }, { type: 'wallet_tx', id: row.id })
  trackEvent('credit_used', { amount_paise: amount })
  return row
}

/* ------------------------------------------------------------------ *
 * Confirmations — "Did you swap?" (docs/02, docs/03)                  *
 * ------------------------------------------------------------------ */

export function confirmationsFor(requestId: string): ConfirmationRow[] {
  return snapshot.confirmations.filter((row) => row.request_id === requestId)
}

/** One answer per side; re-answering before the other side replies is allowed. */
export function recordConfirmation(
  requestId: string,
  side: ConfirmationRow['side'],
  outcome: ConfirmationRow['outcome'],
): ConfirmationRow {
  const row: ConfirmationRow = {
    request_id: requestId,
    side,
    outcome,
    created_at: new Date().toISOString(),
  }
  commit({
    ...snapshot,
    confirmations: [
      ...snapshot.confirmations.filter((c) => !(c.request_id === requestId && c.side === side)),
      row,
    ],
  })
  logActivity('confirmation', { side, outcome }, { type: 'swap_request', id: requestId })
  trackEvent('confirmation', { outcome })
  return row
}

/* ------------------------------------------------------------------ *
 * Ratings — stars given to the other traveller's trip (screen 46).
 * Plain sums + counts, averaged on read. Rating never moves money and is
 * never shown publicly with a name attached — it only nudges future match
 * scores (docs/08). Every rating writes an activity_log row.
 * ------------------------------------------------------------------ */

/** Average stars (1–5) given to a trip, or null when nobody rated it yet. */
export function tripRating(tripId: string | undefined): number | null {
  if (!tripId) return null
  const entry = snapshot.ratings[tripId]
  if (!entry || entry.count <= 0) return null
  return entry.sum / entry.count
}

/** Record stars for a trip. Each call adds one rating (no per-rater dedupe
    locally — the server profiles table owns that in step 3). Out-of-range
    values throw instead of silently clamping. */
export function rateTrip(tripId: string, stars: number): RatingSum {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error('rating_range')
  const prev = snapshot.ratings[tripId] ?? { sum: 0, count: 0 }
  const next = { sum: prev.sum + stars, count: prev.count + 1 }
  commit({ ...snapshot, ratings: { ...snapshot.ratings, [tripId]: next } })
  logActivity('rating_given', { stars }, { type: 'booking', id: tripId })
  return next
}

/**
 * Step 3: attach local (signed-out) trips to the account that just signed in.
 * Returns the rows that still need to be pushed to the server.
 */
export function attachToAccount(userId: string): Trip[] {
  const moved = snapshot.trips.map((trip) => (trip.user_id ? trip : { ...trip, user_id: userId }))
  commit({ ...snapshot, trips: moved, settings: { ...snapshot.settings, user_id: userId } })
  logActivity(
    'sign_in',
    { attached_trips: moved.length, method: 'google' },
    { type: 'user', id: userId },
  )
  return moved
}

export function detachFromAccount(): Trip[] {
  const local = snapshot.trips.map((trip) => ({ ...trip, user_id: null }))
  commit({ ...snapshot, trips: local, settings: { ...snapshot.settings, user_id: null } })
  logActivity('sign_out', { local_trips: local.length })
  return local
}

export interface SyncPayload {
  bookings: Array<Omit<Trip, 'passengers' | 'id'> & { local_id: string }>
  passengers: Array<Passenger & { local_booking_id: string }>
  activity: ActivityRow[]
}

/** Step 3 will POST this after sign-in. Steps 1-2 never leave the device. */
export function exportForSync(): SyncPayload {
  const bookings = snapshot.trips.map(({ id, passengers: _passengers, ...rest }) => ({
    local_id: id,
    ...rest,
  }))
  const passengers = snapshot.trips.flatMap((trip) =>
    trip.passengers.map((passenger) => ({ ...passenger, local_booking_id: trip.id })),
  )
  return { bookings, passengers, activity: snapshot.activity }
}
