-- Kho — nhận hàng theo đợt giao PO trong MỘT bước (chủ sản phẩm duyệt 30/09/2026).
--
-- Trước: thủ kho "Duyệt SL/CL" (phiếu APPROVED) rồi mới "Xác nhận nhập" (COMPLETED) — nhiều phiếu dừng ở giữa
-- (PO-259 đợt 1 kiểm 17/08 nhưng chưa nhập). Nay một lệnh làm cả hai trong cùng giao dịch: kiểm SL/CL theo số
-- thực nhận, cộng tồn, ghi nhận PO và công nợ tạm tính. Quyền giữ nguyên: người gọi phải có cả quyền duyệt
-- và quyền hoàn tất phiếu nhập ở kho nhận (kiểm trong từng hàm con).
-- Đợt kiểu cũ còn "wms_pending" (đã có phiếu WMS chờ) được chuyển sang chờ kiểm như ensure_material_po_batch_wms.
-- Không lùi ngày: ngày nhập là lúc bấm; lùi ngày chỉ có ở màn Đối chiếu nhận hàng.

create function public.receive_purchase_delivery_v1(
  p_delivery_batch_id uuid, p_wms_transaction_id text, p_quality_result text default 'passed',
  p_lines jsonb default '[]'::jsonb, p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_tx_status text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_batch from public.purchase_order_delivery_batches where id = p_delivery_batch_id for update;
  if not found or v_batch.wms_transaction_id is distinct from p_wms_transaction_id then
    raise exception using errcode = '22023', message = 'PURCHASE_RECEIPT_BATCH_MISMATCH'; end if;
  select status::text into v_tx_status from public.transactions where id = p_wms_transaction_id for update;

  if v_batch.status = 'wms_pending' and v_tx_status = 'PENDING' then
    update public.purchase_order_delivery_batches set status = 'receiving', updated_at = now() where id = v_batch.id;
    v_batch.status := 'receiving';
  end if;

  if v_batch.status = 'receiving' and v_tx_status = 'PENDING' then
    perform public.approve_material_po_quality(p_delivery_batch_id, p_wms_transaction_id, v_actor, p_quality_result, p_lines, p_attachments);
  elsif not (v_batch.status = 'quality_approved' and v_tx_status = 'APPROVED') then
    raise exception using errcode = '22023', message = 'PURCHASE_RECEIPT_NOT_RECEIVABLE';
  end if;

  return public.finalize_material_po_receipt(p_delivery_batch_id, p_wms_transaction_id, v_actor);
end;
$$;

revoke all on function public.receive_purchase_delivery_v1(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.receive_purchase_delivery_v1(uuid, text, text, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
