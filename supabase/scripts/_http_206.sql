select id, status_code, timed_out, error_msg, left(content::text, 280) as head
from net._http_response
where id = 206;
