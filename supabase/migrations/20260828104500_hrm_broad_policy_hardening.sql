begin;

create or replace function app_private.hrm_can_access_employee_subject(
  p_employee_id uuid,
  p_permission_code text,
  p_actor_user_id uuid default public.current_app_user_id()
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_subject_user_id uuid;
begin
  if p_actor_user_id is null or p_employee_id is null or p_permission_code not like 'hrm.%' then
    return false;
  end if;
  select employee.user_id into v_subject_user_id
  from public.employees employee where employee.id = p_employee_id;
  if v_subject_user_id is null then return false; end if;
  return app_private.has_governed_hrm_permission(p_actor_user_id, p_permission_code, 'global', '*')
    or (v_subject_user_id = p_actor_user_id
      and app_private.has_governed_hrm_permission(p_actor_user_id, p_permission_code, 'own', '*'))
    or (
      app_private.has_governed_hrm_permission(p_actor_user_id, p_permission_code, 'direct_reports', '*')
      and app_private.resolve_strict_direct_manager(v_subject_user_id) = p_actor_user_id
    );
end;
$$;

create or replace function app_private.hrm_can_access_leave_request(
  p_leave_request_id uuid,
  p_permission_code text,
  p_actor_user_id uuid default public.current_app_user_id()
)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select app_private.hrm_can_access_employee_subject(
      request_row."employeeId", p_permission_code, p_actor_user_id
    )
    from public.hrm_leave_requests request_row where request_row.id = p_leave_request_id
  ), false);
$$;

do $$
declare v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname like 'hrm\_%\_active\_actor\_gate' escape '\'
  loop
    execute format('drop policy %I on public.%I', v_policy.policyname, v_policy.tablename);
  end loop;
end;
$$;

drop policy if exists attendance_select on public.hrm_attendance;
drop policy if exists attendance_insert on public.hrm_attendance;
drop policy if exists attendance_update on public.hrm_attendance;
drop policy if exists attendance_delete on public.hrm_attendance;
create policy hrm_attendance_subject_select on public.hrm_attendance for select to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.attendance.view'));
create policy hrm_attendance_subject_insert on public.hrm_attendance for insert to authenticated
with check (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.attendance.edit'));
create policy hrm_attendance_subject_update on public.hrm_attendance for update to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.attendance.edit'))
with check (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.attendance.edit'));
create policy hrm_attendance_subject_delete on public.hrm_attendance for delete to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.attendance.edit'));

drop policy if exists leave_req_select on public.hrm_leave_requests;
drop policy if exists leave_req_write on public.hrm_leave_requests;
drop policy if exists leave_req_update on public.hrm_leave_requests;
drop policy if exists leave_req_delete on public.hrm_leave_requests;
create policy hrm_leave_requests_subject_select on public.hrm_leave_requests for select to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.view'));
create policy hrm_leave_requests_subject_insert on public.hrm_leave_requests for insert to authenticated
with check (
  status = 'pending'
  and app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.view')
);
create policy hrm_leave_requests_approve_update on public.hrm_leave_requests for update to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.approve'))
with check (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.approve'));
create policy hrm_leave_requests_approve_delete on public.hrm_leave_requests for delete to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.approve'));

drop policy if exists leave_bal_select on public.hrm_leave_balances;
drop policy if exists leave_bal_write on public.hrm_leave_balances;
drop policy if exists leave_bal_update on public.hrm_leave_balances;
drop policy if exists leave_bal_delete on public.hrm_leave_balances;
create policy hrm_leave_balances_subject_select on public.hrm_leave_balances for select to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.view'));
create policy hrm_leave_balances_approve_insert on public.hrm_leave_balances for insert to authenticated
with check (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.approve'));
create policy hrm_leave_balances_approve_update on public.hrm_leave_balances for update to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.approve'))
with check (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.approve'));
create policy hrm_leave_balances_approve_delete on public.hrm_leave_balances for delete to authenticated
using (app_private.hrm_can_access_employee_subject("employeeId", 'hrm.leave.approve'));

drop policy if exists leave_logs_select on public.hrm_leave_logs;
drop policy if exists leave_logs_insert on public.hrm_leave_logs;
drop policy if exists leave_logs_update on public.hrm_leave_logs;
drop policy if exists leave_logs_delete on public.hrm_leave_logs;
create policy hrm_leave_logs_subject_select on public.hrm_leave_logs for select to authenticated
using (app_private.hrm_can_access_leave_request(leave_request_id, 'hrm.leave.view'));
create policy hrm_leave_logs_subject_insert on public.hrm_leave_logs for insert to authenticated
with check (
  app_private.hrm_can_access_leave_request(leave_request_id, 'hrm.leave.view')
  or app_private.hrm_can_access_leave_request(leave_request_id, 'hrm.leave.approve')
);
create policy hrm_leave_logs_approve_update on public.hrm_leave_logs for update to authenticated
using (app_private.hrm_can_access_leave_request(leave_request_id, 'hrm.leave.approve'))
with check (app_private.hrm_can_access_leave_request(leave_request_id, 'hrm.leave.approve'));
create policy hrm_leave_logs_approve_delete on public.hrm_leave_logs for delete to authenticated
using (app_private.hrm_can_access_leave_request(leave_request_id, 'hrm.leave.approve'));

drop policy if exists attendance_proposals_select on public.hrm_attendance_proposals;
drop policy if exists attendance_proposals_insert on public.hrm_attendance_proposals;
drop policy if exists attendance_proposals_update on public.hrm_attendance_proposals;
drop policy if exists attendance_proposals_delete on public.hrm_attendance_proposals;
create policy hrm_attendance_proposals_scoped_select on public.hrm_attendance_proposals for select to authenticated
using (
  app_private.hrm_can_access_employee_subject("targetEmployeeId"::uuid, 'hrm.attendance.view')
  or app_private.hrm_employee_is_current_user("proposerEmployeeId")
  or app_private.hrm_is_location_manager("locationType", "locationId")
);
create policy hrm_attendance_proposals_self_insert on public.hrm_attendance_proposals for insert to authenticated
with check (
  "proposalStatus" = 'pending'
  and app_private.hrm_employee_is_current_user("proposerEmployeeId")
  and "targetEmployeeId" = "proposerEmployeeId"
);
create policy hrm_attendance_proposals_scoped_update on public.hrm_attendance_proposals for update to authenticated
using (
  app_private.hrm_can_access_employee_subject("targetEmployeeId"::uuid, 'hrm.attendance.approve')
  or app_private.hrm_is_location_manager("locationType", "locationId")
)
with check (
  app_private.hrm_can_access_employee_subject("targetEmployeeId"::uuid, 'hrm.attendance.approve')
  or app_private.hrm_is_location_manager("locationType", "locationId")
);
create policy hrm_attendance_proposals_scoped_delete on public.hrm_attendance_proposals for delete to authenticated
using (app_private.hrm_can_access_employee_subject("targetEmployeeId"::uuid, 'hrm.attendance.approve'));

drop policy if exists "Allow all access to hrm_doc_categories" on public.hrm_doc_categories;
create policy hrm_doc_categories_view_template on public.hrm_doc_categories for select to authenticated
using (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.document.view'));
create policy hrm_doc_categories_manage_template on public.hrm_doc_categories for all to authenticated
using (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.document.manage'))
with check (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.document.manage'));

drop policy if exists "Allow all for authenticated users" on public.hrm_shift_types;
create policy hrm_shift_types_authenticated_select on public.hrm_shift_types for select to authenticated using (true);
create policy hrm_shift_types_manage_template on public.hrm_shift_types for all to authenticated
using (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.master_data.manage'))
with check (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.master_data.manage'));

drop policy if exists "Allow all for authenticated users" on public.hrm_employee_shifts;
create policy hrm_employee_shifts_scoped_select on public.hrm_employee_shifts for select to authenticated
using (app_private.hrm_can_access_employee_subject(employee_id, 'hrm.attendance.view'));
create policy hrm_employee_shifts_manage_template on public.hrm_employee_shifts for all to authenticated
using (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.master_data.manage'))
with check (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.master_data.manage'));

drop policy if exists hrm_org_blocks_select on public.hrm_org_blocks;
drop policy if exists hrm_org_blocks_insert on public.hrm_org_blocks;
drop policy if exists hrm_org_blocks_update on public.hrm_org_blocks;
drop policy if exists hrm_org_blocks_delete on public.hrm_org_blocks;
create policy hrm_org_blocks_view_template on public.hrm_org_blocks for select to authenticated
using (app_private.has_governed_hrm_permission(public.current_app_user_id(), 'hrm.organization.view'));
create policy hrm_org_blocks_manage_template on public.hrm_org_blocks for all to authenticated
using (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.organization.manage'))
with check (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.organization.manage'));

do $$
declare v_table text; v_policy text;
begin
  foreach v_table in array array[
    'hrm_areas','hrm_employee_types','hrm_construction_sites','hrm_holidays',
    'hrm_offices','hrm_salary_policies','hrm_work_schedules'
  ] loop
    for v_policy in
      select policyname from pg_policies
      where schemaname='public' and tablename=v_table and cmd in ('INSERT','UPDATE','DELETE')
    loop execute format('drop policy %I on public.%I',v_policy,v_table); end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated using (app_private.has_hrm_template_permission(public.current_app_user_id(), %L)) with check (app_private.has_hrm_template_permission(public.current_app_user_id(), %L))',
      v_table || '_manage_hr_template', v_table, 'hrm.master_data.manage', 'hrm.master_data.manage'
    );
  end loop;
end;
$$;

drop policy if exists hrm_pt_select on public.hrm_payroll_templates;
drop policy if exists hrm_pt_write on public.hrm_payroll_templates;
drop policy if exists hrm_pt_update on public.hrm_payroll_templates;
drop policy if exists hrm_pt_delete on public.hrm_payroll_templates;
create policy hrm_payroll_templates_view_template on public.hrm_payroll_templates for select to authenticated
using (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.payroll.view'));
create policy hrm_payroll_templates_manage_template on public.hrm_payroll_templates for all to authenticated
using (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.payroll.manage'))
with check (app_private.has_hrm_template_permission(public.current_app_user_id(), 'hrm.payroll.manage'));

revoke all on function app_private.hrm_can_access_employee_subject(uuid,text,uuid) from public,anon,authenticated;
revoke all on function app_private.hrm_can_access_leave_request(uuid,text,uuid) from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
