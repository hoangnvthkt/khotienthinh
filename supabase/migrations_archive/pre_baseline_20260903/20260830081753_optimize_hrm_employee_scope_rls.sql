begin;

create or replace function app_private.current_actor_hrm_visible_employee_ids(
  p_permission_code text
)
returns table(employee_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_has_global boolean := false;
  v_has_own boolean := false;
  v_has_direct_reports boolean := false;
begin
  if v_actor_user_id is null or p_permission_code not like 'hrm.%' then
    return;
  end if;

  v_has_global := app_private.has_governed_hrm_permission(
    v_actor_user_id, p_permission_code, 'global', '*'
  );
  if v_has_global then
    return query select employee.id from public.employees employee;
    return;
  end if;

  v_has_own := app_private.has_governed_hrm_permission(
    v_actor_user_id, p_permission_code, 'own', '*'
  );
  v_has_direct_reports := app_private.has_governed_hrm_permission(
    v_actor_user_id, p_permission_code, 'direct_reports', '*'
  );

  return query
  select employee.id
  from public.employees employee
  where (v_has_own and employee.user_id = v_actor_user_id)
     or (
       v_has_direct_reports
       and app_private.resolve_strict_direct_manager(employee.user_id) = v_actor_user_id
     );
end;
$$;

revoke all on function app_private.current_actor_hrm_visible_employee_ids(text) from public;
revoke all on function app_private.current_actor_hrm_visible_employee_ids(text) from anon;
grant execute on function app_private.current_actor_hrm_visible_employee_ids(text) to authenticated;

drop policy if exists hrm_employee_shifts_scoped_select on public.hrm_employee_shifts;
create policy hrm_employee_shifts_scoped_select
on public.hrm_employee_shifts
for select
to authenticated
using (
  employee_id in (
    select visible_employee.employee_id
    from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') visible_employee
  )
);

alter policy hrm_employee_shifts_manage_template on public.hrm_employee_shifts
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));

drop policy if exists hrm_attendance_subject_select on public.hrm_attendance;
create policy hrm_attendance_subject_select
on public.hrm_attendance
for select
to authenticated
using (
  "employeeId" in (
    select visible_employee.employee_id
    from app_private.current_actor_hrm_visible_employee_ids('hrm.attendance.view') visible_employee
  )
);

notify pgrst, 'reload schema';
commit;
