/* A view called `match_cards` has to be safe by default.
 *
 * `match_cards` is what every matcher on the platform reads, and rule 13 says a
 * traveller may see another user's first name + initial, class, coach and berth
 * type — and nothing else. So each of its columns has to earn its place, and the
 * test is the list of what it must never carry.
 *
 * This exists because of a single column. `passengers.label` is free text
 * (defaulting to 'Passenger 1', and writable by whoever inserts the row), it was
 * in the view, and nothing read it — no `CandidateSpec` field, no query. A
 * passenger who typed a real name or a phone number into their own label would
 * have published it to every signed-in user on the train. The column list is
 * the only place that class of mistake is visible, so it is the thing asserted
 * here, rather than a check that some *other* file happens to avoid selecting
 * it — which is the property that was true while the column was still exposed.
 */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const SCHEMA_PATH = join(import.meta.dirname, '..', 'supabase', 'schema.sql')
const schema = readFileSync(SCHEMA_PATH, 'utf8')

/** The view body, up to its FROM. */
function viewBody(name: string): string {
  const start = schema.indexOf(`CREATE OR REPLACE VIEW public.${name}`)
  expect(start, `view public.${name} is missing from schema.sql`).toBeGreaterThan(-1)
  const from = schema.indexOf('FROM public.', start)
  return schema.slice(start, from)
}

describe('match_cards is safe by default, not by its readers remembering', () => {
  it('carries no free-text column from passengers', () => {
    /* `label` is the one that got in. The general form of the check is the
       point: any `p.<column>` here is a column every matcher can read, so the
       list below is the allow-list and anything else has to be argued for. */
    const body = viewBody('match_cards')
    const passengerColumns = [...body.matchAll(/\bp\.(\w+)/g)].map((m) => m[1])
    expect(passengerColumns.length, 'the view reads no passenger column — the regex is broken').toBeGreaterThan(3)
    expect(
      passengerColumns,
      'match_cards must expose only the fields rule 13 permits: coach, berth type, '
        + 'status and quota. A free-text column here is published to every matcher.',
    ).toEqual(['id', 'coach', 'berth_type', 'status', 'quota'])
  })

  it('carries no raw PNR, berth number, phone or email from any table', () => {
    const body = viewBody('match_cards')
    for (const column of ['pnr_hash', 'pnr_last4', 'berth_no', 'phone', 'email', 'full_name']) {
      expect(body, `match_cards must not expose ${column}`).not.toMatch(new RegExp(`\\.${column}\\b`))
    }
  })

  it('reads only the three tables it needs, and no fourth', () => {
    /* booking_id / train / class come from `b`, the passenger's berth facts
       from `p`, identity from `pr`. A fourth alias means a column was added to
       the SELECT without this list being re-read, which is how `p.label` got
       in. Matched on the alias as a whole (`\b(?:b|p|pr|…)\.`) rather than one
       character, because a one-character pattern silently misses `pr` — which
       is the failure that made this test report two aliases when the view has
       three. */
    const body = viewBody('match_cards')
    const aliases = [...new Set([...body.matchAll(/\b([a-z]{1,2})\.(\w+)/g)].map((m) => m[1]))]
    expect(
      aliases.sort(),
      'match_cards must join only bookings (b), passengers (p) and profiles (pr). '
        + 'A new table means a new set of columns, each of which every matcher can read.',
    ).toEqual(['b', 'p', 'pr'])
  })

  it('keeps the profile columns to first name and initial, nothing else', () => {
    const body = viewBody('match_cards')
    const profileColumns = [...body.matchAll(/\bpr\.(\w+)/g)].map((m) => m[1])
    expect(profileColumns).toEqual(['first_name', 'last_initial'])
  })
})
