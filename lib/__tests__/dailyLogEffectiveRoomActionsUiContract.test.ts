import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages', 'project', 'DailyLogTab.tsx'), 'utf8');

describe('Daily Log effective Room action UI', () => {
  it('loads actor actions from the effective Room RPC instead of checking PBAC codes itself', () => {
    expect(source).toContain('projectPermissionRoomService.listMyActions');
    expect(source).toContain('projectPermissionRoomService.listMyPbacExceptions');
    expect(source).toContain("action.roomCode === 'daily_log'");
    expect(source).not.toContain('projectStaffService.checkProjectAction');
    expect(source).not.toContain('projectStaffService.requireProjectAction');
  });

  it('derives owner-scoped Daily Log permission capabilities from Room actions', () => {
    expect(source).toContain('getDailyLogPermissionCodesForEffectiveRoomActions');
    expect(source).toContain('isDailyLogOwner(log)');
    expect(source).toContain("getLogStatus(log) !== 'submitted'");
  });
});
