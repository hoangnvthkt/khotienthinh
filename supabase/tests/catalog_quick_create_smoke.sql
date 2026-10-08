-- Hai ô quyền nhạy cảm của Danh mục vật tư: Tạo mã vật tư, Sửa mã vật tư. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261009150000_catalog_quick_create.sql --smoke supabase/tests/catalog_quick_create_smoke.sql
do $$
declare v_user record; v_item jsonb; v_opts jsonb; v_failed text; v_unit text; v_cat text; v_log record;
begin
  -- Người thường: không Admin, không ô Cấp mã, chưa có hai ô mới.
  select u.id, u.auth_id into v_user from public.users u where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null and u.role <> 'ADMIN'
    and not app_private.has_permission(u.id, 'wms.master_data.issue_code', 'global', '*') order by u.id limit 1;
  if v_user.id is null then raise exception 'SMOKE_SETUP: thiếu người thường'; end if;
  if not exists (select 1 from public.permission_actions where permission_code in ('wms.master_data.create_item', 'wms.master_data.edit_item') and risk_level = 'sensitive' having count(*) = 2) then
    raise exception 'FAIL: hai ô quyền chưa là nhạy cảm'; end if;
  select btrim(name) into v_unit from public.units where nullif(btrim(name), '') is not null limit 1;
  select btrim(name) into v_cat from public.categories where nullif(btrim(name), '') is not null limit 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user.auth_id, 'role', 'authenticated')::text, true);
  v_opts := public.get_catalog_create_options_v1();
  if (v_opts->>'canCreate')::boolean or (v_opts->>'canEdit')::boolean then raise exception 'FAIL: chưa cấp mà đã có quyền: %', v_opts - 'units' - 'categories'; end if;
  v_failed := null;
  begin perform public.issue_material_code_v1(jsonb_build_object('name', 'Smoke vật tư 7Q9Z', 'unit', v_unit, 'category', v_cat));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'CATALOG_CREATE_DENIED' then raise exception 'FAIL: tạo khi chưa có quyền: %', v_failed; end if;

  -- Cấp ô Tạo mã vật tư.
  insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at)
  values (v_user.id, 'wms.master_data.create_item', 'global', '*', true, now());
  if not (public.get_catalog_create_options_v1()->>'canCreate')::boolean then raise exception 'FAIL: cấp rồi vẫn chưa canCreate'; end if;
  v_item := public.issue_material_code_v1(jsonb_build_object('name', 'Smoke vật tư 7Q9Z', 'unit', v_unit, 'category', v_cat, 'inventoryMode', 'stock'));
  if v_item->>'sku' !~ '^VT[0-9]{7}$' then raise exception 'FAIL create: %', v_item; end if;
  v_failed := null;
  begin perform public.issue_material_code_v1(jsonb_build_object('name', 'smoke vat tu 7q9z', 'unit', v_unit, 'category', v_cat));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is null or v_failed not like 'ITEM_NAME_DUPLICATE:%' then raise exception 'FAIL dup: %', v_failed; end if;
  v_failed := null;
  begin perform public.issue_material_code_v1(jsonb_build_object('requestId', 'khong-co', 'name', 'Smoke khác 7Q9Z', 'unit', v_unit, 'category', v_cat));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'CATALOG_CREATE_DENIED' then raise exception 'FAIL: xử lý đề xuất không cần Cấp mã: %', v_failed; end if;

  -- Sửa: chưa có ô Sửa mã vật tư thì bị chặn.
  v_failed := null;
  begin perform public.update_catalog_item_v1(jsonb_build_object('itemId', v_item->>'id', 'minStock', 5, 'reason', 'thử'));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'CATALOG_EDIT_DENIED' then raise exception 'FAIL: sửa khi chưa có quyền: %', v_failed; end if;

  insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at)
  values (v_user.id, 'wms.master_data.edit_item', 'global', '*', true, now());
  v_failed := null;
  begin perform public.update_catalog_item_v1(jsonb_build_object('itemId', v_item->>'id', 'minStock', 5));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'CATALOG_REASON_REQUIRED' then raise exception 'FAIL: sửa không lý do: %', v_failed; end if;
  perform public.update_catalog_item_v1(jsonb_build_object('itemId', v_item->>'id', 'name', 'Smoke vật tư 7Q9Z (sửa)', 'minStock', 5, 'reason', 'Thử sửa'));
  select * into v_log from public.items where id = v_item->>'id';
  if v_log.name <> 'Smoke vật tư 7Q9Z (sửa)' or v_log.min_stock <> 5 then raise exception 'FAIL: chưa lưu sửa'; end if;
  if not exists (select 1 from public.item_catalog_events e where e.item_id = v_item->>'id' and e.action = 'rename' and e.reason = 'Thử sửa'
      and e.actor_id = v_user.id and e.before->>'name' = 'Smoke vật tư 7Q9Z' and (e.after->>'minStock')::int = 5) then
    raise exception 'FAIL: lịch sử sửa chưa ghi đủ người, lý do, trước → sau'; end if;
  raise notice 'catalog sensitive permissions smoke OK';
end $$;
