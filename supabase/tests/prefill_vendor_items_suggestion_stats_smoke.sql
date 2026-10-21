-- Gợi ý in mờ đợt cuối: dòng gợi ý NCC có tên / mã / số đơn; bảng đo tỷ lệ nhận cho Admin. Chạy rollback trên Cloud (không ghi sổ):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261013130000_prefill_vendor_items_suggestion_stats.sql --smoke supabase/tests/prefill_vendor_items_suggestion_stats_smoke.sql
do $$
declare v_admin record; v_vendor text; v_out jsonb; v_line jsonb;
begin
  if to_regprocedure('public.get_procurement_vendor_prefill_v1(text)') is null then raise exception 'FAIL 1 thiếu hàm gợi ý NCC'; end if;
  if to_regprocedure('public.get_ui_suggestion_stats_v1(integer)') is null then raise exception 'FAIL 1 thiếu hàm thống kê'; end if;

  -- 2. Không có người dùng: cả hai bị từ chối.
  begin
    perform public.get_ui_suggestion_stats_v1(30);
    raise exception 'FAIL 2 không có người dùng vẫn xem được thống kê';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_procurement_vendor_prefill_v1('x');
    raise exception 'FAIL 2 không có người dùng vẫn đọc được gợi ý NCC';
  exception when insufficient_privilege then null; end;

  -- 3. Giả lập một Admin đang hoạt động (JWT trong giao dịch rollback) để chạy thật phần truy vấn.
  select u.id, u.auth_id, u.email into v_admin from public.users u
    where u.role = 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
    order by u.created_at limit 1;
  if v_admin.id is null then raise exception 'FAIL 3 không có Admin hoạt động để thử'; end if;
  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin.auth_id, 'role', 'authenticated', 'email', v_admin.email)::text, true);
  if not public.is_admin() then raise exception 'FAIL 3 giả lập Admin không nhận'; end if;

  -- 4. Thống kê: đủ khóa, số là số; khoảng ngày bị kẹp 1..365.
  v_out := public.get_ui_suggestion_stats_v1(30);
  if v_out->>'days' <> '30' or jsonb_typeof(v_out->'rows') <> 'array' or jsonb_typeof(v_out->'screens') <> 'array'
     or jsonb_typeof(v_out->'total'->'events') <> 'number' then raise exception 'FAIL 4 hình dạng thống kê sai: %', v_out; end if;
  if (public.get_ui_suggestion_stats_v1(9999)->>'days') <> '365' or (public.get_ui_suggestion_stats_v1(null)->>'days') <> '30' then raise exception 'FAIL 4 không kẹp số ngày'; end if;
  for v_line in select * from jsonb_array_elements(v_out->'rows') loop
    if (v_line->>'accepted')::int + (v_line->>'edited')::int + (v_line->>'dismissed')::int <> (v_line->>'events')::int then raise exception 'FAIL 4 cộng dòng lệch: %', v_line; end if;
  end loop;

  -- 5. Gợi ý NCC: NCC có đơn trong 90 ngày → mỗi dòng có itemName, sku, orders ≥ 1 (mã còn trong danh mục).
  select o.vendor_id into v_vendor from public.purchase_orders o
    where o.vendor_id is not null and o.archived_at is null and coalesce(o.status, '') not in ('draft', 'cancelled', 'returned')
      and o.created_at >= now() - interval '90 days' and jsonb_typeof(o.items) = 'array' and jsonb_array_length(o.items) > 0
    order by o.created_at desc limit 1;
  if v_vendor is not null then
    v_out := public.get_procurement_vendor_prefill_v1(v_vendor);
    if jsonb_typeof(v_out->'lines') <> 'array' then raise exception 'FAIL 5 lines không phải mảng'; end if;
    for v_line in select * from jsonb_array_elements(v_out->'lines') loop
      if coalesce((v_line->>'orders')::int, 0) < 1 then raise exception 'FAIL 5 orders < 1: %', v_line; end if;
      if v_line ? 'itemName' = false or v_line ? 'sku' = false then raise exception 'FAIL 5 thiếu khóa itemName/sku: %', v_line; end if;
      if exists (select 1 from public.items i where i.id::text = v_line->>'itemId') and nullif(v_line->>'itemName', '') is null then
        raise exception 'FAIL 5 mã còn trong danh mục mà không có tên: %', v_line; end if;
    end loop;
    raise notice 'prefill smoke: NCC % có % dòng gợi ý', v_vendor, jsonb_array_length(v_out->'lines');
  end if;
  raise notice 'prefill_vendor_items_suggestion_stats_smoke OK';
end $$;
