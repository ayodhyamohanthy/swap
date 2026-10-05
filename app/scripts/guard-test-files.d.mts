/* Types for `scripts/guard-test-files.mjs`, so `tests/guard-test-files.test.ts`
 * can import it under `tsc`.
 *
 * WHY A `.d.mts` AND NOT `allowJs`. Same reason as the other six in this
 * directory (see `lane-board.d.mts`): turning on `allowJs`/`checkJs` would
 * still leave the JSDoc-less exports as `any`, and the fix belongs at the
 * source — one declaration file — rather than as annotations at each call
 * site. The shapes are transcribed from the implementation; the tests exercise
 * them against fixtures and the real directory, so drift fails there.
 */

/** A parsed vitest default-reporter summary line. */
export interface VitestSummary {
  found: boolean;
  /** The run's own file total (the parenthesized number). */
  files: number;
  /** The leading counts, which must sum to `files`. */
  parts: [number, number];
  verdict: 'passed' | 'failed' | null;
}

export interface FileCountVerdict {
  ok: boolean;
  reason: string;
}

export function parseVitestSummary(logText: string): VitestSummary;
export function countTestFiles(names: string[]): number;
export function checkFileCount(
  summary: VitestSummary,
  actualFiles: number,
): FileCountVerdict;
