insert into public.exam_catalog (code, name, sort_order)
select 'KPSS_ONLISANS', 'KPSS Önlisans', 1
where not exists (select 1 from public.exam_catalog where code = 'KPSS_ONLISANS');

insert into public.subject_catalog (exam_id, code, name, sort_order)
select e.id, 'TARIH', 'Tarih', 1
from public.exam_catalog e
where e.code = 'KPSS_ONLISANS'
  and not exists (
    select 1 from public.subject_catalog s
    where s.exam_id = e.id and (s.code = 'TARIH' or lower(s.name) = 'tarih')
  );

insert into public.unit_catalog (subject_id, name, sort_order)
select s.id, 'İslamiyet Öncesi Türk Tarihi', 1
from public.subject_catalog s
join public.exam_catalog e on e.id = s.exam_id
where e.code = 'KPSS_ONLISANS' and s.code = 'TARIH'
  and not exists (
    select 1 from public.unit_catalog u
    where u.subject_id = s.id and lower(u.name) = lower('İslamiyet Öncesi Türk Tarihi')
  );

insert into public.topic_catalog (unit_id, name, sort_order, content_status)
select u.id, 'Kut Anlayışı', 1, 'empty'
from public.unit_catalog u
join public.subject_catalog s on s.id = u.subject_id
join public.exam_catalog e on e.id = s.exam_id
where e.code = 'KPSS_ONLISANS'
  and s.code = 'TARIH'
  and lower(u.name) = lower('İslamiyet Öncesi Türk Tarihi')
  and not exists (
    select 1 from public.topic_catalog t
    where t.unit_id = u.id and lower(t.name) = lower('Kut Anlayışı')
  );

select
  e.id as exam_id,
  s.id as subject_id,
  u.id as unit_id,
  t.id as topic_id
from public.exam_catalog e
join public.subject_catalog s on s.exam_id = e.id
join public.unit_catalog u on u.subject_id = s.id
join public.topic_catalog t on t.unit_id = u.id
where e.code = 'KPSS_ONLISANS'
  and s.code = 'TARIH'
  and lower(u.name) = lower('İslamiyet Öncesi Türk Tarihi')
  and lower(t.name) = lower('Kut Anlayışı');
