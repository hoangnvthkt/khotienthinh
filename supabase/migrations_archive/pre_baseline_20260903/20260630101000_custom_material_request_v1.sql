-- Custom Material Request v1: project-scoped non-standard material/spec requests.

insert into storage.buckets (id, name, public, file_size_limit)
values ('custom-material-attachments', 'custom-material-attachments', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create or replace function app_private.custom_material_request_can_select(
  p_project_id text,
  p_construction_site_id text,
  p_created_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('DA')
    or public.is_module_admin('WMS')
    or app_private.company_procurement_can_manage()
    or p_created_by = public.current_app_user_id()
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'confirm')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'view_available_stock');
$$;

create or replace function app_private.custom_material_request_can_mutate(
  p_project_id text,
  p_construction_site_id text,
  p_created_by uuid,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('DA')
    or (
      p_status in ('draft', 'returned')
      and (
        p_created_by = public.current_app_user_id()
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit')
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
      )
    )
    or (
      p_status in ('submitted', 'approved', 'rfq_created', 'po_created', 'partially_received')
      and (
        public.is_module_admin('WMS')
        or app_private.company_procurement_can_manage()
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve')
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'confirm')
      )
    );
$$;

create or replace function app_private.custom_material_storage_request_id(p_path text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when split_part(coalesce(p_path, ''), '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_path, '/', 1)::uuid
    else null::uuid
  end;
$$;

create table if not exists public.custom_material_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null default 'De xuat vat tu phi tieu chuan',
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  work_package text,
  work_section text,
  request_scope text,
  template_key text not null default 'generic'
    check (template_key in ('generic', 'xa_go')),
  requesting_department text,
  requested_by_name text,
  needed_date date,
  note text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'returned', 'rejected', 'cancelled', 'rfq_created', 'po_created', 'partially_received', 'completed')),
  revision integer not null default 1,
  source_excel_attachment_id uuid,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references public.users(id) on delete set null,
  returned_at timestamptz,
  returned_by uuid references public.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(id) on delete set null,
  created_by uuid not null default public.current_app_user_id() references public.users(id) on delete restrict,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.custom_material_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_material_requests(id) on delete cascade,
  line_code text not null unique,
  sort_order integer not null default 0,
  group_key text not null default 'other',
  profile_type text not null default 'other',
  description text not null,
  effective_width numeric,
  length numeric,
  quantity numeric not null default 0,
  area_m2 numeric,
  length_md numeric,
  thickness numeric,
  color text,
  unit text not null default 'tam',
  technical_note text,
  spec_json jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rfq_created', 'quoted', 'ordered', 'partially_received', 'received', 'closed', 'cancelled')),
  ordered_qty numeric not null default 0,
  received_qty numeric not null default 0,
  quote_unit_price numeric,
  quote_amount numeric,
  selected_supplier_id text,
  selected_supplier_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.custom_material_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_material_requests(id) on delete cascade,
  line_id uuid references public.custom_material_request_lines(id) on delete cascade,
  storage_bucket text not null default 'custom-material-attachments',
  storage_path text not null,
  file_name text not null,
  file_type text not null default 'other'
    check (file_type in ('excel_source', 'image', 'drawing', 'cad', 'pdf', 'quote', 'receipt', 'other')),
  mime_type text,
  file_size bigint,
  revision integer not null default 1,
  is_primary boolean not null default false,
  uploaded_by uuid not null default public.current_app_user_id() references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(storage_bucket, storage_path)
);

create table if not exists public.custom_material_request_imports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.custom_material_requests(id) on delete cascade,
  source_attachment_id uuid references public.custom_material_request_attachments(id) on delete set null,
  file_name text not null,
  column_mapping jsonb not null default '{}'::jsonb,
  preview_rows jsonb not null default '[]'::jsonb,
  applied boolean not null default false,
  imported_by uuid not null default public.current_app_user_id() references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.custom_material_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custom_material_requests(id) on delete cascade,
  line_id uuid references public.custom_material_request_lines(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  actor_user_id uuid default public.current_app_user_id() references public.users(id) on delete set null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.custom_material_rfqs (
  id uuid primary key default gen_random_uuid(),
  rfq_no text not null unique,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'quoted', 'awarded', 'cancelled')),
  title text,
  note text,
  created_by uuid not null default public.current_app_user_id() references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.custom_material_rfq_lines (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.custom_material_rfqs(id) on delete cascade,
  request_id uuid not null references public.custom_material_requests(id) on delete cascade,
  line_id uuid not null references public.custom_material_request_lines(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(rfq_id, line_id)
);

create table if not exists public.custom_material_rfq_suppliers (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.custom_material_rfqs(id) on delete cascade,
  supplier_id text not null,
  supplier_name text,
  status text not null default 'invited'
    check (status in ('invited', 'quoted', 'awarded', 'declined')),
  quote_unit_price numeric,
  quote_amount numeric,
  delivery_date date,
  note text,
  quote_attachment_id uuid references public.custom_material_request_attachments(id) on delete set null,
  quote_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(rfq_id, supplier_id)
);

create table if not exists public.custom_material_po_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text references public.purchase_orders(id) on delete cascade,
  purchase_order_line_id text not null,
  request_id uuid not null references public.custom_material_requests(id) on delete cascade,
  line_id uuid not null references public.custom_material_request_lines(id) on delete cascade,
  rfq_id uuid references public.custom_material_rfqs(id) on delete set null,
  supplier_id text,
  supplier_name text,
  ordered_qty numeric not null default 0,
  received_qty numeric not null default 0,
  unit text,
  unit_price numeric,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(purchase_order_id, purchase_order_line_id, line_id)
);

create or replace function app_private.custom_material_storage_can_select(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.custom_material_requests r
    where r.id = app_private.custom_material_storage_request_id(p_path)
      and app_private.custom_material_request_can_select(r.project_id, r.construction_site_id, r.created_by)
  );
$$;

create or replace function app_private.custom_material_storage_can_mutate(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.custom_material_requests r
    where r.id = app_private.custom_material_storage_request_id(p_path)
      and app_private.custom_material_request_can_mutate(r.project_id, r.construction_site_id, r.created_by, r.status)
  );
$$;

alter table public.custom_material_requests
  drop constraint if exists custom_material_requests_project_required;

alter table public.custom_material_requests
  add constraint custom_material_requests_project_required
  check (project_id is not null or construction_site_id is not null);

create index if not exists idx_custom_material_requests_project_status
  on public.custom_material_requests(project_id, construction_site_id, status, created_at desc);
create index if not exists idx_custom_material_lines_request
  on public.custom_material_request_lines(request_id, sort_order);
create index if not exists idx_custom_material_lines_status
  on public.custom_material_request_lines(status, updated_at desc);
create index if not exists idx_custom_material_attachments_request
  on public.custom_material_request_attachments(request_id, line_id);
create index if not exists idx_custom_material_events_request
  on public.custom_material_request_events(request_id, created_at desc);
create index if not exists idx_custom_material_rfq_lines_line
  on public.custom_material_rfq_lines(line_id);
create index if not exists idx_custom_material_po_lines_line
  on public.custom_material_po_lines(line_id);

drop trigger if exists trg_custom_material_requests_updated_at on public.custom_material_requests;
create trigger trg_custom_material_requests_updated_at
before update on public.custom_material_requests
for each row execute function public.set_project_workflow_updated_at();

drop trigger if exists trg_custom_material_lines_updated_at on public.custom_material_request_lines;
create trigger trg_custom_material_lines_updated_at
before update on public.custom_material_request_lines
for each row execute function public.set_project_workflow_updated_at();

drop trigger if exists trg_custom_material_rfqs_updated_at on public.custom_material_rfqs;
create trigger trg_custom_material_rfqs_updated_at
before update on public.custom_material_rfqs
for each row execute function public.set_project_workflow_updated_at();

drop trigger if exists trg_custom_material_rfq_suppliers_updated_at on public.custom_material_rfq_suppliers;
create trigger trg_custom_material_rfq_suppliers_updated_at
before update on public.custom_material_rfq_suppliers
for each row execute function public.set_project_workflow_updated_at();

drop trigger if exists trg_custom_material_po_lines_updated_at on public.custom_material_po_lines;
create trigger trg_custom_material_po_lines_updated_at
before update on public.custom_material_po_lines
for each row execute function public.set_project_workflow_updated_at();

do $$
begin
  if to_regclass('public.workflow_subjects') is not null then
    alter table public.workflow_subjects
      drop constraint if exists workflow_subjects_subject_type_check;
    alter table public.workflow_subjects
      add constraint workflow_subjects_subject_type_check
      check (subject_type in ('material_request', 'custom_material_request'));
  end if;

  if to_regclass('public.project_workflow_bindings') is not null then
    alter table public.project_workflow_bindings
      drop constraint if exists project_workflow_bindings_subject_type_check;
    alter table public.project_workflow_bindings
      add constraint project_workflow_bindings_subject_type_check
      check (subject_type in ('material_request', 'custom_material_request'));
  end if;
end $$;

alter table public.custom_material_requests enable row level security;
alter table public.custom_material_request_lines enable row level security;
alter table public.custom_material_request_attachments enable row level security;
alter table public.custom_material_request_imports enable row level security;
alter table public.custom_material_request_events enable row level security;
alter table public.custom_material_rfqs enable row level security;
alter table public.custom_material_rfq_lines enable row level security;
alter table public.custom_material_rfq_suppliers enable row level security;
alter table public.custom_material_po_lines enable row level security;

drop policy if exists custom_material_requests_select on public.custom_material_requests;
create policy custom_material_requests_select
  on public.custom_material_requests for select to authenticated
  using (app_private.custom_material_request_can_select(project_id, construction_site_id, created_by));

drop policy if exists custom_material_requests_insert on public.custom_material_requests;
create policy custom_material_requests_insert
  on public.custom_material_requests for insert to authenticated
  with check (
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_user_has_permission(project_id, construction_site_id, 'submit')
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  );

drop policy if exists custom_material_requests_update on public.custom_material_requests;
create policy custom_material_requests_update
  on public.custom_material_requests for update to authenticated
  using (app_private.custom_material_request_can_mutate(project_id, construction_site_id, created_by, status))
  with check (app_private.custom_material_request_can_select(project_id, construction_site_id, created_by));

drop policy if exists custom_material_requests_delete on public.custom_material_requests;
create policy custom_material_requests_delete
  on public.custom_material_requests for delete to authenticated
  using (
    status in ('draft', 'cancelled')
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or created_by = public.current_app_user_id()
    )
  );

drop policy if exists custom_material_lines_select on public.custom_material_request_lines;
create policy custom_material_lines_select
  on public.custom_material_request_lines for select to authenticated
  using (
    exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_select(r.project_id, r.construction_site_id, r.created_by)
    )
  );

drop policy if exists custom_material_lines_mutate on public.custom_material_request_lines;
create policy custom_material_lines_mutate
  on public.custom_material_request_lines for all to authenticated
  using (
    exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_mutate(r.project_id, r.construction_site_id, r.created_by, r.status)
    )
  )
  with check (
    exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_mutate(r.project_id, r.construction_site_id, r.created_by, r.status)
    )
  );

drop policy if exists custom_material_attachments_select on public.custom_material_request_attachments;
create policy custom_material_attachments_select
  on public.custom_material_request_attachments for select to authenticated
  using (
    exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_select(r.project_id, r.construction_site_id, r.created_by)
    )
  );

drop policy if exists custom_material_attachments_mutate on public.custom_material_request_attachments;
create policy custom_material_attachments_mutate
  on public.custom_material_request_attachments for all to authenticated
  using (
    exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_mutate(r.project_id, r.construction_site_id, r.created_by, r.status)
    )
  )
  with check (
    exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_mutate(r.project_id, r.construction_site_id, r.created_by, r.status)
    )
  );

drop policy if exists custom_material_imports_access on public.custom_material_request_imports;
create policy custom_material_imports_access
  on public.custom_material_request_imports for all to authenticated
  using (
    request_id is null
    or exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_select(r.project_id, r.construction_site_id, r.created_by)
    )
  )
  with check (
    request_id is null
    or exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_mutate(r.project_id, r.construction_site_id, r.created_by, r.status)
    )
  );

drop policy if exists custom_material_events_select on public.custom_material_request_events;
create policy custom_material_events_select
  on public.custom_material_request_events for select to authenticated
  using (
    exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_select(r.project_id, r.construction_site_id, r.created_by)
    )
  );

drop policy if exists custom_material_events_insert on public.custom_material_request_events;
create policy custom_material_events_insert
  on public.custom_material_request_events for insert to authenticated
  with check (
    exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_select(r.project_id, r.construction_site_id, r.created_by)
    )
  );

drop policy if exists custom_material_rfqs_access on public.custom_material_rfqs;
create policy custom_material_rfqs_access
  on public.custom_material_rfqs for all to authenticated
  using (
    public.is_admin()
    or app_private.company_procurement_can_manage()
    or app_private.project_user_has_permission(project_id, construction_site_id, 'approve')
    or app_private.project_user_has_permission(project_id, construction_site_id, 'confirm')
  )
  with check (
    public.is_admin()
    or app_private.company_procurement_can_manage()
  );

drop policy if exists custom_material_rfq_lines_access on public.custom_material_rfq_lines;
create policy custom_material_rfq_lines_access
  on public.custom_material_rfq_lines for all to authenticated
  using (
    exists (
      select 1 from public.custom_material_rfqs rfq
      where rfq.id = rfq_id
        and (
          public.is_admin()
          or app_private.company_procurement_can_manage()
          or app_private.project_user_has_permission(rfq.project_id, rfq.construction_site_id, 'approve')
          or app_private.project_user_has_permission(rfq.project_id, rfq.construction_site_id, 'confirm')
        )
    )
  )
  with check (
    public.is_admin()
    or app_private.company_procurement_can_manage()
  );

drop policy if exists custom_material_rfq_suppliers_access on public.custom_material_rfq_suppliers;
create policy custom_material_rfq_suppliers_access
  on public.custom_material_rfq_suppliers for all to authenticated
  using (
    exists (
      select 1 from public.custom_material_rfqs rfq
      where rfq.id = rfq_id
        and (
          public.is_admin()
          or app_private.company_procurement_can_manage()
          or app_private.project_user_has_permission(rfq.project_id, rfq.construction_site_id, 'approve')
          or app_private.project_user_has_permission(rfq.project_id, rfq.construction_site_id, 'confirm')
        )
    )
  )
  with check (
    public.is_admin()
    or app_private.company_procurement_can_manage()
  );

drop policy if exists custom_material_po_lines_access on public.custom_material_po_lines;
create policy custom_material_po_lines_access
  on public.custom_material_po_lines for all to authenticated
  using (
    public.is_admin()
    or app_private.company_procurement_can_manage()
    or exists (
      select 1 from public.custom_material_requests r
      where r.id = request_id
        and app_private.custom_material_request_can_select(r.project_id, r.construction_site_id, r.created_by)
    )
  )
  with check (
    public.is_admin()
    or app_private.company_procurement_can_manage()
  );

drop policy if exists custom_material_storage_select on storage.objects;
create policy custom_material_storage_select
on storage.objects for select to authenticated
using (
  bucket_id = 'custom-material-attachments'
  and app_private.custom_material_storage_can_select(name)
);

drop policy if exists custom_material_storage_insert on storage.objects;
create policy custom_material_storage_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'custom-material-attachments'
  and app_private.custom_material_storage_can_mutate(name)
);

drop policy if exists custom_material_storage_update on storage.objects;
create policy custom_material_storage_update
on storage.objects for update to authenticated
using (
  bucket_id = 'custom-material-attachments'
  and app_private.custom_material_storage_can_mutate(name)
)
with check (
  bucket_id = 'custom-material-attachments'
  and app_private.custom_material_storage_can_mutate(name)
);

drop policy if exists custom_material_storage_delete on storage.objects;
create policy custom_material_storage_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'custom-material-attachments'
  and app_private.custom_material_storage_can_mutate(name)
);

revoke all on table public.custom_material_requests from anon, public, authenticated;
revoke all on table public.custom_material_request_lines from anon, public, authenticated;
revoke all on table public.custom_material_request_attachments from anon, public, authenticated;
revoke all on table public.custom_material_request_imports from anon, public, authenticated;
revoke all on table public.custom_material_request_events from anon, public, authenticated;
revoke all on table public.custom_material_rfqs from anon, public, authenticated;
revoke all on table public.custom_material_rfq_lines from anon, public, authenticated;
revoke all on table public.custom_material_rfq_suppliers from anon, public, authenticated;
revoke all on table public.custom_material_po_lines from anon, public, authenticated;

grant select, insert, update, delete on table public.custom_material_requests to authenticated;
grant select, insert, update, delete on table public.custom_material_request_lines to authenticated;
grant select, insert, update, delete on table public.custom_material_request_attachments to authenticated;
grant select, insert, update, delete on table public.custom_material_request_imports to authenticated;
grant select, insert on table public.custom_material_request_events to authenticated;
grant select, insert, update, delete on table public.custom_material_rfqs to authenticated;
grant select, insert, update, delete on table public.custom_material_rfq_lines to authenticated;
grant select, insert, update, delete on table public.custom_material_rfq_suppliers to authenticated;
grant select, insert, update, delete on table public.custom_material_po_lines to authenticated;

grant execute on function app_private.custom_material_request_can_select(text, text, uuid) to authenticated;
grant execute on function app_private.custom_material_request_can_mutate(text, text, uuid, text) to authenticated;
grant execute on function app_private.custom_material_storage_request_id(text) to authenticated;
grant execute on function app_private.custom_material_storage_can_select(text) to authenticated;
grant execute on function app_private.custom_material_storage_can_mutate(text) to authenticated;

notify pgrst, 'reload schema';
