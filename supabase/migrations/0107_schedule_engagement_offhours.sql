-- Queue delayed engagement even if virtual profiles are currently off-hours.

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
