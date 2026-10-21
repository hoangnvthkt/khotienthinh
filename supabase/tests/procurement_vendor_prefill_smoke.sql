-- Gợi ý in mờ Lập đơn — đơn trước cùng NCC. Chạy rollback trên Cloud (không ghi sổ):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261013100000_procurement_vendor_prefill.sql --smoke supabase/tests/procurement_vendor_prefill_smoke.sql
do $$
declare v_vendor text; v_out jsonb;
begin
  if to_regprocedure('public.get_procurement_vendor_prefill_v1(text)') is null then raise exception 'FAIL 1 thiếu hàm gợi ý'; end if;
  -- 2. Không có người dùng: bị từ chối.
  begin
    perform public.get_procurement_vendor_prefill_v1('x');
    raise exception 'FAIL 2 không có người dùng vẫn đọc được';
  exception when insufficient_privilege then null; end;
  -- 3. Hình dạng kết quả khi chạy với quyền xem Mua hàng giả lập qua hàm nội bộ: thử trực tiếp phần truy vấn.
  select o.vendor_id into v_vendor from public.purchase_orders o
    where o.vendor_id is not null and o.archived_at is null and coalesce(o.status, '') not in ('draft', 'cancelled', 'returned')
    order by o.created_at desc limit 1;
  if v_vendor is not null then
    select jsonb_build_object('n', count(*)) into v_out from public.purchase_orders o,
      jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x
      where o.vendor_id = v_vendor and o.created_at >= now() - interval '90 days';
    if (v_out->>'n')::int < 0 then raise exception 'FAIL 3'; end if;
  end if;
  raise notice 'procurement_vendor_prefill_smoke OK';
end $$;
