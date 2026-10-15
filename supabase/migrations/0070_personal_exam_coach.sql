-- PHASE 3K personal exam coach. Factory stays paused. No mass lesson regen.

create table if not exists public.xp_event_config (
  event_key text primary key,
  xp_amount int not null default 0,
  reason public.xp_reason not null,
  enabled boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);

insert into public.xp_event_config (event_key, xp_amount, reason, notes) values
  ('micro_lesson_completed', 5, 'lesson', 'Guided micro-lesson; narration RPC may already award once via memory_narration'),
  ('checkpoint_set_completed', 3, 'lesson', 'Checkpoint set'),
  ('lesson_final_completed', 10, 'practice_set', 'Lesson final / daily test'),
  ('wrong_answer_remediated', 2, 'wrong_mastered', 'One per objective cycle'),
  ('scheduled_review_completed', 5, 'lesson', '1/3/7 review'),
  ('daily_plan_completed', 15, 'daily_plan', 'All mandatory daily items'),
  ('daily_test_completed', 10, 'practice_set', 'Daily mixed test'),
  ('study_session_completed', 5, 'session', 'Guided session end'),
  ('friend_study_session_completed', 2, 'session', 'Capped collab bonus'),
  ('objective_mastered', 5, 'lesson', 'First time a learning objective is mastered')
on conflict (event_key) do nothing;

create table if not exists public.user_study_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  break_frequency_lessons int not null default 3,
  preferred_break_minutes int not null default 5,
  preferred_session_minutes int not null default 40,
  coach_autonomy_level text not null default 'balanced',
  preferred_playback_rate numeric not null default 1,
  preferred_voice text,
  auto_next_lesson boolean not null default true,
  card_animations boolean not null default true,
  captions_enabled boolean not null default false,
  greet_completed_at timestamptz,
  how_we_study_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_study_preferences_break_freq_check check (break_frequency_lessons in (1, 2, 3, 0)),
  constraint user_study_preferences_autonomy_check check (coach_autonomy_level in ('guided', 'balanced', 'automatic'))
);

alter table public.user_study_preferences enable row level security;
drop policy if exists user_study_preferences_own on public.user_study_preferences;
create policy user_study_preferences_own on public.user_study_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_study_preferences to authenticated;

create table if not exists public.guided_study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'active',
  planned_lessons int not null default 3,
  completed_lessons int not null default 0,
  questions_answered int not null default 0,
  correct_count int not null default 0,
  wrong_count int not null default 0,
  breaks_taken int not null default 0,
  session_goal_minutes int not null default 40,
  current_step text not null default 'greet',
  current_lesson_id uuid,
  resume_state jsonb not null default '{}'::jsonb,
  xp_awarded int not null default 0,
  study_mode text not null default 'solo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guided_study_sessions_status_check check (status in ('active', 'paused', 'completed', 'abandoned')),
  constraint guided_study_sessions_mode_check check (study_mode in ('solo', 'friend'))
);

create index if not exists guided_study_sessions_user_idx on public.guided_study_sessions (user_id, started_at desc);
alter table public.guided_study_sessions enable row level security;
drop policy if exists guided_study_sessions_own on public.guided_study_sessions;
create policy guided_study_sessions_own on public.guided_study_sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.guided_study_sessions to authenticated;

create table if not exists public.daily_study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_date date not null,
  exam_id uuid,
  target_minutes int not null default 40,
  target_questions int not null default 20,
  planned_items jsonb not null default '[]'::jsonb,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date),
  constraint daily_study_plans_status_check check (status in ('ready', 'in_progress', 'completed', 'skipped'))
);

create index if not exists daily_study_plans_user_idx on public.daily_study_plans (user_id, plan_date desc);
alter table public.daily_study_plans enable row level security;
drop policy if exists daily_study_plans_own on public.daily_study_plans;
create policy daily_study_plans_own on public.daily_study_plans
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.daily_study_plans to authenticated;

create table if not exists public.user_question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid,
  memory_question_id uuid references public.memory_lesson_questions(id) on delete set null,
  lesson_id uuid references public.memory_lessons(id) on delete set null,
  session_id uuid references public.guided_study_sessions(id) on delete set null,
  learning_objective_id uuid,
  question_pattern_id text,
  selected_answer text,
  correct_answer text,
  is_correct boolean not null,
  response_time_ms int,
  attempt_number int not null default 1,
  source text not null default 'guided',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  mastered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_question_attempts_user_idx on public.user_question_attempts (user_id, created_at desc);
create index if not exists user_question_attempts_pattern_idx on public.user_question_attempts (user_id, question_pattern_id, is_correct);
alter table public.user_question_attempts enable row level security;
drop policy if exists user_question_attempts_own on public.user_question_attempts;
create policy user_question_attempts_own on public.user_question_attempts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_question_attempts to authenticated;

create table if not exists public.user_objective_mastery (
  user_id uuid not null references public.profiles(id) on delete cascade,
  objective_key text not null,
  canonical_topic_id uuid,
  lesson_id uuid,
  status text not null default 'unseen',
  correct_streak int not null default 0,
  wrong_streak int not null default 0,
  remediation_attempts int not null default 0,
  last_result text,
  mastered_at timestamptz,
  needs_review_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, objective_key),
  constraint user_objective_mastery_status_check check (status in ('unseen', 'introduced', 'learning', 'reinforcing', 'mastered', 'needs_review'))
);

alter table public.user_objective_mastery enable row level security;
drop policy if exists user_objective_mastery_own on public.user_objective_mastery;
create policy user_objective_mastery_own on public.user_objective_mastery
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.user_objective_mastery to authenticated;

create table if not exists public.lesson_timeline_events (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  event_type text not null,
  card_type text,
  appear_at_ms int not null default 0,
  pause_audio boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  related_learning_objective_id uuid,
  related_question_pattern_id text,
  related_question_id uuid,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint lesson_timeline_events_type_check check (event_type in (
    'scene_change', 'card_show', 'card_hide', 'checkpoint', 'coach_note', 'highlight', 'pause', 'resume', 'lesson_complete'
  ))
);

create index if not exists lesson_timeline_events_lesson_idx on public.lesson_timeline_events (lesson_id, appear_at_ms, sort_order);
alter table public.lesson_timeline_events enable row level security;
drop policy if exists lesson_timeline_events_read on public.lesson_timeline_events;
create policy lesson_timeline_events_read on public.lesson_timeline_events
  for select to authenticated using (
    public.is_admin()
    or exists (select 1 from public.memory_lessons l where l.id = lesson_id and l.status = 'published')
  );
drop policy if exists lesson_timeline_events_admin on public.lesson_timeline_events;
create policy lesson_timeline_events_admin on public.lesson_timeline_events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.lesson_timeline_events to authenticated;

create table if not exists public.study_coach_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists study_coach_alerts_user_idx on public.study_coach_alerts (user_id, created_at desc);
alter table public.study_coach_alerts enable row level security;
drop policy if exists study_coach_alerts_own on public.study_coach_alerts;
create policy study_coach_alerts_own on public.study_coach_alerts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.study_coach_alerts to authenticated;

alter table public.ai_runtime_settings
  add column if not exists tts_instructions text,
  add column if not exists tts_voice_candidates text[] not null default array['marin','cedar'];

update public.ai_runtime_settings
set tts_voice = case when tts_voice in ('nova', 'alloy', 'echo', 'fable', 'onyx', 'shimmer') then 'marin' else tts_voice end,
    tts_instructions = coalesce(tts_instructions,
      'Native-feeling Turkish. Warm personal exam coach. Conversational, confident, not theatrical. Clear pronunciation, short natural pauses. Slightly emphasize exam keywords. Medium pace; slower on rules. Avoid monotone, presenter, or influencer tone.'),
    updated_at = now()
where id = 1;

update public.ai_model_config
set notes = coalesce(notes, '') || ' Coach TTS: gpt-4o-mini-tts + marin/cedar. Existing lesson audio is not regenerated.',
    updated_at = now()
where task_type = 'tts_generation';

alter table public.memory_lesson_scenes
  add column if not exists display_text text,
  add column if not exists narration_script text;
update public.memory_lesson_scenes
set display_text = coalesce(display_text, narration_text),
    narration_script = coalesce(narration_script, narration_text)
where display_text is null or narration_script is null;

create or replace function public.award_guided_xp(p_event text, p_source_id text, p_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_cfg public.xp_event_config;
  v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_cfg from public.xp_event_config where event_key = p_event and enabled;
  if v_cfg.event_key is null then
    return jsonb_build_object('awarded', false, 'amount', 0, 'reason', 'unknown_event');
  end if;
  v_result := public.award_xp(
    v_user,
    v_cfg.xp_amount,
    v_cfg.reason,
    p_event,
    p_source_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('event_key', p_event)
  );
  return v_result;
end;
$$;
grant execute on function public.award_guided_xp(text, text, jsonb) to authenticated;

create or replace function public.ensure_lesson_timeline(p_lesson uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_lesson public.memory_lessons%rowtype;
begin
  select count(*) into v_count from public.lesson_timeline_events where lesson_id = p_lesson;
  if v_count > 0 then return v_count; end if;
  select * into v_lesson from public.memory_lessons where id = p_lesson;
  if v_lesson.id is null then return 0; end if;

  insert into public.lesson_timeline_events (lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, sort_order, related_question_pattern_id)
  select p_lesson, 'card_show', 'MEMORY_HOOK', greatest(s.start_ms + 400, s.start_ms), false,
    jsonb_build_object('title', 'KANCA', 'body', coalesce(nullif(s.memory_hook, ''), s.visual_anchor, s.caption)),
    s.scene_order * 10, 'hook'
  from public.memory_lesson_scenes s
  where s.lesson_id = p_lesson and coalesce(s.memory_hook, s.visual_anchor, '') <> '';

  insert into public.lesson_timeline_events (lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, sort_order)
  select p_lesson, 'card_show', 'FAST_RULE', s.start_ms + greatest(1200, (s.end_ms - s.start_ms) / 3), false,
    jsonb_build_object('title', 'HIZLI İPUCU', 'body', coalesce(nullif(s.recall_prompt, ''), v_lesson.fast_rule, s.reinforcement_note)),
    s.scene_order * 10 + 1
  from public.memory_lesson_scenes s
  where s.lesson_id = p_lesson and coalesce(s.recall_prompt, v_lesson.fast_rule, s.reinforcement_note, '') <> '';

  insert into public.lesson_timeline_events (lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, sort_order, related_question_id, related_question_pattern_id)
  select p_lesson, 'checkpoint', 'QUESTION', greatest(s.end_ms - 350, s.start_ms + 900), true,
    jsonb_build_object(
      'title', 'DEVAM ETMEDEN ÖNCE',
      'question_id', q.id,
      'question_text', q.question_text,
      'options', q.options,
      'correct_answer', q.correct_answer,
      'explanation', q.explanation
    ),
    200 + q.question_order, q.id, coalesce(q.question_strategy, 'checkpoint')
  from public.memory_lesson_questions q
  join public.memory_lesson_scenes s on s.lesson_id = q.lesson_id
  where q.lesson_id = p_lesson and q.question_type = 'checkpoint'
    and s.scene_order = least((
      select max(scene_order) from public.memory_lesson_scenes where lesson_id = p_lesson
    ), q.question_order * 2);

  insert into public.lesson_timeline_events (lesson_id, event_type, card_type, appear_at_ms, pause_audio, payload, sort_order)
  select p_lesson, 'card_show', 'TRAP', greatest(coalesce(v_lesson.duration_sec, 60) * 400, 8000), false,
    jsonb_build_object('title', 'TUZAK', 'body', v_lesson.exam_technique->>'common_traps'),
    90
  where coalesce(v_lesson.exam_technique->>'common_traps', '') <> '';

  insert into public.lesson_timeline_events (lesson_id, event_type, appear_at_ms, pause_audio, payload, sort_order)
  values (p_lesson, 'lesson_complete', greatest(coalesce(v_lesson.duration_sec, 1) * 1000 - 200, 1000), false, '{}'::jsonb, 999);

  select count(*) into v_count from public.lesson_timeline_events where lesson_id = p_lesson;
  return v_count;
end;
$$;
grant execute on function public.ensure_lesson_timeline(uuid) to authenticated;

create or replace function public.get_or_create_study_preferences()
returns public.user_study_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.user_study_preferences;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  insert into public.user_study_preferences (user_id) values (v_user)
  on conflict (user_id) do nothing;
  select * into v_row from public.user_study_preferences where user_id = v_user;
  return v_row;
end;
$$;
grant execute on function public.get_or_create_study_preferences() to authenticated;

create or replace function public.save_study_preferences(p_patch jsonb)
returns public.user_study_preferences
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.user_study_preferences;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  perform public.get_or_create_study_preferences();
  update public.user_study_preferences
  set break_frequency_lessons = coalesce((p_patch->>'break_frequency_lessons')::int, break_frequency_lessons),
      preferred_break_minutes = coalesce((p_patch->>'preferred_break_minutes')::int, preferred_break_minutes),
      preferred_session_minutes = coalesce((p_patch->>'preferred_session_minutes')::int, preferred_session_minutes),
      coach_autonomy_level = coalesce(nullif(p_patch->>'coach_autonomy_level', ''), coach_autonomy_level),
      preferred_playback_rate = coalesce((p_patch->>'preferred_playback_rate')::numeric, preferred_playback_rate),
      preferred_voice = coalesce(p_patch->>'preferred_voice', preferred_voice),
      auto_next_lesson = coalesce((p_patch->>'auto_next_lesson')::boolean, auto_next_lesson),
      card_animations = coalesce((p_patch->>'card_animations')::boolean, card_animations),
      captions_enabled = coalesce((p_patch->>'captions_enabled')::boolean, captions_enabled),
      greet_completed_at = case when (p_patch->>'greet_done')::boolean then coalesce(greet_completed_at, now()) else greet_completed_at end,
      how_we_study_completed_at = case when (p_patch->>'how_we_study_done')::boolean then coalesce(how_we_study_completed_at, now()) else how_we_study_completed_at end,
      updated_at = now()
  where user_id = v_user
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.save_study_preferences(jsonb) to authenticated;

create or replace function public.build_daily_study_plan(p_exam uuid)
returns public.daily_study_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_prefs public.user_study_preferences;
  v_rec jsonb;
  v_items jsonb := '[]'::jsonb;
  v_row public.daily_study_plans;
  v_item jsonb;
  v_i int := 0;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  v_prefs := public.get_or_create_study_preferences();
  select * into v_row from public.daily_study_plans where user_id = v_user and plan_date = v_today;
  if v_row.id is not null and v_row.status <> 'skipped' then
    return v_row;
  end if;

  v_rec := public.get_today_study_recommendations(p_exam);
  for v_item in select * from jsonb_array_elements(coalesce(v_rec->'items', '[]'::jsonb))
  loop
    v_i := v_i + 1;
    if v_i > 3 then exit; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', 'lesson',
      'mandatory', true,
      'minutes', 6,
      'title', coalesce(v_item->>'lesson_title', v_item->>'topic_name'),
      'subject', v_item->>'subject_name',
      'topic', v_item->>'topic_name',
      'lesson_id', v_item->>'lesson_id',
      'canonical_topic_id', v_item->>'canonical_topic_id',
      'reason', v_item->>'reason_code',
      'done', false
    ));
  end loop;

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'kind', 'break', 'mandatory', false, 'minutes', coalesce(v_prefs.preferred_break_minutes, 5),
    'title', 'Kısa mola', 'done', false
  ));
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'kind', 'daily_test', 'mandatory', true, 'minutes', 12, 'title', 'Günlük karışık test',
    'question_count', 20, 'done', false
  ));

  insert into public.daily_study_plans (user_id, plan_date, exam_id, target_minutes, target_questions, planned_items, status)
  values (v_user, v_today, p_exam, coalesce(v_prefs.preferred_session_minutes, 40), 20, v_items, 'ready')
  on conflict (user_id, plan_date) do update
    set planned_items = excluded.planned_items, exam_id = excluded.exam_id, updated_at = now()
  returning * into v_row;

  insert into public.study_coach_alerts (user_id, kind, title, body, payload)
  select v_user, 'daily_plan_ready', 'Bugünkü planın hazır',
    coalesce(v_prefs.preferred_session_minutes, 40)::text || ' dakikalık planın hazır.',
    jsonb_build_object('plan_id', v_row.id)
  where not exists (
    select 1 from public.study_coach_alerts a
    where a.user_id = v_user and a.kind = 'daily_plan_ready' and a.created_at >= timezone('Europe/Istanbul', v_today::timestamptz)
  );
  return v_row;
end;
$$;
grant execute on function public.build_daily_study_plan(uuid) to authenticated;

create or replace function public.start_guided_session(p_exam uuid, p_mode text default 'solo')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_prefs public.user_study_preferences;
  v_session public.guided_study_sessions;
  v_plan public.daily_study_plans;
  v_name text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  v_prefs := public.get_or_create_study_preferences();
  select display_name into v_name from public.profiles where id = v_user;
  update public.guided_study_sessions
  set status = 'abandoned', ended_at = now(), updated_at = now()
  where user_id = v_user and status in ('active', 'paused')
    and started_at < now() - interval '18 hours';

  select * into v_session
  from public.guided_study_sessions
  where user_id = v_user and status in ('active', 'paused')
  order by started_at desc limit 1;

  if v_session.id is null then
    insert into public.guided_study_sessions (
      user_id, exam_id, session_goal_minutes, planned_lessons, study_mode, current_step
    ) values (
      v_user, p_exam, coalesce(v_prefs.preferred_session_minutes, 40), 3, case when p_mode = 'friend' then 'friend' else 'solo' end,
      case when v_prefs.greet_completed_at is null then 'greet' else 'plan' end
    ) returning * into v_session;
  end if;

  v_plan := public.build_daily_study_plan(p_exam);
  return jsonb_build_object(
    'session', to_jsonb(v_session),
    'preferences', to_jsonb(v_prefs),
    'plan', to_jsonb(v_plan),
    'display_name', coalesce(nullif(v_name, ''), 'öğrenci')
  );
end;
$$;
grant execute on function public.start_guided_session(uuid, text) to authenticated;

create or replace function public.pick_daily_test_questions(p_exam uuid, p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_plan public.daily_study_plans;
  v_topics uuid[] := '{}';
  v_ids uuid[] := '{}';
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_plan from public.daily_study_plans where user_id = v_user and plan_date = v_today;
  select coalesce(array_agg((item->>'canonical_topic_id')::uuid) filter (where item->>'canonical_topic_id' is not null), '{}')
    into v_topics
  from jsonb_array_elements(coalesce(v_plan.planned_items, '[]'::jsonb)) item
  where item->>'kind' = 'lesson';

  select coalesce(array_agg(id), '{}') into v_ids from (
    select q.id from public.questions q
    where q.is_published is true and q.question_status = 'published'
      and q.canonical_topic_id = any(v_topics)
    order by random() limit greatest(1, least(p_limit, 8))
  ) t;

  select coalesce(v_ids || array_agg(id), v_ids) into v_ids from (
    select q.id from public.questions q
    join public.user_objective_mastery m on m.canonical_topic_id = q.canonical_topic_id and m.user_id = v_user
    where q.is_published is true and q.question_status = 'published' and m.status in ('needs_review', 'learning')
      and not (q.id = any(v_ids))
    order by random() limit 5
  ) w;

  select coalesce(v_ids || array_agg(id), v_ids) into v_ids from (
    select q.id from public.questions q
    join public.user_review_queue r on r.canonical_topic_id = q.canonical_topic_id and r.user_id = v_user
    where q.is_published is true and q.question_status = 'published' and r.status in ('ready', 'scheduled') and r.scheduled_at <= now()
      and not (q.id = any(v_ids))
    order by random() limit 4
  ) r;

  select coalesce(v_ids || array_agg(id), v_ids) into v_ids from (
    select q.id from public.questions q
    where q.is_published is true and q.question_status = 'published' and not (q.id = any(v_ids))
    order by random() limit greatest(0, p_limit - coalesce(array_length(v_ids, 1), 0))
  ) rest;

  return jsonb_build_object('question_ids', to_jsonb(v_ids[1:p_limit]), 'composition', jsonb_build_object(
    'today', 8, 'weak', 5, 'review', 4, 'retention', 3
  ));
end;
$$;
grant execute on function public.pick_daily_test_questions(uuid, int) to authenticated;

create or replace function public.record_guided_attempt(
  p_session uuid,
  p_selected text,
  p_correct_answer text,
  p_is_correct boolean,
  p_memory_question uuid default null,
  p_question uuid default null,
  p_lesson uuid default null,
  p_pattern text default null,
  p_objective text default null,
  p_ms int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sess public.guided_study_sessions;
  v_n int;
  v_obj text := coalesce(nullif(p_objective, ''), nullif(p_pattern, ''), coalesce(p_memory_question, p_question)::text, 'generic');
  v_xp jsonb := '{}'::jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_sess from public.guided_study_sessions where id = p_session and user_id = v_user;
  if v_sess.id is null then raise exception 'NOT_FOUND'; end if;

  select coalesce(max(attempt_number), 0) + 1 into v_n
  from public.user_question_attempts
  where user_id = v_user and coalesce(memory_question_id, question_id) = coalesce(p_memory_question, p_question);

  insert into public.user_question_attempts (
    user_id, question_id, memory_question_id, lesson_id, session_id, question_pattern_id,
    selected_answer, correct_answer, is_correct, response_time_ms, attempt_number, learning_objective_id
  ) values (
    v_user, p_question, p_memory_question, p_lesson, p_session, p_pattern,
    p_selected, p_correct_answer, p_is_correct, p_ms, v_n, null
  );

  update public.guided_study_sessions
  set questions_answered = questions_answered + 1,
      correct_count = correct_count + case when p_is_correct then 1 else 0 end,
      wrong_count = wrong_count + case when p_is_correct then 0 else 1 end,
      updated_at = now()
  where id = p_session;

  insert into public.user_objective_mastery (user_id, objective_key, lesson_id, canonical_topic_id, status, correct_streak, wrong_streak, last_result)
  values (
    v_user, v_obj, p_lesson, null,
    case when p_is_correct then 'learning' else 'needs_review' end,
    case when p_is_correct then 1 else 0 end,
    case when p_is_correct then 0 else 1 end,
    case when p_is_correct then 'correct' else 'wrong' end
  )
  on conflict (user_id, objective_key) do update set
    correct_streak = case when p_is_correct then user_objective_mastery.correct_streak + 1 else 0 end,
    wrong_streak = case when p_is_correct then 0 else user_objective_mastery.wrong_streak + 1 end,
    remediation_attempts = case when p_is_correct then user_objective_mastery.remediation_attempts
      else user_objective_mastery.remediation_attempts + 1 end,
    status = case
      when p_is_correct and user_objective_mastery.correct_streak + 1 >= 1 and user_objective_mastery.status in ('needs_review', 'learning', 'introduced') then 'reinforcing'
      when p_is_correct and user_objective_mastery.status = 'reinforcing' then 'mastered'
      when p_is_correct then 'learning'
      when user_objective_mastery.remediation_attempts + 1 >= 3 then 'needs_review'
      else 'learning'
    end,
    mastered_at = case when p_is_correct and user_objective_mastery.status = 'reinforcing' then now() else user_objective_mastery.mastered_at end,
    needs_review_at = case when not p_is_correct then now() + interval '2 hours' else user_objective_mastery.needs_review_at end,
    last_result = case when p_is_correct then 'correct' else 'wrong' end,
    updated_at = now();

  if p_is_correct then
    update public.user_question_attempts
    set mastered_at = coalesce(mastered_at, now()), last_seen_at = now()
    where user_id = v_user
      and coalesce(memory_question_id, question_id) = coalesce(p_memory_question, p_question)
      and is_correct = false
      and mastered_at is null;
    if found then
      v_xp := public.award_guided_xp('wrong_answer_remediated', v_obj || ':' || p_session::text, jsonb_build_object('session_id', p_session));
      update public.guided_study_sessions
      set xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0) where id = p_session;
    end if;
    if exists (
      select 1 from public.user_objective_mastery
      where user_id = v_user and objective_key = v_obj and status = 'mastered' and mastered_at is not null
    ) then
      v_xp := public.award_guided_xp('objective_mastered', v_obj, jsonb_build_object('session_id', p_session));
      update public.guided_study_sessions
      set xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0) where id = p_session;
    end if;
  else
    update public.guided_study_sessions
    set resume_state = coalesce(resume_state, '{}'::jsonb) || jsonb_build_object(
      'pending_skills', coalesce(resume_state->'pending_skills', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'objective_key', v_obj,
        'pattern', p_pattern,
        'question_id', p_question,
        'memory_question_id', p_memory_question,
        'lesson_id', p_lesson,
        'attempts', 1
      ))
    ),
    updated_at = now()
    where id = p_session
      and not exists (
        select 1 from jsonb_array_elements(coalesce(resume_state->'pending_skills', '[]'::jsonb)) e
        where e->>'objective_key' = v_obj
      );
  end if;

  return jsonb_build_object('ok', true, 'correct', p_is_correct, 'xp', v_xp);
end;
$$;
grant execute on function public.record_guided_attempt(uuid, text, text, boolean, uuid, uuid, uuid, text, text, int) to authenticated;

create or replace function public.study_session_next(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sess public.guided_study_sessions;
  v_prefs public.user_study_preferences;
  v_plan public.daily_study_plans;
  v_name text;
  v_action text;
  v_payload jsonb := '{}'::jsonb;
  v_skill jsonb;
  v_lesson jsonb;
  v_elapsed int;
  v_fatigue boolean := false;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_sess from public.guided_study_sessions where id = p_session and user_id = v_user;
  if v_sess.id is null then raise exception 'NOT_FOUND'; end if;
  v_prefs := public.get_or_create_study_preferences();
  select display_name into v_name from public.profiles where id = v_user;
  select * into v_plan from public.daily_study_plans
  where user_id = v_user and plan_date = (timezone('Europe/Istanbul', now()))::date;
  v_elapsed := greatest(0, extract(epoch from (now() - v_sess.started_at))::int / 60);

  if v_sess.questions_answered >= 6 and v_sess.wrong_count * 2 >= v_sess.correct_count + 1 then
    v_fatigue := true;
  end if;

  if v_prefs.greet_completed_at is null then
    v_action := 'greet';
    v_payload := jsonb_build_object('text',
      'Selam ' || coalesce(nullif(v_name, ''), 'öğrenci') ||
      '. Ben ÖSYM sınavında başarılı olman için birlikte çalışacağın koçunum. Dersleri 3–7 dakikada tutacağız; teknik, ilk hamle ve tuzaklara odaklanacağız. Yanlışını unutmam — doğru yapana kadar aynı mantığı tekrar önüne getiririm. Hazırsan başlayalım.');
  elsif v_prefs.break_frequency_lessons is not null and v_sess.current_step = 'prefs' then
    v_action := 'prefs';
    v_payload := jsonb_build_object(
      'break_frequency_lessons', v_prefs.break_frequency_lessons,
      'preferred_session_minutes', v_prefs.preferred_session_minutes
    );
  elsif v_prefs.how_we_study_completed_at is null then
    v_action := 'how_we_study';
    v_payload := jsonb_build_object('minutes', 3);
  elsif v_sess.current_step in ('plan', 'greet') then
    v_action := 'show_plan';
    v_payload := to_jsonb(v_plan);
  elsif jsonb_array_length(coalesce(v_sess.resume_state->'pending_skills', '[]'::jsonb)) > 0
        and v_sess.current_step in ('remediate', 'final', 'lesson_result', 'play_lesson') then
    v_skill := coalesce(v_sess.resume_state->'pending_skills'->0, '{}'::jsonb);
    if coalesce((v_skill->>'attempts')::int, 0) >= 3 then
      update public.user_objective_mastery set status = 'needs_review', needs_review_at = now() + interval '1 day'
      where user_id = v_user and objective_key = v_skill->>'objective_key';
      v_action := 'needs_review';
      v_payload := v_skill || jsonb_build_object('message', 'Burayı şimdi zorlamayalım. Tekrar listene ekledim.');
    else
      v_action := 'repeat_wrong_question';
      v_payload := v_skill || jsonb_build_object('message', 'Hadi bu noktayı sağlamlaştıralım.');
    end if;
  elsif v_sess.current_step = 'break' then
    v_action := 'start_break';
    v_payload := jsonb_build_object(
      'minutes', v_prefs.preferred_break_minutes,
      'lessons', v_sess.completed_lessons,
      'elapsed', v_elapsed,
      'fatigue', v_fatigue
    );
  elsif v_sess.current_step = 'play_lesson' and v_sess.current_lesson_id is not null then
    v_action := 'play_lesson';
    perform public.ensure_lesson_timeline(v_sess.current_lesson_id);
    v_payload := jsonb_build_object(
      'lesson_id', v_sess.current_lesson_id,
      'resume_ms', coalesce((v_sess.resume_state->>'audio_ms')::int, 0)
    );
  elsif v_sess.current_step = 'lesson_result' then
    v_action := 'show_result';
    v_payload := jsonb_build_object('completed_lessons', v_sess.completed_lessons, 'correct', v_sess.correct_count, 'wrong', v_sess.wrong_count);
  elsif v_sess.completed_lessons > 0
        and v_prefs.break_frequency_lessons > 0
        and v_sess.completed_lessons % v_prefs.break_frequency_lessons = 0
        and v_sess.current_step in ('lesson_result', 'next_lesson')
        and v_sess.breaks_taken < v_sess.completed_lessons / v_prefs.break_frequency_lessons then
    v_action := 'start_break';
    v_payload := jsonb_build_object('minutes', v_prefs.preferred_break_minutes, 'lessons', v_sess.completed_lessons, 'elapsed', v_elapsed, 'fatigue', v_fatigue);
  elsif v_elapsed >= v_sess.session_goal_minutes then
    v_action := 'complete_session';
    v_payload := jsonb_build_object('reason', 'time');
  elsif v_sess.current_step in ('next_lesson', 'plan', 'show_plan', 'lesson_result') then
    select item into v_lesson
    from jsonb_array_elements(coalesce(v_plan.planned_items, '[]'::jsonb)) item
    where item->>'kind' = 'lesson' and coalesce((item->>'done')::boolean, false) is not true
      and nullif(item->>'lesson_id', '') is not null
    limit 1;
    if v_lesson is not null then
      v_action := 'next_lesson';
      v_payload := v_lesson;
    else
      v_action := 'start_test';
      v_payload := public.pick_daily_test_questions(v_sess.exam_id, 20);
    end if;
  elsif v_sess.current_step in ('summary', 'remediate') then
    v_action := 'complete_session';
    v_payload := jsonb_build_object(
      'lessons', v_sess.completed_lessons,
      'minutes', v_elapsed,
      'questions', v_sess.questions_answered,
      'correct', v_sess.correct_count,
      'wrong', v_sess.wrong_count,
      'xp', v_sess.xp_awarded
    );
  else
    v_action := coalesce(nullif(v_sess.current_step, ''), 'show_plan');
    v_payload := to_jsonb(v_plan);
  end if;

  return jsonb_build_object(
    'next_action', v_action,
    'payload', v_payload,
    'session', to_jsonb(v_sess),
    'preferences', to_jsonb(v_prefs),
    'plan', to_jsonb(v_plan),
    'display_name', coalesce(nullif(v_name, ''), 'öğrenci'),
    'elapsed_minutes', v_elapsed,
    'fatigue', v_fatigue
  );
end;
$$;

-- study_session_act references study_session_next; replace act after next exists.
create or replace function public.study_session_act(p_session uuid, p_action text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_sess public.guided_study_sessions;
  v_prefs public.user_study_preferences;
  v_xp jsonb := '{}'::jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_sess from public.guided_study_sessions where id = p_session and user_id = v_user;
  if v_sess.id is null then raise exception 'NOT_FOUND'; end if;
  v_prefs := public.get_or_create_study_preferences();

  if p_action = 'greet_done' then
    perform public.save_study_preferences('{"greet_done":true}'::jsonb);
    update public.guided_study_sessions set current_step = 'prefs', updated_at = now() where id = p_session;
  elsif p_action = 'save_prefs' then
    perform public.save_study_preferences(p_payload);
    update public.guided_study_sessions set current_step = 'how_we_study',
      session_goal_minutes = coalesce((p_payload->>'preferred_session_minutes')::int, session_goal_minutes), updated_at = now()
    where id = p_session;
  elsif p_action = 'how_we_study_done' then
    perform public.save_study_preferences('{"how_we_study_done":true}'::jsonb);
    update public.guided_study_sessions set current_step = 'plan', updated_at = now() where id = p_session;
  elsif p_action = 'start_lesson' then
    update public.guided_study_sessions
    set current_step = 'play_lesson', current_lesson_id = nullif(p_payload->>'lesson_id','')::uuid, updated_at = now()
    where id = p_session;
    if nullif(p_payload->>'lesson_id','') is not null then
      perform public.ensure_lesson_timeline((p_payload->>'lesson_id')::uuid);
    end if;
  elsif p_action = 'save_resume' then
    update public.guided_study_sessions
    set resume_state = coalesce(resume_state,'{}'::jsonb) || coalesce(p_payload,'{}'::jsonb),
        status = case when coalesce(p_payload->>'status','') = 'paused' then 'paused' else status end,
        updated_at = now()
    where id = p_session;
  elsif p_action = 'resume' then
    update public.guided_study_sessions set status = 'active', updated_at = now() where id = p_session;
  elsif p_action = 'lesson_done' then
    if not exists (
      select 1 from jsonb_array_elements_text(coalesce(v_sess.resume_state->'completed_lesson_ids', '[]'::jsonb)) x
      where x = coalesce(p_payload->>'lesson_id', '')
    ) then
      update public.guided_study_sessions
      set completed_lessons = completed_lessons + 1,
          current_step = 'lesson_result',
          resume_state = coalesce(resume_state, '{}'::jsonb) || jsonb_build_object(
            'completed_lesson_ids', coalesce(resume_state->'completed_lesson_ids', '[]'::jsonb) || to_jsonb(coalesce(p_payload->>'lesson_id', ''))
          ),
          updated_at = now()
      where id = p_session;
      v_xp := public.award_guided_xp('micro_lesson_completed', coalesce(p_payload->>'lesson_id', p_session::text), jsonb_build_object('session_id', p_session));
      update public.guided_study_sessions set xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0) where id = p_session;
      update public.daily_study_plans
      set planned_items = (
        select coalesce(jsonb_agg(
          case when item->>'lesson_id' = coalesce(p_payload->>'lesson_id','') then item || '{"done":true}'::jsonb else item end
        ), planned_items)
        from jsonb_array_elements(planned_items) item
      ), status = 'in_progress', updated_at = now()
      where user_id = v_user and plan_date = (timezone('Europe/Istanbul', now()))::date;
    else
      update public.guided_study_sessions set current_step = 'lesson_result', updated_at = now() where id = p_session;
    end if;
  elsif p_action = 'checkpoint_set_done' then
    v_xp := public.award_guided_xp('checkpoint_set_completed', coalesce(v_sess.current_lesson_id::text, p_session::text), '{}'::jsonb);
    update public.guided_study_sessions set xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0) where id = p_session;
  elsif p_action = 'final_done' then
    v_xp := public.award_guided_xp('lesson_final_completed', coalesce(v_sess.current_lesson_id::text, p_session::text), '{}'::jsonb);
    update public.guided_study_sessions set xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0), current_step = 'remediate', updated_at = now() where id = p_session;
  elsif p_action in ('skip_break', 'end_break') then
    update public.guided_study_sessions set current_step = 'next_lesson', updated_at = now() where id = p_session;
  elsif p_action = 'start_break' then
    update public.guided_study_sessions
    set current_step = 'break',
        breaks_taken = case when current_step = 'break' then breaks_taken else breaks_taken + 1 end,
        updated_at = now()
    where id = p_session;
  elsif p_action = 'daily_test_done' then
    v_xp := public.award_guided_xp('daily_test_completed', (timezone('Europe/Istanbul', now()))::date::text, '{}'::jsonb);
    update public.guided_study_sessions set xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0), current_step = 'remediate', updated_at = now() where id = p_session;
    update public.daily_study_plans
    set planned_items = (
      select coalesce(jsonb_agg(
        case when item->>'kind' = 'daily_test' then item || '{"done":true}'::jsonb else item end
      ), planned_items)
      from jsonb_array_elements(planned_items) item
    ), updated_at = now()
    where user_id = v_user and plan_date = (timezone('Europe/Istanbul', now()))::date;
  elsif p_action = 'complete_session' then
    v_xp := public.award_guided_xp('study_session_completed', p_session::text, '{}'::jsonb);
    update public.guided_study_sessions
    set status = 'completed', ended_at = now(), current_step = 'complete_session',
        xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0), updated_at = now()
    where id = p_session;
    if v_sess.study_mode = 'friend' then
      v_xp := public.award_guided_xp('friend_study_session_completed', p_session::text, '{}'::jsonb);
      update public.guided_study_sessions set xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0) where id = p_session;
    end if;
    update public.daily_study_plans p
    set status = case
      when not exists (
        select 1 from jsonb_array_elements(p.planned_items) item
        where coalesce((item->>'mandatory')::boolean, false) and coalesce((item->>'done')::boolean, false) is not true
      ) then 'completed' else p.status end,
      updated_at = now()
    where p.user_id = v_user and p.plan_date = (timezone('Europe/Istanbul', now()))::date;
    if exists (
      select 1 from public.daily_study_plans p
      where p.user_id = v_user and p.plan_date = (timezone('Europe/Istanbul', now()))::date and p.status = 'completed'
    ) then
      v_xp := public.award_guided_xp('daily_plan_completed', (timezone('Europe/Istanbul', now()))::date::text, '{}'::jsonb);
      update public.guided_study_sessions set xp_awarded = xp_awarded + coalesce((v_xp->>'amount')::int, 0) where id = p_session;
    end if;
  elsif p_action = 'skip_lesson' then
    update public.daily_study_plans
    set planned_items = (
      select coalesce(jsonb_agg(
        case when item->>'lesson_id' = coalesce(p_payload->>'lesson_id','') then item || '{"done":true,"skipped":true}'::jsonb else item end
      ), planned_items)
      from jsonb_array_elements(planned_items) item
    ), updated_at = now()
    where user_id = v_user and plan_date = (timezone('Europe/Istanbul', now()))::date;
    update public.guided_study_sessions set current_step = 'next_lesson', updated_at = now() where id = p_session;
  elsif p_action = 'clear_skill' then
    update public.guided_study_sessions
    set resume_state = jsonb_set(coalesce(resume_state,'{}'::jsonb), '{pending_skills}', coalesce((
      select jsonb_agg(e) from jsonb_array_elements(coalesce(resume_state->'pending_skills','[]'::jsonb)) e
      where e->>'objective_key' <> coalesce(p_payload->>'objective_key','')
    ), '[]'::jsonb)), current_step = 'remediate', updated_at = now()
    where id = p_session;
  elsif p_action = 'mark_plan' then
    update public.guided_study_sessions set current_step = 'next_lesson', updated_at = now() where id = p_session;
  end if;

  return public.study_session_next(p_session);
end;
$$;

grant execute on function public.study_session_next(uuid) to authenticated;
grant execute on function public.study_session_act(uuid, text, jsonb) to authenticated;

create or replace function public.admin_coach_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'avg_session_minutes', (
      select round(avg(extract(epoch from (coalesce(ended_at, now()) - started_at))/60)::numeric, 1)
      from public.guided_study_sessions where started_at > now() - interval '14 days'
        and user_id in (select id from public.profiles where coalesce(profile_type,'human') <> 'virtual')
    ),
    'avg_lessons_per_session', (
      select round(avg(completed_lessons)::numeric, 2) from public.guided_study_sessions
      where started_at > now() - interval '14 days'
    ),
    'avg_questions_per_session', (
      select round(avg(questions_answered)::numeric, 1) from public.guided_study_sessions
      where started_at > now() - interval '14 days'
    ),
    'recovery_rate', (
      select round((count(*) filter (where mastered_at is not null))::numeric / nullif(count(*) filter (where is_correct = false), 0), 2)
      from public.user_question_attempts
    ),
    'break_pref', (
      select jsonb_object_agg(break_frequency_lessons::text, n) from (
        select break_frequency_lessons, count(*)::int as n from public.user_study_preferences group by 1
      ) s
    ),
    'abandonment', (
      select count(*)::int from public.guided_study_sessions where status = 'abandoned' and started_at > now() - interval '14 days'
    ),
    'avg_response_ms', (
      select round(avg(response_time_ms)::numeric, 0) from public.user_question_attempts where response_time_ms is not null
    ),
    'human_sessions', (select count(*)::int from public.guided_study_sessions s join public.profiles p on p.id = s.user_id where coalesce(p.profile_type,'human') <> 'virtual'),
    'virtual_sessions', (select count(*)::int from public.guided_study_sessions s join public.profiles p on p.id = s.user_id where p.profile_type = 'virtual')
  );
end;
$$;
grant execute on function public.admin_coach_stats() to authenticated;
