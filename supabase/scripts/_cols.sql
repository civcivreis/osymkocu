select jsonb_build_object(
  'exams', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='exams'),
  'questions', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='questions'),
  'cv', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='curriculum_versions'),
  'cfs', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='content_factory_settings'),
  'ss', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='study_sessions'),
  'qset', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='question_sets'),
  'cron', (select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'sched', schedule, 'cmd', command) order by jobname), '[]'::jsonb) from cron.job)
) as cols;
