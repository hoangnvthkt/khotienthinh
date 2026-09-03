alter table public.project_finances
  add column if not exists actual_production_value numeric not null default 0,
  add column if not exists actual_production_updated_at timestamptz,
  add column if not exists actual_production_updated_by text,
  add column if not exists actual_production_note text;

comment on column public.project_finances.actual_production_value is
  'Manual actual production value used for project value progress. Does not derive from PO or material fulfillment.';
comment on column public.project_finances.actual_production_updated_at is
  'Timestamp of the latest manual actual production value update.';
comment on column public.project_finances.actual_production_updated_by is
  'User id of the latest manual actual production value updater.';
comment on column public.project_finances.actual_production_note is
  'Optional note for the latest manual actual production value update.';
