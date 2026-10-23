-- Smoke Đợt 2a-3 vai trò HR_VIEWER (chạy trên Cloud trong giao dịch, luôn HOÀN TÁC):
--   psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/hrm_viewer_role_smoke.sql
-- Chạy như người thật (claims sub = users.auth_id): 4 người được gán (Thịnh, Mơ, Chuẩn, Nguyễn Thị Hương TCKT),
-- HR thường (Hà Thị Hải Hồng), nhân viên thường (Phạm Đình Dương), Admin Hoàng cho kênh gán vai trò.
-- Đơn NP-2026-0031 đang chờ anh Phạm Ngọc Sơn duyệt — người xem không được duyệt thay như HR.
-- (Bước HR không ghi người — userId null — đang lọt cho MỌI người: lỗi có sẵn, xử lý ở PR riêng.)
-- Lưu ý: migration sửa policy trên storage.objects nên giữ khóa bảng đó tới ROLLBACK; chạy liền một mạch.
\set ON_ERROR_STOP 1
begin;
\ir ../migrations/20261029110000_hrm_viewer_role.sql

create temp table smoke_people on commit drop as
select key, u.id, u.auth_id, e.id as employee_id from (values
  ('thinh', 'thinhdx@tienthinhjsc.vn'), ('mo', 'mont@tienthinhjsc.vn'), ('chuan', 'chuanhd@tienthinhjsc.vn'),
  ('huong', 'huongnt@tienthinhjsc.vn'), ('hr', 'honghh@tienthinhjsc.vn'), ('admin', 'admin@khoviet.vn'),
  ('dev', 'Phạm Đình Dương')
) p(key, ref)
join public.users u on (u.email = p.ref or u.name = p.ref) and u.is_active
left join public.employees e on e.user_id = u.id;
grant select on smoke_people to authenticated;

create or replace function pg_temp.act_as(p_key text) returns text language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', auth_id, 'role', 'authenticated')::text, true)
  from smoke_people where key = p_key;
$$;

-- Lệnh phải bị chặn với 42501 (hoặc mã nêu riêng).
create or replace function pg_temp.expect_denied(p_label text, p_sql text, p_state text default '42501')
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'SMOKE: % lẽ ra phải bị chặn', p_label;
exception when others then
  if sqlstate <> p_state then
    raise exception 'SMOKE: % bị lỗi khác (% %), mong đợi %', p_label, sqlstate, sqlerrm, p_state;
  end if;
end $$;

-- ===== Gán đúng 4 người, phạm vi toàn công ty =====
do $$
declare v_count int;
begin
  select count(*) into v_count
  from public.principal_role_assignments a
  join public.role_permission_templates t on t.id = a.role_template_id and t.code = 'HR_VIEWER'
  join smoke_people p on p.id = a.principal_id and p.key in ('thinh', 'mo', 'chuan', 'huong')
  where a.status = 'ACTIVE' and a.scope_type = 'global' and a.scope_id = '*' and a.expires_at is null;
  if v_count <> 4 then raise exception 'SMOKE: HR_VIEWER phải gán đủ 4 người (%)', v_count; end if;
  select count(*) into v_count from public.role_permission_template_items i
  join public.role_permission_templates t on t.id = i.template_id and t.code = 'HR_VIEWER';
  if v_count <> 12 then raise exception 'SMOKE: mẫu HR_VIEWER phải có 12 quyền xem (%)', v_count; end if;
  raise notice 'OK gán: 4 người, 12 quyền xem';
end $$;

-- ===== Mẫu chỉ nhận quyền xem =====
do $$
begin
  perform pg_temp.expect_denied('thêm hrm.payroll.manage vào HR_VIEWER',
    $q$insert into public.role_permission_template_items (template_id, permission_code)
       select id, 'hrm.payroll.manage' from public.role_permission_templates where code = 'HR_VIEWER'$q$);
  perform pg_temp.expect_denied('thêm hrm.payroll.export vào HR_VIEWER',
    $q$insert into public.role_permission_template_items (template_id, permission_code)
       select id, 'hrm.payroll.export' from public.role_permission_templates where code = 'HR_VIEWER'$q$);
  raise notice 'OK mẫu: không thêm được quyền sửa / xuất';
end $$;

-- ===== Từng người xem: đọc được, ghi bị chặn =====
create or replace function pg_temp.check_viewer(p_key text) returns void language plpgsql as $$
declare
  v_user uuid := (select id from smoke_people where key = p_key);
  v_other uuid := (select employee_id from smoke_people where key = 'dev');
  v_overview jsonb;
  v_snapshot jsonb;
  v_n int;
begin
  perform pg_temp.act_as(p_key);
  if public.current_app_user_id() is distinct from v_user then
    raise exception 'SMOKE: claims của % không khớp', p_key;
  end if;

  -- Đọc: bảng lương, hợp đồng, đãi ngộ, tài liệu, số phép, định biên, Dashboard nhân sự.
  if jsonb_array_length(public.list_hrm_payrolls()) <> (select count(*) from public.hrm_payrolls) then
    raise exception 'SMOKE: % không thấy đủ bảng lương', p_key;
  end if;
  if jsonb_array_length(public.list_hrm_labor_contracts()) <> (select count(*) from public.hrm_labor_contracts) then
    raise exception 'SMOKE: % không thấy đủ hợp đồng', p_key;
  end if;
  perform public.list_hrm_salary_history();
  perform public.list_hrm_compensation_assignments();
  perform public.list_hrm_manual_allowances();
  perform public.list_hrm_payroll_components();
  perform public.list_hrm_documents(null, null, null, null, 10);
  perform public.list_hrm_leave_balances(2026);
  perform public.get_hrm_leave_ledger(v_other, 2026);
  perform public.get_hrm_manager_scope_readiness();
  perform public.get_hrm_headcount_trend_v1(date '2026-01-01', date '2026-10-01');
  if not app_private.can_view_hrm_payroll_3p() then raise exception 'SMOKE: % không xem được 3P', p_key; end if;

  -- Hồ sơ người khác: xem đủ 8 nhóm, không nhóm nào sửa.
  if app_private.hrm_employee_profile_access_level(v_other) <> 'HR_VIEWER' then
    raise exception 'SMOKE: % mức hồ sơ phải là HR_VIEWER (%)', p_key, app_private.hrm_employee_profile_access_level(v_other);
  end if;
  v_overview := public.get_hrm_employee_overview(v_other);
  if jsonb_array_length(v_overview->'visibleSections') <> 8 or v_overview->'canEditSections' <> '[]'::jsonb then
    raise exception 'SMOKE: % tổng quan hồ sơ sai %', p_key, v_overview->'canEditSections';
  end if;
  perform app_private.get_hrm_employee_compensation_tax_bank(v_other);
  perform app_private.get_hrm_employee_contract_employment(v_other);
  perform app_private.get_hrm_employee_legal_insurance(v_other);
  perform app_private.get_hrm_employee_qualifications_documents(v_other);
  perform app_private.get_hrm_employee_personal_contact(v_other);
  if app_private.can_edit_hrm_c2(v_other) then raise exception 'SMOKE: % sửa được hồ sơ', p_key; end if;

  -- Không thành "người làm HR".
  if app_private.has_hrm_template_permission(v_user, 'hrm.employee.view_sensitive')
     or app_private.has_hrm_view_permission(v_user, 'hrm.employee.edit_sensitive')
     or app_private.has_hrm_view_permission(v_user, 'hrm.payroll.export')
     or app_private.has_permission(v_user, 'hrm.employee.edit_profile')
     or app_private.has_permission(v_user, 'hrm.leave.approve')
     or app_private.has_permission(v_user, 'hrm.attendance.edit') then
    raise exception 'SMOKE: % có quyền ngoài vai trò xem', p_key;
  end if;

  -- Ảnh quyền phía client: có quyền xem nhạy cảm, không có quyền sửa nào từ HR_VIEWER.
  v_snapshot := public.get_my_authorization_snapshot();
  select count(*) into v_n from jsonb_array_elements(v_snapshot->'sources') s
  where s->>'sourceCode' = 'HR_VIEWER' and s->>'permissionCode' in ('hrm.employee.view_sensitive', 'hrm.payroll.view');
  if v_n <> 2 then raise exception 'SMOKE: % ảnh quyền thiếu quyền xem (%)', p_key, v_n; end if;
  select count(*) into v_n from jsonb_array_elements(v_snapshot->'sources') s
  where s->>'sourceCode' = 'HR_VIEWER' and not app_private.is_hrm_viewer_permission(s->>'permissionCode');
  if v_n <> 0 then raise exception 'SMOKE: % ảnh quyền có quyền ngoài danh sách xem', p_key; end if;

  -- Ghi: hồ sơ, lương, hợp đồng, phép, quản lý trực tiếp, duyệt thay HR.
  perform pg_temp.expect_denied(p_key || ' sửa hồ sơ', format(
    $q$select public.update_hrm_employee_core_profile(%L, 'x', null, null, null, null, null, null, null, null,
       null, null, null, null, null, null, 'smoke 2a-3 thử sửa', null, null, null)$q$, v_other));
  perform pg_temp.expect_denied(p_key || ' lưu phiếu lương',
    $q$select public.upsert_hrm_payroll('{}'::jsonb, 'smoke 2a-3 thử lưu')$q$);
  perform pg_temp.expect_denied(p_key || ' xóa phiếu lương', format(
    $q$select public.delete_hrm_payroll(%L, 'smoke 2a-3 thử xóa')$q$, (select id from public.hrm_payrolls limit 1)));
  perform pg_temp.expect_denied(p_key || ' sửa hợp đồng', format(
    $q$select public.upsert_hrm_employee_contract(null, %L, 'SMOKE', 'definite', 'active', current_date, null,
       null, null, 1, 0, 0, 'smoke 2a-3 thử hợp đồng')$q$, v_other));
  perform pg_temp.expect_denied(p_key || ' chỉnh số phép', format(
    $q$select public.adjust_hrm_leave_balance(%L, 2026, 5, 'smoke 2a-3 thử chỉnh')$q$, v_other));
  perform pg_temp.expect_denied(p_key || ' đặt quản lý trực tiếp', format(
    $q$select public.set_hrm_designated_manager(%L, null, 'smoke 2a-3 thử đặt')$q$, v_other));
  perform pg_temp.expect_denied(p_key || ' duyệt thay NP-2026-0031',
    $q$select public.decide_leave_request((select id from public.hrm_leave_requests where code = 'NP-2026-0031'),
       'approve', 'smoke 2a-3 thử duyệt')$q$);
  perform pg_temp.expect_denied(p_key || ' tải tài liệu HR', format(
    $q$select public.upsert_hrm_document_metadata('{}'::jsonb, 'smoke 2a-3 thử tài liệu')$q$));
  raise notice 'OK %: đọc bảng lương / hợp đồng / hồ sơ đủ 8 nhóm, mọi lệnh ghi bị chặn', p_key;
end $$;

select pg_temp.check_viewer('thinh');
select pg_temp.check_viewer('mo');
select pg_temp.check_viewer('chuan');
select pg_temp.check_viewer('huong');

-- ===== Bảng qua RLS (vai trò authenticated; bảng lương / hợp đồng không cấp bảng cho client, chỉ qua RPC) =====
create temp table smoke_totals on commit drop as
select (select count(*) from public.hrm_payroll_templates) as templates,
       (select count(*) from public.hrm_org_position_slots) as slots,
       (select count(*) from storage.objects where bucket_id = 'hr-documents') as hr_files;
grant select on smoke_totals to authenticated;
select pg_temp.act_as('huong');
set local role authenticated;
do $$
declare v_n int; v_total record;
begin
  select * into v_total from smoke_totals;
  select count(*) into v_n from public.hrm_payroll_templates;
  if v_n <> v_total.templates then raise exception 'SMOKE: mẫu bảng lương thấy %/%', v_n, v_total.templates; end if;
  select count(*) into v_n from public.hrm_org_position_slots;
  if v_n <> v_total.slots then raise exception 'SMOKE: định biên thấy %/%', v_n, v_total.slots; end if;
  select count(*) into v_n from storage.objects where bucket_id = 'hr-documents';
  if v_n <> v_total.hr_files then raise exception 'SMOKE: tệp hr-documents thấy %/%', v_n, v_total.hr_files; end if;
  perform 1 from public.hrm_doc_categories limit 1;
  perform 1 from public.hrm_org_blocks limit 1;
  perform 1 from public.hrm_employee_slot_assignments limit 1;
  perform 1 from public.hrm_manager_scope_exclusions limit 1;
  update public.hrm_payroll_templates set name = name where true;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SMOKE: người xem sửa được % mẫu bảng lương', v_n; end if;
  delete from public.hrm_payroll_templates where true;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SMOKE: người xem xóa được % mẫu bảng lương', v_n; end if;
  update public.hrm_org_position_slots set description = description where true;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'SMOKE: người xem sửa được % ô định biên', v_n; end if;
  begin
    insert into public.hrm_attendance_passkey_exemptions (employee_id, reason)
    select id, 'smoke 2a-3' from public.employees limit 1;
    raise exception 'SMOKE: người xem thêm được miễn passkey';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK RLS: thấy đủ mẫu bảng lương (%), định biên (%), tệp HR (%); không sửa / xóa được',
    v_total.templates, v_total.slots, v_total.hr_files;
end $$;
reset role;

-- ===== Không đổi với người khác =====
select pg_temp.act_as('dev');
do $$
begin
  perform pg_temp.expect_denied('nhân viên thường xem bảng lương', 'select public.list_hrm_payrolls()');
  if app_private.hrm_employee_profile_access_level((select employee_id from smoke_people where key = 'thinh'))
     in ('HR', 'HR_MANAGE', 'HR_VIEWER') then
    raise exception 'SMOKE: nhân viên thường có mức hồ sơ HR';
  end if;
  raise notice 'OK nhân viên thường: vẫn không xem được bảng lương';
end $$;

select pg_temp.act_as('hr');
do $$
begin
  perform public.list_hrm_payrolls();
  if app_private.hrm_employee_profile_access_level((select employee_id from smoke_people where key = 'dev')) <> 'HR' then
    raise exception 'SMOKE: HR thường phải giữ mức HR';
  end if;
  raise notice 'OK HR thường: giữ nguyên';
end $$;

-- ===== Kênh gán vai trò HR: Admin thu hồi rồi gán lại HR_VIEWER =====
select pg_temp.act_as('admin');
do $$
declare
  v_huong uuid := (select id from smoke_people where key = 'huong');
  v_preview jsonb;
  v_result jsonb;
begin
  v_result := public.get_user_hr_authorization(v_huong);
  if v_result->>'hrRole' <> 'HR_VIEWER' then raise exception 'SMOKE: hrRole phải là HR_VIEWER (%)', v_result->>'hrRole'; end if;

  v_preview := public.preview_user_hr_business_role(v_huong, 'NONE', null);
  v_result := public.set_user_hr_business_role(v_huong, 'NONE', null, 'Smoke 2a-3 thu hồi thử', '[]'::jsonb, v_preview->>'fingerprint');
  if v_result->>'hrRole' is not null or app_private.has_hrm_view_permission(v_huong, 'hrm.payroll.view') then
    raise exception 'SMOKE: thu hồi HR_VIEWER không có hiệu lực';
  end if;

  v_preview := public.preview_user_hr_business_role(v_huong, 'HR_VIEWER', null);
  if jsonb_array_length(v_preview->'hardDenies') > 0 then
    raise exception 'SMOKE: gán HR_VIEWER bị chặn %', v_preview->'hardDenies';
  end if;
  v_result := public.set_user_hr_business_role(v_huong, 'HR_VIEWER', null, 'Smoke 2a-3 gán lại thử', '[]'::jsonb, v_preview->>'fingerprint');
  if v_result->>'hrRole' <> 'HR_VIEWER' or not app_private.has_hrm_view_permission(v_huong, 'hrm.payroll.view') then
    raise exception 'SMOKE: gán lại HR_VIEWER không có hiệu lực';
  end if;
  raise notice 'OK kênh gán HR: thu hồi / gán lại HR_VIEWER, cảnh báo %', v_preview->'warnings';
end $$;

rollback;
