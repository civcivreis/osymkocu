select jsonb_agg(jsonb_build_object('code', code, 'maps', maps, 'topics', topics, 'versions', versions) order by code) as maps_by_catalog
from (
  select ec.code,
    count(m.id)::int as maps,
    count(distinct m.canonical_topic_id)::int as topics,
    count(distinct cv.id)::int as versions
  from exam_catalog ec
  left join curriculum_versions cv on cv.exam_id = ec.id
  left join exam_topic_map m on m.curriculum_version_id = cv.id and m.included
  group by ec.code
) s;
