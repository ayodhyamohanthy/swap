/* On-device QR generation, replacing an external QR image vendor. The share
   screens used to build their <img> from an external QR image service that is not on
   docs/12 §2's WIRED list, and one that received the invite link (train
   number, journey date) on every render. Its name is recorded in
   docs/DECISIONS.md and tests/qr.test.ts, not in scanned source. The share screen's own header comment
   always promised "drawn on this device ... no QR image vendor: the code never
   leaves the phone until scanned"; the code contradicted it. qrcode-generator
   (MIT, Kazuhiko Arase) is the matrix encoder; the SVG it emits is served as a
   data URI so no request leaves the device at all, and the string is returned
   by a function because a string assembled in JSX is not assertable. */
import qrcode from 'qrcode-generator'

/** A QR code encoding `text`, as a self-contained `data:image/svg+xml` URI. */
export function qrSvgDataUrl(text: string): string {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true })
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
