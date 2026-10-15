alter table public.memory_lessons
  add column if not exists media_next_retry_at timestamptz;

alter table public.content_generation_jobs
  add column if not exists next_retry_at timestamptz;

alter table public.content_factory_settings
  add column if not exists image_concurrency int not null default 1,
  add column if not exists tts_concurrency int not null default 1;

update public.content_factory_settings
set image_concurrency = 1, tts_concurrency = 1
where id = 1;

create or replace function public.publish_validated_memory_lesson(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.memory_lessons%rowtype;
  v_scenes int;
  v_ready int;
  v_ck int;
  v_fn int;
begin
  select * into v_row from public.memory_lessons where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.status = 'published' then
    return jsonb_build_object('id', p_id, 'status', 'published', 'already', true);
  end if;
  if coalesce(v_row.pedagogy_score, 0) < 80 then raise exception 'PEDAGOGY'; end if;
  if coalesce(v_row.narration, '') = '' or v_row.narration_key is null then raise exception 'NO_NARRATION'; end if;
  select count(*)::int, count(*) filter (where coalesce(asset_key, '') <> '')::int
    into v_scenes, v_ready
  from public.memory_lesson_scenes where lesson_id = p_id;
  if v_scenes < 4 or v_ready <> v_scenes then raise exception 'MEDIA_INCOMPLETE'; end if;
  select
    count(*) filter (where question_type = 'checkpoint'),
    count(*) filter (where question_type = 'final')
  into v_ck, v_fn
  from public.memory_lesson_questions where lesson_id = p_id;
  if v_ck < 2 or v_fn <> 10 then raise exception 'QUESTIONS_INCOMPLETE'; end if;

  update public.memory_lessons
  set status = 'published',
      published_at = coalesce(published_at, now()),
      media_generation_status = 'ready',
      media_generation_error = null,
      updated_at = now()
  where id = p_id;
  if v_row.topic_id is not null then
    update public.topic_catalog set content_status = 'published', updated_at = now() where id = v_row.topic_id;
  end if;
  return jsonb_build_object('id', p_id, 'status', 'published');
end;
$$;

create or replace function public.guided_e2e_as_user(p_user uuid, p_lesson uuid, p_exam uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid;
  v_xp0 int;
  v_xp1 int;
  v_step text;
  v_ckpt uuid;
  v_final uuid;
  v_alt uuid;
  v_correct text;
  v_wrong text;
  v_obj text;
  v_mastery_before text;
  v_mastery_after text;
  v_plan jsonb;
  v_resume jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);

  select coalesce(current_xp, 0) into v_xp0 from public.profiles where id = p_user;
  v_plan := to_jsonb(public.build_daily_study_plan(p_exam));
  v_session := (public.start_guided_session(p_exam, 'solo')->'session'->>'id')::uuid;

  perform public.study_session_act(v_session, 'greet_done', '{}'::jsonb);
  perform public.study_session_act(v_session, 'save_prefs', jsonb_build_object('preferred_session_minutes', 25, 'break_frequency_lessons', 2));
  perform public.study_session_act(v_session, 'how_we_study_done', '{}'::jsonb);
  perform public.study_session_act(v_session, 'start_lesson', jsonb_build_object('lesson_id', p_lesson));
  perform public.ensure_lesson_timeline(p_lesson);

  select id into v_ckpt
  from public.memory_lesson_questions
  where lesson_id = p_lesson and question_type = 'checkpoint'
  order by question_order limit 1;

  select id, correct_answer, question_strategy
    into v_final, v_correct, v_obj
  from public.memory_lesson_questions
  where lesson_id = p_lesson and question_type = 'final'
  order by question_order limit 1;
  v_wrong := case when v_correct = 'A' then 'B' else 'A' end;

  select status into v_mastery_before
  from public.user_objective_mastery
  where user_id = p_user and objective_key = coalesce(v_obj, v_final::text);

  perform public.record_guided_attempt(v_session, v_correct, v_correct, true, v_ckpt, null, p_lesson, 'checkpoint', 'checkpoint', 4000);
  perform public.study_session_act(v_session, 'checkpoint_set_done', '{}'::jsonb);
  perform public.study_session_act(v_session, 'lesson_done', jsonb_build_object('lesson_id', p_lesson));

  perform public.record_guided_attempt(v_session, v_wrong, v_correct, false, v_final, null, p_lesson, v_obj, v_obj, 5000);

  select id into v_alt
  from public.memory_lesson_questions
  where lesson_id = p_lesson and question_type = 'final' and id <> v_final
    and question_strategy is not distinct from v_obj
  order by question_order
  limit 1;
  if v_alt is null then
    select id, correct_answer into v_alt, v_correct
    from public.memory_lesson_questions
    where lesson_id = p_lesson and question_type = 'final' and id <> v_final
    order by question_order offset 1 limit 1;
  else
    select correct_answer into v_correct from public.memory_lesson_questions where id = v_alt;
  end if;
  perform public.record_guided_attempt(v_session, v_correct, v_correct, true, coalesce(v_alt, v_final), null, p_lesson, v_obj, v_obj, 4500);

  perform public.study_session_act(v_session, 'final_done', '{}'::jsonb);
  perform public.study_session_act(v_session, 'save_resume', jsonb_build_object('position_ms', 110000, 'status', 'paused'));
  v_resume := public.study_session_act(v_session, 'resume', '{}'::jsonb);
  perform public.study_session_act(v_session, 'lesson_done', jsonb_build_object('lesson_id', p_lesson));

  select coalesce(current_xp, 0) into v_xp1 from public.profiles where id = p_user;
  select status into v_mastery_after
  from public.user_objective_mastery
  where user_id = p_user and objective_key = coalesce(v_obj, v_final::text);
  select current_step into v_step from public.guided_study_sessions where id = v_session;

  return jsonb_build_object(
    'session_id', v_session,
    'plan', v_plan,
    'checkpoint_id', v_ckpt,
    'wrong_question_id', v_final,
    'remediation_question_id', v_alt,
    'mastery_before', v_mastery_before,
    'mastery_after', v_mastery_after,
    'xp_before', v_xp0,
    'xp_after', v_xp1,
    'xp_delta', v_xp1 - v_xp0,
    'resume', v_resume,
    'step', v_step
  );
end;
$$;
