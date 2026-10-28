-- Manual CMS runtime: delivery modes, packages, announcements, app releases,
-- short match search, factory paused. Additive and idempotent.

update public.content_factory_settings
set production_enabled = false,
    engine_state = 'paused',
    autonomous_lesson_writing = false,
    last_idle_reason = 'manual_cms_default',
    updated_at = now()
where id = 1;

create table if not exists public.app_runtime_settings (
  id int primary key default 1 check (id = 1),
  match_search_seconds int not null default 12 check (match_search_seconds between 8 and 30),
  content_revision bigint not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.app_runtime_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_runtime_settings enable row level security;
drop policy if exists app_runtime_settings_read on public.app_runtime_settings;
create policy app_runtime_settings_read on public.app_runtime_settings
  for select to authenticated using (true);

alter table public.memory_lessons
  add column if not exists delivery_mode text not null default 'text',
  add column if not exists hook text,
  add column if not exists hap_blocks jsonb not null default '[]'::jsonb,
  add column if not exists detailed_explanation text,
  add column if not exists study_minutes numeric,
  add column if not exists video_key text,
  add column if not exists content_revision bigint not null default 1,
  add column if not exists editorial_status text not null default 'draft';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'memory_lessons_delivery_mode_check'
  ) then
    alter table public.memory_lessons
      add constraint memory_lessons_delivery_mode_check
      check (delivery_mode in ('text', 'video', 'hybrid'));
  end if;
end $$;

alter table public.memory_lessons drop constraint if exists memory_lessons_status_check;
alter table public.memory_lessons
  add constraint memory_lessons_status_check
  check (status in ('draft', 'generating', 'pending_validation', 'approved', 'ready_review', 'published', 'archived'));

alter table public.memory_lessons drop constraint if exists memory_lessons_editorial_status_check;
alter table public.memory_lessons
  add constraint memory_lessons_editorial_status_check
  check (editorial_status in ('draft', 'ready_review', 'published', 'archived'));

update public.memory_lessons
set delivery_mode = 'video'
where delivery_mode = 'text'
  and (
    narration_key is not null
    or video_key is not null
    or media_generation_status = 'ready'
  );

alter table public.lesson_timeline_events drop constraint if exists lesson_timeline_events_type_check;
alter table public.lesson_timeline_events
  add constraint lesson_timeline_events_type_check check (event_type in (
    'scene_change', 'card_show', 'card_hide', 'checkpoint', 'checkpoint_intro',
    'coach_note', 'highlight', 'pause', 'resume', 'lesson_complete',
    'question', 'info', 'memory_tip', 'trap', 'custom_message'
  ));

create table if not exists public.lesson_packages (
  id uuid primary key default gen_random_uuid(),
  canonical_unit_id uuid references public.canonical_units(id) on delete cascade,
  title text not null,
  sort_order int not null default 0,
  review_question_count int not null default 5,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.lesson_packages(id) on delete cascade,
  canonical_topic_id uuid not null references public.canonical_topics(id) on delete cascade,
  sort_order int not null default 0,
  unique (package_id, canonical_topic_id)
);

alter table public.lesson_packages enable row level security;
alter table public.lesson_package_items enable row level security;
drop policy if exists lesson_packages_read on public.lesson_packages;
create policy lesson_packages_read on public.lesson_packages
  for select to authenticated using (status = 'published' or public.is_staff());
drop policy if exists lesson_package_items_read on public.lesson_package_items;
create policy lesson_package_items_read on public.lesson_package_items
  for select to authenticated using (
    exists (
      select 1 from public.lesson_packages p
      where p.id = package_id and (p.status = 'published' or public.is_staff())
    )
  );
drop policy if exists lesson_packages_staff_write on public.lesson_packages;
create policy lesson_packages_staff_write on public.lesson_packages
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists lesson_package_items_staff_write on public.lesson_package_items;
create policy lesson_package_items_staff_write on public.lesson_package_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.app_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  bullets jsonb not null default '[]'::jsonb,
  platforms text[] not null default array['all']::text[],
  audience text not null default 'all',
  display_mode text not null default 'once' check (display_mode in ('once', 'every_launch', 'until_dismissed', 'until_expiry')),
  start_at timestamptz,
  end_at timestamptz,
  primary_label text not null default 'Tamam',
  secondary_label text,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_announcement_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  announcement_id uuid not null references public.app_announcements(id) on delete cascade,
  seen_at timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (user_id, announcement_id)
);

alter table public.app_announcements enable row level security;
alter table public.app_announcement_receipts enable row level security;
drop policy if exists app_announcements_read on public.app_announcements;
create policy app_announcements_read on public.app_announcements
  for select to authenticated using (enabled = true or public.is_staff());
drop policy if exists app_announcements_staff on public.app_announcements;
create policy app_announcements_staff on public.app_announcements
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists app_announcement_receipts_own on public.app_announcement_receipts;
create policy app_announcement_receipts_own on public.app_announcement_receipts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('ios', 'android', 'web', 'all')),
  version text not null,
  minimum_supported_version text not null default '0.0.0',
  latest_version text not null,
  title text not null default 'Yeni sürüm mevcut',
  release_notes text,
  store_url text,
  force_update boolean not null default false,
  enabled boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, version)
);

alter table public.app_releases enable row level security;
drop policy if exists app_releases_read on public.app_releases;
create policy app_releases_read on public.app_releases
  for select to authenticated using (enabled = true or public.is_staff());
drop policy if exists app_releases_staff on public.app_releases;
create policy app_releases_staff on public.app_releases
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create table if not exists public.lesson_thread_messages (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  kind text not null default 'peer' check (kind in ('peer', 'coach', 'motivation')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists lesson_thread_messages_lesson_idx
  on public.lesson_thread_messages (lesson_id, created_at);
alter table public.lesson_thread_messages enable row level security;
drop policy if exists lesson_thread_messages_read on public.lesson_thread_messages;
create policy lesson_thread_messages_read on public.lesson_thread_messages
  for select to authenticated using (true);
drop policy if exists lesson_thread_messages_insert on public.lesson_thread_messages;
create policy lesson_thread_messages_insert on public.lesson_thread_messages
  for insert to authenticated with check (sender_id = auth.uid() or public.is_staff());

create or replace function public.match_config()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'cooldown_hours', 2,
    'max_per_day', 3,
    'rematch_hours', 24,
    'fatigue_count', 3,
    'fatigue_hours', 12,
    'offer_minutes', 0,
    'offer_seconds', coalesce((select match_search_seconds from public.app_runtime_settings where id = 1), 12),
    'stale_seconds', 45
  );
$$;

create or replace function public.study_match_offers_short_ttl()
returns trigger
language plpgsql
as $$
declare
  v_sec int := coalesce((public.match_config()->>'offer_seconds')::int, 12);
begin
  new.expires_at := least(new.expires_at, clock_timestamp() + make_interval(secs => v_sec));
  return new;
end;
$$;

drop trigger if exists study_match_offers_short_ttl on public.study_match_offers;
create trigger study_match_offers_short_ttl
before insert on public.study_match_offers
for each row execute procedure public.study_match_offers_short_ttl();

create or replace function public.bump_content_revision()
returns trigger
language plpgsql
as $$
begin
  update public.app_runtime_settings
  set content_revision = content_revision + 1, updated_at = now()
  where id = 1;
  if tg_table_name = 'memory_lessons' then
    new.content_revision := coalesce(new.content_revision, 1) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists memory_lessons_bump_revision on public.memory_lessons;
create trigger memory_lessons_bump_revision
before update of status, hap_blocks, detailed_explanation, hook, delivery_mode, video_key on public.memory_lessons
for each row execute procedure public.bump_content_revision();

create or replace function public.admin_cms_publish_lesson(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_topic uuid;
begin
  perform public.require_admin();
  update public.memory_lessons
  set status = 'published',
      editorial_status = 'published',
      published_at = coalesce(published_at, now()),
      lock_authored = true,
      updated_at = now()
  where id = p_id
  returning topic_id into v_topic;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_topic is not null then
    update public.topic_catalog
    set content_status = 'published', updated_at = now()
    where id = v_topic;
  end if;
  perform public.write_admin_audit('memory_lesson_cms_publish', 'memory_lesson', p_id::text, '{}'::jsonb);
  return jsonb_build_object('id', p_id, 'status', 'published');
end;
$$;

create or replace function public.get_content_revision()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select content_revision from public.app_runtime_settings where id = 1;
$$;

create or replace function public.get_active_announcements()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (
      select a.id, a.title, a.body, a.bullets, a.platforms, a.display_mode,
             a.primary_label, a.secondary_label, a.start_at, a.end_at,
             r.dismissed_at, r.seen_at
      from public.app_announcements a
      left join public.app_announcement_receipts r
        on r.announcement_id = a.id and r.user_id = v_user
      where a.enabled
        and (a.start_at is null or a.start_at <= now())
        and (a.end_at is null or a.end_at >= now())
        and (
          a.display_mode in ('every_launch', 'until_dismissed', 'until_expiry')
          or r.dismissed_at is null
        )
        and not (a.display_mode = 'once' and r.dismissed_at is not null)
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.dismiss_announcement(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  insert into public.app_announcement_receipts (user_id, announcement_id, seen_at, dismissed_at)
  values (auth.uid(), p_id, now(), now())
  on conflict (user_id, announcement_id)
  do update set dismissed_at = now(), seen_at = coalesce(app_announcement_receipts.seen_at, now());
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.version_less(p_a text, p_b text)
returns boolean
language plpgsql
immutable
as $$
declare
  va int[];
  vb int[];
  i int;
begin
  va := string_to_array(regexp_replace(coalesce(p_a, '0'), '[^0-9.]', '', 'g'), '.')::int[];
  vb := string_to_array(regexp_replace(coalesce(p_b, '0'), '[^0-9.]', '', 'g'), '.')::int[];
  for i in 1..greatest(coalesce(array_length(va, 1), 0), coalesce(array_length(vb, 1), 0)) loop
    if coalesce(va[i], 0) < coalesce(vb[i], 0) then return true; end if;
    if coalesce(va[i], 0) > coalesce(vb[i], 0) then return false; end if;
  end loop;
  return false;
end;
$$;

create or replace function public.get_app_release_status(p_platform text, p_version text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.app_releases%rowtype;
begin
  select * into v_row
  from public.app_releases
  where enabled
    and platform in (p_platform, 'all')
  order by case when platform = p_platform then 0 else 1 end, published_at desc nulls last
  limit 1;
  if not found then
    return jsonb_build_object('action', 'none');
  end if;
  if public.version_less(p_version, v_row.minimum_supported_version) then
    return jsonb_build_object(
      'action', 'force',
      'title', v_row.title,
      'release_notes', v_row.release_notes,
      'store_url', v_row.store_url,
      'latest_version', v_row.latest_version
    );
  end if;
  if public.version_less(p_version, v_row.latest_version) then
    return jsonb_build_object(
      'action', 'optional',
      'title', v_row.title,
      'release_notes', v_row.release_notes,
      'store_url', v_row.store_url,
      'latest_version', v_row.latest_version
    );
  end if;
  return jsonb_build_object('action', 'none', 'latest_version', v_row.latest_version);
end;
$$;

grant execute on function public.match_config() to authenticated;
grant execute on function public.get_content_revision() to authenticated;
grant execute on function public.get_active_announcements() to authenticated;
grant execute on function public.dismiss_announcement(uuid) to authenticated;
grant execute on function public.get_app_release_status(text, text) to authenticated;
grant execute on function public.admin_cms_publish_lesson(uuid) to authenticated;
grant execute on function public.version_less(text, text) to authenticated;

insert into public.app_announcements (title, body, bullets, platforms, display_mode, enabled)
select
  'ÖSYM Koçu yenileniyor 🎉',
  'Müfredat, hap dersler ve sohbet yenileniyor. Bu duyuru test kaydıdır; yayına alınmadan öğrenciye gösterilmez.',
  '["Hap ders CMS","Eşleşme 10-15 sn","Duyuru sistemi"]'::jsonb,
  array['all']::text[],
  'once',
  false
where not exists (
  select 1 from public.app_announcements where title = 'ÖSYM Koçu yenileniyor 🎉'
);

insert into public.app_releases (platform, version, minimum_supported_version, latest_version, title, release_notes, force_update, enabled)
select 'web', '1.0.0', '0.0.1', '1.0.0', 'ÖSYM Koçu', 'Mevcut sürüm.', false, false
where not exists (select 1 from public.app_releases where platform = 'web' and version = '1.0.0');

create or replace function public.admin_map_lesson_exams(p_lesson uuid, p_exam_codes text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canon uuid;
  v_code text;
  v_version uuid;
begin
  perform public.require_admin();
  select canonical_topic_id into v_canon from public.memory_lessons where id = p_lesson;
  if v_canon is null then raise exception 'CANONICAL_TOPIC_REQUIRED'; end if;
  foreach v_code in array coalesce(p_exam_codes, array[]::text[]) loop
    select v.id into v_version
    from public.curriculum_versions v
    join public.exam_catalog e on e.id = v.exam_id
    where e.code = v_code and v.status = 'active'
    order by v.activated_at desc nulls last
    limit 1;
    if v_version is null then
      select v.id into v_version
      from public.curriculum_versions v
      join public.exam_catalog e on e.id = v.exam_id
      where e.code = v_code
      order by v.is_default desc, v.created_at desc
      limit 1;
    end if;
    if v_version is null then continue; end if;
    insert into public.memory_lesson_exam_map (lesson_id, curriculum_version_id, canonical_topic_id, usage_mode, is_active)
    values (p_lesson, v_version, v_canon, 'core', true)
    on conflict (lesson_id, curriculum_version_id) do update
      set is_active = true, canonical_topic_id = excluded.canonical_topic_id;
    insert into public.exam_topic_map (
      curriculum_version_id, canonical_topic_id, included, coverage_mode, depth_level, priority, sort_order
    )
    values (v_version, v_canon, true, 'core', 'standard', 'normal', 0)
    on conflict (curriculum_version_id, canonical_topic_id) do update set included = true;
  end loop;
  perform public.write_admin_audit('memory_lesson_exam_map', 'memory_lesson', p_lesson::text, jsonb_build_object('codes', p_exam_codes));
  return jsonb_build_object('ok', true, 'lesson_id', p_lesson);
end;
$$;

grant execute on function public.admin_map_lesson_exams(uuid, text[]) to authenticated;

insert into public.memory_lessons (
  exam_type, subject, unit, topic, title, slug, description, status, editorial_status,
  delivery_mode, hook, hap_blocks, detailed_explanation, lock_authored, canonical_topic_id,
  published_at, generation_status, fast_rule, minimum_theory
)
select
  'kpss',
  'Tarih',
  'İslamiyet Öncesi Türk Tarihi',
  'Kut',
  'Kut',
  'kut-cms-v1',
  'Hükümdarlık yetkisinin Tanrı tarafından verildiğine inanılması.',
  'published',
  'published',
  'text',
  'Kut neydi?',
  '[{"type":"HAP_BILGI","title":"Hap bilgi","text":"Kut, hükümdarlık yetkisinin Tanrı tarafından verildiğine inanılmasıdır."},{"type":"HATIRLA","title":"Hatırla","text":"Tanrı verir, hükümdar kullanır."}]'::jsonb,
  'Kut, eski Türk devlet anlayışında hükümdarın yönetme yetkisinin Tanrı tarafından verildiğine inanılmasıdır. Bu inanç tahtın meşruiyetini açıklar. Töre kurallar bütünüdür; Kurultay meclistir. Kut bunlarla karıştırılmaz.',
  true,
  ct.id,
  now(),
  'idle',
  'Kut = tanrısal yönetme yetkisi.',
  'Kut, hükümdarlık yetkisinin Tanrı tarafından verildiğine inanılmasıdır.'
from public.canonical_topics ct
where ct.slug in ('kut-anlayisi', 'kut') or lower(ct.name) in ('kut', 'kut anlayışı')
order by case when ct.slug = 'kut-anlayisi' then 0 else 1 end
limit 1
on conflict (slug) do update
  set delivery_mode = excluded.delivery_mode,
      hook = excluded.hook,
      hap_blocks = excluded.hap_blocks,
      detailed_explanation = excluded.detailed_explanation,
      lock_authored = true,
      editorial_status = 'published',
      status = 'published',
      published_at = coalesce(public.memory_lessons.published_at, now());

insert into public.memory_lesson_questions (
  lesson_id, question_type, question_order, question_text, options, correct_answer, explanation
)
select l.id, 'checkpoint', 1,
  'Kut neyi ifade eder?',
  '[{"key":"A","text":"Ordu düzenini"},{"key":"B","text":"Hükümdarlık yetkisinin Tanrı tarafından verildiğine inanılması"},{"key":"C","text":"Kurultay kararını"},{"key":"D","text":"Töre kurallarını"}]'::jsonb,
  'B',
  'Kut = tanrısal yönetme yetkisi.'
from public.memory_lessons l
where l.slug = 'kut-cms-v1'
  and not exists (
    select 1 from public.memory_lesson_questions q where q.lesson_id = l.id and q.question_order = 1
  );

insert into public.memory_lesson_exam_map (lesson_id, curriculum_version_id, canonical_topic_id, usage_mode, is_active)
select l.id, v.id, l.canonical_topic_id, 'core', true
from public.memory_lessons l
join public.curriculum_versions v on true
join public.exam_catalog e on e.id = v.exam_id
where l.slug = 'kut-cms-v1'
  and l.canonical_topic_id is not null
  and e.code in ('KPSS_LISANS', 'KPSS_ONLISANS')
on conflict (lesson_id, curriculum_version_id) do update set is_active = true;

insert into public.lesson_packages (canonical_unit_id, title, sort_order, review_question_count, status)
select cu.id, 'İslamiyet Öncesi Türk Tarihi · 1. paket', 1, 5, 'published'
from public.canonical_units cu
where cu.slug = 'islamiyet-oncesi-turk-tarihi'
  and not exists (select 1 from public.lesson_packages p where p.canonical_unit_id = cu.id)
limit 1;

insert into public.lesson_package_items (package_id, canonical_topic_id, sort_order)
select p.id, ct.id, row_number() over (order by ct.name)
from public.lesson_packages p
join public.canonical_units cu on cu.id = p.canonical_unit_id
join public.canonical_topics ct on ct.canonical_unit_id = cu.id
where cu.slug = 'islamiyet-oncesi-turk-tarihi'
  and p.title = 'İslamiyet Öncesi Türk Tarihi · 1. paket'
  and not exists (
    select 1 from public.lesson_package_items i where i.package_id = p.id and i.canonical_topic_id = ct.id
  )
limit 5;

update public.memory_lessons l
set
  topic_id = x.topic_id,
  unit_id = x.unit_id,
  subject_id = x.subject_id,
  exam_id = x.exam_id
from (
  select tc.id as topic_id, uc.id as unit_id, sc.id as subject_id, sc.exam_id, tc.canonical_topic_id
  from public.topic_catalog tc
  join public.unit_catalog uc on uc.id = tc.unit_id
  join public.subject_catalog sc on sc.id = uc.subject_id
  join public.exam_catalog e on e.id = sc.exam_id
  where e.code = 'KPSS_LISANS'
) x
where l.slug = 'kut-cms-v1'
  and l.canonical_topic_id = x.canonical_topic_id;
