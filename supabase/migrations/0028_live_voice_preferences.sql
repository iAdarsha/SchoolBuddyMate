alter table public.live_voice_sessions
  add column if not exists voice_name text not null default 'Kore',
  add column if not exists language text not null default 'English',
  add column if not exists voice_style text not null default 'Friendly tutor';
