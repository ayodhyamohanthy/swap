/* Report + block persistence (docs/04 A12, build step 7): the browser client
   writes the reports/blocks rows itself so RLS can check reporter_id /
   blocker_id against auth.uid() — identity comes from the database, never the
   caller (schema policies reports_reporter_write / blocks_owner). Without
   Supabase, or on any failure, the incident still lands in the local
   activity_log (action report_filed / block), which is exactly what the admin
   Reports screen reads — a failed sync must never lose a report. A block also
   gets a local mirror, because the matcher on this device is the thing the
   traveller actually runs into. */

import { getSupabase } from './supabase'
import { logActivity } from './store'

export type SafetyClient = NonNullable<Awaited<ReturnType<typeof getSupabase>>>

export interface ReportInput {
  reporterId: string
  reportedId: string
  requestId?: string | null
  reason?: string
}

export interface BlockInput {
  blockerId: string
  blockedId: string
}

/** File a report against another traveller. Always logs locally; mirrors the
    row into `reports` when a Supabase session is available. Self-reports are
    refused (reports_no_self) before anything is written. */
export async function fileReport(
  input: ReportInput,
  clientOverride?: SafetyClient | null,
): Promise<{ persisted: boolean }> {
  const { reporterId, reportedId, requestId = null, reason = '' } = input
  if (!reporterId || !reportedId || reporterId === reportedId) return { persisted: false }
  logActivity(
    'report_filed',
    { request_id: requestId, reason },
    { type: 'swap_request', id: requestId },
  )
  const client = clientOverride === undefined ? await getSupabase() : clientOverride
  if (!client) return { persisted: false }
  try {
    const { error } = (await client.from('reports').insert({
      reporter_id: reporterId,
      reported_id: reportedId,
      request_id: requestId,
      reason,
    })) as { error: unknown }
    return { persisted: !error }
  } catch {
    return { persisted: false }
  }
}

/* SeatSwap blocks, on this device. The `blocks` table (docs/02) is the record
   the server enforces; localStorage is the record THIS device enforces, and
   without it "Report & block" was a receipt: the chat button wrote an
   `activity_log` row and a Supabase row, while `rankMatches` kept offering the
   blocked traveller back — its `blocked` filter had no writer anywhere. The
   local matcher is what a signed-out or offline traveller actually sees, so
   the block has to bite there too. */

const STORAGE_KEY = 'seatswap.blocks.v1'

let ids: Set<string> | null = null

function load(): Set<string> {
  if (ids) return ids
  ids = new Set()
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      if (Array.isArray(parsed)) {
        for (const row of parsed) if (typeof row === 'string') ids.add(row)
      }
    } catch {
      /* private mode or a corrupt write: no blocks, app keeps working */
    }
  }
  return ids
}

function commit(next: Set<string>): void {
  ids = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
    } catch {
      /* storage full or blocked: the block stays for this session */
    }
  }
}

/** A blocked traveller is stored by whoever the reporter could act on. On this
    device other travellers are bookings, so the handle names the booking:
    `trip:<tripId>`. One function so the writer and the reader cannot drift. */
export function tripHandle(tripId: string): string {
  return `trip:${tripId}`
}

/** True once this device has blocked that handle. */
export function isBlocked(id: string): boolean {
  return load().has(id)
}

/** Test helper — clears the device's block list. */
export function resetBlocks(): void {
  commit(new Set())
}

/** Block another traveller. Idempotent: the composite PK + ignoreDuplicates
    make a repeated block a no-op instead of an error. */
export async function blockUser(
  input: BlockInput,
  clientOverride?: SafetyClient | null,
): Promise<{ persisted: boolean }> {
  const { blockerId, blockedId } = input
  if (!blockerId || !blockedId || blockerId === blockedId) return { persisted: false }
  logActivity('block', {}, { type: 'user', id: blockedId })
  /* Before the network call, and whatever it does: the mirror is a failed-sync
     fallback like the activity row next to it, not an extra of the insert. */
  commit(new Set(load()).add(blockedId))
  const client = clientOverride === undefined ? await getSupabase() : clientOverride
  if (!client) return { persisted: false }
  try {
    const { error } = (await client
      .from('blocks')
      .upsert(
        { blocker_id: blockerId, blocked_id: blockedId },
        { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
      )) as { error: unknown }
    return { persisted: !error }
  } catch {
    return { persisted: false }
  }
}