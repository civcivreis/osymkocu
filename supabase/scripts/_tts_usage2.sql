select created_at, task_type, model, success, error_code, latency_ms
from ai_usage_log
where created_at > now() - interval '10 minutes'
order by created_at desc
limit 6;
