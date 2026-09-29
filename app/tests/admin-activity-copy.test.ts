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

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
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
