-- Reconcile the old RUNNING content-edit surface against the owner-approved
-- assigned-step/admin boundary. This query is read-only and rolls back.
begin;

create temporary table workflow_running_mutation_reconciliation as
with active_users as materialized (
  select
    u.id,
    u.role,
    (
      u.role = 'ADMIN'::public.user_role
      or 'WF' = any(coalesce(u.admin_modules, '{}'::text[]))
      or coalesce(u.admin_sub_modules, '{}'::jsonb) ? 'WF'
    ) as legacy_workflow_admin,
    app_private.has_permission(
      u.id, 'workflow.instance.administer', 'global', '*'
    ) as canonical_administer
  from public.users u
  where u.is_active and u.account_status = 'ACTIVE'
), running_instances as materialized (
  select i.*, n.config as current_node_config, t.managers
  from public.workflow_instances i
  join public.workflow_nodes n on n.id = i.current_node_id
  join public.workflow_templates t on t.id = i.template_id
  where i.status = 'RUNNING'
    and not exists (
      select 1 from public.request_instances request_instance
      where request_instance.workflow_instance_id = i.id
    )
    and not exists (
      select 1 from public.workflow_subjects subject
      where subject.workflow_instance_id = i.id
    )
), matrix as (
  select
    u.id as user_id,
    i.id as instance_id,
    i.created_by = u.id as is_creator,
    coalesce(u.id::text = any(i.managers), false) as is_template_manager,
    u.legacy_workflow_admin,
    u.canonical_administer,
    (
      coalesce(i.step_assignees ->> i.current_node_id::text, '') = u.id::text
      or (
        jsonb_typeof(i.step_assignees -> i.current_node_id::text) = 'array'
        and exists (
          select 1
          from jsonb_array_elements_text(i.step_assignees -> i.current_node_id::text) assignee(user_id)
          where assignee.user_id = u.id::text
        )
      )
      or coalesce(i.current_node_config ->> 'assigneeUserId', '') = u.id::text
      or coalesce(i.current_node_config ->> 'assigneeRole', '') = u.role::text
      or (
        i.created_by = u.id
        and i.current_node_id = (
          select first_edge.target_node_id
          from public.workflow_nodes start_node
          join public.workflow_edges first_edge on first_edge.source_node_id = start_node.id
          where start_node.template_id = i.template_id
            and start_node.type = 'START'
          limit 1
        )
        and exists (
          select 1 from public.workflow_instance_logs revision_log
          where revision_log.instance_id = i.id
            and revision_log.action = 'REVISION_REQUESTED'
        )
      )
    ) as is_current_assignee
  from active_users u
  cross join running_instances i
), decisions as (
  select
    *,
    (legacy_workflow_admin or is_creator or is_template_manager or is_current_assignee)
      as old_content_edit,
    (legacy_workflow_admin or canonical_administer or is_current_assignee)
      as new_step_content_edit,
    (legacy_workflow_admin or canonical_administer)
      as new_instance_content_edit
  from matrix
)
select * from decisions;

do $$
declare
  unexpected_gain_count bigint;
begin
  select count(*) into unexpected_gain_count
  from workflow_running_mutation_reconciliation
  where (new_step_content_edit and not old_content_edit)
     or (new_instance_content_edit and not old_content_edit);

  if unexpected_gain_count <> 0 then
    raise exception 'Workflow running mutation reconciliation found % unexpected gains',
      unexpected_gain_count;
  end if;
end;
$$;

select
  count(*) as compared_user_running_instance_pairs,
  count(*) filter (where old_content_edit and not new_step_content_edit)
    as approved_creator_manager_step_edit_losses,
  count(*) filter (where old_content_edit and not new_instance_content_edit)
    as approved_creator_manager_instance_edit_losses,
  count(*) filter (
    where (new_step_content_edit and not old_content_edit)
       or (new_instance_content_edit and not old_content_edit)
  ) as unexpected_gains
from workflow_running_mutation_reconciliation;

rollback;
