-- G7: explicit supplier invoice allocation, versioned payment posting and
-- provenance-aware finance read models. Existing rows remain matching_version 1.

create or replace function app_private.bump_g7_row_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

alter table public.supplier_invoices
  add column currency text not null default 'VND',
  add column status text not null default 'posted',
  add column matching_version integer not null default 1,
  add column row_version bigint not null default 1,
  add column matching_payload_hash text,
  add column reversed_at timestamptz,
  add column reversed_by uuid references public.users(id) on delete set null,
  add column reversal_reason text,
  add constraint supplier_invoices_currency_check check (currency ~ '^[A-Z]{3}$'),
  add constraint supplier_invoices_status_check check (status in ('posted', 'reversed')),
  add constraint supplier_invoices_matching_version_check check (matching_version > 0),
  add constraint supplier_invoices_reversal_check check (
    (status = 'posted' and reversed_at is null and reversed_by is null and reversal_reason is null)
    or (status = 'reversed' and reversed_at is not null and reversed_by is not null and nullif(btrim(reversal_reason), '') is not null)
  );

create trigger trg_supplier_invoices_row_version
before update on public.supplier_invoices
for each row execute function app_private.bump_g7_row_version();

create index if not exists idx_supplier_invoices_created_by on public.supplier_invoices(created_by) where created_by is not null;
create index idx_supplier_invoices_reversed_by on public.supplier_invoices(reversed_by) where reversed_by is not null;

alter table public.supplier_invoice_payable_links
  add column allocated_net_amount numeric(18,2),
  add column allocated_vat_amount numeric(18,2),
  add column variance_amount numeric(18,2) not null default 0,
  add column coverage_mode text,
  add column project_id text,
  add column construction_site_id text,
  add column currency text;

update public.supplier_invoice_payable_links link
set allocated_net_amount = link.allocated_gross_amount,
    allocated_vat_amount = 0,
    coverage_mode = 'full',
    project_id = document.project_id,
    construction_site_id = document.construction_site_id,
    currency = document.currency
from public.supplier_payable_documents document
where document.id = link.payable_document_id;

alter table public.supplier_invoice_payable_links
  alter column allocated_net_amount set not null,
  alter column allocated_vat_amount set not null,
  alter column coverage_mode set not null,
  alter column currency set not null,
  add constraint supplier_invoice_links_amounts_check check (
    allocated_net_amount >= 0 and allocated_vat_amount >= 0
    and round(allocated_net_amount + allocated_vat_amount, 2) = round(allocated_gross_amount, 2)
  ),
  add constraint supplier_invoice_links_coverage_check check (coverage_mode in ('partial', 'full')),
  add constraint supplier_invoice_links_currency_check check (currency ~ '^[A-Z]{3}$');

create or replace function app_private.normalize_supplier_invoice_link_v2_compat()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_document from public.supplier_payable_documents where id=new.payable_document_id;
  if not found then raise exception 'SUPPLIER_INVOICE_AP_NOT_FOUND' using errcode='P0002'; end if;
  new.allocated_net_amount := coalesce(new.allocated_net_amount,new.allocated_gross_amount);
  new.allocated_vat_amount := coalesce(new.allocated_vat_amount,0);
  new.variance_amount := coalesce(new.variance_amount,0);
  new.coverage_mode := coalesce(new.coverage_mode,'full');
  new.project_id := coalesce(new.project_id,v_document.project_id);
  new.construction_site_id := coalesce(new.construction_site_id,v_document.construction_site_id);
  new.currency := coalesce(new.currency,v_document.currency);
  return new;
end;
$$;
revoke all on function app_private.normalize_supplier_invoice_link_v2_compat() from public,anon,authenticated;
create trigger trg_supplier_invoice_link_v2_compat
before insert on public.supplier_invoice_payable_links
for each row execute function app_private.normalize_supplier_invoice_link_v2_compat();

create table public.supplier_invoice_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.supplier_invoices(id) on delete restrict,
  payable_document_id uuid not null references public.supplier_payable_documents(id) on delete restrict,
  delivery_line_id uuid not null references public.purchase_order_delivery_lines(id) on delete restrict,
  quantity numeric(20,6) not null check (quantity > 0),
  unit text not null check (nullif(btrim(unit), '') is not null),
  invoice_unit_price numeric(18,6) not null check (invoice_unit_price >= 0),
  receipt_unit_price_snapshot numeric(18,6) not null check (receipt_unit_price_snapshot >= 0),
  allocated_net_amount numeric(18,2) not null check (allocated_net_amount >= 0),
  allocated_vat_amount numeric(18,2) not null check (allocated_vat_amount >= 0),
  allocated_gross_amount numeric(18,2) not null check (allocated_gross_amount > 0),
  price_variance_amount numeric(18,2) not null default 0,
  price_source text not null check (nullif(btrim(price_source), '') is not null),
  created_at timestamptz not null default now(),
  unique (invoice_id, payable_document_id, delivery_line_id),
  check (round(allocated_net_amount + allocated_vat_amount, 2) = round(allocated_gross_amount, 2))
);

create index idx_supplier_invoice_receipt_allocations_line
  on public.supplier_invoice_receipt_allocations(delivery_line_id, invoice_id);
create index idx_supplier_invoice_receipt_allocations_payable
  on public.supplier_invoice_receipt_allocations(payable_document_id, invoice_id);

alter table public.supplier_invoice_receipt_allocations enable row level security;
create policy supplier_invoice_receipt_allocations_select
on public.supplier_invoice_receipt_allocations for select to authenticated
using (exists (
  select 1 from public.supplier_payable_documents document
  where document.id = payable_document_id
    and app_private.ap_scope_can_view(document.project_id, document.construction_site_id)
));
revoke all on public.supplier_invoice_receipt_allocations from public, anon, authenticated;
grant select on public.supplier_invoice_receipt_allocations to authenticated;
grant all on public.supplier_invoice_receipt_allocations to service_role;

revoke insert, update, delete on public.supplier_invoices from authenticated;
revoke insert, update, delete on public.supplier_invoice_payable_links from authenticated;

create table public.finance_accounting_period_locks (
  id uuid primary key default gen_random_uuid(),
  project_id text,
  construction_site_id text,
  currency text not null default 'VND' check (currency ~ '^[A-Z]{3}$'),
  period_start date not null,
  period_end date not null,
  is_locked boolean not null default true,
  reason text not null check (nullif(btrim(reason), '') is not null),
  locked_by uuid not null references public.users(id) on delete restrict,
  locked_at timestamptz not null default now(),
  unlocked_by uuid references public.users(id) on delete restrict,
  unlocked_at timestamptz,
  row_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (project_id is not null or construction_site_id is not null),
  check (period_end >= period_start),
  check ((is_locked and unlocked_by is null and unlocked_at is null) or (not is_locked and unlocked_by is not null and unlocked_at is not null))
);

create unique index uq_finance_accounting_period_locks_scope
  on public.finance_accounting_period_locks(
    coalesce(project_id, ''), coalesce(construction_site_id, ''), currency, period_start, period_end
  );
create index idx_finance_accounting_period_locks_locked_by on public.finance_accounting_period_locks(locked_by);
create index idx_finance_accounting_period_locks_unlocked_by on public.finance_accounting_period_locks(unlocked_by) where unlocked_by is not null;

create trigger trg_finance_accounting_period_locks_row_version
before update on public.finance_accounting_period_locks
for each row execute function app_private.bump_g7_row_version();
create trigger trg_finance_accounting_period_locks_updated_at
before update on public.finance_accounting_period_locks
for each row execute function public.set_updated_at();

alter table public.finance_accounting_period_locks enable row level security;
create policy finance_accounting_period_locks_select
on public.finance_accounting_period_locks for select to authenticated
using (app_private.ap_scope_can_view(project_id, construction_site_id));
revoke all on public.finance_accounting_period_locks from public, anon, authenticated;
grant select on public.finance_accounting_period_locks to authenticated;
grant all on public.finance_accounting_period_locks to service_role;

create table app_private.supplier_finance_commands (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  command_type text not null,
  idempotency_key text not null,
  payload_hash text not null,
  aggregate_id uuid,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, command_type, idempotency_key)
);
revoke all on app_private.supplier_finance_commands from public, anon, authenticated;
grant all on app_private.supplier_finance_commands to service_role;

create or replace function app_private.finance_period_is_locked(
  p_project_id text,
  p_construction_site_id text,
  p_currency text,
  p_effective_date date
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.finance_accounting_period_locks period
    where period.is_locked
      and period.project_id is not distinct from nullif(p_project_id, '')
      and period.construction_site_id is not distinct from nullif(p_construction_site_id, '')
      and period.currency = upper(p_currency)
      and p_effective_date between period.period_start and period.period_end
  );
$$;
revoke all on function app_private.finance_period_is_locked(text, text, text, date) from public, anon, authenticated;

create or replace function app_private.set_finance_accounting_period_lock_v1(
  p_project_id text,
  p_construction_site_id text,
  p_currency text,
  p_period_start date,
  p_period_end date,
  p_is_locked boolean,
  p_reason text,
  p_expected_row_version bigint default null
)
returns public.finance_accounting_period_locks
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_period public.finance_accounting_period_locks%rowtype;
begin
  if v_actor is null or not app_private.can_manage_supplier_payments(p_project_id, p_construction_site_id) then
    raise exception 'FINANCE_PERIOD_LOCK_FORBIDDEN' using errcode = '42501';
  end if;
  if (nullif(p_project_id, '') is null and nullif(p_construction_site_id, '') is null)
     or upper(coalesce(p_currency, '')) !~ '^[A-Z]{3}$'
     or p_period_start is null or p_period_end < p_period_start
     or nullif(btrim(p_reason), '') is null then
    raise exception 'FINANCE_PERIOD_LOCK_INVALID' using errcode = '22023';
  end if;

  select * into v_period from public.finance_accounting_period_locks period
  where period.project_id is not distinct from nullif(p_project_id, '')
    and period.construction_site_id is not distinct from nullif(p_construction_site_id, '')
    and period.currency = upper(p_currency)
    and period.period_start = p_period_start and period.period_end = p_period_end
  for update;

  if found then
    if p_expected_row_version is null or v_period.row_version <> p_expected_row_version then
      raise exception 'FINANCE_PERIOD_STALE_VERSION' using errcode = '40001';
    end if;
    update public.finance_accounting_period_locks
    set is_locked = p_is_locked, reason = btrim(p_reason),
        locked_by = case when p_is_locked then v_actor else locked_by end,
        locked_at = case when p_is_locked then now() else locked_at end,
        unlocked_by = case when p_is_locked then null else v_actor end,
        unlocked_at = case when p_is_locked then null else now() end
    where id = v_period.id returning * into v_period;
  else
    if not p_is_locked then raise exception 'FINANCE_PERIOD_LOCK_NOT_FOUND' using errcode = 'P0002'; end if;
    insert into public.finance_accounting_period_locks(
      project_id, construction_site_id, currency, period_start, period_end, reason, locked_by
    ) values (
      nullif(p_project_id, ''), nullif(p_construction_site_id, ''), upper(p_currency),
      p_period_start, p_period_end, btrim(p_reason), v_actor
    ) returning * into v_period;
  end if;
  return v_period;
end;
$$;
revoke all on function app_private.set_finance_accounting_period_lock_v1(text,text,text,date,date,boolean,text,bigint) from public, anon, authenticated;
grant execute on function app_private.set_finance_accounting_period_lock_v1(text,text,text,date,date,boolean,text,bigint) to authenticated, service_role;

create or replace function public.set_finance_accounting_period_lock_v1(
  p_project_id text,
  p_construction_site_id text,
  p_currency text,
  p_period_start date,
  p_period_end date,
  p_is_locked boolean,
  p_reason text,
  p_expected_row_version bigint default null
)
returns public.finance_accounting_period_locks
language sql security invoker set search_path = ''
as $$
  select app_private.set_finance_accounting_period_lock_v1(
    p_project_id, p_construction_site_id, p_currency, p_period_start, p_period_end,
    p_is_locked, p_reason, p_expected_row_version
  );
$$;
revoke all on function public.set_finance_accounting_period_lock_v1(text,text,text,date,date,boolean,text,bigint) from public, anon;
grant execute on function public.set_finance_accounting_period_lock_v1(text,text,text,date,date,boolean,text,bigint) to authenticated, service_role;

create or replace view public.supplier_invoice_payable_balances
with (security_invoker = true)
as
select
  document.id as payable_document_id,
  document.project_id,
  document.construction_site_id,
  document.currency,
  document.recognized_amount,
  document.credit_amount,
  coalesce(sum(link.allocated_gross_amount) filter (where invoice.status = 'posted'), 0)::numeric(18,2) as invoiced_to_date,
  greatest(
    document.recognized_amount - document.credit_amount
      - coalesce(sum(link.allocated_gross_amount) filter (where invoice.status = 'posted'), 0),
    0
  )::numeric(18,2) as uninvoiced_amount
from public.supplier_payable_documents document
left join public.supplier_invoice_payable_links link on link.payable_document_id = document.id
left join public.supplier_invoices invoice on invoice.id = link.invoice_id
group by document.id;
revoke all on public.supplier_invoice_payable_balances from public, anon;
grant select on public.supplier_invoice_payable_balances to authenticated, service_role;

create or replace view public.supplier_invoice_receipt_balances
with (security_invoker = true)
as
select
  line.id as delivery_line_id,
  line.delivery_batch_id,
  line.purchase_order_id,
  line.purchase_order_line_id,
  line.item_id,
  line.accepted_qty,
  line.unit,
  coalesce(sum(allocation.quantity) filter (where invoice.status = 'posted'), 0)::numeric(20,6) as invoiced_to_date,
  greatest(line.accepted_qty - coalesce(sum(allocation.quantity) filter (where invoice.status = 'posted'), 0), 0)::numeric(20,6) as uninvoiced_qty
from public.purchase_order_delivery_lines line
left join public.supplier_invoice_receipt_allocations allocation on allocation.delivery_line_id = line.id
left join public.supplier_invoices invoice on invoice.id = allocation.invoice_id
group by line.id;
revoke all on public.supplier_invoice_receipt_balances from public, anon;
grant select on public.supplier_invoice_receipt_balances to authenticated, service_role;

create or replace function app_private.record_supplier_invoice_reconciliation_v3(
  p_invoice jsonb,
  p_payable_allocations jsonb,
  p_receipt_allocations jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_payload_hash text := md5(jsonb_build_object(
    'invoice', p_invoice, 'payable', p_payable_allocations, 'receipt', coalesce(p_receipt_allocations, '[]'::jsonb)
  )::text);
  v_existing_command app_private.supplier_finance_commands%rowtype;
  v_invoice public.supplier_invoices%rowtype;
  v_invoice_id uuid;
  v_supplier_id text := nullif(btrim(p_invoice ->> 'supplierId'), '');
  v_supplier_name text := nullif(btrim(p_invoice ->> 'supplierNameSnapshot'), '');
  v_invoice_number text := nullif(btrim(p_invoice ->> 'invoiceNumber'), '');
  v_invoice_date date;
  v_currency text := upper(coalesce(nullif(btrim(p_invoice ->> 'currency'), ''), 'VND'));
  v_net numeric(18,2);
  v_vat numeric(18,2);
  v_gross numeric(18,2);
  v_link jsonb;
  v_receipt jsonb;
  v_document public.supplier_payable_documents%rowtype;
  v_delivery public.purchase_order_delivery_lines%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_payable_id uuid;
  v_delivery_line_id uuid;
  v_allocated_net numeric(18,2);
  v_allocated_vat numeric(18,2);
  v_allocated_gross numeric(18,2);
  v_allocated_total numeric(18,2) := 0;
  v_net_total numeric(18,2) := 0;
  v_vat_total numeric(18,2) := 0;
  v_prior numeric(18,2);
  v_receipt_total numeric(18,2);
  v_qty numeric(20,6);
  v_invoice_unit_price numeric(18,6);
  v_prior_qty numeric(20,6);
  v_book_gross numeric(18,2);
  v_coverage text;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'SUPPLIER_INVOICE_IDEMPOTENCY_REQUIRED' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_payable_allocations, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payable_allocations, '[]'::jsonb)) = 0
     or jsonb_typeof(coalesce(p_receipt_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'SUPPLIER_INVOICE_ALLOCATIONS_INVALID' using errcode = '22023';
  end if;
  begin
    v_invoice_date := nullif(p_invoice ->> 'invoiceDate', '')::date;
    v_net := round((p_invoice ->> 'netAmount')::numeric, 2);
    v_vat := round((p_invoice ->> 'vatAmount')::numeric, 2);
    v_gross := round((p_invoice ->> 'grossAmount')::numeric, 2);
    v_invoice_id := coalesce(nullif(p_invoice ->> 'id', '')::uuid, gen_random_uuid());
  exception when others then
    raise exception 'SUPPLIER_INVOICE_HEADER_INVALID' using errcode = '22023';
  end;
  if v_supplier_id is null or v_supplier_name is null or v_invoice_number is null or v_invoice_date is null
     or v_currency !~ '^[A-Z]{3}$' or v_net < 0 or v_vat < 0 or v_gross <= 0
     or round(v_net + v_vat, 2) <> v_gross
     or jsonb_typeof(coalesce(p_invoice -> 'attachments', '[]'::jsonb)) <> 'array' then
    raise exception 'SUPPLIER_INVOICE_HEADER_INVALID' using errcode = '22023';
  end if;

  select * into v_existing_command from app_private.supplier_finance_commands command
  where command.actor_user_id = v_actor and command.command_type = 'invoice_record'
    and command.idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_existing_command.payload_hash <> v_payload_hash then
      raise exception 'SUPPLIER_INVOICE_REPLAY_CONFLICT' using errcode = '22023';
    end if;
    return v_existing_command.result || jsonb_build_object('replayed', true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('supplier-invoice:' || v_supplier_id || ':' || lower(v_invoice_number), 0));
  select * into v_invoice from public.supplier_invoices invoice
  where invoice.supplier_id = v_supplier_id and lower(btrim(invoice.invoice_number)) = lower(v_invoice_number)
  for update;
  if found then
    if v_invoice.matching_payload_hash = v_payload_hash then
      return jsonb_build_object('invoice', to_jsonb(v_invoice), 'replayed', true);
    end if;
    raise exception 'SUPPLIER_INVOICE_REPLAY_CONFLICT' using errcode = '23505';
  end if;

  if (select count(*) from jsonb_array_elements(p_payable_allocations)) <>
     (select count(distinct nullif(value ->> 'payableDocumentId', '')::uuid) from jsonb_array_elements(p_payable_allocations)) then
    raise exception 'SUPPLIER_INVOICE_DUPLICATE_AP' using errcode = '22023';
  end if;

  perform document.id from public.supplier_payable_documents document
  where document.id in (
    select nullif(value ->> 'payableDocumentId', '')::uuid from jsonb_array_elements(p_payable_allocations)
  ) order by document.id for update;

  for v_link in select value from jsonb_array_elements(p_payable_allocations) order by value ->> 'payableDocumentId'
  loop
    begin
      v_payable_id := nullif(v_link ->> 'payableDocumentId', '')::uuid;
      v_allocated_net := round((v_link ->> 'allocatedNetAmount')::numeric, 2);
      v_allocated_vat := round((v_link ->> 'allocatedVatAmount')::numeric, 2);
      v_allocated_gross := round((v_link ->> 'allocatedGrossAmount')::numeric, 2);
    exception when others then
      raise exception 'SUPPLIER_INVOICE_AP_ALLOCATION_INVALID' using errcode = '22023';
    end;
    select * into v_document from public.supplier_payable_documents document where document.id = v_payable_id;
    if not found then raise exception 'SUPPLIER_INVOICE_AP_NOT_FOUND' using errcode = 'P0002'; end if;
    if not app_private.ap_scope_can_mutate(v_document.project_id, v_document.construction_site_id) then
      raise exception 'SUPPLIER_INVOICE_SCOPE_FORBIDDEN' using errcode = '42501';
    end if;
    if v_document.status in ('cancelled', 'reversed') or v_document.supplier_id is distinct from v_supplier_id
       or v_document.currency <> v_currency or v_allocated_gross <= 0
       or round(v_allocated_net + v_allocated_vat, 2) <> v_allocated_gross then
      raise exception 'SUPPLIER_INVOICE_AP_ALLOCATION_INVALID' using errcode = '22023';
    end if;
    if app_private.finance_period_is_locked(v_document.project_id, v_document.construction_site_id, v_currency, v_invoice_date) then
      raise exception 'FINANCE_PERIOD_LOCKED' using errcode = '55000';
    end if;
    select coalesce(sum(link.allocated_gross_amount), 0)::numeric(18,2) into v_prior
    from public.supplier_invoice_payable_links link
    join public.supplier_invoices invoice on invoice.id = link.invoice_id and invoice.status = 'posted'
    where link.payable_document_id = v_payable_id;
    if v_allocated_gross > round(greatest(v_document.recognized_amount - v_document.credit_amount - v_prior, 0), 2) then
      raise exception 'SUPPLIER_INVOICE_AP_OVER_ALLOCATED' using errcode = '23514';
    end if;
    v_allocated_total := round(v_allocated_total + v_allocated_gross, 2);
    v_net_total := round(v_net_total + v_allocated_net, 2);
    v_vat_total := round(v_vat_total + v_allocated_vat, 2);
  end loop;
  if v_allocated_total <> v_gross or v_net_total <> v_net or v_vat_total <> v_vat then
    raise exception 'SUPPLIER_INVOICE_TOTAL_MISMATCH' using errcode = '22023';
  end if;

  if (select count(*) from jsonb_array_elements(coalesce(p_receipt_allocations, '[]'::jsonb))) <>
     (select count(distinct (value ->> 'payableDocumentId') || ':' || (value ->> 'deliveryLineId')) from jsonb_array_elements(coalesce(p_receipt_allocations, '[]'::jsonb))) then
    raise exception 'SUPPLIER_INVOICE_DUPLICATE_RECEIPT_LINE' using errcode = '22023';
  end if;

  perform line.id from public.purchase_order_delivery_lines line
  where line.id in (
    select nullif(value ->> 'deliveryLineId', '')::uuid from jsonb_array_elements(coalesce(p_receipt_allocations, '[]'::jsonb))
  ) order by line.id for update;

  for v_receipt in select value from jsonb_array_elements(coalesce(p_receipt_allocations, '[]'::jsonb)) order by value ->> 'deliveryLineId'
  loop
    begin
      v_payable_id := nullif(v_receipt ->> 'payableDocumentId', '')::uuid;
      v_delivery_line_id := nullif(v_receipt ->> 'deliveryLineId', '')::uuid;
      v_qty := round((v_receipt ->> 'quantity')::numeric, 6);
      v_invoice_unit_price := round((v_receipt ->> 'unitPrice')::numeric, 6);
      v_allocated_net := round((v_receipt ->> 'netAmount')::numeric, 2);
      v_allocated_vat := round((v_receipt ->> 'vatAmount')::numeric, 2);
      v_allocated_gross := round((v_receipt ->> 'grossAmount')::numeric, 2);
    exception when others then
      raise exception 'SUPPLIER_INVOICE_RECEIPT_ALLOCATION_INVALID' using errcode = '22023';
    end;
    select * into v_document from public.supplier_payable_documents where id = v_payable_id;
    select * into v_delivery from public.purchase_order_delivery_lines where id = v_delivery_line_id;
    select * into v_batch from public.purchase_order_delivery_batches where id = v_delivery.delivery_batch_id;
    if v_document.id is null or v_delivery.id is null or v_batch.id is null or v_qty <= 0 or v_invoice_unit_price < 0
       or nullif(btrim(v_receipt ->> 'unit'), '') is null
       or nullif(btrim(v_receipt ->> 'priceSource'), '') is null
       or (v_document.source_type = 'purchase_delivery_receipt' and v_document.source_id <> v_delivery.delivery_batch_id::text)
       or (v_document.source_type = 'purchase_order' and v_document.source_id <> v_delivery.purchase_order_id)
       or v_document.source_type not in ('purchase_delivery_receipt', 'purchase_order')
       or v_delivery.unit is distinct from v_receipt ->> 'unit'
       or round(v_allocated_net + v_allocated_vat, 2) <> v_allocated_gross then
      raise exception 'SUPPLIER_INVOICE_RECEIPT_ALLOCATION_INVALID' using errcode = '22023';
    end if;
    select coalesce(sum(allocation.quantity), 0)::numeric(20,6) into v_prior_qty
    from public.supplier_invoice_receipt_allocations allocation
    join public.supplier_invoices invoice on invoice.id = allocation.invoice_id and invoice.status = 'posted'
    where allocation.delivery_line_id = v_delivery_line_id;
    if v_qty > round(greatest(v_delivery.accepted_qty - v_prior_qty, 0), 6) then
      raise exception 'SUPPLIER_INVOICE_RECEIPT_OVER_ALLOCATED' using errcode = '23514';
    end if;
  end loop;

  for v_link in select value from jsonb_array_elements(p_payable_allocations)
  loop
    v_payable_id := (v_link ->> 'payableDocumentId')::uuid;
    select coalesce(sum(round((value ->> 'grossAmount')::numeric, 2)), 0)::numeric(18,2) into v_receipt_total
    from jsonb_array_elements(coalesce(p_receipt_allocations, '[]'::jsonb))
    where value ->> 'payableDocumentId' = v_payable_id::text;
    if v_receipt_total > 0 and v_receipt_total <> round((v_link ->> 'allocatedGrossAmount')::numeric, 2) then
      raise exception 'SUPPLIER_INVOICE_RECEIPT_TOTAL_MISMATCH' using errcode = '22023';
    end if;
  end loop;

  insert into public.supplier_invoices(
    id, supplier_id, supplier_name_snapshot, invoice_number, invoice_date,
    net_amount, vat_amount, gross_amount, currency, status, matching_version,
    matching_payload_hash, variance_reason, attachments, created_by
  ) values (
    v_invoice_id, v_supplier_id, v_supplier_name, v_invoice_number, v_invoice_date,
    v_net, v_vat, v_gross, v_currency, 'posted', 2, v_payload_hash,
    nullif(btrim(coalesce(p_invoice ->> 'varianceReason', '')), ''),
    coalesce(p_invoice -> 'attachments', '[]'::jsonb), v_actor
  ) returning * into v_invoice;

  for v_link in select value from jsonb_array_elements(p_payable_allocations)
  loop
    v_payable_id := (v_link ->> 'payableDocumentId')::uuid;
    select * into v_document from public.supplier_payable_documents where id = v_payable_id;
    v_allocated_gross := round((v_link ->> 'allocatedGrossAmount')::numeric, 2);
    select coalesce(sum(round(
      (receipt.value ->> 'quantity')::numeric * delivery.delivery_unit_price * (1 + coalesce(batch.vat_rate, 0) / 100), 2
    )), v_allocated_gross)::numeric(18,2) into v_book_gross
    from jsonb_array_elements(coalesce(p_receipt_allocations, '[]'::jsonb)) receipt(value)
    join public.purchase_order_delivery_lines delivery on delivery.id = (receipt.value ->> 'deliveryLineId')::uuid
    join public.purchase_order_delivery_batches batch on batch.id = delivery.delivery_batch_id
    where receipt.value ->> 'payableDocumentId' = v_payable_id::text;
    select coalesce(sum(link.allocated_gross_amount), 0)::numeric(18,2) into v_prior
    from public.supplier_invoice_payable_links link
    join public.supplier_invoices invoice on invoice.id = link.invoice_id and invoice.status = 'posted'
    where link.payable_document_id = v_payable_id;
    v_coverage := case when v_allocated_gross = round(greatest(v_document.recognized_amount - v_document.credit_amount - v_prior, 0), 2)
      then 'full' else 'partial' end;
    insert into public.supplier_invoice_payable_links(
      invoice_id, payable_document_id, allocated_gross_amount, allocated_net_amount,
      allocated_vat_amount, variance_amount, coverage_mode, project_id,
      construction_site_id, currency
    ) values (
      v_invoice_id, v_payable_id, v_allocated_gross,
      round((v_link ->> 'allocatedNetAmount')::numeric, 2),
      round((v_link ->> 'allocatedVatAmount')::numeric, 2),
      round(v_allocated_gross - v_book_gross, 2), v_coverage,
      v_document.project_id, v_document.construction_site_id, v_document.currency
    );
  end loop;

  for v_receipt in select value from jsonb_array_elements(coalesce(p_receipt_allocations, '[]'::jsonb))
  loop
    v_delivery_line_id := (v_receipt ->> 'deliveryLineId')::uuid;
    select * into v_delivery from public.purchase_order_delivery_lines where id = v_delivery_line_id;
    v_qty := round((v_receipt ->> 'quantity')::numeric, 6);
    v_allocated_net := round((v_receipt ->> 'netAmount')::numeric, 2);
    insert into public.supplier_invoice_receipt_allocations(
      invoice_id, payable_document_id, delivery_line_id, quantity, unit,
      invoice_unit_price, receipt_unit_price_snapshot, allocated_net_amount,
      allocated_vat_amount, allocated_gross_amount, price_variance_amount, price_source
    ) values (
      v_invoice_id, (v_receipt ->> 'payableDocumentId')::uuid, v_delivery_line_id,
      v_qty, v_receipt ->> 'unit', round((v_receipt ->> 'unitPrice')::numeric, 6),
      v_delivery.delivery_unit_price, v_allocated_net,
      round((v_receipt ->> 'vatAmount')::numeric, 2), round((v_receipt ->> 'grossAmount')::numeric, 2),
      round(v_allocated_net - v_qty * v_delivery.delivery_unit_price, 2), btrim(v_receipt ->> 'priceSource')
    );
  end loop;

  select * into v_invoice from public.supplier_invoices where id = v_invoice_id;
  v_result := jsonb_build_object('invoice', to_jsonb(v_invoice), 'replayed', false);
  insert into app_private.supplier_finance_commands(
    actor_user_id, command_type, idempotency_key, payload_hash, aggregate_id, result
  ) values (v_actor, 'invoice_record', p_idempotency_key, v_payload_hash, v_invoice_id, v_result);
  return v_result;
end;
$$;
revoke all on function app_private.record_supplier_invoice_reconciliation_v3(jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function app_private.record_supplier_invoice_reconciliation_v3(jsonb,jsonb,jsonb,text) to authenticated, service_role;

create or replace function public.record_supplier_invoice_reconciliation_v3(
  p_invoice jsonb,
  p_payable_allocations jsonb,
  p_receipt_allocations jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language sql security invoker set search_path = ''
as $$
  select app_private.record_supplier_invoice_reconciliation_v3(
    p_invoice, p_payable_allocations, p_receipt_allocations, p_idempotency_key
  );
$$;
revoke all on function public.record_supplier_invoice_reconciliation_v3(jsonb,jsonb,jsonb,text) from public, anon;
grant execute on function public.record_supplier_invoice_reconciliation_v3(jsonb,jsonb,jsonb,text) to authenticated, service_role;

create or replace function app_private.reverse_supplier_invoice_v1(
  p_invoice_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key text,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_invoice public.supplier_invoices%rowtype;
  v_link record;
  v_hash text := md5(jsonb_build_object('invoiceId', p_invoice_id, 'version', p_expected_row_version, 'reason', btrim(p_reason))::text);
  v_command app_private.supplier_finance_commands%rowtype;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if nullif(btrim(p_idempotency_key), '') is null or nullif(btrim(p_reason), '') is null then
    raise exception 'SUPPLIER_INVOICE_REVERSAL_INVALID' using errcode = '22023';
  end if;
  select * into v_command from app_private.supplier_finance_commands command
  where command.actor_user_id = v_actor and command.command_type = 'invoice_reverse'
    and command.idempotency_key = p_idempotency_key for update;
  if found then
    if v_command.payload_hash <> v_hash then raise exception 'SUPPLIER_INVOICE_REPLAY_CONFLICT' using errcode = '22023'; end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_invoice from public.supplier_invoices where id = p_invoice_id for update;
  if not found then raise exception 'SUPPLIER_INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_invoice.row_version <> p_expected_row_version then raise exception 'SUPPLIER_INVOICE_STALE_VERSION' using errcode = '40001'; end if;
  if v_invoice.status <> 'posted' then raise exception 'SUPPLIER_INVOICE_POSTED_REQUIRED' using errcode = '55000'; end if;
  perform document.id from public.supplier_invoice_payable_links link
  join public.supplier_payable_documents document on document.id = link.payable_document_id
  where link.invoice_id = p_invoice_id order by document.id for update of document;
  for v_link in
    select link.* from public.supplier_invoice_payable_links link where link.invoice_id = p_invoice_id order by link.payable_document_id
  loop
    if not app_private.ap_scope_can_mutate(v_link.project_id, v_link.construction_site_id) then
      raise exception 'SUPPLIER_INVOICE_SCOPE_FORBIDDEN' using errcode = '42501';
    end if;
    if app_private.finance_period_is_locked(v_link.project_id, v_link.construction_site_id, v_link.currency, current_date) then
      raise exception 'FINANCE_PERIOD_LOCKED' using errcode = '55000';
    end if;
  end loop;
  update public.supplier_invoices set status = 'reversed', reversed_at = now(), reversed_by = v_actor,
    reversal_reason = btrim(p_reason), updated_at = now() where id = p_invoice_id returning * into v_invoice;
  v_result := jsonb_build_object('invoice', to_jsonb(v_invoice), 'replayed', false);
  insert into app_private.supplier_finance_commands(actor_user_id, command_type, idempotency_key, payload_hash, aggregate_id, result)
  values (v_actor, 'invoice_reverse', p_idempotency_key, v_hash, p_invoice_id, v_result);
  return v_result;
end;
$$;
revoke all on function app_private.reverse_supplier_invoice_v1(uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function app_private.reverse_supplier_invoice_v1(uuid,bigint,text,text) to authenticated, service_role;

create or replace function public.reverse_supplier_invoice_v1(
  p_invoice_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key text,
  p_reason text
)
returns jsonb
language sql security invoker set search_path = ''
as $$ select app_private.reverse_supplier_invoice_v1(p_invoice_id,p_expected_row_version,p_idempotency_key,p_reason); $$;
revoke all on function public.reverse_supplier_invoice_v1(uuid,bigint,text,text) from public, anon;
grant execute on function public.reverse_supplier_invoice_v1(uuid,bigint,text,text) to authenticated, service_role;

-- Guard the legacy payment RPCs too, so direct callers cannot bypass period locks.
alter function app_private.post_supplier_payment_batch(uuid, uuid)
  rename to post_supplier_payment_batch_engine_g7;
revoke all on function app_private.post_supplier_payment_batch_engine_g7(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.post_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.supplier_payment_batches
language plpgsql security definer set search_path = ''
as $$
declare v_batch public.supplier_payment_batches%rowtype;
begin
  select * into v_batch from public.supplier_payment_batches where id = p_batch_id for update;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if app_private.finance_period_is_locked(v_batch.project_id, v_batch.construction_site_id, v_batch.currency, v_batch.payment_date) then
    raise exception 'FINANCE_PERIOD_LOCKED' using errcode = '55000';
  end if;
  perform document.id from public.supplier_payment_allocations allocation
  join public.supplier_payable_documents document on document.id = allocation.payable_document_id
  where allocation.payment_batch_id = p_batch_id order by document.id for update of document;
  return app_private.post_supplier_payment_batch_engine_g7(p_batch_id, p_actor_id);
end;
$$;
revoke all on function app_private.post_supplier_payment_batch(uuid,uuid) from public, anon, authenticated;
grant execute on function app_private.post_supplier_payment_batch(uuid,uuid) to authenticated, service_role;

alter function public.reverse_supplier_payment_batch(uuid, uuid)
  rename to reverse_supplier_payment_batch_engine_g7;
alter function public.reverse_supplier_payment_batch_engine_g7(uuid, uuid)
  set schema app_private;
revoke all on function app_private.reverse_supplier_payment_batch_engine_g7(uuid,uuid) from public, anon, authenticated;

create or replace function app_private.reverse_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.supplier_payment_batches
language plpgsql security definer set search_path = ''
as $$
declare v_batch public.supplier_payment_batches%rowtype;
begin
  select * into v_batch from public.supplier_payment_batches where id = p_batch_id for update;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if app_private.finance_period_is_locked(v_batch.project_id, v_batch.construction_site_id, v_batch.currency, current_date) then
    raise exception 'FINANCE_PERIOD_LOCKED' using errcode = '55000';
  end if;
  perform document.id from public.supplier_payment_allocations allocation
  join public.supplier_payable_documents document on document.id = allocation.payable_document_id
  where allocation.payment_batch_id = p_batch_id order by document.id for update of document;
  return app_private.reverse_supplier_payment_batch_engine_g7(p_batch_id, p_actor_id);
end;
$$;
revoke all on function app_private.reverse_supplier_payment_batch(uuid,uuid) from public, anon, authenticated;
grant execute on function app_private.reverse_supplier_payment_batch(uuid,uuid) to authenticated, service_role;

create or replace function public.reverse_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid default null)
returns public.supplier_payment_batches
language sql security invoker set search_path = ''
as $$ select app_private.reverse_supplier_payment_batch(p_batch_id,p_actor_id); $$;
revoke all on function public.reverse_supplier_payment_batch(uuid,uuid) from public, anon;
grant execute on function public.reverse_supplier_payment_batch(uuid,uuid) to authenticated, service_role;

create or replace function app_private.command_supplier_payment_v2(
  p_command_type text,
  p_batch_id uuid,
  p_expected_row_version bigint,
  p_idempotency_key text,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_batch public.supplier_payment_batches%rowtype;
  v_command app_private.supplier_finance_commands%rowtype;
  v_hash text := md5(jsonb_build_object('type',p_command_type,'batchId',p_batch_id,'version',p_expected_row_version,'reason',coalesce(btrim(p_reason),''))::text);
  v_result jsonb;
begin
  if v_actor is null then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_command_type not in ('payment_post','payment_reverse') or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'SUPPLIER_PAYMENT_COMMAND_INVALID' using errcode = '22023';
  end if;
  select * into v_command from app_private.supplier_finance_commands command
  where command.actor_user_id = v_actor and command.command_type = p_command_type
    and command.idempotency_key = p_idempotency_key for update;
  if found then
    if v_command.payload_hash <> v_hash then raise exception 'SUPPLIER_PAYMENT_REPLAY_CONFLICT' using errcode = '22023'; end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;
  select * into v_batch from public.supplier_payment_batches where id = p_batch_id for update;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_batch.row_version <> p_expected_row_version then raise exception 'SUPPLIER_PAYMENT_STALE_VERSION' using errcode = '40001'; end if;
  if p_command_type = 'payment_post' then
    v_batch := app_private.post_supplier_payment_batch(p_batch_id, v_actor);
  else
    if nullif(btrim(p_reason),'') is null then raise exception 'SUPPLIER_PAYMENT_REVERSAL_REASON_REQUIRED' using errcode = '22023'; end if;
    v_batch := app_private.reverse_supplier_payment_batch(p_batch_id, v_actor);
    update public.supplier_payment_batches set metadata = coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object('g7ReversalReason',btrim(p_reason)) where id = p_batch_id returning * into v_batch;
  end if;
  v_result := jsonb_build_object('paymentBatch',to_jsonb(v_batch),'replayed',false);
  insert into app_private.supplier_finance_commands(actor_user_id,command_type,idempotency_key,payload_hash,aggregate_id,result)
  values(v_actor,p_command_type,p_idempotency_key,v_hash,p_batch_id,v_result);
  return v_result;
end;
$$;
revoke all on function app_private.command_supplier_payment_v2(text,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function app_private.command_supplier_payment_v2(text,uuid,bigint,text,text) to authenticated, service_role;

create or replace function public.post_supplier_payment_batch_v2(p_batch_id uuid,p_expected_row_version bigint,p_idempotency_key text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app_private.command_supplier_payment_v2('payment_post',p_batch_id,p_expected_row_version,p_idempotency_key,null); $$;
create or replace function public.reverse_supplier_payment_batch_v2(p_batch_id uuid,p_expected_row_version bigint,p_idempotency_key text,p_reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select app_private.command_supplier_payment_v2('payment_reverse',p_batch_id,p_expected_row_version,p_idempotency_key,p_reason); $$;
revoke all on function public.post_supplier_payment_batch_v2(uuid,bigint,text) from public, anon;
revoke all on function public.reverse_supplier_payment_batch_v2(uuid,bigint,text,text) from public, anon;
grant execute on function public.post_supplier_payment_batch_v2(uuid,bigint,text) to authenticated, service_role;
grant execute on function public.reverse_supplier_payment_batch_v2(uuid,bigint,text,text) to authenticated, service_role;

create or replace function app_private.assert_supplier_payable_settlement_v1(p_payable_document_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.supplier_payable_documents%rowtype;
  v_cash numeric(18,2);
  v_non_cash numeric(18,2);
begin
  select * into v_document from public.supplier_payable_documents where id=p_payable_document_id;
  if not found then return; end if;
  select coalesce(sum(allocation.allocated_amount),0),
         coalesce(sum(allocation.discount_amount+allocation.withholding_amount),0)
  into v_cash,v_non_cash
  from public.supplier_payment_allocations allocation
  join public.supplier_payment_batches batch on batch.id=allocation.payment_batch_id and batch.status='paid'
  where allocation.payable_document_id=p_payable_document_id;
  if round(v_document.credit_amount+v_cash+v_non_cash,2) > round(v_document.recognized_amount,2) then
    raise exception 'SUPPLIER_PAYABLE_SETTLEMENT_EXCEEDED' using errcode='23514';
  end if;
end;
$$;
revoke all on function app_private.assert_supplier_payable_settlement_v1(uuid) from public,anon,authenticated;

create or replace function app_private.trg_assert_supplier_payable_settlement_v1()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_payable_id uuid;
begin
  if tg_table_name='supplier_payable_documents' then
    perform app_private.assert_supplier_payable_settlement_v1(new.id);
  else
    for v_payable_id in select allocation.payable_document_id
      from public.supplier_payment_allocations allocation where allocation.payment_batch_id=new.id
    loop
      perform app_private.assert_supplier_payable_settlement_v1(v_payable_id);
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function app_private.trg_assert_supplier_payable_settlement_v1() from public,anon,authenticated;

create constraint trigger trg_supplier_payable_settlement_credit_guard
after update of credit_amount on public.supplier_payable_documents
deferrable initially deferred for each row
execute function app_private.trg_assert_supplier_payable_settlement_v1();
create constraint trigger trg_supplier_payable_settlement_payment_guard
after update of status on public.supplier_payment_batches
deferrable initially deferred for each row
execute function app_private.trg_assert_supplier_payable_settlement_v1();

revoke insert, update, delete on public.supplier_payment_batches from authenticated;
revoke insert, update, delete on public.supplier_payment_allocations from authenticated;

create or replace function app_private.get_supplier_finance_control_v1(
  p_project_id text,
  p_construction_site_id text,
  p_as_of timestamptz default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, now());
  v_currency text;
  v_currency_count integer;
  v_receipt numeric(18,2);
  v_inventory numeric(18,2);
  v_consumption numeric(18,2);
  v_ap numeric(18,2);
  v_cash numeric(18,2);
  v_receipt_count integer;
  v_inventory_count integer;
  v_consumption_count integer;
  v_ap_count integer;
  v_cash_count integer;
  v_unknown_inventory integer;
  v_unknown_consumption integer;
  v_pending_variance integer;
  v_issues jsonb := '[]'::jsonb;
  v_authoritative boolean := true;
begin
  if nullif(p_project_id,'') is null and nullif(p_construction_site_id,'') is null then
    raise exception 'FINANCE_SCOPE_REQUIRED' using errcode = '22023';
  end if;
  if not app_private.ap_scope_can_view(nullif(p_project_id,''),nullif(p_construction_site_id,'')) then
    raise exception 'FINANCE_SCOPE_FORBIDDEN' using errcode = '42501';
  end if;
  select count(distinct document.currency), min(document.currency)
  into v_currency_count, v_currency
  from public.supplier_payable_documents document
  where (nullif(p_project_id,'') is null or document.project_id = p_project_id)
    and (nullif(p_construction_site_id,'') is null or document.construction_site_id = p_construction_site_id)
    and document.created_at <= v_as_of and document.status not in ('cancelled','reversed');
  v_currency := coalesce(v_currency,'VND');
  if v_currency_count > 1 then
    v_authoritative := false; v_issues := v_issues || '"MULTI_CURRENCY_REQUIRES_BREAKDOWN"'::jsonb;
  end if;

  select coalesce(sum(document.recognized_amount),0),count(*) into v_receipt,v_receipt_count
  from public.supplier_payable_documents document
  where document.source_type = 'purchase_delivery_receipt'
    and document.status not in ('cancelled','reversed') and document.created_at <= v_as_of
    and (nullif(p_project_id,'') is null or document.project_id = p_project_id)
    and (nullif(p_construction_site_id,'') is null or document.construction_site_id = p_construction_site_id);

  select coalesce(sum(entry.amount),0),count(*),count(*) filter(where
    (entry.unit_price = 0 and coalesce(entry.metadata ->> 'knownZeroPrice', 'false') <> 'true')
    or (entry.metadata ->> 'priceSource' is null and entry.metadata ->> 'accountingPrice' is null and entry.metadata ->> 'price' is null)
  ) into v_inventory,v_inventory_count,v_unknown_inventory
  from public.inventory_ledger_entries entry
  where entry.transaction_date <= v_as_of
    and (nullif(p_project_id,'') is null or entry.project_id = p_project_id)
    and (nullif(p_construction_site_id,'') is null or entry.construction_site_id = p_construction_site_id);

  select coalesce(sum(case when entry.business_event_type = 'construction_issue' then abs(entry.amount)
    when entry.business_event_type = 'project_return_receipt' then -abs(entry.amount) else 0 end),0),
    count(*) filter(where entry.business_event_type in ('construction_issue','project_return_receipt')),
    count(*) filter(where entry.business_event_type in ('construction_issue','project_return_receipt') and (
      (entry.unit_price = 0 and coalesce(entry.metadata ->> 'knownZeroPrice', 'false') <> 'true')
      or (entry.metadata ->> 'priceSource' is null and entry.metadata ->> 'accountingPrice' is null and entry.metadata ->> 'price' is null)
    )) into v_consumption,v_consumption_count,v_unknown_consumption
  from public.inventory_ledger_entries entry
  where entry.transaction_date <= v_as_of
    and (nullif(p_project_id,'') is null or entry.project_id = p_project_id)
    and (nullif(p_construction_site_id,'') is null or entry.construction_site_id = p_construction_site_id);

  select coalesce(sum(balance.outstanding_amount),0),count(*) into v_ap,v_ap_count
  from public.supplier_payable_document_balances balance
  where balance.status not in ('cancelled','reversed') and balance.created_at <= v_as_of
    and (nullif(p_project_id,'') is null or balance.project_id = p_project_id)
    and (nullif(p_construction_site_id,'') is null or balance.construction_site_id = p_construction_site_id);

  select coalesce(sum(batch.payment_amount),0),count(*) into v_cash,v_cash_count
  from public.supplier_payment_batches batch
  where batch.status = 'paid' and coalesce(batch.paid_at,batch.updated_at) <= v_as_of
    and (nullif(p_project_id,'') is null or batch.project_id = p_project_id)
    and (nullif(p_construction_site_id,'') is null or batch.construction_site_id = p_construction_site_id);

  select count(*) into v_pending_variance
  from public.supplier_invoice_payable_links link join public.supplier_invoices invoice on invoice.id=link.invoice_id
  where invoice.status='posted' and link.variance_amount<>0
    and (nullif(p_project_id,'') is null or link.project_id=p_project_id)
    and (nullif(p_construction_site_id,'') is null or link.construction_site_id=p_construction_site_id);
  if v_unknown_inventory>0 then v_authoritative:=false; v_issues:=v_issues||'"INVENTORY_VALUATION_SOURCE_MISSING"'::jsonb; end if;
  if v_unknown_consumption>0 then v_authoritative:=false; v_issues:=v_issues||'"CONSUMPTION_VALUATION_SOURCE_MISSING"'::jsonb; end if;
  if v_pending_variance>0 then v_authoritative:=false; v_issues:=v_issues||'"INVOICE_VARIANCE_PENDING_POLICY"'::jsonb; end if;
  if v_currency_count>1 then v_receipt:=null;v_inventory:=null;v_consumption:=null;v_ap:=null;v_cash:=null; end if;
  if v_unknown_inventory>0 then v_inventory:=null; end if;
  if v_unknown_consumption>0 then v_consumption:=null; end if;

  return jsonb_build_object(
    'asOf',v_as_of,'projectId',nullif(p_project_id,''),'constructionSiteId',nullif(p_construction_site_id,''),
    'authoritative',v_authoritative,'issues',v_issues,'layers',jsonb_build_array(
      jsonb_build_object('layer','purchase_receipt','amount',v_receipt,'currency',v_currency,'completeness',case when v_currency_count>1 then 'unknown' else 'complete' end,'source','supplier_payable_documents:purchase_delivery_receipt','documentCount',v_receipt_count,'issues','[]'::jsonb),
      jsonb_build_object('layer','inventory','amount',v_inventory,'currency',v_currency,'completeness',case when v_currency_count>1 or v_unknown_inventory>0 then 'unknown' else 'complete' end,'source','inventory_ledger_entries:recorded_price','documentCount',v_inventory_count,'issues',case when v_unknown_inventory>0 then '["VALUATION_SOURCE_MISSING"]'::jsonb else '[]'::jsonb end),
      jsonb_build_object('layer','consumption','amount',v_consumption,'currency',v_currency,'completeness',case when v_currency_count>1 or v_unknown_consumption>0 then 'unknown' else 'complete' end,'source','inventory_ledger_entries:construction_issue','documentCount',v_consumption_count,'issues',case when v_unknown_consumption>0 then '["VALUATION_SOURCE_MISSING"]'::jsonb else '[]'::jsonb end),
      jsonb_build_object('layer','ap','amount',v_ap,'currency',v_currency,'completeness',case when v_currency_count>1 then 'unknown' else 'complete' end,'source','supplier_payable_document_balances','documentCount',v_ap_count,'issues','[]'::jsonb),
      jsonb_build_object('layer','cash','amount',v_cash,'currency',v_currency,'completeness',case when v_currency_count>1 then 'unknown' else 'complete' end,'source','supplier_payment_batches:paid','documentCount',v_cash_count,'issues','[]'::jsonb)
    )
  );
end;
$$;
revoke all on function app_private.get_supplier_finance_control_v1(text,text,timestamptz) from public, anon, authenticated;
grant execute on function app_private.get_supplier_finance_control_v1(text,text,timestamptz) to authenticated, service_role;

create or replace function public.get_supplier_finance_control_v1(p_project_id text,p_construction_site_id text,p_as_of timestamptz default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select app_private.get_supplier_finance_control_v1(p_project_id,p_construction_site_id,p_as_of); $$;
revoke all on function public.get_supplier_finance_control_v1(text,text,timestamptz) from public, anon;
grant execute on function public.get_supplier_finance_control_v1(text,text,timestamptz) to authenticated, service_role;

create or replace function app_private.get_supplier_invoice_matching_candidates_v1(
  p_project_id text,p_construction_site_id text,p_supplier_id text
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app_private.ap_scope_can_view(nullif(p_project_id,''),nullif(p_construction_site_id,'')) then
    raise exception 'FINANCE_SCOPE_FORBIDDEN' using errcode='42501';
  end if;
  return jsonb_build_object(
    'documents',coalesce((select jsonb_agg(to_jsonb(row_data) order by row_data.document_date,row_data.id) from (
      select balance.*, invoice_balance.invoiced_to_date, invoice_balance.uninvoiced_amount
      from public.supplier_payable_document_balances balance
      join public.supplier_invoice_payable_balances invoice_balance on invoice_balance.payable_document_id=balance.id
      where balance.supplier_id=p_supplier_id and balance.status not in ('cancelled','reversed')
        and (nullif(p_project_id,'') is null or balance.project_id=p_project_id)
        and (nullif(p_construction_site_id,'') is null or balance.construction_site_id=p_construction_site_id)
    ) row_data),'[]'::jsonb),
    'receiptLines',coalesce((select jsonb_agg(jsonb_build_object(
      'deliveryLineId',line.id,'deliveryBatchId',line.delivery_batch_id,'purchaseOrderId',line.purchase_order_id,
      'purchaseOrderLineId',line.purchase_order_line_id,'itemId',line.item_id,'acceptedQty',line.accepted_qty,
      'unit',line.unit,'receiptUnitPrice',line.delivery_unit_price,'invoicedToDate',balance.invoiced_to_date,
      'uninvoicedQty',balance.uninvoiced_qty,'vatRate',batch.vat_rate
    ) order by batch.received_at nulls last,line.id)
    from public.purchase_order_delivery_lines line
    join public.purchase_order_delivery_batches batch on batch.id=line.delivery_batch_id
    join public.purchase_orders po on po.id=line.purchase_order_id
    join public.supplier_invoice_receipt_balances balance on balance.delivery_line_id=line.id
    where po.vendor_id=p_supplier_id and batch.status in ('received','received_short','received_over')
      and (nullif(p_project_id,'') is null or po.project_id=p_project_id)
      and (nullif(p_construction_site_id,'') is null or po.construction_site_id=p_construction_site_id)
      and balance.uninvoiced_qty>0),'[]'::jsonb)
  );
end;
$$;
revoke all on function app_private.get_supplier_invoice_matching_candidates_v1(text,text,text) from public, anon, authenticated;
grant execute on function app_private.get_supplier_invoice_matching_candidates_v1(text,text,text) to authenticated, service_role;
create or replace function public.get_supplier_invoice_matching_candidates_v1(p_project_id text,p_construction_site_id text,p_supplier_id text)
returns jsonb language sql stable security invoker set search_path=''
as $$ select app_private.get_supplier_invoice_matching_candidates_v1(p_project_id,p_construction_site_id,p_supplier_id); $$;
revoke all on function public.get_supplier_invoice_matching_candidates_v1(text,text,text) from public, anon;
grant execute on function public.get_supplier_invoice_matching_candidates_v1(text,text,text) to authenticated, service_role;
