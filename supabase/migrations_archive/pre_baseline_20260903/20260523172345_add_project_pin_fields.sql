alter table public.projects
  add column if not exists is_pinned boolean not null default false,
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by text;

create index if not exists idx_projects_pin_order
  on public.projects(is_pinned desc, pinned_at desc, updated_at desc);

create index if not exists idx_projects_pinned_at
  on public.projects(pinned_at desc)
  where is_pinned = true;
