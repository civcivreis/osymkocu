-- Virtual students engage human posts: delayed likes/comments/follows, replies, study invites.

alter table public.virtual_student_engine_settings
  add column if not exists social_max_virtual_likes_per_post int not null default 6,
  add column if not exists social_max_virtual_comments_per_post int not null default 3,
  add column if not exists social_max_virtual_follows_per_user_window int not null default 3,
  add column if not exists social_human_engagement_share numeric not null default 0.45,
  add column if not exists social_study_request_enabled boolean not null default true;

alter table public.virtual_social_actions drop constraint if exists virtual_social_actions_action_type_check;
alter table public.virtual_social_actions
  add constraint virtual_social_actions_action_type_check
  check (action_type in ('POST', 'LIKE', 'COMMENT', 'FOLLOW', 'UNFOLLOW', 'IMAGE', 'REPLY', 'STUDY_REQUEST'));

insert into public.virtual_social_templates (event_kind, persona_style, body) values
  ('COMMENT_ACHIEVEMENT', 'casual', 'tam isabet'),
  ('COMMENT_ACHIEVEMENT', 'encouraging', 'çok iyi 👏'),
  ('COMMENT_ACHIEVEMENT', 'focused', '20/20 baya sağlam'),
  ('COMMENT_ACHIEVEMENT', 'casual', 'tebrikler 👏'),
  ('COMMENT_STRUGGLE', 'casual', 'yarın daha iyi gider'),
  ('COMMENT_STRUGGLE', 'encouraging', 'bende de bazen öyle oluyor'),
  ('COMMENT_STRUGGLE', 'focused', 'hangi konu çalışıyorsun?'),
  ('COMMENT_STRUGGLE', 'casual', 'kısa mola iyi gelebilir'),
  ('COMMENT_TEST', 'casual', 'iyi gelmiş baya'),
  ('COMMENT_TEST', 'encouraging', '{score} gayet iyi'),
  ('COMMENT_TEST', 'focused', 'ben de bugün {subject} çözüyorum'),
  ('REPLY_TOPIC', 'casual', '{topic}'),
  ('REPLY_TOPIC', 'focused', 'şu an {topic}'),
  ('REPLY_TOPIC', 'encouraging', 'ben de {topic}deyim 😄'),
  ('REPLY_COUNT', 'casual', 'şimdilik 20'),
  ('REPLY_COUNT', 'focused', 'bugün 20 soru'),
  ('REPLY_HERE', 'casual', 'ben de oradayım 😄'),
  ('REPLY_CLOSE', 'casual', 'iyiymiş devam'),
  ('REPLY_CLOSE', 'encouraging', 'süper, tempo bozulmasın')
on conflict do nothing;

create or replace function public.profile_is_human(p_user uuid)
returns boolean
language sql
stable
as $eng$
  select coalesce((select coalesce(profile_type::text, 'human') from public.profiles where id = p_user), 'human') = 'human';
$eng$;

create or replace function public.infer_social_comment_kind(p_event text, p_feed text, p_body text)
returns text
language plpgsql
immutable
as $eng$
declare
  v text := lower(coalesce(p_body, ''));
begin
  if coalesce(p_event, '') in ('TEST_COMPLETED') or coalesce(p_feed, '') = 'TEST_RESULT' then
    if v ~ '20\s*/\s*20' or v ~ 'hepsi doğru' then return 'COMMENT_ACHIEVEMENT'; end if;
    return 'COMMENT_TEST';
  end if;
  if coalesce(p_event, '') = 'LOW_SCORE' or coalesce(p_feed, '') = 'ACHIEVEMENT' then
    if coalesce(p_feed, '') = 'ACHIEVEMENT' or v ~ '20\s*/\s*20' then return 'COMMENT_ACHIEVEMENT'; end if;
    return 'COMMENT_STRUGGLE';
  end if;
  if v ~ '20\s*/\s*20' or v ~ 'tam isabet' or v ~ 'hepsi doğru' then return 'COMMENT_ACHIEVEMENT'; end if;
  if v ~ 'hiç gitmedi' or v ~ 'zorladı' or v ~ 'kötüyd' or v ~ 'uğraştır' or v ~ 'dağitt' or v ~ 'düşük geldi' then
    return 'COMMENT_STRUGGLE';
  end if;
  if v ~ '\d+\s*/\s*\d+' or v ~ 'doğru geldi' or v ~ 'net' then return 'COMMENT_TEST'; end if;
  if coalesce(p_event, '') in ('LESSON_STARTED', 'LESSON_COMPLETED') then return 'COMMENT_LESSON'; end if;
  if coalesce(p_event, '') = 'BREAK' then return 'COMMENT_BREAK'; end if;
  return 'COMMENT_GENERIC';
end;
$eng$;

create or replace function public.notify_grouped_post_like(p_post uuid, p_from uuid)
returns void
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_author uuid;
  v_name text;
  v_tag int;
  v_id uuid;
  v_count int;
begin
  select user_id into v_author from public.social_posts where id = p_post;
  if v_author is null or v_author = p_from then return; end if;
  if not public.profile_is_human(v_author) then return; end if;
  select display_name, display_tag into v_name, v_tag from public.profiles where id = p_from;
  select n.id, coalesce((n.payload->>'count')::int, 1)
    into v_id, v_count
  from public.notifications n
  where n.user_id = v_author
    and n.kind = 'post_like'
    and n.payload->>'post_id' = p_post::text
    and n.created_at > now() - interval '8 hours'
  order by n.created_at desc
  limit 1;
  if v_id is not null then
    update public.notifications
    set payload = payload || jsonb_build_object(
      'count', v_count + 1,
      'from_user', p_from,
      'from_name', coalesce(v_name, 'Öğrenci'),
      'from_tag', v_tag
    )
    where id = v_id;
    return;
  end if;
  insert into public.notifications (user_id, kind, payload)
  values (
    v_author,
    'post_like',
    jsonb_build_object(
      'post_id', p_post,
      'from_user', p_from,
      'from_name', coalesce(v_name, 'Öğrenci'),
      'from_tag', v_tag,
      'count', 1
    )
  );
end;
$eng$;

create or replace function public.notify_post_comment_social(p_post uuid, p_from uuid, p_comment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_author uuid;
  v_name text;
  v_tag int;
begin
  select user_id into v_author from public.social_posts where id = p_post;
  if v_author is null or v_author = p_from then return; end if;
  if not public.profile_is_human(v_author) then return; end if;
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_author
      and n.kind = 'post_comment'
      and n.payload->>'from_user' = p_from::text
      and n.payload->>'post_id' = p_post::text
      and n.created_at > now() - interval '2 hours'
  ) then
    return;
  end if;
  select display_name, display_tag into v_name, v_tag from public.profiles where id = p_from;
  insert into public.notifications (user_id, kind, payload)
  values (
    v_author,
    'post_comment',
    jsonb_build_object(
      'post_id', p_post,
      'comment_id', p_comment,
      'from_user', p_from,
      'from_name', coalesce(v_name, 'Öğrenci'),
      'from_tag', v_tag
    )
  );
end;
$eng$;

create or replace function public.virtual_follow_user(p_profile uuid, p_other uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_name text;
  v_tag int;
  v_window int;
begin
  if p_profile is null or p_other is null or p_profile = p_other then
    return jsonb_build_object('ok', false, 'reason', 'INVALID');
  end if;
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_follow_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  if exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = p_other) then
    return jsonb_build_object('ok', false, 'reason', 'EXISTS');
  end if;
  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = p_profile and b.blocked_id = p_other) or (b.blocker_id = p_other and b.blocked_id = p_profile)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'BLOCKED');
  end if;
  select count(*)::int into v_window
  from public.user_follows f
  join public.virtual_student_profiles vp on vp.profile_id = f.follower_user_id
  where f.followed_user_id = p_other and f.created_at > now() - interval '24 hours';
  if v_window >= coalesce(v_cfg.social_max_virtual_follows_per_user_window, 3) then
    return jsonb_build_object('ok', false, 'reason', 'WINDOW');
  end if;
  if exists (
    select 1 from public.user_follows f
    where f.follower_user_id = p_profile and f.followed_user_id = p_other
  ) or exists (
    select 1 from public.virtual_activity_events e
    where e.profile_id = p_profile and e.activity_type = 'social_follow' and e.reason = p_other::text
      and e.created_at > now() - interval '3 days'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'COOLDOWN');
  end if;

  insert into public.user_follows (follower_user_id, followed_user_id, status)
  values (p_profile, p_other, 'active')
  on conflict do nothing;
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_follow', 1, 0, 'none', p_other::text);

  if public.profile_is_human(p_other) then
    select display_name, display_tag into v_name, v_tag from public.profiles where id = p_profile;
    if not exists (
      select 1 from public.notifications n
      where n.user_id = p_other and n.kind in ('follow', 'new_follower')
        and n.payload->>'from_user' = p_profile::text
        and n.created_at > now() - interval '24 hours'
    ) then
      insert into public.notifications (user_id, kind, payload)
      values (
        p_other, 'follow',
        jsonb_build_object('from_user', p_profile, 'from_name', coalesce(v_name, 'Öğrenci'), 'from_tag', v_tag)
      );
    end if;
  end if;
  return jsonb_build_object('ok', true, 'other', p_other);
end;
$eng$;

create or replace function public.schedule_post_engagement(p_post uuid, p_author uuid, p_subject uuid)
returns void
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_human boolean := false;
  v_new boolean := false;
  v_n int;
  r record;
  v_delay int;
  i int := 0;
  v_like_budget int;
  v_comment_budget int;
  v_comments_planned int := 0;
  v_skip numeric := 0.36;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  select public.profile_is_human(p_author) into v_human;
  select count(*) <= 3 into v_new from public.social_posts where user_id = p_author and coalesce(content_type, 'post') = 'post';

  if v_new then v_skip := 0.16; end if;
  if v_human and random() < v_skip then
    return;
  end if;
  if not v_human and random() < 0.08 then
    return;
  end if;

  v_like_budget := greatest(0, coalesce(v_cfg.social_max_virtual_likes_per_post, 6) - (
    (select count(*) from public.post_likes l
      join public.virtual_student_profiles vp on vp.profile_id = l.user_id
      where l.post_id = p_post)
    + (select count(*) from public.virtual_social_actions a
       where a.target_id = p_post and a.action_type = 'LIKE' and a.status = 'queued')
  )::int);
  v_comment_budget := greatest(0, coalesce(v_cfg.social_max_virtual_comments_per_post, 3) - (
    (select count(*) from public.post_comments c
      join public.virtual_student_profiles vp on vp.profile_id = c.user_id
      where c.post_id = p_post and c.deleted_at is null)
    + (select count(*) from public.virtual_social_actions a
       where a.target_id = p_post and a.action_type = 'COMMENT' and a.status = 'queued')
  )::int);

  v_n := least(
    v_like_budget,
    case
      when v_human and v_new then 1 + floor(random() * 3)::int
      when v_human then 1 + floor(random() * 3)::int
      else 2 + floor(random() * 4)::int
    end
  );
  if v_n <= 0 then return; end if;

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
      and not exists (
        select 1 from public.post_comments c
        join public.social_posts sp on sp.id = c.post_id
        where c.user_id = vp.profile_id and sp.user_id = p_author and c.created_at > now() - interval '10 hours'
      )
      and not exists (
        select 1 from public.post_likes l
        join public.social_posts sp on sp.id = l.post_id
        where l.user_id = vp.profile_id and sp.user_id = p_author and l.created_at > now() - interval '3 hours'
      )
    order by
      exists (select 1 from public.user_follows f where f.follower_user_id = vp.profile_id and f.followed_user_id = p_author and f.status = 'active') desc,
      (p.exam_id is not null and p.exam_id = (select exam_id from public.profiles where id = p_author)) desc,
      (vp.current_subject_id is not distinct from p_subject) desc,
      random()
    limit v_n
  loop
    i := i + 1;
    if v_human then
      v_delay := case i
        when 1 then 6 + floor(random() * 6)::int
        when 2 then 16 + floor(random() * 10)::int
        when 3 then 48 + floor(random() * 18)::int
        else 70 + floor(random() * 30)::int
      end;
    else
      v_delay := case i when 1 then 4 + floor(random() * 6)::int when 2 then 16 + floor(random() * 12)::int else 40 + floor(random() * 50)::int end;
    end if;
    perform public.enqueue_virtual_social_action(r.profile_id, 'LIKE', 'post', p_post, now() + make_interval(mins => v_delay));

    if v_comments_planned < v_comment_budget then
      if (i = 1 and random() < case when v_human then 0.42 else 0.50 end)
         or (i = 2 and random() < case when v_human then 0.22 else 0.28 end) then
        perform public.enqueue_virtual_social_action(
          r.profile_id, 'COMMENT', 'post', p_post,
          now() + make_interval(mins => v_delay + 12 + floor(random() * 28)::int)
        );
        v_comments_planned := v_comments_planned + 1;
      end if;
    end if;

    if v_human and random() < 0.18 then
      perform public.enqueue_virtual_social_action(
        r.profile_id, 'FOLLOW', 'user', p_author,
        now() + make_interval(hours => 18 + floor(random() * 54)::int)
      );
    end if;
  end loop;
end;
$eng$;

create or replace function public.virtual_try_social_like(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_post uuid;
  v_author uuid;
  v_day int;
  v_prefer_human boolean := false;
  v_share numeric;
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

  v_share := least(0.75, greatest(0.2, coalesce(v_cfg.social_human_engagement_share, 0.45)));
  v_prefer_human := exists (
    select 1 from public.social_posts sp
    join public.profiles a on a.id = sp.user_id
    where public.profile_is_human(a.id)
      and sp.deleted_at is null
      and coalesce(sp.content_type, 'post') = 'post'
      and sp.created_at > now() - interval '12 hours'
  ) and random() < v_share;

  select sp.id, sp.user_id into v_post, v_author
  from public.social_posts sp
  join public.profiles a on a.id = sp.user_id
  left join public.virtual_student_profiles vp on vp.profile_id = p_profile
  where sp.user_id <> p_profile
    and sp.deleted_at is null
    and coalesce(sp.content_type, 'post') = 'post'
    and (sp.expires_at is null or sp.expires_at > now())
    and sp.created_at < now() - interval '3 minutes'
    and sp.created_at > now() - interval '70 hours'
    and (not v_prefer_human or public.profile_is_human(a.id))
    and not exists (select 1 from public.post_likes l where l.post_id = sp.id and l.user_id = p_profile)
    and (
      select count(*) from public.post_likes l
      join public.virtual_student_profiles vpx on vpx.profile_id = l.user_id
      where l.post_id = sp.id
    ) < coalesce(v_cfg.social_max_virtual_likes_per_post, 6)
    and not exists (
      select 1 from public.post_likes l
      join public.social_posts sp2 on sp2.id = l.post_id
      where l.user_id = p_profile and sp2.user_id = sp.user_id and l.created_at > now() - interval '3 hours'
    )
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = sp.user_id)
         or (b.blocker_id = sp.user_id and b.blocked_id = p_profile)
    )
  order by
    exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = sp.user_id) desc,
    (a.exam_id is not distinct from (select exam_id from public.profiles where id = p_profile)) desc,
    (sp.subject_id is not distinct from vp.current_subject_id) desc,
    random()
  limit 1;
  if v_post is null and v_prefer_human then
    select sp.id, sp.user_id into v_post, v_author
    from public.social_posts sp
    join public.profiles a on a.id = sp.user_id
    left join public.virtual_student_profiles vp on vp.profile_id = p_profile
    where sp.user_id <> p_profile
      and sp.deleted_at is null
      and coalesce(sp.content_type, 'post') = 'post'
      and (sp.expires_at is null or sp.expires_at > now())
      and sp.created_at < now() - interval '3 minutes'
      and not exists (select 1 from public.post_likes l where l.post_id = sp.id and l.user_id = p_profile)
    order by random()
    limit 1;
  end if;
  if v_post is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;
  insert into public.post_likes (post_id, user_id) values (v_post, p_profile) on conflict do nothing;
  perform public.notify_grouped_post_like(v_post, p_profile);
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, 'social_like', 1, 0, 'none', coalesce(v_author::text, 'template'));
  return jsonb_build_object('ok', true, 'post_id', v_post);
end;
$eng$;

create or replace function public.virtual_comment_on_post(p_profile uuid, p_post uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_post record;
  v_picked record;
  v_ckind text;
  v_id uuid;
  v_score int;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_comment_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  select sp.id, sp.user_id, sp.body, sp.event_kind, sp.feed_kind, sp.subject_id, sub.name as subject_name, t.name as topic_name
  into v_post
  from public.social_posts sp
  left join public.subjects sub on sub.id = sp.subject_id
  left join public.topics t on t.id = sp.topic_id
  where sp.id = p_post and sp.deleted_at is null;
  if v_post.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;
  if v_post.user_id = p_profile then return jsonb_build_object('ok', false, 'reason', 'SELF'); end if;
  if exists (select 1 from public.post_comments c where c.post_id = p_post and c.user_id = p_profile and c.deleted_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'DUP');
  end if;
  if (
    select count(*) from public.post_comments c
    join public.virtual_student_profiles vp on vp.profile_id = c.user_id
    where c.post_id = p_post and c.deleted_at is null
  ) >= coalesce(v_cfg.social_max_virtual_comments_per_post, 3) then
    return jsonb_build_object('ok', false, 'reason', 'BUDGET');
  end if;
  if exists (
    select 1 from public.post_comments c
    join public.social_posts sp on sp.id = c.post_id
    where c.user_id = p_profile and sp.user_id = v_post.user_id and c.created_at > now() - interval '10 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'AUTHOR_COOLDOWN');
  end if;

  v_ckind := public.infer_social_comment_kind(v_post.event_kind, v_post.feed_kind, v_post.body);
  begin
    v_score := (regexp_match(coalesce(v_post.body, ''), '(\d+)\s*/\s*\d+'))[1]::int;
  exception when others then
    v_score := null;
  end;
  select * into v_picked from public.pick_virtual_social_template(p_profile, v_ckind, v_post.subject_name, v_post.topic_name, v_score, null);
  if v_picked.body is null then
    select * into v_picked from public.pick_virtual_social_template(p_profile, 'COMMENT_GENERIC', v_post.subject_name, v_post.topic_name, v_score, null);
  end if;
  if v_picked.body is null then return jsonb_build_object('ok', false, 'reason', 'NO_TEMPLATE'); end if;
  if lower(regexp_replace(v_picked.body, '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(v_post.body, ''), '\s+', ' ', 'g')) then
    return jsonb_build_object('ok', false, 'reason', 'COPY');
  end if;

  insert into public.post_comments (post_id, user_id, body)
  values (p_post, p_profile, v_picked.body)
  returning id into v_id;
  perform public.notify_post_comment_social(p_post, p_profile, v_id);
  return jsonb_build_object('ok', true, 'comment_id', v_id, 'kind', v_ckind);
end;
$eng$;

create or replace function public.virtual_try_social_comment(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_post uuid;
  v_day int;
  v_prefer_human boolean := false;
  v_share numeric;
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

  v_share := least(0.75, greatest(0.2, coalesce(v_cfg.social_human_engagement_share, 0.45)));
  v_prefer_human := exists (
    select 1 from public.social_posts sp
    where public.profile_is_human(sp.user_id)
      and sp.deleted_at is null
      and sp.created_at > now() - interval '12 hours'
  ) and random() < v_share;

  select sp.id into v_post
  from public.social_posts sp
  left join public.subjects sub on sub.id = sp.subject_id
  left join public.virtual_student_profiles vp on vp.profile_id = p_profile
  where sp.user_id <> p_profile
    and sp.deleted_at is null
    and coalesce(sp.content_type, 'post') = 'post'
    and (sp.expires_at is null or sp.expires_at > now())
    and sp.created_at < now() - interval '8 minutes'
    and (not v_prefer_human or public.profile_is_human(sp.user_id))
    and not exists (select 1 from public.post_comments c where c.post_id = sp.id and c.user_id = p_profile and c.deleted_at is null)
    and not exists (
      select 1 from public.post_comments c
      join public.social_posts sp2 on sp2.id = c.post_id
      where c.user_id = p_profile and sp2.user_id = sp.user_id and c.created_at > now() - interval '10 hours'
    )
    and (
      select count(*) from public.post_comments c
      join public.virtual_student_profiles vpx on vpx.profile_id = c.user_id
      where c.post_id = sp.id and c.deleted_at is null
    ) < coalesce(v_cfg.social_max_virtual_comments_per_post, 3)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = p_profile and b.blocked_id = sp.user_id)
         or (b.blocker_id = sp.user_id and b.blocked_id = p_profile)
    )
  order by
    exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = sp.user_id) desc,
    (sp.subject_id is not distinct from vp.current_subject_id) desc,
    random()
  limit 1;
  if v_post is null then return jsonb_build_object('ok', false, 'reason', 'NO_POST'); end if;
  return public.virtual_comment_on_post(p_profile, v_post);
end;
$eng$;

create or replace function public.virtual_try_social_follow(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_other uuid;
  v_day int;
  v_exam uuid;
  v_prefer_human boolean := false;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_follow_enabled is false then return jsonb_build_object('ok', false, 'reason', 'OFF'); end if;
  if not public.virtual_profile_is_active(p_profile) then return jsonb_build_object('ok', false, 'reason', 'OFF_HOURS'); end if;
  if random() < 0.55 then return jsonb_build_object('ok', false, 'reason', 'SKIP_PACE'); end if;
  select count(*)::int into v_day
  from public.user_follows f
  where f.follower_user_id = p_profile and f.created_at::date = (timezone('Europe/Istanbul', now()))::date;
  if v_day >= coalesce(v_cfg.social_follow_per_day, 2) then
    return jsonb_build_object('ok', false, 'reason', 'DAY_CAP');
  end if;
  if exists (
    select 1 from public.user_follows f
    where f.follower_user_id = p_profile and f.created_at > now() - interval '3 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'COOLDOWN');
  end if;
  select exam_id into v_exam from public.profiles where id = p_profile;
  v_prefer_human := exists (
    select 1 from public.social_posts sp
    where public.profile_is_human(sp.user_id) and sp.created_at > now() - interval '24 hours' and sp.deleted_at is null
  ) and random() < least(0.75, greatest(0.2, coalesce(v_cfg.social_human_engagement_share, 0.45)));

  if v_prefer_human then
    select p.id into v_other
    from public.profiles p
    join public.social_posts sp on sp.user_id = p.id
    where public.profile_is_human(p.id)
      and p.id <> p_profile
      and sp.deleted_at is null
      and sp.created_at > now() - interval '3 days'
      and not exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = p.id)
    order by
      (p.exam_id is not distinct from v_exam) desc,
      exists (select 1 from public.post_likes l join public.social_posts sx on sx.id = l.post_id where l.user_id = p_profile and sx.user_id = p.id) desc,
      random()
    limit 1;
  end if;

  if v_other is null then
    select p.id into v_other
    from public.profiles p
    where p.id <> p_profile
      and coalesce(p.profile_type::text, 'human') = 'virtual'
      and not exists (select 1 from public.user_follows f where f.follower_user_id = p_profile and f.followed_user_id = p.id)
    order by (p.exam_id is not distinct from v_exam) desc, random()
    limit 1;
  end if;
  if v_other is null then return jsonb_build_object('ok', false, 'reason', 'NO_TARGET'); end if;
  return public.virtual_follow_user(p_profile, v_other);
end;
$eng$;

create or replace function public.virtual_reply_to_comment(p_profile uuid, p_comment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_c record;
  v_kind text;
  v_topic text;
  v_subject text;
  v_picked record;
  v_id uuid;
  v_body text;
begin
  select c.id, c.post_id, c.user_id, c.body, c.parent_id, sp.user_id as author_id
  into v_c
  from public.post_comments c
  join public.social_posts sp on sp.id = c.post_id
  where c.id = p_comment and c.deleted_at is null and sp.deleted_at is null;
  if v_c.id is null then return jsonb_build_object('ok', false, 'reason', 'NO_COMMENT'); end if;
  if v_c.author_id <> p_profile then return jsonb_build_object('ok', false, 'reason', 'NOT_AUTHOR'); end if;
  if not public.profile_is_human(v_c.user_id) then return jsonb_build_object('ok', false, 'reason', 'NOT_HUMAN'); end if;
  if exists (
    select 1 from public.post_comments r
    where r.post_id = v_c.post_id and r.user_id = p_profile and r.parent_id = v_c.id and r.deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'REPLIED');
  end if;

  v_body := lower(coalesce(v_c.body, ''));
  if v_body ~ 'iyiymiş' or v_body ~ 'süper' or v_body ~ 'helal' or v_body ~ 'devam' then
    if random() < 0.7 then return jsonb_build_object('ok', false, 'reason', 'THREAD_END'); end if;
    v_kind := 'REPLY_CLOSE';
  elsif v_body ~ 'kaç soru' or v_body ~ 'kaç doğru' then
    v_kind := 'REPLY_COUNT';
  elsif v_body ~ 'hangi konu' or v_body ~ 'neredesin' or v_body ~ 'ne çalış' then
    v_kind := 'REPLY_TOPIC';
  elsif v_body ~ 'orada' or v_body ~ 'ben de' then
    v_kind := 'REPLY_HERE';
  elsif char_length(trim(v_c.body)) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'COMPLEX');
  else
    return jsonb_build_object('ok', false, 'reason', 'NO_MATCH');
  end if;

  select t.name, s.name into v_topic, v_subject
  from public.virtual_student_profiles vp
  left join public.topics t on t.id = vp.current_topic_id
  left join public.subjects s on s.id = vp.current_subject_id
  where vp.profile_id = p_profile;

  select * into v_picked from public.pick_virtual_social_template(p_profile, v_kind, v_subject, v_topic, null, null);
  if v_picked.body is null then
    v_picked.body := coalesce(nullif(v_topic, ''), 'ders');
  end if;

  insert into public.post_comments (post_id, user_id, body, parent_id)
  values (v_c.post_id, p_profile, v_picked.body, v_c.id)
  returning id into v_id;
  perform public.notify_post_comment_social(v_c.post_id, p_profile, v_id);
  return jsonb_build_object('ok', true, 'comment_id', v_id, 'kind', v_kind);
end;
$eng$;

create or replace function public.schedule_virtual_comment_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_author uuid;
  v_delay int;
begin
  if new.parent_id is not null then
    return new;
  end if;
  if not public.profile_is_human(new.user_id) then
    return new;
  end if;
  select user_id into v_author from public.social_posts where id = new.post_id;
  if v_author is null or not exists (select 1 from public.virtual_student_profiles vp where vp.profile_id = v_author and vp.is_enabled) then
    return new;
  end if;
  if char_length(trim(new.body)) > 80 then
    return new;
  end if;
  v_delay := 4 + floor(random() * 14)::int;
  perform public.enqueue_virtual_social_action(v_author, 'REPLY', 'comment', new.id, now() + make_interval(mins => v_delay));
  return new;
end;
$eng$;

drop trigger if exists trg_schedule_virtual_comment_reply on public.post_comments;
create trigger trg_schedule_virtual_comment_reply
after insert on public.post_comments
for each row execute procedure public.schedule_virtual_comment_reply();

create or replace function public.schedule_virtual_follow_back()
returns trigger
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_delay int;
begin
  if not public.profile_is_human(new.follower_user_id) then
    return new;
  end if;
  if not exists (select 1 from public.virtual_student_profiles vp where vp.profile_id = new.followed_user_id and vp.is_enabled) then
    return new;
  end if;
  if random() < 0.42 then
    return new;
  end if;
  v_delay := 30 + floor(random() * 900)::int;
  perform public.enqueue_virtual_social_action(
    new.followed_user_id, 'FOLLOW', 'user', new.follower_user_id,
    now() + make_interval(mins => v_delay)
  );
  return new;
end;
$eng$;

drop trigger if exists trg_schedule_virtual_follow_back on public.user_follows;
create trigger trg_schedule_virtual_follow_back
after insert on public.user_follows
for each row execute procedure public.schedule_virtual_follow_back();

create or replace function public.virtual_send_study_request(p_profile uuid, p_other uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_subject uuid;
  v_topic uuid;
  v_post uuid;
  v_id uuid;
  v_name text;
  v_tag int;
  v_subject_name text;
  v_topic_name text;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if v_cfg.social_study_request_enabled is false then
    return jsonb_build_object('ok', false, 'reason', 'OFF');
  end if;
  if p_profile is null or p_other is null or p_profile = p_other then
    return jsonb_build_object('ok', false, 'reason', 'INVALID');
  end if;
  if not public.profile_is_human(p_other) then
    return jsonb_build_object('ok', false, 'reason', 'NOT_HUMAN');
  end if;
  if exists (
    select 1 from public.study_invites i
    where i.status = 'pending'
      and ((i.from_user = p_profile and i.to_user = p_other) or (i.from_user = p_other and i.to_user = p_profile))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'PENDING');
  end if;
  if exists (
    select 1 from public.study_invites i
    where i.from_user = p_profile and i.to_user = p_other and i.created_at > now() - interval '20 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'COOLDOWN');
  end if;
  if exists (
    select 1 from public.study_invites i
    join public.virtual_student_profiles vp on vp.profile_id = i.from_user
    where i.to_user = p_other and i.created_at > now() - interval '10 hours'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'USER_COOLDOWN');
  end if;

  v_subject := nullif(p_payload->>'subject_id', '')::uuid;
  v_topic := nullif(p_payload->>'topic_id', '')::uuid;
  v_post := nullif(p_payload->>'post_id', '')::uuid;
  if v_subject is null then
    select current_subject_id, current_topic_id into v_subject, v_topic
    from public.virtual_student_profiles where profile_id = p_profile;
  end if;
  if v_subject is null then return jsonb_build_object('ok', false, 'reason', 'NO_SUBJECT'); end if;

  insert into public.study_invites (from_user, to_user, subject_id, post_id, topic_id)
  values (p_profile, p_other, v_subject, v_post, v_topic)
  returning id into v_id;
  select display_name, display_tag into v_name, v_tag from public.profiles where id = p_profile;
  select name into v_subject_name from public.subjects where id = v_subject;
  if v_topic is not null then select name into v_topic_name from public.topics where id = v_topic; end if;
  perform public.notify_user(p_other, 'study_invite', jsonb_build_object(
    'invite_id', v_id,
    'from_user', p_profile,
    'from_name', coalesce(v_name, 'Öğrenci'),
    'from_tag', v_tag,
    'subject_id', v_subject,
    'subject_name', coalesce(v_subject_name, 'Ders'),
    'topic_name', v_topic_name
  ));
  return jsonb_build_object('ok', true, 'invite_id', v_id);
end;
$eng$;

create or replace function public.virtual_try_study_request(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_human uuid;
  v_subject uuid;
  v_topic uuid;
  v_post uuid;
begin
  if random() < 0.82 then return jsonb_build_object('ok', false, 'reason', 'SKIP_PACE'); end if;
  select vp.current_subject_id, vp.current_topic_id into v_subject, v_topic
  from public.virtual_student_profiles vp where vp.profile_id = p_profile;
  if v_subject is null then return jsonb_build_object('ok', false, 'reason', 'NO_SUBJECT'); end if;

  select p.user_id into v_human
  from public.study_presence p
  where public.profile_is_human(p.user_id)
    and p.heartbeat_at > now() - interval '3 minutes'
    and coalesce(p.status, 'studying') not in ('offline', 'paused')
    and p.subject_id = v_subject
    and (v_topic is null or p.topic_id is not distinct from v_topic or p.topic_id is null)
    and p.user_id <> p_profile
  order by random()
  limit 1;
  if v_human is null then return jsonb_build_object('ok', false, 'reason', 'NO_HUMAN'); end if;

  select sp.id into v_post
  from public.social_posts sp
  where sp.user_id = v_human and sp.deleted_at is null
  order by sp.created_at desc
  limit 1;

  return public.virtual_send_study_request(
    p_profile,
    v_human,
    jsonb_build_object('subject_id', v_subject, 'topic_id', v_topic, 'post_id', v_post)
  );
end;
$eng$;

create or replace function public.execute_virtual_social_action(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v public.virtual_social_actions%rowtype;
  v_res jsonb;
begin
  select * into v from public.virtual_social_actions where id = p_id and status = 'queued' for update skip locked;
  if not found then return jsonb_build_object('ok', false, 'reason', 'GONE'); end if;
  if v.action_type = 'LIKE' then
    if exists (select 1 from public.social_posts where id = v.target_id and deleted_at is null and (expires_at is null or expires_at > now())) then
      insert into public.post_likes (post_id, user_id) values (v.target_id, v.profile_id) on conflict do nothing;
      perform public.notify_grouped_post_like(v.target_id, v.profile_id);
      v_res := jsonb_build_object('ok', true);
    else
      v_res := jsonb_build_object('ok', false, 'reason', 'EXPIRED');
    end if;
  elsif v.action_type = 'COMMENT' then
    v_res := public.virtual_comment_on_post(v.profile_id, v.target_id);
  elsif v.action_type = 'REPLY' then
    v_res := public.virtual_reply_to_comment(v.profile_id, v.target_id);
  elsif v.action_type = 'FOLLOW' then
    if v.target_id is not null then
      v_res := public.virtual_follow_user(v.profile_id, v.target_id);
    else
      v_res := public.virtual_try_social_follow(v.profile_id);
    end if;
  elsif v.action_type = 'UNFOLLOW' then
    v_res := public.virtual_try_social_unfollow(v.profile_id);
  elsif v.action_type = 'STUDY_REQUEST' then
    v_res := public.virtual_send_study_request(v.profile_id, v.target_id, v.payload);
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
$eng$;

create or replace function public.virtual_deterministic_social_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
declare
  v_cfg public.virtual_student_engine_settings%rowtype;
  v_posts int := 0;
  v_likes int := 0;
  v_comments int := 0;
  v_follows int := 0;
  v_unfollows int := 0;
  v_study int := 0;
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

  if coalesce(v_cfg.social_study_request_enabled, true) then
    select vp.profile_id into v_unf
    from public.virtual_student_profiles vp
    where vp.is_enabled and public.virtual_profile_is_active(vp.profile_id)
    order by random() limit 1;
    if v_unf is not null then
      v_res := public.virtual_try_study_request(v_unf);
      if coalesce((v_res->>'ok')::boolean, false) then v_study := v_study + 1; end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'ai', false,
    'posts', v_posts, 'likes', v_likes, 'comments', v_comments,
    'follows', v_follows, 'unfollows', v_unfollows, 'study_requests', v_study,
    'scheduled_ran', v_scheduled, 'presence', v_presence, 'cleanup', v_clean
  );
end;
$eng$;

drop function if exists public.admin_set_virtual_social(boolean, boolean, int, int, int, boolean, boolean, boolean, boolean, boolean, boolean, int, int);

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
  p_image_per_day int default null,
  p_max_likes_post int default null,
  p_max_comments_post int default null,
  p_max_follows_window int default null,
  p_human_share numeric default null,
  p_study_request boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $eng$
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
      social_max_virtual_likes_per_post = coalesce(p_max_likes_post, social_max_virtual_likes_per_post),
      social_max_virtual_comments_per_post = coalesce(p_max_comments_post, social_max_virtual_comments_per_post),
      social_max_virtual_follows_per_user_window = coalesce(p_max_follows_window, social_max_virtual_follows_per_user_window),
      social_human_engagement_share = coalesce(p_human_share, social_human_engagement_share),
      social_study_request_enabled = coalesce(p_study_request, social_study_request_enabled),
      updated_at = now()
  where id = 1;
  return (select to_jsonb(s) from public.virtual_student_engine_settings s where id = 1);
end;
$eng$;

grant execute on function public.admin_set_virtual_social(boolean, boolean, int, int, int, boolean, boolean, boolean, boolean, boolean, boolean, int, int, int, int, int, numeric, boolean) to authenticated;
grant execute on function public.virtual_follow_user(uuid, uuid) to service_role;
grant execute on function public.virtual_reply_to_comment(uuid, uuid) to service_role;
grant execute on function public.virtual_send_study_request(uuid, uuid, jsonb) to service_role;
grant execute on function public.virtual_try_study_request(uuid) to service_role;
grant execute on function public.virtual_deterministic_social_tick() to service_role;
grant execute on function public.execute_virtual_social_action(uuid) to service_role;

notify pgrst, 'reload schema';
