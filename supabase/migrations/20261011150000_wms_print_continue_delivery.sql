-- Kho: in phiếu ở màn Kho + NCC giao một đơn thành nhiều lần (11/10/2026).
--   * get_wms_tx_spec_allocations_v1 trả thêm số phiếu sổ kho (NK/XK…) để in đúng số.
--   * continue_purchase_delivery_v1: đợt giao vừa nhận thiếu → thủ kho bấm "NCC giao tiếp" là có ngay
--     đợt giao kế tiếp cho phần còn lại (cùng giá, VAT, kho), phiếu nhập chờ nhận hiện ở màn Kho.
--     Không vượt phần đơn chưa giao; mỗi đợt nhận thiếu chỉ sinh một đợt tiếp (bấm lại trả đợt đã có).

create or replace function public.get_wms_tx_spec_allocations_v1(p_transaction_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_tx public.transactions%rowtype;
begin
  select * into v_tx from public.transactions where id = p_transaction_id;
  if not found then return '[]'::jsonb; end if;
  if not (public.is_admin() or app_private.wms_has_action('wms.transaction.view', v_tx.source_warehouse_id, v_tx.target_warehouse_id)
      or app_private.wms_has_action('wms.inventory.view', coalesce(v_tx.source_warehouse_id, v_tx.target_warehouse_id), coalesce(v_tx.source_warehouse_id, v_tx.target_warehouse_id))
      or v_tx.requester_id = public.current_app_user_id()) then
    raise exception using errcode = '42501', message = 'WMS_STOCK_VIEW_DENIED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('itemId', e.material_id, 'direction', e.movement_direction, 'qty', e.quantity_in + e.quantity_out,
      'allocations', e.metadata->'specAllocations', 'code', e.document_code) order by e.created_at, e.entry_no)
    from public.inventory_ledger_entries e where e.source_id = p_transaction_id or e.source_code = p_transaction_id), '[]'::jsonb);
end;
$$;

create or replace function public.continue_purchase_delivery_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_wh text;
  v_existing uuid;
  v_new uuid := gen_random_uuid();
  v_no integer;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_rem numeric; v_factor numeric; v_amount numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = nullif(p->>'deliveryId', '')::uuid for update;
  if not found then raise exception using errcode = '22023', message = 'PURCHASE_CONTINUE_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id for update;
  v_wh := coalesce(v_batch.target_warehouse_id, v_po.target_warehouse_id);
  if not (public.is_admin() or app_private.wms_has_action('wms.transaction.approve', v_wh, v_wh) or app_private.procurement_can('manage')) then
    raise exception using errcode = '42501', message = 'PURCHASE_CONTINUE_DENIED'; end if;

  -- Bấm lại: trả đợt đã sinh.
  select nullif(e.payload->>'deliveryId', '')::uuid into v_existing from public.procurement_hub_events e
  where e.entity_type = 'purchase_order' and e.entity_id = v_po.id and e.action = 'delivery_continue' and e.payload->>'fromDeliveryId' = v_batch.id::text
  order by e.created_at desc limit 1;
  if v_existing is not null then
    return (select jsonb_build_object('deliveryId', b.id, 'deliveryNo', b.delivery_no, 'wmsTransactionId', b.wms_transaction_id, 'replayed', true)
      from public.purchase_order_delivery_batches b where b.id = v_existing);
  end if;

  if v_batch.status <> 'received_short' then raise exception using errcode = '22023', message = 'PURCHASE_CONTINUE_NOT_SHORT'; end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then raise exception using errcode = '22023', message = 'PURCHASE_CONTINUE_PO_STATE'; end if;

  for v_line in select * from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id order by created_at, id loop
    v_rem := least(coalesce(v_line.planned_qty, 0) - coalesce(v_line.accepted_qty, 0),
      app_private.procurement_po_line_undelivered(v_po.id, v_po.items, v_line.purchase_order_line_id));
    if v_rem > 0.0000005 then
      v_factor := case when coalesce(v_line.planned_qty, 0) > 0 and coalesce(v_line.stock_planned_qty, 0) > 0
        then v_line.stock_planned_qty / v_line.planned_qty else 1 end;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('purchaseOrderLineId', v_line.purchase_order_line_id, 'itemId', v_line.item_id,
        'purchaseQty', v_rem, 'purchaseUnit', v_line.unit, 'stockQty', round(v_rem * v_factor, 6), 'stockUnit', v_line.stock_unit,
        'purchaseUnitPrice', coalesce(v_line.delivery_unit_price, 0)));
      v_amount := v_amount + v_rem * coalesce(v_line.delivery_unit_price, 0);
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception using errcode = '22023', message = 'PURCHASE_CONTINUE_NOTHING_LEFT'; end if;

  select coalesce(max(delivery_no), 0) + 1 into v_no from public.purchase_order_delivery_batches where purchase_order_id = v_po.id;
  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  perform app_private.write_purchase_order_draft_batch_v1(v_po, jsonb_build_object('id', v_new, 'delivery_no', v_no,
    'planned_delivery_date', current_date, 'status', 'planned', 'approval_status', 'draft',
    'fulfillment_mode', coalesce(v_batch.fulfillment_mode, v_po.fulfillment_mode), 'vat_rate', coalesce(v_batch.vat_rate, 0),
    'note', 'NCC giao tiếp phần còn lại của đợt ' || v_batch.delivery_no, 'lines', v_lines), v_actor);
  update public.purchase_order_delivery_batches
  set target_warehouse_id = v_batch.target_warehouse_id, allocation_mode = v_batch.allocation_mode,
      project_id = v_batch.project_id, construction_site_id = v_batch.construction_site_id,
      supplier_id = coalesce(v_batch.supplier_id, supplier_id), supplier_name_snapshot = coalesce(v_batch.supplier_name_snapshot, supplier_name_snapshot),
      approval_status = 'approved', approval_requested_by = v_actor, approval_requested_at = now(),
      approval_decided_by = v_actor, approval_decided_at = now()
  where id = v_new;
  v_result := app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(v_new, v_actor, gen_random_uuid());
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_po.id, 'delivery_continue', v_actor,
    jsonb_build_object('fromDeliveryId', v_batch.id, 'fromDeliveryNo', v_batch.delivery_no, 'deliveryId', v_new, 'deliveryNo', v_no, 'amount', v_amount));
  if v_po.created_by_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_po.created_by_id <> v_actor::text then
    perform app_private.procurement_notify(v_po.created_by_id::uuid, 'NCC giao tiếp phần còn lại',
      coalesce(v_po.po_number, v_po.id) || ' — kho nhận thiếu đợt ' || v_batch.delivery_no || ', đã mở đợt ' || v_no || ' cho phần còn lại.', v_po.id, 'assigned');
  end if;
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('deliveryId', v_new, 'deliveryNo', v_no, 'wmsTransactionId', (select wms_transaction_id from public.purchase_order_delivery_batches where id = v_new),
    'amount', v_amount, 'replayed', false);
end;
$$;

revoke all on function public.continue_purchase_delivery_v1(jsonb) from public, anon;
grant execute on function public.continue_purchase_delivery_v1(jsonb) to authenticated;
revoke all on function public.get_wms_tx_spec_allocations_v1(text) from public, anon;
grant execute on function public.get_wms_tx_spec_allocations_v1(text) to authenticated;

notify pgrst, 'reload schema';
