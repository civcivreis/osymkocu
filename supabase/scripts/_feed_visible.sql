select tgname, pg_get_triggerdef(t.oid) as def
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'exam_chat_messages' and not t.tgisinternal;

select body, created_at, slug,
  public.exam_chat_skeleton(body) as sk
from exam_chat_messages
where body ilike '%aklıma geldi%' or body ilike '%aklima geldi%'
order by created_at desc
limit 20;

select body from exam_chat_line_bank
where body ilike '%aklıma%' or body ilike '%anlatınca%'
limit 20;
