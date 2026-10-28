-- 3-tier virtual student AI budget. Default is deterministic (Tier 1). LLM is capped.

create table if not exists public.virtual_ai_budget_policy (
  id int primary key default 1 check (id = 1),
  global_daily_ai_calls int not null default 24,
  per_profile_daily_ai_calls int not null default 2,
  tier2_share_target numeric not null default 0.20,
  tier3_share_target numeric not null default 0.05,
  cheap_task_type text not null default 'bot_conversation',
  strong_task_type text not null default 'lesson_generation',
  wake_secret text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.virtual_ai_budget_policy (id)
values (1)
on conflict (id) do nothing;

do $$
begin
  update public.virtual_ai_budget_policy p
  set wake_secret = coalesce(p.wake_secret, s.wake_secret)
  from public.content_factory_settings s
  where p.id = 1 and s.id = 1 and p.wake_secret is null;
exception
  when undefined_table then null;
end $$;

alter table public.virtual_ai_budget_policy enable row level security;

create table if not exists public.virtual_activity_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  activity_type text not null,
  ai_tier int not null default 1 check (ai_tier in (1, 2, 3)),
  tokens int not null default 0,
  cost_class text not null default 'none' check (cost_class in ('none', 'low', 'medium', 'high')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists virtual_activity_events_day_idx
  on public.virtual_activity_events (created_at desc);
create index if not exists virtual_activity_events_type_idx
  on public.virtual_activity_events (activity_type, created_at desc);

alter table public.virtual_activity_events enable row level security;

create table if not exists public.virtual_ai_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  activity_type text not null,
  requested_tier int not null check (requested_tier in (2, 3)),
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'fallback_t1', 'rejected')),
  context jsonb not null default '{}'::jsonb,
  result_text text,
  tokens int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists virtual_ai_requests_due_idx
  on public.virtual_ai_requests (status, created_at)
  where status = 'queued';

alter table public.virtual_ai_requests enable row level security;

create table if not exists public.virtual_speech_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  body text not null,
  unique (kind, body)
);

alter table public.virtual_speech_templates enable row level security;

insert into public.virtual_speech_templates (kind, body) values
  ('greeting', 'selam millet'),
  ('greeting', 'selamlar'),
  ('greeting', 'herkese merhaba'),
  ('greeting', 'hoş geldin'),
  ('greeting', 'hoşgeldiniz ya'),
  ('greeting', 'napıyosunuz'),
  ('greeting', 'naptınız bugün'),
  ('greeting', 'ben yeni başladım'),
  ('greeting', 'yeni geldim idare'),
  ('greeting', 'geç kaldım biraz'),
  ('greeting', 'ben de geldim'),
  ('greeting', 'masa açıldı mı'),
  ('reaction', 'hm idare'),
  ('reaction', 'dur bakim'),
  ('reaction', 'tamam ya'),
  ('reaction', 'anladım'),
  ('reaction', 'olur öyle'),
  ('reaction', 'sessiz devam'),
  ('followup', 'tempo nasıl'),
  ('followup', 'hangi setteydin'),
  ('followup', 'kolay mıydı o'),
  ('followup', 'mola verdin mi'),
  ('followup', 'net tuttu mu'),
  ('progress', 'kısa set tuttum idare'),
  ('progress', 'tempo düşük ama durmadım'),
  ('progress', 'bugün kısa tuttum'),
  ('progress', 'seti yarıda kestim'),
  ('break', 'çay koyup döndüm şimdi'),
  ('break', 'kısa mola, geliyorum'),
  ('break', 'kapatıp su içtim'),
  ('status', 'ders tekrarındayım'),
  ('status', 'soru çözüyorum şimdi'),
  ('status', 'bugünkü hedefe yürüyorum'),
  ('status', 'mola sonrası devam'),
  ('comment', 'devam et, tempo iyi duruyor'),
  ('comment', 'aynı setteyim, sonlar ağırdı'),
  ('comment', 'hangi konu zorladı tam'),
  ('comment', 'net tutarsa yeter'),
  ('comment', 'kısa tutunca oturuyor bende'),
  ('room', 'oda açıksa ben de bakayım'),
  ('room', 'beraber kısa set bakarız'),
  ('room', 'ben de odaya geçiyom')
on conflict (kind, body) do nothing;

update public.ai_model_config
set primary_model = 'gpt-4o-mini',
    fallback_model = 'gpt-4o-mini',
    economy_model = 'gpt-4o-mini',
    quality_tier = 'economy',
    estimated_cost_class = 'low',
    notes = coalesce(notes, '') || ' Virtual Tier 2: cheap chat.'
where task_type in ('bot_conversation', 'social_post_generation', 'social_comment_generation');

create or replace function public.virtual_ai_istanbul_today()
returns date
language sql
stable
as $$
  select (timezone('Europe/Istanbul', now()))::date;
$$;

create or replace function public.virtual_ai_calls_today()
returns int
language sql
stable
as $$
  select count(*)::int
  from public.virtual_activity_events
  where ai_tier >= 2
    and (timezone('Europe/Istanbul', created_at))::date = public.virtual_ai_istanbul_today();
$$;

create or replace function public.virtual_ai_calls_today_profile(p_profile uuid)
returns int
language sql
stable
as $$
  select count(*)::int
  from public.virtual_activity_events
  where ai_tier >= 2
    and profile_id = p_profile
    and (timezone('Europe/Istanbul', created_at))::date = public.virtual_ai_istanbul_today();
$$;

create or replace function public.virtual_log_activity(
  p_profile uuid,
  p_activity text,
  p_tier int default 1,
  p_tokens int default 0,
  p_cost text default 'none',
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.virtual_activity_events (profile_id, activity_type, ai_tier, tokens, cost_class, reason)
  values (p_profile, p_activity, greatest(1, least(coalesce(p_tier, 1), 3)), coalesce(p_tokens, 0), coalesce(p_cost, 'none'), p_reason);
end;
$$;

create or replace function public.virtual_activity_never_ai(p_activity text)
returns boolean
language sql
immutable
as $$
  select p_activity in (
    'solve_test', 'join_room', 'create_room', 'social_like',
    'study_lesson', 'review_topic', 'take_system_exam', 'presence', 'xp'
  );
$$;

create or replace function public.virtual_human_needs_reason(p_body text)
returns boolean
language sql
immutable
as $$
  select length(trim(coalesce(p_body, ''))) >= 18
     and coalesce(p_body, '') ~* '(neden|nasıl|nasil|açıkla|acikla|anlamadım|anlamadim|formül|turev|türev|integral|ispat|fark ne)';
$$;

create or replace function public.virtual_ai_allow(
  p_profile uuid,
  p_activity text,
  p_requested_tier int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pol public.virtual_ai_budget_policy%rowtype;
  v_tier int := greatest(1, least(coalesce(p_requested_tier, 1), 3));
begin
  select * into v_pol from public.virtual_ai_budget_policy where id = 1;
  if public.virtual_activity_never_ai(p_activity) then
    return jsonb_build_object('allowed', false, 'tier', 1, 'reason', 'NEVER_AI');
  end if;
  if v_tier <= 1 then
    return jsonb_build_object('allowed', false, 'tier', 1, 'reason', 'TIER1');
  end if;
  if not found or not v_pol.enabled then
    return jsonb_build_object('allowed', false, 'tier', 1, 'reason', 'POLICY_OFF');
  end if;
  if public.virtual_ai_calls_today() >= v_pol.global_daily_ai_calls then
    return jsonb_build_object('allowed', false, 'tier', 1, 'reason', 'GLOBAL_CAP');
  end if;
  if public.virtual_ai_calls_today_profile(p_profile) >= v_pol.per_profile_daily_ai_calls then
    return jsonb_build_object('allowed', false, 'tier', 1, 'reason', 'PROFILE_CAP');
  end if;
  if v_tier = 3 and public.virtual_ai_calls_today()::numeric > v_pol.global_daily_ai_calls * v_pol.tier3_share_target then
    v_tier := 2;
  end if;
  return jsonb_build_object('allowed', true, 'tier', v_tier, 'reason', 'OK', 'task', case when v_tier = 3 then v_pol.strong_task_type else v_pol.cheap_task_type end);
end;
$$;

create or replace function public.virtual_speech_pick(
  p_kind text,
  p_slug text default null,
  p_profile uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_body text;
  rec record;
begin
  for rec in
    select body from public.virtual_speech_templates where kind = p_kind order by random() limit 16
  loop
    v_body := rec.body;
    if p_slug is not null and public.group_line_too_similar(p_slug, v_body) then
      continue;
    end if;
    if p_profile is not null and exists (
      select 1 from public.social_posts sp
      where sp.user_id = p_profile and sp.body = v_body and sp.created_at > now() - interval '12 hours'
    ) then
      continue;
    end if;
    return v_body;
  end loop;
  return null;
end;
$$;

create or replace function public.virtual_enqueue_ai_request(
  p_profile uuid,
  p_activity text,
  p_tier int,
  p_context jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate jsonb;
  v_id uuid;
begin
  v_gate := public.virtual_ai_allow(p_profile, p_activity, p_tier);
  if coalesce(v_gate->>'allowed', '') <> 'true' then
    return null;
  end if;
  insert into public.virtual_ai_requests (profile_id, activity_type, requested_tier, context)
  values (p_profile, p_activity, (v_gate->>'tier')::int, coalesce(p_context, '{}'::jsonb) || jsonb_build_object('gate', v_gate))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.virtual_try_social_post(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.virtual_student_profiles%rowtype;
  v_topic text;
  v_n int;
  v_ok int;
  v_body text;
  v_post uuid;
  v_mod text;
  v_kind text;
begin
  select * into v_prof from public.virtual_student_profiles where profile_id = p_profile;
  if not found then return jsonb_build_object('ok', false, 'reason', 'PROFILE_DISABLED', 'ai_tier', 1); end if;
  perform public.set_virtual_presence(p_profile, 'social', v_prof.current_subject_id, v_prof.current_topic_id, null, 8);

  select value->>'topic', (value->>'wrong')::int, (value->>'correct')::int
  into v_topic, v_n, v_ok
  from public.virtual_student_memory
  where profile_id = p_profile and memory_type = 'recent_test'
  order by updated_at desc limit 1;

  v_kind := (array['greeting','status','progress','break'])[1 + floor(random() * 4)::int];
  v_body := public.virtual_speech_pick(v_kind, null, p_profile);
  if v_body is null and v_topic is not null then
    v_body := coalesce(v_topic, 'Konu') || 'de ' || coalesce(v_ok, 0)::text || ' doğru ' || coalesce(v_n, 0)::text || ' yanlış.';
  end if;
  if v_body is null then
    select t.name into v_topic from public.topics t where t.id = v_prof.current_topic_id;
    v_body := coalesce(v_topic, 'Ders') || ' tekrarındayım.';
  end if;

  v_mod := public.content_moderation_level(v_body);
  if v_mod = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED', 'body', v_body, 'ai_tier', 1);
  end if;
  if exists (
    select 1 from public.social_posts sp
    where sp.user_id = p_profile and public.exam_chat_skeleton(sp.body) = public.exam_chat_skeleton(v_body)
      and sp.created_at > now() - interval '12 hours'
  ) then
    v_body := public.virtual_speech_pick('status', null, p_profile);
    if v_body is null then
      return jsonb_build_object('ok', false, 'reason', 'DUPLICATE_REJECTED', 'ai_tier', 1);
    end if;
  end if;

  insert into public.social_posts (user_id, body, kind, subject_id, duration_minutes, expires_at, topic_id)
  values (p_profile, v_body, 'status', v_prof.current_subject_id, 60, now() + interval '18 hours', v_prof.current_topic_id)
  returning id into v_post;
  perform public.remember_virtual_fact(
    p_profile, 'recent_post', 'last', jsonb_build_object('body', v_body, 'post_id', v_post), interval '48 hours'
  );
  perform public.virtual_log_activity(p_profile, 'social_post', 1, 0, 'none', 'template');
  return jsonb_build_object('ok', true, 'post_id', v_post, 'body', v_body, 'reason', 'INSERTED', 'ai_tier', 1);
end;
$$;

create or replace function public.virtual_try_social_comment(p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post uuid;
  v_src text;
  v_body text;
begin
  perform public.set_virtual_presence(p_profile, 'social', null, null, null, 6);
  select p.id, p.body into v_post, v_src
  from public.social_posts p
  where (p.expires_at is null or p.expires_at > now())
    and p.user_id <> p_profile
  order by p.created_at desc
  limit 1;
  if v_post is null then
    return jsonb_build_object('ok', false, 'reason', 'NO_POST', 'ai_tier', 1);
  end if;
  if v_src ~* 'yanlış' then
    v_body := coalesce(public.virtual_speech_pick('followup', null, p_profile), 'hangi konu zorladı tam');
  else
    v_body := coalesce(public.virtual_speech_pick('comment', null, p_profile), 'devam et, tempo iyi duruyor');
  end if;
  if public.content_moderation_level(v_body) = 'block' then
    return jsonb_build_object('ok', false, 'reason', 'MODERATION_REJECTED', 'ai_tier', 1);
  end if;
  insert into public.post_comments (post_id, user_id, body)
  values (v_post, p_profile, v_body);
  perform public.virtual_log_activity(p_profile, 'social_comment', 1, 0, 'none', 'template');
  return jsonb_build_object('ok', true, 'ai_tier', 1, 'body', v_body);
end;
$$;

create or replace function public.exam_chat_quality_fail(
  p_slug text,
  p_bot uuid,
  p_body text,
  p_prev text,
  p_thread text,
  p_intent text
)
returns boolean
language plpgsql
stable
as $$
begin
  if public.exam_chat_banned(p_body) then return true; end if;
  if public.group_line_too_similar(p_slug, p_body) then return true; end if;
  if coalesce(p_prev, '') <> '' and public.exam_chat_echoes_prev(p_body, p_prev) then
    return true;
  end if;
  if p_intent in ('greet', 'break', 'newcomer') then
    return false;
  end if;
  if p_intent in ('react', 'agree', 'ask_followup', 'own_experience') then
    return public.exam_chat_vague(p_body, p_prev) and public.exam_chat_words(p_body) > 8;
  end if;
  if p_intent in ('change_topic', 'invite_to_room', 'joke') then
    if p_intent = 'change_topic' and not public.exam_chat_has_bridge(p_body) then return true; end if;
    return false;
  end if;
  return public.exam_chat_vague(p_body, p_prev);
end;
$$;

create or replace function public.exam_chat_compose(
  p_slug text,
  p_bot uuid,
  p_attempt int,
  p_intent text,
  p_thread text,
  p_reply_body text,
  p_reply_name text
)
returns text
language plpgsql
as $$
declare
  v_voice text := public.exam_chat_voice(p_bot);
  v_mem public.exam_bot_memory;
  v_intent text := coalesce(p_intent, 'react');
  v_thread text := coalesce(p_thread, 'genel');
  v_title text;
  v_from text;
  v_line text;
  v_choices text[];
  i int;
begin
  v_mem := public.exam_chat_ensure_memory(p_bot, p_slug);
  v_title := public.exam_chat_thread_title(p_slug, v_thread);
  v_from := coalesce(
    public.exam_chat_thread_title(p_slug, public.exam_chat_thread_from_text(p_slug, p_reply_body)),
    (select public.exam_chat_thread_title(p_slug, current_thread) from public.exam_chat_room_state where slug = p_slug),
    'matematik'
  );
  if v_from = v_title then v_from := 'önceki set'; end if;
  if p_attempt > 1 and v_intent not in ('greet', 'break', 'newcomer') then
    v_intent := (array['ask_followup','react','own_experience','share_progress','joke'])[1 + ((p_attempt - 1) % 5)];
  end if;
  if v_intent = 'share_progress' and public.exam_chat_progress_blocked(p_bot, p_slug) then
    v_intent := 'own_experience';
  end if;

  if v_intent in ('greet', 'newcomer') then
    v_choices := array[
      'selam millet','selamlar','herkese merhaba','hoş geldin','napıyosunuz',
      'ben yeni başladım','yeni geldim idare','ben de geldim','geç kaldım biraz'
    ];
  elsif v_intent = 'break' then
    v_choices := array['çay koyup döndüm şimdi','kısa mola, geliyorum','kapatıp su içtim'];
  elsif v_intent = 'ask_followup' then
    v_choices := array[
      'tempo nasıl?','hangi setteydin','kolay mıydı o','kitaptan mı bakıyosun',
      'video mu çözdün','sen neredesin şimdi','kaçıncı sorudasın','oturdu mu sende',
      'kaynak değiştin mi','net tuttu mu','süre yetti mi','mola verdin mi'
    ];
  elsif v_intent = 'own_experience' then
    v_choices := array[
      'bende tempo başka bugün', v_title || ' tarafında takıldım biraz',
      'kısa set tuttum idare','kafam dağınık az önce','video çözüp kestim',
      'ben ayrı yerdeyim bugün','çay koyup döndüm şimdi'
    ];
  elsif v_intent in ('react','agree') then
    v_choices := array[
      'hm idare','dur bakim','tamam ya','olay bu kadar','ben saldım biraz',
      'bugün hiç gitmiyor','sessiz devam','anladım ya','idare ediyor'
    ];
  elsif v_intent in ('change_topic','shift_topic') then
    v_choices := array[
      v_from || ' baydı, ' || v_title || 'ye geçtim biraz',
      v_from || ' tıkanınca ' || v_title || ' açtım',
      'biraz ' || v_from || ' bıraktım, ' || v_title || ' bakıyorum'
    ];
  elsif v_intent = 'share_progress' then
    v_choices := array[
      v_title || ' tarafı ağır geldi bugün','tempo düşük ama durmadım',
      'seti yarıda kestim idare','az kaldı kestim bugün','bugün kısa tuttum bitirdim'
    ];
  elsif v_intent in ('continue_previous','continue_topic','answer','answer_question') then
    v_choices := array['kısa tutunca bende oturuyor','devam ediyom sessiz','idare, komple salmadım'];
  elsif v_intent = 'encourage' then
    v_choices := array['kısa tut yeter','tempo gelir','devam et bence'];
  elsif v_intent = 'joke' then
    v_choices := array['ders bugün kişisel algıdı','kapatıp çay koyucam nerdeyse','abartmayayım olay bu'];
  else
    v_choices := array['hm ya','dur bakim','idare bugün','sessizim biraz'];
  end if;

  v_line := null;
  for i in 0..array_length(v_choices, 1) + 6 loop
    v_line := v_choices[1 + ((p_attempt + i + floor(random() * 11)::int) % array_length(v_choices, 1))];
    v_line := public.exam_chat_texture(v_voice, v_line);
    if v_line is not null
      and public.exam_chat_skeleton(v_line) <> 'came_to_mind'
      and not public.exam_chat_quality_fail(p_slug, p_bot, v_line, p_reply_body, v_thread, v_intent) then
      exit;
    end if;
    v_line := null;
  end loop;
  if v_line is null then
    v_line := public.virtual_speech_pick(case when v_intent in ('greet','newcomer') then 'greeting' when v_intent = 'break' then 'break' else 'reaction' end, p_slug, p_bot);
  end if;
  if v_line is null then return null; end if;

  update public.exam_bot_memory
  set recent = (ARRAY[v_line] || coalesce(recent, '{}'::text[]))[1:8],
      last_meaning = v_line,
      updated_at = now()
  where bot_id = p_bot and slug = p_slug;
  return v_line;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pulse_exam_chats'
      and not exists (select 1 from pg_proc x join pg_namespace n2 on n2.oid = x.pronamespace where n2.nspname = 'public' and x.proname = 'pulse_exam_chats_core')
  ) then
    execute 'alter function public.pulse_exam_chats(boolean, text) rename to pulse_exam_chats_core';
  end if;
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'virtual_run_job'
      and not exists (select 1 from pg_proc x join pg_namespace n2 on n2.oid = x.pronamespace where n2.nspname = 'public' and x.proname = 'virtual_run_job_core')
  ) then
    execute 'alter function public.virtual_run_job(uuid) rename to virtual_run_job_core';
  end if;
end $$;

create or replace function public.pulse_exam_chats(p_force boolean default false, p_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_slug text;
  v_bot uuid;
  v_prev uuid;
  v_prev_body text;
  v_prev_bot boolean := false;
  v_line text;
  v_id uuid;
  v_req uuid;
begin
  v := public.pulse_exam_chats_core(p_force, p_slug);
  if coalesce(v->>'ok', '') = 'true' then
    return v;
  end if;
  if v->>'reason' is distinct from 'DUPLICATE_REJECTED' then
    return v;
  end if;
  v_slug := coalesce(p_slug, v->>'slug');
  if v_slug is null then return v; end if;

  select m.sender_id, m.body, coalesce(pr.is_bot, false)
  into v_prev, v_prev_body, v_prev_bot
  from public.exam_chat_messages m
  join public.profiles pr on pr.id = m.sender_id
  where m.slug = v_slug
  order by m.created_at desc
  limit 1;

  select x into v_bot
  from unnest(public.exam_chat_pick_bots(v_slug, 3)) as x
  where x is distinct from v_prev
  order by random()
  limit 1;
  if v_bot is null then
    return v;
  end if;

  if v_prev is not null and not v_prev_bot and public.virtual_human_needs_reason(v_prev_body) then
    v_req := public.virtual_enqueue_ai_request(
      v_bot, 'group_chat', 3,
      jsonb_build_object('slug', v_slug, 'reply_to', v_prev, 'prev_body', v_prev_body)
    );
    if v_req is not null then
      return jsonb_build_object('ok', true, 'reason', 'AI_QUEUED', 'slug', v_slug, 'request_id', v_req, 'ai_tier', 3);
    end if;
  end if;

  v_line := public.exam_chat_compose(v_slug, v_bot, 1, 'greet', 'genel', v_prev_body, null);
  if v_line is null then
    v_line := public.virtual_speech_pick('greeting', v_slug, v_bot);
  end if;
  if v_line is null then
    v_line := public.virtual_speech_pick('reaction', v_slug, v_bot);
  end if;
  if v_line is null then
    return v;
  end if;
  insert into public.exam_chat_members (slug, user_id) values (v_slug, v_bot) on conflict do nothing;
  insert into public.exam_chat_messages (slug, sender_id, body, created_at)
  values (v_slug, v_bot, v_line, clock_timestamp())
  returning id into v_id;
  perform public.virtual_log_activity(v_bot, 'group_chat', 1, 0, 'none', 'rescue_template');
  return jsonb_build_object('ok', true, 'reason', 'MESSAGE_INSERTED', 'slug', v_slug, 'message_id', v_id, 'intent', 'greet', 'body', v_line, 'ai_tier', 1);
end;
$$;

create or replace function public.virtual_run_job(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.virtual_student_activity_jobs%rowtype;
  v jsonb;
  v_prev_body text;
  v_prev uuid;
  v_human boolean := false;
  v_req uuid;
  v_slug text;
begin
  select * into v_job from public.virtual_student_activity_jobs where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'missing'); end if;

  if v_job.activity_type = 'social_comment' and v_job.status in ('queued', 'running') then
    update public.virtual_student_activity_jobs
    set status = 'running', attempt_count = attempt_count + 1, updated_at = now()
    where id = p_id;
    v := public.virtual_try_social_comment(v_job.profile_id);
    update public.virtual_student_activity_jobs
    set status = 'completed', completed_at = now(), updated_at = now(),
        context = coalesce(context, '{}'::jsonb) || jsonb_build_object('social', v, 'ai_tier', 1)
    where id = p_id;
    return v;
  end if;

  v := public.virtual_run_job_core(p_id);

  if v_job.activity_type in ('solve_test', 'join_room', 'create_room', 'social_like', 'study_lesson', 'review_topic', 'take_system_exam') then
    perform public.virtual_log_activity(v_job.profile_id, v_job.activity_type, 1, 0, 'none', 'never_ai');
  elsif v_job.activity_type in ('social_post', 'update_status', 'room_chat', 'group_chat') then
    perform public.virtual_log_activity(v_job.profile_id, v_job.activity_type, 1, 0, 'none', 'template');
  end if;

  if v_job.activity_type = 'group_chat' then
    select m.sender_id, m.body, coalesce(pr.is_bot, false) = false, m.slug
    into v_prev, v_prev_body, v_human, v_slug
    from public.exam_chat_messages m
    join public.profiles pr on pr.id = m.sender_id
    order by m.created_at desc
    limit 1;
    if v_human and public.virtual_human_needs_reason(v_prev_body) then
      v_req := public.virtual_enqueue_ai_request(
        v_job.profile_id, 'group_chat', 3,
        jsonb_build_object('slug', v_slug, 'prev_body', v_prev_body, 'reply_to', v_prev)
      );
      if v_req is not null then
        v := coalesce(v, '{}'::jsonb) || jsonb_build_object('ai_queued', v_req);
      end if;
    end if;
  end if;
  return v;
end;
$$;

create or replace function public.virtual_enqueue_jobs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg public.virtual_student_engine_settings;
  v_n int := 0;
  rec record;
  v_type text;
  v_roll numeric;
  v_cap int;
begin
  select * into v_cfg from public.virtual_student_engine_settings where id = 1;
  if not v_cfg.virtual_students_enabled then return 0; end if;
  if public.virtual_human_share() > coalesce(v_cfg.target_virtual_share, 0.35) then
    return 0;
  end if;

  for rec in
    select v.* from public.virtual_student_profiles v
    where v.is_enabled
  loop
    if not public.virtual_profile_is_active(rec.profile_id) then
      perform public.set_virtual_presence(rec.profile_id, 'offline');
      continue;
    end if;
    if exists (
      select 1 from public.virtual_student_activity_jobs j
      where j.profile_id = rec.profile_id and j.status in ('queued', 'running')
    ) then
      continue;
    end if;

    v_roll := random();
    if v_roll < 0.22 then v_type := 'solve_test';
    elsif v_roll < 0.40 then v_type := 'study_lesson';
    elsif v_roll < 0.55 then v_type := 'social_like';
    elsif v_roll < 0.68 then v_type := 'group_chat';
    elsif v_roll < 0.78 then v_type := 'join_room';
    elsif v_roll < 0.86 then v_type := 'review_topic';
    elsif v_roll < 0.92 then v_type := 'social_comment';
    elsif v_roll < 0.97 then v_type := 'room_chat';
    else v_type := 'social_post';
    end if;

    if rec.social_activity_level = 'low' and v_type in ('social_post', 'social_comment', 'room_chat') then
      v_type := 'social_like';
    end if;
    if v_type in ('social_post', 'update_status') then
      v_cap := public.virtual_social_day_cap(rec.social_activity_level);
      if public.virtual_social_posts_today(rec.profile_id) >= v_cap then
        v_type := 'group_chat';
      end if;
    end if;

    insert into public.virtual_student_activity_jobs (profile_id, activity_type, scheduled_for, context)
    values (
      rec.profile_id, v_type, now() + make_interval(secs => 20 + floor(random() * 240)::int),
      jsonb_build_object('exam_id', rec.exam_id, 'ai_tier', 1)
    );
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.virtual_ai_pending(p_limit int default 3)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at)
    from (
      select id, profile_id, activity_type, requested_tier, context, created_at
      from public.virtual_ai_requests
      where status = 'queued'
      order by created_at
      limit greatest(1, least(coalesce(p_limit, 3), 5))
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.virtual_ai_apply_result(
  p_id uuid,
  p_text text,
  p_tokens int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.virtual_ai_requests%rowtype;
  v_slug text;
  v_mid uuid;
begin
  select * into v from public.virtual_ai_requests where id = p_id for update;
  if not found or v.status not in ('queued', 'running') then
    return jsonb_build_object('ok', false, 'reason', 'MISSING');
  end if;
  if public.content_moderation_level(p_text) = 'block' or length(trim(coalesce(p_text, ''))) < 2 then
    return public.virtual_ai_fallback_tier1(p_id);
  end if;
  v_slug := coalesce(v.context->>'slug', 'kpss');
  if v_slug is not null and public.group_line_too_similar(v_slug, p_text) then
    return public.virtual_ai_fallback_tier1(p_id);
  end if;
  if v.activity_type = 'group_chat' then
    insert into public.exam_chat_members (slug, user_id) values (v_slug, v.profile_id) on conflict do nothing;
    insert into public.exam_chat_messages (slug, sender_id, body, created_at, reply_to_id)
    values (
      v_slug, v.profile_id, trim(p_text), clock_timestamp(),
      nullif(v.context->>'reply_to', '')::uuid
    )
    returning id into v_mid;
  elsif v.activity_type = 'social_comment' then
    insert into public.post_comments (post_id, user_id, body)
    values ((v.context->>'post_id')::uuid, v.profile_id, trim(p_text));
  end if;
  update public.virtual_ai_requests
  set status = 'completed', result_text = trim(p_text), tokens = coalesce(p_tokens, 0), completed_at = now()
  where id = p_id;
  perform public.virtual_log_activity(
    v.profile_id, v.activity_type, v.requested_tier, coalesce(p_tokens, 0),
    case when v.requested_tier = 3 then 'high' else 'low' end, 'llm'
  );
  return jsonb_build_object('ok', true, 'message_id', v_mid, 'tier', v.requested_tier);
end;
$$;

create or replace function public.virtual_ai_fallback_tier1(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.virtual_ai_requests%rowtype;
  v_line text;
  v_slug text;
  v_mid uuid;
begin
  select * into v from public.virtual_ai_requests where id = p_id for update;
  if not found then return jsonb_build_object('ok', false); end if;
  v_slug := coalesce(v.context->>'slug', 'kpss');
  v_line := coalesce(
    public.virtual_speech_pick('followup', v_slug, v.profile_id),
    public.virtual_speech_pick('greeting', v_slug, v.profile_id),
    'tempo nasıl'
  );
  if v.activity_type = 'group_chat' then
    insert into public.exam_chat_members (slug, user_id) values (v_slug, v.profile_id) on conflict do nothing;
    insert into public.exam_chat_messages (slug, sender_id, body, created_at)
    values (v_slug, v.profile_id, v_line, clock_timestamp())
    returning id into v_mid;
  end if;
  update public.virtual_ai_requests
  set status = 'fallback_t1', result_text = v_line, completed_at = now()
  where id = p_id;
  perform public.virtual_log_activity(v.profile_id, v.activity_type, 1, 0, 'none', 'cap_or_fallback');
  return jsonb_build_object('ok', true, 'tier', 1, 'message_id', v_mid, 'body', v_line);
end;
$$;

create or replace function public.virtual_ai_timeout_to_tier1()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  n int := 0;
begin
  for rec in
    select id from public.virtual_ai_requests
    where status = 'queued' and created_at < now() - interval '90 seconds'
  loop
    perform public.virtual_ai_fallback_tier1(rec.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.admin_virtual_ai_budget()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public.virtual_ai_istanbul_today();
  v_pol public.virtual_ai_budget_policy%rowtype;
begin
  perform public.require_admin();
  select * into v_pol from public.virtual_ai_budget_policy where id = 1;
  return jsonb_build_object(
    'policy', to_jsonb(v_pol) - 'wake_secret',
    'ai_calls_today', public.virtual_ai_calls_today(),
    'estimated_tokens_today', (
      select coalesce(sum(tokens), 0)::int from public.virtual_activity_events
      where (timezone('Europe/Istanbul', created_at))::date = v_today
    ),
    'ai_calls_by_activity', coalesce((
      select jsonb_object_agg(activity_type, n)
      from (
        select activity_type, count(*)::int as n
        from public.virtual_activity_events
        where ai_tier >= 2 and (timezone('Europe/Istanbul', created_at))::date = v_today
        group by 1
      ) s
    ), '{}'::jsonb),
    'tier_mix_today', coalesce((
      select jsonb_build_object(
        't1', count(*) filter (where ai_tier = 1),
        't2', count(*) filter (where ai_tier = 2),
        't3', count(*) filter (where ai_tier = 3)
      )
      from public.virtual_activity_events
      where (timezone('Europe/Istanbul', created_at))::date = v_today
    ), jsonb_build_object('t1', 0, 't2', 0, 't3', 0)),
    'queued_ai', (select count(*)::int from public.virtual_ai_requests where status = 'queued'),
    'cost_class_today', coalesce((
      select jsonb_object_agg(cost_class, n)
      from (
        select cost_class, count(*)::int as n
        from public.virtual_activity_events
        where (timezone('Europe/Istanbul', created_at))::date = v_today
        group by 1
      ) s
    ), '{}'::jsonb)
  );
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'virtual_student_engine_tick'
      and pg_get_function_identity_arguments(p.oid) = ''
      and not exists (
        select 1 from pg_proc x join pg_namespace n2 on n2.oid = x.pronamespace
        where n2.nspname = 'public' and x.proname = 'virtual_student_engine_tick_core'
      )
  ) then
    execute 'alter function public.virtual_student_engine_tick() rename to virtual_student_engine_tick_core';
  end if;
end $$;

create or replace function public.virtual_student_engine_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  v_fb int := 0;
begin
  v := public.virtual_student_engine_tick_core();
  v_fb := public.virtual_ai_timeout_to_tier1();
  return coalesce(v, '{}'::jsonb) || jsonb_build_object('ai_fallback', v_fb, 'ai_queued', (select count(*)::int from public.virtual_ai_requests where status = 'queued'));
end;
$$;

grant execute on function public.pulse_exam_chats(boolean, text) to authenticated;
grant execute on function public.pulse_exam_chats(boolean, text) to service_role;
grant execute on function public.virtual_run_job(uuid) to service_role;
grant execute on function public.virtual_student_engine_tick() to service_role;
grant execute on function public.virtual_ai_pending(int) to service_role;
grant execute on function public.virtual_ai_apply_result(uuid, text, int) to service_role;
grant execute on function public.virtual_ai_fallback_tier1(uuid) to service_role;
grant execute on function public.virtual_ai_allow(uuid, text, int) to service_role;
grant execute on function public.admin_virtual_ai_budget() to authenticated;
