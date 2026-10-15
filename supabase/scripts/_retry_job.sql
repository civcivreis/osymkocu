update public.content_generation_jobs
set status = 'queued', error_code = null, error_message = null, locked_until = null
where id = 'f4e77767-764b-42d3-a8e0-01dad86e2cad' and status = 'failed'
returning status;
