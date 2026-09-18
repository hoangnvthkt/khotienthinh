create or replace function app_private.enqueue_workflow_log_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.workflow_instances%rowtype;
  v_event text;
  v_extra uuid[] := '{}';
  v_current jsonb;
begin
  select * into strict i from public.workflow_instances where id = new.instance_id;
  -- The constraint trigger runs after the lifecycle command commits its update.
  -- Resolve the assignment from the post-transition current node, not the log's
  -- historical node, so a forwarded step reaches the new assignee.
  v_current := i.step_assignees -> i.current_node_id::text;
  select coalesce(array_agg(distinct x.value::uuid), '{}') into v_extra
  from (
    select case when jsonb_typeof(v_current) = 'string' then v_current #>> '{}' end as value
    union all
    select value from jsonb_array_elements_text(
      case when jsonb_typeof(v_current) = 'array' then v_current else '[]'::jsonb end
    )
  ) x
  where x.value ~* '^[0-9a-f-]{36}$';

  v_event := case new.action
    when 'SUBMITTED' then 'workflow.submitted'
    when 'APPROVED' then 'workflow.step_approved'
    when 'REJECTED' then case when i.status = 'CANCELLED' then 'workflow.cancelled' else 'workflow.rejected' end
    when 'REVISION_REQUESTED' then 'workflow.revision_requested'
    when 'REOPENED' then 'workflow.reopened'
    else null
  end;

  if v_event is not null then
    perform app_private.enqueue_workflow_notification_event(
      i.id, v_event, new.acted_by, 'workflow.log:' || new.id,
      jsonb_build_object('nodeId', coalesce(i.current_node_id, new.node_id), 'outgoingNodeId', new.node_id), v_extra
    );
  end if;

  if new.action = 'SUBMITTED' and i.status = 'RUNNING' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action in ('APPROVED', 'REVISION_REQUESTED')
    and i.status = 'RUNNING'
    and i.current_node_id is distinct from new.node_id then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action = 'REOPENED' and i.status = 'RUNNING' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action = 'APPROVED' and i.status = 'COMPLETED' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.completed', new.acted_by, 'workflow.completed:' || new.id,
      jsonb_build_object('nodeId', new.node_id)
    );
  end if;
  return new;
end;
$$;

revoke all on function app_private.enqueue_workflow_log_notification()
  from public, anon, authenticated, service_role;
