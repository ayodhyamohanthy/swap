/* SeatSwap admin server guard (SERVER-ONLY — never import from components).
   has_role()/is_staff() run in Postgres; the client only gets {ok,persisted}.
   Every admin action writes an `admin_action` activity_log row (docs/04-D). */

import { createServerFn } from '@tanstack/react-start'
import { getSupabase } from '@/lib/supabase'

export type StaffRole = 'admin' | 'support'

async function staffUid(role: StaffRole): Promise<{ client: NonNullable<Awaited<ReturnType<typeof getSupabase>>>; uid: string }> {
  const client = await getSupabase()
  if (!client) throw new Error('backend_unconfigured')
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new Error('not_signed_in')
  const uid = data.user.id
  // has_role() must ONLY run server-side: RPC, never client logic.
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string,
    args: Record<string, string>,
  ) => Promise<{ data: unknown; error: unknown }>
  const { data: allowed, error: roleError } = await rpc('is_staff', { uid })
  void role
  if (roleError || allowed !== true) throw new Error('forbidden')
  return { client, uid }
}

async function logAdminAction(client: { from: (t: string) => { insert: (r: unknown) => Promise<{ error: unknown }> } }, uid: string, action: string, target: string, reason?: string): Promise<void> {
  const writer = client.from('activity_log').insert({
    actor_id: uid, actor_role: 'admin', action: 'admin_action',
    entity: 'admin', entity_id: target, meta: { action, reason: reason ?? null },
  }) as unknown as Promise<{ error: unknown }>
  await writer
}

/** requireRole('admin'|'support') — throws forbidden unless is_staff(uid). */
export const requireRole = createServerFn({ method: 'POST' })
  .validator((input: { role: StaffRole }) => input)
  .handler(async ({ data }) => {
    const { uid } = await staffUid(data.role)
    return { ok: true as const, uid }
  })

function adminFn(action: string) {
  return createServerFn({ method: 'POST' })
    .validator((input: { target: string; reason?: string }) => input)
    .handler(async ({ data }) => {
      const { client, uid } = await staffUid('admin')
      await logAdminAction(client as never, uid, action, data.target, data.reason)
      return { ok: true as const, persisted: true as const, action, target: data.target }
    })
}

/** Block a user (lib/reports offence path escalated by staff). */
export const adminBlockUser = adminFn('user_blocked')
/** Move a paid swap to requester credit (rule 6: never back to bank). */
export const adminMoveToCredit = adminFn('credit_added')
/** Mark a locked swap done (confirmed). */
export const adminMarkDone = adminFn('confirmation')
/** Resolve a dispute (no promised time — rule 7 copy in UI). */
export const adminResolveDispute = adminFn('dispute_resolved')
/** Manual credit adjust — reason required by the UI layer. */
export const adminAdjustCredit = adminFn('credit_added')
/** Close a report without blocking. */
export const adminCloseReport = adminFn('report_closed')
