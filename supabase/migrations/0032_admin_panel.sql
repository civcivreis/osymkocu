-- Admin RPCs for system exams. Paste after 0031.

create or replace function public.admin_upsert_system_exam(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.require_admin();
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_status text := coalesce(p_payload->>'status', 'draft');
  v_start timestamptz := (p_payload->>'start_at')::timestamptz;
  v_duration int := coalesce((p_payload->>'duration_minutes')::int, 165);
  v_end timestamptz;
  v_type text := p_payload->>'exam_type';
begin
  if v_type not in ('tyt', 'ayt', 'kpss') then raise exception 'INVALID_INPUT'; end if;
  if v_duration < 10 or v_duration > 300 then raise exception 'INVALID_INPUT'; end if;
  if v_start is null then raise exception 'INVALID_INPUT'; end if;
  v_end := v_start + make_interval(mins => v_duration);
  if v_status not in ('draft', 'scheduled', 'cancelled') then
    v_status := 'draft';
  end if;
  if v_status = 'scheduled' and not public.istanbul_exam_slot_ok(v_start) then
    raise exception 'EXAM_HOUR';
  end if;
  if v_id is null then
    insert into public.system_exams (
      title, exam_type, description, start_at, end_at, duration_minutes, status, created_by, published_at
    ) values (
      left(trim(p_payload->>'title'), 120),
      v_type,
      nullif(trim(p_payload->>'description'), ''),
      v_start, v_end, v_duration, v_status, v_admin,
      case when v_status = 'scheduled' then now() else null end
    ) returning id into v_id;
    perform public.write_admin_audit('exam_create', 'system_exam', v_id::text, p_payload);
  else
    update public.system_exams
    set title = left(trim(p_payload->>'title'), 120),
        exam_type = v_type,
        description = nullif(trim(p_payload->>'description'), ''),
        start_at = v_start,
        end_at = v_end,
        duration_minutes = v_duration,
        status = case when status in ('live', 'finished') and v_status <> 'cancelled' then status else v_status end,
        published_at = case when v_status = 'scheduled' then coalesce(published_at, now()) else published_at end,
        updated_at = now()
    where id = v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform public.write_admin_audit('exam_update', 'system_exam', v_id::text, p_payload);
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_set_exam_questions(p_exam uuid, p_question_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
begin
  perform public.require_admin();
  if exists (select 1 from public.system_exam_attempts where system_exam_id = p_exam) then
    raise exception 'EXAM_LOCKED';
  end if;
  delete from public.system_exam_questions where system_exam_id = p_exam;
  if p_question_ids is not null then
    for i in 1 .. coalesce(array_length(p_question_ids, 1), 0) loop
      insert into public.system_exam_questions (system_exam_id, question_id, sort_order)
      values (p_exam, p_question_ids[i], i)
      on conflict do nothing;
    end loop;
  end if;
  update public.system_exams
  set question_count = (select count(*) from public.system_exam_questions where system_exam_id = p_exam),
      updated_at = now()
  where id = p_exam;
  perform public.write_admin_audit('exam_questions', 'system_exam', p_exam::text, jsonb_build_object('count', array_length(p_question_ids, 1)));
  return jsonb_build_object('count', (select count(*) from public.system_exam_questions where system_exam_id = p_exam));
end;
$$;

create or replace function public.admin_search_questions(p_exam_type text, p_search text default '', p_limit int default 40)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id,
      'stem', left(q.stem, 180),
      'subject', sub.name,
      'exam', e.slug,
      'difficulty', q.difficulty
    ))
    from (
      select q.id, q.stem, q.subject_id, q.exam_id, q.difficulty
      from public.questions q
      join public.exams e on e.id = q.exam_id
      where q.is_published = true
        and (
          p_exam_type is null
          or e.slug = p_exam_type
          or (p_exam_type = 'kpss' and e.slug like 'kpss%')
        )
        and (coalesce(p_search, '') = '' or q.stem ilike '%' || p_search || '%')
      order by q.created_at desc
      limit least(coalesce(p_limit, 40), 80)
    ) q
    join public.exams e on e.id = q.exam_id
    join public.subjects sub on sub.id = q.subject_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_today date := (timezone('Europe/Istanbul', now()))::date;
begin
  perform public.require_admin();
  return jsonb_build_object(
    'users', (select count(*)::int from public.profiles),
    'active_users', (
      select count(distinct user_id)::int from public.question_attempts
      where created_at > now() - interval '7 days'
    ),
    'questions_today', (
      select count(*)::int from public.question_attempts
      where (timezone('Europe/Istanbul', created_at))::date = v_today
    ),
    'open_rooms', (
      select count(*)::int from public.study_sessions
      where status in ('waiting', 'countdown', 'active')
    ),
    'pending_reports', (
      select count(*)::int from public.content_reports where status = 'open'
    ),
    'messages_today', (
      (select count(*)::int from public.dm_messages where (timezone('Europe/Istanbul', created_at))::date = v_today)
      + (select count(*)::int from public.exam_chat_messages where (timezone('Europe/Istanbul', created_at))::date = v_today)
    ),
    'upcoming_exam', (
      select jsonb_build_object('id', id, 'title', title, 'start_at', start_at)
      from public.system_exams
      where status not in ('draft', 'cancelled') and start_at > now()
      order by start_at
      limit 1
    )
  );
end;
$$;

create or replace function public.admin_list_users(p_search text default '', p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'display_tag', p.display_tag,
      'exam_name', e.name,
      'current_xp', p.current_xp,
      'app_role', p.app_role,
      'account_status', p.account_status,
      'created_at', p.created_at
    ) order by p.created_at desc)
    from (
      select * from public.profiles
      where coalesce(p_search, '') = ''
         or display_name ilike '%' || p_search || '%'
      order by created_at desc
      limit least(coalesce(p_limit, 50), 100)
    ) p
    left join public.exams e on e.id = p.exam_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text, p_hours int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if p_status not in ('active', 'warned', 'restricted', 'banned') then raise exception 'INVALID_INPUT'; end if;
  update public.profiles
  set account_status = p_status,
      restricted_until = case when p_status = 'restricted' then now() + make_interval(hours => greatest(coalesce(p_hours, 24), 1)) else null end
  where id = p_user;
  if p_status in ('warned', 'restricted', 'banned') then
    insert into public.notifications (user_id, kind, payload)
    values (p_user, 'account_warning', jsonb_build_object('status', p_status));
  end if;
  perform public.write_admin_audit('user_status', 'profile', p_user::text, jsonb_build_object('status', p_status, 'hours', p_hours));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_list_reports(p_status text default 'open')
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'content_type', r.content_type,
      'content_id', r.content_id,
      'reason', r.reason,
      'status', r.status,
      'created_at', r.created_at,
      'reporter', rp.display_name,
      'target', tp.display_name,
      'target_id', r.target_user_id
    ) order by r.created_at desc)
    from public.content_reports r
    join public.profiles rp on rp.id = r.reporter_user_id
    join public.profiles tp on tp.id = r.target_user_id
    where p_status is null or r.status = p_status
    limit 80
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_review_report(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.require_admin();
  v_report public.content_reports%rowtype;
begin
  select * into v_report from public.content_reports where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.content_reports
  set status = case p_action
        when 'dismiss' then 'dismissed'
        when 'warning' then 'warned'
        when 'restrict' then 'restricted'
        when 'ban' then 'banned'
        else 'open' end,
      reviewed_by = v_admin,
      reviewed_at = now()
  where id = p_id;
  if p_action in ('warning', 'restrict', 'ban') then
    perform public.admin_set_user_status(
      v_report.target_user_id,
      case p_action when 'warning' then 'warned' when 'restrict' then 'restricted' else 'banned' end,
      case when p_action = 'restrict' then 48 else null end
    );
  end if;
  perform public.write_admin_audit('report_review', 'content_report', p_id::text, jsonb_build_object('action', p_action));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_broadcast(p_body text, p_exam_type text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  perform public.require_admin();
  if length(trim(coalesce(p_body, ''))) < 3 then raise exception 'INVALID_INPUT'; end if;
  insert into public.notifications (user_id, kind, payload)
  select p.id, 'admin_broadcast', jsonb_build_object('body', left(trim(p_body), 280), 'exam_type', p_exam_type)
  from public.profiles p
  left join public.exams e on e.id = p.exam_id
  where p.account_status <> 'banned'
    and (
      p_exam_type is null
      or e.slug = p_exam_type
      or (p_exam_type = 'kpss' and e.slug like 'kpss%')
    );
  get diagnostics v_n = row_count;
  perform public.write_admin_audit('broadcast', 'notification', null, jsonb_build_object('count', v_n, 'exam_type', p_exam_type));
  return jsonb_build_object('sent', v_n);
end;
$$;

create or replace function public.admin_list_exams()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'exam_type', e.exam_type,
      'description', e.description,
      'start_at', e.start_at,
      'end_at', e.end_at,
      'duration_minutes', e.duration_minutes,
      'question_count', e.question_count,
      'status', public.system_exam_derived_status(e),
      'stored_status', e.status,
      'created_at', e.created_at
    ) order by e.start_at desc)
    from public.system_exams e
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.is_admin() to authenticated;
revoke all on function public.bootstrap_admin() from public, anon, authenticated;
grant execute on function public.list_system_exams(text) to authenticated;
grant execute on function public.toggle_system_exam_signup(uuid) to authenticated;
grant execute on function public.set_system_exam_reminders(boolean) to authenticated;
grant execute on function public.sync_my_exam_reminders() to authenticated;
grant execute on function public.start_system_exam(uuid, text) to authenticated;
grant execute on function public.get_system_exam_play(uuid, text) to authenticated;
grant execute on function public.save_system_exam_answer(uuid, uuid, text, boolean, int, text) to authenticated;
grant execute on function public.log_system_exam_event(uuid, text, jsonb) to authenticated;
grant execute on function public.submit_system_exam(uuid) to authenticated;
grant execute on function public.get_system_exam_result(uuid) to authenticated;
grant execute on function public.system_exam_leaderboard(uuid) to authenticated;
grant execute on function public.system_exam_profile_stats(uuid) to authenticated;
grant execute on function public.admin_upsert_system_exam(jsonb) to authenticated;
grant execute on function public.admin_set_exam_questions(uuid, uuid[]) to authenticated;
grant execute on function public.admin_search_questions(text, text, int) to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_list_users(text, int) to authenticated;
grant execute on function public.admin_set_user_status(uuid, text, int) to authenticated;
grant execute on function public.admin_list_reports(text) to authenticated;
grant execute on function public.admin_review_report(uuid, text) to authenticated;
grant execute on function public.admin_broadcast(text, text) to authenticated;
grant execute on function public.admin_list_exams() to authenticated;
