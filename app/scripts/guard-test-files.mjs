/* Unit file-count guard (docs/14 backlog 16).
 *
 * WHY THIS EXISTS. `npm run test` can report "Test Files 51 passed (51)" while
 * 21 of the 72 files never started at all — every one `Failed to start forks
 * worker … Timeout waiting for worker to respond`. Zero failures, a green
 * summary, 71% coverage — and the file carrying the repo's only known failures
 * was among the 21, so the incomplete run looked BETTER than a complete one.
 * The direction of the error is what makes it nasty: missing files do not fail,
 * they vanish. `vitest.config.ts` carries a comment naming the rule ("watch
 * the **file** count, not the test count"), but a number in a comment is a rule
 * nobody is obliged to read — the same sentence this repo already wrote about
 * `_headers`. This mechanizes it: the reported count is held against the
 * directory listing, and a mismatch is a red gate instead of a green summary.
 *
 * PURE by construction (imports nothing): tests import this under the jsdom
 * pool, where a static `import 'node:…'` is mangled by Vite externalization
 * (docs/11). All filesystem access lives in main() below.
 */

/** A vitest default-reporter summary line, e.g. "Test Files  72 passed (72)"
 *  or "Test Files  1 failed | 71 passed (72)". The parenthesized total is the
 *  run's own file count; the leading numbers must add up to it. */
const SUMMARY_RE =
  /Test Files\s+(\d+)\s+(failed|passed)(?:\s*\|\s*(\d+)\s+(failed|passed))?\s+\((\d+)\)/;

/**
 * Read the reported file count out of a vitest log. Returns found:false when
 * the log carries no summary at all (wrong reporter, truncated log) — which is
 * a failure, not a pass: no evidence is not evidence of completeness.
 */
export function parseVitestSummary(logText) {
  const lines = String(logText).split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = SUMMARY_RE.exec(lines[i]);
    if (match) {
      return {
        found: true,
        files: Number(match[5]),
        parts: [Number(match[1]), match[3] === undefined ? 0 : Number(match[3])],
        verdict: match[2],
      };
    }
  }
  return { found: false, files: 0, parts: [0, 0], verdict: null };
}

/** Test-file names in a directory listing: flat `*.test.ts` / `*.test.tsx`. */
export function countTestFiles(names) {
  return names.filter((name) => /\.test\.tsx?$/.test(name)).length;
}

/**
 * Hold the summary against the listing. `actualFiles` is the count from the
 * directory, not a second copy of the summary — two copies of one number agree
 * with each other and prove nothing.
 */
export function checkFileCount(summary, actualFiles) {
  if (!summary.found) {
    return {
      ok: false,
      reason: 'no "Test Files N …" summary in log (wrong reporter or truncated output)',
    };
  }
  if (summary.parts[0] + summary.parts[1] !== summary.files) {
    return {
      ok: false,
      reason: `summary disagrees with itself: ${summary.parts[0]}+${summary.parts[1]} vs (${summary.files})`,
    };
  }
  if (summary.files !== actualFiles) {
    return {
      ok: false,
      reason: `vitest reported ${summary.files} files but the directory holds ${actualFiles} — files were dropped`,
    };
  }
  return { ok: true, reason: `vitest reported ${summary.files} files; directory holds ${actualFiles}` };
}

async function main(logPath, testsDir) {
  const fs = process.getBuiltinModule('node:fs');
  let logText;
  try {
    logText = fs.readFileSync(logPath, 'utf8');
  } catch (err) {
    console.error(`guard-test-files: cannot read log ${logPath}: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  let names;
  try {
    names = fs.readdirSync(testsDir);
  } catch (err) {
    console.error(`guard-test-files: cannot list ${testsDir}: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  const result = checkFileCount(
    parseVitestSummary(logText),
    countTestFiles(names),
  );
  console.log(`guard-test-files: ${result.ok ? 'ok' : 'FAIL'} — ${result.reason}`);
  if (!result.ok) process.exitCode = 1;
}

/* Importable under vitest without side effects: main() runs only as a CLI. A
   relative argv would silently stop the CLI from running at all (docs/14 item
   39 — a guard that stops guarding is worse than one that over-blocks), so the
   comparison resolves through file URLs. Synchronous on purpose: an async
   detector that rejects (or a boolean mistaken for a promise) either crashes
   the import or never runs the guard. */
let runAsCli = false;
if (typeof process !== 'undefined' && process.argv && process.argv[1]) {
  try {
    const { pathToFileURL } = process.getBuiltinModule('node:url');
    runAsCli = pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    runAsCli = false;
  }
}
if (runAsCli) {
  const [, , logPath, testsDir] = process.argv;
  if (!logPath || !testsDir) {
    console.error('usage: node guard-test-files.mjs <vitest-log> <tests-dir>');
    process.exitCode = 2;
  } else {
    void main(logPath, testsDir);
  }
}
