import { createClient } from "npm:@supabase/supabase-js@2";
import {
  applyAction,
  getPlayerView,
  startGame,
  type GameAction,
  type GameMode,
} from "../_shared/durak.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");

if (!supabaseUrl || !serviceKey || !botToken) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or TELEGRAM_BOT_TOKEN.");
}

const db = createClient(supabaseUrl ?? "", serviceKey ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

type TelegramUser = {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function authenticate(initData: string): Promise<TelegramUser> {
  if (!botToken) throw new Error("Сервер не налаштований: відсутній токен Telegram-бота.");
  if (!initData || initData.length > 8192) throw new Error("Некоректні дані Telegram Web App.");

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDate = Number(params.get("auth_date"));
  const rawUser = params.get("user");
  if (!receivedHash || !rawUser || !Number.isFinite(authDate)) {
    throw new Error("Не вдалося підтвердити сесію Telegram.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (authDate > now + 60 || now - authDate > 86400) {
    throw new Error("Сесія Telegram застаріла. Перезапусти Mini App.");
  }

  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = await hmacSha256(new TextEncoder().encode("WebAppData"), botToken);
  const expectedHash = toHex(await hmacSha256(secretKey, checkString));
  if (!safeEqual(expectedHash, receivedHash.toLowerCase())) {
    throw new Error("Підпис Telegram недійсний.");
  }

  const parsed = JSON.parse(rawUser) as Record<string, unknown>;
  if (typeof parsed.id !== "number" && typeof parsed.id !== "string") {
    throw new Error("У сесії Telegram відсутній ID користувача.");
  }

  return {
    id: String(parsed.id),
    first_name: typeof parsed.first_name === "string" ? parsed.first_name : undefined,
    last_name: typeof parsed.last_name === "string" ? parsed.last_name : undefined,
    username: typeof parsed.username === "string" ? parsed.username : undefined,
    photo_url: typeof parsed.photo_url === "string" ? parsed.photo_url : undefined,
  };
}

function displayName(user: TelegramUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || (user.username ? `@${user.username}` : `Гравець ${user.id.slice(-4)}`);
}

function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 0x1_0000_0000;
}

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

async function getMembership(roomId: string, telegramId: string) {
  const { data, error } = await db
    .from("durak_room_players")
    .select("room_id, telegram_id, display_name, photo_url, seat")
    .eq("room_id", roomId)
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Ти не є учасником цієї кімнати.");
  return data;
}

async function handle(body: Record<string, unknown>, user: TelegramUser) {
  const operation = body.operation;

  if (operation === "create_room") {
    const mode = body.mode;
    if (mode !== "throw-in" && mode !== "transfer") {
      throw new Error("Обери режим гри: підкидний або перевідний.");
    }

    let room: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 4 && !room; attempt += 1) {
      const { data, error } = await db
        .from("durak_rooms")
        .insert({
          invite_code: inviteCode(),
          owner_telegram_id: user.id,
          mode,
          status: "waiting",
        })
        .select("id, invite_code, mode, status, state_version")
        .single();
      if (!error) room = data;
      else if (error.code !== "23505") throw error;
    }
    if (!room) throw new Error("Не вдалося створити кімнату. Спробуй ще раз.");

    const { error: memberError } = await db.from("durak_room_players").insert({
      room_id: room.id,
      telegram_id: user.id,
      display_name: displayName(user),
      photo_url: user.photo_url ?? null,
      seat: 0,
    });
    if (memberError) {
      await db.from("durak_rooms").delete().eq("id", room.id);
      throw memberError;
    }
    return { room, players: [{ telegram_id: user.id, display_name: displayName(user), photo_url: user.photo_url ?? null, seat: 0 }] };
  }

  if (operation === "join_room") {
    const code = typeof body.invite_code === "string" ? body.invite_code.trim().toUpperCase() : "";
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error("Код запрошення має містити 6 символів.");

    const { data: room, error: roomError } = await db
      .from("durak_rooms")
      .select("id, invite_code, mode, status, state_version")
      .eq("invite_code", code)
      .maybeSingle();
    if (roomError) throw roomError;
    if (!room) throw new Error("Кімнату за цим кодом не знайдено.");
    if (room.status !== "waiting") throw new Error("Гра вже почалася.");

    const { data: existing, error: existingError } = await db
      .from("durak_room_players")
      .select("telegram_id, display_name, photo_url, seat")
      .eq("room_id", room.id)
      .order("seat");
    if (existingError) throw existingError;
    const current = existing ?? [];
    if (current.some((player) => player.telegram_id === user.id)) {
      return { room, players: current };
    }
    if (current.length >= 6) throw new Error("У кімнаті вже максимальні 6 гравців.");

    const occupied = new Set(current.map((player) => player.seat));
    const seat = [0, 1, 2, 3, 4, 5].find((value) => !occupied.has(value));
    if (seat === undefined) throw new Error("Немає вільного місця.");

    // Claim the current room version so joining cannot race with the host starting the game.
    const { data: claimed, error: claimError } = await db
      .from("durak_rooms")
      .update({ state_version: room.state_version + 1, updated_at: new Date().toISOString() })
      .eq("id", room.id)
      .eq("state_version", room.state_version)
      .eq("status", "waiting")
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new Error("Кімната щойно змінилася. Онови список гравців.");

    const { error: insertError } = await db.from("durak_room_players").insert({
      room_id: room.id,
      telegram_id: user.id,
      display_name: displayName(user),
      photo_url: user.photo_url ?? null,
      seat,
    });
    if (insertError) {
      if (insertError.code === "23505") throw new Error("Місце щойно зайняв інший гравець. Онови кімнату.");
      throw insertError;
    }
    return {
      room,
      players: [...current, { telegram_id: user.id, display_name: displayName(user), photo_url: user.photo_url ?? null, seat }],
    };
  }

  const roomId = typeof body.room_id === "string" ? body.room_id : "";
  if (!roomId) throw new Error("Не вказано кімнату.");
  await getMembership(roomId, user.id);

  const { data: room, error: roomError } = await db
    .from("durak_rooms")
    .select("id, invite_code, owner_telegram_id, mode, status, state, state_version")
    .eq("id", roomId)
    .maybeSingle();
  if (roomError) throw roomError;
  if (!room) throw new Error("Кімнату не знайдено.");

  if (operation === "get_state") {
    const { data: members, error } = await db
      .from("durak_room_players")
      .select("telegram_id, display_name, photo_url, seat")
      .eq("room_id", roomId)
      .order("seat");
    if (error) throw error;
    const playerView = room.state ? getPlayerView(room.state, user.id) : null;
    return { room: { id: room.id, invite_code: room.invite_code, mode: room.mode, status: room.status, state_version: room.state_version }, players: members ?? [], game: playerView };
  }

  if (operation === "start_game") {
    if (room.owner_telegram_id !== user.id) throw new Error("Почати гру може лише власник кімнати.");
    if (room.status !== "waiting") throw new Error("Гра вже запущена.");
    const { data: members, error } = await db
      .from("durak_room_players")
      .select("telegram_id, display_name, seat")
      .eq("room_id", roomId)
      .order("seat");
    if (error) throw error;
    if (!members || members.length < 2 || members.length > 6) {
      throw new Error("Для початку гри потрібно від 2 до 6 гравців.");
    }
    const state = startGame(
      members.map((member) => ({ id: member.telegram_id, name: member.display_name })),
      room.mode as GameMode,
      secureRandom,
    );
    const { data: updated, error: updateError } = await db
      .from("durak_rooms")
      .update({ state, status: "playing", state_version: room.state_version + 1, updated_at: new Date().toISOString() })
      .eq("id", roomId)
      .eq("state_version", room.state_version)
      .eq("status", "waiting")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new Error("Кімната змінилася паралельно. Онови стан і повтори.");
    return { started: true, game: getPlayerView(state, user.id) };
  }

  if (operation === "action") {
    if (room.status !== "playing" || !room.state) throw new Error("Гра зараз не активна.");
    if (!body.action || typeof body.action !== "object") throw new Error("Не передано ігрову дію.");
    const requested = body.action as Record<string, unknown>;
    const { playerId: _ignoredPlayerId, ...untrustedAction } = requested;
    const action = { ...untrustedAction, playerId: user.id } as GameAction;
    const nextState = applyAction(room.state, action);
    const nextStatus = nextState.phase === "finished" ? "finished" : "playing";
    const { data: updated, error: updateError } = await db
      .from("durak_rooms")
      .update({ state: nextState, status: nextStatus, state_version: room.state_version + 1, updated_at: new Date().toISOString() })
      .eq("id", roomId)
      .eq("state_version", room.state_version)
      .eq("status", "playing")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new Error("Хід конфліктує з паралельною дією. Онови гру й повтори.");
    return { accepted: true, game: getPlayerView(nextState, user.id) };
  }

  throw new Error("Невідома команда.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceKey || !botToken) return json({ error: "Server configuration incomplete." }, 500);

  try {
    const body = await req.json() as Record<string, unknown>;
    const initData = typeof body.init_data === "string" ? body.init_data : "";
    const user = await authenticate(initData);
    const result = await handle(body, user);
    return json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Невідома помилка сервера.";
    const status = message.includes("Сесія") || message.includes("Підпис") || message.includes("Telegram") ? 401 : 400;
    return json({ ok: false, error: message }, status);
  }
});
