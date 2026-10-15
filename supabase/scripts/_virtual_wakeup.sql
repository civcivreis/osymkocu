-- Controlled wake-up: 3 existing profiles, current time only. No new profiles.
insert into public.virtual_student_activity_jobs (profile_id, activity_type, scheduled_for, context)
values
  ('b0000000-0000-4000-8000-000000000002', 'join_room', now(), '{"wake":"3k1"}'::jsonb),
  ('b0000000-0000-4000-8000-000000000001', 'solve_test', now(), '{"wake":"3k1"}'::jsonb),
  ('b0000000-0000-4000-8000-000000000003', 'social_post', now(), '{"wake":"3k1"}'::jsonb)
returning id, profile_id, activity_type, status;
