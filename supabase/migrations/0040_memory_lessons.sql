-- Hafıza Dersleri Phase 1: catalog, scenes, questions, progress, R2 asset index.

create table if not exists public.memory_lessons (
  id uuid primary key default gen_random_uuid(),
  exam_type text not null,
  subject text not null,
  unit text not null,
  topic text not null,
  title text not null,
  slug text not null unique,
  description text,
  version integer not null default 1,
  duration_sec integer,
  status text not null default 'draft',
  thumbnail_key text,
  narration_key text,
  captions_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint memory_lessons_exam_type_check
    check (exam_type in ('tyt', 'ayt', 'kpss')),
  constraint memory_lessons_status_check
    check (status in ('draft', 'generating', 'pending_validation', 'approved', 'published', 'archived')),
  constraint memory_lessons_version_check check (version >= 1),
  constraint memory_lessons_duration_check check (duration_sec is null or duration_sec >= 0)
);

create table if not exists public.memory_lesson_scenes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  scene_order integer not null,
  start_ms integer not null default 0,
  end_ms integer not null default 0,
  asset_type text not null,
  asset_key text,
  caption text,
  narration_text text,
  memory_hook text,
  created_at timestamptz not null default now(),
  constraint memory_lesson_scenes_asset_type_check
    check (asset_type in ('image', 'video', 'animation')),
  constraint memory_lesson_scenes_order_check check (scene_order >= 1),
  constraint memory_lesson_scenes_time_check check (start_ms >= 0 and end_ms >= start_ms),
  unique (lesson_id, scene_order)
);

create table if not exists public.memory_lesson_questions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  question_type text not null,
  question_order integer not null,
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  explanation text,
  related_scene_id uuid references public.memory_lesson_scenes(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint memory_lesson_questions_type_check
    check (question_type in ('checkpoint', 'final')),
  constraint memory_lesson_questions_order_check check (question_order >= 1),
  unique (lesson_id, question_type, question_order)
);

create table if not exists public.memory_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  last_position_ms integer not null default 0,
  completion_percent numeric not null default 0,
  completed boolean not null default false,
  score integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint memory_lesson_progress_position_check check (last_position_ms >= 0),
  constraint memory_lesson_progress_percent_check
    check (completion_percent >= 0 and completion_percent <= 100),
  unique (user_id, lesson_id)
);

create table if not exists public.memory_lesson_assets (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.memory_lessons(id) on delete cascade,
  asset_type text not null,
  r2_key text not null,
  mime_type text not null,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint memory_lesson_assets_size_check check (size_bytes is null or size_bytes >= 0),
  unique (lesson_id, r2_key)
);

create index if not exists memory_lessons_status_exam_idx
  on public.memory_lessons (status, exam_type);
create index if not exists memory_lesson_scenes_lesson_idx
  on public.memory_lesson_scenes (lesson_id, scene_order);
create index if not exists memory_lesson_questions_lesson_idx
  on public.memory_lesson_questions (lesson_id, question_type, question_order);
create index if not exists memory_lesson_progress_user_idx
  on public.memory_lesson_progress (user_id, updated_at desc);
create index if not exists memory_lesson_assets_lesson_idx
  on public.memory_lesson_assets (lesson_id);

drop trigger if exists memory_lessons_set_updated_at on public.memory_lessons;
create trigger memory_lessons_set_updated_at
  before update on public.memory_lessons
  for each row execute procedure public.set_updated_at();

drop trigger if exists memory_lesson_progress_set_updated_at on public.memory_lesson_progress;
create trigger memory_lesson_progress_set_updated_at
  before update on public.memory_lesson_progress
  for each row execute procedure public.set_updated_at();

alter table public.memory_lessons enable row level security;
alter table public.memory_lesson_scenes enable row level security;
alter table public.memory_lesson_questions enable row level security;
alter table public.memory_lesson_progress enable row level security;
alter table public.memory_lesson_assets enable row level security;

drop policy if exists memory_lessons_select on public.memory_lessons;
create policy memory_lessons_select on public.memory_lessons
  for select to authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists memory_lessons_admin_write on public.memory_lessons;
create policy memory_lessons_admin_write on public.memory_lessons
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists memory_lesson_scenes_select on public.memory_lesson_scenes;
create policy memory_lesson_scenes_select on public.memory_lesson_scenes
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.memory_lessons l
      where l.id = lesson_id and l.status = 'published'
    )
  );

drop policy if exists memory_lesson_scenes_admin_write on public.memory_lesson_scenes;
create policy memory_lesson_scenes_admin_write on public.memory_lesson_scenes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists memory_lesson_questions_select on public.memory_lesson_questions;
create policy memory_lesson_questions_select on public.memory_lesson_questions
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.memory_lessons l
      where l.id = lesson_id and l.status = 'published'
    )
  );

drop policy if exists memory_lesson_questions_admin_write on public.memory_lesson_questions;
create policy memory_lesson_questions_admin_write on public.memory_lesson_questions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists memory_lesson_assets_select on public.memory_lesson_assets;
create policy memory_lesson_assets_select on public.memory_lesson_assets
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.memory_lessons l
      where l.id = lesson_id and l.status = 'published'
    )
  );

drop policy if exists memory_lesson_assets_admin_write on public.memory_lesson_assets;
create policy memory_lesson_assets_admin_write on public.memory_lesson_assets
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists memory_lesson_progress_own on public.memory_lesson_progress;
create policy memory_lesson_progress_own on public.memory_lesson_progress
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.memory_lessons l
      where l.id = lesson_id
        and (l.status = 'published' or public.is_admin())
    )
  );

grant select, insert, update, delete on public.memory_lessons to authenticated;
grant select, insert, update, delete on public.memory_lesson_scenes to authenticated;
grant select, insert, update, delete on public.memory_lesson_questions to authenticated;
grant select, insert, update, delete on public.memory_lesson_progress to authenticated;
grant select, insert, update, delete on public.memory_lesson_assets to authenticated;
