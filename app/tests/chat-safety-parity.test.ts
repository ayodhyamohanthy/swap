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
 * This compares the three money vocabularies word for word. It used to say it
 * could not verify the regex *shapes* — "(Postgres `\y` vs JS `\b`, and no
 * lookahead in Postgres), so it holds up coverage and leaves shape to review" —
 * and that sentence was wrong twice over. The shapes are exactly where the
 * defects were: the phone pattern demanded ten CONSECUTIVE digits while the TS
 * one allows a separator after the fifth, and neither `squishEvasion()` nor
 * `digitsFromWords()` had a database counterpart at all. And the constraint
 * offered for skipping them does not exist: Postgres 18 has lookahead AND
 * lookbehind, so the TS shapes port verbatim. The tests at the bottom now run
 * the SHIPPED pattern text through a JS engine instead of comparing it to a
 * snapshot, so a rewrite is re-evaluated rather than matched.
 */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'
import { stripSqlComments } from '../scripts/staging-lib.mjs'

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

/* The guard's own body, not the whole file — AND with its comments stripped.
 *
 * Checking the whole schema made this pass vacuously: a first version searched
 * all of `schema.sql`, where the words also appear in a *comment* explaining
 * this very bug, so deleting the real pattern left the test green. Slicing to
 * the function body fixed that at the FILE level, but the explanatory prose
 * lives INSIDE the body, so the vacuity survived one level down: `bhej` occurs
 * in the line "so 'bhej do paise' … passed", so a substring check over the raw
 * slice stayed GREEN with `bhej` deleted from the real alternation. Found by
 * mutation (`mutate-chatguard8.mjs`, drop-one-word-from-the-hinglish-vocabulary,
 * SURVIVED), not by reading — which is the whole reason that harness exists.
 * Only the executable SQL counts. */
const TRIGGER = (() => {
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.check_message_safety()')
  const end = sql.indexOf('DROP TRIGGER IF EXISTS messages_safety_guard', start)
  if (start < 0 || end < 0) return ''
  return stripSqlComments(sql.slice(start, end))
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

  it('is not satisfiable by the explanatory prose inside the function', () => {
    /* The vacuity that hid this hole for a whole pass. `triggerHas` is a
       substring match over the guard body, and that body's own comment says
       "so 'bhej do paise' … passed" — so deleting `bhej` from the real
       alternation left every vocabulary test GREEN, satisfied by a sentence
       describing the bug it was supposed to catch. A probe that exists ONLY in
       prose is the only way to assert the difference: `Meetmenear` is the
       naive-collapse example from the sentinel paragraph and appears nowhere in
       executable SQL. */
    expect(TRIGGER.includes('Meetmenear'), 'comment prose must not be searchable').toBe(false)
    expect(TRIGGER, 'the executable body must survive comment stripping').toContain(
      'flagged_risky',
    )
    expect(TRIGGER, 'and the real alternation must still be there').toContain('khareed')
  })
})

/* ------------------------------------------------------------------ *
 * Shape parity: the shipped patterns, actually run.
 *
 * The `\y` caveat from the phone test still applies — JS reads `\y` as a
 * literal `y`, so any pattern containing it is translated to `\b` before being
 * run here. Everything else is the SHIPPED text, so these assertions follow a
 * rewrite instead of pinning a snapshot. The behavioural authority is the
 * differential harness recorded in docs/DECISIONS.md (it runs the real trigger
 * under PostgreSQL 18.3 against the real TS module); these are the CI half.
 * ------------------------------------------------------------------ */
describe('the SQL guard carries the evasion half, and the shipped shapes behave', () => {
  const lineWith = (needle: string): string =>
    TRIGGER.split('\n').find((l) => l.includes(needle)) ?? ''
  const quoted = (line: string): string => line.match(/'([^']+)'/)?.[1] ?? ''

  const CASH_SOURCE = quoted(lineWith('(cash|upi|gpay'))
  const HINGLISH_SOURCE = quoted(lineWith('(khareed|'))
  const SQUISH_SOURCE = quoted(lineWith('(?<=[^A-Za-z][A-Za-z])'))
  const LEET = lineWith('translate(v_squished').match(/'([^']+)', '([^']+)'/)
  const DIGIT_WORDS = Object.fromEntries(
    [...TRIGGER.matchAll(/'\(\?<!\[a-z\]\)(\w+)\(\?!\[a-z\]\)', '(\d)'/g)].map((m) => [
      m[1],
      m[2],
    ]),
  )
  const cashRe = new RegExp(CASH_SOURCE.replace(/\\y/g, '\\b'), 'i')
  const hinglishRe = new RegExp(HINGLISH_SOURCE.replace(/\\y/g, '\\b'), 'i')

  /* Whether each copy applies its normaliser to a given vocabulary. This is the
     pair of predicates behind the cross-copy invariant below: the danger is not
     "the SQL forgot" or "the TS forgot", it is the two drifting apart, and a
     per-copy assertion cannot see that. */
  const tsSquished = (name: string): boolean => ts.includes(`${name}.test(squished)`)
  const sqlSquished = (marker: string): boolean =>
    TRIGGER.split('\n').some((l) => l.includes('v_squished ~*') && l.includes(marker))

  /** `squishEvasion()`, driven by the pattern the SQL actually ships. */
  function squish(text: string): string {
    const collapsed = `[${text}]`.replace(new RegExp(SQUISH_SOURCE, 'g'), '')
    const from = LEET?.[1] ?? ''
    const to = LEET?.[2] ?? ''
    return collapsed.slice(1, -1).replace(/[@$01]/g, (ch) => to[from.indexOf(ch)] ?? ch)
  }

  /** `digitsFromWords()`, driven by the word list the SQL actually ships. */
  function digitsFromWords(text: string): string {
    const words = Object.keys(DIGIT_WORDS)
    let v = text.toLowerCase()
    for (const [word, digit] of Object.entries(DIGIT_WORDS)) {
      v = v.replace(new RegExp(`(?<![a-z])${word}(?![a-z])`, 'g'), digit)
    }
    v = v.replace(/[^0-9]/g, '')
    return new RegExp(`(^|[^a-z])(${words.join('|')})([^a-z]|$)`, 'i').test(text) ? v : ''
  }

  it('finds both normalisers in the guard, not just the raw-text patterns', () => {
    /* These sanity assertions matter: everything below extracts a pattern out
       of the guard body, and an extraction that silently returns '' would make
       the behavioural tests pass vacuously. That is the trap this file's
       TRIGGER slice was created to avoid. */
    expect(CASH_SOURCE, 'the money pattern must be found').toContain('sell')
    expect(SQUISH_SOURCE, 'the collapse pattern must be found').toContain(
      '(?<=[^A-Za-z][A-Za-z])',
    )
    expect(LEET?.[1], 'the leet alphabet must be found').toBe('@$01')
    expect(Object.keys(DIGIT_WORDS).length, 'all ten digit words must be found').toBe(10)
    /* The point of the migration: the guard must TEST the normalised forms, not
       merely be able to compute them. Computing them and matching only the raw
       text is exactly the bug. */
    expect(TRIGGER, 'the reconstructed digits must be tested').toMatch(/v_digits\s*~/)
    expect(TRIGGER, 'the squished text must be tested').toMatch(/v_squished\s*~\*/)
    /* Two pieces of the port the JS re-implementation below CANNOT check,
       because it reproduces them itself: the sentinel that makes start and end
       of string behave like an ordinary non-letter, and the pure-run guard from
       docs/09. Dropping either from the SQL would leave every behavioural test
       here green, so they are asserted against the shipped text directly. */
    expect(TRIGGER, 'the sentinel must ship').toContain("'[' || NEW.text || ']'")
    expect(TRIGGER, 'the pure-run guard must ship (docs/09)').toContain(
      "IF NEW.text !~* '(^|[^a-z])(zero|one|",
    )
  })

  it('collapses spaced-out letters and leet the way the TS guard does', () => {
    for (const text of ['s-e-l-l it to me', 'c-a-s-h', 'U P I par', 'g p a y kar do']) {
      expect(cashRe.test(squish(text)), `${text} must survive squishing as a money word`).toBe(
        true,
      )
    }
    expect(cashRe.test(squish('se1l it to me')), 'leet 1 -> l must decode').toBe(true)
  })

  it('collapses only runs of single letters, leaving ordinary chat as written', () => {
    /* Exact output, not "no keyword appeared". The naive version of this
       collapse — strip every separator that sits between two letters — turns
       `Meet me near` into `Meetmenear`, and a keyword-absence assertion would
       not notice, because none of these sentences contains a money word either
       way. Asserting the string is what makes the difference visible. */
    expect(squish('s-e-l-l')).toBe('sell')
    expect(squish('U P I')).toBe('UPI')
    expect(squish('se1l')).toBe('sell')
    for (const text of ['Meet me near', 'Is Ella coming', 'Basic Ash', 'see the seller']) {
      expect(squish(text), `${text} must come out as written`).toBe(text)
    }
  })

  it('rebuilds a spelled-out number, and only when a digit word is present', () => {
    expect(digitsFromWords('call nine eight 200 12345')).toBe('9820012345')
    expect(digitsFromWords('nine eight two zero zero one two three four five')).toBe('9820012345')
    /* The pure-run rule (docs/09): with no digit word present, joining every
       number in a sentence would turn a train number plus a berth into a
       phantom phone number. */
    expect(digitsFromWords('Train 12951 on 2026-12-01, berth 41')).toBe('')
  })

  it('aligns the UPI shape with the TS guard', () => {
    /* The only place this fix made the database guard LESS strict, and it is
       deliberate: `pay a@okaxis` was flagged here and not on the device, and
       the TS shape is the reviewed spec. */
    expect(TRIGGER, 'the UPI shape must match the TS {2,}').toMatch(
      /\[a-z0-9\._-\]\{2,\}@\[a-z\]\{2,\}/,
    )
    expect(TRIGGER, 'the one-character-local-part shape must be gone').not.toMatch(
      /\[a-z0-9\._-\]\+@\[a-z\]\+/,
    )
  })

  it('squishes the Hinglish list too, in BOTH copies', () => {
    /* Migration #8 / backlog 17. The normalisers existed and worked; they were
       wired to the English list only, in BOTH copies, so `b h e j` came out
       clean on both sides and the differential reported it as *agreement*.
       Nine cases, measured. Asserted per copy on purpose: "both raw-only" is
       also internally consistent, so the cross-copy invariant below cannot tell
       agreeing-correctly apart from agreeing-on-the-wrong-answer. */
    expect(tsSquished('HINGLISH_WORDS'), 'the TS guard must squish the Hinglish list').toBe(true)
    expect(sqlSquished('(khareed|'), 'the SQL guard must squish the Hinglish list').toBe(true)
  })

  it('applies the normalisers to the same vocabularies in both copies', () => {
    /* The drift class rather than the instance: whichever list is squished on
       one side must be squished on the other. HINDI is currently raw-only in
       both, which is a recorded decision and not an oversight — the squisher is
       ASCII-only, so it cannot reach spaced Devanagari (see the HINDI_WORDS
       comment in chat-guard.ts). That is acceptable precisely BECAUSE it is the
       same on both sides. Change one and this fails until you change the other,
       which is the point: the original defect was an asymmetry, not a gap. */
    expect(sqlSquished('(cash|upi'), 'CASH must be squished on both sides').toBe(
      tsSquished('CASH_WORDS'),
    )
    expect(sqlSquished('(khareed|'), 'HINGLISH must be squished on both sides').toBe(
      tsSquished('HINGLISH_WORDS'),
    )
    expect(sqlSquished('नकद'), 'HINDI must be squished on both sides').toBe(
      tsSquished('HINDI_WORDS'),
    )
  })

  it('catches an evaded Hinglish word through the shipped pattern', () => {
    /* Driven by the SQL's own squisher and the SQL's own Hinglish alternation,
       so a rewrite is re-evaluated rather than matched. The raw assertion is
       what makes this a test of the FIX rather than of the word list: these
       strings do not match raw, which is exactly why the evasion worked. */
    for (const text of [
      'b h e j it to me',
      'p a i s e de do',
      'n a k a d de do',
      'b-h-e-j it to me',
    ]) {
      expect(hinglishRe.test(text), `"${text}" must NOT match raw — that is the evasion`).toBe(
        false,
      )
      expect(hinglishRe.test(squish(text)), `"${text}" must match once squished`).toBe(true)
    }
    expect(hinglishRe.test(squish('p@ise de do')), 'leet must decode into a Hinglish match').toBe(
      true,
    )
  })

  it('does not manufacture a Hinglish match out of ordinary chat', () => {
    /* The mirror-image risk of widening the match. These are ordinary sentences
       that contain spaced single letters, and they must stay clean — otherwise
       the fix trades a missed warning for a false one. */
    for (const text of ['Meet me near the b h board', 'I will be there', 'phone me later']) {
      expect(hinglishRe.test(squish(text)), `"${text}" must stay clean`).toBe(false)
    }
  })
})
