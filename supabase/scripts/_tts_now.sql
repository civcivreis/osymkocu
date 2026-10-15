select created_at, task_type, model, success, error_code, latency_ms
from ai_usage_log
where created_at > now() - interval '15 minutes'
order by created_at desc
limit 8;

select chunk_index, status, model, attempt_count, next_retry_at, left(coalesce(last_error,''),40) as err
from memory_lesson_narration_chunks
where lesson_id = 'f822b149-99c0-4027-910d-301497525631'
order by chunk_index;
