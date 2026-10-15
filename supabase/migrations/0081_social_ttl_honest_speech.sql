-- 3N.2: persistent social posts vs 24h stories; honest TTS primary + usage adapter fields.

alter table public.social_posts
  add column if not exists content_type text not null default 'post';

alter table public.social_posts
  drop constraint if exists social_posts_content_type_check;

alter table public.social_posts
  add constraint social_posts_content_type_check
  check (content_type in ('post', 'story'));

update public.social_posts
set content_type = 'post'
where content_type is null or content_type <> 'story';

drop trigger if exists trg_virtual_social_post_ttl on public.social_posts;
drop function if exists public.virtual_social_post_ttl();

create or replace function public.social_post_expiry_guard()
returns trigger
language plpgsql
as $$
begin
  new.content_type := coalesce(nullif(new.content_type, ''), 'post');
  if new.content_type = 'post' then
    new.expires_at := null;
  elsif new.content_type = 'story' then
    new.expires_at := coalesce(new.expires_at, coalesce(new.created_at, now()) + interval '24 hours');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_social_post_expiry_guard on public.social_posts;
create trigger trg_social_post_expiry_guard
before insert or update of expires_at, content_type on public.social_posts
for each row execute procedure public.social_post_expiry_guard();

-- Recover feed posts (virtual + human). Do not touch the stories table.
update public.social_posts
set expires_at = null
where content_type = 'post';

create or replace function public.story_expiry_guard()
returns trigger
language plpgsql
as $$
begin
  new.expires_at := coalesce(new.expires_at, coalesce(new.created_at, now()) + interval '24 hours');
  return new;
end;
$$;

drop trigger if exists trg_story_expiry_guard on public.stories;
create trigger trg_story_expiry_guard
before insert or update of expires_at on public.stories
for each row execute procedure public.story_expiry_guard();

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
        p.content_type,
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
      where coalesce(p.content_type, 'post') = 'post'
        and (p.expires_at is null or p.expires_at > now())
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

  insert into public.social_posts (user_id, body, kind, content_type, subject_id, duration_minutes, expires_at, topic_id)
  values (p_profile, v_body, 'status', 'post', v_prof.current_subject_id, 60, null, v_prof.current_topic_id)
  returning id into v_post;
  perform public.remember_virtual_fact(
    p_profile, 'recent_post', 'last', jsonb_build_object('body', v_body, 'post_id', v_post), interval '48 hours'
  );
  return jsonb_build_object('ok', true, 'post_id', v_post, 'body', v_body, 'reason', 'INSERTED');
end;
$$;

create or replace function public.publish_status(
  p_body text,
  p_subject_id uuid default null,
  p_minutes int default null,
  p_kind text default 'status',
  p_goal text default null,
  p_topic_id uuid default null,
  p_canonical_topic_id uuid default null
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
  if public.content_moderation_level(p_body) = 'block' then raise exception 'MESSAGE_BLOCKED'; end if;
  if v_mins not in (30, 60, 120, 240) then v_mins := 60; end if;
  if v_kind not in ('status', 'ask', 'activity') then v_kind := 'status'; end if;
  insert into public.social_posts (user_id, body, kind, content_type, subject_id, duration_minutes, expires_at, goal_label, topic_id, canonical_topic_id)
  values (
    v_user,
    trim(p_body),
    v_kind,
    'post',
    p_subject_id,
    v_mins,
    null,
    nullif(left(trim(coalesce(p_goal, '')), 32), ''),
    p_topic_id,
    p_canonical_topic_id
  )
  returning id into v_id;
  return v_id;
end;
$$;

alter table public.ai_model_config
  add column if not exists transitional boolean not null default false;

alter table public.ai_usage_log
  add column if not exists adapter text,
  add column if not exists endpoint_type text;

update public.ai_model_config
set primary_model = 'gpt-4o-mini-tts',
    fallback_model = 'gpt-4o-mini-tts',
    economy_model = 'gpt-4o-mini-tts',
    premium_model = 'gpt-4o-mini-tts',
    transitional = true,
    notes = 'Transitional HTTP speech: audio_speech_transitional → gpt-4o-mini-tts via POST /v1/audio/speech. realtime_speech (gpt-realtime-2.1-mini) is not production-ready; do not store it as primary.',
    config_version = config_version + 1,
    updated_at = now()
where task_type in ('tts_generation', 'coach_voice_preview');
