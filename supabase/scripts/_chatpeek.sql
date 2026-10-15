select m.created_at, pr.display_name, left(m.body, 120) as body
from public.exam_chat_messages m
join public.profiles pr on pr.id = m.sender_id
order by m.created_at desc
limit 8;
