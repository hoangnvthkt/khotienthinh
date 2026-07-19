import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import {
  copyDirectPermissionDraft,
  dedupeDirectGrantDrafts,
  pasteDirectPermissionClipboard,
} from '../permissions/directUserPermissionMatrixViewModel';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

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
  it('dedupes active grants by user, code, scope, and expiry without carrying database or audit fields', () => {
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

  it('copies active Direct drafts without identity, row, actor, timestamp, Role, Legacy, or audit fields', () => {
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
    expect(clipboard.copiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('pastes by replacing the receiving user Direct Grant draft', () => {
    const clipboard = {
      copiedAt: '2026-07-19T00:00:00.000Z',
      grants: [
        {
          permissionCode: 'project.daily_log.view',
          scopeType: 'project' as const,
          scopeId: 'project-1',
          expiresAt: undefined,
        },
        {
          permissionCode: 'system.authorization.audit',
          scopeType: 'global' as const,
          scopeId: '*',
          expiresAt: undefined,
        },
      ],
    };

    expect(pasteDirectPermissionClipboard('user-b', clipboard)).toEqual([
      {
        userId: 'user-b',
        permissionCode: 'project.daily_log.view',
        scopeType: 'project',
        scopeId: 'project-1',
        expiresAt: undefined,
      },
      {
        userId: 'user-b',
        permissionCode: 'system.authorization.audit',
        scopeType: 'global',
        scopeId: '*',
        expiresAt: undefined,
      },
    ]);
  });

  it('does not expose quick-template draft behavior', () => {
    const source = read('lib/permissions/directUserPermissionMatrixViewModel.ts');

    expect(source).not.toContain('PermissionQuickTemplateDraft');
    expect(source).not.toContain('ApplyPermissionQuickTemplateInput');
    expect(source).not.toContain('applyPermissionQuickTemplateToDraft');
    expect(source).not.toContain('projectPermissionTemplates');
  });
});
