-- Phase 2A: text generation metadata + scene visual notes + admin status RPCs.

alter table public.memory_lessons
  add column if not exists narration text,
  add column if not exists learning_objectives jsonb not null default '[]'::jsonb,
  add column if not exists memory_hooks jsonb not null default '[]'::jsonb,
  add column if not exists generation_model text,
  add column if not exists generated_at timestamptz,
  add column if not exists prompt_version text,
  add column if not exists generation_status text not null default 'idle',
  add column if not exists generation_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'memory_lessons_generation_status_check'
  ) then
    alter table public.memory_lessons
      add constraint memory_lessons_generation_status_check
      check (generation_status in ('idle', 'generating', 'succeeded', 'failed'));
  end if;
end $$;

alter table public.memory_lesson_scenes
  add column if not exists visual_description text;

create or replace function public.admin_approve_memory_lesson(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public.require_admin();
  select status into v_status from public.memory_lessons where id = p_id;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'pending_validation' then raise exception 'NOT_READY'; end if;
  update public.memory_lessons
  set status = 'approved', generation_error = null, updated_at = now()
  where id = p_id;
  perform public.write_admin_audit('memory_lesson_approve', 'memory_lesson', p_id::text, '{}'::jsonb);
  return jsonb_build_object('id', p_id, 'status', 'approved');
end;
$$;

create or replace function public.admin_publish_memory_lesson(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_topic uuid;
begin
  perform public.require_admin();
  select status, topic_id into v_status, v_topic from public.memory_lessons where id = p_id;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status <> 'approved' then raise exception 'NOT_APPROVED'; end if;
  update public.memory_lessons
  set status = 'published', published_at = coalesce(published_at, now()), updated_at = now()
  where id = p_id;
  if v_topic is not null then
    update public.topic_catalog
    set content_status = 'published', updated_at = now()
    where id = v_topic;
  end if;
  perform public.write_admin_audit('memory_lesson_publish', 'memory_lesson', p_id::text, '{}'::jsonb);
  return jsonb_build_object('id', p_id, 'status', 'published');
end;
$$;

revoke all on function public.admin_approve_memory_lesson(uuid) from public;
revoke all on function public.admin_publish_memory_lesson(uuid) from public;
grant execute on function public.admin_approve_memory_lesson(uuid) to authenticated;
grant execute on function public.admin_publish_memory_lesson(uuid) to authenticated;
