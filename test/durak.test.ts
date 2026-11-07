import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, createDeck, getPlayerView, RuleError, startGame } from "../src/durak.js";

const players = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];

test("deck has 36 unique cards", () => {
  const deck = createDeck();
  assert.equal(deck.length, 36);
  assert.equal(new Set(deck.map((card) => card.id)).size, 36);
});

test("deals six cards and starts with a valid attacker and defender", () => {
  const game = startGame(players, "throw-in", () => 0.42);
  assert.equal(game.players.every((player) => player.hand.length === 6), true);
  assert.equal(game.drawPile.length, 24);
  assert.ok(game.players.some((player) => player.id === game.attackerId));
  assert.ok(game.players.some((player) => player.id === game.defenderId));
  assert.notEqual(game.attackerId, game.defenderId);
});

test("six players can start even when the stock is empty", () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ id: String(i), name: String(i) }));
  const game = startGame(six, "throw-in", () => 0.2);
  assert.equal(game.players.reduce((sum, player) => sum + player.hand.length, 0), 36);
  assert.equal(game.drawPile.length, 0);
  assert.ok(game.trumpSuit);
});

test("rejects illegal defense and leaves original state unchanged", () => {
  const game = startGame(players, "throw-in", () => 0.42);
  const attackCard = game.players.find((p) => p.id === game.attackerId)!.hand[0]!;
  const afterAttack = applyAction(game, { type: "attack", playerId: game.attackerId, cardId: attackCard.id });
  const defender = afterAttack.players.find((p) => p.id === afterAttack.defenderId)!;
  const illegal = defender.hand.find((card) => card.suit !== afterAttack.trumpSuit && card.suit !== attackCard.suit);
  if (illegal) {
    assert.throws(
      () => applyAction(afterAttack, { type: "defend", playerId: defender.id, attackCardId: attackCard.id, defenseCardId: illegal.id }),
      RuleError,
    );
  }
  assert.equal(game.table.length, 0);
});

test("player view never reveals opponents' cards", () => {
  const game = startGame(players, "throw-in", () => 0.42);
  const view = getPlayerView(game, "a");
  assert.equal(view.players.find((p) => p.id === "a")?.hand?.length, 6);
  assert.equal(view.players.find((p) => p.id === "b")?.hand, undefined);
});

test("rejects more than six players", () => {
  const tooMany = Array.from({ length: 7 }, (_, i) => ({ id: String(i), name: String(i) }));
  assert.throws(() => startGame(tooMany, "throw-in"), RuleError);
});
