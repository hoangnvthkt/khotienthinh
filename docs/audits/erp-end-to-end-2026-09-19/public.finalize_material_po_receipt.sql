CREATE OR REPLACE FUNCTION public.finalize_material_po_receipt(p_delivery_batch_id uuid, p_wms_transaction_id text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_result jsonb;
  v_po_id text;
  v_purchase_mode text;
  v_previous_guard text;
begin
  v_actor := app_private.require_purchase_receipt_stage_action(
    p_wms_transaction_id,
    p_actor_user_id,
    'wms.transaction.complete'
  );

  v_result := app_private.finalize_purchase_receipt_v2(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor
  );

  select batch.purchase_order_id, po.purchase_mode
  into v_po_id, v_purchase_mode
  from public.purchase_order_delivery_batches batch
  join public.purchase_orders po on po.id = batch.purchase_order_id
  where batch.id = p_delivery_batch_id;

  if coalesce(v_purchase_mode, 'single') = 'single'
     and v_result ->> 'transactionStatus' = 'COMPLETED' then
    v_previous_guard := current_setting('app.material_transition_context', true);
    perform set_config('app.material_transition_context', 'on', true);
    update public.purchase_orders
    set status = 'delivered',
        actual_delivery_date = coalesce(actual_delivery_date, current_date::text)
    where id = v_po_id;
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    v_result := v_result || jsonb_build_object('purchaseOrderStatus', 'delivered');
  else
    v_result := v_result || jsonb_build_object(
      'purchaseOrderStatus', (select status from public.purchase_orders where id = v_po_id)
    );
  end if;

  return v_result;
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$function$
