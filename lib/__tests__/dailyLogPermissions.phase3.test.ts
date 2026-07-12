import { describe, expect, it } from 'vitest';
import { Role } from '../../types';
import { canReturnDailyLogSource } from '../dailyLogWorkflow';
import { getProjectDocumentPolicy } from '../projectDocumentPolicy';

const actor = { id: 'user-1', role: Role.EMPLOYEE } as any;

describe('Phase 3.2 Daily Log explicit permissions', () => {
  it('allows owner edit_own only for own draft or rejected daily logs', () => {
    expect(getProjectDocumentPolicy({
      action: 'edit',
      documentType: 'daily_log',
      status: 'draft',
      user: actor,
      permissions: ['project.daily_log.edit_own'],
      relatedUserIds: ['user-1'],
      legacyPermissionFallback: false,
    }).allowed).toBe(true);

    expect(getProjectDocumentPolicy({
      action: 'edit',
      documentType: 'daily_log',
      status: 'draft',
      user: actor,
      permissions: ['project.daily_log.edit_own'],
      relatedUserIds: ['user-2'],
      legacyPermissionFallback: false,
    }).allowed).toBe(false);
  });

  it('allows edit_all for any draft or rejected daily log', () => {
    expect(getProjectDocumentPolicy({
      action: 'edit',
      documentType: 'daily_log',
      status: 'rejected',
      user: actor,
      permissions: ['project.daily_log.edit_all'],
      relatedUserIds: ['user-2'],
      legacyPermissionFallback: false,
    }).allowed).toBe(true);
  });

  it('does not let verify imply approve', () => {
    expect(getProjectDocumentPolicy({
      action: 'approve',
      documentType: 'daily_log',
      status: 'submitted',
      user: actor,
      permissions: ['project.daily_log.verify'],
      currentHandlerIds: ['user-1'],
      legacyPermissionFallback: false,
    }).allowed).toBe(false);

    expect(getProjectDocumentPolicy({
      action: 'approve',
      documentType: 'daily_log',
      status: 'submitted',
      user: actor,
      permissions: ['project.daily_log.approve'],
      currentHandlerIds: ['user-1'],
      legacyPermissionFallback: false,
    }).allowed).toBe(true);
  });

  it('requires project.daily_log.return to return a submitted source log', () => {
    const sourceLog = {
      id: 'log-1',
      status: 'submitted',
      submittedToPermission: 'verify',
      submittedToUserId: 'user-1',
    } as any;

    expect(canReturnDailyLogSource({
      sourceLog,
      userId: 'user-1',
      isAdmin: false,
      permissions: ['project.daily_log.verify'],
    })).toBe(false);

    expect(canReturnDailyLogSource({
      sourceLog,
      userId: 'user-1',
      isAdmin: false,
      permissions: ['project.daily_log.return'],
    })).toBe(true);
  });
});
