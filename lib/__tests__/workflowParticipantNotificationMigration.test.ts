import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260918103357_authorization_v2_workflow_participant_notifications.sql',
  'utf8',
);
const assignmentFixMigration = readFileSync(
  'supabase/migrations/20260918105055_authorization_v2_workflow_notification_assignment_fix.sql',
  'utf8',
);
const outboxMigration = readFileSync(
  'supabase/migrations/20260912045358_workflow_notification_outbox.sql',
  'utf8',
);
const allWorkflowNotificationSql = `${outboxMigration}\n${migration}`;

describe('Workflow participant notification migration', () => {
  it('resolves lifecycle recipients from the participant ledger', () => {
    expect(migration).toContain('create or replace function app_private.enqueue_workflow_notification_event');
    expect(migration).toContain('workflow_instance_participants');
    expect(migration).toContain('workflow.step_assigned');
    expect(migration).toContain('workflow_instance_user_can_select');
  });

  it('uses canonical detail links and preserves subject-owned suppression', () => {
    expect(migration).toContain("'/wf/' || i.id::text");
    expect(allWorkflowNotificationSql).toContain("last_error='pre_rollout_backlog'");
    expect(migration).toMatch(/last_error\s*=\s*'request_owned'/);
    expect(migration).toContain('workflow_notification_deliveries');
  });

  it('keeps notifications server-authoritative and idempotent', () => {
    expect(migration).toContain('on conflict(event_key) do nothing');
    expect(allWorkflowNotificationSql).toMatch(/on conflict\s*\(outbox_id,\s*user_id\) do nothing/);
    expect(migration).toContain('create or replace function app_private.deliver_workflow_notification');
  });

  it('resolves forwarded assignment recipients from the post-transition node', () => {
    expect(assignmentFixMigration).toContain('i.step_assignees -> i.current_node_id::text');
    expect(assignmentFixMigration).toContain('workflow.step_assigned');
  });
});
