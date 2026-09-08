import { describe, expect, it } from 'vitest';
import { Role, type AuthorizationSnapshot } from '../../types';
import { evaluateCapability } from '../permissions/authorizationEvaluator';
import { canStartWorkWorkspace } from '../permissions/permissionService';
import { getAllPermissionActions, getPermissionActionByCode } from '../permissions/permissionRegistry';
import type { PermissionScopeType } from '../permissions/permissionTypes';

const source = (
  permissionCode: string,
  scopeId: string,
  overrides: Partial<AuthorizationSnapshot['sources'][number]> = {},
) => ({
  permissionCode,
  sourceType: 'WORKSPACE_MEMBER',
  sourceId: `membership-${scopeId}`,
  scopeType: 'work_workspace' as PermissionScopeType,
  scopeId,
  isBusinessApproval: permissionCode === 'work.task.review',
  metadata: { role: 'member' },
  ...overrides,
});

const snapshot = (sources: AuthorizationSnapshot['sources']): AuthorizationSnapshot => ({
  generatedAt: '2026-09-07T00:00:00.000Z',
  flags: { legacy_fallback_disabled: false },
  sources,
  roomActions: [],
});

describe('Work Workspace canonical permissions', () => {
  it('registers the workspace scope and role capability codes', () => {
    const actionByCode = Object.fromEntries(
      getAllPermissionActions().map(action => [action.permissionCode, action]),
    );
    const workspaceCodes = [
      'work.workspace.create',
      'work.workspace.manage_members',
      'work.workspace.archive',
      'work.workspace.recover',
    ];
    expect(workspaceCodes.every(code => actionByCode[code])).toBe(true);
    expect(actionByCode['work.workspace.create'].scopeTypes).toEqual(['global', 'department', 'project']);
    expect(actionByCode['work.workspace.manage_members'].scopeTypes).toEqual(['work_workspace']);
    expect(actionByCode['work.workspace.archive'].scopeTypes).toEqual(['work_workspace']);
    expect(actionByCode['work.workspace.recover'].scopeTypes).toEqual(['global']);
    expect(getPermissionActionByCode('work.task.create')?.scopeTypes).toContain('work_workspace');
    expect(getPermissionActionByCode('work.task.view_scope')?.scopeTypes).toContain('work_workspace');
  });

  it('keeps an active Workspace member scoped to that Workspace', () => {
    const member = snapshot([source('work.task.create', 'workspace-a')]);
    expect(evaluateCapability(member, 'work.task.create', {
      scopeType: 'work_workspace',
      scopeId: 'workspace-a',
    })).toMatchObject({ allowed: true, reason: 'granted', sourceType: 'WORKSPACE_MEMBER' });
    expect(evaluateCapability(member, 'work.task.create', {
      scopeType: 'work_workspace',
      scopeId: 'workspace-b',
    })).toMatchObject({ allowed: false, reason: 'scope_mismatch' });
  });

  it('opens the creation wizard for an active source-scoped create grant', () => {
    expect(canStartWorkWorkspace({
      role: Role.EMPLOYEE,
      authorizationSnapshot: snapshot([source('work.workspace.create', 'department-a', {
        scopeType: 'department',
      })]),
    })).toBe(true);
    expect(canStartWorkWorkspace({
      role: Role.EMPLOYEE,
      authorizationSnapshot: snapshot([source('work.workspace.create', 'department-a', {
        scopeType: 'department',
        expiresAt: '2020-01-01T00:00:00.000Z',
      })]),
    })).toBe(false);
  });

  it('rejects expired Workspace capability sources', () => {
    const expired = snapshot([source('work.task.view_scope', 'workspace-a', {
      expiresAt: '2026-09-06T00:00:00.000Z',
    })]);
    expect(evaluateCapability(expired, 'work.task.view_scope', {
      scopeType: 'work_workspace',
      scopeId: 'workspace-a',
    })).toMatchObject({ allowed: false, reason: 'not_granted' });


  });

  it('matches a global grant; task membership must also be checked by the server', () => {
    const globalGrant = snapshot([{
      permissionCode: 'work.task.create',
      sourceType: 'DIRECT',
      sourceId: 'global-grant',
      scopeType: 'global',
      scopeId: '*',
      isBusinessApproval: false,
      metadata: {},
    }]);
    expect(evaluateCapability(globalGrant, 'work.task.create', {
      scopeType: 'work_workspace',
      scopeId: 'workspace-outsider',
    })).toMatchObject({ allowed: true, reason: 'granted' });
  });
});
