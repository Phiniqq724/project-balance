# Balance design direction

Set by the owner on 2026-10-26.

- **Mood:** Ember. Warm charcoal, like a banked fire. Numbers do the talking.
- **Theme:** dark only.
- **Type:** Satoshi (Fontshare), Regular / Medium / Bold.
- **Copy:** English, short. No long descriptions anywhere.
- **Spending grid:** Ember orange. Brighter = more spent that day.
- **Platform:** Android only, Jetpack Compose (`@expo/ui/jetpack-compose`) for all UI.

Dial: ENERGY 1 / RHYTHM 2 / MOTION 1

## Tokens (`src/theme.ts`)

| Token | Value | Use |
|---|---|---|
| bg | `#1A1614` | every screen |
| surface | `#221D1A` | sheets, nav bar |
| raised | `#2B2521` | banners |
| line | `#3A322C` | hairline rules, bar tracks |
| text | `#F3EBE2` | primary text, the lead bar, selected states |
| muted | `#AC9F92` | secondary text, "Rp" prefix |
| accent | `#FF7444` | money out: heat grid, spend bars, out amounts, the chart's today dot, inbox badge |
| income | `#9BCB9F` | money in: sage text, split bar, received series |
| danger | `#F07AAE` | errors, "access off" |

## Why

- Hairline rules instead of cards: an instrument reads as one panel, not a stack of tiles.
- Big Satoshi Bold totals with a small muted "Rp": the digits are the focal point on every screen.
- Orange only for spending heat, sage only for money in, pink only for errors, so each color always means something.
- Money out has no color, just a minus sign. Spending isn't an error.
