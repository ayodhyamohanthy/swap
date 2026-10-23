import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('unknown URLs', () => {
  it('are served by a catch-all route, not the router not-found fallback (that path logged React #418)', () => {
    expect(existsSync(resolve(process.cwd(), 'src/routes/$.tsx'))).toBe(true)
    expect(read('src/routes/$.tsx')).toContain("createFileRoute('/$')")
    expect(read('src/routeTree.gen.ts')).toContain("'/$'")
  })
  it('show localized copy with a way home in English and Hindi', () => {
    for (const l of ['en', 'hi']) {
      const n = JSON.parse(read(`locales/${l}.json`)).notFound
      expect(n.title && n.body && n.home).toBeTruthy()
    }
    expect(read('src/components/not-found.tsx')).toContain('to="/"')
  })
})
