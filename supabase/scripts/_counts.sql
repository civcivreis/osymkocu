select
  (select count(*)::int from public.questions where is_published is true and question_status = 'published') as published_questions,
  (select count(*)::int from public.questions where is_published is true) as is_published_true,
  (select max(p.created_at) from public.social_posts p join public.profiles pr on pr.id = p.user_id where pr.profile_type::text = 'virtual') as last_virtual_post,
  (select max(m.created_at) from public.exam_chat_messages m join public.profiles pr on pr.id = m.sender_id where pr.profile_type::text = 'virtual') as last_virtual_chat;
