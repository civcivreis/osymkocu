select jsonb_build_object(
  'factory', (
    select jsonb_build_object(
      'engine_state', engine_state,
      'production_enabled', production_enabled,
      'max_concurrency', max_concurrency,
      'curriculum_workers', curriculum_workers,
      'text_workers', text_workers,
      'image_workers', image_workers,
      'tts_workers', tts_workers,
      'question_workers', question_workers,
      'image_concurrency', image_concurrency,
      'tts_concurrency', tts_concurrency,
      'curriculum_sync_interval', curriculum_sync_interval,
      'last_idle_reason', last_idle_reason,
      'factory_blocked_reason', factory_blocked_reason,
      'factory_blocked_detail', factory_blocked_detail,
      'last_orchestrated_at', last_orchestrated_at,
      'last_job_started_at', last_job_started_at,
      'last_job_completed_at', last_job_completed_at,
      'last_cron_tick_at', last_cron_tick_at,
      'last_ai_call_at', last_ai_call_at,
      'stall_detected_at', stall_detected_at,
      'current_activity', current_activity,
      'last_health_at', last_health_at,
      'last_wake_error', last_wake_error,
      'scheduler_extensions', scheduler_extensions
    ) from content_factory_settings where id = 1
  ),
  'virtual_engine', (select to_jsonb(v) from virtual_student_engine_settings v where id = 1),
  'master', (select to_jsonb(m) from curriculum_master_meta m where id = 1),
  'exams', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'name', e.name, 'kind', e.kind,
      'subjects', (select count(*) from subjects s where s.exam_id = e.id),
      'topics', (select count(*) from topics t join subjects s on s.id = t.subject_id where s.exam_id = e.id),
      'current_versions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', cv.id, 'code', cv.code, 'name', cv.name, 'status', cv.status,
          'is_default', cv.is_default, 'manually_activated', cv.manually_activated
        )), '[]'::jsonb)
        from curriculum_versions cv where cv.exam_id = e.id and cv.status in ('active','current') or (cv.exam_id = e.id and cv.is_default)
      )
    ) order by e.slug), '[]'::jsonb)
    from exams e
  ),
  'canonical', jsonb_build_object(
    'topics', (select count(*) from canonical_topics),
    'too_broad', (select count(*) from canonical_topics where too_broad and not keep_single_override),
    'need_decomp', (select count(*) from canonical_topics where needs_further_decomposition),
    'ready', (select count(*) from canonical_topics ct where public.canonical_topic_factory_ready(ct.id)),
    'segments', (select count(*) from canonical_topic_segments),
    'objectives', (select count(*) from canonical_topic_learning_objectives),
    'maps', (select count(*) from exam_topic_map where included),
    'patterns', (select count(*) from exam_question_patterns)
  ),
  'canonical_by_exam', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'exam', x.slug,
      'mapped_topics', x.mapped_topics,
      'map_rows', x.map_rows
    ) order by x.slug), '[]'::jsonb)
    from (
      select e.slug,
        count(distinct m.canonical_topic_id) as mapped_topics,
        count(m.id) as map_rows
      from exams e
      left join curriculum_versions cv on cv.exam_id = e.id
      left join exam_topic_map m on m.curriculum_version_id = cv.id and m.included
      group by e.slug
    ) x
  ),
  'exam_catalog', (
    select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'active', is_active) order by code), '[]'::jsonb)
    from exam_catalog
  ),
  'health', public.refresh_factory_health(),
  'pipeline_jobs', (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
    from (select status, count(*)::int as n from factory_pipeline_jobs group by status) x
  ),
  'pipeline_kinds_queued', (
    select coalesce(jsonb_object_agg(job_kind, n), '{}'::jsonb)
    from (select job_kind, count(*)::int as n from factory_pipeline_jobs where status = 'queued' group by job_kind) x
  ),
  'pipeline_failed', (select count(*) from factory_pipeline_jobs where status = 'failed'),
  'gen_jobs', (
    select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
    from (select status, count(*)::int as n from content_generation_jobs group by status) x
  ),
  'lessons', jsonb_build_object(
    'total', (select count(*) from memory_lessons),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*)::int n from memory_lessons group by status) x)
  ),
  'giris', (
    select jsonb_build_object(
      'id', l.id, 'title', l.title, 'status', l.status, 'topic', l.topic, 'subject', l.subject,
      'exam', l.exam_type, 'pedagogy', l.pedagogy_score,
      'narration_len', length(coalesce(l.narration,'')),
      'narration_key', l.narration_key,
      'thumbnail_key', l.thumbnail_key,
      'media_status', l.media_generation_status,
      'media_error', l.media_generation_error,
      'scenes', (select count(*) from memory_lesson_scenes s where s.lesson_id = l.id),
      'scenes_with_asset', (select count(*) from memory_lesson_scenes s where s.lesson_id = l.id and coalesce(s.asset_key,'') <> ''),
      'ck', (select count(*) from memory_lesson_questions q where q.lesson_id = l.id and q.question_type = 'checkpoint'),
      'final', (select count(*) from memory_lesson_questions q where q.lesson_id = l.id and q.question_type = 'final'),
      'chunks', (
        select coalesce(jsonb_agg(jsonb_build_object('i', chunk_index, 'status', status, 'next_retry_at', next_retry_at, 'has_r2', coalesce(r2_key,'')<>'') order by chunk_index), '[]'::jsonb)
        from memory_lesson_narration_chunks c where c.lesson_id = l.id
      )
    )
    from memory_lessons l
    where l.id = 'f822b149-99c0-4027-910d-301497525631'
    limit 1
  ),
  'questions', jsonb_build_object(
    'total', (select count(*) from questions),
    'published', (select count(*) from questions where is_published),
    'by_status', (select coalesce(jsonb_object_agg(coalesce(question_status,'null'), n), '{}'::jsonb) from (select question_status, count(*)::int n from questions group by 1) x),
    'by_source_type', (select coalesce(jsonb_object_agg(coalesce(source_type,'null'), n), '{}'::jsonb) from (select source_type, count(*)::int n from questions group by 1) x),
    'with_lesson', (select count(*) from questions where memory_lesson_id is not null)
  ),
  'tts_config', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'task', task_type, 'primary', primary_model, 'fallback', fallback_model, 'transitional', transitional
    ) order by task_type), '[]'::jsonb)
    from ai_model_config
  ),
  'tts_usage_last', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'at', created_at, 'task', task_type, 'model', model, 'success', success,
      'adapter', adapter, 'endpoint_type', endpoint_type, 'error', error_code
    ) order by created_at desc), '[]'::jsonb)
    from (
      select * from ai_usage_log
      where task_type in ('tts_generation','coach_voice_preview')
      order by created_at desc limit 6
    ) u
  ),
  'virtual', jsonb_build_object(
    'profiles', (select count(*) from virtual_student_profiles),
    'enabled', (select count(*) from virtual_student_profiles where is_enabled),
    'jobs_queued', (select count(*) from virtual_student_activity_jobs where status = 'queued'),
    'jobs_completed', (select count(*) from virtual_student_activity_jobs where status = 'completed'),
    'last_completed', (select max(completed_at) from virtual_student_activity_jobs where status = 'completed'),
    'last_by_type', (
      select coalesce(jsonb_object_agg(activity_type, last_at), '{}'::jsonb)
      from (
        select activity_type, max(completed_at) as last_at
        from virtual_student_activity_jobs where status = 'completed'
        group by activity_type
      ) x
    )
  ),
  'social', jsonb_build_object(
    'posts', (select count(*) from social_posts),
    'posts_null_exp', (select count(*) from social_posts where coalesce(content_type,'post') = 'post' and expires_at is null),
    'posts_with_exp', (select count(*) from social_posts where coalesce(content_type,'post') = 'post' and expires_at is not null),
    'stories', (select count(*) from stories),
    'stories_live', (select count(*) from stories where expires_at > now()),
    'last_post', (select max(created_at) from social_posts),
    'last_virtual_post', (
      select max(p.created_at) from social_posts p
      join virtual_student_profiles v on v.profile_id = p.user_id
    )
  ),
  'rooms', jsonb_build_object(
    'open', (select count(*) from study_sessions where status = 'open' and ended_at is null),
    'week', (select count(*) from study_sessions where created_at > now() - interval '7 days')
  ),
  'chat', jsonb_build_object(
    'exam_msgs_24h', (select count(*) from exam_chat_messages where created_at > now() - interval '24 hours'),
    'last_exam_msg', (select max(created_at) from exam_chat_messages)
  ),
  'xp', jsonb_build_object(
    'tx', (select count(*) from xp_transactions),
    'reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc), '[]'::jsonb)
      from (select reason, count(*)::int n from xp_transactions group by reason order by count(*) desc limit 12) x
    )
  ),
  'cron', (select coalesce(jsonb_agg(jsonb_build_object('name', jobname, 'sched', schedule) order by jobname), '[]'::jsonb) from cron.job)
) as audit;
