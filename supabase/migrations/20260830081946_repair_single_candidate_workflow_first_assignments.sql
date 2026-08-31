begin;

with first_tasks as (
  select start_node.template_id, edge.target_node_id
  from public.workflow_nodes start_node
  join public.workflow_edges edge on edge.source_node_id = start_node.id
  where start_node.type = 'START'::public.workflow_node_type
), single_candidates as (
  select node.id as node_id,
         min(target ->> 'userId')::uuid as assignee_user_id
  from public.workflow_nodes node
  cross join lateral jsonb_array_elements(
    coalesce(node.config -> 'assignmentTargets', '[]'::jsonb)
  ) target
  join public.users account
    on account.id::text = target ->> 'userId'
   and account.is_active
   and account.account_status = 'ACTIVE'
  where target ->> 'type' = 'user'
  group by node.id
  having count(distinct target ->> 'userId') = 1
)
update public.workflow_instances instance
set step_assignees = coalesce(instance.step_assignees, '{}'::jsonb)
      || jsonb_build_object(
        instance.current_node_id::text,
        jsonb_build_array(candidate.assignee_user_id::text)
      ),
    updated_at = now()
from first_tasks first_task
join single_candidates candidate on candidate.node_id = first_task.target_node_id
where instance.template_id = first_task.template_id
  and instance.current_node_id = first_task.target_node_id
  and instance.status = 'RUNNING'::public.workflow_instance_status
  and not (coalesce(instance.step_assignees, '{}'::jsonb) ? instance.current_node_id::text)
  and not exists (
    select 1 from public.workflow_subjects subject
    where subject.workflow_instance_id = instance.id
  )
  and not exists (
    select 1 from public.request_instances request_instance
    where request_instance.workflow_instance_id = instance.id
  );

commit;
