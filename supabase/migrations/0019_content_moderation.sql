-- Content reports, optional status metadata, stronger moderation. Paste after 0018.

create or replace function public.content_moderation_level(p_body text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_body, ''));
  c text;
begin
  v := translate(v, 'ıİğĞüÜşŞöÖçÇâêîôû@$013457', 'iiggussooccaaeeiouasoieast');
  v := regexp_replace(v, '(.)\1+', '\1', 'g');
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := ' ' || btrim(v) || ' ';
  c := replace(v, ' ', '');
  if c ~ '(ananisik|bacinisik|annenisik|kizinisik|karinisik|aminakoy|aminasik|orospuoc|gotunusik|gotunesik|anasinisik|sikeyim|sikerim|oldureceg|oldururum|killyourself)' then
    return 'block';
  end if;
  if v ~ ' (orospu|orospuocugu|yarrak|yarak|sikeyim|sikerim|pezevenk|gavat|ibne|kys) ' then
    return 'block';
  end if;
  if v ~ ' (amk|amq|siktir) ' then
    return 'warn';
  end if;
  return 'ok';
end;
$$;

create or replace function public.room_text_blocked(p_body text)
returns boolean
language sql
immutable
as $$
  select public.content_moderation_level(p_body) = 'block';
$$;

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  content_type text not null check (content_type in ('status', 'room_message', 'comment')),
  content_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (reporter_user_id, content_type, content_id),
  check (reporter_user_id <> target_user_id)
);

create table if not exists public.content_moderation_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  target_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_reports_target_idx on public.content_reports (content_type, content_id);
alter table public.content_reports enable row level security;
alter table public.content_moderation_events enable row level security;
drop policy if exists content_reports_own on public.content_reports;
create policy content_reports_own on public.content_reports
  for select to authenticated
  using (reporter_user_id = auth.uid());

drop function if exists public.publish_status(text, uuid, int);
drop function if exists public.publish_status(text, uuid, int, text);
drop function if exists public.publish_status(text, uuid, int, text, text);

create function public.publish_status(
  p_body text,
  p_subject_id uuid default null,
  p_minutes int default null,
  p_kind text default 'status',
  p_goal text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'status');
  v_mins int := coalesce(p_minutes, 60);
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.profiles where id = v_user and is_bot) then
    raise exception 'UNAUTHORIZED';
  end if;
  if length(trim(p_body)) < 2 then raise exception 'EMPTY_MESSAGE'; end if;
  if public.content_moderation_level(p_body) = 'block' then raise exception 'MESSAGE_BLOCKED'; end if;
  if v_mins not in (30, 60, 120, 240) then v_mins := 60; end if;
  if v_kind not in ('status', 'ask', 'activity') then v_kind := 'status'; end if;
  insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at, goal_label)
  values (
    v_user,
    trim(p_body),
    v_kind,
    p_subject_id,
    v_mins,
    now() + make_interval(mins => v_mins),
    nullif(left(trim(coalesce(p_goal, '')), 32), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.add_post_comment(p_post uuid, p_body text, p_parent uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_parent uuid := p_parent;
  v_root uuid;
  v_ppost uuid;
  v_text text := trim(p_body);
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if length(v_text) < 1 then raise exception 'EMPTY_MESSAGE'; end if;
  if public.content_moderation_level(v_text) = 'block' then raise exception 'MESSAGE_BLOCKED'; end if;
  if v_parent is not null then
    select id, parent_id, post_id into v_root, v_parent, v_ppost
    from public.post_comments where id = p_parent;
    if not found or v_ppost <> p_post then raise exception 'INVALID_PARENT'; end if;
    if v_parent is not null then
      v_root := v_parent;
    end if;
    v_parent := v_root;
  end if;
  select id into v_id
  from public.post_comments
  where post_id = p_post
    and user_id = v_user
    and coalesce(parent_id, '00000000-0000-0000-0000-000000000000') = coalesce(v_parent, '00000000-0000-0000-0000-000000000000')
    and public.norm_comment(body) = public.norm_comment(v_text)
    and created_at > now() - interval '2 minutes'
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.post_comments (post_id, user_id, body, parent_id)
  values (p_post, v_user, v_text, v_parent)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_own_post(p_post uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  delete from public.social_posts where id = p_post and user_id = auth.uid();
  if not found then raise exception 'UNAUTHORIZED'; end if;
end;
$$;

create or replace function public.update_own_post(p_post uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_text text := trim(p_body);
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if length(v_text) < 2 then raise exception 'EMPTY_MESSAGE'; end if;
  if public.content_moderation_level(v_text) = 'block' then raise exception 'MESSAGE_BLOCKED'; end if;
  update public.social_posts
  set body = v_text
  where id = p_post and user_id = auth.uid();
  if not found then raise exception 'UNAUTHORIZED'; end if;
end;
$$;

create or replace function public.report_content(
  p_type text,
  p_content_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_target uuid;
  v_session uuid;
  v_count int;
  v_kicked boolean := false;
  v_inserted uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_type not in ('status', 'room_message', 'comment') then raise exception 'BAD_TYPE'; end if;
  if p_reason not in ('kufur', 'taciz', 'spam', 'uygunsuz', 'diger') then raise exception 'BAD_REASON'; end if;
  if exists (select 1 from public.profiles where id = v_user and coalesce(is_bot, false)) then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_type = 'status' then
    select user_id into v_target from public.social_posts where id = p_content_id;
  elsif p_type = 'comment' then
    select user_id into v_target from public.post_comments where id = p_content_id;
  else
    select sender_id, session_id into v_target, v_session
    from public.study_session_messages where id = p_content_id;
  end if;
  if v_target is null then raise exception 'NOT_FOUND'; end if;
  if v_target = v_user then raise exception 'SELF_REPORT'; end if;

  if exists (
    select 1 from public.content_reports
    where reporter_user_id = v_user and created_at > now() - interval '15 seconds'
  ) then
    insert into public.content_moderation_events (actor_id, target_id, kind, payload)
    values (v_user, v_target, 'report_cooldown', jsonb_build_object('type', p_type, 'content_id', p_content_id));
    raise exception 'REPORT_COOLDOWN';
  end if;

  insert into public.content_reports (reporter_user_id, target_user_id, content_type, content_id, reason)
  values (v_user, v_target, p_type, p_content_id, p_reason)
  on conflict (reporter_user_id, content_type, content_id) do nothing
  returning id into v_inserted;

  insert into public.content_moderation_events (actor_id, target_id, kind, payload)
  values (
    v_user,
    v_target,
    case when v_inserted is null then 'duplicate_report' else 'report' end,
    jsonb_build_object('type', p_type, 'content_id', p_content_id, 'reason', p_reason)
  );

  if p_type = 'room_message' and v_session is not null then
    if not exists (
      select 1 from public.study_session_members where session_id = v_session and user_id = v_user
    ) then
      raise exception 'NOT_IN_ROOM';
    end if;
    insert into public.room_reports (session_id, reporter_user_id, reported_user_id, message_id, reason)
    values (v_session, v_user, v_target, p_content_id, p_reason)
    on conflict (session_id, reporter_user_id, reported_user_id) do nothing;

    select count(distinct r.reporter_user_id)::int into v_count
    from public.room_reports r
    join public.profiles p on p.id = r.reporter_user_id
    where r.session_id = v_session
      and r.reported_user_id = v_target
      and coalesce(p.is_bot, false) = false;

    if v_count >= 2 then
      delete from public.study_session_members where session_id = v_session and user_id = v_target;
      insert into public.room_bans (session_id, user_id, expires_at, reason)
      values (v_session, v_target, now() + interval '30 minutes', 'two_unique_reports')
      on conflict (session_id, user_id) do update
        set expires_at = greatest(public.room_bans.expires_at, excluded.expires_at);
      insert into public.notifications (user_id, kind, payload)
      values (v_target, 'room_kicked', jsonb_build_object('session_id', v_session));
      v_kicked := true;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'kicked', v_kicked);
end;
$$;

revoke all on function public.publish_status(text, uuid, int, text, text) from public;
revoke all on function public.delete_own_post(uuid) from public;
revoke all on function public.update_own_post(uuid, text) from public;
revoke all on function public.report_content(text, uuid, text) from public;
grant execute on function public.publish_status(text, uuid, int, text, text) to authenticated;
grant execute on function public.delete_own_post(uuid) to authenticated;
grant execute on function public.update_own_post(uuid, text) to authenticated;
grant execute on function public.report_content(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
