-- Progress insights: mastered wrong-answers, topic stats, weekly report.
-- Paste after 0023.

alter table public.wrong_answers
  add column if not exists mastered boolean not null default false,
  add column if not exists mastered_at timestamptz,
  add column if not exists attempt_count int not null default 1,
  add column if not exists last_attempt_at timestamptz not null default now(),
  add column if not exists first_wrong_at timestamptz not null default now();

update public.wrong_answers
set first_wrong_at = created_at
where first_wrong_at is null or first_wrong_at > created_at;

create index if not exists wrong_answers_open_review_idx
  on public.wrong_answers (user_id, next_review_at)
  where mastered = false;

create or replace function public.submit_question_attempt(
  p_question_id uuid,
  p_selected_choice text,
  p_time_spent_ms int,
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
    v_xp := 2;
    insert into public.xp_transactions (user_id, amount, reason, metadata)
    values (v_user, v_xp, 'question', jsonb_build_object('question_id', p_question_id));

    update public.profiles
    set current_xp = current_xp + v_xp
    where id = v_user;

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
    'xp_awarded', v_xp,
    'difficulty', v_question.difficulty,
    'mastered', v_mastered
  );
end;
$$;

create or replace function public.get_progress_insights()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := timezone('Europe/Istanbul', now());
  v_today date := v_now::date;
  v_week_start date := v_today - 6;
  v_prev_start date := v_today - 13;
  v_topics jsonb := '[]'::jsonb;
  v_priorities jsonb := '[]'::jsonb;
  v_weekly jsonb;
  v_wrong jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;

  with attempts as (
    select
      a.id,
      a.is_correct,
      a.selected_choice,
      a.time_spent_ms,
      a.created_at,
      (timezone('Europe/Istanbul', a.created_at))::date as day,
      q.subject_id,
      q.topic_id,
      s.name as subject_name,
      t.name as topic_name
    from public.question_attempts a
    join public.questions q on q.id = a.question_id
    join public.subjects s on s.id = q.subject_id
    left join public.topics t on t.id = q.topic_id
    where a.user_id = v_user
  ),
  topic_stats as (
    select
      subject_id,
      topic_id,
      max(subject_name) as subject_name,
      max(topic_name) as topic_name,
      count(*)::int as total,
      count(*) filter (where is_correct) ::int as correct,
      count(*) filter (where is_correct = false)::int as wrong,
      count(*) filter (where selected_choice is null)::int as blank,
      avg(time_spent_ms) filter (where time_spent_ms > 0) as avg_ms,
      count(*) filter (where day >= v_week_start)::int as recent_total,
      count(*) filter (where day >= v_week_start and is_correct)::int as recent_correct
    from attempts
    where topic_id is not null
    group by subject_id, topic_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'subjectId', subject_id,
    'topicId', topic_id,
    'subject', subject_name,
    'topic', coalesce(topic_name, 'Konu'),
    'total', total,
    'correct', correct,
    'wrong', wrong,
    'blank', blank,
    'avgMs', round(coalesce(avg_ms, 0)),
    'accuracy', case when total > 0 then round((correct::numeric / total) * 100) else 0 end,
    'recentAccuracy', case when recent_total > 0 then round((recent_correct::numeric / recent_total) * 100) else null end,
    'enough', total >= 6
  ) order by total desc), '[]'::jsonb)
  into v_topics
  from topic_stats;

  select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb)
  into v_priorities
  from (
    select
      item->>'subjectId' as "subjectId",
      item->>'topicId' as "topicId",
      item->>'subject' as subject,
      item->>'topic' as topic,
      (item->>'accuracy')::int as accuracy,
      (item->>'total')::int as total
    from jsonb_array_elements(v_topics) item
    where (item->>'enough')::boolean
      and (item->>'accuracy')::int < 70
      and (item->>'wrong')::int >= 2
    order by (item->>'accuracy')::int asc, (item->>'wrong')::int desc
    limit 3
  ) p;

  with attempts as (
    select
      a.is_correct,
      a.time_spent_ms,
      (timezone('Europe/Istanbul', a.created_at))::date as day,
      s.name as subject_name
    from public.question_attempts a
    join public.questions q on q.id = a.question_id
    join public.subjects s on s.id = q.subject_id
    where a.user_id = v_user
      and a.created_at >= ((v_prev_start::timestamp at time zone 'Europe/Istanbul'))
  ),
  this_w as (
    select
      count(*)::int as questions,
      coalesce(sum(time_spent_ms), 0)::bigint as ms,
      count(*) filter (where is_correct)::int as correct,
      count(distinct day)::int as active
    from attempts
    where day >= v_week_start
  ),
  prev_w as (
    select
      count(*)::int as questions,
      count(*) filter (where is_correct)::int as correct
    from attempts
    where day >= v_prev_start and day < v_week_start
  ),
  subj as (
    select subject_name, count(*)::int as n, count(*) filter (where is_correct)::int as c
    from attempts
    where day >= v_week_start
    group by subject_name
    having count(*) >= 6
  ),
  bars as (
    select coalesce(jsonb_agg(cnt order by d), '[]'::jsonb) as days
    from (
      select gs::date as d, coalesce(count(a.day), 0)::int as cnt
      from generate_series(v_week_start, v_today, interval '1 day') gs
      left join attempts a on a.day = gs::date
      group by gs::date
    ) x
  )
  select jsonb_build_object(
    'questions', tw.questions,
    'ms', tw.ms,
    'accuracy', case when tw.questions > 0 then round((tw.correct::numeric / tw.questions) * 100) else null end,
    'activeDays', tw.active,
    'questionDelta', case when pw.questions > 0 then round(((tw.questions - pw.questions)::numeric / pw.questions) * 100) else null end,
    'accuracyDelta', case
      when tw.questions >= 6 and pw.questions >= 6 then
        round((tw.correct::numeric / tw.questions) * 100) - round((pw.correct::numeric / pw.questions) * 100)
      else null
    end,
    'strongest', (select subject_name from subj order by (c::numeric / n) desc, n desc limit 1),
    'weakest', (select subject_name from subj order by (c::numeric / n) asc, n desc limit 1),
    'bars', b.days
  )
  into v_weekly
  from this_w tw, prev_w pw, bars b;

  select jsonb_build_object(
    'open', count(*) filter (where not mastered),
    'mastered', count(*) filter (where mastered),
    'bySubject', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'count', c.n) order by c.n desc)
      from (
        select subject_id, count(*)::int as n
        from public.wrong_answers
        where user_id = v_user and not mastered
        group by subject_id
      ) c
      join public.subjects s on s.id = c.subject_id
    ), '[]'::jsonb),
    'byTopic', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(t.name, 'Konu'), 'count', c.n, 'subject', s.name) order by c.n desc)
      from (
        select topic_id, subject_id, count(*)::int as n
        from public.wrong_answers
        where user_id = v_user and not mastered and topic_id is not null
        group by topic_id, subject_id
      ) c
      join public.subjects s on s.id = c.subject_id
      left join public.topics t on t.id = c.topic_id
    ), '[]'::jsonb)
  )
  into v_wrong
  from public.wrong_answers
  where user_id = v_user;

  return jsonb_build_object(
    'topics', coalesce(v_topics, '[]'::jsonb),
    'priorities', coalesce(v_priorities, '[]'::jsonb),
    'weekly', coalesce(v_weekly, jsonb_build_object(
      'questions', 0, 'ms', 0, 'accuracy', null, 'activeDays', 0,
      'questionDelta', null, 'accuracyDelta', null, 'strongest', null, 'weakest', null,
      'bars', jsonb_build_array(0,0,0,0,0,0,0)
    )),
    'wrong', coalesce(v_wrong, jsonb_build_object(
      'open', 0, 'mastered', 0, 'bySubject', '[]'::jsonb, 'byTopic', '[]'::jsonb
    ))
  );
end;
$$;

revoke all on function public.get_progress_insights() from public;
grant execute on function public.get_progress_insights() to authenticated;
grant execute on function public.submit_question_attempt(uuid, text, int, text) to authenticated;
