import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260814080628_fix_workflow_mention_notification_icon.sql',
  'utf8',
).toLowerCase().replace(/\s+/g, ' ');

describe('workflow comment mention notification icon fix', () => {
  it('stores a renderable icon for new mention notifications', () => {
    expect(migration).toContain('notify_workflow_instance_comment_mentions');
    expect(migration).toContain("'💬'");
    expect(migration).not.toContain("'messagesquare',");
  });

  it('backfills previously created mention notifications', () => {
    expect(migration).toContain('update public.notifications');
    expect(migration).toContain("where source_type = 'workflow_comment_mention'");
    expect(migration).toContain("icon is distinct from '💬'");
  });
});
