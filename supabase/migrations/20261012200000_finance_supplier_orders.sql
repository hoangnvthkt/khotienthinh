-- Tài chính → Phải trả → NCC: danh sách đơn đã gửi của một NCC (giá trị đặt / đã nhận) để kế toán soi chiếu.
-- Mở chi tiết đơn dùng get_procurement_order_v1 sẵn có (người Xem Tài chính hiện đều mở được).

CREATE OR REPLACE FUNCTION public.get_finance_supplier_orders_v1(p_supplier_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(o order by o->>'orderDate' desc nulls last, o->>'poNumber' desc) from (
    select jsonb_build_object('id', po.id, 'poNumber', po.po_number, 'status', po.status,
      'projectCode', p.code, 'projectName', p.name,
      'orderDate', po.order_date,
      'totalAmount', coalesce(po.total_amount, 0), 'vatRate', coalesce(po.vat_rate, 0),
      'receivedNet', coalesce((select sum(coalesce(nullif(x->>'receivedQty', '')::numeric, 0) * coalesce(nullif(x->>'unitPrice', '')::numeric, 0))
        from jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) x), 0)) o
    from public.purchase_orders po left join public.projects p on p.id = po.project_id
    where po.vendor_id = p_supplier_id and po.archived_at is null and po.status not in ('draft', 'returned', 'cancelled')
    limit 500) q), '[]'::jsonb);
end;
$function$;

REVOKE ALL ON FUNCTION public.get_finance_supplier_orders_v1(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_finance_supplier_orders_v1(text) TO authenticated, service_role;
