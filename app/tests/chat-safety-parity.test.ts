/* The chat-safety guard exists in two places, and they had drifted.
 *
 * `lib/chat-guard.ts` is what this device checks before sending; the
 * `check_message_safety` trigger in the schema is what every OTHER device
 * sees, because the receiver's screen reads `messages.flagged_risky` rather
 * than re-running the check. So the database copy has to be at least as strict
 * as the TypeScript one — and it was not: the English and numeric patterns
 * were present, but the Hinglish and Devanagari money verbs were missing, so
 * "bhej do paise" and "बेच दोगे क्या" were flagged on the sender's device and
 * stored as clean. The comment in the schema claimed it mirrored the TS guard,
 * which is exactly the kind of claim a test is for.
 *
 * This compares the three money vocabularies word for word. It cannot verify
 * the regex *shapes* (Postgres `\y` vs JS `\b`, and no lookahead in Postgres),
 * so it holds up coverage and leaves shape to review. That is the honest limit
 * of what a source-reading test can promise.
 */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const APP = join(import.meta.dirname, '..')
const ts = readFileSync(join(APP, 'src', 'lib', 'chat-guard.ts'), 'utf8')
const sql = readFileSync(join(APP, 'supabase', 'schema.sql'), 'utf8')

/** The words of one TS alternation, e.g. `HINGLISH_WORDS = /…/i`. */
function wordsOf(constName: string): string[] {
  const start = ts.indexOf(`${constName} =`)
  if (start < 0) return []
  /* Work inside this declaration's own text — from its name to the end of its
     statement — so nothing from a neighbouring constant can leak in. The two
     earlier attempts both failed in opposite directions: searching the whole
     file for the closing `/` swallowed the rest of the source (HINDI_WORDS has
     no `i` flag), and searching for `= /` picked up the *previous* line's
     `\b(` because these declarations wrap onto the next line. */
  const from = ts.indexOf(constName, start)
  const to = ts.indexOf(';', from)
  const decl = ts.slice(from, to < 0 ? from + 400 : to)
  const open = decl.indexOf('/')
  if (open < 0) return []
  /* The literal ends at the first `/` that is not inside a character class or
     an escape. */
  let i = open + 1
  while (i < decl.length) {
    if (decl[i] === '\\') i += 2
    else if (decl[i] === '[') {
      while (i < decl.length && decl[i] !== ']') i += 1
      i += 1
    } else if (decl[i] === '/') break
    else i += 1
  }
  return splitAlternatives(decl.slice(open + 1, i))
}

/** `फोन\s*पे` and `फोन पे` are the same word to a reader, and the two files
 * spell their optional spaces differently, so compare on collapsed runs. */
function normalise(word: string): string {
  return word
    .replace(/\\b|\\B/g, ' ')
    .replace(/\\s\*\??|\\s\+\??|[?*+()\\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* The guard's own body, not the whole file. Checking the whole schema made
 * this pass vacuously: a first version searched all of `schema.sql`, where the
 * words also appear in a *comment* explaining this very bug — so deleting the
 * real pattern left the test green. Only the executable `IF` matters. */
const TRIGGER = (() => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.check_message_safety()')
  const end = sql.indexOf('DROP TRIGGER IF EXISTS messages_safety_guard', start)
  if (start < 0 || end < 0) return ''
  return sql.slice(start, end)
})()

function triggerHas(word: string): boolean {
  const parts = normalise(word).split(' ').filter(Boolean)
  if (parts.length === 0) return false
  if (!TRIGGER.includes(parts[0])) return false
  return parts.slice(1).every((part) => TRIGGER.includes(part))
}

function splitAlternatives(body: string): string[] {
  return body.split('|').map(normalise).filter((w) => w.length > 2)
}

describe('the SQL chat-safety trigger covers what the TS guard covers', () => {
  it('flags every Hinglish money verb the TS guard flags', () => {
    const words = wordsOf('HINGLISH_WORDS')
    expect(words.length, 'the TS guard should list Hinglish verbs').toBeGreaterThan(3)
    for (const word of words) {
      expect(triggerHas(word), `'${word}' is in chat-guard.ts but not in the trigger`).toBe(true)
    }
  })

  it('flags every English money verb the TS guard flags', () => {
    const words = wordsOf('CASH_WORDS')
    expect(words.length, 'the TS guard should list English money verbs').toBeGreaterThan(5)
    for (const word of words) {
      expect(triggerHas(word), `'${word}' is in chat-guard.ts but not in the trigger`).toBe(true)
    }
  })

  it('flags every Devanagari money verb the TS guard flags', () => {
    const words = [...wordsOf('HINDI_WORDS').join(' ').matchAll(/[ऀ-ॿ]+/g)].map((m) => m[0])
    expect(words.length, 'the TS guard should list Devanagari verbs').toBeGreaterThan(5)
    for (const word of words) {
      expect(triggerHas(word), `Devanagari '${word}' is in chat-guard.ts but not in the trigger`).toBe(true)
    }
  })

  it('does not claim to mirror the guard unless it does', () => {
    /* The comment is what made this a silent gap: it said the trigger mirrored
       lib/chat-guard.ts while missing two of its three vocabularies. Keeping
       the claim is fine now that a test holds it up; removing it would hide
       the intent. */
    expect(sql).toMatch(/Mirrors lib\/chat-guard\.ts/)
  })
})
