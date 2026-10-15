select count(*)::int as visible_now
from social_posts p
join profiles a on a.id = p.user_id
where (p.expires_at is null or p.expires_at > now())
  and coalesce(a.profile_type::text, 'human') not in ('system');

select p.body, pr.display_name, p.expires_at
from social_posts p
join profiles pr on pr.id = p.user_id
where p.body like '%Bugünkü hedef 38%'
order by p.created_at desc
limit 1;
