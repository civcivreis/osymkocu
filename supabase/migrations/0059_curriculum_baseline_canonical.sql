-- First baseline: unique catalog rows get canonical links; only real mapping collisions stay review.

create or replace function public.ensure_exam_canonical_links(p_exam uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked int := 0;
begin
  insert into public.canonical_subjects (code, name, slug)
  select distinct on (lower(s.name)) s.code, s.name, public.catalog_slug_from_name(s.name)
  from public.subject_catalog s
  where s.exam_id = p_exam
    and not exists (
      select 1 from public.canonical_subjects c where lower(c.name) = lower(s.name)
    );

  update public.subject_catalog s
  set canonical_subject_id = c.id
  from public.canonical_subjects c
  where s.exam_id = p_exam
    and s.canonical_subject_id is null
    and lower(c.name) = lower(s.name);

  insert into public.canonical_units (canonical_subject_id, name, slug)
  select distinct on (s.canonical_subject_id, lower(u.name))
    s.canonical_subject_id, u.name, public.catalog_slug_from_name(u.name)
  from public.unit_catalog u
  join public.subject_catalog s on s.id = u.subject_id
  where s.exam_id = p_exam
    and s.canonical_subject_id is not null
    and not exists (
      select 1 from public.canonical_units c
      where c.canonical_subject_id = s.canonical_subject_id
        and lower(c.name) = lower(u.name)
    );

  update public.unit_catalog u
  set canonical_unit_id = c.id
  from public.subject_catalog s
  join public.canonical_units c on c.canonical_subject_id = s.canonical_subject_id
  where u.subject_id = s.id
    and s.exam_id = p_exam
    and u.canonical_unit_id is null
    and lower(c.name) = lower(u.name);

  insert into public.canonical_topics (canonical_unit_id, name, slug)
  select distinct on (u.canonical_unit_id, lower(t.name))
    u.canonical_unit_id, t.name, public.catalog_slug_from_name(t.name)
  from public.topic_catalog t
  join public.unit_catalog u on u.id = t.unit_id
  join public.subject_catalog s on s.id = u.subject_id
  where s.exam_id = p_exam
    and u.canonical_unit_id is not null
    and not exists (
      select 1 from public.canonical_topics c
      where c.canonical_unit_id = u.canonical_unit_id
        and lower(c.name) = lower(t.name)
    );

  update public.topic_catalog t
  set canonical_topic_id = c.id
  from public.unit_catalog u
  join public.subject_catalog s on s.id = u.subject_id
  join public.canonical_topics c on c.canonical_unit_id = u.canonical_unit_id
  where t.unit_id = u.id
    and s.exam_id = p_exam
    and t.canonical_topic_id is null
    and lower(c.name) = lower(t.name);
  get diagnostics v_linked = row_count;
  return v_linked;
end;
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
  v_conflict int := 0;
  v_dup int := 0;
  v_ambig int := 0;
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

  select count(*) into v_dup
  from (
    select t.unit_id, lower(t.name)
    from public.topic_catalog t
    join public.unit_catalog u on u.id = t.unit_id
    join public.subject_catalog s on s.id = u.subject_id
    where s.exam_id = p_exam
    group by t.unit_id, lower(t.name)
    having count(*) > 1
  ) d;
  if v_dup > 0 then
    return 'ambiguous_canonical';
  end if;

  select count(*) into v_ambig
  from public.topic_catalog t
  join public.unit_catalog u on u.id = t.unit_id
  join public.subject_catalog s on s.id = u.subject_id
  where s.exam_id = p_exam
    and u.canonical_unit_id is not null
    and (
      select count(*) from public.canonical_topics c
      where c.canonical_unit_id = u.canonical_unit_id and lower(c.name) = lower(t.name)
    ) > 1;
  if v_ambig > 0 then
    return 'ambiguous_canonical';
  end if;

  select count(*) into v_topics
  from public.topic_catalog t
  join public.unit_catalog u on u.id = t.unit_id
  join public.subject_catalog s on s.id = u.subject_id
  where s.exam_id = p_exam;
  if v_topics = 0 and v_src.source_type is distinct from 'catalog_snapshot' then
    return 'empty_structure';
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
  perform public.ensure_exam_canonical_links(p_exam);

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
      coalesce(diff->>'result', '') in ('NEW_OR_FIRST_SNAPSHOT', 'INITIAL_BASELINE', 'AMBIGUOUS')
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
      and coalesce(p.diff->>'result', p.diff->>'change_type', '') in ('NEW_OR_FIRST_SNAPSHOT', 'INITIAL_BASELINE', 'AMBIGUOUS')
      and coalesce(p.diff->>'reason', 'ambiguous_canonical') in ('ambiguous_canonical', '')
    order by p.exam_id, p.created_at asc
  loop
    v_issue := public.curriculum_first_snapshot_issues(r.exam_id, r.source_id);
    if v_issue is not null then
      update public.curriculum_change_proposals
      set diff = coalesce(diff, '{}'::jsonb) || jsonb_build_object(
        'change_type', case when v_issue = 'source_conflict' then 'SOURCE_CONFLICT' else 'AMBIGUOUS' end,
        'reason', v_issue
      )
      where id = r.id;
      continue;
    end if;
    v_hash := coalesce(r.diff->>'hash', public.catalog_curriculum_hash(r.exam_id));
    perform public.apply_curriculum_initial_baseline(r.exam_id, r.source_id, v_hash);
  end loop;
end $$;

revoke all on function public.ensure_exam_canonical_links(uuid) from public;
grant execute on function public.ensure_exam_canonical_links(uuid) to service_role;
