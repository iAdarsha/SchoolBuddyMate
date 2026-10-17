alter table public.live_voice_sessions add column if not exists assignment_id uuid references public.assignments(id) on delete set null;
create index if not exists live_voice_sessions_assignment_idx on public.live_voice_sessions(assignment_id, updated_at desc);
