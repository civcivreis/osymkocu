-- Phase 3B runtime: matching, stories, conversation v2, scheduler, admin, seed.

create or replace function public.heartbeat_study(p_subject_id uuid, p_topic_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_enabled boolean;
  v_notify boolean;
  v_topic_ok boolean;
  v_subject_ok boolean;
  v_suppressed timestamptz;
  v_exam uuid;
  v_other uuid;
  v_offer public.study_match_offers%rowtype;
  v_a uuid;
  v_b uuid;
  v_name text;
  v_tag int;
  v_subject text;
  v_topic text;
  v_minutes int := coalesce((public.match_config()->>'offer_minutes')::int, 10);
  v_stale int := coalesce((public.match_config()->>'stale_seconds')::int, 45);
  v_day int := coalesce((public.match_config()->>'max_per_day')::int, 3);
  v_cool int := coalesce((public.match_config()->>'cooldown_hours')::int, 2);
  v_re int := coalesce((public.match_config()->>'rematch_hours')::int, 24);
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if p_subject_id is null then raise exception 'SUBJECT_NOT_FOUND'; end if;

  select coalesce(auto_match, true), coalesce(match_notify, true),
         coalesce(match_same_topic, true), coalesce(match_same_subject, true),
         match_suppressed_until
    into v_enabled, v_notify, v_topic_ok, v_subject_ok, v_suppressed
  from public.profiles where id = v_user;

  if v_enabled is not true then
    delete from public.study_presence where user_id = v_user;
    return null;
  end if;

  if v_suppressed is not null and v_suppressed > now() then
    insert into public.study_presence (user_id, subject_id, exam_id, topic_id, heartbeat_at, last_seen_at, is_available_for_match, status)
    select v_user, p_subject_id, s.exam_id, p_topic_id, now(), now(), false, 'paused'
    from public.subjects s where s.id = p_subject_id
    on conflict (user_id) do update
      set heartbeat_at = now(), last_seen_at = now(), is_available_for_match = false, status = 'paused';
    return public.get_my_match_offer();
  end if;

  if public.user_in_quiet_match(v_user) then
    insert into public.study_presence (user_id, subject_id, exam_id, topic_id, heartbeat_at, last_seen_at, is_available_for_match, status)
    select v_user, p_subject_id, s.exam_id, p_topic_id, now(), now(), false, 'paused'
    from public.subjects s where s.id = p_subject_id
    on conflict (user_id) do update
      set heartbeat_at = now(), last_seen_at = now(), is_available_for_match = false, status = 'paused';
    return public.get_my_match_offer();
  end if;

  select exam_id into v_exam from public.subjects where id = p_subject_id;
  if v_exam is null then raise exception 'SUBJECT_NOT_FOUND'; end if;

  insert into public.study_presence (user_id, subject_id, exam_id, topic_id, heartbeat_at, last_seen_at, is_available_for_match, status)
  values (v_user, p_subject_id, v_exam, p_topic_id, now(), now(), true, 'studying')
  on conflict (user_id) do update
    set subject_id = excluded.subject_id,
        exam_id = excluded.exam_id,
        topic_id = excluded.topic_id,
        heartbeat_at = now(),
        last_seen_at = now(),
        is_available_for_match = true,
        status = 'studying';

  if public.is_virtual_profile(v_user) then
    perform public.set_virtual_presence(v_user, 'studying', p_subject_id, p_topic_id, null, 15);
  end if;

  update public.study_presence
    set status = 'offline', is_available_for_match = false
    where heartbeat_at < now() - make_interval(secs => v_stale);

  update public.study_match_offers
    set status = 'expired'
    where status = 'pending' and expires_at < now();

  insert into public.match_events (offer_id, user_id, kind)
  select o.id, v_user, 'expired'
  from public.study_match_offers o
  where o.status = 'expired'
    and (o.user_a = v_user or o.user_b = v_user)
    and o.expires_at > now() - interval '15 minutes'
    and not exists (
      select 1 from public.match_events e where e.offer_id = o.id and e.user_id = v_user and e.kind = 'expired'
    );

  select * into v_offer from public.study_match_offers
  where status = 'pending' and (user_a = v_user or user_b = v_user)
  order by created_at desc limit 1;
  if found then return public.offer_json(v_offer, v_user); end if;

  if (
    select count(*) from public.study_match_offers o
    where (o.user_a = v_user or o.user_b = v_user)
      and o.created_at > now() - interval '24 hours'
  ) >= v_day then
    return null;
  end if;

  if exists (
    select 1 from public.study_match_offers o
    where (o.user_a = v_user or o.user_b = v_user)
      and o.created_at > now() - make_interval(hours => v_cool)
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_subject_id::text));

  v_other := public.pick_study_match_partner(
    v_user, p_subject_id, p_topic_id, v_topic_ok, v_subject_ok, v_re, v_stale
  );

  if v_other is null then return null; end if;

  v_a := least(v_user, v_other);
  v_b := greatest(v_user, v_other);
  insert into public.study_match_offers (user_a, user_b, subject_id, topic_id, expires_at)
  values (v_a, v_b, p_subject_id, p_topic_id, now() + make_interval(mins => v_minutes))
  returning * into v_offer;

  perform public.log_match_event(v_offer.id, v_user, 'shown');
  perform public.log_match_event(v_offer.id, v_other, 'shown');

  select name into v_subject from public.subjects where id = p_subject_id;
  select name into v_topic from public.topics where id = p_topic_id;

  if exists (select 1 from public.profiles where id = v_other and coalesce(match_notify, true)) then
    select display_name, display_tag into v_name, v_tag from public.profiles where id = v_user;
    perform public.notify_match_once(v_other, 'study_match_found', jsonb_build_object(
      'offer_id', v_offer.id, 'from_name', coalesce(v_name, 'Öğrenci'), 'from_tag', v_tag,
      'from_user', v_user, 'subject_id', p_subject_id, 'subject_name', coalesce(v_subject, 'Ders'),
      'topic_name', v_topic, 'expires_at', v_offer.expires_at
    ));
  end if;
  if v_notify then
    select display_name, display_tag into v_name, v_tag from public.profiles where id = v_other;
    perform public.notify_match_once(v_user, 'study_match_found', jsonb_build_object(
      'offer_id', v_offer.id, 'from_name', coalesce(v_name, 'Öğrenci'), 'from_tag', v_tag,
      'from_user', v_other, 'subject_id', p_subject_id, 'subject_name', coalesce(v_subject, 'Ders'),
      'topic_name', v_topic, 'expires_at', v_offer.expires_at
    ));
  end if;

  return public.offer_json(v_offer, v_user);
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
      where s.deleted_at is null
        and s.status = 'active'
        and s.expires_at > now()
        and not exists (
          select 1 from public.user_blocks b
          where b.blocker_id = v_user and b.blocked_id = s.user_id
        )
      order by s.created_at desc
      limit 40
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_story(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_row jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select jsonb_build_object(
    'id', s.id, 'user_id', s.user_id, 'image_url', s.image_url,
    'caption', s.caption, 'created_at', s.created_at, 'expires_at', s.expires_at
  ) into v_row
  from public.stories s
  where s.id = p_id
    and s.deleted_at is null
    and s.status = 'active'
    and s.expires_at > now();
  if v_row is null then raise exception 'NOT_FOUND'; end if;
  return v_row;
end;
$$;

create or replace function public.publish_story(p_image_url text, p_caption text, p_media_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_media public.media%rowtype;
  v_url text := trim(coalesce(p_image_url, ''));
  v_max int := 3;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select max_active_stories into v_max from public.virtual_student_engine_settings where id = 1;
  if (
    select count(*) from public.stories
    where user_id = v_user and deleted_at is null and status = 'active' and expires_at > now()
  ) >= coalesce(v_max, 3) then
    raise exception 'STORY_RATE_LIMIT';
  end if;
  if p_media_id is not null then
    select * into v_media from public.media
    where id = p_media_id and owner_user_id = v_user and purpose = 'story'
      and moderation_status = 'approved' and deleted_at is null;
    if not found then raise exception 'IMAGE_NOT_APPROVED'; end if;
    v_url := coalesce(nullif(v_url, ''), 'media:' || v_media.id::text);
  elsif length(v_url) < 8 then
    raise exception 'EMPTY_MESSAGE';
  else
    raise exception 'IMAGE_NOT_APPROVED';
  end if;
  insert into public.stories (user_id, image_url, caption, expires_at, status, media_id)
  values (v_user, v_url, nullif(trim(p_caption), ''), now() + interval '24 hours', 'active', p_media_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cleanup_expired_stories()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys jsonb := '[]'::jsonb;
begin
  update public.stories
  set status = 'expired'
  where deleted_at is null
    and status = 'active'
    and expires_at <= now();

  select coalesce(jsonb_agg(distinct m.storage_key), '[]'::jsonb) into v_keys
  from public.stories s
  join public.media m on m.id = s.media_id or s.image_url = 'media:' || m.id::text
  where s.status = 'expired'
    and s.deleted_at is null
    and m.deleted_at is null
    and m.purpose = 'story'
    and not exists (
      select 1 from public.stories live
      where live.deleted_at is null
        and live.status = 'active'
        and live.expires_at > now()
        and (live.media_id = m.id or live.image_url = 'media:' || m.id::text)
    );

  update public.media m
  set deleted_at = now()
  where m.storage_key in (select jsonb_array_elements_text(v_keys))
    and m.deleted_at is null;

  update public.stories
  set deleted_at = now()
  where status = 'expired' and deleted_at is null and expires_at <= now();

  return jsonb_build_object('r2_keys', v_keys);
end;
$$;

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
        or public.is_admin()
        or (
          m.purpose = 'story'
          and exists (
            select 1 from public.stories s
            where s.user_id = m.owner_user_id
              and s.deleted_at is null
              and s.status = 'active'
              and s.expires_at > now()
              and (s.media_id = m.id or s.image_url = 'media:' || m.id::text or s.image_url like '%' || m.id::text || '%')
          )
        )
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

create or replace function public.exam_chat_plan_turn(
  p_slug text,
  p_persona text,
  p_prev_body text,
  p_topic_age int,
  p_unresolved text,
  p_current_thread text,
  out o_intent text,
  out o_relation text,
  out o_shift boolean,
  out o_thread text,
  out o_reply boolean
)
language plpgsql
stable
as $$
declare
  r float := random();
  v_q boolean := coalesce(p_unresolved, '') <> ''
    or coalesce(p_prev_body, '') ~ '\?'
    or coalesce(p_prev_body, '') ~* '(kaç|kac).*(yanlış|yanlis|net)';
  v_share boolean := coalesce(p_prev_body, '') ~* '(gitti|/[0-9]|soru|yanlış|net|kestim|oldum|deneme)';
  v_need int := 5 + floor(random() * 4)::int;
begin
  o_thread := coalesce(p_current_thread, 'genel');
  o_shift := false;
  o_reply := true;

  if v_q then
    o_intent := 'answer_question';
    o_relation := 'answer';
    return;
  end if;

  if p_topic_age >= v_need then
    o_shift := true;
    o_thread := public.exam_chat_shift_thread(p_slug, o_thread);
    o_reply := false;
    o_intent := 'shift_topic';
    o_relation := 'shift';
    return;
  end if;

  if v_share then
    if r < 0.40 then o_intent := 'ask_followup'; o_relation := 'clarify';
    elsif r < 0.70 then o_intent := 'share_progress'; o_relation := 'share_own';
    elsif r < 0.88 then o_intent := 'agree'; o_relation := 'agree_explicit';
    else o_intent := 'encourage'; o_relation := 'continue';
    end if;
    return;
  end if;

  if r < 0.22 then o_intent := 'ask_followup'; o_relation := 'clarify';
  elsif r < 0.44 then o_intent := 'continue_topic'; o_relation := 'continue';
  elsif r < 0.62 then o_intent := 'agree'; o_relation := 'agree_explicit';
  elsif r < 0.78 then o_intent := 'share_progress'; o_relation := 'share_own';
  elsif r < 0.90 then o_intent := 'give_tip'; o_relation := 'continue';
  else o_intent := 'react'; o_relation := 'continue';
  end if;
end;
$$;

create or replace function public.exam_chat_answer_line(p_bot uuid, p_slug text, p_reply_name text)
returns text
language plpgsql
as $$
declare
  v_mem public.exam_bot_memory;
  v_fact jsonb;
  v_wrong int;
  v_correct int;
  v_topic text;
  v_name text := coalesce(nullif(p_reply_name, ''), '');
  r float := random();
  v_line text;
begin
  v_mem := public.exam_chat_ensure_memory(p_bot, p_slug);
  select value into v_fact
  from public.virtual_student_memory
  where profile_id = p_bot and memory_type = 'recent_test'
    and (expires_at is null or expires_at > now())
  order by updated_at desc
  limit 1;
  v_wrong := coalesce((v_fact->>'wrong')::int, 3 + floor(random() * 3)::int);
  v_correct := coalesce((v_fact->>'correct')::int, 6 + floor(random() * 3)::int);
  v_topic := coalesce(v_fact->>'topic', v_mem.topic, 'problemler');
  if r < 0.34 then
    v_line := v_wrong::text || ' çıktı, ' || lower(v_topic) || ' biraz zorladı';
  elsif r < 0.62 then
    v_line := v_wrong::text || ' yanlış, ikisi dikkatsizlikti';
  elsif r < 0.82 then
    v_line := 'bende ' || v_wrong::text || ', oran-orantı uğraştırdı';
  else
    v_line := v_correct::text || '/' || (v_correct + v_wrong)::text || ' oldu ' || lower(v_topic) || 'de';
  end if;
  if v_name <> '' and random() < 0.35 then
    v_line := v_name || ' ' || v_line;
  end if;
  return v_line;
end;
$$;

create or replace function public.exam_chat_near_duplicate(p_slug text, p_bot uuid, p_body text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from (
      select m.body
      from public.exam_chat_messages m
      where m.slug = p_slug
        and public.is_virtual_profile(m.sender_id)
      order by m.created_at desc
      limit 20
    ) x
    where public.exam_chat_norm(x.body) = public.exam_chat_norm(p_body)
       or left(public.exam_chat_norm(x.body), 18) = left(public.exam_chat_norm(p_body), 18)
  );
$$;

create or replace function public.pulse_exam_chats()
returns void
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
  v_shift boolean;
  v_relation text;
  v_reply_flag boolean;
  v_text text;
  v_try int;
  v_when timestamptz;
  v_delay int;
  v_reply uuid;
  v_name text;
  v_persona text;
  v_id uuid;
  v_on boolean;
  v_speakers int;
begin
  select virtual_students_enabled into v_on from public.virtual_student_engine_settings where id = 1;
  if v_on is not true then return; end if;

  insert into public.exam_chat_room_state (slug)
  select g.slug from public.exam_chat_groups g
  on conflict do nothing;

  select s.slug into v_slug
  from public.exam_chat_room_state s
  where s.next_eligible_at is null or s.next_eligible_at <= clock_timestamp()
  order by
    (s.burst_left > 0) desc,
    coalesce(s.next_eligible_at, '2000-01-01'::timestamptz) asc,
    random()
  limit 1;
  if v_slug is null then return; end if;

  select * into v_state from public.exam_chat_room_state where slug = v_slug for update;

  select m.id, m.sender_id, m.body, m.created_at, pr.display_name
  into v_prev_id, v_prev, v_prev_body, v_prev_at, v_prev_name
  from public.exam_chat_messages m
  join public.profiles pr on pr.id = m.sender_id
  where m.slug = v_slug
  order by m.created_at desc
  limit 1;

  if v_prev_at is not null and v_prev_at > clock_timestamp() then
    update public.exam_chat_room_state
    set next_eligible_at = v_prev_at + make_interval(secs => 8 + floor(random() * 20)::int)
    where slug = v_slug;
    return;
  end if;

  if v_state.burst_left <= 0 then
    if random() < 0.32 then
      update public.exam_chat_room_state
      set next_eligible_at = clock_timestamp() + make_interval(secs => 70 + floor(random() * 170)::int),
          updated_at = now()
      where slug = v_slug;
      return;
    end if;
    v_speakers := 2 + floor(random() * 3)::int;
    v_state.burst_bots := public.exam_chat_pick_bots(v_slug, v_speakers);
    v_state.burst_left := 3 + floor(random() * 6)::int;
  end if;

  if coalesce(v_state.unresolved_question, '') <> '' and v_prev is not null then
    select x into v_bot
    from unnest(v_state.burst_bots) as x
    where x is distinct from v_prev
    order by random()
    limit 1;
  else
    select x into v_bot
    from unnest(v_state.burst_bots) as x
    where x is distinct from v_prev
    order by random()
    limit 1;
  end if;
  if v_bot is null then
    select x into v_bot from unnest(v_state.burst_bots) as x order by random() limit 1;
  end if;
  if v_bot is null then return; end if;

  select display_name into v_name from public.profiles where id = v_bot;
  v_persona := public.exam_chat_persona(v_name);

  select o_intent, o_relation, o_shift, o_thread, o_reply
  into v_intent, v_relation, v_shift, v_thread, v_reply_flag
  from public.exam_chat_plan_turn(
    v_slug,
    v_persona,
    v_prev_body,
    coalesce(v_state.topic_age, 0),
    v_state.unresolved_question,
    coalesce(v_state.current_thread, 'genel')
  );

  v_reply := null;
  if v_reply_flag and v_prev_id is not null then
    v_reply := v_prev_id;
  end if;

  if v_intent = 'continue_topic' then v_intent := 'continue_previous'; end if;
  if v_intent = 'shift_topic' then v_intent := 'change_topic'; end if;
  if v_intent in ('give_tip', 'react') then v_intent := 'encourage'; end if;

  v_text := null;
  for v_try in 1..8 loop
    if v_intent in ('answer', 'answer_question') then
      v_text := public.exam_chat_answer_line(v_bot, v_slug, v_prev_name);
    else
      v_text := public.exam_chat_compose(v_slug, v_bot, v_try, v_intent, v_thread, v_prev_body, v_prev_name);
    end if;
    exit when v_text is not null
      and not public.exam_chat_near_duplicate(v_slug, v_bot, v_text)
      and not public.group_line_too_similar(v_slug, v_text);
    v_text := null;
  end loop;
  if v_text is null then
    update public.exam_chat_room_state
    set burst_left = greatest(v_state.burst_left - 1, 0),
        next_eligible_at = clock_timestamp() + make_interval(secs => 25 + floor(random() * 80)::int),
        updated_at = now()
    where slug = v_slug;
    return;
  end if;

  v_delay := (array[12, 18, 27, 41, 55, 73, 120, 145, 180, 240])[1 + floor(random() * 10)::int];
  v_when := clock_timestamp() + make_interval(secs => v_delay);

  insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
  insert into public.exam_chat_messages (slug, sender_id, body, created_at, reply_to_id)
  values (v_slug, v_bot, v_text, v_when, v_reply)
  returning id into v_id;

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
    set topic = excluded.topic,
        subtopic = excluded.subtopic,
        current_thread_summary = excluded.current_thread_summary,
        unresolved_question = excluded.unresolved_question,
        last_meaningful_message_id = excluded.last_meaningful_message_id,
        active_speakers = excluded.active_speakers,
        topic_age = excluded.topic_age,
        last_topic_shift_at = excluded.last_topic_shift_at,
        updated_at = now();

  if v_state.burst_left - 1 <= 0 then
    update public.exam_chat_room_state
    set burst_left = 0,
        last_intent = v_intent,
        last_speaker = v_bot,
        current_thread = v_thread,
        scene_topic = public.exam_chat_thread_title(v_slug, v_thread),
        last_relation = v_relation,
        last_meaningful_id = v_id,
        topic_age = case when v_shift then 1 else coalesce(topic_age, 0) + 1 end,
        unresolved_question = case when v_text like '%?' then left(v_text, 140) else null end,
        thread_summary = public.exam_chat_build_summary(v_slug),
        last_topic_shift_at = case when v_shift then now() else last_topic_shift_at end,
        next_eligible_at = v_when + make_interval(secs => 90 + floor(random() * 220)::int),
        burst_bots = '{}',
        updated_at = now()
    where slug = v_slug;
  else
    update public.exam_chat_room_state
    set burst_left = v_state.burst_left - 1,
        last_intent = v_intent,
        last_speaker = v_bot,
        current_thread = v_thread,
        scene_topic = public.exam_chat_thread_title(v_slug, v_thread),
        last_relation = v_relation,
        last_meaningful_id = v_id,
        topic_age = case when v_shift then 1 else coalesce(topic_age, 0) + 1 end,
        unresolved_question = case when v_text like '%?' then left(v_text, 140) else null end,
        thread_summary = public.exam_chat_build_summary(v_slug),
        last_topic_shift_at = case when v_shift then now() else last_topic_shift_at end,
        burst_bots = v_state.burst_bots,
        next_eligible_at = v_when + make_interval(secs => 12 + floor(random() * 50)::int),
        updated_at = now()
    where slug = v_slug;
  end if;
end;
$$;

create or replace function public.virtual_human_share()
returns numeric
language sql
stable
as $$
  select case
    when (select count(*) from public.profiles where last_active_at > now() - interval '1 hour'
          and coalesce(profile_type, 'human') = 'human') = 0 then 1
    else (
      select count(*)::numeric from public.virtual_student_presence
      where state <> 'offline' and updated_at > now() - interval '30 minutes'
    ) / greatest(1, (
      select count(*) from public.profiles
      where last_active_at > now() - interval '1 hour'
        and coalesce(profile_type, 'human') = 'human'
    ))
  end;
$$;

create or replace function public.virtual_pick_curriculum(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.virtual_student_profiles%rowtype;
  v_subject uuid;
  v_topic uuid;
  v_lesson uuid;
begin
  select * into v_row from public.virtual_student_profiles where profile_id = p_profile;
  if not found then return; end if;

  select s.id into v_subject
  from public.subjects s
  where (v_row.exam_id is null or s.exam_id = v_row.exam_id)
    and (
      cardinality(v_row.preferred_subject_ids) = 0
      or s.id = any (v_row.preferred_subject_ids)
    )
  order by random()
  limit 1;

  if v_subject is null then
    select s.id into v_subject from public.subjects s
    where v_row.exam_id is null or s.exam_id = v_row.exam_id
    order by random() limit 1;
  end if;

  select t.id into v_topic
  from public.topics t
  where t.subject_id = v_subject
  order by random()
  limit 1;

  select ml.id into v_lesson
  from public.memory_lessons ml
  left join public.subjects s on lower(ml.subject) = lower(s.name)
  where ml.status = 'published'
    and (v_subject is null or s.id = v_subject)
  order by random()
  limit 1;

  update public.virtual_student_profiles
  set current_subject_id = v_subject,
      current_topic_id = v_topic,
      updated_at = now()
  where profile_id = p_profile;

  perform public.remember_virtual_fact(
    p_profile, 'study_progress', 'current',
    jsonb_build_object('subject_id', v_subject, 'topic_id', v_topic, 'lesson_id', v_lesson),
    null
  );
end;
$$;

create or replace function public.virtual_enqueue_jobs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings;
  v_n int := 0;
  rec record;
  v_now time;
  v_active boolean;
  v_share numeric;
  v_types text[];
  v_type text;
  v_delay int;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if not v_cfg.virtual_students_enabled then return 0; end if;

  v_share := public.virtual_human_share();
  if v_share > coalesce(v_cfg.target_virtual_share, 0.35) then
    return 0;
  end if;

  for rec in
    select v.* from public.virtual_student_profiles v
    where v.is_enabled
  loop
    v_now := timezone(rec.timezone, now())::time;
    v_active := (rec.active_hours_start <= rec.active_hours_end and v_now between rec.active_hours_start and rec.active_hours_end)
      or (rec.active_hours_start > rec.active_hours_end and (v_now >= rec.active_hours_start or v_now <= rec.active_hours_end));
    if not v_active then
      perform public.set_virtual_presence(rec.profile_id, 'offline');
      continue;
    end if;

    if exists (
      select 1 from public.virtual_student_activity_jobs j
      where j.profile_id = rec.profile_id and j.status in ('queued', 'running')
    ) then
      continue;
    end if;

    if rec.social_activity_level = 'low' then
      v_types := array['study_lesson', 'solve_test', 'group_chat', 'social_like'];
    elsif rec.social_activity_level = 'high' then
      v_types := array['study_lesson', 'solve_test', 'social_post', 'group_chat', 'join_room', 'social_comment', 'room_chat'];
    else
      v_types := array['study_lesson', 'solve_test', 'group_chat', 'social_post', 'join_room'];
    end if;
    v_type := v_types[1 + floor(random() * array_length(v_types, 1))::int];
    v_delay := 20 + floor(random() * 240)::int;

    insert into public.virtual_student_activity_jobs (profile_id, activity_type, scheduled_for, context)
    values (
      rec.profile_id, v_type, now() + make_interval(secs => v_delay),
      jsonb_build_object('exam_id', rec.exam_id)
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.virtual_run_job(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.virtual_student_activity_jobs%rowtype;
  v_prof public.virtual_student_profiles%rowtype;
  v_q record;
  v_n int := 0;
  v_ok int := 0;
  v_choice text;
  v_acc numeric;
  v_body text;
  v_post uuid;
  v_topic text;
  v_subject uuid;
  v_lesson uuid;
  v_slug text;
begin
  select * into v_job from public.virtual_student_activity_jobs where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;
  if v_job.status not in ('queued', 'running') then
    return jsonb_build_object('ok', false, 'error', v_job.status);
  end if;

  update public.virtual_student_activity_jobs
  set status = 'running', attempt_count = attempt_count + 1, updated_at = now()
  where id = p_id;

  select * into v_prof from public.virtual_student_profiles where profile_id = v_job.profile_id;
  perform public.virtual_pick_curriculum(v_job.profile_id);
  select * into v_prof from public.virtual_student_profiles where profile_id = v_job.profile_id;
  v_subject := v_prof.current_subject_id;

  begin
    if v_job.activity_type = 'study_lesson' then
      perform public.set_virtual_presence(v_job.profile_id, 'studying', v_subject, v_prof.current_topic_id, null, 12);
      select ml.id into v_lesson
      from public.memory_lessons ml
      left join public.subjects s on lower(ml.subject) = lower(s.name)
      where ml.status = 'published'
        and (v_subject is null or s.id = v_subject)
      order by random() limit 1;
      if v_lesson is not null then
        insert into public.memory_lesson_progress (user_id, lesson_id, completion_percent, completed, completed_at)
        values (v_job.profile_id, v_lesson, 100, true, now())
        on conflict (user_id, lesson_id) do update
          set completion_percent = 100, completed = true, completed_at = now(), updated_at = now();
        perform public.award_xp(v_job.profile_id, 5, 'lesson', 'memory_lesson', v_lesson::text);
        perform public.remember_virtual_fact(
          v_job.profile_id, 'study_progress', 'lesson',
          jsonb_build_object('lesson_id', v_lesson), null
        );
      end if;

    elsif v_job.activity_type = 'solve_test' then
      perform public.set_virtual_presence(v_job.profile_id, 'testing', v_subject, v_prof.current_topic_id, null, 10);
      if v_subject = any (v_prof.strong_subject_ids) then v_acc := 0.75 + random() * 0.15;
      elsif v_subject = any (v_prof.weak_subject_ids) then v_acc := 0.35 + random() * 0.25;
      else v_acc := 0.55 + random() * 0.20;
      end if;
      for v_q in
        select q.id, q.correct_choice, q.topic_id
        from public.questions q
        where q.is_published
          and (v_subject is null or q.subject_id = v_subject)
          and (v_prof.current_topic_id is null or q.topic_id = v_prof.current_topic_id or q.subject_id = v_subject)
        order by random()
        limit 10
      loop
        v_n := v_n + 1;
        if random() < v_acc then
          v_choice := coalesce(v_q.correct_choice, 'A');
          v_ok := v_ok + 1;
        else
          v_choice := (array['A','B','C','D','E'])[1 + floor(random() * 5)::int];
          if v_choice = v_q.correct_choice then
            v_choice := case v_choice when 'A' then 'B' else 'A' end;
          end if;
        end if;
        insert into public.question_attempts (user_id, question_id, selected_choice, is_correct, time_spent_ms, is_virtual_activity)
        values (
          v_job.profile_id, v_q.id, v_choice, v_choice = v_q.correct_choice,
          18000 + floor(random() * 25000)::int, true
        );
      end loop;
      select t.name into v_topic from public.topics t where t.id = v_prof.current_topic_id;
      perform public.remember_virtual_fact(
        v_job.profile_id, 'recent_test', 'last',
        jsonb_build_object('topic', coalesce(v_topic, 'Konu'), 'correct', v_ok, 'wrong', greatest(0, v_n - v_ok), 'total', v_n),
        interval '72 hours'
      );
      if v_n > 0 then
        perform public.award_xp(v_job.profile_id, 8, 'practice_set', 'virtual_test', p_id::text);
      end if;

    elsif v_job.activity_type in ('social_post', 'update_status') then
      perform public.set_virtual_presence(v_job.profile_id, 'social', v_subject, v_prof.current_topic_id, null, 8);
      select value->>'topic', (value->>'wrong')::int, (value->>'correct')::int
      into v_topic, v_n, v_ok
      from public.virtual_student_memory
      where profile_id = v_job.profile_id and memory_type = 'recent_test'
      order by updated_at desc limit 1;
      if v_topic is not null and v_n is not null then
        v_body := coalesce(v_topic, 'Konu') || 'de ' || coalesce(v_ok, 0)::text || ' doğru ' || coalesce(v_n, 0)::text || ' yanlış çıktı.';
      else
        select t.name into v_topic from public.topics t where t.id = v_prof.current_topic_id;
        v_body := case floor(random() * 3)::int
          when 0 then coalesce(v_topic, 'Derse') || ' tekrarındayım.'
          when 1 then 'Bugünkü hedef ' || v_prof.daily_goal_questions::text || ' soru, devam.'
          else coalesce(v_topic, 'Konu') || 'ni bitirip sonrakine geçiyorum.'
        end;
      end if;
      if public.content_moderation_level(v_body) <> 'block'
         and not exists (
           select 1 from public.social_posts sp
           where sp.user_id = v_job.profile_id and sp.body = v_body
             and sp.created_at > now() - interval '24 hours'
         ) then
        insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at, topic_id)
        values (v_job.profile_id, v_body, 'status', v_subject, 60, now() + interval '60 minutes', v_prof.current_topic_id)
        returning id into v_post;
        perform public.remember_virtual_fact(
          v_job.profile_id, 'recent_post', 'last', jsonb_build_object('body', v_body, 'post_id', v_post), interval '48 hours'
        );
      end if;

    elsif v_job.activity_type = 'social_comment' then
      perform public.set_virtual_presence(v_job.profile_id, 'social', v_subject, null, null, 6);
      select p.id, p.body into v_post, v_body
      from public.social_posts p
      join public.profiles a on a.id = p.user_id
      where (p.expires_at is null or p.expires_at > now())
        and p.user_id <> v_job.profile_id
        and coalesce(p.subject_id, v_subject) is not distinct from coalesce(v_subject, p.subject_id)
      order by p.created_at desc
      limit 1;
      if v_post is not null then
        v_body := case
          when v_body ~* 'yanlış' then 'hangi konu zorladı tam?'
          when v_body ~* 'soru' then 'aynı setteyim, sonlar ağırdı'
          else 'devam et, tempo iyi duruyor'
        end;
        if public.content_moderation_level(v_body) <> 'block' then
          insert into public.post_comments (post_id, user_id, body)
          values (v_post, v_job.profile_id, v_body);
        end if;
      end if;

    elsif v_job.activity_type = 'social_like' then
      insert into public.post_likes (post_id, user_id)
      select p.id, v_job.profile_id
      from public.social_posts p
      where p.user_id <> v_job.profile_id
        and (p.expires_at is null or p.expires_at > now())
        and not exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = v_job.profile_id)
      order by random()
      limit 1
      on conflict do nothing;

    elsif v_job.activity_type = 'group_chat' then
      perform public.set_virtual_presence(v_job.profile_id, 'social', v_subject, v_prof.current_topic_id, null, 15);
      perform public.pulse_exam_chats();

    elsif v_job.activity_type in ('join_room', 'create_room', 'room_chat') then
      select s.id into v_post
      from public.study_sessions s
      where s.status in ('waiting', 'countdown', 'active')
        and s.subject_id = v_subject
      order by s.created_at desc
      limit 1;
      if v_post is not null then
        insert into public.study_session_members (session_id, user_id)
        values (v_post, v_job.profile_id)
        on conflict do nothing;
        perform public.set_virtual_presence(v_job.profile_id, 'in_room', v_subject, v_prof.current_topic_id, v_post, 25);
      end if;

    elsif v_job.activity_type = 'take_system_exam' then
      perform public.set_virtual_presence(v_job.profile_id, 'system_exam', v_subject, null, null, 40);

    elsif v_job.activity_type = 'review_topic' then
      perform public.set_virtual_presence(v_job.profile_id, 'studying', v_subject, v_prof.current_topic_id, null, 10);
    end if;

    update public.virtual_student_activity_jobs
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'type', v_job.activity_type);
  exception when others then
    update public.virtual_student_activity_jobs
    set status = 'failed', error_text = SQLERRM, updated_at = now()
    where id = p_id;
    return jsonb_build_object('ok', false, 'error', SQLERRM);
  end;
end;
$$;

create or replace function public.virtual_student_engine_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
  v_enqueued int := 0;
  v_job uuid;
  v_ran jsonb;
  v_stories jsonb;
begin
  v_stories := public.cleanup_expired_stories();
  delete from public.virtual_student_memory where expires_at is not null and expires_at <= now();
  select virtual_students_enabled into v_on from public.virtual_student_engine_settings where id = 1;
  if v_on is not true then
    return jsonb_build_object('enabled', false, 'stories', v_stories);
  end if;
  v_enqueued := public.virtual_enqueue_jobs();
  select id into v_job
  from public.virtual_student_activity_jobs
  where status = 'queued' and scheduled_for <= now()
  order by scheduled_for
  limit 1;
  if v_job is not null then
    v_ran := public.virtual_run_job(v_job);
  end if;
  return jsonb_build_object('enabled', true, 'enqueued', v_enqueued, 'ran', v_ran, 'stories', v_stories);
end;
$$;

create or replace function public.admin_virtual_students_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_today date := (timezone('Europe/Istanbul', now()))::date;
begin
  perform public.require_admin();
  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1),
    'enabled_profiles', (select count(*)::int from public.virtual_student_profiles where is_enabled),
    'online', (select count(*)::int from public.virtual_student_presence where state <> 'offline' and updated_at > now() - interval '20 minutes'),
    'studying', (select count(*)::int from public.virtual_student_presence where state = 'studying'),
    'testing', (select count(*)::int from public.virtual_student_presence where state = 'testing'),
    'in_rooms', (select count(*)::int from public.virtual_student_presence where state = 'in_room'),
    'social', (select count(*)::int from public.virtual_student_presence where state = 'social'),
    'daily_xp', (
      select coalesce(sum(t.amount), 0)::int from public.xp_transactions t
      join public.profiles p on p.id = t.user_id
      where public.is_virtual_profile(t.user_id)
        and (timezone('Europe/Istanbul', t.created_at))::date = v_today
    ),
    'jobs', (
      select jsonb_build_object(
        'queued', count(*) filter (where status = 'queued'),
        'running', count(*) filter (where status = 'running'),
        'failed', count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours')
      ) from public.virtual_student_activity_jobs
    ),
    'conversation_errors', (
      select count(*)::int from public.virtual_student_activity_jobs
      where status = 'failed' and activity_type = 'group_chat' and created_at > now() - interval '24 hours'
    ),
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.display_name)
      from (
        select
          pr.id, pr.display_name, pr.display_tag, pr.current_xp, v.is_enabled,
          v.activity_intensity, v.xp_multiplier, v.daily_xp_cap, e.name as exam_name,
          vp.state, v.current_subject_id, v.current_topic_id
        from public.virtual_student_profiles v
        join public.profiles pr on pr.id = v.profile_id
        left join public.exams e on e.id = v.exam_id
        left join public.virtual_student_presence vp on vp.profile_id = v.profile_id
        limit 40
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_set_virtual_engine(
  p_enabled boolean default null,
  p_intensity text default null,
  p_multiplier numeric default null,
  p_daily_cap int default null,
  p_max_top5 int default null,
  p_share numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.virtual_student_engine_settings
  set virtual_students_enabled = coalesce(p_enabled, virtual_students_enabled),
      activity_intensity = coalesce(p_intensity, activity_intensity),
      xp_multiplier = coalesce(p_multiplier, xp_multiplier),
      virtual_daily_xp_cap = coalesce(p_daily_cap, virtual_daily_xp_cap),
      max_virtual_in_top5 = coalesce(p_max_top5, max_virtual_in_top5),
      target_virtual_share = coalesce(p_share, target_virtual_share),
      updated_at = now()
  where id = 1;
  return (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1);
end;
$$;

create or replace function public.admin_set_virtual_profile(
  p_profile uuid,
  p_enabled boolean default null,
  p_intensity text default null,
  p_multiplier numeric default null,
  p_daily_cap int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.virtual_student_profiles
  set is_enabled = coalesce(p_enabled, is_enabled),
      activity_intensity = coalesce(p_intensity, activity_intensity),
      xp_multiplier = coalesce(p_multiplier, xp_multiplier),
      daily_xp_cap = coalesce(p_daily_cap, daily_xp_cap),
      updated_at = now()
  where profile_id = p_profile;
end;
$$;

create or replace function public.admin_simulate_virtual_thread(p_slug text default 'kpss', p_count int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bots uuid[];
  v_names text[];
  v_i int;
  v_speaker int := 1;
  v_other int := 2;
  v_lines jsonb := '[]'::jsonb;
  v_intent text;
  v_body text;
  v_unresolved text := 'kaç yanlışın çıktı sende?';
  v_topic text := 'Matematik';
  v_summary text := 'Deniz and Nehir are solving Mathematics problems.';
begin
  perform public.require_admin();
  select array_agg(pr.id), array_agg(pr.display_name)
  into v_bots, v_names
  from (
    select pr.id, pr.display_name
    from public.profiles pr
    where public.is_virtual_profile(pr.id)
    order by pr.display_name
    limit 4
  ) pr;
  if v_bots is null or array_length(v_bots, 1) < 2 then
    return jsonb_build_object('ok', false, 'error', 'need_virtual_profiles');
  end if;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'speaker', v_names[1], 'intent', 'ask_followup', 'body', 'kaç yanlışın çıktı sende 🎯', 'reply_to', null
  ));

  for v_i in 2..greatest(8, least(coalesce(p_count, 30), 40)) loop
    if v_unresolved is not null then
      v_intent := 'answer_question';
      v_body := public.exam_chat_answer_line(v_bots[v_other], p_slug, v_names[v_speaker]);
      v_unresolved := null;
    elsif v_i in (6, 14, 22) then
      v_intent := 'ask_followup';
      v_body := 'sen kaç net yaptın bu sette?';
      v_unresolved := v_body;
    elsif v_i in (10, 18) then
      v_intent := 'continue_topic';
      v_body := 'oran-orantıdan 10 soru daha çözüp döneceğim';
    elsif v_i % 7 = 0 then
      v_intent := 'encourage';
      v_body := 'tempo iyi, aynı yerdeyiz';
    else
      v_intent := 'continue_topic';
      v_body := case (v_i % 4)
        when 0 then 'bende 4, oran-orantı baya uğraştırdı'
        when 1 then 'aynen orası zorladı'
        when 2 then 'problemlerde iki tane dikkatten gitti 😅'
        else 'şimdilik matematikteyim, kaymıyorum'
      end;
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'speaker', v_names[v_other],
      'intent', v_intent,
      'body', v_body,
      'topic', v_topic,
      'summary', v_summary,
      'reply_to', v_names[v_speaker]
    ));
    v_speaker := v_other;
    v_other := case when v_other = 1 then 2 when v_other >= least(array_length(v_bots, 1), 3) then 1 else v_other + 1 end;
    if v_i % 8 = 0 then
      v_other := 1 + (v_i % least(array_length(v_bots, 1), 3));
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'slug', p_slug, 'messages', v_lines);
end;
$$;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_today date := (timezone('Europe/Istanbul', now()))::date;
begin
  perform public.require_staff();
  return jsonb_build_object(
    'users', (select count(*)::int from public.profiles where coalesce(profile_type, 'human') = 'human'),
    'today_active_users', (
      select count(*)::int from public.profiles
      where last_active_at is not null
        and (timezone('Europe/Istanbul', last_active_at))::date = v_today
        and coalesce(profile_type, 'human') = 'human'
    ),
    'virtual_active_users', (
      select count(*)::int from public.profiles
      where last_active_at is not null
        and (timezone('Europe/Istanbul', last_active_at))::date = v_today
        and public.is_virtual_profile(id)
    ),
    'active_users', (
      select count(distinct user_id)::int from public.question_attempts a
      join public.profiles p on p.id = a.user_id
      where a.created_at > now() - interval '7 days'
        and coalesce(p.profile_type, 'human') = 'human'
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'questions_today', (
      select count(*)::int from public.question_attempts a
      join public.profiles p on p.id = a.user_id
      where (timezone('Europe/Istanbul', a.created_at))::date = v_today
        and coalesce(p.profile_type, 'human') = 'human'
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'active_sessions', (
      select count(*)::int from public.study_sessions
      where status in ('countdown', 'active')
    ),
    'open_rooms', (
      select count(*)::int from public.study_sessions
      where status in ('waiting', 'countdown', 'active')
    ),
    'pending_reports', (
      select count(*)::int from public.content_reports where status = 'open'
    ),
    'messages_today', (
      (select count(*)::int from public.dm_messages d
       join public.profiles p on p.id = d.sender_id
       where (timezone('Europe/Istanbul', d.created_at))::date = v_today
         and coalesce(p.profile_type, 'human') = 'human')
      + (select count(*)::int from public.exam_chat_messages m
         join public.profiles p on p.id = m.sender_id
         where (timezone('Europe/Istanbul', m.created_at))::date = v_today
           and coalesce(p.profile_type, 'human') = 'human')
    ),
    'upcoming_exam', (
      select jsonb_build_object('id', id, 'title', title, 'start_at', start_at)
      from public.system_exams
      where status not in ('draft', 'cancelled', 'finished') and start_at > now()
      order by start_at
      limit 1
    )
  );
end;
$$;

create or replace function public.seed_virtual_student_engine()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_exam uuid;
  v_i int := 0;
  v_subs uuid[];
  v_strong uuid[];
  v_weak uuid[];
  v_cv uuid;
  v_start time;
  v_end time;
begin
  for rec in
    select p.id, p.exam_id
    from public.profiles p
    where coalesce(p.is_bot, false) or coalesce(p.profile_type, 'human') = 'virtual'
    order by p.created_at
    limit 12
  loop
    v_i := v_i + 1;
    select e.id into v_exam
    from public.exams e
    order by (e.id = rec.exam_id) desc, e.created_at
    limit 1;
    if v_i % 3 = 1 then
      select e.id into v_exam from public.exams e where e.name ilike '%önlisans%' or e.name ilike '%kpss%' order by e.created_at limit 1;
    elsif v_i % 3 = 2 then
      select e.id into v_exam from public.exams e where e.name ilike '%tyt%' order by e.created_at limit 1;
    else
      select e.id into v_exam from public.exams e where e.name ilike '%ayt%' order by e.created_at limit 1;
    end if;
    v_exam := coalesce(v_exam, rec.exam_id);

    select cv.id into v_cv
    from public.curriculum_versions cv
    where cv.status = 'active'
    order by cv.created_at desc
    limit 1;

    select coalesce(array_agg(s.id), '{}') into v_subs
    from (
      select s.id from public.subjects s where s.exam_id = v_exam order by s.name limit 3
    ) s;
    v_strong := v_subs[1:2];
    v_weak := v_subs[3:3];
    v_start := ('18:00'::time + make_interval(hours => (v_i % 3)));
    v_end := '23:30'::time;

    update public.profiles
    set profile_type = 'virtual', is_bot = true, exam_id = coalesce(v_exam, exam_id)
    where id = rec.id;

    insert into public.virtual_student_profiles (
      profile_id, exam_id, curriculum_version_id, daily_goal_questions,
      preferred_subject_ids, strong_subject_ids, weak_subject_ids,
      active_hours_start, active_hours_end, social_activity_level, is_enabled
    ) values (
      rec.id, v_exam, v_cv, 30 + (v_i * 2),
      coalesce(v_subs, '{}'), coalesce(v_strong, '{}'), coalesce(v_weak, '{}'),
      v_start, v_end,
      (array['low', 'medium', 'high'])[1 + (v_i % 3)],
      true
    )
    on conflict (profile_id) do update
      set exam_id = excluded.exam_id,
          curriculum_version_id = excluded.curriculum_version_id,
          preferred_subject_ids = excluded.preferred_subject_ids,
          strong_subject_ids = excluded.strong_subject_ids,
          weak_subject_ids = excluded.weak_subject_ids;

    insert into public.virtual_student_presence (profile_id, state)
    values (rec.id, 'offline')
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.pulse_bots()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Social/room bot spam moved to virtual_student_engine_tick (kill switch).
  return;
end;
$$;

create or replace function public.get_profile_card(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_me uuid := auth.uid();
  v_from date := (timezone('Europe/Istanbul', now()))::date - 6;
  v_row jsonb;
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  if p_user is null then raise exception 'NOT_FOUND'; end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_me and blocked_id = p_user)
       or (blocker_id = p_user and blocked_id = v_me)
  ) then
    raise exception 'BLOCKED';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'display_tag', p.display_tag,
    'bio', p.bio,
    'exam_id', p.exam_id,
    'exam_name', e.name,
    'exam_year', p.exam_year,
    'target_score', p.target_score,
    'current_xp', p.current_xp,
    'is_private', coalesce(p.is_private, false),
    'is_bot', coalesce(p.is_bot, false),
    'profile_type', p.profile_type,
    'streak', coalesce(st.current_streak, 0),
    'follower_count', (
      select count(*)::int from public.user_follows f
      where f.followed_user_id = p.id and f.status = 'active'
    ),
    'following_count', (
      select count(*)::int from public.user_follows f
      where f.follower_user_id = p.id and f.status = 'active'
    ),
    'i_follow', exists (
      select 1 from public.user_follows f
      where f.follower_user_id = v_me and f.followed_user_id = p.id and f.status = 'active'
    ),
    'follow_pending', exists (
      select 1 from public.user_follows f
      where f.follower_user_id = v_me and f.followed_user_id = p.id and f.status = 'pending'
    ),
    'follows_me', exists (
      select 1 from public.user_follows f
      where f.follower_user_id = p.id and f.followed_user_id = v_me and f.status = 'active'
    ),
    'has_story', exists (
      select 1 from public.stories s
      where s.user_id = p.id
        and s.deleted_at is null
        and s.status = 'active'
        and s.expires_at > now()
    ),
    'week_questions', (
      select count(*)::int from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'week_ms', (
      select coalesce(sum(a.time_spent_ms), 0)::bigint from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'week_active', (
      select count(distinct (timezone('Europe/Istanbul', a.created_at))::date)::int
      from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'week_correct', (
      select count(*)::int from public.question_attempts a
      where a.user_id = p.id and a.is_correct
        and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
        and coalesce(a.is_virtual_activity, false) = false
    ),
    'top_subject', (
      select sub.name
      from public.question_attempts a
      join public.questions q on q.id = a.question_id
      join public.subjects sub on sub.id = q.subject_id
      where a.user_id = p.id
        and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
      group by sub.name
      order by count(*) desc
      limit 1
    ),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name))
      from (
        select sub.id, sub.name, count(*) as n
        from public.question_attempts a
        join public.questions q on q.id = a.question_id
        join public.subjects sub on sub.id = q.subject_id
        where a.user_id = p.id
          and a.created_at > now() - interval '30 days'
        group by sub.id, sub.name
        order by n desc
        limit 6
      ) x
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (
        select
          p2.id,
          p2.body,
          p2.kind,
          p2.created_at,
          sub.name as subject_name,
          (select count(*) from public.post_likes l where l.post_id = p2.id)::int as like_count,
          (select count(*) from public.post_comments c where c.post_id = p2.id and c.created_at <= now())::int as comment_count
        from public.social_posts p2
        left join public.subjects sub on sub.id = p2.subject_id
        where p2.user_id = p.id
          and p2.kind in ('status', 'ask', 'activity')
          and not exists (
            select 1 from public.social_posts d
            where d.user_id = p2.user_id
              and d.body = p2.body
              and d.id <> p2.id
              and d.created_at > p2.created_at
              and d.created_at <= p2.created_at + interval '10 minutes'
          )
        order by p2.created_at desc
        limit 12
      ) x
    ), '[]'::jsonb)
  )
  into v_row
  from public.profiles p
  left join public.exams e on e.id = p.exam_id
  left join public.streaks st on st.user_id = p.id
  where p.id = p_user;

  if v_row is null then raise exception 'NOT_FOUND'; end if;
  return v_row;
end;
$$;

select public.seed_virtual_student_engine();

grant execute on function public.get_story(uuid) to authenticated;
grant execute on function public.admin_virtual_students_overview() to authenticated;
grant execute on function public.admin_set_virtual_engine(boolean, text, numeric, int, int, numeric) to authenticated;
grant execute on function public.admin_set_virtual_profile(uuid, boolean, text, numeric, int) to authenticated;
grant execute on function public.admin_simulate_virtual_thread(text, int) to authenticated;

do $$
begin
  perform cron.schedule('kocum-virtual-tick', '* * * * *', 'select public.virtual_student_engine_tick()');
  perform cron.schedule('kocum-story-cleanup', '10 * * * *', 'select public.cleanup_expired_stories()');
exception when others then null;
end $$;
