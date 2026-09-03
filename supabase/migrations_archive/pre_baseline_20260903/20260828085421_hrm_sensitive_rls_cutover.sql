-- Cut over C3/C4 tables to approved HR business-role sources.

begin;

update app_private.permission_hardening_settings
set value = 'true'::jsonb,
    updated_at = now()
where key = 'business_role_resolver_enabled';

create or replace function app_private.has_hrm_template_permission(
  p_user_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
      and source_row.source_code in ('HR', 'HR_MANAGE')
      and source_row.scope_type = 'global'
      and source_row.scope_id = '*'
  );
$$;

create or replace function app_private.current_user_has_hrm_template_permission(
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_hrm_template_permission(
    public.current_app_user_id(),
    p_permission_code
  );
$$;

create or replace function app_private.get_effective_permission_sources_authorized(
  p_target_user_id uuid default public.current_app_user_id()
)
returns table(
  permission_code text,
  source_type text,
  source_id text,
  source_code text,
  source_label text,
  scope_type text,
  scope_id text,
  starts_at timestamptz,
  expires_at timestamptz,
  risk_level text,
  is_business_approval boolean,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_target_is_admin boolean := false;
begin
  if v_actor_user_id is null then
    raise exception 'Active application account required'
      using errcode = '42501';
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
    raise exception 'Not allowed to view authorization sources'
      using errcode = '42501';
  end if;

  select target_row.role = 'ADMIN'
  into v_target_is_admin
  from public.users target_row
  where target_row.id = p_target_user_id;

  return query
  select source_row.*
  from app_private.resolve_effective_permission_sources(
    p_target_user_id, null, null, null, now()
  ) source_row
  where not (
      coalesce(v_target_is_admin, false)
      and source_row.permission_code like 'hrm.%'
      and source_row.source_type = 'LEGACY'
    )
    and (
      not app_private.is_hrm_template_only_permission(source_row.permission_code)
      or (
        source_row.source_type = 'ROLE'
        and source_row.source_code in ('HR', 'HR_MANAGE')
      )
    );
end;
$$;

revoke select on table
  public.employees,
  public.hrm_documents,
  public.hrm_employee_compensation_assignments,
  public.hrm_labor_contracts,
  public.hrm_payroll_components,
  public.hrm_payrolls,
  public.hrm_salary_history
from anon;

alter table public.hrm_documents enable row level security;
alter table public.hrm_labor_contracts enable row level security;
alter table public.hrm_salary_history enable row level security;
alter table public.hrm_employee_compensation_assignments enable row level security;
alter table public.hrm_employee_manual_allowances enable row level security;
alter table public.hrm_payrolls enable row level security;
alter table public.hrm_payroll_components enable row level security;

drop policy if exists "Allow all access to hrm_documents" on public.hrm_documents;
drop policy if exists hrm_documents_active_actor_gate on public.hrm_documents;
drop policy if exists hrm_documents_select_hr_template on public.hrm_documents;
drop policy if exists hrm_documents_insert_hr_template on public.hrm_documents;
drop policy if exists hrm_documents_update_hr_template on public.hrm_documents;
drop policy if exists hrm_documents_delete_hr_template on public.hrm_documents;
create policy hrm_documents_select_hr_template
on public.hrm_documents for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.document.view')));
create policy hrm_documents_insert_hr_template
on public.hrm_documents for insert to authenticated
with check ((select app_private.current_user_has_hrm_template_permission('hrm.document.manage')));
create policy hrm_documents_update_hr_template
on public.hrm_documents for update to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.document.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.document.manage')));
create policy hrm_documents_delete_hr_template
on public.hrm_documents for delete to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.document.manage')));

drop policy if exists contracts_select on public.hrm_labor_contracts;
drop policy if exists contracts_write on public.hrm_labor_contracts;
drop policy if exists contracts_update on public.hrm_labor_contracts;
drop policy if exists contracts_delete on public.hrm_labor_contracts;
drop policy if exists hrm_labor_contracts_active_actor_gate on public.hrm_labor_contracts;
drop policy if exists hrm_labor_contracts_select_hr_template on public.hrm_labor_contracts;
drop policy if exists hrm_labor_contracts_insert_hr_template on public.hrm_labor_contracts;
drop policy if exists hrm_labor_contracts_update_hr_template on public.hrm_labor_contracts;
drop policy if exists hrm_labor_contracts_delete_hr_template on public.hrm_labor_contracts;
create policy hrm_labor_contracts_select_hr_template
on public.hrm_labor_contracts for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.contract.view')));
create policy hrm_labor_contracts_insert_hr_template
on public.hrm_labor_contracts for insert to authenticated
with check ((select app_private.current_user_has_hrm_template_permission('hrm.contract.manage')));
create policy hrm_labor_contracts_update_hr_template
on public.hrm_labor_contracts for update to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.contract.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.contract.manage')));
create policy hrm_labor_contracts_delete_hr_template
on public.hrm_labor_contracts for delete to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.contract.manage')));

drop policy if exists salary_history_select on public.hrm_salary_history;
drop policy if exists salary_history_insert on public.hrm_salary_history;
drop policy if exists salary_history_update on public.hrm_salary_history;
drop policy if exists salary_history_delete on public.hrm_salary_history;
drop policy if exists hrm_salary_history_active_actor_gate on public.hrm_salary_history;
drop policy if exists hrm_salary_history_select_hr_template on public.hrm_salary_history;
drop policy if exists hrm_salary_history_write_hr_manage on public.hrm_salary_history;
create policy hrm_salary_history_select_hr_template
on public.hrm_salary_history for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.view')));
create policy hrm_salary_history_write_hr_manage
on public.hrm_salary_history for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.manage')));

drop policy if exists hrm_employee_compensation_assignments_active_actor_gate on public.hrm_employee_compensation_assignments;
drop policy if exists hrm_employee_compensation_assignments_select on public.hrm_employee_compensation_assignments;
drop policy if exists hrm_employee_compensation_assignments_insert on public.hrm_employee_compensation_assignments;
drop policy if exists hrm_employee_compensation_assignments_update on public.hrm_employee_compensation_assignments;
drop policy if exists hrm_employee_compensation_assignments_delete on public.hrm_employee_compensation_assignments;
drop policy if exists hrm_employee_compensation_assignments_select_hr_template on public.hrm_employee_compensation_assignments;
drop policy if exists hrm_employee_compensation_assignments_write_hr_manage on public.hrm_employee_compensation_assignments;
create policy hrm_employee_compensation_assignments_select_hr_template
on public.hrm_employee_compensation_assignments for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.view')));
create policy hrm_employee_compensation_assignments_write_hr_manage
on public.hrm_employee_compensation_assignments for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.manage')));

drop policy if exists hrm_employee_manual_allowances_select on public.hrm_employee_manual_allowances;
drop policy if exists hrm_employee_manual_allowances_write on public.hrm_employee_manual_allowances;
drop policy if exists hrm_employee_manual_allowances_select_hr_template on public.hrm_employee_manual_allowances;
drop policy if exists hrm_employee_manual_allowances_write_hr_manage on public.hrm_employee_manual_allowances;
create policy hrm_employee_manual_allowances_select_hr_template
on public.hrm_employee_manual_allowances for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.view')));
create policy hrm_employee_manual_allowances_write_hr_manage
on public.hrm_employee_manual_allowances for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.compensation.manage')));

drop policy if exists hrm_payrolls_active_actor_gate on public.hrm_payrolls;
drop policy if exists payrolls_select on public.hrm_payrolls;
drop policy if exists payrolls_insert on public.hrm_payrolls;
drop policy if exists payrolls_update on public.hrm_payrolls;
drop policy if exists payrolls_delete on public.hrm_payrolls;
drop policy if exists hrm_payrolls_select_hr_template on public.hrm_payrolls;
drop policy if exists hrm_payrolls_write_hr_manage on public.hrm_payrolls;
create policy hrm_payrolls_select_hr_template
on public.hrm_payrolls for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.view')));
create policy hrm_payrolls_write_hr_manage
on public.hrm_payrolls for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.manage')));

drop policy if exists hrm_payroll_components_active_actor_gate on public.hrm_payroll_components;
drop policy if exists hrm_payroll_components_select on public.hrm_payroll_components;
drop policy if exists hrm_payroll_components_insert on public.hrm_payroll_components;
drop policy if exists hrm_payroll_components_update on public.hrm_payroll_components;
drop policy if exists hrm_payroll_components_delete on public.hrm_payroll_components;
drop policy if exists hrm_payroll_components_select_hr_template on public.hrm_payroll_components;
drop policy if exists hrm_payroll_components_write_hr_manage on public.hrm_payroll_components;
create policy hrm_payroll_components_select_hr_template
on public.hrm_payroll_components for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.view')));
create policy hrm_payroll_components_write_hr_manage
on public.hrm_payroll_components for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.payroll.manage')));

revoke all on function app_private.has_hrm_template_permission(uuid, text) from public, anon, authenticated;
revoke all on function app_private.current_user_has_hrm_template_permission(text) from public, anon;
grant execute on function app_private.current_user_has_hrm_template_permission(text) to authenticated;

commit;
