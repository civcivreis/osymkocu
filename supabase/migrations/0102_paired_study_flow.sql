-- Paired lesson study stream: events on existing session chat + answer lock.

alter table public.app_runtime_settings
  add column if not exists pair_match_enabled boolean not null default true,
  add column if not exists paired_question_wait_seconds int not null default 75,
  add column if not exists pair_reconnect_grace_seconds int not null default 75,
  add column if not exists pair_study_events_enabled boolean not null default true,
  add column if not exists pair_motivation_enabled boolean not null default true,
  add column if not exists pair_topic_share_enabled boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_runtime_settings_pair_wait_check'
  ) then
    alter table public.app_runtime_settings
      add constraint app_runtime_settings_pair_wait_check
      check (paired_question_wait_seconds between 30 and 180);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_runtime_settings_pair_grace_check'
  ) then
    alter table public.app_runtime_settings
      add constraint app_runtime_settings_pair_grace_check
      check (pair_reconnect_grace_seconds between 30 and 180);
  end if;
end $$;

alter table public.study_session_members
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists presence text not null default 'active';

alter table public.study_session_messages
  add column if not exists kind text not null default 'user_message',
  add column if not exists event_type text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.study_session_messages
  drop constraint if exists study_session_messages_kind_check;
alter table public.study_session_messages
  add constraint study_session_messages_kind_check
  check (kind in ('user_message', 'coach_message', 'study_event'));

alter table public.lesson_thread_messages
  drop constraint if exists lesson_thread_messages_kind_check;
alter table public.lesson_thread_messages
  add constraint lesson_thread_messages_kind_check
  check (kind in ('peer', 'coach', 'motivation', 'study_event', 'user_message', 'coach_message'));

create table if not exists public.study_pair_question_locks (
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  question_key text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  selected_choice text not null,
  is_correct boolean not null,
  submitted_at timestamptz not null default now(),
  primary key (session_id, question_key, user_id)
);

create index if not exists study_pair_locks_session_idx
  on public.study_pair_question_locks (session_id, question_key, submitted_at);

alter table public.study_pair_question_locks enable row level security;
drop policy if exists study_pair_locks_member on public.study_pair_question_locks;
create policy study_pair_locks_member on public.study_pair_question_locks
  for select to authenticated
  using (
    exists (
      select 1 from public.study_session_members m
      where m.session_id = study_pair_question_locks.session_id and m.user_id = auth.uid()
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.study_pair_question_locks;
exception when duplicate_object then null;
end $$;

create or replace function public.pair_first_name(p_user uuid)
returns text
language sql
stable
as $$
  select coalesce(nullif(split_part(trim(display_name), ' ', 1), ''), 'Arkadaşın')
  from public.profiles where id = p_user;
$$;

create or replace function public.post_study_event(
  p_session uuid,
  p_event text,
  p_body text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_on boolean;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.study_session_members where session_id = p_session and user_id = v_user) then
    raise exception 'NOT_IN_ROOM';
  end if;
  select pair_study_events_enabled into v_on from public.app_runtime_settings where id = 1;
  if v_on is false and p_event <> 'coach' then return null; end if;
  insert into public.study_session_messages (session_id, sender_id, body, kind, event_type, metadata)
  values (
    p_session,
    v_user,
    left(trim(p_body), 240),
    case when p_event = 'coach' then 'coach_message' else 'study_event' end,
    p_event,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.heartbeat_pair_session(p_session uuid, p_presence text default 'active')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  update public.study_session_members
  set last_seen_at = now(),
      presence = case when p_presence in ('active', 'break', 'away', 'left') then p_presence else 'active' end
  where session_id = p_session and user_id = v_user;
end;
$$;

create or replace function public.pair_member_status(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_grace int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select pair_reconnect_grace_seconds into v_grace from public.app_runtime_settings where id = 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'display_name', pr.display_name,
      'presence', m.presence,
      'last_seen_at', m.last_seen_at,
      'stale', m.last_seen_at < now() - make_interval(secs => greatest(15, coalesce(v_grace, 75) / 5)),
      'disconnected', m.presence = 'left' or m.last_seen_at < now() - make_interval(secs => coalesce(v_grace, 75))
    ))
    from public.study_session_members m
    join public.profiles pr on pr.id = m.user_id
    where m.session_id = p_session
  ), '[]'::jsonb);
end;
$$;

create or replace function public.submit_pair_answer(
  p_session uuid,
  p_question_key text,
  p_choice text,
  p_correct boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_my_name text;
  v_other_name text;
  v_count int;
  v_other_row public.study_pair_question_locks%rowtype;
  v_events boolean;
  v_motiv boolean;
  v_body text;
  v_both boolean;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if coalesce(p_question_key, '') = '' or coalesce(p_choice, '') = '' then raise exception 'INVALID_INPUT'; end if;
  if not exists (select 1 from public.study_session_members where session_id = p_session and user_id = v_user) then
    raise exception 'NOT_IN_ROOM';
  end if;
  if exists (
    select 1 from public.study_pair_question_locks
    where session_id = p_session and question_key = p_question_key and user_id = v_user
  ) then
    return public.pair_question_state(p_session, p_question_key);
  end if;

  insert into public.study_pair_question_locks (session_id, question_key, user_id, selected_choice, is_correct)
  values (p_session, p_question_key, v_user, left(p_choice, 8), coalesce(p_correct, false));

  select user_id into v_other
  from public.study_session_members
  where session_id = p_session and user_id <> v_user
  limit 1;
  v_my_name := public.pair_first_name(v_user);
  v_other_name := public.pair_first_name(v_other);
  select pair_study_events_enabled, pair_motivation_enabled
  into v_events, v_motiv
  from public.app_runtime_settings where id = 1;

  select count(*)::int into v_count
  from public.study_pair_question_locks
  where session_id = p_session and question_key = p_question_key;

  if v_events then
    perform public.post_study_event(p_session, 'answer_submitted', v_my_name || ' cevabını verdi ✓', jsonb_build_object('actor', v_user, 'question_key', p_question_key));
    if v_count < 2 and v_other is not null then
      perform public.post_study_event(p_session, 'waiting_partner', v_other_name || ' bekleniyor...', jsonb_build_object('waiting_for', v_other, 'question_key', p_question_key));
    end if;
  end if;

  if v_count >= 2 then
    select * into v_other_row
    from public.study_pair_question_locks
    where session_id = p_session and question_key = p_question_key and user_id = v_other;
    v_both := coalesce(p_correct, false) and coalesce(v_other_row.is_correct, false);
    if v_events then
      if v_both then
        v_body := case abs(hashtext(p_question_key)) % 4
          when 0 then 'Tebrikler 🎯 İkiniz de doğru cevapladınız.'
          when 1 then 'İkiniz de doğru 🎯'
          when 2 then 'Tam isabet.'
          else 'Güzel gidiyorsunuz.'
        end;
        if v_motiv is false then v_body := 'Tebrikler 🎯 İkiniz de doğru cevapladınız.'; end if;
        perform public.post_study_event(p_session, 'both_correct', v_body, jsonb_build_object('question_key', p_question_key));
      elsif coalesce(p_correct, false) and not coalesce(v_other_row.is_correct, false) then
        perform public.post_study_event(p_session, 'mixed_result', v_my_name || ' doğru cevapladı ✓', jsonb_build_object('correct_user', v_user, 'question_key', p_question_key));
        perform public.post_study_event(p_session, 'mixed_result', v_other_name || ' bu soruda küçük bir noktayı kaçırdı.', jsonb_build_object('wrong_user', v_other, 'question_key', p_question_key));
      elsif not coalesce(p_correct, false) and coalesce(v_other_row.is_correct, false) then
        perform public.post_study_event(p_session, 'mixed_result', v_other_name || ' doğru cevapladı ✓', jsonb_build_object('correct_user', v_other, 'question_key', p_question_key));
        perform public.post_study_event(p_session, 'mixed_result', v_my_name || ' bu soruda küçük bir noktayı kaçırdı.', jsonb_build_object('wrong_user', v_user, 'question_key', p_question_key));
      else
        v_body := 'Bu soru ikinizi de biraz zorladı. Kısa bir tekrar yapalım.';
        perform public.post_study_event(p_session, 'both_wrong', v_body, jsonb_build_object('question_key', p_question_key));
      end if;
      if not v_both and (coalesce(p_correct, false) or coalesce(v_other_row.is_correct, false)) then
        perform public.post_study_event(p_session, 'remediation', 'Arkadaşın kısa tekrar yapıyor.', jsonb_build_object('question_key', p_question_key));
        perform public.post_study_event(p_session, 'remediation', 'Birazdan birlikte devam edeceksiniz.', jsonb_build_object('question_key', p_question_key));
      end if;
    end if;
  end if;

  return public.pair_question_state(p_session, p_question_key);
end;
$$;

create or replace function public.pair_question_state(p_session uuid, p_question_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_wait int;
  v_mine public.study_pair_question_locks%rowtype;
  v_other public.study_pair_question_locks%rowtype;
  v_other_id uuid;
  v_count int;
  v_revealed boolean;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.study_session_members where session_id = p_session and user_id = v_user) then
    raise exception 'NOT_IN_ROOM';
  end if;
  select paired_question_wait_seconds into v_wait from public.app_runtime_settings where id = 1;
  select user_id into v_other_id from public.study_session_members where session_id = p_session and user_id <> v_user limit 1;
  select * into v_mine from public.study_pair_question_locks
    where session_id = p_session and question_key = p_question_key and user_id = v_user;
  select * into v_other from public.study_pair_question_locks
    where session_id = p_session and question_key = p_question_key and user_id = v_other_id;
  select count(*)::int into v_count
    from public.study_pair_question_locks
    where session_id = p_session and question_key = p_question_key;
  v_revealed := v_count >= 2;

  return jsonb_build_object(
    'question_key', p_question_key,
    'locked', v_mine.user_id is not null,
    'waiting', v_mine.user_id is not null and not v_revealed,
    'revealed', v_revealed,
    'mine_correct', case when v_mine.user_id is not null then v_mine.is_correct else null end,
    'other_correct', case when v_revealed then v_other.is_correct else null end,
    'other_choice', case when v_revealed then v_other.selected_choice else null end,
    'submitted_at', v_mine.submitted_at,
    'wait_seconds', coalesce(v_wait, 75),
    'both_correct', v_revealed and coalesce(v_mine.is_correct, false) and coalesce(v_other.is_correct, false),
    'partner_id', v_other_id
  );
end;
$$;

create or replace function public.admin_set_pair_study_settings(
  p_match_enabled boolean default null,
  p_search_seconds int default null,
  p_wait_seconds int default null,
  p_grace_seconds int default null,
  p_events boolean default null,
  p_motivation boolean default null,
  p_topic_share boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.app_runtime_settings
  set pair_match_enabled = coalesce(p_match_enabled, pair_match_enabled),
      match_search_seconds = coalesce(p_search_seconds, match_search_seconds),
      paired_question_wait_seconds = coalesce(p_wait_seconds, paired_question_wait_seconds),
      pair_reconnect_grace_seconds = coalesce(p_grace_seconds, pair_reconnect_grace_seconds),
      pair_study_events_enabled = coalesce(p_events, pair_study_events_enabled),
      pair_motivation_enabled = coalesce(p_motivation, pair_motivation_enabled),
      pair_topic_share_enabled = coalesce(p_topic_share, pair_topic_share_enabled),
      updated_at = now()
  where id = 1;
  return (select to_jsonb(s) from public.app_runtime_settings s where id = 1);
end;
$$;

create or replace function public.leave_pair_study(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.study_session_members where session_id = p_session and user_id = v_user) then
    return;
  end if;
  v_name := public.pair_first_name(v_user);
  perform public.post_study_event(p_session, 'left', v_name || ' çalışmadan ayrıldı.', jsonb_build_object('actor', v_user));
  update public.study_session_members
  set presence = 'left', last_seen_at = now()
  where session_id = p_session and user_id = v_user;
end;
$$;

create or replace function public.guard_pair_match_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.app_runtime_settings where id = 1 and pair_match_enabled is false) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists study_match_offers_pair_guard on public.study_match_offers;
create trigger study_match_offers_pair_guard
  before insert on public.study_match_offers
  for each row execute procedure public.guard_pair_match_insert();

grant execute on function public.post_study_event(uuid, text, text, jsonb) to authenticated;
grant execute on function public.heartbeat_pair_session(uuid, text) to authenticated;
grant execute on function public.pair_member_status(uuid) to authenticated;
grant execute on function public.submit_pair_answer(uuid, text, text, boolean) to authenticated;
grant execute on function public.pair_question_state(uuid, text) to authenticated;
grant execute on function public.admin_set_pair_study_settings(boolean, int, int, int, boolean, boolean, boolean) to authenticated;
grant execute on function public.leave_pair_study(uuid) to authenticated;

notify pgrst, 'reload schema';
