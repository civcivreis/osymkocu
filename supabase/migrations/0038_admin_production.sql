-- Phase 3: super_admin, staff RPCs, question bank, reminders, audit immutability, web push.
-- Paste after 0037. Does not demote extra staff created via team management.

do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.profiles'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%app_role%'
  loop
    execute format('alter table public.profiles drop constraint %I', v_name);
  end loop;
end $$;

alter table public.profiles
  add column if not exists last_active_at timestamptz,
  add column if not exists staff_added_by uuid references public.profiles(id) on delete set null,
  add column if not exists staff_added_at timestamptz,
  add column if not exists web_push_enabled boolean not null default false;

do $$ begin
  alter table public.profiles
    add constraint profiles_app_role_check
    check (app_role in ('user', 'moderator', 'admin', 'super_admin'));
exception when duplicate_object then null;
end $$;

alter table public.questions
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null default '',
  auth text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists public.admin_scheduled_notifications (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text,
  body text not null,
  exam_type text,
  target_user_id uuid references public.profiles(id) on delete cascade,
  deep_link text,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.web_push_subscriptions enable row level security;
alter table public.admin_scheduled_notifications enable row level security;

drop policy if exists web_push_own on public.web_push_subscriptions;
create policy web_push_own on public.web_push_subscriptions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and app_role in ('admin', 'super_admin')
      and account_status <> 'banned'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and app_role in ('moderator', 'admin', 'super_admin')
      and account_status <> 'banned'
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and app_role = 'super_admin'
      and account_status <> 'banned'
  );
$$;

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return v_user;
end;
$$;

create or replace function public.require_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.is_staff() then raise exception 'STAFF_ONLY'; end if;
  return v_user;
end;
$$;

create or replace function public.require_super_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.is_super_admin() then raise exception 'SUPER_ADMIN_ONLY'; end if;
  return v_user;
end;
$$;

create or replace function public.get_staff_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select app_role, account_status into v_role, v_status
  from public.profiles where id = auth.uid();
  if v_role is null then raise exception 'UNAUTHORIZED'; end if;
  if v_status = 'banned' or v_role not in ('moderator', 'admin', 'super_admin') then
    raise exception 'STAFF_ONLY';
  end if;
  return jsonb_build_object('role', v_role, 'ok', true);
end;
$$;

create or replace function public.bootstrap_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles p
  set app_role = 'super_admin',
      staff_added_at = coalesce(p.staff_added_at, now())
  from auth.users u
  where u.id = p.id
    and lower(u.email) in ('attutattutt@gmail.com', 'attutattut@hotmail.com');
  return exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.id
    where lower(u.email) in ('attutattutt@gmail.com', 'attutattut@hotmail.com')
      and p.app_role = 'super_admin'
  );
end;
$$;

update public.profiles p
set app_role = 'super_admin',
    staff_added_at = coalesce(p.staff_added_at, now())
from auth.users u
where u.id = p.id
  and lower(u.email) in ('attutattutt@gmail.com', 'attutattut@hotmail.com');

create or replace function public.deny_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'AUDIT_IMMUTABLE';
end;
$$;

drop trigger if exists admin_audit_no_update on public.admin_audit_logs;
create trigger admin_audit_no_update
  before update or delete on public.admin_audit_logs
  for each row execute procedure public.deny_audit_mutation();

create or replace function public.touch_last_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles set last_active_at = now() where id = auth.uid();
end;
$$;

create or replace function public.sync_my_exam_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r record;
  v_slot text;
begin
  if v_user is null then return; end if;
  if exists (select 1 from public.profiles where id = v_user and system_exam_reminders = false) then
    return;
  end if;
  for r in
    select e.*
    from public.system_exams e
    join public.system_exam_signups s on s.system_exam_id = e.id and s.user_id = v_user
    where e.status in ('scheduled', 'live')
      and e.start_at > now()
      and e.start_at <= now() + interval '24 hours'
  loop
    foreach v_slot in array ARRAY['24h', '1h', '10m']
    loop
      if v_slot = '24h'
         or (v_slot = '1h' and r.start_at <= now() + interval '1 hour')
         or (v_slot = '10m' and r.start_at <= now() + interval '10 minutes') then
        insert into public.system_exam_reminder_sends (system_exam_id, user_id, slot)
        values (r.id, v_user, v_slot)
        on conflict do nothing;
        if found then
          insert into public.notifications (user_id, kind, payload)
          values (
            v_user,
            'system_exam_reminder',
            jsonb_build_object('exam_id', r.id, 'title', r.title, 'start_at', r.start_at, 'slot', v_slot)
          );
        end if;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function public.dispatch_exam_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_slot text;
  v_n int := 0;
begin
  perform public.require_admin();
  for r in
    select e.id, e.title, e.start_at, s.user_id
    from public.system_exams e
    join public.system_exam_signups s on s.system_exam_id = e.id
    join public.profiles p on p.id = s.user_id
    where e.status in ('scheduled', 'live')
      and e.start_at > now()
      and e.start_at <= now() + interval '24 hours'
      and coalesce(p.system_exam_reminders, true) = true
      and p.account_status <> 'banned'
  loop
    foreach v_slot in array ARRAY['24h', '1h', '10m']
    loop
      if v_slot = '24h'
         or (v_slot = '1h' and r.start_at <= now() + interval '1 hour')
         or (v_slot = '10m' and r.start_at <= now() + interval '10 minutes') then
        insert into public.system_exam_reminder_sends (system_exam_id, user_id, slot)
        values (r.id, r.user_id, v_slot)
        on conflict do nothing;
        if found then
          insert into public.notifications (user_id, kind, payload)
          values (
            r.user_id,
            'system_exam_reminder',
            jsonb_build_object('exam_id', r.id, 'title', r.title, 'start_at', r.start_at, 'slot', v_slot)
          );
          v_n := v_n + 1;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('sent', v_n);
end;
$$;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_today date := (timezone('Europe/Istanbul', now()))::date;
begin
  perform public.require_staff();
  return jsonb_build_object(
    'users', (select count(*)::int from public.profiles),
    'today_active_users', (
      select count(*)::int from public.profiles
      where last_active_at is not null
        and (timezone('Europe/Istanbul', last_active_at))::date = v_today
    ),
    'active_users', (
      select count(distinct user_id)::int from public.question_attempts
      where created_at > now() - interval '7 days'
    ),
    'questions_today', (
      select count(*)::int from public.question_attempts
      where (timezone('Europe/Istanbul', created_at))::date = v_today
    ),
    'active_sessions', (
      select count(*)::int from public.study_sessions
      where status in ('countdown', 'active')
    ),
    'open_rooms', (
      select count(*)::int from public.study_sessions
      where status in ('waiting', 'countdown', 'active')
    ),
    'pending_reports', (
      select count(*)::int from public.content_reports where status = 'open'
    ),
    'messages_today', (
      (select count(*)::int from public.dm_messages where (timezone('Europe/Istanbul', created_at))::date = v_today)
      + (select count(*)::int from public.exam_chat_messages where (timezone('Europe/Istanbul', created_at))::date = v_today)
    ),
    'upcoming_exam', (
      select jsonb_build_object('id', id, 'title', title, 'start_at', start_at)
      from public.system_exams
      where status not in ('draft', 'cancelled', 'finished') and start_at > now()
      order by start_at
      limit 1
    )
  );
end;
$$;

drop function if exists public.admin_search_questions(text, text, int);
create or replace function public.admin_search_questions(
  p_exam_type text default null,
  p_search text default '',
  p_limit int default 40,
  p_subject_id uuid default null,
  p_topic_id uuid default null,
  p_difficulty text default null,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(row_json)
    from (
      select jsonb_build_object(
        'id', q.id,
        'stem', q.stem,
        'choices', q.choices,
        'correct_choice', q.correct_choice,
        'explanation', q.explanation,
        'image_url', q.image_url,
        'difficulty', q.difficulty,
        'subject', sub.name,
        'subject_id', q.subject_id,
        'topic', t.name,
        'topic_id', q.topic_id,
        'exam', e.slug,
        'exam_id', q.exam_id,
        'is_published', q.is_published,
        'archived_at', q.archived_at,
        'created_at', q.created_at
      ) as row_json
      from public.questions q
      join public.exams e on e.id = q.exam_id
      join public.subjects sub on sub.id = q.subject_id
      left join public.topics t on t.id = q.topic_id
      where (p_include_archived or q.archived_at is null)
        and (
          p_exam_type is null
          or e.slug = p_exam_type
          or (p_exam_type = 'kpss' and e.slug like 'kpss%')
        )
        and (p_subject_id is null or q.subject_id = p_subject_id)
        and (p_topic_id is null or q.topic_id = p_topic_id)
        and (p_difficulty is null or p_difficulty = '' or q.difficulty::text = p_difficulty)
        and (
          coalesce(p_search, '') = ''
          or q.stem ilike '%' || p_search || '%'
        )
      order by q.created_at desc
      limit least(coalesce(p_limit, 40), 80)
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_upsert_question(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_exam uuid := nullif(p_payload->>'exam_id', '')::uuid;
  v_subject uuid := nullif(p_payload->>'subject_id', '')::uuid;
  v_topic uuid := nullif(p_payload->>'topic_id', '')::uuid;
  v_correct text := upper(coalesce(p_payload->>'correct_choice', ''));
begin
  perform public.require_admin();
  if v_exam is null or v_subject is null then raise exception 'INVALID_INPUT'; end if;
  if length(trim(coalesce(p_payload->>'stem', ''))) < 8 then raise exception 'INVALID_INPUT'; end if;
  if v_correct not in ('A', 'B', 'C', 'D', 'E') then raise exception 'INVALID_INPUT'; end if;
  if v_id is null then
    insert into public.questions (
      exam_id, subject_id, topic_id, stem, choices, correct_choice, explanation, difficulty, image_url, is_published, source
    ) values (
      v_exam, v_subject, v_topic,
      trim(p_payload->>'stem'),
      coalesce(p_payload->'choices', '{}'::jsonb),
      v_correct,
      nullif(trim(p_payload->>'explanation'), ''),
      coalesce((p_payload->>'difficulty')::public.difficulty, 'medium'),
      nullif(trim(p_payload->>'image_url'), ''),
      coalesce((p_payload->>'is_published')::boolean, true),
      'admin'
    ) returning id into v_id;
    perform public.write_admin_audit('question_create', 'question', v_id::text, p_payload);
  else
    update public.questions
    set exam_id = v_exam,
        subject_id = v_subject,
        topic_id = v_topic,
        stem = trim(p_payload->>'stem'),
        choices = coalesce(p_payload->'choices', choices),
        correct_choice = v_correct,
        explanation = nullif(trim(p_payload->>'explanation'), ''),
        difficulty = coalesce((p_payload->>'difficulty')::public.difficulty, difficulty),
        image_url = nullif(trim(p_payload->>'image_url'), ''),
        is_published = coalesce((p_payload->>'is_published')::boolean, is_published),
        updated_at = now()
    where id = v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform public.write_admin_audit('question_update', 'question', v_id::text, p_payload);
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.admin_archive_question(p_id uuid, p_archive boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  update public.questions
  set archived_at = case when p_archive then now() else null end,
      is_published = case when p_archive then false else is_published end,
      updated_at = now()
  where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform public.write_admin_audit('question_archive', 'question', p_id::text, jsonb_build_object('archive', p_archive));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'exams', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'slug', slug, 'name', name) order by name) from public.exams), '[]'::jsonb),
    'subjects', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'exam_id', exam_id, 'slug', slug, 'name', name) order by sort_order)
      from public.subjects
    ), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'subject_id', subject_id, 'slug', slug, 'name', name) order by sort_order)
      from public.topics
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_list_users(p_search text default '', p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'display_tag', p.display_tag,
      'username', p.display_name || '#' || lpad(coalesce(p.display_tag, 0)::text, 4, '0'),
      'exam_name', e.name,
      'exam_type', e.slug,
      'current_xp', p.current_xp,
      'streak', coalesce(st.current_streak, 0),
      'app_role', p.app_role,
      'account_status', p.account_status,
      'created_at', p.created_at,
      'last_active_at', p.last_active_at
    ) order by p.created_at desc)
    from (
      select * from public.profiles
      where coalesce(p_search, '') = ''
         or display_name ilike '%' || p_search || '%'
      order by created_at desc
      limit least(coalesce(p_limit, 50), 100)
    ) p
    left join public.exams e on e.id = p.exam_id
    left join public.streaks st on st.user_id = p.id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_get_user(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_profile jsonb;
begin
  perform public.require_admin();
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'display_tag', p.display_tag,
    'exam_name', e.name,
    'current_xp', p.current_xp,
    'streak', coalesce(st.current_streak, 0),
    'app_role', p.app_role,
    'account_status', p.account_status,
    'created_at', p.created_at,
    'last_active_at', p.last_active_at,
    'restricted_until', p.restricted_until
  ) into v_profile
  from public.profiles p
  left join public.exams e on e.id = p.exam_id
  left join public.streaks st on st.user_id = p.id
  where p.id = p_user;
  if v_profile is null then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'profile', v_profile,
    'attempts', (select count(*)::int from public.question_attempts where user_id = p_user),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'reason', reason, 'status', status, 'created_at', created_at) order by created_at desc)
      from (select * from public.content_reports where target_user_id = p_user order by created_at desc limit 20) r
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'created_at', created_at) order by created_at desc)
      from (
        select s.id, s.status, s.created_at
        from public.study_sessions s
        join public.study_session_members m on m.session_id = s.id
        where m.user_id = p_user
        order by s.created_at desc
        limit 20
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists public.admin_list_reports(text);
create or replace function public.admin_list_reports(p_status text default 'open', p_content_type text default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'content_type', r.content_type,
      'content_id', r.content_id,
      'reason', r.reason,
      'status', r.status,
      'created_at', r.created_at,
      'reporter', rp.display_name,
      'target', tp.display_name,
      'target_id', r.target_user_id,
      'media_id', r.content_id
    ) order by r.created_at desc)
    from public.content_reports r
    join public.profiles rp on rp.id = r.reporter_user_id
    join public.profiles tp on tp.id = r.target_user_id
    where (p_status is null or r.status = p_status)
      and (p_content_type is null or p_content_type = '' or r.content_type = p_content_type)
      and (p_reason is null or p_reason = '' or r.reason ilike '%' || p_reason || '%')
    limit 80
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_review_report(p_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.require_staff();
  v_report public.content_reports%rowtype;
begin
  select * into v_report from public.content_reports where id = p_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_action in ('warning', 'restrict', 'ban', 'remove') and not public.is_admin() then
    raise exception 'ADMIN_ONLY';
  end if;
  update public.content_reports
  set status = case p_action
        when 'dismiss' then 'dismissed'
        when 'warning' then 'warned'
        when 'restrict' then 'restricted'
        when 'ban' then 'banned'
        when 'remove' then 'dismissed'
        else 'open' end,
      reviewed_by = v_admin,
      reviewed_at = now()
  where id = p_id;
  if p_action in ('warning', 'restrict', 'ban') then
    perform public.admin_set_user_status(
      v_report.target_user_id,
      case p_action when 'warning' then 'warned' when 'restrict' then 'restricted' else 'banned' end,
      case when p_action = 'restrict' then 48 else null end
    );
  end if;
  perform public.write_admin_audit('report_review', 'content_report', p_id::text, jsonb_build_object('action', p_action));
  return jsonb_build_object('ok', true);
end;
$$;

drop function if exists public.admin_broadcast(text, text);
create or replace function public.admin_broadcast(
  p_body text,
  p_exam_type text default null,
  p_title text default null,
  p_target_user uuid default null,
  p_deep_link text default null,
  p_scheduled_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.require_admin();
  v_n int := 0;
begin
  if length(trim(coalesce(p_body, ''))) < 3 then raise exception 'INVALID_INPUT'; end if;
  if p_scheduled_at is not null and p_scheduled_at > now() then
    insert into public.admin_scheduled_notifications (
      created_by, title, body, exam_type, target_user_id, deep_link, scheduled_at
    ) values (
      v_admin, nullif(trim(p_title), ''), left(trim(p_body), 280), p_exam_type, p_target_user, nullif(trim(p_deep_link), ''), p_scheduled_at
    );
    perform public.write_admin_audit('broadcast_schedule', 'notification', null, jsonb_build_object('scheduled_at', p_scheduled_at));
    return jsonb_build_object('queued', true);
  end if;
  insert into public.notifications (user_id, kind, payload)
  select p.id, 'admin_broadcast', jsonb_build_object(
    'title', nullif(trim(p_title), ''),
    'body', left(trim(p_body), 280),
    'exam_type', p_exam_type,
    'deep_link', nullif(trim(p_deep_link), '')
  )
  from public.profiles p
  left join public.exams e on e.id = p.exam_id
  where p.account_status <> 'banned'
    and (p_target_user is null or p.id = p_target_user)
    and (
      p_exam_type is null
      or e.slug = p_exam_type
      or (p_exam_type = 'kpss' and e.slug like 'kpss%')
    );
  get diagnostics v_n = row_count;
  perform public.write_admin_audit('broadcast', 'notification', coalesce(p_target_user::text, p_exam_type), jsonb_build_object('count', v_n, 'title', p_title));
  return jsonb_build_object('sent', v_n);
end;
$$;

create or replace function public.admin_list_staff()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.require_super_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'display_name', p.display_name,
      'display_tag', p.display_tag,
      'username', p.display_name || '#' || lpad(coalesce(p.display_tag, 0)::text, 4, '0'),
      'app_role', p.app_role,
      'added_by', adder.display_name,
      'created_at', coalesce(p.staff_added_at, p.created_at)
    ) order by p.app_role, p.display_name)
    from public.profiles p
    left join public.profiles adder on adder.id = p.staff_added_by
    where p.app_role in ('moderator', 'admin', 'super_admin')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_set_staff_role(p_user uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := public.require_super_admin();
  v_current text;
  v_supers int;
begin
  if p_role not in ('user', 'moderator', 'admin') then raise exception 'INVALID_INPUT'; end if;
  if p_user = v_admin then raise exception 'SELF_DEMOTE'; end if;
  select app_role into v_current from public.profiles where id = p_user;
  if v_current is null then raise exception 'NOT_FOUND'; end if;
  if v_current = 'super_admin' then
    select count(*) into v_supers from public.profiles where app_role = 'super_admin';
    if v_supers <= 1 then raise exception 'LAST_SUPER_ADMIN'; end if;
    raise exception 'SUPER_ADMIN_ONLY';
  end if;
  update public.profiles
  set app_role = p_role,
      staff_added_by = case when p_role in ('moderator', 'admin') then v_admin else staff_added_by end,
      staff_added_at = case when p_role in ('moderator', 'admin') then now() else staff_added_at end
  where id = p_user;
  perform public.write_admin_audit('role_change', 'profile', p_user::text, jsonb_build_object('from', v_current, 'to', p_role));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.save_web_push_subscription(p_endpoint text, p_p256dh text default '', p_auth text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if length(trim(coalesce(p_endpoint, ''))) < 8 then raise exception 'INVALID_INPUT'; end if;
  insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), left(trim(p_endpoint), 2000), coalesce(p_p256dh, ''), coalesce(p_auth, ''))
  on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth;
  update public.profiles set web_push_enabled = true where id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.disable_web_push()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  delete from public.web_push_subscriptions where user_id = auth.uid();
  update public.profiles set web_push_enabled = false where id = auth.uid();
  return jsonb_build_object('ok', true);
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
  v_type text := p_payload->>'exam_type';
begin
  if v_type not in ('tyt', 'ayt', 'kpss') then raise exception 'INVALID_INPUT'; end if;
  if v_duration < 10 or v_duration > 300 then raise exception 'INVALID_INPUT'; end if;
  if v_start is null then raise exception 'INVALID_INPUT'; end if;
  v_end := v_start + make_interval(mins => v_duration);
  if v_status not in ('draft', 'scheduled', 'live', 'finished', 'cancelled') then
    v_status := 'draft';
  end if;
  if v_status in ('scheduled', 'live') and not public.istanbul_exam_slot_ok(v_start) then
    raise exception 'EXAM_HOUR';
  end if;
  if v_id is null then
    insert into public.system_exams (
      title, exam_type, description, start_at, end_at, duration_minutes, status, created_by, published_at
    ) values (
      left(trim(p_payload->>'title'), 120),
      v_type,
      nullif(trim(p_payload->>'description'), ''),
      v_start, v_end, v_duration, v_status, v_admin,
      case when v_status in ('scheduled', 'live') then now() else null end
    ) returning id into v_id;
    perform public.write_admin_audit(
      case when v_status in ('scheduled', 'live') then 'exam_publish' else 'exam_create' end,
      'system_exam', v_id::text, p_payload
    );
  else
    update public.system_exams
    set title = left(trim(p_payload->>'title'), 120),
        exam_type = v_type,
        description = nullif(trim(p_payload->>'description'), ''),
        start_at = v_start,
        end_at = v_end,
        duration_minutes = v_duration,
        status = case when status in ('live', 'finished') and v_status not in ('cancelled', 'finished') then status else v_status end,
        published_at = case when v_status in ('scheduled', 'live') then coalesce(published_at, now()) else published_at end,
        updated_at = now()
    where id = v_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform public.write_admin_audit('exam_update', 'system_exam', v_id::text, p_payload);
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.require_staff() to authenticated;
grant execute on function public.require_super_admin() to authenticated;
grant execute on function public.get_staff_context() to authenticated;
grant execute on function public.touch_last_active() to authenticated;
grant execute on function public.dispatch_exam_reminders() to authenticated;
grant execute on function public.admin_search_questions(text, text, int, uuid, uuid, text, boolean) to authenticated;
grant execute on function public.admin_upsert_question(jsonb) to authenticated;
grant execute on function public.admin_archive_question(uuid, boolean) to authenticated;
grant execute on function public.admin_catalog() to authenticated;
grant execute on function public.admin_get_user(uuid) to authenticated;
grant execute on function public.admin_list_reports(text, text, text) to authenticated;
grant execute on function public.admin_broadcast(text, text, text, uuid, text, timestamptz) to authenticated;
grant execute on function public.admin_list_staff() to authenticated;
grant execute on function public.admin_set_staff_role(uuid, text) to authenticated;
grant execute on function public.save_web_push_subscription(text, text, text) to authenticated;
grant execute on function public.disable_web_push() to authenticated;
revoke all on function public.bootstrap_admin() from public, anon, authenticated;
