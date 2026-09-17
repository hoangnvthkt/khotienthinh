-- Remove the pre-baseline permissive policies. Multiple permissive SELECT
-- policies are OR-ed by Postgres, so leaving wf_inst_select would defeat the
-- canonical policy even after privileges are revoked.
drop policy if exists wf_inst_select on public.workflow_instances;
drop policy if exists workflow_instances_select on public.workflow_instances;
create policy workflow_instances_select on public.workflow_instances
for select to authenticated
using (app_private.workflow_instance_actor_can_select(id));

drop policy if exists wf_inst_update on public.workflow_instances;
drop policy if exists wf_inst_delete on public.workflow_instances;
drop policy if exists wf_inst_write on public.workflow_instances;

drop policy if exists wf_logs_select on public.workflow_instance_logs;
create policy wf_logs_select on public.workflow_instance_logs
for select to authenticated
using (app_private.workflow_instance_actor_can_select(instance_id));
drop policy if exists wf_logs_write on public.workflow_instance_logs;
drop policy if exists wf_logs_update on public.workflow_instance_logs;
drop policy if exists wf_logs_delete on public.workflow_instance_logs;
