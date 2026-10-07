-- Grant admin to attutattut@hotmail.com (Batu#4221) without removing the first admin.
-- Paste in SQL Editor. Does not invent users; only updates an existing auth.users row.

create or replace function public.bootstrap_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles p
  set app_role = 'admin'
  from auth.users u
  where u.id = p.id
    and lower(u.email) in ('attutattutt@gmail.com', 'attutattut@hotmail.com');

  update public.profiles
  set app_role = 'user'
  where app_role = 'admin'
    and id not in (
      select id from auth.users
      where lower(email) in ('attutattutt@gmail.com', 'attutattut@hotmail.com')
    );

  return exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where lower(u.email) in ('attutattutt@gmail.com', 'attutattut@hotmail.com')
      and p.app_role = 'admin'
  );
end;
$$;

update public.profiles p
set app_role = 'admin'
from auth.users u
where u.id = p.id
  and lower(u.email) = 'attutattut@hotmail.com';
