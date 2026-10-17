\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end;
$$;
insert into schools (id,name) values ('00000000-0000-0000-0000-000000000999','Other school');
insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data) values
 ('00000000-0000-0000-0000-000000000001','student@test.invalid','{"full_name":"My Student"}','{}'),
 ('00000000-0000-0000-0000-000000000002','teacher@test.invalid','{"full_name":"My Teacher"}','{"role":"teacher"}'),
 ('00000000-0000-0000-0000-000000000003','teacher2@test.invalid','{"full_name":"Other Teacher"}','{"role":"teacher"}'),
 ('00000000-0000-0000-0000-000000000004','admin@test.invalid','{}','{"role":"admin"}'),
 ('00000000-0000-0000-0000-000000000005','foreign@test.invalid','{"full_name":"FOREIGN_SECRET"}','{"role":"teacher","school_id":"00000000-0000-0000-0000-000000000999"}');
insert into class_groups (id,school_id,name) select '00000000-0000-0000-0000-000000000101',school_id,'Class A' from profiles where id = '00000000-0000-0000-0000-000000000002';
insert into class_groups (id,school_id,name) values ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000999','FOREIGN_CLASS');
insert into subjects (id,school_id,name,teacher_id)
 select '00000000-0000-0000-0000-000000000201',school_id,'Biology',id from profiles where id = '00000000-0000-0000-0000-000000000002';
insert into subjects (id,school_id,name,teacher_id)
 select '00000000-0000-0000-0000-000000000202',school_id,'Robotics',id from profiles where id = '00000000-0000-0000-0000-000000000003';
insert into subjects (id,school_id,name,teacher_id)
 select '00000000-0000-0000-0000-000000000203',school_id,'FOREIGN_SUBJECT',id from profiles where id = '00000000-0000-0000-0000-000000000005';
insert into classes (id,school_id,teacher_id,name,class_group_id,subject_id)
 select '00000000-0000-0000-0000-000000000301',school_id,teacher_id,'Biology','00000000-0000-0000-0000-000000000101',id from subjects where name='Biology';
insert into classes (id,school_id,teacher_id,name,class_group_id,subject_id)
 select '00000000-0000-0000-0000-000000000302',school_id,teacher_id,'Robotics','00000000-0000-0000-0000-000000000101',id from subjects where name='Robotics';
insert into classes (id,school_id,teacher_id,name,class_group_id,subject_id)
 select '00000000-0000-0000-0000-000000000303',school_id,teacher_id,'FOREIGN_OFFERING','00000000-0000-0000-0000-000000000102',id from subjects where name='FOREIGN_SUBJECT';
insert into enrollments (class_group_id,student_id) values ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001');
insert into materials (id,class_id,teacher_id,title,status,extracted_text) values
 ('00000000-0000-0000-0000-000000000601','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000002','Biology notes','extracted','Photosynthesis converts light energy into chemical energy.'),
 ('00000000-0000-0000-0000-000000000602','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000003','Robotics notes','extracted','Robotics uses motors and sensors. OTHER_TEACHER_MATERIAL'),
 ('00000000-0000-0000-0000-000000000603','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000005','FOREIGN_MATERIAL','extracted','Photosynthesis FOREIGN_CONTENT');
insert into assignments (class_id,title) values ('00000000-0000-0000-0000-000000000303','FOREIGN_ASSIGNMENT');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.assert_true(chat_school_context(array['teachers','students','classes','subjects','assignments','materials'],'photosynthesis')::text not like '%FOREIGN_%','admin chat does not leak other schools');
select pg_temp.assert_true(chat_school_context(array['teachers'],'')->'sources'->0->>'excerpt' like '%My Teacher%','admin can see own school teacher names');
select pg_temp.assert_true(chat_school_context(array['materials'],'photosynthesis')->'sources'->0->>'excerpt' like '%Photosynthesis%','material excerpts contain matching text');
select pg_temp.assert_true(chat_school_context(array['materials'],'unfindableword')->'limitations' ? 'noMaterials','empty search is explicitly reported');
select pg_temp.assert_true(chat_school_context(array['materials'],'')->'limitations' ? 'searchNeeded','empty query requests specificity');
reset role;
insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data)
 select gen_random_uuid(), 'bulk' || n || '@test.invalid', jsonb_build_object('full_name','Bulk ' || n), '{"role":"teacher"}' from generate_series(1,51) n;
set local role authenticated;
select pg_temp.assert_true(chat_school_context(array['teachers'],'')->'limitations' ? 'partialRecords','capped results declare incomplete coverage');
select pg_temp.assert_true((chat_school_context(array['teachers'],'')->'sources'->0->>'excerpt')::jsonb->>'total_visible_records'='53','total counts include rows beyond the list cap');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true(chat_school_context(array['materials'],'photosynthesis OR robotics')::text not like '%OTHER_TEACHER_MATERIAL%','teacher cannot retrieve colleague materials');
select pg_temp.assert_true(chat_school_context(array['teachers'],'')->'limitations' ? 'roleLimited','teacher cannot list teacher accounts');
select pg_temp.assert_true(chat_school_context(array['students'],'')::text like '%My Student%','teacher sees own roster');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true(
  jsonb_array_length(chat_school_context(array['materials'],'photosynthesis')->'sources') > 0,
  'students can search enrolled course materials'
);
select pg_temp.assert_true(jsonb_array_length(chat_school_context(array['teachers','students'],'')->'sources') = 0,'students cannot enumerate accounts');
select pg_temp.assert_true(chat_school_context(array['classes','assignments'],'')::text not like '%FOREIGN_%','student retrieval respects enrollment/school');
reset role;
update profiles set restricted=true where id='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin
  perform public.chat_school_context(array['classes'],'');
  raise exception 'Restricted user was allowed';
exception when insufficient_privilege then null;
end $$;
reset role;
-- Persisted evidence travels with the assistant message and survives reads.
insert into ai_chat_sessions(id,user_id) values ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000000004');
insert into ai_chat_messages(session_id,user_id,role,text,grounding) values
 ('00000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000000004','assistant','Example answer','{"basis":"school","sources":[{"id":"teachers"}],"retrievedAt":"2026-09-26T00:00:00Z","limitations":[]}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select pg_temp.assert_true((select grounding->>'basis'='school' from ai_chat_messages where session_id='00000000-0000-0000-0000-000000000701'),'history retains grounding');
reset role;
rollback;
\echo 'Grounded chat database tests passed.'
