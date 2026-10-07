-- Timed statuses, likes/comments, exam groups, engagement bots.
-- Run contents in SQL Editor after 0007 and 0009.

create extension if not exists pgcrypto with schema extensions;

alter table public.profiles
  add column if not exists is_bot boolean not null default false;

alter table public.social_posts
  add column if not exists expires_at timestamptz,
  add column if not exists duration_minutes int;

alter table public.social_posts drop constraint if exists social_posts_kind_check;
alter table public.social_posts
  add constraint social_posts_kind_check
  check (kind in ('ask', 'status', 'activity', 'exam_lobby'));

create table if not exists public.post_likes (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post_idx on public.post_comments (post_id, created_at);

create table if not exists public.exam_chat_groups (
  slug text primary key,
  name text not null
);

insert into public.exam_chat_groups (slug, name) values
  ('tyt', 'TYT'),
  ('ayt', 'AYT'),
  ('kpss', 'KPSS')
on conflict (slug) do nothing;

create table if not exists public.exam_chat_members (
  slug text not null references public.exam_chat_groups(slug) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (slug, user_id)
);

create table if not exists public.exam_chat_messages (
  id uuid primary key default gen_random_uuid(),
  slug text not null references public.exam_chat_groups(slug) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists exam_chat_messages_idx on public.exam_chat_messages (slug, created_at desc);

create table if not exists public.bot_clock (
  id int primary key default 1 check (id = 1),
  last_pulse_at timestamptz
);

insert into public.bot_clock (id, last_pulse_at) values (1, now() - interval '1 hour')
on conflict (id) do nothing;

alter table public.bot_clock enable row level security;

alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.exam_chat_groups enable row level security;
alter table public.exam_chat_members enable row level security;
alter table public.exam_chat_messages enable row level security;

drop policy if exists post_likes_read on public.post_likes;
create policy post_likes_read on public.post_likes for select to authenticated using (true);
drop policy if exists post_likes_own on public.post_likes;
create policy post_likes_own on public.post_likes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists post_comments_read on public.post_comments;
create policy post_comments_read on public.post_comments for select to authenticated using (true);
drop policy if exists post_comments_insert on public.post_comments;
create policy post_comments_insert on public.post_comments
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists exam_groups_read on public.exam_chat_groups;
create policy exam_groups_read on public.exam_chat_groups for select to authenticated using (true);
drop policy if exists exam_members_read on public.exam_chat_members;
create policy exam_members_read on public.exam_chat_members for select to authenticated using (true);
drop policy if exists exam_members_own on public.exam_chat_members;
create policy exam_members_own on public.exam_chat_members
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists exam_messages_read on public.exam_chat_messages;
create policy exam_messages_read on public.exam_chat_messages
  for select to authenticated using (
    exists (select 1 from public.exam_chat_members m where m.slug = exam_chat_messages.slug and m.user_id = auth.uid())
  );
drop policy if exists exam_messages_insert on public.exam_chat_messages;
create policy exam_messages_insert on public.exam_chat_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (select 1 from public.exam_chat_members m where m.slug = exam_chat_messages.slug and m.user_id = auth.uid())
  );

create or replace function public.block_bot_invites()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.profiles where id = new.to_user and is_bot) then
    raise exception 'BOT_NO_STUDY';
  end if;
  return new;
end;
$$;

drop trigger if exists study_invites_no_bots on public.study_invites;
create trigger study_invites_no_bots
before insert on public.study_invites
for each row execute procedure public.block_bot_invites();

create or replace function public.seed_kocum_bots()
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  r record;
  v_id uuid;
  v_hash text;
begin
  for r in
    select * from (values
      ('a1111111-1111-4111-8111-111111111111'::uuid, 'bot.elif@kocum.internal', 'Elif'),
      ('a2222222-2222-4222-8222-222222222222'::uuid, 'bot.mert@kocum.internal', 'Mert'),
      ('a3333333-3333-4333-8333-333333333333'::uuid, 'bot.ayse@kocum.internal', 'Ayşe'),
      ('a4444444-4444-4444-8444-444444444444'::uuid, 'bot.can@kocum.internal', 'Can'),
      ('a5555555-5555-4555-8555-555555555555'::uuid, 'bot.zeynep@kocum.internal', 'Zeynep'),
      ('a6666666-6666-4666-8666-666666666666'::uuid, 'bot.emre@kocum.internal', 'Emre'),
      ('a7777777-7777-4777-8777-777777777777'::uuid, 'bot.defne@kocum.internal', 'Defne'),
      ('a8888888-8888-4888-8888-888888888888'::uuid, 'bot.kaan@kocum.internal', 'Kaan'),
      ('a9999999-9999-4999-8999-999999999999'::uuid, 'bot.selin@kocum.internal', 'Selin'),
      ('abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'bot.burak@kocum.internal', 'Burak')
    ) as t(id, email, name)
  loop
    v_id := r.id;
    if not exists (select 1 from auth.users where id = v_id) then
      v_hash := crypt(md5(v_id::text || clock_timestamp()::text), gen_salt('bf'));
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_id,
        'authenticated',
        'authenticated',
        r.email,
        v_hash,
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', r.name),
        now(),
        now(),
        '', '', '', ''
      );
    end if;
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', r.email), 'email', v_id::text, now(), now(), now()
    where not exists (select 1 from auth.identities where user_id = v_id and provider = 'email');
    insert into public.profiles (id, display_name, is_bot, onboarding_completed_at)
    values (v_id, r.name, true, now())
    on conflict (id) do update
      set is_bot = true,
          display_name = excluded.display_name,
          onboarding_completed_at = coalesce(public.profiles.onboarding_completed_at, now());
  end loop;
end;
$$;

select public.seed_kocum_bots();

create or replace function public.publish_status(p_body text, p_subject_id uuid, p_minutes int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.profiles where id = v_user and is_bot) then
    raise exception 'UNAUTHORIZED';
  end if;
  if length(trim(p_body)) < 2 then raise exception 'EMPTY_MESSAGE'; end if;
  if p_minutes not in (30, 60, 120, 240) then raise exception 'INVALID_DURATION'; end if;
  insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at)
  values (v_user, trim(p_body), 'status', p_subject_id, p_minutes, now() + make_interval(mins => p_minutes))
  returning id into v_id;
  return v_id;
end;
$$;

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
  if exists (select 1 from public.profiles where id = p_other and is_bot) then
    raise exception 'BOT_NO_DM';
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
  select * into v_conv from public.dm_conversations where user_a = v_a and user_b = v_b;
  if not found then
    insert into public.dm_conversations (user_a, user_b, initiated_by)
    values (v_a, v_b, v_user) returning * into v_conv;
  else
    if v_conv.accepted_at is null and v_conv.initiated_by = v_user then
      select count(*) into v_count from public.dm_messages where conversation_id = v_conv.id;
      if v_count >= 1 then raise exception 'WAIT_ACCEPT'; end if;
    end if;
  end if;
  insert into public.dm_messages (conversation_id, sender_id, body)
  values (v_conv.id, v_user, trim(p_body));
  if v_conv.accepted_at is null and v_conv.initiated_by <> v_user then
    update public.dm_conversations set accepted_at = now() where id = v_conv.id;
  end if;
  return v_conv.id;
end;
$$;

create or replace function public.join_exam_group(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_slug not in ('tyt', 'ayt', 'kpss') then raise exception 'NOT_FOUND'; end if;
  insert into public.exam_chat_members (slug, user_id) values (p_slug, v_user)
  on conflict do nothing;
end;
$$;

create or replace function public.send_group_message(p_slug text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_last timestamptz;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if length(trim(p_body)) < 1 then raise exception 'EMPTY_MESSAGE'; end if;
  if not exists (select 1 from public.exam_chat_members where slug = p_slug and user_id = v_user) then
    raise exception 'UNAUTHORIZED';
  end if;
  select max(created_at) into v_last from public.exam_chat_messages where slug = p_slug and sender_id = v_user;
  if v_last is not null and v_last > now() - interval '10 seconds' then
    raise exception 'SLOW_MODE';
  end if;
  insert into public.exam_chat_messages (slug, sender_id, body)
  values (p_slug, v_user, trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.toggle_post_like(p_post uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.post_likes where post_id = p_post and user_id = v_user) then
    delete from public.post_likes where post_id = p_post and user_id = v_user;
    return false;
  end if;
  insert into public.post_likes (post_id, user_id) values (p_post, v_user);
  return true;
end;
$$;

create or replace function public.add_post_comment(p_post uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if length(trim(p_body)) < 1 then raise exception 'EMPTY_MESSAGE'; end if;
  insert into public.post_comments (post_id, user_id, body)
  values (p_post, v_user, trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_social_feed()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x))
    from (
      select
        p.id,
        p.user_id,
        p.body,
        p.kind,
        p.created_at,
        p.subject_id,
        p.session_id,
        p.capacity,
        p.duration_minutes,
        p.expires_at,
        a.display_name,
        a.current_xp,
        (select count(*) from public.post_likes l where l.post_id = p.id)::int as like_count,
        (select count(*) from public.post_comments c where c.post_id = p.id)::int as comment_count,
        exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = v_user) as liked_by_me
      from public.social_posts p
      join public.profiles a on a.id = p.user_id
      where (p.expires_at is null or p.expires_at > now())
        and not exists (
          select 1 from public.user_blocks b
          where b.blocker_id = v_user and b.blocked_id = p.user_id
        )
      order by (not a.is_bot) desc, p.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
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
      where s.mode in ('exam', 'race')
        and s.status in ('waiting', 'countdown')
      order by s.created_at desc
      limit 40
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_human_profiles(p_exam uuid, p_search text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x))
    from (
      select pr.id, pr.display_name, pr.current_xp, pr.exam_id, pr.exam_year, pr.target_score
      from public.profiles pr
      where pr.id <> v_user
        and not pr.is_bot
        and (
          (p_search is not null and length(trim(p_search)) >= 2 and pr.display_name ilike '%' || trim(p_search) || '%')
          or ((p_search is null or length(trim(p_search)) < 2) and (p_exam is null or pr.exam_id = p_exam))
        )
      order by pr.current_xp desc
      limit 20
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.bot_comment_for(p_body text)
returns text
language sql
immutable
as $$
  select case
    when p_body ilike '%cografya%' or p_body ilike '%coğrafya%' then 'Ben de haritaya bakıyorum, birazdan odaya geçerim.'
    when p_body ilike '%tarih%' then 'Tarihte aynı yerdeyim, birlikte çözelim.'
    when p_body ilike '%matematik%' or p_body ilike '%mat%' then 'Bu konudaki soruları birlikte bitirebiliriz.'
    when p_body ilike '%turkce%' or p_body ilike '%türkçe%' or p_body ilike '%paragraf%' then 'Paragraf setine bakıyorum, sen de yazarsan gelirim.'
    when p_body ilike '%calis%' or p_body ilike '%çalış%' then 'Aynı dakikadayım, 30 dk tempo iyi olur.'
    when p_body ilike '%mola%' then 'Kısa mola, sonra 20 soru.'
    else 'Katılıyorum, bu tempoyla devam.'
  end;
$$;

create or replace function public.bot_should_miss(p_session uuid, p_bot uuid, p_index int, p_total int)
returns boolean
language plpgsql
stable
as $$
declare
  v_miss int;
  v_h int;
  v_total int := greatest(p_total, 1);
begin
  v_miss := 4 + abs(hashtext(p_session::text || p_bot::text)) % 3;
  v_miss := least(v_miss, greatest(v_total - 1, 1));
  v_h := abs(hashtext(p_session::text || p_bot::text || p_index::text));
  return (v_h % v_total) < v_miss;
end;
$$;

create or replace function public.pulse_bots()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_bot uuid;
  v_human uuid;
  v_post uuid;
  v_body text;
  v_sub uuid;
  v_mins int;
  v_prompt text;
  v_session uuid;
  v_qid uuid;
  v_correct text;
  v_pick text;
  v_sess public.study_sessions%rowtype;
  v_slug text;
begin
  select last_pulse_at into v_last from public.bot_clock where id = 1;
  if v_last is not null and v_last > now() - interval '90 seconds' then
    return;
  end if;
  update public.bot_clock set last_pulse_at = now() where id = 1;

  if random() < 0.55 then
    select id into v_bot from public.profiles where is_bot order by random() limit 1;
    if v_bot is not null then
      v_mins := (array[30, 60, 120, 240])[1 + floor(random() * 4)::int];
      v_prompt := (array[
        'Coğrafya çalışacak var mı?',
        'Tarihte neredesiniz?',
        'Bugün 40 soru hedefim',
        'Matematik setine bakıyorum',
        'Kısa mola, sonra devam',
        'Paragraf çözüyorum'
      ])[1 + floor(random() * 6)::int];
      select s.id into v_sub from public.subjects s order by random() limit 1;
      insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at)
      values (v_bot, v_prompt, 'status', v_sub, v_mins, now() + make_interval(mins => v_mins));
    end if;
  end if;

  for v_post, v_body, v_human in
    select p.id, p.body, p.user_id
    from public.social_posts p
    join public.profiles a on a.id = p.user_id
    where (p.expires_at is null or p.expires_at > now())
      and p.kind in ('status', 'ask', 'activity')
      and not a.is_bot
    order by p.created_at desc
    limit 3
  loop
    for v_bot in
      select id from public.profiles where is_bot and id <> v_human order by random() limit (2 + floor(random() * 2)::int)
    loop
      insert into public.post_likes (post_id, user_id) values (v_post, v_bot) on conflict do nothing;
      if random() < 0.7 and not exists (
        select 1 from public.post_comments c where c.post_id = v_post and c.user_id = v_bot
      ) then
        insert into public.post_comments (post_id, user_id, body)
        values (v_post, v_bot, public.bot_comment_for(v_body));
      end if;
    end loop;
  end loop;

  select p.id, p.body into v_post, v_body
  from public.social_posts p
  join public.profiles a on a.id = p.user_id
  where a.is_bot and (p.expires_at is null or p.expires_at > now()) and p.kind = 'status'
  order by random() limit 1;
  if v_post is not null then
    select id into v_bot from public.profiles where is_bot order by random() limit 1;
    if v_bot is not null then
      insert into public.post_likes (post_id, user_id) values (v_post, v_bot) on conflict do nothing;
      insert into public.post_comments (post_id, user_id, body)
      select v_post, v_bot, public.bot_comment_for(v_body)
      where not exists (select 1 from public.post_comments c where c.post_id = v_post and c.user_id = v_bot);
    end if;
  end if;

  select s.id into v_session
  from public.study_sessions s
  where s.mode = 'exam' and s.status = 'waiting'
    and (select count(*) from public.study_session_members m where m.session_id = s.id) < s.capacity
  order by random() limit 1;
  if v_session is not null then
    select id into v_bot from public.profiles where is_bot
      and not exists (select 1 from public.study_session_members m where m.session_id = v_session and m.user_id = profiles.id)
    order by random() limit 1;
    if v_bot is not null then
      insert into public.study_session_members (session_id, user_id) values (v_session, v_bot) on conflict do nothing;
    end if;
  end if;

  for v_sess in
    select * from public.study_sessions where mode in ('race', 'exam') and status = 'active'
  loop
    perform public.maybe_activate_session(v_sess.id);
    v_qid := v_sess.question_ids[v_sess.current_index + 1];
    if v_qid is null then continue; end if;
    select correct_choice into v_correct from public.questions where id = v_qid;
    for v_bot in
      select m.user_id from public.study_session_members m
      join public.profiles p on p.id = m.user_id
      where m.session_id = v_sess.id and p.is_bot
        and not exists (
          select 1 from public.study_session_answers a
          where a.session_id = v_sess.id and a.question_id = v_qid and a.user_id = m.user_id
        )
    loop
      if public.bot_should_miss(v_sess.id, v_bot, v_sess.current_index, coalesce(array_length(v_sess.question_ids, 1), 10)) then
        if random() < 0.45 then
          continue;
        end if;
        v_pick := case upper(coalesce(v_correct, 'A'))
          when 'A' then 'C'
          when 'B' then 'D'
          when 'C' then 'A'
          when 'D' then 'B'
          else 'A'
        end;
      else
        v_pick := upper(coalesce(v_correct, 'A'));
      end if;
      insert into public.study_session_answers (session_id, question_id, user_id, selected_choice, is_correct)
      values (v_sess.id, v_qid, v_bot, v_pick, upper(v_pick) = upper(coalesce(v_correct, '')))
      on conflict do nothing;
    end loop;
    perform public.advance_competitive(v_sess.id);
  end loop;

  if random() < 0.4 then
    select id into v_bot from public.profiles where is_bot order by random() limit 1;
    v_slug := (array['tyt','ayt','kpss'])[1 + floor(random()*3)::int];
    if v_bot is not null then
      insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
      insert into public.exam_chat_messages (slug, sender_id, body)
      values (
        v_slug,
        v_bot,
        (array['Bugün 30 soru hedefim.','Kim coğrafya odası açtı?','Matematik seti nasıl gidiyor?','Birazdan denemeye bakacağım.'])[1 + floor(random()*4)::int]
      );
    end if;
  end if;
end;
$$;

revoke all on function public.publish_status(text, uuid, int) from public;
revoke all on function public.join_exam_group(text) from public;
revoke all on function public.send_group_message(text, text) from public;
revoke all on function public.pulse_bots() from public;
revoke all on function public.toggle_post_like(uuid) from public;
revoke all on function public.add_post_comment(uuid, text) from public;
revoke all on function public.get_social_feed() from public;
revoke all on function public.list_open_rooms() from public;
revoke all on function public.list_human_profiles(uuid, text) from public;

grant execute on function public.publish_status(text, uuid, int) to authenticated;
grant execute on function public.join_exam_group(text) to authenticated;
grant execute on function public.send_group_message(text, text) to authenticated;
grant execute on function public.pulse_bots() to authenticated;
grant execute on function public.send_dm(uuid, text) to authenticated;
grant execute on function public.toggle_post_like(uuid) to authenticated;
grant execute on function public.add_post_comment(uuid, text) to authenticated;
grant execute on function public.get_social_feed() to authenticated;
grant execute on function public.list_open_rooms() to authenticated;
grant execute on function public.list_human_profiles(uuid, text) to authenticated;

notify pgrst, 'reload schema';
