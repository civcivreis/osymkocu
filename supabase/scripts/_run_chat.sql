select jsonb_build_object(
  'g1', public.virtual_run_job('5bdc06b4-1c1d-450d-bd84-e0b61d5c943b'),
  'g2', public.virtual_run_job('734e0c8b-8f6c-4591-b667-beafbc707cd5'),
  'g3', public.virtual_run_job('04c51f9f-e4dd-4ee7-81c1-47e63f46fe70')
) as chats;
