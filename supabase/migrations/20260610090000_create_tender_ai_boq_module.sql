-- Tender AI BOQ Analyzer & Internal Repricing
-- Stores owner BOQ Excel imports, AI/user-reviewed mappings, internal pricing
-- lines, RFI/risk suggestions, and export audit. Internal cost lines are kept
-- in a separate RLS-protected table.

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

create table if not exists public.tender_packages (
  id text primary key default gen_random_uuid()::text,
  code text not null unique,
  name text not null,
  customer_name text,
  project_type text,
  source_project_id text,
  source_template_id text references public.cost_templates(id) on delete set null,
  status text not null default 'uploaded'
    check (status in (
      'uploaded', 'parsed', 'mapping_review', 'priced', 'risk_review',
      'approved_for_bid', 'exported', 'submitted', 'won', 'lost', 'cancelled'
    )),
  currency text not null default 'VND',
  total_owner_amount numeric(18, 2) not null default 0,
  total_quote_amount numeric(18, 2) not null default 0,
  line_count integer not null default 0,
  mapped_line_count integer not null default 0,
  confidence_score numeric(5, 4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  result_note text,
  won_project_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tender_documents (
  id text primary key default gen_random_uuid()::text,
  package_id text not null references public.tender_packages(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'xlsx',
  file_size bigint,
  storage_path text,
  selected_sheet text,
  workbook_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsed', 'archived')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tender_column_mappings (
  id text primary key default gen_random_uuid()::text,
  document_id text not null references public.tender_documents(id) on delete cascade,
  sheet_name text not null,
  header_row integer,
  mapping jsonb not null default '{}'::jsonb,
  source text not null default 'user' check (source in ('ai', 'user', 'local')),
  confidence_score numeric(5, 4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  notes jsonb not null default '[]'::jsonb,
  confirmed_by uuid references public.users(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_column_mappings_document_sheet_uniq unique (document_id, sheet_name)
);

create table if not exists public.tender_external_boq_lines (
  id text primary key default gen_random_uuid()::text,
  package_id text not null references public.tender_packages(id) on delete cascade,
  document_id text not null references public.tender_documents(id) on delete cascade,
  sheet_name text not null,
  row_number integer not null,
  line_no text,
  parent_line_id text references public.tender_external_boq_lines(id) on delete set null,
  item_code text,
  name text,
  description text,
  unit text,
  quantity numeric(18, 6),
  owner_unit_price numeric(18, 2),
  owner_amount numeric(18, 2),
  note text,
  line_type text not null default 'work'
    check (line_type in ('section', 'subsection', 'work', 'material', 'total', 'note', 'empty', 'other')),
  normalized_text text,
  raw_values jsonb not null default '{}'::jsonb,
  ai_classification jsonb not null default '{}'::jsonb,
  confidence_score numeric(5, 4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  status text not null default 'parsed'
    check (status in ('parsed', 'classified', 'ignored', 'mapped', 'priced')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_external_boq_lines_doc_row_uniq unique (document_id, sheet_name, row_number)
);

create table if not exists public.tender_internal_mappings (
  id text primary key default gen_random_uuid()::text,
  package_id text not null references public.tender_packages(id) on delete cascade,
  external_line_id text not null references public.tender_external_boq_lines(id) on delete cascade,
  template_id text references public.cost_templates(id) on delete set null,
  template_section_id text references public.cost_template_sections(id) on delete set null,
  template_item_id text references public.cost_template_items(id) on delete set null,
  work_code text,
  norm_group_code text,
  mapping_status text not null default 'needs_review'
    check (mapping_status in ('matched', 'needs_review', 'unmatched', 'ignored')),
  mapping_source text not null default 'user'
    check (mapping_source in ('ai', 'user', 'rule', 'local')),
  confidence_score numeric(5, 4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tender_internal_mappings_line_uniq unique (external_line_id)
);

create table if not exists public.tender_mapping_rules (
  id text primary key default gen_random_uuid()::text,
  source_text_pattern text not null,
  source_unit text,
  template_id text references public.cost_templates(id) on delete set null,
  template_item_id text references public.cost_template_items(id) on delete set null,
  work_code text,
  norm_group_code text,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  confidence_score numeric(5, 4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  usage_count integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tender_pricing_lines (
  id text primary key default gen_random_uuid()::text,
  package_id text not null references public.tender_packages(id) on delete cascade,
  external_line_id text references public.tender_external_boq_lines(id) on delete cascade,
  mapping_id text references public.tender_internal_mappings(id) on delete set null,
  item_type text not null default 'work'
    check (item_type in ('work', 'material', 'labor', 'machine', 'subcontract', 'overhead', 'risk', 'other')),
  cost_code text,
  description text not null,
  unit text,
  quantity numeric(18, 6) not null default 0 check (quantity >= 0),
  unit_cost numeric(18, 2) not null default 0 check (unit_cost >= 0),
  cost_amount numeric(18, 2) not null default 0 check (cost_amount >= 0),
  quote_unit_price numeric(18, 2),
  quote_amount numeric(18, 2),
  price_book_item_id text references public.internal_price_book(id) on delete set null,
  norm_id text references public.internal_norms(id) on delete set null,
  waste_percent numeric(8, 4) not null default 0,
  overhead_percent numeric(8, 4) not null default 0,
  profit_percent numeric(8, 4) not null default 0,
  risk_buffer_percent numeric(8, 4) not null default 0,
  pricing_source text not null default 'system'
    check (pricing_source in ('system', 'manual', 'missing')),
  missing_reason text,
  is_internal_only boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tender_risks (
  id text primary key default gen_random_uuid()::text,
  package_id text not null references public.tender_packages(id) on delete cascade,
  external_line_id text references public.tender_external_boq_lines(id) on delete set null,
  risk_type text not null default 'scope',
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  title text not null,
  description text,
  suggested_rfi text,
  status text not null default 'open' check (status in ('open', 'accepted', 'ignored', 'resolved')),
  source text not null default 'ai' check (source in ('ai', 'user', 'system')),
  confidence_score numeric(5, 4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tender_exports (
  id text primary key default gen_random_uuid()::text,
  package_id text not null references public.tender_packages(id) on delete cascade,
  export_type text not null check (export_type in ('external_quote', 'internal_workbook')),
  file_name text not null,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.tender_ai_logs (
  id text primary key default gen_random_uuid()::text,
  package_id text references public.tender_packages(id) on delete cascade,
  action text not null,
  request_summary jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  confidence_score numeric(5, 4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tender_packages_status
  on public.tender_packages(status, created_at desc);
create index if not exists idx_tender_packages_created_by
  on public.tender_packages(created_by, created_at desc);
create index if not exists idx_tender_documents_package
  on public.tender_documents(package_id, created_at desc);
create index if not exists idx_tender_external_lines_package
  on public.tender_external_boq_lines(package_id, sheet_name, row_number);
create index if not exists idx_tender_external_lines_text_trgm
  on public.tender_external_boq_lines using gin (normalized_text gin_trgm_ops);
create index if not exists idx_tender_internal_mappings_package
  on public.tender_internal_mappings(package_id, mapping_status, confidence_score);
create index if not exists idx_tender_mapping_rules_text_trgm
  on public.tender_mapping_rules using gin (source_text_pattern gin_trgm_ops);
create index if not exists idx_tender_pricing_lines_package
  on public.tender_pricing_lines(package_id, external_line_id);
create index if not exists idx_tender_risks_package
  on public.tender_risks(package_id, severity, status);
create index if not exists idx_tender_exports_package
  on public.tender_exports(package_id, created_at desc);
create index if not exists idx_tender_ai_logs_package
  on public.tender_ai_logs(package_id, action, created_at desc);

drop trigger if exists trg_tender_packages_updated_at on public.tender_packages;
create trigger trg_tender_packages_updated_at
before update on public.tender_packages
for each row execute function public.set_updated_at();

drop trigger if exists trg_tender_documents_updated_at on public.tender_documents;
create trigger trg_tender_documents_updated_at
before update on public.tender_documents
for each row execute function public.set_updated_at();

drop trigger if exists trg_tender_column_mappings_updated_at on public.tender_column_mappings;
create trigger trg_tender_column_mappings_updated_at
before update on public.tender_column_mappings
for each row execute function public.set_updated_at();

drop trigger if exists trg_tender_external_boq_lines_updated_at on public.tender_external_boq_lines;
create trigger trg_tender_external_boq_lines_updated_at
before update on public.tender_external_boq_lines
for each row execute function public.set_updated_at();

drop trigger if exists trg_tender_internal_mappings_updated_at on public.tender_internal_mappings;
create trigger trg_tender_internal_mappings_updated_at
before update on public.tender_internal_mappings
for each row execute function public.set_updated_at();

drop trigger if exists trg_tender_mapping_rules_updated_at on public.tender_mapping_rules;
create trigger trg_tender_mapping_rules_updated_at
before update on public.tender_mapping_rules
for each row execute function public.set_updated_at();

drop trigger if exists trg_tender_pricing_lines_updated_at on public.tender_pricing_lines;
create trigger trg_tender_pricing_lines_updated_at
before update on public.tender_pricing_lines
for each row execute function public.set_updated_at();

drop trigger if exists trg_tender_risks_updated_at on public.tender_risks;
create trigger trg_tender_risks_updated_at
before update on public.tender_risks
for each row execute function public.set_updated_at();

alter table public.tender_packages enable row level security;
alter table public.tender_documents enable row level security;
alter table public.tender_column_mappings enable row level security;
alter table public.tender_external_boq_lines enable row level security;
alter table public.tender_internal_mappings enable row level security;
alter table public.tender_mapping_rules enable row level security;
alter table public.tender_pricing_lines enable row level security;
alter table public.tender_risks enable row level security;
alter table public.tender_exports enable row level security;
alter table public.tender_ai_logs enable row level security;

grant select, insert, update, delete on public.tender_packages to authenticated;
grant select, insert, update, delete on public.tender_documents to authenticated;
grant select, insert, update, delete on public.tender_column_mappings to authenticated;
grant select, insert, update, delete on public.tender_external_boq_lines to authenticated;
grant select, insert, update, delete on public.tender_internal_mappings to authenticated;
grant select, insert, update, delete on public.tender_mapping_rules to authenticated;
grant select, insert, update, delete on public.tender_pricing_lines to authenticated;
grant select, insert, update, delete on public.tender_risks to authenticated;
grant select, insert on public.tender_exports to authenticated;
grant select, insert on public.tender_ai_logs to authenticated;

drop policy if exists tender_packages_select on public.tender_packages;
create policy tender_packages_select on public.tender_packages
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or created_by = public.current_app_user_id()
);

drop policy if exists tender_packages_insert on public.tender_packages;
create policy tender_packages_insert on public.tender_packages
for insert to authenticated
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or created_by = public.current_app_user_id()
);

drop policy if exists tender_packages_update on public.tender_packages;
create policy tender_packages_update on public.tender_packages
for update to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or created_by = public.current_app_user_id()
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or created_by = public.current_app_user_id()
);

drop policy if exists tender_packages_delete on public.tender_packages;
create policy tender_packages_delete on public.tender_packages
for delete to authenticated
using (public.is_admin() or public.is_module_admin('HD'));

drop policy if exists tender_documents_access on public.tender_documents;
create policy tender_documents_access on public.tender_documents
for all to authenticated
using (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
)
with check (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
);

drop policy if exists tender_column_mappings_access on public.tender_column_mappings;
create policy tender_column_mappings_access on public.tender_column_mappings
for all to authenticated
using (
  exists (
    select 1
    from public.tender_documents d
    join public.tender_packages p on p.id = d.package_id
    where d.id = document_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
)
with check (
  exists (
    select 1
    from public.tender_documents d
    join public.tender_packages p on p.id = d.package_id
    where d.id = document_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
);

drop policy if exists tender_external_boq_lines_access on public.tender_external_boq_lines;
create policy tender_external_boq_lines_access on public.tender_external_boq_lines
for all to authenticated
using (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
)
with check (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
);

drop policy if exists tender_internal_mappings_access on public.tender_internal_mappings;
create policy tender_internal_mappings_access on public.tender_internal_mappings
for all to authenticated
using (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
)
with check (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
);

drop policy if exists tender_mapping_rules_select on public.tender_mapping_rules;
create policy tender_mapping_rules_select on public.tender_mapping_rules
for select to authenticated
using (status = 'active' or public.is_admin() or public.is_module_admin('HD'));

drop policy if exists tender_mapping_rules_manage on public.tender_mapping_rules;
create policy tender_mapping_rules_manage on public.tender_mapping_rules
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD') or created_by = public.current_app_user_id())
with check (public.is_admin() or public.is_module_admin('HD') or created_by = public.current_app_user_id());

drop policy if exists tender_pricing_lines_select on public.tender_pricing_lines;
create policy tender_pricing_lines_select on public.tender_pricing_lines
for select to authenticated
using (public.is_admin() or public.is_module_admin('HD'));

drop policy if exists tender_pricing_lines_manage on public.tender_pricing_lines;
create policy tender_pricing_lines_manage on public.tender_pricing_lines
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD'))
with check (public.is_admin() or public.is_module_admin('HD'));

drop policy if exists tender_risks_access on public.tender_risks;
create policy tender_risks_access on public.tender_risks
for all to authenticated
using (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
)
with check (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (public.is_admin() or public.is_module_admin('HD') or p.created_by = public.current_app_user_id())
  )
);

drop policy if exists tender_exports_select on public.tender_exports;
create policy tender_exports_select on public.tender_exports
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or (
    export_type = 'external_quote'
    and exists (
      select 1 from public.tender_packages p
      where p.id = package_id
        and p.created_by = public.current_app_user_id()
    )
  )
);

drop policy if exists tender_exports_insert on public.tender_exports;
create policy tender_exports_insert on public.tender_exports
for insert to authenticated
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or (
    export_type = 'external_quote'
    and exists (
      select 1 from public.tender_packages p
      where p.id = package_id
        and p.created_by = public.current_app_user_id()
    )
  )
);

drop policy if exists tender_ai_logs_select on public.tender_ai_logs;
create policy tender_ai_logs_select on public.tender_ai_logs
for select to authenticated
using (public.is_admin() or public.is_module_admin('HD'));

drop policy if exists tender_ai_logs_insert on public.tender_ai_logs;
create policy tender_ai_logs_insert on public.tender_ai_logs
for insert to authenticated
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or created_by = public.current_app_user_id()
);
