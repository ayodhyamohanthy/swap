/* SeatSwap PNR utilities — Build Plan step 2 (Trips).
   Indian trains only (docs/01 scope). Everything here runs on the device:
   the same code parses a typed PNR and a pasted booking SMS.

   Privacy (AGENTS.md rule 13, docs/08): a full PNR is never stored in plain
   text. We keep `pnr_hash` (SHA-256 + salt) and `pnr_last4` only. The salt is a
   build-time placeholder for local hashing; when trips sync in step 3 the hash
   is recomputed server-side with the server salt. */

export const CLASSES = ['1A', '2A', '3A', '3E', 'SL', 'CC', 'EC', '2S'] as const
export type TravelClass = (typeof CLASSES)[number]

/** Chair car and 2S use seat words, not berths. */
export const CHAIR_CLASSES = ['CC', 'EC', '2S'] as const

export const BERTH_TYPES = [
  'LB',
  'MB',
  'UB',
  'SL',
  'SU',
  'WINDOW',
  'AISLE',
  'MIDDLE_SEAT',
] as const
export type BerthType = (typeof BERTH_TYPES)[number]

/** Sleeper-style berths. */
export const BERTH_BERTH_TYPES: readonly BerthType[] = ['LB', 'MB', 'UB', 'SL', 'SU']
/** Seat words for chair car / 2S. */
export const SEAT_TYPES: readonly BerthType[] = ['WINDOW', 'AISLE', 'MIDDLE_SEAT']

export const TICKET_STATUSES = ['CNF', 'RAC', 'WL', 'CAN'] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

/** SS senior citizen, LD ladies, HP disability (docs/02). */
export const QUOTAS = ['GN', 'SS', 'LD', 'HP', 'TQ', 'PT', 'OTHER'] as const
export type Quota = (typeof QUOTAS)[number]

/** A berth given on a quota is only offered to people who qualify. */
export const RESTRICTED_QUOTAS: readonly Quota[] = ['SS', 'LD', 'HP']

export const PNR_LENGTH = 10 as const
const PNR_SALT = 'seatswap-v1'

export function digitsOnly(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function isValidPnr(value: unknown): boolean {
  return new RegExp(`^[0-9]{${PNR_LENGTH}}$`).test(digitsOnly(value))
}

export function pnrLast4(value: unknown): string {
  return digitsOnly(value).slice(-4)
}

/** "••••••1234" — the only form of a PNR we ever print. */
export function maskPnr(value: unknown): string {
  const digits = digitsOnly(value)
  return digits.length <= 4 ? '••••' : `••••••${digits.slice(-4)}`
}

/** SHA-256(salt + PNR) as hex. Falls back to a local digest if WebCrypto is absent. */
export async function hashPnr(value: unknown): Promise<string> {
  const message = `${PNR_SALT}:${digitsOnly(value)}`
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(message))
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < message.length; i += 1) {
    h1 = Math.imul(h1 ^ message.charCodeAt(i), 16777619) >>> 0
    h2 = Math.imul(h2 + message.charCodeAt(i), 31) >>> 0
  }
  return `fallback-${h1.toString(16)}${h2.toString(16)}`
}

export function isChairCar(travelClass: unknown): boolean {
  return (CHAIR_CLASSES as readonly string[]).includes(String(travelClass).toUpperCase())
}

export function berthTypesFor(travelClass: unknown): readonly BerthType[] {
  return isChairCar(travelClass) ? SEAT_TYPES : BERTH_BERTH_TYPES
}

export function isTravelClass(value: unknown): value is TravelClass {
  return (CLASSES as readonly string[]).includes(String(value).toUpperCase())
}

export function isBerthType(value: unknown): value is BerthType {
  return (BERTH_TYPES as readonly string[]).includes(String(value).toUpperCase())
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(String(value).toUpperCase())
}

export function isQuota(value: unknown): value is Quota {
  return (QUOTAS as readonly string[]).includes(String(value).toUpperCase())
}

/* ------------------------------------------------------------------ *
 * Booking-SMS parsing (local, regex only — nothing is ever uploaded)  *
 * ------------------------------------------------------------------ */

export interface ParsedPassenger {
  coach?: string
  berth_no?: string
  berth_type?: BerthType
  status?: TicketStatus
}

export interface ParsedBookingSms {
  pnr?: string
  train_no?: string
  journey_date?: string
  class?: TravelClass
  coach?: string
  berth_no?: string
  berth_type?: BerthType
  status?: TicketStatus
  quota?: Quota
  from_code?: string
  to_code?: string
  /** Every berth the SMS names, in order — drives the multi-passenger form. */
  passengers?: ParsedPassenger[]
  /** How many fields we could read — drives the "we filled what we could" note. */
  filled: number
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

export function normaliseDate(input: unknown): string | undefined {
  const text = String(input ?? '').toUpperCase().trim()
  const numeric = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (numeric) {
    const [, d, m, yRaw] = numeric
    const year = yRaw.length === 2 ? `20${yRaw}` : yRaw
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const named = text.match(/(\d{1,2})[\s-]*([A-Z]{3})[\s-]*(\d{2,4})/)
  if (named) {
    const [, d, mon, yRaw] = named
    const month = MONTHS[mon]
    if (!month) return undefined
    const year = yRaw.length === 2 ? `20${yRaw}` : yRaw
    return `${year}-${month}-${d.padStart(2, '0')}`
  }
  return undefined
}

export function normaliseBerth(input: unknown, travelClass?: unknown): BerthType | undefined {
  const value = String(input ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
  if (!value) return undefined
  if (value.startsWith('SIDE L') || value === 'SL') return 'SL'
  if (value.startsWith('SIDE U') || value === 'SU') return 'SU'
  if (value.startsWith('LOW')) return 'LB'
  if (value.startsWith('UPP')) return 'UB'
  if (value === 'MB' || value.startsWith('MIDDLE B') || value.startsWith('MID')) {
    return isChairCar(travelClass) ? 'MIDDLE_SEAT' : 'MB'
  }
  if (value === 'WINDOW') return 'WINDOW'
  if (value === 'AISLE') return 'AISLE'
  if (value === 'MIDDLE' || value === 'MIDDLE SEAT' || value === 'MIDDLE_SEAT') {
    return isChairCar(travelClass) ? 'MIDDLE_SEAT' : 'MB'
  }
  if (isBerthType(value)) return value as BerthType
  return isChairCar(travelClass) ? 'WINDOW' : undefined
}

export function normaliseStatus(input: unknown): TicketStatus | undefined {
  const value = String(input ?? '').toUpperCase()
  if (value.startsWith('CNF') || value.startsWith('CONFIRM')) return 'CNF'
  if (value.startsWith('RAC')) return 'RAC'
  if (value.startsWith('WL') || value.startsWith('WAIT')) return 'WL'
  if (value.startsWith('CAN')) return 'CAN'
  return undefined
}

export function normaliseQuota(input: unknown): Quota | undefined {
  const value = String(input ?? '').toUpperCase()
  if (value.includes('PREMIUM')) return 'PT'
  if (value.includes('SENIOR') || /\bSS\b/.test(value)) return 'SS'
  if (value.includes('LADIES') || /\bLD\b/.test(value)) return 'LD'
  if (value.includes('HANDICAP') || value.includes('DISABIL') || /\bHP\b/.test(value)) return 'HP'
  if (value.includes('TATKAL') || /\bTQ\b/.test(value)) return 'TQ'
  if (/\bPT\b/.test(value)) return 'PT'
  if (/\bGN\b/.test(value) || value.includes('GENERAL')) return 'GN'
  return undefined
}

/** Read a pasted booking SMS. Never throws; unreadable fields stay undefined. */
export function parseBookingSms(sms: unknown): ParsedBookingSms {
  const text = String(sms ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
  const out: ParsedBookingSms = { filled: 0 }
  if (!text) return out

  const pnr = text.match(/PNR[\s:.#-]*([0-9]{10})/) ?? text.match(/\b([0-9]{10})\b/)
  if (pnr) out.pnr = pnr[1]

  const train =
    text.match(/(?:TRAIN|TRN|TR)\.?[\s:.#-]*(?:NO\.?)?[\s:.#-]*([0-9]{3,5})\b/) ??
    text.match(/\b([0-9]{5})\b/)
  if (train) out.train_no = train[1]

  const date =
    text.match(/(?:DOJ|DD|DATE(?:\s*OF\s*JOURNEY)?)[\s:.#-]*([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4})/) ??
    text.match(/([0-9]{1,2}[-/.][0-9]{1,2}[-/.][0-9]{2,4})/) ??
    text.match(/([0-9]{1,2}[\s-][A-Z]{3}[\s-][0-9]{2,4})/)
  if (date) out.journey_date = normaliseDate(date[1])

  const cls = text.match(/\b(1A|2A|3A|3E|SL|CC|EC|2S)\b/)
  if (cls && isTravelClass(cls[1])) out.class = cls[1]

  const coach =
    text.match(/(?:COACH|CNF)[\s:.#-]*([A-Z]{1,2}[0-9]{1,2})\b/)?.[1] ??
    bareCoach(text)
  if (coach) out.coach = coach

  const berth = text.match(
    /\b([0-9]{1,3})\s*(SIDE\s+LOWER|SIDE\s+UPPER|LOWER|MIDDLE|UPPER|LB|MB|UB|SL|SU)\b/,
  )
  if (berth) {
    out.berth_no = berth[1]
    const type = normaliseBerth(berth[2], out.class)
    if (type) out.berth_type = type
  } else {
    const numbered = text.match(/(?:BERTH|SEAT)\s*\.?\s*(?:NO\.?)?[\s:.#-]*([0-9]{1,3})\b/)
    if (numbered) out.berth_no = numbered[1]
    const seatWord = text.match(/\b(WINDOW|AISLE|MIDDLE(?:\s+SEAT)?)\b/)
    if (seatWord) {
      const type = normaliseBerth(seatWord[1], out.class)
      if (type) out.berth_type = type
    }
  }

  const status = text.match(/\b(CNF|CONFIRMED|RAC|WL[0-9]*|WAITLIST(?:ED)?|CAN|CANCELLED)\b/)
  if (status) {
    const value = normaliseStatus(status[1])
    if (value) out.status = value
  }

  const route =
    text.match(/\b([A-Z]{3,4})\s*(?:TO|->|→|-)\s*([A-Z]{3,4})\b/) ??
    text.match(/\b(?:FROM|SRC)[:\s]+([A-Z]{3,4})\b.*\b(?:TO|DST)[:\s]+([A-Z]{3,4})\b/)
  if (route) {
    out.from_code = route[1]
    out.to_code = route[2]
  }

  const quotaWord = text.match(
    /\b(PREMIUM\s+TATKAL|SENIOR\s+CITIZEN|LADIES|HANDICAP|DISABILITY|TATKAL|GN|SS|LD|HP|TQ|PT)\b/,
  )
  const quota = quotaWord ? normaliseQuota(quotaWord[1]) : undefined
  if (quota) out.quota = quota

  /* Every "COACH, BERTH TYPE STATUS" segment the SMS names, in order — a real
     IRCTC SMS lists one per passenger ("P1-B3,27 LB CNF, P2-B3,30 UB CNF").
     The single-passenger fields above keep pointing at the first berth. */
  const seen = parsePassengerList(text, out.class)
  if (seen.length > 0) out.passengers = seen

  out.filled = Object.entries(out).filter(
    ([key, value]) => key !== 'filled' && value !== undefined && value !== '',
  ).length
  return out
}

/** Bare "B3" coach without a COACH: prefix. Skips passenger labels ("P1-B3"
    is passenger 1, not a coach) and seat words. */
function bareCoach(text: string): string | undefined {
  const re = /\b([A-Z][0-9]{1,2})\b(?!\s*(?:LOWER|MIDDLE|UPPER|WINDOW|AISLE))\b/g
  for (const match of text.matchAll(re)) {
    if (/^P[0-9]{1,2}$/.test(match[1])) continue
    return match[1]
  }
  return undefined
}

/** All coach+berth segments in an SMS, each with its own type and status. */
export function parsePassengerList(text: unknown, travelClass?: unknown): ParsedPassenger[] {
  const upper = String(text ?? '').toUpperCase().replace(/\s+/g, ' ').trim()
  if (!upper) return []
  const found: ParsedPassenger[] = []
  const re =
    /\b([A-Z]{1,2}[0-9]{1,2})\s*[,:\s-]+\s*([0-9]{1,3})(?:\s*(SIDE\s+LOWER|SIDE\s+UPPER|LOWER|MIDDLE|UPPER|WINDOW|AISLE|MIDDLE\s+SEAT|LB|MB|UB|SL|SU))?(?:\s*(CNF|CONFIRMED|RAC|WL[0-9]*|WAITLIST(?:ED)?|CAN|CANCELLED))?/g
  let match: RegExpExecArray | null
  while ((match = re.exec(upper)) !== null) {
    const berthType = match[3] ? normaliseBerth(match[3], travelClass) : undefined
    const status = match[4] ? normaliseStatus(match[4]) : undefined
    /* Skip train numbers, dates, and WL serials the coach pattern catches. */
    if (match[1].length > 3 || match[1] === 'WL' || Number(match[2]) > 200) continue
    found.push({
      coach: match[1],
      berth_no: match[2],
      ...(berthType ? { berth_type: berthType } : {}),
      ...(status ? { status } : {}),
    })
    if (found.length >= 6) break
  }
  return found
}

/* ------------------------------------------------------------------ *
 * Home quick-entry → Add PNR handoff                                  *
 * ------------------------------------------------------------------ */

const HANDOFF_KEY = 'seatswap.pnr.handoff'

/**
 * Hand the digits typed on Home to the Add PNR screen.
 *
 * Not a URL query: an address bar is kept in browser history, shown in the tab
 * switcher and sent on as a referrer, and a PNR is the one credential this app
 * promises never to hold in plain text (rule 13) — `pnr_hash` + `pnr_last4` is
 * all the store keeps. Same tab, same session, cleared on arrival.
 */
export function stagePnr(digits: string): void {
  try {
    sessionStorage.setItem(HANDOFF_KEY, digits)
  } catch {
    /* Private mode with storage blocked: Home still validates the digits, the
       traveller types them once more. Never fail the navigation. */
  }
}

/** Peek, without consuming: React runs a state initialiser twice under
    StrictMode, and the second run must see the same number. */
export function readStagedPnr(): string {
  try {
    return sessionStorage.getItem(HANDOFF_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Called once the Add PNR screen has mounted. */
export function clearStagedPnr(): void {
  try {
    sessionStorage.removeItem(HANDOFF_KEY)
  } catch {
    /* Already gone. */
  }
}
