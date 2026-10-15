do $$
declare
  v_ayse uuid;
  v_elif uuid;
  v_post uuid;
  v_result jsonb;
  v_job uuid;
begin
  select v.profile_id into v_ayse
  from public.virtual_student_profiles v
  join public.profiles p on p.id = v.profile_id
  where p.display_name = 'Ayşe3' and v.is_enabled
  limit 1;
  select v.profile_id into v_elif
  from public.virtual_student_profiles v
  join public.profiles p on p.id = v.profile_id
  where p.display_name = 'Elif1' and v.is_enabled
  limit 1;
  if v_ayse is null or v_elif is null then
    raise exception 'profiles missing';
  end if;
  perform public.remember_virtual_fact(
    v_ayse, 'recent_test', 'last',
    jsonb_build_object('topic', 'Giriş cümlesi', 'correct', 7, 'wrong', 3, 'total', 10),
    interval '72 hours'
  );
  insert into public.virtual_student_activity_jobs (profile_id, activity_type, status, scheduled_for, context)
  values (v_ayse, 'social_post', 'queued', now(), jsonb_build_object('controlled', true))
  returning id into v_job;
  v_result := public.virtual_run_job(v_job);
  v_post := nullif(v_result->'pulse'->>'post_id', '')::uuid;
  if v_post is null then
    v_post := (v_result->'pulse'->'social'->>'post_id')::uuid;
  end if;
  if v_post is null then
    select id into v_post from public.social_posts where user_id = v_ayse order by created_at desc limit 1;
  end if;
  insert into public.virtual_student_activity_jobs (profile_id, activity_type, status, scheduled_for, context)
  values
    (v_elif, 'social_like', 'queued', now(), jsonb_build_object('controlled', true, 'post_id', v_post)),
    (v_elif, 'social_comment', 'queued', now(), jsonb_build_object('controlled', true, 'post_id', v_post));
end $$;

select p.id, pr.display_name, p.body, p.expires_at, p.created_at,
  (select count(*) from post_likes l where l.post_id = p.id) as likes,
  (select count(*) from post_comments c where c.post_id = p.id) as comments
from social_posts p
join profiles pr on pr.id = p.user_id
where pr.display_name = 'Ayşe3'
order by p.created_at desc
limit 3;
