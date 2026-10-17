-- Structured learning evidence captured from School Buddy Live sessions.
create table if not exists public.live_learning_evaluations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_voice_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid references public.classes(id) on delete set null,
  understanding_score integer not null default 0 check (understanding_score between 0 and 100),
  questions_asked integer not null default 0,
  answers_given integer not null default 0,
  correct_signals integer not null default 0,
  needs_revision boolean not null default false,
  topic text,
  strengths text[] not null default '{}',
  recommended_actions text[] not null default '{}',
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id)
);

alter table public.live_learning_evaluations enable row level security;

create policy "Students view own live evaluations"
  on public.live_learning_evaluations for select
  using (student_id = auth.uid());

create policy "Students create own live evaluations"
  on public.live_learning_evaluations for insert
  with check (student_id = auth.uid());

create policy "Students update own live evaluations"
  on public.live_learning_evaluations for update
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy "Teachers view evaluations for their classes"
  on public.live_learning_evaluations for select
  using (exists (
    select 1 from public.classes
    where classes.id = live_learning_evaluations.class_id
      and classes.teacher_id = auth.uid()
  ));

create index if not exists live_learning_evaluations_student_idx
  on public.live_learning_evaluations(student_id, updated_at desc);

create index if not exists live_learning_evaluations_class_idx
  on public.live_learning_evaluations(class_id, updated_at desc);
