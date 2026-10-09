/* Types for `scripts/lane-board.mjs`, so `tests/collab-check.test.ts` can import
 * it under `tsc`.
 *
 * WHY A `.d.mts` AND NOT `allowJs`. The alternative is to turn on `allowJs` /
 * `checkJs` in `tsconfig.json` and let TS read the module's own JSDoc — but
 * only one of its six exports is annotated, so the other five would still be
 * `any`, and the three `TS7006` errors on `(c) => c.id` would remain. This file
 * declares all six, which fixes the errors at their source rather than papering
 * over them with callback annotations at each call site.
 *
 * The shapes are transcribed from the implementation, not guessed: the JSDoc on
 * `parseActiveLanes` states `{ id, holder }`, `parseSurfaces` states
 * `{ id, surfaces }`, and the rest are read off the returns. The tests are the
 * real check — `tests/collab-check.test.ts` exercises all six against board
 * fixtures, so a signature that drifted from the implementation would fail
 * there rather than here.
 */

/** One claimed lane: the id from the board, and the agent holding the claim. */
export interface ActiveLane {
  id: string
  holder: string
}

/** One lane from the ownership map, with the glob surfaces it owns. */
export interface LaneSurface {
  id: string
  surfaces: string[]
}

/** What the committer claims to own, e.g. from a CLI flag or env var. */
export interface LaneDeclaration {
  lane?: string
  agent?: string
}

/** Lane rows in `docs/14-LANES.md` whose state cell begins with `active:`. */
export function parseActiveLanes(boardText: string): ActiveLane[]

/** True when `declaration` names this lane, so its files are not a clash. */
export function declaredBy(
  declaration: LaneDeclaration,
  lane: ActiveLane | LaneSurface,
): boolean

/** Glob (`**` spans directories, `*` stops at one) as a RegExp. */
export function globToRegExp(glob: string): RegExp

/** True when `file` is covered by a lane's surface glob. */
export function ownedByLane(file: string, surface: string): boolean

/** Lane rows from `docs/13-COLLAB-CONTRACT.md` §1, restricted to `ids`. */
export function parseSurfaces(contractText: string, ids: string[]): LaneSurface[]

/** `file -> lane (surface)` for every staged file on someone else's lane. */
export function clashesFor(
  files: string[],
  lanes: LaneSurface[],
  declaration?: LaneDeclaration,
): string[]

/** One docs/12 §2 ledger row: vendor name and WIRED/RESERVE/BENCH/UNCLAIMED/PARTIAL. */
export interface VendorRow {
  vendor: string
  status: string
}

/** npm package fragments for vendors that must never ship (docs/12 §2 is the source of truth for statuses). */
export const VENDOR_PACKAGES: Record<string, string[]>

/** Ledger vendors that are programs, not shippable SDKs. */
export const NON_PACKAGE_VENDORS: string[]

/**
 * docs/12 §2 vendor ledger rows. `unknown` holds `vendor: status` pairs with
 * a status this guard does not understand — reported, never defaulted.
 */
export function parseVendorLedger(ledgerText: string): {
  rows: VendorRow[]
  unknown: string[]
}

/** Non-WIRED ledger vendors found in deps/imports, plus unmapped vendors. */
export function vendorViolations(
  ledgerText: string,
  depNames: string[],
  importSources: string[],
): {
  violations: string[]
  uncovered: string[]
}
