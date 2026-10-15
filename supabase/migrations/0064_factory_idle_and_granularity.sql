-- Phase 3I: idle engine + under-decomposition. Pause motor. No mass AI jobs.

update public.content_factory_settings
set production_enabled = false,
    engine_state = 'paused',
    last_idle_reason = 'repair_3i',
    updated_at = now()
where id = 1;

alter table public.content_factory_settings
  add column if not exists factory_blocked_reason text,
  add column if not exists factory_blocked_detail text,
  add column if not exists last_job_started_at timestamptz,
  add column if not exists last_job_completed_at timestamptz,
  add column if not exists last_cron_tick_at timestamptz,
  add column if not exists last_ai_call_at timestamptz,
  add column if not exists stall_detected_at timestamptz,
  add column if not exists current_activity text;

alter table public.canonical_topics
  add column if not exists parent_canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  add column if not exists source_segment_id uuid references public.canonical_topic_segments(id) on delete set null,
  add column if not exists needs_further_decomposition boolean not null default false;

alter table public.canonical_topic_segments
  add column if not exists promoted_canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  add column if not exists needs_further_decomposition boolean not null default false;

alter table public.factory_pipeline_jobs drop constraint if exists factory_pipeline_jobs_kind_check;
alter table public.factory_pipeline_jobs
  add constraint factory_pipeline_jobs_kind_check check (job_kind in (
    'curriculum_sync', 'canonical_map', 'decompose_unit', 'decompose_topic', 'generate_objectives',
    'exam_technique_design', 'ordering', 'lesson', 'pool_fill', 'media', 'validate'
  ));

-- Extra pedagogical segments for known-broad masters that were flagged too_broad but never split.
create or replace function public.seed_missing_broad_segments()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_titles text[];
  v_title text;
  i int;
  n int := 0;
begin
  for r in select id, name from public.canonical_topics where master_key is not null
  loop
    v_titles := case
      when r.name = 'Osmanlı Kültür ve Medeniyeti' then array['Merkezi yönetim','Saray','Divan','Taşra','Tımar','Ordu','Eğitim','Hukuk','Toplum','Ekonomi','Vakıf','Bilim','Sanat','Mimari']
      when r.name in ('Millî Mücadele Hazırlık Dönemi') then array['Mondros','İşgaller','Cemiyetler','Amasya','Erzurum','Sivas','Misak-ı Millî']
      when r.name in ('Paragrafta Anlam') then array['Ana düşünce','Yardımcı düşünce','Başlık','Sözel çıkarım']
      when r.name in ('Paragrafta Yapı') then array['Giriş cümlesi','Cümle sıralama','Cümle yerleştirme','Akışı bozan cümle','Paragrafı ikiye bölme']
      when r.name in ('Paragrafta Anlatım Teknikleri','Anlatım Biçimleri ve Düşünceyi Geliştirme Yolları') then array['Anlatım biçimi','Düşünceyi geliştirme yolları']
      else null
    end;
    if v_titles is null then continue; end if;
    update public.canonical_topics
    set too_broad = true, analysis_status = 'split_recommended', needs_further_decomposition = false
    where id = r.id;
    i := 0;
    foreach v_title in array v_titles
    loop
      i := i + 1;
      insert into public.canonical_topic_segments (canonical_topic_id, title, slug, segment_order, should_have_own_lesson, estimated_minutes, estimated_core_fact_count, decomposition_reason)
      select r.id, v_title, left(public.catalog_slug_from_name(v_title) || '-x' || i::text, 80), 200 + i, true, 8, 8, '3i_pedagogy'
      where not exists (
        select 1 from public.canonical_topic_segments s where s.canonical_topic_id = r.id and lower(s.title) = lower(v_title)
      );
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end;
$$;

create or replace function public.promote_lesson_segments()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_child uuid;
  v_key text;
  v_slug text;
  v_code text;
  v_name text;
  n int := 0;
  v_map record;
begin
  for s in
    select g.*, p.canonical_unit_id, p.master_key as parent_key, p.name as parent_name
    from public.canonical_topic_segments g
    join public.canonical_topics p on p.id = g.canonical_topic_id
    where g.should_have_own_lesson
      and g.promoted_canonical_topic_id is null
  loop
    v_name := s.title;
    -- Coherent exam-technique family: Kut + Töre + Kurultay → one lesson topic.
    if lower(s.title) in ('kut anlayışı', 'kut', 'töre', 'kurultay') then
      v_name := 'Kut / Töre / Kurultay';
      select id into v_child from public.canonical_topics
      where parent_canonical_topic_id = s.canonical_topic_id and name = v_name
      limit 1;
    end if;
    v_slug := left(public.catalog_slug_from_name(v_name), 80);
    v_key := coalesce(s.parent_key, 'SEG') || '::' || v_slug;
    if v_child is null then
      select id into v_child from public.canonical_topics where master_key = v_key;
    end if;
    if v_child is null then
      select id into v_child
      from public.canonical_topics
      where canonical_unit_id = s.canonical_unit_id and slug = v_slug
      limit 1;
    end if;
    if v_child is null then
      insert into public.canonical_topics (
        canonical_unit_id, name, slug, master_key, content_scope,
        too_broad, keep_single_override, analysis_status,
        estimated_minutes, estimated_core_fact_count, memory_journey_feasibility,
        parent_canonical_topic_id, source_segment_id
      ) values (
        s.canonical_unit_id, v_name, v_slug, v_key, 'core',
        false, true, 'ready',
        coalesce(s.estimated_minutes, 8), coalesce(s.estimated_core_fact_count, 8), 'high',
        s.canonical_topic_id, s.id
      )
      returning id into v_child;
    else
      update public.canonical_topics
      set too_broad = false, keep_single_override = true, analysis_status = 'ready',
          estimated_minutes = coalesce(estimated_minutes, 8),
          estimated_core_fact_count = coalesce(estimated_core_fact_count, 8),
          parent_canonical_topic_id = coalesce(parent_canonical_topic_id, s.canonical_topic_id)
      where id = v_child;
    end if;

    insert into public.canonical_topic_learning_objectives (canonical_topic_id, title, objective_order, importance)
    select v_child, v_name || ' soru kalıbını tanır ve ilk hamleyi uygular.', 1, 'core'
    where not exists (select 1 from public.canonical_topic_learning_objectives o where o.canonical_topic_id = v_child);
    insert into public.canonical_topic_learning_objectives (canonical_topic_id, title, objective_order, importance)
    select v_child, v_name || ' tuzaklarını eleyerek hızlı güvenilir yolla çözer.', 2, 'core'
    where not exists (
      select 1 from public.canonical_topic_learning_objectives o
      where o.canonical_topic_id = v_child and o.objective_order = 2
    );

    insert into public.exam_question_patterns (
      canonical_topic_id, name, recognition_trigger, first_move, fast_strategy, common_traps,
      when_not_to_use, fast_rule, heuristic_kind, minimum_theory, priority
    )
    select v_child, v_name, 'Kök veya seçenek bu konu ailesine işaret eder.',
           'Tanıma tetikleyicisini aç; ilk hamleyi uygula.',
           'Asgari teori ile en hızlı güvenilir yol, sonra doğrula.',
           'Komşu kavram veya kısmi doğru şık.',
           'Başka soru tipi ise bu tekniği yapıştırma.',
           left(v_name || ': tanı, ilk hamle, doğrula.', 200),
           'strong_clue', 'Çözmek için asgari doğru bilgi.', 50
    where not exists (select 1 from public.exam_question_patterns p where p.canonical_topic_id = v_child);

    for v_map in
      select m.* from public.exam_topic_map m
      where m.canonical_topic_id = s.canonical_topic_id and m.included
    loop
      v_code := left('SEG_' || replace(v_slug, '-', '_') || '_' || substr(replace(v_map.unit_id::text, '-', ''), 1, 6), 40);
      insert into public.topic_catalog (unit_id, code, name, sort_order, is_active, content_status, canonical_topic_id, master_code, content_scope)
      select v_map.unit_id, v_code, v_name, 900 + s.segment_order, true, 'empty', v_child,
             v_key || ':' || v_map.unit_id::text, 'core'
      where not exists (
        select 1 from public.topic_catalog t
        where t.unit_id = v_map.unit_id and (lower(t.name) = lower(v_name) or t.canonical_topic_id = v_child)
      );
      insert into public.exam_topic_map (
        curriculum_version_id, canonical_topic_id, subject_id, unit_id, topic_id,
        included, coverage_mode, depth_level, sort_order
      )
      select v_map.curriculum_version_id, v_child, v_map.subject_id, v_map.unit_id, t.id,
             true, 'core', 'standard', 900 + s.segment_order
      from public.topic_catalog t
      where t.unit_id = v_map.unit_id and t.canonical_topic_id = v_child
      on conflict (curriculum_version_id, canonical_topic_id) do update set included = true;
    end loop;

    update public.canonical_topic_segments set promoted_canonical_topic_id = v_child where id = s.id;
    v_child := null;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.prepare_leaf_master_topics()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
  v_seg int;
begin
  for r in
    select ct.* from public.canonical_topics ct
    where ct.parent_canonical_topic_id is null
      and coalesce(ct.is_dynamic, false) = false
  loop
    select count(*) into v_seg from public.canonical_topic_segments s where s.canonical_topic_id = r.id and s.should_have_own_lesson;
    if v_seg >= 2 then
      update public.canonical_topics
      set too_broad = true, analysis_status = 'split_recommended', needs_further_decomposition = false
      where id = r.id;
      continue;
    end if;
    if r.too_broad and v_seg = 0 then
      update public.canonical_topics set needs_further_decomposition = true, analysis_status = 'split_recommended' where id = r.id;
      continue;
    end if;
    -- Leaf: one coherent 5–10 min block.
    update public.canonical_topics
    set too_broad = false,
        keep_single_override = true,
        analysis_status = 'ready',
        estimated_minutes = coalesce(estimated_minutes, 8),
        estimated_core_fact_count = coalesce(estimated_core_fact_count, 8),
        memory_journey_feasibility = coalesce(memory_journey_feasibility, 'high'),
        needs_further_decomposition = false
    where id = r.id;
    insert into public.canonical_topic_learning_objectives (canonical_topic_id, title, objective_order, importance)
    select r.id, r.name || ' soru kalıbını tanır.', 1, 'core'
    where not exists (select 1 from public.canonical_topic_learning_objectives o where o.canonical_topic_id = r.id);
    insert into public.exam_question_patterns (
      canonical_topic_id, name, recognition_trigger, first_move, fast_strategy, common_traps,
      when_not_to_use, fast_rule, heuristic_kind, priority
    )
    select r.id, r.name, 'Bu konu sınavda ' || r.name || ' olarak gelir.',
           'Kök sinyalini tanı; ilk hamleyi uygula.',
           'Asgari teori + hızlı güvenilir yol.',
           'Kısmi doğru veya komşu kavram.',
           'Başka kalıpta bu tekniği zorlama.',
           left(r.name || ': tanı ve çöz.', 200), 'strong_clue', 80
    where not exists (select 1 from public.exam_question_patterns p where p.canonical_topic_id = r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

select public.seed_missing_broad_segments();
select public.promote_lesson_segments();
select public.prepare_leaf_master_topics();

create or replace function public.canonical_topic_factory_ready(p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_topic public.canonical_topics;
  v_lo int;
  v_mapped int;
  v_pat int;
begin
  select * into v_topic from public.canonical_topics where id = p_id;
  if v_topic.id is null then return false; end if;
  if v_topic.too_broad and not v_topic.keep_single_override then return false; end if;
  if v_topic.needs_further_decomposition then return false; end if;
  select count(*) into v_lo from public.canonical_topic_learning_objectives where canonical_topic_id = p_id;
  select count(*) into v_mapped from public.exam_topic_map where canonical_topic_id = p_id and included = true;
  select count(*) into v_pat from public.exam_question_patterns where canonical_topic_id = p_id;
  if v_mapped < 1 then return false; end if;
  if v_lo < 1 then return false; end if;
  if v_topic.estimated_minutes is null then return false; end if;
  if v_topic.estimated_core_fact_count is null then return false; end if;
  if v_pat < 1 then return false; end if;
  return true;
end;
$$;

create or replace function public.refresh_factory_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_ready int := 0;
  v_jobs int := 0;
  v_active int := 0;
  v_pipe int := 0;
  v_need_decomp int := 0;
  v_reason text;
  v_detail text;
  v_activity text;
  v_last_job timestamptz;
  v_last_ai timestamptz;
  v_stalled boolean := false;
begin
  select engine_state into v_state from public.content_factory_settings where id = 1;
  select count(*) into v_ready from public.canonical_topics ct where public.canonical_topic_factory_ready(ct.id)
    and not exists (select 1 from public.memory_lessons l where l.canonical_topic_id = ct.id and l.status in ('pending_validation','approved','published'));
  select count(*) into v_jobs from public.content_generation_jobs where status in ('queued','generating_text','validating_pedagogy','generating_questions','generating_media');
  select count(*) into v_active from public.content_generation_jobs where status in ('generating_text','validating_pedagogy','generating_questions','generating_media');
  select count(*) into v_pipe from public.factory_pipeline_jobs where status in ('queued','running');
  select count(*) into v_need_decomp from public.canonical_topics where needs_further_decomposition or (too_broad and not keep_single_override
    and not exists (select 1 from public.canonical_topic_segments s where s.canonical_topic_id = canonical_topics.id));
  select max(started_at) into v_last_job from public.content_generation_jobs;
  select max(created_at) into v_last_ai from public.ai_usage_log;

  if v_state is distinct from 'running' then
    v_reason := null;
    v_activity := 'Motor duraklatıldı.';
  elsif v_active > 0 then
    v_reason := null;
    v_activity := 'Üretim işi yürüyor.';
  elsif v_jobs > 0 then
    v_reason := 'WORKER_UNAVAILABLE';
    v_detail := 'Kuyrukta iş var ama worker alamadı.';
    v_activity := 'Kuyruk dolu, worker bekleniyor.';
  elsif v_pipe > 0 then
    v_reason := 'DECOMPOSITION_PENDING';
    v_detail := v_pipe::text || ' müfredat hazırlık işi kuyrukta.';
    v_activity := 'Müfredat ayrıştırma / kazanım kuyruğu işleniyor.';
  elsif v_need_decomp > 0 then
    v_reason := 'DECOMPOSITION_PENDING';
    v_detail := v_need_decomp::text || ' master konu hâlâ ayrışmamış.';
    v_activity := 'Ayrıştırılacak konu var; kuyruk oluşmadı.';
  elsif v_ready > 0 then
    v_reason := 'WORKER_UNAVAILABLE';
    v_detail := v_ready::text || ' segment ders üretimine hazır ama iş açılmadı.';
    v_activity := 'Hazır segmentler var; kuyruk boş.';
  else
    v_reason := 'NO_ELIGIBLE_SEGMENTS';
    v_detail := 'Üretime hazır segment yok.';
    v_activity := 'Eksik iş bulunamadı.';
  end if;

  if v_state = 'running' and (v_ready > 0 or v_need_decomp > 0 or v_pipe > 0 or v_jobs > 0) and v_active = 0 then
    if v_last_job is null or v_last_job < now() - interval '10 minutes' then
      v_stalled := true;
    end if;
  end if;

  update public.content_factory_settings
  set factory_blocked_reason = v_reason,
      factory_blocked_detail = v_detail,
      current_activity = case when v_stalled then 'Motor çalışıyor görünüyor ancak ilerleme yok. ' || coalesce(v_detail, v_activity) else v_activity end,
      last_job_started_at = v_last_job,
      last_ai_call_at = v_last_ai,
      stall_detected_at = case when v_stalled then now() else null end,
      last_cron_tick_at = now(),
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'engine_state', v_state,
    'blocked_reason', v_reason,
    'detail', v_detail,
    'activity', v_activity,
    'stalled', v_stalled,
    'ready_without_lesson', v_ready,
    'active_jobs', v_active,
    'queued_jobs', v_jobs,
    'pipeline', v_pipe,
    'need_decomp', v_need_decomp
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
begin
  select production_enabled, engine_state, max_concurrency into v_enabled, v_state, v_max
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
  v_take := greatest(0, least(coalesce(p_limit, 2), coalesce(v_max, 2) - v_busy));
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

create or replace function public.factory_claim_pipeline_jobs_internal(p_limit int default 1)
returns setof public.factory_pipeline_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  select engine_state into v_state from public.content_factory_settings where id = 1;
  if v_state is distinct from 'running' then return; end if;
  return query
  update public.factory_pipeline_jobs j
  set status = 'running', attempt_count = j.attempt_count + 1, locked_until = now() + interval '8 minutes', updated_at = now()
  where j.id in (
    select id from public.factory_pipeline_jobs
    where status = 'queued' and job_kind in ('decompose_topic', 'decompose_unit', 'generate_objectives', 'exam_technique_design')
      and (locked_until is null or locked_until < now())
    order by created_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  returning *;
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
begin
  update public.content_generation_jobs
  set status = 'queued', locked_until = null, error_message = 'stale lock released'
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media')
    and locked_until is not null and locked_until < now() - interval '20 minutes';

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
    v_health := public.refresh_factory_health();
    return jsonb_build_object('state', coalesce(v_state, 'paused'), 'enqueued', 0, 'health', v_health);
  end if;

  perform public.bootstrap_supported_exams();
  perform public.seed_missing_broad_segments();
  perform public.promote_lesson_segments();
  perform public.prepare_leaf_master_topics();

  for v_exam in
    select e.id, e.code
    from public.exam_catalog e
    left join public.factory_exam_settings f on f.exam_id = e.id
    where e.is_active
      and e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
      and coalesce(f.is_enabled, true)
  loop
    select id into v_version from public.get_active_curriculum_version(v_exam.id);
    if v_version is null then continue; end if;

    insert into public.factory_pipeline_jobs (exam_id, job_kind, dedupe_key, curriculum_version_id, canonical_topic_id, status)
    select v_exam.id, 'decompose_topic', 'decompose-topic:' || ct.id::text, v_version, ct.id, 'queued'
    from public.canonical_topics ct
    join public.exam_topic_map m on m.canonical_topic_id = ct.id and m.curriculum_version_id = v_version and m.included
    where ct.needs_further_decomposition
       or (ct.too_broad and coalesce(ct.keep_single_override, false) = false
           and not exists (select 1 from public.canonical_topic_segments s where s.canonical_topic_id = ct.id))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_decomp = row_count;

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
          and j.status not in ('completed', 'failed', 'cancelled')
      )
      and not public.topic_ordering_blocks_generation(m.canonical_topic_id);
    get diagnostics v_lessons = row_count;
    v_enqueued := v_enqueued + v_lessons;
  end loop;

  update public.content_factory_settings
  set last_orchestrated_at = now(),
      last_idle_reason = case when v_enqueued > 0 then 'working' else 'idle' end,
      production_enabled = true,
      updated_at = now()
  where id = 1;

  v_health := public.refresh_factory_health();
  return jsonb_build_object('state', 'running', 'lesson_jobs', v_enqueued, 'health', v_health);
end;
$$;

create or replace function public.admin_factory_exam_coverage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.sort_order)
    from (
      select
        e.id, e.code, e.name, e.sort_order,
        coalesce(f.is_enabled, true) as is_enabled,
        v.id as curriculum_version_id,
        v.status as curriculum_status,
        v.name as curriculum_name,
        (select count(*) from public.subject_catalog s where s.exam_id = e.id and s.is_active) as subjects,
        (select count(*) from public.topic_catalog t
           join public.unit_catalog u on u.id = t.unit_id
           join public.subject_catalog s on s.id = u.subject_id
           where s.exam_id = e.id and t.is_active and coalesce(u.code,'') = 'MASTER'
             and t.canonical_topic_id in (select id from public.canonical_topics c where c.parent_canonical_topic_id is null)
        ) as topics,
        (select count(distinct g.id) from public.canonical_topic_segments g
           join public.exam_topic_map m on m.canonical_topic_id = g.canonical_topic_id
           where m.curriculum_version_id = v.id and m.included) as segments,
        (select count(*) from public.exam_topic_map m
           join public.canonical_topics c on c.id = m.canonical_topic_id
           where m.curriculum_version_id = v.id and m.included and c.parent_canonical_topic_id is not null) as lesson_topics,
        (
          select count(distinct m.canonical_topic_id)
          from public.exam_topic_map m
          join public.memory_lessons l on l.canonical_topic_id = m.canonical_topic_id
          where m.curriculum_version_id = v.id and m.included
            and l.status in ('approved', 'published', 'pending_validation')
        ) as lessons_ready,
        (
          select count(*) from public.questions q
          join public.exam_topic_map m on m.canonical_topic_id = q.canonical_topic_id
          where m.curriculum_version_id = v.id and m.included and q.question_status <> 'archived'
        ) as questions_ready,
        (select count(*) from public.content_generation_jobs j where j.exam_id = e.id and j.status = 'failed') as failed,
        (
          select count(*) from public.memory_lessons l
          join public.exam_topic_map m on m.canonical_topic_id = l.canonical_topic_id
          where m.curriculum_version_id = v.id and l.status = 'pending_validation'
        ) as pending_review,
        (
          select coalesce(jsonb_agg(to_jsonb(sx) order by sx.name), '[]'::jsonb)
          from (
            select sc.name,
              count(*) filter (where ct.parent_canonical_topic_id is null) as master,
              (select count(distinct g.id) from public.canonical_topic_segments g
                join public.exam_topic_map mm on mm.canonical_topic_id = g.canonical_topic_id
                where mm.curriculum_version_id = v.id and mm.subject_id = sc.id and mm.included) as segs,
              count(*) filter (where public.canonical_topic_factory_ready(ct.id)) as ready,
              count(*) filter (where exists (
                select 1 from public.memory_lessons l where l.canonical_topic_id = ct.id
                  and l.status in ('pending_validation','approved','published'))) as lessons
            from public.subject_catalog sc
            join public.exam_topic_map m on m.subject_id = sc.id and m.curriculum_version_id = v.id and m.included
            join public.canonical_topics ct on ct.id = m.canonical_topic_id
            where sc.exam_id = e.id
            group by sc.id, sc.name
          ) sx
        ) as by_subject
      from public.exam_catalog e
      left join public.factory_exam_settings f on f.exam_id = e.id
      left join lateral (select * from public.get_active_curriculum_version(e.id)) v on true
      where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_factory_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  s public.content_factory_settings;
begin
  perform public.require_admin();
  v := public.refresh_factory_health();
  select * into s from public.content_factory_settings where id = 1;
  return v || jsonb_build_object(
    'production_enabled', s.production_enabled,
    'blocked_reason', s.factory_blocked_reason,
    'blocked_detail', s.factory_blocked_detail,
    'activity', s.current_activity,
    'last_orchestrated_at', s.last_orchestrated_at,
    'last_cron_tick_at', s.last_cron_tick_at,
    'last_ai_call_at', s.last_ai_call_at,
    'max_concurrency', s.max_concurrency,
    'scheduler', case
      when s.last_cron_tick_at is not null and s.last_cron_tick_at > now() - interval '3 minutes' then 'healthy'
      when s.engine_state = 'paused' then 'idle'
      else 'error'
    end
  );
end;
$$;

create or replace function public.admin_factory_granularity_audit()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.exam, x.subject)
    from (
      select e.name as exam, sc.name as subject,
        count(*) filter (where ct.parent_canonical_topic_id is null) as master_topics_total,
        count(*) filter (where ct.too_broad and not ct.keep_single_override) as master_topics_needing_decomposition,
        count(*) filter (where exists (select 1 from public.canonical_topic_segments g where g.canonical_topic_id = ct.id)) as master_topics_decomposed,
        (select count(distinct g.id) from public.canonical_topic_segments g
          join public.exam_topic_map mm on mm.canonical_topic_id = g.canonical_topic_id
          where mm.curriculum_version_id = v.id and mm.subject_id = sc.id and mm.included) as segments_total,
        count(*) filter (where public.canonical_topic_factory_ready(ct.id)) as segments_ready_for_lesson,
        count(*) filter (where not public.canonical_topic_factory_ready(ct.id) and ct.parent_canonical_topic_id is not null) as segments_blocked
      from public.exam_catalog e
      join lateral (select * from public.get_active_curriculum_version(e.id)) v on true
      join public.subject_catalog sc on sc.exam_id = e.id
      join public.exam_topic_map m on m.subject_id = sc.id and m.curriculum_version_id = v.id and m.included
      join public.canonical_topics ct on ct.id = m.canonical_topic_id
      where e.code in ('TYT','AYT','KPSS_ORTAOGRETIM','KPSS_ONLISANS','KPSS_LISANS')
      group by e.name, sc.name, v.id, sc.id
    ) x
  ), '[]'::jsonb);
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
  select * into v_topic
  from public.canonical_topics
  where name = 'Kut / Töre / Kurultay'
     or slug like 'kut%'
  order by case when name = 'Kut / Töre / Kurultay' then 0 else 1 end
  limit 1;
  if v_topic.id is null then raise exception 'NOT_FOUND'; end if;

  if not public.canonical_topic_factory_ready(v_topic.id) then
    perform public.prepare_leaf_master_topics();
    perform public.promote_lesson_segments();
  end if;

  select * into v_map from public.exam_topic_map where canonical_topic_id = v_topic.id and included limit 1;
  if v_map.id is null then raise exception 'NOT_FOUND'; end if;

  select * into v_job from public.content_generation_jobs
  where canonical_topic_id = v_topic.id and job_type = 'full_lesson'
    and status not in ('completed', 'failed', 'cancelled')
  order by created_at desc limit 1;

  if v_job.id is null then
    insert into public.content_generation_jobs (
      canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
      job_type, status, coverage_mode, lesson_scope, created_by, priority
    ) values (
      v_topic.id, v_map.curriculum_version_id, v_map.curriculum_version_id, v_map.subject_id, v_map.unit_id, v_map.topic_id,
      'full_lesson', 'queued', 'core', 'core', v_user, 1000
    )
    returning * into v_job;
  end if;

  return jsonb_build_object('action', 'queued', 'job_id', v_job.id, 'topic_id', v_topic.id, 'topic', v_topic.name);
end;
$$;

-- exam_id on jobs should be exam catalog id; fix probe insert if version uuid was used.
-- Recreate probe with proper exam_id from subject_catalog.

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
  v_exam uuid;
begin
  v_user := public.require_admin();
  select * into v_topic
  from public.canonical_topics
  where name = 'Kut / Töre / Kurultay' or name ilike '%kut%'
  order by case when name = 'Kut / Töre / Kurultay' then 0 else 1 end
  limit 1;
  if v_topic.id is null then raise exception 'NOT_FOUND'; end if;

  select * into v_map from public.exam_topic_map where canonical_topic_id = v_topic.id and included limit 1;
  if v_map.id is null then raise exception 'NOT_FOUND'; end if;
  select s.exam_id into v_exam from public.subject_catalog s where s.id = v_map.subject_id;

  select * into v_job from public.content_generation_jobs
  where canonical_topic_id = v_topic.id and job_type = 'full_lesson'
    and status not in ('completed', 'failed', 'cancelled')
  limit 1;

  if v_job.id is null then
    insert into public.content_generation_jobs (
      canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
      job_type, status, coverage_mode, lesson_scope, created_by, priority
    ) values (
      v_topic.id, v_map.curriculum_version_id, v_exam, v_map.subject_id, v_map.unit_id, v_map.topic_id,
      'full_lesson', 'queued', 'core', 'core', v_user, 1000
    )
    returning * into v_job;
  end if;

  return jsonb_build_object('action', 'queued', 'job_id', v_job.id, 'topic_id', v_topic.id, 'topic', v_topic.name);
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
begin
  update public.content_factory_settings set last_cron_tick_at = now() where id = 1;
  select engine_state into v_state from public.content_factory_settings where id = 1;
  if v_state not in ('running', 'stopping') then
    perform public.refresh_factory_health();
    return;
  end if;
  perform public.factory_orchestrate_internal();
  perform public.content_factory_wake_edge();
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
    'updated_at', v_row.updated_at
  );
end;
$$;

grant execute on function public.factory_claim_pipeline_jobs_internal(int) to service_role;
grant execute on function public.factory_claim_pipeline_jobs_internal(int) to authenticated;
grant execute on function public.admin_factory_health() to authenticated;
grant execute on function public.admin_factory_granularity_audit() to authenticated;
grant execute on function public.refresh_factory_health() to authenticated;
grant execute on function public.refresh_factory_health() to service_role;

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

create or replace function public.factory_enqueue_kut_probe()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic public.canonical_topics;
  v_map public.exam_topic_map;
  v_job public.content_generation_jobs;
  v_exam uuid;
begin
  perform public.promote_lesson_segments();
  select * into v_topic
  from public.canonical_topics
  where name = 'Kut / Töre / Kurultay'
  limit 1;
  if v_topic.id is null then
    select * into v_topic from public.canonical_topics where name ilike '%kut%' order by created_at desc limit 1;
  end if;
  if v_topic.id is null then
    return jsonb_build_object('ok', false, 'error', 'kut_topic_missing');
  end if;
  select * into v_map from public.exam_topic_map where canonical_topic_id = v_topic.id and included limit 1;
  if v_map.id is null then
    return jsonb_build_object('ok', false, 'error', 'kut_map_missing', 'topic_id', v_topic.id);
  end if;
  select s.exam_id into v_exam from public.subject_catalog s where s.id = v_map.subject_id;
  select * into v_job from public.content_generation_jobs
  where canonical_topic_id = v_topic.id and job_type = 'full_lesson'
    and status not in ('completed', 'failed', 'cancelled')
  limit 1;
  if v_job.id is null then
    insert into public.content_generation_jobs (
      canonical_topic_id, curriculum_version_id, exam_id, subject_id, unit_id, topic_id,
      job_type, status, coverage_mode, lesson_scope, priority
    ) values (
      v_topic.id, v_map.curriculum_version_id, v_exam, v_map.subject_id, v_map.unit_id, v_map.topic_id,
      'full_lesson', 'queued', 'core', 'core', 1000
    )
    returning * into v_job;
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_job.id, 'topic_id', v_topic.id, 'topic', v_topic.name, 'ready', public.canonical_topic_factory_ready(v_topic.id));
end;
$$;

grant execute on function public.factory_enqueue_kut_probe() to service_role;

select public.refresh_factory_health();
