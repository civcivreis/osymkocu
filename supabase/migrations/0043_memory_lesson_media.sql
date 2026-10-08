-- Phase 2B: media generation status for narration + scene stills.

alter table public.memory_lessons
  add column if not exists media_generation_status text not null default 'idle',
  add column if not exists media_generated_at timestamptz,
  add column if not exists media_generation_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'memory_lessons_media_generation_status_check'
  ) then
    alter table public.memory_lessons
      add constraint memory_lessons_media_generation_status_check
      check (media_generation_status in ('idle', 'generating', 'ready', 'failed'));
  end if;
end $$;
