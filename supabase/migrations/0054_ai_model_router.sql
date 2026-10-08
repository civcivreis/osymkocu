-- Phase 3C: central AI model router / cost-quality policy. No content regeneration.

create table if not exists public.ai_model_config (
  id uuid primary key default gen_random_uuid(),
  task_type text not null unique,
  provider text not null default 'openai',
  primary_model text not null,
  fallback_model text,
  economy_model text,
  premium_model text,
  quality_tier text not null default 'balanced'
    check (quality_tier in ('economy', 'balanced', 'premium')),
  minimum_quality_tier text not null default 'economy'
    check (minimum_quality_tier in ('economy', 'balanced', 'premium')),
  max_output_tokens integer,
  temperature numeric,
  reasoning_effort text,
  is_enabled boolean not null default true,
  estimated_cost_class text not null default 'medium'
    check (estimated_cost_class in ('low', 'medium', 'high')),
  notes text,
  config_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_model_config enable row level security;

create table if not exists public.ai_runtime_settings (
  id int primary key default 1 check (id = 1),
  mode text not null default 'balanced'
    check (mode in ('economy', 'balanced', 'premium')),
  max_daily_ai_jobs int,
  max_daily_image_jobs int,
  max_daily_tts_jobs int,
  tts_voice text not null default 'nova',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ai_runtime_settings (id) values (1)
on conflict (id) do nothing;

alter table public.ai_runtime_settings enable row level security;

create table if not exists public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  provider text not null default 'openai',
  model text not null,
  profile_id uuid,
  lesson_id uuid,
  question_id uuid,
  job_id uuid,
  success boolean not null default true,
  fallback_used boolean not null default false,
  latency_ms int,
  input_tokens int,
  output_tokens int,
  estimated_cost numeric,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_log_day_idx
  on public.ai_usage_log (created_at desc);
create index if not exists ai_usage_log_task_idx
  on public.ai_usage_log (task_type, created_at desc);

alter table public.ai_usage_log enable row level security;

create table if not exists public.ai_generation_cache (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  input_hash text not null,
  prompt_version text not null default '',
  model text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (task_type, input_hash, prompt_version, model)
);

alter table public.ai_generation_cache enable row level security;

alter table public.memory_lesson_scenes
  add column if not exists visual_priority text not null default 'standard';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memory_lesson_scenes_visual_priority_check') then
    alter table public.memory_lesson_scenes
      add constraint memory_lesson_scenes_visual_priority_check
      check (visual_priority in ('standard', 'key_anchor', 'premium'));
  end if;
end $$;

alter table public.memory_lessons
  add column if not exists generation_metadata jsonb not null default '{}'::jsonb;
alter table public.memory_lesson_assets
  add column if not exists generation_metadata jsonb not null default '{}'::jsonb;
alter table public.questions
  add column if not exists generation_metadata jsonb not null default '{}'::jsonb;

insert into public.ai_model_config (
  task_type, provider, primary_model, fallback_model, economy_model, premium_model,
  quality_tier, minimum_quality_tier, max_output_tokens, temperature,
  estimated_cost_class, notes
) values
  ('curriculum_discovery', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 4000, 0.2, 'high', 'Müfredat keşfi'),
  ('curriculum_diff', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 4000, 0.1, 'high', 'Müfredat farkı'),
  ('curriculum_decomposition', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 4500, 0.2, 'high', 'Ünite/konu ayrıştırma'),
  ('canonical_topic_matching', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-astra', 'balanced', 'balanced', 2000, 0.1, 'medium', 'Kanonik konu eşleme'),
  ('lesson_generation', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 8192, 0.3, 'high', 'Ders anlatımı'),
  ('memory_pedagogy_generation', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 4000, 0.3, 'high', 'Hafıza pedagojisi'),
  ('lesson_quality_validation', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 2500, 0.1, 'high', 'Ders kalite kontrolü'),
  ('question_generation', 'openai', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6.1-sol', 'economy', 'economy', 5000, 0.4, 'low', 'Toplu soru üretimi'),
  ('question_validation', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'balanced', 'balanced', 2500, 0.1, 'medium', 'Soru doğrulama'),
  ('question_similarity_check', 'openai', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-luna', 'economy', 'economy', 800, 0.0, 'low', 'Benzerlik / embedding uyumlu yol'),
  ('bot_conversation', 'openai', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6.1-sol', 'economy', 'economy', 400, 0.7, 'low', 'Sanal öğrenci sohbeti'),
  ('social_post_generation', 'openai', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-luna', 'economy', 'economy', 200, 0.8, 'low', 'Sosyal paylaşım'),
  ('social_comment_generation', 'openai', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-luna', 'economy', 'economy', 120, 0.8, 'low', 'Sosyal yorum'),
  ('image_generation', 'openai', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'balanced', 'economy', null, null, 'medium', 'Standart ders görseli'),
  ('premium_image_generation', 'openai', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'premium', 'balanced', null, null, 'high', 'Kapak / ana bellek görseli'),
  ('tts_generation', 'openai', 'gpt-4o-mini-tts', 'tts-1-hd', 'gpt-4o-mini-tts', 'gpt-4o-mini-tts', 'balanced', 'economy', null, null, 'medium', 'Ders seslendirme — yapılandırılabilir'),
  ('content_moderation_text', 'openai', 'omni-moderation-latest', null, 'omni-moderation-latest', 'omni-moderation-latest', 'balanced', 'balanced', null, null, 'low', 'Metin moderasyonu'),
  ('content_moderation_image', 'openai', 'omni-moderation-latest', null, 'omni-moderation-latest', 'omni-moderation-latest', 'balanced', 'balanced', null, null, 'low', 'Görsel moderasyonu')
on conflict (task_type) do nothing;

create or replace function public.admin_ai_router_overview()
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
    'settings', (select to_jsonb(s) from public.ai_runtime_settings s where id = 1),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.task_type)
      from public.ai_model_config t
    ), '[]'::jsonb),
    'usage_today', jsonb_build_object(
      'calls', (select count(*)::int from public.ai_usage_log where (timezone('Europe/Istanbul', created_at))::date = v_today),
      'text_calls', (
        select count(*)::int from public.ai_usage_log
        where (timezone('Europe/Istanbul', created_at))::date = v_today
          and task_type not in ('image_generation', 'premium_image_generation', 'tts_generation', 'content_moderation_image')
      ),
      'image_calls', (
        select count(*)::int from public.ai_usage_log
        where (timezone('Europe/Istanbul', created_at))::date = v_today
          and task_type in ('image_generation', 'premium_image_generation')
      ),
      'tts_calls', (
        select count(*)::int from public.ai_usage_log
        where (timezone('Europe/Istanbul', created_at))::date = v_today
          and task_type = 'tts_generation'
      ),
      'failures', (
        select count(*)::int from public.ai_usage_log
        where (timezone('Europe/Istanbul', created_at))::date = v_today and success = false
      ),
      'fallbacks', (
        select count(*)::int from public.ai_usage_log
        where (timezone('Europe/Istanbul', created_at))::date = v_today and fallback_used
      )
    )
  );
end;
$$;

create or replace function public.admin_set_ai_runtime_mode(
  p_mode text,
  p_max_daily_ai_jobs int default null,
  p_max_daily_image_jobs int default null,
  p_max_daily_tts_jobs int default null,
  p_tts_voice text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_super_admin();
  if p_mode not in ('economy', 'balanced', 'premium') then
    raise exception 'INVALID_INPUT';
  end if;
  update public.ai_runtime_settings
  set mode = p_mode,
      max_daily_ai_jobs = coalesce(p_max_daily_ai_jobs, max_daily_ai_jobs),
      max_daily_image_jobs = coalesce(p_max_daily_image_jobs, max_daily_image_jobs),
      max_daily_tts_jobs = coalesce(p_max_daily_tts_jobs, max_daily_tts_jobs),
      tts_voice = coalesce(nullif(trim(p_tts_voice), ''), tts_voice),
      updated_at = now()
  where id = 1;
  return (select to_jsonb(s) from public.ai_runtime_settings s where id = 1);
end;
$$;

create or replace function public.admin_update_ai_model_config(
  p_task_type text,
  p_primary_model text,
  p_fallback_model text default null,
  p_quality_tier text default null,
  p_enabled boolean default null,
  p_economy_model text default null,
  p_premium_model text default null,
  p_max_output_tokens int default null,
  p_temperature numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ai_model_config%rowtype;
begin
  perform public.require_super_admin();
  if length(trim(coalesce(p_task_type, ''))) < 2 then raise exception 'INVALID_INPUT'; end if;
  if length(trim(coalesce(p_primary_model, ''))) < 2 then raise exception 'INVALID_INPUT'; end if;
  if p_quality_tier is not null and p_quality_tier not in ('economy', 'balanced', 'premium') then
    raise exception 'INVALID_INPUT';
  end if;
  update public.ai_model_config
  set primary_model = trim(p_primary_model),
      fallback_model = nullif(trim(coalesce(p_fallback_model, '')), ''),
      economy_model = coalesce(nullif(trim(coalesce(p_economy_model, '')), ''), economy_model),
      premium_model = coalesce(nullif(trim(coalesce(p_premium_model, '')), ''), premium_model),
      quality_tier = coalesce(p_quality_tier, quality_tier),
      is_enabled = coalesce(p_enabled, is_enabled),
      max_output_tokens = coalesce(p_max_output_tokens, max_output_tokens),
      temperature = coalesce(p_temperature, temperature),
      config_version = config_version + 1,
      updated_at = now()
  where task_type = p_task_type
  returning * into v_row;
  if not found then raise exception 'NOT_FOUND'; end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.log_ai_usage(
  p_task_type text,
  p_provider text,
  p_model text,
  p_success boolean,
  p_fallback_used boolean default false,
  p_latency_ms int default null,
  p_input_tokens int default null,
  p_output_tokens int default null,
  p_profile uuid default null,
  p_lesson uuid default null,
  p_question uuid default null,
  p_job uuid default null,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ai_usage_log (
    task_type, provider, model, success, fallback_used, latency_ms,
    input_tokens, output_tokens, profile_id, lesson_id, question_id, job_id, error_code
  ) values (
    p_task_type, coalesce(p_provider, 'openai'), p_model, p_success, p_fallback_used, p_latency_ms,
    p_input_tokens, p_output_tokens, p_profile, p_lesson, p_question, p_job, p_error_code
  );
end;
$$;

grant execute on function public.admin_ai_router_overview() to authenticated;
grant execute on function public.admin_set_ai_runtime_mode(text, int, int, int, text) to authenticated;
grant execute on function public.admin_update_ai_model_config(text, text, text, text, boolean, text, text, int, numeric) to authenticated;
grant execute on function public.log_ai_usage(text, text, text, boolean, boolean, int, int, int, uuid, uuid, uuid, uuid, text) to service_role;
