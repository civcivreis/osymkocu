-- Phase 3F: one-click autonomous factory. Engine stays paused. No mass generation.

alter table public.content_factory_settings
  add column if not exists engine_state text not null default 'paused',
  add column if not exists wake_secret text,
  add column if not exists last_orchestrated_at timestamptz,
  add column if not exists last_idle_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_factory_settings_engine_state_check') then
    alter table public.content_factory_settings
      add constraint content_factory_settings_engine_state_check
      check (engine_state in ('paused', 'running', 'stopping', 'error'));
  end if;
end $$;

update public.content_factory_settings
set engine_state = 'paused',
    production_enabled = false,
    wake_secret = coalesce(wake_secret, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
where id = 1;

create or replace function public.bootstrap_supported_exams()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.exam_catalog (code, name, is_active, sort_order)
  select x.code, x.name, true, x.sort_order
  from (values
    ('TYT', 'TYT', 10),
    ('AYT', 'AYT', 20),
    ('KPSS_ORTAOGRETIM', 'KPSS Ortaöğretim', 30),
    ('KPSS_ONLISANS', 'KPSS Önlisans', 40),
    ('KPSS_LISANS', 'KPSS Lisans', 50)
  ) as x(code, name, sort_order)
  where not exists (select 1 from public.exam_catalog e where e.code = x.code);

  update public.exam_catalog e
  set name = x.name, is_active = true, sort_order = x.sort_order
  from (values
    ('TYT', 'TYT', 10),
    ('AYT', 'AYT', 20),
    ('KPSS_ORTAOGRETIM', 'KPSS Ortaöğretim', 30),
    ('KPSS_ONLISANS', 'KPSS Önlisans', 40),
    ('KPSS_LISANS', 'KPSS Lisans', 50)
  ) as x(code, name, sort_order)
  where e.code = x.code;

  insert into public.curriculum_versions (exam_id, code, name, revision_label, status, is_default, manually_activated)
  select e.id, e.code || '_CURRENT', 'Güncel ' || e.name || ' Müfredatı', 'Revizyon 1', 'draft', true, false
  from public.exam_catalog e
  where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
    and not exists (select 1 from public.curriculum_versions v where v.exam_id = e.id);

  insert into public.factory_exam_settings (exam_id, is_enabled)
  select e.id, true
  from public.exam_catalog e
  where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
  on conflict (exam_id) do nothing;

  insert into public.curriculum_sources (name, source_type, exam_id, priority)
  select 'Mevcut katalog (' || e.name || ')', 'catalog_snapshot', e.id, 10
  from public.exam_catalog e
  where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
    and not exists (
      select 1 from public.curriculum_sources s
      where s.exam_id = e.id and s.source_type = 'catalog_snapshot'
    );

  return jsonb_build_object('exams', 5);
end;
$$;

select public.bootstrap_supported_exams();

create table if not exists public.factory_pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_catalog(id) on delete cascade,
  job_kind text not null,
  canonical_topic_id uuid references public.canonical_topics(id) on delete cascade,
  unit_id uuid,
  curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  dedupe_key text not null,
  status text not null default 'queued',
  skip_reason text,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  locked_until timestamptz,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint factory_pipeline_jobs_kind_check check (job_kind in (
    'curriculum_sync', 'canonical_map', 'decompose_unit', 'ordering',
    'lesson', 'pool_fill', 'media', 'validate'
  )),
  constraint factory_pipeline_jobs_status_check check (status in (
    'pending', 'queued', 'running', 'complete', 'failed', 'needs_review', 'skipped'
  )),
  unique (dedupe_key)
);

create index if not exists factory_pipeline_jobs_status_idx
  on public.factory_pipeline_jobs (status, job_kind, created_at);

alter table public.factory_pipeline_jobs enable row level security;
drop policy if exists factory_pipeline_jobs_admin on public.factory_pipeline_jobs;
create policy factory_pipeline_jobs_admin on public.factory_pipeline_jobs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.factory_pipeline_jobs to authenticated;

create or replace function public.enqueue_pipeline_job(
  p_exam uuid,
  p_kind text,
  p_key text,
  p_version uuid default null,
  p_topic uuid default null,
  p_unit uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.factory_pipeline_jobs (
    exam_id, job_kind, dedupe_key, curriculum_version_id, canonical_topic_id, unit_id, status, payload
  ) values (
    p_exam, p_kind, p_key, p_version, p_topic, p_unit, 'queued', coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (dedupe_key) do update
    set updated_at = now(),
        status = case
          when factory_pipeline_jobs.status in ('complete', 'skipped') then factory_pipeline_jobs.status
          when factory_pipeline_jobs.status = 'failed' and factory_pipeline_jobs.attempt_count >= factory_pipeline_jobs.max_attempts then 'failed'
          else 'queued'
        end
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_factory_state_audit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam record;
  v_version uuid;
  v_topics int;
  v_ready int;
  v_exams jsonb := '[]'::jsonb;
  v_skip jsonb := '[]'::jsonb;
begin
  perform public.require_admin();
  perform public.bootstrap_supported_exams();
  for v_exam in
    select e.id, e.code, e.name, e.sort_order, coalesce(f.is_enabled, true) as is_enabled
    from public.exam_catalog e
    left join public.factory_exam_settings f on f.exam_id = e.id
    where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
    order by e.sort_order
  loop
    if not v_exam.is_enabled then
      v_skip := v_skip || jsonb_build_array(jsonb_build_object('exam', v_exam.name, 'reason', 'disabled_exam'));
      v_exams := v_exams || jsonb_build_array(jsonb_build_object(
        'exam', v_exam.name, 'code', v_exam.code, 'exam_id', v_exam.id,
        'next_stage', 'disabled', 'curriculum_state', 'disabled',
        'note', 'disabled_exam', 'generate', 0, 'lessons_unknown', true
      ));
      continue;
    end if;
    select id into v_version from public.get_active_curriculum_version(v_exam.id);
    select count(*) into v_topics from public.exam_topic_map m where m.curriculum_version_id = v_version and m.included;
    select count(distinct m.canonical_topic_id) into v_ready
    from public.exam_topic_map m
    join public.memory_lessons l on l.canonical_topic_id = m.canonical_topic_id
    where m.curriculum_version_id = v_version and m.included
      and l.status in ('approved', 'published', 'pending_validation');
    if v_version is null or coalesce(v_topics, 0) = 0 then
      v_exams := v_exams || jsonb_build_array(jsonb_build_object(
        'exam', v_exam.name, 'code', v_exam.code, 'exam_id', v_exam.id,
        'curriculum_state', 'needs_sync',
        'next_stage', 'curriculum_sync',
        'note', 'Müfredat senkronizasyonu gerekli',
        'topics', coalesce(v_topics, 0),
        'lessons_ready', coalesce(v_ready, 0),
        'generate', 0,
        'lessons_unknown', true,
        'lesson_estimate', 'müfredat sonrası'
      ));
    else
      v_exams := v_exams || jsonb_build_array(jsonb_build_object(
        'exam', v_exam.name, 'code', v_exam.code, 'exam_id', v_exam.id,
        'curriculum_state', 'mapped',
        'next_stage', 'pipeline',
        'note', v_topics::text || ' konu denetlenecek',
        'topics', v_topics,
        'lessons_ready', coalesce(v_ready, 0),
        'generate', greatest(v_topics - coalesce(v_ready, 0), 0),
        'lessons_unknown', false,
        'lesson_estimate', (v_topics - coalesce(v_ready, 0))::text || ' konu hazırlanacak'
      ));
    end if;
  end loop;
  return jsonb_build_object(
    'exams', v_exams,
    'skips', v_skip,
    'engine_state', (select engine_state from public.content_factory_settings where id = 1),
    'production_enabled', (select production_enabled from public.content_factory_settings where id = 1)
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
  v_sync int := 0;
  v_order int := 0;
  v_active int;
begin
  select engine_state into v_state from public.content_factory_settings where id = 1;
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
    return jsonb_build_object('state', coalesce(v_state, 'paused'), 'enqueued', 0);
  end if;

  perform public.bootstrap_supported_exams();

  for v_exam in
    select e.id, e.code, e.name
    from public.exam_catalog e
    left join public.factory_exam_settings f on f.exam_id = e.id
    where e.is_active
      and e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
      and coalesce(f.is_enabled, true)
  loop
    select id into v_version from public.get_active_curriculum_version(v_exam.id);
    perform public.enqueue_pipeline_job(v_exam.id, 'curriculum_sync', 'sync:' || v_exam.id::text, v_version, null, null, jsonb_build_object('exam_code', v_exam.code));
    v_enqueued := v_enqueued + 1;
    begin
      perform public.admin_curriculum_sync(v_exam.id, false);
      v_sync := v_sync + 1;
      update public.factory_pipeline_jobs
      set status = 'complete', updated_at = now()
      where dedupe_key = 'sync:' || v_exam.id::text;
    exception when others then
      update public.factory_pipeline_jobs
      set status = 'queued', last_error = sqlerrm, updated_at = now()
      where dedupe_key = 'sync:' || v_exam.id::text;
    end;

    select id into v_version from public.get_active_curriculum_version(v_exam.id);
    if v_version is null then continue; end if;

    perform public.enqueue_pipeline_job(v_exam.id, 'ordering', 'order:' || v_version::text, v_version);
    begin
      perform public.get_version_topic_order(v_version);
      v_order := v_order + 1;
      update public.factory_pipeline_jobs set status = 'complete', updated_at = now() where dedupe_key = 'order:' || v_version::text;
    exception when others then
      update public.factory_pipeline_jobs set status = 'queued', last_error = sqlerrm, updated_at = now() where dedupe_key = 'order:' || v_version::text;
    end;

    insert into public.factory_pipeline_jobs (exam_id, job_kind, dedupe_key, curriculum_version_id, unit_id, status)
    select distinct v_exam.id, 'decompose_unit', 'decompose:' || uc.id::text, v_version, uc.id, 'queued'
    from public.unit_catalog uc
    join public.subject_catalog sc on sc.id = uc.subject_id
    join public.topic_catalog tc on tc.unit_id = uc.id
    join public.canonical_topics ct on ct.id = tc.canonical_topic_id
    where sc.exam_id = v_exam.id
      and ct.too_broad = true
      and coalesce(ct.keep_single_override, false) = false
      and not exists (
        select 1 from public.canonical_topic_segments s where s.canonical_topic_id = ct.id
      )
    on conflict (dedupe_key) do nothing;

    insert into public.content_generation_jobs (
      canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
      job_type, status, coverage_mode, lesson_scope
    )
    select m.canonical_topic_id, v_version, v_exam.id, m.subject_id, m.unit_id, m.topic_id,
           'full_lesson', 'queued', coalesce(m.coverage_mode, 'core'), 'core'
    from public.exam_topic_map m
    where m.curriculum_version_id = v_version
      and m.included
      and public.canonical_topic_factory_ready(m.canonical_topic_id)
      and not exists (
        select 1 from public.memory_lessons l
        where l.canonical_topic_id = m.canonical_topic_id
          and l.lesson_scope = 'core'
          and l.status in ('approved', 'published', 'pending_validation')
      )
      and not exists (
        select 1 from public.content_generation_jobs j
        where j.canonical_topic_id = m.canonical_topic_id
          and j.job_type = 'full_lesson'
          and (j.curriculum_version_id is not distinct from v_version)
          and j.status not in ('completed', 'failed', 'cancelled')
      )
      and not public.topic_ordering_blocks_generation(m.canonical_topic_id);

    insert into public.content_generation_jobs (
      canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
      job_type, status, coverage_mode, lesson_scope
    )
    select m.canonical_topic_id, v_version, v_exam.id, m.subject_id, m.unit_id, m.topic_id,
           'questions_only', 'queued', coalesce(m.coverage_mode, 'core'), 'core'
    from public.exam_topic_map m
    join public.memory_lessons l on l.canonical_topic_id = m.canonical_topic_id
    where m.curriculum_version_id = v_version and m.included
      and l.status in ('approved', 'published', 'pending_validation')
      and (
        select count(*)
        from public.questions q
        join public.curriculum_question_sets s on s.id = q.curriculum_question_set_id
        where s.canonical_topic_id = m.canonical_topic_id
          and s.set_type = 'topic_pool'
          and q.question_status <> 'archived'
      ) < (select question_pool_target from public.content_factory_settings where id = 1)
      and not exists (
        select 1 from public.content_generation_jobs j
        where j.canonical_topic_id = m.canonical_topic_id
          and j.job_type = 'questions_only'
          and j.status not in ('completed', 'failed', 'cancelled')
      );
  end loop;

  update public.content_factory_settings
  set last_orchestrated_at = now(),
      last_idle_reason = case
        when not exists (select 1 from public.content_generation_jobs where status in ('queued', 'generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media'))
         and not exists (select 1 from public.factory_pipeline_jobs where status in ('queued', 'running'))
        then 'idle'
        else 'working'
      end,
      updated_at = now()
  where id = 1;

  return jsonb_build_object('state', 'running', 'sync', v_sync, 'ordering', v_order, 'enqueued', v_enqueued);
end;
$$;

create or replace function public.admin_factory_orchestrate()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return public.factory_orchestrate_internal();
end;
$$;

create or replace function public.admin_factory_preview_all()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_audit jsonb;
begin
  perform public.require_admin();
  v_audit := public.admin_factory_state_audit();
  return v_audit || jsonb_build_object(
    'generate', coalesce((select sum((e->>'generate')::int) from jsonb_array_elements(v_audit->'exams') e), 0),
    'reused', 0,
    'skipped', jsonb_array_length(coalesce(v_audit->'skips', '[]'::jsonb)),
    'needs_confirm', true
  );
end;
$$;

create or replace function public.admin_factory_start_motor(p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preview jsonb;
  v_run jsonb;
begin
  perform public.require_admin();
  perform public.bootstrap_supported_exams();
  v_preview := public.admin_factory_preview_all();
  if not coalesce(p_confirm, false) then
    return v_preview || jsonb_build_object('needs_confirm', true, 'queued', 0);
  end if;
  update public.content_factory_settings
  set production_enabled = true, engine_state = 'running', last_idle_reason = 'started', updated_at = now()
  where id = 1;
  v_run := public.factory_orchestrate_internal();
  perform public.write_admin_audit('factory_motor_start', 'content_factory', '1', v_run);
  return v_preview || v_run || jsonb_build_object('needs_confirm', false, 'production_enabled', true, 'engine_state', 'running');
end;
$$;

create or replace function public.admin_factory_pause_motor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active int;
  v_state text;
begin
  perform public.require_admin();
  select count(*) into v_active from public.content_generation_jobs
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media');
  v_state := case when coalesce(v_active, 0) > 0 then 'stopping' else 'paused' end;
  update public.content_factory_settings
  set production_enabled = false,
      engine_state = v_state,
      last_idle_reason = 'paused_by_admin',
      updated_at = now()
  where id = 1;
  perform public.write_admin_audit('factory_motor_pause', 'content_factory', '1', jsonb_build_object('state', v_state, 'active', v_active));
  return jsonb_build_object('engine_state', v_state, 'production_enabled', false, 'active_jobs', v_active);
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
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.admin_factory_set_production(p_enabled boolean, p_max_concurrency int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if p_enabled then
    update public.content_factory_settings
    set production_enabled = true, engine_state = 'running',
        max_concurrency = coalesce(p_max_concurrency, max_concurrency), updated_at = now()
    where id = 1;
  else
    perform public.admin_factory_pause_motor();
  end if;
  return public.admin_factory_get_settings();
end;
$$;

create or replace function public.content_factory_cron_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_secret text;
  v_url text := 'https://qvmhtzpaoxdychyjhqyj.supabase.co/functions/v1/content-factory-orchestrator';
begin
  select engine_state, wake_secret into v_state, v_secret from public.content_factory_settings where id = 1;
  if v_state not in ('running', 'stopping') then return; end if;
  perform public.factory_orchestrate_internal();
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('source', 'cron'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-factory-wake', coalesce(v_secret, ''))
    );
  exception when others then
    null;
  end;
end;
$$;

create or replace function public.admin_claim_pipeline_jobs(p_limit int default 2)
returns setof public.factory_pipeline_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.factory_pipeline_jobs j
  set status = 'running', attempt_count = j.attempt_count + 1, locked_until = now() + interval '8 minutes', updated_at = now()
  where j.id in (
    select id from public.factory_pipeline_jobs
    where status = 'queued' and job_kind in ('decompose_unit', 'curriculum_sync')
      and (locked_until is null or locked_until < now())
    order by created_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  returning *;
end;
$$;

grant execute on function public.bootstrap_supported_exams() to authenticated;
grant execute on function public.admin_factory_state_audit() to authenticated;
grant execute on function public.factory_orchestrate_internal() to authenticated;
grant execute on function public.factory_orchestrate_internal() to service_role;
grant execute on function public.admin_factory_orchestrate() to authenticated;
grant execute on function public.admin_factory_pause_motor() to authenticated;
create or replace function public.factory_claim_jobs_internal(p_limit integer)
returns setof public.content_generation_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_max int;
  v_busy int;
  v_take int;
begin
  select production_enabled, max_concurrency into v_enabled, v_max
  from public.content_factory_settings where id = 1;
  if not v_enabled then
    return;
  end if;
  select count(*) into v_busy
  from public.content_generation_jobs
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media');
  v_take := greatest(0, least(coalesce(p_limit, 2), coalesce(v_max, 2) - v_busy));
  if v_take <= 0 then
    return;
  end if;
  return query
  with picked as (
    select id
    from public.content_generation_jobs
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

grant execute on function public.admin_claim_pipeline_jobs(int) to authenticated;
grant execute on function public.factory_claim_jobs_internal(int) to authenticated;
grant execute on function public.factory_claim_jobs_internal(int) to service_role;

do $$
begin
  perform cron.unschedule('kocum-factory-tick');
exception when others then null;
end $$;

do $$
begin
  perform cron.schedule('kocum-factory-tick', '* * * * *', 'select public.content_factory_cron_tick()');
exception when others then null;
end $$;
