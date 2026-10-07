-- XP awards: idempotent transactions, derived levels (client + SQL helpers).
-- Paste after 0029.

do $$ begin
  alter type public.xp_reason add value 'session';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.xp_reason add value 'study_task';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.xp_reason add value 'wrong_mastered';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.xp_reason add value 'practice_set';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.xp_reason add value 'lesson';
exception when duplicate_object then null;
end $$;

alter table public.xp_transactions
  add column if not exists reference_type text,
  add column if not exists reference_id text;

create unique index if not exists xp_transactions_dedupe_idx
  on public.xp_transactions (user_id, reason, reference_type, reference_id)
  where reference_id is not null;

create or replace function public.xp_for_level(p_level int)
returns int
language sql
immutable
as $$
  select greatest(1, round(120 * power(1.16, greatest(p_level, 1) - 1))::int);
$$;

create or replace function public.level_from_xp(p_xp int)
returns int
language plpgsql
immutable
as $$
declare
  v_left int := greatest(coalesce(p_xp, 0), 0);
  v_level int := 1;
  v_need int;
begin
  while v_level < 99 loop
    v_need := public.xp_for_level(v_level);
    exit when v_left < v_need;
    v_left := v_left - v_need;
    v_level := v_level + 1;
  end loop;
  return v_level;
end;
$$;

create or replace function public.award_xp(
  p_user uuid,
  p_amount int,
  p_reason public.xp_reason,
  p_reference_type text,
  p_reference_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev int;
  v_total int;
  v_amount int := greatest(1, least(coalesce(p_amount, 0), 500));
begin
  if p_user is null or v_amount <= 0 then
    return jsonb_build_object('awarded', false, 'amount', 0);
  end if;

  begin
    insert into public.xp_transactions (user_id, amount, reason, metadata, reference_type, reference_id)
    values (p_user, v_amount, p_reason, coalesce(p_metadata, '{}'::jsonb), p_reference_type, p_reference_id);
  exception
    when unique_violation then
      select current_xp into v_total from public.profiles where id = p_user;
      return jsonb_build_object(
        'awarded', false,
        'amount', 0,
        'total_xp', coalesce(v_total, 0),
        'previous_xp', coalesce(v_total, 0),
        'level', public.level_from_xp(coalesce(v_total, 0))
      );
  end;

  update public.profiles
  set current_xp = current_xp + v_amount
  where id = p_user
  returning current_xp - v_amount, current_xp into v_prev, v_total;

  return jsonb_build_object(
    'awarded', true,
    'amount', v_amount,
    'total_xp', coalesce(v_total, 0),
    'previous_xp', coalesce(v_prev, 0),
    'level', public.level_from_xp(coalesce(v_total, 0)),
    'previous_level', public.level_from_xp(coalesce(v_prev, 0))
  );
end;
$$;

drop function if exists public.submit_question_attempt(uuid, text, integer, text);
drop function if exists public.submit_question_attempt(uuid, text, int, text);

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
  v_mode text := case when p_mode in ('practice', 'review') then p_mode else 'practice' end;
  v_mastered boolean := false;
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
    update public.wrong_answers
    set mastered = true,
        mastered_at = coalesce(mastered_at, now()),
        last_attempt_at = now(),
        attempt_count = attempt_count + 1,
        repetitions = least(12, repetitions + 1),
        interval_days = least(30, greatest(2, interval_days * 2)),
        next_review_at = now() + make_interval(days => least(30, greatest(2, interval_days * 2))),
        user_answer = v_choice
    where user_id = v_user and question_id = p_question_id and mastered = false;

    if found then
      v_mastered := true;
      perform public.award_xp(
        v_user, 12, 'wrong_mastered', 'question', p_question_id::text,
        jsonb_build_object('question_id', p_question_id)
      );
    end if;
  else
    insert into public.wrong_answers (
      user_id, question_id, exam_id, subject_id, topic_id,
      user_answer, correct_answer, explanation, difficulty,
      next_review_at, interval_days, ease_factor, repetitions,
      mastered, attempt_count, last_attempt_at, first_wrong_at
    )
    values (
      v_user, p_question_id, v_question.exam_id, v_question.subject_id, v_question.topic_id,
      v_choice, v_question.correct_choice, v_question.explanation, v_question.difficulty,
      now() + interval '8 hours', 1, 2.5, 0,
      false, 1, now(), now()
    )
    on conflict (user_id, question_id) do update
      set user_answer = excluded.user_answer,
          correct_answer = excluded.correct_answer,
          explanation = excluded.explanation,
          difficulty = excluded.difficulty,
          mastered = false,
          mastered_at = null,
          last_attempt_at = now(),
          attempt_count = public.wrong_answers.attempt_count + 1,
          interval_days = 1,
          repetitions = 0,
          next_review_at = now() + interval '8 hours';
  end if;

  perform public.sync_today_plan_progress();

  return jsonb_build_object(
    'is_correct', v_correct,
    'correct_choice', v_question.correct_choice,
    'explanation', v_question.explanation,
    'xp_awarded', 0,
    'difficulty', v_question.difficulty,
    'mastered', v_mastered
  );
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
  v_correct int := 0;
  v_amount int := 0;
  v_result jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_set_id is null then raise exception 'INVALID_INPUT'; end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 or coalesce(array_length(v_ids, 1), 0) > 40 then
    raise exception 'INVALID_INPUT';
  end if;

  select count(distinct a.question_id), count(distinct a.question_id) filter (where a.is_correct)
  into v_answered, v_correct
  from public.question_attempts a
  where a.user_id = v_user
    and a.question_id = any (v_ids)
    and a.created_at > now() - interval '4 hours';

  if coalesce(v_answered, 0) < 1 then
    return jsonb_build_object('awarded', false, 'amount', 0, 'answered', 0, 'correct', 0);
  end if;

  v_amount := least(200, 10 + (v_answered * 2) + (v_correct * 5));
  v_result := public.award_xp(
    v_user, v_amount, 'practice_set', 'practice_set', p_set_id::text,
    jsonb_build_object('answered', v_answered, 'correct', v_correct)
  );
  return v_result || jsonb_build_object('answered', v_answered, 'correct', v_correct);
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
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_topic_id is null then raise exception 'INVALID_INPUT'; end if;
  if not exists (select 1 from public.topics where id = p_topic_id)
     and not exists (select 1 from public.subjects where id = p_topic_id) then
    raise exception 'NOT_FOUND';
  end if;
  return public.award_xp(v_user, 20, 'lesson', 'topic', p_topic_id::text, '{}'::jsonb);
end;
$$;

drop function if exists public.complete_study_task(uuid);

create or replace function public.complete_study_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_pending int;
  v_today_total int;
  v_task jsonb := '{}'::jsonb;
  v_daily jsonb := '{}'::jsonb;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  update public.study_tasks
  set status = 'completed', completed_at = now()
  where id = p_task_id
    and user_id = v_user
    and status = 'pending';

  if not found then
    raise exception 'TASK_NOT_FOUND';
  end if;

  v_task := public.award_xp(v_user, 15, 'study_task', 'study_task', p_task_id::text, '{}'::jsonb);

  select
    count(*) filter (where t.status <> 'completed'),
    count(*)
  into v_pending, v_today_total
  from public.study_tasks t
  join public.study_plans p on p.id = t.plan_id
  where t.user_id = v_user
    and p.plan_date = (timezone('Europe/Istanbul', now()))::date;

  if coalesce(v_today_total, 0) > 0 and coalesce(v_pending, 1) = 0 then
    v_daily := to_jsonb(public.register_daily_completion());
  end if;

  return jsonb_build_object('task', v_task, 'daily', v_daily);
end;
$$;

create or replace function public.register_daily_completion()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_pending int;
  v_total int;
  v_streak int;
  v_last date;
  v_freezes int;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select
    count(*) filter (where t.status <> 'completed'),
    count(*)
  into v_pending, v_total
  from public.study_tasks t
  join public.study_plans p on p.id = t.plan_id
  where t.user_id = v_user
    and p.plan_date = v_today;

  if coalesce(v_total, 0) = 0 or coalesce(v_pending, 1) > 0 then
    raise exception 'TODAY_PLAN_INCOMPLETE';
  end if;

  select current_streak, last_completed_date, freeze_count
    into v_streak, v_last, v_freezes
  from public.streaks
  where user_id = v_user
  for update;

  if v_last = v_today then
    return v_streak;
  end if;

  if v_last = v_today - 1 then
    v_streak := coalesce(v_streak, 0) + 1;
  elsif v_last is null then
    v_streak := 1;
  elsif coalesce(v_freezes, 0) > 0 and v_last = v_today - 2 then
    v_freezes := v_freezes - 1;
    v_streak := coalesce(v_streak, 0) + 1;
  else
    v_streak := 1;
  end if;

  update public.streaks
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_streak),
      last_completed_date = v_today,
      freeze_count = coalesce(v_freezes, 0),
      updated_at = now()
  where user_id = v_user;

  perform public.award_xp(v_user, 50, 'daily_plan', 'plan_date', v_today::text, '{}'::jsonb);

  if v_streak > 0 and v_streak % 7 = 0 then
    perform public.award_xp(
      v_user, 35, 'streak_bonus', 'streak_week', v_streak::text,
      jsonb_build_object('streak', v_streak)
    );
  end if;

  return v_streak;
end;
$$;

create or replace function public.award_session_xp(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.study_sessions%rowtype;
  v_n int;
  r record;
begin
  select * into v_session from public.study_sessions where id = p_session;
  if not found or v_session.xp_awarded_at is not null then
    return;
  end if;
  if v_session.mode not in ('race', 'exam') then
    return;
  end if;

  select count(*) into v_n from public.study_session_members where session_id = p_session;
  if v_n < 1 then
    return;
  end if;

  for r in
    with scores as (
      select m.user_id,
        coalesce(sum(case when a.is_correct then 1 else 0 end), 0)::int as correct
      from public.study_session_members m
      left join public.study_session_answers a
        on a.session_id = m.session_id and a.user_id = m.user_id
      where m.session_id = p_session
      group by m.user_id
    ),
    ranked as (
      select user_id, correct, rank() over (order by correct desc) as rk
      from scores
    )
    select user_id, correct, rk, greatest(8, (v_n - rk + 1) * 6 + correct) as xp from ranked
  loop
    perform public.award_xp(
      r.user_id, r.xp, 'session', 'session', p_session::text || ':' || r.user_id::text,
      jsonb_build_object('session_id', p_session, 'correct', r.correct, 'rank', r.rk)
    );
  end loop;

  update public.study_sessions set xp_awarded_at = now() where id = p_session;
end;
$$;

revoke all on function public.award_xp(uuid, int, public.xp_reason, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_practice_set(uuid, uuid[]) to authenticated;
grant execute on function public.complete_lesson_topic(uuid) to authenticated;
grant execute on function public.complete_study_task(uuid) to authenticated;
grant execute on function public.register_daily_completion() to authenticated;
grant execute on function public.submit_question_attempt(uuid, text, int, text) to authenticated;
grant execute on function public.xp_for_level(int) to authenticated;
grant execute on function public.level_from_xp(int) to authenticated;
