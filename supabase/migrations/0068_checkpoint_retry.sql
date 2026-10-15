-- In-lesson checkpoint retry: wrong answers can be asked again; queue weakness review.
-- Does not start the content factory.

alter table public.memory_lesson_checkpoint_answers
  add column if not exists attempt_count int not null default 1;

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
  v_total int;
  v_ok int;
  v_retry boolean := false;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_q from public.memory_lesson_questions
  where id = p_question and lesson_id = p_lesson and question_type = 'checkpoint';
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_lesson from public.memory_lessons where id = p_lesson and status = 'published';
  if not found then raise exception 'NOT_FOUND'; end if;

  v_choice := upper(left(trim(p_answer), 1));
  v_correct := v_choice = upper(left(trim(v_q.correct_answer), 1));

  select * into v_existing
  from public.memory_lesson_checkpoint_answers
  where user_id = v_user and checkpoint_question_id = p_question;

  if found and v_existing.correct then
    return jsonb_build_object(
      'duplicate', true,
      'retry', false,
      'correct', true,
      'selected_answer', v_existing.selected_answer,
      'correct_answer', v_q.correct_answer,
      'explanation', v_q.explanation
    );
  end if;

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

  select count(*) filter (where question_type = 'checkpoint'),
         (select count(*) from public.memory_lesson_checkpoint_answers a
           where a.user_id = v_user and a.lesson_id = p_lesson and a.correct)
  into v_total, v_ok
  from public.memory_lesson_questions
  where lesson_id = p_lesson;

  insert into public.memory_lesson_progress (user_id, lesson_id, checkpoint_correct, checkpoint_total)
  values (v_user, p_lesson, v_ok, v_total)
  on conflict (user_id, lesson_id) do update
    set checkpoint_correct = excluded.checkpoint_correct,
        checkpoint_total = excluded.checkpoint_total,
        updated_at = now();

  if not v_correct and v_lesson.canonical_topic_id is not null then
    insert into public.user_review_queue (user_id, canonical_topic_id, lesson_id, review_type, scheduled_at, status)
    select v_user, v_lesson.canonical_topic_id, p_lesson, 'weakness', now() + interval '2 hours', 'scheduled'
    where not exists (
      select 1 from public.user_review_queue q
      where q.user_id = v_user and q.lesson_id = p_lesson and q.review_type = 'weakness'
        and q.status in ('scheduled', 'ready')
    );
  end if;

  if v_total > 0 and v_ok >= v_total then
    perform public.award_xp(v_user, 8, 'lesson', 'memory_checkpoint', p_lesson::text, '{}'::jsonb);
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
