select activity_type, status, count(*)::int as n
from virtual_student_activity_jobs
where created_at > now() - interval '24 hours'
  and activity_type in ('social_post','update_status','social_comment','social_like')
group by 1,2
order by 1,2;
