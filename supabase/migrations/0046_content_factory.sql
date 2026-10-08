-- Phase 2E: content factory queue, fingerprints, production pause.

create table if not exists public.content_factory_settings (
  id integer primary key default 1 check (id = 1),
  production_enabled boolean not null default false,
  max_concurrency integer not null default 2,
  updated_at timestamptz not null default now(),
  constraint content_factory_settings_concurrency_check check (max_concurrency between 1 and 8)
);

insert into public.content_factory_settings (id, production_enabled, max_concurrency)
values (1, false, 2)
on conflict (id) do nothing;

create table if not exists public.content_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete restrict,
  curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  memory_lesson_id uuid references public.memory_lessons(id) on delete set null,
  exam_id uuid,
  subject_id uuid,
  unit_id uuid,
  topic_id uuid,
  job_type text not null default 'full_lesson',
  status text not null default 'queued',
  priority integer not null default 0,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  error_code text,
  error_message text,
  stage_text_done boolean not null default false,
  stage_pedagogy_done boolean not null default false,
  stage_questions_done boolean not null default false,
  stage_media_done boolean not null default false,
  media_done_count integer not null default 0,
  media_total_count integer not null default 0,
  events jsonb not null default '[]'::jsonb,
  lesson_scope text not null default 'core',
  coverage_mode text not null default 'core',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  constraint content_generation_jobs_type_check
    check (job_type in ('full_lesson', 'text_only', 'media_only', 'questions_only', 'pedagogy_refresh')),
  constraint content_generation_jobs_status_check
    check (status in (
      'queued',
      'generating_text',
      'validating_pedagogy',
      'generating_questions',
      'generating_media',
      'pending_validation',
      'completed',
      'failed',
      'cancelled'
    )),
  constraint content_generation_jobs_attempts_check check (attempt_count >= 0 and max_attempts >= 1)
);

create unique index if not exists content_generation_jobs_active_full_version_uidx
  on public.content_generation_jobs (canonical_topic_id, curriculum_version_id)
  where job_type = 'full_lesson'
    and curriculum_version_id is not null
    and status not in ('completed', 'failed', 'cancelled');

create unique index if not exists content_generation_jobs_active_full_null_uidx
  on public.content_generation_jobs (canonical_topic_id)
  where job_type = 'full_lesson'
    and curriculum_version_id is null
    and status not in ('completed', 'failed', 'cancelled');

create index if not exists content_generation_jobs_status_idx
  on public.content_generation_jobs (status, priority desc, created_at);

create table if not exists public.topic_breakdown_sessions (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  canonical_unit_id uuid references public.canonical_units(id) on delete set null,
  canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  status text not null default 'draft',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_breakdown_sessions_status_check
    check (status in ('draft', 'approved', 'rejected'))
);

create table if not exists public.topic_breakdown_suggestions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.topic_breakdown_sessions(id) on delete cascade,
  suggested_name text not null,
  note text,
  status text not null default 'pending',
  merge_into_id uuid references public.topic_breakdown_suggestions(id) on delete set null,
  canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint topic_breakdown_suggestions_status_check
    check (status in ('pending', 'approved', 'rejected', 'merged'))
);

alter table public.memory_lesson_questions
  add column if not exists difficulty text,
  add column if not exists question_fingerprint text,
  add column if not exists semantic_key text,
  add column if not exists canonical_topic_id uuid references public.canonical_topics(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_lesson_questions_difficulty_check') then
    alter table public.memory_lesson_questions
      add constraint memory_lesson_questions_difficulty_check
      check (difficulty is null or difficulty in ('easy', 'medium', 'hard'));
  end if;
end $$;

create unique index if not exists memory_lesson_questions_fingerprint_uidx
  on public.memory_lesson_questions (lesson_id, question_fingerprint)
  where question_fingerprint is not null;

alter table public.questions
  add column if not exists question_fingerprint text,
  add column if not exists semantic_key text,
  add column if not exists canonical_topic_id uuid;

create unique index if not exists questions_fingerprint_uidx
  on public.questions (question_fingerprint)
  where question_fingerprint is not null;

create or replace function public.normalize_question_text(p_text text)
returns text
language sql
immutable
as $$
  select trim(both from regexp_replace(
    lower(translate(coalesce(p_text, ''),
      'çğıöşüâîûÇĞİÖŞÜÂÎÛIı',
      'cgiosuaiCGIOSUAIIi')),
    '\s+',
    ' ',
    'g'
  ));
$$;

create or replace function public.compute_question_fingerprint(p_text text, p_options jsonb, p_correct text)
returns text
language plpgsql
immutable
as $$
declare
  v_opts text[];
  v_correct text := upper(coalesce(p_correct, ''));
  v_correct_text text := '';
  v_payload text;
begin
  if p_options is null then
    v_opts := array[]::text[];
  elsif jsonb_typeof(p_options) = 'object' then
    select coalesce(array_agg(public.normalize_question_text(value) order by public.normalize_question_text(value)), array[]::text[])
      into v_opts
    from jsonb_each_text(p_options);
    v_correct_text := public.normalize_question_text(p_options->>v_correct);
  else
    select coalesce(array_agg(public.normalize_question_text(elem) order by public.normalize_question_text(elem)), array[]::text[])
      into v_opts
    from (
      select coalesce(value->>'text', value#>>'{}') as elem
      from jsonb_array_elements(p_options)
    ) s;
  end if;
  v_payload := public.normalize_question_text(p_text) || '|' || array_to_string(v_opts, '|') || '|' || coalesce(v_correct_text, '');
  return encode(extensions.digest(v_payload, 'sha256'), 'hex');
end;
$$;

create or replace function public.memory_lesson_questions_fingerprint_tg()
returns trigger
language plpgsql
as $$
begin
  new.question_fingerprint := public.compute_question_fingerprint(new.question_text, new.options, new.correct_answer);
  if new.semantic_key is null then
    new.semantic_key := public.normalize_question_text(new.question_text);
  end if;
  return new;
end;
$$;

drop trigger if exists memory_lesson_questions_fingerprint on public.memory_lesson_questions;
create trigger memory_lesson_questions_fingerprint
  before insert or update of question_text, options, correct_answer
  on public.memory_lesson_questions
  for each row execute procedure public.memory_lesson_questions_fingerprint_tg();

create or replace function public.questions_fingerprint_tg()
returns trigger
language plpgsql
as $$
begin
  new.question_fingerprint := public.compute_question_fingerprint(new.stem, new.choices, new.correct_choice);
  if new.semantic_key is null then
    new.semantic_key := public.normalize_question_text(new.stem);
  end if;
  return new;
end;
$$;

drop trigger if exists questions_fingerprint on public.questions;
create trigger questions_fingerprint
  before insert or update of stem, choices, correct_choice
  on public.questions
  for each row execute procedure public.questions_fingerprint_tg();

drop trigger if exists content_generation_jobs_set_updated_at on public.content_generation_jobs;
create trigger content_generation_jobs_set_updated_at
  before update on public.content_generation_jobs
  for each row execute procedure public.set_updated_at();

drop trigger if exists content_factory_settings_set_updated_at on public.content_factory_settings;
create trigger content_factory_settings_set_updated_at
  before update on public.content_factory_settings
  for each row execute procedure public.set_updated_at();

alter table public.content_generation_jobs enable row level security;
alter table public.content_factory_settings enable row level security;
alter table public.topic_breakdown_sessions enable row level security;
alter table public.topic_breakdown_suggestions enable row level security;

drop policy if exists content_generation_jobs_admin on public.content_generation_jobs;
create policy content_generation_jobs_admin on public.content_generation_jobs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists content_factory_settings_admin on public.content_factory_settings;
create policy content_factory_settings_admin on public.content_factory_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists topic_breakdown_sessions_admin on public.topic_breakdown_sessions;
create policy topic_breakdown_sessions_admin on public.topic_breakdown_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists topic_breakdown_suggestions_admin on public.topic_breakdown_suggestions;
create policy topic_breakdown_suggestions_admin on public.topic_breakdown_suggestions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.content_generation_jobs to authenticated;
grant select, insert, update, delete on public.content_factory_settings to authenticated;
grant select, insert, update, delete on public.topic_breakdown_sessions to authenticated;
grant select, insert, update, delete on public.topic_breakdown_suggestions to authenticated;

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
    'max_concurrency', v_row.max_concurrency,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.admin_factory_set_production(p_enabled boolean, p_max_concurrency integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.content_factory_settings
  set production_enabled = coalesce(p_enabled, production_enabled),
      max_concurrency = coalesce(p_max_concurrency, max_concurrency)
  where id = 1;
  perform public.write_admin_audit(
    'factory_production',
    'content_factory',
    '1',
    jsonb_build_object('enabled', p_enabled, 'concurrency', p_max_concurrency)
  );
  return public.admin_factory_get_settings();
end;
$$;

create or replace function public.admin_factory_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'total_topics', (select count(*) from public.canonical_topics),
    'ready', (
      select count(distinct canonical_topic_id) from public.memory_lessons
      where status in ('approved', 'published') and canonical_topic_id is not null
    ),
    'queued', (select count(*) from public.content_generation_jobs where status = 'queued'),
    'generating', (
      select count(*) from public.content_generation_jobs
      where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media')
    ),
    'pending_validation', (
      select count(*) from public.memory_lessons where status = 'pending_validation'
    ),
    'failed', (select count(*) from public.content_generation_jobs where status = 'failed')
  );
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
  v_user uuid;
  v_version uuid := p_curriculum_version_id;
  v_generate int := 0;
  v_reused int := 0;
  v_skipped int := 0;
  v_queued int := 0;
  v_row record;
  v_lesson uuid;
  v_active int;
  v_do_insert boolean := false;
begin
  v_user := public.require_admin();
  if v_version is null and p_exam_id is not null then
    select id into v_version from public.get_active_curriculum_version(p_exam_id);
  end if;
  if v_version is null then
    raise exception 'NO_CURRICULUM';
  end if;

  for v_row in
    select m.*
    from public.exam_topic_map m
    where m.curriculum_version_id = v_version
      and m.included = true
      and (p_subject_id is null or m.subject_id = p_subject_id)
      and (p_unit_id is null or m.unit_id = p_unit_id)
  loop
    select l.id into v_lesson
    from public.memory_lessons l
    where l.canonical_topic_id = v_row.canonical_topic_id
      and l.lesson_scope = 'core'
      and l.status in ('approved', 'published')
    order by case l.status when 'published' then 0 else 1 end
    limit 1;

    if v_lesson is not null then
      v_reused := v_reused + 1;
      continue;
    end if;

    if exists (
      select 1 from public.content_generation_jobs j
      where j.canonical_topic_id = v_row.canonical_topic_id
        and j.job_type = 'full_lesson'
        and (j.curriculum_version_id is not distinct from v_version)
        and j.status not in ('completed', 'failed', 'cancelled')
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_generate := v_generate + 1;
  end loop;

  v_do_insert := p_enqueue and (v_generate <= 8 or coalesce(p_confirm, false));

  if v_do_insert then
    for v_row in
      select m.*
      from public.exam_topic_map m
      where m.curriculum_version_id = v_version
        and m.included = true
        and (p_subject_id is null or m.subject_id = p_subject_id)
        and (p_unit_id is null or m.unit_id = p_unit_id)
    loop
      select l.id into v_lesson
      from public.memory_lessons l
      where l.canonical_topic_id = v_row.canonical_topic_id
        and l.lesson_scope = 'core'
        and l.status in ('approved', 'published')
      order by case l.status when 'published' then 0 else 1 end
      limit 1;

      if v_lesson is not null then
        insert into public.memory_lesson_exam_map (lesson_id, curriculum_version_id, canonical_topic_id, usage_mode, is_active)
        values (v_lesson, v_version, v_row.canonical_topic_id, coalesce(v_row.coverage_mode, 'core'), true)
        on conflict (lesson_id, curriculum_version_id)
        do update set is_active = true, usage_mode = excluded.usage_mode;
        continue;
      end if;

      if exists (
        select 1 from public.content_generation_jobs j
        where j.canonical_topic_id = v_row.canonical_topic_id
          and j.job_type = 'full_lesson'
          and (j.curriculum_version_id is not distinct from v_version)
          and j.status not in ('completed', 'failed', 'cancelled')
      ) then
        continue;
      end if;

      insert into public.content_generation_jobs (
        canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
        job_type, status, coverage_mode, lesson_scope, created_by
      )
      values (
        v_row.canonical_topic_id, v_version, p_exam_id, v_row.subject_id, v_row.unit_id, v_row.topic_id,
        'full_lesson', 'queued', coalesce(v_row.coverage_mode, 'core'), 'core', v_user
      );
      v_queued := v_queued + 1;
    end loop;
  end if;

  if p_enqueue then
    perform public.write_admin_audit('factory_queue', 'content_factory', v_version::text, jsonb_build_object(
      'queued', v_queued, 'reused', v_reused, 'skipped', v_skipped
    ));
  end if;

  select count(*) into v_active
  from public.content_generation_jobs
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media');

  return jsonb_build_object(
    'generate', v_generate,
    'reused', v_reused,
    'skipped', v_skipped,
    'queued', v_queued,
    'needs_confirm', (v_generate > 8 and not coalesce(p_confirm, false)),
    'active_jobs', v_active,
    'curriculum_version_id', v_version
  );
end;
$$;

create or replace function public.admin_queue_test_topic()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_topic public.canonical_topics;
  v_map public.exam_topic_map;
  v_job public.content_generation_jobs;
begin
  v_user := public.require_admin();
  select * into v_topic from public.canonical_topics where slug = 'kut-anlayisi' limit 1;
  if v_topic.id is null then raise exception 'NOT_FOUND'; end if;

  if exists (
    select 1 from public.memory_lessons
    where canonical_topic_id = v_topic.id and status in ('approved', 'published')
  ) then
    return jsonb_build_object('action', 'reused', 'canonical_topic_id', v_topic.id);
  end if;

  select * into v_job
  from public.content_generation_jobs
  where canonical_topic_id = v_topic.id
    and job_type = 'full_lesson'
    and status not in ('completed', 'failed', 'cancelled')
  limit 1;
  if v_job.id is not null then
    return jsonb_build_object('action', 'exists', 'job_id', v_job.id);
  end if;

  select * into v_map
  from public.exam_topic_map
  where canonical_topic_id = v_topic.id
  order by created_at desc
  limit 1;

  insert into public.content_generation_jobs (
    canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
    job_type, status, created_by
  )
  values (
    v_topic.id, v_map.curriculum_version_id, null, v_map.subject_id, v_map.unit_id, v_map.topic_id,
    'full_lesson', 'queued', v_user
  )
  returning * into v_job;

  return jsonb_build_object('action', 'queued', 'job_id', v_job.id, 'canonical_topic_id', v_topic.id);
end;
$$;

create or replace function public.admin_factory_claim_jobs(p_limit integer)
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
  perform public.require_admin();
  select production_enabled, max_concurrency into v_enabled, v_max
  from public.content_factory_settings where id = 1;
  if not v_enabled then
    return;
  end if;
  select count(*) into v_busy
  from public.content_generation_jobs
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media');
  v_take := greatest(0, least(coalesce(p_limit, 2), v_max - v_busy));
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

create or replace function public.admin_factory_retry_job(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.content_generation_jobs;
begin
  perform public.require_admin();
  select * into v_job from public.content_generation_jobs where id = p_id;
  if v_job.id is null then raise exception 'NOT_FOUND'; end if;
  if v_job.attempt_count >= v_job.max_attempts and v_job.status = 'failed' then
    update public.content_generation_jobs
    set status = 'queued', error_code = null, error_message = null, finished_at = null
    where id = p_id;
  else
    update public.content_generation_jobs
    set status = 'queued', error_code = null, error_message = null, finished_at = null
    where id = p_id and status in ('failed', 'cancelled');
  end if;
  return jsonb_build_object('id', p_id, 'status', 'queued');
end;
$$;

create or replace function public.admin_factory_cancel_job(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.content_generation_jobs
  set status = 'cancelled', finished_at = now()
  where id = p_id and status not in ('completed', 'cancelled');
  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end;
$$;

create or replace function public.admin_factory_retry_failed(p_curriculum_version_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  perform public.require_admin();
  update public.content_generation_jobs
  set status = 'queued', error_code = null, error_message = null, finished_at = null
  where status = 'failed'
    and (p_curriculum_version_id is null or curriculum_version_id = p_curriculum_version_id);
  get diagnostics v_n = row_count;
  return jsonb_build_object('retried', v_n);
end;
$$;

create or replace function public.admin_approve_breakdown_suggestion(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sug public.topic_breakdown_suggestions;
  v_session public.topic_breakdown_sessions;
  v_slug text;
  v_topic uuid;
begin
  perform public.require_admin();
  select * into v_sug from public.topic_breakdown_suggestions where id = p_id;
  if v_sug.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_session from public.topic_breakdown_sessions where id = v_sug.session_id;
  if v_session.canonical_unit_id is null then raise exception 'NO_CANONICAL'; end if;
  v_slug := public.catalog_slug_from_name(v_sug.suggested_name);
  select id into v_topic
  from public.canonical_topics
  where canonical_unit_id = v_session.canonical_unit_id
    and (slug = v_slug or lower(name) = lower(v_sug.suggested_name))
  limit 1;
  if v_topic is null then
    insert into public.canonical_topics (canonical_unit_id, name, slug)
    values (v_session.canonical_unit_id, v_sug.suggested_name, v_slug)
    returning id into v_topic;
  end if;
  update public.topic_breakdown_suggestions
  set status = 'approved', canonical_topic_id = v_topic
  where id = p_id;
  return jsonb_build_object('canonical_topic_id', v_topic, 'name', v_sug.suggested_name);
end;
$$;

revoke all on function public.normalize_question_text(text) from public;
revoke all on function public.compute_question_fingerprint(text, jsonb, text) from public;
revoke all on function public.admin_factory_get_settings() from public;
revoke all on function public.admin_factory_set_production(boolean, integer) from public;
revoke all on function public.admin_factory_stats() from public;
revoke all on function public.admin_queue_missing_content(uuid, uuid, uuid, uuid, boolean, boolean) from public;
revoke all on function public.admin_queue_test_topic() from public;
revoke all on function public.admin_factory_claim_jobs(integer) from public;
revoke all on function public.admin_factory_retry_job(uuid) from public;
revoke all on function public.admin_factory_cancel_job(uuid) from public;
revoke all on function public.admin_factory_retry_failed(uuid) from public;
revoke all on function public.admin_approve_breakdown_suggestion(uuid) from public;

grant execute on function public.normalize_question_text(text) to authenticated;
grant execute on function public.compute_question_fingerprint(text, jsonb, text) to authenticated;
grant execute on function public.admin_factory_get_settings() to authenticated;
grant execute on function public.admin_factory_set_production(boolean, integer) to authenticated;
grant execute on function public.admin_factory_stats() to authenticated;
grant execute on function public.admin_queue_missing_content(uuid, uuid, uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.admin_queue_test_topic() to authenticated;
grant execute on function public.admin_factory_claim_jobs(integer) to authenticated;
grant execute on function public.admin_factory_retry_job(uuid) to authenticated;
grant execute on function public.admin_factory_cancel_job(uuid) to authenticated;
grant execute on function public.admin_factory_retry_failed(uuid) to authenticated;
grant execute on function public.admin_approve_breakdown_suggestion(uuid) to authenticated;
