select left(body, 80) as body, created_at, slug, public.exam_chat_skeleton(body) as sk
from exam_chat_messages
where body ilike '%aklıma geldi%' or body ilike '%aklima geldi%' or body ilike '%anlatınca%'
order by created_at desc
limit 25;
