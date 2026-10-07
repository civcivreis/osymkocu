-- Inbox unread/pin/mute, group-message reports, contextual exam-chat bots.
-- Paste after 0019.

alter table public.bot_clock add column if not exists last_chat_at timestamptz;

create table if not exists public.conversation_pins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('group', 'dm')),
  thread_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, thread_key)
);

create table if not exists public.conversation_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('group', 'dm')),
  thread_key text not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, kind, thread_key)
);

create table if not exists public.conversation_mutes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('group', 'dm')),
  thread_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, thread_key)
);

alter table public.conversation_pins enable row level security;
alter table public.conversation_reads enable row level security;
alter table public.conversation_mutes enable row level security;

drop policy if exists conversation_pins_own on public.conversation_pins;
create policy conversation_pins_own on public.conversation_pins
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists conversation_reads_own on public.conversation_reads;
create policy conversation_reads_own on public.conversation_reads
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists conversation_mutes_own on public.conversation_mutes;
create policy conversation_mutes_own on public.conversation_mutes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.content_reports drop constraint if exists content_reports_content_type_check;
alter table public.content_reports
  add constraint content_reports_content_type_check
  check (content_type in ('status', 'room_message', 'comment', 'group_message'));

create or replace function public.exam_chat_guard()
returns trigger
language plpgsql
as $$
begin
  if public.content_moderation_level(new.body) = 'block' then
    raise exception 'MESSAGE_BLOCKED';
  end if;
  return new;
end;
$$;

drop trigger if exists exam_chat_messages_guard on public.exam_chat_messages;
create trigger exam_chat_messages_guard
before insert or update of body on public.exam_chat_messages
for each row execute procedure public.exam_chat_guard();

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
  if public.content_moderation_level(p_body) = 'block' then raise exception 'MESSAGE_BLOCKED'; end if;
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

create or replace function public.mark_thread_read(p_kind text, p_thread text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_kind not in ('group', 'dm') then raise exception 'BAD_TYPE'; end if;
  insert into public.conversation_reads (user_id, kind, thread_key, last_read_at)
  values (auth.uid(), p_kind, p_thread, now())
  on conflict (user_id, kind, thread_key) do update set last_read_at = now();
end;
$$;

create or replace function public.toggle_thread_pin(p_kind text, p_thread text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_kind not in ('group', 'dm') then raise exception 'BAD_TYPE'; end if;
  delete from public.conversation_pins
  where user_id = auth.uid() and kind = p_kind and thread_key = p_thread;
  if found then return false; end if;
  insert into public.conversation_pins (user_id, kind, thread_key)
  values (auth.uid(), p_kind, p_thread);
  return true;
end;
$$;

create or replace function public.toggle_thread_mute(p_kind text, p_thread text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_kind not in ('group', 'dm') then raise exception 'BAD_TYPE'; end if;
  delete from public.conversation_mutes
  where user_id = auth.uid() and kind = p_kind and thread_key = p_thread;
  if found then return false; end if;
  insert into public.conversation_mutes (user_id, kind, thread_key)
  values (auth.uid(), p_kind, p_thread);
  return true;
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
    where c.user_a = v_user or c.user_b = v_user
  ) x;

  return jsonb_build_object('groups', v_groups, 'dms', coalesce(v_dms, '[]'::jsonb));
end;
$$;

create or replace function public.group_line_too_similar(p_slug text, p_body text)
returns boolean
language plpgsql
stable
as $$
declare
  v text := regexp_replace(lower(coalesce(p_body, '')), '[^a-z0-9çğıöşü]', '', 'g');
  v_hit int;
begin
  v := left(v, 28);
  if length(v) < 10 then return false; end if;
  select count(*) into v_hit
  from public.exam_chat_messages m
  where m.slug = p_slug
    and m.created_at > now() - interval '6 hours'
    and left(regexp_replace(lower(m.body), '[^a-z0-9çğıöşü]', '', 'g'), 28) = v;
  return v_hit > 0;
end;
$$;

create or replace function public.bot_compose_group_message(p_slug text, p_bot uuid, p_attempt int)
returns text
language plpgsql
stable
as $$
declare
  v_name text;
  v_bio text;
  v_recent text := '';
  v_last text := '';
  v_pool text[];
  v_n int;
  v_idx int;
  v_kind text;
begin
  select display_name, coalesce(bio, '') into v_name, v_bio from public.profiles where id = p_bot;
  select string_agg(body, ' | ' order by created_at desc), (array_agg(body order by created_at desc))[1]
  into v_recent, v_last
  from (
    select body, created_at from public.exam_chat_messages where slug = p_slug order by created_at desc limit 10
  ) t;

  if p_slug = 'tyt' then
    v_pool := array[
      'TYT paragraf çözen var mı, ben 20 sorudayım.',
      'Akşam 9 gibi matematik odası açsam gelen olur mu?',
      'Denemede geometri nasıldı sizce?',
      'Ben bugün 30 soru hedefledim, yarısı bitti.',
      'Tarih ezberi mi soru bankası mı daha tutuyor sizde?',
      'Coğrafya harita setine bakıyorum, kimde kaldı?',
      'Türkçe anlam bilgisi bugün biraz yavaş.',
      'TYT mat temele döndüm, birlikte çözen var mı?',
      'Fen için kısa bir tekrar yeterli olur mu sizce?',
      'Deneme sonrası yanlışları ayıklayan var mı?',
      'Paragrafta tempo tutunca net geliyor bende.',
      'Öğleden sonra tarih odası kurmayı düşünüyorum.',
      'Bugün 40 soru hedefim, 18’i bitti.',
      'TYT’de sosyal mi sayısal mı daha zor geliyor size?'
    ];
  elsif p_slug = 'ayt' then
    v_pool := array[
      'AYT fizikte optik biraz ağır bugün.',
      'Kimya mol hesabına döndüm, kim çalışıyor?',
      'Geometri çizmeden gitmeyin, bende net oradan kaçıyor.',
      'Edebiyat notlarını tarayan var mı bu akşam?',
      'Denemede AYT mat nasıldı sizce?',
      'Konu tekrarını bitirip teste geçeceğim.',
      'Netler yerinde durunca moral bozuluyor, kimde öyle?',
      'Biyoloji sistemleri tekrar, kısa set.',
      'Akşam fizik odası açsam gelen olur mu?',
      'Türev-integral setine bakıyorum.',
      'AYT’de yanlış analizini yapan var mı?',
      'Bugün 24 soru hedefledim, 10’u bitti.'
    ];
  else
    v_pool := array[
      'KPSS vatandaşlık maddelerine bakıyorum.',
      'Güncel tarih tekrar, kimde kaldı?',
      'Soru hedefim 40, yarısını kestim.',
      'Akşam deneme çözen var mı?',
      'Çalışma planını netleştiren var mı bu hafta?',
      'Coğrafya harita + iklim, birlikte giden olur mu?',
      'Anayasa tekrarını kısa tutup teste geçeceğim.',
      'Oda açsam KPSS mat çözen gelir mi?',
      'Eğitim bilimleri notları açık bende.',
      'Deneme sonrası yanlış defteri tutan var mı?',
      'Bugün 30 soru, tempo iyi gidiyor.',
      'Planı bozmadan giden var mı bu tempo ile?'
    ];
  end if;

  if v_last ~ '\?' then
    v_pool := v_pool || array[
      'Ben de aynı yerdeyim, yazayım mı neti?',
      'Bende de öyle, sonra odaya geçerim.',
      'Kısa cevap: bende tempo tutunca düzeliyor.'
    ];
  end if;

  if v_bio ilike '%matematik%' or v_name = 'Elif' then
    v_pool := v_pool || array['Matematikte temel set açık, kim girecek?'];
  elsif v_bio ilike '%tarih%' or v_name = 'Mert' then
    v_pool := v_pool || array['Tarih kronolojisi tarıyorum, soru atan var mı?'];
  elsif v_name = 'Ayşe' then
    v_pool := v_pool || array['Harita sorularına bakıyorum, tempo iyi.'];
  elsif v_name = 'Emre' then
    v_pool := v_pool || array['Vatandaşlık kısa tekrar, sonra teste dönerim.'];
  end if;

  if v_recent ilike '%oda%' then
    v_pool := array(select x from unnest(v_pool) x where x not ilike '%oda%');
  end if;
  if v_recent ilike '%20 soru%' or v_recent ilike '%30 soru%' then
    v_pool := array(select x from unnest(v_pool) x where x not ilike '%soru hedef%' and x not ilike '%sorudayım%');
  end if;

  v_n := coalesce(array_length(v_pool, 1), 0);
  if v_n < 1 then return null; end if;
  v_idx := 1 + ((abs(hashtext(p_bot::text || coalesce(v_last, '') || p_attempt::text)) + p_attempt) % v_n);
  v_kind := v_pool[v_idx];
  if v_kind is null then return null; end if;
  if position(left(lower(v_kind), 18) in lower(coalesce(v_recent, ''))) > 0 then
    return null;
  end if;
  return v_kind;
end;
$$;

create or replace function public.pulse_exam_chats()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_slug text;
  v_bot uuid;
  v_prev uuid;
  v_text text;
  v_try int;
begin
  select last_chat_at into v_last from public.bot_clock where id = 1;
  if v_last is not null and v_last > now() - interval '42 seconds' then
    return;
  end if;
  if random() < 0.28 then
    update public.bot_clock set last_chat_at = now() where id = 1;
    return;
  end if;

  select g.slug into v_slug
  from public.exam_chat_groups g
  order by (
    select coalesce(max(m.created_at), '2000-01-01'::timestamptz)
    from public.exam_chat_messages m where m.slug = g.slug
  ) asc, random()
  limit 1;

  if v_slug is null then return; end if;
  select sender_id into v_prev
  from public.exam_chat_messages where slug = v_slug order by created_at desc limit 1;
  if v_prev is not null and (
    select created_at from public.exam_chat_messages where slug = v_slug order by created_at desc limit 1
  ) > now() - interval '22 seconds' then
    return;
  end if;

  select pr.id into v_bot
  from public.profiles pr
  where pr.is_bot
    and pr.id is distinct from v_prev
    and not exists (
      select 1 from public.exam_chat_messages m
      where m.slug = v_slug and m.sender_id = pr.id and m.created_at > now() - interval '7 minutes'
    )
  order by random()
  limit 1;
  if v_bot is null then return; end if;

  v_text := null;
  for v_try in 1..8 loop
    v_text := public.bot_compose_group_message(v_slug, v_bot, v_try);
    exit when v_text is not null and not public.group_line_too_similar(v_slug, v_text);
    v_text := null;
  end loop;
  if v_text is null then return; end if;

  insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
  insert into public.exam_chat_messages (slug, sender_id, body, created_at)
  values (v_slug, v_bot, v_text, now() + make_interval(secs => (4 + floor(random() * 14)::int)));
  update public.bot_clock set last_chat_at = now() where id = 1;
end;
$$;

create or replace function public.rewrite_stale_bot_chat()
returns trigger
language plpgsql
as $$
declare
  v_new text;
begin
  if not exists (select 1 from public.profiles where id = new.sender_id and coalesce(is_bot, false)) then
    return new;
  end if;
  if new.body in ('Bugün 20 soru daha.', 'Deneme analizi yazan var mı?', 'Kaynak dağıtmadan gidin.') then
    v_new := public.bot_compose_group_message(new.slug, new.sender_id, 1);
    if v_new is null or public.group_line_too_similar(new.slug, v_new) then
      return null;
    end if;
    new.body := v_new;
  end if;
  return new;
end;
$$;

drop trigger if exists exam_chat_rewrite_stale on public.exam_chat_messages;
create trigger exam_chat_rewrite_stale
before insert on public.exam_chat_messages
for each row execute procedure public.rewrite_stale_bot_chat();

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
  if p_type not in ('status', 'room_message', 'comment', 'group_message') then raise exception 'BAD_TYPE'; end if;
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

do $$
begin
  alter publication supabase_realtime add table public.exam_chat_messages;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.dm_messages;
exception when duplicate_object then null;
end $$;

revoke all on function public.mark_thread_read(text, text) from public;
revoke all on function public.toggle_thread_pin(text, text) from public;
revoke all on function public.toggle_thread_mute(text, text) from public;
revoke all on function public.get_inbox() from public;
revoke all on function public.pulse_exam_chats() from public;
revoke all on function public.send_group_message(text, text) from public;
revoke all on function public.report_content(text, uuid, text) from public;
grant execute on function public.mark_thread_read(text, text) to authenticated;
grant execute on function public.toggle_thread_pin(text, text) to authenticated;
grant execute on function public.toggle_thread_mute(text, text) to authenticated;
grant execute on function public.get_inbox() to authenticated;
grant execute on function public.pulse_exam_chats() to authenticated;
grant execute on function public.send_group_message(text, text) to authenticated;
grant execute on function public.report_content(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
