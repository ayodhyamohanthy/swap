/* Copy + wiring guard for the admin activity log (design 15).
 *
 * Two defects lived here, both filed on the lane board and both the same class:
 * copy/values that describe something the code cannot do.
 *
 * 1. `admin.searchPh` read "Search action, user or train". There is no way to
 *    search a user: `filterActivity` matches the actor id (an opaque account id,
 *    never a name), the action name, the entity and all of `meta` — which
 *    carries `train_no` and the masked PNR tail. A full 10-digit PNR is not
 *    stored anywhere, so only the tail is searchable. The placeholder is also
 *    the field's *label*, so one wrong string misled for the whole control.
 *
 * 2. The row rendered `actor_role` raw, so an operator's row said `admin` and a
 *    scheduled job's row said `support` — English enum values in the audit log,
 *    which is what the screen exists to make readable.
 *
 * The second one cannot be caught by asserting the helper alone: the bug *was*
 * reading the row field directly, so the screen's own source is pinned too.
 * Both halves are mutation-checked (see the commit message).
 */

const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import { SHIPPED_LANGS, actorRoleLabel, translate } from '@/lib/i18n'

const SCREEN = readFileSync(join(import.meta.dirname, '..', 'src', 'routes', 'admin.activity.tsx'), 'utf8')

/** The roles `activity_log` actually writes — `store.ts` (user), `server/admin.ts`
    (admin) and `server/jobs.ts` (support). */
const STAFF_ROLES = ['admin', 'support'] as const

describe('admin activity search (design 15)', () => {
  it('names only what the haystack can reach, in every shipped language', () => {
    for (const lang of SHIPPED_LANGS) {
      const copy = translate(lang, 'admin.searchPh')
      expect(copy, `${lang} still promises a name search`).not.toMatch(/\buser\b|उपयोगकर्ता/i)
      expect(copy, `${lang} does not name the train`).toMatch(/train|ट्रेन/i)
    }
  })

  it('is the string the screen actually renders', () => {
    /* The label and the placeholder share the key, so this one assertion covers
       both places the old wording appeared. */
    expect(SCREEN).toContain("t('admin.searchPh')")
  })
})

describe('activity log staff roles', () => {
  it('translates every role the log writes, in every shipped language', () => {
    for (const lang of SHIPPED_LANGS) {
      for (const role of STAFF_ROLES) {
        const label = actorRoleLabel(lang, role)
        expect(label.trim(), `${lang}.${role} is blank`).not.toBe('')
        expect(label, `${lang}.${role} is still the raw enum value`).not.toBe(role)
      }
    }
  })

  it('never leaves a row unlabelled when the role is unknown', () => {
    /* An unrecognised role falls back to its raw token, never to "". An audit
       trail must not hide the fact that something happened. */
    expect(actorRoleLabel('en', 'someone-new')).toBe('someone-new')
    expect(actorRoleLabel('hi', 'someone-new')).toBe('someone-new')
  })

  it('renders through the helper, not the raw field', () => {
    const line = SCREEN.split('\n').find((l) => l.includes('staffRole ='))
    expect(line, 'the screen no longer derives a staff role').toBeDefined()
    /* Mutating this line back to `row.actor_role` is what the defect was. */
    expect(line).toContain('actorRoleLabel(')
    /* The common case stays quiet: a passenger's own row says nothing. */
    expect(line).toContain("'user'")
  })
})

/* The same argument, one layer out, for design 15's *columns*.
 *
 * `admin.test.ts` already pins the helpers hard — `activityTrain` reads the
 * number, it is null with no train, it is bounded like the Details list, and
 * `omit: ['train_no']` drops it cleanly with no dangling separator. All of that
 * can be true while the screen ignores it, and every mutation below still
 * typechecks, so neither `tsc` nor the helper tests catch them:
 *
 *   - drop `omit`, and one row prints "12951" twice, in two columns, which reads
 *     as two facts about a train that has one number;
 *   - fold `admin.colTrain` back into the Action heading, and the column the
 *     design separates silently becomes a token again;
 *   - delete the train cell and leave it only in Details, and the header
 *     advertises a column no row fills;
 *   - hardcode one icon for every row, and the icon stops predicting the chip
 *     that filters the same taxonomy.
 *
 * This block is the only guard on the screen's own structure, and it exists
 * because of what it cost to be without one: `f65f8aa` built the Train column
 * and icon per category, and the comment block above the table went on
 * describing a screen with no Train column at all — until it was found still
 * quoted as open work on the lane board. Two artefacts said the feature was
 * missing and nothing disagreed with them, because nothing could look.
 */
describe('design 15 table columns', () => {
  it('gives Train a header track of its own, outside the Action heading', () => {
    /* The ruler is the only place the column names appear, so the heading is
       what tells an operator the column exists. */
    expect(SCREEN).toMatch(/<span className="lg:col-start-4">\{t\('admin\.colTrain'\)\}<\/span>/)

    /* And it must not be absorbed into Action's span. `lg:col-span-2
       lg:col-start-2` is columns 2–3 — icon and label. If the design's four
       drawn columns ever collapse back to three, this is the line that says so. */
    const actionHeading = SCREEN
      .split('\n')
      .find((l) => l.includes("t('admin.colAction')") && l.includes('lg:col-start-2'))
    expect(actionHeading, 'the Action heading is no longer a spanning track').toBeDefined()
    expect(actionHeading).toContain('lg:col-span-2')
    expect(actionHeading).not.toContain('colTrain')
  })

  it('fills that track per row, rather than only listing the train in Details', () => {
    /* The row cell, in the track the heading advertises. Guarding both halves
       matters: a header with no cell is a column that lies. */
    expect(SCREEN).toMatch(/lg:col-start-4[^"']*">\{train\}</)
    expect(SCREEN).toContain('const train = activityTrain(row)')
  })

  it('drops the train from the Details tokens, so a row prints it once', () => {
    const line = SCREEN.split('\n').find((l) => l.includes('const detail ='))
    expect(line, 'the screen no longer computes its Details tokens').toBeDefined()
    /* Removing the omit is the mutation: the number returns to Details and the
       row carries it twice. */
    expect(line).toContain("omit: ['train_no']")
  })

  it('derives icon from the category and colour from the tone, per row', () => {
    /* Both are looked up from the action on every row, so a newly logged action
       is drawn correctly without editing this screen. A literal glyph or a
       per-category colour would both still typecheck. */
    expect(SCREEN).toContain('CATEGORY_ICON[activityCategory(row.action)]')
    expect(SCREEN).toContain('activityTone(row.action)')
    expect(SCREEN).toContain('ACTIVITY_TONE_CLASS[tone]')
  })

  it('keeps the phone layout one DOM with the table, not a second markup', () => {
    /* Two markups would be two places for the same values to drift — which is
       how a desktop column and a phone card can disagree about a row. The
       screen reaches `lg` by re-placing its own children, not by branching. */
    expect(SCREEN).not.toMatch(/<table[\s>]/)
    expect(SCREEN).toContain('lg:contents')
  })
})

/* This screen shipped a raw NUL byte inside a string literal:
 *
 *     <li key={group.actorId ?? '<NUL>automation'}>
 *
 * The intent was sound — the automation group has `actor_id === null`, so its
 * React key needs a value that cannot collide with a real account id, and a
 * NUL-prefixed sentinel is exactly that. It was written as a raw byte instead
 * of the two-character `\0` escape, and the string value is byte-identical
 * either way, so every gate stayed green: `tsc` accepted it, Vite bundled it,
 * 1062 tests passed, and the panel rendered correctly on screen.
 *
 * The cost was invisible to all of them and immediate to every text tool. One
 * NUL makes `file` report `data` and makes ripgrep and `grep` print only
 * "Binary file matches" — no lines, no match context, no way to know which line
 * matched. This whole file, 392 lines of the busiest admin screen, was
 * unsearchable: an agent looking for `activityDetails`, or for the column it was
 * about to change, got nothing back and no signal that anything was wrong.
 *
 * So the guard is not "the escape is spelled a particular way" — it is that no
 * committed source file carries a raw control byte at all. The second test
 * sweeps every lane's source rather than only this file, because the property
 * that broke was never local: one byte anywhere in the repo makes that one
 * file unreadable to the tools the protocol depends on.
 */
describe('no raw control bytes in committed source', () => {
  /** NUL and the C0 range that has no business in a source file. Tab (0x09),
      LF (0x0a) and CR (0x0d) are the only ones allowed. */
  const RAW_CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/

  it('keeps the activity screen greppable', () => {
    const bad = [...SCREEN].findIndex((ch) => RAW_CONTROL.test(ch))
    expect(
      bad,
      'a raw control byte makes grep skip this file entirely ("Binary file matches")',
    ).toBe(-1)
  })

  it('writes the automation sentinel as an escape, not a byte', () => {
    /* Same string value either way — so this is pinned as documentation of
       intent, and the assertion above is the one that would ever fail. */
    expect(SCREEN).toContain("'\\0automation'")
  })

  it('finds none anywhere in app/src or app/tests', () => {
    const roots = ['src', 'tests'].map((dir) => join(import.meta.dirname, '..', dir))
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '.tanstack') walk(full)
        } else if (/\.(ts|tsx|mts|mjs|js|json)$/.test(entry.name)) {
          const text = readFileSync(full, 'utf8')
          if (RAW_CONTROL.test(text)) offenders.push(full.slice(full.indexOf('/app/') + 1))
        }
      }
    }
    for (const root of roots) walk(root)
    expect(offenders, 'these files are invisible to grep').toEqual([])
  })
})
