-- Serialized TTS queue, stage-preserving media, content-pack import. Autonomous lesson writing off.

alter table public.content_factory_settings
  add column if not exists autonomous_lesson_writing boolean not null default false,
  add column if not exists max_active_media_lessons integer not null default 1,
  add column if not exists max_pending_tts_jobs integer not null default 5,
  add column if not exists tts_max_immediate_attempts integer not null default 3;

update public.content_factory_settings
set autonomous_lesson_writing = false,
    tts_workers = 1,
    max_active_media_lessons = 1,
    max_pending_tts_jobs = 5,
    tts_max_immediate_attempts = 3,
    factory_run_job_cap = least(coalesce(factory_run_job_cap, 1), 5),
    updated_at = now()
where id = 1;

alter table public.memory_lessons
  add column if not exists narration_hash text,
  add column if not exists content_source text not null default 'ai',
  add column if not exists lock_authored boolean not null default false,
  add column if not exists content_status text not null default 'pending',
  add column if not exists questions_status text not null default 'pending',
  add column if not exists visual_status text not null default 'pending',
  add column if not exists tts_status text not null default 'idle',
  add column if not exists lesson_status text not null default 'draft';

update public.memory_lessons
set content_status = case when coalesce(narration, '') <> '' then 'ready' else content_status end,
    questions_status = case
      when exists (select 1 from public.memory_lesson_questions q where q.lesson_id = memory_lessons.id) then 'ready'
      else questions_status
    end,
    tts_status = case
      when narration_key is not null then 'ready'
      when media_generation_error ilike '%RATE_LIMIT%' then 'rate_limited'
      else tts_status
    end,
    visual_status = case
      when media_generation_status = 'ready' then 'ready'
      else visual_status
    end,
    lesson_status = case
      when status in ('approved', 'published') then status
      when narration_key is not null then 'waiting_media'
      when coalesce(narration, '') <> '' then 'waiting_media'
      else lesson_status
    end
where true;

alter table public.memory_lessons drop constraint if exists memory_lessons_media_generation_status_check;
alter table public.memory_lessons
  add constraint memory_lessons_media_generation_status_check
  check (media_generation_status in ('idle', 'generating', 'ready', 'failed', 'waiting_retry', 'rate_limited', 'waiting_media'));

create table if not exists public.tts_jobs (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  narration_hash text not null,
  script_text text not null,
  chunk_index integer not null default 0,
  chunk_total integer not null default 1,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  last_error text,
  r2_key text,
  reused_from_lesson_id uuid references public.memory_lessons(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tts_jobs_status_check
    check (status in ('queued', 'generating', 'ready', 'rate_limited', 'waiting_retry', 'failed')),
  unique (lesson_id, chunk_index)
);

create index if not exists tts_jobs_claim_idx
  on public.tts_jobs (status, next_retry_at, created_at);
create index if not exists tts_jobs_hash_ready_idx
  on public.tts_jobs (narration_hash)
  where status = 'ready' and r2_key is not null;

alter table public.tts_jobs enable row level security;

create table if not exists public.content_pack_imports (
  id uuid primary key default gen_random_uuid(),
  filename text,
  status text not null default 'completed',
  summary jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.content_pack_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.content_pack_imports(id) on delete cascade,
  row_index integer not null,
  canonical_topic_id text,
  title text,
  payload jsonb not null,
  status text not null,
  error text,
  lesson_id uuid references public.memory_lessons(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists content_pack_rows_import_idx on public.content_pack_rows (import_id, row_index);

alter table public.content_pack_imports enable row level security;
alter table public.content_pack_rows enable row level security;

create or replace function public.tts_try_lock()
returns boolean
language sql
security definer
set search_path = public
as $$
  select pg_try_advisory_lock(920261001);
$$;

create or replace function public.tts_unlock()
returns boolean
language sql
security definer
set search_path = public
as $$
  select pg_advisory_unlock(920261001);
$$;

create or replace function public.factory_pending_tts_count()
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.tts_jobs
  where status in ('queued', 'generating', 'waiting_retry', 'rate_limited');
$$;

create or replace function public.factory_active_media_lesson_count()
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::int
  from public.memory_lessons
  where tts_status in ('queued', 'generating')
     or media_generation_status = 'generating';
$$;

create or replace function public.admin_factory_get_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.content_factory_settings;
begin
  perform public.require_admin();
  select * into v_row from public.content_factory_settings where id = 1;
  return jsonb_build_object(
    'production_enabled', v_row.production_enabled,
    'engine_state', v_row.engine_state,
    'max_concurrency', v_row.max_concurrency,
    'question_pool_target', v_row.question_pool_target,
    'curriculum_workers', v_row.curriculum_workers,
    'text_workers', v_row.text_workers,
    'image_workers', v_row.image_workers,
    'tts_workers', 1,
    'question_workers', v_row.question_workers,
    'curriculum_sync_interval', v_row.curriculum_sync_interval,
    'last_orchestrated_at', v_row.last_orchestrated_at,
    'last_idle_reason', v_row.last_idle_reason,
    'factory_blocked_reason', v_row.factory_blocked_reason,
    'factory_blocked_detail', v_row.factory_blocked_detail,
    'current_activity', v_row.current_activity,
    'stall_detected_at', v_row.stall_detected_at,
    'last_cron_tick_at', v_row.last_cron_tick_at,
    'last_ai_call_at', v_row.last_ai_call_at,
    'factory_run_job_cap', v_row.factory_run_job_cap,
    'scope_mode', v_row.scope_mode,
    'scope_exam_code', v_row.scope_exam_code,
    'scope_subject_name', v_row.scope_subject_name,
    'scope_max_topics', v_row.scope_max_topics,
    'allow_full_unbounded', v_row.allow_full_unbounded,
    'autonomous_lesson_writing', coalesce(v_row.autonomous_lesson_writing, false),
    'max_active_media_lessons', coalesce(v_row.max_active_media_lessons, 1),
    'max_pending_tts_jobs', coalesce(v_row.max_pending_tts_jobs, 5),
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.factory_enqueue_media_batch()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.content_factory_settings;
  v_pending int;
  v_active int;
  v_room int;
  v_queued int := 0;
begin
  select * into v_cfg from public.content_factory_settings where id = 1;
  v_pending := public.factory_pending_tts_count();
  v_active := public.factory_active_media_lesson_count();
  v_room := greatest(0, least(
    coalesce(v_cfg.max_pending_tts_jobs, 5) - v_pending,
    case when v_active >= coalesce(v_cfg.max_active_media_lessons, 1) then 0 else 1 end,
    5
  ));
  if v_room <= 0 then
    return jsonb_build_object('queued', 0, 'pending_tts', v_pending, 'active_media', v_active, 'reason', 'cap');
  end if;

  insert into public.content_generation_jobs (
    canonical_topic_id, memory_lesson_id, job_type, status, coverage_mode, lesson_scope, priority
  )
  select l.canonical_topic_id, l.id, 'media_only', 'queued', 'core', coalesce(l.lesson_scope, 'core'), 50
  from public.memory_lessons l
  where l.canonical_topic_id is not null
    and coalesce(l.narration, '') <> ''
    and l.narration_key is null
    and coalesce(l.tts_status, 'idle') in ('idle', 'waiting_retry', 'rate_limited', 'queued')
    and (l.media_next_retry_at is null or l.media_next_retry_at <= now())
    and not exists (
      select 1 from public.content_generation_jobs j
      where j.memory_lesson_id = l.id
        and j.job_type = 'media_only'
        and j.status not in ('completed', 'failed', 'cancelled')
    )
  order by l.updated_at
  limit v_room;
  get diagnostics v_queued = row_count;
  return jsonb_build_object('queued', v_queued, 'pending_tts', v_pending, 'active_media', v_active);
end;
$$;

create or replace function public.factory_orchestrate_internal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_enqueued int := 0;
  v_active int;
  v_health jsonb;
  v_cfg public.content_factory_settings;
  v_media jsonb;
begin
  update public.content_generation_jobs
  set status = 'queued', locked_until = null, error_message = 'stale lock released'
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media')
    and locked_until is not null and locked_until < now() - interval '20 minutes';

  select * into v_cfg from public.content_factory_settings where id = 1;
  v_state := v_cfg.engine_state;
  if v_state = 'stopping' then
    select count(*) into v_active from public.content_generation_jobs
    where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media');
    if coalesce(v_active, 0) = 0 then
      update public.content_factory_settings
      set engine_state = 'paused', production_enabled = false, last_idle_reason = 'stopped', updated_at = now()
      where id = 1;
    end if;
    return jsonb_build_object('state', 'stopping', 'enqueued', 0);
  end if;
  if v_state is distinct from 'running' then
    v_health := public.refresh_factory_health();
    return jsonb_build_object('state', coalesce(v_state, 'paused'), 'enqueued', 0, 'health', v_health);
  end if;

  v_media := public.factory_enqueue_media_batch();
  v_enqueued := coalesce((v_media ->> 'queued')::int, 0);

  if coalesce(v_cfg.autonomous_lesson_writing, false) is not true then
    update public.content_factory_settings
    set last_orchestrated_at = now(),
        last_idle_reason = 'orchestrator_media_only',
        updated_at = now()
    where id = 1;
    v_health := public.refresh_factory_health();
    return jsonb_build_object(
      'state', 'running',
      'lesson_jobs', 0,
      'media_jobs', v_enqueued,
      'autonomous_lesson_writing', false,
      'batch', v_media,
      'health', v_health
    );
  end if;

  update public.content_factory_settings
  set last_orchestrated_at = now(),
      last_idle_reason = case when v_enqueued > 0 then 'working' else 'idle' end,
      updated_at = now()
  where id = 1;
  v_health := public.refresh_factory_health();
  return jsonb_build_object('state', 'running', 'lesson_jobs', 0, 'media_jobs', v_enqueued, 'health', v_health);
end;
$$;

create or replace function public.factory_claim_jobs_internal(p_limit integer)
returns setof public.content_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_state text;
  v_max int;
  v_busy int;
  v_take int;
  v_cap int;
  v_media_busy int;
  v_media_cap int;
begin
  select production_enabled, engine_state, max_concurrency, factory_run_job_cap, max_active_media_lessons
    into v_enabled, v_state, v_max, v_cap, v_media_cap
  from public.content_factory_settings where id = 1;
  select count(*) into v_media_busy
  from public.content_generation_jobs
  where status = 'generating_media';
  if not (v_enabled or v_state in ('running', 'stopping')) then
    return query
    with picked as (
      select id from public.content_generation_jobs
      where status = 'queued' and priority >= 1000
        and (
          job_type <> 'media_only'
          or coalesce(v_media_busy, 0) < coalesce(v_media_cap, 1)
        )
      order by priority desc, created_at
      for update skip locked
      limit 1
    )
    update public.content_generation_jobs j
    set status = case when j.job_type = 'media_only' then 'generating_media' else 'generating_text' end,
        started_at = coalesce(j.started_at, now()),
        attempt_count = j.attempt_count + 1
    from picked
    where j.id = picked.id
    returning j.*;
    return;
  end if;
  select count(*) into v_busy
  from public.content_generation_jobs
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media');
  v_take := greatest(0, least(
    coalesce(p_limit, 1),
    coalesce(v_max, 1) - v_busy,
    coalesce(v_cap, 1) - v_busy
  ));
  if v_take <= 0 then return; end if;
  return query
  with picked as (
    select id from public.content_generation_jobs
    where status = 'queued'
      and (
        job_type <> 'media_only'
        or coalesce(v_media_busy, 0) < coalesce(v_media_cap, 1)
      )
    order by case when job_type = 'media_only' then 0 else 1 end, priority desc, created_at
    for update skip locked
    limit v_take
  )
  update public.content_generation_jobs j
    set status = case when j.job_type = 'media_only' then 'generating_media' else 'generating_text' end,
      started_at = coalesce(j.started_at, now()),
      attempt_count = j.attempt_count + 1,
      error_code = null,
      error_message = null
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

create or replace function public.admin_queue_missing_content(
  p_exam_id uuid default null,
  p_curriculum_version_id uuid default null,
  p_subject_id uuid default null,
  p_unit_id uuid default null,
  p_enqueue boolean default false,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auto boolean;
begin
  perform public.require_admin();
  select coalesce(autonomous_lesson_writing, false) into v_auto from public.content_factory_settings where id = 1;
  if p_enqueue and v_auto is not true then
    return jsonb_build_object(
      'generate', 0,
      'reused', 0,
      'skipped', 0,
      'queued', 0,
      'needs_confirm', false,
      'blocked', 'AUTONOMOUS_WRITING_DISABLED',
      'message', 'Toplu AI ders yazımı kapalı. Content pack içe aktarın.'
    );
  end if;
  return jsonb_build_object(
    'generate', 0,
    'reused', 0,
    'skipped', 0,
    'queued', 0,
    'needs_confirm', true,
    'blocked', 'AUTONOMOUS_WRITING_DISABLED'
  );
end;
$$;

create or replace function public.factory_enqueue_kpss_turkce_batch()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object('queued', 0, 'skipped', 'autonomous_writing_disabled');
end;
$$;

grant execute on function public.tts_try_lock() to service_role;
grant execute on function public.tts_unlock() to service_role;
grant execute on function public.factory_pending_tts_count() to service_role;
grant execute on function public.factory_active_media_lesson_count() to service_role;
grant execute on function public.factory_enqueue_media_batch() to service_role;
grant execute on function public.factory_enqueue_media_batch() to authenticated;
grant execute on function public.factory_orchestrate_internal() to service_role;
grant execute on function public.factory_orchestrate_internal() to authenticated;
grant execute on function public.factory_claim_jobs_internal(int) to service_role;
grant execute on function public.factory_claim_jobs_internal(int) to authenticated;
grant execute on function public.admin_queue_missing_content(uuid, uuid, uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.factory_enqueue_kpss_turkce_batch() to service_role;
