-- Reconcile every active user against every current workflow instance.
-- The owner-approved boundary intentionally removes creator/template-manager
-- authority for administrative lifecycle actions; there must be no new gain.
begin;

create temporary table workflow_capability_reconciliation as
with active_users as materialized (
  select
    u.id,
    (
      u.role = 'ADMIN'::public.user_role
      or 'WF' = any(coalesce(u.admin_modules, '{}'::text[]))
      or coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'WF'
    ) as legacy_workflow_admin,
    app_private.has_permission(
      u.id, 'workflow.instance.cancel', 'global', '*'
    ) as canonical_cancel,
    app_private.has_permission(
      u.id, 'workflow.instance.reopen', 'global', '*'
    ) as canonical_reopen,
    app_private.has_permission(
      u.id, 'workflow.instance.administer', 'global', '*'
    ) as canonical_administer
  from public.users u
  where u.is_active and u.account_status = 'ACTIVE'
), matrix as (
  select
    u.id as user_id,
    i.id as instance_id,
    i.status::text as status,
    i.created_by = u.id as is_creator,
    coalesce(u.id::text = any(t.managers), false) as is_template_manager,
    u.legacy_workflow_admin,
    u.canonical_cancel,
    u.canonical_reopen,
    u.canonical_administer
  from active_users u
  cross join public.workflow_instances i
  join public.workflow_templates t on t.id = i.template_id
), decisions as (
  select
    *,
    status = 'RUNNING' and (is_creator or legacy_workflow_admin) as old_cancel,
    status = 'RUNNING' and (canonical_cancel or legacy_workflow_admin) as new_cancel,
    status in ('COMPLETED', 'REJECTED')
      and (is_creator or legacy_workflow_admin) as old_reopen,
    status in ('COMPLETED', 'REJECTED')
      and (canonical_reopen or legacy_workflow_admin) as new_reopen,
    (is_creator or is_template_manager or legacy_workflow_admin) as old_administer,
    (canonical_administer or legacy_workflow_admin) as new_administer
  from matrix
)
select * from decisions;

do $$
declare
  unexpected_gain_count bigint;
begin
  select count(*) into unexpected_gain_count
  from workflow_capability_reconciliation
  where (new_cancel and not old_cancel)
     or (new_reopen and not old_reopen)
     or (new_administer and not old_administer);

  if unexpected_gain_count <> 0 then
    raise exception 'Workflow capability reconciliation found % unexpected gains',
      unexpected_gain_count;
  end if;
end;
$$;

select
  count(*) as compared_user_instance_pairs,
  count(*) filter (where old_cancel and not new_cancel)
    as approved_creator_cancel_losses,
  count(*) filter (where old_reopen and not new_reopen)
    as approved_creator_reopen_losses,
  count(*) filter (where old_administer and not new_administer)
    as approved_owner_manager_administer_losses,
  count(*) filter (
    where (new_cancel and not old_cancel)
       or (new_reopen and not old_reopen)
       or (new_administer and not old_administer)
  ) as unexpected_gains
from workflow_capability_reconciliation;

rollback;
