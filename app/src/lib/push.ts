/* Free web push (docs/08, rule 15: no SMS). Registration only — delivery is
   server-side. Permission is requested only after the traveller opts in
   (alerts screen / settings toggle); a denial is respected and never
   re-prompted from here. Everything is best-effort: push never blocks UI. */

import { getSupabase } from './supabase'

export type PushSetupStatus =
  | 'subscribed'
  | 'already'
  | 'denied'
  | 'unsupported'
  | 'no-key'
  | 'unconfigured'

const ENDPOINT_KEY = 'seatswap.push.endpoint'

function vapidKey(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    return env?.VITE_VAPID_PUBLIC_KEY ?? ''
  } catch {
    return ''
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

function supported(): boolean {
  return (
    typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window
  )
}

/** Register this device for alerts. Safe to call repeatedly and offline. */
export async function ensurePushSubscription(): Promise<{ status: PushSetupStatus; endpoint?: string }> {
  if (!supported()) return { status: 'unsupported' }
  if (window.Notification.permission === 'denied') return { status: 'denied' }
  const key = vapidKey()
  if (!key) return { status: 'no-key' }
  try {
    if (window.Notification.permission !== 'granted') {
      const answer = await window.Notification.requestPermission()
      if (answer !== 'granted') return { status: 'denied' }
    }
    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    const subscription =
      existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as unknown as ArrayBuffer }))
    const endpoint = subscription.endpoint
    try {
      window.localStorage.setItem(ENDPOINT_KEY, endpoint)
    } catch {
      /* private mode */
    }
    const saved = await saveSubscription(endpoint, subscription.toJSON().keys ?? {})
    void saved
    return { status: existing ? 'already' : 'subscribed', endpoint }
  } catch {
    return { status: 'unsupported' }
  }
}

/** Remove this device (settings toggle off). Best-effort. */
export async function disablePushSubscription(): Promise<boolean> {
  try {
    window.localStorage.removeItem(ENDPOINT_KEY)
  } catch {
    /* ignore */
  }
  if (!supported()) return false
  try {
    const registration = await navigator.serviceWorker.ready
    const existing = await registration.pushManager.getSubscription()
    const endpoint = existing?.endpoint
    if (existing) await existing.unsubscribe()
    if (endpoint) await deleteSubscription(endpoint)
    return true
  } catch {
    return false
  }
}

/** Locally remembered endpoint (for badges/debug; never a secret). */
export function pushEndpoint(): string | null {
  try {
    return window.localStorage.getItem(ENDPOINT_KEY)
  } catch {
    return null
  }
}

async function saveSubscription(endpoint: string, keys: Record<string, unknown>): Promise<boolean> {
  const client = await getSupabase()
  if (!client) return false
  try {
    const { data } = await client.auth.getUser()
    const uid = data?.user?.id
    if (!uid) return false
    const writer = (client.from('push_subscriptions').upsert(
      { user_id: uid, endpoint, keys },
      { onConflict: 'user_id,endpoint' },
    ) as unknown as Promise<{ error: unknown }>)
    const { error } = await writer
    return !error
  } catch {
    return false
  }
}

async function deleteSubscription(endpoint: string): Promise<boolean> {
  const client = await getSupabase()
  if (!client) return false
  try {
    const { data } = await client.auth.getUser()
    const uid = data?.user?.id
    if (!uid) return false
    const deleter = (client.from('push_subscriptions').delete().eq('user_id', uid).eq('endpoint', endpoint) as unknown as Promise<{ error: unknown }>)
    const { error } = await deleter
    return !error
  } catch {
    return false
  }
}
