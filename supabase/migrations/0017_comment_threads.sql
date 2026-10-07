-- Comment threads, likes, goal label, smarter bot comments, AI flag on feed.
-- Run after 0016.

alter table public.social_posts
  add column if not exists goal_label text;

alter table public.post_comments
  add column if not exists parent_id uuid references public.post_comments(id) on delete cascade;

create table if not exists public.post_comment_likes (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.post_comment_likes enable row level security;
drop policy if exists post_comment_likes_read on public.post_comment_likes;
create policy post_comment_likes_read on public.post_comment_likes for select to authenticated using (true);
drop policy if exists post_comment_likes_write on public.post_comment_likes;
create policy post_comment_likes_write on public.post_comment_likes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists post_comments_parent_idx on public.post_comments (post_id, parent_id, created_at);

delete from public.post_comments a
using public.post_comments b
where a.id > b.id
  and a.post_id = b.post_id
  and a.user_id = b.user_id
  and coalesce(a.parent_id, '00000000-0000-0000-0000-000000000000') = coalesce(b.parent_id, '00000000-0000-0000-0000-000000000000')
  and public.norm_comment(a.body) = public.norm_comment(b.body);

create unique index if not exists post_comments_dedup_idx
  on public.post_comments (
    post_id,
    user_id,
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'),
    md5(public.norm_comment(body))
  );

drop function if exists public.publish_status(text, uuid, int);
drop function if exists public.publish_status(text, uuid, int, text);

create function public.publish_status(
  p_body text,
  p_subject_id uuid,
  p_minutes int,
  p_kind text default 'status',
  p_goal text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'status');
  v_mins int := coalesce(p_minutes, 60);
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.profiles where id = v_user and is_bot) then
    raise exception 'UNAUTHORIZED';
  end if;
  if length(trim(p_body)) < 2 then raise exception 'EMPTY_MESSAGE'; end if;
  if v_mins not in (30, 60, 120, 240) then v_mins := 60; end if;
  if v_kind not in ('status', 'ask', 'activity') then v_kind := 'status'; end if;
  insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at, goal_label)
  values (
    v_user,
    trim(p_body),
    v_kind,
    p_subject_id,
    v_mins,
    now() + make_interval(mins => v_mins),
    nullif(left(trim(coalesce(p_goal, '')), 32), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.add_post_comment(uuid, text);

create function public.add_post_comment(p_post uuid, p_body text, p_parent uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_parent uuid := p_parent;
  v_root uuid;
  v_ppost uuid;
  v_text text := trim(p_body);
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if length(v_text) < 1 then raise exception 'EMPTY_MESSAGE'; end if;
  if v_parent is not null then
    select id, parent_id, post_id into v_root, v_parent, v_ppost
    from public.post_comments where id = p_parent;
    if not found or v_ppost <> p_post then raise exception 'INVALID_PARENT'; end if;
    if v_parent is not null then
      v_root := v_parent;
    end if;
    v_parent := v_root;
  end if;
  select id into v_id
  from public.post_comments
  where post_id = p_post
    and user_id = v_user
    and coalesce(parent_id, '00000000-0000-0000-0000-000000000000') = coalesce(v_parent, '00000000-0000-0000-0000-000000000000')
    and public.norm_comment(body) = public.norm_comment(v_text)
    and created_at > now() - interval '2 minutes'
  limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.post_comments (post_id, user_id, body, parent_id)
  values (p_post, v_user, v_text, v_parent)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.toggle_comment_like(p_comment uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.post_comment_likes where comment_id = p_comment and user_id = v_user) then
    delete from public.post_comment_likes where comment_id = p_comment and user_id = v_user;
    return false;
  end if;
  insert into public.post_comment_likes (comment_id, user_id) values (p_comment, v_user);
  return true;
end;
$$;

create or replace function public.infer_post_topic(p_body text, p_tag text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(coalesce(p_body, ''));
  v_hit text := null;
begin
  if v ~ 'geometri|üçgen|ucgen|daire|açı' then v_hit := 'Geometri';
  elsif v ~ 'matematik|\mmat\M|polinom|türev|integral|fonksiyon' then v_hit := 'Matematik';
  elsif v ~ 'fizik|optik|kuvvet|hareket' then v_hit := 'Fizik';
  elsif v ~ 'kimya|mol |atom|asit' then v_hit := 'Kimya';
  elsif v ~ 'biyoloji|dna|hücre' then v_hit := 'Biyoloji';
  elsif v ~ 'coğrafya|cografya|harita|iklim' then v_hit := 'Coğrafya';
  elsif v ~ 'tarih|osmanlı|inkılap' then v_hit := 'Tarih';
  elsif v ~ 'paragraf|türkçe|turkce|edebiyat' then v_hit := 'Türkçe';
  elsif v ~ 'vatandaşlık|anayasa|kpss' then v_hit := 'Vatandaşlık';
  end if;
  if v_hit is not null then
    return v_hit;
  end if;
  if p_tag is not null and length(trim(p_tag)) > 1 then
    return trim(p_tag);
  end if;
  return 'çalışma';
end;
$$;

create or replace function public.bot_compose_comment(
  p_post uuid,
  p_bot uuid,
  p_intent text,
  p_attempt int
)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_body text := '';
  v_tag text := '';
  v_kind text := 'status';
  v_topic text;
  v_persona text := '';
  v_name text := 'Öğrenci';
  v_recent text := '';
  v_last text := '';
  v_pool text[];
  v_n int;
  v_idx int;
begin
  select coalesce(p.body, ''), coalesce(sub.name, ''), coalesce(p.kind, 'status')
    into v_body, v_tag, v_kind
  from public.social_posts p
  left join public.subjects sub on sub.id = p.subject_id
  where p.id = p_post;
  if not found then return null; end if;

  v_topic := public.infer_post_topic(v_body, v_tag);

  select coalesce(display_name, 'Öğrenci'), coalesce(bio, '')
    into v_name, v_persona
  from public.profiles where id = p_bot;

  select string_agg(c.body, ' | ' order by c.created_at desc), (array_agg(c.body order by c.created_at desc))[1]
    into v_recent, v_last
  from (
    select body, created_at from public.post_comments
    where post_id = p_post and created_at <= now()
    order by created_at desc
    limit 6
  ) c;

  if v_last is not null and p_intent in ('encourage', 'advice') then
    v_pool := array[
      format('Katılıyorum, %s tarafında bu tempo tutar.', v_topic),
      format('Üstteki yoruma ek: %s’de kaynak dağıtmadan devam.', v_topic),
      'Aynı fikirdeyim, kısa set daha iyi bugün.'
    ];
  elsif p_intent = 'join' then
    v_pool := array[
      format('%s çalışacak yer varsa yazarım.', v_topic),
      format('Aynı dersteyim: %s. Oda açarsan bakarım.', v_topic),
      format('%s için 2 kişi yeter, yazın.', v_topic)
    ];
  elsif p_intent = 'question' and p_attempt = 1 then
    v_pool := array[
      format('%s’de konu mu yoksa soru mu ağırlıkta?', v_topic),
      'Kaynağın hangisi, ona göre bakayım.'
    ];
  elsif p_intent = 'progress' then
    v_pool := array[
      format('Ben de %s’deyim, 12 soru oldu.', v_topic),
      format('%s setinde net az az çıkıyor.', v_topic),
      coalesce(nullif(v_persona, ''), format('%s çalışıyorum.', v_topic))
    ];
  else
    v_pool := array[
      format('%s için 15 soru + hata defteri yeter.', v_topic),
      format('Tempo iyi. %s’de kopma.', v_topic),
      'Mola kısa tut, sonra aynı sete dön.',
      format('%s zor gelse de masa başı kazandırır.', v_topic)
    ];
  end if;

  v_pool := array_remove(v_pool, null);
  v_n := coalesce(array_length(v_pool, 1), 0);
  if v_n < 1 then return null; end if;
  v_idx := 1 + ((floor(random() * v_n)::int + p_attempt - 1) % v_n);
  return v_pool[v_idx];
end;
$$;

create or replace function public.pulse_bots()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last timestamptz;
  v_bot uuid;
  v_human uuid;
  v_post uuid;
  v_body text;
  v_sub uuid;
  v_tag text;
  v_kind text;
  v_mins int;
  v_prompt text;
  v_session uuid;
  v_qid uuid;
  v_correct text;
  v_pick text;
  v_sess public.study_sessions%rowtype;
  v_slug text;
  v_budget int;
  v_placed int := 0;
  v_intent text;
  v_used text[] := '{}';
  v_text text;
  v_try int;
  v_delay int;
  v_name text;
  v_bio text;
  v_roll float;
  v_parent uuid;
  v_bots_on_post int;
begin
  select last_pulse_at into v_last from public.bot_clock where id = 1;
  if v_last is not null and v_last > now() - interval '90 seconds' then
    return;
  end if;
  update public.bot_clock set last_pulse_at = now() where id = 1;

  if random() < 0.38 then
    select id, display_name, coalesce(bio, '') into v_bot, v_name, v_bio
    from public.profiles where is_bot order by random() limit 1;
    if v_bot is not null then
      v_mins := (array[30, 60, 120, 240])[1 + floor(random() * 4)::int];
      v_prompt := case
        when v_bio ilike '%matematik%' or v_name = 'Elif' then (array['Matematikte 20 soru daha.','Polinom setine bakıyorum.','Bugün mat netini yokluyorum.'])[1 + floor(random()*3)::int]
        when v_bio ilike '%tarih%' or v_name = 'Mert' then (array['Tarih tekrarındayım.','Osmanlı kronolojisi açık.','Tarihte neredesiniz?'])[1 + floor(random()*3)::int]
        when v_bio ilike '%coğrafya%' or v_name = 'Ayşe' then (array['Coğrafya çalışacak var mı?','Harita başındayım.','İklim sorularına bakıyorum.'])[1 + floor(random()*3)::int]
        when v_bio ilike '%paragraf%' or v_name = 'Can' then (array['Paragraf seti çözüyorum.','Türkçe 15 soru hedefim.','Anlam bilgisi tarıyorum.'])[1 + floor(random()*3)::int]
        when v_bio ilike '%fizik%' or v_name = 'Zeynep' then (array['AYT fizik testine bakıyorum.','Optik biraz ağır bugün.','Fizikte 12 soru.'])[1 + floor(random()*3)::int]
        when v_name = 'Emre' then (array['Vatandaşlık tekrar.','KPSS günü, kısa set.','Anayasa maddeleri.'])[1 + floor(random()*3)::int]
        when v_name = 'Defne' then (array['Kimya formülleri açık.','Mol hesabı çalışıyorum.','Kimyada 10 soru.'])[1 + floor(random()*3)::int]
        when v_name = 'Kaan' then (array['Geometri çiziyorum.','Üçgen benzerliği.','Geometride 8 soru kaldı.'])[1 + floor(random()*3)::int]
        when v_name = 'Selin' then (array['Edebiyat notları.','Şiir bilgisi tarıyorum.','Türkçe edebiyat tekrar.'])[1 + floor(random()*3)::int]
        else (array['Deneme analizi yapıyorum.','Bugünkü hedef 40 soru.','Kısa mola, sonra devam.'])[1 + floor(random()*3)::int]
      end;
      select s.id into v_sub
      from public.subjects s
      where s.name ilike '%' || public.infer_post_topic(v_prompt, null) || '%'
      order by random()
      limit 1;
      if v_sub is null then
        select s.id into v_sub from public.subjects s order by random() limit 1;
      end if;
      insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at)
      values (v_bot, v_prompt, 'status', v_sub, v_mins, now() + make_interval(mins => v_mins));
    end if;
  end if;

  if random() < 0.28 then
    v_budget := 0;
  elsif random() < 0.62 then
    v_budget := 2;
  else
    v_budget := 3;
  end if;

  for v_post, v_body, v_human, v_kind, v_tag in
    select p.id, p.body, p.user_id, p.kind, coalesce(sub.name, '')
    from public.social_posts p
    left join public.subjects sub on sub.id = p.subject_id
    where (p.expires_at is null or p.expires_at > now())
      and p.kind in ('status', 'ask', 'activity')
      and p.created_at < now() - interval '50 seconds'
    order by p.created_at desc
    limit 8
  loop
    exit when v_placed >= v_budget;
    if random() < 0.34 then
      continue;
    end if;

    select count(*) into v_bots_on_post
    from public.post_comments c
    join public.profiles b on b.id = c.user_id and b.is_bot
    where c.post_id = v_post;
    if v_bots_on_post >= 2 then
      continue;
    end if;

    v_used := '{}';
    for v_bot in
      select pr.id
      from public.profiles pr
      where pr.is_bot
        and pr.id <> v_human
        and not exists (select 1 from public.post_comments c where c.post_id = v_post and c.user_id = pr.id)
        and not exists (
          select 1 from public.post_comments c
          where c.user_id = pr.id and c.created_at > now() - interval '3 minutes'
        )
      order by random()
      limit 2
    loop
      exit when v_placed >= v_budget;
      v_roll := random();
      if v_roll < 0.3 then
        continue;
      end if;
      insert into public.post_likes (post_id, user_id) values (v_post, v_bot) on conflict do nothing;
      if v_roll < 0.62 then
        continue;
      end if;

      v_intent := (array['join','encourage','progress','advice','question'])[1 + floor(random() * 5)::int];
      if v_intent = any(v_used) then
        v_intent := 'encourage';
      end if;
      if v_intent = 'question' and 'question' = any(v_used) then
        v_intent := 'advice';
      end if;
      v_used := v_used || v_intent;

      v_text := null;
      for v_try in 1..6 loop
        v_text := public.bot_compose_comment(v_post, v_bot, v_intent, v_try);
        exit when v_text is not null and not public.comment_too_similar(v_post, v_text);
        v_text := null;
      end loop;
      if v_text is null then
        continue;
      end if;

      v_parent := null;
      if random() < 0.45 then
        select c.id into v_parent
        from public.post_comments c
        join public.profiles a on a.id = c.user_id
        where c.post_id = v_post and c.parent_id is null and not a.is_bot and c.created_at <= now()
        order by c.created_at desc
        limit 1;
      end if;

      v_delay := 8 + v_placed * 20 + floor(random() * 16)::int;
      begin
        insert into public.post_comments (post_id, user_id, body, parent_id, created_at)
        values (v_post, v_bot, v_text, v_parent, now() + make_interval(secs => v_delay));
        v_placed := v_placed + 1;
      exception when unique_violation then
        null;
      end;
      exit;
    end loop;
  end loop;

  select s.id into v_session
  from public.study_sessions s
  where s.mode = 'exam' and s.status = 'waiting'
    and (select count(*) from public.study_session_members m where m.session_id = s.id) < s.capacity
  order by random() limit 1;
  if v_session is not null then
    select id into v_bot from public.profiles where is_bot
      and not exists (select 1 from public.study_session_members m where m.session_id = v_session and m.user_id = profiles.id)
    order by random() limit 1;
    if v_bot is not null then
      insert into public.study_session_members (session_id, user_id) values (v_session, v_bot) on conflict do nothing;
    end if;
  end if;

  for v_sess in
    select * from public.study_sessions where mode in ('race', 'exam') and status = 'active'
  loop
    perform public.maybe_activate_session(v_sess.id);
    v_qid := v_sess.question_ids[v_sess.current_index + 1];
    if v_qid is null then continue; end if;
    select correct_choice into v_correct from public.questions where id = v_qid;
    for v_bot in
      select m.user_id from public.study_session_members m
      join public.profiles p on p.id = m.user_id
      where m.session_id = v_sess.id and p.is_bot
        and not exists (
          select 1 from public.study_session_answers a
          where a.session_id = v_sess.id and a.question_id = v_qid and a.user_id = m.user_id
        )
    loop
      if public.bot_should_miss(v_sess.id, v_bot, v_sess.current_index, coalesce(array_length(v_sess.question_ids, 1), 10)) then
        if random() < 0.45 then continue; end if;
        v_pick := case upper(coalesce(v_correct, 'A'))
          when 'A' then 'C' when 'B' then 'D' when 'C' then 'A' when 'D' then 'B' else 'A' end;
      else
        v_pick := upper(coalesce(v_correct, 'A'));
      end if;
      insert into public.study_session_answers (session_id, question_id, user_id, selected_choice, is_correct)
      values (v_sess.id, v_qid, v_bot, v_pick, upper(v_pick) = upper(coalesce(v_correct, '')))
      on conflict do nothing;
    end loop;
    perform public.advance_competitive(v_sess.id);
  end loop;

  if random() < 0.3 then
    select id, display_name into v_bot, v_name from public.profiles where is_bot order by random() limit 1;
    v_slug := (array['tyt','ayt','kpss'])[1 + floor(random()*3)::int];
    if v_bot is not null then
      insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
      insert into public.exam_chat_messages (slug, sender_id, body)
      values (
        v_slug, v_bot,
        (array['Bugün 20 soru daha.','Deneme analizi yazan var mı?','Kaynak dağıtmadan gidin.'])[1 + floor(random()*3)::int]
      );
    end if;
  end if;
end;
$$;

create or replace function public.get_social_feed()
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
        p.id,
        p.user_id,
        p.body,
        p.kind,
        p.created_at,
        p.subject_id,
        p.session_id,
        p.capacity,
        p.duration_minutes,
        p.expires_at,
        p.goal_label,
        a.display_name,
        a.display_tag,
        a.current_xp,
        a.is_bot,
        sub.name as subject_name,
        (select count(*) from public.post_likes l where l.post_id = p.id)::int as like_count,
        (select count(*) from public.post_comments c where c.post_id = p.id and c.created_at <= now())::int as comment_count,
        exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = v_user) as liked_by_me,
        (
          select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
          from (
            select
              cm.id,
              cm.user_id,
              cm.body,
              cm.created_at,
              pr.display_name,
              pr.display_tag,
              pr.is_bot
            from public.post_comments cm
            join public.profiles pr on pr.id = cm.user_id
            where cm.post_id = p.id
              and cm.parent_id is null
              and cm.created_at <= now()
            order by cm.created_at
            limit 2
          ) c
        ) as comment_preview
      from public.social_posts p
      join public.profiles a on a.id = p.user_id
      left join public.subjects sub on sub.id = p.subject_id
      where (p.expires_at is null or p.expires_at > now())
        and not exists (
          select 1 from public.user_blocks b
          where b.blocker_id = v_user and b.blocked_id = p.user_id
        )
      order by (not a.is_bot) desc, p.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.publish_status(text, uuid, int, text, text) to authenticated;
grant execute on function public.add_post_comment(uuid, text, uuid) to authenticated;
grant execute on function public.toggle_comment_like(uuid) to authenticated;
grant execute on function public.pulse_bots() to authenticated;
grant execute on function public.get_social_feed() to authenticated;
