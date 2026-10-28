alter table public.memory_lessons
  add column if not exists pack_slug text,
  add column if not exists content_version text;

create unique index if not exists memory_lessons_pack_slug_version_uidx
  on public.memory_lessons (pack_slug, content_version)
  where pack_slug is not null and content_version is not null;

create index if not exists memory_lessons_pack_slug_idx
  on public.memory_lessons (pack_slug)
  where pack_slug is not null;
