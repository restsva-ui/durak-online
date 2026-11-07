# Initial rules contract

This document records the initial engine decisions. These are implementation defaults and should be reviewed before public matchmaking.

## Shared rules

- 36 cards: ranks 6 through Ace in four suits.
- 2–6 players; six cards are dealt to each player.
- The shuffled deck's final card determines trump suit. With six players, all 36 cards are dealt, so the indicator card remains in a player's hand.
- The player holding the lowest trump starts as attacker.
- Attackers may add only ranks already present among attack cards on the table.
- The number of attack cards cannot exceed six or the defender's current hand size.
- A defense card beats a higher card of the same suit, or any non-trump card with a trump.
- Players who have passed cannot rejoin the current attack round.
- Refill order starts with the attacker and proceeds clockwise; the defender draws last.
- The player who takes the table becomes ineligible to defend the next attack; the next player clockwise starts.

## Throw-in mode

Any active player except the defender may throw in a matching rank until all eligible attackers pass. The defender either beats every attack card or takes the table.

## Transfer mode

Before defending any card, the defender may transfer by adding a card matching an attack rank. The next player clockwise becomes defender if their hand can accommodate the enlarged attack. The transfer card becomes another attack card.

## Important implementation boundary

The engine is a deterministic rules module, not yet a multiplayer service. Production must call it only from trusted server code, persist state transactionally, validate the acting Telegram user against room membership, and send each player a private hand projection. Client-side validation is never authoritative.
