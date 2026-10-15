-- 3K.1 daily plan actionable items + 3L virtual scheduler recovery.
-- Does not start the content factory motor. Does not seed fake history.

alter table public.virtual_student_engine_settings
  add column if not exists last_tick_at timestamptz,
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists stall_threshold_hours int not null default 6;

create or replace function public.build_daily_study_plan(p_exam uuid)
returns public.daily_study_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_prefs public.user_study_preferences;
  v_rec jsonb;
  v_items jsonb := '[]'::jsonb;
  v_row public.daily_study_plans;
  v_item jsonb;
  v_lesson uuid;
  v_title text;
  v_subject text;
  v_topic text;
  v_n int := 0;
  v_q int := 0;
  v_unusable boolean := false;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  v_prefs := public.get_or_create_study_preferences();
  select * into v_row from public.daily_study_plans where user_id = v_user and plan_date = v_today;
  if v_row.id is not null and v_row.status not in ('skipped', 'ready') then
    return v_row;
  end if;
  if v_row.id is not null and v_row.status = 'ready' then
    select exists (
      select 1
      from jsonb_array_elements(coalesce(v_row.planned_items, '[]'::jsonb)) item
      where item->>'kind' = 'lesson'
        and (
          nullif(item->>'lesson_id', '') is null
          or not exists (
            select 1 from public.memory_lessons l
            where l.id = (item->>'lesson_id')::uuid and l.status = 'published'
          )
        )
    ) into v_unusable;
    if not v_unusable then
      return v_row;
    end if;
  end if;

  v_rec := public.get_today_study_recommendations(p_exam);
  for v_item in select * from jsonb_array_elements(coalesce(v_rec->'items', '[]'::jsonb))
  loop
    v_lesson := nullif(v_item->>'lesson_id', '')::uuid;
    if v_lesson is null or not exists (
      select 1 from public.memory_lessons l where l.id = v_lesson and l.status = 'published'
    ) then
      select l.id, l.title, l.subject, l.topic
        into v_lesson, v_title, v_subject, v_topic
      from public.memory_lessons l
      where l.status = 'published'
        and (
          l.canonical_topic_id = nullif(v_item->>'canonical_topic_id', '')::uuid
          or l.exam_id = p_exam
          or p_exam is null
        )
        and not exists (
          select 1 from jsonb_array_elements(v_items) x where x->>'lesson_id' = l.id::text
        )
      order by case when l.canonical_topic_id = nullif(v_item->>'canonical_topic_id', '')::uuid then 0 else 1 end, l.published_at desc nulls last
      limit 1;
    else
      select l.title, l.subject, l.topic into v_title, v_subject, v_topic
      from public.memory_lessons l where l.id = v_lesson;
    end if;
    if v_lesson is null then continue; end if;
    v_n := v_n + 1;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', 'lesson', 'mandatory', true, 'minutes', 6,
      'title', coalesce(v_title, v_item->>'topic_name', 'Mikro ders'),
      'subject', coalesce(v_subject, v_item->>'subject_name'),
      'topic', coalesce(v_topic, v_item->>'topic_name'),
      'lesson_id', v_lesson,
      'canonical_topic_id', v_item->>'canonical_topic_id',
      'reason', v_item->>'reason_code',
      'done', false
    ));
    if v_n >= 3 then exit; end if;
  end loop;

  if v_n < 3 then
    for v_lesson, v_title, v_subject, v_topic in
      select l.id, l.title, l.subject, l.topic
      from public.memory_lessons l
      where l.status = 'published'
        and not exists (select 1 from jsonb_array_elements(v_items) x where x->>'lesson_id' = l.id::text)
      order by l.published_at desc nulls last
      limit (3 - v_n)
    loop
      v_n := v_n + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'kind', 'lesson', 'mandatory', true, 'minutes', 6,
        'title', v_title, 'subject', v_subject, 'topic', v_topic,
        'lesson_id', v_lesson, 'reason', 'published_fallback', 'done', false
      ));
    end loop;
  end if;

  select count(*)::int into v_q from public.questions where is_published is true and question_status = 'published';

  if v_n = 0 and v_q = 0 then
    v_items := jsonb_build_array(jsonb_build_object(
      'kind', 'unavailable', 'mandatory', false, 'minutes', 0,
      'title', 'İçerik hazırlanıyor',
      'body', 'Şu anda yayınlanmış ders veya test yok. Koç planı boş bırakıldı; sahte ders eklenmedi.',
      'done', false
    ));
    insert into public.daily_study_plans (user_id, plan_date, exam_id, target_minutes, target_questions, planned_items, status)
    values (v_user, v_today, p_exam, coalesce(v_prefs.preferred_session_minutes, 40), 0, v_items, 'ready')
    on conflict (user_id, plan_date) do update
      set planned_items = excluded.planned_items, exam_id = excluded.exam_id, target_questions = 0, updated_at = now()
    returning * into v_row;
    return v_row;
  end if;

  if v_n > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', 'break', 'mandatory', false, 'minutes', coalesce(v_prefs.preferred_break_minutes, 5),
      'title', 'Kısa mola', 'done', false
    ));
  end if;
  if v_q > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', 'daily_test', 'mandatory', true, 'minutes', 12, 'title', 'Günlük karışık test',
      'question_count', least(20, v_q), 'done', false
    ));
  end if;

  insert into public.daily_study_plans (user_id, plan_date, exam_id, target_minutes, target_questions, planned_items, status)
  values (v_user, v_today, p_exam, coalesce(v_prefs.preferred_session_minutes, 40), case when v_q > 0 then 20 else 0 end, v_items, 'ready')
  on conflict (user_id, plan_date) do update
    set planned_items = excluded.planned_items, exam_id = excluded.exam_id, target_questions = excluded.target_questions, updated_at = now()
  returning * into v_row;

  insert into public.study_coach_alerts (user_id, kind, title, body, payload)
  select v_user, 'daily_plan_ready', 'Bugünkü planın hazır',
    coalesce(v_prefs.preferred_session_minutes, 40)::text || ' dakikalık planın hazır.',
    jsonb_build_object('plan_id', v_row.id)
  where not exists (
    select 1 from public.study_coach_alerts a
    where a.user_id = v_user and a.kind = 'daily_plan_ready' and a.created_at >= timezone('Europe/Istanbul', v_today::timestamptz)
  );
  return v_row;
end;
$$;

create or replace function public.virtual_human_share()
returns numeric
language sql
stable
as $$
  select case
    when (
      select count(*) from public.profiles
      where last_active_at > now() - interval '1 hour'
        and coalesce(profile_type, 'human') = 'human'
    ) = 0 then 0
    else least(1, (
      select count(*)::numeric from public.virtual_student_presence
      where state <> 'offline' and updated_at > now() - interval '30 minutes'
    ) / greatest(1, (
      select count(*) from public.profiles
      where last_active_at > now() - interval '1 hour'
        and coalesce(profile_type, 'human') = 'human'
    )))
  end;
$$;

create or replace function public.virtual_recover_stale_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pres int := 0;
  v_jobs int := 0;
  v_threads int := 0;
begin
  update public.virtual_student_presence
  set state = 'offline', expected_end_at = null, updated_at = now()
  where state <> 'offline'
    and (
      (expected_end_at is not null and expected_end_at < now() - interval '2 minutes')
      or updated_at < now() - interval '2 hours'
    );
  get diagnostics v_pres = row_count;

  update public.virtual_student_activity_jobs
  set status = 'queued', error_text = 'stale running released', updated_at = now()
  where status = 'running'
    and updated_at < now() - interval '15 minutes'
    and attempt_count < 5;
  get diagnostics v_jobs = row_count;

  update public.virtual_student_activity_jobs
  set status = 'failed', error_text = coalesce(error_text, 'stale running abandoned'), updated_at = now()
  where status = 'running'
    and updated_at < now() - interval '15 minutes'
    and attempt_count >= 5;

  update public.exam_chat_room_state
  set unresolved_question = null,
      burst_left = 0,
      burst_bots = '{}',
      next_eligible_at = now(),
      updated_at = now()
  where coalesce(updated_at, '2000-01-01'::timestamptz) < now() - interval '4 hours'
     or (coalesce(unresolved_question, '') <> '' and coalesce(last_topic_shift_at, updated_at) < now() - interval '3 hours');
  get diagnostics v_threads = row_count;

  return jsonb_build_object('presence_reset', v_pres, 'jobs_requeued', v_jobs, 'threads_woken', v_threads);
end;
$$;

create or replace function public.virtual_student_engine_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
  v_enqueued int := 0;
  v_job uuid;
  v_ran jsonb;
  v_stories jsonb;
  v_recover jsonb;
begin
  v_recover := public.virtual_recover_stale_state();
  v_stories := public.cleanup_expired_stories();
  delete from public.virtual_student_memory where expires_at is not null and expires_at <= now();
  select virtual_students_enabled into v_on from public.virtual_student_engine_settings where id = 1;
  update public.virtual_student_engine_settings set last_tick_at = now(), updated_at = now() where id = 1;
  if v_on is not true then
    return jsonb_build_object('enabled', false, 'stories', v_stories, 'recover', v_recover);
  end if;
  begin
    v_enqueued := public.virtual_enqueue_jobs();
    select id into v_job
    from public.virtual_student_activity_jobs
    where status = 'queued' and scheduled_for <= now()
    order by scheduled_for
    limit 1;
    if v_job is not null then
      v_ran := public.virtual_run_job(v_job);
    end if;
    update public.virtual_student_engine_settings
    set last_success_at = now(), updated_at = now()
    where id = 1;
  exception when others then
    update public.virtual_student_engine_settings
    set last_failure_at = now(), updated_at = now()
    where id = 1;
    return jsonb_build_object('enabled', true, 'error', SQLERRM, 'recover', v_recover);
  end;
  return jsonb_build_object('enabled', true, 'enqueued', v_enqueued, 'ran', v_ran, 'stories', v_stories, 'recover', v_recover);
end;
$$;

create or replace function public.admin_virtual_students_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_last timestamptz;
  v_enabled boolean;
  v_profiles int;
  v_stall boolean := false;
  v_scheduler text := 'Error';
begin
  perform public.require_admin();
  select s.virtual_students_enabled, coalesce(s.last_success_at, s.last_tick_at)
    into v_enabled, v_last
  from public.virtual_student_engine_settings s where id = 1;
  select count(*)::int into v_profiles from public.virtual_student_profiles where is_enabled;

  if exists (select 1 from cron.job where jobname = 'kocum-virtual-tick' and active) then
    v_scheduler := 'Healthy';
  else
    v_scheduler := 'Stalled';
  end if;
  if v_enabled and v_profiles > 0 and (
    v_last is null or v_last < now() - make_interval(hours => coalesce((select stall_threshold_hours from public.virtual_student_engine_settings where id = 1), 6))
  ) then
    v_stall := true;
    if v_scheduler = 'Healthy' then v_scheduler := 'Stalled'; end if;
  end if;
  if exists (select 1 from public.virtual_student_engine_settings where id = 1 and last_failure_at is not null and last_failure_at > coalesce(last_success_at, '2000-01-01'::timestamptz)) then
    v_scheduler := 'Error';
  end if;

  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1),
    'enabled_profiles', v_profiles,
    'online', (select count(*)::int from public.virtual_student_presence where state <> 'offline' and updated_at > now() - interval '20 minutes'),
    'studying', (select count(*)::int from public.virtual_student_presence where state = 'studying' and updated_at > now() - interval '20 minutes'),
    'testing', (select count(*)::int from public.virtual_student_presence where state = 'testing' and updated_at > now() - interval '20 minutes'),
    'in_rooms', (select count(*)::int from public.virtual_student_presence where state = 'in_room' and updated_at > now() - interval '20 minutes'),
    'social', (select count(*)::int from public.virtual_student_presence where state = 'social' and updated_at > now() - interval '20 minutes'),
    'daily_xp', (
      select coalesce(sum(t.amount), 0)::int from public.xp_transactions t
      where public.is_virtual_profile(t.user_id)
        and (timezone('Europe/Istanbul', t.created_at))::date = v_today
    ),
    'jobs', (
      select jsonb_build_object(
        'queued', count(*) filter (where status = 'queued'),
        'running', count(*) filter (where status = 'running'),
        'failed', count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours'),
        'completed', count(*) filter (where status = 'completed' and created_at > now() - interval '24 hours')
      ) from public.virtual_student_activity_jobs
    ),
    'last_virtual_activity', (
      select max(completed_at) from public.virtual_student_activity_jobs where status = 'completed'
    ),
    'last_tick_at', (select last_tick_at from public.virtual_student_engine_settings where id = 1),
    'scheduler', v_scheduler,
    'stall', v_stall,
    'stall_message', case when v_stall then 'Sanal öğrenci motorunda ilerleme yok.' else null end,
    'conversation_errors', (
      select count(*)::int from public.virtual_student_activity_jobs
      where status = 'failed' and activity_type = 'group_chat' and created_at > now() - interval '24 hours'
    ),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.display_name)
      from (
        select
          pr.id, pr.display_name, pr.display_tag, pr.current_xp, v.is_enabled,
          v.activity_intensity, v.xp_multiplier, v.daily_xp_cap, e.name as exam_name,
          vp.state, v.current_subject_id, v.current_topic_id
        from public.virtual_student_profiles v
        join public.profiles pr on pr.id = v.profile_id
        left join public.exams e on e.id = v.exam_id
        left join public.virtual_student_presence vp on vp.profile_id = v.profile_id
        limit 40
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

do $$
declare
  v_id bigint;
begin
  for v_id in select jobid from cron.job where jobname in ('kocum-virtual-tick', 'kocum-story-cleanup', 'kocum-exam-chat-tick')
  loop
    perform cron.unschedule(v_id);
  end loop;
  perform cron.schedule('kocum-virtual-tick', '* * * * *', 'select public.virtual_student_engine_tick()');
  perform cron.schedule('kocum-story-cleanup', '10 * * * *', 'select public.cleanup_expired_stories()');
end $$;
