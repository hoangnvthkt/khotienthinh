-- V2 Kho một màn. Chạy rollback trên Cloud (không ghi sổ, không làm nhảy số phiếu NK/XK):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261011090500_wms_v2_one_screen.sql --smoke supabase/tests/wms_v2_one_screen_smoke.sql
do $$
declare v_wh text; v_item text; v_def text;
begin
  -- 1. Phiếu nhập tự do (đối tác / HĐ NCC, không đợt giao) bị chặn.
  select id into v_wh from public.warehouses order by id limit 1;
  select id into v_item from public.items order by id limit 1;
  begin
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, status, note, source_type)
    values ('tx-v2-smoke-free', 'IMPORT', now(), jsonb_build_array(jsonb_build_object('itemId', v_item, 'quantity', 1, 'price', 0)),
      v_wh, (select id from public.users order by id limit 1), 'PENDING', 'smoke', 'business_partner');
    raise exception 'FAIL 1 phiếu nhập tự do không bị chặn';
  exception when others then
    if sqlerrm <> 'WMS_FREE_IMPORT_REMOVED' then raise; end if;
  end;
  -- 2. Xuất 1 bước có hàm, chặn người không phải thủ kho.
  if to_regprocedure('public.issue_material_now_v1(jsonb)') is null then raise exception 'FAIL 2 thiếu issue_material_now_v1'; end if;
  -- 3. Duyệt phiếu nhận số lẻ (52,6) — không ép kiểu integer.
  v_def := pg_get_functiondef('public.process_transaction_status(text,public.transaction_status,uuid)'::regprocedure);
  if position('''quantity'', '''')::integer' in v_def) > 0 or position('v_qty numeric' in v_def) = 0 then raise exception 'FAIL 3 process_transaction_status còn ép integer'; end if;
  -- 4. Gửi chuyển kho mang quy cách dòng.
  v_def := pg_get_functiondef('app_private.dispatch_wms_transfer_v1(text,bigint,text)'::regprocedure);
  if position('''specification''' in v_def) = 0 then raise exception 'FAIL 4 gửi chuyển kho chưa mang quy cách'; end if;
  raise notice 'wms_v2_one_screen_smoke OK';
end $$;
