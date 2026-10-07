-- Live practice matching. Run contents in SQL Editor. Do not paste the file path.

alter table public.profiles
  add column if not exists auto_match boolean not null default true;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('study_invite', 'study_accepted', 'study_ended', 'study_offer'));

create table if not exists public.study_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  exam_id uuid references public.exams(id) on delete cascade,
  heartbeat_at timestamptz not null default now()
);

alter table public.study_presence
  add column if not exists exam_id uuid references public.exams(id) on delete cascade;

create index if not exists study_presence_subject_idx on public.study_presence (subject_id, heartbeat_at);

create table if not exists public.study_match_offers (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  a_yes boolean,
  b_yes boolean,
  session_id uuid,
  status text not null default 'pending' check (status in ('pending', 'matched', 'declined', 'expired')),
  expires_at timestamptz not null default (now() + interval '15 seconds'),
  created_at timestamptz not null default now(),
  check (user_a < user_b)
);

create index if not exists study_match_offers_pending_idx on public.study_match_offers (status, expires_at);
create unique index if not exists study_match_offers_pending_a_idx
  on public.study_match_offers (user_a) where status = 'pending';
create unique index if not exists study_match_offers_pending_b_idx
  on public.study_match_offers (user_b) where status = 'pending';

alter table public.study_presence enable row level security;
alter table public.study_match_offers enable row level security;

drop policy if exists study_presence_own on public.study_presence;
create policy study_presence_own on public.study_presence
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists study_match_offers_own on public.study_match_offers;
create policy study_match_offers_own on public.study_match_offers
  for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

create or replace function public.in_live_session(p_user uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.study_session_members m
    join public.study_sessions s on s.id = m.session_id
    where m.user_id = p_user
      and s.status in ('countdown', 'active', 'reveal')
  );
$$;

create or replace function public.start_pair_session(p_user_a uuid, p_user_b uuid, p_subject_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_session uuid;
  v_name_a text;
  v_name_b text;
  v_subject text;
begin
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

  insert into public.study_sessions (subject_id, question_ids, status, starts_at)
  values (p_subject_id, v_ids, 'countdown', now() + interval '5 seconds')
  returning id into v_session;

  insert into public.study_session_members (session_id, user_id)
  values (v_session, p_user_a), (v_session, p_user_b);

  delete from public.study_presence where user_id in (p_user_a, p_user_b);

  select display_name into v_name_a from public.profiles where id = p_user_a;
  select display_name into v_name_b from public.profiles where id = p_user_b;
  select name into v_subject from public.subjects where id = p_subject_id;

  perform public.notify_user(p_user_a, 'study_accepted', jsonb_build_object(
    'session_id', v_session,
    'from_name', coalesce(v_name_b, 'Öğrenci'),
    'subject_name', coalesce(v_subject, 'Ders')
  ));
  perform public.notify_user(p_user_b, 'study_accepted', jsonb_build_object(
    'session_id', v_session,
    'from_name', coalesce(v_name_a, 'Öğrenci'),
    'subject_name', coalesce(v_subject, 'Ders')
  ));

  return v_session;
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
  v_subject text;
begin
  v_other := case when p_offer.user_a = p_user then p_offer.user_b else p_offer.user_a end;
  select display_name into v_name from public.profiles where id = v_other;
  select name into v_subject from public.subjects where id = p_offer.subject_id;
  return jsonb_build_object(
    'id', p_offer.id,
    'subject_id', p_offer.subject_id,
    'subject_name', coalesce(v_subject, 'Ders'),
    'other_id', v_other,
    'other_name', coalesce(v_name, 'Öğrenci'),
    'status', p_offer.status,
    'session_id', p_offer.session_id,
    'expires_at', p_offer.expires_at,
    'my_yes', case when p_offer.user_a = p_user then p_offer.a_yes else p_offer.b_yes end
  );
end;
$$;

create or replace function public.get_my_match_offer()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_offer public.study_match_offers%rowtype;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  update public.study_match_offers
  set status = 'expired'
  where status = 'pending' and expires_at < now()
    and (user_a = v_user or user_b = v_user);

  select * into v_offer
  from public.study_match_offers o
  where (o.user_a = v_user or o.user_b = v_user)
    and (
      o.status = 'pending'
      or (
        o.status = 'matched'
        and o.session_id is not null
        and exists (
          select 1 from public.study_sessions s
          where s.id = o.session_id
            and s.status in ('countdown', 'active', 'reveal')
        )
      )
    )
  order by o.created_at desc
  limit 1;

  if not found then
    return null;
  end if;
  return public.offer_json(v_offer, v_user);
end;
$$;

create or replace function public.leave_presence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  delete from public.study_presence where user_id = auth.uid();
end;
$$;

create or replace function public.heartbeat_study(p_subject_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean;
  v_exam uuid;
  v_other uuid;
  v_offer public.study_match_offers%rowtype;
  v_a uuid;
  v_b uuid;
  v_name text;
  v_subject text;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if p_subject_id is null then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;

  select coalesce(auto_match, true) into v_enabled from public.profiles where id = v_user;
  if v_enabled is not true then
    delete from public.study_presence where user_id = v_user;
    return null;
  end if;

  if public.in_live_session(v_user) then
    delete from public.study_presence where user_id = v_user;
    return public.get_my_match_offer();
  end if;

  select exam_id into v_exam from public.subjects where id = p_subject_id;
  if v_exam is null then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;

  insert into public.study_presence (user_id, subject_id, exam_id, heartbeat_at)
  values (v_user, p_subject_id, v_exam, now())
  on conflict (user_id) do update
    set subject_id = excluded.subject_id,
        exam_id = excluded.exam_id,
        heartbeat_at = excluded.heartbeat_at;

  update public.study_match_offers
  set status = 'expired'
  where status = 'pending' and expires_at < now();

  select * into v_offer
  from public.study_match_offers
  where status = 'pending'
    and (user_a = v_user or user_b = v_user)
  order by created_at desc
  limit 1;
  if found then
    return public.offer_json(v_offer, v_user);
  end if;

  perform pg_advisory_xact_lock(hashtext(p_subject_id::text));

  select p.user_id into v_other
  from public.study_presence p
  join public.profiles pr on pr.id = p.user_id
  where p.subject_id = p_subject_id
    and p.user_id <> v_user
    and p.heartbeat_at > now() - interval '25 seconds'
    and coalesce(pr.auto_match, true) = true
    and not public.in_live_session(p.user_id)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = v_user and b.blocked_id = p.user_id)
         or (b.blocker_id = p.user_id and b.blocked_id = v_user)
    )
    and not exists (
      select 1 from public.study_match_offers o
      where o.created_at > now() - interval '30 minutes'
        and o.status in ('declined', 'expired')
        and ((o.user_a = least(v_user, p.user_id) and o.user_b = greatest(v_user, p.user_id)))
    )
    and not exists (
      select 1 from public.study_match_offers o
      where o.status = 'pending'
        and (o.user_a = p.user_id or o.user_b = p.user_id)
    )
  order by p.heartbeat_at asc
  limit 1;

  if v_other is null then
    return null;
  end if;

  v_a := least(v_user, v_other);
  v_b := greatest(v_user, v_other);

  insert into public.study_match_offers (user_a, user_b, subject_id)
  values (v_a, v_b, p_subject_id)
  returning * into v_offer;

  select display_name into v_name from public.profiles where id = v_user;
  select name into v_subject from public.subjects where id = p_subject_id;
  perform public.notify_user(v_other, 'study_offer', jsonb_build_object(
    'offer_id', v_offer.id,
    'from_name', coalesce(v_name, 'Öğrenci'),
    'subject_name', coalesce(v_subject, 'Ders')
  ));
  select display_name into v_name from public.profiles where id = v_other;
  perform public.notify_user(v_user, 'study_offer', jsonb_build_object(
    'offer_id', v_offer.id,
    'from_name', coalesce(v_name, 'Öğrenci'),
    'subject_name', coalesce(v_subject, 'Ders')
  ));

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
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select * into v_offer from public.study_match_offers where id = p_offer_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_offer.user_a <> v_user and v_offer.user_b <> v_user then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_offer.status = 'matched' and v_offer.session_id is not null then
    return public.offer_json(v_offer, v_user);
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at < now() then
    update public.study_match_offers set status = 'expired' where id = p_offer_id and status = 'pending';
    raise exception 'EXPIRED';
  end if;

  if not p_accept then
    update public.study_match_offers set status = 'declined' where id = p_offer_id;
    return null;
  end if;

  if v_offer.user_a = v_user then
    update public.study_match_offers set a_yes = true where id = p_offer_id;
  else
    update public.study_match_offers set b_yes = true where id = p_offer_id;
  end if;

  select a_yes, b_yes into v_a_yes, v_b_yes from public.study_match_offers where id = p_offer_id;
  if v_a_yes is true and v_b_yes is true then
    v_session := public.start_pair_session(v_offer.user_a, v_offer.user_b, v_offer.subject_id);
    update public.study_match_offers
    set status = 'matched', session_id = v_session
    where id = p_offer_id;
    select * into v_offer from public.study_match_offers where id = p_offer_id;
  else
    select * into v_offer from public.study_match_offers where id = p_offer_id;
  end if;

  return public.offer_json(v_offer, v_user);
end;
$$;

revoke all on function public.in_live_session(uuid) from public;
revoke all on function public.start_pair_session(uuid, uuid, uuid) from public;
revoke all on function public.start_pair_session(uuid, uuid, uuid) from authenticated;
do $$
begin
  revoke all on function public.offer_json(public.study_match_offers, uuid) from public;
exception when undefined_function then null;
end $$;
revoke all on function public.heartbeat_study(uuid) from public;
revoke all on function public.leave_presence() from public;
revoke all on function public.get_my_match_offer() from public;
revoke all on function public.respond_match_offer(uuid, boolean) from public;
grant execute on function public.heartbeat_study(uuid) to authenticated;
grant execute on function public.leave_presence() to authenticated;
grant execute on function public.get_my_match_offer() to authenticated;
grant execute on function public.respond_match_offer(uuid, boolean) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.study_match_offers;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
