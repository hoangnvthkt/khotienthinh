-- In phiếu ở màn Kho + NCC giao một đơn thành nhiều lần. Chạy rollback trên Cloud (không ghi sổ):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261011150000_wms_print_continue_delivery.sql --smoke supabase/tests/wms_print_continue_delivery_smoke.sql
do $$
declare v_batch uuid; v_po text; v_def text;
begin
  if to_regprocedure('public.continue_purchase_delivery_v1(jsonb)') is null then raise exception 'FAIL 1 thiếu continue_purchase_delivery_v1'; end if;
  v_def := pg_get_functiondef('public.get_wms_tx_spec_allocations_v1(text)'::regprocedure);
  if position('''code'', e.document_code' in v_def) = 0 then raise exception 'FAIL 2 in phiếu chưa có số sổ kho'; end if;
  -- 3. Không có người dùng: từ chối.
  select b.id, b.purchase_order_id into v_batch, v_po from public.purchase_order_delivery_batches b where b.status = 'received_short' limit 1;
  if v_batch is null then raise notice 'SKIP 3: không có đợt nhận thiếu'; else
    begin
      perform public.continue_purchase_delivery_v1(jsonb_build_object('deliveryId', v_batch));
      raise exception 'FAIL 3 không có người dùng vẫn mở được đợt';
    exception when others then if sqlerrm <> 'AUTH_REQUIRED' then raise; end if; end;
  end if;
  raise notice 'wms_print_continue_delivery_smoke OK';
end $$;
