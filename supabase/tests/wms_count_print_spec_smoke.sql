-- V4 kiểm kê theo quy cách + quy cách thực trên phiếu kho. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261010221700_wms_count_print_spec.sql --smoke supabase/tests/wms_count_print_spec_smoke.sql
do $$
declare v_m jsonb;
begin
  -- 1. Gộp số đếm theo quy cách: khớp theo khóa quy cách, quy cách mới thêm vào (sổ = 0), số âm bị chặn.
  v_m := app_private.stock_count_merge_specs('[{"specification":null,"snapshotQty":10,"countedQty":null},{"specification":"Loại A","snapshotQty":5,"countedQty":null}]'::jsonb,
    '[{"specification":"loai a","countedQty":4},{"specification":"Loại B","countedQty":1}]'::jsonb);
  if jsonb_array_length(v_m) <> 3 or (v_m->1->>'countedQty')::numeric <> 4 or v_m->2->>'specification' <> 'Loại B' or (v_m->2->>'snapshotQty')::numeric <> 0 then
    raise exception 'FAIL 1 gộp số đếm: %', v_m; end if;
  begin
    perform app_private.stock_count_merge_specs('[]'::jsonb, '[{"specification":"X","countedQty":-1}]'::jsonb);
    raise exception 'FAIL 1 không chặn số âm';
  exception when others then if sqlerrm not like '%STOCK_COUNT_QTY_INVALID%' then raise; end if; end;
  -- 2. Phiếu chuyển quy cách được về "Chưa ghi quy cách".
  if exists (select 1 from information_schema.columns where table_name = 'wms_spec_transfers' and column_name = 'to_spec' and is_nullable = 'NO') then
    raise exception 'FAIL 2 to_spec vẫn bắt buộc'; end if;
  raise notice 'wms_count_print_spec_smoke OK';
end $$;
