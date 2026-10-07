-- Open ders/test rooms + same-question lobbies with chat.
-- Run after 0010.

alter table public.study_sessions drop constraint if exists study_sessions_mode_check;
alter table public.study_sessions
  add constraint study_sessions_mode_check check (mode in ('study', 'race', 'exam', 'test'));

create or replace function public.create_open_room(p_subject_id uuid, p_kind text, p_capacity int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_session uuid;
  v_subject text;
  v_cap int := p_capacity;
  v_kind text := p_kind;
  v_label text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if v_kind not in ('study', 'test', 'exam') then raise exception 'INVALID_MODE'; end if;
  if v_kind = 'exam' and v_cap not in (5, 10) then raise exception 'INVALID_CAPACITY'; end if;
  if v_kind in ('study', 'test') and v_cap not in (2, 5, 10) then raise exception 'INVALID_CAPACITY'; end if;
  if not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;

  select array_agg(id) into v_ids
  from (
    select id from public.questions
    where subject_id = p_subject_id and is_published = true
    order by random()
    limit 10
  ) q;
  if v_ids is null or coalesce(array_length(v_ids, 1), 0) < 1 then
    raise exception 'NO_QUESTIONS';
  end if;

  insert into public.study_sessions (subject_id, question_ids, status, mode, host_id, capacity)
  values (p_subject_id, v_ids, 'waiting', v_kind, v_user, v_cap)
  returning id into v_session;

  insert into public.study_session_members (session_id, user_id) values (v_session, v_user);

  select name into v_subject from public.subjects where id = p_subject_id;
  v_label := case v_kind
    when 'study' then 'ders odası'
    when 'test' then 'test odası'
    else 'sınav'
  end;

  insert into public.social_posts (user_id, body, kind, subject_id, session_id, capacity)
  values (
    v_user,
    format('%s · %s kişilik %s', coalesce(v_subject, 'Ders'), v_cap, v_label),
    'exam_lobby',
    p_subject_id,
    v_session,
    v_cap
  );

  return v_session;
end;
$$;

create or replace function public.join_exam_lobby(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session public.study_sessions%rowtype;
  v_count int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_session from public.study_sessions where id = p_session_id;
  if not found or v_session.mode not in ('exam', 'study', 'test') then
    raise exception 'NOT_FOUND';
  end if;
  if v_session.status <> 'waiting' then
    raise exception 'ALREADY_STARTED';
  end if;
  select count(*) into v_count from public.study_session_members where session_id = p_session_id;
  if v_count >= v_session.capacity then
    raise exception 'FULL';
  end if;

  insert into public.study_session_members (session_id, user_id)
  values (p_session_id, v_user)
  on conflict do nothing;

  select count(*) into v_count from public.study_session_members where session_id = p_session_id;
  if v_count >= v_session.capacity then
    update public.study_sessions
    set status = 'countdown', starts_at = now() + interval '10 seconds'
    where id = p_session_id and status = 'waiting';
    insert into public.notifications (user_id, kind, payload)
    select m.user_id, 'exam_started', jsonb_build_object('session_id', p_session_id)
    from public.study_session_members m
    where m.session_id = p_session_id;
  end if;

  return public.get_study_room(p_session_id);
end;
$$;

create or replace function public.list_open_rooms()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x))
    from (
      select
        s.id,
        s.mode,
        s.status,
        s.capacity,
        s.host_id,
        s.subject_id,
        sub.name as subject_name,
        (select count(*) from public.study_session_members m where m.session_id = s.id)::int as member_count
      from public.study_sessions s
      left join public.subjects sub on sub.id = s.subject_id
      where s.mode in ('exam', 'race', 'study', 'test')
        and s.status in ('waiting', 'countdown')
      order by s.created_at desc
      limit 40
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.my_exam_banner()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row jsonb;
begin
  if v_user is null then
    return null;
  end if;
  select jsonb_build_object(
    'session_id', s.id,
    'status', s.status,
    'mode', s.mode,
    'host_id', s.host_id,
    'capacity', s.capacity,
    'member_count', (select count(*) from public.study_session_members m where m.session_id = s.id),
    'subject_name', sub.name,
    'starts_at', s.starts_at
  )
  into v_row
  from public.study_sessions s
  join public.study_session_members mem on mem.session_id = s.id and mem.user_id = v_user
  join public.subjects sub on sub.id = s.subject_id
  where s.mode in ('exam', 'study', 'test')
    and s.status in ('waiting', 'countdown')
  order by s.created_at desc
  limit 1;
  return v_row;
end;
$$;

create or replace function public.get_study_room(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session public.study_sessions%rowtype;
  v_qid uuid;
  v_question jsonb;
  v_answers jsonb;
  v_members jsonb;
  v_scores jsonb;
  v_subject text;
  v_show boolean;
  v_count int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = v_user
  ) then
    raise exception 'UNAUTHORIZED';
  end if;

  perform public.maybe_activate_session(p_session_id);
  select * into v_session from public.study_sessions where id = p_session_id;
  v_qid := v_session.question_ids[v_session.current_index + 1];
  select name into v_subject from public.subjects where id = v_session.subject_id;
  v_show := v_session.status = 'reveal' or (v_session.status = 'ended' and v_session.mode in ('study', 'test'));

  select count(*) into v_count from public.study_session_members where session_id = p_session_id;

  select jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'display_name', p.display_name
  )) into v_members
  from public.study_session_members m
  join public.profiles p on p.id = m.user_id
  where m.session_id = p_session_id;

  if v_qid is not null and v_session.status not in ('ended', 'waiting', 'countdown') then
    select jsonb_build_object(
      'id', q.id,
      'stem', q.stem,
      'choices', q.choices,
      'difficulty', q.difficulty,
      'correct_choice', case when v_show then q.correct_choice else null end,
      'explanation', case when v_show then q.explanation else null end
    ) into v_question
    from public.questions q
    where q.id = v_qid;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', a.user_id,
    'selected_choice', a.selected_choice,
    'is_correct', case when v_show or v_session.status = 'ended' then a.is_correct else null end
  )), '[]'::jsonb) into v_answers
  from public.study_session_answers a
  where a.session_id = p_session_id and a.question_id = v_qid;

  if v_session.status = 'ended' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'display_name', p.display_name,
      'correct', (
        select count(*)::int from public.study_session_answers a
        where a.session_id = p_session_id and a.user_id = m.user_id and a.is_correct
      )
    )), '[]'::jsonb) into v_scores
    from public.study_session_members m
    join public.profiles p on p.id = m.user_id
    where m.session_id = p_session_id;
  end if;

  return jsonb_build_object(
    'id', v_session.id,
    'subject_id', v_session.subject_id,
    'subject_name', v_subject,
    'status', v_session.status,
    'mode', v_session.mode,
    'host_id', v_session.host_id,
    'capacity', v_session.capacity,
    'member_count', v_count,
    'starts_at', v_session.starts_at,
    'question_deadline', v_session.question_deadline,
    'current_index', v_session.current_index,
    'total', coalesce(array_length(v_session.question_ids, 1), 0),
    'question', v_question,
    'answers', v_answers,
    'members', coalesce(v_members, '[]'::jsonb),
    'scores', coalesce(v_scores, '[]'::jsonb)
  );
end;
$$;

create or replace function public.submit_room_answer(p_session_id uuid, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session public.study_sessions%rowtype;
  v_qid uuid;
  v_correct text;
  v_ok boolean;
  v_count int;
  v_members int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  perform public.maybe_activate_session(p_session_id);
  select * into v_session from public.study_sessions where id = p_session_id;
  if not found or v_session.status not in ('active', 'reveal') then
    raise exception 'NOT_ACTIVE';
  end if;
  if not exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = v_user
  ) then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_session.status = 'reveal' then
    return public.get_study_room(p_session_id);
  end if;
  if v_session.mode = 'exam' and v_session.question_deadline is not null and v_session.question_deadline < now() then
    perform public.advance_competitive(p_session_id);
    return public.get_study_room(p_session_id);
  end if;

  v_qid := v_session.question_ids[v_session.current_index + 1];
  select correct_choice into v_correct from public.questions where id = v_qid;
  v_ok := upper(p_choice) = upper(coalesce(v_correct, ''));

  insert into public.study_session_answers (session_id, question_id, user_id, selected_choice, is_correct)
  values (p_session_id, v_qid, v_user, upper(p_choice), v_ok)
  on conflict (session_id, question_id, user_id) do nothing;

  if v_session.mode in ('study', 'test') then
    begin
      perform public.submit_question_attempt(v_qid, upper(p_choice), 0, 'practice');
    exception when others then
      null;
    end;
  end if;

  select count(*) into v_count
  from public.study_session_answers
  where session_id = p_session_id and question_id = v_qid;
  select count(*) into v_members from public.study_session_members where session_id = p_session_id;

  if v_session.mode in ('study', 'test') and v_count >= v_members then
    update public.study_sessions set status = 'reveal' where id = p_session_id;
  elsif v_session.mode in ('race', 'exam') then
    perform public.advance_competitive(p_session_id);
  end if;

  return public.get_study_room(p_session_id);
end;
$$;

revoke all on function public.create_open_room(uuid, text, int) from public;
grant execute on function public.create_open_room(uuid, text, int) to authenticated;
grant execute on function public.join_exam_lobby(uuid) to authenticated;
grant execute on function public.list_open_rooms() to authenticated;
grant execute on function public.my_exam_banner() to authenticated;
grant execute on function public.get_study_room(uuid) to authenticated;
grant execute on function public.submit_room_answer(uuid, text) to authenticated;

notify pgrst, 'reload schema';
