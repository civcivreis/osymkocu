select p.proname, pg_get_function_identity_arguments(p.oid) as args,
  (p.prosrc like '%anlatınca aklıma geldi%') as has_aklima_template,
  (p.prosrc like '%came_to_mind%') as has_came_to_mind,
  (p.prosrc like '%exam_chat_line_bank%') as uses_line_bank,
  (p.prosrc like '%limit 40%') as limit_40,
  (p.prosrc like '%SAME_MINUTE_THROTTLE%') as has_minute_throttle
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'exam_chat_compose','exam_chat_skeleton','group_line_too_similar',
    'pulse_exam_chats','exam_chat_fill','exam_chat_near_duplicate','exam_chat_touch_human'
  )
order by 1, 2;
