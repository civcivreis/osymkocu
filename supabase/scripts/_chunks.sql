select chunk_index, chunk_role, status, model, left(coalesce(last_error,''),120) as err, duration_ms, attempt_count, next_retry_at
from memory_lesson_narration_chunks
where lesson_id = 'f822b149-99c0-4027-910d-301497525631'
order by chunk_index;
select primary_model, fallback_model, notes from ai_model_config where task_type in ('tts_generation','coach_voice_preview');
select media_generation_status, media_generation_error, narration_key from memory_lessons where id = 'f822b149-99c0-4027-910d-301497525631';
