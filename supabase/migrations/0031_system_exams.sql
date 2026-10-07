-- System exams + admin roles. Paste after 0030. Europe/Istanbul evening slots only when publishing.

do $$ begin
  alter type public.xp_reason add value 'system_exam';
exception when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists app_role text not null default 'user'
    check (app_role in ('user', 'moderator', 'admin')),
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active', 'warned', 'restricted', 'banned')),
  add column if not exists restricted_until timestamptz,
  add column if not exists system_exam_reminders boolean not null default true;

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
  end if;
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and app_role = 'admin'
      and account_status <> 'banned'
  );
$$;

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return v_user;
end;
$$;

create or replace function public.bootstrap_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Uygulamadan çağrılmaz. Yalnızca bu e-posta admin olur; ilk giren admin olmaz.
  update public.profiles p
  set app_role = 'admin'
  from auth.users u
  where u.id = p.id
    and lower(u.email) = 'attutattutt@gmail.com';

  update public.profiles
  set app_role = 'user'
  where app_role = 'admin'
    and id not in (
      select id from auth.users where lower(email) = 'attutattutt@gmail.com'
    );

  return exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where lower(u.email) = 'attutattutt@gmail.com'
      and p.app_role = 'admin'
  );
end;
$$;

create or replace function public.write_admin_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_audit_logs (admin_user_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.system_exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  exam_type text not null check (exam_type in ('tyt', 'ayt', 'kpss')),
  description text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_minutes int not null check (duration_minutes between 10 and 300),
  question_count int not null default 0 check (question_count >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'live', 'finished', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create table if not exists public.system_exam_questions (
  system_exam_id uuid not null references public.system_exams(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  sort_order int not null default 0,
  primary key (system_exam_id, question_id)
);

create table if not exists public.system_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  system_exam_id uuid not null references public.system_exams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'expired')),
  current_question_index int not null default 0,
  client_id text,
  last_seen_at timestamptz not null default now(),
  total_correct int,
  total_wrong int,
  total_blank int,
  score numeric,
  rank int,
  unique (system_exam_id, user_id)
);

create table if not exists public.system_exam_answers (
  attempt_id uuid not null references public.system_exam_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_option text check (selected_option is null or selected_option in ('A', 'B', 'C', 'D', 'E')),
  answered_at timestamptz,
  marked_for_review boolean not null default false,
  primary key (attempt_id, question_id)
);

create table if not exists public.system_exam_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.system_exam_attempts(id) on delete cascade,
  kind text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.system_exam_signups (
  system_exam_id uuid not null references public.system_exams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (system_exam_id, user_id)
);

create table if not exists public.system_exam_reminder_sends (
  system_exam_id uuid not null references public.system_exams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot text not null check (slot in ('24h', '1h', '10m')),
  sent_at timestamptz not null default now(),
  primary key (system_exam_id, user_id, slot)
);

create index if not exists system_exams_start_idx on public.system_exams (start_at);
create index if not exists system_exam_attempts_exam_idx on public.system_exam_attempts (system_exam_id, status);
create index if not exists system_exam_events_attempt_idx on public.system_exam_events (attempt_id, created_at desc);

alter table public.system_exams enable row level security;
alter table public.system_exam_questions enable row level security;
alter table public.system_exam_attempts enable row level security;
alter table public.system_exam_answers enable row level security;
alter table public.system_exam_events enable row level security;
alter table public.system_exam_signups enable row level security;
alter table public.system_exam_reminder_sends enable row level security;
alter table public.admin_audit_logs enable row level security;

drop policy if exists system_exams_public_read on public.system_exams;
create policy system_exams_public_read on public.system_exams
  for select to authenticated
  using (status <> 'draft' or public.is_admin());

drop policy if exists system_exam_attempts_own on public.system_exam_attempts;
create policy system_exam_attempts_own on public.system_exam_attempts
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists system_exam_signups_own on public.system_exam_signups;
create policy system_exam_signups_own on public.system_exam_signups
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists admin_audit_admin_read on public.admin_audit_logs;
create policy admin_audit_admin_read on public.admin_audit_logs
  for select to authenticated
  using (public.is_admin());

alter table public.content_reports
  add column if not exists status text not null default 'open'
    check (status in ('open', 'dismissed', 'warned', 'restricted', 'banned')),
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'study_invite', 'study_accepted', 'study_ended', 'study_offer',
    'race_invite', 'race_accepted', 'exam_lobby', 'exam_started',
    'room_kicked', 'follow',
    'system_exam_reminder', 'admin_broadcast', 'account_warning'
  ));

create or replace function public.istanbul_exam_slot_ok(p_start timestamptz)
returns boolean
language sql
immutable
as $$
  select (
    extract(hour from timezone('Europe/Istanbul', p_start))::int in (20, 21)
    and extract(minute from timezone('Europe/Istanbul', p_start))::int in (0, 30)
  ) or (
    extract(hour from timezone('Europe/Istanbul', p_start))::int = 22
    and extract(minute from timezone('Europe/Istanbul', p_start))::int = 0
  );
$$;

create or replace function public.system_exam_derived_status(p_exam public.system_exams)
returns text
language plpgsql
stable
as $$
begin
  if p_exam.status in ('draft', 'cancelled') then
    return p_exam.status;
  end if;
  if now() < p_exam.start_at then return 'scheduled'; end if;
  if now() < p_exam.end_at then return 'live'; end if;
  return 'finished';
end;
$$;

create or replace function public.system_exam_remaining_seconds(p_attempt public.system_exam_attempts, p_exam public.system_exams)
returns int
language sql
stable
as $$
  select greatest(
    0,
    (p_exam.duration_minutes * 60) - floor(extract(epoch from (now() - p_attempt.started_at)))::int
  );
$$;

create or replace function public.list_system_exams(p_tab text default 'upcoming')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_tab text := coalesce(p_tab, 'upcoming');
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  perform public.sync_my_exam_reminders();
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.start_at)
    from (
      select
        e.id,
        e.title,
        e.exam_type,
        e.description,
        e.start_at,
        e.end_at,
        e.duration_minutes,
        e.question_count,
        public.system_exam_derived_status(e) as status,
        exists (
          select 1 from public.system_exam_signups s
          where s.system_exam_id = e.id and s.user_id = v_user
        ) as reminded,
        a.id as attempt_id,
        a.status as attempt_status,
        a.score,
        a.rank,
        a.total_correct,
        a.total_wrong,
        a.total_blank,
        (select count(*)::int from public.system_exam_signups s where s.system_exam_id = e.id) as signup_count,
        (
          select count(*)::int from public.system_exam_attempts t
          where t.system_exam_id = e.id and t.status = 'in_progress'
            and public.system_exam_remaining_seconds(t, e) > 0
        ) as live_count
      from public.system_exams e
      left join public.system_exam_attempts a
        on a.system_exam_id = e.id and a.user_id = v_user
      where e.status not in ('draft', 'cancelled')
        and (
          (v_tab = 'upcoming' and now() < e.start_at)
          or (v_tab = 'live' and now() >= e.start_at and now() < e.end_at)
          or (v_tab = 'past' and now() >= e.end_at)
        )
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.toggle_system_exam_signup(p_exam uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_on boolean;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.system_exam_signups where system_exam_id = p_exam and user_id = v_user) then
    delete from public.system_exam_signups where system_exam_id = p_exam and user_id = v_user;
    v_on := false;
  else
    insert into public.system_exam_signups (system_exam_id, user_id) values (p_exam, v_user);
    v_on := true;
  end if;
  return jsonb_build_object('reminded', v_on);
end;
$$;

create or replace function public.set_system_exam_reminders(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  update public.profiles set system_exam_reminders = coalesce(p_enabled, true) where id = auth.uid();
end;
$$;

create or replace function public.sync_my_exam_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r record;
  v_slot text;
  v_until interval;
begin
  if v_user is null then return; end if;
  if exists (select 1 from public.profiles where id = v_user and system_exam_reminders = false) then
    return;
  end if;
  for r in
    select e.*
    from public.system_exams e
    join public.system_exam_signups s on s.system_exam_id = e.id and s.user_id = v_user
    where e.status in ('scheduled', 'live')
      and e.start_at > now()
      and e.start_at <= now() + interval '24 hours'
  loop
    if r.start_at - now() <= interval '10 minutes' then
      v_slot := '10m';
    elsif r.start_at - now() <= interval '1 hour' then
      v_slot := '1h';
    else
      v_slot := '24h';
    end if;
    insert into public.system_exam_reminder_sends (system_exam_id, user_id, slot)
    values (r.id, v_user, v_slot)
    on conflict do nothing;
    if found then
      insert into public.notifications (user_id, kind, payload)
      values (
        v_user,
        'system_exam_reminder',
        jsonb_build_object('exam_id', r.id, 'title', r.title, 'start_at', r.start_at, 'slot', v_slot)
      );
    end if;
  end loop;
end;
$$;

create or replace function public.start_system_exam(p_exam uuid, p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exam public.system_exams%rowtype;
  v_attempt public.system_exam_attempts%rowtype;
  v_status text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_exam from public.system_exams where id = p_exam;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_status := public.system_exam_derived_status(v_exam);
  if v_status <> 'live' then raise exception 'EXAM_NOT_LIVE'; end if;
  if exists (
    select 1 from public.profiles
    where id = v_user and (account_status = 'banned' or (account_status = 'restricted' and restricted_until is not null and restricted_until > now()))
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  insert into public.system_exam_attempts (system_exam_id, user_id, client_id)
  values (p_exam, v_user, nullif(p_client_id, ''))
  on conflict (system_exam_id, user_id) do nothing;

  select * into v_attempt from public.system_exam_attempts where system_exam_id = p_exam and user_id = v_user;
  if v_attempt.client_id is not null and p_client_id is not null and v_attempt.client_id <> p_client_id
     and v_attempt.status = 'in_progress'
     and v_attempt.last_seen_at > now() - interval '45 seconds' then
    insert into public.system_exam_events (attempt_id, kind, metadata)
    values (v_attempt.id, 'duplicate_device', jsonb_build_object('client_id', p_client_id));
    raise exception 'ATTEMPT_ACTIVE_ELSEWHERE';
  end if;

  update public.system_exam_attempts
  set client_id = coalesce(nullif(p_client_id, ''), client_id),
      last_seen_at = now()
  where id = v_attempt.id
  returning * into v_attempt;

  if v_attempt.status = 'in_progress' and public.system_exam_remaining_seconds(v_attempt, v_exam) <= 0 then
    perform public.submit_system_exam(v_attempt.id);
    select * into v_attempt from public.system_exam_attempts where id = v_attempt.id;
  end if;

  if v_attempt.status = 'in_progress' then
    perform public.award_xp(v_user, 15, 'system_exam', 'system_exam_start', v_attempt.id::text, jsonb_build_object('exam_id', p_exam));
  end if;

  return public.get_system_exam_play(v_attempt.id, p_client_id);
end;
$$;

create or replace function public.get_system_exam_play(p_attempt uuid, p_client_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.system_exam_attempts%rowtype;
  v_exam public.system_exams%rowtype;
  v_remain int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_attempt from public.system_exam_attempts where id = p_attempt;
  if not found or (v_attempt.user_id <> v_user and not public.is_admin()) then
    raise exception 'NOT_FOUND';
  end if;
  select * into v_exam from public.system_exams where id = v_attempt.system_exam_id;
  v_remain := public.system_exam_remaining_seconds(v_attempt, v_exam);

  if v_attempt.status = 'in_progress' and v_remain <= 0 then
    perform public.submit_system_exam(v_attempt.id);
    select * into v_attempt from public.system_exam_attempts where id = v_attempt.id;
    v_remain := 0;
  end if;

  if v_attempt.status = 'in_progress' then
    if v_attempt.client_id is not null and p_client_id is not null and v_attempt.client_id <> p_client_id
       and v_attempt.last_seen_at > now() - interval '45 seconds' then
      insert into public.system_exam_events (attempt_id, kind, metadata)
      values (v_attempt.id, 'duplicate_device', jsonb_build_object('client_id', p_client_id));
      raise exception 'ATTEMPT_ACTIVE_ELSEWHERE';
    end if;
    if p_client_id is not null and v_attempt.client_id is not null and v_attempt.client_id <> p_client_id then
      insert into public.system_exam_events (attempt_id, kind, metadata)
      values (v_attempt.id, 'reconnect', jsonb_build_object('client_id', p_client_id));
    end if;
    update public.system_exam_attempts
    set last_seen_at = now(),
        client_id = coalesce(nullif(p_client_id, ''), client_id)
    where id = v_attempt.id;
  end if;

  return jsonb_build_object(
    'exam', jsonb_build_object(
      'id', v_exam.id,
      'title', v_exam.title,
      'exam_type', v_exam.exam_type,
      'duration_minutes', v_exam.duration_minutes,
      'question_count', v_exam.question_count,
      'end_at', v_exam.end_at
    ),
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'status', v_attempt.status,
      'current_question_index', v_attempt.current_question_index,
      'remaining_seconds', v_remain,
      'started_at', v_attempt.started_at,
      'submitted_at', v_attempt.submitted_at
    ),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'sort_order', seq.sort_order,
        'stem', q.stem,
        'choices', q.choices,
        'subject_name', sub.name,
        'topic_name', t.name,
        'selected_option', ans.selected_option,
        'marked_for_review', coalesce(ans.marked_for_review, false)
      ) order by seq.sort_order)
      from public.system_exam_questions seq
      join public.questions q on q.id = seq.question_id
      left join public.subjects sub on sub.id = q.subject_id
      left join public.topics t on t.id = q.topic_id
      left join public.system_exam_answers ans
        on ans.attempt_id = v_attempt.id and ans.question_id = q.id
      where seq.system_exam_id = v_exam.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_system_exam_answer(
  p_attempt uuid,
  p_question uuid,
  p_option text,
  p_marked boolean default null,
  p_index int default null,
  p_client_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.system_exam_attempts%rowtype;
  v_exam public.system_exams%rowtype;
  v_choice text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_attempt from public.system_exam_attempts where id = p_attempt and user_id = v_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_exam from public.system_exams where id = v_attempt.system_exam_id;
  if v_attempt.status <> 'in_progress' then raise exception 'ATTEMPT_LOCKED'; end if;
  if public.system_exam_remaining_seconds(v_attempt, v_exam) <= 0 then
    perform public.submit_system_exam(v_attempt.id);
    raise exception 'EXAM_TIME_UP';
  end if;
  if not exists (
    select 1 from public.system_exam_questions
    where system_exam_id = v_exam.id and question_id = p_question
  ) then
    raise exception 'INVALID_QUESTION';
  end if;
  v_choice := nullif(upper(trim(coalesce(p_option, ''))), '');
  if v_choice is not null and v_choice not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'INVALID_CHOICE';
  end if;

  insert into public.system_exam_answers (attempt_id, question_id, selected_option, answered_at, marked_for_review)
  values (
    p_attempt, p_question, v_choice,
    case when v_choice is null then null else now() end,
    coalesce(p_marked, false)
  )
  on conflict (attempt_id, question_id) do update
    set selected_option = excluded.selected_option,
        answered_at = case when excluded.selected_option is null then public.system_exam_answers.answered_at else now() end,
        marked_for_review = coalesce(p_marked, public.system_exam_answers.marked_for_review);

  update public.system_exam_attempts
  set current_question_index = coalesce(p_index, current_question_index),
      last_seen_at = now(),
      client_id = coalesce(nullif(p_client_id, ''), client_id)
  where id = p_attempt;

  return jsonb_build_object('ok', true, 'remaining_seconds', public.system_exam_remaining_seconds(v_attempt, v_exam));
end;
$$;

create or replace function public.log_system_exam_event(p_attempt uuid, p_kind text, p_metadata jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.system_exam_attempts where id = p_attempt and user_id = v_user) then
    raise exception 'NOT_FOUND';
  end if;
  insert into public.system_exam_events (attempt_id, kind, metadata)
  values (p_attempt, left(coalesce(p_kind, 'unknown'), 40), coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace function public.submit_system_exam(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.system_exam_attempts%rowtype;
  v_exam public.system_exams%rowtype;
  v_correct int := 0;
  v_wrong int := 0;
  v_blank int := 0;
  v_score numeric := 0;
  v_admin boolean := public.is_admin();
begin
  select * into v_attempt from public.system_exam_attempts where id = p_attempt;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_user is not null and v_attempt.user_id <> v_user and not v_admin then
    raise exception 'NOT_FOUND';
  end if;
  select * into v_exam from public.system_exams where id = v_attempt.system_exam_id;
  if v_attempt.status <> 'in_progress' then
    return public.get_system_exam_result(p_attempt);
  end if;

  select
    count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) = upper(q.correct_choice)),
    count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) <> upper(q.correct_choice)),
    count(*) filter (where ans.selected_option is null)
  into v_correct, v_wrong, v_blank
  from public.system_exam_questions seq
  join public.questions q on q.id = seq.question_id
  left join public.system_exam_answers ans
    on ans.attempt_id = v_attempt.id and ans.question_id = q.id
  where seq.system_exam_id = v_exam.id;

  v_score := public.compute_net(v_correct, v_wrong);

  update public.system_exam_attempts
  set status = case when public.system_exam_remaining_seconds(v_attempt, v_exam) <= 0 then 'expired' else 'submitted' end,
      submitted_at = now(),
      total_correct = v_correct,
      total_wrong = v_wrong,
      total_blank = v_blank,
      score = v_score
  where id = p_attempt;

  perform public.award_xp(v_attempt.user_id, 25, 'system_exam', 'system_exam_submit', p_attempt::text, jsonb_build_object('exam_id', v_exam.id));
  return public.get_system_exam_result(p_attempt);
end;
$$;

create or replace function public.get_system_exam_result(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.system_exam_attempts%rowtype;
  v_exam public.system_exams%rowtype;
  v_finished boolean;
  v_total int := 0;
  v_rank int;
  v_percentile numeric;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_attempt from public.system_exam_attempts where id = p_attempt;
  if not found or (v_attempt.user_id <> v_user and not public.is_admin()) then
    raise exception 'NOT_FOUND';
  end if;
  if v_attempt.status = 'in_progress' then raise exception 'ATTEMPT_LOCKED'; end if;
  select * into v_exam from public.system_exams where id = v_attempt.system_exam_id;
  v_finished := now() >= v_exam.end_at;

  if v_finished then
    select count(*) into v_total
    from public.system_exam_attempts
    where system_exam_id = v_exam.id and status in ('submitted', 'expired') and score is not null;
    select rnk into v_rank
    from (
      select id, rank() over (
        order by score desc nulls last,
          extract(epoch from (submitted_at - started_at)) asc
      ) as rnk
      from public.system_exam_attempts
      where system_exam_id = v_exam.id and status in ('submitted', 'expired') and score is not null
    ) x
    where x.id = v_attempt.id;
    if v_total > 0 and v_rank is not null then
      v_percentile := round((100.0 * (v_total - v_rank + 1) / v_total)::numeric, 1);
    end if;
    update public.system_exam_attempts set rank = v_rank where id = v_attempt.id;
  end if;

  return jsonb_build_object(
    'exam', jsonb_build_object('id', v_exam.id, 'title', v_exam.title, 'exam_type', v_exam.exam_type, 'finished', v_finished),
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'status', v_attempt.status,
      'started_at', v_attempt.started_at,
      'submitted_at', v_attempt.submitted_at,
      'total_correct', v_attempt.total_correct,
      'total_wrong', v_attempt.total_wrong,
      'total_blank', v_attempt.total_blank,
      'score', v_attempt.score,
      'rank', case when v_finished then v_rank else null end,
      'percentile', v_percentile,
      'duration_seconds', floor(extract(epoch from (coalesce(v_attempt.submitted_at, now()) - v_attempt.started_at)))::int
    ),
    'by_subject', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', sub.name,
        'correct', count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) = upper(q.correct_choice)),
        'wrong', count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) <> upper(q.correct_choice)),
        'blank', count(*) filter (where ans.selected_option is null)
      ) order by sub.name)
      from public.system_exam_questions seq
      join public.questions q on q.id = seq.question_id
      join public.subjects sub on sub.id = q.subject_id
      left join public.system_exam_answers ans on ans.attempt_id = v_attempt.id and ans.question_id = q.id
      where seq.system_exam_id = v_exam.id
      group by sub.name
    ), '[]'::jsonb),
    'by_topic', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', t.name,
        'subject', sub.name,
        'correct', count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) = upper(q.correct_choice)),
        'wrong', count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) <> upper(q.correct_choice)),
        'blank', count(*) filter (where ans.selected_option is null)
      ) order by t.name)
      from public.system_exam_questions seq
      join public.questions q on q.id = seq.question_id
      join public.subjects sub on sub.id = q.subject_id
      join public.topics t on t.id = q.topic_id
      left join public.system_exam_answers ans on ans.attempt_id = v_attempt.id and ans.question_id = q.id
      where seq.system_exam_id = v_exam.id
      group by t.name, sub.name
    ), '[]'::jsonb)
  );
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
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_exam from public.system_exams where id = p_exam;
  if not found or now() < v_exam.end_at then
    return jsonb_build_object('ready', false, 'top', '[]'::jsonb);
  end if;
  with ranked as (
    select
      a.user_id,
      p.display_name,
      p.display_tag,
      a.score,
      a.total_correct,
      rank() over (
        order by a.score desc nulls last,
          extract(epoch from (a.submitted_at - a.started_at)) asc
      )::int as rank
    from public.system_exam_attempts a
    join public.profiles p on p.id = a.user_id
    where a.system_exam_id = p_exam and a.status in ('submitted', 'expired') and a.score is not null
  )
  select rank into v_mine from ranked where user_id = v_user;

  return jsonb_build_object(
    'ready', true,
    'mine', v_mine,
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank,
        'display_name', r.display_name,
        'display_tag', r.display_tag,
        'score', r.score,
        'is_me', r.user_id = v_user
      ) order by r.rank)
      from ranked r
      where r.rank <= 100
    ), '[]'::jsonb),
    'nearby', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank,
        'display_name', r.display_name,
        'display_tag', r.display_tag,
        'score', r.score,
        'is_me', r.user_id = v_user
      ) order by r.rank)
      from ranked r
      where v_mine is not null and r.rank between greatest(1, v_mine - 2) and v_mine + 2
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.system_exam_profile_stats(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  return jsonb_build_object(
    'count', (
      select count(*)::int from public.system_exam_attempts
      where user_id = p_user and status in ('submitted', 'expired')
    ),
    'best_percentile', case when v_me = p_user or public.is_admin() then (
      select max(round((100.0 * (
        (select count(*) from public.system_exam_attempts b
         where b.system_exam_id = a.system_exam_id and b.status in ('submitted','expired') and b.score is not null)
         - a.rank + 1
      ) / nullif((
        select count(*) from public.system_exam_attempts b
        where b.system_exam_id = a.system_exam_id and b.status in ('submitted','expired') and b.score is not null
      ), 0))::numeric, 0))
      from public.system_exam_attempts a
      where a.user_id = p_user and a.rank is not null
    ) else null end,
    'last_net', case when v_me = p_user or public.is_admin() then (
      select score from public.system_exam_attempts
      where user_id = p_user and status in ('submitted', 'expired')
      order by submitted_at desc nulls last
      limit 1
    ) else null end
  );
end;
$$;
