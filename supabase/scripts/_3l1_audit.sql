select p.display_name, v.social_activity_level, v.is_enabled,
  public.virtual_social_eligibility(v.profile_id) as eligibility,
  (select count(*) from social_posts s where s.user_id=v.profile_id and s.created_at>now()-interval '24 hours') as posts_24h,
  (select count(*) from post_comments c where c.user_id=v.profile_id and c.created_at>now()-interval '24 hours') as comments_24h,
  (select count(*) from post_likes l where l.user_id=v.profile_id and l.created_at>now()-interval '24 hours') as likes_24h
from virtual_student_profiles v
join profiles p on p.id=v.profile_id
where v.is_enabled
order by p.display_name
limit 20;
