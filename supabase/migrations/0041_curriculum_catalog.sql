-- Hafıza Dersleri Phase 1.5: exam/subject/unit/topic catalog + memory_lessons FKs.

create or replace function public.norm_ws(p_value text)
returns text
language sql
immutable
as $$
  select nullif(trim(both from regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')), '');
$$;

create table if not exists public.exam_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_catalog_code_check check (code ~ '^[A-Z0-9_]+$')
);

create unique index if not exists exam_catalog_code_uidx on public.exam_catalog (code);
create unique index if not exists exam_catalog_name_uidx on public.exam_catalog (lower(name));

create table if not exists public.subject_catalog (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_catalog(id) on delete restrict,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subject_catalog_code_check check (code ~ '^[A-Z0-9_]+$')
);

create unique index if not exists subject_catalog_exam_code_uidx on public.subject_catalog (exam_id, code);
create unique index if not exists subject_catalog_exam_name_uidx on public.subject_catalog (exam_id, lower(name));

create table if not exists public.unit_catalog (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subject_catalog(id) on delete restrict,
  code text,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists unit_catalog_subject_name_uidx on public.unit_catalog (subject_id, lower(name));
create unique index if not exists unit_catalog_subject_code_uidx
  on public.unit_catalog (subject_id, code)
  where code is not null;

create table if not exists public.topic_catalog (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.unit_catalog(id) on delete restrict,
  code text,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  content_status text not null default 'empty',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_catalog_status_check
    check (content_status in ('empty', 'queued', 'generating', 'pending_validation', 'published'))
);

create unique index if not exists topic_catalog_unit_name_uidx on public.topic_catalog (unit_id, lower(name));
create unique index if not exists topic_catalog_unit_code_uidx
  on public.topic_catalog (unit_id, code)
  where code is not null;

alter table public.memory_lessons
  add column if not exists exam_id uuid references public.exam_catalog(id) on delete set null,
  add column if not exists subject_id uuid references public.subject_catalog(id) on delete set null,
  add column if not exists unit_id uuid references public.unit_catalog(id) on delete set null,
  add column if not exists topic_id uuid references public.topic_catalog(id) on delete set null;

create index if not exists memory_lessons_topic_idx on public.memory_lessons (topic_id);

drop trigger if exists exam_catalog_set_updated_at on public.exam_catalog;
create trigger exam_catalog_set_updated_at
  before update on public.exam_catalog
  for each row execute procedure public.set_updated_at();

drop trigger if exists subject_catalog_set_updated_at on public.subject_catalog;
create trigger subject_catalog_set_updated_at
  before update on public.subject_catalog
  for each row execute procedure public.set_updated_at();

drop trigger if exists unit_catalog_set_updated_at on public.unit_catalog;
create trigger unit_catalog_set_updated_at
  before update on public.unit_catalog
  for each row execute procedure public.set_updated_at();

drop trigger if exists topic_catalog_set_updated_at on public.topic_catalog;
create trigger topic_catalog_set_updated_at
  before update on public.topic_catalog
  for each row execute procedure public.set_updated_at();

alter table public.exam_catalog enable row level security;
alter table public.subject_catalog enable row level security;
alter table public.unit_catalog enable row level security;
alter table public.topic_catalog enable row level security;

drop policy if exists exam_catalog_select on public.exam_catalog;
create policy exam_catalog_select on public.exam_catalog
  for select to authenticated
  using (is_active = true or public.is_admin());

drop policy if exists exam_catalog_admin_write on public.exam_catalog;
create policy exam_catalog_admin_write on public.exam_catalog
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists subject_catalog_select on public.subject_catalog;
create policy subject_catalog_select on public.subject_catalog
  for select to authenticated
  using (is_active = true or public.is_admin());

drop policy if exists subject_catalog_admin_write on public.subject_catalog;
create policy subject_catalog_admin_write on public.subject_catalog
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists unit_catalog_select on public.unit_catalog;
create policy unit_catalog_select on public.unit_catalog
  for select to authenticated
  using (is_active = true or public.is_admin());

drop policy if exists unit_catalog_admin_write on public.unit_catalog;
create policy unit_catalog_admin_write on public.unit_catalog
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists topic_catalog_select on public.topic_catalog;
create policy topic_catalog_select on public.topic_catalog
  for select to authenticated
  using (is_active = true or public.is_admin());

drop policy if exists topic_catalog_admin_write on public.topic_catalog;
create policy topic_catalog_admin_write on public.topic_catalog
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.exam_catalog to authenticated;
grant select, insert, update, delete on public.subject_catalog to authenticated;
grant select, insert, update, delete on public.unit_catalog to authenticated;
grant select, insert, update, delete on public.topic_catalog to authenticated;

create or replace function public.catalog_code_from_name(p_name text)
returns text
language plpgsql
immutable
as $$
declare
  v_raw text := upper(translate(
    coalesce(public.norm_ws(p_name), ''),
    'ÇĞİIÖŞÜÂÎÛ',
    'CGIIOSUAIU'
  ));
  v_code text;
begin
  v_code := regexp_replace(v_raw, '[^A-Z0-9]+', '_', 'g');
  v_code := regexp_replace(v_code, '_+', '_', 'g');
  v_code := trim(both '_' from v_code);
  if v_code = '' then
    return 'ITEM';
  end if;
  return left(v_code, 40);
end;
$$;

create or replace function public.admin_import_curriculum(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.require_admin();
  v_item jsonb;
  v_topic jsonb;
  v_exam_id uuid;
  v_subject_id uuid;
  v_unit_id uuid;
  v_topic_id uuid;
  v_exam_code text;
  v_exam_name text;
  v_subject_name text;
  v_subject_code text;
  v_unit_name text;
  v_topic_name text;
  v_exams_created int := 0;
  v_subjects_created int := 0;
  v_units_created int := 0;
  v_topics_created int := 0;
  v_skipped int := 0;
  v_sort int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_INPUT';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_exam_name := public.norm_ws(coalesce(v_item->>'exam', v_item->>'exam_name', ''));
    v_exam_code := upper(replace(coalesce(public.norm_ws(v_item->>'exam_code'), public.catalog_code_from_name(v_exam_name), ''), ' ', '_'));
    v_subject_name := public.norm_ws(v_item->>'subject');
    v_unit_name := public.norm_ws(v_item->>'unit');

    if v_exam_name is null or v_exam_code is null or v_subject_name is null or v_unit_name is null then
      raise exception 'INVALID_INPUT';
    end if;
    if v_item->'topics' is null or jsonb_typeof(v_item->'topics') <> 'array' then
      raise exception 'INVALID_INPUT';
    end if;

    select id into v_exam_id from public.exam_catalog where code = v_exam_code;
    if v_exam_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_sort from public.exam_catalog;
      insert into public.exam_catalog (code, name, sort_order)
      values (v_exam_code, v_exam_name, v_sort)
      returning id into v_exam_id;
      v_exams_created := v_exams_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;

    v_subject_code := coalesce(
      public.norm_ws(v_item->>'subject_code'),
      public.catalog_code_from_name(v_subject_name)
    );
    v_subject_code := upper(replace(v_subject_code, ' ', '_'));

    select id into v_subject_id
    from public.subject_catalog
    where exam_id = v_exam_id and lower(name) = lower(v_subject_name);
    if v_subject_id is null then
      if exists (
        select 1 from public.subject_catalog where exam_id = v_exam_id and code = v_subject_code
      ) then
        v_subject_code := left(v_subject_code || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4), 40);
      end if;
      select coalesce(max(sort_order), 0) + 1 into v_sort
      from public.subject_catalog where exam_id = v_exam_id;
      insert into public.subject_catalog (exam_id, code, name, sort_order)
      values (v_exam_id, v_subject_code, v_subject_name, v_sort)
      returning id into v_subject_id;
      v_subjects_created := v_subjects_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;

    select id into v_unit_id
    from public.unit_catalog
    where subject_id = v_subject_id and lower(name) = lower(v_unit_name);
    if v_unit_id is null then
      select coalesce(max(sort_order), 0) + 1 into v_sort
      from public.unit_catalog where subject_id = v_subject_id;
      insert into public.unit_catalog (subject_id, name, sort_order)
      values (v_subject_id, v_unit_name, v_sort)
      returning id into v_unit_id;
      v_units_created := v_units_created + 1;
    else
      v_skipped := v_skipped + 1;
    end if;

    for v_topic in select value from jsonb_array_elements(v_item->'topics')
    loop
      if jsonb_typeof(v_topic) = 'string' then
        v_topic_name := public.norm_ws(v_topic #>> '{}');
      else
        v_topic_name := public.norm_ws(coalesce(v_topic->>'name', v_topic->>'title'));
      end if;
      if v_topic_name is null then
        continue;
      end if;
      select id into v_topic_id
      from public.topic_catalog
      where unit_id = v_unit_id and lower(name) = lower(v_topic_name);
      if v_topic_id is null then
        select coalesce(max(sort_order), 0) + 1 into v_sort
        from public.topic_catalog where unit_id = v_unit_id;
        insert into public.topic_catalog (unit_id, name, sort_order, content_status)
        values (v_unit_id, v_topic_name, v_sort, 'empty')
        returning id into v_topic_id;
        v_topics_created := v_topics_created + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
  end loop;

  perform public.write_admin_audit(
    'curriculum_import',
    'curriculum',
    null,
    jsonb_build_object(
      'exams_created', v_exams_created,
      'subjects_created', v_subjects_created,
      'units_created', v_units_created,
      'topics_created', v_topics_created,
      'skipped_duplicates', v_skipped
    )
  );

  return jsonb_build_object(
    'exams_created', v_exams_created,
    'subjects_created', v_subjects_created,
    'units_created', v_units_created,
    'topics_created', v_topics_created,
    'skipped_duplicates', v_skipped,
    'errors', '[]'::jsonb
  );
end;
$$;

revoke all on function public.norm_ws(text) from public;
revoke all on function public.catalog_code_from_name(text) from public;
revoke all on function public.admin_import_curriculum(jsonb) from public;
grant execute on function public.norm_ws(text) to authenticated;
grant execute on function public.catalog_code_from_name(text) to authenticated;
grant execute on function public.admin_import_curriculum(jsonb) to authenticated;
