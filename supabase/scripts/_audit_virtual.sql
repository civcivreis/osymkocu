select
  (select count(*)::int from public.profiles) as profiles_total,
  (select count(*)::int from public.profiles where coalesce(profile_type::text,'human') = 'human') as human_count,
  (select count(*)::int from public.profiles where profile_type::text = 'virtual') as virtual_count,
  (select count(*)::int from public.profiles where profile_type::text = 'system') as system_count,
  (select count(*)::int from public.virtual_student_profiles) as vsp_total,
  (select count(*)::int from public.virtual_student_profiles where is_enabled) as vsp_enabled;
