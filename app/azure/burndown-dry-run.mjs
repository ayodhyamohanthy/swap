#!/usr/bin/env node
/* SeatSwap Azure burn-down — DRY RUN. Proves $0 and no side effects, locally.
 *
 *     node app/azure/burndown-dry-run.mjs
 *
 * WHY THIS EXISTS. `app/azure/README.md` claimed "All scripts are dry-run safe
 * with no keys" and docs/12 §3 repeated it. A claim like that decays quietly: a
 * script grows a `fetch` outside its dry-run branch, or a default flips, and
 * the next person runs a "$0" command that spends real Azure credits out of a
 * $200 balance that expires Dec 16 2026. Nothing in the toolchain would notice,
 * because these scripts sit outside `tsconfig.include` and no test ran them.
 *
 * So the claim is checked instead of stated. Every runnable burn-down script is
 * executed here in its no-spend mode with three independent restraints:
 *
 *   1. NO NETWORK IS POSSIBLE. Each child gets `--import ./no-net.mjs`, which
 *      replaces `globalThis.fetch` before the script loads. A script that tries
 *      to spend does not merely fail — the attempt is recorded and named.
 *   2. NO KEYS. Azure credentials are stripped from the child environment, so a
 *      script cannot talk itself into the paid branch because a key happens to
 *      be exported in the shell that ran the harness.
 *   3. NO WRITES OUTSIDE `app/azure/tmp/`. A content digest of `app/locales/`
 *      and of this whole directory (minus `tmp/`) is compared before and after.
 *      `app/locales/` is the one tree a burn-down script must never touch
 *      (docs/12 §3: "NEVER write app/locales/"), and `tmp/` is the only place
 *      drafts are allowed to land.
 *
 * WHAT IT DOES NOT DO. It never calls Azure, so it cannot tell you the
 * translation or Content Safety quality you would actually get — that is the
 * opt-in `--azure` path in `safety-eval.mjs`. It also does not run the k6 load
 * plan, which needs k6 and a staging URL; that one is listed as manual below so
 * it is not mistaken for covered.
 *
 * THE REGISTRY IS THE POINT. A burn-down script missing from `SPENDERS` is one
 * whose dry run nobody ever executes, so the completeness check at the bottom
 * fails when a new `.mjs` appears unlisted.
 * `tests/azure-burndown-dryrun.test.ts` asserts the same from the other side.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')
const LOCALES = join(APP, 'locales')
const DRAFTS = join(HERE, 'tmp')

/* Everything in this directory that can spend, in the order docs/12 §3 lists
 * the burn-down. `args` is the no-spend invocation — for the translator that is
 * the explicit flag, not the absence of a key, so a developer's exported
 * AZURE_TRANSLATOR_KEY cannot turn a dry run into a bill. */
const SPENDERS = [
  { script: 'translator-draft.mjs', args: ['--dry-run'], what: 'language drafts' },
  { script: 'safety-eval.mjs', args: [], what: 'guard eval over the corpus' },
]

/* Run by hand rather than here, and why. */
const MANUAL = [
  {
    path: 'load/get-matches.k6.js',
    why: 'needs k6 installed and a staging BASE_URL; a load test, not a $0 check',
  },
]

/* Files that live here but are not standalone burn-down steps. */
const NOT_STEPS = new Set(['burndown-dry-run.mjs', 'no-net.mjs', 'translator-lib.mjs'])

/* A scratch file by name is not a burn-down step, and must not be able to wedge
   the harness. This is not hypothetical: `tests/azure-burndown-dryrun.test.ts`
   writes `ghost-spender.tmp.mjs` to prove the unlisted-script check fires, and
   when that run was killed before its `finally` ran, the leftover made every
   later run of this harness fail — the guard had become the outage. A file that
   is provably a temporary will not be treated as a real step, so an interrupted
   test run cannot break the next one. `.tmp.` is the repo-wide scratch idiom
   (translator-draft.mjs writes `tmp/<code>.json`, and other lanes use the same). */
function isScratch(name) {
  return name.endsWith('.tmp.mjs')
}

/* WHICH DIRECTORY DECIDES WHAT COUNTS AS A STEP. `app/azure/` by default, which
 * is the real question. The flag exists so the test that proves this check fires
 * does not have to plant its fixture in the real directory.
 *
 * A fixture planted there is not merely untidy — it is a false spend-safety
 * alarm. The digest check below snapshots this directory before and after the
 * spenders run, so any harness run that OVERLAPS the fixture's lifetime sees the
 * tree change and fails with "files changed outside azure/tmp". In a shared
 * working tree that is the most expensive false positive this guard can produce:
 * the one alarm nobody may learn to ignore, raised by a neighbour's scratch
 * file. The fixture moved out instead of the alarm being softened. */
function scanDir() {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--scan')
  if (at === -1) return HERE
  const given = argv[at + 1]
  const dir = resolve(given ?? '')
  if (given === undefined || !existsSync(dir)) {
    console.error(
      `burndown-dry-run: --scan needs an existing directory, got: ${given ?? '<missing>'}`,
    )
    process.exit(2)
  }
  return dir
}

/** A path as a reader recognises it: `app/azure` for the default, absolute otherwise. */
function display(dir) {
  const rel = relative(APP, dir)
  return rel.startsWith('..') ? dir : `app/${rel}`
}

/** Content digest of a tree, so a rewrite with identical bytes is not a change. */
function treeDigest(dir) {
  const lines = []
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name)
      if (current === HERE && name === 'tmp') continue
      if (statSync(path).isDirectory()) walk(path)
      else {
        const hash = createHash('sha1').update(readFileSync(path)).digest('hex')
        lines.push(`${relative(APP, path)} ${hash}`)
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return lines.join('\n')
}

/** Everything a run must not have changed, as one string. */
function protectedState() {
  return `${treeDigest(LOCALES)}\n--\n${treeDigest(HERE)}`
}

function runStep(step, logDir) {
  const netLog = join(logDir, `${step.script}.net`)
  const env = { ...process.env, NO_NET_LOG: netLog }
  /* Strip the Azure credentials so the paid branch is unreachable by accident. */
  for (const key of Object.keys(env)) {
    if (key.startsWith('AZURE_')) delete env[key]
  }
  const result = spawnSync(
    process.execPath,
    ['--import', join(HERE, 'no-net.mjs'), join(HERE, step.script), ...step.args],
    { env, encoding: 'utf8' },
  )
  const attempts = existsSync(netLog) ? readFileSync(netLog, 'utf8').split('\n').filter(Boolean) : []
  return { ...step, result, attempts }
}

/* Resolved up front so a bad argument exits 2 before the spenders run, rather
   than after two seconds of output that looks like a real dry run. */
const SCAN = scanDir()
const logDir = mkdtempSync(join(tmpdir(), 'seatswap-burndown-'))
const before = protectedState()
const runs = SPENDERS.map((step) => runStep(step, logDir))
const after = protectedState()
rmSync(logDir, { recursive: true, force: true })

console.log('=== SeatSwap Azure burn-down — dry run ===')
console.log(`scripts: ${SPENDERS.length} automatic · ${MANUAL.length} manual (not run here)`)
console.log('Azure credentials in env: stripped · fetch: replaced (no-net.mjs)\n')

const failures = []
let index = 0
for (const run of runs) {
  index += 1
  const { status, stdout, stderr } = run.result
  console.log(`[${index}/${SPENDERS.length}] ${run.script} ${run.args.join(' ')} — ${run.what}`)
  if (status !== 0) {
    failures.push(`${run.script} exited ${status}`)
    console.log(`      FAILED (exit ${status})`)
    for (const line of stderr.split('\n').filter(Boolean).slice(0, 4)) console.log(`      ${line}`)
    continue
  }
  console.log('      $0.00  ok')
  for (const line of stdout.split('\n').filter(Boolean)) console.log(`      ${line}`)
  if (run.attempts.length > 0) {
    failures.push(`${run.script} tried to reach the network: ${run.attempts.join(', ')}`)
    console.log(`      NETWORK ATTEMPTS: ${run.attempts.join(', ')}`)
  }
  console.log('')
}

const changed = before !== after
if (changed) failures.push(`files changed outside ${relative(APP, DRAFTS)}`)

for (const step of MANUAL) console.log(`  manual: ${step.path} — ${step.why}`)

const network = runs.reduce((n, run) => n + run.attempts.length, 0)
console.log(`network attempts: ${network}`)
console.log(`files changed outside ${relative(APP, DRAFTS)}: ${changed ? 'SOME — see below' : 'none'}`)
console.log('total spend: $0.00')

if (failures.length > 0) {
  console.log('\n=== DRY RUN FAILED ===')
  for (const failure of failures) console.log(`  ${failure}`)
  process.exit(1)
}

/* A new burn-down script nobody dry-ran is the failure this file exists to
 * prevent, so it fails here rather than being quietly left out of the table.
 *
 * THIS RUNS BEFORE THE SUCCESS LINE, and that order is the point. `DRYRUN-OK`
 * used to be printed first, so a run that found an unlisted script printed
 * DRYRUN-OK and then exited 1 — a token that reads as "ok" appearing on a run
 * that failed, which is how a machine-readable success signal stops being one.
 * The test asserts its ABSENCE on a failing run, not only its presence. */
const present = readdirSync(SCAN).filter(
  (name) => name.endsWith('.mjs') && !NOT_STEPS.has(name) && !isScratch(name),
)
const unlisted = present.filter((name) => !SPENDERS.some((step) => step.script === name))
console.log(`scanned: ${display(SCAN)} — ${present.length} script(s), ${unlisted.length} unlisted`)
if (unlisted.length > 0) {
  console.error(
    `\nburndown-dry-run: unlisted script(s) in ${display(SCAN)}: ${unlisted.join(', ')}\n` +
      'Add each to SPENDERS with its no-spend invocation, or to MANUAL with a reason.',
  )
  process.exit(1)
}

/* Machine-readable, for tests/azure-burndown-dryrun.test.ts. Emitted only once
 * every check above has passed, so its presence IS the success signal. */
console.log(`DRYRUN-OK scripts=${runs.length} network=${network} writes=0 spend=0.00`)
