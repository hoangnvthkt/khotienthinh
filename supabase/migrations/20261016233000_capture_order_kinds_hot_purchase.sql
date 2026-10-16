-- Kho PR-3 (chủ SP 16/10/2026): gợi ý đơn cho phiếu giao chụp phân biệt loại đơn và có cả Mua nóng.
--   * Đơn PO thường / đơn gọi hàng theo HĐ nguyên tắc (kèm số HĐ) / Mua nóng đã mua chờ nhận về kho của phiếu.
--   * Mua nóng nhận CẢ PHIẾU theo số đã duyệt (luật M2c): receive_capture_hot_v1 gọi receive_hot_purchase_v1, ảnh phiếu giao
--     thành chứng từ của phiếu nhập, phiếu chụp ghi nhận đã nhận.

alter table public.wms_delivery_captures
  add column if not exists hot_purchase_id uuid references public.site_direct_purchases(id) on delete set null;

create or replace function app_private.capture_json(c public.wms_delivery_captures)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'warehouseId', c.warehouse_id, 'status', c.status, 'supplierName', c.supplier_name,
    'docNo', c.doc_no, 'docDate', c.doc_date, 'docTime', c.doc_time, 'truckNo', c.truck_no, 'lines', c.lines, 'photos', c.photos,
    'ai', c.ai, 'note', c.note, 'purchaseOrderId', c.purchase_order_id,
    'supplierId', c.supplier_id, 'supplierMatch', c.supplier_match, 'supplierTaxCode', c.supplier_tax_code, 'supplierAddress', c.supplier_address,
    'supplierPartnerName', (select bp.name from public.business_partners bp where bp.id = c.supplier_id),
    'poNumber', coalesce((select po.po_number from public.purchase_orders po where po.id = c.purchase_order_id),
      (select hp.code from public.site_direct_purchases hp where hp.id = c.hot_purchase_id)),
    'hotPurchaseId', c.hot_purchase_id,
    'deliveryBatchId', c.delivery_batch_id, 'wmsTransactionId', c.wms_transaction_id,
    'code', (select it.code from public.inventory_transactions it where it.source_id = c.wms_transaction_id order by it.created_at limit 1),
    'createdBy', (select u.name from public.users u where u.id = c.created_by), 'createdAt', c.created_at,
    'receivedAt', c.received_at, 'receivedBy', (select u.name from public.users u where u.id = c.received_by));
$$;

create or replace function public.suggest_capture_orders_v1(p_capture_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_c public.wms_delivery_captures%rowtype;
  v_po record; v_hp record; v_hl record; v_ln jsonb; v_item jsonb; v_out jsonb := '[]'::jsonb; v_lines jsonb;
  v_sup numeric; v_best numeric; v_score numeric; v_sum numeric; v_n int; v_best_item jsonb; v_rem numeric; v_name_key text; v_alias text; v_i int;
begin
  select * into v_c from public.wms_delivery_captures where id = p_capture_id;
  if not found then raise exception using errcode = 'PT404', message = 'CAPTURE_NOT_FOUND'; end if;
  if not (public.is_admin() or app_private.wms_has_action('wms.transaction.view', v_c.warehouse_id, v_c.warehouse_id) or app_private.procurement_can('view')) then
    raise exception using errcode = '42501', message = 'CAPTURE_DENIED'; end if;
  for v_po in
    select po.* from public.purchase_orders po
    where po.archived_at is null and po.status in ('sent', 'confirmed', 'in_transit', 'partial')
      and app_private.procurement_po_is_hub(po.metadata)
      and (po.target_warehouse_id = v_c.warehouse_id
        or (app_private.procurement_po_is_group(po.metadata) and exists (select 1 from app_private.group_po_link_allocation(po.id) g where g.warehouse_id = v_c.warehouse_id)))
      and po.created_at > now() - interval '180 days'
  loop
    v_sup := case when v_c.supplier_id is not null then (case when v_po.vendor_id = v_c.supplier_id then 1 else 0 end)
      when coalesce(v_c.supplier_name, '') = '' then 0
      else app_private.capture_supplier_score(app_private.capture_supplier_core(v_c.supplier_name), app_private.capture_supplier_core(v_po.vendor_name)) end;
    v_lines := '[]'::jsonb; v_sum := 0; v_n := 0; v_i := 0;
    for v_ln in select value from jsonb_array_elements(v_c.lines) loop
      v_best := 0; v_best_item := null; v_name_key := app_private.capture_text_key(v_ln->>'name');
      select a.item_id into v_alias from public.wms_item_aliases a
      where a.alias_key = app_private.catalog_name_key(v_ln->>'name')
        and a.supplier_key in (app_private.catalog_name_key(v_po.vendor_name), '')
      order by (a.supplier_key = '') , a.hits desc limit 1;
      for v_item in select value from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) loop
        v_rem := app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(v_item->>'lineId', v_item->>'itemId'));
        v_score := case when v_alias is not null and v_alias = v_item->>'itemId' then 1
          else greatest(public.similarity(v_name_key, app_private.capture_text_key(coalesce(v_item->>'itemNameSnapshot', v_item->>'name'))),
                        public.similarity(v_name_key, app_private.capture_text_key(concat_ws(' ', v_item->>'name', v_item->>'specification'))),
                        public.word_similarity(app_private.capture_text_key(coalesce(v_item->>'itemNameSnapshot', v_item->>'name')), v_name_key),
                        -- Quy cách dòng đơn thường chép đúng chữ trên phiếu NCC (AZM50, PH-W01, PU…).
                        public.word_similarity(v_name_key, app_private.capture_text_key(v_item->>'specification'))) end
          - case when v_rem <= 0.0005 then 0.5 when nullif(v_ln->>'qty', '') is not null and (v_ln->>'qty')::numeric > v_rem + 0.0005 then 0.15 else 0 end
          + case when nullif(v_ln->>'qty', '') is not null and (abs(coalesce(nullif(v_ln->>'qty', '')::numeric, -1) - v_rem) < 0.0005
                 or abs(coalesce(nullif(v_ln->>'qty', '')::numeric, -1) - coalesce(nullif(v_item->>'qty', '')::numeric, -2)) < 0.0005) then 0.3 else 0 end
          + case when app_private.capture_text_key(v_ln->>'unit') <> '' and app_private.capture_text_key(v_ln->>'unit')
                 = app_private.capture_text_key(coalesce(v_item->>'purchaseUnitSnapshot', v_item->>'unit')) then 0.1 else 0 end;
        if v_score > v_best then
          v_best := v_score;
          v_best_item := jsonb_build_object('poLineId', coalesce(v_item->>'lineId', v_item->>'itemId'), 'itemId', v_item->>'itemId',
            'itemName', coalesce(v_item->>'itemNameSnapshot', v_item->>'name'), 'specification', v_item->>'specification',
            'unit', coalesce(v_item->>'purchaseUnitSnapshot', v_item->>'unit'), 'ordered', nullif(v_item->>'qty', '')::numeric,
            'remaining', v_rem, 'price', nullif(v_item->>'unitPrice', '')::numeric, 'learned', v_alias is not null and v_alias = v_item->>'itemId');
        end if;
      end loop;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('captureIndex', v_i, 'score', round(least(v_best, 1.4), 3))
        || case when v_best >= 0.35 then coalesce(v_best_item, '{}'::jsonb) else '{}'::jsonb end);
      v_sum := v_sum + least(v_best, 1.3); v_n := v_n + 1; v_i := v_i + 1;
    end loop;
    v_score := 0.35 * v_sup + 0.65 * (case when v_n = 0 then 0 else v_sum / v_n end);
    if v_score >= 0.25 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('purchaseOrderId', v_po.id, 'poNumber', v_po.po_number, 'status', v_po.status,
        'approved', v_po.status in ('confirmed', 'in_transit', 'partial'), 'vendorName', v_po.vendor_name, 'createdAt', v_po.created_at,
        'supplierScore', round(v_sup, 3), 'kind', case when v_po.supplier_contract_id is not null then 'contract' else 'po' end,
        'contractCode', (select sc.code from public.supplier_contracts sc where sc.id = v_po.supplier_contract_id), 'score', round(v_score, 3), 'lines', v_lines,
        'poLines', (select coalesce(jsonb_agg(jsonb_build_object('poLineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
            'itemName', coalesce(x.value->>'itemNameSnapshot', x.value->>'name'), 'specification', x.value->>'specification',
            'unit', coalesce(x.value->>'purchaseUnitSnapshot', x.value->>'unit'), 'ordered', nullif(x.value->>'qty', '')::numeric,
            'remaining', app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')),
            'price', nullif(x.value->>'unitPrice', '')::numeric) order by x.ordinality), '[]'::jsonb)
          from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality x)));
    end if;
  end loop;
  -- Mua nóng đã mua, chờ nhận về kho này (PR-3 16/10): nhận cả phiếu theo số đã duyệt.
  for v_hp in
    select hp.* from public.site_direct_purchases hp
    where hp.hub_flow and hp.status = 'purchased' and hp.target_warehouse_id = v_c.warehouse_id and hp.created_at > now() - interval '180 days'
      and exists (select 1 from public.site_direct_purchase_lines l where l.direct_purchase_id = hp.id and l.status = 'accepted' and l.line_type in ('stock_item', 'small_tool'))
  loop
    v_sup := case when v_c.supplier_id is not null and v_hp.supplier_id is not null then (case when v_hp.supplier_id = v_c.supplier_id then 1 else 0 end)
      when coalesce(v_c.supplier_name, '') = '' then 0
      else app_private.capture_supplier_score(app_private.capture_supplier_core(v_c.supplier_name), app_private.capture_supplier_core(v_hp.supplier_name_snapshot)) end;
    v_lines := '[]'::jsonb; v_sum := 0; v_n := 0; v_i := 0;
    for v_ln in select value from jsonb_array_elements(v_c.lines) loop
      v_best := 0; v_best_item := null; v_name_key := app_private.capture_text_key(v_ln->>'name');
      for v_hl in select l.* from public.site_direct_purchase_lines l
        where l.direct_purchase_id = v_hp.id and l.status = 'accepted' and l.line_type in ('stock_item', 'small_tool') loop
        v_score := greatest(public.similarity(v_name_key, app_private.capture_text_key(v_hl.item_name_snapshot)),
                            public.word_similarity(app_private.capture_text_key(v_hl.item_name_snapshot), v_name_key))
          + case when nullif(v_ln->>'qty', '') is not null and abs((v_ln->>'qty')::numeric - coalesce(v_hl.accepted_quantity, -1)) < 0.0005 then 0.3 else 0 end
          + case when app_private.capture_text_key(v_ln->>'unit') <> '' and app_private.capture_text_key(v_ln->>'unit') = app_private.capture_text_key(v_hl.unit_snapshot) then 0.1 else 0 end;
        if v_score > v_best then
          v_best := v_score;
          v_best_item := jsonb_build_object('poLineId', v_hl.id, 'itemId', v_hl.item_id, 'itemName', v_hl.item_name_snapshot, 'specification', null,
            'unit', v_hl.unit_snapshot, 'ordered', v_hl.accepted_quantity, 'remaining', v_hl.accepted_quantity, 'price', v_hl.unit_price, 'learned', false);
        end if;
      end loop;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('captureIndex', v_i, 'score', round(least(v_best, 1.4), 3))
        || case when v_best >= 0.35 then coalesce(v_best_item, '{}'::jsonb) else '{}'::jsonb end);
      v_sum := v_sum + least(v_best, 1.3); v_n := v_n + 1; v_i := v_i + 1;
    end loop;
    v_score := 0.35 * v_sup + 0.65 * (case when v_n = 0 then 0 else v_sum / v_n end);
    if v_score >= 0.25 then
      v_out := v_out || jsonb_build_array(jsonb_build_object('purchaseOrderId', v_hp.id::text, 'poNumber', v_hp.code, 'status', v_hp.status,
        'approved', v_hp.overrun_status is distinct from 'pending', 'vendorName', v_hp.supplier_name_snapshot, 'createdAt', v_hp.created_at,
        'supplierScore', round(v_sup, 3), 'score', round(v_score, 3), 'lines', v_lines, 'kind', 'hot', 'contractCode', null,
        'poLines', (select coalesce(jsonb_agg(jsonb_build_object('poLineId', l.id, 'itemId', l.item_id, 'itemName', l.item_name_snapshot, 'specification', null,
            'unit', l.unit_snapshot, 'ordered', l.accepted_quantity, 'remaining', l.accepted_quantity, 'price', l.unit_price) order by l.line_no), '[]'::jsonb)
          from public.site_direct_purchase_lines l where l.direct_purchase_id = v_hp.id and l.status = 'accepted' and l.line_type in ('stock_item', 'small_tool'))));
    end if;
  end loop;
  return coalesce((select jsonb_agg(t.value order by t.rn) from (select x.value, row_number() over (order by (x.value->>'score')::numeric desc, (x.value->>'createdAt')::timestamptz) rn
    from jsonb_array_elements(v_out) x) t where t.rn <= 5), '[]'::jsonb);
end;
$$;

create or replace function public.receive_capture_hot_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.wms_delivery_captures%rowtype;
  v_hp public.site_direct_purchases%rowtype;
  v_res jsonb; v_tx text; v_att jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_c from public.wms_delivery_captures where id = nullif(p->>'captureId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'CAPTURE_NOT_FOUND'; end if;
  if not app_private.capture_can_operate(v_c.warehouse_id) then raise exception using errcode = '42501', message = 'CAPTURE_DENIED'; end if;
  if v_c.status in ('received', 'discarded') then raise exception using errcode = '22023', message = 'CAPTURE_LOCKED'; end if;
  select * into v_hp from public.site_direct_purchases where id = nullif(p->>'hotPurchaseId', '')::uuid;
  if not found or not v_hp.hub_flow or v_hp.target_warehouse_id is distinct from v_c.warehouse_id then
    raise exception using errcode = '22023', message = 'CAPTURE_PO_INVALID'; end if;

  v_res := public.receive_hot_purchase_v1(jsonb_build_object('id', v_hp.id));
  v_tx := v_res->>'wmsTransactionId';
  if v_tx is not null then
    v_att := coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(x.value->>'id', md5(x.value->>'path')), 'fileName', coalesce(x.value->>'name', 'phieu-giao.jpg'),
        'mimeType', coalesce(x.value->>'mimeType', 'image/jpeg'), 'fileSize', coalesce(nullif(x.value->>'size', '')::numeric, 0),
        'storagePath', x.value->>'path', 'uploadedAt', v_c.created_at, 'uploadedBy', coalesce(v_c.created_by, v_actor)))
      from jsonb_array_elements(v_c.photos) x where nullif(x.value->>'path', '') is not null), '[]'::jsonb);
    update public.transactions set attachments = coalesce(attachments, '[]'::jsonb) || v_att where id = v_tx;
  end if;
  update public.wms_delivery_captures set status = 'received', hot_purchase_id = v_hp.id, wms_transaction_id = v_tx,
    received_by = v_actor, received_at = now(), updated_at = now()
  where id = v_c.id returning * into v_c;
  perform app_private.hot_purchase_log(v_hp.id, 'delivery_capture', null, jsonb_build_object('captureId', v_c.id));
  return app_private.capture_json(v_c);
end;
$$;

revoke all on function public.receive_capture_hot_v1(jsonb) from public, anon;
grant execute on function public.receive_capture_hot_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
