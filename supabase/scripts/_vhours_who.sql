select pr.display_name, v.active_hours_start::text, v.active_hours_end::text,
  public.virtual_profile_is_active(v.profile_id) as eligible
from virtual_student_profiles v
join profiles pr on pr.id = v.profile_id
where v.is_enabled
order by v.active_hours_start, pr.display_name;
