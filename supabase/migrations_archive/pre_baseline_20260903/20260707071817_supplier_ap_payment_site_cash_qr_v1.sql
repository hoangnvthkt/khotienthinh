create schema if not exists app_private;

alter table if exists public.purchase_orders
  drop constraint if exists purchase_orders_source_mode_check;

alter table if exists public.purchase_orders
  add constraint purchase_orders_source_mode_check
  check (source_mode in (
    'from_request',
    'proactive_project',
    'proactive_stock',
    'company_consolidated',
    'site_direct_planned',
    'site_direct_immediate'
  ));

alter table if exists public.purchase_orders
  add column if not exists direct_purchase_id text,
  add column if not exists payment_term text,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.purchase_orders
  drop constraint if exists purchase_orders_payment_status_check;

alter table if exists public.purchase_orders
  add constraint purchase_orders_payment_status_check
  check (payment_status in ('unpaid', 'partial', 'paid', 'overdue', 'cancelled'));

create table if not exists public.site_cash_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  project_id text,
  construction_site_id text not null,
  period_month date not null,
  cash_fund_id uuid references public.cash_funds(id) on delete set null,
  opening_balance numeric(18,2) not null default 0,
  topup_amount numeric(18,2) not null default 0,
  accepted_spend_amount numeric(18,2) not null default 0,
  rejected_spend_amount numeric(18,2) not null default 0,
  closing_balance numeric(18,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'reviewing', 'approved', 'closed', 'cancelled')),
  qr_token text unique,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  note text,
  check (project_id is not null or construction_site_id is not null),
  check (opening_balance >= 0),
  check (topup_amount >= 0),
  check (accepted_spend_amount >= 0),
  check (rejected_spend_amount >= 0)
);

create table if not exists public.site_cash_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_batch_id uuid not null references public.site_cash_settlement_batches(id) on delete cascade,
  source_type text not null check (source_type in ('site_direct_purchase', 'cash_voucher', 'manual_adjustment')),
  source_id text not null,
  supplier_id text,
  document_no_snapshot text,
  description text,
  claimed_amount numeric(18,2) not null default 0,
  spend_amount numeric(18,2) not null default 0,
  approved_amount numeric(18,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'adjusted', 'rejected')),
  review_note text,
  note text,
  created_at timestamptz not null default now(),
  check (claimed_amount >= 0),
  check (spend_amount >= 0),
  check (approved_amount >= 0),
  check (approved_amount <= greatest(claimed_amount, spend_amount))
);

create table if not exists public.site_direct_purchases (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  project_id text,
  construction_site_id text not null,
  supplier_id text,
  supplier_name_snapshot text not null,
  purchase_mode text not null check (purchase_mode in ('planned', 'immediate')),
  payment_source text not null check (payment_source in ('site_cash', 'company_bank', 'staff_paid', 'supplier_credit')),
  target_warehouse_id text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved_to_buy', 'purchased', 'received', 'finance_review', 'reconciled', 'closed', 'rejected', 'cancelled')),
  purchase_date date,
  invoice_number text,
  invoice_date date,
  gross_amount numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  po_id text references public.purchase_orders(id) on delete set null,
  wms_transaction_id text references public.transactions(id) on delete set null,
  site_cash_settlement_id uuid references public.site_cash_settlement_batches(id) on delete set null,
  qr_token text unique,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note text,
  check (project_id is not null or construction_site_id is not null),
  check (gross_amount >= 0),
  check (vat_amount >= 0),
  check (total_amount >= 0)
);

create table if not exists public.site_direct_purchase_lines (
  id uuid primary key default gen_random_uuid(),
  direct_purchase_id uuid not null references public.site_direct_purchases(id) on delete cascade,
  line_no integer not null,
  line_type text not null check (line_type in ('stock_item', 'expense_only')),
  item_id text,
  sku_snapshot text,
  item_name_snapshot text not null,
  unit_snapshot text,
  quantity numeric(18,6) not null default 0,
  unit_price numeric(18,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  line_amount numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  accepted_quantity numeric(18,6) not null default 0,
  accepted_amount numeric(18,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'adjusted', 'rejected')),
  rejection_reason text,
  work_boq_item_id text,
  material_budget_item_id text,
  note text,
  unique(direct_purchase_id, line_no),
  check (quantity >= 0),
  check (unit_price >= 0),
  check (vat_rate >= 0),
  check (line_amount >= 0),
  check (vat_amount >= 0),
  check (accepted_quantity >= 0),
  check (accepted_amount >= 0)
);

create table if not exists public.supplier_payable_documents (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  source_type text not null check (source_type in ('purchase_order', 'site_direct_purchase', 'supplier_return_credit', 'opening_balance', 'manual_adjustment')),
  source_id text not null,
  project_id text,
  construction_site_id text,
  supplier_id text,
  supplier_name_snapshot text not null,
  document_no text not null,
  document_date date not null,
  due_date date,
  currency text not null default 'VND',
  committed_amount numeric(18,2) not null default 0,
  recognized_amount numeric(18,2) not null default 0,
  credit_amount numeric(18,2) not null default 0,
  status text not null default 'open' check (status in ('draft', 'open', 'partial', 'paid', 'cancelled', 'reversed')),
  qr_token text unique,
  invoice_number text,
  invoice_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type, source_id),
  check (project_id is not null or construction_site_id is not null),
  check (committed_amount >= 0),
  check (recognized_amount >= 0),
  check (credit_amount >= 0)
);

create table if not exists public.supplier_payment_batches (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  project_id text,
  construction_site_id text,
  supplier_id text,
  supplier_name_snapshot text not null,
  period_month date,
  payment_date date not null,
  payment_method text not null default 'bank_transfer' check (payment_method in ('bank_transfer', 'cash', 'site_cash', 'offset', 'other')),
  cash_fund_id uuid references public.cash_funds(id) on delete set null,
  cash_voucher_id uuid references public.cash_vouchers(id) on delete set null,
  project_transaction_id text references public.project_transactions(id) on delete set null,
  bank_account_snapshot text,
  document_ref text,
  total_recognized_snapshot numeric(18,2) not null default 0,
  payment_amount numeric(18,2) not null default 0,
  currency text not null default 'VND',
  allocation_mode text not null default 'fifo' check (allocation_mode in ('fifo', 'manual', 'proportional')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'paid', 'cancelled', 'reversed')),
  qr_token text unique,
  attachments jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  approved_by uuid,
  paid_by uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),
  note text,
  check (project_id is not null or construction_site_id is not null),
  check (payment_amount >= 0),
  check (total_recognized_snapshot >= 0)
);

create table if not exists public.supplier_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_batch_id uuid not null references public.supplier_payment_batches(id) on delete cascade,
  payable_document_id uuid not null references public.supplier_payable_documents(id) on delete restrict,
  source_type text not null,
  source_id text not null,
  document_no_snapshot text not null,
  recognized_amount_snapshot numeric(18,2) not null default 0,
  paid_before_snapshot numeric(18,2) not null default 0,
  outstanding_before_snapshot numeric(18,2) not null default 0,
  allocated_amount numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  withholding_amount numeric(18,2) not null default 0,
  allocation_mode text not null default 'fifo' check (allocation_mode in ('fifo', 'manual', 'proportional')),
  note text,
  created_at timestamptz not null default now(),
  unique(payment_batch_id, payable_document_id),
  check (recognized_amount_snapshot >= 0),
  check (paid_before_snapshot >= 0),
  check (outstanding_before_snapshot >= 0),
  check (allocated_amount >= 0),
  check (discount_amount >= 0),
  check (withholding_amount >= 0),
  check (allocated_amount + discount_amount + withholding_amount <= outstanding_before_snapshot)
);

create index if not exists idx_supplier_payable_documents_supplier_status_date
  on public.supplier_payable_documents(supplier_id, status, document_date desc);
create index if not exists idx_supplier_payable_documents_scope_supplier
  on public.supplier_payable_documents(project_id, construction_site_id, supplier_id);
create index if not exists idx_supplier_payable_documents_open_supplier_date
  on public.supplier_payable_documents(supplier_id, document_date desc)
  where status in ('open', 'partial');
create index if not exists idx_supplier_payment_batches_supplier_period_status
  on public.supplier_payment_batches(supplier_id, period_month, status);
create index if not exists idx_supplier_payment_batches_scope_date
  on public.supplier_payment_batches(project_id, construction_site_id, payment_date desc);
create index if not exists idx_supplier_payment_allocations_batch
  on public.supplier_payment_allocations(payment_batch_id);
create index if not exists idx_supplier_payment_allocations_document
  on public.supplier_payment_allocations(payable_document_id);
create index if not exists idx_site_direct_purchases_scope_status
  on public.site_direct_purchases(project_id, construction_site_id, status, purchase_date desc);
create index if not exists idx_site_direct_purchases_supplier
  on public.site_direct_purchases(supplier_id, purchase_date desc);
create index if not exists idx_site_direct_purchase_lines_purchase
  on public.site_direct_purchase_lines(direct_purchase_id);
create index if not exists idx_site_cash_settlement_batches_scope_period
  on public.site_cash_settlement_batches(construction_site_id, period_month, status);
create index if not exists idx_site_cash_settlement_lines_batch
  on public.site_cash_settlement_lines(settlement_batch_id);

create or replace function app_private.set_site_direct_purchase_line_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.line_amount := round(coalesce(new.quantity, 0) * coalesce(new.unit_price, 0), 2);
  new.vat_amount := round(new.line_amount * coalesce(new.vat_rate, 0) / 100, 2);
  if new.status in ('accepted', 'adjusted') and coalesce(new.accepted_amount, 0) = 0 then
    new.accepted_amount := new.line_amount + new.vat_amount;
  end if;
  return new;
end;
$$;

create or replace function app_private.rollup_site_direct_purchase_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase_id uuid;
begin
  v_purchase_id := case when tg_op = 'DELETE' then old.direct_purchase_id else new.direct_purchase_id end;
  update public.site_direct_purchases p
  set
    gross_amount = coalesce(t.gross_amount, 0),
    vat_amount = coalesce(t.vat_amount, 0),
    total_amount = coalesce(t.gross_amount, 0) + coalesce(t.vat_amount, 0),
    updated_at = now()
  from (
    select
      direct_purchase_id,
      sum(line_amount)::numeric(18,2) as gross_amount,
      sum(vat_amount)::numeric(18,2) as vat_amount
    from public.site_direct_purchase_lines
    where direct_purchase_id = v_purchase_id
    group by direct_purchase_id
  ) t
  where p.id = v_purchase_id
    and t.direct_purchase_id = p.id;

  update public.site_direct_purchases p
  set
    gross_amount = 0,
    vat_amount = 0,
    total_amount = 0,
    updated_at = now()
  where p.id = v_purchase_id
    and not exists (
      select 1 from public.site_direct_purchase_lines line
      where line.direct_purchase_id = v_purchase_id
    );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_site_direct_purchase_line_totals on public.site_direct_purchase_lines;
create trigger trg_site_direct_purchase_line_totals
before insert or update of quantity, unit_price, vat_rate, status, accepted_amount on public.site_direct_purchase_lines
for each row execute function app_private.set_site_direct_purchase_line_totals();

drop trigger if exists trg_rollup_site_direct_purchase_totals on public.site_direct_purchase_lines;
create trigger trg_rollup_site_direct_purchase_totals
after insert or update or delete on public.site_direct_purchase_lines
for each row execute function app_private.rollup_site_direct_purchase_totals();

drop trigger if exists trg_site_cash_settlement_batches_updated_at on public.site_cash_settlement_batches;
create trigger trg_site_cash_settlement_batches_updated_at
before update on public.site_cash_settlement_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_site_direct_purchases_updated_at on public.site_direct_purchases;
create trigger trg_site_direct_purchases_updated_at
before update on public.site_direct_purchases
for each row execute function public.set_updated_at();

drop trigger if exists trg_supplier_payable_documents_updated_at on public.supplier_payable_documents;
create trigger trg_supplier_payable_documents_updated_at
before update on public.supplier_payable_documents
for each row execute function public.set_updated_at();

drop trigger if exists trg_supplier_payment_batches_updated_at on public.supplier_payment_batches;
create trigger trg_supplier_payment_batches_updated_at
before update on public.supplier_payment_batches
for each row execute function public.set_updated_at();

create or replace function app_private.calculate_po_payable_amount(p_items jsonb)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(
    greatest(
      0,
      coalesce(nullif(item->>'receivedQty', '')::numeric, nullif(item->>'received_qty', '')::numeric, 0)
      - coalesce(nullif(item->>'returnedQty', '')::numeric, nullif(item->>'returned_qty', '')::numeric, 0)
    )
    * coalesce(nullif(item->>'unitPrice', '')::numeric, nullif(item->>'unit_price', '')::numeric, 0)
  ), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item;
$$;

create or replace function app_private.calculate_po_committed_amount(p_items jsonb, p_total_amount numeric)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(nullif(sum(
    coalesce(nullif(item->>'qty', '')::numeric, 0)
    * coalesce(nullif(item->>'unitPrice', '')::numeric, nullif(item->>'unit_price', '')::numeric, 0)
  ), 0), coalesce(p_total_amount, 0))
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item;
$$;

create or replace function app_private.safe_date(p_value text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(p_value, '')::date;
exception when others then
  return null;
end;
$$;

create or replace function app_private.ap_scope_can_view(p_project_id text, p_construction_site_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.company_procurement_can_manage()
    or app_private.project_doc_can_view(p_project_id, p_construction_site_id, null),
    false
  );
$$;

create or replace function app_private.ap_scope_can_mutate(p_project_id text, p_construction_site_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.company_procurement_can_manage()
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'confirm'),
    false
  );
$$;

create or replace function app_private.guard_site_direct_purchase_wms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('received', 'finance_review', 'reconciled', 'closed')
    and exists (
      select 1
      from public.site_direct_purchase_lines line
      where line.direct_purchase_id = new.id
        and line.line_type = 'stock_item'
    )
    and not exists (
      select 1
      from public.transactions tx
      where tx.id = new.wms_transaction_id
        and tx.status::text = 'COMPLETED'
    )
  then
    raise exception 'Mua nóng vật tư tồn kho phải có phiếu nhập WMS hoàn tất trước khi ghi nhận.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_site_direct_purchase_wms on public.site_direct_purchases;
create trigger trg_guard_site_direct_purchase_wms
before update of status, wms_transaction_id on public.site_direct_purchases
for each row execute function app_private.guard_site_direct_purchase_wms();

create or replace function app_private.audit_supplier_ap_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record_id text;
  v_description text;
begin
  v_record_id := case when tg_op = 'DELETE' then old.id::text else new.id::text end;
  v_description := case tg_table_name
    when 'supplier_payment_batches' then 'Lưu vết đợt thanh toán NCC'
    when 'supplier_payment_allocations' then 'Lưu vết phân bổ thanh toán NCC'
    when 'supplier_payable_documents' then 'Lưu vết công nợ NCC'
    when 'site_direct_purchases' then 'Lưu vết mua nóng công trường'
    when 'site_cash_settlement_batches' then 'Lưu vết hoàn ứng công trường'
    else 'Lưu vết chứng từ NCC'
  end;

  insert into public.audit_trail (
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    user_id,
    user_name,
    module,
    description
  )
  values (
    tg_table_name,
    v_record_id,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end,
    public.current_app_user_id()::text,
    '',
    'TC',
    v_description
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_supplier_payable_documents on public.supplier_payable_documents;
create trigger trg_audit_supplier_payable_documents
after insert or update or delete on public.supplier_payable_documents
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_supplier_payment_batches on public.supplier_payment_batches;
create trigger trg_audit_supplier_payment_batches
after insert or update or delete on public.supplier_payment_batches
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_supplier_payment_allocations on public.supplier_payment_allocations;
create trigger trg_audit_supplier_payment_allocations
after insert or update or delete on public.supplier_payment_allocations
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_site_direct_purchases on public.site_direct_purchases;
create trigger trg_audit_site_direct_purchases
after insert or update or delete on public.site_direct_purchases
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_site_cash_settlement_batches on public.site_cash_settlement_batches;
create trigger trg_audit_site_cash_settlement_batches
after insert or update or delete on public.site_cash_settlement_batches
for each row execute function app_private.audit_supplier_ap_change();

create or replace view public.supplier_payable_document_balances
with (security_invoker = true)
as
with paid_allocations as (
  select
    a.payable_document_id,
    sum(a.allocated_amount) as paid_amount,
    sum(a.discount_amount + a.withholding_amount) as non_cash_credit_amount
  from public.supplier_payment_allocations a
  join public.supplier_payment_batches b on b.id = a.payment_batch_id
  where b.status = 'paid'
  group by a.payable_document_id
)
select
  d.*,
  coalesce(p.paid_amount, 0)::numeric(18,2) as paid_amount,
  coalesce(p.non_cash_credit_amount, 0)::numeric(18,2) as allocation_credit_amount,
  greatest(
    0,
    d.recognized_amount
      - d.credit_amount
      - coalesce(p.paid_amount, 0)
      - coalesce(p.non_cash_credit_amount, 0)
  )::numeric(18,2) as outstanding_amount,
  (
    d.due_date is not null
    and d.due_date < current_date
    and greatest(
      0,
      d.recognized_amount
        - d.credit_amount
        - coalesce(p.paid_amount, 0)
        - coalesce(p.non_cash_credit_amount, 0)
    ) > 0
  ) as is_overdue
from public.supplier_payable_documents d
left join paid_allocations p on p.payable_document_id = d.id;

create or replace view public.supplier_payable_balances
with (security_invoker = true)
as
select
  md5(concat_ws('|', coalesce(project_id, ''), coalesce(construction_site_id, ''), coalesce(supplier_id, ''), currency)) as id,
  project_id,
  construction_site_id,
  supplier_id,
  max(supplier_name_snapshot) as supplier_name_snapshot,
  currency,
  sum(recognized_amount)::numeric(18,2) as recognized_amount,
  sum(paid_amount)::numeric(18,2) as paid_amount,
  sum(credit_amount + allocation_credit_amount)::numeric(18,2) as credit_amount,
  sum(outstanding_amount)::numeric(18,2) as outstanding_amount,
  count(*)::integer as document_count,
  min(due_date) filter (where outstanding_amount > 0) as oldest_due_date,
  max(document_date) as latest_document_date,
  bool_or(is_overdue) as is_overdue,
  max(updated_at) as updated_at
from public.supplier_payable_document_balances
where status not in ('cancelled', 'reversed')
group by project_id, construction_site_id, supplier_id, currency;

create or replace function public.sync_supplier_payable_from_purchase_order(p_po_id text)
returns public.supplier_payable_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_recognized numeric(18,2);
  v_committed numeric(18,2);
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_po
  from public.purchase_orders
  where id = p_po_id
    and archived_at is null;

  if not found then
    raise exception 'Không tìm thấy PO %. ', p_po_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_po.project_id, v_po.construction_site_id) then
    raise exception 'Bạn không có quyền đồng bộ công nợ PO này.';
  end if;

  v_recognized := app_private.calculate_po_payable_amount(v_po.items)::numeric(18,2);
  v_committed := app_private.calculate_po_committed_amount(v_po.items, v_po.total_amount)::numeric(18,2);

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    invoice_number, invoice_date, metadata, created_by
  )
  values (
    'AP-' || coalesce(v_po.po_number, v_po.id),
    'purchase_order',
    v_po.id,
    v_po.project_id,
    v_po.construction_site_id,
    v_po.vendor_id,
    coalesce(v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
    coalesce(v_po.po_number, v_po.id),
    coalesce(app_private.safe_date(v_po.order_date), v_po.created_at::date, current_date),
    app_private.safe_date(v_po.expected_delivery_date),
    v_committed,
    v_recognized,
    0,
    case when v_recognized > 0 then 'open' else 'draft' end,
    coalesce(v_po.qr_token, 'ap_' || replace(v_po.id, '-', '')),
    v_po.invoice_number,
    v_po.invoice_date,
    jsonb_build_object(
      'sourceMode', v_po.source_mode,
      'targetWarehouseId', v_po.target_warehouse_id,
      'receivedTransactionIds', coalesce(v_po.received_transaction_ids, '[]'::jsonb)
    ),
    case
      when nullif(v_po.created_by_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then v_po.created_by_id::uuid
      else null
    end
  )
  on conflict (source_type, source_id) do update
  set
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    supplier_id = excluded.supplier_id,
    supplier_name_snapshot = excluded.supplier_name_snapshot,
    document_no = excluded.document_no,
    document_date = excluded.document_date,
    due_date = excluded.due_date,
    committed_amount = excluded.committed_amount,
    recognized_amount = excluded.recognized_amount,
    invoice_number = excluded.invoice_number,
    invoice_date = excluded.invoice_date,
    metadata = public.supplier_payable_documents.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_document;

  return v_document;
end;
$$;

create or replace function public.sync_supplier_payable_from_site_direct_purchase(p_direct_purchase_id uuid)
returns public.supplier_payable_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
  v_recognized numeric(18,2);
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_purchase.project_id, v_purchase.construction_site_id) then
    raise exception 'Bạn không có quyền đồng bộ công nợ phiếu mua nóng này.';
  end if;

  if exists (
    select 1
    from public.site_direct_purchase_lines line
    where line.direct_purchase_id = v_purchase.id
      and line.line_type = 'stock_item'
  )
  and not exists (
    select 1 from public.transactions tx
    where tx.id = v_purchase.wms_transaction_id
      and tx.status::text = 'COMPLETED'
  )
  then
    raise exception 'Mua nóng vật tư tồn kho phải hoàn tất WMS import trước khi ghi nhận AP.';
  end if;

  select coalesce(sum(
    case
      when line.status in ('accepted', 'adjusted') then coalesce(nullif(line.accepted_amount, 0), line.line_amount)
      else 0
    end
  ), 0)::numeric(18,2)
  into v_recognized
  from public.site_direct_purchase_lines line
  where line.direct_purchase_id = v_purchase.id;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    invoice_number, invoice_date, metadata, created_by
  )
  values (
    'AP-' || v_purchase.code,
    'site_direct_purchase',
    v_purchase.id::text,
    v_purchase.project_id,
    v_purchase.construction_site_id,
    v_purchase.supplier_id,
    v_purchase.supplier_name_snapshot,
    v_purchase.code,
    coalesce(v_purchase.purchase_date, current_date),
    null,
    v_purchase.total_amount,
    v_recognized,
    0,
    case when v_recognized > 0 then 'open' else 'draft' end,
    coalesce(v_purchase.qr_token, 'ap_direct_' || replace(v_purchase.id::text, '-', '')),
    v_purchase.invoice_number,
    v_purchase.invoice_date,
    jsonb_build_object(
      'purchaseMode', v_purchase.purchase_mode,
      'paymentSource', v_purchase.payment_source,
      'wmsTransactionId', v_purchase.wms_transaction_id
    ),
    v_purchase.created_by
  )
  on conflict (source_type, source_id) do update
  set
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    supplier_id = excluded.supplier_id,
    supplier_name_snapshot = excluded.supplier_name_snapshot,
    document_no = excluded.document_no,
    document_date = excluded.document_date,
    committed_amount = excluded.committed_amount,
    recognized_amount = excluded.recognized_amount,
    invoice_number = excluded.invoice_number,
    invoice_date = excluded.invoice_date,
    metadata = public.supplier_payable_documents.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_document;

  return v_document;
end;
$$;

create or replace function public.post_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.supplier_payment_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.supplier_payment_batches%rowtype;
  v_allocated numeric(18,2);
  v_finance_id text := '';
  v_tx_id text;
  v_allocation record;
begin
  select * into v_batch
  from public.supplier_payment_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt thanh toán %. ', p_batch_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền post đợt thanh toán này.';
  end if;

  if v_batch.status = 'paid' then
    return v_batch;
  end if;

  if v_batch.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post đợt thanh toán đã huỷ/đảo.';
  end if;

  select coalesce(sum(allocated_amount), 0)::numeric(18,2)
  into v_allocated
  from public.supplier_payment_allocations
  where payment_batch_id = p_batch_id;

  if v_allocated <> v_batch.payment_amount then
    raise exception 'Tổng phân bổ (%) phải bằng số tiền thanh toán (%).', v_allocated, v_batch.payment_amount;
  end if;

  for v_allocation in
    select
      a.*,
      d.document_no,
      d.recognized_amount,
      d.credit_amount,
      coalesce((
        select sum(a2.allocated_amount + a2.discount_amount + a2.withholding_amount)
        from public.supplier_payment_allocations a2
        join public.supplier_payment_batches b2 on b2.id = a2.payment_batch_id
        where a2.payable_document_id = a.payable_document_id
          and b2.status = 'paid'
          and b2.id <> p_batch_id
      ), 0) as paid_before
    from public.supplier_payment_allocations a
    join public.supplier_payable_documents d on d.id = a.payable_document_id
    where a.payment_batch_id = p_batch_id
    for update of d
  loop
    if v_allocation.paid_before + v_allocation.allocated_amount + v_allocation.discount_amount + v_allocation.withholding_amount
      > v_allocation.recognized_amount - v_allocation.credit_amount
    then
      raise exception 'Số phân bổ vượt công nợ của chứng từ %.', v_allocation.document_no;
    end if;
  end loop;

  select id into v_finance_id
  from public.project_finances
  where (v_batch.project_id is not null and project_id = v_batch.project_id)
     or (v_batch.construction_site_id is not null and construction_site_id = v_batch.construction_site_id)
  limit 1;

  v_tx_id := 'supplier-payment-' || p_batch_id::text;

  insert into public.project_transactions (
    id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref,
    attachments, "createdBy", "createdAt"
  )
  values (
    v_tx_id,
    coalesce(v_finance_id, ''),
    coalesce(v_batch.construction_site_id, ''),
    v_batch.project_id,
    nullif(v_finance_id, ''),
    v_batch.construction_site_id,
    'expense',
    'materials',
    v_batch.payment_amount,
    'Thanh toán NCC ' || v_batch.supplier_name_snapshot || ' - ' || v_batch.code,
    v_batch.payment_date::text,
    'workflow',
    'supplier_payment_batch:' || p_batch_id::text,
    'supplier_payment_batch:' || p_batch_id::text,
    coalesce(v_batch.attachments, '[]'::jsonb),
    p_actor_id::text,
    now()
  )
  on conflict (source_ref) do update
  set
    amount = excluded.amount,
    description = excluded.description,
    date = excluded.date,
    attachments = excluded.attachments;

  update public.supplier_payment_batches
  set
    status = 'paid',
    paid_by = coalesce(p_actor_id, paid_by),
    paid_at = coalesce(paid_at, now()),
    project_transaction_id = v_tx_id,
    updated_at = now()
  where id = p_batch_id
  returning * into v_batch;

  update public.supplier_payable_documents d
  set
    status = case
      when b.outstanding_amount <= 0 then 'paid'
      when b.paid_amount > 0 then 'partial'
      else d.status
    end,
    updated_at = now()
  from public.supplier_payable_document_balances b
  where b.id = d.id
    and d.id in (
      select payable_document_id
      from public.supplier_payment_allocations
      where payment_batch_id = p_batch_id
    );

  return v_batch;
end;
$$;

create or replace function public.reverse_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.supplier_payment_batches
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.supplier_payment_batches%rowtype;
  v_reversal_ref text;
begin
  select * into v_batch
  from public.supplier_payment_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt thanh toán %. ', p_batch_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_batch.project_id, v_batch.construction_site_id) then
    raise exception 'Bạn không có quyền đảo đợt thanh toán này.';
  end if;

  if v_batch.status <> 'paid' then
    raise exception 'Chỉ đảo được đợt thanh toán đã paid.';
  end if;

  v_reversal_ref := 'supplier_payment_batch:' || p_batch_id::text || ':reversal';

  insert into public.project_transactions (
    id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref,
    attachments, "createdBy", "createdAt"
  )
  values (
    'supplier-payment-reversal-' || p_batch_id::text,
    coalesce((
      select id from public.project_finances
      where (v_batch.project_id is not null and project_id = v_batch.project_id)
         or (v_batch.construction_site_id is not null and construction_site_id = v_batch.construction_site_id)
      limit 1
    ), ''),
    coalesce(v_batch.construction_site_id, ''),
    v_batch.project_id,
    (
      select id from public.project_finances
      where (v_batch.project_id is not null and project_id = v_batch.project_id)
         or (v_batch.construction_site_id is not null and construction_site_id = v_batch.construction_site_id)
      limit 1
    ),
    v_batch.construction_site_id,
    'expense',
    'materials',
    -v_batch.payment_amount,
    'Đảo thanh toán NCC ' || v_batch.supplier_name_snapshot || ' - ' || v_batch.code,
    current_date::text,
    'workflow',
    v_reversal_ref,
    v_reversal_ref,
    '[]'::jsonb,
    p_actor_id::text,
    now()
  )
  on conflict (source_ref) do nothing;

  update public.supplier_payment_batches
  set
    status = 'reversed',
    updated_at = now(),
    metadata = metadata || jsonb_build_object('reversedBy', p_actor_id, 'reversedAt', now())
  where id = p_batch_id
  returning * into v_batch;

  update public.supplier_payable_documents d
  set
    status = case
      when b.outstanding_amount <= 0 then 'paid'
      when b.paid_amount > 0 then 'partial'
      when d.recognized_amount > 0 then 'open'
      else 'draft'
    end,
    updated_at = now()
  from public.supplier_payable_document_balances b
  where b.id = d.id
    and d.id in (
      select payable_document_id
      from public.supplier_payment_allocations
      where payment_batch_id = p_batch_id
    );

  return v_batch;
end;
$$;

insert into public.supplier_payable_documents (
  code, source_type, source_id, project_id, construction_site_id,
  supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
  committed_amount, recognized_amount, credit_amount, status, qr_token,
  invoice_number, invoice_date, metadata, created_by
)
select
  'AP-' || coalesce(po.po_number, po.id),
  'purchase_order',
  po.id,
  po.project_id,
  po.construction_site_id,
  po.vendor_id,
  coalesce(po.vendor_name, po.vendor_id, 'Nhà cung cấp'),
  coalesce(po.po_number, po.id),
  coalesce(app_private.safe_date(po.order_date), po.created_at::date, current_date),
  app_private.safe_date(po.expected_delivery_date),
  app_private.calculate_po_committed_amount(po.items, po.total_amount)::numeric(18,2),
  app_private.calculate_po_payable_amount(po.items)::numeric(18,2),
  0,
  case when app_private.calculate_po_payable_amount(po.items) > 0 then 'open' else 'draft' end,
  coalesce(po.qr_token, 'ap_' || replace(po.id, '-', '')),
  po.invoice_number,
  po.invoice_date,
  jsonb_build_object(
    'sourceMode', po.source_mode,
    'targetWarehouseId', po.target_warehouse_id,
    'receivedTransactionIds', coalesce(po.received_transaction_ids, '[]'::jsonb),
    'backfilledAt', now()
  ),
  case
    when nullif(po.created_by_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then po.created_by_id::uuid
    else null
  end
from public.purchase_orders po
where coalesce(po.archived_at, null) is null
  and po.status not in ('cancelled', 'returned')
  and app_private.calculate_po_payable_amount(po.items) > 0
on conflict (source_type, source_id) do update
set
  project_id = excluded.project_id,
  construction_site_id = excluded.construction_site_id,
  supplier_id = excluded.supplier_id,
  supplier_name_snapshot = excluded.supplier_name_snapshot,
  document_no = excluded.document_no,
  document_date = excluded.document_date,
  due_date = excluded.due_date,
  committed_amount = excluded.committed_amount,
  recognized_amount = excluded.recognized_amount,
  invoice_number = excluded.invoice_number,
  invoice_date = excluded.invoice_date,
  metadata = public.supplier_payable_documents.metadata || excluded.metadata,
  updated_at = now();

alter table public.supplier_payable_documents enable row level security;
alter table public.supplier_payment_batches enable row level security;
alter table public.supplier_payment_allocations enable row level security;
alter table public.site_direct_purchases enable row level security;
alter table public.site_direct_purchase_lines enable row level security;
alter table public.site_cash_settlement_batches enable row level security;
alter table public.site_cash_settlement_lines enable row level security;

drop policy if exists supplier_payable_documents_access on public.supplier_payable_documents;
create policy supplier_payable_documents_access
on public.supplier_payable_documents
for all to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id))
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

drop policy if exists supplier_payment_batches_access on public.supplier_payment_batches;
create policy supplier_payment_batches_access
on public.supplier_payment_batches
for all to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id))
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

drop policy if exists supplier_payment_allocations_access on public.supplier_payment_allocations;
create policy supplier_payment_allocations_access
on public.supplier_payment_allocations
for all to authenticated
using (
  exists (
    select 1
    from public.supplier_payment_batches b
    where b.id = payment_batch_id
      and app_private.ap_scope_can_view(b.project_id, b.construction_site_id)
  )
)
with check (
  exists (
    select 1
    from public.supplier_payment_batches b
    where b.id = payment_batch_id
      and app_private.ap_scope_can_mutate(b.project_id, b.construction_site_id)
  )
);

drop policy if exists site_direct_purchases_access on public.site_direct_purchases;
create policy site_direct_purchases_access
on public.site_direct_purchases
for all to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id))
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

drop policy if exists site_direct_purchase_lines_access on public.site_direct_purchase_lines;
create policy site_direct_purchase_lines_access
on public.site_direct_purchase_lines
for all to authenticated
using (
  exists (
    select 1
    from public.site_direct_purchases p
    where p.id = direct_purchase_id
      and app_private.ap_scope_can_view(p.project_id, p.construction_site_id)
  )
)
with check (
  exists (
    select 1
    from public.site_direct_purchases p
    where p.id = direct_purchase_id
      and app_private.ap_scope_can_mutate(p.project_id, p.construction_site_id)
  )
);

drop policy if exists site_cash_settlement_batches_access on public.site_cash_settlement_batches;
create policy site_cash_settlement_batches_access
on public.site_cash_settlement_batches
for all to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id))
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

drop policy if exists site_cash_settlement_lines_access on public.site_cash_settlement_lines;
create policy site_cash_settlement_lines_access
on public.site_cash_settlement_lines
for all to authenticated
using (
  exists (
    select 1
    from public.site_cash_settlement_batches b
    where b.id = settlement_batch_id
      and app_private.ap_scope_can_view(b.project_id, b.construction_site_id)
  )
)
with check (
  exists (
    select 1
    from public.site_cash_settlement_batches b
    where b.id = settlement_batch_id
      and app_private.ap_scope_can_mutate(b.project_id, b.construction_site_id)
  )
);

revoke all on table public.supplier_payable_documents from public, anon, authenticated;
revoke all on table public.supplier_payment_batches from public, anon, authenticated;
revoke all on table public.supplier_payment_allocations from public, anon, authenticated;
revoke all on table public.site_direct_purchases from public, anon, authenticated;
revoke all on table public.site_direct_purchase_lines from public, anon, authenticated;
revoke all on table public.site_cash_settlement_batches from public, anon, authenticated;
revoke all on table public.site_cash_settlement_lines from public, anon, authenticated;
revoke all on table public.supplier_payable_document_balances from public, anon, authenticated;
revoke all on table public.supplier_payable_balances from public, anon, authenticated;

grant select, insert, update, delete on table public.supplier_payable_documents to authenticated;
grant select, insert, update, delete on table public.supplier_payment_batches to authenticated;
grant select, insert, update, delete on table public.supplier_payment_allocations to authenticated;
grant select, insert, update, delete on table public.site_direct_purchases to authenticated;
grant select, insert, update, delete on table public.site_direct_purchase_lines to authenticated;
grant select, insert, update, delete on table public.site_cash_settlement_batches to authenticated;
grant select, insert, update, delete on table public.site_cash_settlement_lines to authenticated;
grant select on table public.supplier_payable_document_balances to authenticated;
grant select on table public.supplier_payable_balances to authenticated;

revoke all on function app_private.calculate_po_payable_amount(jsonb) from public, anon, authenticated;
revoke all on function app_private.calculate_po_committed_amount(jsonb, numeric) from public, anon, authenticated;
revoke all on function app_private.safe_date(text) from public, anon, authenticated;
revoke all on function app_private.ap_scope_can_view(text, text) from public, anon, authenticated;
revoke all on function app_private.ap_scope_can_mutate(text, text) from public, anon, authenticated;
revoke all on function app_private.guard_site_direct_purchase_wms() from public, anon, authenticated;
revoke all on function app_private.audit_supplier_ap_change() from public, anon, authenticated;
revoke all on function app_private.set_site_direct_purchase_line_totals() from public, anon, authenticated;
revoke all on function app_private.rollup_site_direct_purchase_totals() from public, anon, authenticated;
grant execute on function app_private.ap_scope_can_view(text, text) to authenticated;
grant execute on function app_private.ap_scope_can_mutate(text, text) to authenticated;

revoke all on function public.sync_supplier_payable_from_purchase_order(text) from public, anon;
revoke all on function public.sync_supplier_payable_from_site_direct_purchase(uuid) from public, anon;
revoke all on function public.post_supplier_payment_batch(uuid, uuid) from public, anon;
revoke all on function public.reverse_supplier_payment_batch(uuid, uuid) from public, anon;
grant execute on function public.sync_supplier_payable_from_purchase_order(text) to authenticated;
grant execute on function public.sync_supplier_payable_from_site_direct_purchase(uuid) to authenticated;
grant execute on function public.post_supplier_payment_batch(uuid, uuid) to authenticated;
grant execute on function public.reverse_supplier_payment_batch(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
