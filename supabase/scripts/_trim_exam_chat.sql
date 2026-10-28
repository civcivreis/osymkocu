update public.exam_chat_messages
set reply_to_id = null
where reply_to_id in (
  select id
  from (
    select id, row_number() over (partition by slug order by created_at desc, id desc) as rn
    from public.exam_chat_messages
    where slug in ('tyt', 'ayt', 'kpss')
  ) x
  where rn > 80
);

delete from public.message_reactions
where scope = 'group'
  and message_id in (
    select id
    from (
      select id, row_number() over (partition by slug order by created_at desc, id desc) as rn
      from public.exam_chat_messages
      where slug in ('tyt', 'ayt', 'kpss')
    ) x
    where rn > 80
  );

delete from public.exam_chat_messages
where id in (
  select id
  from (
    select id, row_number() over (partition by slug order by created_at desc, id desc) as rn
    from public.exam_chat_messages
    where slug in ('tyt', 'ayt', 'kpss')
  ) x
  where rn > 80
);
