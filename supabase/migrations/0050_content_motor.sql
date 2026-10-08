-- Phase 3: autonomous content motor. Factory stays paused. No mass generation.

-- 1) Canonical exam families (idempotent)
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
set name = x.name,
    is_active = true,
    sort_order = x.sort_order
from (values
  ('TYT', 'TYT', 10),
  ('AYT', 'AYT', 20),
  ('KPSS_ORTAOGRETIM', 'KPSS Ortaöğretim', 30),
  ('KPSS_ONLISANS', 'KPSS Önlisans', 40),
  ('KPSS_LISANS', 'KPSS Lisans', 50)
) as x(code, name, sort_order)
where e.code = x.code;

insert into public.exams (slug, name, kind)
select 'kpss_ortaogretim', 'KPSS Ortaöğretim', 'kpss_onlisans'
where not exists (select 1 from public.exams where slug = 'kpss_ortaogretim');

-- Draft/default curriculum versions so all five appear without destroying KPSS sample
insert into public.curriculum_versions (exam_id, code, name, revision_label, status, is_default, manually_activated)
select e.id, e.code || '_CURRENT', 'Güncel ' || e.name || ' Müfredatı', 'Revizyon 1',
       case when e.code = 'KPSS_ONLISANS' then 'active' else 'draft' end,
       true, e.code = 'KPSS_ONLISANS'
from public.exam_catalog e
where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
  and not exists (select 1 from public.curriculum_versions v where v.exam_id = e.id and v.code = e.code || '_CURRENT');

alter table public.content_factory_settings
  add column if not exists question_pool_target integer not null default 20,
  add column if not exists curriculum_workers integer not null default 1,
  add column if not exists text_workers integer not null default 2,
  add column if not exists image_workers integer not null default 1,
  add column if not exists tts_workers integer not null default 1,
  add column if not exists question_workers integer not null default 2,
  add column if not exists curriculum_sync_interval text not null default 'weekly';

update public.content_factory_settings
set production_enabled = false
where id = 1;

create table if not exists public.factory_exam_settings (
  exam_id uuid primary key references public.exam_catalog(id) on delete cascade,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.factory_exam_settings (exam_id, is_enabled)
select e.id, true
from public.exam_catalog e
where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
on conflict (exam_id) do nothing;

create table if not exists public.curriculum_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null,
  source_url text,
  exam_id uuid references public.exam_catalog(id) on delete cascade,
  priority integer not null default 100,
  is_enabled boolean not null default true,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curriculum_sources_type_check check (source_type in (
    'official_document', 'official_page', 'admin_json', 'manual', 'trusted_dataset', 'catalog_snapshot'
  ))
);

insert into public.curriculum_sources (name, source_type, exam_id, priority)
select 'Mevcut katalog (' || e.name || ')', 'catalog_snapshot', e.id, 10
from public.exam_catalog e
where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
  and not exists (
    select 1 from public.curriculum_sources s
    where s.exam_id = e.id and s.source_type = 'catalog_snapshot'
  );

create table if not exists public.curriculum_discovery_cache (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.curriculum_sources(id) on delete cascade,
  exam_id uuid references public.exam_catalog(id) on delete cascade,
  resource_identifier text not null,
  content_hash text not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  validated_at timestamptz,
  status text not null default 'cached',
  unique (source_id, resource_identifier, content_hash)
);

create table if not exists public.curriculum_change_proposals (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exam_catalog(id) on delete cascade,
  source_id uuid references public.curriculum_sources(id) on delete set null,
  from_version_id uuid references public.curriculum_versions(id) on delete set null,
  to_version_id uuid references public.curriculum_versions(id) on delete set null,
  diff jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  constraint curriculum_change_proposals_status_check
    check (status in ('draft', 'needs_review', 'approved', 'rejected', 'applied'))
);

alter table public.memory_lessons
  add column if not exists lesson_generation_hash text;

alter table public.content_generation_jobs
  add column if not exists generation_hash text,
  add column if not exists factory_stage text,
  add column if not exists locked_until timestamptz;

create unique index if not exists content_generation_jobs_hash_done_uidx
  on public.content_generation_jobs (canonical_topic_id, generation_hash)
  where generation_hash is not null and status in ('pending_validation', 'completed');

create unique index if not exists content_generation_jobs_hash_open_uidx
  on public.content_generation_jobs (canonical_topic_id, generation_hash)
  where generation_hash is not null and status in (
    'queued', 'generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media'
  );

create or replace function public.catalog_curriculum_hash(p_exam_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_payload text;
begin
  select string_agg(
    coalesce(s.code, '') || '/' || coalesce(u.code, '') || '/' || coalesce(t.code, '') || ':' || t.name,
    e'\n' order by s.sort_order, u.sort_order, t.sort_order, t.name
  )
  into v_payload
  from public.subject_catalog s
  left join public.unit_catalog u on u.subject_id = s.id
  left join public.topic_catalog t on t.unit_id = u.id
  where s.exam_id = p_exam_id;
  return encode(extensions.digest(coalesce(v_payload, ''), 'sha256'), 'hex');
end;
$$;

create or replace function public.lesson_input_hash(p_canonical_topic_id uuid, p_coverage text default 'core')
returns text
language plpgsql
stable
as $$
declare
  v_payload text;
begin
  select coalesce(ct.name, '') || '|' || coalesce(p_coverage, 'core') || '|' ||
         coalesce(string_agg(lo.title, '|' order by lo.objective_order), '')
  into v_payload
  from public.canonical_topics ct
  left join public.canonical_topic_learning_objectives lo on lo.canonical_topic_id = ct.id
  where ct.id = p_canonical_topic_id
  group by ct.name;
  return encode(extensions.digest(coalesce(v_payload, '') || '|memory-lesson-v1', 'sha256'), 'hex');
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
    'max_concurrency', v_row.max_concurrency,
    'question_pool_target', v_row.question_pool_target,
    'curriculum_workers', v_row.curriculum_workers,
    'text_workers', v_row.text_workers,
    'image_workers', v_row.image_workers,
    'tts_workers', v_row.tts_workers,
    'question_workers', v_row.question_workers,
    'curriculum_sync_interval', v_row.curriculum_sync_interval,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.admin_set_factory_exam_enabled(p_exam_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  insert into public.factory_exam_settings (exam_id, is_enabled)
  values (p_exam_id, p_enabled)
  on conflict (exam_id) do update set is_enabled = excluded.is_enabled, updated_at = now();
  return jsonb_build_object('exam_id', p_exam_id, 'is_enabled', p_enabled);
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
        e.id,
        e.code,
        e.name,
        e.sort_order,
        coalesce(f.is_enabled, true) as is_enabled,
        v.id as curriculum_version_id,
        v.status as curriculum_status,
        v.name as curriculum_name,
        (select count(*) from public.exam_topic_map m where m.curriculum_version_id = v.id and m.included) as topics,
        (
          select count(distinct m.canonical_topic_id)
          from public.exam_topic_map m
          join public.memory_lessons l on l.canonical_topic_id = m.canonical_topic_id
          where m.curriculum_version_id = v.id and m.included
            and l.status in ('approved', 'published', 'pending_validation')
        ) as lessons_ready,
        (
          select count(distinct q.canonical_topic_id)
          from public.exam_topic_map m
          join public.questions q on q.canonical_topic_id = m.canonical_topic_id
          where m.curriculum_version_id = v.id and m.included and q.question_status <> 'archived'
        ) as questions_ready,
        (
          select count(*) from public.content_generation_jobs j
          where j.exam_id = e.id and j.status = 'failed'
        ) as failed,
        (
          select count(*) from public.memory_lessons l
          join public.exam_topic_map m on m.canonical_topic_id = l.canonical_topic_id
          where m.curriculum_version_id = v.id and l.status = 'pending_validation'
        ) as pending_review
      from public.exam_catalog e
      left join public.factory_exam_settings f on f.exam_id = e.id
      left join lateral (
        select * from public.get_active_curriculum_version(e.id)
      ) v on true
      where e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_factory_preview_all()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam record;
  v_one jsonb;
  v_generate int := 0;
  v_reused int := 0;
  v_skipped int := 0;
  v_exams jsonb := '[]'::jsonb;
  v_version uuid;
begin
  perform public.require_admin();
  for v_exam in
    select e.id, e.code, e.name
    from public.exam_catalog e
    left join public.factory_exam_settings f on f.exam_id = e.id
    where e.is_active
      and e.code in ('TYT', 'AYT', 'KPSS_ORTAOGRETIM', 'KPSS_ONLISANS', 'KPSS_LISANS')
      and coalesce(f.is_enabled, true)
  loop
    select id into v_version from public.get_active_curriculum_version(v_exam.id);
    if v_version is null then
      v_exams := v_exams || jsonb_build_array(jsonb_build_object('exam', v_exam.name, 'generate', 0, 'reused', 0, 'skipped', 0, 'note', 'curriculum_missing'));
      continue;
    end if;
    v_one := public.admin_queue_missing_content(v_exam.id, v_version, null, null, false, false);
    v_generate := v_generate + coalesce((v_one->>'generate')::int, 0);
    v_reused := v_reused + coalesce((v_one->>'reused')::int, 0);
    v_skipped := v_skipped + coalesce((v_one->>'skipped')::int, 0);
    v_exams := v_exams || jsonb_build_array(jsonb_build_object(
      'exam', v_exam.name, 'code', v_exam.code,
      'generate', (v_one->>'generate')::int,
      'reused', (v_one->>'reused')::int,
      'skipped', (v_one->>'skipped')::int
    ));
  end loop;
  return jsonb_build_object(
    'generate', v_generate,
    'reused', v_reused,
    'skipped', v_skipped,
    'exams', v_exams,
    'production_enabled', (select production_enabled from public.content_factory_settings where id = 1)
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
  v_exam record;
  v_version uuid;
  v_one jsonb;
  v_queued int := 0;
begin
  perform public.require_admin();
  v_preview := public.admin_factory_preview_all();
  if not coalesce(p_confirm, false) then
    return v_preview || jsonb_build_object('needs_confirm', true, 'queued', 0);
  end if;
  update public.content_factory_settings set production_enabled = true where id = 1;
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
    v_one := public.admin_queue_missing_content(v_exam.id, v_version, null, null, true, true);
    v_queued := v_queued + coalesce((v_one->>'queued')::int, 0);
  end loop;
  perform public.write_admin_audit('factory_motor_start', 'content_factory', '1', jsonb_build_object('queued', v_queued));
  return v_preview || jsonb_build_object('needs_confirm', false, 'queued', v_queued, 'production_enabled', true);
end;
$$;

create or replace function public.admin_curriculum_sync(p_exam_id uuid default null, p_force boolean default false)
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
  v_payload jsonb;
  v_cache public.curriculum_discovery_cache;
begin
  perform public.require_admin();
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

    if v_cache.id is not null and not coalesce(p_force, false) then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    insert into public.curriculum_discovery_cache (source_id, exam_id, resource_identifier, content_hash, normalized_payload, status)
    values (v_src.id, v_exam, 'catalog', v_hash, v_payload, 'cached')
    on conflict (source_id, resource_identifier, content_hash) do nothing;

    if v_cache.id is null then
      insert into public.curriculum_change_proposals (exam_id, source_id, from_version_id, diff, status)
      select v_exam, v_src.id, (select id from public.get_active_curriculum_version(v_exam)),
             jsonb_build_object('result', 'NEW_OR_FIRST_SNAPSHOT', 'hash', v_hash),
             'needs_review'
      where not exists (
        select 1 from public.curriculum_change_proposals p
        where p.exam_id = v_exam and p.diff->>'hash' = v_hash and p.status in ('draft', 'needs_review')
      );
      v_new := v_new + 1;
    else
      v_unchanged := v_unchanged + 1;
    end if;

    update public.curriculum_sources set last_success_at = now() where id = v_src.id;
  end loop;
  return jsonb_build_object('unchanged', v_unchanged, 'proposals', v_new, 'ai_called', false, 'fetched_remote', false);
end;
$$;

create or replace function public.admin_curriculum_diff(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_added int := 0;
  v_removed int := 0;
  v_unchanged int := 0;
begin
  perform public.require_admin();
  select count(*) into v_added
  from public.exam_topic_map n
  where n.curriculum_version_id = p_to and n.included
    and not exists (
      select 1 from public.exam_topic_map o
      where o.curriculum_version_id = p_from and o.canonical_topic_id = n.canonical_topic_id and o.included
    );
  select count(*) into v_removed
  from public.exam_topic_map o
  where o.curriculum_version_id = p_from and o.included
    and not exists (
      select 1 from public.exam_topic_map n
      where n.curriculum_version_id = p_to and n.canonical_topic_id = o.canonical_topic_id and n.included
    );
  select count(*) into v_unchanged
  from public.exam_topic_map n
  join public.exam_topic_map o
    on o.canonical_topic_id = n.canonical_topic_id and o.included and n.included
  where n.curriculum_version_id = p_to and o.curriculum_version_id = p_from;
  return jsonb_build_object(
    'added', v_added,
    'removed', v_removed,
    'unchanged', v_unchanged,
    'changed_scope', 0
  );
end;
$$;

create or replace function public.admin_recover_expired_factory_locks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
begin
  update public.content_generation_jobs
  set status = 'queued',
      locked_until = null
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media')
    and locked_until is not null
    and locked_until < now();
  get diagnostics v_n = row_count;
  return v_n;
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
  perform public.admin_recover_expired_factory_locks();
  select production_enabled, max_concurrency into v_enabled, v_max
  from public.content_factory_settings where id = 1;
  if not v_enabled then
    return;
  end if;
  select count(*) into v_busy
  from public.content_generation_jobs
  where status in ('generating_text', 'validating_pedagogy', 'generating_questions', 'generating_media')
    and (locked_until is null or locked_until > now());
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
      error_message = null,
      locked_until = now() + interval '12 minutes',
      generation_hash = coalesce(j.generation_hash, public.lesson_input_hash(j.canonical_topic_id, j.coverage_mode))
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

create or replace function public.admin_ensure_topic_tests(p_canonical_topic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_final uuid;
  v_pool uuid;
begin
  perform public.require_admin();
  v_final := public.ensure_curriculum_question_set(p_canonical_topic_id, 'lesson_final', null, null, null, 'Ders testi (10)');
  v_pool := public.ensure_curriculum_question_set(p_canonical_topic_id, 'topic_pool', null, null, null, 'Konu havuzu');
  return jsonb_build_object('lesson_final_set', v_final, 'topic_pool_set', v_pool, 'copied_rows', false);
end;
$$;

create or replace function public.admin_auto_fill_system_exam(p_exam uuid, p_count int, p_exam_catalog_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int := 0;
  v_ids uuid[];
begin
  perform public.require_admin();
  select coalesce(array_agg(id), array[]::uuid[])
  into v_ids
  from (
    select q.id
    from public.questions q
    where q.question_status = 'published'
      and q.is_published = true
      and (p_exam_catalog_id is null or q.exam_catalog_id = p_exam_catalog_id)
    order by random()
    limit least(greatest(coalesce(p_count, 20), 1), 80)
  ) s;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('filled', 0, 'reason', 'no_published_questions');
  end if;

  perform public.admin_set_exam_questions(p_exam, v_ids);
  v_n := coalesce(array_length(v_ids, 1), 0);
  return jsonb_build_object('filled', v_n, 'copied_rows', false);
end;
$$;

create or replace function public.admin_list_curriculum_proposals(p_exam_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select p.id, p.exam_id, e.name as exam_name, p.status, p.diff, p.created_at
      from public.curriculum_change_proposals p
      join public.exam_catalog e on e.id = p.exam_id
      where p_exam_id is null or p.exam_id = p_exam_id
      limit 40
    ) x
  ), '[]'::jsonb);
end;
$$;

alter table public.curriculum_sources enable row level security;
alter table public.curriculum_discovery_cache enable row level security;
alter table public.curriculum_change_proposals enable row level security;
alter table public.factory_exam_settings enable row level security;

drop policy if exists curriculum_sources_admin on public.curriculum_sources;
create policy curriculum_sources_admin on public.curriculum_sources
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists curriculum_discovery_cache_admin on public.curriculum_discovery_cache;
create policy curriculum_discovery_cache_admin on public.curriculum_discovery_cache
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists curriculum_change_proposals_admin on public.curriculum_change_proposals;
create policy curriculum_change_proposals_admin on public.curriculum_change_proposals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists factory_exam_settings_admin on public.factory_exam_settings;
create policy factory_exam_settings_admin on public.factory_exam_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.curriculum_sources to authenticated;
grant select, insert, update, delete on public.curriculum_discovery_cache to authenticated;
grant select, insert, update, delete on public.curriculum_change_proposals to authenticated;
grant select, insert, update, delete on public.factory_exam_settings to authenticated;

revoke all on function public.admin_set_factory_exam_enabled(uuid, boolean) from public;
revoke all on function public.admin_factory_exam_coverage() from public;
revoke all on function public.admin_factory_preview_all() from public;
revoke all on function public.admin_factory_start_motor(boolean) from public;
revoke all on function public.admin_curriculum_sync(uuid, boolean) from public;
revoke all on function public.admin_curriculum_diff(uuid, uuid) from public;
revoke all on function public.admin_ensure_topic_tests(uuid) from public;
revoke all on function public.admin_auto_fill_system_exam(uuid, int, uuid) from public;
revoke all on function public.admin_list_curriculum_proposals(uuid) from public;
revoke all on function public.admin_recover_expired_factory_locks() from public;

grant execute on function public.admin_set_factory_exam_enabled(uuid, boolean) to authenticated;
grant execute on function public.admin_factory_exam_coverage() to authenticated;
grant execute on function public.admin_factory_preview_all() to authenticated;
grant execute on function public.admin_factory_start_motor(boolean) to authenticated;
grant execute on function public.admin_curriculum_sync(uuid, boolean) to authenticated;
grant execute on function public.admin_curriculum_diff(uuid, uuid) to authenticated;
grant execute on function public.admin_ensure_topic_tests(uuid) to authenticated;
grant execute on function public.admin_auto_fill_system_exam(uuid, int, uuid) to authenticated;
grant execute on function public.admin_list_curriculum_proposals(uuid) to authenticated;
grant execute on function public.admin_recover_expired_factory_locks() to authenticated;
