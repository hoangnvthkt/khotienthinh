begin;

do $$
declare v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in (
        'org_units', 'hrm_positions', 'hrm_position_groups',
        'hrm_position_levels', 'hrm_competency_groups',
        'hrm_competency_levels', 'hrm_catalog_items',
        'hrm_org_position_slots', 'hrm_employee_slot_assignments'
      )
      and (cmd <> 'SELECT' or policyname like '%active_actor_gate')
  loop
    execute pg_catalog.format(
      'drop policy if exists %I on %I.%I',
      v_policy.policyname, v_policy.schemaname, v_policy.tablename
    );
  end loop;
end;
$$;

alter table public.org_units enable row level security;
alter table public.hrm_positions enable row level security;
alter table public.hrm_position_groups enable row level security;
alter table public.hrm_position_levels enable row level security;
alter table public.hrm_competency_groups enable row level security;
alter table public.hrm_competency_levels enable row level security;
alter table public.hrm_catalog_items enable row level security;
alter table public.hrm_org_position_slots enable row level security;
alter table public.hrm_employee_slot_assignments enable row level security;

create policy org_units_manage_hr_template
on public.org_units for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.organization.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.organization.manage')));

create policy hrm_positions_manage_hr_template
on public.hrm_positions for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));

create policy hrm_position_groups_manage_hr_template
on public.hrm_position_groups for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
create policy hrm_position_levels_manage_hr_template
on public.hrm_position_levels for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
create policy hrm_competency_groups_manage_hr_template
on public.hrm_competency_groups for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
create policy hrm_competency_levels_manage_hr_template
on public.hrm_competency_levels for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));
create policy hrm_catalog_items_manage_hr_template
on public.hrm_catalog_items for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));

drop policy if exists hrm_org_position_slots_select on public.hrm_org_position_slots;
create policy hrm_org_position_slots_view_hr_template
on public.hrm_org_position_slots for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.view')));
create policy hrm_org_position_slots_manage_hr_template
on public.hrm_org_position_slots for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.manage')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.manage')));

drop policy if exists hrm_employee_slot_assignments_select on public.hrm_employee_slot_assignments;
create policy hrm_employee_slot_assignments_view_hr_template
on public.hrm_employee_slot_assignments for select to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.view')));
create policy hrm_employee_slot_assignments_assign_hr_template
on public.hrm_employee_slot_assignments for all to authenticated
using ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.assign')))
with check ((select app_private.current_user_has_hrm_template_permission('hrm.staffing.assign')));

revoke insert, update, delete on table
  public.org_units,
  public.hrm_positions,
  public.hrm_position_groups,
  public.hrm_position_levels,
  public.hrm_competency_groups,
  public.hrm_competency_levels,
  public.hrm_catalog_items,
  public.hrm_org_position_slots,
  public.hrm_employee_slot_assignments
from anon;

notify pgrst, 'reload schema';
commit;
