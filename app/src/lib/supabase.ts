/* SeatSwap browser client — Supabase JS (Google Auth + Postgres).
   Reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY and never crashes when
   they are missing: the app is local-first, so every caller checks
   isSupabaseConfigured() and falls back to lib/store until keys exist. */

import type { SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null
let warned = false

function readEnv(name: string): string {
  try {
    const fromVite = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
    if (fromVite) return fromVite
  } catch { /* import.meta unavailable in some test runtimes */ }
  try {
    const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
    return proc?.env?.[name] ?? ''
  } catch { return '' }
}

/** True only when both URL + anon key are present. */
export function isSupabaseConfigured(): boolean {
  return readEnv('VITE_SUPABASE_URL').trim().length > 0 && readEnv('VITE_SUPABASE_ANON_KEY').trim().length > 0
}

/** Lazily created browser client, or null when env is missing (local-first). */
export async function getSupabase(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null
  if (cached) return cached
  try {
    const { createClient } = await import('@supabase/supabase-js')
    cached = createClient(readEnv('VITE_SUPABASE_URL'), readEnv('VITE_SUPABASE_ANON_KEY'), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
    return cached
  } catch (err) {
    if (!warned) {
      warned = true
      console.warn('[seatswap] supabase client unavailable, staying local-first', err)
    }
    return null
  }
}

/** Test hook: forget the cached client between cases. */
export function resetSupabaseForTests(): void {
  cached = null
  warned = false
}
