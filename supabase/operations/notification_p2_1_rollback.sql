-- Emergency stop for P2.1: turn generic Workflow notifications off again.
-- Suppressed backlog rows are informational and are not restored.
begin;
update app_private.workflow_notification_settings set enabled = false where singleton;
commit;
