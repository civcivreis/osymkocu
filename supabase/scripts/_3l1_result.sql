select p.id, pr.display_name, pr.profile_type::text, p.body, p.created_at, p.expires_at,
  (select count(*) from post_likes l where l.post_id = p.id) as likes,
  (select count(*) from post_comments c where c.post_id = p.id) as comments
from social_posts p
join profiles pr on pr.id = p.user_id
where p.created_at > now() - interval '2 hours'
order by p.created_at desc
limit 10;

select j.activity_type, j.status, j.error_text, j.context, j.completed_at
from virtual_student_activity_jobs j
join profiles p on p.id = j.profile_id
where j.created_at > now() - interval '20 minutes'
order by j.created_at desc
limit 8;
