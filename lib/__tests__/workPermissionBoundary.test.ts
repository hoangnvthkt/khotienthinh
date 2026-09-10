import { afterEach, describe, expect, it, vi } from 'vitest';

import { Role, type AuthorizationSnapshot, type User } from '../../types';

const workUser = (role: Role, permissionCode?: string): User => ({
  id: 'work-user-1',
  name: 'Work User',
  email: 'work@example.com',
  role,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
  permissionGrants: permissionCode ? [{
    userId: 'work-user-1',
    permissionCode,
    scopeType: 'global',
    scopeId: '*',
    isActive: true,
  }] : [],
});

const loadBoundary = async (enabled: boolean) => {
  vi.resetModules();
  vi.stubEnv('VITE_ENABLE_VIOO_WORK', enabled ? 'true' : 'false');
  return import('../routeAccess');
};

describe('Work canonical route boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('keeps every Work route closed while the feature flag is off', async () => {
    const { canAccessRoute } = await loadBoundary(false);
    const pilot = workUser(Role.EMPLOYEE, 'work.module.access');

    expect(canAccessRoute(pilot, '/work/my')).toBe(false);
    expect(canAccessRoute(pilot, '/work/tasks/VW-2026-000001')).toBe(false);
  });

  it('opens Work only for a canonical module grant when the flag is on', async () => {
    const { canAccessRoute, getRouteModuleKey } = await loadBoundary(true);
    const pilot = workUser(Role.EMPLOYEE, 'work.module.access');

    expect(getRouteModuleKey('/work/tasks/VW-2026-000001')).toBe('work.module');
    expect(canAccessRoute(pilot, '/work/my')).toBe(true);
    expect(canAccessRoute(workUser(Role.EMPLOYEE), '/work/my')).toBe(false);
    expect(canAccessRoute(workUser(Role.ADMIN), '/work/my')).toBe(false);
  });

  it('requires active canonical configure permission on settings', async () => {
    const { canAccessRoute } = await loadBoundary(true);
    const user = workUser(Role.ADMIN, 'work.module.access');
    expect(canAccessRoute(user, '/work/settings')).toBe(false);
    user.permissionGrants!.push({userId:user.id,permissionCode:'work.task.configure',scopeType:'department',scopeId:'d1',isActive:true});
    expect(canAccessRoute(user, '/work/settings')).toBe(true);
    user.permissionGrants![1].expiresAt='2020-01-01T00:00:00Z';
    expect(canAccessRoute(user, '/work/settings')).toBe(false);
  });

  it('does not let a department grant cover a project scope', async () => {
    await loadBoundary(true);
    const { evaluateCapability } = await import('../permissions/authorizationEvaluator');
    const snapshot: AuthorizationSnapshot = {
      generatedAt: '2026-09-07T00:00:00.000Z',
      flags: { legacy_fallback_disabled: false },
      sources: [{
        permissionCode: 'work.task.view_scope',
        sourceType: 'DIRECT',
        scopeType: 'department',
        scopeId: 'department-1',
        isBusinessApproval: false,
        metadata: {},
      }],
      roomActions: [],
    };

    expect(evaluateCapability(snapshot, 'work.task.view_scope', {
      scopeType: 'department', scopeId: 'department-1',
    }).allowed).toBe(true);
    expect(evaluateCapability(snapshot, 'work.task.view_scope', {
      scopeType: 'project', scopeId: 'department-1',
    }).allowed).toBe(false);
  });

  it('denies unregistered Work paths even for a pilot user', async () => {
    const { canAccessRoute } = await loadBoundary(true);
    expect(canAccessRoute(workUser(Role.EMPLOYEE, 'work.module.access'), '/work/not-registered')).toBe(false);
    expect(canAccessRoute(workUser(Role.EMPLOYEE, 'work.module.access'), '/work/tasks/VW-2026-000001/extra')).toBe(false);
  });

  it('uses canonical access for module and route visibility', async () => {
    await loadBoundary(true);
    const { canViewModule, canViewRoute } = await import('../permissions/permissionService');
    const pilot = workUser(Role.EMPLOYEE, 'work.module.access');
    expect(canViewModule(pilot, 'work.module')).toBe(true);
    expect(canViewModule(workUser(Role.ADMIN), 'work.module')).toBe(false);
    expect(canViewRoute(pilot, '/work/my')).toBe(true);
    expect(canViewRoute(pilot, '/work/unknown')).toBe(false);
  });
});
