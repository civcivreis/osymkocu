-- CMS student path: admin lesson questions are the bank, completion is recorded without XP.

create table if not exists public.memory_question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.memory_lesson_questions(id) on delete cascade,
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  selected_choice text,
  is_correct boolean not null,
  time_spent_ms int,
  mode text not null default 'practice',
  created_at timestamptz not null default now()
);

create index if not exists memory_question_attempts_user_idx
  on public.memory_question_attempts (user_id, created_at desc);
create index if not exists memory_question_attempts_q_idx
  on public.memory_question_attempts (user_id, question_id);

alter table public.memory_question_attempts enable row level security;
drop policy if exists memory_question_attempts_own on public.memory_question_attempts;
create policy memory_question_attempts_own on public.memory_question_attempts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert on public.memory_question_attempts to authenticated;

create or replace function public.resolve_exam_catalog_id(p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_id is null then return null; end if;
  select id into v_id from public.exam_catalog where id = p_id;
  if v_id is not null then return v_id; end if;
  select c.id into v_id
  from public.exam_catalog c
  join public.exams e on e.id = p_id
  where lower(c.code) = lower(e.slug)
     or lower(c.name) = lower(e.name)
     or (e.kind = 'kpss_lisans' and lower(c.code) like 'kpss%')
     or (e.kind = 'kpss_onlisans' and lower(c.code) like 'kpss%')
     or (e.kind in ('tyt', 'tyt_ayt') and lower(c.code) = 'tyt')
     or (e.kind = 'ayt' and lower(c.code) = 'ayt')
  order by c.sort_order
  limit 1;
  return v_id;
end;
$$;

create or replace function public.cms_lesson_on_exam(p_lesson uuid, p_exam uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memory_lessons l
    where l.id = p_lesson
      and l.status = 'published'
      and (
        l.exam_id = p_exam
        or exists (
          select 1
          from public.memory_lesson_exam_map m
          join public.curriculum_versions v on v.id = m.curriculum_version_id
          where m.lesson_id = l.id
            and v.exam_id = p_exam
            and coalesce(m.is_active, true)
        )
      )
  );
$$;

create or replace function public.cms_mark_lesson_complete(p_user uuid, p_lesson uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson public.memory_lessons%rowtype;
begin
  select * into v_lesson from public.memory_lessons where id = p_lesson and status = 'published';
  if not found then return; end if;

  insert into public.memory_lesson_progress (user_id, lesson_id, narration_completed, completed, completed_at, completion_percent)
  values (p_user, p_lesson, true, true, now(), 100)
  on conflict (user_id, lesson_id) do update
    set narration_completed = true,
        completed = true,
        completed_at = coalesce(public.memory_lesson_progress.completed_at, now()),
        completion_percent = 100,
        updated_at = now();

  if v_lesson.canonical_topic_id is not null then
    insert into public.user_topic_mastery (user_id, canonical_topic_id, lesson_id, lesson_completed, last_studied_at)
    values (p_user, v_lesson.canonical_topic_id, p_lesson, true, now())
    on conflict (user_id, canonical_topic_id) do update
      set lesson_completed = true, lesson_id = excluded.lesson_id, last_studied_at = now();
    insert into public.user_review_queue (user_id, canonical_topic_id, lesson_id, review_type, scheduled_at, status)
    select p_user, v_lesson.canonical_topic_id, p_lesson, '1d', now(), 'ready'
    where not exists (
      select 1 from public.user_review_queue q
      where q.user_id = p_user and q.lesson_id = p_lesson and q.review_type in ('1d', 'general')
        and q.status in ('scheduled', 'ready')
    );
  end if;
end;
$$;

create or replace function public.submit_question_attempt(
  p_question_id uuid,
  p_selected_choice text,
  p_time_spent_ms int default null,
  p_mode text default 'practice'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_question public.questions%rowtype;
  v_mq public.memory_lesson_questions%rowtype;
  v_lesson public.memory_lessons%rowtype;
  v_correct boolean;
  v_choice text;
  v_mode text := case when p_mode in ('practice', 'review') then p_mode else 'practice' end;
  v_correct_choice text;
  v_explanation text;
  v_difficulty text := 'medium';
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  v_choice := upper(left(trim(p_selected_choice), 1));
  if v_choice not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'INVALID_CHOICE';
  end if;

  select * into v_question
  from public.questions
  where id = p_question_id and (is_published = true or question_status = 'published');

  if found then
    v_correct_choice := upper(left(trim(coalesce(v_question.correct_choice, '')), 1));
    v_correct := v_correct_choice = v_choice;
    v_explanation := coalesce(v_question.explanation, '');
    v_difficulty := coalesce(v_question.difficulty::text, 'medium');

    insert into public.question_attempts (user_id, question_id, selected_choice, is_correct, time_spent_ms, mode)
    values (v_user, p_question_id, v_choice, v_correct, p_time_spent_ms, v_mode);

    update public.user_stats
    set questions_solved = questions_solved + 1,
        questions_correct = questions_correct + case when v_correct then 1 else 0 end,
        updated_at = now()
    where user_id = v_user;

    begin
      if not v_correct and v_question.exam_id is not null and v_question.subject_id is not null then
        insert into public.wrong_answers (
          user_id, question_id, exam_id, subject_id, topic_id,
          user_answer, correct_answer, explanation, difficulty,
          next_review_at
        )
        values (
          v_user, p_question_id, v_question.exam_id, v_question.subject_id, v_question.topic_id,
          v_choice, v_question.correct_choice, v_question.explanation, v_question.difficulty,
          now() + interval '8 hours'
        )
        on conflict (user_id, question_id) do update
          set user_answer = excluded.user_answer,
              correct_answer = excluded.correct_answer,
              explanation = excluded.explanation,
              next_review_at = now() + interval '8 hours';
      elsif v_correct then
        update public.wrong_answers
        set mastered = true
        where user_id = v_user and question_id = p_question_id and mastered = false;
      end if;
    exception when others then
      null;
    end;

    begin
      perform public.sync_today_plan_progress();
    exception when others then
      null;
    end;

    if v_question.memory_lesson_id is not null and v_correct then
      perform public.cms_mark_lesson_complete(v_user, v_question.memory_lesson_id);
    end if;

    return jsonb_build_object(
      'is_correct', v_correct,
      'correct_choice', coalesce(v_question.correct_choice, v_correct_choice),
      'explanation', v_explanation,
      'xp_awarded', 0,
      'difficulty', v_difficulty,
      'mastered', false
    );
  end if;

  select * into v_mq from public.memory_lesson_questions where id = p_question_id;
  if not found then
    raise exception 'QUESTION_NOT_FOUND';
  end if;
  select * into v_lesson from public.memory_lessons where id = v_mq.lesson_id and status = 'published';
  if not found then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  v_correct_choice := upper(left(trim(coalesce(v_mq.correct_answer, '')), 1));
  v_correct := v_correct_choice = v_choice;
  v_explanation := coalesce(v_mq.explanation, '');

  insert into public.memory_question_attempts (
    user_id, question_id, lesson_id, selected_choice, is_correct, time_spent_ms, mode
  ) values (v_user, v_mq.id, v_mq.lesson_id, v_choice, v_correct, p_time_spent_ms, v_mode);

  insert into public.memory_lesson_checkpoint_answers (
    user_id, lesson_id, checkpoint_question_id, selected_answer, correct, attempt_count
  ) values (v_user, v_mq.lesson_id, v_mq.id, v_choice, v_correct, 1)
  on conflict (user_id, checkpoint_question_id) do update
    set selected_answer = excluded.selected_answer,
        correct = excluded.correct,
        attempt_count = public.memory_lesson_checkpoint_answers.attempt_count + 1,
        answered_at = now();

  if v_correct then
    perform public.cms_mark_lesson_complete(v_user, v_mq.lesson_id);
  end if;

  return jsonb_build_object(
    'is_correct', v_correct,
    'correct_choice', coalesce(v_mq.correct_answer, v_correct_choice),
    'explanation', v_explanation,
    'xp_awarded', 0,
    'difficulty', 'medium',
    'mastered', false
  );
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
  v_exam uuid;
  v_limit int := least(coalesce(p_limit, 10), 40);
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  v_exam := public.resolve_exam_catalog_id(p_exam_catalog_id);
  if v_exam is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x))
    from (
      select
        q.id,
        q.question_text as stem,
        case
          when jsonb_typeof(q.options) = 'object' then q.options
          else '{}'::jsonb
        end as choices,
        q.correct_answer as correct_choice,
        q.explanation,
        coalesce(q.difficulty, 'medium') as difficulty,
        null::text as image_url,
        l.canonical_topic_id,
        l.topic as topic_name,
        l.subject as subject_name,
        null::uuid as learning_objective_id,
        null::text as objective_title,
        q.question_strategy,
        l.id as memory_lesson_id
      from public.memory_lesson_questions q
      join public.memory_lessons l on l.id = q.lesson_id
      where l.status = 'published'
        and public.cms_lesson_on_exam(l.id, v_exam)
        and (p_memory_lesson_id is null or l.id = p_memory_lesson_id)
        and (
          p_canonical_topic_id is null
          or l.canonical_topic_id = p_canonical_topic_id
          or l.topic_id = p_canonical_topic_id
        )
        and (
          p_set_type is null
          or p_set_type in ('mixed', 'topic_pool', 'daily_guided')
          or (p_set_type in ('lesson_final', 'lesson_checkpoint') and (p_memory_lesson_id is not null or l.id = p_memory_lesson_id))
          or (
            p_set_type in ('review', 'general_review')
            and exists (
              select 1 from public.memory_lesson_progress p
              where p.user_id = v_user and p.lesson_id = l.id and p.completed
            )
          )
        )
      order by random()
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_cms_study_progress(p_exam uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exam uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  v_exam := public.resolve_exam_catalog_id(p_exam);
  if v_exam is null then
    return jsonb_build_object('examCatalogId', null, 'totalTopics', 0, 'completedTopics', 0, 'ratio', 0, 'questions', 0, 'subjects', '[]'::jsonb);
  end if;

  return (
    with lessons as (
      select l.id, l.subject, coalesce(l.subject_id::text, l.subject) as subject_key, l.topic, l.canonical_topic_id, l.topic_id
      from public.memory_lessons l
      where l.status = 'published' and public.cms_lesson_on_exam(l.id, v_exam)
    ),
    done as (
      select p.lesson_id
      from public.memory_lesson_progress p
      where p.user_id = v_user and p.completed
    ),
    grouped as (
      select
        l.subject_key as id,
        max(l.subject) as name,
        count(*)::int as topic_count,
        count(*) filter (where d.lesson_id is not null)::int as completed_topics,
        jsonb_agg(jsonb_build_object(
          'id', l.id,
          'name', l.topic,
          'lessonId', l.id,
          'completed', d.lesson_id is not null
        ) order by l.topic) as topics
      from lessons l
      left join done d on d.lesson_id = l.id
      group by l.subject_key
    )
    select jsonb_build_object(
      'examCatalogId', v_exam,
      'totalTopics', coalesce((select count(*) from lessons), 0),
      'completedTopics', coalesce((select count(*) from lessons l join done d on d.lesson_id = l.id), 0),
      'ratio', case
        when (select count(*) from lessons) = 0 then 0
        else (select count(*) from lessons l join done d on d.lesson_id = l.id)::numeric
             / (select count(*) from lessons)
      end,
      'questions', (
        select count(*) from public.memory_question_attempts a
        where a.user_id = v_user
          and exists (select 1 from lessons l where l.id = a.lesson_id)
      ) + (
        select count(*) from public.memory_lesson_checkpoint_answers a
        where a.user_id = v_user
          and exists (select 1 from lessons l where l.id = a.lesson_id)
      ),
      'subjects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id,
          'name', g.name,
          'slug', g.name,
          'topicCount', g.topic_count,
          'completedTopics', g.completed_topics,
          'completion', case when g.topic_count = 0 then 0 else g.completed_topics::numeric / g.topic_count end,
          'topics', g.topics
        ) order by g.name)
        from grouped g
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.complete_memory_lesson_narration(p_lesson uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.memory_lessons where id = p_lesson and status = 'published') then
    raise exception 'NOT_FOUND';
  end if;
  perform public.cms_mark_lesson_complete(v_user, p_lesson);
  return jsonb_build_object('ok', true, 'xp', jsonb_build_object('awarded', false, 'amount', 0));
end;
$$;

create or replace function public.complete_lesson_topic(p_topic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_lesson uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_topic_id is null then raise exception 'INVALID_INPUT'; end if;
  select id into v_lesson
  from public.memory_lessons
  where status = 'published'
    and (id = p_topic_id or topic_id = p_topic_id or canonical_topic_id = p_topic_id)
  limit 1;
  if v_lesson is not null then
    perform public.cms_mark_lesson_complete(v_user, v_lesson);
  end if;
  return jsonb_build_object('awarded', false, 'amount', 0);
end;
$$;

create or replace function public.complete_practice_set(
  p_set_id uuid,
  p_question_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ids uuid[] := coalesce(p_question_ids, '{}');
  v_answered int := 0;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_set_id is null then raise exception 'INVALID_INPUT'; end if;
  select count(distinct question_id) into v_answered
  from (
    select question_id from public.question_attempts
    where user_id = v_user and question_id = any (v_ids) and created_at > now() - interval '4 hours'
    union all
    select question_id from public.memory_question_attempts
    where user_id = v_user and question_id = any (v_ids) and created_at > now() - interval '4 hours'
  ) x;
  return jsonb_build_object('awarded', false, 'amount', 0, 'answered', coalesce(v_answered, 0));
end;
$$;

create or replace function public.submit_lesson_checkpoint(
  p_lesson uuid,
  p_question uuid,
  p_answer text,
  p_anchor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_q public.memory_lesson_questions%rowtype;
  v_lesson public.memory_lessons%rowtype;
  v_correct boolean;
  v_choice text;
  v_existing public.memory_lesson_checkpoint_answers%rowtype;
  v_retry boolean := false;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_q from public.memory_lesson_questions
  where id = p_question and lesson_id = p_lesson;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_lesson from public.memory_lessons where id = p_lesson and status = 'published';
  if not found then raise exception 'NOT_FOUND'; end if;

  v_choice := upper(left(trim(p_answer), 1));
  v_correct := v_choice = upper(left(trim(v_q.correct_answer), 1));

  select * into v_existing
  from public.memory_lesson_checkpoint_answers
  where user_id = v_user and checkpoint_question_id = p_question;

  if found then
    v_retry := true;
    update public.memory_lesson_checkpoint_answers
    set selected_answer = v_choice,
        correct = v_correct,
        attempt_count = coalesce(attempt_count, 1) + 1,
        memory_anchor_id = coalesce(p_anchor, memory_anchor_id),
        answered_at = now()
    where id = v_existing.id;
  else
    insert into public.memory_lesson_checkpoint_answers (
      user_id, lesson_id, checkpoint_question_id, selected_answer, correct, memory_anchor_id, attempt_count
    ) values (v_user, p_lesson, p_question, v_choice, v_correct, p_anchor, 1);
  end if;

  insert into public.memory_question_attempts (
    user_id, question_id, lesson_id, selected_choice, is_correct, mode
  ) values (v_user, p_question, p_lesson, v_choice, v_correct, 'lesson');

  if v_correct then
    perform public.cms_mark_lesson_complete(v_user, p_lesson);
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'retry', v_retry,
    'correct', v_correct,
    'selected_answer', v_choice,
    'correct_answer', v_q.correct_answer,
    'explanation', v_q.explanation
  );
end;
$$;

revoke all on function public.cms_mark_lesson_complete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_exam_catalog_id(uuid) to authenticated;
grant execute on function public.cms_lesson_on_exam(uuid, uuid) to authenticated;
grant execute on function public.submit_question_attempt(uuid, text, int, text) to authenticated;
grant execute on function public.get_curriculum_practice_questions(uuid, uuid, text, int, uuid) to authenticated;
grant execute on function public.get_cms_study_progress(uuid) to authenticated;
grant execute on function public.complete_memory_lesson_narration(uuid) to authenticated;
grant execute on function public.complete_lesson_topic(uuid) to authenticated;
grant execute on function public.complete_practice_set(uuid, uuid[]) to authenticated;
grant execute on function public.submit_lesson_checkpoint(uuid, uuid, text, uuid) to authenticated;
