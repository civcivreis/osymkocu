-- 3N.1 speech routing + narration chunks. 3L.1 virtual social feed visibility.

insert into public.ai_model_config (
  task_type, provider, primary_model, fallback_model, economy_model, premium_model,
  quality_tier, minimum_quality_tier, max_output_tokens, temperature, estimated_cost_class, notes
)
values (
  'coach_voice_preview', 'openai', 'gpt-realtime-2.1-mini', 'gpt-4o-mini-tts', 'gpt-4o-mini-tts', 'gpt-4o-mini-tts',
  'balanced', 'economy', null, null, 'medium',
  'Voice preview. Preferred realtime model has no clean /audio/speech path; adapter uses gpt-4o-mini-tts. tts-1-hd is not selected.'
)
on conflict (task_type) do update
set primary_model = excluded.primary_model,
    fallback_model = excluded.fallback_model,
    economy_model = excluded.economy_model,
    premium_model = excluded.premium_model,
    notes = excluded.notes,
    config_version = public.ai_model_config.config_version + 1,
    updated_at = now();

update public.ai_model_config
set primary_model = 'gpt-realtime-2.1-mini',
    fallback_model = 'gpt-4o-mini-tts',
    economy_model = 'gpt-4o-mini-tts',
    premium_model = 'gpt-4o-mini-tts',
    notes = 'Preferred: gpt-realtime-2.1-mini. Transitional HTTP speech: gpt-4o-mini-tts via /v1/audio/speech + instructions. tts-1-hd is not selected for new generation. Existing audio is not regenerated.',
    config_version = config_version + 1,
    updated_at = now()
where task_type = 'tts_generation';

update public.ai_runtime_settings
set tts_instructions = 'Speak in natural Turkish, as a warm personal exam coach talking directly to one student. Conversational pacing. Short sentences. Confident, not theatrical. Slight emphasis on keywords. Medium pace. Natural short pauses. Slow down on rules, definitions, and formulas. Energetic enough to keep attention. Never monotone or robotic. Do not sound like a presenter, influencer, or textbook reader. The student should feel: a coach is explaining this directly to me.',
    tts_voice_candidates = array['marin','cedar'],
    updated_at = now()
where id = 1;

create table if not exists public.memory_lesson_narration_chunks (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  scene_id uuid references public.memory_lesson_scenes(id) on delete set null,
  chunk_index int not null,
  chunk_role text not null default 'hap_bilgi',
  script_text text,
  text_hash text not null,
  model text,
  voice text,
  status text not null default 'pending'
    check (status in ('pending', 'generating', 'ready', 'rate_limited', 'failed')),
  r2_key text,
  mime_type text,
  duration_ms int,
  attempt_count int not null default 0,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, chunk_index)
);

create index if not exists memory_lesson_narration_chunks_lesson_idx
  on public.memory_lesson_narration_chunks (lesson_id, chunk_index);
alter table public.memory_lesson_narration_chunks enable row level security;

alter table public.memory_lesson_scenes
  add column if not exists media_attempt_count int not null default 0,
  add column if not exists media_next_retry_at timestamptz,
  add column if not exists media_error text;

create or replace function public.publish_validated_memory_lesson(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.memory_lessons%rowtype;
  v_scenes int;
  v_ready int;
  v_ck int;
  v_fn int;
  v_chunks int;
  v_chunk_ready int;
begin
  select * into v_row from public.memory_lessons where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_row.status = 'published' then
    return jsonb_build_object('id', p_id, 'status', 'published', 'already', true);
  end if;
  if coalesce(v_row.pedagogy_score, 0) < 80 then raise exception 'PEDAGOGY'; end if;
  if coalesce(v_row.narration, '') = '' or v_row.narration_key is null then raise exception 'NO_NARRATION'; end if;
  select count(*)::int, count(*) filter (where status = 'ready' and coalesce(r2_key, '') <> '')::int
    into v_chunks, v_chunk_ready
  from public.memory_lesson_narration_chunks where lesson_id = p_id;
  if v_chunks > 0 and v_chunk_ready <> v_chunks then raise exception 'NARRATION_CHUNKS'; end if;
  select count(*)::int, count(*) filter (where coalesce(asset_key, '') <> '')::int
    into v_scenes, v_ready
  from public.memory_lesson_scenes where lesson_id = p_id;
  if v_scenes < 4 or v_ready <> v_scenes then raise exception 'MEDIA_INCOMPLETE'; end if;
  select
    count(*) filter (where question_type = 'checkpoint'),
    count(*) filter (where question_type = 'final')
  into v_ck, v_fn
  from public.memory_lesson_questions where lesson_id = p_id;
  if v_ck < 2 or v_fn <> 10 then raise exception 'QUESTIONS_INCOMPLETE'; end if;

  update public.memory_lessons
  set status = 'published',
      published_at = coalesce(published_at, now()),
      media_generation_status = 'ready',
      media_generation_error = null,
      updated_at = now()
  where id = p_id;
  if v_row.topic_id is not null then
    update public.topic_catalog set content_status = 'published', updated_at = now() where id = v_row.topic_id;
  end if;
  return jsonb_build_object('id', p_id, 'status', 'published', 'media_ready', true);
end;
$$;

-- Virtual status posts were expiring in 60 minutes, so get_social_feed hid them.
create or replace function public.virtual_social_post_ttl()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.virtual_student_profiles v where v.profile_id = new.user_id) then
    if new.expires_at is null or new.expires_at < now() + interval '12 hours' then
      new.expires_at := now() + interval '18 hours';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_virtual_social_post_ttl on public.social_posts;
create trigger trg_virtual_social_post_ttl
before insert or update of expires_at on public.social_posts
for each row execute procedure public.virtual_social_post_ttl();

update public.social_posts p
set expires_at = p.created_at + interval '18 hours'
where p.created_at > now() - interval '48 hours'
  and exists (select 1 from public.virtual_student_profiles v where v.profile_id = p.user_id);

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
    select jsonb_agg(to_jsonb(x) order by (x.created_at)::timestamptz desc)
    from (
      select
        p.id,
        p.user_id,
        p.body,
        p.kind,
        p.created_at,
        p.subject_id,
        p.topic_id,
        p.canonical_topic_id,
        p.session_id,
        p.capacity,
        p.duration_minutes,
        p.expires_at,
        p.goal_label,
        a.display_name,
        a.display_tag,
        a.current_xp,
        a.is_bot,
        a.profile_type,
        sub.name as subject_name,
        t.name as topic_name,
        ct.name as canonical_topic_name,
        cu.name as unit_name,
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
      left join public.topics t on t.id = p.topic_id
      left join public.canonical_topics ct on ct.id = p.canonical_topic_id
      left join public.canonical_units cu on cu.id = ct.canonical_unit_id
      where (p.expires_at is null or p.expires_at > now())
        and coalesce(a.profile_type::text, 'human') not in ('system')
        and not exists (
          select 1 from public.user_blocks b
          where b.blocker_id = v_user and b.blocked_id = p.user_id
        )
      order by p.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.virtual_social_eligibility(p_profile uuid)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_prof public.virtual_student_profiles%rowtype;
  v_now time;
  v_active boolean;
  v_posts int;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if not found or not v_cfg.virtual_students_enabled then return 'GLOBAL_DISABLED'; end if;
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  if not found or not v_prof.is_enabled then return 'PROFILE_DISABLED'; end if;
  v_now := timezone(coalesce(v_prof.timezone, 'Europe/Istanbul'), now())::time;
  v_active := (v_prof.active_hours_start <= v_prof.active_hours_end and v_now between v_prof.active_hours_start and v_prof.active_hours_end)
    or (v_prof.active_hours_start > v_prof.active_hours_end and (v_now >= v_prof.active_hours_start or v_now <= v_prof.active_hours_end));
  if not v_active then return 'OUTSIDE_ACTIVE_HOURS'; end if;
  select count(*)::int into v_posts from public.social_posts where user_id = p_profile and created_at > now() - interval '12 hours';
  if v_posts >= 4 then return 'DAILY_SOCIAL_CAP'; end if;
  if exists (
    select 1 from public.social_posts
    where user_id = p_profile and created_at > now() - interval '45 minutes'
  ) then
    return 'SOCIAL_RATE_LIMIT';
  end if;
  if not exists (
    select 1 from public.virtual_student_activity_jobs
    where profile_id = p_profile
      and activity_type in ('social_post', 'update_status')
      and status in ('queued', 'running')
      and scheduled_for <= now() + interval '2 hours'
  ) then
    return 'NO_JOB_SCHEDULED';
  end if;
  return 'ELIGIBLE';
end;
$$;

create or replace function public.virtual_try_social_post(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.virtual_student_profiles%rowtype;
  v_topic text;
  v_n int;
  v_ok int;
  v_body text;
  v_post uuid;
  v_mod text;
begin
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  if not found then return jsonb_build_object('ok', false, 'reason', 'PROFILE_DISABLED'); end if;
  perform public.set_virtual_presence(p_profile, 'social', v_prof.current_subject_id, v_prof.current_topic_id, null, 8);

  select value->>'topic', (value->>'wrong')::int, (value->>'correct')::int
  into v_topic, v_n, v_ok
  from public.virtual_student_memory
  where profile_id = p_profile and memory_type = 'recent_test'
  order by updated_at desc limit 1;

  if v_topic is not null and v_n is not null then
    v_body := coalesce(v_topic, 'Konu') || 'de ' || coalesce(v_ok, 0)::text || ' doğru ' || coalesce(v_n, 0)::text || ' yanlış çıktı.';
  else
    select t.name into v_topic from public.topics t where t.id = v_prof.current_topic_id;
    if v_topic is null and v_prof.daily_goal_questions is null then
      return jsonb_build_object('ok', false, 'reason', 'NO_CONTEXT');
    end if;
    v_body := case floor(random() * 3)::int
      when 0 then coalesce(v_topic, 'Derse') || ' tekrarındayım.'
      when 1 then 'Bugünkü hedef ' || coalesce(v_prof.daily_goal_questions, 30)::text || ' soru, devam.'
      else coalesce(v_topic, 'Konu') || 'ni bitirip sonrakine geçiyorum.'
    end;
  end if;

  v_mod := public.content_moderation_level(v_body);
  if v_mod = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED', 'body', v_body);
  end if;
  if exists (
    select 1 from public.social_posts sp
    where sp.user_id = p_profile and sp.body = v_body
      and sp.created_at > now() - interval '12 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'DUPLICATE_REJECTED', 'body', v_body);
  end if;

  insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at, topic_id)
  values (p_profile, v_body, 'status', v_prof.current_subject_id, 60, now() + interval '18 hours', v_prof.current_topic_id)
  returning id into v_post;
  perform public.remember_virtual_fact(
    p_profile, 'recent_post', 'last', jsonb_build_object('body', v_body, 'post_id', v_post), interval '48 hours'
  );
  return jsonb_build_object('ok', true, 'post_id', v_post, 'body', v_body, 'reason', 'INSERTED');
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
      v_pulse := public.virtual_try_social_post(v_job.profile_id);
      update public.virtual_student_activity_jobs
      set context = coalesce(context, '{}'::jsonb) || jsonb_build_object('social', v_pulse),
          error_text = case when coalesce(v_pulse->>'ok', '') = 'true' then null else v_pulse->>'reason' end
      where id = p_id;

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

do $$
begin
  begin
    alter publication supabase_realtime add table public.social_posts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.post_likes;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.post_comments;
  exception when duplicate_object then null;
  end;
end $$;

grant execute on function public.virtual_try_social_post(uuid) to service_role;
grant execute on function public.virtual_social_eligibility(uuid) to service_role;
grant execute on function public.virtual_social_eligibility(uuid) to authenticated;
grant execute on function public.get_social_feed() to authenticated;
grant execute on function public.publish_validated_memory_lesson(uuid) to service_role;
grant execute on function public.publish_validated_memory_lesson(uuid) to authenticated;
