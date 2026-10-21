-- V1-3b Tồn kho theo quy cách (thiết kế doc 13 mục 9, 16 — chủ SP duyệt 03–04/10/2026; làm 10/10/2026).
-- Nguyên tắc: tồn, giá vốn bình quân, báo cáo nhập–xuất–tồn, MISA vẫn theo (mã, kho) như đã chốt. Quy cách là chiều phụ:
--   * Mỗi dòng sổ kho ghi metadata.specAllocations = [{specification, qty}] — phần của dòng thuộc quy cách nào.
--       - Nhập: quy cách của chứng từ (ảnh chụp dòng đơn, #152); không có → "Chưa ghi quy cách" (không tự đoán).
--       - Xuất có quy cách trên phiếu (nhập–xuất thẳng, trả NCC): đúng quy cách đó.
--       - Xuất không ghi quy cách: tự lấy quy cách nhập trước (câu 30; chọn tay ở V2 Phiếu kho một màn).
--       - Nhận chuyển kho / phiếu đảo: giữ đúng quy cách của phiếu xuất / phiếu gốc.
--   * Tồn từng quy cách = cộng phân bổ trên sổ + phiếu chuyển quy cách. Tồn của mã = cộng các quy cách (không lưu riêng).
--   * Phiếu chuyển quy cách (wms_spec_transfers): cùng mã, cùng kho, bắt buộc lý do; dùng khi hàng về khác quy cách
--     hoặc gắn quy cách cho hàng cũ sau khi kiểm thực tế (câu 31). Không đổi số lượng / giá trị tồn của mã.
-- Bù dữ liệu: chạy lại toàn bộ sổ kho theo thứ tự ghi để gắn phân bổ cho dòng cũ.

create table if not exists public.wms_spec_transfers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  material_id text not null references public.items(id),
  warehouse_id text not null references public.warehouses(id),
  from_spec text,
  to_spec text not null check (length(btrim(to_spec)) between 1 and 80),
  qty numeric not null check (qty > 0),
  reason text not null check (length(btrim(reason)) > 0),
  transfer_date date not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
comment on table public.wms_spec_transfers is 'Phiếu chuyển quy cách trong cùng mã, cùng kho (V1-3b). Không đổi tồn / giá trị của mã.';
create index if not exists idx_wms_spec_transfers_item on public.wms_spec_transfers (material_id, warehouse_id, created_at);
alter table public.wms_spec_transfers enable row level security;
revoke all on public.wms_spec_transfers from anon, authenticated;

-- Tồn theo quy cách của một mã tại một kho.
create or replace function app_private.wms_spec_balances(p_material text, p_warehouse text)
returns table(spec_key text, specification text, qty numeric, first_in timestamptz)
language sql stable security definer set search_path = ''
as $$
  with m as (
    select app_private.spec_key(a->>'specification') k, nullif(btrim(coalesce(a->>'specification', '')), '') s,
      case when e.movement_direction = 'in' then 1 else -1 end * coalesce(nullif(a->>'qty', '')::numeric, 0) q,
      case when e.movement_direction = 'in' then e.transaction_date end d, e.created_at c
    from public.inventory_ledger_entries e
    cross join lateral jsonb_array_elements(e.metadata->'specAllocations') a
    where e.material_id = p_material and e.warehouse_id = p_warehouse and jsonb_typeof(e.metadata->'specAllocations') = 'array'
    union all
    select app_private.spec_key(t.from_spec), nullif(btrim(coalesce(t.from_spec, '')), ''), -t.qty, null, t.created_at
    from public.wms_spec_transfers t where t.material_id = p_material and t.warehouse_id = p_warehouse
    union all
    select app_private.spec_key(t.to_spec), btrim(t.to_spec), t.qty, t.transfer_date::timestamptz, t.created_at
    from public.wms_spec_transfers t where t.material_id = p_material and t.warehouse_id = p_warehouse
  )
  select k, (array_agg(s order by c desc) filter (where s is not null))[1], round(sum(q), 6), min(d)
  from m group by k;
$$;

-- Cộng dồn một phần vào danh sách phân bổ (gộp theo khóa quy cách).
create or replace function app_private.wms_spec_alloc_add(p_alloc jsonb, p_spec text, p_qty numeric)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare v_out jsonb := '[]'::jsonb; a jsonb; v_hit boolean := false;
begin
  if coalesce(p_qty, 0) <= 0.0000005 then return coalesce(p_alloc, '[]'::jsonb); end if;
  for a in select value from jsonb_array_elements(coalesce(p_alloc, '[]'::jsonb)) loop
    if not v_hit and app_private.spec_key(a->>'specification') = app_private.spec_key(p_spec) then
      a := jsonb_set(a, '{qty}', to_jsonb(round((a->>'qty')::numeric + p_qty, 6))); v_hit := true;
    end if;
    v_out := v_out || jsonb_build_array(a);
  end loop;
  if not v_hit then
    v_out := v_out || jsonb_build_array(jsonb_build_object('specification', nullif(btrim(coalesce(p_spec, '')), ''), 'qty', round(p_qty, 6)));
  end if;
  return v_out;
end;
$$;

-- Lấy p_qty từ một "nguồn" (danh sách quy cách → SL còn lấy được), theo thứ tự đã sắp; thiếu thì phần dư về p_rest_spec.
create or replace function app_private.wms_spec_take(p_pool jsonb, p_qty numeric, p_rest_spec text)
returns jsonb language plpgsql immutable set search_path = ''
as $$
declare a jsonb; v_left numeric := p_qty; v_take numeric; v_out jsonb := '[]'::jsonb;
begin
  for a in select value from jsonb_array_elements(coalesce(p_pool, '[]'::jsonb)) loop
    exit when v_left <= 0.0000005;
    v_take := least(coalesce((a->>'qty')::numeric, 0), v_left);
    if v_take > 0.0000005 then
      v_out := app_private.wms_spec_alloc_add(v_out, a->>'specification', v_take); v_left := v_left - v_take;
    end if;
  end loop;
  return app_private.wms_spec_alloc_add(v_out, p_rest_spec, v_left);
end;
$$;

-- Phân bổ quy cách cho một dòng sổ kho sắp ghi (dòng chưa có trong sổ).
create or replace function app_private.wms_spec_alloc_for_entry(p_inv_tx uuid, p_type text, p_dir text, p_material text, p_warehouse text,
  p_source_code text, p_qty numeric, p_metadata jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_spec text := nullif(btrim(coalesce(p_metadata->>'specification', '')), '');
  v_orig uuid := app_private.uuid_or_null(p_metadata->>'reversalOfInventoryTransactionId');
  v_pool jsonb;
begin
  if v_orig is not null or (p_type = 'transfer_receipt' and nullif(p_source_code, '') is not null) then
    -- Phiếu đảo / nhận chuyển kho: lấy lại quy cách của phiếu gốc / phiếu xuất, trừ phần các dòng trước đã lấy.
    select coalesce(jsonb_agg(jsonb_build_object('specification', s, 'qty', q) order by k), '[]'::jsonb) into v_pool
    from (select app_private.spec_key(a->>'specification') k, max(nullif(btrim(coalesce(a->>'specification', '')), '')) s,
            sum(case when src then 1 else -1 end * coalesce(nullif(a->>'qty', '')::numeric, 0)) q
          from (select e.metadata, true src from public.inventory_ledger_entries e
                where e.material_id = p_material and jsonb_typeof(e.metadata->'specAllocations') = 'array'
                  and ((v_orig is not null and e.inventory_transaction_id = v_orig)
                    or (v_orig is null and e.transaction_type = 'transfer_issue' and e.source_code = p_source_code))
                union all
                select e.metadata, false from public.inventory_ledger_entries e
                where e.material_id = p_material and jsonb_typeof(e.metadata->'specAllocations') = 'array'
                  and ((v_orig is not null and e.inventory_transaction_id = p_inv_tx)
                    or (v_orig is null and e.transaction_type = 'transfer_receipt' and e.source_code = p_source_code))) x
          cross join lateral jsonb_array_elements(x.metadata->'specAllocations') a
          group by 1 having sum(case when src then 1 else -1 end * coalesce(nullif(a->>'qty', '')::numeric, 0)) > 0.0000005) z;
    return app_private.wms_spec_take(v_pool, p_qty, v_spec);
  elsif p_dir = 'in' or v_spec is not null then
    return app_private.wms_spec_alloc_add('[]'::jsonb, v_spec, p_qty);
  end if;
  -- Xuất không ghi quy cách: quy cách nhập trước.
  select coalesce(jsonb_agg(jsonb_build_object('specification', b.specification, 'qty', b.qty) order by b.first_in nulls last, b.spec_key), '[]'::jsonb)
  into v_pool from app_private.wms_spec_balances(p_material, p_warehouse) b where b.qty > 0.0000005;
  return app_private.wms_spec_take(v_pool, p_qty, null);
end;
$$;

create or replace function app_private.wms_can_transfer_spec(p_actor uuid, p_warehouse text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_actor is not null and (public.is_admin() or app_private.has_permission(p_actor, 'wms.accounting.manage', 'global', '*')
    or app_private.wms_user_is_keeper(p_actor, p_warehouse));
$$;

-- Phiếu chuyển quy cách.
create or replace function public.transfer_wms_item_spec_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_item text := p->>'itemId'; v_wh text := p->>'warehouseId';
  v_from text := nullif(btrim(coalesce(p->>'fromSpec', '')), '');
  v_to text := nullif(btrim(regexp_replace(coalesce(p->>'toSpec', ''), '\s+', ' ', 'g')), '');
  v_qty numeric; v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_date date := coalesce(nullif(p->>'date', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_avail numeric; v_id uuid := gen_random_uuid(); v_code text;
begin
  if not app_private.wms_can_transfer_spec(v_actor, v_wh) then
    raise exception using errcode = '42501', message = 'WMS_SPEC_DENIED'; end if;
  begin v_qty := nullif(p->>'qty', '')::numeric; exception when others then v_qty := null; end;
  if v_item is null or not exists (select 1 from public.items where id = v_item) or not exists (select 1 from public.warehouses where id = v_wh)
     or v_to is null or length(v_to) > 80 or v_qty is null or v_qty <= 0 or v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception using errcode = '22023', message = 'WMS_SPEC_INVALID'; end if;
  if app_private.spec_key(v_from) = app_private.spec_key(v_to) then
    raise exception using errcode = '22023', message = 'WMS_SPEC_SAME'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'WMS_SPEC_REASON'; end if;
  perform pg_advisory_xact_lock(hashtext('wms_spec:' || v_item || ':' || v_wh));
  select coalesce(sum(b.qty), 0) into v_avail from app_private.wms_spec_balances(v_item, v_wh) b
  where b.spec_key = app_private.spec_key(v_from);
  if v_avail + 0.0000005 < v_qty then
    raise exception using errcode = '22023', message = 'WMS_SPEC_INSUFFICIENT: Quy cách "' || coalesce(v_from, 'Chưa ghi quy cách') || '" chỉ còn '
      || trim(to_char(v_avail, 'FM999G999G990D###')) || '.'; end if;
  v_code := 'CQC-' || to_char(v_date, 'YYMMDD') || '-' || upper(substr(md5(v_id::text), 1, 5));
  insert into public.wms_spec_transfers (id, code, material_id, warehouse_id, from_spec, to_spec, qty, reason, transfer_date, created_by)
  values (v_id, v_code, v_item, v_wh, v_from, v_to, v_qty, v_reason, v_date, v_actor);
  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

CREATE OR REPLACE FUNCTION app_private.post_inventory_ledger_entry(p_inventory_transaction_id uuid, p_entry_no integer, p_document_code text, p_transaction_date timestamp with time zone, p_transaction_type text, p_direction text, p_material_id text, p_warehouse_id text, p_project_id text, p_construction_site_id text, p_source_type text, p_source_id text, p_source_code text, p_source_line_id text, p_related_request_id text, p_qty numeric, p_unit_price numeric, p_description text, p_metadata jsonb, p_created_by uuid, p_approved_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entry_id uuid := gen_random_uuid();
  v_delta numeric;
  v_value_delta numeric;
  v_balance_after_qty numeric;
  v_balance_after_value numeric;
  v_unit text;
  v_total_after numeric;
  v_price numeric := coalesce(p_unit_price, 0);
  v_avg numeric;
  v_price_source text;
  v_dirty boolean := false;
  v_min_after numeric;
  v_spec_alloc jsonb;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'ledger quantity must be positive';
  end if;
  if nullif(p_material_id, '') is null then
    raise exception 'material id is required';
  end if;
  if nullif(p_warehouse_id, '') is null then
    raise exception 'warehouse id is required';
  end if;

  select i.unit into v_unit
  from public.items i
  where i.id = p_material_id;

  v_unit := coalesce(
    v_unit,
    nullif(p_metadata->>'unit', ''),
    nullif(p_metadata->>'unitSnapshot', ''),
    nullif(p_metadata->>'accountingUnit', '')
  );

  -- K3a-2: chuyển kho đi theo giá vốn bình quân gia quyền của kho gửi tại lúc xuất (như phần mềm kế toán),
  -- không theo đơn giá gõ trên phiếu. Nhập vào kho đích, hoặc hàng trả về kho gửi, dùng đúng giá đã xuất của phiếu.
  if p_transaction_type = 'transfer_issue' and p_direction = 'out' then
    select case when sum(b.on_hand_qty) > 0 and sum(b.total_value) > 0
      then round(sum(b.total_value) / sum(b.on_hand_qty), 6) end into v_avg
    from public.inventory_balances b where b.material_id = p_material_id and b.warehouse_id = p_warehouse_id;
    v_price_source := case when v_avg is not null then 'weighted_average' else 'document' end;
    -- Tồn có hàng mà giá trị 0, hoặc hết hàng mà còn giá trị → giá bình quân chưa tin được.
    select exists (select 1 from public.inventory_balances b where b.material_id = p_material_id and b.warehouse_id = p_warehouse_id
      and ((b.on_hand_qty > 0 and b.total_value <= 0) or (b.on_hand_qty <= 0 and abs(b.total_value) > 1))) into v_dirty;
  elsif p_transaction_type = 'transfer_receipt' and p_direction = 'in' and nullif(p_source_code, '') is not null then
    select case when sum(le.quantity_out) > 0
      then round(sum(le.quantity_out * le.unit_price) / sum(le.quantity_out), 6) end into v_avg
    from public.inventory_ledger_entries le
    where le.transaction_type = 'transfer_issue' and le.source_code = p_source_code and le.material_id = p_material_id;
    v_price_source := case when v_avg is not null then 'transfer_issue' else 'document' end;
  end if;
  v_price := coalesce(v_avg, v_price);

  v_delta := case when p_direction = 'in' then p_qty else -p_qty end;
  v_value_delta := v_delta * v_price;

  insert into public.inventory_balances (
    material_id, warehouse_id, project_id, construction_site_id,
    on_hand_qty, total_value, average_unit_cost,
    last_ledger_entry_id, last_transaction_date, updated_at
  )
  values (
    p_material_id, p_warehouse_id, nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
    v_delta, v_value_delta,
    case when v_delta = 0 then 0 else v_price end,
    v_entry_id, p_transaction_date, now()
  )
  on conflict (material_id, warehouse_id, scope_key)
  do update set
    on_hand_qty = public.inventory_balances.on_hand_qty + excluded.on_hand_qty,
    total_value = public.inventory_balances.total_value + excluded.total_value,
    average_unit_cost = case
      when (public.inventory_balances.on_hand_qty + excluded.on_hand_qty) = 0 then 0
      else (public.inventory_balances.total_value + excluded.total_value)
        / nullif(public.inventory_balances.on_hand_qty + excluded.on_hand_qty, 0)
    end,
    last_ledger_entry_id = excluded.last_ledger_entry_id,
    last_transaction_date = excluded.last_transaction_date,
    updated_at = now()
  returning on_hand_qty, total_value
    into v_balance_after_qty, v_balance_after_value;

  -- K1 (01/10/2026): không xuất quá tồn. Kiểm tra tổng tồn của vật tư trong kho (mọi phạm vi dự án/lô)
  -- để không chặn nhầm khi hàng nhập và xuất ghi ở hai phạm vi khác nhau của cùng một kho.
  if p_direction = 'out' and coalesce(current_setting('app.inventory_allow_negative', true), '') <> 'on' then
    select coalesce(sum(b.on_hand_qty), 0) into v_total_after
    from public.inventory_balances b where b.material_id = p_material_id and b.warehouse_id = p_warehouse_id;
    if v_total_after < -0.0005 then
      raise exception using errcode = 'P0001',
        message = format('INVENTORY_NEGATIVE_STOCK: Không đủ tồn "%s" tại kho "%s": còn %s %s, cần xuất %s. Kiểm tra lại tồn hoặc nhập bù trước khi xuất.',
          coalesce((select i.name from public.items i where i.id = p_material_id), p_material_id),
          coalesce((select w.name from public.warehouses w where w.id = p_warehouse_id), p_warehouse_id),
          trim(to_char(v_total_after + p_qty, 'FM999G999G990D###')), coalesce(v_unit, ''), trim(to_char(p_qty, 'FM999G999G990D###')));
    end if;
  end if;

  -- V1-3b: phần của dòng thuộc quy cách nào (nhập theo chứng từ; xuất không ghi quy cách → quy cách nhập trước).
  v_spec_alloc := app_private.wms_spec_alloc_for_entry(p_inventory_transaction_id, p_transaction_type, p_direction, p_material_id,
    p_warehouse_id, p_source_code, p_qty, p_metadata);

  insert into public.inventory_ledger_entries (
    id, inventory_transaction_id, entry_no, document_code,
    transaction_date, transaction_type, movement_direction,
    material_id, warehouse_id, project_id, construction_site_id,
    source_type, source_id, source_code, source_line_id, related_request_id,
    quantity_in, quantity_out, unit, unit_price,
    balance_after_qty, balance_after_value,
    description, metadata, created_by, approved_by
  )
  values (
    v_entry_id, p_inventory_transaction_id, p_entry_no, p_document_code,
    p_transaction_date, p_transaction_type, p_direction,
    p_material_id, p_warehouse_id, nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
    p_source_type, p_source_id, p_source_code, nullif(p_source_line_id, ''), nullif(p_related_request_id, ''),
    case when p_direction = 'in' then p_qty else 0 end,
    case when p_direction = 'out' then p_qty else 0 end,
    v_unit, v_price,
    v_balance_after_qty, v_balance_after_value,
    p_description,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('specAllocations', v_spec_alloc) || case when v_price_source is null then '{}'::jsonb
      else jsonb_build_object('priceSource', v_price_source, 'documentPrice', coalesce(p_unit_price, 0))
        || case when v_dirty then jsonb_build_object('dirtyStock', true) else '{}'::jsonb end end,
    p_created_by, p_approved_by
  );

  -- Ngày chứng từ: phiếu xuất ghi lùi ngày không được tạo tồn âm mới trong quá khứ (dữ liệu cũ đang âm không bị khóa).
  if p_direction = 'out' and coalesce(current_setting('app.inventory_allow_negative', true), '') <> 'on'
     and exists (select 1 from public.inventory_ledger_entries e where e.material_id = p_material_id and e.warehouse_id = p_warehouse_id
       and e.transaction_date > p_transaction_date and e.id <> v_entry_id) then
    v_min_after := app_private.wms_min_running_balance(p_material_id, p_warehouse_id, p_transaction_date);
    if v_min_after < -0.0005 and v_min_after + p_qty > -0.0005 then
      raise exception using errcode = 'P0001',
        message = format('WMS_BACKDATE_NEGATIVE: Xuất "%s" tại "%s" ngày %s làm âm tồn trong quá khứ (thấp nhất %s %s). Chọn ngày sau khi hàng về hoặc nhập bù trước.',
          coalesce((select i.name from public.items i where i.id = p_material_id), p_material_id),
          coalesce((select w.name from public.warehouses w where w.id = p_warehouse_id), p_warehouse_id),
          to_char(p_transaction_date at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'), trim(to_char(v_min_after, 'FM999G999G990D###')), coalesce(v_unit, ''));
    end if;
  end if;

  return v_entry_id;
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
    -- V1-3b: tồn theo quy cách (tồn của mã = cộng các dòng), phiếu chuyển quy cách gần đây, quyền chuyển.
    'specs', coalesce((select jsonb_agg(jsonb_build_object('specification', b.specification, 'qty', b.qty) order by b.first_in nulls last, b.spec_key)
      from app_private.wms_spec_balances(p_item_id, p_warehouse_id) b where abs(b.qty) > 0.0000005), '[]'::jsonb),
    'specTransfers', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'date', t.transfer_date, 'fromSpec', t.from_spec, 'toSpec', t.to_spec,
        'qty', t.qty, 'reason', t.reason, 'byName', (select u.name from public.users u where u.id = t.created_by)) order by t.created_at desc)
      from (select * from public.wms_spec_transfers x where x.material_id = p_item_id and x.warehouse_id = p_warehouse_id
        order by x.created_at desc limit 20) t), '[]'::jsonb),
    'canTransferSpec', app_private.wms_can_transfer_spec(public.current_app_user_id(), p_warehouse_id),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('date', e.transaction_date, 'code', e.document_code, 'type', e.transaction_type,
        'qtyIn', e.quantity_in, 'qtyOut', e.quantity_out, 'unitPrice', e.unit_price, 'amount', e.amount, 'description', e.description,
        'fromSku', case when e.material_id <> p_item_id then (select m.sku from public.items m where m.id = e.material_id) end,
        'enteredAt', e.created_at, 'event', e.business_event_type, 'specification', nullif(btrim(coalesce(e.metadata->>'specification', '')), ''),
        'specAllocations', case when e.material_id = p_item_id then e.metadata->'specAllocations' end)
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


-- Bù dữ liệu: gắn phân bổ quy cách cho toàn bộ sổ kho, theo đúng thứ tự đã ghi.
do $$
declare e record;
begin
  for e in select l.id, l.inventory_transaction_id, l.transaction_type, l.movement_direction, l.material_id, l.warehouse_id, l.source_code,
      greatest(l.quantity_in, l.quantity_out) q, l.metadata
    from public.inventory_ledger_entries l where not (l.metadata ? 'specAllocations')
    order by l.created_at, l.inventory_transaction_id, l.entry_no
  loop
    update public.inventory_ledger_entries set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('specAllocations',
      app_private.wms_spec_alloc_for_entry(e.inventory_transaction_id, e.transaction_type, e.movement_direction, e.material_id, e.warehouse_id,
        e.source_code, e.q, e.metadata))
    where id = e.id;
  end loop;
end $$;

revoke all on function app_private.wms_spec_balances(text, text), app_private.wms_spec_alloc_add(jsonb, text, numeric),
  app_private.wms_spec_take(jsonb, numeric, text), app_private.wms_spec_alloc_for_entry(uuid, text, text, text, text, text, numeric, jsonb),
  app_private.wms_can_transfer_spec(uuid, text) from public, anon;
revoke all on function public.transfer_wms_item_spec_v1(jsonb) from public, anon;
grant execute on function public.transfer_wms_item_spec_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
