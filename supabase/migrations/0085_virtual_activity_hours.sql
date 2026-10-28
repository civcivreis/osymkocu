-- Spread virtual active hours across morning/day/evening/late. One presence source.

create or replace function public.virtual_stable_hours(p_profile uuid)
returns table(band text, hours_start time, hours_end time)
language sql
immutable
as $$
  select s.band, s.hours_start, s.hours_end
  from (
    values
      (0, 'morning'::text, '08:00'::time, '13:00'::time),
      (1, 'day'::text, '11:00'::time, '18:00'::time),
      (2, 'evening'::text, '17:00'::time, '00:00'::time),
      (3, 'late'::text, '20:00'::time, '02:00'::time)
  ) s(idx, band, hours_start, hours_end)
  where s.idx = mod(abs(hashtext(p_profile::text)), 4);
$$;

create or replace function public.virtual_profile_is_active(p_profile uuid)
returns boolean
language plpgsql
stable
as $$
declare
  v_prof public.virtual_student_profiles%rowtype;
  v_now time;
begin
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  if not found or not v_prof.is_enabled then return false; end if;
  v_now := timezone(coalesce(nullif(v_prof.timezone, ''), 'Europe/Istanbul'), now())::time;
  if v_prof.active_hours_start is null or v_prof.active_hours_end is null then return false; end if;
  if v_prof.active_hours_start <= v_prof.active_hours_end then
    return v_now >= v_prof.active_hours_start and v_now <= v_prof.active_hours_end;
  end if;
  return v_now >= v_prof.active_hours_start or v_now <= v_prof.active_hours_end;
end;
$$;

create or replace function public.virtual_social_day_cap(p_level text)
returns int
language sql
immutable
as $$
  select case coalesce(p_level, 'medium')
    when 'low' then 1
    when 'high' then 2
    else 2
  end;
$$;

create or replace function public.virtual_social_posts_today(p_profile uuid)
returns int
language sql
stable
as $$
  select count(*)::int
  from public.social_posts
  where user_id = p_profile
    and (timezone('Europe/Istanbul', created_at))::date = (timezone('Europe/Istanbul', now()))::date;
$$;

update public.virtual_student_profiles v
set timezone = coalesce(nullif(v.timezone, ''), 'Europe/Istanbul'),
    active_hours_start = (select hours_start from public.virtual_stable_hours(v.profile_id)),
    active_hours_end = (select hours_end from public.virtual_stable_hours(v.profile_id))
where v.is_enabled;

create or replace function public.virtual_hours_on_insert()
returns trigger
language plpgsql
as $$
declare
  h record;
begin
  select * into h from public.virtual_stable_hours(new.profile_id);
  new.active_hours_start := h.hours_start;
  new.active_hours_end := h.hours_end;
  new.timezone := coalesce(nullif(new.timezone, ''), 'Europe/Istanbul');
  return new;
end;
$$;

drop trigger if exists trg_virtual_hours_on_insert on public.virtual_student_profiles;
create trigger trg_virtual_hours_on_insert
before insert on public.virtual_student_profiles
for each row execute function public.virtual_hours_on_insert();

create or replace function public.virtual_enqueue_jobs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings;
  v_n int := 0;
  rec record;
  v_types text[];
  v_type text;
  v_delay int;
  v_cap int;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if not v_cfg.virtual_students_enabled then return 0; end if;
  if public.virtual_human_share() > coalesce(v_cfg.target_virtual_share, 0.35) then
    return 0;
  end if;

  for rec in
    select v.* from public.virtual_student_profiles v
    where v.is_enabled
  loop
    if not public.virtual_profile_is_active(rec.profile_id) then
      perform public.set_virtual_presence(rec.profile_id, 'offline');
      continue;
    end if;

    if exists (
      select 1 from public.virtual_student_activity_jobs j
      where j.profile_id = rec.profile_id and j.status in ('queued', 'running')
    ) then
      continue;
    end if;

    if rec.social_activity_level = 'low' then
      v_types := array['study_lesson', 'solve_test', 'group_chat', 'social_like'];
    elsif rec.social_activity_level = 'high' then
      v_types := array['study_lesson', 'solve_test', 'social_post', 'group_chat', 'join_room', 'social_comment', 'room_chat'];
    else
      v_types := array['study_lesson', 'solve_test', 'group_chat', 'social_post', 'join_room'];
    end if;
    v_type := v_types[1 + floor(random() * array_length(v_types, 1))::int];
    if v_type in ('social_post', 'update_status') then
      v_cap := public.virtual_social_day_cap(rec.social_activity_level);
      if public.virtual_social_posts_today(rec.profile_id) >= v_cap then
        v_type := 'group_chat';
      end if;
    end if;
    v_delay := 20 + floor(random() * 240)::int;

    insert into public.virtual_student_activity_jobs (profile_id, activity_type, scheduled_for, context)
    values (
      rec.profile_id, v_type, now() + make_interval(secs => v_delay),
      jsonb_build_object('exam_id', rec.exam_id)
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.virtual_social_eligibility(p_profile uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_prof public.virtual_student_profiles%rowtype;
  v_cap int;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if not found or not v_cfg.virtual_students_enabled then return 'GLOBAL_DISABLED'; end if;
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  if not found or not v_prof.is_enabled then return 'PROFILE_DISABLED'; end if;
  if not public.virtual_profile_is_active(p_profile) then return 'OUTSIDE_ACTIVE_HOURS'; end if;
  v_cap := public.virtual_social_day_cap(v_prof.social_activity_level);
  if public.virtual_social_posts_today(p_profile) >= v_cap then return 'DAILY_SOCIAL_CAP'; end if;
  if exists (
    select 1 from public.social_posts
    where user_id = p_profile and created_at > now() - interval '90 minutes'
  ) then
    return 'SOCIAL_RATE_LIMIT';
  end if;
  return 'ELIGIBLE';
end;
$$;

create or replace function public.virtual_try_social_post(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.virtual_student_profiles%rowtype;
  v_topic text;
  v_n int;
  v_ok int;
  v_body text;
  v_post uuid;
  v_mod text;
  v_why text;
begin
  v_why := public.virtual_social_eligibility(p_profile);
  if v_why <> 'ELIGIBLE' then
    return jsonb_build_object('ok', false, 'reason', v_why);
  end if;
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  perform public.set_virtual_presence(p_profile, 'social', v_prof.current_subject_id, v_prof.current_topic_id, null, 8);

  select value->>'topic', (value->>'wrong')::int, (value->>'correct')::int
  into v_topic, v_n, v_ok
  from public.virtual_student_memory
  where profile_id = p_profile and memory_type = 'recent_test'
  order by updated_at desc limit 1;

  if v_topic is not null and v_n is not null then
    v_body := coalesce(v_topic, 'Konu') || 'de ' || coalesce(v_ok, 0)::text || ' doğru ' || coalesce(v_n, 0)::text || ' yanlış çıktı.';
  else
    select t.name into v_topic from public.topics t where t.id = v_prof.current_topic_id;
    v_body := case floor(random() * 3)::int
      when 0 then coalesce(v_topic, 'Derse') || ' tekrarındayım.'
      when 1 then 'Bugünkü hedef ' || coalesce(v_prof.daily_goal_questions, 30)::text || ' soru, devam.'
      else coalesce(v_topic, 'Konu') || 'ni bitirip sonrakine geçiyorum.'
    end;
  end if;

  v_mod := public.content_moderation_level(v_body);
  if v_mod = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED', 'body', v_body);
  end if;
  if exists (
    select 1 from public.social_posts sp
    where sp.user_id = p_profile and sp.body = v_body
      and sp.created_at > now() - interval '12 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE_REJECTED', 'body', v_body);
  end if;

  insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at, topic_id)
  values (p_profile, v_body, 'status', v_prof.current_subject_id, 60, now() + interval '18 hours', v_prof.current_topic_id)
  returning id into v_post;
  perform public.remember_virtual_fact(
    p_profile, 'recent_post', 'last', jsonb_build_object('body', v_body, 'post_id', v_post), interval '48 hours'
  );
  return jsonb_build_object('ok', true, 'post_id', v_post, 'body', v_body, 'reason', 'INSERTED');
end;
$$;

create or replace function public.exam_chat_pick_bots(p_slug text, p_n int)
returns uuid[]
language plpgsql
as $$
declare
  v uuid[];
  n int := greatest(2, least(5, p_n));
begin
  select coalesce(array_agg(id), '{}') into v
  from (
    select distinct on (public.exam_chat_voice(pr.id)) pr.id
    from public.virtual_student_profiles vp
    join public.profiles pr on pr.id = vp.profile_id
    where vp.is_enabled
      and public.virtual_profile_is_active(vp.profile_id)
    order by public.exam_chat_voice(pr.id), random()
    limit n
  ) s;
  if coalesce(array_length(v, 1), 0) < 2 then
    select coalesce(array_agg(id), v) into v
    from (
      select pr.id from public.virtual_student_profiles vp
      join public.profiles pr on pr.id = vp.profile_id
      where vp.is_enabled
        and public.virtual_profile_is_active(vp.profile_id)
      order by random()
      limit n
    ) t;
  end if;
  return coalesce(v, '{}');
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
  v_eligible int := 0;
  v_stall boolean := false;
  v_scheduler text := 'Error';
  v_target int := 6;
  v_rooms int := 0;
  v_last_group timestamptz;
  v_last_room timestamptz;
  v_last_test timestamptz;
  v_last_social timestamptz;
  v_last_lesson timestamptz;
  v_msg text;
begin
  perform public.require_admin();
  select s.virtual_students_enabled, coalesce(s.last_success_at, s.last_tick_at), coalesce(s.target_virtual_rooms, s.target_active_rooms, 6)
    into v_enabled, v_last, v_target
  from public.virtual_student_engine_settings s where id = 1;
  select count(*)::int into v_profiles from public.virtual_student_profiles where is_enabled;
  select count(*)::int into v_eligible
  from public.virtual_student_profiles v
  where v.is_enabled and public.virtual_profile_is_active(v.profile_id);

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

  select count(*)::int into v_rooms
  from public.study_sessions
  where status in ('waiting', 'countdown', 'active')
    and public.is_virtual_profile(host_id);

  select max(created_at) into v_last_group from public.exam_chat_messages where public.is_virtual_profile(sender_id);
  select max(created_at) into v_last_room from public.study_session_messages where public.is_virtual_profile(sender_id);
  select max(completed_at) into v_last_test from public.virtual_student_activity_jobs where status = 'completed' and activity_type = 'solve_test';
  select max(completed_at) into v_last_social from public.virtual_student_activity_jobs where status = 'completed' and activity_type in ('social_post', 'social_comment', 'social_like', 'update_status');
  select max(completed_at) into v_last_lesson from public.virtual_student_activity_jobs where status = 'completed' and activity_type = 'study_lesson';

  v_msg := null;
  if v_last_group is null or v_last_group < now() - interval '8 hours' then
    v_msg := 'Grup sohbeti üretimi ' || greatest(1, floor(extract(epoch from (now() - coalesce(v_last_group, now() - interval '8 days'))) / 3600)::int)::text || ' saattir mesaj yazmadı.';
  elsif v_last_room is null or v_last_room < now() - interval '8 hours' then
    v_msg := 'Oda aktivitesi 8 saattir sessiz.';
  end if;

  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1),
    'enabled_profiles', v_profiles,
    'eligible_now', v_eligible,
    'online', (select count(*)::int from public.virtual_student_presence where state <> 'offline' and updated_at > now() - interval '20 minutes'),
    'studying', (select count(*)::int from public.virtual_student_presence where state = 'studying' and updated_at > now() - interval '20 minutes'),
    'testing', (select count(*)::int from public.virtual_student_presence where state = 'testing' and updated_at > now() - interval '20 minutes'),
    'in_rooms', (select count(*)::int from public.virtual_student_presence where state = 'in_room' and updated_at > now() - interval '20 minutes'),
    'social', (select count(*)::int from public.virtual_student_presence where state = 'social' and updated_at > now() - interval '20 minutes'),
    'rooms', v_rooms,
    'rooms_target', v_target,
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
    'surfaces', jsonb_build_object(
      'lesson', v_last_lesson,
      'test', v_last_test,
      'room', v_last_room,
      'social', v_last_social,
      'group_chat', v_last_group
    ),
    'scheduler', v_scheduler,
    'stall', v_stall or v_msg is not null,
    'stall_message', coalesce(v_msg, case when v_stall then 'Sanal öğrenci motorunda ilerleme yok.' else null end),
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
          vp.state, v.current_subject_id, v.current_topic_id,
          v.active_hours_start, v.active_hours_end, public.virtual_profile_is_active(v.profile_id) as eligible_now
        from public.virtual_student_profiles v
        join public.profiles pr on pr.id = v.profile_id
        left join public.exams e on e.id = v.exam_id
        left join public.virtual_student_presence vp on vp.profile_id = v.profile_id
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.virtual_profile_is_active(uuid) to authenticated;
grant execute on function public.virtual_stable_hours(uuid) to authenticated;
grant execute on function public.admin_virtual_students_overview() to authenticated;
