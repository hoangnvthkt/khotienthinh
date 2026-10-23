-- Smoke Đợt 3a (luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/permission_dot3_templates_smoke.sql
-- Dữ liệu thật 23/10/2026: Nguyễn Thành Đô có quyền đã hết hạn chưa tắt; Đoàn Văn Dương từng tự duyệt công;
-- Bùi Thị Tâm kiêm Mua hàng + Thủ kho; Bùi Quang Chung chỉ Mua hàng.
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261030090000_permission_dot3_templates.sql

create temp table p on commit drop as
select key, u.id, u.auth_id from (values
  ('admin', 'admin@khoviet.vn'), ('do', 'dont@tienthinhjsc.vn'), ('duong', 'hiepnb@tienthinhjsc.vn'),
  ('tam', 'tamtt@tienthinhjsc.vn'), ('chung', 'chungbq@tienthinhjsc.vn'), ('huong', 'huongnt@tienthinhjsc.vn'),
  ('thanh', 'thanhpv@tienthinhjsc.vn')
) x(key, email) join public.users u on u.email = x.email and u.is_active;
create function pg_temp.act_as(k text) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role', 'authenticated')::text, true) from p where key = k $$;
create function pg_temp.uid(k text) returns uuid language sql as $$ select id from p where key = k $$;

do $$
declare v_active text[];
begin
  select array_agg(code order by code) into v_active from public.user_permission_templates where is_active;
  if v_active <> array['accountant','basic_employee','executive','finance_director','hr_staff','material_staff','site_staff','warehouse_manager'] then
    raise exception 'SMOKE: mẫu đang dùng không phải 8 mẫu: %', v_active; end if;
  if exists (select 1 from public.user_permission_templates t, jsonb_array_elements(t.items) i
             where t.code = 'warehouse_manager' and i ->> 'permissionCode' in ('system.procurement.manage', 'settings.warehouses.manage')) then
    raise exception 'SMOKE: Cán bộ kho còn quyền quản trị mua hàng / kho bãi'; end if;
  if exists (select 1 from public.user_permission_templates t, jsonb_array_elements(t.items) i
             where t.code = 'finance_director' and i ->> 'permissionCode' = 'system.finance.manage')
     or not exists (select 1 from public.user_permission_templates t, jsonb_array_elements(t.items) i
             where t.code = 'finance_director' and i ->> 'permissionCode' = 'system.finance.configure') then
    raise exception 'SMOKE: Phó TGĐ – GĐ Tài chính chưa đổi Quản trị → Cấu hình Tài chính'; end if;
  if not exists (select 1 from public.user_permission_templates t, jsonb_array_elements(t.items) i
             where t.code = 'hr_staff' and i ->> 'permissionCode' = 'booking.vehicle.dispatch') then
    raise exception 'SMOKE: HCNS chưa gộp Hành chính – Tài sản – Đội xe'; end if;
  if (select options from public.user_permission_templates where code = 'accountant') <> '{chief_accountant,warehouse_accounting}' then
    raise exception 'SMOKE: Kế toán chưa có ô Kế toán trưởng / Kế toán kho'; end if;
  if (select count(*) from public.user_permission_templates t, jsonb_array_elements(t.items) i where t.code = 'warehouse_manager'
      and i ->> 'permissionCode' = 'system.procurement.view') <> 1 then raise exception 'SMOKE: Cán bộ kho trùng quyền Xem mua hàng'; end if;
  raise notice 'OK: còn 8 mẫu; Cán bộ kho không còn quản trị; Phó TGĐ có Cấu hình Tài chính; HCNS gộp đội xe; Kế toán có 2 ô tích';
end $$;

select pg_temp.act_as('admin') \g /dev/null

-- Người có quyền đã hết hạn chưa tắt vẫn gắn mẫu được.
do $$
declare v jsonb;
begin
  v := public.preview_user_template_assignment_v1(pg_temp.uid('do'), 'site_staff', '{}');
  v := public.save_user_template_assignment_v1(pg_temp.uid('do'), 'site_staff', '{}', 'smoke Đợt 3a gắn mẫu');
  if exists (select 1 from public.user_permission_grants where user_id = pg_temp.uid('do') and is_active and expires_at <= now()) then
    raise exception 'SMOKE: quyền hết hạn vẫn còn bật sau khi gắn mẫu'; end if;
  raise notice 'OK: Nguyễn Thành Đô (có quyền hết hạn) gắn mẫu Cán bộ công trường được: thêm %', v ->> 'added';
end $$;

-- Ghi nhận kiêm nhiệm đang có.
do $$
declare v jsonb;
begin
  begin
    perform public.record_existing_sod_acceptance_v1(pg_temp.uid('chung'), 'PROCUREMENT_BUY_WAREHOUSE_KEEPER',
      'Không kiêm thủ kho mà ghi nhận', pg_temp.uid('huong'), 'Đối chiếu nhập kho hằng tháng', now() + interval '6 months');
    raise exception 'SMOKE: ghi nhận cặp không kiêm';
  exception when sqlstate '22023' then if sqlerrm <> 'SOD_CONFLICT_NOT_FOUND' then raise; end if; end;
  begin
    perform public.record_existing_sod_acceptance_v1(pg_temp.uid('tam'), 'PROCUREMENT_BUY_WAREHOUSE_KEEPER',
      'Kế toán kiêm thủ kho và mua hàng', pg_temp.uid('tam'), 'Đối chiếu nhập kho hằng tháng', now() + interval '6 months');
    raise exception 'SMOKE: người được ghi nhận tự làm người kiểm soát';
  exception when sqlstate '22023' then if sqlerrm !~ 'Invalid SoD warning control evidence' then raise; end if; end;
  v := public.record_existing_sod_acceptance_v1(pg_temp.uid('tam'), 'PROCUREMENT_BUY_WAREHOUSE_KEEPER',
    'Kế toán kiêm thủ kho và mua hàng', pg_temp.uid('huong'), 'Đối chiếu nhập kho với đơn mua hằng tháng', now() + interval '6 months');
  v := public.list_user_sod_conflicts_v1(pg_temp.uid('tam'));
  if (select c -> 'acceptance' ->> 'controlOwnerName' from jsonb_array_elements(v -> 0 -> 'conflicts') c
      where c ->> 'ruleCode' = 'PROCUREMENT_BUY_WAREHOUSE_KEEPER') is null then
    raise exception 'SMOKE: danh sách chưa hiện ghi nhận: %', v; end if;
  if jsonb_array_length(v -> 0 -> 'conflicts' -> 0 -> 'permissions') <> 2 or jsonb_array_length(v -> 0 -> 'conflicts' -> 0 -> 'controls') = 0 then
    raise exception 'SMOKE: danh sách thiếu quyền / gợi ý kiểm soát: %', v; end if;
  raise notice 'OK: ghi nhận kiêm nhiệm Bùi Thị Tâm (Nguyễn Thị Hương kiểm soát); chặn tự kiểm soát; chặn ghi nhận cặp không có';
end $$;

select pg_temp.act_as('huong') \g /dev/null
do $$ begin
  begin
    perform public.record_existing_sod_acceptance_v1(pg_temp.uid('tam'), 'PROCUREMENT_BUY_WAREHOUSE_KEEPER',
      'Kế toán kiêm thủ kho và mua hàng', pg_temp.uid('chung'), 'Đối chiếu nhập kho hằng tháng', now() + interval '6 months');
    raise exception 'SMOKE: người không quản lý phân quyền ghi nhận được';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: Nguyễn Thị Hương (không quản lý phân quyền) không ghi nhận được';
end $$;

-- Không tự duyệt chấm công.
do $$
declare v_row uuid := (select a.id from public.hrm_attendance a join public.employees e on e.id::text = a."employeeId"::text
  where e.user_id = pg_temp.uid('duong') and a."approvedBy" is null order by a.date desc limit 1);
begin
  begin
    update public.hrm_attendance set "approvedBy" = pg_temp.uid('duong')::text, "approvedAt" = now() where id = v_row;
    raise exception 'SMOKE: tự duyệt công được';
  exception when insufficient_privilege then null; end;
  update public.hrm_attendance set "approvedBy" = pg_temp.uid('huong')::text, "approvedAt" = now() where id = v_row;
  update public.hrm_attendance set note = coalesce(note, '') where id = v_row;
  begin
    update public.hrm_attendance_proposals set "approvedBy" = pg_temp.uid('thanh')::text
    where id = (select x.id from public.hrm_attendance_proposals x join public.employees e on e.id::text = x."targetEmployeeId"::text
                where e.user_id = pg_temp.uid('thanh') limit 1);
    raise exception 'SMOKE: tự duyệt đề xuất chấm công được';
  exception when insufficient_privilege then null; end;
  raise notice 'OK: tự duyệt công / đề xuất công bị chặn; người khác duyệt và sửa dòng đã duyệt vẫn được';
end $$;

rollback;
\echo 'SMOKE ĐẠT — đã hoàn tác, Cloud không đổi'
