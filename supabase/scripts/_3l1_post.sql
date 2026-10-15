select p.id, pr.display_name, pr.profile_type::text, p.body, p.kind, p.created_at, p.expires_at,
  (select count(*) from post_likes l where l.post_id = p.id) as likes,
  (select count(*) from post_comments c where c.post_id = p.id) as comments
from social_posts p
join profiles pr on pr.id = p.user_id
where p.id = 'c92bcb8b-31df-45a7-a187-309fc034ad3f';
