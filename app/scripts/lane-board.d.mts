/* Types for `scripts/lane-board.mjs`, so `tests/collab-check.test.ts` can import
 * it under `tsc`.
 *
 * WHY A `.d.mts` AND NOT `allowJs`. The alternative is to turn on `allowJs` /
 * `checkJs` in `tsconfig.json` and let TS read the module's own JSDoc — but
 * only some of its exports are annotated, so the rest would still be
 * `any`, and the three `TS7006` errors on `(c) => c.id` would remain. This file
 * declares every export, which fixes the errors at their source rather than
 * papering over them with callback annotations at each call site.
 * over them with callback annotations at each call site.
 *
 * The shapes are transcribed from the implementation, not guessed: the JSDoc on
 * `parseActiveLanes` states `{ id, holder }`, `parseSurfaces` states
 * `{ id, surfaces }`, and the rest are read off the returns. The tests are the
 * real check — `tests/collab-check.test.ts` exercises them against board
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

/** Surfaces matching no file in `files`, so they protect nothing. */
export function deadSurfaces(
  lanes: LaneSurface[],
  files: string[],
): Array<{ id: string; surface: string }>

/** `file -> lane (surface)` for every staged file on someone else's lane. */
export function clashesFor(
  files: string[],
  lanes: LaneSurface[],
  declaration?: LaneDeclaration,
): string[]

/** Leaf paths of a locale catalogue, as `{ 'share.message': '…' }`. */
export function localeLeaves(
  value: unknown,
  prefix?: string,
  out?: Record<string, unknown>,
): Record<string, unknown>

/** A parsed catalogue, or the reason it could not be read. */
export function parseCatalogue(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string }

/** Leaf keys added, removed or changed between two catalogues, sorted. */
export function localeTouched(head: object, staged: object): string[]

/** Whether a staged edit stays inside the committer's declared namespace. */
export function localeNamespaceVerdict(args?: {
  touched?: string[]
  declared?: string
}): {
  applicable: boolean
  ok: boolean
  prefixes: string[]
  outside: string[]
  reason: string
}
