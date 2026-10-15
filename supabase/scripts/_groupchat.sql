insert into public.virtual_student_activity_jobs (profile_id, activity_type, scheduled_for, context)
values
  ('b0000000-0000-4000-8000-000000000001', 'group_chat', now(), '{"wake":"3k1"}'::jsonb),
  ('b0000000-0000-4000-8000-000000000002', 'group_chat', now(), '{"wake":"3k1"}'::jsonb),
  ('b0000000-0000-4000-8000-000000000004', 'group_chat', now(), '{"wake":"3k1"}'::jsonb)
returning id;
