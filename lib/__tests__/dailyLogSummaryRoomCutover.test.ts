import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages', 'project', 'DailyLogTab.tsx'), 'utf8');
const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260722064053_daily_log_summary_room_approver.sql'),
  'utf8',
);

describe('Daily Log summary Room cutover', () => {
  it('lets the sender select the CHT from Daily Log Room approvers', () => {
    expect(source).toContain("projectPermissionRoomService.listRecipients(projectId, constructionSiteId, 'daily_log', 'approve')");
    expect(source).toContain('summaryApproverUserId');
    expect(source).toContain('submittedToUserId: summaryApproverUserId');
  });

  it('does not resolve the summary recipient from the legacy responsibility slot', () => {
    expect(source).not.toContain('getDailyLogResponsibilityTarget(summaryLogId)');
  });

  it('creates the selected Room approver assignment without a responsibility slot', () => {
    expect(migration).toContain('selected_from_daily_log_room');
    expect(migration).toContain('app_private.project_user_has_room_action');
    expect(migration).toContain('p_requested_verifier_id');
  });
});
