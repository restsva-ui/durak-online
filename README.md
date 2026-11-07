# Durak Online

Telegram Mini App for playing Durak with friends in private online rooms.

## Product scope

- Telegram Mini App with a mobile-first interface.
- Private rooms and six-character invitation codes.
- 36-card deck (6 through Ace).
- Two game modes: **Podkidnoy (throw-in)** and **Perevodnoy (transfer)**.
- 2–6 players, six cards per player.
- Server-authoritative game state; opponents' hands are never returned to a player.
- Telegram Web App HMAC authentication, optimistic state-version checks, and reconnect-friendly state retrieval.

## Current implementation

- Pure TypeScript rules engine in `supabase/functions/_shared/durak.ts`.
- Automated tests for deck construction, dealing, 2- and 6-player starts, legal/illegal defense, private player views, transfer, simultaneous finish, and throw-ins during defense.
- Supabase migration for isolated rooms and room membership, with direct client table access revoked.
- `durak-api` Edge Function supports room creation, joining by invite code, starting a game, submitting moves, and retrieving a player-specific state.
- Card shuffling uses cryptographic randomness on the server.
- GitHub Actions runs TypeScript checks and the automated test suite.

## Backend security

The Edge Function validates Telegram `initData` using the bot token and rejects expired or invalid signatures. The client cannot choose the acting player ID: the server derives it from the signed Telegram user. State updates use a version compare-and-swap to reject stale concurrent moves. The database tables are not directly accessible to `anon` or `authenticated` clients.

Configure these Edge Function secrets in the dedicated Supabase project:

- `TELEGRAM_BOT_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Never commit real secrets or put the service-role key in the Mini App.

## Important deployment boundary

The connected Supabase account currently exposes the existing **VYBE** project only. It is not used by Durak Online. Apply `supabase/migrations/202611070001_durak_rooms.sql` and deploy `supabase/functions/durak-api` only after a separate Supabase project has been selected and configured.

## Architecture

- **Client:** TypeScript + Vite; Telegram Mini App.
- **Backend:** Supabase Postgres and Edge Functions; Realtime/polling integration remains to be completed.
- **Bot:** Telegram Bot API for launching the Mini App and sharing room invitations.

## Development status

Rules engine and the first server API implementation are committed. The database migration and Edge Function source are in the repository but have **not** been deployed. The Mini App UI, bot setup, realtime updates, reconnect UX, and end-to-end Telegram testing remain outstanding.

## Development sequence

1. Complete rules-engine edge-case coverage.
2. Create a separate Supabase project and deploy the migration and Edge Function.
3. Build the mobile-first Telegram Mini App lobby and game table.
4. Connect live room updates and reconnect handling.
5. Configure the Telegram bot, invitation deep links, and production deployment.
