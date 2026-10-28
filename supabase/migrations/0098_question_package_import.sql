-- Question package import + bank CMS support. Additive.

alter table public.questions
  add column if not exists import_batch_id uuid,
  add column if not exists package_name text,
  add column if not exists package_version text,
  add column if not exists import_dedupe_hash text;

alter table public.questions drop constraint if exists questions_source_type_check;
alter table public.questions
  add constraint questions_source_type_check
  check (source_type in ('memory_lesson', 'curriculum_generated', 'manual', 'system_exam', 'package_import', 'admin'));

alter table public.curriculum_question_sets drop constraint if exists curriculum_question_sets_type_check;
alter table public.curriculum_question_sets
  add constraint curriculum_question_sets_type_check
  check (set_type in (
    'lesson_checkpoint', 'lesson_final', 'topic_pool', 'exam_specific',
    'review_1d', 'review_3d', 'review_7d',
    'package_review', 'test_center', 'system_exam'
  ));

alter table public.subject_catalog add column if not exists created_by_import boolean not null default false;
alter table public.unit_catalog add column if not exists created_by_import boolean not null default false;
alter table public.topic_catalog add column if not exists created_by_import boolean not null default false;
alter table public.canonical_subjects add column if not exists created_by_import boolean not null default false;
alter table public.canonical_units add column if not exists created_by_import boolean not null default false;
alter table public.canonical_topics add column if not exists created_by_import boolean not null default false;

create table if not exists public.question_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  package_name text,
  package_version text,
  created_by uuid references public.profiles(id) on delete set null,
  total_rows int not null default 0,
  inserted_count int not null default 0,
  duplicate_count int not null default 0,
  invalid_count int not null default 0,
  mapping_count int not null default 0,
  created_topics int not null default 0,
  reused_topics int not null default 0,
  status text not null default 'applied',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.question_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.question_import_batches(id) on delete cascade,
  row_index int not null default 0,
  outcome text not null,
  detail text,
  question_id uuid references public.questions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.question_exam_map (
  question_id uuid not null references public.questions(id) on delete cascade,
  exam_catalog_id uuid not null references public.exam_catalog(id) on delete cascade,
  primary key (question_id, exam_catalog_id)
);

create unique index if not exists questions_import_dedupe_uidx
  on public.questions (canonical_topic_id, import_dedupe_hash)
  where canonical_topic_id is not null and import_dedupe_hash is not null;

alter table public.questions
  drop constraint if exists questions_import_batch_fk;
alter table public.questions
  add constraint questions_import_batch_fk
  foreign key (import_batch_id) references public.question_import_batches(id) on delete set null;

alter table public.question_import_batches enable row level security;
alter table public.question_import_items enable row level security;
alter table public.question_exam_map enable row level security;

drop policy if exists question_import_batches_staff on public.question_import_batches;
create policy question_import_batches_staff on public.question_import_batches
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists question_import_items_staff on public.question_import_items;
create policy question_import_items_staff on public.question_import_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists question_exam_map_read on public.question_exam_map;
create policy question_exam_map_read on public.question_exam_map
  for select to authenticated using (true);
drop policy if exists question_exam_map_staff on public.question_exam_map;
create policy question_exam_map_staff on public.question_exam_map
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.question_import_batches to authenticated;
grant select, insert, update, delete on public.question_import_items to authenticated;
grant select, insert, update, delete on public.question_exam_map to authenticated;

create or replace function public.norm_exam_code(p_value text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(
    translate(trim(coalesce(p_value, '')),
      E'çğıöşüâîûÇĞİÖŞÜÂÎÛı \t-',
      'CGIOSUAICGIOSUAI_I__'),
    '[^A-Z0-9_]', '', 'g'
  ));
$$;

create or replace function public.admin_question_topic_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_object_agg(canonical_topic_id::text, total)
    from (
      select canonical_topic_id, count(*)::int as total
      from public.questions
      where canonical_topic_id is not null and question_status <> 'archived'
      group by canonical_topic_id
    ) s
  ), '{}'::jsonb);
end;
$$;

create or replace function public.admin_question_bank_tree()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(exam_row order by exam_row.sort_order, exam_row.name)
    from (
      select
        e.id, e.code, e.name, e.sort_order, e.is_active,
        coalesce((
          select jsonb_agg(subj_row order by subj_row.sort_order, subj_row.name)
          from (
            select
              s.id, s.name, s.code, s.sort_order, s.created_by_import,
              coalesce((
                select jsonb_agg(unit_row order by unit_row.sort_order, unit_row.name)
                from (
                  select
                    u.id, u.name, u.sort_order, u.created_by_import,
                    coalesce((
                      select jsonb_agg(topic_row order by topic_row.sort_order, topic_row.name)
                      from (
                        select
                          t.id, t.name, t.sort_order, t.canonical_topic_id, t.created_by_import, t.content_status,
                          coalesce((
                            select count(*)::int from public.questions q
                            where q.canonical_topic_id = t.canonical_topic_id
                              and q.question_status <> 'archived'
                          ), 0) as question_count
                        from public.topic_catalog t
                        where t.unit_id = u.id
                      ) topic_row
                    ), '[]'::jsonb) as topics
                  from public.unit_catalog u
                  where u.subject_id = s.id
                ) unit_row
              ), '[]'::jsonb) as units
            from public.subject_catalog s
            where s.exam_id = e.id
          ) subj_row
        ), '[]'::jsonb) as subjects
      from public.exam_catalog e
    ) exam_row
  ), '[]'::jsonb);
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
      select q.id, q.stem, q.choices, q.correct_choice, q.explanation, q.difficulty,
             q.question_strategy, q.question_status, q.source_type, q.source, q.image_url,
             q.learning_objective_id, q.curriculum_question_set_id, s.set_type,
             q.created_at, q.updated_at, q.is_published, q.import_batch_id,
             q.package_name, q.package_version, q.exam_catalog_id,
             coalesce((
               select jsonb_agg(e.code)
               from public.question_exam_map m
               join public.exam_catalog e on e.id = m.exam_catalog_id
               where m.question_id = q.id
             ), '[]'::jsonb) as exam_codes
      from public.questions q
      left join public.curriculum_question_sets s on s.id = q.curriculum_question_set_id
      where q.canonical_topic_id = p_canonical_topic_id
        and (p_status is null or q.question_status = p_status)
      order by q.updated_at desc nulls last, q.created_at desc
      limit 400
    ) x
  ), '[]'::jsonb);
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
    'draft', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and question_status = 'draft'),
    'exam_codes', coalesce((
      select jsonb_agg(distinct e.code)
      from public.question_exam_map m
      join public.questions q on q.id = m.question_id
      join public.exam_catalog e on e.id = m.exam_catalog_id
      where q.canonical_topic_id = p_canonical_topic_id
    ), '[]'::jsonb),
    'final_count', 0,
    'checkpoint_count', 0,
    'pool_count', (select count(*) from public.questions where canonical_topic_id = p_canonical_topic_id and question_status <> 'archived'),
    'pool_target', 20,
    'objectives', '[]'::jsonb
  );
end;
$$;

create or replace function public.admin_import_ensure_topic(
  p_exam uuid,
  p_subject text,
  p_theme text,
  p_topic text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject uuid;
  v_unit uuid;
  v_topic uuid;
  v_canon_subject uuid;
  v_canon_unit uuid;
  v_canon uuid;
  v_created boolean := false;
  v_subject_name text := public.norm_ws(p_subject);
  v_theme text := coalesce(nullif(public.norm_ws(p_theme), ''), v_subject_name);
  v_topic_name text := public.norm_ws(p_topic);
  v_slug text := coalesce(nullif(p_slug, ''), public.catalog_slug_from_name(v_topic_name));
begin
  if v_subject_name is null or v_topic_name is null then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select id into v_canon_subject from public.canonical_subjects
  where lower(name) = lower(v_subject_name) or slug = public.catalog_slug_from_name(v_subject_name)
  limit 1;
  if v_canon_subject is null then
    insert into public.canonical_subjects (name, slug, created_by_import)
    values (v_subject_name, public.catalog_slug_from_name(v_subject_name), true)
    returning id into v_canon_subject;
  end if;

  select id into v_canon_unit from public.canonical_units
  where canonical_subject_id = v_canon_subject and (lower(name) = lower(v_theme) or slug = public.catalog_slug_from_name(v_theme))
  limit 1;
  if v_canon_unit is null then
    insert into public.canonical_units (canonical_subject_id, name, slug, created_by_import)
    values (v_canon_subject, v_theme, public.catalog_slug_from_name(v_theme), true)
    returning id into v_canon_unit;
  end if;

  select id into v_canon from public.canonical_topics
  where canonical_unit_id = v_canon_unit and (lower(name) = lower(v_topic_name) or slug = v_slug)
  limit 1;
  if v_canon is null then
    insert into public.canonical_topics (canonical_unit_id, name, slug, created_by_import)
    values (v_canon_unit, v_topic_name, v_slug, true)
    returning id into v_canon;
    v_created := true;
  end if;

  select id into v_subject from public.subject_catalog
  where exam_id = p_exam and lower(name) = lower(v_subject_name)
  limit 1;
  if v_subject is null then
    insert into public.subject_catalog (exam_id, name, code, created_by_import)
    values (p_exam, v_subject_name, coalesce(public.catalog_code_from_name(v_subject_name), 'DERS'), true)
    returning id into v_subject;
  end if;

  select id into v_unit from public.unit_catalog
  where subject_id = v_subject and lower(name) = lower(v_theme)
  limit 1;
  if v_unit is null then
    insert into public.unit_catalog (subject_id, name, created_by_import)
    values (v_subject, v_theme, true)
    returning id into v_unit;
  end if;

  select id into v_topic from public.topic_catalog
  where unit_id = v_unit and (lower(name) = lower(v_topic_name) or code = v_slug)
  limit 1;
  if v_topic is null then
    insert into public.topic_catalog (unit_id, name, code, content_status, canonical_topic_id, created_by_import)
    values (v_unit, v_topic_name, v_slug, 'empty', v_canon, true)
    returning id into v_topic;
    v_created := true;
  else
    update public.topic_catalog
    set canonical_topic_id = coalesce(canonical_topic_id, v_canon)
    where id = v_topic;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'canonical_topic_id', v_canon,
    'topic_id', v_topic,
    'subject_id', v_subject,
    'unit_id', v_unit
  );
end;
$$;

create or replace function public.admin_import_question_package(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid;
  v_row jsonb;
  v_i int := 0;
  v_inserted int := 0;
  v_dup int := 0;
  v_invalid int := 0;
  v_map int := 0;
  v_new_topics int := 0;
  v_reuse int := 0;
  v_qid uuid;
  v_exam uuid;
  v_exams uuid[];
  v_code text;
  v_match int;
  v_topic jsonb;
    v_hash text;
  v_fp text;
  v_set uuid;
  v_set_type text;
  v_status text;
  v_created_topics uuid[] := '{}';
  v_reused_topics uuid[] := '{}';
begin
  perform public.require_admin();
  insert into public.question_import_batches (
    file_name, package_name, package_version, created_by, status
  ) values (
    coalesce(p_payload->>'file_name', 'paket'),
    p_payload->>'package_name',
    p_payload->>'package_version',
    auth.uid(),
    'applied'
  ) returning id into v_batch;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'rows', '[]'::jsonb))
  loop
    v_i := v_i + 1;
    if coalesce(v_row->>'invalid_reason', '') <> '' then
      v_invalid := v_invalid + 1;
      insert into public.question_import_items (batch_id, row_index, outcome, detail, payload)
      values (v_batch, v_i, 'invalid', v_row->>'invalid_reason', v_row);
      continue;
    end if;

    v_exams := '{}';
    for v_code in select jsonb_array_elements_text(coalesce(v_row->'exam_codes', '[]'::jsonb))
    loop
      select count(*) into v_match
      from public.exam_catalog
      where public.norm_exam_code(code) = public.norm_exam_code(v_code)
         or public.norm_exam_code(name) = public.norm_exam_code(v_code);
      if v_match <> 1 then
        v_exams := '{}';
        exit;
      end if;
      select id into v_exam
      from public.exam_catalog
      where public.norm_exam_code(code) = public.norm_exam_code(v_code)
         or public.norm_exam_code(name) = public.norm_exam_code(v_code)
      limit 1;
      v_exams := array_append(v_exams, v_exam);
    end loop;

    if coalesce(array_length(v_exams, 1), 0) = 0 then
      v_map := v_map + 1;
      insert into public.question_import_items (batch_id, row_index, outcome, detail, payload)
      values (v_batch, v_i, 'needs_mapping', 'Sınav eşlemesi belirsiz', v_row);
      continue;
    end if;

    v_exam := v_exams[1];
    v_topic := public.admin_import_ensure_topic(
      v_exam,
      v_row->>'subject',
      v_row->>'main_theme',
      coalesce(nullif(v_row->>'topic', ''), v_row->>'canonical_slug'),
      v_row->>'canonical_slug'
    );
    if coalesce(v_topic->>'ok', 'false') <> 'true' then
      v_invalid := v_invalid + 1;
      insert into public.question_import_items (batch_id, row_index, outcome, detail, payload)
      values (v_batch, v_i, 'invalid', 'Konu oluşturulamadı', v_row);
      continue;
    end if;
    if (v_topic->>'created')::boolean then
      if not ((v_topic->>'canonical_topic_id')::uuid = any (v_created_topics)) then
        v_created_topics := array_append(v_created_topics, (v_topic->>'canonical_topic_id')::uuid);
        v_new_topics := v_new_topics + 1;
      end if;
    elsif not ((v_topic->>'canonical_topic_id')::uuid = any (v_reused_topics)) then
      v_reused_topics := array_append(v_reused_topics, (v_topic->>'canonical_topic_id')::uuid);
      v_reuse := v_reuse + 1;
    end if;

    v_fp := public.compute_question_fingerprint(
      v_row->>'question_text',
      coalesce(v_row->'choices', '{}'::jsonb),
      v_row->>'correct_answer'
    );
    v_hash := v_fp || ':' || (v_topic->>'canonical_topic_id');

    if exists (
      select 1 from public.questions
      where canonical_topic_id = (v_topic->>'canonical_topic_id')::uuid
        and (import_dedupe_hash = v_hash or question_fingerprint = v_fp)
    ) then
      v_dup := v_dup + 1;
      insert into public.question_import_items (batch_id, row_index, outcome, detail, payload)
      values (v_batch, v_i, 'duplicate', 'Aynı soru atlandı', v_row);
      continue;
    end if;

    v_set_type := case
      when v_row->>'question_type' in (
        'lesson_checkpoint', 'lesson_final', 'topic_pool', 'package_review', 'test_center', 'system_exam', 'exam_specific'
      ) then v_row->>'question_type'
      else 'topic_pool'
    end;
    v_set := public.ensure_curriculum_question_set(
      (v_topic->>'canonical_topic_id')::uuid,
      v_set_type,
      null, v_exam, null, v_set_type
    );
    v_status := 'draft';
    if coalesce((p_payload->>'allow_published')::boolean, false)
       and lower(coalesce(v_row->>'status', 'draft')) = 'published' then
      v_status := 'draft';
    end if;

    insert into public.questions (
      exam_catalog_id, canonical_topic_id, stem, choices, correct_choice, explanation,
      difficulty, source, source_type, question_status, is_published,
      curriculum_question_set_id, import_batch_id, package_name, package_version, import_dedupe_hash
    ) values (
      v_exam,
      (v_topic->>'canonical_topic_id')::uuid,
      v_row->>'question_text',
      coalesce(v_row->'choices', '{}'::jsonb),
      v_row->>'correct_answer',
      nullif(v_row->>'explanation', ''),
      coalesce((v_row->>'difficulty')::public.difficulty, 'medium'),
      coalesce(nullif(v_row->>'source', ''), p_payload->>'package_name', 'paket'),
      'package_import',
      v_status,
      false,
      v_set,
      v_batch,
      p_payload->>'package_name',
      p_payload->>'package_version',
      v_hash
    ) returning id into v_qid;

    insert into public.question_exam_map (question_id, exam_catalog_id)
    select v_qid, unnest(v_exams)
    on conflict do nothing;

    v_inserted := v_inserted + 1;
    insert into public.question_import_items (batch_id, row_index, outcome, detail, question_id, payload)
    values (v_batch, v_i, 'inserted', null, v_qid, v_row);
  end loop;

  update public.question_import_batches
  set total_rows = v_i,
      inserted_count = v_inserted,
      duplicate_count = v_dup,
      invalid_count = v_invalid,
      mapping_count = v_map,
      created_topics = v_new_topics,
      reused_topics = v_reuse,
      summary = jsonb_build_object(
        'inserted', v_inserted,
        'duplicates', v_dup,
        'invalid', v_invalid,
        'needs_mapping', v_map,
        'new_topics', v_new_topics,
        'reused_topics', v_reuse
      )
  where id = v_batch;

  return jsonb_build_object(
    'batch_id', v_batch,
    'imported', v_inserted,
    'new_topics', v_new_topics,
    'reused_topics', v_reuse,
    'duplicates_skipped', v_dup,
    'invalid', v_invalid,
    'needs_mapping', v_map
  );
end;
$$;

create or replace function public.admin_save_bank_question(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_canon uuid := nullif(p_payload->>'canonical_topic_id', '')::uuid;
  v_exam uuid := nullif(p_payload->>'exam_catalog_id', '')::uuid;
  v_correct text := upper(coalesce(p_payload->>'correct_choice', 'A'));
  v_status text := coalesce(nullif(p_payload->>'question_status', ''), 'draft');
  v_code text;
begin
  perform public.require_admin();
  if v_canon is null or length(trim(coalesce(p_payload->>'stem', ''))) < 8 then
    raise exception 'INVALID_INPUT';
  end if;
  if v_status not in ('draft', 'needs_review', 'approved', 'published', 'archived') then
    v_status := 'draft';
  end if;
  if v_id is null then
    insert into public.questions (
      exam_catalog_id, canonical_topic_id, stem, choices, correct_choice, explanation,
      difficulty, source, source_type, question_status, is_published
    ) values (
      v_exam, v_canon, trim(p_payload->>'stem'), coalesce(p_payload->'choices', '{}'::jsonb),
      v_correct, nullif(trim(p_payload->>'explanation'), ''),
      coalesce((p_payload->>'difficulty')::public.difficulty, 'medium'),
      coalesce(nullif(p_payload->>'source', ''), 'manuel'),
      'manual', v_status, v_status = 'published'
    ) returning id into v_id;
  else
    update public.questions
    set stem = trim(p_payload->>'stem'),
        choices = coalesce(p_payload->'choices', choices),
        correct_choice = v_correct,
        explanation = nullif(trim(p_payload->>'explanation'), ''),
        difficulty = coalesce((p_payload->>'difficulty')::public.difficulty, difficulty),
        question_status = v_status,
        source = coalesce(nullif(p_payload->>'source', ''), source),
        exam_catalog_id = coalesce(v_exam, exam_catalog_id),
        canonical_topic_id = v_canon,
        updated_at = now()
    where id = v_id;
  end if;
  delete from public.question_exam_map where question_id = v_id;
  for v_code in select jsonb_array_elements_text(coalesce(p_payload->'exam_ids', '[]'::jsonb))
  loop
    insert into public.question_exam_map (question_id, exam_catalog_id)
    values (v_id, v_code::uuid)
    on conflict do nothing;
  end loop;
  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.admin_save_bank_question(jsonb) to authenticated;
grant execute on function public.admin_question_topic_counts() to authenticated;
grant execute on function public.admin_question_bank_tree() to authenticated;
grant execute on function public.admin_list_topic_questions(uuid, text) to authenticated;
grant execute on function public.admin_topic_question_summary(uuid) to authenticated;
grant execute on function public.admin_import_ensure_topic(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_import_question_package(jsonb) to authenticated;
grant execute on function public.norm_exam_code(text) to authenticated;
