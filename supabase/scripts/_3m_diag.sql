select
  l.id,
  l.status,
  l.generation_status,
  left(coalesce(l.generation_error,''), 160) as generation_error,
  l.prompt_version,
  l.generation_model,
  length(coalesce(l.narration,'')) as narration_len,
  l.generation_metadata
from public.memory_lessons l
where l.id = 'f822b149-99c0-4027-910d-301497525631';

select id, status, error_code, attempt_count, max_attempts, factory_stage, left(coalesce(error_message,''), 220) as err
from public.content_generation_jobs
where canonical_topic_id = 'a87b5809-0d64-4996-8260-56d7a525b60e'
order by created_at desc
limit 5;

select task_type, model, success, error_code, prompt_version, created_at
from public.ai_usage_log
where lesson_id = 'f822b149-99c0-4027-910d-301497525631'
order by created_at desc
limit 12;
