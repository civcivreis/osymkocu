-- Follow graph, profile card, privacy-ready status. Paste after 0020.

alter table public.profiles
  add column if not exists is_private boolean not null default false;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'study_invite', 'study_accepted', 'study_ended', 'study_offer',
    'race_invite', 'race_accepted', 'exam_lobby', 'exam_started',
    'room_kicked', 'follow'
  ));

create table if not exists public.user_follows (
  follower_user_id uuid not null references public.profiles(id) on delete cascade,
  followed_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'pending')),
  created_at timestamptz not null default now(),
  primary key (follower_user_id, followed_user_id),
  check (follower_user_id <> followed_user_id)
);

create index if not exists user_follows_followed_idx on public.user_follows (followed_user_id, status);
create index if not exists user_follows_follower_idx on public.user_follows (follower_user_id, status);

alter table public.user_follows enable row level security;
drop policy if exists user_follows_read on public.user_follows;
create policy user_follows_read on public.user_follows
  for select to authenticated
  using (
    status = 'active'
    or follower_user_id = auth.uid()
    or followed_user_id = auth.uid()
  );

create or replace function public.follow_user(p_other uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_private boolean;
  v_status text;
  v_existing text;
  v_name text;
  v_tag int;
begin
  if v_user is null or p_other is null then raise exception 'UNAUTHORIZED'; end if;
  if v_user = p_other then raise exception 'SELF_FOLLOW'; end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_user and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = v_user)
  ) then
    raise exception 'BLOCKED';
  end if;
  if not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'NOT_FOUND';
  end if;

  select status into v_existing
  from public.user_follows
  where follower_user_id = v_user and followed_user_id = p_other;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce(is_private, false) into v_private from public.profiles where id = p_other;
  v_status := case when v_private then 'pending' else 'active' end;

  insert into public.user_follows (follower_user_id, followed_user_id, status)
  values (v_user, p_other, v_status);

  if v_status = 'active' then
    select display_name, display_tag into v_name, v_tag from public.profiles where id = v_user;
    insert into public.notifications (user_id, kind, payload)
    values (
      p_other,
      'follow',
      jsonb_build_object('from_user', v_user, 'from_name', v_name, 'from_tag', v_tag)
    );
  end if;
  return v_status;
end;
$$;

create or replace function public.unfollow_user(p_other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  delete from public.user_follows
  where follower_user_id = auth.uid() and followed_user_id = p_other;
end;
$$;

create or replace function public.block_user(p_other uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_other is null or v_user = p_other then
    raise exception 'INVALID_BLOCK';
  end if;
  insert into public.user_blocks (blocker_id, blocked_id)
  values (v_user, p_other)
  on conflict do nothing;
  delete from public.friendships
  where (requester_id = v_user and addressee_id = p_other)
     or (requester_id = p_other and addressee_id = v_user);
  delete from public.user_follows
  where (follower_user_id = v_user and followed_user_id = p_other)
     or (follower_user_id = p_other and followed_user_id = v_user);
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
      where s.user_id = p.id and s.expires_at > now()
    ),
    'week_questions', (
      select count(*)::int from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
    ),
    'week_ms', (
      select coalesce(sum(a.time_spent_ms), 0)::bigint from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
    ),
    'week_active', (
      select count(distinct (timezone('Europe/Istanbul', a.created_at))::date)::int
      from public.question_attempts a
      where a.user_id = p.id and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
    ),
    'week_correct', (
      select count(*)::int from public.question_attempts a
      where a.user_id = p.id and a.is_correct
        and (timezone('Europe/Istanbul', a.created_at))::date >= v_from
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

create or replace function public.list_follows(p_user uuid, p_dir text, p_search text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_me uuid := auth.uid();
  v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if v_me is null then raise exception 'UNAUTHORIZED'; end if;
  if p_dir not in ('followers', 'following') then raise exception 'BAD_TYPE'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x))
    from (
      select
        pr.id,
        pr.display_name,
        pr.display_tag,
        e.name as exam_name,
        (
          select sub.name
          from public.question_attempts a
          join public.questions q on q.id = a.question_id
          join public.subjects sub on sub.id = q.subject_id
          where a.user_id = pr.id and a.created_at > now() - interval '30 days'
          group by sub.name
          order by count(*) desc
          limit 1
        ) as focus,
        exists (
          select 1 from public.user_follows mine
          where mine.follower_user_id = v_me
            and mine.followed_user_id = pr.id
            and mine.status = 'active'
        ) as i_follow,
        exists (
          select 1 from public.user_follows mine
          where mine.follower_user_id = v_me
            and mine.followed_user_id = pr.id
            and mine.status = 'pending'
        ) as follow_pending
      from public.user_follows f
      join public.profiles pr on pr.id = case
        when p_dir = 'followers' then f.follower_user_id
        else f.followed_user_id
      end
      left join public.exams e on e.id = pr.exam_id
      where f.status = 'active'
        and (
          (p_dir = 'followers' and f.followed_user_id = p_user)
          or (p_dir = 'following' and f.follower_user_id = p_user)
        )
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = v_me and b.blocked_id = pr.id)
             or (b.blocker_id = pr.id and b.blocked_id = v_me)
        )
        and (
          v_q is null
          or pr.display_name ilike '%' || v_q || '%'
          or (pr.display_tag::text = v_q)
        )
      order by f.created_at desc
      limit 80
    ) x
  ), '[]'::jsonb);
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.user_follows;
exception when duplicate_object then null;
end $$;

revoke all on function public.follow_user(uuid) from public;
revoke all on function public.unfollow_user(uuid) from public;
revoke all on function public.get_profile_card(uuid) from public;
revoke all on function public.list_follows(uuid, text, text) from public;
revoke all on function public.block_user(uuid) from public;
grant execute on function public.follow_user(uuid) to authenticated;
grant execute on function public.unfollow_user(uuid) to authenticated;
grant execute on function public.get_profile_card(uuid) to authenticated;
grant execute on function public.list_follows(uuid, text, text) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;

notify pgrst, 'reload schema';
