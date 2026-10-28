-- Live social TTL: 6h posts, 12h achievements, 24h stories. DMs/chats untouched.

alter table public.virtual_student_engine_settings
  add column if not exists story_ttl_hours int not null default 24,
  add column if not exists achievement_post_ttl_hours int not null default 12;

update public.virtual_student_engine_settings
set social_post_ttl_hours = 6,
    story_ttl_hours = coalesce(story_ttl_hours, 24),
    achievement_post_ttl_hours = coalesce(achievement_post_ttl_hours, 12),
    updated_at = now()
where id = 1;

alter table public.virtual_student_engine_settings
  alter column social_post_ttl_hours set default 6;

create or replace function public.social_post_ttl_hours()
returns int
language sql
stable
as $eng$
  select greatest(1, least(24, coalesce((select social_post_ttl_hours from public.virtual_student_engine_settings where id = 1), 6)));
$eng$;

create or replace function public.story_ttl_hours()
returns int
language sql
stable
as $eng$
  select greatest(12, least(48, coalesce((select story_ttl_hours from public.virtual_student_engine_settings where id = 1), 24)));
$eng$;

create or replace function public.achievement_post_ttl_hours()
returns int
language sql
stable
as $eng$
  select greatest(1, least(24, coalesce((select achievement_post_ttl_hours from public.virtual_student_engine_settings where id = 1), 12)));
$eng$;

create or replace function public.social_feed_ttl_hours(p_content_type text, p_feed_kind text, p_kind text default null, p_event text default null)
returns int
language plpgsql
stable
as $eng$
begin
  if coalesce(p_content_type, 'post') = 'story' then
    return public.story_ttl_hours();
  end if;
  if coalesce(p_feed_kind, '') = 'ACHIEVEMENT'
     or coalesce(p_kind, '') = 'activity'
     or coalesce(p_event, '') in ('PACKAGE_COMPLETE', 'DAILY_GOAL') then
    return public.achievement_post_ttl_hours();
  end if;
  return public.social_post_ttl_hours();
end;
$eng$;

create or replace function public.social_post_expiry_guard()
returns trigger
language plpgsql
as $eng$
declare
  v_hours int;
begin
  new.content_type := coalesce(nullif(new.content_type, ''), 'post');
  new.feed_kind := coalesce(nullif(new.feed_kind, ''), 'TEXT');
  if new.kind = 'activity' and new.feed_kind = 'TEXT' then
    new.feed_kind := 'ACHIEVEMENT';
  end if;
  v_hours := public.social_feed_ttl_hours(new.content_type, new.feed_kind, new.kind, new.event_kind);
  if tg_op = 'INSERT' or new.expires_at is null then
    new.expires_at := coalesce(new.created_at, now()) + make_interval(hours => v_hours);
  end if;
  return new;
end;
$eng$;

drop trigger if exists trg_social_post_expiry_guard on public.social_posts;
create trigger trg_social_post_expiry_guard
before insert or update of expires_at, content_type, feed_kind, kind, event_kind on public.social_posts
for each row execute procedure public.social_post_expiry_guard();

update public.social_posts
set expires_at = created_at + make_interval(hours => public.social_feed_ttl_hours(content_type, feed_kind, kind, event_kind))
where coalesce(content_type, 'post') = 'post';

update public.social_posts
set deleted_at = coalesce(deleted_at, now())
where coalesce(content_type, 'post') = 'post'
  and deleted_at is null
  and expires_at is not null
  and expires_at <= now();

create or replace function public.social_post_is_live(p_id uuid)
returns boolean
language sql
stable
as $eng$
  select exists (
    select 1 from public.social_posts p
    where p.id = p_id
      and coalesce(p.content_type, 'post') = 'post'
      and p.deleted_at is null
      and p.expires_at is not null
      and p.expires_at > now()
  );
$eng$;

create or replace function public.cleanup_expired_social_feed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  n_soft int := 0;
  n_hard int := 0;
  n_jobs int := 0;
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
      where p.id = c.post_id
        and (p.deleted_at is not null or (p.expires_at is not null and p.expires_at <= now()))
    );

  update public.virtual_social_actions a
  set status = 'skipped', executed_at = coalesce(a.executed_at, now())
  where a.status = 'queued'
    and a.action_type in ('LIKE', 'COMMENT')
    and not public.social_post_is_live(a.target_id);
  get diagnostics n_jobs = row_count;

  update public.virtual_social_actions a
  set status = 'skipped', executed_at = coalesce(a.executed_at, now())
  where a.status = 'queued'
    and a.action_type = 'REPLY'
    and not exists (
      select 1 from public.post_comments c
      where c.id = a.target_id and public.social_post_is_live(c.post_id)
    );

  delete from public.post_likes l
  using public.social_posts p
  where l.post_id = p.id
    and p.deleted_at is not null
    and p.deleted_at < now() - interval '6 hours';

  delete from public.post_comments c
  where c.deleted_at is not null and c.deleted_at < now() - interval '6 hours';

  delete from public.social_posts
  where deleted_at is not null
    and deleted_at < now() - interval '6 hours'
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

  return jsonb_build_object('soft', n_soft, 'hard', n_hard, 'jobs_skipped', n_jobs, 'r2_keys', to_jsonb(v_keys));
end;
$eng$;

select public.cleanup_expired_social_feed();

do $cron$
begin
  perform cron.unschedule('kocum-social-cleanup');
exception when others then null;
end
$cron$;
do $cron$
begin
  perform cron.schedule('kocum-social-cleanup', '*/30 * * * *', 'select public.cleanup_expired_social_feed()');
exception when others then null;
end
$cron$;

create or replace function public.get_social_feed()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $eng$
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
        and p.expires_at > now()
        and coalesce(a.profile_type::text, 'human') not in ('system')
        and not exists (select 1 from public.user_blocks b where b.blocker_id = v_user and b.blocked_id = p.user_id)
      order by p.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end;
$eng$;

create or replace function public.get_profile_card(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $eng$
declare
  v_me uuid := auth.uid();
  v_from date := (timezone('Europe/Istanbul', now()))::date - 6;
  v_row jsonb;
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  if p_user is null then raise exception 'NOT_FOUND'; end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_me and blocked_id = p_user)
       or (blocker_id = p_user and blocked_id = v_me)
  ) then
    raise exception 'BLOCKED';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'display_tag', p.display_tag,
    'bio', p.bio,
    'exam_id', p.exam_id,
    'exam_name', e.name,
    'exam_year', p.exam_year,
    'target_score', p.target_score,
    'current_xp', p.current_xp,
    'is_private', coalesce(p.is_private, false),
    'is_bot', coalesce(p.is_bot, false),
    'profile_type', p.profile_type,
    'show_study_status_social', coalesce(p.show_study_status_social, true),
    'streak', coalesce(st.current_streak, 0),
    'follower_count', (
      select count(*)::int from public.user_follows f
      where f.followed_user_id = p.id and f.status = 'active'
    ),
    'following_count', (
      select count(*)::int from public.user_follows f
      where f.follower_user_id = p.id and f.status = 'active'
    ),
    'i_follow', exists (
      select 1 from public.user_follows f
      where f.follower_user_id = v_me and f.followed_user_id = p.id and f.status = 'active'
    ),
    'follow_pending', exists (
      select 1 from public.user_follows f
      where f.follower_user_id = v_me and f.followed_user_id = p.id and f.status = 'pending'
    ),
    'follows_me', exists (
      select 1 from public.user_follows f
      where f.follower_user_id = p.id and f.followed_user_id = v_me and f.status = 'active'
    ),
    'has_story', exists (
      select 1 from public.stories s
      where s.user_id = p.id
        and s.deleted_at is null
        and s.status = 'active'
        and s.expires_at > now()
    ),
    'week_questions', (
      select count(*)::int from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'week_ms', (
      select coalesce(sum(a.time_spent_ms), 0)::bigint from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'week_active', (
      select count(distinct (timezone('Europe/Istanbul', a.created_at))::date)::int
      from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'week_correct', (
      select count(*)::int from public.question_attempts a
      where a.user_id = p.id and a.is_correct
        and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'top_subject', (
      select sub.name
      from public.question_attempts a
      join public.questions q on q.id = a.question_id
      join public.subjects sub on sub.id = q.subject_id
      where a.user_id = p.id
        and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
      group by sub.name
      order by count(*) desc
      limit 1
    ),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name))
      from (
        select sub.id, sub.name, count(*) as n
        from public.question_attempts a
        join public.questions q on q.id = a.question_id
        join public.subjects sub on sub.id = q.subject_id
        where a.user_id = p.id
          and a.created_at > now() - interval '30 days'
        group by sub.id, sub.name
        order by n desc
        limit 6
      ) x
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select
          p2.id,
          p2.body,
          p2.kind,
          p2.created_at,
          sub.name as subject_name,
          (select count(*) from public.post_likes l where l.post_id = p2.id)::int as like_count,
          (select count(*) from public.post_comments c where c.post_id = p2.id and c.deleted_at is null)::int as comment_count
        from public.social_posts p2
        left join public.subjects sub on sub.id = p2.subject_id
        where p2.user_id = p.id
          and p2.kind in ('status', 'ask', 'activity')
          and public.social_post_is_live(p2.id)
          and not exists (
            select 1 from public.social_posts d
            where d.user_id = p2.user_id
              and d.body = p2.body
              and d.id <> p2.id
              and d.created_at > p2.created_at
              and d.created_at <= p2.created_at + interval '10 minutes'
          )
        order by p2.created_at desc
        limit 12
      ) x
    ), '[]'::jsonb),
    'live_study', public.live_study_status_for(p.id, v_me)
  )
  into v_row
  from public.profiles p
  left join public.exams e on e.id = p.exam_id
  left join public.streaks st on st.user_id = p.id
  where p.id = p_user;

  if v_row is null then raise exception 'NOT_FOUND'; end if;
  return v_row;
end;
$eng$;

create or replace function public.virtual_comment_on_post(p_profile uuid, p_post uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_post record;
  v_picked record;
  v_ckind text;
  v_id uuid;
  v_score int;
begin
  if not public.social_post_is_live(p_post) then
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_comment_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  select sp.id, sp.user_id, sp.body, sp.event_kind, sp.feed_kind, sp.subject_id, sub.name as subject_name, t.name as topic_name
  into v_post
  from public.social_posts sp
  left join public.subjects sub on sub.id = sp.subject_id
  left join public.topics t on t.id = sp.topic_id
  where sp.id = p_post and sp.deleted_at is null and sp.expires_at > now();
  if v_post.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;
  if v_post.user_id = p_profile then return jsonb_build_object('ok', false, 'reason', 'SELF'); end if;
  if exists (select 1 from public.post_comments c where c.post_id = p_post and c.user_id = p_profile and c.deleted_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'DUP');
  end if;
  if (
    select count(*) from public.post_comments c
    join public.virtual_student_profiles vp on vp.profile_id = c.user_id
    where c.post_id = p_post and c.deleted_at is null
  ) >= coalesce(v_cfg.social_max_virtual_comments_per_post, 3) then
    return jsonb_build_object('ok', false, 'reason', 'BUDGET');
  end if;
  if exists (
    select 1 from public.post_comments c
    join public.social_posts sp on sp.id = c.post_id
    where c.user_id = p_profile and sp.user_id = v_post.user_id and c.created_at > now() - interval '10 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'AUTHOR_COOLDOWN');
  end if;

  v_ckind := public.infer_social_comment_kind(v_post.event_kind, v_post.feed_kind, v_post.body);
  begin
    v_score := (regexp_match(coalesce(v_post.body, ''), '(\d+)\s*/\s*\d+'))[1]::int;
  exception when others then
    v_score := null;
  end;
  select * into v_picked from public.pick_virtual_social_template(p_profile, v_ckind, v_post.subject_name, v_post.topic_name, v_score, null);
  if v_picked.body is null then
    select * into v_picked from public.pick_virtual_social_template(p_profile, 'COMMENT_GENERIC', v_post.subject_name, v_post.topic_name, v_score, null);
  end if;
  if v_picked.body is null then return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE'); end if;
  if lower(regexp_replace(v_picked.body, '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(v_post.body, ''), '\s+', ' ', 'g')) then
    return jsonb_build_object('ok', false, 'reason', 'COPY');
  end if;

  insert into public.post_comments (post_id, user_id, body)
  values (p_post, p_profile, v_picked.body)
  returning id into v_id;
  perform public.notify_post_comment_social(p_post, p_profile, v_id);
  return jsonb_build_object('ok', true, 'comment_id', v_id, 'kind', v_ckind);
end;
$eng$;

create or replace function public.execute_virtual_social_action(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v public.virtual_social_actions%rowtype;
  v_res jsonb;
begin
  select * into v from public.virtual_social_actions where id = p_id and status = 'queued' for update skip locked;
  if not found then return jsonb_build_object('ok', false, 'reason', 'GONE'); end if;
  if v.action_type in ('LIKE', 'COMMENT') and not public.social_post_is_live(v.target_id) then
    update public.virtual_social_actions set executed_at = now(), status = 'skipped' where id = p_id;
    return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
  end if;
  if v.action_type = 'LIKE' then
    insert into public.post_likes (post_id, user_id) values (v.target_id, v.profile_id) on conflict do nothing;
    perform public.notify_grouped_post_like(v.target_id, v.profile_id);
    v_res := jsonb_build_object('ok', true);
  elsif v.action_type = 'COMMENT' then
    v_res := public.virtual_comment_on_post(v.profile_id, v.target_id);
  elsif v.action_type = 'REPLY' then
    v_res := public.virtual_reply_to_comment(v.profile_id, v.target_id);
  elsif v.action_type = 'FOLLOW' then
    if v.target_id is not null then
      v_res := public.virtual_follow_user(v.profile_id, v.target_id);
    else
      v_res := public.virtual_try_social_follow(v.profile_id);
    end if;
  elsif v.action_type = 'UNFOLLOW' then
    v_res := public.virtual_try_social_unfollow(v.profile_id);
  elsif v.action_type = 'STUDY_REQUEST' then
    v_res := public.virtual_send_study_request(v.profile_id, v.target_id, v.payload);
  elsif v.action_type = 'POST' then
    v_res := public.virtual_try_social_post(v.profile_id);
  else
    v_res := jsonb_build_object('ok', false, 'reason', 'SKIP_IMAGE');
  end if;
  update public.virtual_social_actions
  set executed_at = now(),
      status = case when coalesce((v_res->>'ok')::boolean, false) then 'done' else 'skipped' end
  where id = p_id;
  return v_res;
end;
$eng$;

drop function if exists public.admin_set_virtual_social(boolean, boolean, int, int, int, boolean, boolean, boolean, boolean, boolean, boolean, int, int, int, int, int, numeric, boolean);

create or replace function public.admin_set_virtual_social(
  p_enabled boolean default null,
  p_deterministic_only boolean default null,
  p_post_interval int default null,
  p_comment_interval int default null,
  p_like_interval int default null,
  p_text boolean default null,
  p_image boolean default null,
  p_like boolean default null,
  p_comment boolean default null,
  p_follow boolean default null,
  p_image_ai boolean default null,
  p_ttl_hours int default null,
  p_image_per_day int default null,
  p_max_likes_post int default null,
  p_max_comments_post int default null,
  p_max_follows_window int default null,
  p_human_share numeric default null,
  p_study_request boolean default null,
  p_story_ttl int default null,
  p_achievement_ttl int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
begin
  perform public.require_admin();
  update public.virtual_student_engine_settings
  set virtual_social_enabled = coalesce(p_enabled, virtual_social_enabled),
      deterministic_social_only = coalesce(p_deterministic_only, deterministic_social_only),
      social_post_interval_minutes = coalesce(p_post_interval, social_post_interval_minutes),
      social_comment_interval_minutes = coalesce(p_comment_interval, social_comment_interval_minutes),
      social_like_interval_minutes = coalesce(p_like_interval, social_like_interval_minutes),
      social_text_enabled = coalesce(p_text, social_text_enabled),
      social_image_enabled = coalesce(p_image, social_image_enabled),
      social_like_enabled = coalesce(p_like, social_like_enabled),
      social_comment_enabled = coalesce(p_comment, social_comment_enabled),
      social_follow_enabled = coalesce(p_follow, social_follow_enabled),
      social_image_ai_enabled = coalesce(p_image_ai, social_image_ai_enabled),
      social_post_ttl_hours = coalesce(p_ttl_hours, social_post_ttl_hours),
      social_image_per_day = coalesce(p_image_per_day, social_image_per_day),
      social_max_virtual_likes_per_post = coalesce(p_max_likes_post, social_max_virtual_likes_per_post),
      social_max_virtual_comments_per_post = coalesce(p_max_comments_post, social_max_virtual_comments_per_post),
      social_max_virtual_follows_per_user_window = coalesce(p_max_follows_window, social_max_virtual_follows_per_user_window),
      social_human_engagement_share = coalesce(p_human_share, social_human_engagement_share),
      social_study_request_enabled = coalesce(p_study_request, social_study_request_enabled),
      story_ttl_hours = coalesce(p_story_ttl, story_ttl_hours),
      achievement_post_ttl_hours = coalesce(p_achievement_ttl, achievement_post_ttl_hours),
      updated_at = now()
  where id = 1;
  return (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1);
end;
$eng$;

grant execute on function public.get_social_feed() to authenticated;
grant execute on function public.get_profile_card(uuid) to authenticated;
grant execute on function public.social_post_is_live(uuid) to authenticated, service_role;
grant execute on function public.cleanup_expired_social_feed() to service_role;
grant execute on function public.admin_set_virtual_social(boolean, boolean, int, int, int, boolean, boolean, boolean, boolean, boolean, boolean, int, int, int, int, int, numeric, boolean, int, int) to authenticated;

notify pgrst, 'reload schema';
