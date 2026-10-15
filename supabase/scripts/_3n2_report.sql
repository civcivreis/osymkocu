select jsonb_build_object(
  'posts_with_expiry', (select count(*) from social_posts where content_type = 'post' and expires_at is not null),
  'posts_null_expiry', (select count(*) from social_posts where content_type = 'post' and expires_at is null),
  'virtual_posts_null_expiry', (
    select count(*) from social_posts p
    join virtual_student_profiles v on v.profile_id = p.user_id
    where p.content_type = 'post' and p.expires_at is null
  ),
  'virtual_posts_recent_48h', (
    select count(*) from social_posts p
    join virtual_student_profiles v on v.profile_id = p.user_id
    where p.content_type = 'post' and p.created_at > now() - interval '48 hours'
  ),
  'story_rows', (select count(*) from stories),
  'stories_with_24h', (
    select count(*) from stories
    where expires_at is not null
      and abs(extract(epoch from (expires_at - created_at)) - 86400) < 60
  ),
  'tts', (
    select jsonb_agg(jsonb_build_object(
      'task', task_type, 'primary', primary_model, 'fallback', fallback_model, 'transitional', transitional, 'notes', notes
    ) order by task_type)
    from ai_model_config
    where task_type in ('tts_generation', 'coach_voice_preview')
  ),
  'giris_chunks', (
    select jsonb_agg(jsonb_build_object(
      'idx', chunk_index, 'status', status, 'next_retry_at', next_retry_at, 'model', model
    ) order by chunk_index)
    from memory_lesson_narration_chunks
    where lesson_id = 'f822b149-99c0-4027-910d-301497525631'
  )
) as report;
