-- Optional post kind on publish_status. Existing 3-arg calls still work via default.
-- Run after 0015.

drop function if exists public.publish_status(text, uuid, int);

create function public.publish_status(
  p_body text,
  p_subject_id uuid,
  p_minutes int,
  p_kind text default 'status'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'status');
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.profiles where id = v_user and is_bot) then
    raise exception 'UNAUTHORIZED';
  end if;
  if length(trim(p_body)) < 2 then raise exception 'EMPTY_MESSAGE'; end if;
  if p_minutes not in (30, 60, 120, 240) then raise exception 'INVALID_DURATION'; end if;
  if v_kind not in ('status', 'ask', 'activity') then
    v_kind := 'status';
  end if;
  insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at)
  values (v_user, trim(p_body), v_kind, p_subject_id, p_minutes, now() + make_interval(mins => p_minutes))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.publish_status(text, uuid, int, text) from public;
grant execute on function public.publish_status(text, uuid, int, text) to authenticated;
