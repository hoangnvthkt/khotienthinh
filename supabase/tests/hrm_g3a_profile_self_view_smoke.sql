-- Run after 20261005140000_hrm_g3a_profile_self_view. Rolls back.
begin;
set local statement_timeout = '60s';

select set_config('test.g3.auth_id', u.auth_id::text, true),
       set_config('test.g3.email', u.email, true),
       set_config('test.g3.employee_id', e.id::text, true)
from public.users u join public.employees e on e.user_id = u.id and e.status = 'Đang làm việc'
where u.is_active and u.auth_id is not null and u.role <> 'ADMIN'
  and not app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
order by u.created_at limit 1;

select set_config('test.g3.other_employee_id', e.id::text, true)
from public.employees e
where e.status = 'Đang làm việc' and e.id::text <> current_setting('test.g3.employee_id') limit 1;

select set_config('test.g3.hr_auth', u.auth_id::text, true), set_config('test.g3.hr_email', u.email, true)
from public.users u
where u.is_active and u.auth_id is not null and app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive')
order by u.created_at limit 1;

select set_config('request.jwt.claim.sub', current_setting('test.g3.auth_id'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g3.auth_id'), 'email', current_setting('test.g3.email'))::text, true);
set local role authenticated;

do $$
declare v_overview jsonb;
begin
  v_overview := public.get_hrm_employee_overview(current_setting('test.g3.employee_id')::uuid);
  if not (v_overview -> 'visibleSections' ? 'contracts_employment') or not (v_overview -> 'visibleSections' ? 'legal_insurance') then
    raise exception 'HRM_G3_SELF_SECTIONS_MISSING %', v_overview -> 'visibleSections';
  end if;
  if v_overview -> 'visibleSections' ? 'compensation_tax_bank' then raise exception 'HRM_G3_SELF_SEES_PAY'; end if;
  perform public.get_hrm_employee_contract_employment(current_setting('test.g3.employee_id')::uuid);
  perform public.get_hrm_employee_legal_insurance(current_setting('test.g3.employee_id')::uuid);
  begin
    perform public.get_hrm_employee_legal_insurance(current_setting('test.g3.other_employee_id')::uuid);
    raise exception 'HRM_G3_SEES_OTHER_LEGAL';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_hrm_profile_completeness();
    raise exception 'HRM_G3_EMPLOYEE_SEES_COMPLETENESS';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', current_setting('test.g3.hr_auth'), true);
select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', current_setting('test.g3.hr_auth'), 'email', current_setting('test.g3.hr_email'))::text, true);
set local role authenticated;
do $$
declare v_rows jsonb := public.list_hrm_profile_completeness();
begin
  if jsonb_array_length(v_rows) < 10 or not (v_rows -> 0 -> 'checks' ? 'leaveBalance') then
    raise exception 'HRM_G3_COMPLETENESS_EMPTY %', left(v_rows::text, 300);
  end if;
end;
$$;
reset role;

select 'hrm_g3a_profile_self_view_smoke passed' as result;
rollback;
