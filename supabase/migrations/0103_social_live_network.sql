-- Live social feed: 72h expiry, delayed likes/comments, follows, scene images.
-- Does not touch DMs, pair chat, or group chat messages.

alter table public.virtual_student_engine_settings
  add column if not exists social_like_enabled boolean not null default true,
  add column if not exists social_comment_enabled boolean not null default true,
  add column if not exists social_follow_enabled boolean not null default true,
  add column if not exists social_text_enabled boolean not null default true,
  add column if not exists social_image_enabled boolean not null default true,
  add column if not exists social_image_ai_enabled boolean not null default false,
  add column if not exists social_post_ttl_hours int not null default 72,
  add column if not exists social_image_per_day int not null default 4,
  add column if not exists social_unfollow_per_day int not null default 1;

alter table public.social_posts
  add column if not exists deleted_at timestamptz,
  add column if not exists feed_kind text not null default 'TEXT',
  add column if not exists event_kind text,
  add column if not exists media_id uuid references public.media(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'social_posts_feed_kind_check') then
    alter table public.social_posts
      add constraint social_posts_feed_kind_check
      check (feed_kind in ('TEXT', 'ACHIEVEMENT', 'STUDY_STATUS', 'IMAGE', 'TEST_RESULT'));
  end if;
end $$;

create index if not exists social_posts_feed_live_idx
  on public.social_posts (created_at desc)
  where deleted_at is null and coalesce(content_type, 'post') = 'post';

alter table public.post_comments
  add column if not exists deleted_at timestamptz;

create table if not exists public.virtual_social_actions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null check (action_type in ('POST', 'LIKE', 'COMMENT', 'FOLLOW', 'UNFOLLOW', 'IMAGE')),
  target_type text,
  target_id uuid,
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null,
  executed_at timestamptz,
  status text not null default 'queued' check (status in ('queued', 'done', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists virtual_social_actions_due_idx
  on public.virtual_social_actions (status, scheduled_at)
  where status = 'queued';

alter table public.virtual_social_actions enable row level security;

create table if not exists public.social_scene_assets (
  id uuid primary key default gen_random_uuid(),
  media_id uuid references public.media(id) on delete set null,
  prompt_category text not null,
  generated boolean not null default true,
  used_count int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.social_scene_assets enable row level security;

create or replace function public.social_post_ttl_hours()
returns int
language sql
stable
as $$
  select greatest(24, least(168, coalesce((select social_post_ttl_hours from public.virtual_student_engine_settings where id = 1), 72)));
$$;

create or replace function public.social_post_expiry_guard()
returns trigger
language plpgsql
as $$
begin
  new.content_type := coalesce(nullif(new.content_type, ''), 'post');
  new.feed_kind := coalesce(nullif(new.feed_kind, ''), 'TEXT');
  if new.content_type = 'story' then
    new.expires_at := coalesce(new.expires_at, coalesce(new.created_at, now()) + interval '24 hours');
  elsif new.content_type = 'post' then
    if tg_op = 'INSERT' or new.expires_at is null then
      new.expires_at := coalesce(new.created_at, now()) + make_interval(hours => public.social_post_ttl_hours());
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_social_post_expiry_guard on public.social_posts;
create trigger trg_social_post_expiry_guard
before insert or update of expires_at, content_type on public.social_posts
for each row execute procedure public.social_post_expiry_guard();

update public.social_posts
set expires_at = created_at + make_interval(hours => public.social_post_ttl_hours())
where coalesce(content_type, 'post') = 'post'
  and deleted_at is null
  and (expires_at is null or expires_at > created_at + interval '168 hours' or expires_at < created_at + interval '12 hours');

update public.social_posts
set deleted_at = coalesce(expires_at, now())
where coalesce(content_type, 'post') = 'post'
  and deleted_at is null
  and expires_at is not null
  and expires_at <= now();

delete from public.virtual_social_templates
where body in (
  'hmm',
  'düşük geldi, bir tur daha',
  'zayıf nokta {topic}, tekrar',
  'bitti',
  'net',
  '{score}',
  '{topic}',
  '{goal}'
);

insert into public.virtual_social_templates (event_kind, persona_style, body) values
  ('LESSON_STARTED', 'casual', '{subject} çalışıyorum, {topic} bugün daha iyi oturdu.'),
  ('LESSON_STARTED', 'focused', '{topic} açık, sessiz gidiyorum.'),
  ('LESSON_STARTED', 'encouraging', 'şimdi {topic}. tempo tutarsak biter.'),
  ('LESSON_STARTED', 'short', '{subject} · {topic} ile devam.'),
  ('LESSON_COMPLETED', 'casual', '{topic} bitti. biraz yordu ama kapandı.'),
  ('LESSON_COMPLETED', 'focused', '{subject} dersini tamamladım.'),
  ('LESSON_COMPLETED', 'encouraging', '{topic} tamam, sıradakine.'),
  ('TEST_COMPLETED', 'casual', '{topic} testinde {score} doğru geldi 🎯'),
  ('TEST_COMPLETED', 'focused', '{subject} denemesi: {score} doğru.'),
  ('TEST_COMPLETED', 'encouraging', '{score} doğru, idare eder devam.'),
  ('LOW_SCORE', 'casual', '{subject} bugün biraz uğraştırdı ama bırakmam.'),
  ('LOW_SCORE', 'focused', '{topic} zayıf kaldı, kısa tekrar yapacağım.'),
  ('LOW_SCORE', 'encouraging', '{topic} düşük geldi, bir tur daha bakacağım.'),
  ('BREAK', 'casual', 'kısa mola verip {subject}e devam.'),
  ('BREAK', 'focused', '5 dk, sonra {topic}.'),
  ('BREAK', 'encouraging', 'mola, sonra tempo.'),
  ('DAILY_GOAL', 'casual', 'bugünkü hedefin yarısı tamam.'),
  ('DAILY_GOAL', 'focused', 'günlük {goal} soru planındayım.'),
  ('PACKAGE_COMPLETE', 'casual', 'bu konuluk paketi birlikte bitirdim gibi hissediyorum.'),
  ('IMAGE', 'casual', 'biraz {subject} biraz kahve ☕'),
  ('IMAGE', 'focused', 'son 20 soru kaldı'),
  ('IMAGE', 'encouraging', 'bugün buradayız 📚'),
  ('COMMENT_TEST', 'casual', 'iyi gelmiş baya'),
  ('COMMENT_TEST', 'encouraging', 'gayet iyi, devam'),
  ('COMMENT_TEST', 'focused', 'ben de bugün {subject} çözüyorum'),
  ('COMMENT_LESSON', 'casual', 'ben de bugün oraya geçicem'),
  ('COMMENT_LESSON', 'focused', 'hangi konu?'),
  ('COMMENT_LESSON', 'encouraging', 'bir tekrar sonrası oturuyor'),
  ('COMMENT_LOW', 'casual', 'bende de {subject} bugün ağırdı'),
  ('COMMENT_LOW', 'encouraging', 'bırakma, kısa tekrar yeter'),
  ('COMMENT_BREAK', 'casual', 'iyi mola, sonra tempo'),
  ('COMMENT_GENERIC', 'casual', 'aynı setteyim'),
  ('COMMENT_GENERIC', 'encouraging', 'iyi gidiyor'),
  ('COMMENT_GENERIC', 'focused', '{subject} bugün değer')
on conflict do nothing;

create or replace function public.enqueue_virtual_social_action(
  p_profile uuid,
  p_action text,
  p_target_type text,
  p_target uuid,
  p_when timestamptz,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_when < now() + interval '90 seconds' then
    p_when := now() + interval '90 seconds';
  end if;
  insert into public.virtual_social_actions (profile_id, action_type, target_type, target_id, scheduled_at, payload)
  values (p_profile, p_action, p_target_type, p_target, p_when, coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.schedule_post_engagement(p_post uuid, p_author uuid, p_subject uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_human boolean := false;
  v_n int;
  r record;
  v_delay int;
  i int := 0;
begin
  select coalesce(profile_type::text, 'human') = 'human' into v_human from public.profiles where id = p_author;
  v_n := case when v_human then 1 + floor(random() * 3)::int else 2 + floor(random() * 4)::int end;
  for r in
    select vp.profile_id
    from public.virtual_student_profiles vp
    join public.profiles p on p.id = vp.profile_id
    where vp.is_enabled
      and vp.profile_id <> p_author
      and public.virtual_profile_is_active(vp.profile_id)
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = vp.profile_id and b.blocked_id = p_author)
           or (b.blocker_id = p_author and b.blocked_id = vp.profile_id)
      )
    order by
      (p.exam_id is not null and p.exam_id = (select exam_id from public.profiles where id = p_author)) desc,
      (vp.current_subject_id is not distinct from p_subject) desc,
      exists (
        select 1 from public.user_follows f
        where f.follower_user_id = vp.profile_id and f.followed_user_id = p_author and f.status = 'active'
      ) desc,
      random()
    limit v_n
  loop
    i := i + 1;
    v_delay := case i when 1 then 4 + floor(random() * 6)::int when 2 then 16 + floor(random() * 12)::int else 40 + floor(random() * 50)::int end;
    if v_human then v_delay := v_delay + 20 + floor(random() * 40)::int; end if;
    perform public.enqueue_virtual_social_action(r.profile_id, 'LIKE', 'post', p_post, now() + make_interval(mins => v_delay));
    if i = 1 and random() < 0.55 then
      perform public.enqueue_virtual_social_action(
        r.profile_id, 'COMMENT', 'post', p_post,
        now() + make_interval(mins => v_delay + 12 + floor(random() * 30)::int)
      );
    elsif i = 2 and random() < 0.28 then
      perform public.enqueue_virtual_social_action(
        r.profile_id, 'COMMENT', 'post', p_post,
        now() + make_interval(mins => 45 + floor(random() * 40)::int)
      );
    end if;
  end loop;
end;
$$;

create or replace function public.virtual_try_social_post(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_prof public.virtual_student_profiles%rowtype;
  v_topic text;
  v_subject text;
  v_n int;
  v_ok int;
  v_kind text;
  v_feed text := 'TEXT';
  v_picked record;
  v_post uuid;
  v_asset public.social_scene_assets%rowtype;
  v_images_today int;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.virtual_social_enabled is false or v_cfg.social_text_enabled is false then
    return jsonb_build_object('ok', false, 'reason', 'SOCIAL_OFF');
  end if;
  if not public.virtual_profile_is_active(p_profile) then
    return jsonb_build_object('ok', false, 'reason', 'OFF_HOURS');
  end if;
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile and is_enabled;
  if not found then return jsonb_build_object('ok', false, 'reason', 'PROFILE_DISABLED'); end if;
  if exists (
    select 1 from public.social_posts sp
    where sp.user_id = p_profile and sp.created_at > now() - interval '25 minutes'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'COOLDOWN');
  end if;

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
    when random() < 0.12 then 'BREAK'
    when random() < 0.18 then 'DAILY_GOAL'
    when random() < 0.42 then 'LESSON_STARTED'
    else 'LESSON_COMPLETED'
  end;
  v_feed := case v_kind
    when 'TEST_COMPLETED' then 'TEST_RESULT'
    when 'LOW_SCORE' then 'TEST_RESULT'
    when 'LESSON_STARTED' then 'STUDY_STATUS'
    when 'PACKAGE_COMPLETE' then 'ACHIEVEMENT'
    else 'TEXT'
  end;

  if coalesce(v_cfg.social_image_enabled, true)
     and v_cfg.deterministic_social_only is not true
     and random() < 0.12 then
    select count(*)::int into v_images_today
    from public.social_posts
    where feed_kind = 'IMAGE'
      and created_at::date = (timezone('Europe/Istanbul', now()))::date;
    if v_images_today < coalesce(v_cfg.social_image_per_day, 4) then
      select * into v_asset
      from public.social_scene_assets a
      where a.media_id is not null
        and (a.last_used_at is null or a.last_used_at < now() - interval '18 hours')
      order by a.used_count asc, random()
      limit 1;
    end if;
  end if;

  if v_asset.id is not null then
    v_kind := 'IMAGE';
    v_feed := 'IMAGE';
  end if;

  select * into v_picked from public.pick_virtual_social_template(
    p_profile, v_kind, v_subject, v_topic, v_ok, v_prof.daily_goal_questions
  );
  if v_picked.body is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE');
  end if;
  if public.content_moderation_level(v_picked.body) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED');
  end if;
  if exists (
    select 1 from public.social_posts sp
    where lower(regexp_replace(sp.body, '\s+', ' ', 'g')) = lower(regexp_replace(v_picked.body, '\s+', ' ', 'g'))
      and sp.created_at > now() - interval '3 hours'
      and sp.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'GLOBAL_DUP');
  end if;

  insert into public.social_posts (
    user_id, body, kind, content_type, subject_id, duration_minutes, expires_at, topic_id, feed_kind, event_kind, media_id
  )
  values (
    p_profile, v_picked.body, 'status', 'post', v_prof.current_subject_id, 60, null, v_prof.current_topic_id,
    v_feed, v_kind, v_asset.media_id
  )
  returning id into v_post;

  if v_asset.id is not null then
    update public.social_scene_assets
    set used_count = used_count + 1, last_used_at = now()
    where id = v_asset.id;
  end if;

  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_post', 1, 0, 'none', v_kind);
  perform public.schedule_post_engagement(v_post, p_profile, v_prof.current_subject_id);
  return jsonb_build_object('ok', true, 'post_id', v_post, 'body', v_picked.body, 'feed_kind', v_feed);
end;
$$;

create or replace function public.virtual_try_social_like(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_post uuid;
  v_day int;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_like_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  if not public.virtual_profile_is_active(p_profile) then return jsonb_build_object('ok', false, 'reason', 'OFF_HOURS'); end if;
  select count(*)::int into v_day
  from public.post_likes l
  where l.user_id = p_profile and l.created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_day >= least(12, greatest(3, coalesce(v_cfg.social_like_per_day, 8))) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;
  if exists (select 1 from public.post_likes l where l.user_id = p_profile and l.created_at > now() - interval '70 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'BURST');
  end if;

  select sp.id into v_post
  from public.social_posts sp
  join public.profiles a on a.id = sp.user_id
  left join public.virtual_student_profiles vp on vp.profile_id = p_profile
  where sp.user_id <> p_profile
    and sp.deleted_at is null
    and coalesce(sp.content_type, 'post') = 'post'
    and (sp.expires_at is null or sp.expires_at > now())
    and sp.created_at < now() - interval '3 minutes'
    and sp.created_at > now() - interval '70 hours'
    and not exists (select 1 from public.post_likes l where l.post_id = sp.id and l.user_id = p_profile)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = sp.user_id)
         or (b.blocker_id = sp.user_id and b.blocked_id = p_profile)
    )
  order by
    (a.exam_id is not distinct from (select exam_id from public.profiles where id = p_profile)) desc,
    (sp.subject_id is not distinct from vp.current_subject_id) desc,
    exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = sp.user_id) desc,
    random()
  limit 1;
  if v_post is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;
  insert into public.post_likes (post_id, user_id) values (v_post, p_profile) on conflict do nothing;
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
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_post record;
  v_picked record;
  v_day int;
  v_ckind text;
  v_id uuid;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_comment_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  if not public.virtual_profile_is_active(p_profile) then return jsonb_build_object('ok', false, 'reason', 'OFF_HOURS'); end if;
  select count(*)::int into v_day
  from public.post_comments c
  where c.user_id = p_profile and c.created_at::date = (timezone('Europe/Istanbul', now()))::date and c.deleted_at is null;
  if v_day >= coalesce(v_cfg.social_comment_per_day, 6) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;

  select sp.id, sp.user_id, sp.subject_id, sp.event_kind, sub.name as subject_name
  into v_post
  from public.social_posts sp
  left join public.subjects sub on sub.id = sp.subject_id
  where sp.user_id <> p_profile
    and sp.deleted_at is null
    and coalesce(sp.content_type, 'post') = 'post'
    and (sp.expires_at is null or sp.expires_at > now())
    and sp.created_at < now() - interval '8 minutes'
    and not exists (select 1 from public.post_comments c where c.post_id = sp.id and c.user_id = p_profile and c.deleted_at is null)
    and not exists (
      select 1 from public.post_comments c
      where c.user_id = p_profile and c.post_id in (select id from public.social_posts where user_id = sp.user_id)
        and c.created_at > now() - interval '4 hours'
    )
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = sp.user_id)
         or (b.blocker_id = sp.user_id and b.blocked_id = p_profile)
    )
  order by random()
  limit 1;
  if v_post.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;

  v_ckind := case coalesce(v_post.event_kind, '')
    when 'TEST_COMPLETED' then 'COMMENT_TEST'
    when 'LOW_SCORE' then 'COMMENT_LOW'
    when 'LESSON_COMPLETED' then 'COMMENT_LESSON'
    when 'LESSON_STARTED' then 'COMMENT_LESSON'
    when 'BREAK' then 'COMMENT_BREAK'
    else 'COMMENT_GENERIC'
  end;
  select * into v_picked from public.pick_virtual_social_template(p_profile, v_ckind, v_post.subject_name, null, null, null);
  if v_picked.body is null then
    select * into v_picked from public.pick_virtual_social_template(p_profile, 'COMMENT_GENERIC', v_post.subject_name, null, null, null);
  end if;
  if v_picked.body is null then return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE'); end if;
  if public.content_moderation_level(v_picked.body) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED');
  end if;

  insert into public.post_comments (post_id, user_id, body)
  values (v_post.id, p_profile, v_picked.body)
  returning id into v_id;
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_comment', 1, 0, 'none', v_ckind);
  return jsonb_build_object('ok', true, 'comment_id', v_id);
end;
$$;

create or replace function public.virtual_comment_on_post(p_profile uuid, p_post uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post record;
  v_picked record;
  v_ckind text;
  v_id uuid;
begin
  select sp.id, sp.user_id, sp.event_kind, sub.name as subject_name
  into v_post
  from public.social_posts sp
  left join public.subjects sub on sub.id = sp.subject_id
  where sp.id = p_post and sp.deleted_at is null;
  if v_post.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;
  if v_post.user_id = p_profile then return jsonb_build_object('ok', false, 'reason', 'SELF'); end if;
  if exists (select 1 from public.post_comments c where c.post_id = p_post and c.user_id = p_profile and c.deleted_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'DUP');
  end if;
  v_ckind := case coalesce(v_post.event_kind, '')
    when 'TEST_COMPLETED' then 'COMMENT_TEST'
    when 'LOW_SCORE' then 'COMMENT_LOW'
    when 'LESSON_COMPLETED' then 'COMMENT_LESSON'
    when 'LESSON_STARTED' then 'COMMENT_LESSON'
    when 'BREAK' then 'COMMENT_BREAK'
    else 'COMMENT_GENERIC'
  end;
  select * into v_picked from public.pick_virtual_social_template(p_profile, v_ckind, v_post.subject_name, null, null, null);
  if v_picked.body is null then
    select * into v_picked from public.pick_virtual_social_template(p_profile, 'COMMENT_GENERIC', v_post.subject_name, null, null, null);
  end if;
  if v_picked.body is null then return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE'); end if;
  insert into public.post_comments (post_id, user_id, body) values (p_post, p_profile, v_picked.body) returning id into v_id;
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
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_other uuid;
  v_day int;
  v_exam uuid;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_follow_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  if not public.virtual_profile_is_active(p_profile) then return jsonb_build_object('ok', false, 'reason', 'OFF_HOURS'); end if;
  select count(*)::int into v_day
  from public.user_follows f
  where f.follower_user_id = p_profile and f.created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_day >= coalesce(v_cfg.social_follow_per_day, 4) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;
  if exists (
    select 1 from public.user_follows f
    where f.follower_user_id = p_profile and f.created_at > now() - interval '40 minutes'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'COOLDOWN');
  end if;
  select exam_id into v_exam from public.profiles where id = p_profile;

  select p.id into v_other
  from public.profiles p
  where p.id <> p_profile
    and coalesce(p.profile_type::text, 'human') = 'virtual'
    and not exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = p.id)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = p_profile)
    )
  order by (p.exam_id is not distinct from v_exam) desc, random()
  limit 1;

  if v_other is null and random() < 0.18 then
    select p.id into v_other
    from public.profiles p
    join public.social_posts sp on sp.user_id = p.id
    where coalesce(p.profile_type::text, 'human') = 'human'
      and p.id <> p_profile
      and sp.created_at > now() - interval '6 hours'
      and sp.deleted_at is null
      and not exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = p.id)
    order by random()
    limit 1;
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

create or replace function public.virtual_try_social_unfollow(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
  v_day int;
  v_cap int;
begin
  select social_unfollow_per_day into v_cap from public.virtual_student_engine_settings where id = 1;
  select count(*)::int into v_day
  from public.virtual_activity_events e
  where e.profile_id = p_profile and e.activity_type = 'social_unfollow'
    and e.created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_day >= coalesce(v_cap, 1) then return jsonb_build_object('ok', false, 'reason', 'DAY_CAP'); end if;
  select f.followed_user_id into v_other
  from public.user_follows f
  where f.follower_user_id = p_profile and f.status = 'active' and f.created_at < now() - interval '3 days'
  order by random()
  limit 1;
  if v_other is null then return jsonb_build_object('ok', false, 'reason', 'NO_TARGET'); end if;
  delete from public.user_follows where follower_user_id = p_profile and followed_user_id = v_other;
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_unfollow', 1, 0, 'none', 'template');
  return jsonb_build_object('ok', true, 'other', v_other);
end;
$$;

create or replace function public.execute_virtual_social_action(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.virtual_social_actions%rowtype;
  v_res jsonb;
begin
  select * into v from public.virtual_social_actions where id = p_id and status = 'queued' for update skip locked;
  if not found then return jsonb_build_object('ok', false, 'reason', 'GONE'); end if;
  if v.action_type = 'LIKE' then
    if exists (select 1 from public.social_posts where id = v.target_id and deleted_at is null and (expires_at is null or expires_at > now())) then
      insert into public.post_likes (post_id, user_id) values (v.target_id, v.profile_id) on conflict do nothing;
      v_res := jsonb_build_object('ok', true);
    else
      v_res := jsonb_build_object('ok', false, 'reason', 'EXPIRED');
    end if;
  elsif v.action_type = 'COMMENT' then
    v_res := public.virtual_comment_on_post(v.profile_id, v.target_id);
  elsif v.action_type = 'FOLLOW' then
    v_res := public.virtual_try_social_follow(v.profile_id);
  elsif v.action_type = 'UNFOLLOW' then
    v_res := public.virtual_try_social_unfollow(v.profile_id);
  elsif v.action_type = 'POST' then
    v_res := public.virtual_try_social_post(v.profile_id);
  else
    v_res := jsonb_build_object('ok', false, 'reason', 'SKIP_IMAGE');
  end if;
  update public.virtual_social_actions
  set executed_at = now(),
      status = case when coalesce((v_res->>'ok')::boolean, false) then 'done' else 'skipped' end
  where id = p_id;
  return v_res;
end;
$$;

create or replace function public.cleanup_expired_social_feed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_soft int := 0;
  n_hard int := 0;
begin
  update public.social_posts
  set deleted_at = coalesce(deleted_at, now())
  where coalesce(content_type, 'post') = 'post'
    and deleted_at is null
    and expires_at is not null
    and expires_at <= now();
  get diagnostics n_soft = row_count;

  update public.post_comments c
  set deleted_at = now()
  where c.deleted_at is null
    and exists (
      select 1 from public.social_posts p
      where p.id = c.post_id and p.deleted_at is not null
    );

  delete from public.post_likes l
  using public.social_posts p
  where l.post_id = p.id and p.deleted_at is not null and p.deleted_at < now() - interval '2 days';

  delete from public.post_comments c
  where c.deleted_at is not null and c.deleted_at < now() - interval '2 days';

  delete from public.social_posts
  where deleted_at is not null
    and deleted_at < now() - interval '2 days'
    and coalesce(content_type, 'post') = 'post';
  get diagnostics n_hard = row_count;

  return jsonb_build_object('soft', n_soft, 'hard', n_hard);
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
  v_unfollows int := 0;
  v_scheduled int := 0;
  v_presence int := 0;
  v_unf uuid;
  r record;
  v_res jsonb;
  v_clean jsonb;
begin
  v_clean := public.cleanup_expired_social_feed();
  perform public.expire_stale_study_presence();
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if not found or not coalesce(v_cfg.virtual_students_enabled, false) then
    return jsonb_build_object('ok', false, 'reason', 'ENGINE_OFF', 'cleanup', v_clean);
  end if;
  if not coalesce(v_cfg.virtual_social_enabled, true) then
    return jsonb_build_object('ok', true, 'reason', 'SOCIAL_OFF', 'cleanup', v_clean);
  end if;

  if coalesce(v_cfg.deterministic_social_only, false) then
    update public.virtual_student_activity_jobs
    set status = 'cancelled', updated_at = now(), error_text = 'deterministic_social_only'
    where status = 'queued'
      and activity_type in ('social_post', 'social_comment', 'social_like');
  end if;

  for r in
    select id from public.virtual_social_actions
    where status = 'queued' and scheduled_at <= now()
    order by scheduled_at
    limit 12
  loop
    v_res := public.execute_virtual_social_action(r.id);
    v_scheduled := v_scheduled + 1;
  end loop;

  for r in
    select vp.profile_id from public.virtual_student_profiles vp
    where vp.is_enabled and public.virtual_profile_is_active(vp.profile_id)
    order by random() limit 8
  loop
    perform public.virtual_sync_study_presence(r.profile_id);
    v_presence := v_presence + 1;
  end loop;

  for r in
    select vp.profile_id
    from public.virtual_student_profiles vp
    where vp.is_enabled
      and public.virtual_profile_is_active(vp.profile_id)
      and not exists (
        select 1 from public.social_posts sp
        where sp.user_id = vp.profile_id
          and sp.created_at > now() - make_interval(mins => greatest(25, v_cfg.social_post_interval_minutes))
      )
      and (
        select count(*) from public.social_posts sp
        where sp.user_id = vp.profile_id
          and sp.created_at::date = (timezone('Europe/Istanbul', now()))::date
      ) < v_cfg.social_post_per_day
    order by random()
    limit case v_cfg.activity_intensity when 'high' then 3 when 'low' then 1 else 2 end
  loop
    v_res := public.virtual_try_social_post(r.profile_id);
    if coalesce((v_res->>'ok')::boolean, false) then v_posts := v_posts + 1; end if;
  end loop;

  for r in
    select vp.profile_id from public.virtual_student_profiles vp
    where vp.is_enabled and public.virtual_profile_is_active(vp.profile_id)
      and not exists (
        select 1 from public.post_likes l
        where l.user_id = vp.profile_id
          and l.created_at > now() - make_interval(mins => greatest(8, v_cfg.social_like_interval_minutes))
      )
    order by random()
    limit case v_cfg.activity_intensity when 'high' then 4 when 'low' then 1 else 2 end
  loop
    v_res := public.virtual_try_social_like(r.profile_id);
    if coalesce((v_res->>'ok')::boolean, false) then v_likes := v_likes + 1; end if;
  end loop;

  for r in
    select vp.profile_id from public.virtual_student_profiles vp
    where vp.is_enabled and public.virtual_profile_is_active(vp.profile_id)
      and not exists (
        select 1 from public.post_comments c
        where c.user_id = vp.profile_id
          and c.created_at > now() - make_interval(mins => greatest(12, v_cfg.social_comment_interval_minutes))
      )
    order by random()
    limit case v_cfg.activity_intensity when 'high' then 2 when 'low' then 1 else 1 end
  loop
    v_res := public.virtual_try_social_comment(r.profile_id);
    if coalesce((v_res->>'ok')::boolean, false) then v_comments := v_comments + 1; end if;
  end loop;

  for r in
    select vp.profile_id from public.virtual_student_profiles vp
    where vp.is_enabled and public.virtual_profile_is_active(vp.profile_id)
    order by random() limit 1
  loop
    v_res := public.virtual_try_social_follow(r.profile_id);
    if coalesce((v_res->>'ok')::boolean, false) then v_follows := v_follows + 1; end if;
  end loop;

  if random() < 0.08 then
    select vp.profile_id into v_unf
    from public.virtual_student_profiles vp
    where vp.is_enabled
    order by random()
    limit 1;
    if v_unf is not null then
      v_res := public.virtual_try_social_unfollow(v_unf);
      if coalesce((v_res->>'ok')::boolean, false) then v_unfollows := v_unfollows + 1; end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'ai', false,
    'posts', v_posts, 'likes', v_likes, 'comments', v_comments,
    'follows', v_follows, 'unfollows', v_unfollows,
    'scheduled_ran', v_scheduled, 'presence', v_presence, 'cleanup', v_clean
  );
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
        p.id, p.user_id, p.body, p.kind, p.content_type, p.created_at,
        p.subject_id, p.topic_id, p.canonical_topic_id, p.session_id, p.capacity,
        p.duration_minutes, p.expires_at, p.goal_label, p.feed_kind, p.event_kind, p.media_id,
        a.display_name, a.display_tag, a.current_xp, a.is_bot, a.profile_type,
        sub.name as subject_name, t.name as topic_name, ct.name as canonical_topic_name, cu.name as unit_name,
        (select count(*) from public.post_likes l where l.post_id = p.id)::int as like_count,
        (select count(*) from public.post_comments c where c.post_id = p.id and c.deleted_at is null)::int as comment_count,
        exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = v_user) as liked_by_me,
        (
          select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
          from (
            select cm.id, cm.user_id, cm.body, cm.created_at, pr.display_name, pr.display_tag, pr.is_bot
            from public.post_comments cm
            join public.profiles pr on pr.id = cm.user_id
            where cm.post_id = p.id and cm.parent_id is null and cm.deleted_at is null
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
        and p.deleted_at is null
        and (p.expires_at is null or p.expires_at > now())
        and coalesce(a.profile_type::text, 'human') not in ('system')
        and not exists (select 1 from public.user_blocks b where b.blocker_id = v_user and b.blocked_id = p.user_id)
      order by p.created_at desc
      limit 50
    ) x
  ), '[]'::jsonb);
end;
$$;

drop function if exists public.admin_set_virtual_social(boolean, boolean, int, int, int);

create or replace function public.admin_set_virtual_social(
  p_enabled boolean default null,
  p_deterministic_only boolean default null,
  p_post_interval int default null,
  p_comment_interval int default null,
  p_like_interval int default null,
  p_text boolean default null,
  p_image boolean default null,
  p_like boolean default null,
  p_comment boolean default null,
  p_follow boolean default null,
  p_image_ai boolean default null,
  p_ttl_hours int default null,
  p_image_per_day int default null
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
      social_text_enabled = coalesce(p_text, social_text_enabled),
      social_image_enabled = coalesce(p_image, social_image_enabled),
      social_like_enabled = coalesce(p_like, social_like_enabled),
      social_comment_enabled = coalesce(p_comment, social_comment_enabled),
      social_follow_enabled = coalesce(p_follow, social_follow_enabled),
      social_image_ai_enabled = coalesce(p_image_ai, social_image_ai_enabled),
      social_post_ttl_hours = coalesce(p_ttl_hours, social_post_ttl_hours),
      social_image_per_day = coalesce(p_image_per_day, social_image_per_day),
      updated_at = now()
  where id = 1;
  return (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1);
end;
$$;

create or replace function public.admin_simulate_social_network(p_steps int default 16)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i int;
  v jsonb := '{}'::jsonb;
  acc jsonb := '[]'::jsonb;
begin
  perform public.require_admin();
  for i in 1..greatest(1, least(p_steps, 40)) loop
    v := public.virtual_deterministic_social_tick();
    acc := acc || jsonb_build_array(v);
  end loop;
  return jsonb_build_object('ok', true, 'steps', p_steps, 'last', v, 'ticks', acc);
end;
$$;

do $$
begin
  perform cron.unschedule('kocum-social-cleanup');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('kocum-social-cleanup', '18 * * * *', 'select public.cleanup_expired_social_feed()');
exception when others then null;
end $$;

grant execute on function public.cleanup_expired_social_feed() to service_role;
grant execute on function public.virtual_deterministic_social_tick() to service_role;
grant execute on function public.virtual_try_social_unfollow(uuid) to service_role;
grant execute on function public.admin_set_virtual_social(boolean, boolean, int, int, int, boolean, boolean, boolean, boolean, boolean, boolean, int, int) to authenticated;
grant execute on function public.admin_simulate_social_network(int) to authenticated;
grant execute on function public.get_social_feed() to authenticated;

create or replace function public.social_post_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.content_type = 'post'
     and exists (
       select 1 from public.profiles p
       where p.id = new.user_id and coalesce(p.profile_type::text, 'human') = 'human'
     ) then
    perform public.schedule_post_engagement(new.id, new.user_id, new.subject_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_social_post_after_insert on public.social_posts;
create trigger trg_social_post_after_insert
after insert on public.social_posts
for each row execute procedure public.social_post_after_insert();

notify pgrst, 'reload schema';
