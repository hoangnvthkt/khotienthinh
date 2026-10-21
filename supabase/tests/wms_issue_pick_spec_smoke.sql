-- V2 chọn quy cách khi xuất. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261010211500_wms_issue_pick_spec.sql --smoke supabase/tests/wms_issue_pick_spec_smoke.sql
do $$
declare v_item text; v_wh text; v_a jsonb;
begin
  -- Mã–kho còn tồn: gắn 2 đơn vị sang quy cách "Smoke A" rồi thử phân bổ khi xuất.
  select b.material_id, b.warehouse_id into v_item, v_wh from public.inventory_balances b
  group by 1, 2 having sum(b.on_hand_qty) >= 10 order by 1, 2 limit 1;
  if v_item is null then raise notice 'SKIP: không có mã còn tồn'; return; end if;
  insert into public.wms_spec_transfers (code, material_id, warehouse_id, from_spec, to_spec, qty, reason, transfer_date, created_by)
  select 'CQC-SMOKE', v_item, v_wh, b.specification, 'Smoke A', 2, 'smoke', current_date, (select id from public.users order by id limit 1)
  from app_private.wms_spec_balances(v_item, v_wh) b where b.qty >= 2 order by b.first_in nulls last limit 1;
  -- 1. Chọn đúng quy cách đủ tồn → lấy đúng quy cách.
  v_a := app_private.wms_spec_alloc_for_entry(gen_random_uuid(), 'loss_issue', 'out', v_item, v_wh, null, 2, '{"specification":"smoke a"}'::jsonb);
  if v_a <> '[{"qty": 2, "specification": "Smoke A"}]'::jsonb then raise exception 'FAIL 1 chọn quy cách: %', v_a; end if;
  -- 2. Chọn quy cách không đủ → lấy hết quy cách đó, phần thiếu theo nhập trước (không âm tồn quy cách).
  v_a := app_private.wms_spec_alloc_for_entry(gen_random_uuid(), 'loss_issue', 'out', v_item, v_wh, null, 3, '{"specification":"Smoke A"}'::jsonb);
  if (v_a->0->>'specification') <> 'Smoke A' or (v_a->0->>'qty')::numeric <> 2
     or (select sum((x->>'qty')::numeric) from jsonb_array_elements(v_a) x) <> 3 then raise exception 'FAIL 2 thiếu: %', v_a; end if;
  -- 3. Dòng xuất cấp mang quy cách xuống phiếu kho.
  if not exists (select 1 from information_schema.columns where table_name = 'material_issue_lines' and column_name = 'specification') then
    raise exception 'FAIL 3 thiếu cột quy cách dòng xuất cấp'; end if;
  raise notice 'wms_issue_pick_spec_smoke OK';
end $$;
