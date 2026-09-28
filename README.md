# SeatSwap — Build Pack

Give this whole folder to your AI coding platform or developer.

- `SeatSwap-build-spec.pdf` — everything below in one document, plus all design screens.
- `agents.md` — the rules an AI agent must follow (most tools read it automatically).
- `docs/` — read in order `01` → `14`. Collaboration + infra:
  `docs/11-COLLAB.md` (git discipline), `docs/12-INFRA-CREDITS.md` (stack,
  credits, spend rule), `docs/13-COLLAB-CONTRACT.md` (one lane per agent) and
  `docs/14-LANES.md` (claim your lane before editing).
- `designs/` — screen images (3 phone screens per image; admin pages are single). Use them for layout and wording; the rules in `agents.md` win if an image disagrees.
- `SeatSwap-journeys.html` — clickable walkthrough (Requester / Acceptor / Admin).

Suggested first prompt for an AI builder:
> Read agents.md, docs/11-COLLAB.md, docs/12-INFRA-CREDITS.md and
> docs/13-COLLAB-CONTRACT.md. Claim ONE lane in docs/14-LANES.md, then build
> it in `app/` (TanStack Start PWA) to match `designs/` and the PDF. Build
> keyless — keys come later. Green rule before every commit.

