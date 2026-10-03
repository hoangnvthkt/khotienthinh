-- V1-1 Module Vật tư: Danh mục vật tư một cửa + Tồn kho một nguồn số.
-- Luật nghiệp vụ (chủ sản phẩm chốt 03/10/2026, docs/designs/project-closed-loop-2026-09-30/13-module-vat-tu-ra-soat.md):
--  1. Chỉ người có ô quyền "Danh mục kho → Cấp mã" (wms.master_data.issue_code) hoặc Admin được tạo / sửa mã vật tư.
--     Không còn cửa tạo mã ở màn Tồn kho hay Cài đặt → Dữ liệu gốc.
--  2. Không xóa vật tư. Thay bằng Ngừng dùng — chỉ khi tồn = 0 ở mọi kho và mã không nằm trong đơn mua đang mở. Mở lại được.
--  3. Mã đã phát sinh (sổ kho, phiếu kho, đơn mua, đề xuất) chỉ được sửa chính tả tên, bắt buộc lý do.
--     Tên mới làm mất con số kích thước của tên cũ, hoặc khác hẳn tên cũ (độ giống < 0,2) → chặn: đề xuất mã mới.
--     Mã đã phát sinh không được đổi đơn vị tính kho.
--  4. Mỗi mã có cách quản lý kho: stock (Lưu kho) / use (Dùng ngay) / service (Không qua kho).
--  5. Mã mới tự sinh "VT" + 7 chữ số tăng dần. Không cho tạo trùng tên (so sau chuẩn hóa: bỏ dấu, chữ thường, bỏ khoảng trắng/ký tự nối).
--  6. Màn Tồn kho đọc thẳng sổ kho (inventory_balances / inventory_ledger_entries), không đọc items.stock_by_warehouse.
--  Mọi thao tác danh mục ghi vào item_catalog_events (ai, lúc nào, trước/sau, lý do).

-- ---------------------------------------------------------------------------------------------
-- 1. Cột mới của vật tư
-- ---------------------------------------------------------------------------------------------
alter table public.items
  add column if not exists status text not null default 'active',
  add column if not exists inventory_mode text not null default 'stock',
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by uuid references public.users(id) on delete set null,
  add column if not exists retired_reason text;
alter table public.items add constraint items_status_check check (status in ('active', 'retired'));
alter table public.items add constraint items_inventory_mode_check check (inventory_mode in ('stock', 'use', 'service'));

alter table public.material_code_requests add column if not exists resolution text;
alter table public.material_code_requests add constraint material_code_requests_resolution_check
  check (resolution is null or resolution in ('issued', 'existing', 'rejected'));

-- ---------------------------------------------------------------------------------------------
-- 2. Nhật ký danh mục
-- ---------------------------------------------------------------------------------------------
create table public.item_catalog_events (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  action text not null check (action in ('issue', 'update', 'rename', 'retire', 'reactivate', 'mode', 'use_existing', 'reject')),
  before jsonb,
  after jsonb,
  reason text,
  request_id text,
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index item_catalog_events_item_idx on public.item_catalog_events (item_id, created_at desc);
alter table public.item_catalog_events enable row level security;
create policy item_catalog_events_select on public.item_catalog_events for select to authenticated
  using (app_private.wms_has_action('wms.inventory.view') or app_private.wms_has_action('wms.master_data.manage'));
revoke all on public.item_catalog_events from anon;
grant select on public.item_catalog_events to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Ô quyền "Cấp mã"
-- ---------------------------------------------------------------------------------------------
insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes, legacy_module_key,
  legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code, direct_grant_allowed)
values ('wms.master_data', 'issue_code', 'wms.master_data.issue_code', 'Cấp mã',
  'Cấp mã vật tư, sửa danh mục, ngừng dùng / mở lại, đặt cách quản lý kho, xử lý đề xuất cấp mã',
  array['global'], 'WMS', '/material-code-requests', false, 20, true, 'important', true, false, false, 'enforced', 'wms', true)
on conflict (permission_code) do nothing;

create function app_private.wms_can_issue_code()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin()
    or app_private.has_permission(public.current_app_user_id(), 'wms.master_data.issue_code', 'global', '*'));
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Hàm phụ
-- ---------------------------------------------------------------------------------------------
-- Khóa so trùng tên: bỏ dấu, chữ thường, x/*/× như nhau, phẩy = chấm, "ly" = "mm", bỏ khoảng trắng và ký tự nối.
create function app_private.catalog_name_key(p_name text)
returns text language sql stable set search_path = '' as $$
  select regexp_replace(regexp_replace(translate(replace(lower(public.unaccent('public.unaccent'::regdictionary, coalesce(p_name, ''))), ',', '.'), '×*', 'xx'),
    '\mly\M', 'mm', 'g'), '[[:space:]\-_/().]+', '', 'g');
$$;

-- Các con số trong tên (kích thước, quy cách): "Chếch PVC 125" → {125}.
create function app_private.catalog_name_numbers(p_name text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct replace(m[1], ',', '.')), '{}')
  from regexp_matches(coalesce(p_name, ''), '([0-9]+(?:[.,][0-9]+)?)', 'g') m;
$$;

-- Mức dùng của một mã: còn tồn, sổ kho, phiếu kho, đơn mua (và đơn đang mở), đề xuất.
create function app_private.catalog_item_usage(p_item_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'stockQty', coalesce((select sum(abs(b.on_hand_qty)) from public.inventory_balances b where b.material_id = p_item_id), 0),
    'ledger', (select count(*) from public.inventory_ledger_entries e where e.material_id = p_item_id),
    'transactions', (select count(*) from public.transactions t where t.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id))),
    'purchaseOrders', (select count(*) from public.purchase_orders po where po.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id))),
    'openPurchaseOrders', (select count(*) from public.purchase_orders po where po.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id))
      and po.status::text not in ('closed', 'cancelled', 'delivered')),
    'requests', (select count(*) from public.requests r where r.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id))));
$$;

-- Mã đã có chứng từ TRƯỚC thời điểm p_at chưa (để biết lần đổi tên có làm chứng từ cũ hiện sai tên không).
create function app_private.catalog_item_used_before(p_item_id text, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.inventory_ledger_entries e where e.material_id = p_item_id and e.created_at < p_at)
    or exists (select 1 from public.transactions t where t.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id)) and t.created_at < p_at)
    or exists (select 1 from public.purchase_orders po where po.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id)) and po.created_at < p_at)
    or exists (select 1 from public.requests r where r.items @> jsonb_build_array(jsonb_build_object('itemId', p_item_id)) and r.created_date < p_at);
$$;

create function app_private.catalog_item_is_used(p_usage jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select (p_usage->>'stockQty')::numeric > 0 or (p_usage->>'ledger')::int > 0 or (p_usage->>'transactions')::int > 0
    or (p_usage->>'purchaseOrders')::int > 0 or (p_usage->>'requests')::int > 0;
$$;

create function app_private.catalog_item_json(p_item public.items)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_item.id, 'sku', p_item.sku, 'name', p_item.name, 'unit', p_item.unit, 'category', p_item.category,
    'purchaseUnit', p_item.purchase_unit, 'purchaseConversionFactor', p_item.purchase_conversion_factor, 'minStock', p_item.min_stock,
    'accountingCode', p_item.accounting_code, 'status', p_item.status, 'inventoryMode', p_item.inventory_mode,
    'retiredAt', p_item.retired_at, 'retiredReason', p_item.retired_reason, 'createdAt', p_item.created_at);
$$;

create function app_private.catalog_log(p_item_id text, p_action text, p_before jsonb, p_after jsonb, p_reason text, p_request_id text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.item_catalog_events (item_id, action, before, after, reason, request_id, actor_id)
  values (p_item_id, p_action, p_before, p_after, nullif(btrim(coalesce(p_reason, '')), ''), p_request_id, public.current_app_user_id());
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Chặn ở tầng dữ liệu
-- ---------------------------------------------------------------------------------------------
create function app_private.guard_items_catalog()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('app.catalog_command', true), '') <> 'delete' then
      raise exception using errcode = 'P0001', message = 'ITEM_DELETE_FORBIDDEN: Không xóa vật tư. Dùng "Ngừng dùng" trong Danh mục vật tư.';
    end if;
    return old;
  end if;
  if (new.sku, new.name, new.unit, new.category, new.purchase_unit, new.purchase_conversion_factor, new.status, new.inventory_mode)
     is distinct from (old.sku, old.name, old.unit, old.category, old.purchase_unit, old.purchase_conversion_factor, old.status, old.inventory_mode)
     and coalesce(current_setting('app.catalog_command', true), '') <> 'on' then
    raise exception using errcode = 'P0001', message = 'ITEM_CATALOG_VIA_RPC: Sửa mã, tên, ĐVT, nhóm, quy đổi, trạng thái ở Danh mục vật tư.';
  end if;
  return new;
end $$;
create trigger trg_guard_items_catalog before update or delete on public.items
  for each row execute function app_private.guard_items_catalog();

-- Một cửa tạo mã: chỉ người Cấp mã / Admin (thay quyền Sửa tồn kho, Quản trị danh mục, Cài đặt dữ liệu gốc).
alter policy items_phase4_insert on public.items with check (app_private.wms_can_issue_code());
drop policy if exists items_settings_insert on public.items;
-- Đề xuất cấp mã chỉ được xử lý qua hàm (cấp mã / dùng mã có sẵn / từ chối).
alter policy material_code_requests_update on public.material_code_requests
  using (app_private.wms_can_issue_code()) with check (app_private.wms_can_issue_code());

-- ---------------------------------------------------------------------------------------------
-- 6. Danh mục: cấp mã, xử lý đề xuất, sửa, ngừng dùng, cách quản lý
-- ---------------------------------------------------------------------------------------------
create function public.issue_material_code_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_name text := btrim(coalesce(p->>'name', ''));
  v_unit text := btrim(coalesce(p->>'unit', ''));
  v_category text := btrim(coalesce(p->>'category', ''));
  v_pu text := nullif(btrim(coalesce(p->>'purchaseUnit', '')), '');
  v_factor numeric := coalesce(nullif(p->>'purchaseConversionFactor', '')::numeric, 1);
  v_mode text := coalesce(nullif(p->>'inventoryMode', ''), 'stock');
  v_request_id text := nullif(p->>'requestId', '');
  v_req public.material_code_requests%rowtype;
  v_dup public.items%rowtype;
  v_next bigint;
  v_item public.items%rowtype;
begin
  if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'; end if;
  if v_name = '' or v_unit = '' or v_category = '' then raise exception using errcode = '22023', message = 'CATALOG_FIELDS_REQUIRED'; end if;
  if v_mode not in ('stock', 'use', 'service') then raise exception using errcode = '22023', message = 'CATALOG_MODE_INVALID'; end if;
  if v_factor <= 0 then raise exception using errcode = '22023', message = 'CATALOG_FACTOR_INVALID'; end if;
  if v_request_id is not null then
    select * into v_req from public.material_code_requests where id = v_request_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'CODE_REQUEST_NOT_FOUND'; end if;
    if v_req.status <> 'pending' then raise exception using errcode = '22023', message = 'CODE_REQUEST_NOT_PENDING'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('public.items.sku'));
  select * into v_dup from public.items i
  where i.status = 'active' and app_private.catalog_name_key(i.name) = app_private.catalog_name_key(v_name) limit 1;
  if found then raise exception using errcode = '23505', message = 'ITEM_NAME_DUPLICATE:' || coalesce(v_dup.sku, v_dup.id); end if;
  select coalesce(max((substring(sku from '^VT([0-9]{7})$'))::bigint), 0) + 1 into v_next from public.items where sku ~ '^VT[0-9]{7}$';
  perform set_config('app.catalog_command', 'on', true);
  insert into public.items (id, sku, name, category, unit, purchase_unit, purchase_conversion_factor, min_stock, price_in, price_out,
    stock_by_warehouse, inventory_mode, status, created_at)
  values ('it-' || replace(gen_random_uuid()::text, '-', ''), 'VT' || lpad(v_next::text, 7, '0'), v_name, v_category, v_unit, v_pu,
    case when v_pu is null then 1 else v_factor end, greatest(coalesce(nullif(p->>'minStock', '')::int, 0), 0), 0, 0, '{}'::jsonb, v_mode, 'active', now())
  returning * into v_item;
  perform set_config('app.catalog_command', '', true);
  if v_request_id is not null then
    update public.material_code_requests set status = 'approved', resolution = 'issued', approved_sku = v_item.sku, approved_item_id = v_item.id,
      approved_by_user_id = v_actor, approved_by_name = (select name from public.users where id = v_actor), approved_at = now(), updated_at = now(), rejection_reason = null
    where id = v_request_id;
  end if;
  perform app_private.catalog_log(v_item.id, 'issue', null, app_private.catalog_item_json(v_item), p->>'reason', v_request_id);
  return app_private.catalog_item_json(v_item);
end $$;

-- Dùng mã có sẵn hoặc từ chối đề xuất cấp mã (bắt buộc lý do khi từ chối).
create function public.resolve_material_code_request_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_req public.material_code_requests%rowtype;
  v_item public.items%rowtype;
  v_action text := p->>'action';
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
begin
  if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'; end if;
  select * into v_req from public.material_code_requests where id = p->>'requestId' for update;
  if not found then raise exception using errcode = 'P0002', message = 'CODE_REQUEST_NOT_FOUND'; end if;
  if v_req.status <> 'pending' then raise exception using errcode = '22023', message = 'CODE_REQUEST_NOT_PENDING'; end if;
  if v_action = 'use_existing' then
    select * into v_item from public.items where id = p->>'itemId';
    if not found then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
    if v_item.status <> 'active' then raise exception using errcode = '22023', message = 'ITEM_RETIRED'; end if;
    update public.material_code_requests set status = 'approved', resolution = 'existing', approved_sku = v_item.sku, approved_item_id = v_item.id,
      approved_by_user_id = v_actor, approved_by_name = (select name from public.users where id = v_actor), approved_at = now(), updated_at = now(),
      rejection_reason = coalesce(v_reason, 'Dùng mã có sẵn ' || v_item.sku)
    where id = v_req.id;
    perform app_private.catalog_log(v_item.id, 'use_existing', null, jsonb_build_object('requestCode', v_req.code, 'proposedName', v_req.proposed_name), v_reason, v_req.id);
  elsif v_action = 'reject' then
    if v_reason is null then raise exception using errcode = '22023', message = 'CATALOG_REASON_REQUIRED'; end if;
    update public.material_code_requests set status = 'rejected', resolution = 'rejected', approved_by_user_id = v_actor,
      approved_by_name = (select name from public.users where id = v_actor), rejection_reason = v_reason, updated_at = now()
    where id = v_req.id;
    perform app_private.catalog_log(v_req.id, 'reject', null, jsonb_build_object('requestCode', v_req.code, 'proposedName', v_req.proposed_name), v_reason, v_req.id);
  else
    raise exception using errcode = '22023', message = 'CATALOG_ACTION_INVALID';
  end if;
  return jsonb_build_object('requestId', v_req.id, 'action', v_action);
end $$;

-- Sửa mã: tên, ĐVT, nhóm, ĐV mua × hệ số, tồn tối thiểu. Luật đổi tên / ĐVT cho mã đã phát sinh ở đầu file.
create function public.update_catalog_item_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old public.items%rowtype;
  v_new public.items%rowtype;
  v_usage jsonb;
  v_used boolean;
  v_name text;
  v_unit text;
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_dup public.items%rowtype;
begin
  if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'; end if;
  select * into v_old from public.items where id = p->>'itemId' for update;
  if not found then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
  v_usage := app_private.catalog_item_usage(v_old.id);
  v_used := app_private.catalog_item_is_used(v_usage);
  v_name := coalesce(nullif(btrim(p->>'name'), ''), v_old.name);
  v_unit := coalesce(nullif(btrim(p->>'unit'), ''), v_old.unit);
  if v_name is distinct from v_old.name then
    select * into v_dup from public.items i where i.id <> v_old.id and i.status = 'active'
      and app_private.catalog_name_key(i.name) = app_private.catalog_name_key(v_name) limit 1;
    if found then raise exception using errcode = '23505', message = 'ITEM_NAME_DUPLICATE:' || coalesce(v_dup.sku, v_dup.id); end if;
    if v_used then
      if v_reason is null then raise exception using errcode = '22023', message = 'CATALOG_REASON_REQUIRED'; end if;
      if not (app_private.catalog_name_numbers(v_old.name) <@ app_private.catalog_name_numbers(v_name))
         or public.similarity(lower(public.unaccent('public.unaccent'::regdictionary, v_old.name)), lower(public.unaccent('public.unaccent'::regdictionary, v_name))) < 0.2 then
        raise exception using errcode = '22023', message = 'ITEM_RENAME_CHANGES_NATURE';
      end if;
    end if;
  end if;
  if v_unit is distinct from v_old.unit and v_used then raise exception using errcode = '22023', message = 'ITEM_UNIT_LOCKED'; end if;
  if p ? 'purchaseConversionFactor' and coalesce(nullif(p->>'purchaseConversionFactor', '')::numeric, 1) <= 0 then
    raise exception using errcode = '22023', message = 'CATALOG_FACTOR_INVALID'; end if;
  perform set_config('app.catalog_command', 'on', true);
  update public.items set
    name = v_name, unit = v_unit,
    category = coalesce(nullif(btrim(p->>'category'), ''), category),
    purchase_unit = case when p ? 'purchaseUnit' then nullif(btrim(p->>'purchaseUnit'), '') else purchase_unit end,
    purchase_conversion_factor = case when p ? 'purchaseUnit' and nullif(btrim(p->>'purchaseUnit'), '') is null then 1
      when p ? 'purchaseConversionFactor' then coalesce(nullif(p->>'purchaseConversionFactor', '')::numeric, 1) else purchase_conversion_factor end,
    min_stock = case when p ? 'minStock' then greatest(coalesce(nullif(p->>'minStock', '')::int, 0), 0) else min_stock end
  where id = v_old.id returning * into v_new;
  perform set_config('app.catalog_command', '', true);
  perform app_private.catalog_log(v_old.id, case when v_new.name is distinct from v_old.name then 'rename' else 'update' end,
    app_private.catalog_item_json(v_old), app_private.catalog_item_json(v_new), v_reason);
  return app_private.catalog_item_json(v_new);
end $$;

-- Ngừng dùng / mở lại. Ngừng dùng bị chặn khi còn tồn hoặc đang nằm trong đơn mua chưa xong.
create function public.set_catalog_item_status_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old public.items%rowtype;
  v_new public.items%rowtype;
  v_usage jsonb;
  v_action text := p->>'action';
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
begin
  if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'CATALOG_REASON_REQUIRED'; end if;
  select * into v_old from public.items where id = p->>'itemId' for update;
  if not found then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
  v_usage := app_private.catalog_item_usage(v_old.id);
  perform set_config('app.catalog_command', 'on', true);
  if v_action = 'retire' then
    if v_old.status = 'retired' then raise exception using errcode = '22023', message = 'ITEM_ALREADY_RETIRED'; end if;
    if (v_usage->>'stockQty')::numeric > 0 then raise exception using errcode = '22023', message = 'ITEM_RETIRE_HAS_STOCK'; end if;
    if (v_usage->>'openPurchaseOrders')::int > 0 then raise exception using errcode = '22023', message = 'ITEM_RETIRE_OPEN_PO'; end if;
    update public.items set status = 'retired', retired_at = now(), retired_by = public.current_app_user_id(), retired_reason = v_reason
    where id = v_old.id returning * into v_new;
  elsif v_action = 'reactivate' then
    if v_old.status = 'active' then raise exception using errcode = '22023', message = 'ITEM_ALREADY_ACTIVE'; end if;
    update public.items set status = 'active', retired_at = null, retired_by = null, retired_reason = null where id = v_old.id returning * into v_new;
  else
    raise exception using errcode = '22023', message = 'CATALOG_ACTION_INVALID';
  end if;
  perform set_config('app.catalog_command', '', true);
  perform app_private.catalog_log(v_old.id, case when v_action = 'retire' then 'retire' else 'reactivate' end,
    app_private.catalog_item_json(v_old), app_private.catalog_item_json(v_new), v_reason);
  return app_private.catalog_item_json(v_new);
end $$;

-- Đặt cách quản lý kho cho một hoặc nhiều mã. Chỉ đổi cách nhận hàng lần sau; tồn đang có xử lý qua kiểm kê.
create function public.set_inventory_mode_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_mode text := p->>'mode';
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_id text;
  v_old public.items%rowtype;
  v_count int := 0;
begin
  if not app_private.wms_can_issue_code() then raise exception using errcode = '42501', message = 'CATALOG_ISSUE_DENIED'; end if;
  if v_mode not in ('stock', 'use', 'service') then raise exception using errcode = '22023', message = 'CATALOG_MODE_INVALID'; end if;
  if jsonb_typeof(p->'itemIds') <> 'array' or jsonb_array_length(p->'itemIds') = 0 then raise exception using errcode = '22023', message = 'CATALOG_ITEMS_REQUIRED'; end if;
  perform set_config('app.catalog_command', 'on', true);
  for v_id in select jsonb_array_elements_text(p->'itemIds') loop
    select * into v_old from public.items where id = v_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
    if v_old.inventory_mode = v_mode then continue; end if;
    update public.items set inventory_mode = v_mode where id = v_id;
    perform app_private.catalog_log(v_id, 'mode', jsonb_build_object('inventoryMode', v_old.inventory_mode), jsonb_build_object('inventoryMode', v_mode), v_reason);
    v_count := v_count + 1;
  end loop;
  perform set_config('app.catalog_command', '', true);
  return jsonb_build_object('updated', v_count);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Đọc: danh mục, chi tiết một mã
-- ---------------------------------------------------------------------------------------------
create function public.get_catalog_overview_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app_private.wms_has_action('wms.inventory.view') or app_private.wms_has_action('wms.request.create') or app_private.wms_can_issue_code()) then
    raise exception using errcode = '42501', message = 'CATALOG_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'can', jsonb_build_object('issueCode', app_private.wms_can_issue_code(), 'request', app_private.wms_has_action('wms.request.create')),
    'usage', coalesce((select jsonb_object_agg(x.material_id, jsonb_build_array(x.ledger, x.qty)) from (
        select e.material_id, count(*) ledger, coalesce((select sum(b.on_hand_qty) from public.inventory_balances b where b.material_id = e.material_id), 0) qty
        from public.inventory_ledger_entries e group by e.material_id) x), '{}'::jsonb),
    'openPoItems', coalesce((select jsonb_agg(distinct x->>'itemId') from public.purchase_orders po, jsonb_array_elements(po.items) x
        where po.status::text not in ('closed', 'cancelled', 'delivered')), '[]'::jsonb),
    'renames', coalesce((select jsonb_agg(jsonb_build_object('itemId', a.record_id, 'at', a.created_at, 'by', a.user_name,
        'old', a.old_data->>'name', 'new', a.new_data->>'name', 'usage', app_private.catalog_item_usage(a.record_id),
        'usedBefore', app_private.catalog_item_used_before(a.record_id, a.created_at)) order by a.created_at desc)
      from public.audit_trail a where a.table_name = 'items' and a.action = 'UPDATE' and 'name' = any(a.changed_fields)), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('itemId', c.item_id, 'at', c.created_at, 'by', (select name from public.users where id = c.actor_id),
        'old', c.before->>'name', 'new', c.after->>'name', 'reason', c.reason, 'usage', app_private.catalog_item_usage(c.item_id),
        'usedBefore', app_private.catalog_item_used_before(c.item_id, c.created_at)) order by c.created_at desc)
      from public.item_catalog_events c where c.action = 'rename'), '[]'::jsonb));
end $$;

create function public.get_catalog_item_v1(p_item_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_item public.items%rowtype;
begin
  if not (app_private.wms_has_action('wms.inventory.view') or app_private.wms_has_action('wms.request.create') or app_private.wms_can_issue_code()) then
    raise exception using errcode = '42501', message = 'CATALOG_VIEW_DENIED';
  end if;
  select * into v_item from public.items where id = p_item_id;
  if not found then raise exception using errcode = 'P0002', message = 'ITEM_NOT_FOUND'; end if;
  return jsonb_build_object(
    'item', app_private.catalog_item_json(v_item),
    'usage', app_private.catalog_item_usage(v_item.id),
    'stock', coalesce((select jsonb_agg(s.j order by s.n) from (
        select w.name n, jsonb_build_object('warehouseId', b.warehouse_id, 'warehouseName', w.name, 'qty', round(sum(b.on_hand_qty), 6),
          'value', round(sum(b.total_value)), 'lastMove', max(b.last_transaction_date)) j
        from public.inventory_balances b join public.warehouses w on w.id = b.warehouse_id
        where b.material_id = v_item.id group by b.warehouse_id, w.name having sum(b.on_hand_qty) <> 0 or abs(sum(b.total_value)) > 1) s), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x.e order by x.at desc) from (
        select y.e, y.at from (
          select jsonb_build_object('at', c.created_at, 'by', (select name from public.users where id = c.actor_id), 'action', c.action,
            'reason', c.reason, 'before', c.before, 'after', c.after) e, c.created_at at from public.item_catalog_events c where c.item_id = v_item.id
          union all
          select jsonb_build_object('at', a.created_at, 'by', a.user_name, 'action', lower(a.action), 'fields', a.changed_fields,
            'before', jsonb_build_object('name', a.old_data->>'name'), 'after', jsonb_build_object('name', a.new_data->>'name')), a.created_at
          from public.audit_trail a where a.table_name = 'items' and a.record_id = v_item.id and a.action in ('INSERT', 'UPDATE')) y
        order by y.at desc limit 40) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Đọc: Tồn kho từ sổ kho, thẻ kho
-- ---------------------------------------------------------------------------------------------
create function public.list_wms_stock_v1(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_wh text[];
begin
  select coalesce(array_agg(w.id), '{}') into v_wh from public.warehouses w
  where not coalesce(w.is_archived, false) and w.type <> 'G3_TEST'
    and (app_private.wms_has_action('wms.inventory.view', w.id, w.id) or app_private.wms_has_action('wms.inventory.edit', w.id, w.id));
  if nullif(p->>'warehouseId', '') is not null then v_wh := array(select x from unnest(v_wh) x where x = p->>'warehouseId'); end if;
  return jsonb_build_object(
    'today', (now() at time zone 'Asia/Ho_Chi_Minh')::date,
    'can', jsonb_build_object('issueCode', app_private.wms_can_issue_code()),
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'type', w.type,
        'canOperate', app_private.wms_has_action('wms.transaction.create', w.id, w.id)) order by w.name)
      from public.warehouses w where w.id = any(v_wh)), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(r order by (r->>'value')::numeric desc nulls last) from (
      select jsonb_build_object('warehouseId', b.warehouse_id, 'itemId', b.material_id, 'sku', i.sku, 'name', coalesce(i.name, b.material_id),
        'unit', i.unit, 'category', i.category, 'minStock', coalesce(i.min_stock, 0), 'inventoryMode', coalesce(i.inventory_mode, 'stock'),
        'itemStatus', i.status, 'orphan', i.id is null,
        'qty', round(b.qty, 6), 'value', round(b.val), 'lastMove', b.last_move,
        'out30', coalesce((select round(sum(e.quantity_out), 6) from public.inventory_ledger_entries e where e.warehouse_id = b.warehouse_id
          and e.material_id = b.material_id and e.transaction_type in ('project_issue', 'loss_issue') and e.transaction_date > now() - interval '30 days'), 0),
        'incoming', coalesce((select round(sum((x->>'quantity')::numeric), 6) from public.transactions t, jsonb_array_elements(t.items) x
          where t.type::text = 'IMPORT' and t.status::text in ('PENDING', 'APPROVED') and t.target_warehouse_id = b.warehouse_id and x->>'itemId' = b.material_id), 0)) r
      from (select bb.warehouse_id, bb.material_id, sum(bb.on_hand_qty) qty, sum(bb.total_value) val, max(bb.last_transaction_date)::date last_move
            from public.inventory_balances bb where bb.warehouse_id = any(v_wh) group by 1, 2) b
      left join public.items i on i.id = b.material_id
      where b.qty <> 0 or abs(b.val) > 1
      union all
      -- Hàng đang về mà kho chưa từng có tồn.
      select jsonb_build_object('warehouseId', t.target_warehouse_id, 'itemId', x->>'itemId', 'sku', max(i.sku), 'name', coalesce(max(i.name), x->>'itemId'),
        'unit', max(i.unit), 'category', max(i.category), 'minStock', coalesce(max(i.min_stock), 0), 'inventoryMode', coalesce(max(i.inventory_mode), 'stock'),
        'itemStatus', max(i.status), 'orphan', max(i.id) is null, 'qty', 0, 'value', 0, 'lastMove', null, 'out30', 0,
        'incoming', round(sum((x->>'quantity')::numeric), 6))
      from public.transactions t cross join lateral jsonb_array_elements(t.items) x left join public.items i on i.id = x->>'itemId'
      where t.type::text = 'IMPORT' and t.status::text in ('PENDING', 'APPROVED') and t.target_warehouse_id = any(v_wh)
        and not exists (select 1 from public.inventory_balances b2 where b2.warehouse_id = t.target_warehouse_id and b2.material_id = x->>'itemId'
          and (b2.on_hand_qty <> 0 or abs(b2.total_value) > 1))
      group by t.target_warehouse_id, x->>'itemId') q), '[]'::jsonb));
end $$;

create function public.get_wms_item_card_v1(p_item_id text, p_warehouse_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app_private.wms_has_action('wms.inventory.view', p_warehouse_id, p_warehouse_id) or app_private.wms_has_action('wms.inventory.edit', p_warehouse_id, p_warehouse_id)) then
    raise exception using errcode = '42501', message = 'WMS_STOCK_VIEW_DENIED';
  end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('date', e.transaction_date, 'code', e.document_code, 'type', e.transaction_type,
        'qtyIn', e.quantity_in, 'qtyOut', e.quantity_out, 'unitPrice', e.unit_price, 'amount', e.amount, 'description', e.description)
        order by e.transaction_date, e.created_at, e.entry_no)
      from public.inventory_ledger_entries e where e.material_id = p_item_id and e.warehouse_id = p_warehouse_id), '[]'::jsonb),
    'otherWarehouses', coalesce((select jsonb_agg(s.j order by s.n) from (
        select w.name n, jsonb_build_object('warehouseId', b.warehouse_id, 'warehouseName', w.name, 'qty', round(sum(b.on_hand_qty), 6)) j
        from public.inventory_balances b join public.warehouses w on w.id = b.warehouse_id
        where b.material_id = p_item_id and b.warehouse_id <> p_warehouse_id
          and (app_private.wms_has_action('wms.inventory.view', w.id, w.id) or app_private.wms_has_action('wms.inventory.edit', w.id, w.id))
        group by b.warehouse_id, w.name having sum(b.on_hand_qty) <> 0) s), '[]'::jsonb));
end $$;

revoke all on function app_private.wms_can_issue_code(), app_private.catalog_name_key(text), app_private.catalog_name_numbers(text),
  app_private.catalog_item_usage(text), app_private.catalog_item_used_before(text, timestamptz), app_private.catalog_item_is_used(jsonb), app_private.catalog_item_json(public.items),
  app_private.catalog_log(text, text, jsonb, jsonb, text, text), app_private.guard_items_catalog() from public, anon;
grant execute on function app_private.wms_can_issue_code() to authenticated;
revoke all on function public.issue_material_code_v1(jsonb), public.resolve_material_code_request_v1(jsonb), public.update_catalog_item_v1(jsonb),
  public.set_catalog_item_status_v1(jsonb), public.set_inventory_mode_v1(jsonb), public.get_catalog_overview_v1(), public.get_catalog_item_v1(text),
  public.list_wms_stock_v1(jsonb), public.get_wms_item_card_v1(text, text) from public, anon;
grant execute on function public.issue_material_code_v1(jsonb), public.resolve_material_code_request_v1(jsonb), public.update_catalog_item_v1(jsonb),
  public.set_catalog_item_status_v1(jsonb), public.set_inventory_mode_v1(jsonb), public.get_catalog_overview_v1(), public.get_catalog_item_v1(text),
  public.list_wms_stock_v1(jsonb), public.get_wms_item_card_v1(text, text) to authenticated;

notify pgrst, 'reload schema';
