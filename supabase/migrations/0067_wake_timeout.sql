-- pg_net default timeout is too short for lesson generation / media.

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
      headers := v_headers,
      timeout_milliseconds := 15000
    );
  exception when others then
    v_err := 'orchestrator: ' || sqlerrm;
  end;
  begin
    v_proc := net.http_post(
      url := 'https://qvmhtzpaoxdychyjhqyj.supabase.co/functions/v1/content-factory-process',
      body := jsonb_build_object('source', 'db'),
      headers := v_headers,
      timeout_milliseconds := 200000
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

grant execute on function public.content_factory_wake_edge() to service_role;

update public.content_factory_settings
set production_enabled = false, engine_state = 'paused', updated_at = now()
where id = 1;
