-- Controlled current-time virtual surfaces. No new profiles. No backdating.
with ins as (
  insert into public.virtual_student_activity_jobs (profile_id, activity_type, scheduled_for, context)
  values
    ('b0000000-0000-4000-8000-000000000001', 'create_room', now(), '{"phase":"3m"}'::jsonb),
    ('b0000000-0000-4000-8000-000000000002', 'join_room', now(), '{"phase":"3m"}'::jsonb),
    ('b0000000-0000-4000-8000-000000000001', 'room_chat', now(), '{"phase":"3m"}'::jsonb),
    ('b0000000-0000-4000-8000-000000000002', 'room_chat', now(), '{"phase":"3m"}'::jsonb),
    ('b0000000-0000-4000-8000-000000000003', 'group_chat', now(), '{"phase":"3m"}'::jsonb),
    ('b0000000-0000-4000-8000-000000000004', 'group_chat', now(), '{"phase":"3m"}'::jsonb),
    ('b0000000-0000-4000-8000-000000000003', 'group_chat', now(), '{"phase":"3m"}'::jsonb),
    ('b0000000-0000-4000-8000-000000000004', 'group_chat', now(), '{"phase":"3m"}'::jsonb)
  returning id, activity_type
)
select id, activity_type, public.virtual_run_job(id) as result from ins;
