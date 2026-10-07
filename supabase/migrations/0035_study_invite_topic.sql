-- Optional topic on manual study request. Paste after 0034.

drop function if exists public.request_study(uuid, uuid, uuid);
create or replace function public.request_study(
  p_other uuid,
  p_subject_id uuid,
  p_post_id uuid default null,
  p_topic_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text;
  v_tag int;
  v_subject text;
  v_topic text;
  v_id uuid;
begin
  if v_user is null or p_other is null or v_user = p_other then
    raise exception 'INVALID_STUDY';
  end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_user and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = v_user)
  ) then
    raise exception 'BLOCKED';
  end if;
  if not exists (select 1 from public.subjects where id = p_subject_id) then
    raise exception 'SUBJECT_NOT_FOUND';
  end if;

  update public.study_invites
  set status = 'expired'
  where status = 'pending' and expires_at < now()
    and ((from_user = v_user and to_user = p_other) or (from_user = p_other and to_user = v_user));

  if exists (
    select 1 from public.study_invites
    where status = 'pending'
      and ((from_user = v_user and to_user = p_other) or (from_user = p_other and to_user = v_user))
  ) then
    raise exception 'PENDING_EXISTS';
  end if;

  insert into public.study_invites (from_user, to_user, subject_id, post_id, topic_id)
  values (v_user, p_other, p_subject_id, p_post_id, p_topic_id)
  returning id into v_id;

  select display_name, display_tag into v_name, v_tag from public.profiles where id = v_user;
  select name into v_subject from public.subjects where id = p_subject_id;
  if p_topic_id is not null then
    select name into v_topic from public.topics where id = p_topic_id;
  end if;

  perform public.notify_user(p_other, 'study_invite', jsonb_build_object(
    'invite_id', v_id,
    'from_user', v_user,
    'from_name', coalesce(v_name, 'Öğrenci'),
    'from_tag', v_tag,
    'subject_id', p_subject_id,
    'subject_name', coalesce(v_subject, 'Ders'),
    'topic_name', v_topic
  ));

  return v_id;
end;
$$;

grant execute on function public.request_study(uuid, uuid, uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
