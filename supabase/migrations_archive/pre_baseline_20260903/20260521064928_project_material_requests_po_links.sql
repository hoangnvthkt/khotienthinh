-- Project material requests and PO line traceability.
-- Keep the existing WMS requests/PO JSONB flow, add project/BOQ context and PO-request line links.

alter table if exists public.requests
  add column if not exists project_id text references public.projects(id) on delete set null,
  add column if not exists construction_site_id text,
  add column if not exists request_origin text not null default 'wms'
    check (request_origin in ('wms', 'project'));

create index if not exists idx_requests_project_origin_created
  on public.requests(project_id, request_origin, created_date desc)
  where project_id is not null;

create index if not exists idx_requests_construction_site_origin_created
  on public.requests(construction_site_id, request_origin, created_date desc)
  where construction_site_id is not null;

alter table if exists public.purchase_orders
  add column if not exists source_mode text not null default 'proactive_project'
    check (source_mode in ('from_request', 'proactive_project', 'proactive_stock'));

create index if not exists idx_purchase_orders_source_mode_created
  on public.purchase_orders(source_mode, created_at desc);

create table if not exists public.purchase_order_request_lines (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  purchase_order_line_id text not null,
  material_request_id text not null references public.requests(id) on delete cascade,
  material_request_code text,
  request_line_id text not null,
  item_id text not null,
  work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
  material_budget_item_id text references public.material_budget_items(id) on delete set null,
  requested_qty numeric not null default 0,
  ordered_qty numeric not null default 0,
  unit text,
  note text,
  created_at timestamptz not null default now(),
  unique(purchase_order_id, purchase_order_line_id, material_request_id, request_line_id)
);

create index if not exists idx_po_request_lines_po
  on public.purchase_order_request_lines(purchase_order_id);

create index if not exists idx_po_request_lines_request
  on public.purchase_order_request_lines(material_request_id, request_line_id);

create index if not exists idx_po_request_lines_project
  on public.purchase_order_request_lines(project_id, created_at desc)
  where project_id is not null;

create index if not exists idx_po_request_lines_site
  on public.purchase_order_request_lines(construction_site_id, created_at desc)
  where construction_site_id is not null;

create index if not exists idx_po_request_lines_material_budget
  on public.purchase_order_request_lines(material_budget_item_id)
  where material_budget_item_id is not null;

alter table public.purchase_order_request_lines enable row level security;

drop policy if exists purchase_order_request_lines_project_access
  on public.purchase_order_request_lines;

create policy purchase_order_request_lines_project_access
  on public.purchase_order_request_lines
  for all
  to authenticated
  using (project_id is not null or construction_site_id is not null or purchase_order_id is not null)
  with check (project_id is not null or construction_site_id is not null or purchase_order_id is not null);

revoke all on table public.purchase_order_request_lines from anon;
revoke all on table public.purchase_order_request_lines from public;
revoke all on table public.purchase_order_request_lines from authenticated;
grant select, insert, update, delete on table public.purchase_order_request_lines to authenticated;

notify pgrst, 'reload schema';
