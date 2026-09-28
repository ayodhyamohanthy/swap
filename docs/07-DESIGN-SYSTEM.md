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

## Responsive

Added 2026-09-29 (Mavis/MiniMax, lane L9). The app was "mobile-first" in the
sense that the phone column was capped at 34rem and centred — which is correct
on a phone and simply leaves the screen empty on anything wider. Fixed-width
centre, not a layout that adapts.

**Breakpoints.** Three, mobile-first (`min-width`, so a phone never downloads a
rule it does not need):

| Name | Width | Layout |
|---|---|---|
| `base` | 360–639px | single column, full width. The design reference is drawn at 360–430. |
| `md` | ≥640px | single column centred, max **34rem** (544px). Content column stops growing. |
| `lg` | ≥1024px | admin tables go multi-column; phone screens stay the same centred column. |

**Rules that matter, in order of how often they get broken:**

1. **No horizontal scroll at 360px.** If a card does not fit, the content is
   too long or the padding is too big — not the breakpoint. Long values
   (`truncate`, `break-words`) rather than a wider column.
2. **Safe areas are not padding.** `env(safe-area-inset-*)` for the notch and
   the home indicator; `viewport-fit=cover` is already in the shell.
3. **Touch targets stay ≥44px** at every width. Widening a column never
   shrinks a target; `min-height: 3rem` on `.tap` is a floor, not a default.
4. **Test widths: 360 / 430 / 768 / 1440.** A screen ships only after all four.
   360 catches overflow, 430 catches iPhone Pro Max, 768 catches tablet portrait
   where a two-column assumption usually shows up, 1440 catches desktop.
5. **Never hide content to make it fit.** Responsive means reflow, not fewer
   features. The 3 tabs, the copy, and the numbers stay identical at every width.

**Text:** body 16px minimum on `base`; never go below 14px for any text a
passenger must read to make a decision (rule 4 credit, rule 6 no-swap promise,
₹ amounts). Fluid type is allowed but must not drop below those floors.

**`.app-column`** is the single constraint: `margin-inline: auto;
max-width: 34rem`. Phone routes already use it. Anything that needs a wider
grid belongs to the admin routes, which are desktop-first and already are.

## Components
Top bar (wordmark "SeatSwap" left, settings icon right) · bottom tab bar (Home, Swaps, Profile) · trip card · berth chip ("Berth ••" before payment) · match row (initials avatar, "✓ Google verified", berth type, coach, choice rank) · primary button · outline button (saffron) · check row · price breakdown card · status timeline · chat bubbles + quick-reply chips · empty state with single action · offline banner.

## Wording rules
- Use: "Swap summary", "thank-you credit", "No swap? ₹99 goes to your credit", "Pay only inside SeatSwap", "SeatSwap is not an official railway service."
- Never: TTE, pass, official, Indian Railways, authorised, legal, grievance, refund-to-bank (except bank failure).
- Before payment always "Berth ••".

## Logo
Use one wordmark everywhere: "SeatSwap" in Plus Jakarta Sans 700, primary green. The design images vary slightly; follow this rule, not the images.
