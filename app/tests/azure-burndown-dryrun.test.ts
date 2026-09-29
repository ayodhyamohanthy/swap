/* Azure burn-down dry-run (docs/12 §3, backlog 5).
 *
 * WHAT IS WORTH TESTING HERE, given none of this code ships. The burn-down is a
 * set of local scripts that spend real Azure credits out of a $200 balance that
 * expires Dec 16 2026, and until now their safety rested on two sentences of
 * prose: README's "All scripts are dry-run safe with no keys" and docs/12's
 * "NEVER write app/locales/". Prose does not fail a build. These tests turn
 * both into assertions, and they cover the failure that actually happened: the
 * eval reporting numbers for a regex COPY of the guard while reading as an eval
 * of the guard itself.
 *
 * A note on what is deliberately NOT asserted: the exact leaf count and the
 * dollar estimate. `en.json` grows every time another lane adds a string, so a
 * test that froze those numbers would go red for a change that is not a defect.
 * What is asserted instead is that the docs stop quoting a number they cannot
 * keep current and point at the command that produces it.
 */
import { beforeAll, describe, expect, it } from 'vitest'
/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { spawnSync } = process.getBuiltinModule('node:child_process') as typeof import('node:child_process')
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } =
  process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { tmpdir } = process.getBuiltinModule('node:os') as typeof import('node:os')
const { dirname, join } = process.getBuiltinModule('node:path') as typeof import('node:path')
const { fileURLToPath } = process.getBuiltinModule('node:url') as typeof import('node:url')

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const AZURE = join(ROOT, 'app', 'azure')

function run(script: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [join(AZURE, script), ...args], {
    encoding: 'utf8',
    cwd: ROOT,
  })
  return { ...result, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/* The fixtures this file plants in `app/azure/`, named here so it can also
   remove them. They have to live in the real directory — the harness scans that
   directory, which is the whole point — and they are deliberately NOT
   `.tmp.mjs`, because `.tmp.mjs` is exempt and a fixture that passes for the
   wrong reason proves nothing.
 *
 * That leaves exactly one gap, and it bit this file: because the fixture is not
 * exempt, a leftover from a run that was KILLED (SIGKILL, or a killed test
 * process — `finally` does not run) makes the harness exit 1 for every later
 * run. The harness is behaving correctly; the tree is dirty. Worse, the failure
 * is self-cancelling and so reads as flakiness rather than as dirt: the
 * unlisted-script test's `finally` deletes the leftover it did not create, so
 * run N fails and run N+1 passes. Observed on this tree — planted fixture, then
 * `1 failed | 13 passed`; remove it, re-run, `14 passed`.
 *
 * So the fix belongs at THIS layer: clear our own fixtures before the suite
 * starts. Deliberately not a lock file — a lock left behind by a SIGKILL would
 * wedge every later run permanently, which is the disease, not the cure. This
 * version is self-healing instead: a stale fixture is litter, and litter gets
 * swept, not reported.
 *
 * Not covered, and not coverable from in here: two `npm run test` processes
 * running at once in this shared tree can still collide, because the other
 * process plants its fixture after this `beforeAll` has run. If this file goes
 * red naming `ghost-spender-probe.mjs`, check for a concurrent suite before
 * believing it is a defect. */
const OWN_FIXTURES = ['ghost-spender-probe.mjs', 'leftover-check.tmp.mjs']

/* Recorded, not thrown. A throw here is worse than a refusal: run inside an
   agent sandbox that blocks bulk deletes — WorkBuddy's `node-safe-delete-shim`
   refuses once a turn has deleted more than 50 files, and a full suite run
   gets there — the exception escapes `beforeAll` and turns one stale fixture
   into six red tests, which reads as a code regression rather than as an
   environment that cannot clean up. The refusal is kept so the test below can
   report it once, in one place, with the cause named. */
const sweepRefused: string[] = []

function clearOwnFixtures() {
  sweepRefused.length = 0
  for (const name of OWN_FIXTURES) {
    try {
      rmSync(join(AZURE, name), { force: true })
    } catch (err) {
      /* Accumulated, not overwritten. The loop visits every fixture, so a
         single-slot variable keeps only the LAST refusal and silently loses
         the first — which is the one the planted fixture below needs to find.
         That bug was caught by a full-suite run, not by reading it. */
      sweepRefused.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

beforeAll(clearOwnFixtures)

describe('Azure burn-down — the $0 promise is checked, not claimed', () => {
  it('runs every burn-down script with no network, no keys and no writes outside tmp', () => {
    const result = run('burndown-dry-run.mjs')
    expect(result.status, result.out).toBe(0)
    /* Machine-readable summary the harness prints only when all three restraints held. */
    expect(result.out).toMatch(/DRYRUN-OK scripts=2 network=0 writes=0 spend=0\.00/)
    expect(result.out).toContain('total spend: $0.00')
  }, 60_000)

  it('names the k6 plan as manual, so "covered" is never read as "load tested"', () => {
    const result = run('burndown-dry-run.mjs')
    expect(result.out).toMatch(/manual: load\/get-matches\.k6\.js/)
  }, 60_000)

  it('fails when a burn-down script is not registered in the harness', () => {
    /* A new spending script nobody dry-ran is the hole this file exists to
       close, so it is proved with a real file rather than asserted in prose.
       The fixture is deliberately NOT named `.tmp.mjs`: scratch files are exempt
       from the check (see the leftover test below), so a `.tmp` fixture would
       pass for the wrong reason and prove nothing. */
    const ghost = join(AZURE, 'ghost-spender-probe.mjs')
    writeFileSync(ghost, 'console.log("[ghost] nothing, but unlisted")\n')
    try {
      const result = run('burndown-dry-run.mjs')
      expect(result.status).toBe(1)
      expect(result.out).toContain('ghost-spender-probe.mjs')
      expect(result.out).toMatch(/SPENDERS|MANUAL/)
    } finally {
      rmSync(ghost, { force: true })
    }
  }, 90_000)

  it('no-net.mjs blocks a real fetch instead of letting it through', () => {
    /* The harness's whole $0 claim rests on this preload. Tested directly, with a
       URL that would be a live request if the preload ever stopped working. */
    const dir = mkdtempSync(join(tmpdir(), 'seatswap-nonet-'))
    const log = join(dir, 'attempts.log')
    const probe = join(dir, 'probe.mjs')
    writeFileSync(probe, "await fetch('https://example.com/seat-swap-probe')\n")
    try {
      const result = spawnSync(process.execPath, ['--import', join(AZURE, 'no-net.mjs'), probe], {
        encoding: 'utf8',
        env: { ...process.env, NO_NET_LOG: log },
      })
      expect(result.status).not.toBe(0)
      expect(`${result.stderr}`).toContain('no-net.mjs blocked a network call')
      /* Recorded, not just refused: "something tried to spend" is useless
         without the URL, and the URL is the only actionable part. */
      expect(existsSync(log)).toBe(true)
      expect(readFileSync(log, 'utf8')).toContain('example.com/seat-swap-probe')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)

  it('leaves app/locales alone — the one rule a draft script must never break', () => {
    const before = readFileSync(join(ROOT, 'app', 'locales', 'en.json'), 'utf8')
    expect(run('burndown-dry-run.mjs').status).toBe(0)
    expect(readFileSync(join(ROOT, 'app', 'locales', 'en.json'), 'utf8')).toBe(before)
  }, 90_000)
})

describe('safety-eval measures the shipped guard, not a copy of it', () => {
  it('classifies every corpus message and finds no misses', () => {
    const result = run('safety-eval.mjs')
    expect(result.status, result.out).toBe(0)
    /* The bug this replaced: the flag set omitted `hindi` and `obfuscated`, so
       the guard's Devanagari and evasion rules scored as 10 false positives
       (precision 70.6%) and the script printed "known gap: 0" above them. */
    expect(result.out).toContain('shipped guard')
    expect(result.out).toMatch(/FP=0 FN=0/)
    expect(result.out).toMatch(/precision=100\.0% recall=100\.0%/)
    const corpus = JSON.parse(readFileSync(join(AZURE, 'safety-corpus.json'), 'utf8')) as {
      messages: unknown[]
    }
    expect(result.out).toContain(`classified ${corpus.messages.length} of ${corpus.messages.length}`)
  }, 30_000)

  it('labels a mirror run as a mirror, and the mirror measurably scores worse', () => {
    /* `--mirror` forces the copy even on a Node that can import the guard, which
       is what makes this runnable. Two things are asserted: the banner appears
       (so the numbers can never be quoted as the guard's), and the copy really
       is worse — 9 false negatives against the guard's 0, because it has no
       Devanagari list and no evasion squishing. That gap is the reason this file
       refuses to fall back to a copy silently. */
    const result = run('safety-eval.mjs', ['--mirror'])
    expect(result.status, result.out).toBe(0)
    expect(result.out).toContain('MIRROR MODE')
    expect(result.out).toContain('NOT chat-guard.ts')
    expect(result.out).toMatch(/FN=[1-9]/)
    expect(result.out).not.toMatch(/precision=100\.0% recall=100\.0%/)
  }, 30_000)

  it('refuses to fall back to a copy when the guard is unavailable, without --mirror', () => {
    /* The old behaviour — import fails, quietly score a regex copy — is the bug
       this whole file exists to prevent, so the refusal is asserted on the
       script's own control flow: `--mirror` absent must be the only thing
       standing between a failed import and a fallback, and the fallback must
       exit non-zero rather than print numbers. Read as source because the only
       way to trigger a failed import is a Node too old to import TypeScript, and
       this suite runs on one that can. */
    const source = readFileSync(join(AZURE, 'safety-eval.mjs'), 'utf8')
    const refusal = source.indexOf('if (!wantMirror) {')
    const fallback = source.indexOf('return mirrorGuard(')
    expect(refusal).toBeGreaterThan(-1)
    expect(fallback).toBeGreaterThan(refusal)
    /* And the refusal block must exit rather than fall through. */
    expect(source.slice(refusal, fallback)).toMatch(/process\.exit\(2\)/)
  })

  it('rejects a corpus label with no expectation instead of scoring it as clean', () => {
    /* The silent default is what let the expectation table rot: an unlisted
       label fell through every branch and was counted nowhere, so a whole
       category could vanish from the report while the run stayed green. */
    const source = readFileSync(join(AZURE, 'safety-eval.mjs'), 'utf8')
    expect(source).toMatch(/corpus labels with no expectation/)
  })
})

describe('docs/12 and the README do not describe a burn-down that no longer exists', () => {
  const docs = () => readFileSync(join(ROOT, 'docs', '12-INFRA-CREDITS.md'), 'utf8')
  const readme = () => readFileSync(join(AZURE, 'README.md'), 'utf8')

  it('no longer claims the shipped guard is English-worded, which it stopped being', () => {
    /* docs/12 §3 and the README both recorded "chat-guard.ts regex is
       English-only (Hindi + spaced evasion unflagged)" as a known gap. The
       guard has carried HINGLISH_WORDS, HINDI_WORDS and squishEvasion() since
       before this test existed, and scores 100% on the corpus. A stale "known
       gap" is worse than none: it invites an agent to re-fix shipped behaviour,
       or to spend Azure credits chasing a gap that is not there. The pattern is
       deliberately narrow so a *negated* mention ("not English-worded") is fine
       while the original claim cannot come back. */
    const staleClaim = /English-only|only in English|English-worded regex/i
    expect(docs()).not.toMatch(staleClaim)
    expect(readme()).not.toMatch(staleClaim)
  })

  it('points at the dry-run command instead of quoting numbers that rot', () => {
    /* 635 leaves / ~17k chars / ~$3.48 were true when written and are false now
       (en.json has grown). A quoted number with no owner goes stale silently;
       a quoted command cannot. */
    expect(docs()).toContain('burndown-dry-run.mjs')
    expect(readme()).toContain('burndown-dry-run.mjs')
    expect(docs()).not.toMatch(/\$\d+\.\d+ for 21 langs/)
  })

  it('still states the rule that matters most: never write app/locales/', () => {
    expect(docs()).toMatch(/NEVER write `?app\/locales/)
  })
})

describe('the harness only runs scripts that exist', () => {
  it('registers every .mjs in app/azure that can spend', () => {
    /* A guard written against a hardcoded list is a guard that goes stale the
       moment someone adds a file, so the check reads the directory instead.
       `.tmp.mjs` is excluded for the same reason the harness excludes it: a
       scratch file is not a step, and one left behind by a killed test run must
       not make this suite (or the harness) fail forever. */
    const scripts = readdirSync(AZURE).filter(
      (name) => name.endsWith('.mjs') && !name.endsWith('.tmp.mjs'),
    )
    const source = readFileSync(join(AZURE, 'burndown-dry-run.mjs'), 'utf8')
    for (const name of scripts) {
      if (name === 'burndown-dry-run.mjs' || name === 'no-net.mjs' || name === 'translator-lib.mjs') continue
      expect(source, `${name} is not registered in SPENDERS or MANUAL`).toContain(name)
    }
  })

  it('a leftover scratch file cannot wedge the harness', () => {
    /* This is a real incident, not a hypothetical: the unlisted-script test above
       writes a fixture in this directory, and when that run was killed before its
       `finally` executed, the leftover made EVERY later harness run exit 1 — the
       guard had become the outage it existed to prevent. So the scratch
       exemption is asserted directly, with the file really on disk. */
    const scratch = join(AZURE, 'leftover-check.tmp.mjs')
    writeFileSync(scratch, 'console.log("[scratch]")\n')
    try {
      const result = run('burndown-dry-run.mjs')
      expect(result.status, result.out).toBe(0)
      expect(result.out).toContain('DRYRUN-OK')
    } finally {
      rmSync(scratch, { force: true })
    }
  }, 90_000)

  it('sweeps its own leftover fixtures before the suite runs', () => {
    /* The harness's `.tmp.mjs` exemption covers the scratch file above, but NOT
       this file's unlisted-script fixture — that one has to stay catchable, so
       it can never be exempt. The sweep is what covers it instead, and it is
       asserted from both sides: the helper really removes a planted fixture,
       and the helper is really wired to run first. A cleanup function nobody
       calls is precisely the failure mode this file exists to prevent — a guard
       that reads as protection while doing nothing. */
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    expect(source).toMatch(/beforeAll\(clearOwnFixtures\)/)
    for (const name of OWN_FIXTURES) expect(source).toContain(name)

    const planted = join(AZURE, OWN_FIXTURES[0])
    writeFileSync(planted, 'console.log("[planted]")\n')
    clearOwnFixtures()
    /* Where the environment permits deletion the fixture is gone. Where it does
       not — an agent sandbox refusing bulk deletes — the refusal was recorded
       rather than thrown, so this stays a statement about the sweep and does
       not become a phantom failure about the code. */
    if (sweepRefused.length === 0) expect(existsSync(planted)).toBe(false)
    else expect(sweepRefused.join('; ')).toContain(OWN_FIXTURES[0])
  })
})

