-- Inventory Ledger Engine v1
-- The existing WMS document table is public.transactions.
-- This migration adds an immutable stock ledger and balance cache fed by
-- completed WMS transactions. items.stock_by_warehouse remains a compatibility
-- cache for the current UI.

create extension if not exists pgcrypto;
create schema if not exists app_private;

create sequence if not exists public.inventory_receipt_code_seq;
create sequence if not exists public.inventory_issue_code_seq;

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  transaction_type text not null check (
    transaction_type in (
      'purchase_receipt',
      'transfer_receipt',
      'project_return_receipt',
      'project_issue',
      'transfer_issue',
      'loss_issue',
      'adjustment_in',
      'adjustment_out',
      'reversal'
    )
  ),
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  transaction_date timestamptz not null default now(),
  source_type text not null,
  source_id text not null,
  source_code text not null,
  related_request_id text null references public.requests(id) on delete set null,
  project_id text null,
  construction_site_id text null,
  description text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.users(id) on delete set null,
  approved_by uuid null references public.users(id) on delete set null,
  posted_at timestamptz not null default now(),
  reversed_at timestamptz null,
  reversal_of_inventory_transaction_id uuid null references public.inventory_transactions(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_inventory_transactions_source_unique
  on public.inventory_transactions(source_type, source_id);
create index if not exists idx_inventory_transactions_date
  on public.inventory_transactions(transaction_date desc);
create index if not exists idx_inventory_transactions_source
  on public.inventory_transactions(source_type, source_id);
create index if not exists idx_inventory_transactions_request
  on public.inventory_transactions(related_request_id);
create index if not exists idx_inventory_transactions_project
  on public.inventory_transactions(project_id, construction_site_id);

create table if not exists public.inventory_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  inventory_transaction_id uuid not null references public.inventory_transactions(id) on delete restrict,
  entry_no integer not null,
  document_code text not null,
  transaction_date timestamptz not null,
  transaction_type text not null,
  movement_direction text not null check (movement_direction in ('in', 'out')),
  material_id text not null references public.items(id) on delete restrict,
  warehouse_id text not null references public.warehouses(id) on delete restrict,
  project_id text null,
  construction_site_id text null,
  lot_no text null,
  batch_no text null,
  serial_no text null,
  source_type text not null,
  source_id text not null,
  source_code text not null,
  source_line_id text null,
  related_request_id text null references public.requests(id) on delete set null,
  quantity_in numeric(18, 4) not null default 0 check (quantity_in >= 0),
  quantity_out numeric(18, 4) not null default 0 check (quantity_out >= 0),
  quantity_delta numeric(18, 4) generated always as (quantity_in - quantity_out) stored,
  unit text null,
  unit_price numeric(18, 4) not null default 0,
  amount numeric(18, 4) generated always as ((quantity_in - quantity_out) * unit_price) stored,
  balance_after_qty numeric(18, 4) not null default 0,
  balance_after_value numeric(18, 4) not null default 0,
  description text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.users(id) on delete set null,
  approved_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_ledger_entries_direction_qty_check check (
    (movement_direction = 'in' and quantity_in > 0 and quantity_out = 0)
    or (movement_direction = 'out' and quantity_out > 0 and quantity_in = 0)
  ),
  constraint inventory_ledger_entries_unique_line unique (inventory_transaction_id, entry_no)
);

create index if not exists idx_inventory_ledger_material_date
  on public.inventory_ledger_entries(material_id, transaction_date desc, id desc);
create index if not exists idx_inventory_ledger_warehouse_date
  on public.inventory_ledger_entries(warehouse_id, transaction_date desc, id desc);
create index if not exists idx_inventory_ledger_material_warehouse_date
  on public.inventory_ledger_entries(material_id, warehouse_id, transaction_date desc, id desc);
create index if not exists idx_inventory_ledger_project_date
  on public.inventory_ledger_entries(project_id, construction_site_id, transaction_date desc);
create index if not exists idx_inventory_ledger_source
  on public.inventory_ledger_entries(source_type, source_id);
create index if not exists idx_inventory_ledger_related_request
  on public.inventory_ledger_entries(related_request_id);

create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  material_id text not null references public.items(id) on delete restrict,
  warehouse_id text not null references public.warehouses(id) on delete restrict,
  project_id text null,
  construction_site_id text null,
  lot_no text null,
  batch_no text null,
  serial_no text null,
  scope_key text generated always as (
    coalesce(project_id, '') || '|' ||
    coalesce(construction_site_id, '') || '|' ||
    coalesce(lot_no, '') || '|' ||
    coalesce(batch_no, '') || '|' ||
    coalesce(serial_no, '')
  ) stored,
  on_hand_qty numeric(18, 4) not null default 0,
  total_value numeric(18, 4) not null default 0,
  average_unit_cost numeric(18, 4) not null default 0,
  last_ledger_entry_id uuid null,
  last_transaction_date timestamptz null,
  updated_at timestamptz not null default now(),
  constraint inventory_balances_unique_scope unique (material_id, warehouse_id, scope_key)
);

create index if not exists idx_inventory_balances_material
  on public.inventory_balances(material_id);
create index if not exists idx_inventory_balances_warehouse
  on public.inventory_balances(warehouse_id);
create index if not exists idx_inventory_balances_project
  on public.inventory_balances(project_id, construction_site_id);

create or replace function app_private.next_inventory_ledger_code(p_direction text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_seq regclass;
begin
  if lower(coalesce(p_direction, '')) = 'in' then
    v_prefix := 'NK';
    v_seq := 'public.inventory_receipt_code_seq'::regclass;
  elsif lower(coalesce(p_direction, '')) = 'out' then
    v_prefix := 'XK';
    v_seq := 'public.inventory_issue_code_seq'::regclass;
  else
    raise exception 'invalid inventory ledger direction: %', p_direction;
  end if;

  return v_prefix || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval(v_seq)::text, 5, '0');
end;
$$;

create or replace function app_private.can_read_inventory_scope(
  p_warehouse_id text,
  p_created_by uuid,
  p_approved_by uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_module_admin('WMS')
    or p_created_by = public.current_app_user_id()
    or p_approved_by = public.current_app_user_id()
    or exists (
      select 1
      from public.users u
      where u.id = public.current_app_user_id()
        and coalesce(u.is_active, true)
        and u.role::text = 'WAREHOUSE_KEEPER'
        and (
          u.assigned_warehouse_id is null
          or u.assigned_warehouse_id is not distinct from p_warehouse_id
        )
    );
$$;

create or replace function app_private.inventory_transaction_type_for_entry(
  p_wms_type text,
  p_direction text,
  p_has_related_request boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_wms_type = 'IMPORT' and p_direction = 'in' then 'purchase_receipt'
    when p_wms_type = 'TRANSFER' and p_direction = 'in' then 'transfer_receipt'
    when p_wms_type = 'TRANSFER' and p_direction = 'out' then 'transfer_issue'
    when p_wms_type = 'EXPORT' and p_direction = 'out' and p_has_related_request then 'project_issue'
    when p_wms_type = 'EXPORT' and p_direction = 'out' then 'project_issue'
    when p_wms_type = 'LIQUIDATION' and p_direction = 'out' then 'loss_issue'
    when p_wms_type = 'ADJUSTMENT' and p_direction = 'in' then 'adjustment_in'
    when p_wms_type = 'ADJUSTMENT' and p_direction = 'out' then 'adjustment_out'
    else
      case when p_direction = 'in' then 'adjustment_in' else 'adjustment_out' end
  end;
$$;

create or replace function app_private.post_inventory_ledger_entry(
  p_inventory_transaction_id uuid,
  p_entry_no integer,
  p_document_code text,
  p_transaction_date timestamptz,
  p_transaction_type text,
  p_direction text,
  p_material_id text,
  p_warehouse_id text,
  p_project_id text,
  p_construction_site_id text,
  p_source_type text,
  p_source_id text,
  p_source_code text,
  p_source_line_id text,
  p_related_request_id text,
  p_qty numeric,
  p_unit_price numeric,
  p_description text,
  p_metadata jsonb,
  p_created_by uuid,
  p_approved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid := gen_random_uuid();
  v_item public.items%rowtype;
  v_delta numeric;
  v_value_delta numeric;
  v_balance_after_qty numeric;
  v_balance_after_value numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'ledger quantity must be positive';
  end if;
  if nullif(p_material_id, '') is null then
    raise exception 'material id is required';
  end if;
  if nullif(p_warehouse_id, '') is null then
    raise exception 'warehouse id is required';
  end if;

  select * into v_item
  from public.items
  where id = p_material_id
  for update;
  if not found then
    raise exception 'item not found: %', p_material_id;
  end if;

  v_delta := case when p_direction = 'in' then p_qty else -p_qty end;
  v_value_delta := v_delta * coalesce(p_unit_price, 0);

  insert into public.inventory_balances (
    material_id, warehouse_id, project_id, construction_site_id,
    on_hand_qty, total_value, average_unit_cost,
    last_ledger_entry_id, last_transaction_date, updated_at
  )
  values (
    p_material_id, p_warehouse_id, nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
    v_delta, v_value_delta,
    case when v_delta = 0 then 0 else coalesce(p_unit_price, 0) end,
    v_entry_id, p_transaction_date, now()
  )
  on conflict (material_id, warehouse_id, scope_key)
  do update set
    on_hand_qty = public.inventory_balances.on_hand_qty + excluded.on_hand_qty,
    total_value = public.inventory_balances.total_value + excluded.total_value,
    average_unit_cost = case
      when (public.inventory_balances.on_hand_qty + excluded.on_hand_qty) = 0 then 0
      else (public.inventory_balances.total_value + excluded.total_value)
        / nullif(public.inventory_balances.on_hand_qty + excluded.on_hand_qty, 0)
    end,
    last_ledger_entry_id = excluded.last_ledger_entry_id,
    last_transaction_date = excluded.last_transaction_date,
    updated_at = now()
  returning on_hand_qty, total_value
    into v_balance_after_qty, v_balance_after_value;

  insert into public.inventory_ledger_entries (
    id, inventory_transaction_id, entry_no, document_code,
    transaction_date, transaction_type, movement_direction,
    material_id, warehouse_id, project_id, construction_site_id,
    source_type, source_id, source_code, source_line_id, related_request_id,
    quantity_in, quantity_out, unit, unit_price,
    balance_after_qty, balance_after_value,
    description, metadata, created_by, approved_by
  )
  values (
    v_entry_id, p_inventory_transaction_id, p_entry_no, p_document_code,
    p_transaction_date, p_transaction_type, p_direction,
    p_material_id, p_warehouse_id, nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
    p_source_type, p_source_id, p_source_code, nullif(p_source_line_id, ''), nullif(p_related_request_id, ''),
    case when p_direction = 'in' then p_qty else 0 end,
    case when p_direction = 'out' then p_qty else 0 end,
    v_item.unit, coalesce(p_unit_price, 0),
    v_balance_after_qty, v_balance_after_value,
    p_description, coalesce(p_metadata, '{}'::jsonb), p_created_by, p_approved_by
  );

  return v_entry_id;
end;
$$;

create or replace function app_private.sync_wms_transaction_to_inventory_ledger(p_transaction_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_existing_id uuid;
  v_inventory_transaction_id uuid;
  v_has_in boolean := false;
  v_has_out boolean := false;
  v_in_code text;
  v_out_code text;
  v_header_code text;
  v_header_type text;
  v_line jsonb;
  v_entry_no integer := 0;
  v_tx_date timestamptz;
  v_item_id text;
  v_qty numeric;
  v_price numeric;
  v_project_id text;
  v_construction_site_id text;
  v_source_line_id text;
  v_metadata jsonb;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  if v_tx.status::text <> 'COMPLETED' then
    return null;
  end if;
  v_tx_date := coalesce(nullif(v_tx.date::text, '')::timestamptz, now());

  select id into v_existing_id
  from public.inventory_transactions
  where source_type = 'wms_transaction'
    and source_id = v_tx.id
  limit 1;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  v_has_in := v_tx.type::text in ('IMPORT', 'TRANSFER')
    or exists (
      select 1
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where v_tx.type::text = 'ADJUSTMENT'
        and coalesce(nullif(item.value->>'quantity', '')::numeric, 0) > 0
    );
  v_has_out := v_tx.type::text in ('EXPORT', 'TRANSFER', 'LIQUIDATION')
    or exists (
      select 1
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where v_tx.type::text = 'ADJUSTMENT'
        and coalesce(nullif(item.value->>'quantity', '')::numeric, 0) < 0
    );

  if v_has_in then
    v_in_code := app_private.next_inventory_ledger_code('in');
  end if;
  if v_has_out then
    v_out_code := app_private.next_inventory_ledger_code('out');
  end if;
  v_header_code := coalesce(v_out_code, v_in_code, 'NK' || to_char(now(), 'YYYYMMDD') || '-00000');
  v_header_type := app_private.inventory_transaction_type_for_entry(
    v_tx.type::text,
    case when v_has_out and not v_has_in then 'out' else 'in' end,
    v_tx.related_request_id is not null
  );

  v_metadata := jsonb_build_object(
    'wmsTransactionId', v_tx.id,
    'wmsType', v_tx.type::text,
    'wmsStatus', v_tx.status::text,
    'sourceWarehouseId', v_tx.source_warehouse_id,
    'targetWarehouseId', v_tx.target_warehouse_id,
    'supplierId', v_tx.supplier_id,
    'items', coalesce(v_tx.items, '[]'::jsonb)
  );

  insert into public.inventory_transactions (
    code, transaction_type, status, transaction_date,
    source_type, source_id, source_code,
    related_request_id, project_id, construction_site_id,
    description, metadata, created_by, approved_by, posted_at
  )
  values (
    v_header_code, v_header_type, 'posted', v_tx_date,
    'wms_transaction', v_tx.id, v_tx.id,
    v_tx.related_request_id, null, null,
    v_tx.note, v_metadata, v_tx.requester_id, v_tx.approver_id, now()
  )
  returning id into v_inventory_transaction_id;

  for v_line in
    select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb))
  loop
    v_item_id := v_line->>'itemId';
    v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
    v_price := coalesce(nullif(v_line->>'price', '')::numeric, 0);
    v_project_id := nullif(coalesce(v_line->>'projectId', v_line->>'project_id'), '');
    v_construction_site_id := nullif(coalesce(v_line->>'constructionSiteId', v_line->>'construction_site_id'), '');
    v_source_line_id := nullif(coalesce(v_line->>'requestLineId', v_line->>'materialIssueLineId', v_line->>'lineId'), '');

    if v_item_id is null then
      raise exception 'invalid transaction item payload';
    end if;

    if v_tx.type::text = 'IMPORT' then
      if v_qty <= 0 then raise exception 'invalid import quantity'; end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_in_code,
        v_tx_date, 'purchase_receipt', 'in',
        v_item_id, v_tx.target_warehouse_id, v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'EXPORT' then
      if v_qty <= 0 then raise exception 'invalid export quantity'; end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_out_code,
        v_tx_date, 'project_issue', 'out',
        v_item_id, v_tx.source_warehouse_id, v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'TRANSFER' then
      if v_qty <= 0 then raise exception 'invalid transfer quantity'; end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_out_code,
        v_tx_date, 'transfer_issue', 'out',
        v_item_id, v_tx.source_warehouse_id, v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_in_code,
        v_tx_date, 'transfer_receipt', 'in',
        v_item_id, v_tx.target_warehouse_id, v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'LIQUIDATION' then
      if v_qty <= 0 then raise exception 'invalid liquidation quantity'; end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_out_code,
        v_tx_date, 'loss_issue', 'out',
        v_item_id, v_tx.source_warehouse_id, v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'ADJUSTMENT' then
      if v_qty = 0 then continue; end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no,
        case when v_qty > 0 then v_in_code else v_out_code end,
        v_tx_date,
        case when v_qty > 0 then 'adjustment_in' else 'adjustment_out' end,
        case when v_qty > 0 then 'in' else 'out' end,
        v_item_id, coalesce(v_tx.target_warehouse_id, v_tx.source_warehouse_id), v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        abs(v_qty), v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
    end if;
  end loop;

  return v_inventory_transaction_id;
end;
$$;

create or replace function app_private.trg_sync_wms_transaction_inventory_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status::text = 'COMPLETED'
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform app_private.sync_wms_transaction_to_inventory_ledger(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_wms_transaction_inventory_ledger on public.transactions;
create trigger trg_sync_wms_transaction_inventory_ledger
after insert or update of status on public.transactions
for each row
execute function app_private.trg_sync_wms_transaction_inventory_ledger();

-- Compatibility document views for the requested domain names.
create or replace view public.material_items
with (security_invoker = true)
as select * from public.items;

create or replace view public.stock_receipts
with (security_invoker = true)
as select * from public.transactions where type::text = 'IMPORT';

create or replace view public.stock_issues
with (security_invoker = true)
as select * from public.transactions where type::text in ('EXPORT', 'LIQUIDATION');

create or replace view public.stock_transfers
with (security_invoker = true)
as select * from public.transactions where type::text = 'TRANSFER';

create or replace view public.stock_adjustments
with (security_invoker = true)
as select * from public.transactions where type::text = 'ADJUSTMENT';

alter table public.inventory_transactions enable row level security;
alter table public.inventory_ledger_entries enable row level security;
alter table public.inventory_balances enable row level security;

drop policy if exists inventory_transactions_select on public.inventory_transactions;
create policy inventory_transactions_select
  on public.inventory_transactions
  for select
  to authenticated
  using (
    public.is_module_admin('WMS')
    or created_by = public.current_app_user_id()
    or approved_by = public.current_app_user_id()
    or exists (
      select 1
      from public.inventory_ledger_entries e
      where e.inventory_transaction_id = inventory_transactions.id
        and app_private.can_read_inventory_scope(e.warehouse_id, inventory_transactions.created_by, inventory_transactions.approved_by)
    )
  );

drop policy if exists inventory_ledger_entries_select on public.inventory_ledger_entries;
create policy inventory_ledger_entries_select
  on public.inventory_ledger_entries
  for select
  to authenticated
  using (app_private.can_read_inventory_scope(warehouse_id, created_by, approved_by));

drop policy if exists inventory_balances_select on public.inventory_balances;
create policy inventory_balances_select
  on public.inventory_balances
  for select
  to authenticated
  using (app_private.can_read_inventory_scope(warehouse_id, null, null));

revoke all on table public.inventory_transactions from public, anon;
revoke all on table public.inventory_ledger_entries from public, anon;
revoke all on table public.inventory_balances from public, anon;
grant select on table public.inventory_transactions to authenticated;
grant select on table public.inventory_ledger_entries to authenticated;
grant select on table public.inventory_balances to authenticated;
grant select on table public.material_items to authenticated;
grant select on table public.stock_receipts to authenticated;
grant select on table public.stock_issues to authenticated;
grant select on table public.stock_transfers to authenticated;
grant select on table public.stock_adjustments to authenticated;

grant usage on schema app_private to authenticated;
revoke all on function app_private.next_inventory_ledger_code(text) from public;
revoke all on function app_private.can_read_inventory_scope(text, uuid, uuid) from public;
revoke all on function app_private.inventory_transaction_type_for_entry(text, text, boolean) from public;
revoke all on function app_private.post_inventory_ledger_entry(uuid, integer, text, timestamptz, text, text, text, text, text, text, text, text, text, text, text, numeric, numeric, text, jsonb, uuid, uuid) from public;
revoke all on function app_private.sync_wms_transaction_to_inventory_ledger(text) from public;
revoke all on function app_private.trg_sync_wms_transaction_inventory_ledger() from public;
grant execute on function app_private.can_read_inventory_scope(text, uuid, uuid) to authenticated;

do $$
declare
  v_tx record;
begin
  for v_tx in
    select id
    from public.transactions
    where status::text = 'COMPLETED'
    order by date asc, id asc
  loop
    begin
      perform app_private.sync_wms_transaction_to_inventory_ledger(v_tx.id);
    exception when others then
      raise notice 'inventory ledger backfill skipped transaction %: %', v_tx.id, sqlerrm;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
