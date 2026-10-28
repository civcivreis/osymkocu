-- Premium matching foundation. Billing and paywalls stay disabled.

create table if not exists public.app_feature_flags (
  id int primary key default 1 check (id = 1),
  premium_enabled boolean not null default false,
  premium_matching_filters_enabled boolean not null default false,
  premium_intro_messages_enabled boolean not null default false,
  premium_intro_message_limit int not null default 2,
  updated_at timestamptz not null default now()
);

insert into public.app_feature_flags (id)
values (1)
on conflict (id) do nothing;

update public.app_feature_flags
set premium_enabled = false,
    premium_matching_filters_enabled = false,
    premium_intro_messages_enabled = false,
    premium_intro_message_limit = 2
where id = 1;

alter table public.app_feature_flags enable row level security;

drop policy if exists app_feature_flags_read on public.app_feature_flags;
create policy app_feature_flags_read on public.app_feature_flags
  for select to authenticated using (true);

grant select on public.app_feature_flags to authenticated;

create table if not exists public.matching_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  city_filter text,
  age_min int,
  age_max int,
  gender_filter text,
  premium_filters_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matching_preferences_age_check
    check (
      (age_min is null or age_min between 13 and 99)
      and (age_max is null or age_max between 13 and 99)
      and (age_min is null or age_max is null or age_min <= age_max)
    ),
  constraint matching_preferences_gender_check
    check (gender_filter is null or gender_filter in ('any', 'female', 'male', 'unspecified'))
);

alter table public.matching_preferences enable row level security;

drop policy if exists matching_preferences_own on public.matching_preferences;
create policy matching_preferences_own on public.matching_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.matching_preferences to authenticated;

create table if not exists public.matching_entitlements (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  premium_matching_filters boolean not null default false,
  premium_intro_message_limit int not null default 2,
  intro_messages_used int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.matching_entitlements enable row level security;

drop policy if exists matching_entitlements_own on public.matching_entitlements;
create policy matching_entitlements_own on public.matching_entitlements
  for select to authenticated using (user_id = auth.uid());

grant select on public.matching_entitlements to authenticated;

create or replace function public.get_app_feature_flags()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'premium_enabled', coalesce(premium_enabled, false),
    'premium_matching_filters_enabled', coalesce(premium_matching_filters_enabled, false),
    'premium_intro_messages_enabled', coalesce(premium_intro_messages_enabled, false),
    'premium_intro_message_limit', coalesce(premium_intro_message_limit, 2)
  )
  from public.app_feature_flags
  where id = 1;
$$;

grant execute on function public.get_app_feature_flags() to authenticated;
grant execute on function public.get_app_feature_flags() to anon;

create or replace function public.matching_premium_filters_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select premium_enabled and premium_matching_filters_enabled from public.app_feature_flags where id = 1), false);
$$;

grant execute on function public.matching_premium_filters_allowed() to authenticated;
