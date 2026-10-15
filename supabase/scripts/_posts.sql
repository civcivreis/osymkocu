select p.created_at, pr.display_name, left(p.body, 140) as body
from public.social_posts p
join public.profiles pr on pr.id = p.user_id
where p.created_at > now() - interval '2 hours'
order by p.created_at desc
limit 6;
