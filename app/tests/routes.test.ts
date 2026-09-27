/* Route-link integrity (docs/05): every <Link to> / navigate({to}) target in a
   route or component must resolve to a declared createFileRoute path, so no
   screen can ever navigate into the void. Dynamic segments ($id) match any
   single path segment; fully dynamic destinations are skipped. */

const { readdirSync, readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', 'src')

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return tsxFiles(full)
    return /\.tsx$/.test(entry.name) ? [full] : []
  })
}

function routePaths(): RegExp[] {
  const routes = new Set<string>()
  for (const file of tsxFiles(join(SRC, 'routes'))) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/createFileRoute\(\s*'([^']+)'/g)) routes.add(m[1])
  }
  const norm = (r: string) => r.replace(/\/_index$/, '').replace(/\/$/, '') || '/'
  return [...new Set([...routes].map(norm))].map(
    (k) => new RegExp(`^${k.replace(/\$[A-Za-z]+/g, '[^/]+')}$`),
  )
}

/** Static `to="/a/b"` and `to: '/a/b'` destinations (skips interpolations). */
function linkTargets(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const file of [...tsxFiles(join(SRC, 'routes')), ...tsxFiles(join(SRC, 'components'))]) {
    const src = readFileSync(file, 'utf8')
    const rel = file.slice(SRC.length + 1)
    for (const m of src.matchAll(/(?:to=\{?["']|to:\s*['"])(\/[a-zA-Z0-9/$\{\}_-]+)/g)) {
      const target = m[1].split('?')[0]
      if (target.includes('${') || target.includes('{')) continue
      out.push([rel, target])
    }
  }
  return out
}

describe('every link target resolves to a route (docs/05)', () => {
  it('has no dead links', () => {
    const patterns = routePaths()
    expect(patterns.length).toBeGreaterThan(40)
    const dead = linkTargets()
      .map(([file, target]) => {
        const concrete = target.replace(/\$[A-Za-z]+/g, 'x')
        return patterns.some((p) => p.test(concrete)) ? null : `${file}:${target}`
      })
      .filter((row): row is string => row !== null)
    expect(dead).toEqual([])
  })
})
