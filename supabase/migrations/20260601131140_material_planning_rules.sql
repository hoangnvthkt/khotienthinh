-- Material planning rules for project-level material demand forecast.

create table if not exists public.material_planning_rules (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  inventory_item_id text references public.items(id) on delete set null,
  category text,
  lead_time_days integer not null default 7
    check (lead_time_days >= 0 and lead_time_days <= 365),
  distribution_method text not null default 'pre_start'
    check (distribution_method in ('pre_start', 'linear')),
  note text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint material_planning_rules_scope_target_check
    check (inventory_item_id is not null or nullif(trim(coalesce(category, '')), '') is not null)
);

create unique index if not exists idx_material_planning_rules_scope_item
  on public.material_planning_rules(scope_key, inventory_item_id)
  where inventory_item_id is not null;

create unique index if not exists idx_material_planning_rules_scope_category
  on public.material_planning_rules(scope_key, lower(category))
  where inventory_item_id is null and category is not null;

create index if not exists idx_material_planning_rules_project
  on public.material_planning_rules(project_id, construction_site_id);

create or replace function public.set_material_planning_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_material_planning_rules_updated_at
  on public.material_planning_rules;
create trigger trg_material_planning_rules_updated_at
  before update on public.material_planning_rules
  for each row execute function public.set_material_planning_rules_updated_at();

alter table public.material_planning_rules enable row level security;

drop policy if exists material_planning_rules_project_access
  on public.material_planning_rules;
create policy material_planning_rules_project_access
  on public.material_planning_rules
  for all
  to authenticated
  using (project_id is not null or construction_site_id is not null)
  with check (project_id is not null or construction_site_id is not null);

revoke all on table public.material_planning_rules from anon;
revoke all on table public.material_planning_rules from public;
revoke all on table public.material_planning_rules from authenticated;
grant select, insert, update, delete on table public.material_planning_rules to authenticated;

revoke all on function public.set_material_planning_rules_updated_at() from public;

notify pgrst, 'reload schema';
