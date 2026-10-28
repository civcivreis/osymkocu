select left(body, 80) as body, created_at, slug
from exam_chat_messages
where created_at > '2026-10-15 01:10:00+00'
order by created_at desc
limit 15;
