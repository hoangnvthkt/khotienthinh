alter table public.requests
  add column if not exists title text;

update public.requests
set title = 'Đề xuất vật tư'
where nullif(trim(title), '') is null;

alter table public.requests
  alter column title set default 'Đề xuất vật tư',
  alter column title set not null;

alter table public.requests
  drop constraint if exists requests_title_length_check;

alter table public.requests
  add constraint requests_title_length_check
  check (length(trim(title)) between 1 and 200);
