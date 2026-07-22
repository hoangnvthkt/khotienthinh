import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages', 'project', 'DailyLogTab.tsx'), 'utf8');

describe('Daily Log Room approval UI contract', () => {
  it('shows the approve action to the assigned CHT without requiring return permission', () => {
    const viewerApproval = source.slice(
      source.indexOf('const canVerifyViewingLog'),
      source.indexOf('const canRollbackViewingLog'),
    );

    expect(viewerApproval).toContain('canProcessDailyLog(viewingLog)');
    expect(viewerApproval).not.toContain('canReviewDailyLog(viewingLog)');
  });
});
