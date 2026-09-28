#!/usr/bin/env node
/* SeatSwap safety eval — the SHIPPED guardMessage() over safety-corpus.json.
 * $0 by default. With --azure + Content Safety env, also scores Azure
 * (capped: corpus only, ~$0.05). Never changes chat-guard.ts.
 *
 * WHAT IT MEASURES, PRECISELY. `src/lib/chat-guard.ts` — not a copy of it. That
 * distinction is the whole point, and the previous version of this file got it
 * wrong in the most expensive direction: when its dynamic import of the `.ts`
 * failed, it fell back to a regex MIRROR silently, and that mirror had none of
 * the guard's Hinglish, Devanagari or spaced-evasion rules. The output then
 * described the copy while looking exactly like an eval of the guard. The mirror
 * survives for old Node, but only behind an explicit `--mirror`, and it stamps
 * its own output `MIRROR MODE` so a number can never be quoted as the guard's.
 *
 * THE EXPECTATION TABLE IS PART OF THE MEASUREMENT, not a detail of it. `EXPECT`
 * says what each corpus label SHOULD do. It used to list only
 * `cash_en|upi|phone|hinglish`, so the guard's Hindi and obfuscation rules were
 * scored as false positives: 70.6% precision reported for a guard that actually
 * scores 100% on this corpus, and a "known gap: 0 hindi/obfuscated unflagged"
 * line printed directly above the ten messages it had just miscounted. A label
 * missing from the table is now a hard error rather than a silent "treat as
 * clean" — that silent default is how the table rotted in the first place.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const corpus = JSON.parse(readFileSync(join(HERE, 'safety-corpus.json'), 'utf8'))

/* corpus label -> should guardMessage() flag it? `clean` is the only negative. */
const EXPECT = {
  cash_en: true,
  upi: true,
  phone: true,
  hinglish: true,
  hindi: true,
  obfuscated: true,
  clean: false,
}

/* Returns the child's exit code, or null when relaunching is not possible or
   has already been tried (so a flagged child that still cannot import falls
   through to the honest refusal instead of forking forever). */
function relaunchWithTypeStripping(argv) {
  if (process.env.SEATSWAP_SAFETY_STRIP_TYPES === 'attempted') return null
  if (!process.allowedNodeEnvironmentFlags.has('--experimental-strip-types')) return null
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', fileURLToPath(import.meta.url), ...argv],
    { stdio: 'inherit', env: { ...process.env, SEATSWAP_SAFETY_STRIP_TYPES: 'attempted' } },
  )
  if (child.error) return null
  return child.status ?? 2
}

async function loadGuard(argv) {
  /* `--mirror` means "score the copy", not "score the copy only if I have to".
     Forcing it on a modern Node is what makes the mirror's own banner testable,
     and it is the honest reading of the flag. */
  const wantMirror = argv.includes('--mirror')
  let importable = false
  try {
    const mod = await import('../src/lib/chat-guard.ts')
    if (typeof mod.guardMessage === 'function') {
      importable = true
      if (!wantMirror) return { guard: mod.guardMessage, copy: false, banner: null }
    }
  } catch {
    /* No TS type stripping in this process. Fall through to the decision. */
  }
  if (!wantMirror) {
    /* Type stripping is not a simple version cutoff: Node 22.6 through 22.17
       strips types only behind --experimental-strip-types, and it is unflagged
       only from 22.18. So "re-run on a newer Node" was wrong advice on exactly
       the versions that can do this — 22.14 refused here while the same binary
       imports the guard fine with the flag. Re-exec ourselves once with it
       rather than scoring the copy, because the whole point of this file is
       that the number describes the shipped guard. */
    const relaunched = relaunchWithTypeStripping(argv)
    if (relaunched !== null) process.exit(relaunched)
    console.error(`[safety] cannot import ../src/lib/chat-guard.ts on ${process.version}.`)
    console.error('[safety] Refusing to score a regex copy by default — those numbers describe the copy,')
    console.error('[safety] not the shipped guard, and the previous version of this file reported them as')
    console.error('[safety] if they were the real thing. This Node cannot strip TypeScript even with')
    console.error('[safety] --experimental-strip-types (needs >= 22.6); re-run on a newer Node, or pass')
    console.error('[safety] --mirror to score the copy deliberately and read the banner it prints.')
    process.exit(2)
  }
  return mirrorGuard(importable ? 'chat-guard.ts imported fine, --mirror is deliberate' : 'chat-guard.ts could not be imported')
}

/* A strict SUBSET of the guard: no Devanagari list, no evasion squishing, no
   spelled-out digits. It exists so the corpus can still be eyeballed on a Node
   too old to import the guard — and so the difference between "the guard" and
   "a copy of the guard" stays visible rather than being a footnote. */
function mirrorGuard(why) {
  const UPI_ID = /[a-z0-9._-]{2,}@[a-z]{2,}/i
  const PHONE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/
  const WORDS =
    /\b(cash|upi|gpay|phonepe|paytm|pay\s?me|send\s+(me\s+)?money|transfer|account\s*(no|number|detail)|ifsc|qr(\s*code)?|bribe|tip\s*(me|us)?|extra\s*(money|cash|charge|fee|payment)|sell|buy|charge\s*(extra|more)|khareed|kharid|paise|paisa|nakad|nagad)\b/i
  return {
    copy: true,
    banner: `[safety] *** MIRROR MODE *** scoring the regex copy in this file, NOT chat-guard.ts (${why})`,
    guard: (text) => {
      const value = String(text ?? '')
      return { flagged: UPI_ID.test(value) || PHONE.test(value) || WORDS.test(value) }
    },
  }
}

const argv = process.argv.slice(2)
const { guard, copy, banner } = await loadGuard(argv)
if (banner) console.log(banner)

/* Every label in the corpus must be in EXPECT. An unrecognised label used to
   fall through every branch of the classifier and be counted nowhere at all —
   which is how a whole category disappears from a report while the run stays
   green. A loud failure is the better deal. */
const labels = [...new Set(corpus.messages.map((message) => message.label))]
const unknown = labels.filter((label) => !(label in EXPECT))
if (unknown.length > 0) {
  console.error(`[safety] corpus labels with no expectation: ${unknown.join(', ')}`)
  console.error('[safety] Add each to EXPECT in safety-eval.mjs. A label nobody scores is worse than a')
  console.error('[safety] failing run, because the run stays green while the category is ignored.')
  process.exit(1)
}

const perLabel = new Map(labels.map((label) => [label, { n: 0, flagged: 0, want: EXPECT[label] }]))
let tp = 0
let tn = 0
let fp = 0
let fn = 0
const misses = []
for (const m of corpus.messages) {
  const got = guard(m.text).flagged === true
  const want = EXPECT[m.label]
  const row = perLabel.get(m.label)
  row.n += 1
  if (got) row.flagged += 1
  if (want && got) tp += 1
  else if (want && !got) {
    fn += 1
    misses.push(`FN ${m.id} [${m.label}]: ${m.text}`)
  } else if (!want && got) {
    fp += 1
    misses.push(`FP ${m.id} [${m.label}]: ${m.text}`)
  } else tn += 1
}
const classified = tp + tn + fp + fn
const prec = tp + fp === 0 ? 1 : tp / (tp + fp)
const rec = tp + fn === 0 ? 1 : tp / (tp + fn)

console.log(`[safety] ${copy ? 'mirror' : 'shipped guard'}: TP=${tp} TN=${tn} FP=${fp} FN=${fn}`)
console.log(`[safety] precision=${(prec * 100).toFixed(1)}% recall=${(rec * 100).toFixed(1)}%`)
console.log('[safety] per label — want, then flagged/n:')
for (const [label, row] of perLabel) {
  console.log(`[safety]   ${label.padEnd(11)} ${(row.want ? 'flag' : 'clean').padEnd(6)} ${row.flagged}/${row.n}`)
}
console.log(`[safety] classified ${classified} of ${corpus.messages.length}`)
for (const m of misses) console.log(`  miss: ${m}`)
if (classified !== corpus.messages.length) {
  console.error('[safety] not every message reached a bucket, so the numbers above are not the corpus.')
  process.exit(1)
}

if (argv.includes('--azure')) {
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
    /* The same EXPECT table as the local pass, so the two are scored against one
       definition of "should flag" rather than two that can drift apart. */
    const want = EXPECT[m.label]
    if (want && flagged) atp += 1
    else if (!want && flagged) afp += 1
    else if (want && !flagged) afn += 1
  }
  console.log(`[safety] azure: TP=${atp} FP=${afp} FN=${afn} (corpus only, ~$0.05)`)
  console.log('[safety] NEXT: fold wins back into chat-guard.ts regex + tests, keep runtime free.')
} else {
  console.log('[safety] run with --azure + env to compare Content Safety (optional spend).')
}
