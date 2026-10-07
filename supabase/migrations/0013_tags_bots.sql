-- Name tags, bot profiles, friend refuse.
-- Run after 0012.

alter table public.profiles
  add column if not exists display_tag int,
  add column if not exists bio text;

create or replace function public.next_display_tag(p_name text)
returns int
language plpgsql
as $$
declare
  v_tag int;
  v_name text := lower(trim(coalesce(p_name, 'öğrenci')));
begin
  loop
    v_tag := 1000 + floor(random() * 9000)::int;
    exit when not exists (
      select 1 from public.profiles
      where lower(display_name) = v_name and display_tag = v_tag
    );
  end loop;
  return v_tag;
end;
$$;

create or replace function public.ensure_display_tag()
returns trigger
language plpgsql
as $$
begin
  if new.display_name is null or length(trim(new.display_name)) = 0 then
    new.display_name := 'Öğrenci';
  end if;
  if new.display_tag is null or new.display_tag < 1000
     or (tg_op = 'UPDATE' and new.display_name is distinct from old.display_name) then
    new.display_tag := public.next_display_tag(new.display_name);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_display_tag on public.profiles;
create trigger profiles_display_tag
before insert or update of display_name, display_tag on public.profiles
for each row execute procedure public.ensure_display_tag();

update public.profiles
set display_tag = public.next_display_tag(display_name)
where display_tag is null or display_tag < 1000;

create unique index if not exists profiles_name_tag_uidx
  on public.profiles (lower(display_name), display_tag);

update public.profiles set bio = 'TYT matematik çalışıyorum' where id = 'a1111111-1111-4111-8111-111111111111' and (bio is null or bio = '');
update public.profiles set bio = 'Tarih tekrarındayım' where id = 'a2222222-2222-4222-8222-222222222222' and (bio is null or bio = '');
update public.profiles set bio = 'Coğrafya haritası açık' where id = 'a3333333-3333-4333-8333-333333333333' and (bio is null or bio = '');
update public.profiles set bio = 'Paragraf seti çözüyorum' where id = 'a4444444-4444-4444-8444-444444444444' and (bio is null or bio = '');
update public.profiles set bio = 'AYT fiziğe bakıyorum' where id = 'a5555555-5555-4555-8555-555555555555' and (bio is null or bio = '');
update public.profiles set bio = 'KPSS vatandaşlık' where id = 'a6666666-6666-4666-8666-666666666666' and (bio is null or bio = '');
update public.profiles set bio = 'Kimya formülleri' where id = 'a7777777-7777-4777-8777-777777777777' and (bio is null or bio = '');
update public.profiles set bio = 'Geometri çiziyorum' where id = 'a8888888-8888-4888-8888-888888888888' and (bio is null or bio = '');
update public.profiles set bio = 'Edebiyat notları' where id = 'a9999999-9999-4999-8999-999999999999' and (bio is null or bio = '');
update public.profiles set bio = 'Deneme analizi' where id = 'abbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and (bio is null or bio = '');

create or replace function public.request_friend(p_other uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.friendships%rowtype;
begin
  if v_user is null or p_other is null or v_user = p_other then
    raise exception 'INVALID_FRIEND';
  end if;
  if exists (select 1 from public.profiles where id = p_other and is_bot) then
    raise exception 'BOT_NO_FRIEND';
  end if;
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_user and blocked_id = p_other)
       or (blocker_id = p_other and blocked_id = v_user)
  ) then
    raise exception 'BLOCKED';
  end if;

  select * into v_existing
  from public.friendships
  where (requester_id = v_user and addressee_id = p_other)
     or (requester_id = p_other and addressee_id = v_user);

  if found then
    if v_existing.status = 'accepted' then
      return 'accepted';
    end if;
    if v_existing.status = 'blocked' then
      raise exception 'BLOCKED';
    end if;
    if v_existing.addressee_id = v_user then
      update public.friendships set status = 'accepted' where id = v_existing.id;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (v_user, p_other, 'pending');
  return 'pending';
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
        p.session_id,
        p.capacity,
        p.duration_minutes,
        p.expires_at,
        a.display_name,
        a.display_tag,
        a.current_xp,
        (select count(*) from public.post_likes l where l.post_id = p.id)::int as like_count,
        (select count(*) from public.post_comments c where c.post_id = p.id)::int as comment_count,
        exists (select 1 from public.post_likes l where l.post_id = p.id and l.user_id = v_user) as liked_by_me
      from public.social_posts p
      join public.profiles a on a.id = p.user_id
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

create or replace function public.list_human_profiles(p_exam uuid, p_search text)
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
      select pr.id, pr.display_name, pr.display_tag, pr.current_xp, pr.exam_id, pr.exam_year, pr.target_score, pr.bio
      from public.profiles pr
      where pr.id <> v_user
        and not pr.is_bot
        and (
          (p_search is not null and length(trim(p_search)) >= 2 and pr.display_name ilike '%' || trim(p_search) || '%')
          or ((p_search is null or length(trim(p_search)) < 2) and (p_exam is null or pr.exam_id = p_exam))
        )
      order by pr.current_xp desc
      limit 20
    ) x
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.request_friend(uuid) to authenticated;
grant execute on function public.get_social_feed() to authenticated;
grant execute on function public.list_human_profiles(uuid, text) to authenticated;

notify pgrst, 'reload schema';
