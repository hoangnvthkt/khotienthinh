-- Smoke Đợt 2a-2 audit mẫu quyền (chạy trên Cloud trong giao dịch, luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/account_manager_dot2a2_smoke.sql
-- Người thật 23/10/2026: Nguyễn Thị Giang (Trưởng phòng HCNS, được cấp Quản lý tài khoản), Admin Hoàng (ADMIN),
-- Giang Xuân Kiên (không có quyền), Trần Đình Mười (nhân viên thường), Nguyễn Văn Biểu (tài khoản đang khóa).
-- RPC service_role chạy với claims role = service_role như Edge Function; màn xem trước chạy với sub = auth_id.
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261029100000_account_manager_settings_users.sql

create temp table smoke_people on commit drop as
select key, u.id, u.auth_id, u.email from (values
  ('giang', 'Nguyễn Thị Giang'), ('hoang', 'Admin Hoàng'), ('kien', 'Giang Xuân Kiên'),
  ('muoi', 'Trần Đình Mười'), ('bieu', 'Nguyễn Văn Biểu')
) p(key, name) join public.users u on u.name = p.name;

create or replace function pg_temp.uid(p_key text) returns uuid language sql as $$
  select id from smoke_people where key = p_key;
$$;
create or replace function pg_temp.as_service() returns text language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create or replace function pg_temp.act_as(p_key text) returns text language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', auth_id, 'role', 'authenticated')::text, true)
  from smoke_people where key = p_key;
$$;

-- ===== Quyền gọi RPC =====
do $$
begin
  if (select count(*) from smoke_people) <> 5 then raise exception 'SMOKE: thiếu người thật'; end if;
  if has_function_privilege('authenticated', 'public.account_manager_access_v1(uuid, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.account_manager_access_v1(uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'public.complete_user_account_creation_v1(uuid, uuid, jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.account_manager_access_v1(uuid, uuid, text)', 'execute')
     or not has_function_privilege('service_role', 'public.complete_user_account_creation_v1(uuid, uuid, jsonb)', 'execute') then
    raise exception 'SMOKE: RPC Quản lý tài khoản phải chỉ cho service_role';
  end if;
  raise notice 'OK quyền gọi: chỉ service_role gọi được 2 RPC mới';
end $$;

-- ===== Ai là Quản lý tài khoản, đích nào chỉ Admin =====
do $$
declare v jsonb;
begin
  if not app_private.is_account_manager(pg_temp.uid('giang'))
     or not app_private.is_account_manager(pg_temp.uid('hoang'))
     or app_private.is_account_manager(pg_temp.uid('kien')) then
    raise exception 'SMOKE: Giang + Admin là Quản lý tài khoản, anh Kiên thì không';
  end if;
  v := public.account_manager_access_v1(pg_temp.uid('giang'), pg_temp.uid('hoang'));
  if v <> '{"canManageAccounts": true, "targetRequiresAdmin": true}'::jsonb then raise exception 'SMOKE: Admin phải là đích chỉ Admin (%)', v; end if;
  v := public.account_manager_access_v1(pg_temp.uid('giang'), pg_temp.uid('muoi'));
  if v <> '{"canManageAccounts": true, "targetRequiresAdmin": false}'::jsonb then raise exception 'SMOKE: nhân viên thường (%)', v; end if;
  v := public.account_manager_access_v1(pg_temp.uid('giang'), null, upper((select email from smoke_people where key = 'hoang')));
  if (v ->> 'targetRequiresAdmin')::boolean is not true then raise exception 'SMOKE: tra theo email Admin (%)', v; end if;
  v := public.account_manager_access_v1(pg_temp.uid('giang'), null, 'smoke-2a2-chua-co@invalid.local');
  if (v ->> 'targetRequiresAdmin')::boolean is not false then raise exception 'SMOKE: email mới (%)', v; end if;
  v := public.account_manager_access_v1(pg_temp.uid('kien'));
  if v <> '{"canManageAccounts": false, "targetRequiresAdmin": null}'::jsonb then raise exception 'SMOKE: anh Kiên (%)', v; end if;

  -- Người giữ quyền quản lý phân quyền cũng chỉ Admin đụng được.
  insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, expires_at, grant_reason)
  values (pg_temp.uid('muoi'), 'system.authorization.manage_grants', 'global', '*', true, now() + interval '1 day', 'smoke');
  if not app_private.account_target_requires_admin(pg_temp.uid('muoi')) then
    raise exception 'SMOKE: người giữ manage_grants phải là đích chỉ Admin';
  end if;
  delete from public.user_permission_grants where user_id = pg_temp.uid('muoi') and permission_code = 'system.authorization.manage_grants' and grant_reason = 'smoke';
  raise notice 'OK luật: Admin / người giữ quản lý phân quyền chỉ Admin đụng được; anh Kiên không phải Quản lý tài khoản';
end $$;

-- ===== Khóa / mở lại (đường Edge Function manage-user-account) =====
select pg_temp.as_service();
do $$
declare v_op jsonb; v_status text;
begin
  v_op := public.prepare_user_account_lifecycle(pg_temp.uid('giang'), pg_temp.uid('muoi'), 'DISABLE', 'Smoke Đợt 2a-2 khóa', gen_random_uuid());
  v_op := public.complete_user_account_lifecycle(pg_temp.uid('giang'), (v_op ->> 'operationId')::uuid, '{"auth":"smoke"}');
  select account_status into v_status from public.users where id = pg_temp.uid('muoi');
  if v_op ->> 'status' <> 'COMPLETED' or v_status <> 'DISABLED' then raise exception 'SMOKE: Giang khóa anh Mười (% / %)', v_op ->> 'status', v_status; end if;

  v_op := public.prepare_user_account_lifecycle(pg_temp.uid('giang'), pg_temp.uid('muoi'), 'REACTIVATE', 'Smoke Đợt 2a-2 mở lại', gen_random_uuid());
  v_op := public.complete_user_account_lifecycle(pg_temp.uid('giang'), (v_op ->> 'operationId')::uuid, '{"auth":"smoke"}');
  select account_status into v_status from public.users where id = pg_temp.uid('muoi');
  if v_op ->> 'status' <> 'COMPLETED' or v_status <> 'ACTIVE' then raise exception 'SMOKE: Giang mở lại anh Mười (% / %)', v_op ->> 'status', v_status; end if;
  raise notice 'OK vòng đời: Giang khóa rồi mở lại tài khoản nhân viên';

  begin
    perform public.prepare_user_account_lifecycle(pg_temp.uid('giang'), pg_temp.uid('hoang'), 'DISABLE', 'Smoke Đợt 2a-2 khóa Admin', gen_random_uuid());
    raise exception 'SMOKE: Giang khóa được tài khoản Admin';
  exception when insufficient_privilege then
    if sqlerrm not like 'ACCOUNT_TARGET_ADMIN_ONLY%' then raise; end if;
  end;
  begin
    perform public.prepare_user_account_lifecycle(pg_temp.uid('kien'), pg_temp.uid('muoi'), 'DISABLE', 'Smoke Đợt 2a-2 không quyền', gen_random_uuid());
    raise exception 'SMOKE: anh Kiên khóa được tài khoản';
  exception when insufficient_privilege then
    if sqlerrm not like 'ACCOUNT_MANAGER_REQUIRED%' then raise; end if;
  end;

  -- Tài khoản đang khóa mà trước khi khóa là ADMIN: chỉ Admin mở lại.
  insert into app_private.user_account_operations (idempotency_key, target_user_id, requested_by, action, status, reason, before_state, created_at, completed_at)
  values (gen_random_uuid(), pg_temp.uid('bieu'), pg_temp.uid('hoang'), 'DISABLE', 'COMPLETED', 'smoke former admin', '{"role":"ADMIN"}', now(), now());
  begin
    perform public.prepare_user_account_lifecycle(pg_temp.uid('giang'), pg_temp.uid('bieu'), 'REACTIVATE', 'Smoke Đợt 2a-2 mở lại cựu Admin', gen_random_uuid());
    raise exception 'SMOKE: Giang mở lại được tài khoản từng là Admin';
  exception when insufficient_privilege then
    if sqlerrm not like 'ACCOUNT_TARGET_ADMIN_ONLY%' then raise; end if;
  end;
  v_op := public.prepare_user_account_lifecycle(pg_temp.uid('hoang'), pg_temp.uid('bieu'), 'REACTIVATE', 'Smoke Đợt 2a-2 Admin mở lại', gen_random_uuid());
  if v_op ->> 'status' <> 'DB_APPLIED' then raise exception 'SMOKE: Admin vẫn mở lại được (%)', v_op; end if;
  raise notice 'OK chặn: Giang không khóa Admin, không mở lại cựu Admin; anh Kiên bị chặn; Admin vẫn làm được';
end $$;

-- ===== Tạo tài khoản (đường Edge Function create-user) =====
do $$
declare v_auth uuid; v jsonb; v_role text; v_shadow uuid;
begin
  -- Trigger Auth tạo hồ sơ EMPLOYEE; Giang xin ADMIN vẫn ra EMPLOYEE.
  v_auth := gen_random_uuid();
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_auth, 'authenticated', 'authenticated', 'smoke-2a2-giang@invalid.local', '{"name":"Smoke 2a-2"}', now(), now());
  v := public.complete_user_account_creation_v1(pg_temp.uid('giang'), v_auth,
    '{"role":"ADMIN","name":"Smoke Giang tạo","username":"smoke-2a2-giang","assignedWarehouseId":"WH-SMOKE"}');
  select role::text into v_role from public.users where auth_id = v_auth;
  if v_role <> 'EMPLOYEE' or v ->> 'role' <> 'EMPLOYEE'
     or (select assigned_warehouse_id from public.users where auth_id = v_auth) is not null
     or (select username from public.users where auth_id = v_auth) <> 'smoke-2a2-giang' then
    raise exception 'SMOKE: Giang tạo tài khoản phải là EMPLOYEE, chưa gán kho (%)', v;
  end if;
  if not exists (select 1 from public.permission_audit_events where event_type = 'account_created' and target_user_id = (v ->> 'profileId')::uuid and actor_user_id = pg_temp.uid('giang')) then
    raise exception 'SMOKE: thiếu nhật ký tạo tài khoản';
  end if;

  -- Admin vẫn tạo được Quản trị viên.
  v_auth := gen_random_uuid();
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_auth, 'authenticated', 'authenticated', 'smoke-2a2-admin@invalid.local', '{"name":"Smoke 2a-2 Admin"}', now(), now());
  v := public.complete_user_account_creation_v1(pg_temp.uid('hoang'), v_auth, '{"role":"ADMIN","name":"Smoke Admin tạo"}');
  if v ->> 'role' <> 'ADMIN' then raise exception 'SMOKE: Admin tạo Quản trị viên (%)', v; end if;

  -- Anh Kiên không tạo được.
  begin
    perform public.complete_user_account_creation_v1(pg_temp.uid('kien'), v_auth, '{"role":"EMPLOYEE"}');
    raise exception 'SMOKE: anh Kiên ghi được hồ sơ tài khoản mới';
  exception when insufficient_privilege then
    if sqlerrm not like 'ACCOUNT_MANAGER_REQUIRED%' then raise; end if;
  end;

  -- Hồ sơ Admin có sẵn (chưa đăng nhập) cùng email: Giang không gắn được đăng nhập vào đó.
  v_shadow := gen_random_uuid();
  insert into public.users (id, name, email, username, role, avatar)
  values (v_shadow, 'Smoke hồ sơ Admin', 'smoke-2a2-shadow@invalid.local', 'smoke-2a2-shadow', 'ADMIN', '/default-avatar.svg');
  v := public.account_manager_access_v1(pg_temp.uid('giang'), null, 'smoke-2a2-shadow@invalid.local');
  if (v ->> 'targetRequiresAdmin')::boolean is not true then raise exception 'SMOKE: kiểm trước theo email (%)', v; end if;
  v_auth := gen_random_uuid();
  -- GoTrue chạy dưới supabase_auth_admin (guard cho qua); ở đây giả lập bằng lệnh tin cậy.
  perform set_config('app.account_lifecycle_command', 'on', true);
  insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (v_auth, 'authenticated', 'authenticated', 'smoke-2a2-shadow@invalid.local', '{}', now(), now());
  perform set_config('app.account_lifecycle_command', '', true);
  if (select auth_id from public.users where id = v_shadow) is distinct from v_auth then
    raise exception 'SMOKE: trigger Auth phải gắn hồ sơ có sẵn';
  end if;
  begin
    perform public.complete_user_account_creation_v1(pg_temp.uid('giang'), v_auth, '{"role":"EMPLOYEE"}');
    raise exception 'SMOKE: Giang gắn được đăng nhập vào hồ sơ Admin có sẵn';
  exception when insufficient_privilege then
    if sqlerrm not like 'ACCOUNT_TARGET_ADMIN_ONLY%' then raise; end if;
  end;
  raise notice 'OK tạo tài khoản: Giang ra EMPLOYEE, Admin tạo được ADMIN, anh Kiên bị chặn, hồ sơ Admin có sẵn bị chặn';
end $$;

-- ===== Hộp Khóa / Mở lại trên màn hình (người đăng nhập thật) =====
select pg_temp.act_as('giang');
do $$
declare v jsonb;
begin
  v := public.get_user_account_lifecycle_preview(pg_temp.uid('muoi'));
  if v ->> 'targetUserId' <> pg_temp.uid('muoi')::text then raise exception 'SMOKE: Giang xem trước khóa anh Mười (%)', v; end if;
  begin
    perform public.get_user_account_lifecycle_preview(pg_temp.uid('hoang'));
    raise exception 'SMOKE: Giang xem trước khóa được Admin';
  exception when insufficient_privilege then
    if sqlerrm not like 'ACCOUNT_TARGET_ADMIN_ONLY%' then raise; end if;
  end;
  -- Đổi role / sửa phân quyền vẫn cần quyền quản lý phân quyền.
  begin
    perform public.change_user_account_role_v2(pg_temp.uid('muoi'), 'ADMIN', null,
      (select updated_at from public.users where id = pg_temp.uid('muoi')), 'Smoke Đợt 2a-2 đổi role');
    raise exception 'SMOKE: Giang đổi được role';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK màn hình: Giang xem trước được nhân viên, không xem trước Admin, không đổi role';
end $$;

select pg_temp.act_as('kien');
do $$
begin
  begin
    perform public.get_user_account_lifecycle_preview(pg_temp.uid('muoi'));
    raise exception 'SMOKE: anh Kiên xem trước khóa được';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK màn hình: anh Kiên không có Quản lý tài khoản';
end $$;

rollback;
