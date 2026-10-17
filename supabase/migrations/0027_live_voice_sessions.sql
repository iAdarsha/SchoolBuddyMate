create table if not exists public.live_voice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  transcript jsonb not null default '[]'::jsonb,
  summary text,
  updated_at timestamptz not null default now()
);

create index if not exists live_voice_sessions_user_updated_idx
  on public.live_voice_sessions (user_id, updated_at desc);

alter table public.live_voice_sessions enable row level security;
create policy "Users manage own live voice sessions"
  on public.live_voice_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
