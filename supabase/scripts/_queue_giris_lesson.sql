-- One-off: queue a single Giriş cümlesi full_lesson at probe priority. Factory motor stays paused.
with ver as (
  select id
  from public.curriculum_versions
  where exam_id = 'd3c22d02-ad8f-49be-a6c5-61c0f7d12a16'
  order by case when status = 'active' then 0 else 1 end, created_at desc
  limit 1
)
insert into public.content_generation_jobs (
  canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
  job_type, status, coverage_mode, lesson_scope, priority
)
select
  'a87b5809-0d64-4996-8260-56d7a525b60e'::uuid,
  ver.id,
  'd3c22d02-ad8f-49be-a6c5-61c0f7d12a16'::uuid,
  'b23ab496-b7fa-46b6-b73f-deb2da6fe95c'::uuid,
  '3d2a041d-5b86-47ad-8a6f-2d8d23821611'::uuid,
  '22deb6f2-543b-4ee0-9c81-262c4ee877ab'::uuid,
  'full_lesson', 'queued', 'core', 'core', 1000
from ver
where not exists (
  select 1 from public.content_generation_jobs j
  where j.canonical_topic_id = 'a87b5809-0d64-4996-8260-56d7a525b60e'
    and j.status not in ('completed', 'failed', 'cancelled')
)
returning id, status, priority, canonical_topic_id;
