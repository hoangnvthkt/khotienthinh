alter table public.quality_checklists
  add column if not exists ever_submitted boolean not null default false;

create index if not exists idx_quality_checklists_ever_submitted_status
  on public.quality_checklists (ever_submitted, status);
