/* backup-ref.mjs — print the Supabase project ref that docs/12 §4 records.
 *
 * Prints NOTHING and exits 0 when the ref is not recorded yet. That is
 * deliberate: "not recorded" is an expected state while build-plan item 2 is
 * open, and a caller that had to tell it apart from "this script is broken" by
 * inspecting output would eventually get it wrong. A non-zero exit therefore
 * means only one thing — the script could not do its job.
 *
 * Lives apart from `backup-contract.mjs` on purpose. That module imports
 * NOTHING so the test suite can import it under the jsdom pool; this one needs
 * `node:fs`, and docs/11 records what a static `node:*` import cost when
 * `translator-lib.mjs` had one.
 *
 * Used by `.github/workflows/seatswap-backup.yml`, which needs to know whether
 * the backup secret points at prod or at staging. The parsing used to be `awk`
 * inside the workflow, where the suite could not reach it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseEnvRefTable } from './backup-contract.mjs'

const want = process.argv[2]
if (want !== 'prod' && want !== 'staging') {
  console.error('usage: backup-ref.mjs prod|staging')
  process.exit(2)
}

const ledger = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', '12-INFRA-CREDITS.md')
let text
try {
  text = readFileSync(ledger, 'utf8')
} catch (err) {
  console.error(`cannot read ${ledger}: ${err.message}`)
  process.exit(1)
}

const ref = parseEnvRefTable(text)[want]
if (ref) console.log(ref)
