-- Chat image messages for DMs and exam groups. Paste after 0024.

alter table public.dm_messages
  add column if not exists kind text not null default 'text',
  add column if not exists image_path text,
  add column if not exists image_width int,
  add column if not exists image_height int;

alter table public.dm_messages drop constraint if exists dm_messages_kind_check;
alter table public.dm_messages
  add constraint dm_messages_kind_check check (kind in ('text', 'image'));

alter table public.exam_chat_messages
  add column if not exists kind text not null default 'text',
  add column if not exists image_path text,
  add column if not exists image_width int,
  add column if not exists image_height int;

alter table public.exam_chat_messages drop constraint if exists exam_chat_messages_kind_check;
alter table public.exam_chat_messages
  add constraint exam_chat_messages_kind_check check (kind in ('text', 'image'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists chat_images_read on storage.objects;
create policy chat_images_read
  on storage.objects for select
  using (bucket_id = 'chat-images');

drop policy if exists chat_images_insert_own on storage.objects;
create policy chat_images_insert_own
  on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop function if exists public.send_dm(uuid, text);
create or replace function public.send_dm(
  p_other uuid,
  p_body text,
  p_image_path text default null,
  p_image_width int default null,
  p_image_height int default null
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
  if p_image_path is not null then
    if p_image_path not like (v_user::text || '/%') then raise exception 'BAD_IMAGE'; end if;
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
    conversation_id, sender_id, body, kind, image_path, image_width, image_height
  )
  values (
    v_conv.id, v_user, v_body, v_kind, p_image_path, p_image_width, p_image_height
  );
  if v_conv.accepted_at is null and v_conv.initiated_by <> v_user then
    update public.dm_conversations set accepted_at = now() where id = v_conv.id;
  end if;
  return v_conv.id;
end;
$$;

drop function if exists public.send_group_message(text, text);
create or replace function public.send_group_message(
  p_slug text,
  p_body text,
  p_image_path text default null,
  p_image_width int default null,
  p_image_height int default null,
  p_reply_to uuid default null
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
  if p_image_path is not null then
    if p_image_path not like (v_user::text || '/%') then raise exception 'BAD_IMAGE'; end if;
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
    slug, sender_id, body, kind, image_path, image_width, image_height, reply_to_id
  )
  values (
    p_slug, v_user, v_body, v_kind, p_image_path, p_image_width, p_image_height, p_reply_to
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
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_scope = 'dm' then
    delete from public.dm_messages where id = p_id and sender_id = v_user;
  elsif p_scope = 'group' then
    delete from public.exam_chat_messages where id = p_id and sender_id = v_user;
  else
    raise exception 'BAD_TYPE';
  end if;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

alter table public.content_reports drop constraint if exists content_reports_content_type_check;
alter table public.content_reports
  add constraint content_reports_content_type_check
  check (content_type in ('status', 'room_message', 'comment', 'group_message', 'dm_message'));

create or replace function public.report_content(
  p_type text,
  p_content_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_target uuid;
  v_session uuid;
  v_count int;
  v_kicked boolean := false;
  v_inserted uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_type not in ('status', 'room_message', 'comment', 'group_message', 'dm_message') then raise exception 'BAD_TYPE'; end if;
  if p_reason not in ('kufur', 'taciz', 'spam', 'uygunsuz', 'diger') then raise exception 'BAD_REASON'; end if;
  if exists (select 1 from public.profiles where id = v_user and coalesce(is_bot, false)) then
    raise exception 'UNAUTHORIZED';
  end if;

  if p_type = 'status' then
    select user_id into v_target from public.social_posts where id = p_content_id;
  elsif p_type = 'comment' then
    select user_id into v_target from public.post_comments where id = p_content_id;
  elsif p_type = 'group_message' then
    select sender_id into v_target from public.exam_chat_messages where id = p_content_id;
  elsif p_type = 'dm_message' then
    select sender_id into v_target from public.dm_messages where id = p_content_id;
  else
    select sender_id, session_id into v_target, v_session
    from public.study_session_messages where id = p_content_id;
  end if;
  if v_target is null then raise exception 'NOT_FOUND'; end if;
  if v_target = v_user then raise exception 'SELF_REPORT'; end if;

  if exists (
    select 1 from public.content_reports
    where reporter_user_id = v_user and created_at > now() - interval '15 seconds'
  ) then
    insert into public.content_moderation_events (actor_id, target_id, kind, payload)
    values (v_user, v_target, 'report_cooldown', jsonb_build_object('type', p_type, 'content_id', p_content_id));
    raise exception 'REPORT_COOLDOWN';
  end if;

  insert into public.content_reports (reporter_user_id, target_user_id, content_type, content_id, reason)
  values (v_user, v_target, p_type, p_content_id, p_reason)
  on conflict (reporter_user_id, content_type, content_id) do nothing
  returning id into v_inserted;

  insert into public.content_moderation_events (actor_id, target_id, kind, payload)
  values (
    v_user, v_target,
    case when v_inserted is null then 'duplicate_report' else 'report' end,
    jsonb_build_object('type', p_type, 'content_id', p_content_id, 'reason', p_reason)
  );

  if p_type = 'room_message' and v_session is not null then
    if not exists (
      select 1 from public.study_session_members where session_id = v_session and user_id = v_user
    ) then
      raise exception 'NOT_IN_ROOM';
    end if;
    insert into public.room_reports (session_id, reporter_user_id, reported_user_id, message_id, reason)
    values (v_session, v_user, v_target, p_content_id, p_reason)
    on conflict (session_id, reporter_user_id, reported_user_id) do nothing;

    select count(distinct r.reporter_user_id)::int into v_count
    from public.room_reports r
    join public.profiles p on p.id = r.reporter_user_id
    where r.session_id = v_session
      and r.reported_user_id = v_target
      and coalesce(p.is_bot, false) = false;

    if v_count >= 2 then
      delete from public.study_session_members where session_id = v_session and user_id = v_target;
      insert into public.room_bans (session_id, user_id, expires_at, reason)
      values (v_session, v_target, now() + interval '30 minutes', 'two_unique_reports')
      on conflict (session_id, user_id) do update
        set expires_at = greatest(public.room_bans.expires_at, excluded.expires_at);
      insert into public.notifications (user_id, kind, payload)
      values (v_target, 'room_kicked', jsonb_build_object('session_id', v_session));
      v_kicked := true;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'kicked', v_kicked);
end;
$$;

revoke all on function public.send_dm(uuid, text, text, int, int) from public;
revoke all on function public.send_group_message(text, text, text, int, int, uuid) from public;
revoke all on function public.delete_own_chat_message(text, uuid) from public;
grant execute on function public.send_dm(uuid, text, text, int, int) to authenticated;
grant execute on function public.send_group_message(text, text, text, int, int, uuid) to authenticated;
grant execute on function public.delete_own_chat_message(text, uuid) to authenticated;
grant execute on function public.report_content(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
