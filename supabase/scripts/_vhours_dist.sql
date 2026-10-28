select active_hours_start::text, active_hours_end::text, count(*)::int as n
from virtual_student_profiles
where is_enabled
group by 1, 2
order by 1;
