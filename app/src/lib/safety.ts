/* Report + block persistence (docs/04 A12, build step 7): the browser client
   writes the reports/blocks rows itself so RLS can check reporter_id /
   blocker_id against auth.uid() — identity comes from the database, never the
   caller (schema policies reports_reporter_write / blocks_owner). Without
   Supabase, or on any failure, the incident still lands in the local
   activity_log (action report_filed / block), which is exactly what the admin
   Reports screen reads — a failed sync must never lose a report. */

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

/** Block another traveller. Idempotent: the composite PK + ignoreDuplicates
    make a repeated block a no-op instead of an error. */
export async function blockUser(
  input: BlockInput,
  clientOverride?: SafetyClient | null,
): Promise<{ persisted: boolean }> {
  const { blockerId, blockedId } = input
  if (!blockerId || !blockedId || blockerId === blockedId) return { persisted: false }
  logActivity('block', {}, { type: 'user', id: blockedId })
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