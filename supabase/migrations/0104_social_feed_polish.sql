-- Pool reuse in AI-less mode, feed mix, scene generation hooks, media access, hours.

create or replace function public.virtual_stable_hours(p_profile uuid)
returns table(band text, hours_start time, hours_end time)
language sql
immutable
as $$
  select s.band, s.hours_start, s.hours_end
  from (
    values
      (0, 'morning'::text, '07:00'::time, '10:30'::time),
      (1, 'midday'::text, '11:30'::time, '14:30'::time),
      (2, 'afternoon'::text, '16:00'::time, '19:30'::time),
      (3, 'evening'::text, '20:00'::time, '00:20'::time),
      (4, 'late'::text, '21:30'::time, '02:30'::time)
  ) s(idx, band, hours_start, hours_end)
  where s.idx = mod(abs(hashtext(p_profile::text)), 5);
$$;

update public.virtual_student_profiles v
set timezone = coalesce(nullif(v.timezone, ''), 'Europe/Istanbul'),
    active_hours_start = (select hours_start from public.virtual_stable_hours(v.profile_id)),
    active_hours_end = (select hours_end from public.virtual_stable_hours(v.profile_id));

create or replace function public.user_can_access_media(p_user uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.media m
    where m.id = p_id
      and m.deleted_at is null
      and m.moderation_status = 'approved'
      and (
        m.owner_user_id = p_user
        or public.is_admin()
        or (
          m.purpose = 'story'
          and exists (
            select 1 from public.stories s
            where s.user_id = m.owner_user_id
              and s.deleted_at is null
              and s.status = 'active'
              and s.expires_at > now()
              and (s.media_id = m.id or s.image_url = 'media:' || m.id::text or s.image_url like '%' || m.id::text || '%')
          )
        )
        or (
          m.purpose = 'status_image'
          and exists (
            select 1 from public.social_posts sp
            where sp.media_id = m.id
              and sp.deleted_at is null
              and coalesce(sp.content_type, 'post') = 'post'
              and (sp.expires_at is null or sp.expires_at > now())
          )
        )
        or (
          m.purpose = 'chat_image'
          and m.conversation_id is not null
          and exists (
            select 1 from public.dm_conversations c
            where c.id = m.conversation_id
              and (c.user_a = p_user or c.user_b = p_user)
          )
        )
        or (
          m.purpose = 'chat_image'
          and m.group_slug is not null
          and exists (
            select 1 from public.exam_chat_members g
            where g.slug = m.group_slug and g.user_id = p_user
          )
        )
      )
  );
$$;

create or replace function public.virtual_try_social_post(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_prof public.virtual_student_profiles%rowtype;
  v_topic text;
  v_subject text;
  v_n int;
  v_ok int;
  v_kind text;
  v_feed text := 'TEXT';
  v_picked record;
  v_post uuid;
  v_asset public.social_scene_assets%rowtype;
  v_images_today int;
  v_want_image boolean := false;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.virtual_social_enabled is false then
    return jsonb_build_object('ok', false, 'reason', 'SOCIAL_OFF');
  end if;
  if not public.virtual_profile_is_active(p_profile) then
    return jsonb_build_object('ok', false, 'reason', 'OFF_HOURS');
  end if;
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile and is_enabled;
  if not found then return jsonb_build_object('ok', false, 'reason', 'PROFILE_DISABLED'); end if;
  if exists (
    select 1 from public.social_posts sp
    where sp.user_id = p_profile and sp.created_at > now() - interval '25 minutes'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'COOLDOWN');
  end if;

  perform public.set_virtual_presence(p_profile, 'social', v_prof.current_subject_id, v_prof.current_topic_id, null, 8);
  select name into v_subject from public.subjects where id = v_prof.current_subject_id;
  select name into v_topic from public.topics where id = v_prof.current_topic_id;
  select value->>'topic', (value->>'wrong')::int, (value->>'correct')::int
  into v_topic, v_n, v_ok
  from public.virtual_student_memory
  where profile_id = p_profile and memory_type = 'recent_test'
  order by updated_at desc limit 1;

  v_kind := case
    when v_ok is not null and v_n is not null and v_ok < greatest(3, (v_ok + coalesce(v_n, 0)) / 3) then 'LOW_SCORE'
    when v_ok is not null then 'TEST_COMPLETED'
    when random() < 0.12 then 'BREAK'
    when random() < 0.18 then 'DAILY_GOAL'
    when random() < 0.42 then 'LESSON_STARTED'
    else 'LESSON_COMPLETED'
  end;
  v_feed := case v_kind
    when 'TEST_COMPLETED' then 'TEST_RESULT'
    when 'LOW_SCORE' then 'TEST_RESULT'
    when 'LESSON_STARTED' then 'STUDY_STATUS'
    when 'PACKAGE_COMPLETE' then 'ACHIEVEMENT'
    else 'TEXT'
  end;

  v_want_image := coalesce(v_cfg.social_image_enabled, true) and random() < 0.14;
  if v_want_image then
    select count(*)::int into v_images_today
    from public.social_posts
    where feed_kind = 'IMAGE'
      and created_at::date = (timezone('Europe/Istanbul', now()))::date
      and deleted_at is null;
    if v_images_today < coalesce(v_cfg.social_image_per_day, 4) then
      select * into v_asset
      from public.social_scene_assets a
      where a.media_id is not null
        and (a.last_used_at is null or a.last_used_at < now() - interval '18 hours')
      order by a.used_count asc, random()
      limit 1;
    end if;
  end if;

  if v_asset.id is not null then
    v_kind := 'IMAGE';
    v_feed := 'IMAGE';
  elsif v_cfg.social_text_enabled is false then
    return jsonb_build_object('ok', false, 'reason', 'TEXT_OFF');
  end if;

  select * into v_picked from public.pick_virtual_social_template(
    p_profile, v_kind, v_subject, v_topic, v_ok, v_prof.daily_goal_questions
  );
  if v_picked.body is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE');
  end if;
  if public.content_moderation_level(v_picked.body) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED');
  end if;
  if exists (
    select 1 from public.social_posts sp
    where lower(regexp_replace(sp.body, '\s+', ' ', 'g')) = lower(regexp_replace(v_picked.body, '\s+', ' ', 'g'))
      and sp.created_at > now() - interval '3 hours'
      and sp.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'GLOBAL_DUP');
  end if;

  insert into public.social_posts (
    user_id, body, kind, content_type, subject_id, duration_minutes, expires_at, topic_id, feed_kind, event_kind, media_id
  )
  values (
    p_profile, v_picked.body, 'status', 'post', v_prof.current_subject_id, 60, null, v_prof.current_topic_id,
    v_feed, v_kind, v_asset.media_id
  )
  returning id into v_post;

  if v_asset.id is not null then
    update public.social_scene_assets
    set used_count = used_count + 1, last_used_at = now()
    where id = v_asset.id;
  end if;

  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_post', 1, 0, 'none', v_kind);
  perform public.schedule_post_engagement(v_post, p_profile, v_prof.current_subject_id);
  return jsonb_build_object('ok', true, 'post_id', v_post, 'body', v_picked.body, 'feed_kind', v_feed);
end;
$$;

create or replace function public.virtual_try_social_comment(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_post record;
  v_picked record;
  v_day int;
  v_ckind text;
  v_id uuid;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_comment_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  if not public.virtual_profile_is_active(p_profile) then return jsonb_build_object('ok', false, 'reason', 'OFF_HOURS'); end if;
  select count(*)::int into v_day
  from public.post_comments c
  where c.user_id = p_profile and c.created_at::date = (timezone('Europe/Istanbul', now()))::date and c.deleted_at is null;
  if v_day >= coalesce(v_cfg.social_comment_per_day, 6) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;

  select sp.id, sp.user_id, sp.subject_id, sp.event_kind, sub.name as subject_name
  into v_post
  from public.social_posts sp
  left join public.subjects sub on sub.id = sp.subject_id
  left join public.virtual_student_profiles vp on vp.profile_id = p_profile
  where sp.user_id <> p_profile
    and sp.deleted_at is null
    and coalesce(sp.content_type, 'post') = 'post'
    and (sp.expires_at is null or sp.expires_at > now())
    and sp.created_at < now() - interval '8 minutes'
    and not exists (select 1 from public.post_comments c where c.post_id = sp.id and c.user_id = p_profile and c.deleted_at is null)
    and not exists (
      select 1 from public.post_comments c
      where c.user_id = p_profile and c.post_id in (select id from public.social_posts where user_id = sp.user_id)
        and c.created_at > now() - interval '4 hours'
    )
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = sp.user_id)
         or (b.blocker_id = sp.user_id and b.blocked_id = p_profile)
    )
  order by
    (sp.subject_id is not distinct from vp.current_subject_id) desc,
    random()
  limit 1;
  if v_post.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;

  v_ckind := case coalesce(v_post.event_kind, '')
    when 'TEST_COMPLETED' then 'COMMENT_TEST'
    when 'LOW_SCORE' then 'COMMENT_LOW'
    when 'LESSON_COMPLETED' then 'COMMENT_LESSON'
    when 'LESSON_STARTED' then 'COMMENT_LESSON'
    when 'BREAK' then 'COMMENT_BREAK'
    else 'COMMENT_GENERIC'
  end;
  select * into v_picked from public.pick_virtual_social_template(p_profile, v_ckind, v_post.subject_name, null, null, null);
  if v_picked.body is null then
    select * into v_picked from public.pick_virtual_social_template(p_profile, 'COMMENT_GENERIC', v_post.subject_name, null, null, null);
  end if;
  if v_picked.body is null then return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE'); end if;
  if public.content_moderation_level(v_picked.body) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED');
  end if;

  insert into public.post_comments (post_id, user_id, body)
  values (v_post.id, p_profile, v_picked.body)
  returning id into v_id;
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_comment', 1, 0, 'none', v_ckind);
  return jsonb_build_object('ok', true, 'comment_id', v_id);
end;
$$;

create or replace function public.get_social_feed()
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
    select jsonb_agg(to_jsonb(x) - 'rank_at' order by x.rank_at desc)
    from (
      select
        p.id, p.user_id, p.body, p.kind, p.content_type, p.created_at,
        p.subject_id, p.topic_id, p.canonical_topic_id, p.session_id, p.capacity,
        p.duration_minutes, p.expires_at, p.goal_label, p.feed_kind, p.event_kind, p.media_id,
        a.display_name, a.display_tag, a.current_xp, a.is_bot, a.profile_type,
        sub.name as subject_name, t.name as topic_name, ct.name as canonical_topic_name, cu.name as unit_name,
        (select count(*) from public.post_likes l where l.post_id = p.id)::int as like_count,
        (select count(*) from public.post_comments c where c.post_id = p.id and c.deleted_at is null)::int as comment_count,
        exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = v_user) as liked_by_me,
        (
          select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
          from (
            select cm.id, cm.user_id, cm.body, cm.created_at, pr.display_name, pr.display_tag, pr.is_bot
            from public.post_comments cm
            join public.profiles pr on pr.id = cm.user_id
            where cm.post_id = p.id and cm.parent_id is null and cm.deleted_at is null
            order by cm.created_at
            limit 2
          ) c
        ) as comment_preview,
        live->>'presence_state' as live_presence_state,
        live->>'subject_name' as live_subject_name,
        live->>'topic_name' as live_topic_name,
        live->>'subject_id' as live_subject_id,
        live->>'topic_id' as live_topic_id,
        p.created_at + make_interval(mins => least(
          80,
          ((select count(*) from public.post_likes l where l.post_id = p.id)::int * 5)
          + ((select count(*) from public.post_comments c where c.post_id = p.id and c.deleted_at is null)::int * 9)
        )) as rank_at
      from public.social_posts p
      join public.profiles a on a.id = p.user_id
      left join public.subjects sub on sub.id = p.subject_id
      left join public.topics t on t.id = p.topic_id
      left join public.canonical_topics ct on ct.id = p.canonical_topic_id
      left join public.canonical_units cu on cu.id = ct.canonical_unit_id
      left join lateral public.live_study_status_for(p.user_id, v_user) live on true
      where coalesce(p.content_type, 'post') = 'post'
        and p.deleted_at is null
        and (p.expires_at is null or p.expires_at > now())
        and coalesce(a.profile_type::text, 'human') not in ('system')
        and not exists (select 1 from public.user_blocks b where b.blocker_id = v_user and b.blocked_id = p.user_id)
      order by p.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.cleanup_expired_social_feed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_soft int := 0;
  n_hard int := 0;
  v_keys text[] := '{}';
begin
  update public.social_posts
  set deleted_at = coalesce(deleted_at, now())
  where coalesce(content_type, 'post') = 'post'
    and deleted_at is null
    and expires_at is not null
    and expires_at <= now();
  get diagnostics n_soft = row_count;

  update public.post_comments c
  set deleted_at = now()
  where c.deleted_at is null
    and exists (
      select 1 from public.social_posts p
      where p.id = c.post_id and p.deleted_at is not null
    );

  delete from public.post_likes l
  using public.social_posts p
  where l.post_id = p.id and p.deleted_at is not null and p.deleted_at < now() - interval '2 days';

  delete from public.post_comments c
  where c.deleted_at is not null and c.deleted_at < now() - interval '2 days';

  delete from public.social_posts
  where deleted_at is not null
    and deleted_at < now() - interval '2 days'
    and coalesce(content_type, 'post') = 'post';
  get diagnostics n_hard = row_count;

  update public.media m
  set deleted_at = now()
  where m.purpose = 'status_image'
    and m.deleted_at is null
    and m.created_at < now() - interval '14 days'
    and not exists (select 1 from public.social_posts p where p.media_id = m.id and p.deleted_at is null)
    and not exists (select 1 from public.social_scene_assets a where a.media_id = m.id);

  select coalesce(array_agg(m.storage_key), '{}') into v_keys
  from public.media m
  where m.purpose = 'status_image'
    and m.deleted_at is not null
    and m.deleted_at > now() - interval '3 days'
    and not exists (select 1 from public.social_posts p where p.media_id = m.id)
    and not exists (select 1 from public.social_scene_assets a where a.media_id = m.id);

  return jsonb_build_object('soft', n_soft, 'hard', n_hard, 'r2_keys', to_jsonb(v_keys));
end;
$$;

create or replace function public.claim_social_scene_generation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_today int;
  v_cat text;
  v_prompt text;
  v_key text;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if not found or v_cfg.virtual_social_enabled is false then
    return jsonb_build_object('generate', false, 'reason', 'SOCIAL_OFF');
  end if;
  if v_cfg.social_image_enabled is false or v_cfg.social_image_ai_enabled is not true then
    return jsonb_build_object('generate', false, 'reason', 'IMAGE_AI_OFF');
  end if;
  if coalesce(v_cfg.deterministic_social_only, false) then
    return jsonb_build_object('generate', false, 'reason', 'DETERMINISTIC_ONLY');
  end if;
  select count(*)::int into v_today
  from public.social_scene_assets
  where generated and created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_today >= coalesce(v_cfg.social_image_per_day, 4) then
    return jsonb_build_object('generate', false, 'reason', 'DAY_CAP');
  end if;
  if exists (select 1 from public.social_scene_assets where created_at > now() - interval '3 hours') then
    return jsonb_build_object('generate', false, 'reason', 'SPACING');
  end if;

  v_cat := (array[
    'desk', 'open_book', 'notebook', 'laptop_notes', 'library',
    'coffee_test', 'night_desk', 'morning_desk', 'colored_pens', 'study_room'
  ])[1 + floor(random() * 10)::int];

  v_prompt := case v_cat
    when 'desk' then 'Photorealistic empty study desk with textbooks and a lamp, no people, no faces, no portraits, no selfie.'
    when 'open_book' then 'Photorealistic open exam textbook on a wooden table, notes beside it, no people, no faces.'
    when 'notebook' then 'Photorealistic handwritten study notebook with colorful pens, no people, no faces, no portraits.'
    when 'laptop_notes' then 'Photorealistic laptop and paper notes on a study desk, no people, no faces, no selfie.'
    when 'library' then 'Photorealistic empty library study table with stacked books, no people, no faces.'
    when 'coffee_test' then 'Photorealistic coffee cup next to a test booklet on a desk, no people, no faces.'
    when 'night_desk' then 'Photorealistic night study desk with warm lamp and papers, no people, no faces, no portraits.'
    when 'morning_desk' then 'Photorealistic morning study setup with daylight, books and tea, no people, no faces.'
    when 'colored_pens' then 'Photorealistic colorful pens and highlighted notes on paper, no people, no faces.'
    else 'Photorealistic quiet study room atmosphere with books, no people, no faces, no selfie, no portraits.'
  end;
  v_key := 'social-scenes/' || to_char(timezone('utc', now()), 'YYYYMMDD') || '/' || gen_random_uuid()::text || '.png';
  return jsonb_build_object(
    'generate', true,
    'category', v_cat,
    'prompt', v_prompt,
    'storage_key', v_key
  );
end;
$$;

create or replace function public.register_social_scene_asset(
  p_storage_key text,
  p_category text,
  p_bytes int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_media uuid;
  v_asset uuid;
begin
  select vp.profile_id into v_owner
  from public.virtual_student_profiles vp
  where vp.is_enabled
  order by vp.created_at
  limit 1;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_OWNER');
  end if;
  insert into public.media (
    owner_user_id, storage_key, purpose, mime_type, size_bytes, width, height, moderation_status
  )
  values (v_owner, p_storage_key, 'status_image', 'image/png', greatest(0, coalesce(p_bytes, 0)), 1024, 1024, 'approved')
  returning id into v_media;
  insert into public.social_scene_assets (media_id, prompt_category, generated, used_count)
  values (v_media, coalesce(nullif(p_category, ''), 'desk'), true, 0)
  returning id into v_asset;
  return jsonb_build_object('ok', true, 'media_id', v_media, 'asset_id', v_asset);
end;
$$;

grant execute on function public.claim_social_scene_generation() to service_role;
grant execute on function public.register_social_scene_asset(text, text, int) to service_role;
grant execute on function public.cleanup_expired_social_feed() to service_role;
grant execute on function public.get_social_feed() to authenticated;
grant execute on function public.user_can_access_media(uuid, uuid) to authenticated, service_role;
