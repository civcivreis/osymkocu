select v.profile_id, p.display_name, v.is_enabled, v.active_hours_start::text, v.active_hours_end::text, v.timezone, v.social_activity_level, v.exam_id
from public.virtual_student_profiles v
join public.profiles p on p.id = v.profile_id
where v.is_enabled
order by p.display_name
limit 12;
