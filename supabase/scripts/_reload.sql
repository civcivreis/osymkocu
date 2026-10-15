notify pgrst, 'reload schema';
select to_regclass('public.memory_lesson_narration_chunks') as chunks_table;
select count(*) as scene_cols from information_schema.columns where table_name = 'memory_lesson_scenes' and column_name = 'media_next_retry_at';
select primary_model, fallback_model from ai_model_config where task_type = 'tts_generation';
