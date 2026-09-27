#!/usr/bin/env node
/* collab-check.mjs — mechanical guard for docs/11-COLLAB.md.
 *
 * Several agents on different models AND different platforms work this repo at
 * once, and the protocol is written in prose, so nobody actually follows it.
 * This turns the parts that can be checked into a command:
 *
 *   1. hot files      — you are about to commit a file another agent is
 *                       writing RIGHT NOW (the lost-work / red-build cause).
 *   2. scope          — untracked `??` work left behind, and over-broad staging.
 *   3. generated      — routeTree.gen.ts is stale: a route file on disk is not
 *                       registered, or the tree names a route that is gone.
 *   4. commit message — shape rule (never empty or a single character).
 *   5. green rule     — typecheck + full test suite, unless --fast.
 *
 * Correctness of money/copy/schema stays in the vitest suite; this only adds
 * the collaboration and staleness checks the suite cannot see.
 *
 * Usage:
 *   node scripts/collab-check.mjs                 # all checks
 *   node scripts/collab-check.mjs --fast          # skip typecheck + tests
 *   node scripts/collab-check.mjs --message "..." # check a commit message
 *   node scripts/collab-check.mjs --staged-only   # only the staged/hot checks
 */

import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = join(APP, '..')
const HOT_MINUTES = 15

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)
const valueOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

const SKIP_GREEN = has('--fast') || has('--staged-only')

let warnings = 0
let failures = 0

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const warn = (m) => {
  warnings++
  console.log(`  \x1b[33m!\x1b[0m ${m}`)
}
const bad = (m) => {
  failures++
  console.log(`  \x1b[31m✗\x1b[0m ${m}`)
}
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`)

function git(args, cwd = REPO) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    return ''
  }
}

const staged = () =>
  git(['diff', '--cached', '--name-only'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

const untracked = () =>
  git(['status', '--porcelain'])
    .split('\n')
    .filter((l) => l.startsWith('??'))
    .map((l) => l.slice(3).trim())
    .filter(Boolean)

/* ---- 1. hot files: written by another agent in the last HOT_MINUTES ---- */
function hotFiles() {
  const roots = ['src', 'tests', 'locales', 'supabase']
  const cutoff = Date.now() - HOT_MINUTES * 60_000
  const found = new Set()
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        walk(full)
      } else if (statSync(full).mtimeMs > cutoff) {
        found.add(relative(REPO, full))
      }
    }
  }
  for (const r of roots) walk(join(APP, r))
  return found
}

/* ---- 3. routeTree.gen.ts staleness ---- */
function routeFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...routeFiles(full))
    else if (e.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

function checkGenerated() {
  const genPath = join(APP, 'src', 'routeTree.gen.ts')
  let gen
  try {
    gen = readFileSync(genPath, 'utf8')
  } catch {
    warn('routeTree.gen.ts missing — run `npm run build`')
    return
  }
  const declared = new Set()
  for (const file of routeFiles(join(APP, 'src', 'routes'))) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/createFileRoute\(\s*'([^']+)'/g)) {
      const p = m[1].replace(/\/_index$/, '').replace(/\/$/, '') || '/'
      declared.add(p)
    }
  }
  const missing = [...declared].filter((p) => !gen.includes(`'${p}'`))
  if (missing.length > 0) {
    bad(`routeTree.gen.ts is stale — not registered: ${missing.join(', ')}`)
    console.log('      run `npm run build` and commit the regenerated tree with the route')
  } else {
    ok(`routeTree.gen.ts covers all ${declared.size} declared routes`)
  }
}

function main() {
  console.log('\x1b[1mcollab-check\x1b[0m — docs/11-COLLAB.md, enforced\n')

  /* commit message shape (docs/11: never single-character or empty) */
  const message = valueOf('--message')
  if (message !== undefined) {
    head('commit message')
    const subject = message.split('\n')[0].trim()
    if (subject.length === 0) bad('empty subject — history is how agents attribute files')
    else if (subject.length < 10) bad(`"${subject}" is too short to attribute (min 10 chars)`)
    else if (!/^[a-z]+(\(.+\))?:/.test(subject)) {
      warn(`"${subject}" is not conventional-commit scoped, e.g. feat(pay): …`)
    } else ok(`subject ok: ${subject}`)
  }

  /* 1 + 2. staging and hot files */
  const files = staged()
  head(`staged (${files.length} file${files.length === 1 ? '' : 's'})`)
  if (files.length === 0) {
    warn('nothing staged')
  } else {
    ok(`${files.length} file(s) staged`)
    if (files.length > 25) {
      warn(`${files.length} files staged — check this is your work, not a \`git add -A\``)
    }
  }

  const hot = hotFiles()
  head(`hot files (written in the last ${HOT_MINUTES} min)`)
  if (hot.size === 0) {
    ok('no file written in the last ' + HOT_MINUTES + ' min')
  } else {
    const clashing = files.filter((f) => hot.has(f))
    if (clashing.length > 0) {
      bad(`staging a file another agent is editing right now: ${clashing.join(', ')}`)
      console.log('      wait, or coordinate — do not `git rm` or rewrite it (docs/11)')
    } else {
      ok(`${hot.size} recently written, none staged by you`)
    }
  }

  const loose = untracked()
  if (loose.length > 0) {
    head('untracked')
    for (const f of loose) {
      console.log(`  \x1b[33m?\x1b[0m ${f} — belongs to whoever created it; leave it alone`)
    }
  }

  /* 3. generated files */
  if (!has('--staged-only')) {
    head('generated files')
    checkGenerated()
  }

  /* 5. green rule */
  if (!SKIP_GREEN) {
    head('green rule (docs/11)')
    for (const [label, cmd] of [
      ['typecheck', 'npm run typecheck'],
      ['tests', 'npm run test'],
    ]) {
      try {
        execSync(cmd, { cwd: APP, stdio: 'ignore' })
        ok(label)
      } catch {
        bad(`${label} failed — a red tree blocks every agent, so do not commit`)
      }
    }
  }

  head('result')
  if (failures > 0) {
    console.log(`  \x1b[31m${failures} failure(s)\x1b[0m, ${warnings} warning(s) — do not commit\n`)
    process.exit(1)
  }
  console.log(`  \x1b[32mclear\x1b[0m${warnings > 0 ? `, ${warnings} warning(s)` : ''}\n`)
}

main()
