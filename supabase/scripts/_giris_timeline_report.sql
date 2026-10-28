-- Debug report: Giriş Cümlesi pedagogy timeline
-- Run after 0091_lesson_timeline_pedagogy.sql

select
  l.id as lesson_id,
  l.title,
  s.scene_order,
  s.start_ms,
  s.end_ms,
  left(s.narration_text, 280) as narration_text,
  c->>'narration_segment_id' as narration_segment_id,
  c->>'card_type' as card_type,
  c->>'short_text' as card_text,
  (c->>'start_ms')::int as card_start_ms,
  (c->>'end_ms')::int as card_end_ms,
  c->>'semantic_key' as semantic_key
from public.memory_lessons l
join public.memory_lesson_scenes s on s.lesson_id = l.id
left join lateral jsonb_array_elements(coalesce(s.overlay_cards, '[]'::jsonb)) c on true
where l.title ilike '%giriş cümlesi%' or l.topic ilike '%giriş cümlesi%'
order by l.id, s.scene_order, card_start_ms;

select
  q.question_order,
  q.checkpoint_intro,
  q.question_text,
  q.retry_question_text,
  q.correct_feedback,
  q.wrong_feedback,
  e.event_type,
  e.appear_at_ms,
  e.payload
from public.memory_lessons l
join public.memory_lesson_questions q on q.lesson_id = l.id and q.question_type = 'checkpoint'
left join public.lesson_timeline_events e
  on e.lesson_id = l.id and e.related_question_id = q.id
where l.title ilike '%giriş cümlesi%' or l.topic ilike '%giriş cümlesi%'
order by q.question_order, e.appear_at_ms;
