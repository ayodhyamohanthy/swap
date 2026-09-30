/* vendor-whitelist.mjs — the docs/12 §2 vendor whitelist, as pure functions.
 *
 * WHY THIS IS A SEPARATE FILE, and why it has no imports. Same reason as
 * `lane-board.mjs`: `collab-check.mjs` imports `node:child_process` and
 * `node:fs`, and docs/11 records what that costs under the jsdom pool. A test
 * cannot import the CLI, so anything worth testing lives where a test can reach
 * it. This module is strings in, decisions out — no filesystem, no git.
 *
 * WHY IT IS WORTH TESTING. The rule it enforces is a sentence in docs/12 §2 —
 * "only vendors marked WIRED in docs/12 §2 may appear in code, package.json, or
 * config" — and until now nothing checked it. A rule that only exists as prose
 * is a rule that holds until the first agent who has not read it.
 *
 * WHY IT DERIVES THE LIST INSTEAD OF HARDCODING IT. A hand-curated list of
 * banned packages only guards what someone remembered to list, and it silently
 * rots the moment a vendor is added to the ledger. So the vendor names AND
 * their statuses are parsed out of docs/12 §2 at check time: adding a vendor
 * there brings it under the guard automatically, and moving a row from RESERVE
 * to WIRED is the only thing that permits its SDK. The ledger stays the single
 * source of truth, which is what it claims to be.
 *
 * THE FALSE-POSITIVE TRADE-OFF, stated because it is a real one. Matching is
 * substring-based on normalised names, so a package that merely contains a
 * banned vendor's name is reported. That is deliberate: for a whitelist, a
 * false positive costs one line in a config file, while a false negative ships
 * a vendor we have not agreed to. The report names the vendor and the status,
 * so the fix is obvious rather than a hunt.
 */

/** Lowercase, letters and digits only — so `@supabase/supabase-js` and
 *  `Supabase` compare on equal footing. */
export function normalise(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Vendor rows from the docs/12 §2 ledger table.
 *
 * The table is `| Vendor | Credit / plan | Job | Status | Never for |`, so the
 * status is cell 4. Header and separator rows are rejected by requiring the
 * status cell to be a single ALL-CAPS word: the header's is `Status`, and a
 * separator row's is dashes. Requiring a known status instead would silently
 * drop any row whose status someone invents later, which is exactly the
 * "guards only what it was told about" failure this file exists to avoid.
 *
 * @returns {{ name: string, status: string }[]}
 */
export function parseVendorLedger(ledgerText) {
  const out = []
  for (const line of String(ledgerText ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.split('|').map((c) => c.trim())
    if (cells.length < 6) continue
    const name = cells[1]
    const status = cells[4]
    if (!name || !/^[A-Z]+$/.test(status)) continue
    out.push({ name, status })
  }
  return out
}

/**
 * The vendor a package name belongs to, or `null` when it names none.
 *
 * Longest token first, so a vendor whose name is a prefix of another cannot
 * shadow it.
 */
export function vendorFor(packageName, vendors) {
  const target = normalise(packageName)
  if (!target) return null
  const ranked = [...(vendors ?? [])].sort(
    (a, b) => normalise(b.name).length - normalise(a.name).length,
  )
  for (const vendor of ranked) {
    const token = normalise(vendor.name)
    if (token && target.includes(token)) return vendor
  }
  return null
}

/**
 * Every entry that names a vendor whose status is not `WIRED`.
 *
 * Takes bare specifiers as well as dependency names — an import and a
 * dependency are the same question asked of different files, so they share one
 * implementation and cannot drift.
 *
 * @returns {{ pkg: string, vendor: string, status: string }[]}
 */
export function findBanned(findings, vendors) {
  const out = []
  for (const pkg of findings ?? []) {
    const vendor = vendorFor(pkg, vendors)
    if (vendor && vendor.status !== 'WIRED') {
      out.push({ pkg, vendor: vendor.name, status: vendor.status })
    }
  }
  return out.sort((a, b) => a.pkg.localeCompare(b.pkg))
}

/**
 * Bare module specifiers in a source file: `from 'x'`, `import 'x'`,
 * `import('x')`, `require('x')`. Relative and absolute paths are dropped —
 * they name no vendor.
 */
export function importSpecifiers(sourceText) {
  const out = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g
  for (const match of String(sourceText ?? '').matchAll(re)) {
    const spec = match[1]
    if (spec.startsWith('.') || spec.startsWith('/')) continue
    out.push(spec)
  }
  return out
}
