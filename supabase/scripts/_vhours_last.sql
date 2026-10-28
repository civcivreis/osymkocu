select p.created_at, timezone('Europe/Istanbul', p.created_at) as istanbul, left(p.body, 80) as body
from social_posts p
join virtual_student_profiles v on v.profile_id = p.user_id
order by p.created_at desc
limit 1;
