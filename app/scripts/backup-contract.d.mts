/* Types for `scripts/backup-contract.mjs`, so `tests/backup-contract.test.ts`
 * can import it under `tsc`.
 *
 * Same reason as `lane-board.d.mts`, `vendor-whitelist.d.mts` and
 * `bundle-budget.d.mts`: without this, TS cannot read the `.mjs` and every call
 * site is an implicit `any`. The shapes are transcribed from the implementation
 * and the tests are the real check — a signature that drifted would fail there.
 */

/** docs/12 §5's named workflow. Used only for the failure message. */
export const FALLBACK_WORKFLOW_NAME: string

/** One line of the workflow, classified. `code` has any comment removed. */
export interface WorkflowRecord {
  line: number
  kind: 'blank' | 'comment' | 'map' | 'seq' | 'block' | 'unparsed'
  indent: number
  key: string | null
  value: string
  /** The line as written, comments included. */
  text: string
  /** The line as it would execute. Empty for anything that is only a comment. */
  code: string
}

/** A line the reader refused to guess at. Any of these fails the check. */
export interface UnparsedLine {
  line: number
  text: string
  why: string
}

export interface WorkflowSource {
  name: string
  crons: string[]
  hasWorkflowDispatch: boolean
  secretRefs: string[]
  /** Line numbers of every `if: failure()` guard. */
  failureGuards: number[]
  unparsed: UnparsedLine[]
  records: WorkflowRecord[]
  /** Records grouped at each sequence item, so a step can be judged as a unit. */
  segments: WorkflowRecord[][]
}

export function parseWorkflowSource(text: string): WorkflowSource

/** The script of each `run:` step. */
export function runBodies(records: WorkflowRecord[]): { line: number; text: string }[]

/** The `run:` script that dumps, excluding the informational flags. */
export function dumpBody(records: WorkflowRecord[]): { line: number; text: string } | null

/** docs/12 §8's GH-Actions-secret rows only. */
export function parseGhActionSecrets(ledgerText: string): {
  secrets: string[]
  unparsedCells: string[]
}

/** `22:00` → `0 22 * * *`. Null for anything that is not a time. */
export function cronForUtcTime(utcTime: string): string | null

/** docs/12 §4's env → project-ref table. Null means "not recorded yet". */
export function parseEnvRefTable(ledgerText: string): {
  prod: string | null
  staging: string | null
}

export interface BackupContract {
  workflowName: string | null
  filePath: string | null
  cronUtc: string | null
  bucket: string | null
  retentionDays: number | null
  /** The same number as docs/16 states it, for the cross-check. */
  retentionDaysExit: number | null
  keyTemplate: string | null
}

export function parseBackupContract(ledgerText: string, exitText: string): BackupContract

export interface BackupFindings {
  ok: boolean
  problems: string[]
  /** What only a human can do. Reported, never assumed. */
  humanSteps: string[]
  facts: {
    workflowName: string
    crons: string[]
    expectedCron: string | null
    secretRefs: string[]
    ledgerSecrets: string[]
    doc: BackupContract
    unparsedLines: number
    dumpCodeChars: number
  }
}

export function backupFindings(input: {
  workflowText?: string
  ledgerText?: string
  exitText?: string
}): BackupFindings
