select net.http_post(
  url := 'https://qvmhtzpaoxdychyjhqyj.supabase.co/functions/v1/memory-lesson-generate-media',
  body := jsonb_build_object(
    'lesson_id', 'f822b149-99c0-4027-910d-301497525631',
    'mode', 'narration',
    'chunk_index', 0
  ),
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-factory-wake', (select wake_secret from public.content_factory_settings where id = 1)
  )
) as req_id;
