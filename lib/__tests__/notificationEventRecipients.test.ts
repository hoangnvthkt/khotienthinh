import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const migrationName = readdirSync(join(root, 'supabase', 'migrations'))
  .find(name => name.endsWith('_notification_event_recipients_request_safety.sql'));
const migration = migrationName
  ? readFileSync(join(root, 'supabase', 'migrations', migrationName), 'utf8')
  : '';

describe('event notification recipients (owner decisions 28/09)', () => {
  it('limits request watchers to the outcome and overdue', () => {
    expect(migrationName).toBeDefined();
    expect(migration).toMatch(/role = 'WATCHER'[\s\S]*?p_event_type in \('REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_OVERDUE'\)/);
  });

  it('reminds the pending approver of their own step and new comments', () => {
    expect(migration).toContain("'REQUEST_COMMENT_CREATED')");
    expect(migration).toContain("p_event_type in ('REQUEST_DUE_SOON', 'REQUEST_OVERDUE')");
    expect(migration).toContain("a.node_id::text = p_payload ->> 'nodeId'");
  });

  it('sends high and critical safety issues to the Safety Room and site command', () => {
    expect(migration).toContain("new.severity in ('high', 'critical')");
    expect(migration).toContain('"includeSiteCommand":true');
    expect(migration).toContain('after insert or update of status, assigned_to_user_id on public.safety_issues');
    expect(migration).toContain("where recipient.user_id::text is distinct from v_actor");
  });

  it('no longer sends safety notifications from the browser', () => {
    const safety = readFileSync(join(root, 'lib', 'safetyService.ts'), 'utf8');
    expect(safety).not.toContain('notifyProjectUsers');
    expect(safety).not.toContain('notificationService');
  });
});
