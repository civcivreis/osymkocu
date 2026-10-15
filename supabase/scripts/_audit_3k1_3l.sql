select t.id, t.name, t.slug, u.name as unit_name, s.name as subject_name
from public.canonical_topics t
join public.canonical_units u on u.id = t.canonical_unit_id
join public.canonical_subjects s on s.id = u.canonical_subject_id
where t.name ilike '%paragraf%'
   or t.name ilike '%giriş%'
   or t.name ilike '%cümle%'
   or t.slug ilike '%paragraf%'
   or t.slug ilike '%giris%'
   or u.name ilike '%paragraf%'
   or s.name ilike '%Türkçe%'
   or s.name ilike '%Turkce%'
   or s.name ilike '%türk%'
order by s.name, u.name, t.name
limit 80;
