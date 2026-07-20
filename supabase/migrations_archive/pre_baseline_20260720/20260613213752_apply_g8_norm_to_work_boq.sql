-- Apply active G8 cost norms to project work BOQ items.

alter table public.material_budget_items
  add column if not exists source_type text not null default 'manual'
    check (source_type in ('manual', 'excel_import', 'g8_norm')),
  add column if not exists source_norm_mapping_id text,
  add column if not exists source_norm_component_estimate_id text,
  add column if not exists source_norm_code_snapshot text;

create table if not exists public.project_work_boq_norm_mappings (
  id text primary key default gen_random_uuid()::text,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  work_boq_item_id text not null references public.project_work_boq_items(id) on delete cascade,
  cost_norm_library_id text references public.cost_norm_libraries(id) on delete set null,
  cost_norm_item_id text references public.cost_norm_items(id) on delete set null,
  norm_code_snapshot text not null,
  norm_name_snapshot text not null,
  norm_unit_snapshot text,
  work_boq_qty_snapshot numeric not null default 0,
  work_boq_unit_snapshot text,
  status text not null default 'active' check (status in ('active', 'removed')),
  selected_component_ids jsonb not null default '[]'::jsonb,
  override_data jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_work_boq_norm_mappings_unique_active
    unique (work_boq_item_id, cost_norm_item_id)
);

create table if not exists public.project_work_boq_norm_component_estimates (
  id text primary key default gen_random_uuid()::text,
  mapping_id text not null references public.project_work_boq_norm_mappings(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  work_boq_item_id text references public.project_work_boq_items(id) on delete cascade,
  cost_norm_component_id text references public.cost_norm_item_components(id) on delete set null,
  cost_norm_resource_id text references public.cost_norm_resources(id) on delete set null,
  resource_type text not null check (resource_type in ('material', 'labor', 'machine', 'adjustment', 'other')),
  resource_code_snapshot text,
  resource_name_snapshot text not null,
  unit text,
  coefficient numeric,
  work_boq_qty_snapshot numeric not null default 0,
  estimated_qty numeric not null default 0,
  selected boolean not null default true,
  material_budget_item_id text references public.material_budget_items(id) on delete set null,
  line_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_work_boq_norm_component_estimates_unique_component
    unique (mapping_id, cost_norm_component_id)
);

create index if not exists idx_project_work_boq_norm_mappings_work
  on public.project_work_boq_norm_mappings(work_boq_item_id, status);

create index if not exists idx_project_work_boq_norm_mappings_project
  on public.project_work_boq_norm_mappings(project_id, created_at desc)
  where project_id is not null;

create index if not exists idx_project_work_boq_norm_mappings_site
  on public.project_work_boq_norm_mappings(construction_site_id, created_at desc)
  where construction_site_id is not null;

create index if not exists idx_project_work_boq_norm_estimates_mapping
  on public.project_work_boq_norm_component_estimates(mapping_id, line_index);

create index if not exists idx_project_work_boq_norm_estimates_material
  on public.project_work_boq_norm_component_estimates(material_budget_item_id)
  where material_budget_item_id is not null;

create index if not exists idx_material_budget_items_g8_source
  on public.material_budget_items(source_norm_mapping_id, source_norm_component_estimate_id)
  where source_type = 'g8_norm';

drop trigger if exists trg_project_work_boq_norm_mappings_updated_at
  on public.project_work_boq_norm_mappings;
create trigger trg_project_work_boq_norm_mappings_updated_at
before update on public.project_work_boq_norm_mappings
for each row execute function public.set_updated_at();

drop trigger if exists trg_project_work_boq_norm_component_estimates_updated_at
  on public.project_work_boq_norm_component_estimates;
create trigger trg_project_work_boq_norm_component_estimates_updated_at
before update on public.project_work_boq_norm_component_estimates
for each row execute function public.set_updated_at();

alter table public.material_budget_items
  add constraint material_budget_items_source_norm_mapping_fk
  foreign key (source_norm_mapping_id)
  references public.project_work_boq_norm_mappings(id)
  on delete set null
  not valid;

alter table public.material_budget_items
  add constraint material_budget_items_source_norm_component_estimate_fk
  foreign key (source_norm_component_estimate_id)
  references public.project_work_boq_norm_component_estimates(id)
  on delete set null
  not valid;

alter table public.project_work_boq_norm_mappings enable row level security;
alter table public.project_work_boq_norm_component_estimates enable row level security;

revoke all on table public.project_work_boq_norm_mappings from anon;
revoke all on table public.project_work_boq_norm_mappings from public;
revoke all on table public.project_work_boq_norm_mappings from authenticated;
grant select, insert, update, delete on table public.project_work_boq_norm_mappings to authenticated;

revoke all on table public.project_work_boq_norm_component_estimates from anon;
revoke all on table public.project_work_boq_norm_component_estimates from public;
revoke all on table public.project_work_boq_norm_component_estimates from authenticated;
grant select, insert, update, delete on table public.project_work_boq_norm_component_estimates to authenticated;

drop policy if exists project_work_boq_norm_mappings_select
  on public.project_work_boq_norm_mappings;
create policy project_work_boq_norm_mappings_select
  on public.project_work_boq_norm_mappings
  for select
  to authenticated
  using (
    public.is_admin()
    or project_id is not null
    or construction_site_id is not null
  );

drop policy if exists project_work_boq_norm_mappings_insert
  on public.project_work_boq_norm_mappings;
create policy project_work_boq_norm_mappings_insert
  on public.project_work_boq_norm_mappings
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  );

drop policy if exists project_work_boq_norm_mappings_update
  on public.project_work_boq_norm_mappings;
create policy project_work_boq_norm_mappings_update
  on public.project_work_boq_norm_mappings
  for update
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  )
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  );

drop policy if exists project_work_boq_norm_mappings_delete
  on public.project_work_boq_norm_mappings;
create policy project_work_boq_norm_mappings_delete
  on public.project_work_boq_norm_mappings
  for delete
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'delete')
  );

drop policy if exists project_work_boq_norm_estimates_select
  on public.project_work_boq_norm_component_estimates;
create policy project_work_boq_norm_estimates_select
  on public.project_work_boq_norm_component_estimates
  for select
  to authenticated
  using (
    public.is_admin()
    or project_id is not null
    or construction_site_id is not null
  );

drop policy if exists project_work_boq_norm_estimates_insert
  on public.project_work_boq_norm_component_estimates;
create policy project_work_boq_norm_estimates_insert
  on public.project_work_boq_norm_component_estimates
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  );

drop policy if exists project_work_boq_norm_estimates_update
  on public.project_work_boq_norm_component_estimates;
create policy project_work_boq_norm_estimates_update
  on public.project_work_boq_norm_component_estimates
  for update
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  )
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  );

drop policy if exists project_work_boq_norm_estimates_delete
  on public.project_work_boq_norm_component_estimates;
create policy project_work_boq_norm_estimates_delete
  on public.project_work_boq_norm_component_estimates
  for delete
  to authenticated
  using (
    public.is_admin()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'delete')
  );

drop policy if exists cost_norm_libraries_active_project_select on public.cost_norm_libraries;
create policy cost_norm_libraries_active_project_select
  on public.cost_norm_libraries
  for select
  to authenticated
  using (status = 'active');

drop policy if exists cost_norm_items_active_project_select on public.cost_norm_items;
create policy cost_norm_items_active_project_select
  on public.cost_norm_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.cost_norm_libraries library
      where library.id = cost_norm_items.library_id
        and library.status = 'active'
    )
  );

drop policy if exists cost_norm_components_active_project_select on public.cost_norm_item_components;
create policy cost_norm_components_active_project_select
  on public.cost_norm_item_components
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.cost_norm_items item
      join public.cost_norm_libraries library on library.id = item.library_id
      where item.id = cost_norm_item_components.norm_item_id
        and library.status = 'active'
    )
  );

drop policy if exists cost_norm_resources_active_project_select on public.cost_norm_resources;
create policy cost_norm_resources_active_project_select
  on public.cost_norm_resources
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.cost_norm_item_components component
      join public.cost_norm_items item on item.id = component.norm_item_id
      join public.cost_norm_libraries library on library.id = item.library_id
      where component.resource_id = cost_norm_resources.id
        and library.status = 'active'
    )
  );

notify pgrst, 'reload schema';
