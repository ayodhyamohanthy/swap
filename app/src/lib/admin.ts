/* SeatSwap admin client-safe helpers (docs/04-D, docs/08).
   SPLIT: has_role() is NEVER called here. Server guard lives in
   `@/server/admin` (createServerFn + Postgres has_role/is_staff).
   This file: route meta, pure CSV exporters, overview aggregates,
   activity filters, demo-mode admin_action log. Money = paise. */

import { logActivity, type ActivityRow } from './store'

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
}

export function usersToCsv(rows: AdminUserRow[]): string {
  return toCsv(
    ['id', 'first_name', 'last_initial', 'created_at', 'blocked', 'reported'],
    rows.map((r) => [r.id, r.first_name, r.last_initial, r.created_at, r.blocked, r.reported]),
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
  return logActivity('admin_action', { ...detail, demo: true }, { type: 'admin', id: detail.target })
}

export interface AdminOverviewInput {
  activity: ActivityRow[]
  walletTotalPaise: number
}

export interface AdminOverview {
  pnrsToday: number
  requestsToday: number
  paidToday: number
  confirmedToday: number
  creditIssuedPaise: number
  busiestTrains: Array<{ train_no: string; count: number }>
}

function isToday(iso: string, nowMs: number): boolean {
  const day = new Date(iso)
  const now = new Date(nowMs)
  return (
    day.getUTCFullYear() === now.getUTCFullYear() &&
    day.getUTCMonth() === now.getUTCMonth() &&
    day.getUTCDate() === now.getUTCDate()
  )
}

/** Today's PNRs/requests/paid/confirmed + busiest trains from local rows. */
export function buildOverview(input: AdminOverviewInput, nowMs = Date.now()): AdminOverview {
  const today = input.activity.filter((row) => isToday(row.created_at, nowMs))
  const count = (action: string): number => today.filter((row) => row.action === action).length
  const byTrain = new Map<string, number>()
  for (const row of today) {
    const train = (row.meta as Record<string, unknown>)?.train_no
    if (typeof train === 'string' && train) byTrain.set(train, (byTrain.get(train) ?? 0) + 1)
  }
  const busiestTrains = [...byTrain.entries()]
    .map(([train_no, n]) => ({ train_no, count: n }))
    .sort((a, b) => b.count - a.count || (a.train_no < b.train_no ? -1 : 1))
    .slice(0, 5)
  return {
    pnrsToday: count('pnr_added'),
    requestsToday: count('request_sent'),
    paidToday: count('payment_paid'),
    confirmedToday: count('confirmation'),
    creditIssuedPaise: input.walletTotalPaise,
    busiestTrains,
  }
}

export interface ActivityFilter {
  action: string | null
  query: string
}

/** Filter by action; search matches user/PNR-last4/train (last4 only). */
export function filterActivity(rows: ActivityRow[], filter: ActivityFilter): ActivityRow[] {
  const q = filter.query.trim().toLowerCase()
  return rows.filter((row) => {
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

