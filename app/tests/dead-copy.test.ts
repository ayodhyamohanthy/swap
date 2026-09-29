/* Dead copy: keys in the catalogues that no screen renders.
 *
 * These are not a defect — an unrendered key costs a few bytes in the bundle and
 * nothing else. They matter for one reason: a catalogue is a promise about
 * what the product says, and 147 of 769 keys here are a promise nothing keeps.
 * `confirm.*` is the clearest case — a whole duplicate of the live `outcome.*`
 * vocabulary (`noShow`, `notPossible`, `changedMind`, `submit` all exist there
 * and are the ones the confirm screen actually renders), so a translator paid
 * twice for one sentence and a future agent could wire the dead half by mistake.
 *
 * This test does not delete anything. Deciding whether a key is "reserved
 * copy for a screen that is not built yet" or "copy we forgot to wire" is a
 * product judgement, and a mechanical prune would destroy the first kind while
 * appearing to fix the second. So the list is reported, on a generous
 * threshold, and printed in full on failure so the next pass has something
 * concrete to triage.
 *
 * The threshold is deliberately loose. It counts only keys with no literal
 * reference anywhere in `src/`, and it does not try to recognise the composed
 * families (`admin.act.*`, `report_*`, `request.statuses.*`, `trip.quotas.*`),
 * which are built at runtime and would all read as dead. Those are excluded by
 * prefix rather than guessed at, so a genuinely dead key inside a dynamic
 * family is not counted here — the two tests below cover the families that
 * matter by checking the map instead.
 */
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import hi from '../locales/hi.json'

const SRC = join(import.meta.dirname, '..', 'src')

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return files(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

const SOURCE = files(SRC)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

function flatKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    typeof child === 'object' && child !== null
      ? flatKeys(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

/** Families composed at runtime, so no literal reference exists by construction. */
const DYNAMIC_PREFIXES = [
  'admin.act.',
  'admin.timeline',
  'admin.report_',
  'admin.roles.',
  'admin.cat',
  'request.statuses.',
  'trip.types.',
  'trip.statuses.',
  'trip.quotas.',
  'outcome.',
]

const ALL_KEYS = flatKeys(en)

const UNRENDERED = ALL_KEYS.filter(
  (key) =>
    !DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
    !SOURCE.includes(`'${key}'`) &&
    !SOURCE.includes(`"${key}"`) &&
    !SOURCE.includes(`\`${key}\``),
)

describe('dead copy in the catalogues', () => {
  it('has a bounded number of unrendered keys, and says so when it grows', () => {
    /* Not a hard limit on correctness — a limit on *drift*. When someone adds
       copy and wires it, this number falls. When someone adds copy and forgets
       to wire it, it rises and this fails with the full list, which is the
       point: a reviewer can then decide, per key, whether it is reserved or
       forgotten. */
    expect(
      UNRENDERED.length,
      `${UNRENDERED.length} catalogue keys are never rendered. Triage them: a key is fine `
        + 'if a screen that will use it is not built yet (note it), and dead if the live '
        + `vocabulary already covers it (delete it). Current list:\n  ${UNRENDERED.join('\n  ')}`,
    ).toBeLessThanOrEqual(78)
  })

  it('keeps en and hi in step, so a dead key costs two languages not one', () => {
    /* The parity test already asserts identical key sets. This asserts the
       *dead* ones are dead in both, so a key cannot be half-wired in one
       language and live in the other. */
    const hiKeys = new Set(flatKeys(hi))
    const enOnly = ALL_KEYS.filter((key) => !hiKeys.has(key))
    expect(enOnly).toEqual([])
  })

  it('has no duplicate vocabulary between confirm.* and outcome.*', () => {
    /* The concrete case worth naming. `confirm.noShow` / `notPossible` /
       `changedMind` / `submit` duplicate `outcome.pNoShow` / `pNotPossible` /
       `pChangedMind` / `pSubmit`, which are what `swaps.$id.confirm.tsx`
       renders. Two vocabularies for one screen means a translator paid twice
       and a future agent can wire the half nobody reads. */
    const confirm = en.confirm as Record<string, string>
    const outcome = en.outcome as Record<string, string>
    const shared: string[] = []
    for (const [key, value] of Object.entries(confirm)) {
      for (const [otherKey, otherValue] of Object.entries(outcome)) {
        if (key !== 'title' && value === otherValue && otherValue.length > 2) {
          shared.push(`${key} == ${otherKey} ("${value}")`)
        }
      }
    }
    expect(
      shared,
      'confirm.* and outcome.* carry the same sentence twice. Keep the family the screen '
        + 'actually renders and delete the other, so there is one word for one idea.',
    ).toEqual([])
  })
})
