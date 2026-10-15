do $$
declare
  v_ayse uuid;
  v_elif uuid;
  v_post uuid;
  v_result jsonb;
  v_job uuid;
  v_like_job uuid;
  v_comment_job uuid;
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
    select id into v_post from public.social_posts where user_id = v_ayse order by created_at desc limit 1;
  end if;
  if v_post is not null and not exists (select 1 from public.post_likes where post_id = v_post and user_id = v_elif) then
    insert into public.post_likes (post_id, user_id) values (v_post, v_elif) on conflict do nothing;
  end if;
  if v_post is not null and not exists (select 1 from public.post_comments where post_id = v_post and user_id = v_elif) then
    insert into public.post_comments (post_id, user_id, body)
    values (v_post, v_elif, 'aynı setteyim, sonlar ağırdı');
  end if;
  insert into public.virtual_student_activity_jobs (profile_id, activity_type, status, scheduled_for, completed_at, context)
  values
    (v_elif, 'social_like', 'completed', now(), now(), jsonb_build_object('controlled', true, 'post_id', v_post)),
    (v_elif, 'social_comment', 'completed', now(), now(), jsonb_build_object('controlled', true, 'post_id', v_post));
end $$;
