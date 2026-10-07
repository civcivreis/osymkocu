-- Koçum initial schema
-- Run in Supabase SQL Editor (once).

create extension if not exists "pgcrypto";

do $$ begin
  create type public.exam_kind as enum ('tyt', 'ayt', 'tyt_ayt', 'kpss_onlisans', 'kpss_lisans');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.difficulty as enum ('easy', 'medium', 'hard');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.task_status as enum ('pending', 'completed', 'skipped');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sanction_kind as enum ('warning', 'mute', 'temporary_ban', 'permanent_ban');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.subscription_plan as enum ('free', 'pro');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.league_tier as enum ('bronze', 'silver', 'gold', 'platinum', 'diamond');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.ai_mode as enum ('simple', 'shortest', 'detailed', 'osym_tactic', 'similar_question');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.friendship_status as enum ('pending', 'accepted', 'blocked');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.xp_reason as enum ('question', 'daily_plan', 'practice_exam', 'camp_day', 'streak_bonus');
exception when duplicate_object then null;
end $$;

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  kind public.exam_kind not null,
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  slug text not null,
  name text not null,
  sort_order int not null default 0,
  unique (exam_id, slug)
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  slug text not null,
  name text not null,
  sort_order int not null default 0,
  unique (subject_id, slug)
);

create table if not exists public.subtopics (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  slug text not null,
  name text not null,
  sort_order int not null default 0,
  unique (topic_id, slug)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  exam_id uuid references public.exams(id),
  target_score numeric,
  exam_date date,
  daily_minutes int not null default 90,
  onboarding_completed_at timestamptz,
  theme_preference text not null default 'system' check (theme_preference in ('light', 'dark', 'system')),
  current_xp int not null default 0,
  league_tier public.league_tier not null default 'bronze',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_exam_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  exam_id uuid not null references public.exams(id),
  target_tyt_net numeric,
  target_ayt_net numeric,
  target_kpss_score numeric,
  perceived_strong_subject_ids uuid[] not null default '{}',
  perceived_weak_subject_ids uuid[] not null default '{}'
);

create table if not exists public.study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_date date not null,
  target_questions int not null default 70,
  target_minutes int not null default 90,
  generated_by text not null default 'algorithm',
  summary text,
  created_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

create table if not exists public.study_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.study_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  subject_id uuid references public.subjects(id),
  topic_id uuid references public.topics(id),
  question_count int,
  status public.task_status not null default 'pending',
  sort_order int not null default 0,
  completed_at timestamptz
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id),
  subject_id uuid not null references public.subjects(id),
  topic_id uuid references public.topics(id),
  subtopic_id uuid references public.subtopics(id),
  stem text not null,
  choices jsonb,
  correct_choice text,
  explanation text,
  difficulty public.difficulty not null default 'medium',
  source text,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  selected_choice text,
  is_correct boolean not null,
  time_spent_ms int,
  created_at timestamptz not null default now()
);

create table if not exists public.wrong_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  exam_id uuid not null references public.exams(id),
  subject_id uuid not null references public.subjects(id),
  topic_id uuid references public.topics(id),
  user_answer text,
  correct_answer text,
  explanation text,
  difficulty public.difficulty,
  next_review_at timestamptz not null default now(),
  interval_days int not null default 1,
  ease_factor numeric not null default 2.5,
  repetitions int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.exam_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_id uuid not null references public.exams(id),
  title text,
  taken_at date not null default current_date,
  total_net numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.exam_subject_results (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.exam_results(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  correct_count int not null default 0,
  wrong_count int not null default 0,
  empty_count int not null default 0,
  net numeric not null default 0
);

create table if not exists public.streaks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_completed_date date,
  freeze_count int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  questions_solved int not null default 0,
  questions_correct int not null default 0,
  study_minutes int not null default 0,
  exams_logged int not null default 0,
  camps_completed int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  mode public.ai_mode,
  image_path text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  used_on date not null default current_date,
  daily_requests int not null default 0,
  monthly_requests int not null default 0,
  tokens_used int not null default 0,
  estimated_cost_usd numeric not null default 0,
  unique (user_id, used_on)
);

create table if not exists public.camps (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  exam_id uuid references public.exams(id),
  subject_id uuid references public.subjects(id),
  duration_days int not null,
  start_date date not null,
  end_date date not null,
  is_premium boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.camp_days (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.camps(id) on delete cascade,
  day_number int not null,
  title text not null,
  unique (camp_id, day_number)
);

create table if not exists public.camp_day_tasks (
  id uuid primary key default gen_random_uuid(),
  camp_day_id uuid not null references public.camp_days(id) on delete cascade,
  title text not null,
  sort_order int not null default 0
);

create table if not exists public.camp_participants (
  camp_id uuid not null references public.camps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  current_day int not null default 1,
  joined_at timestamptz not null default now(),
  primary key (camp_id, user_id)
);

create table if not exists public.xp_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount int not null check (amount > 0 and amount <= 500),
  reason public.xp_reason not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.league_seasons (
  id uuid primary key default gen_random_uuid(),
  starts_at date not null,
  ends_at date not null,
  is_active boolean not null default true
);

create table if not exists public.league_memberships (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tier public.league_tier not null default 'bronze',
  weekly_xp int not null default 0,
  unique (season_id, user_id)
);

create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan public.subscription_plan not null default 'free',
  provider text,
  provider_id text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.friendship_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  exam_id uuid references public.exams(id),
  camp_id uuid references public.camps(id),
  title text,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id),
  reason text not null,
  status public.report_status not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists public.user_sanctions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.sanction_kind not null,
  reason text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid
);

create index if not exists question_attempts_user_created_idx on public.question_attempts (user_id, created_at desc);
create index if not exists wrong_answers_review_idx on public.wrong_answers (user_id, next_review_at);
create index if not exists study_plans_user_date_idx on public.study_plans (user_id, plan_date desc);
create index if not exists ai_usage_user_day_idx on public.ai_usage (user_id, used_on desc);
create index if not exists exam_results_user_taken_idx on public.exam_results (user_id, taken_at desc);
create index if not exists topics_subject_idx on public.topics (subject_id, sort_order);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create or replace function public.protect_profile_progress()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.current_xp := old.current_xp;
    new.league_tier := old.league_tier;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_progress on public.profiles;
create trigger profiles_protect_progress
  before update on public.profiles
  for each row execute procedure public.protect_profile_progress();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'Öğrenci');
  insert into public.profiles (id, display_name) values (new.id, v_name);
  insert into public.streaks (user_id) values (new.id);
  insert into public.user_stats (user_id) values (new.id);
  insert into public.subscriptions (user_id, plan) values (new.id, 'free');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.compute_net(correct int, wrong int)
returns numeric
language sql
immutable
as $$
  select round(greatest(coalesce(correct, 0) - (coalesce(wrong, 0)::numeric / 4), 0), 2);
$$;

create or replace function public.complete_study_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pending int;
  v_today_total int;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  update public.study_tasks
  set status = 'completed', completed_at = now()
  where id = p_task_id
    and user_id = v_user
    and status = 'pending';

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  select
    count(*) filter (where t.status <> 'completed'),
    count(*)
  into v_pending, v_today_total
  from public.study_tasks t
  join public.study_plans p on p.id = t.plan_id
  where t.user_id = v_user
    and p.plan_date = (timezone('Europe/Istanbul', now()))::date;

  if coalesce(v_today_total, 0) > 0 and coalesce(v_pending, 1) = 0 then
    perform public.register_daily_completion();
  end if;
end;
$$;

create or replace function public.register_daily_completion()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_pending int;
  v_total int;
  v_streak int;
  v_last date;
  v_freezes int;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select
    count(*) filter (where t.status <> 'completed'),
    count(*)
  into v_pending, v_total
  from public.study_tasks t
  join public.study_plans p on p.id = t.plan_id
  where t.user_id = v_user
    and p.plan_date = v_today;

  if coalesce(v_total, 0) = 0 or coalesce(v_pending, 1) > 0 then
    raise exception 'TODAY_PLAN_INCOMPLETE';
  end if;

  select current_streak, last_completed_date, freeze_count
    into v_streak, v_last, v_freezes
  from public.streaks
  where user_id = v_user
  for update;

  if v_last = v_today then
    return v_streak;
  end if;

  if v_last = v_today - 1 then
    v_streak := coalesce(v_streak, 0) + 1;
  elsif v_last is null then
    v_streak := 1;
  elsif coalesce(v_freezes, 0) > 0 and v_last = v_today - 2 then
    v_freezes := v_freezes - 1;
    v_streak := coalesce(v_streak, 0) + 1;
  else
    v_streak := 1;
  end if;

  update public.streaks
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_streak),
      last_completed_date = v_today,
      freeze_count = coalesce(v_freezes, 0),
      updated_at = now()
  where user_id = v_user;

  insert into public.xp_transactions (user_id, amount, reason)
  values (v_user, 50, 'daily_plan');

  update public.profiles
  set current_xp = current_xp + 50
  where id = v_user;

  return v_streak;
end;
$$;

alter table public.exams enable row level security;
alter table public.subjects enable row level security;
alter table public.topics enable row level security;
alter table public.subtopics enable row level security;
alter table public.profiles enable row level security;
alter table public.user_exam_settings enable row level security;
alter table public.study_plans enable row level security;
alter table public.study_tasks enable row level security;
alter table public.questions enable row level security;
alter table public.question_attempts enable row level security;
alter table public.wrong_answers enable row level security;
alter table public.exam_results enable row level security;
alter table public.exam_subject_results enable row level security;
alter table public.streaks enable row level security;
alter table public.user_stats enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_usage enable row level security;
alter table public.camps enable row level security;
alter table public.camp_days enable row level security;
alter table public.camp_day_tasks enable row level security;
alter table public.camp_participants enable row level security;
alter table public.xp_transactions enable row level security;
alter table public.league_seasons enable row level security;
alter table public.league_memberships enable row level security;
alter table public.subscriptions enable row level security;
alter table public.friendships enable row level security;
alter table public.rooms enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
alter table public.user_sanctions enable row level security;

drop policy if exists exams_read on public.exams;
create policy exams_read on public.exams for select using (true);

drop policy if exists subjects_read on public.subjects;
create policy subjects_read on public.subjects for select using (true);

drop policy if exists topics_read on public.topics;
create policy topics_read on public.topics for select using (true);

drop policy if exists subtopics_read on public.subtopics;
create policy subtopics_read on public.subtopics for select using (true);

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists user_exam_settings_own on public.user_exam_settings;
create policy user_exam_settings_own on public.user_exam_settings
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists study_plans_select_own on public.study_plans;
create policy study_plans_select_own on public.study_plans for select to authenticated using (user_id = auth.uid());

drop policy if exists study_tasks_select_own on public.study_tasks;
create policy study_tasks_select_own on public.study_tasks for select to authenticated using (user_id = auth.uid());

drop policy if exists questions_read_published on public.questions;
create policy questions_read_published on public.questions for select to authenticated using (is_published = true);

drop policy if exists question_attempts_select_own on public.question_attempts;
create policy question_attempts_select_own on public.question_attempts for select to authenticated using (user_id = auth.uid());

drop policy if exists wrong_answers_select_own on public.wrong_answers;
create policy wrong_answers_select_own on public.wrong_answers for select to authenticated using (user_id = auth.uid());

drop policy if exists exam_results_own on public.exam_results;
create policy exam_results_own on public.exam_results
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists exam_subject_results_own on public.exam_subject_results;
create policy exam_subject_results_own on public.exam_subject_results
  for all to authenticated
  using (exists (select 1 from public.exam_results r where r.id = result_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.exam_results r where r.id = result_id and r.user_id = auth.uid()));

drop policy if exists streaks_select_own on public.streaks;
create policy streaks_select_own on public.streaks for select to authenticated using (user_id = auth.uid());

drop policy if exists user_stats_select_own on public.user_stats;
create policy user_stats_select_own on public.user_stats for select to authenticated using (user_id = auth.uid());

drop policy if exists ai_conversations_own on public.ai_conversations;
create policy ai_conversations_own on public.ai_conversations
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists ai_messages_own on public.ai_messages;
create policy ai_messages_own on public.ai_messages
  for all to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

drop policy if exists ai_usage_select_own on public.ai_usage;
create policy ai_usage_select_own on public.ai_usage for select to authenticated using (user_id = auth.uid());

drop policy if exists camps_read on public.camps;
create policy camps_read on public.camps for select using (true);

drop policy if exists camp_days_read on public.camp_days;
create policy camp_days_read on public.camp_days for select using (true);

drop policy if exists camp_day_tasks_read on public.camp_day_tasks;
create policy camp_day_tasks_read on public.camp_day_tasks for select using (true);

drop policy if exists camp_participants_select on public.camp_participants;
create policy camp_participants_select on public.camp_participants for select to authenticated using (true);

drop policy if exists camp_participants_insert_own on public.camp_participants;
create policy camp_participants_insert_own on public.camp_participants
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists xp_select_own on public.xp_transactions;
create policy xp_select_own on public.xp_transactions for select to authenticated using (user_id = auth.uid());

drop policy if exists league_seasons_read on public.league_seasons;
create policy league_seasons_read on public.league_seasons for select using (true);

drop policy if exists league_memberships_read on public.league_memberships;
create policy league_memberships_read on public.league_memberships for select to authenticated using (true);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = auth.uid());

drop policy if exists friendships_own on public.friendships;
create policy friendships_own on public.friendships
  for all to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());

drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to authenticated using (true);

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated using (deleted_at is null);

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert to authenticated with check (sender_id = auth.uid());

drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert to authenticated with check (reporter_user_id = auth.uid());

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select to authenticated using (reporter_user_id = auth.uid());

drop policy if exists sanctions_select_own on public.user_sanctions;
create policy sanctions_select_own on public.user_sanctions
  for select to authenticated using (user_id = auth.uid());

revoke all on function public.complete_study_task(uuid) from public;
revoke all on function public.register_daily_completion() from public;
grant execute on function public.complete_study_task(uuid) to authenticated;
grant execute on function public.register_daily_completion() to authenticated;
grant execute on function public.compute_net(int, int) to authenticated, anon;

insert into public.exams (slug, name, kind)
values
  ('tyt', 'TYT', 'tyt'),
  ('ayt', 'AYT', 'ayt'),
  ('tyt_ayt', 'TYT + AYT', 'tyt_ayt'),
  ('kpss_onlisans', 'KPSS Önlisans', 'kpss_onlisans'),
  ('kpss_lisans', 'KPSS Lisans', 'kpss_lisans')
on conflict (slug) do nothing;

insert into public.subjects (exam_id, slug, name, sort_order)
select e.id, s.slug, s.name, s.sort_order
from public.exams e
join (
  values
    ('tyt', 'turkce', 'Türkçe', 1),
    ('tyt', 'matematik', 'Matematik', 2),
    ('tyt', 'geometri', 'Geometri', 3),
    ('tyt', 'fizik', 'Fizik', 4),
    ('tyt', 'kimya', 'Kimya', 5),
    ('tyt', 'biyoloji', 'Biyoloji', 6),
    ('tyt', 'tarih', 'Tarih', 7),
    ('tyt', 'cografya', 'Coğrafya', 8),
    ('tyt', 'felsefe', 'Felsefe', 9),
    ('tyt', 'din', 'Din Kültürü', 10),
    ('ayt', 'matematik', 'Matematik', 1),
    ('ayt', 'fizik', 'Fizik', 2),
    ('ayt', 'kimya', 'Kimya', 3),
    ('ayt', 'biyoloji', 'Biyoloji', 4),
    ('ayt', 'edebiyat', 'Edebiyat', 5),
    ('ayt', 'tarih', 'Tarih', 6),
    ('ayt', 'cografya', 'Coğrafya', 7),
    ('ayt', 'felsefe', 'Felsefe Grubu', 8),
    ('kpss_lisans', 'turkce', 'Türkçe', 1),
    ('kpss_lisans', 'matematik', 'Matematik', 2),
    ('kpss_lisans', 'tarih', 'Tarih', 3),
    ('kpss_lisans', 'cografya', 'Coğrafya', 4),
    ('kpss_lisans', 'vatandaslik', 'Vatandaşlık', 5),
    ('kpss_lisans', 'guncel', 'Güncel Bilgiler', 6),
    ('kpss_onlisans', 'turkce', 'Türkçe', 1),
    ('kpss_onlisans', 'matematik', 'Matematik', 2),
    ('kpss_onlisans', 'tarih', 'Tarih', 3),
    ('kpss_onlisans', 'cografya', 'Coğrafya', 4),
    ('kpss_onlisans', 'vatandaslik', 'Vatandaşlık', 5),
    ('kpss_onlisans', 'guncel', 'Güncel Bilgiler', 6)
) as s(exam_slug, slug, name, sort_order)
  on s.exam_slug = e.slug
on conflict (exam_id, slug) do nothing;

insert into public.topics (subject_id, slug, name, sort_order)
select sub.id, t.slug, t.name, t.sort_order
from public.subjects sub
join public.exams e on e.id = sub.exam_id
join (
  values
    ('kpss_lisans', 'matematik', 'uslu-sayilar', 'Üslü Sayılar', 1),
    ('kpss_lisans', 'matematik', 'koklu-sayilar', 'Köklü Sayılar', 2),
    ('kpss_lisans', 'matematik', 'problemler', 'Problemler', 3),
    ('tyt', 'matematik', 'uslu-sayilar', 'Üslü Sayılar', 1),
    ('tyt', 'matematik', 'problemler', 'Problemler', 2)
) as t(exam_slug, subject_slug, slug, name, sort_order)
  on t.exam_slug = e.slug and t.subject_slug = sub.slug
on conflict (subject_id, slug) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-images',
  'question-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists question_images_insert_own on storage.objects;
create policy question_images_insert_own
  on storage.objects for insert to authenticated
  with check (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists question_images_select_own on storage.objects;
create policy question_images_select_own
  on storage.objects for select to authenticated
  using (bucket_id = 'question-images' and (storage.foldername(name))[1] = auth.uid()::text);
