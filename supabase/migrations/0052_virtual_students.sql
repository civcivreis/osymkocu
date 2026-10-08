-- Phase 3B: virtual student engine, thread-aware conversation v2, story expiry.

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'profile_type'
  ) then
    create type public.profile_type as enum ('human', 'virtual', 'system');
  end if;
end $$;

alter table public.profiles
  add column if not exists profile_type public.profile_type not null default 'human';

create or replace function public.is_virtual_profile(p_user uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user
      and (
        coalesce(profile_type, 'human') in ('virtual', 'system')
        or coalesce(is_bot, false)
      )
  );
$$;

update public.profiles
set profile_type = 'virtual'
where coalesce(is_bot, false) and profile_type = 'human';

create or replace function public.sync_profile_type_bot()
returns trigger
language plpgsql
as $$
begin
  if new.profile_type = 'virtual' then
    new.is_bot := true;
  elsif new.profile_type = 'human' then
    new.is_bot := false;
  end if;
  if coalesce(new.is_bot, false) and new.profile_type = 'human' then
    new.profile_type := 'virtual';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_profile_type on public.profiles;
create trigger profiles_sync_profile_type
before insert or update of is_bot, profile_type on public.profiles
for each row execute procedure public.sync_profile_type_bot();

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
    new.profile_type := old.profile_type;
    new.is_bot := old.is_bot;
  end if;
  return new;
end;
$$;

create table if not exists public.virtual_student_engine_settings (
  id int primary key default 1 check (id = 1),
  virtual_students_enabled boolean not null default false,
  xp_multiplier numeric not null default 0.4,
  virtual_daily_xp_cap int not null default 120,
  virtual_weekly_xp_cap int not null default 600,
  max_virtual_in_top5 int not null default 1,
  target_virtual_share numeric not null default 0.35,
  target_active_rooms int not null default 6,
  max_active_stories int not null default 3,
  min_virtual_story_interval_hours int not null default 18,
  activity_intensity text not null default 'medium',
  updated_at timestamptz not null default now()
);

insert into public.virtual_student_engine_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.virtual_student_engine_settings enable row level security;

create table if not exists public.virtual_student_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  exam_id uuid references public.exams(id) on delete set null,
  curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  daily_goal_questions int not null default 40,
  daily_goal_minutes int not null default 90,
  preferred_subject_ids uuid[] not null default '{}',
  strong_subject_ids uuid[] not null default '{}',
  weak_subject_ids uuid[] not null default '{}',
  active_hours_start time not null default '19:00',
  active_hours_end time not null default '23:30',
  timezone text not null default 'Europe/Istanbul',
  activity_intensity text not null default 'medium' check (activity_intensity in ('low', 'medium', 'high')),
  social_activity_level text not null default 'medium' check (social_activity_level in ('low', 'medium', 'high')),
  conversation_style text not null default 'casual',
  study_style text not null default 'steady',
  current_subject_id uuid references public.subjects(id) on delete set null,
  current_unit_id uuid,
  current_topic_id uuid references public.topics(id) on delete set null,
  current_learning_objective_id uuid,
  weekly_goal int not null default 200,
  daily_xp_cap int,
  xp_multiplier numeric not null default 0.4,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.virtual_student_profiles enable row level security;

create table if not exists public.virtual_student_activity_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  activity_type text not null check (activity_type in (
    'study_lesson', 'solve_test', 'join_room', 'create_room', 'room_chat',
    'social_post', 'social_comment', 'social_like', 'group_chat',
    'take_system_exam', 'review_topic', 'update_status', 'story'
  )),
  scheduled_for timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  context jsonb not null default '{}'::jsonb,
  attempt_count int not null default 0,
  error_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists virtual_jobs_due_idx
  on public.virtual_student_activity_jobs (status, scheduled_for)
  where status = 'queued';

alter table public.virtual_student_activity_jobs enable row level security;

create table if not exists public.virtual_student_memory (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  memory_type text not null check (memory_type in (
    'study_progress', 'recent_test', 'conversation_fact', 'relationship_context', 'recent_post'
  )),
  key text not null,
  value jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, memory_type, key)
);

create index if not exists virtual_memory_exp_idx
  on public.virtual_student_memory (expires_at)
  where expires_at is not null;

alter table public.virtual_student_memory enable row level security;

create table if not exists public.virtual_student_presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  state text not null default 'offline' check (state in (
    'offline', 'studying', 'testing', 'in_room', 'social', 'system_exam'
  )),
  subject_id uuid,
  topic_id uuid,
  room_id uuid,
  started_at timestamptz not null default now(),
  expected_end_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.virtual_student_presence enable row level security;

create table if not exists public.conversation_thread_state (
  conversation_id text primary key,
  conversation_kind text not null default 'exam_group',
  topic text,
  subtopic text,
  mood text not null default 'casual',
  current_thread_summary text,
  unresolved_question text,
  last_meaningful_message_id uuid,
  active_speakers uuid[] not null default '{}',
  topic_age int not null default 0,
  last_topic_shift_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.conversation_thread_state enable row level security;

alter table public.exam_chat_room_state
  add column if not exists last_topic_shift_at timestamptz;

alter table public.question_attempts
  add column if not exists is_virtual_activity boolean not null default false;

alter table public.stories
  add column if not exists deleted_at timestamptz,
  add column if not exists status text not null default 'active',
  add column if not exists media_id uuid references public.media(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stories_status_check'
  ) then
    alter table public.stories
      add constraint stories_status_check
      check (status in ('active', 'expired', 'deleted'));
  end if;
end $$;

create index if not exists stories_visible_idx
  on public.stories (created_at desc)
  where deleted_at is null;

drop policy if exists stories_read on public.stories;
create policy stories_read on public.stories
  for select to authenticated
  using (deleted_at is null and expires_at > now() and status = 'active');

create or replace function public.virtual_engine_settings()
returns public.virtual_student_engine_settings
language sql
stable
as $$
  select * from public.virtual_student_engine_settings where id = 1;
$$;

create or replace function public.istanbul_day_start()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('day', timezone('Europe/Istanbul', now())) at time zone 'Europe/Istanbul');
$$;

create or replace function public.remember_virtual_fact(
  p_profile uuid,
  p_type text,
  p_key text,
  p_value jsonb,
  p_ttl interval default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.virtual_student_memory (profile_id, memory_type, key, value, expires_at, updated_at)
  values (
    p_profile, p_type, p_key, coalesce(p_value, '{}'::jsonb),
    case when p_ttl is null then null else now() + p_ttl end,
    now()
  )
  on conflict (profile_id, memory_type, key) do update
    set value = excluded.value,
        expires_at = excluded.expires_at,
        updated_at = now();
end;
$$;

create or replace function public.set_virtual_presence(
  p_profile uuid,
  p_state text,
  p_subject uuid default null,
  p_topic uuid default null,
  p_room uuid default null,
  p_minutes int default 20
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.virtual_student_presence (
    profile_id, state, subject_id, topic_id, room_id, started_at, expected_end_at, updated_at
  ) values (
    p_profile, p_state, p_subject, p_topic, p_room, now(),
    now() + make_interval(mins => greatest(1, coalesce(p_minutes, 20))),
    now()
  )
  on conflict (profile_id) do update
    set state = excluded.state,
        subject_id = excluded.subject_id,
        topic_id = excluded.topic_id,
        room_id = excluded.room_id,
        started_at = now(),
        expected_end_at = excluded.expected_end_at,
        updated_at = now();
end;
$$;

create or replace function public.award_xp(
  p_user uuid,
  p_amount int,
  p_reason public.xp_reason,
  p_reference_type text,
  p_reference_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev int;
  v_total int;
  v_raw int := least(coalesce(p_amount, 0), 500);
  v_amount int;
  v_virtual boolean := public.is_virtual_profile(p_user);
  v_cfg public.virtual_student_engine_settings;
  v_mult numeric := 1;
  v_cap int;
  v_week_cap int;
  v_day int := 0;
  v_week int := 0;
  v_prof public.virtual_student_profiles%rowtype;
begin
  if p_user is null or v_raw <= 0 then
    return jsonb_build_object('awarded', false, 'amount', 0);
  end if;

  if v_virtual then
    select * into v_cfg from public.virtual_student_engine_settings where id = 1;
    select * into v_prof from public.virtual_student_profiles where profile_id = p_user;
    v_mult := coalesce(v_prof.xp_multiplier, v_cfg.xp_multiplier, 0.4);
    v_amount := floor(v_raw * v_mult)::int;
    v_cap := coalesce(v_prof.daily_xp_cap, v_cfg.virtual_daily_xp_cap, 120);
    v_week_cap := coalesce(v_cfg.virtual_weekly_xp_cap, 600);
    select coalesce(sum(amount), 0)::int into v_day
    from public.xp_transactions
    where user_id = p_user and created_at >= public.istanbul_day_start();
    select coalesce(sum(amount), 0)::int into v_week
    from public.xp_transactions
    where user_id = p_user and created_at >= public.istanbul_week_start();
    if v_day >= v_cap or v_week >= v_week_cap then
      v_amount := 0;
    else
      v_amount := least(v_amount, greatest(0, v_cap - v_day), greatest(0, v_week_cap - v_week));
    end if;
  else
    v_amount := greatest(1, v_raw);
  end if;

  if v_amount <= 0 then
    select current_xp into v_total from public.profiles where id = p_user;
    return jsonb_build_object(
      'awarded', false, 'amount', 0, 'capped', v_virtual,
      'total_xp', coalesce(v_total, 0),
      'previous_xp', coalesce(v_total, 0),
      'level', public.level_from_xp(coalesce(v_total, 0))
    );
  end if;

  begin
    insert into public.xp_transactions (user_id, amount, reason, metadata, reference_type, reference_id)
    values (
      p_user, v_amount, p_reason,
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('is_virtual', v_virtual, 'base_amount', v_raw),
      p_reference_type, p_reference_id
    );
  exception
    when unique_violation then
      select current_xp into v_total from public.profiles where id = p_user;
      return jsonb_build_object(
        'awarded', false, 'amount', 0, 'total_xp', coalesce(v_total, 0),
        'previous_xp', coalesce(v_total, 0), 'level', public.level_from_xp(coalesce(v_total, 0))
      );
  end;

  update public.profiles
  set current_xp = current_xp + v_amount
  where id = p_user
  returning current_xp - v_amount, current_xp into v_prev, v_total;

  return jsonb_build_object(
    'awarded', true,
    'amount', v_amount,
    'total_xp', coalesce(v_total, 0),
    'previous_xp', coalesce(v_prev, 0),
    'level', public.level_from_xp(coalesce(v_total, 0)),
    'previous_level', public.level_from_xp(coalesce(v_prev, 0)),
    'is_virtual', v_virtual
  );
end;
$$;

create or replace function public.leaderboard_apply_virtual_cap(p_rows jsonb, p_max_top5 int)
returns jsonb
language sql
stable
as $$
  with ranked as (
    select value, ordinality::int as ord
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality
  ),
  marked as (
    select
      r.value,
      r.ord,
      public.is_virtual_profile((r.value->>'user_id')::uuid) as virt
    from ranked r
  ),
  top5_virt as (
    select user_id from (
      select (value->>'user_id')::uuid as user_id, ord, virt,
             row_number() over (order by ord) as vn
      from marked
      where virt and ord <= 5
    ) x
    where vn > greatest(0, coalesce(p_max_top5, 1))
  ),
  kept as (
    select m.value, row_number() over (order by m.ord) as rank
    from marked m
    where (m.value->>'user_id')::uuid not in (select user_id from top5_virt)
  )
  select coalesce(jsonb_agg(k.value || jsonb_build_object('rank', k.rank) order by k.rank), '[]'::jsonb)
  from kept k;
$$;

create or replace function public.get_user_xp_summary(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_user uuid := coalesce(p_user, v_me);
  v_total int := 0;
  v_week int := 0;
  v_global int := 0;
  v_weekly_rank int := 0;
  v_humans int := 0;
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;

  select coalesce(current_xp, 0) into v_total from public.profiles where id = v_user;
  if not found then
    return jsonb_build_object('user_id', v_user, 'total_xp', 0, 'weekly_xp', 0, 'level', 1, 'global_rank', null, 'weekly_rank', null);
  end if;

  select coalesce(sum(amount), 0)::int into v_week
  from public.xp_transactions
  where user_id = v_user and created_at >= public.istanbul_week_start();

  select count(*)::int into v_humans from public.profiles where coalesce(profile_type, 'human') = 'human';
  select 1 + count(*)::int into v_global
  from public.profiles p
  where coalesce(p.profile_type, 'human') <> 'system' and p.current_xp > v_total;

  select 1 + count(*)::int into v_weekly_rank
  from (
    select t.user_id, sum(t.amount) as xp
    from public.xp_transactions t
    join public.profiles p on p.id = t.user_id
    where t.created_at >= public.istanbul_week_start()
      and coalesce(p.profile_type, 'human') <> 'system'
    group by t.user_id
  ) w
  where w.xp > v_week;

  if v_week = 0 then
    v_weekly_rank := null;
  end if;

  return jsonb_build_object(
    'user_id', v_user,
    'total_xp', v_total,
    'weekly_xp', v_week,
    'level', public.level_from_xp(v_total),
    'global_rank', v_global,
    'weekly_rank', v_weekly_rank,
    'humans', v_humans,
    'profile_type', (select profile_type from public.profiles where id = v_user)
  );
end;
$$;

create or replace function public.get_weekly_xp_leaderboard(p_limit int default 20, p_exam_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_max int;
  v_rows jsonb;
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  select max_virtual_in_top5 into v_max from public.virtual_student_engine_settings where id = 1;
  select coalesce((
    select jsonb_agg(to_jsonb(x) order by x.rank)
    from (
      select
        row_number() over (order by w.xp desc, p.display_name asc)::int as rank,
        p.id as user_id,
        p.display_name,
        p.display_tag,
        p.avatar_url,
        p.current_xp as total_xp,
        public.level_from_xp(p.current_xp) as level,
        w.xp as weekly_xp,
        e.name as exam_name,
        p.profile_type
      from (
        select t.user_id, sum(t.amount)::int as xp
        from public.xp_transactions t
        join public.profiles pr on pr.id = t.user_id
        where t.created_at >= public.istanbul_week_start()
          and coalesce(pr.profile_type, 'human') <> 'system'
        group by t.user_id
      ) w
      join public.profiles p on p.id = w.user_id
      left join public.exams e on e.id = p.exam_id
      where (p_exam_id is null or p.exam_id = p_exam_id)
      order by w.xp desc, p.display_name asc
      limit v_limit + 8
    ) x
  ), '[]'::jsonb) into v_rows;
  return (
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    from (
      select value from jsonb_array_elements(public.leaderboard_apply_virtual_cap(v_rows, v_max))
      limit v_limit
    ) z
  );
end;
$$;

create or replace function public.get_global_xp_leaderboard(p_limit int default 20, p_exam_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 50));
  v_max int;
  v_rows jsonb;
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  select max_virtual_in_top5 into v_max from public.virtual_student_engine_settings where id = 1;
  select coalesce((
    select jsonb_agg(to_jsonb(x) order by x.rank)
    from (
      select
        row_number() over (order by p.current_xp desc, p.display_name asc)::int as rank,
        p.id as user_id,
        p.display_name,
        p.display_tag,
        p.avatar_url,
        p.current_xp as total_xp,
        public.level_from_xp(p.current_xp) as level,
        e.name as exam_name,
        p.profile_type
      from public.profiles p
      left join public.exams e on e.id = p.exam_id
      where coalesce(p.profile_type, 'human') <> 'system'
        and (p_exam_id is null or p.exam_id = p_exam_id)
      order by p.current_xp desc, p.display_name asc
      limit v_limit + 8
    ) x
  ), '[]'::jsonb) into v_rows;
  return (
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    from (
      select value from jsonb_array_elements(public.leaderboard_apply_virtual_cap(v_rows, v_max))
      limit v_limit
    ) z
  );
end;
$$;

create or replace function public.pick_study_match_partner(
  p_user uuid,
  p_subject_id uuid,
  p_topic_id uuid,
  p_topic_ok boolean,
  p_subject_ok boolean,
  p_re int,
  p_stale int
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_other uuid;
begin
  select p.user_id into v_other
  from public.study_presence p
  join public.profiles pr on pr.id = p.user_id
  left join public.virtual_student_presence vp on vp.profile_id = p.user_id
  where p.user_id <> p_user
    and p.is_available_for_match
    and p.status = 'studying'
    and p.heartbeat_at > now() - make_interval(secs => p_stale)
    and coalesce(pr.auto_match, true) = true
    and (pr.match_suppressed_until is null or pr.match_suppressed_until <= now())
    and not public.user_in_quiet_match(p.user_id)
    and (p_topic_ok or p_subject_ok)
    and p.subject_id = p_subject_id
    and (
      (p_topic_ok and p_topic_id is not null and p.topic_id is not distinct from p_topic_id)
      or (p_subject_ok and coalesce(pr.match_same_subject, true))
    )
    and (coalesce(pr.match_same_topic, true) = false or p_topic_id is null or p.topic_id is null
         or p.topic_id is not distinct from p_topic_id or coalesce(pr.match_same_subject, true))
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_user and b.blocked_id = p.user_id)
         or (b.blocker_id = p.user_id and b.blocked_id = p_user)
    )
    and not exists (
      select 1 from public.study_match_offers o
      where o.created_at > now() - make_interval(hours => p_re)
        and o.user_a = least(p_user, p.user_id)
        and o.user_b = greatest(p_user, p.user_id)
        and o.topic_id is not distinct from p_topic_id
    )
    and (
      coalesce(pr.profile_type, 'human') = 'human'
      or (
        coalesce(vp.state, 'studying') in ('studying', 'offline')
        and exists (
          select 1 from public.virtual_student_profiles vsp
          where vsp.profile_id = p.user_id and vsp.is_enabled
        )
      )
    )
  order by
    case
      when p.topic_id is not distinct from p_topic_id and coalesce(pr.profile_type, 'human') = 'human' then 0
      when p.topic_id is not distinct from p_topic_id then 1
      when coalesce(pr.profile_type, 'human') = 'human' then 2
      else 3
    end,
    p.heartbeat_at asc
  limit 1;
  return v_other;
end;
$$;
