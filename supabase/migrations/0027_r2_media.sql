-- R2-backed reusable media. Paste after 0026. Does not drop legacy image_path.

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  storage_key text not null unique,
  purpose text not null check (purpose in ('chat_image', 'avatar', 'story', 'status_image', 'question_image')),
  mime_type text not null,
  size_bytes bigint not null default 0,
  width int,
  height int,
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'rejected')),
  conversation_id uuid references public.dm_conversations(id) on delete set null,
  group_slug text,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists media_owner_idx on public.media (owner_user_id, created_at desc);
create index if not exists media_pending_idx on public.media (moderation_status, created_at)
  where deleted_at is null and moderation_status = 'pending';
create index if not exists media_conversation_idx on public.media (conversation_id)
  where conversation_id is not null;
create index if not exists media_group_idx on public.media (group_slug)
  where group_slug is not null;

alter table public.media enable row level security;

drop policy if exists media_own_read on public.media;
create policy media_own_read on public.media
  for select to authenticated
  using (owner_user_id = auth.uid() and deleted_at is null);

alter table public.dm_messages
  add column if not exists media_id uuid references public.media(id) on delete set null;

alter table public.exam_chat_messages
  add column if not exists media_id uuid references public.media(id) on delete set null;

create index if not exists dm_messages_media_idx on public.dm_messages (media_id)
  where media_id is not null;
create index if not exists exam_chat_messages_media_idx on public.exam_chat_messages (media_id)
  where media_id is not null;

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

create or replace function public.claim_approved_chat_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
  v_media public.media%rowtype;
begin
  if new.media_id is null and (new.image_path is null or length(trim(new.image_path)) = 0) then
    new.kind := coalesce(nullif(new.kind, 'image'), 'text');
    return new;
  end if;

  select image_upload_restricted_until into v_until
  from public.profiles where id = new.sender_id;
  if v_until is not null and v_until > now() then
    raise exception 'IMAGE_RESTRICTED';
  end if;

  if new.media_id is not null then
    update public.media
    set consumed_at = now()
    where id = new.media_id
      and owner_user_id = new.sender_id
      and moderation_status = 'approved'
      and deleted_at is null
      and consumed_at is null
    returning * into v_media;
    if not found then
      raise exception 'IMAGE_NOT_APPROVED';
    end if;
    new.kind := 'image';
    new.image_width := coalesce(new.image_width, v_media.width);
    new.image_height := coalesce(new.image_height, v_media.height);
    return new;
  end if;

  update public.chat_image_assets
  set consumed_at = now()
  where storage_path = new.image_path
    and user_id = new.sender_id
    and status = 'approved'
    and consumed_at is null;

  if not found then
    raise exception 'IMAGE_NOT_APPROVED';
  end if;

  new.kind := 'image';
  return new;
end;
$$;

drop function if exists public.send_dm(uuid, text, text, int, int);
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
  if p_media_id is not null or p_image_path is not null then
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
    v_conv.id, v_user, v_body, v_kind, p_image_path, p_image_width, p_image_height, p_media_id
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

drop function if exists public.send_group_message(text, text, text, int, int, uuid);
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
  if p_media_id is not null or p_image_path is not null then
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
    p_slug, v_user, v_body, v_kind, p_image_path, p_image_width, p_image_height, p_reply_to, p_media_id
  )
  returning id into v_id;
  perform public.exam_chat_touch_human(p_slug, case when v_kind = 'image' then coalesce(nullif(v_body, ''), 'fotoğraf') else v_body end);
  return v_id;
end;
$$;

create or replace function public.delete_own_chat_message(p_scope text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_media uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_scope = 'dm' then
    select media_id into v_media from public.dm_messages where id = p_id and sender_id = v_user;
    delete from public.dm_messages where id = p_id and sender_id = v_user;
  elsif p_scope = 'group' then
    select media_id into v_media from public.exam_chat_messages where id = p_id and sender_id = v_user;
    delete from public.exam_chat_messages where id = p_id and sender_id = v_user;
  else
    raise exception 'BAD_TYPE';
  end if;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_media is not null then
    update public.media
    set deleted_at = now()
    where id = v_media
      and owner_user_id = v_user
      and not exists (select 1 from public.dm_messages where media_id = v_media)
      and not exists (select 1 from public.exam_chat_messages where media_id = v_media);
  end if;
end;
$$;

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
          (m.moderation_status = 'pending' and m.created_at < now() - interval '24 hours')
          or (m.moderation_status = 'rejected' and m.created_at < now() - interval '1 hour')
          or (m.moderation_status = 'approved' and m.consumed_at is null and m.created_at < now() - interval '24 hours')
        )
      )
    );
$$;

create or replace function public.mark_media_deleted(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.media
  set deleted_at = coalesce(deleted_at, now()),
      storage_key = 'purged/' || p_id::text
  where id = p_id;
end;
$$;

revoke all on function public.user_can_access_media(uuid, uuid) from public, anon;
grant execute on function public.user_can_access_media(uuid, uuid) to authenticated, service_role;

revoke all on function public.stale_media_for_cleanup() from public, anon, authenticated;
grant execute on function public.stale_media_for_cleanup() to service_role;

revoke all on function public.mark_media_deleted(uuid) from public, anon, authenticated;
grant execute on function public.mark_media_deleted(uuid) to service_role;

grant execute on function public.send_dm(uuid, text, text, int, int, uuid) to authenticated;
grant execute on function public.send_group_message(text, text, text, int, int, uuid, uuid) to authenticated;
grant execute on function public.delete_own_chat_message(text, uuid) to authenticated;

notify pgrst, 'reload schema';
