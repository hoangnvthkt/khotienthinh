-- Danh mục vật tư: hai ô quyền NHẠY CẢM do chủ SP chốt 08/10/2026.
--   * wms.master_data.create_item "Tạo mã vật tư": tạo mã mới ngay, không qua bước đề xuất (Danh mục, ô Thêm vật tư của đơn chủ động).
--   * wms.master_data.edit_item   "Sửa mã vật tư": sửa tên, ĐVT, nhóm, ĐV mua, hệ số, tồn tối thiểu. Bắt buộc lý do, ghi lịch sử trước → sau.
-- Admin luôn có. Ô "Cấp mã" vẫn xử lý đề xuất mã, ngừng dùng / mở lại, đổi cách quản lý kho; KHÔNG còn tự sửa mã.
-- Chặn tên trùng, mã tự sinh VT + số như cũ.

insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes, legacy_module_key,
  legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code, direct_grant_allowed)
values
  ('wms.master_data', 'create_item', 'wms.master_data.create_item', 'Tạo mã vật tư',
   'Tạo mã vật tư mới ngay, không qua bước đề xuất mã. Dùng ở Danh mục vật tư và khi lập đơn mua.',
   array['global'], 'WMS', '/material-code-requests', false, 30, true, 'sensitive', true, false, false, 'enforced', 'wms', true),
  ('wms.master_data', 'edit_item', 'wms.master_data.edit_item', 'Sửa mã vật tư',
   'Sửa thông tin mã vật tư (tên, ĐVT, nhóm, quy đổi, tồn tối thiểu). Mỗi lần sửa bắt buộc lý do và được ghi lịch sử.',
   array['global'], 'WMS', '/material-code-requests', false, 40, true, 'sensitive', true, false, false, 'enforced', 'wms', true)
on conflict (permission_code) do nothing;

create function app_private.catalog_can_create_item()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin()
    or app_private.has_permission(public.current_app_user_id(), 'wms.master_data.create_item', 'global', '*'));
$$;
create function app_private.catalog_can_edit_item()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin()
    or app_private.has_permission(public.current_app_user_id(), 'wms.master_data.edit_item', 'global', '*'));
$$;
revoke all on function app_private.catalog_can_create_item(), app_private.catalog_can_edit_item() from public, anon;
grant execute on function app_private.catalog_can_create_item(), app_private.catalog_can_edit_item() to authenticated;

CREATE OR REPLACE FUNCTION public.issue_material_code_v1(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Xử lý đề xuất mã: ô Cấp mã. Tạo thẳng không qua đề xuất: ô nhạy cảm "Tạo mã vật tư" (hoặc Admin).
  if not (case when nullif(p->>'requestId', '') is null then app_private.catalog_can_create_item() else app_private.wms_can_issue_code() end) then
    raise exception using errcode = '42501', message = 'CATALOG_CREATE_DENIED'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.update_catalog_item_v1(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Sửa mã vật tư: ô nhạy cảm "Sửa mã vật tư" (hoặc Admin). Mọi lần sửa bắt buộc lý do, ghi lịch sử trước → sau.
  if not app_private.catalog_can_edit_item() then raise exception using errcode = '42501', message = 'CATALOG_EDIT_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'CATALOG_REASON_REQUIRED'; end if;
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
end $function$;

-- Quyền danh mục của người đang dùng + danh sách nhóm, đơn vị tính cho form tạo / sửa mã.
create function public.get_catalog_create_options_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'canCreate', app_private.catalog_can_create_item(),
    'canEdit', app_private.catalog_can_edit_item(),
    'canIssueCode', app_private.wms_can_issue_code(),
    'categories', coalesce((select jsonb_agg(n order by n) from (
      select distinct btrim(name) n from public.categories where nullif(btrim(name), '') is not null
      union select distinct btrim(category) from public.items where status = 'active' and nullif(btrim(category), '') is not null) c), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(n order by n) from (
      select distinct btrim(name) n from public.units where nullif(btrim(name), '') is not null
      union select distinct btrim(unit) from public.items where status = 'active' and nullif(btrim(unit), '') is not null) u), '[]'::jsonb))
  where public.current_app_user_id() is not null;
$$;
revoke all on function public.get_catalog_create_options_v1() from public, anon;
grant execute on function public.get_catalog_create_options_v1() to authenticated;
