-- Gợi ý in mờ khi lập đơn (chủ SP 11–12/10/2026): "Như đơn trước" cùng NCC.
--   * get_procurement_vendor_prefill_v1(NCC): đầu đơn gần nhất (VAT, hình thức giao, dự án, kho nhận) + dòng mua gần nhất
--     của từng mã + quy cách trong 90 ngày (đơn vị mua, hệ số, đơn giá, số đơn, ngày). Bỏ đơn nháp / hủy / trả / lưu trữ.
--   * Chỉ đọc; quyền như xem đơn Mua hàng. Máy chủ không điền gì — người mua Tab để dùng, giá lệch > 5% thì màn báo cam.

create or replace function public.get_procurement_vendor_prefill_v1(p_vendor_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_order jsonb; v_lines jsonb;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  if coalesce(btrim(p_vendor_id), '') = '' then return jsonb_build_object('order', null, 'lines', '[]'::jsonb); end if;

  select jsonb_build_object('poNumber', o.po_number, 'orderDate', o.order_date, 'vatRate', o.vat_rate, 'purchaseMode', o.purchase_mode,
      'projectId', o.project_id, 'constructionSiteId', o.construction_site_id, 'targetWarehouseId', o.target_warehouse_id)
    into v_order
  from public.purchase_orders o
  where o.vendor_id = p_vendor_id and o.archived_at is null and coalesce(o.status, '') not in ('draft', 'cancelled', 'returned')
  order by o.order_date desc nulls last, o.created_at desc
  limit 1;

  select coalesce(jsonb_agg(s.line order by s.order_date desc nulls last, s.created_at desc), '[]'::jsonb) into v_lines
  from (
    select distinct on (x.value->>'itemId', lower(btrim(coalesce(x.value->>'specification', ''))))
      jsonb_build_object(
        'itemId', x.value->>'itemId',
        'specification', coalesce(x.value->>'specification', ''),
        'unit', coalesce(nullif(x.value->>'purchaseUnitSnapshot', ''), x.value->>'unit'),
        'stockUnit', coalesce(nullif(x.value->>'stockUnitSnapshot', ''), x.value->>'unit'),
        'factor', coalesce(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 1),
        'unitPrice', coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0),
        'poNumber', o.po_number, 'orderDate', o.order_date) line,
      o.order_date, o.created_at
    from public.purchase_orders o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
    where o.vendor_id = p_vendor_id and o.archived_at is null and coalesce(o.status, '') not in ('draft', 'cancelled', 'returned')
      and o.created_at >= now() - interval '90 days'
      and nullif(x.value->>'itemId', '') is not null
      and coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) > 0
    order by x.value->>'itemId', lower(btrim(coalesce(x.value->>'specification', ''))), o.order_date desc nulls last, o.created_at desc
  ) s;

  return jsonb_build_object('order', v_order, 'lines', v_lines);
end $$;
comment on function public.get_procurement_vendor_prefill_v1(text) is 'Gợi ý in mờ Lập đơn: đầu đơn gần nhất + dòng mua gần nhất (90 ngày) của NCC. Chỉ đọc.';
revoke all on function public.get_procurement_vendor_prefill_v1(text) from public, anon;
grant execute on function public.get_procurement_vendor_prefill_v1(text) to authenticated;
