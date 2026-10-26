/* No control characters in source.
 *
 * Found the hard way: `admin.activity.tsx` shipped for a month with a NUL
 * byte inside a string literal (`'\0automation'` as a React key). The build
 * and every test stayed green, but every byte-scanning tool from `grep`
 * down reclassified the file as binary: `grep -r` silently skipped it, so a
 * text search or a mechanical replace could miss a line without saying so,
 * and `git diff` rendered the file as a binary blob nobody could review.
 * A NUL inside a string literal is also not valid ECMAScript source — the
 * bundler tolerates it today, but the file is one parser upgrade away from
 * a syntax error.
 *
 * The rule is byte-level and cheap to keep: C0 control characters have no
 * business in source files. Tab, LF and CR are the three that carry
 * meaning; anything else (NUL, BEL, backspace, form feed, C1 leftovers)
 * fails this test by path and offset.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const { readFileSync, readdirSync, statSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')

const SRC = join(import.meta.dirname, '..', 'src')
const TEXT_EXTS = new Set(['.ts', '.tsx', '.css'])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (TEXT_EXTS.has(entry.slice(entry.lastIndexOf('.')))) out.push(full)
  }
  return out
}

describe('source files carry no control characters', () => {
  it('every .ts/.tsx/.css under src/ is NUL-free and control-clean', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const bytes = readFileSync(file)
      bytes.forEach((byte, offset) => {
        const isControl =
          byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d
        if (isControl) {
          offenders.push(`${file} @ byte ${offset} (0x${byte.toString(16)})`)
        }
      })
    }
    expect(
      offenders,
      `control characters in source (this makes tools treat the file as binary):\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
