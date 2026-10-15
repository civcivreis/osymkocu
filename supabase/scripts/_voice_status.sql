select id, status_code, timed_out, error_msg,
  case when content is null then null else left(convert_from(content, 'utf8'), 180) end as head
from net._http_response
where id = 91;
