-- Phase 3D: student memory lesson player, checkpoints, mastery, spaced review.
-- No lesson/question/media regeneration.

alter table public.memory_lesson_progress
  add column if not exists narration_completed boolean not null default false,
  add column if not exists checkpoint_correct int not null default 0,
  add column if not exists checkpoint_total int not null default 0,
  add column if not exists started_logged boolean not null default false;

create table if not exists public.memory_lesson_checkpoint_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  checkpoint_question_id uuid not null references public.memory_lesson_questions(id) on delete cascade,
  selected_answer text not null,
  correct boolean not null,
  learning_objective_id uuid,
  memory_anchor_id uuid,
  answered_at timestamptz not null default now(),
  unique (user_id, checkpoint_question_id)
);

create index if not exists memory_lesson_checkpoint_answers_lesson_idx
  on public.memory_lesson_checkpoint_answers (user_id, lesson_id);

alter table public.memory_lesson_checkpoint_answers enable row level security;

drop policy if exists memory_lesson_checkpoint_answers_own on public.memory_lesson_checkpoint_answers;
create policy memory_lesson_checkpoint_answers_own on public.memory_lesson_checkpoint_answers
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.memory_lesson_checkpoint_answers to authenticated;

create table if not exists public.user_topic_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete cascade,
  lesson_id uuid references public.memory_lessons(id) on delete set null,
  lesson_completed boolean not null default false,
  checkpoint_accuracy numeric,
  final_test_accuracy numeric,
  review_accuracy numeric,
  mastery_score numeric,
  last_studied_at timestamptz,
  next_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canonical_topic_id)
);

alter table public.user_topic_mastery enable row level security;

drop policy if exists user_topic_mastery_own on public.user_topic_mastery;
create policy user_topic_mastery_own on public.user_topic_mastery
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_topic_mastery to authenticated;

drop trigger if exists user_topic_mastery_set_updated_at on public.user_topic_mastery;
create trigger user_topic_mastery_set_updated_at
  before update on public.user_topic_mastery
  for each row execute procedure public.set_updated_at();

create table if not exists public.user_memory_anchor_mastery (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  anchor_id uuid references public.memory_lesson_review_anchors(id) on delete cascade,
  visual_anchor text not null,
  correct_count int not null default 0,
  attempt_count int not null default 0,
  mastery numeric,
  updated_at timestamptz not null default now(),
  unique (user_id, lesson_id, visual_anchor)
);

alter table public.user_memory_anchor_mastery enable row level security;

drop policy if exists user_memory_anchor_mastery_own on public.user_memory_anchor_mastery;
create policy user_memory_anchor_mastery_own on public.user_memory_anchor_mastery
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_memory_anchor_mastery to authenticated;

create table if not exists public.user_review_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete cascade,
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  review_type text not null
    check (review_type in ('1d', '3d', '7d', 'weakness', 'manual')),
  scheduled_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'ready', 'completed', 'skipped')),
  created_at timestamptz not null default now()
);

create unique index if not exists user_review_queue_open_uniq
  on public.user_review_queue (user_id, lesson_id, review_type)
  where status in ('scheduled', 'ready');

create index if not exists user_review_queue_user_idx
  on public.user_review_queue (user_id, scheduled_at);

alter table public.user_review_queue enable row level security;

drop policy if exists user_review_queue_own on public.user_review_queue;
create policy user_review_queue_own on public.user_review_queue
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.user_review_queue to authenticated;

create or replace function public.recompute_topic_mastery(p_user uuid, p_topic uuid, p_lesson uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check numeric;
  v_final numeric;
  v_review numeric;
  v_score numeric;
  v_next timestamptz;
begin
  select
    case when checkpoint_total > 0 then checkpoint_correct::numeric / checkpoint_total else null end
  into v_check
  from public.memory_lesson_progress
  where user_id = p_user and lesson_id = p_lesson;

  select final_test_accuracy, review_accuracy into v_final, v_review
  from public.user_topic_mastery
  where user_id = p_user and canonical_topic_id = p_topic;

  v_review := coalesce(v_review, v_final, v_check, 0);
  v_score := round((
    coalesce(v_check, 0) * 0.20
    + coalesce(v_final, 0) * 0.60
    + v_review * 0.20
  )::numeric, 4);

  select min(scheduled_at) into v_next
  from public.user_review_queue
  where user_id = p_user and lesson_id = p_lesson and status in ('scheduled', 'ready');

  insert into public.user_topic_mastery (
    user_id, canonical_topic_id, lesson_id, lesson_completed,
    checkpoint_accuracy, final_test_accuracy, review_accuracy, mastery_score,
    last_studied_at, next_review_at
  ) values (
    p_user, p_topic, p_lesson, true,
    v_check, v_final, v_review, v_score, now(), v_next
  )
  on conflict (user_id, canonical_topic_id) do update
    set lesson_id = excluded.lesson_id,
        lesson_completed = true,
        checkpoint_accuracy = coalesce(excluded.checkpoint_accuracy, public.user_topic_mastery.checkpoint_accuracy),
        mastery_score = excluded.mastery_score,
        last_studied_at = now(),
        next_review_at = excluded.next_review_at;
end;
$$;

create or replace function public.touch_memory_lesson_progress(
  p_lesson uuid,
  p_position_ms int,
  p_duration_ms int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.memory_lesson_progress%rowtype;
  v_pct numeric := 0;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.memory_lessons where id = p_lesson and status = 'published') then
    raise exception 'NOT_FOUND';
  end if;
  if p_duration_ms is not null and p_duration_ms > 0 then
    v_pct := least(100, round((greatest(p_position_ms, 0)::numeric / p_duration_ms) * 100, 2));
  end if;
  insert into public.memory_lesson_progress (user_id, lesson_id, last_position_ms, completion_percent)
  values (v_user, p_lesson, greatest(p_position_ms, 0), v_pct)
  on conflict (user_id, lesson_id) do update
    set last_position_ms = greatest(excluded.last_position_ms, 0),
        completion_percent = greatest(public.memory_lesson_progress.completion_percent, excluded.completion_percent),
        updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
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
  v_correct boolean;
  v_choice text;
  v_existing public.memory_lesson_checkpoint_answers%rowtype;
  v_total int;
  v_ok int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_q from public.memory_lesson_questions
  where id = p_question and lesson_id = p_lesson and question_type = 'checkpoint';
  if not found then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.memory_lessons where id = p_lesson and status = 'published') then
    raise exception 'NOT_FOUND';
  end if;

  select * into v_existing
  from public.memory_lesson_checkpoint_answers
  where user_id = v_user and checkpoint_question_id = p_question;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'correct', v_existing.correct,
      'selected_answer', v_existing.selected_answer,
      'correct_answer', v_q.correct_answer,
      'explanation', v_q.explanation
    );
  end if;

  v_choice := upper(left(trim(p_answer), 1));
  v_correct := v_choice = upper(left(trim(v_q.correct_answer), 1));

  insert into public.memory_lesson_checkpoint_answers (
    user_id, lesson_id, checkpoint_question_id, selected_answer, correct, memory_anchor_id
  ) values (v_user, p_lesson, p_question, v_choice, v_correct, p_anchor);

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

  if v_total > 0 and (
    select count(*) from public.memory_lesson_checkpoint_answers
    where user_id = v_user and lesson_id = p_lesson
  ) >= v_total then
    perform public.award_xp(v_user, 8, 'lesson', 'memory_checkpoint', p_lesson::text, '{}'::jsonb);
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'correct', v_correct,
    'selected_answer', v_choice,
    'correct_answer', v_q.correct_answer,
    'explanation', v_q.explanation
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
  v_lesson public.memory_lessons%rowtype;
  v_xp jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_lesson from public.memory_lessons where id = p_lesson and status = 'published';
  if not found then raise exception 'NOT_FOUND'; end if;

  insert into public.memory_lesson_progress (user_id, lesson_id, narration_completed, completed, completed_at, completion_percent)
  values (v_user, p_lesson, true, true, now(), 100)
  on conflict (user_id, lesson_id) do update
    set narration_completed = true,
        completed = true,
        completed_at = coalesce(public.memory_lesson_progress.completed_at, now()),
        completion_percent = 100,
        updated_at = now();

  if v_lesson.canonical_topic_id is not null then
    insert into public.user_topic_mastery (user_id, canonical_topic_id, lesson_id, lesson_completed, last_studied_at)
    values (v_user, v_lesson.canonical_topic_id, p_lesson, true, now())
    on conflict (user_id, canonical_topic_id) do update
      set lesson_completed = true, lesson_id = excluded.lesson_id, last_studied_at = now();
    perform public.recompute_topic_mastery(v_user, v_lesson.canonical_topic_id, p_lesson);
  end if;

  v_xp := public.award_xp(v_user, 15, 'lesson', 'memory_narration', p_lesson::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'xp', v_xp);
end;
$$;

create or replace function public.schedule_memory_reviews(p_user uuid, p_lesson uuid, p_topic uuid, p_weak boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offset interval;
begin
  insert into public.user_review_queue (user_id, canonical_topic_id, lesson_id, review_type, scheduled_at, status)
  select p_user, p_topic, p_lesson, '1d',
         now() + case when p_weak then interval '12 hours' else interval '1 day' end,
         'scheduled'
  where not exists (
    select 1 from public.user_review_queue
    where user_id = p_user and lesson_id = p_lesson and review_type = '1d' and status in ('scheduled', 'ready')
  );

  insert into public.user_review_queue (user_id, canonical_topic_id, lesson_id, review_type, scheduled_at, status)
  select p_user, p_topic, p_lesson, '3d', now() + interval '3 days', 'scheduled'
  where not exists (
    select 1 from public.user_review_queue
    where user_id = p_user and lesson_id = p_lesson and review_type = '3d' and status in ('scheduled', 'ready')
  );

  insert into public.user_review_queue (user_id, canonical_topic_id, lesson_id, review_type, scheduled_at, status)
  select p_user, p_topic, p_lesson, '7d', now() + interval '7 days', 'scheduled'
  where not exists (
    select 1 from public.user_review_queue
    where user_id = p_user and lesson_id = p_lesson and review_type = '7d' and status in ('scheduled', 'ready')
  );

  if p_weak then
    insert into public.user_review_queue (user_id, canonical_topic_id, lesson_id, review_type, scheduled_at, status)
    select p_user, p_topic, p_lesson, 'weakness', now() + interval '8 hours', 'scheduled'
    where not exists (
      select 1 from public.user_review_queue
      where user_id = p_user and lesson_id = p_lesson and review_type = 'weakness' and status in ('scheduled', 'ready')
    );
  end if;
end;
$$;

create or replace function public.complete_memory_lesson_final(
  p_lesson uuid,
  p_correct int,
  p_total int,
  p_objectives jsonb default '[]'::jsonb,
  p_anchors jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_lesson public.memory_lessons%rowtype;
  v_acc numeric;
  v_item jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_lesson from public.memory_lessons where id = p_lesson and status = 'published';
  if not found then raise exception 'NOT_FOUND'; end if;
  v_acc := case when p_total > 0 then p_correct::numeric / p_total else 0 end;

  insert into public.user_topic_mastery (
    user_id, canonical_topic_id, lesson_id, lesson_completed, final_test_accuracy, last_studied_at
  )
  select v_user, v_lesson.canonical_topic_id, p_lesson, true, v_acc, now()
  where v_lesson.canonical_topic_id is not null
  on conflict (user_id, canonical_topic_id) do update
    set final_test_accuracy = excluded.final_test_accuracy,
        lesson_completed = true,
        lesson_id = excluded.lesson_id,
        last_studied_at = now();

  for v_item in select * from jsonb_array_elements(coalesce(p_anchors, '[]'::jsonb))
  loop
    insert into public.user_memory_anchor_mastery (
      user_id, lesson_id, visual_anchor, correct_count, attempt_count, mastery
    ) values (
      v_user, p_lesson,
      coalesce(v_item->>'visual_anchor', 'anchor'),
      coalesce((v_item->>'correct')::int, 0),
      coalesce((v_item->>'attempted')::int, 1),
      case when coalesce((v_item->>'attempted')::int, 0) > 0
        then (v_item->>'correct')::numeric / (v_item->>'attempted')::numeric
        else 0 end
    )
    on conflict (user_id, lesson_id, visual_anchor) do update
      set correct_count = public.user_memory_anchor_mastery.correct_count + excluded.correct_count,
          attempt_count = public.user_memory_anchor_mastery.attempt_count + excluded.attempt_count,
          mastery = (public.user_memory_anchor_mastery.correct_count + excluded.correct_count)::numeric
            / greatest(public.user_memory_anchor_mastery.attempt_count + excluded.attempt_count, 1),
          updated_at = now();
  end loop;

  if v_lesson.canonical_topic_id is not null then
    perform public.schedule_memory_reviews(v_user, p_lesson, v_lesson.canonical_topic_id, v_acc < 0.5);
    perform public.recompute_topic_mastery(v_user, v_lesson.canonical_topic_id, p_lesson);
  end if;

  return jsonb_build_object(
    'accuracy', v_acc,
    'objectives', coalesce(p_objectives, '[]'::jsonb),
    'scheduled', true
  );
end;
$$;

create or replace function public.get_student_review_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  update public.user_review_queue
  set status = 'ready'
  where user_id = v_user and status = 'scheduled' and scheduled_at <= now();

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.scheduled_at)
    from (
      select q.id, q.lesson_id, q.canonical_topic_id, q.review_type, q.scheduled_at, q.status,
             l.title as lesson_title, l.topic, l.subject
      from public.user_review_queue q
      join public.memory_lessons l on l.id = q.lesson_id
      where q.user_id = v_user and q.status in ('scheduled', 'ready')
      order by q.scheduled_at
      limit 20
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.complete_memory_review(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.user_review_queue%rowtype;
  v_xp jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_row from public.user_review_queue where id = p_id and user_id = v_user;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  update public.user_review_queue
  set status = 'completed', completed_at = now()
  where id = p_id;
  update public.user_topic_mastery
  set review_accuracy = coalesce(review_accuracy, 0.8)
  where user_id = v_user and canonical_topic_id = v_row.canonical_topic_id;
  perform public.recompute_topic_mastery(v_user, v_row.canonical_topic_id, v_row.lesson_id);
  v_xp := public.award_xp(v_user, 10, 'lesson', 'memory_review', p_id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'xp', v_xp);
end;
$$;

create or replace function public.get_student_lesson_cards(p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.sort_order)
    from (
      select
        c.*,
        p.completed as narration_completed,
        p.last_position_ms,
        p.checkpoint_correct,
        p.checkpoint_total,
        m.mastery_score,
        m.next_review_at,
        exists (
          select 1 from public.user_review_queue r
          where r.user_id = v_user and r.lesson_id = c.lesson_id
            and r.status in ('scheduled', 'ready') and r.scheduled_at <= now() + interval '1 day'
        ) as review_due
      from public.get_student_curriculum(p_exam_id) c
      left join public.memory_lesson_progress p
        on p.lesson_id = c.lesson_id and p.user_id = v_user
      left join public.user_topic_mastery m
        on m.canonical_topic_id = c.canonical_topic_id and m.user_id = v_user
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_next_published_memory_lesson(p_lesson uuid, p_exam_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_cur record;
  v_next jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_cur
  from public.get_student_curriculum(p_exam_id)
  where lesson_id = p_lesson;
  if not found then return null; end if;
  select jsonb_build_object(
    'lesson_id', lesson_id,
    'lesson_title', lesson_title,
    'topic_name', topic_name,
    'canonical_topic_id', canonical_topic_id
  ) into v_next
  from public.get_student_curriculum(p_exam_id)
  where lesson_id is not null
    and sort_order > v_cur.sort_order
  order by sort_order
  limit 1;
  return v_next;
end;
$$;

create or replace function public.log_memory_lesson_started(p_lesson uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  insert into public.memory_lesson_progress (user_id, lesson_id, started_logged)
  values (v_user, p_lesson, true)
  on conflict (user_id, lesson_id) do update
    set started_logged = true, updated_at = now();
end;
$$;

grant execute on function public.recompute_topic_mastery(uuid, uuid, uuid) to service_role;
grant execute on function public.touch_memory_lesson_progress(uuid, int, int) to authenticated;
grant execute on function public.submit_lesson_checkpoint(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.complete_memory_lesson_narration(uuid) to authenticated;
grant execute on function public.schedule_memory_reviews(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.complete_memory_lesson_final(uuid, int, int, jsonb, jsonb) to authenticated;
grant execute on function public.get_student_review_queue() to authenticated;
grant execute on function public.complete_memory_review(uuid) to authenticated;
grant execute on function public.get_student_lesson_cards(uuid) to authenticated;
grant execute on function public.get_next_published_memory_lesson(uuid, uuid) to authenticated;
grant execute on function public.log_memory_lesson_started(uuid) to authenticated;
