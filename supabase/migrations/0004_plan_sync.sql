-- Auto-fill today's plan from real question attempts.

alter table public.study_tasks
  add column if not exists kind text not null default 'subject';

alter table public.question_attempts
  add column if not exists mode text not null default 'practice';

update public.study_tasks
set kind = 'review'
where subject_id is null and title ilike '%yanlış%';

update public.study_tasks
set kind = 'mock'
where subject_id is null and title ilike '%deneme%';

update public.study_tasks
set kind = 'subject'
where subject_id is not null;

create or replace function public.generate_today_plan()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exam uuid;
  v_minutes int;
  v_plan uuid;
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_sort int := 0;
  r record;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select exam_id, daily_minutes into v_exam, v_minutes
  from public.profiles
  where id = v_user;

  if v_exam is null then
    raise exception 'EXAM_REQUIRED';
  end if;

  insert into public.study_plans (user_id, plan_date, target_questions, target_minutes, generated_by, summary)
  values (
    v_user,
    v_today,
    greatest(40, least(120, coalesce(v_minutes, 90))),
    coalesce(v_minutes, 90),
    'algorithm',
    'Hedefine ve zayıf derslerine göre hazırlanan günlük plan.'
  )
  on conflict (user_id, plan_date) do update
    set target_minutes = excluded.target_minutes,
        target_questions = excluded.target_questions,
        summary = excluded.summary
  returning id into v_plan;

  delete from public.study_tasks where plan_id = v_plan and status = 'pending';

  if exists (select 1 from public.study_tasks where plan_id = v_plan) then
    return v_plan;
  end if;

  for r in
    with preferred as (
      select unnest(coalesce(s.perceived_weak_subject_ids, '{}'::uuid[])) as subject_id
      from public.user_exam_settings s
      where s.user_id = v_user
    ),
    exam_subjects as (
      select sub.id, sub.name, sub.sort_order
      from public.subjects sub
      join public.exams e on e.id = sub.exam_id
      join public.exams selected on selected.id = v_exam
      where sub.exam_id = v_exam
         or (selected.kind = 'tyt_ayt' and e.slug in ('tyt', 'ayt'))
    )
    select es.id, es.name
    from exam_subjects es
    left join preferred p on p.subject_id = es.id
    order by (p.subject_id is not null) desc, es.name
    limit 3
  loop
    v_sort := v_sort + 1;
    insert into public.study_tasks (plan_id, user_id, title, subject_id, question_count, sort_order, kind)
    values (v_plan, v_user, r.name || ' – 20 soru', r.id, 20, v_sort, 'subject');
  end loop;

  v_sort := v_sort + 1;
  insert into public.study_tasks (plan_id, user_id, title, question_count, sort_order, kind)
  values (v_plan, v_user, '10 yanlış tekrar', 10, v_sort, 'review');

  v_sort := v_sort + 1;
  insert into public.study_tasks (plan_id, user_id, title, question_count, sort_order, kind)
  values (v_plan, v_user, 'Mini deneme', 20, v_sort, 'mock');

  return v_plan;
end;
$$;

create or replace function public.sync_today_plan_progress()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_start timestamptz := (v_today::timestamp at time zone 'Europe/Istanbul');
  v_end timestamptz := v_start + interval '1 day';
  r record;
  v_done int;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  for r in
    select t.id, t.subject_id, t.question_count, t.kind
    from public.study_tasks t
    join public.study_plans p on p.id = t.plan_id
    where t.user_id = v_user
      and p.plan_date = v_today
      and t.status = 'pending'
  loop
    if r.kind = 'subject' and r.subject_id is not null then
      select count(*) into v_done
      from public.question_attempts a
      join public.questions q on q.id = a.question_id
      where a.user_id = v_user
        and q.subject_id = r.subject_id
        and a.created_at >= v_start
        and a.created_at < v_end;
    elsif r.kind = 'review' then
      select count(*) into v_done
      from public.question_attempts a
      where a.user_id = v_user
        and a.mode = 'review'
        and a.created_at >= v_start
        and a.created_at < v_end;
    else
      select count(*) into v_done
      from public.question_attempts a
      where a.user_id = v_user
        and a.created_at >= v_start
        and a.created_at < v_end;
    end if;

    if coalesce(v_done, 0) >= coalesce(r.question_count, 1) then
      begin
        perform public.complete_study_task(r.id);
      exception when others then
        null;
      end;
    end if;
  end loop;
end;
$$;

drop function if exists public.submit_question_attempt(uuid, text, int);

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
  v_correct boolean;
  v_choice text;
  v_xp int := 0;
  v_mode text := case when p_mode in ('practice', 'review') then p_mode else 'practice' end;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  v_choice := upper(trim(p_selected_choice));
  if v_choice not in ('A', 'B', 'C', 'D', 'E') then
    raise exception 'INVALID_CHOICE';
  end if;

  select * into v_question
  from public.questions
  where id = p_question_id and is_published = true;

  if not found then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  v_correct := upper(trim(v_question.correct_choice)) = v_choice;

  insert into public.question_attempts (user_id, question_id, selected_choice, is_correct, time_spent_ms, mode)
  values (v_user, p_question_id, v_choice, v_correct, p_time_spent_ms, v_mode);

  update public.user_stats
  set questions_solved = questions_solved + 1,
      questions_correct = questions_correct + case when v_correct then 1 else 0 end,
      updated_at = now()
  where user_id = v_user;

  if v_correct then
    v_xp := 2;
    insert into public.xp_transactions (user_id, amount, reason, metadata)
    values (v_user, v_xp, 'question', jsonb_build_object('question_id', p_question_id));

    update public.profiles
    set current_xp = current_xp + v_xp
    where id = v_user;

    delete from public.wrong_answers
    where user_id = v_user and question_id = p_question_id;
  else
    insert into public.wrong_answers (
      user_id, question_id, exam_id, subject_id, topic_id,
      user_answer, correct_answer, explanation, difficulty,
      next_review_at, interval_days, ease_factor, repetitions
    )
    values (
      v_user, p_question_id, v_question.exam_id, v_question.subject_id, v_question.topic_id,
      v_choice, v_question.correct_choice, v_question.explanation, v_question.difficulty,
      now() + interval '1 day', 1, 2.5, 0
    )
    on conflict (user_id, question_id) do update
      set user_answer = excluded.user_answer,
          correct_answer = excluded.correct_answer,
          explanation = excluded.explanation,
          next_review_at = now() + interval '1 day',
          interval_days = 1,
          repetitions = 0;
  end if;

  perform public.sync_today_plan_progress();

  return jsonb_build_object(
    'is_correct', v_correct,
    'correct_choice', v_question.correct_choice,
    'explanation', v_question.explanation,
    'xp_awarded', v_xp,
    'difficulty', v_question.difficulty
  );
end;
$$;

revoke all on function public.submit_question_attempt(uuid, text, int, text) from public;
revoke all on function public.sync_today_plan_progress() from public;
grant execute on function public.submit_question_attempt(uuid, text, int, text) to authenticated;
grant execute on function public.sync_today_plan_progress() to authenticated;

create or replace function public.bump_ai_usage(p_tokens int default 0, p_cost numeric default 0)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_daily int;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  insert into public.ai_usage (user_id, used_on, daily_requests, monthly_requests, tokens_used, estimated_cost_usd)
  values (v_user, v_today, 1, 1, greatest(p_tokens, 0), greatest(p_cost, 0))
  on conflict (user_id, used_on) do update
    set daily_requests = public.ai_usage.daily_requests + 1,
        monthly_requests = public.ai_usage.monthly_requests + 1,
        tokens_used = public.ai_usage.tokens_used + excluded.tokens_used,
        estimated_cost_usd = public.ai_usage.estimated_cost_usd + excluded.estimated_cost_usd
  returning daily_requests into v_daily;

  return v_daily;
end;
$$;

revoke all on function public.bump_ai_usage(int, numeric) from public;
grant execute on function public.bump_ai_usage(int, numeric) to authenticated;

notify pgrst, 'reload schema';
