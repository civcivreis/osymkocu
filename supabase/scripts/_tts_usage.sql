select created_at, task_type, model, success, error_code, latency_ms
from ai_usage_log
where task_type in ('tts_generation','coach_voice_preview')
order by created_at desc
limit 12;
