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
/* Hinglish transliterations of the same money verbs (docs/09: Hindi first). */
const HINGLISH_WORDS =
  /\b(khareed|kharid|bech|bhej|paise|paisa|nakad|nagad|nagdi|phone\s*pe)\b/i
/* Devanagari money verbs. No \b — it is ASCII-only — so these are plain
   substring matches; every entry is money-specific, never a common word. */
const HINDI_WORDS = /नकद|पैसे|पैसा|यूपीआई|यूपीआय|खरीद|बेच|फोन\s*पे/

const LEET: Record<string, string> = { '@': 'a', $: 's', '0': 'o', '1': 'l' }
/* Spelled-out digits for the "nine eight …" phone dodge. Only pure word runs
   count: mixing literal digits in would glue unrelated numbers (train + date)
   into phantom phone numbers. */
const NUM_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
}

/* Collapse spaced-out evasion ("U P I par", "s-e-l-l") back into words —
   but ONLY runs of single letters, so "Meet me near" and "A2 · 36" survive
   untouched. A naive strip-everything would glue "UPI" to "par" and break
   the word boundaries the keyword lists rely on. Leet ($→s, @→a, 0→o, 1→l)
   is decoded after joining. UPI ids and phone numbers are always tested on
   the untouched original. */
function squishEvasion(value: string): string {
  const joined = value.replace(
    /(^|[^A-Za-z])([A-Za-z](?:[\s\-·•._]+[A-Za-z])+)(?![A-Za-z])/g,
    (_m, pre: string, run: string) => pre + run.replace(/[\s\-·•._]+/g, ''),
  )
  return joined.replace(/[@$01]/g, (ch) => LEET[ch] ?? ch)
}

function digitsFromWords(value: string): string {
  return value
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((word) => NUM_WORDS[word] ?? '')
    .join('')
}

export function guardMessage(text: unknown): GuardResult {
  const value = String(text ?? '')
  const reasons: string[] = []
  if (UPI_ID.test(value)) reasons.push('upi_id')
  if (PHONE.test(value) || PHONE.test(digitsFromWords(value))) reasons.push('phone')
  const squished = squishEvasion(value)
  if (
    CASH_WORDS.test(value) ||
    CASH_WORDS.test(squished) ||
    HINGLISH_WORDS.test(value) ||
    HINDI_WORDS.test(value)
  ) {
    reasons.push('cash_words')
  }
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
