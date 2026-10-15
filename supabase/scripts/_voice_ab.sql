select net.http_post(
  url := 'https://qvmhtzpaoxdychyjhqyj.supabase.co/functions/v1/coach-voice-test',
  body := '{}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-factory-wake', (select wake_secret from public.content_factory_settings where id = 1)
  )
) as req_id;
