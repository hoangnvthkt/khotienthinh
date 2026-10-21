-- Quy cách đi xuyên chứng từ (phiếu kho, sổ kho, phiếu giao nhận, đối soát, giá HĐ theo quy cách). Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261010173300_procurement_spec_through_documents.sql --smoke supabase/tests/procurement_spec_through_documents_smoke.sql
do $$
declare v_po record; v_tx jsonb; v_c text; v_item text; v_p numeric;
begin
  -- 1. Phiếu kho mới có dòng đơn → tự chép tên + quy cách của dòng đơn.
  select po.id, x.value into v_po from public.purchase_orders po, jsonb_array_elements(po.items) x
  where jsonb_typeof(po.items) = 'array' and nullif(btrim(x.value->>'specification'), '') is not null and x.value ? 'lineId' limit 1;
  if v_po.id is null then
    raise notice 'SKIP 1: chưa có dòng đơn có quy cách';
  else
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, status, note, source_type, source_id)
    values ('tx-smoke-spec-through', 'IMPORT', now(), jsonb_build_array(jsonb_build_object('itemId', v_po.value->>'itemId', 'quantity', 1,
        'purchaseOrderId', v_po.id, 'purchaseOrderLineId', v_po.value->>'lineId')),
      (select target_warehouse_id from public.transactions where target_warehouse_id is not null limit 1),
      (select requester_id from public.transactions where requester_id is not null limit 1), 'PENDING', 'smoke', 'smoke', 'x')
    returning items->0 into v_tx;
    if v_tx->>'specification' is distinct from btrim(v_po.value->>'specification') or v_tx->>'itemNameSnapshot' is null then
      raise exception 'FAIL 1 phiếu kho chưa có quy cách: %', v_tx; end if;
  end if;

  -- 2. Bù dữ liệu: không còn dòng phiếu kho tìm được dòng đơn mà thiếu ảnh chụp.
  if exists (select 1 from public.transactions t, jsonb_array_elements(t.items) x
    where jsonb_typeof(t.items) = 'array' and x.value ? 'purchaseOrderLineId' and not x.value ? 'itemNameSnapshot'
      and app_private.po_line_desc_for_item(x.value, t.source_type, t.source_id) is not null) then
    raise exception 'FAIL 2 còn phiếu kho chưa bù quy cách'; end if;

  -- 3. Giá HĐ theo quy cách: đúng quy cách (không phân biệt hoa thường / khoảng trắng), không lấy giá quy cách khác.
  select c.id into v_c from public.supplier_contracts c order by c.created_at desc limit 1;
  select i.id into v_item from public.items i
  where not exists (select 1 from public.supplier_contract_lines l where l.supplier_contract_id = v_c and l.item_id = i.id) limit 1;
  insert into public.supplier_contract_lines (supplier_contract_id, line_no, item_id, item_name_snapshot, unit_price, vat_rate, specification)
  values (v_c, 9901, v_item, 'smoke', 100, 8, 'Loại 1'), (v_c, 9902, v_item, 'smoke', 200, 8, 'Loại 2');
  select unit_price into v_p from app_private.procurement_contract_line_price(v_c, v_item, ' loại  2', current_date);
  if v_p is distinct from 200 then raise exception 'FAIL 3 giá theo quy cách: %', v_p; end if;
  if exists (select 1 from app_private.procurement_contract_line_price(v_c, v_item, 'Loại 3', current_date)) then
    raise exception 'FAIL 3 lấy nhầm giá quy cách khác'; end if;
  raise notice 'procurement_spec_through_documents_smoke OK';
end $$;
