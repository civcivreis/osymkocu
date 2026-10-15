select jsonb_build_object(
  'a_room', public.virtual_run_job('11856352-9d34-4c55-9f95-19953392c2fe'),
  'b_test', public.virtual_run_job('c61234a8-2665-4961-b8a5-7b86600c7c4b'),
  'c_post', public.virtual_run_job('ed88b69a-eb37-4b39-9946-28ea868873f5')
) as wake;
