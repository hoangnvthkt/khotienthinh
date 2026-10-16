-- Kết nối API: khóa vào Vault, danh sách không lộ khóa, thay khóa, gán tính năng, chỉ service_role giải mã. Chạy rollback trên Cloud:
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261016090000_integration_connections.sql --smoke supabase/tests/integration_connections_smoke.sql
do $$
declare v_admin record; v_user record; v_row jsonb; v_id uuid; v_secret uuid; v_list jsonb; v_sec jsonb;
begin
  -- 1. Quyền hàm: authenticated không được giải mã; không người dùng thì bị từ chối.
  if has_function_privilege('authenticated', 'public.integration_secret_v1(uuid,text)', 'execute') then raise exception 'FAIL 1 authenticated giải mã được'; end if;
  if has_function_privilege('authenticated', 'app_private.integration_secret_v1(uuid,text)', 'execute') then raise exception 'FAIL 1 authenticated gọi app_private'; end if;
  if not has_function_privilege('service_role', 'public.integration_secret_v1(uuid,text)', 'execute') then raise exception 'FAIL 1 service_role không gọi được'; end if;
  begin
    perform public.get_integration_connections_v1();
    raise exception 'FAIL 1 không người dùng vẫn xem được';
  exception when insufficient_privilege then null; end;

  -- 2. Admin thêm kết nối: khóa vào Vault, bảng chỉ có 4 ký tự cuối; danh sách không có khóa.
  select u.id, u.auth_id, u.email into v_admin from public.users u
    where u.role = 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null order by u.created_at limit 1;
  perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin.auth_id, 'role', 'authenticated', 'email', v_admin.email)::text, true);
  if not public.is_admin() then raise exception 'FAIL 2 giả lập Admin'; end if;

  begin
    perform public.save_integration_connection_v1('{"kind":"gemini","name":"Thiếu khóa","baseUrl":"https://generativelanguage.googleapis.com"}'::jsonb);
    raise exception 'FAIL 2 thêm không khóa vẫn được';
  exception when invalid_parameter_value then null; end;

  v_row := public.save_integration_connection_v1('{"kind":"gemini","name":"Gemini thử","baseUrl":"https://generativelanguage.googleapis.com/","apiKey":"AIzaSmokeKey-1234-7Qx2","model":"gemini-2.5-flash"}'::jsonb);
  v_id := (v_row->>'id')::uuid;
  if v_row->>'keyHint' <> '7Qx2' or (v_row->>'hasKey')::boolean is not true or v_row ? 'apiKey' then raise exception 'FAIL 2 hàng trả về sai: %', v_row; end if;
  if v_row->>'baseUrl' <> 'https://generativelanguage.googleapis.com' then raise exception 'FAIL 2 không cắt / cuối endpoint'; end if;
  select secret_id into v_secret from public.integration_connections where id = v_id;
  if (select decrypted_secret from vault.decrypted_secrets where id = v_secret) <> 'AIzaSmokeKey-1234-7Qx2' then raise exception 'FAIL 2 Vault không giữ đúng khóa'; end if;
  v_list := public.get_integration_connections_v1();
  if v_list::text like '%AIzaSmokeKey%' then raise exception 'FAIL 2 danh sách lộ khóa'; end if;

  -- 3. Sửa tên không đổi khóa: giữ trạng thái; thay khóa: Vault cập nhật, về "Chưa thử".
  perform public.record_integration_test_v1(v_id, '{"ok":true,"ms":420,"httpStatus":200,"models":37}'::jsonb);
  v_row := public.save_integration_connection_v1(jsonb_build_object('id', v_id, 'kind', 'gemini', 'name', 'Gemini chính', 'baseUrl', 'https://generativelanguage.googleapis.com', 'model', 'gemini-2.5-flash'));
  if v_row->>'status' <> 'ok' or v_row->>'name' <> 'Gemini chính' then raise exception 'FAIL 3 sửa tên mất trạng thái: %', v_row; end if;
  v_row := public.save_integration_connection_v1(jsonb_build_object('id', v_id, 'kind', 'gemini', 'name', 'Gemini chính', 'baseUrl', 'https://generativelanguage.googleapis.com', 'apiKey', 'AIzaNewKey-9999-ab12'));
  if v_row->>'status' <> 'untested' or v_row->>'keyHint' <> 'ab12' then raise exception 'FAIL 3 thay khóa: %', v_row; end if;
  if (select decrypted_secret from vault.decrypted_secrets where id = v_secret) <> 'AIzaNewKey-9999-ab12' then raise exception 'FAIL 3 Vault chưa thay'; end if;

  -- 4. Gán cho ai.fast → service lấy được theo tính năng; tắt kết nối → không còn trả.
  perform public.set_integration_assignment_v1('ai.fast', v_id);
  v_sec := app_private.integration_secret_v1(null, 'ai.fast');
  if v_sec->>'apiKey' <> 'AIzaNewKey-9999-ab12' or v_sec->>'kind' <> 'gemini' then raise exception 'FAIL 4 lấy theo tính năng: %', v_sec; end if;
  perform public.save_integration_connection_v1(jsonb_build_object('id', v_id, 'kind', 'gemini', 'name', 'Gemini chính', 'baseUrl', 'https://generativelanguage.googleapis.com', 'enabled', false));
  if app_private.integration_secret_v1(null, 'ai.fast') is not null then raise exception 'FAIL 4 kết nối tắt vẫn dùng'; end if;
  if app_private.integration_secret_v1(null, 'wms.doc_reader') is not null then raise exception 'FAIL 4 tính năng chưa gán vẫn trả'; end if;
  begin
    perform public.set_integration_assignment_v1('nope', v_id);
    raise exception 'FAIL 4 tính năng lạ';
  exception when invalid_parameter_value then null; end;

  -- 5. Người thường không xem / sửa được.
  select u.id, u.auth_id, u.email into v_user from public.users u
    where u.role <> 'ADMIN' and u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null order by u.created_at limit 1;
  if v_user.id is not null then
    perform set_config('request.jwt.claim.sub', v_user.auth_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user.auth_id, 'role', 'authenticated', 'email', v_user.email)::text, true);
    begin
      perform public.get_integration_connections_v1();
      raise exception 'FAIL 5 người thường xem được';
    exception when insufficient_privilege then null; end;
    begin
      perform public.save_integration_connection_v1(jsonb_build_object('id', v_id, 'kind', 'gemini', 'name', 'x', 'baseUrl', 'https://x.example', 'apiKey', 'stolen'));
      raise exception 'FAIL 5 người thường sửa được';
    exception when insufficient_privilege then null; end;
    perform set_config('request.jwt.claim.sub', v_admin.auth_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin.auth_id, 'role', 'authenticated', 'email', v_admin.email)::text, true);
  end if;

  -- 6. Xóa: bí mật trong Vault đi theo; gán trở về Secrets; có nhật ký.
  perform public.delete_integration_connection_v1(v_id);
  if exists (select 1 from vault.secrets where id = v_secret) then raise exception 'FAIL 6 Vault còn khóa'; end if;
  if (select connection_id from public.integration_assignments where feature = 'ai.fast') is not null then raise exception 'FAIL 6 gán chưa về null'; end if;
  if (select count(*) from public.audit_trail where table_name = 'integration_connections' and record_id = v_id::text) < 4 then raise exception 'FAIL 6 thiếu nhật ký'; end if;
  raise notice 'integration_connections_smoke OK';
end $$;
