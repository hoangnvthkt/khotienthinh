-- Danh sách quy cách chuẩn của từng mã. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261010201300_item_spec_catalog.sql --smoke supabase/tests/item_spec_catalog_smoke.sql
do $$
declare v_item text; v_a uuid; v_b uuid; v_bad integer;
begin
  -- 1. Khóa so quy cách: bỏ dấu, dấu cách, x/*/×, phẩy thập phân, ly = mm.
  if app_private.spec_key('Hòa Phát CB-300') <> app_private.spec_key('hoa phat cb 300')
     or app_private.spec_key('V120*30*1,5ly') <> app_private.spec_key('v120x30x1.5mm') then
    raise exception 'FAIL 1 khóa chuẩn hóa'; end if;
  -- 2. Quy cách trên chứng từ đã vào danh sách.
  if exists (select 1 from public.purchase_orders po cross join lateral jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) x
    where nullif(btrim(x->>'specification'), '') is not null
      and not exists (select 1 from public.item_specs s where s.item_id = x->>'itemId' and s.norm_key = app_private.spec_key(x->>'specification'))) then
    raise exception 'FAIL 2 quy cách trên đơn mua chưa vào danh sách'; end if;
  -- 3. Gõ khác kiểu → cùng một quy cách; tên đã gộp → quy cách giữ.
  select id into v_item from public.items order by id limit 1;
  v_a := app_private.item_spec_register(v_item, 'Smoke Loại 1', 'purchase', null);
  if app_private.item_spec_register(v_item, 'smoke  loai-1', 'purchase', null) <> v_a then raise exception 'FAIL 3 gõ khác kiểu tạo trùng'; end if;
  v_b := app_private.item_spec_register(v_item, 'Smoke Loại 2', 'purchase', null);
  update public.item_specs set status = 'merged', merged_into_id = v_a where id = v_b;
  if app_private.item_spec_register(v_item, 'smoke loai 2', 'purchase', null) <> v_a then raise exception 'FAIL 3 tên đã gộp không về quy cách giữ'; end if;
  -- 4. Tồn theo quy cách vẫn khớp tồn của mã sau khi đổi khóa so.
  select count(*) into v_bad from (select l.material_id m, l.warehouse_id w, sum(l.quantity_in - l.quantity_out) q
    from public.inventory_ledger_entries l group by 1, 2) p
  where abs(p.q - (select coalesce(sum(b.qty), 0) from app_private.wms_spec_balances(p.m, p.w) b)) > 0.001;
  if v_bad > 0 then raise exception 'FAIL 4 % cặp mã–kho lệch', v_bad; end if;
  raise notice 'item_spec_catalog_smoke OK';
end $$;
