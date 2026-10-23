-- Kiểm soát viên K2 — dọn VAT đợt giao lệch VAT đơn (chủ SP 23/10 chọn "Sửa theo đơn + điều chỉnh nợ").
-- Chỉ sửa 12 đợt CHƯA ghi nhận hàng / công nợ: VAT đợt 0% trong khi đơn có VAT. Khi nhận / đối chiếu, giá trị đợt tính theo VAT đợt,
-- nên sửa trước thì công nợ ghi đúng. PO-259 đợt 1 đã duyệt chất lượng (giá trị tính theo 0%) → tính lại giá trị theo VAT đơn.
-- Không sửa ở đây: 12 đợt đã nhận có công nợ (≈ 48 tr VAT thiếu) → kế toán ghi điều chỉnh công nợ có chứng từ;
-- PO-439 (đơn 0%, đợt 10%) → Mua hàng kiểm VAT đơn; PO-373 đã hủy. Nhật ký trước/sau: trigger audit đợt giao.
do $$
declare v_n integer; v_targets text[] := array['PO-315#1', 'PO-384#1', 'PO-259#1', 'PO-259#2', 'PO-259#3', 'PO-263#1', 'PO-281#1', 'PO-387#1',
  'PO-446-01#1', 'PO-499#1', 'PO-116#1', 'PO-163#1'];
begin
  update public.purchase_order_delivery_batches b
  set vat_rate = po.vat_rate,
      accepted_gross_amount = case when b.status = 'quality_approved' and coalesce(b.accepted_gross_amount, 0) > 0
        then round(b.accepted_gross_amount * (1 + po.vat_rate / 100) / (1 + coalesce(b.vat_rate, 0) / 100), 2) else b.accepted_gross_amount end,
      variance_reason = concat_ws('; ', b.variance_reason, format('VAT đợt %s%% → %s%% theo đơn (dọn lệch K2 23/10)', trim_scale(coalesce(b.vat_rate, 0)), trim_scale(po.vat_rate)))
  from public.purchase_orders po
  where po.id = b.purchase_order_id and po.po_number || '#' || b.delivery_no = any(v_targets)
    and coalesce(b.vat_rate, 0) = 0 and coalesce(po.vat_rate, 0) > 0
    and b.status in ('planned', 'receiving', 'quality_approved')
    and not exists (select 1 from public.supplier_payable_documents d where d.source_type = 'purchase_delivery_receipt' and d.source_id = b.id::text);
  get diagnostics v_n = row_count;
  if v_n <> 12 then raise exception 'VAT cleanup: sửa % đợt, cần đúng 12 — dữ liệu đã đổi, kiểm lại trước khi áp', v_n; end if;
end $$;
