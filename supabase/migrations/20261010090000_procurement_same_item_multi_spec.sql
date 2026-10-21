-- Một mã vật tư nhiều quy cách (chủ SP 09/10/2026): cùng mã nhưng tên/quy cách/giá khác nhau vẫn là một mã,
-- tồn kho, BOQ, ngân sách cộng chung theo mã. Mỗi DÒNG (đề xuất, đơn hàng, bảng giá HĐ) mang quy cách + giá riêng.
--   * Đơn chủ động, gọi hàng theo HĐ: cho một mã nhiều dòng; hai dòng cùng mã phải khác quy cách (PROCUREMENT_PO_DUPLICATE_SPEC).
--     BOQ của đơn chủ động cộng dồn các dòng cùng mã trong đơn.
--   * Đơn từ phiếu nhu cầu: mỗi dòng gửi lên là một dòng đơn (trước đây gộp theo mã, khác giá thì lỗi). Giao diện gộp theo mã + quy cách.
--   * Chi tiết phiếu ở Mua hàng trả thêm quy cách của từng dòng đề xuất.
--   * Bảng giá HĐ: cột quy cách; một mã nhiều dòng giá khác quy cách được hiệu lực cùng lúc. Gọi hàng chọn đúng dòng giá (contractLineId).

alter table public.supplier_contract_lines add column if not exists specification text;
comment on column public.supplier_contract_lines.specification is 'Quy cách của dòng giá (một mã nhiều quy cách, mỗi quy cách một giá).';

CREATE OR REPLACE FUNCTION public.save_procurement_contract_lines_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_c public.supplier_contracts%rowtype; ln jsonb; v_item record; v_id uuid; v_no integer; v_n integer := 0;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_c from public.supplier_contracts where id = p_input->>'contractId' for update;
  if not found or coalesce(v_c.status, '') = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;

  if jsonb_typeof(p_input->'deleteIds') = 'array' then
    if exists (select 1 from jsonb_array_elements_text(p_input->'deleteIds') d
               join public.supplier_direct_delivery_lines x on x.supplier_contract_line_id = d::uuid) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_LINE_IN_USE'; end if;
    delete from public.supplier_contract_lines where supplier_contract_id = v_c.id
      and id in (select d::uuid from jsonb_array_elements_text(p_input->'deleteIds') d);
  end if;

  for ln in select value from jsonb_array_elements(coalesce(p_input->'lines', '[]'::jsonb)) loop
    select i.id, i.name, i.sku, i.unit into v_item from public.items i where i.id = ln->>'itemId';
    if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_ITEM_INVALID'; end if;
    if coalesce(nullif(ln->>'unitPrice', '')::numeric, -1) < 0 or coalesce(nullif(ln->>'vatRate', '')::numeric, 0) not between 0 and 100
      or coalesce(nullif(ln->>'quantityLimit', '')::numeric, 0) < 0 or coalesce(nullif(ln->>'amountLimit', '')::numeric, 0) < 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if nullif(ln->>'effectiveTo', '')::date < nullif(ln->>'effectiveFrom', '')::date then
      raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_DATE_INVALID'; end if;
    v_id := nullif(ln->>'id', '')::uuid;
    if v_id is null then
      select coalesce(max(line_no), 0) + 1 into v_no from public.supplier_contract_lines where supplier_contract_id = v_c.id;
      insert into public.supplier_contract_lines (supplier_contract_id, line_no, item_id, sku_snapshot, item_name_snapshot, unit_snapshot,
        unit_price, vat_rate, quantity_limit, amount_limit, effective_from, effective_to, note, specification)
      values (v_c.id, v_no, v_item.id, v_item.sku, v_item.name, v_item.unit, (ln->>'unitPrice')::numeric,
        coalesce(nullif(ln->>'vatRate', '')::numeric, 0), nullif(ln->>'quantityLimit', '')::numeric, nullif(ln->>'amountLimit', '')::numeric,
        nullif(ln->>'effectiveFrom', '')::date, nullif(ln->>'effectiveTo', '')::date, nullif(btrim(ln->>'note'), ''),
        nullif(left(btrim(coalesce(ln->>'specification', '')), 160), ''))
      returning id into v_id;
    else
      update public.supplier_contract_lines set item_id = v_item.id, sku_snapshot = v_item.sku, item_name_snapshot = v_item.name,
        unit_snapshot = v_item.unit, unit_price = (ln->>'unitPrice')::numeric, vat_rate = coalesce(nullif(ln->>'vatRate', '')::numeric, 0),
        quantity_limit = nullif(ln->>'quantityLimit', '')::numeric, amount_limit = nullif(ln->>'amountLimit', '')::numeric,
        effective_from = nullif(ln->>'effectiveFrom', '')::date, effective_to = nullif(ln->>'effectiveTo', '')::date,
        note = nullif(btrim(ln->>'note'), ''), specification = nullif(left(btrim(coalesce(ln->>'specification', '')), 160), '')
      where id = v_id and supplier_contract_id = v_c.id;
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_LINE_INVALID'; end if;
    end if;
    v_n := v_n + 1;
  end loop;

  -- Two prices of the same item AND the same specification may not both apply on one day.
  if exists (select 1 from public.supplier_contract_lines a join public.supplier_contract_lines b
      on b.supplier_contract_id = a.supplier_contract_id and b.item_id = a.item_id and b.id > a.id
      and lower(coalesce(b.specification, '')) = lower(coalesce(a.specification, ''))
    where a.supplier_contract_id = v_c.id
      and coalesce(a.effective_from, '-infinity'::date) <= coalesce(b.effective_to, 'infinity'::date)
      and coalesce(b.effective_from, '-infinity'::date) <= coalesce(a.effective_to, 'infinity'::date)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_PRICE_OVERLAP'; end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('need', 'contract:' || v_c.id, 'contract_prices', public.current_app_user_id(), jsonb_build_object('saved', v_n));
  return jsonb_build_object('contractId', v_c.id, 'saved', v_n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_procurement_contract_v1(p_contract_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_c public.supplier_contracts%rowtype; v_actor uuid := public.current_app_user_id(); v_buyer boolean := app_private.procurement_can('view');
begin
  select * into v_c from public.supplier_contracts where id = p_contract_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  if not app_private.procurement_contract_can_view(v_c) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with dl as materialized (
      select d.*, n.source_delivery_batch_id batch_id, n.purchase_order_id po_id, po.po_number,
        case when b.id is not null then case b.fulfillment_mode when 'DIRECT_CONSUMPTION' then 'direct' else 'stock' end
          when coalesce(l.wms_flow_mode, 'none') <> 'direct_in_out' then 'none'
          when l.wms_status = 'exported' then 'direct'
          when d.wms_ready then 'stock' else 'pending' end stock_state,
        w.name warehouse_name, pr.code project_code,
        (select cp.unit_price from app_private.procurement_contract_price(p_contract_id, d.item_id, d.delivery_date) cp) contract_price
      from app_private.procurement_contract_delivery_lines() d
      join public.supplier_direct_delivery_notes n on n.id = d.note_id
      join public.supplier_direct_delivery_lines l on l.id = d.line_id
      left join public.purchase_order_delivery_batches b on b.id = n.source_delivery_batch_id
      left join public.purchase_orders po on po.id = n.purchase_order_id
      left join public.warehouses w on w.id = l.target_warehouse_id
      left join public.projects pr on pr.id = d.project_id
      where d.contract_id = p_contract_id)
    select jsonb_build_object(
      'id', v_c.id, 'code', v_c.code, 'name', v_c.name, 'type', v_c.type, 'status', v_c.status, 'note', v_c.note,
      'supplierId', v_c.supplier_id, 'supplierName', v_c.supplier_name, 'projectId', v_c.project_id,
      'projectCode', (select code from public.projects where id = v_c.project_id), 'projectName', (select name from public.projects where id = v_c.project_id),
      'constructionSiteId', v_c.construction_site_id, 'value', v_c.value, 'paymentTerms', v_c.payment_terms, 'paymentTermDays', v_c.payment_term_days,
      'signedDate', v_c.signed_date, 'effectiveDate', v_c.effective_date, 'expiryDate', v_c.expiry_date,
      'canManage', app_private.procurement_can('manage'), 'isBuyer', v_buyer,
      'canOrder', app_private.procurement_contract_can_order(v_c.project_id, v_c.construction_site_id)
        and coalesce(v_c.status, '') not in ('cancelled', 'completed'),
      -- Người duyệt khi đơn gọi hàng vượt giá trị HĐ / hạn mức.
      'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
        from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
          and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))), '[]'::jsonb),
      'priceLines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lineNo', l.line_no, 'itemId', l.item_id,
          'sku', coalesce(l.sku_snapshot, i.sku), 'name', coalesce(i.name, l.item_name_snapshot), 'unit', coalesce(l.unit_snapshot, i.unit),
          'unitPrice', l.unit_price, 'vatRate', l.vat_rate, 'quantityLimit', l.quantity_limit, 'amountLimit', l.amount_limit,
          'effectiveFrom', l.effective_from, 'effectiveTo', l.effective_to, 'note', l.note, 'specification', l.specification,
          'used', exists (select 1 from public.supplier_direct_delivery_lines d where d.supplier_contract_line_id = l.id))
        order by coalesce(i.name, l.item_name_snapshot), l.specification nulls first, l.effective_from nulls first)
        from public.supplier_contract_lines l left join public.items i on i.id = l.item_id where l.supplier_contract_id = p_contract_id), '[]'::jsonb),
      'usage', coalesce((select jsonb_agg(u order by u->>'name') from (
          select jsonb_build_object('itemId', d.item_id, 'name', max(d.item_name), 'unit', max(d.unit),
            'deliveredQty', sum(d.qty), 'deliveredValue', sum(d.amount), 'unpricedLines', count(*) filter (where d.price_source = 'missing'),
            'quantityLimit', (select max(l.quantity_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'amountLimit', (select max(l.amount_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'currentPrice', (select cp.unit_price from app_private.procurement_contract_price(p_contract_id, d.item_id, current_date) cp)) u
          from dl d group by d.item_id) z), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'poNumber', po.po_number, 'status', po.status,
          'totalAmount', po.total_amount, 'vatRate', po.vat_rate, 'expectedDeliveryDate', po.expected_delivery_date,
          'fulfillmentMode', po.fulfillment_mode, 'warehouseName', w.name, 'projectCode', pr.code, 'rowVersion', po.row_version,
          'createdById', po.created_by_id, 'createdByName', (select name from public.users u where u.id::text = po.created_by_id),
          'submittedToName', po.submitted_to_name, 'returnReason', po.metadata->>'returnReason',
          'lines', jsonb_array_length(coalesce(po.items, '[]'::jsonb)),
          'items', po.items, 'targetWarehouseId', po.target_warehouse_id, 'note', po.note, 'purchaseMode', po.purchase_mode,
          'receivedValue', coalesce((select sum(coalesce(dl2.accepted_qty, 0) * coalesce(dl2.delivery_unit_price, 0))
            from public.purchase_order_delivery_lines dl2 join public.purchase_order_delivery_batches b2 on b2.id = dl2.delivery_batch_id
            where dl2.purchase_order_id = po.id and b2.status in ('received', 'received_short', 'received_over')), 0))
        order by po.created_at desc)
        from public.purchase_orders po left join public.warehouses w on w.id = po.target_warehouse_id left join public.projects pr on pr.id = po.project_id
        where po.supplier_contract_id = p_contract_id and po.archived_at is null
          and (v_buyer or po.created_by_id = v_actor::text or app_private.procurement_contract_can_order(po.project_id, po.construction_site_id))), '[]'::jsonb),
      'deliveries', coalesce((select jsonb_agg(jsonb_build_object('noteId', n.note_id, 'code', n.note_code, 'ticketNo', n.ticket_no,
          'date', n.delivery_date, 'purchaseOrderNo', n.po_number, 'projectCode', n.project_code, 'scopeKey', n.scope_key, 'lines', n.lines)
          order by n.delivery_date desc, n.note_code desc)
        from (select note_id, note_code, ticket_no, delivery_date, max(po_number) po_number, max(project_code) project_code,
                coalesce(max(project_id), '') || '|' || coalesce(max(site_id), '') scope_key,
                jsonb_agg(jsonb_build_object('lineId', line_id, 'itemId', item_id,
                'name', item_name, 'unit', unit, 'qty', qty, 'unitPrice', unit_price, 'vatRate', vat_rate, 'priceSource', price_source,
                'amount', amount, 'wmsReady', wms_ready, 'stockState', stock_state, 'warehouseName', warehouse_name,
                'contractPrice', contract_price, 'statementId', statement_id, 'statementCode', statement_code,
                'statementStatus', statement_status) order by item_name) lines
              from dl group by 1, 2, 3, 4 order by delivery_date desc limit 200) n), '[]'::jsonb),
      'statements', case when not v_buyer then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'periodMonth', s.period_month,
          'status', s.status, 'grossAmount', s.gross_amount, 'vatAmount', s.vat_amount, 'totalAmount', s.total_amount,
          'projectCode', (select code from public.projects where id = s.project_id),
          'lineCount', (select count(*) from public.supplier_delivery_statement_lines x where x.statement_id = s.id),
          'createdByName', (select name from public.users where id = s.created_by), 'postedAt', s.posted_at,
          'postedByName', (select name from public.users where id = s.posted_by),
          'confirmedByName', s.metadata->>'confirmedByName', 'confirmedAt', s.metadata->>'confirmedAt',
          'returnReason', s.metadata->>'returnReason', 'note', s.note,
          'canPost', s.status = 'confirmed' and app_private.procurement_statement_accountant_ok(v_actor, s.project_id, s.construction_site_id))
        order by s.period_month desc, s.created_at desc) from public.supplier_delivery_statements s where s.supplier_contract_id = p_contract_id), '[]'::jsonb) end
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.procurement_contract_price(p_contract_id text, p_item_id text, p_date date)
 RETURNS TABLE(line_id uuid, unit_price numeric, vat_rate numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select l.id, l.unit_price, l.vat_rate from public.supplier_contract_lines l
  where l.supplier_contract_id = p_contract_id and l.item_id = p_item_id
    and (l.effective_from is null or l.effective_from <= coalesce(p_date, current_date))
    and (l.effective_to is null or l.effective_to >= coalesce(p_date, current_date))
  order by (l.specification is null) desc, l.effective_from desc nulls last, l.line_no desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.save_procurement_contract_order_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_c public.supplier_contracts%rowtype;
  v_wh public.warehouses%rowtype;
  v_vendor_name text;
  v_project text; v_site text; v_purpose text;
  v_date date := coalesce(nullif(p_input->>'expectedDeliveryDate', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_fm text := case when p_input->>'fulfillmentMode' = 'DIRECT_CONSUMPTION' then 'DIRECT_CONSUMPTION' else 'RECEIVE_TO_STOCK' end;
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_seen text[] := '{}'; v_vats numeric[] := '{}'; v_manual integer := 0;
  it jsonb; v_item record; v_cp record; v_qty numeric; v_price numeric; v_vat numeric; v_line_id text; v_src text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_c from public.supplier_contracts where id = nullif(p_input->>'contractId', '');
  if not found or coalesce(v_c.status, '') = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  perform app_private.procurement_contract_assert_orderable(v_c, v_date);
  select * into v_wh from public.warehouses w
  where w.id = nullif(p_input->>'targetWarehouseId', '') and not coalesce(w.is_archived, false) and w.type in ('SITE', 'GENERAL');
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;
  if v_wh.type = 'SITE' then
    select s.project_id, s.construction_site_id into v_project, v_site from app_private.resolve_warehouse_project_scope(v_wh.id) s;
    v_site := coalesce(v_site, v_wh.construction_site_id::text);
    v_purpose := 'project';
  else
    v_purpose := 'stock';
  end if;
  -- HĐ gắn một dự án chỉ gọi về kho của dự án đó; Kho Tổng chỉ cho HĐ dùng chung.
  if v_c.project_id is not null and v_c.project_id is distinct from v_project then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_WAREHOUSE_SCOPE'; end if;
  if not app_private.procurement_contract_can_order(v_project, v_site) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_CONTRACT_ORDER_DENIED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  select coalesce(b.name, v_c.supplier_name) into v_vendor_name from public.business_partners b where b.id = v_c.supplier_id;
  if v_c.supplier_id is null then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;

  if v_po_id is not null then
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or v_po.supplier_contract_id is distinct from v_c.id or v_po.archived_at is not null then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_po.project_id is distinct from v_project then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_LOCKED'; end if;
  end if;

  for it in select value from jsonb_array_elements(p_input->'items') loop
    select i.id, i.name, i.sku, i.unit into v_item from public.items i where i.id = it->>'itemId';
    if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_ITEM_NOT_FOUND'; end if;
    -- Một mã nhiều dòng được, mỗi dòng một quy cách (chủ SP 09/10).
    if exists (select 1 from jsonb_array_elements(v_items) x where x.value->>'itemId' = v_item.id
        and lower(coalesce(x.value->>'specification', '')) = lower(coalesce(nullif(left(btrim(coalesce(nullif(btrim(it->>'specification'), ''), (select l.specification from public.supplier_contract_lines l where l.id = nullif(it->>'contractLineId', '')::uuid), '')), 160), ''), ''))) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_SPEC'; end if;
    v_qty := nullif(it->>'qty', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if nullif(it->>'contractLineId', '') is not null then
      -- Chọn đúng dòng giá (quy cách) trong bảng giá HĐ.
      select l.id line_id, l.unit_price, l.vat_rate, l.specification into v_cp from public.supplier_contract_lines l
      where l.id = (it->>'contractLineId')::uuid and l.supplier_contract_id = v_c.id and l.item_id = v_item.id
        and (l.effective_from is null or l.effective_from <= v_date) and (l.effective_to is null or l.effective_to >= v_date);
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_LINE_INVALID'; end if;
    else
      select p.line_id, p.unit_price, p.vat_rate, null::text specification into v_cp from app_private.procurement_contract_price(v_c.id, v_item.id, v_date) p;
    end if;
    if found and v_cp.line_id is not null then
      v_price := v_cp.unit_price; v_vat := coalesce(v_cp.vat_rate, 0); v_src := 'contract';
    else
      -- HĐ chưa có giá vật tư này: giá tạm, chốt lại khi đối soát.
      v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
      v_vat := coalesce(nullif(it->>'vatRate', '')::numeric, nullif(p_input->>'vatRate', '')::numeric, 0);
      v_src := 'manual'; v_manual := v_manual + 1;
      if v_price <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_PRICE_REQUIRED'; end if;
      if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;
    end if;
    if not v_vat = any (v_vats) then v_vats := v_vats || v_vat; end if;
    v_line_id := nullif(it->>'lineId', '');
    if v_line_id is not null and (v_po_id is null or not exists (select 1 from jsonb_array_elements(v_po.items) x
        where x.value->>'lineId' = v_line_id and x.value->>'itemId' = v_item.id)) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_LINE_INVALID'; end if;
    v_line_id := coalesce(v_line_id, 'mh-' || gen_random_uuid());
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_item.unit, ''), 'unitSnapshot', v_item.unit,
      'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_item.unit, 'purchaseConversionFactor', 1,
      'stockQty', v_qty, 'qty', v_qty, 'unitPrice', v_price, 'priceSource', v_src, 'contractLineId', v_cp.line_id,
      'note', nullif(btrim(it->>'note'), ''),
      'specification', nullif(left(btrim(coalesce(nullif(btrim(it->>'specification'), ''), v_cp.specification, '')), 160), ''))));
    v_total := v_total + v_qty * v_price;
  end loop;
  -- Đơn PO có một mức VAT: vật tư khác VAT tách đơn.
  if cardinality(v_vats) > 1 then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_VAT_MIXED'; end if;

  -- Dòng đã gắn nhu cầu phải còn, cùng vật tư, và SL không nhỏ hơn phần đã gắn.
  if v_po_id is not null and exists (
    select 1 from (select s.purchase_order_line_id line_id, s.item_id, sum(s.ordered_qty) q from (
        select purchase_order_line_id, item_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po_id
        union all
        select purchase_order_line_id, item_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po_id) s
      group by 1, 2) a
    where not exists (select 1 from jsonb_array_elements(v_items) x
      where x.value->>'lineId' = a.line_id and x.value->>'itemId' = a.item_id and (x.value->>'stockQty')::numeric >= a.q - 0.0005)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_ALLOCATED'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, note, created_by_id, approval_request_title, supplier_contract_id, metadata)
    values (v_po_id, v_project, v_site, v_c.supplier_id, v_vendor_name, public.next_purchase_order_number_v2(), v_items,
      v_total, coalesce(v_vats[1], 0), to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      to_char(v_date, 'YYYY-MM-DD'), 'draft', case v_purpose when 'stock' then 'proactive_stock' else 'proactive_project' end, v_mode, v_fm,
      v_wh.id, nullif(btrim(p_input->>'note'), ''), v_actor::text, 'Gọi hàng theo HĐ ' || v_c.code, v_c.id,
      jsonb_build_object('channel', 'procurement_hub',
        'proactive', jsonb_build_object('purpose', v_purpose, 'reasonCode', 'contract'),
        'contractOrder', jsonb_build_object('contractId', v_c.id, 'contractCode', v_c.code, 'manualPrices', v_manual)))
    returning * into v_po;
  else
    update public.purchase_orders set items = v_items, total_amount = v_total, vat_rate = coalesce(v_vats[1], 0), purchase_mode = v_mode,
      fulfillment_mode = v_fm, expected_delivery_date = to_char(v_date, 'YYYY-MM-DD'), target_warehouse_id = v_wh.id,
      construction_site_id = v_site, note = nullif(btrim(p_input->>'note'), ''),
      metadata = metadata || jsonb_build_object('contractOrder', jsonb_build_object('contractId', v_c.id, 'contractCode', v_c.code, 'manualPrices', v_manual))
    where id = v_po_id returning * into v_po;
    update public.purchase_order_request_lines set target_warehouse_id = v_wh.id where purchase_order_id = v_po_id;
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_po_id, case when p_input->>'purchaseOrderId' is null then 'create' else 'update' end, v_actor,
    jsonb_build_object('kind', 'contract', 'contractId', v_c.id, 'manualPrices', v_manual, 'fulfillmentMode', v_fm));
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items), 'manualPrices', v_manual);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_procurement_proactive_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_project public.projects%rowtype;
  v_wh public.warehouses%rowtype;
  v_vendor record; v_item record; v_boq record;
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
  v_reason_code text := nullif(p_input->>'reasonCode', '');
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_over_reason text := nullif(btrim(p_input->>'overBoqReason'), '');
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_over integer := 0; v_seen text[] := '{}';
  v_purpose text := case when p_input->>'purpose' = 'stock' then 'stock' else 'project' end;
  it jsonb; v_line_id text; v_stock numeric; v_pqty numeric; v_punit text; v_price numeric; v_status text; v_meta jsonb;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_reason_code is null or v_reason_code not in ('price_lock', 'long_lead', 'min_stock', 'other')
    or (v_reason_code = 'other' and v_reason is null) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_REASON_REQUIRED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;
  select b.id, b.name into v_vendor from public.business_partners b
  where b.id = nullif(p_input->>'vendorId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;
  if v_purpose = 'project' then
    select * into v_project from public.projects where id = nullif(p_input->>'projectId', '');
    if not found or v_project.status = 'cancelled' then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_REQUIRED'; end if;
    select * into v_wh from public.warehouses w
    where w.id = nullif(p_input->>'targetWarehouseId', '') and not coalesce(w.is_archived, false) and w.type = 'SITE'
      and (w.project_id = v_project.id or (v_project.construction_site_id is not null and w.construction_site_id = v_project.construction_site_id));
  else
    -- Dự trữ Kho Tổng: không gắn dự án; công nợ cấp công ty, chi phí vào dự án khi chuyển kho.
    select * into v_wh from public.warehouses w
    where w.id = nullif(p_input->>'targetWarehouseId', '') and not coalesce(w.is_archived, false) and w.type = 'GENERAL';
  end if;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  if v_po_id is not null then
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null
      or v_po.source_mode not in ('proactive_project', 'proactive_stock') then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_po.project_id is distinct from v_project.id
      or v_po.source_mode <> (case v_purpose when 'stock' then 'proactive_stock' else 'proactive_project' end) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_LOCKED'; end if;
  end if;

  for it in select value from jsonb_array_elements(p_input->'items') loop
    select i.id, i.name, i.sku, i.unit,
      case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
        and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
      coalesce(nullif(i.purchase_conversion_factor, 0), 1) factor
    into v_item from public.items i where i.id = it->>'itemId';
    if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_ITEM_NOT_FOUND'; end if;
    -- Một mã nhiều dòng được, mỗi dòng một quy cách (chủ SP 09/10).
    if exists (select 1 from jsonb_array_elements(v_items) x where x.value->>'itemId' = v_item.id
        and lower(coalesce(x.value->>'specification', '')) = lower(coalesce(nullif(left(btrim(coalesce(it->>'specification', '')), 160), ''), ''))) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_SPEC'; end if;
    v_stock := nullif(it->>'stockQty', '')::numeric;
    v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
    if v_stock is null or v_stock <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    v_punit := coalesce(nullif(btrim(it->>'purchaseUnit'), ''), v_item.purchase_unit, v_item.unit);
    v_pqty := case when nullif(it->>'purchaseQty', '') is not null then (it->>'purchaseQty')::numeric
      when v_item.purchase_unit is not null and v_punit = v_item.purchase_unit then round(v_stock / v_item.factor, 6)
      else v_stock end;
    if v_pqty is null or v_pqty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    v_line_id := nullif(it->>'lineId', '');
    if v_line_id is not null and (v_po_id is null or not exists (select 1 from jsonb_array_elements(v_po.items) x
        where x.value->>'lineId' = v_line_id and x.value->>'itemId' = v_item.id)) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_LINE_INVALID'; end if;
    v_line_id := coalesce(v_line_id, 'mh-' || gen_random_uuid());
    select * into v_boq from app_private.procurement_project_item_boq(v_project.id, v_item.id, v_po_id);
    -- Các dòng cùng mã trong đơn này cộng dồn vào BOQ của mã.
    v_boq.ordered_qty := v_boq.ordered_qty + coalesce((select sum((x.value->>'stockQty')::numeric) from jsonb_array_elements(v_items) x
      where x.value->>'itemId' = v_item.id), 0);
    v_status := case when v_purpose = 'stock' then 'stock' when not v_boq.in_boq then 'outside'
      when v_boq.ordered_qty + v_stock > v_boq.boq_qty * 1.0001 + 0.0005 then 'over' else 'within' end;
    if v_status not in ('within', 'stock') then v_over := v_over + 1; end if;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_stock / v_pqty, 12), 'stockQty', v_stock,
      'qty', v_pqty, 'unitPrice', v_price, 'note', nullif(btrim(it->>'note'), ''),
      -- Quy cách / cấu hình hiển thị cạnh tên vật tư trên đơn và mẫu in; kho vẫn theo mã vật tư gốc.
      'specification', nullif(left(btrim(coalesce(it->>'specification', '')), 160), ''),
      'boq', jsonb_build_object('status', v_status, 'boqQty', v_boq.boq_qty, 'orderedBefore', v_boq.ordered_qty))));
    v_total := v_total + v_pqty * v_price;
  end loop;
  if v_over > 0 and v_over_reason is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_OVER_BOQ_REASON'; end if;

  -- Dòng đã gắn nhu cầu phải còn, cùng vật tư, và SL không nhỏ hơn phần đã gắn.
  if v_po_id is not null and exists (
    select 1 from (select s.purchase_order_line_id line_id, s.item_id, sum(s.ordered_qty) q from (
        select purchase_order_line_id, item_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po_id
        union all
        select purchase_order_line_id, item_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po_id) s
      group by 1, 2) a
    where not exists (select 1 from jsonb_array_elements(v_items) x
      where x.value->>'lineId' = a.line_id and x.value->>'itemId' = a.item_id and (x.value->>'stockQty')::numeric >= a.q - 0.0005)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_ALLOCATED'; end if;

  v_meta := jsonb_strip_nulls(jsonb_build_object('purpose', v_purpose, 'reasonCode', v_reason_code, 'reason', v_reason,
    'overBoqReason', case when v_over > 0 then v_over_reason end));
  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, note, created_by_id, approval_request_title, metadata)
    values (v_po_id, v_project.id, coalesce(v_wh.construction_site_id::text, v_project.construction_site_id::text),
      v_vendor.id, v_vendor.name, public.next_purchase_order_number_v2(), v_items,
      v_total, v_vat, to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', case v_purpose when 'stock' then 'proactive_stock' else 'proactive_project' end, v_mode, 'RECEIVE_TO_STOCK',
      v_wh.id, nullif(btrim(p_input->>'note'), ''), v_actor::text, case v_purpose when 'stock' then 'Đơn dự trữ Kho Tổng lập tại Mua hàng' else 'Đơn chủ động lập tại Mua hàng' end,
      jsonb_build_object('channel', 'procurement_hub', 'proactive', v_meta))
    returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
    values ('purchase_order', v_po_id, 'create', v_actor, v_reason,
      jsonb_build_object('kind', 'proactive', 'reasonCode', v_reason_code, 'overBoq', v_over, 'overBoqReason', v_over_reason));
  else
    update public.purchase_orders set vendor_id = v_vendor.id, vendor_name = v_vendor.name, items = v_items,
      total_amount = v_total, vat_rate = v_vat, purchase_mode = v_mode,
      expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''), target_warehouse_id = v_wh.id,
      note = nullif(btrim(p_input->>'note'), ''), metadata = (metadata - 'proactive') || jsonb_build_object('proactive', v_meta)
    where id = v_po_id returning * into v_po;
    update public.purchase_order_request_lines set target_warehouse_id = v_wh.id where purchase_order_id = v_po_id;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
    values ('purchase_order', v_po_id, 'update', v_actor, v_reason,
      jsonb_build_object('kind', 'proactive', 'reasonCode', v_reason_code, 'overBoq', v_over, 'overBoqReason', v_over_reason));
  end if;
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items), 'overBoq', v_over);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.procurement_legacy_save_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_vendor record;
  v_project text; v_site text; v_warehouse text := nullif(p_input->>'targetWarehouseId', '');
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_request_ids text[];
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
  v_needed date; v_scopes integer; v_group boolean := false; v_line_id text; v_punit text; v_ord integer := 0; it jsonb; al jsonb; v_qty numeric; v_price numeric; v_item record; v_src record;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;

  select b.id, b.name into v_vendor from public.business_partners b
  where b.id = nullif(p_input->>'vendorId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;

  -- Every allocation must be an open need line of the same item, in one project/site.
  create temp table if not exists pg_temp.hub_alloc (item_ord integer, po_line_id text, item_id text, unit_price numeric, item_note text, item_spec text,
    purchase_qty numeric, purchase_unit text,
    source_type text, source_id text, line_id text, qty numeric, need_qty numeric, project_id text, site_id text,
    warehouse_id text, needed_date date, work_boq_item_id text, material_budget_item_id text, code text, unit text) on commit drop;
  truncate pg_temp.hub_alloc;
  for it in select value from jsonb_array_elements(p_input->'items') loop
    v_ord := v_ord + 1;
    v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
    if nullif(it->>'purchaseQty', '')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if jsonb_typeof(it->'allocations') is distinct from 'array' or jsonb_array_length(it->'allocations') = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    for al in select value from jsonb_array_elements(it->'allocations') loop
      v_qty := nullif(al->>'qty', '')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
      select l.need_qty, l.unit, d.project_id, d.construction_site_id, d.warehouse_id, d.needed_date, d.code, d.closed_at
        into v_src
      from app_private.procurement_inbox_lines() l
      join app_private.procurement_inbox_documents() d on d.source_type = l.source_type and d.source_id = l.source_id
      where l.source_type = al->>'sourceType' and l.source_id = al->>'sourceId' and l.line_id = al->>'lineId'
        and l.item_id = it->>'itemId';
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
      if v_src.closed_at is not null then raise exception using errcode = '22023', message = 'PROCUREMENT_NEED_CLOSED'; end if;
      insert into pg_temp.hub_alloc values (v_ord, null, it->>'itemId', v_price,
        nullif(btrim(it->>'note'), ''), nullif(left(btrim(coalesce(it->>'specification', '')), 160), ''), nullif(it->>'purchaseQty', '')::numeric, nullif(btrim(it->>'purchaseUnit'), ''), al->>'sourceType', al->>'sourceId', al->>'lineId', v_qty, v_src.need_qty,
        v_src.project_id, v_src.construction_site_id, v_src.warehouse_id, v_src.needed_date, null, null, v_src.code, v_src.unit);
    end loop;
  end loop;
  if exists (select 1 from pg_temp.hub_alloc group by source_type, source_id, line_id having count(*) > 1) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
  -- Một mã nhiều dòng đơn được, mỗi dòng một quy cách (chủ SP 09/10).
  if exists (select 1 from (select distinct item_ord, item_id, lower(coalesce(item_spec, '')) k from pg_temp.hub_alloc) d
      group by item_id, k having count(*) > 1) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_SPEC'; end if;
  select count(distinct coalesce(project_id, '') || '|' || coalesce(site_id, '')), min(project_id), min(site_id), min(needed_date)
    into v_scopes, v_project, v_site, v_needed from pg_temp.hub_alloc;
  -- Việc 2: phiếu của nhiều dự án → đơn gom; mỗi dòng phân bổ giữ kho nhận của phiếu, đơn không gắn một dự án / kho.
  v_group := v_scopes > 1;
  if v_group then
    if exists (select 1 from pg_temp.hub_alloc where warehouse_id is null) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_GROUP_WAREHOUSE_REQUIRED'; end if;
    v_project := null; v_site := null; v_warehouse := null;
    -- Đơn gom giao nhiều đợt (mỗi đợt một công trường), không tự tạo đợt giao khi duyệt.
    v_mode := 'multiple';
  end if;
  if v_warehouse is null and not v_group then
    select min(warehouse_id) into v_warehouse from pg_temp.hub_alloc having count(distinct warehouse_id) = 1;
  end if;
  if v_warehouse is not null and not exists (select 1 from public.warehouses w where w.id = v_warehouse and not coalesce(w.is_archived, false)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  -- Request line attribution (BOQ links) from the request itself.
  update pg_temp.hub_alloc a set work_boq_item_id = x.value->>'workBoqItemId', material_budget_item_id = x.value->>'materialBudgetItemId'
  from public.requests r cross join lateral jsonb_array_elements(r.items) x
  where a.source_type = 'material_request' and r.id = a.source_id and x.value->>'lineId' = a.line_id;

  -- One PO line per submitted item (the editor groups needs by item + specification; the buyer may split further).
  for v_item in
    select a.item_ord, max(a.item_spec) spec, a.item_id, max(a.unit_price) unit_price, sum(a.qty) qty, min(a.needed_date) needed_date, max(a.item_note) note,
      max(a.purchase_qty) manual_purchase_qty, max(a.purchase_unit) manual_purchase_unit,
      count(*) n, min(a.source_type) st, min(a.source_id) sid, min(a.line_id) lid, min(a.code) code,
      coalesce(i.name, min(a.item_id)) name, i.sku, coalesce(i.unit, min(a.unit)) unit,
      -- Need quantities are in the stock unit; the order uses the purchase unit (stock = purchase × factor).
      case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
        and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
      coalesce(nullif(i.purchase_conversion_factor, 0), 1) factor
    from pg_temp.hub_alloc a left join public.items i on i.id = a.item_id
    group by a.item_ord, a.item_id, i.name, i.sku, i.unit, i.purchase_unit, i.purchase_conversion_factor order by a.item_ord
  loop
    v_line_id := 'mh-' || gen_random_uuid();
    -- The buyer may type the purchase quantity (e.g. 100 kg ↔ 10 cây); otherwise the item's default factor applies.
    v_punit := coalesce(v_item.manual_purchase_unit, v_item.purchase_unit, v_item.unit);
    v_qty := case when v_item.manual_purchase_qty is not null then v_item.manual_purchase_qty
      when v_item.purchase_unit is null then v_item.qty else round(v_item.qty / v_item.factor, 6) end;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.item_id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_item.qty / v_qty, 12), 'stockQty', v_item.qty,
      'qty', v_qty, 'unitPrice', v_item.unit_price, 'neededDate', v_item.needed_date, 'note', v_item.note, 'specification', v_item.spec,
      'requestId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.sid end,
      'requestCode', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.code end,
      'requestLineId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.lid end)));
    v_total := v_total + v_qty * v_item.unit_price;
    update pg_temp.hub_alloc set po_line_id = v_line_id where item_ord = v_item.item_ord;
  end loop;
  select array_agg(distinct source_id) into v_request_ids from pg_temp.hub_alloc where source_type = 'material_request';

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, material_request_id, note, created_by_id, approval_request_title, metadata)
    values (v_po_id, v_project, v_site, v_vendor.id, v_vendor.name, public.next_purchase_order_number_v2(), v_items,
      v_total, v_vat, to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', 'from_request', v_mode, 'RECEIVE_TO_STOCK',
      v_warehouse, case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      nullif(btrim(p_input->>'note'), ''), v_actor::text, 'Đơn hàng lập tại Mua hàng',
      jsonb_build_object('channel', 'procurement_hub') || case when v_group then jsonb_build_object('groupOrder', true) else '{}'::jsonb end)
    returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'create', v_actor);
  else
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    -- Đơn chủ động (M2d) chỉ sửa bằng save_procurement_proactive_po_v1 để giữ liên kết nhu cầu đã gắn.
    if v_po.source_mode in ('proactive_project', 'proactive_stock') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PROACTIVE_USE_EDITOR'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po_id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po_id;
    update public.purchase_orders set vendor_id = v_vendor.id, vendor_name = v_vendor.name, items = v_items,
      total_amount = v_total, vat_rate = v_vat, purchase_mode = v_mode, expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''),
      target_warehouse_id = v_warehouse, material_request_id = case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      note = nullif(btrim(p_input->>'note'), ''), project_id = v_project, construction_site_id = v_site,
      metadata = (coalesce(metadata, '{}'::jsonb) - 'groupOrder') || case when v_group then jsonb_build_object('groupOrder', true) else '{}'::jsonb end
    where id = v_po_id returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'update', v_actor);
  end if;

  insert into public.purchase_order_request_lines (project_id, construction_site_id, source_construction_site_id,
    target_warehouse_id, allocation_status, purchase_order_id, purchase_order_line_id, material_request_id,
    material_request_code, request_line_id, item_id, work_boq_item_id, material_budget_item_id, requested_qty,
    ordered_qty, requested_qty_snapshot, ordered_stock_qty_snapshot, actual_received_qty_snapshot, unit)
  select a.project_id, a.site_id, a.site_id, coalesce(v_warehouse, a.warehouse_id), 'open', v_po_id, a.po_line_id, a.source_id,
    a.code, a.line_id, a.item_id,
    (select b.id from public.project_work_boq_items b where b.id = a.work_boq_item_id),
    (select b.id from public.material_budget_items b where b.id = a.material_budget_item_id),
    a.need_qty, a.qty, a.need_qty, a.qty, 0, a.unit
  from pg_temp.hub_alloc a where a.source_type = 'material_request';
  insert into public.procurement_po_plan_links (purchase_order_id, purchase_order_line_id, material_plan_id,
    material_plan_line_id, item_id, ordered_qty)
  select v_po_id, a.po_line_id, a.source_id::uuid, a.line_id::uuid, a.item_id, a.qty
  from pg_temp.hub_alloc a where a.source_type = 'material_plan';
  perform set_config('app.procurement_hub_context', 'off', true);

  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items));
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.procurement_legacy_get_v1(p_source_type text, p_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_doc record;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select d.*, pr.code project_code, pr.name project_name, w.name warehouse_name into v_doc
  from app_private.procurement_inbox_documents() d
  left join public.projects pr on pr.id = d.project_id
  left join public.warehouses w on w.id = d.warehouse_id
  where d.source_type = p_source_type and d.source_id = p_source_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  return jsonb_build_object(
    'sourceType', v_doc.source_type, 'sourceId', v_doc.source_id, 'code', v_doc.code, 'title', v_doc.title,
    'projectId', v_doc.project_id, 'projectCode', v_doc.project_code, 'projectName', v_doc.project_name,
    'warehouseId', v_doc.warehouse_id, 'warehouseName', v_doc.warehouse_name, 'neededDate', v_doc.needed_date,
    'requesterName', v_doc.requester_name, 'approvedAt', v_doc.approved_at, 'approvedByName', v_doc.approved_by_name,
    'constructionSiteId', v_doc.construction_site_id, 'periodType', v_doc.period_type, 'periodStart', v_doc.period_start,
    'closure', case when v_doc.closed_at is null then null else jsonb_build_object(
      'closedAt', v_doc.closed_at, 'reason', v_doc.close_reason, 'closedByName', v_doc.closed_by_name) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('lineId', l.line_id, 'itemId', l.item_id, 'itemName', l.item_name,
        'specification', case when p_source_type = 'material_request' then (select nullif(btrim(x.value->>'specification'), '')
          from public.requests r cross join lateral jsonb_array_elements(r.items) x where r.id = p_source_id and x.value->>'lineId' = l.line_id limit 1) end,
        'sku', l.sku, 'unit', l.unit, 'needQty', l.need_qty, 'orderedQty', l.ordered_qty, 'receivedQty', round(l.received_qty, 3),
        'purchaseUnit', (select i.purchase_unit from public.items i where i.id = l.item_id and nullif(btrim(i.purchase_unit), '') is not null
          and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, ''))) and coalesce(i.purchase_conversion_factor, 0) > 0),
        'purchaseFactor', (select nullif(i.purchase_conversion_factor, 0) from public.items i where i.id = l.item_id),
        'remainingQty', greatest(l.need_qty - l.ordered_qty, 0),
        -- Giao việc theo dòng: null = theo người điều phối (người xử lý của phiếu).
        'assigneeUserId', la.assignee_user_id, 'assigneeName', (select u.name from public.users u where u.id = la.assignee_user_id),
        'stockQty', case when v_doc.warehouse_id is null then null else coalesce((select sum(b.on_hand_qty)
          from public.inventory_balances b where b.material_id = l.item_id and b.warehouse_id = v_doc.warehouse_id), 0) end,
        -- Việc 1 — Cấp từ kho: tồn khả dụng ở kho khác (trừ phiếu chuyển chờ xuất) và phiếu chuyển đã lập cho dòng.
        'otherStock', case when p_source_type = 'material_request' then coalesce((select jsonb_agg(jsonb_build_object('warehouseId', w.id,
            'warehouseName', w.name, 'warehouseType', w.type, 'qty', round(q.qty, 3),
            'transferReady', app_private.material_request_transfer_ready(w.id) and app_private.material_request_transfer_ready(v_doc.warehouse_id)) order by q.qty desc)
          from (select b.warehouse_id, sum(b.on_hand_qty) - coalesce((select sum((y.value->>'quantity')::numeric)
                from public.transactions t cross join lateral jsonb_array_elements(t.items) y
                where t.type = 'TRANSFER'::public.transaction_type and t.status = 'PENDING'::public.transaction_status
                  and t.source_warehouse_id = b.warehouse_id and y.value->>'itemId' = l.item_id), 0) qty
            from public.inventory_balances b where b.material_id = l.item_id and b.warehouse_id is distinct from v_doc.warehouse_id
            group by b.warehouse_id) q
          join public.warehouses w on w.id = q.warehouse_id and not coalesce(w.is_archived, false)
          where q.qty > 0.0005), '[]'::jsonb) end,
        'transfers', case when p_source_type = 'material_request' then coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status,
            'qty', (y.value->>'quantity')::numeric, 'sourceWarehouseName', (select w.name from public.warehouses w where w.id = t.source_warehouse_id)) order by t.date)
          from public.transactions t cross join lateral jsonb_array_elements(t.items) y
          where t.source_type = 'material_request_supply' and t.source_id = p_source_id and y.value->>'requestLineId' = l.line_id), '[]'::jsonb) end,
        'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'poNumber', o.po_number, 'status', o.status,
            'vendorName', o.vendor_name, 'expectedDeliveryDate', o.expected_delivery_date, 'orderedQty', k.qty) order by o.po_number)
          from (select prl.purchase_order_id, sum(prl.ordered_qty) qty from public.purchase_order_request_lines prl
                where p_source_type = 'material_request' and prl.material_request_id = p_source_id and prl.request_line_id = l.line_id group by 1
                union all
                select pl.purchase_order_id, sum(pl.ordered_qty) from public.procurement_po_plan_links pl
                where p_source_type = 'material_plan' and pl.material_plan_line_id::text = l.line_id group by 1) k
          join public.purchase_orders o on o.id = k.purchase_order_id and o.archived_at is null), '[]'::jsonb))
        order by l.item_name)
      from app_private.procurement_inbox_lines() l
      left join public.procurement_inbox_line_assignments la on la.source_type = l.source_type and la.source_id = l.source_id and la.line_id = l.line_id
      where l.source_type = p_source_type and l.source_id = p_source_id), '[]'::jsonb),
    'assignment', (select jsonb_build_object('assigneeUserId', a.assignee_user_id,
        'assigneeName', (select u.name from public.users u where u.id = a.assignee_user_id), 'assignedAt', a.assigned_at, 'note', a.note)
      from public.procurement_inbox_assignments a where a.source_type = p_source_type and a.source_id = p_source_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_procurement_proactive_candidates_v1(p_source_type text, p_source_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_doc record;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select d.* into v_doc from app_private.procurement_inbox_documents() d
  where d.source_type = p_source_type and d.source_id = p_source_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
  if v_doc.closed_at is not null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'needLineId', l.line_id, 'itemId', l.item_id, 'itemName', l.item_name, 'unit', l.unit,
      'remainingQty', round(greatest(l.need_qty - l.ordered_qty, 0), 6),
      'purchaseOrderId', o.id, 'poNumber', o.po_number, 'status', o.status, 'vendorName', o.vendor_name,
      'expectedDeliveryDate', app_private.procurement_date_or_null(o.expected_delivery_date),
      'poLineId', x.value->>'lineId', 'poLineSpecification', x.value->>'specification',
      'lineStockQty', app_private.procurement_po_line_stock_qty(x.value),
      'unallocatedQty', round(app_private.procurement_po_line_stock_qty(x.value) - app_private.procurement_po_line_link_total(o.id, x.value->>'lineId'), 6),
      'reasonCode', o.metadata->'proactive'->>'reasonCode') order by l.item_name, o.po_number)
    from app_private.procurement_inbox_lines() l
    join public.purchase_orders o on o.source_mode = 'proactive_project' and app_private.procurement_po_is_hub(o.metadata)
      and o.archived_at is null and app_private.procurement_proactive_linkable(o.status)
      and o.project_id = v_doc.project_id
      and (v_doc.construction_site_id is null or o.construction_site_id is null or o.construction_site_id = v_doc.construction_site_id)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
    where not exists(select 1 from app_private.request_purchase_po_links rp where rp.purchase_order_id=o.id) and l.source_type = p_source_type and l.source_id = p_source_id
      and x.value->>'itemId' = l.item_id and l.need_qty - l.ordered_qty > 0.0005
      and app_private.procurement_po_line_stock_qty(x.value) - app_private.procurement_po_line_link_total(o.id, x.value->>'lineId') > 0.0005
      and not exists (select 1 from public.purchase_order_request_lines k where p_source_type = 'material_request'
        and k.purchase_order_id = o.id and k.material_request_id = p_source_id and k.request_line_id = l.line_id)
      and not exists (select 1 from public.procurement_po_plan_links k where p_source_type = 'material_plan'
        and k.purchase_order_id = o.id and k.material_plan_line_id::text = l.line_id)), '[]'::jsonb);
end;
$function$;
