-- V1-3b tồn theo quy cách. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261010191100_wms_stock_by_spec.sql --smoke supabase/tests/wms_stock_by_spec_smoke.sql
do $$
declare v_bad integer; v_alloc jsonb;
begin
  -- 1. Mọi dòng sổ kho đều có phân bổ quy cách.
  if exists (select 1 from public.inventory_ledger_entries where not (metadata ? 'specAllocations')) then
    raise exception 'FAIL 1 còn dòng sổ chưa phân bổ quy cách'; end if;
  -- 2. Tồn từng quy cách cộng lại bằng tồn của mã trên sổ, ở mọi cặp mã–kho; không quy cách nào âm.
  select count(*) into v_bad from (select l.material_id m, l.warehouse_id w, sum(l.quantity_in - l.quantity_out) q
    from public.inventory_ledger_entries l group by 1, 2) p
  where abs(p.q - (select coalesce(sum(b.qty), 0) from app_private.wms_spec_balances(p.m, p.w) b)) > 0.001
     or exists (select 1 from app_private.wms_spec_balances(p.m, p.w) b where b.qty < -0.001);
  if v_bad > 0 then raise exception 'FAIL 2 % cặp mã–kho lệch / âm theo quy cách', v_bad; end if;
  -- 3. Xuất không ghi quy cách lấy quy cách nhập trước; phần thiếu về "Chưa ghi quy cách".
  v_alloc := app_private.wms_spec_take('[{"specification":"A","qty":2},{"specification":"B","qty":5}]'::jsonb, 4, null);
  if v_alloc <> '[{"qty": 2, "specification": "A"}, {"qty": 2, "specification": "B"}]'::jsonb then raise exception 'FAIL 3 FIFO: %', v_alloc; end if;
  v_alloc := app_private.wms_spec_take('[{"specification":"A","qty":1}]'::jsonb, 3, null);
  if v_alloc <> '[{"qty": 1, "specification": "A"}, {"qty": 2, "specification": null}]'::jsonb then raise exception 'FAIL 3 thiếu: %', v_alloc; end if;
  raise notice 'wms_stock_by_spec_smoke OK';
end $$;
