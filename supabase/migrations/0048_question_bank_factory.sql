-- Phase 2G: curriculum-linked question bank + sets + coverage. No auto-publish.

alter table public.content_factory_settings
  add column if not exists question_pool_target integer not null default 20;

alter table public.content_generation_jobs
  add column if not exists stage_pool_done boolean not null default false;

alter table public.questions
  alter column exam_id drop not null,
  alter column subject_id drop not null;

alter table public.questions
  add column if not exists canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  add column if not exists canonical_unit_id uuid references public.canonical_units(id) on delete set null,
  add column if not exists canonical_subject_id uuid references public.canonical_subjects(id) on delete set null,
  add column if not exists curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  add column if not exists memory_lesson_id uuid references public.memory_lessons(id) on delete set null,
  add column if not exists learning_objective_id uuid references public.canonical_topic_learning_objectives(id) on delete set null,
  add column if not exists segment_id uuid references public.canonical_topic_segments(id) on delete set null,
  add column if not exists exam_catalog_id uuid references public.exam_catalog(id) on delete set null,
  add column if not exists source_type text not null default 'manual',
  add column if not exists generation_model text,
  add column if not exists generated_at timestamptz,
  add column if not exists prompt_version text,
  add column if not exists question_status text not null default 'draft',
  add column if not exists question_strategy text,
  add column if not exists normalized_question_hash text,
  add column if not exists needs_image boolean not null default false,
  add column if not exists curriculum_question_set_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'questions_source_type_check') then
    alter table public.questions
      add constraint questions_source_type_check
      check (source_type in ('memory_lesson', 'curriculum_generated', 'manual', 'system_exam'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'questions_status_check') then
    alter table public.questions
      add constraint questions_status_check
      check (question_status in ('draft', 'generated', 'needs_review', 'approved', 'published', 'archived'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'questions_strategy_check') then
    alter table public.questions
      add constraint questions_strategy_check
      check (question_strategy is null or question_strategy in (
        'direct_recall', 'visual_recall', 'contrast_recall', 'sequence_recall',
        'application', 'cause_effect', 'interpretation'
      ));
  end if;
end $$;

update public.questions
set question_status = case
  when archived_at is not null then 'archived'
  when is_published then 'published'
  else 'draft'
end
where question_status = 'draft' and (is_published or archived_at is not null);

create table if not exists public.curriculum_question_sets (
  id uuid primary key default gen_random_uuid(),
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete restrict,
  curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  memory_lesson_id uuid references public.memory_lessons(id) on delete set null,
  exam_catalog_id uuid references public.exam_catalog(id) on delete set null,
  set_type text not null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint curriculum_question_sets_type_check
    check (set_type in (
      'lesson_checkpoint', 'lesson_final', 'topic_pool', 'exam_specific',
      'review_1d', 'review_3d', 'review_7d'
    ))
);

create unique index if not exists curriculum_question_sets_scope_uidx
  on public.curriculum_question_sets (
    canonical_topic_id,
    set_type,
    coalesce(curriculum_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(exam_catalog_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(memory_lesson_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.questions
  add column if not exists curriculum_question_set_id uuid references public.curriculum_question_sets(id) on delete set null;

create table if not exists public.objective_question_coverage (
  id uuid primary key default gen_random_uuid(),
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete cascade,
  learning_objective_id uuid not null references public.canonical_topic_learning_objectives(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (question_id, learning_objective_id)
);

create index if not exists questions_canonical_topic_idx on public.questions (canonical_topic_id, question_status);
create index if not exists questions_set_idx on public.questions (curriculum_question_set_id);
create unique index if not exists questions_topic_norm_hash_uidx
  on public.questions (canonical_topic_id, normalized_question_hash)
  where canonical_topic_id is not null and normalized_question_hash is not null;

create or replace function public.questions_fingerprint_tg()
returns trigger
language plpgsql
as $$
begin
  new.question_fingerprint := public.compute_question_fingerprint(new.stem, new.choices, new.correct_choice);
  if new.semantic_key is null then
    new.semantic_key := public.normalize_question_text(new.stem);
  end if;
  new.normalized_question_hash := encode(extensions.digest(public.normalize_question_text(new.stem), 'sha256'), 'hex');
  if new.question_status = 'published' then
    new.is_published := true;
  elsif new.question_status in ('archived', 'draft', 'generated', 'needs_review', 'approved') then
    new.is_published := false;
  end if;
  if new.archived_at is not null then
    new.question_status := 'archived';
    new.is_published := false;
  end if;
  return new;
end;
$$;

drop trigger if exists questions_fingerprint on public.questions;
create trigger questions_fingerprint
  before insert or update of stem, choices, correct_choice, question_status, archived_at
  on public.questions
  for each row execute procedure public.questions_fingerprint_tg();

drop trigger if exists curriculum_question_sets_set_updated_at on public.curriculum_question_sets;
create trigger curriculum_question_sets_set_updated_at
  before update on public.curriculum_question_sets
  for each row execute procedure public.set_updated_at();

alter table public.curriculum_question_sets enable row level security;
alter table public.objective_question_coverage enable row level security;

drop policy if exists curriculum_question_sets_select on public.curriculum_question_sets;
create policy curriculum_question_sets_select on public.curriculum_question_sets
  for select to authenticated using (true);
drop policy if exists curriculum_question_sets_admin on public.curriculum_question_sets;
create policy curriculum_question_sets_admin on public.curriculum_question_sets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists objective_question_coverage_select on public.objective_question_coverage;
create policy objective_question_coverage_select on public.objective_question_coverage
  for select to authenticated using (public.is_admin());
drop policy if exists objective_question_coverage_admin on public.objective_question_coverage;
create policy objective_question_coverage_admin on public.objective_question_coverage
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists questions_read_published on public.questions;
create policy questions_read_published on public.questions
  for select to authenticated
  using (
    (is_published = true and question_status = 'published')
    or public.is_admin()
  );

grant select, insert, update, delete on public.curriculum_question_sets to authenticated;
grant select, insert, update, delete on public.objective_question_coverage to authenticated;

create or replace function public.ensure_curriculum_question_set(
  p_canonical_topic_id uuid,
  p_set_type text,
  p_curriculum_version_id uuid default null,
  p_exam_catalog_id uuid default null,
  p_memory_lesson_id uuid default null,
  p_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is not null then
    perform public.require_admin();
  end if;
  select id into v_id
  from public.curriculum_question_sets
  where canonical_topic_id = p_canonical_topic_id
    and set_type = p_set_type
    and curriculum_version_id is not distinct from p_curriculum_version_id
    and exam_catalog_id is not distinct from p_exam_catalog_id
    and memory_lesson_id is not distinct from p_memory_lesson_id
  limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.curriculum_question_sets (
    canonical_topic_id, set_type, curriculum_version_id, exam_catalog_id, memory_lesson_id, title
  ) values (
    p_canonical_topic_id, p_set_type, p_curriculum_version_id, p_exam_catalog_id, p_memory_lesson_id, p_title
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_topic_question_summary(p_canonical_topic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lesson text := 'empty';
begin
  perform public.require_admin();
  select case
    when exists (select 1 from public.memory_lessons where canonical_topic_id = p_canonical_topic_id and status = 'published') then 'published'
    when exists (select 1 from public.memory_lessons where canonical_topic_id = p_canonical_topic_id and status = 'pending_validation') then 'pending_validation'
    when exists (select 1 from public.memory_lessons where canonical_topic_id = p_canonical_topic_id) then 'draft'
    else 'empty'
  end into v_lesson;
  return jsonb_build_object(
    'canonical_topic_id', p_canonical_topic_id,
    'lesson', v_lesson,
    'total', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and question_status <> 'archived'),
    'easy', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and difficulty = 'easy' and question_status <> 'archived'),
    'medium', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and difficulty = 'medium' and question_status <> 'archived'),
    'hard', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and difficulty = 'hard' and question_status <> 'archived'),
    'approved', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and question_status = 'approved'),
    'needs_review', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and question_status = 'needs_review'),
    'generated', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and question_status = 'generated'),
    'published', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and question_status = 'published'),
    'final_count', (
      select count(*) from public.questions q
      join public.curriculum_question_sets s on s.id = q.curriculum_question_set_id
      where q.canonical_topic_id = p_canonical_topic_id and s.set_type = 'lesson_final' and q.question_status <> 'archived'
    ),
    'checkpoint_count', (
      select count(*) from public.questions q
      join public.curriculum_question_sets s on s.id = q.curriculum_question_set_id
      where q.canonical_topic_id = p_canonical_topic_id and s.set_type = 'lesson_checkpoint' and q.question_status <> 'archived'
    ),
    'pool_count', (
      select count(*) from public.questions q
      join public.curriculum_question_sets s on s.id = q.curriculum_question_set_id
      where q.canonical_topic_id = p_canonical_topic_id and s.set_type = 'topic_pool' and q.question_status <> 'archived'
    ),
    'pool_target', (select question_pool_target from public.content_factory_settings where id = 1),
    'objectives', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', lo.id,
        'title', lo.title,
        'count', (select count(*) from public.objective_question_coverage c where c.learning_objective_id = lo.id)
      ) order by lo.objective_order)
      from public.canonical_topic_learning_objectives lo
      where lo.canonical_topic_id = p_canonical_topic_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_list_topic_questions(p_canonical_topic_id uuid, p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x))
    from (
      select q.id, q.stem, q.choices, q.correct_choice, q.explanation, q.difficulty, q.question_strategy,
             q.question_status, q.source_type, q.image_url, q.learning_objective_id, q.curriculum_question_set_id,
             s.set_type, q.created_at, q.is_published
      from public.questions q
      left join public.curriculum_question_sets s on s.id = q.curriculum_question_set_id
      where q.canonical_topic_id = p_canonical_topic_id
        and (p_status is null or q.question_status = p_status)
      order by q.created_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_question_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if p_status not in ('draft', 'generated', 'needs_review', 'approved', 'published', 'archived') then
    raise exception 'INVALID_INPUT';
  end if;
  update public.questions
  set question_status = p_status,
      archived_at = case when p_status = 'archived' then now() else null end
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', p_status);
end;
$$;

create or replace function public.get_curriculum_practice_questions(
  p_exam_catalog_id uuid,
  p_canonical_topic_id uuid default null,
  p_set_type text default 'topic_pool',
  p_limit int default 10,
  p_memory_lesson_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_version uuid;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select id into v_version from public.get_active_curriculum_version(p_exam_catalog_id);
  if v_version is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x))
    from (
      select q.id, q.stem, q.choices, q.correct_choice, q.explanation, q.difficulty, q.image_url,
             q.canonical_topic_id, ct.name as topic_name, q.learning_objective_id,
             lo.title as objective_title, q.question_strategy
      from public.questions q
      join public.exam_topic_map m
        on m.canonical_topic_id = q.canonical_topic_id
       and m.curriculum_version_id = v_version
       and m.included = true
      join public.canonical_topics ct on ct.id = q.canonical_topic_id
      left join public.canonical_topic_learning_objectives lo on lo.id = q.learning_objective_id
      left join public.curriculum_question_sets s on s.id = q.curriculum_question_set_id
      where q.question_status = 'published'
        and q.is_published = true
        and (p_canonical_topic_id is null or q.canonical_topic_id = p_canonical_topic_id)
        and (p_set_type is null or p_set_type = 'mixed' or s.set_type = p_set_type)
        and (p_memory_lesson_id is null or q.memory_lesson_id = p_memory_lesson_id)
      order by random()
      limit least(coalesce(p_limit, 10), 40)
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.ensure_curriculum_question_set(uuid, text, uuid, uuid, uuid, text) from public;
revoke all on function public.admin_topic_question_summary(uuid) from public;
revoke all on function public.admin_list_topic_questions(uuid, text) from public;
revoke all on function public.admin_set_question_status(uuid, text) from public;
revoke all on function public.get_curriculum_practice_questions(uuid, uuid, text, int, uuid) from public;

grant execute on function public.ensure_curriculum_question_set(uuid, text, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.admin_topic_question_summary(uuid) to authenticated;
grant execute on function public.admin_list_topic_questions(uuid, text) to authenticated;
grant execute on function public.admin_set_question_status(uuid, text) to authenticated;
grant execute on function public.get_curriculum_practice_questions(uuid, uuid, text, int, uuid) to authenticated;

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
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.admin_factory_set_pool_target(p_target integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  if p_target is null or p_target < 0 or p_target > 40 then
    raise exception 'INVALID_INPUT';
  end if;
  update public.content_factory_settings
  set question_pool_target = p_target
  where id = 1;
  return public.admin_factory_get_settings();
end;
$$;

revoke all on function public.admin_factory_set_pool_target(integer) from public;
grant execute on function public.admin_factory_set_pool_target(integer) to authenticated;
