import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260814074547_workflow_comment_mentions_notifications.sql',
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

describe('workflow comment mention notification migration', () => {
  it('canonicalizes explicit active-user mentions before storing them', () => {
    expect(migration).toContain('add column if not exists mentions jsonb not null');
    expect(migration).toContain('normalize_workflow_instance_comment_mentions');
    expect(migration).toContain("mentioned_user.account_status = 'active'");
    expect(migration).toContain("position(('@' || mentioned_user.name) in new.body) > 0");
  });

  it('creates recipient notifications after a comment insert', () => {
    expect(migration).toContain('notify_workflow_instance_comment_mentions');
    expect(migration).toContain("'workflow_comment_mention'");
    expect(migration).toContain("'/wf?instanceid='");
    expect(migration).toContain('after insert on public.workflow_instance_comments');
  });

  it('keeps privileged trigger helpers private', () => {
    expect(migration).toContain(
      'revoke all on function app_private.notify_workflow_instance_comment_mentions() from public, anon, authenticated, service_role',
    );
  });
});
