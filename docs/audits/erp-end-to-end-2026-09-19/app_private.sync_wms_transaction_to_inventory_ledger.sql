CREATE OR REPLACE FUNCTION app_private.sync_wms_transaction_to_inventory_ledger(p_transaction_id text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_existing_id uuid;
  v_original_inventory_transaction public.inventory_transactions%rowtype;
  v_inventory_transaction_id uuid;
  v_code text;
  v_line jsonb;
  v_entry_no integer := 0;
  v_tx_date timestamptz;
  v_item_id text;
  v_qty numeric;
  v_price numeric;
  v_source_line_id text;
  v_scope record;
  v_metadata jsonb;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then raise exception 'transaction not found: %', p_transaction_id; end if;
  if v_tx.status::text <> 'COMPLETED' then return null; end if;
  if coalesce(v_tx.business_event_type, '') <> 'reversal' then
    return app_private.sync_wms_transaction_to_inventory_ledger_pre_reversal_20260905(
      p_transaction_id
    );
  end if;

  select id into v_existing_id
  from public.inventory_transactions
  where source_type = 'wms_transaction' and source_id = v_tx.id
  limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  if v_tx.type::text <> 'IMPORT'
     or nullif(v_tx.reversal_of_transaction_id, '') is null then
    raise exception 'Chứng từ đảo phải là IMPORT và liên kết phiếu WMS gốc.';
  end if;

  select original.* into v_original_inventory_transaction
  from public.inventory_transactions original
  where original.source_type = 'wms_transaction'
    and original.source_id = v_tx.reversal_of_transaction_id
  order by original.created_at
  limit 1
  for update;
  if not found then
    raise exception 'Không tìm thấy inventory transaction gốc để ghi đảo.';
  end if;
  if v_original_inventory_transaction.status <> 'posted' then
    raise exception 'Inventory transaction gốc không còn ở trạng thái posted.';
  end if;

  v_code := app_private.next_inventory_ledger_code('in');
  v_tx_date := coalesce(nullif(v_tx.date::text, '')::timestamptz, now());
  select * into v_scope
  from app_private.resolve_warehouse_project_scope(v_tx.target_warehouse_id);
  v_metadata := jsonb_build_object(
    'wmsTransactionId', v_tx.id,
    'reversalOfTransactionId', v_tx.reversal_of_transaction_id,
    'reversalOfInventoryTransactionId', v_original_inventory_transaction.id,
    'businessEventType', 'reversal',
    'businessEventReason', v_tx.business_event_reason,
    'targetWarehouseId', v_tx.target_warehouse_id,
    'items', coalesce(v_tx.items, '[]'::jsonb)
  );

  insert into public.inventory_transactions(
    code, transaction_type, status, transaction_date,
    source_type, source_id, source_code, related_request_id,
    project_id, construction_site_id, business_event_type,
    description, metadata, created_by, approved_by, posted_at,
    reversal_of_inventory_transaction_id
  ) values (
    v_code, 'reversal', 'posted', v_tx_date,
    'wms_transaction', v_tx.id, v_tx.id, v_tx.related_request_id,
    v_scope.project_id, v_scope.construction_site_id, 'reversal',
    v_tx.note, v_metadata, v_tx.requester_id, v_tx.approver_id, now(),
    v_original_inventory_transaction.id
  ) returning id into v_inventory_transaction_id;

  for v_line in select value from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb))
  loop
    v_item_id := v_line ->> 'itemId';
    v_qty := coalesce(nullif(v_line ->> 'quantity', '')::numeric, 0);
    v_price := coalesce(nullif(v_line ->> 'price', '')::numeric, 0);
    v_source_line_id := nullif(coalesce(
      v_line ->> 'materialIssueLineId',
      v_line ->> 'requestLineId',
      v_line ->> 'lineId'
    ), '');
    if v_item_id is null or v_qty <= 0 then
      raise exception 'invalid reversal transaction item payload';
    end if;
    v_entry_no := v_entry_no + 1;
    perform app_private.post_inventory_ledger_entry(
      v_inventory_transaction_id, v_entry_no, v_code, v_tx_date,
      'reversal', 'in', v_item_id, v_tx.target_warehouse_id,
      v_scope.project_id, v_scope.construction_site_id,
      'wms_transaction', v_tx.id, v_tx.id, v_source_line_id,
      v_tx.related_request_id, v_qty, v_price, v_tx.note,
      v_line || jsonb_build_object(
        'businessEventType', 'reversal',
        'reversalOfTransactionId', v_tx.reversal_of_transaction_id,
        'reversalOfInventoryTransactionId', v_original_inventory_transaction.id
      ),
      v_tx.requester_id, v_tx.approver_id
    );
  end loop;

  update public.inventory_transactions
  set status = 'reversed', reversed_at = now()
  where id = v_original_inventory_transaction.id;

  return v_inventory_transaction_id;
end;
$function$
