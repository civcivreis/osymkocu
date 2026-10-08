-- Drop leftover sample topics from factory maps; keep rows/lessons. Engine stays paused.

update public.exam_topic_map m
set included = false
from public.topic_catalog t
join public.unit_catalog u on u.id = t.unit_id
where m.topic_id = t.id
  and m.included
  and coalesce(u.code, '') is distinct from 'MASTER';

update public.content_factory_settings
set production_enabled = false,
    engine_state = 'paused',
    last_idle_reason = 'paused',
    updated_at = now()
where id = 1;
