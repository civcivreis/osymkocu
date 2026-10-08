-- Phase 3E: prerequisite-aware ordering. Does not rewrite published sort_order or regenerate content.

alter table public.canonical_subjects
  add column if not exists ordering_strategy text not null default 'conceptual';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'canonical_subjects_ordering_strategy_check') then
    alter table public.canonical_subjects
      add constraint canonical_subjects_ordering_strategy_check
      check (ordering_strategy in (
        'conceptual', 'chronological', 'prerequisite_heavy', 'spatial',
        'skill_progression', 'legal_hierarchy', 'chronological_conceptual'
      ));
  end if;
end $$;

alter table public.canonical_topics
  add column if not exists sort_order integer not null default 0,
  add column if not exists difficulty_level smallint not null default 3,
  add column if not exists ordering_confidence numeric,
  add column if not exists ordering_source text,
  add column if not exists ordering_notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'canonical_topics_difficulty_check') then
    alter table public.canonical_topics
      add constraint canonical_topics_difficulty_check
      check (difficulty_level between 1 and 5);
  end if;
end $$;

alter table public.canonical_topic_segments
  add column if not exists difficulty_level smallint not null default 3,
  add column if not exists prerequisite_segment_id uuid references public.canonical_topic_segments(id) on delete set null;

alter table public.memory_lessons
  add column if not exists lesson_sequence integer not null default 1;

alter table public.exam_topic_map
  add column if not exists exam_weight numeric,
  add column if not exists recommended_sort_order integer;

create table if not exists public.canonical_topic_dependencies (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.canonical_topics(id) on delete cascade,
  depends_on_topic_id uuid not null references public.canonical_topics(id) on delete cascade,
  dependency_type text not null default 'soft_prerequisite'
    check (dependency_type in ('hard_prerequisite', 'soft_prerequisite', 'recommended_before', 'related')),
  strength text not null default 'medium'
    check (strength in ('required', 'strong', 'medium', 'weak')),
  reason text,
  source text not null default 'manual'
    check (source in ('manual', 'ai', 'official', 'import')),
  status text not null default 'active'
    check (status in ('active', 'needs_review', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_topic_dependencies_self check (topic_id <> depends_on_topic_id),
  unique (topic_id, depends_on_topic_id, dependency_type)
);

create index if not exists canonical_topic_dependencies_topic_idx
  on public.canonical_topic_dependencies (topic_id);
create index if not exists canonical_topic_dependencies_dep_idx
  on public.canonical_topic_dependencies (depends_on_topic_id);

alter table public.canonical_topic_dependencies enable row level security;
drop policy if exists canonical_topic_dependencies_select on public.canonical_topic_dependencies;
create policy canonical_topic_dependencies_select on public.canonical_topic_dependencies
  for select to authenticated using (true);
drop policy if exists canonical_topic_dependencies_admin on public.canonical_topic_dependencies;
create policy canonical_topic_dependencies_admin on public.canonical_topic_dependencies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.canonical_topic_dependencies to authenticated;

drop trigger if exists canonical_topic_dependencies_set_updated_at on public.canonical_topic_dependencies;
create trigger canonical_topic_dependencies_set_updated_at
  before update on public.canonical_topic_dependencies
  for each row execute procedure public.set_updated_at();

create table if not exists public.curriculum_ordering_suggestions (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid references public.curriculum_versions(id) on delete cascade,
  topic_id uuid references public.canonical_topics(id) on delete cascade,
  depends_on_topic_id uuid references public.canonical_topics(id) on delete cascade,
  dependency_type text not null default 'soft_prerequisite',
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'rejected')),
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.curriculum_ordering_suggestions enable row level security;
drop policy if exists curriculum_ordering_suggestions_admin on public.curriculum_ordering_suggestions;
create policy curriculum_ordering_suggestions_admin on public.curriculum_ordering_suggestions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.curriculum_ordering_suggestions to authenticated;

create table if not exists public.curriculum_order_cache (
  curriculum_version_id uuid primary key references public.curriculum_versions(id) on delete cascade,
  payload jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

alter table public.curriculum_order_cache enable row level security;
drop policy if exists curriculum_order_cache_select on public.curriculum_order_cache;
create policy curriculum_order_cache_select on public.curriculum_order_cache
  for select to authenticated using (true);
grant select on public.curriculum_order_cache to authenticated;

create or replace function public.invalidate_curriculum_order_cache(p_version uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_version is null then
    delete from public.curriculum_order_cache;
  else
    delete from public.curriculum_order_cache where curriculum_version_id = p_version;
  end if;
end;
$$;

create or replace function public.hard_dependency_would_cycle(p_topic uuid, p_depends_on uuid)
returns boolean
language sql
stable
as $$
  with recursive walk as (
    select d.topic_id as node
    from public.canonical_topic_dependencies d
    where d.status = 'active'
      and d.dependency_type = 'hard_prerequisite'
      and d.depends_on_topic_id = p_topic
    union
    select d.topic_id
    from public.canonical_topic_dependencies d
    join walk w on w.node = d.depends_on_topic_id
    where d.status = 'active' and d.dependency_type = 'hard_prerequisite'
  )
  select p_topic = p_depends_on or exists (select 1 from walk where node = p_depends_on);
$$;

create or replace function public.compute_version_topic_order(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_pick uuid;
  v_rank int := 0;
  v_out jsonb := '[]'::jsonb;
  v_left int;
  v_reason text;
begin
  create temporary table if not exists _ord_nodes (
    id uuid primary key,
    official int not null,
    difficulty int not null,
    name text not null,
    indeg int not null default 0,
    placed boolean not null default false,
    rank int
  ) on commit drop;
  delete from _ord_nodes;

  create temporary table if not exists _ord_hard (
    src uuid not null,
    dst uuid not null
  ) on commit drop;
  delete from _ord_hard;

  create temporary table if not exists _ord_soft (
    src uuid not null,
    dst uuid not null
  ) on commit drop;
  delete from _ord_soft;

  insert into _ord_nodes (id, official, difficulty, name)
  select m.canonical_topic_id, m.sort_order, coalesce(ct.difficulty_level, 3), ct.name
  from public.exam_topic_map m
  join public.canonical_topics ct on ct.id = m.canonical_topic_id
  where m.curriculum_version_id = p_version and m.included = true;

  insert into _ord_hard (src, dst)
  select d.depends_on_topic_id, d.topic_id
  from public.canonical_topic_dependencies d
  where d.status = 'active'
    and d.dependency_type = 'hard_prerequisite'
    and exists (select 1 from _ord_nodes n where n.id = d.topic_id)
    and exists (select 1 from _ord_nodes n where n.id = d.depends_on_topic_id);

  insert into _ord_soft (src, dst)
  select d.depends_on_topic_id, d.topic_id
  from public.canonical_topic_dependencies d
  where d.status = 'active'
    and d.dependency_type in ('soft_prerequisite', 'recommended_before')
    and exists (select 1 from _ord_nodes n where n.id = d.topic_id)
    and exists (select 1 from _ord_nodes n where n.id = d.depends_on_topic_id);

  update _ord_nodes n
  set indeg = (select count(*) from _ord_hard h where h.dst = n.id);

  loop
    select count(*) into v_left from _ord_nodes where not placed;
    exit when v_left = 0;

    select n.id into v_pick
    from _ord_nodes n
    where not n.placed
      and n.indeg = 0
      and not exists (
        select 1 from _ord_soft s
        join _ord_nodes a on a.id = s.src
        where s.dst = n.id and not a.placed and a.indeg = 0
      )
    order by n.official, n.difficulty, n.name, n.id
    limit 1;

    if v_pick is null then
      select n.id into v_pick
      from _ord_nodes n
      where not n.placed and n.indeg = 0
      order by n.official, n.difficulty, n.name, n.id
      limit 1;
    end if;

    if v_pick is null then
      select n.id into v_pick
      from _ord_nodes n
      where not n.placed
      order by n.official, n.name, n.id
      limit 1;
      v_reason := 'fallback_cycle';
    else
      v_reason := case
        when exists (select 1 from _ord_hard h where h.dst = v_pick) then 'prerequisite'
        else 'official_order'
      end;
    end if;

    v_rank := v_rank + 1;
    update _ord_nodes set placed = true, rank = v_rank where id = v_pick;
    update _ord_nodes n
    set indeg = n.indeg - 1
    from _ord_hard h
    where h.src = v_pick and h.dst = n.id and not n.placed;

    select jsonb_build_object(
      'canonical_topic_id', n.id,
      'official_sort', n.official,
      'recommended_rank', v_rank,
      'reason', v_reason,
      'difficulty_level', n.difficulty,
      'name', n.name
    ) into v_item from _ord_nodes n where n.id = v_pick;
    v_out := v_out || jsonb_build_array(v_item);
  end loop;

  return v_out;
end;
$$;

create or replace function public.get_version_topic_order(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  select payload into v_payload from public.curriculum_order_cache where curriculum_version_id = p_version;
  if v_payload is not null then return v_payload; end if;
  v_payload := public.compute_version_topic_order(p_version);
  insert into public.curriculum_order_cache (curriculum_version_id, payload, computed_at)
  values (p_version, v_payload, now())
  on conflict (curriculum_version_id) do update set payload = excluded.payload, computed_at = now();
  return v_payload;
end;
$$;

create or replace function public.admin_add_topic_dependency(
  p_topic uuid,
  p_depends_on uuid,
  p_type text,
  p_strength text default 'medium',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.canonical_topic_dependencies%rowtype;
  v_type text := coalesce(nullif(p_type, ''), 'soft_prerequisite');
begin
  perform public.require_admin();
  if p_topic = p_depends_on then raise exception 'SELF_DEPENDENCY'; end if;
  if not exists (select 1 from public.canonical_topics where id = p_topic)
     or not exists (select 1 from public.canonical_topics where id = p_depends_on) then
    raise exception 'NOT_FOUND';
  end if;
  if v_type = 'hard_prerequisite' and public.hard_dependency_would_cycle(p_topic, p_depends_on) then
    raise exception 'CYCLE_DETECTED';
  end if;
  insert into public.canonical_topic_dependencies (
    topic_id, depends_on_topic_id, dependency_type, strength, reason, source, status
  ) values (
    p_topic, p_depends_on, v_type, coalesce(p_strength, 'medium'), p_reason, 'manual', 'active'
  )
  on conflict (topic_id, depends_on_topic_id, dependency_type) do update
    set strength = excluded.strength, reason = excluded.reason, status = 'active', source = 'manual'
  returning * into v_row;
  perform public.invalidate_curriculum_order_cache();
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_remove_topic_dependency(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  delete from public.canonical_topic_dependencies where id = p_id;
  perform public.invalidate_curriculum_order_cache();
end;
$$;

create or replace function public.admin_set_exam_topic_sort(p_map_id uuid, p_sort int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.exam_topic_map%rowtype;
begin
  perform public.require_admin();
  update public.exam_topic_map
  set sort_order = p_sort, updated_at = now()
  where id = p_map_id
  returning * into v_row;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform public.invalidate_curriculum_order_cache(v_row.curriculum_version_id);
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_apply_ordering_suggestion(p_id uuid, p_apply boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.curriculum_ordering_suggestions%rowtype;
begin
  perform public.require_admin();
  select * into v_s from public.curriculum_ordering_suggestions where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not p_apply then
    update public.curriculum_ordering_suggestions set status = 'rejected' where id = p_id;
    return jsonb_build_object('status', 'rejected');
  end if;
  if v_s.topic_id is not null and v_s.depends_on_topic_id is not null then
    perform public.admin_add_topic_dependency(v_s.topic_id, v_s.depends_on_topic_id, v_s.dependency_type, 'medium', v_s.reason);
  end if;
  update public.curriculum_ordering_suggestions set status = 'applied' where id = p_id;
  return jsonb_build_object('status', 'applied');
end;
$$;

create or replace function public.admin_unit_ordering_board(p_version uuid, p_unit uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order jsonb;
begin
  perform public.require_admin();
  v_order := public.get_version_topic_order(p_version);
  return jsonb_build_object(
    'topics', coalesce((
      select jsonb_agg(to_jsonb(x) order by coalesce(x.recommended_rank, x.official_sort), x.official_sort, x.topic_name)
      from (
        select m.id as map_id, m.canonical_topic_id, m.sort_order as official_sort,
               ct.name as topic_name, ct.difficulty_level,
               (
                 select (e->>'recommended_rank')::int
                 from jsonb_array_elements(v_order) e
                 where (e->>'canonical_topic_id')::uuid = m.canonical_topic_id
                 limit 1
               ) as recommended_rank
        from public.exam_topic_map m
        join public.canonical_topics ct on ct.id = m.canonical_topic_id
        where m.curriculum_version_id = p_version and m.included
          and (p_unit is null or m.unit_id = p_unit or ct.canonical_unit_id = (
            select canonical_unit_id from public.unit_catalog where id = p_unit
          ))
      ) x
    ), '[]'::jsonb),
    'dependencies', coalesce((
      select jsonb_agg(to_jsonb(d))
      from public.canonical_topic_dependencies d
      where d.status = 'active'
        and (
          d.topic_id in (select canonical_topic_id from public.exam_topic_map where curriculum_version_id = p_version)
          or d.depends_on_topic_id in (select canonical_topic_id from public.exam_topic_map where curriculum_version_id = p_version)
        )
    ), '[]'::jsonb),
    'suggestions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc)
      from public.curriculum_ordering_suggestions s
      where s.curriculum_version_id = p_version and s.status = 'pending'
    ), '[]'::jsonb),
    'has_frequency', exists (
      select 1 from public.exam_topic_map m
      where m.curriculum_version_id = p_version and m.exam_weight is not null
    )
  );
end;
$$;

create or replace function public.get_recommended_curriculum(p_exam_id uuid, p_mode text default 'recommended')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_version uuid;
  v_order jsonb;
  v_mode text := coalesce(nullif(p_mode, ''), 'recommended');
  v_has_freq boolean := false;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select id into v_version from public.get_active_curriculum_version(p_exam_id);
  if v_version is null then
    return jsonb_build_object('topics', '[]'::jsonb, 'mode', v_mode, 'fallback', 'empty_curriculum');
  end if;

  begin
    v_order := public.get_version_topic_order(v_version);
  exception when others then
    v_order := '[]'::jsonb;
  end;

  select exists (
    select 1 from public.exam_topic_map m
    where m.curriculum_version_id = v_version and m.exam_weight is not null
  ) into v_has_freq;

  if v_mode = 'frequency' and not v_has_freq then
    return jsonb_build_object('topics', '[]'::jsonb, 'mode', v_mode, 'frequency_ready', false);
  end if;

  return jsonb_build_object(
    'mode', v_mode,
    'frequency_ready', v_has_freq,
    'version_id', v_version,
    'topics', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.list_rank)
      from (
        select
          c.*,
          coalesce((
            select (e->>'recommended_rank')::int
            from jsonb_array_elements(v_order) e
            where (e->>'canonical_topic_id')::uuid = c.canonical_topic_id
          ), c.sort_order) as recommended_rank,
          p.completed as narration_completed,
          p.last_position_ms,
          m.mastery_score,
          m.next_review_at,
          exists (
            select 1 from public.user_review_queue r
            where r.user_id = v_user and r.lesson_id = c.lesson_id
              and r.status in ('scheduled', 'ready') and r.scheduled_at <= now()
          ) as review_due,
          (
            select ct.name
            from public.canonical_topic_dependencies d
            join public.canonical_topics ct on ct.id = d.depends_on_topic_id
            left join public.user_topic_mastery um
              on um.user_id = v_user and um.canonical_topic_id = d.depends_on_topic_id
            where d.topic_id = c.canonical_topic_id
              and d.status = 'active' and d.dependency_type = 'hard_prerequisite'
              and coalesce(um.lesson_completed, false) = false
            order by ct.name
            limit 1
          ) as prereq_title,
          case
            when v_mode = 'official' then c.sort_order
            when v_mode = 'frequency' then coalesce((
              select (-1000 * coalesce(em.exam_weight, 0))::int
              from public.exam_topic_map em
              where em.curriculum_version_id = v_version and em.canonical_topic_id = c.canonical_topic_id
            ), c.sort_order)
            when v_mode = 'weak' then
              case
                when coalesce(m.mastery_score, 0) < 0.6 then 0
                when exists (
                  select 1
                  from public.canonical_topic_dependencies d
                  left join public.user_topic_mastery umw
                    on umw.user_id = v_user and umw.canonical_topic_id = d.topic_id
                  where d.depends_on_topic_id = c.canonical_topic_id
                    and d.status = 'active'
                    and d.dependency_type = 'hard_prerequisite'
                    and coalesce(umw.mastery_score, 0) < 0.6
                ) then 0
                else 50
              end
              + coalesce((
                  select (e->>'recommended_rank')::int from jsonb_array_elements(v_order) e
                  where (e->>'canonical_topic_id')::uuid = c.canonical_topic_id
                ), c.sort_order)
            else coalesce((
              select (e->>'recommended_rank')::int from jsonb_array_elements(v_order) e
              where (e->>'canonical_topic_id')::uuid = c.canonical_topic_id
            ), c.sort_order)
          end as list_rank,
          case
            when exists (
              select 1 from public.user_review_queue r
              where r.user_id = v_user and r.lesson_id = c.lesson_id
                and r.status in ('scheduled', 'ready') and r.scheduled_at <= now()
            ) then 'review_due'
            when (
              select ct.name from public.canonical_topic_dependencies d
              join public.canonical_topics ct on ct.id = d.depends_on_topic_id
              left join public.user_topic_mastery um on um.user_id = v_user and um.canonical_topic_id = d.depends_on_topic_id
              where d.topic_id = c.canonical_topic_id and d.status = 'active' and d.dependency_type = 'hard_prerequisite'
                and coalesce(um.lesson_completed, false) = false
              limit 1
            ) is not null then 'prerequisite'
            when coalesce(p.last_position_ms, 0) > 2000 and coalesce(p.completed, false) = false then 'resume'
            when coalesce(m.mastery_score, 1) < 0.5 then 'weakness'
            else 'next_topic'
          end as reason_code
        from public.get_student_curriculum(p_exam_id) c
        left join public.memory_lesson_progress p
          on p.lesson_id = c.lesson_id and p.user_id = v_user
        left join public.user_topic_mastery m
          on m.canonical_topic_id = c.canonical_topic_id and m.user_id = v_user
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_lesson_prereq_warning(p_lesson uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_topic uuid;
  v_name text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select canonical_topic_id into v_topic from public.memory_lessons where id = p_lesson and status = 'published';
  if v_topic is null then return null; end if;
  select ct.name into v_name
  from public.canonical_topic_dependencies d
  join public.canonical_topics ct on ct.id = d.depends_on_topic_id
  left join public.user_topic_mastery um
    on um.user_id = v_user and um.canonical_topic_id = d.depends_on_topic_id
  where d.topic_id = v_topic
    and d.status = 'active'
    and d.dependency_type = 'hard_prerequisite'
    and coalesce(um.lesson_completed, false) = false
  order by ct.name
  limit 1;
  if v_name is null then return null; end if;
  return jsonb_build_object('prereq_title', v_name, 'lock', false);
end;
$$;

create or replace function public.get_today_study_recommendations(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_all jsonb;
begin
  v_all := public.get_recommended_curriculum(p_exam_id, 'recommended');
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(s.elem order by s.prio)
      from (
        select elem,
          case elem->>'reason_code'
            when 'review_due' then 0
            when 'resume' then 1
            when 'prerequisite' then 2
            when 'next_topic' then 3
            when 'weakness' then 4
            else 5
          end as prio
        from jsonb_array_elements(coalesce(v_all->'topics', '[]'::jsonb)) elem
        order by 2
        limit 5
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.topic_ordering_blocks_generation(p_topic uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.canonical_topic_dependencies d
    where d.status = 'needs_review'
      and d.dependency_type = 'hard_prerequisite'
      and (d.topic_id = p_topic or d.depends_on_topic_id = p_topic)
  );
$$;

create or replace function public.catalog_curriculum_hash(p_exam_id uuid)
returns text
language plpgsql
stable
as $$
declare
  v_payload text;
  v_deps text;
begin
  select string_agg(
    coalesce(s.code, '') || '/' || coalesce(u.code, '') || '/' || coalesce(t.code, '') || ':' || t.name || ':' || t.sort_order::text,
    e'\n' order by s.sort_order, u.sort_order, t.sort_order, t.name
  )
  into v_payload
  from public.subject_catalog s
  left join public.unit_catalog u on u.subject_id = s.id
  left join public.topic_catalog t on t.unit_id = u.id
  where s.exam_id = p_exam_id;

  select string_agg(d.topic_id::text || '>' || d.depends_on_topic_id::text || ':' || d.dependency_type, e'\n' order by d.topic_id, d.depends_on_topic_id)
  into v_deps
  from public.canonical_topic_dependencies d
  where d.status = 'active';

  return encode(extensions.digest(coalesce(v_payload, '') || E'\n' || coalesce(v_deps, ''), 'sha256'), 'hex');
end;
$$;

drop function if exists public.get_student_lesson_cards(uuid);

create or replace function public.get_student_lesson_cards(p_exam_id uuid, p_mode text default 'recommended')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.get_recommended_curriculum(p_exam_id, p_mode)->'topics';
end;
$$;

grant execute on function public.invalidate_curriculum_order_cache(uuid) to authenticated;
grant execute on function public.hard_dependency_would_cycle(uuid, uuid) to authenticated;
grant execute on function public.compute_version_topic_order(uuid) to authenticated;
grant execute on function public.get_version_topic_order(uuid) to authenticated;
grant execute on function public.admin_add_topic_dependency(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.admin_remove_topic_dependency(uuid) to authenticated;
grant execute on function public.admin_set_exam_topic_sort(uuid, int) to authenticated;
grant execute on function public.admin_apply_ordering_suggestion(uuid, boolean) to authenticated;
grant execute on function public.admin_unit_ordering_board(uuid, uuid) to authenticated;
grant execute on function public.get_recommended_curriculum(uuid, text) to authenticated;
grant execute on function public.get_lesson_prereq_warning(uuid) to authenticated;
grant execute on function public.get_today_study_recommendations(uuid) to authenticated;
grant execute on function public.topic_ordering_blocks_generation(uuid) to authenticated;
grant execute on function public.get_student_lesson_cards(uuid, text) to authenticated;

create or replace function public.trg_invalidate_order_cache()
returns trigger
language plpgsql
as $$
begin
  perform public.invalidate_curriculum_order_cache();
  return null;
end;
$$;

drop trigger if exists canonical_topic_dependencies_invalidate_cache on public.canonical_topic_dependencies;
create trigger canonical_topic_dependencies_invalidate_cache
  after insert or update or delete on public.canonical_topic_dependencies
  for each statement execute procedure public.trg_invalidate_order_cache();

drop trigger if exists exam_topic_map_invalidate_order_cache on public.exam_topic_map;
create trigger exam_topic_map_invalidate_order_cache
  after update of sort_order, included, exam_weight on public.exam_topic_map
  for each statement execute procedure public.trg_invalidate_order_cache();
