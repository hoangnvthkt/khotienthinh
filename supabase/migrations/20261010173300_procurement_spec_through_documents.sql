-- Một mã nhiều quy cách — đi xuyên chứng từ (chủ SP 10/10/2026).
-- "Phiếu tạo ghi gì thì các phiếu duyệt, nhập kho, đối soát cũng giữ nguyên." Mã vật tư vẫn là khóa chính để cộng tồn,
-- so BOQ, ngân sách; mỗi DÒNG chứng từ mang theo tên + quy cách của dòng đơn gốc (ảnh chụp lúc tạo, không đổi theo danh mục):
--   * Phiếu kho (transactions.items) có purchaseOrderLineId: tự thêm itemNameSnapshot + specification của dòng đơn
--     (trigger, mọi đường tạo phiếu: đợt giao PO, gọi hàng HĐ, trả NCC). Sổ kho chép items vào metadata nên cũng có quy cách.
--   * Phiếu giao nhận HĐ (supplier_direct_delivery_lines.specification): lấy từ dòng đơn, không có thì từ dòng giá HĐ;
--     thứ tự dòng theo đơn.
--   * Bảng đối soát (supplier_delivery_statement_lines.specification): chép từ dòng giao nhận.
--   * Giá HĐ khi đối soát: lấy dòng giá cùng quy cách (không lấy nhầm giá quy cách khác của cùng mã);
--     dòng không quy cách giữ cách cũ.
--   * Đối chiếu đợt giao: tên + quy cách theo dòng đơn, giữ thứ tự dòng đơn.
--   * Chi tiết HĐ: mục "Sử dụng" cộng theo mã, kèm khối lượng / giá trị từng quy cách.
-- Bù dữ liệu cũ: phiếu kho, sổ kho, phiếu giao nhận, bảng đối soát đã có.

alter table public.supplier_direct_delivery_lines add column if not exists specification text;
comment on column public.supplier_direct_delivery_lines.specification is 'Quy cách của dòng (ảnh chụp từ dòng đơn / dòng giá HĐ lúc tạo).';
alter table public.supplier_delivery_statement_lines add column if not exists specification text;
comment on column public.supplier_delivery_statement_lines.specification is 'Quy cách của dòng giao nhận được đối soát.';

-- Khóa so sánh quy cách: bỏ khoảng trắng thừa, không phân biệt hoa thường (khớp specKey ở giao diện).
create or replace function app_private.spec_key(p text)
returns text language sql immutable set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')) $$;

-- Giá HĐ theo dòng: cùng quy cách trước, rồi dòng giá không quy cách; không bao giờ lấy giá của quy cách khác.
create or replace function app_private.procurement_contract_line_price(p_contract_id text, p_item_id text, p_spec text, p_date date)
returns table(line_id uuid, unit_price numeric, vat_rate numeric)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.unit_price, l.vat_rate from public.supplier_contract_lines l
  where l.supplier_contract_id = p_contract_id and l.item_id = p_item_id
    and (l.effective_from is null or l.effective_from <= coalesce(p_date, current_date))
    and (l.effective_to is null or l.effective_to >= coalesce(p_date, current_date))
    and (app_private.spec_key(p_spec) = '' or app_private.spec_key(l.specification) in ('', app_private.spec_key(p_spec)))
  order by (app_private.spec_key(l.specification) = app_private.spec_key(p_spec)) desc, (l.specification is null) desc,
    l.effective_from desc nulls last, l.line_no desc
  limit 1;
$$;

-- Tên + quy cách của một dòng đơn (ảnh chụp trên đơn; thiếu tên thì lấy danh mục).
create or replace function app_private.po_line_desc(p_po_id text, p_line_id text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'itemNameSnapshot', coalesce(nullif(btrim(x.value->>'itemNameSnapshot'), ''), nullif(btrim(x.value->>'name'), ''), i.name),
    'specification', nullif(btrim(coalesce(x.value->>'specification', '')), ''))
  from public.purchase_orders po
  cross join lateral jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) x
  left join public.items i on i.id = x.value->>'itemId'
  where po.id = p_po_id and coalesce(x.value->>'lineId', x.value->>'itemId') = p_line_id
  limit 1;
$$;

-- Dòng phiếu kho / sổ kho → tên + quy cách dòng đơn (null nếu không tìm được đơn).
create or replace function app_private.po_line_desc_for_item(p_item jsonb, p_source_type text default null, p_source_id text default null)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select app_private.po_line_desc(coalesce(
      nullif(p_item->>'purchaseOrderId', ''),
      (select dl.purchase_order_id from public.purchase_order_delivery_lines dl
        where dl.id = app_private.uuid_or_null(p_item->>'purchaseOrderDeliveryLineId')),
      (select b.purchase_order_id from public.purchase_order_delivery_batches b
        where b.id = app_private.uuid_or_null(p_item->>'purchaseOrderDeliveryBatchId')),
      case when p_source_type = 'po_delivery_batch' then (select b.purchase_order_id from public.purchase_order_delivery_batches b
        where b.id = app_private.uuid_or_null(p_source_id)) end),
    p_item->>'purchaseOrderLineId');
$$;

create or replace function app_private.trg_snapshot_po_line_desc_on_transaction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare it jsonb; v_desc jsonb; v_out jsonb := '[]'::jsonb; v_changed boolean := false;
begin
  if jsonb_typeof(new.items) is distinct from 'array' or not exists (select 1 from jsonb_array_elements(new.items) x
      where x.value ? 'purchaseOrderLineId' and not x.value ? 'itemNameSnapshot') then
    return new;
  end if;
  for it in select value from jsonb_array_elements(new.items) loop
    if it ? 'purchaseOrderLineId' and not it ? 'itemNameSnapshot' then
      v_desc := app_private.po_line_desc_for_item(it, new.source_type, new.source_id);
      if v_desc is not null then it := it || v_desc; v_changed := true; end if;
    end if;
    v_out := v_out || jsonb_build_array(it);
  end loop;
  if v_changed then new.items := v_out; end if;
  return new;
end;
$$;
drop trigger if exists trg_snapshot_po_line_desc on public.transactions;
create trigger trg_snapshot_po_line_desc before insert or update of items on public.transactions
  for each row execute function app_private.trg_snapshot_po_line_desc_on_transaction();

create or replace function app_private.trg_snapshot_supplier_delivery_line_spec()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.specification := left(nullif(btrim(coalesce(new.specification, '')), ''), 160);
  if new.specification is null then
    new.specification := coalesce(
      (select app_private.po_line_desc(dl.purchase_order_id, dl.purchase_order_line_id)->>'specification'
        from public.purchase_order_delivery_lines dl where dl.id = new.source_delivery_line_id),
      (select nullif(btrim(cl.specification), '') from public.supplier_contract_lines cl where cl.id = new.supplier_contract_line_id));
  end if;
  return new;
end;
$$;
drop trigger if exists trg_snapshot_supplier_delivery_line_spec on public.supplier_direct_delivery_lines;
create trigger trg_snapshot_supplier_delivery_line_spec before insert on public.supplier_direct_delivery_lines
  for each row execute function app_private.trg_snapshot_supplier_delivery_line_spec();

create or replace function app_private.trg_snapshot_statement_line_spec()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(new.specification, '')), '') is null then
    select l.specification into new.specification from public.supplier_direct_delivery_lines l where l.id = new.delivery_line_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_snapshot_statement_line_spec on public.supplier_delivery_statement_lines;
create trigger trg_snapshot_statement_line_spec before insert on public.supplier_delivery_statement_lines
  for each row execute function app_private.trg_snapshot_statement_line_spec();

CREATE OR REPLACE FUNCTION app_private.procurement_contract_receipt_note(p_batch_id uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_b public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_c public.supplier_contracts%rowtype;
  v_note_id uuid;
  v_date date;
begin
  select id into v_note_id from public.supplier_direct_delivery_notes where source_delivery_batch_id = p_batch_id;
  if found then return v_note_id; end if;
  select * into v_b from public.purchase_order_delivery_batches where id = p_batch_id;
  select * into v_po from public.purchase_orders where id = v_b.purchase_order_id;
  select * into v_c from public.supplier_contracts where id = v_po.supplier_contract_id;
  -- Ngày nghiệp vụ: phiếu giao theo HĐ mang ngày hàng về (ngày chứng từ phiếu nhập), không theo lúc bấm nhận.
  v_date := coalesce((select (t.date at time zone 'Asia/Ho_Chi_Minh')::date from public.transactions t where t.id = v_b.wms_transaction_id),
    (v_b.received_at at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_note_id := gen_random_uuid();
  insert into public.supplier_direct_delivery_notes (id, code, project_id, construction_site_id, supplier_contract_id, supplier_contract_code,
    supplier_id, supplier_name_snapshot, delivery_ticket_no, delivery_date, status, created_by, note, source_delivery_batch_id, purchase_order_id)
  values (v_note_id, 'GHHD-' || to_char(v_date, 'YYYYMMDD') || '-' || upper(substr(md5(p_batch_id::text), 1, 6)),
    coalesce(v_b.project_id, v_po.project_id), coalesce(v_b.construction_site_id, v_po.construction_site_id), v_c.id, v_c.code,
    coalesce(v_b.supplier_id, v_po.vendor_id), coalesce(v_b.supplier_name_snapshot, v_po.vendor_name, v_c.supplier_name, 'Nhà cung cấp'),
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(coalesce(v_b.delivery_no, 0)::text, 2, '0'), v_date, 'accepted', p_actor,
    'Nhận theo đơn ' || coalesce(v_po.po_number, v_po.id) || ' đợt ' || coalesce(v_b.delivery_no::text, '')
      || case when v_b.fulfillment_mode = 'DIRECT_CONSUMPTION' then ' · nhập–xuất thẳng' else ' · nhập lưu kho' end,
    p_batch_id, v_po.id);
  insert into public.supplier_direct_delivery_lines (delivery_note_id, supplier_contract_id, supplier_contract_line_id, line_no, item_id,
    sku_snapshot, item_name_snapshot, unit_snapshot, quantity, unit_price, vat_rate, accepted_quantity, status, note,
    wms_flow_mode, target_warehouse_id, wms_import_transaction_id, wms_status, source_delivery_line_id, specification)
  select v_note_id, v_c.id, nullif(x.value->>'contractLineId', '')::uuid, row_number() over (order by x.ord nulls last, l.created_at, l.id), l.item_id,
    i.sku, coalesce(x.value->>'name', i.name, l.item_id), coalesce(l.unit, i.unit), l.accepted_qty, coalesce(l.delivery_unit_price, 0),
    coalesce(v_b.vat_rate, v_po.vat_rate, 0), l.accepted_qty, 'accepted',
    case when coalesce(x.value->>'priceSource', '') = 'manual' then 'Giá tạm trên đơn — chốt khi đối soát' end,
    'none', coalesce(v_b.target_warehouse_id, v_po.target_warehouse_id), v_b.wms_transaction_id, 'not_required', l.id,
    nullif(btrim(coalesce(x.value->>'specification', '')), '')
  from public.purchase_order_delivery_lines l
  left join public.items i on i.id = l.item_id
  left join lateral (select x.value, x.ord from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality x(value, ord)
    where x.value->>'lineId' = l.purchase_order_line_id limit 1) x on true
  where l.delivery_batch_id = p_batch_id and coalesce(l.accepted_qty, 0) > 0;
  return v_note_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.procurement_contract_delivery_lines()
 RETURNS TABLE(contract_id text, note_id uuid, note_code text, ticket_no text, delivery_date date, project_id text, site_id text, line_id uuid, item_id text, item_name text, unit text, qty numeric, wms_ready boolean, statement_id uuid, statement_code text, statement_status text, unit_price numeric, vat_rate numeric, price_source text, amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select n.supplier_contract_id, n.id, n.code, n.delivery_ticket_no, n.delivery_date, n.project_id, n.construction_site_id,
    l.id, l.item_id, l.item_name_snapshot, l.unit_snapshot, coalesce(nullif(l.accepted_quantity, 0), l.quantity),
    app_private.supplier_delivery_line_ready(l.wms_flow_mode, l.wms_import_transaction_id),
    s.id, s.code, s.status,
    coalesce(sl.unit_price_snapshot, cp.unit_price, nullif(l.unit_price, 0)),
    coalesce(sl.vat_rate_snapshot, cp.vat_rate, l.vat_rate, 0),
    case when sl.id is not null then 'statement' when cp.line_id is not null then 'contract'
      when coalesce(l.unit_price, 0) > 0 then 'note' else 'missing' end,
    coalesce(sl.accepted_amount, round(coalesce(nullif(l.accepted_quantity, 0), l.quantity)
      * coalesce(cp.unit_price, nullif(l.unit_price, 0)), 0))
  from public.supplier_direct_delivery_notes n
  join public.supplier_direct_delivery_lines l on l.delivery_note_id = n.id and l.status in ('accepted', 'adjusted')
  left join lateral (
    select x.id, x.unit_price_snapshot, x.vat_rate_snapshot, x.accepted_amount, x.statement_id
    from public.supplier_delivery_statement_lines x join public.supplier_delivery_statements y on y.id = x.statement_id
    where x.delivery_line_id = l.id and y.status in ('draft', 'confirmed', 'posted') limit 1) sl on true
  left join public.supplier_delivery_statements s on s.id = sl.statement_id
  left join lateral app_private.procurement_contract_line_price(n.supplier_contract_id, l.item_id, l.specification, n.delivery_date) cp on true
  where n.supplier_contract_id is not null and n.status not in ('cancelled', 'rejected', 'draft');
$function$
;

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
      select d.*, n.source_delivery_batch_id batch_id, n.purchase_order_id po_id, po.po_number, l.specification spec, l.line_no,
        case when b.id is not null then case b.fulfillment_mode when 'DIRECT_CONSUMPTION' then 'direct' else 'stock' end
          when coalesce(l.wms_flow_mode, 'none') <> 'direct_in_out' then 'none'
          when l.wms_status = 'exported' then 'direct'
          when d.wms_ready then 'stock' else 'pending' end stock_state,
        w.name warehouse_name, pr.code project_code,
        (select cp.unit_price from app_private.procurement_contract_line_price(p_contract_id, d.item_id, l.specification, d.delivery_date) cp) contract_price
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
            'currentPrice', (select cp.unit_price from app_private.procurement_contract_price(p_contract_id, d.item_id, current_date) cp),
            -- Cộng theo mã; từng quy cách vẫn đủ khối lượng + giá trị.
            'specs', coalesce((select jsonb_agg(jsonb_build_object('specification', z2.spec, 'qty', z2.qty, 'value', z2.val) order by z2.spec nulls first)
              from (select d2.spec, sum(d2.qty) qty, sum(d2.amount) val from dl d2 where d2.item_id = d.item_id group by d2.spec) z2), '[]'::jsonb)) u
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
                'name', item_name, 'specification', spec, 'unit', unit, 'qty', qty, 'unitPrice', unit_price, 'vatRate', vat_rate, 'priceSource', price_source,
                'amount', amount, 'wmsReady', wms_ready, 'stockState', stock_state, 'warehouseName', warehouse_name,
                'contractPrice', contract_price, 'statementId', statement_id, 'statementCode', statement_code,
                'statementStatus', statement_status) order by line_no nulls last, item_name) lines
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_procurement_contract_statement_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.supplier_contracts%rowtype;
  v_s public.supplier_delivery_statements%rowtype;
  v_id uuid := nullif(p_input->>'statementId', '')::uuid;
  v_month date := date_trunc('month', nullif(p_input->>'month', '')::date)::date;
  v_scopes integer; v_project text; v_site text; v_n integer;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_c from public.supplier_contracts where id = p_input->>'contractId';
  if not found or coalesce(v_c.status, '') = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  if v_month is null or jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_EMPTY'; end if;

  create temp table if not exists pg_temp.fc_stmt_lines (line_id uuid primary key, unit_price numeric, vat_rate numeric, reason text) on commit drop;
  truncate pg_temp.fc_stmt_lines;
  insert into pg_temp.fc_stmt_lines select (x->>'deliveryLineId')::uuid, (x->>'unitPrice')::numeric, coalesce(nullif(x->>'vatRate', '')::numeric, 0),
    nullif(btrim(x->>'reason'), '')
  from jsonb_array_elements(p_input->'lines') x;
  if exists (select 1 from pg_temp.fc_stmt_lines where unit_price is null or unit_price < 0 or vat_rate not between 0 and 100) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;

  -- Mỗi dòng: giao nhận đã nhận của HĐ trong tháng, đã nhập kho xong (không cần xuất), chưa nằm trong bảng đối soát khác.
  if exists (select 1 from pg_temp.fc_stmt_lines t
    left join app_private.procurement_contract_delivery_lines() d on d.line_id = t.line_id and d.contract_id = v_c.id
    where d.line_id is null or date_trunc('month', d.delivery_date)::date <> v_month or not d.wms_ready
      or (d.statement_id is not null and d.statement_id is distinct from v_id)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_LINE_INVALID'; end if;
  -- Giá khác giá HĐ tại ngày giao: bắt buộc lý do.
  if exists (select 1 from pg_temp.fc_stmt_lines t
    join app_private.procurement_contract_delivery_lines() d on d.line_id = t.line_id
    join public.supplier_direct_delivery_lines sdl on sdl.id = d.line_id
    cross join lateral app_private.procurement_contract_line_price(v_c.id, d.item_id, sdl.specification, d.delivery_date) cp
    where round(t.unit_price, 2) <> round(cp.unit_price, 2) and t.reason is null) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_PRICE_REASON'; end if;
  select count(distinct coalesce(n.project_id, '') || '|' || coalesce(n.construction_site_id, '')), min(n.project_id), min(n.construction_site_id)
  into v_scopes, v_project, v_site
  from pg_temp.fc_stmt_lines t join public.supplier_direct_delivery_lines l on l.id = t.line_id
  join public.supplier_direct_delivery_notes n on n.id = l.delivery_note_id;
  if v_scopes <> 1 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.supplier_delivery_statements (id, code, project_id, construction_site_id, supplier_contract_id, supplier_contract_code,
      supplier_id, supplier_name_snapshot, period_month, statement_date, status, gross_amount, vat_amount, total_amount, metadata, created_by, note)
    values (v_id, 'DCHD-' || to_char(v_month, 'YYYYMM') || '-' || upper(substr(md5(v_id::text), 1, 6)), v_project, v_site, v_c.id, v_c.code,
      v_c.supplier_id, coalesce(nullif(v_c.supplier_name, ''), 'Nhà cung cấp'), v_month, current_date, 'draft', 0, 0, 0,
      jsonb_build_object('channel', 'procurement_hub'), v_actor, nullif(btrim(p_input->>'note'), ''))
    returning * into v_s;
  else
    select * into v_s from public.supplier_delivery_statements where id = v_id and supplier_contract_id = v_c.id for update;
    if not found or v_s.status <> 'draft' then raise exception using errcode = '42501', message = 'PROCUREMENT_STATEMENT_NOT_EDITABLE'; end if;
    delete from public.supplier_delivery_statement_lines where statement_id = v_id;
    update public.supplier_delivery_statements set note = nullif(btrim(p_input->>'note'), ''), statement_date = current_date,
      metadata = metadata - 'returnReason' where id = v_id;
  end if;

  insert into public.supplier_delivery_statement_lines (statement_id, delivery_note_id, delivery_line_id, supplier_contract_id,
    item_name_snapshot, unit_snapshot, accepted_quantity, unit_price_snapshot, vat_rate_snapshot, accepted_amount, vat_amount, total_amount,
    contract_unit_price, price_reason)
  select v_id, l.delivery_note_id, l.id, v_c.id, l.item_name_snapshot, l.unit_snapshot, q.qty, t.unit_price, t.vat_rate,
    round(q.qty * t.unit_price, 0), round(round(q.qty * t.unit_price, 0) * t.vat_rate / 100, 0),
    round(q.qty * t.unit_price, 0) + round(round(q.qty * t.unit_price, 0) * t.vat_rate / 100, 0),
    cp.unit_price, case when cp.unit_price is null or round(t.unit_price, 2) <> round(cp.unit_price, 2) then t.reason end
  from pg_temp.fc_stmt_lines t join public.supplier_direct_delivery_lines l on l.id = t.line_id
  join public.supplier_direct_delivery_notes n on n.id = l.delivery_note_id
  cross join lateral (select coalesce(nullif(l.accepted_quantity, 0), l.quantity) qty) q
  left join lateral app_private.procurement_contract_line_price(v_c.id, l.item_id, l.specification, n.delivery_date) cp on true;
  get diagnostics v_n = row_count;
  update public.supplier_delivery_statements s set
    gross_amount = x.g, vat_amount = x.v, total_amount = x.t
  from (select coalesce(sum(accepted_amount), 0) g, coalesce(sum(vat_amount), 0) v, coalesce(sum(total_amount), 0) t
        from public.supplier_delivery_statement_lines where statement_id = v_id) x
  where s.id = v_id returning s.* into v_s;
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('statementId', v_id, 'code', v_s.code, 'lines', v_n, 'totalAmount', v_s.total_amount);
end;
$function$
;

CREATE OR REPLACE FUNCTION app_private.receipt_recon_item(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_b public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_r public.procurement_receipt_reconciliations%rowtype;
  v_open boolean;
  v_buyer boolean := app_private.receipt_recon_is_buyer();
  v_keeper boolean;
begin
  select * into v_b from public.purchase_order_delivery_batches where id = p_batch_id;
  select * into v_po from public.purchase_orders where id = v_b.purchase_order_id;
  select * into v_tx from public.transactions where id = v_b.wms_transaction_id;
  select * into v_r from public.procurement_receipt_reconciliations
  where delivery_batch_id = p_batch_id and status <> 'voided' order by created_at desc limit 1;
  v_open := exists (select 1 from app_private.receipt_recon_candidates() c where c.batch_id = p_batch_id);
  v_keeper := app_private.receipt_recon_is_keeper(v_tx.target_warehouse_id);
  return jsonb_build_object(
    'deliveryBatchId', v_b.id, 'deliveryNo', v_b.delivery_no, 'batchStatus', v_b.status, 'plannedDate', v_b.planned_delivery_date,
    'purchaseOrderId', v_po.id, 'poNumber', v_po.po_number, 'poStatus', v_po.status, 'purchaseMode', coalesce(v_po.purchase_mode, 'single'),
    'orderDate', nullif(v_po.order_date, ''), 'vendorName', coalesce(v_b.supplier_name_snapshot, v_po.vendor_name),
    'projectId', v_po.project_id, 'projectCode', (select code from public.projects where id = v_po.project_id),
    'warehouseId', v_tx.target_warehouse_id, 'warehouseName', (select name from public.warehouses where id = v_tx.target_warehouse_id),
    'wmsTransactionId', v_tx.id, 'txStatus', v_tx.status::text, 'docDate', coalesce(v_tx.date, v_tx.created_at),
    'ageDays', ((now() at time zone 'Asia/Ho_Chi_Minh')::date - (coalesce(v_tx.date, v_tx.created_at) at time zone 'Asia/Ho_Chi_Minh')::date),
    'createdByName', (select name from public.users where id::text = v_tx.requester_id::text),
    'vatRate', coalesce(v_b.vat_rate, v_po.vat_rate, 0),
    'open', v_open,
    'stocked', v_tx.status::text = 'COMPLETED' and v_open,
    'checked', case when v_open and v_b.quality_approved_by is not null then jsonb_build_object(
      'byName', (select name from public.users where id = v_b.quality_approved_by), 'at', v_b.quality_approved_at) end,
    -- Phần PO chưa nằm trong đợt giao nào (ngoài SL đợt này) — để chọn chờ giao tiếp hay chốt thiếu.
    'poUnscheduled', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(nullif(x.value->>'itemNameSnapshot', ''), nullif(x.value->>'name', ''), i.name),
        'specification', nullif(btrim(coalesce(x.value->>'specification', '')), ''), 'unit', coalesce(nullif(x.value->>'unit', ''), i.unit),
        'qty', round(u.qty, 6)) order by x.ord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality x(value, ord)
      left join public.items i on i.id = x.value->>'itemId'
      cross join lateral (select app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')) qty) u
      where u.qty > 0.000001),
    'otherOpenDeliveries', (select count(*) from public.purchase_order_delivery_batches o
      where o.purchase_order_id = v_po.id and o.id <> v_b.id and o.status = any (app_private.procurement_po_open_delivery_statuses())),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('deliveryLineId', l.id, 'itemId', l.item_id,
        'name', coalesce(pl.name, i.name, l.item_id), 'specification', pl.spec, 'sku', i.sku, 'unit', coalesce(nullif(l.unit, ''), i.unit),
        'plannedQty', coalesce(l.planned_qty, 0), 'unitPrice', coalesce(l.delivery_unit_price, 0),
        'checkedQty', case when v_open and v_b.quality_approved_by is not null then l.accepted_qty end,
        'stockedQty', case when v_open and st.delivery_line_id is not null then round(st.stocked_stock_qty / st.stock_factor, 6) end)
        order by pl.ord nulls last, coalesce(i.name, l.item_id), l.id), '[]'::jsonb)
      from public.purchase_order_delivery_lines l left join public.items i on i.id = l.item_id
      left join lateral (select coalesce(nullif(x.value->>'itemNameSnapshot', ''), nullif(x.value->>'name', '')) name,
          nullif(btrim(coalesce(x.value->>'specification', '')), '') spec, x.ord
        from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality x(value, ord)
        where coalesce(x.value->>'lineId', x.value->>'itemId') = l.purchase_order_line_id limit 1) pl on true
      left join app_private.receipt_recon_stocked(v_b.id) st on st.delivery_line_id = l.id
      where l.delivery_batch_id = v_b.id),
    'recon', case when v_r.id is not null then jsonb_build_object(
      'id', v_r.id, 'status', v_r.status, 'decision', v_r.decision, 'remainder', v_r.remainder, 'arrivalDate', v_r.arrival_date,
      'lines', v_r.lines, 'reason', v_r.reason, 'revision', v_r.revision,
      'buyer', case when v_r.buyer_confirmed_by is not null then jsonb_build_object('id', v_r.buyer_confirmed_by,
        'name', (select name from public.users where id = v_r.buyer_confirmed_by), 'at', v_r.buyer_confirmed_at) end,
      'keeper', case when v_r.keeper_confirmed_by is not null then jsonb_build_object('id', v_r.keeper_confirmed_by,
        'name', (select name from public.users where id = v_r.keeper_confirmed_by), 'at', v_r.keeper_confirmed_at) end,
      'postedByName', (select name from public.users where id = v_r.posted_by), 'postedAt', v_r.posted_at, 'result', v_r.result,
      'rejection', v_r.rejection,
      'updatedByName', (select name from public.users where id = v_r.updated_by), 'updatedAt', v_r.updated_at,
      'events', (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'actorName', u.name, 'at', e.created_at,
          'revision', e.revision, 'before', e.before, 'after', e.after, 'note', e.note) order by e.id), '[]'::jsonb)
        from public.procurement_receipt_reconciliation_events e left join public.users u on u.id = e.actor_id
        where e.reconciliation_id = v_r.id)) end,
    'can', jsonb_build_object(
      'edit', coalesce(v_open and (v_buyer or v_keeper) and coalesce(v_r.status, 'open') = 'open', false),
      'buyer', v_buyer, 'keeper', v_keeper,
      'confirmBuyer', coalesce(v_open and v_buyer and v_r.status = 'open' and v_r.buyer_confirmed_by is null
        and v_r.keeper_confirmed_by is distinct from v_actor, false),
      'confirmKeeper', coalesce(v_open and v_keeper and v_r.status = 'open' and v_r.keeper_confirmed_by is null
        and v_r.buyer_confirmed_by is distinct from v_actor, false),
      'rejectBuyer', coalesce(v_open and v_buyer and v_r.status = 'open' and v_r.buyer_confirmed_by is null
        and v_r.keeper_confirmed_by is not null and v_r.keeper_confirmed_by <> v_actor, false),
      'rejectKeeper', coalesce(v_open and v_keeper and v_r.status = 'open' and v_r.keeper_confirmed_by is null
        and v_r.buyer_confirmed_by is not null and v_r.buyer_confirmed_by <> v_actor, false),
      'post', coalesce(v_open and v_keeper and v_r.status = 'open' and v_r.buyer_confirmed_by is not null
        and v_r.keeper_confirmed_by is not null, false))
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_wms_item_card_v1(p_item_id text, p_warehouse_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (app_private.wms_has_action('wms.inventory.view', p_warehouse_id, p_warehouse_id) or app_private.wms_has_action('wms.inventory.edit', p_warehouse_id, p_warehouse_id)) then
    raise exception using errcode = '42501', message = 'WMS_STOCK_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('date', e.transaction_date, 'code', e.document_code, 'type', e.transaction_type,
        'qtyIn', e.quantity_in, 'qtyOut', e.quantity_out, 'unitPrice', e.unit_price, 'amount', e.amount, 'description', e.description,
        'fromSku', case when e.material_id <> p_item_id then (select m.sku from public.items m where m.id = e.material_id) end,
        'enteredAt', e.created_at, 'event', e.business_event_type, 'specification', nullif(btrim(coalesce(e.metadata->>'specification', '')), ''))
        order by e.transaction_date, e.created_at, e.entry_no)
      from public.inventory_ledger_entries e where e.warehouse_id = p_warehouse_id
        -- V1-3a: kèm lịch sử các mã đã gộp vào mã này
        and (e.material_id = p_item_id or e.material_id in (select m.id from public.items m where m.merged_into_id = p_item_id))), '[]'::jsonb),
    'otherWarehouses', coalesce((select jsonb_agg(s.j order by s.n) from (
        select w.name n, jsonb_build_object('warehouseId', b.warehouse_id, 'warehouseName', w.name, 'qty', round(sum(b.on_hand_qty), 6)) j
        from public.inventory_balances b join public.warehouses w on w.id = b.warehouse_id
        where b.material_id = p_item_id and b.warehouse_id <> p_warehouse_id
          and (app_private.wms_has_action('wms.inventory.view', w.id, w.id) or app_private.wms_has_action('wms.inventory.edit', w.id, w.id))
        group by b.warehouse_id, w.name having sum(b.on_hand_qty) <> 0) s), '[]'::jsonb));
end $function$
;


-- ---------------------------------------------------------------------------
-- Bù dữ liệu cũ (chỉ thêm thông tin mô tả dòng, không đổi số lượng / giá / trạng thái).
-- ---------------------------------------------------------------------------
update public.transactions t set items = t.items
where jsonb_typeof(t.items) = 'array' and exists (select 1 from jsonb_array_elements(t.items) x
  where x.value ? 'purchaseOrderLineId' and not x.value ? 'itemNameSnapshot');

update public.inventory_ledger_entries e set metadata = e.metadata || d.v
from (select e2.id, app_private.po_line_desc_for_item(e2.metadata) v from public.inventory_ledger_entries e2
      where e2.metadata ? 'purchaseOrderLineId' and not e2.metadata ? 'itemNameSnapshot') d
where d.id = e.id and d.v is not null;

update public.supplier_direct_delivery_lines l set specification = s.spec
from (select l2.id, coalesce(
        (select app_private.po_line_desc(dl.purchase_order_id, dl.purchase_order_line_id)->>'specification'
          from public.purchase_order_delivery_lines dl where dl.id = l2.source_delivery_line_id),
        (select nullif(btrim(cl.specification), '') from public.supplier_contract_lines cl where cl.id = l2.supplier_contract_line_id)) spec
      from public.supplier_direct_delivery_lines l2 where l2.specification is null) s
where s.id = l.id and s.spec is not null;

update public.supplier_delivery_statement_lines x set specification = l.specification
from public.supplier_direct_delivery_lines l
where l.id = x.delivery_line_id and x.specification is null and l.specification is not null;

revoke all on function app_private.spec_key(text), app_private.procurement_contract_line_price(text, text, text, date),
  app_private.po_line_desc(text, text), app_private.po_line_desc_for_item(jsonb, text, text),
  app_private.trg_snapshot_po_line_desc_on_transaction(), app_private.trg_snapshot_supplier_delivery_line_spec(),
  app_private.trg_snapshot_statement_line_spec() from public, anon;

notify pgrst, 'reload schema';
