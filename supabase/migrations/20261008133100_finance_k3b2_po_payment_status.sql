-- ===========================================================================
-- K3b-2 (phần 1) — Mua hàng thấy tình trạng thanh toán của PO (02/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md mục 13
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 01–02/10: "Mua hàng chỉ xem nợ + hạn"):
-- * Mỗi PO tổng hợp từ công nợ sinh khi kho nhận hàng của PO (chứng từ purchase_delivery_receipt, gồm cả đối chiếu lùi ngày):
--   đã ghi nợ, giảm trừ (trả hàng), đã chi, còn nợ, đang trong đề nghị chi, hạn gần nhất, có quá hạn không.
-- * Trạng thái: chưa phát sinh nợ / chưa thanh toán / thanh toán một phần / đã thanh toán đủ. Không lộ UNC, người chi.
-- * Người xem Mua hàng (procurement view) đọc được; không cần quyền Tài chính.
-- ===========================================================================

create function public.get_procurement_po_payment_status_v1(p_po_ids text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not (app_private.procurement_can('view') or app_private.finance_can('view')) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return coalesce((
    with docs as (
      select bt.purchase_order_id po_id, d.id, d.due_date, b.recognized_amount, b.credit_amount, b.paid_amount,
        greatest(b.recognized_amount - b.credit_amount - b.paid_amount, 0) outstanding,
        (select coalesce(sum(l.amount), 0) from public.finance_payment_request_lines l join public.finance_payment_requests r on r.id = l.request_id
          where l.payable_document_id = d.id and r.status in ('pending', 'returned', 'approved')) in_request
      from public.supplier_payable_documents d
      join public.supplier_payable_document_balances b on b.id = d.id
      join public.purchase_order_delivery_batches bt on bt.id::text = d.source_id
      where d.source_type = 'purchase_delivery_receipt' and d.status not in ('cancelled', 'reversed', 'draft')
        and bt.purchase_order_id::text = any(p_po_ids)
    )
    , per_po as (
      select po_id, jsonb_build_object(
        'recognized', round(sum(recognized_amount), 2), 'credit', round(sum(credit_amount), 2), 'paid', round(sum(paid_amount), 2),
        'outstanding', round(sum(outstanding), 2), 'inRequest', round(sum(in_request), 2), 'documents', count(*),
        'nextDue', min(due_date) filter (where outstanding > 0.5),
        'overdue', coalesce(bool_or(outstanding > 0.5 and due_date < v_today), false),
        'status', case when sum(recognized_amount - credit_amount) <= 0.5 then 'none'
          when sum(outstanding) <= 0.5 then 'paid' when sum(paid_amount) > 0.5 then 'partial' else 'unpaid' end) v
      from docs group by po_id)
    select jsonb_object_agg(po_id, v) from per_po), '{}'::jsonb);
end $$;

revoke all on function public.get_procurement_po_payment_status_v1(text[]) from public, anon;
grant execute on function public.get_procurement_po_payment_status_v1(text[]) to authenticated;

notify pgrst, 'reload schema';
