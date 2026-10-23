-- Đợt 2a-3 audit mẫu quyền (chủ SP chốt 23/10/2026): vai trò CHỈ XEM nhân sự & bảng lương cho Ban lãnh đạo
-- (Thịnh, Mơ, Chuẩn) và kế toán (Trưởng phòng TCKT Nguyễn Thị Hương) — xem Dashboard nhân sự, bảng lương để chi.
--
-- Vì sao không mở thẳng has_hrm_template_permission cho vai trò mới: hàm đó đang là cổng "người làm HR" của cả
-- lệnh GHI — duyệt / hủy nghỉ phép, chỉnh số phép, duyệt thiết bị chấm công, duyệt đề nghị sửa hồ sơ, đặt quản lý
-- trực tiếp, miễn passkey, sửa tiêu chí xếp hạng… đều chỉ kiểm hrm.employee.view_sensitive. Nên giữ nguyên nó (HR /
-- HR_MANAGE) và thêm has_hrm_view_permission, chỉ thay ở các đường ĐỌC liệt kê dưới đây. Đường nào không đổi thì
-- HR_VIEWER vẫn bị chặn như người thường.
--
-- hrm.payroll.export KHÔNG nằm trong vai trò: hiện chưa gắn với lệnh nào; để chủ SP quyết khi làm nút xuất có kiểm quyền.

-- 1. Danh sách quyền xem của vai trò. Thêm quyền vào mẫu HR_VIEWER phải nằm trong danh sách này (trigger ở mục 3).
create or replace function app_private.is_hrm_viewer_permission(p_permission_code text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select p_permission_code = any(array[
    'hrm.employee.view_directory',
    'hrm.employee.view_profile',
    'hrm.employee.view_sensitive',
    'hrm.attendance.view',
    'hrm.leave.view',
    'hrm.payroll.view',
    'hrm.contract.view',
    'hrm.compensation.view',
    'hrm.document.view',
    'hrm.organization.view',
    'hrm.staffing.view',
    'hrm.master_data.view'
  ]::text[]);
$function$;

-- Xem dữ liệu HR nhạy cảm: HR / HR Manage như cũ, thêm HR_VIEWER nhưng chỉ cho các quyền xem ở trên.
create or replace function app_private.has_hrm_view_permission(p_user_id uuid, p_permission_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_user_id is not null and exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id,
      p_permission_code,
      'global',
      '*',
      now()
    ) source_row
    where source_row.source_type = 'ROLE'
      and source_row.scope_type = 'global'
      and source_row.scope_id = '*'
      and (
        source_row.source_code in ('HR', 'HR_MANAGE')
        or (
          source_row.source_code = 'HR_VIEWER'
          and app_private.is_hrm_viewer_permission(p_permission_code)
        )
      )
  );
$function$;

create or replace function app_private.current_user_has_hrm_view_permission(p_permission_code text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app_private.has_hrm_view_permission(
    public.current_app_user_id(),
    p_permission_code
  );
$function$;

revoke all on function app_private.is_hrm_viewer_permission(text) from public;
revoke all on function app_private.has_hrm_view_permission(uuid, text) from public;
revoke all on function app_private.current_user_has_hrm_view_permission(text) from public;
grant execute on function app_private.is_hrm_viewer_permission(text) to service_role;
grant execute on function app_private.has_hrm_view_permission(uuid, text) to service_role;
grant execute on function app_private.current_user_has_hrm_view_permission(text) to authenticated;

-- 2. Vai trò hệ thống HR_VIEWER (như HR / HR_MANAGE: gán ở Người dùng → Vai trò đặc biệt, một vai trò HR mỗi lúc).
insert into public.role_permission_templates (code, name, description, is_active, is_system)
values (
  'HR_VIEWER',
  'Xem nhân sự & lương',
  'Chỉ xem: hồ sơ đầy đủ, hợp đồng, tài liệu, đãi ngộ, bảng lương, chấm công, nghỉ phép, sơ đồ tổ chức. Không sửa, không duyệt, không xuất.',
  true,
  true
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = true,
  is_system = true,
  updated_at = now();

insert into public.role_permission_template_items (template_id, permission_code, scope_type, scope_id, sort_order)
select template.id, action_row.permission_code, 'global', '*', row_number() over (order by action_row.permission_code)
from public.role_permission_templates template
join public.permission_actions action_row
  on app_private.is_hrm_viewer_permission(action_row.permission_code)
where template.code = 'HR_VIEWER'
on conflict (template_id, permission_code, scope_type, scope_id) do nothing;

-- 3. Mẫu HR_VIEWER chỉ nhận quyền xem, kể cả khi ai đó sửa mẫu sau này.
create or replace function app_private.guard_hrm_viewer_template_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1 from public.role_permission_templates template_row
    where template_row.id = new.template_id and template_row.code = 'HR_VIEWER'
  ) and not app_private.is_hrm_viewer_permission(new.permission_code) then
    raise exception 'HRM_VIEWER_VIEW_ONLY: % is not a view permission', new.permission_code
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function app_private.guard_hrm_viewer_template_item() from public;

drop trigger if exists trg_guard_hrm_viewer_template_item on public.role_permission_template_items;
create trigger trg_guard_hrm_viewer_template_item
  before insert or update of template_id, permission_code on public.role_permission_template_items
  for each row execute function app_private.guard_hrm_viewer_template_item();

-- 4. Bảng: chỉ các quy tắc ĐỌC chuyển sang kiểm xem; quy tắc ghi giữ nguyên HR / HR_MANAGE.
alter policy hrm_payrolls_select_hr_template on public.hrm_payrolls
  using ((select app_private.current_user_has_hrm_view_permission('hrm.payroll.view')));
alter policy hrm_payroll_components_select_hr_template on public.hrm_payroll_components
  using ((select app_private.current_user_has_hrm_view_permission('hrm.payroll.view')));
alter policy hrm_payroll_templates_view_template on public.hrm_payroll_templates
  using ((select app_private.current_user_has_hrm_view_permission('hrm.payroll.view')));
alter policy hrm_labor_contracts_select_hr_template on public.hrm_labor_contracts
  using ((select app_private.current_user_has_hrm_view_permission('hrm.contract.view')));
alter policy hrm_employee_compensation_assignments_select_hr_template on public.hrm_employee_compensation_assignments
  using ((select app_private.current_user_has_hrm_view_permission('hrm.compensation.view')));
alter policy hrm_employee_manual_allowances_select_hr_template on public.hrm_employee_manual_allowances
  using ((select app_private.current_user_has_hrm_view_permission('hrm.compensation.view')));
alter policy hrm_salary_history_select_hr_template on public.hrm_salary_history
  using ((select app_private.current_user_has_hrm_view_permission('hrm.compensation.view')));
alter policy hrm_documents_select_hr_template on public.hrm_documents
  using ((select app_private.current_user_has_hrm_view_permission('hrm.document.view')));
alter policy hrm_doc_categories_view_template on public.hrm_doc_categories
  using ((select app_private.current_user_has_hrm_view_permission('hrm.document.view')));
alter policy hrm_org_blocks_view_template on public.hrm_org_blocks
  using ((select app_private.current_user_has_hrm_view_permission('hrm.organization.view')));
alter policy hrm_org_position_slots_view_hr_template on public.hrm_org_position_slots
  using ((select app_private.current_user_has_hrm_view_permission('hrm.staffing.view')));
alter policy hrm_employee_slot_assignments_view_hr_template on public.hrm_employee_slot_assignments
  using ((select app_private.current_user_has_hrm_view_permission('hrm.staffing.view')));
alter policy hrm_manager_scope_exclusions_read on public.hrm_manager_scope_exclusions
  using ((select app_private.current_user_has_hrm_view_permission('hrm.staffing.view')));
alter policy hr_documents_template_select on storage.objects
  using (bucket_id = 'hr-documents' and app_private.current_user_has_hrm_view_permission('hrm.document.view'));

-- 5. Lệnh đọc (bảng lương, hợp đồng, đãi ngộ, tài liệu, danh bạ, số phép, định biên): kiểm xem thay cho kiểm HR.

CREATE OR REPLACE FUNCTION app_private.can_view_hrm_payroll_3p()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app_private.has_hrm_view_permission(public.current_app_user_id(), 'hrm.compensation.view')
      or app_private.has_hrm_view_permission(public.current_app_user_id(), 'hrm.payroll.view');
$function$;

CREATE OR REPLACE FUNCTION public.list_hrm_payrolls()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.has_hrm_view_permission(public.current_app_user_id(), 'hrm.payroll.view') then
    raise exception using errcode = '42501', message = 'HRM_PAYROLL_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', payroll.id, 'employeeId', payroll."employeeId", 'month', payroll.month, 'year', payroll.year,
    'workingDays', payroll."workingDays", 'standardDays', payroll."standardDays",
    'overtimeHours', payroll."overtimeHours", 'baseSalary', payroll."baseSalary",
    'dailyRate', payroll."dailyRate", 'overtimeRate', payroll."overtimeRate",
    'allowancePosition', payroll."allowancePosition", 'allowanceMeal', payroll."allowanceMeal",
    'allowanceTransport', payroll."allowanceTransport", 'allowancePhone', payroll."allowancePhone",
    'allowanceOther', payroll."allowanceOther", 'deductionInsurance', payroll."deductionInsurance",
    'deductionTax', payroll."deductionTax", 'deductionAdvance', payroll."deductionAdvance",
    'deductionOther', payroll."deductionOther", 'grossSalary', payroll."grossSalary",
    'netSalary', payroll."netSalary", 'note', payroll.note, 'status', payroll.status,
    'paidDate', payroll."paidDate", 'createdAt', payroll."createdAt",
    'calculationMode', payroll."calculationMode", 'compensationPlanId', payroll."compensationPlanId",
    'compensationAssignmentId', payroll."compensationAssignmentId", 'salaryGradeId', payroll."salaryGradeId",
    'p3BandId', payroll."p3BandId", 'kpiBandId', payroll."kpiBandId",
    'p1Salary', payroll."p1Salary", 'p3StandardSalary', payroll."p3StandardSalary",
    'p3ActualSalary', payroll."p3ActualSalary", 'kpiMultiplier', payroll."kpiMultiplier",
    'recurringAllowanceTotal', payroll."recurringAllowanceTotal",
    'payrollComponentSnapshot', payroll."payrollComponentSnapshot",
    'calculationSnapshot', payroll."calculationSnapshot",
    'templateId', payroll."templateId", 'templateValues', payroll."templateValues"
  ) order by payroll.year desc, payroll.month desc) from public.hrm_payrolls payroll), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_hrm_labor_contracts()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.has_hrm_view_permission(public.current_app_user_id(), 'hrm.contract.view') then
    raise exception using errcode = '42501', message = 'HRM_CONTRACT_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'employee_id', employee_id, 'contract_number', contract_number,
    'type', type, 'status', status, 'effective_from', effective_from,
    'effective_to', effective_to, 'base_salary', base_salary,
    'allowance_position', allowance_position, 'allowance_other', allowance_other,
    'signed_by', signed_by, 'note', note, 'created_at', created_at, 'updated_at', updated_at
  ) order by created_at desc) from public.hrm_labor_contracts), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_hrm_salary_history()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.has_hrm_view_permission(public.current_app_user_id(), 'hrm.compensation.view') then
    raise exception using errcode = '42501', message = 'HRM_COMPENSATION_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'employee_id', employee_id, 'contract_id', contract_id,
    'effective_from', effective_from, 'effective_to', effective_to,
    'previous_salary', previous_salary, 'new_salary', new_salary,
    'previous_allowance', previous_allowance, 'new_allowance', new_allowance,
    'reason', reason, 'changed_by_legacy', changed_by_legacy,
    'status', status, 'created_at', created_at, 'updated_at', updated_at
  ) order by effective_from desc) from public.hrm_salary_history), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_hrm_compensation_assignments()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.has_hrm_view_permission(public.current_app_user_id(), 'hrm.compensation.view') then
    raise exception using errcode = '42501', message = 'HRM_COMPENSATION_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', id, 'employee_id', employee_id, 'employee_code_snapshot', employee_code_snapshot,
    'employee_name_snapshot', employee_name_snapshot, 'plan_id', plan_id, 'position_id', position_id,
    'org_unit_id', org_unit_id, 'salary_grade_id', salary_grade_id, 'p3_band_id', p3_band_id,
    'effective_from', effective_from, 'effective_to', effective_to, 'status', status, 'source', source,
    'review_status', review_status, 'review_note', review_note, 'metadata', metadata,
    'p1_amount', p1_amount, 'pctn_amount', pctn_amount, 'phone_allowance_amount', phone_allowance_amount,
    'p3_standard_amount', p3_standard_amount, 'vehicle_allowance_amount', vehicle_allowance_amount,
    'seniority_allowance_amount', seniority_allowance_amount, 'roster_batch_id', roster_batch_id,
    'created_at', created_at, 'updated_at', updated_at
  ) order by effective_from desc) from public.hrm_employee_compensation_assignments), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_hrm_manual_allowances()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
  if not app_private.has_hrm_view_permission(public.current_app_user_id(),'hrm.compensation.view') then raise exception using errcode='42501',message='HRM_COMPENSATION_VIEW_REQUIRED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'employee_id',employee_id,'component_id',component_id,'amount',amount,'status',status,
    'effective_from',effective_from,'effective_to',effective_to,'note',note,'source',source,
    'created_at',created_at,'updated_at',updated_at
  ) order by effective_from desc) from public.hrm_employee_manual_allowances),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.list_hrm_payroll_components()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ begin
  if not app_private.has_hrm_view_permission(public.current_app_user_id(),'hrm.compensation.view') then raise exception using errcode='42501',message='HRM_COMPENSATION_VIEW_REQUIRED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'plan_id',plan_id,'code',code,'name',name,'component_type',component_type,
    'formula_key',formula_key,'sort_order',sort_order,'is_active',is_active,'is_recurring',is_recurring,
    'source',source,'metadata',metadata,'created_at',created_at,'updated_at',updated_at
  ) order by sort_order,code) from public.hrm_payroll_components),'[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.list_hrm_documents(p_doc_type text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_employee_id text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.has_hrm_view_permission(public.current_app_user_id(), 'hrm.document.view') then
    raise exception using errcode = '42501', message = 'HRM_DOCUMENT_VIEW_REQUIRED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', document.id, 'doc_type', document.doc_type, 'doc_category', document.doc_category,
    'employee_id', document.employee_id, 'title', document.title, 'doc_number', document.doc_number,
    'description', document.description, 'sender', document.sender, 'receiver', document.receiver,
    'signed_by', document.signed_by, 'assigned_to', document.assigned_to,
    'doc_date', document.doc_date, 'deadline', document.deadline, 'status', document.status,
    'file_name', document.file_name, 'file_type', document.file_type, 'file_size', document.file_size,
    'storage_path', document.storage_path, 'tags', document.tags, 'uploaded_by', document.uploaded_by,
    'created_at', document.created_at, 'updated_at', document.updated_at
  ) order by document.created_at desc)
  from (select * from public.hrm_documents source
    where (p_doc_type is null or source.doc_type = p_doc_type)
      and (p_category is null or p_category = 'all' or source.doc_category = p_category)
      and (p_employee_id is null or source.employee_id = p_employee_id)
      and (nullif(trim(p_search), '') is null
        or source.title ilike '%'||trim(p_search)||'%'
        or coalesce(source.doc_number,'') ilike '%'||trim(p_search)||'%')
    order by source.created_at desc limit least(greatest(p_limit,1),500)
  ) document), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_hrm_employee_directory()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_can_view_all_c2 boolean;
begin
  if not app_private.has_governed_hrm_permission(v_actor_id, 'hrm.employee.view_directory') then
    raise exception using errcode = '42501', message = 'HRM_EMPLOYEE_DIRECTORY_REQUIRED';
  end if;
  v_can_view_all_c2 := app_private.has_hrm_view_permission(v_actor_id, 'hrm.employee.view_profile');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', employee.id, 'employee_code', employee.employee_code,
      'full_name', employee.full_name, 'title', employee.title,
      'phone', employee.phone, 'email', employee.email,
      'gender', case when v_can_view_all_c2 or employee.user_id = v_actor_id then employee.gender else null end,
      'date_of_birth', case when v_can_view_all_c2 or employee.user_id = v_actor_id then employee.date_of_birth else null end,
      'marital_status', case when v_can_view_all_c2 or employee.user_id = v_actor_id then employee.marital_status else null end,
      'start_date', employee.start_date, 'official_date', employee.official_date,
      'status', employee.status, 'user_id', employee.user_id,
      'exit_date', case when employee.status = 'Đã nghỉ việc' then (
        select max(event.event_date) from public.hrm_employee_employment_events event
        where event.employee_id = employee.id and event.event_type_code = 'NGHI_VIEC' and event.status = 'ACTIVE'
      ) end,
      'area_id', employee.area_id, 'office_id', employee.office_id,
      'employee_type_id', employee.employee_type_id, 'position_id', employee.position_id,
      'salary_policy_id', case when v_can_view_all_c2 then employee.salary_policy_id else null end,
      'work_schedule_id', employee.work_schedule_id,
      'construction_site_id', employee.construction_site_id,
      'department_id', employee.department_id, 'factory_id', employee.factory_id,
      'org_unit_id', employee.org_unit_id, 'avatar_url', employee.avatar_url,
      'created_at', employee.created_at, 'updated_at', employee.updated_at
    ) order by employee.employee_code, employee.full_name)
    from public.employees employee
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_hrm_leave_balances(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.current_user_has_hrm_view_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'Chỉ HR xem được số phép toàn công ty.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'employeeId', employee.id, 'employeeCode', employee.employee_code, 'fullName', employee.full_name,
      'orgUnitName', org.name, 'officialDate', employee.official_date,
      'balance', app_private.hrm_leave_balance_json(balance)
    ) order by (balance.id is null) desc, org.name nulls first, employee.full_name)
    from public.employees employee
    left join public.org_units org on org.id = employee.org_unit_id
    left join public.hrm_leave_balances balance on balance."employeeId" = employee.id and balance.year = p_year
    where employee.status = 'Đang làm việc'
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_hrm_leave_ledger(p_employee_id uuid, p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_balance public.hrm_leave_balances%rowtype;
begin
  if not (app_private.hrm_employee_is_current_user(p_employee_id::text)
          or app_private.current_user_has_hrm_view_permission('hrm.employee.view_sensitive')) then
    raise exception using errcode = '42501', message = 'Chỉ xem được sổ phép của chính mình.';
  end if;
  select * into v_balance from public.hrm_leave_balances where "employeeId" = p_employee_id and year = p_year;
  return jsonb_build_object(
    'balance', app_private.hrm_leave_balance_json(v_balance),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ledger.id, 'kind', ledger.kind, 'days', ledger.days, 'carryDays', ledger.carry_days,
        'balanceAfter', ledger.balance_after, 'note', ledger.note, 'createdAt', ledger.created_at,
        'leaveRequestId', ledger.leave_request_id,
        'leaveCode', request.code, 'leaveStart', request."startDate", 'leaveEnd', request."endDate",
        'actorName', (select coalesce(nullif(u.name, ''), u.email) from public.users u where u.id = ledger.actor_user_id)
      ) order by ledger.created_at desc, ledger.id)
      from public.hrm_leave_ledger ledger
      left join public.hrm_leave_requests request on request.id = ledger.leave_request_id
      where ledger.employee_id = p_employee_id and ledger.year = p_year
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_hrm_manager_scope_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app_private.current_user_has_hrm_view_permission('hrm.staffing.view') then
    raise exception using errcode = '42501', message = 'HRM_STAFFING_VIEW_REQUIRED';
  end if;
  return app_private.get_hrm_manager_scope_readiness();
end;
$function$;

-- 6. Hồ sơ nhân sự: mức truy cập HR_VIEWER — xem mọi nhóm thông tin như HR, không nhóm nào sửa được.
-- Lệnh ghi hồ sơ (can_edit_hrm_c2, sửa liên hệ / địa chỉ, đặt quản lý) vẫn chỉ nhận SELF / HR / HR_MANAGE.

CREATE OR REPLACE FUNCTION app_private.hrm_employee_profile_access_level(p_employee_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_subject_user_id uuid;
begin
  if v_actor_id is null then return 'NONE'; end if;
  select employee.user_id into v_subject_user_id
  from public.employees employee where employee.id = p_employee_id;
  if not found then return 'NONE'; end if;

  if app_private.has_hrm_template_permission(v_actor_id, 'hrm.employee.view_sensitive') then
    return case
      when app_private.has_hrm_template_permission(v_actor_id, 'hrm.compensation.manage')
      then 'HR_MANAGE' else 'HR' end;
  end if;
  if v_subject_user_id = v_actor_id then return 'SELF'; end if;
  if app_private.has_hrm_view_permission(v_actor_id, 'hrm.employee.view_sensitive') then
    return 'HR_VIEWER';
  end if;
  if v_subject_user_id is not null
    and app_private.resolve_strict_direct_manager(v_subject_user_id) = v_actor_id
  then return 'MANAGER'; end if;
  if app_private.has_governed_hrm_permission(v_actor_id, 'hrm.employee.view_directory') then
    return 'DIRECTORY';
  end if;
  return 'NONE';
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_overview(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['DIRECTORY','SELF','MANAGER','HR','HR_MANAGE','HR_VIEWER']
  );
  v_result jsonb;
  v_visible text[];
begin
  v_visible := case
    when v_level in ('HR','HR_MANAGE','HR_VIEWER') then array[
      'overview','personal_contact','work_organization','attendance_leave',
      'contracts_employment','legal_insurance','compensation_tax_bank',
      'qualifications_documents'
    ]
    when v_level = 'SELF' then array[
      'overview','personal_contact','work_organization','attendance_leave',
      'contracts_employment','legal_insurance','qualifications_documents'
    ]
    when v_level = 'MANAGER' then array[
      'overview','personal_contact','work_organization','attendance_leave',
      'qualifications_documents'
    ]
    else array['overview','work_organization']
  end;

  select jsonb_build_object(
    'employeeId', employee.id,
    'employeeCode', employee.employee_code,
    'fullName', employee.full_name,
    'title', employee.title,
    'status', employee.status,
    'avatarUrl', employee.avatar_url,
    'accessLevel', v_level,
    'visibleSections', to_jsonb(v_visible),
    'maskedFields', case
      when v_level = 'DIRECTORY' then '["dateOfBirth","privateContact","legal","compensation"]'::jsonb
      when v_level = 'MANAGER' then '["privateAddress","emergencyContact","legal","compensation"]'::jsonb
      when v_level = 'SELF' then '["compensation"]'::jsonb
      else '[]'::jsonb
    end,
    'canEditSections', case
      when v_level = 'HR_MANAGE' then '["personal_contact","contracts_employment","legal_insurance","compensation_tax_bank","qualifications_documents"]'::jsonb
      when v_level = 'HR' then '["personal_contact","contracts_employment","legal_insurance","qualifications_documents"]'::jsonb
      when v_level = 'SELF' then '["personal_contact"]'::jsonb
      else '[]'::jsonb
    end,
    'summary', jsonb_build_object(
      'startDate', employee.start_date,
      'officialDate', employee.official_date,
      'orgUnitName', org.name,
      'positionName', position.name,
      'qualificationCount', case when v_level <> 'DIRECTORY' then (
        select count(*) from public.hrm_employee_qualifications qualification
        where qualification.employee_id = employee.id and qualification.status = 'ACTIVE'
      ) else null end,
      'currentContractNumber', case when v_level in ('HR','HR_MANAGE','HR_VIEWER') then (
        select contract.contract_number from public.hrm_labor_contracts contract
        where contract.employee_id = employee.id and contract.status = 'active'
          and contract.effective_from <= current_date
          and (contract.effective_to is null or contract.effective_to >= current_date)
        order by contract.effective_from desc limit 1
      ) else null end
    )
  ) into v_result
  from public.employees employee
  left join public.org_units org on org.id = employee.org_unit_id
  left join public.hrm_positions position on position.id = employee.position_id
  where employee.id = p_employee_id;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_personal_contact(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['SELF','MANAGER','HR','HR_MANAGE','HR_VIEWER']
  );
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', employee.id,
    'gender', employee.gender,
    'dateOfBirth', case when v_level = 'MANAGER' then null else employee.date_of_birth end,
    'maritalStatus', case when v_level = 'MANAGER' then null else employee.marital_status end,
    'workPhone', employee.phone,
    'workEmail', employee.email,
    'personal', case when v_level = 'MANAGER' then null else jsonb_build_object(
      'personalPhone', private_profile.personal_phone,
      'personalEmail', private_profile.personal_email,
      'nationalityCode', private_profile.nationality_code,
      'placeOfBirth', private_profile.place_of_birth,
      'hometown', private_profile.hometown
    ) end,
    'addresses', case when v_level = 'MANAGER' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'recordCode', address.record_code, 'addressType', address.address_type,
        'addressLine', address.address_line, 'wardName', address.ward_name,
        'provinceCode', address.province_code
      ) order by array_position(array['PERMANENT','CURRENT','CONTACT'], address.address_type), address.record_code)
      from public.hrm_employee_addresses address
      where address.employee_id = employee.id and address.status = 'ACTIVE'
        and address.effective_from <= current_date
        and (address.effective_to is null or address.effective_to >= current_date)
    ), '[]'::jsonb) end,
    'emergencyContacts', case when v_level = 'MANAGER' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'recordCode', contact.record_code, 'fullName', contact.full_name,
        'relationshipCode', contact.relationship_code, 'phone', contact.phone,
        'email', contact.email, 'address', contact.address, 'isPrimary', contact.is_primary
      ) order by contact.is_primary desc, contact.record_code)
      from public.hrm_employee_emergency_contacts contact
      where contact.employee_id = employee.id and contact.status = 'ACTIVE'
    ), '[]'::jsonb) end,
    'maskedFields', case when v_level = 'MANAGER'
      then '["dateOfBirth","maritalStatus","personal","addresses","emergencyContacts"]'::jsonb
      else '[]'::jsonb end
  ) into v_result
  from public.employees employee
  left join public.hrm_employee_private_profiles private_profile
    on private_profile.employee_id = employee.id and private_profile.status = 'ACTIVE'
  where employee.id = p_employee_id;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_work_organization(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['DIRECTORY','SELF','MANAGER','HR','HR_MANAGE','HR_VIEWER']
  );
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', employee.id, 'employeeCode', employee.employee_code,
    'title', employee.title, 'status', employee.status,
    'startDate', employee.start_date, 'officialDate', employee.official_date,
    'orgUnit', jsonb_build_object('id', org.id, 'code', org.code, 'name', org.name),
    'position', jsonb_build_object('id', position.id, 'code', position.code, 'name', position.name, 'levelCode', position.level_code),
    'primaryAssignment', case when assignment.id is null then null else jsonb_build_object(
      'assignmentId', assignment.id, 'slotId', slot.id,
      'effectiveFrom', assignment.effective_from, 'assignmentType', assignment.assignment_type
    ) end,
    'directManager', case when manager_employee.id is null then null else jsonb_build_object(
      'employeeId', manager_employee.id, 'employeeCode', manager_employee.employee_code,
      'fullName', manager_employee.full_name, 'title', manager_employee.title
    ) end
  ) into v_result
  from public.employees employee
  left join public.org_units org on org.id = employee.org_unit_id
  left join public.hrm_positions position on position.id = employee.position_id
  left join public.hrm_employee_slot_assignments assignment
    on assignment.employee_id = employee.id and assignment.assignment_type = 'PRIMARY'
   and assignment.status = 'ACTIVE' and assignment.effective_from <= current_date
   and (assignment.effective_to is null or assignment.effective_to >= current_date)
  left join public.hrm_org_position_slots slot on slot.id = assignment.slot_id
  left join public.users manager_user
    on manager_user.id = app_private.resolve_slot_direct_manager(employee.user_id)
  left join public.employees manager_employee on manager_employee.user_id = manager_user.id
  where employee.id = p_employee_id;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_attendance_leave(p_employee_id uuid, p_year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer, p_month integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['SELF','MANAGER','HR','HR_MANAGE','HR_VIEWER']
  );
  v_result jsonb;
begin
  if p_month not between 1 and 12 or p_year not between 2000 and 2200 then
    raise exception using errcode = '22023', message = 'HRM_ATTENDANCE_PERIOD_INVALID';
  end if;
  select jsonb_build_object(
    'employeeId', p_employee_id, 'year', p_year, 'month', p_month,
    'attendance', coalesce((select jsonb_agg(jsonb_build_object(
      'id', attendance.id, 'date', attendance.date, 'status', attendance.status,
      'checkIn', attendance."checkIn", 'checkOut', attendance."checkOut",
      'overtimeHours', attendance."overtimeHours", 'approvalStatus', attendance."approvalStatus"
    ) order by attendance.date)
      from public.hrm_attendance attendance
      where attendance."employeeId" = p_employee_id
        and substring(attendance.date from 1 for 7) = format('%s-%s', p_year, lpad(p_month::text, 2, '0'))
    ), '[]'::jsonb),
    'leaveBalance', (select jsonb_build_object(
      'year', balance.year, 'accruedDays', balance."accruedDays",
      'usedPaidDays', balance."usedPaidDays", 'usedUnpaidDays', balance."usedUnpaidDays",
      'remainingDays', balance."accruedDays" - balance."usedPaidDays"
    ) from public.hrm_leave_balances balance
      where balance."employeeId" = p_employee_id and balance.year = p_year limit 1),
    'leaveRequests', coalesce((select jsonb_agg(jsonb_build_object(
      'id', request.id, 'code', request.code, 'type', request.type,
      'startDate', request."startDate", 'endDate', request."endDate",
      'totalDays', request."totalDays", 'status', request.status
    ) order by request."startDate" desc)
      from public.hrm_leave_requests request
      where request."employeeId" = p_employee_id
        and substring(request."startDate" from 1 for 4) = p_year::text
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_contract_employment(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['SELF','HR','HR_MANAGE','HR_VIEWER']);
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', p_employee_id,
    'contracts', coalesce((select jsonb_agg(jsonb_build_object(
      'id', contract.id, 'contractNumber', contract.contract_number,
      'type', contract.type, 'status', contract.status,
      'effectiveFrom', contract.effective_from, 'effectiveTo', contract.effective_to,
      'signedBy', contract.signed_by, 'note', contract.note
    ) order by contract.effective_from desc)
      from public.hrm_labor_contracts contract where contract.employee_id = p_employee_id
    ), '[]'::jsonb),
    'employmentEvents', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', event.record_code, 'eventTypeCode', event.event_type_code,
      'eventDate', event.event_date, 'titleSnapshot', event.title_snapshot,
      'reason', event.reason, 'sourceReference', event.source_reference,
      'orgUnitName', org.name, 'positionName', position.name
    ) order by event.event_date desc, event.record_code)
      from public.hrm_employee_employment_events event
      left join public.org_units org on org.id = event.org_unit_id
      left join public.hrm_positions position on position.id = event.position_id
      where event.employee_id = p_employee_id and event.status = 'ACTIVE'
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_legal_insurance(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['SELF','HR','HR_MANAGE','HR_VIEWER']);
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', p_employee_id,
    'identityDocuments', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', identity_doc.record_code, 'documentTypeCode', identity_doc.document_type_code,
      'documentNumber', identity_doc.document_number, 'issuedDate', identity_doc.issued_date,
      'issuedPlace', identity_doc.issued_place, 'expiryDate', identity_doc.expiry_date,
      'isPrimary', identity_doc.is_primary, 'status', identity_doc.status
    ) order by identity_doc.is_primary desc, identity_doc.record_code)
      from public.hrm_employee_identity_documents identity_doc
      where identity_doc.employee_id = p_employee_id and identity_doc.status <> 'INACTIVE'
    ), '[]'::jsonb),
    'insuranceProfile', (select jsonb_build_object(
      'socialInsuranceNumber', insurance.social_insurance_number,
      'healthInsuranceNumber', insurance.health_insurance_number,
      'registeredClinicCode', insurance.registered_clinic_code,
      'participationStatusCode', insurance.participation_status_code,
      'effectiveFrom', insurance.effective_from, 'effectiveTo', insurance.effective_to,
      'status', insurance.status
    ) from public.hrm_employee_insurance_profiles insurance
      where insurance.employee_id = p_employee_id),
    'dependents', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', dependent.record_code, 'fullName', dependent.full_name,
      'relationshipCode', dependent.relationship_code, 'dateOfBirth', dependent.date_of_birth,
      'taxCode', dependent.tax_code, 'deductionFrom', dependent.deduction_from,
      'deductionTo', dependent.deduction_to, 'status', dependent.status
    ) order by dependent.full_name)
      from public.hrm_employee_dependents dependent
      where dependent.employee_id = p_employee_id and dependent.status = 'ACTIVE'
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_qualifications_documents(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(
    p_employee_id, array['SELF','MANAGER','HR','HR_MANAGE','HR_VIEWER']
  );
  v_result jsonb;
begin
  select jsonb_build_object(
    'employeeId', p_employee_id,
    'qualifications', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', qualification.record_code,
      'educationLevelCode', qualification.education_level_code,
      'institutionName', qualification.institution_name, 'majorName', qualification.major_name,
      'degreeName', qualification.degree_name, 'graduationYear', qualification.graduation_year,
      'startDate', qualification.start_date, 'endDate', qualification.end_date
    ) order by qualification.graduation_year desc nulls last, qualification.record_code)
      from public.hrm_employee_qualifications qualification
      where qualification.employee_id = p_employee_id and qualification.status = 'ACTIVE'
    ), '[]'::jsonb),
    'certifications', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', certification.record_code,
      'certificationTypeCode', certification.certification_type_code,
      'certificationName', certification.certification_name,
      'certificateNumber', certification.certificate_number,
      'issuerName', certification.issuer_name, 'issuedDate', certification.issued_date,
      'expiryDate', certification.expiry_date, 'status', certification.status
    ) order by certification.issued_date desc nulls last, certification.record_code)
      from public.hrm_employee_certifications certification
      where certification.employee_id = p_employee_id and certification.status <> 'INACTIVE'
    ), '[]'::jsonb),
    'documents', case when v_level in ('HR','HR_MANAGE','HR_VIEWER') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', document.id, 'docType', document.doc_type,
        'docCategory', document.doc_category, 'title', document.title,
        'docNumber', document.doc_number, 'docDate', document.doc_date,
        'deadline', document.deadline, 'status', document.status,
        'fileName', document.file_name, 'fileType', document.file_type,
        'fileSize', document.file_size
      ) order by document.created_at desc)
      from public.hrm_documents document
      where document.employee_id = p_employee_id::text
    ), '[]'::jsonb) else '[]'::jsonb end,
    'maskedFields', case when v_level in ('SELF','MANAGER')
      then '["documents"]'::jsonb else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_hrm_employee_compensation_tax_bank(p_employee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_level text := app_private.assert_hrm_profile_section_access(p_employee_id, array['HR','HR_MANAGE','HR_VIEWER']);
  v_result jsonb;
begin
  if not app_private.has_hrm_view_permission(public.current_app_user_id(), 'hrm.compensation.view') then
    raise exception using errcode = '42501', message = 'HRM_COMPENSATION_VIEW_REQUIRED';
  end if;
  select jsonb_build_object(
    'employeeId', p_employee_id,
    'taxProfile', (select jsonb_build_object(
      'taxCode', tax.tax_code, 'taxResidencyCode', tax.tax_residency_code,
      'registrationDate', tax.registration_date, 'status', tax.status
    ) from public.hrm_employee_tax_profiles tax where tax.employee_id = p_employee_id),
    'bankAccounts', coalesce((select jsonb_agg(jsonb_build_object(
      'recordCode', bank.record_code, 'bankCode', bank.bank_code,
      'branchName', bank.branch_name, 'accountNumber', bank.account_number,
      'accountHolder', bank.account_holder, 'isPayrollAccount', bank.is_payroll_account,
      'status', bank.status
    ) order by bank.is_payroll_account desc, bank.record_code)
      from public.hrm_employee_bank_accounts bank
      where bank.employee_id = p_employee_id and bank.status = 'ACTIVE'
    ), '[]'::jsonb),
    'salaryHistory', coalesce((select jsonb_agg(jsonb_build_object(
      'id', salary.id, 'effectiveFrom', salary.effective_from,
      'effectiveTo', salary.effective_to, 'previousSalary', salary.previous_salary,
      'newSalary', salary.new_salary, 'previousAllowance', salary.previous_allowance,
      'newAllowance', salary.new_allowance, 'reason', salary.reason, 'status', salary.status
    ) order by salary.effective_from desc)
      from public.hrm_salary_history salary
      where salary.employee_id = p_employee_id and salary.status <> 'VOID'
    ), '[]'::jsonb),
    'recentPayrolls', coalesce((select jsonb_agg(payroll_row.payload order by payroll_row.year desc, payroll_row.month desc)
      from (select payroll.year, payroll.month, jsonb_build_object(
        'id', payroll.id, 'month', payroll.month, 'year', payroll.year,
        'grossSalary', payroll."grossSalary", 'netSalary', payroll."netSalary",
        'status', payroll.status, 'paidDate', payroll."paidDate"
      ) payload from public.hrm_payrolls payroll
      where payroll."employeeId" = p_employee_id
      order by payroll.year desc, payroll.month desc limit 12) payroll_row
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

-- 7. Ảnh quyền của chính người dùng và màn quản trị quyền thấy được các quyền xem của HR_VIEWER.

CREATE OR REPLACE FUNCTION app_private.resolve_authorization_snapshot(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.users%rowtype;
  v_flags jsonb := '{}'::jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_room_actions jsonb := '[]'::jsonb;
begin
  select user_row.*
    into v_actor
  from public.users user_row
  where user_row.id = p_user_id
    and user_row.is_active
    and user_row.account_status = 'ACTIVE';

  if v_actor.id is null then
    raise exception 'Active application account required'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_object_agg(setting_row.key, setting_row.value), '{}'::jsonb)
    into v_flags
  from app_private.permission_hardening_settings setting_row;

  with source_rows as (
    select source_row.*
    from app_private.resolve_effective_permission_sources(
      p_user_id,
      null,
      null,
      null,
      now()
    ) source_row
    where not (
        source_row.permission_code like 'hrm.%'
        and source_row.source_type = 'LEGACY'
      )
      and (
        not app_private.is_hrm_template_only_permission(source_row.permission_code)
        or (
          source_row.source_type = 'ROLE'
          and source_row.source_code in ('HR', 'HR_MANAGE')
        )
        or (
          source_row.source_type = 'ROLE'
          and source_row.source_code = 'HR_VIEWER'
          and app_private.is_hrm_viewer_permission(source_row.permission_code)
        )
      )
    union all
    select manager_source.*
    from app_private.resolve_manager_derived_permission_sources(p_user_id) manager_source
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'permissionCode', source_row.permission_code,
    'sourceType', source_row.source_type,
    'sourceId', source_row.source_id,
    'sourceCode', source_row.source_code,
    'sourceLabel', source_row.source_label,
    'scopeType', source_row.scope_type,
    'scopeId', source_row.scope_id,
    'startsAt', source_row.starts_at,
    'expiresAt', source_row.expires_at,
    'riskLevel', source_row.risk_level,
    'isBusinessApproval', source_row.is_business_approval,
    'metadata', coalesce(source_row.metadata, '{}'::jsonb)
  ) order by
    source_row.permission_code,
    source_row.scope_type,
    source_row.scope_id,
    source_row.source_type,
    source_row.source_id), '[]'::jsonb)
    into v_sources
  from source_rows source_row;

  with candidate_scopes as (
    select distinct
      staff_row.project_id,
      staff_row.construction_site_id
    from public.project_staff staff_row
    where staff_row.user_id = p_user_id::text
      and staff_row.end_date is null
      and staff_row.project_id is not null

    union

    select distinct
      member_row.project_id,
      member_row.construction_site_id
    from public.project_permission_room_members member_row
    join public.project_staff staff_row on staff_row.id = member_row.project_staff_id
    where staff_row.user_id = p_user_id::text
      and staff_row.end_date is null
      and member_row.is_active

    union

    select project_row.id, project_row.construction_site_id::text
    from public.projects project_row
    where v_actor.role = 'ADMIN'

    union

    select project_row.id, null::text
    from public.projects project_row
    where v_actor.role = 'ADMIN'
  ), room_rows as (
    select
      scope_row.project_id,
      scope_row.construction_site_id,
      binding.room_code,
      binding.action_code,
      case
        when v_actor.role = 'ADMIN' then 'admin'
        when binding.enforcement_status in ('pilot', 'enforced')
          and app_private.project_user_has_room_action(
            p_user_id,
            scope_row.project_id,
            scope_row.construction_site_id,
            binding.room_code,
            binding.action_code
          ) then 'room'
        else 'pbac_fallback'
      end as authorization_source,
      binding.enforcement_status,
      binding.pbac_fallback_enabled
    from candidate_scopes scope_row
    cross join app_private.project_permission_room_action_bindings binding
    where app_private.project_actor_has_effective_room_action(
      p_user_id,
      scope_row.project_id,
      scope_row.construction_site_id,
      binding.room_code,
      binding.action_code
    )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'projectId', room_row.project_id,
    'constructionSiteId', room_row.construction_site_id,
    'roomCode', room_row.room_code,
    'actionCode', room_row.action_code,
    'source', room_row.authorization_source,
    'enforcement', room_row.enforcement_status,
    'fallback', room_row.pbac_fallback_enabled
  ) order by
    room_row.project_id,
    room_row.construction_site_id nulls first,
    room_row.room_code,
    room_row.action_code), '[]'::jsonb)
    into v_room_actions
  from room_rows room_row;

  return jsonb_build_object(
    'generatedAt', now(),
    'flags', v_flags,
    'sources', v_sources,
    'roomActions', v_room_actions
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.get_effective_permission_sources_authorized(p_target_user_id uuid DEFAULT current_app_user_id())
 RETURNS TABLE(permission_code text, source_type text, source_id text, source_code text, source_label text, scope_type text, scope_id text, starts_at timestamp with time zone, expires_at timestamp with time zone, risk_level text, is_business_approval boolean, metadata jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if v_actor_user_id is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;

  if p_target_user_id <> v_actor_user_id
    and not app_private.has_any_permission(
      v_actor_user_id,
      array[
        'system.authorization.view',
        'system.authorization.audit',
        'system.authorization.manage_roles',
        'system.authorization.manage_grants'
      ],
      'global',
      '*'
    )
  then
    raise exception 'Not allowed to view authorization sources' using errcode = '42501';
  end if;

  return query
  select source_row.*
  from app_private.resolve_effective_permission_sources(
    p_target_user_id,
    null,
    null,
    null,
    now()
  ) source_row
  where not (
      source_row.permission_code like 'hrm.%'
      and source_row.source_type = 'LEGACY'
    )
    and (
      not app_private.is_hrm_template_only_permission(source_row.permission_code)
      or (
        source_row.source_type = 'ROLE'
        and source_row.source_code in ('HR', 'HR_MANAGE')
      )
      or (
        source_row.source_type = 'ROLE'
        and source_row.source_code = 'HR_VIEWER'
        and app_private.is_hrm_viewer_permission(source_row.permission_code)
      )
    );

  return query
  select manager_source.*
  from app_private.resolve_manager_derived_permission_sources(p_target_user_id) manager_source;
end;
$function$;

-- 8. Kênh gán vai trò HR (Người dùng → Vai trò đặc biệt): thêm HR_VIEWER, vẫn một vai trò HR mỗi lúc.

CREATE OR REPLACE FUNCTION app_private.hrm_authorization_fingerprint(p_target_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select md5(coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'assignmentId', assignment_row.id,
        'roleCode', template.code,
        'templateVersion', template.version,
        'scopeType', assignment_row.scope_type,
        'scopeId', assignment_row.scope_id,
        'startsAt', assignment_row.starts_at,
        'expiresAt', assignment_row.expires_at,
        'updatedAt', assignment_row.updated_at
      )
      order by template.code, assignment_row.id
    )::text
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates template
      on template.id = assignment_row.role_template_id
     and template.code in ('HR', 'HR_MANAGE', 'HR_VIEWER')
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.status = 'ACTIVE'
      and assignment_row.starts_at <= now()
      and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  ), '[]'));
$function$;

CREATE OR REPLACE FUNCTION app_private.get_user_hr_authorization_impl(p_target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_target public.users%rowtype;
  v_employee_id uuid;
  v_employee_code text;
  v_assignment_id uuid;
  v_hr_role text;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
  v_direct_report_count integer := 0;
  v_effective_permissions jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
begin
  if v_actor_user_id is null
    or (
      v_actor_user_id is distinct from p_target_user_id
      and not app_private.has_any_permission(
        v_actor_user_id,
        array[
          'system.authorization.view',
          'system.authorization.audit',
          'system.authorization.manage_roles',
          'system.authorization.manage_grants'
        ],
        'global',
        '*'
      )
    )
  then
    raise exception 'Not allowed to view HR authorization'
      using errcode = '42501';
  end if;

  select * into v_target
  from public.users target_row
  where target_row.id = p_target_user_id;

  if v_target.id is null then
    raise exception 'Target user does not exist'
      using errcode = 'P0002';
  end if;

  select employee.id, employee.employee_code
  into v_employee_id, v_employee_code
  from public.employees employee
  where employee.user_id = p_target_user_id
  order by employee.created_at
  limit 1;

  select assignment_row.id, template.code, assignment_row.starts_at, assignment_row.expires_at
  into v_assignment_id, v_hr_role, v_starts_at, v_expires_at
  from public.principal_role_assignments assignment_row
  join public.role_permission_templates template
    on template.id = assignment_row.role_template_id
   and template.code in ('HR', 'HR_MANAGE', 'HR_VIEWER')
  where assignment_row.principal_type = 'user'
    and assignment_row.principal_id = p_target_user_id
    and assignment_row.status = 'ACTIVE'
    and assignment_row.starts_at <= now()
    and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  order by case template.code when 'HR_MANAGE' then 0 when 'HR' then 1 else 2 end,
           assignment_row.created_at desc
  limit 1;

  select count(*)::integer into v_direct_report_count
  from public.employees report
  where report.user_id is not null
    and report.user_id is distinct from p_target_user_id
    and report.status = 'Đang làm việc'
    and app_private.resolve_slot_direct_manager(report.user_id) = p_target_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'permissionCode', source_row.permission_code,
    'sourceType', source_row.source_type,
    'sourceId', source_row.source_id,
    'sourceCode', source_row.source_code,
    'sourceLabel', source_row.source_label,
    'scopeType', source_row.scope_type,
    'scopeId', source_row.scope_id,
    'startsAt', source_row.starts_at,
    'expiresAt', source_row.expires_at,
    'riskLevel', source_row.risk_level,
    'isBusinessApproval', source_row.is_business_approval,
    'metadata', source_row.metadata
  ) order by source_row.permission_code, source_row.scope_type, source_row.scope_id), '[]'::jsonb)
  into v_effective_permissions
  from app_private.resolve_effective_permission_sources(
    p_target_user_id, null, null, null, now()
  ) source_row
  where source_row.permission_code like 'hrm.%'
    and not (source_row.source_type = 'LEGACY')
    and (
      source_row.permission_code <> all(array[
        'hrm.organization.manage',
        'hrm.staffing.manage', 'hrm.staffing.assign', 'hrm.staffing.set_manager',
        'hrm.employee.view_sensitive', 'hrm.employee.edit_sensitive',
        'hrm.employee.import', 'hrm.employee.export',
        'hrm.contract.view', 'hrm.contract.manage',
        'hrm.document.view', 'hrm.document.manage',
        'hrm.compensation.view', 'hrm.compensation.manage',
        'hrm.payroll.manage', 'hrm.payroll.export',
        'hrm.master_data.manage'
      ]::text[])
      or (
        source_row.source_type = 'ROLE'
        and source_row.source_code in ('HR', 'HR_MANAGE')
      )
      or (
        source_row.source_type = 'ROLE'
        and source_row.source_code = 'HR_VIEWER'
        and app_private.is_hrm_viewer_permission(source_row.permission_code)
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history_row.id,
    'eventType', history_row.event_type,
    'actorUserId', history_row.actor_user_id,
    'actorName', history_row.actor_name,
    'createdAt', history_row.created_at,
    'metadata', history_row.metadata
  ) order by history_row.created_at desc), '[]'::jsonb)
  into v_history
  from (
    select event_row.id, event_row.event_type, event_row.actor_user_id,
           actor_row.name as actor_name, event_row.created_at, event_row.metadata
    from public.permission_audit_events event_row
    left join public.users actor_row on actor_row.id = event_row.actor_user_id
    where event_row.target_user_id = p_target_user_id
      and (
        event_row.event_type like 'hr_business_role_%'
        or event_row.event_type in ('business_role_assigned', 'business_role_revoked')
      )
    order by event_row.created_at desc
    limit 50
  ) history_row;

  return jsonb_build_object(
    'targetUserId', v_target.id,
    'systemRole', v_target.role,
    'employeeId', v_employee_id,
    'employeeCode', v_employee_code,
    'isDirectManager', v_direct_report_count > 0,
    'directReportCount', v_direct_report_count,
    'hrRole', v_hr_role,
    'assignmentId', v_assignment_id,
    'startsAt', v_starts_at,
    'expiresAt', v_expires_at,
    'fingerprint', app_private.hrm_authorization_fingerprint(p_target_user_id),
    'effectivePermissions', v_effective_permissions,
    'history', v_history
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.preview_user_hr_business_role_impl(p_target_user_id uuid, p_target_role_code text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_user_id uuid := app_private.assert_hrm_role_admin();
  v_target_role_code text := upper(btrim(coalesce(p_target_role_code, '')));
  v_current_role_code text;
  v_target_template_id uuid;
  v_decision jsonb := jsonb_build_object('hardDenies', '[]'::jsonb, 'warnings', '[]'::jsonb);
  v_added jsonb := '[]'::jsonb;
  v_removed jsonb := '[]'::jsonb;
begin
  if v_target_role_code not in ('NONE', 'HR', 'HR_MANAGE', 'HR_VIEWER') then
    raise exception 'Target HR role must be NONE, HR, HR_MANAGE or HR_VIEWER'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.users target_row
    where target_row.id = p_target_user_id
      and target_row.is_active
      and target_row.account_status = 'ACTIVE'
  ) then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'HR role expiry must be in the future'
      using errcode = '22023';
  end if;

  select template.code into v_current_role_code
  from public.principal_role_assignments assignment_row
  join public.role_permission_templates template
    on template.id = assignment_row.role_template_id
   and template.code in ('HR', 'HR_MANAGE', 'HR_VIEWER')
  where assignment_row.principal_type = 'user'
    and assignment_row.principal_id = p_target_user_id
    and assignment_row.status = 'ACTIVE'
    and assignment_row.starts_at <= now()
    and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  order by case template.code when 'HR_MANAGE' then 0 when 'HR' then 1 else 2 end
  limit 1;

  if v_actor_user_id = p_target_user_id and v_target_role_code = 'HR' then
    raise exception 'System Admin may self-assign only HR_MANAGE'
      using errcode = '42501';
  end if;

  if v_target_role_code <> 'NONE' then
    select template.id into v_target_template_id
    from public.role_permission_templates template
    where template.code = v_target_role_code
      and template.is_system
      and template.is_active;

    if v_target_template_id is null then
      raise exception 'Target HR role template is unavailable'
        using errcode = '23514';
    end if;
  end if;

  select coalesce(jsonb_agg(desired.permission_code order by desired.permission_code), '[]'::jsonb)
  into v_added
  from (
    select desired_item.permission_code
    from public.role_permission_template_items desired_item
    where desired_item.template_id = v_target_template_id
    except
    select current_item.permission_code
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates current_template
      on current_template.id = assignment_row.role_template_id
     and current_template.code in ('HR', 'HR_MANAGE', 'HR_VIEWER')
    join public.role_permission_template_items current_item
      on current_item.template_id = current_template.id
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.status = 'ACTIVE'
      and assignment_row.starts_at <= now()
      and (assignment_row.expires_at is null or assignment_row.expires_at > now())
  ) desired;

  select coalesce(jsonb_agg(current_permission.permission_code order by current_permission.permission_code), '[]'::jsonb)
  into v_removed
  from (
    select current_item.permission_code
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates current_template
      on current_template.id = assignment_row.role_template_id
     and current_template.code in ('HR', 'HR_MANAGE', 'HR_VIEWER')
    join public.role_permission_template_items current_item
      on current_item.template_id = current_template.id
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.status = 'ACTIVE'
      and assignment_row.starts_at <= now()
      and (assignment_row.expires_at is null or assignment_row.expires_at > now())
    except
    select desired_item.permission_code
    from public.role_permission_template_items desired_item
    where desired_item.template_id = v_target_template_id
  ) current_permission;

  if v_target_role_code <> 'NONE' and v_target_role_code is distinct from v_current_role_code then
    if v_actor_user_id = p_target_user_id and v_target_role_code = 'HR_MANAGE' then
      v_decision := jsonb_build_object(
        'hardDenies', '[]'::jsonb,
        'warnings', jsonb_build_array(jsonb_build_object(
          'ruleCode', 'HRM_ADMIN_SELF_GRANT',
          'message', 'System Admin đang tự mở toàn bộ dữ liệu HR nhạy cảm.',
          'scopeType', 'global',
          'scopeId', '*'
        ))
      );
    else
      v_decision := app_private.evaluate_business_role_assignment_impl(
        v_actor_user_id,
        p_target_user_id,
        v_target_template_id,
        'global',
        '*'
      );
    end if;
  end if;

  return jsonb_build_object(
    'targetRoleCode', v_target_role_code,
    'currentRoleCode', v_current_role_code,
    'fingerprint', app_private.hrm_authorization_fingerprint(p_target_user_id),
    'added', v_added,
    'removed', v_removed,
    'warnings', coalesce(v_decision -> 'warnings', '[]'::jsonb),
    'hardDenies', coalesce(v_decision -> 'hardDenies', '[]'::jsonb),
    'opensC3', v_target_role_code in ('HR', 'HR_MANAGE', 'HR_VIEWER'),
    'opensC4', v_target_role_code in ('HR', 'HR_MANAGE', 'HR_VIEWER'),
    'allowsC4Mutation', v_target_role_code = 'HR_MANAGE',
    'allowsSensitiveExport', v_target_role_code = 'HR_MANAGE',
    'expiresAt', p_expires_at
  );
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.set_user_hr_business_role_impl(p_target_user_id uuid, p_target_role_code text, p_expires_at timestamp with time zone, p_reason text, p_warning_acceptances jsonb, p_expected_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor_user_id uuid := app_private.assert_hrm_role_admin();
  v_target_role_code text := upper(btrim(coalesce(p_target_role_code, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_preview jsonb;
  v_assignment record;
  v_target_template_id uuid;
  v_assignment_id uuid;
begin
  if char_length(v_reason) < 10 then
    raise exception 'HR role change reason must contain at least 10 characters'
      using errcode = '22023';
  end if;

  perform 1
  from public.users target_row
  where target_row.id = p_target_user_id
    and target_row.is_active
    and target_row.account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  if app_private.hrm_authorization_fingerprint(p_target_user_id)
      is distinct from p_expected_fingerprint then
    raise exception 'HR authorization changed; reload preview before applying'
      using errcode = 'PT409';
  end if;

  v_preview := app_private.preview_user_hr_business_role_impl(
    p_target_user_id,
    v_target_role_code,
    p_expires_at
  );

  if jsonb_array_length(coalesce(v_preview -> 'hardDenies', '[]'::jsonb)) > 0 then
    raise exception 'HR role change violates a hard SoD rule'
      using errcode = '42501';
  end if;

  if v_actor_user_id = p_target_user_id
    and v_target_role_code = 'HR_MANAGE'
    and v_preview ->> 'currentRoleCode' is distinct from 'HR_MANAGE'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_warning_acceptances, '[]'::jsonb)) acceptance
      where acceptance ->> 'ruleCode' = 'HRM_ADMIN_SELF_GRANT'
        and coalesce((acceptance ->> 'accepted')::boolean, false)
    )
  then
    raise exception 'System Admin self-grant warning acceptance required'
      using errcode = '22023';
  end if;

  for v_assignment in
    select assignment_row.id
    from public.principal_role_assignments assignment_row
    join public.role_permission_templates template
      on template.id = assignment_row.role_template_id
     and template.code in ('HR', 'HR_MANAGE', 'HR_VIEWER')
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = p_target_user_id
      and assignment_row.status = 'ACTIVE'
    order by assignment_row.created_at
  loop
    perform app_private.revoke_business_role_assignment_impl(v_assignment.id, v_reason);
  end loop;

  if v_target_role_code <> 'NONE' then
    select template.id into v_target_template_id
    from public.role_permission_templates template
    where template.code = v_target_role_code
      and template.is_system
      and template.is_active;

    if v_actor_user_id = p_target_user_id then
      if v_target_role_code <> 'HR_MANAGE' then
        raise exception 'System Admin may self-assign only HR_MANAGE'
          using errcode = '42501';
      end if;

      v_assignment_id := gen_random_uuid();
      insert into public.principal_role_assignments (
        id, principal_type, principal_id, role_template_id, scope_type, scope_id,
        starts_at, expires_at, status, assigned_by, assigned_reason
      ) values (
        v_assignment_id, 'user', p_target_user_id, v_target_template_id,
        'global', '*', now(), p_expires_at, 'ACTIVE', v_actor_user_id, v_reason
      );

      insert into public.permission_audit_events (
        actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
      ) values (
        v_actor_user_id,
        p_target_user_id,
        'hr_business_role_self_granted',
        coalesce(v_preview -> 'removed', '[]'::jsonb),
        coalesce(v_preview -> 'added', '[]'::jsonb),
        jsonb_build_object(
          'assignmentId', v_assignment_id,
          'roleCode', v_target_role_code,
          'reason', v_reason,
          'warningAcceptances', coalesce(p_warning_acceptances, '[]'::jsonb)
        )
      );
    else
      v_assignment_id := app_private.assign_business_role_impl(
        p_target_user_id,
        v_target_template_id,
        'global',
        '*',
        now(),
        p_expires_at,
        v_reason,
        coalesce(p_warning_acceptances, '[]'::jsonb)
      );
    end if;
  elsif v_actor_user_id = p_target_user_id then
    insert into public.permission_audit_events (
      actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
    ) values (
      v_actor_user_id,
      p_target_user_id,
      'hr_business_role_self_revoked',
      coalesce(v_preview -> 'removed', '[]'::jsonb),
      '[]'::jsonb,
      jsonb_build_object('reason', v_reason)
    );
  end if;

  return app_private.get_user_hr_authorization_impl(p_target_user_id);
end;
$function$;

-- 9. Gán cho Ban lãnh đạo và Trưởng phòng TCKT (chủ SP chốt 23/10/2026), phạm vi toàn công ty, không hạn.
with target(email) as (
  values ('thinhdx@tienthinhjsc.vn'), ('mont@tienthinhjsc.vn'), ('chuanhd@tienthinhjsc.vn'), ('huongnt@tienthinhjsc.vn')
), inserted as (
  insert into public.principal_role_assignments (
    principal_type, principal_id, role_template_id, scope_type, scope_id, starts_at, status, assigned_reason
  )
  select 'user', user_row.id, template.id, 'global', '*', now(), 'ACTIVE', 'Đợt 2a-3 audit mẫu quyền 23/10/2026'
  from target
  join public.users user_row
    on lower(user_row.email) = target.email and user_row.is_active and user_row.account_status = 'ACTIVE'
  cross join public.role_permission_templates template
  where template.code = 'HR_VIEWER'
    and not exists (
      select 1 from public.principal_role_assignments existing
      where existing.principal_type = 'user' and existing.principal_id = user_row.id
        and existing.role_template_id = template.id and existing.status = 'ACTIVE'
    )
  returning id, principal_id, role_template_id
)
insert into public.permission_audit_events (
  actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata
)
select null, inserted.principal_id, 'business_role_assigned', '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'assignmentId', inserted.id, 'roleTemplateId', inserted.role_template_id,
    'scopeType', 'global', 'scopeId', '*'
  )),
  jsonb_build_object(
    'assignmentId', inserted.id, 'roleTemplateId', inserted.role_template_id,
    'reason', 'Đợt 2a-3 audit mẫu quyền 23/10/2026', 'source', 'migration 20261029110000'
  )
from inserted;
