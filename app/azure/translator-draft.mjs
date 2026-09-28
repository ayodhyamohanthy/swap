#!/usr/bin/env node
/* Thin runner over translator-lib. See README for costs + POEditor flow. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TARGETS, flatLeaves, unflatten, placeholdersOf, scanDraft } from './translator-lib.mjs'
const HERE = dirname(fileURLToPath(import.meta.url))
const EN_PATH = join(HERE, '..', 'locales', 'en.json')
const TMP = join(HERE, 'tmp')
async function batch(texts, to, key, region) {
  const url = 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=' + encodeURIComponent(to)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key, 'Ocp-Apim-Subscription-Region': region },
    body: JSON.stringify(texts.map((t) => ({ text: t }))),
  })
  if (!res.ok) throw new Error(`translator_http_${res.status}`)
  const data = await res.json()
  return data.map((d, i) => d?.translations?.[0]?.text ?? texts[i])
}
const argv = process.argv.slice(2)
const langArg = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : null
const dry = argv.includes('--dry-run') || !process.env.AZURE_TRANSLATOR_KEY
const leaves = flatLeaves(JSON.parse(readFileSync(EN_PATH, 'utf8')))
const keys = Object.keys(leaves)
const chars = keys.reduce((n, k) => n + leaves[k].length, 0)
const langs = langArg ? [langArg] : Object.keys(TARGETS)
for (const l of langs) {
  if (!TARGETS[l]) { console.error(`unknown lang ${l}`); process.exit(1) }
}
console.log(`[translator] en: ${keys.length} leaves, ${chars} chars.`)
console.log(`[translator] est: one lang $${((chars / 1e6) * 10).toFixed(2)}, ${langs.length} lang(s) $${(((chars * langs.length) / 1e6) * 10).toFixed(2)}.`)
if (dry && !process.env.AZURE_TRANSLATOR_KEY) console.log('[translator] dry-run: no network, nothing written.')
for (const lang of langs) {
  if (dry) {
    const { banned } = scanDraft(leaves)
    console.log(`[translator] ${lang} dry-run ok: ${keys.length} keys, source banned hits: ${banned.length}.`)
    continue
  }
  const key = process.env.AZURE_TRANSLATOR_KEY ?? ''
  const region = process.env.AZURE_TRANSLATOR_REGION ?? 'centralindia'
  const values = keys.map((k) => leaves[k])
  const out = {}
  for (let i = 0; i < values.length; i += 50) {
    const part = await batch(values.slice(i, i + 50), TARGETS[lang], key, region)
    part.forEach((t, j) => { out[keys[i + j]] = t })
    console.log(`[translator] ${lang}: ${Math.min(i + 50, values.length)}/${values.length}`)
  }
  let repaired = 0
  for (const k of keys) {
    const src = placeholdersOf(leaves[k])
    if (src.length && placeholdersOf(out[k]).join() !== src.join()) {
      for (const ph of src) if (!out[k].includes(ph)) { out[k] += ` ${ph}`; repaired += 1 }
    }
  }
  const { banned } = scanDraft(out)
  mkdirSync(TMP, { recursive: true })
  const dest = join(TMP, `${lang}.json`)
  const { unflatten: un } = await import('./translator-lib.mjs')
  writeFileSync(dest, `${JSON.stringify(un(out), null, 2)}\n`)
  console.log(`[translator] ${lang} -> ${dest} (repairs: ${repaired}, banned: ${banned.length})`)
  console.log(`[translator] NEXT: POEditor review -> app/locales/${lang}.json + ready:true in lib/i18n.tsx`)
}
