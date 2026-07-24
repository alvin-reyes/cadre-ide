# Carde — Brand Guide v1

Carde is an agile automation platform that AI-generates end-to-end software engineering
artifacts (PRDs, tickets, tests, code) for AI-native agencies.

Voice: confident, technical, dev-forward. Show the machine working. No fluff.

---

## 1. Logo

**The mark** — three offset cards (the agile backlog) resolving into a single generated
artifact, cut by a diagonal spark: automation moving work forward. The negative-space
slash reads as both a card edge and a forward slash of code.

Files (in `/assets`):
| File | Use |
|---|---|
| `carde-mark.svg` | Full-color mark, **dark** backgrounds |
| `carde-mark-light.svg` | Full-color mark, **light** backgrounds |
| `carde-mark-mono-white.svg` | Single-color, dark bg (slash knockout) |
| `carde-mark-mono-ink.svg` | Single-color, light bg |
| `carde-mark-mono-violet.svg` | Single-color brand |
| `carde-logo-horizontal-dark.svg` | Mark + wordmark, dark bg |
| `carde-logo-horizontal-light.svg` | Mark + wordmark, light bg |
| `carde-app-icon.svg` | macOS squircle app icon (512) |
| `favicon.svg` | Browser / small glyph |

### Rules
- **Clearspace:** keep empty space equal to ½ the mark height on all sides.
- **Minimum size:** 24px for the mark, 20px for the mono/favicon glyph.
- **Wordmark:** Space Grotesk Bold, letter-spacing -0.03em.
- **Never** recolor the spark, add effects/shadows to the mark itself, stretch it,
  or place the dark-bg mark on a light background (use the light variant).

---

## 2. Color

### Brand
| Token | Hex | Role |
|---|---|---|
| Signal Violet | `#6D5EF8` | Primary — actions, focus, brand |
| Deep Indigo | `#3A2ED0` | Gradient end, depth |
| Mint | `#8CE0C0` | Success / positive / progress |
| Cloud | `#F5F5F7` | Light surfaces |
| Ink | `#0B0B12` | App background |

Brand gradient: `linear-gradient(150deg, #6D5EF8, #3A2ED0)` — primary buttons, app icon.

### Dark UI neutrals
Surfaces `#06060B → #0A0A11 → #0E0E17 → #101019 → #12121C` (deep → raised).
Borders `#16161F` (soft) · `#1E1E2C` (default) · `#2A2A3C` (strong).
Text `#EDEDF2` · `#B8B8C6` · `#9A9AAE` · `#6E6E82` · `#4A4A5C` (primary → faint).

### Semantic
Success `#8CE0C0` / `#28C840` · Warning `#FEBC2E` · Danger `#FF5F57` / `#FF7A7A`.

Use max 1–2 background colors per surface. Max 1 primary action per view.

---

## 3. Typography

| Role | Family | Notes |
|---|---|---|
| Display / headings | **Space Grotesk** (400–700) | tight tracking, -0.02 to -0.03em |
| Body / UI | **Inter** (400–600) | line-height 1.5–1.6 |
| Code / labels / meta | **JetBrains Mono** (400–500) | uppercase labels, 0.2em tracking |

Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

Minimums: body 13px in UI, never below 11px for mono meta labels.

---

## 4. Tokens

- `carde-tokens.css` — CSS custom properties. Import and use `var(--carde-violet)` etc.
- `carde-tokens.json` — same values as data for JS/Tailwind/Style Dictionary.

Radii: 8 / 12 / 16 / 20 / pill. Spacing on a 4px base (4·8·12·16·20·26·40).
Shadows: card, pop, and brand-glow (see tokens).

---

## 5. Product UI patterns
- Cards on `--carde-surface-3` with `--carde-border`, radius 12.
- Primary buttons: brand gradient + `--carde-shadow-brand`.
- "Generating" state: 2px shimmer top-border + violet card tint.
- Mono status labels in uppercase with 0.1–0.2em tracking.
- Status dots: success mint, in-progress violet (pulsing), warning amber, queued muted.
