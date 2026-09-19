CREATE OR REPLACE FUNCTION public.sync_supplier_payable_from_purchase_order(p_po_id text)
 RETURNS supplier_payable_documents
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_po public.purchase_orders%rowtype;
  v_recognized numeric(18,2);
  v_committed numeric(18,2);
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_po
  from public.purchase_orders
  where id = p_po_id
    and archived_at is null;

  if not found then
    raise exception 'Không tìm thấy PO %. ', p_po_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_po.project_id, v_po.construction_site_id) then
    raise exception 'Bạn không có quyền đồng bộ công nợ PO này.';
  end if;

  v_recognized := app_private.calculate_po_payable_amount(v_po.items)::numeric(18,2);
  v_committed := app_private.calculate_po_committed_amount(v_po.items, v_po.total_amount)::numeric(18,2);

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    invoice_number, invoice_date, metadata, created_by
  )
  values (
    'AP-' || coalesce(v_po.po_number, v_po.id),
    'purchase_order',
    v_po.id,
    v_po.project_id,
    v_po.construction_site_id,
    v_po.vendor_id,
    coalesce(v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
    coalesce(v_po.po_number, v_po.id),
    coalesce(app_private.safe_date(v_po.order_date), v_po.created_at::date, current_date),
    app_private.safe_date(v_po.expected_delivery_date),
    v_committed,
    v_recognized,
    0,
    case when v_recognized > 0 then 'open' else 'draft' end,
    coalesce(v_po.qr_token, 'ap_' || replace(v_po.id, '-', '')),
    v_po.invoice_number,
    v_po.invoice_date,
    jsonb_build_object(
      'sourceMode', v_po.source_mode,
      'targetWarehouseId', v_po.target_warehouse_id,
      'receivedTransactionIds', coalesce(v_po.received_transaction_ids, '[]'::jsonb)
    ),
    case
      when nullif(v_po.created_by_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then v_po.created_by_id::uuid
      else null
    end
  )
  on conflict (source_type, source_id) do update
  set
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    supplier_id = excluded.supplier_id,
    supplier_name_snapshot = excluded.supplier_name_snapshot,
    document_no = excluded.document_no,
    document_date = excluded.document_date,
    due_date = excluded.due_date,
    committed_amount = excluded.committed_amount,
    recognized_amount = excluded.recognized_amount,
    invoice_number = excluded.invoice_number,
    invoice_date = excluded.invoice_date,
    metadata = public.supplier_payable_documents.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_document;

  return v_document;
end;
$function$
