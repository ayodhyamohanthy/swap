/* Missing-asset stub — the counter-example for the route smoke scripts.
 *
 * WHY THIS EXISTS. `scripts/smoke-hydration.mjs` filters out the dev-only
 * manifest 404 so a real hydration or runtime error stands out. A filter like
 * that is exactly the kind of guard that rots into a no-op: the obvious way to
 * check it works is to break an asset and watch the run fail, but nothing in
 * the app does that, so the check would be "trust me". This server does it.
 *
 *   node app/scripts/missing-asset-stub.mjs
 *   BASE=http://127.0.0.1:5299 node app/scripts/smoke-hydration.mjs
 *     -> routes with console errors: 53, exit 1, each naming missing-mutation.png
 *   node app/scripts/smoke-hydration.mjs        # against vite dev
 *     -> 0 errors, exit 0
 *
 * TWO DETAILS THAT DECIDE WHETHER THE TEST MEANS ANYTHING. Both were wrong in the
 * first version of this harness, and both produced a green that proved nothing:
 *
 *   1. A RAW SOCKET server, not `http`. The 404 must carry an **empty reason
 *      phrase** — `HTTP/1.1 404 \r\n` — because that is what `vite dev` sends
 *      and therefore what Chrome logs: "…status of 404 ()". Node's default
 *      phrase makes Chrome log "404 (Not Found)", a shape the pre-fix filter's
 *      `404 \(\)` does not match, so the OLD script would fail on the manifest
 *      noise and the "fix works" conclusion would be an artefact of the stub.
 *   2. The missing asset must be an **image**, not a stylesheet. A stylesheet
 *      served as text/plain also draws Chrome's MIME complaint
 *      ("Refused to apply style … not a supported stylesheet MIME type"), and
 *      that message matches no 404 pattern — so the old script would fail for a
 *      second, unrelated reason and the discriminator would vanish.
 *
 * Both pages also request `/manifest.webmanifest`, which 404s here too, so the
 * ignored-noise bucket is exercised on every route rather than being empty.
 */

import { createServer } from 'node:net'

const PORT = Number(process.env.PORT || 5299)

const page = `<!doctype html><html><head>
<link rel="manifest" href="/manifest.webmanifest">
</head><body><main>stub page for the missing-asset test, nothing else here</main>
<img src="/missing-mutation.png" alt=""></body></html>`

const notFound = Buffer.from(
  'HTTP/1.1 404 \r\ncontent-type: image/png\r\ncontent-length: 0\r\nconnection: close\r\n\r\n',
)
const ok = (body) =>
  Buffer.concat([
    Buffer.from(
      'HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\n' +
        `content-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n`,
    ),
    Buffer.from(body),
  ])

createServer((socket) => {
  let buf = ''
  socket.on('data', (chunk) => {
    buf += chunk.toString()
    if (!buf.includes('\r\n\r\n')) return
    const url = buf.split(' ')[1] || '/'
    const missing =
      url.startsWith('/manifest.webmanifest') || url.startsWith('/missing-mutation.png')
    socket.end(missing ? notFound : ok(page))
  })
  socket.on('error', () => {})
}).listen(PORT, '127.0.0.1', () => console.log(`missing-asset stub on ${PORT}`))
