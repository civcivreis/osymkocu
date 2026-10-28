select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosrc
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'exam_chat_compose','exam_chat_skeleton','group_line_too_similar',
    'pulse_exam_chats','exam_chat_fill','exam_chat_near_duplicate'
  )
order by p.proname, 2;
