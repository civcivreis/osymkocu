select
  (select band from public.virtual_stable_hours(v.profile_id)) as band,
  v.active_hours_start::text,
  v.active_hours_end::text,
  count(*)::int as n,
  count(*) filter (where public.virtual_profile_is_active(v.profile_id))::int as eligible_now
from virtual_student_profiles v
where v.is_enabled
group by 1, 2, 3
order by 2;
