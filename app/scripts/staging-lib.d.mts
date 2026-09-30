/* Types for `scripts/staging-lib.mjs`, so `tests/staging-lib.test.ts` can import
 * it under `tsc`.
 *
 * Same reason as `vendor-whitelist.d.mts` and `lane-board.d.mts`: the alternative
 * is `allowJs`/`checkJs`, which would leave every callback parameter an implicit
 * `any` — the `TS7006` these files exist to prevent. The `.mjs` itself stays
 * outside `tsconfig.include`, and it imports nothing, which is what keeps it
 * importable from a jsdom test (docs/11 records what `node:fs` cost last time).
 *
 * The shapes are transcribed from the implementation; the tests are the real
 * check, because they exercise each signature against fixtures and against the
 * repo's own schema, so a declaration that drifted fails there rather than here.
 */

/** One CREATE or DROP, positioned so the two can be walked in source order. */
export interface ObjectStatement {
  op: 'create' | 'drop'
  kind: string
  /** `<kind>:<name>`, scoped to the table for policies and triggers. */
  id: string
  /** True for `IF NOT EXISTS` / `OR REPLACE`, which a re-apply survives. */
  idempotent: boolean
  at: number
}

/** An object a script creates — `ObjectStatement` without the drop or position. */
export interface CreatedObject {
  kind: string
  id: string
  idempotent: boolean
}

/** A SQL file, as the mirror checks see it. */
export interface SqlFile {
  file: string
  sql: string
}

/** An object created twice while still live. */
export interface Duplicate {
  id: string
  file: string
  firstFile: string
}

export interface MigrationOrder {
  ordered: { file: string; stamp: string }[]
  /** Names that are not `<14-digit timestamp>_<slug>.sql`. */
  malformed: string[]
  /** Timestamps shared by two or more migrations, whose order is undefined. */
  duplicateStamps: string[]
}

export interface MirrorFinding {
  code: string
  /** True when a fresh apply would fail or build the wrong database. */
  blocking: boolean
  detail: string
}

export interface MirrorVerdict {
  ok: boolean
  findings: MirrorFinding[]
}

/** A project ref recorded in docs/12 §4 — `null` until the project exists. */
export interface ProjectRef {
  project: string
  ref: string | null
}

export interface ProjectRefs {
  staging: ProjectRef
  prod: ProjectRef
}

export interface UrlFinding {
  host: string
  kind: 'staging' | 'prod' | 'placeholder' | 'unknown'
  allowed: boolean
}

export interface TargetVerdict {
  ok: boolean
  target: 'none' | 'staging' | 'prod'
  reason: string
}

/** The object kinds `createdObjects` knows how to identify. */
export const KNOWN_OBJECT_KINDS: string[]

/** Hosts that are documentation placeholders rather than projects. */
export const PLACEHOLDER_HOSTS: string[]

/** Block and `--` line comments removed, so prose cannot be read as DDL. */
export function stripSqlComments(sql: string): string

/** CREATE kinds present in the SQL that `createdObjects` does not handle. */
export function unrecognisedCreateKinds(sql: string): string[]

/** Every CREATE and DROP naming an object, in source order. */
export function objectStatements(sql: string): ObjectStatement[]

/** The objects a script creates — `objectStatements` without the drops. */
export function createdObjects(sql: string): CreatedObject[]

/** Objects created twice while still live, across files in apply order. */
export function duplicateCreates(files: SqlFile[]): Duplicate[]

/** Migration filenames in apply order, with the names that have no order. */
export function orderMigrations(names: string[]): MigrationOrder

/** Does the migration set still mirror the released schema? */
export function mirrorFindings(input: {
  migrations: SqlFile[]
  canonical: SqlFile | null
  parts?: SqlFile[]
  stray?: SqlFile[]
}): MirrorVerdict

/** Supabase project refs recorded in the docs/12 §4 table. */
export function parseProjectRefs(docsText: string): ProjectRefs

/** Classify every Supabase project URL in a text. */
export function supabaseUrlFindings(
  text: string,
  refs: ProjectRefs,
  options?: { allowProd?: boolean },
): UrlFinding[]

/** Which project an agent's env points at; staging unless prod is explicit. */
export function resolveSupabaseTarget(input?: {
  url?: string
  refs?: ProjectRefs
  allowProd?: boolean
}): TargetVerdict
