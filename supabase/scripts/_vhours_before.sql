select active_hours_start, active_hours_end, count(*) as n
from virtual_student_profiles
where is_enabled
group by 1, 2
order by 1;

select max(p.created_at) as last_virtual_post
from social_posts p
join virtual_student_profiles v on v.profile_id = p.user_id;

select max(m.created_at) as last_virtual_chat
from exam_chat_messages m
where public.is_virtual_profile(m.sender_id);

select timezone('Europe/Istanbul', now()) as istanbul_now;
