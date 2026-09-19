# AGENTS.md — System Operating Manual for AI Engineers

This document governs all AI-driven contributions, refactors, and terminal executions in this repository. Read and follow these principles strictly before inspecting or altering any code.

---

## 1. Prime Directives (Non-Negotiable)

1. **Surgical Diffs Over Rewrites:** Never rewrite whole files when a localized function change suffices. Preserve existing formatting, imports, and non-targeted utilities.
2. **Deterministic Schemas:** Treat all database models, API payloads, and component props as strictly typed contracts. Never assume optional fields or mutate schemas without explicit instruction.
3. **Fail Fast & Loud:** Do not swallow errors in empty `catch` blocks or return mock objects silently. Every failure must produce readable logs with error boundaries or structured responses.
4. **Zero Package Hallucinations:** Before importing a third-party dependency, check `package.json`. If a new dependency is required, justify it explicitly and confirm installation commands before proceeding.
5. **No Regressions on Working Code:** Run existing tests or check dependent modules before declaring an issue resolved.

---

## 2. Tech Stack & Environment Reference

Fill in your active stack so agents avoid guessing variants:

* **Runtime & Framework:** Next.js (App Router) / Node 22 / TypeScript
* **Styling & Components:** Tailwind CSS / shadcn/ui / Lucide Icons
* **Database & ORM:** Supabase (PostgreSQL) / Prisma OR Drizzle
* **State & Data Fetching:** TanStack Query / Server Actions / Zustand
* **Authentication:** NextAuth / Clerk / Supabase Auth
* **Validation:** Zod for all server inputs, query params, and API boundaries

---

## 3. Architecture & File Layout Conventions

Follow the repository directory boundaries without creating arbitrary top-level folders:

```text
├── app/                  # App Router pages, layouts, and route handlers
│   ├── api/              # Isolated HTTP endpoints (JSON / Webhooks)
│   └── (routes)/         # Route groups and views
├── components/
│   ├── ui/               # Primitive, headless design tokens (shadcn/Radix)
│   └── shared/           # Composed application-specific widgets
├── lib/
│   ├── utils.ts          # Pure helper utilities (date formatting, cn)
│   └── validations/      # Canonical Zod schemas
├── server/
│   ├── actions/          # Safe Server Actions with input parsing
│   └── db/               # Client connections, migrations, and queries
├── types/                # Ambient and global TypeScript interfaces
└── public/               # Static assets (SVGs, icons, illustrations)