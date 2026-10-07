-- Race mode, exam lobbies (5/10), answer wait states, rank XP.
-- Run contents in SQL Editor. Do not paste the file path.

alter table public.study_invites
  add column if not exists kind text not null default 'study';

alter table public.study_invites drop constraint if exists study_invites_kind_check;
alter table public.study_invites
  add constraint study_invites_kind_check check (kind in ('study', 'race'));

alter table public.study_sessions
  add column if not exists mode text not null default 'study',
  add column if not exists host_id uuid references public.profiles(id) on delete set null,
  add column if not exists capacity int not null default 2,
  add column if not exists question_deadline timestamptz,
  add column if not exists xp_awarded_at timestamptz;

alter table public.study_sessions drop constraint if exists study_sessions_mode_check;
alter table public.study_sessions
  add constraint study_sessions_mode_check check (mode in ('study', 'race', 'exam'));

alter table public.study_sessions drop constraint if exists study_sessions_status_check;
alter table public.study_sessions
  add constraint study_sessions_status_check
  check (status in ('waiting', 'countdown', 'active', 'reveal', 'ended'));

alter table public.social_posts
  add column if not exists session_id uuid references public.study_sessions(id) on delete set null,
  add column if not exists capacity int;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'study_invite', 'study_accepted', 'study_ended', 'study_offer',
    'race_invite', 'race_accepted', 'exam_lobby', 'exam_started'
  ));

create or replace function public.award_session_xp(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.study_sessions%rowtype;
  v_n int;
  r record;
begin
  select * into v_session from public.study_sessions where id = p_session;
  if not found or v_session.xp_awarded_at is not null then
    return;
  end if;
  if v_session.mode not in ('race', 'exam') then
    return;
  end if;

  select count(*) into v_n from public.study_session_members where session_id = p_session;
  if v_n < 1 then
    return;
  end if;

  for r in
    with scores as (
      select m.user_id,
        coalesce(sum(case when a.is_correct then 1 else 0 end), 0)::int as correct
      from public.study_session_members m
      left join public.study_session_answers a
        on a.session_id = m.session_id and a.user_id = m.user_id
      where m.session_id = p_session
      group by m.user_id
    ),
    ranked as (
      select user_id, correct, rank() over (order by correct desc) as rk
      from scores
    )
    select user_id, correct, rk, greatest(2, (v_n - rk + 1) * 2) as xp from ranked
  loop
    insert into public.xp_transactions (user_id, amount, reason, metadata)
    values (r.user_id, r.xp, 'session', jsonb_build_object('session_id', p_session, 'correct', r.correct, 'rank', r.rk));
    update public.profiles set current_xp = current_xp + r.xp where id = r.user_id;
  end loop;

  update public.study_sessions set xp_awarded_at = now() where id = p_session;
end;
$$;

create or replace function public.begin_session_play(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.study_sessions%rowtype;
begin
  select * into v_session from public.study_sessions where id = p_session;
  if not found then
    return;
  end if;
  update public.study_sessions
  set status = 'active',
      current_index = 0,
      question_deadline = case when mode = 'exam' then now() + interval '15 seconds' else null end
  where id = p_session
    and status = 'countdown'
    and starts_at is not null
    and starts_at <= now();
end;
$$;

create or replace function public.advance_competitive(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.study_sessions%rowtype;
  v_qid uuid;
  v_members int;
  v_answers int;
  v_next int;
begin
  select * into v_session from public.study_sessions where id = p_session for update;
  if not found or v_session.status <> 'active' or v_session.mode not in ('race', 'exam') then
    return;
  end if;

  v_qid := v_session.question_ids[v_session.current_index + 1];
  select count(*) into v_members from public.study_session_members where session_id = p_session;
  select count(*) into v_answers
  from public.study_session_answers
  where session_id = p_session and question_id = v_qid;

  if v_answers < v_members
     and (v_session.question_deadline is null or v_session.question_deadline > now()) then
    return;
  end if;

  v_next := v_session.current_index + 1;
  if v_next >= coalesce(array_length(v_session.question_ids, 1), 0) then
    update public.study_sessions
    set status = 'ended', ended_at = now(), question_deadline = null
    where id = p_session;
    perform public.award_session_xp(p_session);
  else
    update public.study_sessions
    set current_index = v_next,
        question_deadline = case when mode = 'exam' then now() + interval '15 seconds' else null end
    where id = p_session;
  end if;
end;
$$;

create or replace function public.maybe_activate_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.study_sessions%rowtype;
begin
  select * into v_session from public.study_sessions where id = p_session;
  if not found then
    return;
  end if;
  if v_session.status = 'countdown' then
    perform public.begin_session_play(p_session);
  elsif v_session.status = 'active' and v_session.mode in ('race', 'exam') then
    perform public.advance_competitive(p_session);
  end if;
end;
$$;

create or replace function public.request_race(p_other uuid, p_subject_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_subject text;
  v_id uuid;
begin
  if v_user is null or p_other is null or v_user = p_other then
    raise exception 'INVALID_STUDY';
  end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_user and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = v_user)
  ) then
    raise exception 'BLOCKED';
  end if;
  if not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;

  update public.study_invites
  set status = 'expired'
  where status = 'pending' and expires_at < now()
    and ((from_user = v_user and to_user = p_other) or (from_user = p_other and to_user = v_user));

  if exists (
    select 1 from public.study_invites
    where status = 'pending'
      and ((from_user = v_user and to_user = p_other) or (from_user = p_other and to_user = v_user))
  ) then
    raise exception 'PENDING_EXISTS';
  end if;

  insert into public.study_invites (from_user, to_user, subject_id, kind)
  values (v_user, p_other, p_subject_id, 'race')
  returning id into v_id;

  select display_name into v_name from public.profiles where id = v_user;
  select name into v_subject from public.subjects where id = p_subject_id;
  perform public.notify_user(p_other, 'race_invite', jsonb_build_object(
    'invite_id', v_id,
    'from_user', v_user,
    'from_name', coalesce(v_name, 'Öğrenci'),
    'subject_id', p_subject_id,
    'subject_name', coalesce(v_subject, 'Ders')
  ));
  return v_id;
end;
$$;

create or replace function public.respond_study(p_invite_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.study_invites%rowtype;
  v_session uuid;
  v_ids uuid[];
  v_from_name text;
  v_to_name text;
  v_subject text;
  v_mode text;
  v_kind text;
  v_delay interval;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  select * into v_invite from public.study_invites where id = p_invite_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_invite.to_user <> v_user then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_invite.status <> 'pending' or v_invite.expires_at < now() then
    update public.study_invites set status = 'expired' where id = p_invite_id and status = 'pending';
    raise exception 'EXPIRED';
  end if;
  if not p_accept then
    update public.study_invites set status = 'declined' where id = p_invite_id;
    return null;
  end if;

  v_mode := case when coalesce(v_invite.kind, 'study') = 'race' then 'race' else 'study' end;
  v_delay := case when v_mode = 'race' then interval '10 seconds' else interval '5 seconds' end;

  select array_agg(id) into v_ids
  from (
    select id from public.questions
    where subject_id = v_invite.subject_id and is_published = true
    order by random()
    limit 10
  ) q;
  if v_ids is null or coalesce(array_length(v_ids, 1), 0) < 1 then
    raise exception 'NO_QUESTIONS';
  end if;

  insert into public.study_sessions (subject_id, question_ids, status, starts_at, mode, host_id, capacity)
  values (v_invite.subject_id, v_ids, 'countdown', now() + v_delay, v_mode, v_invite.from_user, 2)
  returning id into v_session;

  insert into public.study_session_members (session_id, user_id)
  values (v_session, v_invite.from_user), (v_session, v_invite.to_user);

  update public.study_invites set status = 'accepted', session_id = v_session where id = p_invite_id;

  select display_name into v_from_name from public.profiles where id = v_invite.from_user;
  select display_name into v_to_name from public.profiles where id = v_invite.to_user;
  select name into v_subject from public.subjects where id = v_invite.subject_id;
  v_kind := case when v_mode = 'race' then 'race_accepted' else 'study_accepted' end;

  perform public.notify_user(v_invite.from_user, v_kind, jsonb_build_object(
    'session_id', v_session,
    'from_user', v_user,
    'from_name', coalesce(v_to_name, 'Öğrenci'),
    'subject_name', coalesce(v_subject, 'Ders')
  ));
  return v_session;
end;
$$;

create or replace function public.create_exam_lobby(p_subject_id uuid, p_capacity int)
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
  v_name text;
  v_cap int := p_capacity;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_cap not in (5, 10) then
    raise exception 'INVALID_CAPACITY';
  end if;
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
  values (p_subject_id, v_ids, 'waiting', 'exam', v_user, v_cap)
  returning id into v_session;

  insert into public.study_session_members (session_id, user_id) values (v_session, v_user);

  select name into v_subject from public.subjects where id = p_subject_id;
  select display_name into v_name from public.profiles where id = v_user;

  insert into public.social_posts (user_id, body, kind, subject_id, session_id, capacity)
  values (
    v_user,
    format('%s için %s kişilik sınav', coalesce(v_subject, 'Ders'), v_cap),
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
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  select * into v_session from public.study_sessions where id = p_session_id;
  if not found or v_session.mode <> 'exam' then
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

create or replace function public.start_exam_lobby(p_session_id uuid)
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
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  select * into v_session from public.study_sessions where id = p_session_id;
  if not found or v_session.host_id <> v_user then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_session.status <> 'waiting' then
    raise exception 'ALREADY_STARTED';
  end if;
  select count(*) into v_count from public.study_session_members where session_id = p_session_id;
  if v_count < 2 then
    raise exception 'NEED_TWO';
  end if;

  update public.study_sessions
  set status = 'countdown', starts_at = now() + interval '10 seconds'
  where id = p_session_id;

  insert into public.notifications (user_id, kind, payload)
  select m.user_id, 'exam_started', jsonb_build_object('session_id', p_session_id)
  from public.study_session_members m
  where m.session_id = p_session_id;

  return public.get_study_room(p_session_id);
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
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = v_user
  ) then
    raise exception 'UNAUTHORIZED';
  end if;

  perform public.maybe_activate_session(p_session_id);
  select * into v_session from public.study_sessions where id = p_session_id;
  v_qid := v_session.question_ids[v_session.current_index + 1];
  select name into v_subject from public.subjects where id = v_session.subject_id;
  v_show := v_session.status = 'reveal' or (v_session.status = 'ended' and v_session.mode = 'study');

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
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
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

  if v_session.mode = 'study' then
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

  if v_session.mode = 'study' and v_count >= v_members then
    update public.study_sessions set status = 'reveal' where id = p_session_id;
  elsif v_session.mode in ('race', 'exam') then
    perform public.advance_competitive(p_session_id);
  end if;

  return public.get_study_room(p_session_id);
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
  where s.mode = 'exam'
    and s.status in ('waiting', 'countdown')
  order by s.created_at desc
  limit 1;
  return v_row;
end;
$$;

revoke all on function public.request_race(uuid, uuid) from public;
revoke all on function public.create_exam_lobby(uuid, int) from public;
revoke all on function public.join_exam_lobby(uuid) from public;
revoke all on function public.start_exam_lobby(uuid) from public;
revoke all on function public.my_exam_banner() from public;
grant execute on function public.request_race(uuid, uuid) to authenticated;
grant execute on function public.create_exam_lobby(uuid, int) to authenticated;
grant execute on function public.join_exam_lobby(uuid) to authenticated;
grant execute on function public.start_exam_lobby(uuid) to authenticated;
grant execute on function public.my_exam_banner() to authenticated;
grant execute on function public.respond_study(uuid, boolean) to authenticated;
grant execute on function public.get_study_room(uuid) to authenticated;
grant execute on function public.submit_room_answer(uuid, text) to authenticated;

notify pgrst, 'reload schema';
