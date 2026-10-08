-- Chat media gates + per-user hidden conversations. No role bypass.

create or replace function public.user_can_access_media(p_user uuid, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.media m
    where m.id = p_id
      and m.deleted_at is null
      and m.moderation_status = 'approved'
      and (
        m.owner_user_id = p_user
        or public.is_admin()
        or (
          m.purpose = 'story'
          and exists (
            select 1 from public.stories s
            where s.user_id = m.owner_user_id
              and s.expires_at > now()
              and (s.image_url = 'media:' || m.id::text or s.image_url like '%' || m.id::text || '%')
          )
        )
        or (
          m.purpose = 'chat_image'
          and m.conversation_id is not null
          and exists (
            select 1 from public.dm_conversations c
            where c.id = m.conversation_id
              and (c.user_a = p_user or c.user_b = p_user)
          )
        )
        or (
          m.purpose = 'chat_image'
          and m.group_slug is not null
          and exists (
            select 1 from public.exam_chat_members g
            where g.slug = m.group_slug and g.user_id = p_user
          )
        )
      )
  );
$$;

create table if not exists public.media_moderation (
  id uuid primary key default gen_random_uuid(),
  uploader_user_id uuid not null references public.profiles(id) on delete cascade,
  asset_key text not null,
  conversation_id uuid,
  message_id uuid,
  media_id uuid references public.media(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'error')),
  categories jsonb not null default '{}'::jsonb,
  moderation_provider text,
  provider_result jsonb,
  moderated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists media_moderation_status_idx
  on public.media_moderation (status, created_at desc);

create table if not exists public.user_safety_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  source text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists user_safety_events_user_idx
  on public.user_safety_events (user_id, created_at desc);

create table if not exists public.conversation_user_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('group', 'dm')),
  thread_key text not null,
  hidden_at timestamptz,
  archived_at timestamptz,
  muted_until timestamptz,
  pinned_at timestamptz,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, thread_key)
);

alter table public.media_moderation enable row level security;
alter table public.user_safety_events enable row level security;
alter table public.conversation_user_state enable row level security;

drop policy if exists media_moderation_own on public.media_moderation;
create policy media_moderation_own on public.media_moderation
  for select to authenticated
  using (uploader_user_id = auth.uid() or public.is_admin());

drop policy if exists user_safety_events_admin on public.user_safety_events;
create policy user_safety_events_admin on public.user_safety_events
  for select to authenticated using (public.is_admin());

drop policy if exists conversation_user_state_own on public.conversation_user_state;
create policy conversation_user_state_own on public.conversation_user_state
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select on public.media_moderation to authenticated;
grant select on public.user_safety_events to authenticated;
grant select, insert, update, delete on public.conversation_user_state to authenticated;

drop policy if exists stories_insert_own on public.stories;

create or replace function public.publish_story(p_image_url text, p_caption text, p_media_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_media public.media%rowtype;
  v_url text := trim(coalesce(p_image_url, ''));
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.profiles where id = v_user and is_bot) then
    raise exception 'UNAUTHORIZED';
  end if;
  if p_media_id is not null then
    select * into v_media from public.media
    where id = p_media_id and owner_user_id = v_user and purpose = 'story'
      and moderation_status = 'approved' and deleted_at is null;
    if not found then raise exception 'IMAGE_NOT_APPROVED'; end if;
    v_url := coalesce(nullif(v_url, ''), 'media:' || v_media.id::text);
  elsif length(v_url) < 8 then
    raise exception 'EMPTY_MESSAGE';
  else
    raise exception 'IMAGE_NOT_APPROVED';
  end if;
  insert into public.stories (user_id, image_url, caption, expires_at)
  values (v_user, v_url, nullif(trim(p_caption), ''), now() + interval '24 hours')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.send_dm(
  p_other uuid,
  p_body text,
  p_image_path text default null,
  p_image_width int default null,
  p_image_height int default null,
  p_media_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_a uuid;
  v_b uuid;
  v_conv public.dm_conversations%rowtype;
  v_count int;
  v_kind text := 'text';
  v_body text := trim(coalesce(p_body, ''));
begin
  if v_user is null or p_other is null or v_user = p_other then
    raise exception 'INVALID_DM';
  end if;
  if exists (select 1 from public.profiles where id = p_other and is_bot) then
    raise exception 'BOT_NO_DM';
  end if;
  if p_image_path is not null and p_media_id is null then
    raise exception 'IMAGE_NOT_APPROVED';
  end if;
  if p_media_id is not null then
    v_kind := 'image';
  elsif length(v_body) < 1 then
    raise exception 'EMPTY_MESSAGE';
  end if;
  if v_kind = 'text' and public.content_moderation_level(v_body) = 'block' then
    raise exception 'MESSAGE_BLOCKED';
  end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_user and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = v_user)
  ) then
    raise exception 'BLOCKED';
  end if;
  v_a := least(v_user, p_other);
  v_b := greatest(v_user, p_other);
  select * into v_conv from public.dm_conversations where user_a = v_a and user_b = v_b;
  if not found then
    insert into public.dm_conversations (user_a, user_b, initiated_by)
    values (v_a, v_b, v_user) returning * into v_conv;
  else
    if v_conv.accepted_at is null and v_conv.initiated_by = v_user then
      select count(*) into v_count from public.dm_messages where conversation_id = v_conv.id;
      if v_count >= 1 then raise exception 'WAIT_ACCEPT'; end if;
    end if;
  end if;
  insert into public.dm_messages (
    conversation_id, sender_id, body, kind, image_path, image_width, image_height, media_id
  )
  values (
    v_conv.id, v_user, v_body, v_kind, null, p_image_width, p_image_height, p_media_id
  );
  if p_media_id is not null then
    update public.media
    set conversation_id = v_conv.id
    where id = p_media_id and owner_user_id = v_user;
  end if;
  if v_conv.accepted_at is null and v_conv.initiated_by <> v_user then
    update public.dm_conversations set accepted_at = now() where id = v_conv.id;
  end if;
  return v_conv.id;
end;
$$;

create or replace function public.send_group_message(
  p_slug text,
  p_body text,
  p_image_path text default null,
  p_image_width int default null,
  p_image_height int default null,
  p_reply_to uuid default null,
  p_media_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_last timestamptz;
  v_kind text := 'text';
  v_body text := trim(coalesce(p_body, ''));
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_slug not in ('tyt', 'ayt', 'kpss') then raise exception 'NOT_FOUND'; end if;
  if p_image_path is not null and p_media_id is null then
    raise exception 'IMAGE_NOT_APPROVED';
  end if;
  if p_media_id is not null then
    v_kind := 'image';
  elsif length(v_body) < 1 then
    raise exception 'EMPTY_MESSAGE';
  end if;
  if v_kind = 'text' and public.content_moderation_level(v_body) = 'block' then
    raise exception 'MESSAGE_BLOCKED';
  end if;
  insert into public.exam_chat_members (slug, user_id) values (p_slug, v_user)
  on conflict do nothing;
  select max(created_at) into v_last from public.exam_chat_messages where slug = p_slug and sender_id = v_user;
  if v_last is not null and v_last > now() - interval '10 seconds' then
    raise exception 'SLOW_MODE';
  end if;
  insert into public.exam_chat_messages (
    slug, sender_id, body, kind, image_path, image_width, image_height, reply_to_id, media_id
  )
  values (
    p_slug, v_user, v_body, v_kind, null, p_image_width, p_image_height, p_reply_to, p_media_id
  )
  returning id into v_id;
  perform public.exam_chat_touch_human(p_slug, case when v_kind = 'image' then coalesce(nullif(v_body, ''), 'fotoğraf') else v_body end);
  return v_id;
end;
$$;

create or replace function public.hide_conversation(p_kind text, p_thread text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_kind not in ('group', 'dm') then raise exception 'INVALID_INPUT'; end if;
  insert into public.conversation_user_state (user_id, kind, thread_key, hidden_at, updated_at)
  values (v_user, p_kind, p_thread, now(), now())
  on conflict (user_id, kind, thread_key)
  do update set hidden_at = now(), updated_at = now();
end;
$$;

create or replace function public.unhide_conversation(p_kind text, p_thread text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  update public.conversation_user_state
  set hidden_at = null, updated_at = now()
  where user_id = v_user and kind = p_kind and thread_key = p_thread;
end;
$$;

create or replace function public.leave_exam_group(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  delete from public.exam_chat_members where slug = p_slug and user_id = auth.uid();
end;
$$;

create or replace function public.unhide_peers_on_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_user_state s
  set hidden_at = null, updated_at = now()
  from public.dm_conversations c
  where c.id = new.conversation_id
    and s.kind = 'dm'
    and s.thread_key = c.id::text
    and s.hidden_at is not null
    and s.archived_at is null
    and s.user_id <> new.sender_id
    and (s.user_id = c.user_a or s.user_id = c.user_b);
  return new;
end;
$$;

create or replace function public.unhide_peers_on_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_user_state
  set hidden_at = null, updated_at = now()
  where kind = 'group'
    and thread_key = new.slug
    and hidden_at is not null
    and archived_at is null
    and user_id <> new.sender_id;
  return new;
end;
$$;

drop trigger if exists unhide_peers_on_dm_msg on public.dm_messages;
create trigger unhide_peers_on_dm_msg
after insert on public.dm_messages
for each row execute procedure public.unhide_peers_on_dm();

drop trigger if exists unhide_peers_on_group_msg on public.exam_chat_messages;
create trigger unhide_peers_on_group_msg
after insert on public.exam_chat_messages
for each row execute procedure public.unhide_peers_on_group();

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
    where not exists (
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

create or replace function public.get_hidden_conversations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.hidden_at desc)
    from (
      select
        s.kind,
        s.thread_key,
        s.hidden_at,
        case
          when s.kind = 'group' then coalesce(g.name, s.thread_key)
          else coalesce(pr.display_name, 'Sohbet')
        end as title,
        last.body as last_body
      from public.conversation_user_state s
      left join public.exam_chat_groups g on s.kind = 'group' and g.slug = s.thread_key
      left join public.dm_conversations c on s.kind = 'dm' and c.id::text = s.thread_key
      left join public.profiles pr on s.kind = 'dm' and pr.id = case when c.user_a = v_user then c.user_b else c.user_a end
      left join lateral (
        select m.body
        from public.exam_chat_messages m
        where s.kind = 'group' and m.slug = s.thread_key
        order by m.created_at desc
        limit 1
      ) last on s.kind = 'group'
      where s.user_id = v_user and s.hidden_at is not null
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_media_moderation(p_status text default 'rejected')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select
        m.id,
        m.uploader_user_id,
        p.display_name as uploader_name,
        m.asset_key,
        m.status,
        m.categories,
        m.moderation_provider,
        m.created_at,
        m.media_id,
        m.conversation_id
      from public.media_moderation m
      join public.profiles p on p.id = m.uploader_user_id
      where p_status is null or m.status = p_status
      limit 80
    ) x
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.hide_conversation(text, text) to authenticated;
grant execute on function public.unhide_conversation(text, text) to authenticated;
grant execute on function public.leave_exam_group(text) to authenticated;
grant execute on function public.get_hidden_conversations() to authenticated;
grant execute on function public.admin_list_media_moderation(text) to authenticated;
grant execute on function public.publish_story(text, text, uuid) to authenticated;

create or replace function public.stale_media_for_cleanup()
returns table (id uuid, storage_key text)
language sql
security definer
set search_path = public
as $$
  select m.id, m.storage_key
  from public.media m
  where m.storage_key not like 'purged/%'
    and (
      (m.deleted_at is not null)
      or (
        m.deleted_at is null
        and (
          (m.moderation_status = 'pending' and m.created_at < now() - interval '1 hour')
          or (m.moderation_status = 'rejected' and m.created_at < now() - interval '1 hour')
          or (m.moderation_status = 'approved' and m.consumed_at is null and m.created_at < now() - interval '24 hours')
        )
      )
    );
$$;
