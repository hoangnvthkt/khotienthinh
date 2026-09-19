CREATE OR REPLACE FUNCTION public.approve_material_po_quality(p_delivery_batch_id uuid, p_wms_transaction_id text, p_actor_user_id uuid DEFAULT NULL::uuid, p_quality_result text DEFAULT 'passed'::text, p_lines jsonb DEFAULT '[]'::jsonb, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
begin
  v_actor := app_private.require_purchase_receipt_stage_action(
    p_wms_transaction_id,
    p_actor_user_id,
    'wms.transaction.approve'
  );

  return app_private.approve_material_po_quality(
    p_delivery_batch_id,
    p_wms_transaction_id,
    v_actor,
    p_quality_result,
    p_lines,
    p_attachments
  );
end;
$function$
