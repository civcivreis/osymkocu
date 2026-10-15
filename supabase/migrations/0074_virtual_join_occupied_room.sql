create or replace function public.virtual_ensure_study_room(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.virtual_student_profiles%rowtype;
  v_subject uuid;
  v_session uuid;
  v_ids uuid[];
  v_open int := 0;
  v_target int := 6;
  v_members int := 0;
  v_topic text;
  v_exam uuid;
  v_canon uuid;
  v_created boolean := false;
  v_kind text := 'study';
  v_own uuid;
  v_own_count int := 0;
begin
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_PROFILE');
  end if;
  v_subject := v_prof.current_subject_id;
  v_exam := v_prof.exam_id;
  if v_subject is null then
    select s.id, s.exam_id into v_subject, v_exam from public.subjects s order by random() limit 1;
  end if;
  select coalesce(target_virtual_rooms, target_active_rooms, 6) into v_target
  from public.virtual_student_engine_settings where id = 1;

  select s.id into v_session
  from public.study_sessions s
  where s.status in ('waiting', 'countdown', 'active')
    and s.is_private is not true
    and public.is_virtual_profile(s.host_id)
    and exists (
      select 1 from public.study_session_members m
      where m.session_id = s.id and m.user_id <> p_profile
    )
    and (
      select count(*) from public.study_session_members m where m.session_id = s.id
    ) < coalesce(s.capacity, 5)
  order by
    (s.subject_id is not distinct from v_subject) desc,
    (s.exam_id is not distinct from v_exam) desc,
    s.created_at desc
  limit 1;

  if v_session is null then
    select s.id, (
      select count(*) from public.study_session_members m where m.session_id = s.id
    ) into v_own, v_own_count
    from public.study_session_members sm
    join public.study_sessions s on s.id = sm.session_id
    where sm.user_id = p_profile
      and s.status in ('waiting', 'countdown', 'active')
    order by s.created_at desc
    limit 1;
    v_session := v_own;
  end if;

  if v_session is null then
    select s.id into v_session
    from public.study_sessions s
    where s.status in ('waiting', 'countdown', 'active')
      and s.is_private is not true
      and (v_subject is null or s.subject_id = v_subject)
      and (
        select count(*) from public.study_session_members m where m.session_id = s.id
      ) < coalesce(s.capacity, 5)
    order by s.created_at desc
    limit 1;
  end if;

  if v_session is null then
    select count(*)::int into v_open
    from public.study_sessions s
    where s.status in ('waiting', 'countdown', 'active')
      and public.is_virtual_profile(s.host_id);
    if v_open >= v_target then
      return jsonb_build_object('ok', false, 'reason', 'ROOM_DENSITY_MET', 'open', v_open, 'target', v_target);
    end if;

    select array_agg(id) into v_ids
    from (
      select q.id from public.questions q
      where q.is_published and (v_subject is null or q.subject_id = v_subject)
      order by random() limit 10
    ) q;
    v_ids := coalesce(v_ids, '{}');

    select ml.canonical_topic_id into v_canon
    from public.memory_lessons ml
    where ml.status = 'published'
    order by ml.published_at desc nulls last
    limit 1;

    insert into public.study_sessions (
      subject_id, question_ids, status, mode, host_id, capacity, topic_id, title,
      chat_enabled, is_private, exam_id, canonical_topic_id
    )
    values (
      v_subject, v_ids, 'waiting', v_kind, p_profile, 5, v_prof.current_topic_id,
      'Sanal çalışma odası', true, false, v_exam, v_canon
    )
    returning id into v_session;
    v_created := true;
  end if;

  insert into public.study_session_members (session_id, user_id)
  values (v_session, p_profile)
  on conflict do nothing;
  select count(*) into v_members from public.study_session_members where session_id = v_session;
  perform public.set_virtual_presence(p_profile, 'in_room', v_subject, v_prof.current_topic_id, v_session, 25);

  select t.name into v_topic from public.topics t where t.id = v_prof.current_topic_id;
  if not exists (
    select 1 from public.study_session_messages m
    where m.session_id = v_session and m.sender_id = p_profile
      and m.created_at > now() - interval '3 minutes'
  ) then
    insert into public.study_session_messages (session_id, sender_id, body)
    values (
      v_session,
      p_profile,
      case
        when v_created then coalesce(v_topic, 'Konu') || ' için oda açtım. Bağlama bağlı cümleleri eleyerek gidelim.'
        when v_members > 1 then coalesce(v_topic, 'Bu konu') || ' odasındayım. Girişte bağlaç/gönderme tarayıp bağlamı doğrulayalım.'
        else coalesce(v_topic, 'Bu konu') || 'da devam: son adayı paragraf anlamına karşı kontrol et.'
      end
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'session_id', v_session,
    'members', v_members,
    'subject_id', v_subject,
    'exam_id', v_exam
  );
end;
$$;
