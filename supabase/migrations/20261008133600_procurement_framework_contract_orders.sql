-- Việc 4 — Mua theo Hợp đồng nguyên tắc nằm hẳn trong Mua hàng (chủ SP duyệt mockup fc-v1 + 6 + 4 câu, 03/10/2026).
--
-- * Khai / sửa HĐ nguyên tắc ngay trong Mua hàng (dùng chung bảng supplier_contracts với module Hợp đồng — Đối tác).
-- * Gọi hàng theo HĐ = đơn PO gắn HĐ: giá lấy từ bảng giá HĐ theo ngày giao, không duyệt từng đơn; vượt 100% giá trị HĐ
--   hoặc hạn mức vật tư thì gửi Mua hàng duyệt. Mua hàng hoặc người có quyền "Gọi hàng theo HĐ"
--   (project.material_supplier_delivery.create) của dự án lập được; HĐ không gắn dự án dùng cho nhiều dự án.
-- * Nhận hàng như đơn PO (đợt giao, thủ kho nhận). Nhập lưu kho → tồn tăng; nhập–xuất thẳng → ghi nhận dùng ngay, tồn không đổi.
-- * Nhận xong KHÔNG ghi công nợ: hệ thống ghi một phiếu giao nhận chờ đối soát. Cuối tháng Mua hàng chốt đối soát, kế toán ghi
--   nợ → chi phí vào dự án của kho nhận; Kho Tổng (không thuộc dự án) là hàng tồn, chi phí vào dự án khi chuyển / xuất.
-- * Bỏ ràng buộc phải xuất kho mới đối soát: dòng đã nhập kho xong (hoặc không qua kho) là đối soát được.
-- * Giá đối soát khác giá HĐ bắt buộc ghi lý do.

alter table public.purchase_orders
  add column if not exists supplier_contract_id text references public.supplier_contracts(id) on delete restrict;
create index if not exists purchase_orders_supplier_contract_idx on public.purchase_orders (supplier_contract_id)
  where supplier_contract_id is not null;

alter table public.supplier_direct_delivery_notes
  add column if not exists source_delivery_batch_id uuid references public.purchase_order_delivery_batches(id) on delete restrict,
  add column if not exists purchase_order_id text;
create unique index if not exists supplier_direct_delivery_notes_source_batch_key
  on public.supplier_direct_delivery_notes (source_delivery_batch_id) where source_delivery_batch_id is not null;
alter table public.supplier_direct_delivery_lines
  add column if not exists source_delivery_line_id uuid references public.purchase_order_delivery_lines(id) on delete restrict;
-- Nhận về Kho Tổng (không thuộc dự án): phiếu giao nhận và bảng đối soát cấp công ty.
alter table public.supplier_direct_delivery_notes drop constraint if exists supplier_direct_delivery_notes_check;
alter table public.supplier_direct_delivery_notes add constraint supplier_direct_delivery_notes_check
  check (project_id is not null or construction_site_id is not null or source_delivery_batch_id is not null);
alter table public.supplier_delivery_statements drop constraint if exists supplier_delivery_statements_check;

alter table public.supplier_delivery_statement_lines
  add column if not exists contract_unit_price numeric(18,2),
  add column if not exists price_reason text;

alter table public.procurement_hub_events drop constraint if exists procurement_hub_events_entity_type_check;
alter table public.procurement_hub_events add constraint procurement_hub_events_entity_type_check
  check (entity_type = any (array['purchase_order', 'need', 'hot_purchase', 'settings', 'contract']));

-- ---------------------------------------------------------------------------
-- Hàm phụ
-- ---------------------------------------------------------------------------
-- Dòng phiếu giao HĐ đối soát được khi đã nhập kho xong (phiếu nhập COMPLETED) hoặc không qua kho. Không chờ xuất kho.
create or replace function app_private.supplier_delivery_line_ready(p_mode text, p_import_tx text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_mode, 'none') <> 'direct_in_out'
    or exists (select 1 from public.transactions t where t.id = p_import_tx and t.status = 'COMPLETED'::public.transaction_status);
$$;

-- Người được gọi hàng theo HĐ về kho của dự án / công trường này (Kho Tổng: chỉ Mua hàng).
create or replace function app_private.procurement_contract_can_order(p_project_id text, p_site_id text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_app_user_id() is not null and (app_private.procurement_can('manage')
    or ((p_project_id is not null or p_site_id is not null)
      and app_private.material_flow_has_action_or_legacy(p_project_id, p_site_id, 'project.material_supplier_delivery.create')));
$$;

-- Xem HĐ: Mua hàng, hoặc người gọi hàng được cho dự án của HĐ.
create or replace function app_private.procurement_contract_can_view(p_c public.supplier_contracts)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app_private.procurement_can('view')
    or (p_c.project_id is not null and app_private.procurement_contract_can_order(p_c.project_id, p_c.construction_site_id));
$$;

-- HĐ còn gọi hàng được tại ngày giao.
create or replace function app_private.procurement_contract_assert_orderable(p_c public.supplier_contracts, p_date date)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(p_c.status, '') in ('cancelled', 'completed') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_CLOSED'; end if;
  if (p_c.effective_date is not null and p_date < p_c.effective_date) or (p_c.expiry_date is not null and p_date > p_c.expiry_date) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_EXPIRED'; end if;
end;
$$;

-- Đã dùng của HĐ theo vật tư (trước VAT): phiếu giao cũ ở Dự án + đơn gọi hàng đã gửi / đã duyệt (trừ đơn đang xét).
create or replace function app_private.procurement_contract_used(p_contract_id text, p_except_po text default null)
returns table (item_id text, qty numeric, amount numeric)
language sql stable security definer set search_path = ''
as $$
  select u.item_id, coalesce(sum(u.qty), 0), coalesce(sum(u.amount), 0) from (
    select d.item_id, d.qty, coalesce(d.amount, 0) amount
    from app_private.procurement_contract_delivery_lines() d
    join public.supplier_direct_delivery_notes n on n.id = d.note_id and n.source_delivery_batch_id is null
    where d.contract_id = p_contract_id
    union all
    select x.value->>'itemId', coalesce(nullif(x.value->>'stockQty', '')::numeric, (x.value->>'qty')::numeric),
      (x.value->>'qty')::numeric * coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0)
    from public.purchase_orders po cross join lateral jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) x
    where po.supplier_contract_id = p_contract_id and po.id is distinct from p_except_po and po.archived_at is null
      and po.status in ('sent', 'confirmed', 'in_transit', 'partial', 'delivered', 'closed')
  ) u group by u.item_id;
$$;

-- Đơn gọi hàng có vượt giá trị HĐ / hạn mức vật tư không.
create or replace function app_private.procurement_contract_order_over_limit(p_po public.purchase_orders)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_c public.supplier_contracts%rowtype; v_used numeric; v_this numeric;
begin
  select * into v_c from public.supplier_contracts where id = p_po.supplier_contract_id;
  select coalesce(sum(amount), 0) into v_used from app_private.procurement_contract_used(v_c.id, p_po.id);
  select coalesce(sum((x.value->>'qty')::numeric * coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0)), 0) into v_this
  from jsonb_array_elements(coalesce(p_po.items, '[]'::jsonb)) x;
  if coalesce(v_c.value, 0) > 0 and v_used + v_this > v_c.value + 0.5 then return true; end if;
  return exists (
    select 1 from jsonb_array_elements(coalesce(p_po.items, '[]'::jsonb)) x
    join (select l.item_id, max(l.quantity_limit) ql, max(l.amount_limit) al from public.supplier_contract_lines l
          where l.supplier_contract_id = v_c.id group by l.item_id) lim on lim.item_id = x.value->>'itemId'
    left join app_private.procurement_contract_used(v_c.id, p_po.id) u on u.item_id = x.value->>'itemId'
    where (coalesce(lim.ql, 0) > 0 and coalesce(u.qty, 0) + coalesce(nullif(x.value->>'stockQty', '')::numeric, (x.value->>'qty')::numeric) > lim.ql + 0.0005)
       or (coalesce(lim.al, 0) > 0 and coalesce(u.amount, 0)
           + (x.value->>'qty')::numeric * coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) > lim.al + 0.5));
end;
$$;

-- ---------------------------------------------------------------------------
-- Khai / sửa HĐ nguyên tắc
-- ---------------------------------------------------------------------------
create or replace function public.save_procurement_contract_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_id text := nullif(p_input->>'contractId', '');
  v_c public.supplier_contracts%rowtype;
  v_vendor record; v_project public.projects%rowtype;
  v_code text := nullif(btrim(p_input->>'code'), '');
  v_name text := nullif(btrim(p_input->>'name'), '');
  v_from date := nullif(p_input->>'effectiveDate', '')::date;
  v_to date := nullif(p_input->>'expiryDate', '')::date;
  v_signed date := nullif(p_input->>'signedDate', '')::date;
  v_value numeric := coalesce(nullif(p_input->>'value', '')::numeric, 0);
  v_days integer := nullif(p_input->>'paymentTermDays', '')::integer;
  v_status text := coalesce(nullif(p_input->>'status', ''), 'signed');
  v_actor_name text := (select name from public.users where id = public.current_app_user_id());
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_code is null or v_name is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_FIELDS_REQUIRED'; end if;
  if v_value < 0 or (v_days is not null and v_days not between 0 and 365) or v_status not in ('draft', 'signed', 'completed') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_INVALID'; end if;
  if v_to < v_from then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_DATE_INVALID'; end if;
  select b.id, b.name into v_vendor from public.business_partners b where b.id = nullif(p_input->>'supplierId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;
  if nullif(p_input->>'projectId', '') is not null then
    select * into v_project from public.projects where id = p_input->>'projectId';
    if not found or v_project.status = 'cancelled' then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_REQUIRED'; end if;
  end if;

  if v_id is null then
    v_id := 'sc-' || gen_random_uuid();
    insert into public.supplier_contracts (id, code, name, type, supplier_id, supplier_name, value, payment_terms, payment_term_days,
      signed_date, effective_date, expiry_date, managed_by_user_id, managed_by_name, status, note, project_id, construction_site_id,
      created_at, updated_at)
    values (v_id, v_code, v_name, 'purchase', v_vendor.id, v_vendor.name, v_value, nullif(btrim(p_input->>'paymentTerms'), ''), v_days,
      v_signed, v_from, v_to, v_actor::text, v_actor_name, v_status, nullif(btrim(p_input->>'note'), ''), v_project.id,
      v_project.construction_site_id::text, now(), now())
    returning * into v_c;
  else
    select * into v_c from public.supplier_contracts where id = v_id for update;
    if not found or coalesce(v_c.status, '') = 'cancelled' then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
    -- Đã phát sinh giao nhận / đơn thì không đổi NCC hay dự án (chứng từ cũ đang gắn theo HĐ).
    if (v_c.supplier_id is distinct from v_vendor.id or v_c.project_id is distinct from v_project.id)
      and (exists (select 1 from public.supplier_direct_delivery_notes n where n.supplier_contract_id = v_id)
        or exists (select 1 from public.purchase_orders po where po.supplier_contract_id = v_id)) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_SCOPE_LOCKED'; end if;
    update public.supplier_contracts set code = v_code, name = v_name, supplier_id = v_vendor.id, supplier_name = v_vendor.name,
      value = v_value, payment_terms = nullif(btrim(p_input->>'paymentTerms'), ''), payment_term_days = v_days,
      signed_date = v_signed, effective_date = v_from, expiry_date = v_to, status = v_status,
      note = nullif(btrim(p_input->>'note'), ''), project_id = v_project.id, construction_site_id = v_project.construction_site_id::text,
      updated_at = now()
    where id = v_id returning * into v_c;
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('contract', v_id, case when p_input->>'contractId' is null then 'create' else 'update' end, v_actor,
    jsonb_build_object('code', v_code, 'supplierId', v_vendor.id, 'projectId', v_project.id, 'value', v_value, 'status', v_status,
      'effectiveDate', v_from, 'expiryDate', v_to, 'paymentTermDays', v_days));
  return jsonb_build_object('contractId', v_c.id, 'code', v_c.code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Gọi hàng theo HĐ (đơn PO gắn HĐ)
-- ---------------------------------------------------------------------------
create or replace function public.save_procurement_contract_order_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
    if v_item.id = any (v_seen) then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
    v_seen := v_seen || v_item.id;
    v_qty := nullif(it->>'qty', '')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    select * into v_cp from app_private.procurement_contract_price(v_c.id, v_item.id, v_date);
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
      'specification', nullif(left(btrim(coalesce(it->>'specification', '')), 160), ''))));
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
$$;

-- Gửi đơn gọi hàng: trong hạn mức → duyệt tự động (giá đã chốt ở HĐ) và tạo đợt giao cho thủ kho;
-- vượt giá trị HĐ / hạn mức → gửi người duyệt Mua hàng. Xóa nháp: người lập.
create or replace function public.transition_procurement_contract_order_v1(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_po public.purchase_orders%rowtype;
  v_c public.supplier_contracts%rowtype;
  v_over boolean; v_name text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or v_po.supplier_contract_id is null or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_po.created_by_id is distinct from v_actor::text or v_po.status not in ('draft', 'returned') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_PO_SUBMIT_DENIED'; end if;
  select * into v_c from public.supplier_contracts where id = v_po.supplier_contract_id;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  if v_action = 'delete' then
    if v_po.ever_submitted then raise exception using errcode = '42501', message = 'PROCUREMENT_PO_DELETE_DENIED'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po.id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po.id;
    delete from public.purchase_orders where id = v_po.id;
  elsif v_action = 'send' then
    if not app_private.procurement_contract_can_order(v_po.project_id, v_po.construction_site_id) then
      raise exception using errcode = '42501', message = 'PROCUREMENT_CONTRACT_ORDER_DENIED'; end if;
    perform app_private.procurement_contract_assert_orderable(v_c,
      coalesce(app_private.procurement_date_or_null(v_po.expected_delivery_date), (now() at time zone 'Asia/Ho_Chi_Minh')::date));
    if jsonb_array_length(coalesce(v_po.items, '[]'::jsonb)) = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    if exists (select 1 from jsonb_array_elements(v_po.items) x where coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) <= 0) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_MISSING'; end if;
    v_over := app_private.procurement_contract_order_over_limit(v_po);
    if v_over then
      if v_to is null then raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_LIMIT_APPROVAL'; end if;
      if v_to = v_actor or not app_private.procurement_po_approver_ok(v_to) then
        raise exception using errcode = '22023', message = 'PROCUREMENT_PO_APPROVER_INVALID'; end if;
      select name into v_name from public.users where id = v_to;
      update public.purchase_orders set status = 'sent', submitted_to_user_id = v_to::text, submitted_to_name = v_name,
        submitted_to_permission = 'system.procurement.manage', submission_note = 'Vượt giá trị / hạn mức HĐ ' || v_c.code,
        ever_submitted = true, last_action_by = v_actor::text, last_action_at = now(), metadata = metadata - 'returnReason'
      where id = v_po.id returning * into v_po;
      perform app_private.procurement_notify(v_to, 'Đơn gọi hàng vượt hạn mức HĐ chờ bạn duyệt',
        v_po.po_number || ' · HĐ ' || v_c.code || ' — ' || to_char(v_po.total_amount, 'FM999G999G999G999') || ' đ', v_po.id, 'assigned');
    else
      update public.purchase_orders set status = 'confirmed', approved_total_amount = total_amount, ever_submitted = true,
        last_action_by = v_actor::text, last_action_at = now(), metadata = (metadata - 'returnReason') || jsonb_build_object('autoApproved', true)
      where id = v_po.id returning * into v_po;
      -- Như đơn PO giao một lần: tạo đợt giao + phiếu nhập/QR cho thủ kho kho nhận (SL thực nhận có thể thiếu).
      if coalesce(v_po.purchase_mode, 'single') = 'single' then
        perform app_private.create_delivery_batch_with_wms_qr_core_v2(v_po.id, gen_random_uuid(), v_po.vendor_id, v_po.vendor_name,
          v_po.fulfillment_mode, coalesce(v_po.vat_rate, 0), v_po.target_warehouse_id,
          coalesce(app_private.procurement_date_or_null(v_po.expected_delivery_date), current_date),
          'Đợt giao gọi hàng theo HĐ ' || v_c.code, v_actor,
          (select jsonb_agg(jsonb_build_object('purchaseOrderLineId', x.value->>'lineId',
              'itemId', x.value->>'itemId', 'purchaseQty', (x.value->>'qty')::numeric, 'purchaseUnit', x.value->>'purchaseUnitSnapshot',
              'stockQty', (x.value->>'stockQty')::numeric, 'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unitSnapshot'),
              'purchaseUnitPrice', (x.value->>'unitPrice')::numeric, 'stockUnitPrice', (x.value->>'unitPrice')::numeric))
            from jsonb_array_elements(v_po.items) x));
        select * into v_po from public.purchase_orders where id = v_po.id;
      end if;
    end if;
  else
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID';
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_po.id, v_action, v_actor, jsonb_build_object('kind', 'contract', 'contractId', v_po.supplier_contract_id,
    'overLimit', coalesce(v_over, false), 'approverUserId', v_to));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'status', case when v_action = 'delete' then 'deleted' else v_po.status end,
    'rowVersion', v_po.row_version, 'overLimit', coalesce(v_over, false));
end;
$$;

-- ---------------------------------------------------------------------------
-- Nhận hàng theo HĐ → phiếu giao nhận chờ đối soát (không ghi nợ / chi phí lúc nhận)
-- ---------------------------------------------------------------------------
create or replace function app_private.procurement_contract_receipt_note(p_batch_id uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
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
  v_date := coalesce((v_b.received_at at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
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
    wms_flow_mode, target_warehouse_id, wms_import_transaction_id, wms_status, source_delivery_line_id)
  select v_note_id, v_c.id, nullif(x.value->>'contractLineId', '')::uuid, row_number() over (order by l.created_at, l.id), l.item_id,
    i.sku, coalesce(x.value->>'name', i.name, l.item_id), coalesce(l.unit, i.unit), l.accepted_qty, coalesce(l.delivery_unit_price, 0),
    coalesce(v_b.vat_rate, v_po.vat_rate, 0), l.accepted_qty, 'accepted',
    case when coalesce(x.value->>'priceSource', '') = 'manual' then 'Giá tạm trên đơn — chốt khi đối soát' end,
    'none', coalesce(v_b.target_warehouse_id, v_po.target_warehouse_id), v_b.wms_transaction_id, 'not_required', l.id
  from public.purchase_order_delivery_lines l
  left join public.items i on i.id = l.item_id
  left join lateral (select x.value from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) x
    where x.value->>'lineId' = l.purchase_order_line_id limit 1) x on true
  where l.delivery_batch_id = p_batch_id and coalesce(l.accepted_qty, 0) > 0;
  return v_note_id;
end;
$$;

-- Trả NCC hàng đã nhận theo HĐ: giảm SL chờ đối soát (chưa ghi nợ nên không có công nợ để ghi giảm).
create or replace function app_private.procurement_contract_return_adjust(p_supplier_return_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_return public.purchase_order_supplier_returns%rowtype;
  v_rl record; v_d record; v_left numeric; v_take numeric; v_line public.supplier_direct_delivery_lines%rowtype;
begin
  select * into v_return from public.purchase_order_supplier_returns where id = p_supplier_return_id;
  if exists (select 1 from public.procurement_hub_events where entity_type = 'purchase_order' and entity_id = v_return.purchase_order_id
      and action = 'contract_return' and payload->>'supplierReturnId' = p_supplier_return_id::text) then
    return;
  end if;
  for v_rl in select * from public.purchase_order_supplier_return_lines where supplier_return_id = p_supplier_return_id order by id loop
    v_left := coalesce(v_rl.return_qty, 0);
    for v_d in
      select line.id, line.accepted_qty, line.returned_qty from public.purchase_order_delivery_lines line
      join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
      where line.purchase_order_id = v_return.purchase_order_id and line.purchase_order_line_id = v_rl.purchase_order_line_id
        and batch.status in ('received', 'received_short', 'received_over')
        and coalesce(line.accepted_qty, 0) > coalesce(line.returned_qty, 0)
      order by coalesce(batch.received_at, batch.updated_at, batch.created_at) desc, batch.delivery_no desc, line.id
      for update of line
    loop
      exit when v_left <= 0;
      v_take := least(v_left, coalesce(v_d.accepted_qty, 0) - coalesce(v_d.returned_qty, 0));
      select * into v_line from public.supplier_direct_delivery_lines where source_delivery_line_id = v_d.id for update;
      if found then
        if v_line.statement_id is not null or exists (select 1 from public.supplier_delivery_statement_lines sl
            join public.supplier_delivery_statements s on s.id = sl.statement_id
            where sl.delivery_line_id = v_line.id and s.status in ('draft', 'confirmed', 'posted')) then
          raise exception using errcode = '22023', message = 'PROCUREMENT_CONTRACT_RETURN_IN_STATEMENT'; end if;
        update public.supplier_direct_delivery_lines
        set quantity = greatest(0, quantity - v_take), accepted_quantity = greatest(0, accepted_quantity - v_take),
          accepted_amount = 0, status = case when quantity - v_take <= 0.0005 then 'rejected' else status end,
          rejection_reason = case when quantity - v_take <= 0.0005 then 'Trả NCC toàn bộ' else rejection_reason end,
          note = concat_ws(' · ', note, 'Trả NCC ' || v_take::text)
        where id = v_line.id;
      end if;
      update public.purchase_order_delivery_lines set returned_qty = round(coalesce(returned_qty, 0) + v_take, 6), updated_at = now()
      where id = v_d.id;
      v_left := v_left - v_take;
    end loop;
    if round(v_left, 6) > 0 then
      raise exception 'So luong tra cua dong % vuot so luong delivery da accepted con co the tra.', v_rl.purchase_order_line_id using errcode = '22023';
    end if;
  end loop;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_return.purchase_order_id, 'contract_return', public.current_app_user_id(),
    jsonb_build_object('supplierReturnId', p_supplier_return_id));
end;
$$;

revoke all on function public.save_procurement_contract_v1(jsonb) from public, anon;
revoke all on function public.save_procurement_contract_order_v1(jsonb) from public, anon;
revoke all on function public.transition_procurement_contract_order_v1(jsonb) from public, anon;
grant execute on function public.save_procurement_contract_v1(jsonb) to authenticated;
grant execute on function public.save_procurement_contract_order_v1(jsonb) to authenticated;
grant execute on function public.transition_procurement_contract_order_v1(jsonb) to authenticated;
revoke all on function app_private.supplier_delivery_line_ready(text, text) from public, anon, authenticated;
revoke all on function app_private.procurement_contract_can_order(text, text) from public, anon, authenticated;
revoke all on function app_private.procurement_contract_can_view(public.supplier_contracts) from public, anon, authenticated;
revoke all on function app_private.procurement_contract_assert_orderable(public.supplier_contracts, date) from public, anon, authenticated;
revoke all on function app_private.procurement_contract_used(text, text) from public, anon, authenticated;
revoke all on function app_private.procurement_contract_order_over_limit(public.purchase_orders) from public, anon, authenticated;
revoke all on function app_private.procurement_contract_receipt_note(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.procurement_contract_return_adjust(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hàm vá (sinh từ định nghĩa đang chạy)
-- ---------------------------------------------------------------------------
-- Danh sách HĐ: Mua hàng thấy mọi HĐ; người gọi hàng thấy HĐ của dự án mình (và chỉ thấy số liệu giao nhận, không thấy đối soát).
create or replace function public.list_procurement_contracts_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb); v_buyer boolean := app_private.procurement_can('view');
begin
  if public.current_app_user_id() is null then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with dl as materialized (select * from app_private.procurement_contract_delivery_lines()),
    agg as (
      select contract_id, count(distinct note_id) notes, max(delivery_date) last_date,
        coalesce(sum(amount), 0) delivered_value, count(*) filter (where price_source = 'missing') unpriced,
        count(*) filter (where statement_id is null) open_lines,
        count(*) filter (where statement_id is null and not wms_ready) pending_lines,
        coalesce(sum(amount) filter (where statement_status = 'posted'), 0) posted_value
      from dl group by 1
    ),
    months as (
      select contract_id, jsonb_agg(jsonb_build_object('month', m, 'lines', n, 'value', v, 'unpriced', u) order by m) open_months
      from (select contract_id, date_trunc('month', delivery_date)::date m, count(*) n, coalesce(sum(amount), 0) v,
              count(*) filter (where price_source = 'missing') u
            from dl where statement_id is null group by 1, 2) z group by 1
    ),
    limits as (
      select l.supplier_contract_id contract_id, count(*) filter (where pct >= 80) near_n, count(*) filter (where pct >= 100) over_n
      from (select l.supplier_contract_id, l.item_id,
              greatest(case when max(l.quantity_limit) > 0 then coalesce((select sum(d.qty) from dl d where d.contract_id = l.supplier_contract_id and d.item_id = l.item_id), 0) / max(l.quantity_limit) * 100 end,
                case when max(l.amount_limit) > 0 then coalesce((select sum(d.amount) from dl d where d.contract_id = l.supplier_contract_id and d.item_id = l.item_id), 0) / max(l.amount_limit) * 100 end) pct
            from public.supplier_contract_lines l group by 1, 2) l group by 1
    ),
    orders as (
      select po.supplier_contract_id contract_id, count(*) filter (where po.status in ('sent', 'confirmed', 'in_transit', 'partial')) open_orders,
        count(*) filter (where po.status = 'sent') waiting_orders
      from public.purchase_orders po where po.supplier_contract_id is not null and po.archived_at is null group by 1
    ),
    rows as (
      select c.*, pr.code project_code, pr.name project_name, a.notes, a.last_date, a.delivered_value, a.unpriced, a.open_lines, a.pending_lines,
        a.posted_value, m.open_months, coalesce(li.near_n, 0) limit_near, coalesce(li.over_n, 0) limit_over,
        coalesce(o.open_orders, 0) open_orders, coalesce(o.waiting_orders, 0) waiting_orders,
        (select count(*) from public.supplier_contract_lines x where x.supplier_contract_id = c.id) price_lines,
        (select count(*) from public.supplier_delivery_statements s where s.supplier_contract_id = c.id and s.status in ('draft', 'confirmed')) open_statements,
        coalesce(c.status, '') not in ('cancelled', 'completed') and (c.expiry_date is null or c.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) orderable,
        app_private.procurement_contract_can_order(c.project_id, c.construction_site_id) can_order
      from public.supplier_contracts c
      left join public.projects pr on pr.id = c.project_id
      left join agg a on a.contract_id = c.id
      left join months m on m.contract_id = c.id
      left join limits li on li.contract_id = c.id
      left join orders o on o.contract_id = c.id
      where coalesce(c.status, '') <> 'cancelled'
        and (v_buyer or app_private.procurement_contract_can_view(c))
        and (nullif(v_filter->>'projectId', '') is null or c.project_id = v_filter->>'projectId')
        and (nullif(v_filter->>'search', '') is null or lower(concat_ws(' ', c.code, c.name, c.supplier_name, pr.code))
          like '%' || lower(v_filter->>'search') || '%')
    )
    select jsonb_build_object(
      'canManage', app_private.procurement_can('manage'),
      'isBuyer', v_buyer,
      'contracts', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'code', r.code, 'name', r.name, 'type', r.type, 'status', r.status,
          'supplierId', r.supplier_id, 'supplierName', r.supplier_name, 'projectId', r.project_id, 'projectCode', r.project_code,
          'projectName', r.project_name, 'constructionSiteId', r.construction_site_id, 'value', r.value,
          'signedDate', r.signed_date, 'effectiveDate', r.effective_date, 'expiryDate', r.expiry_date,
          'priceLines', r.price_lines, 'deliveryNotes', coalesce(r.notes, 0), 'lastDeliveryDate', r.last_date,
          'deliveredValue', coalesce(r.delivered_value, 0), 'postedValue', case when v_buyer then coalesce(r.posted_value, 0) end,
          'unpricedLines', coalesce(r.unpriced, 0), 'openLines', coalesce(r.open_lines, 0), 'pendingLines', coalesce(r.pending_lines, 0),
          'openMonths', coalesce(r.open_months, '[]'::jsonb), 'openStatements', case when v_buyer then r.open_statements else 0 end,
          'openOrders', r.open_orders, 'waitingOrders', r.waiting_orders,
          'usagePct', case when coalesce(r.value, 0) > 0 then round(coalesce(r.delivered_value, 0) / r.value * 100, 1) end,
          'limitNear', r.limit_near, 'limitOver', r.limit_over, 'orderable', r.orderable, 'canOrder', r.can_order and r.orderable)
        order by (coalesce(r.open_lines, 0) > 0 or r.open_orders > 0) desc, r.last_date desc nulls last, r.code) from rows r), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_procurement_contract_v1(p_contract_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
          'effectiveFrom', l.effective_from, 'effectiveTo', l.effective_to, 'note', l.note,
          'used', exists (select 1 from public.supplier_direct_delivery_lines d where d.supplier_contract_line_id = l.id))
        order by coalesce(i.name, l.item_name_snapshot), l.effective_from nulls first)
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
          'canPost', s.status = 'confirmed' and app_private.procurement_statement_accountant_ok(v_actor, s.project_id, s.construction_site_id)
            and coalesce(s.metadata->>'confirmedBy', '') <> v_actor::text)
        order by s.period_month desc, s.created_at desc) from public.supplier_delivery_statements s where s.supplier_contract_id = p_contract_id), '[]'::jsonb) end
    )
  );
end;
$$;

-- Bảng đối soát tháng: dòng đã nhận (không chờ xuất kho); giá khác giá HĐ phải ghi lý do.
create or replace function public.save_procurement_contract_statement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
    cross join lateral app_private.procurement_contract_price(v_c.id, d.item_id, d.delivery_date) cp
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
  left join lateral app_private.procurement_contract_price(v_c.id, l.item_id, n.delivery_date) cp on true;
  get diagnostics v_n = row_count;
  update public.supplier_delivery_statements s set
    gross_amount = x.g, vat_amount = x.v, total_amount = x.t
  from (select coalesce(sum(accepted_amount), 0) g, coalesce(sum(vat_amount), 0) v, coalesce(sum(total_amount), 0) t
        from public.supplier_delivery_statement_lines where statement_id = v_id) x
  where s.id = v_id returning s.* into v_s;
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('statementId', v_id, 'code', v_s.code, 'lines', v_n, 'totalAmount', v_s.total_amount);
end;
$$;

CREATE OR REPLACE FUNCTION app_private.procurement_contract_delivery_lines()
returns table (contract_id text, note_id uuid, note_code text, ticket_no text, delivery_date date, project_id text, site_id text,
  line_id uuid, item_id text, item_name text, unit text, qty numeric, wms_ready boolean,
  statement_id uuid, statement_code text, statement_status text,
  unit_price numeric, vat_rate numeric, price_source text, amount numeric)
language sql stable security definer set search_path = '' as $$
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
  left join lateral app_private.procurement_contract_price(n.supplier_contract_id, l.item_id, n.delivery_date) cp on true
  where n.supplier_contract_id is not null and n.status not in ('cancelled', 'rejected', 'draft');
$$;

CREATE OR REPLACE FUNCTION app_private.guard_supplier_delivery_statement_line_wms() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_line public.supplier_direct_delivery_lines%rowtype;
begin
  select * into v_line
  from public.supplier_direct_delivery_lines
  where id = new.delivery_line_id;

  if not found then
    raise exception 'Không tìm thấy dòng giao nhận HĐ NCC %. ', new.delivery_line_id;
  end if;

  if v_line.status not in ('accepted', 'adjusted') then
    raise exception 'Bảng đối soát chỉ được gồm dòng giao nhận accepted/adjusted.';
  end if;

  -- Việc 4: chỉ cần nhập kho xong; xuất kho là việc của kho, không liên quan tiền NCC.
  if not app_private.supplier_delivery_line_ready(v_line.wms_flow_mode, v_line.wms_import_transaction_id) then
    raise exception 'Dòng % chưa nhập kho xong — thủ kho hoàn tất phiếu nhập trước khi đối soát.', v_line.item_name_snapshot;
  end if;

  return new;
end;
$$;

CREATE OR REPLACE FUNCTION public.post_supplier_delivery_statement(p_statement_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS supplier_delivery_statements
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_contract public.supplier_contracts%rowtype;
  v_document public.supplier_payable_documents%rowtype;
  v_gross numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
  v_blocked_item text;
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  -- 01/10/2026: công nợ HĐ nguyên tắc chỉ ghi qua Mua hàng (kế toán dự án) hoặc Admin.
  if not (app_private.procurement_hub_context_enabled() or public.is_admin()) then
    raise exception using errcode = '42501', message = 'SUPPLIER_STATEMENT_MOVED_TO_PROCUREMENT';
  end if;

  if v_statement.status = 'posted' then
    return v_statement;
  end if;

  if v_statement.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post bảng đối soát đã huỷ/đảo.';
  end if;

  select * into v_contract
  from public.supplier_contracts
  where id = v_statement.supplier_contract_id;

  if not found then
    raise exception 'Không tìm thấy HĐ NCC %. ', v_statement.supplier_contract_id;
  end if;

  if v_contract.status = 'cancelled' then
    raise exception 'Không thể ghi nhận phải trả từ HĐ NCC đã huỷ.';
  end if;

  if not exists (
    select 1
    from public.supplier_delivery_statement_lines
    where statement_id = p_statement_id
  ) then
    raise exception 'Bảng đối soát chưa có dòng giao nhận được duyệt.';
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
    where sl.statement_id = p_statement_id
      and dl.status not in ('accepted', 'adjusted')
  ) then
    raise exception 'Bảng đối soát chỉ được gồm dòng giao nhận accepted/adjusted.';
  end if;

  select dl.item_name_snapshot into v_blocked_item
  from public.supplier_delivery_statement_lines sl
  join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
  where sl.statement_id = p_statement_id
    and not app_private.supplier_delivery_line_ready(dl.wms_flow_mode, dl.wms_import_transaction_id)
  limit 1;

  if v_blocked_item is not null then
    raise exception 'Dòng % chưa nhập kho xong — chưa ghi công nợ được.', v_blocked_item;
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_delivery_statement_lines other_sl on other_sl.delivery_line_id = sl.delivery_line_id
    join public.supplier_delivery_statements other_s on other_s.id = other_sl.statement_id
    where sl.statement_id = p_statement_id
      and other_sl.statement_id <> p_statement_id
      and other_s.status in ('draft', 'confirmed', 'posted')
  ) then
    raise exception 'Có dòng giao nhận đã nằm trong bảng đối soát khác.';
  end if;

  select
    coalesce(sum(accepted_amount), 0)::numeric(18,2),
    coalesce(sum(vat_amount), 0)::numeric(18,2),
    coalesce(sum(total_amount), 0)::numeric(18,2)
  into v_gross, v_vat, v_total
  from public.supplier_delivery_statement_lines
  where statement_id = p_statement_id;

  if v_total <= 0 then
    raise exception 'Bảng đối soát chưa có giá trị được duyệt.';
  end if;

  update public.supplier_delivery_statements
  set
    gross_amount = v_gross,
    vat_amount = v_vat,
    total_amount = v_total,
    status = 'posted',
    posted_by = coalesce(p_actor_id, posted_by),
    posted_at = coalesce(posted_at, now()),
    supplier_contract_code = coalesce(supplier_contract_code, v_contract.code),
    supplier_id = coalesce(supplier_id, v_contract.supplier_id),
    supplier_name_snapshot = coalesce(nullif(supplier_name_snapshot, ''), v_contract.supplier_name, 'Nhà cung cấp'),
    updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  update public.supplier_direct_delivery_lines dl
  set statement_id = p_statement_id, updated_at = now()
  from public.supplier_delivery_statement_lines sl
  where sl.statement_id = p_statement_id
    and sl.delivery_line_id = dl.id;

  update public.supplier_direct_delivery_notes note
  set status = 'statemented', updated_at = now()
  where exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    where sl.statement_id = p_statement_id
      and sl.delivery_note_id = note.id
  )
  and not exists (
    select 1
    from public.supplier_direct_delivery_lines dl
    where dl.delivery_note_id = note.id
      and dl.status in ('accepted', 'adjusted')
      and dl.statement_id is null
  );

  v_document := public.sync_supplier_payable_from_delivery_statement(p_statement_id);

  update public.supplier_delivery_statements
  set payable_document_id = v_document.id, updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  return v_statement;
end;
$$;

CREATE OR REPLACE FUNCTION app_private.post_purchase_receipt_finance_v2(p_delivery_batch_id uuid, p_actor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_project_finance_id text;
  v_received_gross numeric(18,2);
  v_committed_gross numeric(18,2);
  v_source_ref text := 'purchase_receipt:' || p_delivery_batch_id::text;
  v_description text;
  v_existing_cost public.project_transactions%rowtype;
  v_existing_ap public.supplier_payable_documents%rowtype;
begin
  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  v_received_gross := round(coalesce(v_batch.accepted_gross_amount, 0), 2);
  if v_received_gross <= 0 then
    return;
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  -- Việc 2: đơn gom ghi công nợ và chi phí cho dự án của công trường nhận (đợt giao).
  v_po.project_id := coalesce(v_batch.project_id, v_po.project_id);
  v_po.construction_site_id := coalesce(v_batch.construction_site_id, v_po.construction_site_id);

  select * into v_tx
  from public.transactions
  where id = v_batch.wms_transaction_id
  for update;
  if not found then
    raise exception 'Khong tim thay WMS cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'Chi ghi nhan chi phi receipt khi WMS da COMPLETED.' using errcode = '22023';
  end if;

  -- Việc 4: đơn gọi hàng theo HĐ nguyên tắc ghi nợ khi chốt đối soát tháng, không ghi lúc nhận.
  if v_po.supplier_contract_id is not null then
    perform app_private.procurement_contract_receipt_note(p_delivery_batch_id, p_actor_user_id);
    return;
  end if;

  select round(coalesce(sum(
    coalesce(line.planned_qty, 0)
    * coalesce(line.delivery_unit_price, 0)
    * (1 + coalesce(v_batch.vat_rate, 0) / 100)
  ), 0), 2)
  into v_committed_gross
  from public.purchase_order_delivery_lines line
  where line.delivery_batch_id = p_delivery_batch_id;

  select id into v_project_finance_id
  from public.project_finances
  where (v_po.project_id is not null and project_id = v_po.project_id)
     or (v_po.construction_site_id is not null and construction_site_id = v_po.construction_site_id)
  limit 1;

  v_description := 'Nhận hàng NCC '
    || coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp')
    || ' - '
    || coalesce(v_po.po_number, v_po.id)
    || ' - đợt '
    || coalesce(v_batch.delivery_no::text, p_delivery_batch_id::text);

  select * into v_existing_cost
  from public.project_transactions
  where source_ref = v_source_ref
  for update;
  if found then
    if round(coalesce(v_existing_cost.amount, 0), 2) <> v_received_gross then
      raise exception 'Anomaly: chi phi receipt da ton tai voi gia tri khac.' using errcode = 'P0001';
    end if;
  else
    insert into public.project_transactions (
      id, "projectFinanceId", "constructionSiteId",
      project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source,
      "sourceRef", source_ref, contract_cost_item_id,
      cost_classification_status, counterparty_partner_id,
      counterparty_name, attachments, "createdBy", "createdAt"
    )
    values (
      'purchase-receipt-' || p_delivery_batch_id::text,
      coalesce(v_project_finance_id, ''),
      coalesce(v_po.construction_site_id, ''),
      v_po.project_id,
      nullif(v_project_finance_id, ''),
      v_po.construction_site_id,
      'expense',
      'materials',
      v_received_gross,
      v_description,
      current_date::text,
      'workflow',
      v_source_ref,
      v_source_ref,
      null,
      'auto',
      null,
      coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
      coalesce(v_tx.attachments, '[]'::jsonb),
      p_actor_user_id::text,
      now()
    )
    on conflict (source_ref) do nothing;
  end if;

  select * into v_existing_ap
  from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt'
    and source_id = p_delivery_batch_id::text
  for update;
  if found then
    if round(coalesce(v_existing_ap.recognized_amount, 0), 2) <> v_received_gross
       or round(coalesce(v_existing_ap.committed_amount, 0), 2) <> v_committed_gross then
      raise exception 'Anomaly: AP receipt da ton tai voi gia tri khac.' using errcode = 'P0001';
    end if;
    return;
  end if;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    metadata, created_by
  )
  values (
    'AP-REC-' || replace(p_delivery_batch_id::text, '-', ''),
    'purchase_delivery_receipt',
    p_delivery_batch_id::text,
    v_po.project_id,
    v_po.construction_site_id,
    v_batch.supplier_id,
    coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(coalesce(v_batch.delivery_no, 0)::text, 2, '0'),
    current_date,
    null,
    v_committed_gross,
    v_received_gross,
    0,
    'open',
    'ap_receipt_' || replace(p_delivery_batch_id::text, '-', ''),
    jsonb_build_object(
      'purchaseOrderId', v_po.id,
      'purchaseOrderNo', v_po.po_number,
      'deliveryBatchId', p_delivery_batch_id,
      'wmsTransactionId', v_tx.id,
      'fulfillmentMode', v_batch.fulfillment_mode,
      'sourceRef', v_source_ref
    ),
    p_actor_user_id
  )
  on conflict (source_type, source_id) do nothing;
end;
$$;

CREATE OR REPLACE FUNCTION app_private.post_purchase_receipt_return_finance_v2(p_supplier_return_id uuid, p_actor_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_return public.purchase_order_supplier_returns%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_has_v2_receipt boolean := false;
  v_existing_cost public.project_transactions%rowtype;
  v_project_finance_id text;
  v_source_ref text := 'purchase_receipt_return:' || p_supplier_return_id::text;
  v_description text;
  v_total_gross numeric(18,2) := 0;
  v_return_line record;
  v_delivery record;
  v_remaining_qty numeric;
  v_take_qty numeric;
  v_line_gross numeric(18,2);
  v_ap public.supplier_payable_documents%rowtype;
  v_credit_key text;
  v_existing_credit jsonb;
begin
  select * into v_return
  from public.purchase_order_supplier_returns
  where id = p_supplier_return_id
  for update;
  if not found then
    raise exception 'Khong tim thay phieu tra NCC %.', p_supplier_return_id using errcode = '22023';
  end if;
  if v_return.status <> 'completed' then
    raise exception 'Chi post finance cho phieu tra NCC da completed.' using errcode = '22023';
  end if;

  select * into v_existing_cost
  from public.project_transactions
  where source_ref = v_source_ref
  for update;
  if found then
    return;
  end if;

  select * into v_tx
  from public.transactions
  where id = v_return.transaction_id
  for update;
  if not found or v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'Chi post finance tra NCC khi WMS EXPORT da COMPLETED.' using errcode = '22023';
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_return.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay PO cua phieu tra NCC %.', p_supplier_return_id using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.purchase_order_delivery_lines line
    join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
    where line.purchase_order_id = v_return.purchase_order_id
      and batch.status in ('received', 'received_short', 'received_over')
      and coalesce(line.accepted_qty, 0) > 0
  ) into v_has_v2_receipt;

  if not v_has_v2_receipt then
    return;
  end if;

  -- Việc 4: đơn theo HĐ chưa ghi nợ lúc nhận → chỉ giảm SL chờ đối soát.
  if v_po.supplier_contract_id is not null then
    perform app_private.procurement_contract_return_adjust(p_supplier_return_id);
    return;
  end if;

  select id into v_project_finance_id
  from public.project_finances
  where (v_po.project_id is not null and project_id = v_po.project_id)
     or (v_po.construction_site_id is not null and construction_site_id = v_po.construction_site_id)
  limit 1;

  for v_return_line in
    select *
    from public.purchase_order_supplier_return_lines
    where supplier_return_id = p_supplier_return_id
    order by id
  loop
    v_remaining_qty := coalesce(v_return_line.return_qty, 0);
    if v_remaining_qty <= 0 then
      raise exception 'Dong tra NCC khong hop le.' using errcode = '22023';
    end if;

    for v_delivery in
      select
        line.id as delivery_line_id,
        line.delivery_batch_id,
        line.purchase_order_line_id,
        line.accepted_qty,
        line.returned_qty,
        line.delivery_unit_price,
        batch.delivery_no,
        batch.vat_rate,
        batch.received_at,
        batch.updated_at,
        batch.created_at
      from public.purchase_order_delivery_lines line
      join public.purchase_order_delivery_batches batch on batch.id = line.delivery_batch_id
      where line.purchase_order_id = v_return.purchase_order_id
        and line.purchase_order_line_id = v_return_line.purchase_order_line_id
        and batch.status in ('received', 'received_short', 'received_over')
        and coalesce(line.accepted_qty, 0) > coalesce(line.returned_qty, 0)
      order by coalesce(batch.received_at, batch.updated_at, batch.created_at), batch.delivery_no, line.id
      for update of line
    loop
      exit when v_remaining_qty <= 0;

      v_take_qty := least(
        v_remaining_qty,
        greatest(0, coalesce(v_delivery.accepted_qty, 0) - coalesce(v_delivery.returned_qty, 0))
      );
      if v_take_qty <= 0 then
        continue;
      end if;

      update public.purchase_order_delivery_lines
      set returned_qty = round(coalesce(returned_qty, 0) + v_take_qty, 6),
          updated_at = now()
      where id = v_delivery.delivery_line_id;

      v_line_gross := round(
        v_take_qty
        * coalesce(v_delivery.delivery_unit_price, 0)
        * (1 + coalesce(v_delivery.vat_rate, 0) / 100),
        2
      );
      v_total_gross := round(v_total_gross + v_line_gross, 2);

      select * into v_ap
      from public.supplier_payable_documents
      where source_type = 'purchase_delivery_receipt'
        and source_id = v_delivery.delivery_batch_id::text
      for update;
      if not found then
        raise exception 'Anomaly: AP receipt cua Dot giao % chua duoc ghi nhan.', v_delivery.delivery_batch_id
          using errcode = 'P0001';
      end if;
      if v_ap.status in ('cancelled', 'reversed') then
        raise exception 'Anomaly: khong the credit AP receipt da huy/dao.' using errcode = 'P0001';
      end if;

      v_credit_key := p_supplier_return_id::text || ':' || v_delivery.delivery_line_id::text;
      v_existing_credit := coalesce(v_ap.metadata, '{}'::jsonb)
        -> 'purchaseReceiptReturnCredits'
        -> v_credit_key;

      if v_existing_credit is not null then
        if round(coalesce(nullif(v_existing_credit ->> 'amount', '')::numeric, 0), 2) <> v_line_gross then
          raise exception 'Anomaly: AP return credit da ton tai voi gia tri khac.' using errcode = 'P0001';
        end if;
      else
        update public.supplier_payable_documents
        set credit_amount = round(coalesce(credit_amount, 0) + v_line_gross, 2),
            status = case
              when round(coalesce(recognized_amount, 0) - (coalesce(credit_amount, 0) + v_line_gross), 2) <= 0 then 'paid'
              when coalesce(credit_amount, 0) + v_line_gross > 0 then 'partial'
              else status
            end,
            metadata = jsonb_set(
              coalesce(metadata, '{}'::jsonb),
              '{purchaseReceiptReturnCredits}',
              coalesce(metadata -> 'purchaseReceiptReturnCredits', '{}'::jsonb)
                || jsonb_build_object(
                  v_credit_key,
                  jsonb_build_object(
                    'sourceType', 'supplier_return_credit',
                    'sourceId', p_supplier_return_id::text,
                    'sourceRef', v_source_ref,
                    'deliveryBatchId', v_delivery.delivery_batch_id::text,
                    'deliveryLineId', v_delivery.delivery_line_id::text,
                    'purchaseOrderLineId', v_return_line.purchase_order_line_id,
                    'returnQty', v_take_qty,
                    'amount', v_line_gross
                  )
                ),
              true
            ),
            updated_at = now()
        where id = v_ap.id;
      end if;

      v_remaining_qty := v_remaining_qty - v_take_qty;
    end loop;

    if round(v_remaining_qty, 6) > 0 then
      raise exception 'So luong tra cua dong % vuot so luong delivery da accepted con co the tra.',
        v_return_line.purchase_order_line_id using errcode = '22023';
    end if;
  end loop;

  if v_total_gross <= 0 then
    return;
  end if;

  v_description := 'Return to supplier '
    || coalesce(v_return.return_no, p_supplier_return_id::text)
    || ' - '
    || coalesce(v_po.po_number, v_po.id);

  insert into public.project_transactions (
    id, "projectFinanceId", "constructionSiteId",
    project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source,
    "sourceRef", source_ref, contract_cost_item_id,
    cost_classification_status, counterparty_partner_id,
    counterparty_name, attachments, "createdBy", "createdAt"
  )
  values (
    'purchase-return-cost-' || p_supplier_return_id::text,
    coalesce(v_project_finance_id, ''),
    coalesce(v_po.construction_site_id, ''),
    v_po.project_id,
    nullif(v_project_finance_id, ''),
    v_po.construction_site_id,
    'expense',
    'materials',
    -v_total_gross,
    v_description,
    current_date::text,
    'workflow',
    v_source_ref,
    v_source_ref,
    null,
    'auto',
    null,
    coalesce(v_po.vendor_name, v_po.vendor_id, 'Nha cung cap'),
    coalesce(v_tx.attachments, '[]'::jsonb),
    coalesce(p_actor_user_id, v_return.completed_by, v_return.created_by)::text,
    now()
  )
  on conflict (source_ref) do nothing;
end;
$$;

CREATE OR REPLACE FUNCTION public.post_receipt_reconciliation_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := public.current_app_user_id();
  v_r public.procurement_receipt_reconciliations%rowtype;
  v_po public.purchase_orders%rowtype;
  v_b public.purchase_order_delivery_batches%rowtype;
  v_tx public.transactions%rowtype;
  v_l public.purchase_order_delivery_lines%rowtype;
  v_line jsonb;
  v_qty numeric;
  v_factor numeric;
  v_stocked numeric;
  v_is_stocked boolean;
  v_items jsonb := '[]'::jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_extra_tx text;
  v_arrival_ts timestamptz;
  v_gross numeric := 0;
  v_planned_total numeric := 0;
  v_accepted_total numeric := 0;
  v_next_items jsonb;
  v_delivered boolean;
  v_before jsonb;
  v_ap_id uuid;
  v_short numeric;
  v_closed boolean := false;
  v_note text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_r from public.procurement_receipt_reconciliations
  where id = nullif(p_input->>'reconciliationId', '')::uuid for update;
  if v_r.id is null or v_r.status <> 'open' then raise exception using errcode = 'PT404', message = 'RECEIPT_RECON_NOT_FOUND'; end if;
  if v_r.revision is distinct from nullif(p_input->>'revision', '')::integer then
    raise exception using errcode = '40001', message = 'RECEIPT_RECON_REVISION_CONFLICT'; end if;
  if v_r.buyer_confirmed_by is null or v_r.keeper_confirmed_by is null then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_NOT_CONFIRMED'; end if;
  if not app_private.receipt_recon_is_keeper(v_r.warehouse_id) then
    raise exception using errcode = '42501', message = 'RECEIPT_RECON_POST_DENIED'; end if;

  select * into v_po from public.purchase_orders where id = v_r.purchase_order_id for update;
  select * into v_b from public.purchase_order_delivery_batches where id = v_r.delivery_batch_id for update;
  select * into v_tx from public.transactions where id = v_b.wms_transaction_id for update;
  if v_b.wms_transaction_id is distinct from v_r.wms_transaction_id
     or v_b.status not in ('wms_pending', 'receiving', 'quality_approved')
     or v_tx.status::text not in ('PENDING', 'APPROVED', 'COMPLETED')
     or v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_BATCH_CLOSED'; end if;
  v_is_stocked := v_tx.status::text = 'COMPLETED';
  if v_is_stocked and v_r.decision = 'none' then
    raise exception using errcode = '22023', message = 'RECEIPT_RECON_BELOW_STOCKED'; end if;
  v_before := jsonb_build_object('batchStatus', v_b.status, 'txStatus', v_tx.status::text, 'txDate', v_tx.date, 'poStatus', v_po.status,
    'qualityApprovedBy', v_b.quality_approved_by, 'acceptedGross', v_b.accepted_gross_amount,
    'lines', (select jsonb_agg(jsonb_build_object('deliveryLineId', l.id, 'acceptedQty', l.accepted_qty) order by l.id)
      from public.purchase_order_delivery_lines l where l.delivery_batch_id = v_b.id));
  v_note := 'Đối chiếu nhận hàng: ' || case v_r.decision when 'none' then 'hàng không về — ' || v_r.reason
    else 'về ' || to_char(v_r.arrival_date, 'DD/MM/YYYY') || coalesce(' — ' || v_r.reason, '') end;
  v_arrival_ts := (v_r.arrival_date + time '12:00') at time zone 'Asia/Ho_Chi_Minh';

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);

  if v_r.decision = 'none' then
    update public.purchase_order_delivery_batches
    set status = 'cancelled', note = concat_ws(E'\n', nullif(note, ''), v_note), updated_at = now()
    where id = v_b.id;
    update public.purchase_order_delivery_lines set accepted_qty = 0, accepted_stock_qty = 0
    where delivery_batch_id = v_b.id and coalesce(accepted_qty, 0) <> 0;
    update public.transactions
    set status = 'CANCELLED'::public.transaction_status, note = concat_ws(E'\n', nullif(note, ''), v_note), updated_by = v_actor
    where id = v_tx.id;
  else
    if (select count(*) from public.purchase_order_delivery_lines where delivery_batch_id = v_b.id) <> jsonb_array_length(v_r.lines) then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_CHANGED'; end if;
    for v_line in select value from jsonb_array_elements(v_r.lines) loop
      select * into v_l from public.purchase_order_delivery_lines
      where id = (v_line->>'deliveryLineId')::uuid and delivery_batch_id = v_b.id for update;
      if v_l.id is null then raise exception using errcode = '22023', message = 'RECEIPT_RECON_LINES_CHANGED'; end if;
      v_qty := (v_line->>'receivedQty')::numeric;
      v_factor := case when coalesce(v_l.planned_qty, 0) > 0 and coalesce(v_l.stock_planned_qty, 0) > 0
        then v_l.stock_planned_qty / v_l.planned_qty else 1 end;
      update public.purchase_order_delivery_lines
      set accepted_qty = v_qty, accepted_stock_qty = round(v_qty * v_factor, 6), updated_at = now()
      where id = v_l.id;
      v_gross := v_gross + v_qty * coalesce(v_l.delivery_unit_price, 0) * (1 + coalesce(v_b.vat_rate, 0) / 100);
      v_planned_total := v_planned_total + coalesce(v_l.planned_qty, 0);
      v_accepted_total := v_accepted_total + v_qty;
      v_line := jsonb_build_object(
        'itemId', v_l.item_id, 'quantity', round(v_qty * v_factor, 6),
        'orderedQty', coalesce(v_l.stock_planned_qty, v_l.planned_qty, 0),
        'price', case when v_factor > 0 then coalesce(v_l.delivery_unit_price, 0) / v_factor else coalesce(v_l.delivery_unit_price, 0) end,
        'accountingQty', v_qty, 'accountingUnit', coalesce(v_l.unit, v_l.stock_unit, ''),
        'accountingPrice', coalesce(v_l.delivery_unit_price, 0),
        'varianceQty', v_qty - coalesce(v_l.planned_qty, 0),
        'varianceReason', case when v_qty <> coalesce(v_l.planned_qty, 0) then v_r.reason end,
        'purchaseOrderLineId', v_l.purchase_order_line_id, 'purchaseOrderDeliveryBatchId', v_b.id,
        'purchaseOrderDeliveryLineId', v_l.id, 'fulfillmentMode', coalesce(v_b.fulfillment_mode, 'RECEIVE_TO_STOCK'));
      v_items := v_items || jsonb_build_array(v_line);
      if v_is_stocked then
        select st.stocked_stock_qty into v_stocked from app_private.receipt_recon_stocked(v_b.id) st where st.delivery_line_id = v_l.id;
        if round(v_qty * v_factor, 6) < coalesce(v_stocked, 0) - 0.000001 then
          raise exception using errcode = '22023', message = 'RECEIPT_RECON_BELOW_STOCKED'; end if;
        if round(v_qty * v_factor, 6) > coalesce(v_stocked, 0) + 0.000001 then
          v_extra := v_extra || jsonb_build_array(v_line || jsonb_build_object('quantity', round(v_qty * v_factor - coalesce(v_stocked, 0), 6),
            'accountingQty', round(v_qty - coalesce(v_stocked, 0) / v_factor, 6), 'reconciliationId', v_r.id));
        end if;
      end if;
    end loop;

    if not v_is_stocked then
      -- Kiểm SL/CL theo số đã chốt rồi nhập kho — một lần, theo ngày hàng về.
      update public.transactions
      set items = v_items, status = 'APPROVED'::public.transaction_status, date = v_arrival_ts,
        approver_id = v_r.keeper_confirmed_by, approved_at = now(), note = concat_ws(E'\n', nullif(note, ''), v_note)
      where id = v_tx.id;
      update public.purchase_order_delivery_batches
      set status = 'quality_approved', quality_result = case when v_r.decision = 'full' then 'passed' else 'partial' end,
        variance_reason = case when v_r.decision = 'partial' then v_r.reason end,
        quality_approved_by = v_r.keeper_confirmed_by, quality_approved_at = now(),
        accepted_gross_amount = round(v_gross, 2), updated_at = now()
      where id = v_b.id;
      perform app_private.finalize_purchase_receipt_v2(v_b.id, v_tx.id, v_actor);
    else
      -- Kho đã nhập phiếu gốc: chỉ nhập bổ sung phần còn thiếu, phiếu riêng theo ngày hàng về.
      if jsonb_array_length(v_extra) > 0 then
        v_extra_tx := 'tx-recon-' || replace(v_r.id::text, '-', '');
        for v_line in select value from jsonb_array_elements(v_extra) loop
          perform public.apply_stock_change(v_line->>'itemId', v_tx.target_warehouse_id, (v_line->>'quantity')::numeric);
        end loop;
        insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, approver_id, approved_at, status, note,
          source_type, source_id, business_event_type, business_event_reason, related_request_id)
        values (v_extra_tx, 'IMPORT', v_arrival_ts, v_extra, v_tx.target_warehouse_id, v_actor, v_r.keeper_confirmed_by, now(),
          'COMPLETED', coalesce(v_po.po_number, v_po.id) || ' - đợt ' || coalesce(v_b.delivery_no::text, '') || ' — nhập bổ sung phần kho chưa ghi. ' || v_note,
          'receipt_reconciliation', v_r.id::text, 'request_po_receipt', 'Đối chiếu nhận hàng: nhập bổ sung', v_tx.related_request_id);
      end if;
      update public.purchase_order_delivery_batches
      set quality_result = case when v_r.decision = 'full' then 'passed' else 'partial' end,
        variance_reason = case when v_r.decision = 'partial' then v_r.reason end,
        quality_approved_by = coalesce(quality_approved_by, v_r.keeper_confirmed_by), quality_approved_at = coalesce(quality_approved_at, now()),
        accepted_gross_amount = round(v_gross, 2), updated_at = now()
      where id = v_b.id;
      -- Ghi nhận PO như finalize (không cộng kho lần nữa); công nợ tự ghi khi đợt chuyển sang đã nhận.
      update public.purchase_order_delivery_batches
      set status = case when v_accepted_total > v_planned_total then 'received_over'
          when v_accepted_total < v_planned_total then 'received_short' else 'received' end,
        received_by = v_actor, received_at = now(), updated_at = now()
      where id = v_b.id;
      with receipt_by_line as (
        select purchase_order_line_id, sum(coalesce(accepted_qty, 0)) accepted
        from public.purchase_order_delivery_lines where delivery_batch_id = v_b.id group by purchase_order_line_id
      ), rows as (
        select case when coalesce(r.accepted, 0) > 0
            then jsonb_set(it.value, '{receivedQty}', to_jsonb(coalesce(nullif(it.value->>'receivedQty', '')::numeric, 0) + r.accepted), true)
            else it.value end item, it.ordinality
        from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality it(value, ordinality)
        left join receipt_by_line r on r.purchase_order_line_id = coalesce(it.value->>'lineId', it.value->>'line_id', it.value->>'itemId', it.value->>'item_id')
      )
      select coalesce(jsonb_agg(item order by ordinality), '[]'::jsonb) into v_next_items from rows;
      select coalesce(bool_and(coalesce(nullif(x->>'receivedQty', '')::numeric, 0) >= coalesce(nullif(x->>'qty', '')::numeric, 0)), false)
      into v_delivered from jsonb_array_elements(v_next_items) x;
      update public.purchase_orders
      set items = v_next_items, status = case when v_delivered then 'delivered' else 'partial' end,
        received_transaction_ids = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(
          coalesce(received_transaction_ids, '[]'::jsonb) || jsonb_build_array(v_tx.id) || coalesce(to_jsonb(v_extra_tx), '[]'::jsonb)) x
          where jsonb_typeof(x) = 'string')
      where id = v_po.id;
      update public.material_request_fulfillment_lines mfl
      set received_qty = coalesce(line.accepted_stock_qty, line.accepted_qty, 0), updated_at = now()
      from public.purchase_order_delivery_lines line
      where mfl.po_delivery_line_id = line.id and line.delivery_batch_id = v_b.id;
    end if;

    -- Chứng từ tài chính theo ngày hàng về; công nợ gắn nhãn nguồn để kế toán đối chiếu hóa đơn/thanh toán.
    update public.supplier_payable_documents
    set document_date = v_r.arrival_date,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('origin', 'receipt_reconciliation',
        'reconciliationId', v_r.id, 'arrivalDate', v_r.arrival_date, 'recordedAt', now())
    where source_type = 'purchase_delivery_receipt' and source_id = v_b.id::text
    returning id into v_ap_id;
    update public.project_transactions set date = v_r.arrival_date::text
    where source_ref = 'purchase_receipt:' || v_b.id::text;
    update public.supplier_direct_delivery_notes set delivery_date = v_r.arrival_date
    where source_delivery_batch_id = v_b.id and status <> 'statemented';
    update public.purchase_orders set actual_delivery_date = v_r.arrival_date::text
    where id = v_po.id and status = 'delivered';
  end if;

  if v_r.remainder = 'close' then
    if app_private.procurement_po_has_open_delivery(v_po.id) then
      raise exception using errcode = '22023', message = 'RECEIPT_RECON_REMAINDER_OPEN'; end if;
    select * into v_po from public.purchase_orders where id = v_po.id for update;
    if v_po.status in ('confirmed', 'in_transit', 'partial') then
      -- Như "Kết thúc thiếu" của Mua hàng: nhu cầu chỉ giữ phần thực nhận, phần còn lại về Cần mua.
      select coalesce(sum(greatest(q.ordered_qty - app_private.procurement_link_received_v2(v_po.id, v_po.items, q.line_id, q.ordered_qty, q.id), 0)), 0)
      into v_short from (
        select id, purchase_order_line_id line_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po.id
        union all select id, purchase_order_line_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po.id) q;
      update public.purchase_order_request_lines l
      set ordered_qty = r.received, ordered_stock_qty_snapshot = r.received
      from (select id, round(app_private.procurement_link_received_v2(v_po.id, v_po.items, purchase_order_line_id, ordered_qty, id), 6) received
            from public.purchase_order_request_lines where purchase_order_id = v_po.id) r
      where l.id = r.id;
      delete from public.procurement_po_plan_links k
      where k.purchase_order_id = v_po.id and app_private.procurement_link_received_v2(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty, k.id) <= 0;
      update public.procurement_po_plan_links k
      set ordered_qty = round(app_private.procurement_link_received_v2(v_po.id, v_po.items, k.purchase_order_line_id, k.ordered_qty, k.id), 6)
      where k.purchase_order_id = v_po.id;
      update public.purchase_orders
      set status = 'closed', closed_need_qty = coalesce(closed_need_qty, 0) + v_short,
        last_action_by = v_actor::text, last_action_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('shortClose', jsonb_build_object('reason', v_r.reason, 'returnToNeed', true,
          'shortStockQty', round(v_short, 3), 'at', now(), 'by', (select name from public.users where id = v_actor),
          'via', 'receipt_reconciliation', 'reconciliationId', v_r.id,
          'lines', (select jsonb_agg(jsonb_build_object('lineId', coalesce(x->>'lineId', x->>'itemId'), 'name', x->>'name',
            'qty', x->'qty', 'receivedQty', coalesce(x->'receivedQty', '0'::jsonb))) from jsonb_array_elements(v_po.items) x)))
      where id = v_po.id;
      insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
      values ('purchase_order', v_po.id, 'close_short', v_actor, v_r.reason,
        jsonb_build_object('returnToNeed', true, 'shortStockQty', v_short, 'via', 'receipt_reconciliation', 'reconciliationId', v_r.id));
      v_closed := true;
    end if;
  end if;

  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'receipt_reconciled', v_actor, v_r.reason, jsonb_build_object('deliveryNo', v_b.delivery_no,
    'decision', v_r.decision, 'arrivalDate', v_r.arrival_date, 'reconciliationId', v_r.id));

  select * into v_b from public.purchase_order_delivery_batches where id = v_b.id;
  select * into v_po from public.purchase_orders where id = v_po.id;
  update public.procurement_receipt_reconciliations
  set status = 'posted', posted_by = v_actor, posted_at = now(),
    result = jsonb_build_object('batchStatus', v_b.status, 'poStatus', v_po.status, 'acceptedGross', v_b.accepted_gross_amount,
      'payableId', v_ap_id, 'closedShort', v_closed)
  where id = v_r.id returning * into v_r;
  insert into public.procurement_receipt_reconciliation_events (reconciliation_id, action, actor_id, revision, before, after)
  values (v_r.id, 'post', v_actor, v_r.revision, v_before, v_r.result);

  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return app_private.receipt_recon_item(v_b.id);
end;
$$;

notify pgrst, 'reload schema';
