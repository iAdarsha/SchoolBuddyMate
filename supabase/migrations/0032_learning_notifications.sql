-- In-app learning notifications for assignments and released feedback.
create table if not exists public.learning_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('assignment', 'feedback', 'learning_reminder')),
  title text not null,
  body text not null,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.learning_notifications enable row level security;
drop policy if exists "Users view own learning notifications" on public.learning_notifications;
create policy "Users view own learning notifications" on public.learning_notifications for select using (user_id = auth.uid());
drop policy if exists "Users mark own learning notifications read" on public.learning_notifications;
create policy "Users mark own learning notifications read" on public.learning_notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.notify_assignment_targets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.learning_notifications (user_id, kind, title, body, href)
  select e.student_id, 'assignment', 'New School Buddy assessment',
    'A new assessment has been assigned: ' || new.title,
    '/assignments/' || new.id::text
  from public.enrollments e
  join public.classes c on c.class_group_id = e.class_group_id
  where c.id = new.class_id
    and (new.target_student_id is null or e.student_id = new.target_student_id);
  return new;
end;
$$;

drop trigger if exists assignments_notify_targets on public.assignments;
create trigger assignments_notify_targets after insert on public.assignments
for each row execute function public.notify_assignment_targets();

create or replace function public.notify_submission_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'graded' and (old.status is distinct from 'graded' or old.feedback is distinct from new.feedback or old.score is distinct from new.score) then
    insert into public.learning_notifications (user_id, kind, title, body, href)
    select new.student_id, 'feedback', 'Your assessment feedback is ready',
      case when new.feedback is null or btrim(new.feedback) = '' then 'Your teacher has reviewed your assessment.' else new.feedback end,
      '/assignments/' || new.assignment_id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists submissions_notify_feedback on public.submissions;
create trigger submissions_notify_feedback after update on public.submissions
for each row execute function public.notify_submission_feedback();

create index if not exists learning_notifications_user_created_idx on public.learning_notifications(user_id, created_at desc);
