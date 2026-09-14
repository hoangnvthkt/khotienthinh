import { describe, expect, it } from 'vitest';
import { Role, type User } from '../../types';
import { getAuthorizedRouteFallback } from '../routeAccess';

const user: User = { id: 'fixture', name: 'Fixture', email: 'fixture@invalid.local', role: Role.EMPLOYEE,
  allowedSubModules: { DA: ['/da/tabs/material'] }, permissionGrants: [] };

describe('denied route fallback', () => {
  it('does not redirect into Project from a retained legacy submodule alone', () => {
    expect(getAuthorizedRouteFallback(user, '/da/portfolio')).toBe('/');
  });
  it('uses Project landing when canonical scoped access remains', () => {
    expect(getAuthorizedRouteFallback({ ...user, permissionGrants: [{
      userId: user.id, permissionCode: 'project.overview.view', scopeType: 'project', scopeId: 'A', isActive: true,
    }] }, '/da/portfolio')).toBe('/da');
  });
  it('does not follow expired project rights or admin role without capabilities', () => {
    expect(getAuthorizedRouteFallback({ ...user, role: Role.ADMIN, permissionGrants: [{
      userId: user.id, permissionCode: 'project.overview.view', scopeType: 'project', scopeId: 'A',
      isActive: true, expiresAt: '2020-01-01T00:00:00Z',
    }] }, '/da/portfolio')).toBe('/');
  });
  it('cannot loop to the denied landing or redirect unknown routes into Project', () => {
    const projectUser: User = { ...user, permissionGrants: [{ userId: user.id,
      permissionCode: 'project.overview.view', scopeType: 'global', scopeId: '*', isActive: true }] };
    expect(getAuthorizedRouteFallback(projectUser, '/da')).toBe('/');
    expect(getAuthorizedRouteFallback(projectUser, '/unknown')).toBe('/');
    expect(getAuthorizedRouteFallback(null, '/da/portfolio')).toBe('/');
  });
});
