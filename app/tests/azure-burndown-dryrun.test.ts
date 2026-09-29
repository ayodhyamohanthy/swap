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
import { describe, expect, it } from 'vitest'
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

/* WHERE THE FIXTURES LIVE, AND WHY THEY MOVED. Two tests below need a file that
   the harness's directory scan can see, and they used to plant it in
   `app/azure/` itself, because that is the directory the harness scans by
   default. That is what made this file able to redden a run which had nothing to
   do with it.

   The harness digests `app/azure/` before and after the spenders run, to prove
   no step wrote outside `tmp/`. A fixture planted in that directory is visible
   to any harness run that OVERLAPS it, so the overlapping run fails with
   "files changed outside azure/tmp" — a SPEND-SAFETY alarm raised by a
   neighbour's scratch file. In a shared working tree that is the most expensive
   false positive this guard can produce, and two concurrent `npm run test`
   processes produce it reliably: one plants while the other is mid-digest.

   A `beforeAll` sweep used to clean up after that, and it could not help — it
   cannot see a fixture planted after it ran, and the test proving the sweep
   worked had to plant one in `app/azure/` to prove anything. So the fixtures
   moved out instead: each test makes a temp directory and passes it to the
   harness with `--scan`. The harness's default is still `app/azure/`, and
   `it('scans app/azure by default')` below pins that, so the real directory is
   still the one this file proves is checked. */

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
       pass for the wrong reason and prove nothing. It lives in a temp directory
       passed with `--scan` so this run cannot redden a concurrent one — see the
       note above. */
    const dir = mkdtempSync(join(tmpdir(), 'seatswap-scan-'))
    writeFileSync(
      join(dir, 'ghost-spender-probe.mjs'),
      'console.log("[ghost] nothing, but unlisted")\n',
    )
    try {
      const result = run('burndown-dry-run.mjs', ['--scan', dir])
      expect(result.status).toBe(1)
      expect(result.out).toContain('ghost-spender-probe.mjs')
      expect(result.out).toMatch(/SPENDERS|MANUAL/)
      /* The success token must not survive a failure. It used to be printed
         BEFORE this check, so a run that found an unlisted script printed
         `DRYRUN-OK` and then exited 1 — a token that reads as "ok" on a run
         that failed. Asserted as an absence, because presence alone was never
         the property that mattered. */
      expect(result.out).not.toContain('DRYRUN-OK')
    } finally {
      rmSync(dir, { recursive: true, force: true })
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
    /* This is a real incident, not a hypothetical: a fixture written next to the
       real scripts was left behind by a run killed before its `finally` ran, and
       the leftover made EVERY later harness run exit 1 — the guard had become
       the outage it existed to prevent. So the scratch exemption is asserted
       directly, with the file really on disk. It sits in a temp directory now,
       but the exemption is a property of the NAME, and the scan is what makes it
       visible either way. */
    const dir = mkdtempSync(join(tmpdir(), 'seatswap-scratch-'))
    writeFileSync(join(dir, 'leftover-check.tmp.mjs'), 'console.log("[scratch]")\n')
    try {
      const result = run('burndown-dry-run.mjs', ['--scan', dir])
      expect(result.status, result.out).toBe(0)
      expect(result.out).toContain('DRYRUN-OK')
      /* The scratch file was SEEN and exempted, not missed. A scan that found
         nothing at all would also exit 0 — and would prove the opposite of the
         point, since a `.tmp.mjs` that is never enumerated cannot be exempt. */
      expect(result.out).toMatch(/scanned: .*0 script\(s\), 0 unlisted/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 90_000)

  it('scans app/azure by default, so the real directory is the one checked', () => {
    /* `--scan` above is only safe while the default is still the real directory.
       If it were not, every fixture test in this file would be proving a
       property of a temp dir while `app/azure/` went unchecked — the guard
       reading as protection while measuring something else, which is the exact
       failure this file exists to prevent. Asserted from the run's own output
       rather than from the source, so a default that merely *looks* right in the
       code does not satisfy it. */
    const result = run('burndown-dry-run.mjs')
    expect(result.status, result.out).toBe(0)
    expect(result.out, 'the default scan directory is not app/azure').toMatch(
      /scanned: app\/azure\b.*0 unlisted/,
    )
  }, 90_000)
})

