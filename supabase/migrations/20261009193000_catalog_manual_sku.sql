-- Danh mục vật tư: người tạo TỰ NHẬP mã vật tư (chủ SP 09/10/2026), không còn bắt buộc mã tự sinh VT + số.
--   * issue_material_code_v1 nhận p.sku: 2–30 ký tự chữ/số . _ -, không trùng mã đã có (kể cả ngừng dùng, không phân biệt hoa thường).
--     Không gửi sku thì vẫn tự sinh VT + 7 số như cũ (giữ tương thích).
--   * get_catalog_create_options_v1 trả thêm nextSku — mã gợi ý VT + số tiếp theo để người tạo bấm dùng nếu muốn.

create or replace function app_private.catalog_next_sku()
returns text language sql stable security definer set search_path = '' as $$
  select 'VT' || lpad((coalesce(max((substring(sku from '^VT([0-9]{7})$'))::bigint), 0) + 1)::text, 7, '0')
  from public.items where sku ~ '^VT[0-9]{7}$';
$$;
revoke all on function app_private.catalog_next_sku() from public, anon, authenticated;

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
  v_sku text := nullif(btrim(coalesce(p->>'sku', '')), '');
  v_req public.material_code_requests%rowtype;
  v_dup public.items%rowtype;
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
  if v_sku is not null and v_sku !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$' then
    raise exception using errcode = '22023', message = 'CATALOG_SKU_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtext('public.items.sku'));
  -- Mã do người tạo nhập: không trùng mã nào đã có (kể cả mã ngừng dùng), không phân biệt hoa thường.
  if v_sku is not null then
    select * into v_dup from public.items i where upper(i.sku) = upper(v_sku) limit 1;
    if found then raise exception using errcode = '23505', message = 'ITEM_SKU_DUPLICATE:' || v_dup.sku; end if;
  end if;
  select * into v_dup from public.items i
  where i.status = 'active' and app_private.catalog_name_key(i.name) = app_private.catalog_name_key(v_name) limit 1;
  if found then raise exception using errcode = '23505', message = 'ITEM_NAME_DUPLICATE:' || coalesce(v_dup.sku, v_dup.id); end if;
  if v_sku is null then v_sku := app_private.catalog_next_sku(); end if;
  perform set_config('app.catalog_command', 'on', true);
  insert into public.items (id, sku, name, category, unit, purchase_unit, purchase_conversion_factor, min_stock, price_in, price_out,
    stock_by_warehouse, inventory_mode, status, created_at)
  values ('it-' || replace(gen_random_uuid()::text, '-', ''), v_sku, v_name, v_category, v_unit, v_pu,
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

create or replace function public.get_catalog_create_options_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'canCreate', app_private.catalog_can_create_item(),
    'canEdit', app_private.catalog_can_edit_item(),
    'canIssueCode', app_private.wms_can_issue_code(),
    'nextSku', app_private.catalog_next_sku(),
    'categories', coalesce((select jsonb_agg(n order by n) from (
      select distinct btrim(name) n from public.categories where nullif(btrim(name), '') is not null
      union select distinct btrim(category) from public.items where status = 'active' and nullif(btrim(category), '') is not null) c), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(n order by n) from (
      select distinct btrim(name) n from public.units where nullif(btrim(name), '') is not null
      union select distinct btrim(unit) from public.items where status = 'active' and nullif(btrim(unit), '') is not null) u), '[]'::jsonb))
  where public.current_app_user_id() is not null;
$$;
