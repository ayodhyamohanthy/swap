/* lane-board.mjs — the decisions `collab-check.mjs` makes, as pure functions.
 *
 * WHY THIS IS A SEPARATE FILE, and why it has no imports. `collab-check.mjs`
 * imports `node:child_process` and `node:fs`, and docs/11 records what that
 * costs: `azure/translator-lib.mjs` had a static `import 'node:fs'` and it broke
 * test collection for six lanes under the jsdom pool. A test cannot import the
 * CLI, so anything worth testing has to live where a test can reach it. This
 * module is therefore strings in, decisions out — no filesystem, no git, no
 * process. The CLI reads the files and passes their contents; the tests pass
 * fixtures. Both exercise the same code, which is the only way the tests can be
 * evidence about the real guard.
 *
 * WHY IT IS WORTH TESTING AT ALL. This guard has been broken three times by
 * well-meaning fixes, each time in a way that made it either refuse a clean
 * commit or accept a bad one:
 *
 *   1. The state cell was read as a fixed column (`cells[4]`), so a lane
 *      claimed in a three-column row was invisible to the guard.
 *   2. `active:` was searched unanchored, and every RELEASED row reads
 *      `done. <time> (was: active: <agent>)` — so releasing a lane re-armed the
 *      guard against it and no lane could ever clear its own claim.
 *   3. A lane naming its holder (`active: Pixel Canary/Claude, <time>`) parsed
 *      as nothing at all.
 *
 * All three are parsing decisions over a markdown table, which is exactly the
 * kind of thing a unit test pins in a millisecond. That is what this file is for.
 */

/**
 * Lane rows in `docs/14-LANES.md`, with the holder of each active claim.
 *
 * Returns `{ id, holder }` for every lane whose state cell BEGINS with
 * `active: <holder>`. `active: none` is docs/13 §5's release form and is not a
 * claim.
 *
 * @param {string} boardText  contents of docs/14-LANES.md
 * @returns {Array<{ id: string, holder: string }>}
 */
export function parseActiveLanes(boardText) {
  const active = []
  for (const line of boardText.split('\n')) {
    if (!line.startsWith('| L')) continue
    /* THE CLAIM CELL IS FOUND BY ITS CONTENT, NOT BY ITS POSITION. This is a
       correction, and it matters: the guard was DEAD when this was written.
       Lane rows are not all the same shape — most carry
       `| Lane | Surface | Owner | State | Notes |`, and a few carry
       `| Lane | Surface | State |` — so any fixed index is wrong for one of
       them. Two attempts had already been made and each broke the other shape:
       `cells[4]` read an empty string for a three-column row (a claim there was
       invisible), and `cells[cells.length - 1]` reads the NOTES cell for a
       five-column row — which is every row on the real board, so no claim was
       ever found and the hook silently passed everything. It reported `clear`
       on a board with an active lane, which is the worst way for a guard to
       fail.
       Scanning for the cell that STARTS with `active:` cannot break on shape,
       and the anchor keeps released rows out: they read
       `done. <time> (was: active: <agent>)`, where the notes about the old
       claim never begin the cell. */
    const cells = line.split('|').map((c) => c.trim())
    if (cells[0] === '') cells.shift()
    if ((cells[cells.length - 1] ?? '') === '') cells.pop()
    const id = (cells[0] ?? '').split(/\s+/)[0]
    if (!/^L\d+$/.test(id)) continue
    const claimCell = cells.find((cell) => /^active\s*:/i.test(cell))
    if (!claimCell) continue
    /* `active: none` is docs/13 §5's documented release form, so it is not a
       claim. The old `(?!none\b)` lookahead never fired: `\s*` backtracks to
       zero spaces, the lookahead then sits on ` n`, which is not `none`, and it
       succeeds — so both release conventions were unusable. */
    const claim = claimCell.match(/^active\s*:\s*([^,—–]+)/i)
    if (!claim) continue
    const holder = claim[1].trim()
    if (!holder || /^none$/i.test(holder)) continue
    active.push({ id, holder })
  }
  return active
}

/**
 * Does the committer's declaration cover this claim?
 *
 * THE PROBLEM THIS SOLVES. The guard knows which lane is active but not who is
 * committing, so it refused an agent's own files — L6, L7 and L4 all hit it, and
 * the only way past was `--no-verify`, which is the habit the guard exists to
 * stop. The obvious fix is `git config user.name`, and it CANNOT WORK HERE:
 * every agent on this machine commits under ONE shared identity, so that test
 * would exempt every commit and quietly turn the guard off. That is worth
 * stating in the code, because it is the fix the next person will reach for.
 *
 * So the identity is declared explicitly and per-process instead:
 *
 *   LANE=L9 git commit …                    — "this commit is lane L9's work"
 *   LANE_AGENT='Pixel Canary/Claude' git …  — "I am this claim's holder"
 *
 * Declaration is opt-in and fails safe: with neither variable set, behaviour is
 * exactly what it was. An agent that does not declare itself is still refused
 * another lane's files, and is now TOLD how to declare itself rather than being
 * left with `--no-verify` as the only way forward.
 *
 * `LANE_AGENT` matches case-insensitively on the whole holder string or on the
 * platform part before a `/`, so `Cline` covers `Cline`, and the holder of
 * `WorkBuddy/Claude` may declare either `WorkBuddy/Claude` or `WorkBuddy`.
 */
export function declaredBy(declaration, lane) {
  const laneId = (declaration.lane ?? '').trim()
  if (laneId && laneId.toUpperCase() === lane.id.toUpperCase()) return true
  const agent = (declaration.agent ?? '').trim().toLowerCase()
  if (!agent) return false
  const holder = lane.holder.toLowerCase()
  if (holder === agent) return true
  return holder.split('/')[0].trim() === agent
}

/** Glob -> RegExp. `**` spans directories, `*` stops at one. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 1
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/, '\\$&')
    }
  }
  return new RegExp('^' + re + '$')
}

/** Surfaces in docs/13 are written repo-relative (`app/src/components/**`) and
    source-relative (`routes/pay.*`), so both forms are tried. */
export function ownedByLane(file, surface) {
  return globToRegExp(surface).test(file) || globToRegExp(`app/src/${surface}`).test(file)
}

/**
 * Lane rows from `docs/13-COLLAB-CONTRACT.md` §1, as `{ id, surfaces }`.
 *
 * Only the lanes in `ids` are returned, because the caller only cares about the
 * lanes that are active right now — the map holds every lane, and an inactive
 * lane's surfaces must never block anybody.
 */
export function parseSurfaces(contractText, ids) {
  const wanted = new Set(ids)
  const lanes = []
  for (const line of contractText.split('\n')) {
    if (!line.startsWith('| L')) continue
    const cells = line.split('|').map((c) => c.trim())
    const id = (cells[1] ?? '').split(/\s+/)[0]
    if (!wanted.has(id)) continue
    const surfaces = [...(cells[2] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1])
    if (surfaces.length > 0) lanes.push({ id, surfaces })
  }
  return lanes
}

/**
 * Which staged files belong to somebody else's active claim.
 *
 * Files covered by a lane the committer DECLARED are not clashes — that is the
 * whole point of the declaration. Everything else is, including the case the
 * guard was written for: an agent staging files belonging to a lane somebody
 * else holds right now.
 */
export function clashesFor(files, lanes, declaration = {}) {
  const clashes = []
  for (const file of files) {
    for (const lane of lanes) {
      if (declaredBy(declaration, lane)) continue
      const hit = lane.surfaces.find((surface) => ownedByLane(file, surface))
      if (hit) clashes.push(`${file} -> ${lane.id} (${hit})`)
    }
  }
  return clashes
}

/**
 * docs/12 §2 vendor ledger rows: `{ vendor, status }`.
 *
 * Only the table inside the §2 section counts (the same vendor names recur
 * in prose elsewhere). Status is one of WIRED / RESERVE / BENCH / UNCLAIMED /
 * PARTIAL — anything else means the table gained a status this parser does
 * not understand, and that is reported, not defaulted.
 *
 * @param {string} ledgerText  contents of docs/12-INFRA-CREDITS.md
 * @returns {{ rows: Array<{ vendor: string, status: string }>, unknown: string[] }}
 */
export function parseVendorLedger(ledgerText) {
  const lines = ledgerText.split('\n')
  const start = lines.findIndex((l) => /^## §2\b/.test(l))
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  const rows = []
  const unknown = []
  for (const line of lines.slice(start + 1, end === -1 ? undefined : end)) {
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 6 || cells[1] === '' || cells[1] === 'Vendor') continue
    if (/^---/.test(cells[1])) continue
    const vendor = cells[1]
    const status = cells[4]
    if (!['WIRED', 'RESERVE', 'BENCH', 'UNCLAIMED', 'PARTIAL'].includes(status)) {
      unknown.push(`${vendor}: ${status}`)
      continue
    }
    rows.push({ vendor, status })
  }
  return { rows, unknown }
}

/**
 * npm package fragments for vendors that must never ship in the bundle.
 * docs/12 §2 statuses are the source of truth; this map is only the
 * mechanical vendor-name → package-name bridge. The test asserts every
 * non-WIRED ledger vendor either has fragments here or is named in
 * NON_PACKAGE_VENDORS, so adding a vendor row without updating this map
 * fails the suite instead of silently unguarding the new row.
 */
export const VENDOR_PACKAGES = {
  azure: ['@azure/', 'azure-'],
  mixpanel: ['mixpanel-browser', '@mixpanel/browser'],
  statsig: ['statsig-js', '@statsig/'],
  datadog: ['@datadog/'],
  'new relic': ['newrelic'],
  chargebee: ['chargebee'],
  'customer.io': ['customerio'],
}

/** Ledger vendors that are programs, not shippable SDKs — nothing to scan for. */
export const NON_PACKAGE_VENDORS = ['student pack']

/**
 * Non-WIRED ledger vendors found in dependency names or import specifiers.
 * Returns strings like `Mixpanel (RESERVE/BENCH): mixpanel-browser in
 * package.json`. Empty means the tree honors the whitelist.
 *
 * @param {string} ledgerText  contents of docs/12-INFRA-CREDITS.md
 * @param {string[]} depNames  dependencies + devDependencies names
 * @param {string[]} importSources  module specifiers from import statements
 * @returns {{ violations: string[], uncovered: string[] }}
 */
export function vendorViolations(ledgerText, depNames, importSources) {
  const { rows, unknown } = parseVendorLedger(ledgerText)
  const violations = []
  const uncovered = [...unknown]
  const haystacks = [...depNames, ...importSources].map((s) => s.toLowerCase())
  for (const { vendor, status } of rows) {
    if (status === 'WIRED') continue
    const key = vendor.toLowerCase()
    if (NON_PACKAGE_VENDORS.includes(key)) continue
    const fragments = VENDOR_PACKAGES[key]
    if (!fragments) {
      uncovered.push(`${vendor}: no package map`)
      continue
    }
    for (const frag of fragments) {
      const f = frag.toLowerCase()
      if (depNames.some((d) => d.toLowerCase() === f || d.toLowerCase().startsWith(f))) {
        violations.push(`${vendor} (${status}): ${frag} in package.json`)
      }
      if (importSources.some((s) => s.toLowerCase().includes(f))) {
        violations.push(`${vendor} (${status}): ${frag} imported in app/src`)
      }
    }
  }
  return { violations, uncovered }
}
