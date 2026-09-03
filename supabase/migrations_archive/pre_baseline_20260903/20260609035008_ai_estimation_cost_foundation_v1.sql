-- AI Estimation & Internal Cost Foundation v1
-- Source of truth for quick tender estimates generated from internal templates,
-- norms and price books. AI tools are read-only; estimate mutation must go
-- through reviewed application workflows.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ───────────────────────────────────────────────────────────────
--  Master data: templates, parameters, sections, items
-- ───────────────────────────────────────────────────────────────

create table if not exists public.cost_templates (
  id text primary key default gen_random_uuid()::text,
  code text not null,
  name text not null,
  project_type text,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  version_no integer not null default 1 check (version_no > 0),
  parent_template_id text references public.cost_templates(id) on delete set null,
  effective_from date not null default current_date,
  effective_to date,
  parameters_schema jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_templates_effective_range_chk
    check (effective_to is null or effective_to >= effective_from),
  constraint cost_templates_code_version_uniq unique (code, version_no)
);

create table if not exists public.cost_template_sections (
  id text primary key default gen_random_uuid()::text,
  template_id text not null references public.cost_templates(id) on delete cascade,
  parent_id text references public.cost_template_sections(id) on delete set null,
  code text not null,
  name text not null,
  description text,
  unit text,
  calculation_method text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_template_sections_template_code_uniq unique (template_id, code)
);

create table if not exists public.cost_template_items (
  id text primary key default gen_random_uuid()::text,
  template_id text not null references public.cost_templates(id) on delete cascade,
  section_id text references public.cost_template_sections(id) on delete set null,
  code text not null,
  name text not null,
  item_type text not null default 'work'
    check (item_type in ('work', 'material', 'labor', 'machine', 'subcontract', 'overhead', 'other')),
  unit text,
  quantity_formula text,
  base_quantity numeric(18, 4),
  default_waste_percent numeric(8, 4) not null default 0,
  labor_rate numeric(18, 6) not null default 0,
  machine_rate numeric(18, 6) not null default 0,
  overhead_percent numeric(8, 4) not null default 0,
  profit_percent numeric(8, 4) not null default 0,
  risk_buffer_percent numeric(8, 4) not null default 0,
  cost_category text,
  work_code text,
  material_sku text,
  norm_group_code text,
  sort_order integer not null default 0,
  assumptions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_template_items_template_code_uniq unique (template_id, code),
  constraint cost_template_items_rates_chk check (
    default_waste_percent >= 0
    and labor_rate >= 0
    and machine_rate >= 0
    and overhead_percent >= 0
    and profit_percent >= 0
    and risk_buffer_percent >= 0
  )
);

create table if not exists public.cost_template_parameters (
  id text primary key default gen_random_uuid()::text,
  template_id text not null references public.cost_templates(id) on delete cascade,
  code text not null,
  label text not null,
  data_type text not null default 'number'
    check (data_type in ('number', 'text', 'select', 'boolean', 'date')),
  unit text,
  is_required boolean not null default true,
  default_value jsonb,
  options jsonb not null default '[]'::jsonb,
  validation_rules jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cost_template_parameters_template_code_uniq unique (template_id, code)
);

-- ───────────────────────────────────────────────────────────────
--  Sensitive master data: internal prices and norms
-- ───────────────────────────────────────────────────────────────

create table if not exists public.internal_price_book (
  id text primary key default gen_random_uuid()::text,
  item_code text not null,
  item_name text not null,
  item_type text not null default 'material'
    check (item_type in ('material', 'labor', 'machine', 'subcontract', 'overhead', 'other')),
  category text,
  spec text,
  unit text not null,
  region text not null default 'all',
  brand text,
  supplier_name text,
  currency text not null default 'VND',
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  version_no integer not null default 1 check (version_no > 0),
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  sensitivity_level text not null default 'internal'
    check (sensitivity_level in ('internal', 'restricted')),
  source text,
  note text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_price_book_effective_range_chk
    check (effective_to is null or effective_to >= effective_from),
  constraint internal_price_book_code_region_version_uniq unique (item_code, region, version_no)
);

create table if not exists public.internal_norms (
  id text primary key default gen_random_uuid()::text,
  norm_code text not null,
  template_item_id text references public.cost_template_items(id) on delete set null,
  work_code text,
  resource_code text,
  resource_name text not null,
  resource_type text not null default 'material'
    check (resource_type in ('material', 'labor', 'machine', 'subcontract', 'overhead', 'other')),
  unit text not null,
  norm_quantity numeric(18, 6) not null check (norm_quantity >= 0),
  waste_percent numeric(8, 4) not null default 0 check (waste_percent >= 0),
  formula text,
  applicable_parameters jsonb not null default '{}'::jsonb,
  region text not null default 'all',
  version_no integer not null default 1 check (version_no > 0),
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  source_project_id text,
  source_note text,
  confidence_score numeric(5, 4) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_norms_effective_range_chk
    check (effective_to is null or effective_to >= effective_from),
  constraint internal_norms_code_region_version_uniq unique (norm_code, region, version_no)
);

-- ───────────────────────────────────────────────────────────────
--  Estimate scenarios, items, adjustments and immutable versions
-- ───────────────────────────────────────────────────────────────

create table if not exists public.estimate_scenarios (
  id text primary key default gen_random_uuid()::text,
  code text,
  name text not null,
  project_id text,
  construction_site_id text,
  customer_name text,
  project_type text,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'finalized', 'converted', 'cancelled')),
  template_id text references public.cost_templates(id) on delete set null,
  template_version_no integer,
  input_parameters jsonb not null default '{}'::jsonb,
  missing_parameters text[] not null default '{}'::text[],
  assumptions jsonb not null default '[]'::jsonb,
  risk_warnings jsonb not null default '[]'::jsonb,
  confidence_score numeric(5, 4) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  total_material_amount numeric(18, 2) not null default 0,
  total_labor_amount numeric(18, 2) not null default 0,
  total_machine_amount numeric(18, 2) not null default 0,
  total_subcontract_amount numeric(18, 2) not null default 0,
  total_overhead_amount numeric(18, 2) not null default 0,
  manual_adjustment_amount numeric(18, 2) not null default 0,
  total_amount numeric(18, 2) not null default 0,
  quote_amount numeric(18, 2) not null default 0,
  currency text not null default 'VND',
  margin_percent numeric(8, 4),
  profit_amount numeric(18, 2),
  template_snapshot jsonb not null default '{}'::jsonb,
  price_book_snapshot jsonb not null default '[]'::jsonb,
  norms_snapshot jsonb not null default '[]'::jsonb,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  quote_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  reviewed_by uuid references public.users(id) on delete set null,
  finalized_by uuid references public.users(id) on delete set null,
  converted_project_id text,
  converted_contract_id text,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimate_scenarios_totals_chk check (
    total_material_amount >= 0
    and total_labor_amount >= 0
    and total_machine_amount >= 0
    and total_subcontract_amount >= 0
    and total_overhead_amount >= 0
    and total_amount >= 0
  )
);

create table if not exists public.estimate_items (
  id text primary key default gen_random_uuid()::text,
  estimate_id text not null references public.estimate_scenarios(id) on delete cascade,
  section_id text,
  template_item_id text,
  code text,
  name text not null,
  item_type text not null default 'work'
    check (item_type in ('work', 'material', 'labor', 'machine', 'subcontract', 'overhead', 'other')),
  unit text,
  quantity_formula text,
  original_quantity numeric(18, 4),
  original_unit_price numeric(18, 2),
  original_amount numeric(18, 2),
  quantity numeric(18, 4) not null default 0 check (quantity >= 0),
  unit_price numeric(18, 2) not null default 0 check (unit_price >= 0),
  amount numeric(18, 2) not null default 0 check (amount >= 0),
  quote_unit_price numeric(18, 2),
  quote_amount numeric(18, 2),
  price_book_item_id text,
  norm_id text,
  source_snapshot jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  confidence_score numeric(5, 4) check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  manual_override boolean not null default false,
  override_reason text,
  override_by uuid references public.users(id) on delete set null,
  override_by_name text,
  override_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.estimate_adjustments (
  id text primary key default gen_random_uuid()::text,
  estimate_id text not null references public.estimate_scenarios(id) on delete cascade,
  adjustment_type text not null default 'other'
    check (adjustment_type in ('discount', 'markup', 'risk_contingency', 'transport', 'tax', 'other')),
  description text not null,
  amount numeric(18, 2),
  percent numeric(8, 4),
  reason text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint estimate_adjustments_value_chk check (amount is not null or percent is not null)
);

create table if not exists public.estimate_versions (
  id text primary key default gen_random_uuid()::text,
  estimate_id text not null references public.estimate_scenarios(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text,
  snapshot jsonb not null,
  change_note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint estimate_versions_estimate_version_uniq unique (estimate_id, version_no)
);

-- ───────────────────────────────────────────────────────────────
--  Indexes
-- ───────────────────────────────────────────────────────────────

create index if not exists idx_cost_templates_status_type
  on public.cost_templates(status, project_type, effective_from desc);
create index if not exists idx_cost_template_sections_template
  on public.cost_template_sections(template_id, parent_id, sort_order);
create index if not exists idx_cost_template_items_template
  on public.cost_template_items(template_id, section_id, sort_order);
create index if not exists idx_cost_template_parameters_template
  on public.cost_template_parameters(template_id, sort_order);
create index if not exists idx_internal_price_book_lookup
  on public.internal_price_book(status, region, item_code, effective_from desc);
create index if not exists idx_internal_price_book_name_trgm
  on public.internal_price_book using gin (item_name gin_trgm_ops);
create index if not exists idx_internal_norms_lookup
  on public.internal_norms(status, region, norm_code, work_code, effective_from desc);
create index if not exists idx_internal_norms_resource_trgm
  on public.internal_norms using gin (resource_name gin_trgm_ops);
create index if not exists idx_estimate_scenarios_project_status
  on public.estimate_scenarios(project_id, construction_site_id, status, created_at desc);
create index if not exists idx_estimate_scenarios_created_by
  on public.estimate_scenarios(created_by, created_at desc);
create index if not exists idx_estimate_items_estimate
  on public.estimate_items(estimate_id, sort_order);
create index if not exists idx_estimate_adjustments_estimate
  on public.estimate_adjustments(estimate_id, created_at);
create index if not exists idx_estimate_versions_estimate
  on public.estimate_versions(estimate_id, version_no desc);

-- pg_trgm is optional in some environments; create it after normal indexes.
-- ───────────────────────────────────────────────────────────────
--  Updated-at triggers
-- ───────────────────────────────────────────────────────────────

drop trigger if exists trg_cost_templates_updated_at on public.cost_templates;
create trigger trg_cost_templates_updated_at
before update on public.cost_templates
for each row execute function public.set_updated_at();

drop trigger if exists trg_cost_template_sections_updated_at on public.cost_template_sections;
create trigger trg_cost_template_sections_updated_at
before update on public.cost_template_sections
for each row execute function public.set_updated_at();

drop trigger if exists trg_cost_template_items_updated_at on public.cost_template_items;
create trigger trg_cost_template_items_updated_at
before update on public.cost_template_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_cost_template_parameters_updated_at on public.cost_template_parameters;
create trigger trg_cost_template_parameters_updated_at
before update on public.cost_template_parameters
for each row execute function public.set_updated_at();

drop trigger if exists trg_internal_price_book_updated_at on public.internal_price_book;
create trigger trg_internal_price_book_updated_at
before update on public.internal_price_book
for each row execute function public.set_updated_at();

drop trigger if exists trg_internal_norms_updated_at on public.internal_norms;
create trigger trg_internal_norms_updated_at
before update on public.internal_norms
for each row execute function public.set_updated_at();

drop trigger if exists trg_estimate_scenarios_updated_at on public.estimate_scenarios;
create trigger trg_estimate_scenarios_updated_at
before update on public.estimate_scenarios
for each row execute function public.set_updated_at();

drop trigger if exists trg_estimate_items_updated_at on public.estimate_items;
create trigger trg_estimate_items_updated_at
before update on public.estimate_items
for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────
--  RLS and grants
-- ───────────────────────────────────────────────────────────────

alter table public.cost_templates enable row level security;
alter table public.cost_template_sections enable row level security;
alter table public.cost_template_items enable row level security;
alter table public.cost_template_parameters enable row level security;
alter table public.internal_price_book enable row level security;
alter table public.internal_norms enable row level security;
alter table public.estimate_scenarios enable row level security;
alter table public.estimate_items enable row level security;
alter table public.estimate_adjustments enable row level security;
alter table public.estimate_versions enable row level security;

grant select, insert, update, delete on public.cost_templates to authenticated;
grant select, insert, update, delete on public.cost_template_sections to authenticated;
grant select, insert, update, delete on public.cost_template_items to authenticated;
grant select, insert, update, delete on public.cost_template_parameters to authenticated;
grant select, insert, update, delete on public.internal_price_book to authenticated;
grant select, insert, update, delete on public.internal_norms to authenticated;
grant select, insert, update, delete on public.estimate_scenarios to authenticated;
grant select, insert, update, delete on public.estimate_items to authenticated;
grant select, insert, update, delete on public.estimate_adjustments to authenticated;
grant select, insert, update, delete on public.estimate_versions to authenticated;

create policy cost_templates_select on public.cost_templates
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or status = 'active'
);

create policy cost_templates_manage on public.cost_templates
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));

create policy cost_template_sections_select on public.cost_template_sections
for select to authenticated
using (
  exists (
    select 1 from public.cost_templates t
    where t.id = template_id
      and (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('DA') or t.status = 'active')
  )
);

create policy cost_template_sections_manage on public.cost_template_sections
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));

create policy cost_template_items_select on public.cost_template_items
for select to authenticated
using (
  exists (
    select 1 from public.cost_templates t
    where t.id = template_id
      and (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('DA') or t.status = 'active')
  )
);

create policy cost_template_items_manage on public.cost_template_items
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));

create policy cost_template_parameters_select on public.cost_template_parameters
for select to authenticated
using (
  exists (
    select 1 from public.cost_templates t
    where t.id = template_id
      and (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('DA') or t.status = 'active')
  )
);

create policy cost_template_parameters_manage on public.cost_template_parameters
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));

create policy internal_price_book_select on public.internal_price_book
for select to authenticated
using (public.is_admin() or public.is_module_admin('HD'));

create policy internal_price_book_manage on public.internal_price_book
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));

create policy internal_norms_select on public.internal_norms
for select to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('DA'));

create policy internal_norms_manage on public.internal_norms
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));

create policy estimate_scenarios_select on public.estimate_scenarios
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or created_by = public.current_app_user_id()
);

create policy estimate_scenarios_insert on public.estimate_scenarios
for insert to authenticated
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or created_by = public.current_app_user_id()
);

create policy estimate_scenarios_update on public.estimate_scenarios
for update to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or created_by = public.current_app_user_id()
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or created_by = public.current_app_user_id()
);

create policy estimate_scenarios_delete on public.estimate_scenarios
for delete to authenticated
using (public.is_admin() or public.is_module_admin('HD'));

create policy estimate_items_select on public.estimate_items
for select to authenticated
using (
  exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or es.created_by = public.current_app_user_id()
      )
  )
);

create policy estimate_items_manage on public.estimate_items
for all to authenticated
using (
  exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or es.created_by = public.current_app_user_id()
      )
  )
)
with check (
  exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or es.created_by = public.current_app_user_id()
      )
  )
);

create policy estimate_adjustments_select on public.estimate_adjustments
for select to authenticated
using (
  exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or es.created_by = public.current_app_user_id()
      )
  )
);

create policy estimate_adjustments_manage on public.estimate_adjustments
for all to authenticated
using (
  exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or es.created_by = public.current_app_user_id()
      )
  )
)
with check (
  exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or es.created_by = public.current_app_user_id()
      )
  )
);

create policy estimate_versions_select on public.estimate_versions
for select to authenticated
using (
  exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or es.created_by = public.current_app_user_id()
      )
  )
);

create policy estimate_versions_insert on public.estimate_versions
for insert to authenticated
with check (
  exists (
    select 1 from public.estimate_scenarios es
    where es.id = estimate_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or es.created_by = public.current_app_user_id()
      )
  )
);

-- ───────────────────────────────────────────────────────────────
--  Minimal seed: factory template without fake prices
-- ───────────────────────────────────────────────────────────────

insert into public.cost_templates (
  id, code, name, project_type, description, status, version_no,
  effective_from, assumptions, metadata
)
values (
  'cost-template-factory-steel-v1',
  'NHAXUONG_THEP_TIEN_CHE',
  'Nhà xưởng thép tiền chế',
  'nha_xuong',
  'Template nền cho dự toán nhanh nhà xưởng. Đơn giá/định mức nội bộ do HD admin nhập riêng.',
  'active',
  1,
  current_date,
  jsonb_build_array('Template seed không chứa đơn giá giả. Cần nhập price book và norms active trước khi chốt estimate.'),
  jsonb_build_object('seeded', true, 'source', 'ai_estimation_cost_foundation_v1')
)
on conflict (code, version_no) do nothing;

insert into public.cost_template_parameters (
  id, template_id, code, label, data_type, unit, is_required, default_value, options, sort_order, description
)
select *
from (
  values
    ('cost-param-factory-floor-area', 'cost-template-factory-steel-v1', 'floor_area', 'Diện tích sàn', 'number', 'm2', true, null::jsonb, '[]'::jsonb, 10, 'Tổng diện tích sàn/diện tích xây dựng chính'),
    ('cost-param-factory-height', 'cost-template-factory-steel-v1', 'height', 'Chiều cao', 'number', 'm', true, null::jsonb, '[]'::jsonb, 20, 'Chiều cao nhà xưởng'),
    ('cost-param-factory-span', 'cost-template-factory-steel-v1', 'span', 'Khẩu độ', 'number', 'm', true, null::jsonb, '[]'::jsonb, 30, 'Khẩu độ chính'),
    ('cost-param-factory-foundation', 'cost-template-factory-steel-v1', 'foundation_type', 'Loại móng', 'select', '', false, null::jsonb, '["móng đơn","móng cọc","móng băng"]'::jsonb, 40, 'Loại móng dự kiến'),
    ('cost-param-factory-roof', 'cost-template-factory-steel-v1', 'roof_type', 'Loại mái', 'select', '', false, null::jsonb, '["tôn thường","tôn cách nhiệt"]'::jsonb, 50, 'Loại mái dự kiến'),
    ('cost-param-factory-wall', 'cost-template-factory-steel-v1', 'wall_type', 'Loại vách', 'select', '', false, null::jsonb, '["tôn","panel","xây tường"]'::jsonb, 60, 'Loại vách dự kiến'),
    ('cost-param-factory-crane', 'cost-template-factory-steel-v1', 'crane_capacity', 'Cầu trục', 'number', 'tấn', false, null::jsonb, '[]'::jsonb, 70, 'Tải trọng cầu trục nếu có'),
    ('cost-param-factory-finish', 'cost-template-factory-steel-v1', 'finish_level', 'Mức hoàn thiện', 'select', '', false, null::jsonb, '["cơ bản","trung bình","cao"]'::jsonb, 80, 'Mức hoàn thiện dự kiến'),
    ('cost-param-factory-region', 'cost-template-factory-steel-v1', 'region', 'Khu vực', 'select', '', false, '"all"'::jsonb, '["all","mien_bac","mien_nam"]'::jsonb, 90, 'Khu vực áp dụng đơn giá/định mức')
) as v(id, template_id, code, label, data_type, unit, is_required, default_value, options, sort_order, description)
where exists (select 1 from public.cost_templates t where t.id = 'cost-template-factory-steel-v1')
on conflict (template_id, code) do nothing;

insert into public.cost_template_sections (
  id, template_id, code, name, unit, calculation_method, sort_order, metadata
)
select *
from (
  values
    ('cost-section-factory-foundation', 'cost-template-factory-steel-v1', 'A', 'Móng', 'gói', 'Theo diện tích sàn và loại móng', 10, '{"seeded":true}'::jsonb),
    ('cost-section-factory-floor', 'cost-template-factory-steel-v1', 'B', 'Nền bê tông', 'm2', 'Theo diện tích sàn', 20, '{"seeded":true}'::jsonb),
    ('cost-section-factory-steel', 'cost-template-factory-steel-v1', 'C', 'Khung thép', 'kg', 'Theo diện tích sàn x hệ số kg/m2', 30, '{"seeded":true}'::jsonb),
    ('cost-section-factory-envelope', 'cost-template-factory-steel-v1', 'D', 'Mái và vách', 'm2', 'Theo diện tích sàn x hệ số bao che', 40, '{"seeded":true}'::jsonb),
    ('cost-section-factory-mep', 'cost-template-factory-steel-v1', 'E', 'MEP/PCCC', 'gói', 'Theo mức hoàn thiện', 50, '{"seeded":true}'::jsonb)
) as v(id, template_id, code, name, unit, calculation_method, sort_order, metadata)
where exists (select 1 from public.cost_templates t where t.id = 'cost-template-factory-steel-v1')
on conflict (template_id, code) do nothing;

insert into public.cost_template_items (
  id, template_id, section_id, code, name, item_type, unit, quantity_formula,
  default_waste_percent, overhead_percent, profit_percent, risk_buffer_percent,
  work_code, material_sku, sort_order, assumptions, metadata
)
select *
from (
  values
    ('cost-item-factory-foundation', 'cost-template-factory-steel-v1', 'cost-section-factory-foundation', 'A.01', 'Móng nhà xưởng', 'work', 'm2', 'floor_area', 0, 8, 10, 5, 'FOUNDATION', '', 10, '["Cần HD admin cấu hình đơn giá/định mức theo loại móng thực tế"]'::jsonb, '{"seeded":true}'::jsonb),
    ('cost-item-factory-floor', 'cost-template-factory-steel-v1', 'cost-section-factory-floor', 'B.01', 'Nền bê tông', 'work', 'm2', 'floor_area', 0, 8, 10, 5, 'CONCRETE_FLOOR', '', 20, '["Công thức seed dùng diện tích sàn, cần chỉnh theo chiều dày nền nếu có"]'::jsonb, '{"seeded":true}'::jsonb),
    ('cost-item-factory-steel', 'cost-template-factory-steel-v1', 'cost-section-factory-steel', 'C.01', 'Khung thép tiền chế', 'material', 'kg', 'floor_area * 35', 3, 8, 10, 5, 'STEEL_FRAME', 'STEEL_STRUCTURE', 30, '["Hệ số 35 kg/m2 là giả định template, cần review theo thiết kế"]'::jsonb, '{"seeded":true}'::jsonb),
    ('cost-item-factory-roof', 'cost-template-factory-steel-v1', 'cost-section-factory-envelope', 'D.01', 'Mái tôn', 'material', 'm2', 'floor_area * 1.16', 2, 8, 10, 3, 'ROOF', 'ROOF_SHEET', 40, '["Hệ số 1.16 là giả định mái seed"]'::jsonb, '{"seeded":true}'::jsonb),
    ('cost-item-factory-wall', 'cost-template-factory-steel-v1', 'cost-section-factory-envelope', 'D.02', 'Vách bao che', 'material', 'm2', 'floor_area * 0.55', 2, 8, 10, 3, 'WALL', 'WALL_SHEET', 50, '["Hệ số 0.55 là giả định vách seed"]'::jsonb, '{"seeded":true}'::jsonb),
    ('cost-item-factory-mep', 'cost-template-factory-steel-v1', 'cost-section-factory-mep', 'E.01', 'MEP/PCCC sơ bộ', 'subcontract', 'm2', 'floor_area', 0, 8, 10, 5, 'MEP_PCCC', '', 60, '["Cần cấu hình đơn giá thầu phụ theo mức hoàn thiện"]'::jsonb, '{"seeded":true}'::jsonb)
) as v(id, template_id, section_id, code, name, item_type, unit, quantity_formula, default_waste_percent, overhead_percent, profit_percent, risk_buffer_percent, work_code, material_sku, sort_order, assumptions, metadata)
where exists (select 1 from public.cost_templates t where t.id = 'cost-template-factory-steel-v1')
on conflict (template_id, code) do nothing;

-- ───────────────────────────────────────────────────────────────
--  AI read-only RPC tools
-- ───────────────────────────────────────────────────────────────

create or replace function public.ai_tool_estimate_module_blueprint()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return jsonb_build_object(
    'module', 'Đơn giá nội bộ & AI dự toán nhanh',
    'business_architecture', jsonb_build_array(
      'Chuẩn hóa metadata loại công trình/hạng mục để tái sử dụng cho chào thầu nhà xưởng.',
      'Dự toán được sinh từ template + định mức nội bộ + đơn giá nội bộ, luôn ở trạng thái draft trước khi người dùng review.',
      'Khi chốt có thể export báo giá; khi trúng thầu có thể chuyển estimate thành Contract BOQ / Work BOQ / Material Plan.'
    ),
    'data_model', jsonb_build_object(
      'templates', jsonb_build_array('cost_templates', 'cost_template_sections', 'cost_template_items', 'cost_template_parameters'),
      'pricing_and_norms', jsonb_build_array('internal_price_book', 'internal_norms'),
      'estimates', jsonb_build_array('estimate_scenarios', 'estimate_items', 'estimate_adjustments', 'estimate_versions')
    ),
    'versioning', jsonb_build_array(
      'Template, định mức và đơn giá đều có version_no, effective_from, effective_to, status.',
      'Không sửa đè dữ liệu đã dùng để chốt; tạo version mới khi thay đổi giá/định mức/template.',
      'Estimate lưu template_snapshot, price_book_snapshot, norms_snapshot và calculation_snapshot.'
    ),
    'supported_parameters', jsonb_build_array(
      'floor_area', 'height', 'span', 'foundation_type', 'roof_type',
      'wall_type', 'crane_capacity', 'finish_level', 'region'
    ),
    'ai_rules', jsonb_build_array(
      'AI không được bịa số liệu ngoài template/định mức/đơn giá đã có.',
      'AI phải ghi rõ giả định, dữ liệu thiếu, rủi ro và confidence_score.',
      'AI chỉ sinh draft; người dùng có quyền phải review và finalize.'
    ),
    'permissions', jsonb_build_object(
      'view_internal_price', 'ADMIN hoặc module admin HD',
      'edit_internal_price', 'ADMIN hoặc module admin HD',
      'create_estimate', 'ADMIN, module admin HD/DA hoặc người tạo estimate',
      'view_profit', 'Dữ liệu nhạy cảm, không trả qua AI tool mặc định',
      'export_quote', 'Workflow ứng dụng kiểm tra quyền trước khi export'
    ),
    'ui_ux', jsonb_build_array(
      'Quản lý template',
      'Quản lý định mức',
      'Quản lý đơn giá nội bộ',
      'Wizard tạo dự toán nhanh',
      'Bảng kết quả dự toán có chỉnh tay',
      'So sánh nhiều phương án',
      'AI assistant panel',
      'Export báo giá'
    ),
    'apis', jsonb_build_array(
      'costTemplateService.list/get/createVersion',
      'internalPriceBookService.lookup/createVersion',
      'internalNormService.lookup/createVersion',
      'estimateScenarioService.createDraft/recalculate/finalize/convertToBoq',
      'ai_tool_cost_template_summary',
      'ai_tool_internal_price_book_lookup',
      'ai_tool_internal_norms_lookup',
      'ai_tool_estimate_scenario_summary'
    ),
    'edge_cases', jsonb_build_array(
      'Thiếu tham số: AI hỏi lại trước khi tính.',
      'Chưa có đơn giá hoặc đơn giá quá cũ: cảnh báo, không tự bịa.',
      'Công thức không tính được: đánh dấu needs_review.',
      'Người dùng chỉnh tay: lưu manual_override và override_reason.',
      'Update đơn giá sau khi estimate chốt: estimate cũ giữ snapshot cũ.'
    ),
    'acceptance_criteria', jsonb_build_array(
      'AI chọn đúng template hoặc hỏi lại nếu thiếu thông tin.',
      'Estimate draft có assumptions, confidence_score, risk_warnings.',
      'Finalized estimate không đổi khi cập nhật price book/norm/template.',
      'Không user thường nào đọc được internal_price_book qua Data API.',
      'AI tool đơn giá chỉ chạy khi Edge Function xác nhận user có quyền.'
    )
  );
end;
$$;

create or replace function public.ai_tool_cost_template_summary(
  p_project_type text default null,
  p_keyword text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_kw text := '%' || lower(trim(coalesce(p_keyword, ''))) || '%';
  v_result jsonb;
begin
  with filtered as (
    select t.*
    from public.cost_templates t
    where t.status <> 'archived'
      and (p_project_type is null or lower(coalesce(t.project_type, '')) = lower(p_project_type))
      and (
        p_keyword is null
        or lower(t.code) like v_kw
        or lower(t.name) like v_kw
        or lower(coalesce(t.description, '')) like v_kw
      )
    order by case when t.status = 'active' then 0 else 1 end, t.effective_from desc, t.name
    limit 20
  )
  select jsonb_build_object(
    'total', count(*),
    'project_type_filter', p_project_type,
    'keyword', p_keyword,
    'templates', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'code', f.code,
        'name', f.name,
        'project_type', f.project_type,
        'status', f.status,
        'version_no', f.version_no,
        'effective_from', f.effective_from,
        'effective_to', f.effective_to,
        'assumptions', f.assumptions,
        'parameters', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'code', p.code,
            'label', p.label,
            'data_type', p.data_type,
            'unit', p.unit,
            'is_required', p.is_required,
            'default_value', p.default_value,
            'options', p.options,
            'validation_rules', p.validation_rules
          ) order by p.sort_order), '[]'::jsonb)
          from public.cost_template_parameters p
          where p.template_id = f.id
        ),
        'sections', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'code', s.code,
            'name', s.name,
            'sort_order', s.sort_order
          ) order by s.sort_order), '[]'::jsonb)
          from public.cost_template_sections s
          where s.template_id = f.id
        ),
        'sample_items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'code', i.code,
            'name', i.name,
            'item_type', i.item_type,
            'unit', i.unit,
            'quantity_formula', i.quantity_formula,
            'work_code', i.work_code,
            'norm_group_code', i.norm_group_code
          ) order by i.sort_order), '[]'::jsonb)
          from (
            select *
            from public.cost_template_items i
            where i.template_id = f.id
            order by i.sort_order
            limit 30
          ) i
        )
      )
    ), '[]'::jsonb)
  )
  into v_result
  from filtered f;

  return v_result;
end;
$$;

create or replace function public.ai_tool_internal_price_book_lookup(
  p_keyword text,
  p_region text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_kw text := '%' || lower(trim(coalesce(p_keyword, ''))) || '%';
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_result jsonb;
begin
  select jsonb_build_object(
    'keyword', trim(coalesce(p_keyword, '')),
    'region_filter', p_region,
    'security_note', 'Đơn giá nội bộ là dữ liệu nhạy cảm; chỉ trả qua Edge Function sau khi xác nhận quyền.',
    'total_found', count(*),
    'prices', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'item_code', s.item_code,
        'item_name', s.item_name,
        'item_type', s.item_type,
        'category', s.category,
        'spec', s.spec,
        'unit', s.unit,
        'region', s.region,
        'brand', s.brand,
        'currency', s.currency,
        'unit_price', s.unit_price,
        'version_no', s.version_no,
        'effective_from', s.effective_from,
        'effective_to', s.effective_to,
        'status', s.status,
        'sensitivity_level', s.sensitivity_level
      )
      order by s.item_name, s.region, s.effective_from desc
    ), '[]'::jsonb)
  )
  into v_result
  from (
    select *
    from public.internal_price_book ipb
    where ipb.status = 'active'
      and (ipb.effective_from <= current_date)
      and (ipb.effective_to is null or ipb.effective_to >= current_date)
      and (p_region is null or lower(ipb.region) in ('all', lower(p_region)))
      and (
        lower(ipb.item_code) like v_kw
        or lower(ipb.item_name) like v_kw
        or lower(coalesce(ipb.category, '')) like v_kw
        or lower(coalesce(ipb.spec, '')) like v_kw
      )
    order by ipb.item_name, ipb.region, ipb.effective_from desc
    limit v_limit
  ) s;

  return v_result;
end;
$$;

create or replace function public.ai_tool_internal_norms_lookup(
  p_keyword text,
  p_region text default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_kw text := '%' || lower(trim(coalesce(p_keyword, ''))) || '%';
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_result jsonb;
begin
  select jsonb_build_object(
    'keyword', trim(coalesce(p_keyword, '')),
    'region_filter', p_region,
    'security_note', 'Định mức nội bộ chỉ là căn cứ dự toán draft, cần người có quyền review.',
    'total_found', count(*),
    'norms', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'norm_code', s.norm_code,
        'work_code', s.work_code,
        'resource_code', s.resource_code,
        'resource_name', s.resource_name,
        'resource_type', s.resource_type,
        'unit', s.unit,
        'norm_quantity', s.norm_quantity,
        'waste_percent', s.waste_percent,
        'formula', s.formula,
        'applicable_parameters', s.applicable_parameters,
        'region', s.region,
        'version_no', s.version_no,
        'effective_from', s.effective_from,
        'effective_to', s.effective_to,
        'confidence_score', s.confidence_score
      )
      order by s.norm_code, s.region, s.effective_from desc
    ), '[]'::jsonb)
  )
  into v_result
  from (
    select *
    from public.internal_norms n
    where n.status = 'active'
      and (n.effective_from <= current_date)
      and (n.effective_to is null or n.effective_to >= current_date)
      and (p_region is null or lower(n.region) in ('all', lower(p_region)))
      and (
        lower(n.norm_code) like v_kw
        or lower(coalesce(n.work_code, '')) like v_kw
        or lower(coalesce(n.resource_code, '')) like v_kw
        or lower(n.resource_name) like v_kw
      )
    order by n.norm_code, n.region, n.effective_from desc
    limit v_limit
  ) s;

  return v_result;
end;
$$;

create or replace function public.ai_tool_estimate_scenario_summary(
  p_project_id text default null,
  p_status text default null,
  p_keyword text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_kw text := '%' || lower(trim(coalesce(p_keyword, ''))) || '%';
  v_result jsonb;
begin
  with filtered as (
    select es.*
    from public.estimate_scenarios es
    where (p_project_id is null or es.project_id = p_project_id or es.construction_site_id = p_project_id)
      and (p_status is null or es.status = p_status)
      and (
        p_keyword is null
        or lower(coalesce(es.code, '')) like v_kw
        or lower(es.name) like v_kw
        or lower(coalesce(es.customer_name, '')) like v_kw
        or lower(coalesce(es.project_type, '')) like v_kw
      )
    order by es.created_at desc
    limit 30
  )
  select jsonb_build_object(
    'total', count(*),
    'filters', jsonb_build_object(
      'project_id', p_project_id,
      'status', p_status,
      'keyword', p_keyword
    ),
    'summary', jsonb_build_object(
      'draft', count(*) filter (where status = 'draft'),
      'reviewed', count(*) filter (where status = 'reviewed'),
      'finalized', count(*) filter (where status = 'finalized'),
      'converted', count(*) filter (where status = 'converted'),
      'total_quote_amount', coalesce(sum(quote_amount), 0)
    ),
    'scenarios', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'code', f.code,
        'name', f.name,
        'project_id', f.project_id,
        'construction_site_id', f.construction_site_id,
        'customer_name', f.customer_name,
        'project_type', f.project_type,
        'status', f.status,
        'template_id', f.template_id,
        'template_version_no', f.template_version_no,
        'missing_parameters', f.missing_parameters,
        'assumptions', f.assumptions,
        'risk_warnings', f.risk_warnings,
        'confidence_score', f.confidence_score,
        'quote_amount', f.quote_amount,
        'currency', f.currency,
        'converted_project_id', f.converted_project_id,
        'converted_contract_id', f.converted_contract_id,
        'created_at', f.created_at,
        'updated_at', f.updated_at,
        'item_count', (
          select count(*)
          from public.estimate_items ei
          where ei.estimate_id = f.id
        )
      )
      order by f.created_at desc
    ), '[]'::jsonb)
  )
  into v_result
  from filtered f;

  return v_result;
end;
$$;

revoke all on function public.ai_tool_estimate_module_blueprint() from public, anon, authenticated;
revoke all on function public.ai_tool_cost_template_summary(text, text) from public, anon, authenticated;
revoke all on function public.ai_tool_internal_price_book_lookup(text, text, integer) from public, anon, authenticated;
revoke all on function public.ai_tool_internal_norms_lookup(text, text, integer) from public, anon, authenticated;
revoke all on function public.ai_tool_estimate_scenario_summary(text, text, text) from public, anon, authenticated;

grant execute on function public.ai_tool_estimate_module_blueprint() to service_role;
grant execute on function public.ai_tool_cost_template_summary(text, text) to service_role;
grant execute on function public.ai_tool_internal_price_book_lookup(text, text, integer) to service_role;
grant execute on function public.ai_tool_internal_norms_lookup(text, text, integer) to service_role;
grant execute on function public.ai_tool_estimate_scenario_summary(text, text, text) to service_role;

notify pgrst, 'reload schema';
