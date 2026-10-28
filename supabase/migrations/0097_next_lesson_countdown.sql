-- Admin-configurable auto-next delay after a lesson ends.
alter table public.app_runtime_settings
  add column if not exists default_next_lesson_countdown int not null default 10;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_runtime_settings_countdown_check'
  ) then
    alter table public.app_runtime_settings
      add constraint app_runtime_settings_countdown_check
      check (default_next_lesson_countdown between 5 and 30);
  end if;
end $$;

drop policy if exists app_runtime_settings_staff_write on public.app_runtime_settings;
create policy app_runtime_settings_staff_write on public.app_runtime_settings
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
