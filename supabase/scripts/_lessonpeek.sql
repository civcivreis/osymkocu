select id, title, topic, status, length(coalesce(narration,'')) as narration_len, generation_status, generation_error, pedagogy_score
from public.memory_lessons where id = 'f822b149-99c0-4027-910d-301497525631';
