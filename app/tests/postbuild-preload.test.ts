/* The prerendered SPA shell must carry no modulepreload links.
 *
 * The shell is server-rendered with an EMPTY route boundary — route content
 * is client-rendered by design (tests/hydration.test.tsx). The prerender
 * crawl preloads the crawled route's code-split chunks into the shell,
 * making that route's component synchronously available during hydration;
 * the client then renders content into a boundary the server left
 * incomplete, React discards the tree (#418), and `/` — the most-loaded
 * route — pays it. Measured both ways: with the preload links the prod
 * build logs #418 on `/`, stripped it hydrates clean.
 *
 * The guard pins the mechanism, not the regex: postbuild must strip
 * modulepreload links from the shell, and must do it before the service
 * worker precaches dist — otherwise the SW keeps serving the mismatching
 * shell and the fix only works on the first visit. */

const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const POSTBUILD = readFileSync(join(import.meta.dirname, '..', 'scripts', 'postbuild.mjs'), 'utf8')

describe('postbuild strips route-chunk preloads from the prerendered shell', () => {
  it('removes modulepreload links from dist/client/index.html', () => {
    expect(POSTBUILD).toMatch(/replace\(\/<link rel="modulepreload"/)
    expect(POSTBUILD).toMatch(/writeFileSync\(shell, stripped\)/)
  })

  it('strips before the service worker precaches the shell', () => {
    const stripAt = POSTBUILD.indexOf('modulepreload')
    const swAt = POSTBUILD.indexOf('generateSW(')
    expect(stripAt, 'strip step missing').toBeGreaterThan(-1)
    expect(swAt, 'generateSW call missing').toBeGreaterThan(-1)
    expect(stripAt, 'the SW precache must see the stripped shell, not the preloaded one').toBeLessThan(swAt)
  })
})
