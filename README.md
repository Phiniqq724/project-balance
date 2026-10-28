# Balance

An Android money tracker that fills itself in. Balance reads the notifications your bank and e-wallet apps already send, turns them into a ledger, and shows where your money went. No typing, no bank login.

Android only. Dark only. Built with Expo, Jetpack Compose and a small Kotlin core.

## What it does

- **Logs payments by itself.** Jago and myBCA have exact rules, so they're recorded the moment the notification lands. Other apps you pick (GoPay, OVO, other banks…) go through a keyword guess or the AI.
- **Asks when it isn't sure.** Anything it can't read lands in the Inbox (the bell on Overview) and, if you allow it, in a notification with **Yes / Not money / Fix** buttons. You can answer without opening the app.
- **AI review (optional).** Unclear notifications are read by an AI that only *suggests*; nothing reaches the ledger until you confirm. Every answer is kept as an example, so it learns how your apps write.
- **Bring your own key.** Paste a Gemini, OpenAI or Claude key and the phone calls that provider directly, with the cheapest model it offers. The key stays encrypted on the phone.
- **Overview.** Spend for the week, 30 days, 13 weeks or year, compared with the period before. A 20-week spending heat grid, in and out, where it went, where it came from.
- **Activity.** Every entry by day, filters by category, edit or recategorise.
- **Widgets.** A spending grid and a this-month summary for the home screen.
- **Your data, your choice.**
  - *This phone only*: no account, the ledger never leaves the phone.
  - *Google*: one-tap native sign-in, the ledger is backed up to Supabase and restored on a new phone.
  - Export and import as `.xlsx` either way.

## How it works

```
bank / e-wallet app ──notification──▶ BalanceListenerService (Kotlin)
                                           │
                                           ▼
                                 Parsers ─▶ SQLite ledger ─▶ widgets
                                   │            ▲
                         not sure  │            │ confirmed
                                   ▼            │
                     ai_reviews (pending) ─▶ AI worker ─▶ suggestion ─▶ Inbox + notification
                                              │
                         own key ─────────────┤──────── Supabase edge function (signed in)
                         Gemini / OpenAI / Claude        classify-notification → Gemini
```

- **`modules/balance-core`** is a local Expo module in Kotlin. It owns the SQLite ledger (one owner shared by the app, the notification listener and the widgets), the parsers, Google sign-in through Credential Manager, the background AI worker (WorkManager), review notifications, the flow chart view and `.xlsx` read/write.
- **`src/`** is the Expo Router app. All UI is `@expo/ui/jetpack-compose`.
- **`supabase/`** has the migrations (ledger backup, profiles, AI review tables with RLS) and the `classify-notification` edge function. Notification text is redacted (account numbers, phone numbers, emails) before it leaves the phone, on both AI paths.

## Run it

Needs [Bun](https://bun.sh), Android Studio's SDK, and a phone or emulator.

```bash
bun install
# create .env, see Environment below
bun run prebuild        # generates android/ as the dev app
bun run android         # builds and installs "Balance Dev"
```

The dev build installs as `com.projectbalance.app.dev` ("Balance Dev"), so it sits next to a real install instead of replacing it. Use `bun run prebuild` rather than plain `expo prebuild --clean`: it keeps the dev app ID and restores `android/local.properties`.

### Environment

`.env` (gitignored):

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_...
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>.apps.googleusercontent.com
```

For EAS builds the same three are set as EAS environment variables.

### Backend setup

- **Supabase:** apply `supabase/migrations`, deploy `supabase/functions/classify-notification`, and set the `GEMINI_API_KEY` secret (optional: `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`).
- **Google sign-in:** in Google Cloud, a *Web* OAuth client (its ID goes in `.env` and in Supabase → Auth → Google) plus an *Android* OAuth client per package name with that build's SHA-1.

Local-only mode needs none of this.

## Commands

| | |
|---|---|
| `bun run android` | build and install the dev app |
| `bun run start` | Metro for the dev app |
| `bun run prebuild` | regenerate `android/` (after icon or `app.json` changes) |
| `bunx tsc --noEmit` | typecheck |
| `bun run lint` | lint |
| `bunx eas-cli build -p android --profile preview` | installable APK |

## Project layout

```
src/app/             screens (Expo Router): tabs, sign-in, inbox
src/components/      Compose UI pieces
src/lib/             ledger access, auth, sync, AI review, formatting
src/widgets/         home-screen widgets (expo-widgets)
modules/balance-core Kotlin core: ledger, parsers, AI worker, notifications
supabase/            migrations and the edge function
scripts/             icon and widget preview generators
DESIGN.md            palette, type and layout rules
```

## Design

Ember: warm charcoal with one orange for spending, sage for income, Satoshi type. See [DESIGN.md](DESIGN.md).
