select jsonb_build_object(
  'etm', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='exam_topic_map'),
  'start_fns', (
    select jsonb_agg(p.proname order by 1)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname ilike '%factory%'
  )
) as x;
