-- Room title, password, privacy, chat toggle.
-- Run after 0013.

alter table public.study_sessions
  add column if not exists title text,
  add column if not exists join_password text,
  add column if not exists is_private boolean not null default false,
  add column if not exists chat_enabled boolean not null default true;

drop function if exists public.create_open_room(uuid, text, int);

create function public.create_open_room(
  p_subject_id uuid,
  p_kind text,
  p_capacity int,
  p_title text default null,
  p_password text default null,
  p_is_private boolean default false,
  p_chat_enabled boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[];
  v_session uuid;
  v_subject text;
  v_cap int := p_capacity;
  v_kind text := p_kind;
  v_label text;
  v_title text := nullif(left(trim(coalesce(p_title, '')), 48), '');
  v_pass text := nullif(trim(coalesce(p_password, '')), '');
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

  insert into public.study_sessions (
    subject_id, question_ids, status, mode, host_id, capacity,
    title, join_password, is_private, chat_enabled
  )
  values (
    p_subject_id, v_ids, 'waiting', v_kind, v_user, v_cap,
    v_title,
    case when v_pass is null then null else crypt(v_pass, gen_salt('bf')) end,
    coalesce(p_is_private, false),
    coalesce(p_chat_enabled, true)
  )
  returning id into v_session;

  insert into public.study_session_members (session_id, user_id) values (v_session, v_user);

  select name into v_subject from public.subjects where id = p_subject_id;
  v_label := case v_kind
    when 'study' then 'ders odası'
    when 'test' then 'test odası'
    else 'sınav'
  end;

  if not coalesce(p_is_private, false) and v_pass is null then
    insert into public.social_posts (user_id, body, kind, subject_id, session_id, capacity)
    values (
      v_user,
      coalesce(v_title, format('%s · %s kişilik %s', coalesce(v_subject, 'Ders'), v_cap, v_label)),
      'exam_lobby',
      p_subject_id,
      v_session,
      v_cap
    );
  end if;

  return v_session;
end;
$$;

drop function if exists public.join_exam_lobby(uuid);

create function public.join_exam_lobby(p_session_id uuid, p_password text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_session public.study_sessions%rowtype;
  v_count int;
  v_pass text := nullif(trim(coalesce(p_password, '')), '');
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_session from public.study_sessions where id = p_session_id;
  if not found or v_session.mode not in ('exam', 'study', 'test') then
    raise exception 'NOT_FOUND';
  end if;
  if exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = v_user
  ) then
    return public.get_study_room(p_session_id);
  end if;
  if v_session.status <> 'waiting' then
    raise exception 'ALREADY_STARTED';
  end if;
  if v_session.join_password is not null then
    if v_pass is null or v_session.join_password <> crypt(v_pass, v_session.join_password) then
      raise exception 'BAD_PASSWORD';
    end if;
  elsif coalesce(v_session.is_private, false) then
    raise exception 'PRIVATE_ROOM';
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
        s.title,
        s.is_private,
        (s.join_password is not null) as has_password,
        s.chat_enabled,
        (select count(*) from public.study_session_members m where m.session_id = s.id)::int as member_count
      from public.study_sessions s
      left join public.subjects sub on sub.id = s.subject_id
      where s.mode in ('exam', 'race', 'study', 'test')
        and s.status in ('waiting', 'countdown')
        and (
          coalesce(s.is_private, false) = false
          or s.host_id = auth.uid()
          or exists (
            select 1 from public.study_session_members m
            where m.session_id = s.id and m.user_id = auth.uid()
          )
          or s.join_password is not null
        )
      order by s.created_at desc
      limit 40
    ) x
  ), '[]'::jsonb);
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
    'title', v_session.title,
    'status', v_session.status,
    'mode', v_session.mode,
    'host_id', v_session.host_id,
    'capacity', v_session.capacity,
    'member_count', v_count,
    'chat_enabled', coalesce(v_session.chat_enabled, true),
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

revoke all on function public.create_open_room(uuid, text, int, text, text, boolean, boolean) from public;
revoke all on function public.join_exam_lobby(uuid, text) from public;
grant execute on function public.create_open_room(uuid, text, int, text, text, boolean, boolean) to authenticated;
grant execute on function public.join_exam_lobby(uuid, text) to authenticated;
grant execute on function public.list_open_rooms() to authenticated;
grant execute on function public.get_study_room(uuid) to authenticated;
