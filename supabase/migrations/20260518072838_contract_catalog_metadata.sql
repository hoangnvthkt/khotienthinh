-- Contract metadata catalogs used by BOQ item details and material norms.
-- These tables are intentionally generic master data under module HD.

create table if not exists public.contract_service_catalogs (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  group_name text,
  unit text,
  unit_price numeric not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_contract_service_catalogs_code
  on public.contract_service_catalogs (lower(code));
create index if not exists idx_contract_service_catalogs_group
  on public.contract_service_catalogs (group_name);

create table if not exists public.contract_labor_catalogs (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  group_name text,
  unit text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_contract_labor_catalogs_code
  on public.contract_labor_catalogs (lower(code));
create index if not exists idx_contract_labor_catalogs_group
  on public.contract_labor_catalogs (group_name);

create table if not exists public.contract_machine_catalogs (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  group_name text,
  unit text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_contract_machine_catalogs_code
  on public.contract_machine_catalogs (lower(code));
create index if not exists idx_contract_machine_catalogs_group
  on public.contract_machine_catalogs (group_name);

create table if not exists public.contract_material_norms (
  id uuid primary key default gen_random_uuid(),
  work_code text not null,
  material_item_id text,
  material_sku text,
  material_name text not null,
  unit text,
  waste_percent numeric not null default 0,
  norm numeric not null default 0,
  note text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contract_material_norms_work_code
  on public.contract_material_norms (work_code);
create index if not exists idx_contract_material_norms_material
  on public.contract_material_norms (material_item_id);
create unique index if not exists idx_contract_material_norms_unique
  on public.contract_material_norms (lower(work_code), coalesce(material_item_id, ''), lower(material_name));

alter table public.contract_service_catalogs enable row level security;
alter table public.contract_labor_catalogs enable row level security;
alter table public.contract_machine_catalogs enable row level security;
alter table public.contract_material_norms enable row level security;

drop policy if exists "contract_service_catalogs_access" on public.contract_service_catalogs;
create policy "contract_service_catalogs_access"
  on public.contract_service_catalogs
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists "contract_labor_catalogs_access" on public.contract_labor_catalogs;
create policy "contract_labor_catalogs_access"
  on public.contract_labor_catalogs
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists "contract_machine_catalogs_access" on public.contract_machine_catalogs;
create policy "contract_machine_catalogs_access"
  on public.contract_machine_catalogs
  for all to authenticated
  using (true)
  with check (true);

drop policy if exists "contract_material_norms_access" on public.contract_material_norms;
create policy "contract_material_norms_access"
  on public.contract_material_norms
  for all to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.contract_service_catalogs to authenticated;
grant select, insert, update, delete on public.contract_labor_catalogs to authenticated;
grant select, insert, update, delete on public.contract_machine_catalogs to authenticated;
grant select, insert, update, delete on public.contract_material_norms to authenticated;

notify pgrst, 'reload schema';
