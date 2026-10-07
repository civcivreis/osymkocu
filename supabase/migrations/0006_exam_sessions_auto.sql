-- Upcoming exam years roll forward from Istanbul date.
-- Official day is stored when ÖSYM publishes it; never guess a date.
-- Run contents in SQL Editor. Do not paste the file path.

create or replace function public.upcoming_session_years(p_kind public.exam_kind, p_count int default 2)
returns int[]
language plpgsql
stable
as $$
declare
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_year int := extract(year from v_today)::int;
  v_month int := extract(month from v_today)::int;
  v_typical int;
  v_first int;
begin
  v_typical := case
    when p_kind in ('tyt', 'ayt', 'tyt_ayt') then 6
    else 9
  end;

  if p_kind = 'kpss_onlisans' then
    v_first := case when v_year % 2 = 0 then v_year else v_year + 1 end;
    if v_first = v_year and v_month >= v_typical then
      v_first := v_first + 2;
    end if;
    return array[v_first, v_first + 2];
  end if;

  v_first := case when v_month >= v_typical then v_year + 1 else v_year end;
  return array[v_first, v_first + 1];
end;
$$;

create or replace function public.ensure_upcoming_exam_sessions()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam public.exams%rowtype;
  v_year int;
  v_label text;
begin
  for v_exam in select * from public.exams loop
    foreach v_year in array public.upcoming_session_years(v_exam.kind, 2) loop
      v_label := case
        when v_exam.kind = 'tyt_ayt' then 'YKS ' || v_year
        else v_exam.name || ' ' || v_year
      end;
      insert into public.exam_sessions (exam_id, session_year, exam_date, label)
      values (v_exam.id, v_year, null, v_label)
      on conflict (exam_id, session_year) do update
        set label = excluded.label;
    end loop;
  end loop;
end;
$$;

create or replace function public.list_exam_sessions(p_exam_id uuid)
returns table (
  id uuid,
  exam_id uuid,
  session_year int,
  exam_date date,
  label text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind public.exam_kind;
  v_years int[];
  v_today date := (timezone('Europe/Istanbul', now()))::date;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select e.kind into v_kind from public.exams e where e.id = p_exam_id;
  if not found then
    return;
  end if;

  perform public.ensure_upcoming_exam_sessions();
  v_years := public.upcoming_session_years(v_kind, 2);

  return query
    select s.id, s.exam_id, s.session_year, s.exam_date, s.label
    from public.exam_sessions s
    where s.exam_id = p_exam_id
      and s.session_year = any (v_years)
      and (s.exam_date is null or s.exam_date >= v_today)
    order by s.session_year;
end;
$$;

revoke all on function public.upcoming_session_years(public.exam_kind, int) from public;
revoke all on function public.ensure_upcoming_exam_sessions() from public;
revoke all on function public.list_exam_sessions(uuid) from public;
grant execute on function public.upcoming_session_years(public.exam_kind, int) to authenticated;
grant execute on function public.ensure_upcoming_exam_sessions() to authenticated;
grant execute on function public.list_exam_sessions(uuid) to authenticated;

select public.ensure_upcoming_exam_sessions();

notify pgrst, 'reload schema';
