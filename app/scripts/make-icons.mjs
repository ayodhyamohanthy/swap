/* SeatSwap icon generator — zero dependencies, no paid assets.

   Produces app/public/icons/* (192, 512, maskable-512, apple-touch-180) from
   the design tokens in app/src/styles.css (docs/07-DESIGN-SYSTEM.md):
   deep green #1F6B45 field, cream #FAF6EE ink, saffron accent #F2A33A.

   Run: node app/scripts/make-icons.mjs     (deterministic, safe to re-run) */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from './png.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'icons')

/* Tokens (docs/07). Literals are fine here: this is an asset generator,
   not a component — components must use semantic tokens. */
const PRIMARY = [0x1f, 0x6b, 0x45]
const CREAM = [0xfa, 0xf6, 0xee]
const ACCENT = [0xf2, 0xa3, 0x3a]

function blank(size) {
  return new Uint8Array(size * size * 4)
}

function put(px, size, x, y, colour, alpha = 255) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  const i = (y * size + x) * 4
  const a = alpha / 255
  px[i] = Math.round(colour[0] * a + px[i] * (1 - a))
  px[i + 1] = Math.round(colour[1] * a + px[i + 1] * (1 - a))
  px[i + 2] = Math.round(colour[2] * a + px[i + 2] * (1 - a))
  px[i + 3] = Math.max(px[i + 3], alpha)
}

/** Rounded rectangle (the icon field). */
function roundRect(px, size, x0, y0, w, h, radius, colour) {
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y += 1) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x += 1) {
      const dx = Math.min(Math.max(x, x0 + radius), x0 + w - radius)
      const dy = Math.min(Math.max(y, y0 + radius), y0 + h - radius)
      if ((x - dx) ** 2 + (y - dy) ** 2 <= radius ** 2) put(px, size, x, y, colour)
    }
  }
}

/** Thick line with round ends (arrow shafts). */
function stroke(px, size, x1, y1, x2, y2, width, colour) {
  const half = width / 2
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2) + 1
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps
    const cx = x1 + (x2 - x1) * t
    const cy = y1 + (y2 - y1) * t
    for (let y = Math.floor(cy - half); y <= Math.ceil(cy + half); y += 1) {
      for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= half ** 2) put(px, size, x, y, colour)
      }
    }
  }
}

/** Solid triangle (arrow heads). */
function triangle(px, size, [a, b, c], colour) {
  const minX = Math.floor(Math.min(a[0], b[0], c[0]))
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0]))
  const minY = Math.floor(Math.min(a[1], b[1], c[1]))
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]))
  const area = (p1, p2, p3) =>
    (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p3[0] - p1[0]) * (p2[1] - p1[1])
  const total = area(a, b, c)
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p = [x + 0.5, y + 0.5]
      const w1 = area(a, b, p) / total
      const w2 = area(b, c, p) / total
      const w3 = area(c, a, p) / total
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) put(px, size, x, y, colour)
    }
  }
}


/**
 * The SeatSwap mark: two opposed arrows (a swap) on the green field.
 * @param {number} size square edge in px
 * @param {{ maskable?: boolean }} [opts]
 */
function drawMark(size, opts = {}) {
  const px = blank(size)
  const S = size / 512 // geometry authored at 512, scaled per size

  /* A normal icon is a rounded tile; a maskable icon is FULL-BLEED opaque
     (the launcher applies its own crop, so transparency would show black),
     with the mark kept inside the 80% safe zone. */
  const radius = opts.maskable ? 0 : Math.round(96 * S)
  roundRect(px, size, 0, 0, size, size, radius, PRIMARY)

  const inset = opts.maskable ? 0.28 : 0.2
  const left = size * inset
  const right = size * (1 - inset)
  const top = size * 0.36
  const bottom = size * 0.64
  const width = Math.max(2, 34 * S)
  const head = 52 * S

  // Upper arrow -> cream, pointing right
  stroke(px, size, left, top, right - head * 0.4, top, width, CREAM)
  triangle(px, size, [
    [right, top],
    [right - head, top - head * 0.62],
    [right - head, top + head * 0.62],
  ], CREAM)

  // Lower arrow <- saffron accent, pointing left
  stroke(px, size, right, bottom, left + head * 0.4, bottom, width, ACCENT)
  triangle(px, size, [
    [left, bottom],
    [left + head, bottom - head * 0.62],
    [left + head, bottom + head * 0.62],
  ], ACCENT)

  return px
}

/** Apple touch icon: full-bleed opaque — iOS applies its own corner mask. */
function drawApple(size) {
  const px = blank(size)
  const S = size / 512
  roundRect(px, size, 0, 0, size, size, 0, PRIMARY)
  const left = size * 0.18
  const right = size * 0.82
  const top = size * 0.37
  const bottom = size * 0.63
  const width = Math.max(2, 34 * S)
  const head = 52 * S
  stroke(px, size, left, top, right - head * 0.4, top, width, CREAM)
  triangle(px, size, [
    [right, top], [right - head, top - head * 0.62], [right - head, top + head * 0.62],
  ], CREAM)
  stroke(px, size, right, bottom, left + head * 0.4, bottom, width, ACCENT)
  triangle(px, size, [
    [left, bottom], [left + head, bottom - head * 0.62], [left + head, bottom + head * 0.62],
  ], ACCENT)
  return px
}

mkdirSync(OUT, { recursive: true })
const targets = [
  ['icon-192.png', 192, drawMark(192)],
  ['icon-512.png', 512, drawMark(512)],
  ['maskable-192.png', 192, drawMark(192, { maskable: true })],
  ['maskable-512.png', 512, drawMark(512, { maskable: true })],
  ['apple-touch-icon.png', 180, drawApple(180)],
]
for (const [name, size, px] of targets) {
  const png = encodePng(size, size, px)
  writeFileSync(join(OUT, name), png)
  console.log(`[icons] ${name} ${size}x${size} ${(png.length / 1024).toFixed(1)} KB`)
}
console.log('[icons] tokens from docs/07: field #1F6B45, ink #FAF6EE, accent #F2A33A')
