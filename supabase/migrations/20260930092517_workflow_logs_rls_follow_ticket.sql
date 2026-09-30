-- A ticket's history is visible exactly when the ticket is. Checking the
-- ticket once (through workflow_instances RLS) instead of re-running the full
-- permission check for every log row cuts /wf data loads ~4x (admin 2.2s→0.5s,
-- employee 5s→1.2s on 518 / 284 rows) with identical visible rows.
alter policy wf_logs_select on public.workflow_instance_logs using (
  instance_id in (select visible.id from public.workflow_instances visible)
);
