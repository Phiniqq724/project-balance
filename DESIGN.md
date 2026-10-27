# Balance design direction

Set by the owner on 2026-10-26.

- **Mood:** Instrument. Cool graphite, like a precise gauge. Numbers do the talking.
- **Theme:** dark only.
- **Type:** Satoshi (Fontshare), Regular / Medium / Bold.
- **Copy:** English, short. No long descriptions anywhere.
- **Spending grid:** GitHub-style green. Darker green = more spent that day.
- **Platform:** Android only, Jetpack Compose (`@expo/ui/jetpack-compose`) for all UI.

Dial: ENERGY 1 / RHYTHM 2 / MOTION 1

## Tokens (`src/theme.ts`)

| Token | Value | Use |
|---|---|---|
| bg | `#0B0D0E` | every screen |
| surface | `#131618` | sheets, nav bar |
| raised | `#1B1F22` | banners |
| line | `#23282C` | hairline rules, bar tracks |
| text | `#E6EAEC` | primary text, the lead bar, selected states |
| muted | `#8F989E` | secondary text, "Rp" prefix |
| accent | `#39D353` | money in, the spending grid. Nowhere else. |
| danger | `#F2867A` | errors, "access off" |

## Why

- Hairline rules instead of cards: an instrument reads as one panel, not a stack of tiles.
- Big Satoshi Bold totals with a small muted "Rp": the digits are the focal point on every screen.
- Green only for growth (money in) and heat (spending grid), so it always means something.
- Money out has no color, just a minus sign. Spending isn't an error.
