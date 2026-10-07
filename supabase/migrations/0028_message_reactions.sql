-- Message reactions for DM, group, and study-room chats. Paste after 0027.

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('dm', 'group', 'room')),
  message_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (scope, message_id, user_id, emoji)
);

create index if not exists message_reactions_msg_idx
  on public.message_reactions (scope, message_id, created_at);

alter table public.message_reactions enable row level security;

create or replace function public.reaction_emoji_allowed(p_emoji text)
returns boolean
language sql
immutable
as $$
  select p_emoji in (
    '❤️','😂','👍','😮','😢','🔥','💪','👀','✅','🎯','📚','🧠','☕','😭','✍️','😍','👏','🙏','💯','😅'
  );
$$;

create or replace function public.user_can_access_reacted_message(p_scope text, p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_scope
    when 'dm' then exists (
      select 1
      from public.dm_messages m
      join public.dm_conversations c on c.id = m.conversation_id
      where m.id = p_id
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
    when 'group' then exists (
      select 1
      from public.exam_chat_messages m
      join public.exam_chat_members g on g.slug = m.slug and g.user_id = auth.uid()
      where m.id = p_id
    )
    when 'room' then exists (
      select 1
      from public.study_session_messages m
      join public.study_session_members s on s.session_id = m.session_id and s.user_id = auth.uid()
      where m.id = p_id
    )
    else false
  end;
$$;

drop policy if exists message_reactions_read on public.message_reactions;
create policy message_reactions_read on public.message_reactions
  for select to authenticated
  using (public.user_can_access_reacted_message(scope, message_id));

drop policy if exists message_reactions_write on public.message_reactions;
create policy message_reactions_write on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.reaction_emoji_allowed(emoji)
    and public.user_can_access_reacted_message(scope, message_id)
  );

drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.toggle_message_reaction(
  p_scope text,
  p_message_id uuid,
  p_emoji text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_scope not in ('dm', 'group', 'room') then raise exception 'BAD_TYPE'; end if;
  if not public.reaction_emoji_allowed(p_emoji) then raise exception 'BAD_EMOJI'; end if;
  if not public.user_can_access_reacted_message(p_scope, p_message_id) then
    raise exception 'NOT_FOUND';
  end if;

  delete from public.message_reactions
  where scope = p_scope
    and message_id = p_message_id
    and user_id = v_user
    and emoji = p_emoji;
  if found then
    return false;
  end if;

  select count(*) into v_count
  from public.message_reactions
  where scope = p_scope and message_id = p_message_id and user_id = v_user;
  if v_count >= 3 then
    raise exception 'REACTION_LIMIT';
  end if;

  insert into public.message_reactions (scope, message_id, user_id, emoji)
  values (p_scope, p_message_id, v_user, p_emoji);
  return true;
end;
$$;

create or replace function public.exam_chat_maybe_emoji()
returns trigger
language plpgsql
as $$
declare
  v_pick text;
begin
  if not exists (
    select 1 from public.profiles where id = new.sender_id and coalesce(is_bot, false)
  ) then
    return new;
  end if;
  if new.body ~ '[🔥🎯📚🧠✍️✅😂😭💪👀☕❤️👍]' then
    return new;
  end if;
  if random() > 0.12 then
    return new;
  end if;
  v_pick := (array['🔥','💪','📚','✅','☕','🎯'])[1 + floor(random() * 6)::int];
  new.body := trim(new.body) || ' ' || v_pick;
  return new;
end;
$$;

drop trigger if exists exam_chat_bot_emoji on public.exam_chat_messages;
drop trigger if exists exam_chat_rewrite_stale_emoji on public.exam_chat_messages;
create trigger exam_chat_rewrite_stale_emoji
before insert on public.exam_chat_messages
for each row execute procedure public.exam_chat_maybe_emoji();

revoke all on function public.user_can_access_reacted_message(text, uuid) from public, anon;
grant execute on function public.user_can_access_reacted_message(text, uuid) to authenticated;
grant execute on function public.reaction_emoji_allowed(text) to authenticated;
grant execute on function public.toggle_message_reaction(text, uuid, text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
