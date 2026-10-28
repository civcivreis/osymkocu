-- Live study status + deterministic virtual social (no LLM required).

alter table public.profiles
  add column if not exists show_study_status_social boolean not null default true;

alter table public.virtual_student_engine_settings
  add column if not exists virtual_social_enabled boolean not null default true,
  add column if not exists deterministic_social_only boolean not null default false,
  add column if not exists social_post_interval_minutes int not null default 18,
  add column if not exists social_comment_interval_minutes int not null default 25,
  add column if not exists social_like_interval_minutes int not null default 12,
  add column if not exists social_follow_per_day int not null default 4,
  add column if not exists social_like_per_day int not null default 8,
  add column if not exists social_comment_per_day int not null default 6,
  add column if not exists social_post_per_day int not null default 5;

update public.virtual_student_engine_settings
set social_post_interval_minutes = greatest(8, least(social_post_interval_minutes, 90)),
    social_comment_interval_minutes = greatest(10, least(social_comment_interval_minutes, 120)),
    social_like_interval_minutes = greatest(5, least(social_like_interval_minutes, 90))
where id = 1;

create table if not exists public.virtual_social_templates (
  id uuid primary key default gen_random_uuid(),
  event_kind text not null,
  persona_style text not null default 'casual',
  body text not null,
  unique (event_kind, persona_style, body)
);

create table if not exists public.virtual_template_usage (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid not null references public.virtual_social_templates(id) on delete cascade,
  used_at timestamptz not null default now()
);

create index if not exists virtual_template_usage_recent_idx
  on public.virtual_template_usage (profile_id, used_at desc);

alter table public.virtual_social_templates enable row level security;
alter table public.virtual_template_usage enable row level security;

insert into public.virtual_social_templates (event_kind, persona_style, body) values
  ('LESSON_STARTED', 'short', 'biraz {subject} bakıyorum'),
  ('LESSON_STARTED', 'casual', '{topic} ile ısınayım dedim'),
  ('LESSON_STARTED', 'focused', '{subject} · {topic} açtım, sessiz gidiyorum'),
  ('LESSON_STARTED', 'encouraging', 'şimdi {topic}, tempo tutarsak biter'),
  ('LESSON_STARTED', 'minimal', '{topic}'),
  ('LESSON_COMPLETED', 'short', '{topic} kapandı'),
  ('LESSON_COMPLETED', 'casual', '{topic}i kapattım, nefes'),
  ('LESSON_COMPLETED', 'focused', '{subject} dersini bitirdim'),
  ('LESSON_COMPLETED', 'encouraging', '{topic} tamam, sıradakine'),
  ('LESSON_COMPLETED', 'minimal', 'bitti'),
  ('TEST_COMPLETED', 'short', '{topic} {score} geldi'),
  ('TEST_COMPLETED', 'casual', '{topic} testinde {score} doğru'),
  ('TEST_COMPLETED', 'focused', '{subject} denemesi {score}'),
  ('TEST_COMPLETED', 'encouraging', '{score} doğru, idare eder devam'),
  ('TEST_COMPLETED', 'minimal', '{score}'),
  ('LOW_SCORE', 'short', '{subject} bugün uğraştırdı'),
  ('LOW_SCORE', 'casual', '{topic} biraz dağıttı ama bırakmam'),
  ('LOW_SCORE', 'focused', 'zayıf nokta {topic}, tekrar'),
  ('LOW_SCORE', 'encouraging', 'düşük geldi, bir tur daha'),
  ('LOW_SCORE', 'minimal', 'hmm'),
  ('BREAK', 'short', 'kısa mola sonra devam'),
  ('BREAK', 'casual', 'su içip dönüyorum'),
  ('BREAK', 'focused', '5 dk, sonra {topic}'),
  ('BREAK', 'encouraging', 'mola, sonra tempo'),
  ('BREAK', 'minimal', 'mola'),
  ('PACKAGE_COMPLETE', 'short', 'paketi bitirdim'),
  ('PACKAGE_COMPLETE', 'casual', '5 konuluk paketi bitirdim'),
  ('PACKAGE_COMPLETE', 'focused', '{subject} paketi kapandı'),
  ('PACKAGE_COMPLETE', 'encouraging', 'paket bitti, iyi hissettim'),
  ('PACKAGE_COMPLETE', 'minimal', 'paket ok'),
  ('DAILY_GOAL', 'short', 'bugünkü hedef {goal} soru'),
  ('DAILY_GOAL', 'casual', 'hedef {goal}, yoldayım'),
  ('DAILY_GOAL', 'focused', 'günlük {goal} soru planı'),
  ('DAILY_GOAL', 'encouraging', '{goal} soruya gidiyoruz'),
  ('DAILY_GOAL', 'minimal', '{goal}'),
  ('ROOM_JOINED', 'short', 'odadayım'),
  ('ROOM_JOINED', 'casual', '{subject} odasına girdim'),
  ('ROOM_JOINED', 'focused', 'aynı konu odası'),
  ('COMMENT', 'short', 'devam et, tempo iyi'),
  ('COMMENT', 'casual', 'aynı setteyim'),
  ('COMMENT', 'focused', 'bende de zorladı'),
  ('COMMENT', 'encouraging', 'iyi gidiyor'),
  ('COMMENT', 'minimal', 'kaç soru çözdün'),
  ('COMMENT', 'casual', 'ben de birazdan buna geçicem'),
  ('COMMENT', 'encouraging', 'aynı konudasın, yazışalım'),
  ('COMMENT', 'short', 'net'),
  ('COMMENT', 'focused', '{subject} bugün ağır ama değer')
on conflict do nothing;

create or replace function public.live_study_status_for(p_user uuid, p_viewer uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_row record;
  v_virtual boolean := false;
  v_show boolean := true;
  v_state text;
begin
  if p_user is null then return null; end if;
  select coalesce(profile_type::text, 'human') in ('virtual'), coalesce(show_study_status_social, true)
    into v_virtual, v_show
  from public.profiles where id = p_user;
  if not found then return null; end if;
  if not v_virtual and not v_show and p_viewer is distinct from p_user then
    return null;
  end if;

  select
    p.user_id,
    p.subject_id,
    p.topic_id,
    p.exam_id,
    p.heartbeat_at,
    p.last_seen_at,
    p.status,
    sub.name as subject_name,
    t.name as topic_name
  into v_row
  from public.study_presence p
  left join public.subjects sub on sub.id = p.subject_id
  left join public.topics t on t.id = p.topic_id
  where p.user_id = p_user;

  if not found then
    select
      vp.profile_id as user_id,
      vp.subject_id,
      vp.topic_id,
      null::uuid as exam_id,
      vp.updated_at as heartbeat_at,
      vp.updated_at as last_seen_at,
      case when vp.state in ('studying', 'lesson', 'test') then 'studying' else vp.state end as status,
      sub.name as subject_name,
      t.name as topic_name
    into v_row
    from public.virtual_student_presence vp
    left join public.subjects sub on sub.id = vp.subject_id
    left join public.topics t on t.id = vp.topic_id
    where vp.profile_id = p_user
      and vp.updated_at > now() - interval '3 minutes'
      and vp.state in ('studying', 'lesson', 'test', 'social', 'room');
  end if;

  if v_row.user_id is null then return null; end if;

  if v_row.status = 'paused' and v_row.heartbeat_at > now() - interval '15 minutes' then
    v_state := 'BREAK';
  elsif v_row.heartbeat_at > now() - interval '3 minutes' and coalesce(v_row.status, 'studying') not in ('offline') then
    v_state := 'ACTIVE';
  else
    v_row.user_id := null;
  end if;

  if v_row.user_id is null then
    select
      vp.profile_id as user_id,
      vp.subject_id,
      vp.topic_id,
      null::uuid as exam_id,
      vp.updated_at as heartbeat_at,
      vp.updated_at as last_seen_at,
      case when vp.state in ('studying', 'lesson', 'test') then 'studying' else vp.state end as status,
      sub.name as subject_name,
      t.name as topic_name
    into v_row
    from public.virtual_student_presence vp
    left join public.subjects sub on sub.id = vp.subject_id
    left join public.topics t on t.id = vp.topic_id
    where vp.profile_id = p_user
      and vp.updated_at > now() - interval '3 minutes'
      and vp.state in ('studying', 'lesson', 'test', 'social', 'room');
    if not found then return null; end if;
    v_state := 'ACTIVE';
  end if;

  return jsonb_build_object(
    'user_id', v_row.user_id,
    'presence_state', v_state,
    'subject_id', v_row.subject_id,
    'topic_id', v_row.topic_id,
    'exam_id', v_row.exam_id,
    'subject_name', v_row.subject_name,
    'topic_name', v_row.topic_name,
    'started_at', v_row.last_seen_at,
    'last_activity_at', v_row.heartbeat_at
  );
end;
$$;

create or replace function public.list_live_studying()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.last_activity_at desc)
    from (
      select
        p.id as user_id,
        p.display_name,
        p.display_tag,
        p.profile_type,
        p.is_bot,
        live->>'presence_state' as presence_state,
        live->>'subject_id' as subject_id,
        live->>'topic_id' as topic_id,
        live->>'subject_name' as subject_name,
        live->>'topic_name' as topic_name,
        (live->>'last_activity_at')::timestamptz as last_activity_at
      from public.profiles p
      cross join lateral public.live_study_status_for(p.id, v_user) live
      where live is not null
        and live->>'presence_state' = 'ACTIVE'
        and p.id <> v_user
        and coalesce(p.profile_type::text, 'human') not in ('system')
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = v_user and b.blocked_id = p.id)
             or (b.blocker_id = p.id and b.blocked_id = v_user)
        )
      limit 24
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.expire_stale_study_presence()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
begin
  update public.study_presence
  set status = 'offline'
  where heartbeat_at < now() - interval '3 minutes'
    and status is distinct from 'offline';
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.pick_virtual_social_template(
  p_profile uuid,
  p_kind text,
  p_subject text default null,
  p_topic text default null,
  p_score int default null,
  p_goal int default null
)
returns table(template_id uuid, body text, persona_style text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_style text;
  v_body text;
  v_id uuid;
begin
  select case
    when conversation_style ilike '%short%' or conversation_style ilike '%minimal%' then 'short'
    when conversation_style ilike '%focus%' then 'focused'
    when conversation_style ilike '%encour%' or conversation_style ilike '%warm%' then 'encouraging'
    when conversation_style ilike '%quiet%' then 'minimal'
    else 'casual'
  end into v_style
  from public.virtual_student_profiles where profile_id = p_profile;
  v_style := coalesce(v_style, 'casual');

  select t.id, t.body, t.persona_style
  into v_id, v_body, v_style
  from public.virtual_social_templates t
  where t.event_kind = p_kind
    and (t.persona_style = v_style or t.event_kind = 'COMMENT')
    and not exists (
      select 1 from public.virtual_template_usage u
      where u.profile_id = p_profile
        and u.template_id = t.id
        and u.used_at > now() - interval '36 hours'
    )
  order by (t.persona_style = v_style) desc, random()
  limit 1;

  if v_id is null then
    select t.id, t.body, t.persona_style
    into v_id, v_body, v_style
    from public.virtual_social_templates t
    where t.event_kind = p_kind
    order by random()
    limit 1;
  end if;

  if v_id is null then
    return;
  end if;

  v_body := replace(v_body, '{subject}', coalesce(nullif(p_subject, ''), 'ders'));
  v_body := replace(v_body, '{topic}', coalesce(nullif(p_topic, ''), 'konu'));
  v_body := replace(v_body, '{score}', coalesce(p_score::text, ''));
  v_body := replace(v_body, '{goal}', coalesce(p_goal::text, '40'));

  if exists (
    select 1 from public.social_posts sp
    where sp.user_id = p_profile
      and lower(regexp_replace(sp.body, '\s+', ' ', 'g')) = lower(regexp_replace(v_body, '\s+', ' ', 'g'))
      and sp.created_at > now() - interval '18 hours'
  ) then
    return;
  end if;

  insert into public.virtual_template_usage (profile_id, template_id) values (p_profile, v_id);
  template_id := v_id;
  body := v_body;
  persona_style := v_style;
  return next;
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
  v_subject text;
  v_n int;
  v_ok int;
  v_kind text;
  v_picked record;
  v_post uuid;
begin
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile and is_enabled;
  if not found then return jsonb_build_object('ok', false, 'reason', 'PROFILE_DISABLED'); end if;
  perform public.set_virtual_presence(p_profile, 'social', v_prof.current_subject_id, v_prof.current_topic_id, null, 8);

  select name into v_subject from public.subjects where id = v_prof.current_subject_id;
  select name into v_topic from public.topics where id = v_prof.current_topic_id;

  select value->>'topic', (value->>'wrong')::int, (value->>'correct')::int
  into v_topic, v_n, v_ok
  from public.virtual_student_memory
  where profile_id = p_profile and memory_type = 'recent_test'
  order by updated_at desc limit 1;

  v_kind := case
    when v_ok is not null and v_n is not null and v_ok < greatest(3, (v_ok + coalesce(v_n, 0)) / 3) then 'LOW_SCORE'
    when v_ok is not null then 'TEST_COMPLETED'
    when random() < 0.15 then 'BREAK'
    when random() < 0.2 then 'DAILY_GOAL'
    when random() < 0.45 then 'LESSON_STARTED'
    else 'LESSON_COMPLETED'
  end;

  select * into v_picked from public.pick_virtual_social_template(
    p_profile, v_kind, v_subject, v_topic, v_ok, v_prof.daily_goal_questions
  );
  if v_picked.body is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE');
  end if;
  if public.content_moderation_level(v_picked.body) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED');
  end if;

  insert into public.social_posts (user_id, body, kind, content_type, subject_id, duration_minutes, expires_at, topic_id)
  values (p_profile, v_picked.body, 'status', 'post', v_prof.current_subject_id, 60, null, v_prof.current_topic_id)
  returning id into v_post;

  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_post', 1, 0, 'none', v_kind);

  return jsonb_build_object('ok', true, 'post_id', v_post, 'body', v_picked.body, 'reason', 'TEMPLATE');
end;
$$;

create or replace function public.virtual_try_social_like(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post uuid;
  v_day int;
  v_cap int;
begin
  select social_like_per_day into v_cap from public.virtual_student_engine_settings where id = 1;
  select count(*)::int into v_day
  from public.post_likes l
  where l.user_id = p_profile and l.created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_day >= coalesce(v_cap, 8) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;

  select sp.id into v_post
  from public.social_posts sp
  where sp.user_id <> p_profile
    and coalesce(sp.content_type, 'post') = 'post'
    and sp.created_at > now() - interval '18 hours'
    and not exists (select 1 from public.post_likes l where l.post_id = sp.id and l.user_id = p_profile)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = sp.user_id)
         or (b.blocker_id = sp.user_id and b.blocked_id = p_profile)
    )
  order by random()
  limit 1;
  if v_post is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;

  insert into public.post_likes (post_id, user_id) values (v_post, p_profile)
  on conflict do nothing;
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_like', 1, 0, 'none', 'template');
  return jsonb_build_object('ok', true, 'post_id', v_post);
end;
$$;

create or replace function public.virtual_try_social_comment(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post record;
  v_picked record;
  v_day int;
  v_cap int;
  v_id uuid;
  v_subject text;
begin
  select social_comment_per_day into v_cap from public.virtual_student_engine_settings where id = 1;
  select count(*)::int into v_day
  from public.post_comments c
  where c.user_id = p_profile and c.created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_day >= coalesce(v_cap, 6) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;

  select sp.id, sp.user_id, sp.subject_id, sub.name as subject_name
  into v_post
  from public.social_posts sp
  left join public.subjects sub on sub.id = sp.subject_id
  where sp.user_id <> p_profile
    and coalesce(sp.content_type, 'post') = 'post'
    and sp.created_at > now() - interval '12 hours'
    and not exists (select 1 from public.post_comments c where c.post_id = sp.id and c.user_id = p_profile)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = sp.user_id)
         or (b.blocker_id = sp.user_id and b.blocked_id = p_profile)
    )
  order by random()
  limit 1;
  if v_post.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;

  select * into v_picked from public.pick_virtual_social_template(p_profile, 'COMMENT', v_post.subject_name, null, null, null);
  if v_picked.body is null then return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE'); end if;
  if public.content_moderation_level(v_picked.body) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED');
  end if;

  insert into public.post_comments (post_id, user_id, body)
  values (v_post.id, p_profile, v_picked.body)
  returning id into v_id;
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_comment', 1, 0, 'none', 'template');
  return jsonb_build_object('ok', true, 'comment_id', v_id);
end;
$$;

create or replace function public.virtual_try_social_follow(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
  v_day int;
  v_cap int;
  v_allow_human boolean := false;
begin
  select social_follow_per_day into v_cap from public.virtual_student_engine_settings where id = 1;
  select count(*)::int into v_day
  from public.user_follows f
  where f.follower_user_id = p_profile and f.created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_day >= coalesce(v_cap, 4) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;

  select p.id into v_other
  from public.profiles p
  where p.id <> p_profile
    and coalesce(p.profile_type::text, 'human') = 'virtual'
    and not exists (
      select 1 from public.user_follows f
      where f.follower_user_id = p_profile and f.followed_user_id = p.id
    )
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = p_profile)
    )
  order by random()
  limit 1;

  if v_other is null and v_allow_human then
    select p.id into v_other
    from public.profiles p
    where coalesce(p.profile_type::text, 'human') = 'human'
      and p.id <> p_profile
    order by random() limit 1;
  end if;
  if v_other is null then return jsonb_build_object('ok', false, 'reason', 'NO_TARGET'); end if;

  insert into public.user_follows (follower_user_id, followed_user_id, status)
  values (p_profile, v_other, 'active')
  on conflict do nothing;
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_follow', 1, 0, 'none', 'template');
  return jsonb_build_object('ok', true, 'other', v_other);
end;
$$;

create or replace function public.virtual_sync_study_presence(p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.virtual_student_profiles%rowtype;
  v_exam uuid;
begin
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile and is_enabled;
  if not found then return; end if;
  if v_prof.current_subject_id is null then return; end if;
  select exam_id into v_exam from public.profiles where id = p_profile;
  insert into public.study_presence (user_id, subject_id, exam_id, topic_id, heartbeat_at, last_seen_at, is_available_for_match, status)
  values (
    p_profile,
    v_prof.current_subject_id,
    coalesce(v_exam, v_prof.exam_id),
    v_prof.current_topic_id,
    now(),
    now(),
    false,
    'studying'
  )
  on conflict (user_id) do update
    set subject_id = excluded.subject_id,
        exam_id = excluded.exam_id,
        topic_id = excluded.topic_id,
        heartbeat_at = now(),
        last_seen_at = now(),
        status = 'studying';
  perform public.set_virtual_presence(p_profile, 'studying', v_prof.current_subject_id, v_prof.current_topic_id, null, 12);
end;
$$;

create or replace function public.virtual_deterministic_social_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_posts int := 0;
  v_likes int := 0;
  v_comments int := 0;
  v_follows int := 0;
  v_presence int := 0;
  r record;
  v_res jsonb;
begin
  perform public.expire_stale_study_presence();
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if not found or not coalesce(v_cfg.virtual_students_enabled, false) then
    return jsonb_build_object('ok', false, 'reason', 'ENGINE_OFF');
  end if;
  if not coalesce(v_cfg.virtual_social_enabled, true) then
    return jsonb_build_object('ok', true, 'reason', 'SOCIAL_OFF', 'posts', 0);
  end if;

  if coalesce(v_cfg.deterministic_social_only, false) then
    update public.virtual_student_activity_jobs
    set status = 'cancelled', updated_at = now(), error_text = 'deterministic_social_only'
    where status = 'queued'
      and activity_type in ('social_post', 'social_comment', 'social_like');
  end if;

  for r in
    select vp.profile_id
    from public.virtual_student_profiles vp
    where vp.is_enabled
    order by random()
    limit 8
  loop
    perform public.virtual_sync_study_presence(r.profile_id);
    v_presence := v_presence + 1;
  end loop;

  for r in
    select vp.profile_id
    from public.virtual_student_profiles vp
    where vp.is_enabled
      and not exists (
        select 1 from public.social_posts sp
        where sp.user_id = vp.profile_id
          and sp.created_at > now() - make_interval(mins => greatest(8, v_cfg.social_post_interval_minutes))
      )
      and (
        select count(*) from public.social_posts sp
        where sp.user_id = vp.profile_id
          and sp.created_at::date = (timezone('Europe/Istanbul', now()))::date
      ) < v_cfg.social_post_per_day
    order by random()
    limit case v_cfg.activity_intensity when 'high' then 4 when 'low' then 1 else 2 end
  loop
    v_res := public.virtual_try_social_post(r.profile_id);
    if coalesce((v_res->>'ok')::boolean, false) then v_posts := v_posts + 1; end if;
  end loop;

  for r in
    select vp.profile_id
    from public.virtual_student_profiles vp
    where vp.is_enabled
      and not exists (
        select 1 from public.post_likes l
        where l.user_id = vp.profile_id
          and l.created_at > now() - make_interval(mins => greatest(5, v_cfg.social_like_interval_minutes))
      )
    order by random()
    limit case v_cfg.activity_intensity when 'high' then 5 when 'low' then 1 else 3 end
  loop
    v_res := public.virtual_try_social_like(r.profile_id);
    if coalesce((v_res->>'ok')::boolean, false) then v_likes := v_likes + 1; end if;
  end loop;

  for r in
    select vp.profile_id
    from public.virtual_student_profiles vp
    where vp.is_enabled
      and not exists (
        select 1 from public.post_comments c
        where c.user_id = vp.profile_id
          and c.created_at > now() - make_interval(mins => greatest(10, v_cfg.social_comment_interval_minutes))
      )
    order by random()
    limit case v_cfg.activity_intensity when 'high' then 3 when 'low' then 1 else 2 end
  loop
    v_res := public.virtual_try_social_comment(r.profile_id);
    if coalesce((v_res->>'ok')::boolean, false) then v_comments := v_comments + 1; end if;
  end loop;

  for r in
    select vp.profile_id from public.virtual_student_profiles vp where vp.is_enabled order by random() limit 2
  loop
    v_res := public.virtual_try_social_follow(r.profile_id);
    if coalesce((v_res->>'ok')::boolean, false) then v_follows := v_follows + 1; end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'ai', false,
    'posts', v_posts,
    'likes', v_likes,
    'comments', v_comments,
    'follows', v_follows,
    'presence', v_presence
  );
end;
$$;

create or replace function public.virtual_student_engine_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb := '{}'::jsonb;
  v_social jsonb := '{}'::jsonb;
  v_fb int := 0;
begin
  begin
    v := public.virtual_student_engine_tick_core();
  exception when others then
    v := jsonb_build_object('ok', false, 'core_error', sqlerrm);
  end;
  begin
    v_social := public.virtual_deterministic_social_tick();
  exception when others then
    v_social := jsonb_build_object('ok', false, 'social_error', sqlerrm);
  end;
  begin
    v_fb := public.virtual_ai_timeout_to_tier1();
  exception when others then
    v_fb := 0;
  end;
  return coalesce(v, '{}'::jsonb) || jsonb_build_object(
    'deterministic_social', v_social,
    'ai_fallback', v_fb,
    'ai_queued', (select count(*)::int from public.virtual_ai_requests where status = 'queued')
  );
end;
$$;

create or replace function public.admin_set_virtual_social(
  p_enabled boolean default null,
  p_deterministic_only boolean default null,
  p_post_interval int default null,
  p_comment_interval int default null,
  p_like_interval int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.virtual_student_engine_settings
  set virtual_social_enabled = coalesce(p_enabled, virtual_social_enabled),
      deterministic_social_only = coalesce(p_deterministic_only, deterministic_social_only),
      social_post_interval_minutes = coalesce(p_post_interval, social_post_interval_minutes),
      social_comment_interval_minutes = coalesce(p_comment_interval, social_comment_interval_minutes),
      social_like_interval_minutes = coalesce(p_like_interval, social_like_interval_minutes),
      updated_at = now()
  where id = 1;
  return (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1);
end;
$$;

create or replace function public.delete_own_comment(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  delete from public.post_comments
  where id = p_comment and user_id = v_user;
  if not found then raise exception 'NOT_FOUND'; end if;
end;
$$;

create or replace function public.share_study_achievement(
  p_title text,
  p_body text default null,
  p_subject_id uuid default null,
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
  v_text text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.profiles where id = v_user and coalesce(is_bot, false)) then
    raise exception 'UNAUTHORIZED';
  end if;
  v_text := trim(coalesce(p_title, ''));
  if p_body is not null and length(trim(p_body)) > 0 then
    v_text := v_text || E'\n' || trim(p_body);
  end if;
  return public.publish_status(v_text, p_subject_id, 60, 'activity', null, p_topic_id, p_canonical_topic_id);
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
        ) as comment_preview,
        live->>'presence_state' as live_presence_state,
        live->>'subject_name' as live_subject_name,
        live->>'topic_name' as live_topic_name,
        live->>'subject_id' as live_subject_id,
        live->>'topic_id' as live_topic_id
      from public.social_posts p
      join public.profiles a on a.id = p.user_id
      left join public.subjects sub on sub.id = p.subject_id
      left join public.topics t on t.id = p.topic_id
      left join public.canonical_topics ct on ct.id = p.canonical_topic_id
      left join public.canonical_units cu on cu.id = ct.canonical_unit_id
      left join lateral public.live_study_status_for(p.user_id, v_user) live on true
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
    'show_study_status_social', coalesce(p.show_study_status_social, true),
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
    ), '[]'::jsonb),
    'live_study', public.live_study_status_for(p.id, v_me)
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

grant execute on function public.live_study_status_for(uuid, uuid) to authenticated;
grant execute on function public.list_live_studying() to authenticated;
grant execute on function public.expire_stale_study_presence() to authenticated;
grant execute on function public.expire_stale_study_presence() to service_role;
grant execute on function public.delete_own_comment(uuid) to authenticated;
grant execute on function public.share_study_achievement(text, text, uuid, uuid, uuid) to authenticated;
grant execute on function public.admin_set_virtual_social(boolean, boolean, int, int, int) to authenticated;
grant execute on function public.virtual_deterministic_social_tick() to service_role;
grant execute on function public.virtual_student_engine_tick() to service_role;
grant execute on function public.get_social_feed() to authenticated;
grant execute on function public.get_profile_card(uuid) to authenticated;

notify pgrst, 'reload schema';
