-- Slow follow growth and drop leftover chat-like templates.

update public.virtual_student_engine_settings
set social_follow_per_day = least(coalesce(social_follow_per_day, 4), 2)
where id = 1;

delete from public.virtual_social_templates
where body in (
  'bitti',
  'su içip dönüyorum',
  'konuyu kapattım, nefes',
  'mola, sonra tempo',
  '{subject} bugün uğraştırdı'
)
or (char_length(trim(body)) < 10 and event_kind not like 'COMMENT%' and event_kind <> 'IMAGE');

create or replace function public.virtual_try_social_follow(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_other uuid;
  v_day int;
  v_exam uuid;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_follow_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  if not public.virtual_profile_is_active(p_profile) then return jsonb_build_object('ok', false, 'reason', 'OFF_HOURS'); end if;
  if random() < 0.72 then return jsonb_build_object('ok', false, 'reason', 'SKIP_PACE'); end if;
  select count(*)::int into v_day
  from public.user_follows f
  where f.follower_user_id = p_profile and f.created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_day >= coalesce(v_cfg.social_follow_per_day, 2) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;
  if exists (
    select 1 from public.user_follows f
    where f.follower_user_id = p_profile and f.created_at > now() - interval '3 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'COOLDOWN');
  end if;
  select exam_id into v_exam from public.profiles where id = p_profile;

  select p.id into v_other
  from public.profiles p
  where p.id <> p_profile
    and coalesce(p.profile_type::text, 'human') = 'virtual'
    and not exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = p.id)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = p_profile)
    )
  order by (p.exam_id is not distinct from v_exam) desc, random()
  limit 1;

  if v_other is null and random() < 0.12 then
    select p.id into v_other
    from public.profiles p
    join public.social_posts sp on sp.user_id = p.id
    where coalesce(p.profile_type::text, 'human') = 'human'
      and p.id <> p_profile
      and sp.created_at > now() - interval '6 hours'
      and sp.deleted_at is null
      and not exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = p.id)
    order by random()
    limit 1;
  end if;
  if v_other is null then return jsonb_build_object('ok', false, 'reason', 'NO_TARGET'); end if;

  insert into public.user_follows (follower_user_id, followed_user_id, status)
  values (p_profile, v_other, 'active')
  on conflict do nothing;
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_follow', 1, 0, 'none', 'template');
  return jsonb_build_object('ok', true, 'other', v_other);
end;
$$;
