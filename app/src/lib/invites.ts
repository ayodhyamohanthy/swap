/* SeatSwap share links — local-first mirror of the `invites` table (docs/02).
   A code is an opaque `ss…` handle: it never contains a PNR, a name or a berth
   number (privacy rule 13), so a link can be posted in a WhatsApp group.

   Two kinds exist, matching the prototype engine (js/seatswap-engine.js):
   - `board`   → a coach board for one of my trips (`/onboard/$tripId`)
   - `request` → a swap request waiting for me to accept (`/incoming/$tripId`)

   Codes live in localStorage until the `invites` table syncs in step 3. */

import { logActivity } from './store'

export type InviteKind = 'board' | 'request'

export interface Invite {
  code: string
  kind: InviteKind
  /** Trip id for `board`, my open trip id for `request`. */
  ref_id: string
  created_at: string
}

const STORAGE_KEY = 'seatswap.invites.v1'
const LIMIT = 50

let snapshot: Record<string, Invite> = {}
let hydrated = false

function load(): Record<string, Invite> {
  if (hydrated) return snapshot
  hydrated = true
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      snapshot =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, Invite>)
          : {}
    } catch {
      snapshot = {}
    }
  }
  return snapshot
}

function commit(next: Record<string, Invite>): void {
  snapshot = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* private mode — codes stay in memory */
    }
  }
}

function newCode(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `ss${rand}`
}

/** Mint a share code. The link itself carries nothing private (rule 13). */
export function createInvite(kind: InviteKind, refId: string): Invite {
  const invite: Invite = {
    code: newCode(),
    kind,
    ref_id: refId,
    created_at: new Date().toISOString(),
  }
  const current = load()
  /* Keep the map bounded: the oldest codes fall off the end. */
  const kept = Object.values(current)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, LIMIT - 1)
  commit({
    ...Object.fromEntries(kept.map((row) => [row.code, row])),
    [invite.code]: invite,
  })
  logActivity('invite_created', { kind }, { type: 'invite', id: invite.code })
  return invite
}

/** Unknown codes return undefined — the landing screen then shows "bad link". */
export function resolveInvite(code: string): Invite | undefined {
  if (!code) return undefined
  return load()[code]
}

/** Absolute share link for a code. Safe to hand to any messaging app. */
export function inviteLink(invite: Invite): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/s/${encodeURIComponent(invite.code)}`
}

/** Test helper — mirrors `resetStore()` in the other local-first modules. */
export function resetInvites(): void {
  hydrated = true
  commit({})
}
