-- Exam sessions (official calendar) + social feed/DMs.
-- Run contents in SQL Editor. Do not paste the file path.

alter table public.profiles
  add column if not exists exam_year int;

create table if not exists public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  session_year int not null,
  exam_date date,
  label text not null,
  unique (exam_id, session_year)
);

alter table public.exam_sessions enable row level security;
drop policy if exists exam_sessions_read on public.exam_sessions;
create policy exam_sessions_read on public.exam_sessions for select to authenticated using (true);

insert into public.exam_sessions (exam_id, session_year, exam_date, label)
select e.id, s.year, s.exam_date, s.label
from public.exams e
join (
  values
    ('tyt', 2027, null::date, 'TYT 2027'),
    ('tyt', 2028, null::date, 'TYT 2028'),
    ('ayt', 2027, null::date, 'AYT 2027'),
    ('ayt', 2028, null::date, 'AYT 2028'),
    ('tyt_ayt', 2027, null::date, 'YKS 2027'),
    ('tyt_ayt', 2028, null::date, 'YKS 2028'),
    ('kpss_lisans', 2027, null::date, 'KPSS Lisans 2027'),
    ('kpss_lisans', 2028, null::date, 'KPSS Lisans 2028'),
    ('kpss_onlisans', 2028, null::date, 'KPSS Önlisans 2028')
) as s(slug, year, exam_date, label) on s.slug = e.slug
on conflict (exam_id, session_year) do update
  set exam_date = excluded.exam_date,
      label = excluded.label;

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  kind text not null default 'ask' check (kind in ('ask', 'status', 'activity')),
  created_at timestamptz not null default now()
);

create index if not exists social_posts_created_idx on public.social_posts (created_at desc);

alter table public.social_posts enable row level security;
drop policy if exists social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select to authenticated using (true);
drop policy if exists social_posts_insert_own on public.social_posts;
create policy social_posts_insert_own on public.social_posts
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists social_posts_delete_own on public.social_posts;
create policy social_posts_delete_own on public.social_posts
  for delete to authenticated using (user_id = auth.uid());

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;
drop policy if exists user_blocks_own on public.user_blocks;
create policy user_blocks_own on public.user_blocks
  for all to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

create table if not exists public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  initiated_by uuid not null references public.profiles(id) on delete cascade,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists dm_messages_conv_idx on public.dm_messages (conversation_id, created_at);

alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;

drop policy if exists dm_conversations_own on public.dm_conversations;
create policy dm_conversations_own on public.dm_conversations
  for select to authenticated
  using (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists dm_messages_own on public.dm_messages;
create policy dm_messages_own on public.dm_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.dm_conversations c
      where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

create or replace function public.send_dm(p_other uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_conv public.dm_conversations%rowtype;
  v_count int;
begin
  if v_user is null or p_other is null or v_user = p_other then
    raise exception 'INVALID_DM';
  end if;
  if length(trim(p_body)) < 1 then
    raise exception 'EMPTY_MESSAGE';
  end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_user and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = v_user)
  ) then
    raise exception 'BLOCKED';
  end if;

  v_a := least(v_user, p_other);
  v_b := greatest(v_user, p_other);

  select * into v_conv
  from public.dm_conversations
  where user_a = v_a and user_b = v_b;

  if not found then
    insert into public.dm_conversations (user_a, user_b, initiated_by)
    values (v_a, v_b, v_user)
    returning * into v_conv;
  else
    if v_conv.accepted_at is null and v_conv.initiated_by = v_user then
      select count(*) into v_count from public.dm_messages where conversation_id = v_conv.id;
      if v_count >= 1 then
        raise exception 'WAIT_ACCEPT';
      end if;
    end if;
  end if;

  insert into public.dm_messages (conversation_id, sender_id, body)
  values (v_conv.id, v_user, trim(p_body));

  -- Karşı taraf ilk mesaja cevap yazarsa konuşma açılmış sayılır.
  if v_conv.accepted_at is null and v_conv.initiated_by <> v_user then
    update public.dm_conversations set accepted_at = now() where id = v_conv.id;
  end if;

  return v_conv.id;
end;
$$;

create or replace function public.accept_dm(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_conv public.dm_conversations%rowtype;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  select * into v_conv from public.dm_conversations where id = p_conversation_id;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_conv.user_a <> v_user and v_conv.user_b <> v_user then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_conv.initiated_by = v_user then
    raise exception 'CANNOT_ACCEPT_OWN';
  end if;
  update public.dm_conversations set accepted_at = now() where id = p_conversation_id and accepted_at is null;
end;
$$;

drop function if exists public.save_onboarding(uuid, date, int, numeric, numeric, numeric, numeric, uuid[], uuid[]);

create or replace function public.save_onboarding(
  p_exam_id uuid,
  p_exam_date date,
  p_daily_minutes int,
  p_target_score numeric,
  p_target_tyt_net numeric,
  p_target_ayt_net numeric,
  p_target_kpss_score numeric,
  p_strong uuid[],
  p_weak uuid[],
  p_exam_year int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_daily_minutes < 20 or p_daily_minutes > 360 then
    raise exception 'INVALID_MINUTES';
  end if;

  if p_exam_date is not null and p_exam_date < (timezone('Europe/Istanbul', now()))::date then
    raise exception 'INVALID_EXAM_DATE';
  end if;

  if not exists (select 1 from public.exams where id = p_exam_id) then
    raise exception 'EXAM_NOT_FOUND';
  end if;

  update public.profiles
  set exam_id = p_exam_id,
      exam_date = p_exam_date,
      exam_year = coalesce(p_exam_year, extract(year from p_exam_date)::int),
      daily_minutes = p_daily_minutes,
      target_score = p_target_score,
      onboarding_completed_at = now()
  where id = v_user;

  insert into public.user_exam_settings (
    user_id, exam_id, target_tyt_net, target_ayt_net, target_kpss_score,
    perceived_strong_subject_ids, perceived_weak_subject_ids
  )
  values (
    v_user, p_exam_id, p_target_tyt_net, p_target_ayt_net, p_target_kpss_score,
    coalesce(p_strong, '{}'), coalesce(p_weak, '{}')
  )
  on conflict (user_id) do update
    set exam_id = excluded.exam_id,
        target_tyt_net = excluded.target_tyt_net,
        target_ayt_net = excluded.target_ayt_net,
        target_kpss_score = excluded.target_kpss_score,
        perceived_strong_subject_ids = excluded.perceived_strong_subject_ids,
        perceived_weak_subject_ids = excluded.perceived_weak_subject_ids;

  perform public.generate_today_plan();
end;
$$;

create or replace function public.request_friend(p_other uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.friendships%rowtype;
begin
  if v_user is null or p_other is null or v_user = p_other then
    raise exception 'INVALID_FRIEND';
  end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_user and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = v_user)
  ) then
    raise exception 'BLOCKED';
  end if;

  select * into v_existing
  from public.friendships
  where (requester_id = v_user and addressee_id = p_other)
     or (requester_id = p_other and addressee_id = v_user);

  if found then
    if v_existing.status = 'accepted' then
      return 'accepted';
    end if;
    if v_existing.status = 'blocked' then
      raise exception 'BLOCKED';
    end if;
    if v_existing.addressee_id = v_user then
      update public.friendships set status = 'accepted' where id = v_existing.id;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (v_user, p_other, 'pending');
  return 'pending';
end;
$$;

create or replace function public.respond_friend(p_other uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;
  if p_accept then
    update public.friendships
    set status = 'accepted'
    where addressee_id = v_user and requester_id = p_other and status = 'pending';
  else
    delete from public.friendships
    where addressee_id = v_user and requester_id = p_other and status = 'pending';
  end if;
end;
$$;

create or replace function public.block_user(p_other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_other is null or v_user = p_other then
    raise exception 'INVALID_BLOCK';
  end if;
  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_user, p_other)
  on conflict do nothing;
  delete from public.friendships
  where (requester_id = v_user and addressee_id = p_other)
     or (requester_id = p_other and addressee_id = v_user);
end;
$$;

revoke all on function public.send_dm(uuid, text) from public;
revoke all on function public.accept_dm(uuid) from public;
revoke all on function public.request_friend(uuid) from public;
revoke all on function public.respond_friend(uuid, boolean) from public;
revoke all on function public.block_user(uuid) from public;
revoke all on function public.save_onboarding(uuid, date, int, numeric, numeric, numeric, numeric, uuid[], uuid[], int) from public;
grant execute on function public.send_dm(uuid, text) to authenticated;
grant execute on function public.accept_dm(uuid) to authenticated;
grant execute on function public.request_friend(uuid) to authenticated;
grant execute on function public.respond_friend(uuid, boolean) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.save_onboarding(uuid, date, int, numeric, numeric, numeric, numeric, uuid[], uuid[], int) to authenticated;

notify pgrst, 'reload schema';
