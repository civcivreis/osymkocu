select tc.id as topic_id, u.id as unit_id, s.id as subject_id, s.exam_id, e.code
from public.topic_catalog tc
join public.unit_catalog u on u.id = tc.unit_id
join public.subject_catalog s on s.id = u.subject_id
join public.exam_catalog e on e.id = s.exam_id
where tc.canonical_topic_id = 'a87b5809-0d64-4996-8260-56d7a525b60e'
order by case when e.code ilike '%TYT%' then 0 else 1 end, e.code
limit 8;
