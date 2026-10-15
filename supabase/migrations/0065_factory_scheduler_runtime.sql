-- Phase 3I follow-up: actual scheduler (pg_cron/pg_net), truthful health, probe wake while paused.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

alter table public.content_factory_settings
  add column if not exists last_health_at timestamptz,
  add column if not exists last_wake_error text,
  add column if not exists scheduler_extensions text;

insert into public.ai_model_config (
  task_type, provider, primary_model, fallback_model, economy_model, premium_model,
  quality_tier, minimum_quality_tier, max_output_tokens, temperature,
  estimated_cost_class, notes
) values
  ('learning_objectives', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 2500, 0.2, 'high', 'Öğrenme hedefleri'),
  ('exam_technique_design', 'openai', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-astra', 'premium', 'balanced', 2500, 0.2, 'high', 'Soru kalıbı / sınav tekniği tasarımı')
on conflict (task_type) do nothing;

create or replace function public.refresh_factory_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_ready int := 0;
  v_jobs int := 0;
  v_active int := 0;
  v_pipe int := 0;
  v_need_decomp int := 0;
  v_reason text;
  v_detail text;
  v_activity text;
  v_last_job timestamptz;
  v_last_ai timestamptz;
  v_stalled boolean := false;
  v_cron boolean := false;
  v_net boolean := false;
begin
  select engine_state into v_state from public.content_factory_settings where id = 1;
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_cron;
  select exists (select 1 from pg_extension where extname = 'pg_net') into v_net;
  select count(*) into v_ready from public.canonical_topics ct where public.canonical_topic_factory_ready(ct.id)
    and not exists (select 1 from public.memory_lessons l where l.canonical_topic_id = ct.id and l.status in ('pending_validation','approved','published'));
  select count(*) into v_jobs from public.content_generation_jobs where status in ('queued','generating_text','validating_pedagogy','generating_questions','generating_media');
  select count(*) into v_active from public.content_generation_jobs where status in ('generating_text','validating_pedagogy','generating_questions','generating_media');
  select count(*) into v_pipe from public.factory_pipeline_jobs where status in ('queued','running');
  select count(*) into v_need_decomp from public.canonical_topics where needs_further_decomposition or (too_broad and not keep_single_override
    and not exists (select 1 from public.canonical_topic_segments s where s.canonical_topic_id = canonical_topics.id));
  select max(started_at) into v_last_job from public.content_generation_jobs;
  select max(created_at) into v_last_ai from public.ai_usage_log;

  if not v_cron or not v_net then
    v_reason := 'SCHEDULER_NOT_RUNNING';
    v_detail := format('pg_cron=%s pg_net=%s', v_cron, v_net);
    v_activity := 'Sunucu zamanlayıcısı yok; motor bayrağı iş üretmez.';
  elsif v_state is distinct from 'running' then
    if v_jobs > 0 and v_active = 0 then
      v_reason := 'WORKER_UNAVAILABLE';
      v_detail := 'Probe/kuyruk var; worker uyanmadı.';
      v_activity := 'Duraklatıldı ama kuyrukta iş var.';
    else
      v_reason := null;
      v_activity := 'Motor duraklatıldı.';
    end if;
  elsif v_active > 0 then
    v_reason := null;
    v_activity := 'Üretim işi yürüyor.';
  elsif v_jobs > 0 then
    v_reason := 'WORKER_UNAVAILABLE';
    v_detail := 'Kuyrukta iş var ama worker alamadı.';
    v_activity := 'Kuyruk dolu, worker bekleniyor.';
  elsif v_pipe > 0 then
    v_reason := 'DECOMPOSITION_PENDING';
    v_detail := v_pipe::text || ' müfredat hazırlık işi kuyrukta.';
    v_activity := 'Müfredat ayrıştırma / kazanım kuyruğu işleniyor.';
  elsif v_need_decomp > 0 then
    v_reason := 'DECOMPOSITION_PENDING';
    v_detail := v_need_decomp::text || ' master konu hâlâ ayrışmamış.';
    v_activity := 'Ayrıştırılacak konu var; kuyruk oluşmadı.';
  elsif v_ready > 0 then
    v_reason := 'WORKER_UNAVAILABLE';
    v_detail := v_ready::text || ' segment ders üretimine hazır ama iş açılmadı.';
    v_activity := 'Hazır segmentler var; kuyruk boş.';
  else
    v_reason := 'NO_ELIGIBLE_SEGMENTS';
    v_detail := 'Üretime hazır segment yok.';
    v_activity := 'Eksik iş bulunamadı.';
  end if;

  if v_state = 'running' and (v_ready > 0 or v_need_decomp > 0 or v_pipe > 0 or v_jobs > 0) and v_active = 0 then
    if v_last_job is null or v_last_job < now() - interval '10 minutes' then
      v_stalled := true;
    end if;
  end if;

  update public.content_factory_settings
  set factory_blocked_reason = v_reason,
      factory_blocked_detail = v_detail,
      current_activity = case when v_stalled then 'Motor çalışıyor görünüyor ancak ilerleme yok. ' || coalesce(v_detail, v_activity) else v_activity end,
      last_job_started_at = v_last_job,
      last_ai_call_at = v_last_ai,
      stall_detected_at = case when v_stalled then now() else null end,
      last_health_at = now(),
      scheduler_extensions = format('pg_cron=%s,pg_net=%s', v_cron, v_net),
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'engine_state', v_state,
    'blocked_reason', v_reason,
    'detail', v_detail,
    'activity', v_activity,
    'stalled', v_stalled,
    'pg_cron', v_cron,
    'pg_net', v_net,
    'ready_without_lesson', v_ready,
    'active_jobs', v_active,
    'queued_jobs', v_jobs,
    'pipeline', v_pipe,
    'need_decomp', v_need_decomp
  );
end;
$$;

drop function if exists public.content_factory_wake_edge();

create or replace function public.content_factory_wake_edge()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  v_secret text;
  v_headers jsonb;
  v_orch bigint;
  v_proc bigint;
  v_err text;
begin
  select wake_secret into v_secret from public.content_factory_settings where id = 1;
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-factory-wake', coalesce(v_secret, '')
  );
  begin
    v_orch := net.http_post(
      url := 'https://qvmhtzpaoxdychyjhqyj.supabase.co/functions/v1/content-factory-orchestrator',
      body := jsonb_build_object('source', 'db'),
      headers := v_headers
    );
  exception when others then
    v_err := 'orchestrator: ' || sqlerrm;
  end;
  begin
    v_proc := net.http_post(
      url := 'https://qvmhtzpaoxdychyjhqyj.supabase.co/functions/v1/content-factory-process',
      body := jsonb_build_object('source', 'db'),
      headers := v_headers
    );
  exception when others then
    v_err := trim(both ' ' from coalesce(v_err || '; ', '') || 'process: ' || sqlerrm);
  end;
  update public.content_factory_settings
  set last_wake_error = v_err, updated_at = now()
  where id = 1;
  return jsonb_build_object('orchestrator_req', v_orch, 'process_req', v_proc, 'error', v_err);
end;
$$;

create or replace function public.content_factory_cron_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_probe int;
begin
  update public.content_factory_settings set last_cron_tick_at = now() where id = 1;
  select engine_state into v_state from public.content_factory_settings where id = 1;
  if v_state in ('running', 'stopping') then
    perform public.factory_orchestrate_internal();
    perform public.content_factory_wake_edge();
    return;
  end if;
  perform public.refresh_factory_health();
  select count(*) into v_probe
  from public.content_generation_jobs
  where status in ('queued','generating_text','validating_pedagogy','generating_questions','generating_media')
    and priority >= 1000;
  if coalesce(v_probe, 0) > 0 then
    perform public.content_factory_wake_edge();
  end if;
end;
$$;

create or replace function public.admin_factory_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
  s public.content_factory_settings;
  v_cron boolean;
  v_net boolean;
begin
  perform public.require_admin();
  v := public.refresh_factory_health();
  select * into s from public.content_factory_settings where id = 1;
  select exists (select 1 from pg_extension where extname = 'pg_cron') into v_cron;
  select exists (select 1 from pg_extension where extname = 'pg_net') into v_net;
  return v || jsonb_build_object(
    'production_enabled', s.production_enabled,
    'blocked_reason', s.factory_blocked_reason,
    'blocked_detail', s.factory_blocked_detail,
    'activity', s.current_activity,
    'last_orchestrated_at', s.last_orchestrated_at,
    'last_cron_tick_at', s.last_cron_tick_at,
    'last_ai_call_at', s.last_ai_call_at,
    'max_concurrency', s.max_concurrency,
    'pg_cron', v_cron,
    'pg_net', v_net,
    'last_wake_error', s.last_wake_error,
    'scheduler', case
      when not v_cron or not v_net then 'error'
      when s.last_cron_tick_at is not null and s.last_cron_tick_at > now() - interval '3 minutes' then 'healthy'
      when s.engine_state = 'paused' then 'idle'
      else 'error'
    end
  );
end;
$$;

create or replace function public.factory_runtime_audit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
    'engine_state', s.engine_state,
    'production_enabled', s.production_enabled,
    'blocked_reason', s.factory_blocked_reason,
    'blocked_detail', s.factory_blocked_detail,
    'activity', s.current_activity,
    'last_cron_tick_at', s.last_cron_tick_at,
    'last_health_at', s.last_health_at,
    'last_wake_error', s.last_wake_error,
    'last_ai_call_at', s.last_ai_call_at,
    'pg_cron', exists (select 1 from pg_extension where extname = 'pg_cron'),
    'pg_net', exists (select 1 from pg_extension where extname = 'pg_net'),
    'unique_masters', (select count(*) from public.canonical_topics where master_key is not null and parent_canonical_topic_id is null),
    'unique_segments', (select count(*) from public.canonical_topic_segments),
    'promoted_children', (select count(*) from public.canonical_topics where parent_canonical_topic_id is not null),
    'objectives', (select count(*) from public.canonical_topic_learning_objectives),
    'patterns', (select count(*) from public.exam_question_patterns),
    'lessons', (select count(*) from public.memory_lessons),
    'questions', (select count(*) from public.questions),
    'jobs_total', (select count(*) from public.content_generation_jobs),
    'jobs_queued', (select count(*) from public.content_generation_jobs where status = 'queued'),
    'jobs_active', (select count(*) from public.content_generation_jobs where status in ('generating_text','validating_pedagogy','generating_questions','generating_media')),
    'jobs_completed', (select count(*) from public.content_generation_jobs where status = 'completed'),
    'jobs_failed', (select count(*) from public.content_generation_jobs where status = 'failed'),
    'ai_calls', (select count(*) from public.ai_usage_log),
    'ai_ok', (select count(*) from public.ai_usage_log where success),
    'ai_fail', (select count(*) from public.ai_usage_log where not success),
    'ready_topics', (select count(*) from public.canonical_topics ct where public.canonical_topic_factory_ready(ct.id)),
    'need_decomp', (select count(*) from public.canonical_topics where needs_further_decomposition or (too_broad and not keep_single_override and not exists (select 1 from public.canonical_topic_segments s where s.canonical_topic_id = canonical_topics.id)))
  ) into v
  from public.content_factory_settings s where s.id = 1;
  return v;
end;
$$;

grant execute on function public.factory_runtime_audit() to service_role;
grant execute on function public.content_factory_wake_edge() to service_role;
grant execute on function public.content_factory_cron_tick() to service_role;

do $$
begin
  perform cron.unschedule('kocum-factory-tick');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('kocum-factory-tick', '* * * * *', 'select public.content_factory_cron_tick()');
exception when others then
  update public.content_factory_settings
  set last_wake_error = 'cron.schedule: ' || sqlerrm
  where id = 1;
end $$;

select public.refresh_factory_health();
select public.content_factory_wake_edge();
