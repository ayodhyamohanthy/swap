/* QA gate — the commands the protocol files hand to agents must actually run.
 *
 * `agents.md` §0 step 1, `CLAUDE.md`, `GEMINI.md`, `PROMPTS.md`,
 * `docs/11-COLLAB.md` and `docs/13-COLLAB-CONTRACT.md` all tell every agent,
 * before touching anything, to list the files another agent is writing right
 * now:
 *
 *   find app/src app/tests app/locales -mmin -15 -type f
 *
 * That one command was copy-pasted into six files as `-newermt '-15 min'`,
 * which is GNU syntax. On macOS BSD `find` it prints `find: bad date -15 min`
 * and exits 1, so the collision guard the whole protocol rests on listed
 * *nothing*, on every run, for every agent — and an empty list reads exactly
 * like "no other agent is working". Five of the six were corrected; `agents.md`
 * (the file §0 tells you to read first) kept the broken form, which is why this
 * is a test rather than another note in a doc.
 *
 * What it pins: a protocol file that carries the hot-file command must use the
 * portable `-mmin` form, and `agents.md` must carry it at all — so the guard
 * cannot pass by finding nothing to check.
 */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')

/** The files that carry, or are supposed to carry, the hot-file check. */
const PROTOCOL_FILES = [
  'agents.md',
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

  it('keeps it in agents.md, which every agent is told to read first', () => {
    /* Named explicitly: the first pass fixed five files and missed this one, so
       the count above would not have caught it disappearing from here. */
    const agents = read('agents.md')
    expect(agents).toContain(HOT_CHECK)
    expect(agents).toMatch(/-mmin -15/)
  })
})
