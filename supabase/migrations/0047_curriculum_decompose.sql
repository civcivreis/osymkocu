-- Phase 2F: curriculum decomposer drafts, segments, learning objectives.

alter table public.canonical_topics
  add column if not exists estimated_minutes numeric,
  add column if not exists estimated_core_fact_count integer,
  add column if not exists too_broad boolean not null default false,
  add column if not exists keep_single_override boolean not null default false,
  add column if not exists keep_single_reason text,
  add column if not exists memory_journey_feasibility text,
  add column if not exists analysis_status text not null default 'unanalyzed';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'canonical_topics_feasibility_check') then
    alter table public.canonical_topics
      add constraint canonical_topics_feasibility_check
      check (memory_journey_feasibility is null or memory_journey_feasibility in ('high', 'medium', 'low'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'canonical_topics_analysis_check') then
    alter table public.canonical_topics
      add constraint canonical_topics_analysis_check
      check (analysis_status in ('unanalyzed', 'analyzed', 'split_recommended', 'ready'));
  end if;
end $$;

create table if not exists public.canonical_topic_learning_objectives (
  id uuid primary key default gen_random_uuid(),
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete cascade,
  title text not null,
  description text,
  objective_order integer not null default 1,
  importance text not null default 'core',
  estimated_minutes numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_topic_lo_importance_check
    check (importance in ('core', 'supporting', 'optional')),
  constraint canonical_topic_lo_order_check check (objective_order >= 1)
);

create unique index if not exists canonical_topic_lo_order_uidx
  on public.canonical_topic_learning_objectives (canonical_topic_id, objective_order);

create table if not exists public.canonical_topic_segments (
  id uuid primary key default gen_random_uuid(),
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete cascade,
  title text not null,
  slug text not null,
  description text,
  segment_order integer not null default 1,
  estimated_minutes numeric,
  estimated_core_fact_count integer,
  should_have_own_lesson boolean not null default false,
  decomposition_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_topic_segments_order_check check (segment_order >= 1)
);

create unique index if not exists canonical_topic_segments_parent_slug_uidx
  on public.canonical_topic_segments (canonical_topic_id, slug);
create unique index if not exists canonical_topic_segments_parent_order_uidx
  on public.canonical_topic_segments (canonical_topic_id, segment_order);

create table if not exists public.curriculum_decomposition_proposals (
  id uuid primary key default gen_random_uuid(),
  mode text not null,
  status text not null default 'draft',
  curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  exam_id uuid,
  subject_id uuid,
  unit_id uuid,
  canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  canonical_unit_id uuid references public.canonical_units(id) on delete set null,
  title text,
  ai_payload jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  coverage_warnings jsonb not null default '[]'::jsonb,
  missing_areas jsonb not null default '[]'::jsonb,
  possible_duplicates jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curriculum_decomposition_mode_check check (mode in ('unit', 'topic')),
  constraint curriculum_decomposition_status_check check (status in ('draft', 'approved', 'cancelled'))
);

drop trigger if exists canonical_topic_lo_set_updated_at on public.canonical_topic_learning_objectives;
create trigger canonical_topic_lo_set_updated_at
  before update on public.canonical_topic_learning_objectives
  for each row execute procedure public.set_updated_at();

drop trigger if exists canonical_topic_segments_set_updated_at on public.canonical_topic_segments;
create trigger canonical_topic_segments_set_updated_at
  before update on public.canonical_topic_segments
  for each row execute procedure public.set_updated_at();

drop trigger if exists curriculum_decomposition_proposals_set_updated_at on public.curriculum_decomposition_proposals;
create trigger curriculum_decomposition_proposals_set_updated_at
  before update on public.curriculum_decomposition_proposals
  for each row execute procedure public.set_updated_at();

alter table public.canonical_topic_learning_objectives enable row level security;
alter table public.canonical_topic_segments enable row level security;
alter table public.curriculum_decomposition_proposals enable row level security;

drop policy if exists canonical_topic_lo_select on public.canonical_topic_learning_objectives;
create policy canonical_topic_lo_select on public.canonical_topic_learning_objectives
  for select to authenticated using (true);
drop policy if exists canonical_topic_lo_admin on public.canonical_topic_learning_objectives;
create policy canonical_topic_lo_admin on public.canonical_topic_learning_objectives
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists canonical_topic_segments_select on public.canonical_topic_segments;
create policy canonical_topic_segments_select on public.canonical_topic_segments
  for select to authenticated using (true);
drop policy if exists canonical_topic_segments_admin on public.canonical_topic_segments;
create policy canonical_topic_segments_admin on public.canonical_topic_segments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists curriculum_decomposition_proposals_admin on public.curriculum_decomposition_proposals;
create policy curriculum_decomposition_proposals_admin on public.curriculum_decomposition_proposals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.canonical_topic_learning_objectives to authenticated;
grant select, insert, update, delete on public.canonical_topic_segments to authenticated;
grant select, insert, update, delete on public.curriculum_decomposition_proposals to authenticated;

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
begin
  select * into v_topic from public.canonical_topics where id = p_id;
  if v_topic.id is null then return false; end if;
  select count(*) into v_lo from public.canonical_topic_learning_objectives where canonical_topic_id = p_id;
  select count(*) into v_mapped from public.exam_topic_map where canonical_topic_id = p_id and included = true;
  if v_mapped < 1 then return false; end if;
  if v_lo < 1 then return false; end if;
  if v_topic.estimated_minutes is null then return false; end if;
  if v_topic.estimated_core_fact_count is null then return false; end if;
  if v_topic.too_broad and not v_topic.keep_single_override then return false; end if;
  return true;
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

    if not public.canonical_topic_factory_ready(v_row.canonical_topic_id) then
      v_skipped := v_skipped + 1;
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

      if not public.canonical_topic_factory_ready(v_row.canonical_topic_id) then
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

revoke all on function public.canonical_topic_factory_ready(uuid) from public;
grant execute on function public.canonical_topic_factory_ready(uuid) to authenticated;
grant execute on function public.admin_queue_missing_content(uuid, uuid, uuid, uuid, boolean, boolean) to authenticated;
