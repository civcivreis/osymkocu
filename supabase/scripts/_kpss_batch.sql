select factory_run_job_cap, max_concurrency, engine_state, last_idle_reason, scope_subject_name, production_enabled
from content_factory_settings where id = 1;

select j.status, j.job_type, ct.name, j.created_at
from content_generation_jobs j
join canonical_topics ct on ct.id = j.canonical_topic_id
where j.created_at > now() - interval '2 hours'
order by j.created_at desc
limit 20;

select count(*) as open_jobs
from content_generation_jobs
where status in ('queued','generating_text','validating_pedagogy','generating_questions','generating_media');
