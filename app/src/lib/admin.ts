/* SeatSwap admin client-safe helpers (docs/04-D, docs/08).
   SPLIT: has_role() is NEVER called here. Server guard lives in
   `@/server/admin` (createServerFn + Postgres has_role/is_staff).
   This file: route meta, pure CSV exporters, overview aggregates,
   activity filters, demo-mode admin_action log. Money = paise. */

import { logActivity, type ActivityRow, type PaymentRow, type Trip, type WalletTx } from './store'
/* Type-only: the phase map is keyed by `RequestStatus`, so adding a status to
   the state machine must break the build here rather than at runtime. */
import type { RequestStatus, SwapOffer, SwapRequest } from './requests'
import { formatRupees } from './money'
import { spendableCreditPaise, type CreditLedgerRow } from './payments'
import { trackEvent } from './analytics'
import { isSupabaseConfigured } from './supabase'
import type { MessageKey, LangCode } from './i18n'
import { localeFor } from './i18n'
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
  /** The real `RequestStatus`, not a loose string: the screen builds the
      tooltip key from it, so the type is what keeps the two in step. */
  status: RequestStatus
  /** First name + initial from the accepted offer (rule 13 — never more). */
  acceptor_name: string | null
  /** Money actually collected, `amount − credit_used`. 0 until a payment is
      paid, which is why design 17 prints ₹0 on its waiting row. */
  amount_paise: number
  phase: SwapPhase
  updated_at: string
}

export function swapsToCsv(rows: AdminSwapRow[]): string {
  return toCsv(
    [
      'id',
      'requester_last4',
      'train_no',
      'journey_date',
      'phase',
      'acceptor_name',
      'amount_paise',
      'status',
      'updated_at',
    ],
    rows.map((r) => [
      r.id,
      r.requester_last4,
      r.train_no,
      r.journey_date,
      r.phase,
      r.acceptor_name ?? '',
      r.amount_paise,
      r.status,
      r.updated_at,
    ]),
  )
}

/* ---- design 17's status phases ----
   The design draws five chips: Waiting / Accepted / Paid / Done / To credit.
   `RequestStatus` has **nine** values, and five chips cannot reach four of
   them — including `disputed`, which is the one state an operator most needs
   to find, because it is the only one where money is held and a human has to
   decide. A filter that cannot reach a state is a filter that hides rows.

   So the phases are derived from the state machine and the design's five names
   are kept wherever they map cleanly. `disputed` and `closed` are added, and
   the deviation is recorded on the board rather than quietly widening a chip.
   The cost is two more chips than the design draws; the alternative is rows
   nobody can filter to. */
export const SWAP_PHASES = [
  'waiting',
  'accepted',
  'paid',
  'done',
  'to_credit',
  'disputed',
  'closed',
] as const

export type SwapPhase = (typeof SWAP_PHASES)[number]

/* The chip labels, `all` included. Kept here rather than in the route so a test
   can assert every one resolves in both languages — the failure this catches is
   a chip rendering `admin.phaseToCredit` as literal text, which is exactly the
   class of bug the raw `request.status` enum was. */
export const SWAP_PHASE_LABEL: Record<SwapPhase | 'all', MessageKey> = {
  all: 'admin.swapAll',
  waiting: 'admin.phaseWaiting',
  accepted: 'admin.phaseAccepted',
  paid: 'admin.phasePaid',
  done: 'admin.phaseDone',
  to_credit: 'admin.phaseToCredit',
  disputed: 'admin.phaseDisputed',
  closed: 'admin.phaseClosed',
}

/* A `Record<RequestStatus, SwapPhase>` on purpose: adding a status to the
   union becomes a compile error here, rather than a row that silently renders
   `undefined` and a chip count that no longer adds up. */
const SWAP_PHASE_BY_STATUS: Record<RequestStatus, SwapPhase> = {
  /* No acceptor yet. A draft belongs here rather than in a chip of its own:
     it has no counterparty and no money, so from the operator's seat it is the
     same fact as a search in progress — and the design gives it no chip. */
  draft: 'waiting',
  searching: 'waiting',
  accepted_awaiting_payment: 'accepted',
  /* Money in, waiting on both confirmations. */
  locked: 'paid',
  confirmed: 'done',
  /* Voided: rule 6 sends the ₹99 to the requester's credit, never the bank. */
  voided: 'to_credit',
  disputed: 'disputed',
  /* Ended without a swap and without credit moving. */
  expired: 'closed',
  withdrawn: 'closed',
}

export function swapPhase(status: RequestStatus): SwapPhase {
  return SWAP_PHASE_BY_STATUS[status] ?? 'closed'
}

/** Every status that lands in one phase. The chip counts are built from this. */
export function statusesByPhase(phase: SwapPhase): RequestStatus[] {
  return (Object.keys(SWAP_PHASE_BY_STATUS) as RequestStatus[]).filter(
    (status) => SWAP_PHASE_BY_STATUS[status] === phase,
  )
}

/** Rows in one phase, or every row for `null` — the design's "All" chip. */
export function filterSwaps(rows: AdminSwapRow[], phase: SwapPhase | null): AdminSwapRow[] {
  return phase === null ? rows : rows.filter((row) => row.phase === phase)
}

/**
 * Money actually collected for one request.
 *
 * `amount_paise` is the full price charged (9900 single, 19900 group) and
 * `credit_used_paise` is the part paid from credit, so the cash that arrived is
 * the difference. Design 17 agrees with this definition: it prints **₹49** on a
 * swap part-paid with credit, **₹99** on the ones paid in full, and **₹0** while
 * nothing is paid. It is the same rule `moneyInTodayPaise` uses, and a test pins
 * the two together so a tile and a table on one console cannot disagree.
 */
export function collectedPaise(payment: PaymentRow | undefined): number {
  if (!payment || payment.status !== 'paid') return 0
  return Math.max(0, payment.amount_paise - payment.credit_used_paise)
}

/**
 * The acceptor for a request, in the order the model can be trusted.
 *
 * `locked_offer_id` is authoritative once payment succeeds: `lockRequest`
 * supersedes every other offer but deliberately leaves the locked one
 * `accepted`, so the name survives into Paid and Done. Before that, the first
 * accepted offer is the one awaiting payment. `null` means nobody has accepted
 * yet — which is exactly design 17's `—`.
 */
export function acceptorName(request: SwapRequest, offers: SwapOffer[]): string | null {
  const forRequest = offers.filter((offer) => offer.request_id === request.id)
  const locked = request.locked_offer_id
    ? forRequest.find((offer) => offer.id === request.locked_offer_id)
    : undefined
  if (locked) return locked.acceptor_name
  return forRequest.find((offer) => offer.status === 'accepted')?.acceptor_name ?? null
}

/* ------------------------------------------------------------------ *
 * The swap's own history (design 17's Swap detail panel)              *
 * ------------------------------------------------------------------ */

/**
 * One step of a swap, ready to render.
 *
 * `label` is a catalogue key rather than a sentence: `admin.act.*` already
 * names every one of these actions in both languages, so the timeline reuses
 * the activity log's vocabulary instead of adding a second set of words for
 * the same eight events — the same call `PAYMENT_STATE_LABEL` makes.
 *
 * `details` comes from `activityDetails`, so a step inherits its mask: only
 * four characters of anything logged under `last4` can reach the screen
 * (rule 13).
 */
export interface SwapTimelineEntry {
  /** The log row's own id — a stable key, and what keeps two steps written in
      the same second in a fixed, testable order. */
  id: string
  /** The raw action, for the tooltip and for grepping the log against code. */
  action: string
  label: MessageKey
  details: string
  /** ISO timestamp, verbatim: the screen formats it, the data stays exact. */
  at: string
  tone: ActivityTone
}

/**
 * The payment ids that belong to one request.
 *
 * Design 17's timeline is the one place the two ids have to be joined, and the
 * join only exists on `PaymentRow.request_id` — the payment's *activity* rows
 * carry the payment id, not the request id. Kept here rather than inline in the
 * route so the join is testable without a browser.
 */
export function paymentIdsFor(payments: PaymentRow[], requestId: string): string[] {
  return payments.filter((payment) => payment.request_id === requestId).map((payment) => payment.id)
}

/**
 * The history of one swap, oldest first.
 *
 * Two sources, because a swap's lifecycle and its money are logged as different
 * entities: every request transition (`request_sent`, `offer_accepted`,
 * `swap_locked`, `confirmation`, `swap_confirmed`, `someone_faster`, …) writes
 * `{ type: 'swap_request', id }`, while the payment rows write
 * `{ type: 'payment', id }` and name their request only through
 * `PaymentRow.request_id` (see `paymentIdsFor`). Matching on the request id
 * alone would produce a timeline that jumps from "accepted" to "done" with no
 * payment in it — the step an operator is most often asked about, and the one
 * design 17 draws as a step of its own.
 *
 * Ascending, which is the opposite of the activity log's newest-first order, on
 * purpose: a log answers "what just happened" and is read from the top, a
 * timeline answers "how did this end up here" and can only be read forwards.
 */
export function swapTimeline(
  activity: ActivityRow[],
  requestId: string,
  paymentIds: readonly string[] = [],
): SwapTimelineEntry[] {
  const payments = new Set(paymentIds)
  return activity
    .filter(
      (row) =>
        (row.entity === 'swap_request' && row.entity_id === requestId) ||
        (row.entity === 'payment' && row.entity_id !== null && payments.has(row.entity_id)),
    )
    .map((row) => ({
      id: row.id,
      action: row.action,
      label: activityLabelKey(row.action),
      details: activityDetails(row),
      at: row.created_at,
      tone: activityTone(row.action),
    }))
    .sort((a, b) => stepTime(a.at) - stepTime(b.at) || a.id.localeCompare(b.id))
}

/**
 * A step's timestamp in milliseconds.
 *
 * An unparseable stamp sorts to the top (0) rather than to `NaN`: comparing two
 * `NaN`s returns false both ways, which would leave such a step wherever the
 * sort happened to drop it instead of in a defined place.
 */
function stepTime(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : 0
}

//__PART2__
/* ------------------------------------------------------------------ *
 * Payments (design 18)                                                *
 * ------------------------------------------------------------------ */

/** `req_a1b2c3d4` → `#a1b2c3d4`. The full id stays as the tooltip and the CSV.
    Lives here rather than in either route because designs 17 and 18 draw the
    same column, and two copies is two chances for the two tables to disagree
    about what a swap is called. */
export function shortId(id: string): string {
  const tail = id.slice(id.indexOf('_') + 1)
  return `#${tail || id}`
}

/**
 * A wallet row PLUS the two fields that say which rule issued it.
 *
 * `CreditLedgerRow` (lib/payments) is deliberately narrow — `id`,
 * `amount_paise`, `expires_at`. That is enough to sum a balance and not enough
 * to answer "was this the ₹50 thank-you or the ₹99 fallback?", which is why
 * design 18's "Moved to credit" tile was written off as needing a definition
 * it did not have. The ledger CAN tell the two apart (`WalletTx.kind`); the
 * *view* of it could not.
 *
 * Both extra fields are required, so a caller holding only a `CreditLedgerRow`
 * gets a compile error rather than an empty result that reads as "no credit
 * ever moved" — the same reasoning as `AdminOverviewInput.wallet` taking the
 * ledger instead of a pre-summed number.
 */
export interface CreditOriginRow extends CreditLedgerRow {
  kind: WalletTx['kind']
  ref_request_id: string | null
}

/** The one kind meaning "a swap did not happen, so the ₹99 became credit"
    (rule 6). The other earn, `acceptor_credit`, is the ₹50 thank-you (rule 3)
    and must never be counted as money moved. */
const SWAP_TO_CREDIT: WalletTx['kind'] = 'swap_to_credit'

/** Request ids whose ₹99 became credit under rule 6. */
export function swapToCreditRequestIds(wallet: CreditOriginRow[]): Set<string> {
  const ids = new Set<string>()
  for (const row of wallet) {
    if (row.kind === SWAP_TO_CREDIT && row.ref_request_id) ids.add(row.ref_request_id)
  }
  return ids
}

export const PAYMENT_OUTCOMES = ['paid', 'to_credit', 'pending', 'failed'] as const
export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number]

/** `paid` and `to_credit` reuse the swap-phase words deliberately: they are the
    same two money states, and design 17 and design 18 both write "Paid" and
    "To credit". One wording for one state, so the two screens cannot drift
    into different names for the same thing. */
export const PAYMENT_OUTCOME_LABEL: Record<PaymentOutcome, MessageKey> = {
  paid: 'admin.phasePaid',
  to_credit: 'admin.phaseToCredit',
  pending: 'admin.payPending',
  failed: 'admin.payFailed',
}

/** The exact payment state, for the tooltip behind the coarse outcome. Reuses
    the activity log's own `payment_*` action labels: those four words already
    ship in both languages and they name exactly these four states, so a second
    set would be four more strings to keep in step for no new meaning. Keyed by
    `PaymentRow['status']` so a fifth status breaks the build. */
export const PAYMENT_STATE_LABEL: Record<PaymentRow['status'], MessageKey> = {
  created: 'admin.act.payment_created',
  pending: 'admin.act.payment_pending',
  paid: 'admin.act.payment_paid',
  failed: 'admin.act.payment_failed',
}

/** Keyed by `PaymentRow['status']` so adding a payment status breaks the build
    here rather than rendering an untranslated enum, the same guard
    `SWAP_PHASE_BY_STATUS` uses. */
const PAYMENT_OUTCOME_BY_STATUS: Record<PaymentRow['status'], PaymentOutcome> = {
  created: 'pending',
  pending: 'pending',
  paid: 'paid',
  failed: 'failed',
}

/**
 * Design 18's Status column. `paid` is the payment's own state; `to_credit` is
 * a *swap* outcome layered on it — money that was collected and then moved to
 * the payer's credit because the swap did not happen (rule 6). So a payment is
 * `to_credit` only when it is `paid` AND the ledger holds the rule-6 row for
 * that request, which is the same condition the tile sums.
 */
export function paymentOutcome(
  payment: PaymentRow,
  toCreditRequestIds: ReadonlySet<string>,
): PaymentOutcome {
  const base = PAYMENT_OUTCOME_BY_STATUS[payment.status] ?? 'failed'
  if (base === 'paid' && toCreditRequestIds.has(payment.request_id)) return 'to_credit'
  return base
}

export interface AdminPaymentRow {
  id: string
  request_id: string
  /** The design's Swap column. */
  swap: string
  provider: string
  /** Gross charged: 9900 single, 19900 group. */
  amount_paise: number
  credit_used_paise: number
  /** What the gateway actually captured: `amount − credit_used`. This is the
      design's Amount column — ₹49 on a ₹99 swap paid with ₹50 credit — and the
      same definition as `moneyInTodayPaise` and design 17's Amount. */
  received_paise: number
  status: PaymentRow['status']
  outcome: PaymentOutcome
  created_at: string
}

/** Newest first — an operator's queue is about the top of the list. */
export function paymentRows(
  payments: PaymentRow[],
  wallet: CreditOriginRow[],
): AdminPaymentRow[] {
  const toCredit = swapToCreditRequestIds(wallet)
  return payments
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((payment) => ({
      id: payment.id,
      request_id: payment.request_id,
      swap: shortId(payment.request_id),
      provider: payment.provider,
      amount_paise: payment.amount_paise,
      credit_used_paise: payment.credit_used_paise,
      received_paise: collectedPaise(payment),
      status: payment.status,
      outcome: paymentOutcome(payment, toCredit),
      created_at: payment.created_at,
    }))
}

export interface AdminReportRow {
  id: string
  /** The activity row this came from — the id `close_report` is sent. */
  action: string
  /** Design 18b's Issue column: what was reported, from an allow-list. */
  issue: string | null
  /** Raw reason as logged, never rendered — see `issue`. */
  reason: string
  request_id: string | null
  closed: boolean
  created_at: string
}

/**
 * The Reports queue behind design 18b (User / Issue / Status / Actions).
 *
 * The Issue column is built from an ALLOW-LIST, for the same reason
 * `activityDetails` is one: `report_filed` stores a free-text `reason` written
 * by the traveller (today the only caller passes the literal
 * `'User reported from chat'`, but the type allows a transcript, and a
 * transcript can carry a phone number or a UPI id — exactly what
 * `lib/chat-guard.ts` exists to hide). So the column names the *kind* of
 * report from a bounded vocabulary and falls back to a neutral "Reported",
 * never to the text. `reason` is carried for the export path only, which
 * writes it to a file the operator opened, never to the screen.
 *
 * A `block` and the `report_closed` that answers it are different things, so
 * only `report_filed` rows open. That is what makes Status meaningful: an open
 * report is one with no `report_closed` naming it.
 */
export function reportRows(activity: ActivityRow[]): AdminReportRow[] {
  const closed = new Set(
    activity.filter((row) => row.action === 'report_closed').map((row) => row.entity_id),
  )
  return activity
    .filter((row) => row.action === 'report_filed')
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((row) => {
      const reason = typeof row.meta.reason === 'string' ? row.meta.reason : ''
      const requestId = typeof row.meta.request_id === 'string' ? row.meta.request_id : null
      return {
        id: row.id,
        action: row.action,
        issue: reportIssue(reason),
        reason,
        request_id: requestId,
        /* A report answered by a `report_closed` for the same request is
           closed. Matching on the request rather than the row id is what makes
           the pair joinable at all: `report_closed` is logged by the admin
           action, which only ever has the request in hand. */
        closed: requestId !== null && closed.has(requestId),
        created_at: row.created_at,
      }
    })
}

/** The bounded vocabulary for design 18b's Issue column. A report whose reason
    matches none of these is still reported — `null` becomes the neutral
    "Reported" label, never a guess at what was wrong. */
const REPORT_ISSUES: ReadonlyArray<[RegExp, string]> = [
  [/cash|money|upi|payment/i, 'cash'],
  [/no.?show|didn'?t come|did not come|not show/i, 'no_show'],
  [/abusive|abuse|rude|harass/i, 'abusive'],
  [/wrong|not as booked|different berth/i, 'wrong_berth'],
  [/late|too late|delay/i, 'late'],
]

function reportIssue(reason: string): string | null {
  for (const [pattern, key] of REPORT_ISSUES) {
    if (pattern.test(reason)) return key
  }
  return null
}

export function reportsToCsv(rows: AdminReportRow[]): string {
  return toCsv(
    [
      'id',
      'issue',
      'status',
      'request_id',
      'reason',
      'created_at',
    ],
    rows.map((r) => [
      r.id,
      r.issue ?? 'reported',
      r.closed ? 'closed' : 'open',
      r.request_id,
      /* The raw text leaves here and only here: the CSV is a file the operator
         opened on purpose, where the screen is a thing other people can see. */
      r.reason,
      r.created_at,
    ]),
  )
}

export function paymentsToCsv(rows: AdminPaymentRow[]): string {
  return toCsv(
    [
      'id',
      'swap',
      'request_id',
      'provider',
      'amount_paise',
      'credit_used_paise',
      'received_paise',
      'status',
      'outcome',
      'created_at',
    ],
    rows.map((r) => [
      r.id,
      r.swap,
      r.request_id,
      r.provider,
      r.amount_paise,
      r.credit_used_paise,
      r.received_paise,
      r.status,
      r.outcome,
      r.created_at,
    ]),
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
  /**
   * The signed wallet ledger itself, NOT a pre-summed total. It used to be
   * `walletTotalPaise: number`, and the one caller passed a bare
   * `wallet.reduce(sum amount_paise)` — which includes rows whose `expires_at`
   * has passed, so "Credit in circulation" (documented as unspent AND
   * unexpired) reported expired credit as still circulating. Taking the ledger
   * means the caller cannot get the sum wrong; `creditSummary` is the single
   * definition, and it is shared with the Credits page.
   */
  wallet: CreditLedgerRow[]
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
  /**
   * The rule-6 slice of `creditGivenTodayPaise`: a swap that did not happen, so
   * the requester's ₹99 became credit rather than a bank refund.
   *
   * A SUBSET, by construction — both are summed from the same `credit_added`
   * rows with the same predicate, one narrowed by `kind` — so the two must
   * never be added together. Design 18 draws them as two tiles side by side
   * (₹1,250 "Credit given" and ₹297 "Moved to credit"), which is only coherent
   * because given already contains moved.
   */
  movedToCreditTodayPaise: number
  /** Credit SPENT today, as a positive number. The `used` rows. */
  creditUsedTodayPaise: number
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
  /**
   * Design 23's "First on their train today" donut — the share of today's
   * match searches that came back empty (docs/01 line 38, docs/12 line 78).
   */
  firstOnTrainToday: FirstOnTrain
}

/**
 * Design 23's donut. "You're the first on this train" is the state a user
 * reaches when their request has no matches (docs/04 line 16, docs/09 line 17).
 */
export interface FirstOnTrain {
  /** Searches today that could have matched — capped ones are excluded. */
  searched: number
  /** Of those, how many found nobody. */
  first: number
  /**
   * Rows whose `matches` count could not be read. Excluded from both sides and
   * reported, the same way `moneyInUnknownToday` refuses to guess.
   */
  unknown: number
  /**
   * `first / searched` as a whole percent, or **null** when nobody searched.
   *
   * Null is not zero. Zero means "everyone who looked found someone"; null
   * means "nobody looked". A donut reading 0% on a quiet morning asserts the
   * first, and that is the same defect class as the rest of this file.
   */
  percent: number | null
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

/**
 * Design 23's "First on their train today".
 *
 * Numerator and denominator come from the SAME population — the
 * `matches_viewed` rows the matches screen writes — so the rate cannot be
 * skewed by a mismatch between two different event counts.
 *
 * Two exclusions, both deliberate:
 *
 * 1. **Capped searches.** A user whose 10-a-day send budget is spent has not
 *    failed to find a match; the pool may be full of people. The matches screen
 *    already refuses to show the "you're the first" card in that case
 *    (`request.$id.matches.tsx`), so counting them here would resurrect the
 *    exact lie the card avoids.
 * 2. **Unreadable counts.** A row with no readable `matches` is evidence of
 *    nothing, so it leaves both sides of the ratio and is reported instead.
 */
export function firstOnTrainToday(activity: ActivityRow[]): FirstOnTrain {
  const rows = activity.filter(
    (row) => row.action === 'matches_viewed' && row.meta.capped !== true,
  )
  let first = 0
  let unknown = 0
  for (const row of rows) {
    const matches = num(row.meta.matches)
    if (matches === null) unknown += 1
    else if (matches === 0) first += 1
  }
  const searched = rows.length - unknown
  return {
    searched,
    first,
    unknown,
    percent: searched === 0 ? null : Math.round((first / searched) * 100),
  }
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

/**
 * Design 24's credit tiles, read from the SIGNED wallet ledger (docs/02:
 * "balance = sum(amount) where not expired").
 *
 * THREE numbers, not the design's four. The missing one, "Expiring this month",
 * needs an allocation policy the ledger cannot answer: a `used` row records the
 * TOTAL spent (`planConsumeCredit` returns a single `usedTotal`), not which earn
 * each spend consumed. Reconstructing it means assuming a consumption order —
 * and the order this app actually spends in, earliest expiry first, implies the
 * surviving balance sits on the LATEST-expiring earns. That is the opposite of
 * what a reader would assume from a tile called "expiring this month", so the
 * number would name one thing and measure another. That is the exact defect
 * this file keeps having to fix (see `swapsDoneToday`, `moneyInTodayPaise`), so
 * it is filed rather than invented — docs/14-LANES.md, backlog 4.
 *
 * `givenPaise` and `usedPaise` are ALL-TIME: an expiry does not un-give credit.
 * `given - used - balance` is therefore exactly the credit that has expired
 * away, and a test asserts that identity rather than leaving it implied.
 */
export interface CreditSummary {
  /** Every positive ledger row, ever — credit issued. */
  givenPaise: number
  /** The magnitude of every negative row — credit spent or corrected away. */
  usedPaise: number
  /** What is left to spend right now, floored at zero. */
  balancePaise: number
}

export function creditSummary(wallet: CreditLedgerRow[], nowMs: number): CreditSummary {
  let givenPaise = 0
  let usedPaise = 0
  for (const row of wallet) {
    if (row.amount_paise > 0) givenPaise += row.amount_paise
    else usedPaise += -row.amount_paise
  }
  /* The balance rule is deliberately NOT re-derived here. `spendableCreditPaise`
     is the canonical one, and it floors at zero on purpose: an unfloored sum
     goes negative when an earn expires while the spend it funded does not
     (spends carry no expiry), and a negative balance is not a number to put in
     front of an operator. A second definition here is how `creditPaise` and
     `spendableCreditPaise` would drift apart. */
  return { givenPaise, usedPaise, balancePaise: spendableCreditPaise(wallet, nowMs) }
}

/**
 * Credit issued today, optionally narrowed to one rule.
 *
 * One function rather than two sums, so "Moved to credit" is a strict SUBSET of
 * "Credit given" by construction: same rows, same predicate, one narrower
 * filter. Two independent sums would let a future call site land in one tile
 * and not the other, and nothing would say so.
 */
function creditIssuedPaise(rows: ActivityRow[], kind?: WalletTx['kind']): number {
  return rows
    .filter((row) => row.action === 'credit_added')
    .filter((row) => kind === undefined || row.meta.kind === kind)
    .reduce((sum, row) => sum + (num(row.meta.amount_paise) ?? 0), 0)
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
    creditGivenTodayPaise: creditIssuedPaise(today),
    movedToCreditTodayPaise: creditIssuedPaise(today, SWAP_TO_CREDIT),
    /* `useCredit` stores `-amount` in the wallet but logs the positive
       magnitude, so this sums as-is. Summed raw rather than through `Math.abs`
       on purpose: if a call site ever logged a signed value the tile would go
       negative and say so, where `abs` would quietly make it look right. */
    creditUsedTodayPaise: today
      .filter((row) => row.action === 'credit_used')
      .reduce((sum, row) => sum + (num(row.meta.amount_paise) ?? 0), 0),
    creditInCirculationPaise: creditSummary(input.wallet, nowMs).balancePaise,
    moneyInUnknownToday,
    busiestTrains,
    /* Deliberately over the WHOLE log, not just `today` — the week starts
       before today for six days out of seven. */
    swapsThisWeek: swapsThisWeek(input.activity, nowMs),
    /* The tile says "today", so this one is scoped to today's rows. */
    firstOnTrainToday: firstOnTrainToday(today),
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
  matches_viewed: 'requests',
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

/**
 * Filter by category and action; free text searches the actor id, the action
 * name, the entity and everything inside `meta`.
 *
 * Note what "the actor id" is NOT: it is an opaque account id, never a name.
 * `ActivityRow` has no name field at all — the same missing-peer-row blocker as
 * `admin.users.tsx` and `get_matches()` — so a search for "Riya P" matches
 * nothing. `admin.searchPh` says what this function can actually reach: the
 * action name, the train (`train_no` lives inside `meta`) and the masked PNR
 * tail (`pnr_added` logs `last4`). A full 10-digit PNR is not searchable at
 * all — it is never stored, only four characters of it are.
 */
export function filterActivity(rows: ActivityRow[], filter: ActivityFilter): ActivityRow[] {
  const q = filter.query.trim().toLowerCase()
  const matched = rows.filter((row) => {
    if (filter.category !== 'all' && activityCategory(row.action) !== filter.category) return false
    if (filter.action && row.action !== filter.action) return false
    if (!q) return true
    const hay = [row.actor_id ?? '', row.action, row.entity ?? '', row.entity_id ?? '', JSON.stringify(row.meta)].join(' ').toLowerCase()
    return hay.includes(q)
  })
  /* Newest first, and this has to be explicit. The log is append-ordered, so a
     purely local log happens to come out right — until a row arrives from
     somewhere else. `server/jobs.ts` writes `credit_expired` and
     `request_expired` on a nightly schedule, so a job's rows land at the end of
     the array whatever time they claim, and the audit table showed a 23:14 row
     under a 22:45 one. An operator reading a log backwards is a contradiction
     even when every row is individually correct.

     The id tiebreak matches `userTimelines`: two rows in the same millisecond
     must not swap places between renders. */
  return matched.sort((a, b) =>
    a.created_at === b.created_at ? a.id.localeCompare(b.id) : b.created_at.localeCompare(a.created_at),
  )
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
 * A `true` flag renders as the given token; anything else renders nothing.
 *
 * A factory rather than one shared formatter because the token IS the key name,
 * and this column shows bare tokens (`3A`, `razorpay`) instead of English glue.
 * Without it the cap on a `matches_viewed` row would be invisible to an
 * operator, which is the one thing that row needs to say.
 */
function flagToken(token: string): (value: unknown) => string | null {
  return (value) => (value === true ? token : null)
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
  ['capped', flagToken('capped')],
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

export interface DetailOptions {
  /** Cut the joined summary at this many characters. */
  maxLength?: number
  /**
   * Field names to leave out of the summary.
   *
   * The activity screen passes `['train_no']`: design 15 gives the train its
   * own column, and a number printed twice in the same row reads as two facts
   * rather than one.
   */
  omit?: readonly string[]
}

/**
 * A short summary of what a row recorded (design 15's Details column).
 *
 * Deliberately **language-neutral** — bare values and `·` separators, no
 * English glue ("3 passengers") — because a secondary column does not justify
 * ~10 glue keys in every language, and the tokens are already the vocabulary
 * the rest of the console uses (train numbers, class codes, provider names).
 * Money is the one exception and goes through `formatRupees`.
 */
export function activityDetails(row: ActivityRow, options: DetailOptions = {}): string {
  const { maxLength = DETAIL_MAX_LENGTH, omit } = options
  const meta = row.meta as Record<string, unknown>
  const parts: string[] = []
  for (const [key, render] of DETAIL_FIELDS) {
    if (omit?.includes(key)) continue
    const text = render(meta[key])
    if (text) parts.push(text)
  }
  const joined = parts.join(DETAIL_SEPARATOR)
  return joined.length > maxLength ? `${joined.slice(0, Math.max(1, maxLength - 1))}…` : joined
}

/**
 * The train number on a row, for design 15's own Train column.
 *
 * Read through the same `detailToken` bound the Details column uses, so a
 * `train_no` that is not a bounded string is `null` in both places rather than
 * a number in one and a string in the other.
 */
export function activityTrain(row: ActivityRow): string | null {
  return detailToken((row.meta as Record<string, unknown>).train_no)
}

/* ------------------------------------------------------------------ *
 * User timeline (design 15's right-hand panel)                        *
 * ------------------------------------------------------------------ */

/** One line of the panel: the same row the table draws, plus its actor. */
export interface UserTimelineEntry {
  /** The activity row's own id, so the React key is stable and unique. */
  id: string
  action: string
  at: string
  train: string | null
  /** The Details tokens with the train omitted — the Train is its own column. */
  detail: string
}

/** One actor's history. */
export interface UserTimelineGroup {
  /**
   * The actor id exactly as the log stores it, or `null` for a row with none.
   *
   * Deliberately NOT a name. `ActivityRow` has no name field and the local pool
   * holds no peer rows, so the design's "Riya P" is not derivable — and inventing
   * one would be exactly the fabrication `tests/qa-placeholders.test.ts` bans.
   * A caller that does have a name can map this id to it.
   */
  actorId: string | null
  role: ActivityRow['actor_role']
  /** Newest first, matching both the table and the design. */
  entries: UserTimelineEntry[]
}

/**
 * Design 15's right-hand **User timeline**: one panel per actor, each listing
 * that actor's rows newest-first.
 *
 * **This is the part of design 15 that is derivable today.** The table's User
 * *column* is not — that needs a name — but a panel that groups the log by who
 * acted needs only `actor_id`, which every row already carries. So the panel
 * ships and the column waits, and neither blocks the other.
 *
 * **Automation is grouped separately, and it must be.** `actor_id` is null on
 * rows written by the cron jobs (`server/jobs.ts` writes `support` with
 * `actor_id: 'system'`) and by `server/admin.ts` (`admin`). Filing those under
 * the passenger's id would attribute a scheduled credit-expiry job to a person
 * — the single most misleading thing an audit panel can do — so `null` is its
 * own group and never merges with a real id.
 *
 * Order is stable and total: groups sort by their newest entry descending, so
 * the busiest actor is on top, and two actors who acted in the same millisecond
 * fall back to id order rather than to whatever `Array.sort` felt like.
 */
export function userTimelines(
  rows: ActivityRow[],
  options: { limitPerUser?: number; onlyActor?: string | null } = {},
): UserTimelineGroup[] {
  const { limitPerUser = 8, onlyActor = undefined } = options
  const source =
    onlyActor === undefined
      ? rows
      : rows.filter((row) => (row.actor_id ?? null) === onlyActor)

  const byActor = new Map<string, ActivityRow[]>()
  for (const row of source) {
    /* `null` must be its own bucket, and `Map` would happily collapse a null
       key onto the string "null" — so the bucket key is prefixed by type. */
    const key = row.actor_id === null ? '\u0000null' : `id:${row.actor_id}`
    const bucket = byActor.get(key)
    if (bucket) bucket.push(row)
    else byActor.set(key, [row])
  }

  const groups: UserTimelineGroup[] = []
  for (const [key, bucket] of byActor) {
    /* Newest first. `created_at` is an ISO string, so it sorts as a string; the
       id is the tiebreak so the order cannot depend on input order. */
    const ordered = [...bucket].sort((a, b) =>
      a.created_at === b.created_at
        ? a.id.localeCompare(b.id)
        : b.created_at.localeCompare(a.created_at),
    )
    /* The role is taken from the newest row: an operator who signed in and then
       left a cron job writing as `support` is one group, and the most recent
       statement of who they were is the last thing they did themselves. */
    const role = ordered[0]?.actor_role ?? 'user'
    groups.push({
      actorId: key.startsWith('id:') ? key.slice(3) : null,
      role,
      entries: ordered.slice(0, limitPerUser).map((row) => ({
        id: row.id,
        action: row.action,
        at: row.created_at,
        train: activityTrain(row),
        detail: activityDetails(row, { omit: ['train_no'] }),
      })),
    })
  }

  return groups.sort((a, b) => {
    const newestA = a.entries[0]?.at ?? ''
    const newestB = b.entries[0]?.at ?? ''
    if (newestA === newestB) {
      /* Automation first on a tie: it is the row an operator most often needs
         to find, and it has no other way to be identified. */
      const aKey = a.actorId ?? '\u0000'
      const bKey = b.actorId ?? '\u0000'
      if ((aKey === '\u0000') !== (bKey === '\u0000')) return aKey === '\u0000' ? -1 : 1
      return aKey.localeCompare(bKey)
    }
    return newestB.localeCompare(newestA)
  })
}

/* ------------------------------------------------------------------ *
 * Tone (design 15's row colour)                                       *
 * ------------------------------------------------------------------ */

export type ActivityTone = 'good' | 'warn' | 'bad' | 'neutral'

/**
 * What an action's colour means.
 *
 * Design 15 colours rows by *topic* — a blue paper-plane for a request, purple
 * for a payment. This console has no blue and no purple: the theme is four
 * semantic tokens (`primary` green, `accent` amber, `danger` red, `muted`
 * grey), and inventing three more to decorate a table would break the
 * "semantic Tailwind tokens only" rule for no informational gain.
 *
 * So the row carries two facts on two channels, each doing one job:
 *
 *   - the **icon** says which chip the row belongs to (`activityCategory`)
 *   - the **tone** says whether anything went wrong
 *
 * That is the more useful reading for an audit trail anyway: an operator scans
 * for red, not for "payments". The map is **sparse** — `neutral` is the
 * default — so a newly logged action is grey until someone decides it is not,
 * and there is no second full list to keep in step with the category map.
 * `tests/admin.test.ts` fails if a key here is not a real action.
 */
const ACTIVITY_TONE_BY_ACTION: Record<string, Exclude<ActivityTone, 'neutral'>> = {
  /* Money arrived, credit was issued, or the swap the product exists for
     actually happened. */
  payment_paid: 'good',
  credit_added: 'good',
  swap_locked: 'good',
  swap_confirmed: 'good',
  confirmation: 'good',
  offer_accepted: 'good',
  group_paid: 'good',
  meet_answered: 'good',
  rating_given: 'good',
  dispute_resolved: 'good',

  /* Needs a look, or a limit stopped it. */
  payment_pending: 'warn',
  request_capped: 'warn',
  request_paused: 'warn',
  trip_removed: 'warn',
  chart_reset: 'warn',
  admin_action: 'warn',

  /* A problem: money failed, a swap fell through, or a safety action was
     taken. `someone_faster` and `acceptor_backed_out` are here rather than
     `warn` because both cost the requester the swap they were waiting on. */
  payment_failed: 'bad',
  swap_voided: 'bad',
  dispute_opened: 'bad',
  acceptor_backed_out: 'bad',
  someone_faster: 'bad',
  report_filed: 'bad',
  block: 'bad',
}

/** The tone of an action; `neutral` for anything the map does not name. */
export function activityTone(action: string): ActivityTone {
  return ACTIVITY_TONE_BY_ACTION[action] ?? 'neutral'
}

/** Every action the tone map names — exported for the drift guard in tests. */
export function tonedActions(): string[] {
  return Object.keys(ACTIVITY_TONE_BY_ACTION).sort()
}

/**
 * The tint per tone.
 *
 * Four semantic tokens, no raw hex and no new colours (AGENTS.md: "semantic
 * Tailwind tokens only"). `neutral` uses `bg-background`, which is the page
 * colour, so on a white row it reads as a quiet grey chip without introducing
 * a fifth token for "grey".
 *
 * Lives here because two screens now colour the same tone: the activity log
 * tints a row's icon with it, and design 17's swap timeline tints each step's
 * label. Two copies would be two answers to "what colour is a failed payment".
 */
export const ACTIVITY_TONE_CLASS: Record<ActivityTone, string> = {
  good: 'bg-wash text-primary',
  warn: 'bg-accent-soft text-accent',
  bad: 'bg-danger-soft text-danger',
  neutral: 'bg-background text-muted',
}

/**
 * The time of day on a row, for design 15's Time column ("22:41").
 *
 * The screen shows the date **and** this. The design shows a time alone only
 * because all six of its rows are from one evening; an audit log that prints
 * `22:41` with no day cannot tell today from three weeks ago, and one that
 * prints only a day cannot order two events on the same day.
 *
 * `localeFor()` is imported rather than re-derived, so the `lang` → BCP-47
 * mapping stays in the one place L10 put it.
 */
export function activityTime(iso: string, lang: LangCode): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(localeFor(lang), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at)
  } catch {
    return ''
  }
}

