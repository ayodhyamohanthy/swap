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
