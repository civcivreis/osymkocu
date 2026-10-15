select t.amount, t.reason::text, t.reference_type, t.created_at, p.current_xp, p.display_name
from public.xp_transactions t
join public.profiles p on p.id = t.user_id
where t.user_id = 'b0000000-0000-4000-8000-000000000001'
order by t.created_at desc
limit 8;
