import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import {
  getAiAssistantCapabilities,
  getAiReportCapabilities,
  getAnalyticsCapabilities,
  getKnowledgeBaseCapabilities,
  getStorageCapabilities,
} from '../permissions/globalModulePermissions';

const user = (permissionCodes: string[] = [], overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  name: 'Nguyen Van A',
  email: 'a@example.com',
  role: Role.EMPLOYEE,
  allowedModules: [],
  adminModules: [],
  allowedSubModules: {},
  adminSubModules: {},
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
  it('separates AI route view from assistant use and report generation', () => {
    expect(getAiAssistantCapabilities(user(['ai.assistant.view']))).toEqual({
      canView: true,
      canUse: false,
    });
    expect(getAiAssistantCapabilities(user(['ai.assistant.use']))).toEqual({
      canView: true,
      canUse: true,
    });
    expect(getAiReportCapabilities(user(['ai.report.view']))).toEqual({
      canView: true,
      canGenerate: false,
    });
    expect(getAiReportCapabilities(user(['ai.report.generate']))).toEqual({
      canView: true,
      canGenerate: true,
    });
  });

  it('separates KB view from KB management', () => {
    expect(getKnowledgeBaseCapabilities(user(['kb.view']))).toEqual({
      canView: true,
      canManage: false,
    });
    expect(getKnowledgeBaseCapabilities(user(['kb.manage']))).toEqual({
      canView: true,
      canManage: true,
    });
  });

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

  it('allows admins through every global module capability', () => {
    const admin = user([], { role: Role.ADMIN });
    expect(getAiAssistantCapabilities(admin).canUse).toBe(true);
    expect(getAiReportCapabilities(admin).canGenerate).toBe(true);
    expect(getKnowledgeBaseCapabilities(admin).canManage).toBe(true);
    expect(getStorageCapabilities(admin).canManage).toBe(true);
    expect(getAnalyticsCapabilities(admin).canExport).toBe(true);
  });
});
