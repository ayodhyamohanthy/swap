/* backup-contract.mjs — docs/12 §5 + docs/16's backup contract, as pure
 * functions.
 *
 * WHY THIS EXISTS. `docs/12` §5 and `docs/16` name a nightly workflow, its
 * cron, its bucket, its retention and its alert, and build-plan item 3 asks for
 * the file. The workflow cannot be EXECUTED without six secrets that do not
 * exist yet, so nothing about it was checkable — and it was wrong in six ways,
 * all of which a reader would have passed over:
 *
 *   1. It sat at `workflows/seatswap-backup.yml`, not `.github/workflows/`.
 *      GitHub reads the latter only, so the nightly backup did not exist and
 *      nothing said so. Its own first line said "Copy to: .github/workflows/…"
 *      — the copy was the step that never happened.
 *   2. `pg_dump … | gzip > f` under plain `set -e`. The pipeline's status is
 *      gzip's, so a dump that died mid-stream exited 0 and shipped a truncated
 *      file as a good backup. (Measured: `false | gzip > f` exits 0 with `-e`,
 *      1 with `pipefail`.)
 *   3. The alert sent `Authorization: <token>`. ZeptoMail requires the literal
 *      prefix `Zoho-enczapikey` and answers 401 without it, so the one thing
 *      docs/16 promises — "email to ALERT_EMAIL on any failed run" — could
 *      never have fired.
 *   4. `curl -s … || true`: even with a correct token, a rejected send was
 *      swallowed.
 *   5. The only dump check was `stat -c%s f -gt 1024` on the COMPRESSED file.
 *      A dump that dies mid-stream leaves a complete, valid gzip well over
 *      1 KB, so that check passes exactly the failure it was written for.
 *   6. No `--clean --if-exists`, so docs/16's own quarterly drill (`gunzip -c
 *      dump.sql.gz | psql $STAGING_DB_URL`) stops on the first duplicate
 *      object in a staging project that already has the schema.
 *
 * WHY THIS IS A SEPARATE FILE, and why it has no imports. Same reason as
 * `lane-board.mjs`, `vendor-whitelist.mjs` and `bundle-budget.mjs`:
 * `collab-check.mjs` imports `node:child_process`, and docs/11 records what a
 * static `node:*` import cost under the jsdom pool when `translator-lib.mjs`
 * did it. A test cannot import the CLI, so anything worth testing lives where a
 * test can reach it. This module is strings in, findings out.
 *
 * THE DOCS ARE THE SOURCE OF TRUTH, not this file. The workflow name, cron,
 * bucket, retention and object key are PARSED from docs/12 §5 and docs/16 at
 * check time, and the secret set is parsed from docs/12 §8. Edit the ledger and
 * the guard follows with no edit here — which is also why a doc that stops
 * stating one of them is a FAILURE and not a silent skip: a guard that has gone
 * blind reads exactly like a guard that is satisfied.
 */

/** docs/12 §5's named workflow, when the docs cannot be read. Never used to pass. */
export const FALLBACK_WORKFLOW_NAME = 'seatswap-backup-prod'

/** The indentation of a line, counting each leading whitespace character once. */
function indentOf(line) {
  return line.length - line.trimStart().length
}

/** Cut a trailing `# …` comment, leaving `#` inside quotes and inside words. */
function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"') {
      quote = ch
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i)
    }
  }
  return line
}

/** `key: value`, for the plain keys this workflow uses. Null when there is none. */
function splitKeyValue(text) {
  const m = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:(?:\s+(.*))?$/.exec(text)
  if (!m) return null
  return { key: m[1], value: (m[2] ?? '').trim() }
}

/** `|`, `|-`, `>`, `>+2` … — a header whose value is a block on the next lines. */
function isBlockScalarHeader(value) {
  return /^[|>][-+]?\d*$/.test(value)
}

/**
 * Only the parts of a record that would EXECUTE. Comments are dropped, so no
 * check below can be satisfied by a sentence describing what the check wants.
 */
function codeOf(records) {
  return records.map((r) => r.code ?? '').join('\n')
}

/**
 * The script of each `run:` step, as its own string.
 *
 * This is the unit the dump and the alert have to be judged in, and finding it
 * took two wrong answers. Scoping to the whole file let the workflow's own
 * comments satisfy the checks. Scoping to a `seq`-delimited segment was worse:
 * a segment begins at every sequence item, so the `- cron:` item swallows the
 * entire job header — including `name: pg_dump seatswap-prod → R2` — and
 * `/pg_dump/` matched THAT, so the real dump step was never inspected and the
 * baseline went red while the mutation harness still reported every mutation
 * "caught". A harness whose baseline is red proves nothing.
 */
export function runBodies(records) {  const bodies = []
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.kind !== 'map' || r.key !== 'run') continue
    if (!isBlockScalarHeader(r.value)) {
      bodies.push({ line: r.line, text: r.value })
      continue
    }
    const lines = []
    let j = i + 1
    while (j < records.length && records[j].kind === 'block') {
      lines.push(records[j].code ?? '')
      j++
    }
    bodies.push({ line: r.line, text: lines.join('\n') })
    i = j - 1
  }
  return bodies
}

/**
 * The `run:` script that actually dumps. Null when there is none.
 *
 * The informational flags are excluded on purpose. The first version matched
 * `pg_dump\s+[\\"$'-]`, which is satisfied by the INSTALL step's
 * `pg_dump --version` — so the guard inspected the version check, found its
 * `pipefail`, and reported the dump's `gzip` and `--clean` missing while the
 * baseline was already red for the wrong reason. Same defect class as the rest
 * of this file's history: a check that names one thing and measures another.
 */
export function dumpBody(records) {
  return runBodies(records).find((b) => /pg_dump\s+(?!--?(?:version|help)\b|-V\b)/.test(b.text)) ?? null
}

/**
 * A deliberately narrow YAML reader: one flat record per line, no nesting.
 *
 * It handles exactly the shapes this workflow uses — `key: value`, `key:` plus
 * an indented block, `- item`, `- key: value`, and `|`/`>` block scalars — and
 * records ANYTHING ELSE as `unparsed`. That last part is the point: a reader
 * that silently skipped what it did not understand would report "no violations"
 * for a file it never read, so `backupFindings` fails on a non-empty `unparsed`
 * and the tests assert the shipped file has none.
 *
 * @returns {{ name: string, crons: string[], hasWorkflowDispatch: boolean,
 *   secretRefs: string[], failureGuards: number[], unparsed: object[],
 *   records: object[], segments: object[][] }}
 */
export function parseWorkflowSource(text) {
  const lines = String(text ?? '').split('\n')
  const records = []
  const unparsed = []
  let blockIndent = -1

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = i + 1
    if (blockIndent >= 0) {
      const indent = indentOf(raw)
      /* A block scalar runs until a non-blank line is indented no further than
         its key. Blank lines belong to the block. */
      if (raw.trim() === '' || indent > blockIndent) {
        /* A shell comment inside a block is still `text`, but never `code`.
           Mutation testing forced this field into existence: the checks below
           searched the whole file, and this file explains every flag it uses —
           so deleting `--clean` from the command left the comment that names
           it, and the guard stayed green. A guard satisfiable by its own
           documentation is not a guard. */
        records.push({ line, kind: 'block', indent, key: null, value: '', text: raw, code: raw.trim().startsWith('#') ? '' : raw })
        continue
      }
      blockIndent = -1
    }

    const body = stripComment(raw)
    if (body.trim() === '') {
      records.push({ line, kind: raw.trim() === '' ? 'blank' : 'comment', indent: indentOf(raw), key: null, value: '', text: raw, code: '' })
      continue
    }
    const indent = indentOf(raw)
    if (/\t/.test(raw.slice(0, indent))) {
      unparsed.push({ line, text: raw, why: 'tab in indentation' })
      records.push({ line, kind: 'unparsed', indent, key: null, value: '', text: raw, code: '' })
      continue
    }

    const trimmed = body.trim()
    const isSeq = trimmed === '-' || trimmed.startsWith('- ')
    const kv = splitKeyValue(isSeq ? trimmed.slice(1).trim() : trimmed)
    if (!kv) {
      unparsed.push({ line, text: raw, why: 'not a key: value, a sequence item or a block scalar body' })
      records.push({ line, kind: 'unparsed', indent, key: null, value: '', text: raw, code: '' })
      continue
    }
    records.push({ line, kind: isSeq ? 'seq' : 'map', indent, key: kv.key, value: kv.value, text: raw, code: body })
    if (!isSeq && isBlockScalarHeader(kv.value)) blockIndent = indent
  }

  /* Steps are sequence items, so a segment runs from one `- …` to the next.
     That is what lets the alert be checked as a unit — the guard must be on the
     step that sends the mail, not merely somewhere in the file. */
  const segments = []
  for (const r of records) {
    if (r.kind === 'seq') segments.push([])
    if (segments.length === 0) segments.push([])
    segments[segments.length - 1].push(r)
  }

  const nameRecord = records.find((r) => r.kind === 'map' && r.indent === 0 && r.key === 'name')
  const secretRefs = []
  for (const m of String(text ?? '').matchAll(/\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    if (!secretRefs.includes(m[1])) secretRefs.push(m[1])
  }

  return {
    name: nameRecord ? nameRecord.value.replace(/^['"]|['"]$/g, '') : '',
    crons: records.filter((r) => r.key === 'cron').map((r) => r.value.replace(/^['"]|['"]$/g, '')),
    hasWorkflowDispatch: records.some((r) => r.key === 'workflow_dispatch'),
    secretRefs,
    failureGuards: records.filter((r) => r.key === 'if' && /failure\(\)/.test(r.value)).map((r) => r.line),
    unparsed,
    records,
    segments,
  }
}

/** `ZEPTOMAIL_TOKEN (worker secret + …)` → `ZEPTOMAIL_TOKEN`; else null. */
function varName(cell) {
  const bare = cell.replace(/\s*\(.*\)\s*$/, '').trim()
  return /^[A-Z][A-Z0-9_]*$/.test(bare) ? bare : null
}

/**
 * docs/12 §8's env-var → vendor map, filtered to the rows it marks as GH
 * Actions secrets. Parsed rather than hardcoded so that adding a secret to the
 * ledger brings it under the check with no edit here.
 *
 * A row whose var cell cannot be read is reported instead of skipped: dropping
 * it would make the workflow's secret set look like it had an extra name, and
 * the operator would go and edit the wrong file.
 *
 * @returns {{ secrets: string[], unparsedCells: string[] }}
 */
export function parseGhActionSecrets(ledgerText) {
  const secrets = []
  const unparsedCells = []
  let inSection = false
  for (const line of String(ledgerText ?? '').split('\n')) {
    if (/^##\s/.test(line)) {
      inSection = /^##\s*§8\b/.test(line)
      continue
    }
    if (!inSection || !line.trimStart().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length !== 3) continue
    const [vars, readBy] = cells
    if (!/^[A-Za-z]/.test(vars)) continue
    if (!/GH Actions secret/i.test(readBy)) continue
    for (const part of vars.split('/')) {
      const name = varName(part)
      if (name) {
        if (!secrets.includes(name)) secrets.push(name)
      } else if (part.trim() !== '') {
        unparsedCells.push(part.trim())
      }
    }
  }
  return { secrets, unparsedCells }
}

/** `22:00` → `0 22 * * *`. The doc states a time; a cron states minute then hour. */
export function cronForUtcTime(utcTime) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(utcTime ?? '').trim())
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return `${minute} ${hour} * * *`
}

/**
 * docs/12 §4's env → project-ref table.
 *
 * A ref is only accepted when the cell is exactly 20 lowercase alphanumerics,
 * which is Supabase's ref shape. That is what makes the table's current
 * "— none yet" read as *absent* rather than as a ref, so the caller can tell
 * "not recorded yet" from "recorded and different" — the distinction the whole
 * staging-versus-prod check turns on.
 *
 * This lives here, and not in `awk` inside the workflow, because the first
 * version WAS awk inside the workflow: untestable from the suite, and silent
 * the day the table's column order changes. The workflow now shells out to
 * `scripts/backup-ref.mjs`, which calls this.
 *
 * @returns {{ prod: string|null, staging: string|null }}
 */
export function parseEnvRefTable(ledgerText) {
  const refs = { prod: null, staging: null }
  let inSection = false
  for (const line of String(ledgerText ?? '').split('\n')) {
    if (/^##\s/.test(line)) {
      inSection = /^##\s*§4\b/.test(line)
      continue
    }
    if (!inSection || !line.trimStart().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length !== 4) continue
    const env = cells[0]
    if (env !== 'prod' && env !== 'staging') continue
    if (/^[a-z0-9]{20}$/.test(cells[2])) refs[env] = cells[2]
  }
  return refs
}

const CONTRACT_FIELDS = [
  ['workflowName', 'the workflow name'],
  ['filePath', 'the workflow file path'],
  ['cronUtc', 'the cron time in UTC'],
  ['bucket', 'the R2 bucket'],
  ['retentionDays', 'the retention period in days'],
  ['retentionDaysExit', "docs/16's retention period"],
  ['keyTemplate', 'the object key template'],
]

/**
 * The contract as docs/12 §5 and docs/16 state it. Every field is null when the
 * docs no longer say it, and `backupFindings` turns that into a failure.
 *
 * @returns {Record<string, string|number|null>}
 */
export function parseBackupContract(ledgerText, exitText) {
  const ledger = String(ledgerText ?? '')
  const exit = String(exitText ?? '')
  const pick = (re, src) => {
    const m = re.exec(src)
    return m ? m[1] : null
  }
  const retention = pick(/(\d+)-day retention/, ledger)
  /* docs/16 states the retention a second time, and a number written in two
     places is how the two places come to disagree. The workflow cannot check
     the R2 lifecycle rule — that lives in the Cloudflare dashboard — so this
     cross-check is the only machine-checkable half of docs/12 §5's retention
     clause. */
  const retentionExit = pick(/Retention: (\d+) days/, exit)
  return {
    workflowName: pick(/Nightly GitHub Actions workflow `([^`]+)`/, ledger),
    filePath: pick(/\((\.[^)\s]*seatswap-backup\.yml)/, ledger),
    cronUtc: pick(/cron (\d{1,2}:\d{2}) UTC/, ledger),
    bucket: pick(/R2 bucket ([A-Za-z0-9._-]+)/, ledger),
    retentionDays: retention === null ? null : Number(retention),
    retentionDaysExit: retentionExit === null ? null : Number(retentionExit),
    keyTemplate: pick(/(seatswap-\d{4}-\d{2}-\d{2}\.sql\.gz|seatswap-YYYY-MM-DD\.sql\.gz)/, exit),
  }
}

/**
 * Every finding, with the docs and the workflow cross-checked against each
 * other. `problems` blocks; `humanSteps` is what no file in this repo can do —
 * it is reported rather than hidden, because "the check passed" and "the check
 * only covers the half a machine can see" are different facts.
 *
 * @returns {{ ok: boolean, problems: string[], humanSteps: string[], facts: object }}
 */
export function backupFindings(input) {
  const workflowText = String(input?.workflowText ?? '')
  const ledgerText = String(input?.ledgerText ?? '')
  const exitText = String(input?.exitText ?? '')
  const problems = []
  const humanSteps = []

  const doc = parseBackupContract(ledgerText, exitText)
  for (const [field, label] of CONTRACT_FIELDS) {
    if (doc[field] === null || doc[field] === undefined) {
      problems.push(`docs/12 §5 / docs/16 no longer states ${label} — this check reads the docs, so it is blind until that is restored`)
    }
  }
  if (doc.retentionDays !== null && doc.retentionDaysExit !== null && doc.retentionDays !== doc.retentionDaysExit) {
    problems.push(`docs/12 §5 says ${doc.retentionDays}-day retention and docs/16 says ${doc.retentionDaysExit} — the R2 lifecycle rule can only delete at one age`)
  }

  const wf = parseWorkflowSource(workflowText)
  const ledger = parseGhActionSecrets(ledgerText)
  /* Everything that would execute, comments removed. */
  const allCode = codeOf(wf.records)

  /* The reader must not have skipped anything, or every check below is a claim
     about a file it did not fully read. */
  for (const u of wf.unparsed) {
    problems.push(`seatswap-backup.yml:${u.line} was not understood (${u.why}): ${u.text.trim()}`)
  }
  for (const cell of ledger.unparsedCells) {
    problems.push(`docs/12 §8 marks a row as a GH Actions secret but its var cell "${cell}" is not a var name`)
  }
  if (ledger.secrets.length === 0) {
    problems.push('parsed 0 GH Actions secrets from docs/12 §8 — the ledger format changed, so the secret check is blind')
  }

  if (doc.workflowName && wf.name !== doc.workflowName) {
    problems.push(`the workflow calls itself "${wf.name}"; docs/12 §5 names it "${doc.workflowName}"`)
  }

  const expectedCron = doc.cronUtc ? cronForUtcTime(doc.cronUtc) : null
  if (expectedCron && !wf.crons.includes(expectedCron)) {
    problems.push(`docs/12 §5 says ${doc.cronUtc} UTC (${expectedCron}); the workflow's crons are ${wf.crons.join(', ') || 'none'}`)
  }
  if (!wf.hasWorkflowDispatch) {
    problems.push('no workflow_dispatch — docs/10 item 3 asks for one manual run, and docs/16\'s quarterly drill needs to trigger it')
  }

  /* The alert, as a unit. docs/16: "ZeptoMail email to ALERT_EMAIL on any
     failed run." */
  if (wf.failureGuards.length === 0) {
    problems.push('no step is guarded by `if: failure()` — docs/16 requires an alert on any failed run')
  }
  if (wf.failureGuards.length > 1) {
    problems.push(`${wf.failureGuards.length} steps are guarded by \`if: failure()\` (lines ${wf.failureGuards.join(', ')}); exactly one should send the alert`)
  }
  const alertSegment = wf.segments.find((seg) => seg.some((r) => r.key === 'if' && /failure\(\)/.test(r.value)))
  /* The alert's own script, falling back to the whole step so that an alert
     which sends the mail some other way is still judged rather than skipped. */
  const alertBody = alertSegment ? (runBodies(alertSegment)[0]?.text ?? codeOf(alertSegment)) : ''
  if (wf.failureGuards.length > 0 && !/zeptomail/i.test(alertBody)) {
    problems.push('the `if: failure()` step does not call ZeptoMail')
  }
  /* The header, not the word: this step's own comment quotes the scheme name,
     and matching that instead would let the real header rot. */
  if (wf.failureGuards.length > 0 && !/Authorization:\s*Zoho-enczapikey/.test(alertBody)) {
    problems.push('the alert omits the `Zoho-enczapikey` prefix on Authorization — ZeptoMail answers 401 to a bare token, so the alert cannot deliver')
  }
  /* Without `-f`, a 401 exits 0 and the alert reads as delivered. */
  if (wf.failureGuards.length > 0 && !/curl[^\n]*\s-[A-Za-z]*f[A-Za-z]*\b/.test(alertBody)) {
    problems.push('the alert\'s curl has no `-f` — a rejected send would exit 0 and read as a delivered notice')
  }
  for (const needed of ['ZEPTOMAIL_TOKEN', 'ALERT_EMAIL']) {
    if (wf.failureGuards.length > 0 && !alertBody.includes(needed)) {
      problems.push(`the alert does not use ${needed}`)
    }
  }
  /* `|| true` after the send is how a rejected send becomes a silent success.
     Checked across the whole step, not one line, because the continuation is
     usually on a different line from `curl`. */
  if (/\|\|\s*true/.test(alertBody)) {
    problems.push('the alert swallows its own failure with `|| true` — an auth failure would read as a delivered notice')
  }

  /* The secret set, both directions. An extra name is a secret docs/12 §8 does
     not know about; a missing one is a clause of §5 that cannot run. */
  const used = wf.secretRefs
  for (const name of used) {
    if (!ledger.secrets.includes(name)) {
      problems.push(`the workflow uses secret ${name}, which docs/12 §8 does not list as a GH Actions secret`)
    }
  }
  for (const name of ledger.secrets) {
    if (!used.includes(name)) {
      problems.push(`docs/12 §8 lists ${name} as a GH Actions secret, but the workflow never uses it`)
    }
  }
  if (/\bVITE_/.test(allCode)) {
    problems.push('the workflow names a VITE_-prefixed var — docs/12 §8 reserves those for the client bundle, and this job is server-side')
  }

  /* docs/16 §Never: "Never disable the backup workflow to save minutes." */
  if (/^\s*if:\s*false\s*$/m.test(allCode)) {
    problems.push('a step is disabled with `if: false` — docs/16 §Never forbids disabling the backup workflow')
  }

  /* The dump itself. Each of these is a defect the handoff file shipped. All
     of them are scoped to the pg_dump step and read `code`, so neither a
     neighbouring step nor this file's own explanatory comment can satisfy
     them. */
  const dump = dumpBody(wf.records)
  const dumpCode = dump ? dump.text : ''
  if (!dump) {
    problems.push('no `run:` step invokes pg_dump — this is the backup')
  } else {
    if (!/pipefail/.test(dumpCode)) {
      problems.push('the pg_dump step has no `pipefail` — `pg_dump | gzip > f` then exits with gzip\'s status, so a dump that died mid-stream is uploaded as a good one')
    }
    if (!/gzip/.test(dumpCode)) problems.push('the pg_dump step does not gzip — docs/12 §5 asks for a gzipped dump')
    for (const flag of ['--no-owner', '--no-privileges', '--clean', '--if-exists']) {
      if (!dumpCode.includes(flag)) {
        problems.push(`the dump omits ${flag} — docs/16's quarterly drill restores into seatswap-staging, which already has the schema`)
      }
    }
  }
  if (doc.bucket && !allCode.includes(doc.bucket)) {
    problems.push(`the workflow never names the bucket ${doc.bucket} that docs/12 §5 records`)
  }
  if (!/\.sql\.gz/.test(allCode)) {
    problems.push(`no \`.sql.gz\` object key — docs/16 names the key as ${doc.keyTemplate ?? 'seatswap-YYYY-MM-DD.sql.gz'}`)
  }
  if (!/%F/.test(allCode)) {
    problems.push('no `%F` date stamp — docs/16\'s key is date-stamped, so a run with no date would overwrite the same object every night')
  }

  /* A committed credential. The workflow is a public artefact the moment the
     repo is; docs/16 §Never says never commit SUPABASE_DB_URL or R2 keys. */
  if (/(postgres|postgresql):\/\/[^\s"'$]/.test(allCode)) {
    problems.push('a literal postgres:// URL is committed — docs/16 §Never: GH Actions secrets only')
  }
  if (/\bAKIA[0-9A-Z]{16}\b/.test(allCode)) {
    problems.push('a literal AWS access key id is committed')
  }
  for (const name of ledger.secrets) {
    if (new RegExp(`^\\s*${name}\\s*:\\s*(?!\\$\\{\\{)[^\\s#]`, 'm').test(allCode)) {
      problems.push(`${name} is assigned a literal value in the workflow instead of \`\${{ secrets.${name} }}\``)
    }
  }

  /* The half no file here can do. Reported, never assumed. */
  humanSteps.push(`add these six repo secrets (Settings → Secrets and variables → Actions): ${ledger.secrets.join(', ')}`)
  if (doc.bucket && doc.retentionDays) {
    humanSteps.push(`set the R2 lifecycle rule on ${doc.bucket}: delete after ${doc.retentionDays} days (CF dashboard → bucket → Settings → Object lifecycle)`)
  }
  humanSteps.push('enable GitHub\'s own workflow-failure notification (docs/16) — it is the backstop until the ZeptoMail sender domain is real')
  humanSteps.push('verify one workflow_dispatch run end to end (docs/10 item 3)')
  humanSteps.push('GitHub disables a scheduled workflow after 60 days with no repo activity — if this repo goes quiet, re-enable it')
  const from = /^\s*ALERT_FROM:\s*(\S+)/m.exec(workflowText)
  if (from && /\.(invalid|example|test)$/.test(from[1])) {
    humanSteps.push(`the alert sender is still the placeholder ${from[1]} — ZeptoMail rejects an unverified domain, and the sending domain is build-plan item 4`)
  }

  return {
    ok: problems.length === 0,
    problems,
    humanSteps,
    facts: {
      workflowName: wf.name,
      crons: wf.crons,
      expectedCron,
      secretRefs: used,
      ledgerSecrets: ledger.secrets,
      doc,
      unparsedLines: wf.unparsed.length,
      dumpCodeChars: dumpCode.length,
    },
  }
}
