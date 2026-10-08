-- Phase 2D: memory pedagogy fields, scoring, approval gate. No content rewrite.

alter table public.memory_lessons
  add column if not exists primary_memory_technique text,
  add column if not exists memory_techniques jsonb not null default '[]'::jsonb,
  add column if not exists pedagogy_version text,
  add column if not exists pedagogy_score integer,
  add column if not exists core_facts jsonb not null default '[]'::jsonb,
  add column if not exists memory_journey_title text,
  add column if not exists memory_journey_summary text,
  add column if not exists pedagogy_issues jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_lessons_primary_technique_check') then
    alter table public.memory_lessons
      add constraint memory_lessons_primary_technique_check
      check (
        primary_memory_technique is null
        or primary_memory_technique in (
          'visual_association', 'story_chain', 'method_of_loci', 'acronym', 'chunking',
          'contrast_pair', 'timeline', 'absurd_imagery', 'analogy', 'pattern_recognition',
          'cause_effect_chain'
        )
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'memory_lessons_pedagogy_score_check') then
    alter table public.memory_lessons
      add constraint memory_lessons_pedagogy_score_check
      check (pedagogy_score is null or (pedagogy_score >= 0 and pedagogy_score <= 100));
  end if;
end $$;

alter table public.memory_lesson_scenes
  add column if not exists memory_technique text,
  add column if not exists memory_target text,
  add column if not exists visual_anchor text,
  add column if not exists recall_prompt text,
  add column if not exists reinforcement_note text,
  add column if not exists journey_step text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_lesson_scenes_technique_check') then
    alter table public.memory_lesson_scenes
      add constraint memory_lesson_scenes_technique_check
      check (
        memory_technique is null
        or memory_technique in (
          'visual_association', 'story_chain', 'method_of_loci', 'acronym', 'chunking',
          'contrast_pair', 'timeline', 'absurd_imagery', 'analogy', 'pattern_recognition',
          'cause_effect_chain'
        )
      );
  end if;
end $$;

alter table public.memory_lesson_questions
  add column if not exists question_strategy text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_lesson_questions_strategy_check') then
    alter table public.memory_lesson_questions
      add constraint memory_lesson_questions_strategy_check
      check (
        question_strategy is null
        or question_strategy in (
          'direct_recall', 'visual_recall', 'contrast_recall', 'sequence_recall', 'application'
        )
      );
  end if;
end $$;

create table if not exists public.memory_lesson_review_anchors (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  scene_id uuid references public.memory_lesson_scenes(id) on delete set null,
  code text not null,
  memory_target text not null,
  visual_anchor text not null,
  recall_prompt text,
  memory_technique text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (lesson_id, code)
);

create index if not exists memory_lesson_review_anchors_lesson_idx
  on public.memory_lesson_review_anchors (lesson_id, sort_order);

alter table public.memory_lesson_review_anchors enable row level security;

drop policy if exists memory_lesson_review_anchors_select on public.memory_lesson_review_anchors;
create policy memory_lesson_review_anchors_select on public.memory_lesson_review_anchors
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.memory_lessons l
      where l.id = lesson_id and l.status = 'published'
    )
  );

drop policy if exists memory_lesson_review_anchors_admin on public.memory_lesson_review_anchors;
create policy memory_lesson_review_anchors_admin on public.memory_lesson_review_anchors
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.memory_lesson_review_anchors to authenticated;

create or replace function public.memory_lesson_pedagogy_report(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lesson public.memory_lessons;
  v_scenes int := 0;
  v_anchored int := 0;
  v_facts int := 0;
  v_facts_hooked int := 0;
  v_checkpoints int := 0;
  v_finals int := 0;
  v_strategies int := 0;
  v_tech int := 0;
  v_score int := 0;
  v_tech_pts int := 0;
  v_anchor_pts int := 0;
  v_retr_pts int := 0;
  v_chunk_pts int := 0;
  v_final_pts int := 0;
  v_issues jsonb := '[]'::jsonb;
  v_blocking boolean := false;
begin
  select * into v_lesson from public.memory_lessons where id = p_id;
  if v_lesson.id is null then
    return jsonb_build_object('ok', false, 'score', 0, 'blocking', true, 'issues', jsonb_build_array('Ders bulunamadı.'));
  end if;

  select count(*) into v_scenes from public.memory_lesson_scenes where lesson_id = p_id;
  select count(*) into v_anchored
  from public.memory_lesson_scenes
  where lesson_id = p_id and nullif(trim(visual_anchor), '') is not null;
  v_facts := coalesce(jsonb_array_length(v_lesson.core_facts), 0);
  select count(*) into v_facts_hooked
  from jsonb_array_elements(coalesce(v_lesson.core_facts, '[]'::jsonb)) f
  where nullif(trim(coalesce(f->>'visual_anchor', f->>'memory_hook', '')), '') is not null
     or nullif(trim(coalesce(f->>'exception', '')), '') is not null;
  select count(*) into v_checkpoints
  from public.memory_lesson_questions
  where lesson_id = p_id and question_type = 'checkpoint';
  select count(*) into v_finals
  from public.memory_lesson_questions
  where lesson_id = p_id and question_type = 'final';
  select count(distinct question_strategy) into v_strategies
  from public.memory_lesson_questions
  where lesson_id = p_id and question_type = 'final' and question_strategy is not null;
  v_tech := coalesce(jsonb_array_length(v_lesson.memory_techniques), 0)
    + case when v_lesson.primary_memory_technique is not null then 1 else 0 end;

  if v_lesson.primary_memory_technique is null and v_tech = 0 then
    v_issues := v_issues || jsonb_build_array('En az bir hafıza tekniği gerekli.');
  end if;
  if v_facts < 5 then
    v_issues := v_issues || jsonb_build_array('5–12 çekirdek olgu tanımlanmalı.');
  end if;
  if v_facts > 0 and v_facts_hooked < v_facts then
    v_issues := v_issues || jsonb_build_array('Her çekirdek olgunun hafıza kancası veya gerekçeli istisnası olmalı.');
  end if;
  if coalesce(v_lesson.duration_sec, 0) > 300 and v_checkpoints < 2 then
    v_issues := v_issues || jsonb_build_array('5 dakikayı aşan derslerde en az 2 hatırlatma kontrolü gerekli.');
  end if;
  if v_checkpoints < 2 and coalesce(v_lesson.duration_sec, 0) <= 300 and v_checkpoints < 1 then
    v_issues := v_issues || jsonb_build_array('En az bir hatırlatma kontrolü gerekli.');
  end if;
  if v_finals < 10 then
    v_issues := v_issues || jsonb_build_array('Final testinde 10 soru olmalı.');
  end if;
  if v_scenes > 0 and v_anchored < greatest(v_scenes - 1, 1) then
    v_issues := v_issues || jsonb_build_array('Sahnelerin görsel çıpaları eksik.');
  end if;
  if v_finals >= 10 and v_strategies < 3 then
    v_issues := v_issues || jsonb_build_array('Final soruları yalnızca tanım olmamalı; görsel, karşılaştırma, sıra ve uygulama karışımı gerekli.');
  end if;

  if v_lesson.primary_memory_technique is not null and coalesce(jsonb_array_length(v_lesson.memory_techniques), 0) >= 1 then
    v_tech_pts := 20;
  elsif v_lesson.primary_memory_technique is not null or coalesce(jsonb_array_length(v_lesson.memory_techniques), 0) >= 1 then
    v_tech_pts := 10;
  end if;
  v_anchor_pts := round(20.0 * v_anchored / greatest(v_scenes, 1));
  if v_checkpoints >= 2 then
    v_retr_pts := 20;
  elsif v_checkpoints = 1 then
    v_retr_pts := 10;
  end if;
  if v_facts between 5 and 12 and v_scenes >= 4 then
    v_chunk_pts := 20;
  elsif v_facts >= 3 and v_scenes >= 4 then
    v_chunk_pts := 10;
  end if;
  if v_finals >= 10 and v_strategies >= 3 then
    v_final_pts := 20;
  elsif v_finals >= 10 then
    v_final_pts := 10;
  end if;

  v_score := least(100, v_tech_pts + v_anchor_pts + v_retr_pts + v_chunk_pts + v_final_pts);
  v_blocking := jsonb_array_length(v_issues) > 0 or v_score < 75;

  return jsonb_build_object(
    'ok', not v_blocking,
    'score', v_score,
    'blocking', v_blocking,
    'issues', v_issues,
    'parts', jsonb_build_object(
      'techniques', v_tech_pts,
      'anchors', v_anchor_pts,
      'retrieval', v_retr_pts,
      'chunking', v_chunk_pts,
      'final', v_final_pts
    )
  );
end;
$$;

create or replace function public.refresh_memory_lesson_pedagogy(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report jsonb;
  v_scene record;
  v_n int := 0;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'ADMIN_ONLY';
  end if;
  v_report := public.memory_lesson_pedagogy_report(p_id);

  delete from public.memory_lesson_review_anchors where lesson_id = p_id;
  for v_scene in
    select id, visual_anchor, memory_target, recall_prompt, memory_technique, scene_order
    from public.memory_lesson_scenes
    where lesson_id = p_id
      and nullif(trim(visual_anchor), '') is not null
    order by scene_order
  loop
    v_n := v_n + 1;
    insert into public.memory_lesson_review_anchors (
      lesson_id, scene_id, code, memory_target, visual_anchor, recall_prompt, memory_technique, sort_order
    )
    values (
      p_id,
      v_scene.id,
      'anchor-' || lpad(v_n::text, 3, '0'),
      coalesce(nullif(trim(v_scene.memory_target), ''), 'olgu'),
      trim(v_scene.visual_anchor),
      v_scene.recall_prompt,
      v_scene.memory_technique,
      v_n
    );
  end loop;

  update public.memory_lessons
  set
    pedagogy_score = (v_report->>'score')::int,
    pedagogy_issues = coalesce(v_report->'issues', '[]'::jsonb)
  where id = p_id;

  return v_report;
end;
$$;

create or replace function public.admin_approve_memory_lesson(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_report jsonb;
begin
  perform public.require_admin();
  select status into v_status from public.memory_lessons where id = p_id;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'pending_validation' then raise exception 'NOT_READY'; end if;

  v_report := public.refresh_memory_lesson_pedagogy(p_id);
  if coalesce((v_report->>'blocking')::boolean, true) then
    raise exception 'PEDAGOGY_INCOMPLETE';
  end if;

  update public.memory_lessons
  set status = 'approved', generation_error = null, updated_at = now()
  where id = p_id;
  perform public.write_admin_audit('memory_lesson_approve', 'memory_lesson', p_id::text, v_report);
  return jsonb_build_object('id', p_id, 'status', 'approved', 'pedagogy', v_report);
end;
$$;

revoke all on function public.memory_lesson_pedagogy_report(uuid) from public;
revoke all on function public.refresh_memory_lesson_pedagogy(uuid) from public;
revoke all on function public.admin_approve_memory_lesson(uuid) from public;
grant execute on function public.memory_lesson_pedagogy_report(uuid) to authenticated;
grant execute on function public.refresh_memory_lesson_pedagogy(uuid) to authenticated;
grant execute on function public.admin_approve_memory_lesson(uuid) to authenticated;
