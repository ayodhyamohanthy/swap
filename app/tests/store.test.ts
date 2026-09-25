/* Trips and store operations (AGENTS.md rules 2, 4, 5, 8, 13; Build Plan step 2).
   Runs local-first in memory/localStorage. */
import { beforeEach, describe, expect, it } from "vitest"

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
    expect(detached[0].user_id).toBeNull()
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
