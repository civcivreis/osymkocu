create or replace function public.exam_chat_pick_bots(p_slug text, p_n int)
returns uuid[]
language plpgsql
as $$
declare
  v uuid[];
  n int := greatest(3, least(5, p_n));
begin
  select coalesce(array_agg(id), '{}') into v
  from (
    select distinct on (public.exam_chat_voice(pr.id)) pr.id
    from public.virtual_student_profiles vp
    join public.profiles pr on pr.id = vp.profile_id
    where vp.is_enabled
    order by public.exam_chat_voice(pr.id), random()
    limit n
  ) s;
  if coalesce(array_length(v, 1), 0) < 3 then
    select coalesce(array_agg(id), v) into v
    from (
      select pr.id from public.virtual_student_profiles vp
      join public.profiles pr on pr.id = vp.profile_id
      where vp.is_enabled
      order by random()
      limit n
    ) t;
  end if;
  return v;
end;
$$;
