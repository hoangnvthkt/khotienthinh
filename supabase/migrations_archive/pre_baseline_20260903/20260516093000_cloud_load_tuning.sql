-- Reduce Supabase Cloud load for realtime-heavy workflow/request screens.
-- These indexes support recent-list queries, per-instance log hydration,
-- approver queues, and notification unread counts.

create index if not exists idx_workflow_instances_created_at_desc
  on public.workflow_instances (created_at desc);

create index if not exists idx_workflow_instances_status_current_created_at
  on public.workflow_instances (status, current_node_id, created_at desc)
  where current_node_id is not null;

create index if not exists idx_workflow_instances_watchers_gin
  on public.workflow_instances using gin (watchers);

create index if not exists idx_workflow_instance_logs_instance_created_at_desc
  on public.workflow_instance_logs (instance_id, created_at desc);

create index if not exists idx_request_instances_created_at_desc
  on public.request_instances (created_at desc);

create index if not exists idx_request_logs_request_created_at_desc
  on public.request_logs (request_id, created_at desc);

create index if not exists idx_notifications_unread_dismissed_user_created_at
  on public.notifications (user_id, is_read, is_dismissed, created_at desc);
