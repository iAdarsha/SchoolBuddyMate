-- Allows teachers to target an assignment to one student while keeping
-- target_student_id null for class-wide assignments.
alter table public.assignments
  add column if not exists target_student_id uuid references public.profiles(id) on delete cascade;

drop policy if exists "Students view assignments in enrolled classes" on public.assignments;
create policy "Students view assignments in enrolled classes"
  on public.assignments for select
  using (
    public.is_enrolled(assignments.class_id, auth.uid())
    and (assignments.target_student_id is null or assignments.target_student_id = auth.uid())
  );

create index if not exists assignments_target_student_idx
  on public.assignments(target_student_id);
