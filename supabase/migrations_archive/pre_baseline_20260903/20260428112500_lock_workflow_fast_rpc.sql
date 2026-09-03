create index if not exists idx_workflow_templates_created_by
  on public.workflow_templates (created_by);

revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text) from anon;
revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text) from public;
grant execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text) to authenticated;

notify pgrst, 'reload schema';
