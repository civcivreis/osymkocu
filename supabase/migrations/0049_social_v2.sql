-- Phase 3A: social hub discovery + weekly XP leaderboard. Reuses xp_transactions. No fake users.

alter table public.study_presence
  add column if not exists canonical_topic_id uuid references public.canonical_topics(id) on delete set null,
  add column if not exists learning_objective_id uuid references public.canonical_topic_learning_objectives(id) on delete set null;

alter table public.social_posts
  add column if not exists topic_id uuid references public.topics(id) on delete set null,
  add column if not exists canonical_topic_id uuid references public.canonical_topics(id) on delete set null;

create index if not exists study_presence_topic_live_idx
  on public.study_presence (topic_id, heartbeat_at)
  where topic_id is not null;

create index if not exists xp_transactions_created_idx
  on public.xp_transactions (created_at);

create or replace function public.istanbul_week_start()
returns timestamptz
language sql
stable
as $$
  select (date_trunc('week', timezone('Europe/Istanbul', now())) at time zone 'Europe/Istanbul');
$$;

create or replace function public.get_user_xp_summary(p_user uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_user uuid := coalesce(p_user, v_me);
  v_total int := 0;
  v_week int := 0;
  v_global int := 0;
  v_weekly_rank int := 0;
  v_humans int := 0;
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  if v_user is distinct from v_me and not public.is_admin() then
    -- public summary only for the requested profile; ranks stay public
    null;
  end if;

  select coalesce(current_xp, 0) into v_total from public.profiles where id = v_user and coalesce(is_bot, false) = false;
  if not found then
    return jsonb_build_object('user_id', v_user, 'total_xp', 0, 'weekly_xp', 0, 'level', 1, 'global_rank', null, 'weekly_rank', null);
  end if;

  select coalesce(sum(amount), 0)::int into v_week
  from public.xp_transactions
  where user_id = v_user and created_at >= public.istanbul_week_start();

  select count(*)::int into v_humans from public.profiles where coalesce(is_bot, false) = false;
  select 1 + count(*)::int into v_global
  from public.profiles p
  where coalesce(p.is_bot, false) = false and p.current_xp > v_total;

  select 1 + count(*)::int into v_weekly_rank
  from (
    select t.user_id, sum(t.amount) as xp
    from public.xp_transactions t
    join public.profiles p on p.id = t.user_id
    where t.created_at >= public.istanbul_week_start()
      and coalesce(p.is_bot, false) = false
    group by t.user_id
  ) w
  where w.xp > v_week;

  if v_week = 0 then
    v_weekly_rank := null;
  end if;

  return jsonb_build_object(
    'user_id', v_user,
    'total_xp', v_total,
    'weekly_xp', v_week,
    'level', public.level_from_xp(v_total),
    'global_rank', v_global,
    'weekly_rank', v_weekly_rank,
    'humans', v_humans
  );
end;
$$;

create or replace function public.get_weekly_xp_leaderboard(p_limit int default 20, p_exam_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.rank)
    from (
      select
        row_number() over (order by w.xp desc, p.display_name asc)::int as rank,
        p.id as user_id,
        p.display_name,
        p.display_tag,
        p.avatar_url,
        p.current_xp as total_xp,
        public.level_from_xp(p.current_xp) as level,
        w.xp as weekly_xp,
        e.name as exam_name
      from (
        select t.user_id, sum(t.amount)::int as xp
        from public.xp_transactions t
        join public.profiles pr on pr.id = t.user_id
        where t.created_at >= public.istanbul_week_start()
          and coalesce(pr.is_bot, false) = false
        group by t.user_id
      ) w
      join public.profiles p on p.id = w.user_id
      left join public.exams e on e.id = p.exam_id
      where (p_exam_id is null or p.exam_id = p_exam_id)
      order by w.xp desc, p.display_name asc
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_global_xp_leaderboard(p_limit int default 20, p_exam_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.rank)
    from (
      select
        row_number() over (order by p.current_xp desc, p.display_name asc)::int as rank,
        p.id as user_id,
        p.display_name,
        p.display_tag,
        p.avatar_url,
        p.current_xp as total_xp,
        public.level_from_xp(p.current_xp) as level,
        e.name as exam_name
      from public.profiles p
      left join public.exams e on e.id = p.exam_id
      where coalesce(p.is_bot, false) = false
        and (p_exam_id is null or p.exam_id = p_exam_id)
      order by p.current_xp desc, p.display_name asc
      limit v_limit
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_weekly_xp_rank(p_user uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_user_xp_summary(p_user);
$$;

create or replace function public.get_global_xp_rank(p_user uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.get_user_xp_summary(p_user);
$$;

create or replace function public.get_active_study_topics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stale interval := interval '45 seconds';
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.people desc)
    from (
      select
        coalesce(p.canonical_topic_id::text, p.topic_id::text) as id,
        p.topic_id,
        p.canonical_topic_id,
        coalesce(ct.name, t.name, sub.name, 'Konu') as name,
        sub.name as subject_name,
        count(*)::int as people
      from public.study_presence p
      join public.profiles pr on pr.id = p.user_id
      left join public.topics t on t.id = p.topic_id
      left join public.canonical_topics ct on ct.id = p.canonical_topic_id
      left join public.subjects sub on sub.id = p.subject_id
      where p.heartbeat_at > now() - v_stale
        and coalesce(p.is_available_for_match, true) = true
        and coalesce(pr.is_bot, false) = false
        and (p.topic_id is not null or p.canonical_topic_id is not null or p.subject_id is not null)
      group by 1, 2, 3, 4, 5
      having count(*) > 0
      limit 12
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_recommended_study_partners(
  p_topic_id uuid default null,
  p_subject_id uuid default null,
  p_canonical_topic_id uuid default null,
  p_learning_objective_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_exam uuid;
  v_stale interval := interval '45 seconds';
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  select exam_id into v_exam from public.profiles where id = v_me;

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.score desc, x.display_name)
    from (
      select
        pr.id as user_id,
        pr.display_name,
        pr.display_tag,
        pr.avatar_url,
        e.name as exam_name,
        sub.name as subject_name,
        coalesce(ct.name, t.name) as topic_name,
        p.subject_id,
        p.topic_id,
        p.canonical_topic_id,
        case
          when p.canonical_topic_id is not null and p.canonical_topic_id = p_canonical_topic_id then 'Seninle aynı konuyu çalışıyor'
          when p.topic_id is not null and p.topic_id = p_topic_id then 'Seninle aynı konuyu çalışıyor'
          when p.learning_objective_id is not null and p.learning_objective_id = p_learning_objective_id then 'Aynı kazanım üzerinde'
          when p.subject_id is not null and p.subject_id = p_subject_id then 'Aynı dersi çalışıyor'
          when pr.exam_id is not null and pr.exam_id = v_exam then 'Aynı sınava hazırlanıyor'
          else 'Şu anda aktif'
        end as reason,
        (
          case when p.canonical_topic_id is not null and p.canonical_topic_id = p_canonical_topic_id then 100 else 0 end
          + case when p.topic_id is not null and p.topic_id = p_topic_id then 90 else 0 end
          + case when p.learning_objective_id is not null and p.learning_objective_id = p_learning_objective_id then 70 else 0 end
          + case when p.subject_id is not null and p.subject_id = p_subject_id then 40 else 0 end
          + case when pr.exam_id is not null and pr.exam_id = v_exam then 20 else 0 end
          + 10
        )::int as score
      from public.study_presence p
      join public.profiles pr on pr.id = p.user_id
      left join public.exams e on e.id = pr.exam_id
      left join public.subjects sub on sub.id = p.subject_id
      left join public.topics t on t.id = p.topic_id
      left join public.canonical_topics ct on ct.id = p.canonical_topic_id
      where p.user_id <> v_me
        and p.heartbeat_at > now() - v_stale
        and coalesce(p.is_available_for_match, true) = true
        and coalesce(pr.is_bot, false) = false
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = v_me and b.blocked_id = pr.id)
             or (b.blocker_id = pr.id and b.blocked_id = v_me)
        )
      order by 12 desc, pr.display_name
      limit 8
    ) x
  ), '[]'::jsonb);
end;
$$;

drop function if exists public.publish_status(text, uuid, int, text, text);
create function public.publish_status(
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
  insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at, goal_label, topic_id, canonical_topic_id)
  values (
    v_user,
    trim(p_body),
    v_kind,
    p_subject_id,
    v_mins,
    now() + make_interval(mins => v_mins),
    nullif(left(trim(coalesce(p_goal, '')), 32), ''),
    p_topic_id,
    p_canonical_topic_id
  )
  returning id into v_id;
  return v_id;
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

revoke all on function public.istanbul_week_start() from public;
revoke all on function public.get_user_xp_summary(uuid) from public;
revoke all on function public.get_weekly_xp_leaderboard(int, uuid) from public;
revoke all on function public.get_global_xp_leaderboard(int, uuid) from public;
revoke all on function public.get_weekly_xp_rank(uuid) from public;
revoke all on function public.get_global_xp_rank(uuid) from public;
revoke all on function public.get_active_study_topics() from public;
revoke all on function public.get_recommended_study_partners(uuid, uuid, uuid, uuid) from public;
revoke all on function public.publish_status(text, uuid, int, text, text, uuid, uuid) from public;
revoke all on function public.get_social_feed() from public;

grant execute on function public.istanbul_week_start() to authenticated;
grant execute on function public.get_user_xp_summary(uuid) to authenticated;
grant execute on function public.get_weekly_xp_leaderboard(int, uuid) to authenticated;
grant execute on function public.get_global_xp_leaderboard(int, uuid) to authenticated;
grant execute on function public.get_weekly_xp_rank(uuid) to authenticated;
grant execute on function public.get_global_xp_rank(uuid) to authenticated;
grant execute on function public.get_active_study_topics() to authenticated;
grant execute on function public.get_recommended_study_partners(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.publish_status(text, uuid, int, text, text, uuid, uuid) to authenticated;
grant execute on function public.get_social_feed() to authenticated;
