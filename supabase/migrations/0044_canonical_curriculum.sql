-- Phase 2C: canonical academic hierarchy + curriculum versions (no AI, no R2).

create or replace function public.catalog_slug_from_name(p_name text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(lower(replace(public.catalog_code_from_name(p_name), '_', '-')), ''), 'konu');
$$;

create table if not exists public.canonical_subjects (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  slug text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists canonical_subjects_slug_uidx on public.canonical_subjects (slug);
create unique index if not exists canonical_subjects_name_uidx on public.canonical_subjects (lower(name));

create table if not exists public.canonical_units (
  id uuid primary key default gen_random_uuid(),
  canonical_subject_id uuid not null references public.canonical_subjects(id) on delete restrict,
  name text not null,
  slug text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists canonical_units_parent_slug_uidx
  on public.canonical_units (canonical_subject_id, slug);
create unique index if not exists canonical_units_parent_name_uidx
  on public.canonical_units (canonical_subject_id, lower(name));

create table if not exists public.canonical_topics (
  id uuid primary key default gen_random_uuid(),
  canonical_unit_id uuid not null references public.canonical_units(id) on delete restrict,
  name text not null,
  slug text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists canonical_topics_parent_slug_uidx
  on public.canonical_topics (canonical_unit_id, slug);
create unique index if not exists canonical_topics_parent_name_uidx
  on public.canonical_topics (canonical_unit_id, lower(name));

create table if not exists public.curriculum_versions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_catalog(id) on delete restrict,
  code text not null,
  name text not null,
  revision_label text,
  source_note text,
  status text not null default 'draft',
  effective_from date,
  effective_until date,
  is_default boolean not null default false,
  manually_activated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  archived_at timestamptz,
  constraint curriculum_versions_status_check
    check (status in ('draft', 'scheduled', 'active', 'archived')),
  constraint curriculum_versions_code_check check (code ~ '^[A-Z0-9_]+$'),
  constraint curriculum_versions_dates_check
    check (effective_until is null or effective_from is null or effective_until >= effective_from)
);

create unique index if not exists curriculum_versions_code_uidx on public.curriculum_versions (code);
create unique index if not exists curriculum_versions_exam_manual_uidx
  on public.curriculum_versions (exam_id)
  where manually_activated = true;
create unique index if not exists curriculum_versions_exam_default_uidx
  on public.curriculum_versions (exam_id)
  where is_default = true;
create index if not exists curriculum_versions_exam_status_idx
  on public.curriculum_versions (exam_id, status);

create table if not exists public.exam_topic_map (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null references public.curriculum_versions(id) on delete cascade,
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete restrict,
  subject_id uuid references public.subject_catalog(id) on delete set null,
  unit_id uuid references public.unit_catalog(id) on delete set null,
  topic_id uuid references public.topic_catalog(id) on delete set null,
  included boolean not null default true,
  coverage_mode text not null default 'core',
  depth_level text not null default 'standard',
  priority text not null default 'normal',
  sort_order integer not null default 0,
  exam_notes text,
  required_points jsonb not null default '[]'::jsonb,
  excluded_points jsonb not null default '[]'::jsonb,
  prerequisite_canonical_topic_ids uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_topic_map_coverage_check
    check (coverage_mode in ('core', 'core_plus_extension', 'exam_specific')),
  constraint exam_topic_map_depth_check
    check (depth_level in ('basic', 'standard', 'advanced')),
  constraint exam_topic_map_priority_check
    check (priority in ('low', 'normal', 'high')),
  unique (curriculum_version_id, canonical_topic_id)
);

create index if not exists exam_topic_map_version_idx
  on public.exam_topic_map (curriculum_version_id, sort_order);

alter table public.subject_catalog
  add column if not exists canonical_subject_id uuid references public.canonical_subjects(id) on delete set null;
alter table public.unit_catalog
  add column if not exists canonical_unit_id uuid references public.canonical_units(id) on delete set null;
alter table public.topic_catalog
  add column if not exists canonical_topic_id uuid references public.canonical_topics(id) on delete set null;

alter table public.memory_lessons
  add column if not exists canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  add column if not exists lesson_scope text not null default 'core',
  add column if not exists base_lesson_id uuid references public.memory_lessons(id) on delete set null,
  add column if not exists coverage_depth text not null default 'standard';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_lessons_lesson_scope_check') then
    alter table public.memory_lessons
      add constraint memory_lessons_lesson_scope_check
      check (lesson_scope in ('core', 'exam_extension', 'exam_specific'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'memory_lessons_coverage_depth_check') then
    alter table public.memory_lessons
      add constraint memory_lessons_coverage_depth_check
      check (coverage_depth in ('basic', 'standard', 'advanced'));
  end if;
end $$;

create table if not exists public.memory_lesson_exam_map (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  curriculum_version_id uuid not null references public.curriculum_versions(id) on delete cascade,
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete restrict,
  usage_mode text not null default 'core',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint memory_lesson_exam_map_usage_check
    check (usage_mode in ('core', 'core_plus_extension', 'exam_specific')),
  unique (lesson_id, curriculum_version_id)
);

create index if not exists memory_lesson_exam_map_version_idx
  on public.memory_lesson_exam_map (curriculum_version_id, canonical_topic_id);

create table if not exists public.memory_lesson_question_sets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete restrict,
  set_type text not null default 'core',
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_lesson_question_sets_type_check
    check (set_type in ('core', 'exam_specific'))
);

alter table public.memory_lesson_questions
  add column if not exists question_set_id uuid references public.memory_lesson_question_sets(id) on delete set null;

drop trigger if exists canonical_subjects_set_updated_at on public.canonical_subjects;
create trigger canonical_subjects_set_updated_at
  before update on public.canonical_subjects
  for each row execute procedure public.set_updated_at();
drop trigger if exists canonical_units_set_updated_at on public.canonical_units;
create trigger canonical_units_set_updated_at
  before update on public.canonical_units
  for each row execute procedure public.set_updated_at();
drop trigger if exists canonical_topics_set_updated_at on public.canonical_topics;
create trigger canonical_topics_set_updated_at
  before update on public.canonical_topics
  for each row execute procedure public.set_updated_at();
drop trigger if exists curriculum_versions_set_updated_at on public.curriculum_versions;
create trigger curriculum_versions_set_updated_at
  before update on public.curriculum_versions
  for each row execute procedure public.set_updated_at();
drop trigger if exists exam_topic_map_set_updated_at on public.exam_topic_map;
create trigger exam_topic_map_set_updated_at
  before update on public.exam_topic_map
  for each row execute procedure public.set_updated_at();
drop trigger if exists memory_lesson_question_sets_set_updated_at on public.memory_lesson_question_sets;
create trigger memory_lesson_question_sets_set_updated_at
  before update on public.memory_lesson_question_sets
  for each row execute procedure public.set_updated_at();

alter table public.canonical_subjects enable row level security;
alter table public.canonical_units enable row level security;
alter table public.canonical_topics enable row level security;
alter table public.curriculum_versions enable row level security;
alter table public.exam_topic_map enable row level security;
alter table public.memory_lesson_exam_map enable row level security;
alter table public.memory_lesson_question_sets enable row level security;

drop policy if exists canonical_subjects_select on public.canonical_subjects;
create policy canonical_subjects_select on public.canonical_subjects for select to authenticated using (true);
drop policy if exists canonical_subjects_admin on public.canonical_subjects;
create policy canonical_subjects_admin on public.canonical_subjects for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists canonical_units_select on public.canonical_units;
create policy canonical_units_select on public.canonical_units for select to authenticated using (true);
drop policy if exists canonical_units_admin on public.canonical_units;
create policy canonical_units_admin on public.canonical_units for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists canonical_topics_select on public.canonical_topics;
create policy canonical_topics_select on public.canonical_topics for select to authenticated using (true);
drop policy if exists canonical_topics_admin on public.canonical_topics;
create policy canonical_topics_admin on public.canonical_topics for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists curriculum_versions_select on public.curriculum_versions;
create policy curriculum_versions_select on public.curriculum_versions
  for select to authenticated
  using (status <> 'archived' or public.is_admin());
drop policy if exists curriculum_versions_admin on public.curriculum_versions;
create policy curriculum_versions_admin on public.curriculum_versions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists exam_topic_map_select on public.exam_topic_map;
create policy exam_topic_map_select on public.exam_topic_map
  for select to authenticated
  using (included = true or public.is_admin());
drop policy if exists exam_topic_map_admin on public.exam_topic_map;
create policy exam_topic_map_admin on public.exam_topic_map
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists memory_lesson_exam_map_select on public.memory_lesson_exam_map;
create policy memory_lesson_exam_map_select on public.memory_lesson_exam_map
  for select to authenticated
  using (is_active = true or public.is_admin());
drop policy if exists memory_lesson_exam_map_admin on public.memory_lesson_exam_map;
create policy memory_lesson_exam_map_admin on public.memory_lesson_exam_map
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists memory_lesson_question_sets_select on public.memory_lesson_question_sets;
create policy memory_lesson_question_sets_select on public.memory_lesson_question_sets
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.memory_lessons l
      where l.id = lesson_id and l.status = 'published'
    )
  );
drop policy if exists memory_lesson_question_sets_admin on public.memory_lesson_question_sets;
create policy memory_lesson_question_sets_admin on public.memory_lesson_question_sets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.canonical_subjects to authenticated;
grant select, insert, update, delete on public.canonical_units to authenticated;
grant select, insert, update, delete on public.canonical_topics to authenticated;
grant select, insert, update, delete on public.curriculum_versions to authenticated;
grant select, insert, update, delete on public.exam_topic_map to authenticated;
grant select, insert, update, delete on public.memory_lesson_exam_map to authenticated;
grant select, insert, update, delete on public.memory_lesson_question_sets to authenticated;

create or replace function public.get_active_curriculum_version(p_exam_id uuid)
returns setof public.curriculum_versions
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_exam_id is null then
    return;
  end if;

  return query
  select *
  from public.curriculum_versions
  where exam_id = p_exam_id
    and status = 'active'
    and manually_activated = true
  order by activated_at desc nulls last, created_at desc
  limit 1;
  if found then
    return;
  end if;

  return query
  select *
  from public.curriculum_versions
  where exam_id = p_exam_id
    and status in ('active', 'scheduled')
    and (effective_from is null or effective_from <= current_date)
    and (effective_until is null or effective_until >= current_date)
  order by effective_from desc nulls last, created_at desc
  limit 1;
  if found then
    return;
  end if;

  return query
  select *
  from public.curriculum_versions
  where exam_id = p_exam_id
    and is_default = true
    and status <> 'archived'
  order by created_at desc
  limit 1;
  if found then
    return;
  end if;

  return query
  select *
  from public.curriculum_versions
  where exam_id = p_exam_id
    and status <> 'archived'
  order by created_at desc
  limit 1;
end;
$$;

create or replace function public.get_student_curriculum(p_exam_id uuid)
returns table (
  curriculum_version_id uuid,
  curriculum_name text,
  revision_label text,
  canonical_topic_id uuid,
  subject_name text,
  unit_name text,
  topic_name text,
  coverage_mode text,
  depth_level text,
  sort_order integer,
  lesson_id uuid,
  lesson_title text,
  lesson_slug text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_version public.curriculum_versions;
begin
  select * into v_version from public.get_active_curriculum_version(p_exam_id);
  if v_version.id is null then
    return;
  end if;

  return query
  select
    v_version.id,
    v_version.name,
    v_version.revision_label,
    m.canonical_topic_id,
    coalesce(sc.name, cs.name) as subject_name,
    coalesce(uc.name, cu.name) as unit_name,
    coalesce(tc.name, ct.name) as topic_name,
    m.coverage_mode,
    m.depth_level,
    m.sort_order,
    l.id as lesson_id,
    l.title as lesson_title,
    l.slug as lesson_slug
  from public.exam_topic_map m
  join public.canonical_topics ct on ct.id = m.canonical_topic_id
  join public.canonical_units cu on cu.id = ct.canonical_unit_id
  join public.canonical_subjects cs on cs.id = cu.canonical_subject_id
  left join public.subject_catalog sc on sc.id = m.subject_id
  left join public.unit_catalog uc on uc.id = m.unit_id
  left join public.topic_catalog tc on tc.id = m.topic_id
  left join lateral (
    select les.id, les.title, les.slug
    from public.memory_lesson_exam_map em
    join public.memory_lessons les on les.id = em.lesson_id
    where em.curriculum_version_id = v_version.id
      and em.canonical_topic_id = m.canonical_topic_id
      and em.is_active = true
      and les.status = 'published'
    order by em.created_at desc
    limit 1
  ) l on true
  where m.curriculum_version_id = v_version.id
    and m.included = true
  order by m.sort_order, ct.name;
end;
$$;

create or replace function public.admin_set_active_curriculum_version(p_id uuid)
returns public.curriculum_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam uuid;
  v_row public.curriculum_versions;
begin
  perform public.require_admin();
  select exam_id into v_exam from public.curriculum_versions where id = p_id;
  if v_exam is null then raise exception 'NOT_FOUND'; end if;

  update public.curriculum_versions
  set manually_activated = false
  where exam_id = v_exam
    and id <> p_id
    and manually_activated = true;

  update public.curriculum_versions
  set is_default = false
  where exam_id = v_exam
    and id <> p_id
    and is_default = true;

  update public.curriculum_versions
  set
    status = 'active',
    manually_activated = true,
    is_default = true,
    activated_at = coalesce(activated_at, now()),
    archived_at = null
  where id = p_id
  returning * into v_row;

  perform public.write_admin_audit('curriculum_activate', 'curriculum_version', p_id::text, jsonb_build_object('exam_id', v_exam));
  return v_row;
end;
$$;

create or replace function public.admin_schedule_curriculum_version(p_id uuid, p_from date, p_until date)
returns public.curriculum_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.curriculum_versions;
begin
  perform public.require_admin();
  update public.curriculum_versions
  set
    status = 'scheduled',
    effective_from = p_from,
    effective_until = p_until,
    manually_activated = false
  where id = p_id
    and status <> 'archived'
  returning * into v_row;
  if v_row.id is null then raise exception 'NOT_FOUND'; end if;
  perform public.write_admin_audit('curriculum_schedule', 'curriculum_version', p_id::text, jsonb_build_object('from', p_from, 'until', p_until));
  return v_row;
end;
$$;

create or replace function public.admin_archive_curriculum_version(p_id uuid)
returns public.curriculum_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.curriculum_versions;
begin
  perform public.require_admin();
  update public.curriculum_versions
  set
    status = 'archived',
    archived_at = now(),
    manually_activated = false,
    is_default = false
  where id = p_id
  returning * into v_row;
  if v_row.id is null then raise exception 'NOT_FOUND'; end if;
  perform public.write_admin_audit('curriculum_archive', 'curriculum_version', p_id::text, '{}'::jsonb);
  return v_row;
end;
$$;

create or replace function public.admin_create_curriculum_version(
  p_exam_id uuid,
  p_code text,
  p_name text,
  p_revision_label text default null
)
returns public.curriculum_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.curriculum_versions;
  v_code text;
begin
  perform public.require_admin();
  if p_exam_id is null or public.norm_ws(p_name) is null then
    raise exception 'INVALID_INPUT';
  end if;
  v_code := upper(replace(coalesce(public.norm_ws(p_code), public.catalog_code_from_name(p_name) || '_CURRENT'), ' ', '_'));
  insert into public.curriculum_versions (exam_id, code, name, revision_label, status)
  values (p_exam_id, v_code, public.norm_ws(p_name), public.norm_ws(p_revision_label), 'draft')
  returning * into v_row;
  perform public.write_admin_audit('curriculum_create', 'curriculum_version', v_row.id::text, jsonb_build_object('exam_id', p_exam_id));
  return v_row;
end;
$$;

create or replace function public.admin_duplicate_curriculum_version(
  p_id uuid,
  p_code text default null,
  p_name text default null
)
returns public.curriculum_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.curriculum_versions;
  v_row public.curriculum_versions;
  v_code text;
  v_name text;
begin
  perform public.require_admin();
  select * into v_src from public.curriculum_versions where id = p_id;
  if v_src.id is null then raise exception 'NOT_FOUND'; end if;
  v_name := coalesce(public.norm_ws(p_name), v_src.name || ' (kopya)');
  v_code := upper(replace(coalesce(public.norm_ws(p_code), left(v_src.code || '_COPY_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6), 40)), ' ', '_'));

  insert into public.curriculum_versions (
    exam_id, code, name, revision_label, source_note, status, effective_from, effective_until
  )
  values (
    v_src.exam_id, v_code, v_name, v_src.revision_label, 'cloned_from=' || v_src.id::text, 'draft', null, null
  )
  returning * into v_row;

  insert into public.exam_topic_map (
    curriculum_version_id, canonical_topic_id, subject_id, unit_id, topic_id,
    included, coverage_mode, depth_level, priority, sort_order, exam_notes,
    required_points, excluded_points, prerequisite_canonical_topic_ids
  )
  select
    v_row.id, canonical_topic_id, subject_id, unit_id, topic_id,
    included, coverage_mode, depth_level, priority, sort_order, exam_notes,
    required_points, excluded_points, prerequisite_canonical_topic_ids
  from public.exam_topic_map
  where curriculum_version_id = v_src.id;

  insert into public.memory_lesson_exam_map (
    lesson_id, curriculum_version_id, canonical_topic_id, usage_mode, is_active
  )
  select lesson_id, v_row.id, canonical_topic_id, usage_mode, is_active
  from public.memory_lesson_exam_map
  where curriculum_version_id = v_src.id;

  perform public.write_admin_audit('curriculum_duplicate', 'curriculum_version', v_row.id::text, jsonb_build_object('from', p_id));
  return v_row;
end;
$$;

create or replace function public.admin_attach_memory_lesson(
  p_lesson_id uuid,
  p_exam_id uuid,
  p_usage_mode text default 'core'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson public.memory_lessons;
  v_version public.curriculum_versions;
  v_canonical uuid;
  v_mode text := coalesce(nullif(p_usage_mode, ''), 'core');
begin
  perform public.require_admin();
  if v_mode not in ('core', 'core_plus_extension', 'exam_specific') then
    raise exception 'INVALID_INPUT';
  end if;
  select * into v_lesson from public.memory_lessons where id = p_lesson_id;
  if v_lesson.id is null then raise exception 'NOT_FOUND'; end if;
  select * into v_version from public.get_active_curriculum_version(p_exam_id);
  if v_version.id is null then raise exception 'NO_CURRICULUM'; end if;
  v_canonical := v_lesson.canonical_topic_id;
  if v_canonical is null then
    select canonical_topic_id into v_canonical from public.topic_catalog where id = v_lesson.topic_id;
  end if;
  if v_canonical is null then raise exception 'NO_CANONICAL'; end if;

  insert into public.memory_lesson_exam_map (lesson_id, curriculum_version_id, canonical_topic_id, usage_mode, is_active)
  values (p_lesson_id, v_version.id, v_canonical, v_mode, true)
  on conflict (lesson_id, curriculum_version_id)
  do update set usage_mode = excluded.usage_mode, is_active = true, canonical_topic_id = excluded.canonical_topic_id;

  perform public.write_admin_audit('memory_lesson_attach', 'memory_lesson', p_lesson_id::text, jsonb_build_object('version', v_version.id));
  return jsonb_build_object('lesson_id', p_lesson_id, 'curriculum_version_id', v_version.id);
end;
$$;

create or replace function public.admin_find_reusable_lessons(p_topic_id uuid)
returns table (
  lesson_id uuid,
  title text,
  status text,
  lesson_scope text,
  coverage_depth text,
  canonical_topic_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_canonical uuid;
begin
  perform public.require_admin();
  select canonical_topic_id into v_canonical from public.topic_catalog where id = p_topic_id;
  if v_canonical is null then
    return;
  end if;
  return query
  select l.id, l.title, l.status, l.lesson_scope, l.coverage_depth, l.canonical_topic_id
  from public.memory_lessons l
  where l.canonical_topic_id = v_canonical
    and l.lesson_scope = 'core'
    and l.status in ('approved', 'published', 'pending_validation', 'draft')
  order by case l.status when 'published' then 0 when 'approved' then 1 else 2 end, l.updated_at desc;
end;
$$;

revoke all on function public.catalog_slug_from_name(text) from public;
revoke all on function public.get_active_curriculum_version(uuid) from public;
revoke all on function public.get_student_curriculum(uuid) from public;
revoke all on function public.admin_set_active_curriculum_version(uuid) from public;
revoke all on function public.admin_schedule_curriculum_version(uuid, date, date) from public;
revoke all on function public.admin_archive_curriculum_version(uuid) from public;
revoke all on function public.admin_create_curriculum_version(uuid, text, text, text) from public;
revoke all on function public.admin_duplicate_curriculum_version(uuid, text, text) from public;
revoke all on function public.admin_attach_memory_lesson(uuid, uuid, text) from public;
revoke all on function public.admin_find_reusable_lessons(uuid) from public;

grant execute on function public.catalog_slug_from_name(text) to authenticated;
grant execute on function public.get_active_curriculum_version(uuid) to authenticated;
grant execute on function public.get_student_curriculum(uuid) to authenticated;
grant execute on function public.admin_set_active_curriculum_version(uuid) to authenticated;
grant execute on function public.admin_schedule_curriculum_version(uuid, date, date) to authenticated;
grant execute on function public.admin_archive_curriculum_version(uuid) to authenticated;
grant execute on function public.admin_create_curriculum_version(uuid, text, text, text) to authenticated;
grant execute on function public.admin_duplicate_curriculum_version(uuid, text, text) to authenticated;
grant execute on function public.admin_attach_memory_lesson(uuid, uuid, text) to authenticated;
grant execute on function public.admin_find_reusable_lessons(uuid) to authenticated;

-- Preserve KPSS Önlisans / Tarih / İslamiyet Öncesi Türk Tarihi / Kut Anlayışı sample.
insert into public.exam_catalog (code, name, sort_order)
select 'KPSS_ONLISANS', 'KPSS Önlisans', 1
where not exists (select 1 from public.exam_catalog where code = 'KPSS_ONLISANS');

insert into public.subject_catalog (exam_id, code, name, sort_order)
select e.id, 'TARIH', 'Tarih', 1
from public.exam_catalog e
where e.code = 'KPSS_ONLISANS'
  and not exists (
    select 1 from public.subject_catalog s
    where s.exam_id = e.id and (s.code = 'TARIH' or lower(s.name) = 'tarih')
  );

insert into public.unit_catalog (subject_id, name, sort_order)
select s.id, 'İslamiyet Öncesi Türk Tarihi', 1
from public.subject_catalog s
join public.exam_catalog e on e.id = s.exam_id
where e.code = 'KPSS_ONLISANS' and s.code = 'TARIH'
  and not exists (
    select 1 from public.unit_catalog u
    where u.subject_id = s.id and lower(u.name) = lower('İslamiyet Öncesi Türk Tarihi')
  );

insert into public.topic_catalog (unit_id, name, sort_order, content_status)
select u.id, 'Kut Anlayışı', 1, 'empty'
from public.unit_catalog u
join public.subject_catalog s on s.id = u.subject_id
join public.exam_catalog e on e.id = s.exam_id
where e.code = 'KPSS_ONLISANS'
  and s.code = 'TARIH'
  and lower(u.name) = lower('İslamiyet Öncesi Türk Tarihi')
  and not exists (
    select 1 from public.topic_catalog t
    where t.unit_id = u.id and lower(t.name) = lower('Kut Anlayışı')
  );

insert into public.canonical_subjects (code, name, slug)
select 'TARIH', 'Tarih', 'tarih'
where not exists (select 1 from public.canonical_subjects where slug = 'tarih' or lower(name) = 'tarih');

insert into public.canonical_units (canonical_subject_id, name, slug)
select s.id, 'İslamiyet Öncesi Türk Tarihi', 'islamiyet-oncesi-turk-tarihi'
from public.canonical_subjects s
where s.slug = 'tarih'
  and not exists (
    select 1 from public.canonical_units u
    where u.canonical_subject_id = s.id and u.slug = 'islamiyet-oncesi-turk-tarihi'
  );

insert into public.canonical_topics (canonical_unit_id, name, slug)
select u.id, 'Kut Anlayışı', 'kut-anlayisi'
from public.canonical_units u
join public.canonical_subjects s on s.id = u.canonical_subject_id
where s.slug = 'tarih' and u.slug = 'islamiyet-oncesi-turk-tarihi'
  and not exists (
    select 1 from public.canonical_topics t
    where t.canonical_unit_id = u.id and t.slug = 'kut-anlayisi'
  );

update public.subject_catalog sc
set canonical_subject_id = cs.id
from public.exam_catalog e, public.canonical_subjects cs
where sc.exam_id = e.id
  and e.code = 'KPSS_ONLISANS'
  and sc.code = 'TARIH'
  and cs.slug = 'tarih'
  and sc.canonical_subject_id is null;

update public.unit_catalog uc
set canonical_unit_id = cu.id
from public.subject_catalog sc
join public.exam_catalog e on e.id = sc.exam_id
join public.canonical_units cu on cu.slug = 'islamiyet-oncesi-turk-tarihi'
join public.canonical_subjects cs on cs.id = cu.canonical_subject_id and cs.slug = 'tarih'
where uc.subject_id = sc.id
  and e.code = 'KPSS_ONLISANS'
  and lower(uc.name) = lower('İslamiyet Öncesi Türk Tarihi')
  and uc.canonical_unit_id is null;

update public.topic_catalog tc
set canonical_topic_id = ct.id
from public.unit_catalog uc
join public.subject_catalog sc on sc.id = uc.subject_id
join public.exam_catalog e on e.id = sc.exam_id
join public.canonical_topics ct on ct.slug = 'kut-anlayisi'
join public.canonical_units cu on cu.id = ct.canonical_unit_id and cu.slug = 'islamiyet-oncesi-turk-tarihi'
where tc.unit_id = uc.id
  and e.code = 'KPSS_ONLISANS'
  and lower(tc.name) = lower('Kut Anlayışı')
  and tc.canonical_topic_id is null;

insert into public.curriculum_versions (exam_id, code, name, revision_label, status, is_default, manually_activated, activated_at)
select e.id, 'KPSS_ONLISANS_CURRENT', 'Güncel KPSS Önlisans Müfredatı', 'Revizyon 1', 'active', true, true, now()
from public.exam_catalog e
where e.code = 'KPSS_ONLISANS'
  and not exists (select 1 from public.curriculum_versions v where v.code = 'KPSS_ONLISANS_CURRENT');

insert into public.exam_topic_map (
  curriculum_version_id, canonical_topic_id, subject_id, unit_id, topic_id,
  included, coverage_mode, depth_level, priority, sort_order
)
select v.id, ct.id, sc.id, uc.id, tc.id, true, 'core', 'standard', 'normal', 1
from public.curriculum_versions v
join public.exam_catalog e on e.id = v.exam_id
join public.canonical_topics ct on ct.slug = 'kut-anlayisi'
join public.canonical_units cu on cu.id = ct.canonical_unit_id
join public.topic_catalog tc on tc.canonical_topic_id = ct.id
join public.unit_catalog uc on uc.id = tc.unit_id
join public.subject_catalog sc on sc.id = uc.subject_id
where v.code = 'KPSS_ONLISANS_CURRENT'
  and e.code = 'KPSS_ONLISANS'
  and not exists (
    select 1 from public.exam_topic_map m
    where m.curriculum_version_id = v.id and m.canonical_topic_id = ct.id
  );

update public.memory_lessons l
set
  canonical_topic_id = ct.id,
  lesson_scope = 'core',
  coverage_depth = 'standard'
from public.canonical_topics ct
join public.canonical_units cu on cu.id = ct.canonical_unit_id
where ct.slug = 'kut-anlayisi'
  and cu.slug = 'islamiyet-oncesi-turk-tarihi'
  and l.canonical_topic_id is null
  and (
    lower(l.topic) = lower('Kut Anlayışı')
    or l.topic_id in (select id from public.topic_catalog where canonical_topic_id = ct.id)
  );

insert into public.memory_lesson_exam_map (lesson_id, curriculum_version_id, canonical_topic_id, usage_mode, is_active)
select l.id, v.id, l.canonical_topic_id, 'core', true
from public.memory_lessons l
join public.curriculum_versions v on v.code = 'KPSS_ONLISANS_CURRENT'
where l.canonical_topic_id is not null
  and not exists (
    select 1 from public.memory_lesson_exam_map m
    where m.lesson_id = l.id and m.curriculum_version_id = v.id
  );

insert into public.memory_lesson_question_sets (lesson_id, curriculum_version_id, canonical_topic_id, set_type, title)
select l.id, v.id, l.canonical_topic_id, 'core', 'Çekirdek sorular'
from public.memory_lessons l
join public.curriculum_versions v on v.code = 'KPSS_ONLISANS_CURRENT'
where l.canonical_topic_id is not null
  and exists (select 1 from public.memory_lesson_questions q where q.lesson_id = l.id)
  and not exists (
    select 1 from public.memory_lesson_question_sets s where s.lesson_id = l.id and s.set_type = 'core'
  );

update public.memory_lesson_questions q
set question_set_id = s.id
from public.memory_lesson_question_sets s
where q.lesson_id = s.lesson_id
  and q.question_set_id is null
  and s.set_type = 'core';
