/* Guard for the unit file-count (docs/14 backlog 16): a vitest summary that
 * names fewer files than the directory holds is a red gate, not a green run.
 *
 * WHY THE SHAPE. The 2026-10-04 incident reported "Test Files 51 passed (51)"
 * with 21 files never started — and the run looked BETTER than a complete one,
 * because the file carrying the only known failures was among the 21. So every
 * assertion here is about the comparison, never the total: the last block runs
 * the shipped functions against the REAL directory with a floor, not an exact
 * count, because an exact total is a magic number that rots (the vitest.config
 * comment carried "31" while the directory held 72). */
import { describe, expect, it } from 'vitest'

import {
  checkFileCount,
  countTestFiles,
  parseVitestSummary,
} from '../scripts/guard-test-files.mjs'

const { readdirSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')

describe('parseVitestSummary reads the reported count', () => {
  it('finds a passing summary', () => {
    const summary = parseVitestSummary(
      ' RUN  v4.1.11 /app\n\n Test Files  72 passed (72)\n      Tests  1313 passed (1313)\n',
    )
    expect(summary.found).toBe(true)
    expect(summary.files).toBe(72)
    expect(summary.verdict).toBe('passed')
  })

  it('finds a failing summary too — red runs get counted, not skipped', () => {
    const summary = parseVitestSummary(' Test Files  1 failed | 71 passed (72)\n')
    expect(summary.found).toBe(true)
    expect(summary.files).toBe(72)
  })

  it('reports found:false when the log carries no summary', () => {
    expect(parseVitestSummary('{"numTotalTestFiles": 72}\n').found).toBe(false)
    expect(parseVitestSummary('').found).toBe(false)
  })
})

describe('countTestFiles counts only test files', () => {
  it('accepts .test.ts and .test.tsx, nothing else', () => {
    expect(
      countTestFiles(['a.test.ts', 'b.test.tsx', 'c.ts', 'setup.ts', 'README.md']),
    ).toBe(2)
  })
})

describe('checkFileCount holds the summary against the listing', () => {
  it('passes when both agree', () => {
    const result = checkFileCount(
      { found: true, files: 72, parts: [72, 0], verdict: 'passed' },
      72,
    )
    expect(result.ok).toBe(true)
  })

  it('fails when the summary names fewer files than the directory holds', () => {
    /* The 2026-10-04 shape exactly: 51 reported, 72 on disk. */
    const result = checkFileCount(
      { found: true, files: 51, parts: [51, 0], verdict: 'passed' },
      72,
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/dropped/)
  })

  it('fails when the summary disagrees with itself', () => {
    const result = checkFileCount(
      { found: true, files: 72, parts: [51, 0], verdict: 'passed' },
      72,
    )
    expect(result.ok).toBe(false)
  })

  it('fails when there is no summary to check', () => {
    const result = checkFileCount(
      { found: false, files: 0, parts: [0, 0], verdict: null },
      72,
    )
    expect(result.ok).toBe(false)
  })
})

describe('the guard bites on the real directory, not just fixtures', () => {
  const dir = join(import.meta.dirname)
  const realCount = countTestFiles(readdirSync(dir))

  it('sees a realistically large suite (floor, never an exact total)', () => {
    expect(realCount).toBeGreaterThan(70)
  })

  it('a synthetic log naming the real count passes', () => {
    const summary = parseVitestSummary(
      `\n Test Files  ${realCount} passed (${realCount})\n      Tests  999 passed (999)\n`,
    )
    expect(checkFileCount(summary, realCount).ok).toBe(true)
  })

  it('a synthetic log one file short fails', () => {
    const summary = parseVitestSummary(
      `\n Test Files  ${realCount - 1} passed (${realCount - 1})\n`,
    )
    expect(checkFileCount(summary, realCount).ok).toBe(false)
  })
})
