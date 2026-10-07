-- Diverse bot comments, staggered replies, story tags on feed.
-- Run after 0014.

create or replace function public.norm_comment(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(p, ''))), '[^a-z0-9çğıöşüâîû[:space:]]', '', 'g');
$$;

create or replace function public.comment_too_similar(p_post uuid, p_body text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.post_comments c
    where c.post_id = p_post
      and (
        public.norm_comment(c.body) = public.norm_comment(p_body)
        or left(public.norm_comment(c.body), 20) = left(public.norm_comment(p_body), 20)
        or (
          length(public.norm_comment(p_body)) >= 14
          and position(left(public.norm_comment(p_body), 16) in public.norm_comment(c.body)) > 0
        )
      )
  );
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
  v_sub text := 'ders';
  v_persona text := '';
  v_name text := 'Öğrenci';
  v_recent text := '';
  v_pool text[];
  v_n int;
  v_idx int;
begin
  select coalesce(p.body, ''), coalesce(sub.name, 'ders')
    into v_body, v_sub
  from public.social_posts p
  left join public.subjects sub on sub.id = p.subject_id
  where p.id = p_post;
  if not found then
    return null;
  end if;

  select coalesce(display_name, 'Öğrenci'), coalesce(bio, '')
    into v_name, v_persona
  from public.profiles where id = p_bot;

  select string_agg(c.body, ' | ' order by c.created_at desc)
    into v_recent
  from (
    select body, created_at from public.post_comments
    where post_id = p_post and created_at <= now()
    order by created_at desc
    limit 6
  ) c;

  if p_intent = 'join' then
    v_pool := array[
      format('Yer varsa %s odasına geçerim, birlikte gidelim.', v_sub),
      format('%s çalışacak biri daha var, yazın katılayım.', v_sub),
      format('Aynı dersteyim. Oda açarsan %s için gelirim.', v_sub),
      format('Ben de bu tempoya uyuyorum, 2 kişilik oda yeter.', v_sub),
      format('%s’de yalnız çözmeyeyim, birazdan bakarım.', v_name)
    ];
  elsif p_intent = 'question' then
    v_pool := array[
      format('%s’de tam neredesin, konu mu yoksa soru mu?', v_sub),
      format('Hangi kaynaktan gidiyorsun? %s setini sorayım.', v_sub),
      'Kaç net hedefledin bugün, 20 mi 40 mı?',
      format('Bu posttaki tempoyu anlamadım, %s mi bitiyor?', v_sub),
      'Deneme mi yoksa konu tekrarı mı? Ona göre bakayım.'
    ];
  elsif p_intent = 'encourage' then
    v_pool := array[
      'Tempo iyi duruyor, mola vermeden 25 dk daha.',
      format('%s böyle gidince akşam rahatlar. Devam.', v_sub),
      'Yorulduysan 8 soru daha, sonra kısa çay.',
      'Bu cümle tanıdık geldi, aynı yerdeyim. Kopma.',
      format('%s zor gününde de masa başı kazandırır.', v_sub)
    ];
  elsif p_intent = 'progress' then
    v_pool := array[
      format('Ben %s’de 18 soru işaretledim, sen neredesin?', v_sub),
      'Bugün 30 soru doldu, birazdan deneme bakacağım.',
      format('%s formüllerini az önce taradım, net artıyor gibi.', v_sub),
      'Sabah zayıf başladım, öğleden sonra toparladım.',
      format('Persona notum: %s. Aynı çizgideyim.', nullif(v_persona, '') )
    ];
  else
    v_pool := array[
      format('%s’de video değil, 15 soru + hata defteri daha iyi.', v_sub),
      'Yanlışları kırmızıya alma, aynı tipi 5 dk sonra tekrar çöz.',
      format('Mola 10 dk’yı geçmesin, %s setine dön.', v_sub),
      'Kaynak dağıtma. Bir kitap, bir deneme yeter bugün.',
      format('Paragraf gibi okuma: %s’de önce kolaydan başla.', v_sub)
    ];
  end if;

  v_pool := array_remove(v_pool, null);
  if v_body ilike '%mola%' or v_body ilike '%kahve%' then
    v_pool := v_pool || array['Kısa mola tamam, 12 soruya dönünce yaz.']::text[];
  end if;
  if v_body ilike '%deneme%' then
    v_pool := v_pool || array['Deneme sonrası branş branş bak, toplam netle avunma.']::text[];
  end if;
  if v_recent ilike '%katıl%' then
    v_pool := array_remove(v_pool, v_pool[1]);
  end if;

  v_n := coalesce(array_length(v_pool, 1), 0);
  if v_n < 1 then
    return format('%s tarafındayım, sonra yazacağım.', v_sub);
  end if;
  v_idx := 1 + abs(hashtext(p_bot::text || p_post::text || p_intent || coalesce(v_recent, '') || p_attempt::text)) % v_n;
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
begin
  select last_pulse_at into v_last from public.bot_clock where id = 1;
  if v_last is not null and v_last > now() - interval '90 seconds' then
    return;
  end if;
  update public.bot_clock set last_pulse_at = now() where id = 1;

  if random() < 0.42 then
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
      select s.id into v_sub from public.subjects s order by random() limit 1;
      insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at)
      values (v_bot, v_prompt, 'status', v_sub, v_mins, now() + make_interval(mins => v_mins));
    end if;
  end if;

  if random() < 0.22 then
    v_budget := 0;
  elsif random() < 0.55 then
    v_budget := 2;
  else
    v_budget := 4;
  end if;

  for v_post, v_body, v_human in
    select p.id, p.body, p.user_id
    from public.social_posts p
    where (p.expires_at is null or p.expires_at > now())
      and p.kind in ('status', 'ask', 'activity')
      and p.created_at < now() - interval '40 seconds'
    order by p.created_at desc
    limit 8
  loop
    exit when v_placed >= v_budget;
    if random() < 0.3 then
      continue;
    end if;
    if exists (
      select 1 from public.post_comments c
      join public.profiles b on b.id = c.user_id and b.is_bot
      where c.post_id = v_post and c.created_at > now() - interval '50 seconds'
    ) then
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
          where c.user_id = pr.id and c.created_at > now() - interval '2 minutes'
        )
      order by random()
      limit 3
    loop
      exit when v_placed >= v_budget;
      insert into public.post_likes (post_id, user_id) values (v_post, v_bot) on conflict do nothing;

      v_intent := (array['join','question','encourage','progress','advice'])[
        1 + floor(random() * 5)::int
      ];
      if v_intent = any(v_used) then
        v_intent := (array['join','question','encourage','progress','advice'])[
          1 + (coalesce(array_position(array['join','question','encourage','progress','advice'], v_intent), 1) % 5)
        ];
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

      v_delay := 12 + v_placed * 22 + floor(random() * 18)::int;
      insert into public.post_comments (post_id, user_id, body, created_at)
      values (v_post, v_bot, v_text, now() + make_interval(secs => v_delay));
      v_placed := v_placed + 1;
      if random() < 0.45 then
        exit;
      end if;
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
        if random() < 0.45 then
          continue;
        end if;
        v_pick := case upper(coalesce(v_correct, 'A'))
          when 'A' then 'C'
          when 'B' then 'D'
          when 'C' then 'A'
          when 'D' then 'B'
          else 'A'
        end;
      else
        v_pick := upper(coalesce(v_correct, 'A'));
      end if;
      insert into public.study_session_answers (session_id, question_id, user_id, selected_choice, is_correct)
      values (v_sess.id, v_qid, v_bot, v_pick, upper(v_pick) = upper(coalesce(v_correct, '')))
      on conflict do nothing;
    end loop;
    perform public.advance_competitive(v_sess.id);
  end loop;

  if random() < 0.35 then
    select id, display_name into v_bot, v_name from public.profiles where is_bot order by random() limit 1;
    v_slug := (array['tyt','ayt','kpss'])[1 + floor(random()*3)::int];
    if v_bot is not null then
      insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
      insert into public.exam_chat_messages (slug, sender_id, body)
      values (
        v_slug,
        v_bot,
        (array[
          format('%s tarafındayım, 20 soru daha.', coalesce(v_name, 'Bugün')),
          'Kim coğrafya odası açtı?',
          'Deneme analizi yazan var mı?',
          'Mat seti nasıl gidiyor, kaynak dağıtmayın.'
        ])[1 + floor(random()*4)::int]
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
        a.display_name,
        a.display_tag,
        a.current_xp,
        sub.name as subject_name,
        (select count(*) from public.post_likes l where l.post_id = p.id)::int as like_count,
        (select count(*) from public.post_comments c where c.post_id = p.id and c.created_at <= now())::int as comment_count,
        exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = v_user) as liked_by_me
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
        a.display_name,
        a.display_tag
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

grant execute on function public.pulse_bots() to authenticated;
grant execute on function public.get_social_feed() to authenticated;
grant execute on function public.get_stories() to authenticated;
