-- Kho Đợt 1 — Chụp phiếu giao. Chạy rollback trên Cloud (không ghi sổ):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261012213000_wms_delivery_capture.sql --smoke supabase/tests/wms_delivery_capture_smoke.sql
do $$
declare v_wh text;
begin
  if to_regclass('public.wms_delivery_captures') is null or to_regclass('public.wms_item_aliases') is null then raise exception 'FAIL 1 thiếu bảng phiếu chụp'; end if;
  if to_regprocedure('public.receive_capture_v1(jsonb)') is null or to_regprocedure('public.suggest_capture_orders_v1(uuid)') is null then
    raise exception 'FAIL 2 thiếu hàm nhận / gợi ý đơn'; end if;
  if app_private.capture_text_key('Tôn mát POSHACO 0,45ly') <> 'ton mat poshaco 0 45ly' then raise exception 'FAIL 3 chuẩn hóa tên sai'; end if;
  -- 4. Không có người dùng: không lưu được phiếu chụp.
  select id into v_wh from public.warehouses limit 1;
  begin
    perform public.save_delivery_capture_v1(jsonb_build_object('warehouseId', v_wh));
    raise exception 'FAIL 4 không có người dùng vẫn lưu được';
  exception when others then if sqlerrm <> 'AUTH_REQUIRED' then raise; end if; end;
  -- 5. Ảnh thư mục cap-<id> lạ: không ai đọc được.
  if app_private.wms_capture_object_warehouse('cap-00000000-0000-0000-0000-000000000000/x.jpg') is not null then raise exception 'FAIL 5 ảnh lạ có kho'; end if;
  raise notice 'wms_delivery_capture_smoke OK';
end $$;
