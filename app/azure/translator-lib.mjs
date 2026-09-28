#!/usr/bin/env node
/* SeatSwap Azure Translator draft — burn-down only, exp Dec 16 2026.
 * Reads app/locales/en.json (635 leaves, ~17k chars), drafts ONE lang
 * at a time into app/azure/tmp/<code>.json. NEVER writes app/locales/.
 * Without AZURE_TRANSLATOR_KEY: dry-run, no network, nothing written. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const EN_PATH = join(HERE, '..', 'locales', 'en.json')
const TMP = join(HERE, 'tmp')
export const TARGETS = {
  as: 'as', bn: 'bn', brx: 'brx', doi: 'doi', gu: 'gu', kn: 'kn',
  ks: 'ks', kok: 'kok', mai: 'mai', ml: 'ml', mni: 'mni', mr: 'mr',
  ne: 'ne', or: 'or', pa: 'pa', sa: 'sa', sat: 'sat', sd: 'sd',
  ta: 'ta', te: 'te', ur: 'ur',
}
export const BANNED = [
  /\btte\b/i, /\b(?:swap\s+)?pass(?:es)?\b/i, /indian\s+railways/i,
  /irctc\s+approved/i, /authoris|authoriz/i, /\blegal\b/i,
  /\bgrievance\b/i, /\bofficial\b/i,
]
const PLACEHOLDER = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g
export function flatLeaves(node, prefix = '', out = {}) {
  if (typeof node === 'string') { out[prefix] = node; return out }
  for (const [k, v] of Object.entries(node)) {
    const q = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatLeaves(v, q, out)
    else out[q] = typeof v === 'string' ? v : String(v)
  }
  return out
}
export function unflatten(leaves) {
  const root = {}
  for (const [path, value] of Object.entries(leaves)) {
    const parts = path.split('.')
    let cur = root
    for (let i = 0; i < parts.length - 1; i += 1) cur = (cur[parts[i]] ??= {})
    cur[parts[parts.length - 1]] = value
  }
  return root
}
export function placeholdersOf(s) {
  return [...String(s).matchAll(PLACEHOLDER)].map((m) => m[0]).sort()
}
export function scanDraft(leaves) {
  const banned = []
  for (const [key, value] of Object.entries(leaves)) {
    if (key === 'footer.line2') continue
    for (const rx of BANNED) {
      if (rx.test(value)) { banned.push(`${key}: ${value.slice(0, 80)}`); break }
    }
  }
  return { banned }
}
