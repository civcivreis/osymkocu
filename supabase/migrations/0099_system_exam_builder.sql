-- System exam builder, monitor, result release. Additive.

alter table public.system_exams
  add column if not exists exam_catalog_id uuid references public.exam_catalog(id) on delete set null,
  add column if not exists result_release_mode text not null default 'immediate',
  add column if not exists result_release_at timestamptz,
  add column if not exists results_released boolean not null default false,
  add column if not exists question_order_mode text not null default 'grouped',
  add column if not exists allow_early_entry boolean not null default false,
  add column if not exists extra_minutes int not null default 0,
  add column if not exists participation_mode text not null default 'open',
  add column if not exists distribution jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'system_exams_release_mode_check') then
    alter table public.system_exams
      add constraint system_exams_release_mode_check
      check (result_release_mode in ('immediate', 'scheduled', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'system_exams_order_mode_check') then
    alter table public.system_exams
      add constraint system_exams_order_mode_check
      check (question_order_mode in ('manual', 'grouped', 'random_per_user'));
  end if;
end $$;

create or replace function public.system_exam_results_visible(p_exam public.system_exams)
returns boolean
language sql
stable
as $$
  select case p_exam.result_release_mode
    when 'immediate' then now() >= p_exam.end_at or p_exam.results_released
    when 'scheduled' then p_exam.result_release_at is not null and now() >= p_exam.result_release_at
    else p_exam.results_released
  end;
$$;

create or replace function public.system_exam_remaining_seconds(p_attempt public.system_exam_attempts, p_exam public.system_exams)
returns int
language sql
stable
as $$
  select greatest(
    0,
    least(
      ((p_exam.duration_minutes + coalesce(p_exam.extra_minutes, 0)) * 60)
        - floor(extract(epoch from (now() - p_attempt.started_at)))::int,
      floor(extract(epoch from (p_exam.end_at - now())))::int
    )
  );
$$;

create or replace function public.admin_list_exams()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.start_at desc)
    from (
      select
        e.id, e.title, e.exam_type, e.description, e.start_at, e.end_at,
        e.duration_minutes, e.question_count, e.exam_catalog_id,
        e.result_release_mode, e.result_release_at, e.results_released,
        e.question_order_mode, e.allow_early_entry, e.extra_minutes,
        e.participation_mode, e.distribution,
        public.system_exam_derived_status(e) as status,
        e.status as stored_status,
        cat.name as exam_catalog_name,
        cat.code as exam_catalog_code,
        (select count(*)::int from public.system_exam_attempts a where a.system_exam_id = e.id) as participant_count,
        (select count(*)::int from public.system_exam_attempts a where a.system_exam_id = e.id and a.status = 'in_progress') as live_count,
        (select count(*)::int from public.system_exam_attempts a where a.system_exam_id = e.id and a.status in ('submitted', 'expired')) as finished_count,
        (select round(avg(a.score)::numeric, 1) from public.system_exam_attempts a
          where a.system_exam_id = e.id and a.status in ('submitted', 'expired') and not public.is_virtual_profile(a.user_id)) as avg_net
      from public.system_exams e
      left join public.exam_catalog cat on cat.id = e.exam_catalog_id
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_upsert_system_exam(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.require_admin();
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_status text := coalesce(p_payload->>'status', 'draft');
  v_start timestamptz := (p_payload->>'start_at')::timestamptz;
  v_duration int := coalesce((p_payload->>'duration_minutes')::int, 165);
  v_end timestamptz;
  v_type text := coalesce(p_payload->>'exam_type', 'kpss');
  v_current text;
begin
  if v_type not in ('tyt', 'ayt', 'kpss') then v_type := 'kpss'; end if;
  if v_duration < 10 or v_duration > 300 then raise exception 'INVALID_INPUT'; end if;
  if v_start is null then raise exception 'INVALID_INPUT'; end if;
  v_end := v_start + make_interval(mins => v_duration + coalesce((p_payload->>'extra_minutes')::int, 0));
  if v_status not in ('draft', 'scheduled', 'cancelled') then
    v_status := 'draft';
  end if;
  if v_id is not null then
    select status into v_current from public.system_exams where id = v_id;
    if v_current in ('finished') and v_status not in ('finished', 'cancelled') then
      raise exception 'INVALID_TRANSITION';
    end if;
    if v_current = 'live' and v_status = 'draft' then
      raise exception 'INVALID_TRANSITION';
    end if;
  end if;
  if v_status = 'scheduled' and not public.istanbul_exam_slot_ok(v_start) then
    raise exception 'EXAM_HOUR';
  end if;
  if v_id is null then
    insert into public.system_exams (
      title, exam_type, description, start_at, end_at, duration_minutes, status, created_by, published_at,
      exam_catalog_id, result_release_mode, result_release_at, question_order_mode, allow_early_entry,
      participation_mode, distribution
    ) values (
      left(trim(p_payload->>'title'), 120),
      v_type,
      nullif(trim(p_payload->>'description'), ''),
      v_start, v_end, v_duration, v_status, v_admin,
      case when v_status = 'scheduled' then now() else null end,
      nullif(p_payload->>'exam_catalog_id', '')::uuid,
      coalesce(p_payload->>'result_release_mode', 'immediate'),
      nullif(p_payload->>'result_release_at', '')::timestamptz,
      coalesce(p_payload->>'question_order_mode', 'grouped'),
      coalesce((p_payload->>'allow_early_entry')::boolean, false),
      coalesce(p_payload->>'participation_mode', 'open'),
      coalesce(p_payload->'distribution', '[]'::jsonb)
    ) returning id into v_id;
    perform public.write_admin_audit('exam_create', 'system_exam', v_id::text, p_payload);
  else
    update public.system_exams
    set title = left(trim(p_payload->>'title'), 120),
        exam_type = v_type,
        description = nullif(trim(p_payload->>'description'), ''),
        start_at = case when status in ('live', 'finished') then start_at else v_start end,
        end_at = case when status = 'finished' then end_at else v_end end,
        duration_minutes = case when status = 'finished' then duration_minutes else v_duration end,
        status = case
          when status = 'finished' and v_status <> 'cancelled' then status
          when status = 'live' and v_status = 'draft' then status
          else v_status
        end,
        exam_catalog_id = coalesce(nullif(p_payload->>'exam_catalog_id', '')::uuid, exam_catalog_id),
        result_release_mode = coalesce(p_payload->>'result_release_mode', result_release_mode),
        result_release_at = coalesce(nullif(p_payload->>'result_release_at', '')::timestamptz, result_release_at),
        question_order_mode = coalesce(p_payload->>'question_order_mode', question_order_mode),
        allow_early_entry = coalesce((p_payload->>'allow_early_entry')::boolean, allow_early_entry),
        participation_mode = coalesce(p_payload->>'participation_mode', participation_mode),
        distribution = coalesce(p_payload->'distribution', distribution),
        published_at = case when v_status = 'scheduled' then coalesce(published_at, now()) else published_at end,
        updated_at = now()
    where id = v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform public.write_admin_audit('exam_update', 'system_exam', v_id::text, p_payload);
  end if;
  if p_payload ? 'question_ids' then
    perform public.admin_set_exam_questions(
      v_id,
      array(select jsonb_array_elements_text(p_payload->'question_ids')::uuid)
    );
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_exam_question_pool(
  p_exam_catalog_id uuid,
  p_search text default '',
  p_subject text default null,
  p_topic text default null,
  p_difficulty text default null,
  p_limit int default 80
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(row_to_json(x))
    from (
      select
        q.id, q.stem, q.difficulty, q.question_status, q.source_type, q.source,
        q.explanation is not null and length(trim(q.explanation)) > 0 as has_explanation,
        coalesce(sc.name, sub.name, 'Ders') as subject,
        coalesce(tc.name, t.name, 'Konu') as topic
      from public.questions q
      left join public.question_exam_map m on m.question_id = q.id
      left join public.canonical_topics ct on ct.id = q.canonical_topic_id
      left join public.canonical_units cu on cu.id = ct.canonical_unit_id
      left join public.canonical_subjects cs on cs.id = cu.canonical_subject_id
      left join public.topic_catalog tc on tc.canonical_topic_id = ct.id
      left join public.unit_catalog uc on uc.id = tc.unit_id
      left join public.subject_catalog sc on sc.id = uc.subject_id
      left join public.subjects sub on sub.id = q.subject_id
      left join public.topics t on t.id = q.topic_id
      where q.question_status = 'published'
        and q.is_published = true
        and (
          p_exam_catalog_id is null
          or q.exam_catalog_id = p_exam_catalog_id
          or m.exam_catalog_id = p_exam_catalog_id
        )
        and (coalesce(p_search, '') = '' or q.stem ilike '%' || p_search || '%')
        and (p_subject is null or p_subject = '' or coalesce(sc.name, sub.name, '') ilike p_subject)
        and (p_topic is null or p_topic = '' or coalesce(tc.name, t.name, '') ilike p_topic)
        and (p_difficulty is null or p_difficulty = '' or q.difficulty::text = p_difficulty)
      order by q.updated_at desc nulls last
      limit least(coalesce(p_limit, 80), 200)
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_auto_pick_exam_questions(p_exam_catalog_id uuid, p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_topic jsonb;
  v_need int;
  v_have int;
  v_ids uuid[] := '{}';
  v_missing jsonb := '[]'::jsonb;
  v_pick uuid[];
  v_subject text;
  v_topic_name text;
  v_diff text;
begin
  perform public.require_admin();
  for v_item in select value from jsonb_array_elements(coalesce(p_plan, '[]'::jsonb))
  loop
    v_subject := v_item->>'subject';
    if coalesce(v_item->'topics', '[]'::jsonb) <> '[]'::jsonb then
      for v_topic in select value from jsonb_array_elements(v_item->'topics')
      loop
        v_topic_name := v_topic->>'name';
        v_need := coalesce((v_topic->>'count')::int, 0);
        if v_need <= 0 then continue; end if;
        select coalesce(array_agg(q.id), '{}') into v_pick
        from (
          select q.id
          from public.questions q
          left join public.question_exam_map m on m.question_id = q.id
          left join public.canonical_topics ct on ct.id = q.canonical_topic_id
          left join public.topic_catalog tc on tc.canonical_topic_id = ct.id
          left join public.unit_catalog uc on uc.id = tc.unit_id
          left join public.subject_catalog sc on sc.id = uc.subject_id
          left join public.subjects sub on sub.id = q.subject_id
          left join public.topics t on t.id = q.topic_id
          where q.question_status = 'published' and q.is_published
            and (p_exam_catalog_id is null or q.exam_catalog_id = p_exam_catalog_id or m.exam_catalog_id = p_exam_catalog_id)
            and coalesce(sc.name, sub.name, '') ilike v_subject
            and coalesce(tc.name, t.name, ct.name, '') ilike v_topic_name
            and not (q.id = any (v_ids))
          order by q.id
          limit v_need
        ) q;
        v_have := coalesce(array_length(v_pick, 1), 0);
        v_ids := v_ids || v_pick;
        if v_have < v_need then
          v_missing := v_missing || jsonb_build_array(jsonb_build_object(
            'path', v_subject || ' / ' || v_topic_name,
            'need', v_need,
            'have', v_have
          ));
        end if;
      end loop;
    else
      v_need := coalesce((v_item->>'count')::int, 0);
      v_diff := v_item->>'difficulty';
      if v_need <= 0 then continue; end if;
      select coalesce(array_agg(q.id), '{}') into v_pick
      from (
        select q.id
        from public.questions q
        left join public.question_exam_map m on m.question_id = q.id
        left join public.canonical_topics ct on ct.id = q.canonical_topic_id
        left join public.topic_catalog tc on tc.canonical_topic_id = ct.id
        left join public.unit_catalog uc on uc.id = tc.unit_id
        left join public.subject_catalog sc on sc.id = uc.subject_id
        left join public.subjects sub on sub.id = q.subject_id
        where q.question_status = 'published' and q.is_published
          and (p_exam_catalog_id is null or q.exam_catalog_id = p_exam_catalog_id or m.exam_catalog_id = p_exam_catalog_id)
          and coalesce(sc.name, sub.name, '') ilike v_subject
          and (v_diff is null or v_diff = '' or q.difficulty::text = v_diff)
          and not (q.id = any (v_ids))
        order by q.id
        limit v_need
      ) q;
      v_have := coalesce(array_length(v_pick, 1), 0);
      v_ids := v_ids || v_pick;
      if v_have < v_need then
        v_missing := v_missing || jsonb_build_array(jsonb_build_object(
          'path', v_subject,
          'need', v_need,
          'have', v_have
        ));
      end if;
    end if;
  end loop;
  return jsonb_build_object('question_ids', to_jsonb(v_ids), 'missing', v_missing);
end;
$$;

create or replace function public.admin_exam_monitor(p_exam uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam public.system_exams%rowtype;
begin
  perform public.require_admin();
  select * into v_exam from public.system_exams where id = p_exam;
  if not found then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'exam', jsonb_build_object(
      'id', v_exam.id, 'title', v_exam.title,
      'status', public.system_exam_derived_status(v_exam),
      'start_at', v_exam.start_at, 'end_at', v_exam.end_at,
      'extra_minutes', v_exam.extra_minutes
    ),
    'joined', (select count(*) from public.system_exam_attempts where system_exam_id = p_exam),
    'in_progress', (select count(*) from public.system_exam_attempts where system_exam_id = p_exam and status = 'in_progress'),
    'finished', (select count(*) from public.system_exam_attempts where system_exam_id = p_exam and status in ('submitted', 'expired')),
    'not_started', greatest(
      (select count(*) from public.system_exam_signups where system_exam_id = p_exam)
      - (select count(*) from public.system_exam_attempts where system_exam_id = p_exam),
      0),
    'avg_elapsed_seconds', (
      select round(avg(extract(epoch from (coalesce(submitted_at, now()) - started_at))))
      from public.system_exam_attempts where system_exam_id = p_exam
    ),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'name', p.display_name,
        'status', a.status,
        'started_at', a.started_at,
        'submitted_at', a.submitted_at
      ) order by a.started_at desc)
      from public.system_exam_attempts a
      join public.profiles p on p.id = a.user_id
      where a.system_exam_id = p_exam
      limit 80
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_exam_control(p_exam uuid, p_action text, p_minutes int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam public.system_exams%rowtype;
  v_att record;
begin
  perform public.require_admin();
  select * into v_exam from public.system_exams where id = p_exam;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action = 'extend' then
    update public.system_exams
    set extra_minutes = extra_minutes + greatest(p_minutes, 1),
        end_at = end_at + make_interval(mins => greatest(p_minutes, 1)),
        updated_at = now()
    where id = p_exam;
  elsif p_action = 'finish_early' then
    update public.system_exams
    set status = 'finished', end_at = least(end_at, now()), updated_at = now()
    where id = p_exam and status <> 'cancelled';
    for v_att in
      select a.id from public.system_exam_attempts a
      where a.system_exam_id = p_exam and a.status = 'in_progress'
    loop
      perform public.submit_system_exam(v_att.id);
    end loop;
  elsif p_action = 'cancel' then
    update public.system_exams set status = 'cancelled', updated_at = now() where id = p_exam;
    update public.system_exam_attempts
    set status = 'expired', submitted_at = coalesce(submitted_at, now())
    where system_exam_id = p_exam and status = 'in_progress';
  elsif p_action = 'release' then
    update public.system_exams set results_released = true, updated_at = now() where id = p_exam;
  else
    raise exception 'INVALID_INPUT';
  end if;
  perform public.write_admin_audit('exam_control', 'system_exam', p_exam::text, jsonb_build_object('action', p_action, 'minutes', p_minutes));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_exam_analytics(p_exam uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'participants', (
      select count(*) from public.system_exam_attempts a
      where a.system_exam_id = p_exam and a.status in ('submitted', 'expired')
        and not public.is_virtual_profile(a.user_id)
    ),
    'avg_net', (
      select round(avg(score)::numeric, 1) from public.system_exam_attempts a
      where a.system_exam_id = p_exam and a.status in ('submitted', 'expired') and not public.is_virtual_profile(a.user_id)
    ),
    'avg_correct', (
      select round(avg(total_correct)::numeric, 1) from public.system_exam_attempts a
      where a.system_exam_id = p_exam and a.status in ('submitted', 'expired') and not public.is_virtual_profile(a.user_id)
    ),
    'avg_wrong', (
      select round(avg(total_wrong)::numeric, 1) from public.system_exam_attempts a
      where a.system_exam_id = p_exam and a.status in ('submitted', 'expired') and not public.is_virtual_profile(a.user_id)
    ),
    'avg_blank', (
      select round(avg(total_blank)::numeric, 1) from public.system_exam_attempts a
      where a.system_exam_id = p_exam and a.status in ('submitted', 'expired') and not public.is_virtual_profile(a.user_id)
    ),
    'avg_minutes', (
      select round(avg(extract(epoch from (submitted_at - started_at)) / 60.0)::numeric, 1)
      from public.system_exam_attempts a
      where a.system_exam_id = p_exam and a.submitted_at is not null and not public.is_virtual_profile(a.user_id)
    ),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', subj,
        'success', round((100.0 * correct_n / nullif(total_n, 0))::numeric, 1)
      ) order by subj)
      from (
        select coalesce(sc.name, sub.name, 'Ders') as subj,
               count(*)::int as total_n,
               count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) = upper(q.correct_choice))::int as correct_n
        from public.system_exam_questions seq
        join public.questions q on q.id = seq.question_id
        join public.system_exam_attempts a on a.system_exam_id = seq.system_exam_id and a.status in ('submitted', 'expired')
          and not public.is_virtual_profile(a.user_id)
        left join public.system_exam_answers ans on ans.attempt_id = a.id and ans.question_id = q.id
        left join public.subjects sub on sub.id = q.subject_id
        left join public.canonical_topics ct on ct.id = q.canonical_topic_id
        left join public.topic_catalog tc on tc.canonical_topic_id = ct.id
        left join public.unit_catalog uc on uc.id = tc.unit_id
        left join public.subject_catalog sc on sc.id = uc.subject_id
        where seq.system_exam_id = p_exam
        group by 1
      ) s
    ), '[]'::jsonb),
    'hard_topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', topic,
        'success', success
      ) order by success)
      from (
        select coalesce(tc.name, t.name, ct.name, 'Konu') as topic,
               round((100.0 * count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) = upper(q.correct_choice))
                 / nullif(count(*), 0))::numeric, 1) as success
        from public.system_exam_questions seq
        join public.questions q on q.id = seq.question_id
        join public.system_exam_attempts a on a.system_exam_id = seq.system_exam_id and a.status in ('submitted', 'expired')
          and not public.is_virtual_profile(a.user_id)
        left join public.system_exam_answers ans on ans.attempt_id = a.id and ans.question_id = q.id
        left join public.topics t on t.id = q.topic_id
        left join public.canonical_topics ct on ct.id = q.canonical_topic_id
        left join public.topic_catalog tc on tc.canonical_topic_id = ct.id
        where seq.system_exam_id = p_exam
        group by 1
        having count(*) >= 5
        order by 2
        limit 12
      ) t
    ), '[]'::jsonb),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', qid,
        'stem', stem,
        'correct_pct', correct_pct,
        'wrong_pct', wrong_pct,
        'blank_pct', blank_pct
      ) order by wrong_pct desc)
      from (
        select q.id as qid, left(q.stem, 140) as stem,
               round((100.0 * count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) = upper(q.correct_choice)) / nullif(count(*),0))::numeric, 1) as correct_pct,
               round((100.0 * count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) <> upper(q.correct_choice)) / nullif(count(*),0))::numeric, 1) as wrong_pct,
               round((100.0 * count(*) filter (where ans.selected_option is null) / nullif(count(*),0))::numeric, 1) as blank_pct
        from public.system_exam_questions seq
        join public.questions q on q.id = seq.question_id
        join public.system_exam_attempts a on a.system_exam_id = seq.system_exam_id and a.status in ('submitted', 'expired')
          and not public.is_virtual_profile(a.user_id)
        left join public.system_exam_answers ans on ans.attempt_id = a.id and ans.question_id = q.id
        where seq.system_exam_id = p_exam
        group by q.id, q.stem, q.correct_choice
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.start_system_exam(p_exam uuid, p_client_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exam public.system_exams%rowtype;
  v_attempt public.system_exam_attempts%rowtype;
  v_status text;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_exam from public.system_exams where id = p_exam;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_exam.status = 'cancelled' then raise exception 'EXAM_CANCELLED'; end if;
  v_status := public.system_exam_derived_status(v_exam);
  if v_status = 'scheduled' and coalesce(v_exam.allow_early_entry, false) then
    v_status := 'live';
  end if;
  if v_status <> 'live' then raise exception 'EXAM_NOT_LIVE'; end if;
  if exists (
    select 1 from public.profiles
    where id = v_user and (account_status = 'banned' or (account_status = 'restricted' and restricted_until is not null and restricted_until > now()))
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  insert into public.system_exam_attempts (system_exam_id, user_id, client_id)
  values (p_exam, v_user, nullif(p_client_id, ''))
  on conflict (system_exam_id, user_id) do nothing;

  select * into v_attempt from public.system_exam_attempts where system_exam_id = p_exam and user_id = v_user;
  if v_attempt.client_id is not null and p_client_id is not null and v_attempt.client_id <> p_client_id
     and v_attempt.status = 'in_progress'
     and v_attempt.last_seen_at > now() - interval '45 seconds' then
    raise exception 'ATTEMPT_ACTIVE_ELSEWHERE';
  end if;

  update public.system_exam_attempts
  set client_id = coalesce(nullif(p_client_id, ''), client_id), last_seen_at = now()
  where id = v_attempt.id
  returning * into v_attempt;

  if v_attempt.status = 'in_progress' and public.system_exam_remaining_seconds(v_attempt, v_exam) <= 0 then
    perform public.submit_system_exam(v_attempt.id);
    select * into v_attempt from public.system_exam_attempts where id = v_attempt.id;
  end if;

  if v_attempt.status = 'in_progress' then
    perform public.award_xp(v_user, 15, 'system_exam', 'system_exam_start', v_attempt.id::text, jsonb_build_object('exam_id', p_exam));
  end if;

  return public.get_system_exam_play(v_attempt.id, p_client_id);
end;
$$;

create or replace function public.get_system_exam_result(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.system_exam_attempts%rowtype;
  v_exam public.system_exams%rowtype;
  v_visible boolean;
  v_base jsonb;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_attempt from public.system_exam_attempts where id = p_attempt;
  if not found or (v_attempt.user_id <> v_user and not public.is_admin()) then
    raise exception 'NOT_FOUND';
  end if;
  if v_attempt.status = 'in_progress' then raise exception 'ATTEMPT_LOCKED'; end if;
  select * into v_exam from public.system_exams where id = v_attempt.system_exam_id;
  v_visible := public.system_exam_results_visible(v_exam) or public.is_admin();
  if not v_visible then
    return jsonb_build_object(
      'released', false,
      'exam', jsonb_build_object('id', v_exam.id, 'title', v_exam.title),
      'message', 'Sonuçlar henüz açıklanmadı.'
    );
  end if;
  v_base := jsonb_build_object('released', true);
  return v_base || (
    select public.get_system_exam_result_legacy(p_attempt)
  );
end;
$$;

create or replace function public.get_system_exam_result_legacy(p_attempt uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.system_exam_attempts%rowtype;
  v_exam public.system_exams%rowtype;
  v_finished boolean;
  v_total int := 0;
  v_rank int;
  v_percentile numeric;
begin
  select * into v_attempt from public.system_exam_attempts where id = p_attempt;
  select * into v_exam from public.system_exams where id = v_attempt.system_exam_id;
  v_finished := public.system_exam_results_visible(v_exam);
  if v_finished then
    select count(*) into v_total
    from public.system_exam_attempts a
    where a.system_exam_id = v_exam.id and a.status in ('submitted', 'expired') and a.score is not null
      and not public.is_virtual_profile(a.user_id);
    select rnk into v_rank
    from (
      select id, rank() over (
        order by score desc nulls last, extract(epoch from (submitted_at - started_at)) asc
      ) as rnk
      from public.system_exam_attempts a
      where a.system_exam_id = v_exam.id and a.status in ('submitted', 'expired') and a.score is not null
        and not public.is_virtual_profile(a.user_id)
    ) x
    where x.id = v_attempt.id;
    if v_total > 0 and v_rank is not null then
      v_percentile := round((100.0 * (v_total - v_rank + 1) / v_total)::numeric, 1);
    end if;
  end if;
  return jsonb_build_object(
    'exam', jsonb_build_object('id', v_exam.id, 'title', v_exam.title, 'exam_type', v_exam.exam_type, 'finished', v_finished),
    'attempt', jsonb_build_object(
      'id', v_attempt.id, 'status', v_attempt.status,
      'total_correct', v_attempt.total_correct, 'total_wrong', v_attempt.total_wrong,
      'total_blank', v_attempt.total_blank, 'score', v_attempt.score,
      'rank', v_rank, 'percentile', v_percentile,
      'duration_seconds', floor(extract(epoch from (coalesce(v_attempt.submitted_at, now()) - v_attempt.started_at)))::int
    ),
    'by_subject', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(sc.name, sub.name, 'Ders'),
        'correct', count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) = upper(q.correct_choice)),
        'wrong', count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) <> upper(q.correct_choice)),
        'blank', count(*) filter (where ans.selected_option is null)
      ))
      from public.system_exam_questions seq
      join public.questions q on q.id = seq.question_id
      left join public.subjects sub on sub.id = q.subject_id
      left join public.canonical_topics ct on ct.id = q.canonical_topic_id
      left join public.topic_catalog tc on tc.canonical_topic_id = ct.id
      left join public.unit_catalog uc on uc.id = tc.unit_id
      left join public.subject_catalog sc on sc.id = uc.subject_id
      left join public.system_exam_answers ans on ans.attempt_id = v_attempt.id and ans.question_id = q.id
      where seq.system_exam_id = v_exam.id
      group by 1
    ), '[]'::jsonb),
    'by_topic', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(tc.name, t.name, ct.name, 'Konu'),
        'subject', coalesce(sc.name, sub.name, ''),
        'correct', count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) = upper(q.correct_choice)),
        'wrong', count(*) filter (where ans.selected_option is not null and upper(ans.selected_option) <> upper(q.correct_choice)),
        'blank', count(*) filter (where ans.selected_option is null)
      ))
      from public.system_exam_questions seq
      join public.questions q on q.id = seq.question_id
      left join public.subjects sub on sub.id = q.subject_id
      left join public.topics t on t.id = q.topic_id
      left join public.canonical_topics ct on ct.id = q.canonical_topic_id
      left join public.topic_catalog tc on tc.canonical_topic_id = ct.id
      left join public.unit_catalog uc on uc.id = tc.unit_id
      left join public.subject_catalog sc on sc.id = uc.subject_id
      left join public.system_exam_answers ans on ans.attempt_id = v_attempt.id and ans.question_id = q.id
      where seq.system_exam_id = v_exam.id
      group by 1, 2
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.system_exam_leaderboard(p_exam uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_exam public.system_exams%rowtype;
  v_mine int;
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_exam from public.system_exams where id = p_exam;
  if not found or not public.system_exam_results_visible(v_exam) then
    return jsonb_build_object('ready', false, 'top', '[]'::jsonb, 'label', 'ÖSYM Koçu sıralaması');
  end if;
  with ranked as (
    select a.user_id, p.display_name, p.display_tag, a.score,
      rank() over (order by a.score desc nulls last, extract(epoch from (a.submitted_at - a.started_at)) asc)::int as rank
    from public.system_exam_attempts a
    join public.profiles p on p.id = a.user_id
    where a.system_exam_id = p_exam and a.status in ('submitted', 'expired') and a.score is not null
      and not public.is_virtual_profile(a.user_id)
  )
  select rank into v_mine from ranked where user_id = v_user;
  return jsonb_build_object(
    'ready', true,
    'label', 'ÖSYM Koçu sıralaması',
    'mine', v_mine,
    'count', (select count(*) from ranked),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', r.rank, 'display_name', r.display_name, 'display_tag', r.display_tag,
        'score', r.score, 'is_me', r.user_id = v_user
      ) order by r.rank)
      from ranked r where r.rank <= 100
    ), '[]'::jsonb),
    'nearby', '[]'::jsonb
  );
end;
$$;

grant execute on function public.admin_exam_question_pool(uuid, text, text, text, text, int) to authenticated;
grant execute on function public.admin_auto_pick_exam_questions(uuid, jsonb) to authenticated;
grant execute on function public.admin_exam_monitor(uuid) to authenticated;
grant execute on function public.admin_exam_control(uuid, text, int) to authenticated;
grant execute on function public.admin_exam_analytics(uuid) to authenticated;
grant execute on function public.get_system_exam_result_legacy(uuid) to authenticated;
grant execute on function public.system_exam_results_visible(public.system_exams) to authenticated;
