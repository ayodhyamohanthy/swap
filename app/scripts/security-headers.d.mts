/* Types for `scripts/security-headers.mjs`, so `tests/security-headers.test.ts`
 * can import it under `tsc`.
 *
 * Same reason as `lane-board.d.mts`, `vendor-whitelist.d.mts`,
 * `backup-contract.d.mts` and `bundle-budget.d.mts`: without this, TS cannot
 * read the `.mjs` and every call site is an implicit `any`. The shapes are
 * transcribed from the implementation and the tests are the real check — a
 * signature that drifted would fail there.
 */

/** docs/16 §9.3's required list. Every block in `_headers` must carry all of
    these, in this order. */
export const SECURITY_HEADERS: string[]

/** CSP directives whose VALUE is a requirement, not just presence:
    `object-src` falls back to `default-src` if absent, but must be `'none'`
    when present. */
export const REQUIRED_CSP_VALUES: Record<string, string[]>

/** CSP directives that must exist by name. */
export const REQUIRED_CSP_DIRECTIVES: string[]

/** One external origin a shipped code path loads, and the file that needs it. */
export interface RequiredOrigin {
  /** Scheme + host, possibly with a `*` label. */
  origin: string
  /** The CSP directive that must permit it. */
  directive: string
  /** Repo-relative path under `app/` of the shipped source that loads it. */
  file: string
}

export const REQUIRED_ORIGINS: RequiredOrigin[]

/** One `_headers` block: a path pattern plus its headers, keyed lowercased. */
export interface HeaderBlock {
  path: string
  headers: Record<string, string>
}

/** `<script>` blocks in `html` with no `src` — the blocks `'unsafe-inline'`
    exists to permit. Zero means the shell could drop it. */
export function inlineScriptCount(html: string): number

/** Blocks in file order. Comments are dropped, so a `#`-commented path is not
    a rule and a `#`-commented header is not present. */
export function parseHeaderBlocks(text: string): HeaderBlock[]

/** `default-src 'self'; script-src a b` → `{ 'default-src': ["'self'"], … }`. */
export function parseCsp(value: string): Record<string, string[]>

/** `"<directive> <origin>"` keys in `REQUIRED_ORIGINS` the policy does not
    permit. Empty means every real vendor is reachable. */
export function missingOrigins(directives: Record<string, string[]>): string[]

/** `"<directive> <origin>"` keys the policy permits that nothing explains. */
export function unexplainedOrigins(directives: Record<string, string[]>): string[]

/** Everything wrong with a parsed file, as human-readable strings.
    Empty array = shippable. */
export function headerBlockProblems(blocks: HeaderBlock[]): string[]
