-- Admin can delete memory lessons. Factory stays paused.

create or replace function public.admin_delete_memory_lesson(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_status text;
begin
  perform public.require_admin();
  select title, status into v_title, v_status from public.memory_lessons where id = p_id;
  if v_title is null then raise exception 'NOT_FOUND'; end if;

  update public.content_generation_jobs
  set status = 'cancelled', finished_at = now(), updated_at = now()
  where memory_lesson_id = p_id
    and status not in ('completed', 'cancelled', 'failed');

  delete from public.memory_lessons where id = p_id;
  perform public.write_admin_audit(
    'memory_lesson_delete',
    'memory_lesson',
    p_id::text,
    jsonb_build_object('title', v_title, 'status', v_status)
  );
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.admin_delete_memory_lesson(uuid) from public;
grant execute on function public.admin_delete_memory_lesson(uuid) to authenticated;

create or replace function public.factory_reset_kut_lesson()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson uuid := '98191920-a993-43ff-9705-1fd5c999038f';
  v_probe jsonb;
begin
  delete from public.memory_lessons
  where title = 'Kut Anlayışı'
    and status = 'draft'
    and coalesce(narration, '') = '';

  if not exists (select 1 from public.memory_lessons where id = v_lesson) then
    return jsonb_build_object('ok', false, 'error', 'kut_lesson_missing');
  end if;

  update public.content_generation_jobs
  set status = 'cancelled', finished_at = now(), updated_at = now()
  where canonical_topic_id = '75645898-f210-483f-9ef2-64b22ad8f09f'
    and status not in ('cancelled');

  delete from public.memory_lesson_scenes where lesson_id = v_lesson;
  delete from public.memory_lesson_questions where lesson_id = v_lesson;
  delete from public.memory_lesson_review_anchors where lesson_id = v_lesson;
  delete from public.memory_lesson_assets where lesson_id = v_lesson;

  update public.memory_lessons
  set narration = null,
      narration_key = null,
      thumbnail_key = null,
      captions_key = null,
      description = null,
      duration_sec = null,
      status = 'draft',
      generation_status = 'idle',
      generation_error = null,
      generation_model = null,
      media_generation_status = 'idle',
      media_generation_error = null,
      pedagogy_score = null,
      fast_rule = null,
      exam_technique = '{}'::jsonb,
      memory_hooks = '[]'::jsonb,
      core_facts = '[]'::jsonb,
      learning_objectives = '[]'::jsonb,
      lesson_generation_hash = null,
      prompt_version = 'exam-technique-overlay-v2',
      updated_at = now()
  where id = v_lesson;

  v_probe := public.factory_enqueue_kut_probe();
  if (v_probe->>'job_id') is not null then
    update public.content_generation_jobs
    set memory_lesson_id = v_lesson
    where id = (v_probe->>'job_id')::uuid;
  end if;
  update public.content_factory_settings
    set production_enabled = false, engine_state = 'paused', updated_at = now()
  where id = 1;
  return jsonb_build_object('ok', true, 'lesson_id', v_lesson, 'probe', v_probe);
end;
$$;

grant execute on function public.factory_reset_kut_lesson() to service_role;
