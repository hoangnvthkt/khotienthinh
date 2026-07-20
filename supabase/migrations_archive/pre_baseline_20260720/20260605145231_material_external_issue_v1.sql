-- Material external issue: issue materials to work crews, subcontractors,
-- partners, or responsible people without creating virtual warehouses.

create schema if not exists app_private;

create table if not exists public.material_issue_orders (
  id uuid primary key default gen_random_uuid(),
  issue_no text not null unique,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  source_warehouse_id text not null references public.warehouses(id) on delete restrict,
  recipient_type text not null check (recipient_type in ('employee', 'work_group', 'subcontractor', 'partner', 'manual')),
  recipient_id text,
  recipient_name text not null,
  responsible_user_id uuid references public.users(id) on delete set null,
  subcontractor_contract_id text references public.subcontractor_contracts(id) on delete set null,
  material_request_id text references public.requests(id) on delete set null,
  work_boq_item_id text,
  needed_date date,
  status text not null default 'draft'
    check (status in (
      'draft', 'submitted', 'wms_pending', 'issued', 'partially_received',
      'received', 'settling', 'partially_returned', 'closed', 'rejected', 'cancelled'
    )),
  transaction_id text unique references public.transactions(id) on delete restrict,
  qr_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  note text,
  override_reason text,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz,
  issued_by uuid references public.users(id) on delete set null,
  issued_at timestamptz,
  closed_by uuid references public.users(id) on delete set null,
  closed_at timestamptz,
  cancelled_by uuid references public.users(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_issue_lines (
  id uuid primary key default gen_random_uuid(),
  issue_order_id uuid not null references public.material_issue_orders(id) on delete restrict,
  item_id text not null references public.items(id) on delete restrict,
  sku_snapshot text,
  item_name_snapshot text not null,
  unit text,
  requested_qty numeric not null default 0 check (requested_qty >= 0),
  approved_qty numeric not null default 0 check (approved_qty >= 0),
  issued_qty numeric not null default 0 check (issued_qty >= 0),
  received_qty numeric not null default 0 check (received_qty >= 0),
  consumed_qty numeric not null default 0 check (consumed_qty >= 0),
  returned_qty numeric not null default 0 check (returned_qty >= 0),
  lost_qty numeric not null default 0 check (lost_qty >= 0),
  unit_price numeric not null default 0,
  material_budget_item_id text,
  material_request_line_id text,
  work_boq_item_id text,
  subcontractor_contract_id text references public.subcontractor_contracts(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_issue_receipts (
  id uuid primary key default gen_random_uuid(),
  issue_order_id uuid not null references public.material_issue_orders(id) on delete restrict,
  receipt_no text not null unique,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  received_by uuid references public.users(id) on delete set null,
  received_by_name text,
  received_at timestamptz not null default now(),
  note text,
  signature_url text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.material_issue_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.material_issue_receipts(id) on delete restrict,
  issue_line_id uuid not null references public.material_issue_lines(id) on delete restrict,
  item_id text not null references public.items(id) on delete restrict,
  received_qty numeric not null check (received_qty >= 0),
  variance_reason text,
  created_at timestamptz not null default now(),
  unique(receipt_id, issue_line_id)
);

create table if not exists public.material_issue_returns (
  id uuid primary key default gen_random_uuid(),
  issue_order_id uuid not null references public.material_issue_orders(id) on delete restrict,
  return_no text not null unique,
  target_warehouse_id text not null references public.warehouses(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  transaction_id text not null unique references public.transactions(id) on delete restrict,
  reason text not null,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.material_issue_return_lines (
  id uuid primary key default gen_random_uuid(),
  issue_return_id uuid not null references public.material_issue_returns(id) on delete restrict,
  issue_line_id uuid not null references public.material_issue_lines(id) on delete restrict,
  item_id text not null references public.items(id) on delete restrict,
  return_qty numeric not null check (return_qty > 0),
  unit text,
  reason text,
  created_at timestamptz not null default now(),
  unique(issue_return_id, issue_line_id)
);

create table if not exists public.material_party_ledger (
  id uuid primary key default gen_random_uuid(),
  issue_order_id uuid not null references public.material_issue_orders(id) on delete restrict,
  issue_line_id uuid references public.material_issue_lines(id) on delete restrict,
  source_document_type text not null,
  source_document_id text not null,
  ledger_type text not null check (ledger_type in ('issue', 'receive_confirm', 'return', 'consume', 'loss', 'adjustment')),
  project_id text,
  construction_site_id text,
  recipient_type text not null check (recipient_type in ('employee', 'work_group', 'subcontractor', 'partner', 'manual')),
  recipient_id text,
  recipient_name text not null,
  item_id text not null references public.items(id) on delete restrict,
  item_name_snapshot text not null,
  unit text,
  quantity_delta numeric not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(source_document_type, source_document_id, ledger_type, issue_line_id)
);

create index if not exists idx_material_issue_orders_project_status
  on public.material_issue_orders(project_id, construction_site_id, status, created_at desc);
create index if not exists idx_material_issue_orders_source_status
  on public.material_issue_orders(source_warehouse_id, status, created_at desc);
create index if not exists idx_material_issue_orders_recipient
  on public.material_issue_orders(recipient_type, recipient_id, status);
create index if not exists idx_material_issue_orders_transaction
  on public.material_issue_orders(transaction_id);
create index if not exists idx_material_issue_lines_order
  on public.material_issue_lines(issue_order_id);
create index if not exists idx_material_issue_returns_order_status
  on public.material_issue_returns(issue_order_id, status, created_at desc);
create index if not exists idx_material_issue_returns_transaction
  on public.material_issue_returns(transaction_id);
create index if not exists idx_material_party_ledger_party_item
  on public.material_party_ledger(project_id, construction_site_id, recipient_type, recipient_id, item_id);

create or replace function app_private.set_material_issue_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_material_issue_orders_updated_at on public.material_issue_orders;
create trigger trg_material_issue_orders_updated_at
before update on public.material_issue_orders
for each row execute function app_private.set_material_issue_updated_at();

drop trigger if exists trg_material_issue_lines_updated_at on public.material_issue_lines;
create trigger trg_material_issue_lines_updated_at
before update on public.material_issue_lines
for each row execute function app_private.set_material_issue_updated_at();

drop trigger if exists trg_material_issue_returns_updated_at on public.material_issue_returns;
create trigger trg_material_issue_returns_updated_at
before update on public.material_issue_returns
for each row execute function app_private.set_material_issue_updated_at();

create or replace function app_private.material_issue_can_view(
  p_project_id text,
  p_construction_site_id text,
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
    or p_created_by = public.current_app_user_id()
    or p_responsible_user_id = public.current_app_user_id()
    or (p_recipient_type = 'employee' and p_recipient_id = public.current_app_user_id()::text)
    or app_private.project_doc_can_view(p_project_id, p_construction_site_id, p_responsible_user_id::text);
$$;

create or replace function app_private.material_issue_can_manage_project(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit', public.current_app_user_id())
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit', public.current_app_user_id());
$$;

create or replace function app_private.material_issue_can_process(
  p_source_warehouse_id text,
  p_created_by uuid,
  p_responsible_user_id uuid,
  p_recipient_type text,
  p_recipient_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
    or p_created_by = public.current_app_user_id()
    or p_responsible_user_id = public.current_app_user_id()
    or (p_recipient_type = 'employee' and p_recipient_id = public.current_app_user_id()::text);
$$;

create or replace function app_private.material_issue_refresh_status(p_order_id uuid)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.material_issue_orders%rowtype;
  v_total_issued numeric;
  v_total_received numeric;
  v_total_open numeric;
  v_next_status text;
begin
  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status in ('draft', 'submitted', 'wms_pending', 'rejected', 'cancelled') then
    return v_order;
  end if;

  select
    coalesce(sum(issued_qty), 0),
    coalesce(sum(received_qty), 0),
    coalesce(sum(greatest(issued_qty - consumed_qty - returned_qty - lost_qty, 0)), 0)
  into v_total_issued, v_total_received, v_total_open
  from public.material_issue_lines
  where issue_order_id = p_order_id;

  if v_total_issued <= 0 then
    v_next_status := 'wms_pending';
  elsif v_total_open = 0 then
    v_next_status := 'closed';
  elsif v_total_received >= v_total_issued then
    v_next_status := 'received';
  elsif v_total_received > 0 then
    v_next_status := 'partially_received';
  elsif exists (
    select 1 from public.material_issue_lines
    where issue_order_id = p_order_id and returned_qty > 0
  ) then
    v_next_status := 'partially_returned';
  else
    v_next_status := 'issued';
  end if;

  update public.material_issue_orders
  set status = v_next_status,
      closed_by = case when v_next_status = 'closed' then coalesce(closed_by, public.current_app_user_id()) else closed_by end,
      closed_at = case when v_next_status = 'closed' then coalesce(closed_at, now()) else closed_at end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function app_private.sync_material_issue_document_links(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.material_issue_orders%rowtype;
  v_link_status text;
begin
  if to_regclass('public.project_document_links') is null then
    return;
  end if;

  select * into v_order from public.material_issue_orders where id = p_order_id;
  if not found then return; end if;

  v_link_status := case
    when v_order.status in ('closed', 'cancelled', 'rejected') then 'reversed'
    else 'active'
  end;

  update public.project_document_links
  set status = v_link_status,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'materialIssueStatus', v_order.status,
        'settledAt', case when v_order.status = 'closed' then now() else null end
      ),
      updated_at = now()
  where (
      source_type = 'material_request'
      and source_id = coalesce(v_order.material_request_id, '')
      and target_type = 'material_issue_order'
      and target_id = v_order.id::text
    )
    or (
      source_type = 'material_issue_order'
      and source_id = v_order.id::text
    )
    or (
      source_type = 'subcontractor_contract'
      and source_id = coalesce(v_order.subcontractor_contract_id, '')
      and target_type = 'material_issue_order'
      and target_id = v_order.id::text
    );
end;
$$;

create or replace function app_private.sync_material_issue_document_links_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform app_private.sync_material_issue_document_links(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_material_issue_orders_sync_links on public.material_issue_orders;
create trigger trg_material_issue_orders_sync_links
after update of status on public.material_issue_orders
for each row execute function app_private.sync_material_issue_document_links_trigger();

create or replace function public.create_material_issue_order(
  p_project_id text,
  p_construction_site_id text,
  p_source_warehouse_id text,
  p_recipient_type text,
  p_recipient_id text,
  p_recipient_name text,
  p_responsible_user_id uuid,
  p_subcontractor_contract_id text,
  p_material_request_id text,
  p_work_boq_item_id text,
  p_needed_date date,
  p_note text,
  p_lines jsonb
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_issue_no text;
  v_line jsonb;
  v_item public.items%rowtype;
  v_qty numeric;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not (
    app_private.material_issue_can_manage_project(p_project_id, p_construction_site_id)
    or app_private.current_user_is_wms_keeper_for(p_source_warehouse_id)
  ) then
    raise exception 'Bạn không có quyền tạo phiếu xuất cấp cho dự án/công trường này.';
  end if;
  if coalesce(p_source_warehouse_id, '') = '' then raise exception 'Chưa chọn kho xuất.'; end if;
  if p_recipient_type not in ('employee', 'work_group', 'subcontractor', 'partner', 'manual') then
    raise exception 'Loại bên nhận không hợp lệ.';
  end if;
  if coalesce(trim(p_recipient_name), '') = '' then raise exception 'Chưa nhập tên bên nhận.'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Phiếu xuất cấp chưa có dòng vật tư.';
  end if;

  v_issue_no := 'MI-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 6));

  insert into public.material_issue_orders(
    id, issue_no, project_id, construction_site_id, source_warehouse_id,
    recipient_type, recipient_id, recipient_name, responsible_user_id,
    subcontractor_contract_id, material_request_id, work_boq_item_id,
    needed_date, status, note, created_by
  ) values (
    v_order_id, v_issue_no, nullif(p_project_id, ''), nullif(p_construction_site_id, ''), p_source_warehouse_id,
    p_recipient_type, nullif(p_recipient_id, ''), trim(p_recipient_name), p_responsible_user_id,
    nullif(p_subcontractor_contract_id, ''), nullif(p_material_request_id, ''), nullif(p_work_boq_item_id, ''),
    p_needed_date, 'draft', nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning * into v_order;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    if coalesce(v_line ->> 'itemId', '') = '' or v_qty <= 0 then
      raise exception 'Dòng vật tư không hợp lệ.';
    end if;

    select * into v_item from public.items where id = v_line ->> 'itemId';
    if not found then raise exception 'Không tìm thấy vật tư %.', v_line ->> 'itemId'; end if;

    insert into public.material_issue_lines(
      issue_order_id, item_id, sku_snapshot, item_name_snapshot, unit,
      requested_qty, approved_qty, unit_price,
      material_budget_item_id, material_request_line_id, work_boq_item_id,
      subcontractor_contract_id, note
    ) values (
      v_order_id, v_item.id, v_item.sku, v_item.name, coalesce(nullif(v_line ->> 'unit', ''), v_item.unit),
      v_qty, v_qty, coalesce(nullif(v_line ->> 'unitPrice', '')::numeric, coalesce(v_item.price_in, 0)),
      nullif(v_line ->> 'materialBudgetItemId', ''),
      nullif(v_line ->> 'materialRequestLineId', ''),
      coalesce(nullif(v_line ->> 'workBoqItemId', ''), nullif(p_work_boq_item_id, '')),
      coalesce(nullif(v_line ->> 'subcontractorContractId', ''), nullif(p_subcontractor_contract_id, '')),
      nullif(trim(coalesce(v_line ->> 'note', '')), '')
    );
  end loop;

  return v_order;
end;
$$;

create or replace function public.submit_material_issue_order(
  p_order_id uuid,
  p_override_reason text default null
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_transaction_id text := 'tx-material-issue-' || replace(gen_random_uuid()::text, '-', '');
  v_items jsonb := '[]'::jsonb;
  v_line record;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('draft', 'submitted') then raise exception 'Chỉ gửi duyệt phiếu ở trạng thái nháp.'; end if;
  if not (
    public.is_admin()
    or public.is_module_admin('WMS')
    or v_order.created_by = v_actor
    or app_private.material_issue_can_manage_project(v_order.project_id, v_order.construction_site_id)
  ) then
    raise exception 'Bạn không có quyền gửi phiếu xuất cấp này.';
  end if;

  for v_line in
    select * from public.material_issue_lines where issue_order_id = p_order_id order by created_at
  loop
    if v_line.approved_qty <= 0 then raise exception 'Phiếu có dòng số lượng không hợp lệ.'; end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id,
      'quantity', v_line.approved_qty,
      'price', v_line.unit_price,
      'materialIssueOrderId', v_order.id,
      'materialIssueLineId', v_line.id,
      'recipientType', v_order.recipient_type,
      'recipientNameSnapshot', v_order.recipient_name
    ));
  end loop;

  if jsonb_array_length(v_items) = 0 then raise exception 'Phiếu xuất cấp chưa có dòng vật tư.'; end if;

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id, pending_items
  ) values (
    v_transaction_id, 'EXPORT', now(), v_items, v_order.source_warehouse_id, null,
    v_actor, null, 'PENDING',
    'Xuất cấp thi công ' || v_order.issue_no || ' cho ' || v_order.recipient_name,
    v_order.material_request_id, '[]'::jsonb
  );

  update public.material_issue_orders
  set status = 'wms_pending',
      transaction_id = v_transaction_id,
      submitted_by = v_actor,
      submitted_at = now(),
      override_reason = nullif(trim(coalesce(p_override_reason, '')), '')
  where id = p_order_id
  returning * into v_order;

  if to_regclass('public.project_document_links') is not null then
    if v_order.material_request_id is not null then
      insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
      values ('material_request', v_order.material_request_id, 'material_issue_order', v_order.id::text, v_order.project_id, 'downstream', 'active', jsonb_build_object('issueNo', v_order.issue_no, 'transactionId', v_transaction_id))
      on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();
    end if;

    insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
    values ('material_issue_order', v_order.id::text, 'transaction', v_transaction_id, v_order.project_id, 'downstream', 'active', jsonb_build_object('kind', 'external_issue'))
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();

    if v_order.subcontractor_contract_id is not null then
      insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
      values ('subcontractor_contract', v_order.subcontractor_contract_id, 'material_issue_order', v_order.id::text, v_order.project_id, 'downstream', 'active', jsonb_build_object('issueNo', v_order.issue_no))
      on conflict (source_type, source_id, target_type, target_id, relation_type)
      do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();
    end if;
  end if;

  return v_order;
end;
$$;

create or replace function public.cancel_material_issue_order(
  p_order_id uuid,
  p_reason text
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Bắt buộc nhập lý do huỷ.'; end if;
  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('draft', 'submitted', 'wms_pending') then
    raise exception 'Phiếu đã phát sinh xuất kho hoặc quyết toán, không thể huỷ trực tiếp.';
  end if;
  if not (public.is_admin() or public.is_module_admin('WMS') or v_order.created_by = v_actor) then
    raise exception 'Bạn không có quyền huỷ phiếu này.';
  end if;
  if v_order.transaction_id is not null then
    update public.transactions
    set status = 'CANCELLED', approver_id = v_actor
    where id = v_order.transaction_id and status = 'PENDING';
  end if;
  update public.material_issue_orders
  set status = 'cancelled',
      cancelled_by = v_actor,
      cancelled_at = now(),
      cancel_reason = trim(p_reason)
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

create or replace function public.confirm_material_issue_receipt(
  p_order_id uuid,
  p_lines jsonb,
  p_note text default null,
  p_attachments jsonb default '[]'::jsonb,
  p_signature_url text default null
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_actor_name text;
  v_order public.material_issue_orders%rowtype;
  v_receipt_id uuid := gen_random_uuid();
  v_receipt_no text;
  v_line jsonb;
  v_issue_line public.material_issue_lines%rowtype;
  v_qty numeric;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('issued', 'partially_received', 'received', 'settling', 'partially_returned') then
    raise exception 'Chỉ xác nhận nhận hàng sau khi WMS đã xuất kho.';
  end if;
  if not app_private.material_issue_can_process(v_order.source_warehouse_id, v_order.created_by, v_order.responsible_user_id, v_order.recipient_type, v_order.recipient_id) then
    raise exception 'Bạn không có quyền xác nhận phiếu này.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Chưa có dòng xác nhận nhận hàng.';
  end if;

  select coalesce(u.name, u.username, u.email) into v_actor_name from public.users u where u.id = v_actor;
  v_receipt_no := 'MIR-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_receipt_id::text, '-', ''), 1, 6));

  insert into public.material_issue_receipts(
    id, issue_order_id, receipt_no, received_by, received_by_name, note, signature_url, attachments
  ) values (
    v_receipt_id, p_order_id, v_receipt_no, v_actor, v_actor_name,
    nullif(trim(coalesce(p_note, '')), ''), nullif(p_signature_url, ''), coalesce(p_attachments, '[]'::jsonb)
  );

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line ->> 'receivedQty', '')::numeric, 0);
    if v_qty < 0 then raise exception 'Số lượng nhận không hợp lệ.'; end if;
    select * into v_issue_line from public.material_issue_lines where id = (v_line ->> 'issueLineId')::uuid and issue_order_id = p_order_id for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp.'; end if;
    if v_issue_line.received_qty + v_qty > v_issue_line.issued_qty then
      raise exception 'Số lượng nhận vượt số lượng đã xuất.';
    end if;

    insert into public.material_issue_receipt_lines(
      receipt_id, issue_line_id, item_id, received_qty, variance_reason
    ) values (
      v_receipt_id, v_issue_line.id, v_issue_line.item_id, v_qty, nullif(trim(coalesce(v_line ->> 'varianceReason', '')), '')
    );

    update public.material_issue_lines
    set received_qty = received_qty + v_qty
    where id = v_issue_line.id;

    insert into public.material_party_ledger(
      issue_order_id, issue_line_id, source_document_type, source_document_id,
      ledger_type, project_id, construction_site_id, recipient_type, recipient_id,
      recipient_name, item_id, item_name_snapshot, unit, quantity_delta, reason,
      metadata, created_by
    ) values (
      p_order_id, v_issue_line.id, 'material_issue_receipt', v_receipt_id::text,
      'receive_confirm', v_order.project_id, v_order.construction_site_id, v_order.recipient_type, v_order.recipient_id,
      v_order.recipient_name, v_issue_line.item_id, v_issue_line.item_name_snapshot, v_issue_line.unit, 0,
      nullif(trim(coalesce(p_note, '')), ''), jsonb_build_object('receivedQty', v_qty), v_actor
    )
    on conflict do nothing;
  end loop;

  return app_private.material_issue_refresh_status(p_order_id);
end;
$$;

create or replace function public.create_material_issue_return(
  p_order_id uuid,
  p_target_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text default null
)
returns public.material_issue_returns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_return public.material_issue_returns%rowtype;
  v_return_id uuid := gen_random_uuid();
  v_transaction_id text := 'tx-material-return-' || replace(gen_random_uuid()::text, '-', '');
  v_return_no text;
  v_items jsonb := '[]'::jsonb;
  v_line jsonb;
  v_issue_line public.material_issue_lines%rowtype;
  v_qty numeric;
  v_available numeric;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Bắt buộc nhập lý do hoàn trả.'; end if;
  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('issued', 'partially_received', 'received', 'settling', 'partially_returned') then
    raise exception 'Phiếu chưa sẵn sàng hoàn trả.';
  end if;
  if not app_private.material_issue_can_process(v_order.source_warehouse_id, v_order.created_by, v_order.responsible_user_id, v_order.recipient_type, v_order.recipient_id) then
    raise exception 'Bạn không có quyền tạo phiếu hoàn trả.';
  end if;

  v_return_no := 'MRET-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(v_return_id::text, '-', ''), 1, 6));

  insert into public.material_issue_returns(
    id, issue_order_id, return_no, target_warehouse_id, status,
    transaction_id, reason, note, created_by
  ) values (
    v_return_id, p_order_id, v_return_no, p_target_warehouse_id, 'pending',
    v_transaction_id, trim(p_reason), nullif(trim(coalesce(p_note, '')), ''), v_actor
  )
  returning * into v_return;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line ->> 'returnQty', '')::numeric, 0);
    if v_qty <= 0 then raise exception 'Số lượng hoàn trả phải lớn hơn 0.'; end if;
    select * into v_issue_line from public.material_issue_lines where id = (v_line ->> 'issueLineId')::uuid and issue_order_id = p_order_id for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp.'; end if;
    v_available := greatest(v_issue_line.issued_qty - v_issue_line.returned_qty - v_issue_line.consumed_qty - v_issue_line.lost_qty, 0);
    if v_qty > v_available then raise exception 'Số lượng hoàn trả vượt số lượng còn quyết toán.'; end if;

    insert into public.material_issue_return_lines(
      issue_return_id, issue_line_id, item_id, return_qty, unit, reason
    ) values (
      v_return_id, v_issue_line.id, v_issue_line.item_id, v_qty, v_issue_line.unit,
      nullif(trim(coalesce(v_line ->> 'reason', '')), '')
    );

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_issue_line.item_id,
      'quantity', v_qty,
      'price', v_issue_line.unit_price,
      'materialIssueOrderId', p_order_id,
      'materialIssueLineId', v_issue_line.id,
      'materialIssueReturnId', v_return_id,
      'recipientType', v_order.recipient_type,
      'recipientNameSnapshot', v_order.recipient_name
    ));
  end loop;

  if jsonb_array_length(v_items) = 0 then raise exception 'Phiếu hoàn trả chưa có dòng vật tư.'; end if;

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id, pending_items
  ) values (
    v_transaction_id, 'IMPORT', now(), v_items, null, p_target_warehouse_id,
    v_actor, null, 'PENDING',
    'Hoàn trả vật tư từ ' || v_order.recipient_name || ' theo phiếu ' || v_order.issue_no,
    v_order.material_request_id, '[]'::jsonb
  );

  if to_regclass('public.project_document_links') is not null then
    insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
    values ('material_issue_order', v_order.id::text, 'material_issue_return', v_return_id::text, v_order.project_id, 'downstream', 'active', jsonb_build_object('returnNo', v_return_no, 'transactionId', v_transaction_id))
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();

    insert into public.project_document_links(source_type, source_id, target_type, target_id, project_id, relation_type, status, metadata)
    values ('material_issue_order', v_order.id::text, 'transaction', v_transaction_id, v_order.project_id, 'downstream', 'active', jsonb_build_object('kind', 'material_issue_return', 'returnId', v_return_id))
    on conflict (source_type, source_id, target_type, target_id, relation_type)
    do update set status = excluded.status, metadata = excluded.metadata, updated_at = now();
  end if;

  return v_return;
end;
$$;

create or replace function public.record_material_issue_settlement(
  p_order_id uuid,
  p_settlement_type text,
  p_lines jsonb,
  p_reason text,
  p_attachments jsonb default '[]'::jsonb
)
returns public.material_issue_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_order public.material_issue_orders%rowtype;
  v_line jsonb;
  v_issue_line public.material_issue_lines%rowtype;
  v_qty numeric;
  v_available numeric;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_settlement_type not in ('consume', 'loss') then raise exception 'Loại quyết toán không hợp lệ.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Bắt buộc nhập lý do quyết toán.'; end if;
  select * into v_order from public.material_issue_orders where id = p_order_id for update;
  if not found then raise exception 'Không tìm thấy phiếu xuất cấp.'; end if;
  if v_order.status not in ('issued', 'partially_received', 'received', 'settling', 'partially_returned') then
    raise exception 'Phiếu chưa sẵn sàng quyết toán.';
  end if;
  if not app_private.material_issue_can_process(v_order.source_warehouse_id, v_order.created_by, v_order.responsible_user_id, v_order.recipient_type, v_order.recipient_id) then
    raise exception 'Bạn không có quyền quyết toán phiếu này.';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    if v_qty <= 0 then raise exception 'Số lượng quyết toán phải lớn hơn 0.'; end if;
    select * into v_issue_line from public.material_issue_lines where id = (v_line ->> 'issueLineId')::uuid and issue_order_id = p_order_id for update;
    if not found then raise exception 'Không tìm thấy dòng phiếu xuất cấp.'; end if;
    v_available := greatest(v_issue_line.issued_qty - v_issue_line.returned_qty - v_issue_line.consumed_qty - v_issue_line.lost_qty, 0);
    if v_qty > v_available then raise exception 'Số lượng quyết toán vượt số lượng còn lại.';
    end if;

    if p_settlement_type = 'consume' then
      update public.material_issue_lines set consumed_qty = consumed_qty + v_qty where id = v_issue_line.id;
    else
      update public.material_issue_lines set lost_qty = lost_qty + v_qty where id = v_issue_line.id;
    end if;

    insert into public.material_party_ledger(
      issue_order_id, issue_line_id, source_document_type, source_document_id,
      ledger_type, project_id, construction_site_id, recipient_type, recipient_id,
      recipient_name, item_id, item_name_snapshot, unit, quantity_delta, reason,
      metadata, created_by
    ) values (
      p_order_id, v_issue_line.id, 'material_issue_settlement', gen_random_uuid()::text,
      p_settlement_type, v_order.project_id, v_order.construction_site_id, v_order.recipient_type, v_order.recipient_id,
      v_order.recipient_name, v_issue_line.item_id, v_issue_line.item_name_snapshot, v_issue_line.unit, -v_qty,
      trim(p_reason), jsonb_build_object('attachments', coalesce(p_attachments, '[]'::jsonb)), v_actor
    );
  end loop;

  update public.material_issue_orders set status = 'settling' where id = p_order_id and status not in ('closed', 'cancelled');
  return app_private.material_issue_refresh_status(p_order_id);
end;
$$;

create or replace function public.get_material_party_balance(
  p_project_id text default null,
  p_construction_site_id text default null,
  p_recipient_type text default null,
  p_recipient_id text default null
)
returns table (
  project_id text,
  construction_site_id text,
  recipient_type text,
  recipient_id text,
  recipient_name text,
  item_id text,
  item_name_snapshot text,
  unit text,
  balance_qty numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.project_id,
    l.construction_site_id,
    l.recipient_type,
    l.recipient_id,
    l.recipient_name,
    l.item_id,
    l.item_name_snapshot,
    l.unit,
    sum(l.quantity_delta) as balance_qty
  from public.material_party_ledger l
  where (p_project_id is null or l.project_id = p_project_id)
    and (p_construction_site_id is null or l.construction_site_id = p_construction_site_id)
    and (p_recipient_type is null or l.recipient_type = p_recipient_type)
    and (p_recipient_id is null or l.recipient_id = p_recipient_id)
    and app_private.material_issue_can_view(
      l.project_id, l.construction_site_id, null, null, null, l.recipient_type, l.recipient_id
    )
  group by l.project_id, l.construction_site_id, l.recipient_type, l.recipient_id,
    l.recipient_name, l.item_id, l.item_name_snapshot, l.unit
  having sum(l.quantity_delta) <> 0;
$$;

create or replace function app_private.sync_material_issue_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_order_id uuid;
  v_line_id uuid;
  v_return_id uuid;
  v_qty numeric;
  v_order public.material_issue_orders%rowtype;
  v_issue_line public.material_issue_lines%rowtype;
begin
  if new.status = old.status then return new; end if;

  for v_item in select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
  loop
    v_order_id := nullif(v_item ->> 'materialIssueOrderId', '')::uuid;
    v_line_id := nullif(v_item ->> 'materialIssueLineId', '')::uuid;
    v_return_id := nullif(v_item ->> 'materialIssueReturnId', '')::uuid;
    v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
    if v_order_id is null or v_line_id is null or v_qty <= 0 then
      continue;
    end if;

    select * into v_order from public.material_issue_orders where id = v_order_id for update;
    select * into v_issue_line from public.material_issue_lines where id = v_line_id for update;
    if not found then continue; end if;

    if v_return_id is null then
      if new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
        update public.material_issue_lines
        set issued_qty = greatest(issued_qty, v_qty)
        where id = v_line_id;

        update public.material_issue_orders
        set status = 'issued',
            issued_by = coalesce(new.approver_id, public.current_app_user_id()),
            issued_at = coalesce(issued_at, now())
        where id = v_order_id and status in ('wms_pending', 'submitted', 'draft');

        insert into public.material_party_ledger(
          issue_order_id, issue_line_id, source_document_type, source_document_id,
          ledger_type, project_id, construction_site_id, recipient_type, recipient_id,
          recipient_name, item_id, item_name_snapshot, unit, quantity_delta, reason,
          metadata, created_by
        ) values (
          v_order_id, v_line_id, 'transaction', new.id,
          'issue', v_order.project_id, v_order.construction_site_id, v_order.recipient_type, v_order.recipient_id,
          v_order.recipient_name, v_issue_line.item_id, v_issue_line.item_name_snapshot, v_issue_line.unit, v_qty,
          new.note, jsonb_build_object('transactionType', new.type), coalesce(new.approver_id, public.current_app_user_id())
        )
        on conflict do nothing;

        perform app_private.material_issue_refresh_status(v_order_id);
      elsif new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
        update public.material_issue_orders
        set status = 'rejected',
            cancel_reason = coalesce(cancel_reason, 'Phiếu kho xuất cấp bị từ chối/hủy.')
        where id = v_order_id and status = 'wms_pending';
      end if;
    else
      if new.status = 'COMPLETED' and old.status <> 'COMPLETED' then
        update public.material_issue_return_lines
        set return_qty = return_qty
        where issue_return_id = v_return_id and issue_line_id = v_line_id;

        update public.material_issue_lines
        set returned_qty = returned_qty + v_qty
        where id = v_line_id;

        update public.material_issue_returns
        set status = 'completed',
            completed_by = coalesce(new.approver_id, public.current_app_user_id()),
            completed_at = now()
        where id = v_return_id and status = 'pending';

        insert into public.material_party_ledger(
          issue_order_id, issue_line_id, source_document_type, source_document_id,
          ledger_type, project_id, construction_site_id, recipient_type, recipient_id,
          recipient_name, item_id, item_name_snapshot, unit, quantity_delta, reason,
          metadata, created_by
        ) values (
          v_order_id, v_line_id, 'material_issue_return', v_return_id::text,
          'return', v_order.project_id, v_order.construction_site_id, v_order.recipient_type, v_order.recipient_id,
          v_order.recipient_name, v_issue_line.item_id, v_issue_line.item_name_snapshot, v_issue_line.unit, -v_qty,
          new.note, jsonb_build_object('transactionId', new.id), coalesce(new.approver_id, public.current_app_user_id())
        )
        on conflict do nothing;

        perform app_private.material_issue_refresh_status(v_order_id);
      elsif new.status = 'CANCELLED' and old.status <> 'CANCELLED' then
        update public.material_issue_returns
        set status = 'cancelled',
            cancelled_at = now()
        where id = v_return_id and status = 'pending';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_sync_material_issue_transaction on public.transactions;
create trigger trg_sync_material_issue_transaction
after update of status on public.transactions
for each row execute function app_private.sync_material_issue_from_transaction();

alter table public.material_issue_orders enable row level security;
alter table public.material_issue_lines enable row level security;
alter table public.material_issue_receipts enable row level security;
alter table public.material_issue_receipt_lines enable row level security;
alter table public.material_issue_returns enable row level security;
alter table public.material_issue_return_lines enable row level security;
alter table public.material_party_ledger enable row level security;

drop policy if exists material_issue_orders_select on public.material_issue_orders;
create policy material_issue_orders_select on public.material_issue_orders
for select to authenticated
using (
  app_private.material_issue_can_view(
    project_id, construction_site_id, source_warehouse_id, created_by,
    responsible_user_id, recipient_type, recipient_id
  )
);

drop policy if exists material_issue_lines_select on public.material_issue_lines;
create policy material_issue_lines_select on public.material_issue_lines
for select to authenticated
using (
  exists (
    select 1 from public.material_issue_orders o
    where o.id = issue_order_id
      and app_private.material_issue_can_view(
        o.project_id, o.construction_site_id, o.source_warehouse_id, o.created_by,
        o.responsible_user_id, o.recipient_type, o.recipient_id
      )
  )
);

drop policy if exists material_issue_receipts_select on public.material_issue_receipts;
create policy material_issue_receipts_select on public.material_issue_receipts
for select to authenticated
using (
  exists (
    select 1 from public.material_issue_orders o
    where o.id = issue_order_id
      and app_private.material_issue_can_view(
        o.project_id, o.construction_site_id, o.source_warehouse_id, o.created_by,
        o.responsible_user_id, o.recipient_type, o.recipient_id
      )
  )
);

drop policy if exists material_issue_receipt_lines_select on public.material_issue_receipt_lines;
create policy material_issue_receipt_lines_select on public.material_issue_receipt_lines
for select to authenticated
using (
  exists (
    select 1
    from public.material_issue_receipts r
    join public.material_issue_orders o on o.id = r.issue_order_id
    where r.id = receipt_id
      and app_private.material_issue_can_view(
        o.project_id, o.construction_site_id, o.source_warehouse_id, o.created_by,
        o.responsible_user_id, o.recipient_type, o.recipient_id
      )
  )
);

drop policy if exists material_issue_returns_select on public.material_issue_returns;
create policy material_issue_returns_select on public.material_issue_returns
for select to authenticated
using (
  exists (
    select 1 from public.material_issue_orders o
    where o.id = issue_order_id
      and app_private.material_issue_can_view(
        o.project_id, o.construction_site_id, o.source_warehouse_id, o.created_by,
        o.responsible_user_id, o.recipient_type, o.recipient_id
      )
  )
);

drop policy if exists material_issue_return_lines_select on public.material_issue_return_lines;
create policy material_issue_return_lines_select on public.material_issue_return_lines
for select to authenticated
using (
  exists (
    select 1
    from public.material_issue_returns r
    join public.material_issue_orders o on o.id = r.issue_order_id
    where r.id = issue_return_id
      and app_private.material_issue_can_view(
        o.project_id, o.construction_site_id, o.source_warehouse_id, o.created_by,
        o.responsible_user_id, o.recipient_type, o.recipient_id
      )
  )
);

drop policy if exists material_party_ledger_select on public.material_party_ledger;
create policy material_party_ledger_select on public.material_party_ledger
for select to authenticated
using (
  exists (
    select 1 from public.material_issue_orders o
    where o.id = issue_order_id
      and app_private.material_issue_can_view(
        o.project_id, o.construction_site_id, o.source_warehouse_id, o.created_by,
        o.responsible_user_id, o.recipient_type, o.recipient_id
      )
  )
);

revoke all on table public.material_issue_orders from public, anon, authenticated;
revoke all on table public.material_issue_lines from public, anon, authenticated;
revoke all on table public.material_issue_receipts from public, anon, authenticated;
revoke all on table public.material_issue_receipt_lines from public, anon, authenticated;
revoke all on table public.material_issue_returns from public, anon, authenticated;
revoke all on table public.material_issue_return_lines from public, anon, authenticated;
revoke all on table public.material_party_ledger from public, anon, authenticated;

grant select on table public.material_issue_orders to authenticated;
grant select on table public.material_issue_lines to authenticated;
grant select on table public.material_issue_receipts to authenticated;
grant select on table public.material_issue_receipt_lines to authenticated;
grant select on table public.material_issue_returns to authenticated;
grant select on table public.material_issue_return_lines to authenticated;
grant select on table public.material_party_ledger to authenticated;

revoke all on function public.create_material_issue_order(text, text, text, text, text, text, uuid, text, text, text, date, text, jsonb) from public, anon;
revoke all on function public.submit_material_issue_order(uuid, text) from public, anon;
revoke all on function public.cancel_material_issue_order(uuid, text) from public, anon;
revoke all on function public.confirm_material_issue_receipt(uuid, jsonb, text, jsonb, text) from public, anon;
revoke all on function public.create_material_issue_return(uuid, text, jsonb, text, text) from public, anon;
revoke all on function public.record_material_issue_settlement(uuid, text, jsonb, text, jsonb) from public, anon;
revoke all on function public.get_material_party_balance(text, text, text, text) from public, anon;

grant execute on function public.create_material_issue_order(text, text, text, text, text, text, uuid, text, text, text, date, text, jsonb) to authenticated;
grant execute on function public.submit_material_issue_order(uuid, text) to authenticated;
grant execute on function public.cancel_material_issue_order(uuid, text) to authenticated;
grant execute on function public.confirm_material_issue_receipt(uuid, jsonb, text, jsonb, text) to authenticated;
grant execute on function public.create_material_issue_return(uuid, text, jsonb, text, text) to authenticated;
grant execute on function public.record_material_issue_settlement(uuid, text, jsonb, text, jsonb) to authenticated;
grant execute on function public.get_material_party_balance(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
