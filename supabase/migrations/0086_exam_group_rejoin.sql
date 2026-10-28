-- Official exam channels stay visible after hide/leave. Opening rejoins. Hide does not vanish TYT/AYT/KPSS.

create or replace function public.unhide_peers_on_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  return new;
end;
$$;

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
  insert into public.exam_chat_members (slug, user_id) values (p_slug, v_user)
  on conflict do nothing;
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
  delete from public.exam_chat_members where slug = p_slug and user_id = v_user;
  if p_slug in ('tyt', 'ayt', 'kpss') then
    update public.conversation_user_state
    set hidden_at = null, updated_at = now()
    where user_id = v_user and kind = 'group' and thread_key = p_slug;
  end if;
end;
$$;

create or replace function public.get_inbox()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_groups jsonb;
  v_dms jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  perform public.ensure_my_exam_groups();
  insert into public.conversation_reads (user_id, kind, thread_key, last_read_at)
  select v_user, 'group', g.slug, now() from public.exam_chat_groups g
  on conflict do nothing;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.is_pinned desc, x.last_at desc nulls last, x.name), '[]'::jsonb)
  into v_groups
  from (
    select
      g.slug,
      g.name,
      last.sender_id as last_sender_id,
      last.body as last_body,
      last.created_at as last_at,
      coalesce(p.display_name, null) as last_sender_name,
      (
        select count(*)::int
        from public.exam_chat_messages m
        where m.slug = g.slug
          and m.sender_id <> v_user
          and m.created_at <= now()
          and m.created_at > coalesce(r.last_read_at, now())
      ) as unread,
      (select count(*)::int from public.exam_chat_members em where em.slug = g.slug) as member_count,
      exists (
        select 1 from public.exam_chat_members em
        where em.slug = g.slug and em.user_id = v_user
      ) as is_member,
      exists (
        select 1 from public.conversation_user_state s
        where s.user_id = v_user and s.kind = 'group' and s.thread_key = g.slug and s.hidden_at is not null
      ) as is_hidden,
      exists (
        select 1 from public.conversation_pins pin
        where pin.user_id = v_user and pin.kind = 'group' and pin.thread_key = g.slug
      ) as is_pinned,
      exists (
        select 1 from public.conversation_mutes mu
        where mu.user_id = v_user and mu.kind = 'group' and mu.thread_key = g.slug
      ) as is_muted
    from public.exam_chat_groups g
    left join public.conversation_reads r
      on r.user_id = v_user and r.kind = 'group' and r.thread_key = g.slug
    left join lateral (
      select m.sender_id, m.body, m.created_at
      from public.exam_chat_messages m
      where m.slug = g.slug and m.created_at <= now()
      order by m.created_at desc
      limit 1
    ) last on true
    left join public.profiles p on p.id = last.sender_id
    where g.slug in ('tyt', 'ayt', 'kpss')
       or not exists (
         select 1 from public.conversation_user_state s
         where s.user_id = v_user and s.kind = 'group' and s.thread_key = g.slug and s.hidden_at is not null
       )
  ) x;

  insert into public.conversation_reads (user_id, kind, thread_key, last_read_at)
  select v_user, 'dm', c.id::text, now()
  from public.dm_conversations c
  where c.user_a = v_user or c.user_b = v_user
  on conflict do nothing;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.is_pinned desc, x.last_at desc nulls last), '[]'::jsonb)
  into v_dms
  from (
    select
      c.id as conversation_id,
      case when c.user_a = v_user then c.user_b else c.user_a end as other_id,
      pr.display_name as other_name,
      pr.display_tag as other_tag,
      last.body as last_body,
      coalesce(last.created_at, c.created_at) as last_at,
      c.accepted_at,
      c.initiated_by,
      (
        select count(*)::int
        from public.dm_messages m
        where m.conversation_id = c.id
          and m.sender_id <> v_user
          and m.created_at > coalesce(r.last_read_at, now())
      ) as unread,
      exists (
        select 1 from public.conversation_pins pin
        where pin.user_id = v_user and pin.kind = 'dm' and pin.thread_key = c.id::text
      ) as is_pinned,
      exists (
        select 1 from public.conversation_mutes mu
        where mu.user_id = v_user and mu.kind = 'dm' and mu.thread_key = c.id::text
      ) as is_muted
    from public.dm_conversations c
    join public.profiles pr on pr.id = case when c.user_a = v_user then c.user_b else c.user_a end
    left join public.conversation_reads r
      on r.user_id = v_user and r.kind = 'dm' and r.thread_key = c.id::text
    left join lateral (
      select m.body, m.created_at
      from public.dm_messages m
      where m.conversation_id = c.id
      order by m.created_at desc
      limit 1
    ) last on true
    where (c.user_a = v_user or c.user_b = v_user)
      and not exists (
        select 1 from public.conversation_user_state s
        where s.user_id = v_user and s.kind = 'dm' and s.thread_key = c.id::text and s.hidden_at is not null
      )
  ) x;

  return jsonb_build_object('groups', v_groups, 'dms', coalesce(v_dms, '[]'::jsonb));
end;
$$;

grant execute on function public.join_exam_group(text) to authenticated;
grant execute on function public.leave_exam_group(text) to authenticated;
grant execute on function public.get_inbox() to authenticated;
