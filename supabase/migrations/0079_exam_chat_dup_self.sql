-- Compose already persists last_meaning; pulse must not treat that as a duplicate of the line just written.

create or replace function public.exam_chat_near_duplicate(p_slug text, p_bot uuid, p_body text)
returns boolean
language sql
stable
as $$
  select public.group_line_too_similar(p_slug, p_body);
$$;
