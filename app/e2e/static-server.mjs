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

/* The shipped _headers file, read once at startup in Cloudflare's shape
   (a path, then indented directives; # lines are comments). Every rule
   whose path matches the request applies, a later same-named directive
   overriding an earlier one — the same resolution Cloudflare gives a real
   visitor, so the whole E2E suite runs under the headers the deploy
   serves (docs/17 W7.3: CSP is where payment integrations break). */
const headerRules = (() => {
  const file = join(root, '_headers')
  if (!existsSync(file)) return []
  const rules = []
  let current = null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (/^\s/.test(line)) current?.headers.push(trimmed)
    else {
      current = { path: trimmed, headers: [] }
      rules.push(current)
    }
  }
  return rules
})()

const headersFor = (pathname) => {
  const out = {}
  for (const rule of headerRules) {
    const matches = rule.path.endsWith('/*')
      ? pathname.startsWith(rule.path.slice(0, -1))
      : pathname === rule.path
    if (!matches) continue
    for (const directive of rule.headers) {
      const split = directive.indexOf(':')
      if (split > 0) out[directive.slice(0, split).trim()] = directive.slice(split + 1).trim()
    }
  }
  return out
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
  res.writeHead(200, { 'content-type': type, ...headersFor(url.pathname) }).end(readFileSync(path))
}).listen(Number(process.env.PORT) || 4173, '127.0.0.1')

console.log('[e2e] serving dist/cf on http://127.0.0.1:4173')
