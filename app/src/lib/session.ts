/* SeatSwap session — Google OAuth only (AGENTS.md rule 8). No phone, no
   email/code, no other provider. Sign-in is asked only when the user first
   sends or accepts a request; PNR entry works signed out (local-first).
   On SIGNED_IN the local trips attach to the account (lib/store) and the
   sync payload is ready to push; pushLocalTrips() only returns the payload
   + target tables — it invents no network call. */

import { attachToAccount, detachFromAccount, exportForSync, type SyncPayload } from './store'
import { getSupabase } from './supabase'

export interface SessionUser { id: string; email: string | null }

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED' | 'TOKEN_REFRESHED'

export type AuthListener = (event: AuthEvent, user: SessionUser | null) => void

const listeners = new Set<AuthListener>()
let subscribed = false

/** Target tables + row counts for the local-first payload (push order). */
export interface SyncTargets { tables: Array<'bookings' | 'passengers' | 'activity_log'>; counts: Record<string, number> }

export interface LocalPushPlan { payload: SyncPayload; targets: SyncTargets }

/** Describe where each part of exportForSync() goes (no network invented). */
export function pushLocalTrips(): LocalPushPlan {
  const payload = exportForSync()
  return {
    payload,
    targets: {
      tables: ['bookings', 'passengers', 'activity_log'],
      counts: {
        bookings: payload.bookings.length,
        passengers: payload.passengers.length,
        activity_log: payload.activity.length,
      },
    },
  }
}

export interface PushResult {
  configured: boolean
  pushed: { bookings: number; passengers: number }
  failed: string[]
}

/** Map one local booking to its server columns (never the full PNR — the
    local row only carries pnr_hash + last4, docs/08). Exported for tests. */
export function mapBookingRow(userId: string, booking: SyncPayload['bookings'][number]): Record<string, unknown> {
  return {
    user_id: userId,
    pnr_hash: booking.pnr_hash,
    pnr_last4: booking.pnr_last4,
    train_no: booking.train_no,
    train_name: booking.train_name,
    journey_date: booking.journey_date,
    from_code: booking.from_code,
    to_code: booking.to_code,
    class: booking.class,
    is_chair_car: booking.is_chair_car,
    source: booking.source,
    chart_prepared: booking.chart_prepared,
    open_to_swap: booking.open_to_swap,
  }
}

/** Map one local passenger onto its server booking id. Exported for tests. */
export function mapPassengerRow(
  bookingUuid: string,
  passenger: SyncPayload['passengers'][number],
): Record<string, unknown> {
  return {
    booking_id: bookingUuid,
    label: passenger.label,
    coach: passenger.coach,
    berth_no: passenger.berth_no,
    berth_type: passenger.berth_type,
    status: passenger.status,
    quota: passenger.quota,
    is_child_no_berth: passenger.is_child_no_berth,
    board_code: passenger.board_code,
    drop_code: passenger.drop_code,
  }
}

/**
 * Execute the push plan after sign-in: upsert bookings on (user_id, pnr_hash),
 * insert passengers for bookings that have none yet. Activity stays on the
 * device (server functions write the server log going forward). Best-effort:
 * never throws, reports per-table failures for a retry button.
 */
export async function pushLocalTripsToBackend(): Promise<PushResult> {
  const client = await getSupabase()
  if (!client) return { configured: false, pushed: { bookings: 0, passengers: 0 }, failed: [] }
  const failed: string[] = []
  const pushed = { bookings: 0, passengers: 0 }
  try {
    const { data } = await client.auth.getUser()
    const uid = data?.user?.id
    if (!uid) return { configured: true, pushed, failed: ['not_signed_in'] }
    const { payload } = pushLocalTrips()
    if (payload.bookings.length === 0) return { configured: true, pushed, failed }
    const upserter = (client.from('bookings').upsert(
      payload.bookings.map((b) => mapBookingRow(uid, b)),
      { onConflict: 'user_id,pnr_hash' },
    ) as unknown as Promise<{ error: unknown }>)
    const { error: bookingsError } = await upserter
    if (bookingsError) return { configured: true, pushed, failed: ['bookings'] }
    const hashes = payload.bookings.map((b) => b.pnr_hash)
    const reader = (client.from('bookings').select('id,pnr_hash').eq('user_id', uid).in('pnr_hash', hashes) as unknown as Promise<{ data: Array<{ id: string; pnr_hash: string }> | null; error: unknown }>)
    const { data: rows, error: readError } = await reader
    if (readError || !rows) return { configured: true, pushed: { bookings: payload.bookings.length, passengers: 0 }, failed: ['passengers'] }
    pushed.bookings = payload.bookings.length
    const idByHash = new Map(rows.map((r) => [r.pnr_hash, r.id]))
    const existingQuery = (client.from('passengers').select('booking_id').in('booking_id', [...idByHash.values()]) as unknown as Promise<{ data: Array<{ booking_id: string }> | null; error: unknown }>)
    const { data: existing } = await existingQuery
    const hasPassengers = new Set((existing ?? []).map((r) => r.booking_id))
    const inserts = payload.passengers.flatMap((p) => {
      const bookingUuid = idByHash.get(payload.bookings.find((b) => b.local_id === p.local_booking_id)?.pnr_hash ?? '')
      if (!bookingUuid || hasPassengers.has(bookingUuid)) return []
      return [mapPassengerRow(bookingUuid, p)]
    })
    if (inserts.length > 0) {
      const inserter = (client.from('passengers').insert(inserts) as unknown as Promise<{ error: unknown }>)
      const { error: passengersError } = await inserter
      if (passengersError) return { configured: true, pushed, failed: ['passengers'] }
      pushed.passengers = inserts.length
    }
    return { configured: true, pushed, failed }
  } catch {
    return { configured: true, pushed, failed: ['bookings', 'passengers'] }
  }
}

function toSessionUser(raw: { id?: string; email?: string | null } | null | undefined): SessionUser | null {
  if (!raw?.id) return null
  return { id: raw.id, email: raw.email ?? null }
}

function emit(event: AuthEvent, user: SessionUser | null): void {
  if (event === 'SIGNED_IN' && user) {
    // Local trips move under the account id; payload stays ready for push.
    try { attachToAccount(user.id) } catch { /* store keeps working in memory */ }
  }
  if (event === 'SIGNED_OUT') {
    try { detachFromAccount() } catch { /* ignore */ }
  }
  listeners.forEach((cb) => {
    try { cb(event, user) } catch { /* one bad listener must not break auth */ }
  })
}

/** Start Google OAuth. Returns the provider URL when a client exists. */
export async function signInWithGoogle(): Promise<{ url: string | null; localFirst: boolean }> {
  const client = await getSupabase()
  if (!client) return { url: null, localFirst: true }
  const redirectTo = typeof window === 'undefined' ? undefined : `${window.location.origin}/signin`
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, scopes: 'openid email profile' },
  })
  if (error) throw error
  return { url: data.url, localFirst: false }
}

/** Sign out everywhere (server session + local attach flag). */
export async function signOut(): Promise<void> {
  const client = await getSupabase()
  if (client) {
    const { error } = await client.auth.signOut()
    if (error) throw error
  }
  emit('SIGNED_OUT', null)
}

/** Current Google session user, or null signed out / unconfigured. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const client = await getSupabase()
  if (!client) return null
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  return toSessionUser(data.session?.user ?? null)
}

/** Subscribe to auth changes; attaches local trips on SIGNED_IN. */
export function onAuthChange(cb: AuthListener): () => void {
  listeners.add(cb)
  void ensureSubscription()
  return () => { listeners.delete(cb) }
}

async function ensureSubscription(): Promise<void> {
  if (subscribed) return
  const client = await getSupabase()
  if (!client) return
  subscribed = true
  client.auth.onAuthStateChange((event, session) => {
    const mapped = event === 'SIGNED_IN' ? 'SIGNED_IN'
      : event === 'SIGNED_OUT' ? 'SIGNED_OUT'
      : event === 'USER_UPDATED' ? 'USER_UPDATED' : 'TOKEN_REFRESHED'
    emit(mapped, toSessionUser(session?.user ?? null))
  })
}

/** Test hook: emit auth events without a browser session. */
export function emitAuthForTests(event: AuthEvent, user: SessionUser | null): void {
  emit(event, user)
}

/** Test hook: reset listeners + subscription flag between cases. */
export function resetSessionForTests(): void {
  listeners.clear()
  subscribed = false
}
