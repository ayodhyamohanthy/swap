/* QA gate — the commands the protocol files hand to agents must actually run.
 *
 * Two easy-to-miss failures are guarded here: the hot-file command must use the
 * portable `-mmin` form (BSD `find` rejects GNU-only `-newermt`), and the root
 * instructions must be stored under the exact `AGENTS.md` spelling referenced
 * by the platform guides. Case-insensitive lookup on macOS can hide a lowercase
 * filename, so the directory entry itself is checked.
 */

const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')

/** The files that carry, or are supposed to carry, the hot-file check. */
const PROTOCOL_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'PROMPTS.md',
  'docs/11-COLLAB.md',
  'docs/13-COLLAB-CONTRACT.md',
] as const

/** Enough of the command to recognise it without pinning its surrounding prose. */
const HOT_CHECK = 'find app/src app/tests app/locales'

function read(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8')
}

describe('protocol files (the commands agents actually run)', () => {
  it('stores the canonical instructions under the case-sensitive AGENTS.md path', () => {
    const entries = readdirSync(REPO)
    expect(entries).toContain('AGENTS.md')
    expect(entries).not.toContain('agents.md')
  })

  it('spells the hot-file check the way BSD find can parse it', () => {
    const carrying = PROTOCOL_FILES.filter((file) => read(file).includes(HOT_CHECK))
    /* Non-vacuous. If every file stopped carrying the command the loop below
       would pass on an empty list, which is the failure mode this guard is
       about — a check that reports success because it checked nothing. */
    expect(carrying.length, 'no protocol file carries the hot-file check').toBeGreaterThanOrEqual(5)

    for (const file of carrying) {
      const lines = read(file)
        .split('\n')
        .filter((line) => line.includes(HOT_CHECK))
      for (const line of lines) {
        expect(line, `${file} uses GNU-only -newermt, which macOS find rejects`).not.toMatch(
          /-newermt/,
        )
        expect(line, `${file} must use the portable -mmin form`).toMatch(/-mmin -15/)
      }
    }
  })

  it('keeps the hot-file check in AGENTS.md, which every agent is told to read first', () => {
    /* Check this separately so losing the command from the canonical entrypoint
       cannot go unnoticed even if the broader non-vacuous count still passes. */
    const agents = read('AGENTS.md')
    expect(agents).toContain(HOT_CHECK)
    expect(agents).toMatch(/-mmin -15/)
  })
})
