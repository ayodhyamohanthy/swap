/* Types for `scripts/domain-lib.mjs`, so `tests/domain-lib.test.ts` can import
 * it under `tsc`.
 *
 * Same reason as `lane-board.d.mts`, `vendor-whitelist.d.mts` and
 * `staging-lib.d.mts`: the alternative is `allowJs`/`checkJs`, which would let
 * TS read the module's JSDoc but would leave every untyped parameter an
 * implicit `any` — the `TS7006` those files exist to prevent. Declaring the
 * signatures fixes it at the source.
 *
 * The shapes are transcribed from the implementation, and the tests are the
 * real check: they exercise each signature against fixtures, so a declaration
 * that drifted from the implementation fails there rather than here.
 */

/** One row of the docs/12 §4.1 key/value table, plus whether §4.1 was found. */
export interface DomainLedger {
  found: boolean
  domain: string
  status: string
  /** `NaN` when the row is absent or non-numeric — never defaulted. */
  ttl: number
  zoneMustBeOn: string
  servingNow: string
}

/** One row of the §4.1 record table. */
export interface RequiredRecord {
  name: string
  type: string
  value: string
}

/** One row of the §4.1 path table. `kind` is verbatim, so an invented kind
 *  reaches `driftFindings` instead of being silently dropped here. */
export interface DomainPath {
  path: string
  kind: string
}

/** One row of the §4.1 exclusion table: a file allowed to keep the old name. */
export interface DomainExclusion {
  path: string
  why: string
}

/** One file a whole-repo scan found naming the domain, and how often. */
export interface Mention {
  path: string
  count: number
}

/** One `routes` entry in a wrangler config, commented ones included. */
export interface WranglerRoute {
  pattern: string | null
  zoneName: string | null
  commented: boolean
}

/** A file the drift check reads. `text` is `null` when it could not be read. */
export interface DriftFile {
  path: string
  kind: string
  text: string | null
}

/** A disagreement with the canonical domain. */
export interface DriftFinding {
  path: string
  kind: string
  /** `mismatch` | `missing` | `unreadable` | `unknown-kind` | `unknown-config` */
  problem: string
  found: string[]
}

/** Where a zone's nameservers point. `mixed` is mid-migration. */
export type NameserverClass = 'on-provider' | 'elsewhere' | 'mixed' | 'none'

/** What a DNS lookup returned for one record name. */
export interface ResolvedRecord {
  name: string
  addresses: string[]
  /** `null` when TTL could not be read (Node's resolver never exposes it). */
  ttl: number | null
}

/** A required record that is absent, or present with the wrong TTL. */
export interface RecordFinding {
  name: string
  /** `absent` | `ttl-too-high` | `ttl-unverified` */
  problem: string
  ttl: number | null
}

/** Every measurement the verdict needs, so the reasoning stays testable. */
export interface VerdictInput {
  ledger: DomainLedger | null
  drift: DriftFinding[]
  ns: NameserverClass
  /** What the DNS lookups found wrong, already compared against the ledger. */
  records: RecordFinding[]
  routes: WranglerRoute[]
  offline: boolean
  /** The ledger's own record table — an empty one is a blocker, not a pass. */
  requiredRecords: RequiredRecord[]
  /** The ledger's own path table — an empty one is a blocker, not a pass. */
  listedPaths: DomainPath[]
  /** Scan hits that are in neither §4.1 table — each is a blocker. */
  unlisted: Mention[]
  /** How many files the scan read. Zero means the check is blind, not clean. */
  scanned: number
}

/** Whether the domain can be attached, and who owes what. */
export interface Verdict {
  /** `unmeasured` when offline: absence of blockers is not evidence. */
  attachable: 'yes' | 'no' | 'unmeasured'
  blockers: string[]
  notes: string[]
  next: string[]
}

/** Lowercase, trimmed, no trailing root dot. */
export function normaliseHost(name: string): string

/** True when `host` is `domain` itself or sits under it. */
export function isSameOrSubdomain(host: string, domain: string): boolean

/** The §4.1 key/value table. */
export function parseDomainLedger(docs12Text: string): DomainLedger

/** The §4.1 record table. */
export function parseRequiredRecords(docs12Text: string): RequiredRecord[]

/** The §4.1 path table, kinds unfiltered. */
export function parseDomainPaths(docs12Text: string): DomainPath[]

/** The §4.1 exclusion table: files allowed to keep naming the old domain. */
export function parseDomainExclusions(docs12Text: string): DomainExclusion[]

/** The domain a `CNAME` file declares, or `null` when it declares none. */
export function cnameDomain(text: string): string | null

/** Every `routes` entry in a wrangler config, commented ones included. */
export function wranglerRoutes(text: string): WranglerRoute[]

/** The domains a config file declares, or `null` for a shape not recognised —
 *  which is not the same as `[]` and must be reported, not passed. */
export function domainsDeclaredBy(path: string, text: string): string[] | null

/** Every listed file that disagrees with the canonical domain. */
export function driftFindings(canonical: string, files: DriftFile[]): DriftFinding[]

/** A repo-relative path, comparable to another one. */
export function normalisePath(path: string): string

/** Scan hits that appear in neither §4.1 table — the ledger is incomplete. */
export function unlistedMentions(
  domain: string,
  mentions: Mention[],
  listed: DomainPath[],
  excluded: DomainExclusion[],
): Mention[]

/** Where the nameservers point, relative to the required provider. */
export function classifyNameservers(nsHosts: string[], provider: string): NameserverClass

/** The ledger's records compared against what DNS returned. */
export function recordFindings(
  records: RequiredRecord[],
  resolved: ResolvedRecord[],
  ttl: number,
): RecordFinding[]

/** Whether the custom domain can be attached, and what is owed by whom. */
export function attachVerdict(input: VerdictInput): Verdict
