-- Người tạo tự nhập mã vật tư. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261009193000_catalog_manual_sku.sql --smoke supabase/tests/catalog_manual_sku_smoke.sql
do $$
declare v_user record; v_item jsonb; v_opts jsonb; v_failed text; v_unit text; v_cat text; v_taken text;
begin
  select u.id, u.auth_id into v_user from public.users u where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null and u.role <> 'ADMIN'
  order by u.id limit 1;
  if v_user.id is null then raise exception 'SMOKE_SETUP: thiếu người thường'; end if;
  select btrim(name) into v_unit from public.units where nullif(btrim(name), '') is not null limit 1;
  select btrim(name) into v_cat from public.categories where nullif(btrim(name), '') is not null limit 1;
  select sku into v_taken from public.items where sku ~ '^VT[0-9]{7}$' order by sku limit 1;
  insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, granted_at)
  values (v_user.id, 'wms.master_data.create_item', 'global', '*', true, now());
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user.auth_id, 'role', 'authenticated')::text, true);

  v_opts := public.get_catalog_create_options_v1();
  if coalesce(v_opts->>'nextSku', '') !~ '^VT[0-9]{7}$' then raise exception 'FAIL nextSku: %', v_opts->>'nextSku'; end if;

  v_failed := null;
  begin perform public.issue_material_code_v1(jsonb_build_object('sku', 'MÃ CÓ DẤU', 'name', 'Smoke mã tay 8K2W', 'unit', v_unit, 'category', v_cat));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'CATALOG_SKU_INVALID' then raise exception 'FAIL sku sai định dạng: %', v_failed; end if;

  v_failed := null;
  begin perform public.issue_material_code_v1(jsonb_build_object('sku', lower(v_taken), 'name', 'Smoke mã tay 8K2W', 'unit', v_unit, 'category', v_cat));
  exception when others then v_failed := sqlerrm; end;
  if v_failed is distinct from 'ITEM_SKU_DUPLICATE:' || v_taken then raise exception 'FAIL sku trùng (hoa thường): %', v_failed; end if;

  v_item := public.issue_material_code_v1(jsonb_build_object('sku', ' THEP-U250.8K2W ', 'name', 'Smoke mã tay 8K2W', 'unit', v_unit, 'category', v_cat, 'inventoryMode', 'stock'));
  if v_item->>'sku' <> 'THEP-U250.8K2W' then raise exception 'FAIL mã tay: %', v_item; end if;
  if not exists (select 1 from public.item_catalog_events e where e.item_id = v_item->>'id' and e.action = 'issue') then raise exception 'FAIL: chưa ghi nhật ký tạo'; end if;

  -- Không gửi mã: vẫn tự sinh như cũ (giữ tương thích).
  v_item := public.issue_material_code_v1(jsonb_build_object('name', 'Smoke mã tự sinh 8K2W', 'unit', v_unit, 'category', v_cat));
  if v_item->>'sku' <> v_opts->>'nextSku' then raise exception 'FAIL tự sinh: % ≠ %', v_item->>'sku', v_opts->>'nextSku'; end if;
  raise notice 'catalog manual sku smoke OK';
end $$;
