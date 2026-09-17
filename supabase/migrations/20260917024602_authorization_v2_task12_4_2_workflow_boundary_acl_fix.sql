-- RLS predicates execute as the invoking role. Keep authorization logic in
-- SECURITY DEFINER helpers while granting only the predicate entry points.
grant execute on function app_private.workflow_template_actor_can_view(uuid, uuid) to authenticated;
grant execute on function app_private.workflow_template_actor_can_edit(uuid, uuid) to authenticated;
grant execute on function app_private.workflow_instance_actor_can_select(uuid) to authenticated;
grant execute on function app_private.project_workflow_template_manager(uuid, uuid) to authenticated;
