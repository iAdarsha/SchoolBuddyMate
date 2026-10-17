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
