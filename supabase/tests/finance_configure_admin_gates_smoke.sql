-- Smoke Đợt 2a-1 phần còn lại (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/finance_configure_admin_gates_smoke.sql
-- Dữ liệu thật 23/10/2026: chị Hương, anh Chuẩn đã thôi Quản trị Tài chính; anh Thịnh còn Quản trị.
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261029095000_finance_configure_and_admin_gates.sql

create temp table p on commit drop as
select key, u.id, u.auth_id from (values
  ('huong', 'huongnt@tienthinhjsc.vn'), ('chuan', 'chuanhd@tienthinhjsc.vn'), ('admin', 'admin@khoviet.vn')
) x(key, email) join public.users u on u.email = x.email and u.is_active;
insert into p select 'thinh', id, auth_id from public.users where name = 'Dương Xuân Thịnh' and is_active;
insert into p select 'thuy', id, auth_id from public.users where name = 'Phạm Thị Thủy' and is_active;
create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;

-- ===== Cấu hình Tài chính =====
select pg_temp.act_as('huong');
do $$
declare v_set public.finance_settings%rowtype; v jsonb;
begin
  if not app_private.finance_can('configure') or app_private.finance_can('manage') then
    raise exception 'SMOKE: chị Hương phải có Cấu hình, không có Quản trị'; end if;
  if not coalesce((app_private.finance_can_flags()->>'configure')::boolean, false) then
    raise exception 'SMOKE: cờ configure chưa trả về giao diện'; end if;
  if (public.get_finance_overview_v1()->>'canOverview') = 'false' then raise exception 'SMOKE: chị Hương chưa xem được Tổng quan'; end if;
  v := public.get_finance_forecast_v1('{}'::jsonb);
  if not coalesce((v->'can'->>'configure')::boolean, false) then raise exception 'SMOKE: dự báo chưa trả can.configure'; end if;
  select * into v_set from public.finance_settings where id = 1;
  perform public.save_finance_cash_settings_v1(jsonb_build_object('minBalance', v_set.cash_min_balance,
    'expectedRowVersion', v_set.row_version, 'reason', 'smoke Đợt 2a-1'));
  begin
    perform public.save_finance_approval_matrix_v1(jsonb_build_object('note', 'smoke', 'rules', '[]'::jsonb));
    raise exception 'SMOKE: chị Hương sửa được ma trận duyệt chi';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK chị Hương: xem Tổng quan + dự báo toàn công ty, sửa số dư quỹ tối thiểu; không sửa được ma trận duyệt';
end $$;

select pg_temp.act_as('chuan');
do $$ begin
  if (public.get_finance_overview_v1()->>'canOverview') = 'false' then raise exception 'SMOKE: anh Chuẩn chưa xem được Tổng quan'; end if;
  raise notice 'OK anh Chuẩn: xem lại được Tổng quan Tài chính';
end $$;

select pg_temp.act_as('thuy');
do $$ begin
  if (public.get_finance_overview_v1()->>'canOverview') is distinct from 'false' then
    raise exception 'SMOKE: kế toán không có Cấu hình xem được Tổng quan'; end if;
  raise notice 'OK kế toán viên (chị Thủy): không có Cấu hình thì không xem Tổng quan BGĐ';
end $$;

-- ===== Công tắc xem tài chính dự án =====
select pg_temp.act_as('thinh');
do $$ begin
  perform public.list_project_sensitive_view_access('b4ce0810-2cac-44af-a83f-8bb1a361567a');
  raise notice 'OK anh Thịnh (Quản trị Tài chính) mở được công tắc xem tài chính dự án';
end $$;
select pg_temp.act_as('huong');
do $$ begin
  begin
    perform public.list_project_sensitive_view_access('b4ce0810-2cac-44af-a83f-8bb1a361567a');
    raise exception 'SMOKE: chị Hương (không Quản trị) mở được công tắc';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK chị Hương không đổi được công tắc xem dự án';
end $$;

-- ===== Phân quyền kho =====
select pg_temp.act_as('admin');
do $$ begin
  if not coalesce((public.get_wms_access_v1()->'can'->>'edit')::boolean, false) then raise exception 'SMOKE: Admin mất quyền sửa Phân quyền kho'; end if;
  raise notice 'OK Admin vẫn sửa được Phân quyền kho';
end $$;
select pg_temp.act_as('huong');
do $$ begin
  if coalesce((public.get_wms_access_v1()->'can'->>'edit')::boolean, false) then raise exception 'SMOKE: người không có Quản trị Kho sửa được'; end if;
  insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active, grant_reason)
  values ((select id from p where key = 'huong'), 'system.wms.manage', 'global', '*', true, 'smoke');
  if not coalesce((public.get_wms_access_v1()->'can'->>'edit')::boolean, false) then raise exception 'SMOKE: có Quản trị Kho vẫn không sửa được'; end if;
  raise notice 'OK Phân quyền kho: chỉ Admin hoặc người có Quản trị Kho vật tư được sửa';
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
