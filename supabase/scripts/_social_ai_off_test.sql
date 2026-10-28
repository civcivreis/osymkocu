update public.virtual_ai_budget_policy set enabled = false, updated_at = now() where id = 1;
update public.virtual_student_engine_settings
set virtual_students_enabled = true,
    virtual_social_enabled = true,
    deterministic_social_only = true,
    updated_at = now()
where id = 1;

select public.virtual_deterministic_social_tick() as tick;

select
  (select count(*) from public.virtual_student_profiles where is_enabled) as enabled_virtual,
  (select count(*) from public.social_posts where created_at > now() - interval '15 minutes') as posts_15m,
  (select count(*) from public.post_likes where created_at > now() - interval '15 minutes') as likes_15m,
  (select count(*) from public.post_comments where created_at > now() - interval '15 minutes') as comments_15m,
  (select count(*) from public.study_presence where heartbeat_at > now() - interval '3 minutes' and status is distinct from 'offline') as live_presence,
  (select enabled from public.virtual_ai_budget_policy where id = 1) as ai_enabled,
  (select deterministic_social_only from public.virtual_student_engine_settings where id = 1) as deterministic_only;

select sp.body, pr.display_name, pr.profile_type
from public.social_posts sp
join public.profiles pr on pr.id = sp.user_id
where sp.created_at > now() - interval '30 minutes'
order by sp.created_at desc
limit 8;
