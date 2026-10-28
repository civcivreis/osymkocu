select public.virtual_try_social_post(v.profile_id) as result
from public.virtual_student_profiles v
join public.profiles pr on pr.id = v.profile_id
where pr.display_name = 'Elif1'
limit 1;
