import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages', 'project', 'DailyLogTab.tsx'), 'utf8');

describe('Daily Log assignment-first UI contract', () => {
  it('resolves the submit recipient from the backend instead of listing permission peers', () => {
    expect(source).toContain("from '../../lib/subjectAuthorizationService'");
    expect(source).toContain('getDailyLogResponsibilityTarget');
    expect(source).not.toContain('listProjectStaffWithPermissionCodes(projectId, constructionSiteId, [DAILY_LOG_ACTION.verify])');
    expect(source).not.toContain('verifierOptions');
    expect(source).not.toContain('selectedVerifier');
  });

  it('re-checks server-side subject action authority before any workflow mutation', () => {
    expect(source).toContain("subjectAuthorizationService.canAct('daily_log', log.id, subjectAction)");
    expect(source).toContain("subjectAuthorizationService.canAct('daily_log', log.id, 'submit')");
    expect(source).toContain('Người nhận được hệ thống phân công');
  });

  it('keeps Daily Log assignment-first while requiring its Room action', () => {
    expect(source).toContain("roomCode: 'daily_log'");
    expect(source).toContain('projectPermissionRoomService.hasAction');
    expect(source).toContain('getDailyLogResponsibilityTarget');
  });
});
