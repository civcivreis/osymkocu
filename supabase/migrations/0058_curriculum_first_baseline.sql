-- First trusted curriculum snapshot is INITIAL_BASELINE, not needs_review.

create or replace function public.curriculum_source_is_trusted(p_type text)
returns boolean
language sql
immutable
as $$
  select p_type in ('catalog_snapshot', 'official_document', 'official_page', 'trusted_dataset', 'admin_json');
$$;

create or replace function public.curriculum_first_snapshot_issues(p_exam uuid, p_source uuid)
returns text
language plpgsql
stable
as $$
declare
  v_exam public.exam_catalog%rowtype;
  v_src public.curriculum_sources%rowtype;
  v_topics int := 0;
  v_mapped int := 0;
  v_conflict int := 0;
  v_dup int := 0;
begin
  select * into v_exam from public.exam_catalog where id = p_exam;
  if v_exam.id is null or v_exam.code is null or v_exam.code !~ '^[A-Z0-9_]+$' then
    return 'exam_unidentified';
  end if;
  select * into v_src from public.curriculum_sources where id = p_source;
  if v_src.id is null or not v_src.is_enabled then
    return 'source_unknown';
  end if;
  if not public.curriculum_source_is_trusted(v_src.source_type) then
    return 'source_untrusted';
  end if;

  select count(*) into v_conflict
  from public.curriculum_sources a
  join public.curriculum_sources b on b.exam_id = a.exam_id and b.id <> a.id and b.is_enabled
  where a.id = p_source
    and a.source_hash is not null
    and b.source_hash is not null
    and a.source_hash <> b.source_hash;
  if v_conflict > 0 then
    return 'source_conflict';
  end if;

  select count(*) into v_dup
  from (
    select lower(name) as n from public.subject_catalog where exam_id = p_exam group by 1 having count(*) > 1
  ) d;
  if v_dup > 0 then
    return 'duplicate_subjects';
  end if;

  select count(*) into v_topics
  from public.topic_catalog t
  join public.unit_catalog u on u.id = t.unit_id
  join public.subject_catalog s on s.id = u.subject_id
  where s.exam_id = p_exam;
  select count(*) into v_mapped
  from public.topic_catalog t
  join public.unit_catalog u on u.id = t.unit_id
  join public.subject_catalog s on s.id = u.subject_id
  where s.exam_id = p_exam and t.canonical_topic_id is not null;
  if v_topics = 0 then
    if v_src.source_type = 'catalog_snapshot' then
      return null;
    end if;
    return 'empty_structure';
  end if;
  if v_mapped < v_topics then
    return 'ambiguous_canonical';
  end if;

  return null;
end;
$$;

create or replace function public.apply_curriculum_initial_baseline(p_exam uuid, p_source uuid, p_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version uuid;
  v_mapped int := 0;
  v_updated int := 0;
begin
  select id into v_version from public.get_active_curriculum_version(p_exam);
  if v_version is null then
    select id into v_version
    from public.curriculum_versions
    where exam_id = p_exam and status <> 'archived'
    order by is_default desc, created_at asc
    limit 1;
  end if;
  if v_version is null then
    insert into public.curriculum_versions (exam_id, code, name, revision_label, status, is_default, manually_activated)
    select e.id, e.code || '_CURRENT', 'Güncel ' || e.name || ' Müfredatı', 'Revizyon 1', 'draft', true, false
    from public.exam_catalog e
    where e.id = p_exam
    returning id into v_version;
  end if;

  insert into public.exam_topic_map (
    curriculum_version_id, canonical_topic_id, subject_id, unit_id, topic_id,
    included, coverage_mode, depth_level, priority, sort_order
  )
  select v_version, t.canonical_topic_id, s.id, u.id, t.id, true, 'core', 'standard', 'normal', coalesce(t.sort_order, 0)
  from public.topic_catalog t
  join public.unit_catalog u on u.id = t.unit_id
  join public.subject_catalog s on s.id = u.subject_id
  where s.exam_id = p_exam
    and t.canonical_topic_id is not null
    and t.is_active
  on conflict (curriculum_version_id, canonical_topic_id) do nothing;
  get diagnostics v_mapped = row_count;

  update public.curriculum_discovery_cache
  set status = 'accepted', validated_at = coalesce(validated_at, now())
  where source_id = p_source and resource_identifier = 'catalog' and content_hash = p_hash;

  update public.curriculum_change_proposals
  set status = 'applied',
      source_id = coalesce(source_id, p_source),
      from_version_id = coalesce(from_version_id, v_version),
      to_version_id = v_version,
      diff = coalesce(diff, '{}'::jsonb) || jsonb_build_object(
        'result', 'INITIAL_BASELINE',
        'change_type', 'INITIAL_BASELINE',
        'hash', p_hash,
        'mapped_topics', v_mapped,
        'auto_accepted', true
      )
  where exam_id = p_exam
    and status in ('draft', 'needs_review')
    and (
      coalesce(diff->>'result', '') in ('NEW_OR_FIRST_SNAPSHOT', 'INITIAL_BASELINE')
      or coalesce(diff->>'hash', '') = p_hash
    );
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    insert into public.curriculum_change_proposals (exam_id, source_id, from_version_id, to_version_id, diff, status)
    select p_exam, p_source, v_version, v_version,
           jsonb_build_object(
             'result', 'INITIAL_BASELINE',
             'change_type', 'INITIAL_BASELINE',
             'hash', p_hash,
             'mapped_topics', v_mapped,
             'auto_accepted', true
           ),
           'applied'
    where not exists (
      select 1 from public.curriculum_change_proposals p
      where p.exam_id = p_exam
        and p.status = 'applied'
        and coalesce(p.diff->>'change_type', p.diff->>'result') = 'INITIAL_BASELINE'
        and coalesce(p.diff->>'hash', '') = coalesce(p_hash, '')
    );
  end if;
  return v_version;
end;
$$;

create or replace function public.curriculum_sync_internal(p_exam_id uuid default null, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src record;
  v_hash text;
  v_exam uuid;
  v_unchanged int := 0;
  v_new int := 0;
  v_baseline int := 0;
  v_review int := 0;
  v_payload jsonb;
  v_cache public.curriculum_discovery_cache;
  v_issue text;
  v_has_accepted boolean;
  v_change text;
  v_status text;
  v_prev_hash text;
begin
  for v_src in
    select *
    from public.curriculum_sources
    where is_enabled
      and (p_exam_id is null or exam_id = p_exam_id)
  loop
    v_exam := v_src.exam_id;
    v_hash := public.catalog_curriculum_hash(v_exam);
    v_payload := jsonb_build_object('adapter', v_src.source_type, 'hash', v_hash);
    select * into v_cache
    from public.curriculum_discovery_cache
    where source_id = v_src.id and resource_identifier = 'catalog' and content_hash = v_hash
    order by fetched_at desc
    limit 1;

    update public.curriculum_sources
    set last_checked_at = now(), source_hash = v_hash, updated_at = now()
    where id = v_src.id;

    if v_cache.id is not null and v_cache.validated_at is not null and not coalesce(p_force, false) then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    insert into public.curriculum_discovery_cache (source_id, exam_id, resource_identifier, content_hash, normalized_payload, status)
    values (v_src.id, v_exam, 'catalog', v_hash, v_payload, 'cached')
    on conflict (source_id, resource_identifier, content_hash) do nothing;

    select exists (
      select 1 from public.curriculum_discovery_cache c
      where c.source_id = v_src.id and c.validated_at is not null
    ) or exists (
      select 1 from public.curriculum_change_proposals p
      where p.exam_id = v_exam and p.status = 'applied'
        and coalesce(p.diff->>'change_type', p.diff->>'result') in ('INITIAL_BASELINE', 'UNCHANGED')
    ) into v_has_accepted;

    select c.content_hash into v_prev_hash
    from public.curriculum_discovery_cache c
    where c.source_id = v_src.id and c.validated_at is not null
    order by c.validated_at desc
    limit 1;

    v_issue := public.curriculum_first_snapshot_issues(v_exam, v_src.id);

    if not v_has_accepted then
      if v_issue is null then
        perform public.apply_curriculum_initial_baseline(v_exam, v_src.id, v_hash);
        v_baseline := v_baseline + 1;
        update public.curriculum_sources set last_success_at = now() where id = v_src.id;
        continue;
      end if;
      v_change := case v_issue
        when 'source_conflict' then 'SOURCE_CONFLICT'
        else 'AMBIGUOUS'
      end;
      v_status := 'needs_review';
    elsif v_prev_hash is null or v_prev_hash is not distinct from v_hash then
      v_unchanged := v_unchanged + 1;
      update public.curriculum_discovery_cache
      set status = 'accepted', validated_at = coalesce(validated_at, now())
      where source_id = v_src.id and content_hash = v_hash;
      update public.curriculum_sources set last_success_at = now() where id = v_src.id;
      continue;
    else
      v_change := 'UPDATED';
      v_status := 'needs_review';
      v_issue := coalesce(v_issue, 'structural_update');
    end if;

    insert into public.curriculum_change_proposals (exam_id, source_id, from_version_id, diff, status)
    select v_exam, v_src.id, (select id from public.get_active_curriculum_version(v_exam)),
           jsonb_build_object(
             'result', v_change,
             'change_type', v_change,
             'hash', v_hash,
             'reason', v_issue,
             'auto_accepted', false
           ),
           v_status
    where not exists (
      select 1 from public.curriculum_change_proposals p
      where p.exam_id = v_exam
        and p.diff->>'hash' = v_hash
        and p.status in ('draft', 'needs_review')
    );
    if found then
      v_new := v_new + 1;
      if v_status = 'needs_review' then v_review := v_review + 1; end if;
    end if;
    update public.curriculum_sources set last_success_at = now() where id = v_src.id;
  end loop;

  return jsonb_build_object(
    'unchanged', v_unchanged,
    'proposals', v_new,
    'baselines_accepted', v_baseline,
    'needs_review', v_review,
    'ai_called', false,
    'fetched_remote', false
  );
end;
$$;

create or replace function public.admin_curriculum_sync(p_exam_id uuid default null, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    perform public.require_admin();
  end if;
  return public.curriculum_sync_internal(p_exam_id, p_force);
end;
$$;

-- Existing pending first snapshots: accept if trusted/valid, never duplicate versions.
do $$
declare
  r record;
  v_issue text;
  v_hash text;
begin
  for r in
    select distinct on (p.exam_id) p.id, p.exam_id, p.source_id, p.diff
    from public.curriculum_change_proposals p
    where p.status = 'needs_review'
      and coalesce(p.diff->>'result', p.diff->>'change_type', '') in ('NEW_OR_FIRST_SNAPSHOT', 'INITIAL_BASELINE')
    order by p.exam_id, p.created_at asc
  loop
    v_issue := public.curriculum_first_snapshot_issues(r.exam_id, r.source_id);
    if v_issue is not null then
      update public.curriculum_change_proposals
      set diff = coalesce(diff, '{}'::jsonb) || jsonb_build_object(
        'change_type', case when v_issue = 'source_conflict' then 'SOURCE_CONFLICT' else 'AMBIGUOUS' end,
        'reason', v_issue
      )
      where exam_id = r.exam_id
        and status = 'needs_review'
        and coalesce(diff->>'result', diff->>'change_type', '') in ('NEW_OR_FIRST_SNAPSHOT', 'INITIAL_BASELINE');
      continue;
    end if;
    v_hash := coalesce(r.diff->>'hash', public.catalog_curriculum_hash(r.exam_id));
    perform public.apply_curriculum_initial_baseline(r.exam_id, r.source_id, v_hash);
  end loop;
end $$;

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
      perform public.curriculum_sync_internal(v_exam.id, false);
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

revoke all on function public.curriculum_sync_internal(uuid, boolean) from public;
revoke all on function public.apply_curriculum_initial_baseline(uuid, uuid, text) from public;
grant execute on function public.curriculum_sync_internal(uuid, boolean) to service_role;
grant execute on function public.apply_curriculum_initial_baseline(uuid, uuid, text) to service_role;
