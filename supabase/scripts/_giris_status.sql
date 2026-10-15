select id, status, media_generation_status, media_generation_error, narration_key
from memory_lessons
where id = 'f822b149-99c0-4027-910d-301497525631';

select chunk_index, status, r2_key, next_retry_at, last_error
from memory_lesson_narration_chunks
where lesson_id = 'f822b149-99c0-4027-910d-301497525631'
order by chunk_index;

select scene_order, asset_key, media_error, media_next_retry_at
from memory_lesson_scenes
where lesson_id = 'f822b149-99c0-4027-910d-301497525631'
order by scene_order;
