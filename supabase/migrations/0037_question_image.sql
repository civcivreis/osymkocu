-- Optional question image. Public URL or R2/https path; rendering is client-side.

alter table public.questions
  add column if not exists image_url text;
