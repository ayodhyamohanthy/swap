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
 *
 * The restructure left its own bug behind, found 2026-10-01: `docs/AGENTS.md`
 * was still a second full copy of the instructions (`git show HEAD:docs/AGENTS.md`
 * — 2686 bytes over 53 lines, carrying no hot-file check at all). It had drifted,
 * and its line 3 asserted "This is the ONLY instruction file" while it *was* the
 * duplicate. Two separate misses, both fixed below, and both measured rather
 * than reasoned:
 *   - the pointer list was written out by hand, so it could not see
 *     `docs/AGENTS.md` or `.cursorrules`. That list is a fair reading of
 *     agents.md's own header, which names three files and then says "and all
 *     others" — an enumeration can only check what it names, so the population
 *     is discovered here instead.
 *   - the predicate was `toContain('AGENTS.md')`, and the stale copy's first
 *     line reads `# AGENTS.md — Single Source of Truth`. The one file this test
 *     existed to catch passed it, which the mutation run confirms against the
 *     real bytes rather than by argument. The check is a shape now: one line,
 *     and that line names agents.md.
 */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { basename, join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')

/** Files that carry the hot-file check directly. */
const DIRECT_CARRIERS = [
  'agents.md',
  'docs/11-COLLAB.md',
  'docs/13-COLLAB-CONTRACT.md',
] as const

/** Instruction filenames agents may be handed, matched on the basename. */
const INSTRUCTION_NAMES = new Set([
  'agents.md',
  'claude.md',
  'gemini.md',
  'prompts.md',
  '.cursorrules',
])

/** The single source of truth the rest of them point at. */
const SSOT = 'agents.md'

/** Vendored snapshots of the pre-pointer instruction file. Rewriting an archive
    that was cut against an earlier repo's docs/01…docs/10 to point here would
    destroy what it records rather than update a config, so they stay long-form
    and out of the pointer population — the same reasoning docs/12 §4.1:154
    applies to `lovable build/**` for the domain ledger. */
const ARCHIVES = ['lovable build/']

/** Discover the pointer population instead of naming it.
 *
 *  Tracked-only is the right universe, not a convenience: the same names appear
 *  15 times on disk here — 6 under `node_modules/**` and `swap/agents.md` from
 *  the gitignored embedded prototype repo, which is legitimately long-form — so
 *  a disk walk needs a skip entry per surprise, and every skip is a way for a
 *  real stale copy to hide. `git ls-files` returns what an agent actually checks
 *  out. */
function trackedInstructionFiles(): string[] {
  const { spawnSync } = process.getBuiltinModule(
    'node:child_process',
  ) as typeof import('node:child_process')
  const git = spawnSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
  /* `?? ''` rather than a status check: stdout is null when git could not be
     spawned at all, and an empty population is what the count assertion below
     fails on — a TypeError here would abort the file instead. */
  return (git.stdout ?? '')
    .split('\n')
    .filter((file) => file !== '')
    .filter((file) => INSTRUCTION_NAMES.has(basename(file).toLowerCase()))
    .filter((file) => !ARCHIVES.some((dir) => file.startsWith(dir)))
}

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

  it('keeps every pointer file a pointer at agents.md', () => {
    /* One line, and that line names agents.md — the restructure made these
       pointers, so anything longer is a second copy of the instructions
       drifting on its own, and a copy whose title mentions agents.md is what
       the old `toContain` check let through. */
    const pointers = trackedInstructionFiles().filter((file) => file !== SSOT)

    /* Non-vacuous: 5 is what the restructure actually left (.cursorrules,
       CLAUDE.md, GEMINI.md, PROMPTS.md, docs/AGENTS.md). A count rather than a
       name list because the population is discovered now — but discovery
       quietly returning one file would otherwise check almost nothing and
       still report green. */
    expect(pointers.length).toBeGreaterThanOrEqual(5)

    for (const file of pointers) {
      const lines = read(file)
        .split('\n')
        .filter((line) => line.trim() !== '')
      expect(
        lines.length,
        `${file} is a second copy of the instructions, not a one-line pointer`,
      ).toBe(1)
      for (const line of lines) {
        expect(line, `${file} must point at agents.md`).toContain('AGENTS.md')
        expect(line.length, `${file} has outgrown a pointer`).toBeLessThan(200)
      }
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
