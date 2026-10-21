-- Hiệu năng RLS module Nhân sự (audit 20/10/2026, mục H1, PR-3 sau Kho #267 và Quy trình #268): hàm quyền gọi
-- theo TỪNG DÒNG.
--
-- * hrm_attendance_proposals / hrm_leave_requests / hrm_leave_balances / hrm_leave_balance_changes /
--   hrm_attendance_passkey_exemptions gọi app_private.hrm_can_access_employee_subject(nhân viên, mã) cho mỗi dòng
--   (≈8 ms; phần has_governed_hrm_permission toàn cục ≈12 ms chỉ phụ thuộc NGƯỜI DÙNG). hrm_leave_logs gọi
--   hrm_can_access_leave_request (≈12 ms/dòng). Đo với nhân viên thường: 50 đề xuất chấm công 2,7 s (quét 229
--   dòng), phép tồn 0,8 s, nhật ký phép 0,85 s, đơn phép 0,33 s.
-- * hrm_attendance_proposals còn gọi hrm_employee_is_current_user(người đề xuất) (3 ms) và
--   hrm_is_location_manager(loại, id) (1 ms) theo dòng.
-- * 6 bảng lương 3P gọi can_view_hrm_payroll_3p() (12,7 ms) và 13 policy danh mục gọi
--   current_user_has_hrm_template_permission(mã) (6,4 ms) không bọc (select …) → tính lại theo dòng.
--
-- Cách sửa (mẫu #267/#268): tính một lần mỗi câu lệnh (InitPlan).
--   * hrm_can_access_employee_subject(nv, mã) ⇔ nv ∈ current_actor_hrm_visible_employee_ids(mã) (hàm tập có sẵn,
--     đang dùng cho hrm_attendance / hrm_employee_shifts): toàn cục → mọi nhân viên; own → nhân viên có user_id =
--     tôi; direct_reports → nhân viên có quản lý trực tiếp (resolve_strict_direct_manager) = tôi. Hàm theo dòng
--     trả false khi nhân viên không có user_id (trừ toàn cục) — hàm tập cũng vậy vì so sánh với null không khớp.
--   * hrm_can_access_leave_request(đơn, mã) ⇔ đơn có employeeId ∈ tập trên → hrm_visible_leave_request_ids(mã).
--   * hrm_employee_is_current_user(nv) ⇔ nv ∈ hrm_current_user_employee_ids() (cùng sáu điều kiện khớp danh tính).
--   * hrm_is_location_manager(loại, id) ⇔ loại:id ∈ hrm_managed_location_tokens() (công trường / văn phòng có
--     managerId = tôi; loại khác → không bao giờ đúng, như hàm cũ trả null).
--   * can_view_hrm_payroll_3p() và current_user_has_hrm_template_permission(mã) không phụ thuộc dòng: chỉ bọc
--     (select …). Policy ALL bọc cả USING lẫn WITH CHECK.
-- Policy ghi, chốt RESTRICTIVE, policy người duyệt (hrm_leave_requests_approver_select, hrm_leave_logs_approver_select)
-- không đổi. Chứng minh + kiểm hồi quy: docs/performance/rls-initplan-hrm-2026-10.md.

-- 1. Nhân viên là chính người đang đăng nhập (nghĩa hrm_employee_is_current_user), id dạng text.
create or replace function app_private.hrm_current_user_employee_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with current_identity as materialized (
    select
      (select auth.uid()) as auth_user_id,
      public.current_app_user_id() as app_user_id,
      app_private.hrm_current_email() as jwt_email
  ),
  current_user_row as materialized (
    select u.id, u.auth_id, lower(coalesce(u.email, '')) as email
    from public.users u
    cross join current_identity ci
    where u.id = ci.app_user_id
       or (ci.auth_user_id is not null and u.auth_id = ci.auth_user_id)
       or (ci.jwt_email <> '' and lower(coalesce(u.email, '')) = ci.jwt_email)
    order by
      case
        when u.id = ci.app_user_id then 0
        when ci.auth_user_id is not null and u.auth_id = ci.auth_user_id then 1
        else 2
      end
    limit 1
  )
  select coalesce(array_agg(e.id::text), '{}'::text[])
  from public.employees e
  cross join current_identity ci
  left join current_user_row u on true
  where (ci.app_user_id is not null and e.user_id::text = ci.app_user_id::text)
     or (ci.auth_user_id is not null and e.user_id::text = ci.auth_user_id::text)
     or (u.id is not null and e.user_id::text = u.id::text)
     or (u.auth_id is not null and e.user_id::text = u.auth_id::text)
     or (ci.jwt_email <> '' and lower(coalesce(e.email, '')) = ci.jwt_email)
     or (u.email <> '' and lower(coalesce(e.email, '')) = u.email);
$$;

-- 2. Địa điểm mà tôi là quản lý (nghĩa hrm_is_location_manager): token '<loại>:<id>'.
create or replace function app_private.hrm_managed_location_tokens()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  with me as materialized (select public.current_app_user_id()::text as id)
  select coalesce(array_agg(token), '{}'::text[])
  from (
    select 'construction_site:' || s.id::text as token
    from public.hrm_construction_sites s, me
    where nullif(s."managerId", '') = me.id
    union all
    select 'office:' || o.id::text
    from public.hrm_offices o, me
    where nullif(o."managerId", '') = me.id
  ) tokens;
$$;

-- 3. Đơn phép của nhân viên tôi được xem theo mã (nghĩa hrm_can_access_leave_request với actor = tôi).
create or replace function app_private.hrm_visible_leave_request_ids(p_permission_code text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(request_row.id), '{}'::uuid[])
  from public.hrm_leave_requests request_row
  where request_row."employeeId" in (
    select visible_employee.employee_id
    from app_private.current_actor_hrm_visible_employee_ids(p_permission_code) visible_employee
  );
$$;

revoke all on function app_private.hrm_current_user_employee_ids() from public, anon;
revoke all on function app_private.hrm_managed_location_tokens() from public, anon;
revoke all on function app_private.hrm_visible_leave_request_ids(text) from public, anon;
grant execute on function app_private.hrm_current_user_employee_ids() to authenticated;
grant execute on function app_private.hrm_managed_location_tokens() to authenticated;
grant execute on function app_private.hrm_visible_leave_request_ids(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Theo nhân viên.
alter policy hrm_attendance_proposals_scoped_select on public.hrm_attendance_proposals
using (
  "targetEmployeeId" in (
    select visible_employee.employee_id::text
    from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') visible_employee
  )
  or "proposerEmployeeId" = any ((select app_private.hrm_current_user_employee_ids())::text[])
  or ("locationType" || ':' || "locationId") = any ((select app_private.hrm_managed_location_tokens())::text[])
);

alter policy hrm_leave_requests_subject_select on public.hrm_leave_requests
using (
  "employeeId" in (
    select visible_employee.employee_id
    from app_private.current_actor_hrm_visible_employee_ids('hrm.leave.view') visible_employee
  )
);

alter policy hrm_leave_balances_subject_select on public.hrm_leave_balances
using (
  "employeeId" in (
    select visible_employee.employee_id
    from app_private.current_actor_hrm_visible_employee_ids('hrm.leave.view') visible_employee
  )
);

alter policy hrm_leave_balance_changes_select on public.hrm_leave_balance_changes
using (
  employee_id in (
    select visible_employee.employee_id
    from app_private.current_actor_hrm_visible_employee_ids('hrm.leave.view') visible_employee
  )
);

alter policy hrm_passkey_exemptions_select on public.hrm_attendance_passkey_exemptions
using (
  employee_id in (
    select visible_employee.employee_id
    from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') visible_employee
  )
);

alter policy hrm_leave_logs_subject_select on public.hrm_leave_logs
using (leave_request_id = any ((select app_private.hrm_visible_leave_request_ids('hrm.leave.view'))::uuid[]));

alter policy hrm_attendance_devices_select on public.hrm_attendance_devices
using (
  employee_id::text = any ((select app_private.hrm_current_user_employee_ids())::text[])
  or (select app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive'))
);

-- Lương 3P: chỉ phụ thuộc người dùng → một InitPlan.
alter policy hrm_3p_bands_select on public.hrm_3p_bands
using ((select app_private.can_view_hrm_payroll_3p()));
alter policy hrm_3p_grade_band_rates_select on public.hrm_3p_grade_band_rates
using ((select app_private.can_view_hrm_payroll_3p()));
alter policy hrm_compensation_plans_select on public.hrm_compensation_plans
using ((select app_private.can_view_hrm_payroll_3p()));
alter policy hrm_payroll_import_batches_select on public.hrm_payroll_import_batches
using ((select app_private.can_view_hrm_payroll_3p()));
alter policy hrm_payroll_import_rows_select on public.hrm_payroll_import_rows
using ((select app_private.can_view_hrm_payroll_3p()));
alter policy hrm_position_salary_mappings_select on public.hrm_position_salary_mappings
using ((select app_private.can_view_hrm_payroll_3p()));

-- Danh mục theo mẫu quyền HR: chỉ phụ thuộc người dùng → một InitPlan (policy ALL bọc cả WITH CHECK).
alter policy hrm_doc_categories_view_template on public.hrm_doc_categories
using ((select app_private.current_user_has_hrm_template_permission('hrm.document.view')));
alter policy hrm_org_blocks_view_template on public.hrm_org_blocks
using ((select app_private.current_user_has_hrm_template_permission('hrm.organization.view')));
alter policy hrm_payroll_templates_view_template on public.hrm_payroll_templates
using ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.view')));

alter policy hrm_areas_manage_hr_template on public.hrm_areas
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
alter policy hrm_construction_sites_manage_hr_template on public.hrm_construction_sites
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
alter policy hrm_employee_types_manage_hr_template on public.hrm_employee_types
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
alter policy hrm_holidays_manage_hr_template on public.hrm_holidays
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
alter policy hrm_offices_manage_hr_template on public.hrm_offices
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
alter policy hrm_salary_policies_manage_hr_template on public.hrm_salary_policies
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
alter policy hrm_shift_types_manage_template on public.hrm_shift_types
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
alter policy hrm_work_schedules_manage_hr_template on public.hrm_work_schedules
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
alter policy hrm_doc_categories_manage_template on public.hrm_doc_categories
using ((select app_private.current_user_has_hrm_template_permission('hrm.document.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.document.manage')));
alter policy hrm_org_blocks_manage_template on public.hrm_org_blocks
using ((select app_private.current_user_has_hrm_template_permission('hrm.organization.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.organization.manage')));
alter policy hrm_payroll_templates_manage_template on public.hrm_payroll_templates
using ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.manage')));
