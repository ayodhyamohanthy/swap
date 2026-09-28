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

/** How many berths one sleeper bay holds.

    Indian Railways numbers berths so this repeats all the way down the coach:
    berth 12 is the fourth slot of the second bay, berth 40 the eighth slot of
    the fifth. That repetition is what makes a berth *number* a position and
    not merely a label, and it is the only reason design 19b's map can be drawn
    from a ticket at all. */
export const BERTHS_PER_BAY = 8

/** Where a berth number sits in its coach, or null when the number is not a
    berth (a chair-car seat, or nothing at all).

    Bay and slot are both consequences of the number itself, so this asks the
    ticket for nothing it did not already print — and it can therefore never
    place a berth that was not on the ticket.

    It deliberately does NOT consult `berth_type`, which looks like the obvious
    cross-check and is a trap: `addTrip` defaults that field to `'LB'` whenever
    the PNR carried no berth word (`lib/store.ts`:
    `berth_type: passenger.berth_type ?? (chair ? 'WINDOW' : 'LB')`), so a real
    upper berth whose type was never parsed is stored identically to a genuine
    lower. Only slots 1 and 4 of a bay are lower berths, so cross-checking
    would refuse to place **three berths in four** for no reason. Filed as the
    L6 → L2 request: with the default distinguishable, the cross-check becomes
    both possible and worth having. */
export function baySlot(
  berthNo: string | null,
  isChairCar: boolean,
): { bay: number; slot: number } | null {
  if (isChairCar || !berthNo || !/^\d+$/.test(berthNo)) return null
  const n = Number(berthNo)
  if (n < 1) return null
  return {
    bay: Math.floor((n - 1) / BERTHS_PER_BAY) + 1,
    slot: ((n - 1) % BERTHS_PER_BAY) + 1,
  }
}

/** One berth the family holds, and where it sits. `bay`/`slot` are null when
    the numbering cannot place it — the berth still exists and still counts, it
    is just not on the map. */
export interface GroupBerth {
  /** As printed on the ticket. Empty for a confirmed seat with no number. */
  berth_no: string
  bay: number | null
  slot: number | null
}

/** One coach of a family trip's coach map (docs/04 C: "link PNRs → see
    everyone on one coach map", design 19b's `A2 Coach` strip). */
export interface GroupCoach {
  /** Coach code as printed on the ticket, e.g. "A2". */
  coach: string
  train_no: string
  journey_date: string | null
  /** Every berth the family holds here, in the order they were linked. */
  berths: GroupBerth[]
}

/** One row of the map: a bay, and its slots in ticket order. */
export interface GroupBayRow {
  bay: number
  /** Length `BERTHS_PER_BAY`. `null` where the family holds nothing. */
  slots: (GroupBerth | null)[]
}

/** What the family occupies, coach by coach — the data behind design 19b's map.

    It holds the family's own berths and nothing else. The rest of the coach
    (who else is in it, which berths are free) is not in this app by design:
    `match_cards` exposes no berth numbers and rule 13 keeps it that way, so
    inventing neighbour berths would put a stranger on a "who is sitting where"
    screen. What the map *does* draw is the family's berths at the positions
    their own numbers give them — which is what lets the screen answer the
    question it is named after ("Seat everyone together"): same bay, or
    opposite ends of the coach.

    Coaches are keyed by train + date too, because "A2 on 12951" and "A2 on
    12952" are not the same place; a family on two trains gets two A2s.
    Ordered biggest-family-first so the strip opens where most of them are,
    with link order breaking a tie. */
export function groupCoachMap(group: GroupTrip): { coaches: GroupCoach[]; unseated: number } {
  const coaches: GroupCoach[] = []
  const index = new Map<string, GroupCoach>()
  let unseated = 0
  for (const trip of memberTrips(group)) {
    for (const passenger of trip.passengers) {
      /* No coach means no seat yet: waitlisted or RAC, or a child travelling
         without a berth (docs/04 C — in the group, never offered). They are
         counted, never placed. */
      if (!passenger.coach) {
        unseated += 1
        continue
      }
      const key = `${trip.train_no}|${trip.journey_date ?? ''}|${passenger.coach}`
      let coach = index.get(key)
      if (!coach) {
        coach = {
          coach: passenger.coach,
          train_no: trip.train_no,
          journey_date: trip.journey_date,
          berths: [],
        }
        index.set(key, coach)
        coaches.push(coach)
      }
      /* A berth number is what makes a seat a seat. A confirmed passenger with
         a coach but no number is unusual (chair car, some quotas), so the
         member still gets a cell — it just has nothing to print and no
         position to print it at. */
      const placed = baySlot(passenger.berth_no, trip.is_chair_car)
      coach.berths.push({
        berth_no: passenger.berth_no ?? '',
        bay: placed?.bay ?? null,
        slot: placed?.slot ?? null,
      })
    }
  }
  coaches.sort((a, b) => b.berths.length - a.berths.length)
  return { coaches, unseated }
}

/** The map's rows: one per bay the family is seated in, smallest bay first,
    each carrying the bay's slots with the family's berths in place.

    The empty slots are the load-bearing part of rule 13, and they must stay
    empty. A slot is a *position the coach's own numbering put there* — this
    app has never seen who, if anyone, holds it, and rule 13 forbids showing
    another passenger's berth number before payment anyway. So an empty slot
    never gains a number or a name; it is a shape, not a seat. Adding the
    berth number back (it is derivable — slot 3 of bay 2 is berth 11) would
    publish a stranger's berth. `tests/groups.test.ts` pins the digitless
    empty cell. */
export function groupBayRows(coach: GroupCoach): GroupBayRow[] {
  const rows = new Map<number, (GroupBerth | null)[]>()
  for (const berth of coach.berths) {
    if (berth.bay === null || berth.slot === null) continue
    let slots = rows.get(berth.bay)
    if (!slots) {
      slots = Array.from({ length: BERTHS_PER_BAY }, () => null)
      rows.set(berth.bay, slots)
    }
    slots[berth.slot - 1] = berth
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bay, slots]) => ({ bay, slots }))
}

/** Berths in this coach the numbering cannot place: a chair-car seat, or a
    confirmed seat with no number. They are seated, so they must never be drawn
    in the seatless row — that row means "no seat yet", and these people have
    one. They simply are not on the map. */
export function groupUnplacedBerths(coach: GroupCoach): GroupBerth[] {
  return coach.berths.filter((berth) => berth.bay === null)
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
