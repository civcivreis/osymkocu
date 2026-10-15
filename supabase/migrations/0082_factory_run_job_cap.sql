-- Controlled factory start: never enqueue more than factory_run_job_cap. Default 1. Full scope disabled.

alter table public.content_factory_settings
  add column if not exists factory_run_job_cap int not null default 1,
  add column if not exists scope_mode text not null default 'single_topic',
  add column if not exists scope_exam_code text not null default 'TYT',
  add column if not exists scope_subject_name text not null default 'Türkçe',
  add column if not exists scope_max_topics int not null default 1,
  add column if not exists allow_full_unbounded boolean not null default false;

alter table public.content_factory_settings
  drop constraint if exists content_factory_settings_scope_mode_check;
alter table public.content_factory_settings
  add constraint content_factory_settings_scope_mode_check
  check (scope_mode in ('single_topic', 'single_subject', 'single_exam', 'full'));

alter table public.content_factory_settings
  drop constraint if exists content_factory_settings_run_cap_check;
alter table public.content_factory_settings
  add constraint content_factory_settings_run_cap_check
  check (factory_run_job_cap between 1 and 50);

update public.content_factory_settings
set factory_run_job_cap = 1,
    scope_mode = 'single_topic',
    scope_exam_code = 'TYT',
    scope_subject_name = 'Türkçe',
    scope_max_topics = 1,
    allow_full_unbounded = false,
    max_concurrency = 1
where id = 1;

create or replace function public.factory_open_generation_count()
returns int
language sql
stable
as $$
  select count(*)::int
  from public.content_generation_jobs
  where status in ('queued', 'generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media');
$$;

create or replace function public.admin_factory_set_run_cap(p_cap int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_super_admin();
  if p_cap is null or p_cap < 1 or p_cap > 50 then raise exception 'INVALID_INPUT'; end if;
  update public.content_factory_settings
  set factory_run_job_cap = p_cap, updated_at = now()
  where id = 1;
  return public.admin_factory_get_settings();
end;
$$;

create or replace function public.admin_factory_set_scope(
  p_scope_mode text,
  p_exam_code text default null,
  p_subject_name text default null,
  p_max_topics int default null,
  p_allow_full boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(nullif(trim(p_scope_mode), ''), 'single_topic');
begin
  perform public.require_super_admin();
  if v_mode not in ('single_topic', 'single_subject', 'single_exam', 'full') then
    raise exception 'INVALID_INPUT';
  end if;
  if v_mode = 'full' and coalesce(p_allow_full, false) is not true then
    raise exception 'FULL_SCOPE_DISABLED';
  end if;
  update public.content_factory_settings
  set scope_mode = v_mode,
      scope_exam_code = coalesce(nullif(trim(p_exam_code), ''), scope_exam_code),
      scope_subject_name = coalesce(nullif(trim(p_subject_name), ''), scope_subject_name),
      scope_max_topics = greatest(1, least(coalesce(p_max_topics, scope_max_topics), factory_run_job_cap)),
      allow_full_unbounded = case when v_mode = 'full' then coalesce(p_allow_full, false) else false end,
      updated_at = now()
  where id = 1;
  return public.admin_factory_get_settings();
end;
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
    'tts_workers', v_row.tts_workers,
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
    'updated_at', v_row.updated_at
  );
end;
$$;

drop function if exists public.admin_factory_start_motor(boolean);

create function public.admin_factory_start_motor(
  p_confirm boolean default false,
  p_scope_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preview jsonb;
  v_run jsonb;
  v_mode text;
  v_allow boolean;
  v_row public.content_factory_settings;
begin
  perform public.require_admin();
  perform public.bootstrap_supported_exams();
  select * into v_row from public.content_factory_settings where id = 1;
  v_mode := coalesce(nullif(trim(p_scope_mode), ''), v_row.scope_mode, 'single_topic');
  if v_mode not in ('single_topic', 'single_subject', 'single_exam', 'full') then
    v_mode := 'single_topic';
  end if;
  v_allow := coalesce(v_row.allow_full_unbounded, false);
  if v_mode = 'full' and v_allow is not true then
    raise exception 'FULL_SCOPE_DISABLED';
  end if;
  update public.content_factory_settings
  set scope_mode = v_mode,
      factory_run_job_cap = 1,
      scope_max_topics = 1,
      max_concurrency = 1,
      updated_at = now()
  where id = 1;

  v_preview := public.admin_factory_preview_all();
  if not coalesce(p_confirm, false) then
    return v_preview || jsonb_build_object(
      'needs_confirm', true,
      'queued', 0,
      'scope_mode', v_mode,
      'factory_run_job_cap', 1,
      'scope_exam_code', v_row.scope_exam_code,
      'scope_subject_name', v_row.scope_subject_name
    );
  end if;
  update public.content_factory_settings
  set production_enabled = true, engine_state = 'running', last_idle_reason = 'started', updated_at = now()
  where id = 1;
  v_run := public.factory_orchestrate_internal();
  perform public.write_admin_audit('factory_motor_start', 'content_factory', '1', v_run);
  return v_preview || v_run || jsonb_build_object(
    'needs_confirm', false,
    'production_enabled', true,
    'engine_state', 'running',
    'scope_mode', v_mode,
    'factory_run_job_cap', 1
  );
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
  v_exam record;
  v_version uuid;
  v_enqueued int := 0;
  v_lessons int := 0;
  v_decomp int := 0;
  v_active int;
  v_health jsonb;
  v_cfg public.content_factory_settings;
  v_room int;
  v_topic_limit int;
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

  if coalesce(v_cfg.scope_mode, 'single_topic') = 'full' and coalesce(v_cfg.allow_full_unbounded, false) is not true then
    update public.content_factory_settings set scope_mode = 'single_topic', updated_at = now() where id = 1;
    v_cfg.scope_mode := 'single_topic';
  end if;

  perform public.bootstrap_supported_exams();
  perform public.seed_missing_broad_segments();
  perform public.promote_lesson_segments();
  perform public.prepare_leaf_master_topics();

  v_room := greatest(0, coalesce(v_cfg.factory_run_job_cap, 1) - public.factory_open_generation_count());
  v_topic_limit := least(coalesce(v_cfg.scope_max_topics, 1), v_room, coalesce(v_cfg.factory_run_job_cap, 1));

  for v_exam in
    select e.id, e.code
    from public.exam_catalog e
    left join public.factory_exam_settings f on f.exam_id = e.id
    where e.is_active
      and e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
      and coalesce(f.is_enabled, true)
      and (
        (v_cfg.scope_mode = 'full' and v_cfg.allow_full_unbounded)
        or e.code = coalesce(v_cfg.scope_exam_code, 'TYT')
      )
  loop
    if v_room <= 0 or v_topic_limit <= 0 then exit; end if;
    select id into v_version from public.get_active_curriculum_version(v_exam.id);
    if v_version is null then continue; end if;

    if v_cfg.scope_mode in ('single_exam', 'full') then
      insert into public.factory_pipeline_jobs (exam_id, job_kind, dedupe_key, curriculum_version_id, canonical_topic_id, status)
      select v_exam.id, 'decompose_topic', 'decompose-topic:' || ct.id::text, v_version, ct.id, 'queued'
      from public.canonical_topics ct
      join public.exam_topic_map m on m.canonical_topic_id = ct.id and m.curriculum_version_id = v_version and m.included
      where ct.needs_further_decomposition
         or (ct.too_broad and coalesce(ct.keep_single_override, false) = false
             and not exists (select 1 from public.canonical_topic_segments s where s.canonical_topic_id = ct.id))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_decomp = row_count;
    end if;

    insert into public.content_generation_jobs (
      canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
      job_type, status, coverage_mode, lesson_scope
    )
    select q.canonical_topic_id, q.curriculum_version_id, q.exam_id, q.subject_id, q.unit_id, q.topic_id,
           'full_lesson', 'queued', q.coverage_mode, 'core'
    from (
      select m.canonical_topic_id, v_version as curriculum_version_id, v_exam.id as exam_id,
             m.subject_id, m.unit_id, m.topic_id, coalesce(m.coverage_mode, 'core') as coverage_mode
      from public.exam_topic_map m
      left join public.subject_catalog sc on sc.id = m.subject_id
      where m.curriculum_version_id = v_version
        and m.included
        and public.canonical_topic_factory_ready(m.canonical_topic_id)
        and (
          v_cfg.scope_mode = 'single_exam'
          or v_cfg.scope_mode = 'full'
          or lower(coalesce(sc.name, '')) = lower(coalesce(v_cfg.scope_subject_name, 'Türkçe'))
        )
        and not exists (
          select 1 from public.memory_lessons l
          where l.canonical_topic_id = m.canonical_topic_id
        )
        and not exists (
          select 1 from public.content_generation_jobs j
          where j.canonical_topic_id = m.canonical_topic_id
            and j.job_type = 'full_lesson'
            and j.status not in ('completed', 'failed', 'cancelled')
        )
        and not public.topic_ordering_blocks_generation(m.canonical_topic_id)
      order by m.sort_order nulls last, m.canonical_topic_id
      limit v_topic_limit
    ) q;
    get diagnostics v_lessons = row_count;
    v_enqueued := v_enqueued + v_lessons;
    v_room := greatest(0, coalesce(v_cfg.factory_run_job_cap, 1) - public.factory_open_generation_count());
    v_topic_limit := least(v_topic_limit, v_room);
  end loop;

  update public.content_factory_settings
  set last_orchestrated_at = now(),
      last_idle_reason = case when v_enqueued > 0 then 'working' else 'idle' end,
      production_enabled = true,
      updated_at = now()
  where id = 1;

  v_health := public.refresh_factory_health();
  return jsonb_build_object(
    'state', 'running',
    'lesson_jobs', v_enqueued,
    'factory_run_job_cap', v_cfg.factory_run_job_cap,
    'scope_mode', v_cfg.scope_mode,
    'health', v_health
  );
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
begin
  select production_enabled, engine_state, max_concurrency, factory_run_job_cap
    into v_enabled, v_state, v_max, v_cap
  from public.content_factory_settings where id = 1;
  if not (v_enabled or v_state in ('running', 'stopping')) then
    return query
    with picked as (
      select id from public.content_generation_jobs
      where status = 'queued' and priority >= 1000
      order by priority desc, created_at
      for update skip locked
      limit 1
    )
    update public.content_generation_jobs j
    set status = 'generating_text',
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
    order by priority desc, created_at
    for update skip locked
    limit v_take
  )
  update public.content_generation_jobs j
    set status = 'generating_text',
      started_at = coalesce(j.started_at, now()),
      attempt_count = j.attempt_count + 1,
      error_code = null,
      error_message = null
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

grant execute on function public.admin_factory_start_motor(boolean, text) to authenticated;
grant execute on function public.admin_factory_set_run_cap(int) to authenticated;
grant execute on function public.admin_factory_set_scope(text, text, text, int, boolean) to authenticated;
