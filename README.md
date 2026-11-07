# Durak Online

Telegram Mini App for playing Durak with friends in private online rooms.

## Product scope

- Telegram Mini App with a mobile-first interface.
- Private rooms and invite links.
- 36-card deck (6 through Ace).
- Two game modes: **Podkidnoy (throw-in)** and **Perevodnoy (transfer)**.
- Server-authoritative game state: validate every move on the server and never expose opponents' hands.
- Reconnection support for players who temporarily lose connectivity.

## Initial rules and limits

- The first release targets 2–6 players.
- Each player receives 6 cards.
- Trump suit is determined from the remaining deck.
- The game engine, not the client, owns turn order, legal-move validation, deck state, and game completion.
- A room's mode and player limit are fixed before the deal begins.

## Planned architecture

- **Client:** TypeScript + Vite, responsive Telegram Mini App.
- **Backend:** Supabase database and Realtime, with trusted server-side game operations (Edge Functions or an equivalent server runtime).
- **Bot:** Telegram Bot API for launching the Mini App and sharing room invitations.

The game backend must be configured independently from other projects. No credentials or secrets belong in this repository.

## Development status

Repository initialized. Implementation, automated rules tests, Telegram bot setup, and Supabase deployment are not yet complete.

## Development sequence

1. Implement and test the pure Durak rules engine.
2. Add server-authoritative room and turn operations.
3. Add persistence and realtime room updates.
4. Build the Telegram Mini App interface.
5. Connect the bot, invitations, and deployment configuration.
