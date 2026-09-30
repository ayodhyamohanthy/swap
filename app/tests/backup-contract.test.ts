/* backup-contract: docs/12 §5 + docs/16's nightly-backup contract, enforced
 * without the six secrets the workflow needs.
 *
 * WHY THESE EXIST. Build-plan item 3 asks for `.github/workflows/seatswap-
 * backup.yml`, and the file that was handed over could not be run — it needed
 * six secrets that do not exist yet — so nothing about it was checkable, and it
 * was wrong in six ways a reader passes over: it sat in a directory GitHub does
 * not read (so the nightly backup had never existed), its `pg_dump | gzip` was
 * unguarded by `pipefail` (so a failed dump shipped as a good backup), its
 * ZeptoMail alert sent a bare token where the API requires the `Zoho-enczapikey`
 * prefix (so the alert could never deliver), its only dump check was a size
 * floor on the COMPRESSED file (so a dump that died mid-stream passed), and it
 * omitted the `--clean --if-exists` that docs/16's own restore drill needs.
 *
 * The functions are imported from `scripts/backup-contract.mjs`, which imports
 * NOTHING. `collab-check.mjs` cannot be imported from a test: it pulls in
 * `node:child_process`, and docs/11 records what that did when
 * `translator-lib.mjs` did the same — it broke collection for six lanes under
 * the jsdom pool.
 *
 * The load-bearing tests are the last two blocks: the mutation table, which
 * runs the shipped guard against the shipped workflow, and the real-files
 * block, which checks the workflow is where GitHub looks for it. A guard proven
 * only against fixtures is a guard that can be green while the file it reads
 * has changed shape.
 */
import { describe, expect, it } from 'vitest'

import {
  backupFindings,
  cronForUtcTime,
  dumpBody,
  parseBackupContract,
  parseEnvRefTable,
  parseGhActionSecrets,
  parseWorkflowSource,
  runBodies,
} from '../scripts/backup-contract.mjs'

/* node: modules come via getBuiltinModule — a static `import 'node:fs'` is
   mangled by Vite's browser-compat externalization under the jsdom pool. */
const { existsSync, readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')

const APP = join(import.meta.dirname, '..')
const REPO = join(APP, '..')

/** The path docs/12 §5 names. Asserted against the docs below, not assumed. */
const WORKFLOW_REL = '.github/workflows/seatswap-backup.yml'

const ledgerText = readFileSync(join(REPO, 'docs', '12-INFRA-CREDITS.md'), 'utf8')
const exitText = readFileSync(join(REPO, 'docs', '16-EXIT-PLAYBOOK.md'), 'utf8')
const workflowText = readFileSync(join(REPO, WORKFLOW_REL), 'utf8')

type Texts = { workflowText: string; ledgerText: string; exitText: string }
const BASE: Texts = { workflowText, ledgerText, exitText }

describe('cronForUtcTime', () => {
  it('turns a stated time into a cron, minute first', () => {
    expect(cronForUtcTime('22:00')).toBe('0 22 * * *')
    expect(cronForUtcTime('03:30')).toBe('30 3 * * *')
  })

  it('returns null for anything that is not a time, so the caller reports blindness', () => {
    for (const bad of ['', 'nope', '24:00', '12:60', '22', '22:00:00']) {
      expect(cronForUtcTime(bad)).toBeNull()
    }
  })
})

describe('parseWorkflowSource', () => {
  const YAML = [
    'name: demo',
    '',
    'on:',
    '  schedule:',
    "    - cron: '0 22 * * *'   # 22:00 UTC",
    '  workflow_dispatch:',
    '',
    'env:',
    '  R2_BUCKET: bucket-x',
    '',
    'jobs:',
    '  backup:',
    '    steps:',
    '      - name: A',
    '        run: |',
    '          - name: not a step',
    '          set -euo pipefail',
    '          echo "# not a comment to yaml"',
    '      - name: B',
    '        run: echo one-liner',
  ].join('\n')

  it('reads the name, the crons and workflow_dispatch', () => {
    const wf = parseWorkflowSource(YAML)
    expect(wf.name).toBe('demo')
    expect(wf.crons).toEqual(['0 22 * * *'])
    expect(wf.hasWorkflowDispatch).toBe(true)
    expect(wf.unparsed).toEqual([])
  })

  it('does not parse a block scalar body as YAML', () => {
    /* The property that matters: `- name: not a step` is shell inside a `run: |`
       block, and a reader that treated it as a sequence item would invent a
       third step and misattribute everything after it. */
    const keys = parseWorkflowSource(YAML).records.filter((r) => r.kind === 'seq').map((r) => r.key)
    expect(keys).toEqual(['cron', 'name', 'name'])
  })

  it('reports a line it cannot classify rather than skipping it', () => {
    const wf = parseWorkflowSource('name: demo\njust some text with no colon\n')
    expect(wf.unparsed).toHaveLength(1)
    expect(wf.unparsed[0]).toMatchObject({ line: 2, why: expect.stringMatching(/not a key/) })
  })

  it('reports a tab in the indentation, which YAML forbids', () => {
    const wf = parseWorkflowSource('name: demo\n\tvalue: 1\n')
    expect(wf.unparsed).toHaveLength(1)
    expect(wf.unparsed[0].why).toBe('tab in indentation')
  })
})

describe('runBodies and dumpBody', () => {
  const YAML = [
    'jobs:',
    '  b:',
    '    steps:',
    '      - name: install the client',
    '        run: |',
    '          apt-get install -y postgresql-client',
    '          pg_dump --version',
    '      - name: dump',
    '        run: |',
    '          set -euo pipefail',
    '          pg_dump "$URL" --no-owner | gzip > "seatswap-$STAMP.sql.gz"',
    '      - name: one liner',
    '        run: echo hi',
  ].join('\n')

  it('collects each run: script, block or one-liner', () => {
    const bodies = runBodies(parseWorkflowSource(YAML).records)
    expect(bodies).toHaveLength(3)
    expect(bodies[0].text).toContain('pg_dump --version')
    expect(bodies[2].text).toBe('echo hi')
  })

  it('picks the dump, not the version check that names it', () => {
    /* The regression. `pg_dump\\s+["$']` also matches `pg_dump --version` in the
       INSTALL step, so the guard inspected that script, found its `pipefail`,
       and reported the real dump's `gzip` and `--clean` missing. */
    const dump = dumpBody(parseWorkflowSource(YAML).records)
    expect(dump?.text).toContain('gzip')
    expect(dump?.text).not.toContain('--version')
  })

  it('returns null when no step dumps, so the caller reports it', () => {
    const noDump = 'jobs:\n  b:\n    steps:\n      - name: a\n        run: echo hi\n'
    expect(dumpBody(parseWorkflowSource(noDump).records)).toBeNull()
  })
})

describe('parseGhActionSecrets', () => {
  const S8 = [
    '## §8 Env var → vendor key map',
    '| Var | Read by | Source |',
    '|-----|---------|--------|',
    '| VITE_X | client | somewhere |',
    '| ZEPTOMAIL_TOKEN | worker secret + GH Actions secret | Zoho |',
    '| R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY | GH Actions secrets | CF |',
    '| R2 binding: BACKUPS | wrangler.toml binding | CF bucket |',
    '| the ops inbox | GH Actions secret | Ayu |',
    '',
    '## §9 something else',
    '| LATER | GH Actions secret | not this section |',
  ].join('\n')

  it('keeps only the GH Actions secret rows, splitting the slash-separated ones', () => {
    expect(parseGhActionSecrets(S8).secrets).toEqual([
      'ZEPTOMAIL_TOKEN',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ])
  })

  it('stops at the next heading, so a later section cannot smuggle a name in', () => {
    expect(parseGhActionSecrets(S8).secrets).not.toContain('LATER')
  })

  it('skips a client var and a wrangler binding, which are not secrets', () => {
    const { secrets } = parseGhActionSecrets(S8)
    expect(secrets).not.toContain('VITE_X')
    expect(secrets.join(' ')).not.toMatch(/BACKUPS/)
  })

  it('reports a row it cannot read rather than dropping it', () => {
    /* Dropping it would make the workflow look like it used an extra secret,
       and the operator would go and edit the wrong file. */
    expect(parseGhActionSecrets(S8).unparsedCells).toEqual(['the ops inbox'])
  })
})

describe('parseEnvRefTable', () => {
  const TABLE = [
    '## §4 Environments',
    '| Env     | Supabase project | Project ref (URL host) | Created |',
    '|---------|------------------|------------------------|---------|',
    '| staging | seatswap-staging | — none yet             | TODO (Ayu) |',
    '| prod    | seatswap-prod    | — none yet             | TODO (Ayu) |',
    '| Env | not a ref | — none yet | x |',
  ].join('\n')

  it('reads a recorded ref and treats "— none yet" as absent', () => {
    expect(parseEnvRefTable(TABLE)).toEqual({ prod: null, staging: null })
    const filled = TABLE.replace(/^\| prod    \|.*$/m, '| prod    | seatswap-prod    | mfghjkwlpxzvbnqrstyc   | 2026-09-30 |')
    expect(parseEnvRefTable(filled)).toEqual({ prod: 'mfghjkwlpxzvbnqrstyc', staging: null })
  })

  it('rejects a cell that is not the shape of a Supabase ref', () => {
    /* The distinction the staging-versus-prod check turns on: a cell holding
       "— none yet" must read as ABSENT, never as a ref to compare against. */
    const short = TABLE.replace(/^\| prod    \|.*$/m, '| prod    | seatswap-prod    | tooshort               | 2026-09-30 |')
    expect(parseEnvRefTable(short).prod).toBeNull()
  })

  it('ignores a same-shaped table outside §4', () => {
    const elsewhere = '## §9 Other\n| prod | x | mfghjkwlpxzvbnqrstyc | y |\n'
    expect(parseEnvRefTable(elsewhere).prod).toBeNull()
  })
})

describe('parseBackupContract', () => {
  it('reads every clause out of the real docs', () => {
    expect(parseBackupContract(ledgerText, exitText)).toEqual({
      workflowName: 'seatswap-backup-prod',
      filePath: '.github/workflows/seatswap-backup.yml',
      cronUtc: '22:00',
      bucket: 'seatswap-backups-prod',
      retentionDays: 30,
      retentionDaysExit: 30,
      keyTemplate: 'seatswap-YYYY-MM-DD.sql.gz',
    })
  })

  it('reports a clause the docs no longer state as null, so the caller can go blind loudly', () => {
    const stripped = ledgerText.replace(/Nightly GitHub Actions workflow `[^`]+`/, 'the nightly job')
    expect(parseBackupContract(stripped, exitText).workflowName).toBeNull()
  })
})

describe('backupFindings on the shipped files', () => {
  const findings = backupFindings(BASE)

  it('is clean, so the mutation table below means something', () => {
    /* A red baseline makes every "caught" assertion vacuous — the harness this
       guard was developed against reported 32/32 caught while the baseline was
       already failing for an unrelated reason. */
    expect(findings.problems).toEqual([])
    expect(findings.ok).toBe(true)
  })

  it('puts the workflow where GitHub actually looks, and nowhere else', () => {
    expect(findings.facts.doc.filePath).toBe(WORKFLOW_REL)
    expect(existsSync(join(REPO, WORKFLOW_REL))).toBe(true)
    /* The handoff file sat at `workflows/` in the repo root, which GitHub never
       reads — so the nightly backup did not exist and nothing said so. A second
       copy would drift from this one and read as live. */
    expect(existsSync(join(REPO, 'workflows', 'seatswap-backup.yml'))).toBe(false)
  })

  it('uses exactly the six secrets docs/12 §8 marks as GH Actions secrets', () => {
    const wf = parseWorkflowSource(workflowText)
    const { secrets } = parseGhActionSecrets(ledgerText)
    expect(secrets).toHaveLength(6)
    expect([...wf.secretRefs].sort()).toEqual([...secrets].sort())
  })

  it('reads the whole workflow, so no check below is a claim about an unread file', () => {
    expect(parseWorkflowSource(workflowText).unparsed).toEqual([])
    expect(findings.facts.unparsedLines).toBe(0)
  })

  it('runs the cron docs/12 §5 states', () => {
    expect(findings.facts.expectedCron).toBe('0 22 * * *')
    expect(findings.facts.crons).toContain('0 22 * * *')
  })

  it('names what only a human can do, instead of reporting a bare pass', () => {
    const steps = findings.humanSteps.join('\n')
    expect(steps).toMatch(/six repo secrets/)
    expect(steps).toMatch(/lifecycle rule on seatswap-backups-prod/)
    expect(steps).toMatch(/workflow_dispatch run end to end/)
    /* The sender domain is build-plan item 4, so the alert is correct but
       cannot deliver yet. That is a fact about the project, not a defect, and
       it has to be visible rather than assumed. */
    expect(steps).toMatch(/alerts@seatswap\.invalid/)
  })
})

/** Each entry mutates the shipped workflow or the shipped docs, and must be caught. */
const MUTATIONS: Array<[string, RegExp, (t: Texts) => Partial<Texts>]> = [
  [
    'a dump step without pipefail',
    /pipefail/,
    (t) => ({ workflowText: t.workflowText.replace('set -euo pipefail\n          stamp=', 'set -e\n          stamp=') }),
  ],
  [
    'a dump that is not gzipped',
    /gzip/,
    (t) => ({ workflowText: t.workflowText.replace('| gzip -9 > "seatswap-$stamp.sql.gz"', '> "seatswap-$stamp.sql.gz"') }),
  ],
  [
    'a dump that omits --clean',
    /--clean/,
    (t) => ({ workflowText: t.workflowText.replace('--no-privileges --clean --if-exists', '--no-privileges --if-exists') }),
  ],
  [
    'a dump that omits --no-owner',
    /--no-owner/,
    (t) => ({ workflowText: t.workflowText.replace('--format=plain --no-owner', '--format=plain') }),
  ],
  [
    'a cron the docs do not state',
    /crons are 0 23/,
    (t) => ({ workflowText: t.workflowText.replace("- cron: '0 22 * * *'", "- cron: '0 23 * * *'") }),
  ],
  [
    'an alert with a bare token',
    /Zoho-enczapikey/,
    (t) => ({ workflowText: t.workflowText.replace('Authorization: Zoho-enczapikey $ZEPTOMAIL_TOKEN', 'Authorization: $ZEPTOMAIL_TOKEN') }),
  ],
  [
    'an alert whose curl cannot fail',
    /-f/,
    (t) => ({ workflowText: t.workflowText.replace('curl -fsS -X POST', 'curl -sS -X POST') }),
  ],
  [
    'an alert that swallows its own failure',
    /\|\| true/,
    (t) => ({ workflowText: t.workflowText.replace('          JSON\n', '          JSON\n          || true\n') }),
  ],
  [
    'a step with no failure guard',
    /if: failure/,
    (t) => ({ workflowText: t.workflowText.replace('        if: failure()\n', '') }),
  ],
  [
    'a second failure guard',
    /exactly one should send the alert/,
    (t) => ({ workflowText: t.workflowText.replace('      - name: Verify the object landed\n', '      - name: Verify the object landed\n        if: failure()\n') }),
  ],
  [
    'a secret docs/12 §8 does not list',
    /does not list as a GH Actions secret/,
    (t) => ({ workflowText: t.workflowText.replace('secrets.ALERT_EMAIL', 'secrets.OPS_INBOX') }),
  ],
  [
    'a listed secret the workflow never uses',
    /never uses it/,
    (t) => ({ workflowText: t.workflowText.replaceAll('secrets.ALERT_EMAIL', 'secrets.ZEPTOMAIL_TOKEN') }),
  ],
  [
    'a committed postgres url',
    /literal postgres:\/\//,
    (t) => ({
      workflowText: t.workflowText.replace(
        'set -euo pipefail\n          stamp=',
        'set -euo pipefail\n          echo postgres://u:p@db.abcdefghij0123456789.supabase.co:5432/postgres\n          stamp=',
      ),
    }),
  ],
  [
    'a secret assigned a literal value',
    /instead of/,
    (t) => ({ workflowText: t.workflowText.replace('  R2_BUCKET: seatswap-backups-prod', '  R2_BUCKET: seatswap-backups-prod\n  R2_SECRET_ACCESS_KEY: hunter2') }),
  ],
  [
    'a step disabled with if: false',
    /forbids disabling the backup workflow/,
    (t) => ({ workflowText: t.workflowText.replace('      - name: Upload to R2\n', '      - name: Upload to R2\n        if: false\n') }),
  ],
  [
    'a workflow whose name disagrees with the docs',
    /calls itself/,
    (t) => ({ workflowText: t.workflowText.replace('name: seatswap-backup-prod', 'name: backup-nightly') }),
  ],
  [
    'a bucket the docs do not record',
    /never names the bucket/,
    (t) => ({ workflowText: t.workflowText.replaceAll('seatswap-backups-prod', 'some-other-bucket') }),
  ],
  [
    'a client-side VITE_ var in a server job',
    /VITE_/,
    (t) => ({ workflowText: t.workflowText.replace('  R2_BUCKET: seatswap-backups-prod', '  VITE_POSTHOG_KEY: x') }),
  ],
  [
    'an object key with no date, so every night overwrites one object',
    /%F/,
    (t) => ({ workflowText: t.workflowText.replaceAll('+%F', '+%Y-%m') }),
  ],
  [
    'no workflow_dispatch, so the drill cannot be triggered',
    /workflow_dispatch/,
    (t) => ({ workflowText: t.workflowText.replace('  workflow_dispatch:\n', '') }),
  ],
  [
    'a line the reader cannot classify',
    /was not understood/,
    (t) => ({ workflowText: t.workflowText.replace('  contents: read', '  contents: read\n  just some text with no colon') }),
  ],
  [
    'a tab in the indentation',
    /tab in indentation/,
    (t) => ({ workflowText: t.workflowText.replace('  contents: read', '\tcontents: read') }),
  ],
  [
    'a dump step that only checks its own version',
    /gzip/,
    (t) => ({ workflowText: t.workflowText.replace('pg_dump "$SUPABASE_DB_URL" \\', 'pg_dump --version \\') }),
  ],
  [
    'docs/12 §5 renaming the workflow',
    /docs\/12 §5 names it/,
    (t) => ({ ledgerText: t.ledgerText.replace('workflow `seatswap-backup-prod`', 'workflow `nightly-db-backup`') }),
  ],
  [
    'docs/12 §5 moving the cron',
    /§5 says 23:00 UTC/,
    (t) => ({ ledgerText: t.ledgerText.replace('cron 22:00 UTC', 'cron 23:00 UTC') }),
  ],
  [
    'docs/12 §5 moving the bucket',
    /never names the bucket seatswap-dumps/,
    (t) => ({ ledgerText: t.ledgerText.replace('R2 bucket seatswap-backups-prod', 'R2 bucket seatswap-dumps') }),
  ],
  [
    'docs/12 §5 and docs/16 disagreeing about retention',
    /can only delete at one age/,
    (t) => ({ ledgerText: t.ledgerText.replace('30-day retention', '14-day retention') }),
  ],
  [
    'docs/12 §5 moving the file path',
    /no longer states the workflow file path/,
    (t) => ({ ledgerText: t.ledgerText.replace('(.github/workflows/seatswap-backup.yml,', '(.github/workflows/backup.yml,') }),
  ],
  [
    'docs/12 §8 dropping a row',
    /does not list as a GH Actions secret/,
    (t) => ({ ledgerText: t.ledgerText.replace("| ALERT_EMAIL | GH Actions secret | Ayu's ops inbox |\n", '') }),
  ],
  [
    'docs/12 §8 garbling a var cell',
    /not a var name/,
    (t) => ({ ledgerText: t.ledgerText.replace('| ALERT_EMAIL | GH Actions secret', '| the ops inbox | GH Actions secret') }),
  ],
  [
    'docs/16 dropping the object key',
    /no longer states the object key template/,
    (t) => ({ exitText: t.exitText.replace('seatswap-YYYY-MM-DD.sql.gz', 'seatswap-<date>.gz') }),
  ],
]

describe('the guard catches every defect, against the shipped files', () => {
  for (const [what, expected, mutate] of MUTATIONS) {
    it(`catches ${what}`, () => {
      const over = mutate(BASE) as Record<string, string>
      for (const [key, value] of Object.entries(over)) {
        /* Without this, a mutation whose search string no longer matches the
           file would leave the text unchanged and the assertion below would
           pass while testing nothing. That happened while writing this file. */
        expect(value, `the mutation "${what}" did not apply — ${key} is unchanged`).not.toBe(
          BASE[key as keyof Texts],
        )
      }
      const result = backupFindings({ ...BASE, ...over })
      expect(result.ok).toBe(false)
      expect(result.problems.join('\n')).toMatch(expected)
    })
  }

  it('does not flag a comment that merely mentions a flag', () => {
    /* The negative control. The workflow explains every flag it passes, and the
       first version of this guard searched the whole file — so deleting a flag
       from the command left the comment naming it and the guard stayed green.
       Dropping the flag from the comment must therefore be silent. */
    const over = { workflowText: workflowText.replace('--clean --if-exists: docs/16', 'docs/16') }
    expect(over.workflowText).not.toBe(workflowText)
    expect(backupFindings({ ...BASE, ...over }).ok).toBe(true)
  })
})
