-- Match anti-spam + quiet UX. Paste after 0033.

create or replace function public.match_config()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'cooldown_hours', 2,
    'max_per_day', 3,
    'rematch_hours', 24,
    'fatigue_count', 3,
    'fatigue_hours', 12,
    'offer_minutes', 10,
    'stale_seconds', 45
  );
$$;

alter table public.profiles
  add column if not exists match_notify boolean not null default true,
  add column if not exists match_same_topic boolean not null default true,
  add column if not exists match_same_subject boolean not null default true,
  add column if not exists match_suppressed_until timestamptz;

create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid,
  user_id uuid references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('shown', 'accepted', 'declined', 'ignored', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists match_events_user_idx on public.match_events (user_id, created_at desc);
create unique index if not exists notifications_match_offer_uidx
  on public.notifications (user_id, (payload->>'offer_id'))
  where kind in ('study_match_found', 'study_offer') and payload->>'offer_id' is not null;
alter table public.match_events drop constraint if exists match_events_once;
alter table public.match_events add constraint match_events_once unique (offer_id, user_id, kind);
alter table public.match_events enable row level security;
drop policy if exists match_events_own on public.match_events;
create policy match_events_own on public.match_events
  for select to authenticated using (user_id = auth.uid());

create or replace function public.log_match_event(p_offer uuid, p_user uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.match_events (offer_id, user_id, kind)
  values (p_offer, p_user, p_kind)
  on conflict (offer_id, user_id, kind) do nothing;
end;
$$;

create or replace function public.notify_match_once(p_user uuid, p_kind text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.notifications
    where user_id = p_user
      and kind in ('study_match_found', 'study_offer')
      and payload->>'offer_id' = p_payload->>'offer_id'
  ) then
    return;
  end if;
  insert into public.notifications (user_id, kind, payload)
  values (p_user, p_kind, coalesce(p_payload, '{}'::jsonb));
end;
$$;

create or replace function public.offer_json(p_offer public.study_match_offers, p_user uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_other uuid;
  v_name text;
  v_tag int;
  v_avatar text;
  v_subject text;
  v_topic text;
begin
  v_other := case when p_offer.user_a = p_user then p_offer.user_b else p_offer.user_a end;
  select display_name, display_tag, avatar_url into v_name, v_tag, v_avatar from public.profiles where id = v_other;
  select name into v_subject from public.subjects where id = p_offer.subject_id;
  select name into v_topic from public.topics where id = p_offer.topic_id;
  return jsonb_build_object(
    'id', p_offer.id,
    'subject_id', p_offer.subject_id,
    'subject_name', coalesce(v_subject, 'Ders'),
    'topic_id', p_offer.topic_id,
    'topic_name', v_topic,
    'other_id', v_other,
    'other_name', coalesce(v_name, 'Öğrenci'),
    'other_tag', v_tag,
    'other_avatar', v_avatar,
    'status', p_offer.status,
    'session_id', p_offer.session_id,
    'expires_at', p_offer.expires_at,
    'my_yes', case when p_offer.user_a = p_user then p_offer.a_yes else p_offer.b_yes end,
    'expired', p_offer.status = 'expired' or p_offer.expires_at < now()
  );
end;
$$;

create or replace function public.protect_profile_progress()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.current_xp := old.current_xp;
    new.league_tier := old.league_tier;
    new.app_role := old.app_role;
    new.account_status := old.account_status;
    new.restricted_until := old.restricted_until;
    new.match_suppressed_until := old.match_suppressed_until;
  end if;
  return new;
end;
$$;

create or replace function public.user_in_quiet_match(p_user uuid)
returns boolean
language sql
stable
as $$
  select
    public.in_live_session(p_user)
    or exists (
      select 1 from public.system_exam_attempts a
      where a.user_id = p_user and a.status = 'in_progress'
    )
    or exists (
      select 1 from public.study_invites i
      where i.status = 'pending' and (i.from_user = p_user or i.to_user = p_user)
        and i.expires_at > now()
    );
$$;

drop function if exists public.heartbeat_study(uuid);
drop function if exists public.heartbeat_study(uuid, uuid);
create or replace function public.heartbeat_study(p_subject_id uuid, p_topic_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean;
  v_notify boolean;
  v_topic_ok boolean;
  v_subject_ok boolean;
  v_suppressed timestamptz;
  v_exam uuid;
  v_other uuid;
  v_offer public.study_match_offers%rowtype;
  v_a uuid;
  v_b uuid;
  v_name text;
  v_tag int;
  v_subject text;
  v_topic text;
  v_me_bot boolean;
  v_minutes int := coalesce((public.match_config()->>'offer_minutes')::int, 10);
  v_stale int := coalesce((public.match_config()->>'stale_seconds')::int, 45);
  v_day int := coalesce((public.match_config()->>'max_per_day')::int, 3);
  v_cool int := coalesce((public.match_config()->>'cooldown_hours')::int, 2);
  v_re int := coalesce((public.match_config()->>'rematch_hours')::int, 24);
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_subject_id is null then raise exception 'SUBJECT_NOT_FOUND'; end if;

  select coalesce(auto_match, true), coalesce(match_notify, true),
         coalesce(match_same_topic, true), coalesce(match_same_subject, true),
         match_suppressed_until, coalesce(is_bot, false)
    into v_enabled, v_notify, v_topic_ok, v_subject_ok, v_suppressed, v_me_bot
  from public.profiles where id = v_user;

  if v_enabled is not true then
    delete from public.study_presence where user_id = v_user;
    return null;
  end if;

  if v_suppressed is not null and v_suppressed > now() then
    insert into public.study_presence (user_id, subject_id, exam_id, topic_id, heartbeat_at, last_seen_at, is_available_for_match, status)
    select v_user, p_subject_id, s.exam_id, p_topic_id, now(), now(), false, 'paused'
    from public.subjects s where s.id = p_subject_id
    on conflict (user_id) do update
      set heartbeat_at = now(), last_seen_at = now(), is_available_for_match = false, status = 'paused';
    return public.get_my_match_offer();
  end if;

  if public.user_in_quiet_match(v_user) then
    insert into public.study_presence (user_id, subject_id, exam_id, topic_id, heartbeat_at, last_seen_at, is_available_for_match, status)
    select v_user, p_subject_id, s.exam_id, p_topic_id, now(), now(), false, 'paused'
    from public.subjects s where s.id = p_subject_id
    on conflict (user_id) do update
      set heartbeat_at = now(), last_seen_at = now(), is_available_for_match = false, status = 'paused';
    return public.get_my_match_offer();
  end if;

  select exam_id into v_exam from public.subjects where id = p_subject_id;
  if v_exam is null then raise exception 'SUBJECT_NOT_FOUND'; end if;

  insert into public.study_presence (user_id, subject_id, exam_id, topic_id, heartbeat_at, last_seen_at, is_available_for_match, status)
  values (v_user, p_subject_id, v_exam, p_topic_id, now(), now(), true, 'studying')
  on conflict (user_id) do update
    set subject_id = excluded.subject_id,
        exam_id = excluded.exam_id,
        topic_id = excluded.topic_id,
        heartbeat_at = now(),
        last_seen_at = now(),
        is_available_for_match = true,
        status = 'studying';

  update public.study_presence
    set status = 'offline', is_available_for_match = false
    where heartbeat_at < now() - make_interval(secs => v_stale);

  update public.study_match_offers
    set status = 'expired'
    where status = 'pending' and expires_at < now();

  insert into public.match_events (offer_id, user_id, kind)
  select o.id, v_user, 'expired'
  from public.study_match_offers o
  where o.status = 'expired'
    and (o.user_a = v_user or o.user_b = v_user)
    and o.expires_at > now() - interval '15 minutes'
    and not exists (
      select 1 from public.match_events e where e.offer_id = o.id and e.user_id = v_user and e.kind = 'expired'
    );

  select * into v_offer from public.study_match_offers
  where status = 'pending' and (user_a = v_user or user_b = v_user)
  order by created_at desc limit 1;
  if found then return public.offer_json(v_offer, v_user); end if;

  if (
    select count(*) from public.study_match_offers o
    where (o.user_a = v_user or o.user_b = v_user)
      and o.created_at > now() - interval '24 hours'
  ) >= v_day then
    return null;
  end if;

  if exists (
    select 1 from public.study_match_offers o
    where (o.user_a = v_user or o.user_b = v_user)
      and o.created_at > now() - make_interval(hours => v_cool)
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_subject_id::text));

  select p.user_id into v_other
  from public.study_presence p
  join public.profiles pr on pr.id = p.user_id
  where p.user_id <> v_user
    and p.is_available_for_match
    and p.status = 'studying'
    and p.heartbeat_at > now() - make_interval(secs => v_stale)
    and coalesce(pr.auto_match, true) = true
    and (pr.match_suppressed_until is null or pr.match_suppressed_until <= now())
    and coalesce(pr.is_bot, false) = v_me_bot
    and not public.user_in_quiet_match(p.user_id)
    and (v_topic_ok or v_subject_ok)
    and p.subject_id = p_subject_id
    and (
      (v_topic_ok and p_topic_id is not null and p.topic_id is not distinct from p_topic_id)
      or (v_subject_ok and coalesce(pr.match_same_subject, true))
    )
    and (coalesce(pr.match_same_topic, true) = false or p_topic_id is null or p.topic_id is null or p.topic_id is not distinct from p_topic_id or coalesce(pr.match_same_subject, true))
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = v_user and b.blocked_id = p.user_id)
         or (b.blocker_id = p.user_id and b.blocked_id = v_user)
    )
    and not exists (
      select 1 from public.study_match_offers o
      where o.created_at > now() - make_interval(hours => v_re)
        and o.user_a = least(v_user, p.user_id)
        and o.user_b = greatest(v_user, p.user_id)
        and o.topic_id is not distinct from p_topic_id
    )
  order by (p.topic_id is not distinct from p_topic_id) desc, p.heartbeat_at asc
  limit 1;

  if v_other is null then return null; end if;

  v_a := least(v_user, v_other);
  v_b := greatest(v_user, v_other);
  insert into public.study_match_offers (user_a, user_b, subject_id, topic_id, expires_at)
  values (v_a, v_b, p_subject_id, p_topic_id, now() + make_interval(mins => v_minutes))
  returning * into v_offer;

  perform public.log_match_event(v_offer.id, v_user, 'shown');
  perform public.log_match_event(v_offer.id, v_other, 'shown');

  select name into v_subject from public.subjects where id = p_subject_id;
  select name into v_topic from public.topics where id = p_topic_id;

  if exists (select 1 from public.profiles where id = v_other and coalesce(match_notify, true)) then
    select display_name, display_tag into v_name, v_tag from public.profiles where id = v_user;
    perform public.notify_match_once(v_other, 'study_match_found', jsonb_build_object(
      'offer_id', v_offer.id, 'from_name', coalesce(v_name, 'Öğrenci'), 'from_tag', v_tag,
      'from_user', v_user, 'subject_id', p_subject_id, 'subject_name', coalesce(v_subject, 'Ders'),
      'topic_name', v_topic, 'expires_at', v_offer.expires_at
    ));
  end if;
  if v_notify then
    select display_name, display_tag into v_name, v_tag from public.profiles where id = v_other;
    perform public.notify_match_once(v_user, 'study_match_found', jsonb_build_object(
      'offer_id', v_offer.id, 'from_name', coalesce(v_name, 'Öğrenci'), 'from_tag', v_tag,
      'from_user', v_other, 'subject_id', p_subject_id, 'subject_name', coalesce(v_subject, 'Ders'),
      'topic_name', v_topic, 'expires_at', v_offer.expires_at
    ));
  end if;

  return public.offer_json(v_offer, v_user);
end;
$$;

create or replace function public.respond_match_offer(p_offer_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_offer public.study_match_offers%rowtype;
  v_session uuid;
  v_a_yes boolean;
  v_b_yes boolean;
  v_fatigue int := coalesce((public.match_config()->>'fatigue_count')::int, 3);
  v_fatigue_h int := coalesce((public.match_config()->>'fatigue_hours')::int, 12);
  v_declines int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_offer from public.study_match_offers where id = p_offer_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_offer.user_a <> v_user and v_offer.user_b <> v_user then raise exception 'UNAUTHORIZED'; end if;

  if v_offer.status = 'matched' and v_offer.session_id is not null then
    return public.offer_json(v_offer, v_user);
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at < now() then
    update public.study_match_offers set status = 'expired' where id = p_offer_id and status = 'pending';
    perform public.log_match_event(p_offer_id, v_user, 'expired');
    raise exception 'EXPIRED';
  end if;

  if not p_accept then
    update public.study_match_offers set status = 'declined' where id = p_offer_id;
    perform public.log_match_event(p_offer_id, v_user, 'declined');
    select count(*) into v_declines
    from public.match_events
    where user_id = v_user and kind = 'declined' and created_at > now() - interval '2 hours';
    if v_declines >= v_fatigue then
      update public.profiles
        set match_suppressed_until = now() + make_interval(hours => v_fatigue_h)
        where id = v_user;
    end if;
    return null;
  end if;

  perform public.log_match_event(p_offer_id, v_user, 'accepted');
  if v_offer.user_a = v_user then
    update public.study_match_offers set a_yes = true where id = p_offer_id;
  else
    update public.study_match_offers set b_yes = true where id = p_offer_id;
  end if;
  select a_yes, b_yes into v_a_yes, v_b_yes from public.study_match_offers where id = p_offer_id;
  if v_a_yes is true and v_b_yes is true then
    v_session := public.start_pair_session(v_offer.user_a, v_offer.user_b, v_offer.subject_id);
    update public.study_match_offers set status = 'matched', session_id = v_session where id = p_offer_id;
    select * into v_offer from public.study_match_offers where id = p_offer_id;
  else
    select * into v_offer from public.study_match_offers where id = p_offer_id;
  end if;
  return public.offer_json(v_offer, v_user);
end;
$$;

grant execute on function public.match_config() to authenticated;
grant execute on function public.heartbeat_study(uuid, uuid) to authenticated;
grant execute on function public.respond_match_offer(uuid, boolean) to authenticated;
revoke all on function public.notify_match_once(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.log_match_event(uuid, uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
