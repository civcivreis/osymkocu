-- Hap-bilgi factory batch (cap 5) + story owner delete. Does not use start_motor.

create or replace function public.delete_own_story(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.stories%rowtype;
  v_keys jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_row from public.stories
  where id = p_id and user_id = v_user and deleted_at is null;
  if v_row.id is null then raise exception 'NOT_FOUND'; end if;

  select coalesce(jsonb_agg(distinct m.storage_key), '[]'::jsonb) into v_keys
  from public.media m
  where m.deleted_at is null
    and m.purpose = 'story'
    and (m.id = v_row.media_id or v_row.image_url = 'media:' || m.id::text)
    and not exists (
      select 1 from public.stories live
      where live.deleted_at is null
        and live.id <> v_row.id
        and live.status = 'active'
        and live.expires_at > now()
        and (live.media_id = m.id or live.image_url = 'media:' || m.id::text)
    );

  update public.stories
  set deleted_at = now(), status = 'deleted'
  where id = v_row.id;

  update public.media m
  set deleted_at = now()
  where m.storage_key in (select jsonb_array_elements_text(v_keys))
    and m.deleted_at is null
    and m.purpose = 'story';

  return jsonb_build_object('ok', true, 'id', v_row.id, 'r2_keys', v_keys);
end;
$$;

revoke all on function public.delete_own_story(uuid) from public;
grant execute on function public.delete_own_story(uuid) to authenticated;

create or replace function public.kpss_ensure_turkce_leaf(p_name text, p_sort int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit uuid;
  v_parent uuid;
  v_id uuid;
  v_slug text;
  v_exam record;
  v_version uuid;
  v_subject uuid;
  v_exam_unit uuid;
  v_topic uuid;
  v_code text;
begin
  select cu.id into v_unit
  from public.canonical_units cu
  join public.canonical_subjects cs on cs.id = cu.canonical_subject_id
  where lower(cs.name) like '%türkçe%' or cs.slug in ('turkce', 'turkish')
  order by case
    when lower(cu.name) like '%paragraf%' then 0
    when lower(cu.name) like '%anlam%' then 1
    else 2
  end, cu.name
  limit 1;
  if v_unit is null then
    raise exception 'TURKCE_UNIT_MISSING';
  end if;

  select id into v_parent
  from public.canonical_topics
  where canonical_unit_id = v_unit
    and parent_canonical_topic_id is null
    and (
      lower(name) like '%paragraf%'
      or lower(name) = lower(p_name)
    )
  order by case when lower(name) = lower(p_name) then 0 else 1 end
  limit 1;

  v_slug := left(public.catalog_slug_from_name(p_name), 80);

  select id into v_id
  from public.canonical_topics
  where lower(name) = lower(p_name)
     or (canonical_unit_id = v_unit and slug = v_slug)
  order by case when lower(name) = lower(p_name) then 0 else 1 end
  limit 1;

  if v_id is null then
    insert into public.canonical_topics (
      canonical_unit_id, name, slug, master_key, content_scope,
      too_broad, keep_single_override, analysis_status,
      estimated_minutes, estimated_core_fact_count, memory_journey_feasibility,
      parent_canonical_topic_id, needs_further_decomposition
    ) values (
      v_unit, p_name, v_slug, 'KPSS::TURKCE::' || v_slug, 'core',
      false, true, 'ready',
      5, 6, 'high',
      v_parent, false
    )
    returning id into v_id;
  else
    update public.canonical_topics
    set too_broad = false,
        keep_single_override = true,
        analysis_status = 'ready',
        needs_further_decomposition = false,
        estimated_minutes = coalesce(estimated_minutes, 5),
        estimated_core_fact_count = coalesce(estimated_core_fact_count, 6),
        memory_journey_feasibility = coalesce(memory_journey_feasibility, 'high'),
        parent_canonical_topic_id = coalesce(parent_canonical_topic_id, v_parent)
    where id = v_id;
  end if;

  insert into public.canonical_topic_learning_objectives (canonical_topic_id, title, objective_order, importance)
  select v_id, p_name || ' soru kalıbını tanır ve ilk hamleyi uygular.', 1, 'core'
  where not exists (select 1 from public.canonical_topic_learning_objectives o where o.canonical_topic_id = v_id);

  insert into public.canonical_topic_learning_objectives (canonical_topic_id, title, objective_order, importance)
  select v_id, p_name || ' tuzaklarını eleyerek hızlı güvenilir yolla çözer.', 2, 'core'
  where not exists (
    select 1 from public.canonical_topic_learning_objectives o
    where o.canonical_topic_id = v_id and o.objective_order = 2
  );

  insert into public.exam_question_patterns (
    canonical_topic_id, name, recognition_trigger, first_move, fast_strategy, common_traps,
    when_not_to_use, fast_rule, heuristic_kind, minimum_theory, priority
  )
  select v_id, p_name,
         'Kök bu teknik başlığına (ör. ' || p_name || ') işaret eder.',
         'Kalıbı tanı; hap bilgiyi uygula.',
         'Asgari teori, en hızlı güvenilir yol, sonra doğrula.',
         'Komşu paragraf tekniği veya kısmi doğru şık.',
         'Başka soru tipi ise bu tekniği yapıştırma.',
         left(p_name || ': tanı, uygula, doğrula.', 200),
         'strong_clue', 'Sınavda işe yarayan kısa kural.', 40
  where not exists (select 1 from public.exam_question_patterns p where p.canonical_topic_id = v_id);

  for v_exam in
    select e.id, e.code
    from public.exam_catalog e
    where e.is_active
      and e.code in ('TYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
  loop
    select id into v_version from public.get_active_curriculum_version(v_exam.id);
    if v_version is null then continue; end if;
    select sc.id into v_subject
    from public.subject_catalog sc
    where sc.exam_id = v_exam.id
      and (lower(sc.name) like '%türkçe%' or lower(sc.name) like '%sozel%' or lower(sc.name) like '%sözel%')
    order by case when lower(sc.name) like '%türkçe%' then 0 else 1 end
    limit 1;
    if v_subject is null then continue; end if;
    select uc.id into v_exam_unit
    from public.unit_catalog uc
    where uc.subject_id = v_subject
    order by case
      when lower(uc.name) like '%paragraf%' then 0
      when lower(uc.name) like '%anlam%' then 1
      else 2
    end, uc.sort_order nulls last
    limit 1;
    v_code := left('KPSS_TR_' || replace(v_slug, '-', '_') || '_' || substr(replace(v_exam.id::text, '-', ''), 1, 6), 40);
    insert into public.topic_catalog (unit_id, code, name, sort_order, is_active, content_status, canonical_topic_id, master_code, content_scope)
    select v_exam_unit, v_code, p_name, 100 + p_sort, true, 'empty', v_id,
           'KPSS::TURKCE::' || v_slug || ':' || v_exam.id::text, 'core'
    where v_exam_unit is not null
      and not exists (
        select 1 from public.topic_catalog t
        where t.canonical_topic_id = v_id and t.unit_id = v_exam_unit
      );
    select t.id into v_topic
    from public.topic_catalog t
    where t.canonical_topic_id = v_id and t.unit_id = v_exam_unit
    limit 1;
    if v_topic is null then continue; end if;
    insert into public.exam_topic_map (
      curriculum_version_id, canonical_topic_id, subject_id, unit_id, topic_id,
      included, coverage_mode, depth_level, sort_order
    ) values (
      v_version, v_id, v_subject, v_exam_unit, v_topic,
      true, 'core', 'standard', p_sort
    )
    on conflict (curriculum_version_id, canonical_topic_id) do update
      set included = true, sort_order = excluded.sort_order, subject_id = excluded.subject_id;
  end loop;

  return v_id;
end;
$$;

create or replace function public.kpss_turkce_library_names()
returns text[]
language sql
immutable
as $$
  select array[
    'Sözcükte Anlam',
    'Cümlede Anlam',
    'Ana Düşünce',
    'Giriş Cümlesi',
    'Cümle Sıralama',
    'Yardımcı Düşünce',
    'Paragraf Başlığı',
    'Cümle Yerleştirme',
    'Akışı Bozan Cümle',
    'Paragrafı İkiye Bölme',
    'Anlatım Biçimleri',
    'Düşünceyi Geliştirme Yolları',
    'Ses Bilgisi',
    'Yazım Kuralları',
    'Noktalama',
    'Sözcükte Yapı',
    'Sözcük Türleri',
    'Zamir',
    'Zarf',
    'Edat',
    'Bağlaç',
    'Fiiller',
    'Ek Fiil',
    'Fiilimsiler',
    'Fiilde Çatı',
    'Cümlenin Ögeleri',
    'Cümle Türleri',
    'Anlatım Bozuklukları',
    'Sözel Mantık'
  ];
$$;

create or replace function public.factory_enqueue_kpss_turkce_batch()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_names text[] := public.kpss_turkce_library_names();
  v_name text;
  v_id uuid;
  v_i int := 0;
  v_queued int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_jobs jsonb := '[]'::jsonb;
  v_map public.exam_topic_map;
  v_exam uuid;
  v_job uuid;
  v_room int;
begin
  update public.content_factory_settings
  set factory_run_job_cap = 5,
      max_concurrency = 1,
      scope_mode = 'single_subject',
      scope_subject_name = 'Türkçe',
      scope_exam_code = 'KPSS_LISANS',
      scope_max_topics = 5,
      allow_full_unbounded = false,
      production_enabled = true,
      engine_state = 'running',
      last_idle_reason = 'kpss_turkce_batch',
      updated_at = now()
  where id = 1;

  foreach v_name in array v_names
  loop
    v_i := v_i + 1;
    v_id := public.kpss_ensure_turkce_leaf(v_name, v_i);
  end loop;

  v_room := greatest(0, 5 - public.factory_open_generation_count());
  v_i := 0;
  foreach v_name in array v_names
  loop
    if v_queued >= v_room then exit; end if;
    v_i := v_i + 1;
    select id into v_id from public.canonical_topics where lower(name) = lower(v_name) limit 1;
    if v_id is null then continue; end if;
    if exists (select 1 from public.memory_lessons l where l.canonical_topic_id = v_id) then
      v_skipped := v_skipped || jsonb_build_object('name', v_name, 'reason', 'lesson_exists');
      continue;
    end if;
    if exists (
      select 1 from public.content_generation_jobs j
      where j.canonical_topic_id = v_id and j.job_type = 'full_lesson'
        and j.status not in ('completed', 'failed', 'cancelled')
    ) then
      v_skipped := v_skipped || jsonb_build_object('name', v_name, 'reason', 'job_open');
      continue;
    end if;
    if not public.canonical_topic_factory_ready(v_id) then
      v_skipped := v_skipped || jsonb_build_object('name', v_name, 'reason', 'not_ready');
      continue;
    end if;
    select m.* into v_map
    from public.exam_topic_map m
    where m.canonical_topic_id = v_id and m.included
    order by case
      when exists (
        select 1
        from public.curriculum_versions cv
        join public.exam_catalog e on e.id = cv.exam_id
        where cv.id = m.curriculum_version_id and e.code like 'KPSS%'
      ) then 0 else 1
    end
    limit 1;
    if v_map.id is null then
      v_skipped := v_skipped || jsonb_build_object('name', v_name, 'reason', 'no_map');
      continue;
    end if;
    select cv.exam_id into v_exam from public.curriculum_versions cv where cv.id = v_map.curriculum_version_id;
    insert into public.content_generation_jobs (
      canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
      job_type, status, coverage_mode, lesson_scope, priority
    ) values (
      v_id, v_map.curriculum_version_id, v_exam, v_map.subject_id, v_map.unit_id, v_map.topic_id,
      'full_lesson', 'queued', 'core', 'core', 900 - v_i
    )
    returning id into v_job;
    v_queued := v_queued + 1;
    v_jobs := v_jobs || jsonb_build_object('name', v_name, 'job_id', v_job, 'topic_id', v_id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'queued', v_queued,
    'cap', 5,
    'concurrency', 1,
    'jobs', v_jobs,
    'skipped', v_skipped
  );
end;
$$;

create or replace function public.admin_factory_enqueue_kpss_turkce_batch()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return public.factory_enqueue_kpss_turkce_batch();
end;
$$;

grant execute on function public.factory_enqueue_kpss_turkce_batch() to service_role;
grant execute on function public.admin_factory_enqueue_kpss_turkce_batch() to authenticated;
grant execute on function public.kpss_ensure_turkce_leaf(text, int) to service_role;
grant execute on function public.kpss_turkce_library_names() to authenticated;

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
  v_batch jsonb;
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

  if coalesce(v_cfg.last_idle_reason, '') like 'kpss_turkce%' then
    v_batch := public.factory_enqueue_kpss_turkce_batch();
    v_enqueued := coalesce((v_batch ->> 'queued')::int, 0);
    update public.content_factory_settings
    set last_orchestrated_at = now(),
        last_idle_reason = 'kpss_turkce_batch',
        production_enabled = true,
        updated_at = now()
    where id = 1;
    v_health := public.refresh_factory_health();
    return jsonb_build_object(
      'state', 'running',
      'lesson_jobs', v_enqueued,
      'factory_run_job_cap', 5,
      'scope_mode', 'single_subject',
      'batch', v_batch,
      'health', v_health
    );
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

select public.factory_enqueue_kpss_turkce_batch();
