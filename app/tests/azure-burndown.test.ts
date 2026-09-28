/* Azure burn-down eval: translator-lib helpers + guard proposal.
 * Never touches app/locales/ or src/lib/chat-guard.ts. */
/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'
// @ts-expect-error translator-lib is an untyped .mjs helper (tests only)
import { flatLeaves, placeholdersOf, scanDraft } from '../azure/translator-lib.mjs'
import { candidateGuardExtra } from '../azure/guard-proposal'
import en from '../locales/en.json'

describe('azure translator draft pipeline', () => {
  it('flattens en without losing keys', () => {
    const leaves = flatLeaves(en as Record<string, unknown>)
    expect(Object.keys(leaves).length).toBeGreaterThan(600)
  })
  it('keeps {placeholders} intact', () => {
    expect(placeholdersOf('Pay {amount} to {name}')).toEqual(['{amount}', '{name}'])
  })
  it('flags banned words in drafts', () => {
    const { banned } = scanDraft({ a: 'show your pass please', 'footer.line2': 'SeatSwap is not an official railway service.' })
    expect(banned.length).toBe(1)
  })
})

describe('azure guard proposal (eval only)', () => {
  it('catches the h04 Hinglish FN', () => {
    expect(candidateGuardExtra('meri seat khareed lo')).toContain('khareed')
  })
  it('stays quiet on clean chat', () => {
    expect(candidateGuardExtra("I'm at my berth now")).toEqual([])
  })
})

/* get_matches() is parked as a proposal, so its two documents — the SQL and the
   contract note — ARE its spec. Drift between them is how a caller ends up
   relying on something the function does not do, so pin them together. */
describe('get_matches proposal: the note and the SQL agree', () => {
  const LOAD = join(import.meta.dirname, '..', 'azure', 'load')
  const sql = readFileSync(join(LOAD, 'get-matches.spec-part2.sql'), 'utf8')
  const note = readFileSync(join(LOAD, 'rpc-contract-note.ts'), 'utf8')

  it('clamps p_limit to the same ceiling the note states', () => {
    const clamp = sql.match(/LEAST\(GREATEST\(p_limit, (\d+)\), (\d+)\)/)
    expect(clamp).not.toBeNull()
    expect(clamp?.[1]).toBe('1')
    expect(clamp?.[2]).toBe('50')
    expect(note).toMatch(/clamped to 1\.\.50/)
  })

  it('declares the signature the note documents', () => {
    for (const param of [
      'p_train text',
      'p_date date',
      'p_class travel_class',
      'p_after uuid',
      'p_limit int',
    ]) {
      expect(sql).toContain(param)
      expect(note).toContain(param)
    }
  })

  it('keeps p_after a uuid, because it is compared against booking_id', () => {
    /* It was timestamptz once. `uuid < timestamptz` has no operator, and
       LANGUAGE sql bodies are validated at CREATE, so the migration would have
       failed outright rather than misbehaving at runtime. */
    expect(sql).toMatch(/p_after IS NULL OR booking_id < p_after/)
    expect(sql).not.toMatch(/p_after\s+timestamptz/)
  })

  it('narrows only — it is not a second copy of rankMatches', () => {
    /* docs/08 puts scoring and the filters in the app. If someone moves them in
       here, the two implementations of the same rules start to disagree. */
    for (const keptInApp of ['segmentsOverlap', 'max_requests_per_day', 'women_only']) {
      expect(sql).not.toContain(keptInApp)
    }
    expect(sql).toContain('train_no = p_train')
    expect(sql).toContain('journey_date = p_date')
  })
})
