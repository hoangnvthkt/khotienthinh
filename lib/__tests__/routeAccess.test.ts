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

