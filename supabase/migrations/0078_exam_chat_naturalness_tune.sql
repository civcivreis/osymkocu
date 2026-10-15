-- Tune similarity (allow 2 same skeletons / 30), slug-targeted pulse, richer fallbacks.

create or replace function public.exam_chat_skeleton(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(translate(coalesce(p, ''), 'İIıÂâÊêÛûÔô', 'iii aaeeuuo'));
begin
  v := regexp_replace(v, '[0-9]+', '#', 'g');
  v := regexp_replace(v, '(matematik|geometri|paragraf|biyoloji|fizik|kimya|tarih|coğrafya|cografya|türkçe|turkce|edebiyat|fen|deneme|vatandaşlık|vatandaslik|problem|üçgen|ucgen)', '$d', 'g');
  v := regexp_replace(v, '[^a-zçğıöşü$# ]', ' ', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := trim(v);
  if v ~ 'ayni \$d yerinden devam' or v ~ 'ayni .* yerinden devam' then return 'continue_same_place'; end if;
  if v ~ 'gitmiyorsa.*soru.*birak' then return 'solve_then_quit'; end if;
  if v ~ 'birakmayin.*deneme' then return 'dont_quit_exam'; end if;
  if v ~ '(^| )hedef #' or v ~ 'bugunku hedef' then return 'goal_number'; end if;
  if public.exam_chat_is_numeric_progress(p) then return 'numeric_progress:' || left(v, 18); end if;
  if v ~ 'geçtim|gectim' and not public.exam_chat_has_bridge(p) then return 'bare_subject_shift'; end if;
  return left(v, 28);
end;
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
begin
  if public.exam_chat_banned(p_body) then return true; end if;
  select
    count(*) filter (where public.exam_chat_norm(t.body) = v) ,
    count(*) filter (where public.exam_chat_skeleton(t.body) = v_sk)
  into v_exact, v_sk_n
  from (
    select body
    from public.exam_chat_messages
    where slug = p_slug
      and created_at <= clock_timestamp()
    order by created_at desc
    limit 30
  ) t;
  if v_exact > 0 then return true; end if;
  return v_sk_n >= 2;
end;
$$;

drop function if exists public.pulse_exam_chats(boolean);
drop function if exists public.pulse_exam_chats();

create function public.pulse_exam_chats(p_force boolean default false, p_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_state public.exam_chat_room_state;
  v_bot uuid;
  v_prev uuid;
  v_prev_body text;
  v_prev_name text;
  v_prev_id uuid;
  v_prev_at timestamptz;
  v_intent text;
  v_thread text;
  v_shift boolean := false;
  v_relation text;
  v_reply_flag boolean;
  v_text text;
  v_try int;
  v_reply uuid;
  v_name text;
  v_id uuid;
  v_on boolean;
  v_speakers int;
  v_last_msg timestamptz;
  v_stale boolean := false;
  v_stages text[] := '{}';
  v_role text;
begin
  select virtual_students_enabled into v_on from public.virtual_student_engine_settings where id = 1;
  if v_on is not true then
    return jsonb_build_object('ok', false, 'reason', 'ENGINE_DISABLED', 'stages', v_stages);
  end if;

  insert into public.exam_chat_room_state (slug)
  select g.slug from public.exam_chat_groups g
  on conflict do nothing;

  if p_slug is not null then
    v_slug := p_slug;
  else
    select s.slug into v_slug
    from public.exam_chat_room_state s
    where p_force or s.next_eligible_at is null or s.next_eligible_at <= clock_timestamp()
    order by
      (s.burst_left > 0) desc,
      coalesce(s.next_eligible_at, '2000-01-01'::timestamptz) asc,
      random()
    limit 1;
  end if;
  if v_slug is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ELIGIBLE_THREAD', 'stages', v_stages);
  end if;

  select * into v_state from public.exam_chat_room_state where slug = v_slug for update;
  v_stages := array_append(v_stages, 'scene_selected');

  select max(created_at) into v_last_msg from public.exam_chat_messages where slug = v_slug;
  v_stale := v_last_msg is null or v_last_msg < clock_timestamp() - interval '90 minutes';

  select m.id, m.sender_id, m.body, m.created_at, pr.display_name
  into v_prev_id, v_prev, v_prev_body, v_prev_at, v_prev_name
  from public.exam_chat_messages m
  join public.profiles pr on pr.id = m.sender_id
  where m.slug = v_slug and m.created_at <= clock_timestamp()
  order by m.created_at desc
  limit 1;

  if (not p_force) and v_prev_at is not null and v_prev_at > clock_timestamp() then
    update public.exam_chat_room_state
    set next_eligible_at = least(v_prev_at, clock_timestamp() + interval '20 seconds')
    where slug = v_slug;
    return jsonb_build_object('ok', false, 'reason', 'THREAD_COOLDOWN', 'slug', v_slug, 'stages', v_stages);
  end if;

  if v_state.burst_left <= 0 or coalesce(array_length(v_state.burst_plan, 1), 0) = 0 then
    if (not p_force) and not v_stale and random() < 0.32 then
      update public.exam_chat_room_state
      set next_eligible_at = clock_timestamp() + make_interval(secs => 70 + floor(random() * 170)::int), updated_at = now()
      where slug = v_slug;
      return jsonb_build_object('ok', false, 'reason', 'SKIPPED_BY_ACTIVITY_PROBABILITY', 'slug', v_slug, 'stages', v_stages);
    end if;
    v_speakers := 2 + floor(random() * 3)::int;
    v_state.burst_bots := public.exam_chat_pick_bots(v_slug, v_speakers);
    v_state.burst_plan := public.exam_chat_new_burst_plan();
    v_state.burst_left := coalesce(array_length(v_state.burst_plan, 1), 4);
  end if;
  if coalesce(array_length(v_state.burst_bots, 1), 0) < 2 then
    v_state.burst_bots := public.exam_chat_pick_bots(v_slug, 3);
  end if;

  select x into v_bot from unnest(v_state.burst_bots) as x where x is distinct from v_prev order by random() limit 1;
  if v_bot is null then
    select x into v_bot from unnest(v_state.burst_bots) as x order by random() limit 1;
  end if;
  if v_bot is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_SPEAKER', 'slug', v_slug, 'stages', v_stages);
  end if;
  v_stages := array_append(v_stages, 'speaker_selected');
  select display_name into v_name from public.profiles where id = v_bot;

  v_role := coalesce(v_state.burst_plan[1], 'react');
  if coalesce(array_length(v_state.burst_plan, 1), 0) <= 1 then v_state.burst_plan := '{}';
  else v_state.burst_plan := v_state.burst_plan[2:array_length(v_state.burst_plan, 1)];
  end if;
  v_thread := coalesce(v_state.current_thread, 'genel');
  v_reply_flag := true;
  v_relation := v_role;

  if coalesce(v_prev_body, '') ~ '\?' or coalesce(v_state.unresolved_question, '') <> '' then
    v_intent := 'answer'; v_role := 'reply';
  elsif coalesce(v_prev_body, '') ~* '(geçtim|gectim|geometri|üçgen|ucgen)' then
    v_intent := 'ask_followup'; v_role := 'followup';
  elsif v_role = 'followup' then v_intent := 'ask_followup';
  elsif v_role = 'react' then v_intent := 'react';
  elsif v_role = 'progress' then
    v_intent := case when public.exam_chat_progress_blocked(v_bot, v_slug) then 'react' else 'share_progress' end;
  elsif v_role = 'reply' then
    v_intent := case when random() < 0.5 then 'agree' else 'continue_previous' end;
  else v_intent := 'react';
  end if;

  if coalesce(v_state.topic_age, 0) >= 7 and v_role = 'progress' then
    v_shift := true;
    v_thread := public.exam_chat_shift_thread(v_slug, v_thread);
    v_intent := 'change_topic';
    v_reply_flag := false;
  end if;
  v_stages := array_append(v_stages, 'turn_planned');
  v_reply := case when v_reply_flag and v_prev_id is not null then v_prev_id else null end;
  v_text := null;
  v_stages := array_append(v_stages, 'generation_called');
  for v_try in 1..12 loop
    v_text := public.exam_chat_compose(v_slug, v_bot, v_try, v_intent, v_thread, v_prev_body, v_prev_name);
    exit when v_text is not null
      and not public.exam_chat_near_duplicate(v_slug, v_bot, v_text)
      and not public.group_line_too_similar(v_slug, v_text);
    v_text := null;
    if v_try in (3, 6, 9) then v_intent := (array['react','ask_followup','agree','joke'])[1 + (v_try % 4)]; end if;
  end loop;
  if v_text is null then
    update public.exam_chat_room_state
    set burst_left = greatest(v_state.burst_left - 1, 0),
        burst_plan = coalesce(v_state.burst_plan, '{}'),
        next_eligible_at = clock_timestamp() + make_interval(secs => case when p_force then 0 else 25 end),
        updated_at = now()
    where slug = v_slug;
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE_REJECTED', 'slug', v_slug, 'stages', v_stages);
  end if;
  v_stages := array_append(v_stages, 'generation_success');
  v_stages := array_append(v_stages, 'duplicate_passed');
  if public.content_moderation_level(v_text) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED', 'slug', v_slug, 'stages', v_stages);
  end if;
  v_stages := array_append(v_stages, 'moderation_passed');
  insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
  begin
    insert into public.exam_chat_messages (slug, sender_id, body, created_at, reply_to_id)
    values (v_slug, v_bot, v_text, clock_timestamp(), v_reply)
    returning id into v_id;
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'INSERT_FAILED', 'slug', v_slug, 'error', SQLERRM, 'stages', v_stages);
  end;
  v_stages := array_append(v_stages, 'message_inserted');

  insert into public.conversation_thread_state (
    conversation_id, conversation_kind, topic, subtopic, mood,
    current_thread_summary, unresolved_question, last_meaningful_message_id,
    active_speakers, topic_age, last_topic_shift_at, updated_at
  ) values (
    v_slug, 'exam_group', public.exam_chat_thread_title(v_slug, v_thread), v_thread, coalesce(v_state.mood, 'casual'),
    public.exam_chat_build_summary(v_slug),
    case when v_text like '%?' then left(v_text, 140) else null end,
    v_id, v_state.burst_bots,
    case when v_shift then 1 else coalesce(v_state.topic_age, 0) + 1 end,
    case when v_shift then now() else v_state.last_topic_shift_at end,
    now()
  )
  on conflict (conversation_id) do update
    set topic = excluded.topic, subtopic = excluded.subtopic,
        current_thread_summary = excluded.current_thread_summary,
        unresolved_question = excluded.unresolved_question,
        last_meaningful_message_id = excluded.last_meaningful_message_id,
        active_speakers = excluded.active_speakers, topic_age = excluded.topic_age,
        last_topic_shift_at = excluded.last_topic_shift_at, updated_at = now();

  update public.exam_chat_room_state
  set burst_left = greatest(v_state.burst_left - 1, 0),
      burst_plan = coalesce(v_state.burst_plan, '{}'),
      last_intent = v_intent, last_speaker = v_bot, current_thread = v_thread,
      scene_topic = public.exam_chat_thread_title(v_slug, v_thread),
      last_relation = v_relation, last_meaningful_id = v_id,
      topic_age = case when v_shift then 1 else coalesce(topic_age, 0) + 1 end,
      unresolved_question = case when v_text like '%?' then left(v_text, 140) else null end,
      thread_summary = public.exam_chat_build_summary(v_slug),
      last_topic_shift_at = case when v_shift then now() else last_topic_shift_at end,
      burst_bots = case when v_state.burst_left - 1 <= 0 then '{}'::uuid[] else v_state.burst_bots end,
      next_eligible_at = clock_timestamp() + make_interval(secs => case when p_force then 0 else 12 end),
      updated_at = now()
  where slug = v_slug;

  return jsonb_build_object('ok', true, 'reason', 'MESSAGE_INSERTED', 'slug', v_slug, 'message_id', v_id, 'intent', v_intent, 'voice', public.exam_chat_voice(v_bot), 'body', v_text, 'stages', v_stages);
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
  v_repeat int := 0;
  v_numeric int := 0;
  v_shift int := 0;
  v_bare int := 0;
  v_voices int := 0;
  v_fail text[] := '{}';
  v_mark timestamptz := clock_timestamp();
begin
  update public.exam_chat_room_state
  set next_eligible_at = clock_timestamp(), burst_left = 0, burst_plan = '{}'
  where slug = p_slug;

  for i in 1..(greatest(p_n, 1) * 5) loop
    exit when n_ok >= p_n;
    v := public.pulse_exam_chats(true, p_slug);
    if coalesce(v->>'ok', '') = 'true' then n_ok := n_ok + 1; end if;
  end loop;

  for rec in
    select m.body from public.exam_chat_messages m
    where m.slug = p_slug and m.created_at >= v_mark
    order by m.created_at limit p_n
  loop
    if public.exam_chat_is_numeric_progress(rec.body) then v_numeric := v_numeric + 1; end if;
    if rec.body ~* 'geçtim|gectim' then
      v_shift := v_shift + 1;
      if not public.exam_chat_has_bridge(rec.body) then v_bare := v_bare + 1; end if;
    end if;
  end loop;

  select coalesce(max(c), 0) into v_repeat
  from (
    select public.exam_chat_skeleton(m.body), count(*)::int as c
    from public.exam_chat_messages m
    where m.slug = p_slug and m.created_at >= v_mark
    group by 1
  ) s;

  select count(distinct public.exam_chat_voice(m.sender_id)) into v_voices
  from public.exam_chat_messages m
  where m.slug = p_slug and m.created_at >= v_mark;

  if n_ok < p_n then v_fail := v_fail || array['INSUFFICIENT_MESSAGES']; end if;
  if v_repeat > 2 then v_fail := v_fail || array['PHRASE_PATTERN_REPEAT']; end if;
  if n_ok > 0 and (v_numeric::numeric / n_ok) > 0.35 then v_fail := v_fail || array['NUMERIC_PROGRESS_RATIO']; end if;
  if v_shift > 0 and v_bare > greatest(1, v_shift / 2) then v_fail := v_fail || array['BARE_SUBJECT_SHIFT']; end if;
  if v_voices < 3 then v_fail := v_fail || array['VOICE_COLLAPSE']; end if;

  return jsonb_build_object(
    'ok', coalesce(array_length(v_fail, 1), 0) = 0,
    'generated', n_ok,
    'numeric_progress', v_numeric,
    'numeric_ratio', case when n_ok = 0 then 0 else round((v_numeric::numeric / n_ok), 3) end,
    'max_skeleton_repeat', v_repeat,
    'subject_shifts', v_shift,
    'bare_shifts', v_bare,
    'distinct_voices', v_voices,
    'failures', to_jsonb(v_fail),
    'sample', (
      select coalesce(jsonb_agg(jsonb_build_object('name', pr.display_name, 'voice', public.exam_chat_voice(m.sender_id), 'body', m.body) order by m.created_at), '[]'::jsonb)
      from (
        select * from public.exam_chat_messages
        where slug = p_slug and created_at >= v_mark
        order by created_at
        limit 16
      ) m
      join public.profiles pr on pr.id = m.sender_id
    )
  );
end;
$$;

-- Expand compose fallbacks so a unique line can still land.
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
  v_prev text := lower(coalesce(p_reply_body, ''));
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
  if v_intent = 'share_progress' and public.exam_chat_progress_blocked(p_bot, p_slug) then
    v_intent := 'react';
  end if;

  if v_intent = 'ask_followup' then
    if v_prev ~ 'geometri|üçgen|ucgen' then
      v_choices := array['üçgen mi?','hangi konu?','zorladı mı?','açı mı kenar mı o','çok mu kaydı geometri'];
    elsif v_prev ~ 'geçtim|gectim' then
      v_choices := array['hangi konu?','oturdu mu?','zorladı mı?','kaç soru kaldı','iyi mi gidiyo'];
    else
      v_choices := array['hangi konu?','tempo nasıl?','kaç soru kaldı','zorladı mı?','sen neredesin şimdi'];
    end if;
  elsif v_intent in ('react','agree') then
    v_choices := array['aynen ya','bende de öyle','bugün hiç gitmiyor','ben saldım biraz','iyi gidiyon yine','tamam ya','geçmiş olsun matematiğe 😅','anladım bende benzer','hm idare','dur bakim'];
  elsif v_intent in ('change_topic','shift_topic') then
    v_choices := array[
      v_from || ' baydı, ' || v_title || 'ye geçtim biraz',
      v_from || ' tıkanınca ' || v_title || ' açtım',
      v_from || ' yavaş gidince ' || v_title || 'ye döndüm',
      'biraz ' || v_from || ' bıraktım, ' || v_title || ' bakıyorum',
      v_from || ' yetmedi, ' || v_title || 'ye kaydım'
    ];
  elsif v_intent = 'share_progress' then
    v_choices := array[
      v_title || ' tarafı ağır geldi bugün',
      'tempo düşük ama durmadım',
      'ben ' || coalesce(v_mem.topic, 'konu') || 'de takıldım biraz',
      'seti yarıda kestim idare'
    ];
  elsif v_intent in ('continue_previous','continue_topic','answer','answer_question') then
    v_choices := array['bende de öyle','ben de oradan gidiyorum','devam ediyom yavaş','anladım benzer yerdeyim','aynen ya','ben saldım biraz'];
  elsif v_intent = 'encourage' then
    v_choices := array['iyi gidiyon yine','kısa tut yeter','tempo gelir','devam et bence'];
  elsif v_intent = 'joke' then
    v_choices := array['ben saldım biraz','ders bugün kişisel algıdı','kapatıp çay koyucam nerdeyse','abartmayayım olay bu'];
  else
    v_choices := array['aynen ya','bende de öyle','bugün hiç gitmiyor','hm ya'];
  end if;

  v_choices := v_choices || array[
    'ya ' || v_title || ' ayrı konu',
    coalesce(nullif(p_reply_name, ''), 'sen') || ' anlatınca aklıma geldi',
    'bende tempo başka bugün',
    'kısa bakıp kapatcam'
  ];

  v_line := null;
  for i in 0..array_length(v_choices, 1) + 3 loop
    v_line := v_choices[1 + ((p_attempt + i) % array_length(v_choices, 1))];
    v_line := public.exam_chat_texture(v_voice, v_line);
    if v_line is not null and not public.exam_chat_quality_fail(p_slug, p_bot, v_line, p_reply_body, v_thread, v_intent) then
      exit;
    end if;
    v_line := null;
  end loop;
  if v_line is null then return null; end if;

  if v_intent = 'share_progress' and public.exam_chat_is_numeric_progress(v_line) then
    v_mem.last_progress_at := clock_timestamp();
    v_mem.progress_gap_min := 20 + floor(random() * 21)::int;
  end if;
  update public.exam_bot_memory
  set recent = (ARRAY[v_line] || coalesce(recent, '{}'::text[]))[1:8],
      last_meaning = v_line,
      last_progress_at = coalesce(v_mem.last_progress_at, last_progress_at),
      progress_gap_min = coalesce(v_mem.progress_gap_min, progress_gap_min),
      updated_at = now()
  where bot_id = p_bot and slug = p_slug;
  return v_line;
end;
$$;

grant execute on function public.pulse_exam_chats(boolean, text) to authenticated;
grant execute on function public.pulse_exam_chats(boolean, text) to service_role;
grant execute on function public.exam_chat_naturalness_test(int, text) to service_role;
