-- One-shot: wipe real users + messages + social/study progress.
-- Keeps question bank, ders ağacı, TYT/AYT/KPSS grupları, sistem sınavı tanımları.
-- Re-seeds exam-chat bots. Run once against production.

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'questions' and column_name = 'reviewed_by'
  ) then
    execute 'update public.questions set reviewed_by = null where reviewed_by is not null';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'system_exams' and column_name = 'created_by'
  ) then
    execute 'update public.system_exams set created_by = null where created_by is not null';
  end if;
end $$;

do $$
declare
  t text;
  keep constant text[] := array[
    'exams',
    'subjects',
    'topics',
    'subtopics',
    'questions',
    'profiles',
    'exam_chat_groups',
    'exam_chat_line_bank',
    'camps',
    'camp_days',
    'camp_day_tasks',
    'system_exams',
    'system_exam_questions',
    'league_seasons'
  ];
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relispartition
      and c.relname <> all (keep)
    order by c.relname
  loop
    execute format('truncate table public.%I restart identity cascade', t);
  end loop;
end $$;

do $$
declare
  stmt text;
begin
  foreach stmt in array array[
    'delete from auth.identities',
    'delete from auth.sessions',
    'delete from auth.refresh_tokens',
    'delete from auth.mfa_amr_claims',
    'delete from auth.mfa_challenges',
    'delete from auth.mfa_factors',
    'delete from auth.one_time_tokens',
    'delete from auth.flow_state'
  ]
  loop
    begin
      execute stmt;
    exception
      when undefined_table then null;
    end;
  end loop;
end $$;

delete from auth.users;

insert into public.bot_clock (id, last_pulse_at)
values (1, now() - interval '1 hour')
on conflict (id) do update set last_pulse_at = excluded.last_pulse_at;

select public.seed_kocum_bots();

commit;
