-- Room member realtime, reports, 30dk kick-ban. Paste in SQL Editor.

alter table public.study_session_members
  add column if not exists joined_at timestamptz not null default now();

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'study_invite', 'study_accepted', 'study_ended', 'study_offer',
    'race_invite', 'race_accepted', 'exam_lobby', 'exam_started',
    'room_kicked'
  ));

create table if not exists public.room_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.study_session_messages(id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (session_id, reporter_user_id, reported_user_id),
  check (reporter_user_id <> reported_user_id)
);

create table if not exists public.room_bans (
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null,
  reason text not null default 'reports',
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table if not exists public.room_moderation_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.study_sessions(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  target_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists room_reports_target_idx on public.room_reports (session_id, reported_user_id);
create index if not exists room_bans_expires_idx on public.room_bans (expires_at);
create index if not exists room_moderation_events_idx on public.room_moderation_events (session_id, created_at desc);

alter table public.room_reports enable row level security;
alter table public.room_bans enable row level security;
alter table public.room_moderation_events enable row level security;

drop policy if exists room_reports_own on public.room_reports;
create policy room_reports_own on public.room_reports
  for select to authenticated
  using (reporter_user_id = auth.uid());

create or replace function public.room_text_blocked(p_body text)
returns boolean
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_body, ''));
begin
  v := translate(v, 'ıİğĞüÜşŞöÖçÇâêîôû', 'iigususoocaeeiou');
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := ' ' || btrim(v) || ' ';
  return v ~ '( amk | amq | orospu | orospuocugu | siktir | sikeyim | sikerim | sikis | yarrak | yarak | aminakoyim | gotunu | gotune | anasinisik | pezevenk | gavat | ibne | oldurecegim | oldururum | killyourself | kys )';
end;
$$;

create or replace function public.send_room_message(p_session_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_chat boolean;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if char_length(v_body) < 1 then raise exception 'EMPTY'; end if;
  if public.room_text_blocked(v_body) then raise exception 'MESSAGE_BLOCKED'; end if;
  if not exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = v_user
  ) then
    raise exception 'NOT_IN_ROOM';
  end if;
  select coalesce(chat_enabled, true) into v_chat from public.study_sessions where id = p_session_id;
  if v_chat is not true then raise exception 'CHAT_OFF'; end if;

  insert into public.study_session_messages (session_id, sender_id, body)
  values (p_session_id, v_user, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.report_room_user(
  p_session_id uuid,
  p_reported uuid,
  p_reason text,
  p_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_count int;
  v_kicked boolean := false;
  v_inserted uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if v_user = p_reported then raise exception 'SELF_REPORT'; end if;
  if v_reason not in ('kufur', 'taciz', 'spam', 'uygunsuz', 'diger') then
    raise exception 'BAD_REASON';
  end if;
  if exists (select 1 from public.profiles where id = v_user and coalesce(is_bot, false)) then
    raise exception 'UNAUTHORIZED';
  end if;
  if not exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = v_user
  ) then
    raise exception 'NOT_IN_ROOM';
  end if;
  if not exists (
    select 1 from public.study_session_members where session_id = p_session_id and user_id = p_reported
  ) then
    raise exception 'TARGET_NOT_IN_ROOM';
  end if;
  if exists (
    select 1 from public.room_reports
    where session_id = p_session_id and reporter_user_id = v_user and created_at > now() - interval '15 seconds'
  ) then
    insert into public.room_moderation_events (session_id, actor_id, target_id, kind, payload)
    values (p_session_id, v_user, p_reported, 'report_cooldown', jsonb_build_object('reason', v_reason));
    raise exception 'REPORT_COOLDOWN';
  end if;

  insert into public.room_reports (session_id, reporter_user_id, reported_user_id, message_id, reason)
  values (p_session_id, v_user, p_reported, p_message_id, v_reason)
  on conflict (session_id, reporter_user_id, reported_user_id) do nothing
  returning id into v_inserted;

  insert into public.room_moderation_events (session_id, actor_id, target_id, kind, payload)
  values (
    p_session_id,
    v_user,
    p_reported,
    case when v_inserted is null then 'duplicate_report' else 'report' end,
    jsonb_build_object('reason', v_reason, 'message_id', p_message_id)
  );

  if exists (
    select 1
    from public.room_reports a
    join public.room_reports b
      on a.session_id = b.session_id
     and a.reporter_user_id = b.reported_user_id
     and a.reported_user_id = b.reporter_user_id
     and a.session_id = p_session_id
     and a.reporter_user_id = v_user
     and a.reported_user_id = p_reported
     and a.created_at > now() - interval '10 minutes'
     and b.created_at > now() - interval '10 minutes'
  ) then
    insert into public.room_moderation_events (session_id, actor_id, target_id, kind, payload)
    values (p_session_id, v_user, p_reported, 'collusion_suspect', '{}'::jsonb);
  end if;

  select count(distinct r.reporter_user_id)::int into v_count
  from public.room_reports r
  join public.profiles p on p.id = r.reporter_user_id
  where r.session_id = p_session_id
    and r.reported_user_id = p_reported
    and coalesce(p.is_bot, false) = false;

  if v_count >= 2 then
    delete from public.study_session_members
    where session_id = p_session_id and user_id = p_reported;
    insert into public.room_bans (session_id, user_id, expires_at, reason)
    values (p_session_id, p_reported, now() + interval '30 minutes', 'two_unique_reports')
    on conflict (session_id, user_id) do update
      set expires_at = greatest(public.room_bans.expires_at, excluded.expires_at),
          reason = excluded.reason;
    insert into public.notifications (user_id, kind, payload)
    values (
      p_reported,
      'room_kicked',
      jsonb_build_object('session_id', p_session_id)
    );
    insert into public.room_moderation_events (session_id, actor_id, target_id, kind, payload)
    values (p_session_id, v_user, p_reported, 'kick', jsonb_build_object('unique_reports', v_count));
    v_kicked := true;
  end if;

  return jsonb_build_object('ok', true, 'kicked', v_kicked, 'unique_reports', v_count);
end;
$$;

create or replace function public.join_exam_lobby(p_session_id uuid, p_password text default null)
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
  perform pg_advisory_xact_lock(hashtext(p_session_id::text));
  select * into v_session from public.study_sessions where id = p_session_id;
  if not found or v_session.mode not in ('exam', 'study', 'test') then
    raise exception 'NOT_FOUND';
  end if;
  if exists (
    select 1 from public.room_bans
    where session_id = p_session_id and user_id = v_user and expires_at > now()
  ) then
    raise exception 'ROOM_BANNED';
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
  if v_count > v_session.capacity then
    delete from public.study_session_members
    where session_id = p_session_id and user_id = v_user;
    raise exception 'FULL';
  end if;
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
  if exists (
    select 1 from public.room_bans
    where session_id = p_session_id and user_id = v_user and expires_at > now()
      and not exists (
        select 1 from public.study_session_members m
        where m.session_id = p_session_id and m.user_id = v_user
      )
  ) then
    raise exception 'ROOM_KICKED';
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
    'answers', coalesce(v_answers, '[]'::jsonb),
    'members', coalesce(v_members, '[]'::jsonb),
    'scores', coalesce(v_scores, '[]'::jsonb)
  );
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
        s.created_at,
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

drop policy if exists study_messages_insert on public.study_session_messages;

revoke all on function public.send_room_message(uuid, text) from public;
revoke all on function public.report_room_user(uuid, uuid, text, uuid) from public;
revoke all on function public.room_text_blocked(text) from public;
grant execute on function public.send_room_message(uuid, text) to authenticated;
grant execute on function public.report_room_user(uuid, uuid, text, uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.study_session_members;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
