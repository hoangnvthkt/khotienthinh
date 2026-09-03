-- Inventory Ledger legacy reference tolerance
-- Some historical WMS transactions reference item ids that no longer exist in
-- public.items. Ledger must still preserve those historical movements by source
-- id/snapshot instead of dropping them during backfill.

alter table if exists public.inventory_ledger_entries
  drop constraint if exists inventory_ledger_entries_material_id_fkey,
  drop constraint if exists inventory_ledger_entries_warehouse_id_fkey;

alter table if exists public.inventory_balances
  drop constraint if exists inventory_balances_material_id_fkey,
  drop constraint if exists inventory_balances_warehouse_id_fkey;

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
  v_delta numeric;
  v_value_delta numeric;
  v_balance_after_qty numeric;
  v_balance_after_value numeric;
  v_unit text;
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

  select i.unit into v_unit
  from public.items i
  where i.id = p_material_id;

  v_unit := coalesce(
    v_unit,
    nullif(p_metadata->>'unit', ''),
    nullif(p_metadata->>'unitSnapshot', ''),
    nullif(p_metadata->>'accountingUnit', '')
  );

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
    v_unit, coalesce(p_unit_price, 0),
    v_balance_after_qty, v_balance_after_value,
    p_description, coalesce(p_metadata, '{}'::jsonb), p_created_by, p_approved_by
  );

  return v_entry_id;
end;
$$;

do $$
declare
  v_tx record;
begin
  for v_tx in
    select t.id
    from public.transactions t
    left join public.inventory_transactions it
      on it.source_type = 'wms_transaction'
     and it.source_id = t.id
    where t.status::text = 'COMPLETED'
      and it.id is null
    order by t.date asc, t.id asc
  loop
    begin
      perform app_private.sync_wms_transaction_to_inventory_ledger(v_tx.id);
    exception when others then
      raise notice 'inventory ledger legacy backfill skipped transaction %: %', v_tx.id, sqlerrm;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
