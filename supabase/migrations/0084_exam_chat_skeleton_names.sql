-- Fix came_to_mind: strip names/quotes before skeleton; never paraphrase that idea;
-- on collision switch INTENT; drop too-similar inserts instead of rewriting them.

create or replace function public.exam_chat_prepare_text(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := coalesce(p, '');
begin
  v := regexp_replace(v, '"[^"]*"', ' ', 'g');
  v := regexp_replace(v, E'\u201c[^\u201d]*\u201d', ' ', 'g');
  v := regexp_replace(v, E'\u00ab[^\u00bb]*\u00bb', ' ', 'g');
  v := regexp_replace(v, '''[^'']*''', ' ', 'g');
  v := lower(translate(v, 'İIıÂâÊêÛûÔôÇçĞğÖöŞşÜü', 'iii aaeeuuo ccgg oossuu'));
  v := regexp_replace(v, '[[:alpha:]]+[[:digit:]]+', ' ', 'g');
  v := regexp_replace(v, '(^|[[:space:]])(sen|sana|bana|ona)([[:space:]]|$)', ' ', 'g');
  v := regexp_replace(v, '[0-9]+', '#', 'g');
  v := regexp_replace(v, '(matematik|geometri|paragraf|biyoloji|fizik|kimya|tarih|cografya|turkce|edebiyat|fen|deneme|vatandaslik|problem|ucgen)', '$d', 'g');
  v := regexp_replace(v, '[^a-z$# ]', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  return trim(v);
end;
$$;

create or replace function public.exam_chat_skeleton(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := public.exam_chat_prepare_text(p);
begin
  if v ~ 'aklima geldi' or v ~ 'anlatinca' then return 'came_to_mind'; end if;
  if v ~ 'ayni \$d yerinden devam' or v ~ 'ayni .* yerinden devam' then return 'continue_same_place'; end if;
  if v ~ 'gitmiyorsa.*soru.*birak' then return 'solve_then_quit'; end if;
  if v ~ 'birakmayin.*deneme' then return 'dont_quit_exam'; end if;
  if v ~ '(^| )hedef #' or v ~ 'bugunku hedef' then return 'goal_number'; end if;
  if public.exam_chat_is_numeric_progress(p) then return 'numeric_progress:' || left(v, 18); end if;
  if v ~ 'gectim' and not public.exam_chat_has_bridge(p) then return 'bare_subject_shift'; end if;
  if v ~ 'hangi konu' then return 'which_topic'; end if;
  if v ~ 'zorladi mi' then return 'was_it_hard'; end if;
  if v ~ 'kac soru kaldi' then return 'how_many_left'; end if;
  if v ~ 'bende de (oyle|ayni|benzer)' then return 'me_too_same'; end if;
  if v ~ '^aynen( ya)?$' then return 'aynen'; end if;
  return left(v, 28);
end;
$$;

create or replace function public.exam_chat_banned(p text)
returns boolean
language sql
immutable
as $$
  select public.exam_chat_norm(p) in (
    public.exam_chat_norm('Bugün 20 soru daha.'),
    public.exam_chat_norm('Kaynak dağıtmadan gidin.'),
    public.exam_chat_norm('Matematik seti nasıl gidiyor?'),
    public.exam_chat_norm('Kim oda açtı?'),
    public.exam_chat_norm('Kim coğrafya odası açtı?'),
    public.exam_chat_norm('Deneme analizi yazan var mı?'),
    public.exam_chat_norm('Bugün 30 soru hedefim.')
  )
  or public.exam_chat_norm(p) like '%20sorudaha%'
  or public.exam_chat_norm(p) like '%kaynakdagitmadan%'
  or public.exam_chat_norm(p) like '%matematiksetinasil%'
  or public.exam_chat_skeleton(p) in (
    'continue_same_place', 'solve_then_quit', 'dont_quit_exam', 'goal_number', 'came_to_mind'
  );
$$;

create or replace function public.group_line_too_similar(p_slug text, p_body text)
returns boolean
language plpgsql
stable
as $$
declare
  v text := public.exam_chat_norm(p_body);
  v_sk text := public.exam_chat_skeleton(p_body);
  v_exact int;
  v_sk_n int;
  v_pref int;
begin
  if public.exam_chat_banned(p_body) then return true; end if;
  select
    count(*) filter (where public.exam_chat_norm(t.body) = v),
    count(*) filter (where public.exam_chat_skeleton(t.body) = v_sk),
    count(*) filter (
      where length(v) >= 12
        and left(public.exam_chat_norm(t.body), 16) = left(v, 16)
    )
  into v_exact, v_sk_n, v_pref
  from (
    select body
    from public.exam_chat_messages
    where slug = p_slug
      and created_at <= clock_timestamp()
    order by created_at desc, id desc
    limit 40
  ) t;
  if v_exact > 0 then return true; end if;
  if v_sk_n > 0 then return true; end if;
  return v_pref > 0;
end;
$$;

create or replace function public.exam_chat_quality_fail(
  p_slug text,
  p_bot uuid,
  p_body text,
  p_prev text,
  p_thread text,
  p_intent text
)
returns boolean
language plpgsql
stable
as $$
begin
  if public.exam_chat_banned(p_body) then return true; end if;
  if public.exam_chat_skeleton(p_body) = 'came_to_mind' then return true; end if;
  if public.group_line_too_similar(p_slug, p_body) then return true; end if;
  if coalesce(p_prev, '') <> '' and public.exam_chat_echoes_prev(p_body, p_prev) then
    return true;
  end if;
  if p_intent in ('react', 'agree', 'ask_followup', 'own_experience') then
    return public.exam_chat_vague(p_body, p_prev) and public.exam_chat_words(p_body) > 8;
  end if;
  if p_intent in ('change_topic', 'invite_to_room', 'joke') then
    if p_intent = 'change_topic' and not public.exam_chat_has_bridge(p_body) then return true; end if;
    return false;
  end if;
  return public.exam_chat_vague(p_body, p_prev);
end;
$$;

create or replace function public.rewrite_stale_bot_chat()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.profiles where id = new.sender_id and coalesce(is_bot, false)) then
    return new;
  end if;
  if public.exam_chat_skeleton(new.body) = 'came_to_mind' then
    return null;
  end if;
  if public.group_line_too_similar(new.slug, new.body) then
    return null;
  end if;
  if public.exam_chat_banned(new.body) then
    return null;
  end if;
  return new;
end;
$$;

create or replace function public.exam_chat_compose(
  p_slug text,
  p_bot uuid,
  p_attempt int,
  p_intent text,
  p_thread text,
  p_reply_body text,
  p_reply_name text
)
returns text
language plpgsql
as $$
declare
  v_voice text := public.exam_chat_voice(p_bot);
  v_mem public.exam_bot_memory;
  v_intent text := coalesce(p_intent, 'react');
  v_thread text := coalesce(p_thread, 'genel');
  v_title text;
  v_from text;
  v_line text;
  v_choices text[];
  i int;
begin
  v_mem := public.exam_chat_ensure_memory(p_bot, p_slug);
  v_title := public.exam_chat_thread_title(p_slug, v_thread);
  v_from := coalesce(
    public.exam_chat_thread_title(p_slug, public.exam_chat_thread_from_text(p_slug, p_reply_body)),
    (select public.exam_chat_thread_title(p_slug, current_thread) from public.exam_chat_room_state where slug = p_slug),
    'matematik'
  );
  if v_from = v_title then v_from := 'önceki set'; end if;
  if p_attempt > 1 then
    v_intent := (array['ask_followup','react','own_experience','share_progress','joke'])[1 + ((p_attempt - 1) % 5)];
  end if;
  if v_intent = 'share_progress' and public.exam_chat_progress_blocked(p_bot, p_slug) then
    v_intent := 'own_experience';
  end if;

  if v_intent = 'ask_followup' then
    v_choices := array[
      'tempo nasıl?','hangi setteydin','kolay mıydı o','kitaptan mı bakıyosun',
      'video mu çözdün','sen neredesin şimdi','kaçıncı sorudasın','oturdu mu sende',
      'kaynak değiştin mi','net tuttu mu','süre yetti mi','mola verdin mi',
      'hangi yayından gidiyosun','konu tarama mı o'
    ];
  elsif v_intent = 'own_experience' then
    v_choices := array[
      'bende tempo başka bugün', v_title || ' tarafında takıldım biraz',
      'kısa set tuttum idare','kafam dağınık az önce','video çözüp kestim',
      'ben ayrı yerdeyim bugün','çay koyup döndüm şimdi','sabah setini yarıda bıraktım',
      'akşam tekrarını erteledim','ben kartlara döndüm'
    ];
  elsif v_intent in ('react','agree') then
    v_choices := array[
      'hm idare','dur bakim','tamam ya','olay bu kadar','ben saldım biraz',
      'bugün hiç gitmiyor','sessiz devam','anladım ya','idare ediyor','boşver uzatma'
    ];
  elsif v_intent in ('change_topic','shift_topic') then
    v_choices := array[
      v_from || ' baydı, ' || v_title || 'ye geçtim biraz',
      v_from || ' tıkanınca ' || v_title || ' açtım',
      v_from || ' yavaş gidince ' || v_title || 'ye döndüm',
      'biraz ' || v_from || ' bıraktım, ' || v_title || ' bakıyorum'
    ];
  elsif v_intent = 'share_progress' then
    v_choices := array[
      v_title || ' tarafı ağır geldi bugün','tempo düşük ama durmadım',
      'seti yarıda kestim idare','az kaldı kestim bugün','bugün kısa tuttum bitirdim',
      'üçüncü turdayım idare','ilk set bitti gibi'
    ];
  elsif v_intent in ('continue_previous','continue_topic','answer','answer_question') then
    v_choices := array[
      'kısa tutunca bende oturuyor','ben yavaş yavaş toparlarım','devam ediyom sessiz',
      'idare, komple salmadım','tempo gelir birazdan'
    ];
  elsif v_intent = 'encourage' then
    v_choices := array['kısa tut yeter','tempo gelir','devam et bence','yavaş da olsa yeter'];
  elsif v_intent = 'joke' then
    v_choices := array['ders bugün kişisel algıdı','kapatıp çay koyucam nerdeyse','abartmayayım olay bu'];
  else
    v_choices := array['hm ya','dur bakim','idare bugün','sessizim biraz'];
  end if;

  v_line := null;
  for i in 0..array_length(v_choices, 1) + 6 loop
    v_line := v_choices[1 + ((p_attempt + i + floor(random() * 11)::int) % array_length(v_choices, 1))];
    v_line := public.exam_chat_texture(v_voice, v_line);
    if v_line is not null
      and public.exam_chat_skeleton(v_line) <> 'came_to_mind'
      and not public.exam_chat_quality_fail(p_slug, p_bot, v_line, p_reply_body, v_thread, v_intent) then
      exit;
    end if;
    v_line := null;
  end loop;
  if v_line is null then return null; end if;

  update public.exam_bot_memory
  set recent = (ARRAY[v_line] || coalesce(recent, '{}'::text[]))[1:8],
      last_meaning = v_line,
      updated_at = now()
  where bot_id = p_bot and slug = p_slug;
  return v_line;
end;
$$;

create or replace function public.exam_chat_naturalness_test(p_n int default 50, p_slug text default 'tyt')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
  n_ok int := 0;
  v jsonb;
  rec record;
  prev_body text := '';
  prev_sk text := '';
  v_sks text[] := '{}';
  v_repeat int := 0;
  v_echo int := 0;
  v_came int := 0;
  v_mirror int := 0;
  v_fail text[] := '{}';
  v_mark timestamptz := clock_timestamp();
  v_hit int;
begin
  update public.exam_chat_room_state
  set next_eligible_at = clock_timestamp(), burst_left = 0, burst_plan = '{}'
  where slug = p_slug;

  for i in 1..(greatest(p_n, 1) * 10) loop
    exit when n_ok >= p_n;
    v := public.pulse_exam_chats(true, p_slug);
    if coalesce(v->>'ok', '') = 'true' then n_ok := n_ok + 1; end if;
  end loop;

  for rec in
    select m.body from public.exam_chat_messages m
    where m.slug = p_slug and m.created_at >= v_mark
    order by m.created_at, m.id
    limit p_n
  loop
    prev_sk := public.exam_chat_skeleton(rec.body);
    if prev_sk = 'came_to_mind' then v_came := v_came + 1; end if;
    if prev_body <> '' and public.exam_chat_echoes_prev(rec.body, prev_body) then v_echo := v_echo + 1; end if;
    if prev_sk = 'came_to_mind' and public.exam_chat_skeleton(prev_body) = 'came_to_mind' then
      v_mirror := v_mirror + 1;
    end if;
    v_hit := 0;
    if coalesce(array_length(v_sks, 1), 0) > 0 then
      select count(*) into v_hit from unnest(v_sks[greatest(1, coalesce(array_length(v_sks, 1), 0) - 39):]) s(sk) where s.sk = prev_sk;
      if v_hit > 0 then v_repeat := v_repeat + 1; end if;
    end if;
    v_sks := v_sks || prev_sk;
    prev_body := rec.body;
  end loop;

  if n_ok < p_n then v_fail := v_fail || array['INSUFFICIENT_MESSAGES']; end if;
  if v_repeat > 0 then v_fail := v_fail || array['PHRASE_PATTERN_REPEAT']; end if;
  if v_echo > greatest(3, n_ok / 10) then v_fail := v_fail || array['ECHO_REPLIES']; end if;
  if v_came > 0 then v_fail := v_fail || array['CAME_TO_MIND']; end if;
  if v_mirror > 0 then v_fail := v_fail || array['RECIPROCAL_MIRROR']; end if;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_fail, 1), 0) = 0,
    'generated', n_ok,
    'max_skeleton_repeat', v_repeat,
    'echo_pairs', v_echo,
    'came_to_mind', v_came,
    'reciprocal_mirrors', v_mirror,
    'failures', to_jsonb(v_fail),
    'path', 'pulse_exam_chats(boolean,text)'
  );
end;
$$;

grant execute on function public.pulse_exam_chats(boolean, text) to authenticated;
grant execute on function public.pulse_exam_chats(boolean, text) to service_role;
grant execute on function public.exam_chat_naturalness_test(int, text) to service_role;

