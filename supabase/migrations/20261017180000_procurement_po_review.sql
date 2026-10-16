-- Tóm tắt trước khi duyệt Đơn mua (lộ trình AI A1; chủ SP chốt 16/10/2026: Đơn mua trước, quy tắc + một câu AI).
--   * app_private.procurement_po_review(po): số liệu so sánh của từng dòng và cả đơn — chỉ đọc, không AI:
--       giá lần trước cùng NCC (cùng mã + quy cách + ĐV mua, 180 ngày), giá HĐ nguyên tắc,
--       NCC khác bán rẻ nhất (90 ngày; bỏ hàng dịch vụ nhóm DV — cước, bơm theo tuyến), đơn nghi trùng đang mở (cùng mã + quy cách + số lượng, 60 ngày), BOQ, đặt vượt nhu cầu,
--       dự toán vật tư (finance_po_budget_check + duyệt vượt ngân sách), lịch sử NCC (đơn 365 ngày, đợt nhận thiếu 180 ngày),
--       phiếu giao Kho chụp của NCC này còn chờ đơn (hàng về trước khi lập đơn).
--     Màn hình dựng chữ "cần xem / ổn" từ số liệu này (lib/procurementPoReview.ts); AI chỉ viết một câu từ đúng các dòng đó.
--   * get_procurement_po_review_v1(po): người xem Mua hàng — có giá đơn của NCC khác nên không mở cho người công trường chỉ xem PO dự án.
--   * Skill po_review_brief: bậc nền, chế độ đọc, model nhanh.

create or replace function app_private.procurement_po_review(p_po_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_po public.purchase_orders%rowtype; v_at timestamptz; v_day date;
  v_lines jsonb; v_budget jsonb; v_vendor jsonb; v_captures jsonb;
begin
  select * into v_po from public.purchase_orders where id = p_po_id and archived_at is null;
  if not found then return null; end if;
  v_at := coalesce(v_po.created_at, now());
  v_day := (v_at at time zone 'Asia/Ho_Chi_Minh')::date;

  with po_lines as (
    select coalesce(x.value->>'lineId', x.value->>'itemId') line_id, x.value->>'itemId' item_id,
      coalesce(x.value->>'name', x.value->>'itemNameSnapshot') item_name, x.value->>'specification' spec,
      lower(btrim(coalesce(x.value->>'specification', ''))) spec_key, x.value->>'unit' unit, lower(btrim(coalesce(x.value->>'unit', ''))) unit_key,
      coalesce((select i.category = 'DV' from public.items i where i.id::text = x.value->>'itemId'), false) service,
      coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) price, coalesce(nullif(x.value->>'qty', '')::numeric, 0) qty,
      x.value->'boq'->>'status' boq_status, x.ordinality n
    from jsonb_array_elements(case when jsonb_typeof(v_po.items) = 'array' then v_po.items else '[]'::jsonb end) with ordinality x
    where nullif(x.value->>'itemId', '') is not null
  ), hist as (
    -- Dòng có giá của đơn khác đã gửi trở đi, lập trước đơn này. So cùng ĐV mua (16/10: cùng mã nhưng lần trước "Cây", lần này "Mét" → không so).
    select o.id po_id, o.po_number, o.vendor_id, o.vendor_name, o.created_at, coalesce(nullif(o.order_date, ''), (o.created_at at time zone 'Asia/Ho_Chi_Minh')::date::text) po_date,
      x.value->>'itemId' item_id, lower(btrim(coalesce(x.value->>'specification', ''))) spec_key, lower(btrim(coalesce(x.value->>'unit', ''))) unit_key,
      coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) price
    from public.purchase_orders o
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
    where o.id <> v_po.id and o.archived_at is null and coalesce(o.status, '') not in ('draft', 'cancelled', 'returned')
      and o.created_at < v_at and o.created_at >= v_at - interval '180 days'
      and coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) > 0
      and x.value->>'itemId' in (select item_id from po_lines)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'lineId', l.line_id, 'itemId', l.item_id, 'name', l.item_name, 'specification', l.spec, 'unit', l.unit, 'qty', l.qty, 'price', l.price,
      'boq', l.boq_status,
      'last', (select jsonb_build_object('poId', h.po_id, 'poNumber', h.po_number, 'date', h.po_date, 'price', h.price)
        from hist h where h.vendor_id = v_po.vendor_id and h.item_id = l.item_id and h.spec_key = l.spec_key and h.unit_key = l.unit_key
        order by h.created_at desc limit 1),
      'cheaper', (select jsonb_build_object('poId', h.po_id, 'poNumber', h.po_number, 'vendorName', h.vendor_name, 'date', h.po_date, 'price', h.price)
        from hist h where not l.service and h.vendor_id is distinct from v_po.vendor_id and h.item_id = l.item_id and h.spec_key = l.spec_key
          and h.unit_key = l.unit_key and h.created_at >= v_at - interval '90 days'
        order by h.price, h.created_at desc limit 1),
      'contract', (select jsonb_build_object('contractId', sc.id, 'code', sc.code, 'price', cl.unit_price)
        from public.supplier_contract_lines cl join public.supplier_contracts sc on sc.id = cl.supplier_contract_id
        where cl.item_id = l.item_id and cl.unit_price > 0
          and lower(btrim(coalesce(cl.unit_snapshot, ''))) = l.unit_key
          and (sc.id = v_po.supplier_contract_id or (v_po.vendor_id is not null and sc.supplier_id = v_po.vendor_id and sc.status = 'signed'
            and (sc.effective_date is null or sc.effective_date <= v_day) and (sc.expiry_date is null or sc.expiry_date >= v_day)))
          and (cl.effective_from is null or cl.effective_from <= v_day) and (cl.effective_to is null or cl.effective_to >= v_day)
          and (lower(btrim(coalesce(cl.specification, ''))) = l.spec_key or btrim(coalesce(cl.specification, '')) = '')
        order by (sc.id = v_po.supplier_contract_id) desc, (lower(btrim(coalesce(cl.specification, ''))) = l.spec_key) desc, sc.signed_date desc nulls last
        limit 1),
      -- Nghi trùng: đơn khác đang mở cùng mã + quy cách + số lượng (±1%), cùng dự án / kho, 60 ngày (đo 16/10: 3 dòng / 30 đơn chờ duyệt;
      -- chỉ "cùng vật tư" thì 67/108 dòng — quá ồn).
      'duplicates', coalesce((select jsonb_agg(q.d order by q.at desc) from (
          select o.created_at at, jsonb_build_object('poId', o.id, 'poNumber', o.po_number, 'status', o.status, 'qty', y.qty, 'unit', y.unit) d
          from public.purchase_orders o
          cross join lateral (select sum(coalesce(nullif(z.value->>'qty', '')::numeric, 0)) qty, max(z.value->>'unit') unit
            from jsonb_array_elements(o.items) z
            where z.value->>'itemId' = l.item_id and lower(btrim(coalesce(z.value->>'specification', ''))) = l.spec_key) y
          where o.id <> v_po.id and o.archived_at is null and o.status in ('draft', 'sent', 'confirmed', 'in_transit', 'partial')
            and o.created_at >= v_at - interval '60 days' and jsonb_typeof(o.items) = 'array'
            and ((v_po.project_id is not null and o.project_id = v_po.project_id)
              or (v_po.target_warehouse_id is not null and o.target_warehouse_id = v_po.target_warehouse_id))
            and y.qty > 0 and abs(y.qty - l.qty) <= greatest(abs(l.qty) * 0.01, 0.001)
          order by o.created_at desc limit 3) q), '[]'::jsonb),
      'excessReason', (select string_agg(distinct btrim(k.excess_reason), '; ') from public.purchase_order_request_lines k
        where k.purchase_order_id = v_po.id and k.purchase_order_line_id = l.line_id and nullif(btrim(k.excess_reason), '') is not null)
    ) order by l.n), '[]'::jsonb)
  into v_lines
  from po_lines l;

  -- Dự toán vật tư của dự án: null = không xét (đơn gom / dự trữ không gắn một dự án).
  if v_po.project_id is not null then
    v_budget := jsonb_build_object('check', app_private.finance_po_budget_check(v_po.id), 'approval', v_po.metadata->'budgetApproval');
  end if;

  if v_po.vendor_id is not null then
    select jsonb_build_object(
      'orders', (select count(*) from public.purchase_orders o where o.vendor_id = v_po.vendor_id and o.id <> v_po.id and o.archived_at is null
        and coalesce(o.status, '') not in ('draft', 'cancelled', 'returned') and o.created_at >= v_at - interval '365 days'),
      'received', count(*) filter (where b.status in ('received', 'received_short', 'received_over')),
      'short', count(*) filter (where b.status = 'received_short'))
    into v_vendor
    from public.purchase_order_delivery_batches b join public.purchase_orders o on o.id = b.purchase_order_id
    where o.vendor_id = v_po.vendor_id and o.id <> v_po.id and b.received_at >= now() - interval '180 days';

    -- Phiếu giao Kho đã chụp của NCC này ở kho / dự án của đơn mà chưa gắn đơn: hàng đã về trước khi lập đơn.
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'docNo', c.doc_no, 'docDate', c.doc_date, 'createdAt', c.created_at,
        'warehouseName', (select w.name from public.warehouses w where w.id::text = c.warehouse_id)) order by c.created_at desc), '[]'::jsonb)
    into v_captures
    from (select * from public.wms_delivery_captures c
      where c.supplier_id = v_po.vendor_id and c.status in ('new', 'read') and c.purchase_order_id is null
        and (c.warehouse_id = v_po.target_warehouse_id
          or (v_po.project_id is not null and c.warehouse_id in (select w.id::text from public.warehouses w where w.project_id::text = v_po.project_id)))
      order by c.created_at desc limit 3) c;
  end if;

  return jsonb_build_object('poId', v_po.id, 'poNumber', v_po.po_number, 'status', v_po.status, 'vendorId', v_po.vendor_id, 'vendorName', v_po.vendor_name,
    'createdAt', v_po.created_at, 'lines', v_lines, 'budget', v_budget, 'vendor', v_vendor, 'captures', coalesce(v_captures, '[]'::jsonb));
end $$;
comment on function app_private.procurement_po_review(text) is 'Tóm tắt trước khi duyệt Đơn mua: số liệu so sánh giá / HĐ / đơn nghi trùng / BOQ / dự toán / NCC / phiếu giao chờ đơn. Chỉ đọc.';
revoke all on function app_private.procurement_po_review(text) from public, anon, authenticated;

create or replace function public.get_procurement_po_review_v1(p_po_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  if not exists (select 1 from public.purchase_orders where id = p_po_id and archived_at is null) then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  return app_private.procurement_po_review(p_po_id);
end $$;
comment on function public.get_procurement_po_review_v1(text) is 'Tóm tắt trước khi duyệt Đơn mua (người xem Mua hàng). Chỉ đọc.';
revoke all on function public.get_procurement_po_review_v1(text) from public, anon;
grant execute on function public.get_procurement_po_review_v1(text) to authenticated;

insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('po_review_brief', 'Tóm tắt đơn trước khi duyệt', 'Mua hàng: một câu cho người duyệt đơn, chỉ từ các điểm "cần xem / ổn" hệ thống đã kiểm (giá, HĐ, dự toán, BOQ, đơn trùng, NCC).', 'base', 'read', true, 60, 'fast')
on conflict (code) do nothing;

notify pgrst, 'reload schema';
