-- Security hardening and transactional business RPCs for WMS, TS, WF, and RQ.

create or replace function public.is_module_admin(p_module text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users
    where auth_id = (select auth.uid())
      and (
        role = 'ADMIN'
        or p_module = any(coalesce(admin_modules, '{}'::text[]))
        or coalesce(admin_sub_modules, '{}'::jsonb) ? p_module
      )
  );
$$;

revoke all on function public.is_module_admin(text) from public;
grant execute on function public.is_module_admin(text) to authenticated;

alter table public.asset_location_stocks
  add column if not exists construction_site_id text,
  add column if not exists dept_id text;

alter table public.asset_transfers
  add column if not exists from_site_id text,
  add column if not exists from_dept_id text,
  add column if not exists to_site_id text,
  add column if not exists to_dept_id text;

alter table public.asset_location_stocks enable row level security;
alter table public.asset_transfers enable row level security;

drop policy if exists asset_location_stocks_select on public.asset_location_stocks;
drop policy if exists asset_location_stocks_insert on public.asset_location_stocks;
drop policy if exists asset_location_stocks_update on public.asset_location_stocks;
drop policy if exists asset_location_stocks_delete on public.asset_location_stocks;

create policy asset_location_stocks_select
on public.asset_location_stocks for select
to authenticated
using (true);

create policy asset_location_stocks_insert
on public.asset_location_stocks for insert
to authenticated
with check (public.is_module_admin('TS'));

create policy asset_location_stocks_update
on public.asset_location_stocks for update
to authenticated
using (public.is_module_admin('TS'))
with check (public.is_module_admin('TS'));

create policy asset_location_stocks_delete
on public.asset_location_stocks for delete
to authenticated
using (public.is_module_admin('TS'));

drop policy if exists asset_transfers_select on public.asset_transfers;
drop policy if exists asset_transfers_insert on public.asset_transfers;
drop policy if exists asset_transfers_update on public.asset_transfers;
drop policy if exists asset_transfers_delete on public.asset_transfers;

create policy asset_transfers_select
on public.asset_transfers for select
to authenticated
using (true);

create policy asset_transfers_insert
on public.asset_transfers for insert
to authenticated
with check (public.is_module_admin('TS'));

create policy asset_transfers_update
on public.asset_transfers for update
to authenticated
using (public.is_module_admin('TS'))
with check (public.is_module_admin('TS'));

create policy asset_transfers_delete
on public.asset_transfers for delete
to authenticated
using (public.is_module_admin('TS'));

do $$
declare
  contract_table text;
begin
  foreach contract_table in array array['supplier_contracts', 'customer_contracts', 'subcontractor_contracts']
  loop
    if to_regclass('public.' || contract_table) is not null then
      execute format('alter table public.%I enable row level security', contract_table);
      execute format('drop policy if exists %I on public.%I', contract_table || '_select', contract_table);
      execute format('drop policy if exists %I on public.%I', contract_table || '_insert', contract_table);
      execute format('drop policy if exists %I on public.%I', contract_table || '_update', contract_table);
      execute format('drop policy if exists %I on public.%I', contract_table || '_delete', contract_table);

      execute format('create policy %I on public.%I for select to authenticated using (true)', contract_table || '_select', contract_table);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.is_module_admin(%L))', contract_table || '_insert', contract_table, 'HD');
      execute format('create policy %I on public.%I for update to authenticated using (public.is_module_admin(%L)) with check (public.is_module_admin(%L))', contract_table || '_update', contract_table, 'HD', 'HD');
      execute format('create policy %I on public.%I for delete to authenticated using (public.is_module_admin(%L))', contract_table || '_delete', contract_table, 'HD');
    end if;
  end loop;
end $$;

create table if not exists public.app_code_counters (
  scope text not null,
  year integer not null default 0,
  value integer not null default 0,
  updated_at timestamp with time zone not null default now(),
  primary key (scope, year)
);

alter table public.app_code_counters enable row level security;
revoke all on public.app_code_counters from public;
revoke all on public.app_code_counters from anon, authenticated;

create or replace function public.next_workflow_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_existing integer;
  v_next integer;
begin
  select coalesce(max(substring(code from ('^WF-' || v_year || '-([0-9]+)$'))::integer), 0)
    into v_existing
  from public.workflow_instances
  where code ~ ('^WF-' || v_year || '-[0-9]+$');

  insert into public.app_code_counters(scope, year, value)
  values ('WF', v_year, v_existing + 1)
  on conflict (scope, year) do update
    set value = greatest(public.app_code_counters.value + 1, excluded.value),
        updated_at = now()
  returning value into v_next;

  return 'WF-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;

create or replace function public.next_request_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_existing integer;
  v_next integer;
begin
  select coalesce(max(substring(code from ('^REQ-' || v_year || '-([0-9]+)$'))::integer), 0)
    into v_existing
  from public.request_instances
  where code ~ ('^REQ-' || v_year || '-[0-9]+$');

  insert into public.app_code_counters(scope, year, value)
  values ('REQ', v_year, v_existing + 1)
  on conflict (scope, year) do update
    set value = greatest(public.app_code_counters.value + 1, excluded.value),
        updated_at = now()
  returning value into v_next;

  return 'REQ-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;

create or replace function public.next_asset_transfer_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_existing integer;
  v_next integer;
begin
  select coalesce(max(substring(code from ('^DC-' || v_year || '-([0-9]+)$'))::integer), 0)
    into v_existing
  from public.asset_transfers
  where code ~ ('^DC-' || v_year || '-[0-9]+$');

  insert into public.app_code_counters(scope, year, value)
  values ('DC', v_year, v_existing + 1)
  on conflict (scope, year) do update
    set value = greatest(public.app_code_counters.value + 1, excluded.value),
        updated_at = now()
  returning value into v_next;

  return 'DC-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;

create or replace function public.next_asset_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_code text;
begin
  perform pg_advisory_xact_lock(hashtext('public.next_asset_code'));

  select coalesce(max(substring(code from '^TS-([0-9]+)$')::integer), 0) + 1
    into v_next
  from public.assets
  where code ~ '^TS-[0-9]+$';

  loop
    v_code := 'TS-' || lpad(v_next::text, 3, '0');
    exit when not exists (select 1 from public.assets where code = v_code);
    v_next := v_next + 1;
  end loop;

  return v_code;
end;
$$;

create or replace function public.create_asset_with_initial_stock(p_asset jsonb)
returns public.assets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_stock_id text;
  v_qty integer;
  v_warehouse_id text := nullif(p_asset->>'warehouse_id', '');
begin
  if not public.is_module_admin('TS') then
    raise exception 'insufficient privilege to create asset';
  end if;

  v_qty := greatest(
    1,
    coalesce(nullif(p_asset->>'quantity', '')::integer, 1)
  );
  if coalesce(nullif(p_asset->>'asset_type', ''), 'single') <> 'batch' then
    v_qty := 1;
  end if;

  insert into public.assets (
    id, code, name, category_id, brand, model, serial_number, status,
    asset_type, quantity, unit, parent_id, child_index, is_bundle,
    managed_by_user_id, managing_dept_id, construction_site_id,
    supplier_id, contract_number, invoice_number, asset_origin,
    is_fixed_asset, is_leased, leased_from, lease_end_date,
    warranty_condition, warranty_provider, warranty_contact,
    original_value, purchase_date, depreciation_years, warranty_months,
    residual_value, warehouse_id, location_note, assigned_to_user_id,
    assigned_to_name, assigned_date, disposal_date, disposal_value,
    disposal_note, image_url, note, created_at, updated_at
  )
  values (
    p_asset->>'id',
    p_asset->>'code',
    p_asset->>'name',
    nullif(p_asset->>'category_id', ''),
    nullif(p_asset->>'brand', ''),
    nullif(p_asset->>'model', ''),
    nullif(p_asset->>'serial_number', ''),
    coalesce(nullif(p_asset->>'status', ''), 'AVAILABLE')::public.asset_status,
    coalesce(nullif(p_asset->>'asset_type', ''), 'single'),
    v_qty,
    nullif(p_asset->>'unit', ''),
    nullif(p_asset->>'parent_id', ''),
    nullif(p_asset->>'child_index', '')::integer,
    coalesce(nullif(p_asset->>'is_bundle', '')::boolean, false),
    nullif(p_asset->>'managed_by_user_id', ''),
    nullif(p_asset->>'managing_dept_id', ''),
    nullif(p_asset->>'construction_site_id', ''),
    nullif(p_asset->>'supplier_id', ''),
    nullif(p_asset->>'contract_number', ''),
    nullif(p_asset->>'invoice_number', ''),
    coalesce(nullif(p_asset->>'asset_origin', ''), 'purchase'),
    coalesce(nullif(p_asset->>'is_fixed_asset', '')::boolean, true),
    coalesce(nullif(p_asset->>'is_leased', '')::boolean, false),
    nullif(p_asset->>'leased_from', ''),
    nullif(p_asset->>'lease_end_date', ''),
    nullif(p_asset->>'warranty_condition', ''),
    nullif(p_asset->>'warranty_provider', ''),
    nullif(p_asset->>'warranty_contact', ''),
    coalesce(nullif(p_asset->>'original_value', '')::numeric, 0),
    coalesce(nullif(p_asset->>'purchase_date', ''), now()::date::text),
    coalesce(nullif(p_asset->>'depreciation_years', '')::integer, 5),
    coalesce(nullif(p_asset->>'warranty_months', '')::integer, 0),
    coalesce(nullif(p_asset->>'residual_value', '')::numeric, 0),
    v_warehouse_id,
    nullif(p_asset->>'location_note', ''),
    nullif(p_asset->>'assigned_to_user_id', ''),
    nullif(p_asset->>'assigned_to_name', ''),
    nullif(p_asset->>'assigned_date', ''),
    nullif(p_asset->>'disposal_date', ''),
    nullif(p_asset->>'disposal_value', '')::numeric,
    nullif(p_asset->>'disposal_note', ''),
    nullif(p_asset->>'image_url', ''),
    nullif(p_asset->>'note', ''),
    coalesce(nullif(p_asset->>'created_at', '')::timestamp with time zone, now()),
    coalesce(nullif(p_asset->>'updated_at', '')::timestamp with time zone, now())
  )
  returning * into v_asset;

  if v_warehouse_id is not null then
    select id into v_stock_id
    from public.asset_location_stocks
    where asset_id = v_asset.id
      and warehouse_id is not distinct from v_warehouse_id
      and assigned_to_user_id is null
    limit 1
    for update;

    if v_stock_id is null then
      insert into public.asset_location_stocks (
        asset_id, warehouse_id, qty, note, updated_at
      )
      values (
        v_asset.id, v_warehouse_id, v_qty,
        nullif(p_asset->>'location_note', ''), now()
      );
    else
      update public.asset_location_stocks
      set qty = qty + v_qty,
          note = coalesce(nullif(p_asset->>'location_note', ''), note),
          updated_at = now()
      where id = v_stock_id;
    end if;
  end if;

  return v_asset;
end;
$$;

create or replace function public.transfer_asset_stock(
  p_asset_id text,
  p_from_stock_id text,
  p_qty integer,
  p_to_warehouse_id text default null,
  p_to_user_id text default null,
  p_reason text default null,
  p_date text default null
)
returns public.asset_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.asset_location_stocks%rowtype;
  v_target_id text;
  v_asset public.assets%rowtype;
  v_transfer public.asset_transfers%rowtype;
  v_user public.users%rowtype;
  v_to_user_name text;
  v_from_label text;
  v_to_label text;
begin
  if not public.is_module_admin('TS') then
    raise exception 'insufficient privilege to transfer asset stock';
  end if;
  if p_qty <= 0 then
    raise exception 'transfer quantity must be positive';
  end if;
  if nullif(p_to_warehouse_id, '') is null and nullif(p_to_user_id, '') is null then
    raise exception 'destination is required';
  end if;

  select * into v_from
  from public.asset_location_stocks
  where id = p_from_stock_id and asset_id = p_asset_id
  for update;
  if not found then
    raise exception 'source stock not found';
  end if;
  if v_from.qty < p_qty then
    raise exception 'insufficient asset stock: available %, requested %', v_from.qty, p_qty;
  end if;

  select * into v_asset from public.assets where id = p_asset_id;
  if not found then
    raise exception 'asset not found';
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  select name into v_to_user_name from public.users where id::text = nullif(p_to_user_id, '');

  update public.asset_location_stocks
  set qty = qty - p_qty,
      updated_at = now()
  where id = p_from_stock_id;

  select id into v_target_id
  from public.asset_location_stocks
  where asset_id = p_asset_id
    and warehouse_id is not distinct from nullif(p_to_warehouse_id, '')
    and assigned_to_user_id is not distinct from nullif(p_to_user_id, '')
  limit 1
  for update;

  if v_target_id is null then
    insert into public.asset_location_stocks (
      asset_id, warehouse_id, qty, assigned_to_user_id, assigned_to_name, updated_at
    )
    values (
      p_asset_id, nullif(p_to_warehouse_id, ''), p_qty,
      nullif(p_to_user_id, ''), v_to_user_name, now()
    );
  else
    update public.asset_location_stocks
    set qty = qty + p_qty,
        assigned_to_name = coalesce(v_to_user_name, assigned_to_name),
        updated_at = now()
    where id = v_target_id;
  end if;

  select coalesce(v_from.assigned_to_name, w.name, 'Không xác định')
    into v_from_label
  from (select 1) s
  left join public.warehouses w on w.id = v_from.warehouse_id;

  select coalesce(v_to_user_name, w.name, 'Không xác định')
    into v_to_label
  from (select 1) s
  left join public.warehouses w on w.id = nullif(p_to_warehouse_id, '');

  insert into public.asset_transfers (
    code, asset_id, asset_code, asset_name, qty,
    from_warehouse_id, from_location_label,
    to_warehouse_id, to_location_label,
    received_by_user_id, received_by_name,
    date, reason, status, performed_by, performed_by_name, created_at
  )
  values (
    public.next_asset_transfer_code(), p_asset_id, v_asset.code, v_asset.name, p_qty,
    v_from.warehouse_id, v_from_label,
    nullif(p_to_warehouse_id, ''), v_to_label,
    nullif(p_to_user_id, ''), v_to_user_name,
    coalesce(nullif(p_date, ''), now()::date::text), p_reason, 'completed',
    public.current_app_user_id()::text, coalesce(v_user.name, v_user.username), now()
  )
  returning * into v_transfer;

  return v_transfer;
end;
$$;

drop function if exists public.apply_stock_change(uuid, text, integer);

create or replace function public.apply_stock_change(
  p_item_id text,
  p_warehouse_id text,
  p_delta integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock jsonb;
  v_current integer;
  v_next integer;
begin
  if public.current_app_user_id() is null then
    raise exception 'authentication required';
  end if;
  if nullif(p_warehouse_id, '') is null then
    raise exception 'warehouse id is required';
  end if;

  select coalesce(stock_by_warehouse, '{}'::jsonb)
    into v_stock
  from public.items
  where id = p_item_id
  for update;
  if not found then
    raise exception 'item not found: %', p_item_id;
  end if;

  v_current := coalesce((v_stock ->> p_warehouse_id)::integer, 0);
  v_next := v_current + p_delta;
  if v_next < 0 then
    raise exception 'insufficient stock for item %, warehouse %: available %, delta %',
      p_item_id, p_warehouse_id, v_current, p_delta;
  end if;

  v_stock := jsonb_set(v_stock, array[p_warehouse_id], to_jsonb(v_next), true);

  update public.items
  set stock_by_warehouse = v_stock
  where id = p_item_id;

  return v_stock;
end;
$$;

create or replace function public.process_transaction_status(
  p_transaction_id text,
  p_status public.transaction_status,
  p_approver_id uuid
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_item_id text;
  v_qty integer;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'CANCELLED'::public.transaction_status)
     and not public.is_module_admin('WMS')
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to change transaction status';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status
     and not public.is_module_admin('WMS')
     and v_user.assigned_warehouse_id is distinct from v_tx.target_warehouse_id
     and v_user.assigned_warehouse_id is distinct from v_tx.source_warehouse_id then
    raise exception 'insufficient privilege to complete transaction';
  end if;

  if v_tx.status = p_status then
    return v_tx;
  end if;
  if v_tx.status = 'CANCELLED'::public.transaction_status then
    raise exception 'cancelled transaction cannot be changed';
  end if;
  if v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'completed transaction cannot be changed';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_pending in
      select value from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb))
    loop
      insert into public.items (
        id, sku, name, category, unit, purchase_unit,
        price_in, price_out, min_stock, supplier_id, image_url,
        stock_by_warehouse, location
      )
      values (
        v_pending->>'id',
        v_pending->>'sku',
        v_pending->>'name',
        coalesce(nullif(v_pending->>'category', ''), 'Khác'),
        coalesce(nullif(v_pending->>'unit', ''), 'Cái'),
        nullif(v_pending->>'purchaseUnit', ''),
        coalesce(nullif(v_pending->>'priceIn', '')::numeric, 0),
        coalesce(nullif(v_pending->>'priceOut', '')::numeric, 0),
        coalesce(nullif(v_pending->>'minStock', '')::integer, 0),
        nullif(v_pending->>'supplierId', ''),
        nullif(v_pending->>'imageUrl', ''),
        coalesce(v_pending->'stockByWarehouse', '{}'::jsonb),
        nullif(v_pending->>'location', '')
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status then
    for v_line in
      select value from jsonb_array_elements(v_tx.items)
    loop
      v_item_id := v_line->>'itemId';
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0)::integer;
      if v_item_id is null or v_qty <= 0 then
        raise exception 'invalid transaction item payload';
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  end if;

  update public.transactions
  set status = p_status,
      approver_id = p_approver_id
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$$;

create or replace function public.process_request_step(
  p_request_id uuid,
  p_user_id uuid,
  p_action text,
  p_comment text default ''
)
returns public.request_instances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.request_instances%rowtype;
  v_current_user uuid := public.current_app_user_id();
  v_step jsonb;
  v_step_ord bigint;
  v_approvers jsonb;
  v_all_approved boolean;
  v_status text;
  v_step_order integer;
begin
  if v_current_user is null then
    raise exception 'authentication required';
  end if;
  if p_user_id is distinct from v_current_user and not public.is_module_admin('RQ') then
    raise exception 'cannot act as another user';
  end if;

  select * into v_req
  from public.request_instances
  where id = p_request_id
  for update;
  if not found then
    raise exception 'request not found: %', p_request_id;
  end if;
  if v_req.status not in ('PENDING', 'IN_PROGRESS') then
    raise exception 'request is not waiting for approval';
  end if;

  select elem, ord
    into v_step, v_step_ord
  from jsonb_array_elements(coalesce(v_req.approvers, '[]'::jsonb)) with ordinality as e(elem, ord)
  where elem->>'status' = 'waiting'
  order by coalesce((elem->>'order')::integer, ord::integer)
  limit 1;

  if v_step is null then
    raise exception 'no waiting approver';
  end if;
  if v_step->>'userId' <> p_user_id::text and not public.is_module_admin('RQ') then
    raise exception 'user is not the current approver';
  end if;

  v_step_order := coalesce((v_step->>'order')::integer, v_step_ord::integer);

  if upper(p_action) = 'APPROVED' then
    select jsonb_agg(
      case when ord = v_step_ord then
        elem || jsonb_build_object(
          'status', 'approved',
          'comment', coalesce(nullif(p_comment, ''), 'Đã duyệt'),
          'actedAt', now()::text
        )
      else elem end
      order by ord
    )
      into v_approvers
    from jsonb_array_elements(coalesce(v_req.approvers, '[]'::jsonb)) with ordinality as e(elem, ord);

    v_all_approved := not exists (
      select 1 from jsonb_array_elements(v_approvers) e(elem)
      where elem->>'status' = 'waiting'
    );
    v_status := case when v_all_approved then 'APPROVED' else 'PENDING' end;

    update public.request_instances
    set approvers = v_approvers,
        status = v_status,
        updated_at = now()
    where id = p_request_id
    returning * into v_req;

    insert into public.request_logs(request_id, action, acted_by, comment)
    values (
      p_request_id,
      'APPROVED',
      p_user_id,
      coalesce(nullif(p_comment, ''), 'Duyệt bước ' || v_step_order::text)
    );
  elsif upper(p_action) = 'REJECTED' then
    select jsonb_agg(
      case when ord = v_step_ord then
        elem || jsonb_build_object(
          'status', 'rejected',
          'comment', coalesce(nullif(p_comment, ''), 'Từ chối'),
          'actedAt', now()::text
        )
      else elem end
      order by ord
    )
      into v_approvers
    from jsonb_array_elements(coalesce(v_req.approvers, '[]'::jsonb)) with ordinality as e(elem, ord);

    update public.request_instances
    set approvers = v_approvers,
        status = 'REJECTED',
        updated_at = now()
    where id = p_request_id
    returning * into v_req;

    insert into public.request_logs(request_id, action, acted_by, comment)
    values (
      p_request_id,
      'REJECTED',
      p_user_id,
      coalesce(nullif(p_comment, ''), 'Từ chối ở bước ' || v_step_order::text)
    );
  else
    raise exception 'unsupported request action: %', p_action;
  end if;

  return v_req;
end;
$$;

create or replace function public.process_workflow_instance(
  p_instance_id uuid,
  p_action public.workflow_instance_action,
  p_user_id uuid,
  p_comment text default ''
)
returns public.workflow_instances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst public.workflow_instances%rowtype;
  v_current_user uuid := public.current_app_user_id();
  v_next_node_id uuid;
  v_next_node_type public.workflow_node_type;
  v_prev_node_id uuid;
begin
  if v_current_user is null then
    raise exception 'authentication required';
  end if;
  if p_user_id is distinct from v_current_user and not public.is_module_admin('WF') then
    raise exception 'cannot act as another user';
  end if;

  select * into v_inst
  from public.workflow_instances
  where id = p_instance_id
  for update;
  if not found then
    raise exception 'workflow instance not found: %', p_instance_id;
  end if;
  if v_inst.status <> 'RUNNING'::public.workflow_instance_status then
    raise exception 'workflow instance is not running';
  end if;
  if v_inst.current_node_id is null then
    raise exception 'workflow instance has no current node';
  end if;

  insert into public.workflow_instance_logs(instance_id, node_id, action, acted_by, comment)
  values (p_instance_id, v_inst.current_node_id, p_action, p_user_id, coalesce(p_comment, ''));

  if p_action = 'APPROVED'::public.workflow_instance_action then
    select e.target_node_id, n.type
      into v_next_node_id, v_next_node_type
    from public.workflow_edges e
    join public.workflow_nodes n on n.id = e.target_node_id
    where e.source_node_id = v_inst.current_node_id
    limit 1;

    if v_next_node_id is null then
      raise exception 'no next workflow node found';
    end if;

    update public.workflow_instances
    set current_node_id = v_next_node_id,
        status = case
          when v_next_node_type = 'END'::public.workflow_node_type
          then 'COMPLETED'::public.workflow_instance_status
          else status
        end,
        updated_at = now()
    where id = p_instance_id
    returning * into v_inst;
  elsif p_action = 'REJECTED'::public.workflow_instance_action then
    update public.workflow_instances
    set status = 'REJECTED'::public.workflow_instance_status,
        updated_at = now()
    where id = p_instance_id
    returning * into v_inst;
  elsif p_action = 'REVISION_REQUESTED'::public.workflow_instance_action then
    select e.source_node_id
      into v_prev_node_id
    from public.workflow_edges e
    where e.target_node_id = v_inst.current_node_id
    limit 1;

    if v_prev_node_id is not null then
      update public.workflow_instances
      set current_node_id = v_prev_node_id,
          updated_at = now()
      where id = p_instance_id
      returning * into v_inst;
    end if;
  end if;

  return v_inst;
end;
$$;

alter function public.get_next_employee_code() set search_path = public;
alter function public.set_employee_code() set search_path = public;
alter function public.execute_readonly_query(text) set search_path = public;
alter function public.execute_ai_query(text) set search_path = public;

revoke all on function public.apply_stock_change(text, text, integer) from public;
revoke all on function public.process_transaction_status(text, public.transaction_status, uuid) from public;
revoke all on function public.create_asset_with_initial_stock(jsonb) from public;
revoke all on function public.transfer_asset_stock(text, text, integer, text, text, text, text) from public;
revoke all on function public.process_request_step(uuid, uuid, text, text) from public;
revoke all on function public.process_workflow_instance(uuid, public.workflow_instance_action, uuid, text) from public;
revoke all on function public.next_workflow_code() from public;
revoke all on function public.next_request_code() from public;
revoke all on function public.next_asset_transfer_code() from public;
revoke all on function public.next_asset_code() from public;
revoke all on function public.execute_readonly_query(text) from public;
revoke all on function public.execute_ai_query(text) from public;

grant execute on function public.apply_stock_change(text, text, integer) to authenticated;
grant execute on function public.process_transaction_status(text, public.transaction_status, uuid) to authenticated;
grant execute on function public.create_asset_with_initial_stock(jsonb) to authenticated;
grant execute on function public.transfer_asset_stock(text, text, integer, text, text, text, text) to authenticated;
grant execute on function public.process_request_step(uuid, uuid, text, text) to authenticated;
grant execute on function public.process_workflow_instance(uuid, public.workflow_instance_action, uuid, text) to authenticated;
grant execute on function public.next_workflow_code() to authenticated;
grant execute on function public.next_request_code() to authenticated;
grant execute on function public.next_asset_transfer_code() to authenticated;
grant execute on function public.next_asset_code() to authenticated;
grant execute on function public.execute_readonly_query(text) to authenticated;
grant execute on function public.execute_ai_query(text) to authenticated;

notify pgrst, 'reload schema';
