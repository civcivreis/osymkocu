create or replace function public.get_exam_group_messages(p_slug text, p_limit integer default 120)
returns setof public.exam_chat_messages
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from (
    select m.*
    from public.exam_chat_messages m
    where m.slug = lower(btrim(coalesce(p_slug, '')))
      and m.created_at <= now()
    order by m.created_at desc, m.id desc
    limit greatest(1, least(coalesce(p_limit, 120), 300))
  ) tail
  order by created_at asc, id asc;
$$;

revoke all on function public.get_exam_group_messages(text, integer) from public;
grant execute on function public.get_exam_group_messages(text, integer) to authenticated;
