
# 10 — Build Plan
Format: each lane owns a checklist. "build"/"continue" = first [ ] in
your lane. Check it [x] in the same commit that completes it.

## L9 — Infra & tooling
- [ ] Unblock GitHub Actions: clear billing lock or make repo public;
      seatswap-ci must run green in the cloud on next push
      (**Correction, 2026-09-30 — the box is `[ ]` here and `[x]` on main, and
      main is right.** `origin/main` closed this: the repo is public, so the
      billing lock no longer blocks jobs, and run 36668939334 went green. This
      branch is 11 commits behind that point, so everything below was written
      against a stale view of the item and is kept only for the two additions
      main does not have — `workflow_dispatch` and `permissions: contents:
      read` on `green.yml`. Corrected rather than left describing a blocker
      that no longer exists.)
      (the buildable half is done; the unlock itself is Ayu's — a billing lock
      or a private repo is not something an agent here can change, and `gh` is
      not installed. **Checked, so the first run is not red for a fixable
      reason:** `npm ci` will resolve — verified offline against the committed
      lock (root `workspaces: ["app"]`, lockfileVersion 3, all 27 of
      `app/package.json`'s deps present at the declared version with a resolved
      package entry each). A stale lock is the usual cause of a red first run
      and it is not this one. Both workflows were also parsed with an
      INDEPENDENT YAML implementation (js-yaml, already in node_modules) as
      well as the repo's own reader: `green.yml` is 7 steps and references no
      secret at all, so nothing about it needs a key to be green. **Fixed:**
      `green.yml` had no `workflow_dispatch` and matched only `main`, while the
      lanes work on `docs/instructions-v2` — so the only way to discover
      whether CI worked was to land on main, the one place a red result is
      expensive. It now has `workflow_dispatch` and `contents: read`.
      **Deliberately not changed:** `npm run test` pins `maxWorkers: 4`
      (`app/vitest.config.ts`, which follows L1) and docs/14 records that under
      contention those workers drop files while still reporting "N passed" — a
      green that is not a green. Unmeasured on a dedicated runner, so the
      setting was not guessed at; what matters is reading the FILE count in the
      log against `ls app/tests/*.test.*`. **Also recorded:** the workflow's
      `name:` is `green` while this item and docs/15-NAMING both call it
      `seatswap-ci`. Left as `green` because a required status check is keyed
      on that exact string, so renaming it to match the docs could silently
      stop a merge gate from ever being satisfied — filed on the board instead.)
- [ ] Create Supabase project seatswap-staging; mirror schema via
      migrations; agents point at staging by default
      (2026-09-30, L9 — two of the three clauses are done; the box stays
      open because the first is Ayu's and nothing here can do it: no
      Supabase access token, no `supabase` CLI, no `~/.supabase`, zero GH
      secrets in this environment. **Done:** the mirror is *proved* rather
      than assumed — `scripts/staging-lib.mjs` identifies every object a
      fresh apply creates (112 objects from 112 CREATE statements in
      `_init.sql`, 0 unrecognised statement kinds) and asserts
      migration #1 == `schema.sql` == the concatenation of `parts/`, so
      drift between the three copies now fails a test instead of shipping;
      `node app/scripts/staging-dry-run.mjs` prints the ordered apply
      commands and exits non-zero on any blocking finding, with no network
      reach at all (proved structurally — it imports only `node:fs`,
      `node:path`, `node:url` — and run under `azure/no-net.mjs` with 0
      recorded attempts). "Agents point at staging by default" is enforced
      rather than prose: docs/12 §4 gained a parseable env→project-ref
      table, and `collab-check` check 7 fails if any committed file names a
      Supabase project whose ref is not recorded there — mutation-checked
      against an unknown ref, a blind parser, and a recorded *prod* ref.
      **Still Ayu:** create seatswap-staging (free plan), then paste its
      project ref into that table; the dry run prints the exact
      Management-API `curl` body. **Blocked on L8, filed as requests:**
      `<repo>/supabase/migrations` does not exist, so a CLI-driven
      `supabase db push` from the repo root provisions an EMPTY database;
      and a stale fourth copy at `supabase/schema-steps-1-2.sql` collides
      with the canonical schema on 10 objects.)
- [ ] Backup workflow: commit .github/workflows/seatswap-backup.yml
      (file provided in handoff), add the 6 GH Actions secrets per
      docs/12 §8, set R2 30-day lifecycle rule, verify one manual run
      (workflow_dispatch) succeeds end-to-end
      (the two clauses an agent can do are done — **the workflow now exists
      where GitHub reads it, and the six defects the handoff shipped are
      fixed and guarded.** The handoff file was committed to `workflows/` at
      the repo ROOT, which GitHub never reads, so the nightly backup had never
      existed; it is now `.github/workflows/seatswap-backup.yml`, and
      `collab-check` check 8 fails if it moves or if a stray copy reappears.
      Fixed and enforced: `pg_dump | gzip` had no `pipefail`, so a dump that
      died mid-stream exited 0 and shipped as a good backup (measured:
      `false | gzip > f` is exit 0 under `-e`, 1 under `pipefail`); the
      ZeptoMail alert sent a bare token where the API requires the
      `Zoho-enczapikey` prefix, so it could never have delivered; `curl -s
      … || true` swallowed a rejected send; the only dump check was a size
      floor on the COMPRESSED file, which a partial dump of a real database
      passes (fixture: 8 of 21 tables, 24 KB plain); it omitted the
      `--clean --if-exists` docs/16's own restore drill needs; and nothing
      distinguished the prod database from staging. Decisions live in
      `scripts/backup-contract.mjs` (pure, no imports), which parses the
      workflow name, cron, bucket, retention and object key out of docs/12 §5
      and docs/16, and the secret set out of §8, at check time — the docs stay
      the source of truth. 56 tests, including a table of 31 mutations of the
      SHIPPED workflow, each caught, and each asserted to have applied first so
      a stale search string cannot pass vacuously. **Still Ayu:** add the 6
      secrets, set the R2 30-day lifecycle rule, enable GitHub's own
      failure notification, verify one `workflow_dispatch` run. The alert
      sender is `alerts@seatswap.invalid` until item 4's domain is verified in
      Zoho; GitHub's own failure notification is the backstop until then.
      One request filed: docs/15-NAMING lists `seatswap-backup-prod` as a
      Cloudflare WORKER, and docs/12 §1 says the backup is "NOT a Cloudflare
      Worker" — it is the workflow's name.
      **Merge hazard, found by comparing against `origin/main`:** main carries
      this file at BOTH `.github/workflows/seatswap-backup.yml` and the root
      `workflows/seatswap-backup.yml`, and the two copies differ from each
      other. Main's live copy is partially fixed — it has `pipefail` and the
      `Zoho-enczapikey` prefix, so a second agent fixed those in parallel — but
      it still has no `--clean --if-exists`, no `--no-owner`/`--no-privileges`
      and no upload verification, so docs/16's own restore drill would stop on
      the first duplicate object. Both lineages add
      `.github/workflows/seatswap-backup.yml` from the same base, so merging
      this branch into main is an **add/add conflict** on that path, and the
      resolution is this branch's version. The root copy is deleted here, so
      the merge removes main's stray one — which is the duplicate that
      `collab-check` check 8 exists to catch. Not resolved here: merging main
      into this branch is a larger call than this lane's standing approval.)
- [ ] Claim Student Pack domain (Namecheap .me or Name.com) → Cloudflare
      DNS, TTL 300 (Ayu does the claim; agent wires DNS + wrangler routes)
      (the agent-doable half is done and it is not the wiring — it is giving the
      name one authority and checking the world against it. **Nothing decided
      the domain: nine tracked files stated it and none of them owned it** —
      `CNAME`, `app/wrangler.toml` (×2), `app/azure/README.md`,
      `app/tests/qa-placeholders.test.ts`, `docs/16-BEST-PRACTICES.md`,
      `docs/17-PRODUCTION-PATH.md`, this file's own Placeholders line, a dated
      log in `.workbuddy-ai/` and a vendored build-pack copy — while docs/12,
      the ledger this lane owns, never mentioned it, and "TTL 300" existed only
      as prose in docs/16-EXIT-PLAYBOOK. (The scan now counts eleven: §4.1 and
      docs/DECISIONS.md name the domain as well, which is why both sit in the
      Excluded table — recording a value adds a file that holds it, and a count
      written in prose does not notice.) docs/12 §4.1 is now the source of
      truth: the domain, its status, the TTL, where the zone must live, the
      records Cloudflare must hold, every path that must name it, and the four
      paths allowed to go stale on a swap.
      `scripts/domain-lib.mjs` (pure, imports nothing) parses those four tables
      at check time instead of carrying a second copy of a value this item
      exists to change; `scripts/domain-dry-run.mjs` compares the tracked files
      against it, walks the whole repo for a file naming the domain that is in
      NEITHER §4.1 table, and asks DNS — read-only `node:dns` + `dig`, no
      credentials, no `fetch`, every query recorded and counted in its exit
      token. The walk is what makes the ledger self-policing: the drift check
      can only ever disagree with the paths §4.1 lists, so a ledger missing a
      row was indistinguishable from a repo with nothing to check — and it
      caught this pass's own test file hardcoding the name, on the run that
      introduced it. It walks the filesystem rather than `git grep`, so an
      untracked scratch file naming the domain reddens `npm run test` for every
      lane until §4.1 lists it or excludes it with a reason; that is the point,
      but it is a shared-tree hazard and is named here rather than discovered.
      92 tests, and the guard's own claims were mutation-checked: 52 defects
      planted one at a time (a bare `endsWith` that accepts `evilexample.com` as
      a subdomain of `example.com`, a `dns-ttl` defaulting to 300 nobody chose,
      "zero rows parsed" read as "nothing to check", a commented routes line
      counted as live, `--offline` that still queried, drift demoted to a note,
      the Excluded table parsed and then dropped, a walk that never enters a
      subdirectory, a byte cap that skips every file, `scanned: 0` accepted as a
      complete scan), each verified to have APPLIED before its catch was
      believed — one mutant survived the first pass and a second survived the
      harness's extension to the new guards, and those two are why
      `attachVerdict`'s early return and section 5's "the scan read nothing"
      wording each have their own test. **Re-measured rather than trusted:** the
      blocker lived in a comment in `app/wrangler.toml` dated 2026-09-29, and
      comments do not notice when the world changes, so `dig NS` was run again at
      2026-10-01T13:40Z — still `dns1`/`dns2.registrar-servers.com`, still
      NameCheap, so the zone is not attachable, the routes line must stay
      commented, and `wrangler deploy` would fail "zone not found". **Still
      Ayu:** claim the domain, move its nameservers to the pair Cloudflare
      assigns, set the TTL to 300 — nothing in this repo can do any of the three,
      and the dry run now says so naming who owes it. **Owed to L1, not here:**
      "agent wires DNS + wrangler routes" is L1's file per docs/13, so this lane
      can only report that the routes line is still commented and name L1 as the
      one allowed to uncomment it. **Two findings, both filed as requests:**
      `app/tests/qa-placeholders.test.ts` checks a hardcoded `/toyoufromme/i`
      regex, so the day the name in §4.1 changes it keeps passing while checking
      nothing — the new domain will be absent from the bundle because it is
      nowhere in the source, not because the guard held; and that file is in no
      lane's ownership map at all (added by `72628db`, whose entire commit
      message is the character `0`), which is the dead-surface class Check 9 was
      just written for. Also: item 3's backup alert sender
      `alerts@seatswap.invalid` can never verify in Zoho because `.invalid` is
      reserved, so the nightly failure notice stays undeliverable until this
      item closes. **The item contradicts itself and was decided the small
      way:** it names a "Student Pack domain (.me or Name.com)" while the repo
      has already planned `toyoufromme.website`; guessing the name is not this
      lane's call, so what was built is the swap being *safe* — editing docs/12
      §4.1 is now the whole change, and everything else is checked against it.
      Recorded in docs/DECISIONS.md. **Already CI-enforced — the first draft of
      this line claimed it was not, and the claim was checked rather than
      kept:** `green.yml` runs `npm run test`, `vitest.config.ts` includes
      `tests/**`, and `tests/domain-lib.test.ts` runs the dry run against the
      real repo asserting exit 0, so drift or a file the ledger does not account
      for fails CI today. What IS deferred while L9 is held `active:` is only
      the `collab-check` guard (Check 10; Check 9 is that agent's in-flight
      work), which would surface the same finding locally and under `--fast` —
      where `SKIP_GREEN` skips typecheck and the suite entirely, so neither the
      pre-commit path nor CI's own collab-check step currently looks.)
- [x] Sweep: verify no BENCH/RESERVE vendor SDK exists in package.json
      or code; remove any found; add collab-check rule enforcing the
      docs/12 §2 whitelist
      (sweep found none — 27 deps + 663 imports, all clean; the rule is
      `collab-check` check 6, fed by `scripts/vendor-whitelist.mjs`)
- [x] Mobile-first audit: run every existing screen against
      docs/17-MOBILE-FIRST.md (360px baseline, 44px targets, 16px
      inputs, safe-area insets, manifest maskable icons, bundle
      ≤200KB gz); file one fix task per violation in the owning lane
      (audited 0078bcf: all six compliant — viewport-fit=cover, .tap
      48px / Input min-h-12, --text-body 1rem = 16px, safe-area-inset-bottom
      on the bottom nav, maskable-512 in the manifest. The budget was the
      one rule docs/17 calls "CI-enforceable" that nothing enforced; it
      measured 189.3 KB gz of 200 and is now checked by verify-dist §5b.
      One contract-vs-guard contradiction filed as a request.)
- [x] Payments: make Razorpay the single primary gateway for domestic
      AND international; demote PayPal to fallback path only; update
      docs/06-PAYMENTS.md to match
      (all three clauses closed 2026-10-02. **The code clause needed the two
      lanes the request named, and the answer is that the screen asserted
      "international ⇒ PayPal" through its STRUCTURE rather than through any
      sentence** — one section headed `pay.inIndia` held the whole card rail, a
      second headed `pay.intl` held nothing but the PayPal button. Every string
      involved read fine, which is why it survived a by-locale copy check and a
      JSX review. Shape (a) of the two options on the board, because rule 9
      names the label "International traveller? Pay with PayPal" and that line
      has to survive: the card rail is now headed `pay.razorpay` with no country
      on it, `pay.inIndia` is deleted so the key that carried the framing cannot
      return as dead copy, and `pay.intlNote` ("Not in India? A foreign card
      works in the options above too.") sits ABOVE the PayPal button — above,
      because a correction printed under it still reads "abroad ⇒ PayPal" with a
      footnote. **A second duplicate went with it:** `pay.paypalAlt` already held
      rule 9's label verbatim, so `pay.intl` and `pay.paypalAlt` were one
      sentence under two keys, either of which could be reworded alone. Deleted.
      `tests/pay-provider-primary.test.ts` (12 tests, 10 mutations planted one at
      a time and all caught) pins the headings read out of the shipped file, the
      ordering, the label in BOTH languages, and the docs clause — including a
      check that the guard's own heading pattern still matches, since a pattern
      matching nothing reports green. **The docs clause** is docs/06 §Status,
      rewritten from "what this doc does not yet match" to what the screen now
      does, keeping the three findings as the record of why. **The Ayu dependency
      is gone:** docs/12 §1 was amended 2026-10-02 and no longer contradicts §2,
      so nothing about this item is waiting on a human.)

## L1..L8 — (existing feature lanes: keep current tasks, converted to [ ]/[x])




# 10 — Build Plan (in order)

1. **Foundation:** TanStack Start app, design tokens, 3-tab shell, i18n (en, hi), PWA manifest.
2. **Trips:** add PNR (type/paste SMS parse), multiple PNRs, passengers, statuses (WL/RAC/CAN), quota, chair car, child-no-berth. Works signed out (local), synced after sign-in.
3. **Auth:** Google sign-in, profiles, privacy consent, user_roles + has_role.
4. **Requests & matching:** ranked choices, matches list with hidden berths, send to many free, offers, Updates list, "You're the first", share sheet (WhatsApp, Instagram, Facebook, Telegram, SMS, Copy, QR).
5. **Acceptor:** open to swap, filters, incoming request, accept/decline, waiting for payment, "someone was faster".
6. **Payments:** Razorpay + PayPal + credit, webhooks, receipts, pending/failed states.
7. **Locked swap:** berth reveal, chat with risky-message guard, report/block, Found each other, Swap summary offline.
8. **Outcomes:** Did you swap?, credit rules, disputes, auto-confirm job, rating, share cards, acceptor nudge.
9. **Changes:** PNR cancelled, berth changed, partner cancelled, cancel swap.
10. **Groups:** link PNRs, family plan, ₹199 group payment, swapping for parents, easy mode.
11. **On board:** live coach board until your stop.
12. **Admin:** overview, activity log, users, swaps, payments, credits, reports, CSV export.
13. **Growth extras:** public train pages (SEO), free berth check, chart-time push, welcome back, credit reminders, install prompt.
14. **QA:** every flow in 04-FLOWS.md end to end on a 360 px Android device, offline tests, webhook replay tests.

## Definition of done
- All non-negotiable rules in AGENTS.md pass a manual checklist.
- No banned words anywhere (grep the locales).
- Every state change writes activity_log.
- Lighthouse PWA installable; first screen usable on slow 3G.

## Placeholders to replace
Domain (currently planned: toyoufromme.website), example names (Arjun, Priya, Riya), admin figures, QR pattern, US$ estimate.
