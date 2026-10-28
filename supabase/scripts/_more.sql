select left(body, 100) as body
from exam_chat_line_bank
where body ilike '%aklıma%' or body ilike '%anlatınca%' or body ilike '%{who}%' or body ilike '%{ad}%'
limit 30;
