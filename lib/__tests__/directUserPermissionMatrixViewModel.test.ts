import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import { getPermissionModuleByCode } from '../permissions/permissionRegistry';
import {
  applyPermissionQuickTemplateToDraft,
  copyDirectPermissionDraft,
  dedupeDirectGrantDrafts,
  pasteDirectPermissionClipboard,
} from '../permissions/directUserPermissionMatrixViewModel';

const dailyLog = getPermissionModuleByCode('project.daily_log');
const payment = getPermissionModuleByCode('project.payment');
if (!dailyLog || !payment) throw new Error('Missing project permission fixtures');

const grant = (
  userId: string,
  permissionCode: string,
  scopeId: string,
  overrides: Partial<UserPermissionGrant> = {},
): UserPermissionGrant => ({
  userId,
  permissionCode,
  scopeType: 'project',
  scopeId,
  ...overrides,
});

describe('direct user permission matrix view model', () => {
  it('dedupes active grants by user, code, scope, and expiry without carrying ids', () => {
    const next = dedupeDirectGrantDrafts([
      {
        id: 'db-1',
        grantedBy: 'actor-1',
        grantedAt: '2026-07-18T00:00:00.000Z',
        ...grant('user-1', 'project.daily_log.view', 'project-1'),
      },
      grant('user-1', 'project.daily_log.view', 'project-1'),
      {
        ...grant('user-1', 'project.daily_log.view', 'project-1'),
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
      { ...grant('user-1', 'project.daily_log.create', 'project-1'), isActive: false },
    ]);

    expect(next).toEqual([
      grant('user-1', 'project.daily_log.view', 'project-1'),
      {
        ...grant('user-1', 'project.daily_log.view', 'project-1'),
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  it('applies a quick template only to the selected module group and selected project scope', () => {
    const next = applyPermissionQuickTemplateToDraft({
      targetUserId: 'user-1',
      drafts: [
        grant('user-1', 'project.daily_log.edit_own', 'project-1'),
        grant('user-1', 'project.daily_log.view', 'project-2'),
        grant('user-1', 'project.payment.view', 'project-1'),
      ],
      template: {
        code: 'field_engineer',
        name: 'Ky su',
        permissionCodes: [
          'project.daily_log.create',
          'project.daily_log.edit_own',
          'project.daily_log.confirm',
        ],
      },
      modules: [dailyLog],
      scope: { scopeType: 'project', scopeId: 'project-1' },
    });

    expect(next.map(item => `${item.permissionCode}:${item.scopeId}`).sort()).toEqual([
      'project.daily_log.create:project-1',
      'project.daily_log.edit_own:project-1',
      'project.daily_log.view:project-1',
      'project.daily_log.view:project-2',
      'project.payment.view:project-1',
    ]);
  });

  it('refuses template codes that are not newly grantable by readiness', () => {
    const next = applyPermissionQuickTemplateToDraft({
      targetUserId: 'user-1',
      drafts: [],
      template: {
        code: 'unsafe',
        name: 'Unsafe',
        permissionCodes: ['project.daily_log.confirm'],
      },
      modules: [dailyLog],
      scope: { scopeType: 'project', scopeId: 'project-1' },
    });

    expect(next).toEqual([]);
  });

  it('copies active Direct drafts without database/audit/source fields and paste replaces the receiving draft', () => {
    const clipboard = copyDirectPermissionDraft([
      {
        id: 'db-1',
        grantedBy: 'actor-1',
        grantedAt: '2026-07-18T00:00:00.000Z',
        ...grant('user-a', 'project.daily_log.view', 'project-1'),
      },
      { ...grant('user-a', 'project.payment.view', 'project-1'), isActive: false },
      {
        ...grant('user-a', 'project.payment.verify', 'project-2'),
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ]);

    expect(clipboard.grants).toEqual([
      {
        permissionCode: 'project.daily_log.view',
        scopeType: 'project',
        scopeId: 'project-1',
        expiresAt: undefined,
      },
      {
        permissionCode: 'project.payment.verify',
        scopeType: 'project',
        scopeId: 'project-2',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ]);

    expect(pasteDirectPermissionClipboard('user-b', clipboard)).toEqual([
      grant('user-b', 'project.daily_log.view', 'project-1'),
      {
        ...grant('user-b', 'project.payment.verify', 'project-2'),
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });
});
