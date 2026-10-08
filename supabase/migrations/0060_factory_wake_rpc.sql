-- Admin SPA should wake the factory through PostgREST, not a browser CORS preflight to Edge Functions.

create or replace function public.content_factory_wake_edge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_headers jsonb;
begin
  select wake_secret into v_secret from public.content_factory_settings where id = 1;
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-factory-wake', coalesce(v_secret, '')
  );
  begin
    perform net.http_post(
      url := 'https://qvmhtzpaoxdychyjhqyj.supabase.co/functions/v1/content-factory-orchestrator',
      body := jsonb_build_object('source', 'db'),
      headers := v_headers
    );
  exception when others then
    null;
  end;
  begin
    perform net.http_post(
      url := 'https://qvmhtzpaoxdychyjhqyj.supabase.co/functions/v1/content-factory-process',
      body := jsonb_build_object('source', 'db'),
      headers := v_headers
    );
  exception when others then
    null;
  end;
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
begin
  select engine_state into v_state from public.content_factory_settings where id = 1;
  if v_state not in ('running', 'stopping') then return; end if;
  perform public.factory_orchestrate_internal();
  perform public.content_factory_wake_edge();
end;
$$;

create or replace function public.admin_factory_orchestrate()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run jsonb;
begin
  perform public.require_admin();
  v_run := public.factory_orchestrate_internal();
  perform public.content_factory_wake_edge();
  return v_run;
end;
$$;

revoke all on function public.content_factory_wake_edge() from public;
grant execute on function public.content_factory_wake_edge() to service_role;
grant execute on function public.admin_factory_orchestrate() to authenticated;
