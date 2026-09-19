CREATE OR REPLACE FUNCTION public.record_supplier_invoice_reconciliation_v2(p_invoice jsonb, p_links jsonb, p_actor_user_id uuid)
 RETURNS supplier_invoices
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  return app_private.record_supplier_invoice_reconciliation_v2(p_invoice, p_links, p_actor_user_id);
end;
$function$
