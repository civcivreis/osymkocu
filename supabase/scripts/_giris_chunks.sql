select chunk_index, status, r2_key, next_retry_at, left(coalesce(last_error,''), 160) as err
from memory_lesson_narration_chunks
where lesson_id = 'f822b149-99c0-4027-910d-301497525631'
order by chunk_index;
