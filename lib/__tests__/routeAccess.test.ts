import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import type { EffectivePermissionSource } from '../permissions/authorizationGovernanceTypes';
import { canAccessRoute, getRouteModuleKey, isAuthenticatedOpenRoute } from '../routeAccess';

const user = (allowedModules?: string[], effectivePermissions?: EffectivePermissionSource[]): User => ({
  id: 'user-1',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  allowedModules,
  effectivePermissions,
});

const approverSource: EffectivePermissionSource = {
  permissionCode: 'project.daily_log.approve',
  sourceType: 'ROLE', sourceId: 'assignment-1',
  sourceCode: 'PROJECT_APPROVER', sourceLabel: 'Project Approver',
  scopeType: 'project', scopeId: 'project-1',
  riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
};

describe('chat route access', () => {
  it('maps the chat route to the CHAT module', () => {
    expect(getRouteModuleKey('/chat')).toBe('CHAT');
  });

  it('allows users explicitly granted CHAT', () => {
    expect(canAccessRoute(user(['HRM', 'CHAT']), '/chat')).toBe(true);
  });

  it('blocks users without CHAT', () => {
    expect(canAccessRoute(user(['HRM']), '/chat')).toBe(false);
  });

  it('keeps legacy profiles without an allowedModules list working', () => {
    expect(canAccessRoute(user(undefined), '/chat')).toBe(true);
  });

  it('always allows administrators', () => {
    expect(canAccessRoute({ ...user([]), role: Role.ADMIN }, '/chat')).toBe(true);
  });

  it('lets an exact effective action source through the top-level registered route gate', () => {
    expect(canAccessRoute(user([], [approverSource]), '/da/tabs/dailylog')).toBe(true);
  });

  it('does not let authoritative-empty System Admin open an unrelated protected route', () => {
    expect(canAccessRoute({ ...user([], []), role: Role.ADMIN }, '/chat')).toBe(false);
  });
});

describe('phase 0 route containment', () => {
  it('maps the document trace route to AUDIT_TRAIL', () => {
    expect(getRouteModuleKey('/trace')).toBe('AUDIT_TRAIL');
  });

  it('maps the contract shell route to HD', () => {
    expect(getRouteModuleKey('/hd')).toBe('HD');
  });

  it('blocks unknown protected routes for non-admin users', () => {
    expect(canAccessRoute(user(['HRM']), '/not-declared-yet')).toBe(false);
  });

  it('keeps authenticated-open profile routes available', () => {
    expect(canAccessRoute(user([]), '/my-profile')).toBe(true);
  });

  it('keeps the authenticated home route available', () => {
    expect(canAccessRoute(user([]), '/')).toBe(true);
  });

  it('keeps legacy profiles without an allowedModules list working for mapped routes', () => {
    expect(canAccessRoute(user(undefined), '/hd')).toBe(true);
  });

  it('treats a QR route as authenticated navigation, not a public capability grant', () => {
    const safetyCardRoute = '/safety-card/forwarded-token';
    expect(isAuthenticatedOpenRoute(safetyCardRoute)).toBe(true);
    expect(canAccessRoute(null, safetyCardRoute)).toBe(false);
  });
});
