import { describe, expect, it } from 'vitest';

import {
  canConfigureProjectRoomAction,
  getDailyLogPermissionCodesForEffectiveRoomActions,
} from '../permissions/projectRoomEffectiveActions';

describe('effective Project Room actions', () => {
  it('blocks configuration until an action reaches pilot or enforced status', () => {
    expect(canConfigureProjectRoomAction('audit_only')).toBe(false);
    expect(canConfigureProjectRoomAction('pilot')).toBe(true);
    expect(canConfigureProjectRoomAction('enforced')).toBe(true);
  });

  it('maps Daily Log edit and delete to owner-scoped permissions only', () => {
    const permissions = getDailyLogPermissionCodesForEffectiveRoomActions(['edit', 'delete']);

    expect(permissions).toEqual(expect.arrayContaining([
      'project.daily_log.create',
      'project.daily_log.edit_own',
      'project.daily_log.delete_own',
    ]));
    expect(permissions).not.toContain('project.daily_log.edit_all');
    expect(permissions).not.toContain('project.daily_log.delete_all');
  });

  it('lets the assigned verifier summarize or return and the approver return', () => {
    const verifier = getDailyLogPermissionCodesForEffectiveRoomActions(['verify']);
    const approver = getDailyLogPermissionCodesForEffectiveRoomActions(['approve']);

    expect(verifier).toEqual(expect.arrayContaining([
      'project.daily_log.verify',
      'project.daily_log.return',
      'project.daily_log.summarize',
    ]));
    expect(approver).toEqual(expect.arrayContaining([
      'project.daily_log.approve',
      'project.daily_log.return',
    ]));
  });
});
