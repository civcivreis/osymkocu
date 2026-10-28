select
  (select count(*) from public.virtual_student_profiles where is_enabled) as enabled_virtual,
  (select count(*) from public.social_posts where created_at > now() - interval '20 minutes') as posts_20m,
  (select count(*) from public.post_likes where created_at > now() - interval '20 minutes') as likes_20m,
  (select count(*) from public.post_comments where created_at > now() - interval '20 minutes') as comments_20m,
  (select count(*) from public.user_follows where created_at > now() - interval '20 minutes') as follows_20m,
  (select count(*) from public.study_presence where heartbeat_at > now() - interval '3 minutes' and status is distinct from 'offline') as live_presence,
  (select enabled from public.virtual_ai_budget_policy where id = 1) as ai_enabled,
  (select deterministic_social_only from public.virtual_student_engine_settings where id = 1) as deterministic_only,
  (select virtual_social_enabled from public.virtual_student_engine_settings where id = 1) as social_enabled;

select c.body, pr.display_name
from public.post_comments c
join public.profiles pr on pr.id = c.user_id
where c.created_at > now() - interval '20 minutes'
order by c.created_at desc
limit 6;
