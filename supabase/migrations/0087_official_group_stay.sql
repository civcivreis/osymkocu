-- Official exam channels cannot be left. Opening bumps membership so the user shows in the list.

create or replace function public.join_exam_group(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_slug not in ('tyt', 'ayt', 'kpss') then raise exception 'NOT_FOUND'; end if;
  insert into public.exam_chat_members (slug, user_id, joined_at)
  values (p_slug, v_user, now())
  on conflict (slug, user_id) do update set joined_at = now();
  update public.conversation_user_state
  set hidden_at = null, updated_at = now()
  where user_id = v_user and kind = 'group' and thread_key = p_slug and hidden_at is not null;
end;
$$;

create or replace function public.leave_exam_group(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_slug in ('tyt', 'ayt', 'kpss') then
    insert into public.exam_chat_members (slug, user_id, joined_at)
    values (p_slug, v_user, now())
    on conflict (slug, user_id) do update set joined_at = now();
    insert into public.conversation_user_state (user_id, kind, thread_key, hidden_at, updated_at)
    values (v_user, 'group', p_slug, now(), now())
    on conflict (user_id, kind, thread_key)
    do update set hidden_at = now(), updated_at = now();
    return;
  end if;
  delete from public.exam_chat_members where slug = p_slug and user_id = v_user;
end;
$$;

insert into public.exam_chat_members (slug, user_id, joined_at)
select g.slug, p.id, now()
from public.exam_chat_groups g
cross join public.profiles p
where g.slug in ('tyt', 'ayt', 'kpss')
  and coalesce(p.is_bot, false) = false
on conflict (slug, user_id) do update set joined_at = excluded.joined_at;

grant execute on function public.join_exam_group(text) to authenticated;
grant execute on function public.leave_exam_group(text) to authenticated;
