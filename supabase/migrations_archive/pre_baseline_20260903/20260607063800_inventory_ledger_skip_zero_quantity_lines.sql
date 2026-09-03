-- Inventory Ledger zero-quantity tolerance
-- Zero-quantity historical WMS documents are documents without stock movement.
-- They should not block sync, and they should not create ledger entries.

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
    and exists (
      select 1
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where coalesce(nullif(item.value->>'quantity', '')::numeric, 0) > 0
    )
    or exists (
      select 1
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where v_tx.type::text = 'ADJUSTMENT'
        and coalesce(nullif(item.value->>'quantity', '')::numeric, 0) > 0
    );
  v_has_out := v_tx.type::text in ('EXPORT', 'TRANSFER', 'LIQUIDATION')
    and exists (
      select 1
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where coalesce(nullif(item.value->>'quantity', '')::numeric, 0) > 0
    )
    or exists (
      select 1
      from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) item(value)
      where v_tx.type::text = 'ADJUSTMENT'
        and coalesce(nullif(item.value->>'quantity', '')::numeric, 0) < 0
    );

  if not v_has_in and not v_has_out then
    return null;
  end if;

  if v_has_in then
    v_in_code := app_private.next_inventory_ledger_code('in');
  end if;
  if v_has_out then
    v_out_code := app_private.next_inventory_ledger_code('out');
  end if;
  v_header_code := coalesce(v_out_code, v_in_code);
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
    if v_qty = 0 then
      continue;
    end if;

    if v_tx.type::text = 'IMPORT' then
      if v_qty < 0 then raise exception 'invalid import quantity'; end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_in_code,
        v_tx_date, 'purchase_receipt', 'in',
        v_item_id, v_tx.target_warehouse_id, v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'EXPORT' then
      if v_qty < 0 then raise exception 'invalid export quantity'; end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_out_code,
        v_tx_date, 'project_issue', 'out',
        v_item_id, v_tx.source_warehouse_id, v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'TRANSFER' then
      if v_qty < 0 then raise exception 'invalid transfer quantity'; end if;
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
      if v_qty < 0 then raise exception 'invalid liquidation quantity'; end if;
      v_entry_no := v_entry_no + 1;
      perform app_private.post_inventory_ledger_entry(
        v_inventory_transaction_id, v_entry_no, v_out_code,
        v_tx_date, 'loss_issue', 'out',
        v_item_id, v_tx.source_warehouse_id, v_project_id, v_construction_site_id,
        'wms_transaction', v_tx.id, v_tx.id, v_source_line_id, v_tx.related_request_id,
        v_qty, v_price, v_tx.note, v_line, v_tx.requester_id, v_tx.approver_id
      );
    elsif v_tx.type::text = 'ADJUSTMENT' then
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

  if v_entry_no = 0 then
    delete from public.inventory_transactions
    where id = v_inventory_transaction_id;
    return null;
  end if;

  return v_inventory_transaction_id;
end;
$$;

notify pgrst, 'reload schema';
