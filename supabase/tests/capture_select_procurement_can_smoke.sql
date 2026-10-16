-- Người dùng đăng nhập SELECT thẳng wms_delivery_captures không còn lỗi 42501 (chạy rollback trên Cloud):
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261016120000_capture_select_procurement_can.sql --smoke supabase/tests/capture_select_procurement_can_smoke.sql
do $$
declare v_admin record; v_user record; n integer;
begin
  if not has_function_privilege('authenticated', 'app_private.procurement_can(text)', 'execute') then raise exception 'FAIL chưa cấp quyền'; end if;
  select u.id, u.auth_id, u.email into v_admin from public.users u where u.role = 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null order by u.created_at limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin.auth_id, 'role', 'authenticated', 'email', v_admin.email)::text, true);
  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  set local role authenticated;
  select count(*) into n from public.wms_delivery_captures;
  if n < 1 then raise exception 'FAIL Admin không thấy phiếu chụp nào'; end if;
  reset role;
  -- Người thường không có quyền kho / Mua hàng: không lỗi, chỉ không thấy.
  select u.id, u.auth_id, u.email into v_user from public.users u
    where u.role <> 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
      and not app_private.has_permission(u.id, 'system.procurement.view') and not app_private.has_permission(u.id, 'system.procurement.manage')
    order by u.created_at limit 1;
  if v_user.id is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user.auth_id, 'role', 'authenticated', 'email', v_user.email)::text, true);
    perform set_config('request.jwt.claim.sub', v_user.auth_id::text, true);
    set local role authenticated;
    select count(*) into n from public.wms_delivery_captures;
    reset role;
  end if;
  raise notice 'capture_select_procurement_can_smoke OK';
end $$;
