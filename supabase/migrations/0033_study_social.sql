-- Study match, notifications, pair sessions, bot seed. Paste after 0032.

alter table public.study_presence
  add column if not exists topic_id uuid references public.topics(id) on delete set null,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists is_available_for_match boolean not null default true,
  add column if not exists status text not null default 'studying'
    check (status in ('studying', 'matched', 'paused', 'offline'));

alter table public.study_match_offers
  add column if not exists topic_id uuid references public.topics(id) on delete set null;

alter table public.study_sessions
  add column if not exists pair_flow text not null default 'synced'
    check (pair_flow in ('synced', 'async')),
  add column if not exists topic_id uuid references public.topics(id) on delete set null;

alter table public.study_invites
  add column if not exists topic_id uuid references public.topics(id) on delete set null,
  add column if not exists responded_at timestamptz;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'study_invite', 'study_accepted', 'study_ended', 'study_offer',
    'study_match_found', 'study_match_accepted', 'study_match_declined',
    'study_request', 'study_request_accepted', 'study_request_declined',
    'race_invite', 'race_accepted', 'exam_lobby', 'exam_started',
    'room_kicked', 'room_invite', 'follow', 'new_follower',
    'post_like', 'post_comment', 'message', 'system',
    'system_exam_reminder', 'system_exam_live', 'admin_broadcast', 'account_warning'
  ));

create or replace function public.list_my_notifications()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id,
      'kind', n.kind,
      'payload', coalesce(n.payload, '{}'::jsonb),
      'read_at', n.read_at,
      'created_at', n.created_at
    ) order by n.created_at desc)
    from (
      select * from public.notifications
      where user_id = auth.uid()
      order by created_at desc
      limit 50
    ) n
  ), '[]'::jsonb);
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
  v_topic text;
begin
  v_other := case when p_offer.user_a = p_user then p_offer.user_b else p_offer.user_a end;
  select display_name into v_name from public.profiles where id = v_other;
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
    'status', p_offer.status,
    'session_id', p_offer.session_id,
    'expires_at', p_offer.expires_at,
    'my_yes', case when p_offer.user_a = p_user then p_offer.a_yes else p_offer.b_yes end
  );
end;
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
  if v_ids is null then v_ids := '{}'; end if;

  insert into public.study_sessions (subject_id, question_ids, status, starts_at, pair_flow)
  values (p_subject_id, v_ids, 'active', now(), 'async')
  returning id into v_session;

  insert into public.study_session_members (session_id, user_id)
  values (v_session, p_user_a), (v_session, p_user_b)
  on conflict do nothing;

  delete from public.study_presence where user_id in (p_user_a, p_user_b);

  select display_name into v_name_a from public.profiles where id = p_user_a;
  select display_name into v_name_b from public.profiles where id = p_user_b;
  select name into v_subject from public.subjects where id = p_subject_id;

  perform public.notify_user(p_user_a, 'study_match_accepted', jsonb_build_object(
    'session_id', v_session, 'from_name', coalesce(v_name_b, 'Öğrenci'),
    'from_user', p_user_b, 'subject_id', p_subject_id, 'subject_name', coalesce(v_subject, 'Ders')
  ));
  perform public.notify_user(p_user_b, 'study_match_accepted', jsonb_build_object(
    'session_id', v_session, 'from_name', coalesce(v_name_a, 'Öğrenci'),
    'from_user', p_user_a, 'subject_id', p_subject_id, 'subject_name', coalesce(v_subject, 'Ders')
  ));
  return v_session;
end;
$$;

drop function if exists public.heartbeat_study(uuid);
create or replace function public.heartbeat_study(p_subject_id uuid, p_topic_id uuid default null)
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
  v_topic text;
  v_me_bot boolean;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_subject_id is null then raise exception 'SUBJECT_NOT_FOUND'; end if;

  select coalesce(auto_match, true), coalesce(is_bot, false)
    into v_enabled, v_me_bot
  from public.profiles where id = v_user;
  if v_enabled is not true then
    delete from public.study_presence where user_id = v_user;
    return null;
  end if;
  if public.in_live_session(v_user) then
    delete from public.study_presence where user_id = v_user;
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
        heartbeat_at = excluded.heartbeat_at,
        last_seen_at = excluded.last_seen_at,
        is_available_for_match = true,
        status = 'studying';

  update public.study_presence
    set status = 'offline', is_available_for_match = false
    where heartbeat_at < now() - interval '45 seconds';

  update public.study_match_offers
    set status = 'expired'
    where status = 'pending' and expires_at < now();

  select * into v_offer from public.study_match_offers
  where status = 'pending' and (user_a = v_user or user_b = v_user)
  order by created_at desc limit 1;
  if found then return public.offer_json(v_offer, v_user); end if;

  perform pg_advisory_xact_lock(hashtext(p_subject_id::text));

  select p.user_id into v_other
  from public.study_presence p
  join public.profiles pr on pr.id = p.user_id
  where p.subject_id = p_subject_id
    and p.user_id <> v_user
    and p.is_available_for_match
    and p.status = 'studying'
    and p.heartbeat_at > now() - interval '45 seconds'
    and coalesce(pr.auto_match, true) = true
    and coalesce(pr.is_bot, false) = v_me_bot
    and not public.in_live_session(p.user_id)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = v_user and b.blocked_id = p.user_id)
         or (b.blocker_id = p.user_id and b.blocked_id = v_user)
    )
    and not exists (
      select 1 from public.study_match_offers o
      where o.created_at > now() - interval '6 hours'
        and o.status in ('declined', 'expired')
        and o.user_a = least(v_user, p.user_id)
        and o.user_b = greatest(v_user, p.user_id)
    )
    and not exists (
      select 1 from public.study_match_offers o
      where o.status = 'pending' and (o.user_a = p.user_id or o.user_b = p.user_id)
    )
  order by (p.topic_id is not distinct from p_topic_id) desc, p.heartbeat_at asc
  limit 1;

  if v_other is null then return null; end if;

  v_a := least(v_user, v_other);
  v_b := greatest(v_user, v_other);
  insert into public.study_match_offers (user_a, user_b, subject_id, topic_id, expires_at)
  values (v_a, v_b, p_subject_id, p_topic_id, now() + interval '3 minutes')
  returning * into v_offer;

  select name into v_subject from public.subjects where id = p_subject_id;
  select name into v_topic from public.topics where id = p_topic_id;
  select display_name into v_name from public.profiles where id = v_user;
  perform public.notify_user(v_other, 'study_match_found', jsonb_build_object(
    'offer_id', v_offer.id, 'from_name', coalesce(v_name, 'Öğrenci'), 'from_user', v_user,
    'subject_id', p_subject_id, 'subject_name', coalesce(v_subject, 'Ders'), 'topic_name', v_topic
  ));
  select display_name into v_name from public.profiles where id = v_other;
  perform public.notify_user(v_user, 'study_match_found', jsonb_build_object(
    'offer_id', v_offer.id, 'from_name', coalesce(v_name, 'Öğrenci'), 'from_user', v_other,
    'subject_id', p_subject_id, 'subject_name', coalesce(v_subject, 'Ders'), 'topic_name', v_topic
  ));
  return public.offer_json(v_offer, v_user);
end;
$$;

create or replace function public.system_exam_leaderboard(p_exam uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exam public.system_exams%rowtype;
  v_mine int;
  v_admin boolean := public.is_admin();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_exam from public.system_exams where id = p_exam;
  if not found or now() < v_exam.end_at then
    return jsonb_build_object('ready', false, 'top', '[]'::jsonb);
  end if;
  with ranked as (
    select
      a.user_id, p.display_name, p.display_tag, a.score,
      rank() over (
        order by a.score desc nulls last,
          extract(epoch from (a.submitted_at - a.started_at)) asc
      )::int as rank
    from public.system_exam_attempts a
    join public.profiles p on p.id = a.user_id
    where a.system_exam_id = p_exam
      and a.status in ('submitted', 'expired')
      and a.score is not null
      and (v_admin or coalesce(p.is_bot, false) = false)
  )
  select rank into v_mine from ranked where user_id = v_user;
  return jsonb_build_object(
    'ready', true,
    'mine', v_mine,
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank, 'display_name', r.display_name, 'display_tag', r.display_tag,
        'score', r.score, 'is_me', r.user_id = v_user
      ) order by r.rank)
      from ranked r where r.rank <= 100
    ), '[]'::jsonb),
    'nearby', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank, 'display_name', r.display_name, 'display_tag', r.display_tag,
        'score', r.score, 'is_me', r.user_id = v_user
      ) order by r.rank)
      from ranked r
      where v_mine is not null and r.rank between greatest(v_mine - 2, 1) and v_mine + 2
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.seed_kocum_bots()
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  i int;
  v_id uuid;
  v_hash text;
  v_name text;
  v_names text[] := array[
    'Elif','Mert','Ayşe','Can','Zeynep','Emre','Defne','Kaan','Selin','Burak',
    'Ece','Deniz','Berk','İrem','Yusuf','Melis','Arda','Naz','Baran','Sude',
    'Ege','Duru','Kerem','Ada','Alp','Nehir','Umut','Ceren','Onur','İlayda'
  ];
begin
  for i in 1..100 loop
    v_id := ('b0000000-0000-4000-8000-' || lpad(to_hex(i), 12, '0'))::uuid;
    v_name := v_names[1 + ((i - 1) % array_length(v_names, 1))] || i::text;
    if not exists (select 1 from auth.users where id = v_id) then
      v_hash := crypt(md5(v_id::text), gen_salt('bf'));
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        'bot' || i || '@kocum.internal', v_hash, now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', v_name), now(), now(), '', '', '', ''
      );
    end if;
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    select gen_random_uuid(), v_id, jsonb_build_object('sub', v_id::text, 'email', 'bot' || i || '@kocum.internal'),
      'email', v_id::text, now(), now(), now()
    where not exists (select 1 from auth.identities where user_id = v_id and provider = 'email');
    insert into public.profiles (id, display_name, is_bot, onboarding_completed_at, auto_match)
    values (v_id, v_name, true, now(), true)
    on conflict (id) do update set is_bot = true, onboarding_completed_at = coalesce(public.profiles.onboarding_completed_at, now());
  end loop;
end;
$$;

select public.seed_kocum_bots();

grant execute on function public.list_my_notifications() to authenticated;
grant execute on function public.heartbeat_study(uuid, uuid) to authenticated;
revoke all on function public.start_pair_session(uuid, uuid, uuid) from public, authenticated;

do $$
begin
  perform cron.schedule('kocum-bot-tick', '* * * * *', 'select public.pulse_bots()');
  perform cron.schedule('kocum-exam-chat-tick', '* * * * *', 'select public.pulse_exam_chats()');
exception when others then null;
end $$;

notify pgrst, 'reload schema';
