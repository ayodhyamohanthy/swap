/* collab-check: the lane board parsing and the claim declaration.
 *
 * WHY THESE EXIST. The pre-commit guard has been broken three times by
 * well-meaning fixes, and every break was a parsing decision over a markdown
 * table that no test covered:
 *
 *   1. the state cell read as a fixed column, so a lane claimed in a
 *      three-column row was invisible;
 *   2. `active:` matched unanchored, so every RELEASED row (which carries
 *      `(was: active: <agent>)`) re-armed the guard and no lane could clear it;
 *   3. a claim naming its holder (`active: Pixel Canary/Claude, <time>`) parsed
 *      as nothing.
 *
 * Each cost a lane a blocked commit and a `--no-verify`, which is the habit the
 * guard exists to prevent. So each gets a test here, in the order they broke.
 *
 * The functions are imported from `scripts/lane-board.mjs`, which deliberately
 * imports NOTHING. `collab-check.mjs` itself cannot be imported from a test:
 * it pulls in `node:child_process`, and docs/11 records what that did when
 * `translator-lib.mjs` did the same — it broke collection for six lanes under
 * the jsdom pool. Keeping the decisions in a dependency-free module is what
 * makes them testable at all.
 */
import { describe, expect, it } from 'vitest'
import {
  clashesFor,
  deadSurfaces,
  declaredBy,
  globToRegExp,
  ownedByLane,
  parseActiveLanes,
  parseSurfaces,
} from '../scripts/lane-board.mjs'

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool, and it
   broke test collection for six lanes when `translator-lib.mjs` did it
   (docs/11). This file is about that class of mistake, so it is not going to
   make it. */
const { readFileSync, readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join, relative } = process.getBuiltinModule('node:path') as typeof import('node:path')

/* `import.meta.dirname`, matching `tests/backup-contract.test.ts`.
   `new URL('../../', import.meta.url)` does NOT work here: under the jsdom pool
   `import.meta.url` is not a `file:` URL, so `fileURLToPath` throws "The URL
   must be of scheme file" at COLLECTION time — the whole file fails with
   "(0 test)" rather than one test failing, which reads like a broken test file
   rather than a broken assumption. */
const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')

/** A board row in the shape docs/14 actually uses. */
const row = (cells: string[]) => `| ${cells.join(' | ')} |`

const BOARD = [
  '# 14 — lane board',
  '',
  '| Lane | Surface | Owner | State | Notes |',
  '|---|---|---|---|---|',
  row(['L7', 'Admin', 'Pixel Canary/Claude', 'active: Pixel Canary/Claude, 2026-09-29T06:10Z', 'working']),
  row(['L9', 'Infra', 'Cline', 'active: Cline', 'also working']),
  row(['L3', 'Requests', 'WorkBuddy/Claude', 'done. 2026-09-29T09:05Z', 'released']),
  row(['L4', 'Payments', 'Pixel Canary/Claude', 'done. 2026-09-29T07:38Z (was: active: WorkBuddy/Claude)', 'released after a claim']),
  row(['L5', 'Swaps', 'OpenCode/Muse Spark', 'active: none', 'released via the documented form']),
].join('\n')

const CONTRACT = [
  '| Lane | Surface (routes/files) | Typical agent |',
  '|---|---|---|',
  '| L7 Admin | `app/src/routes/admin.*`, `app/src/lib/admin.ts` | Windsurf |',
  '| L9 Infra | `app/scripts/**`, `.github/workflows/**` | Aider |',
  '| L3 Requests | `routes/request.*`, `lib/requests.ts` | Claude |',
].join('\n')

describe('parseActiveLanes', () => {
  it('reads the holder of each claim, and only the active ones', () => {
    expect(parseActiveLanes(BOARD)).toEqual([
      { id: 'L7', holder: 'Pixel Canary/Claude' },
      { id: 'L9', holder: 'Cline' },
    ])
  })

  it('does not treat a RELEASED row as active, even though it names a claim', () => {
    /* Break #2. Every released row reads `done. <time> (was: active: <agent>)`,
       so an unanchored search re-arms the guard the moment a lane releases and
       that lane can never commit its own files again. */
    const ids = parseActiveLanes(BOARD).map((c) => c.id)
    expect(ids).not.toContain('L4')
    expect(ids).not.toContain('L3')
  })

  it('treats `active: none` as released, not as a claim', () => {
    /* Break #2's second half: `active: none` is docs/13 §5's documented release
       form. The old `(?!none\\b)` lookahead never fired, so both release
       conventions were unusable. */
    expect(parseActiveLanes(BOARD).map((c) => c.id)).not.toContain('L5')
  })

  it('finds a claim in a three-column row', () => {
    /* Break #1. Reading `cells[4]` returned '' for a row with no Owner column,
       so a lane claimed in one was invisible to the guard entirely. */
    const threeColumn = row(['L9', 'Infra', 'active: Cline'])
    expect(parseActiveLanes(threeColumn)).toEqual([{ id: 'L9', holder: 'Cline' }])
  })

  it('parses a claim that names its holder with a time and a description', () => {
    /* Break #3 — the shape every lane actually writes. */
    const line = row(['L7', 'Admin', 'Owner', 'active: Pixel Canary/Claude, 2026-09-29T06:10Z — backlog 4', 'notes'])
    expect(parseActiveLanes(line)).toEqual([{ id: 'L7', holder: 'Pixel Canary/Claude' }])
  })

  it('handles an em dash and an en dash after the holder', () => {
    for (const sep of ['—', '–']) {
      const line = row(['L9', 'Infra', 'Owner', `active: Cline ${sep} backlog 5`, 'notes'])
      expect(parseActiveLanes(line), sep).toEqual([{ id: 'L9', holder: 'Cline' }])
    }
  })

  it('returns nothing for a board with no claims', () => {
    expect(parseActiveLanes(row(['L1', 'PWA', 'Owner', 'done.', 'notes']))).toEqual([])
  })

  it('ignores header and separator rows', () => {
    expect(parseActiveLanes(BOARD).some((c) => c.id === 'Lane')).toBe(false)
  })

  it('reads the REAL board the way a human reads it', () => {
    /* THE TEST THAT WOULD HAVE CAUGHT THE DEAD GUARD, and the reason it reads
       the live file rather than a fixture.

       The parser used to take `cells[cells.length - 1]` as the claim cell. On
       the real board every lane row ends with a long Notes cell, so that was
       the NOTES cell — the guard found zero active lanes and passed every
       commit, reporting `clear` while a lane was claimed. A fixture-shaped test
       would not have noticed, because a fixture is whatever its author believed
       the shape was. This one compares the parse against a property of the real
       file, so a row shape nobody anticipated still fails it.

       The property: a lane is claimed exactly when one of its cells BEGINS with
       `active:` — that is the board's own convention, and it is what a human
       eyeballing the table uses. */
    const board = readFileSync(join(import.meta.dirname, '..', '..', 'docs', '14-LANES.md'), 'utf8')
    const expected = []
    for (const line of board.split('\n')) {
      if (!/^\| L\d/.test(line)) continue
      const cells = line.split('|').map((c) => c.trim())
      const id = (cells[1] ?? '').split(/\s+/)[0]
      const claimCell = cells.find((cell) => /^active\s*:/i.test(cell))
      if (!claimCell) continue
      const holder = (claimCell.match(/^active\s*:\s*([^,—–]+)/i)?.[1] ?? '').trim()
      if (holder && !/^none$/i.test(holder)) expected.push({ id, holder })
    }
    expect(parseActiveLanes(board)).toEqual(expected)
    /* And the guard must be able to find the claim it is meant to enforce: an
       empty parse is the failure mode, so assert the parse is not vacuously
       empty when the board visibly has a claim. */
    if (/^active\s*:/im.test(board)) {
      expect(parseActiveLanes(board).length).toBeGreaterThan(0)
    }
  })
})

describe('declaredBy — the guard can tell a lane owner from a stranger', () => {
  /* THE REQUEST THIS ANSWERS (filed by L6, L7 and L4). The guard knew a lane was
     active but not who was committing, so it refused an agent's own files and
     the only way past was `--no-verify`.

     The requested fix was `git config user.name`, and it CANNOT work here:
     every agent on this machine commits under ONE shared identity, so it would
     exempt every commit and silently disable the guard. That is why the
     declaration is explicit and per-process instead, and why the first test
     below asserts the shared-identity case does NOT let a stranger through. */
  const lane = { id: 'L7', holder: 'Pixel Canary/Claude' }

  it('a stranger with no declaration is refused', () => {
    expect(declaredBy({}, lane)).toBe(false)
  })

  it('declaring your own lane id exempts it', () => {
    expect(declaredBy({ lane: 'L7' }, lane)).toBe(true)
    expect(declaredBy({ lane: 'l7' }, lane)).toBe(true)
  })

  it('declaring a lane id does not exempt a different lane', () => {
    expect(declaredBy({ lane: 'L9' }, lane)).toBe(false)
  })

  it("declaring the claim's holder exempts it, case-insensitively", () => {
    expect(declaredBy({ agent: 'Pixel Canary/Claude' }, lane)).toBe(true)
    expect(declaredBy({ agent: 'pixel canary/claude' }, lane)).toBe(true)
  })

  it('declaring the platform part of a compound holder exempts it', () => {
    /* Holders are written `Platform/Model` on this board, and an agent knows
       which platform it is far more reliably than it knows the exact string
       someone typed into the claim. */
    expect(declaredBy({ agent: 'Pixel Canary' }, lane)).toBe(true)
    expect(declaredBy({ agent: 'pixel canary' }, lane)).toBe(true)
  })

  it('does not exempt on a partial or unrelated name', () => {
    /* Substring matching would be the wrong direction: `Cline` must not match
       `Cline/Other`, and a name that merely CONTAINS the holder must fail. */
    expect(declaredBy({ agent: 'Pixel' }, lane)).toBe(false)
    expect(declaredBy({ agent: 'Canary' }, lane)).toBe(false)
    expect(declaredBy({ agent: 'not pixel canary/claude' }, lane)).toBe(false)
  })

  it('a simple holder needs an exact match, not a prefix', () => {
    const cline = { id: 'L9', holder: 'Cline' }
    expect(declaredBy({ agent: 'Cline' }, cline)).toBe(true)
    expect(declaredBy({ agent: 'Cl' }, cline)).toBe(false)
    expect(declaredBy({ agent: 'Cline2' }, cline)).toBe(false)
  })
})

describe('parseSurfaces', () => {
  it('reads the backticked surfaces of the lanes asked for', () => {
    expect(parseSurfaces(CONTRACT, ['L9'])).toEqual([
      { id: 'L9', surfaces: ['app/scripts/**', '.github/workflows/**'] },
    ])
  })

  it('returns nothing for a lane that is not active', () => {
    /* A released lane's files are nobody's business, which is what makes
       releasing the escape hatch for the next lane. */
    expect(parseSurfaces(CONTRACT, [])).toEqual([])
    expect(parseSurfaces(CONTRACT, ['L2'])).toEqual([])
  })
})

describe('ownedByLane / globToRegExp', () => {
  it('matches repo-relative and source-relative surfaces', () => {
    expect(ownedByLane('app/scripts/collab-check.mjs', 'app/scripts/**')).toBe(true)
    expect(ownedByLane('app/src/routes/request.new.tsx', 'routes/request.*')).toBe(true)
    expect(ownedByLane('app/src/lib/admin.ts', 'app/src/lib/admin.ts')).toBe(true)
  })

  it('does not match a file outside the surface', () => {
    expect(ownedByLane('app/src/lib/requests.ts', 'app/src/lib/admin.ts')).toBe(false)
    expect(ownedByLane('app/scripts/x.mjs', '.github/workflows/**')).toBe(false)
  })

  it('keeps `*` inside one path segment and lets `**` span them', () => {
    expect(globToRegExp('app/*').test('app/a/b')).toBe(false)
    expect(globToRegExp('app/**').test('app/a/b')).toBe(true)
  })
})

describe('clashesFor — who owns what, and who may commit it', () => {
  const lanes = [
    { id: 'L7', holder: 'Pixel Canary/Claude', surfaces: ['app/src/routes/admin.*', 'app/src/lib/admin.ts'] },
    { id: 'L9', holder: 'Cline', surfaces: ['app/scripts/**'] },
  ]

  it("refuses a stranger staging another lane's files", () => {
    /* The case the guard was written for, and it must keep working: this is the
       whole reason the hook exists. */
    const clashes = clashesFor(['app/src/lib/admin.ts'], lanes, {})
    expect(clashes).toEqual(['app/src/lib/admin.ts -> L7 (app/src/lib/admin.ts)'])
  })

  it("allows the claim holder to stage their own lane's files", () => {
    /* The request this answers. Before this, L6/L7/L4 were each blocked on their
       own committed work and reached for --no-verify. */
    expect(clashesFor(['app/src/lib/admin.ts'], lanes, { lane: 'L7' })).toEqual([])
    expect(clashesFor(['app/src/lib/admin.ts'], lanes, { agent: 'Pixel Canary/Claude' })).toEqual([])
  })

  it('still refuses when the declaration is for a different lane', () => {
    /* A declaration is not a blanket bypass: declaring L9 must not let you
       commit L7's files. */
    expect(clashesFor(['app/src/lib/admin.ts'], lanes, { lane: 'L9' })).toHaveLength(1)
    expect(clashesFor(['app/scripts/x.mjs'], lanes, { lane: 'L7' })).toHaveLength(1)
  })

  it('reports every clashing file, and leaves clean ones out', () => {
    const clashes = clashesFor(
      ['app/scripts/a.mjs', 'app/src/lib/admin.ts', 'docs/14-LANES.md'],
      lanes,
      {},
    )
    expect(clashes).toHaveLength(2)
    expect(clashes.join('\n')).not.toContain('docs/14-LANES.md')
  })

  it('names the lane and the matching surface, so the message is actionable', () => {
    const clashes = clashesFor(['app/scripts/a.mjs'], lanes, {})
    expect(clashes[0]).toContain('L9')
    expect(clashes[0]).toContain('app/scripts/**')
  })

  it('is quiet when no lane is active', () => {
    expect(clashesFor(['app/src/lib/admin.ts', 'app/scripts/a.mjs'], [], {})).toEqual([])
  })
})

describe('deadSurfaces — a surface that matches nothing is not a guard', () => {
  const lanes = [
    { id: 'L1', surfaces: ['app/src/components/ui/**', 'app/src/components/pwa*.tsx'] },
    { id: 'L2', surfaces: ['routes/index.*'] },
  ]
  const files = ['app/src/components/ui/button.tsx', 'app/src/routes/index.tsx']

  it('reports the surface that matches no file, and leaves the working ones out', () => {
    expect(deadSurfaces(lanes, files)).toEqual([
      { id: 'L1', surface: 'app/src/components/pwa*.tsx' },
    ])
  })

  it('catches both defects the shipped contract actually had', () => {
    /* Both were one character wide. Both left the real file unowned. Nothing
       reported either, because `clashesFor` can only refuse a file some surface
       MATCHES — so a surface matching nothing looks exactly like a lane with
       nothing to do. */
    const dead = deadSurfaces(
      [
        { id: 'L1', surfaces: ['app/src/components/pwa*.tsx'] },
        { id: 'L2', surfaces: ['routes/index'] },
      ],
      [
        'app/src/components/install-prompt.tsx',
        'app/src/components/service-worker.tsx',
        'app/src/routes/index.tsx',
      ],
    )
    expect(dead.map((d) => d.id)).toEqual(['L1', 'L2'])
  })

  it('is silent once the glob matches', () => {
    expect(deadSurfaces(lanes, [...files, 'app/src/components/pwa-install.tsx'])).toEqual([])
  })

  it('calls every surface dead when the file list is empty, rather than passing vacuously', () => {
    /* An empty list is what a mis-scoped scan produces, and it must not read as
       "clean" — that is how a guard reports health while reading nothing. */
    expect(deadSurfaces(lanes, [])).toHaveLength(3)
  })

  it('reports a lane whose surfaces are all dead', () => {
    expect(deadSurfaces([{ id: 'L4', surfaces: ['server/paypal-client.tsx'] }], files)).toEqual([
      { id: 'L4', surface: 'server/paypal-client.tsx' },
    ])
  })
})

/* THE SHIPPED FILES, not fixtures.
 *
 * Fixtures cannot tell you the real contract is wrong, and it was: two of its 39
 * surfaces matched no file at all, so they protected nothing, and no test
 * noticed — because no test had ever read the real file. `readFileSync` and
 * `join` were imported at the top of this file and never used until now, which
 * is that same gap in miniature.
 *
 * The file list is walked from disk rather than taken from `git ls-files` (the
 * guard's universe) because a test may not pull `node:child_process` into the
 * jsdom pool. Disk is a SUPERSET — it includes gitignored files — so the
 * stronger tracked-only case is covered by the CLI's own mutation runs instead,
 * where a surface pointing at `app/.tanstack/**` was measured going red. */
function sourceFiles(): string[] {
  const out: string[] = []
  const skip = new Set([
    'node_modules', '.git', 'dist', '.tanstack', '.commandcode', '.workbuddy-ai',
    'lovable build', 'swap',
  ])
  const walk = (abs: string) => {
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (skip.has(e.name)) continue
      const full = join(abs, e.name)
      if (e.isDirectory()) walk(full)
      else out.push(relative(REPO, full))
    }
  }
  walk(REPO)
  return out
}

describe('the shipped docs/13 §1 — the map the guard actually reads', () => {
  const contract = readFileSync(join(REPO, 'docs', '13-COLLAB-CONTRACT.md'), 'utf8')
  const ids = [...new Set([...contract.matchAll(/^\|\s*L(\d+)\b/gm)].map((m) => `L${m[1]}`))]

  it('parses ten lane rows out of the real table', () => {
    expect(ids).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10'])
  })

  it('has every surface matching at least one real file', () => {
    const dead = deadSurfaces(parseSurfaces(contract, ids), sourceFiles())
    expect(dead).toEqual([])
  })

  it('assigns app/vitest.config.ts in the TABLE, not only in the prose above it', () => {
    /* "app/vitest.config.ts follows L1" was the whole assignment for three days.
       `parseSurfaces` reads only the table, so the guard could not see it and
       the file was unprotected while the prose said otherwise. This assertion is
       what keeps the sentence and the table from drifting apart again. */
    expect(parseSurfaces(contract, ['L1'])[0].surfaces).toContain('app/vitest.config.ts')
  })

  it('covers the PWA components L1 owns, by path rather than by a prefix they lack', () => {
    const l1 = parseSurfaces(contract, ['L1'])[0].surfaces
    expect(l1).toContain('app/src/components/install-prompt.tsx')
    expect(l1).toContain('app/src/components/service-worker.tsx')
    expect(l1).not.toContain('app/src/components/pwa*.tsx')
  })

  it('lets L2 own the home route it always meant to', () => {
    expect(parseSurfaces(contract, ['L2'])[0].surfaces).toContain('routes/index.*')
  })
})
