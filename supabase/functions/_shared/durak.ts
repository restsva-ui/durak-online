export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type GameMode = "throw-in" | "transfer";
export type GamePhase = "attack" | "defense" | "finished";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
}

export interface AttackPair {
  attack: Card;
  defense?: Card;
}

export interface GameState {
  version: 1;
  mode: GameMode;
  phase: GamePhase;
  players: Player[];
  drawPile: Card[];
  trumpSuit: Suit;
  table: AttackPair[];
  attackerId: string;
  defenderId: string;
  passedPlayerIds: string[];
  winnerId: string | undefined;
  loserId: string | undefined;
}

export type GameAction =
  | { type: "attack"; playerId: string; cardId: string }
  | { type: "defend"; playerId: string; attackCardId: string; defenseCardId: string }
  | { type: "transfer"; playerId: string; cardId: string }
  | { type: "pass"; playerId: string }
  | { type: "take"; playerId: string };

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

const rankValue = (card: Card): number => card.rank;

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({ id: `${suit}-${rank}`, suit, rank })),
  );
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const current = result[i]!;
    result[i] = result[j]!;
    result[j] = current;
  }
  return result;
}

function nextPlayerId(state: GameState, fromId: string, excluded: Set<string> = new Set()): string {
  const start = state.players.findIndex((player) => player.id === fromId);
  if (start < 0) throw new RuleError("Гравця не знайдено.");
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const player = state.players[(start + offset) % state.players.length]!;
    if (player.hand.length > 0 && !excluded.has(player.id)) return player.id;
  }
  throw new RuleError("Немає активного гравця для наступного ходу.");
}

function playerById(state: GameState, playerId: string): Player {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) throw new RuleError("Гравця не знайдено.");
  return player;
}

function removeCard(player: Player, cardId: string): Card {
  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index < 0) throw new RuleError("Цієї карти немає у гравця на руках.");
  return player.hand.splice(index, 1)[0]!;
}

function canBeat(attack: Card, defense: Card, trumpSuit: Suit): boolean {
  if (defense.suit === attack.suit) return rankValue(defense) > rankValue(attack);
  return defense.suit === trumpSuit && attack.suit !== trumpSuit;
}

function activePlayerIds(state: GameState): string[] {
  return state.players.filter((player) => player.hand.length > 0).map((player) => player.id);
}

function finishIfNeeded(state: GameState): void {
  if (state.drawPile.length > 0) return;
  const stillInGame = state.players.filter((player) => player.hand.length > 0);
  if (stillInGame.length <= 1) {
    state.phase = "finished";
    if (stillInGame.length === 1) {
      state.loserId = stillInGame[0]!.id;
      state.winnerId = state.players.find((player) => player.id !== stillInGame[0]!.id)?.id;
    } else {
      // A rare simultaneous-outcome edge case: no player remains with cards.
      state.winnerId = undefined;
      state.loserId = undefined;
    }
  }
}

function assertRoundParticipants(state: GameState): void {
  if (state.players.length < 2 || state.players.length > 6) {
    throw new RuleError("У грі має бути від 2 до 6 гравців.");
  }
  if (new Set(state.players.map((player) => player.id)).size !== state.players.length) {
    throw new RuleError("ID гравців мають бути унікальними.");
  }
  if (state.players.some((player) => !player.id.trim())) {
    throw new RuleError("ID гравця не може бути порожнім.");
  }
}

export function startGame(
  inputPlayers: Array<{ id: string; name: string }>,
  mode: GameMode,
  random: () => number = Math.random,
): GameState {
  if (inputPlayers.length < 2 || inputPlayers.length > 6) {
    throw new RuleError("У грі має бути від 2 до 6 гравців.");
  }
  if (new Set(inputPlayers.map((player) => player.id)).size !== inputPlayers.length) {
    throw new RuleError("ID гравців мають бути унікальними.");
  }
  if (mode !== "throw-in" && mode !== "transfer") throw new RuleError("Невідомий режим гри.");
  const deck = shuffled(createDeck(), random);
  // With six players all 36 cards are dealt. The last shuffled card still defines trump.
  const trumpSuit = deck[deck.length - 1]!.suit;
  const players: Player[] = inputPlayers.map((player) => ({ ...player, hand: [] }));
  for (let round = 0; round < 6; round += 1) {
    for (const player of players) {
      const card = deck.pop();
      if (card) player.hand.push(card);
    }
  }
  const drawPile = deck;
  const trumpCandidates = players.flatMap((player) =>
    player.hand.filter((card) => card.suit === trumpSuit).map((card) => ({ playerId: player.id, card })),
  );
  const lowestTrump = trumpCandidates.sort((a, b) => a.card.rank - b.card.rank)[0];
  const attackerId = lowestTrump?.playerId ?? players[0]!.id;
  const state: GameState = {
    version: 1,
    mode,
    phase: "attack",
    players,
    drawPile,
    trumpSuit,
    table: [],
    attackerId,
    defenderId: "",
    passedPlayerIds: [],
    winnerId: undefined,
    loserId: undefined,
  };
  state.defenderId = nextPlayerId(state, attackerId);
  assertRoundParticipants(state);
  return state;
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function allAttackersPassed(state: GameState): boolean {
  const eligible = activePlayerIds(state).filter((id) => id !== state.defenderId);
  return eligible.every((id) => state.passedPlayerIds.includes(id));
}

function refillHands(state: GameState, firstPlayerId: string, defenderLast: boolean): void {
  const start = state.players.findIndex((player) => player.id === firstPlayerId);
  if (start < 0) throw new RuleError("Не вдалося визначити порядок добору карт.");
  const clockwise = Array.from(
    { length: state.players.length },
    (_, offset) => state.players[(start + offset) % state.players.length]!.id,
  );
  const drawOrder = defenderLast
    ? [...clockwise.filter((id) => id !== state.defenderId), state.defenderId]
    : clockwise;
  for (const id of drawOrder) {
    const player = playerById(state, id);
    while (player.hand.length < 6 && state.drawPile.length > 0) {
      const card = state.drawPile.pop();
      if (card) player.hand.push(card);
    }
  }
}

function settleRound(state: GameState, defenderTook: boolean): void {
  const oldDefender = state.defenderId;
  const oldAttacker = state.attackerId;
  if (defenderTook) {
    const defender = playerById(state, oldDefender);
    for (const pair of state.table) {
      defender.hand.push(pair.attack);
      if (pair.defense) defender.hand.push(pair.defense);
    }
    // After taking, the player to the defender's left starts the next attack.
    state.table = [];
    state.passedPlayerIds = [];
    refillHands(state, oldAttacker, true);
    state.attackerId = nextPlayerId(state, oldDefender);
  } else {
    // Successful defense: discard the table; the old defender attacks next.
    state.table = [];
    state.passedPlayerIds = [];
    refillHands(state, oldAttacker, true);
    if (playerById(state, oldDefender).hand.length > 0) {
      state.attackerId = oldDefender;
    } else {
      state.attackerId = activePlayerIds(state).length > 0
        ? nextPlayerId(state, oldDefender)
        : oldDefender;
    }
  }
  finishIfNeeded(state);
  if (state.phase !== "finished") {
    state.defenderId = nextPlayerId(state, state.attackerId);
    state.phase = "attack";
  }
}

export function applyAction(current: GameState, action: GameAction): GameState {
  if (current.phase === "finished") throw new RuleError("Гра вже завершена.");
  const state = cloneState(current);
  const actor = playerById(state, action.playerId);
  if (actor.hand.length === 0) throw new RuleError("Гравець без карт не може ходити.");

  switch (action.type) {
    case "attack": {
      if (state.phase !== "attack") throw new RuleError("Зараз не можна починати або продовжувати атаку.");
      if (actor.id === state.defenderId) throw new RuleError("Захисник не може підкидати карти.");
      if (state.passedPlayerIds.includes(actor.id)) throw new RuleError("Гравець уже завершив підкидання цього раунду.");
      if (state.table.length === 0 && actor.id !== state.attackerId) {
        throw new RuleError("Першу атаку має починати визначений нападник.");
      }
      if (state.table.length >= 6 || state.table.length >= playerById(state, state.defenderId).hand.length) {
        throw new RuleError("Досягнуто ліміту карт для атаки.");
      }
      if (state.table.length > 0 && !state.table.some((pair) => pair.attack.rank === actor.hand.find((c) => c.id === action.cardId)?.rank)) {
        throw new RuleError("Підкидати можна лише карту рангу, який уже є на столі.");
      }
      const card = removeCard(actor, action.cardId);
      state.table.push({ attack: card });
      state.phase = "defense";
      return state;
    }
    case "defend": {
      if (state.phase !== "defense" || actor.id !== state.defenderId) {
        throw new RuleError("Зараз захищатися може лише поточний захисник.");
      }
      const pair = state.table.find((item) => item.attack.id === action.attackCardId);
      if (!pair || pair.defense) throw new RuleError("Ця карта атаки вже відбита або не існує.");
      const defenseCard = actor.hand.find((card) => card.id === action.defenseCardId);
      if (!defenseCard) throw new RuleError("Карти для захисту немає на руках.");
      if (!canBeat(pair.attack, defenseCard, state.trumpSuit)) throw new RuleError("Цією картою не можна побити атаку.");
      pair.defense = removeCard(actor, action.defenseCardId);
      if (state.table.every((item) => item.defense)) {
        state.phase = "attack";
        if (allAttackersPassed(state)) settleRound(state, false);
      }
      return state;
    }
    case "transfer": {
      if (state.mode !== "transfer") throw new RuleError("Переведення вимкнене для цього режиму.");
      if (state.phase !== "defense" || actor.id !== state.defenderId) {
        throw new RuleError("Перевести атаку може лише поточний захисник до початку захисту.");
      }
      if (state.table.some((pair) => pair.defense)) throw new RuleError("Після першого відбиття переведення неможливе.");
      const card = actor.hand.find((item) => item.id === action.cardId);
      if (!card || !state.table.some((pair) => pair.attack.rank === card.rank)) {
        throw new RuleError("Для переведення потрібна карта того самого рангу, що й атака.");
      }
      const nextDefenderId = nextPlayerId(state, state.defenderId, new Set([state.defenderId]));
      if (playerById(state, nextDefenderId).hand.length < state.table.length + 1) {
        throw new RuleError("У наступного гравця недостатньо карт для прийняття переведеної атаки.");
      }
      state.table.push({ attack: removeCard(actor, action.cardId) });
      state.defenderId = nextDefenderId;
      state.passedPlayerIds = [];
      state.phase = "defense";
      return state;
    }
    case "pass": {
      if (state.phase !== "attack") throw new RuleError("Завершити підкидання можна лише після атаки або відбиття.");
      if (actor.id === state.defenderId) throw new RuleError("Захисник не може завершити підкидання.");
      if (state.table.length === 0) throw new RuleError("Спочатку потрібно зробити атаку.");
      if (!state.passedPlayerIds.includes(actor.id)) state.passedPlayerIds.push(actor.id);
      if (allAttackersPassed(state)) {
        const fullyDefended = state.table.every((pair) => pair.defense);
        settleRound(state, !fullyDefended);
      }
      return state;
    }
    case "take": {
      if (state.phase !== "defense" || actor.id !== state.defenderId) {
        throw new RuleError("Забрати карти може лише поточний захисник.");
      }
      settleRound(state, true);
      return state;
    }
  }
}

export function getPlayerView(state: GameState, viewerId: string) {
  playerById(state, viewerId);
  return {
    version: state.version,
    mode: state.mode,
    phase: state.phase,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      cardCount: player.hand.length,
      hand: player.id === viewerId ? structuredClone(player.hand) : undefined,
    })),
    drawPileCount: state.drawPile.length,
    trumpSuit: state.trumpSuit,
    table: structuredClone(state.table),
    attackerId: state.attackerId,
    defenderId: state.defenderId,
    passedPlayerIds: [...state.passedPlayerIds],
    winnerId: state.winnerId,
    loserId: state.loserId,
  };
}
