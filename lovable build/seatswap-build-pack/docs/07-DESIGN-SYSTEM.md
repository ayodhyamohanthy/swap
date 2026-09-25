# 07 — Design System ("calm, like WhatsApp")

## Principles
- One clear primary button per screen. Lots of white space. Plain lists. Big tap targets (min 48 px).
- Short sentences, everyday words. Numbers large (₹99, ₹50).
- Works on cheap Android phones: fast first load (< 200 KB JS for first screen goal), no heavy animation.

## Tokens
| Token | Value | Use |
|---|---|---|
| `--primary` | #1F6B45 (deep green) | buttons, active tab, ticks |
| `--accent` | #F2A33A (saffron) | credit, highlights, secondary outline buttons |
| `--background` | #FAF6EE (cream) | app background |
| `--card` | #FFFFFF | cards |
| `--ink` | #1D2A22 | text |
| `--muted` | ink at 55% | secondary text |
| `--danger` | #C2410C | warnings (sparingly) |
| radius | 16 px cards, 14 px buttons, full for chips |
| shadow | very soft (0 1px 2px / 6%) |

## Type
Headings: Plus Jakarta Sans 700. Body: Inter 400/500 (Devanagari fallback: Noto Sans Devanagari). Sizes: title 26, section 17, body 15, caption 12. Easy mode ×1.15.

## Components
Top bar (wordmark "SeatSwap" left, settings icon right) · bottom tab bar (Home, Swaps, Profile) · trip card · berth chip ("Berth ••" before payment) · match row (initials avatar, "✓ Google verified", berth type, coach, choice rank) · primary button · outline button (saffron) · check row · price breakdown card · status timeline · chat bubbles + quick-reply chips · empty state with single action · offline banner.

## Wording rules
- Use: "Swap summary", "thank-you credit", "No swap? ₹99 goes to your credit", "Pay only inside SeatSwap", "SeatSwap is not an official railway service."
- Never: TTE, pass, official, Indian Railways, authorised, legal, grievance, refund-to-bank (except bank failure).
- Before payment always "Berth ••".

## Logo
Use one wordmark everywhere: "SeatSwap" in Plus Jakarta Sans 700, primary green. The design images vary slightly; follow this rule, not the images.
