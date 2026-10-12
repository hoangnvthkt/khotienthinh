-- Kho Đợt 1 — Chụp phiếu giao (12/10/2026; chủ SP chốt câu 40–46).
--   * wms_delivery_captures: phiếu giao NCC chụp ở cổng kho — ảnh + số liệu (AI đọc hoặc thủ kho gõ). Lưu ngay kể cả khi
--     đơn mua chưa duyệt ("chụp trước, đơn sau").
--   * suggest_capture_orders_v1: gợi ý đơn mua khớp (NCC, tên hàng đã học, số lượng) tại kho của phiếu.
--   * receive_capture_v1: nhận theo xe — tự tạo đợt giao đúng số trên phiếu (không vượt phần đơn chưa giao),
--     ngày chứng từ theo phiếu, ảnh làm chứng từ của phiếu nhập, nhận 1 bước; học tên NCC → mã Vioo.
--   * wms_item_aliases: tên hàng trên phiếu NCC → mã vật tư (theo NCC), học từ mỗi lần nhận.
--   * Ảnh nằm trong bucket wms-transaction-attachments, thư mục cap-<id>/ — quyền theo kho của phiếu chụp.

create table if not exists public.wms_delivery_captures (
  id uuid primary key default gen_random_uuid(),
  warehouse_id text not null references public.warehouses(id),
  status text not null default 'new' check (status in ('new', 'read', 'received', 'discarded')),
  supplier_name text,
  doc_no text,
  doc_date date,
  doc_time text,
  truck_no text,
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array'),
  ai jsonb,
  note text,
  purchase_order_id text,
  delivery_batch_id uuid,
  wms_transaction_id text,
  discard_reason text,
  created_by uuid default public.current_app_user_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  received_by uuid,
  received_at timestamptz
);
comment on table public.wms_delivery_captures is 'Phiếu giao NCC chụp ở kho: ảnh + số liệu, chờ khớp đơn mua rồi nhận theo xe.';
create index if not exists wms_delivery_captures_open_idx on public.wms_delivery_captures (warehouse_id, created_at desc) where status in ('new', 'read');
create index if not exists wms_delivery_captures_po_idx on public.wms_delivery_captures (purchase_order_id) where purchase_order_id is not null;

create table if not exists public.wms_item_aliases (
  id uuid primary key default gen_random_uuid(),
  supplier_key text not null default '',
  alias_key text not null,
  alias_text text not null,
  item_id text not null references public.items(id),
  specification text,
  hits integer not null default 1,
  created_by uuid default public.current_app_user_id(),
  updated_at timestamptz not null default now(),
  unique (supplier_key, alias_key)
);
comment on table public.wms_item_aliases is 'Tên hàng trên phiếu NCC → mã vật tư Vioo, học khi thủ kho nhận theo phiếu chụp.';

alter table public.wms_delivery_captures enable row level security;
alter table public.wms_item_aliases enable row level security;
drop policy if exists wms_delivery_captures_select on public.wms_delivery_captures;
create policy wms_delivery_captures_select on public.wms_delivery_captures for select to authenticated
  using (public.is_admin() or app_private.wms_has_action('wms.transaction.view', warehouse_id, warehouse_id)
    or app_private.procurement_can('view'));
drop policy if exists wms_item_aliases_select on public.wms_item_aliases;
create policy wms_item_aliases_select on public.wms_item_aliases for select to authenticated using (true);
revoke insert, update, delete on public.wms_delivery_captures, public.wms_item_aliases from anon, authenticated;
grant select on public.wms_delivery_captures, public.wms_item_aliases to authenticated;

-- Chữ để so khớp: bỏ dấu, thường, chỉ chữ-số, cách đơn.
create or replace function app_private.capture_text_key(p text)
returns text language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p, ''))), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function app_private.capture_can_operate(p_warehouse_id text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or app_private.wms_has_action('wms.transaction.approve', p_warehouse_id, p_warehouse_id);
$$;

-- Ảnh phiếu chụp: thư mục cap-<captureId>/ trong bucket ảnh phiếu kho.
create or replace function app_private.wms_capture_object_warehouse(p_object_name text)
returns text language sql stable security definer set search_path = ''
as $$
  select c.warehouse_id from public.wms_delivery_captures c
  where split_part(p_object_name, '/', 1) like 'cap-%'
    and c.id::text = substr(split_part(p_object_name, '/', 1), 5);
$$;

CREATE OR REPLACE FUNCTION app_private.wms_transaction_attachment_can_read(p_object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    app_private.wms_transaction_attachment_can_access(p_object_name)
    or exists (
      select 1
      from public.transactions tx
      where tx.id = split_part(p_object_name, '/', 1)
        and app_private.wms_has_action(
          'wms.transaction.view',
          tx.source_warehouse_id,
          tx.target_warehouse_id,
          tx.requester_id,
          tx.approver_id
        )
    )
    or (select app_private.wms_has_action('wms.transaction.view', w, w) or app_private.procurement_can('view')
        from app_private.wms_capture_object_warehouse(p_object_name) w where w is not null),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.wms_transaction_attachment_can_mutate(p_object_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    app_private.wms_transaction_attachment_can_access(p_object_name)
    or exists (
      select 1
      from public.transactions tx
      where tx.id = split_part(p_object_name, '/', 1)
        and app_private.wms_has_action(
          'wms.transaction.approve',
          tx.source_warehouse_id,
          tx.target_warehouse_id,
          tx.requester_id,
          tx.approver_id
        )
    )
    or (select app_private.capture_can_operate(w) from app_private.wms_capture_object_warehouse(p_object_name) w where w is not null),
    false
  );
$function$;

create or replace function app_private.capture_json(c public.wms_delivery_captures)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'warehouseId', c.warehouse_id, 'status', c.status, 'supplierName', c.supplier_name,
    'docNo', c.doc_no, 'docDate', c.doc_date, 'docTime', c.doc_time, 'truckNo', c.truck_no, 'lines', c.lines, 'photos', c.photos,
    'ai', c.ai, 'note', c.note, 'purchaseOrderId', c.purchase_order_id,
    'poNumber', (select po.po_number from public.purchase_orders po where po.id = c.purchase_order_id),
    'deliveryBatchId', c.delivery_batch_id, 'wmsTransactionId', c.wms_transaction_id,
    'code', (select it.code from public.inventory_transactions it where it.source_id = c.wms_transaction_id order by it.created_at limit 1),
    'createdBy', (select u.name from public.users u where u.id = c.created_by), 'createdAt', c.created_at,
    'receivedAt', c.received_at, 'receivedBy', (select u.name from public.users u where u.id = c.received_by));
$$;

-- Lưu / sửa phiếu chụp (chưa nhận). Một số dòng có thể chưa đủ — thủ kho bổ sung trước khi nhận.
create or replace function public.save_delivery_capture_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_wh text := nullif(p->>'warehouseId', '');
  v_c public.wms_delivery_captures%rowtype;
  v_lines jsonb := coalesce(p->'lines', '[]'::jsonb);
  v_photos jsonb := coalesce(p->'photos', '[]'::jsonb);
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_typeof(v_photos) <> 'array' then
    raise exception using errcode = '22023', message = 'CAPTURE_PAYLOAD_INVALID'; end if;
  if v_id is not null then
    select * into v_c from public.wms_delivery_captures where id = v_id for update;
    if not found then raise exception using errcode = 'PT404', message = 'CAPTURE_NOT_FOUND'; end if;
    if v_c.status in ('received', 'discarded') then raise exception using errcode = '22023', message = 'CAPTURE_LOCKED'; end if;
    v_wh := v_c.warehouse_id;
  end if;
  if v_wh is null then raise exception using errcode = '22023', message = 'CAPTURE_WAREHOUSE_REQUIRED'; end if;
  if not app_private.capture_can_operate(v_wh) then raise exception using errcode = '42501', message = 'CAPTURE_DENIED'; end if;
  if v_id is null then
    insert into public.wms_delivery_captures (id, warehouse_id, created_by) values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), v_wh, v_actor)
    returning * into v_c;
  end if;
  update public.wms_delivery_captures set
    supplier_name = case when p ? 'supplierName' then nullif(btrim(p->>'supplierName'), '') else supplier_name end,
    doc_no = case when p ? 'docNo' then nullif(btrim(p->>'docNo'), '') else doc_no end,
    doc_date = case when p ? 'docDate' then nullif(p->>'docDate', '')::date else doc_date end,
    doc_time = case when p ? 'docTime' then nullif(btrim(p->>'docTime'), '') else doc_time end,
    truck_no = case when p ? 'truckNo' then nullif(upper(btrim(p->>'truckNo')), '') else truck_no end,
    lines = case when p ? 'lines' then v_lines else lines end,
    photos = case when p ? 'photos' then v_photos else photos end,
    note = case when p ? 'note' then nullif(btrim(p->>'note'), '') else note end,
    ai = case when p ? 'ai' then p->'ai' else ai end,
    status = case when p ? 'ai' and status = 'new' then 'read' else status end,
    updated_at = now()
  where id = v_c.id returning * into v_c;
  return app_private.capture_json(v_c);
end;
$$;

create or replace function public.discard_delivery_capture_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_c public.wms_delivery_captures%rowtype;
begin
  select * into v_c from public.wms_delivery_captures where id = nullif(p->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'CAPTURE_NOT_FOUND'; end if;
  if not app_private.capture_can_operate(v_c.warehouse_id) then raise exception using errcode = '42501', message = 'CAPTURE_DENIED'; end if;
  if v_c.status = 'received' then raise exception using errcode = '22023', message = 'CAPTURE_LOCKED'; end if;
  if nullif(btrim(p->>'reason'), '') is null then raise exception using errcode = '22023', message = 'CAPTURE_REASON_REQUIRED'; end if;
  update public.wms_delivery_captures set status = 'discarded', discard_reason = btrim(p->>'reason'), updated_at = now()
  where id = v_c.id returning * into v_c;
  return app_private.capture_json(v_c);
end;
$$;

-- Phiếu chụp đang chờ nhận (mọi kho người dùng xem được) + nhận gần đây (7 ngày).
create or replace function public.list_delivery_captures_v1(p jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.capture_json(c) order by c.created_at desc), '[]'::jsonb)
  from public.wms_delivery_captures c
  where (nullif(p->>'warehouseId', '') is null or c.warehouse_id = p->>'warehouseId')
    and (c.status in ('new', 'read') or (c.status = 'received' and c.received_at > now() - interval '7 days'))
    and (public.is_admin() or app_private.wms_has_action('wms.transaction.view', c.warehouse_id, c.warehouse_id) or app_private.procurement_can('view'));
$$;

-- Gợi ý đơn mua khớp phiếu chụp: NCC giống + từng dòng khớp (tên đã học → 1; giống tên; cùng số lượng; cùng đơn vị).
create or replace function public.suggest_capture_orders_v1(p_capture_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_c public.wms_delivery_captures%rowtype;
  v_po record; v_ln jsonb; v_item jsonb; v_out jsonb := '[]'::jsonb; v_lines jsonb;
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
    v_sup := case when coalesce(v_c.supplier_name, '') = '' then 0 else greatest(
      public.similarity(app_private.capture_text_key(v_po.vendor_name), app_private.capture_text_key(v_c.supplier_name)),
      public.word_similarity(app_private.capture_text_key(v_c.supplier_name), app_private.capture_text_key(v_po.vendor_name))) end;
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
        'supplierScore', round(v_sup, 3), 'score', round(v_score, 3), 'lines', v_lines,
        'poLines', (select coalesce(jsonb_agg(jsonb_build_object('poLineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
            'itemName', coalesce(x.value->>'itemNameSnapshot', x.value->>'name'), 'specification', x.value->>'specification',
            'unit', coalesce(x.value->>'purchaseUnitSnapshot', x.value->>'unit'), 'ordered', nullif(x.value->>'qty', '')::numeric,
            'remaining', app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')),
            'price', nullif(x.value->>'unitPrice', '')::numeric) order by x.ordinality), '[]'::jsonb)
          from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality x)));
    end if;
  end loop;
  return coalesce((select jsonb_agg(t.value order by t.rn) from (select x.value, row_number() over (order by (x.value->>'score')::numeric desc, (x.value->>'createdAt')::timestamptz) rn
    from jsonb_array_elements(v_out) x) t where t.rn <= 5), '[]'::jsonb);
end;
$$;

-- Nhận theo xe từ phiếu chụp: tạo đợt giao đúng số trên phiếu → phiếu nhập (ngày theo phiếu, ảnh đính kèm) → nhận 1 bước → học tên.
create or replace function public.receive_capture_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.wms_delivery_captures%rowtype;
  v_po public.purchase_orders%rowtype;
  v_ln jsonb; v_item jsonb; v_cap_line jsonb;
  v_qty numeric; v_rem numeric; v_factor numeric; v_lines jsonb := '[]'::jsonb;
  v_batch uuid := gen_random_uuid(); v_no integer; v_tx text; v_recv jsonb := '[]'::jsonb; v_att jsonb; v_today date;
  v_line public.purchase_order_delivery_lines%rowtype; v_sup_key text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  select * into v_c from public.wms_delivery_captures where id = nullif(p->>'captureId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'CAPTURE_NOT_FOUND'; end if;
  if not app_private.capture_can_operate(v_c.warehouse_id) then raise exception using errcode = '42501', message = 'CAPTURE_DENIED'; end if;
  if v_c.status in ('received', 'discarded') then raise exception using errcode = '22023', message = 'CAPTURE_LOCKED'; end if;
  select * into v_po from public.purchase_orders where id = p->>'purchaseOrderId' for update;
  if not found or v_po.archived_at is not null or not app_private.procurement_po_is_hub(v_po.metadata)
     or not (v_po.target_warehouse_id = v_c.warehouse_id or (app_private.procurement_po_is_group(v_po.metadata)
       and exists (select 1 from app_private.group_po_link_allocation(v_po.id) g where g.warehouse_id = v_c.warehouse_id))) then
    raise exception using errcode = '22023', message = 'CAPTURE_PO_INVALID'; end if;
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'CAPTURE_PO_NOT_APPROVED'; end if;
  -- Chống trùng: cùng đơn, cùng số phiếu NCC, cùng xe, cùng ngày đã nhận (NCC có thể dùng chung số phiếu cho nhiều xe).
  if v_c.doc_no is not null and exists (select 1 from public.wms_delivery_captures o where o.id <> v_c.id and o.status = 'received'
      and o.purchase_order_id = v_po.id and o.doc_no = v_c.doc_no and coalesce(o.truck_no, '') = coalesce(v_c.truck_no, '')
      and o.doc_date is not distinct from v_c.doc_date) then
    raise exception using errcode = '22023', message = 'CAPTURE_DUPLICATE'; end if;

  -- Một dòng đơn nhận được từ nhiều dòng phiếu (NCC tách theo chiều dài / số tấm, VD Tôn Đoàn Minh 007/10: 110 tấm + 2 tấm): cộng dồn.
  for v_ln in select jsonb_build_object('poLineId', x.value->>'poLineId', 'qty', sum(coalesce(nullif(x.value->>'qty', ''), '0')::numeric))
      from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) x
      where coalesce(nullif(x.value->>'qty', ''), '0')::numeric > 0
      group by x.value->>'poLineId' loop
    v_qty := (v_ln->>'qty')::numeric;
    select x.value into v_item from jsonb_array_elements(v_po.items) x where coalesce(x.value->>'lineId', x.value->>'itemId') = v_ln->>'poLineId' limit 1;
    if v_item is null then raise exception using errcode = '22023', message = 'CAPTURE_PO_LINE_INVALID'; end if;
    v_rem := app_private.procurement_po_line_undelivered(v_po.id, v_po.items, v_ln->>'poLineId');
    if v_qty > v_rem + 0.0005 then
      raise exception using errcode = '22023', message = 'CAPTURE_OVER_REMAINING: ' || coalesce(v_item->>'itemNameSnapshot', v_item->>'name')
        || ' — đơn còn ' || trim(trailing '.' from trim(trailing '0' from round(v_rem, 3)::text)) || ' ' || coalesce(v_item->>'purchaseUnitSnapshot', v_item->>'unit', ''); end if;
    v_factor := coalesce(nullif(v_item->>'purchaseConversionFactor', '')::numeric,
      case when coalesce(nullif(v_item->>'qty', '')::numeric, 0) > 0 then nullif(v_item->>'stockQty', '')::numeric / (v_item->>'qty')::numeric end, 1);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('purchaseOrderLineId', v_ln->>'poLineId', 'itemId', v_item->>'itemId',
      'purchaseQty', v_qty, 'purchaseUnit', coalesce(v_item->>'purchaseUnitSnapshot', v_item->>'unit'),
      'stockQty', round(v_qty * v_factor, 6), 'stockUnit', coalesce(v_item->>'stockUnitSnapshot', v_item->>'unitSnapshot', v_item->>'unit'),
      'purchaseUnitPrice', coalesce(nullif(v_item->>'unitPrice', '')::numeric, 0)));
  end loop;
  -- Học tên: tên trên phiếu NCC → mã vật tư của dòng đơn.
  v_sup_key := app_private.catalog_name_key(v_po.vendor_name);
  for v_ln in select value from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_cap_line := v_c.lines -> coalesce(nullif(v_ln->>'captureIndex', '')::int, -1);
    select x.value into v_item from jsonb_array_elements(v_po.items) x where coalesce(x.value->>'lineId', x.value->>'itemId') = v_ln->>'poLineId' limit 1;
    if v_item is not null and v_cap_line is not null and nullif(btrim(v_cap_line->>'name'), '') is not null then
      insert into public.wms_item_aliases (supplier_key, alias_key, alias_text, item_id, specification, created_by)
      values (v_sup_key, app_private.catalog_name_key(v_cap_line->>'name'), btrim(v_cap_line->>'name'), v_item->>'itemId', nullif(v_item->>'specification', ''), v_actor)
      on conflict (supplier_key, alias_key) do update set item_id = excluded.item_id, specification = excluded.specification,
        hits = public.wms_item_aliases.hits + 1, updated_at = now();
    end if;
  end loop;
  if jsonb_array_length(v_lines) = 0 then raise exception using errcode = '22023', message = 'CAPTURE_LINES_REQUIRED'; end if;

  select coalesce(max(delivery_no), 0) + 1 into v_no from public.purchase_order_delivery_batches where purchase_order_id = v_po.id;
  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  perform app_private.write_purchase_order_draft_batch_v1(v_po, jsonb_build_object('id', v_batch, 'delivery_no', v_no,
    'planned_delivery_date', coalesce(v_c.doc_date, current_date), 'status', 'planned', 'approval_status', 'draft',
    'fulfillment_mode', v_po.fulfillment_mode, 'vat_rate', coalesce(v_po.vat_rate, 0),
    'note', concat_ws(' · ', 'Phiếu giao chụp', v_c.doc_no, v_c.truck_no), 'lines', v_lines), v_actor);
  update public.purchase_order_delivery_batches
  set target_warehouse_id = v_c.warehouse_id, approval_status = 'approved', approval_requested_by = v_actor, approval_requested_at = now(),
      approval_decided_by = v_actor, approval_decided_at = now()
  where id = v_batch;
  perform app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(v_batch, v_actor, gen_random_uuid());
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  select wms_transaction_id into v_tx from public.purchase_order_delivery_batches where id = v_batch;

  v_today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  if v_c.doc_date is not null and v_c.doc_date <> v_today then
    perform public.set_wms_document_date_v1(jsonb_build_object('transactionId', v_tx, 'date', v_c.doc_date));
  end if;
  v_att := coalesce((select jsonb_agg(jsonb_build_object('id', coalesce(x.value->>'id', md5(x.value->>'path')), 'fileName', coalesce(x.value->>'name', 'phieu-giao.jpg'),
      'mimeType', coalesce(x.value->>'mimeType', 'image/jpeg'), 'fileSize', coalesce(nullif(x.value->>'size', '')::numeric, 0),
      'storagePath', x.value->>'path', 'uploadedAt', v_c.created_at, 'uploadedBy', coalesce(v_c.created_by, v_actor)))
    from jsonb_array_elements(v_c.photos) x where nullif(x.value->>'path', '') is not null), '[]'::jsonb);
  for v_line in select * from public.purchase_order_delivery_lines where delivery_batch_id = v_batch loop
    v_recv := v_recv || jsonb_build_array(jsonb_build_object('deliveryLineId', v_line.id, 'itemId', v_line.item_id,
      'documentedPurchaseQty', v_line.planned_qty, 'countedPurchaseQty', v_line.planned_qty, 'acceptedPurchaseQty', v_line.planned_qty,
      'documentedStockQty', v_line.stock_planned_qty, 'countedStockQty', v_line.stock_planned_qty, 'acceptedStockQty', v_line.stock_planned_qty));
  end loop;
  perform public.receive_purchase_delivery_v1(v_batch, v_tx, 'passed', v_recv, v_att);

  update public.wms_delivery_captures set status = 'received', purchase_order_id = v_po.id, delivery_batch_id = v_batch,
    wms_transaction_id = v_tx, received_by = v_actor, received_at = now(), updated_at = now()
  where id = v_c.id returning * into v_c;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_po.id, 'delivery_capture', v_actor, jsonb_build_object('captureId', v_c.id, 'deliveryId', v_batch, 'deliveryNo', v_no,
    'docNo', v_c.doc_no, 'truckNo', v_c.truck_no));
  return app_private.capture_json(v_c) || jsonb_build_object('deliveryNo', v_no);
end;
$$;

revoke all on function public.save_delivery_capture_v1(jsonb), public.discard_delivery_capture_v1(jsonb), public.list_delivery_captures_v1(jsonb),
  public.suggest_capture_orders_v1(uuid), public.receive_capture_v1(jsonb) from public, anon;
grant execute on function public.save_delivery_capture_v1(jsonb), public.discard_delivery_capture_v1(jsonb), public.list_delivery_captures_v1(jsonb),
  public.suggest_capture_orders_v1(uuid), public.receive_capture_v1(jsonb) to authenticated;
revoke all on function app_private.capture_text_key(text), app_private.capture_can_operate(text), app_private.wms_capture_object_warehouse(text),
  app_private.capture_json(public.wms_delivery_captures) from public, anon;

notify pgrst, 'reload schema';
