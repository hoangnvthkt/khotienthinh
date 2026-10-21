-- Danh sách quy cách chuẩn của từng mã (doc 13 mục 9.3, 16.3 — chủ SP duyệt 03–04/10/2026; làm 10/10/2026).
--   * item_specs: mỗi mã một danh sách quy cách. So trùng theo khóa chuẩn hóa như tên mã (catalog_name_key: bỏ dấu,
--     hoa thường, dấu cách, - _ / ( ) ., "x" / "*" / "×", dấu phẩy thập phân, "ly" = mm). Mỗi mã không có 2 quy cách trùng khóa.
--   * Quy cách mới gõ trên đơn mua / bảng giá HĐ / phiếu chuyển quy cách tự vào danh sách với trạng thái "chờ rà" (nhãn "mới"),
--     không chặn đơn. Người Cấp mã rà: Giữ, Sửa chữ, Gộp vào…, Ngừng dùng (là ghi chú / vật tư khác / không dùng nữa).
--   * Sửa chữ / gộp: tồn của quy cách cũ chuyển sang quy cách mới bằng phiếu chuyển quy cách (có lịch sử); tên cũ giữ làm
--     "tên khác" để gõ lại vẫn ra đúng quy cách. Chứng từ đã lập giữ nguyên chữ đã ghi.
--   * Ngừng dùng: chặn khi còn tồn ở kho nào hoặc còn hàng đang về theo quy cách đó.
--   * Từ bản này so quy cách (giá HĐ, tồn theo quy cách, chuyển quy cách) dùng cùng khóa chuẩn hóa.
-- Bù dữ liệu: quy cách đang có trên đơn mua, bảng giá HĐ, sổ kho vào danh sách ở trạng thái "chờ rà".

-- So quy cách = so tên mã (cùng quy tắc chuẩn hóa), thêm "1,5ly" viết liền số = 1.5mm.
create or replace function app_private.spec_key(p text)
returns text language sql stable set search_path = ''
as $$ select app_private.catalog_name_key(regexp_replace(coalesce(p, ''), '([0-9])[[:space:]]*ly\M', '\1mm', 'gi')) $$;

create or replace function app_private.wms_spec_alloc_add(p_alloc jsonb, p_spec text, p_qty numeric)
returns jsonb language plpgsql stable set search_path = ''
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

create or replace function app_private.wms_spec_take(p_pool jsonb, p_qty numeric, p_rest_spec text)
returns jsonb language plpgsql stable set search_path = ''
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

create table if not exists public.item_specs (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.items(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  norm_key text not null check (norm_key <> ''),
  status text not null default 'pending' check (status in ('active', 'pending', 'retired', 'merged')),
  merged_into_id uuid references public.item_specs(id),
  source text not null default 'catalog' check (source in ('catalog', 'purchase', 'contract', 'warehouse', 'backfill')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  last_used_at timestamptz,
  unique (item_id, norm_key),
  check (status <> 'merged' or merged_into_id is not null)
);
comment on table public.item_specs is 'Danh sách quy cách chuẩn của từng mã. merged = tên cũ / quy cách đã gộp, trỏ tới quy cách giữ.';
alter table public.item_specs enable row level security;
revoke all on public.item_specs from anon, authenticated;

alter table public.item_catalog_events drop constraint if exists item_catalog_events_action_check;
alter table public.item_catalog_events add constraint item_catalog_events_action_check check (action = any (array['issue', 'update', 'rename', 'retire',
  'reactivate', 'mode', 'use_existing', 'reject', 'merge', 'merge_into', 'spec']));

-- Ghi quy cách gõ trên chứng từ vào danh sách (mới → chờ rà). Trả id quy cách (đã gộp → quy cách giữ).
create or replace function app_private.item_spec_register(p_item text, p_spec text, p_source text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_name text := left(nullif(btrim(regexp_replace(coalesce(p_spec, ''), '\s+', ' ', 'g')), ''), 80);
  v_key text := app_private.spec_key(p_spec); v_row public.item_specs%rowtype;
begin
  if v_name is null or coalesce(v_key, '') = '' or p_item is null or not exists (select 1 from public.items where id = p_item) then return null; end if;
  insert into public.item_specs (item_id, name, norm_key, status, source, created_by, last_used_at)
  values (p_item, v_name, v_key, 'pending', p_source, p_actor, now())
  on conflict (item_id, norm_key) do update set last_used_at = now(),
    -- Quy cách đã ngừng dùng mà chứng từ dùng lại → đưa về chờ rà.
    status = case when public.item_specs.status = 'retired' then 'pending' else public.item_specs.status end
  returning * into v_row;
  return coalesce(v_row.merged_into_id, v_row.id);
end;
$$;

create or replace function app_private.trg_item_spec_from_po()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare x jsonb;
begin
  if jsonb_typeof(new.items) <> 'array' or (tg_op = 'UPDATE' and new.items is not distinct from old.items) then return null; end if;
  for x in select value from jsonb_array_elements(new.items) where nullif(btrim(value->>'specification'), '') is not null loop
    perform app_private.item_spec_register(x->>'itemId', x->>'specification', 'purchase',
      app_private.uuid_or_null(coalesce(new.last_action_by, new.created_by_id)));
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_item_spec_from_po on public.purchase_orders;
create trigger trg_item_spec_from_po after insert or update of items on public.purchase_orders
  for each row execute function app_private.trg_item_spec_from_po();

create or replace function app_private.trg_item_spec_from_contract_line()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.item_spec_register(new.item_id, new.specification, 'contract', public.current_app_user_id());
  return null;
end;
$$;
drop trigger if exists trg_item_spec_from_contract_line on public.supplier_contract_lines;
create trigger trg_item_spec_from_contract_line after insert or update of specification on public.supplier_contract_lines
  for each row when (nullif(btrim(new.specification), '') is not null) execute function app_private.trg_item_spec_from_contract_line();

create or replace function app_private.trg_item_spec_from_transfer()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform app_private.item_spec_register(new.material_id, new.to_spec, 'warehouse', new.created_by);
  return null;
end;
$$;
drop trigger if exists trg_item_spec_from_transfer on public.wms_spec_transfers;
create trigger trg_item_spec_from_transfer after insert on public.wms_spec_transfers
  for each row execute function app_private.trg_item_spec_from_transfer();

-- Hàng đang về theo quy cách: đơn chưa giao xong, SL đặt (đơn vị kho) trừ SL đã nhận.
create or replace function app_private.item_spec_incoming(p_item text, p_key text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(greatest(coalesce(nullif(x->>'stockQty', '')::numeric, nullif(x->>'qty', '')::numeric, 0)
      - coalesce(nullif(x->>'receivedQty', '')::numeric, 0), 0)), 0)
  from public.purchase_orders po cross join lateral jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) x
  where po.status in ('sent', 'confirmed', 'partial', 'in_transit') and po.archived_at is null
    and x->>'itemId' = p_item and app_private.spec_key(x->>'specification') = p_key;
$$;

-- Tồn theo kho của một quy cách (mọi kho có sổ của mã).
create or replace function app_private.item_spec_stock(p_item text, p_key text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('warehouseId', w.id, 'warehouseName', w.name, 'qty', b.qty) order by w.name), '[]'::jsonb)
  from (select distinct warehouse_id from public.inventory_ledger_entries where material_id = p_item
        union select distinct warehouse_id from public.wms_spec_transfers where material_id = p_item) k
  join public.warehouses w on w.id = k.warehouse_id
  cross join lateral app_private.wms_spec_balances(p_item, k.warehouse_id) b
  where b.spec_key = p_key and abs(b.qty) > 0.0000005;
$$;

create or replace function app_private.item_spec_json(p_spec public.item_specs)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('id', p_spec.id, 'itemId', p_spec.item_id, 'name', p_spec.name, 'status', p_spec.status, 'source', p_spec.source,
    'note', p_spec.note, 'createdAt', p_spec.created_at, 'createdByName', (select name from public.users where id = p_spec.created_by),
    'reviewedAt', p_spec.reviewed_at, 'reviewedByName', (select name from public.users where id = p_spec.reviewed_by), 'lastUsedAt', p_spec.last_used_at,
    'aliases', coalesce((select jsonb_agg(a.name order by a.name) from public.item_specs a where a.merged_into_id = p_spec.id), '[]'::jsonb),
    'stock', app_private.item_spec_stock(p_spec.item_id, p_spec.norm_key),
    'incoming', app_private.item_spec_incoming(p_spec.item_id, p_spec.norm_key),
    'orders', (select count(*) from public.purchase_orders po
      cross join lateral jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) x
      where x->>'itemId' = p_spec.item_id and app_private.spec_key(x->>'specification') = p_spec.norm_key));
$$;

-- Gợi ý khi gõ: quy cách đang dùng + chờ rà của các mã (ai lập chứng từ cũng xem được).
create or replace function public.get_item_specs_v1(p_item_ids text[])
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(z.item_id, z.specs), '{}'::jsonb) from (
    select s.item_id, jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status,
        'aliases', coalesce((select jsonb_agg(a.name) from public.item_specs a where a.merged_into_id = s.id), '[]'::jsonb))
      order by s.status, s.name) specs
    from public.item_specs s where s.item_id = any (p_item_ids) and s.status in ('active', 'pending') and public.current_app_user_id() is not null
    group by s.item_id) z;
$$;

-- Danh mục: quy cách của một mã (kèm tồn từng kho, đang về, số đơn đã dùng).
create or replace function public.list_item_specs_v1(p_item_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'CATALOG_VIEW_DENIED'; end if;
  return jsonb_build_object('canManage', app_private.wms_can_issue_code(),
    'specs', coalesce((select jsonb_agg(app_private.item_spec_json(s) order by case s.status when 'pending' then 0 when 'active' then 1 else 2 end, s.name)
      from public.item_specs s where s.item_id = p_item_id and s.status <> 'merged'), '[]'::jsonb));
end;
$$;

-- Ô "Quy cách chờ rà" của Danh mục.
create or replace function public.list_pending_item_specs_v1()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'CATALOG_VIEW_DENIED'; end if;
  return jsonb_build_object('canManage', app_private.wms_can_issue_code(),
    'specs', coalesce((select jsonb_agg(app_private.item_spec_json(s) || jsonb_build_object('itemName', i.name, 'sku', i.sku, 'unit', i.unit,
        'siblings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status) order by o.name)
          from public.item_specs o where o.item_id = s.item_id and o.id <> s.id and o.status in ('active', 'pending')), '[]'::jsonb))
      order by s.created_at)
      from public.item_specs s join public.items i on i.id = s.item_id where s.status = 'pending'), '[]'::jsonb));
end;
$$;

-- Chuyển tồn của một quy cách sang quy cách khác ở mọi kho (khi sửa chữ / gộp).
create or replace function app_private.item_spec_move_stock(p_item text, p_from_key text, p_from_name text, p_to_name text, p_reason text, p_actor uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare r record; v_id uuid; v_n integer := 0;
begin
  for r in select k.warehouse_id, b.qty, b.specification
    from (select distinct warehouse_id from public.inventory_ledger_entries where material_id = p_item
          union select distinct warehouse_id from public.wms_spec_transfers where material_id = p_item) k
    cross join lateral app_private.wms_spec_balances(p_item, k.warehouse_id) b
    where b.spec_key = p_from_key and b.qty > 0.0000005
  loop
    v_id := gen_random_uuid();
    insert into public.wms_spec_transfers (id, code, material_id, warehouse_id, from_spec, to_spec, qty, reason, transfer_date, created_by)
    values (v_id, 'CQC-' || to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYMMDD') || '-' || upper(substr(md5(v_id::text), 1, 5)),
      p_item, r.warehouse_id, coalesce(r.specification, p_from_name), p_to_name, r.qty, p_reason, (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_actor);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.manage_item_spec_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p->>'action';
  v_name text := left(nullif(btrim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g')), ''), 81);
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_s public.item_specs%rowtype; v_t public.item_specs%rowtype; v_dup public.item_specs%rowtype;
  v_key text; v_moved integer := 0; v_has_stock boolean; v_old text;
begin
  if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'; end if;
  if v_action = 'add' then
    if not exists (select 1 from public.items where id = p->>'itemId') then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
    v_key := app_private.spec_key(v_name);
    if v_name is null or length(v_name) > 80 or v_key = '' then raise exception using errcode = '22023', message = 'ITEM_SPEC_NAME_INVALID'; end if;
    select * into v_dup from public.item_specs where item_id = p->>'itemId' and norm_key = v_key;
    if found then
      if v_dup.status in ('retired', 'pending') then
        update public.item_specs set status = 'active', reviewed_by = v_actor, reviewed_at = now() where id = v_dup.id returning * into v_s;
      else raise exception using errcode = '23505', message = 'ITEM_SPEC_DUPLICATE:' || coalesce((select name from public.item_specs where id = coalesce(v_dup.merged_into_id, v_dup.id)), v_dup.name);
      end if;
    else
      insert into public.item_specs (item_id, name, norm_key, status, source, created_by, reviewed_by, reviewed_at)
      values (p->>'itemId', v_name, v_key, 'active', 'catalog', v_actor, v_actor, now()) returning * into v_s;
    end if;
  else
    select * into v_s from public.item_specs where id = app_private.uuid_or_null(p->>'specId') for update;
    if not found or v_s.status = 'merged' then raise exception using errcode = 'P0002', message = 'ITEM_SPEC_NOT_FOUND'; end if;
    perform pg_advisory_xact_lock(hashtext('item_spec:' || v_s.item_id));
    v_old := v_s.name;
    if v_action = 'approve' then
      if v_s.status <> 'pending' then raise exception using errcode = '22023', message = 'ITEM_SPEC_STATE'; end if;
      update public.item_specs set status = 'active', reviewed_by = v_actor, reviewed_at = now() where id = v_s.id returning * into v_s;
    elsif v_action = 'rename' then
      v_key := app_private.spec_key(v_name);
      if v_name is null or length(v_name) > 80 or v_key = '' then raise exception using errcode = '22023', message = 'ITEM_SPEC_NAME_INVALID'; end if;
      if v_name = v_s.name then raise exception using errcode = '22023', message = 'ITEM_SPEC_SAME'; end if;
      select * into v_dup from public.item_specs where item_id = v_s.item_id and norm_key = v_key and id <> v_s.id;
      if found then raise exception using errcode = '23505', message = 'ITEM_SPEC_DUPLICATE:' || coalesce((select name from public.item_specs where id = coalesce(v_dup.merged_into_id, v_dup.id)), v_dup.name); end if;
      if v_key <> v_s.norm_key then
        update public.item_specs set name = v_name, norm_key = v_key, status = case when status = 'pending' then 'active' else status end,
          reviewed_by = v_actor, reviewed_at = now() where id = v_s.id;
        -- Tên cũ giữ làm tên khác: gõ lại vẫn ra đúng quy cách.
        insert into public.item_specs (item_id, name, norm_key, status, merged_into_id, source, created_by, note)
        values (v_s.item_id, v_s.name, v_s.norm_key, 'merged', v_s.id, v_s.source, v_s.created_by, 'Tên cũ trước khi sửa chữ');
        -- Chuyển tồn sau khi đổi tên (phiếu chuyển tự ghi tên mới vào danh sách — đã có nên không tạo trùng).
        v_moved := app_private.item_spec_move_stock(v_s.item_id, v_s.norm_key, v_s.name, v_name, 'Sửa chữ quy cách "' || v_s.name || '" → "' || v_name || '"', v_actor);
      else
        update public.item_specs set name = v_name, status = case when status = 'pending' then 'active' else status end,
          reviewed_by = v_actor, reviewed_at = now() where id = v_s.id;
      end if;
      select * into v_s from public.item_specs where id = v_s.id;
    elsif v_action = 'merge' then
      select * into v_t from public.item_specs where id = app_private.uuid_or_null(p->>'targetId') and item_id = v_s.item_id and status in ('active', 'pending') and id <> v_s.id;
      if not found then raise exception using errcode = '22023', message = 'ITEM_SPEC_TARGET_INVALID'; end if;
      v_moved := app_private.item_spec_move_stock(v_s.item_id, v_s.norm_key, v_s.name, v_t.name, 'Gộp quy cách "' || v_s.name || '" vào "' || v_t.name || '"', v_actor);
      update public.item_specs set merged_into_id = v_t.id where merged_into_id = v_s.id;
      update public.item_specs set status = 'merged', merged_into_id = v_t.id, reviewed_by = v_actor, reviewed_at = now(), note = v_reason where id = v_s.id returning * into v_s;
      update public.item_specs set status = 'active', reviewed_by = v_actor, reviewed_at = now() where id = v_t.id and status = 'pending';
    elsif v_action = 'retire' then
      if v_reason is null then raise exception using errcode = '22023', message = 'CATALOG_REASON_REQUIRED'; end if;
      select exists (select 1 from jsonb_array_elements(app_private.item_spec_stock(v_s.item_id, v_s.norm_key)) x where (x->>'qty')::numeric > 0.0000005) into v_has_stock;
      if v_has_stock then raise exception using errcode = '22023', message = 'ITEM_SPEC_HAS_STOCK'; end if;
      if app_private.item_spec_incoming(v_s.item_id, v_s.norm_key) > 0.0000005 then raise exception using errcode = '22023', message = 'ITEM_SPEC_INCOMING'; end if;
      update public.item_specs set status = 'retired', note = v_reason, reviewed_by = v_actor, reviewed_at = now() where id = v_s.id returning * into v_s;
    elsif v_action = 'reactivate' then
      if v_s.status <> 'retired' then raise exception using errcode = '22023', message = 'ITEM_SPEC_STATE'; end if;
      update public.item_specs set status = 'active', note = null, reviewed_by = v_actor, reviewed_at = now() where id = v_s.id returning * into v_s;
    else
      raise exception using errcode = '22023', message = 'CATALOG_ACTION_INVALID';
    end if;
  end if;
  insert into public.item_catalog_events (item_id, action, before, after, reason, actor_id)
  values (v_s.item_id, 'spec', jsonb_build_object('op', coalesce(v_action, ''), 'spec', coalesce(v_old, v_s.name)),
    jsonb_build_object('spec', v_s.name, 'status', v_s.status, 'target', v_t.name, 'moved', v_moved), v_reason, v_actor);
  return app_private.item_spec_json(v_s) || jsonb_build_object('moved', v_moved);
end;
$$;

-- Bù dữ liệu: quy cách đang có trên đơn mua, bảng giá HĐ, sổ kho, phiếu chuyển → "chờ rà".
do $$
declare r record; v_id uuid;
begin
  for r in
    select item, spec, min(at) at from (
      select x->>'itemId' item, x->>'specification' spec, po.created_at at from public.purchase_orders po
        cross join lateral jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) x
        where nullif(btrim(x->>'specification'), '') is not null
      union all select item_id, specification, created_at from public.supplier_contract_lines where nullif(btrim(specification), '') is not null
      union all select e.material_id, a->>'specification', e.created_at from public.inventory_ledger_entries e
        cross join lateral jsonb_array_elements(case when jsonb_typeof(e.metadata->'specAllocations') = 'array' then e.metadata->'specAllocations' else '[]'::jsonb end) a
        where nullif(btrim(a->>'specification'), '') is not null
      union all select material_id, to_spec, created_at from public.wms_spec_transfers) z
    group by item, spec order by min(at)
  loop
    v_id := app_private.item_spec_register(r.item, r.spec, 'backfill', null);
    -- Ngày tạo = lần đầu quy cách xuất hiện trên chứng từ.
    update public.item_specs set created_at = least(created_at, r.at) where id = v_id and source = 'backfill';
  end loop;
end $$;

revoke all on function app_private.item_spec_register(text, text, text, uuid), app_private.trg_item_spec_from_po(),
  app_private.trg_item_spec_from_contract_line(), app_private.trg_item_spec_from_transfer(), app_private.item_spec_incoming(text, text),
  app_private.item_spec_stock(text, text), app_private.item_spec_json(public.item_specs),
  app_private.item_spec_move_stock(text, text, text, text, text, uuid) from public, anon;
revoke all on function public.get_item_specs_v1(text[]), public.list_item_specs_v1(text), public.list_pending_item_specs_v1(),
  public.manage_item_spec_v1(jsonb) from public, anon;
grant execute on function public.get_item_specs_v1(text[]), public.list_item_specs_v1(text), public.list_pending_item_specs_v1(),
  public.manage_item_spec_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
