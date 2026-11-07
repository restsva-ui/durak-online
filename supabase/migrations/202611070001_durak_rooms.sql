-- Durak Online: isolated server-owned room storage.
-- Clients receive no direct table privileges; all reads/writes go through the Edge Function.

create table if not exists public.durak_rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique
    check (invite_code ~ '^[A-Z0-9]{6}$'),
  owner_telegram_id text not null,
  mode text not null check (mode in ('throw-in', 'transfer')),
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'finished')),
  state jsonb,
  state_version integer not null default 0 check (state_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.durak_room_players (
  room_id uuid not null references public.durak_rooms(id) on delete cascade,
  telegram_id text not null,
  display_name text not null,
  photo_url text,
  seat smallint not null check (seat between 0 and 5),
  joined_at timestamptz not null default now(),
  primary key (room_id, telegram_id),
  unique (room_id, seat)
);

create index if not exists durak_rooms_status_created_idx
  on public.durak_rooms (status, created_at desc);

create index if not exists durak_room_players_telegram_idx
  on public.durak_room_players (telegram_id);

alter table public.durak_rooms enable row level security;
alter table public.durak_room_players enable row level security;

revoke all on public.durak_rooms from anon, authenticated;
revoke all on public.durak_room_players from anon, authenticated;
grant all on public.durak_rooms to service_role;
grant all on public.durak_room_players to service_role;
