create schema if not exists app_private;

create table if not exists public.supplier_contract_lines (
  id uuid primary key default gen_random_uuid(),
  supplier_contract_id text not null references public.supplier_contracts(id) on delete cascade,
  line_no integer not null,
  item_id text,
  sku_snapshot text,
  item_name_snapshot text not null,
  unit_snapshot text,
  unit_price numeric(18,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  quantity_limit numeric(18,6),
  amount_limit numeric(18,2),
  delivery_terms text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(supplier_contract_id, line_no),
  check (line_no > 0),
  check (unit_price >= 0),
  check (vat_rate >= 0),
  check (quantity_limit is null or quantity_limit >= 0),
  check (amount_limit is null or amount_limit >= 0)
);

create table if not exists public.supplier_delivery_statements (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  project_id text,
  construction_site_id text,
  supplier_contract_id text not null references public.supplier_contracts(id) on delete restrict,
  supplier_contract_code text,
  supplier_id text,
  supplier_name_snapshot text not null,
  period_month date not null,
  statement_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled', 'reversed')),
  gross_amount numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  payable_document_id uuid references public.supplier_payable_documents(id) on delete set null,
  qr_token text unique,
  attachments jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  posted_by uuid,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note text,
  check (project_id is not null or construction_site_id is not null),
  check (gross_amount >= 0),
  check (vat_amount >= 0),
  check (total_amount >= 0)
);

create table if not exists public.supplier_direct_delivery_notes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  project_id text,
  construction_site_id text,
  supplier_contract_id text not null references public.supplier_contracts(id) on delete restrict,
  supplier_contract_code text,
  supplier_id text,
  supplier_name_snapshot text not null,
  delivery_ticket_no text not null,
  delivery_date date not null default current_date,
  vehicle_no text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'site_confirmed', 'finance_review', 'accepted', 'statemented', 'rejected', 'cancelled')),
  gross_amount numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  attachments jsonb not null default '[]'::jsonb,
  qr_token text unique,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  note text,
  unique(supplier_contract_id, delivery_ticket_no),
  check (project_id is not null or construction_site_id is not null),
  check (gross_amount >= 0),
  check (vat_amount >= 0),
  check (total_amount >= 0)
);

create table if not exists public.supplier_direct_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_note_id uuid not null references public.supplier_direct_delivery_notes(id) on delete cascade,
  supplier_contract_id text not null references public.supplier_contracts(id) on delete restrict,
  supplier_contract_line_id uuid references public.supplier_contract_lines(id) on delete set null,
  line_no integer not null,
  item_id text,
  sku_snapshot text,
  item_name_snapshot text not null,
  unit_snapshot text,
  quantity numeric(18,6) not null default 0,
  unit_price numeric(18,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  line_amount numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  accepted_quantity numeric(18,6) not null default 0,
  accepted_amount numeric(18,2) not null default 0,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'adjusted', 'rejected')),
  issue_reason text,
  work_boq_item_id text,
  material_budget_item_id text,
  statement_id uuid references public.supplier_delivery_statements(id) on delete set null,
  rejection_reason text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(delivery_note_id, line_no),
  check (line_no > 0),
  check (quantity >= 0),
  check (unit_price >= 0),
  check (vat_rate >= 0),
  check (line_amount >= 0),
  check (vat_amount >= 0),
  check (total_amount >= 0),
  check (accepted_quantity >= 0),
  check (accepted_amount >= 0)
);

create table if not exists public.supplier_delivery_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.supplier_delivery_statements(id) on delete cascade,
  delivery_note_id uuid not null references public.supplier_direct_delivery_notes(id) on delete restrict,
  delivery_line_id uuid not null references public.supplier_direct_delivery_lines(id) on delete restrict,
  supplier_contract_id text not null references public.supplier_contracts(id) on delete restrict,
  item_name_snapshot text not null,
  unit_snapshot text,
  accepted_quantity numeric(18,6) not null default 0,
  accepted_amount numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique(statement_id, delivery_line_id),
  check (accepted_quantity >= 0),
  check (accepted_amount >= 0),
  check (vat_amount >= 0),
  check (total_amount >= 0)
);

alter table if exists public.supplier_payable_documents
  add column if not exists supplier_contract_id text references public.supplier_contracts(id) on delete set null,
  add column if not exists supplier_contract_code text;

alter table if exists public.supplier_payable_documents
  drop constraint if exists supplier_payable_documents_source_type_check;

alter table if exists public.supplier_payable_documents
  add constraint supplier_payable_documents_source_type_check
  check (source_type in (
    'purchase_order',
    'site_direct_purchase',
    'supplier_delivery_statement',
    'supplier_return_credit',
    'opening_balance',
    'manual_adjustment'
  ));

create index if not exists idx_supplier_contract_lines_contract
  on public.supplier_contract_lines(supplier_contract_id, line_no);
create index if not exists idx_supplier_direct_delivery_notes_contract_status
  on public.supplier_direct_delivery_notes(supplier_contract_id, status, delivery_date desc);
create index if not exists idx_supplier_direct_delivery_notes_scope_status
  on public.supplier_direct_delivery_notes(project_id, construction_site_id, status, delivery_date desc);
create index if not exists idx_supplier_direct_delivery_lines_note
  on public.supplier_direct_delivery_lines(delivery_note_id, line_no);
create index if not exists idx_supplier_direct_delivery_lines_statement
  on public.supplier_direct_delivery_lines(statement_id);
create index if not exists idx_supplier_delivery_statements_contract_period
  on public.supplier_delivery_statements(supplier_contract_id, period_month, status);
create index if not exists idx_supplier_delivery_statements_scope_date
  on public.supplier_delivery_statements(project_id, construction_site_id, statement_date desc);
create index if not exists idx_supplier_delivery_statement_lines_statement
  on public.supplier_delivery_statement_lines(statement_id);
create index if not exists idx_supplier_delivery_statement_lines_delivery_line
  on public.supplier_delivery_statement_lines(delivery_line_id);
create index if not exists idx_supplier_payable_documents_supplier_contract
  on public.supplier_payable_documents(supplier_contract_id, document_date desc);

create or replace function app_private.set_supplier_direct_delivery_line_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.line_amount := round(coalesce(new.quantity, 0) * coalesce(new.unit_price, 0), 2);
  new.vat_amount := round(new.line_amount * coalesce(new.vat_rate, 0) / 100, 2);
  new.total_amount := round(new.line_amount + new.vat_amount, 2);
  if new.status in ('accepted', 'adjusted') and coalesce(new.accepted_amount, 0) = 0 then
    new.accepted_amount := new.total_amount;
  end if;
  if new.status in ('accepted', 'adjusted') and coalesce(new.accepted_quantity, 0) = 0 then
    new.accepted_quantity := new.quantity;
  end if;
  if new.status = 'rejected' then
    new.accepted_amount := 0;
    new.accepted_quantity := 0;
  end if;
  return new;
end;
$$;

create or replace function app_private.rollup_supplier_direct_delivery_note_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note_id uuid;
begin
  v_note_id := case when tg_op = 'DELETE' then old.delivery_note_id else new.delivery_note_id end;
  update public.supplier_direct_delivery_notes note
  set
    gross_amount = coalesce(t.gross_amount, 0),
    vat_amount = coalesce(t.vat_amount, 0),
    total_amount = coalesce(t.total_amount, 0),
    updated_at = now()
  from (
    select
      delivery_note_id,
      sum(line_amount)::numeric(18,2) as gross_amount,
      sum(vat_amount)::numeric(18,2) as vat_amount,
      sum(total_amount)::numeric(18,2) as total_amount
    from public.supplier_direct_delivery_lines
    where delivery_note_id = v_note_id
    group by delivery_note_id
  ) t
  where note.id = v_note_id
    and t.delivery_note_id = note.id;

  update public.supplier_direct_delivery_notes note
  set gross_amount = 0, vat_amount = 0, total_amount = 0, updated_at = now()
  where note.id = v_note_id
    and not exists (
      select 1
      from public.supplier_direct_delivery_lines line
      where line.delivery_note_id = v_note_id
    );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_supplier_direct_delivery_line_totals on public.supplier_direct_delivery_lines;
create trigger trg_supplier_direct_delivery_line_totals
before insert or update of quantity, unit_price, vat_rate, status, accepted_quantity, accepted_amount
on public.supplier_direct_delivery_lines
for each row execute function app_private.set_supplier_direct_delivery_line_totals();

drop trigger if exists trg_rollup_supplier_direct_delivery_note_totals on public.supplier_direct_delivery_lines;
create trigger trg_rollup_supplier_direct_delivery_note_totals
after insert or update or delete on public.supplier_direct_delivery_lines
for each row execute function app_private.rollup_supplier_direct_delivery_note_totals();

drop trigger if exists trg_supplier_contract_lines_updated_at on public.supplier_contract_lines;
create trigger trg_supplier_contract_lines_updated_at
before update on public.supplier_contract_lines
for each row execute function public.set_updated_at();

drop trigger if exists trg_supplier_direct_delivery_notes_updated_at on public.supplier_direct_delivery_notes;
create trigger trg_supplier_direct_delivery_notes_updated_at
before update on public.supplier_direct_delivery_notes
for each row execute function public.set_updated_at();

drop trigger if exists trg_supplier_direct_delivery_lines_updated_at on public.supplier_direct_delivery_lines;
create trigger trg_supplier_direct_delivery_lines_updated_at
before update on public.supplier_direct_delivery_lines
for each row execute function public.set_updated_at();

drop trigger if exists trg_supplier_delivery_statements_updated_at on public.supplier_delivery_statements;
create trigger trg_supplier_delivery_statements_updated_at
before update on public.supplier_delivery_statements
for each row execute function public.set_updated_at();

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
  d.id,
  d.code,
  d.source_type,
  d.source_id,
  d.project_id,
  d.construction_site_id,
  d.supplier_id,
  d.supplier_name_snapshot,
  d.document_no,
  d.document_date,
  d.due_date,
  d.currency,
  d.committed_amount,
  d.recognized_amount,
  d.credit_amount,
  d.status,
  d.qr_token,
  d.invoice_number,
  d.invoice_date,
  d.metadata,
  d.created_by,
  d.created_at,
  d.updated_at,
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
  ) as is_overdue,
  d.supplier_contract_id,
  d.supplier_contract_code
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

create or replace function public.sync_supplier_payable_from_delivery_statement(p_statement_id uuid)
returns public.supplier_payable_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_statement.project_id, v_statement.construction_site_id) then
    raise exception 'Bạn không có quyền đồng bộ công nợ bảng đối soát này.';
  end if;

  if v_statement.status <> 'posted' then
    raise exception 'Chỉ bảng đối soát đã post mới được ghi nhận phải trả NCC.';
  end if;

  if coalesce(v_statement.total_amount, 0) <= 0 then
    raise exception 'Bảng đối soát chưa có giá trị được duyệt.';
  end if;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, supplier_contract_id, supplier_contract_code,
    document_no, document_date, due_date, committed_amount, recognized_amount,
    credit_amount, status, qr_token, metadata, created_by
  )
  values (
    'AP-' || v_statement.code,
    'supplier_delivery_statement',
    v_statement.id::text,
    v_statement.project_id,
    v_statement.construction_site_id,
    v_statement.supplier_id,
    v_statement.supplier_name_snapshot,
    v_statement.supplier_contract_id,
    v_statement.supplier_contract_code,
    v_statement.code,
    v_statement.statement_date,
    null,
    v_statement.total_amount,
    v_statement.total_amount,
    0,
    'open',
    coalesce(v_statement.qr_token, 'ap_statement_' || replace(v_statement.id::text, '-', '')),
    jsonb_build_object(
      'supplierContractId', v_statement.supplier_contract_id,
      'supplierContractCode', v_statement.supplier_contract_code,
      'periodMonth', v_statement.period_month,
      'statementId', v_statement.id
    ) || coalesce(v_statement.metadata, '{}'::jsonb),
    v_statement.created_by
  )
  on conflict (source_type, source_id) do update
  set
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    supplier_id = excluded.supplier_id,
    supplier_name_snapshot = excluded.supplier_name_snapshot,
    supplier_contract_id = excluded.supplier_contract_id,
    supplier_contract_code = excluded.supplier_contract_code,
    document_no = excluded.document_no,
    document_date = excluded.document_date,
    committed_amount = excluded.committed_amount,
    recognized_amount = excluded.recognized_amount,
    metadata = public.supplier_payable_documents.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_document;

  update public.supplier_delivery_statements
  set payable_document_id = v_document.id, updated_at = now()
  where id = v_statement.id;

  return v_document;
end;
$$;

create or replace function public.post_supplier_delivery_statement(p_statement_id uuid, p_actor_id uuid default null)
returns public.supplier_delivery_statements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_contract public.supplier_contracts%rowtype;
  v_document public.supplier_payable_documents%rowtype;
  v_gross numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_statement.project_id, v_statement.construction_site_id) then
    raise exception 'Bạn không có quyền post bảng đối soát này.';
  end if;

  if v_statement.status = 'posted' then
    return v_statement;
  end if;

  if v_statement.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post bảng đối soát đã huỷ/đảo.';
  end if;

  select * into v_contract
  from public.supplier_contracts
  where id = v_statement.supplier_contract_id;

  if not found then
    raise exception 'Không tìm thấy HĐ NCC %. ', v_statement.supplier_contract_id;
  end if;

  if v_contract.status = 'cancelled' then
    raise exception 'Không thể ghi nhận phải trả từ HĐ NCC đã huỷ.';
  end if;

  if not exists (
    select 1
    from public.supplier_delivery_statement_lines
    where statement_id = p_statement_id
  ) then
    raise exception 'Bảng đối soát chưa có dòng giao nhận được duyệt.';
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
    where sl.statement_id = p_statement_id
      and dl.status not in ('accepted', 'adjusted')
  ) then
    raise exception 'Bảng đối soát chỉ được gồm dòng giao nhận accepted/adjusted.';
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_delivery_statement_lines other_sl on other_sl.delivery_line_id = sl.delivery_line_id
    join public.supplier_delivery_statements other_s on other_s.id = other_sl.statement_id
    where sl.statement_id = p_statement_id
      and other_sl.statement_id <> p_statement_id
      and other_s.status in ('draft', 'posted')
  ) then
    raise exception 'Có dòng giao nhận đã nằm trong bảng đối soát khác.';
  end if;

  select
    coalesce(sum(accepted_amount), 0)::numeric(18,2),
    coalesce(sum(vat_amount), 0)::numeric(18,2),
    coalesce(sum(total_amount), 0)::numeric(18,2)
  into v_gross, v_vat, v_total
  from public.supplier_delivery_statement_lines
  where statement_id = p_statement_id;

  if v_total <= 0 then
    raise exception 'Bảng đối soát chưa có giá trị được duyệt.';
  end if;

  update public.supplier_delivery_statements
  set
    gross_amount = v_gross,
    vat_amount = v_vat,
    total_amount = v_total,
    status = 'posted',
    posted_by = coalesce(p_actor_id, posted_by),
    posted_at = coalesce(posted_at, now()),
    supplier_contract_code = coalesce(supplier_contract_code, v_contract.code),
    supplier_id = coalesce(supplier_id, v_contract.supplier_id),
    supplier_name_snapshot = coalesce(nullif(supplier_name_snapshot, ''), v_contract.supplier_name, 'Nhà cung cấp'),
    updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  update public.supplier_direct_delivery_lines dl
  set statement_id = p_statement_id, updated_at = now()
  from public.supplier_delivery_statement_lines sl
  where sl.statement_id = p_statement_id
    and sl.delivery_line_id = dl.id;

  update public.supplier_direct_delivery_notes note
  set status = 'statemented', updated_at = now()
  where exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    where sl.statement_id = p_statement_id
      and sl.delivery_note_id = note.id
  )
  and not exists (
    select 1
    from public.supplier_direct_delivery_lines dl
    where dl.delivery_note_id = note.id
      and dl.status in ('accepted', 'adjusted')
      and dl.statement_id is null
  );

  v_document := public.sync_supplier_payable_from_delivery_statement(p_statement_id);

  update public.supplier_delivery_statements
  set payable_document_id = v_document.id, updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  return v_statement;
end;
$$;

create or replace function public.reverse_supplier_delivery_statement(p_statement_id uuid, p_actor_id uuid default null)
returns public.supplier_delivery_statements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_statement public.supplier_delivery_statements%rowtype;
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_statement.project_id, v_statement.construction_site_id) then
    raise exception 'Bạn không có quyền đảo bảng đối soát này.';
  end if;

  if v_statement.status <> 'posted' then
    raise exception 'Chỉ đảo được bảng đối soát đã post.';
  end if;

  if exists (
    select 1
    from public.supplier_payment_allocations a
    join public.supplier_payment_batches b on b.id = a.payment_batch_id
    where a.payable_document_id = v_statement.payable_document_id
      and b.status = 'paid'
  ) then
    raise exception 'Bảng đối soát đã có thanh toán paid. Hãy đảo thanh toán trước.';
  end if;

  update public.supplier_payable_documents
  set status = 'reversed', updated_at = now()
  where id = v_statement.payable_document_id;

  update public.supplier_direct_delivery_lines dl
  set statement_id = null, updated_at = now()
  where dl.statement_id = p_statement_id;

  update public.supplier_direct_delivery_notes note
  set status = 'accepted', updated_at = now()
  where exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    where sl.statement_id = p_statement_id
      and sl.delivery_note_id = note.id
  )
  and status = 'statemented';

  update public.supplier_delivery_statements
  set
    status = 'reversed',
    metadata = metadata || jsonb_build_object('reversedBy', p_actor_id, 'reversedAt', now()),
    updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  return v_statement;
end;
$$;

drop trigger if exists trg_audit_supplier_contract_lines on public.supplier_contract_lines;
create trigger trg_audit_supplier_contract_lines
after insert or update or delete on public.supplier_contract_lines
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_supplier_direct_delivery_notes on public.supplier_direct_delivery_notes;
create trigger trg_audit_supplier_direct_delivery_notes
after insert or update or delete on public.supplier_direct_delivery_notes
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_supplier_direct_delivery_lines on public.supplier_direct_delivery_lines;
create trigger trg_audit_supplier_direct_delivery_lines
after insert or update or delete on public.supplier_direct_delivery_lines
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_supplier_delivery_statements on public.supplier_delivery_statements;
create trigger trg_audit_supplier_delivery_statements
after insert or update or delete on public.supplier_delivery_statements
for each row execute function app_private.audit_supplier_ap_change();

drop trigger if exists trg_audit_supplier_delivery_statement_lines on public.supplier_delivery_statement_lines;
create trigger trg_audit_supplier_delivery_statement_lines
after insert or update or delete on public.supplier_delivery_statement_lines
for each row execute function app_private.audit_supplier_ap_change();

alter table public.supplier_contract_lines enable row level security;
alter table public.supplier_direct_delivery_notes enable row level security;
alter table public.supplier_direct_delivery_lines enable row level security;
alter table public.supplier_delivery_statements enable row level security;
alter table public.supplier_delivery_statement_lines enable row level security;

drop policy if exists supplier_contract_lines_access on public.supplier_contract_lines;
create policy supplier_contract_lines_access
on public.supplier_contract_lines
for all to authenticated
using (
  exists (
    select 1
    from public.supplier_contracts c
    where c.id = supplier_contract_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or app_private.ap_scope_can_view(c.project_id, c.construction_site_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.supplier_contracts c
    where c.id = supplier_contract_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or app_private.ap_scope_can_mutate(c.project_id, c.construction_site_id)
      )
  )
);

drop policy if exists supplier_direct_delivery_notes_access on public.supplier_direct_delivery_notes;
create policy supplier_direct_delivery_notes_access
on public.supplier_direct_delivery_notes
for all to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id))
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

drop policy if exists supplier_direct_delivery_lines_access on public.supplier_direct_delivery_lines;
create policy supplier_direct_delivery_lines_access
on public.supplier_direct_delivery_lines
for all to authenticated
using (
  exists (
    select 1
    from public.supplier_direct_delivery_notes note
    where note.id = delivery_note_id
      and app_private.ap_scope_can_view(note.project_id, note.construction_site_id)
  )
)
with check (
  exists (
    select 1
    from public.supplier_direct_delivery_notes note
    where note.id = delivery_note_id
      and app_private.ap_scope_can_mutate(note.project_id, note.construction_site_id)
  )
);

drop policy if exists supplier_delivery_statements_access on public.supplier_delivery_statements;
create policy supplier_delivery_statements_access
on public.supplier_delivery_statements
for all to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id))
with check (app_private.ap_scope_can_mutate(project_id, construction_site_id));

drop policy if exists supplier_delivery_statement_lines_access on public.supplier_delivery_statement_lines;
create policy supplier_delivery_statement_lines_access
on public.supplier_delivery_statement_lines
for all to authenticated
using (
  exists (
    select 1
    from public.supplier_delivery_statements s
    where s.id = statement_id
      and app_private.ap_scope_can_view(s.project_id, s.construction_site_id)
  )
)
with check (
  exists (
    select 1
    from public.supplier_delivery_statements s
    where s.id = statement_id
      and app_private.ap_scope_can_mutate(s.project_id, s.construction_site_id)
  )
);

revoke all on table public.supplier_contract_lines from public, anon, authenticated;
revoke all on table public.supplier_direct_delivery_notes from public, anon, authenticated;
revoke all on table public.supplier_direct_delivery_lines from public, anon, authenticated;
revoke all on table public.supplier_delivery_statements from public, anon, authenticated;
revoke all on table public.supplier_delivery_statement_lines from public, anon, authenticated;
grant select, insert, update, delete on table public.supplier_contract_lines to authenticated;
grant select, insert, update, delete on table public.supplier_direct_delivery_notes to authenticated;
grant select, insert, update, delete on table public.supplier_direct_delivery_lines to authenticated;
grant select, insert, update, delete on table public.supplier_delivery_statements to authenticated;
grant select, insert, update, delete on table public.supplier_delivery_statement_lines to authenticated;

revoke all on function app_private.set_supplier_direct_delivery_line_totals() from public, anon, authenticated;
revoke all on function app_private.rollup_supplier_direct_delivery_note_totals() from public, anon, authenticated;
revoke all on function public.sync_supplier_payable_from_delivery_statement(uuid) from public, anon;
revoke all on function public.post_supplier_delivery_statement(uuid, uuid) from public, anon;
revoke all on function public.reverse_supplier_delivery_statement(uuid, uuid) from public, anon;
grant execute on function public.sync_supplier_payable_from_delivery_statement(uuid) to authenticated;
grant execute on function public.post_supplier_delivery_statement(uuid, uuid) to authenticated;
grant execute on function public.reverse_supplier_delivery_statement(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
