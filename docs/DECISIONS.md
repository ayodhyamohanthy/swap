# Decisions Log (append-only)

Agents: when you make a judgment call without Ayu, append one line here
in the same commit. Never edit or delete prior lines.

Format: `YYYY-MM-DD | L# | decision | why`

2026-09-29 | — | Ledger restructured to WIRED/RESERVE/BENCH; backup cron + exit playbook adopted | portability over migration
2026-09-30 | L9 | Wrote docs/18 (Azure Postgres migration plan) as a PROPOSAL only — no stack change, no ledger edit, no code | Ayu asked for prod on Azure, but agents.md §0 makes changing a non-negotiable rule a must-ask item, so the amendment lands before any code; the plan exists to make that call cheap to take or refuse
2026-09-30 | L9 | Took build-plan item 5 (BENCH/RESERVE vendor sweep + whitelist guard) instead of item 1 | Items 1-4 are all Ayu-blocked: item 1 needs a billing lock cleared or the repo made public (no `gh` here), item 2 needs a Supabase project created, item 3 needs 6 GH Actions secrets + an R2 lifecycle rule, item 4 is explicitly "Ayu does the claim"
2026-09-30 | L9 | Reversed the line above for item 2: did its two agent-doable clauses (prove the schema mirror, enforce "staging by default") and left the box `[ ]`, annotated, rather than skipping the whole item | "Ayu-blocked" was too coarse — only the *create* clause needs a human. Smallest reasonable choice: ship the part that is testable here, leave an unchecked box that names exactly what remains and who owns it, so a future `build` neither stalls on it nor redoes it. Same shape as the Azure pass (f9dfa48): dry-run proof green, human step named, no pretending.



