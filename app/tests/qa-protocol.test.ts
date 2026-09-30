/* QA gate — the commands the protocol files hand to agents must actually run.
 *
 * `agents.md`, `docs/11-COLLAB.md` and `docs/13-COLLAB-CONTRACT.md` tell every
 * agent, before touching anything, to list the files another agent is writing
 * right now:
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
 * Restructured 2026-09-30: CLAUDE.md / GEMINI.md / PROMPTS.md are one-line
 * pointers at agents.md by design (agents.md header says so), so they no
 * longer carry the command themselves — the chain is pointer → agents.md →
 * command, and this guard pins every link of it instead of counting copies.
 * What it pins: each direct carrier uses the portable `-mmin` form, and
 * `agents.md` carries it at all — so the guard cannot pass by finding
 * nothing to check.
 */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')

/** Files that carry the hot-file check directly. */
const DIRECT_CARRIERS = [
  'agents.md',
  'docs/11-COLLAB.md',
  'docs/13-COLLAB-CONTRACT.md',
] as const

/** One-line pointers: they carry no command themselves, but each must point
    at agents.md, or the chain to the command is broken. */
const POINTER_FILES = ['CLAUDE.md', 'GEMINI.md', 'PROMPTS.md'] as const

/** Enough of the command to recognise it without pinning its surrounding prose. */
const HOT_CHECK = 'find app/src app/tests app/locales'

function read(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8')
}

describe('protocol files (the commands agents actually run)', () => {
  it('spells the hot-file check the way BSD find can parse it', () => {
    /* Non-vacuous: every direct carrier is asserted by NAME below, so there
       is no count that could pass on an empty list — the failure mode this
       guard is about is a check that reports success because it checked
       nothing. */
    expect(DIRECT_CARRIERS.length).toBeGreaterThanOrEqual(3)

    for (const file of DIRECT_CARRIERS) {
      const lines = read(file)
        .split('\n')
        .filter((line) => line.includes(HOT_CHECK))
      expect(lines.length, `${file} must carry the hot-file check`).toBeGreaterThanOrEqual(1)
      for (const line of lines) {
        expect(line, `${file} uses GNU-only -newermt, which macOS find rejects`).not.toMatch(
          /-newermt/,
        )
        expect(line, `${file} must use the portable -mmin form`).toMatch(/-mmin -15/)
      }
    }
  })

  it('keeps the pointer files pointed at agents.md', () => {
    /* The restructure made these one-liners. If one stops naming agents.md,
       its readers never reach the command above. */
    for (const file of POINTER_FILES) {
      expect(read(file), `${file} must point at agents.md`).toContain('AGENTS.md')
    }
  })

  it('keeps it in agents.md, which every agent is told to read first', () => {
    /* Named explicitly: the first pass fixed five files and missed this one,
       and the per-file loop above would not single it out if it went missing
       from here while staying elsewhere. */
    const agents = read('agents.md')
    expect(agents).toContain(HOT_CHECK)
    expect(agents).toMatch(/-mmin -15/)
  })
})
