/* SeatSwap admin server actions (SERVER-ONLY — never import from components).
   has_role()/is_staff() run in Postgres; the client only gets {ok,persisted}.
   Every admin action performs its mutation AND writes an activity_log row
   (docs/04-D). Support staff may read and close reports; only admins move
   money, confirm swaps, resolve disputes or block users. */

import { createServerFn } from '@tanstack/react-start'
import { getSupabase } from '@/lib/supabase'
import {
  persistInserts,
  persistMulti,
  type ActivityWrite,
  type RowInsert,
  type RowPatch,
  type SupaClient,
} from './functions'

export type StaffRole = 'admin' | 'support'

async function staffUid(role: StaffRole): Promise<{ client: SupaClient; uid: string }> {
  const client = await getSupabase()
  if (!client) throw new Error('backend_unconfigured')
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) throw new Error('not_signed_in')
  const uid = data.user.id
  // Role checks run ONLY server-side via RPC, never client logic.
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string,
    args: Record<string, string>,
  ) => Promise<{ data: unknown; error: unknown }>
  if (role === 'admin') {
    const { data: allowed, error: roleError } = await rpc('has_role', { uid, wanted: 'admin' })
    if (roleError || allowed !== true) throw new Error('forbidden')
  } else {
    const { data: allowed, error: roleError } = await rpc('is_staff', { uid })
    if (roleError || allowed !== true) throw new Error('forbidden')
  }
  return { client, uid }
}

function adminActivity(uid: string, action: string, target: string, reason?: string): ActivityWrite {
  return {
    actor_id: uid, actor_role: 'admin', action: 'admin_action',
    entity: 'admin', entity_id: target,
    meta: { action, reason: reason ?? null },
  }
}

/** requireRole('admin'|'support') — throws forbidden unless the RPC agrees. */
export const requireRole = createServerFn({ method: 'POST' })
  .validator((input: { role: StaffRole }) => input)
  .handler(async ({ data }) => {
    const { uid } = await staffUid(data.role)
    return { ok: true as const, uid }
  })

export interface AdminPlan {
  updates: RowPatch[]
  inserts: RowInsert[]
  activityAction: string
}

export type AdminAction = 'user_blocked' | 'credit_added' | 'admin_adjust' | 'confirmation' | 'dispute_resolved' | 'report_closed'

/** Twelve calendar months out (rule 4) — never 365 days. */
function twelveMonthsOut(nowMs = Date.now()): string {
  const d = new Date(nowMs)
  d.setMonth(d.getMonth() + 12)
  return d.toISOString()
}

/**
 * Pure planners so the mutations are unit-testable without a database.
 * target = request id, user id, dispute id or report id depending on action.
 */
export function planAdminAction(
  action: AdminAction,
  target: string,
  opts: { reason?: string; acceptorId?: string; payerId?: string; requestId?: string; amountPaise?: number; resolution?: 'confirmed' | 'voided' } = {},
): AdminPlan {
  switch (action) {
    case 'user_blocked':
      /* No separate ban table: pausing hides the user from all matching. */
      return {
        updates: [{ table: 'settings', id: target, key: 'user_id', patch: { paused: true } }],
        inserts: [],
        activityAction: 'user_blocked',
      }
    case 'credit_added':
      /* Rule 6: a paid swap that did not happen moves ₹99 to requester credit. */
      return {
        updates: [{ table: 'swap_requests', id: target, patch: { status: 'voided' } }],
        inserts: [{
          table: 'wallet_tx',
          row: {
            user_id: opts.payerId ?? null, amount_paise: 9900, kind: 'swap_to_credit',
            ref_request_id: target, expires_at: twelveMonthsOut(),
          },
        }],
        activityAction: 'credit_added',
      }
    case 'admin_adjust':
      /* Staff correction with a mandatory reason; any nonzero amount. */
      if (!Number.isInteger(opts.amountPaise) || opts.amountPaise === 0) throw new Error('adjust_amount_invalid')
      return {
        updates: [],
        inserts: [{
          table: 'wallet_tx',
          row: {
            user_id: target, amount_paise: opts.amountPaise, kind: 'admin_adjust',
            ref_request_id: opts.requestId ?? null, expires_at: null,
          },
        }],
        activityAction: 'credit_added',
      }
    case 'confirmation':
      /* Staff marks a locked swap done: request confirmed + acceptor earns ₹50. */
      return {
        updates: [{ table: 'swap_requests', id: target, patch: { status: 'confirmed' } }],
        inserts: opts.acceptorId ? [{
          table: 'wallet_tx',
          row: {
            user_id: opts.acceptorId, amount_paise: 5000, kind: 'acceptor_credit',
            ref_request_id: target, expires_at: twelveMonthsOut(),
          },
        }] : [],
        activityAction: 'confirmation',
      }
    case 'dispute_resolved': {
      const resolution = opts.resolution ?? 'voided'
      const updates: RowPatch[] = [
        { table: 'disputes', id: target, patch: { status: 'resolved', resolution: opts.reason ?? resolution } },
      ]
      const inserts: RowInsert[] = []
      /* Money follows the resolution (docs/03 outcomes table). */
      if (opts.requestId) {
        updates.push({ table: 'swap_requests', id: opts.requestId, patch: { status: resolution } })
        if (resolution === 'voided' && opts.payerId) {
          inserts.push({
            table: 'wallet_tx',
            row: {
              user_id: opts.payerId, amount_paise: 9900, kind: 'swap_to_credit',
              ref_request_id: opts.requestId, expires_at: twelveMonthsOut(),
            },
          })
        }
        if (resolution === 'confirmed' && opts.acceptorId) {
          inserts.push({
            table: 'wallet_tx',
            row: {
              user_id: opts.acceptorId, amount_paise: 5000, kind: 'acceptor_credit',
              ref_request_id: opts.requestId, expires_at: twelveMonthsOut(),
            },
          })
        }
      }
      return { updates, inserts, activityAction: 'dispute_resolved' }
    }
    case 'report_closed':
      return {
        updates: [{ table: 'reports', id: target, patch: { status: 'closed' } }],
        inserts: [],
        activityAction: 'report_closed',
      }
  }
}

function adminFn(action: AdminAction) {
  return createServerFn({ method: 'POST' })
    .validator((input: { target: string; reason?: string; acceptorId?: string; payerId?: string; requestId?: string; amountPaise?: number; resolution?: 'confirmed' | 'voided' }) => input)
    .handler(async ({ data }) => {
      const { client, uid } = await staffUid('admin')
      if ((action === 'credit_added' || action === 'admin_adjust') && !data.reason) {
        throw new Error('reason_required')
      }
      /* Blocking runs through its own role-checked RPC (settings rows are
         owner-writable only, so a plain update would fail RLS here). */
      if (action === 'user_blocked') {
        const blockActivity = adminActivity(uid, 'user_blocked', data.target, data.reason)
        const rpc = client.rpc.bind(client) as unknown as (
          fn: string, args: Record<string, string | boolean>,
        ) => Promise<{ error: unknown }>
        const { error } = await rpc('admin_set_paused', { p_target: data.target, p_paused: true })
        if (error) throw new Error('block_failed')
        const logged = await persistInserts(client, [], blockActivity)
        return { ok: true as const, persisted: logged.persisted as boolean, failed: logged.failed, action, target: data.target }
      }
      const plan = planAdminAction(action, data.target, {
        reason: data.reason, acceptorId: data.acceptorId, payerId: data.payerId,
        requestId: data.requestId, amountPaise: data.amountPaise, resolution: data.resolution,
      })
      const activity = adminActivity(uid, plan.activityAction, data.target, data.reason)
      const updated = await persistMulti(client, plan.updates, activity)
      const inserted = plan.inserts.length > 0
        ? await persistInserts(client, plan.inserts, activity)
        : { persisted: true, failed: [] as string[] }
      return {
        ok: true as const,
        persisted: (updated.persisted && inserted.persisted) as boolean,
        failed: [...updated.failed, ...inserted.failed],
        action, target: data.target,
      }
    })
}

/** Block a user (pauses all of their matching; reversible by unpausing). */
export const adminBlockUser = adminFn('user_blocked')
/** Move a paid swap to requester credit (rule 6: never back to bank). */
export const adminMoveToCredit = adminFn('credit_added')
/** Mark a locked swap done (confirmed) + award the acceptor ₹50. */
export const adminMarkDone = adminFn('confirmation')
/** Resolve a dispute (no promised time — rule 7 copy in UI). */
export const adminResolveDispute = adminFn('dispute_resolved')
/** Manual credit adjust — reason required by the UI layer. */
export const adminAdjustCredit = adminFn('admin_adjust')
/** Close a report without blocking. */
export const adminCloseReport = adminFn('report_closed')
