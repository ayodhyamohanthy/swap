#!/usr/bin/env node
/* install-hooks.mjs — activate the versioned pre-commit guard.
 *
 * git only reads hooks from `.git/hooks`, which is not versioned, so a fresh
 * clone gets nothing. The repo's own hooks live in `.githooks/` and this points
 * `core.hooksPath` at them. `core.hooksPath` is local git config by design: it
 * is not committed, so nobody's config is changed behind their back — you run
 * this once in your own clone.
 *
 * Idempotent. Safe to re-run after `git pull`.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOK = join(REPO, '.githooks', 'pre-commit')

if (!existsSync(HOOK)) {
  console.error(`pre-commit hook not found at ${HOOK} — nothing to install.`)
  process.exit(1)
}

try {
  chmodSync(HOOK, 0o755)
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: REPO })
} catch (err) {
  console.error('could not set core.hooksPath:', err.message)
  console.error('you can also do it by hand:  git config core.hooksPath .githooks')
  process.exit(1)
}

const path = execFileSync('git', ['config', 'core.hooksPath'], { cwd: REPO, encoding: 'utf8' }).trim()
console.log(`pre-commit guard active (core.hooksPath = ${path})`)
console.log('try it:  git commit -m "0"   # should be refused')
console.log('bypass:  git commit --no-verify   # only if you know it is safe')
