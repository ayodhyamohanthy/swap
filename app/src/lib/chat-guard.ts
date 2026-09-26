/* SeatSwap chat guard — risky-message detector + rate limit (docs/04 A12).
   Cash / UPI ids / phone numbers / pay-me-or-sell words are flagged and hidden
   behind the "Pay only inside SeatSwap" warning. Quick replies keep on-board
   chat short and safe. */

export interface GuardResult {
  flagged: boolean
  hidden: boolean
  /** i18n copy key for the warning (docs/09 cash warning). */
  warningKey: 'chat.cashWarning' | null
  reasons: string[]
}

const UPI_ID = /[a-z0-9._-]{2,}@[a-z]{2,}/i
const PHONE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/
const CASH_WORDS =
  /\b(cash|upi|gpay|phonepe|paytm|pay\s?me|send\s+(me\s+)?money|transfer|account\s*(no|number|detail)|ifsc|qr(\s*code)?|bribe|tip\s*(me|us)?|extra\s*(money|cash|charge|fee|payment)|sell|buy|charge\s*(extra|more))\b/i

export function guardMessage(text: unknown): GuardResult {
  const value = String(text ?? '')
  const reasons: string[] = []
  if (UPI_ID.test(value)) reasons.push('upi_id')
  if (PHONE.test(value)) reasons.push('phone')
  if (CASH_WORDS.test(value)) reasons.push('cash_words')
  const flagged = reasons.length > 0
  return { flagged, hidden: flagged, warningKey: flagged ? 'chat.cashWarning' : null, reasons }
}

/* Rate limit: max 12 messages per 60s per chat (client-side helper; the server
   enforces the same window before inserting a message row). */
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 12

export function isRateLimited(sentAtMs: number[]): boolean {
  const now = Date.now()
  return sentAtMs.filter((t) => now - t < WINDOW_MS).length >= MAX_PER_WINDOW
}

export function rateLimitCopyKey(): 'chat.slowDown' {
  return 'chat.slowDown'
}

export const QUICK_REPLIES = ['chat.quickAtBerth', 'chat.quickDoor', 'chat.quickMet'] as const
