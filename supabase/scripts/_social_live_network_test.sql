update public.virtual_ai_budget_policy set enabled = false, updated_at = now() where id = 1;
update public.virtual_student_engine_settings
set virtual_students_enabled = true,
    virtual_social_enabled = true,
    deterministic_social_only = true,
    social_text_enabled = true,
    social_image_enabled = true,
    social_like_enabled = true,
    social_comment_enabled = true,
    social_follow_enabled = true,
    social_image_ai_enabled = false,
    social_post_ttl_hours = 72,
    updated_at = now()
where id = 1;

select public.virtual_deterministic_social_tick() as tick_1;
select public.virtual_deterministic_social_tick() as tick_2;
select public.virtual_deterministic_social_tick() as tick_3;
select public.virtual_deterministic_social_tick() as tick_4;
select public.virtual_deterministic_social_tick() as tick_5;
select public.virtual_deterministic_social_tick() as tick_6;
select public.virtual_deterministic_social_tick() as tick_7;
select public.virtual_deterministic_social_tick() as tick_8;

select
  (select count(*) from public.virtual_student_profiles where is_enabled) as enabled_virtual,
  (select count(*) from public.virtual_student_profiles vp where vp.is_enabled and public.virtual_profile_is_active(vp.profile_id)) as active_now,
  (select count(*) from public.social_posts where created_at > now() - interval '30 minutes' and coalesce(content_type,'post')='post') as posts_30m,
  (select count(*) from public.post_likes where created_at > now() - interval '30 minutes') as likes_30m,
  (select count(*) from public.post_comments where created_at > now() - interval '30 minutes') as comments_30m,
  (select count(*) from public.user_follows where created_at > now() - interval '30 minutes') as follows_30m,
  (select count(*) from public.virtual_social_actions where created_at > now() - interval '30 minutes') as scheduled_30m,
  (select enabled from public.virtual_ai_budget_policy where id = 1) as ai_enabled,
  (select deterministic_social_only from public.virtual_student_engine_settings where id = 1) as deterministic_only,
  (select social_image_ai_enabled from public.virtual_student_engine_settings where id = 1) as image_ai,
  (select claim_social_scene_generation()) as scene_claim;

select feed_kind, count(*) from public.social_posts
where created_at > now() - interval '2 hours' and deleted_at is null
group by 1;

select
  percentile_cont(0.5) within group (order by like_count) as like_p50,
  max(like_count) as like_max,
  min(like_count) as like_min,
  max(comment_count) as comment_max
from (
  select
    (select count(*) from public.post_likes l where l.post_id = p.id) as like_count,
    (select count(*) from public.post_comments c where c.post_id = p.id and c.deleted_at is null) as comment_count
  from public.social_posts p
  where p.deleted_at is null and coalesce(p.content_type,'post')='post' and p.created_at > now() - interval '72 hours'
) s;

insert into public.social_posts (user_id, body, kind, content_type, expires_at)
select vp.profile_id, 'expiry probe', 'status', 'post', now() - interval '1 minute'
from public.virtual_student_profiles vp
where vp.is_enabled
limit 1
returning id, expires_at, created_at, (expires_at - created_at) as ttl;

select public.cleanup_expired_social_feed() as cleanup_after_probe;

select count(*) as expired_probe_still_visible
from public.social_posts
where body = 'expiry probe' and deleted_at is null and (expires_at is null or expires_at > now());

select
  (select count(*) from public.stories where deleted_at is null and expires_at > now() and expires_at < now() + interval '25 hours') as live_stories_24h_window,
  (select count(*) from public.dm_messages where created_at > now() - interval '7 days') as dm_last_7d;

select sp.body, sp.feed_kind, sp.event_kind, sp.expires_at, pr.display_name
from public.social_posts sp
join public.profiles pr on pr.id = sp.user_id
where sp.deleted_at is null and coalesce(sp.content_type,'post')='post'
order by sp.created_at desc
limit 10;
