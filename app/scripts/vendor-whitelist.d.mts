/* Types for `scripts/vendor-whitelist.mjs`, so `tests/vendor-whitelist.test.ts`
 * can import it under `tsc`.
 *
 * Same reason as `lane-board.d.mts`: the alternative is `allowJs`/`checkJs`,
 * which would let TS read the module's JSDoc but would leave the `findings`
 * parameter of `findBanned` as an implicit `any` — the `TS7006` that this file
 * exists to prevent. Declaring the four signatures fixes that at its source.
 *
 * The shapes are transcribed from the implementation, and the tests are the
 * real check: they exercise all four against fixtures, so a signature that
 * drifted from the implementation fails there rather than here.
 */

/** One row of the docs/12 §2 ledger: the vendor, and its status verbatim. */
export interface Vendor {
  name: string
  status: string
}

/** A finding: an entry that names a vendor whose status is not `WIRED`. */
export interface BannedEntry {
  pkg: string
  vendor: string
  status: string
}

/** Lowercase, letters and digits only, so scopes and dashes do not matter. */
export function normalise(name: string): string

/** Vendor rows parsed from the docs/12 §2 ledger table. */
export function parseVendorLedger(ledgerText: string): Vendor[]

/** The vendor a package name belongs to, or `null` when it names none. */
export function vendorFor(packageName: string, vendors: Vendor[]): Vendor | null

/** Every entry naming a vendor whose status is not `WIRED`, sorted by entry. */
export function findBanned(findings: string[], vendors: Vendor[]): BannedEntry[]

/** Bare module specifiers in a source file; relative paths are dropped. */
export function importSpecifiers(sourceText: string): string[]
