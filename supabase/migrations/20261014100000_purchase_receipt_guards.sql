-- Nhận hàng theo đơn mua: chặn thao tác sai làm lệch số liệu + sửa số nhận nhầm (14/10/2026).
-- Ca thật PO-272 (SMB, Sika xám): thủ kho gõ thực nhận 21.000 kg nhưng ô số bị trả về số phiếu 35.930
-- trước khi bấm duyệt → kho, đơn, công nợ ghi 35.930. Lần giao 2 (6.000 kg) trước đó nhập tự do, không gắn đơn.
--
-- Luật nghiệp vụ:
--   * Không nhận vượt phần đơn còn lại (đặt − đã nhận − đợt khác đang mở) trừ khi người nhận xác nhận rõ
--     "NCC giao dư thật" (dòng gửi overConfirmed = true, kèm lý do lệch). Áp cho mọi đường duyệt SL/CL.
--   * get_purchase_receipt_context_v1: màn nhận hàng thấy tiến độ đơn (đặt / đã nhận / đợt khác đang mở /
--     còn lại), phiếu nhập ngoài đơn cùng vật tư–kho–NCC (dễ là hàng của đơn đã nhận rồi) và lịch sử sửa số.
--   * correct_purchase_receipt_v1 (người Duyệt ngoại lệ / Admin, khác người đã duyệt nhận): sửa số nhận nhầm (chỉ GIẢM — ghi thiếu thì nhận phần còn lại qua
--     "NCC giao tiếp"). Không sửa đè phiếu gốc: ghi phiếu điều chỉnh kho (ADJUSTMENT âm, giá theo đơn,
--     ngày theo ngày hàng về), giảm công nợ bằng khoản giảm trừ (credit) như trả NCC, chi phí dự án âm,
--     đơn mở lại phần thiếu. Chặn khi công nợ đã có hóa đơn / thanh toán / chốt giá / đề nghị chi.
--     Lưu người, lúc, trước/sau, lý do ở procurement_hub_events (receipt_correction).
--   * app_private.link_free_import_to_po_v1: gắn phiếu nhập ngoài đơn cũ vào đơn (sửa dữ liệu, không cấp
--     cho người dùng). Không tạo thêm phiếu kho: phiếu cũ thành đợt giao của đơn, giá vốn theo giá đơn,
--     công nợ + chi phí ghi theo ngày hàng về của phiếu cũ.

-- Giới hạn nhận theo từng dòng đợt giao (đơn vị mua).
create or replace function app_private.purchase_receipt_line_limits(p_delivery_batch_id uuid)
returns table (delivery_line_id uuid, purchase_order_line_id text, item_id text, unit text,
  ordered_qty numeric, received_qty numeric, pending_other_qty numeric, planned_qty numeric, max_without_over numeric)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.purchase_order_line_id, l.item_id, l.unit,
    coalesce((select nullif(x.value->>'qty', '')::numeric from jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) x
      where coalesce(x.value->>'lineId', x.value->>'itemId') = l.purchase_order_line_id limit 1), 0),
    coalesce((select nullif(x.value->>'receivedQty', '')::numeric from jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) x
      where coalesce(x.value->>'lineId', x.value->>'itemId') = l.purchase_order_line_id limit 1), 0),
    coalesce((select sum(o.planned_qty) from public.purchase_order_delivery_lines o
      join public.purchase_order_delivery_batches ob on ob.id = o.delivery_batch_id
      where ob.purchase_order_id = b.purchase_order_id and o.purchase_order_line_id = l.purchase_order_line_id
        and ob.id <> b.id and ob.status = any (app_private.procurement_po_open_delivery_statuses())), 0),
    coalesce(l.planned_qty, 0),
    app_private.procurement_po_line_undelivered(po.id, po.items, l.purchase_order_line_id)
      + case when b.status = any (app_private.procurement_po_open_delivery_statuses()) then coalesce(l.planned_qty, 0) else 0 end
  from public.purchase_order_delivery_batches b
  join public.purchase_orders po on po.id = b.purchase_order_id
  join public.purchase_order_delivery_lines l on l.delivery_batch_id = b.id
  where b.id = p_delivery_batch_id;
$$;

-- Duyệt SL/CL (nhận 1 bước ở Kho và quét QR đều đi qua đây): chặn nhận vượt phần đơn còn lại khi chưa xác nhận.
create or replace function public.approve_material_po_quality(p_delivery_batch_id uuid, p_wms_transaction_id text,
  p_actor_user_id uuid default null, p_quality_result text default 'passed', p_lines jsonb default '[]'::jsonb,
  p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_line jsonb;
  v_limit record;
  v_qty numeric;
begin
  v_actor := app_private.require_purchase_receipt_stage_action(p_wms_transaction_id, p_actor_user_id, 'wms.transaction.approve');

  for v_line in select value from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) line(value) loop
    select * into v_limit from app_private.purchase_receipt_line_limits(p_delivery_batch_id) m
    where m.delivery_line_id = nullif(coalesce(v_line->>'deliveryLineId', v_line->>'delivery_line_id'), '')::uuid;
    if not found then continue; end if;
    v_qty := coalesce(nullif(coalesce(v_line->>'acceptedPurchaseQty', v_line->>'accepted_purchase_qty'), '')::numeric, 0);
    if v_qty > v_limit.max_without_over + 0.000001 and coalesce((v_line->>'overConfirmed')::boolean, false) is not true then
      raise exception using errcode = '22023', message = format(
        'PURCHASE_RECEIPT_OVER_PO: "%s" nhận %s %s vượt phần đơn còn lại %s %s (đặt %s, đã nhận %s, đợt khác đang mở %s). Kiểm tra lại số cân/đếm; nếu NCC giao dư thật, xác nhận "NCC giao dư" rồi duyệt lại.',
        coalesce((select i.name from public.items i where i.id = v_limit.item_id), v_limit.item_id),
        trim(to_char(v_qty, 'FM999G999G990D###')), coalesce(v_limit.unit, ''),
        trim(to_char(greatest(v_limit.max_without_over, 0), 'FM999G999G990D###')), coalesce(v_limit.unit, ''),
        trim(to_char(v_limit.ordered_qty, 'FM999G999G990D###')), trim(to_char(v_limit.received_qty, 'FM999G999G990D###')),
        trim(to_char(v_limit.pending_other_qty, 'FM999G999G990D###')));
    end if;
  end loop;

  return app_private.approve_material_po_quality(p_delivery_batch_id, p_wms_transaction_id, v_actor, p_quality_result, p_lines, p_attachments);
end;
$$;

-- Ngữ cảnh cho màn nhận hàng / phiếu đã nhận.
create or replace function public.get_purchase_receipt_context_v1(p_delivery_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_wh text;
  v_tx public.transactions%rowtype;
  v_items text[];
begin
  select * into v_batch from public.purchase_order_delivery_batches where id = p_delivery_batch_id;
  if not found then raise exception using errcode = 'P0002', message = 'PURCHASE_CONTEXT_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id;
  select * into v_tx from public.transactions where id = v_batch.wms_transaction_id;
  v_wh := coalesce(v_batch.target_warehouse_id, v_tx.target_warehouse_id, v_po.target_warehouse_id);
  if not (public.is_admin() or app_private.wms_has_action('wms.transaction.view', v_wh, v_wh)
      or app_private.wms_has_action('wms.transaction.approve', v_wh, v_wh) or app_private.procurement_can('view')) then
    raise exception using errcode = '42501', message = 'PURCHASE_CONTEXT_DENIED';
  end if;
  select array_agg(distinct l.item_id) into v_items from public.purchase_order_delivery_lines l where l.delivery_batch_id = v_batch.id;

  return jsonb_build_object(
    'poId', v_po.id, 'poNumber', v_po.po_number, 'poCreatedAt', v_po.created_at, 'poStatus', v_po.status,
    'deliveryNo', v_batch.delivery_no, 'batchStatus', v_batch.status, 'vatRate', v_batch.vat_rate,
    'receiptApproverId', v_tx.approver_id,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('deliveryLineId', m.delivery_line_id, 'purchaseOrderLineId', m.purchase_order_line_id,
        'itemId', m.item_id, 'unit', m.unit, 'orderedQty', m.ordered_qty, 'receivedQty', m.received_qty, 'pendingOtherQty', m.pending_other_qty,
        'plannedQty', m.planned_qty, 'maxWithoutOver', greatest(m.max_without_over, 0),
        'stockPlannedQty', dl.stock_planned_qty, 'acceptedQty', dl.accepted_qty, 'acceptedStockQty', dl.accepted_stock_qty,
        'returnedQty', dl.returned_qty, 'unitPrice', dl.delivery_unit_price))
      from app_private.purchase_receipt_line_limits(v_batch.id) m
      join public.purchase_order_delivery_lines dl on dl.id = m.delivery_line_id), '[]'::jsonb),
    'otherOpenBatches', coalesce((select jsonb_agg(jsonb_build_object('deliveryNo', ob.delivery_no, 'status', ob.status,
        'plannedDate', ob.planned_delivery_date, 'qty', (select sum(o.planned_qty) from public.purchase_order_delivery_lines o where o.delivery_batch_id = ob.id))
        order by ob.delivery_no)
      from public.purchase_order_delivery_batches ob
      where ob.purchase_order_id = v_po.id and ob.id <> v_batch.id and ob.status = any (app_private.procurement_po_open_delivery_statuses())), '[]'::jsonb),
    -- Phiếu nhập không theo đơn (kể cả phiếu nhận của đơn cũ), cùng kho + vật tư (+ NCC nếu phiếu có ghi), từ 7 ngày trước khi lập đơn.
    'outsideImports', coalesce((select jsonb_agg(jsonb_build_object('transactionId', t.id, 'date', t.date, 'note', t.note,
        'partner', t.business_partner_name_snapshot, 'code', (select e.document_code from public.inventory_ledger_entries e where e.source_id = t.id order by e.entry_no limit 1),
        'lines', (select jsonb_agg(jsonb_build_object('itemId', x.value->>'itemId', 'qty', x.value->>'quantity')) from jsonb_array_elements(t.items) x where x.value->>'itemId' = any (v_items)))
        order by t.date)
      from public.transactions t
      where t.type::text = 'IMPORT' and t.status::text = 'COMPLETED' and t.target_warehouse_id = v_wh
        and coalesce(t.source_type, '') not in ('po_delivery_batch', 'purchase_receipt_correction')
        and coalesce(t.business_event_type, '') in ('direct_supplier_receipt', 'direct_manual_receipt', 'legacy_direct_receipt')
        and t.date >= coalesce(v_po.created_at, now()) - interval '7 days'
        and not exists (select 1 from public.purchase_orders p2 where coalesce(p2.received_transaction_ids, '[]'::jsonb) ? t.id)
        and (t.business_partner_id is null or v_po.vendor_id is null or t.business_partner_id::text = v_po.vendor_id::text
          or t.business_partner_id::text = coalesce(v_batch.supplier_id, ''))
        and exists (select 1 from jsonb_array_elements(t.items) x where x.value->>'itemId' = any (v_items))), '[]'::jsonb),
    'corrections', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'byName', (select u.name from public.users u where u.id = e.actor_id),
        'reason', e.reason, 'lines', e.payload->'lines', 'transactionId', e.payload->>'transactionId', 'creditAmount', e.payload->'creditAmount') order by e.created_at)
      from public.procurement_hub_events e
      where e.entity_type = 'purchase_order' and e.entity_id = v_po.id and e.action = 'receipt_correction' and e.payload->>'deliveryId' = v_batch.id::text), '[]'::jsonb)
  );
end;
$$;

-- Công nợ của đợt đã dùng ở chứng từ tài chính nào chưa (đã dùng thì không tự giảm được).
create or replace function app_private.purchase_receipt_ap_usage(p_ap_id uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when exists (select 1 from public.supplier_payment_allocations x where x.payable_document_id = p_ap_id) then 'thanh toán'
    when exists (select 1 from public.finance_payment_request_lines x where x.payable_document_id = p_ap_id) then 'đề nghị chi'
    when exists (select 1 from public.supplier_invoice_payable_links x where x.payable_document_id = p_ap_id)
      or exists (select 1 from public.supplier_invoice_receipt_allocations x where x.payable_document_id = p_ap_id) then 'hóa đơn NCC'
    when exists (select 1 from public.supplier_price_settlement_lines x where x.payable_document_id = p_ap_id) then 'chốt giá'
    when exists (select 1 from public.supplier_advance_offsets x where x.payable_document_id = p_ap_id)
      or exists (select 1 from public.finance_supplier_credit_uses x where x.payable_document_id = p_ap_id) then 'cấn trừ tạm ứng'
    when exists (select 1 from public.finance_payable_adjustments x where x.payable_document_id = p_ap_id) then 'điều chỉnh công nợ'
    when exists (select 1 from public.supplier_delivery_statements x where x.payable_document_id = p_ap_id) then 'bảng đối soát'
    when exists (select 1 from public.site_cash_settlement_lines x where x.payable_document_id = p_ap_id) then 'quyết toán quỹ công trường'
  end;
$$;

create or replace function public.correct_purchase_receipt_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_ap public.supplier_payable_documents%rowtype;
  v_wh text;
  v_req jsonb;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_new numeric; v_new_stock numeric; v_diff numeric; v_diff_stock numeric; v_factor numeric;
  v_line_gross numeric; v_total_gross numeric := 0;
  v_fix_id uuid := gen_random_uuid();
  v_adj_id text := 'tx-receipt-fix-' || replace(gen_random_uuid()::text, '-', '');
  v_adj_items jsonb := '[]'::jsonb;
  v_event_lines jsonb := '[]'::jsonb;
  v_orig_item jsonb;
  v_usage text;
  v_unit text;
  v_note text := '';
  v_status text;
  v_next_items jsonb;
  v_delivered boolean;
  v_project_finance_id text;
  v_po_no text;
  v_prev_guard text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_REASON: Ghi lý do sửa (ít nhất 5 ký tự) — ví dụ số cân thực tế, ai phát hiện.'; end if;
  if coalesce(jsonb_typeof(p->'lines'), '') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_NOTHING: Chưa có dòng nào cần sửa.'; end if;

  select * into v_batch from public.purchase_order_delivery_batches where id = nullif(p->>'deliveryId', '')::uuid;
  if not found then raise exception using errcode = 'P0002', message = 'PURCHASE_FIX_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id for update;
  select * into v_batch from public.purchase_order_delivery_batches where id = v_batch.id for update;
  select * into v_tx from public.transactions where id = v_batch.wms_transaction_id for update;
  v_wh := coalesce(v_batch.target_warehouse_id, v_tx.target_warehouse_id);
  v_po_no := coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0');

  -- Như phiếu điều chỉnh: người Duyệt ngoại lệ (hoặc Admin), và không phải người đã duyệt nhận đợt này.
  if not app_private.wms_user_can_approve_exception(v_actor, v_wh) then
    raise exception using errcode = '42501', message = 'PURCHASE_FIX_DENIED: Chỉ người Duyệt ngoại lệ của kho (hoặc Admin) được sửa số nhận.'; end if;
  if v_tx.approver_id = v_actor then
    raise exception using errcode = '42501', message = 'PURCHASE_FIX_SELF: Người đã duyệt nhận đợt này không tự sửa số — nhờ người Duyệt ngoại lệ khác kiểm tra và sửa.'; end if;
  if v_batch.status not in ('received', 'received_short', 'received_over') or v_tx.status::text <> 'COMPLETED' then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_STATE: Đợt giao chưa ghi sổ nhận hàng — sửa trực tiếp số thực nhận trên phiếu.'; end if;
  if v_po.supplier_contract_id is not null then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_CONTRACT: Đơn gọi hàng theo HĐ nguyên tắc — báo Mua hàng điều chỉnh trên bảng đối soát tháng.'; end if;
  if coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK') <> 'RECEIVE_TO_STOCK'
     or exists (select 1 from app_private.request_purchase_po_links l where l.purchase_order_id = v_po.id and l.kind = 'asset') then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_MODE: Đợt giao dùng thẳng / mua tài sản không qua tồn kho — báo Mua hàng xử lý.'; end if;

  select * into v_ap from public.supplier_payable_documents where source_type = 'purchase_delivery_receipt' and source_id = v_batch.id::text for update;
  if found then
    if v_ap.status in ('cancelled', 'reversed') then
      raise exception using errcode = '22023', message = 'PURCHASE_FIX_AP_STATE: Công nợ của đợt đã hủy/đảo — báo kế toán.'; end if;
    v_usage := app_private.purchase_receipt_ap_usage(v_ap.id);
    if v_usage is not null then
      raise exception using errcode = '22023', message = format('PURCHASE_FIX_AP_USED: Công nợ của đợt đã có %s — báo kế toán lập điều chỉnh công nợ, kho lập phiếu điều chỉnh theo kiểm kê.', v_usage); end if;
  end if;

  for v_req in select value from jsonb_array_elements(p->'lines') loop
    select * into v_line from public.purchase_order_delivery_lines
    where id = nullif(v_req->>'deliveryLineId', '')::uuid and delivery_batch_id = v_batch.id for update;
    if not found then raise exception using errcode = '22023', message = 'PURCHASE_FIX_LINE: Dòng không thuộc đợt giao.'; end if;
    v_new := nullif(v_req->>'correctQty', '')::numeric;
    v_unit := coalesce(v_line.unit, v_line.stock_unit, '');
    if v_new is null or v_new < 0 then raise exception using errcode = '22023', message = 'PURCHASE_FIX_QTY: Số đúng không hợp lệ.'; end if;
    if v_req ? 'expectedQty' and abs(coalesce(nullif(v_req->>'expectedQty', '')::numeric, -1) - v_line.accepted_qty) > 0.000001 then
      raise exception using errcode = 'PT409', message = 'PURCHASE_FIX_STALE: Số đã nhận vừa thay đổi — mở lại phiếu để xem số mới.'; end if;
    if v_new > v_line.accepted_qty + 0.000001 then
      raise exception using errcode = '22023', message = format('PURCHASE_FIX_INCREASE: Số đúng %s lớn hơn số đã nhận %s %s. Ghi thiếu thì nhận phần còn lại qua "NCC giao tiếp" (đúng ngày hàng về), không sửa tăng.',
        trim(to_char(v_new, 'FM999G999G990D###')), trim(to_char(v_line.accepted_qty, 'FM999G999G990D###')), v_unit); end if;
    if v_new < coalesce(v_line.returned_qty, 0) - 0.000001 then
      raise exception using errcode = '22023', message = 'PURCHASE_FIX_RETURNED: Số đúng nhỏ hơn số đã trả NCC của dòng.'; end if;
    v_diff := round(v_line.accepted_qty - v_new, 6);
    if v_diff <= 0.0000005 then continue; end if;

    v_factor := case when coalesce(v_line.planned_qty, 0) > 0 and coalesce(v_line.stock_planned_qty, 0) > 0
      then v_line.stock_planned_qty / v_line.planned_qty else 1 end;
    v_new_stock := round(v_new * v_factor, 6);
    v_diff_stock := round(v_line.accepted_stock_qty - v_new_stock, 6);
    select x.value into v_orig_item from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) x
    where x.value->>'purchaseOrderDeliveryLineId' = v_line.id::text limit 1;

    v_adj_items := v_adj_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id, 'quantity', -v_diff_stock,
      'price', case when v_factor > 0 then coalesce(v_line.delivery_unit_price, 0) / v_factor else coalesce(v_line.delivery_unit_price, 0) end,
      'accountingQty', -v_diff, 'accountingUnit', v_unit, 'accountingPrice', coalesce(v_line.delivery_unit_price, 0),
      'specification', v_orig_item->>'specification', 'itemNameSnapshot', v_orig_item->>'itemNameSnapshot',
      'purchaseOrderLineId', v_line.purchase_order_line_id, 'purchaseOrderDeliveryLineId', v_line.id,
      'purchaseOrderDeliveryBatchId', v_batch.id, 'correctionOfTransactionId', v_tx.id,
      'receivedBeforeQty', v_line.accepted_qty, 'receivedAfterQty', v_new, 'varianceReason', v_reason));
    v_event_lines := v_event_lines || jsonb_build_array(jsonb_build_object('deliveryLineId', v_line.id, 'itemId', v_line.item_id, 'unit', v_unit,
      'before', v_line.accepted_qty, 'after', v_new, 'diff', v_diff, 'stockDiff', v_diff_stock,
      'beforeDelivered', v_line.delivered_qty, 'beforeCounted', v_line.physical_counted_qty));
    v_note := v_note || case when v_note = '' then '' else '; ' end
      || coalesce(v_orig_item->>'itemNameSnapshot', (select i.name from public.items i where i.id = v_line.item_id), v_line.item_id) || ' '
      || trim(to_char(v_line.accepted_qty, 'FM999G999G990D###')) || ' → ' || trim(to_char(v_new, 'FM999G999G990D###')) || ' ' || v_unit;

    update public.purchase_order_delivery_lines
    set accepted_qty = v_new, accepted_stock_qty = v_new_stock,
        physical_counted_qty = v_new, physical_counted_stock_qty = v_new_stock,
        delivered_qty = least(delivered_qty, v_new), delivered_stock_qty = least(delivered_stock_qty, v_new_stock), updated_at = now()
    where id = v_line.id;

    perform public.apply_stock_change(v_line.item_id, v_wh, -v_diff_stock);

    v_line_gross := round(v_diff * coalesce(v_line.delivery_unit_price, 0) * (1 + coalesce(v_batch.vat_rate, 0) / 100), 2);
    v_total_gross := round(v_total_gross + v_line_gross, 2);

    -- Đơn: trả lại phần đã ghi nhận thừa của dòng.
    v_po.items := (select coalesce(jsonb_agg(case when coalesce(x.value->>'lineId', x.value->>'itemId') = v_line.purchase_order_line_id
        then jsonb_set(x.value, '{receivedQty}', to_jsonb(greatest(round(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) - v_diff, 6), 0)), true)
        else x.value end order by x.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality x(value, ordinality));
  end loop;

  if jsonb_array_length(v_adj_items) = 0 then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_NOTHING: Số đúng bằng số đã nhận — không có gì để sửa.'; end if;

  -- Phiếu điều chỉnh kho: ghi sổ ra theo ngày hàng về của phiếu gốc, giá theo đơn (đúng giá trị đã nhập thừa).
  insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, approver_id, approved_at, status, note,
    business_event_type, business_event_reason, source_type, source_id, business_partner_id, business_partner_name_snapshot, created_by)
  values (v_adj_id, 'ADJUSTMENT', v_tx.date, v_adj_items, v_wh, v_actor, v_actor, now(), 'COMPLETED',
    'Sửa số nhận nhầm ' || v_po_no || ': ' || v_note || ' — ' || v_reason,
    'inventory_adjustment', v_reason, 'purchase_receipt_correction', v_batch.id::text, v_tx.business_partner_id, v_tx.business_partner_name_snapshot, v_actor);

  -- Đợt giao: trạng thái theo số đã sửa (giá trị nhận ban đầu giữ nguyên, phần giảm ghi ở công nợ).
  select case when sum(coalesce(accepted_qty, 0)) > sum(coalesce(planned_qty, 0)) then 'received_over'
    when sum(coalesce(accepted_qty, 0)) < sum(coalesce(planned_qty, 0)) then 'received_short' else 'received' end
  into v_status from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id;
  update public.purchase_order_delivery_batches
  set status = v_status, variance_reason = concat_ws('; ', variance_reason, 'Sửa số nhận: ' || v_note || ' (' || v_reason || ')'), updated_at = now()
  where id = v_batch.id;

  select coalesce(bool_and(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) >= coalesce(nullif(x.value->>'qty', '')::numeric, 0)), false)
  into v_delivered from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) x;
  v_prev_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_orders
  set items = v_po.items,
      status = case when v_po.status in ('delivered', 'partial') then case when v_delivered then 'delivered' else 'partial' end else v_po.status end,
      actual_delivery_date = case when v_delivered then actual_delivery_date else null end
  where id = v_po.id;
  perform set_config('app.material_transition_context', coalesce(v_prev_guard, ''), true);

  update public.material_request_fulfillment_lines mfl
  set received_qty = coalesce(line.accepted_stock_qty, line.accepted_qty, 0), updated_at = now()
  from public.purchase_order_delivery_lines line
  where mfl.po_delivery_line_id = line.id and line.delivery_batch_id = v_batch.id;

  -- Công nợ + chi phí dự án: giảm bằng khoản giảm trừ, không sửa số gốc.
  if v_ap.id is not null and v_total_gross > 0 then
    update public.supplier_payable_documents
    set credit_amount = round(coalesce(credit_amount, 0) + v_total_gross, 2),
        status = case when round(coalesce(recognized_amount, 0) - (coalesce(credit_amount, 0) + v_total_gross), 2) <= 0 then 'paid'
          when status = 'open' then 'partial' else status end,
        metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{purchaseReceiptCorrections}',
          coalesce(metadata->'purchaseReceiptCorrections', '{}'::jsonb) || jsonb_build_object(v_fix_id::text, jsonb_build_object(
            'sourceType', 'purchase_receipt_correction', 'adjustmentTransactionId', v_adj_id, 'amount', v_total_gross,
            'lines', v_event_lines, 'reason', v_reason, 'actorId', v_actor, 'at', now())), true),
        updated_at = now()
    where id = v_ap.id;

    select id into v_project_finance_id from public.project_finances
    where (v_po.project_id is not null and project_id = coalesce(v_batch.project_id, v_po.project_id))
       or (v_po.construction_site_id is not null and construction_site_id = coalesce(v_batch.construction_site_id, v_po.construction_site_id))
    limit 1;
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, contract_cost_item_id, cost_classification_status,
      counterparty_partner_id, counterparty_name, attachments, "createdBy", "createdAt")
    values ('purchase-receipt-fix-' || v_fix_id::text, coalesce(v_project_finance_id, ''), coalesce(coalesce(v_batch.construction_site_id, v_po.construction_site_id), ''),
      coalesce(v_batch.project_id, v_po.project_id), nullif(v_project_finance_id, ''), coalesce(v_batch.construction_site_id, v_po.construction_site_id),
      'expense', 'materials', -v_total_gross, 'Sửa số nhận nhầm ' || v_po_no || ': ' || v_note,
      coalesce((v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date, current_date)::text, 'workflow',
      'purchase_receipt_correction:' || v_fix_id::text, 'purchase_receipt_correction:' || v_fix_id::text, null, 'auto', null,
      coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, 'Nhà cung cấp'), '[]'::jsonb, v_actor::text, now())
    on conflict (source_ref) do nothing;
  end if;

  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'receipt_correction', v_actor, v_reason, jsonb_build_object('correctionId', v_fix_id, 'deliveryId', v_batch.id,
    'deliveryNo', v_batch.delivery_no, 'transactionId', v_adj_id, 'receiptTransactionId', v_tx.id, 'lines', v_event_lines,
    'creditAmount', v_total_gross, 'batchStatus', v_status));

  if v_po.created_by_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_po.created_by_id <> v_actor::text then
    perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Kho sửa số nhận nhầm',
      v_po_no || ': ' || v_note || '. Đơn mở lại phần thiếu — liên hệ NCC giao tiếp hoặc chốt thiếu.', v_po.id, 'assigned');
  end if;

  return jsonb_build_object('correctionId', v_fix_id, 'transactionId', v_adj_id, 'creditAmount', v_total_gross, 'batchStatus', v_status, 'lines', v_event_lines);
end;
$$;

-- Sửa dữ liệu: gắn phiếu nhập ngoài đơn (nhập tự do cũ) vào một dòng đơn. Chỉ chạy bằng script quản trị.
create or replace function app_private.link_free_import_to_po_v1(p_transaction_id text, p_purchase_order_id text, p_po_line_id text,
  p_unit_price numeric, p_actor uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_tx public.transactions%rowtype;
  v_po public.purchase_orders%rowtype;
  v_po_line jsonb;
  v_item jsonb;
  v_qty numeric;
  v_batch_id uuid := gen_random_uuid();
  v_line_id uuid := gen_random_uuid();
  v_no integer;
  v_vat numeric;
  v_delivered boolean;
  v_prev_guard text;
begin
  if p_actor is null or nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'LINK_ACTOR_REASON_REQUIRED'; end if;
  select * into v_tx from public.transactions where id = p_transaction_id for update;
  if not found or v_tx.type::text <> 'IMPORT' or v_tx.status::text <> 'COMPLETED'
     or coalesce(v_tx.source_type, '') not in ('business_partner', 'supplier_contract') or jsonb_array_length(coalesce(v_tx.items, '[]'::jsonb)) <> 1 then
    raise exception 'LINK_TX_NOT_FREE_IMPORT: %', p_transaction_id; end if;
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'LINK_PO_NOT_FOUND'; end if;
  select x.value into v_po_line from jsonb_array_elements(v_po.items) x where coalesce(x.value->>'lineId', x.value->>'itemId') = p_po_line_id limit 1;
  v_item := v_tx.items->0;
  v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);
  if v_po_line is null or v_po_line->>'itemId' <> v_item->>'itemId' then raise exception 'LINK_ITEM_MISMATCH'; end if;
  if coalesce(nullif(v_po_line->>'purchaseConversionFactor', '')::numeric, 1) <> 1 then raise exception 'LINK_UNIT_CONVERSION_UNSUPPORTED'; end if;
  if v_qty <= 0 or v_qty > app_private.procurement_po_line_undelivered(v_po.id, v_po.items, p_po_line_id) + 0.000001 then
    raise exception 'LINK_OVER_PO: % > còn lại %', v_qty, app_private.procurement_po_line_undelivered(v_po.id, v_po.items, p_po_line_id); end if;

  select coalesce(max(delivery_no), 0) + 1, coalesce(max(vat_rate), 0) into v_no, v_vat
  from public.purchase_order_delivery_batches where purchase_order_id = v_po.id;

  insert into public.purchase_order_delivery_batches (id, purchase_order_id, project_id, construction_site_id, delivery_no, planned_delivery_date,
    status, note, created_by, wms_transaction_id, supplier_id, supplier_name_snapshot, fulfillment_mode, vat_rate, quality_result, variance_reason,
    quality_approved_by, quality_approved_at, approval_status, approval_decided_by, approval_decided_at, target_warehouse_id)
  values (v_batch_id, v_po.id, v_po.project_id, v_po.construction_site_id, v_no, (v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date,
    'quality_approved', 'Gắn phiếu nhập ngoài đơn ' || coalesce((select e.document_code from public.inventory_ledger_entries e where e.source_id = v_tx.id order by e.entry_no limit 1), v_tx.id)
      || ' — ' || p_reason, p_actor, v_tx.id, v_po.vendor_id, coalesce(v_po.vendor_name, v_tx.business_partner_name_snapshot),
    'RECEIVE_TO_STOCK', v_vat, 'passed', 'Gắn phiếu nhập ngoài đơn: ' || p_reason,
    coalesce(v_tx.approver_id, p_actor), coalesce(v_tx.approved_at, now()), 'approved', p_actor, now(), v_tx.target_warehouse_id);
  insert into public.purchase_order_delivery_lines (id, delivery_batch_id, purchase_order_id, purchase_order_line_id, item_id, planned_qty, unit,
    stock_planned_qty, stock_unit, delivery_unit_price, accepted_qty, accepted_stock_qty, delivered_qty, delivered_stock_qty,
    physical_counted_qty, physical_counted_stock_qty)
  values (v_line_id, v_batch_id, v_po.id, p_po_line_id, v_item->>'itemId', v_qty, coalesce(v_po_line->>'purchaseUnitSnapshot', v_po_line->>'unit'),
    v_qty, coalesce(v_po_line->>'stockUnitSnapshot', v_po_line->>'unit'), p_unit_price, v_qty, v_qty, v_qty, v_qty, v_qty, v_qty);

  -- Phiếu cũ thành phiếu nhận của đợt (không tạo phiếu kho mới), giá vốn theo giá đơn.
  update public.transactions
  set source_type = 'po_delivery_batch', source_id = v_batch_id::text, business_event_type = 'proactive_po_receipt',
      business_partner_id = coalesce(business_partner_id, v_po.vendor_id),
      items = jsonb_build_array(v_item || jsonb_build_object('orderedQty', v_qty, 'accountingQty', v_qty, 'accountingUnit', coalesce(v_po_line->>'purchaseUnitSnapshot', v_po_line->>'unit'),
        'accountingPrice', p_unit_price, 'documentedStockQty', v_qty, 'countedStockQty', v_qty, 'orderedPurchaseQty', v_qty,
        'documentedPurchaseQty', v_qty, 'countedPurchaseQty', v_qty, 'custodyStockQty', 0, 'custodyPurchaseQty', 0, 'fulfillmentMode', 'RECEIVE_TO_STOCK',
        'purchaseOrderLineId', p_po_line_id, 'purchaseOrderDeliveryLineId', v_line_id, 'purchaseOrderDeliveryBatchId', v_batch_id,
        'linkedFromFreeImport', jsonb_build_object('previousSourceType', v_tx.source_type, 'previousEventType', v_tx.business_event_type, 'reason', p_reason, 'by', p_actor, 'at', now())))
  where id = v_tx.id;
  perform app_private.finance_set_direct_receipt_price(v_tx.id, 1, p_unit_price, p_actor);

  update public.purchase_order_delivery_batches
  set accepted_gross_amount = round(v_qty * p_unit_price * (1 + v_vat / 100), 2)
  where id = v_batch_id;
  update public.purchase_order_delivery_batches
  set status = 'received', received_by = p_actor, received_at = coalesce(v_tx.approved_at, now())
  where id = v_batch_id;

  v_po.items := (select coalesce(jsonb_agg(case when coalesce(x.value->>'lineId', x.value->>'itemId') = p_po_line_id
      then jsonb_set(x.value, '{receivedQty}', to_jsonb(round(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) + v_qty, 6)), true)
      else x.value end order by x.ordinality), '[]'::jsonb)
    from jsonb_array_elements(v_po.items) with ordinality x(value, ordinality));
  select coalesce(bool_and(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) >= coalesce(nullif(x.value->>'qty', '')::numeric, 0)), false)
  into v_delivered from jsonb_array_elements(v_po.items) x;
  v_prev_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_orders
  set items = v_po.items, status = case when v_delivered then 'delivered' else 'partial' end,
      received_transaction_ids = coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx.id)
  where id = v_po.id;
  perform set_config('app.material_transition_context', coalesce(v_prev_guard, ''), true);

  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'external_receipt_linked', p_actor, p_reason, jsonb_build_object('transactionId', v_tx.id, 'deliveryId', v_batch_id,
    'deliveryNo', v_no, 'qty', v_qty, 'unitPrice', p_unit_price, 'previousSourceType', v_tx.source_type, 'previousEventType', v_tx.business_event_type));
  return v_batch_id;
end;
$$;

revoke all on function app_private.purchase_receipt_line_limits(uuid) from public, anon, authenticated;
revoke all on function app_private.purchase_receipt_ap_usage(uuid) from public, anon, authenticated;
revoke all on function app_private.link_free_import_to_po_v1(text, text, text, numeric, uuid, text) from public, anon, authenticated;
revoke all on function public.get_purchase_receipt_context_v1(uuid) from public, anon;
grant execute on function public.get_purchase_receipt_context_v1(uuid) to authenticated;
revoke all on function public.correct_purchase_receipt_v1(jsonb) from public, anon;
grant execute on function public.correct_purchase_receipt_v1(jsonb) to authenticated;
revoke all on function public.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.approve_material_po_quality(uuid, text, uuid, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
