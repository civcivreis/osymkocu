-- Grammar-safe templates + short global duplicate window for virtual posts.

update public.virtual_social_templates
set body = 'konuyu kapattım, nefes'
where body = '{topic}i kapattım, nefes';

update public.virtual_social_templates
set body = '{topic} ile ısındım'
where body = '{topic} ile ısınayım dedim';

create or replace function public.virtual_try_social_post(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.virtual_student_profiles%rowtype;
  v_topic text;
  v_subject text;
  v_n int;
  v_ok int;
  v_kind text;
  v_picked record;
  v_post uuid;
begin
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile and is_enabled;
  if not found then return jsonb_build_object('ok', false, 'reason', 'PROFILE_DISABLED'); end if;
  perform public.set_virtual_presence(p_profile, 'social', v_prof.current_subject_id, v_prof.current_topic_id, null, 8);

  select name into v_subject from public.subjects where id = v_prof.current_subject_id;
  select name into v_topic from public.topics where id = v_prof.current_topic_id;

  select value->>'topic', (value->>'wrong')::int, (value->>'correct')::int
  into v_topic, v_n, v_ok
  from public.virtual_student_memory
  where profile_id = p_profile and memory_type = 'recent_test'
  order by updated_at desc limit 1;

  v_kind := case
    when v_ok is not null and v_n is not null and v_ok < greatest(3, (v_ok + coalesce(v_n, 0)) / 3) then 'LOW_SCORE'
    when v_ok is not null then 'TEST_COMPLETED'
    when v_topic is null and v_subject is null then 'DAILY_GOAL'
    when random() < 0.15 then 'BREAK'
    when random() < 0.2 then 'DAILY_GOAL'
    when random() < 0.45 then 'LESSON_STARTED'
    else 'LESSON_COMPLETED'
  end;

  select * into v_picked from public.pick_virtual_social_template(
    p_profile, v_kind, v_subject, v_topic, v_ok, v_prof.daily_goal_questions
  );
  if v_picked.body is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE');
  end if;
  if public.content_moderation_level(v_picked.body) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED');
  end if;
  if exists (
    select 1 from public.social_posts sp
    where lower(regexp_replace(sp.body, '\s+', ' ', 'g')) = lower(regexp_replace(v_picked.body, '\s+', ' ', 'g'))
      and sp.created_at > now() - interval '2 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'GLOBAL_DUP');
  end if;

  insert into public.social_posts (user_id, body, kind, content_type, subject_id, duration_minutes, expires_at, topic_id)
  values (p_profile, v_picked.body, 'status', 'post', v_prof.current_subject_id, 60, null, v_prof.current_topic_id)
  returning id into v_post;

  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_post', 1, 0, 'none', v_kind);

  return jsonb_build_object('ok', true, 'post_id', v_post, 'body', v_picked.body, 'reason', 'TEMPLATE');
end;
$$;
