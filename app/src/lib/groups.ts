/* SeatSwap family trips — local-first mirror of `group_trips`/`group_members`
   (docs/01 group scope, docs/04 C, build step 10). The organiser handles the
   chat; the plan prices at ₹199 for up to 3 swaps (money stays in paise). */

import { logActivity, listTrips, type Trip } from './store'

export interface GroupTrip {
  id: string
  name: string
  trip_ids: string[]
  paid: boolean
  created_at: string
}

const STORAGE_KEY = 'seatswap.groups.v1'
let snapshot: GroupTrip[] = []
let hydrated = false
const listeners = new Set<() => void>()

function load(): GroupTrip[] {
  if (hydrated) return snapshot
  hydrated = true
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? (JSON.parse(raw) as unknown) : null
      snapshot = Array.isArray(parsed) ? (parsed as GroupTrip[]) : []
    } catch {
      snapshot = []
    }
  }
  return snapshot
}

function commit(next: GroupTrip[]): void {
  snapshot = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* private mode */
    }
  }
  listeners.forEach((listener) => listener())
}

export function subscribeGroups(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getGroupsSnapshot(): GroupTrip[] {
  return load()
}

export function getGroupsServerSnapshot(): GroupTrip[] {
  return []
}

export function resetGroups(): void {
  hydrated = true
  commit([])
}

export function listGroups(): GroupTrip[] {
  return load()
}

export function getGroup(id: string): GroupTrip | undefined {
  return load().find((group) => group.id === id)
}

/** The family trip a trip belongs to, if any (a trip links to one group). */
export function groupForTrip(tripId: string): GroupTrip | undefined {
  return load().find((group) => group.trip_ids.includes(tripId))
}

/** Create a family trip from existing local PNRs (docs/04 C). */
export function createGroup(name: string, tripIds: string[]): GroupTrip {
  /* Date.now alone collides for groups made in the same millisecond (tests do
     this constantly); the random tail keeps ids unique. */
  const group: GroupTrip = {
    id: `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || 'Family trip',
    trip_ids: tripIds,
    paid: false,
    created_at: new Date().toISOString(),
  }
  commit([...load(), group])
  logActivity('group_created', { trips: tripIds.length }, { type: 'group', id: group.id })
  return group
}

export function linkTrip(groupId: string, tripId: string): GroupTrip | undefined {
  const group = getGroup(groupId)
  if (!group || group.trip_ids.includes(tripId)) return undefined
  const updated: GroupTrip = { ...group, trip_ids: [...group.trip_ids, tripId] }
  commit(load().map((row) => (row.id === groupId ? updated : row)))
  logActivity('group_linked', { trip: tripId }, { type: 'group', id: groupId })
  return updated
}

/** Group payments ride the same pay screens: their id is the group id. */
export function isGroupRequestId(requestId: string): boolean {
  return requestId.startsWith('grp_')
}

/** Mark the ₹199 group payment done (the pay screens drive the real flow). */
export function markGroupPaid(groupId: string): GroupTrip | undefined {
  const group = getGroup(groupId)
  if (!group || group.paid) return group
  const updated: GroupTrip = { ...group, paid: true }
  commit(load().map((row) => (row.id === groupId ? updated : row)))
  logActivity('group_paid', { amount_paise: 19900 }, { type: 'group', id: groupId })
  return updated
}

/** "3 of 4 together": trips sharing train + date + coach with the organiser. */
export function groupTogetherCount(group: GroupTrip): { done: number; total: number } {
  const trips: Trip[] = group.trip_ids
    .map((id) => listTrips().find((trip) => trip.id === id))
    .filter((trip): trip is Trip => Boolean(trip))
  if (trips.length === 0) return { done: 0, total: 0 }
  const anchor = trips[0]
  const sameCoach = trips.filter(
    (trip) =>
      trip.train_no === anchor.train_no &&
      trip.journey_date === anchor.journey_date &&
      (trip.passengers[0]?.coach ?? '') === (anchor.passengers[0]?.coach ?? ''),
  ).length
  return { done: sameCoach, total: trips.length }
}
