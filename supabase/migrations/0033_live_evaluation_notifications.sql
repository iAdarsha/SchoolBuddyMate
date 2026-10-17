-- Notify the class teacher whenever a student completes another live-learning evaluation.
create or replace function public.notify_live_evaluation_teacher()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.learning_notifications (user_id, kind, title, body, href)
  select c.teacher_id, 'learning_reminder', 'New live-learning evaluation',
    'A new School Buddy learning evaluation is ready for review.',
    '/live-reports'
  from public.classes c
  where c.id = new.class_id;
  return new;
end;
$$;

drop trigger if exists live_evaluations_notify_teacher on public.live_learning_evaluations;
create trigger live_evaluations_notify_teacher after insert on public.live_learning_evaluations
for each row execute function public.notify_live_evaluation_teacher();
