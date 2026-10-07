-- Ensure save_onboarding can insert user_exam_settings even if the profile
-- row was missing (auth user exists, handle_new_user missed).

create or replace function public.save_onboarding(
  p_exam_id uuid,
  p_exam_date date,
  p_daily_minutes int,
  p_target_score numeric,
  p_target_tyt_net numeric,
  p_target_ayt_net numeric,
  p_target_kpss_score numeric,
  p_strong uuid[],
  p_weak uuid[],
  p_exam_year int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_daily_minutes < 20 or p_daily_minutes > 360 then
    raise exception 'INVALID_MINUTES';
  end if;

  if p_exam_date is not null and p_exam_date < (timezone('Europe/Istanbul', now()))::date then
    raise exception 'INVALID_EXAM_DATE';
  end if;

  if not exists (select 1 from public.exams where id = p_exam_id) then
    raise exception 'EXAM_NOT_FOUND';
  end if;

  select coalesce(nullif(trim(u.raw_user_meta_data->>'display_name'), ''), split_part(u.email, '@', 1), 'Öğrenci')
    into v_name
  from auth.users u
  where u.id = v_user;

  insert into public.profiles (id, display_name)
  values (v_user, coalesce(v_name, 'Öğrenci'))
  on conflict (id) do nothing;

  insert into public.streaks (user_id) values (v_user) on conflict do nothing;
  insert into public.user_stats (user_id) values (v_user) on conflict do nothing;
  insert into public.subscriptions (user_id, plan) values (v_user, 'free') on conflict do nothing;

  update public.profiles
  set exam_id = p_exam_id,
      exam_date = p_exam_date,
      exam_year = coalesce(p_exam_year, extract(year from p_exam_date)::int),
      daily_minutes = p_daily_minutes,
      target_score = p_target_score,
      onboarding_completed_at = now()
  where id = v_user;

  if not found then
    raise exception 'PROFILE_MISSING';
  end if;

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

revoke all on function public.save_onboarding(uuid, date, int, numeric, numeric, numeric, numeric, uuid[], uuid[], int) from public;
grant execute on function public.save_onboarding(uuid, date, int, numeric, numeric, numeric, numeric, uuid[], uuid[], int) to authenticated;

notify pgrst, 'reload schema';
