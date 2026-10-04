/* serve-dist.mjs — static file server for the BUILT app (`dist/client`).
 *
 * WHY THIS EXISTS. The e2e suite (docs/17 W6.1, `npm run test:e2e`) has to
 * exercise the artefact that ships, not `vite dev`: the two differ in exactly
 * the ways this repo has been burned by before — only `/` is prerendered in the
 * build, the service worker exists only in the build, and the bundle is minified
 * React whose hydration failures come out as `Minified React error #418`. A dev
 * server cannot reproduce any of that, and `smoke-routes.mjs` already documents
 * that its own "0 errors across 53 routes" baseline is a DEV baseline.
 *
 * SPA FALLBACK — the rule, because getting it wrong is silent. A path with NO
 * file extension is a client route (`/trips/add`, `/pay/req_1`) and falls back
 * to `index.html`; a path WITH an extension is an asset and must 404 when it is
 * missing. Falling back for assets too lets a probe measure an unloaded page
 * while every assertion still passes (the exact trap recorded for the screenshot
 * harness), so the two cases are deliberately different here.
 *
 * The service worker never registers on 127.0.0.1/localhost (see
 * `src/components/service-worker.tsx`), so no test needs `?sw=off` — but the
 * query string is stripped before resolving anyway, so adding it is harmless.
 *
 * USAGE
 *   node scripts/serve-dist.mjs [--port 4319] [--dir dist/client]
 *
 * Exits non-zero with instructions when the build is missing, so a suite run
 * without `npm run build` fails loudly instead of 404-ing every route. */

import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1]
  return fallback
}

const PORT = Number(arg('port', process.env.E2E_PORT ?? '4319'))
const DIR = resolve(appRoot, arg('dir', 'dist/client'))

if (!existsSync(join(DIR, 'index.html'))) {
  console.error(
    `serve-dist: no index.html in ${DIR}\n` +
      '  Build first:  npm run build --workspace seatswap-app',
  )
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  const inside = resolve(DIR, '.' + (path.startsWith('/') ? path : `/${path}`))
  /* Path traversal is not a concern for a loopback test server, but refusing
     outside-ROOT in one line is cheaper than reasoning about it later. */
  const safe = inside === DIR || inside.startsWith(DIR + sep)
  let file = safe ? inside : join(DIR, 'index.html')

  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')

  if (!existsSync(file)) {
    /* Asset ⇒ 404. No extension ⇒ a client route ⇒ the SPA shell. */
    if (extname(path)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    file = join(DIR, 'index.html')
  }

  /* Read BEFORE writing the head, and never let a read throw out of the
     handler. An unguarded readFileSync here crashed the whole process on one
     request that lost a race with a rebuild, and every test after it was
     reported as `net::ERR_CONNECTION_REFUSED` — i.e. as a product failure
     rather than a dead server. A file that vanishes between the existsSync
     check above and this read is the same case that check already handles. */
  let body
  try {
    body = readFileSync(file)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
    return
  }

  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(body)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serve-dist: http://127.0.0.1:${PORT} → ${DIR}`)
})
