-- Server-side chat image moderation. Paste after 0025.

alter table public.profiles
  add column if not exists image_upload_restricted_until timestamptz;

drop policy if exists chat_images_delete_own on storage.objects;
create policy chat_images_delete_own
  on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.chat_image_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique,
  status text not null default 'pending_moderation'
    check (status in ('pending_moderation', 'approved', 'rejected')),
  width int,
  height int,
  high_risk boolean not null default false,
  created_at timestamptz not null default now(),
  moderated_at timestamptz,
  consumed_at timestamptz
);

create index if not exists chat_image_assets_pending_idx
  on public.chat_image_assets (status, created_at)
  where status = 'pending_moderation';

create index if not exists chat_image_assets_user_idx
  on public.chat_image_assets (user_id, created_at desc);

create table if not exists public.image_moderation_violations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  confidence numeric,
  high_risk boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists image_moderation_violations_user_idx
  on public.image_moderation_violations (user_id, created_at desc);

alter table public.chat_image_assets enable row level security;
alter table public.image_moderation_violations enable row level security;

drop policy if exists chat_image_assets_own_read on public.chat_image_assets;
create policy chat_image_assets_own_read on public.chat_image_assets
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists image_moderation_violations_none on public.image_moderation_violations;

create or replace function public.cleanup_chat_image_uploads()
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
begin
  delete from storage.objects
  where bucket_id = 'chat-images'
    and name in (
      select storage_path from public.chat_image_assets
      where status = 'pending_moderation' and created_at < now() - interval '20 minutes'
    );

  update public.chat_image_assets
  set status = 'rejected', moderated_at = coalesce(moderated_at, now())
  where status = 'pending_moderation' and created_at < now() - interval '20 minutes';

  delete from storage.objects
  where bucket_id = 'chat-images'
    and name in (
      select storage_path from public.chat_image_assets
      where status = 'approved' and consumed_at is null and created_at < now() - interval '2 hours'
    );

  delete from public.chat_image_assets
  where status = 'approved' and consumed_at is null and created_at < now() - interval '2 hours';

  delete from storage.objects
  where bucket_id = 'chat-images'
    and name in (
      select storage_path from public.chat_image_assets
      where status = 'rejected' and created_at < now() - interval '1 day'
    );
end;
$$;

create or replace function public.register_chat_image(
  p_path text,
  p_width int default null,
  p_height int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_until timestamptz;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  perform public.cleanup_chat_image_uploads();
  if p_path is null or p_path not like (v_user::text || '/pending/%') then
    raise exception 'BAD_IMAGE';
  end if;
  select image_upload_restricted_until into v_until from public.profiles where id = v_user;
  if v_until is not null and v_until > now() then
    raise exception 'IMAGE_RESTRICTED';
  end if;
  insert into public.chat_image_assets (user_id, storage_path, status, width, height)
  values (v_user, p_path, 'pending_moderation', p_width, p_height)
  on conflict (storage_path) do update
    set width = excluded.width,
        height = excluded.height
  where public.chat_image_assets.user_id = v_user
    and public.chat_image_assets.status = 'pending_moderation'
  returning id into v_id;
  if v_id is null then raise exception 'IMAGE_NOT_APPROVED'; end if;
  return v_id;
end;
$$;

create or replace function public.record_chat_image_moderation(
  p_path text,
  p_user uuid,
  p_approved boolean,
  p_category text default null,
  p_confidence numeric default null,
  p_high_risk boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_asset public.chat_image_assets%rowtype;
  v_rejects int := 0;
  v_until timestamptz;
begin
  if p_user is null or p_path is null then raise exception 'BAD_IMAGE'; end if;

  select * into v_asset
  from public.chat_image_assets
  where storage_path = p_path and user_id = p_user
  for update;

  if not found then raise exception 'NOT_FOUND'; end if;
  if v_asset.status <> 'pending_moderation' then
    return jsonb_build_object('status', v_asset.status, 'approved', v_asset.status = 'approved');
  end if;

  if p_approved then
    update public.chat_image_assets
    set status = 'approved',
        moderated_at = now(),
        high_risk = false
    where id = v_asset.id;
    return jsonb_build_object('status', 'approved', 'approved', true);
  end if;

  update public.chat_image_assets
  set status = 'rejected',
      moderated_at = now(),
      high_risk = coalesce(p_high_risk, false)
  where id = v_asset.id;

  delete from storage.objects
  where bucket_id = 'chat-images' and name = p_path;

  insert into public.image_moderation_violations (user_id, category, confidence, high_risk)
  values (p_user, coalesce(nullif(trim(p_category), ''), 'sexual'), p_confidence, coalesce(p_high_risk, false));

  insert into public.content_moderation_events (actor_id, target_id, kind, payload)
  values (
    p_user, p_user,
    case when coalesce(p_high_risk, false) then 'image_high_risk' else 'image_rejected' end,
    jsonb_build_object(
      'category', coalesce(p_category, 'sexual'),
      'confidence', p_confidence,
      'high_risk', coalesce(p_high_risk, false)
    )
  );

  if coalesce(p_high_risk, false) then
    v_until := now() + interval '7 days';
  else
    select count(*)::int into v_rejects
    from public.image_moderation_violations
    where user_id = p_user and created_at > now() - interval '24 hours';
    if v_rejects >= 3 then
      v_until := now() + interval '24 hours';
    end if;
  end if;

  if v_until is not null then
    update public.profiles
    set image_upload_restricted_until = greatest(coalesce(image_upload_restricted_until, v_until), v_until)
    where id = p_user;
  end if;

  return jsonb_build_object('status', 'rejected', 'approved', false);
end;
$$;

create or replace function public.claim_approved_chat_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if new.image_path is null or length(trim(new.image_path)) = 0 then
    new.kind := coalesce(nullif(new.kind, 'image'), 'text');
    return new;
  end if;

  select image_upload_restricted_until into v_until
  from public.profiles where id = new.sender_id;
  if v_until is not null and v_until > now() then
    raise exception 'IMAGE_RESTRICTED';
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

drop trigger if exists dm_messages_claim_image on public.dm_messages;
create trigger dm_messages_claim_image
before insert on public.dm_messages
for each row execute procedure public.claim_approved_chat_image();

drop trigger if exists exam_chat_messages_claim_image on public.exam_chat_messages;
create trigger exam_chat_messages_claim_image
before insert on public.exam_chat_messages
for each row execute procedure public.claim_approved_chat_image();

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
  if p_reason not in ('kufur', 'taciz', 'spam', 'uygunsuz', 'diger', 'cinsel', 'siddet') then raise exception 'BAD_REASON'; end if;
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

revoke all on function public.record_chat_image_moderation(text, uuid, boolean, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public.record_chat_image_moderation(text, uuid, boolean, text, numeric, boolean) to service_role;

revoke all on function public.register_chat_image(text, int, int) from public;
grant execute on function public.register_chat_image(text, int, int) to authenticated;

revoke all on function public.cleanup_chat_image_uploads() from public;
grant execute on function public.cleanup_chat_image_uploads() to authenticated;
grant execute on function public.report_content(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
