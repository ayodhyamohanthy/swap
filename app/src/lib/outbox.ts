/* Offline chat outbox (docs/08): messages typed without network are queued on
   this device and sent when the connection returns. Nothing leaves the phone
   while offline; the queue is per chat and holds plain text only. */

const KEY = 'seatswap.outbox.v1'

type Outbox = Record<string, string[]>

function readBox(): Outbox {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const box: Outbox = {}
    for (const [chatId, texts] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(texts)) box[chatId] = texts.filter((t): t is string => typeof t === 'string')
    }
    return box
  } catch {
    return {}
  }
}

function writeBox(box: Outbox): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(box))
  } catch {
    /* Storage full or blocked: the in-memory send still shows the message. */
  }
}

/** Queue a message typed while offline. Returns the queue length for the chat. */
export function enqueue(chatId: string, text: string): number {
  const clean = text.trim()
  if (!clean) return pending(chatId).length
  const box = readBox()
  const next = [...(box[chatId] ?? []), clean]
  box[chatId] = next
  writeBox(box)
  return next.length
}

/** Messages still waiting for a connection, oldest first. */
export function pending(chatId: string): string[] {
  return readBox()[chatId] ?? []
}

/** Take every queued message and empty the queue (call when back online). */
export function flush(chatId: string): string[] {
  const box = readBox()
  const texts = box[chatId] ?? []
  if (texts.length > 0) {
    delete box[chatId]
    writeBox(box)
  }
  return texts
}

/** Total queued messages across all chats (for badges). */
export function pendingCount(): number {
  return Object.values(readBox()).reduce((total, texts) => total + texts.length, 0)
}
