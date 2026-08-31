begin;

alter policy hrm_doc_categories_view_template on public.hrm_doc_categories
using (app_private.current_user_has_hrm_template_permission('hrm.document.view'));
alter policy hrm_doc_categories_manage_template on public.hrm_doc_categories
using (app_private.current_user_has_hrm_template_permission('hrm.document.manage'))
with check (app_private.current_user_has_hrm_template_permission('hrm.document.manage'));

alter policy hrm_org_blocks_view_template on public.hrm_org_blocks
using (app_private.current_user_has_hrm_template_permission('hrm.organization.view'));
alter policy hrm_org_blocks_manage_template on public.hrm_org_blocks
using (app_private.current_user_has_hrm_template_permission('hrm.organization.manage'))
with check (app_private.current_user_has_hrm_template_permission('hrm.organization.manage'));

alter policy hrm_payroll_templates_view_template on public.hrm_payroll_templates
using (app_private.current_user_has_hrm_template_permission('hrm.payroll.view'));
alter policy hrm_payroll_templates_manage_template on public.hrm_payroll_templates
using (app_private.current_user_has_hrm_template_permission('hrm.payroll.manage'))
with check (app_private.current_user_has_hrm_template_permission('hrm.payroll.manage'));

alter policy hrm_shift_types_manage_template on public.hrm_shift_types
using (app_private.current_user_has_hrm_template_permission('hrm.master_data.manage'))
with check (app_private.current_user_has_hrm_template_permission('hrm.master_data.manage'));
alter policy hrm_employee_shifts_manage_template on public.hrm_employee_shifts
using (app_private.current_user_has_hrm_template_permission('hrm.master_data.manage'))
with check (app_private.current_user_has_hrm_template_permission('hrm.master_data.manage'));

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'hrm_areas','hrm_employee_types','hrm_construction_sites','hrm_holidays',
    'hrm_offices','hrm_salary_policies','hrm_work_schedules'
  ] loop
    execute format(
      'alter policy %I on public.%I using (app_private.current_user_has_hrm_template_permission(%L)) with check (app_private.current_user_has_hrm_template_permission(%L))',
      v_table || '_manage_hr_template', v_table,
      'hrm.master_data.manage', 'hrm.master_data.manage'
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
