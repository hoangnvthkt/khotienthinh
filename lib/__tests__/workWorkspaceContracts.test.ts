import { describe, expect, it } from 'vitest';
import {
  isWorkspaceScope,
  parseWorkspaceScope,
  type MembershipChange,
  type MembershipPreview,
  type WorkspaceCapabilities,
  type WorkspaceCursor,
  type WorkspaceLegacyScope,
  type WorkspaceMember,
  type WorkspacePage,
  type WorkspaceScopeInput,
  type WorkspaceSummary,
  validateWorkspaceScope,
} from '../work/workWorkspaceTypes';

describe('Work workspace contracts', () => {
  it('keeps the plan projections discriminated and usable by clients', () => {
    const capabilities: WorkspaceCapabilities = {
      canView: true,
      canCreateTask: true,
      canManageMembers: false,
      canConfigure: false,
      canArchive: false,
    };
    const summary: WorkspaceSummary = {
      id: 'workspace-1',
      name: 'Delivery',
      kind: 'collaboration',
      status: 'active',
      sourceName: null,
      iconKey: 'briefcase',
      colorKey: 'blue',
      coverKey: 'cover-1',
      pinned: true,
      memberCount: 2,
      visibleOpenTaskCount: 4,
      myActionCount: 1,
      capabilities,
      lockVersion: 1,
    };
    const cursor: WorkspaceCursor = { sortAt: '2026-09-07T10:00:00Z', id: summary.id };
    const member: WorkspaceMember = {
      userId: 'user-1',
      name: 'A User',
      avatarUrl: null,
      role: 'admin',
      origin: 'manual',
      expiresAt: null,
      lockVersion: 1,
    };
    const change: MembershipChange = { operation: 'set_role', userId: member.userId, role: 'member' };
    const preview: MembershipPreview = {
      fingerprint: 'fingerprint-1',
      changes: [change],
      blockers: [],
    };
    const page: WorkspacePage<WorkspaceSummary> = { items: [summary], nextCursor: cursor };

    expect(page.items[0]).toBe(summary);
    expect(preview.changes[0]).toBe(change);
  });

  it('accepts direct, new workspace and legacy department/project scopes', () => {
    const direct: WorkspaceScopeInput = { type: 'direct' };
    const workspace: WorkspaceScopeInput = { type: 'workspace', workspaceId: 'workspace-1' };
    const department: WorkspaceLegacyScope = { type: 'department', departmentId: 'department-1' };
    const project: WorkspaceLegacyScope = { type: 'project', projectId: 'project-1' };

    expect(parseWorkspaceScope(direct)).toEqual(direct);
    expect(parseWorkspaceScope(workspace)).toEqual(workspace);
    expect(parseWorkspaceScope(department)).toEqual(department);
    expect(parseWorkspaceScope(project)).toEqual(project);
    expect(validateWorkspaceScope(workspace)).toEqual(workspace);
    expect(isWorkspaceScope(direct)).toBe(true);
    expect(isWorkspaceScope(workspace)).toBe(true);
  });

  it('rejects mixed scope identifiers and unknown fields', () => {
    const invalidScopes: unknown[] = [
      { type: 'workspace', workspaceId: 'workspace-1', departmentId: 'department-1' },
      { type: 'department', departmentId: 'department-1', projectId: 'project-1' },
      { type: 'direct', workspaceId: 'workspace-1' },
      { type: 'workspace', workspaceId: 'workspace-1', unexpected: true },
      { type: 'project', projectId: 'project-1', unexpected: true },
    ];

    for (const value of invalidScopes) {
      expect(() => parseWorkspaceScope(value)).toThrow('WORK_SCOPE_INVALID');
      expect(() => validateWorkspaceScope(value)).toThrow('WORK_SCOPE_INVALID');
      expect(isWorkspaceScope(value)).toBe(false);
    }
  });

  it('rejects malformed scope values without coercion', () => {
    const invalidScopes: unknown[] = [
      null,
      [],
      {},
      { type: 'unknown', id: 'scope-1' },
      { type: 'workspace' },
      { type: 'workspace', workspaceId: '' },
      { type: 'workspace', workspaceId: '   ' },
      { type: 'workspace', workspaceId: 123 },
      { type: 'department', departmentId: null },
      { type: 'project', projectId: undefined },
    ];

    for (const value of invalidScopes) {
      expect(() => parseWorkspaceScope(value)).toThrow('WORK_SCOPE_INVALID');
      expect(isWorkspaceScope(value)).toBe(false);
    }
  });

  it('does not mutate the caller payload while parsing', () => {
    const input = { type: 'workspace', workspaceId: 'workspace-1' } as const;
    const parsed = parseWorkspaceScope(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(input).toEqual({ type: 'workspace', workspaceId: 'workspace-1' });
  });

  it('makes mixed identifiers impossible in typed scope inputs', () => {
    const direct: WorkspaceScopeInput = { type: 'direct' };
    const workspace: WorkspaceScopeInput = { type: 'workspace', workspaceId: 'workspace-1' };
    const legacy: WorkspaceScopeInput = { type: 'department', departmentId: 'department-1' };

    expect([direct.type, workspace.type, legacy.type]).toEqual(['direct', 'workspace', 'department']);

    // @ts-expect-error A workspace request cannot choose a legacy physical scope.
    const mixedWorkspace: WorkspaceScopeInput = {
      type: 'workspace',
      workspaceId: 'workspace-1',
      departmentId: 'department-1',
    };
    // @ts-expect-error A legacy department request cannot choose a project as well.
    const mixedLegacy: WorkspaceScopeInput = {
      type: 'department',
      departmentId: 'department-1',
      projectId: 'project-1',
    };

    expect(mixedWorkspace).toBeDefined();
    expect(mixedLegacy).toBeDefined();
  });
});
