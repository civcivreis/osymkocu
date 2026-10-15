-- Phase 3M: virtual rooms, group-chat diagnostics, voice preview pointers, surface health.

alter table public.study_sessions
  add column if not exists canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  add column if not exists exam_id uuid references public.exams(id) on delete set null;

alter table public.virtual_student_engine_settings
  add column if not exists target_virtual_rooms int not null default 6;

create table if not exists public.coach_voice_previews (
  voice text primary key,
  r2_key text not null,
  byte_size int not null default 0,
  sample_text text,
  created_at timestamptz not null default now()
);
alter table public.coach_voice_previews enable row level security;

create or replace function public.group_line_too_similar(p_slug text, p_body text)
returns boolean
language plpgsql
stable
as $$
declare
  v text := public.exam_chat_norm(p_body);
  v_hit int;
begin
  if public.exam_chat_banned(p_body) then return true; end if;
  select count(*) into v_hit
  from (
    select body
    from public.exam_chat_messages
    where slug = p_slug
      and created_at > clock_timestamp() - interval '6 hours'
    order by created_at desc
    limit 24
  ) t
  where public.exam_chat_norm(t.body) = v
     or (length(v) >= 10 and left(public.exam_chat_norm(t.body), 18) = left(v, 18));
  return v_hit > 0;
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
        and m.created_at > clock_timestamp() - interval '6 hours'
      order by m.created_at desc
      limit 20
    ) x
    where public.exam_chat_norm(x.body) = public.exam_chat_norm(p_body)
       or left(public.exam_chat_norm(x.body), 18) = left(public.exam_chat_norm(p_body), 18)
  );
$$;

create or replace function public.exam_chat_pick_bots(p_slug text, p_n int)
returns uuid[]
language plpgsql
as $$
declare
  v uuid[];
begin
  select coalesce(array_agg(id), '{}') into v
  from (
    select pr.id
    from public.virtual_student_profiles vp
    join public.profiles pr on pr.id = vp.profile_id
    where vp.is_enabled
    order by random()
    limit greatest(2, least(4, p_n))
  ) s;
  if coalesce(array_length(v, 1), 0) < 2 then
    select coalesce(array_agg(id), v) into v
    from (
      select pr.id from public.profiles pr
      where coalesce(pr.is_bot, false) or coalesce(pr.profile_type, 'human') = 'virtual'
      order by random()
      limit 3
    ) t;
  end if;
  return v;
end;
$$;

drop function if exists public.pulse_exam_chats();

create function public.pulse_exam_chats()
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
  v_shift boolean;
  v_relation text;
  v_reply_flag boolean;
  v_text text;
  v_try int;
  v_reply uuid;
  v_name text;
  v_persona text;
  v_id uuid;
  v_on boolean;
  v_speakers int;
  v_last_msg timestamptz;
  v_stale boolean := false;
  v_stages text[] := '{}';
  v_reason text;
begin
  select virtual_students_enabled into v_on from public.virtual_student_engine_settings where id = 1;
  if v_on is not true then
    return jsonb_build_object('ok', false, 'reason', 'ENGINE_DISABLED', 'stages', v_stages);
  end if;

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
  if v_slug is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ELIGIBLE_THREAD', 'stages', v_stages);
  end if;

  select * into v_state from public.exam_chat_room_state where slug = v_slug for update;
  v_stages := array_append(v_stages, 'scene_selected');

  select max(created_at) into v_last_msg
  from public.exam_chat_messages where slug = v_slug;
  v_stale := v_last_msg is null or v_last_msg < clock_timestamp() - interval '90 minutes';

  if v_stale and (v_last_msg is null or v_last_msg < clock_timestamp() - interval '3 hours') then
    v_state.burst_bots := '{}';
    v_state.burst_left := 0;
    v_state.unresolved_question := null;
    v_state.topic_age := 0;
    update public.exam_chat_room_state
    set burst_bots = '{}',
        burst_left = 0,
        unresolved_question = null,
        topic_age = 0,
        next_eligible_at = clock_timestamp(),
        updated_at = now()
    where slug = v_slug;
  end if;

  select m.id, m.sender_id, m.body, m.created_at, pr.display_name
  into v_prev_id, v_prev, v_prev_body, v_prev_at, v_prev_name
  from public.exam_chat_messages m
  join public.profiles pr on pr.id = m.sender_id
  where m.slug = v_slug
    and m.created_at <= clock_timestamp()
  order by m.created_at desc
  limit 1;

  if v_prev_at is not null and v_prev_at > clock_timestamp() then
    update public.exam_chat_room_state
    set next_eligible_at = least(v_prev_at, clock_timestamp() + interval '20 seconds')
    where slug = v_slug;
    return jsonb_build_object('ok', false, 'reason', 'THREAD_COOLDOWN', 'slug', v_slug, 'stages', v_stages);
  end if;

  if v_state.burst_left <= 0 then
    if not v_stale and random() < 0.32 then
      update public.exam_chat_room_state
      set next_eligible_at = clock_timestamp() + make_interval(secs => 70 + floor(random() * 170)::int),
          updated_at = now()
      where slug = v_slug;
      return jsonb_build_object('ok', false, 'reason', 'SKIPPED_BY_ACTIVITY_PROBABILITY', 'slug', v_slug, 'stages', v_stages);
    end if;
    v_speakers := 2 + floor(random() * 3)::int;
    v_state.burst_bots := public.exam_chat_pick_bots(v_slug, v_speakers);
    v_state.burst_left := 3 + floor(random() * 6)::int;
  end if;

  if coalesce(array_length(v_state.burst_bots, 1), 0) < 2 then
    v_state.burst_bots := public.exam_chat_pick_bots(v_slug, 3);
  end if;

  select x into v_bot
  from unnest(v_state.burst_bots) as x
  where x is distinct from v_prev
  order by random()
  limit 1;
  if v_bot is null then
    select x into v_bot from unnest(v_state.burst_bots) as x order by random() limit 1;
  end if;
  if v_bot is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_SPEAKER', 'slug', v_slug, 'stages', v_stages);
  end if;
  v_stages := array_append(v_stages, 'speaker_selected');

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
  v_stages := array_append(v_stages, 'turn_planned');

  v_reply := null;
  if v_reply_flag and v_prev_id is not null then
    v_reply := v_prev_id;
  end if;

  if v_intent = 'continue_topic' then v_intent := 'continue_previous'; end if;
  if v_intent = 'shift_topic' then v_intent := 'change_topic'; end if;
  if v_intent in ('give_tip', 'react') then v_intent := 'encourage'; end if;

  v_text := null;
  v_stages := array_append(v_stages, 'generation_called');
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
        next_eligible_at = clock_timestamp() + make_interval(secs => 45 + floor(random() * 90)::int),
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
        next_eligible_at = clock_timestamp() + make_interval(secs => 8 + floor(random() * 20)::int),
        updated_at = now()
    where slug = v_slug;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reason', 'MESSAGE_INSERTED',
    'slug', v_slug,
    'message_id', v_id,
    'stages', v_stages
  );
end;
$$;

revoke all on function public.pulse_exam_chats() from public;
grant execute on function public.pulse_exam_chats() to authenticated;

create or replace function public.virtual_ensure_study_room(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.virtual_student_profiles%rowtype;
  v_subject uuid;
  v_session uuid;
  v_ids uuid[];
  v_open int := 0;
  v_target int := 6;
  v_members int := 0;
  v_topic text;
  v_exam uuid;
  v_canon uuid;
  v_created boolean := false;
  v_kind text := 'study';
begin
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_PROFILE');
  end if;
  perform public.virtual_pick_curriculum(p_profile);
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  v_subject := v_prof.current_subject_id;
  v_exam := v_prof.exam_id;
  if v_subject is null then
    select s.id, s.exam_id into v_subject, v_exam from public.subjects s order by random() limit 1;
  end if;
  select coalesce(target_virtual_rooms, target_active_rooms, 6) into v_target
  from public.virtual_student_engine_settings where id = 1;

  select s.id into v_session
  from public.study_sessions s
  where s.status in ('waiting', 'countdown', 'active')
    and s.is_private is not true
    and (v_subject is null or s.subject_id = v_subject)
    and (
      select count(*) from public.study_session_members m where m.session_id = s.id
    ) < coalesce(s.capacity, 5)
  order by s.created_at desc
  limit 1;

  if v_session is null then
    select count(*)::int into v_open
    from public.study_sessions s
    where s.status in ('waiting', 'countdown', 'active')
      and public.is_virtual_profile(s.host_id);
    if v_open >= v_target then
      return jsonb_build_object('ok', false, 'reason', 'ROOM_DENSITY_MET', 'open', v_open, 'target', v_target);
    end if;

    select array_agg(id) into v_ids
    from (
      select q.id from public.questions q
      where q.is_published and (v_subject is null or q.subject_id = v_subject)
      order by random() limit 10
    ) q;
    v_ids := coalesce(v_ids, '{}');
    if coalesce(array_length(v_ids, 1), 0) > 0 then
      v_kind := 'study';
    end if;

    select ml.canonical_topic_id into v_canon
    from public.memory_lessons ml
    where ml.status = 'published'
    order by ml.published_at desc nulls last
    limit 1;

    insert into public.study_sessions (
      subject_id, question_ids, status, mode, host_id, capacity, topic_id, title,
      chat_enabled, is_private, exam_id, canonical_topic_id
    )
    values (
      v_subject,
      v_ids,
      'waiting',
      v_kind,
      p_profile,
      5,
      v_prof.current_topic_id,
      'Sanal çalışma odası',
      true,
      false,
      v_exam,
      v_canon
    )
    returning id into v_session;
    v_created := true;
  end if;

  insert into public.study_session_members (session_id, user_id)
  values (v_session, p_profile)
  on conflict do nothing;
  select count(*) into v_members from public.study_session_members where session_id = v_session;
  perform public.set_virtual_presence(p_profile, 'in_room', v_subject, v_prof.current_topic_id, v_session, 25);

  select t.name into v_topic from public.topics t where t.id = v_prof.current_topic_id;
  if not exists (
    select 1 from public.study_session_messages m
    where m.session_id = v_session and m.sender_id = p_profile
      and m.created_at > now() - interval '8 minutes'
  ) then
    insert into public.study_session_messages (session_id, sender_id, body)
    values (
      v_session,
      p_profile,
      case
        when v_created then coalesce(v_topic, 'Konu') || ' için oda açtım, bağlamı netleştirip başlayalım.'
        else coalesce(v_topic, 'Bu konu') || 'da aynı odadayım, bağlama bağlı cümleleri eleyerek gidelim.'
      end
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'session_id', v_session,
    'members', v_members,
    'subject_id', v_subject,
    'exam_id', v_exam
  );
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
  v_pulse jsonb;
  v_room jsonb;
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
      v_pulse := public.pulse_exam_chats();
      update public.virtual_student_activity_jobs
      set context = coalesce(context, '{}'::jsonb) || jsonb_build_object('diag', v_pulse),
          error_text = case when coalesce(v_pulse->>'reason', '') = 'MESSAGE_INSERTED' then null else v_pulse->>'reason' end
      where id = p_id;

    elsif v_job.activity_type in ('join_room', 'create_room', 'room_chat') then
      v_room := public.virtual_ensure_study_room(v_job.profile_id);
      update public.virtual_student_activity_jobs
      set context = coalesce(context, '{}'::jsonb) || jsonb_build_object('diag', v_room),
          error_text = case when coalesce(v_room->>'ok', '') = 'true' then null else v_room->>'reason' end
      where id = p_id;

    elsif v_job.activity_type = 'take_system_exam' then
      perform public.set_virtual_presence(v_job.profile_id, 'system_exam', v_subject, null, null, 40);

    elsif v_job.activity_type = 'review_topic' then
      perform public.set_virtual_presence(v_job.profile_id, 'studying', v_subject, v_prof.current_topic_id, null, 10);
    end if;

    update public.virtual_student_activity_jobs
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = p_id;
    return jsonb_build_object('ok', true, 'type', v_job.activity_type, 'pulse', v_pulse, 'room', v_room);
  exception when others then
    update public.virtual_student_activity_jobs
    set status = 'failed', error_text = SQLERRM, updated_at = now()
    where id = p_id;
    return jsonb_build_object('ok', false, 'error', SQLERRM);
  end;
end;
$$;

create or replace function public.admin_virtual_students_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (timezone('Europe/Istanbul', now()))::date;
  v_last timestamptz;
  v_enabled boolean;
  v_profiles int;
  v_eligible int := 0;
  v_stall boolean := false;
  v_scheduler text := 'Error';
  v_target int := 6;
  v_rooms int := 0;
  v_hour time;
  v_last_group timestamptz;
  v_last_room timestamptz;
  v_last_test timestamptz;
  v_last_social timestamptz;
  v_last_lesson timestamptz;
  v_msg text;
begin
  perform public.require_admin();
  select s.virtual_students_enabled, coalesce(s.last_success_at, s.last_tick_at), coalesce(s.target_virtual_rooms, s.target_active_rooms, 6)
    into v_enabled, v_last, v_target
  from public.virtual_student_engine_settings s where id = 1;
  select count(*)::int into v_profiles from public.virtual_student_profiles where is_enabled;
  v_hour := (timezone('Europe/Istanbul', now()))::time;
  if v_hour >= time '18:00' and v_hour < time '23:30' then
    v_eligible := v_profiles;
  end if;

  if exists (select 1 from cron.job where jobname = 'kocum-virtual-tick' and active) then
    v_scheduler := 'Healthy';
  else
    v_scheduler := 'Stalled';
  end if;
  if v_enabled and v_profiles > 0 and (
    v_last is null or v_last < now() - make_interval(hours => coalesce((select stall_threshold_hours from public.virtual_student_engine_settings where id = 1), 6))
  ) then
    v_stall := true;
    if v_scheduler = 'Healthy' then v_scheduler := 'Stalled'; end if;
  end if;
  if exists (select 1 from public.virtual_student_engine_settings where id = 1 and last_failure_at is not null and last_failure_at > coalesce(last_success_at, '2000-01-01'::timestamptz)) then
    v_scheduler := 'Error';
  end if;

  select count(*)::int into v_rooms
  from public.study_sessions
  where status in ('waiting', 'countdown', 'active')
    and public.is_virtual_profile(host_id);

  select max(created_at) into v_last_group from public.exam_chat_messages where public.is_virtual_profile(sender_id);
  select max(created_at) into v_last_room from public.study_session_messages where public.is_virtual_profile(sender_id);
  select max(completed_at) into v_last_test from public.virtual_student_activity_jobs where status = 'completed' and activity_type = 'solve_test';
  select max(completed_at) into v_last_social from public.virtual_student_activity_jobs where status = 'completed' and activity_type in ('social_post', 'social_comment', 'social_like', 'update_status');
  select max(completed_at) into v_last_lesson from public.virtual_student_activity_jobs where status = 'completed' and activity_type = 'study_lesson';

  v_msg := null;
  if v_last_group is null or v_last_group < now() - interval '8 hours' then
    v_msg := 'Grup sohbeti üretimi ' || greatest(1, floor(extract(epoch from (now() - coalesce(v_last_group, now() - interval '8 days'))) / 3600)::int)::text || ' saattir mesaj yazmadı.';
  elsif v_last_room is null or v_last_room < now() - interval '8 hours' then
    v_msg := 'Oda aktivitesi 8 saattir sessiz.';
  end if;

  return jsonb_build_object(
    'settings', (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1),
    'enabled_profiles', v_profiles,
    'eligible_now', v_eligible,
    'online', (select count(*)::int from public.virtual_student_presence where state <> 'offline' and updated_at > now() - interval '20 minutes'),
    'studying', (select count(*)::int from public.virtual_student_presence where state = 'studying' and updated_at > now() - interval '20 minutes'),
    'testing', (select count(*)::int from public.virtual_student_presence where state = 'testing' and updated_at > now() - interval '20 minutes'),
    'in_rooms', (select count(*)::int from public.virtual_student_presence where state = 'in_room' and updated_at > now() - interval '20 minutes'),
    'social', (select count(*)::int from public.virtual_student_presence where state = 'social' and updated_at > now() - interval '20 minutes'),
    'rooms', v_rooms,
    'rooms_target', v_target,
    'daily_xp', (
      select coalesce(sum(t.amount), 0)::int from public.xp_transactions t
      where public.is_virtual_profile(t.user_id)
        and (timezone('Europe/Istanbul', t.created_at))::date = v_today
    ),
    'jobs', (
      select jsonb_build_object(
        'queued', count(*) filter (where status = 'queued'),
        'running', count(*) filter (where status = 'running'),
        'failed', count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours'),
        'completed', count(*) filter (where status = 'completed' and created_at > now() - interval '24 hours')
      ) from public.virtual_student_activity_jobs
    ),
    'last_virtual_activity', (
      select max(completed_at) from public.virtual_student_activity_jobs where status = 'completed'
    ),
    'last_tick_at', (select last_tick_at from public.virtual_student_engine_settings where id = 1),
    'surfaces', jsonb_build_object(
      'lesson', v_last_lesson,
      'test', v_last_test,
      'room', v_last_room,
      'social', v_last_social,
      'group_chat', v_last_group
    ),
    'scheduler', v_scheduler,
    'stall', v_stall or v_msg is not null,
    'stall_message', coalesce(v_msg, case when v_stall then 'Sanal öğrenci motorunda ilerleme yok.' else null end),
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
