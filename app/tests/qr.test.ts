/* The share screens' QR. It used to be one <img src> pointing at
   api.qrserver.com — a vendor not on docs/12 §2's WIRED list, receiving the
   invite link (train number, journey date) on every render. The matrix is now
   encoded on the device, so three things are pinned here:

     1. the data URI is self-contained: a `data:` URI, never a URL a third
        party could be handed;
     2. the generated modules actually decode back to the invite link —
        round-tripped through jsQR (a decoder this repo does not otherwise
        carry), which is the proof that the QR a traveller shows a stranger
        opens the link it claims to;
     3. no QR image vendor string exists anywhere in src/ — reverting either
        screen to the vendor URL fails this suite by name. */
import jsQR from 'jsqr'
import qrcode from 'qrcode-generator'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { qrSvgDataUrl } from '../src/lib/qr'

const SRC = join(__dirname, '..', 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    try {
      if (readdirSync(full).length >= 0) out.push(...walk(full))
    } catch {
      out.push(full)
    }
  }
  return out
}

/** Re-encode `text` with the same library and rasterise its modules to RGBA,
    so jsQR reads the matrix the app will actually render. */
function decodedText(text: string): string | null {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const count = qr.getModuleCount()
  const margin = 2
  const scale = 4
  const size = (count + margin * 2) * scale
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (!qr.isDark(r, c)) continue
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((r + margin) * scale + dy) * size + (c + margin) * scale + dx
          data[i * 4] = 0
          data[i * 4 + 1] = 0
          data[i * 4 + 2] = 0
        }
      }
    }
  }
  const found = jsQR(data, size, size)
  return found ? found.data : null
}

describe('qrSvgDataUrl', () => {
  it('produces a self-contained data URI, never an external URL', () => {
    for (const link of [
      'https://seatswap.example/j/12752-2026-11-12',
      'https://seatswap.example/j/12951-2026-11-20?via=sms',
    ]) {
      const svg = decodeURIComponent(qrSvgDataUrl(link))
      expect(qrSvgDataUrl(link).startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
      /* The SVG namespace declaration is the only legitimate `http` in the
         payload — an identifier, not a host. Everything else must be local. */
      expect(svg.replace(/xmlns="[^"]*"/g, '')).not.toContain('http')
      expect(svg).not.toContain('qrserver')
    }
  })

  it('the <svg> tag itself scales, not a fixed pixel size', () => {
    const svg = decodeURIComponent(qrSvgDataUrl('https://seatswap.example/j/x'))
    const openTag = svg.match(/<svg[^>]*>/)![0]
    expect(openTag).toContain('viewBox')
    expect(openTag).not.toMatch(/width=|height=/)
  })

  it('decodes back to the invite link it was built from', () => {
    for (const link of [
      'https://seatswap.example/j/12752-2026-11-12',
      'https://seatswap.example/j/12951-2026-11-20?via=sms',
      'https://seatswap.example/j/12951-2026-11-20?via=sms&ref=coach-b2-14-longer-link-exercises-a-larger-qr-version',
    ]) {
      expect(decodedText(link)).toBe(link)
    }
  })
})

describe('no QR image vendor in src/', () => {
  it('no screen sends the invite link to an external QR service', () => {
    const offenders = walk(SRC).filter((f) => {
      if (!/\.(tsx?|mjs)$/.test(f)) return false
      return readFileSync(f, 'utf8').includes('qrserver')
    })
    expect(offenders).toEqual([])
  })
})
