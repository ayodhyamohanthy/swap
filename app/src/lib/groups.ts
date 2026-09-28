/* SeatSwap family trips — local-first mirror of `group_trips`/`group_members`
   (docs/01 group scope, docs/04 C, build step 10). The organiser handles the
   chat; the plan prices at ₹199 for up to 3 swaps (money stays in paise). */

import { GROUP_PRICE_PAISE } from './money'
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

/* Stable empty reference (see requests.ts): a fresh [] each call makes React
   treat the snapshot as changed and loop. */
const EMPTY_GROUPS: GroupTrip[] = []

export function getGroupsServerSnapshot(): GroupTrip[] {
  return EMPTY_GROUPS
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

/** One trip belongs to one family trip. `group_members` has a
    `(group_id, booking_id)` primary key, so the database would accept the same
    booking in two groups — but `groupForTrip()` then has to pick one, and which
    bundle it picks decides whether that member's swap is covered by the ₹199
    already paid or costs another ₹99. No screen can disambiguate the choice, so
    the local model refuses the state instead of resolving it at random. */
function freeTripIds(tripIds: string[]): string[] {
  const seen = new Set<string>()
  return tripIds.filter((id) => {
    if (seen.has(id) || groupForTrip(id)) return false
    seen.add(id)
    return true
  })
}

/** Create a family trip from existing local PNRs (docs/04 C). Trips already
    linked to another family trip are dropped rather than double-counted. */
export function createGroup(name: string, tripIds: string[]): GroupTrip {
  /* Date.now alone collides for groups made in the same millisecond (tests do
     this constantly); the random tail keeps ids unique. */
  const group: GroupTrip = {
    id: `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || 'Family trip',
    trip_ids: freeTripIds(tripIds),
    paid: false,
    created_at: new Date().toISOString(),
  }
  commit([...load(), group])
  logActivity('group_created', { trips: group.trip_ids.length }, { type: 'group', id: group.id })
  return group
}

export function linkTrip(groupId: string, tripId: string): GroupTrip | undefined {
  const group = getGroup(groupId)
  if (!group || group.trip_ids.includes(tripId)) return undefined
  if (groupForTrip(tripId)) return undefined
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
  logActivity('group_paid', { amount_paise: GROUP_PRICE_PAISE }, { type: 'group', id: groupId })
  return updated
}

/** Linked trips that still resolve to a local PNR, in link order. */
function memberTrips(group: GroupTrip): Trip[] {
  return group.trip_ids
    .map((id) => listTrips().find((trip) => trip.id === id))
    .filter((trip): trip is Trip => Boolean(trip))
}

/** The journey a family trip is about, or null when its linked tickets do not
    share one train and date. Designs 19a and 19b both headline the group with
    "12752 Rajdhani · Fri 12 Jun"; a family split across two trains has no
    single journey to name, so callers render nothing rather than describing
    only whichever trip was linked first. */
export function groupJourney(
  group: GroupTrip,
): { train_no: string; train_name: string; journey_date: string | null } | null {
  const trips = memberTrips(group)
  const first = trips[0]
  if (!first) return null
  const oneJourney = trips.every(
    (trip) => trip.train_no === first.train_no && trip.journey_date === first.journey_date,
  )
  return oneJourney
    ? {
        train_no: first.train_no,
        train_name: first.train_name,
        journey_date: first.journey_date,
      }
    : null
}

/** "3 of 4 together": the biggest cluster of passengers sharing train + date
    + coach (docs/01, docs/04 C), counting **people**, not tickets. Design 5a
    shows Mom + Dad in A2 and Riya + You in B1 as "2 of 4 seated together", and
    design 19a lists a ticket holding 2 people — so a linked PNR is not one
    unit of "together": a family of four on two PNRs is "x of 4", never "of 2".

    A passenger only joins a cluster once they have a coach. Waitlisted/RAC
    passengers have none, and a child travelling without a berth is "counted in
    the group, never offered" (docs/04 C) — they are members who are not seated
    anywhere, so they count in `total` and never in `done`. Keying on an empty
    coach made a group of unallocated passengers read "2 of 2 together".

    Deliberately NOT anchored on the first-linked trip either: `trip_ids` is
    link order and `linkTrip` appends, so an anchor made the answer depend on
    the order the organiser happened to add PNRs in — link the odd one out
    first and "3 of 4 together" read "1 of 4".

    This is a different quantity from `groupLockedCount()` (requests.ts): that
    one counts bundle *consumption* against GROUP_MAX_SWAPS, this one counts
    how many of the family are actually seated together. They are allowed to
    disagree — do not merge them. */
export function groupTogetherCount(group: GroupTrip): { done: number; total: number } {
  const trips = memberTrips(group)
  const seats = trips.flatMap((trip) => trip.passengers)
  if (seats.length === 0) return { done: 0, total: 0 }
  const clusters = new Map<string, number>()
  let done = 0
  for (const trip of trips) {
    for (const passenger of trip.passengers) {
      if (!passenger.coach) continue
      const key = `${trip.train_no}|${trip.journey_date ?? ''}|${passenger.coach}`
      const size = (clusters.get(key) ?? 0) + 1
      clusters.set(key, size)
      if (size > done) done = size
    }
  }
  return { done, total: seats.length }
}
