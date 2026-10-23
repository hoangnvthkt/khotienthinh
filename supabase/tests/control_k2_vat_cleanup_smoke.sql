-- Dọn VAT đợt lệch (K2): 12 đợt chưa nhận về VAT đơn; PO-259 đợt 1 tính lại giá trị; đợt đã nhận có công nợ không đổi.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261030110000_control_k2_vat_cleanup.sql --smoke supabase/tests/control_k2_vat_cleanup_smoke.sql
begin;
do $$ begin
  if exists (select 1 from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id
    where b.status in ('planned', 'receiving', 'quality_approved') and coalesce(b.vat_rate, 0) = 0 and coalesce(po.vat_rate, 0) > 0 and po.archived_at is null) then
    raise exception 'FAIL 1 còn đợt chưa nhận VAT 0%% mà đơn có VAT'; end if;
  if abs((select b.accepted_gross_amount from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id
    where po.po_number = 'PO-259' and b.delivery_no = 1) - 854241560.61) > 1 then raise exception 'FAIL 2 PO-259 đợt 1 giá trị sai'; end if;
  if (select b.vat_rate from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id
    where po.po_number = 'PO-272' and b.delivery_no = 3) <> 0 then raise exception 'FAIL 3 sửa cả đợt đã có công nợ'; end if;
end $$;
select po.po_number, b.delivery_no, b.status, b.vat_rate, b.accepted_gross_amount from public.purchase_order_delivery_batches b
join public.purchase_orders po on po.id = b.purchase_order_id where b.variance_reason like '%dọn lệch K2%' order by 1, 2;
rollback;
