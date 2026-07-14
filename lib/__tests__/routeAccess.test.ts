import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import { canAccessRoute, getRouteModuleKey } from '../routeAccess';

const user = (allowedModules?: string[]): User => ({
  id: 'user-1',
  name: 'Nguyễn Văn A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  allowedModules,
});

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
});
