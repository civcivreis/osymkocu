-- Stories, public exam rooms, bot story clock.
-- Run in SQL Editor after 0010_live_social.sql.

alter table public.bot_clock
  add column if not exists last_story_at timestamptz;

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  image_url text not null,
  caption text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists stories_live_idx on public.stories (expires_at desc, created_at desc);

alter table public.stories enable row level security;

drop policy if exists stories_read on public.stories;
create policy stories_read on public.stories
  for select to authenticated using (expires_at > now());

drop policy if exists stories_insert_own on public.stories;
create policy stories_insert_own on public.stories
  for insert to authenticated with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stories',
  'stories',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists stories_storage_read on storage.objects;
create policy stories_storage_read
  on storage.objects for select
  using (bucket_id = 'stories');

drop policy if exists stories_storage_insert on storage.objects;
create policy stories_storage_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'stories' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.publish_story(p_image_url text, p_caption text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.profiles where id = v_user and is_bot) then
    raise exception 'UNAUTHORIZED';
  end if;
  if length(trim(p_image_url)) < 8 then raise exception 'EMPTY_MESSAGE'; end if;
  insert into public.stories (user_id, image_url, caption, expires_at)
  values (v_user, trim(p_image_url), nullif(trim(p_caption), ''), now() + interval '24 hours')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_stories()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x))
    from (
      select
        s.id,
        s.user_id,
        s.image_url,
        s.caption,
        s.created_at,
        s.expires_at,
        a.display_name
      from public.stories s
      join public.profiles a on a.id = s.user_id
      where s.expires_at > now()
        and not exists (
          select 1 from public.user_blocks b
          where b.blocker_id = v_user and b.blocked_id = s.user_id
        )
      order by (not a.is_bot) desc, s.created_at desc
      limit 40
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.ensure_my_exam_groups()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  insert into public.exam_chat_members (slug, user_id)
  select g.slug, v_user from public.exam_chat_groups g
  on conflict do nothing;
end;
$$;

create or replace function public.send_group_message(p_slug text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_last timestamptz;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_slug not in ('tyt', 'ayt', 'kpss') then raise exception 'NOT_FOUND'; end if;
  if length(trim(p_body)) < 1 then raise exception 'EMPTY_MESSAGE'; end if;
  insert into public.exam_chat_members (slug, user_id) values (p_slug, v_user)
  on conflict do nothing;
  select max(created_at) into v_last from public.exam_chat_messages where slug = p_slug and sender_id = v_user;
  if v_last is not null and v_last > now() - interval '10 seconds' then
    raise exception 'SLOW_MODE';
  end if;
  insert into public.exam_chat_messages (slug, sender_id, body)
  values (p_slug, v_user, trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

drop policy if exists exam_messages_read on public.exam_chat_messages;
create policy exam_messages_read on public.exam_chat_messages
  for select to authenticated using (true);

drop policy if exists exam_messages_insert on public.exam_chat_messages;
create policy exam_messages_insert on public.exam_chat_messages
  for insert to authenticated with check (sender_id = auth.uid());

revoke all on function public.publish_story(text, text) from public;
revoke all on function public.get_stories() from public;
revoke all on function public.ensure_my_exam_groups() from public;
grant execute on function public.publish_story(text, text) to authenticated;
grant execute on function public.get_stories() to authenticated;
grant execute on function public.ensure_my_exam_groups() to authenticated;
grant execute on function public.send_group_message(text, text) to authenticated;

notify pgrst, 'reload schema';
