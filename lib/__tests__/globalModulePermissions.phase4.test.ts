import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import {
  getAnalyticsCapabilities,
  getStorageCapabilities,
} from '../permissions/globalModulePermissions';

const user = (permissionCodes: string[] = [], overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  name: 'Nguyen Van A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  permissionGrants: permissionCodes.map((permissionCode, index) => ({
    id: `grant-${index}`,
    userId: 'user-1',
    permissionCode,
    scopeType: 'global',
    scopeId: '*',
    isActive: true,
  })),
  ...overrides,
});

describe('Phase 4 global module permission capabilities', () => {
  it('separates analytics view from export', () => {
    expect(getAnalyticsCapabilities(user(['analytics.view']))).toEqual({
      canView: true,
      canExport: false,
    });
    expect(getAnalyticsCapabilities(user(['analytics.export']))).toEqual({
      canView: true,
      canExport: true,
    });
  });

  it('keeps storage as a view-only external route for now', () => {
    expect(getStorageCapabilities(user(['storage.view']))).toEqual({
      canView: true,
      canManage: false,
    });
    expect(getStorageCapabilities(user(['storage.manage']))).toEqual({
      canView: true,
      canManage: true,
    });
  });

  it('requires explicit canonical capabilities for global-module admins', () => {
    const admin = user([
      'ai.assistant.use',
      'storage.manage',
      'analytics.export',
    ], { role: Role.ADMIN });
    expect(getStorageCapabilities(admin).canManage).toBe(true);
    expect(getAnalyticsCapabilities(admin).canExport).toBe(true);
  });
});
