select id, status, factory_stage, error_code, left(coalesce(error_message,''), 180) as err, memory_lesson_id, attempt_count
from public.content_generation_jobs
where id = 'f4e77767-764b-42d3-a8e0-01dad86e2cad';
