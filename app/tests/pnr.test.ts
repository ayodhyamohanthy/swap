/* PNR rules: validation, masking, hashing and local booking-SMS parsing
   (Build Plan step 2, docs/08; privacy rule 13). */
import { describe, expect, it } from "vitest"

import {
  BERTH_BERTH_TYPES,
  CLASSES,
  RESTRICTED_QUOTAS,
  SEAT_TYPES,
  berthTypesFor,
  digitsOnly,
  hashPnr,
  isBerthType,
  isChairCar,
  isQuota,
  isTicketStatus,
  isTravelClass,
  isValidPnr,
  maskPnr,
  normaliseBerth,
  normaliseDate,
  normaliseQuota,
  normaliseStatus,
  parseBookingSms,
  parsePassengerList,
  pnrLast4,
} from "@/lib/pnr"

const SMS =
  "PNR: 4512789630 Train: 12951 MUMBAI RAJDHANI EXP DOJ: 12-11-2026 Class: 3A Coach: B3 Berth: 27 LOWER Status: CNF Quota: GN From: MMCT To: NDLS"

describe("PNR validation", () => {
  it("accepts exactly 10 digits, with or without spaces and dashes", () => {
    expect(isValidPnr("4512789630")).toBe(true)
    expect(isValidPnr(" 4512 789 630 ")).toBe(true)
    expect(isValidPnr("4512-789-630")).toBe(true)
  })

  it("rejects anything else", () => {
    for (const bad of ["", "123456789", "12345678901", "ABCDEFGHIJ", "451278963a", null, undefined]) {
      expect(isValidPnr(bad), "should reject " + String(bad)).toBe(false)
    }
  })

  it("keeps only the digits", () => {
    expect(digitsOnly("PNR 4512789630 ")).toBe("4512789630")
    expect(digitsOnly(undefined)).toBe("")
    expect(digitsOnly("4512 789 630")).toBe(digitsOnly("4512789630"))
  })
})

describe("privacy (rule 13)", () => {
  it("keeps only the last four digits", () => {
    expect(pnrLast4("4512789630")).toBe("9630")
    expect(pnrLast4("963")).toBe("963")
  })

  it("masks a PNR everywhere it is printed", () => {
    expect(maskPnr("4512789630")).toBe("••••••9630")
    expect(maskPnr("4512789630")).not.toContain("451278")
    expect(maskPnr("")).toBe("••••")
  })

  it("hashes the PNR into a 64-char digest that never contains it", async () => {
    const hash = await hashPnr("4512789630")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain("4512789630")
    expect(await hashPnr("4512 789 630")).toBe(hash)
    expect(await hashPnr("4512789631")).not.toBe(hash)
  })
})

describe("classes and berths", () => {
  it("knows the eight travel classes", () => {
    expect([...CLASSES]).toEqual(["1A", "2A", "3A", "3E", "SL", "CC", "EC", "2S"])
    expect(isTravelClass("sl")).toBe(true)
    expect(isTravelClass("3a")).toBe(true)
    expect(isTravelClass("XX")).toBe(false)
  })

  it("uses seat words for chair car and 2S, berths otherwise", () => {
    for (const chair of ["CC", "EC", "2S"]) {
      expect(isChairCar(chair)).toBe(true)
      expect(berthTypesFor(chair)).toBe(SEAT_TYPES)
    }
    for (const sleeper of ["1A", "2A", "3A", "3E", "SL"]) {
      expect(isChairCar(sleeper)).toBe(false)
      expect(berthTypesFor(sleeper)).toBe(BERTH_BERTH_TYPES)
    }
  })

  it("normalises the berth words used in SMS and tickets", () => {
    expect(normaliseBerth("LOWER")).toBe("LB")
    expect(normaliseBerth("upper")).toBe("UB")
    expect(normaliseBerth("Middle")).toBe("MB")
    expect(normaliseBerth("SIDE LOWER")).toBe("SL")
    expect(normaliseBerth("Side Upper")).toBe("SU")
    expect(normaliseBerth("window")).toBe("WINDOW")
    expect(normaliseBerth("")).toBeUndefined()
    expect(isBerthType("LB")).toBe(true)
    expect(isBerthType("XX")).toBe(false)
  })

  it("normalises ticket status and quota", () => {
    expect(normaliseStatus("CNF")).toBe("CNF")
    expect(normaliseStatus("Confirmed")).toBe("CNF")
    expect(normaliseStatus("RAC 12")).toBe("RAC")
    expect(normaliseStatus("WL23")).toBe("WL")
    expect(normaliseStatus("cancelled")).toBe("CAN")
    expect(normaliseStatus("???")).toBeUndefined()
    expect(isTicketStatus("WL")).toBe(true)

    expect(normaliseQuota("General")).toBe("GN")
    expect(normaliseQuota("SENIOR CITIZEN")).toBe("SS")
    expect(normaliseQuota("Ladies")).toBe("LD")
    expect(normaliseQuota("Premium Tatkal")).toBe("PT")
    expect(isQuota("SS")).toBe(true)
    expect([...RESTRICTED_QUOTAS]).toEqual(["SS", "LD", "HP"])
  })

  it("reads journey dates in the formats IRCTC sends", () => {
    expect(normaliseDate("12-11-2026")).toBe("2026-11-12")
    expect(normaliseDate("5/11/26")).toBe("2026-11-05")
    expect(normaliseDate("5 NOV 2026")).toBe("2026-11-05")
    expect(normaliseDate("someday")).toBeUndefined()
  })
})

describe("booking SMS parsing (runs on the device)", () => {
  it("fills the trip form from a booking SMS", () => {
    const parsed = parseBookingSms(SMS)
    expect(parsed.pnr).toBe("4512789630")
    expect(parsed.train_no).toBe("12951")
    expect(parsed.journey_date).toBe("2026-11-12")
    expect(parsed.class).toBe("3A")
    expect(parsed.coach).toBe("B3")
    expect(parsed.berth_no).toBe("27")
    expect(parsed.berth_type).toBe("LB")
    expect(parsed.status).toBe("CNF")
    expect(parsed.quota).toBe("GN")
    expect(parsed.from_code).toBe("MMCT")
    expect(parsed.to_code).toBe("NDLS")
    expect(parsed.filled).toBeGreaterThanOrEqual(10)
  })

  it("reads a chair-car SMS with a seat word", () => {
    const parsed = parseBookingSms(
      "PNR 9988776655 CC 22120 SBC TO MAS DOJ 01 JAN 2027 CLASS CC COACH C2 BERTH NO 44 WINDOW CNF",
    )
    expect(parsed.pnr).toBe("9988776655")
    expect(parsed.train_no).toBe("22120")
    expect(parsed.class).toBe("CC")
    expect(parsed.berth_no).toBe("44")
    expect(parsed.berth_type).toBe("WINDOW")
    expect(parsed.from_code).toBe("SBC")
    expect(parsed.to_code).toBe("MAS")
    expect(parsed.journey_date).toBe("2027-01-01")
  })

  it("never throws and reports how much it could read", () => {
    expect(parseBookingSms("")).toEqual({ filled: 0 })
    expect(parseBookingSms(undefined)).toEqual({ filled: 0 })
    const noise = parseBookingSms("hello there, this is not a ticket")
    expect(noise.filled).toBe(0)
    expect(noise.pnr).toBeUndefined()
  })

  it("keeps a short PNR out of the trip form", () => {
    const parsed = parseBookingSms("PNR 12345")
    expect(isValidPnr(parsed.pnr)).toBe(false)
  })

  it("reads every berth a multi-passenger SMS names", () => {
    const parsed = parseBookingSms(
      "PNR:4512789630 TRN:12951 DOJ:12-11-26 3A MMCT to NDLS P1-B3,27 LB CNF, P2-B3,30 UB CNF",
    )
    expect(parsed.passengers).toEqual([
      { coach: "B3", berth_no: "27", berth_type: "LB", status: "CNF" },
      { coach: "B3", berth_no: "30", berth_type: "UB", status: "CNF" },
    ])
    /* The single-passenger fields keep pointing at the first berth. */
    expect(parsed.coach).toBe("B3")
    expect(parsed.berth_no).toBe("27")
  })

  it("ignores waitlist serials, train numbers and dates when listing berths", () => {
    expect(parsePassengerList("PNR 4512789630 TRN 12951 DOJ 12-11-2026 WL23", "SL")).toEqual([])
    expect(
      parsePassengerList("S1,23 LB RAC, S2,45 SU CNF", "SL"),
    ).toEqual([
      { coach: "S1", berth_no: "23", berth_type: "LB", status: "RAC" },
      { coach: "S2", berth_no: "45", berth_type: "SU", status: "CNF" },
    ])
  })

  it("reads chair-car seats with facing words", () => {
    expect(parsePassengerList("C2 44 WINDOW, C2 45 AISLE", "CC")).toEqual([
      { coach: "C2", berth_no: "44", berth_type: "WINDOW" },
      { coach: "C2", berth_no: "45", berth_type: "AISLE" },
    ])
  })
})
