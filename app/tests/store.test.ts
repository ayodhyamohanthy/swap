/* Trips and store operations (AGENTS.md rules 2, 4, 5, 8, 13; Build Plan step 2).
   Runs local-first in memory/localStorage. */
import { beforeEach, describe, expect, it } from "vitest"

import type { CandidateSpec, RequesterSpec } from "@/lib/matching"

import {
  StoreError,
  activityLog,
  addTrip,
  attachToAccount,
  creditPaise,
  detachFromAccount,
  exportForSync,
  getTrip,
  isSeen,
  listTrips,
  markQuotaNoteSeen,
  markSeen,
  removeTrip,
  resetStore,
  setOpenToSwap,
  setReminder,
  settings,
  updateSettings,
  type Trip,
} from "@/lib/store"

describe("local trips store", () => {
  beforeEach(() => {
    resetStore()
  })

  it("adds a trip and validates PNR (10 digits required)", async () => {
    await expect(
      addTrip({
        pnr: "123",
        train_no: "12951",
        journey_date: "2026-11-12",
        class: "3A",
        passengers: [{ coach: "B3", berth_no: "27", berth_type: "LB" }],
      }),
    ).rejects.toThrow(StoreError)

    const trip = await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      train_name: "Mumbai Rajdhani",
      journey_date: "2026-11-12",
      class: "3A",
      from_code: "MMCT",
      to_code: "NDLS",
      passengers: [{ coach: "B3", berth_no: "27", berth_type: "LB" }],
    })

    expect(trip.id).toBeDefined()
    expect(trip.pnr_last4).toBe("9630")
    expect(trip.pnr_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(trip.pnr_hash).not.toContain("4512789630")
    expect(trip.train_no).toBe("12951")
    expect(trip.passengers.length).toBe(1)
    expect(trip.passengers[0].coach).toBe("B3")
    expect(trip.passengers[0].berth_no).toBe("27")
  })

  it("prevents duplicate PNR additions", async () => {
    await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      passengers: [{ coach: "B3", berth_no: "27" }],
    })

    await expect(
      addTrip({
        pnr: "4512 789 630", // formatted same PNR
        train_no: "12951",
        journey_date: "2026-11-12",
        class: "3A",
        passengers: [{ coach: "B3", berth_no: "27" }],
      }),
    ).rejects.toThrow("pnr_duplicate")
  })

  it("supports trip removal and retrieval", async () => {
    const trip = await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      passengers: [],
    })

    expect(getTrip(trip.id)).toBeDefined()
    expect(listTrips().length).toBe(1)

    removeTrip(trip.id)
    expect(getTrip(trip.id)).toBeUndefined()
    expect(listTrips().length).toBe(0)
  })

  it("sets open_to_swap flag without giving free credit (rule 5)", async () => {
    const trip = await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      passengers: [],
    })

    expect(trip.open_to_swap).toBe(false)
    const updated = setOpenToSwap(trip.id, true)
    expect(updated?.open_to_swap).toBe(true)
    // Rule 5: being open to swap earns NO credit; balance is still 0
    expect(creditPaise()).toBe(0)
  })

  it("updates quota note seen and reminder toggles", async () => {
    const trip = await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      passengers: [{ quota: "SS", status: "WL" }],
    })

    expect(trip.quota_note_seen).toBe(false)
    markQuotaNoteSeen(trip.id)
    expect(getTrip(trip.id)?.quota_note_seen).toBe(true)

    expect(trip.reminder_on).toBe(false)
    setReminder(trip.id, true)
    expect(getTrip(trip.id)?.reminder_on).toBe(true)
  })

  it("records activity log rows on state transitions (convention rule)", async () => {
    const initialLogs = activityLog().length
    const trip = await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      passengers: [],
    })

    const logsAfterAdd = activityLog()
    expect(logsAfterAdd.length).toBeGreaterThan(initialLogs)
    expect(logsAfterAdd[0].action).toBe("pnr_added")

    setOpenToSwap(trip.id, true)
    expect(activityLog()[0].action).toBe("open_to_swap_on")
  })

  it("attaches local trips to account on Google sign-in (rule 8, step 3 prep)", async () => {
    const trip = await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      passengers: [],
    })
    expect(trip.user_id).toBeNull()

    const userId = "google-user-123"
    const attached = attachToAccount(userId)
    expect(attached.length).toBe(1)
    expect(attached[0].user_id).toBe(userId)
    expect(getTrip(trip.id)?.user_id).toBe(userId)
    expect(settings().user_id).toBe(userId)

    const detached = detachFromAccount()
    expect(detached[0].user_id).toBe(userId)
    expect(getTrip(trip.id)?.user_id).toBe(userId)
    expect(settings().user_id).toBeNull()
  })

  it("exports payload for sync (exportForSync)", async () => {
    await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      passengers: [{ coach: "B3", berth_no: "27", berth_type: "LB" }],
    })

    const syncPayload = exportForSync()
    expect(syncPayload.bookings.length).toBe(1)
    expect(syncPayload.bookings[0].pnr_last4).toBe("9630")
    expect(syncPayload.passengers.length).toBe(1)
    expect(syncPayload.passengers[0].coach).toBe("B3")
    expect(syncPayload.activity.length).toBeGreaterThan(0)
  })

  it("manages seen flags and settings (easy_mode, language)", () => {
    expect(isSeen("welcome_banner")).toBe(false)
    markSeen("welcome_banner")
    expect(isSeen("welcome_banner")).toBe(true)

    expect(settings().easy_mode).toBe(false)
    updateSettings({ easy_mode: true, language: "hi" })
    expect(settings().easy_mode).toBe(true)
    expect(settings().language).toBe("hi")
  })
})

describe("trip ratings feed future matches, never money", () => {
  beforeEach(() => {
    resetStore()
  })

  it("stores stars per trip and averages them", async () => {
    const { rateTrip, tripRating } = await import("@/lib/store")
    expect(tripRating("t9")).toBeNull()
    expect(rateTrip("t9", 5)).toEqual({ sum: 5, count: 1 })
    expect(rateTrip("t9", 3)).toEqual({ sum: 8, count: 2 })
    expect(tripRating("t9")).toBe(4)
  })

  it("rejects out-of-range stars instead of clamping", async () => {
    const { rateTrip } = await import("@/lib/store")
    for (const bad of [0, 6, 2.5, Number.NaN]) {
      expect(() => rateTrip("t9", bad)).toThrow("rating_range")
    }
  })

  it("logs every rating and never touches the wallet", async () => {
    const { rateTrip } = await import("@/lib/store")
    rateTrip("t9", 5)
    expect(activityLog()[0]).toMatchObject({ action: "rating_given" })
    expect(creditPaise()).toBe(0)
  })

  it("lifts a rated trip in match scores", async () => {
    const { rankMatches } = await import("@/lib/matching")
    const requester: RequesterSpec = {
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      from_code: "MMCT",
      to_code: "NDLS",
      choices: ["UB"],
      same_coach: false,
      keep_together: false,
      coach: "B3",
      quota: "GN",
    }
    const base: Omit<CandidateSpec, "id" | "rating"> = {
      user_id: "u",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      from_code: "MMCT",
      to_code: "NDLS",
      coach: "B4",
      berth_no: "41",
      berth_type: "UB",
      status: "CNF",
      quota: "GN",
      open_to_swap: true,
      paused: false,
      women_only: false,
      families_only: false,
      same_coach_only: false,
    }
    const rows = rankMatches(requester, [
      { ...base, id: "plain", rating: 0 },
      { ...base, id: "rated", rating: 10 },
    ])
    expect(rows.map((row) => row.id)).toEqual(["rated", "plain"])
    expect(rows[0].score).toBeGreaterThan(rows[1].score)
  })

  it("carries a trip's rating into its match candidacy", async () => {
    const { rateTrip } = await import("@/lib/store")
    const { createRequest, matchesFor, resetRequests } = await import("@/lib/requests")
    resetRequests()
    const mine = await addTrip({
      pnr: "4512789630",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      from_code: "MMCT",
      to_code: "NDLS",
      passengers: [{ coach: "B3", berth_no: "27", berth_type: "LB" }],
    })
    const theirs = await addTrip({
      pnr: "4512789648",
      train_no: "12951",
      journey_date: "2026-11-12",
      class: "3A",
      from_code: "MMCT",
      to_code: "NDLS",
      passengers: [{ coach: "B4", berth_no: "41", berth_type: "UB" }],
    })
    setOpenToSwap(theirs.id, true)
    rateTrip(theirs.id, 4)
    const request = createRequest({ trip_id: mine.id, choices: ["UB"] })
    const row = matchesFor(request.id).find((r): r is { candidate: CandidateSpec; trip: Trip } => "candidate" in r)
    expect(row?.candidate.rating).toBe(8)
  })
})
