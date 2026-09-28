#!/usr/bin/env node
/* SeatSwap safety eval — local guardMessage() over safety-corpus.json.
 * $0 by default. With --azure + Content Safety env, also scores Azure
 * (capped: corpus only, 60 texts, ~$0.05). Never changes chat-guard.ts. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(readFileSync(join(HERE, 'safety-corpus.json'), 'utf8'))
const { guardMessage } = await import('../src/lib/chat-guard.ts').catch(async () => {
  const mod = await import('node:child_process').then(() => null).catch(() => null)
  void mod
  return { guardMessage: null }
}).catch(() => ({ guardMessage: null }))
let guard = guardMessage
if (typeof guard !== 'function') {
  /* vitest-style TS import won't run under plain node — replicate the
     regex rules here for a dependency-free eval (mirror, not source). */
  const UPI_ID = /[a-z0-9._-]{2,}@[a-z]{2,}/i
  const PHONE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/
  const CASH = /\b(cash|upi|gpay|phonepe|paytm|pay\s?me|send\s+(me\s+)?money|transfer|account\s*(no|number|detail)|ifsc|qr(\s*code)?|bribe|tip\s*(me|us)?|extra\s*(money|cash|charge|fee|payment)|sell|buy|charge\s*(extra|more)|khareed|kharid|paise|paisa|nakad|nagad)\b/i
  guard = (t) => {
    const v = String(t ?? '')
    return { flagged: UPI_ID.test(v) || PHONE.test(v) || CASH.test(v) }
  }
  console.log('[safety] note: TS guard not importable under plain node — using regex mirror.')
}
const argv = process.argv.slice(2)
const wantAzure = argv.includes('--azure')
const SHOULD_FLAG = new Set(['cash_en', 'upi', 'phone', 'hinglish'])
let tp = 0, tn = 0, fp = 0, fn = 0
const misses = []
const hindiGap = []
for (const m of corpus.messages) {
  const got = guard(m.text).flagged === true
  const want = SHOULD_FLAG.has(m.label)
  if (want && got) tp += 1
  else if (!want && !got && (m.label === 'clean')) tn += 1
  else if (!want && got) { fp += 1; misses.push(`FP ${m.id} [${m.label}]: ${m.text}`) }
  else if (want && !got) { fn += 1; misses.push(`FN ${m.id} [${m.label}]: ${m.text}`) }
  if ((m.label === 'hindi' || m.label === 'obfuscated') && !got) hindiGap.push(`${m.id} [${m.label}]: ${m.text}`)
}
const prec = tp + fp === 0 ? 1 : tp / (tp + fp)
const rec = tp + fn === 0 ? 1 : tp / (tp + fn)
console.log(`[safety] local guard: TP=${tp} TN=${tn} FP=${fp} FN=${fn}`)
console.log(`[safety] precision=${(prec * 100).toFixed(1)}% recall=${(rec * 100).toFixed(1)}%`)
console.log(`[safety] known gap (English-only regex, needs Azure eval): ${hindiGap.length} hindi/obfuscated unflagged`)
for (const g of hindiGap) console.log(`  gap: ${g}`)
for (const m of misses) console.log(`  miss: ${m}`)
if (wantAzure) {
  const ep = process.env.AZURE_CONTENT_SAFETY_ENDPOINT ?? ''
  const key = process.env.AZURE_CONTENT_SAFETY_KEY ?? ''
  if (!ep || !key) { console.log('[safety] --azure needs AZURE_CONTENT_SAFETY_ENDPOINT + KEY. Skipping (no spend).'); process.exit(0) }
  let atp = 0, afp = 0, afn = 0
  for (const m of corpus.messages) {
    const body = JSON.stringify({ text: m.text })
    const res = await fetch(`${ep.replace(/\/$/, '')}/contentsafety/text:analyze?api-version=2024-09-01`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key },
      body,
    })
    if (!res.ok) { console.log(`[safety] azure http ${res.status}, stopping (cap spend).`); break }
    const data = await res.json()
    const cats = data?.categoriesAnalysis ?? []
    const flagged = cats.some((c) => (c?.severity ?? 0) >= 2)
    const want = SHOULD_FLAG.has(m.label) || m.label === 'hindi' || m.label === 'obfuscated'
    if (want && flagged) atp += 1
    else if (!want && flagged) afp += 1
    else if (want && !flagged) afn += 1
  }
  console.log(`[safety] azure: TP=${atp} FP=${afp} FN=${afn} (corpus only, ~$0.05)`)
  console.log('[safety] NEXT: fold wins back into chat-guard.ts regex + tests, keep runtime free.')
} else {
  console.log('[safety] run with --azure + env to compare Content Safety (optional spend).')
}
