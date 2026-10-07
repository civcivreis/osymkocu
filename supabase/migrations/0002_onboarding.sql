-- Phase 2: onboarding RPC. Client cannot mark onboarding complete by itself.

create or replace function public.protect_profile_progress()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.current_xp := old.current_xp;
    new.league_tier := old.league_tier;
    new.onboarding_completed_at := old.onboarding_completed_at;
  end if;
  return new;
end;
$$;

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
    'Hedefine ve zayıf derslerine göre hazırlanan ilk günlük plan.'
  )
  on conflict (user_id, plan_date) do update
    set target_minutes = excluded.target_minutes,
        target_questions = excluded.target_questions,
        summary = excluded.summary
  returning id into v_plan;

  delete from public.study_tasks where plan_id = v_plan;

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
      order by sub.sort_order
    )
    select es.id, es.name
    from exam_subjects es
    left join preferred p on p.subject_id = es.id
    order by (p.subject_id is not null) desc, es.name
    limit 3
  loop
    v_sort := v_sort + 1;
    insert into public.study_tasks (plan_id, user_id, title, subject_id, question_count, sort_order)
    values (v_plan, v_user, r.name || ' – 20 soru', r.id, 20, v_sort);
  end loop;

  v_sort := v_sort + 1;
  insert into public.study_tasks (plan_id, user_id, title, question_count, sort_order)
  values (v_plan, v_user, '10 yanlış tekrar', 10, v_sort);

  v_sort := v_sort + 1;
  insert into public.study_tasks (plan_id, user_id, title, question_count, sort_order)
  values (v_plan, v_user, 'Mini deneme', 20, v_sort);

  return v_plan;
end;
$$;

create or replace function public.save_onboarding(
  p_exam_id uuid,
  p_exam_date date,
  p_daily_minutes int,
  p_target_score numeric,
  p_target_tyt_net numeric,
  p_target_ayt_net numeric,
  p_target_kpss_score numeric,
  p_strong uuid[],
  p_weak uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_daily_minutes < 20 or p_daily_minutes > 360 then
    raise exception 'INVALID_MINUTES';
  end if;

  if p_exam_date < (timezone('Europe/Istanbul', now()))::date then
    raise exception 'INVALID_EXAM_DATE';
  end if;

  if not exists (select 1 from public.exams where id = p_exam_id) then
    raise exception 'EXAM_NOT_FOUND';
  end if;

  update public.profiles
  set exam_id = p_exam_id,
      exam_date = p_exam_date,
      daily_minutes = p_daily_minutes,
      target_score = p_target_score,
      onboarding_completed_at = now()
  where id = v_user;

  insert into public.user_exam_settings (
    user_id, exam_id, target_tyt_net, target_ayt_net, target_kpss_score,
    perceived_strong_subject_ids, perceived_weak_subject_ids
  )
  values (
    v_user, p_exam_id, p_target_tyt_net, p_target_ayt_net, p_target_kpss_score,
    coalesce(p_strong, '{}'), coalesce(p_weak, '{}')
  )
  on conflict (user_id) do update
    set exam_id = excluded.exam_id,
        target_tyt_net = excluded.target_tyt_net,
        target_ayt_net = excluded.target_ayt_net,
        target_kpss_score = excluded.target_kpss_score,
        perceived_strong_subject_ids = excluded.perceived_strong_subject_ids,
        perceived_weak_subject_ids = excluded.perceived_weak_subject_ids;

  perform public.generate_today_plan();
end;
$$;

revoke all on function public.save_onboarding(uuid, date, int, numeric, numeric, numeric, numeric, uuid[], uuid[]) from public;
revoke all on function public.generate_today_plan() from public;
grant execute on function public.save_onboarding(uuid, date, int, numeric, numeric, numeric, numeric, uuid[], uuid[]) to authenticated;
grant execute on function public.generate_today_plan() to authenticated;
