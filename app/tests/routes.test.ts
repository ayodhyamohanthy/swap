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
  /* No `/_index` tolerance here on purpose. This used to strip a trailing
     `/_index`, which made the guard treat `/admin/_index` and `/admin` as the
     same route — so it stayed green while `/admin` matched nothing. A form
     that must not exist is not something to normalise; it is something to
     fail on, and the describe below does exactly that. */
  const norm = (r: string) => r.replace(/\/$/, '') || '/'
  return [...new Set([...routes].map(norm))].map(
    (k) => new RegExp(`^${k.replace(/\$[A-Za-z]+/g, '[^/]+')}$`),
  )
}

/** [file, declared route id] for every `createFileRoute('…')` in `src/routes`. */
function routeDeclarations(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const file of tsxFiles(join(SRC, 'routes'))) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/createFileRoute\(\s*'([^']+)'/g)) {
      out.push([file.slice(SRC.length + 1), m[1]])
    }
  }
  return out
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

/* The trap this describes: in TanStack's file convention a leading underscore
   marks a PATHLESS route. `routes/admin._index.tsx` declared
   `createFileRoute('/admin/_index')`, so the generator emitted `path: ''` and
   the route matched no URL at all. `/admin` still rendered the admin layout,
   so the page looked alive — its `<Outlet/>` was simply empty. The whole
   Overview screen (design 23: six tiles, the week chart, the donut) was
   unreachable behind a nav link that pointed straight at it, while typecheck,
   the full suite and the production build all stayed green. Only a browser
   showed it.

   Every other index route in the repo uses a trailing-slash id (`/profile/`,
   `/swaps/`, `/profile/payments/`, `/request/$id/`, `/groups/$id/`,
   `/pay/$requestId/`), which is what makes them match. */
describe('index routes are not declared pathless', () => {
  it('no route file declares an id containing the _index segment', () => {
    const offenders = routeDeclarations()
      .filter(([, id]) => id.includes('_index'))
      .map(([file, id]) => `${file}: ${id}`)
    expect(offenders).toEqual([])
  })

  it('every index route declares a trailing-slash id', () => {
    /* Matches `index.tsx`, `foo.index.tsx` AND `foo._index.tsx` — the last is
       the broken form, and an earlier version of this filter missed it
       because the character before `index` is `_`, not `.`. */
    const indexRoutes = routeDeclarations().filter(([file]) => /(^|[._])index\.tsx$/.test(file))
    expect(indexRoutes.length).toBeGreaterThan(5)
    const wrong = indexRoutes.filter(([, id]) => id !== '/' && !id.endsWith('/')).map(
      ([file, id]) => `${file}: ${id}`,
    )
    expect(wrong).toEqual([])
  })

  it('the generated tree contains no pathless route', () => {
    /* A route with an empty path can never match a URL. The generator emits
       `path: ''` for a pathless route, both in the `update()` call and in
       FileRoutesByPath. There is no legitimate pathless layout route in this
       repo; if one is ever added, this is the assertion to revisit
       deliberately rather than delete. */
    const tree = readFileSync(join(SRC, 'routeTree.gen.ts'), 'utf8')
    expect(tree).not.toMatch(/path: ''/)
  })
})
