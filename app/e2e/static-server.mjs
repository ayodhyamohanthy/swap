/* Serves the built static app for the Playwright E2E suite (docs/17 W6.1).
   Mirrors the production shape: dist/cf is the Cloudflare-staged build and an
   unknown path falls back to /index.html, the same behaviour Cloudflare's
   `not_found_handling = "single-page-application"` gives the deployed worker. */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(import.meta.dirname, '..', 'dist', 'cf')
if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/cf is missing or has no index.html — run `npm run build` before `npm run test:e2e`.')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  let path = join(root, normalize(decodeURIComponent(url.pathname)))
  if (!path.startsWith(root)) {
    res.writeHead(403).end()
    return
  }
  if (!existsSync(path) || statSync(path).isDirectory()) {
    path = join(root, 'index.html')
  }
  const type = TYPES[extname(path)] ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': type }).end(readFileSync(path))
}).listen(Number(process.env.PORT) || 4173, '127.0.0.1')

console.log('[e2e] serving dist/cf on http://127.0.0.1:4173')
