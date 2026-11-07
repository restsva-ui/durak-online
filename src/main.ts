import "./styles.css";

type Mode = "throw-in" | "transfer";
type Room = {
  id: string;
  invite_code: string;
  mode: Mode;
  status: "waiting" | "playing" | "finished";
  state_version: number;
  is_owner?: boolean;
};
type Member = {
  telegram_id: string;
  display_name: string;
  photo_url?: string | null;
  seat: number;
};
type Card = { id: string; suit: string; rank: number };
type AttackPair = { attack: Card; defense?: Card };
type GamePlayer = { id: string; name: string; cardCount: number; hand?: Card[] };
type GameView = {
  mode: Mode;
  phase: "attack" | "defense" | "finished";
  players: GamePlayer[];
  drawPileCount: number;
  trumpSuit: string;
  table: AttackPair[];
  attackerId: string;
  defenderId: string;
  passedPlayerIds: string[];
  winnerId?: string;
  loserId?: string;
};
type ApiResponse = {
  ok: boolean;
  error?: string;
  room?: Room;
  players?: Member[];
  game?: GameView | null;
  started?: boolean;
  accepted?: boolean;
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("App root not found");

const webApp = window.Telegram?.WebApp;
webApp?.ready();
webApp?.expand();

const state: {
  room: Room | null;
  members: Member[];
  game: GameView | null;
  selectedCardId: string | null;
  error: string;
  busy: boolean;
} = {
  room: null,
  members: [],
  game: null,
  selectedCardId: null,
  error: "",
  busy: false,
};

const apiUrl = import.meta.env.VITE_DURAK_API_URL ?? "";
let pollHandle: number | undefined;

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function rankLabel(rank: number): string {
  return ({ 11: "В", 12: "Д", 13: "К", 14: "Т" } as Record<number, string>)[rank] ?? String(rank);
}

function suitSymbol(suit: string): string {
  return ({ clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" } as Record<string, string>)[suit] ?? "?";
}

function cardMarkup(card: Card, selected = false): string {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return `<button class="playing-card ${red ? "red" : ""} ${selected ? "selected" : ""}" data-card="${escapeHtml(card.id)}" aria-label="${rankLabel(card.rank)} ${suitSymbol(card.suit)}">
    <span>${rankLabel(card.rank)}</span><strong>${suitSymbol(card.suit)}</strong>
  </button>`;
}

async function api(payload: Record<string, unknown>): Promise<ApiResponse> {
  if (!apiUrl) throw new Error("Не задано VITE_DURAK_API_URL. Спочатку налаштуй адресу серверної функції.");
  const initData = webApp?.initData ?? "";
  if (!initData) throw new Error("Відкрий гру через Telegram Mini App — потрібна підписана сесія Telegram.");
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, init_data: initData }),
  });
  const result = await response.json() as ApiResponse;
  if (!response.ok || !result.ok) throw new Error(result.error || "Помилка сервера.");
  return result;
}

function setError(message = ""): void {
  state.error = message;
  render();
}

function homeView(): string {
  return `<main class="shell">
    <header class="brand"><div class="brand-mark">Д</div><div><p class="eyebrow">КАРТКОВА ГРА</p><h1>Дурак <span>Online</span></h1></div></header>
    <section class="hero panel">
      <div class="hero-cards"><span class="mini-card red-card">♥</span><span class="mini-card">♠</span><span class="mini-card gold-card">♣</span></div>
      <p class="eyebrow">ГРАЙ З ДРУЗЯМИ</p>
      <h2>Твій стіл.<br/>Твої правила.</h2>
      <p class="muted">Створи приватну кімнату або приєднайся до друзів за кодом.</p>
    </section>
    <section class="panel form-panel">
      <label class="field-label" for="mode">РЕЖИМ ГРИ</label>
      <select id="mode" class="input"><option value="throw-in">Підкидний</option><option value="transfer">Перевідний</option></select>
      <button class="primary-button" id="create-room" ${state.busy ? "disabled" : ""}>＋ Створити кімнату</button>
      <div class="separator"><span>АБО</span></div>
      <label class="field-label" for="invite-code">КОД ЗАПРОШЕННЯ</label>
      <div class="join-row"><input id="invite-code" class="input code-input" maxlength="6" placeholder="НАПР. A8K2QX" autocomplete="off"/><button class="secondary-button" id="join-room" ${state.busy ? "disabled" : ""}>Увійти</button></div>
    </section>
    ${state.error ? `<p class="error-message">${escapeHtml(state.error)}</p>` : ""}
    <footer>36 карт · 2–6 гравців · Підкидний і перевідний</footer>
  </main>`;
}

function lobbyView(): string {
  const room = state.room!;
  const canStart = Boolean(room.is_owner && state.members.length >= 2);
  return `<main class="shell">
    <header class="topbar"><button class="icon-button" id="leave-room" aria-label="Назад">‹</button><div><p class="eyebrow">ПРИВАТНА КІМНАТА</p><h1>Очікування гравців</h1></div><span class="status-dot"></span></header>
    <section class="panel invite-panel"><p class="eyebrow">КОД ДЛЯ ДРУЗІВ</p><div class="invite-code">${escapeHtml(room.invite_code)}</div><button class="secondary-button copy-button" id="copy-code">Копіювати код</button><p class="muted small">Надішли цей код друзям, щоб вони приєдналися.</p></section>
    <section class="panel players-panel"><div class="section-heading"><h2>Гравці</h2><span class="count-pill">${state.members.length}/6</span></div>
      <div class="player-list">${state.members.map((member, index) => `<div class="player-row"><div class="avatar">${member.photo_url ? `<img src="${escapeHtml(member.photo_url)}" alt="" />` : escapeHtml((member.display_name || "?").slice(0, 1).toUpperCase())}</div><div class="player-name">${escapeHtml(member.display_name)}${member.telegram_id === state.members[0]?.telegram_id ? '<small>Власник кімнати</small>' : ""}</div><span class="seat-number">${index + 1}</span></div>`).join("")}</div>
    </section>
    <section class="panel mode-panel"><span class="muted">Режим</span><strong>${room.mode === "transfer" ? "Перевідний дурень" : "Підкидний дурень"}</strong><span class="muted">До 6 гравців · Колода 36 карт</span></section>
    ${room.is_owner ? `<button class="primary-button" id="start-game" ${canStart && !state.busy ? "" : "disabled"}>Почати гру</button>` : '<p class="waiting-note">Очікуємо, поки власник кімнати почне гру…</p>'}
    ${state.error ? `<p class="error-message">${escapeHtml(state.error)}</p>` : ""}
  </main>`;
}

function gameView(): string {
  const game = state.game!;
  const room = state.room!;
  const me = game.players.find((player) => player.hand !== undefined);
  const isDefender = game.defenderId === me?.id;
  const defenderTurn = isDefender && game.phase === "defense";
  const canAttack = !isDefender && (game.table.length > 0 || game.attackerId === me?.id);
  const hand = me?.hand ?? [];
  const selected = hand.find((card) => card.id === state.selectedCardId);
  const isFinished = game.phase === "finished";
  const table = game.table.map((pair, index) => `<div class="table-pair">
    <div class="table-card">${cardMarkup(pair.attack)}</div>
    <div class="table-card covered">${pair.defense ? cardMarkup(pair.defense) : '<span class="empty-cover">?</span>'}</div>
    ${isDefender && !pair.defense ? `<button class="beat-button" data-beat="${escapeHtml(pair.attack.id)}">Побити</button>` : ""}
  </div>`).join("");
  const players = game.players.map((player) => `<div class="game-player ${player.id === game.defenderId ? "defending" : ""} ${player.id === me?.id ? "you" : ""}">
    <div class="avatar small-avatar">${escapeHtml(player.name.slice(0, 1).toUpperCase())}</div><span>${escapeHtml(player.name)}${player.id === me?.id ? " · ти" : ""}</span><b>${player.cardCount}</b>
  </div>`).join("");
  return `<main class="game-shell">
    <header class="game-header"><button class="icon-button" id="leave-room">‹</button><div><p class="eyebrow">КІМНАТА ${escapeHtml(room.invite_code)}</p><h1>Дурак Online</h1></div><span class="deck-count">${game.drawPileCount} <small>в колоді</small></span></header>
    <section class="game-table panel">
      <div class="table-meta"><span>Козир: <b>${suitSymbol(game.trumpSuit)}</b></span><span>${game.mode === "transfer" ? "Перевідний" : "Підкидний"}</span></div>
      <div class="opponents">${players}</div>
      <div class="table-center">${table || '<p class="table-empty">Стіл вільний<br/><small>Починай атаку</small></p>'}</div>
      <div class="turn-label">${isFinished ? "Гру завершено" : isDefender ? "Твій захист" : game.phase === "attack" ? "Твоя черга атакувати / підкидати" : "Очікуємо захисту"}</div>
    </section>
    <section class="hand-section"><div class="section-heading"><h2>Твої карти</h2><span class="count-pill">${hand.length}</span></div><div class="hand">${hand.map((card) => cardMarkup(card, card.id === state.selectedCardId)).join("")}</div></section>
    <section class="actions">
      ${!isFinished && canAttack ? `<button class="primary-button" id="do-attack" ${selected && !state.busy ? "" : "disabled"}>${game.table.length ? "Підкинути карту" : "Атакувати"}</button>` : ""}
      ${!isFinished && defenderTurn ? `<button class="primary-button" id="take-cards" ${state.busy ? "disabled" : ""}>Забрати карти</button>` : ""}
      ${!isFinished && defenderTurn && room.mode === "transfer" && game.table.every((pair) => !pair.defense) ? `<button class="secondary-button" id="transfer" ${selected && !state.busy ? "" : "disabled"}>Перевести</button>` : ""}
      ${!isFinished && !isDefender && game.phase === "attack" && game.table.length ? `<button class="secondary-button" id="pass" ${state.busy ? "disabled" : ""}>Пас</button>` : ""}
      ${selected ? '<button class="text-button" id="clear-selection">Скасувати вибір</button>' : ""}
    </section>
    ${isFinished ? `<div class="result-banner">${game.loserId === me?.id ? "Цього разу ти — дурень. Наступна партія буде твоєю!" : "Партію завершено!"}</div>` : ""}
    ${state.error ? `<p class="error-message">${escapeHtml(state.error)}</p>` : ""}
  </main>`;
}

function render(): void {
  if (!state.room) root!.innerHTML = homeView();
  else if (!state.game) root!.innerHTML = lobbyView();
  else root!.innerHTML = gameView();
}

async function runBusy(task: () => Promise<void>): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await task();
    state.error = "";
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Сталася помилка.";
  } finally {
    state.busy = false;
    render();
  }
}

function stopPolling(): void {
  if (pollHandle !== undefined) window.clearInterval(pollHandle);
  pollHandle = undefined;
}

async function refreshRoom(): Promise<void> {
  if (!state.room) return;
  const result = await api({ operation: "get_state", room_id: state.room.id });
  if (result.room) state.room = result.room;
  state.members = result.players ?? [];
  state.game = result.game ?? null;
  if (state.game?.phase === "finished") state.room.status = "finished";
  render();
}

function startPolling(): void {
  stopPolling();
  pollHandle = window.setInterval(() => {
    if (!state.busy && state.room) {
      refreshRoom().catch((error) => {
        state.error = error instanceof Error ? error.message : "Не вдалося оновити кімнату.";
        render();
      });
    }
  }, 2200);
}

async function enterRoom(result: ApiResponse): Promise<void> {
  if (!result.room) throw new Error("Сервер не повернув кімнату.");
  state.room = result.room;
  state.members = result.players ?? [];
  state.game = result.game ?? null;
  state.selectedCardId = null;
  await refreshRoom();
  startPolling();
}

root.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const cardButton = target.closest<HTMLElement>("[data-card]");
  if (cardButton) {
    state.selectedCardId = cardButton.dataset.card ?? null;
    render();
    return;
  }

  const beatButton = target.closest<HTMLElement>("[data-beat]");
  if (beatButton && state.selectedCardId) {
    void runBusy(async () => {
      await api({ operation: "action", room_id: state.room!.id, action: { type: "defend", attackCardId: beatButton.dataset.beat, defenseCardId: state.selectedCardId } });
      state.selectedCardId = null;
      await refreshRoom();
    });
    return;
  }

  const id = target.closest<HTMLElement>("[id]")?.id;
  if (!id) return;

  if (id === "create-room") {
    const mode = (document.querySelector<HTMLSelectElement>("#mode")?.value ?? "throw-in") as Mode;
    void runBusy(async () => enterRoom(await api({ operation: "create_room", mode })));
  } else if (id === "join-room") {
    const invite_code = document.querySelector<HTMLInputElement>("#invite-code")?.value.trim().toUpperCase() ?? "";
    void runBusy(async () => enterRoom(await api({ operation: "join_room", invite_code })));
  } else if (id === "copy-code" && state.room) {
    void navigator.clipboard.writeText(state.room.invite_code).then(() => {
      state.error = "Код скопійовано.";
      render();
    }).catch(() => setError("Не вдалося скопіювати код."));
  } else if (id === "start-game") {
    void runBusy(async () => {
      await api({ operation: "start_game", room_id: state.room!.id });
      await refreshRoom();
    });
  } else if (id === "do-attack" && state.selectedCardId) {
    void runBusy(async () => {
      await api({ operation: "action", room_id: state.room!.id, action: { type: "attack", cardId: state.selectedCardId } });
      state.selectedCardId = null;
      await refreshRoom();
    });
  } else if (id === "take-cards") {
    void runBusy(async () => {
      await api({ operation: "action", room_id: state.room!.id, action: { type: "take" } });
      await refreshRoom();
    });
  } else if (id === "transfer" && state.selectedCardId) {
    void runBusy(async () => {
      await api({ operation: "action", room_id: state.room!.id, action: { type: "transfer", cardId: state.selectedCardId } });
      state.selectedCardId = null;
      await refreshRoom();
    });
  } else if (id === "pass") {
    void runBusy(async () => {
      await api({ operation: "action", room_id: state.room!.id, action: { type: "pass" } });
      await refreshRoom();
    });
  } else if (id === "clear-selection") {
    state.selectedCardId = null;
    render();
  } else if (id === "leave-room") {
    stopPolling();
    state.room = null;
    state.members = [];
    state.game = null;
    state.selectedCardId = null;
    state.error = "";
    render();
  }
});

render();
