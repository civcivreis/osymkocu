-- Study-together rooms, notifications, optional post subject.
-- Run contents in SQL Editor. Do not paste the file path.

alter table public.social_posts
  add column if not exists subject_id uuid references public.subjects(id) on delete set null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('study_invite', 'study_accepted', 'study_ended')),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.study_invites (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  post_id uuid references public.social_posts(id) on delete set null,
  session_id uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

create index if not exists study_invites_to_idx on public.study_invites (to_user, status);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id),
  question_ids uuid[] not null,
  current_index int not null default 0,
  status text not null default 'countdown' check (status in ('countdown', 'active', 'reveal', 'ended')),
  starts_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.study_session_members (
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (session_id, user_id)
);

create table if not exists public.study_session_answers (
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  selected_choice text not null,
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  primary key (session_id, question_id, user_id)
);

create table if not exists public.study_session_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists study_session_messages_idx on public.study_session_messages (session_id, created_at);

alter table public.notifications enable row level security;
alter table public.study_invites enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_session_members enable row level security;
alter table public.study_session_answers enable row level security;
alter table public.study_session_messages enable row level security;

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists study_invites_own on public.study_invites;
create policy study_invites_own on public.study_invites
  for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

drop policy if exists study_sessions_member on public.study_sessions;
create policy study_sessions_member on public.study_sessions
  for select to authenticated
  using (exists (
    select 1 from public.study_session_members m
    where m.session_id = id and m.user_id = auth.uid()
  ));

drop policy if exists study_members_own on public.study_session_members;
create policy study_members_own on public.study_session_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.study_session_members m
      where m.session_id = study_session_members.session_id and m.user_id = auth.uid()
    )
  );

drop policy if exists study_answers_member on public.study_session_answers;
create policy study_answers_member on public.study_session_answers
  for select to authenticated
  using (exists (
    select 1 from public.study_session_members m
    where m.session_id = study_session_answers.session_id and m.user_id = auth.uid()
  ));

drop policy if exists study_messages_member on public.study_session_messages;
create policy study_messages_member on public.study_session_messages
  for select to authenticated
  using (exists (
    select 1 from public.study_session_members m
    where m.session_id = study_session_messages.session_id and m.user_id = auth.uid()
  ));

drop policy if exists study_messages_insert on public.study_session_messages;
create policy study_messages_insert on public.study_session_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.study_session_members m
      where m.session_id = study_session_messages.session_id and m.user_id = auth.uid()
    )
  );

create or replace function public.notify_user(p_user uuid, p_kind text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, payload)
  values (p_user, p_kind, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function public.request_study(p_other uuid, p_subject_id uuid, p_post_id uuid default null)
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

  insert into public.study_invites (from_user, to_user, subject_id, post_id)
  values (v_user, p_other, p_subject_id, p_post_id)
  returning id into v_id;

  select display_name into v_name from public.profiles where id = v_user;
  select name into v_subject from public.subjects where id = p_subject_id;

  perform public.notify_user(p_other, 'study_invite', jsonb_build_object(
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

  insert into public.study_sessions (subject_id, question_ids, status, starts_at)
  values (v_invite.subject_id, v_ids, 'countdown', now() + interval '5 seconds')
  returning id into v_session;

  insert into public.study_session_members (session_id, user_id)
  values (v_session, v_invite.from_user), (v_session, v_invite.to_user);

  update public.study_invites
  set status = 'accepted', session_id = v_session
  where id = p_invite_id;

  select display_name into v_from_name from public.profiles where id = v_invite.from_user;
  select display_name into v_to_name from public.profiles where id = v_invite.to_user;
  select name into v_subject from public.subjects where id = v_invite.subject_id;

  perform public.notify_user(v_invite.from_user, 'study_accepted', jsonb_build_object(
    'session_id', v_session,
    'from_user', v_user,
    'from_name', coalesce(v_to_name, 'Öğrenci'),
    'subject_name', coalesce(v_subject, 'Ders')
  ));

  return v_session;
end;
$$;

create or replace function public.maybe_activate_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.study_sessions
  set status = 'active'
  where id = p_session
    and status = 'countdown'
    and starts_at is not null
    and starts_at <= now();
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
  v_subject text;
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

  select jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'display_name', p.display_name
  )) into v_members
  from public.study_session_members m
  join public.profiles p on p.id = m.user_id
  where m.session_id = p_session_id;

  if v_qid is not null and v_session.status <> 'ended' then
    select jsonb_build_object(
      'id', q.id,
      'stem', q.stem,
      'choices', q.choices,
      'difficulty', q.difficulty,
      'correct_choice', case when v_session.status = 'reveal' then q.correct_choice else null end,
      'explanation', case when v_session.status = 'reveal' then q.explanation else null end
    ) into v_question
    from public.questions q
    where q.id = v_qid;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', a.user_id,
    'selected_choice', a.selected_choice,
    'is_correct', case when v_session.status = 'reveal' then a.is_correct else null end
  )), '[]'::jsonb) into v_answers
  from public.study_session_answers a
  where a.session_id = p_session_id and a.question_id = v_qid;

  return jsonb_build_object(
    'id', v_session.id,
    'subject_id', v_session.subject_id,
    'subject_name', v_subject,
    'status', v_session.status,
    'starts_at', v_session.starts_at,
    'current_index', v_session.current_index,
    'total', coalesce(array_length(v_session.question_ids, 1), 0),
    'question', v_question,
    'answers', v_answers,
    'members', coalesce(v_members, '[]'::jsonb)
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

  v_qid := v_session.question_ids[v_session.current_index + 1];
  select correct_choice into v_correct from public.questions where id = v_qid;
  v_ok := upper(p_choice) = upper(coalesce(v_correct, ''));

  insert into public.study_session_answers (session_id, question_id, user_id, selected_choice, is_correct)
  values (p_session_id, v_qid, v_user, upper(p_choice), v_ok)
  on conflict (session_id, question_id, user_id) do nothing;

  begin
    perform public.submit_question_attempt(v_qid, upper(p_choice), 0, 'practice');
  exception when others then
    null;
  end;

  select count(*) into v_count
  from public.study_session_answers
  where session_id = p_session_id and question_id = v_qid;

  if v_count >= 2 then
    update public.study_sessions set status = 'reveal' where id = p_session_id;
  end if;

  return public.get_study_room(p_session_id);
end;
$$;

create or replace function public.advance_room_question(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session public.study_sessions%rowtype;
  v_next int;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = v_user
  ) then
    raise exception 'UNAUTHORIZED';
  end if;
  select * into v_session from public.study_sessions where id = p_session_id;
  if v_session.status <> 'reveal' then
    raise exception 'NOT_REVEAL';
  end if;
  v_next := v_session.current_index + 1;
  if v_next >= coalesce(array_length(v_session.question_ids, 1), 0) then
    update public.study_sessions set status = 'ended', ended_at = now() where id = p_session_id;
  else
    update public.study_sessions
    set current_index = v_next, status = 'active'
    where id = p_session_id;
  end if;
  return public.get_study_room(p_session_id);
end;
$$;

create or replace function public.leave_study_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_other uuid;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if not exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = v_user
  ) then
    raise exception 'UNAUTHORIZED';
  end if;
  select display_name into v_name from public.profiles where id = v_user;
  select user_id into v_other
  from public.study_session_members
  where session_id = p_session_id and user_id <> v_user
  limit 1;
  update public.study_sessions set status = 'ended', ended_at = now() where id = p_session_id and status <> 'ended';
  if v_other is not null then
    perform public.notify_user(v_other, 'study_ended', jsonb_build_object(
      'session_id', p_session_id,
      'from_name', coalesce(v_name, 'Öğrenci')
    ));
  end if;
end;
$$;

revoke all on function public.request_study(uuid, uuid, uuid) from public;
revoke all on function public.respond_study(uuid, boolean) from public;
revoke all on function public.get_study_room(uuid) from public;
revoke all on function public.submit_room_answer(uuid, text) from public;
revoke all on function public.advance_room_question(uuid) from public;
revoke all on function public.leave_study_session(uuid) from public;
grant execute on function public.request_study(uuid, uuid, uuid) to authenticated;
grant execute on function public.respond_study(uuid, boolean) to authenticated;
grant execute on function public.get_study_room(uuid) to authenticated;
grant execute on function public.submit_room_answer(uuid, text) to authenticated;
grant execute on function public.advance_room_question(uuid) to authenticated;
grant execute on function public.leave_study_session(uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.study_sessions;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.study_session_answers;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.study_session_messages;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
