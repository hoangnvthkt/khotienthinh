-- Kho PR-2 (chủ SP 16/10/2026): khớp NCC trên phiếu giao chụp với danh mục Đối tác.
--   * Tên trên phiếu thường khác tên trong Vioo ("ĐTTM Hợp Thành" ↔ "đầu tư thương mại Hợp Thành"): so PHẦN LÕI tên
--     (bỏ chữ chung Công ty, TNHH, thương mại, xây dựng, ĐTTM…), MST trùng là chắc chắn, tên đã học là chắc chắn.
--   * AI đọc xong → hệ thống tự chọn NCC khi điểm ≥ 0,9; thủ kho đổi được (chọn 1 trong 3 gợi ý hoặc tìm), hoặc đánh dấu
--     "NCC mới" để Mua hàng tạo đối tác (thủ kho không tạo dữ liệu gốc).
--   * wms_supplier_aliases: tên trên phiếu → NCC, học mỗi lần người chọn.
--   * Gợi ý đơn: NCC đã khớp → điểm NCC theo đúng NCC của đơn (vendor_id), không đoán theo chữ.

alter table public.wms_delivery_captures
  add column if not exists supplier_id text references public.business_partners(id) on delete set null,
  add column if not exists supplier_match text check (supplier_match in ('auto', 'picked', 'new')),
  add column if not exists supplier_tax_code text,
  add column if not exists supplier_address text;
comment on column public.wms_delivery_captures.supplier_match is 'auto = hệ thống tự khớp, picked = người chọn, new = NCC chưa có trong danh mục (Mua hàng tạo).';
create index if not exists wms_delivery_captures_supplier_idx on public.wms_delivery_captures (supplier_id) where supplier_id is not null;

create table if not exists public.wms_supplier_aliases (
  alias_key text primary key,
  alias_text text not null,
  partner_id text not null references public.business_partners(id) on delete cascade,
  hits integer not null default 1,
  created_by uuid default public.current_app_user_id(),
  updated_at timestamptz not null default now()
);
comment on table public.wms_supplier_aliases is 'Tên NCC trên phiếu giao → đối tác Vioo, học khi thủ kho chọn NCC.';
alter table public.wms_supplier_aliases enable row level security;
drop policy if exists wms_supplier_aliases_select on public.wms_supplier_aliases;
create policy wms_supplier_aliases_select on public.wms_supplier_aliases for select to authenticated using (true);
revoke insert, update, delete on public.wms_supplier_aliases from anon, authenticated;
grant select on public.wms_supplier_aliases to authenticated;

-- Phần lõi tên NCC: bỏ dấu, bỏ chữ loại hình / ngành nghề chung, chỉ còn tên riêng ("hop thanh", "ton doan minh").
create or replace function app_private.capture_supplier_core(p text)
returns text language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(' ' || app_private.capture_text_key(p) || ' ',
    '\m(cty|ctcp)\M', 'cong ty', 'g'),
    '\m(cong ty|tnhh|co phan|cp|mtv|mot thanh vien|thuong mai|tm|xay dung|xd|dau tu|dttm|tmdv|tmxd|xdtm|dt|dich vu|dv|san xuat|sx|kinh doanh|va|vn|viet nam|tong hop|xuat nhap khau|xnk|ky thuat|kt|chi nhanh|tap doan|doanh nghiep|tu nhan|dntn|ho kinh doanh|hkd|cua hang|vat lieu|vlxd|vat tu|thiet bi|cong nghiep|phat trien|nha may|tram tron|be tong|thuong pham|ltd|co|jsc)\M',
    ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- Điểm giống nhau của hai phần lõi (0–1).
create or replace function app_private.capture_supplier_score(a text, b text)
returns numeric language sql immutable set search_path = ''
as $$
  select case when coalesce(a, '') = '' or coalesce(b, '') = '' then 0 when a = b then 1
    else greatest(public.similarity(a, b), least(public.word_similarity(a, b), public.word_similarity(b, a)))::numeric end;
$$;

-- MST: chỉ chữ số, đủ 10 số trở lên, không phải toàn số 0 (danh mục có nhiều MST "0").
create or replace function app_private.capture_tax_key(p text)
returns text language sql immutable set search_path = ''
as $$
  select case when length(d) >= 10 and d !~ '^0+$' then d end from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') d) x;
$$;

-- NCC ứng viên cho tên + MST trên phiếu, điểm cao trước. MST trùng 1,2 · tên đã học 1,1 · lõi tên trùng 1.
-- NCC đang có đơn mở về kho này được cộng nhẹ để tách các đối tác trùng tên.
create or replace function app_private.capture_supplier_candidates(p_name text, p_tax text, p_warehouse_id text)
returns table (id text, name text, tax_code text, address text, score numeric, reason text, open_orders integer)
language sql stable security definer set search_path = ''
as $$
  with q as (select app_private.capture_supplier_core(p_name) core, app_private.capture_tax_key(p_tax) tax,
      (select a.partner_id from public.wms_supplier_aliases a where a.alias_key = app_private.capture_text_key(p_name)) learned),
  pv as (
    select po.vendor_id, count(*) filter (where po.archived_at is null and po.status in ('sent', 'confirmed', 'in_transit', 'partial')
      and po.target_warehouse_id = p_warehouse_id)::int open_orders
    from public.purchase_orders po where po.vendor_id is not null group by po.vendor_id
  ),
  bp as (
    select b.id, b.name, b.tax_code, b.address, coalesce(pv.open_orders, 0) open_orders
    from public.business_partners b left join pv on pv.vendor_id = b.id
    where b.is_active and ('supplier' = any(b.classifications) or pv.vendor_id is not null)
  ),
  s as (
    select bp.*, case when q.tax is not null and app_private.capture_tax_key(bp.tax_code) = q.tax then 1.2::numeric
        when q.learned = bp.id then 1.1::numeric
        else app_private.capture_supplier_score(q.core, app_private.capture_supplier_core(bp.name)) end raw,
      case when q.tax is not null and app_private.capture_tax_key(bp.tax_code) = q.tax then 'tax' when q.learned = bp.id then 'learned' else 'name' end reason
    from bp cross join q
  )
  select s.id, s.name, s.tax_code, s.address, round(s.raw + case when s.open_orders > 0 then 0.05 else 0 end, 3), s.reason, s.open_orders
  from s where s.raw >= 0.4
  order by s.raw + case when s.open_orders > 0 then 0.05 else 0 end desc, s.open_orders desc, s.name
  limit 5;
$$;

-- Gợi ý NCC cho phiếu (hoặc theo chữ thủ kho gõ để tìm).
create or replace function public.suggest_capture_suppliers_v1(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_c public.wms_delivery_captures%rowtype;
  v_q text := nullif(btrim(p->>'q'), '');
begin
  select * into v_c from public.wms_delivery_captures where id = nullif(p->>'captureId', '')::uuid;
  if not found then raise exception using errcode = 'PT404', message = 'CAPTURE_NOT_FOUND'; end if;
  if not (public.is_admin() or app_private.wms_has_action('wms.transaction.view', v_c.warehouse_id, v_c.warehouse_id) or app_private.procurement_can('view')) then
    raise exception using errcode = '42501', message = 'CAPTURE_DENIED'; end if;
  if v_q is not null then
    -- Thủ kho gõ tìm: chứa chữ (không dấu) hoặc giống phần lõi.
    return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'taxCode', nullif(x.tax_code, '0'), 'address', x.address,
        'score', x.score, 'reason', 'search', 'openOrders', x.open_orders) order by x.score desc, x.name)
      from (select b.id, b.name, b.tax_code, b.address,
          greatest(app_private.capture_supplier_score(app_private.capture_supplier_core(v_q), app_private.capture_supplier_core(b.name)),
            case when app_private.capture_text_key(b.name) like '%' || app_private.capture_text_key(v_q) || '%' then 0.95 else 0 end) score,
          (select count(*)::int from public.purchase_orders po where po.vendor_id = b.id and po.archived_at is null
            and po.status in ('sent', 'confirmed', 'in_transit', 'partial') and po.target_warehouse_id = v_c.warehouse_id) open_orders
        from public.business_partners b
        where b.is_active and ('supplier' = any(b.classifications) or exists (select 1 from public.purchase_orders po where po.vendor_id = b.id))
          and (app_private.capture_text_key(b.name) like '%' || app_private.capture_text_key(v_q) || '%'
            or app_private.capture_tax_key(b.tax_code) = app_private.capture_tax_key(v_q)
            or app_private.capture_supplier_score(app_private.capture_supplier_core(v_q), app_private.capture_supplier_core(b.name)) >= 0.45)
        order by 5 desc, b.name limit 8) x), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'taxCode', nullif(x.tax_code, '0'), 'address', x.address,
      'score', x.score, 'reason', x.reason, 'openOrders', x.open_orders) order by x.score desc)
    from app_private.capture_supplier_candidates(v_c.supplier_name, v_c.supplier_tax_code, v_c.warehouse_id) x), '[]'::jsonb);
end;
$$;

create or replace function app_private.capture_json(c public.wms_delivery_captures)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'warehouseId', c.warehouse_id, 'status', c.status, 'supplierName', c.supplier_name,
    'docNo', c.doc_no, 'docDate', c.doc_date, 'docTime', c.doc_time, 'truckNo', c.truck_no, 'lines', c.lines, 'photos', c.photos,
    'ai', c.ai, 'note', c.note, 'purchaseOrderId', c.purchase_order_id,
    'supplierId', c.supplier_id, 'supplierMatch', c.supplier_match, 'supplierTaxCode', c.supplier_tax_code, 'supplierAddress', c.supplier_address,
    'supplierPartnerName', (select bp.name from public.business_partners bp where bp.id = c.supplier_id),
    'poNumber', (select po.po_number from public.purchase_orders po where po.id = c.purchase_order_id),
    'deliveryBatchId', c.delivery_batch_id, 'wmsTransactionId', c.wms_transaction_id,
    'code', (select it.code from public.inventory_transactions it where it.source_id = c.wms_transaction_id order by it.created_at limit 1),
    'createdBy', (select u.name from public.users u where u.id = c.created_by), 'createdAt', c.created_at,
    'receivedAt', c.received_at, 'receivedBy', (select u.name from public.users u where u.id = c.received_by));
$$;

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
  v_pick text := nullif(p->>'supplierId', '');
  v_best record;
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
    supplier_tax_code = case when p ? 'supplierTaxCode' then nullif(btrim(p->>'supplierTaxCode'), '') else supplier_tax_code end,
    supplier_address = case when p ? 'supplierAddress' then nullif(btrim(p->>'supplierAddress'), '') else supplier_address end,
    updated_at = now()
  where id = v_c.id returning * into v_c;

  -- NCC: người chọn (picked) hoặc xác nhận NCC chưa có trong danh mục (new); không thì hệ thống tự khớp khi chắc chắn.
  if p ? 'supplierId' then
    if v_pick is not null and not exists (select 1 from public.business_partners bp where bp.id = v_pick) then
      raise exception using errcode = '22023', message = 'CAPTURE_SUPPLIER_INVALID'; end if;
    update public.wms_delivery_captures set supplier_id = v_pick,
      supplier_match = case when v_pick is not null then 'picked' when p->>'supplierMatch' = 'new' then 'new' else null end
    where id = v_c.id returning * into v_c;
    -- Học tên trên phiếu → NCC (lần sau tự chọn).
    if v_pick is not null and app_private.capture_text_key(v_c.supplier_name) <> '' then
      insert into public.wms_supplier_aliases (alias_key, alias_text, partner_id, created_by)
      values (app_private.capture_text_key(v_c.supplier_name), v_c.supplier_name, v_pick, v_actor)
      on conflict (alias_key) do update set partner_id = excluded.partner_id, alias_text = excluded.alias_text,
        hits = public.wms_supplier_aliases.hits + 1, updated_at = now();
    end if;
  elsif coalesce(v_c.supplier_match, 'auto') = 'auto' and (p ? 'ai' or p ? 'supplierName' or p ? 'supplierTaxCode') then
    select * into v_best from app_private.capture_supplier_candidates(v_c.supplier_name, v_c.supplier_tax_code, v_c.warehouse_id) limit 1;
    update public.wms_delivery_captures set
      supplier_id = case when v_best.score >= 0.9 then v_best.id end,
      supplier_match = case when v_best.score >= 0.9 then 'auto' end
    where id = v_c.id returning * into v_c;
  end if;
  return app_private.capture_json(v_c);
end;
$$;

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

revoke all on function app_private.capture_supplier_core(text), app_private.capture_supplier_score(text, text), app_private.capture_tax_key(text),
  app_private.capture_supplier_candidates(text, text, text) from public, anon;
revoke all on function public.suggest_capture_suppliers_v1(jsonb) from public, anon;
grant execute on function public.suggest_capture_suppliers_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
