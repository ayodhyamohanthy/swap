/* SeatSwap admin client-safe helpers (docs/04-D, docs/08).
   SPLIT: has_role() is NEVER called here. Server guard lives in
   `@/server/admin` (createServerFn + Postgres has_role/is_staff).
   This file: route meta, pure CSV exporters, overview aggregates,
   activity filters, demo-mode admin_action log. Money = paise. */

import { logActivity, type ActivityRow, type PaymentRow, type Trip } from './store'
import { formatRupees } from './money'
import { trackEvent } from './analytics'
import { isSupabaseConfigured } from './supabase'
import type { MessageKey } from './i18n'
import {
  adminAdjustCredit,
  adminBlockUser,
  adminCloseReport,
  adminMarkDone,
  adminMoveToCredit,
  adminResolveDispute,
} from '@/server/admin'

export type AdminRole = 'admin' | 'support'

/** Route meta only — real gate is server-side (server/admin.ts). */
export const ADMIN_ROUTES = [
  { path: '/admin', label: 'Overview' },
  { path: '/admin/activity', label: 'Activity log' },
  { path: '/admin/users', label: 'Users' },
  { path: '/admin/swaps', label: 'Swaps' },
  { path: '/admin/payments', label: 'Payments' },
  { path: '/admin/credits', label: 'Credits' },
  { path: '/admin/reports', label: 'Reports' },
] as const

export type AdminRoutePath = (typeof ADMIN_ROUTES)[number]['path']

/** True for /admin and /admin/* — layout chrome only, never a guard. */
export function isAdminRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/** Pure CSV builder shared by all five exporters. Ends with newline. */
export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  return `${lines.join('\n')}\n`
}

export function activityToCsv(rows: ActivityRow[]): string {
  return toCsv(
    ['id', 'created_at', 'actor_id', 'actor_role', 'action', 'entity', 'entity_id', 'meta'],
    rows.map((r) => [r.id, r.created_at, r.actor_id, r.actor_role, r.action, r.entity, r.entity_id, JSON.stringify(r.meta)]),
  )
}

export interface AdminUserRow {
  id: string
  first_name: string
  last_initial: string
  created_at: string
  blocked: boolean
  reported: boolean
  /** Design 16's Trips / Swaps / Credit columns. Credit is in paise. */
  trips: number
  swaps: number
  credit_paise: number
}

export function usersToCsv(rows: AdminUserRow[]): string {
  return toCsv(
    ['id', 'first_name', 'last_initial', 'created_at', 'trips', 'swaps', 'credit_paise', 'blocked', 'reported'],
    rows.map((r) => [r.id, r.first_name, r.last_initial, r.created_at, r.trips, r.swaps, r.credit_paise, r.blocked, r.reported]),
  )
}

export interface AdminSwapRow {
  id: string
  requester_last4: string
  train_no: string
  journey_date: string
  status: string
  updated_at: string
}

export function swapsToCsv(rows: AdminSwapRow[]): string {
  return toCsv(
    ['id', 'requester_last4', 'train_no', 'journey_date', 'status', 'updated_at'],
    rows.map((r) => [r.id, r.requester_last4, r.train_no, r.journey_date, r.status, r.updated_at]),
  )
}
//__PART2__
export interface AdminPaymentRow {
  id: string
  request_id: string
  provider: string
  amount_paise: number
  status: string
  created_at: string
}

export function paymentsToCsv(rows: AdminPaymentRow[]): string {
  return toCsv(
    ['id', 'request_id', 'provider', 'amount_paise', 'status', 'created_at'],
    rows.map((r) => [r.id, r.request_id, r.provider, r.amount_paise, r.status, r.created_at]),
  )
}

export interface AdminCreditRow {
  id: string
  user_last4: string
  amount_paise: number
  kind: string
  expires_at: string
  created_at: string
}

export function creditsToCsv(rows: AdminCreditRow[]): string {
  return toCsv(
    ['id', 'user_last4', 'amount_paise', 'kind', 'expires_at', 'created_at'],
    rows.map((r) => [r.id, r.user_last4, r.amount_paise, r.kind, r.expires_at, r.created_at]),
  )
}

/** Browser download for admin CSV strings. No-op outside the browser. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export interface DemoAdminAction {
  action: string
  target: string
  reason?: string
}

/** Local demo: logs `admin_action` so every admin tap is itself logged. */
export function logDemoAdminAction(detail: DemoAdminAction): ActivityRow {
  trackEvent('admin_action', { action: detail.action })
  return logActivity('admin_action', { ...detail, demo: true }, { type: 'admin', id: detail.target })
}

export type ConsoleAdminAction =
  | 'block_user'
  | 'move_to_credit'
  | 'mark_done'
  | 'resolve_dispute'
  | 'adjust_credit'
  | 'close_report'

export interface ConsoleAdminInput {
  target: string
  reason?: string
  amountPaise?: number
  acceptorId?: string
  payerId?: string
  requestId?: string
  resolution?: 'confirmed' | 'voided'
}

/** Demo-visible action names for the local audit row. */
const DEMO_ACTION: Record<ConsoleAdminAction, string> = {
  block_user: 'user_blocked',
  move_to_credit: 'credit_added',
  mark_done: 'confirmation',
  resolve_dispute: 'dispute_resolved',
  adjust_credit: 'credit_added',
  close_report: 'report_closed',
}

/**
 * Where a console action actually landed (docs/04-D).
 *   `applied` — the server ran it. The only outcome that means "it happened".
 *   `device`  — no backend is configured, so the tap is logged on this device.
 *   `failed`  — a backend IS configured and refused it. Nothing happened and
 *               nothing will: the server never replays a device log.
 */
export type AdminActionResult =
  | { outcome: 'applied'; persisted: true; demo: false }
  | { outcome: 'device'; persisted: false; demo: true }
  | { outcome: 'failed'; persisted: false; demo: false }

/** The notice to show for a result: the caller's success copy when the server
    really ran it, otherwise "logged on this device" or "did not go through".
    One definition, so the four consoles cannot drift apart on it. */
export function adminNoticeKey(result: AdminActionResult, success: MessageKey): MessageKey {
  if (result.outcome === 'applied') return success
  return result.outcome === 'device' ? 'admin.actedDemo' : 'admin.actedFailed'
}

/**
 * Run a console action against the server when a backend is configured;
 * otherwise log it on this device so nothing is ever silently dropped
 * (docs/04-D).
 *
 * The device fallback is gated on there being NO backend. It used to catch
 * every error, so a configured backend that *refused* an action (not signed
 * in, `has_role` said no, RLS rejected the write, network down) was reported
 * as a demo: the console said "Logged on this device. The server applies it
 * when connected." — which is false, because nothing replays that log — and
 * wrote an `admin_action` row claiming a block or a credit move that never
 * happened. The activity log is the system of record, so a fabricated row is
 * worse than an error.
 */
export async function runAdminAction(
  action: ConsoleAdminAction,
  input: ConsoleAdminInput,
): Promise<AdminActionResult> {
  const fns = {
    block_user: adminBlockUser,
    move_to_credit: adminMoveToCredit,
    mark_done: adminMarkDone,
    resolve_dispute: adminResolveDispute,
    adjust_credit: adminAdjustCredit,
    close_report: adminCloseReport,
  } as const
  try {
    const result = await fns[action]({ data: input })
    if (!result.persisted) throw new Error('admin_not_persisted')
    /* Tracked once, on the way out — the old code tracked here and again in
       the fallback, so every fallback counted the tap twice. */
    trackEvent('admin_action', { action: DEMO_ACTION[action], persisted: true })
    return { outcome: 'applied', persisted: true, demo: false }
  } catch {
    if (isSupabaseConfigured()) {
      trackEvent('admin_action', { action: DEMO_ACTION[action], persisted: false })
      return { outcome: 'failed', persisted: false, demo: false }
    }
    logDemoAdminAction({ action: DEMO_ACTION[action], target: input.target, reason: input.reason })
    return { outcome: 'device', persisted: false, demo: true }
  }
}

export interface AdminOverviewInput {
  activity: ActivityRow[]
  walletTotalPaise: number
  /** Payments, so "Money in" can subtract credit. `amount_paise` is GROSS. */
  payments: PaymentRow[]
  /** Requests + trips, so a confirmed swap can be attributed to a train. */
  requests: Array<{ id: string; trip_id: string }>
  trips: Array<Pick<Trip, 'id' | 'train_no' | 'train_name'>>
}

export interface AdminOverview {
  pnrsToday: number
  requestsToday: number
  /** Offers an acceptor said yes to today (both acceptance paths). */
  acceptedToday: number
  paidToday: number
  /**
   * Swaps that reached `confirmed` today — one per swap.
   *
   * NOT the same as counting the `confirmation` action: that row is written
   * once PER SIDE (docs/02 `confirmations` is keyed `(request_id,user_id)`),
   * and `recordConfirmation` allows re-answering, so a single swap can log
   * three `confirmation` rows and a half-answered swap logs one. `settleRequest`
   * writes `swap_confirmed` exactly once, on the locked -> confirmed edge.
   */
  swapsDoneToday: number
  /** Rupees the gateway actually captured today: gross minus credit used. */
  moneyInTodayPaise: number
  /** Credit ISSUED today — not the balance still outstanding (rule 4). */
  creditGivenTodayPaise: number
  /** Credit still unspent and unexpired (the wallet balance). */
  creditInCirculationPaise: number
  /**
   * Paid-today rows whose received amount cannot be known — no payment row and
   * no `credit_used_paise` in the log meta. Counted separately so an unknown is
   * never quietly reported as a full collection.
   */
  moneyInUnknownToday: number
  busiestTrains: Array<{ train_no: string; train_name: string; swaps: number }>
  /**
   * Design 23's "Swaps this week": the current Monday–Sunday week, oldest
   * first, always exactly 7 entries.
   */
  swapsThisWeek: SwapDayPoint[]
}

/** One column of the week chart. */
export interface SwapDayPoint {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  /**
   * Confirmed swaps on that day, or `null` for a day that has not happened
   * yet. See `swapsThisWeek` for why those are not zero.
   */
  swaps: number | null
}

/** A finite number from log meta, or null when absent/unusable. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * What the gateway captured for one paid payment, paise — or null when the
 * credit portion is unknown.
 *
 * `checkout.ticket()` already defines the received amount as
 * `max(0, amount_paise - credit_used_paise)`. Summing `amount_paise` alone
 * would count credit as revenue: ₹99 charged with ₹50 of credit collected is
 * ₹49 in the bank, not ₹99. Prefer the payment row (the record); fall back to
 * the log meta for a row whose payment has been pruned.
 */
function moneyInPaise(row: ActivityRow, payments: PaymentRow[]): number | null {
  const payment = payments.find((candidate) => candidate.id === row.entity_id)
  const gross = payment ? payment.amount_paise : num(row.meta.amount_paise)
  const credit = payment ? payment.credit_used_paise : num(row.meta.credit_used_paise)
  if (gross === null || credit === null) return null
  return Math.max(0, gross - credit)
}

/* The console's "today" is the operator's LOCAL day, matching `dayKey()` in
   lib/requests.ts that the daily abuse limits use. This compared UTC calendar
   days, which is the wrong day for the first 5h30m of every IST date — the
   only market we launch in (rule 14) — so the Overview tiles said "PNRs added
   today" while showing yesterday's activity, and anything added between
   midnight and 05:30 IST was attributed to the previous day. */
function localDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/* Every "which day is this" question in this file goes through `localDayKey`.
   The tiles and the week chart must not answer it two different ways: if they
   did, the chart's last point and the "Swaps done" tile could disagree about
   the same swap, which is the exact defect this file keeps having to fix. */
function isToday(iso: string, nowMs: number): boolean {
  return localDayKey(new Date(iso)) === localDayKey(new Date(nowMs))
}

const WEEK_LENGTH = 7

/**
 * Design 23's "Swaps this week": the current Monday–Sunday week, oldest first.
 *
 * Two decisions worth stating, because the design does not settle either one:
 *
 * 1. **Which seven days.** The design's axis is Mon→Sun and its title is
 *    "this week", so this is the calendar week, not a rolling 7-day window.
 *    (The two coincide only on a Sunday, so the mockup cannot distinguish
 *    them; the wording can, and AGENTS.md makes the images the reference for
 *    wording.)
 * 2. **Future days are `null`, not `0`.** A zero means "the day happened and
 *    no swap was confirmed". A day that has not arrived yet has not happened
 *    at all. Drawing them as zero makes the line fall to the floor and stay
 *    there every Monday and Tuesday, which reads as a collapse in swaps
 *    rather than as a week that has barely started.
 *
 * The last non-null entry is today, and it counts `swap_confirmed` by the same
 * `localDayKey` the tiles use — so it equals `swapsDoneToday` by construction,
 * not by coincidence.
 */
export function swapsThisWeek(activity: ActivityRow[], nowMs: number): SwapDayPoint[] {
  const now = new Date(nowMs)
  /* getDay() is 0 = Sunday; shift so Monday is 0 and Sunday is 6. */
  const mondayOffset = (now.getDay() + 6) % 7
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset)

  const counts = new Map<string, number>()
  for (const row of activity) {
    if (row.action !== 'swap_confirmed') continue
    const key = localDayKey(new Date(row.created_at))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const todayKey = localDayKey(now)
  const points: SwapDayPoint[] = []
  for (let index = 0; index < WEEK_LENGTH; index += 1) {
    /* The Date constructor normalises day overflow, so this crosses month and
       year boundaries without special-casing. */
    const key = localDayKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index))
    /* `YYYY-MM-DD` sorts lexicographically, so a string compare is a date
       compare. */
    points.push({ day: key, swaps: key > todayKey ? null : (counts.get(key) ?? 0) })
  }
  return points
}

/** Today's tiles from local rows (design 23). Every number is derived; none
    is a placeholder. */
export function buildOverview(input: AdminOverviewInput, nowMs = Date.now()): AdminOverview {
  const today = input.activity.filter((row) => isToday(row.created_at, nowMs))
  const count = (action: string): number => today.filter((row) => row.action === action).length

  let moneyInTodayPaise = 0
  let moneyInUnknownToday = 0
  for (const row of today) {
    if (row.action !== 'payment_paid') continue
    const received = moneyInPaise(row, input.payments)
    if (received === null) moneyInUnknownToday += 1
    else moneyInTodayPaise += received
  }

  /* Design 23's column is "Swaps done", so only confirmed swaps count. Any row
     carrying a `train_no` used to count here, which made this panel "busiest by
     any activity" — `pnr_added` and the chart toggle both log one. */
  const tripIdForRequest = new Map(input.requests.map((row) => [row.id, row.trip_id]))
  const tripById = new Map(input.trips.map((trip) => [trip.id, trip]))
  const byTrain = new Map<string, { train_no: string; train_name: string; swaps: number }>()
  for (const row of today) {
    if (row.action !== 'swap_confirmed') continue
    const tripId = row.entity_id ? tripIdForRequest.get(row.entity_id) : undefined
    const trip = tripId ? tripById.get(tripId) : undefined
    /* A swap whose trip is gone still counts in `swapsDoneToday`; it just
       cannot be placed on a train. */
    if (!trip) continue
    const entry = byTrain.get(trip.train_no)
      ?? { train_no: trip.train_no, train_name: trip.train_name, swaps: 0 }
    entry.swaps += 1
    byTrain.set(trip.train_no, entry)
  }
  const busiestTrains = [...byTrain.values()]
    .sort((a, b) => b.swaps - a.swaps || (a.train_no < b.train_no ? -1 : 1))
    .slice(0, 5)

  return {
    pnrsToday: count('pnr_added'),
    requestsToday: count('request_sent'),
    acceptedToday: count('offer_accepted'),
    paidToday: count('payment_paid'),
    swapsDoneToday: count('swap_confirmed'),
    moneyInTodayPaise,
    /* Signed sum: the store only writes the two fixed rule amounts (₹50
       `acceptor_credit`, ₹99 `swap_to_credit`) plus staff grants, so this
       equals gross credit issued today. */
    creditGivenTodayPaise: today
      .filter((row) => row.action === 'credit_added')
      .reduce((sum, row) => sum + (num(row.meta.amount_paise) ?? 0), 0),
    creditInCirculationPaise: input.walletTotalPaise,
    moneyInUnknownToday,
    busiestTrains,
    /* Deliberately over the WHOLE log, not just `today` — the week starts
       before today for six days out of seven. */
    swapsThisWeek: swapsThisWeek(input.activity, nowMs),
  }
}

/* ------------------------------------------------------------------ *
 * Activity categories (design 15)                                     *
 * ------------------------------------------------------------------ */

/**
 * The console's chips. Design 15 shows All / Requests / Payments / Swaps /
 * Reports / Sign-ins; `trips` and `account` are added because the log really
 * writes trip and settings actions (the design's own table lists "Added PNR")
 * and without them those rows would belong to no chip at all.
 *
 * `other` is deliberately NOT a chip — see `uncategorisedActions`.
 */
export const ACTIVITY_CATEGORIES = [
  'trips',
  'requests',
  'payments',
  'swaps',
  'reports',
  'signins',
  'account',
] as const

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number] | 'other'

/**
 * Which chip an action belongs to.
 *
 * Built from the actions the code actually logs, NOT from docs/08's list —
 * that list omits `swap_confirmed`, `acceptor_backed_out`, `someone_faster`,
 * `meet_answered`, `group_*`, `trip_removed` and the welcome/settings actions,
 * so a map derived from it would drop those rows out of every category.
 * `tests/admin.test.ts` walks `src/` for every `logActivity(...)` call and
 * fails if one of them lands in `other`.
 */
const ACTIVITY_CATEGORY_BY_ACTION: Record<string, ActivityCategory> = {
  /* Trips + groups */
  pnr_added: 'trips',
  trip_removed: 'trips',
  open_to_swap_on: 'trips',
  open_to_swap_off: 'trips',
  quota_note_seen: 'trips',
  reminder_on: 'trips',
  reminder_off: 'trips',
  chart_out: 'trips',
  chart_reset: 'trips',
  sms_paste_parsed: 'trips',
  group_created: 'trips',
  group_linked: 'trips',
  group_paid: 'trips',
  /* Requests + offers */
  request_drafted: 'requests',
  request_sent: 'requests',
  request_capped: 'requests',
  request_paused: 'requests',
  request_resumed: 'requests',
  request_withdrawn: 'requests',
  offer_accepted: 'requests',
  offer_declined: 'requests',
  acceptor_backed_out: 'requests',
  someone_faster: 'requests',
  /* Money + credit */
  payment_created: 'payments',
  payment_pending: 'payments',
  payment_paid: 'payments',
  payment_failed: 'payments',
  credit_added: 'payments',
  credit_used: 'payments',
  /* The swap itself, after money moved */
  swap_locked: 'swaps',
  confirmation: 'swaps',
  swap_confirmed: 'swaps',
  swap_voided: 'swaps',
  dispute_opened: 'swaps',
  dispute_resolved: 'swaps',
  meet_answered: 'swaps',
  rating_given: 'swaps',
  /* Moderation */
  report_filed: 'reports',
  block: 'reports',
  admin_action: 'reports',
  /* Session */
  sign_in: 'signins',
  sign_out: 'signins',
  /* Onboarding + preferences */
  privacy_consented: 'account',
  note_acknowledged: 'account',
  alerts_intent: 'account',
  settings_changed: 'account',
  language_changed: 'account',
  easy_mode_changed: 'account',
  invite_created: 'account',
}

/** The chip an action belongs to, or `other` when nothing claims it. */
export function activityCategory(action: string): ActivityCategory {
  return ACTIVITY_CATEGORY_BY_ACTION[action] ?? 'other'
}

/**
 * The catalogue key for an action's human label (design 15 shows "Added PNR",
 * not `pnr_added`).
 *
 * Derived from the action name, so there is no second list to keep in step
 * with `ACTIVITY_CATEGORY_BY_ACTION` — the naming convention *is* the mapping,
 * and `tests/admin.test.ts` walks every `logActivity()` call and fails if a
 * label is missing from either language. An action with no label renders its
 * own key (`admin.act.some_new_thing`), which is loud rather than silent; the
 * screen also keeps the raw action as a tooltip.
 */
export function activityLabelKey(action: string): MessageKey {
  return `admin.act.${action}` as MessageKey
}

/**
 * Actions present in `rows` that no category claims. The screen renders an
 * "Other" chip when this is non-empty, so an action added without updating the
 * map shows up loudly instead of quietly vanishing from every chip.
 */
export function uncategorisedActions(rows: ActivityRow[]): string[] {
  return [...new Set(rows.map((row) => row.action))]
    .filter((action) => activityCategory(action) === 'other')
    .sort()
}

export interface ActivityFilter {
  action: string | null
  /** `all` matches every category, including `other`. */
  category: ActivityCategory | 'all'
  query: string
}

/** Filter by category and action; search matches user/PNR-last4/train (last4
    only). */
export function filterActivity(rows: ActivityRow[], filter: ActivityFilter): ActivityRow[] {
  const q = filter.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filter.category !== 'all' && activityCategory(row.action) !== filter.category) return false
    if (filter.action && row.action !== filter.action) return false
    if (!q) return true
    const hay = [row.actor_id ?? '', row.action, row.entity ?? '', row.entity_id ?? '', JSON.stringify(row.meta)].join(' ').toLowerCase()
    return hay.includes(q)
  })
}

/** Distinct action names for the filter dropdown. */
export function activityActions(rows: ActivityRow[]): string[] {
  return [...new Set(rows.map((row) => row.action))].sort()
}

/* ------------------------------------------------------------------ *
 * Activity details (design 15's Details column)                       *
 * ------------------------------------------------------------------ */

/** Bounded, single-line values. */
function detailToken(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? text.slice(0, 24) : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function detailCount(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : null
}

/** Money stays in paise on the wire and renders as whole rupees. */
function detailMoney(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? formatRupees(value) : null
}

/**
 * A masked PNR tail. This is the guard, not just a formatter: it keeps only
 * the LAST FOUR characters, so even if a call site one day logged a full
 * 10-digit PNR under `last4`, the column still shows four digits (rule 13).
 */
function detailMasked(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? `····${text.slice(-4)}` : null
}

/** Free text — `report_filed.reason` and the operator's `admin_action.reason`.
    Collapsed to one line and cut short: a reason is a note, not a transcript. */
function detailFreeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat ? flat.slice(0, 40) : null
}

/**
 * What the Details column may render, in reading order.
 *
 * An ALLOW-LIST, never a dump of `meta`. Log meta is written by ~50 call sites
 * and two of them carry caller-controlled values: `settings_changed` stores
 * whatever patch object it was handed, and `report_filed` / `admin_action`
 * store a free-text `reason`. Rendering `meta` wholesale would put all of that
 * in front of an operator, and would silently start showing any field a future
 * call site decides to add — which is how a debug field becomes a data leak.
 */
const DETAIL_FIELDS: ReadonlyArray<[string, (value: unknown) => string | null]> = [
  ['train_no', detailToken],
  ['class', detailToken],
  ['quota', detailToken],
  ['last4', detailMasked],
  ['passengers', detailCount],
  ['matches', detailCount],
  ['limit', detailCount],
  ['rank', detailCount],
  ['stars', detailCount],
  ['filled', detailCount],
  ['trips', detailCount],
  ['attached_trips', detailCount],
  ['local_trips', detailCount],
  ['provider', detailToken],
  ['kind', detailToken],
  ['action', detailToken],
  ['target', detailToken],
  ['side', detailToken],
  ['outcome', detailToken],
  ['status', detailToken],
  ['source', detailToken],
  ['lang', detailToken],
  ['method', detailToken],
  ['amount_paise', detailMoney],
  ['credit_used_paise', detailMoney],
  ['reason', detailFreeText],
]

const DETAIL_SEPARATOR = ' · '
const DETAIL_MAX_LENGTH = 60

/**
 * A short summary of what a row recorded (design 15's Details column).
 *
 * Deliberately **language-neutral** — bare values and `·` separators, no
 * English glue ("3 passengers") — because a secondary column does not justify
 * ~10 glue keys in every language, and the tokens are already the vocabulary
 * the rest of the console uses (train numbers, class codes, provider names).
 * Money is the one exception and goes through `formatRupees`.
 */
export function activityDetails(row: ActivityRow, maxLength = DETAIL_MAX_LENGTH): string {
  const meta = row.meta as Record<string, unknown>
  const parts: string[] = []
  for (const [key, render] of DETAIL_FIELDS) {
    const text = render(meta[key])
    if (text) parts.push(text)
  }
  const joined = parts.join(DETAIL_SEPARATOR)
  return joined.length > maxLength ? `${joined.slice(0, Math.max(1, maxLength - 1))}…` : joined
}

